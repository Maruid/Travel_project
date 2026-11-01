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

test('delegate: 동작 영역 안의 링크는 동작을 실행하지 않고 링크가 열리게 둔다', () => {
  // 최소한의 DOM 흉내
  const mk = (tag, attrs = {}, parent = null) => {
    const n = { tagName: tag, attrs, parent, dataset: {}, href: attrs.href };
    if (attrs['data-action']) n.dataset.action = attrs['data-action'];
    n.closest = (sel) => {
      for (let x = n; x; x = x.parent) {
        if (sel === '[data-action]' && x.attrs['data-action']) return x;
        if (sel === 'a[href]' && x.tagName === 'A' && x.attrs.href) return x;
      }
      return null;
    };
    n.contains = (o) => { for (let x = o; x; x = x.parent) if (x === n) return true; return false; };
    return n;
  };
  const root = mk('DIV');
  const card = mk('DIV', { 'data-action': 'select' }, root);
  const link = mk('A', { href: 'https://maps.google.com' }, card);
  const icon = mk('I', {}, link);
  const text = mk('SPAN', {}, card);
  let handler; root.addEventListener = (_, h) => { handler = h; };
  const calls = [];
  return import('../src/lib/dom.js').then(({ delegate }) => {
    delegate(root, { select: () => calls.push('select') });
    let prevented = 0;
    handler({ target: icon, preventDefault: () => prevented++ });
    assert.deepEqual(calls, []); assert.equal(prevented, 0);
    handler({ target: text, preventDefault: () => prevented++ });
    assert.deepEqual(calls, ['select']); assert.equal(prevented, 1);
  });
});
