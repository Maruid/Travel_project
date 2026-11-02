// 장소 이름 비교 (AI 추천 이름 ↔ 구글에서 찾은 이름)
//  - 띄어쓰기·기호 제거, 전각/반각 통일 후 비교
//  - 한쪽이 다른 쪽을 포함하면 같은 곳으로 봄 ("청년고기집" ↔ "청년고기집 난바점")
//  - 그 외에는 두 글자 묶음(bigram) 겹침 정도로 판단 ("청년고기집" ↔ "청년다방" = 다름)
export const normPlaceName = (s) => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

function bigrams(s) {
  const out = new Set();
  if (s.length === 1) out.add(s);
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

export function nameSimilarity(a, b) {
  a = normPlaceName(a); b = normPlaceName(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) >= 2 ? 0.9 : 0.4;
  const A = bigrams(a); const B = bigrams(b);
  let inter = 0;
  A.forEach((x) => { if (B.has(x)) inter++; });
  return (2 * inter) / (A.size + B.size);
}

export const NAME_MATCH_THRESHOLD = 0.5;
export function namesMatch(candidates, target, threshold = NAME_MATCH_THRESHOLD) {
  return Math.max(0, ...candidates.filter(Boolean).map((c) => nameSimilarity(c, target))) >= threshold;
}
