import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard } from '../../components/ui.js';

const KINDS = { todo: '🎯 해야 할 것', place: '📍 가야 할 곳', shop: '🛍️ 사야 할 것' };

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
            <span class="text-xs font-bold text-slate-400">미션 & 위시리스트</span>
            <span class="text-xs font-mono font-bold text-neon-cyan">${done}/${all.length} (${pct}%)</span>
          </div>
          <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
            <div class="h-full bg-gradient-to-r from-neon-cyan to-neon-blue transition-all" style="width:${pct}%"></div>
          </div>
        </div>
        <div class="flex items-center justify-between gap-2">
          <div class="flex gap-1 overflow-x-auto no-scrollbar text-[11px]">
            ${[['all', '전체'], ...Object.entries(KINDS)].map(([k, t]) => html`
              <button data-action="filter" data-k="${k}" class="px-2.5 py-1 rounded-lg ${filter === k ? 'bg-neon-cyan text-night-950 font-bold' : 'glass-card text-slate-300'}">${t}</button>`)}
          </div>
          <button data-action="add" class="px-2.5 py-1 rounded-lg bg-neon-cyan text-night-950 font-bold text-xs flex-shrink-0">+ 추가</button>
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
              </div>
              <button data-action="delete" data-id="${t.id}" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-500 hover:text-rose-400 text-xs flex-shrink-0"><i class="fa-solid fa-xmark"></i></button>
            </div>`) : emptyCard('항목이 없습니다.')}
        </div>
      </div>`);
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
    add: () => openSheet(html`
      <h3 class="text-base font-black text-white mb-3">새 항목</h3>
      <form id="todo-form" class="space-y-2.5">
        <div><label class="label">분류</label><select name="kind" class="input">
          ${Object.entries(KINDS).map(([k, t]) => html`<option value="${k}" ${k === filter ? 'selected' : ''}>${t}</option>`)}</select></div>
        <div><label class="label">항목 *</label><input name="title" class="input" required maxlength="100"></div>
        <div><label class="label">메모</label><input name="note" class="input" maxlength="300"></div>
        <button class="btn-primary">추가</button>
      </form>`, (el) => {
      $('#todo-form', el).addEventListener('submit', (e) => {
        e.preventDefault();
        const v = formValues(e.target);
        store.insert('todos', { ...v, done: false, sort_order: store.nextSortOrder('todos') });
        closeSheet();
      });
    }),
  });

  update();
  return { update, destroy: off };
}
