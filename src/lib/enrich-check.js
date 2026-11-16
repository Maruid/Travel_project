// AI 정보 채우기 결과 검수 (순수 함수)
//  knownKind: 구글 분류 또는 사용자가 고른 카테고리의 종류 / aiKind: AI 가 판단한 종류
//  - 종류가 다르면(구글은 역인데 AI 는 식당) 다른 장소 정보일 가능성이 커서 자동으로 넣지 않음
//  - 식당 · 카페 · 술집은 한 묶음으로 봄 (카페 겸 바 같은 곳이 흔함)
const LABEL = { food: '식당', cafe: '카페', bar: '술집', spot: '명소', shop: '쇼핑', lodging: '숙소', transit: '역 · 교통', etc: '기타' };
const family = (k) => (k === 'food' || k === 'cafe' || k === 'bar' ? 'eat' : k);

export function checkEnrich({ knownKind = null, aiKind = null } = {}) {
  if (!knownKind || !aiKind || knownKind === 'etc' || aiKind === 'etc') return { ok: true };
  if (family(knownKind) === family(aiKind)) return { ok: true };
  return {
    ok: false,
    message: `이 장소는 '${LABEL[knownKind] || knownKind}'인데 AI 가 '${LABEL[aiKind] || aiKind}' 정보로 답했어요. 다른 장소(주변 가게 등)의 정보일 수 있어요.`,
  };
}
