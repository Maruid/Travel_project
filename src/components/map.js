import 'leaflet/dist/leaflet.css';
import 'maplibre-gl/dist/maplibre-gl.css';
import L from 'leaflet';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { MAP_STYLE, MAP_STYLE_FALLBACK } from '../config.js';
import { esc } from '../lib/dom.js';

setWorkerUrl(workerUrl);

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

  const gl = maplibreGL({ style: MAP_STYLE, attribution: ATTRIBUTION }).addTo(map);
  gl.getMaplibreMap().once('error', (e) => {
    // 다크 스타일 URL 이 바뀌었거나 일시 장애면 기본 스타일로 대체
    if (String(e?.error?.message || '').includes('style')) gl.getMaplibreMap().setStyle(MAP_STYLE_FALLBACK);
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

export function pinIcon({ color = '#38bdf8', icon = 'fa-location-dot', size = 28, pulse = false, faded = false, dot = false, label = '' } = {}) {
  const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#38bdf8';
  const safeIcon = /^fa-[a-z0-9-]+$/.test(icon) ? icon : 'fa-location-dot';
  const box = Math.max(size, HIT);
  const iconPx = size >= 30 ? 12 : size >= 24 ? 11 : 9;
  const glow = faded || dot ? 'none' : `0 0 6px ${safeColor}66`;
  const inner = label
    ? `<span style="font:800 ${size >= 24 ? 12 : 10}px/1 Outfit,sans-serif">${esc(String(label))}</span>`
    : dot ? '' : `<i class="fa-solid ${safeIcon}" style="font-size:${iconPx}px"></i>`;
  return L.divIcon({
    className: '',
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    html: `
      <div class="flex items-center justify-center" style="width:${box}px;height:${box}px">
        <div class="relative flex items-center justify-center" style="width:${size}px;height:${size}px;${faded ? 'opacity:.35;filter:grayscale(1)' : ''}">
          ${pulse ? `<div class="absolute inset-0 rounded-full pulse-marker" style="background:${safeColor}"></div>` : ''}
          <div class="relative w-full h-full rounded-full flex items-center justify-center text-white"
               style="background:${safeColor};border:${dot && size < 12 ? 1 : 1.5}px solid rgba(255,255,255,.75);box-shadow:0 1px 3px rgba(0,0,0,.45)${glow === 'none' ? '' : ',' + glow}">
            ${inner}
          </div>
        </div>
      </div>`,
  });
}

export function draggablePin(map, latlng, onMove) {
  const marker = L.marker(latlng, { draggable: true, icon: pinIcon({ color: '#00f2fe', icon: 'fa-crosshairs', size: 32, pulse: true }) }).addTo(map);
  marker.on('dragend', () => onMove(marker.getLatLng()));
  return marker;
}

export { L, esc };
