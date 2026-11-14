import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTileLike, toCacheUrl, fromCacheUrl } from '../src/lib/map-cache.js';

test('지도 요청 주소 바꾸기 (앱 저장소 경유)', () => {
  const style = 'https://tiles.openfreemap.org/styles/dark';
  assert.equal(toCacheUrl(style), 'tcache://tiles.openfreemap.org/styles/dark');
  assert.equal(fromCacheUrl(toCacheUrl(style)), style);
  assert.equal(toCacheUrl('https://example.com/x.pbf'), null);
  assert.equal(toCacheUrl('http://tiles.openfreemap.org/x'), null);
  assert.equal(toCacheUrl(undefined), null);
});

test('저장 규칙: 타일 · 글꼴 · 스프라이트는 저장본 우선', () => {
  assert.equal(isTileLike('https://tiles.openfreemap.org/planet/20260101/14/1/2.pbf'), true);
  assert.equal(isTileLike('https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf'), true);
  assert.equal(isTileLike('https://tiles.openfreemap.org/sprites/ofm_f384/ofm@2x.png'), true);
  assert.equal(isTileLike('https://tiles.openfreemap.org/styles/dark'), false);
  assert.equal(isTileLike('https://tiles.openfreemap.org/planet'), false);
});
