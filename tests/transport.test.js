import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transportsOn, routeText, titleText, dayWindow, transportGaps } from '../src/lib/transport.js';

const out = { id: 'o', direction: 'out', mode: 'flight', carrier: '대한항공', code: 'KE723', dep_name: '인천 ICN', dep_terminal: '2', dep_date: '2026-12-01', dep_time: '09:10:00', arr_name: '간사이 KIX', arr_terminal: 'T1', arr_date: '2026-12-01', arr_time: '11:05:00' };
const back = { id: 'b', direction: 'back', mode: 'flight', code: 'KE724', dep_name: '간사이 KIX', dep_date: '2026-12-04', dep_time: '18:30', arr_name: '인천 ICN', arr_date: '2026-12-04', arr_time: '20:20' };

test('그날 이동편', () => {
  assert.deepEqual(transportsOn([back, out], '2026-12-01').map((t) => t.id), ['o']);
  assert.deepEqual(transportsOn([back, out], '2026-12-04').map((t) => t.id), ['b']);
  assert.deepEqual(transportsOn([back, out], '2026-12-02'), []);
});

test('표시 글', () => {
  assert.equal(routeText(out), '인천 ICN T2 09:10 → 간사이 KIX T1 11:05');
  assert.equal(routeText({ ...out, arr_date: '2026-12-02' }), '인천 ICN T2 09:10 → 간사이 KIX T1 11:05 (+1)');
  assert.equal(titleText(out), '가는 편 · 대한항공 · KE723');
  assert.equal(routeText({}), '출발지 → 도착지');
});

test('AI 일정 시간대', () => {
  assert.deepEqual(dayWindow([out, back], '2026-12-01'), { from: '13:05', until: null, note: '11:05 간사이 KIX 도착(항공 KE723)' });
  assert.deepEqual(dayWindow([out, back], '2026-12-04'), { from: null, until: '15:00', note: '18:30 간사이 KIX 출발(항공 KE724)' });
  assert.deepEqual(dayWindow([out, back], '2026-12-02'), { from: null, until: null, note: null });
  // 이른 출발: 0시 아래로 내려가지 않음
  assert.equal(dayWindow([{ ...back, dep_time: '02:00' }], '2026-12-04').until, '00:00');
});

test('입국 · 출국 가이드에 빠진 정보', () => {
  assert.deepEqual(transportGaps([out, back]), []);
  assert.deepEqual(transportGaps([]), ['가는 편', '오는 편']);
  assert.deepEqual(transportGaps([{ ...out, arr_time: null }]), ['가는 편 도착지 · 시각', '오는 편']);
});
