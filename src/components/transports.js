// =====================================================================
// 이동편 (항공편 · 기차 · 배 · 버스) — 일정 탭에 보이는 카드 + 등록 · 수정 창
//   카드: 출발하거나 도착하는 날에 보임 (보통 첫날 · 마지막 날)
//   첫날에 가는 편이 없으면 / 마지막 날에 오는 편이 없으면 [등록] 한 줄
// =====================================================================
import { html, delegate, formValues, $ } from '../lib/dom.js';
import { openSheet, closeSheet, toast, confirmAction } from './ui.js';
import { MODES, DIRECTIONS, modeOf, transportsOn, routeText, titleText } from '../lib/transport.js';
import { openPicker } from './picker.js';
import { AIRPORTS } from '../lib/airports.js';

const shortT = (t) => (t ? String(t).slice(0, 5) : '');

export function transportCardsHtml(store, date, { readOnly = false, firstDay = null, lastDay = null } = {}) {
  const all = store.list('trip_transports');
  const rows = transportsOn(all, date);
  const needOut = !readOnly && date === firstDay && !all.some((t) => t.direction === 'out');
  const needBack = !readOnly && date === lastDay && !all.some((t) => t.direction === 'back');
  if (!rows.length && !needOut && !needBack) return '';
  const addBtn = (dir, label) => html`
    <button data-action="transport-add" data-dir="${dir}" class="w-full p-2.5 rounded-2xl border border-dashed border-sky-400/40 text-[11px] text-sky-200 flex items-center justify-center gap-1.5">
      <i class="fa-solid fa-plane"></i>${label}</button>`;
  return html`
    ${needOut ? addBtn('out', '가는 편 (항공편 등) 등록') : ''}
    ${rows.map((t) => html`
      <div data-action="${readOnly ? 'none' : 'transport'}" data-id="${t.id}" class="glass-card p-3 rounded-2xl border-l-4 border-sky-400 flex items-start gap-3 ${readOnly ? '' : 'cursor-pointer'}">
        <div class="w-8 h-8 rounded-xl bg-sky-500/15 border border-sky-400/30 flex items-center justify-center text-sky-300 text-xs flex-shrink-0 mt-0.5">
          <i class="fa-solid ${modeOf(t).icon}"></i></div>
        <div class="flex-1 min-w-0">
          <p class="text-[10px] font-bold text-sky-300 truncate">${titleText(t)}</p>
          <p class="text-xs font-bold text-white break-keep">${routeText(t)}</p>
          ${t.note ? html`<p class="text-[11px] text-slate-400 mt-0.5 whitespace-pre-line">${t.note}</p>` : ''}
        </div>
        ${readOnly ? '' : html`<i class="fa-solid fa-pen text-[9px] text-slate-500 mt-1"></i>`}
      </div>`)}
    ${needBack ? addBtn('back', '오는 편 (항공편 등) 등록') : ''}`;
}

// 등록 · 수정
export function openTransportEditor(store, id, { direction = 'out' } = {}) {
  if (store.missing?.has('trip_transports')) {
    toast('서버 업데이트가 필요해요. 관리자에게 migration_015 적용을 요청해 주세요.', 'error');
    return;
  }
  const trip = store.trip || {};
  const t = id ? store.get('trip_transports', id) : {
    direction, mode: 'flight',
    dep_date: direction === 'back' ? trip.end_date : trip.start_date,
    arr_date: direction === 'back' ? trip.end_date : trip.start_date,
  };
  if (!t) return;
  const radio = (name, value, label, cur) => html`
    <label class="flex-1"><input type="radio" name="${name}" value="${value}" class="peer sr-only" ${cur === value ? 'checked' : ''}>
      <span class="block text-center py-2 rounded-xl text-[11px] font-bold border border-white/10 bg-slate-800 text-slate-300 peer-checked:bg-sky-500/20 peer-checked:text-sky-200 peer-checked:border-sky-400/50">${label}</span></label>`;
  const side = (key, label) => html`
    <div class="p-2.5 rounded-2xl glass-card space-y-2 min-w-0">
      <span class="text-[10px] font-bold text-slate-400">${label}</span>
      <div class="flex gap-1.5 min-w-0">
        <input name="${key}_name" class="input min-w-0 flex-1" maxlength="60" autocomplete="off"
              value="${t[`${key}_name`] || ''}" placeholder="${key === 'dep' ? '예: 인천 ICN' : '예: 간사이 KIX'}">
        <button type="button" data-action="pick-airport" data-key="${key}"
                class="flex-shrink-0 px-2.5 rounded-xl bg-slate-800 border border-white/10 text-[11px] text-sky-200 font-bold whitespace-nowrap">
          <i class="fa-solid fa-magnifying-glass mr-1"></i>찾기</button>
      </div>
      <div class="grid grid-cols-2 gap-1.5 min-w-0">
        <input type="date" name="${key}_date" class="input min-w-0 w-full appearance-none" value="${t[`${key}_date`] || ''}">
        <input type="time" name="${key}_time" class="input min-w-0 w-full appearance-none" value="${shortT(t[`${key}_time`])}">
      </div>
      <input name="${key}_terminal" class="input" maxlength="20" value="${t[`${key}_terminal`] || ''}" placeholder="터미널 (선택)">
    </div>`;
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '이동편 수정' : '이동편 등록'}</h3>
    <form id="tr-form" class="space-y-2.5">      
      <div class="flex gap-1.5">${Object.entries(DIRECTIONS).map(([k, v]) => radio('direction', k, v, t.direction))}</div>
      <div class="flex gap-1.5">${Object.entries(MODES).map(([k, v]) => radio('mode', k, v.label, t.mode))}</div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">편명</label><input name="code" class="input" maxlength="20" value="${t.code || ''}" placeholder="예: KE723"></div>
        <div><label class="label">항공사 · 회사</label><input name="carrier" class="input" maxlength="40" value="${t.carrier || ''}" placeholder="예: 대한항공"></div>
      </div>
      ${side('dep', '출발 (현지 시각)')}
      ${side('arr', '도착 (현지 시각)')}
      <div><label class="label">메모</label><textarea name="note" class="input" rows="2" maxlength="300" placeholder="예약 번호 · 수하물 · 좌석">${t.note || ''}</textarea></div>
      <p class="text-[10px] text-slate-500">도착 · 출발 시각을 넣으면 AI 일정 짜기가 첫날 · 마지막 날 일정을 그 시간에 맞춰요.</p>
      <button class="btn-primary">${id ? '수정 저장' : '등록'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#tr-form', el);
    // 출발 날짜를 바꾸면 도착 날짜가 비었거나 더 이르면 따라감
    form.elements.dep_date.addEventListener('change', () => {
      const d = form.elements.dep_date.value; const a = form.elements.arr_date;
      if (d && (!a.value || a.value < d)) a.value = d;
    });
    const off = delegate(el, {
      delete: () => {
        if (!confirmAction('이 이동편을 삭제할까요?')) return;
        store.remove('trip_transports', id); closeSheet(); toast('삭제했습니다.');
      },
      'pick-airport': (b) => {
        const key = b.dataset.key;
        const mode = form.elements.mode.value;
        if (mode !== 'flight') { toast('항공편일 때만 공항을 고를 수 있어요. 직접 입력해 주세요.'); return; }
        openPicker({
          title: key === 'dep' ? '출발 공항' : '도착 공항',
          selected: AIRPORTS.find((a) => a.value === form.elements[`${key}_name`].value)?.value,
          sections: [{ items: AIRPORTS.map((a) => ({
            id: a.value, title: a.value, sub: a.label.split(' · ')[1], icon: 'fa-plane',
            place: { name: a.value, zone: a.label, signature: '' },
          })) }],
          emptyText: '없는 공항은 입력칸에 직접 써 주세요.',
          onPick: (v) => { form.elements[`${key}_name`].value = v; },
        });
      },
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      if (!v.dep_name && !v.arr_name && !v.code) { toast('편명이나 출발 · 도착지를 넣어 주세요.', 'error'); return; }
      if (v.dep_date && v.arr_date && v.arr_date < v.dep_date) { toast('도착 날짜가 출발 날짜보다 빨라요.', 'error'); return; }
      if (id) store.update('trip_transports', id, v);
      else store.insert('trip_transports', { ...v, sort_order: store.nextSortOrder('trip_transports') });
      closeSheet();
      toast(id ? '수정했어요.' : '등록했어요.');
    });
    return off;
  });
}
