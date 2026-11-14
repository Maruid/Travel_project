// =====================================================================
// 연결 상태 알림 (흔들림 방지)
//  - 약한 신호에서 online/offline 이 연달아 바뀌어도 1.5초 동안 유지된 상태만 알림
//  - navigator.onLine 이 true 여도 실제 인터넷이 안 될 수 있음 → 서버 확인은 각자 시간 제한으로
// =====================================================================

const STABLE_MS = 1500;
const listeners = new Set();
let stable = typeof navigator !== 'undefined' ? navigator.onLine : true;
let timer = null;

function check() {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const now = navigator.onLine;
    if (now === stable) return;
    stable = now;
    listeners.forEach((fn) => { try { fn(now); } catch (e) { console.error(e); } });
  }, STABLE_MS);
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', check);
  window.addEventListener('offline', check);
}

export const isStableOnline = () => stable;

// fn(online: boolean) · 반환값을 부르면 해제
export function onConnectionChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
