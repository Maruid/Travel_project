// =====================================================================
// AI 가이드 카드 (Edge Function guide-cards, migration_016)
//   네 가지 카드: 날씨 · 옷차림 / 명소 체크포인트 / 입국 · 출국 동선 / 숙소 정보
//   - 필요한 정보가 다 등록됐을 때만 [만들기] (빠진 것을 카드에 표시)
//   - 권한: AI 추천과 같음. 하루 한도 같이 씀, 카드마다 여행당 3번 (관리자 무제한)
//   - 결과는 가이드 카드로 저장 (같은 종류가 있으면 그 카드를 새 내용으로 바꿈) · AI 표시 · 만든 날짜 · 출처
// =====================================================================
import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { openSheet, closeSheet, toast, confirmAction } from '../components/ui.js';
import { rpc, errorText } from '../lib/supabase.js';
import { streamFunction, progressTicker } from '../lib/ai-stream.js';
import { startGoogleLogin } from '../components/account.js';
import { GUIDE_CARDS, cardOf, guideGaps, buildGuideRequest, guideBody } from '../lib/ai-guide.js';
import { todayIn } from '../lib/format.js';

const dataOf = (store) => ({
  trip: store.trip, places: store.list('places'), days: store.list('itinerary_days'),
  categoryOf: (id) => store.category(id),
  likes: new Map([...store.likeMap()].map(([id, ids]) => [id, ids.length])),
  transports: store.list('trip_transports'),
});

// 카드를 만든(덮어쓴) 날 M/D
const madeOn = (g) => {
  const d = new Date(g.updated_at || g.created_at || Date.now());
  return `${d.getMonth() + 1}/${d.getDate()}`;
};

export async function openAiGuide(store) {
  if (!navigator.onLine) { toast('온라인 상태에서만 쓸 수 있어요.', 'error'); return; }
  let access;
  try { access = await rpc('ai_guide_status', { p_trip: store.tripId }); } catch (e) {
    toast(/ai_guide_status/.test(e?.message || '') ? '서버 업데이트가 필요해요. 관리자에게 migration_016 적용을 요청해 주세요.' : errorText(e), 'error');
    return;
  }
  let busy = null;   // 만드는 중인 카드

  openSheet(html`
    <div class="flex items-center justify-between mb-1 gap-2">
      <h3 class="text-base font-black text-white"><i class="fa-solid fa-wand-magic-sparkles text-purple-300 mr-1"></i>AI 가이드</h3>
      <span id="ag-quota" class="text-[10px] text-slate-400 text-right"></span>
    </div>
    <p class="text-[11px] text-slate-400 mb-3">등록한 여행 정보로 안내 카드를 만들어요. 다시 만들면 같은 카드를 새 내용으로 바꿔요.</p>
    <div id="ag-body" class="space-y-2"></div>`, (el) => {
    const dayLeft = () => (access.daily_limit == null ? null : Math.max(0, access.daily_limit - (access.used_today || 0)));
    const cardLeft = (k) => (access.card_limit == null ? null : Math.max(0, access.card_limit - (access.card_used?.[k] || 0)));

    function render() {
      $('#ag-quota', el).textContent = access.admin ? '관리자 · 무제한' : access.allowed ? `오늘 ${dayLeft()}번 남음` : '';
      if (!access.allowed) {
        setHTML($('#ag-body', el), html`
          <div class="glass-card p-3 rounded-2xl text-[11px] text-slate-300 space-y-2">
            <p>AI 가이드는 AI 추천 · 일정 짜기와 같이, 관리자가 허용한 사람만 쓸 수 있어요.</p>
            ${!access.google ? html`<button data-action="google" class="btn-ghost w-full py-2"><i class="fa-brands fa-google mr-1"></i>Google 로그인</button>`
              : access.requested ? html`<p class="text-amber-200"><i class="fa-solid fa-hourglass-half mr-1"></i>사용을 요청했어요. 관리자가 승인하면 바로 쓸 수 있어요.</p>`
              : html`<button data-action="request" class="btn-primary w-full">사용 요청하기</button>`}
          </div>`);
        return;
      }
      const data = dataOf(store);
      const existing = new Map(store.list('guides').filter((g) => g.ai_guide).map((g) => [g.ai_guide, g]));
      setHTML($('#ag-body', el), html`${GUIDE_CARDS.map((c) => {
        const gaps = guideGaps(c.key, data);
        const left = cardLeft(c.key);
        const has = existing.get(c.key);
        const blocked = gaps.length || (left != null && left <= 0) || (dayLeft() != null && dayLeft() <= 0);
        const running = busy === c.key;
        return html`
          <div class="glass-card p-3 rounded-2xl border-l-4" style="border-left-color:${c.color}">
            <div class="flex items-start gap-2.5">
              <i class="fa-solid ${c.icon} mt-0.5 w-4 text-center" style="color:${c.color}"></i>
              <div class="flex-1 min-w-0">
                <p class="text-xs font-bold text-white whitespace-nowrap truncate">${c.title}</p>
                <p class="text-[10px] text-slate-400 mt-0.5">${c.desc}</p>
                ${gaps.length ? html`<p class="text-[10px] text-amber-300 mt-1"><i class="fa-solid fa-circle-exclamation mr-1"></i>먼저 등록: ${gaps.join(', ')}</p>` : ''}
                ${running ? html`<p id="ag-progress" class="text-[10px] text-purple-200 mt-1"></p>` : ''}
              </div>
              <div class="flex flex-col items-end gap-1 flex-shrink-0">
                <button data-action="make" data-card="${c.key}" ${blocked || busy ? 'disabled' : ''}
                  class="px-3 h-8 rounded-xl text-[11px] font-bold border ${blocked || busy ? 'bg-slate-800 text-slate-500 border-white/10' : 'bg-purple-500/25 text-purple-100 border-purple-400/50'}">
                  ${running ? html`<i class="fa-solid fa-spinner fa-spin"></i>` : has ? '다시 만들기' : '만들기'}</button>
                ${has ? html`<span class="text-[9px] text-emerald-300/80 whitespace-nowrap"><i class="fa-solid fa-check mr-0.5"></i>${madeOn(has)} 만듦</span>` : ''}
                ${left != null ? html`<span class="text-[9px] text-slate-500 whitespace-nowrap">${left}/${access.card_limit}번 남음</span>` : ''}
              </div>
            </div>
          </div>`;
      })}`);
    }

    async function make(key) {
      const c = cardOf(key);
      const data = dataOf(store);
      if (guideGaps(key, data).length || busy) return;
      const old = store.list('guides').find((g) => g.ai_guide === key);
      if (old && !confirmAction(`'${old.title}' 카드를 새 내용으로 바꿀까요? (직접 고친 내용도 바뀌어요)`)) return;
      busy = key;
      render();
      const ticker = progressTicker((text) => { const p = $('#ag-progress', el); if (p) p.textContent = text; });
      try {
        const r = await streamFunction('guide-cards', { tripId: store.tripId, card: key, request: buildGuideRequest(key, data) }, ticker.onEvent);
        const body = guideBody(r, todayIn(store.trip.timezone));
        if (old) store.update('guides', old.id, { body_md: body });
        else {
          store.insert('guides', {
            title: c.title, body_md: body, color: c.color, icon: c.icon, ai_guide: key, pinned: false,
            sort_order: store.nextSortOrder('guides'),
          });
        }
        if (access.daily_limit != null) access.used_today = (access.used_today || 0) + 1;
        if (access.card_limit != null) access.card_used = { ...access.card_used, [key]: (access.card_used?.[key] || 0) + 1 };
        toast(`'${c.title}' 카드를 ${old ? '새로 바꿨어요' : '만들었어요'}. 가이드 탭에서 볼 수 있어요.`);
      } catch (e) {
        toast(e.message || errorText(e), 'error');
        try { access = await rpc('ai_guide_status', { p_trip: store.tripId }); } catch { /* 그대로 */ }
      } finally {
        ticker.stop();
        busy = null;
        if (el.isConnected) render();
      }
    }

    render();
    return delegate(el, {
      make: (b) => make(b.dataset.card),
      request: async () => {
        try {
          await rpc('request_ai_access', { p_message: null });
          access = await rpc('ai_guide_status', { p_trip: store.tripId });
          render();
          toast('사용을 요청했어요. 관리자가 승인하면 쓸 수 있어요.');
        } catch (e) { toast(errorText(e), 'error'); }
      },
      google: () => startGoogleLogin({ hasLocalTrips: true }),
      close: () => closeSheet(),
    });
  });
}
