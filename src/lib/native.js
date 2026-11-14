// =====================================================================
// 안드로이드 앱(Capacitor) 안에서만 켜지는 기능 — 서재 앱(Maruid/seojae)의 native.js 를 여행앱에 맞게 옮김
//   웹(크롬·PWA)에서는 isApp() 이 false → 여기 기능은 아무것도 하지 않음 (웹 동작은 그대로)
//   - 로그인 · 계정 연결: 크롬 탭으로 구글 로그인 → io.github.maruid.travel://login 으로 앱에 돌아옴 → 코드 교환
//     (구글은 앱 안 WebView 로그인을 막음)
//   - 웹 화면 업데이트: GitHub Pages 의 app/version.json 을 보고 새 묶음을 받아 "새로고침" 때 적용
//   - 앱 업데이트 안내: 새 웹 화면이 필요로 하는 앱 기능 버전(min_native_api)보다 앱이 낮으면 APK 받기 안내
//   - 공유: 앱 WebView 에는 navigator.share 가 없어서 안드로이드 공유 창(@capacitor/share)
//   - 뒤로가기: Capacitor 기본 동작(웹 기록이 있으면 뒤로, 없으면 종료)이 back-nav.js 의 기록 규칙과 그대로 맞물림
// =====================================================================
import { registerPlugin, SystemBars } from '@capacitor/core';

export const APP_SCHEME = 'io.github.maruid.travel';
export const APP_LOGIN_URL = `${APP_SCHEME}://login`;
export const APK_URL = 'https://github.com/Maruid/Travel_project/releases/latest/download/travel.apk';
const PAGES_URL = 'https://maruid.github.io/Travel_project/';
const BUNDLE = import.meta.env?.VITE_APP_BUNDLE || 'dev';   // 이 웹 묶음의 버전 (빌드 때 커밋 해시)
const RETURN_KEY = 'auth:returnTo';

export const isApp = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
export const isAndroid = () => typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);

let travel = null;
const plugin = () => (travel ||= registerPlugin('Travel'));

// ---- 앱 쪽 기능 버전 ----
let nativeApi = null;
export async function nativeApiLevel() {
  if (!isApp()) return 0;
  if (nativeApi != null) return nativeApi;
  try { nativeApi = (await plugin().info()).api || 0; } catch { nativeApi = 0; }
  return nativeApi;
}

// ---- 로그인 · 계정 연결 (크롬 탭) ----
//   link: 익명 계정에 Google 연결(linkIdentity). 둘 다 PKCE → 돌아온 ?code= 를 교환
export async function appSignIn(supabase, { link = false } = {}) {
  try { sessionStorage.setItem(RETURN_KEY, location.hash || '#/'); } catch {}
  const options = { redirectTo: APP_LOGIN_URL, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } };
  const { data, error } = link
    ? await supabase.auth.linkIdentity({ provider: 'google', options })
    : await supabase.auth.signInWithOAuth({ provider: 'google', options });
  if (error) throw error;
  if (!data?.url) throw new Error('로그인 주소를 받지 못했어요.');
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url: data.url });
}

// 크롬 탭에서 앱으로 돌아온 주소 처리 → 처리했으면 true
async function handleAuthUrl(url, supabase, toast) {
  if (!url?.startsWith(APP_LOGIN_URL)) return false;
  try { const { Browser } = await import('@capacitor/browser'); await Browser.close(); } catch {}
  let u;
  try { u = new URL(url.replace(`${APP_SCHEME}://`, 'https://app/')); } catch { return false; }
  const q = u.searchParams;
  const h = new URLSearchParams(u.hash.slice(1));
  const err = q.get('error_description') || h.get('error_description') || q.get('error') || h.get('error');
  if (err) {
    const used = /identity_already_exists|already.*(linked|exists)/i.test(`${q.get('error_code') || ''} ${err}`);
    toast(used
      ? '이 Google 계정은 이미 사용 중이에요. 홈의 로그인 → "이미 다른 기기에서 Google 로 쓰고 있는 경우"를 선택하세요.'
      : `로그인하지 못했어요. ${err}`, 'error');
    return true;
  }
  const code = q.get('code');
  if (!code) return true;
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) { toast('로그인하지 못했어요. 다시 시도해 주세요.', 'error'); return true; }
  let back = '#/';
  try { back = sessionStorage.getItem(RETURN_KEY) || '#/'; sessionStorage.removeItem(RETURN_KEY); } catch {}
  location.hash = back;
  location.reload();
  return true;
}

// ---- 웹 화면 묶음 업데이트 ----
async function checkBundle({ showBar }) {
  if (!navigator.onLine) return;
  let info;
  try {
    const r = await fetch(`${PAGES_URL}app/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return;
    info = await r.json();
  } catch { return; }
  const api = await nativeApiLevel();
  // 새 웹 화면이 이 앱보다 새 앱 기능을 필요로 하면 묶음은 바꾸지 않고 앱 업데이트 안내
  if ((info.min_native_api || 0) > api) {
    showBar({ text: '앱을 업데이트해 주세요.', action: '받기', run: () => openExternal(info.apk || APK_URL) });
    return;
  }
  if (!info.version || !info.url || info.version === BUNDLE) return;
  try {
    const { CapacitorUpdater } = await import('@capgo/capacitor-updater');
    const cur = await CapacitorUpdater.current();
    if (cur?.bundle?.version === info.version) return;
    const listed = await CapacitorUpdater.list().catch(() => ({ bundles: [] }));
    let b = (listed.bundles || []).find((x) => x.version === info.version && x.status !== 'error');
    if (!b) b = await CapacitorUpdater.download({ url: info.url, version: info.version });
    await CapacitorUpdater.next({ id: b.id });   // 다음에 앱을 열 때 적용
    showBar({ text: '새 버전이 있어요.', action: '새로고침', run: () => CapacitorUpdater.set({ id: b.id }) });
  } catch {}
}

// ---- 바깥 열기 · 공유 ----
export async function openExternal(url) {
  if (!isApp()) { window.open(url, '_blank', 'noopener'); return; }
  try { const { Browser } = await import('@capacitor/browser'); await Browser.open({ url }); } catch { location.href = url; }
}

// 공유 창을 쓸 수 있는지 (앱 · 공유 기능이 있는 브라우저)
export const canShare = () => isApp() || !!navigator.share;

// { title, text, url } → 앱: 안드로이드 공유 창, 웹: navigator.share. 취소는 조용히
export async function shareContent({ title, text, url }) {
  if (isApp()) {
    try {
      const { Share } = await import('@capacitor/share');
      await Share.share({ title, text, url, dialogTitle: title || '공유' });
    } catch {}
    return;
  }
  await navigator.share?.({ title, text, url }).catch(() => {});
}

// ---- 앱 시작 때 (main.js boot) ----
export async function initApp({ supabase, toast, showBar, onResume = null }) {
  if (!isApp()) return;
  document.documentElement.classList.add('is-app');
  // 앱 배경이 늘 어두우므로 상태바 · 제스처 바 글자는 밝게
  SystemBars?.setStyle?.({ style: 'DARK' })?.catch?.(() => {});
  // 새 묶음이 제대로 열렸다고 알림 (안 하면 15초 뒤 예전 묶음으로 되돌림)
  import('@capgo/capacitor-updater').then(({ CapacitorUpdater }) => CapacitorUpdater.notifyAppReady()).catch(() => {});

  // 로그인 복귀 (앱이 떠 있을 때 · 꺼져 있다가 열렸을 때)
  try {
    const { App } = await import('@capacitor/app');
    App.addListener('appUrlOpen', ({ url }) => { handleAuthUrl(url, supabase, toast); })?.catch?.(() => {});
    // 앱 쪽이 답하지 않아도 시작이 멈추지 않게 2초까지만 기다림
    const launch = await Promise.race([App.getLaunchUrl().catch(() => null), new Promise((r) => setTimeout(() => r(null), 2000))]);
    if (launch?.url) await handleAuthUrl(launch.url, supabase, toast);
    // 다시 앱으로 돌아올 때마다 업데이트 확인
    App.addListener('resume', () => { checkBundle({ showBar }); onResume?.(); })?.catch?.(() => {});
  } catch {}
  setTimeout(() => checkBundle({ showBar }), 4000);
}
