// =====================================================================
// 사진 줄 · 사진 보기 (일정 · 가이드 · 할 일)
//   photoThumbsHtml : 카드 안 작은 썸네일 줄 (누르면 크게 보기: data-action="photo")
//   mountPhotoEditor: 편집 창 안 사진 칸 (추가 · 지우기 · 사진/문서 고르기 · 보관 안내)
//   hydratePhotos   : 화면의 썸네일 자리에 실제 사진 채우기 (기기 캐시 → 서버)
//   openPhotoViewer : 크게 보기 (두 손가락 확대 · 두 번 탭 · 옆으로 넘기기 · 기기에 저장)
//   photoNoticeHtml : 여행 화면 위 보관 기간 안내 띠 (삭제 7일 전부터)
// =====================================================================
import { html, setHTML, $ } from '../lib/dom.js';
import { toast, confirmAction } from './ui.js';
import { pickerOpened, pickerClosedByApp } from '../lib/back-nav.js';
import {
  imagesOf, retention, keepDaysOf, getImageUrl, getImageBlob, uploadImages, removeImage, refreshStatus,
  imageErrorText, saveBlob, fileName, PER_TARGET, levelOf, purgeTripCache,
} from '../lib/images.js';
import { todayIn } from '../lib/format.js';

const md = (d) => (d ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : '');
const KIND_KEY = 'photo:kind';
const FIRST_KEY = 'photo:notice-seen';

function retentionOf(store, count) {
  return retention({
    endDate: store.trip?.end_date, keepDays: keepDaysOf(store.tripId),
    today: todayIn(store.trip?.timezone), count,
  });
}

// ---------------------------------------------------------- 카드용 썸네일 줄
export function photoThumbsHtml(store, type, id, { size = 'w-11 h-11' } = {}) {
  if (!store.tripId) return '';   // 보기 전용 링크: 사진 없음
  const rows = imagesOf(store.list('trip_images'), type, id);
  if (!rows.length) return '';
  return html`<div class="flex gap-1.5 mt-2 flex-wrap">${rows.map((img) => thumbHtml(img, size, 'photo'))}</div>`;
}

function thumbHtml(img, size, action, extra = '') {
  return html`
    <button type="button" data-action="${action}" data-img="${img.id}" class="relative ${size} rounded-lg overflow-hidden bg-slate-800 border border-white/10 flex-shrink-0 flex items-center justify-center">
      ${img.purged_at
        ? html`<i class="fa-solid fa-trash-can text-[10px] text-slate-500" title="보관 기간이 지나 삭제됨"></i>`
        : html`<i data-ph class="fa-solid fa-image text-[11px] text-slate-600"></i>
               <img data-thumb="${img.id}" alt="" class="hidden absolute inset-0 w-full h-full object-cover">`}
      ${img.kind === 'doc' && !img.purged_at ? html`<span class="absolute bottom-0 left-0 right-0 text-[7px] font-bold text-center bg-black/60 text-amber-200">문서</span>` : ''}
      ${extra}
    </button>`;
}

// 화면의 썸네일 자리 채우기 (그린 뒤 부름)
export function hydratePhotos(root, store) {
  if (!store.tripId) return;
  const imgs = root.querySelectorAll('img[data-thumb]:not([data-done])');
  if (!imgs.length) return;
  refreshStatus(store.tripId);
  imgs.forEach(async (el) => {
    el.dataset.done = '1';
    const row = store.get('trip_images', el.dataset.thumb);
    if (!row) return;
    try {
      el.src = await getImageUrl(store.tripId, row, { thumb: true });
      el.classList.remove('hidden');
      el.parentElement?.querySelector('[data-ph]')?.classList.add('hidden');
    } catch (e) {
      const ph = el.parentElement?.querySelector('[data-ph]');
      if (ph) ph.className = `fa-solid ${/OFFLINE/.test(e?.message) ? 'fa-cloud' : /LIMIT/.test(e?.message) ? 'fa-lock' : 'fa-image'} text-[10px] text-slate-500`;
    }
  });
}

// ---------------------------------------------------------- 편집 창 안 사진 칸
//  container 안에 그리고 store 변경에 맞춰 다시 그림. 반환: 정리 함수
export function mountPhotoEditor(container, store, type, id) {
  if (!store.tripId) return () => {};
  let kind = 'photo';
  try { kind = localStorage.getItem(KIND_KEY) === 'doc' ? 'doc' : 'photo'; } catch {}
  let busy = null;   // '2/3' 처럼 진행 중

  function draw() {
    const rows = imagesOf(store.list('trip_images'), type, id);
    const live = rows.filter((r) => !r.purged_at);
    const ret = retentionOf(store, live.length || 1);
    const expired = ret.state === 'purged';
    const full = live.length >= PER_TARGET;
    setHTML(container, html`
      <div class="flex items-center justify-between mb-1">
        <label class="label !mb-0">사진 <span class="text-slate-500 font-normal">${live.length}/${PER_TARGET}</span></label>
        ${expired ? '' : html`
          <div class="flex rounded-lg bg-slate-800 border border-white/10 p-0.5 text-[10px] font-bold">
            ${[['photo', '사진'], ['doc', '문서 · 바우처']].map(([k, t]) => html`
              <button type="button" data-pk="${k}" class="px-2 py-0.5 rounded-md whitespace-nowrap ${kind === k ? 'bg-neon-cyan text-night-950' : 'text-slate-400'}">${t}</button>`)}
          </div>`}
      </div>
      <div class="flex gap-1.5 flex-wrap">
        ${rows.map((img) => thumbHtml(img, 'w-16 h-16', 'photo-open',
          html`<span data-del="${img.id}" class="absolute top-0.5 right-0.5 w-5 h-5 rounded-full bg-black/70 text-slate-200 text-[9px] flex items-center justify-center"><i class="fa-solid fa-xmark"></i></span>`))}
        ${expired || full ? '' : html`
          <button type="button" data-add class="w-16 h-16 rounded-lg border border-dashed border-sky-400/50 text-sky-200 text-[10px] font-bold flex flex-col items-center justify-center gap-0.5 ${busy ? 'opacity-60' : ''}" ${busy ? 'disabled' : ''}>
            <i class="fa-solid ${busy ? 'fa-spinner fa-spin' : 'fa-camera'} text-sm"></i>${busy ? busy : '추가'}</button>`}
      </div>
      <input type="file" accept="image/*" multiple data-file class="hidden">
      <p class="text-[10px] text-slate-500 mt-1 leading-relaxed">
        ${expired ? '보관 기간이 지나 사진을 붙일 수 없어요.'
          : html`${kind === 'doc' ? '문서는 작은 글씨도 읽히게 크게 저장해요. ' : ''}사진은 여행이 끝나고 ${keepDaysOf(store.tripId)}일 뒤${ret.purge ? html` (${md(ret.purge)})` : ''} 자동 삭제돼요. 꼭 남길 사진은 크게 본 뒤 [저장]하세요.`}
      </p>`);
    hydratePhotos(container, store);
  }

  async function addFiles(files) {
    if (!files?.length) return;
    busy = '…'; draw();
    try {
      const r = await uploadImages(store, files, {
        targetType: type, targetId: id, kind,
        onProgress: (d, n) => { busy = `${Math.min(d + 1, n)}/${n}`; draw(); },
      });
      toast(r.skipped ? `${r.done}장을 붙였어요. (한도를 넘은 ${r.skipped}장은 뺐어요)` : `${r.done}장을 붙였어요.`);
    } catch (e) {
      toast(imageErrorText(e), 'error');
    } finally {
      busy = null; draw();
    }
  }

  const onClick = (e) => {
    const pk = e.target.closest('[data-pk]');
    if (pk) { kind = pk.dataset.pk; try { localStorage.setItem(KIND_KEY, kind); } catch {} draw(); return; }
    const del = e.target.closest('[data-del]');
    if (del) {
      e.preventDefault(); e.stopPropagation();
      const img = store.get('trip_images', del.dataset.del);
      if (img && confirmAction('이 사진을 지울까요?')) removeImage(store, img);
      return;
    }
    const open = e.target.closest('[data-action="photo-open"]');
    if (open) { e.preventDefault(); e.stopPropagation(); openPhotoViewer(store, open.dataset.img); return; }
    if (e.target.closest('[data-add]')) {
      e.preventDefault();
      if (!navigator.onLine) { toast('사진은 인터넷에 연결됐을 때 붙일 수 있어요.', 'error'); return; }
      firstNotice(store, () => $('[data-file]', container)?.click());
    }
  };
  const onChange = (e) => {
    if (!e.target.matches('[data-file]')) return;
    const files = [...e.target.files];
    e.target.value = '';
    addFiles(files);
  };
  container.addEventListener('click', onClick);
  container.addEventListener('change', onChange);
  const unsub = store.subscribe((_, k) => { if (k !== 'status' && !busy) draw(); });
  draw();
  return () => { container.removeEventListener('click', onClick); container.removeEventListener('change', onChange); unsub(); };
}

// 처음 한 번: 보관 기간 안내
function firstNotice(store, next) {
  let seen = false;
  try { seen = localStorage.getItem(FIRST_KEY) === '1'; } catch {}
  if (seen) { next(); return; }
  try { localStorage.setItem(FIRST_KEY, '1'); } catch {}
  const ok = window.confirm(`사진은 여행이 끝나고 ${keepDaysOf(store.tripId)}일 뒤 자동으로 삭제돼요.\n꼭 남길 사진은 크게 본 뒤 [저장]으로 기기에 저장해 두세요.\n\n사진을 고를까요?`);
  if (ok) next();
}

// ---------------------------------------------------------- 크게 보기
let viewer = null;

export function openPhotoViewer(store, imgId) {
  const img0 = store.get('trip_images', imgId);
  if (!img0) return;
  const list = imagesOf(store.list('trip_images'), img0.target_type, img0.target_id);
  let idx = Math.max(0, list.findIndex((r) => r.id === imgId));
  closeViewer(true);

  const el = document.createElement('div');
  el.className = 'fixed inset-0 z-[80] bg-black flex flex-col select-none';
  el.innerHTML = `
    <div class="flex items-center gap-2 px-3 text-white flex-shrink-0" style="height:calc(3rem + var(--sat)); padding-top:var(--sat)">
      <span data-v-idx class="text-xs font-mono text-slate-300 flex-1"></span>
      <button data-v-save class="h-8 px-3 rounded-lg bg-white/10 text-xs font-bold"><i class="fa-solid fa-download mr-1"></i>저장</button>
      <button data-v-close class="w-9 h-9 rounded-lg text-slate-200" title="닫기"><i class="fa-solid fa-xmark text-lg"></i></button>
    </div>
    <div data-v-stage class="flex-1 relative overflow-hidden" style="touch-action:none">
      <div data-v-msg class="absolute inset-0 flex items-center justify-center text-xs text-slate-400 text-center px-8"></div>
      <img data-v-img alt="" class="absolute left-1/2 top-1/2 max-w-none hidden" draggable="false" style="transform-origin:0 0">
    </div>
    <div data-v-hint class="text-center text-[10px] text-slate-500 flex-shrink-0" style="padding-bottom:calc(0.5rem + var(--sab))">두 손가락으로 확대 · 두 번 탭 · 옆으로 넘기기</div>`;
  document.body.appendChild(el);
  const stage = $('[data-v-stage]', el);
  const imgEl = $('[data-v-img]', el);
  const msg = $('[data-v-msg]', el);

  // 확대 상태: 화면 맞춤 배율(fit) × 사용자 배율(z), 이동(x, y)
  let fit = 1; let z = 1; let x = 0; let y = 0; let nw = 0; let nh = 0;
  const apply = () => {
    const s = fit * z;
    imgEl.style.width = `${nw}px`; imgEl.style.height = `${nh}px`;
    imgEl.style.transform = `translate(${x - (nw * s) / 2}px, ${y - (nh * s) / 2}px) scale(${s})`;
  };
  const clamp = () => {
    const s = fit * z; const r = stage.getBoundingClientRect();
    const mx = Math.max(0, (nw * s - r.width) / 2); const my = Math.max(0, (nh * s - r.height) / 2);
    x = Math.min(mx, Math.max(-mx, x)); y = Math.min(my, Math.max(-my, y));
  };
  const reset = () => {
    const r = stage.getBoundingClientRect();
    fit = nw && nh ? Math.min(r.width / nw, r.height / nh) : 1;
    z = 1; x = 0; y = 0; apply();
  };

  let token = 0;
  async function show() {
    const img = list[idx];
    $('[data-v-idx]', el).textContent = `${idx + 1} / ${list.length}${img.kind === 'doc' ? ' · 문서' : ''}`;
    imgEl.classList.add('hidden');
    msg.textContent = img.purged_at ? '보관 기간이 지나 삭제된 사진이에요.' : '불러오는 중…';
    if (img.purged_at) return;
    const my = ++token;
    try {
      // 썸네일을 먼저 보여 주고 원본으로 바꿈
      const t = await getImageUrl(store.tripId, img, { thumb: true }).catch(() => null);
      if (my !== token) return;
      if (t) setSrc(t);
      const u = await getImageUrl(store.tripId, img, { thumb: false });
      if (my !== token) return;
      setSrc(u);
      msg.textContent = '';
    } catch (e) {
      if (my !== token) return;
      msg.textContent = imageErrorText(e);
    }
  }
  function setSrc(u) {
    const keep = !imgEl.classList.contains('hidden') && nw;
    imgEl.onload = () => {
      nw = imgEl.naturalWidth; nh = imgEl.naturalHeight;
      if (!keep) reset(); else { const r = stage.getBoundingClientRect(); fit = Math.min(r.width / nw, r.height / nh); apply(); }
      imgEl.classList.remove('hidden');
      msg.textContent = '';
    };
    imgEl.src = u;
  }
  const go = (d) => {
    if (list.length < 2) return;
    idx = (idx + d + list.length) % list.length;
    show();
  };

  // 손가락 처리
  const pts = new Map();
  let start = null; let lastTap = 0; let swipe = null;
  const onDown = (e) => {
    stage.setPointerCapture?.(e.pointerId);
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      swipe = { x: e.clientX, y: e.clientY, t: Date.now() };
      const now = Date.now();
      if (now - lastTap < 300) {   // 두 번 탭: 2.5배 ↔ 맞춤
        const r = stage.getBoundingClientRect();
        if (z > 1.01) { z = 1; x = 0; y = 0; } else {
          const px = e.clientX - r.left - r.width / 2; const py = e.clientY - r.top - r.height / 2;
          z = 2.5; x = -px * 1.5; y = -py * 1.5; clamp();
        }
        apply(); lastTap = 0; swipe = null; return;
      }
      lastTap = now;
    }
    start = snapshot();
  };
  const snapshot = () => {
    const p = [...pts.values()];
    const c = p.length === 2 ? { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 } : p[0];
    const d = p.length === 2 ? Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) : 0;
    return { c, d, z, x, y, n: p.length };
  };
  const onMove = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const now = snapshot();
    if (!start || start.n !== now.n) { start = now; return; }
    if (now.n === 2 && start.d) {
      const r = stage.getBoundingClientRect();
      const nz = Math.min(8, Math.max(1, start.z * (now.d / start.d)));
      const k = nz / start.z;
      const cx = start.c.x - r.left - r.width / 2; const cy = start.c.y - r.top - r.height / 2;
      x = (start.x - cx) * k + cx + (now.c.x - start.c.x);
      y = (start.y - cy) * k + cy + (now.c.y - start.c.y);
      z = nz; swipe = null;
    } else if (z > 1.01) {
      x = start.x + (now.c.x - start.c.x); y = start.y + (now.c.y - start.c.y);
    }
    clamp(); apply();
  };
  const onUp = (e) => {
    pts.delete(e.pointerId);
    if (swipe && pts.size === 0 && z <= 1.01) {
      const dx = e.clientX - swipe.x; const dy = e.clientY - swipe.y;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - swipe.t < 600) go(dx < 0 ? 1 : -1);
    }
    if (pts.size === 0) swipe = null;
    start = pts.size ? snapshot() : null;
  };
  stage.addEventListener('pointerdown', onDown);
  stage.addEventListener('pointermove', onMove);
  stage.addEventListener('pointerup', onUp);
  stage.addEventListener('pointercancel', onUp);
  const onResize = () => { if (nw) { const r = stage.getBoundingClientRect(); fit = Math.min(r.width / nw, r.height / nh); clamp(); apply(); } };
  window.addEventListener('resize', onResize);

  el.addEventListener('click', async (e) => {
    if (e.target.closest('[data-v-close]')) { closeViewer(); return; }
    if (e.target.closest('[data-v-save]')) {
      const img = list[idx];
      if (img.purged_at) return;
      try {
        await saveBlob(await getImageBlob(store.tripId, img), fileName(img));
        toast('저장했어요.');
      } catch (er) { toast(imageErrorText(er), 'error'); }
    }
  });

  viewer = { el, cleanup: () => window.removeEventListener('resize', onResize) };
  pickerOpened(() => closeViewer(true));
  show();
}

function closeViewer(quiet = false) {
  if (!viewer) return;
  const v = viewer; viewer = null;
  v.cleanup();
  v.el.remove();
  if (!quiet) pickerClosedByApp();
}
window.addEventListener('app:route', () => closeViewer(true));

// ---------------------------------------------------------- 여행 화면 위 보관 안내 띠
const DISMISS_KEY = (trip, purge) => `photo:notice:${trip}:${purge}`;

export function photoNoticeHtml(store) {
  if (!store.tripId) return '';
  const rows = store.list('trip_images');
  const live = rows.filter((r) => !r.purged_at);
  const ret = retentionOf(store, live.length);
  if (ret.state === 'purged' && rows.some((r) => !r.purged_at)) {
    // 서버가 아직 안 지웠어도 기기에서는 더 보여 주지 않음 → 곧 정리됨
    return '';
  }
  if (ret.state !== 'soon') return '';
  try { if (sessionStorage.getItem(DISMISS_KEY(store.tripId, ret.purge))) return ''; } catch {}
  const bytes = live.reduce((s, r) => s + (r.bytes || 0), 0);
  return html`
    <div class="mx-3 mt-2 p-2.5 rounded-2xl bg-amber-500/10 border border-amber-400/40 text-[11px] text-amber-100 flex items-center gap-2">
      <i class="fa-solid fa-clock-rotate-left text-amber-300"></i>
      <span class="flex-1 min-w-0">${ret.days === 0 ? '오늘' : `${ret.days}일 뒤`}(${md(ret.purge)}) 이 여행의 사진 ${live.length}장이 삭제돼요.</span>
      <button data-action="photo-save-all" class="flex-shrink-0 px-2 py-1 rounded-lg bg-amber-400 text-night-950 font-bold">모두 저장</button>
      <button data-action="photo-notice-close" class="flex-shrink-0 w-6 h-6 text-amber-200/70" title="닫기"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
}

export function dismissPhotoNotice(store) {
  const ret = retentionOf(store, 1);
  try { sessionStorage.setItem(DISMISS_KEY(store.tripId, ret.purge), '1'); } catch {}
}

// 모두 저장: 원본을 하나씩 기기에 저장 (받은 적 없는 사진은 전송량에 포함)
export async function saveAllPhotos(store) {
  const live = store.list('trip_images').filter((r) => !r.purged_at);
  if (!live.length) { toast('저장할 사진이 없어요.'); return; }
  if (levelOf(store.tripId) === 'blocked') { toast(imageErrorText(new Error('IMAGE_LIMIT')), 'error'); return; }
  if (!confirmAction(`사진 ${live.length}장을 기기에 저장할까요?`)) return;
  let ok = 0; let fail = null;
  toast(`저장 중… (0/${live.length})`);
  for (const img of live) {
    try { await saveBlob(await getImageBlob(store.tripId, img), fileName(img)); ok++; } catch (e) { fail = e; if (/APP_UPDATE/.test(e?.message)) break; }
  }
  toast(fail && !ok ? imageErrorText(fail) : `${ok}장을 저장했어요.${fail ? ` (${live.length - ok}장 실패)` : ''}`, fail && !ok ? 'error' : 'info');
}

// 보관 기간이 지난 여행: 기기 캐시도 비움 (어느 기기에선 보이고 어느 기기에선 안 보이는 일 없게)
export function purgeExpiredCache(store) {
  if (!store.tripId) return;
  const rows = store.list('trip_images');
  if (!rows.length) return;
  const ret = retentionOf(store, rows.length);
  if (ret.state === 'purged' || rows.every((r) => r.purged_at)) purgeTripCache(store.tripId);
}
