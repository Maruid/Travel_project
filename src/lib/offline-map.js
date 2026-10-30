import { MAP_STYLE } from '../config.js';
import { planTiles } from './tile-plan.js';

const CONCURRENCY = 6;

// =====================================================================
// 여행 지역 지도 미리 받기
//  - 등록된 장소를 감싸는 범위의 벡터 타일을 미리 요청 → Service Worker 의 map-tiles 캐시에 저장
//  - OpenMapTiles 벡터 타일은 z14 까지만 있고 그 이상은 z14 를 확대해서 그리므로 z14 까지만 받으면 충분
//  - 무료 서비스 보호를 위해 최대 장수를 제한하고, 넘으면 최대 줌을 낮춤
// =====================================================================

async function tileTemplate() {
  const style = await (await fetch(MAP_STYLE)).json();
  const src = Object.values(style.sources || {}).find((s) => s.type === 'vector');
  if (!src) throw new Error('지도 스타일에서 타일 정보를 찾지 못했습니다.');
  if (src.tiles?.length) return { template: src.tiles[0], maxzoom: src.maxzoom ?? 14 };
  const tj = await (await fetch(src.url)).json();
  return { template: tj.tiles[0], maxzoom: tj.maxzoom ?? 14 };
}

/**
 * @param {{lat:number,lng:number}[]} points
 * @param {(done:number,total:number)=>void} onProgress
 */
export async function downloadTripMap(points, onProgress = () => {}) {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    throw new Error('앱을 한 번 새로고침한 뒤 다시 시도해 주세요. (오프라인 저장소 준비 중)');
  }
  const { template, maxzoom } = await tileTemplate();
  const { tiles, maxZoom } = planTiles(points, Math.min(14, maxzoom));
  if (!tiles.length) throw new Error('위치가 등록된 장소가 없거나 범위가 너무 넓습니다.');

  let done = 0, failed = 0, i = 0;
  onProgress(0, tiles.length);
  async function worker() {
    while (i < tiles.length) {
      const [z, x, y] = tiles[i++];
      const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
      try {
        const res = await fetch(url);   // Service Worker 가 가로채 map-tiles 캐시에 저장
        if (!res.ok) failed++;
      } catch { failed++; }
      onProgress(++done, tiles.length);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { total: tiles.length, failed, maxZoom };
}
