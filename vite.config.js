import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages 는 https://<user>.github.io/<repo>/ 로 서비스되므로 base 경로가 필요합니다.
// deploy.yml 에서 VITE_BASE=/<repo>/ 를 넘겨주고, 로컬 개발은 '/' 로 동작합니다.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [tailwindcss()],
  worker: { format: 'es' },          // MapLibre 6 은 module worker 사용
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,     // maplibre-gl 이 큰 편이라 경고 기준 상향
  },
});
