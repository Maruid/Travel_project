import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRoute, segmentInfo, directionsHref, nearestAnchor, totalText, circled } from '../src/lib/route-plan.js';

const P = {
  a: { id: 'a', name: 'A', lat: 34.6687, lng: 135.5013 },
  b: { id: 'b', name: 'B', lat: 34.6723, lng: 135.5013 },   // 약 400m 북
  c: { id: 'c', name: 'C', lat: 34.7025, lng: 135.4959 },   // 우메다 쪽 약 3.8km
  n: { id: 'n', name: '위치 없음', lat: null, lng: null },
};
const get = (id) => P[id];

test('장소 없는 일정·위치 없는 장소는 건너뛰고 같은 장소 연속은 하나로', () => {
  const items = [{ id: 1, place_id: 'a' }, { id: 2 }, { id: 3, place_id: 'a' }, { id: 4, place_id: 'n' }, { id: 5, place_id: 'b' }, { id: 6, place_id: 'c' }];
  const r = buildRoute(items, get);
  assert.deepEqual(r.stops.map((s) => s.place.id), ['a', 'b', 'c']);
  assert.deepEqual(r.stops[0].itemIds, [1, 3]);
  assert.equal(r.skipped, 1);
  assert.equal(r.segments.length, 2);
  assert.equal(r.segments[0].transit, false);
  assert.equal(r.segments[1].transit, true);
});

test('도보 시간: 직선 × 1.3 ÷ 75m/분, 1.5km 넘으면 전철 권장', () => {
  const s = segmentInfo(P.a, P.b);
  assert.ok(s.meters > 480 && s.meters < 560, String(s.meters));
  assert.equal(s.walkMin, Math.round(s.meters / 75));
  assert.match(s.text, /^약 도보 \d+분 \(\d+m\)$/);
  assert.match(segmentInfo(P.a, P.c).text, /^약 \d\.\dkm · 전철 권장$/);
});

test('숙소 출발·복귀', () => {
  const hotel = { id: 'h', name: '호텔', lat: 34.667, lng: 135.50 };
  const r = buildRoute([{ id: 1, place_id: 'a' }, { id: 2, place_id: 'b' }], get, { start: hotel, end: hotel });
  assert.equal(r.points.length, 4);
  assert.equal(r.points[0].edge, 'start');
  assert.equal(r.segments.length, 3);
  assert.equal(nearestAnchor([P.c, hotel], P.a).id, 'h');
  assert.equal(buildRoute([], get, { start: hotel }).segments.length, 0);
});

test('길찾기 링크와 합계', () => {
  const u = new URL(directionsHref({ ...P.a, google_place_id: 'G1' }, P.b));
  assert.equal(u.searchParams.get('travelmode'), 'walking');
  assert.equal(u.searchParams.get('origin_place_id'), 'G1');
  assert.equal(u.searchParams.get('destination'), '34.6723,135.5013');
  assert.match(totalText([segmentInfo(P.a, P.b), segmentInfo(P.b, P.c)]), /^약 [0-9.]+km · 걷기 [0-9]+분 · 전철 1구간$/);
  assert.equal(circled(3), '③');
});
