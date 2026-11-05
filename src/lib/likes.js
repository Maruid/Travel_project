// 찜(❤️): 멤버별로 장소마다 한 줄 (place_likes, migration_011)
//  - id 를 (장소, 멤버)로 계산해 고정 → 같은 사람이 여러 기기에서 눌러도 한 줄
//  - 끄면 liked = false 로 바꿈 (행은 남김)

// 문자열 → 32비트 해시 4개 → UUID 모양 (보안용 아님, 같은 입력이면 항상 같은 값)
function h32(str, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 0x5bd1e995);
    h ^= h >>> 15;
  }
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
export function likeId(placeId, memberId) {
  const key = `like:${placeId}:${memberId}`;
  const hex = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35, 0x27d4eb2f].map((s) => h32(key, s).toString(16).padStart(8, '0')).join('');
  // 버전 자리는 8 (이름 기반 사용자 정의), variant 자리는 RFC 4122 규칙
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

// 장소 id → 찜한 멤버 id 목록 (liked 인 것만, 없어진 멤버 제외)
export function likeMap(likes, activeMemberIds) {
  const map = new Map();
  for (const l of likes) {
    if (!l.liked || l.deleted_at) continue;
    if (activeMemberIds && !activeMemberIds.has(l.member_id)) continue;
    if (!map.has(l.place_id)) map.set(l.place_id, []);
    map.get(l.place_id).push(l.member_id);
  }
  return map;
}
