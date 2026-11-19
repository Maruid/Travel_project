import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard } from '../../components/ui.js';
import { photoThumbsHtml, hydratePhotos, openPhotoViewer, mountPhotoEditor } from '../../components/photos.js';
import { openPicker, placeItem } from '../../components/picker.js';
import { dateRange, dayLabel } from '../../lib/format.js';
import { getPref, setPref, PREF_TODO_HIDE_DONE, PREF_TODO_MINE } from '../../lib/prefs.js';
import { KINDS, filterTodos, kindCounts, movedSortOrder, linkParts, noteIsLong, packTemplateState, todoPatch } from '../../lib/todo-view.js';

export { KINDS };

export function mount(root, store) {
  let filter = 'all';
  let hideDone = getPref(PREF_TODO_HIDE_DONE);
  let mineOnly = getPref(PREF_TODO_MINE);
  const expanded = new Set();   // 메모를 펼친 항목
  let openList = [];            // 지금 보이는 안 한 항목 (끌어서 옮기기 기준)
  let drag = null;

  function update() {
    if (drag) endDrag(false);
    const all = store.list('todos');
    const me = store.me?.id || null;
    const multi = store.activeMembers().length > 1;
    const mine = mineOnly && me && multi ? me : null;
    const counts = kindCounts(all, { mine });
    const { open, shown, hiddenDone } = filterTodos(all, { kind: filter, hideDone, mine });
    openList = open;
    const c = counts[filter] || counts.all;
    const pct = c.total ? Math.round((c.done / c.total) * 100) : 0;
    const canDrag = open.length > 1;
    const toggleBtn = (action, on, icon, label) => html`
      <button data-action="${action}" class="px-2 py-1 rounded-lg border text-[10px] font-bold whitespace-nowrap flex items-center gap-1 ${on ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/50' : 'bg-slate-800 text-slate-400 border-white/10'}">
        <i class="fa-solid ${icon} text-[9px]"></i>${label}</button>`;

    setHTML(root, html`
      <div class="p-4 space-y-3">
        <div class="glass-card p-4 rounded-2xl">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-slate-400">${filter === 'all' ? '할 일' : KINDS[filter]}${mine ? ' · 내 담당' : ''}</span>
            <span class="text-xs font-mono font-bold text-neon-cyan">${c.done}/${c.total} (${pct}%)</span>
          </div>
          <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full bg-gradient-to-r from-neon-cyan to-neon-blue transition-all" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="flex gap-1 overflow-x-auto no-scrollbar text-[11px]">
          ${[['all', '전체'], ...Object.entries(KINDS)].map(([k, t]) => html`
            <button data-action="filter" data-k="${k}" class="px-2.5 py-1 rounded-lg whitespace-nowrap flex-shrink-0 ${filter === k ? 'bg-neon-cyan text-night-950 font-bold' : 'glass-card text-slate-300'}">${t}
              <span class="font-mono text-[10px] ${filter === k ? 'text-night-950/70' : 'text-slate-500'}">${counts[k].done}/${counts[k].total}</span></button>`)}
        </div>
        <div class="flex items-center gap-1.5">
          <div class="flex gap-1.5 overflow-x-auto no-scrollbar min-w-0 flex-1">
            ${toggleBtn('hide-done', hideDone, 'fa-eye-slash', '완료 숨기기')}
            ${multi && me ? toggleBtn('mine', mineOnly, 'fa-user', '내 담당만') : ''}
            <button data-action="template" class="px-2 py-1 rounded-lg border bg-slate-800 text-slate-400 border-white/10 text-[10px] font-bold whitespace-nowrap">🧳 준비물 목록</button>
          </div>
          <button data-action="add" class="px-2.5 py-1 rounded-lg bg-neon-cyan text-night-950 font-bold text-xs flex-shrink-0 whitespace-nowrap">+ 추가</button>
        </div>
        <div class="space-y-2" id="todo-list">
          ${shown.length ? shown.map((t) => rowHtml(store, t, { open: !t.done, canDrag, expanded: expanded.has(t.id), multi })) : emptyCard(hiddenDone ? '남은 항목이 없어요. 다 했어요! 🎉' : '항목이 없습니다.')}
          ${hiddenDone ? html`<button data-action="hide-done" class="w-full py-2 text-[11px] text-slate-500">완료 ${hiddenDone}개 숨김 · 보기</button>` : ''}
        </div>
      </div>`);
    hydratePhotos(root, store);
  }

  // ------------------------------------------------ 끌어서 순서 바꾸기 (안 한 항목끼리, 손잡이로)
  function onDown(e) {
    const grip = e.target.closest('[data-grip]');
    if (!grip || drag) return;
    const rows = [...root.querySelectorAll('[data-open-row]')];
    const rowEl = grip.closest('[data-open-row]');
    const from = rows.indexOf(rowEl);
    if (from < 0 || rows.length !== openList.length) return;
    e.preventDefault();
    try { grip.setPointerCapture(e.pointerId); } catch {}
    const rects = rows.map((r) => r.getBoundingClientRect());
    const gap = rects.length > 1 ? Math.max(0, rects[1].top - rects[0].bottom) : 8;
    drag = { grip, rows, rowEl, from, to: from, rects, step: rects[from].height + gap, startY: e.clientY, id: e.pointerId };
    rowEl.style.zIndex = '5';
    rowEl.style.position = 'relative';
    rowEl.classList.add('ring-1', 'ring-neon-cyan/60');
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { rows, rowEl, from, rects, step } = drag;
    const dy = e.clientY - drag.startY;
    rowEl.style.transform = `translateY(${dy}px)`;
    const center = rects[from].top + rects[from].height / 2 + dy;
    let to = from;
    rects.forEach((r, i) => {
      const mid = r.top + r.height / 2;
      if (i < from && center < mid) to = Math.min(to, i);
      if (i > from && center > mid) to = Math.max(to, i);
    });
    drag.to = to;
    rows.forEach((r, i) => {
      if (i === from) return;
      const s = from < to && i > from && i <= to ? -step : to < from && i >= to && i < from ? step : 0;
      r.style.transition = 'transform 120ms';
      r.style.transform = s ? `translateY(${s}px)` : '';
    });
  }
  function endDrag(save) {
    const d = drag;
    drag = null;
    d.rows.forEach((r) => { r.style.transform = ''; r.style.transition = ''; r.style.zIndex = ''; r.style.position = ''; });
    d.rowEl.classList.remove('ring-1', 'ring-neon-cyan/60');
    if (!save) return;
    const order = movedSortOrder(openList, d.from, d.to);
    if (order != null) store.update('todos', openList[d.from].id, { sort_order: order });
  }
  const onUp = (e) => { if (drag && e.pointerId === drag.id) endDrag(e.type === 'pointerup'); };
  root.addEventListener('pointerdown', onDown);
  root.addEventListener('pointermove', onMove);
  root.addEventListener('pointerup', onUp);
  root.addEventListener('pointercancel', onUp);

  const off = delegate(root, {
    filter: (el) => { filter = el.dataset.k; update(); },
    'hide-done': () => { hideDone = !hideDone; setPref(PREF_TODO_HIDE_DONE, hideDone); update(); },
    mine: () => { mineOnly = !mineOnly; setPref(PREF_TODO_MINE, mineOnly); update(); },
    grip: () => {},
    toggle: (el) => toggleTodo(store, el.dataset.id),
    expand: (el) => {
      const id = el.dataset.id;
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      update();
    },
    place: async (el) => (await import('./places.js')).openPlaceDetail(store, el.dataset.id, null),
    delete: (el) => removeTodo(store, el.dataset.id),
    edit: (el) => openTodoEditor(store, el.dataset.id, filter),
    photo: (el) => openPhotoViewer(store, el.dataset.img),
    add: () => openTodoEditor(store, null, filter),
    template: () => openPackTemplate(store, () => { filter = 'pack'; update(); }),
  });

  update();
  return {
    update,
    destroy: () => {
      off();
      root.removeEventListener('pointerdown', onDown);
      root.removeEventListener('pointermove', onMove);
      root.removeEventListener('pointerup', onUp);
      root.removeEventListener('pointercancel', onUp);
    },
  };
}

function rowHtml(store, t, { open, canDrag, expanded, multi }) {
  const place = t.place_id ? store.get('places', t.place_id) : null;
  const who = multi && t.assignee ? store.member(t.assignee) : null;
  const long = noteIsLong(t.note);
  const chip = 'text-[10px] px-1.5 rounded bg-slate-800 whitespace-nowrap';
  return html`
    <div data-action="toggle" data-id="${t.id}" ${open ? html`data-open-row` : ''} class="glass-card p-3 rounded-2xl flex items-start gap-2.5 cursor-pointer">
      ${open && canDrag ? html`<span data-action="grip" data-grip class="-ml-1 -my-1 py-2 w-4 self-stretch flex items-center justify-center text-slate-600 cursor-grab" style="touch-action:none" title="끌어서 순서 바꾸기"><i class="fa-solid fa-grip-vertical text-[10px]"></i></span>` : ''}
      <div class="w-5 h-5 mt-px rounded-lg border ${t.done ? 'bg-neon-cyan border-neon-cyan text-night-950' : 'border-slate-500 text-transparent'} flex items-center justify-center text-xs flex-shrink-0">
        <i class="fa-solid fa-check"></i></div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-1.5 mb-0.5">
          <span class="text-[9px] px-1.5 rounded bg-slate-800 text-slate-300 font-bold flex-shrink-0">${KINDS[t.kind] || KINDS.todo}</span>
          <h5 class="text-xs font-bold ${expanded ? 'break-keep' : 'truncate'} ${t.done ? 'line-through text-slate-500' : 'text-white'}">${t.title}</h5>
        </div>
        ${place || t.day_date || who ? html`<div class="flex flex-wrap items-center gap-1 mb-0.5">
          ${t.day_date ? html`<span class="${chip} text-lime-300"><i class="fa-solid fa-calendar-day mr-0.5"></i>${dayLabel(t.day_date)}</span>` : ''}
          ${who ? html`<span class="${chip} text-sky-300"><i class="fa-solid fa-user mr-0.5"></i>${who.display_name}</span>` : ''}
          ${place ? html`<button data-action="place" data-id="${place.id}" class="${chip} text-amber-300 max-w-full truncate"><i class="fa-solid fa-location-dot mr-0.5"></i>${place.name}${place.visited_at ? ' ✓' : ''}</button>` : ''}
        </div>` : ''}
        ${t.note ? html`<div class="flex items-start gap-1">
          <p class="flex-1 min-w-0 text-[10px] ${expanded ? 'whitespace-pre-line break-all' : 'truncate'} ${t.done ? 'text-slate-600' : 'text-slate-400'}">${noteHtml(t.note)}</p>
          ${long ? html`<button data-action="expand" data-id="${t.id}" class="flex-shrink-0 px-1 text-[10px] text-slate-500" title="${expanded ? '접기' : '펼치기'}"><i class="fa-solid fa-chevron-${expanded ? 'up' : 'down'}"></i></button>` : ''}
        </div>` : ''}
        ${photoThumbsHtml(store, 'todo', t.id, { size: 'w-10 h-10' })}
      </div>
      <button data-action="edit" data-id="${t.id}" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-400 text-[10px] flex-shrink-0" title="수정 · 사진"><i class="fa-solid fa-pen"></i></button>
      <button data-action="delete" data-id="${t.id}" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-500 hover:text-rose-400 text-xs flex-shrink-0" title="삭제"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

// 메모: https 링크는 누르면 열림 (delegate 가 링크는 체크하지 않고 그대로 열어 줌)
function noteHtml(note) {
  return linkParts(note).map((p) => (p.url
    ? html`<a href="${p.url}" target="_blank" rel="noopener" class="text-neon-cyan underline">${p.url}</a>`
    : p.text));
}

// 체크 · 해제. 일정 탭의 "이 날 할 일"에서도 씀
//  갈 곳 + 연결 장소 → 장소도 다녀옴으로 · 살 것 → [지출 기록] 버튼
export function toggleTodo(store, id) {
  const t = store.get('todos', id);
  if (!t) return;
  const done = !t.done;
  store.update('todos', id, { done });
  if (!done) return;
  const p = t.place_id ? store.get('places', t.place_id) : null;
  if (t.kind === 'place' && p && !p.visited_at) {
    store.update('places', p.id, { visited_at: new Date().toISOString() });
    toast(`"${p.name}" 도 다녀온 곳으로 표시했어요.`);
  } else if (t.kind === 'shop') {
    toast('샀어요! 가계부에도 적을까요?', 'info', { action: { label: '지출 기록', onClick: () => openShopExpense(store, t, p) } });
  }
}

async function openShopExpense(store, t, p) {
  const { openExpenseEditor } = await import('./budget.js');
  openExpenseEditor(store, null, { prefill: { place_name: p?.name || t.title, category: '쇼핑', note: p ? t.title : null } });
}

function removeTodo(store, id) {
  store.remove('todos', id);
  toast('삭제했어요.', 'info', { action: { label: '되돌리기', onClick: () => store.update('todos', id, { deleted_at: null }) } });
}

// 연결할 장소 고르기: 찜 많은 순 → 이름순, 다녀옴 · 찜 표시
function pickPlace(store, selected, onPick) {
  const likes = store.likeMap();
  const places = store.list('places').sort((a, b) => (likes.get(b.id)?.length || 0) - (likes.get(a.id)?.length || 0)
    || String(a.name).localeCompare(String(b.name), 'ko'));
  const badgesOf = (p) => {
    const b = [];
    if (p.visited_at) b.push({ text: '✓ 다녀옴', cls: 'bg-emerald-500/15 text-emerald-300' });
    const n = likes.get(p.id)?.length;
    if (n) b.push({ text: `❤️ ${n}`, cls: 'bg-rose-500/15 text-rose-200' });
    return b;
  };
  openPicker({
    title: '연결할 장소',
    selected: selected || '__none',
    top: [{ id: '__none', title: '연결 안 함', icon: 'fa-xmark', color: '#64748b' }],
    sections: [{ label: '찜 많은 순', items: places.map((p) => placeItem(store, p, { badges: badgesOf(p) })) }],
    categories: store.categories(),
    emptyText: '맞는 장소가 없어요.',
    onPick,
  });
}

// 추가 · 수정 (사진도 여기서). 새 항목도 저장 전에 사진을 붙일 수 있게 id 를 미리 정함
function openTodoEditor(store, id, filter) {
  const t = id ? store.get('todos', id) : { kind: KINDS[filter] ? filter : 'todo' };
  if (!t) return;
  const newId = id || crypto.randomUUID();
  const days = dateRange(store.trip.start_date, store.trip.end_date);
  if (t.day_date && !days.includes(t.day_date)) days.push(t.day_date);
  const members = store.activeMembers();
  const placeName = (pid) => store.get('places', pid)?.name || '';
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '항목 수정' : '새 항목'}</h3>
    <form id="todo-form" class="space-y-2.5">
      <div><label class="label">분류</label><select name="kind" class="input">
        ${Object.entries(KINDS).map(([k, v]) => html`<option value="${k}" ${k === t.kind ? 'selected' : ''}>${v}</option>`)}</select></div>
      <div><label class="label">항목 *</label><input name="title" class="input" required maxlength="100" value="${t.title || ''}"></div>
      <div><label class="label">메모 <span class="text-slate-500 font-normal">(https 링크는 누르면 열려요)</span></label>
        <textarea name="note" class="input" rows="2" maxlength="300">${t.note || ''}</textarea></div>
      <div><label class="label">연결할 장소</label>
        <input type="hidden" name="place_id" value="${t.place_id || ''}">
        <button type="button" data-action="pick-place" id="todo-place-btn" class="input text-left flex items-center gap-2">
          <i class="fa-solid fa-location-dot text-neon-cyan text-[11px]"></i>
          <span class="flex-1 truncate ${t.place_id ? 'text-white' : 'text-slate-500'}">${placeName(t.place_id) || '없음 · 눌러서 고르기'}</span>
          <i class="fa-solid fa-chevron-down text-[10px] text-slate-500"></i>
        </button></div>
      <div class="grid ${members.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
        <div><label class="label">날짜 <span class="text-slate-500 font-normal">(일정에도 보여요)</span></label><select name="day_date" class="input">
          <option value="">날짜 없음</option>
          ${days.sort().map((d) => html`<option value="${d}" ${d === t.day_date ? 'selected' : ''}>${dayLabel(d)}</option>`)}</select></div>
        ${members.length > 1 ? html`<div><label class="label">담당</label><select name="assignee" class="input">
          <option value="">담당 없음</option>
          ${members.map((m) => html`<option value="${m.id}" ${m.id === t.assignee ? 'selected' : ''}>${m.display_name}</option>`)}</select></div>` : ''}
      </div>
      <div data-photos></div>
      <button class="btn-primary">${id ? '수정 저장' : '추가'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#todo-form', el);
    const offPhotos = mountPhotoEditor($('[data-photos]', el), store, 'todo', newId);
    const off = delegate(el, {
      'pick-place': () => pickPlace(store, form.elements.place_id.value || null, (pid) => {
        const none = pid === '__none';
        form.elements.place_id.value = none ? '' : pid;
        const label = $('#todo-place-btn span', el);
        label.textContent = none ? '없음 · 눌러서 고르기' : placeName(pid);
        label.className = `flex-1 truncate ${none ? 'text-slate-500' : 'text-white'}`;
        if (!none && !form.elements.title.value.trim()) form.elements.title.value = placeName(pid);
      }),
      delete: () => { closeSheet(); removeTodo(store, id); },
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      if (id) {
        const patch = todoPatch(t, v);
        if (Object.keys(patch).length) store.update('todos', id, patch);
      } else {
        store.insert('todos', { ...todoPatch({}, v), id: newId, done: false, sort_order: store.nextSortOrder('todos') });
      }
      closeSheet();
    });
    return () => { off(); offPhotos(); };
  });
}

// 준비물 기본 목록 → 고른 것만 🧳 챙길 것으로 (이미 있는 제목은 빼 둠)
function openPackTemplate(store, onDone) {
  const items = packTemplateState(store.list('todos'));
  const groups = [...new Set(items.map((x) => x.group))];
  const fresh = items.filter((x) => !x.exists).length;
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">🧳 준비물 기본 목록</h3>
    <p class="text-[11px] text-slate-400 mb-3">고른 항목을 "챙길 것"으로 넣어요. 넣은 뒤에 고치거나 지울 수 있어요.</p>
    <form id="pack-form" class="space-y-3">
      ${groups.map((g) => html`<div>
        <p class="label">${g}</p>
        <div class="space-y-1">${items.map((x, i) => (x.group === g ? html`
          <label class="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-800/70 text-xs ${x.exists ? 'text-slate-500' : 'text-slate-200'}">
            <input type="checkbox" name="pick" value="${i}" ${x.exists ? 'disabled' : 'checked'} class="accent-cyan-400">
            <span class="flex-1 min-w-0 truncate">${x.title}</span>${x.exists ? html`<span class="text-[10px]">이미 있음</span>` : ''}</label>` : ''))}</div>
      </div>`)}
      <button class="btn-primary" ${fresh ? '' : 'disabled'}>${fresh ? '고른 항목 넣기' : '모두 이미 있어요'}</button>
    </form>`, (el) => {
    const form = $('#pack-form', el);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const picked = [...form.querySelectorAll('input[name=pick]:checked')].map((x) => items[Number(x.value)]);
      if (!picked.length) { toast('넣을 항목을 골라 주세요.', 'error'); return; }
      picked.forEach((x) => store.insert('todos', { kind: 'pack', title: x.title, done: false, sort_order: store.nextSortOrder('todos') }));
      closeSheet();
      toast(`${picked.length}개를 넣었어요.`);
      onDone?.();
    });
  });
}
