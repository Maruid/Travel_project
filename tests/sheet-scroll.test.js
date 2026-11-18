import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitScroll, sheetTakesGesture, sheetMaxOff, releaseVelocity } from '../src/lib/sheet-scroll.js';

test('올릴 때: 판 먼저, 남은 만큼 목록', () => {
  assert.deepEqual(splitScroll(50, { off: 0, max: 200, scrollTop: 0, scrollMax: 500 }), { off: 50, scrollTop: 0 });
  assert.deepEqual(splitScroll(80, { off: 180, max: 200, scrollTop: 0, scrollMax: 500 }), { off: 200, scrollTop: 60 });
  assert.deepEqual(splitScroll(80, { off: 200, max: 200, scrollTop: 480, scrollMax: 500 }), { off: 200, scrollTop: 500 });
});

test('내릴 때: 목록 먼저 맨 위까지, 남은 만큼 판', () => {
  assert.deepEqual(splitScroll(-50, { off: 200, max: 200, scrollTop: 30, scrollMax: 500 }), { off: 180, scrollTop: 0 });
  assert.deepEqual(splitScroll(-50, { off: 20, max: 200, scrollTop: 0, scrollMax: 500 }), { off: 0, scrollTop: 0 });
});

test('판이 손짓을 맡는 경우', () => {
  assert.equal(sheetTakesGesture(true, { off: 0, max: 200, scrollTop: 0 }), true);
  assert.equal(sheetTakesGesture(true, { off: 200, max: 200, scrollTop: 0 }), false);      // 목록 스크롤
  assert.equal(sheetTakesGesture(false, { off: 200, max: 200, scrollTop: 0 }), true);      // 맨 위에서 더 내림
  assert.equal(sheetTakesGesture(false, { off: 200, max: 200, scrollTop: 40 }), true);       // 목록 → 판 이어서
  assert.equal(sheetTakesGesture(false, { off: 0, max: 200, scrollTop: 0 }), false);
});

test('판이 올라갈 수 있는 거리', () => {
  assert.equal(sheetMaxOff({ mapPx: 340, compact: 140, rootH: 700, headerH: 70, contentH: 2000 }), 200);
  assert.equal(sheetMaxOff({ mapPx: 340, compact: 140, rootH: 700, headerH: 70, contentH: 330 }), 40);   // 짧은 목록
  assert.equal(sheetMaxOff({ mapPx: 340, compact: 140, rootH: 700, headerH: 70, contentH: 100 }), 0);
});

test('손 뗄 때 속도', () => {
  assert.equal(releaseVelocity([{ y: 500, t: 0 }, { y: 400, t: 50 }], 60), 2);
  assert.equal(releaseVelocity([{ y: 500, t: 0 }, { y: 400, t: 50 }], 300), 0);
});
