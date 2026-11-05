// 보기 전용 공유 화면: #/view/:token  (migration_011 view_trip)
//  - 로그인 없이 열림 (익명 로그인도 하지 않음)
//  - 일정 · 장소(목록 + 지도) · 가이드만. 가계부 · 할 일 · 멤버는 서버가 보내지 않음
//  - 열 때마다 최신 내용을 받아옴 (기기에 저장하지 않음)
import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { rpc, errorText } from '../lib/supabase.js';
import { spinner, openSheet } from '../components/ui.js';
import { tripProgress, priceRange, walkInfo } from '../lib/format.js';
import { color, icon } from '../lib/safe.js';

const TABS = [
  { key: 'schedule', label: '일정', icon: 'fa-calendar-day' },
  { key: 'places', label: '장소', icon: 'fa-map-location-dot' },
  { key: 'guides', label: '가이드', icon: 'fa-lightbulb' },
];

// 일정 · 가이드 탭이 쓰는 store 와 같은 모양의 읽기 전용 데이터
export class ViewStore {
  constructor(d) {
    this.trip = d.trip || {};
    this.budget = null;
    this.tripId = null;
    this.globalCategories = d.categories || [];
    this.tables = {
      places: d.places || [], itinerary_days: d.itinerary_days || [], itinerary_items: d.itinerary_items || [],
      guides: d.guides || [], categories: [], place_likes: [],
    };
  }
  list(table) {
    return [...(this.tables[table] || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      || String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  }
  get(table, id) { return id ? (this.tables[table] || []).find((r) => r.id === id) || null : null; }
  categories() { return this.globalCategories; }
  category(id) { return this.globalCategories.find((c) => c.id === id) || null; }
  likeMap() { return new Map(); }
  get me() { return null; }
}

export async function render(app, params) {
  setHTML(app, spinner());
  let data;
  try {
    data = await rpc('view_trip', { p_token: params.token });
  } catch (e) {
    const offline = !navigator.onLine;
    setHTML(app, html`<main class="p-6 text-center mt-20 space-y-3">
      <i class="fa-solid ${offline ? 'fa-wifi' : 'fa-link-slash'} text-2xl text-slate-500"></i>
      <p class="text-sm text-slate-300">${offline ? '인터넷에 연결되어 있지 않아요.' : '이 링크는 꺼졌거나 바뀌었어요.'}</p>
      <p class="text-[11px] text-slate-500">${offline ? '연결된 뒤 다시 열어 주세요.' : '링크를 보낸 사람에게 새 링크를 받아 주세요.'}</p>
      ${offline ? html`<button data-action="reload" class="btn-ghost">다시 시도</button>` : ''}</main>`);
    if (!offline) console.warn(errorText(e));
    return { cleanup: delegate(app, { reload: () => location.reload() }) };
  }

  const store = new ViewStore(data);
  const prog = tripProgress(store.trip, store.trip.timezone);
  document.title = `${store.trip.title} · 일정`;

  setHTML(app, html`
    <header class="px-3 h-11 flex items-center gap-2 glass-nav sticky top-0 z-40">
      <h1 class="flex-1 min-w-0 truncate text-sm font-black text-white">
        ${`${store.trip.cover_emoji || ''} ${store.trip.title}`.trim()}${prog ? html`<span class="ml-1.5 text-[11px] font-bold font-mono text-neon-cyan">· ${prog}</span>` : ''}</h1>
      <span class="flex-shrink-0 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/10"><i class="fa-solid fa-eye mr-1"></i>보기 전용</span>
      <button data-action="reload" class="w-8 h-8 rounded-lg text-slate-400 flex-shrink-0" title="새로고침"><i class="fa-solid fa-rotate-right text-sm"></i></button>
    </header>
    <section id="tab-root" class="flex-1 flex flex-col" style="padding-bottom:calc(3.5rem + env(safe-area-inset-bottom))"></section>
    <nav class="glass-nav fixed bottom-0 left-0 right-0 max-w-md mx-auto flex items-center justify-around px-1 z-40" style="height:calc(3.5rem + env(safe-area-inset-bottom)); padding-bottom:env(safe-area-inset-bottom)">
      ${TABS.map((t) => html`
        <button data-action="tab" data-tab="${t.key}" class="tab-btn flex flex-col items-center gap-0.5 py-1 px-4 text-slate-400 transition">
          <i class="fa-solid ${t.icon} text-base"></i><span class="text-[10px]">${t.label}</span>
        </button>`)}
    </nav>`);

  const root = $('#tab-root', app);
  let active = null;
  const openPlace = (id) => openViewPlace(store, id);

  async function showTab(key) {
    const tab = TABS.find((t) => t.key === key) || TABS[0];
    app.querySelectorAll('.tab-btn').forEach((b) => {
      const on = b.dataset.tab === tab.key;
      b.classList.toggle('text-neon-cyan', on); b.classList.toggle('font-bold', on); b.classList.toggle('text-slate-400', !on);
    });
    if (active?.key === tab.key) return;
    active?.instance?.destroy?.();
    root.replaceChildren();
    let instance;
    if (tab.key === 'schedule') instance = (await import('./tabs/schedule.js')).mount(root, store, { readOnly: true, onPlace: openPlace });
    else if (tab.key === 'guides') instance = (await import('./tabs/guides.js')).mount(root, store, { readOnly: true });
    else instance = await mountPlaces(root, store, openPlace);
    active = { key: tab.key, instance };
    window.scrollTo(0, 0);
  }
  await showTab('schedule');

  const off = delegate(app, {
    tab: (el) => showTab(el.dataset.tab),
    reload: () => location.reload(),
  });
  return { cleanup: () => { off(); active?.instance?.destroy?.(); } };
}

// 장소 상세 (읽기 전용)
async function openViewPlace(store, id) {
  const p = store.get('places', id);
  if (!p) return;
  const { placeBadges, googleBlock, googleMapsHref } = await import('./tabs/places.js');
  const cat = store.category(p.category_id);
  openSheet(html`
    <div class="flex items-center gap-1.5 flex-wrap mb-1">${placeBadges(p, cat, store.trip.timezone)}</div>
    <h3 class="text-lg font-black text-white mt-1">${p.name}</h3>
    <div class="flex items-center justify-between text-xs text-slate-400 mb-3">
      <span>${p.zone || ''}</span><span class="font-mono text-emerald-400 font-bold">${priceRange(p)}</span>
    </div>
    ${googleBlock(p, store.trip.timezone)}
    <div class="space-y-2 text-xs">
      ${p.signature ? html`<div class="p-3 rounded-2xl glass-card"><span class="text-[10px] font-bold text-slate-400 block mb-0.5">대표 메뉴 & 볼거리</span><p class="font-bold text-white">${p.signature}</p></div>` : ''}
      ${p.description ? html`<div class="p-3 rounded-2xl glass-card"><span class="text-[10px] font-bold text-slate-400 block mb-0.5">상세 안내</span><p class="text-slate-300 leading-relaxed whitespace-pre-line">${p.description}</p></div>` : ''}
      ${p.visit_tip ? html`<div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30"><span class="text-[10px] font-bold text-amber-400 block mb-0.5">웨이팅 / 방문 팁</span><p class="text-amber-200 font-medium">${p.visit_tip}</p></div>` : ''}
    </div>
    <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" class="btn-primary mt-3 flex items-center justify-center gap-1.5">
      <i class="fa-solid fa-diamond-turn-right"></i> 구글 맵에서 보기</a>`);
}

// 장소 탭 (읽기 전용): 위 지도 + 아래 목록, 카테고리 칩으로 거르기
async function mountPlaces(root, store, openPlace) {
  const { loadMapLib, googleMapsHref } = await import('./tabs/places.js');
  const state = { cat: 'all', selectedId: null };
  const places = () => store.list('places').filter((p) => state.cat === 'all' || p.category_id === state.cat)
    .sort((a, b) => (!!b.is_anchor - !!a.is_anchor) || String(a.name).localeCompare(String(b.name), 'ko'));
  setHTML(root, html`
    <div id="v-map" class="w-full h-[38vh] min-h-[180px] flex-shrink-0 z-10 relative">
      <div id="v-map-loading" class="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500"><i class="fa-solid fa-map mr-1.5"></i>지도 불러오는 중...</div>
    </div>
    <div class="p-3 space-y-2">
      <div id="v-chips" class="flex gap-1.5 overflow-x-auto no-scrollbar pb-1"></div>
      <div id="v-list" class="space-y-2"></div>
    </div>`);

  let map = null; let layer = null; let lib = null; let destroyed = false;
  const anchor = store.list('places').find((p) => p.is_anchor && p.lat != null);

  function drawMarkers(rows) {
    if (!map) return;
    layer.clearLayers();
    const z = map.getZoom();
    for (const p of rows) {
      if (p.lat == null) continue;
      const cat = store.category(p.category_id);
      const selected = p.id === state.selectedId;
      const size = lib.pinSize(z, { selected, anchor: p.is_anchor, visited: false });
      const m = lib.L.marker([p.lat, p.lng], {
        icon: lib.pinIcon({ color: cat?.color, icon: cat?.icon, size, dot: z <= 13 && !selected, pulse: selected }),
        zIndexOffset: selected ? 1000 : p.is_anchor ? 500 : 0,
      }).addTo(layer);
      if (selected) m.bindTooltip(lib.esc(p.name), { permanent: true, direction: 'top', offset: [0, -size / 2 - 2], className: 'pin-label' }).openTooltip();
      m.on('click', () => select(p.id, true));
    }
  }

  function render() {
    const all = store.list('places');
    const used = new Map();
    all.forEach((p) => used.set(p.category_id, (used.get(p.category_id) || 0) + 1));
    const cats = store.categories().filter((c) => used.has(c.id));
    setHTML($('#v-chips', root), html`
      <button data-action="cat" data-cat="all" class="${state.cat === 'all' ? 'chip-active' : 'chip'}">전체 ${all.length}</button>
      ${cats.map((c) => html`<button data-action="cat" data-cat="${c.id}" class="${state.cat === c.id ? 'chip-active' : 'chip'}">
        <i class="fa-solid ${icon(c.icon)} text-[10px]" style="color:${state.cat === c.id ? 'inherit' : color(c.color)}"></i> ${c.name} ${used.get(c.id)}</button>`)}`);
    const rows = places();
    setHTML($('#v-list', root), rows.length ? html`${rows.map((p) => {
      const cat = store.category(p.category_id);
      const walk = anchor && !p.is_anchor ? walkInfo(anchor, p) : null;
      const sel = p.id === state.selectedId;
      return html`
        <div data-action="select" data-id="${p.id}" id="v-card-${p.id}" class="glass-card p-3 rounded-2xl cursor-pointer ${sel ? 'neon-border-cyan' : ''}">
          <div class="flex items-start gap-2">
            <i class="fa-solid ${icon(cat?.icon)} text-xs mt-1 w-4 text-center" style="color:${color(cat?.color)}"></i>
            <div class="flex-1 min-w-0">
              <h4 class="font-bold text-[13px] text-white truncate">${p.name}${p.is_anchor ? html` <span class="text-[9px] px-1.5 rounded bg-amber-500/20 text-amber-300 align-middle">기준점</span>` : ''}</h4>
              <p class="text-[10px] text-slate-400 truncate">${[p.rating ? `★${Number(p.rating).toFixed(1)}` : '', priceRange(p), p.zone].filter(Boolean).join(' · ')}</p>
              ${p.signature ? html`<p class="text-[11px] text-neon-cyan truncate">${p.signature}</p>` : ''}
            </div>
            <div class="flex flex-col items-end gap-1 flex-shrink-0">
              ${walk?.text ? html`<span class="text-[10px] text-emerald-400">${walk.text}</span>` : ''}
              <a href="${googleMapsHref(p)}" target="_blank" rel="noopener" class="w-8 h-8 rounded-lg bg-slate-800 text-neon-cyan border border-white/10 flex items-center justify-center text-xs"><i class="fa-solid fa-diamond-turn-right"></i></a>
            </div>
          </div>
          ${sel ? html`<button data-action="detail" data-id="${p.id}" class="w-full mt-2 py-2 rounded-xl bg-slate-800 text-slate-100 text-[11px] font-bold border border-white/10"><i class="fa-solid fa-circle-info mr-1"></i>상세 보기</button>` : ''}
        </div>`;
    })}` : html`<p class="text-[11px] text-slate-500 text-center py-6">장소가 없어요.</p>`);
    drawMarkers(rows);
  }

  function select(id, fromMap = false) {
    state.selectedId = state.selectedId === id && !fromMap ? null : id;
    const p = store.get('places', id);
    if (map && p?.lat != null && state.selectedId) map.flyTo([p.lat, p.lng], Math.max(map.getZoom(), 16), { duration: 0.5 });
    render();
    if (fromMap) document.getElementById(`v-card-${id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  const off = delegate(root, {
    cat: (el) => { state.cat = el.dataset.cat; state.selectedId = null; render(); fit(); },
    select: (el) => select(el.dataset.id),
    detail: (el) => openPlace(el.dataset.id),
  });

  function fit() {
    if (!map) return;
    const pts = places().filter((p) => p.lat != null).map((p) => [p.lat, p.lng]);
    if (pts.length > 1) map.fitBounds(lib.L.latLngBounds(pts), { padding: [24, 24], maxZoom: 16 });
    else if (pts.length === 1) map.setView(pts[0], 16);
  }

  render();
  loadMapLib().then((m) => {
    if (destroyed) return;
    lib = m;
    map = m.createMap($('#v-map', root), { zoom: 13, center: anchor ? [anchor.lat, anchor.lng] : undefined });
    layer = m.L.layerGroup().addTo(map);
    $('#v-map-loading', root)?.remove();
    let band = null;
    map.on('zoomend', () => { const z = map.getZoom(); const b = z <= 13 ? 0 : z <= 15 ? 1 : 2; if (b !== band) { band = b; drawMarkers(places()); } });
    fit();
    drawMarkers(places());
  }).catch(() => { const el = $('#v-map-loading', root); if (el) el.textContent = '지도를 불러오지 못했어요.'; });

  return { update: render, destroy: () => { destroyed = true; off(); map?.remove(); } };
}

