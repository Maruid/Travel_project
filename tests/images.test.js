import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, daysBetween, purgeDate, retention, canFetch, imagePaths, imagesOf, formatBytes, prefetchWindow,
} from '../src/lib/image-rules.js';
import { fitSize, qualitySteps, PRESETS } from '../src/lib/image-resize.js';

test('날짜 계산', () => {
  assert.equal(addDays('2026-12-04', 30), '2027-01-03');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(daysBetween('2026-12-01', '2026-12-08'), 7);
  assert.equal(purgeDate('2026-12-04'), '2027-01-03');
  assert.equal(purgeDate(null), null);
});

test('보관 안내 상태', () => {
  const base = { endDate: '2026-12-04', keepDays: 30, count: 3 };
  assert.equal(retention({ ...base, today: '2026-12-01' }).state, 'during');
  assert.equal(retention({ ...base, today: '2026-12-04' }).state, 'during');
  assert.deepEqual(retention({ ...base, today: '2026-12-10' }), { state: 'after', purge: '2027-01-03', days: 24 });
  assert.equal(retention({ ...base, today: '2026-12-27' }).state, 'soon');       // 7일 남음
  assert.equal(retention({ ...base, today: '2027-01-03' }).days, 0);             // 오늘 삭제
  assert.equal(retention({ ...base, today: '2027-01-03' }).state, 'soon');
  assert.equal(retention({ ...base, today: '2027-01-04' }).state, 'purged');
  assert.equal(retention({ ...base, count: 0, today: '2026-12-27' }).state, 'none');
  assert.equal(retention({ endDate: null, count: 2, today: '2026-12-27' }).state, 'during');
});

test('전송 단계별 받기', () => {
  assert.equal(canFetch('ok'), true);
  assert.equal(canFetch('warn'), true);
  assert.equal(canFetch('thumbs', { thumb: true }), true);
  assert.equal(canFetch('thumbs', { kind: 'doc' }), true);
  assert.equal(canFetch('thumbs', { kind: 'photo' }), false);
  assert.equal(canFetch('blocked', { thumb: true }), false);
});

test('경로 · 목록', () => {
  assert.deepEqual(imagePaths('t1', 'i1'), { path: 't1/i1.webp', thumb_path: 't1/i1_t.webp' });
  assert.deepEqual(imagePaths('t1', 'i1', 'jpg'), { path: 't1/i1.jpg', thumb_path: 't1/i1_t.jpg' });
  const rows = [
    { id: 'a', target_type: 'item', target_id: 'x', sort_order: 20 },
    { id: 'b', target_type: 'item', target_id: 'x', sort_order: 10 },
    { id: 'c', target_type: 'item', target_id: 'x', sort_order: 5, deleted_at: '2026-01-01' },
    { id: 'd', target_type: 'todo', target_id: 'x', sort_order: 1 },
  ];
  assert.deepEqual(imagesOf(rows, 'item', 'x').map((r) => r.id), ['b', 'a']);
});

test('크기 표시', () => {
  assert.equal(formatBytes(500), '500B');
  assert.equal(formatBytes(150 * 1024), '150KB');
  assert.equal(formatBytes(3.5 * 1048576), '3.5MB');
  assert.equal(formatBytes(900 * 1048576), '900MB');
});

test('미리 받기 기간', () => {
  const trip = { start_date: '2026-12-10', end_date: '2026-12-14' };
  assert.equal(prefetchWindow(trip, '2026-12-02'), false);
  assert.equal(prefetchWindow(trip, '2026-12-03'), true);
  assert.equal(prefetchWindow(trip, '2026-12-14'), true);
  assert.equal(prefetchWindow(trip, '2026-12-15'), false);
});

test('줄일 크기', () => {
  assert.deepEqual(fitSize(4000, 3000, PRESETS.photo.max), { width: 1280, height: 960 });
  assert.deepEqual(fitSize(2480, 3508, PRESETS.doc.max), { width: 1697, height: 2400 });   // A4 300dpi 스캔
  assert.deepEqual(fitSize(800, 600, 1280), { width: 800, height: 600 });                  // 작으면 그대로
  assert.deepEqual(fitSize(4000, 3000, PRESETS.thumb.max), { width: 320, height: 240 });
});

test('품질 낮추는 순서', () => {
  assert.deepEqual(qualitySteps(0.85), [0.85, 0.75, 0.65, 0.55, 0.45]);
  assert.deepEqual(qualitySteps(0.5), [0.5]);
});
