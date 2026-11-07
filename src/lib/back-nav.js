// 휴대폰 뒤로가기(제스처 · 버튼) 처리
//  - 바텀시트를 열면 방문 기록을 하나 추가 → 뒤로가기는 시트만 닫음
//  - 여행 안의 탭 전환은 기록을 바꿔치기(replace) → 뒤로가기 한 번이면 홈 (trip.js)
//  - 홈에서는 "한 번 더 누르면 종료" (2초 안에 한 번 더 누르면 나감)
//
//  기록 구조 (홈): [홈] [홈 · guard]  ← 평소에는 guard 위에 있음
//    뒤로 1번 → [홈] 으로 내려옴 → 안내 토스트, 2초 뒤 guard 다시 올림
//    2초 안에 한 번 더 → 앱 밖으로 나감 (더 내려갈 기록이 없음)

let sheetOpen = false;
let closeSheetQuietly = null;   // 기록을 건드리지 않고 시트만 닫는 함수 (ui.js)
let ignorePops = 0;             // 우리가 직접 history.back() 한 횟수
let exitTimer = null;
let hint = () => {};

const state = () => (typeof history !== 'undefined' && history.state) || {};
const isHome = () => (location.hash.replace(/^#/, '') || '/') === '/';
export const isStandalone = () => typeof matchMedia !== 'undefined'
  && (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true);

// ---------- 바텀시트 ----------
export function sheetOpened(quietClose) {
  closeSheetQuietly = quietClose;
  if (sheetOpen) return;           // 시트 안에서 다른 시트로 바뀐 경우 기록은 그대로
  sheetOpen = true;
  if (!state().sheet) history.pushState({ ...state(), sheet: true }, '');
}

// 닫기 버튼 · 바깥 누르기 · 코드에서 closeSheet() → 시트용 기록도 하나 되돌림
export function sheetClosedByApp() {
  if (!sheetOpen) return;
  sheetOpen = false;
  if (state().sheet) { ignorePops++; history.back(); }
}

// 다른 화면으로 이동하면서 시트가 닫힌 경우 (기록은 navigate 가 바꿔치기)
export function sheetClosedByRoute() { sheetOpen = false; }
export const sheetIsOpen = () => sheetOpen;

// ---------- 시트 위에 한 겹 더 (장소 고르기 창 등) ----------
let pickerOpen = false;
let closePickerQuietly = null;
export function pickerOpened(quietClose) {
  closePickerQuietly = quietClose;
  if (pickerOpen) return;
  pickerOpen = true;
  history.pushState({ ...state(), picker: true }, '');
}
export function pickerClosedByApp() {
  if (!pickerOpen) return;
  pickerOpen = false;
  if (state().picker) { ignorePops++; history.back(); }
}

// ---------- 홈: 한 번 더 누르면 종료 ----------
function armGuard() {
  if (isHome() && !state().guard && !state().sheet) history.pushState({ guard: true }, '');
}

export function installBackNav({ onExitHint }) {
  hint = onExitHint || hint;
  window.addEventListener('popstate', () => {
    if (pickerOpen && !state().picker) {   // 맨 위 창부터 닫음
      pickerOpen = false;
      closePickerQuietly?.();
      return;
    }
    if (ignorePops > 0) {
      ignorePops--;
      // 닫자마자 새 시트를 연 경우: 그 시트용 기록을 다시 올림
      if (sheetOpen && !state().sheet) history.pushState({ ...state(), sheet: true }, '');
      return;
    }
    if (sheetOpen && !state().sheet) {
      sheetOpen = false;
      closeSheetQuietly?.();
      return;
    }
    if (isHome() && !state().guard) {
      hint(isStandalone() ? '한 번 더 누르면 종료돼요.' : '한 번 더 누르면 앱에서 나가요.');
      clearTimeout(exitTimer);
      exitTimer = setTimeout(() => { exitTimer = null; armGuard(); }, 2000);
    }
  });
  // 화면이 바뀔 때마다 (router.js 가 보냄)
  window.addEventListener('app:rendered', () => {
    if (isHome()) { try { sessionStorage.removeItem(FROM_HOME); } catch { /* 무시 */ } }
    if (!exitTimer) armGuard();
  });
  armGuard();
}

// 여행 화면의 [←]: 홈에서 들어왔으면 기록을 되돌리고(쌓이지 않게), 아니면 홈으로 바꿔치기
const FROM_HOME = 'nav:fromHome';
export function markFromHome() { try { sessionStorage.setItem(FROM_HOME, '1'); } catch { /* 무시 */ } }
export function backToHome(navigate) {
  let fromHome = false;
  try { fromHome = sessionStorage.getItem(FROM_HOME) === '1'; sessionStorage.removeItem(FROM_HOME); } catch { /* 무시 */ }
  if (fromHome && history.length > 1) history.back();
  else navigate('/', { replace: true });
}
