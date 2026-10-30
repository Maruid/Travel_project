// 타일 범위 계산 (순수 함수, node 테스트 가능)

const MAX_TILES = 1500;
const MIN_ZOOM = 10;

const lon2x = (lng, z) => Math.floor(((lng + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

function tilesFor(bbox, z) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const x0 = lon2x(minLng, z), x1 = lon2x(maxLng, z);
  const y0 = lat2y(maxLat, z), y1 = lat2y(minLat, z);
  const out = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([z, x, y]);
  return out;
}

export function bboxOf(points, pad = 0.01) {
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  if (!pts.length) return null;
  const lats = pts.map((p) => p.lat), lngs = pts.map((p) => p.lng);
  return [Math.min(...lngs) - pad, Math.min(...lats) - pad, Math.max(...lngs) + pad, Math.max(...lats) + pad];
}

// 범위를 너무 넓게 잡지 않도록: 장소가 여러 도시에 흩어져 있으면 장소별 주변(반경 약 2km)만 받음
export function planTiles(points, maxZoom = 14) {
  const pts = points.filter((p) => p.lat != null && p.lng != null);
  if (!pts.length) return { tiles: [], maxZoom: 0 };

  for (let zMax = maxZoom; zMax >= MIN_ZOOM; zMax--) {
    const set = new Map();
    const whole = bboxOf(pts);
    // 낮은 줌은 전체 범위, 높은 줌(13~)은 장소 주변만
    for (let z = MIN_ZOOM; z <= zMax; z++) {
      const boxes = z <= 12 ? [whole] : pts.map((p) => bboxOf([p], 0.02));
      for (const b of boxes) for (const t of tilesFor(b, z)) set.set(t.join('/'), t);
    }
    if (set.size <= MAX_TILES) return { tiles: [...set.values()], maxZoom: zMax };
  }
  return { tiles: [], maxZoom: 0 };
}
