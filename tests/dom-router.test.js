import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw } from '../src/lib/dom.js';

test('html`` 은 값을 escape 하고 중첩 html 은 그대로 둔다', () => {
  const name = '<img src=x onerror=alert(1)>"\'';
  const out = html`<b title="${name}">${name}</b>${html`<i>ok</i>`}${raw('<hr>')}${[1, '<x>']}${null}${false}`;
  assert.equal(out.s, '<b title="&lt;img src=x onerror=alert(1)&gt;&quot;&#39;">&lt;img src=x onerror=alert(1)&gt;&quot;&#39;</b><i>ok</i><hr>1&lt;x&gt;');
});

test('라우트 패턴 (router.js 와 같은 변환)', () => {
  const compile = (pattern) => new RegExp('^' + pattern.replace(/:(\w+)(\?)?/g, (_, k, opt) => (opt ? '(?:([^/]+))?' : '([^/]+)'))
    .replace(/\/\(\?:/g, '/?(?:') + '/?$');
  const trip = compile('/trip/:id/:tab?');
  assert.deepEqual('/trip/abc/places'.match(trip).slice(1), ['abc', 'places']);
  assert.deepEqual('/trip/abc'.match(trip).slice(1), ['abc', undefined]);
  assert.deepEqual('/trip/abc/'.match(trip).slice(1), ['abc', undefined]);
  assert.equal('/trip'.match(trip), null);
  assert.deepEqual('/join/tok123'.match(compile('/join/:token')).slice(1), ['tok123']);
  assert.ok(compile('/').test('/'));
  assert.ok(!compile('/').test('/admin'));
});
