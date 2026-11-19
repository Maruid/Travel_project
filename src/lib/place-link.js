// =====================================================================
// 가이드 카드 ↔ 장소 연결 (순수 함수, node 테스트)
//   마크다운 제목 [이름](#place:<id>) → 누르면 장소 상세 (markdown.js 가 버튼으로 바꿈)
//   - AI 카드: "### 1. 이름" 번호를 요청 때 넘긴 장소 id 로 바꿔 저장 (numberedToLinks)
//   - 이미 만든 카드 · 직접 쓴 카드: 제목을 등록한 장소 이름과 비교해 확실할 때만 연결 (linkPlaceHeadings)
// =====================================================================
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const PLACE_HREF_RE = new RegExp(`^#place:(${UUID})$`);
const LINKED_RE = new RegExp(`\\]\\(#place:(${UUID})\\)`, 'g');

const escLabel = (s) => String(s).replace(/[[\]]/g, '').trim();
export const placeLink = (label, id) => `[${escLabel(label)}](#place:${id})`;

// 비교용: 소문자 · 전각/반각 통일 · 공백 · 기호 제거
export function normKey(s) {
  return String(s || '').normalize('NFKC').toLowerCase()
    .replace(/[\s·・.,'’"“”\-_/&!?:()（）[\]【】「」『』]/g, '');
}
// 제목에서 비교할 이름들: 전체(괄호 뺀 것) · 괄호 안
function headingKeys(text) {
  const t = String(text).replace(/^\d+[.)]\s*/, '');
  const inParen = [...t.matchAll(/[(（]([^()（）]+)[)）]/g)].map((m) => m[1]);
  const outside = t.replace(/[(（][^()（）]*[)）]/g, '');
  return [outside, ...inParen].map(normKey).filter((k) => k.length >= 2);
}
const placeKeys = (p) => [p.name, p.local_name].map(normKey).filter((k) => k.length >= 2);

// 제목 글 → 장소 하나 (같은 이름 우선, 없으면 한쪽이 다른 쪽을 포함. 후보가 둘 이상이면 연결 안 함)
export function matchPlace(text, places) {
  const hk = headingKeys(text);
  if (!hk.length) return null;
  const exact = places.filter((p) => placeKeys(p).some((k) => hk.includes(k)));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) return null;
  const part = places.filter((p) => placeKeys(p).some((k) => hk.some((h) =>
    (k.length >= 3 && h.includes(k)) || (h.length >= 3 && k.includes(h)))));
  return part.length === 1 ? part[0] : null;
}

// ## · ### · #### 제목 중 아직 링크가 아닌 것을 장소에 연결
export function linkPlaceHeadings(src, places) {
  if (!src || !places?.length) return src || '';
  return String(src).replace(/^(#{2,4})[ \t]+(.+?)[ \t]*$/gm, (line, hashes, text) => {
    if (/\]\(#place:/.test(text) || /^\[.*\]\(.*\)$/.test(text)) return line;
    const p = matchPlace(text, places);
    return p ? `${hashes} ${placeLink(text, p.id)}` : line;
  });
}

// AI 본문의 "### 1. 이름" → 요청 때 넘긴 순서의 장소 id 로 링크 (번호가 없으면 그대로)
export function numberedToLinks(src, ids) {
  if (!src || !ids?.length) return src || '';
  return String(src).replace(/^(#{2,4})[ \t]*(\d{1,2})[.)][ \t]+(.+?)[ \t]*$/gm, (line, hashes, n, text) => {
    const id = ids[Number(n) - 1];
    return id ? `${hashes} ${placeLink(text, id)}` : `${hashes} ${text}`;
  });
}

// 본문이 이 장소에 연결돼 있나 (저장된 링크 + 이름 비교)
export function linkedPlaceIds(src, places) {
  const out = new Set();
  for (const m of linkPlaceHeadings(src, places).matchAll(LINKED_RE)) out.add(m[1]);
  return out;
}
