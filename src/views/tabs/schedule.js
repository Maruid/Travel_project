import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { dateRange, dayLabel, shortTime, todayIn } from '../../lib/format.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { openPlaceDetail, loadMapLib } from './places.js';
import { buildRoute, directionsHref, nearestAnchor, totalText, circled } from '../../lib/route-plan.js';
import { getPref, setPref, PREF_ROUTE_OPEN, PREF_ROUTE_HOTEL } from '../../lib/prefs.js';
import { esc } from '../../lib/dom.js';
import { color } from '../../lib/safe.js';
import { hoursIssueAt } from '../../lib/hours.js';

const ICONS = ['fa-location-dot', 'fa-utensils', 'fa-mug-saucer', 'fa-train-subway', 'fa-taxi', 'fa-plane-departure',
  'fa-plane-arrival', 'fa-hotel', 'fa-bed', 'fa-hot-tub-person', 'fa-camera', 'fa-bag-shopping', 'fa-tree', 'fa-landmark',
  'fa-person-walking', 'fa-ticket', 'fa-gamepad', 'fa-beer-mug-empty', 'fa-sun', 'fa-moon'];

export function mount(root, store) {
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
  const route = { open: getPref(PREF_ROUTE_OPEN), hotel: getPref(PREF_ROUTE_HOTEL), map: null, layer: null, sig: '', lib: null, destroyed: false };

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
    setHTML($('#sched-tabs', root), html`
        <div class="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          ${all.map((d, i) => html`
            <button data-action="day" data-day="${d}" class="flex-shrink-0 text-xs px-3 py-1.5 rounded-xl font-bold ${d === selected ? 'bg-rose-500 text-white shadow-lg' : 'glass-card text-slate-400'}">
              ${i + 1}일 (${dayLabel(d)})</button>`)}
          <button data-action="add-day" class="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-xl glass-card text-slate-400" title="날짜 추가"><i class="fa-solid fa-plus"></i></button>
        </div>`);
    renderRoute(plan);

    setHTML($('#sched-body', root), html`
        ${selected ? html`
          <div data-action="edit-day" class="glass-card p-3.5 rounded-2xl border-l-4 border-rose-500 cursor-pointer">
            <div class="flex items-center gap-1.5 mb-0.5">
              <span class="text-xs font-bold text-white">${dayLabel(selected)}</span>
              ${header?.badge ? html`<span class="text-[10px] px-2 rounded-full bg-rose-500/20 text-rose-300 font-bold border border-rose-500/30">${header.badge}</span>` : ''}
              <i class="fa-solid fa-pen text-[9px] text-slate-500 ml-auto"></i>
            </div>
            <h4 class="text-sm font-extrabold text-white">${header?.title || '이 날의 제목을 정해보세요'}</h4>
            ${header?.summary ? html`<p class="text-[11px] text-slate-400 mt-0.5">${header.summary}</p>` : ''}
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
                    <h5 class="text-xs font-bold text-white">${it.title}</h5>
                    <span class="text-[10px] font-mono font-bold text-neon-cyan flex-shrink-0">${shortTime(it.start_time)}</span>
                  </div>
                  ${it.description ? html`<p class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line">${it.description}</p>` : ''}
                  ${it.alert ? html`<div class="mt-1.5 p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">${it.alert}</div>` : ''}
                  ${place && hoursIssueAt(place.opening_hours, it.day_date, shortTime(it.start_time)) ? html`
                    <div class="mt-1.5 p-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[10px] text-rose-200">
                      <i class="fa-solid fa-clock mr-1"></i>${place.name}: ${hoursIssueAt(place.opening_hours, it.day_date, shortTime(it.start_time))}</div>` : ''}
                  <div class="mt-2 flex justify-end gap-1.5">
                    ${place ? html`<button data-action="place" data-id="${place.id}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-neon-cyan border border-neon-cyan/30 font-bold"><i class="fa-solid fa-location-dot text-[9px]"></i> ${place.name}</button>` : ''}
                    <button data-action="edit" data-id="${it.id}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-slate-300"><i class="fa-solid fa-pen"></i></button>
                  </div>
                </div>
              </div>`;
            }) : emptyCard('아직 일정이 없습니다.')}
          </div>
          <button data-action="add" class="btn-primary"><i class="fa-solid fa-plus mr-1"></i>일정 추가</button>
        ` : emptyCard('여행 날짜가 없습니다. 설정 탭에서 여행 정보를 설정하거나 날짜를 추가하세요.')}
    `);
  }

  // ---------- 하루 동선 지도 ----------
  function currentRoute(items) {
    const getPlace = (id) => store.get('places', id);
    const base = buildRoute(items, getPlace);
    if (!route.hotel || !base.stops.length) return { ...base, hotel: null };
    const anchors = store.list('places').filter((p) => p.is_anchor);
    const hotel = nearestAnchor(anchors, base.stops[0].place);
    // 숙소가 일정의 첫·마지막 장소와 같으면 그쪽 연결은 생략
    const first = base.stops[0].place.id; const last = base.stops[base.stops.length - 1].place.id;
    const plan = buildRoute(items, getPlace, { start: hotel && hotel.id !== first ? hotel : null, end: hotel && hotel.id !== last ? hotel : null });
    return { ...plan, hotel };
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

    const hasAnchor = store.list('places').some((p) => p.is_anchor && p.lat != null);
    const label = (pt) => (pt.edge ? html`<i class="fa-solid fa-hotel text-amber-300 text-[10px]"></i>` : html`<span class="text-rose-300 font-black">${circled(pt.no)}</span>`);
    setHTML($('#route-list', root), html`
      ${plan.segments.length ? plan.segments.map((sg) => html`
        <div class="flex items-center gap-1.5 text-[11px] min-w-0">
          <span class="flex-shrink-0 flex items-center gap-1">${label(sg.from)}<i class="fa-solid fa-arrow-right text-[8px] text-slate-500"></i>${label(sg.to)}</span>
          <span class="truncate min-w-0 ${sg.transit ? 'text-amber-200' : 'text-slate-300'}">${sg.text}</span>
          <a href="${directionsHref(sg.from.place, sg.to.place, sg.transit)}" target="_blank" rel="noopener" class="ml-auto flex-shrink-0 px-2 py-0.5 rounded-md bg-slate-800 border border-white/10 text-neon-cyan text-[10px] font-bold">
            <i class="fa-solid fa-diamond-turn-right mr-0.5"></i>길찾기</a>
        </div>`) : html`<p class="text-[11px] text-slate-400">장소가 한 곳이라 이동 구간이 없어요.</p>`}
      <div class="flex items-center justify-between gap-2 pt-1.5 mt-1 border-t border-white/5">
        <span class="text-[9px] text-slate-500 leading-tight">직선 거리 × 1.3 으로 어림한 값이에요${plan.skipped ? ` · 위치 없는 장소 ${plan.skipped}곳 제외` : ''}</span>
        ${hasAnchor ? html`<button data-action="route-hotel" class="flex-shrink-0 text-[10px] px-2 py-1 rounded-lg font-bold ${route.hotel ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40' : 'bg-slate-800 text-slate-400 border border-white/10'}">
          <i class="fa-solid fa-hotel mr-0.5"></i>숙소 출발·복귀 ${route.hotel ? '켬' : '끔'}</button>` : ''}
      </div>`);
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
    const { L, createMap, pinIcon } = route.lib;
    if (!route.map) {
      route.map = createMap($('#route-map', root), { zoom: 14 });
      route.layer = L.layerGroup().addTo(route.map);
      $('#route-loading', root)?.remove();
    }
    setTimeout(() => route.map?.invalidateSize(), 50);
    route.layer.clearLayers();
    const latlngs = plan.points.map((pt) => [pt.place.lat, pt.place.lng]);
    // 구간 선: 걷는 구간은 실선, 전철 권장 구간은 점선
    plan.segments.forEach((sg) => {
      L.polyline([[sg.from.place.lat, sg.from.place.lng], [sg.to.place.lat, sg.to.place.lng]], {
        color: sg.transit ? '#fbbf24' : '#f43f5e', weight: 3, opacity: 0.85, dashArray: sg.transit ? '6 6' : null, interactive: false,
      }).addTo(route.layer);
    });
    if (plan.hotel && (plan.points[0]?.edge || plan.points[plan.points.length - 1]?.edge)) {
      L.marker([plan.hotel.lat, plan.hotel.lng], { icon: pinIcon({ color: '#f59e0b', icon: 'fa-hotel', size: 24 }), zIndexOffset: -100 })
        .bindTooltip(esc(plan.hotel.name), { direction: 'top', offset: [0, -12] }).addTo(route.layer);
    }
    plan.stops.forEach((st) => {
      L.marker([st.place.lat, st.place.lng], { icon: pinIcon({ color: '#f43f5e', size: 26, label: st.no }), zIndexOffset: 100 + st.no })
        .bindTooltip(esc(st.place.name), { direction: 'top', offset: [0, -14] })
        .on('click', () => openPlaceDetail(store, st.place.id, null))
        .addTo(route.layer);
    });
    // 날짜나 장소가 바뀐 때만 화면 맞춤 (같은 날 다시 그릴 때는 보던 위치 유지)
    const sig = `${selected}|${latlngs.map((x) => x.join(',')).join(';')}`;
    if (sig !== route.sig) {
      route.sig = sig;
      if (latlngs.length > 1) route.map.fitBounds(L.latLngBounds(latlngs), { padding: [28, 28], maxZoom: 16 });
      else route.map.setView(latlngs[0], 16);
    }
  }

  const off = delegate(root, {
    'route-toggle': () => { route.open = !route.open; setPref(PREF_ROUTE_OPEN, route.open); update(); },
    'route-hotel': () => { route.hotel = !route.hotel; setPref(PREF_ROUTE_HOTEL, route.hotel); update(); },
    day: (el) => { selected = el.dataset.day; update(); },
    place: (el) => openPlaceDetail(store, el.dataset.id, null),
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
    destroy: () => { off(); route.destroyed = true; route.map?.remove(); route.map = null; },
  };
}

function openDayEditor(store, day) {
  const cur = store.list('itinerary_days').find((d) => d.day_date === day);
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${dayLabel(day)} 정보</h3>
    <form id="day-form" class="space-y-2.5">
      <div><label class="label">제목</label><input name="title" class="input" maxlength="80" value="${cur?.title || ''}"></div>
      <div><label class="label">뱃지</label><input name="badge" class="input" maxlength="20" value="${cur?.badge || ''}" placeholder="예: 테마파크 집중"></div>
      <div><label class="label">요약</label><input name="summary" class="input" maxlength="300" value="${cur?.summary || ''}"></div>
      <button class="btn-primary">저장</button>
    </form>`, (el) => {
    $('#day-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
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
