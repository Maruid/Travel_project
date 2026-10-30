import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, emptyCard, confirmAction } from '../../components/ui.js';
import { money, todayIn, shortTime, CURRENCIES } from '../../lib/format.js';
import { color } from '../../lib/safe.js';

const EXPENSE_CATS = ['음식', '교통', '쇼핑', '카페', '관광', '숙박', '기타'];
const METHOD_TEXT = { cash: '현금', card: '카드', other: '기타' };

// 금액을 현지통화 기준으로 환산 (다른 통화로 쓴 지출은 home 통화를 거쳐 환산)
function toLocal(store, amount, currency) {
  const b = store.budget || {};
  if (!currency || currency === b.local_currency) return Number(amount) || 0;
  if (currency === b.home_currency && Number(b.rate) > 0) return (Number(amount) || 0) / Number(b.rate);
  return Number(amount) || 0;   // 그 외 통화는 환산하지 않음
}

export function mount(root, store) {
  function update() {
    const b = store.budget || { local_currency: 'KRW', home_currency: 'KRW', rate: 1, base_amount: 0 };
    const L = b.local_currency, H = b.home_currency, rate = Number(b.rate) || 1;
    const homeOf = (v) => money(v * rate, H);

    const topups = store.list('budget_topups');
    const expenses = store.list('expenses').sort((a, c) =>
      `${c.spent_date} ${c.spent_time || ''}`.localeCompare(`${a.spent_date} ${a.spent_time || ''}`));
    const members = store.activeMembers();

    const totalBudget = Number(b.base_amount || 0) + topups.reduce((s, t) => s + Number(t.amount), 0);
    const totalSpent = expenses.reduce((s, e) => s + toLocal(store, e.amount, e.currency), 0);
    const remain = totalBudget - totalSpent;

    // 결제자별 합계 & 균등 분담 기준 정산
    const paid = new Map(), owed = new Map();
    for (const e of expenses) {
      const amt = toLocal(store, e.amount, e.currency);
      if (e.paid_by) paid.set(e.paid_by, (paid.get(e.paid_by) || 0) + amt);
      const split = e.split_with?.length ? e.split_with : members.map((m) => m.id);
      split.forEach((mid) => owed.set(mid, (owed.get(mid) || 0) + amt / split.length));
    }
    const cash = expenses.filter((e) => e.method === 'cash').reduce((s, e) => s + toLocal(store, e.amount, e.currency), 0);

    setHTML(root, html`
      <div class="p-4 space-y-3">
        <div class="glass-card p-4 rounded-2xl">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs font-bold text-slate-400">여행 가계부</span>
            <button data-action="settings" class="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-emerald-300 border border-emerald-500/30 font-mono font-bold">
              1 ${L} = ${rate} ${H} · 예산 관리</button>
          </div>
          <div class="grid grid-cols-2 gap-2 mb-3">
            <div class="p-2.5 rounded-xl bg-night-950/60 border border-white/5">
              <span class="text-[10px] text-slate-400 block">총 예산</span>
              <span class="text-base font-black font-mono text-white">${money(totalBudget, L)}</span>
              <span class="text-[10px] text-slate-400 font-mono block">${homeOf(totalBudget)}</span>
            </div>
            <div class="p-2.5 rounded-xl bg-night-950/60 border border-white/5">
              <span class="text-[10px] text-slate-400 block">총 지출</span>
              <span class="text-base font-black font-mono text-rose-400">${money(totalSpent, L)}</span>
              <span class="text-[10px] text-rose-400/80 font-mono block">${homeOf(totalSpent)}</span>
            </div>
          </div>
          <div class="p-3 rounded-xl ${remain < 0 ? 'bg-rose-500/10 border-rose-500/30' : 'bg-emerald-500/10 border-emerald-500/30'} border flex items-center justify-between">
            <div><span class="text-xs font-bold ${remain < 0 ? 'text-rose-300' : 'text-emerald-300'} block">남은 잔액</span>
              <span class="text-[11px] font-mono text-slate-400">${homeOf(remain)}</span></div>
            <span class="text-xl font-black font-mono ${remain < 0 ? 'text-rose-400' : 'text-emerald-400'}">${money(remain, L)}</span>
          </div>
        </div>

        ${members.length > 1 ? html`
          <div class="glass-card p-3.5 rounded-2xl">
            <div class="flex items-center justify-between text-xs mb-2">
              <span class="font-bold text-slate-300">결제 현황 & 정산 (균등 분담)</span>
              <span class="text-[10px] text-slate-500">현금 ${money(cash, L)} · 카드 등 ${money(totalSpent - cash, L)}</span>
            </div>
            <div class="space-y-1.5">
              ${members.map((m) => {
                const net = (paid.get(m.id) || 0) - (owed.get(m.id) || 0);
                return html`<div class="flex items-center justify-between text-[11px]">
                  <span class="font-bold" style="color:${color(m.color, '#e2e8f0')}">${m.display_name}</span>
                  <span class="font-mono text-slate-300">결제 ${money(paid.get(m.id) || 0, L)}
                    <b class="${net >= 0 ? 'text-emerald-400' : 'text-rose-400'} ml-1">${net >= 0 ? '받을 돈' : '보낼 돈'} ${money(Math.abs(net), L)}</b></span>
                </div>`;
              })}
            </div>
          </div>` : ''}

        <div class="flex items-center justify-between">
          <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-receipt text-neon-cyan mr-1"></i>지출 내역</h3>
          <button data-action="add" class="px-3 py-1.5 rounded-xl bg-neon-cyan text-night-950 font-black text-xs"><i class="fa-solid fa-plus"></i> 지출 등록</button>
        </div>
        <div class="space-y-2">
          ${expenses.length ? expenses.map((e) => {
            const payer = store.member(e.paid_by);
            return html`
            <div data-action="edit" data-id="${e.id}" class="glass-card p-3 rounded-2xl flex items-center justify-between gap-2 cursor-pointer">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5 mb-0.5">
                  ${payer ? html`<span class="text-[9px] px-1.5 rounded font-bold bg-slate-800" style="color:${color(payer.color, '#e2e8f0')}">${payer.display_name}</span>` : ''}
                  <span class="text-[9px] px-1.5 rounded bg-slate-800 text-slate-300 font-bold">${e.category}</span>
                  <span class="text-[9px] font-bold ${e.method === 'cash' ? 'text-amber-400' : 'text-blue-400'}">${METHOD_TEXT[e.method]}</span>
                  <h5 class="text-xs font-bold text-white truncate">${e.place_name}</h5>
                </div>
                <p class="text-[10px] text-slate-400 truncate">${e.note || ''}</p>
                <span class="text-[9px] text-slate-500 font-mono">${e.spent_date} ${shortTime(e.spent_time)}</span>
              </div>
              <div class="text-right flex-shrink-0">
                <span class="text-sm font-black font-mono text-white block">${money(e.amount, e.currency)}</span>
                ${e.currency === L ? html`<span class="text-[10px] text-slate-400 font-mono">${homeOf(Number(e.amount))}</span>` : ''}
              </div>
            </div>`;
          }) : emptyCard('등록된 지출이 없습니다.')}
        </div>
      </div>`);
  }

  const off = delegate(root, {
    add: () => openExpenseEditor(store, null),
    edit: (el) => openExpenseEditor(store, el.dataset.id),
    settings: () => openBudgetSettings(store),
  });
  update();
  return { update, destroy: off };
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
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <div><label class="label">금액 *</label><input name="amount" type="number" min="0" step="any" class="input text-sm font-bold font-mono" required value="${e.amount ?? ''}"></div>
        <div><label class="label">통화</label><select name="currency" class="input">
          ${[...new Set([b.local_currency, b.home_currency, ...CURRENCIES])].filter(Boolean).map((c) => html`<option ${c === e.currency ? 'selected' : ''}>${c}</option>`)}</select></div>
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

function openBudgetSettings(store) {
  const b = store.budget || {};
  const topups = store.list('budget_topups');
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">예산 & 환율</h3>
    <form id="budget-form" class="glass-card p-3 rounded-2xl space-y-2.5 mb-3">
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">현지 통화</label><select name="local_currency" class="input">
          ${CURRENCIES.map((c) => html`<option ${c === b.local_currency ? 'selected' : ''}>${c}</option>`)}</select></div>
        <div><label class="label">내 통화</label><select name="home_currency" class="input">
          ${CURRENCIES.map((c) => html`<option ${c === b.home_currency ? 'selected' : ''}>${c}</option>`)}</select></div>
      </div>
      <div><label class="label">환율 (현지 1단위 = 내 통화 몇)</label><input name="rate" type="number" step="any" min="0" class="input font-mono" value="${b.rate}"></div>
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
    $('#budget-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      store.updateBudget({ local_currency: v.local_currency, home_currency: v.home_currency,
        rate: Number(v.rate) || 1, base_amount: Number(v.base_amount) || 0 });
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
      'del-topup': (b2) => { store.remove('budget_topups', b2.dataset.id); openBudgetSettings(store); },
    });
  });
}
