// 붙여넣은 초대 · 보기 전용 링크 → 앱 안 경로 (순수 함수)
//   https://maruid.github.io/Travel_project/#/join/abc123  → '/join/abc123'
//   #/view/xyz  ·  /join/abc  → 그대로 경로로. 링크가 아니면 null
const ROUTES = /(?:^|#|\/)(join|view)\/([A-Za-z0-9_-]{6,128})(?=$|[/?#&\s])/;

export function parseAppLink(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const m = ROUTES.exec(s);
  return m ? `/${m[1]}/${m[2]}` : null;
}

// 안드로이드 크롬에서 앱 열기 주소 (Chrome intent): 앱이 없으면 fallback 주소(지금 웹 화면)에 그대로 남음
//   '/join/abc' → intent://join/abc#Intent;scheme=io.github.maruid.travel;package=io.github.maruid.travel;S.browser_fallback_url=…;end
export const APP_PACKAGE = 'io.github.maruid.travel';
export function appIntentUrl(path, fallbackUrl) {
  const p = parseAppLink(path);
  if (!p) return null;
  const fb = fallbackUrl ? `S.browser_fallback_url=${encodeURIComponent(fallbackUrl)};` : '';
  return `intent:/${p}#Intent;scheme=${APP_PACKAGE};package=${APP_PACKAGE};${fb}end`;
}

// 앱이 받은 딥링크 io.github.maruid.travel://join/abc → '/join/abc' (로그인 복귀 · 다른 주소는 null)
export function schemePath(url) {
  const s = String(url || '');
  if (!s.startsWith(`${APP_PACKAGE}://`)) return null;
  return parseAppLink(s.slice(APP_PACKAGE.length));
}
