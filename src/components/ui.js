import { setHTML, html } from '../lib/dom.js';

// ---------- 토스트 ----------
let toastTimer;
export function toast(msg, kind = 'info') {
  const el = document.getElementById('toast');
  const icon = kind === 'error' ? 'fa-circle-exclamation text-rose-400' : 'fa-circle-check text-neon-cyan';
  setHTML(el, html`<span class="flex items-center gap-2"><i class="fa-solid ${icon}"></i><span>${msg}</span></span>`);
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  // 긴 안내 문구는 더 오래 보여줌
  toastTimer = setTimeout(() => el.classList.add('hidden'), Math.min(7000, 2200 + String(msg).length * 45));
}

// ---------- 바텀시트 ----------
let sheetCleanup = null;

export function openSheet(content, onMount) {
  const sheet = document.getElementById('sheet');
  const backdrop = document.getElementById('sheet-backdrop');
  closeSheetSync();
  setHTML(document.getElementById('sheet-content'), html`
    ${content}
    <button data-sheet-close class="w-full mt-4 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-bold text-xs hover:bg-slate-700 transition">닫기</button>
  `);
  backdrop.classList.remove('hidden');
  requestAnimationFrame(() => sheet.classList.remove('translate-y-full'));
  sheetCleanup = onMount?.(document.getElementById('sheet-content')) || null;
}

function closeSheetSync() {
  if (typeof sheetCleanup === 'function') sheetCleanup();
  sheetCleanup = null;
}

export function closeSheet() {
  closeSheetSync();
  document.getElementById('sheet').classList.add('translate-y-full');
  setTimeout(() => {
    document.getElementById('sheet-backdrop').classList.add('hidden');
    setHTML(document.getElementById('sheet-content'), html``);
  }, 250);
}

document.addEventListener('click', (e) => {
  if (e.target.closest('[data-sheet-close]') || e.target.id === 'sheet-backdrop') closeSheet();
});

// ---------- 확인 ----------
export function confirmAction(message) {
  return window.confirm(message);
}

// ---------- 공통 조각 ----------
export const spinner = (text = '불러오는 중...') => html`
  <div class="p-10 text-center text-slate-400 text-xs flex flex-col items-center gap-3">
    <i class="fa-solid fa-spinner fa-spin text-neon-cyan text-xl"></i><span>${text}</span>
  </div>`;

export const emptyCard = (text) => html`
  <div class="glass-card p-6 text-center text-slate-500 text-xs rounded-2xl">${text}</div>`;

export async function copyText(text, label = '텍스트') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}가 복사되었습니다.`);
  } catch {
    toast('복사에 실패했습니다. 길게 눌러 직접 복사해 주세요.', 'error');
  }
}
