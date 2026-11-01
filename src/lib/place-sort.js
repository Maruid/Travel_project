// 장소 목록 정렬 (거리 · 별점 · 가격)
//  - 정보가 없는 장소는 오름차순·내림차순 모두 맨 아래
//  - 별점: 리뷰가 적은 곳(MIN_REVIEWS 미만)은 별점이 높아도 리뷰가 충분한 곳 아래
//  - 가격: 싼 순은 최저가, 비싼 순은 최고가로 비교 (통화는 구분하지 않음)

export const MIN_REVIEWS = 20;

export const SORTS = {
  distance: { label: '거리',  defaultDir: 'asc',  dirLabel: { asc: '가까운 순', desc: '먼 순' } },
  rating:   { label: '별점',  defaultDir: 'desc', dirLabel: { desc: '별점 높은 순', asc: '별점 낮은 순' } },
  price:    { label: '가격',  defaultDir: 'asc',  dirLabel: { asc: '싼 순', desc: '비싼 순' } },
};
export const DEFAULT_SORT = { key: 'distance', dir: 'asc' };

const num = (v) => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v));

// 저장된 문자열 "rating:desc" → { key, dir } (잘못된 값이면 기본값)
export function parseSort(s) {
  const [key, dir] = String(s || '').split(':');
  return SORTS[key] && (dir === 'asc' || dir === 'desc') ? { key, dir } : { ...DEFAULT_SORT };
}
export const sortToString = (s) => `${s.key}:${s.dir}`;

// 칩을 눌렀을 때: 같은 칩이면 방향 반전, 다른 칩이면 그 기준의 기본 방향
export function nextSort(cur, key) {
  if (cur.key === key) return { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' };
  return { key, dir: SORTS[key].defaultDir };
}

// 행 하나의 정렬 값: { tier, v, tie }  (tier 가 작을수록 위, 같은 tier 안에서 v 를 방향대로 비교)
function sortValue(row, key, dir) {
  const p = row.p;
  if (key === 'distance') {
    const m = num(row.walk?.meters);
    return m == null ? { tier: 9 } : { tier: 0, v: m };
  }
  if (key === 'rating') {
    const r = num(p.rating);
    if (r == null) return { tier: 9 };
    const c = num(p.rating_count) ?? 0;
    return { tier: c >= MIN_REVIEWS ? 0 : 1, v: r, tie: c };
  }
  if (key === 'price') {
    const lo = num(p.price_min); const hi = num(p.price_max);
    const v = dir === 'asc' ? lo ?? hi : hi ?? lo;
    if (v == null) return { tier: 9 };
    return { tier: 0, v, tie: dir === 'asc' ? hi ?? lo : lo ?? hi };
  }
  return { tier: 0, v: 0 };
}

export function sortRows(rows, { key, dir } = DEFAULT_SORT) {
  const sign = dir === 'desc' ? -1 : 1;
  return rows
    .map((row, i) => ({ row, i, s: sortValue(row, key, dir) }))
    .sort((a, b) => {
      if (a.s.tier !== b.s.tier) return a.s.tier - b.s.tier;
      if (a.s.tier === 9) return a.i - b.i;
      if (a.s.v !== b.s.v) return (a.s.v - b.s.v) * sign;
      if (key === 'rating' && a.s.tie !== b.s.tie) return b.s.tie - a.s.tie;      // 별점 같으면 리뷰 많은 곳 먼저
      if (key === 'price' && a.s.tie != null && b.s.tie != null && a.s.tie !== b.s.tie) return (a.s.tie - b.s.tie) * sign;
      return a.i - b.i;
    })
    .map((x) => x.row);
}
