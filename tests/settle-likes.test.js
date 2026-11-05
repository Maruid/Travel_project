import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settleTransfers, balances } from '../src/lib/settle.js';
import { likeId, likeMap } from '../src/lib/likes.js';

test('최소 송금: 3명', () => {
  // A 가 3만 내고 셋이 나눔 → B, C 가 A 에게 1만씩
  const b = balances([{ amount: 30000, paid_by: 'A' }], ['A', 'B', 'C'], (e) => e.amount);
  const t = settleTransfers(b, 'JPY');
  assert.deepEqual(t, [{ from: 'B', to: 'A', amount: 10000 }, { from: 'C', to: 'A', amount: 10000 }]);
});

test('최소 송금: 서로 낸 돈 상계, 일부만 나눔, 자리표시 멤버 포함', () => {
  const ex = [
    { amount: 9000, paid_by: 'A' },                       // A B C 3000씩
    { amount: 6000, paid_by: 'B', split_with: ['B', 'C'] }, // B C 3000씩
    { amount: 1000, paid_by: 'P' },                       // 자리표시 P 가 냄 (멤버 목록 밖)
  ];
  const b = balances(ex, ['A', 'B', 'C'], (e) => e.amount);
  const sum = b.reduce((s, x) => s + x.net, 0);
  assert.ok(Math.abs(sum) < 1e-9);
  const t = settleTransfers(b, 'JPY');
  // 송금 후 모두 0
  const left = new Map(b.map((x) => [x.id, x.net]));
  t.forEach(({ from, to, amount }) => { left.set(from, left.get(from) + amount); left.set(to, left.get(to) - amount); });
  for (const v of left.values()) assert.ok(Math.abs(v) <= 1, String(v));
  assert.ok(t.length <= 3);
});

test('소수 통화는 센트까지, 1원 미만 차이는 무시', () => {
  const b = balances([{ amount: 10, paid_by: 'A' }], ['A', 'B', 'C'], (e) => e.amount);
  assert.deepEqual(settleTransfers(b, 'USD').map((x) => x.amount), [3.33, 3.33]);
  assert.deepEqual(settleTransfers([{ id: 'A', net: 0.4 }, { id: 'B', net: -0.4 }], 'JPY'), []);
});

test('찜 id 는 고정이고 UUID 모양', () => {
  const a = likeId('p1', 'm1');
  assert.equal(a, likeId('p1', 'm1'));
  assert.notEqual(a, likeId('p1', 'm2'));
  assert.notEqual(a, likeId('m1', 'p1'));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('찜 묶기: 끈 찜 · 나간 멤버 제외', () => {
  const m = likeMap([
    { place_id: 'p1', member_id: 'a', liked: true },
    { place_id: 'p1', member_id: 'b', liked: false },
    { place_id: 'p1', member_id: 'x', liked: true },
    { place_id: 'p2', member_id: 'b', liked: true },
  ], new Set(['a', 'b']));
  assert.deepEqual(m.get('p1'), ['a']);
  assert.deepEqual(m.get('p2'), ['b']);
});
