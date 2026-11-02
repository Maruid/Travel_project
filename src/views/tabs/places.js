import { html, setHTML, delegate, formValues, $, esc } from '../../lib/dom.js';
// 지도 라이브러리(MapLibre, 약 1.2MB)는 따로 불러옴: 장소 리스트를 먼저 보여주고 지도는 준비되는 대로 붙임
let L = null; let createMap = null; let pinIcon = null; let draggablePin = null;
let mapLibPromise = null;
export function loadMapLib() {
  if (!mapLibPromise) {
    mapLibPromise = import('../../components/map.js').then((m) => {
      ({ L, createMap, pinIcon, draggablePin } = m);
      return m;
    }).catch((e) => { mapLibPromise = null; throw e; });
  }
  return mapLibPromise;
}
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { walkInfo, priceRange, priceInHome, distanceKm } from '../../lib/format.js';
import { isCurrencyCode } from '../../lib/currency.js';
import { lookupMapsLink, geocode, currentPosition, enrichPlace } from '../../lib/place-lookup.js';
import { progressTicker, timingText, sourceLabel } from '../../lib/ai-stream.js';
import { isGoogleMapsUrl } from '../../lib/maps-link.js';
import { color, icon } from '../../lib/safe.js';
import {
  fetchPlaceDetails, googleColumns, googleFromPlace, mergeIntoExisting, todayIndexMondayFirst, STATUS_TEXT, REVIEW_DISTANCE_M,
  geoReviewOf, geoReviewList, distanceText,
} from '../../lib/google-place.js';
import { getPref, setPref, getPrefStr, setPrefStr, PREF_MAP_COLLAPSED, PREF_ANCHOR_NEAR_SORT, PREF_PLACE_SORT } from '../../lib/prefs.js';
import { SORTS, sortRows, nextSort, parseSort, sortToString } from '../../lib/place-sort.js';

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

export function googleMapsHref(p) {
  const direct = safeUrl(p.maps_url);
  if (direct) return direct;
  const q = p.map_query || (p.lat != null ? `${p.lat},${p.lng}` : p.name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

// AI 결과의 근거: 읽은 페이지 목록 · AI 가 검색한 말 · 단계별 시간 (정보 채우기와 추천에서 같이 씀)
export function aiEvidence(r) {
  const t = timingText(r.timings);
  return html`
    ${r.queries?.length ? html`<p class="text-slate-300"><span class="text-slate-400">AI가 검색한 말:</span> ${r.queries.join(' · ')}</p>` : ''}
    ${r.sources?.length ? html`
      <div class="space-y-0.5">
        <p class="text-slate-400">참고한 페이지</p>
        ${r.sources.map((s) => html`
          <a href="${s.uri}" target="_blank" rel="noopener" class="flex items-center justify-between gap-2 px-2 py-1 rounded bg-night-950/60 text-purple-200">
            <span class="truncate">${sourceLabel(s)}</span><span class="flex-shrink-0 text-[9px] text-slate-400">열기 <i class="fa-solid fa-arrow-up-right-from-square"></i></span></a>`)}
      </div>` : ''}
    ${t ? html`<p class="text-slate-500">${t}</p>` : ''}`;
}

// 뱃지: 이모지가 들어가도 높이가 같도록 고정 높이 + 가운데 정렬
const BADGE = 'inline-flex items-center gap-0.5 h-[18px] px-1.5 rounded border text-[9px] font-bold leading-none whitespace-nowrap';
const BADGE_COLLAPSED_MAX = 3;   // 접힌 카드에서 보이는 뱃지 수 (나머지는 +N, 펼치면 전부)

function placeBadges(p, cat) {
  const out = [];
  if (cat) out.push(html`<span class="${BADGE}" style="color:${color(cat.color)};border-color:${color(cat.color)}66"><i class="fa-solid ${icon(cat.icon)} text-[8px]"></i>${cat.name}</span>`);
  if (p.warn_badge) out.push(html`<span class="${BADGE} bg-rose-500/20 text-rose-300 border-rose-500/40">⚠️ ${p.warn_badge}</span>`);
  if (p.is_anchor) out.push(html`<span class="${BADGE} bg-amber-500/20 text-amber-300 border-amber-500/30">기준점</span>`);
  if (p.source) out.push(html`<span class="${BADGE} bg-purple-500/20 text-purple-300 border-purple-500/30">📺 ${p.source}</span>`);
  return out;
}

// 전체 보기 범위: 기준점(없으면 지도 중심)에서 이 거리 안의 장소만
const FIT_RADIUS_KM = 50;

// 확대 규칙 (한 곳에서 관리)
const ZOOM_ANCHOR = 15;   // 기준점 · 내 위치 · 기준점으로 초기화: 반경 약 1km
const ZOOM_SELECT = 16;   // 카드·핀 선택: 이보다 멀면 16까지 확대, 이미 더 확대했으면 유지

export function mount(root, store) {
  const state = {
    cat: 'all',
    anchorId: null,        // 기준점 place id 또는 'gps'
    gps: null,
    sort: parseSort(getPrefStr(PREF_PLACE_SORT)),   // { key: distance|rating|price, dir: asc|desc }
    selectedId: null,
    collapsed: getPref(PREF_MAP_COLLAPSED),
    resetNext: 'all',      // 초기화 버튼이 다음에 할 동작: 'all'(전체 보기) ↔ 'anchor'(기준점)
  };

  setHTML(root, html`
    <div id="map-wrap" class="relative w-full h-[38%] min-h-[180px] border-b border-white/10 flex-shrink-0">
      <div id="map-loading" class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
        <i class="fa-solid fa-map mr-1.5"></i>지도 불러오는 중...</div>
      <div id="map" class="w-full h-full z-10"></div>
      <div class="absolute top-3 right-3 z-20 flex items-center gap-1.5">
        <select id="anchor-select" class="h-9 px-2 rounded-xl glass-card bg-night-950/80 text-[11px] text-slate-200 font-bold border border-white/20 max-w-40"></select>
        <button data-action="gps" class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-neon-cyan border border-neon-cyan/40" title="내 위치">
          <i class="fa-solid fa-location-crosshairs text-sm"></i>
        </button>
        <button data-action="reset-view" id="btn-reset-view" class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-slate-200 border border-white/20"></button>
      </div>
      <button data-action="toggle-map" class="absolute bottom-2 right-2 z-20 h-7 px-2.5 rounded-lg glass-card bg-night-950/80 text-[10px] text-slate-200 font-bold border border-white/20">
        <i class="fa-solid fa-chevron-up mr-1"></i>지도 접기</button>
    </div>
    <button data-action="toggle-map" id="map-bar" class="hidden w-full h-9 flex-shrink-0 flex items-center justify-center gap-2 border-b border-white/10 bg-night-950/60 text-[11px] text-slate-300 font-bold">
      <i class="fa-solid fa-map text-neon-cyan"></i><span id="map-bar-text">지도 펼치기</span><i class="fa-solid fa-chevron-down"></i>
    </button>

    <div class="flex-1 min-h-0 flex flex-col px-3 pt-3">
      <div id="cat-chips" class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2 flex-shrink-0"></div>
      <div class="flex items-center justify-between gap-2 text-xs px-1 py-1 mb-1 flex-shrink-0">
        <span id="count-text" class="text-slate-400 text-[11px] truncate min-w-0"></span>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <div id="sort-chips" class="flex items-center gap-1"></div>
          <button data-action="recommend" title="AI 추천" class="text-[11px] px-2 py-0.5 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-400/40 font-bold"><i class="fa-solid fa-wand-magic-sparkles"></i></button>
          <button data-action="add" class="text-[11px] px-2.5 py-0.5 rounded-lg bg-neon-cyan text-night-950 font-black"><i class="fa-solid fa-plus"></i> 추가</button>
        </div>
      </div>
      <button data-action="geo-review" id="geo-banner" class="hidden w-full mb-1.5 px-3 h-8 flex-shrink-0 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 font-bold flex items-center justify-between">
        <span><i class="fa-solid fa-location-dot mr-1"></i><span id="geo-banner-text"></span></span><span class="text-amber-300">검토 <i class="fa-solid fa-chevron-right text-[9px]"></i></span>
      </button>
      <div id="place-scroll" class="flex-1 min-h-0 overflow-y-auto no-scrollbar pb-3">
        <div id="place-list" class="space-y-2"></div>
      </div>
    </div>
  `);

  // 장소 탭은 화면 높이에 맞춘 고정 레이아웃: 위는 지도, 아래 리스트만 스크롤
  //  (헤더와 하단 탭바 높이를 빼서 꽉 채움)
  const prevStyle = { height: root.style.height, paddingBottom: root.style.paddingBottom, flex: root.style.flex };
  const fitHeight = () => {
    const headerH = document.querySelector('header')?.offsetHeight || 56;
    root.style.height = `calc(100dvh - ${headerH}px - 64px)`;
    root.style.paddingBottom = '0';
    root.style.flex = 'none';   // 부모의 flex-1 로 늘어나 하단 탭바 뒤로 리스트가 숨지 않도록
  };
  fitHeight();
  const onResize = () => { fitHeight(); map?.invalidateSize(); };
  window.addEventListener('resize', onResize);

  // ---------- 지도 (라이브러리가 준비되면 생성. 그 전에는 map = null 이고 리스트만 동작) ----------
  let map = null;
  let markerLayer = null;
  let gpsMarker = null;
  let destroyed = false;

  function initMap() {
    if (destroyed || map) return;
    const anchors0 = store.list('places').filter((p) => p.is_anchor && p.lat != null);
    const withCoords0 = store.list('places').filter((p) => p.lat != null);
    const a = anchorPoint();
    const start = a || anchors0[0] || withCoords0[0];
    map = createMap($('#map', root), { center: start ? [start.lat, start.lng] : undefined, zoom: start ? 14 : 3 });
    markerLayer = L.layerGroup().addTo(map);
    $('#map-loading', root)?.remove();
    setTimeout(() => map?.invalidateSize(), 100);
    // 지도의 빈 곳을 누르면 선택 해제 (핀 클릭은 지도로 전달되지 않음)
    map.on('click', () => { if (state.selectedId) select(null); });
    // 지도를 움직인 뒤 기준점 목록 순서 갱신 (목록을 열어둔 중에는 건드리지 않음)
    map.on('moveend', () => {
      if (getPref(PREF_ANCHOR_NEAR_SORT) && document.activeElement !== $('#anchor-select', root)) renderAnchorSelect();
    });
    drawGps();
    renderMarkers(filtered());
    const sel = state.selectedId && store.get('places', state.selectedId);
    if (sel?.lat != null) map.setView([sel.lat, sel.lng], ZOOM_SELECT);
  }

  function drawGps() {
    if (!map || !state.gps) return;
    gpsMarker?.remove();
    gpsMarker = L.marker([state.gps.lat, state.gps.lng], {
      icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8],
        html: '<div class="w-4 h-4 rounded-full bg-neon-cyan border-2 border-white shadow-[0_0_12px_#00f2fe]"></div>' }),
    }).addTo(map);
  }

  function anchorPoint() {
    if (state.anchorId === 'gps') return state.gps;
    const p = store.get('places', state.anchorId);
    return p && p.lat != null ? { lat: p.lat, lng: p.lng, name: p.name } : null;
  }

  function filtered() {
    const from = anchorPoint();
    let rows = store.list('places').map((p) => ({ p, walk: walkInfo(from, p), cat: store.category(p.category_id) }));
    if (state.cat !== 'all') rows = rows.filter((r) => r.p.category_id === state.cat);
    return sortRows(rows, state.sort);
  }

  // 기준점 목록: 설정에서 켜면 "지금 지도 중심에서 가까운 순" (여러 도시를 도는 여행용)
  function renderAnchorSelect() {
    let anchors = store.list('places').filter((p) => p.is_anchor && p.lat != null);
    if (state.anchorId == null && anchors[0]) state.anchorId = anchors[0].id;
    if (map && getPref(PREF_ANCHOR_NEAR_SORT) && anchors.length > 1) {
      const c = map.getCenter();
      const center = { lat: c.lat, lng: c.lng };
      anchors = anchors.map((a) => ({ a, d: walkInfo(center, a).meters })).sort((x, y) => x.d - y.d).map((x) => x.a);
    }
    const sel = $('#anchor-select', root);
    setHTML(sel, html`
      ${anchors.length ? '' : html`<option value="">기준점 없음</option>`}
      ${anchors.map((a) => html`<option value="${a.id}" ${a.id === state.anchorId ? 'selected' : ''}>기준: ${a.name}</option>`)}
      <option value="gps" ${state.anchorId === 'gps' ? 'selected' : ''}>기준: 내 GPS</option>`);
  }

  function renderChips() {
    const places = store.list('places');
    const used = new Map();
    places.forEach((p) => used.set(p.category_id, (used.get(p.category_id) || 0) + 1));
    const cats = store.categories().filter((c) => used.has(c.id));
    setHTML($('#cat-chips', root), html`
      <button data-action="cat" data-cat="all" class="${state.cat === 'all' ? 'chip-active' : 'chip'}">전체 (${places.length})</button>
      ${cats.map((c) => html`
        <button data-action="cat" data-cat="${c.id}" class="${state.cat === c.id ? 'chip-active' : 'chip'}">
          <i class="fa-solid ${c.icon || 'fa-tag'} text-[10px]" style="color:${state.cat === c.id ? 'inherit' : color(c.color)}"></i> ${c.name} (${used.get(c.id)})
        </button>`)}`);
  }

  function renderMarkers(rows) {
    if (!markerLayer) return;
    markerLayer.clearLayers();
    for (const { p, cat } of rows) {
      if (p.lat == null) continue;
      const selected = p.id === state.selectedId;
      const m = L.marker([p.lat, p.lng], {
        icon: pinIcon({ color: cat?.color, icon: cat?.icon, size: selected ? 38 : p.is_anchor ? 34 : 28, pulse: selected || p.is_anchor }),
        zIndexOffset: selected ? 1000 : 0,
      }).addTo(markerLayer);
      // 선택된 핀 위에 이름 라벨 (bindTooltip 은 텍스트를 escape 하지 않으므로 직접 escape)
      if (selected) m.bindTooltip(esc(p.name), { permanent: true, direction: 'top', offset: [0, -20], className: 'pin-label' }).openTooltip();
      m.on('click', () => select(p.id, { from: 'map' }));
    }
  }

  function renderList(rows) {
    const from = anchorPoint();
    $('#count-text', root).textContent = `${rows.length}곳${from ? ` · ${from.name || '내 위치'} 기준` : ''}`;
    // 정렬 칩: 켜진 칩은 방향 이름(예: 별점 높은 순)과 화살표, 다시 누르면 방향 반전
    setHTML($('#sort-chips', root), html`${Object.entries(SORTS).map(([key, def]) => {
      const on = state.sort.key === key;
      return html`<button data-action="sort" data-key="${key}" class="text-[11px] px-2 py-0.5 rounded-lg whitespace-nowrap ${on ? 'bg-neon-cyan/15 text-neon-cyan border border-neon-cyan/50 font-bold' : 'glass-card text-slate-400'}">
        ${on ? html`${def.dirLabel[state.sort.dir]} <i class="fa-solid ${state.sort.dir === 'asc' ? 'fa-arrow-up' : 'fa-arrow-down'} text-[9px]"></i>` : def.label}</button>`;
    })}`);
    const sk = state.sort.key;

    setHTML($('#place-list', root), rows.length ? html`${rows.map(({ p, walk, cat }) => {
      const selected = p.id === state.selectedId;
      const badges = placeBadges(p, cat);
      // 2줄: 별점(리뷰 수) · 가격 · 지역 — 지금 정렬 기준은 강조
      const hl = 'px-1 rounded border';
      const meta = [
        p.rating ? html`<span class="font-bold flex-shrink-0 ${sk === 'rating' ? `${hl} bg-amber-400/15 text-amber-200 border-amber-400/40` : 'text-amber-300'}">★${Number(p.rating).toFixed(1)}${p.rating_count != null ? html`<span class="font-normal text-slate-400"> (${Number(p.rating_count).toLocaleString()})</span>` : ''}</span>` : null,
        priceRange(p) ? html`<span class="font-mono font-bold flex-shrink-0 ${sk === 'price' ? `${hl} bg-emerald-400/15 text-emerald-300 border-emerald-400/40` : 'text-emerald-400'}">${priceRange(p)}</span>${priceInHome(p, store.budget) ? html`<span class="flex-shrink-0 text-slate-400">(${priceInHome(p, store.budget)})</span>` : ''}` : null,
        p.zone ? html`<span class="truncate">${p.zone}</span>` : null,
      ].filter(Boolean);
      return html`
      <div data-action="select" data-id="${p.id}" id="card-${p.id}" class="glass-card p-3 rounded-2xl cursor-pointer hover:border-slate-500 transition ${selected ? 'neon-border-cyan' : ''}">
        <div class="flex gap-2">
          <div class="flex-1 min-w-0 space-y-1">
            <h4 class="font-bold text-[13px] text-white truncate leading-tight">${p.name}</h4>
            ${meta.length ? html`<div class="flex items-center gap-1 text-[10px] text-slate-400 min-w-0 overflow-hidden whitespace-nowrap">
              ${meta.map((m, i) => html`${i ? html`<span class="text-slate-600">·</span>` : ''}${m}`)}</div>` : ''}
            ${badges.length ? html`<div class="flex items-center gap-1 ${selected ? 'flex-wrap' : 'overflow-hidden'}">
              ${selected ? badges : badges.slice(0, BADGE_COLLAPSED_MAX)}
              ${!selected && badges.length > BADGE_COLLAPSED_MAX ? html`<span class="${BADGE} bg-slate-800 text-slate-300 border-white/10">+${badges.length - BADGE_COLLAPSED_MAX}</span>` : ''}
            </div>` : ''}
            ${p.signature || p.description ? html`<p class="text-[11px] truncate">
              ${p.signature ? html`<span class="font-medium text-neon-cyan">${p.signature}</span>` : ''}
              ${p.description ? html`<span class="text-slate-400">${p.signature ? ' · ' : ''}${p.description}</span>` : ''}</p>` : ''}
          </div>
          <div class="flex flex-col items-end justify-between gap-1 flex-shrink-0">
            ${walk.text ? html`<span class="${BADGE} ${sk === 'distance' ? 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50' : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'}">${walk.text}</span>`
              : p.lat == null ? html`<span class="text-[10px] text-slate-500">위치 없음</span>` : html`<span></span>`}
            <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" title="구글 맵 길찾기" class="w-8 h-8 rounded-lg bg-slate-800 text-neon-cyan border border-white/10 flex items-center justify-center text-xs">
              <i class="fa-solid fa-diamond-turn-right"></i></a>
          </div>
        </div>
        ${selected ? html`
          <div class="grid ${state.collapsed && p.lat != null ? 'grid-cols-3' : 'grid-cols-2'} gap-1.5 mt-2.5 pt-2.5 border-t border-white/10">
            ${state.collapsed && p.lat != null ? html`
              <button data-action="show-on-map" data-id="${p.id}" class="py-2 rounded-xl bg-slate-800 text-slate-100 text-[11px] font-bold border border-white/10">
                <i class="fa-solid fa-map-location-dot mr-1 text-neon-cyan"></i>지도에서 보기</button>` : ''}
            <button data-action="detail" data-id="${p.id}" class="py-2 rounded-xl bg-slate-800 text-slate-100 text-[11px] font-bold border border-white/10">
              <i class="fa-solid fa-circle-info mr-1"></i>상세 보기</button>
            <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" class="py-2 rounded-xl bg-neon-cyan text-night-950 text-[11px] font-black text-center">
              <i class="fa-solid fa-diamond-turn-right mr-1"></i>길찾기</a>
          </div>` : ''}
      </div>`;
    })}` : store.list('places').length ? emptyCard('조건에 맞는 장소가 없습니다.') : html`
      <div class="glass-card p-5 rounded-2xl text-center space-y-3">
        <p class="text-xs text-slate-300">아직 등록된 장소가 없어요.</p>
        <div class="grid grid-cols-2 gap-2">
          <button data-action="add" class="btn-ghost py-2.5"><i class="fa-solid fa-plus mr-1"></i>직접 추가</button>
          <button data-action="import-places" class="btn-ghost py-2.5"><i class="fa-solid fa-file-import mr-1"></i>다른 여행에서</button>
        </div>
      </div>`);
  }

  // 장소 선택 (id = null 이면 해제). 지도가 펼쳐져 있으면 그 위치로 이동
  function select(id, { from = 'list' } = {}) {
    state.selectedId = id;
    const p = id ? store.get('places', id) : null;
    if (map && p && p.lat != null && !state.collapsed) {
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), ZOOM_SELECT), { duration: 0.5 });
    }
    const rows = filtered();
    renderMarkers(rows);
    renderList(rows);
    // 선택한 카드가 리스트 위·아래에 걸쳐 있으면 펼쳐진 카드 전체가 보이도록 스크롤
    //  (지도 핀으로 선택한 경우에도 같은 방식으로 카드를 보여줌)
    if (p) requestAnimationFrame(() => document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
  }

  // ---------- 지도 접기 / 펼치기 ----------
  function applyCollapsed() {
    $('#map-wrap', root).classList.toggle('hidden', state.collapsed);
    $('#map-bar', root).classList.toggle('hidden', !state.collapsed);
    const a = anchorPoint();
    $('#map-bar-text', root).textContent = `지도 펼치기${a?.name ? ` · ${a.name} 기준` : ''}`;
    if (!state.collapsed) setTimeout(() => map?.invalidateSize(), 50);
  }
  function setCollapsed(on) {
    state.collapsed = on;
    setPref(PREF_MAP_COLLAPSED, on);
    applyCollapsed();
    renderList(filtered());
  }

  // ---------- 초기화: 기준점(15) ↔ 전체 보기 ----------
  function renderResetButton() {
    const toAll = state.resetNext === 'all';
    const btn = $('#btn-reset-view', root);
    btn.title = toAll ? '전체 보기' : '기준점으로';
    setHTML(btn, toAll ? html`<i class="fa-solid fa-expand text-sm"></i>` : html`<i class="fa-solid fa-house-flag text-sm text-amber-300"></i>`);
  }
  function resetView() {
    if (!map) { toast('지도를 불러오는 중이에요.'); return; }
    if (state.resetNext === 'all') {
      // 기준점(없으면 지도 중심)에서 50km 안만: 잘못 찍힌 핀이나 다른 지역 장소 때문에 지도가 너무 넓어지지 않도록
      const a = anchorPoint();
      const c = a || { lat: map.getCenter().lat, lng: map.getCenter().lng };
      const located = filtered().filter(({ p }) => p.lat != null);
      const inside = located.filter(({ p }) => distanceKm(c, p) <= FIT_RADIUS_KM);
      const far = located.length - inside.length;
      const pts = inside.map(({ p }) => [p.lat, p.lng]);
      if (far) {
        const names = located.filter(({ p }) => distanceKm(c, p) > FIT_RADIUS_KM).slice(0, 2).map(({ p }) => p.name).join(', ');
        toast(`${a ? `${a.name || '기준점'}에서` : '지도 중심에서'} ${FIT_RADIUS_KM}km 넘게 떨어진 ${far}곳은 제외했어요 (${names}${far > 2 ? ' 등' : ''}). 위치가 잘못됐다면 수정해 주세요.`);
      }
      if (pts.length > 1) map.flyToBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: ZOOM_SELECT, duration: 0.6 });
      else if (pts.length === 1) map.flyTo(pts[0], ZOOM_SELECT);
      else toast('지도에 표시할 장소가 없어요.');
      state.resetNext = 'anchor';
    } else {
      const a = anchorPoint();
      if (a) map.flyTo([a.lat, a.lng], ZOOM_ANCHOR, { duration: 0.6 });
      else toast('기준점이 없어요. 장소 상세에서 기준점으로 지정할 수 있어요.');
      state.resetNext = 'all';
    }
    renderResetButton();
  }

  function update() {
    renderAnchorSelect();
    renderChips();
    if (state.selectedId && !store.get('places', state.selectedId)) state.selectedId = null;
    const rows = filtered();
    renderMarkers(rows);
    renderList(rows);
    const pending = geoReviewList(store.list('places'), 'review').length;
    $('#geo-banner', root).classList.toggle('hidden', !pending);
    $('#geo-banner-text', root).textContent = `위치 확인 필요 ${pending}곳`;
  }

  // ---------- 이벤트 ----------
  $('#anchor-select', root).addEventListener('change', (e) => {
    if (e.target.value === 'gps') { locate(); return; }
    state.anchorId = e.target.value || null;
    const a = anchorPoint();
    if (a && !state.collapsed) map?.flyTo([a.lat, a.lng], ZOOM_ANCHOR, { duration: 0.6 });
    state.resetNext = 'all';
    renderResetButton();
    update();
  });

  async function locate() {
    try {
      state.gps = { ...(await currentPosition()), name: '내 위치' };
      state.anchorId = 'gps';
      drawGps();
      if (!state.collapsed) map?.flyTo([state.gps.lat, state.gps.lng], ZOOM_ANCHOR);
      state.resetNext = 'all';
      renderResetButton();
      update();
    } catch (e) {
      toast(e.message, 'error');
      renderAnchorSelect();
    }
  }

  const off = delegate(root, {
    gps: locate,
    'reset-view': resetView,
    'toggle-map': () => setCollapsed(!state.collapsed),
    cat: (el) => { state.cat = el.dataset.cat; update(); },
    sort: (el) => {
      state.sort = nextSort(state.sort, el.dataset.key);
      setPrefStr(PREF_PLACE_SORT, sortToString(state.sort));
      update();
      $('#place-scroll', root).scrollTop = 0;
    },
    add: () => openPlaceEditor(store, null, { near: anchorPoint() }),
    'geo-review': () => openGeoReview(store, 'review'),
    recommend: async () => (await import('../recommend.js')).openRecommend(store, { anchor: anchorPoint() }),
    'import-places': async () => (await import('../place-import.js')).openPlaceImport(store),
    // 카드 탭: 지도에서 위치 확인 + 버튼 줄 펼침. 선택된 카드를 다시 누르거나 위치가 없으면 상세
    select: (el, e) => {
      if (e.target.closest('button')) return;   // 펼쳐진 버튼 줄의 버튼은 각자 동작
      const id = el.dataset.id;
      const p = store.get('places', id);
      if (!p) return;
      if (p.lat == null || state.selectedId === id) openPlaceDetail(store, id, anchorPoint());
      else select(id);
    },
    detail: (el) => openPlaceDetail(store, el.dataset.id, anchorPoint()),
    'show-on-map': (el) => {
      setCollapsed(false);
      const p = store.get('places', el.dataset.id);
      if (p?.lat != null) setTimeout(() => map?.flyTo([p.lat, p.lng], Math.max(map.getZoom(), ZOOM_SELECT), { duration: 0.5 }), 80);
    },
  });

  applyCollapsed();
  renderResetButton();
  update();
  // 리스트를 먼저 그린 뒤 지도 라이브러리를 불러와 붙임
  loadMapLib().then(initMap).catch(() => {
    const el = $('#map-loading', root);
    if (el) el.textContent = '지도를 불러오지 못했어요. 온라인 상태에서 다시 열어주세요.';
  });

  return {
    update,
    destroy: () => {
      off();
      window.removeEventListener('resize', onResize);
      root.style.height = prevStyle.height;
      root.style.paddingBottom = prevStyle.paddingBottom;
      root.style.flex = prevStyle.flex;
      destroyed = true;
      map?.remove();
    },
  };
}

// =====================================================================
// 상세 시트
// =====================================================================
export function openPlaceDetail(store, id, from) {
  const p = store.get('places', id);
  if (!p) return;
  const cat = store.category(p.category_id);
  const walk = walkInfo(from, p);
  const yt = safeUrl(p.youtube_url);

  openSheet(html`
    <div class="flex items-center justify-between mb-1">
      <div class="flex items-center gap-1.5 flex-wrap">
        ${placeBadges(p, cat)}
      </div>
      <span class="text-xs font-bold text-emerald-400">${walk.text}</span>
    </div>
    <h3 class="text-lg font-black text-white mt-1">${p.name}</h3>
    <div class="flex items-center justify-between text-xs text-slate-400 mb-3">
      <span>${p.zone || ''}</span>
      <span class="text-right"><span class="font-mono text-emerald-400 font-bold">${priceRange(p)}</span>${priceInHome(p, store.budget) ? html`<span class="block text-[10px] text-slate-400">${priceInHome(p, store.budget)}</span>` : ''}</span>
    </div>
    ${geoReviewCard(p)}
    ${googleBlock(p, store.trip.timezone)}
    <div class="space-y-2 text-xs">
      ${p.signature ? html`<div class="p-3 rounded-2xl glass-card"><span class="text-[10px] font-bold text-slate-400 block mb-0.5">대표 메뉴 & 볼거리</span><p class="font-bold text-white">${p.signature}</p></div>` : ''}
      ${p.description ? html`<div class="p-3 rounded-2xl glass-card"><span class="text-[10px] font-bold text-slate-400 block mb-0.5">상세 안내</span><p class="text-slate-300 leading-relaxed whitespace-pre-line">${p.description}</p></div>` : ''}
      ${p.visit_tip ? html`<div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30"><span class="text-[10px] font-bold text-amber-400 block mb-0.5">웨이팅 / 방문 팁</span><p class="text-amber-200 font-medium">${p.visit_tip}</p></div>` : ''}
    </div>
    ${yt ? html`<a href="${yt}" target="_blank" rel="noopener" class="w-full mt-3 py-2.5 rounded-xl bg-red-600/20 text-red-300 border border-red-500/40 font-bold text-xs flex items-center justify-center gap-2">
      <i class="fa-brands fa-youtube text-red-500 text-sm"></i> 유튜브 영상 보기</a>` : ''}
    <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" class="btn-primary mt-2 flex items-center justify-center gap-1.5">
      <i class="fa-solid fa-diamond-turn-right"></i> 구글 맵에서 길찾기</a>
    <button data-action="google-refresh" class="btn-ghost w-full py-2.5 mt-2">
      <i class="fa-brands fa-google mr-1"></i>${p.google_place_id ? '구글 정보 다시 가져오기' : '구글 정보 가져오기'}
      ${p.google_synced_at ? html`<span class="text-[10px] text-slate-500 font-normal ml-1">(${String(p.google_synced_at).slice(0, 10)})</span>` : ''}
    </button>
    ${p.lat != null ? html`
      <button data-action="toggle-anchor" class="w-full mt-2 py-2.5 rounded-xl text-xs font-bold border ${p.is_anchor ? 'bg-amber-500/15 text-amber-200 border-amber-500/40' : 'bg-slate-800 text-slate-200 border-white/10'}">
        <i class="fa-solid fa-house-flag mr-1"></i>${p.is_anchor ? '기준점 해제' : '거리 계산 기준점으로 지정'}</button>` : ''}
    <div class="grid grid-cols-2 gap-2 mt-2">
      <button data-action="edit" class="btn-ghost py-2.5"><i class="fa-solid fa-pen mr-1"></i>수정</button>
      <button data-action="delete" class="btn-ghost py-2.5 text-rose-300"><i class="fa-solid fa-trash-can mr-1"></i>삭제</button>
    </div>
  `, (el) => delegate(el, {
    edit: () => openPlaceEditor(store, id, { near: from }),
    'geo-open': () => openGeoReview(store, geoReviewOf(p).type, { startId: id, onDone: () => openPlaceDetail(store, id, from) }),
    'geo-keep': () => {
      store.update('places', id, { geo_review: null });
      toast('지금 위치를 그대로 두었어요.');
      openPlaceDetail(store, id, from);
    },
    'toggle-anchor': () => {
      const on = !p.is_anchor;
      store.update('places', id, { is_anchor: on });
      toast(on ? `"${p.name}" 을(를) 기준점으로 지정했어요. 지도 위 기준 목록에서 고를 수 있어요.` : '기준점에서 해제했어요.');
      openPlaceDetail(store, id, from);
    },
    'google-refresh': async (b) => {
      if (b.dataset.busy) return;
      b.dataset.busy = '1';
      b.textContent = '구글 정보 가져오는 중...';
      try {
        const r = await refreshFromGoogle(store, p);
        toast(r.review
          ? `구글 위치가 기존 핀과 ${r.review.distance}m 떨어져 있어 위치는 바꾸지 않았어요. 다른 지점인지 확인해 주세요.`
          : '구글 정보를 반영했어요.', r.review ? 'error' : 'info');
        openPlaceDetail(store, id, from);
      } catch (e) {
        toast(e.message, 'error');
        delete b.dataset.busy;
        b.textContent = '구글 정보 가져오기';
      }
    },
    delete: () => {
      if (!confirmAction(`"${p.name}" 을(를) 삭제할까요?`)) return;
      store.remove('places', id);
      closeSheet();
      toast('삭제했습니다.');
    },
  }));
}

// =====================================================================
// 추가/수정 시트: 링크 붙여넣기 → 좌표 자동 추출 → 미니 지도에서 핀 확인
// =====================================================================
export async function openPlaceEditor(store, id, { near, prefill = null } = {}) {
  await loadMapLib();   // 위치 선택 미니 지도용
  const p = id ? store.get('places', id) : {};
  const cats = store.categories();
  const pos = { lat: p.lat ?? null, lng: p.lng ?? null };

  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '장소 수정' : '새 장소 추가'}</h3>

    <div class="glass-card p-3 rounded-2xl space-y-2 mb-3">
      <label class="label">구글 맵 링크로 가져오기</label>
      <div class="flex gap-1.5">
        <input id="link-input" class="input" placeholder="maps.app.goo.gl/... 또는 google.com/maps/..." value="${p.maps_url || ''}">
        <button data-action="fetch-link" class="btn-ghost flex-shrink-0">가져오기</button>
      </div>
      <div class="flex gap-1.5">
        <input id="search-input" class="input" placeholder="주소나 장소 이름으로 검색">
        <button data-action="search" class="btn-ghost flex-shrink-0">검색</button>
      </div>
      <div id="search-results" class="space-y-1"></div>
      <div class="relative h-44 rounded-xl overflow-hidden border border-white/10">
        <div id="picker-map" class="w-full h-full"></div>
        <div id="picker-hint" class="absolute inset-x-0 bottom-0 z-[500] text-center text-[10px] bg-night-950/80 py-1 text-slate-300">지도를 눌러 위치를 지정하세요</div>
      </div>
      <div class="flex items-center justify-between text-[10px]">
        <span id="coord-text" class="font-mono text-slate-400"></span>
        <div class="flex gap-1.5">
          <button data-action="here" class="btn-ghost !py-1"><i class="fa-solid fa-location-crosshairs mr-1"></i>현재 위치</button>
          <button data-action="clear-pos" class="btn-ghost !py-1 text-slate-400">위치 지우기</button>
        </div>
      </div>
      <div class="flex items-center justify-between gap-2 pt-1 border-t border-white/5">
        <span id="google-status" class="text-[10px] text-slate-400 min-w-0">구글 지도 정보: 링크를 넣으면 자동으로 가져와요</span>
        <button data-action="google" class="btn-ghost !py-1 flex-shrink-0"><i class="fa-brands fa-google mr-1"></i>가져오기</button>
      </div>
    </div>

    <form id="place-form" class="space-y-2.5">
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="label !mb-0">이름 *</label>
          <button type="button" data-action="ai-fill" class="text-[10px] px-2 py-0.5 rounded-lg bg-purple-500/20 text-purple-200 border border-purple-400/40 font-bold">
            <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>AI로 정보 채우기</button>
        </div>
        <input name="name" class="input" required maxlength="100" value="${p.name || ''}">
        <div id="ai-result" class="hidden mt-2 p-2.5 rounded-xl bg-purple-500/10 border border-purple-400/30 text-[10px] text-purple-100 space-y-1.5"></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">카테고리</label>
          <select name="category_id" class="input">
            <option value="">없음</option>
            ${cats.map((c) => html`<option value="${c.id}" ${c.id === p.category_id ? 'selected' : ''}>${c.name}${c.trip_id ? '' : ' (기본)'}</option>`)}
          </select></div>
        <div><label class="label">지역</label><input name="zone" class="input" maxlength="50" value="${p.zone || ''}" placeholder="예: 난바"></div>
      </div>
      <div><label class="label">대표 메뉴 / 볼거리</label><input name="signature" class="input" maxlength="200" value="${p.signature || ''}"></div>
      <div><label class="label">상세 안내</label><textarea name="description" class="input" rows="3" maxlength="2000">${p.description || ''}</textarea></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">웨이팅 / 방문 팁</label><input name="visit_tip" class="input" maxlength="300" value="${p.visit_tip || ''}"></div>
        <div><label class="label">주의 뱃지</label><input name="warn_badge" class="input" maxlength="30" value="${p.warn_badge || ''}" placeholder="예: 화요 휴무"></div>
      </div>
      <div class="grid grid-cols-[1fr_1fr_auto] gap-2">
        <div><label class="label">최저가</label><input name="price_min" type="number" min="0" step="any" class="input" value="${p.price_min ?? ''}"></div>
        <div><label class="label">최고가</label><input name="price_max" type="number" min="0" step="any" class="input" value="${p.price_max ?? ''}"></div>
        <div><label class="label">통화</label><input name="price_currency" class="input w-16 uppercase" maxlength="3" value="${isCurrencyCode(p.price_currency) ? p.price_currency : isCurrencyCode(store.budget?.local_currency) ? store.budget.local_currency : ''}"></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">출처</label><input name="source" class="input" maxlength="50" value="${p.source || ''}" placeholder="예: 유튜버 이름"></div>
        <div><label class="label">유튜브 링크</label><input name="youtube_url" class="input" maxlength="500" value="${p.youtube_url || ''}"></div>
      </div>
      <label class="flex items-center gap-2 text-xs text-slate-300 py-1">
        <input type="checkbox" name="is_anchor" ${p.is_anchor ? 'checked' : ''} class="accent-cyan-400"> 거리 계산 기준점으로 사용 (숙소, 역 등)
      </label>
      <button class="btn-primary" type="submit">${id ? '수정 저장' : '장소 추가'}</button>
    </form>
  `, (el) => {
    // ----- 위치 선택 미니 지도 -----
    const center = pos.lat != null ? [pos.lat, pos.lng] : near ? [near.lat, near.lng] : [35.68, 139.76];
    const pm = createMap($('#picker-map', el), { center, zoom: pos.lat != null || near ? 15 : 4 });
    let pin = null;
    setTimeout(() => pm.invalidateSize(), 300);

    function setPos(lat, lng, { fly = true, note = '' } = {}) {
      pos.lat = lat; pos.lng = lng;
      if (lat == null) { pin?.remove(); pin = null; renderCoord(note); return; }
      if (!pin) pin = draggablePin(pm, [lat, lng], (ll) => { pos.lat = +ll.lat.toFixed(6); pos.lng = +ll.lng.toFixed(6); renderCoord('핀 위치 조정됨'); });
      else pin.setLatLng([lat, lng]);
      if (fly) pm.setView([lat, lng], 16);
      renderCoord(note);
    }
    function renderCoord(note) {
      $('#coord-text', el).textContent = pos.lat != null ? `${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}${note ? ` · ${note}` : ''}` : (note || '위치 없음 (지도에 표시되지 않음)');
      $('#picker-hint', el).classList.toggle('hidden', pos.lat != null);
    }
    if (pos.lat != null) setPos(pos.lat, pos.lng, { fly: false }); else renderCoord();
    pm.on('click', (e) => setPos(+e.latlng.lat.toFixed(6), +e.latlng.lng.toFixed(6), { fly: false, note: '직접 지정' }));

    const form = $('#place-form', el);
    function renderAiResult(r, count) {
      const box = $('#ai-result', el);
      setHTML(box, html`
        <p><i class="fa-solid fa-wand-magic-sparkles mr-1"></i><b>AI 초안</b>${count ? ` · ${count}개 항목 채움` : ''} · 가격·휴무는 틀릴 수 있으니 확인하세요.
          ${!r.grounded ? html`<span class="text-amber-300">검색 없이 만든 결과라 대표 메뉴·소개만 채웠어요.</span>`
            : !r.sources?.length ? html`<span class="text-slate-300">검색은 했지만 근거 링크를 받지 못했어요.</span>` : ''}</p>
        ${!r.grounded && hasEstimate(r.fields) ? html`
          <div class="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-100 space-y-1">
            <p><b>AI 추정 (검색 근거 없음)</b></p>
            ${r.fields.price_min || r.fields.price_max ? html`<p>1인 ${r.fields.price_min ?? '?'} ~ ${r.fields.price_max ?? '?'} ${r.fields.price_currency || ''}</p>` : ''}
            ${r.fields.warn_badge ? html`<p>주의: ${r.fields.warn_badge}</p>` : ''}
            ${r.fields.visit_tip ? html`<p>팁: ${r.fields.visit_tip}</p>` : ''}
            <button type="button" data-action="ai-apply-estimate" class="px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 font-bold">그래도 빈 칸에 넣기</button>
          </div>` : ''}
        ${aiEvidence(r)}`);
      box._estimate = r.grounded ? null : r.fields;
      box.classList.remove('hidden');
    }

    function hasEstimate(f = {}) {
      return f.price_min != null || f.price_max != null || f.warn_badge || f.visit_tip;
    }

    // 실패 시 어떤 모델/한도에 걸렸는지 보여줌 (원인 파악용)
    function renderAiError(e) {
      if (!e.attempts?.length) return;
      const box = $('#ai-result', el);
      setHTML(box, html`
        <p class="text-rose-200"><b>AI 호출 실패 상세</b> (이 내용을 알려주시면 원인을 바로 알 수 있어요)</p>
        ${e.attempts.map((a) => html`<p class="font-mono break-all text-slate-300">${a.model} · ${a.grounded ? '검색' : '검색 없음'} · ${a.status}${a.quota ? ` · ${a.quota}` : ''}</p>`)}`);
      box.classList.remove('hidden');
    }

    const autoFilled = {};   // 필드명 → { value, source } 마지막으로 자동 입력한 값
    // source: 'link' | 'google' | 'ai'. 구글이 채운 사실 정보는 AI 가 덮어쓰지 않음
    const fill = (name, value, source = 'link') => {
      const input = form.elements[name];
      if (!input || value == null || value === '') return false;
      const cur = input.value.trim();
      const prev = autoFilled[name];
      if (cur && cur !== prev?.value) return false;                       // 사용자가 직접 쓴 값은 보존
      if (cur && prev?.source === 'google' && source === 'ai') return false;
      input.value = String(value);
      autoFilled[name] = { value: input.value.trim(), source };
      const ring = source === 'google' ? 'ring-emerald-400/60' : 'ring-purple-400/60';
      input.classList.add('ring-1', ring);
      setTimeout(() => input.classList.remove('ring-1', ring), 1500);
      return true;
    };

    // ----- 구글 장소 정보 -----
    let google = googleFromPlace(p);   // 저장 시 함께 기록
    let googleChanged = false;         // 이번 편집에서 새로 가져왔을 때만 구글 칸을 저장
    function renderGoogleStatus(text, tone = 'muted') {
      const elS = $('#google-status', el);
      elS.className = `text-[10px] min-w-0 ${tone === 'ok' ? 'text-emerald-300' : tone === 'warn' ? 'text-amber-300' : tone === 'error' ? 'text-rose-300' : 'text-slate-400'}`;
      elS.textContent = text;
    }
    if (google) {
      renderGoogleStatus(`구글 지도 정보 있음${google.rating ? ` · ★${google.rating}` : ''}${google.openingHours?.weekday?.length ? ' · 영업시간' : ''}`, 'ok');
    }

    async function loadGoogle({ name, address, lat, lng, cacheKey, auto = false } = {}) {
      const q = {
        tripId: store.tripId,
        placeId: google?.placeId || null,
        name: name || form.elements.name.value.trim() || null,
        address: address || null,
        zone: form.elements.zone.value.trim() || null,
        destination: store.trip.destination || null,
        lat: lat ?? pos.lat, lng: lng ?? pos.lng,
      };
      if (!q.placeId && !q.name) { if (!auto) toast('이름을 먼저 입력하거나 링크를 넣어 주세요.', 'error'); return; }
      renderGoogleStatus('구글 지도에서 정보를 가져오는 중...');
      try {
        const r = await fetchPlaceDetails(q, { cacheKey });
        const g = r.place;
        google = g;
        googleChanged = true;
        const far = r.distance != null && r.distance > REVIEW_DISTANCE_M;
        fill('name', g.name, 'google');
        if (g.lat != null && !far) setPos(g.lat, g.lng, { note: '구글 지도 위치' });
        fill('zone', g.zone, 'google');
        if (g.priceMin || g.priceMax) {
          fill('price_min', g.priceMin, 'google');
          fill('price_max', g.priceMax, 'google');
          fill('price_currency', g.priceCurrency, 'google');
        }
        if (g.warnBadge) {
          const closed = g.businessStatus === 'CLOSED_PERMANENTLY' || g.businessStatus === 'CLOSED_TEMPORARILY';
          if (closed) { form.elements.warn_badge.value = g.warnBadge; autoFilled.warn_badge = { value: g.warnBadge, source: 'google' }; }
          else fill('warn_badge', g.warnBadge, 'google');
        }
        const catSel = form.elements.category_id;
        if (g.kind && !catSel.value) {
          const c = store.globalCategories.find((x) => x.kind === g.kind);
          if (c) catSel.value = c.id;
        }
        // 새 장소이고 숙소·역이면 거리 계산 기준점으로 미리 체크 (해제 가능)
        if (!id && (g.kind === 'lodging' || g.kind === 'transit') && !form.elements.is_anchor.dataset.touched) {
          form.elements.is_anchor.checked = true;
        }
        const parts = [g.rating ? `★${g.rating}${g.ratingCount ? ` (${g.ratingCount.toLocaleString()})` : ''}` : null,
          g.openingHours?.weekday?.length ? '영업시간' : null, g.priceMin || g.priceMax ? '가격대' : null].filter(Boolean);
        if (far) {
          renderGoogleStatus(`구글 위치가 링크 위치와 ${r.distance}m 떨어져 있어요. 다른 지점일 수 있으니 이름을 확인하세요.`, 'warn');
        } else if (g.businessStatus === 'CLOSED_PERMANENTLY') {
          renderGoogleStatus('구글 지도에 폐업으로 표시된 곳이에요.', 'error');
        } else {
          renderGoogleStatus(`구글 지도 정보 반영${parts.length ? ` · ${parts.join(' · ')}` : ''}`, 'ok');
        }
      } catch (e) {
        renderGoogleStatus(e.code === 'OFFLINE' ? '오프라인이라 구글 정보를 가져오지 못했어요.' : e.message, 'error');
        if (!auto) toast(e.message, 'error');
      }
    }

    async function fetchLink() {
      const url = $('#link-input', el).value.trim();
      if (!url) return;
      if (!isGoogleMapsUrl(url)) { toast('구글 맵 링크가 아닙니다.', 'error'); return; }
      const btn = el.querySelector('[data-action="fetch-link"]');
      btn.disabled = true; btn.textContent = '...';
      try {
        const r = await lookupMapsLink(url);
        fill('name', r.name);
        if (r.lat != null) setPos(r.lat, r.lng, { note: r.precision === 'pin' ? '링크에서 가져옴' : '지도 중심 좌표 · 핀을 확인하세요' });
        // 링크를 붙여넣으면 구글 지도 정보 자동 조회 (같은 링크는 다시 조회하지 않음)
        if (r.name || r.address) {
          google = null;   // 다른 장소 링크로 바꾼 경우 이전 place_id 를 쓰지 않도록
          await loadGoogle({ name: r.name, address: r.address, lat: r.lat, lng: r.lng, cacheKey: `link:${r.resolvedUrl || url}`, auto: true });
        }
        if (pos.lat == null && r.query) {
          // 구글 조회도 실패한 경우에만 무료 주소 검색으로 대체
          $('#search-input', el).value = r.query;
          toast('위치를 찾지 못해 주소로 검색합니다. 결과를 고른 뒤 핀을 확인해 주세요.');
          await search();
        } else if (pos.lat == null) {
          toast('링크에서 위치를 찾지 못했습니다. 지도를 눌러 지정해 주세요.', 'error');
        }
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        btn.disabled = false; btn.textContent = '가져오기';
      }
    }

    let lastSearch = 0;
    async function search() {
      const q = $('#search-input', el).value.trim();
      if (!q) return;
      if (Date.now() - lastSearch < 1100) return;   // Nominatim 초당 1회 제한
      lastSearch = Date.now();
      const box = $('#search-results', el);
      setHTML(box, html`<p class="text-[10px] text-slate-400">검색 중...</p>`);
      try {
        const rows = await geocode(q, { near: pos.lat != null ? pos : near });
        setHTML(box, rows.length ? html`${rows.map((r, i) => html`
          <button type="button" data-action="pick" data-i="${i}" class="w-full text-left text-[11px] px-2 py-1.5 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-200 truncate">
            <i class="fa-solid fa-location-dot text-neon-cyan mr-1"></i>${r.label}</button>`)}`
          : html`<p class="text-[10px] text-slate-400">검색 결과가 없습니다. 지도를 눌러 직접 지정해 주세요.</p>`);
        box._rows = rows;
      } catch (e) {
        setHTML(box, html`<p class="text-[10px] text-rose-300">${e.message}</p>`);
      }
    }

    const off = delegate(el, {
      'fetch-link': fetchLink,
      search,
      pick: (b) => {
        const r = $('#search-results', el)._rows?.[+b.dataset.i];
        if (!r) return;
        setPos(r.lat, r.lng, { note: '검색 결과' });
        fill('name', r.name);
        setHTML($('#search-results', el), html``);
      },
      here: async () => {
        try { const g = await currentPosition(); setPos(g.lat, g.lng, { note: '현재 위치' }); }
        catch (e) { toast(e.message, 'error'); }
      },
      'clear-pos': () => setPos(null, null, { note: '위치 없음' }),
      google: async (b) => {
        if (b.dataset.busy) return;
        b.dataset.busy = '1';
        try { await loadGoogle(); } finally { delete b.dataset.busy; }
      },
      'ai-fill': async (b) => {
        const name = form.elements.name.value.trim();
        if (!name) { toast('이름을 먼저 입력하거나 링크로 가져와 주세요.', 'error'); return; }
        if (b.dataset.busy) return;
        b.dataset.busy = '1';
        const label = b.innerHTML;
        const ticker = progressTicker((text) => { b.textContent = text; });
        try {
          const r = await enrichPlace({
            tripId: store.tripId, name,
            zone: form.elements.zone.value.trim() || null,
            destination: store.trip.destination || null,
            lat: pos.lat, lng: pos.lng,
            mapsUrl: $('#link-input', el).value.trim() || null,
            currency: store.budget?.local_currency || null,
            facts: google ? {
              hours: google.openingHours?.weekday || [],
              priceMin: google.priceMin ?? null, priceMax: google.priceMax ?? null, priceCurrency: google.priceCurrency ?? null,
              closed: google.warnBadge || null,
            } : null,
          }, ticker.onEvent);
          const f = r.fields || {};
          // 검색 근거가 없으면 틀리기 쉬운 값(가격·휴무·팁)은 자동으로 넣지 않고 "추정"으로만 보여줌
          const textKeys = r.grounded ? ['signature', 'description', 'visit_tip', 'warn_badge', 'zone'] : ['signature', 'description', 'zone'];
          const filled = textKeys.filter((k) => fill(k, f[k], 'ai'));
          if (r.grounded) {
            if (fill('price_min', f.price_min, 'ai')) filled.push('price_min');
            if (fill('price_max', f.price_max, 'ai')) filled.push('price_max');
            if (f.price_currency) fill('price_currency', f.price_currency, 'ai');
          }
          // 카테고리가 비어 있으면 같은 종류의 기본 카테고리를 선택
          const catSel = form.elements.category_id;
          if (f.kind && !catSel.value) {
            const c = store.globalCategories.find((x) => x.kind === f.kind);
            if (c) { catSel.value = c.id; filled.push('category'); }
          }
          renderAiResult(r, filled.length);
          toast(filled.length ? `${filled.length}개 항목을 채웠어요. 확인 후 저장하세요.` : '새로 채울 수 있는 정보가 없었어요.');
        } catch (e) {
          toast(e.message, 'error');
          renderAiError(e);
        } finally {
          ticker.stop();
          delete b.dataset.busy;
          b.innerHTML = label;
        }
      },
      'ai-apply-estimate': () => {
        const est = $('#ai-result', el)._estimate || {};
        const done = ['price_min', 'price_max', 'price_currency', 'visit_tip', 'warn_badge'].filter((k) => est[k] != null && fill(k, est[k], 'ai'));
        toast(done.length ? '추정값을 넣었어요. 꼭 확인해 주세요.' : '넣을 수 있는 빈 칸이 없어요.');
      },
    });
    $('#link-input', el).addEventListener('paste', () => setTimeout(fetchLink, 0));
    // 사용자가 기준점 체크를 직접 바꿨으면 자동 체크하지 않음
    form.elements.is_anchor.addEventListener('change', (e) => { e.target.dataset.touched = '1'; });

    // AI 추천에서 [추가]로 온 경우: 추천 내용을 초안으로 넣고 구글 지도에서 실제 장소를 확인
    if (prefill && !id) {
      fill('name', prefill.name, 'ai');
      fill('zone', prefill.zone, 'ai');
      fill('description', prefill.reason, 'ai');
      fill('warn_badge', prefill.warn, 'ai');
      if (prefill.price_min != null || prefill.price_max != null) {
        fill('price_min', prefill.price_min, 'ai');
        fill('price_max', prefill.price_max, 'ai');
        fill('price_currency', prefill.currency, 'ai');
      }
      const c = prefill.kind && store.globalCategories.find((x) => x.kind === prefill.kind);
      if (c && !form.elements.category_id.value) form.elements.category_id.value = c.id;
      // 현지 이름이 있으면 그걸로 찾는 게 더 정확함. 실패하면 상태 줄에 "찾지 못함"이 표시됨
      loadGoogle({ name: prefill.local_name || prefill.name, auto: true });
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      const link = $('#link-input', el).value.trim();
      const cur = (v.price_currency || '').toUpperCase();
      if ((v.price_min != null || v.price_max != null) && !isCurrencyCode(cur)) {
        toast('가격 통화는 JPY 처럼 영문 3글자로 입력해 주세요.', 'error');
        return;
      }
      const data = {
        name: v.name,
        category_id: v.category_id,
        zone: v.zone, signature: v.signature, description: v.description,
        visit_tip: v.visit_tip, warn_badge: v.warn_badge,
        price_min: v.price_min != null ? Number(v.price_min) : null,
        price_max: v.price_max != null ? Number(v.price_max) : null,
        price_currency: v.price_min != null || v.price_max != null ? cur : null,
        source: v.source,
        youtube_url: safeUrl(v.youtube_url),
        maps_url: safeUrl(link) || (google?.mapsUrl ?? p.maps_url ?? null),
        map_query: p.map_query || null,
        is_anchor: !!form.elements.is_anchor.checked,
        lat: pos.lat, lng: pos.lng,
        ...(googleChanged ? googleColumns(google) : {}),
      };
      // 위치 검토 대기 중이던 장소의 핀을 직접 옮겼으면 검토 완료로 처리
      if (id && geoReviewOf(p) && !googleChanged && (pos.lat !== p.lat || pos.lng !== p.lng)) data.geo_review = null;
      if (id) store.update('places', id, data);
      else store.insert('places', data);
      closeSheet();
      toast(id ? '수정했습니다.' : '장소를 추가했습니다.');
    });

    return () => { off(); pm.remove(); };
  });
}

// =====================================================================
// 구글 지도 정보 표시 (영업시간 · 평점 · 폐업 · 연락처)
// =====================================================================
function googleBlock(p, timezone) {
  const hours = p.opening_hours?.weekday || [];
  if (!p.google_place_id && !hours.length && !p.rating) return '';
  const today = todayIndexMondayFirst(timezone);
  const site = safeUrl(p.website);
  return html`
    <div class="p-3 rounded-2xl glass-card text-xs mb-2 space-y-2">
      <div class="flex items-center justify-between">
        <span class="text-[10px] font-bold text-slate-400"><i class="fa-brands fa-google mr-1"></i>구글 지도 정보</span>
        ${p.rating ? html`<span class="text-amber-300 font-bold">★ ${Number(p.rating).toFixed(1)}
          ${p.rating_count ? html`<span class="text-slate-400 font-normal">(${Number(p.rating_count).toLocaleString()})</span>` : ''}</span>` : ''}
      </div>
      ${STATUS_TEXT[p.business_status] ? html`<p class="p-2 rounded-lg bg-rose-500/15 border border-rose-500/40 text-rose-200 font-bold">⚠️ ${STATUS_TEXT[p.business_status]}</p>` : ''}
      ${hours.length ? html`<ul class="space-y-0.5">${hours.map((h, i) => html`
        <li class="${i === today ? 'text-white font-bold' : 'text-slate-400'}">${i === today ? '▶ ' : ''}${h}</li>`)}</ul>
        <p class="text-[10px] text-slate-500">공휴일·연말연시 등 특별 휴무는 구글 지도에서 확인하세요.</p>` : ''}
      ${p.phone || site ? html`<div class="flex gap-3 text-[11px]">
        ${p.phone ? html`<a href="tel:${p.phone.replace(/[^\d+]/g, '')}" class="text-neon-cyan"><i class="fa-solid fa-phone mr-1"></i>${p.phone}</a>` : ''}
        ${site ? html`<a href="${site}" target="_blank" rel="noopener" class="text-neon-cyan truncate"><i class="fa-solid fa-globe mr-1"></i>웹사이트</a>` : ''}
      </div>` : ''}
    </div>`;
}

// 등록된 장소 1곳에 구글 정보 반영 (place_id 가 있으면 1건, 없으면 검색 포함 2건)
export async function refreshFromGoogle(store, p) {
  const r = await fetchPlaceDetails({
    tripId: store.tripId,
    placeId: p.google_place_id || null,
    name: p.name, zone: p.zone || null, destination: store.trip.destination || null,
    lat: p.lat ?? null, lng: p.lng ?? null,
  });
  const { patch, review } = mergeIntoExisting(p, r.place, r.distance);
  store.update('places', p.id, patch);
  return { review, place: r.place, distance: r.distance };
}


// =====================================================================
// 구글 위치 검토 (places.geo_review)
//  - review: 구글 위치가 300m 넘게 떨어져 좌표를 바꾸지 않은 곳 → 바꾸기 / 유지 / 직접 수정
//  - auto:   300m 이내라 자동으로 바꾼 곳 → 이대로 두기 / 되돌리기
// =====================================================================
function geoReviewCard(p) {
  const g = geoReviewOf(p);
  if (!g) return '';
  if (g.type === 'review') {
    return html`
      <div class="p-3 mb-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[11px]">
        <p class="text-amber-200 font-bold"><i class="fa-solid fa-location-dot mr-1"></i>위치 확인 필요</p>
        <p class="text-amber-100/80 mt-0.5">구글이 찾은 "${g.name || '?'}" 위치가 지금 핀과 ${distanceText(g.distance)} 떨어져 있어요.</p>
        <button data-action="geo-open" class="mt-2 w-full py-2 rounded-xl bg-amber-500/20 text-amber-100 font-bold border border-amber-500/40">지도에서 비교하기</button>
      </div>`;
  }
  return html`
    <div class="flex items-center justify-between gap-2 px-3 py-2 mb-3 rounded-xl bg-slate-800/70 border border-white/10 text-[10px] text-slate-400">
      <span><i class="fa-brands fa-google mr-1"></i>구글 좌표로 바뀜 (${distanceText(g.distance)})</span>
      <span class="flex gap-2 flex-shrink-0">
        <button data-action="geo-open" class="text-neon-cyan font-bold">비교 · 되돌리기</button>
        <button data-action="geo-keep" class="text-slate-300">확인</button>
      </span>
    </div>`;
}

export async function openGeoReview(store, type = 'review', { startId = null, onDone = null } = {}) {
  await loadMapLib();
  const queue = geoReviewList(store.list('places'), type).map((p) => p.id);
  if (!queue.length) { toast(type === 'review' ? '확인할 위치가 없어요.' : '자동으로 바뀐 위치가 없어요.'); return; }
  let idx = Math.max(0, startId ? queue.indexOf(startId) : 0);
  const decided = new Set();

  const isReview = type === 'review';
  openSheet(html`
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-sm font-black text-white">${isReview ? '위치 확인' : '자동으로 바뀐 위치'}</h3>
      <span id="gr-count" class="text-[11px] text-slate-400 font-mono"></span>
    </div>
    <div id="gr-map" class="w-full h-56 rounded-2xl overflow-hidden border border-white/10"></div>
    <div class="flex items-center gap-3 text-[10px] text-slate-400 mt-1.5 px-1">
      <span><span class="inline-block w-2 h-2 rounded-full bg-rose-400 mr-1"></span>${isReview ? '지금 저장된 핀' : '바뀌기 전'}</span>
      <span><span class="inline-block w-2 h-2 rounded-full bg-sky-400 mr-1"></span>${isReview ? '구글 위치' : '지금 (구글)'}</span>
    </div>
    <div id="gr-info" class="mt-2"></div>
    <div id="gr-actions" class="mt-2 space-y-2"></div>
    <div class="flex justify-between mt-2">
      <button data-action="prev" class="text-[11px] text-slate-400 px-2 py-1"><i class="fa-solid fa-chevron-left mr-1"></i>이전</button>
      <button data-action="next" class="text-[11px] text-slate-400 px-2 py-1">건너뛰기<i class="fa-solid fa-chevron-right ml-1"></i></button>
    </div>
  `, (el) => {
    const gm = createMap($('#gr-map', el), { zoom: 14 });
    const layer = L.layerGroup().addTo(gm);
    const dot = (c) => L.divIcon({ className: '', iconSize: [18, 18], iconAnchor: [9, 9],
      html: `<div style="width:18px;height:18px;border-radius:50%;background:${c};border:2px solid #fff;box-shadow:0 0 8px ${c}"></div>` });

    function show() {
      const p = store.get('places', queue[idx]);
      const g = geoReviewOf(p);
      $('#gr-count', el).textContent = `${idx + 1} / ${queue.length}`;
      layer.clearLayers();
      if (!p || !g || decided.has(p.id)) {
        setHTML($('#gr-info', el), html`<p class="text-xs text-emerald-300 font-bold text-center py-3">${p ? `"${p.name}" 은(는) 처리했어요.` : '삭제된 장소예요.'}</p>`);
        setHTML($('#gr-actions', el), '');
        return;
      }
      const a = isReview ? [p.lat, p.lng] : [g.prevLat, g.prevLng];   // 빨강
      const b = isReview ? [g.lat, g.lng] : [p.lat, p.lng];           // 파랑
      L.marker(a, { icon: dot('#fb7185') }).addTo(layer);
      L.marker(b, { icon: dot('#38bdf8') }).addTo(layer);
      L.polyline([a, b], { color: '#e2e8f0', weight: 2, dashArray: '6 6', opacity: 0.8 }).addTo(layer);
      setTimeout(() => { gm.invalidateSize(); gm.fitBounds(L.latLngBounds([a, b]), { padding: [36, 36], maxZoom: 17 }); }, 60);

      setHTML($('#gr-info', el), html`
        <div class="p-3 rounded-2xl glass-card text-[11px] space-y-0.5">
          <p class="text-white font-bold truncate">${p.name}</p>
          ${isReview ? html`<p class="text-slate-400 truncate">구글: <span class="text-sky-300">${g.name || '?'}</span></p>` : ''}
          <p class="text-slate-400">두 위치 차이 <b class="text-amber-200">${distanceText(g.distance)}</b>${p.zone ? html` · ${p.zone}` : ''}</p>
        </div>`);
      setHTML($('#gr-actions', el), isReview ? html`
        <button data-action="use-google" class="btn-primary w-full">구글 위치로 바꾸기</button>
        <div class="grid grid-cols-2 gap-2">
          <button data-action="keep" class="btn-ghost py-2.5">지금 위치 유지</button>
          <button data-action="edit" class="btn-ghost py-2.5"><i class="fa-solid fa-pen mr-1"></i>직접 수정</button>
        </div>` : html`
        <div class="grid grid-cols-2 gap-2">
          <button data-action="keep" class="btn-ghost py-2.5">이대로 두기</button>
          <button data-action="revert" class="btn-ghost py-2.5 text-amber-200"><i class="fa-solid fa-rotate-left mr-1"></i>되돌리기</button>
        </div>`);
    }

    function decide(patch, msg) {
      const id = queue[idx];
      store.update('places', id, { ...patch, geo_review: null });
      decided.add(id);
      toast(msg);
      const next = queue.findIndex((qid, i) => i > idx && !decided.has(qid));
      const any = next >= 0 ? next : queue.findIndex((qid) => !decided.has(qid));
      if (any < 0) { onDone ? onDone() : closeSheet(); toast(isReview ? '위치 확인을 모두 마쳤어요.' : '모두 확인했어요.'); return; }
      idx = any; show();
    }

    const off = delegate(el, {
      'use-google': () => { const g = geoReviewOf(store.get('places', queue[idx])); decide({ lat: g.lat, lng: g.lng }, '구글 위치로 바꿨어요.'); },
      keep: () => decide({}, '지금 위치를 그대로 두었어요.'),
      revert: () => { const g = geoReviewOf(store.get('places', queue[idx])); decide({ lat: g.prevLat, lng: g.prevLng }, '이전 위치로 되돌렸어요.'); },
      // 편집기로 이동: 검토 기록은 DB 에 남아 있어서 나중에 다시 이어서 볼 수 있음
      edit: () => openPlaceEditor(store, queue[idx], {}),
      prev: () => { idx = (idx - 1 + queue.length) % queue.length; show(); },
      next: () => { idx = (idx + 1) % queue.length; show(); },
    });
    show();
    return () => { off(); gm.remove(); };
  });
}
