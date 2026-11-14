import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAppLink } from '../src/lib/app-link.js';

test('붙여넣은 링크 → 앱 경로', () => {
  assert.equal(parseAppLink('https://maruid.github.io/Travel_project/#/join/AbC123xyz'), '/join/AbC123xyz');
  assert.equal(parseAppLink('  https://maruid.github.io/Travel_project/#/view/tok_EN-123456 '), '/view/tok_EN-123456');
  assert.equal(parseAppLink('여기로 들어와! https://maruid.github.io/Travel_project/#/join/abcdef12 같이 가자'), '/join/abcdef12');
  assert.equal(parseAppLink('#/join/abcdef12'), '/join/abcdef12');
  assert.equal(parseAppLink('https://example.com/#/trip/abc/places'), null);
  assert.equal(parseAppLink('join/abc'), null);   // 너무 짧음
  assert.equal(parseAppLink(''), null);
  assert.equal(parseAppLink(null), null);
});
