import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyLabel, currencyOptions } from '../src/lib/currency.js';
import { roundRate } from '../src/lib/fx.js';
import { money, priceRange, priceInHome, rateText, approxRange } from '../src/lib/format.js';

test('통화 라벨', () => {
  assert.equal(currencyLabel('JPY'), '일본 - 엔 (JPY)');
  assert.equal(currencyLabel('XYZ'), 'XYZ');
  const o = currencyOptions('XYZ', ['KRW']);
  assert.equal(o[0].code, 'KRW'); assert.equal(o[1].code, 'XYZ'); assert.ok(o[1].selected);
  // 잘린 값은 버리고 fallback 선택
  const t2 = currencyOptions('J', ['J', 'KRW'], 'JPY');
  assert.ok(!t2.some((x) => x.code === 'J'));
  assert.equal(t2.find((x) => x.selected).code, 'JPY');
});
test('환율 반올림', () => {
  assert.equal(roundRate(9.142345), 9.142);
  assert.equal(roundRate(0.0538123), 0.05381);
});

test('금액 표시', () => {
  assert.equal(money(93000, 'JPY'), '93,000엔');
  assert.equal(money(809100.4, 'KRW'), '809,100원');
  assert.equal(money(12.5, 'USD'), '12.5달러');
  assert.equal(money(5, 'XYZ'), '5 XYZ');
  assert.equal(priceRange({ price_min: 7000, price_max: 12000, price_currency: 'JPY' }), '7,000~12,000엔');
  assert.equal(priceRange({ price_min: 800, price_max: 800, price_currency: 'JPY' }), '800엔');
});
test('원화 환산과 환율 표시', () => {
  const b = { local_currency: 'JPY', home_currency: 'KRW', rate: 8.7 };
  assert.equal(priceInHome({ price_min: 7000, price_max: 12000, price_currency: 'JPY' }, b), '약 6.1~10.4만원');
  assert.equal(priceInHome({ price_min: 800, price_max: null, price_currency: 'JPY' }, b), '약 7,000원');
  assert.equal(priceInHome({ price_min: 800, price_currency: 'USD' }, b), '');
  assert.equal(approxRange(900, 15000, 'KRW'), '약 900원~1.5만원');
  assert.equal(rateText(b), '100엔 = 870원');
  assert.equal(rateText({ local_currency: 'USD', home_currency: 'KRW', rate: 1400 }), '1달러 = 1,400원');
});
