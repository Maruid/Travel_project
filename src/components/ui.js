import { setHTML, html } from '../lib/dom.js';
import { sheetOpened, sheetClosedByApp, sheetClosedByRoute, sheetIsOpen } from '../lib/back-nav.js';

// ---------- 토스트 ----------
let toastTimer;
// action: { label, onClick } → 알림 오른쪽 버튼 (되돌리기 · 지출 기록 등). 누르면 알림을 닫고 실행
export function toast(msg, kind = 'info', { action = null } = {}) {
  const el = document.getElementById('toast');
  const icon = kind === 'error' ? 'fa-circle-exclamation text-rose-400' : 'fa-circle-check text-neon-cyan';
  setHTML(el, html`<span class="flex items-start gap-2"><i class="fa-solid ${icon} mt-0.5 flex-shrink-0"></i><span class="min-w-0 break-keep">${msg}</span>${action ? html`
    <button data-toast-action class="self-center flex-shrink-0 ml-1 px-2 py-1 rounded-lg bg-neon-cyan/15 border border-neon-cyan/40 text-neon-cyan font-bold whitespace-nowrap">${action.label}</button>` : ''}</span>`);
  el.onclick = action ? (e) => {
    if (!e.target.closest('[data-toast-action]')) return;
    el.classList.add('hidden');
    el.onclick = null;
    action.onClick();
  } : null;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  // 긴 안내 문구는 더 오래 보여줌. 버튼이 있으면 누를 시간을 더 줌
  toastTimer = setTimeout(() => el.classList.add('hidden'), Math.min(7000, 2200 + String(msg).length * 45 + (action ? 2500 : 0)));
}

// ---------- 바텀시트 ----------
let sheetCleanup = null;

export function openSheet(content, onMount) {
  const sheet = document.getElementById('sheet');
  sheetOpened(hideSheet);   // 뒤로가기 = 시트 닫기
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
  sheetClosedByApp();
  hideSheet();
}

// 기록은 건드리지 않고 닫기 (뒤로가기로 닫힌 경우 · 화면 이동)
function hideSheet() {
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
// 다른 화면으로 이동하면 열려 있던 시트를 닫음 (router.js 가 보냄)
window.addEventListener('app:route', () => {
  if (!sheetIsOpen()) return;
  sheetClosedByRoute();
  hideSheet();
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
