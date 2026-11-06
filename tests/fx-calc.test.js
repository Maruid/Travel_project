import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moneyProfile } from '../src/lib/currency.js';
import { rateText } from '../src/lib/format.js';

// fx-calc.js 는 화면 코드(ui.js)를 불러오므로 키 입력 규칙만 같은 방식으로 확인
test('통화별 기준 단위 · 칩 · 소수점', () => {
  assert.equal(moneyProfile('JPY').base, 100);
  assert.equal(moneyProfile('THB').base, 100);
  assert.equal(moneyProfile('VND').big, true);
  assert.equal(moneyProfile('USD').dec, true);
  assert.deepEqual(moneyProfile('KRW').bills, [1000, 5000, 10000, 50000]);
  // 표에 없는 통화: 환율로 자동
  const x = moneyProfile('XAF', 2.3);
  assert.equal(x.base, 100);
  assert.deepEqual(x.bills, [100, 500, 1000, 5000, 10000]);
});

test('환율 표시는 기준 단위로', () => {
  assert.equal(rateText({ local_currency: 'THB', home_currency: 'KRW', rate: 40 }), '100바트 = 4,000원');
  assert.equal(rateText({ local_currency: 'VND', home_currency: 'KRW', rate: 0.0548 }), '10,000동 = 548원');
  assert.equal(rateText({ local_currency: 'EUR', home_currency: 'KRW', rate: 1500 }), '1유로 = 1,500원');
});

test('키패드: 00 · 000 · 소수점 2자리 · 지우기, 칩 내역 묶기', async () => {
  const { pressKey, partsText } = await import('../src/lib/fx-keys.js');
  let s = '';
  for (const k of ['0', '00', '1', '2', '000']) s = pressKey(s, k);
  assert.equal(s, '12000');
  assert.equal(pressKey(s, 'back'), '1200');
  assert.equal(pressKey('12', '.'), '12');                    // 소수점 없는 통화
  let d = '';
  for (const k of ['.', '5', '0', '1']) d = pressKey(d, k, { dec: true });
  assert.equal(d, '0.50');                                   // 셋째 자리는 무시
  assert.equal(partsText([{ v: 1280, typed: true }, { v: 5000 }, { v: 5000 }, { v: 1000 }]), '1,280 + 5,000 × 2 + 1,000');
});
