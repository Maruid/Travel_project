import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { ensureUser } from '../lib/auth.js';
import { rpc, errorText } from '../lib/supabase.js';
import { TripStore } from '../lib/store.js';
import { spinner, toast } from '../components/ui.js';
import { navigate } from '../router.js';
import { tripProgress, todayIn } from '../lib/format.js';
import { backToHome } from '../lib/back-nav.js';
import { whenIdle, markOpen, markClosed } from '../lib/prefetch.js';
import { photoNoticeHtml, dismissPhotoNotice, saveAllPhotos, purgeExpiredCache } from '../components/photos.js';
import { refreshStatus, prefetchWindow, prefetchTripImages } from '../lib/images.js';

const TABS = [
  { key: 'places',   label: '장소',   icon: 'fa-map-location-dot', load: () => import('./tabs/places.js') },
  { key: 'schedule', label: '일정',   icon: 'fa-calendar-day',     load: () => import('./tabs/schedule.js') },
  { key: 'guides',   label: '가이드', icon: 'fa-lightbulb',        load: () => import('./tabs/guides.js') },
  { key: 'budget',   label: '가계부', icon: 'fa-wallet',           load: () => import('./tabs/budget.js') },
  { key: 'todos',    label: '할 일',  icon: 'fa-list-check',       load: () => import('./tabs/todos.js') },
  { key: 'more',     label: '설정',   icon: 'fa-gear',            load: () => import('./tabs/more.js') },
];
// 관리자 보기: 설정 탭 자리에 관리 정보 (읽기 전용)
const ADMIN_TABS = TABS.map((t) => (t.key === 'more'
  ? { key: 'more', label: '관리', icon: 'fa-user-shield', load: () => import('./tabs/admin-info.js') } : t));
export const FROM_ADMIN = 'nav:fromAdmin';   // sessionStorage: 관리자 화면에서 열었는지 ([←] 동작)

// params.admin: #/admin/trip/:id — 멤버가 아니어도 서버에서 받아 보기만 (이 기기에 저장 · 내 여행 목록에 안 남음)
export async function render(app, params) {
  setHTML(app, spinner());
  const admin = !!params.admin;
  const tabs = admin ? ADMIN_TABS : TABS;
  const base = admin ? `/admin/trip/${params.id}` : `/trip/${params.id}`;

  let user;
  try { user = await ensureUser(); } catch (e) { toast(errorText(e), 'error'); }

  // 자동 미리 받기가 이 여행을 받는 중이면 끝날 때까지 기다림 (보낼 변경 목록을 두 곳에서 고치지 않게)
  markOpen(params.id);
  await whenIdle(params.id);
  const store = new TripStore(params.id, user?.id, { readOnly: admin });
  try {
    await store.start();
  } catch (e) {
    toast(errorText(e), 'error');
  }
  if (!store.trip) {
    // 오프라인 · 로그인 확인 전이면 "볼 수 없음"이 아니라 아직 못 받은 것
    const notYet = !navigator.onLine || store.status === 'offline';
    setHTML(app, html`<main class="p-6 text-center mt-20 space-y-3" style="margin-top:calc(5rem + var(--sat))">
      <p class="text-sm text-slate-300">${admin ? (notYet ? '관리자 보기는 인터넷에 연결된 상태에서만 열 수 있어요.' : '이 여행을 불러오지 못했어요. 관리자 계정인지 확인해 주세요.')
        : notYet ? '이 여행은 이 기기에 아직 저장되지 않았어요.' : '이 여행을 볼 수 없습니다. 초대 링크로 다시 참여해 주세요.'}</p>
      ${notYet && !admin ? html`<p class="text-[11px] text-slate-500">인터넷에 연결된 뒤 다시 열어 주세요.</p>` : ''}
      <button data-action="home" class="btn-ghost">${admin ? '관리자 화면으로' : '홈으로'}</button></main>`);
    store.destroy(); markClosed(params.id);
    return { cleanup: delegate(app, { home: () => navigate(admin ? '/admin' : '/') }) };
  }

  // 관리자 보기는 "최근 활동"을 바꾸지 않음
  if (!admin) rpc('touch_trip', { p_trip: params.id }).catch(() => {});

  setHTML(app, html`
    <!-- 한 줄 헤더: ← 이름 · D-18      [환율] ● -->
    <header class="px-2 flex items-center gap-1 glass-nav sticky top-0 z-40" style="height:calc(2.75rem + var(--sat)); padding-top:var(--sat)">
      <button data-action="home" class="w-8 h-8 rounded-lg text-slate-400 hover:text-white flex-shrink-0"><i class="fa-solid fa-chevron-left"></i></button>
      <h1 class="flex-1 min-w-0 truncate text-sm font-black text-white">
        ${admin ? html`<span class="mr-1 align-middle text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-black"><i class="fa-solid fa-user-shield mr-0.5"></i>관리자 보기</span>` : ''}
        <span id="trip-title"></span><span id="trip-sub" class="ml-1.5 text-[11px] font-bold font-mono text-neon-cyan"></span></h1>
      <button data-action="fx" id="btn-fx" class="hidden w-8 h-8 rounded-lg text-emerald-300 flex-shrink-0" title="환율 계산"><i class="fa-solid fa-calculator text-sm"></i></button>
      <button data-action="sync-info" id="sync-dot" class="h-8 min-w-8 px-1.5 rounded-lg flex items-center justify-center gap-1 flex-shrink-0" title="동기화 상태">
        <span id="sync-dot-c" class="w-2.5 h-2.5 rounded-full"></span><span id="sync-count" class="text-[10px] font-mono font-bold text-amber-300"></span>
      </button>
    </header>
    <div id="photo-notice"></div>
    <section id="tab-root" class="flex-1 flex flex-col" style="padding-bottom:calc(3.5rem + var(--sab))"></section>
    <nav class="glass-nav fixed bottom-0 left-0 right-0 max-w-md mx-auto flex items-center justify-around px-1 z-40" style="height:calc(3.5rem + var(--sab)); padding-bottom:var(--sab)">
      ${tabs.map((t) => html`
        <button data-action="tab" data-tab="${t.key}" class="tab-btn flex flex-col items-center gap-0.5 py-1 text-slate-400 transition">
          <i class="fa-solid ${t.icon} text-base"></i><span class="text-[10px]">${t.label}</span>
        </button>`)}
    </nav>
  `);

  const root = $('#tab-root', app);
  let active = null;   // { key, mod, instance }

  function renderHeader() {
    $('#trip-title', app).textContent = `${store.trip.cover_emoji || ''} ${store.trip.title}`.trim();
    const prog = tripProgress(store.trip, store.trip.timezone);
    $('#trip-sub', app).textContent = prog ? `· ${prog}` : '';
    const b = store.budget || {};
    $('#btn-fx', app).classList.toggle('hidden', !(b.local_currency && b.home_currency && b.local_currency !== b.home_currency && Number(b.rate) > 0));
    // 동기화: 점 하나 (초록 동기화됨 / 파랑 깜빡임 동기화 중 / 주황 오프라인 + 대기 건수 / 빨강 오류)
    const pending = store.pendingCount;
    const dot = { idle: 'bg-emerald-400', syncing: 'bg-neon-cyan animate-pulse', offline: 'bg-amber-400', error: 'bg-rose-500' };
    $('#sync-dot-c', app).className = `w-2.5 h-2.5 rounded-full ${dot[store.status] || dot.idle}`;
    $('#sync-count', app).textContent = pending ? String(pending) : '';
    // 사진 보관 기간 안내 (삭제 7일 전부터)
    const notice = admin ? null : photoNoticeHtml(store);
    const box = $('#photo-notice', app);
    const sig = notice ? notice.s : '';
    if (box.dataset.sig !== sig) { box.dataset.sig = sig; setHTML(box, notice || html``); }
  }

  async function showTab(key) {
    const tab = tabs.find((t) => t.key === key) || tabs[0];
    app.querySelectorAll('.tab-btn').forEach((b) => {
      const on = b.dataset.tab === tab.key;
      b.classList.toggle('text-neon-cyan', on);
      b.classList.toggle('font-bold', on);
      b.classList.toggle('text-slate-400', !on);
    });
    if (active?.key === tab.key) return;
    active?.instance?.destroy?.();
    root.replaceChildren();
    const mod = await tab.load();
    active = { key: tab.key, instance: mod.mount(root, store) };
    window.scrollTo(0, 0);
  }

  // 동기화 상태만 바뀐 알림(status)은 헤더만 갱신. 내용이 바뀐 경우에만 탭을 다시 그림
  const unsub = store.subscribe((_, kind) => {
    renderHeader();
    if (kind !== 'status') active?.instance?.update?.();
  });
  renderHeader();
  // 사진: 보관 일수 · 한도 단계 받아 두기, 기간이 지난 여행은 기기 캐시도 비움
  const onImageStatus = (e) => { if (e.detail?.tripId === params.id) renderHeader(); };
  window.addEventListener('app:image-status', onImageStatus);
  if (!admin) refreshStatus(params.id).finally(() => {
    purgeExpiredCache(store);
    // 출발 7일 전 ~ 여행 중이면 썸네일 · 문서 원본을 받아 둠 (오프라인 대비)
    const imgs = store.list('trip_images');
    if (imgs.length && prefetchWindow(store.trip, todayIn(store.trip.timezone))) prefetchTripImages(params.id, imgs).catch(() => {});
  });
  await showTab(params.tab || 'places');

  // 관리자 보기에서 고치려고 하면 (store 가 막고 알림) — 연달아 눌러도 한 번만
  let roAt = 0;
  const onReadOnly = () => {
    if (Date.now() - roAt < 1500) return;
    roAt = Date.now();
    toast('관리자 보기에서는 고칠 수 없어요. 읽기 전용이에요.', 'error');
  };
  if (admin) window.addEventListener('app:readonly', onReadOnly);

  const off = delegate(app, {
    home: () => {
      if (!admin) { backToHome(navigate); return; }
      let fromAdmin = false;
      try { fromAdmin = sessionStorage.getItem(FROM_ADMIN) === '1'; sessionStorage.removeItem(FROM_ADMIN); } catch { /* 무시 */ }
      if (fromAdmin && history.length > 1) history.back();
      else navigate('/admin', { replace: true });
    },
    'photo-save-all': () => saveAllPhotos(store),
    'photo-notice-close': () => { dismissPhotoNotice(store); renderHeader(); },
    fx: async () => { (await import('../components/fx-calc.js')).openFxCalc(store); },
    'sync-info': () => {
      const pending = store.pendingCount;
      const ago = store.lastSyncedAt ? Math.round((Date.now() - store.lastSyncedAt) / 60000) : null;
      const when = ago == null ? '' : ago < 1 ? ' · 방금' : ` · ${ago}분 전`;
      const text = {
        idle: `동기화됨${when}`,
        syncing: '동기화 중이에요.',
        offline: pending ? `오프라인 · 보낼 변경 ${pending}건. 온라인이 되면 자동으로 보내요.` : '오프라인이에요. 저장된 내용으로 볼 수 있어요.',
        error: '동기화 오류가 있어요. 잠시 후 다시 시도해요.',
      }[store.status] || '동기화됨';
      toast(text, store.status === 'error' ? 'error' : 'info');
      if (navigator.onLine) store.sync();
    },
    // 탭 전환은 기록을 쌓지 않음 → 뒤로가기 한 번이면 홈
    tab: (el) => navigate(`${base}/${el.dataset.tab}`, { replace: true }),
  });

  return {
    update: (p) => {
      if (p.id !== params.id) { location.reload(); return; }
      showTab(p.tab || 'places');
    },
    cleanup: () => {
      off(); unsub(); window.removeEventListener('app:image-status', onImageStatus);
      window.removeEventListener('app:readonly', onReadOnly);
      active?.instance?.destroy?.();
      store.destroy();
      markClosed(params.id);
    },
  };
}
