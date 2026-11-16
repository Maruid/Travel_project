// "앱" 설정 칸: 여행 안 설정 탭과 홈의 ⚙ (앱 설정) 창에서 같이 씀
//  - 안드로이드 앱: 깔린 버전 · 업데이트 [받기] / 최신이어도 [다시 받기](확인 후), 화면 켜두기
//  - 안드로이드 크롬: [안드로이드 앱 받기] (showApk: 여행이 하나 이상 있는 사람만 홈에서 보임)
//  - 그 외: 웹 앱 설치 안내 · 공통: 화면 정보
import { html, setHTML, delegate } from '../lib/dom.js';
import { openSheet, toast, copyText, confirmAction } from './ui.js';
import { canInstall, promptInstall, isIOS, screenInfo, SCREEN_LABEL } from '../lib/install.js';
import { isStandalone } from '../lib/back-nav.js';
import { isApp, isAndroid, APK_URL, canKeepAwake, keepAwakeOn, setKeepAwake, appUpdateInfo, openExternal } from '../lib/native.js';
import { newFeatures } from '../lib/app-update.js';

function appUpdateBlock() {
  const u = appUpdateInfo();
  const ver = html`<span class="text-slate-500">${u.version ? `앱 ${u.version}` : '앱'}${u.api ? ` · 기능 ${u.api}` : ''}</span>`;
  if (u.state === 'required' || u.state === 'available') {
    const feats = newFeatures(u.api, u.latest || u.api);
    return html`
      <div class="flex items-center gap-2 p-2.5 rounded-xl ${u.state === 'required' ? 'bg-rose-500/10 border border-rose-500/40' : 'bg-neon-cyan/10 border border-neon-cyan/40'}">
        <span class="flex-1 min-w-0 text-[11px]">
          <b class="block ${u.state === 'required' ? 'text-rose-200' : 'text-white'}">${u.state === 'required' ? '앱을 업데이트해 주세요' : '새 앱 버전이 있어요'}</b>
          <span class="block text-[10px] text-slate-400">${feats.length ? `새로 쓸 수 있어요: ${feats.join(', ')}` : '받아서 설치하면 덮어써져요. 여행 데이터는 그대로예요.'}</span>
        </span>
        <button data-action="get-apk-app" class="flex-shrink-0 px-3 py-1.5 rounded-lg bg-neon-cyan text-night-950 text-[11px] font-black whitespace-nowrap">받기</button>
      </div>
      <p class="text-[10px]">${ver}</p>`;
  }
  // 최신(또는 확인 전)이어도 받기 버튼은 늘 보임 → 누르면 정말 받을지 확인
  return html`
    <div class="flex items-center gap-2">
      <span class="flex-1 min-w-0 text-[11px]">
        <span class="block text-emerald-300"><i class="fa-solid fa-check mr-1"></i>안드로이드 앱으로 쓰고 있어요${u.state === 'latest' ? ' · 최신 버전' : ''}.</span>
        <span class="block text-[10px]">${ver}<span class="text-slate-500"> · 화면은 웹을 고치면 자동으로 받아요.</span></span>
      </span>
      <button data-action="get-apk-app" class="flex-shrink-0 px-2.5 py-1.5 rounded-lg bg-slate-800 text-slate-200 border border-white/10 text-[11px] font-bold whitespace-nowrap"><i class="fa-solid fa-download mr-1"></i>다시 받기</button>
    </div>`;
}

export function appSectionHtml({ showApk = true } = {}) {
  return html`
    ${isApp() ? html`${appUpdateBlock()}
        ${canKeepAwake() ? html`
          <label class="flex items-start gap-2 pt-2 border-t border-white/5 cursor-pointer">
            <input type="checkbox" data-action="keep-awake" ${keepAwakeOn() ? 'checked' : ''} class="accent-cyan-400 mt-0.5">
            <span class="text-[11px] text-slate-300">화면 켜두기
              <span class="block text-[10px] text-slate-500">앱이 열려 있는 동안 화면이 꺼지지 않아요. 길 찾거나 일정 볼 때 편해요. 배터리를 더 써요. 이 기기에만 적용돼요.</span></span>
          </label>` : ''}`
      : isAndroid() ? html`${showApk ? html`<button data-action="get-apk" class="btn-primary w-full"><i class="fa-solid fa-download mr-1"></i>안드로이드 앱 받기 (APK)</button>
          <p class="text-[10px] text-slate-500 leading-relaxed">스토어 없이 설치하는 앱이에요. 받은 뒤 알림을 눌러 설치하고, 처음 한 번 "출처를 알 수 없는 앱 설치"를 허용해 주세요. 앱은 크롬과 저장 공간이 따로라, 앱에서 Google 로그인 또는 기기 추가 코드로 이어서 쓰면 돼요.</p>` : ''}
          ${isStandalone() ? html`<p class="text-[10px] text-emerald-300"><i class="fa-solid fa-check mr-1"></i>지금은 설치형 웹 앱으로 쓰고 있어요.</p>`
            : canInstall() ? html`<button data-action="install" class="btn-ghost w-full py-2"><i class="fa-solid fa-mobile-screen-button mr-1"></i>웹 앱으로 설치</button>` : ''}`
      : isStandalone() ? html`<p class="text-[11px] text-emerald-300"><i class="fa-solid fa-check mr-1"></i>설치된 앱으로 쓰고 있어요.</p>`
      : canInstall() ? html`<button data-action="install" class="btn-primary w-full"><i class="fa-solid fa-mobile-screen-button mr-1"></i>앱으로 설치</button>
          <p class="text-[10px] text-slate-500">주소창 없이 넓게 쓰고, 홈 화면 아이콘으로 바로 열려요.</p>`
      : isIOS() ? html`<p class="text-[10px] text-slate-400">Safari 아래 공유 버튼 → "홈 화면에 추가"로 앱처럼 쓸 수 있어요.</p>`
      : html`<p class="text-[10px] text-slate-400">크롬 오른쪽 위 ⋮ → "앱 설치" 또는 "홈 화면에 추가 → 설치"로 앱처럼 쓸 수 있어요.</p>`}
    <button data-action="screen-info" class="btn-ghost w-full py-2"><i class="fa-solid fa-mobile-screen mr-1"></i>화면 정보 (문제 신고용)</button>`;
}

// 위 칸의 버튼 동작. rerender: 상태가 바뀌면 칸을 다시 그림
export function appSectionActions(rerender) {
  return {
    install: async () => {
      const r = await promptInstall();
      if (r === 'accepted') toast('설치했어요. 홈 화면의 앱 아이콘으로 열어 주세요.');
      rerender();
    },
    'get-apk': () => { location.href = APK_URL; },
    'get-apk-app': () => {
      const u = appUpdateInfo();
      if (u.state === 'latest' && !confirmAction(`지금 최신 버전${u.version ? `(${u.version})` : ''}이에요. 업데이트가 필요하지 않아요.\n그래도 앱을 다시 받을까요?`)) return;
      if (u.state === 'unknown' && !confirmAction('최신 버전인지 아직 확인하지 못했어요. 앱을 받을까요?')) return;
      openExternal(u.apk);
    },
    'keep-awake': async (el) => {
      const on = el.checked;
      const ok = await setKeepAwake(on);
      if (!ok) { setKeepAwake(!on); toast('이 앱 버전에서는 쓸 수 없어요. 앱을 업데이트해 주세요.', 'error'); }
      else toast(on ? '앱이 열려 있는 동안 화면이 켜져 있어요.' : '화면 켜두기를 껐어요.');
      rerender();
    },
    'screen-info': () => {
      const info = screenInfo();
      const text = Object.entries(info).map(([k, v]) => `${SCREEN_LABEL[k]}: ${v}`).join('\n');
      openSheet(html`
        <h3 class="text-base font-black text-white mb-2"><i class="fa-solid fa-mobile-screen text-neon-cyan mr-1"></i>화면 정보</h3>
        <div class="glass-card p-3 rounded-2xl space-y-1.5 text-[11px]">
          ${Object.entries(info).map(([k, v]) => html`<div class="flex justify-between gap-3"><span class="text-slate-400 flex-shrink-0">${SCREEN_LABEL[k]}</span><span class="font-mono text-slate-100 text-right">${v}</span></div>`)}
        </div>
        <button data-action="copy-info" class="btn-ghost w-full mt-2"><i class="fa-solid fa-copy mr-1"></i>복사</button>
        <p class="text-[10px] text-slate-500 mt-2">화면이 잘리거나 넘칠 때 이 화면을 캡처하거나 복사해서 보내 주세요.</p>`,
      (el) => delegate(el, { 'copy-info': () => copyText(text, '화면 정보') }));
    },
  };
}

// 홈의 ⚙: 앱 설정 창
export function openAppSettings({ hasTrips = false } = {}) {
  openSheet(html`<div id="app-settings"></div>`, (el) => {
    const box = el.querySelector('#app-settings');
    const draw = () => setHTML(box, html`
      <h3 class="text-base font-black text-white mb-3"><i class="fa-solid fa-gear text-neon-cyan mr-1"></i>앱 설정</h3>
      <div class="glass-card p-4 rounded-2xl space-y-2">${appSectionHtml({ showApk: hasTrips })}</div>`);
    draw();
    const off = delegate(el, appSectionActions(draw));
    window.addEventListener('app:update-info', draw);
    return () => { off(); window.removeEventListener('app:update-info', draw); };
  });
}
