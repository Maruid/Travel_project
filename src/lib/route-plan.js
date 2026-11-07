// 하루 동선: 일정 순서대로 장소를 잇고 구간마다 대략 걸리는 시간
// 실제 길 대신 직선 거리 × 1.3 을 분당 75m 로 걸었을 때로 어림 (외부 API 없음)
import { distanceKm } from './format.js';

export const DETOUR = 1.3;          // 직선 → 실제 길 보정
export const WALK_M_PER_MIN = 75;
export const TRANSIT_OVER_M = 1500;  // 이보다 멀면 전철·버스 권장

const located = (p) => p && p.lat != null && p.lng != null;

// items: 화면에 보이는 순서의 일정, getPlace: id → 장소, start/end: 숙소 같은 출발·도착 (선택)
// hotelIds: 그날 숙소 장소 id → 일정에 연결돼 있어도 번호를 붙이지 않고 숙소 지점(edge 'stay')으로
export function buildRoute(items, getPlace, { start = null, end = null, hotelIds = new Set() } = {}) {
  const seq = [];      // 화면 순서대로 지점 (번호 장소 + 숙소 지점)
  const stops = [];    // 번호 붙는 장소만
  let skipped = 0;
  for (const it of items) {
    const p = it.place_id ? getPlace(it.place_id) : null;
    if (!located(p)) { if (it.place_id) skipped++; continue; }
    // 같은 장소가 연달아 나오면 한 번만 (점심 → 같은 곳 디저트 등)
    const last = seq[seq.length - 1];
    if (last && last.place.id === p.id) { last.itemIds.push(it.id); continue; }
    if (hotelIds.has(p.id)) { seq.push({ place: p, itemIds: [it.id], no: null, edge: 'stay' }); continue; }
    const st = { place: p, itemIds: [it.id], no: stops.length + 1 };
    stops.push(st); seq.push(st);
  }
  const pts = [];
  // 숙소에서 출발 · 숙소로 도착: 일정의 첫 · 마지막 지점이 그 숙소면 따로 붙이지 않음
  if (located(start) && stops.length && seq[0]?.place.id !== start.id) pts.push({ place: start, no: null, edge: 'start' });
  pts.push(...seq);
  if (located(end) && stops.length && seq[seq.length - 1]?.place.id !== end.id) pts.push({ place: end, no: null, edge: 'end' });
  const segments = [];
  for (let i = 1; i < pts.length; i++) segments.push({ from: pts[i - 1], to: pts[i], ...segmentInfo(pts[i - 1].place, pts[i].place) });
  return { stops, points: pts, segments, skipped };
}

export function segmentInfo(a, b) {
  const straight = distanceKm(a, b) * 1000;
  const meters = Math.round(straight * DETOUR);
  const transit = meters > TRANSIT_OVER_M;
  const walkMin = Math.max(1, Math.round(meters / WALK_M_PER_MIN));
  const text = transit
    ? `약 ${(meters / 1000).toFixed(1)}km · 전철 권장`
    : `약 도보 ${walkMin}분${meters >= 100 ? ` (${meters < 1000 ? `${Math.round(meters / 10) * 10}m` : `${(meters / 1000).toFixed(1)}km`})` : ''}`;
  return { meters, walkMin, transit, text };
}

// 구글 지도 길찾기 링크 (가까우면 도보, 멀면 대중교통)
export function directionsHref(a, b, transit = false) {
  const pt = (p) => (p.google_place_id ? { q: p.name, id: p.google_place_id } : { q: `${p.lat},${p.lng}` });
  const o = pt(a); const d = pt(b);
  const u = new URLSearchParams({ api: '1', origin: o.q, destination: d.q, travelmode: transit ? 'transit' : 'walking' });
  if (o.id) u.set('origin_place_id', o.id);
  if (d.id) u.set('destination_place_id', d.id);
  return `https://www.google.com/maps/dir/?${u}`;
}

// 하루 첫 장소에서 가장 가까운 기준점(숙소) — 여러 도시를 도는 여행에서도 맞는 숙소를 고르도록
export function nearestAnchor(anchors, near) {
  if (!near) return null;
  let best = null; let bd = Infinity;
  for (const a of anchors) {
    if (!located(a)) continue;
    const d = distanceKm(a, near);
    if (d < bd) { bd = d; best = a; }
  }
  return best;
}

export function totalText(segments) {
  if (!segments.length) return '';
  const walk = segments.filter((s) => !s.transit);
  const min = walk.reduce((n, s) => n + s.walkMin, 0);
  const km = segments.reduce((n, s) => n + s.meters, 0) / 1000;
  const transit = segments.length - walk.length;
  return `약 ${km.toFixed(1)}km${min ? ` · 걷기 ${min}분` : ''}${transit ? ` · 전철 ${transit}구간` : ''}`;
}

export const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩', '⑪', '⑫', '⑬', '⑭', '⑮', '⑯', '⑰', '⑱', '⑲', '⑳'];
export const circled = (n) => CIRCLED[n - 1] || `(${n})`;

// ---------- 날짜별 숙소 (migration_013 itinerary_days.stay_place_id) ----------
const prevDate = (d) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };

// 그날 밤 묵는 숙소: 그 날짜까지 중 가장 최근에 정한 값 (비워둔 날은 앞 날이 이어짐)
//  stay_none(이 날 밤 숙소 없음, migration_014)도 "정한 값" → 다음에 숙소를 고를 때까지 숙소 없음
//  validId(id): 지금도 있는 장소인지 (지운 장소는 건너뜀)
const hasStayChoice = (d, validId) => !d.deleted_at && (d.stay_none || (d.stay_place_id && validId(d.stay_place_id)));
export function stayFor(dayRows, date, validId = () => true) {
  let best = null;
  for (const d of dayRows) {
    if (d.day_date > date || !hasStayChoice(d, validId)) continue;
    if (!best || d.day_date > best.day_date) best = d;
  }
  if (!best) return null;
  return { placeId: best.stay_none ? null : best.stay_place_id, none: !!best.stay_none, inherited: best.day_date !== date };
}

// 그날 동선의 출발 · 도착 숙소: 출발은 전날 밤 숙소(없으면 그날 숙소), 도착은 그날 밤 숙소
//  - 체크아웃하고 다른 숙소로 옮기는 날은 둘이 달라짐
//  - 여행 마지막 날(lastDate)은 그날 정한 값이 없으면 자동으로 "숙소 없음" (돌아오지 않음)
export function dayStays(dayRows, date, validId = () => true, { lastDate = null } = {}) {
  let tonight = stayFor(dayRows, date, validId);
  const lastNight = stayFor(dayRows, prevDate(date), validId);
  const explicitToday = dayRows.some((d) => d.day_date === date && hasStayChoice(d, validId));
  const autoLast = !!lastDate && date === lastDate && !explicitToday;
  if (autoLast) tonight = null;
  const startId = lastNight?.placeId || tonight?.placeId || null;
  const endId = tonight?.placeId || null;
  return {
    start: startId,
    end: endId,
    inherited: !!tonight?.inherited,
    moved: !!(lastNight?.placeId && endId && lastNight.placeId !== endId),
    none: !endId && !!(tonight?.none || autoLast),
    autoLast,
  };
}

// ---------- 동선 색 ----------
// 구간 순서대로 하늘색 → 보라 → 빨강으로 바뀌는 색 (어디서 시작해 어디서 끝나는지 보이게)
const STOPS = [[34, 211, 238], [167, 139, 250], [244, 63, 94]];
export function segColor(i, n) {
  const t = n <= 1 ? 0 : i / (n - 1);
  const seg = t <= 0.5 ? 0 : 1;
  const k = seg === 0 ? t / 0.5 : (t - 0.5) / 0.5;
  const [a, b] = [STOPS[seg], STOPS[seg + 1]];
  return '#' + a.map((v, j) => Math.round(v + (b[j] - v) * k).toString(16).padStart(2, '0')).join('');
}
export const HOTEL_COLOR = '#f59e0b';
