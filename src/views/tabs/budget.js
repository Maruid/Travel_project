import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction, copyText } from '../../components/ui.js';
import { money, todayIn, shortTime, rateText, approxMoney, dayLabel } from '../../lib/format.js';
import { EXPENSE_CATS, CAT_ICON, CAT_COLOR, EMPTY_EXPENSE_FILTER, parseExpenseFilter, expenseFilterCount, filterExpenses, groupExpenses } from '../../lib/expense-view.js';
import { attachSlideSheet } from '../../components/slide-sheet.js';
import { sheetMaxOff } from '../../lib/sheet-scroll.js';
import { getPrefStr, setPrefStr } from '../../lib/prefs.js';
import { settleTransfers, poolBalances, walletBalances, chargedRate } from '../../lib/settle.js';
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

// ---------- 돈 쓰는 방식 · 공금 지갑 (migration_018) ----------
//  personal: 각자 내고 정산 (기본 환전금 · 추가 환전은 예산 숫자) · pool_cash: 공금 현금 · pool_card: 공금 카드 + 현금
export const MONEY_MODES = [
  ['personal', '각자 내고 정산', '공금 없이 낸 사람만 기록해요'],
  ['pool_cash', '공금 현금', '같이 환전한 현금을 함께 써요'],
  ['pool_card', '공금 카드 + 현금', '트래블월렛 같은 충전식 카드를 함께 써요'],
];
const moneyMode = (store) => store.budget?.money_mode || 'personal';
const isPool = (store) => moneyMode(store) !== 'personal';
// 공금 먼저 → 개인, 그 안에서 카드 → 현금
const walletsOf = (store) => store.list('trip_wallets').sort((a, b) => (!!a.personal - !!b.personal)
  || (a.kind === b.kind ? 0 : a.kind === 'card' ? -1 : 1) || (a.sort_order ?? 0) - (b.sort_order ?? 0));
const WALLET_ICON = { card: 'fa-credit-card', cash: 'fa-money-bill-wave' };
const WALLET_COLOR = { card: '#38bdf8', cash: '#fbbf24' };
const kindOf = (t) => t.kind || 'budget';
// 정산에 넣을 기록: 공금 방식이면 충전 · 인출, 각자 방식이면 없음 (예산 숫자는 정산과 무관)
const settleTopups = (store, topups) => (isPool(store) ? topups.filter((t) => kindOf(t) !== 'budget') : []);
const settleWallets = (store, wallets) => (isPool(store) ? wallets : []);

// 단톡방에 붙여넣을 정산 글
function settleText(store) {
  const b = store.budget || {};
  const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 1;
  const expenses = store.list('expenses');
  const members = store.activeMembers();
  const bal = poolBalances({ expenses, topups: settleTopups(store, store.list('budget_topups')), wallets: settleWallets(store, walletsOf(store)),
    memberIds: members.map((m) => m.id), toAmount: (e) => toLocal(store, e.amount, e.currency) });
  const lines = settleTransfers(bal, L).map((t) => `${store.member(t.from)?.display_name} → ${store.member(t.to)?.display_name}: ${money(t.amount, L)}${H !== L ? ` (${approxMoney(t.amount * rate, H)})` : ''}`);
  return [`[${store.trip?.title || '여행'} 정산]`, ...lines].join('\n');
}

// 화면: 위에 요약 판(남은 잔액 · 지출 합계 · 예산), 그 위로 손가락을 따라 올라오는 목록 판
//   판이 다 올라오면 요약은 한 줄(남은 잔액 · 지출)만 보임. 판 안: [지출 내역 | 정산] · 정렬 · 필터 · 목록
const COMPACT_PX = 64;          // 판이 다 올라왔을 때 남는 요약 높이 (위 여백 + 한 줄)
const PREF_SORT = 'budget:sort';
const filterKey = (tripId) => `budget:filter:${tripId}`;
const SORTS = [['date', '날짜순'], ['amount', '금액순'], ['cat', '카테고리별']];

export function mount(root, store) {
  const state = {
    view: 'list',                                    // list(현지 지출) | prepaid(사전 결제) | settle
    sort: SORTS.some(([k]) => k === getPrefStr(PREF_SORT)) ? getPrefStr(PREF_SORT) : 'date',
    filter: parseExpenseFilter(getPrefStr(filterKey(store.tripId))),
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

  // ---------- 데이터 ----------
  //  all: 모든 지출 (정산) · expenses: 현지 지출 (목록 · 합계 · 지갑) · prepaid: 사전 결제 (항공 · 숙소)
  function data() {
    const b = store.budget || { local_currency: 'KRW', home_currency: 'KRW', rate: 1, base_amount: 0 };
    const members = store.activeMembers();
    const all = store.list('expenses');
    const expenses = all.filter((e) => !e.prepaid);
    const prepaid = all.filter((e) => e.prepaid);
    const memberOf = (id) => store.member(id);
    const wallets = walletsOf(store);
    const walletOf = (id) => wallets.find((w) => w.id === id) || store.get('trip_wallets', id) || null;
    return { b, members, all, expenses, prepaid, memberOf, wallets, walletOf, pool: isPool(store), topups: store.list('budget_topups') };
  }

  function drawTop(d) {
    if (d.pool) { drawPoolTop(d); return; }
    const { b, expenses } = d;
    const topups = d.topups.filter((t) => kindOf(t) === 'budget');
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
          ${prepaidLine(d, totalSpent, 'col-span-3')}
          <p class="col-span-3 text-[9px] text-emerald-300/80 font-mono truncate">환율 ${rateText(b)}</p>
        </div>
      </div>`);
  }

  // 공금 방식: 지갑마다 남은 돈 · 들고 있는 사람 · [충전] [인출]
  function drawPoolTop(d) {
    const { b, expenses, wallets } = d;
    const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 1;
    const toL = (e) => toLocal(store, e.amount, e.currency);
    const wb = walletBalances(wallets, d.topups, expenses, toL);
    const bal = (w) => wb.get(w.id) || 0;
    // 공금 지갑 + 내 개인 지갑만 (다른 사람 용돈은 위에 안 보임)
    const poolW = wallets.filter((w) => !w.personal);
    const myW = wallets.filter((w) => w.personal && w.holder && w.holder === store.me?.id);
    const poolLeft = poolW.reduce((s, w) => s + bal(w), 0);
    const myLeft = myW.reduce((s, w) => s + bal(w), 0);
    const totalSpent = expenses.reduce((s, e) => s + toL(e), 0);
    const real = chargedRate(d.topups);
    const hasCard = wallets.some((w) => w.kind === 'card') && wallets.some((w) => w.kind === 'cash');
    const walletRow = (w) => html`
      <div class="flex items-center gap-2 text-[11px] min-w-0">
        <i class="fa-solid ${WALLET_ICON[w.kind]} w-4 text-center flex-shrink-0" style="color:${WALLET_COLOR[w.kind]}"></i>
        <span class="flex-1 min-w-0 truncate text-slate-200">${w.name}${!w.personal && w.holder ? html` <span class="text-slate-500">· ${d.memberOf(w.holder)?.display_name || ''}</span>` : ''}</span>
        <b class="font-mono whitespace-nowrap ${bal(w) < 0 ? 'text-rose-400' : 'text-white'}">${money(bal(w), L)}</b>
        ${H !== L ? html`<span class="font-mono text-[10px] text-slate-500 w-[4.5rem] text-right truncate flex-shrink-0">${money(bal(w) * rate, H)}</span>` : ''}
      </div>`;
    setHTML(top, html`
      <div class="glass-card rounded-2xl">
        <!-- 목록을 올리면 남는 한 줄: 남은 공금 합계 (+ 내 지갑) · 지출 -->
        <div class="h-[52px] px-3 flex items-center gap-2">
          <div class="flex-1 min-w-0">
            <span class="text-[10px] text-slate-400">남은 공금${myW.length ? html` <span class="text-slate-500">· 내 지갑 <b class="font-mono text-sky-300">${money(myLeft, L)}</b></span>` : ''}</span>
            ${poolW.length ? html`<div class="flex items-baseline gap-1.5 min-w-0 whitespace-nowrap">
                <b class="text-lg leading-tight font-black font-mono ${poolLeft < 0 ? 'text-rose-400' : 'text-emerald-400'}">${money(poolLeft, L)}</b>
                ${H !== L ? html`<span class="text-[10px] font-mono text-slate-500 truncate">${money(poolLeft * rate, H)}</span>` : ''}
              </div>`
              : html`<p class="text-xs text-slate-500">설정에서 공금 지갑을 만들어 주세요</p>`}
          </div>
          <div class="text-right flex-shrink-0">
            <span class="text-[10px] text-slate-400 block">지출</span>
            <b class="text-sm font-black font-mono text-rose-400 whitespace-nowrap">${money(totalSpent, L)}</b>
          </div>
          <button data-action="settings" title="예산 · 환율 · 지갑" aria-label="예산 · 환율 · 지갑" class="flex-shrink-0 w-8 h-8 rounded-lg bg-slate-800 text-slate-300 border border-white/10 flex items-center justify-center"><i class="fa-solid fa-gear text-xs"></i></button>
        </div>
        <div class="px-3 pb-3 pt-1.5 border-t border-white/5 space-y-1.5">
          ${poolW.map(walletRow)}
          ${myW.length ? html`<p class="text-[10px] text-slate-500 pt-0.5">내 지갑 (정산과 무관)</p>${myW.map(walletRow)}` : ''}
          <div class="grid ${hasCard ? 'grid-cols-2' : 'grid-cols-1'} gap-1.5 pt-1">
            <button data-action="move-charge" class="h-8 rounded-lg bg-emerald-500/15 border border-emerald-400/40 text-emerald-200 text-[11px] font-bold"><i class="fa-solid fa-plus mr-1"></i>충전 · 환전</button>
            ${hasCard ? html`<button data-action="move-withdraw" class="h-8 rounded-lg bg-amber-500/15 border border-amber-400/40 text-amber-200 text-[11px] font-bold"><i class="fa-solid fa-money-bill-transfer mr-1"></i>현금 인출</button>` : ''}
          </div>
          ${prepaidLine(d, totalSpent, '')}
          <p class="text-[9px] text-emerald-300/80 font-mono truncate">환율 ${rateText(b)}${real ? ` · 충전 평균 ${money(real * (CURRENCY_MONEY[L]?.base || 1), H)}/${(CURRENCY_MONEY[L]?.base || 1).toLocaleString('ko-KR')}${unitText(L)}` : ''}</p>
        </div>
      </div>`);
  }

  // 사전 결제가 있으면: 사전 결제 + 현지 지출 = 여행 총비용 (내 통화)
  function prepaidLine(d, localSpent, cls) {
    if (!d.prepaid.length) return '';
    const H = d.b.home_currency; const rate = Number(d.b.rate) || 1;
    const pre = d.prepaid.reduce((s, e) => s + toLocal(store, e.amount, e.currency), 0) * rate;
    return html`<p class="${cls} text-[10px] text-slate-400">사전 결제 <b class="font-mono text-violet-300">${money(pre, H)}</b> · 여행 총비용 <b class="font-mono text-white">${money(pre + localSpent * rate, H)}</b></p>`;
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
      ...f.method.map((v) => ['method', v, sourceLabel(v, d)]),
      ...f.payer.map((v) => ['payer', v, `${d.memberOf(v)?.display_name || '?'} 결제`]),
      ...f.share.map((v) => ['share', v, `${d.memberOf(v)?.display_name || '?'} 몫`]),
      ...f.cat.map((v) => ['cat', v, v]),
    ];
    setHTML($('#bd-head', root), html`
      <div class="flex items-center gap-2 mb-2">
        <div class="flex-1 flex p-0.5 rounded-xl bg-slate-800/70 border border-white/5">
          ${tabBtn('list', `현지 지출${d.expenses.length ? ` ${d.expenses.length}` : ''}`)}${tabBtn('prepaid', `사전 결제${d.prepaid.length ? ` ${d.prepaid.length}` : ''}`)}${tabBtn('settle', '정산')}
        </div>
        ${state.view === 'settle' ? '' : html`<button data-action="${state.view === 'prepaid' ? 'add-prepaid' : 'add'}" class="flex-shrink-0 h-8 px-3 rounded-xl bg-neon-cyan text-night-950 font-black text-xs"><i class="fa-solid fa-plus"></i> ${state.view === 'prepaid' ? '추가' : '지출'}</button>`}
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
    if (e.move) return moveRowHtml(e, d);
    const L = d.b.local_currency; const rate = Number(d.b.rate) || 1;
    const wallet = e.wallet_id ? d.walletOf(e.wallet_id) : null;
    const payer = wallet ? null : d.memberOf(e.paid_by);
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
            ${wallet ? html` · <span style="color:${WALLET_COLOR[wallet.kind]}"><i class="fa-solid ${WALLET_ICON[wallet.kind]} text-[9px]"></i> ${wallet.name}</span>` : html`
            · <span class="${e.method === 'cash' ? 'text-amber-300' : 'text-sky-300'}">${d.pool ? '개인 ' : ''}${METHOD_TEXT[e.method] || ''}</span>
            ${payer ? html` · <span style="color:${color(payer.color, '#e2e8f0')}">${payer.display_name}</span>` : ''}`}
            · <span class="${personal ? 'text-pink-300' : ''}">${share}</span>
          </p>
        </div>
        <div class="text-right flex-shrink-0">
          <b class="text-[13px] font-black font-mono text-white block">${money(e.amount, e.currency)}</b>
          ${e.currency === L && d.b.home_currency !== L ? html`<span class="text-[9px] text-slate-500 font-mono">${money(Number(e.amount) * rate, d.b.home_currency)}</span>` : ''}
        </div>
      </div>`;
  }

  function moveRowHtml(t, d) {
    const L = d.b.local_currency;
    const to = d.walletOf(t.wallet_id); const from = d.walletOf(t.from_wallet);
    const label = t.kind === 'withdraw' ? `${from?.name || '?'} → ${to?.name || '?'} 인출` : `${to?.name || '공금'} 충전`;
    const who = t.kind === 'charge' && t.shares && Object.keys(t.shares).length
      ? Object.entries(t.shares).map(([id, v]) => `${d.memberOf(id)?.display_name || '?'} ${money(v, L)}`).join(' · ') : t.kind === 'charge' ? '모두 같은 금액' : '';
    return html`
      <div data-action="move-edit" data-id="${t.id}" class="px-3 py-2 rounded-xl border border-dashed border-white/10 flex items-center gap-2.5 cursor-pointer">
        <span class="w-8 h-6 flex items-center justify-center flex-shrink-0"><i class="fa-solid ${t.kind === 'withdraw' ? 'fa-money-bill-transfer text-amber-300/70' : 'fa-circle-plus text-emerald-300/70'} text-[12px]"></i></span>
        <div class="flex-1 min-w-0">
          <p class="text-[11px] text-slate-300 truncate">${label}</p>
          ${who || t.note ? html`<p class="text-[10px] text-slate-500 truncate">${[who, t.note].filter(Boolean).join(' · ')}</p>` : ''}
        </div>
        <span class="text-[12px] font-mono font-bold ${t.kind === 'withdraw' ? 'text-amber-200/80' : 'text-emerald-300/80'}">${t.kind === 'withdraw' ? '↔' : '+'}${money(t.amount, L)}</span>
      </div>`;
  }

  function listHtml(d) {
    if (!d.expenses.length) return html`<div class="pt-2">${emptyCard('등록된 지출이 없어요. [+ 지출]로 첫 지출을 적어 보세요.')}</div>`;
    const L = d.b.local_currency;
    const toL = (e) => toLocal(store, e.amount, e.currency);
    const rows = filterExpenses(d.expenses, state.filter, d.members.map((m) => m.id));
    const groups = groupExpenses(rows, state.sort, toL);
    // 날짜순 · 필터 없음: 충전 · 인출도 그날 끝에 회색 줄로 (합계에는 안 들어감)
    if (d.pool && state.sort === 'date' && !expenseFilterCount(state.filter)) {
      for (const t of d.topups.filter((x) => kindOf(x) !== 'budget')) {
        let g = groups.find((x) => x.key === t.topup_date);
        if (!g) { g = { key: t.topup_date, total: 0, pct: 0, rows: [] }; groups.push(g); }
        g.rows.push({ ...t, move: true });
      }
      groups.sort((a, b) => String(b.key).localeCompare(String(a.key)));
    }
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

  // 사전 결제: 항공 · 숙소처럼 여행 전에 낸 돈 (정산에는 포함, 현지 지출 · 지갑 잔액과는 따로)
  function prepaidHtml(d) {
    const H = d.b.home_currency; const rate = Number(d.b.rate) || 1;
    if (!d.prepaid.length) {
      return html`<div class="pt-2 space-y-2">
        ${emptyCard('항공권 · 숙소처럼 여행 전에 낸 돈을 적어 두면 정산과 여행 총비용에 같이 들어가요.')}
        <p class="text-[10px] text-slate-500 px-1">일정 탭의 이동편이나 숙소 장소 상세에서도 [결제 금액]으로 바로 넣을 수 있어요.</p>
      </div>`;
    }
    const rows = [...d.prepaid].sort((a, b) => String(b.spent_date).localeCompare(String(a.spent_date)));
    const total = rows.reduce((s, e) => s + toLocal(store, e.amount, e.currency), 0) * rate;
    return html`<div class="space-y-1.5">
      <p class="text-[11px] text-slate-300 px-1">${rows.length}건 · 합계 <b class="font-mono text-white">${money(total, H)}</b></p>
      ${rows.map((e) => rowHtml(e, d, { showDate: true }))}
    </div>`;
  }

  function settleHtml(d) {
    const { b, members } = d;
    const expenses = d.all;   // 사전 결제도 정산에 포함
    const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 1;
    if (members.length < 2) return html`<div class="pt-2">${emptyCard('함께 가는 멤버가 있으면 누가 누구에게 얼마를 보내면 되는지 계산해 드려요.')}</div>`;
    const bal = poolBalances({ expenses, topups: d.pool ? d.topups.filter((t) => kindOf(t) !== 'budget') : [], wallets: d.pool ? d.wallets : [],
      memberIds: members.map((m) => m.id), toAmount: (e) => toLocal(store, e.amount, e.currency) });
    const byId = new Map(bal.map((x) => [x.id, x]));
    const transfers = settleTransfers(bal, L);
    const nm = (id) => d.memberOf(id)?.display_name || '(알 수 없음)';
    const cl = (id) => color(d.memberOf(id)?.color, '#e2e8f0');
    return html`<div class="space-y-2 pt-1">
      <div class="glass-card p-3 rounded-2xl space-y-2">
        <p class="text-[11px] font-bold text-slate-300">사람별 (균등 분담${d.prepaid.length ? ' · 사전 결제 포함' : ''})</p>
        ${members.map((m) => {
          const x = byId.get(m.id) || { paid: 0, owed: 0, net: 0 };
          return html`<div class="p-2 rounded-xl bg-night-950/60 border border-white/5">
            <div class="flex items-center justify-between text-[11px]">
              <b style="color:${cl(m.id)}">${m.display_name}</b>
              <b class="font-mono ${x.net >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${x.net >= 0 ? '받을 돈' : '보낼 돈'} ${money(Math.abs(x.net), L)}</b>
            </div>
            <p class="text-[10px] text-slate-400 font-mono mt-0.5">${d.pool ? '넣은 돈 · 낸 돈' : '낸 돈'} ${money(x.paid, L)} · 쓴 몫 ${money(x.owed, L)}${H !== L ? ` (${approxMoney(x.owed * rate, H)})` : ''}${x.held ? ` · 들고 있는 공금 ${money(x.held, L)}` : ''}</p>
          </div>`;
        })}
      </div>
      <div class="glass-card p-3 rounded-2xl">
        <div class="flex items-center justify-between mb-1.5">
          <span class="text-[11px] font-bold text-slate-300"><i class="fa-solid fa-right-left text-neon-cyan mr-1"></i>이렇게 보내면 끝나요</span>
          ${transfers.length ? html`<button data-action="copy-settle" class="text-[10px] text-neon-cyan">복사</button>` : ''}
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
        <p class="text-[9px] text-slate-500 mt-1.5">${d.pool ? '공금에 넣은 돈과 개인 돈으로 낸 돈을 합쳐 계산하고, 남은 공금은 들고 있는 사람이 나눠 돌려주는 것으로 쳐요. ' : ''}나눌 사람을 고르지 않은 지출은 지금 멤버 전원이 똑같이 나눠요. 다른 통화로 쓴 지출은 ${rateText(b)} 로 환산했어요.</p>
      </div>
    </div>`;
  }

  function update() {
    const d = data();
    drawTop(d);
    drawHead(d);
    setHTML(scroller, state.view === 'settle' ? settleHtml(d) : state.view === 'prepaid' ? prepaidHtml(d) : listHtml(d));
    layout();
  }
  const saveFilter = () => setPrefStr(filterKey(store.tripId), JSON.stringify(state.filter));
  const toTop = () => { scroller.scrollTop = 0; };

  const off = delegate(root, {
    add: () => openExpenseEditor(store, null),
    'add-prepaid': () => openExpenseEditor(store, null, { prepaid: true }),
    edit: (el) => openExpenseEditor(store, el.dataset.id),
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
    'move-charge': () => openMoveEditor(store, 'charge'),
    'move-withdraw': () => openMoveEditor(store, 'withdraw'),
    'move-edit': (el) => { const t = store.get('budget_topups', el.dataset.id); if (t) openMoveEditor(store, t.kind, t.id); },
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

function sourceLabel(v, d) {
  if (v.startsWith('w:')) return d.walletOf(v.slice(2))?.name || '지갑';
  return `${d.pool ? '개인 ' : ''}${METHOD_TEXT[v] || v}`;
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
      ['method', d.pool ? '어디서 냈나' : '결제 수단', d.pool
        ? [...d.wallets.map((w) => [`w:${w.id}`, w.name]), ...Object.keys(METHOD_TEXT).map((k) => [k, sourceLabel(k, d)])]
        : Object.entries(METHOD_TEXT).map(([k, t]) => [k, t])],
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

// opts.prepaid: 사전 결제로 새로 (내 통화 · 개인 돈) · opts.prefill: 이동편 · 숙소에서 열 때 채울 값
export function openExpenseEditor(store, id, { prepaid = false, prefill = {} } = {}) {
  const b = store.budget || {};
  const now = new Date();
  const e = id ? store.get('expenses', id) : prepaid ? {
    spent_date: todayIn(store.trip.timezone), spent_time: null,
    currency: b.home_currency || b.local_currency, method: 'card', category: '교통',
    paid_by: store.me?.id, prepaid: true, ...prefill,
  } : {
    spent_date: todayIn(store.trip.timezone),
    spent_time: now.toTimeString().slice(0, 5),
    currency: b.local_currency, method: 'card', category: '음식',
    paid_by: store.me?.id,
  };
  if (!e) return;
  const ready = 'money_mode' in b;   // migration_018 (사전 결제 칸 포함)
  let isPrepaid = !!e.prepaid;
  const members = store.activeMembers();
  const places = store.list('places');
  const split = new Set(e.split_with?.length ? e.split_with : members.map((m) => m.id));
  // 공금 방식: 어디서 냈나 (공금 지갑 · 개인 돈). 새 지출은 마지막에 고른 곳
  const pool = isPool(store);
  const wallets = pool ? walletsOf(store) : [];
  const lastKey = `budget:lastSource:${store.tripId}`;
  let source = id ? (e.wallet_id || 'me') : (getPrefStr(lastKey) || (wallets[0]?.id ?? 'me'));
  if (source !== 'me' && !wallets.some((w) => w.id === source)) source = wallets[0]?.id ?? 'me';
  const srcBtn = (v, label, icon, clr) => html`<button type="button" data-src="${v}" class="h-8 px-2.5 rounded-lg border text-[11px] font-bold whitespace-nowrap flex items-center gap-1 ${source === v ? 'bg-neon-cyan/15 text-neon-cyan border-neon-cyan/50' : 'bg-slate-800 text-slate-300 border-white/10'}"><i class="fa-solid ${icon} text-[10px]" style="color:${clr}"></i>${label}</button>`;

  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? (isPrepaid ? '사전 결제 수정' : '지출 수정') : isPrepaid ? '사전 결제' : '새 지출'}</h3>
    <form id="exp-form" class="space-y-2.5">
      ${ready ? html`<label class="flex items-center gap-2 p-2 rounded-xl bg-violet-500/10 border border-violet-400/30 text-[11px] text-violet-100">
        <input type="checkbox" name="prepaid" ${isPrepaid ? 'checked' : ''} class="accent-violet-400">
        사전 결제 <span class="text-violet-300/70">(항공 · 숙소처럼 여행 전에 낸 돈)</span></label>` : ''}
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
      <div><label class="label">항목</label><select name="category" class="input">
        ${EXPENSE_CATS.map((c) => html`<option ${c === e.category ? 'selected' : ''}>${c}</option>`)}</select></div>
      ${pool ? html`<div id="exp-src-box" class="${isPrepaid ? 'hidden' : ''}"><label class="label">어디서 냈나</label>
        <div id="exp-src" class="flex flex-wrap gap-1.5">
          ${wallets.filter((w) => !w.personal).map((w) => srcBtn(w.id, w.name, WALLET_ICON[w.kind], WALLET_COLOR[w.kind]))}
          ${wallets.filter((w) => w.personal).map((w) => srcBtn(w.id, `${w.name}${w.holder && w.holder !== store.me?.id ? ` (${store.member(w.holder)?.display_name || ''})` : ''}`, 'fa-user-tag', WALLET_COLOR[w.kind]))}
          ${srcBtn('me', '개인 돈', 'fa-user', '#cbd5e1')}
        </div></div>` : ''}
      <div id="exp-personal" class="grid grid-cols-2 gap-2 ${pool && source !== 'me' && !isPrepaid ? 'hidden' : ''}">
        <div><label class="label">결제자</label><select name="paid_by" class="input">
          ${members.map((m) => html`<option value="${m.id}" ${m.id === e.paid_by ? 'selected' : ''}>${m.display_name}</option>`)}</select></div>
        <div><label class="label">결제 수단</label><select name="method" class="input">
          ${Object.entries(METHOD_TEXT).map(([k, t]) => html`<option value="${k}" ${k === e.method ? 'selected' : ''}>${t}</option>`)}</select></div>
      </div>
      ${members.length > 1 ? html`<div>
        <div class="flex items-center justify-between"><label class="label">누구 몫 (함께 나눌 사람)</label>
          <span class="flex gap-1">
            <button type="button" data-share="all" class="text-[10px] px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-white/10">모두</button>
            <button type="button" data-share="me" class="text-[10px] px-2 py-0.5 rounded-md bg-pink-500/15 text-pink-200 border border-pink-400/40">나만 (개인)</button>
          </span></div>
        <div class="flex flex-wrap gap-2">${members.map((m) => html`
          <label class="flex items-center gap-1 text-xs text-slate-300 px-2 py-1 rounded-lg bg-slate-800">
            <input type="checkbox" name="split" value="${m.id}" ${split.has(m.id) ? 'checked' : ''} class="accent-cyan-400">${m.display_name}</label>`)}</div></div>` : ''}
      <div><label class="label">메모</label><input name="note" class="input" maxlength="200" value="${e.note || ''}"></div>
      <button class="btn-primary">${id ? '수정 저장' : '저장'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#exp-form', el);
    // 사전 결제는 개인 돈으로만 (공금 지갑 고르기 숨김)
    const syncPrepaid = () => {
      isPrepaid = !!form.elements.prepaid?.checked;
      $('#exp-src-box', el)?.classList.toggle('hidden', isPrepaid);
      $('#exp-personal', el).classList.toggle('hidden', pool && !isPrepaid && source !== 'me');
    };
    form.elements.prepaid?.addEventListener('change', syncPrepaid);
    const onPick = (ev) => {
      const sb = ev.target.closest('[data-src]');
      if (sb) {
        source = sb.dataset.src;
        el.querySelectorAll('[data-src]').forEach((x) => {
          const on = x.dataset.src === source;
          x.classList.toggle('bg-neon-cyan/15', on); x.classList.toggle('text-neon-cyan', on); x.classList.toggle('border-neon-cyan/50', on);
          x.classList.toggle('bg-slate-800', !on); x.classList.toggle('text-slate-300', !on); x.classList.toggle('border-white/10', !on);
        });
        $('#exp-personal', el).classList.toggle('hidden', source !== 'me' && !isPrepaid);
        return;
      }
      const sh = ev.target.closest('[data-share]');
      if (sh) {
        // 나만: 개인 돈이면 결제자, 개인 지갑이면 주인, 공금이면 나
        const sw = wallets.find((w) => w.id === source);
        const meId = source === 'me' || !pool ? form.elements.paid_by.value : sw?.personal ? sw.holder || store.me?.id : store.me?.id;
        form.querySelectorAll('input[name=split]').forEach((x) => { x.checked = sh.dataset.share === 'all' || x.value === meId; });
      }
    };
    el.addEventListener('click', onPick);
    const offActions = delegate(el, {
      delete: () => {
        if (!confirmAction('이 지출을 삭제할까요?')) return;
        store.remove('expenses', id); closeSheet(); toast('삭제했습니다.');
      },
    });
    const off = () => { offActions(); el.removeEventListener('click', onPick); };
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = formValues(form);
      const chosen = [...form.querySelectorAll('input[name=split]:checked')].map((x) => x.value);
      const place = places.find((p) => p.name === v.place_name);
      const wallet = pool && source !== 'me' && !isPrepaid ? wallets.find((w) => w.id === source) : null;
      const data = {
        spent_date: v.spent_date, spent_time: v.spent_time, place_name: v.place_name, place_id: place?.id || null,
        amount: Number(v.amount), currency: v.currency, category: v.category,
        // 공금 지갑에서 낸 지출: 낸 사람 없음, 수단은 지갑 종류
        // 개인 지갑(용돈)은 주인이 낸 것
        method: wallet ? wallet.kind : v.method, paid_by: wallet ? (wallet.personal ? wallet.holder || null : null) : v.paid_by,
        ...(pool || e.wallet_id ? { wallet_id: wallet ? wallet.id : null } : {}),   // migration_018 전에는 칸이 없음
        note: v.note,
        split_with: chosen.length && chosen.length < members.length ? chosen : null,
        ...(ready ? { prepaid: isPrepaid, transport_id: isPrepaid ? e.transport_id || null : null } : {}),
      };
      if (pool && !id && !isPrepaid) setPrefStr(lastKey, source);
      if (!(data.amount > 0)) { toast('금액을 입력해 주세요.', 'error'); return; }
      if (id) store.update('expenses', id, data); else store.insert('expenses', data);
      closeSheet();
      toast(id ? '수정했습니다.' : isPrepaid ? '사전 결제를 적었어요.' : '지출을 등록했습니다.');
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
  const topups = store.list('budget_topups').filter((t) => kindOf(t) === 'budget');
  const mode = moneyMode(store);
  const ready = 'money_mode' in b;   // migration_018 적용 여부
  const pool = mode !== 'personal';
  const wallets = walletsOf(store);
  const nameOf = (id) => store.member(id)?.display_name || '정하지 않음';
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">예산 · 환율 · 공금</h3>
    <div class="glass-card p-3 rounded-2xl mb-3">
      <span class="label">돈 쓰는 방식</span>
      ${ready ? html`
        <div class="space-y-1.5">${MONEY_MODES.map(([k, t, desc]) => html`
          <button type="button" data-action="set-mode" data-mode="${k}" class="w-full p-2.5 rounded-xl border text-left flex items-center gap-2 ${mode === k ? 'bg-neon-cyan/10 border-neon-cyan/50' : 'bg-night-950/60 border-white/10'}">
            <i class="fa-solid ${mode === k ? 'fa-circle-dot text-neon-cyan' : 'fa-circle text-slate-600'} text-xs"></i>
            <span class="flex-1 min-w-0"><span class="block text-xs font-bold ${mode === k ? 'text-white' : 'text-slate-300'}">${t}</span>
              <span class="block text-[10px] text-slate-500">${desc}</span></span>
          </button>`)}</div>
        ${pool ? html`
          <div class="mt-3 space-y-1.5">
            <span class="label">공금 지갑</span>
            ${wallets.map((w) => html`
              <button type="button" data-action="wallet-edit" data-id="${w.id}" class="w-full p-2.5 rounded-xl bg-night-950/60 border border-white/10 flex items-center gap-2 text-left">
                <i class="fa-solid ${WALLET_ICON[w.kind]} w-4 text-center text-xs" style="color:${WALLET_COLOR[w.kind]}"></i>
                <span class="flex-1 min-w-0 text-xs text-white truncate">${w.name}</span>
                <span class="text-[10px] ${w.personal ? 'text-sky-300' : 'text-slate-400'}">${w.personal ? `개인 · ${nameOf(w.holder)}` : `들고 있는 사람 · ${nameOf(w.holder)}`}</span>
                <i class="fa-solid fa-pen text-[10px] text-slate-500"></i>
              </button>`)}
            <button type="button" data-action="wallet-add" class="btn-ghost w-full py-2 text-xs"><i class="fa-solid fa-plus mr-1"></i>지갑 추가</button>
            <p class="text-[10px] text-slate-500 leading-relaxed">카드 이름은 쓰는 카드로 바꿔 주세요 (트래블월렛 · 트래블로그 등). 들고 있는 사람이 남은 공금을 나눠 돌려주는 것으로 정산해요. 내 용돈 카드 · 현금은 [지갑 추가]에서 "개인"으로 만들면 잔액만 따로 보고 정산에는 내가 낸 돈으로 들어가요.</p>
          </div>` : ''}`
        : html`<p class="text-[11px] text-amber-200">공금 기능을 쓰려면 Supabase 에서 <b>migration_018_wallets.sql</b> 을 먼저 실행해 주세요.</p>`}
    </div>
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
      ${pool ? '' : html`<div><label class="label">기본 환전금 (현지 통화)</label><input name="base_amount" type="number" step="any" min="0" class="input font-mono" value="${b.base_amount}"></div>`}
      ${pool && chargedRate(store.list('budget_topups')) ? html`<button type="button" data-action="use-charged-rate" class="text-[10px] text-emerald-300 font-bold"><i class="fa-solid fa-equals mr-0.5"></i>충전 기록의 평균 환율로 맞추기</button>` : ''}
      <button class="btn-primary">저장</button>
    </form>
    ${pool ? '' : html`<div class="glass-card p-3 rounded-2xl">
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
    </div>`}`, (el) => {
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
        rate: rateFromBase(Number(v.rate), v.local_currency) || 1, ...(v.base_amount != null ? { base_amount: Number(v.base_amount) || 0 } : {}) });
      toast('저장했습니다.');
      closeSheet();
    });
    $('#topup-form', el)?.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      if (!(Number(v.amount) > 0)) return;
      store.insert('budget_topups', { amount: Number(v.amount), note: v.note, topup_date: todayIn(store.trip.timezone), ...(ready ? { kind: 'budget' } : {}) });
      openBudgetSettings(store);
    });
    return delegate(el, {
      'set-mode': (btn) => setMoneyMode(store, btn.dataset.mode),
      'wallet-add': () => openWalletEditor(store, null),
      'wallet-edit': (btn) => openWalletEditor(store, btn.dataset.id),
      'use-charged-rate': () => {
        const r = chargedRate(store.list('budget_topups'));
        if (!r) return;
        form.elements.rate.value = rateInBase(r, form.elements.local_currency.value);
        const note = $('#rate-note', el);
        note.className = 'text-[10px] text-emerald-300 mt-1';
        note.textContent = '충전 기록의 평균 환율이에요 (저장해야 적용돼요)';
      },
      'fetch-rate': () => fillRate(),
      'del-topup': (b2) => { store.remove('budget_topups', b2.dataset.id); openBudgetSettings(store); },
    });
  });
}

// ---------- 충전 · 환전 / 현금 인출 (공금 지갑) ----------
//  충전: 지갑에 현지 돈이 들어옴. 원화로 실제 빠져나간 돈을 적으면 평균 환율이 나옴.
//        누가 얼마: 기본은 모두 같은 금액, [직접]이면 사람마다 (합이 받은 금액과 같아야 함)
//  인출: 공금 카드 → 공금 현금. 수수료를 적으면 카드에서 나간 지출(모두 몫)로 같이 기록
function openMoveEditor(store, kind, id = null) {
  const b = store.budget || {};
  const L = b.local_currency;
  const t = id ? store.get('budget_topups', id) : { kind, topup_date: todayIn(store.trip.timezone) };
  if (!t) return;
  const wallets = walletsOf(store);
  const cards = wallets.filter((w) => w.kind === 'card');
  const cashes = wallets.filter((w) => w.kind === 'cash');
  const members = store.activeMembers();
  const charge = kind === 'charge';
  let custom = !!(t.shares && Object.keys(t.shares).length);
  const wOpt = (list, sel) => list.map((w) => html`<option value="${w.id}" ${w.id === sel ? 'selected' : ''}>${w.name}${w.personal ? ' (개인)' : ''}</option>`);
  if (charge && !wallets.length) { toast('설정에서 공금 지갑을 먼저 만들어 주세요.', 'error'); return; }
  if (!charge && (!cards.length || !cashes.length)) { toast('공금 카드와 공금 현금 지갑이 있어야 인출을 기록할 수 있어요.', 'error'); return; }

  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">${charge ? '충전 · 환전' : '현금 인출'}${id ? ' 수정' : ''}</h3>
    <p class="text-[11px] text-slate-400 mb-3">${charge ? '공금 지갑에 들어온 돈이에요. 지출이 아니라 합계에는 안 들어가요.' : '공금 카드에서 뽑아 공금 현금으로 옮긴 돈이에요.'}</p>
    <form id="move-form" class="space-y-2.5">
      ${charge ? html`
        <div><label class="label">어느 지갑</label><select name="wallet_id" class="input">${wOpt(wallets, t.wallet_id || wallets[0]?.id)}</select></div>` : html`
        <div class="grid grid-cols-2 gap-2">
          <div><label class="label">빼는 곳</label><select name="from_wallet" class="input">${wOpt(cards, t.from_wallet || cards[0]?.id)}</select></div>
          <div><label class="label">넣는 곳</label><select name="wallet_id" class="input">${wOpt(cashes, t.wallet_id || cashes[0]?.id)}</select></div>
        </div>`}
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">${charge ? '받은 금액' : '뽑은 금액'} (${unitText(L)}) *</label><input name="amount" type="number" min="0" step="any" class="input font-mono font-bold" required value="${t.amount ?? ''}"></div>
        ${charge ? html`<div><label class="label">빠져나간 ${unitText(b.home_currency)} (선택)</label><input name="home_amount" type="number" min="0" step="any" class="input font-mono" value="${t.home_amount ?? ''}" placeholder="실제 환율 계산"></div>`
          : html`<div><label class="label">수수료 (${unitText(L)}, 선택)</label><input name="fee" type="number" min="0" step="any" class="input font-mono" placeholder="ATM 수수료"></div>`}
      </div>
      <div><label class="label">날짜</label><input type="date" name="topup_date" class="input" value="${t.topup_date}"></div>
      ${charge && members.length > 1 ? html`
        <div id="share-box">
          <div class="flex items-center justify-between"><label class="label">누가 얼마 넣었나</label>
            <span class="flex p-0.5 rounded-lg bg-slate-800 text-[10px] font-bold">
              <button type="button" data-mode="equal" class="px-2 py-0.5 rounded-md">모두 같게</button>
              <button type="button" data-mode="custom" class="px-2 py-0.5 rounded-md">직접</button>
            </span></div>
          <div id="share-rows" class="space-y-1.5"></div>
          <p id="share-sum" class="text-[10px] mt-1"></p>
        </div>` : ''}
      <div><label class="label">메모</label><input name="note" class="input" maxlength="100" value="${t.note || ''}"></div>
      <button class="btn-primary">${id ? '수정 저장' : '저장'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#move-form', el);
    const shares = new Map(members.map((m) => [m.id, Number(t.shares?.[m.id]) || 0]));
    function drawShares() {
      const box = $('#share-rows', el);
      if (!box) return;
      el.querySelectorAll('[data-mode]').forEach((x) => {
        const on = (x.dataset.mode === 'custom') === custom;
        x.className = `px-2 py-0.5 rounded-md ${on ? 'bg-neon-cyan text-night-950' : 'text-slate-400'}`;
      });
      const amount = Number(form.elements.amount.value) || 0;
      if (!custom) {
        setHTML(box, html`<p class="text-[11px] text-slate-400">${members.length}명이 ${money(amount / members.length, L)}씩</p>`);
        setHTML($('#share-sum', el), html``);
        return;
      }
      setHTML(box, html`${members.map((m) => html`
        <div class="flex items-center gap-2">
          <span class="w-16 text-[11px] truncate" style="color:${color(m.color, '#e2e8f0')}">${m.display_name}</span>
          <input data-share-id="${m.id}" type="number" min="0" step="any" class="input font-mono py-1.5" value="${shares.get(m.id) || ''}">
        </div>`)}`);
      sumNote();
    }
    function sumNote() {
      const amount = Number(form.elements.amount.value) || 0;
      const sum = [...shares.values()].reduce((a, v) => a + v, 0);
      const ok = Math.abs(sum - amount) < 1;
      const n = $('#share-sum', el);
      n.className = `text-[10px] mt-1 ${ok ? 'text-emerald-300' : 'text-amber-300'}`;
      n.textContent = ok ? '받은 금액과 합이 맞아요.' : `합 ${money(sum, L)} · 받은 금액과 ${money(amount - sum, L)} 차이`;
    }
    const onClick = (ev) => {
      const m = ev.target.closest('[data-mode]');
      if (!m) return;
      custom = m.dataset.mode === 'custom';
      if (custom && ![...shares.values()].some((v) => v > 0)) {
        const amount = Number(form.elements.amount.value) || 0;
        members.forEach((x) => shares.set(x.id, Math.round(amount / members.length)));
      }
      drawShares();
    };
    const onInput = (ev) => {
      if (ev.target.dataset.shareId) { shares.set(ev.target.dataset.shareId, Number(ev.target.value) || 0); sumNote(); }
      else if (ev.target.name === 'amount') { if (custom) sumNote(); else drawShares(); }
    };
    // 개인 지갑 충전은 주인 돈 → 누가 얼마 숨김
    const syncPersonal = () => {
      const w = wallets.find((x) => x.id === form.elements.wallet_id?.value);
      $('#share-box', el)?.classList.toggle('hidden', !!w?.personal);
    };
    form.elements.wallet_id?.addEventListener('change', syncPersonal);
    el.addEventListener('click', onClick);
    el.addEventListener('input', onInput);
    drawShares();
    syncPersonal();
    const offActions = delegate(el, {
      delete: () => {
        if (!confirmAction(`이 ${charge ? '충전' : '인출'} 기록을 삭제할까요?`)) return;
        store.remove('budget_topups', id); closeSheet(); toast('삭제했습니다.');
      },
    });
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = formValues(form);
      const amount = Number(v.amount);
      if (!(amount > 0)) { toast('금액을 입력해 주세요.', 'error'); return; }
      const data = {
        kind, amount, topup_date: v.topup_date || todayIn(store.trip.timezone), note: v.note || null,
        wallet_id: v.wallet_id || null, from_wallet: charge ? null : v.from_wallet || null,
        home_amount: charge && Number(v.home_amount) > 0 ? Number(v.home_amount) : null,
        shares: null,
      };
      const toW = wallets.find((x) => x.id === data.wallet_id);
      const fromW = wallets.find((x) => x.id === data.from_wallet);
      if (!charge && (!!toW?.personal !== !!fromW?.personal || (toW?.personal && toW.holder !== fromW.holder))) {
        toast('공금은 공금끼리, 개인 지갑은 같은 사람 지갑끼리만 옮길 수 있어요.', 'error'); return;
      }
      if (charge && custom && members.length > 1 && !toW?.personal) {
        const sum = [...shares.values()].reduce((a, x) => a + x, 0);
        if (Math.abs(sum - amount) >= 1) { toast('사람별 금액의 합이 받은 금액과 같아야 해요.', 'error'); return; }
        data.shares = Object.fromEntries([...shares].filter(([, x]) => x > 0));
      }
      if (id) store.update('budget_topups', id, data); else store.insert('budget_topups', data);
      const fee = Number(v.fee);
      if (!charge && !id && fee > 0) {
        store.insert('expenses', {
          spent_date: data.topup_date, spent_time: null, place_name: 'ATM 인출 수수료', place_id: null,
          amount: fee, currency: L, category: '기타', method: 'card', wallet_id: data.from_wallet, note: null,
          // 개인 지갑에서 뽑았으면 주인 몫
          paid_by: fromW?.personal ? fromW.holder || null : null, split_with: fromW?.personal && fromW.holder ? [fromW.holder] : null,
        });
      }
      closeSheet();
      toast(id ? '수정했습니다.' : charge ? '충전을 기록했어요.' : `인출을 기록했어요${fee > 0 ? ' (수수료는 지출로)' : ''}.`);
    });
    return () => { offActions(); el.removeEventListener('click', onClick); el.removeEventListener('input', onInput); };
  });
}

// 돈 쓰는 방식 바꾸기. 공금으로 바꾸면 기본 지갑을 만들어 둠 (이름 · 들고 있는 사람은 바꿀 수 있음)
function setMoneyMode(store, mode) {
  const cur = moneyMode(store);
  if (mode === cur) return;
  if (mode === 'personal') {
    const used = store.list('expenses').some((e) => e.wallet_id) || store.list('budget_topups').some((t) => kindOf(t) !== 'budget');
    if (used) { toast('공금 지출 · 충전 기록이 있어서 바꿀 수 없어요. 기록을 지운 뒤 바꿔 주세요.', 'error'); return; }
  }
  const wallets = walletsOf(store);
  const me = store.me?.id || null;
  const ensure = (kind, name) => {
    if (!wallets.some((w) => w.kind === kind)) store.insert('trip_wallets', { kind, name, holder: me, sort_order: kind === 'card' ? 0 : 10 });
  };
  if (mode === 'pool_cash' || mode === 'pool_card') ensure('cash', '공금 현금');
  if (mode === 'pool_card') ensure('card', '공금 카드');
  store.updateBudget({ money_mode: mode });
  toast(mode === 'personal' ? '각자 내고 정산하는 방식으로 바꿨어요.' : '공금 지갑을 만들었어요. 이름과 들고 있는 사람을 확인해 주세요.');
  openBudgetSettings(store);
}

function openWalletEditor(store, id) {
  const w = id ? store.get('trip_wallets', id) : { kind: 'card', name: '', holder: store.me?.id, personal: false };
  if (!w) return;
  const members = store.activeMembers();
  const used = id && (store.list('expenses').some((e) => e.wallet_id === id)
    || store.list('budget_topups').some((t) => t.wallet_id === id || t.from_wallet === id));
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '지갑 수정' : '지갑 추가'}</h3>
    <form id="wallet-form" class="space-y-2.5">
      <div><label class="label">종류</label>
        ${id ? html`<div class="grid grid-cols-2 gap-2 items-center">
              <select name="personal" class="input"><option value="">공금 (함께 씀)</option><option value="1" ${w.personal ? 'selected' : ''}>개인 (내 용돈)</option></select>
              <p class="text-xs text-slate-300"><i class="fa-solid ${WALLET_ICON[w.kind]} mr-1" style="color:${WALLET_COLOR[w.kind]}"></i>${w.kind === 'card' ? '충전식 카드' : '현금'}</p>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">바꾸면 이 지갑의 충전 · 지출 기록도 새 기준으로 다시 정산돼요.</p>`
          : html`<div class="grid grid-cols-2 gap-2">
              <select name="personal" class="input"><option value="">공금 (함께 씀)</option><option value="1">개인 (내 용돈)</option></select>
              <select name="kind" class="input"><option value="card">충전식 카드</option><option value="cash">현금</option></select>
            </div>
            <p class="text-[10px] text-slate-500 mt-1">개인 지갑은 잔액만 따로 보고, 그 지갑으로 낸 돈은 주인이 낸 것으로 정산해요.</p>`}</div>
      <div><label class="label">이름 *</label><input name="name" class="input" required maxlength="20" value="${w.name || ''}" placeholder="예: 트래블월렛"></div>
      <div><label class="label">${w.personal ? '주인' : '들고 있는 사람 (개인 지갑은 주인)'}</label><select name="holder" class="input">
        ${w.personal ? '' : html`<option value="">정하지 않음 (모두 같이)</option>`}
        ${members.map((m) => html`<option value="${m.id}" ${m.id === w.holder ? 'selected' : ''}>${m.display_name}</option>`)}</select></div>
      <button class="btn-primary">${id ? '수정 저장' : '추가'}</button>
      ${id ? html`<button type="button" data-action="delete" ${used ? 'disabled' : ''} class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold disabled:opacity-40">삭제</button>
        ${used ? html`<p class="text-[10px] text-slate-500">이 지갑을 쓴 기록이 있어서 지울 수 없어요.</p>` : ''}` : ''}
    </form>`, (el) => {
    const off = delegate(el, {
      delete: () => {
        if (used || !confirmAction('이 지갑을 지울까요?')) return;
        store.remove('trip_wallets', id); openBudgetSettings(store);
      },
    });
    $('#wallet-form', el).addEventListener('submit', (ev) => {
      ev.preventDefault();
      const v = formValues(ev.target);
      const data = { name: v.name.trim(), holder: v.holder || null };
      if (!data.name) return;
      const personal = v.personal === '1';
      if (personal && !data.holder) { toast('개인 지갑은 주인을 골라 주세요.', 'error'); return; }
      if (id) store.update('trip_wallets', id, { ...data, ...(personal !== !!w.personal ? { personal } : {}) });
      else store.insert('trip_wallets', { ...data, kind: v.kind === 'cash' ? 'cash' : 'card', sort_order: (personal ? 100 : 0) + (v.kind === 'cash' ? 10 : 0), ...(personal ? { personal: true } : {}) });
      openBudgetSettings(store);
    });
    return off;
  });
}
