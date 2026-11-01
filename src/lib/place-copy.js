// 다른 여행의 장소를 지금 여행으로 복사할 때 쓰는 순수 함수들 (DB 접근 없음)

// 복사하는 칸 (id, trip_id, 작성 기록, 삭제 표시, 위치 검토 기록은 제외)
export const COPY_COLUMNS = [
  'name', 'zone', 'lat', 'lng', 'signature', 'description', 'visit_tip', 'warn_badge',
  'price_min', 'price_max', 'price_currency', 'source', 'youtube_url', 'maps_url', 'map_query', 'is_anchor',
  'google_place_id', 'opening_hours', 'rating', 'rating_count', 'business_status', 'phone', 'website', 'google_synced_at',
];

// 이름 비교용: 공백·기호 제거, 소문자
export const normName = (s) => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

// 이미 지금 여행에 있는 장소인지 (구글 장소 ID 가 같거나, 이름이 같거나)
export function duplicateChecker(targetPlaces) {
  const ids = new Set(targetPlaces.map((p) => p.google_place_id).filter(Boolean));
  const names = new Set(targetPlaces.map((p) => normName(p.name)).filter(Boolean));
  return (p) => (p.google_place_id && ids.has(p.google_place_id)) || names.has(normName(p.name));
}

/**
 * 원본 카테고리 → 지금 여행 카테고리 대응표
 *  - 기본 카테고리(trip_id 없음): 같은 id 그대로
 *  - 커스텀: 지금 여행에 같은 이름이 있으면 그것, 없으면 새로 만들기 (커스텀 허용일 때)
 *            커스텀이 꺼져 있으면 같은 종류(kind)의 기본 카테고리, 그것도 없으면 미분류
 * @returns Map<srcCategoryId, { id } | { create: {name, kind, icon, color} } | { id: null }>
 */
export function planCategories(usedIds, { sourceCats, targetCustom, globals, allowCustom }) {
  const globalIds = new Set(globals.map((c) => c.id));
  const plan = new Map();
  for (const id of usedIds) {
    if (!id) continue;
    if (globalIds.has(id)) { plan.set(id, { id }); continue; }
    const src = sourceCats.find((c) => c.id === id);
    if (!src) { plan.set(id, { id: null }); continue; }
    const same = targetCustom.find((c) => normName(c.name) === normName(src.name));
    if (same) { plan.set(id, { id: same.id }); continue; }
    if (allowCustom) {
      plan.set(id, { create: { name: src.name, kind: src.kind, icon: src.icon, color: src.color } });
      continue;
    }
    plan.set(id, { id: globals.find((g) => g.kind === src.kind)?.id ?? null });
  }
  return plan;
}

export function copyRow(p, categoryId) {
  const row = { category_id: categoryId ?? null };
  for (const k of COPY_COLUMNS) row[k] = p[k] ?? null;
  row.is_anchor = !!p.is_anchor;
  return row;
}
