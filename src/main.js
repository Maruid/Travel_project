import './styles.css';
import { route, startRouter } from './router.js';
import { supabase } from './lib/supabase.js';
import { consumeReturn, readAuthError, setupAuthConnection } from './lib/auth.js';
import { startAutoPrefetch } from './lib/prefetch.js';
import { setupPWA, showUpdateBar } from './lib/pwa.js';
import { initApp } from './lib/native.js';
import { toast } from './components/ui.js';
import { installBackNav } from './lib/back-nav.js';
import { setupInstall } from './lib/install.js';

setupAuthConnection();   // 오프라인이면 토큰 자동 갱신 멈춤, 다시 연결되면 바로 갱신
setupPWA();
setupInstall();   // 앱 설치 신호를 일찍 받아 둠 (홈 · 설정의 [설치] 버튼)

route('/', () => import('./views/home.js'));
route('/create', () => import('./views/create.js'));
route('/join/:token', () => import('./views/join.js'));
route('/trip/:id/:tab?', () => import('./views/trip.js'));
route('/admin', () => import('./views/admin.js'));
route('/view/:token', () => import('./views/view.js'));   // 보기 전용 공유 링크 (로그인 없음)

async function boot() {
  // 안드로이드 앱: 로그인 복귀(딥링크) · 화면 묶음 업데이트 (웹에서는 아무것도 안 함)
  await initApp({ supabase, toast, showBar: showUpdateBar });

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
  installBackNav({ onExitHint: (text) => toast(text) });
  startAutoPrefetch();     // 진행 중 · 곧 출발 여행 미리 받기 + 저장된 여행 최신화
}

boot().catch((e) => {
  console.error(e);
  document.getElementById('app').textContent = '앱을 시작하지 못했습니다. 새로고침 해주세요.';
});

