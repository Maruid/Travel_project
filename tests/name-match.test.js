import test from 'node:test';
import assert from 'node:assert/strict';
import { namesMatch, nameSimilarity } from '../src/lib/name-match.js';

test('비슷하지만 다른 가게는 다름', () => {
  assert.equal(namesMatch(['청년고기집'], '청년다방'), false);
  assert.ok(nameSimilarity('청년고기집', '청년다방') < 0.5);
});
test('지점명·띄어쓰기·전각 차이는 같은 곳', () => {
  assert.equal(namesMatch(['청년고기집'], '청년고기집 난바점'), true);
  assert.equal(namesMatch(['이치란 라멘 도톤보리점'], '이치란 도톤보리 본관'), true);
  assert.equal(namesMatch(['ＩＣＨＩＲＡＮ'], 'Ichiran'), true);
});
test('현지 이름으로도 비교', () => {
  assert.equal(namesMatch(['이치란', '一蘭 道頓堀店'], '一蘭 道頓堀店本館'), true);
  assert.equal(namesMatch(['야키니쿠 A', null], '焼肉B'), false);
});
