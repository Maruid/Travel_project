import { TripStore } from './store.js';
import { getUser, sessionReady } from './auth.js';
import { loadTripList, readSyncIndex, hasOutbox, hasCache, pickPrefetch, localDate } from './offline.js';
import { onConnectionChange } from './net.js';

// =====================================================================
// 여행 자동 미리 받기 · 최신화 (앱이 열려 있는 동안)
//  - 언제: 앱을 열 때 · 다시 연결됐을 때 · 앱으로 돌아왔을 때(5분 간격) · 홈 목록을 새로 받았을 때
//  - 무엇: 진행 중 · 출발 7일 전 여행(저장된 적 없어도) + 이 기기에 저장된 여행 중 30분 넘게 지난 것
//  - 어떻게: 하나씩 차례로. 보낼 변경이 있으면 먼저 보내고(실패하면 받지 않음) 받아서 저장
//  - 지금 보고 있는 여행은 건너뜀 (그 화면이 실시간으로 맞추는 중). 받는 중에 그 여행을 열면 끝날 때까지 기다림
// =====================================================================

const RERUN_GAP = 5 * 60 * 1000;
const open = new Set();
const running = new Map();   // tripId → Promise
let loop = null;
let lastRun = 0;
let timer = null;

export const markOpen = (id) => open.add(id);
export const markClosed = (id) => open.delete(id);
// 그 여행을 받는 중이면 끝날 때까지 (두 곳에서 같은 보낼 변경 목록을 동시에 고치지 않게)
export const whenIdle = (id) => running.get(id) || Promise.resolve();

export function schedulePrefetch(delay = 1500) {
  clearTimeout(timer);
  timer = setTimeout(() => { runPrefetch(); }, delay);
}

export function runPrefetch() {
  if (loop) return loop;
  loop = (async () => {
    if (!navigator.onLine || !(await sessionReady())) return;
    const user = await getUser();
    if (!user || user.offline) return;
    const list = loadTripList(user.id)?.trips;
    if (!list?.length) return;
    const ids = pickPrefetch(list, {
      today: localDate(), now: Date.now(), index: readSyncIndex(),
      outbox: (id) => hasOutbox(id), cached: (id) => hasCache(id), openIds: open,
    });
    let synced = 0;
    for (const id of ids) {
      if (!navigator.onLine) break;
      if (open.has(id)) continue;
      const p = syncOne(id, user.id);
      running.set(id, p);
      try { if (await p) synced++; } finally { running.delete(id); }
    }
    lastRun = Date.now();
    if (synced) window.dispatchEvent(new CustomEvent('app:trips-synced', { detail: { count: synced } }));
  })().catch((e) => console.warn('prefetch', e)).finally(() => { loop = null; });
  return loop;
}

async function syncOne(id, userId) {
  const s = new TripStore(id, userId, { headless: true });
  try {
    s.loadCache();
    const ok = await s.sync();
    if (ok) s.saveCacheNow();
    return ok;
  } catch (e) {
    console.warn('prefetch failed', id, e);
    return false;
  } finally {
    s.destroy();
  }
}

export function startAutoPrefetch() {
  onConnectionChange((online) => { if (online) schedulePrefetch(2000); });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && Date.now() - lastRun > RERUN_GAP) schedulePrefetch(2000);
  });
  schedulePrefetch(4000);   // 첫 화면이 다 그려진 뒤
}
