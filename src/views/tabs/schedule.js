import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { dateRange, dayLabel, shortTime, todayIn } from '../../lib/format.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { openPlaceDetail } from './places.js';
import { color } from '../../lib/safe.js';

const ICONS = ['fa-location-dot', 'fa-utensils', 'fa-mug-saucer', 'fa-train-subway', 'fa-taxi', 'fa-plane-departure',
  'fa-plane-arrival', 'fa-hotel', 'fa-bed', 'fa-hot-tub-person', 'fa-camera', 'fa-bag-shopping', 'fa-tree', 'fa-landmark',
  'fa-person-walking', 'fa-ticket', 'fa-gamepad', 'fa-beer-mug-empty', 'fa-sun', 'fa-moon'];

export function mount(root, store) {
  const tz = () => store.trip.timezone;
  let selected = null;

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

    setHTML(root, html`
      <div class="p-4 space-y-3">
        <div class="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
          ${all.map((d, i) => html`
            <button data-action="day" data-day="${d}" class="flex-shrink-0 text-xs px-3 py-1.5 rounded-xl font-bold ${d === selected ? 'bg-rose-500 text-white shadow-lg' : 'glass-card text-slate-400'}">
              ${i + 1}일 (${dayLabel(d)})</button>`)}
          <button data-action="add-day" class="flex-shrink-0 text-xs px-2.5 py-1.5 rounded-xl glass-card text-slate-400" title="날짜 추가"><i class="fa-solid fa-plus"></i></button>
        </div>

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
              return html`
              <div class="glass-card p-3 rounded-2xl flex items-start gap-3">
                <div class="w-8 h-8 rounded-xl bg-slate-800/80 border border-white/10 flex items-center justify-center text-neon-cyan text-xs flex-shrink-0 mt-0.5">
                  <i class="fa-solid ${it.icon || 'fa-location-dot'}"></i></div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-baseline justify-between gap-1 mb-0.5">
                    <h5 class="text-xs font-bold text-white">${it.title}</h5>
                    <span class="text-[10px] font-mono font-bold text-neon-cyan flex-shrink-0">${shortTime(it.start_time)}</span>
                  </div>
                  ${it.description ? html`<p class="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line">${it.description}</p>` : ''}
                  ${it.alert ? html`<div class="mt-1.5 p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[10px] text-amber-300">${it.alert}</div>` : ''}
                  <div class="mt-2 flex justify-end gap-1.5">
                    ${place ? html`<button data-action="place" data-id="${place.id}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-neon-cyan border border-neon-cyan/30 font-bold"><i class="fa-solid fa-location-dot text-[9px]"></i> ${place.name}</button>` : ''}
                    <button data-action="edit" data-id="${it.id}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-slate-300"><i class="fa-solid fa-pen"></i></button>
                  </div>
                </div>
              </div>`;
            }) : emptyCard('아직 일정이 없습니다.')}
          </div>
          <button data-action="add" class="btn-primary"><i class="fa-solid fa-plus mr-1"></i>일정 추가</button>
        ` : emptyCard('여행 날짜가 없습니다. 멤버 탭에서 여행 정보를 설정하거나 날짜를 추가하세요.')}
      </div>
    `);
  }

  const off = delegate(root, {
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
  return { update, destroy: off };
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

function openItemEditor(store, id, day) {
  const it = id ? store.get('itinerary_items', id) : { day_date: day, icon: 'fa-location-dot' };
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
    });
    return off;
  });
}
