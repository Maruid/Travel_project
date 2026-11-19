import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction, copyText } from '../../components/ui.js';
import { money, todayIn, shortTime, rateText, approxMoney, dayLabel } from '../../lib/format.js';
import { EXPENSE_CATS, CAT_ICON, CAT_COLOR, EMPTY_EXPENSE_FILTER, parseExpenseFilter, expenseFilterCount, filterExpenses, groupExpenses, sampleExpenses } from '../../lib/expense-view.js';
import { attachSlideSheet } from '../../components/slide-sheet.js';
import { sheetMaxOff } from '../../lib/sheet-scroll.js';
import { getPrefStr, setPrefStr } from '../../lib/prefs.js';
import { balances, settleTransfers } from '../../lib/settle.js';
import { color } from '../../lib/safe.js';
import { currencyOptions, unitOf, CURRENCY_MONEY } from '../../lib/currency.js';
const unitText = (c) => unitOf(c) ?? c;
import { fetchRate } from '../../lib/fx.js';

// short: 좁은 칸(지출 입력)에서는 "엔 (JPY)" 처럼 짧게 → 나라 이름 때문에 잘리지 않게
const curOpts = (selected, extra, fallback, { short = false } = {}) => currencyOptions(selected, extra, fallback)
  .map((o) => html`<option value="${o.code}" ${o.selected ? 'selected' : ''}>${short ? o.short : o.label}</option>`);

const METHOD_TEXT = { cash: '현금', card: '카드', other: '기타' };

// 금액을 현지통화 기준으로 환산 (다른 통화로 쓴 지출은 home 통화를 거쳐 환산)
function toLocal(store, amount, currency) {
  const b = store.budget || {};
  if (!currency || currency === b.local_currency) return Number(amount) || 0;
  if (currency === b.home_currency && Number(b.rate) > 0) return (Number(amount) || 0) / Number(b.rate);
  return Number(amount) || 0;   // 그 외 통화는 환산하지 않음
}

// 단톡방에 붙여넣을 정산 글
function settleText(store) {
  const b = store.budget || {};
  const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 1;
  const expenses = store.list('expenses');
  const members = store.activeMembers();
  const bal = balances(expenses, members.map((m) => m.id), (e) => toLocal(store, e.amount, e.currency));
  const lines = settleTransfers(bal, L).map((t) => `${store.member(t.from)?.display_name} → ${store.member(t.to)?.display_name}: ${money(t.amount, L)}${H !== L ? ` (${approxMoney(t.amount * rate, H)})` : ''}`);
  return [`[${store.trip?.title || '여행'} 정산]`, ...lines].join('\n');
}

// 화면: 위에 요약 판(남은 잔액 · 지출 합계 · 예산), 그 위로 손가락을 따라 올라오는 목록 판
//   판이 다 올라오면 요약은 한 줄(남은 잔액 · 지출)만 보임. 판 안: [지출 내역 | 정산] · 정렬 · 필터 · 목록
const COMPACT_PX = 64;          // 판이 다 올라왔을 때 남는 요약 높이 (위 여백 + 한 줄)
const PREF_SORT = 'budget:sort';
const filterKey = (tripId) => `budget:filter:${tripId}`;
const SORTS = [['date', '날짜순'], ['amount', '금액순'], ['cat', '카테고리별']];
const SAMPLE_MATE = { id: 'sample-mate', display_name: '동행', color: '#f472b6' };

export function mount(root, store) {
  const state = {
    view: 'list',                                    // list | settle
    sort: SORTS.some(([k]) => k === getPrefStr(PREF_SORT)) ? getPrefStr(PREF_SORT) : 'date',
    filter: parseExpenseFilter(getPrefStr(filterKey(store.tripId))),
    preview: false,                                  // 지출이 없을 때 [예시로 보기]
  };

  // ---------- 높이 고정 + 겹쳐 놓기 (장소 탭과 같은 방식) ----------
  const prevStyle = { height: root.style.height, paddingBottom: root.style.paddingBottom, flex: root.style.flex, position: root.style.position, overflow: root.style.overflow };
  const fitHeight = () => {
    const headerH = document.querySelector('header')?.offsetHeight || 44;
    const navH = document.querySelector('nav')?.offsetHeight || 56;
    root.style.height = `calc(100dvh - ${headerH}px - ${navH}px)`;
    root.style.paddingBottom = '0';
    root.style.flex = 'none';
    root.style.position = 'relative';
    root.style.overflow = 'hidden';
  };
  fitHeight();

  setHTML(root, html`
    <div id="bd-top" class="absolute inset-x-0 top-0 z-0 px-3 pt-3"></div>
    <div id="bd-sheet" class="absolute inset-x-0 z-10 flex flex-col bg-night-950 rounded-t-2xl border-t border-white/10 shadow-[0_-8px_24px_rgba(0,0,0,0.45)] will-change-transform">
      <div id="bd-grip" class="h-5 flex-shrink-0 flex items-center justify-center cursor-pointer"><span class="w-10 h-1 rounded-full bg-slate-600"></span></div>
      <div id="bd-head" class="flex-shrink-0 px-3"></div>
      <div id="bd-scroll" class="relative flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar px-3 pt-1 pb-4"></div>
    </div>`);
  const top = $('#bd-top', root);
  const sheetEl = $('#bd-sheet', root);
  const scroller = $('#bd-scroll', root);
  const rootH = () => root.clientHeight || 1;
  const topH = () => Math.max(COMPACT_PX, top.offsetHeight);
  const headH = () => $('#bd-grip', root).offsetHeight + $('#bd-head', root).offsetHeight;
  const slide = attachSlideSheet({
    sheet: sheetEl, scroller,
    maxOff: () => sheetMaxOff({ mapPx: topH(), compact: COMPACT_PX, rootH: rootH(), headerH: headH(), contentH: scroller.firstElementChild?.offsetHeight + 20 || 0 }),
    skip: (t) => !!t.closest('#bd-grip'),
  });
  function layout() {
    sheetEl.style.top = `${topH()}px`;
    sheetEl.style.height = `${rootH() - COMPACT_PX}px`;
    slide.setOff(slide.off());
  }
  const onGrip = () => slide.setOff(slide.off() > 0 ? 0 : 1e6, true);
  $('#bd-grip', root).addEventListener('click', onGrip);

  // ---------- 데이터 (예시 화면이면 저장하지 않는 예시) ----------
  function data() {
    const b = store.budget || { local_currency: 'KRW', home_currency: 'KRW', rate: 1, base_amount: 0 };
    let members = store.activeMembers();
    let expenses = store.list('expenses');
    if (state.preview) {
      if (members.length < 2) members = [...members, SAMPLE_MATE];
      expenses = sampleExpenses({ start: store.trip?.start_date, local: b.local_currency, memberIds: members.map((m) => m.id) });
    }
    const memberOf = (id) => store.member(id) || (id === SAMPLE_MATE.id ? SAMPLE_MATE : null);
    return { b, members, expenses, memberOf, topups: store.list('budget_topups') };
  }

  function drawTop(d) {
    const { b, expenses, topups } = d;
    const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 1;
    const homeOf = (v) => money(v * rate, H);
    const totalBudget = Number(b.base_amount || 0) + topups.reduce((s, t) => s + Number(t.amount), 0);
    const totalSpent = expenses.reduce((s, e) => s + toLocal(store, e.amount, e.currency), 0);
    const cash = expenses.filter((e) => e.method === 'cash').reduce((s, e) => s + toLocal(store, e.amount, e.currency), 0);
    const remain = totalBudget - totalSpent;
    setHTML(top, html`
      <div class="glass-card rounded-2xl">
        <div class="h-[52px] px-3 flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <span class="text-[10px] text-slate-400">남은 잔액</span>
            <div class="flex items-baseline gap-1.5 min-w-0">
              <b class="text-lg leading-tight font-black font-mono ${remain < 0 ? 'text-rose-400' : 'text-emerald-400'} whitespace-nowrap">${money(remain, L)}</b>
              ${H !== L ? html`<span class="text-[10px] font-mono text-slate-500 truncate">${homeOf(remain)}</span>` : ''}
            </div>
          </div>
          <div class="text-right flex-shrink-0">
            <span class="text-[10px] text-slate-400 block">지출</span>
            <b class="text-sm font-black font-mono text-rose-400 whitespace-nowrap">${money(totalSpent, L)}</b>
          </div>
          <button data-action="settings" title="예산 · 환율 관리" aria-label="예산 · 환율 관리" class="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-800 text-slate-300 border border-white/10 flex items-center justify-center"><i class="fa-solid fa-gear text-xs"></i></button>
        </div>
        <div class="px-3 pb-3 pt-1 border-t border-white/5 grid grid-cols-3 gap-2 text-[10px]">
          <div><span class="text-slate-500 block">총 예산</span><b class="font-mono text-white">${money(totalBudget, L)}</b>${H !== L ? html`<span class="block font-mono text-slate-500">${homeOf(totalBudget)}</span>` : ''}</div>
          <div><span class="text-slate-500 block">현금 지출</span><b class="font-mono text-amber-300">${money(cash, L)}</b></div>
          <div><span class="text-slate-500 block">카드 등</span><b class="font-mono text-sky-300">${money(totalSpent - cash, L)}</b></div>
          <p class="col-span-3 text-[9px] text-emerald-300/80 font-mono truncate">환율 ${rateText(b)}</p>
        </div>
      </div>`);
  }

  function shareText(e, d) {
    if (!e.split_with?.length || e.split_with.length >= d.members.length) return '모두';
    const names = e.split_with.map((id) => d.memberOf(id)?.display_name || '?');
    if (names.length === 1) return `개인 · ${names[0]}`;
    return names.length > 2 ? `${names.slice(0, 2).join('·')} 외 ${names.length - 2}` : names.join('·');
  }

  function drawHead(d) {
    const n = expenseFilterCount(state.filter);
    const tabBtn = (k, t) => html`<button data-action="bd-view" data-v="${k}" class="flex-1 py-1.5 rounded-lg text-[11px] font-bold ${state.view === k ? 'bg-slate-700 text-white' : 'text-slate-400'}">${t}</button>`;
    const chip = 'flex-shrink-0 h-7 px-2.5 rounded-full border text-[11px] flex items-center gap-1 whitespace-nowrap';
    const fchip = 'flex-shrink-0 h-6 px-2 rounded-full border border-white/10 bg-slate-800/80 text-slate-200 text-[10px] flex items-center gap-1 whitespace-nowrap';
    const f = state.filter;
    const fchips = [
      ...f.method.map((v) => [`method`, v, METHOD_TEXT[v] || v]),
      ...f.payer.map((v) => ['payer', v, `${d.memberOf(v)?.display_name || '?'} 결제`]),
      ...f.share.map((v) => ['share', v, `${d.memberOf(v)?.display_name || '?'} 몫`]),
      ...f.cat.map((v) => ['cat', v, v]),
    ];
    setHTML($('#bd-head', root), html`
      ${state.preview ? html`
        <div class="mb-2 px-2.5 py-1.5 rounded-xl bg-amber-500/10 border border-amber-400/40 text-[10px] text-amber-100 flex items-center gap-2">
          <i class="fa-solid fa-eye text-amber-300"></i><span class="flex-1">예시 화면이에요. 저장되지 않아요.</span>
          <button data-action="preview-off" class="font-bold text-amber-300">닫기</button>
        </div>` : ''}
      <div class="flex items-center gap-2 mb-2">
        <div class="flex-1 flex p-0.5 rounded-xl bg-slate-800/70 border border-white/5">
          ${tabBtn('list', `지출 내역 ${d.expenses.length ? d.expenses.length : ''}`)}${tabBtn('settle', '정산')}
        </div>
        <button data-action="add" class="flex-shrink-0 h-8 px-3 rounded-xl bg-neon-cyan text-night-950 font-black text-xs"><i class="fa-solid fa-plus"></i> 지출</button>
      </div>
      ${state.view === 'list' && d.expenses.length ? html`
        <div class="flex items-center gap-1.5 mb-2 overflow-x-auto no-scrollbar">
          <button data-action="bd-filter" class="${chip} ${n ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/50 font-bold' : 'bg-slate-800/80 text-slate-200 border-white/10'}"><i class="fa-solid fa-sliders text-[10px]"></i>필터${n ? ` ${n}` : ''}</button>
          ${SORTS.map(([k, t]) => html`<button data-action="bd-sort" data-k="${k}" class="${chip} ${state.sort === k ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/50 font-bold' : 'border-white/10 text-slate-400'}">${t}</button>`)}
        </div>
        ${fchips.length ? html`<div class="flex items-center gap-1 mb-2 overflow-x-auto no-scrollbar">
          ${fchips.map(([k, v, t]) => html`<button data-action="bd-filter-off" data-k="${k}" data-v="${v}" class="${fchip}">${t}<i class="fa-solid fa-xmark text-[9px] text-slate-400"></i></button>`)}
          <button data-action="bd-filter-clear" class="flex-shrink-0 text-[10px] text-slate-400 px-1.5">모두 지우기</button>
        </div>` : ''}` : ''}`);
  }

  function rowHtml(e, d, { showDate }) {
    const L = d.b.local_currency; const rate = Number(d.b.rate) || 1;
    const payer = d.memberOf(e.paid_by);
    const share = shareText(e, d);
    const personal = share.startsWith('개인');
    const cat = e.category || '기타';
    return html`
      <div data-action="edit" data-id="${e.id}" class="glass-card px-3 py-2.5 rounded-xl flex items-center gap-2.5 cursor-pointer ${personal ? 'border-l-2 border-l-pink-400/70' : ''}">
        <span class="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style="background:${color(CAT_COLOR[cat], '#94a3b8')}22">
          <i class="fa-solid ${CAT_ICON[cat] || 'fa-receipt'} text-[12px]" style="color:${color(CAT_COLOR[cat], '#94a3b8')}"></i></span>
        <div class="flex-1 min-w-0">
          <p class="text-[12px] font-bold text-white truncate">${e.place_name}</p>
          <p class="text-[10px] text-slate-400 truncate">
            <span class="font-mono">${showDate ? dayLabel(e.spent_date) : shortTime(e.spent_time) || ''}</span>
            · <span class="${e.method === 'cash' ? 'text-amber-300' : 'text-sky-300'}">${METHOD_TEXT[e.method] || ''}</span>
            ${payer ? html` · <span style="color:${color(payer.color, '#e2e8f0')}">${payer.display_name}</span>` : ''}
            · <span class="${personal ? 'text-pink-300' : ''}">${share}</span>
          </p>
        </div>
        <div class="text-right flex-shrink-0">
          <b class="text-[13px] font-black font-mono text-white block">${money(e.amount, e.currency)}</b>
          ${e.currency === L && d.b.home_currency !== L ? html`<span class="text-[9px] text-slate-500 font-mono">${money(Number(e.amount) * rate, d.b.home_currency)}</span>` : ''}
        </div>
      </div>`;
  }

  function listHtml(d) {
    if (!d.expenses.length) {
      return html`<div class="space-y-2 pt-2">
        ${emptyCard('등록된 지출이 없어요. [+ 지출]로 첫 지출을 적어 보세요.')}
        <button data-action="preview-on" class="btn-ghost w-full py-2.5 text-xs"><i class="fa-solid fa-eye mr-1"></i>예시로 화면 보기</button>
      </div>`;
    }
    const L = d.b.local_currency;
    const toL = (e) => toLocal(store, e.amount, e.currency);
    const rows = filterExpenses(d.expenses, state.filter, d.members.map((m) => m.id));
    const groups = groupExpenses(rows, state.sort, toL);
    const filtered = expenseFilterCount(state.filter) > 0;
    return html`<div class="space-y-1.5">
      ${filtered ? html`<p class="text-[11px] text-slate-300 px-1">걸린 지출 ${rows.length}건 · 합계 <b class="font-mono text-white">${money(rows.reduce((s, e) => s + toL(e), 0), L)}</b></p>` : ''}
      ${!rows.length ? emptyCard('조건에 맞는 지출이 없어요.') : groups.map((g) => html`
        ${g.key != null ? html`
          <div class="pt-2 pb-0.5 px-1 flex items-center gap-2">
            ${state.sort === 'cat'
              ? html`<i class="fa-solid ${CAT_ICON[g.key] || 'fa-receipt'} text-[11px]" style="color:${color(CAT_COLOR[g.key], '#94a3b8')}"></i>
                     <span class="text-[11px] font-bold text-slate-200">${g.key}</span>
                     <span class="flex-1 h-1 rounded-full bg-slate-800 overflow-hidden"><span class="block h-full" style="width:${(g.pct * 100).toFixed(1)}%;background:${color(CAT_COLOR[g.key], '#94a3b8')}"></span></span>
                     <span class="text-[10px] text-slate-500">${Math.round(g.pct * 100)}%</span>`
              : html`<span class="text-[11px] font-bold text-slate-200 flex-1">${dayLabel(g.key)}</span>`}
            <b class="text-[11px] font-mono text-slate-300">${money(g.total, L)}</b>
          </div>` : ''}
        ${g.rows.map((e) => rowHtml(e, d, { showDate: state.sort !== 'date' }))}`)}
    </div>`;
  }

  function settleHtml(d) {
    const { b, members, expenses } = d;
    const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 1;
    if (members.length < 2) return html`<div class="pt-2">${emptyCard('함께 가는 멤버가 있으면 누가 누구에게 얼마를 보내면 되는지 계산해 드려요.')}</div>`;
    const bal = balances(expenses, members.map((m) => m.id), (e) => toLocal(store, e.amount, e.currency));
    const byId = new Map(bal.map((x) => [x.id, x]));
    const transfers = settleTransfers(bal, L);
    const nm = (id) => d.memberOf(id)?.display_name || '(알 수 없음)';
    const cl = (id) => color(d.memberOf(id)?.color, '#e2e8f0');
    return html`<div class="space-y-2 pt-1">
      <div class="glass-card p-3 rounded-2xl space-y-2">
        <p class="text-[11px] font-bold text-slate-300">사람별 (균등 분담)</p>
        ${members.map((m) => {
          const x = byId.get(m.id) || { paid: 0, owed: 0, net: 0 };
          return html`<div class="p-2 rounded-xl bg-night-950/60 border border-white/5">
            <div class="flex items-center justify-between text-[11px]">
              <b style="color:${cl(m.id)}">${m.display_name}</b>
              <b class="font-mono ${x.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${x.net >= 0 ? '받을 돈' : '보낼 돈'} ${money(Math.abs(x.net), L)}</b>
            </div>
            <p class="text-[10px] text-slate-400 font-mono mt-0.5">낸 돈 ${money(x.paid, L)} · 쓴 몫 ${money(x.owed, L)}${H !== L ? ` (${approxMoney(x.owed * rate, H)})` : ''}</p>
          </div>`;
        })}
      </div>
      <div class="glass-card p-3 rounded-2xl">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] font-bold text-slate-300"><i class="fa-solid fa-right-left text-neon-cyan mr-1"></i>이렇게 보내면 끝나요</span>
          ${transfers.length && !state.preview ? html`<button data-action="copy-settle" class="text-[10px] text-neon-cyan">복사</button>` : ''}
        </div>
        ${transfers.length ? html`<div class="space-y-1">${transfers.map((t) => html`
          <div class="flex items-center gap-1.5 text-[11px] p-2 rounded-xl bg-night-950/60 border border-white/5">
            <span class="font-bold truncate" style="color:${cl(t.from)}">${nm(t.from)}</span>
            <i class="fa-solid fa-arrow-right text-[9px] text-slate-500 flex-shrink-0"></i>
            <span class="font-bold truncate" style="color:${cl(t.to)}">${nm(t.to)}</span>
            <span class="ml-auto text-right flex-shrink-0">
              <b class="font-mono text-white">${money(t.amount, L)}</b>
              ${H !== L ? html`<span class="block text-[9px] text-slate-400">${approxMoney(t.amount * rate, H)}</span>` : ''}
            </span>
          </div>`)}</div>`
          : html`<p class="text-[10px] text-emerald-300"><i class="fa-solid fa-check mr-1"></i>주고받을 돈이 없어요.</p>`}
        <p class="text-[9px] text-slate-500 mt-1.5">나눌 사람을 고르지 않은 지출은 지금 멤버 전원이 똑같이 나눠요. 다른 통화로 쓴 지출은 ${rateText(b)} 로 환산했어요.</p>
      </div>
    </div>`;
  }

  function update() {
    if (state.preview && store.list('expenses').length) state.preview = false;   // 진짜 지출이 생기면 예시 끝
    const d = data();
    drawTop(d);
    drawHead(d);
    setHTML(scroller, state.view === 'settle' ? settleHtml(d) : listHtml(d));
    layout();
  }
  const saveFilter = () => setPrefStr(filterKey(store.tripId), JSON.stringify(state.filter));
  const toTop = () => { scroller.scrollTop = 0; };

  const off = delegate(root, {
    add: () => { if (state.preview) { state.preview = false; update(); } openExpenseEditor(store, null); },
    edit: (el) => {
      if (state.preview) { toast('예시 지출이라 고칠 수 없어요. [+ 지출]로 직접 적어 보세요.'); return; }
      openExpenseEditor(store, el.dataset.id);
    },
    settings: () => openBudgetSettings(store),
    'copy-settle': () => copyText(settleText(store), '정산 목록'),
    'bd-view': (el) => { state.view = el.dataset.v; toTop(); update(); },
    'bd-sort': (el) => { state.sort = el.dataset.k; setPrefStr(PREF_SORT, state.sort); toTop(); update(); },
    'bd-filter': () => openExpenseFilter(state.filter, data(), (f) => { state.filter = f; saveFilter(); toTop(); update(); }),
    'bd-filter-off': (el) => {
      const k = el.dataset.k;
      state.filter = { ...state.filter, [k]: state.filter[k].filter((x) => x !== el.dataset.v) };
      saveFilter(); update();
    },
    'bd-filter-clear': () => { state.filter = { ...EMPTY_EXPENSE_FILTER }; saveFilter(); update(); },
    'preview-on': () => { state.preview = true; update(); },
    'preview-off': () => { state.preview = false; state.filter = { ...EMPTY_EXPENSE_FILTER }; slide.setOff(0, true); update(); },
  });
  const onResize = () => { fitHeight(); layout(); };
  window.addEventListener('resize', onResize);
  update();
  return {
    update,
    destroy: () => {
      off(); slide.destroy();
      window.removeEventListener('resize', onResize);
      $('#bd-grip', root)?.removeEventListener('click', onGrip);
      Object.assign(root.style, prevStyle);
    },
  };
}

// 필터: 결제 수단 · 낸 사람 · 누구 몫 · 카테고리 (누르면 바로 적용)
function openExpenseFilter(current, d, onChange) {
  let f = { ...current, method: [...current.method], payer: [...current.payer], share: [...current.share], cat: [...current.cat] };
  const on = 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/50 font-bold';
  const offc = 'bg-slate-800/80 text-slate-200 border-white/10';
  const usedCats = EXPENSE_CATS.filter((c) => d.expenses.some((e) => (e.category || '기타') === c));
  const draw = (el) => setHTML(el, html`
    <h3 class="text-base font-black text-white mb-3">지출 필터</h3>
    ${[
      ['method', '결제 수단', Object.entries(METHOD_TEXT).map(([k, t]) => [k, t])],
      ['payer', '낸 사람', d.members.map((m) => [m.id, m.display_name])],
      ['share', '누구 몫', d.members.map((m) => [m.id, m.display_name])],
      ['cat', '카테고리', usedCats.map((c) => [c, c])],
    ].map(([k, title, opts]) => html`
      <p class="text-[11px] font-bold text-slate-400 mb-1.5 mt-3 first:mt-0">${title}</p>
      <div class="flex flex-wrap gap-1.5">${opts.map(([v, t]) => html`
        <button data-fk="${k}" data-fv="${v}" class="h-8 px-3 rounded-full border text-[11px] ${f[k].includes(v) ? on : offc}">${t}</button>`)}</div>`)}
    <p class="text-[10px] text-slate-500 mt-3">"누구 몫"은 그 사람이 나눠 내는 지출이에요. 나눌 사람을 안 고른 지출은 모두의 몫이에요.</p>
    <button data-fclear class="btn-ghost w-full mt-3 py-2 text-xs">모두 지우기</button>`);
  openSheet(html`<div id="bd-filter-body"></div>`, (el) => {
    const body = $('#bd-filter-body', el);
    draw(body);
    const onClick = (e) => {
      const b = e.target.closest('[data-fk]');
      if (b) {
        const { fk, fv } = b.dataset;
        f = { ...f, [fk]: f[fk].includes(fv) ? f[fk].filter((x) => x !== fv) : [...f[fk], fv] };
      } else if (e.target.closest('[data-fclear]')) {
        f = { ...EMPTY_EXPENSE_FILTER };
      } else return;
      draw(body);
      onChange(f);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  });
}

function openExpenseEditor(store, id) {
  const b = store.budget || {};
  const now = new Date();
  const e = id ? store.get('expenses', id) : {
    spent_date: todayIn(store.trip.timezone),
    spent_time: now.toTimeString().slice(0, 5),
    currency: b.local_currency, method: 'card', category: '음식',
    paid_by: store.me?.id,
  };
  const members = store.activeMembers();
  const places = store.list('places');
  const split = new Set(e.split_with?.length ? e.split_with : members.map((m) => m.id));

  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '지출 수정' : '새 지출'}</h3>
    <form id="exp-form" class="space-y-2.5">
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">날짜</label><input type="date" name="spent_date" class="input" required value="${e.spent_date}"></div>
        <div><label class="label">시간</label><input type="time" name="spent_time" class="input" value="${shortTime(e.spent_time)}"></div>
      </div>
      <div><label class="label">사용처 *</label>
        <input name="place_name" class="input" required maxlength="100" list="place-names" value="${e.place_name || ''}">
        <datalist id="place-names">${places.map((p) => html`<option value="${p.name}">`)}</datalist></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">금액 *</label><input name="amount" type="number" min="0" step="any" class="input text-sm font-bold font-mono" required value="${e.amount ?? ''}"></div>
        <div><label class="label">통화</label><select name="currency" class="input">
          ${curOpts(e.currency, [b.local_currency, b.home_currency], b.local_currency, { short: true })}</select></div>
      </div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">항목</label><select name="category" class="input">
          ${EXPENSE_CATS.map((c) => html`<option ${c === e.category ? 'selected' : ''}>${c}</option>`)}</select></div>
        <div><label class="label">결제 수단</label><select name="method" class="input">
          ${Object.entries(METHOD_TEXT).map(([k, t]) => html`<option value="${k}" ${k === e.method ? 'selected' : ''}>${t}</option>`)}</select></div>
      </div>
      <div><label class="label">결제자</label><select name="paid_by" class="input">
        ${members.map((m) => html`<option value="${m.id}" ${m.id === e.paid_by ? 'selected' : ''}>${m.display_name}</option>`)}</select></div>
      ${members.length > 1 ? html`<div><label class="label">함께 나눌 사람</label>
        <div class="flex flex-wrap gap-2">${members.map((m) => html`
          <label class="flex items-center gap-1 text-xs text-slate-300 px-2 py-1 rounded-lg bg-slate-800">
            <input type="checkbox" name="split" value="${m.id}" ${split.has(m.id) ? 'checked' : ''} class="accent-cyan-400">${m.display_name}</label>`)}</div></div>` : ''}
      <div><label class="label">메모</label><input name="note" class="input" maxlength="200" value="${e.note || ''}"></div>
      <button class="btn-primary">${id ? '수정 저장' : '저장'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#exp-form', el);
    const off = delegate(el, {
      delete: () => {
        if (!confirmAction('이 지출을 삭제할까요?')) return;
        store.remove('expenses', id); closeSheet(); toast('삭제했습니다.');
      },
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = formValues(form);
      const chosen = [...form.querySelectorAll('input[name=split]:checked')].map((x) => x.value);
      const place = places.find((p) => p.name === v.place_name);
      const data = {
        spent_date: v.spent_date, spent_time: v.spent_time, place_name: v.place_name, place_id: place?.id || null,
        amount: Number(v.amount), currency: v.currency, category: v.category, method: v.method,
        paid_by: v.paid_by, note: v.note,
        split_with: chosen.length && chosen.length < members.length ? chosen : null,
      };
      if (!(data.amount > 0)) { toast('금액을 입력해 주세요.', 'error'); return; }
      if (id) store.update('expenses', id, data); else store.insert('expenses', data);
      closeSheet();
      toast(id ? '수정했습니다.' : '지출을 등록했습니다.');
    });
    return off;
  });
}

// 환율은 통화의 기준 단위로 보여주고 입력받음 ("100엔 = 870원"). 저장은 지금처럼 1단위 기준
//  표에 없는 통화는 1단위로 입력
const baseOf = (code) => CURRENCY_MONEY[code]?.base || 1;
function baseLabel(from, to) {
  return `${baseOf(from).toLocaleString('ko-KR')}${unitText(from)} = ?${unitText(to)}`;
}
export const rateInBase = (rate, code) => (Number(rate) > 0 ? Number((Number(rate) * baseOf(code)).toPrecision(6)) : '');
export const rateFromBase = (v, code) => (Number(v) > 0 ? Number(v) / baseOf(code) : 0);

function openBudgetSettings(store) {
  const b = store.budget || {};
  const topups = store.list('budget_topups');
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">예산 & 환율</h3>
    <form id="budget-form" class="glass-card p-3 rounded-2xl space-y-2.5 mb-3">
      <div class="grid grid-cols-2 gap-2">
        <div class="col-span-2"><label class="label">현지 통화</label><select name="local_currency" class="input">${curOpts(b.local_currency, [], 'JPY')}</select></div>
        <div class="col-span-2"><label class="label">내 통화</label><select name="home_currency" class="input">${curOpts(b.home_currency, [], 'KRW')}</select></div>
      </div>
      <div>
        <div class="flex items-center justify-between">
          <label class="label">환율 (<span id="rate-unit">${baseLabel(b.local_currency, b.home_currency)}</span>)</label>
          <button type="button" data-action="fetch-rate" class="text-[10px] text-neon-cyan font-bold"><i class="fa-solid fa-rotate mr-0.5"></i>최신 환율로</button>
        </div>
        <input name="rate" type="number" step="any" min="0" inputmode="decimal" class="input font-mono" value="${rateInBase(b.rate, b.local_currency)}">
        <p id="rate-note" class="text-[10px] text-slate-500 mt-1">환율은 바꿀 때만 적용돼요. 이미 적은 지출의 환산액도 새 환율로 다시 계산돼요.</p>
      </div>
      <div><label class="label">기본 환전금 (현지 통화)</label><input name="base_amount" type="number" step="any" min="0" class="input font-mono" value="${b.base_amount}"></div>
      <button class="btn-primary">저장</button>
    </form>
    <div class="glass-card p-3 rounded-2xl">
      <span class="text-xs font-bold text-slate-300 block mb-2">추가 환전 / 카드 충전</span>
      <div class="space-y-1.5 mb-2">
        ${topups.length ? topups.map((t) => html`
          <div class="flex items-center justify-between p-2 rounded-xl bg-night-950/60 text-xs">
            <div><span class="text-neon-cyan font-bold font-mono">+${money(t.amount, b.local_currency)}</span>
              <span class="text-[10px] text-slate-400 block">${t.note || ''} (${t.topup_date})</span></div>
            <button data-action="del-topup" data-id="${t.id}" class="text-rose-400 text-xs px-2">삭제</button>
          </div>`) : html`<p class="text-[11px] text-slate-500">내역이 없습니다.</p>`}
      </div>
      <form id="topup-form" class="grid grid-cols-[1fr_1fr_auto] gap-1.5">
        <input name="amount" type="number" step="any" min="0" class="input font-mono" placeholder="금액" required>
        <input name="note" class="input" maxlength="100" placeholder="메모">
        <button class="btn-ghost">추가</button>
      </form>
    </div>`, (el) => {
    // 환율 자동 채우기: 통화를 바꾸거나 [최신 환율로]를 누를 때만 (자동 갱신 없음)
    const form = $('#budget-form', el);
    let seq = 0;
    async function fillRate() {
      const from = form.elements.local_currency.value;
      const to = form.elements.home_currency.value;
      $('#rate-unit', el).textContent = baseLabel(from, to);
      const note = $('#rate-note', el);
      const my = ++seq;
      note.className = 'text-[10px] text-slate-400 mt-1';
      note.textContent = '환율 가져오는 중...';
      try {
        const r = await fetchRate(from, to);
        if (my !== seq) return;   // 그 사이 통화를 또 바꿨으면 무시
        form.elements.rate.value = rateInBase(r.rate, from);
        $('#rate-unit', el).textContent = baseLabel(from, to);
        note.className = 'text-[10px] text-emerald-300 mt-1';
        setHTML(note, r.source === 'same' ? html`같은 통화예요.`
          : html`자동 · ${r.date || '오늘'} 기준${r.attribution ? html` · <a href="${r.attribution}" target="_blank" rel="noopener" class="underline">Rates By Exchange Rate API</a>` : ''} (저장해야 적용돼요)`);
      } catch (err) {
        if (my !== seq) return;
        note.className = 'text-[10px] text-amber-300 mt-1';
        note.textContent = err.message;
      }
    }
    form.addEventListener('change', (e) => { if (e.target.name === 'local_currency' || e.target.name === 'home_currency') fillRate(); });
    form.elements.rate.addEventListener('input', () => {
      seq++;
      const note = $('#rate-note', el);
      note.className = 'text-[10px] text-slate-400 mt-1';
      note.textContent = '직접 입력 (저장해야 적용돼요)';
    });

    $('#budget-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      store.updateBudget({ local_currency: v.local_currency, home_currency: v.home_currency,
        rate: rateFromBase(Number(v.rate), v.local_currency) || 1, base_amount: Number(v.base_amount) || 0 });
      toast('저장했습니다.');
      closeSheet();
    });
    $('#topup-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      if (!(Number(v.amount) > 0)) return;
      store.insert('budget_topups', { amount: Number(v.amount), note: v.note, topup_date: todayIn(store.trip.timezone) });
      openBudgetSettings(store);
    });
    return delegate(el, {
      'fetch-rate': () => fillRate(),
      'del-topup': (b2) => { store.remove('budget_topups', b2.dataset.id); openBudgetSettings(store); },
    });
  });
}
