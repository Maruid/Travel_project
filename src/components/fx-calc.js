import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { openSheet } from './ui.js';
import { money, approxMoney, rateText } from '../lib/format.js';
import { unitOf, moneyProfile } from '../lib/currency.js';
import { pressKey, partsText, fmtNum } from '../lib/fx-keys.js';

// 빠른 환율 계산기: 가계부의 환율(현지 1 = 내 통화 rate)로 바로 계산
//  - 기본은 현지 → 내 통화, [바꾸기]로 방향 바꾸기
//  - 시스템 키보드 대신 앱 안 숫자 키패드 (키보드 위 자동완성 줄·화면 가림 없음)
//  - 지폐 칩 [+1,000] 은 누를 때마다 더함 ("5,000 × 2 + 1,000" 내역 표시), [비우기]로 0
//  - 칩·키패드는 통화마다 다름 (currency.js CURRENCY_MONEY): 센트가 있는 통화는 "." 키, 동·루피아는 "000" 키

export function openFxCalc(store) {
  const b = store.budget || {};
  const L = b.local_currency; const H = b.home_currency; const rate = Number(b.rate) || 0;
  if (!L || !H || L === H || !(rate > 0)) return false;
  let reverse = false;   // false: 현지 → 내 통화
  let amount = '';       // 숫자 문자열
  let parts = [];        // 칩으로 더한 내역 (직접 친 숫자가 앞에 있으면 첫 항목)

  openSheet(html`
    <div class="flex items-center justify-between mb-2">
      <h3 class="text-base font-black text-white"><i class="fa-solid fa-calculator text-emerald-300 mr-1"></i>환율 계산</h3>
      <span class="text-[10px] text-slate-400">${rateText(b)}</span>
    </div>
    <div id="fx-body"></div>
    <p class="text-[10px] text-slate-500 mt-2">가계부 → 예산 관리의 환율로 계산해요.</p>
  `, (el) => {
    const from = () => (reverse ? H : L);
    const prof = () => moneyProfile(from(), reverse ? 1 / rate : rate);

    function render() {
      const p = prof();
      const zeroKey = p.dec ? '.' : p.big ? '000' : '00';
      const keys = ['7', '8', '9', '4', '5', '6', '1', '2', '3', zeroKey, '0', 'back'];
      setHTML($('#fx-body', el), html`
        <div class="glass-card p-3 rounded-2xl space-y-2">
          <div class="flex items-baseline justify-end gap-2 px-1">
            <span id="fx-in" class="text-2xl font-black font-mono text-white truncate">${amount ? fmtInput(amount) : '0'}</span>
            <span class="text-sm font-bold text-slate-300 flex-shrink-0">${unitOf(from()) || from()}</span>
          </div>
          <p id="fx-parts" class="text-right text-[10px] text-slate-500 font-mono min-h-[14px] px-1 truncate">${parts.length ? partsText(parts) : ''}</p>
          <div class="flex gap-1 overflow-x-auto no-scrollbar">
            <button data-action="clear" class="flex-shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg bg-rose-500/15 text-rose-200 border border-rose-500/30 font-bold">비우기</button>
            ${p.bills.map((q) => html`<button data-action="q" data-v="${q}" class="flex-shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 font-mono font-bold border border-white/10">+${fmtNum(q)}</button>`)}
          </div>
          <div class="flex items-center justify-between pt-2 border-t border-white/10">
            <button data-action="swap" class="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 text-neon-cyan font-bold"><i class="fa-solid fa-right-left mr-1"></i>바꾸기</button>
            <div id="fx-out" class="text-right"></div>
          </div>
          <div class="grid grid-cols-3 gap-1.5 pt-1 select-none">
            ${keys.map((k) => html`<button data-key="${k}" class="h-12 rounded-xl ${k === 'back' ? 'bg-slate-700 text-slate-200' : 'bg-slate-800 text-white'} text-lg font-bold font-mono active:bg-slate-600 touch-manipulation">
              ${k === 'back' ? html`<i class="fa-solid fa-delete-left"></i>` : k}</button>`)}
          </div>
        </div>`);
      renderOut();
    }
    const fmtInput = (s) => {
      const [i, f] = s.split('.');
      return `${Number(i || 0).toLocaleString('ko-KR')}${f != null ? `.${f}` : ''}`;
    };
    function renderOut() {
      const to = reverse ? L : H;
      const n = Number(amount) || 0;
      const out = reverse ? n / rate : n * rate;
      $('#fx-in', el).textContent = amount ? fmtInput(amount) : '0';
      $('#fx-parts', el).textContent = parts.length ? partsText(parts) : '';
      setHTML($('#fx-out', el), html`
        <p class="text-xl font-black font-mono text-emerald-300">${money(out, to)}</p>
        ${to === 'KRW' && out >= 10000 ? html`<p class="text-[10px] text-slate-400">${approxMoney(out, 'KRW')}</p>` : ''}`);
    }

    function key(k) {
      amount = pressKey(amount, k, { dec: prof().dec });
      parts = [];   // 직접 고치면 칩 내역은 지움
      renderOut();
    }
    // ⌫ 길게 누르면 계속 지우기
    let repeat = null;
    const stopRepeat = () => { clearTimeout(repeat); clearInterval(repeat); repeat = null; };
    const onDown = (e) => {
      const btn = e.target.closest('[data-key]');
      if (!btn) return;
      e.preventDefault();
      key(btn.dataset.key);
      if (btn.dataset.key === 'back') repeat = setTimeout(() => { repeat = setInterval(() => key('back'), 80); }, 400);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointerup', stopRepeat);
    el.addEventListener('pointercancel', stopRepeat);
    el.addEventListener('pointerleave', stopRepeat);

    const off = delegate(el, {
      q: (btn) => {
        const v = Number(btn.dataset.v);
        const cur = Number(amount) || 0;
        if (!parts.length && cur) parts.push({ v: cur, typed: true });
        parts.push({ v });
        amount = String(Math.round((cur + v) * 100) / 100);
        renderOut();
      },
      clear: () => { amount = ''; parts = []; renderOut(); },
      swap: () => {
        const n = Number(amount) || 0;
        reverse = !reverse;
        const conv = reverse ? n * rate : n / rate;   // 바뀐 방향의 입력 통화로
        const f = prof().dec ? 100 : 1;               // 소수점 없는 통화는 정수로
        amount = n ? String(Math.round(conv * f) / f) : '';
        parts = [];
        render();
      },
    });
    render();
    return () => { off(); stopRepeat(); el.removeEventListener('pointerdown', onDown); el.removeEventListener('pointerup', stopRepeat); el.removeEventListener('pointercancel', stopRepeat); el.removeEventListener('pointerleave', stopRepeat); };
  });
  return true;
}
