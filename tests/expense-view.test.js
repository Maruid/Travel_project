import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterExpenses, groupExpenses, parseExpenseFilter, expenseFilterCount, sampleExpenses, EMPTY_EXPENSE_FILTER } from '../src/lib/expense-view.js';

const E = [
  { id: 'a', spent_date: '2026-11-24', spent_time: '12:00', category: '음식', amount: 1000, method: 'card', paid_by: 'm1', split_with: null },
  { id: 'b', spent_date: '2026-11-24', spent_time: '18:00', category: '쇼핑', amount: 5000, method: 'cash', paid_by: 'm2', split_with: ['m2'] },
  { id: 'c', spent_date: '2026-11-25', spent_time: '09:00', category: '음식', amount: 3000, method: 'card', paid_by: 'm2', split_with: null },
];
const amt = (e) => e.amount;

test('필터', () => {
  const f = (o) => filterExpenses(E, { ...EMPTY_EXPENSE_FILTER, ...o }, ['m1', 'm2']).map((e) => e.id);
  assert.deepEqual(f({ method: ['cash'] }), ['b']);
  assert.deepEqual(f({ payer: ['m2'] }), ['b', 'c']);
  assert.deepEqual(f({ share: ['m1'] }), ['a', 'c']);       // b 는 m2 개인
  assert.deepEqual(f({ cat: ['음식'], payer: ['m2'] }), ['c']);
});

test('날짜별: 최근 날짜 먼저, 그날 합계', () => {
  const g = groupExpenses(E, 'date', amt);
  assert.deepEqual(g.map((x) => [x.key, x.total]), [['2026-11-25', 3000], ['2026-11-24', 6000]]);
  assert.deepEqual(g[1].rows.map((e) => e.id), ['b', 'a']);
});

test('금액순 · 카테고리별', () => {
  assert.deepEqual(groupExpenses(E, 'amount', amt)[0].rows.map((e) => e.id), ['b', 'c', 'a']);
  const c = groupExpenses(E, 'cat', amt);
  assert.deepEqual(c.map((x) => [x.key, x.total]), [['쇼핑', 5000], ['음식', 4000]]);
  assert.equal(Math.round(c[0].pct * 100), 56);
  assert.deepEqual(groupExpenses([], 'amount', amt), []);
});

test('필터 저장값 읽기', () => {
  assert.deepEqual(parseExpenseFilter('{"cat":["음식",3],"method":"x"}'), { method: [], payer: [], share: [], cat: ['음식'] });
  assert.equal(expenseFilterCount(parseExpenseFilter('bad')), 0);
});

test('예시 지출', () => {
  const s = sampleExpenses({ start: '2026-11-24', local: 'JPY', memberIds: ['m1', 'm2'] });
  assert.equal(s.length, 10);
  assert.equal(s[0].spent_date, '2026-11-24');
  assert.ok(s.every((e) => e.currency === 'JPY' && ['m1', 'm2'].includes(e.paid_by)));
});
