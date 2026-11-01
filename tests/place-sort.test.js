import test from 'node:test';
import assert from 'node:assert/strict';
import { sortRows, nextSort, parseSort } from '../src/lib/place-sort.js';

const row = (name, p = {}, meters) => ({ p: { name, ...p }, walk: { meters } });
const names = (rows) => rows.map((r) => r.p.name);

test('거리: 위치 없는 곳은 방향과 상관없이 맨 아래', () => {
  const rows = [row('a', {}, 500), row('none', {}, null), row('b', {}, 100)];
  assert.deepEqual(names(sortRows(rows, { key: 'distance', dir: 'asc' })), ['b', 'a', 'none']);
  assert.deepEqual(names(sortRows(rows, { key: 'distance', dir: 'desc' })), ['a', 'b', 'none']);
});

test('별점: 리뷰 적은 곳은 아래, 같은 별점은 리뷰 많은 곳 먼저, 별점 없는 곳 맨 아래', () => {
  const rows = [
    row('few5', { rating: 5.0, rating_count: 3 }),
    row('none', {}),
    row('many46', { rating: 4.6, rating_count: 2134 }),
    row('mid46', { rating: 4.6, rating_count: 300 }),
    row('many41', { rating: 4.1, rating_count: 900 }),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'rating', dir: 'desc' })), ['many46', 'mid46', 'many41', 'few5', 'none']);
  assert.deepEqual(names(sortRows(rows, { key: 'rating', dir: 'asc' })), ['many41', 'many46', 'mid46', 'few5', 'none']);
});

test('가격: 싼 순은 최저가, 비싼 순은 최고가', () => {
  const rows = [
    row('wide', { price_min: 1000, price_max: 9000 }),
    row('mid', { price_min: 3000, price_max: 4000 }),
    row('onlyMax', { price_max: 2000 }),
    row('none', {}),
  ];
  assert.deepEqual(names(sortRows(rows, { key: 'price', dir: 'asc' })), ['wide', 'onlyMax', 'mid', 'none']);
  assert.deepEqual(names(sortRows(rows, { key: 'price', dir: 'desc' })), ['wide', 'mid', 'onlyMax', 'none']);
});

test('칩 전환과 저장값 해석', () => {
  assert.deepEqual(nextSort({ key: 'distance', dir: 'asc' }, 'rating'), { key: 'rating', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'rating', dir: 'desc' }, 'rating'), { key: 'rating', dir: 'asc' });
  assert.deepEqual(parseSort('price:desc'), { key: 'price', dir: 'desc' });
  assert.deepEqual(parseSort('junk'), { key: 'distance', dir: 'asc' });
});
