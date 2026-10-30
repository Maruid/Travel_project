import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { createMap, pinIcon, draggablePin, L } from '../../components/map.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { walkInfo, priceRange } from '../../lib/format.js';
import { lookupMapsLink, geocode, currentPosition, enrichPlace } from '../../lib/place-lookup.js';
import { isGoogleMapsUrl } from '../../lib/maps-link.js';
import { color } from '../../lib/safe.js';
import { downloadTripMap } from '../../lib/offline-map.js';

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

export function googleMapsHref(p) {
  const direct = safeUrl(p.maps_url);
  if (direct) return direct;
  const q = p.map_query || (p.lat != null ? `${p.lat},${p.lng}` : p.name);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function mount(root, store) {
  const state = {
    cat: 'all',
    anchorId: null,        // 기준점 place id 또는 'gps'
    gps: null,
    sortByDistance: false,
    nearOnly: false,
    selectedId: null,
  };

  setHTML(root, html`
    <div class="relative w-full h-[40vh] border-b border-white/10 flex-shrink-0">
      <div id="map" class="w-full h-full z-10"></div>
      <div class="absolute top-3 right-3 z-20 flex items-center gap-1.5">
        <select id="anchor-select" class="h-9 px-2 rounded-xl glass-card bg-night-950/80 text-[11px] text-slate-200 font-bold border border-white/20 max-w-40"></select>
        <button data-action="gps" class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-neon-cyan border border-neon-cyan/40" title="내 위치">
          <i class="fa-solid fa-location-crosshairs text-sm"></i>
        </button>
        <button data-action="offline-map" id="btn-offline-map" class="w-9 h-9 rounded-xl glass-card flex items-center justify-center text-emerald-300 border border-emerald-400/40 text-[10px] font-bold" title="이 여행 지도 오프라인 저장">
          <i class="fa-solid fa-download text-sm"></i>
        </button>
      </div>
      <div id="float-card" class="hidden absolute bottom-2 left-2 right-2 z-20 glass-card bg-night-950/90 border border-neon-cyan/50 rounded-2xl p-2.5 shadow-2xl"></div>
    </div>

    <div class="flex-1 flex flex-col p-3">
      <div id="cat-chips" class="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-2"></div>
      <div class="flex items-center justify-between text-xs px-1 py-1 mb-1">
        <span id="count-text" class="text-slate-400 text-[11px]"></span>
        <div class="flex items-center gap-1.5">
          <button data-action="sort" id="btn-sort" class="text-[11px] px-2 py-0.5 rounded-lg glass-card text-slate-300"><i class="fa-solid fa-arrow-down-short-wide text-[10px]"></i> 거리순</button>
          <button data-action="near" id="btn-near" class="text-[11px] px-2 py-0.5 rounded-lg glass-card text-slate-300"><i class="fa-solid fa-person-walking"></i> 7분 이내</button>
          <button data-action="add" class="text-[11px] px-2.5 py-0.5 rounded-lg bg-neon-cyan text-night-950 font-black"><i class="fa-solid fa-plus"></i> 추가</button>
        </div>
      </div>
      <div id="place-list" class="space-y-2"></div>
    </div>
  `);

  // ---------- 지도 ----------
  const anchors0 = store.list('places').filter((p) => p.is_anchor && p.lat != null);
  const withCoords0 = store.list('places').filter((p) => p.lat != null);
  const start = anchors0[0] || withCoords0[0];
  const map = createMap($('#map', root), { center: start ? [start.lat, start.lng] : undefined, zoom: start ? 14 : 3 });
  const markerLayer = L.layerGroup().addTo(map);
  let gpsMarker = null;
  setTimeout(() => map.invalidateSize(), 100);

  function anchorPoint() {
    if (state.anchorId === 'gps') return state.gps;
    const p = store.get('places', state.anchorId);
    return p && p.lat != null ? { lat: p.lat, lng: p.lng, name: p.name } : null;
  }

  function filtered() {
    const from = anchorPoint();
    let rows = store.list('places').map((p) => ({ p, walk: walkInfo(from, p), cat: store.category(p.category_id) }));
    if (state.cat !== 'all') rows = rows.filter((r) => r.p.category_id === state.cat);
    if (state.nearOnly) rows = rows.filter((r) => r.walk.min <= 7);
    if (state.sortByDistance) rows.sort((a, b) => a.walk.meters - b.walk.meters);
    return rows;
  }

  function renderAnchorSelect() {
    const anchors = store.list('places').filter((p) => p.is_anchor && p.lat != null);
    if (state.anchorId == null && anchors[0]) state.anchorId = anchors[0].id;
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
    markerLayer.clearLayers();
    for (const { p, cat } of rows) {
      if (p.lat == null) continue;
      const m = L.marker([p.lat, p.lng], {
        icon: pinIcon({ color: cat?.color, icon: cat?.icon, size: p.is_anchor ? 34 : 28, pulse: p.is_anchor }),
      }).addTo(markerLayer);
      m.on('click', () => showFloat(p.id));
    }
  }

  function renderList(rows) {
    const from = anchorPoint();
    $('#count-text', root).textContent = `${rows.length}곳${from ? ` · ${from.name || '내 위치'} 기준` : ''}`;
    $('#btn-sort', root).className = `text-[11px] px-2 py-0.5 rounded-lg ${state.sortByDistance ? 'bg-neon-cyan text-night-950 font-bold' : 'glass-card text-slate-300'}`;
    $('#btn-near', root).className = `text-[11px] px-2 py-0.5 rounded-lg ${state.nearOnly ? 'bg-neon-cyan text-night-950 font-bold' : 'glass-card text-slate-300'}`;

    setHTML($('#place-list', root), rows.length ? html`${rows.map(({ p, walk, cat }) => html`
      <div data-action="detail" data-id="${p.id}" class="glass-card p-3 rounded-2xl flex items-center justify-between gap-2 cursor-pointer hover:border-slate-500 transition ${p.id === state.selectedId ? 'neon-border-cyan' : ''}">
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-1.5 mb-1 flex-wrap">
            ${cat ? html`<span class="text-[9px] border font-bold px-1.5 rounded" style="color:${color(cat.color)};border-color:${color(cat.color)}66">${cat.name}</span>` : ''}
            ${p.warn_badge ? html`<span class="text-[9px] bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold px-1.5 rounded">⚠️ ${p.warn_badge}</span>` : ''}
            ${p.source ? html`<span class="text-[9px] bg-purple-500/20 text-purple-300 border border-purple-500/30 font-bold px-1.5 rounded">📺 ${p.source}</span>` : ''}
            <h4 class="font-bold text-xs text-white truncate">${p.name}</h4>
            ${p.zone ? html`<span class="text-[10px] text-slate-400">· ${p.zone}</span>` : ''}
          </div>
          ${p.signature ? html`<p class="text-[11px] font-medium text-neon-cyan truncate">${p.signature}</p>` : ''}
          <div class="flex items-center gap-2 mt-0.5">
            ${priceRange(p) ? html`<span class="text-[10px] text-emerald-400 font-mono font-bold">${priceRange(p)}</span>` : ''}
            <p class="text-[10px] text-slate-400 truncate flex-1">${p.description || ''}</p>
          </div>
        </div>
        <div class="flex flex-col items-end gap-1 flex-shrink-0">
          ${walk.text ? html`<span class="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-bold">${walk.text}</span>`
            : p.lat == null ? html`<span class="text-[10px] text-slate-500">위치 없음</span>` : ''}
          <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" data-stop class="w-7 h-7 rounded-lg bg-slate-800 text-neon-cyan border border-white/10 flex items-center justify-center text-xs">
            <i class="fa-solid fa-diamond-turn-right"></i></a>
        </div>
      </div>`)}` : emptyCard('조건에 맞는 장소가 없습니다.'));
  }

  function showFloat(id) {
    const p = store.get('places', id);
    if (!p) return;
    state.selectedId = id;
    const cat = store.category(p.category_id);
    const walk = walkInfo(anchorPoint(), p);
    const el = $('#float-card', root);
    setHTML(el, html`
      <div class="flex items-center justify-between gap-2">
        <div class="flex-1 min-w-0" data-action="detail" data-id="${p.id}">
          <div class="flex items-center gap-1.5 mb-0.5">
            ${cat ? html`<span class="text-[9px] px-1.5 rounded font-bold border" style="color:${color(cat.color)};border-color:${color(cat.color)}66">${cat.name}</span>` : ''}
            <h4 class="font-extrabold text-xs text-white truncate">${p.name}</h4>
          </div>
          <div class="text-[10px] text-slate-300 truncate"><span class="text-emerald-400 font-bold">${walk.text}</span> ${p.signature || ''}</div>
        </div>
        <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" class="px-2.5 py-1.5 rounded-xl bg-neon-cyan text-night-950 text-[10px] font-black flex-shrink-0">길찾기</a>
        <button data-action="close-float" class="w-6 h-6 text-slate-400"><i class="fa-solid fa-xmark"></i></button>
      </div>`);
    el.classList.remove('hidden');
    map.panTo([p.lat, p.lng], { animate: true });
    renderList(filtered());
  }

  function update() {
    renderAnchorSelect();
    renderChips();
    const rows = filtered();
    renderMarkers(rows);
    renderList(rows);
  }

  // ---------- 이벤트 ----------
  $('#anchor-select', root).addEventListener('change', (e) => {
    if (e.target.value === 'gps') locate();
    else { state.anchorId = e.target.value || null; const a = anchorPoint(); if (a) map.panTo([a.lat, a.lng]); update(); }
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
      map.flyTo([state.gps.lat, state.gps.lng], 15);
      update();
    } catch (e) {
      toast(e.message, 'error');
      renderAnchorSelect();
    }
  }

  const off = delegate(root, {
    gps: locate,
    cat: (el) => { state.cat = el.dataset.cat; update(); },
    sort: () => { state.sortByDistance = !state.sortByDistance; update(); },
    near: () => { state.nearOnly = !state.nearOnly; update(); },
    add: () => openPlaceEditor(store, null, { near: anchorPoint() }),
    'offline-map': async (btn) => {
      if (btn.dataset.busy) return;
      if (!navigator.onLine) { toast('온라인 상태에서 받아주세요.', 'error'); return; }
      const points = store.list('places').filter((p) => p.lat != null);
      if (!confirmAction(`등록된 장소 ${points.length}곳 주변 지도를 오프라인용으로 저장할까요?\n(와이파이 환경을 권장해요)`)) return;
      btn.dataset.busy = '1';
      try {
        const r = await downloadTripMap(points, (done, total) => { btn.textContent = `${Math.floor((done / total) * 100)}%`; });
        toast(`지도 ${r.total - r.failed}장을 저장했어요.${r.failed ? ` (실패 ${r.failed})` : ''}`);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        delete btn.dataset.busy;
        setHTML(btn, html`<i class="fa-solid fa-download text-sm"></i>`);
      }
    },
    detail: (el, e) => {
      if (e.target.closest('[data-stop]')) return;
      openPlaceDetail(store, el.dataset.id, anchorPoint());
    },
    'close-float': () => { $('#float-card', root).classList.add('hidden'); state.selectedId = null; renderList(filtered()); },
  });

  update();

  return {
    update,
    destroy: () => { off(); map.remove(); },
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
    <div class="space-y-2 text-xs">
      ${p.signature ? html`<div class="p-3 rounded-2xl glass-card"><span class="text-[10px] font-bold text-slate-400 block mb-0.5">대표 메뉴 & 볼거리</span><p class="font-bold text-white">${p.signature}</p></div>` : ''}
      ${p.description ? html`<div class="p-3 rounded-2xl glass-card"><span class="text-[10px] font-bold text-slate-400 block mb-0.5">상세 안내</span><p class="text-slate-300 leading-relaxed whitespace-pre-line">${p.description}</p></div>` : ''}
      ${p.visit_tip ? html`<div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30"><span class="text-[10px] font-bold text-amber-400 block mb-0.5">웨이팅 / 방문 팁</span><p class="text-amber-200 font-medium">${p.visit_tip}</p></div>` : ''}
    </div>
    ${yt ? html`<a href="${yt}" target="_blank" rel="noopener" class="w-full mt-3 py-2.5 rounded-xl bg-red-600/20 text-red-300 border border-red-500/40 font-bold text-xs flex items-center justify-center gap-2">
      <i class="fa-brands fa-youtube text-red-500 text-sm"></i> 유튜브 영상 보기</a>` : ''}
    <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" class="btn-primary mt-2 flex items-center justify-center gap-1.5">
      <i class="fa-solid fa-diamond-turn-right"></i> 구글 맵에서 길찾기</a>
    <div class="grid grid-cols-2 gap-2 mt-2">
      <button data-action="edit" class="btn-ghost py-2.5"><i class="fa-solid fa-pen mr-1"></i>수정</button>
      <button data-action="delete" class="btn-ghost py-2.5 text-rose-300"><i class="fa-solid fa-trash-can mr-1"></i>삭제</button>
    </div>
  `, (el) => delegate(el, {
    edit: () => openPlaceEditor(store, id, { near: from }),
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
          ${r.grounded ? '' : html`<span class="text-amber-300">검색 없이 만든 결과라 대표 메뉴·소개만 채웠어요.</span>`}</p>
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

    const autoFilled = {};   // 필드명 → 마지막으로 자동 입력한 값
    const fill = (name, value) => {
      const input = form.elements[name];
      if (!input || value == null || value === '') return false;
      const cur = input.value.trim();
      if (cur && cur !== autoFilled[name]) return false;   // 사용자가 직접 쓴 값은 보존
      input.value = String(value);
      autoFilled[name] = input.value.trim();
      input.classList.add('ring-1', 'ring-purple-400/60');
      setTimeout(() => input.classList.remove('ring-1', 'ring-purple-400/60'), 1500);
      return true;
    };

    async function fetchLink() {
      const url = $('#link-input', el).value.trim();
      if (!url) return;
      if (!isGoogleMapsUrl(url)) { toast('구글 맵 링크가 아닙니다.', 'error'); return; }
      const btn = el.querySelector('[data-action="fetch-link"]');
      btn.disabled = true; btn.textContent = '...';
      try {
        const r = await lookupMapsLink(url);
        fill('name', r.name);
        if (r.lat != null) {
          setPos(r.lat, r.lng, { note: r.precision === 'pin' ? '링크에서 가져옴' : '지도 중심 좌표 · 핀을 확인하세요' });
          toast('위치를 가져왔습니다. 핀이 맞는지 확인해 주세요.');
        } else if (r.query) {
          $('#search-input', el).value = r.query;
          toast('링크에 좌표가 없어 이름으로 검색합니다.');
          await search();
        } else {
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
          });
          const f = r.fields || {};
          // 검색 근거가 없으면 틀리기 쉬운 값(가격·휴무·팁)은 자동으로 넣지 않고 "추정"으로만 보여줌
          const textKeys = r.grounded ? ['signature', 'description', 'visit_tip', 'warn_badge', 'zone'] : ['signature', 'description', 'zone'];
          const filled = textKeys.filter((k) => fill(k, f[k]));
          if (r.grounded) {
            if (fill('price_min', f.price_min)) filled.push('price_min');
            if (fill('price_max', f.price_max)) filled.push('price_max');
            if (f.price_currency) fill('price_currency', f.price_currency);
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
        const done = ['price_min', 'price_max', 'price_currency', 'visit_tip', 'warn_badge'].filter((k) => est[k] != null && fill(k, est[k]));
        toast(done.length ? '추정값을 넣었어요. 꼭 확인해 주세요.' : '넣을 수 있는 빈 칸이 없어요.');
      },
    });
    $('#link-input', el).addEventListener('paste', () => setTimeout(fetchLink, 0));

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
        maps_url: safeUrl(link),
        map_query: p.map_query || null,
        is_anchor: !!form.elements.is_anchor.checked,
        lat: pos.lat, lng: pos.lng,
      };
      if (id) store.update('places', id, data);
      else store.insert('places', data);
      closeSheet();
      toast(id ? '수정했습니다.' : '장소를 추가했습니다.');
    });

    return () => { off(); pm.remove(); };
  });
}
