import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterTodos, kindCounts, movedSortOrder, linkParts, noteIsLong, packTemplateState, todoPatch } from '../src/lib/todo-view.js';

const rows = [
  { id: 'a', kind: 'todo', done: true, sort_order: 10 },
  { id: 'b', kind: 'shop', done: false, sort_order: 20, assignee: 'M1' },
  { id: 'c', kind: 'todo', done: false, sort_order: 5 },
  { id: 'd', kind: 'place', done: true, sort_order: 1, assignee: 'M1' },
];

test('안 한 것 먼저, 같은 상태 안에서는 순서대로', () => {
  const r = filterTodos(rows);
  assert.deepEqual(r.shown.map((t) => t.id), ['c', 'b', 'd', 'a']);
  assert.equal(r.hiddenDone, 0);
});

test('완료 숨기기 · 분류 · 내 담당', () => {
  const r = filterTodos(rows, { hideDone: true });
  assert.deepEqual(r.shown.map((t) => t.id), ['c', 'b']);
  assert.equal(r.hiddenDone, 2);
  assert.deepEqual(filterTodos(rows, { kind: 'todo' }).shown.map((t) => t.id), ['c', 'a']);
  assert.deepEqual(filterTodos(rows, { mine: 'M1' }).shown.map((t) => t.id), ['b', 'd']);
});

test('분류별 개수', () => {
  const c = kindCounts(rows);
  assert.deepEqual(c.all, { done: 2, total: 4 });
  assert.deepEqual(c.todo, { done: 1, total: 2 });
  assert.deepEqual(c.pack, { done: 0, total: 0 });
  assert.deepEqual(kindCounts(rows, { mine: 'M1' }).all, { done: 1, total: 2 });
});

test('끌어서 옮긴 자리의 sort_order', () => {
  const l = [{ sort_order: 10 }, { sort_order: 20 }, { sort_order: 30 }];
  assert.equal(movedSortOrder(l, 0, 1), 25);
  assert.equal(movedSortOrder(l, 0, 2), 40);
  assert.equal(movedSortOrder(l, 2, 0), 0);
  assert.equal(movedSortOrder(l, 2, 1), 15);
  assert.equal(movedSortOrder(l, 1, 1), null);
  assert.equal(movedSortOrder(l, 0, 5), null);
});

test('메모 링크 나누기', () => {
  assert.deepEqual(linkParts('예약 https://a.com/x?y=1. 끝'), [{ text: '예약 ' }, { url: 'https://a.com/x?y=1' }, { text: '. 끝' }]);
  assert.deepEqual(linkParts('http://a.com 은 그냥 글'), [{ text: 'http://a.com 은 그냥 글' }]);
  assert.deepEqual(linkParts('(https://b.kr)'), [{ text: '(' }, { url: 'https://b.kr' }, { text: ')' }]);
  assert.deepEqual(linkParts(''), []);
});

test('긴 메모', () => {
  assert.equal(noteIsLong('짧음'), false);
  assert.equal(noteIsLong('한 줄\n두 줄'), true);
  assert.equal(noteIsLong(null), false);
});

test('준비물 기본 목록: 이미 있는 제목 표시', () => {
  const s = packTemplateState([{ title: '여권(유효기간 6개월 이상)' }]);
  assert.equal(s[0].exists, true);
  assert.equal(s[1].exists, false);
});

test('바뀐 칸만, 새 칸은 값이 있을 때만', () => {
  assert.deepEqual(todoPatch({}, { kind: 'todo', title: 'a', note: null, place_id: null, day_date: null, assignee: null }), { kind: 'todo', title: 'a' });
  assert.deepEqual(todoPatch({ kind: 'todo', title: 'a', day_date: '2026-11-25' }, { kind: 'todo', title: 'a', day_date: null }), { day_date: null });
  assert.deepEqual(todoPatch({ kind: 'todo', title: 'a' }, { kind: 'shop', title: 'a', assignee: 'M' }), { kind: 'shop', assignee: 'M' });
  assert.deepEqual(todoPatch({ kind: 'todo', title: 'a', note: '' }, { kind: 'todo', title: 'a', note: null }), {});
});
