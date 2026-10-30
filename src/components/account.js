import { html, delegate, formValues, $ } from '../lib/dom.js';
import { openSheet, closeSheet, toast, confirmAction } from './ui.js';
import { getUser, isAnonymous, signInWithGoogle, linkGoogle, signOut, pendingChanges } from '../lib/auth.js';
import { rpc, errorText } from '../lib/supabase.js';
import { navigate } from '../router.js';

// =====================================================================
// 계정 관련 공통 UI
//  - 로그인은 선택: 익명으로도 쓸 수 있고, 여러 기기를 쓰고 싶은 사람만 Google 로그인
//  - 로그인 안 하는 사람은 "기기 추가 코드"로 다른 기기를 같은 멤버로 연결
// =====================================================================

export async function accountChip() {
  const user = await getUser();
  if (!user || isAnonymous(user)) {
    return html`<button data-action="account-login" class="text-[10px] px-2 py-1 rounded-lg glass-card text-slate-300">
      <i class="fa-brands fa-google mr-1 text-neon-cyan"></i>로그인</button>`;
  }
  return html`<button data-action="account-menu" class="text-[10px] px-2 py-1 rounded-lg glass-card text-emerald-300 max-w-40 truncate">
    <i class="fa-solid fa-circle-user mr-1"></i>${user.email || 'Google 계정'}</button>`;
}

// 익명 상태에서 Google 로그인을 누른 경우
//  - 이 기기에서 쓰던 기록이 없으면: 바로 로그인
//  - 기록이 있으면: "이 기기 기록을 Google 에 연결" vs "이미 쓰던 Google 계정으로 로그인" 선택
export async function startGoogleLogin({ hasLocalTrips = false } = {}) {
  const user = await getUser();
  if (!user || !isAnonymous(user) || !hasLocalTrips) {
    return signInWithGoogle().catch((e) => toast(errorText(e), 'error'));
  }
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">Google 로그인</h3>
    <p class="text-[11px] text-slate-400 mb-3">이 기기에서 이미 참여 중인 여행이 있어요. 어떤 경우인가요?</p>
    <div class="space-y-2">
      <button data-action="link" class="w-full text-left glass-card p-3 rounded-2xl">
        <b class="text-xs text-white">처음으로 Google 계정을 쓰는 경우</b>
        <span class="block text-[10px] text-slate-400 mt-0.5">지금 이 기기의 참여 기록을 Google 계정에 그대로 연결합니다. 이후 다른 기기에서 같은 계정으로 로그인하면 됩니다.</span>
      </button>
      <button data-action="login" class="w-full text-left glass-card p-3 rounded-2xl">
        <b class="text-xs text-white">이미 다른 기기에서 Google 로 쓰고 있는 경우</b>
        <span class="block text-[10px] text-slate-400 mt-0.5">그 계정으로 로그인합니다. 이 기기에서 임시로 참여한 이름은 그 계정과 합쳐지지 않아요.</span>
      </button>
    </div>`, (el) => delegate(el, {
    link: () => linkGoogle().catch((e) => toast(errorText(e), 'error')),
    login: () => signInWithGoogle().catch((e) => toast(errorText(e), 'error')),
  }));
}

export function openAccountMenu(user) {
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">내 계정</h3>
    <p class="text-[11px] text-slate-400 mb-3">${user?.email || ''}</p>
    <p class="text-[11px] text-slate-300 leading-relaxed mb-3">다른 기기에서도 같은 Google 계정으로 로그인하면 같은 사람으로 인식돼요.</p>
    <button data-action="logout" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">로그아웃</button>
  `, (el) => delegate(el, {
    logout: async () => {
      const pending = pendingChanges();
      const msg = pending
        ? `아직 서버로 보내지 못한 변경이 ${pending}건 있어요. 로그아웃하면 사라집니다. 계속할까요?`
        : '로그아웃할까요? 이 기기에 저장된 여행 데이터도 함께 지워집니다.';
      if (!confirmAction(msg)) return;
      await signOut();
      closeSheet();
      toast('로그아웃했습니다.');
      navigate('/', { replace: true });
    },
  }));
}

// 다른 기기에서 받은 코드 입력 → 같은 멤버로 연결
export function openDeviceCodeEntry() {
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">기기 추가 코드 입력</h3>
    <p class="text-[11px] text-slate-400 mb-3 leading-relaxed">
      이미 쓰고 있는 기기에서 <b class="text-slate-200">멤버 탭 → 다른 기기에서도 쓰기</b>를 누르면 8자리 코드가 나와요. (10분간 유효)</p>
    <form id="device-code-form" class="space-y-2.5">
      <input name="code" class="input text-center font-mono text-lg tracking-[0.3em] uppercase" maxlength="12"
             autocomplete="off" autocapitalize="characters" placeholder="ABCD2345" required>
      <button class="btn-primary">연결하기</button>
    </form>`, (el) => {
    const form = $('#device-code-form', el);
    form.elements.code.focus();
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { code } = formValues(form);
      const btn = form.querySelector('button');
      btn.disabled = true;
      try {
        const tripId = await rpc('redeem_device_code', { p_code: code });
        closeSheet();
        toast('이 기기를 연결했습니다.');
        navigate(`/trip/${tripId}/places`);
      } catch (err) {
        toast(errorText(err), 'error');
        btn.disabled = false;
      }
    });
  });
}

// 기존 기기에서 코드 발급
export async function openDeviceCodeIssue(tripId) {
  let res;
  try { res = await rpc('create_device_code', { p_trip: tripId }); } catch (e) { toast(errorText(e), 'error'); return; }
  const pretty = `${res.code.slice(0, 4)} ${res.code.slice(4)}`;
  const expires = new Date(res.expires_at).getTime();
  let timer;
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">다른 기기에서도 쓰기</h3>
    <p class="text-[11px] text-slate-400 mb-3 leading-relaxed">새 기기에서 이 사이트를 열고 <b class="text-slate-200">홈 → 기기 추가 코드</b>(또는 초대 링크 화면)에 아래 코드를 입력하세요.</p>
    <div class="glass-card rounded-2xl p-5 text-center">
      <div class="text-3xl font-black font-mono tracking-[0.25em] text-neon-cyan select-all">${pretty}</div>
      <div id="code-timer" class="text-[11px] text-slate-400 mt-2 font-mono"></div>
    </div>
    <p class="text-[10px] text-slate-500 mt-2">한 번만 쓸 수 있어요. 코드를 다른 사람에게 보내면 그 사람도 내 이름으로 연결되니 주의하세요.</p>
  `, (el) => {
    const tick = () => {
      const left = Math.max(0, Math.round((expires - Date.now()) / 1000));
      const t = $('#code-timer', el);
      if (t) t.textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} 남음` : '만료됨 · 다시 발급해 주세요';
      if (!left) clearInterval(timer);
    };
    tick();
    timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  });
}
