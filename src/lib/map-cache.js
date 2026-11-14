// =====================================================================
// 안드로이드 앱의 지도 오프라인 저장 (웹은 Service Worker 가 같은 일을 함 → 여기 안 씀)
//  - 앱에는 서비스 워커가 없으므로, MapLibre 가 OpenFreeMap 에 보내는 요청을 'tcache://' 로 바꿔
//    직접 처리: 기기 저장소(Cache API)를 먼저 보고, 없으면 받아서 저장
//  - 규칙은 웹 Service Worker 와 같음
//      스타일 · TileJSON  → 최신 우선(4초), 실패하면 저장본       (map-style)
//      벡터 타일 · 글꼴 · 스프라이트 → 저장본 우선, 없으면 받아 저장  (map-tiles, 지도 미리 받기도 여기)
// =====================================================================
import { isApp } from './native.js';

export const MAP_HOST = 'tiles.openfreemap.org';
export const TILE_CACHE = 'map-tiles';
export const STYLE_CACHE = 'map-style';
const PROTOCOL = 'tcache';
const STYLE_TIMEOUT = 4000;

export const useAppMapCache = () => isApp() && typeof caches !== 'undefined';

// ---- 순수 함수 (테스트) ----
export const isTileLike = (url) => /\.pbf$|\/fonts\/|\/sprites\//.test(new URL(url).pathname);
export const toCacheUrl = (url) =>
  (typeof url === 'string' && url.startsWith(`https://${MAP_HOST}/`) ? PROTOCOL + url.slice('https'.length) : null);
export const fromCacheUrl = (url) => 'https' + url.slice(PROTOCOL.length);

// MapLibre transformRequest 에 넣는 함수 (앱일 때만 주소를 바꿈)
export function mapTransformRequest(url) {
  if (!useAppMapCache()) return undefined;
  const to = toCacheUrl(url);
  return to ? { url: to } : undefined;
}

function withTimeout(url, ms, signal) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  signal?.addEventListener?.('abort', () => ctl.abort());
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(t));
}

// 저장소를 거쳐 받기 (지도 미리 받기 · 지도 그리기 공용)
export async function cachedFetch(url, { signal } = {}) {
  const tile = isTileLike(url);
  const cache = await caches.open(tile ? TILE_CACHE : STYLE_CACHE);
  if (tile) {
    const hit = await cache.match(url);
    if (hit) return hit;
    const res = await fetch(url, { signal });
    if (res.ok) await cache.put(url, res.clone()).catch(() => {});
    return res;
  }
  try {
    const res = await withTimeout(url, STYLE_TIMEOUT, signal);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await cache.put(url, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = await cache.match(url);
    if (hit) return hit;
    throw e;
  }
}

let registered = false;
// 앱에서 한 번만: maplibre-gl 의 addProtocol 로 'tcache' 처리기 등록
export function registerMapCache(addProtocol) {
  if (registered || !useAppMapCache()) return;
  registered = true;
  addProtocol(PROTOCOL, async (params, abort) => {
    const res = await cachedFetch(fromCacheUrl(params.url), { signal: abort?.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    if (params.type === 'json') return { data: await res.json() };
    return { data: await res.arrayBuffer() };
  });
}
