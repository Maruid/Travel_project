import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { dateRange, dayLabel, shortTime, todayIn } from '../../lib/format.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { openPlaceDetail, loadMapLib } from './places.js';
import { buildRoute, directionsHref, nearestAnchor, totalText, circled, dayStays, segColor, HOTEL_COLOR } from '../../lib/route-plan.js';
import { loadUndo, undoPlan, clearUndo } from '../../lib/ai-plan.js';
import { getPref, setPref, getPrefStr, PREF_ROUTE_OPEN, PREF_ROUTE_HOTEL } from '../../lib/prefs.js';
import { esc } from '../../lib/dom.js';
import { color } from '../../lib/safe.js';
import { hoursIssueAt } from '../../lib/hours.js';

const ICONS = ['fa-location-dot', 'fa-utensils', 'fa-mug-saucer', 'fa-train-subway', 'fa-taxi', 'fa-plane-departure',
  'fa-plane-arrival', 'fa-hotel', 'fa-bed', 'fa-hot-tub-person', 'fa-camera', 'fa-bag-shopping', 'fa-tree', 'fa-landmark',
  'fa-person-walking', 'fa-ticket', 'fa-gamepad', 'fa-beer-mug-empty', 'fa-sun', 'fa-moon'];

// opts.readOnly: 읽기 전용 공유 화면 (추가·수정 없음), opts.onPlace(id): 장소 버튼을 눌렀을 때
export function mount(root, store, { readOnly = false, onPlace = null } = {}) {
  const tz = () => store.trip.timezone;
  let selected = null;

  // 날짜 탭 · 동선 지도 · 본문을 따로 그림 (지도는 다시 만들지 않도록 자리를 유지)
  setHTML(root, html`
    <div class="p-4 space-y-3">
      <div id="sched-tabs"></div>
      <div id="route-box" class="hidden glass-card rounded-2xl overflow-hidden">
        <button data-action="route-toggle" id="route-head" class="w-full h-10 px-3 flex items-center gap-2 text-[11px] font-bold text-slate-200"></button>
        <div id="route-panel" class="hidden border-t border-white/10">
          <div class="relative h-56">
            <div id="route-map" class="w-full h-full z-10"></div>
            <div id="route-loading" class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500"><i class="fa-solid fa-map mr-1.5"></i>지도 불러오는 중...</div>
          </div>
          <div id="route-list" class="p-2.5 space-y-1"></div>
        </div>
      </div>
      <div id="sched-body" class="space-y-3"></div>
    </div>`);
  // hotel: null 이면 그날 숙소를 정했는지에 따라 (정했으면 켬). 버튼을 누르면 이 기기에 기억
  const hotelPref = getPrefStr(PREF_ROUTE_HOTEL);
  const route = { open: getPref(PREF_ROUTE_OPEN), hotel: hotelPref == null ? null : hotelPref === '1', map: null, layer: null, sig: '', lib: null, destroyed: false, focus: null, plan: null };

  function days() {
    const fromTrip = dateRange(store.trip.start_date, store.trip.end_date);
    const extra = [...store.list('itinerary_items'), ...store.list('itinerary_days')].map((r) => r.day_date);
    return [...new Set([...fromTrip, ...extra])].sort();
  }

  function update() {
    const all = days();
    if (!selected || !all.includes(selected)) {
      const today = todayIn(tz());
      selected = all.includes(today) ? today : all[0] || null;
    }
    const header = store.list('itinerary_days').find((d) => d.day_date === selected);
    const items = store.list('itinerary_items').filter((i) => i.day_date === selected);
    const guides = store.list('guides').filter((g) => g.day_date === selected);

    const plan = currentRoute(items);
    renderDayTabs(all);
    renderRoute(plan);

    const undo = readOnly ? null : loadUndo(store.tripId);
    setHTML($('#sched-body', root), html`
        ${undo ? html`
          <div class="flex items-center gap-2 p-2.5 rounded-2xl bg-purple-500/10 border border-purple-400/30 text-[11px]">
            <i class="fa-solid fa-wand-magic-sparkles text-purple-300"></i>
            <span class="flex-1 min-w-0 text-purple-100 truncate">AI 일정 적용됨 · ${undo.inserted.length}개 추가${undo.removed.length ? `, ${undo.removed.length}개 지움` : ''}</span>
            <button data-action="ai-undo" class="flex-shrink-0 px-2 py-1 rounded-lg bg-slate-800 border border-white/10 text-purple-200 font-bold">되돌리기</button>
            <button data-action="ai-undo-close" class="flex-shrink-0 w-6 h-6 text-slate-400" title="닫기"><i class="fa-solid fa-xmark"></i></button>
          </div>` : ''}
        ${selected ? html`
          <div data-action="${readOnly ? 'none' : 'edit-day'}" class="glass-card p-3.5 rounded-2xl border-l-4 border-rose-500 ${readOnly ? '' : 'cursor-pointer'}">
            <div class="flex items-center gap-1.5 mb-0.5">
              <span class="text-xs font-bold text-white">${dayLabel(selected)}</span>
              ${header?.badge ? html`<span class="text-[10px] px-2 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">${header.badge}</span>` : ''}
              ${readOnly ? '' : html`<i class="fa-solid fa-pen text-[9px] text-slate-500 ml-auto"></i>`}
            </div>
            <h4 class="text-sm font-extrabold text-white">${header?.title || (readOnly ? dayLabel(selected) : '이 날의 제목을 정해보세요')}</h4>
            ${header?.summary ? html`<p class="text-[11px] text-slate-400 mt-0.5">${header.summary}</p>` : ''}
            ${stayLine(store, selected, readOnly)}
          </div>

          ${guides.map((g) => html`
            <div class="glass-card p-3.5 rounded-2xl border-l-4" style="border-left-color:${color(g.color)}">
              <h4 class="text-xs font-bold mb-1 flex items-center gap-1.5" style="color:${color(g.color)}"><i class="fa-solid ${g.icon || 'fa-lightbulb'}"></i>${g.title}</h4>
              <div class="md">${renderMarkdown(g.body_md)}</div>
            </div>`)}

          <div class="space-y-2.5">
            ${items.length ? items.map((it) => {
              const place = store.get('places', it.place_id);
              const no = route.open ? plan.stops.find((st) => st.itemIds.includes(it.id))?.no : null;
              return html`
              <div class="glass-card p-3 rounded-2xl flex items-start gap-3">
                <div class="relative w-8 h-8 rounded-xl bg-slate-800/80 border border-white/10 flex items-center justify-center text-neon-cyan text-xs flex-shrink-0 mt-0.5">
                  <i class="fa-solid ${it.icon || 'fa-location-dot'}"></i>
                  ${no ? html`<span class="absolute -top-1.5 -left-1.5 min-w-4 h-4 px-0.5 rounded-full bg-rose-500 text-white text-[9px] font-black leading-4 text-center">${no}</span>` : ''}</div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline justify-between gap-1 mb-0.5">
                    <h5 class="text-xs font-bold text-white">${it.title}${it.ai_plan ? html` <span class="align-middle text-[8px] px-1 rounded bg-purple-500/25 text-purple-200 font-bold">AI</span>` : ''}</h5>
                    <span class="text-[10px] font-mono font-bold text-neon-cyan flex-shrink-0">${shortTime(it.start_time)}</span>
                  </div>
                  ${it.description ? html`<p class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line">${it.description}</p>` : ''}
                  ${it.alert ? html`<div class="mt-1.5 p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">${it.alert}</div>` : ''}
                  ${place && hoursIssueAt(place.opening_hours, it.day_date, shortTime(it.start_time)) ? html`
                    <div class="mt-1.5 p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-200">
                      <i class="fa-solid fa-clock mr-1"></i>${place.name}: ${hoursIssueAt(place.opening_hours, it.day_date, shortTime(it.start_time))}</div>` : ''}
                  <div class="mt-2 flex justify-end gap-1.5">
                    ${place ? html`<button data-action="place" data-id="${place.id}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-neon-cyan border border-neon-cyan/30 font-bold"><i class="fa-solid fa-location-dot text-[9px]"></i> ${place.name}</button>` : ''}
                    ${readOnly ? '' : html`<button data-action="edit" data-id="${it.id}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-slate-300"><i class="fa-solid fa-pen"></i></button>`}
                  </div>
                </div>
              </div>`;
            }) : emptyCard('아직 일정이 없습니다.')}
          </div>
          ${readOnly ? '' : html`
            <div class="grid grid-cols-[1fr_auto] gap-2">
              <button data-action="add" class="btn-primary"><i class="fa-solid fa-plus mr-1"></i>일정 추가</button>
              <button data-action="ai-plan" class="px-3 rounded-xl bg-purple-500/20 border border-purple-400/50 text-purple-100 text-xs font-bold"><i class="fa-solid fa-wand-magic-sparkles mr-1"></i>AI로 짜기</button>
            </div>`}
        ` : emptyCard('여행 날짜가 없습니다. 설정 탭에서 여행 정보를 설정하거나 날짜를 추가하세요.')}
    `);
  }

  // ---------- 하루 동선 지도 ----------
  // ---------- 날짜 줄 ----------
  //  다시 그려도 옆으로 넘겨둔 위치를 지키고, 고른 날짜가 화면 밖이면 가운데쯤으로 넘겨줌
  let lastTabsKey = '';
  let lastCentered = null;
  function renderDayTabs(all) {
    const box = $('#sched-tabs', root);
    const key = `${all.join(',')}|${readOnly}`;
    if (key !== lastTabsKey) {
      const prev = box.querySelector('.day-strip')?.scrollLeft || 0;
      lastTabsKey = key;
      setHTML(box, html`
        <div class="day-strip flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          ${all.map((d, i) => html`
            <button data-action="day" data-day="${d}" class="day-chip flex-shrink-0 text-xs px-3 py-1.5 rounded-xl font-bold">${i + 1}일 · ${chipDate(d)}</button>`)}
          ${readOnly ? '' : html`<button data-action="add-day" class="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-xl glass-card text-slate-400" title="날짜 추가"><i class="fa-solid fa-plus"></i></button>`}
        </div>`);
      box.querySelector('.day-strip').scrollLeft = prev;
    }
    // 선택 표시만 바꿈 (줄을 다시 만들지 않음)
    box.querySelectorAll('.day-chip').forEach((b) => {
      const on = b.dataset.day === selected;
      b.classList.toggle('bg-rose-500', on); b.classList.toggle('text-white', on); b.classList.toggle('shadow-lg', on);
      b.classList.toggle('glass-card', !on); b.classList.toggle('text-slate-400', !on);
    });
    if (lastCentered !== selected) {
      const first = lastCentered == null;
      lastCentered = selected;
      const strip = box.querySelector('.day-strip');
      const chip = strip?.querySelector(`[data-day="${selected}"]`);
      if (strip && chip) {
        const left = chip.offsetLeft - strip.offsetLeft;
        const visible = left >= strip.scrollLeft && left + chip.offsetWidth <= strip.scrollLeft + strip.clientWidth;
        if (!visible || first) strip.scrollTo({ left: Math.max(0, left - (strip.clientWidth - chip.offsetWidth) / 2), behavior: first ? 'auto' : 'smooth' });
      }
    }
  }
  const chipDate = (d) => { const x = new Date(`${d}T00:00:00`); return `${x.getMonth() + 1}/${x.getDate()} ${'일월화수목금토'[x.getDay()]}`; };

  // ---------- 좌우로 밀어서 날짜 넘기기 ----------
  //  지도 · 가로로 넘기는 줄(날짜 줄 등) · 입력칸 위에서는 동작하지 않음
  let swipe = null;
  function goDay(step) {
    const all = days();
    const i = all.indexOf(selected);
    const next = all[i + step];
    if (!next) return;
    selected = next;
    route.focus = null;
    update();
    const body = $('#sched-body', root);
    body.animate?.([{ opacity: 0.3, transform: `translateX(${step * 24}px)` }, { opacity: 1, transform: 'none' }], { duration: 180, easing: 'ease-out' });
  }
  const onTouchStart = (e) => {
    const t = e.touches[0];
    if (e.touches.length !== 1 || e.target.closest('.leaflet-container, .overflow-x-auto, input, textarea, select')) { swipe = null; return; }
    swipe = { x: t.clientX, y: t.clientY, at: Date.now() };
  };
  const onTouchEnd = (e) => {
    if (!swipe) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipe.x; const dy = t.clientY - swipe.y;
    const fast = Date.now() - swipe.at < 700;
    swipe = null;
    if (fast && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.6) goDay(dx < 0 ? 1 : -1);
  };
  root.addEventListener('touchstart', onTouchStart, { passive: true });
  root.addEventListener('touchend', onTouchEnd, { passive: true });

  // 그날 숙소: 날짜 헤더에서 정한 숙소(출발 = 전날 밤, 도착 = 그날 밤). 지도에는 토글과 상관없이 늘 표시
  //  [숙소 출발·복귀]: 숙소를 정한 날은 기본 켬, 정하지 않았으면 가장 가까운 기준점을 쓰고 기본 끔
  function currentRoute(items) {
    const getPlace = (id) => store.get('places', id);
    const base = buildRoute(items, getPlace);
    const st = dayStays(store.list('itinerary_days'), selected, livePlace);
    let startH = getPlace(st.start); let endH = getPlace(st.end);
    const hasStay = !!(startH || endH);
    const on = route.hotel ?? hasStay;
    if (!hasStay && on && base.stops.length) {
      const anchors = store.list('places').filter((p) => p.is_anchor);
      startH = endH = nearestAnchor(anchors, base.stops[0].place);
    }
    const hotels = [...new Set([startH, endH].filter((h) => h && h.lat != null))];
    if (!on || !base.stops.length) return { ...base, hotels, on };
    // 숙소가 일정의 첫·마지막 장소와 같으면 그쪽 연결은 생략
    const first = base.stops[0].place.id; const last = base.stops[base.stops.length - 1].place.id;
    const plan = buildRoute(items, getPlace, { start: startH && startH.id !== first ? startH : null, end: endH && endH.id !== last ? endH : null });
    return { ...plan, hotels, on };
  }
  const livePlace = (id) => { const p = store.get('places', id); return !!p && !p.deleted_at; };

  // 구간 색: 장소 사이는 순서대로 색이 변함, 숙소 오가는 구간은 주황
  const stopSegs = (plan) => plan.segments.filter((sg) => !sg.from.edge && !sg.to.edge);
  function segColorOf(plan, sg) {
    if (sg.from.edge || sg.to.edge) return HOTEL_COLOR;
    const list = stopSegs(plan);
    return segColor(list.indexOf(sg), list.length);
  }

  function renderRoute(plan) {
    const box = $('#route-box', root);
    // 장소가 연결된 일정이 하나도 없으면 동선 칸을 숨김
    box.classList.toggle('hidden', !selected || !plan.stops.length);
    if (!selected || !plan.stops.length) return;
    setHTML($('#route-head', root), html`
      <i class="fa-solid fa-route text-neon-cyan flex-shrink-0"></i>
      <span class="whitespace-nowrap flex-shrink-0">동선 지도</span>
      <span class="text-slate-400 font-normal truncate min-w-0">${plan.stops.length}곳${plan.segments.length ? html` · ${totalText(plan.segments)}` : ''}</span>
      <i class="fa-solid ${route.open ? 'fa-chevron-up' : 'fa-chevron-down'} ml-auto text-slate-400"></i>`);
    $('#route-panel', root).classList.toggle('hidden', !route.open);
    if (!route.open) return;
    if (route.focus != null && !plan.segments[route.focus]) route.focus = null;

    const hasAnchor = store.list('places').some((p) => p.is_anchor && p.lat != null) || plan.hotels.length > 0;
    const short = (name) => (name.length > 8 ? `${name.slice(0, 8)}…` : name);
    const label = (pt) => (pt.edge
      ? html`<span class="text-amber-300 font-bold whitespace-nowrap"><i class="fa-solid fa-hotel text-[10px] mr-0.5"></i>${short(pt.place.name)}</span>`
      : html`<span class="text-rose-200 font-black">${circled(pt.no)}</span>`);
    setHTML($('#route-list', root), html`
      ${plan.segments.length ? plan.segments.map((sg, i) => html`
        <div data-action="seg" data-i="${i}" class="flex items-center gap-1.5 text-[11px] min-w-0 px-1.5 py-1 rounded-lg cursor-pointer ${route.focus === i ? 'bg-white/10' : route.focus != null ? 'opacity-50' : ''}">
          <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${segColorOf(plan, sg)}"></span>
          <span class="flex-shrink-0 flex items-center gap-1">${label(sg.from)}<i class="fa-solid fa-arrow-right text-[8px] text-slate-500"></i>${label(sg.to)}</span>
          <span class="truncate min-w-0 ${sg.transit ? 'text-amber-200' : 'text-slate-300'}">${sg.text}</span>
          <a href="${directionsHref(sg.from.place, sg.to.place, sg.transit)}" target="_blank" rel="noopener" class="ml-auto flex-shrink-0 px-2 py-0.5 rounded-md bg-slate-800 border border-white/10 text-neon-cyan text-[10px] font-bold">
            <i class="fa-solid fa-diamond-turn-right mr-0.5"></i>길찾기</a>
        </div>`) : html`<p class="text-[11px] text-slate-400">장소가 한 곳이라 이동 구간이 없어요.</p>`}
      <div class="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-white/5">
        <span class="text-[9px] text-slate-500 leading-tight">${plan.segments.length > 1 ? '구간을 누르면 지도에서 그 구간만 보여요 · ' : ''}직선 거리 × 1.3 어림${plan.skipped ? ` · 위치 없는 장소 ${plan.skipped}곳 제외` : ''}</span>
        ${hasAnchor ? html`<button data-action="route-hotel" class="flex-shrink-0 text-[10px] px-2 py-1 rounded-lg font-bold ${plan.on ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40' : 'bg-slate-800 text-slate-400 border border-white/10'}">
          <i class="fa-solid fa-hotel mr-0.5"></i>숙소 출발·복귀 ${plan.on ? '켬' : '끔'}</button>` : ''}
      </div>`);
    route.plan = plan;
    drawRouteMap(plan);
  }

  async function drawRouteMap(plan) {
    if (!route.lib) {
      try { route.lib = await loadMapLib(); } catch {
        const el = $('#route-loading', root);
        if (el) el.textContent = '지도를 불러오지 못했어요. 온라인 상태에서 다시 열어주세요.';
        return;
      }
      if (route.destroyed) return;
    }
    const { L, createMap, pinIcon, routePinSize, routeZoomBand, arrowIcon } = route.lib;
    if (!route.map) {
      route.map = createMap($('#route-map', root), { zoom: 14 });
      route.layer = L.layerGroup().addTo(route.map);
      $('#route-loading', root)?.remove();
      // 확대 단계가 바뀔 때만 핀 크기를 다시 그림
      let band = routeZoomBand(route.map.getZoom());
      route.map.on('zoomend', () => {
        const b = routeZoomBand(route.map.getZoom());
        if (b !== band && route.plan) { band = b; drawRouteMap(route.plan); }
      });
    }
    setTimeout(() => route.map?.invalidateSize(), 50);
    route.layer.clearLayers();
    const zoom = route.map.getZoom();
    const ll = (p) => [p.lat, p.lng];
    const focus = route.focus;
    const dim = (i) => focus != null && focus !== i;

    // 선: 장소 사이는 순서 색 실선(전철 권장은 점선), 숙소 구간은 주황 점선. 가운데 방향 화살표
    plan.segments.forEach((sg, i) => {
      const c = segColorOf(plan, sg);
      const hotelSeg = sg.from.edge || sg.to.edge;
      const a = ll(sg.from.place); const b = ll(sg.to.place);
      L.polyline([a, b], {
        color: c, weight: focus === i ? 6 : 4, opacity: dim(i) ? 0.2 : 0.9,
        dashArray: hotelSeg || sg.transit ? '7 7' : null, interactive: false,
      }).addTo(route.layer);
      if (!dim(i)) {
        L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { icon: arrowIcon(route.map, a, b, c), interactive: false, keyboard: false }).addTo(route.layer);
      }
    });
    // 번호 핀: 순서 색. 숙소와 같은 장소면 주황 테두리
    const hotelIds = new Set(plan.hotels.map((h) => h.id));
    plan.stops.forEach((st) => {
      const ring = hotelIds.has(st.place.id) ? HOTEL_COLOR : null;
      const fill = segColor(st.no - 1, plan.stops.length);   // 선과 같은 순서 색
      const size = routePinSize(zoom);
      L.marker(ll(st.place), {
        icon: pinIcon({ color: fill, size, label: st.no, ring }),
        zIndexOffset: 100 + st.no,
      })
        .bindTooltip(esc(st.place.name), { direction: 'top', offset: [0, -size / 2] })
        .on('click', () => (onPlace ? onPlace(st.place.id) : openPlaceDetail(store, st.place.id, null)))
        .addTo(route.layer);
    });
    // 숙소: 주황 사각형 · 번호 핀보다 크게(겹쳐도 테두리가 보임) · 토글이 꺼져 있어도 표시. 누르면 이름
    plan.hotels.forEach((h) => {
      const size = routePinSize(zoom, { hotel: true });
      L.marker(ll(h), { icon: pinIcon({ color: HOTEL_COLOR, icon: 'fa-hotel', size, shape: 'square' }), zIndexOffset: 50 })
        .bindTooltip(esc(`🏨 ${h.name}`), { direction: 'top', offset: [0, -size / 2] })
        .addTo(route.layer);
    });

    // 날짜나 장소가 바뀐 때만 화면 맞춤 (같은 날 다시 그릴 때는 보던 위치 유지)
    const latlngs = [...plan.points.map((pt) => ll(pt.place)), ...plan.hotels.map(ll)];
    const sig = `${selected}|${latlngs.map((x) => x.join(',')).join(';')}`;
    if (sig !== route.sig) {
      route.sig = sig;
      if (latlngs.length > 1) route.map.fitBounds(L.latLngBounds(latlngs), { padding: [32, 32], maxZoom: 16 });
      else route.map.setView(latlngs[0], 16);
    }
  }

  // 구간 하나 강조: 그 구간으로 지도 이동, 다시 누르면 전체
  function focusSegment(i) {
    const plan = route.plan;
    if (!plan) return;
    route.focus = route.focus === i ? null : i;
    renderRoute(plan);
    const sg = plan.segments[route.focus];
    if (sg && route.map) route.map.fitBounds(route.lib.L.latLngBounds([[sg.from.place.lat, sg.from.place.lng], [sg.to.place.lat, sg.to.place.lng]]), { padding: [40, 40], maxZoom: 17 });
    else if (route.map) { route.sig = ''; drawRouteMap(plan); }
  }

  const off = delegate(root, {
    'ai-plan': async () => {
      const { openAiPlan } = await import('../ai-plan.js');
      openAiPlan(store, { dates: days(), day: selected, onApplied: (d) => { selected = d; update(); } });
    },
    'ai-undo': () => {
      const rec = loadUndo(store.tripId);
      if (!rec) { update(); return; }
      if (!confirmAction(`AI 가 넣은 일정 ${rec.inserted.length}개를 지우${rec.removed.length ? `고, 지웠던 일정 ${rec.removed.length}개를 되살리` : ''}까요?`)) return;
      const r = undoPlan(store, rec);
      clearUndo(store.tripId);
      toast(r.skipped ? `되돌렸어요. 다른 사람이 그 사이 고친 일정 ${r.skipped}개는 그대로 뒀어요.` : '되돌렸어요.');
      update();
    },
    'ai-undo-close': () => { clearUndo(store.tripId); update(); },
    'route-toggle': () => { route.open = !route.open; setPref(PREF_ROUTE_OPEN, route.open); update(); },
    'route-hotel': () => { route.hotel = !(route.plan?.on); setPref(PREF_ROUTE_HOTEL, route.hotel); route.focus = null; update(); },
    seg: (el, e) => { if (e?.target?.closest('a')) return; focusSegment(Number(el.dataset.i)); },
    day: (el) => { selected = el.dataset.day; route.focus = null; update(); },
    place: (el) => (onPlace ? onPlace(el.dataset.id) : openPlaceDetail(store, el.dataset.id, null)),
    add: () => openItemEditor(store, null, selected),
    edit: (el) => openItemEditor(store, el.dataset.id, selected),
    'edit-day': () => openDayEditor(store, selected),
    'add-day': () => {
      const d = prompt('추가할 날짜 (YYYY-MM-DD)');
      if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
      if (!store.list('itinerary_days').some((x) => x.day_date === d)) store.insert('itinerary_days', { day_date: d });
      selected = d; update();
    },
  });

  update();
  return {
    update,
    destroy: () => {
      off(); route.destroyed = true; route.map?.remove(); route.map = null;
      root.removeEventListener('touchstart', onTouchStart); root.removeEventListener('touchend', onTouchEnd);
    },
  };
}

// 숙소 후보: 숙소 종류 카테고리 장소 + 기준점 (숙소 종류 먼저)
function stayCandidates(store) {
  const isLodging = (p) => store.category(p.category_id)?.kind === 'lodging';
  return store.list('places').filter((p) => isLodging(p) || p.is_anchor)
    .sort((a, b) => (isLodging(b) - isLodging(a)) || String(a.name).localeCompare(String(b.name), 'ko'));
}

// 날짜 헤더 아래 숙소 한 줄: "🏨 도미인 프리미엄 난바" / 옮기는 날 "A → B" / 이어진 값은 흐리게
function stayLine(store, date, readOnly) {
  const live = (id) => { const p = store.get('places', id); return !!p && !p.deleted_at; };
  const st = dayStays(store.list('itinerary_days'), date, live);
  const name = (id) => store.get('places', id)?.name || '';
  if (!st.end && !st.start) {
    return readOnly || !stayCandidates(store).length ? '' : html`<p class="text-[10px] text-slate-500 mt-1"><i class="fa-solid fa-hotel mr-1"></i>오늘 묵는 숙소를 정할 수 있어요</p>`;
  }
  return html`<p class="text-[11px] mt-1 ${st.inherited && !st.moved ? 'text-amber-200/60' : 'text-amber-200'} truncate">
    <i class="fa-solid fa-hotel mr-1"></i>${st.moved ? html`${name(st.start)} <i class="fa-solid fa-arrow-right text-[9px] mx-0.5"></i> ${name(st.end)} <span class="text-[10px] text-slate-400">(숙소 이동)</span>` : name(st.end || st.start)}</p>`;
}

function openDayEditor(store, day) {
  const cur = store.list('itinerary_days').find((d) => d.day_date === day);
  const stays = stayCandidates(store);
  // 이 날을 비워두면 이어질 숙소 (전날까지 중 가장 최근)
  const prev = store.list('itinerary_days').filter((d) => d.stay_place_id && d.day_date < day).sort((a, b) => b.day_date.localeCompare(a.day_date))[0];
  const inherited = prev ? store.get('places', prev.stay_place_id) : null;
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${dayLabel(day)} 정보</h3>
    <form id="day-form" class="space-y-2.5">
      <div><label class="label">제목</label><input name="title" class="input" maxlength="80" value="${cur?.title || ''}"></div>
      <div><label class="label">뱃지</label><input name="badge" class="input" maxlength="20" value="${cur?.badge || ''}" placeholder="예: 테마파크 집중"></div>
      <div><label class="label">요약</label><input name="summary" class="input" maxlength="300" value="${cur?.summary || ''}"></div>
      <div>
        <label class="label"><i class="fa-solid fa-hotel text-amber-300 mr-1"></i>오늘 묵는 숙소</label>
        <select name="stay_place_id" class="input">
          <option value="">${inherited ? `앞 날과 같음 (${inherited.name})` : '정하지 않음'}</option>
          ${stays.map((p) => html`<option value="${p.id}" ${cur?.stay_place_id === p.id ? 'selected' : ''}>${p.name}${p.is_anchor ? '' : ' (기준점 아님)'}</option>`)}
        </select>
        <p class="text-[10px] text-slate-500 mt-1">다음 날들도 바꿀 때까지 이 숙소로 이어져요. 동선 지도의 숙소 출발·복귀와 AI 일정 짜기가 이 숙소를 써요.</p>
      </div>
      <button class="btn-primary">저장</button>
    </form>`, (el) => {
    $('#day-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      v.stay_place_id = v.stay_place_id || null;
      if (cur) store.update('itinerary_days', cur.id, v);
      else store.insert('itinerary_days', { day_date: day, ...v });
      closeSheet();
    });
  });
}

// 장소 카드의 "일정에 넣기"에서도 씀: place 를 주면 제목·연결 장소·아이콘을 미리 채움
const KIND_ICON = { food: 'fa-utensils', cafe: 'fa-mug-saucer', bar: 'fa-beer-mug-empty', spot: 'fa-camera', shop: 'fa-bag-shopping', lodging: 'fa-hotel', transit: 'fa-train-subway' };
export function openItemEditor(store, id, day, { place = null } = {}) {
  const it = id ? store.get('itinerary_items', id)
    : { day_date: day, icon: KIND_ICON[store.category(place?.category_id)?.kind] || 'fa-location-dot', title: place?.name || '', place_id: place?.id || null };
  const places = store.list('places').sort((a, b) => a.name.localeCompare(b.name));
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '일정 수정' : '일정 추가'}</h3>
    <form id="item-form" class="space-y-2.5">
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">날짜</label><input type="date" name="day_date" class="input" required value="${it.day_date || ''}"></div>
        <div><label class="label">시간 (현지)</label><input type="time" name="start_time" class="input" value="${shortTime(it.start_time)}"></div>
      </div>
      <div><label class="label">제목 *</label><input name="title" class="input" required maxlength="100" value="${it.title || ''}"></div>
      <div><label class="label">설명</label><textarea name="description" class="input" rows="2" maxlength="1000">${it.description || ''}</textarea></div>
      <div><label class="label">주의 문구</label><input name="alert" class="input" maxlength="300" value="${it.alert || ''}"></div>
      <div><label class="label">연결할 장소</label>
        <select name="place_id" class="input"><option value="">없음</option>
          ${places.map((p) => html`<option value="${p.id}" ${p.id === it.place_id ? 'selected' : ''}>${p.name}</option>`)}</select></div>
      <div><label class="label">아이콘</label>
        <div class="flex flex-wrap gap-1.5" id="icon-pick">
          ${ICONS.map((ic) => html`<button type="button" data-action="icon" data-icon="${ic}" class="w-8 h-8 rounded-lg ${ic === it.icon ? 'bg-neon-cyan text-night-950' : 'bg-slate-800 text-slate-300'}"><i class="fa-solid ${ic} text-xs"></i></button>`)}
        </div><input type="hidden" name="icon" value="${it.icon || 'fa-location-dot'}"></div>
      <button class="btn-primary">${id ? '수정 저장' : '추가'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#item-form', el);
    const off = delegate(el, {
      icon: (b) => {
        form.elements.icon.value = b.dataset.icon;
        el.querySelectorAll('[data-action="icon"]').forEach((x) => {
          x.className = `w-8 h-8 rounded-lg ${x === b ? 'bg-neon-cyan text-night-950' : 'bg-slate-800 text-slate-300'}`;
        });
      },
      delete: () => {
        if (!confirmAction('이 일정을 삭제할까요?')) return;
        store.remove('itinerary_items', id); closeSheet(); toast('삭제했습니다.');
      },
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      // 정렬은 sort_order 기준 (자정을 넘기는 일정 때문). 새 항목은 같은 날 시간 순서에 맞는 위치에 끼워넣음
      let sort = it.sort_order;
      if (!id || v.day_date !== it.day_date || v.start_time !== shortTime(it.start_time)) {
        const same = store.list('itinerary_items').filter((x) => x.day_date === v.day_date && x.id !== id);
        const before = same.filter((x) => v.start_time && x.start_time && shortTime(x.start_time) <= v.start_time);
        const lo = before.length ? Math.max(...before.map((x) => x.sort_order)) : 0;
        const higher = same.map((x) => x.sort_order).filter((s) => s > lo);
        const hi = higher.length ? Math.min(...higher) : lo + 20;
        sort = v.start_time ? (lo + hi) / 2 : (same.length ? same[same.length - 1].sort_order + 10 : 10);
      }
      const data = { ...v, sort_order: sort };
      if (id) store.update('itinerary_items', id, data); else store.insert('itinerary_items', data);
      closeSheet();
      // 연결한 장소가 그날·그 시간에 닫혀 있으면 알려줌 (저장은 그대로)
      const pl = v.place_id ? store.get('places', v.place_id) : null;
      const issue = pl ? hoursIssueAt(pl.opening_hours, v.day_date, v.start_time) : null;
      if (issue) toast(`저장했어요. 다만 ${pl.name}: ${issue}`, 'error');
      else if (!id && place) toast(`${v.day_date.slice(5).replace('-', '/')} 일정에 넣었어요.`);
    });
    return off;
  });
}
