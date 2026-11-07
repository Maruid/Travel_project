// 공용 "고르기" 창: 바텀시트 위에 한 겹 더 뜨는 창 (일정의 연결 장소, 기준점, 오늘 묵는 숙소 …)
//  - 위에 검색칸 + 카테고리 칩 (항목이 8개 이하면 숨김)
//  - top: 검색과 상관없이 늘 맨 위에 보이는 항목 (연결 안 함, 내 위치 등)
//  - sections: [{ label, items }]   item: { id, title, sub?, icon?, color?, badges?: [{text, cls}], catId?, place? }
//    place 가 있으면 이름 · 현지 이름 · 동네 · 대표 메뉴로 검색, 없으면 title 로
//  - 뒤로가기는 이 창만 닫음 (back-nav.js pickerOpened)
//  - 창이 열릴 때 키보드는 띄우지 않음 (검색칸을 누르면 그때)
import { html, setHTML, $ } from '../lib/dom.js';
import { color, icon } from '../lib/safe.js';
import { matchScore, normQuery } from '../lib/place-filter.js';
import { pickerOpened, pickerClosedByApp } from '../lib/back-nav.js';

const SEARCH_MIN = 8;
let current = null;   // { el, cleanup }

function hide() {
  if (!current) return;
  const { el, cleanup } = current;
  current = null;
  cleanup?.();
  el.classList.add('opacity-0');
  el.querySelector('[data-panel]')?.classList.add('translate-y-full');
  setTimeout(() => el.remove(), 200);
}
export function closePicker() {
  if (!current) return;
  pickerClosedByApp();
  hide();
}
window.addEventListener('app:route', () => { if (current) hide(); });

export function openPicker({ title, top = [], sections = [], categories = [], selected = null, onPick, emptyText = '맞는 항목이 없어요.' }) {
  if (current) hide();
  const all = sections.flatMap((s) => s.items);
  const searchable = all.length > SEARCH_MIN;
  // 칩에는 실제로 쓰인 카테고리만
  const usedCats = categories.filter((c) => all.some((it) => it.catId === c.id));
  let q = '';
  let cat = null;
  let timer = null;

  const el = document.createElement('div');
  el.className = 'fixed inset-0 z-[70] flex items-end justify-center bg-black/60 transition-opacity duration-200 opacity-0';
  el.innerHTML = `<div data-panel class="w-full max-w-md bg-night-950 border-t border-white/20 rounded-t-[28px] p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] max-h-[85vh] flex flex-col transition-transform duration-200 translate-y-full"></div>`;
  document.body.appendChild(el);
  const panel = el.querySelector('[data-panel]');

  setHTML(panel, html`
    <div class="flex items-center justify-between mb-2 flex-shrink-0">
      <h3 class="text-sm font-black text-white">${title}</h3>
      <button data-close class="w-8 h-8 rounded-lg text-slate-400" title="닫기"><i class="fa-solid fa-xmark"></i></button>
    </div>
    ${searchable ? html`
      <div class="relative mb-2 flex-shrink-0">
        <i class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-500"></i>
        <input data-q type="search" class="input pl-8" placeholder="이름 · 동네 · 대표 메뉴 검색" autocomplete="off" enterkeyhint="search">
      </div>
      ${usedCats.length > 1 ? html`<div data-cats class="flex gap-1.5 overflow-x-auto no-scrollbar pb-2 flex-shrink-0"></div>` : ''}` : ''}
    <div data-list class="overflow-y-auto no-scrollbar space-y-1 min-h-[30vh]"></div>`);

  const row = (it) => {
    const on = it.id === selected;
    return html`
      <button data-pick="${it.id}" class="w-full text-left px-3 py-2.5 rounded-xl flex items-center gap-2.5 border ${on ? 'bg-neon-cyan/10 border-neon-cyan/50' : 'bg-slate-800/60 border-white/5 active:bg-slate-700'}">
        <i class="fa-solid ${icon(it.icon)} text-xs w-4 text-center flex-shrink-0" style="color:${color(it.color, '#94a3b8')}"></i>
        <span class="flex-1 min-w-0">
          <span class="block text-xs font-bold text-white truncate">${it.title}</span>
          ${it.sub ? html`<span class="block text-[10px] text-slate-400 truncate">${it.sub}</span>` : ''}
        </span>
        ${(it.badges || []).map((b) => html`<span class="flex-shrink-0 text-[9px] px-1.5 py-0.5 rounded ${b.cls || 'bg-slate-700 text-slate-300'}">${b.text}</span>`)}
        ${on ? html`<i class="fa-solid fa-check text-neon-cyan text-xs flex-shrink-0"></i>` : ''}
      </button>`;
  };

  function matches(it) {
    if (cat && it.catId !== cat) return false;
    if (!normQuery(q)) return true;
    return it.place ? matchScore(it.place, q) > 0 : normQuery(it.title).includes(normQuery(q));
  }

  function drawCats() {
    const box = panel.querySelector('[data-cats]');
    if (!box) return;
    const chip = (on) => `flex-shrink-0 h-7 px-2.5 rounded-full border text-[10px] font-bold flex items-center gap-1 ${on ? 'bg-neon-cyan text-night-950 border-neon-cyan' : 'bg-slate-800 text-slate-300 border-white/10'}`;
    setHTML(box, html`
      <button data-cat="" class="${chip(!cat)}">전체</button>
      ${usedCats.map((c) => html`<button data-cat="${c.id}" class="${chip(cat === c.id)}"><i class="fa-solid ${icon(c.icon)} text-[9px]" style="color:${cat === c.id ? 'inherit' : color(c.color)}"></i>${c.name}</button>`)}`);
  }

  function drawList() {
    const filtering = !!normQuery(q) || !!cat;
    const secs = sections.map((s) => ({ ...s, items: s.items.filter(matches) })).filter((s) => s.items.length);
    // 검색 중에는 점수 높은 순으로 한 목록
    let body;
    if (normQuery(q)) {
      const hits = secs.flatMap((s) => s.items)
        .map((it) => ({ it, s: it.place ? matchScore(it.place, q) : 1 }))
        .sort((a, b) => b.s - a.s).map((x) => x.it);
      body = hits.length ? html`${hits.map(row)}` : html`<p class="text-center text-[11px] text-slate-500 py-6">${emptyText}</p>`;
    } else {
      body = secs.length ? html`${secs.map((s) => html`
        ${s.label ? html`<p class="text-[10px] font-bold text-slate-500 pt-2 pb-0.5 px-1">${s.label}</p>` : ''}
        ${s.items.map(row)}`)}` : html`<p class="text-center text-[11px] text-slate-500 py-6">${emptyText}</p>`;
    }
    setHTML(panel.querySelector('[data-list]'), html`${filtering ? '' : top.map(row)}${body}`);
  }

  drawCats();
  drawList();

  const onClick = (e) => {
    if (e.target === el || e.target.closest('[data-close]')) { closePicker(); return; }
    const c = e.target.closest('[data-cat]');
    if (c) { cat = c.dataset.cat || null; drawCats(); drawList(); return; }
    const b = e.target.closest('[data-pick]');
    if (b) {
      const id = b.dataset.pick;
      closePicker();
      onPick?.(id);
    }
  };
  const onInput = (e) => {
    if (!e.target.matches('[data-q]')) return;
    clearTimeout(timer);
    timer = setTimeout(() => { q = e.target.value; drawList(); }, 150);
  };
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);

  current = { el, cleanup: () => { clearTimeout(timer); el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); } };
  pickerOpened(hide);
  requestAnimationFrame(() => { el.classList.remove('opacity-0'); panel.classList.remove('translate-y-full'); });
}

// 장소 → 고르기 창 항목
export function placeItem(store, p, { sub = null, badges = [] } = {}) {
  const c = store.category(p.category_id);
  return {
    id: p.id, title: p.name, sub: sub ?? [c?.name, p.zone].filter(Boolean).join(' · '),
    icon: c?.icon || 'fa-location-dot', color: c?.color, catId: p.category_id, place: p, badges,
  };
}
