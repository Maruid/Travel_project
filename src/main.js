import './styles.css';
import { route, startRouter } from './router.js';
import { supabase } from './lib/supabase.js';
import { consumeReturn, readAuthError } from './lib/auth.js';
import { setupPWA } from './lib/pwa.js';
import { toast } from './components/ui.js';

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

  // OAuth 실패 복귀(?error=...) 처리: 가장 흔한 경우는 이미 다른 사람(계정)에 연결된 Google 계정으로 "계정 연결"
  const authError = readAuthError();
  if (authError) {
    const back = consumeReturn();
    history.replaceState(null, '', location.pathname + (back || '#/'));
    const alreadyUsed = /identity_already_exists|already.*(linked|exists)/i.test(`${authError.code} ${authError.description}`);
    setTimeout(() => toast(alreadyUsed
      ? '이 Google 계정은 이미 사용 중이에요. 홈의 로그인 → "이미 다른 기기에서 Google 로 쓰고 있는 경우"를 선택하세요.'
      : `로그인에 실패했습니다: ${authError.description || authError.code}`, 'error'), 300);
  }
  await startRouter();
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = '앱을 시작하지 못했습니다. 새로고침 해주세요.';
});

