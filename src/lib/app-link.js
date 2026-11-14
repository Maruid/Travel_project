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
