import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseFilter, filterToString, activeCount, passesFilter, searchPlaces, groupCategories, pruneFilter, normQuery } from '../src/lib/place-filter.js';

test('필터 저장값 읽기: 깨진 값은 빈 필터, 예전 "안 간 곳만" 값 이어받기', () => {
  assert.deepEqual(parseFilter('{bad'), { cats: [], hideVisited: false, liked: false });
  assert.equal(parseFilter(null, { hideVisited: true }).hideVisited, true);
  const f = { cats: ['a', 'b'], hideVisited: true, liked: false };
  assert.deepEqual(parseFilter(filterToString(f)), f);
  assert.equal(activeCount(f), 3);
});

test('카테고리 여러 개 + 안 간 곳만', () => {
  const f = { cats: ['food', 'cafe'], hideVisited: true, liked: false };
  assert.equal(passesFilter({ category_id: 'food' }, f), true);
  assert.equal(passesFilter({ category_id: 'spot' }, f), false);
  assert.equal(passesFilter({ category_id: 'cafe', visited_at: '2026-01-01' }, f), false);
  assert.equal(pruneFilter(f, new Set(['food'])).cats.join(), 'food');
});

test('이름 검색: 이름 > 현지 이름 > 동네 > 대표 메뉴, 공백·대소문자 무시', () => {
  const ps = [
    { id: 1, name: '이치란 라멘', zone: '도톤보리', signature: '돈코츠' },
    { id: 2, name: '카페 A', zone: '난바', signature: '라멘 아이스크림' },
    { id: 3, name: 'Blue Bottle', map_query: 'ブルーボトル 梅田' },
  ];
  assert.deepEqual(searchPlaces(ps, '라멘').map((p) => p.id), [1, 2]);
  assert.deepEqual(searchPlaces(ps, 'blue bottle').map((p) => p.id), [3]);
  assert.deepEqual(searchPlaces(ps, 'ﾌﾞﾙｰ').map((p) => p.id), [3]);
  assert.deepEqual(searchPlaces(ps, '도톤').map((p) => p.id), [1]);
  assert.deepEqual(searchPlaces(ps, '  '), []);
  assert.equal(normQuery('A b-C'), 'abc');
});

test('카테고리를 종류별로 묶고 개수', () => {
  const cats = [{ id: 'r', kind: 'food', name: '라멘' }, { id: 's', kind: 'food', name: '스시' }, { id: 'c', kind: 'cafe', name: '카페' }, { id: 'x', kind: 'spot', name: '안씀' }];
  const ps = [{ category_id: 'r' }, { category_id: 'r' }, { category_id: 'c' }, { category_id: null }];
  const g = groupCategories(cats, ps);
  assert.deepEqual(g.groups.map((x) => x.label), ['식당', '카페']);
  assert.equal(g.groups[0].cats[0].count, 2);
  assert.equal(g.uncategorized, 1);
});

test('찜한 곳 필터: 한 명이라도 찜한 장소만', () => {
  const f = { cats: [], hideVisited: false, liked: true };
  const likedIds = new Set(['p1']);
  assert.equal(passesFilter({ id: 'p1' }, f, { likedIds }), true);
  assert.equal(passesFilter({ id: 'p2' }, f, { likedIds }), false);
});
