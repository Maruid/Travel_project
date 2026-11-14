import { registerSW } from 'virtual:pwa-register';
import { html, setHTML } from './dom.js';
import { toast } from '../components/ui.js';
import { isApp } from './native.js';

// =====================================================================
// Service Worker 등록 + 새 버전 알림
//  - 배포 후 사용자가 앱을 열거나 다시 화면으로 돌아오면 새 버전을 확인
//  - 새 버전이 있으면 하단 배너로 안내하고, 사용자가 누를 때만 교체 (입력 중 데이터 보호)
//  - 오프라인 변경 큐는 localStorage 에 있으므로 새로고침해도 사라지지 않음
// =====================================================================

const CHECK_INTERVAL = 60 * 60 * 1000;   // 열어둔 상태에서는 1시간마다 확인

export function setupPWA() {
  // 안드로이드 앱은 서비스 워커 없이 화면 묶음 업데이트(lib/native.js)를 씀
  if (import.meta.env.VITE_APP === '1' || isApp() || !('serviceWorker' in navigator)) return;

  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      showUpdateBanner(() => updateSW(true));
    },
    onOfflineReady() {
      toast('오프라인에서도 앱을 열 수 있게 준비됐어요.');
    },
    onRegisteredSW(_url, registration) {
      if (!registration) return;
      const check = () => {
        if (navigator.onLine && registration.installing == null) registration.update().catch(() => {});
      };
      setInterval(check, CHECK_INTERVAL);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check();
      });
    },
  });
}

function showUpdateBanner(onReload) {
  showUpdateBar({ text: '새 버전이 있어요.', action: '새로고침', run: onReload });
}

// 아래쪽 안내 띠 (웹: 새 버전 / 앱: 새 화면 묶음 · 앱 업데이트 안내)
export function showUpdateBar({ text, action, run }) {
  let el = document.getElementById('update-banner');
  if (!el) {
    el = document.createElement('div');
    el.id = 'update-banner';
    el.className = 'fixed left-0 right-0 max-w-md mx-auto px-3 z-[55]';
    el.style.bottom = 'calc(5rem + var(--sab))';
    document.body.appendChild(el);
  }
  setHTML(el, html`
    <div class="glass-card bg-night-950/95 border border-neon-cyan/50 rounded-2xl px-3 py-2.5 flex items-center gap-2 shadow-2xl">
      <i class="fa-solid fa-rotate text-neon-cyan"></i>
      <span class="flex-1 text-xs text-slate-200">${text}</span>
      <button data-later class="text-[11px] text-slate-400 px-2">나중에</button>
      <button data-reload class="px-3 py-1.5 rounded-xl bg-neon-cyan text-night-950 text-[11px] font-black">${action}</button>
    </div>`);
  el.querySelector('[data-reload]').onclick = () => { el.remove(); run(); };
  el.querySelector('[data-later]').onclick = () => el.remove();
}
