import './styles.css';
import { route, startRouter } from './router.js';
import { supabase } from './lib/supabase.js';
import { consumeReturn } from './lib/auth.js';
import { setupPWA } from './lib/pwa.js';

setupPWA();

route('/', () => import('./views/home.js'));
route('/create', () => import('./views/create.js'));
route('/join/:token', () => import('./views/join.js'));
route('/trip/:id/:tab?', () => import('./views/trip.js'));
route('/admin', () => import('./views/admin.js'));

async function boot() {
  // OAuth 복귀(?code=...) 처리: supabase-js 가 세션 교환을 끝낸 뒤 원래 경로로 이동
  if (new URLSearchParams(location.search).has('code')) {
    await supabase.auth.getSession();
    const back = consumeReturn();
    history.replaceState(null, '', location.pathname + (back || '#/'));
  }
  await startRouter();
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = '앱을 시작하지 못했습니다. 새로고침 해주세요.';
});

