import { supabase } from './supabase.js';
import { APP_URL } from '../config.js';
import { isApp, appSignIn } from './native.js';

const RETURN_KEY = 'auth:returnTo';
const LAST_USER_KEY = 'auth:lastUser';

// 오프라인에서 토큰 갱신이 실패해도 "나"를 알아볼 수 있게 마지막 사용자 정보를 보관
function rememberUser(user) {
  try {
    localStorage.setItem(LAST_USER_KEY, JSON.stringify({ id: user.id, is_anonymous: !!user.is_anonymous, email: user.email ?? null }));
  } catch {}
}
function lastKnownUser() {
  try { return JSON.parse(localStorage.getItem(LAST_USER_KEY) || 'null'); } catch { return null; }
}

// ---------------------------------------------------------------------
// 로그인 확인은 최대 3초만 기다림
//  - 토큰(1시간)이 만료된 채 인터넷이 안 되면 supabase-js 가 갱신을 약 25초 동안 재시도하고,
//    그동안 getSession() 이 끝나지 않음 → 화면이 오래 멈춤
//  - 확인이 안 돼도 기기에 로그인 정보(갱신용 토큰)가 남아 있으면 그 사용자로 동작 ({ offline: true })
// ---------------------------------------------------------------------
const SESSION_TIMEOUT = 3000;
const TIMEOUT = Symbol('timeout');
const withTimeout = (p, ms) => Promise.race([
  Promise.resolve(p).catch(() => null),
  new Promise((r) => setTimeout(() => r(TIMEOUT), ms)),
]);

// 기기에 저장된 로그인 정보 (서버 확인 없이 읽기만)
function storedSession() {
  try {
    const v = JSON.parse(localStorage.getItem(supabase.auth.storageKey) || 'null');
    const s = v?.currentSession ?? v;   // 아주 옛 형식 대비
    return s?.refresh_token ? s : null;
  } catch { return null; }
}
export const hasStoredSession = () => !!storedSession();

function unverifiedUser(stored) {
  const u = stored?.user || lastKnownUser();
  return u?.id ? { id: u.id, is_anonymous: !!u.is_anonymous, email: u.email ?? null, offline: true } : null;
}

// 반환: 확인된 사용자 · 확인 못 한 사용자({ offline: true }) · null(로그인 정보 없음)
export async function getUser({ timeout = SESSION_TIMEOUT } = {}) {
  if (!navigator.onLine) return unverifiedUser(storedSession());
  const r = await withTimeout(supabase.auth.getSession(), timeout);
  const user = r !== TIMEOUT ? r?.data?.session?.user ?? null : null;
  if (user) { rememberUser(user); return user; }
  // 확인 실패(시간 초과 · 일시적 갱신 실패) → 기기에 남아 있으면 그 사용자로. 서버가 거절해 지워졌으면 null
  return unverifiedUser(storedSession());
}

// 서버에 "내 이름으로" 보낼 수 있는 상태인지 (유효한 토큰이 있음)
//  - 재연결 직후 토큰 갱신 전에 보내면 권한 없음으로 거절되고, 예전엔 그 변경을 버렸음 → 보내기 전에 확인
export async function sessionReady(timeout = SESSION_TIMEOUT) {
  if (!navigator.onLine) return false;
  const r = await withTimeout(supabase.auth.getSession(), timeout);
  const s = r !== TIMEOUT ? r?.data?.session : null;
  return !!s?.access_token && (s.expires_at ?? 0) * 1000 > Date.now();
}

// 링크 참여/일반 사용: 세션이 없으면 조용히 익명 로그인
//  - 기기에 로그인 정보가 남아 있으면 절대 새 익명 계정을 만들지 않음 (만들면 이 기기의 참여 기록을 잃음)
//  - 오프라인이면 마지막으로 확인된 사용자로 동작 (읽기 + 변경 큐 쌓기)
export async function ensureUser() {
  const existing = await getUser();
  if (existing) return existing;
  if (!navigator.onLine) throw new Error('OFFLINE');

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  rememberUser(data.user);
  return data.user;
}

// ---------------------------------------------------------------------
// 연결 상태에 맞춘 토큰 자동 갱신
//  - 오프라인: 멈춤 (비행기 모드에서 30초마다 25초짜리 재시도가 도는 것 방지 → 배터리)
//  - 다시 연결: 직전 실패 기억(60초 동안 재시도 안 함)을 지우고 바로 갱신
//  - 한 번 직접 관리하기 시작하면 라이브러리의 화면 전환 처리 대신 아래가 담당
// ---------------------------------------------------------------------
export function setupAuthConnection() {
  const auth = supabase.auth;
  let managed = false;
  const apply = () => {
    if (navigator.onLine && document.visibilityState === 'visible') {
      if ('lastRefreshFailure' in auth) auth.lastRefreshFailure = null;
      auth.startAutoRefresh().catch(() => {});
    } else {
      auth.stopAutoRefresh().catch(() => {});
    }
  };
  const take = () => { managed = true; apply(); };
  window.addEventListener('online', take);
  window.addEventListener('offline', take);
  document.addEventListener('visibilitychange', () => { if (managed) apply(); });
  if (!navigator.onLine) take();
  // 시작 처리(initialize)가 끝난 뒤에도 오프라인이면 다시 멈춤 (그 사이 라이브러리가 다시 켰을 수 있음)
  auth.initializePromise?.then(() => { if (managed) apply(); }).catch(() => {});
}

// 로그아웃 시 보관 정보도 정리
supabase.auth.onAuthStateChange((event, session) => {
  if (event === 'SIGNED_OUT') { try { localStorage.removeItem(LAST_USER_KEY); } catch {} }
  else if (session?.user) rememberUser(session.user);
});

export const isAnonymous = (user) => !!user?.is_anonymous;

// OAuth 는 앱 루트로 돌아오고(?code=), 원래 보던 해시 경로는 sessionStorage 로 복원
function rememberReturn() {
  try { sessionStorage.setItem(RETURN_KEY, location.hash || '#/'); } catch {}
}
export function consumeReturn() {
  try {
    const v = sessionStorage.getItem(RETURN_KEY);
    sessionStorage.removeItem(RETURN_KEY);
    return v;
  } catch { return null; }
}

// 관리자 로그인 (익명 세션이 있으면 대체됨)
export async function signInWithGoogle() {
  if (isApp()) return appSignIn(supabase);   // 앱: 크롬 탭 → io.github.maruid.travel://login 으로 복귀
  rememberReturn();
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: APP_URL },
  });
  if (error) throw error;
}

// 익명 계정에 Google 계정 연결 → 브라우저 데이터를 지워도 owner 권한 유지
// Supabase 대시보드에서 "Manual linking" 을 켜야 동작
export async function linkGoogle() {
  if (isApp()) return appSignIn(supabase, { link: true });
  rememberReturn();
  const { error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: APP_URL },
  });
  if (error) throw error;
}

// 아직 서버로 못 보낸 변경 건수 (로그아웃 전 경고용)
export function pendingChanges() {
  let n = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k?.startsWith('trip-outbox:v1:')) continue;
    try { n += JSON.parse(localStorage.getItem(k) || '[]').length; } catch {}
  }
  return n;
}

// 로그아웃: 공용 PC 에 여행 데이터가 남지 않도록 캐시도 함께 정리
export async function signOut() {
  await supabase.auth.signOut();
  const keys = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k?.startsWith('trip-cache:v1:') || k?.startsWith('trip-outbox:v1:') || k?.startsWith('trips-list:v1:')
      || k === 'trip-sync-index:v1' || k?.startsWith('ai-plan-undo:v1:') || k === LAST_USER_KEY) keys.push(k);
  }
  keys.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
}

// OAuth 복귀 시 URL 에 실린 에러 (예: 이미 다른 계정에 연결된 Google 계정으로 "계정 연결")
export function readAuthError() {
  const fromQuery = new URLSearchParams(location.search);
  const fromHash = location.hash.startsWith('#error') ? new URLSearchParams(location.hash.slice(1)) : null;
  const p = fromQuery.get('error') ? fromQuery : fromHash;
  if (!p?.get('error')) return null;
  return { code: p.get('error_code') || p.get('error'), description: p.get('error_description') || '' };
}
