import { html, setHTML, delegate, formValues, $ } from '../lib/dom.js';
import { ensureUser } from '../lib/auth.js';
import { rpc, errorText } from '../lib/supabase.js';
import { toast } from '../components/ui.js';
import { navigate } from '../router.js';
import { currencyOptions } from '../lib/currency.js';
import { fetchRate } from '../lib/fx.js';

const TIMEZONES = (() => {
  try { return Intl.supportedValuesOf('timeZone'); } catch { return ['Asia/Seoul', 'Asia/Tokyo', 'UTC']; }
})();

export async function render(app) {
  await ensureUser().catch(() => {});
  const localTz = Intl.DateTimeFormat().resolvedOptions().timeZone;

  setHTML(app, html`
    <header class="px-4 py-3 glass-nav sticky top-0 z-40 flex items-center gap-2" style="padding-top:calc(0.75rem + env(safe-area-inset-top))">
      <button data-action="back" class="w-8 h-8 rounded-lg text-slate-300"><i class="fa-solid fa-chevron-left"></i></button>
      <h1 class="text-sm font-black text-white">새 여행 만들기</h1>
    </header>
    <form id="create-form" class="p-4 space-y-3">
      <div class="glass-card p-4 rounded-2xl space-y-3">
        <div><label class="label">생성 코드 *</label>
          <input name="code" class="input font-mono uppercase" required placeholder="관리자에게 받은 코드"></div>
        <div><label class="label">여행 이름 *</label>
          <input name="title" class="input" required maxlength="80" placeholder="예: 2027 교토 단풍 여행"></div>
        <div class="grid grid-cols-[1fr_auto] gap-2">
          <div><label class="label">여행지</label><input name="destination" class="input" maxlength="80" placeholder="예: 교토"></div>
          <div><label class="label">이모지</label><input name="emoji" class="input w-16 text-center" maxlength="4" placeholder="✈️"></div>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="label">시작일</label><input type="date" name="start" class="input"></div>
          <div><label class="label">종료일</label><input type="date" name="end" class="input"></div>
        </div>
        <div><label class="label">현지 시간대 (일정 시간 기준)</label>
          <select name="tz" class="input">${TIMEZONES.map((z) => html`<option ${z === localTz ? 'selected' : ''}>${z}</option>`)}</select></div>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="label">내 통화</label>
            <select name="home" class="input">${currencyOptions('KRW').map((o) => html`<option value="${o.code}" ${o.selected ? 'selected' : ''}>${o.label}</option>`)}</select></div>
          <div><label class="label">현지 통화</label>
            <select name="local" class="input">${currencyOptions('JPY').map((o) => html`<option value="${o.code}" ${o.selected ? 'selected' : ''}>${o.label}</option>`)}</select></div>
        </div>
        <p class="text-[10px] text-slate-500 -mt-1">환율은 만들 때 자동으로 채워져요. 가계부 → 예산 관리에서 바꿀 수 있어요.</p>
        <div><label class="label">내 이름 (이 여행에서 표시) *</label>
          <input name="owner" class="input" required maxlength="20" placeholder="예: 준"></div>
      </div>
      <button class="btn-primary" type="submit">여행 만들기</button>
    </form>
  `);

  $('#create-form', app).addEventListener('submit', async (e) => {
    e.preventDefault();
    const v = formValues(e.target);
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true;
    const ratePromise = fetchRate(v.local, v.home).catch(() => null);   // 여행 만드는 동안 같이 조회
    try {
      const tripId = await rpc('create_trip', {
        p_code: v.code.toUpperCase(), p_title: v.title, p_owner_name: v.owner,
        p_destination: v.destination, p_start_date: v.start, p_end_date: v.end,
        p_timezone: v.tz, p_home_currency: v.home, p_local_currency: v.local,
      });
      const { supabase } = await import('../lib/supabase.js');
      if (v.emoji) await supabase.from('trips').update({ cover_emoji: v.emoji }).eq('id', tripId);
      // 환율 자동 채우기 (실패해도 여행 만들기는 그대로 진행, 나중에 예산 관리에서 설정)
      const r = await Promise.race([ratePromise, new Promise((ok) => setTimeout(() => ok(null), 4000))]);
      if (r?.rate) await supabase.from('trip_budgets').update({ rate: r.rate }).eq('trip_id', tripId);
      toast('여행이 만들어졌습니다!');
      navigate(`/trip/${tripId}/more`, { replace: true });
    } catch (err) {
      toast(errorText(err), 'error');
      btn.disabled = false;
    }
  });

  return { cleanup: delegate(app, { back: () => navigate('/') }) };
}
