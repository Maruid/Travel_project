import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateChecker, planCategories, copyRow, normName } from '../src/lib/place-copy.js';

test('중복: 구글 ID 또는 이름(공백·기호 무시)', () => {
  const isDup = duplicateChecker([{ name: '이치란 라멘 도톤보리점', google_place_id: 'g1' }]);
  assert.equal(isDup({ name: '전혀 다른 이름', google_place_id: 'g1' }), true);
  assert.equal(isDup({ name: '이치란라멘 (도톤보리점)' }), true);
  assert.equal(isDup({ name: '이치란 라멘 우메다점' }), false);
  assert.equal(normName('A b-C!'), 'abc');
});

test('카테고리 대응', () => {
  const globals = [{ id: 'gFood', kind: 'food' }, { id: 'gSpot', kind: 'spot' }];
  const sourceCats = [{ id: 's1', name: '라멘', kind: 'food', icon: 'fa-bowl-food', color: '#f00' }, { id: 's2', name: '오코노미', kind: 'food' }];
  const targetCustom = [{ id: 't1', name: '라멘' }];
  const on = planCategories(['gSpot', 's1', 's2', null], { sourceCats, targetCustom, globals, allowCustom: true });
  assert.deepEqual(on.get('gSpot'), { id: 'gSpot' });
  assert.deepEqual(on.get('s1'), { id: 't1' });
  assert.equal(on.get('s2').create.name, '오코노미');
  const off = planCategories(['s2'], { sourceCats, targetCustom, globals, allowCustom: false });
  assert.deepEqual(off.get('s2'), { id: 'gFood' });
});

test('복사 행: 검토 기록·ID 제외', () => {
  const r = copyRow({ id: 'x', trip_id: 't', name: 'A', lat: 1, lng: 2, geo_review: { type: 'auto' }, is_anchor: null }, 'c');
  assert.equal(r.id, undefined); assert.equal(r.trip_id, undefined); assert.equal(r.geo_review, undefined);
  assert.equal(r.category_id, 'c'); assert.equal(r.is_anchor, false); assert.equal(r.lat, 1);
});
