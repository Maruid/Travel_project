import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnrich } from '../src/lib/enrich-check.js';

test('AI 채우기 검수: 종류가 다르면 막음', () => {
  assert.equal(checkEnrich({ knownKind: 'transit', aiKind: 'food' }).ok, false);   // 기타신치역 → 식당
  assert.match(checkEnrich({ knownKind: 'transit', aiKind: 'food' }).message, /역 · 교통.*식당/);
  assert.equal(checkEnrich({ knownKind: 'lodging', aiKind: 'spot' }).ok, false);
  assert.equal(checkEnrich({ knownKind: 'food', aiKind: 'bar' }).ok, true);        // 식당 · 술집은 같은 묶음
  assert.equal(checkEnrich({ knownKind: 'cafe', aiKind: 'food' }).ok, true);
  assert.equal(checkEnrich({ knownKind: 'transit', aiKind: 'transit' }).ok, true);
  assert.equal(checkEnrich({ knownKind: null, aiKind: 'food' }).ok, true);          // 종류를 모르면 그대로
  assert.equal(checkEnrich({ knownKind: 'spot', aiKind: null }).ok, true);
  assert.equal(checkEnrich({ knownKind: 'etc', aiKind: 'food' }).ok, true);
});
