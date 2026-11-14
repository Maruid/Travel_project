import { html, setHTML, delegate } from '../lib/dom.js';
import { ensureUser, getUser } from '../lib/auth.js';
import { accountChip, startGoogleLogin, openAccountMenu, openDeviceCodeEntry } from '../components/account.js';
import { rpc, errorText } from '../lib/supabase.js';
import { spinner, emptyCard, toast, openSheet } from '../components/ui.js';
import { navigate } from '../router.js';
import { markFromHome } from '../lib/back-nav.js';
import { loadTripList, saveTripList, tripsFromCaches, readSyncIndex, hasCache, agoText } from '../lib/offline.js';
import { onConnectionChange } from '../lib/net.js';
import { schedulePrefetch } from '../lib/prefetch.js';
import { isApp } from '../lib/native.js';
import { parseAppLink } from '../lib/app-link.js';

const WELCOME_KEY = 'app:welcomedAt';
const welcomed = () => { try { return !!localStorage.getItem(WELCOME_KEY); } catch { return true; } };
import { installBannerHtml, promptInstall, dismissBanner } from '../lib/install.js';

export async function render(app) {
  // 1) 기기에 저장된 목록부터 바로 그림 (오프라인이면 서버에 묻지 않음 · 온라인이면 받는 동안 보여줌)
  setHTML(app, spinner());
  let user = await getUser();   // 오프라인이면 즉시, 온라인이면 최대 3초
  const saved = user ? loadTripList(user.id) : null;
  let trips = saved?.trips ?? (user ? tripsFromCaches(user.id) : []);
  let listAt = saved?.at ?? null;
  let fresh = false;        // 이번에 서버에서 받은 목록인지
  let failed = false;       // 온라인인데 서버에 못 닿음
  let refreshing = null;
  let retryTimer = null;    // 약한 신호: 연결 표시는 그대로인데 서버 확인이 안 될 때 20초마다 조용히 재시도

  setHTML(app, html`
    <header class="px-4 py-4 glass-nav sticky top-0 z-40 flex items-center justify-between" style="padding-top:calc(1rem + var(--sat))">
      <div class="flex items-center gap-2">
        <span class="w-2.5 h-2.5 rounded-full bg-neon-cyan animate-pulse shadow-[0_0_8px_#00f2fe]"></span>
        <h1 class="text-sm font-black tracking-wide text-white">MY TRIPS</h1>
      </div>
      <div class="flex items-center gap-2">
        <span id="chip-slot"></span>
        <button data-action="admin" class="text-[10px] text-slate-500 hover:text-slate-300">관리자</button>
      </div>
    </header>

    <main class="flex-1 p-4 space-y-3">
      <div id="net-slot"></div>
      <div id="welcome-slot"></div>
      <div id="install-slot">${installBannerHtml()}</div>
      <div id="list-slot" class="space-y-3"></div>

      <button data-action="create" class="btn-primary flex items-center justify-center gap-1.5">
        <i class="fa-solid fa-plus"></i> 생성 코드로 새 여행 만들기
      </button>

      <div id="login-slot"></div>
    </main>
  `);

  let alive = true;
  const slot = (id) => app.querySelector(id);

  function drawNet() {
    const offline = !navigator.onLine;
    const when = agoText(listAt);
    let body = '';
    if (offline) {
      body = html`<div class="glass-card rounded-2xl px-3 py-2.5 flex items-center gap-2 border border-amber-500/30">
        <i class="fa-solid fa-plane text-amber-300"></i>
        <span class="flex-1 text-[11px] text-amber-100">오프라인 · ${when ? `${when} 받은 내용이에요` : '이 기기에 저장된 내용이에요'}</span></div>`;
    } else if (failed && !fresh) {
      body = html`<div class="glass-card rounded-2xl px-3 py-2.5 flex items-center gap-2 border border-amber-500/30">
        <i class="fa-solid fa-wifi text-amber-300"></i>
        <span class="flex-1 text-[11px] text-amber-100">서버에 연결하지 못했어요${when ? ` · ${when} 받은 목록` : ''}</span>
        <button data-action="retry" class="text-[11px] font-bold text-neon-cyan px-2">다시 시도</button></div>`;
    }
    setHTML(slot('#net-slot'), body || html``);
  }

  function drawChip() { setHTML(slot('#chip-slot'), accountChip(user)); }

  function drawList() {
    const el = slot('#list-slot');
    if (!trips.length) {
      setHTML(el, navigator.onLine && !fresh && !failed ? spinner() : emptyCard(navigator.onLine
        ? '참여 중인 여행이 없습니다. 초대 링크로 들어오거나 생성 코드로 새 여행을 만드세요.'
        : '이 기기에 저장된 여행이 없어요. 인터넷에 연결된 뒤 다시 열어 주세요.'));
      return;
    }
    const showSaved = !navigator.onLine || !fresh;   // 최신 목록이 아닐 때만 "언제 받은 내용"을 보여줌
    const idx = readSyncIndex();
    setHTML(el, html`${trips.map((t) => {
      const cached = hasCache(t.trip_id);
      const locked = !navigator.onLine && !cached;
      const at = idx[t.trip_id]?.at;
      const note = !showSaved ? '' : cached ? (at ? `저장됨 · ${agoText(at)}` : '저장됨') : '이 기기에 아직 저장되지 않았어요';
      return html`
        <button data-action="${locked ? 'open-locked' : 'open'}" data-id="${t.trip_id}" class="w-full text-left glass-card p-4 rounded-2xl flex items-center gap-3 hover:border-slate-500 transition ${locked ? 'opacity-50' : ''}">
          <span class="text-2xl">${t.cover_emoji || '✈️'}</span>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <h2 class="font-extrabold text-white text-sm truncate">${t.title}</h2>
              ${t.my_role === 'owner' ? html`<span class="text-[9px] px-1.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-bold">owner</span>` : ''}
            </div>
            <p class="text-[11px] text-slate-400 font-mono">${t.destination || ''} ${t.start_date ? `· ${t.start_date} ~ ${t.end_date || ''}` : ''}</p>
            ${note ? html`<p class="text-[10px] mt-0.5 ${cached ? 'text-slate-500' : 'text-amber-300/80'}"><i class="fa-solid ${cached ? 'fa-circle-check' : 'fa-cloud-arrow-down'} mr-1"></i>${note}</p>` : ''}
          </div>
          <span class="text-[10px] text-slate-500">${t.member_count != null ? `${t.member_count}명` : ''}</span>
        </button>`;
    })}`);
  }

  // 오프라인에서는 로그인 안내를 숨김 (눌러도 Google 로 갈 수 없음)
  function drawLogin() {
    setHTML(slot('#login-slot'), navigator.onLine && !user?.offline ? html`
      <div class="glass-card p-4 rounded-2xl space-y-2">
        <p class="text-xs font-bold text-slate-300"><i class="fa-solid fa-mobile-screen-button text-neon-cyan mr-1"></i>다른 기기에서 쓰던 여행이 안 보이나요?</p>
        <p class="text-[10px] text-slate-500 leading-relaxed">Google 로 쓰고 있었다면 오른쪽 위 로그인을, 로그인 없이 쓰고 있었다면 기존 기기에서 받은 기기 추가 코드를 입력하세요.</p>
        <div class="grid grid-cols-2 gap-2">
          <button data-action="account-login" class="btn-ghost py-2"><i class="fa-brands fa-google mr-1"></i>Google 로그인</button>
          <button data-action="device-code" class="btn-ghost py-2"><i class="fa-solid fa-key mr-1"></i>기기 추가 코드</button>
          ${isApp() ? html`<button data-action="paste-link" class="btn-ghost py-2 col-span-2"><i class="fa-solid fa-link mr-1"></i>초대 링크로 참여</button>` : ''}
        </div>
      </div>` : html``);
  }

  // 안드로이드 앱 처음 실행: 앱은 크롬과 저장소가 따로라 "새 기기"로 보임 → 옮겨 오는 방법 안내
  function drawWelcome() {
    const show = isApp() && !welcomed() && navigator.onLine;
    setHTML(slot('#welcome-slot'), show ? html`
      <div class="glass-card p-4 rounded-2xl space-y-2 border border-neon-cyan/40">
        <div class="flex items-start gap-2">
          <p class="flex-1 text-xs font-bold text-white"><i class="fa-solid fa-hand-sparkles text-neon-cyan mr-1"></i>앱에 오신 걸 환영해요</p>
          <button data-action="welcome-close" class="w-6 h-6 -mt-1 text-slate-400" title="닫기"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <p class="text-[11px] text-slate-400 leading-relaxed">앱은 크롬과 저장 공간이 따로라, 크롬에서 쓰던 여행은 아래 방법으로 이어서 쓸 수 있어요.</p>
        <ul class="text-[11px] text-slate-300 space-y-1 leading-relaxed">
          <li><b class="text-white">Google 로 쓰고 있었다면</b> → Google 로그인</li>
          <li><b class="text-white">로그인 없이 쓰고 있었다면</b> → 크롬의 설정 탭 → "다른 기기에서도 쓰기"에서 코드를 받아 기기 추가 코드에 입력</li>
          <li><b class="text-white">처음이라면</b> → 받은 초대 링크를 붙여 넣기</li>
        </ul>
        <div class="grid grid-cols-3 gap-1.5">
          <button data-action="account-login" class="btn-ghost py-2 text-[11px]"><i class="fa-brands fa-google mr-1"></i>로그인</button>
          <button data-action="device-code" class="btn-ghost py-2 text-[11px]"><i class="fa-solid fa-key mr-1"></i>기기 코드</button>
          <button data-action="paste-link" class="btn-ghost py-2 text-[11px]"><i class="fa-solid fa-link mr-1"></i>초대 링크</button>
        </div>
      </div>` : html``);
  }

  const drawAll = () => { if (!alive || !slot('#list-slot')) return; drawNet(); drawWelcome(); drawChip(); drawList(); drawLogin(); };

  // 2) 서버에서 최신 목록 받기 (로그인 확인이 된 경우에만: 확인 전에 물으면 빈 목록이 와서 저장된 목록을 지움)
  async function refresh({ quiet = false, recheck = true } = {}) {
    if (refreshing) return refreshing;
    clearTimeout(retryTimer);
    if (!navigator.onLine) { drawAll(); return; }
    refreshing = (async () => {
      try {
        // 방금 확인에 실패했으면(첫 화면) 3초를 또 기다리지 않음
        if (!recheck && user?.offline) throw new Error('OFFLINE');
        user = await ensureUser();
        if (user.offline) throw new Error('OFFLINE');
        const rows = await rpc('my_trips');
        trips = rows; listAt = Date.now(); fresh = true; failed = false;
        saveTripList(user.id, rows, listAt);
        schedulePrefetch();
      } catch (e) {
        failed = true;
        if (!trips.length && !quiet && navigator.onLine && e?.message !== 'OFFLINE') toast(errorText(e), 'error');
        if (navigator.onLine && app.isConnected) retryTimer = setTimeout(() => refresh({ quiet: true }), 20000);
      }
    })().finally(() => { refreshing = null; drawAll(); });
    if (alive) drawList();
    return refreshing;
  }

  drawAll();
  refresh({ recheck: false });

  const off = delegate(app, {
    open: (el) => { markFromHome(); navigate(`/trip/${el.dataset.id}/places`); },
    'open-locked': () => toast('이 여행은 이 기기에 아직 저장되지 않았어요. 인터넷에 연결된 뒤 한 번 열어 주세요.'),
    retry: () => refresh(),
    install: async () => {
      const r = await promptInstall();
      if (r === 'accepted') toast('설치했어요. 홈 화면의 앱 아이콘으로 열어 주세요.');
      refreshInstall();
    },
    'install-dismiss': () => { dismissBanner(); refreshInstall(); },
    create: () => navigate('/create'),
    admin: () => navigate('/admin'),
    'account-login': () => startGoogleLogin({ hasLocalTrips: trips.length > 0 }),
    'account-menu': async () => openAccountMenu(await getUser()),
    'account-offline': () => toast(navigator.onLine ? '로그인 상태를 확인하는 중이에요. 잠시 후 다시 눌러 주세요.' : '오프라인이에요. 계정 메뉴는 인터넷에 연결된 뒤 쓸 수 있어요.'),
    'device-code': () => openDeviceCodeEntry(),
    'paste-link': () => openLinkEntry(),
    'welcome-close': () => {
      try { localStorage.setItem(WELCOME_KEY, String(Date.now())); } catch {}
      drawWelcome();
    },
  });
  // 설치 가능 신호가 늦게 오거나 설치가 끝나면 띠만 다시 그림
  function refreshInstall() {
    const el = app.querySelector('#install-slot');
    if (el) setHTML(el, installBannerHtml());
  }
  // 연결이 바뀌면(흔들림 걸러서) 표시를 바꾸고, 다시 연결되면 목록 · 계정 자동 갱신 (열린 입력 창은 건드리지 않음)
  const offNet = onConnectionChange((online) => {
    if (online) { fresh = false; refresh({ quiet: true }); }
    else { getUser().then((u) => { user = u || user; drawAll(); }); }
  });
  // 미리 받기가 끝나면 "저장됨 · n분 전" 갱신
  const onSynced = () => { if (alive) drawList(); };
  // 앱으로 돌아왔을 때 목록이 5분 넘게 지났으면 조용히 새로 받음
  const onVisible = () => {
    if (document.visibilityState === 'visible' && navigator.onLine && (!listAt || Date.now() - listAt > 5 * 60 * 1000)) refresh({ quiet: true });
  };
  window.addEventListener('app:installable', refreshInstall);
  window.addEventListener('app:trips-synced', onSynced);
  document.addEventListener('visibilitychange', onVisible);
  return { cleanup: () => {
    alive = false;
    off(); offNet(); clearTimeout(retryTimer);
    window.removeEventListener('app:installable', refreshInstall);
    window.removeEventListener('app:trips-synced', onSynced);
    document.removeEventListener('visibilitychange', onVisible);
  } };
}

// 앱에서 초대 · 보기 전용 링크 붙여넣기 → 그 화면으로 (앱은 링크를 눌러도 크롬이 열리므로)
function openLinkEntry() {
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">초대 링크로 참여</h3>
    <p class="text-[11px] text-slate-400 mb-3 leading-relaxed">받은 초대 링크(또는 보기 전용 링크)를 통째로 붙여 넣으세요. 메시지 글과 섞여 있어도 돼요.</p>
    <form id="link-form" class="space-y-2.5">
      <textarea name="link" rows="3" class="input text-xs" placeholder="https://maruid.github.io/Travel_project/#/join/…" required></textarea>
      <button class="btn-primary">열기</button>
    </form>`, (el) => {
    const form = el.querySelector('#link-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const path = parseAppLink(form.elements.link.value);
      if (!path) { toast('초대 링크를 찾지 못했어요. 링크 전체를 붙여 넣어 주세요.', 'error'); return; }
      navigate(path);   // 시트는 화면 이동과 함께 닫힘 (closeSheet 를 먼저 부르면 뒤로가기가 이동을 되돌림)
    });
  });
}
