// =====================================================================
// 장소 탭: 목록 판이 지도 위로 올라오는 움직임 계산 (순수 함수, node 테스트)
//   off      : 목록 판이 올라온 거리 (0 = 지도 전부 보임 ~ max = 작은 지도만 남음)
//   scrollTop: 목록 안 스크롤
//   d > 0    : 내용을 위로 (손가락을 위로) → 판을 먼저 올리고, 남은 만큼 목록을 내림
//   d < 0    : 내용을 아래로 → 목록을 먼저 맨 위까지 올리고, 남은 만큼 판을 내림
// =====================================================================
export function splitScroll(d, { off, max, scrollTop, scrollMax }) {
  if (d > 0) {
    const a = Math.min(d, Math.max(0, max - off));
    return { off: off + a, scrollTop: Math.min(scrollMax, scrollTop + (d - a)) };
  }
  const s = Math.max(d, -scrollTop);
  return { off: Math.max(0, off + (d - s)), scrollTop: scrollTop + s };
}

// 판을 손가락으로 움직일지 (아니면 목록의 기본 스크롤에 맡길지)
//   올릴 때: 판이 덜 올라왔으면. 내릴 때: 판이 올라와 있으면 (목록이 내려가 있어도 이 손짓에서
//   목록을 맨 위까지 올린 뒤 이어서 판을 내림 → 손을 다시 대지 않아도 됨)
export function sheetTakesGesture(up, { off, max }) {
  return up ? off < max : off > 0;
}

// 판이 올라갈 수 있는 거리: 작은 지도(compact)까지, 목록이 짧으면 다 보이는 만큼만
export function sheetMaxOff({ mapPx, compact, rootH, headerH, contentH }) {
  const full = Math.max(0, mapPx - compact);
  const needed = headerH + contentH - (rootH - mapPx);
  return Math.max(0, Math.min(full, needed));
}

// 손을 뗄 때 속도 (px/ms, 마지막 100ms)
export function releaseVelocity(samples, now) {
  const recent = samples.filter((s) => now - s.t <= 100);
  if (recent.length < 2) return 0;
  const a = recent[0]; const b = recent[recent.length - 1];
  const dt = b.t - a.t;
  return dt > 0 ? (a.y - b.y) / dt : 0;   // 손가락이 위로 = +
}
