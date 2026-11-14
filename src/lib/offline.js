// =====================================================================
// 오프라인 보조 데이터 (화면·서버와 무관한 순수 로직 → 테스트 가능)
//  - 여행 목록 저장: 사용자별 (다른 계정의 여행이 섞이지 않게)
//  - 여행별 마지막으로 받은 시각 색인 (큰 캐시를 열지 않고 확인)
//  - 자동 미리 받기 대상 고르기
// =====================================================================

export const LIST_PREFIX = 'trips-list:v1:';
export const SYNC_INDEX_KEY = 'trip-sync-index:v1';
export const CACHE_PREFIX = 'trip-cache:v1:';
export const OUTBOX_PREFIX = 'trip-outbox:v1:';

export const PREFETCH_DAYS_BEFORE = 7;          // 출발 7일 전부터 자동으로 받아 둠
export const STALE_MS = 30 * 60 * 1000;         // 마지막으로 받은 지 30분이 넘으면 다시 받음
export const PAST_KEEP_DAYS = 30;               // 끝난 지 30일 넘은 여행은 자동 최신화 안 함
export const PREFETCH_MAX = 8;                  // 한 번에 받는 여행 수

const LS = () => globalThis.localStorage;
const readJSON = (store, key, fallback) => {
  try { const v = store?.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
};

// ---------------------------------------------------------- 여행 목록
export function saveTripList(userId, trips, now = Date.now(), store = LS()) {
  if (!userId || !Array.isArray(trips)) return;
  try { store.setItem(LIST_PREFIX + userId, JSON.stringify({ at: now, trips })); } catch {}
}
export function loadTripList(userId, store = LS()) {
  if (!userId) return null;
  const v = readJSON(store, LIST_PREFIX + userId, null);
  return v && Array.isArray(v.trips) ? v : null;
}

// ---------------------------------------------------------- 받은 시각 색인
export function readSyncIndex(store = LS()) {
  const v = readJSON(store, SYNC_INDEX_KEY, {});
  return v && typeof v === 'object' ? v : {};
}
export function markSynced(tripId, userId, at = Date.now(), store = LS()) {
  if (!tripId) return;
  const idx = readSyncIndex(store);
  idx[tripId] = { at, uid: userId ?? null };
  try { store.setItem(SYNC_INDEX_KEY, JSON.stringify(idx)); } catch {}
}

export const hasCache = (tripId, store = LS()) => !!store?.getItem(CACHE_PREFIX + tripId);
export function hasOutbox(tripId, store = LS()) {
  const v = store?.getItem(OUTBOX_PREFIX + tripId);
  return !!v && v !== '[]';
}

// 목록을 한 번도 못 받은 기기(이전 버전)용: 여행 캐시에서 목록을 만듦. 다른 사용자 것은 제외
export function tripsFromCaches(userId, store = LS()) {
  const out = [];
  const idx = readSyncIndex(store);
  for (let i = 0; i < (store?.length || 0); i++) {
    const k = store.key(i);
    if (!k?.startsWith(CACHE_PREFIX)) continue;
    const c = readJSON(store, k, null);
    const t = c?.trip;
    if (!t) continue;
    const owner = c.userId ?? idx[t.id]?.uid ?? null;
    if (owner && userId && owner !== userId) continue;
    const me = (c.members || []).find((m) => m.user_id && m.user_id === userId && !m.removed_at);
    out.push({
      trip_id: t.id, title: t.title, destination: t.destination, start_date: t.start_date, end_date: t.end_date,
      cover_emoji: t.cover_emoji, my_role: me?.role ?? null,
      member_count: (c.members || []).filter((m) => !m.removed_at).length || null,
    });
  }
  return out.sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
}

// ---------------------------------------------------------- 날짜
const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function addDays(dateStr, n) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

// ongoing: 진행 중 · soon: 출발 7일 전 이내 · past: 끝남 · later: 그보다 먼 미래(또는 날짜 없음)
export function tripPhase(trip, today) {
  const s = trip?.start_date; const e = trip?.end_date || s;
  if (!s) return 'later';
  if (today >= s && today <= e) return 'ongoing';
  if (today < s && today >= addDays(s, -PREFETCH_DAYS_BEFORE)) return 'soon';
  if (today > e) return 'past';
  return 'later';
}

// 자동으로 받을 여행 고르기 (순서: 보낼 변경 있음 → 진행 중 → 곧 출발 → 나머지)
//  - 보낼 변경이 남은 여행은 항상 (오프라인에서 고친 걸 먼저 보내야 하므로)
//  - 진행 중 · 곧 출발: 저장된 적 없어도 받음 (30분 지났으면 다시)
//  - 그 외: 이 기기에 저장된 여행만, 30분 지났고, 끝난 지 30일 이내일 때
export function pickPrefetch(trips, { today, now, index = {}, outbox = () => false, cached = () => false, openIds = new Set(), max = PREFETCH_MAX } = {}) {
  const rows = [];
  for (const t of trips || []) {
    const id = t.trip_id || t.id;
    if (!id || openIds.has(id)) continue;
    const pending = outbox(id);
    const phase = tripPhase(t, today);
    const last = index[id]?.at;
    const stale = !last || now - last > STALE_MS;
    const recent = phase !== 'past' || (t.end_date || t.start_date) >= addDays(today, -PAST_KEEP_DAYS);
    const take = pending
      || ((phase === 'ongoing' || phase === 'soon') && stale)
      || (cached(id) && stale && recent);
    if (!take) continue;
    const rank = pending ? 0 : phase === 'ongoing' ? 1 : phase === 'soon' ? 2 : 3;
    rows.push({ id, rank, start: t.start_date || '9999' });
  }
  rows.sort((a, b) => a.rank - b.rank || a.start.localeCompare(b.start));
  return rows.slice(0, max).map((r) => r.id);
}

// "방금 / 5분 전 / 3시간 전 / 2일 전"
export function agoText(at, now = Date.now()) {
  if (!at) return '';
  const m = Math.floor((now - at) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
