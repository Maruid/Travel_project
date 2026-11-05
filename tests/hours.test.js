import test from 'node:test';
import assert from 'node:assert/strict';
import { hoursStatus, hoursIssueAt } from '../src/lib/hours.js';

// 월~토 11:00-22:00, 일요일 휴무 (화요일은 금요일처럼 자정 넘어 02:00 까지)
const oh = {
  weekday: ['월요일: 11:00~22:00', '화요일: 11:00~02:00', '수요일: 11:00~22:00', '목요일: 11:00~22:00', '금요일: 11:00~22:00', '토요일: 11:00~22:00', '일요일: 휴무일'],
  periods: [1, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 11, minute: 0 }, close: { day: d, hour: 22, minute: 0 } }))
    .concat([{ open: { day: 2, hour: 11, minute: 0 }, close: { day: 3, hour: 2, minute: 0 } }]),
  closedDays: [0],
};
const at = (iso) => new Date(iso);   // UTC 로 주고 시간대는 UTC 로 해석
const tz = 'UTC';

test('지금 영업 상태', () => {
  assert.equal(hoursStatus(oh, tz, at('2026-11-02T12:00:00Z')).state, 'open');        // 월 12:00
  assert.equal(hoursStatus(oh, tz, at('2026-11-02T21:30:00Z')).text, '곧 마감 22:00'); // 월 21:30
  assert.equal(hoursStatus(oh, tz, at('2026-11-02T09:00:00Z')).text, '11:00 오픈');
  assert.equal(hoursStatus(oh, tz, at('2026-11-02T23:00:00Z')).state, 'closed_now');
  assert.equal(hoursStatus(oh, tz, at('2026-11-01T12:00:00Z')).text, '오늘 휴무');    // 일요일
  assert.equal(hoursStatus(oh, tz, at('2026-11-04T01:00:00Z')).state, 'closing');      // 수 01:00 (화요일 영업 연장)
  assert.equal(hoursStatus({ periods: [{ open: { day: 0, hour: 0, minute: 0 } }] }, tz).text, '24시간 영업');
  assert.equal(hoursStatus(null, tz), null);
});

test('일정 시각 확인', () => {
  assert.equal(hoursIssueAt(oh, '2026-11-01', '12:00'), '일요일 휴무예요');
  assert.equal(hoursIssueAt(oh, '2026-11-02', '12:00'), null);
  assert.match(hoursIssueAt(oh, '2026-11-02', '09:00'), /영업하지 않아요 \(월요일: 11:00~22:00\)/);
  assert.equal(hoursIssueAt(oh, '2026-11-02', null), null);
});
