// =====================================================================
// 사진 규칙 (migration_017) — 순수 함수 (node 테스트). 올리기 · 받기는 images.js
// =====================================================================
export const PER_TARGET = 4;
export const PER_TRIP = 100;
export const DEFAULT_KEEP_DAYS = 30;
export const NOTICE_DAYS = 7;                   // 삭제 며칠 전부터 띠로 알림
export const TARGET_TABLE = { item: 'itinerary_items', guide: 'guides', todo: 'todos' };

// ---------------------------------------------------------- 순수 함수
const DAY = 86400000;
const toDate = (s) => new Date(`${s}T00:00:00Z`);
export function addDays(dateStr, n) {
  if (!dateStr) return null;
  return new Date(toDate(dateStr).getTime() + n * DAY).toISOString().slice(0, 10);
}
export function daysBetween(from, to) {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY);
}
// 사진 삭제일: 종료일 + 보관 일수 (이 날이 지나면 지움)
export const purgeDate = (endDate, keepDays = DEFAULT_KEEP_DAYS) => addDays(endDate, keepDays);

// 보관 안내 상태
//   none: 사진 없음 · during: 여행 전/중 · after: 끝남(삭제까지 여유) · soon: 삭제 7일 안 · purged: 지난 날
export function retention({ endDate, keepDays = DEFAULT_KEEP_DAYS, today, count = 0 }) {
  const purge = purgeDate(endDate, keepDays);
  if (!purge) return { state: count ? 'during' : 'none', purge: null, days: null };
  const days = daysBetween(today, purge);
  if (days < 0) return { state: 'purged', purge, days };
  if (!count) return { state: 'none', purge, days };
  if (endDate >= today) return { state: 'during', purge, days };
  return { state: days <= NOTICE_DAYS ? 'soon' : 'after', purge, days };
}

// 전송 단계에 따라 받아도 되는지 (서버 정책과 같은 기준)
export function canFetch(level, { thumb = false, kind = 'photo' } = {}) {
  if (level === 'blocked') return false;
  if (level === 'thumbs') return thumb || kind === 'doc';
  return true;
}

export const imagePaths = (tripId, id, ext = 'webp') => ({
  path: `${tripId}/${id}.${ext}`, thumb_path: `${tripId}/${id}_t.${ext}`,
});

// 대상(일정 · 가이드 · 할 일)에 붙은 사진: 지운 것 제외, 순서대로
export function imagesOf(rows, type, id) {
  return rows.filter((r) => r.target_type === type && r.target_id === id && !r.deleted_at)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.created_at).localeCompare(String(b.created_at)));
}

export function formatBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n}B`;
  if (n < 1048576) return `${Math.round(n / 1024)}KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(n < 10485760 ? 1 : 0)}MB`;
  return `${(n / 1073741824).toFixed(2)}GB`;
}

// 사진 미리 받기(썸네일 + 문서 원본) 대상: 출발 7일 전 ~ 종료일
export function prefetchWindow(trip, today) {
  if (!trip?.start_date || !trip?.end_date) return false;
  return today >= addDays(trip.start_date, -7) && today <= trip.end_date;
}
