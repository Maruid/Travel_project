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

// 목록 머리말 (markdown.js labelListItems 와 같은 코드)
const lsrc = src.match(/const LABEL_RE = [\s\S]*?\n}\n/)[0].replace('export function', 'function');
const labelListItems = new Function(`${lsrc}; return labelListItems;`)();

test('목록 머리말을 따로 표시', () => {
  const out = labelListItems(md.parse('- 꼭 볼 것: 디저트\n- **주의:** 취식 금지\n- **영업**: 09:30~19:00'));
  assert.ok(out.includes('<span class="md-label">꼭 볼 것</span>디저트'));
  assert.ok(out.includes('<span class="md-label">주의</span>취식'));
  assert.ok(out.includes('<span class="md-label">영업</span>09:30~19:00'));
});

test('시각 · 주소 · 긴 문장은 그대로', () => {
  const out = labelListItems(md.parse('- 09:30 출발\n- 체크인 15:00 · 체크아웃 11:00\n- https://a.com\n- 아주 길고 긴 설명이 붙어 있는 문장의 머리말: 내용'));
  assert.ok(!out.includes('md-label'));
});
