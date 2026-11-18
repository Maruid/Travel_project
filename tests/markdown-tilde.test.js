import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Marked } from 'marked';
import { readFileSync } from 'node:fs';

// markdown.js 는 DOM 을 써서 node 에서 불러올 수 없음 → 같은 tokenizer 코드를 파일에서 꺼내 시험
const src = readFileSync(new URL('../src/lib/markdown.js', import.meta.url), 'utf8');
const body = src.match(/tokenizer: \{([\s\S]*?)\n  \},\n  renderer/)[1];
const tokenizer = new Function(`return {${body}};`)();
const md = new Marked({ gfm: true, breaks: true, tokenizer });

test('한 개짜리 ~ 는 범위로 그대로', () => {
  const out = md.parse('도보 약 5~6분 / 공항 **약 50~60분** · 09:00~18:00');
  assert.ok(!out.includes('<del>'));
  assert.ok(out.includes('5~6분') && out.includes('50~60분') && out.includes('09:00~18:00'));
});

test('~~ 두 개는 취소선', () => {
  assert.ok(md.parse('~~취소~~ 그대로').includes('<del>취소</del>'));
});
