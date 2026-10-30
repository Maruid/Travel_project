import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { ensureUser } from '../lib/auth.js';
import { rpc, errorText } from '../lib/supabase.js';
import { TripStore } from '../lib/store.js';
import { spinner, toast } from '../components/ui.js';
import { navigate } from '../router.js';

const TABS = [
  { key: 'places',   label: '장소',   icon: 'fa-map-location-dot', load: () => import('./tabs/places.js') },
  { key: 'schedule', label: '일정',   icon: 'fa-calendar-day',     load: () => import('./tabs/schedule.js') },
  { key: 'guides',   label: '가이드', icon: 'fa-lightbulb',        load: () => import('./tabs/guides.js') },
  { key: 'budget',   label: '가계부', icon: 'fa-wallet',           load: () => import('./tabs/budget.js') },
  { key: 'todos',    label: '투두',   icon: 'fa-list-check',       load: () => import('./tabs/todos.js') },
  { key: 'more',     label: '멤버',   icon: 'fa-users',            load: () => import('./tabs/more.js') },
];

export async function render(app, params) {
  setHTML(app, spinner());

  let user;
  try { user = await ensureUser(); } catch (e) { toast(errorText(e), 'error'); }

  const store = new TripStore(params.id, user?.id);
  try {
    await store.start();
  } catch (e) {
    toast(errorText(e), 'error');
  }
  if (!store.trip) {
    setHTML(app, html`<main class="p-6 text-center mt-20 space-y-3">
      <p class="text-sm text-slate-300">이 여행을 볼 수 없습니다. 초대 링크로 다시 참여해 주세요.</p>
      <button data-action="home" class="btn-ghost">홈으로</button></main>`);
    return { cleanup: delegate(app, { home: () => navigate('/') }) };
  }

  rpc('touch_trip', { p_trip: params.id }).catch(() => {});

  setHTML(app, html`
    <header class="px-4 py-3 flex items-center justify-between glass-nav sticky top-0 z-40">
      <div class="flex items-center gap-2 min-w-0">
        <button data-action="home" class="w-7 h-7 rounded-lg text-slate-400 hover:text-white flex-shrink-0"><i class="fa-solid fa-chevron-left"></i></button>
        <div class="min-w-0">
          <h1 id="trip-title" class="text-sm font-black tracking-wide text-white truncate"></h1>
          <p id="trip-sub" class="text-[10px] text-slate-400 font-mono truncate"></p>
        </div>
      </div>
      <span id="sync-badge" class="text-[10px] px-2 py-1 rounded-xl glass-card font-mono font-bold flex-shrink-0"></span>
    </header>
    <section id="tab-root" class="flex-1 flex flex-col pb-20"></section>
    <nav class="glass-nav fixed bottom-0 left-0 right-0 max-w-md mx-auto h-16 flex items-center justify-around px-1 z-40">
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
    $('#trip-sub', app).textContent = [store.trip.destination, store.trip.start_date && `${store.trip.start_date} ~ ${store.trip.end_date || ''}`]
      .filter(Boolean).join(' · ');
    const badge = $('#sync-badge', app);
    const pending = store.pendingCount;
    const map = {
      idle: ['동기화됨', 'text-emerald-300'],
      syncing: ['동기화 중', 'text-neon-cyan'],
      offline: [pending ? `오프라인 · 대기 ${pending}` : '오프라인', 'text-amber-300'],
      error: ['동기화 오류', 'text-rose-300'],
    };
    const [text, cls] = map[store.status] || map.idle;
    badge.className = `text-[10px] px-2 py-1 rounded-xl glass-card font-mono font-bold flex-shrink-0 ${cls}`;
    badge.textContent = text;
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

  const unsub = store.subscribe(() => {
    renderHeader();
    active?.instance?.update?.();
  });
  renderHeader();
  await showTab(params.tab || 'places');

  const off = delegate(app, {
    home: () => navigate('/'),
    tab: (el) => navigate(`/trip/${params.id}/${el.dataset.tab}`),
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
    },
  };
}
