import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  saveTripList, loadTripList, markSynced, readSyncIndex, hasOutbox, hasCache, tripsFromCaches,
  tripPhase, pickPrefetch, agoText, addDays, STALE_MS,
} from '../src/lib/offline.js';

function memStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() { return m.size; },
  };
}

test('여행 목록은 사용자별로 저장', () => {
  const s = memStore();
  saveTripList('u1', [{ trip_id: 't1', my_role: 'owner', member_count: 3 }], 1000, s);
  assert.equal(loadTripList('u1', s).trips[0].member_count, 3);
  assert.equal(loadTripList('u1', s).at, 1000);
  assert.equal(loadTripList('u2', s), null);
  assert.equal(loadTripList(null, s), null);
});

test('받은 시각 색인 · 보낼 변경 · 캐시 여부', () => {
  const s = memStore({ 'trip-outbox:v1:a': '[{"op":"insert"}]', 'trip-outbox:v1:b': '[]', 'trip-cache:v1:a': '{}' });
  markSynced('a', 'u1', 500, s);
  assert.deepEqual(readSyncIndex(s).a, { at: 500, uid: 'u1' });
  assert.equal(hasOutbox('a', s), true);
  assert.equal(hasOutbox('b', s), false);
  assert.equal(hasOutbox('c', s), false);
  assert.equal(hasCache('a', s), true);
  assert.equal(hasCache('b', s), false);
});

test('캐시에서 목록 만들기: 다른 사용자 여행 제외, 역할 · 인원 복원', () => {
  const trip = (id, d) => ({ id, title: id, start_date: d, end_date: d });
  const s = memStore({
    'trip-cache:v1:a': JSON.stringify({ trip: trip('a', '2026-11-01'), userId: 'u1', members: [{ user_id: 'u1', role: 'owner' }, { user_id: 'x' }, { user_id: 'y', removed_at: 'z' }] }),
    'trip-cache:v1:b': JSON.stringify({ trip: trip('b', '2026-12-01'), userId: 'u2', members: [] }),
    'trip-cache:v1:c': JSON.stringify({ trip: trip('c', '2026-10-01'), members: [] }),   // 예전 캐시(사용자 표시 없음) → 포함
  });
  const out = tripsFromCaches('u1', s);
  assert.deepEqual(out.map((t) => t.trip_id), ['a', 'c']);
  assert.equal(out[0].my_role, 'owner');
  assert.equal(out[0].member_count, 2);
});

test('날짜 계산과 여행 단계', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  const t = { start_date: '2026-11-20', end_date: '2026-11-24' };
  assert.equal(tripPhase(t, '2026-11-12'), 'later');
  assert.equal(tripPhase(t, '2026-11-13'), 'soon');      // 7일 전
  assert.equal(tripPhase(t, '2026-11-20'), 'ongoing');
  assert.equal(tripPhase(t, '2026-11-24'), 'ongoing');
  assert.equal(tripPhase(t, '2026-11-25'), 'past');
  assert.equal(tripPhase({}, '2026-11-25'), 'later');
  assert.equal(tripPhase({ start_date: '2026-11-25' }, '2026-11-25'), 'ongoing');   // 하루짜리
});

test('미리 받기 대상과 순서', () => {
  const now = 10_000_000_000;
  const today = '2026-11-14';
  const trips = [
    { trip_id: 'far', start_date: '2027-01-10', end_date: '2027-01-12' },     // 먼 미래, 저장 안 됨 → 제외
    { trip_id: 'farC', start_date: '2027-02-10', end_date: '2027-02-12' },    // 먼 미래, 저장됨 + 오래됨 → 포함(3)
    { trip_id: 'soon', start_date: '2026-11-20', end_date: '2026-11-22' },    // 곧 출발, 저장 안 됨 → 포함(2)
    { trip_id: 'now', start_date: '2026-11-13', end_date: '2026-11-16' },     // 진행 중 → 포함(1)
    { trip_id: 'fresh', start_date: '2026-11-14', end_date: '2026-11-15' },   // 진행 중이지만 방금 받음 → 제외
    { trip_id: 'old', start_date: '2026-08-01', end_date: '2026-08-03' },     // 끝난 지 30일 넘음 → 제외
    { trip_id: 'oldPending', start_date: '2026-08-01', end_date: '2026-08-03' }, // 그래도 보낼 변경 있음 → 포함(0)
    { trip_id: 'recentPast', start_date: '2026-11-01', end_date: '2026-11-03' }, // 끝난 지 30일 이내, 저장됨 → 포함(3)
    { trip_id: 'open', start_date: '2026-11-13', end_date: '2026-11-16' },    // 지금 보고 있음 → 제외
  ];
  const cachedSet = new Set(['farC', 'fresh', 'old', 'oldPending', 'recentPast', 'open']);
  const index = { fresh: { at: now - 60_000 }, farC: { at: now - STALE_MS - 1 }, old: { at: 1 }, recentPast: { at: 1 } };
  const ids = pickPrefetch(trips, {
    today, now, index,
    cached: (id) => cachedSet.has(id), outbox: (id) => id === 'oldPending', openIds: new Set(['open']),
  });
  assert.deepEqual(ids, ['oldPending', 'now', 'soon', 'recentPast', 'farC']);
  assert.equal(pickPrefetch(trips, { today, now, index, cached: (id) => cachedSet.has(id), max: 2 }).length, 2);
});

test('지난 시간 표시', () => {
  const now = 100_000_000;
  assert.equal(agoText(null, now), '');
  assert.equal(agoText(now - 10_000, now), '방금');
  assert.equal(agoText(now - 5 * 60_000, now), '5분 전');
  assert.equal(agoText(now - 3 * 3600_000, now), '3시간 전');
  assert.equal(agoText(now - 50 * 3600_000, now), '2일 전');
});
