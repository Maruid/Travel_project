import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrl, shareTargets } from '../src/lib/share-in.js';

test('공유 글에서 주소 꺼내기', () => {
  assert.equal(extractUrl('이치란 라멘 신주쿠\nhttps://maps.app.goo.gl/AbC123'), 'https://maps.app.goo.gl/AbC123');
  assert.equal(extractUrl('보세요 (https://maps.app.goo.gl/x1).'), 'https://maps.app.goo.gl/x1');
  assert.equal(extractUrl('링크 없음'), null);
  assert.equal(extractUrl(null), null);
});

test('넣을 여행 고르기', () => {
  const today = '2026-11-15';
  const T = (id, s, e) => ({ id, start_date: s, end_date: e });
  // 진행 중 1개만 → 자동
  assert.deepEqual(shareTargets([T('a', '2026-11-10', '2026-11-20'), T('p', '2026-01-01', '2026-01-05')], today), { trips: [T('a', '2026-11-10', '2026-11-20')], auto: true });
  // 진행 중 + 다가오는 → 고르기 (진행 중 먼저, 다가오는 건 가까운 순)
  const r = shareTargets([T('far', '2027-03-01', '2027-03-05'), T('near', '2026-12-01', '2026-12-03'), T('now', '2026-11-15', '2026-11-15')], today);
  assert.equal(r.auto, false);
  assert.deepEqual(r.trips.map((t) => t.id), ['now', 'near', 'far']);
  // my_trips 모양 (trip_id)
  assert.deepEqual(shareTargets([{ trip_id: 'm', start_date: '2026-11-20', end_date: '2026-11-23' }], today).trips[0].id, 'm');
  // 다 지난 여행뿐 → 전체에서 고르기 (최근 순)
  const past = shareTargets([T('old', '2025-01-01', '2025-01-02'), T('recent', '2026-10-01', '2026-10-03')], today);
  assert.deepEqual(past, { trips: [T('recent', '2026-10-01', '2026-10-03'), T('old', '2025-01-01', '2025-01-02')], auto: false });
});
