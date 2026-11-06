// =====================================================================
// AI 일정 짜기 (3차, Edge Function plan-itinerary)
//  1) 조건: 날짜 · 기존 일정(유지하고 채우기 / 지우고 새로 짜기 + 남길 것) · 하루 밀도 · 찜 반영 · 요청 글
//  2) 미리보기: 날짜별로 기존(회색) · 새 일정(AI) · 지워질 일정(취소선), 영업시간 ⚠️
//  3) 적용: 날짜별 또는 전체. 적용하면 일정 탭에 [되돌리기] 띠 (이 기기, 24시간)
//  - 권한·한도: AI 추천과 같은 권한, 하루 한도 같이 씀, 여행당 3번 (관리자 무제한)
// =====================================================================
import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { openSheet, closeSheet, toast, confirmAction } from '../components/ui.js';
import { rpc, errorText } from '../lib/supabase.js';
import { streamFunction, progressTicker } from '../lib/ai-stream.js';
import { startGoogleLogin } from '../components/account.js';
import { groupCategories } from '../lib/place-filter.js';
import { DENSITY, MAX_TEXT, tooManyLiked, buildPlanRequest, validatePlan, dayCounts, applyPlan, saveUndo, loadUndo, shortHM } from '../lib/ai-plan.js';

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const dayText = (d) => { const x = new Date(`${d}T12:00:00Z`); return `${x.getUTCMonth() + 1}/${x.getUTCDate()}(${DAY_KO[x.getUTCDay()]})`; };
const lastPlan = new Map();   // tripId → { plan, ctx, applied:Set, batch } (시트를 닫았다 열어도 미리보기 유지)

/**
 * @param dates  일정 탭의 날짜 목록
 * @param day    지금 보고 있는 날짜 (기본 선택에 씀)
 * @param onApplied  적용 후 일정 탭 다시 그리기
 */
export async function openAiPlan(store, { dates, day = null, onApplied = () => {} } = {}) {
  if (!navigator.onLine) { toast('온라인 상태에서만 쓸 수 있어요.', 'error'); return; }
  if (!dates.length) { toast('먼저 여행 날짜를 정해 주세요.', 'error'); return; }
  let access;
  try { access = await rpc('ai_plan_status', { p_trip: store.tripId }); } catch (e) { toast(errorText(e), 'error'); return; }

  const itemsOn = (d) => store.list('itinerary_items').filter((it) => it.day_date === d);
  const empty = dates.filter((d) => !itemsOn(d).length);
  const likes = new Map([...store.likeMap()].map(([id, ids]) => [id, ids.length]));
  const state = {
    dates: new Set(empty.length ? empty : day ? [day] : []),
    mode: 'keep',
    keep: null,             // 지우고 새로 짜기에서 남길 일정 id (처음 바꿀 때 장소 없는 일정으로 채움)
    density: 'normal',
    likeMode: likes.size ? 'prefer' : 'off',
    text: '',
    start: '09:00', end: '21:00',
    skipVisited: true,
    // 후보 카테고리: 기본은 숙소 · 교통 종류를 뺀 전부
    cats: new Set(store.categories().filter((c) => !['lodging', 'transit'].includes(c.kind)).map((c) => c.id)),
    mapDay: null,           // 미리보기에서 지도를 펼친 날짜
    busy: false,
    view: lastPlan.has(store.tripId) ? 'preview' : 'form',
  };

  openSheet(html`
    <div class="flex items-center justify-between mb-2 gap-2">
      <h3 class="text-base font-black text-white"><i class="fa-solid fa-wand-magic-sparkles text-purple-300 mr-1"></i>AI 일정 짜기</h3>
      <span id="ap-quota" class="text-[10px] text-slate-400 text-right"></span>
    </div>
    <div id="ap-body"></div>`, (el) => {
    const tripLeft = () => (access.trip_limit == null ? null : Math.max(0, access.trip_limit - (access.trip_used || 0)));
    const dayLeft = () => (access.daily_limit == null ? null : Math.max(0, access.daily_limit - (access.used_today || 0)));
    const canRun = () => access.allowed && (access.admin || (tripLeft() > 0 && dayLeft() > 0));

    function quotaText() {
      if (access.admin) return '관리자 · 무제한';
      if (!access.allowed) return '';
      return `이 여행 ${tripLeft()}/${access.trip_limit}번 남음 · 오늘 ${dayLeft()}번 남음`;
    }

    function render() {
      $('#ap-quota', el).textContent = quotaText();
      if (!access.allowed) return setHTML($('#ap-body', el), lockedHtml());
      previewMap?.remove(); previewMap = null;
      if (state.view === 'preview' && lastPlan.has(store.tripId)) {
        const lp = lastPlan.get(store.tripId);
        setHTML($('#ap-body', el), previewHtml(lp));
        const day = lp.plan.days.find((d) => d.date === state.mapDay);
        if (day) drawPreviewMap(day);
        return;
      }
      setHTML($('#ap-body', el), formHtml());
    }

    function lockedHtml() {
      return html`
        <div class="glass-card p-3 rounded-2xl text-[11px] text-slate-300 space-y-2">
          <p>AI 일정 짜기는 AI 추천과 같이, 관리자가 허용한 사람만 쓸 수 있어요.</p>
          ${!access.google ? html`<button data-action="google" class="btn-ghost w-full py-2"><i class="fa-brands fa-google mr-1"></i>Google 로그인</button>`
            : access.requested ? html`<p class="text-amber-200"><i class="fa-solid fa-hourglass-half mr-1"></i>사용을 요청했어요. 관리자가 승인하면 바로 쓸 수 있어요.</p>`
            : html`<button data-action="request" class="btn-primary w-full">사용 요청하기</button>`}
        </div>`;
    }

    // ---------- 1) 조건 ----------
    function formHtml() {
      const seg = (name, key, label, cur) => html`<button data-action="${name}" data-v="${key}" class="flex-1 h-8 rounded-lg text-[11px] font-bold ${cur === key ? 'bg-purple-500/30 text-purple-100 border border-purple-400/60' : 'bg-slate-800 text-slate-400 border border-white/10'}">${label}</button>`;
      const chosen = dates.filter((d) => state.dates.has(d));
      const existing = chosen.flatMap((d) => itemsOn(d));
      if (state.mode === 'replace' && !state.keep) state.keep = new Set(existing.filter((it) => !it.place_id).map((it) => it.id));
      const removeN = state.mode === 'replace' ? existing.filter((it) => !state.keep.has(it.id)).length : 0;
      const placeN = store.list('places').length;
      return html`
        <div class="space-y-3 text-[11px]">
          <div>
            <p class="label">채울 날짜 <span class="text-slate-500 font-normal">· 일정 없는 날이 먼저 골라져 있어요</span></p>
            <div class="flex flex-wrap gap-1.5">
              ${dates.map((d) => { const n = itemsOn(d).length; const on = state.dates.has(d); return html`
                <button data-action="date" data-d="${d}" class="h-8 px-2.5 rounded-lg border font-bold ${on ? 'bg-purple-500/30 text-purple-100 border-purple-400/60' : 'bg-slate-800 text-slate-400 border-white/10'}">
                  ${dayText(d)}${n ? html`<span class="font-normal ${on ? 'text-purple-200/80' : 'text-slate-500'}"> · ${n}개</span>` : ''}</button>`; })}
            </div>
          </div>
          ${existing.length ? html`
            <div>
              <p class="label">고른 날의 기존 일정 ${existing.length}개</p>
              <div class="flex gap-1.5">${seg('mode', 'keep', '유지하고 채우기', state.mode)}${seg('mode', 'replace', '지우고 새로 짜기', state.mode)}</div>
              ${state.mode === 'replace' ? html`
                <div class="mt-2 p-2.5 rounded-xl bg-rose-500/5 border border-rose-500/20 space-y-1">
                  <p class="text-[10px] text-rose-200">체크한 일정만 남겨요. 장소 없는 일정(비행기·체크인 등)은 미리 체크해 뒀어요.</p>
                  ${chosen.map((d) => itemsOn(d).length ? html`
                    <p class="text-[10px] text-slate-500 pt-1">${dayText(d)}</p>
                    ${itemsOn(d).map((it) => html`
                      <label class="flex items-center gap-2 py-0.5">
                        <input type="checkbox" data-keep="${it.id}" ${state.keep.has(it.id) ? 'checked' : ''} class="accent-cyan-400">
                        <span class="font-mono text-slate-400 w-10">${shortHM(it.start_time) || '--:--'}</span>
                        <span class="truncate ${state.keep.has(it.id) ? 'text-slate-200' : 'text-slate-500 line-through'}">${it.title}</span>
                      </label>`)}` : '')}
                  <p class="text-[10px] text-rose-300 pt-1">${removeN}개를 지우고 새로 짜요. 적용 뒤에도 되돌릴 수 있어요.</p>
                </div>` : ''}
            </div>` : ''}
          ${candidateHtml()}
          <div>
            <p class="label">하루 밀도</p>
            <div class="flex gap-1.5">${Object.entries(DENSITY).map(([k, v]) => seg('density', k, `${v.label} ${v.min}~${v.max}곳`, state.density))}</div>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div><p class="label">하루 시작</p><input type="time" id="ap-start" class="input" value="${state.start}"></div>
            <div><p class="label">하루 끝</p><input type="time" id="ap-end" class="input" value="${state.end}"></div>
          </div>
          <div>
            <p class="label">찜 반영 <span class="text-slate-500 font-normal">· 찜한 곳 ${likes.size}곳</span></p>
            <div class="flex gap-1.5">${seg('like', 'must', '꼭 넣기', state.likeMode)}${seg('like', 'prefer', '우선', state.likeMode)}${seg('like', 'off', '반영 안 함', state.likeMode)}</div>
            ${state.likeMode === 'must' && tooManyLiked(likes.size, chosen.length, state.density) ? html`
              <p class="mt-1 text-[10px] text-amber-200"><i class="fa-solid fa-triangle-exclamation mr-0.5"></i>찜한 곳(${likes.size})이 ${chosen.length}일 × 하루 최대 ${DENSITY[state.density].max}곳보다 많아요. 다 못 넣을 수 있어요. 날짜를 늘리거나 밀도를 올려 보세요.</p>` : ''}
          </div>
          <label class="flex items-center gap-2 text-slate-300"><input type="checkbox" id="ap-skip-visited" ${state.skipVisited ? 'checked' : ''} class="accent-cyan-400">다녀온 곳은 빼기 <span class="text-slate-500">(찜한 곳은 남김)</span></label>
          <div>
            <p class="label">요청 <span class="text-slate-500 font-normal">(선택)</span></p>
            <textarea id="ap-text" class="input" rows="2" maxlength="${MAX_TEXT}" placeholder="예: 화요일은 USJ, 마지막 날은 공항 가기 전 쇼핑">${state.text}</textarea>
            <p class="text-right text-[9px] text-slate-500"><span id="ap-count">${state.text.length}</span>/${MAX_TEXT}</p>
          </div>
          <p class="text-[10px] text-slate-500">이 여행의 장소 ${placeN}곳 안에서만 골라요. 새 장소가 필요하면 먼저 AI 추천으로 장소를 추가하세요.</p>
          <div id="ap-progress" class="hidden text-[11px] text-purple-200"></div>
          <button data-action="run" class="btn-primary w-full" ${!chosen.length || !placeN || !canRun() || state.busy ? 'disabled' : ''}>
            <i class="fa-solid fa-wand-magic-sparkles mr-1"></i>${chosen.length ? `${chosen.length}일 일정 짜기` : '날짜를 골라 주세요'}${access.admin ? '' : ' · 1회 사용'}</button>
          ${!access.admin && !canRun() ? html`<p class="text-[10px] text-amber-200 text-center">${tripLeft() <= 0 ? '이 여행의 AI 일정 짜기 횟수를 모두 썼어요.' : '오늘 AI 사용 한도를 모두 썼어요.'}</p>` : ''}
        </div>`;
    }

    // 후보 장소: 종류별로 묶은 카테고리 칩 (여러 개), [전체]
    function candidateHtml() {
      const places = store.list('places');
      const { groups } = groupCategories(store.categories(), places);
      const allIds = groups.flatMap((g) => g.cats.map((c) => c.id));
      const all = allIds.every((id) => state.cats.has(id));
      const n = places.filter((p) => !p.is_anchor && state.cats.has(p.category_id) && (!state.skipVisited || !p.visited_at || likes.has(p.id))).length;
      const chip = (on) => `h-7 px-2 rounded-full border text-[10px] font-bold flex items-center gap-1 ${on ? 'bg-purple-500/30 text-purple-100 border-purple-400/60' : 'bg-slate-800 text-slate-500 border-white/10'}`;
      return html`
        <div>
          <div class="flex items-center justify-between">
            <p class="label">후보 장소 <span class="text-slate-500 font-normal">· ${n}곳</span></p>
            <button data-action="cat-all" class="text-[10px] text-purple-200 underline underline-offset-2">${all ? '모두 끄기' : '전체'}</button>
          </div>
          <div class="space-y-1.5">
            ${groups.map((g) => html`
              <div class="flex flex-wrap items-center gap-1">
                <span class="text-[9px] text-slate-500 w-7 flex-shrink-0">${g.label}</span>
                ${g.cats.map((c) => html`<button data-action="cat" data-id="${c.id}" class="${chip(state.cats.has(c.id))}">${c.name}<span class="opacity-60">${c.count}</span></button>`)}
              </div>`)}
          </div>
          ${state.likeMode === 'must' ? html`<p class="text-[10px] text-slate-500 mt-1">찜 꼭 넣기: 고른 카테고리 밖이라도 찜한 곳은 후보에 넣어요.</p>` : ''}
        </div>`;
    }

    // ---------- 미리보기 지도: 그날 순서대로 번호 (기존 회색 · AI 보라), 지울 일정은 안 보임 ----------
    let previewMap = null;
    async function drawPreviewMap(day) {
      previewMap?.remove(); previewMap = null;
      const box = $('#ap-map', el);
      if (!box) return;
      const { loadMapLib } = await import('./tabs/places.js');
      let lib;
      try { lib = await loadMapLib(); } catch { box.textContent = '지도를 불러오지 못했어요.'; return; }
      if (!el.isConnected || !$('#ap-map', el)) return;
      const pts = [];
      day.rows.forEach((r) => {
        const pid = r.kind === 'fixed' ? store.get('itinerary_items', r.itemId)?.place_id : r.placeId;
        const p = pid && store.get('places', pid);
        if (p?.lat != null) pts.push({ p, ai: r.kind === 'new' });
      });
      box.textContent = '';
      if (!pts.length) { box.textContent = '위치가 있는 장소가 없어요.'; return; }
      previewMap = lib.createMap(box, { zoom: 14 });
      const layer = lib.L.layerGroup().addTo(previewMap);
      lib.L.polyline(pts.map((x) => [x.p.lat, x.p.lng]), { color: '#a855f7', weight: 3, opacity: 0.8, interactive: false }).addTo(layer);
      pts.forEach((x, i) => {
        lib.L.marker([x.p.lat, x.p.lng], { icon: lib.pinIcon({ color: x.ai ? '#a855f7' : '#64748b', size: 24, label: i + 1 }), zIndexOffset: 100 + i })
          .bindTooltip(lib.esc(x.p.name), { direction: 'top', offset: [0, -12] }).addTo(layer);
      });
      const ll = pts.map((x) => [x.p.lat, x.p.lng]);
      if (ll.length > 1) previewMap.fitBounds(lib.L.latLngBounds(ll), { padding: [24, 24], maxZoom: 16 });
      else previewMap.setView(ll[0], 16);
      setTimeout(() => previewMap?.invalidateSize(), 50);
    }

    // ---------- 2) 미리보기 ----------
    function previewHtml(lp) {
      const { plan, applied } = lp;
      const placeName = (id) => store.get('places', id)?.name || '';
      const todo = plan.days.filter((d) => !applied.has(d.date) && (dayCounts(d).add || dayCounts(d).remove));
      const sum = todo.reduce((a, d) => { const c = dayCounts(d); return { add: a.add + c.add, remove: a.remove + c.remove }; }, { add: 0, remove: 0 });
      const countText = (c) => [c.remove ? `${c.remove}개 지우고` : '', `${c.add}개 추가`].filter(Boolean).join(' ');
      return html`
        <div class="space-y-3">
          ${plan.comment ? html`<p class="text-[11px] text-purple-100 p-2.5 rounded-xl bg-purple-500/10 border border-purple-400/30"><i class="fa-solid fa-route mr-1"></i>${plan.comment}</p>` : ''}
          ${plan.missingLiked.length ? html`<p class="text-[11px] text-amber-200 p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/30">
            <i class="fa-solid fa-heart mr-1"></i>찜한 곳 중 빠진 곳: ${plan.missingLiked.map(placeName).join(', ')}</p>` : ''}
          ${plan.days.map((d) => {
            const c = dayCounts(d);
            const done = applied.has(d.date);
            return html`
            <section class="glass-card rounded-2xl p-3 ${done ? 'opacity-60' : ''}">
              <div class="flex items-center justify-between gap-2 mb-2">
                <div class="flex items-center gap-1.5">
                  <h4 class="text-xs font-black text-white">${dayText(d.date)}</h4>
                  <button data-action="day-map" data-d="${d.date}" class="text-[10px] px-1.5 py-0.5 rounded-md border ${state.mapDay === d.date ? 'bg-purple-500/30 text-purple-100 border-purple-400/60' : 'bg-slate-800 text-slate-400 border-white/10'}"><i class="fa-solid fa-map mr-0.5"></i>지도</button>
                </div>
                ${done ? html`<span class="text-[10px] text-emerald-300"><i class="fa-solid fa-check mr-0.5"></i>적용함</span>`
                  : c.add || c.remove ? html`<button data-action="apply-day" data-d="${d.date}" class="text-[10px] px-2 py-1 rounded-lg bg-slate-800 border border-white/10 text-purple-200 font-bold">이 날만 적용 · ${countText(c)}</button>`
                  : html`<span class="text-[10px] text-slate-500">바뀌는 것 없음</span>`}
              </div>
              ${state.mapDay === d.date ? html`<div id="ap-map" class="h-48 rounded-xl overflow-hidden mb-2 z-10 relative flex items-center justify-center text-[10px] text-slate-500">지도 불러오는 중...</div>` : ''}
              <div class="space-y-1">
                ${d.rows.map((r) => r.kind === 'fixed' ? (() => { const it = store.get('itinerary_items', r.itemId); return it ? html`
                  <div class="flex items-center gap-2 text-[11px] text-slate-400 px-2 py-1">
                    <span class="font-mono w-10 flex-shrink-0">${shortHM(it.start_time) || '--:--'}</span>
                    <span class="truncate">${it.title}</span><span class="ml-auto text-[9px] flex-shrink-0">기존</span></div>` : ''; })() : html`
                  <div class="px-2 py-1.5 rounded-lg bg-purple-500/10 border border-purple-400/20">
                    <div class="flex items-center gap-2 text-[11px]">
                      <span class="font-mono w-10 flex-shrink-0 text-purple-200">${r.time || '--:--'}</span>
                      <i class="fa-solid ${r.icon} text-[10px] text-purple-300 w-3"></i>
                      <span class="font-bold text-white truncate">${r.title}</span>
                      <span class="ml-auto text-[9px] px-1 rounded bg-purple-500/30 text-purple-100 flex-shrink-0">AI</span>
                    </div>
                    ${r.placeId && r.title !== placeName(r.placeId) ? html`<p class="text-[10px] text-slate-400 pl-12 truncate">${placeName(r.placeId)}</p>` : ''}
                    ${r.note ? html`<p class="text-[10px] text-slate-300 pl-12">${r.note}</p>` : ''}
                    ${r.issue ? html`<p class="text-[10px] text-rose-300 pl-12"><i class="fa-solid fa-triangle-exclamation mr-0.5"></i>${r.issue}</p>` : ''}
                    ${r.order ? html`<p class="text-[10px] text-amber-300 pl-12"><i class="fa-solid fa-clock mr-0.5"></i>${r.order}</p>` : ''}
                  </div>`)}
                ${d.removed.map((id) => { const it = store.get('itinerary_items', id); return it ? html`
                  <div class="flex items-center gap-2 text-[11px] text-rose-300/70 px-2 py-1 line-through">
                    <span class="font-mono w-10 flex-shrink-0">${shortHM(it.start_time) || '--:--'}</span>
                    <span class="truncate">${it.title}</span><span class="ml-auto text-[9px] no-underline flex-shrink-0">지움</span></div>` : ''; })}
                ${d.warnings.map((w) => html`<p class="text-[10px] text-amber-300 px-2">${w}</p>`)}
              </div>
            </section>`;
          })}
          ${todo.length ? html`<button data-action="apply-all" class="btn-primary w-full">전체 적용 · ${countText(sum)}</button>` : html`<p class="text-center text-[11px] text-emerald-300">모두 적용했어요.</p>`}
          <div class="grid grid-cols-2 gap-2">
            <button data-action="back" class="btn-ghost"><i class="fa-solid fa-sliders mr-1"></i>조건 바꿔 다시</button>
            <button data-action="discard" class="btn-ghost">미리보기 닫기</button>
          </div>
          <p class="text-[10px] text-slate-500 text-center">${lp.meta || ''}</p>
        </div>`;
    }

    // ---------- 실행 ----------
    async function run() {
      if (state.busy || !canRun()) return;
      const chosen = dates.filter((d) => state.dates.has(d));
      if (!chosen.length) return;
      state.text = ($('#ap-text', el)?.value || '').trim().slice(0, MAX_TEXT);
      const { body, ctx } = buildPlanRequest({
        trip: store.trip, places: store.list('places'), items: store.list('itinerary_items'),
        dayHeaders: store.list('itinerary_days'), categoryOf: (id) => store.category(id),
        dates: chosen, mode: state.mode, keepIds: state.keep || new Set(),
        density: state.density, likeMode: state.likeMode, likes, text: state.text,
        start: state.start, end: state.end, skipVisited: state.skipVisited, cats: state.cats,
      });
      if (!body.places.some((p) => !p.anchor)) { toast('후보 장소가 없어요. 후보 카테고리를 골라 주세요.', 'error'); return; }
      state.busy = true;
      render();
      const prog = $('#ap-progress', el);
      prog.classList.remove('hidden');
      const ticker = progressTicker((text, done) => {
        setHTML(prog, html`<i class="fa-solid fa-spinner fa-spin mr-1"></i>${text}${done.length ? html` <span class="text-slate-500">(${done.join(' · ')})</span>` : ''}`);
      });
      try {
        const r = await streamFunction('plan-itinerary', { tripId: store.tripId, request: body }, ticker.onEvent);
        if (!access.admin) { access.used_today = (access.used_today || 0) + 1; access.trip_used = (access.trip_used || 0) + 1; }
        const plan = validatePlan(r, ctx, {
          getPlace: (id) => store.get('places', id), getItem: (id) => store.get('itinerary_items', id), categoryOf: (id) => store.category(id),
        });
        if (!plan.added) { toast('AI 가 넣을 만한 일정을 찾지 못했어요. 조건을 바꿔 보세요.', 'error'); return; }
        const sec = r.timings?.total ? `${(r.timings.total / 1000).toFixed(1)}초` : '';
        lastPlan.set(store.tripId, {
          plan, applied: new Set(), batch: crypto.randomUUID(),
          meta: [sec, r.usage?.total ? `토큰 ${Math.round(r.usage.total / 100) / 10}k` : ''].filter(Boolean).join(' · '),
        });
        state.view = 'preview';
      } catch (e) {
        toast(e.message, 'error');
        if (['AI_NOT_ALLOWED', 'GOOGLE_REQUIRED', 'AI_PLAN_LIMIT', 'AI_LIMIT'].includes(e.code)) {
          try { access = await rpc('ai_plan_status', { p_trip: store.tripId }); } catch { /* 그대로 */ }
        }
      } finally {
        ticker.stop();
        state.busy = false;
        render();
      }
    }

    // ---------- 적용 ----------
    function apply(datesToApply) {
      const lp = lastPlan.get(store.tripId);
      if (!lp) return;
      const ds = datesToApply.filter((d) => !lp.applied.has(d));
      if (!ds.length) return;
      const rec = applyPlan(store, lp.plan, ds, lp.batch);
      ds.forEach((d) => lp.applied.add(d));
      // 같은 실행에서 날짜를 나눠 적용하면 되돌리기 기록을 합침
      const prev = loadUndo(store.tripId);
      const merged = prev?.batch === lp.batch
        ? { ...prev, inserted: [...prev.inserted, ...rec.inserted], removed: [...prev.removed, ...rec.removed], dates: [...prev.dates, ...rec.dates] }
        : rec;
      saveUndo(merged);
      toast(`일정을 적용했어요. ${rec.inserted.length}개 추가${rec.removed.length ? `, ${rec.removed.length}개 지움` : ''} · 일정 탭에서 되돌릴 수 있어요.`);
      onApplied(ds[0]);
      if (lp.plan.days.every((d) => lp.applied.has(d.date) || !(dayCounts(d).add || dayCounts(d).remove))) {
        lastPlan.delete(store.tripId);
        closeSheet();
        return;
      }
      render();
    }

    const off = delegate(el, {
      date: (b) => { const d = b.dataset.d; if (state.dates.has(d)) state.dates.delete(d); else state.dates.add(d); state.keep = null; render(); },
      mode: (b) => { state.mode = b.dataset.v; render(); },
      density: (b) => { state.density = b.dataset.v; render(); },
      cat: (b) => { state.text = $('#ap-text', el)?.value ?? state.text; const id = b.dataset.id; if (state.cats.has(id)) state.cats.delete(id); else state.cats.add(id); render(); },
      'cat-all': () => {
        const ids = groupCategories(store.categories(), store.list('places')).groups.flatMap((g) => g.cats.map((c) => c.id));
        const all = ids.every((id) => state.cats.has(id));
        state.cats = all ? new Set() : new Set(ids);
        render();
      },
      'day-map': (b) => { state.mapDay = state.mapDay === b.dataset.d ? null : b.dataset.d; render(); },
      like: (b) => { state.likeMode = b.dataset.v; render(); },
      run: () => run(),
      'apply-day': (b) => apply([b.dataset.d]),
      'apply-all': () => apply(lastPlan.get(store.tripId)?.plan.days.map((d) => d.date) || []),
      back: () => { state.view = 'form'; render(); },
      discard: () => {
        const lp = lastPlan.get(store.tripId);
        if (lp && !lp.applied.size && !confirmAction('이 미리보기를 버릴까요? 다시 보려면 1회를 더 써야 해요.')) return;
        lastPlan.delete(store.tripId);
        state.view = 'form';
        render();
      },
      request: async () => {
        try {
          await rpc('request_ai_access', { p_message: null });
          access = await rpc('ai_plan_status', { p_trip: store.tripId });
          render();
          toast('사용을 요청했어요. 관리자가 승인하면 쓸 수 있어요.');
        } catch (e) { toast(errorText(e), 'error'); }
      },
      google: () => startGoogleLogin({ hasLocalTrips: true }),
    });
    // 입력 중에는 다시 그리지 않음 (글자 수만)
    const onInput = (e) => {
      if (e.target.id === 'ap-text') { state.text = e.target.value; const c = $('#ap-count', el); if (c) c.textContent = String(e.target.value.length); }
    };
    const onChange = (e) => {
      if (e.target.id === 'ap-start') { state.start = e.target.value || '09:00'; return; }
      if (e.target.id === 'ap-end') { state.end = e.target.value || '21:00'; return; }
      if (e.target.id === 'ap-skip-visited') { state.skipVisited = e.target.checked; state.text = $('#ap-text', el)?.value ?? state.text; render(); return; }
      const id = e.target.dataset?.keep;
      if (!id) return;
      if (e.target.checked) state.keep.add(id); else state.keep.delete(id);
      state.text = $('#ap-text', el)?.value ?? state.text;
      render();
    };
    el.addEventListener('input', onInput);
    el.addEventListener('change', onChange);
    render();
    return () => { off(); previewMap?.remove(); el.removeEventListener('input', onInput); el.removeEventListener('change', onChange); };
  });
}
