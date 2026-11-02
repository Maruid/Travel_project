import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { openSheet, toast, emptyCard } from '../components/ui.js';
import { rpc, errorText } from '../lib/supabase.js';
import { streamFunction, progressTicker } from '../lib/ai-stream.js';
import { duplicateChecker } from '../lib/place-copy.js';
import { priceRange, priceInHome } from '../lib/format.js';
import { startGoogleLogin } from '../components/account.js';
import { fetchPlaceDetails, googleColumns } from '../lib/google-place.js';
import { namesMatch, normPlaceName } from '../lib/name-match.js';
import { isCurrencyCode } from '../lib/currency.js';

// =====================================================================
// AI 장소 추천 (Edge Function recommend-places)
//  - 관리자: 무제한 / 그 외: 관리자가 허용한 Google 사용자만 (사람별 하루 한도)
//  - 권한이 없으면 [사용 요청] (Google 로그인 필요)
//  - 같은 여행·키워드·범위·개수는 24시간 저장된 결과 재사용, 여행 멤버끼리 "최근 추천" 공유
//  - [추가] (하나 또는 여러 곳 선택) → 편집기 없이 구글 지도에서 확인해서 바로 저장
//      이름이 일치하면 저장 / 다른 가게로 보이면 ⚠️ 확인 / 못 찾으면 위치 없이 추가 또는 직접 편집
//  - 카테고리는 AI 가 이 여행의 카테고리 목록에서 고름 (없으면 종류 기준 기본 카테고리)
// =====================================================================

const KEYWORD_MAX = 100;
const EXAMPLES = ['현지인 맛집', '비 오는 날 갈 만한 곳', '야경 명소', '혼밥하기 좋은 곳', '기념품 쇼핑'];

let accessCache = null;              // { admin, google, allowed, expires_at, daily_limit, used_today, requested }
const lastResult = new Map();        // tripId → 마지막으로 본 결과 (편집기에 다녀와도 유지)
const addedMap = new Map();          // tripId → Map(이름 키 → place id): 이번 접속 중 추천에서 추가한 곳
const itemKey = (it) => normPlaceName(it.local_name || it.name);

async function getAccess(force = false) {
  if (!accessCache || force) accessCache = await rpc('my_ai_access');
  return accessCache;
}

const fmtDate = (s) => (s ? String(s).slice(0, 10) : '');
const ago = (s) => {
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
};
const mapsSearch = (it, destination) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
  [it.local_name || it.name, it.zone, destination].filter(Boolean).join(' '))}`;

export async function openRecommend(store, { anchor = null } = {}) {
  if (!navigator.onLine) { toast('온라인 상태에서만 쓸 수 있어요.', 'error'); return; }
  let access;
  try { access = await getAccess(); } catch (e) { toast(errorText(e), 'error'); return; }

  const state = {
    keyword: '',
    scope: anchor ? 'anchor' : 'all',
    count: 5,
    busy: false,
    result: lastResult.get(store.tripId) || null,
    recent: null,
    selected: new Set(),   // 고른 카드 번호
    adding: null,          // 여러 곳 추가 중 진행 문구
  };

  openSheet(html`
    <div class="flex items-center justify-between mb-1">
      <h3 class="text-base font-black text-white"><i class="fa-solid fa-wand-magic-sparkles text-purple-300 mr-1"></i>AI 장소 추천</h3>
      <span id="rc-quota" class="text-[10px] text-slate-400"></span>
    </div>
    <div id="rc-body"></div>
  `, (el) => {
    function quotaText() {
      if (access.admin) return '관리자 · 무제한';
      if (!access.allowed) return '';
      const left = Math.max(0, (access.daily_limit ?? 0) - (access.used_today ?? 0));
      return `오늘 남은 횟수 ${left}/${access.daily_limit}${access.expires_at ? ` · ${fmtDate(access.expires_at)}까지` : ''}`;
    }

    function render() {
      $('#rc-quota', el).textContent = quotaText();
      setHTML($('#rc-body', el), html`
        ${access.allowed ? formHtml() : lockedHtml()}
        <div id="rc-progress" class="hidden mt-2 text-[11px] text-purple-200"></div>
        <div id="rc-result" class="mt-3">${state.result ? resultHtml(state.result) : ''}</div>
        <div id="rc-recent" class="mt-4">${recentHtml()}</div>`);
    }

    function lockedHtml() {
      if (!access.google) {
        return html`
          <div class="glass-card p-3 rounded-2xl text-[11px] text-slate-300 space-y-2">
            <p>AI 추천은 관리자가 허용한 사람만 쓸 수 있어요. <b>Google 로그인</b> 후 사용을 요청할 수 있어요.</p>
            <button data-action="google" class="btn-ghost w-full py-2"><i class="fa-brands fa-google mr-1"></i>Google 로그인</button>
          </div>`;
      }
      return html`
        <div class="glass-card p-3 rounded-2xl text-[11px] text-slate-300 space-y-2">
          <p>AI 추천은 관리자가 허용한 사람만 쓸 수 있어요.</p>
          ${access.requested
            ? html`<p class="text-amber-200"><i class="fa-solid fa-hourglass-half mr-1"></i>사용을 요청했어요. 관리자가 승인하면 바로 쓸 수 있어요.</p>`
            : html`<button data-action="request" class="btn-primary w-full">사용 요청하기</button>`}
        </div>`;
    }

    function formHtml() {
      return html`
        <div class="space-y-2">
          <div class="flex gap-1.5">
            <input id="rc-keyword" class="input" maxlength="${KEYWORD_MAX}" placeholder="예: 현지인이 가는 야키니쿠" value="${state.keyword}">
            <button data-action="run" class="btn-primary !w-auto px-4 flex-shrink-0" ${state.busy ? 'disabled' : ''}>추천</button>
          </div>
          <div class="flex flex-wrap gap-1">
            ${EXAMPLES.map((x) => html`<button data-action="example" data-text="${x}" class="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-white/10">${x}</button>`)}
          </div>
          <div class="flex items-center gap-3 text-[11px] text-slate-300">
            ${anchor ? html`<label class="flex items-center gap-1"><input type="radio" name="rc-scope" value="anchor" ${state.scope === 'anchor' ? 'checked' : ''} class="accent-cyan-400">${anchor.name || '기준점'} 근처</label>` : ''}
            <label class="flex items-center gap-1"><input type="radio" name="rc-scope" value="all" ${state.scope === 'all' ? 'checked' : ''} class="accent-cyan-400">${store.trip.destination || '여행지'} 전체</label>
            <span class="flex-1"></span>
            <label class="flex items-center gap-1"><input type="radio" name="rc-count" value="5" ${state.count === 5 ? 'checked' : ''} class="accent-cyan-400">5곳</label>
            <label class="flex items-center gap-1"><input type="radio" name="rc-count" value="10" ${state.count === 10 ? 'checked' : ''} class="accent-cyan-400">10곳</label>
          </div>
        </div>`;
    }

    // 카드 상태(it._st): checking | added | dup | mismatch | notfound | skipped | error
    function isDupItem(it) {
      if (addedFor().has(itemKey(it))) return true;
      const isDup = duplicateChecker(store.list('places'));
      return isDup({ name: it.name }) || (it.local_name && isDup({ name: it.local_name }));
    }
    function addedFor() {
      if (!addedMap.has(store.tripId)) addedMap.set(store.tripId, new Map());
      return addedMap.get(store.tripId);
    }
    const selectable = (it) => !it._st && !isDupItem(it);

    function itemActions(it, i) {
      const st = it._st;
      const edit = html`<button data-action="edit" data-i="${i}" title="직접 편집해서 추가" class="px-2.5 py-1.5 rounded-xl bg-slate-800 text-slate-200 text-[11px] border border-white/10"><i class="fa-solid fa-pen"></i></button>`;
      const maps = html`<a href="${mapsSearch(it, store.trip.destination)}" target="_blank" rel="noopener" class="px-2.5 py-1.5 rounded-xl bg-slate-800 text-slate-200 text-[11px] font-bold border border-white/10"><i class="fa-solid fa-map-location-dot"></i></a>`;
      if (st?.state === 'checking') return html`<p class="text-[11px] text-purple-200 mt-2"><i class="fa-solid fa-spinner fa-spin mr-1"></i>구글 지도에서 확인 중...</p>`;
      if (st?.state === 'added') return html`<p class="text-[11px] text-emerald-300 mt-2"><i class="fa-solid fa-circle-check mr-1"></i>추가됨${st.name && normPlaceName(st.name) !== normPlaceName(it.name) ? ` · ${st.name}` : ''}${st.noLocation ? ' · 위치 없음' : ''}</p>`;
      if (st?.state === 'skipped') return html`<p class="text-[11px] text-slate-500 mt-2">건너뜀 · <button data-action="add" data-i="${i}" class="underline">다시 확인</button></p>`;
      if (st?.state === 'mismatch') {
        const g = st.g;
        return html`
          <div class="mt-2 p-2 rounded-xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-100 space-y-1.5">
            <p><b>⚠️ 다른 곳일 수 있어요.</b> 구글에서 찾은 곳: <b>${g.name}</b>${g.zone ? ` · ${g.zone}` : ''}</p>
            <div class="flex flex-wrap gap-1.5">
              <button data-action="add-as" data-i="${i}" class="px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-400/40 font-bold">이걸로 추가</button>
              <button data-action="skip" data-i="${i}" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300">건너뛰기</button>
              <button data-action="edit" data-i="${i}" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300">직접 편집</button>
              ${g.mapsUrl ? html`<a href="${g.mapsUrl}" target="_blank" rel="noopener" class="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300">구글에서 보기</a>` : ''}
            </div>
          </div>`;
      }
      if (st?.state === 'notfound' || st?.state === 'error') {
        return html`
          <div class="mt-2 p-2 rounded-xl bg-slate-800/80 text-[11px] text-slate-300 space-y-1.5">
            <p>${st.state === 'notfound' ? '구글 지도에서 찾지 못했어요.' : st.msg}</p>
            <div class="flex flex-wrap gap-1.5">
              ${st.state === 'error' ? html`<button data-action="add" data-i="${i}" class="px-2.5 py-1 rounded-lg bg-slate-700">다시 시도</button>` : ''}
              <button data-action="add-noloc" data-i="${i}" class="px-2.5 py-1 rounded-lg bg-slate-700">위치 없이 추가</button>
              <button data-action="edit" data-i="${i}" class="px-2.5 py-1 rounded-lg bg-slate-700">직접 편집</button>
            </div>
          </div>`;
      }
      if (isDupItem(it)) return html`<div class="flex gap-1.5 mt-2"><span class="flex-1 py-1.5 rounded-xl bg-slate-800 text-slate-400 text-[11px] text-center">이미 있음</span>${maps}</div>`;
      return html`
        <div class="flex gap-1.5 mt-2">
          <button data-action="add" data-i="${i}" class="flex-1 py-1.5 rounded-xl bg-neon-cyan text-night-950 text-[11px] font-black"><i class="fa-solid fa-plus mr-1"></i>추가</button>
          ${edit}${maps}
        </div>`;
    }

    function resultHtml(r) {
      const cands = (r.items || []).map((it, i) => ({ it, i })).filter(({ it }) => selectable(it));
      const nSel = cands.filter(({ i }) => state.selected.has(i)).length;
      return html`
        <div class="flex items-center justify-between mb-1.5">
          <p class="text-[11px] text-slate-300"><b class="text-white">"${r.keyword}"</b> · ${r.scope === 'anchor' && r.anchor ? `${r.anchor} 근처` : '여행지 전체'}</p>
          ${r.cached ? html`<span class="text-[10px] text-slate-500">저장된 결과 · ${ago(r.created_at)}</span>` : ''}
        </div>
        ${cands.length > 1 ? html`
          <div class="flex items-center justify-between mb-1.5 text-[11px]">
            <button data-action="sel-all" class="text-neon-cyan">${nSel === cands.length ? '선택 해제' : '전체 선택'}</button>
            <button data-action="add-selected" class="px-3 py-1 rounded-lg ${nSel ? 'bg-neon-cyan text-night-950 font-black' : 'bg-slate-800 text-slate-500'}" ${nSel && !state.adding ? '' : 'disabled'}>
              ${state.adding ? state.adding : `선택한 ${nSel}곳 추가`}</button>
          </div>` : ''}
        ${r.items?.length ? html`<div class="space-y-2">${r.items.map((it, i) => {
          const priced = { price_min: it.price_min, price_max: it.price_max, price_currency: it.currency };
          const price = priceRange(priced);
          const home = priceInHome(priced, store.budget);
          const cat = it.category_id ? store.category(it.category_id) : null;
          return html`
            <div class="glass-card p-3 rounded-2xl">
              <div class="flex items-start gap-2">
                ${selectable(it) ? html`<input type="checkbox" data-sel="${i}" class="accent-cyan-400 mt-1 flex-shrink-0" ${state.selected.has(i) ? 'checked' : ''}>` : ''}
                <div class="min-w-0 flex-1">
                  <p class="text-xs font-bold text-white truncate">${it.name}${it.local_name && it.local_name !== it.name ? html` <span class="font-normal text-slate-400">${it.local_name}</span>` : ''}</p>
                  <p class="text-[10px] text-slate-400 truncate">${[cat ? cat.name : it.kind_text, it.zone].filter(Boolean).join(' · ')}${price ? html` · <span class="text-emerald-400 font-mono font-bold">${price}</span>` : ''}${home ? ` (${home})` : ''}</p>
                </div>
                ${it.warn ? html`<span class="flex-shrink-0 inline-flex items-center h-[18px] px-1.5 rounded border text-[9px] font-bold bg-rose-500/20 text-rose-300 border-rose-500/40">⚠️ ${it.warn}</span>` : ''}
              </div>
              ${it.reason ? html`<p class="text-[11px] text-slate-300 mt-1">${it.reason}</p>` : ''}
              ${itemActions(it, i)}
            </div>`;
        })}</div>` : emptyCard('조건에 맞는 장소를 찾지 못했어요. 키워드를 바꿔 보세요.')}
        <div class="mt-2 p-2.5 rounded-xl bg-purple-500/10 border border-purple-400/30 text-[10px] text-purple-100 space-y-1.5" id="rc-evidence"></div>
        ${r.cached && access.allowed ? html`<button data-action="rerun" class="w-full mt-2 py-2 text-[11px] text-slate-400"><i class="fa-solid fa-rotate mr-1"></i>새로 추천받기 (횟수 사용)</button>` : ''}
        <p class="text-[10px] text-slate-500 mt-1">[추가]를 누르면 구글 지도에서 실제 장소를 확인해 바로 저장해요. 이름이 다르면 ⚠️로 알려드려요.</p>`;
    }

    // 결과 부분만 다시 그림 (입력 중인 키워드는 건드리지 않음)
    function renderResult() {
      const box = $('#rc-result', el);
      if (!box || !state.result) return;
      setHTML(box, resultHtml(state.result));
      renderEvidence();
    }

    // ---- 추가: 구글 확인 → 이름 일치하면 저장 ----
    function buildRow(it, g) {
      const closed = g && (g.businessStatus === 'CLOSED_PERMANENTLY' || g.businessStatus === 'CLOSED_TEMPORARILY');
      const hasGPrice = g && (g.priceMin != null || g.priceMax != null);
      const pmin = hasGPrice ? g.priceMin : it.price_min;
      const pmax = hasGPrice ? g.priceMax : it.price_max;
      let cur = hasGPrice ? g.priceCurrency : it.currency;
      if (!isCurrencyCode(cur)) cur = isCurrencyCode(store.budget?.local_currency) ? store.budget.local_currency : null;
      const catId = (it.category_id && store.category(it.category_id) ? it.category_id : null)
        || store.globalCategories.find((c) => c.kind === (g?.kind || it.kind))?.id || null;
      return {
        name: g?.name || it.name,
        category_id: catId,
        zone: g?.zone || it.zone || null,
        description: it.reason || null,
        warn_badge: closed ? g.warnBadge : (it.warn || g?.warnBadge || null),
        price_min: pmin ?? null, price_max: pmax ?? null,
        price_currency: pmin != null || pmax != null ? cur : null,
        source: 'AI 추천',
        maps_url: g?.mapsUrl || null,
        map_query: g ? null : [it.local_name || it.name, it.zone, store.trip.destination].filter(Boolean).join(' ').slice(0, 200),
        is_anchor: false,
        lat: g?.lat ?? null, lng: g?.lng ?? null,
        ...(g ? googleColumns(g) : {}),
      };
    }
    function save(it, g, extra = {}) {
      const id = store.insert('places', buildRow(it, g));
      addedFor().set(itemKey(it), id);
      it._st = { state: 'added', name: g?.name || it.name, ...extra };
      state.selected.delete(state.result.items.indexOf(it));
    }

    // 반환: 계속 진행해도 되는지 (구글 한도 등으로 멈춰야 하면 false)
    async function addItem(it, { force = null, noLocation = false } = {}) {
      if (noLocation) { save(it, null, { noLocation: true }); renderResult(); return true; }
      if (force) { save(it, force); renderResult(); return true; }
      it._st = { state: 'checking' };
      renderResult();
      let r;
      try {
        const bias = state.result.scope === 'anchor' && anchor?.lat != null ? { lat: anchor.lat, lng: anchor.lng } : {};
        r = await fetchPlaceDetails({
          tripId: store.tripId, name: it.local_name || it.name, zone: it.zone || null,
          destination: store.trip.destination || null, ...bias,
        });
      } catch (e) {
        it._st = e.code === 'NOT_FOUND' ? { state: 'notfound' } : { state: 'error', msg: e.message };
        renderResult();
        return !['PLACES_LIMIT', 'PLACES_RATE', 'OFFLINE', 'NO_API_KEY'].includes(e.code);
      }
      const g = r.place;
      // 구글 장소 ID 가 같은 곳이 이미 있으면 (이름이 달라도) 건너뜀
      if (g.placeId && store.list('places').some((p) => p.google_place_id === g.placeId)) {
        addedFor().set(itemKey(it), null);
        it._st = null;
      } else if (namesMatch([it.name, it.local_name], g.name)) {
        save(it, g);
      } else {
        it._st = { state: 'mismatch', g };
      }
      renderResult();
      return true;
    }

    async function addSelected() {
      const items = [...state.selected].sort((a, b) => a - b).map((i) => state.result.items[i]).filter((it) => it && selectable(it));
      if (!items.length || state.adding) return;
      let ok = 0;
      for (let k = 0; k < items.length; k++) {
        state.adding = `확인 중 ${k + 1}/${items.length}`;
        const go = await addItem(items[k]);
        if (items[k]._st?.state === 'added') ok++;
        if (!go) { toast(items[k]._st?.msg || '구글 조회를 멈췄어요.', 'error'); break; }
      }
      state.adding = null;
      state.selected.clear();
      renderResult();
      const warn = items.filter((it) => ['mismatch', 'notfound', 'error'].includes(it._st?.state)).length;
      toast(`${ok}곳을 추가했어요.${warn ? ` ${warn}곳은 확인이 필요해요.` : ''}`);
    }

    function recentHtml() {
      if (!state.recent) return '';
      const list = state.recent.filter((x) => x.key !== state.result?.key);
      if (!list.length) return '';
      return html`
        <p class="text-[11px] font-bold text-slate-300 mb-1.5">최근 추천 (함께 보기)</p>
        <div class="space-y-1">${list.map((x) => html`
          <button data-action="open-recent" data-key="${x.key}" class="w-full text-left px-2.5 py-2 rounded-xl bg-slate-800/70 border border-white/5 flex items-center justify-between gap-2">
            <span class="min-w-0"><span class="block text-[11px] text-white truncate">${x.keyword}</span>
              <span class="block text-[10px] text-slate-500 truncate">${x.scope || ''} · ${x.count}곳 · ${x.created_by_name || '멤버'} · ${ago(x.created_at)}</span></span>
            <i class="fa-solid fa-chevron-right text-[10px] text-slate-500"></i>
          </button>`)}</div>`;
    }

    // 근거(검색한 말·참고 페이지·시간)는 장소 탭과 같은 표시를 씀
    async function renderEvidence() {
      const box = $('#rc-evidence', el);
      if (!box || !state.result) return;
      const { aiEvidence } = await import('./tabs/places.js');
      setHTML(box, aiEvidence(state.result));
      if (!box.textContent.trim()) box.classList.add('hidden');
    }

    function showResult(r) {
      state.result = r;
      state.selected = new Set();
      lastResult.set(store.tripId, r);
      render();
      renderEvidence();
    }

    async function run({ force = false } = {}) {
      if (state.busy) return;
      const input = $('#rc-keyword', el);
      const keyword = (input?.value || state.keyword).trim().slice(0, KEYWORD_MAX);
      if (!keyword) { toast('찾고 싶은 것을 입력해 주세요.', 'error'); return; }
      state.keyword = keyword;
      state.scope = el.querySelector('input[name="rc-scope"]:checked')?.value || state.scope;
      state.count = Number(el.querySelector('input[name="rc-count"]:checked')?.value || state.count);
      state.busy = true;
      const btn = el.querySelector('[data-action="run"]');
      if (btn) btn.disabled = true;
      const prog = $('#rc-progress', el);
      prog.classList.remove('hidden');
      const ticker = progressTicker((text, done) => {
        setHTML(prog, html`<i class="fa-solid fa-spinner fa-spin mr-1"></i>${text}${done.length ? html` <span class="text-slate-500">(${done.join(' · ')})</span>` : ''}`);
      });
      try {
        const b = store.budget || {};
        const r = await streamFunction('recommend-places', {
          tripId: store.tripId,
          keyword,
          scope: state.scope,
          anchor: state.scope === 'anchor' && anchor ? { name: anchor.name || '기준점', lat: anchor.lat, lng: anchor.lng } : null,
          count: state.count,
          destination: store.trip.destination || null,
          dates: store.trip.start_date ? `${store.trip.start_date}${store.trip.end_date ? ` ~ ${store.trip.end_date}` : ''}` : null,
          existing: store.list('places').map((p) => p.name).slice(0, 150),
          currency: b.local_currency || null,
          // AI 가 이 중에서 카테고리를 고름 (커스텀 먼저)
          categories: store.categories().map((c) => ({ id: c.id, name: c.name, kind: c.kind })).slice(0, 40),
          force,
        }, ticker.onEvent);
        if (!r.cached && access && !access.admin) access.used_today = (access.used_today || 0) + 1;
        if (!r.cached) state.recent = null;   // 새 결과가 생겼으니 최근 목록 다시 받기
        showResult(r);
        loadRecent();
        toast(r.cached ? '24시간 안에 같은 추천이 있어서 저장된 결과를 보여드려요.' : `${r.items?.length || 0}곳을 추천받았어요.`);
      } catch (e) {
        toast(e.message, 'error');
        if (e.code === 'AI_NOT_ALLOWED' || e.code === 'GOOGLE_REQUIRED') { access = await getAccess(true); render(); }
      } finally {
        ticker.stop();
        state.busy = false;
        prog.classList.add('hidden');
        const b2 = el.querySelector('[data-action="run"]');
        if (b2) b2.disabled = false;
      }
    }

    async function loadRecent() {
      try {
        state.recent = await rpc('recent_recommendations', { p_trip: store.tripId });
        setHTML($('#rc-recent', el), recentHtml());
      } catch { /* 최근 목록은 없어도 됨 */ }
    }

    const off = delegate(el, {
      run: () => run(),
      rerun: () => run({ force: true }),
      example: (b) => { const i = $('#rc-keyword', el); if (i) { i.value = b.dataset.text; i.focus(); } },
      'open-recent': (b) => {
        const x = state.recent?.find((r) => r.key === b.dataset.key);
        if (x) showResult({ ...x.result, key: x.key, cached: true, created_at: x.created_at });
      },
      add: (b) => { const it = state.result?.items?.[Number(b.dataset.i)]; if (it) addItem(it); },
      'add-as': (b) => { const it = state.result?.items?.[Number(b.dataset.i)]; if (it?._st?.g) addItem(it, { force: it._st.g }); },
      'add-noloc': (b) => { const it = state.result?.items?.[Number(b.dataset.i)]; if (it) addItem(it, { noLocation: true }); },
      skip: (b) => { const it = state.result?.items?.[Number(b.dataset.i)]; if (it) { it._st = { state: 'skipped' }; renderResult(); } },
      edit: async (b) => {
        const it = state.result?.items?.[Number(b.dataset.i)];
        if (!it) return;
        const { openPlaceEditor } = await import('./tabs/places.js');
        openPlaceEditor(store, null, { near: anchor, prefill: it });
      },
      'sel-all': () => {
        const cands = state.result.items.map((it, i) => ({ it, i })).filter(({ it }) => selectable(it));
        const all = cands.every(({ i }) => state.selected.has(i));
        state.selected = all ? new Set() : new Set(cands.map(({ i }) => i));
        renderResult();
      },
      'add-selected': () => addSelected(),
      request: async () => {
        try {
          await rpc('request_ai_access', { p_message: null });
          access = await getAccess(true);
          render();
          toast('사용을 요청했어요. 관리자가 승인하면 쓸 수 있어요.');
        } catch (e) { toast(errorText(e), 'error'); }
      },
      google: () => startGoogleLogin({ hasLocalTrips: true }),
    });
    const onKey = (e) => { if (e.key === 'Enter' && e.target.id === 'rc-keyword') { e.preventDefault(); run(); } };
    el.addEventListener('keydown', onKey);
    const onSel = (e) => {
      const i = e.target.dataset?.sel;
      if (i == null) return;
      if (e.target.checked) state.selected.add(Number(i)); else state.selected.delete(Number(i));
      renderResult();
    };
    el.addEventListener('change', onSel);

    render();
    renderEvidence();
    loadRecent();
    return () => { off(); el.removeEventListener('keydown', onKey); el.removeEventListener('change', onSel); };
  });
}
