// 장소 탭 필터 (카테고리 여러 개 · 안 간 곳만 · 찜) 와 이름 검색
// 화면 코드와 분리해 테스트할 수 있게 둠

export const KIND_LABEL = { food: '식당', cafe: '카페', bar: '술집', spot: '명소', shop: '쇼핑', lodging: '숙소', transit: '교통', etc: '기타' };
const KIND_ORDER = Object.keys(KIND_LABEL);

export const EMPTY_FILTER = Object.freeze({ cats: [], hideVisited: false, liked: false });

// 저장된 문자열 → 필터 (깨진 값이면 빈 필터)
export function parseFilter(raw, { hideVisited = false } = {}) {
  let v = null;
  try { v = raw ? JSON.parse(raw) : null; } catch { v = null; }
  const cats = Array.isArray(v?.cats) ? v.cats.filter((x) => typeof x === 'string').slice(0, 50) : [];
  return { cats, hideVisited: typeof v?.hideVisited === 'boolean' ? v.hideVisited : !!hideVisited, liked: !!v?.liked };
}
export function filterToString(f) {
  return JSON.stringify({ cats: f.cats, hideVisited: f.hideVisited, liked: f.liked });
}

// 켜진 조건 개수 (필터 버튼 숫자)
export function activeCount(f) {
  return f.cats.length + (f.hideVisited ? 1 : 0) + (f.liked ? 1 : 0);
}

// 없어진 카테고리 id 는 조용히 빼기
export function pruneFilter(f, validIds) {
  const cats = f.cats.filter((id) => validIds.has(id));
  return cats.length === f.cats.length ? f : { ...f, cats };
}

export function passesFilter(p, f, { likedIds } = {}) {
  if (f.cats.length && !f.cats.includes(p.category_id)) return false;
  if (f.hideVisited && p.visited_at) return false;
  if (f.liked && likedIds && !likedIds.has(p.id)) return false;
  return true;
}

// 검색어 비교용: 소문자, 공백·기호 제거, 전각 → 반각
export function normQuery(s) {
  return String(s ?? '').normalize('NFKC').toLowerCase().replace(/[\s·・\-_.,()[\]'"/]+/g, '');
}

// 이름 · 현지 이름(지도 검색어) · 동네 · 대표 메뉴 중 하나라도 검색어를 포함하면 맞음. 점수가 높을수록 위로
export function matchScore(p, q) {
  const nq = normQuery(q);
  if (!nq) return 0;
  const fields = [
    [p.name, 4], [p.map_query, 3], [p.zone, 2], [p.signature, 1],   // map_query 에 현지 이름이 들어 있음
  ];
  let best = 0;
  for (const [v, w] of fields) {
    const nv = normQuery(v);
    if (!nv) continue;
    const i = nv.indexOf(nq);
    if (i < 0) continue;
    const s = w * 10 + (i === 0 ? 5 : 0);
    if (s > best) best = s;
  }
  return best;
}

export function searchPlaces(places, q, limit = 20) {
  if (!normQuery(q)) return [];
  return places
    .map((p) => ({ p, s: matchScore(p, q) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || String(a.p.name).localeCompare(String(b.p.name), 'ko'))
    .slice(0, limit)
    .map((x) => x.p);
}

// 필터 창용: 쓰인 카테고리를 종류(식당·카페…)별로 묶고 개수 붙이기
export function groupCategories(categories, places) {
  const used = new Map();
  for (const p of places) used.set(p.category_id, (used.get(p.category_id) || 0) + 1);
  const groups = new Map();
  for (const c of categories) {
    if (!used.has(c.id)) continue;
    const k = KIND_LABEL[c.kind] ? c.kind : 'etc';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ ...c, count: used.get(c.id) });
  }
  const none = used.get(null) || used.get(undefined) || 0;
  return {
    groups: KIND_ORDER.filter((k) => groups.has(k)).map((k) => ({ kind: k, label: KIND_LABEL[k], cats: groups.get(k) })),
    uncategorized: none,
  };
}
