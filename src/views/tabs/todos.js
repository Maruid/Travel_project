import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { photoThumbsHtml, hydratePhotos, openPhotoViewer, mountPhotoEditor } from '../../components/photos.js';

const KINDS = { todo: '🎯 할 것', place: '📍 갈 곳', shop: '🛍️ 살 것' };

export function mount(root, store) {
  let filter = 'all';

  function update() {
    const all = store.list('todos');
    const rows = filter === 'all' ? all : all.filter((t) => t.kind === filter);
    const done = all.filter((t) => t.done).length;
    const pct = all.length ? Math.round((done / all.length) * 100) : 0;

    setHTML(root, html`
      <div class="p-4 space-y-3">
        <div class="glass-card p-4 rounded-2xl">
          <div class="flex items-center justify-between mb-1.5">
            <span class="text-xs font-bold text-slate-400">할 일</span>
            <span class="text-xs font-mono font-bold text-neon-cyan">${done}/${all.length} (${pct}%)</span>
          </div>
          <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full bg-gradient-to-r from-neon-cyan to-neon-blue transition-all" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2">
          <div class="flex gap-1 overflow-x-auto no-scrollbar text-[11px] min-w-0">
            ${[['all', '전체'], ...Object.entries(KINDS)].map(([k, t]) => html`
              <button data-action="filter" data-k="${k}" class="px-2.5 py-1 rounded-lg whitespace-nowrap flex-shrink-0 ${filter === k ? 'bg-neon-cyan text-night-950 font-bold' : 'glass-card text-slate-300'}">${t}</button>`)}
          </div>
          <button data-action="add" class="px-2.5 py-1 rounded-lg bg-neon-cyan text-night-950 font-bold text-xs flex-shrink-0 whitespace-nowrap">+ 추가</button>
        </div>
        <div class="space-y-2">
          ${rows.length ? rows.map((t) => html`
            <div data-action="toggle" data-id="${t.id}" class="glass-card p-3 rounded-2xl flex items-center gap-3 cursor-pointer">
              <div class="w-5 h-5 rounded-lg border ${t.done ? 'bg-neon-cyan border-neon-cyan text-night-950' : 'border-slate-500 text-transparent'} flex items-center justify-center text-xs flex-shrink-0">
                <i class="fa-solid fa-check"></i></div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-0.5">
                  <span class="text-[9px] px-1.5 rounded bg-slate-800 text-slate-300 font-bold flex-shrink-0">${KINDS[t.kind]}</span>
                  <h5 class="text-xs font-bold truncate ${t.done ? 'line-through text-slate-500' : 'text-white'}">${t.title}</h5>
                </div>
                ${t.note ? html`<p class="text-[10px] truncate ${t.done ? 'text-slate-600' : 'text-slate-400'}">${t.note}</p>` : ''}
                ${photoThumbsHtml(store, 'todo', t.id, { size: 'w-10 h-10' })}
              </div>
              <button data-action="edit" data-id="${t.id}" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-400 text-[10px] flex-shrink-0" title="수정 · 사진"><i class="fa-solid fa-pen"></i></button>
              <button data-action="delete" data-id="${t.id}" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-500 hover:text-rose-400 text-xs flex-shrink-0"><i class="fa-solid fa-xmark"></i></button>
            </div>`) : emptyCard('항목이 없습니다.')}
        </div>
      </div>`);
    hydratePhotos(root, store);
  }

  const off = delegate(root, {
    filter: (el) => { filter = el.dataset.k; update(); },
    toggle: (el, e) => {
      if (e.target.closest('[data-action="delete"]')) return;
      const t = store.get('todos', el.dataset.id);
      if (t) store.update('todos', t.id, { done: !t.done });
    },
    delete: (el, e) => {
      e.stopPropagation();
      store.remove('todos', el.dataset.id);
      toast('삭제했습니다.');
    },
    edit: (el, e) => { e.stopPropagation(); openTodoEditor(store, el.dataset.id, filter); },
    photo: (el, e) => { e.stopPropagation(); openPhotoViewer(store, el.dataset.img); },
    add: () => openTodoEditor(store, null, filter),
  });

  update();
  return { update, destroy: off };
}

// 추가 · 수정 (사진도 여기서). 새 항목도 저장 전에 사진을 붙일 수 있게 id 를 미리 정함
function openTodoEditor(store, id, filter) {
  const t = id ? store.get('todos', id) : { kind: KINDS[filter] ? filter : 'todo' };
  if (!t) return;
  const newId = id || crypto.randomUUID();
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '항목 수정' : '새 항목'}</h3>
    <form id="todo-form" class="space-y-2.5">
      <div><label class="label">분류</label><select name="kind" class="input">
        ${Object.entries(KINDS).map(([k, v]) => html`<option value="${k}" ${k === t.kind ? 'selected' : ''}>${v}</option>`)}</select></div>
      <div><label class="label">항목 *</label><input name="title" class="input" required maxlength="100" value="${t.title || ''}"></div>
      <div><label class="label">메모</label><input name="note" class="input" maxlength="300" value="${t.note || ''}"></div>
      <div data-photos></div>
      <button class="btn-primary">${id ? '수정 저장' : '추가'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const offPhotos = mountPhotoEditor($('[data-photos]', el), store, 'todo', newId);
    const off = delegate(el, {
      delete: () => {
        if (!confirmAction('이 항목을 삭제할까요?')) return;
        store.remove('todos', id); closeSheet(); toast('삭제했습니다.');
      },
    });
    $('#todo-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      if (id) store.update('todos', id, v);
      else store.insert('todos', { ...v, id: newId, done: false, sort_order: store.nextSortOrder('todos') });
      closeSheet();
    });
    return () => { off(); offPhotos(); };
  });
}
