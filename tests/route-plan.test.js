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

test('날짜별 숙소: 비워둔 날은 이어짐, 옮기는 날은 출발·도착이 다름', async () => {
  const { stayFor, dayStays } = await import('../src/lib/route-plan.js');
  const rows = [
    { day_date: '2026-11-10', stay_place_id: 'osaka' },
    { day_date: '2026-11-11', title: '제목만' },
    { day_date: '2026-11-13', stay_place_id: 'kyoto' },
    { day_date: '2026-11-14', stay_place_id: 'gone' },
  ];
  assert.deepEqual(stayFor(rows, '2026-11-12'), { placeId: 'osaka', none: false, inherited: true });
  assert.equal(stayFor(rows, '2026-11-09'), null);
  assert.deepEqual(dayStays(rows, '2026-11-10'), { start: 'osaka', end: 'osaka', inherited: false, moved: false, none: false, autoLast: false });
  assert.deepEqual(dayStays(rows, '2026-11-13'), { start: 'osaka', end: 'kyoto', inherited: false, moved: true, none: false, autoLast: false });
  // 지운 장소는 건너뜀 → 교토가 이어짐
  assert.equal(dayStays(rows, '2026-11-14', (id) => id !== 'gone').end, 'kyoto');
});

test('구간 색: 처음 하늘색 → 가운데 보라 → 끝 빨강', async () => {
  const { segColor } = await import('../src/lib/route-plan.js');
  assert.equal(segColor(0, 5), '#22d3ee');
  assert.equal(segColor(2, 5), '#a78bfa');
  assert.equal(segColor(4, 5), '#f43f5e');
  assert.equal(segColor(0, 1), '#22d3ee');
  assert.match(segColor(1, 5), /^#[0-9a-f]{6}$/);
});

test('숙소 없음 · 마지막 날 자동 · 마지막 날 직접 고르면 그게 우선', async () => {
  const { dayStays } = await import('../src/lib/route-plan.js');
  const rows = [{ day_date: '2026-11-24', stay_place_id: 'h' }, { day_date: '2026-11-26', stay_none: true }, { day_date: '2026-11-27', stay_place_id: 'h2' }];
  // 야간 이동한 날: 출발은 h, 돌아오지 않음
  assert.deepEqual([dayStays(rows, '2026-11-26').start, dayStays(rows, '2026-11-26').end, dayStays(rows, '2026-11-26').none], ['h', null, true]);
  // 다음 날은 전날 밤 숙소가 없으니 그날 숙소에서 시작
  assert.equal(dayStays(rows, '2026-11-27').start, 'h2');
  // 마지막 날: 자동으로 돌아오지 않음
  const last = dayStays(rows, '2026-11-28', undefined, { lastDate: '2026-11-28' });
  assert.deepEqual([last.start, last.end, last.autoLast, last.none], ['h2', null, true, true]);
  // 마지막 날에 숙소를 직접 고르면 돌아옴 (레이트 체크아웃 · 데이유즈)
  const rows2 = [...rows, { day_date: '2026-11-28', stay_place_id: 'h2' }];
  assert.equal(dayStays(rows2, '2026-11-28', undefined, { lastDate: '2026-11-28' }).end, 'h2');
});

test('숙소에 연결된 일정은 번호 없이 숙소 지점, 첫·끝이 숙소면 출발·도착을 따로 안 붙임', async () => {
  const { buildRoute } = await import('../src/lib/route-plan.js');
  const H = { id: 'h', name: '호텔', lat: 34.665, lng: 135.5 };
  const get = (id) => ({ ...P, h: H })[id];
  const items = [{ id: 1, place_id: 'h' }, { id: 2, place_id: 'a' }, { id: 3, place_id: 'h' }, { id: 4, place_id: 'b' }];
  const r = buildRoute(items, get, { start: H, end: H, hotelIds: new Set(['h']) });
  assert.deepEqual(r.stops.map((s) => [s.place.id, s.no]), [['a', 1], ['b', 2]]);
  assert.deepEqual(r.points.map((p) => p.edge || p.no), ['stay', 1, 'stay', 2, 'end']);
  assert.equal(r.segments.length, 4);
});
