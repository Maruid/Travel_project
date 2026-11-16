import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tripStays, guideGaps, buildGuideRequest, guideBody } from '../src/lib/ai-guide.js';

const cats = { cs: { kind: 'spot' }, cl: { kind: 'lodging' }, cf: { kind: 'food' } };
const categoryOf = (id) => cats[id];
const trip = { destination: '오사카', start_date: '2026-12-01', end_date: '2026-12-04' };
const places = [
  { id: 'h1', name: '난바 호텔', category_id: 'cl', lat: 34.66, lng: 135.5, zone: '난바' },
  { id: 'h2', name: '교토 료칸', category_id: 'cl', lat: 35.0, lng: 135.76, zone: '기온' },
  { id: 's1', name: '오사카성', category_id: 'cs', lat: 34.68, lng: 135.52 },
  { id: 's2', name: '도톤보리', category_id: 'cs' },
  { id: 'f1', name: '이치란', category_id: 'cf' },
];
const days = [
  { day_date: '2026-12-01', stay_place_id: 'h1' },
  { day_date: '2026-12-03', stay_place_id: 'h2' },
];
const transports = [
  { direction: 'out', mode: 'flight', code: 'KE723', arr_name: '간사이 KIX', arr_date: '2026-12-01', arr_time: '11:05:00' },
  { direction: 'back', mode: 'flight', code: 'KE724', dep_name: '간사이 KIX', dep_date: '2026-12-04', dep_time: '18:30:00' },
];
const data = { trip, places, days, categoryOf, likes: new Map([['s2', 2]]), transports };

test('묵는 숙소: 이어지는 밤은 하나로', () => {
  const s = tripStays(data);
  assert.deepEqual(s.map((x) => [x.id, x.from, x.to]), [['h1', '2026-12-01', '2026-12-02'], ['h2', '2026-12-03', '2026-12-03']]);
  // 일정 탭 숙소가 없으면 숙소 카테고리
  assert.deepEqual(tripStays({ ...data, days: [] }).map((x) => x.id), ['h1', 'h2']);
});

test('빠진 정보', () => {
  for (const c of ['weather', 'landmark', 'entry', 'stay']) assert.deepEqual(guideGaps(c, data), [], c);
  assert.deepEqual(guideGaps('entry', { ...data, transports: [] }), ['가는 편', '오는 편']);
  assert.deepEqual(guideGaps('landmark', { ...data, places: places.filter((p) => p.category_id !== 'cs') }), ["'명소' 카테고리 장소"]);
  assert.deepEqual(guideGaps('weather', { ...data, trip: { ...trip, destination: null }, places: [], days: [] }), ['여행지', '위치가 있는 숙소나 장소']);
});

test('요청 만들기', () => {
  assert.deepEqual(buildGuideRequest('weather', data).weather, { lat: 34.66, lng: 135.5, place: '난바' });
  assert.deepEqual(buildGuideRequest('landmark', data).landmarks.map((p) => p.name), ['도톤보리', '오사카성']);
  const e = buildGuideRequest('entry', data);
  assert.equal(e.out.arr_time, '11:05');
  assert.deepEqual(e.stays.map((s) => s.name), ['난바 호텔', '교토 료칸']);
});

test('저장 본문: 출처 · 날짜', () => {
  const b = guideBody({ body: '### 옷차림\n- 코트', sources: [{ uri: 'https://open-meteo.com/', title: 'Open-Meteo [기록]' }] }, '2026-11-15');
  assert.match(b, /2026-11-15/);
  assert.match(b, /\[Open-Meteo 기록\]\(https:\/\/open-meteo.com\/\)/);
});
