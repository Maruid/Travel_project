import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTiles } from '../src/lib/tile-plan.js';

// 오사카 시드 데이터의 대표 좌표 (난바 일대 + 우메다 + USJ + 미노오)
const osaka = [
  [34.6698, 135.5065], [34.6660, 135.5010], [34.7025, 135.4960], [34.6654, 135.4323],
  [34.8480, 135.4720], [34.6915, 135.5075], [34.7065, 135.5050], [34.6535, 135.5060],
  [34.6735, 135.5015], [34.7115, 135.4960], [34.6850, 135.5010], [34.6665, 135.5185],
].map(([lat, lng]) => ({ lat, lng }));

test('오사카 범위는 z14 까지 한도 내에서 받는다', () => {
  const { tiles, maxZoom } = planTiles(osaka);
  assert.equal(maxZoom, 14);
  assert.ok(tiles.length > 50 && tiles.length <= 1500, `tiles=${tiles.length}`);
  assert.equal(new Set(tiles.map((t) => t.join('/'))).size, tiles.length);
});

test('여러 나라에 흩어진 장소는 최대 줌을 낮춰 한도를 지킨다', () => {
  const spread = [...osaka, { lat: 37.5665, lng: 126.978 }, { lat: 35.6812, lng: 139.7671 }];
  const { tiles, maxZoom } = planTiles(spread);
  assert.ok(tiles.length <= 1500);
  assert.ok(maxZoom >= 10);
});

test('좌표가 없으면 빈 계획', () => {
  assert.deepEqual(planTiles([{ lat: null, lng: null }]), { tiles: [], maxZoom: 0 });
});
