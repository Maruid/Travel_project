import test from 'node:test';
import assert from 'node:assert/strict';
import { currencyLabel, currencyOptions } from '../src/lib/currency.js';
import { roundRate } from '../src/lib/fx.js';

test('통화 라벨', () => {
  assert.equal(currencyLabel('JPY'), '일본 - 엔 (JPY)');
  assert.equal(currencyLabel('XYZ'), 'XYZ');
  const o = currencyOptions('XYZ', ['KRW']);
  assert.equal(o[0].code, 'KRW'); assert.equal(o[1].code, 'XYZ'); assert.ok(o[1].selected);
});
test('환율 반올림', () => {
  assert.equal(roundRate(9.142345), 9.142);
  assert.equal(roundRate(0.0538123), 0.05381);
});
