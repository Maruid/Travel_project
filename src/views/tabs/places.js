import { html, setHTML, delegate, formValues, $, esc } from '../../lib/dom.js';
import { createMap, pinIcon, draggablePin, L } from '../../components/map.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { walkInfo, priceRange } from '../../lib/format.js';
import { lookupMapsLink, geocode, currentPosition, enrichPlace } from '../../lib/place-lookup.js';
import { isGoogleMapsUrl } from '../../lib/maps-link.js';
import { color } from '../../lib/safe.js';
import {
  fetchPlaceDetails, googleColumns, googleFromPlace, mergeIntoExisting, todayIndexMondayFirst, STATUS_TEXT, REVIEW_DISTANCE_M,
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
          <button data-action="add" class="text-[11px] px-2.5 py-0.5 rounded-lg bg-neon-cyan text-night-950 font-black"><i class="fa-solid fa-plus"></i> 추가</button>
        </div>
      </div>
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

  // ---------- 지도 ----------
  const anchors0 = store.list('places').filter((p) => p.is_anchor && p.lat != null);
  const withCoords0 = store.list('places').filter((p) => p.lat != null);
  const start = anchors0[0] || withCoords0[0];
  const map = createMap($('#map', root), { center: start ? [start.lat, start.lng] : undefined, zoom: start ? 14 : 3 });
  const markerLayer = L.layerGroup().addTo(map);
  let gpsMarker = null;
  setTimeout(() => map.invalidateSize(), 100);

  // 지도의 빈 곳을 누르면 선택 해제 (핀 클릭은 지도로 전달되지 않음)
  map.on('click', () => { if (state.selectedId) select(null); });

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
    if (getPref(PREF_ANCHOR_NEAR_SORT) && anchors.length > 1) {
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
  // 지도를 움직인 뒤 기준점 목록 순서 갱신 (목록을 열어둔 중에는 건드리지 않음)
  map.on('moveend', () => {
    if (getPref(PREF_ANCHOR_NEAR_SORT) && document.activeElement !== $('#anchor-select', root)) renderAnchorSelect();
  });

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
      return html`
      <div data-action="select" data-id="${p.id}" id="card-${p.id}" class="glass-card p-3 rounded-2xl cursor-pointer hover:border-slate-500 transition ${selected ? 'neon-border-cyan' : ''}">
        <div class="flex items-center justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5 mb-1 flex-wrap">
              ${cat ? html`<span class="text-[9px] border font-bold px-1.5 rounded" style="color:${color(cat.color)};border-color:${color(cat.color)}66">${cat.name}</span>` : ''}
              ${p.warn_badge ? html`<span class="text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold px-1.5 rounded">⚠️ ${p.warn_badge}</span>` : ''}
              ${p.source ? html`<span class="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold px-1.5 rounded">📺 ${p.source}</span>` : ''}
              ${p.is_anchor ? html`<span class="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold px-1.5 rounded">기준점</span>` : ''}
              <h4 class="font-bold text-xs text-white truncate">${p.name}</h4>
              ${p.zone ? html`<span class="text-[10px] text-slate-400">· ${p.zone}</span>` : ''}
              ${p.rating ? html`<span class="text-[10px] font-bold ${sk === 'rating' ? 'px-1 rounded bg-amber-400/15 text-amber-200 border border-amber-400/40' : 'text-amber-300'}">★${Number(p.rating).toFixed(1)}${p.rating_count != null ? html`<span class="font-normal text-slate-400"> (${Number(p.rating_count).toLocaleString()})</span>` : ''}</span>` : ''}
            </div>
            ${p.signature ? html`<p class="text-[11px] font-medium text-neon-cyan truncate">${p.signature}</p>` : ''}
            <div class="flex items-center gap-2 mt-0.5">
              ${priceRange(p) ? html`<span class="text-[10px] font-mono font-bold ${sk === 'price' ? 'px-1 rounded bg-emerald-400/15 text-emerald-300 border border-emerald-400/40' : 'text-emerald-400'}">${priceRange(p)}</span>` : ''}
              <p class="text-[10px] text-slate-400 truncate flex-1">${p.description || ''}</p>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1 flex-shrink-0">
            ${walk.text ? html`<span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${sk === 'distance' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/50' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">${walk.text}</span>`
              : p.lat == null ? html`<span class="text-[10px] text-slate-500">위치 없음</span>` : ''}
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
    })}` : emptyCard('조건에 맞는 장소가 없습니다.'));
  }

  // 장소 선택 (id = null 이면 해제). 지도가 펼쳐져 있으면 그 위치로 이동
  function select(id, { from = 'list' } = {}) {
    state.selectedId = id;
    const p = id ? store.get('places', id) : null;
    if (p && p.lat != null && !state.collapsed) {
      map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), ZOOM_SELECT), { duration: 0.5 });
    }
    const rows = filtered();
    renderMarkers(rows);
    renderList(rows);
    // 지도 핀으로 선택한 경우: 리스트에서 그 카드가 보이도록
    if (p && from === 'map') document.getElementById(`card-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- 지도 접기 / 펼치기 ----------
  function applyCollapsed() {
    $('#map-wrap', root).classList.toggle('hidden', state.collapsed);
    $('#map-bar', root).classList.toggle('hidden', !state.collapsed);
    const a = anchorPoint();
    $('#map-bar-text', root).textContent = `지도 펼치기${a?.name ? ` · ${a.name} 기준` : ''}`;
    if (!state.collapsed) setTimeout(() => map.invalidateSize(), 50);
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
    if (state.resetNext === 'all') {
      const pts = filtered().filter(({ p }) => p.lat != null).map(({ p }) => [p.lat, p.lng]);
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
  }

  // ---------- 이벤트 ----------
  $('#anchor-select', root).addEventListener('change', (e) => {
    if (e.target.value === 'gps') { locate(); return; }
    state.anchorId = e.target.value || null;
    const a = anchorPoint();
    if (a && !state.collapsed) map.flyTo([a.lat, a.lng], ZOOM_ANCHOR, { duration: 0.6 });
    state.resetNext = 'all';
    renderResetButton();
    update();
  });

  async function locate() {
    try {
      state.gps = { ...(await currentPosition()), name: '내 위치' };
      state.anchorId = 'gps';
      gpsMarker?.remove();
      gpsMarker = L.marker([state.gps.lat, state.gps.lng], {
        icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8],
          html: '<div class="w-4 h-4 rounded-full bg-neon-cyan border-2 border-white shadow-[0_0_12px_#00f2fe]"></div>' }),
      }).addTo(map);
      if (!state.collapsed) map.flyTo([state.gps.lat, state.gps.lng], ZOOM_ANCHOR);
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
      if (p?.lat != null) setTimeout(() => map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), ZOOM_SELECT), { duration: 0.5 }), 80);
    },
  });

  applyCollapsed();
  renderResetButton();
  update();

  return {
    update,
    destroy: () => {
      off();
      window.removeEventListener('resize', onResize);
      root.style.height = prevStyle.height;
      root.style.paddingBottom = prevStyle.paddingBottom;
      root.style.flex = prevStyle.flex;
      map.remove();
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
        ${cat ? html`<span class="text-[10px] px-2 py-0.5 rounded font-black border" style="color:${color(cat.color)};border-color:${color(cat.color)}66">${cat.name}</span>` : ''}
        ${p.warn_badge ? html`<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">⚠️ ${p.warn_badge}</span>` : ''}
        ${p.source ? html`<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-purple-500/20 text-purple-300 border border-purple-500/40">📺 ${p.source}</span>` : ''}
      </div>
      <span class="text-xs font-bold text-emerald-400">${walk.text}</span>
    </div>
    <h3 class="text-lg font-black text-white mt-1">${p.name}</h3>
    <div class="flex items-center justify-between text-xs text-slate-400 mb-3">
      <span>${p.zone || ''}</span>
      <span class="font-mono text-emerald-400 font-bold">${priceRange(p)}</span>
    </div>
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
export function openPlaceEditor(store, id, { near } = {}) {
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
        <div><label class="label">통화</label><input name="price_currency" class="input w-16 uppercase" maxlength="3" value="${p.price_currency || store.budget?.local_currency || ''}"></div>
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
        ${r.sources?.length ? html`<div class="flex flex-wrap gap-1">${r.sources.map((s) => html`
          <a href="${s.uri}" target="_blank" rel="noopener" class="px-1.5 py-0.5 rounded bg-night-950/60 text-purple-200 underline truncate max-w-full">${s.title}</a>`)}</div>` : ''}
        ${r.searchSuggestions ? html`<iframe data-suggest sandbox="allow-popups allow-popups-to-escape-sandbox" class="w-full h-12 rounded-lg bg-white/5" title="Google 검색 제안"></iframe>` : ''}`);
      const frame = box.querySelector('[data-suggest]');
      if (frame) frame.srcdoc = r.searchSuggestions;   // Google 이 제공한 검색 제안 위젯 (스크립트 실행 불가한 샌드박스)
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
        b.textContent = '검색 중... (10~20초)';
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
          });
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

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      const link = $('#link-input', el).value.trim();
      const data = {
        name: v.name,
        category_id: v.category_id,
        zone: v.zone, signature: v.signature, description: v.description,
        visit_tip: v.visit_tip, warn_badge: v.warn_badge,
        price_min: v.price_min != null ? Number(v.price_min) : null,
        price_max: v.price_max != null ? Number(v.price_max) : null,
        price_currency: v.price_min != null || v.price_max != null ? (v.price_currency || '').toUpperCase() || null : null,
        source: v.source,
        youtube_url: safeUrl(v.youtube_url),
        maps_url: safeUrl(link) || (google?.mapsUrl ?? p.maps_url ?? null),
        map_query: p.map_query || null,
        is_anchor: !!form.elements.is_anchor.checked,
        lat: pos.lat, lng: pos.lng,
        ...(googleChanged ? googleColumns(google) : {}),
      };
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

