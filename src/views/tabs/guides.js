import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { renderMarkdown, GUIDE_TEMPLATES } from '../../lib/markdown.js';
import { dateRange, dayLabel } from '../../lib/format.js';
import { color, icon } from '../../lib/safe.js';

const COLORS = ['#00f2fe', '#f43f5e', '#f59e0b', '#10b981', '#38bdf8', '#c084fc', '#fbbf24', '#94a3b8'];

export function mount(root, store) {
  function update() {
    const guides = store.list('guides').sort((a, b) => (b.pinned - a.pinned) || (a.sort_order - b.sort_order));
    setHTML(root, html`
      <div class="p-4 space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="text-xs font-bold text-white"><i class="fa-solid fa-lightbulb text-neon-cyan mr-1"></i>가이드 카드</h2>
          <button data-action="add" class="px-3 py-1.5 rounded-xl bg-neon-cyan text-night-950 font-black text-xs"><i class="fa-solid fa-plus"></i> 카드 추가</button>
        </div>
        ${guides.length ? guides.map((g) => html`
          <article class="glass-card p-4 rounded-2xl border-l-4" style="border-left-color:${color(g.color)}">
            <div class="flex items-center justify-between mb-1.5 gap-2">
              <h3 class="text-xs font-bold flex items-center gap-1.5 min-w-0" style="color:${color(g.color)}">
                <i class="fa-solid ${icon(g.icon, 'fa-lightbulb')}"></i><span class="truncate">${g.title}</span>
              </h3>
              <div class="flex items-center gap-1 flex-shrink-0">
                ${g.pinned ? html`<i class="fa-solid fa-thumbtack text-[10px] text-amber-300"></i>` : ''}
                ${g.day_date ? html`<span class="text-[10px] font-mono text-slate-400">${dayLabel(g.day_date)}</span>` : ''}
                <button data-action="edit" data-id="${g.id}" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-400 text-[10px]"><i class="fa-solid fa-pen"></i></button>
              </div>
            </div>
            <div class="md">${renderMarkdown(g.body_md)}</div>
          </article>`) : emptyCard('가이드 카드가 없습니다. 날씨, 교통, 현지어 쇼잉 카드 등을 만들어 보세요.')}
      </div>`);
  }

  const off = delegate(root, {
    add: () => pickTemplate(store),
    edit: (el) => openGuideEditor(store, el.dataset.id),
  });
  update();
  return { update, destroy: off };
}

function pickTemplate(store) {
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">어떤 카드를 만들까요?</h3>
    <div class="grid grid-cols-2 gap-2">
      ${GUIDE_TEMPLATES.map((t) => html`
        <button data-action="tpl" data-key="${t.key}" class="glass-card p-3 rounded-2xl text-left">
          <i class="fa-solid ${t.icon}" style="color:${t.color}"></i>
          <span class="block text-xs font-bold text-white mt-1">${t.label}</span>
        </button>`)}
    </div>`, (el) => delegate(el, {
    tpl: (b) => openGuideEditor(store, null, GUIDE_TEMPLATES.find((t) => t.key === b.dataset.key)),
  }));
}

function openGuideEditor(store, id, tpl = null) {
  const g = id ? store.get('guides', id) : {
    title: tpl?.title || '', body_md: tpl?.body || '', color: tpl?.color || COLORS[0], icon: tpl?.icon || 'fa-lightbulb',
  };
  const days = dateRange(store.trip.start_date, store.trip.end_date);

  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '카드 수정' : '새 카드'}</h3>
    <form id="guide-form" class="space-y-2.5">
      <div><label class="label">제목 *</label><input name="title" class="input" required maxlength="80" value="${g.title}"></div>
      <div>
        <div class="flex items-center justify-between mb-1">
          <label class="label !mb-0">내용 (마크다운)</label>
          <button type="button" data-action="preview" class="text-[10px] text-neon-cyan">미리보기</button>
        </div>
        <textarea name="body_md" class="input font-mono" rows="9" maxlength="20000">${g.body_md}</textarea>
        <p class="text-[10px] text-slate-500 mt-1">**굵게**, - 목록, 1. 번호, --- 구분선. 코드블록(\`\`\`)으로 감싸면 "복사" 버튼이 붙은 쇼잉 카드가 됩니다.</p>
        <div id="md-preview" class="hidden md glass-card p-3 rounded-xl mt-2"></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">일정 탭에도 표시할 날짜</label>
          <select name="day_date" class="input"><option value="">표시 안 함</option>
            ${days.map((d) => html`<option value="${d}" ${d === g.day_date ? 'selected' : ''}>${dayLabel(d)}</option>`)}</select></div>
        <label class="flex items-end gap-2 text-xs text-slate-300 pb-2"><input type="checkbox" name="pinned" ${g.pinned ? 'checked' : ''} class="accent-cyan-400"> 상단 고정</label>
      </div>
      <div><label class="label">색상</label>
        <div class="flex gap-1.5">${COLORS.map((c) => html`
          <button type="button" data-action="color" data-color="${c}" class="w-7 h-7 rounded-full border-2 ${c === g.color ? 'border-white' : 'border-transparent'}" style="background:${c}"></button>`)}</div>
        <input type="hidden" name="color" value="${color(g.color)}"></div>
      <button class="btn-primary">${id ? '수정 저장' : '카드 추가'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#guide-form', el);
    const off = delegate(el, {
      preview: () => {
        const box = $('#md-preview', el);
        setHTML(box, renderMarkdown(form.elements.body_md.value));
        box.classList.toggle('hidden');
      },
      color: (b) => {
        form.elements.color.value = b.dataset.color;
        el.querySelectorAll('[data-action="color"]').forEach((x) => x.classList.toggle('border-white', x === b));
        el.querySelectorAll('[data-action="color"]').forEach((x) => x.classList.toggle('border-transparent', x !== b));
      },
      delete: () => {
        if (!confirmAction('이 카드를 삭제할까요?')) return;
        store.remove('guides', id); closeSheet(); toast('삭제했습니다.');
      },
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      const data = {
        title: v.title, body_md: form.elements.body_md.value, color: v.color, icon: icon(g.icon, 'fa-lightbulb'),
        day_date: v.day_date, pinned: !!form.elements.pinned.checked,
      };
      if (id) store.update('guides', id, data);
      else store.insert('guides', { ...data, sort_order: store.nextSortOrder('guides') });
      closeSheet();
    });
    return off;
  });
}
