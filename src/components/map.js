import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl, addProtocol } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { MAP_STYLE, MAP_STYLE_FALLBACK } from '../config.js';
import { esc } from '../lib/dom.js';
import { registerMapCache, mapTransformRequest, toCacheUrl, useAppMapCache } from '../lib/map-cache.js';

setWorkerUrl(workerUrl);
registerMapCache(addProtocol);   // 안드로이드 앱만: 지도 요청을 기기 저장소로 (웹은 Service Worker)

const ATTRIBUTION = '<a href="https://openfreemap.org" target="_blank">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a>';

// OpenFreeMap 벡터 타일을 쓰는 Leaflet 지도 (키 없음, 출처 표기 필수)
export function createMap(el, { center = [37.5665, 126.978], zoom = 13 } = {}) {
  const map = L.map(el, { zoomControl: false, attributionControl: false }).setView(center, zoom);
  // 출처는 왼쪽 아래 작은 ⓘ 로 접어 두고, 누르면 펼침 (OpenFreeMap 출처 표기 의무)
  const attr = L.control.attribution({ position: 'bottomleft', prefix: false }).addTo(map);
  const attrEl = attr.getContainer();
  attrEl.classList.add('attr-fold');
  attrEl.title = '지도 출처';
  L.DomEvent.on(attrEl, 'click', (e) => {
    if (!attrEl.classList.contains('open')) { L.DomEvent.preventDefault(e); attrEl.classList.add('open'); }
  });
  map.on('click', () => attrEl.classList.remove('open'));
  // 터치 화면은 두 손가락으로 확대·축소하므로 버튼을 두지 않음 (지도를 가리지 않게)
  if (!window.matchMedia?.('(pointer: coarse)').matches) L.control.zoom({ position: 'topright' }).addTo(map);

  // 앱: 스타일 주소부터 저장소 경유 (안의 타일 · 글꼴 주소는 transformRequest 가 바꿈)
  const styleUrl = (u) => (useAppMapCache() ? toCacheUrl(u) || u : u);
  const gl = maplibreGL({ style: styleUrl(MAP_STYLE), attribution: ATTRIBUTION, transformRequest: mapTransformRequest }).addTo(map);
  gl.getMaplibreMap().once('error', (e) => {
    // 다크 스타일 URL 이 바뀌었거나 일시 장애면 기본 스타일로 대체
    if (String(e?.error?.message || '').includes('style')) gl.getMaplibreMap().setStyle(styleUrl(MAP_STYLE_FALLBACK));
  });
  return map;
}

// 줌 단계별 마커 크기 (멀리서는 아이콘 없는 점, 가까이서는 아이콘 핀)
export function pinSize(zoom, { selected = false, anchor = false, visited = false } = {}) {
  if (zoom <= 13) return selected ? 30 : anchor ? 14 : visited ? 8 : 10;
  if (zoom <= 15) return selected ? 32 : anchor ? 24 : visited ? 16 : 20;
  return selected ? 34 : anchor ? 28 : visited ? 20 : 24;
}

const HIT = 32; // 손가락으로 누르기 쉬운 최소 터치 영역

// shape: 'round' | 'square'(숙소), ring: 테두리 색 (번호 핀이 숙소와 같은 장소일 때 등)
export function pinIcon({ color = '#38bdf8', icon = 'fa-location-dot', size = 28, pulse = false, faded = false, dot = false, label = '', shape = 'round', ring = null } = {}) {
  const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#38bdf8';
  const safeIcon = /^fa-[a-z0-9-]+$/.test(icon) ? icon : 'fa-location-dot';
  const box = Math.max(size, HIT);
  const iconPx = size >= 30 ? 12 : size >= 24 ? 11 : 9;
  const glow = faded || dot ? 'none' : `0 0 6px ${safeColor}66`;
  const radius = shape === 'square' ? '28%' : '9999px';
  const border = ring && /^#[0-9a-f]{3,8}$/i.test(ring) ? `2.5px solid ${ring}` : `${dot && size < 12 ? 1 : 1.5}px solid rgba(255,255,255,.75)`;
  const inner = label
    ? `<span style="font:800 ${size >= 26 ? 13 : size >= 22 ? 12 : 10}px/1 Outfit,sans-serif">${esc(String(label))}</span>`
    : dot ? '' : `<i class="fa-solid ${safeIcon}" style="font-size:${iconPx}px"></i>`;
  return L.divIcon({
    className: '',
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `
      <div class="flex items-center justify-center" style="width:${box}px;height:${box}px">
        <div class="relative flex items-center justify-center" style="width:${size}px;height:${size}px;${faded ? 'opacity:.35;filter:grayscale(1)' : ''}">
          ${pulse ? `<div class="absolute inset-0 rounded-full pulse-marker" style="background:${safeColor}"></div>` : ''}
          <div class="relative w-full h-full flex items-center justify-center text-white"
               style="border-radius:${radius};background:${safeColor};border:${border};box-shadow:0 1px 3px rgba(0,0,0,.45)${glow === 'none' ? '' : ',' + glow}">
            ${inner}
          </div>
        </div>
      </div>`,
  });
}

// 동선 지도(일정 탭 · AI 미리보기) 핀 크기: 번호가 늘 읽히도록 점으로 줄이지 않음
//  숙소는 번호 핀보다 10px 큰 사각형 → 번호 핀이 위에 겹쳐도 주황 테두리가 둘러 보임
export function routePinSize(zoom, { hotel = false } = {}) {
  const base = zoom <= 13 ? 20 : zoom <= 15 ? 24 : 28;
  return hotel ? base + 10 : base;
}
export const routeZoomBand = (z) => (z <= 13 ? 0 : z <= 15 ? 1 : 2);

// 선 가운데 진행 방향 화살표 (화면 좌표 기준 각도 → 확대해도 같음)
export function arrowIcon(map, from, to, color) {
  const a = map.project(from, 10); const b = map.project(to, 10);
  const deg = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  const safe = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#f43f5e';
  return L.divIcon({
    className: '', iconSize: [14, 14], iconAnchor: [7, 7],
    html: `<div style="width:14px;height:14px;transform:rotate(${deg}deg);display:flex;align-items:center;justify-content:center">
      <svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1.5 L10.5 6 L2 10.5 Z" fill="${safe}" stroke="rgba(0,0,0,.5)" stroke-width="1"/></svg></div>`,
  });
}

export function draggablePin(map, latlng, onMove) {
  const marker = L.marker(latlng, { draggable: true, icon: pinIcon({ color: '#00f2fe', icon: 'fa-crosshairs', size: 32, pulse: true }) }).addTo(map);
  marker.on('dragend', () => onMove(marker.getLatLng()));
  return marker;
}

export { L, esc };
