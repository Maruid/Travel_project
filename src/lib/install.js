// 앱 설치 (PWA) + 화면 진단
//  - 크롬이 "설치할 수 있다"고 판단하면 beforeinstallprompt 를 줌 → 저장해 두고 우리 버튼에서 바로 설치 창을 띄움
//    (크롬 메뉴의 "홈 화면에 추가"는 바로가기/설치를 고르게 하지만, 이 방법은 설치 창이 바로 뜸)
//  - 아이폰은 이 이벤트가 없어서 "공유 → 홈 화면에 추가" 안내
//  - 이미 설치된 앱으로 열었으면 아무것도 보여주지 않음
import { html } from './dom.js';
import { isStandalone } from './back-nav.js';
import { isApp } from './native.js';

let deferred = null;
const DISMISS_KEY = 'install:dismissedAt';
const DISMISS_DAYS = 30;

export function setupInstall() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();          // 크롬 기본 안내(작은 띠) 대신 우리 버튼으로
    deferred = e;
    window.dispatchEvent(new Event('app:installable'));
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    window.dispatchEvent(new Event('app:installable'));
  });
}

export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone() && !isApp();
export const canInstall = () => !!deferred && !isStandalone() && !isApp();

export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const e = deferred;
  deferred = null;               // 한 번만 쓸 수 있음
  e.prompt();
  const { outcome } = await e.userChoice.catch(() => ({ outcome: 'dismissed' }));
  window.dispatchEvent(new Event('app:installable'));
  return outcome;                // 'accepted' | 'dismissed'
}

// 홈 위쪽 안내 띠: [닫기] 하면 이 기기에서 30일 동안 안 보임
export function bannerDismissed() {
  try { return Date.now() - Number(localStorage.getItem(DISMISS_KEY) || 0) < DISMISS_DAYS * 864e5; } catch { return false; }
}
export function dismissBanner() {
  try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* 무시 */ }
}

export function installBannerHtml() {
  if (isApp() || isStandalone() || bannerDismissed()) return '';
  if (canInstall()) {
    return html`
      <div class="flex items-center gap-2 p-3 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/40 text-[11px]">
        <i class="fa-solid fa-mobile-screen-button text-neon-cyan"></i>
        <span class="flex-1 text-slate-200">앱으로 설치하면 주소창 없이 넓게 써요.</span>
        <button data-action="install" class="flex-shrink-0 px-3 py-1.5 rounded-lg bg-neon-cyan text-night-950 font-black">설치</button>
        <button data-action="install-dismiss" class="flex-shrink-0 w-6 h-6 text-slate-400" title="닫기"><i class="fa-solid fa-xmark"></i></button>
      </div>`;
  }
  if (isIOS()) {
    return html`
      <div class="flex items-center gap-2 p-3 rounded-2xl bg-neon-cyan/10 border border-neon-cyan/40 text-[11px]">
        <i class="fa-solid fa-mobile-screen-button text-neon-cyan"></i>
        <span class="flex-1 text-slate-200">Safari 아래 <i class="fa-solid fa-arrow-up-from-bracket"></i> 공유 → "홈 화면에 추가"로 앱처럼 쓸 수 있어요.</span>
        <button data-action="install-dismiss" class="flex-shrink-0 w-6 h-6 text-slate-400" title="닫기"><i class="fa-solid fa-xmark"></i></button>
      </div>`;
  }
  return '';
}

// ---------- 화면 진단 (설정 탭 "화면 정보") ----------
// 상태바·제스처 바 영역(safe-area)은 CSS env() 로만 알 수 있어서 보이지 않는 요소로 재서 읽음
function probe(css) {
  const d = document.createElement('div');
  d.style.cssText = `position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;${css}`;
  document.body.appendChild(d);
  const r = { w: d.offsetWidth, h: d.offsetHeight };
  d.remove();
  return r;
}
export function screenInfo() {
  const inset = (side) => probe(`padding-${side}:var(--sa${side[0]});width:0;height:0;box-sizing:content-box`);
  const top = inset('top').h; const bottom = inset('bottom').h;
  const chrome = navigator.userAgent.match(/Chrome\/([\d.]+)/)?.[1] || '-';
  const doc = document.documentElement;
  return {
    mode: isApp() ? '안드로이드 앱' : isStandalone() ? '설치형 앱' : '브라우저 탭',
    viewport: `${window.innerWidth} × ${window.innerHeight}`,
    visual: window.visualViewport ? `${Math.round(visualViewport.width)} × ${Math.round(visualViewport.height)} (배율 ${visualViewport.scale.toFixed(2)})` : '-',
    dvh: `${probe('height:100dvh;width:1px').h} / svh ${probe('height:100svh;width:1px').h}`,
    screen: `${screen.width} × ${screen.height} · DPR ${window.devicePixelRatio}`,
    safe: `위 ${top}px · 아래 ${bottom}px`,
    overflow: doc.scrollWidth > window.innerWidth + 1 ? `옆으로 넘침 ${doc.scrollWidth - window.innerWidth}px` : '없음',
    chrome,
    installable: canInstall() ? '설치 가능' : isStandalone() ? '설치됨' : '설치 신호 없음',
  };
}
export const SCREEN_LABEL = {
  mode: '실행 방식', viewport: '화면 (CSS px)', visual: '보이는 영역', dvh: '100dvh', screen: '기기 화면',
  safe: '상태바·제스처 바 영역', overflow: '가로 넘침', chrome: '크롬 버전', installable: '설치',
};
