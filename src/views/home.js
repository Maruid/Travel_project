import { html, setHTML, delegate } from '../lib/dom.js';
import { ensureUser } from '../lib/auth.js';
import { rpc, errorText } from '../lib/supabase.js';
import { spinner, emptyCard, toast } from '../components/ui.js';
import { navigate } from '../router.js';

export async function render(app) {
  setHTML(app, spinner());

  let trips = [];
  try {
    await ensureUser();
    trips = await rpc('my_trips');
  } catch (e) {
    // 오프라인이면 캐시된 여행 목록이라도 보여줌
    trips = cachedTrips();
    if (!trips.length) toast(errorText(e), 'error');
  }

  setHTML(app, html`
    <header class="px-4 py-4 glass-nav sticky top-0 z-40 flex items-center justify-between">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-neon-cyan animate-pulse shadow-[0_0_8px_#00f2fe]"></span>
        <h1 class="text-sm font-black tracking-wide text-white">MY TRIPS</h1>
      </div>
      <button data-action="admin" class="text-[10px] text-slate-500 hover:text-slate-300">관리자</button>
    </header>

    <main class="flex-1 p-4 space-y-3">
      ${trips.length ? trips.map((t) => html`
        <button data-action="open" data-id="${t.trip_id}" class="w-full text-left glass-card p-4 rounded-2xl flex items-center gap-3 hover:border-slate-500 transition">
          <span class="text-2xl">${t.cover_emoji || '✈️'}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <h2 class="font-extrabold text-white text-sm truncate">${t.title}</h2>
              ${t.my_role === 'owner' ? html`<span class="text-[9px] px-1.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">owner</span>` : ''}
            </div>
            <p class="text-[11px] text-slate-400 font-mono">${t.destination || ''} ${t.start_date ? `· ${t.start_date} ~ ${t.end_date || ''}` : ''}</p>
          </div>
          <span class="text-[10px] text-slate-500">${t.member_count ?? ''}명</span>
        </button>`)
      : emptyCard('참여 중인 여행이 없습니다. 초대 링크로 들어오거나 생성 코드로 새 여행을 만드세요.')}

      <button data-action="create" class="btn-primary flex items-center justify-center gap-1.5">
        <i class="fa-solid fa-plus"></i> 생성 코드로 새 여행 만들기
      </button>
    </main>
  `);

  const off = delegate(app, {
    open: (el) => navigate(`/trip/${el.dataset.id}/places`),
    create: () => navigate('/create'),
    admin: () => navigate('/admin'),
  });
  return { cleanup: off };
}

function cachedTrips() {
  const out = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith('trip-cache:v1:')) continue;
    try {
      const c = JSON.parse(localStorage.getItem(k));
      if (c?.trip) out.push({ trip_id: c.trip.id, title: c.trip.title, destination: c.trip.destination,
        start_date: c.trip.start_date, end_date: c.trip.end_date, cover_emoji: c.trip.cover_emoji });
    } catch {}
  }
  return out;
}
