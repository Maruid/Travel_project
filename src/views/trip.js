import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { ensureUser } from '../lib/auth.js';
import { rpc, errorText } from '../lib/supabase.js';
import { TripStore } from '../lib/store.js';
import { spinner, toast } from '../components/ui.js';
import { navigate } from '../router.js';
import { tripProgress } from '../lib/format.js';
import { backToHome } from '../lib/back-nav.js';
import { whenIdle, markOpen, markClosed } from '../lib/prefetch.js';

const TABS = [
  { key: 'places',   label: '장소',   icon: 'fa-map-location-dot', load: () => import('./tabs/places.js') },
  { key: 'schedule', label: '일정',   icon: 'fa-calendar-day',     load: () => import('./tabs/schedule.js') },
  { key: 'guides',   label: '가이드', icon: 'fa-lightbulb',        load: () => import('./tabs/guides.js') },
  { key: 'budget',   label: '가계부', icon: 'fa-wallet',           load: () => import('./tabs/budget.js') },
  { key: 'todos',    label: '할 일',  icon: 'fa-list-check',       load: () => import('./tabs/todos.js') },
  { key: 'more',     label: '설정',   icon: 'fa-gear',            load: () => import('./tabs/more.js') },
];

export async function render(app, params) {
  setHTML(app, spinner());

  let user;
  try { user = await ensureUser(); } catch (e) { toast(errorText(e), 'error'); }

  // 자동 미리 받기가 이 여행을 받는 중이면 끝날 때까지 기다림 (보낼 변경 목록을 두 곳에서 고치지 않게)
  markOpen(params.id);
  await whenIdle(params.id);
  const store = new TripStore(params.id, user?.id);
  try {
    await store.start();
  } catch (e) {
    toast(errorText(e), 'error');
  }
  if (!store.trip) {
    // 오프라인 · 로그인 확인 전이면 "볼 수 없음"이 아니라 아직 못 받은 것
    const notYet = !navigator.onLine || store.status === 'offline';
    setHTML(app, html`<main class="p-6 text-center mt-20 space-y-3">
      <p class="text-sm text-slate-300">${notYet ? '이 여행은 이 기기에 아직 저장되지 않았어요.' : '이 여행을 볼 수 없습니다. 초대 링크로 다시 참여해 주세요.'}</p>
      ${notYet ? html`<p class="text-[11px] text-slate-500">인터넷에 연결된 뒤 다시 열어 주세요.</p>` : ''}
      <button data-action="home" class="btn-ghost">홈으로</button></main>`);
    store.destroy(); markClosed(params.id);
    return { cleanup: delegate(app, { home: () => navigate('/') }) };
  }

  rpc('touch_trip', { p_trip: params.id }).catch(() => {});

  setHTML(app, html`
    <!-- 한 줄 헤더: ← 이름 · D-18      [환율] ● -->
    <header class="px-2 flex items-center gap-1 glass-nav sticky top-0 z-40" style="height:calc(2.75rem + var(--sat)); padding-top:var(--sat)">
      <button data-action="home" class="w-8 h-8 rounded-lg text-slate-400 hover:text-white flex-shrink-0"><i class="fa-solid fa-chevron-left"></i></button>
      <h1 class="flex-1 min-w-0 truncate text-sm font-black text-white">
        <span id="trip-title"></span><span id="trip-sub" class="ml-1.5 text-[11px] font-bold font-mono text-neon-cyan"></span></h1>
      <button data-action="fx" id="btn-fx" class="hidden w-8 h-8 rounded-lg text-emerald-300 flex-shrink-0" title="환율 계산"><i class="fa-solid fa-calculator text-sm"></i></button>
      <button data-action="sync-info" id="sync-dot" class="h-8 min-w-8 px-1.5 rounded-lg flex items-center justify-center gap-1 flex-shrink-0" title="동기화 상태">
        <span id="sync-dot-c" class="w-2.5 h-2.5 rounded-full"></span><span id="sync-count" class="text-[10px] font-mono font-bold text-amber-300"></span>
      </button>
    </header>
    <section id="tab-root" class="flex-1 flex flex-col" style="padding-bottom:calc(3.5rem + var(--sab))"></section>
    <nav class="glass-nav fixed bottom-0 left-0 right-0 max-w-md mx-auto flex items-center justify-around px-1 z-40" style="height:calc(3.5rem + var(--sab)); padding-bottom:var(--sab)">
      ${TABS.map((t) => html`
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
  }

  async function showTab(key) {
    const tab = TABS.find((t) => t.key === key) || TABS[0];
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
  await showTab(params.tab || 'places');

  const off = delegate(app, {
    home: () => backToHome(navigate),
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
    tab: (el) => navigate(`/trip/${params.id}/${el.dataset.tab}`, { replace: true }),
  });

  return {
    update: (p) => {
      if (p.id !== params.id) { location.reload(); return; }
      showTab(p.tab || 'places');
    },
    cleanup: () => {
      off(); unsub();
      active?.instance?.destroy?.();
      store.destroy();
      markClosed(params.id);
    },
  };
}
