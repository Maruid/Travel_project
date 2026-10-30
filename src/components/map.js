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
  const map = L.map(el, { zoomControl: false, attributionControl: true }).setView(center, zoom);
  map.attributionControl.setPrefix(false);
  L.control.zoom({ position: 'topleft' }).addTo(map);

  const gl = maplibreGL({ style: MAP_STYLE, attribution: ATTRIBUTION }).addTo(map);
  gl.getMaplibreMap().once('error', (e) => {
    // 다크 스타일 URL 이 바뀌었거나 일시 장애면 기본 스타일로 대체
    if (String(e?.error?.message || '').includes('style')) gl.getMaplibreMap().setStyle(MAP_STYLE_FALLBACK);
  });
  return map;
}

export function pinIcon({ color = '#38bdf8', icon = 'fa-location-dot', size = 28, pulse = false } = {}) {
  const safeColor = /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#38bdf8';
  const safeIcon = /^fa-[a-z0-9-]+$/.test(icon) ? icon : 'fa-location-dot';
  return L.divIcon({
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    html: `
      <div class="relative flex items-center justify-center" style="width:${size}px;height:${size}px">
        ${pulse ? `<div class="absolute inset-0 rounded-full pulse-marker" style="background:${safeColor};opacity:.5"></div>` : ''}
        <div class="relative w-full h-full rounded-full flex items-center justify-center border border-white/70 shadow-lg text-white"
             style="background:${safeColor};box-shadow:0 0 10px ${safeColor}b3">
          <i class="fa-solid ${safeIcon} text-[11px]"></i>
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
