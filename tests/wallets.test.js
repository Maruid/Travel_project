import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolBalances, walletBalances, chargeShares, chargedRate, settleTransfers, balances } from '../src/lib/settle.js';

const amt = (e) => Number(e.amount);
const M = ['a', 'b', 'c'];
const W = [{ id: 'card', kind: 'card', holder: 'a' }, { id: 'cash', kind: 'cash', holder: 'b' }];

test('지갑 잔액: 충전 · 인출 · 지출', () => {
  const topups = [{ kind: 'charge', wallet_id: 'card', amount: 30000 }, { kind: 'withdraw', from_wallet: 'card', wallet_id: 'cash', amount: 10000 }];
  const ex = [{ wallet_id: 'card', amount: 6000 }, { wallet_id: 'cash', amount: 3000 }, { paid_by: 'a', amount: 999 }];
  const b = walletBalances(W, topups, ex, amt);
  assert.equal(b.get('card'), 14000);
  assert.equal(b.get('cash'), 7000);
});

test('공금만 쓰고 남으면: 카드 주인이 남은 돈을 넣은 비율대로 돌려줌', () => {
  const topups = [{ kind: 'charge', wallet_id: 'card', amount: 30000 }];          // 모두 1만씩
  const ex = [{ wallet_id: 'card', amount: 15000 }];                              // 모두 몫
  const r = poolBalances({ expenses: ex, topups, wallets: W, memberIds: M, toAmount: amt });
  const net = Object.fromEntries(r.map((x) => [x.id, Math.round(x.net)]));
  assert.deepEqual(net, { a: -10000, b: 5000, c: 5000 });                        // a 가 15000 들고 있음 → b, c 에게 5000씩
  assert.equal(r.reduce((s, x) => s + x.net, 0), 0);
});

test('공금 카드로 개인 물건 · 개인 돈으로 공동 지출', () => {
  const topups = [{ kind: 'charge', wallet_id: 'card', amount: 30000, shares: { a: 10000, b: 10000, c: 10000 } }];
  const ex = [
    { wallet_id: 'card', amount: 3000, split_with: ['b'] },          // 공금으로 b 개인 기념품
    { paid_by: 'c', amount: 6000 },                                  // c 가 개인 돈으로 모두 몫
    { wallet_id: 'card', amount: 27000 },                            // 남은 공금 다 씀
  ];
  const r = poolBalances({ expenses: ex, topups, wallets: W, memberIds: M, toAmount: amt });
  const net = Object.fromEntries(r.map((x) => [x.id, Math.round(x.net)]));
  // 각자 몫: a 11000, b 14000, c 11000. 낸 돈: a 10000, b 10000, c 16000
  assert.deepEqual(net, { a: -1000, b: -4000, c: 5000 });
  assert.deepEqual(settleTransfers(r, 'JPY').map((t) => [t.from, t.to, t.amount]), [['b', 'c', 4000], ['a', 'c', 1000]]);
});

test('지갑 없으면 예전 정산과 같음', () => {
  const ex = [{ paid_by: 'a', amount: 9000 }, { paid_by: 'b', amount: 3000, split_with: ['b', 'c'] }];
  const oldR = balances(ex, M, amt).map((x) => Math.round(x.net));
  const newR = poolBalances({ expenses: ex, memberIds: M, toAmount: amt }).map((x) => Math.round(x.net));
  assert.deepEqual(newR, oldR);
});

test('들고 있는 사람 없는 지갑 · 충전 나눔 · 환율', () => {
  const r = poolBalances({ expenses: [], topups: [{ kind: 'charge', wallet_id: 'x', amount: 300 }], wallets: [{ id: 'x' }], memberIds: M, toAmount: amt });
  assert.ok(r.every((x) => Math.abs(x.net) < 1e-9));
  assert.deepEqual([...chargeShares({ amount: 100, shares: { a: 70, b: 0 } }, M)], [['a', 70]]);
  assert.equal(chargedRate([{ kind: 'charge', amount: 10000, home_amount: 91000 }, { kind: 'charge', amount: 5000 }]), 9.1);
  assert.equal(chargedRate([]), null);
});
