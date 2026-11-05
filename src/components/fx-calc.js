import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { openSheet } from './ui.js';
import { money, approxMoney, rateText } from '../lib/format.js';
import { unitOf } from '../lib/currency.js';

// 빠른 환율 계산기: 가계부의 환율(현지 1 = 내 통화 rate)로 바로 계산
//  - 기본은 현지 → 내 통화, ⇄ 로 방향 바꾸기
//  - 자주 쓰는 금액 버튼
const QUICK = { JPY: [500, 1000, 3000, 5000, 10000], USD: [1, 5, 10, 50, 100], EUR: [1, 5, 10, 50, 100], KRW: [1000, 5000, 10000, 50000] };

export function openFxCalc(store) {
  const b = store.budget || {};
  const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 0;
  if (!L || !H || L === H || !(rate > 0)) return false;
  let reverse = false;   // false: 현지 → 내 통화
  let amount = '';

  openSheet(html`
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-base font-black text-white"><i class="fa-solid fa-calculator text-emerald-300 mr-1"></i>환율 계산</h3>
      <span class="text-[10px] text-slate-400">${rateText(b)}</span>
    </div>
    <div id="fx-body"></div>
    <p class="text-[10px] text-slate-500 mt-2">가계부 → 예산 관리의 환율로 계산해요.</p>
  `, (el) => {
    // 입력 칸은 다시 그리지 않음 (다시 그리면 입력 중 커서가 튐) → 단위·버튼·결과만 갱신
    function renderFrame() {
      const from = reverse ? H : L;
      const quick = QUICK[from] || [1, 10, 100, 1000];
      setHTML($('#fx-body', el), html`
        <div class="glass-card p-3 rounded-2xl space-y-2">
          <div class="flex items-center gap-2">
            <input id="fx-in" type="number" inputmode="decimal" min="0" step="any" class="input text-lg font-black font-mono" placeholder="0" value="${amount}">
            <span class="text-sm font-bold text-slate-300 flex-shrink-0 w-10">${unitOf(from) || from}</span>
          </div>
          <div class="flex flex-wrap gap-1">
            ${quick.map((q) => html`<button data-action="q" data-v="${q}" class="text-[11px] px-2 py-1 rounded-lg bg-slate-800 text-slate-300 font-mono">${q.toLocaleString()}</button>`)}
          </div>
          <div class="flex items-center justify-between pt-2 border-t border-white/10">
            <button data-action="swap" class="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-neon-cyan font-bold"><i class="fa-solid fa-right-left mr-1"></i>바꾸기</button>
            <div id="fx-out" class="text-right"></div>
          </div>
        </div>`);
      renderOut();
    }
    function renderOut() {
      const to = reverse ? L : H;
      const n = Number(amount) || 0;
      const out = reverse ? n / rate : n * rate;
      setHTML($('#fx-out', el), html`
        <p class="text-xl font-black font-mono text-emerald-300">${money(out, to)}</p>
        ${to === 'KRW' && out >= 10000 ? html`<p class="text-[10px] text-slate-400">${approxMoney(out, 'KRW')}</p>` : ''}`);
    }
    const onInput = (e) => {
      if (e.target.id !== 'fx-in') return;
      amount = e.target.value;
      renderOut();
    };
    el.addEventListener('input', onInput);
    const off = delegate(el, {
      q: (btn) => { amount = btn.dataset.v; $('#fx-in', el).value = amount; renderOut(); },
      swap: () => {
        const n = Number(amount) || 0;
        amount = n ? String(Math.round((reverse ? n / rate : n * rate) * 100) / 100) : '';
        reverse = !reverse;
        renderFrame();
      },
    });
    renderFrame();
    setTimeout(() => $('#fx-in', el)?.focus(), 250);
    return () => { off(); el.removeEventListener('input', onInput); };
  });
  return true;
}
