// 사용자 입력이 섞이는 HTML 은 반드시 html`` 태그로 만든다.
// - ${값} 은 자동 escape
// - 이미 안전한 HTML 조각은 raw() 로 감싸거나, 다른 html`` 결과를 그대로 넣으면 됨
// - 이벤트는 inline onclick 대신 data-action + 위임으로 처리 (문자열 주입 XSS 방지)

const SAFE = Symbol('safe-html');

export function esc(v) {
  return String(v)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export const raw = (s) => ({ [SAFE]: true, s: String(s) });

function part(v) {
  if (v == null || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  if (typeof v === 'object' && v[SAFE]) return v.s;
  return esc(v);
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => { out += part(v) + strings[i + 1]; });
  return raw(out);
}

export function setHTML(el, safe) {
  el.innerHTML = safe[SAFE] ? safe.s : esc(safe);
}

// data-action 위임: actions = { name(el, event) {...} }
export function delegate(root, actions, eventName = 'click') {
  const handler = (e) => {
    const el = e.target.closest('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  };
  root.addEventListener(eventName, handler);
  return () => root.removeEventListener(eventName, handler);
}

// 폼 값 읽기: <input name="x"> → { x: value }, 빈 문자열은 null
export function formValues(form) {
  const out = {};
  for (const [k, v] of new FormData(form).entries()) {
    const s = typeof v === 'string' ? v.trim() : v;
    out[k] = s === '' ? null : s;
  }
  return out;
}

export const $ = (sel, root = document) => root.querySelector(sel);
