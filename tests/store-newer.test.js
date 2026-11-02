import test from 'node:test';
import assert from 'node:assert/strict';

// store.js 는 supabase 를 불러오므로 newer 만 따로 꺼내 검사
const src = (await import('node:fs')).readFileSync(new URL('../src/lib/store.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('const CODE_KEYS'), src.indexOf('export class'));
const { newer, keepValidCodes } = await import(`data:text/javascript,${encodeURIComponent(body)}`);

test('더 새 값을 남기고 옛날 응답은 무시', () => {
  const cur = { v: 'new', updated_at: '2026-11-01T12:00:00.123456+00:00' };
  const old = { v: 'old', updated_at: '2026-11-01T12:00:00.12+00:00' };
  assert.equal(newer(cur, old).v, 'new');
  assert.equal(newer(old, cur).v, 'new');
});
test('시간대 표시 없는 실시간 값, 소수점 자릿수 차이', () => {
  const a = { v: 'a', updated_at: '2026-11-01T12:00:01+00:00' };
  const b = { v: 'b', updated_at: '2026-11-01T12:00:00.999999' };
  assert.equal(newer(a, b).v, 'a');
  assert.equal(newer(b, a).v, 'a');
});
test('비어 있으면 들어온 값', () => {
  assert.equal(newer(null, { v: 1 }).v, 1);
  assert.equal(newer({ v: 1 }, null).v, 1);
});

test('잘린 통화 코드는 기존 값 유지', () => {
  const cur = { local_currency: 'JPY', home_currency: 'KRW' };
  const r = keepValidCodes({ local_currency: 'J', home_currency: 'K', rate: 9 }, cur);
  assert.equal(r.local_currency, 'JPY'); assert.equal(r.home_currency, 'KRW'); assert.equal(r.rate, 9);
  assert.equal(keepValidCodes({ local_currency: 'USD' }, cur).local_currency, 'USD');
});
