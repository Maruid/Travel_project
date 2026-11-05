import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFormat } from '../src/lib/md-edit.js';

const sel = (v, a, b) => [v, v.indexOf(a), v.indexOf(a) + (b ?? a).length];

test('굵게: 감싸기 · 다시 누르면 풀기 · 빈 선택은 예시 글자', () => {
  let r = applyFormat('bold', ...sel('오늘 꼭 갈 곳', '꼭'));
  assert.equal(r.value, '오늘 **꼭** 갈 곳');
  assert.equal(r.value.slice(r.start, r.end), '꼭');
  r = applyFormat('bold', r.value, r.start, r.end);
  assert.equal(r.value, '오늘 꼭 갈 곳');
  r = applyFormat('bold', 'ab', 1, 1);
  assert.equal(r.value, 'a**굵게**b');
  assert.equal(applyFormat('bold', ...sel('x 공백 y', ' 공백 ')).value, 'x **공백** y');
});

test('목록 · 번호: 여러 줄, 다시 누르면 풀기, 목록 → 번호 바꿔 끼우기', () => {
  const v = '첫째\n둘째\n\n셋째';
  let r = applyFormat('bullet', v, 0, v.length);
  assert.equal(r.value, '- 첫째\n- 둘째\n\n- 셋째');
  r = applyFormat('number', r.value, 0, r.value.length);
  assert.equal(r.value, '1. 첫째\n2. 둘째\n\n3. 셋째');
  r = applyFormat('number', r.value, 0, r.value.length);
  assert.equal(r.value, v);
  // 커서만 있는 줄
  r = applyFormat('heading', 'a\n제목줄\nb', 3, 3);
  assert.equal(r.value, 'a\n### 제목줄\nb');
});

test('쇼잉 카드: 선택을 ``` 로 감싸고 앞뒤 줄바꿈 보정', () => {
  let r = applyFormat('code', ...sel('뜻:すみません끝', 'すみません'));
  assert.equal(r.value, '뜻:\n```\nすみません\n```\n끝');
  assert.equal(r.value.slice(r.start, r.end), 'すみません');
  r = applyFormat('code', '', 0, 0);
  assert.equal(r.value, '```\n여기에 현지어 문장\n```');
});
