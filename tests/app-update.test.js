import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appUpdateState, newFeatures } from '../src/lib/app-update.js';

test('앱 업데이트 판단', () => {
  assert.equal(appUpdateState({ api: 1, min: 1, latest: 2 }), 'available');   // 옛 앱 · 새 APK 있음 (꼭은 아님)
  assert.equal(appUpdateState({ api: 1, min: 2, latest: 2 }), 'required');
  assert.equal(appUpdateState({ api: 2, min: 1, latest: 2 }), 'latest');
  assert.equal(appUpdateState({ api: 2, min: 1, latest: null }), 'unknown');  // 예전 version.json (latest 없음)
  assert.equal(appUpdateState({ api: 0, min: 1, latest: 2 }), 'unknown');     // 앱 아님 · 확인 전
  assert.deepEqual(newFeatures(1, 2), ['화면 켜두기', '초대 링크 앱에서 열기']);
  assert.deepEqual(newFeatures(2, 2), []);
});
