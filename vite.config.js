import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 는 https://<user>.github.io/<repo>/ 로 서비스되므로 base 경로가 필요합니다.
// deploy.yml 에서 VITE_BASE=/<repo>/ 를 넘겨주고, 로컬 개발은 '/' 로 동작합니다.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [
    tailwindcss(),
    VitePWA({
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
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-files',
              expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
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
