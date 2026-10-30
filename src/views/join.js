import { html, setHTML, delegate, formValues, $ } from '../lib/dom.js';
import { ensureUser } from '../lib/auth.js';
import { rpc, errorText } from '../lib/supabase.js';
import { spinner, toast } from '../components/ui.js';
import { navigate } from '../router.js';
import { startGoogleLogin, openDeviceCodeEntry } from '../components/account.js';

export async function render(app, { token }) {
  setHTML(app, spinner('초대 정보를 확인하는 중...'));

  let preview;
  try {
    await ensureUser();
    preview = await rpc('preview_invite', { p_token: token });
  } catch (e) {
    setHTML(app, html`
      <main class="p-6 text-center space-y-4 mt-20">
        <i class="fa-solid fa-link-slash text-3xl text-rose-400"></i>
        <p class="text-sm text-slate-300">${errorText(e)}</p>
        <button data-action="home" class="btn-ghost">홈으로</button>
      </main>`);
    return { cleanup: delegate(app, { home: () => navigate('/') }) };
  }

  const { trip, already_member, claimable_members } = preview;
  if (already_member) {
    navigate(`/trip/${trip.id}/places`, { replace: true });
    return;
  }

  setHTML(app, html`
    <main class="p-5 space-y-4">
      <div class="p-3 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-200 leading-relaxed">
        <b>다른 기기에서 이미 이 여행에 참여 중인가요?</b> 새 이름으로 참여하면 같은 사람이 두 명으로 나뉘어요.
        <div class="grid grid-cols-2 gap-2 mt-2">
          <button data-action="google" class="btn-ghost py-2"><i class="fa-brands fa-google mr-1"></i>Google 로그인</button>
          <button data-action="device-code" class="btn-ghost py-2"><i class="fa-solid fa-key mr-1"></i>기기 추가 코드</button>
        </div>
      </div>

      <div class="glass-card p-5 rounded-2xl text-center">
        <div class="text-4xl mb-2">${trip.cover_emoji || '✈️'}</div>
        <p class="text-[10px] text-neon-cyan font-mono font-bold">INVITATION</p>
        <h1 class="text-lg font-black text-white mt-1">${trip.title}</h1>
        <p class="text-xs text-slate-400 mt-1">${trip.destination || ''} ${trip.start_date ? `· ${trip.start_date} ~ ${trip.end_date || ''}` : ''}</p>
      </div>

      ${claimable_members.length ? html`
        <div class="glass-card p-4 rounded-2xl">
          <p class="text-xs font-bold text-slate-300 mb-1">이미 등록된 이름 중에 내가 있나요?</p>
          <p class="text-[10px] text-slate-500 mb-3">선택하면 그 이름으로 기록된 지출·일정과 연결됩니다.</p>
          <div class="flex flex-wrap gap-2">
            ${claimable_members.map((m) => html`
              <button data-action="claim" data-id="${m.id}" data-name="${m.display_name}" class="btn-ghost">
                <i class="fa-solid fa-user mr-1 text-neon-cyan"></i>${m.display_name}
              </button>`)}
          </div>
        </div>` : ''}

      <form id="join-form" class="glass-card p-4 rounded-2xl space-y-3">
        <p class="text-xs font-bold text-slate-300">${claimable_members.length ? '새 이름으로 참여' : '이 여행에서 사용할 이름'}</p>
        <input name="name" class="input" maxlength="20" placeholder="예: 준" required>
        <button class="btn-primary" type="submit">참여하기</button>
      </form>
    </main>
  `);

  async function join(name, claimId = null) {
    try {
      const tripId = await rpc('join_trip', { p_token: token, p_display_name: name, p_claim_member: claimId });
      toast('여행에 참여했습니다!');
      navigate(`/trip/${tripId}/places`, { replace: true });
    } catch (e) {
      toast(errorText(e), 'error');
    }
  }

  const off = delegate(app, {
    claim: (el) => {
      if (confirm(`"${el.dataset.name}" (으)로 참여할까요?`)) join(el.dataset.name, el.dataset.id);
    },
    google: () => startGoogleLogin({ hasLocalTrips: false }),
    'device-code': () => openDeviceCodeEntry(),
  });
  $('#join-form', app).addEventListener('submit', (e) => {
    e.preventDefault();
    const { name } = formValues(e.target);
    if (name) join(name);
  });
  return { cleanup: off };
}
