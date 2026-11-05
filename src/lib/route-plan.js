// 하루 동선: 일정 순서대로 장소를 잇고 구간마다 대략 걸리는 시간
// 실제 길 대신 직선 거리 × 1.3 을 분당 75m 로 걸었을 때로 어림 (외부 API 없음)
import { distanceKm } from './format.js';

export const DETOUR = 1.3;          // 직선 → 실제 길 보정
export const WALK_M_PER_MIN = 75;
export const TRANSIT_OVER_M = 1500;  // 이보다 멀면 전철·버스 권장

const located = (p) => p && p.lat != null && p.lng != null;

// items: 화면에 보이는 순서의 일정, getPlace: id → 장소, start/end: 숙소 같은 출발·도착 (선택)
export function buildRoute(items, getPlace, { start = null, end = null } = {}) {
  const stops = [];
  let skipped = 0;
  for (const it of items) {
    const p = it.place_id ? getPlace(it.place_id) : null;
    if (!located(p)) { if (it.place_id) skipped++; continue; }
    // 같은 장소가 연달아 나오면 한 번만 (점심 → 같은 곳 디저트 등)
    if (stops.length && stops[stops.length - 1].place.id === p.id) { stops[stops.length - 1].itemIds.push(it.id); continue; }
    stops.push({ place: p, itemIds: [it.id], no: stops.length + 1 });
  }
  const pts = [];
  if (located(start) && stops.length) pts.push({ place: start, no: null, edge: 'start' });
  pts.push(...stops);
  if (located(end) && stops.length) pts.push({ place: end, no: null, edge: 'end' });
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
