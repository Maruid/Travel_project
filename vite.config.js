import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 는 https://<user>.github.io/<repo>/ 로 서비스되므로 base 경로가 필요합니다.
// deploy.yml 에서 VITE_BASE=/<repo>/ 를 넘겨주고, 로컬 개발은 '/' 로 동작합니다.
// 안드로이드 앱용 빌드(VITE_APP=1, npm run build:app): 서비스 워커 없음 (앱 안에 화면 파일이 들어 있고,
// 지도 오프라인 저장은 lib/map-cache.js 가 직접 함). 웹 빌드는 그대로 PWA
const IS_APP = process.env.VITE_APP === '1';

// 앱 빌드에서는 PWA 플러그인이 없으므로 등록 모듈을 빈 함수로 대신함
const noPwa = {
  name: 'travel-no-pwa',
  resolveId: (id) => (id === 'virtual:pwa-register' ? '\0no-pwa' : null),
  load: (id) => (id === '\0no-pwa' ? 'export const registerSW = () => () => {};' : null),
};

export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    tailwindcss(),
    IS_APP && noPwa,
    !IS_APP && VitePWA({
      // 새 버전이 배포되면 바로 갈아끼우지 않고, 앱에서 "새로고침" 안내를 띄움 (입력 중 데이터 보호)
      registerType: 'prompt',
      injectRegister: false,          // 등록은 src/lib/pwa.js 에서 직접
      includeAssets: ['icons/apple-touch-icon.png', 'icons/favicon.png'],
      manifest: {
        name: 'Trip Guide',
        short_name: 'Trip',
        description: '함께 만드는 여행 일정 · 장소 · 가계부',
        lang: 'ko',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#060911',
        theme_color: '#0a0f1d',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 빌드 결과물 전체를 미리 캐시 → 오프라인에서도 앱이 열림
        globPatterns: ['**/*.{js,css,html,woff2,png,svg,ico,webmanifest}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,   // 지도 청크가 1MB 를 넘음
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // OpenFreeMap: 스타일/TileJSON 은 최신 우선, 네트워크 실패 시 캐시
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org' && !/\.pbf$|\/fonts\/|\/sprites\//.test(url.pathname),
            handler: 'NetworkFirst',
            options: {
              cacheName: 'map-style',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 50, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // 벡터 타일 · 글꼴 · 스프라이트: 한 번 받은 건 캐시에서 (지도 미리 받기도 여기에 저장됨)
            urlPattern: ({ url }) => url.hostname === 'tiles.openfreemap.org',
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 6000, maxAgeSeconds: 60 * 60 * 24 * 60, purgeOnQuotaError: true },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          // 글꼴은 빌드에 들어 있어 위 globPatterns(woff2)로 미리 캐시됨 (Google Fonts 안 씀)
          // Supabase API 는 캐시하지 않음: 데이터 오프라인 처리는 TripStore(localStorage + outbox)가 담당
        ],
      },
    }),
  ],
  worker: { format: 'es' },          // MapLibre 6 은 module worker 사용
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,     // maplibre-gl 이 큰 편이라 경고 기준 상향
  },
});
