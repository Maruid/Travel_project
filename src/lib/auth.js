import { supabase } from './supabase.js';
import { APP_URL } from '../config.js';

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

export async function getUser() {
  try {
    const { data } = await supabase.auth.getSession();
    const user = data.session?.user ?? null;
    if (user) rememberUser(user);
    return user;
  } catch {
    return null;
  }
}

// 링크 참여/일반 사용: 세션이 없으면 조용히 익명 로그인
// 오프라인이면 새로 로그인할 수 없으므로 마지막으로 확인된 사용자로 동작 (읽기 + 변경 큐 쌓기)
export async function ensureUser() {
  const existing = await getUser();
  if (existing) return existing;

  const last = lastKnownUser();
  if (!navigator.onLine && last) return { ...last, offline: true };

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) {
    if (last) return { ...last, offline: true };
    throw error;
  }
  rememberUser(data.user);
  return data.user;
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
    if (k?.startsWith('trip-cache:v1:') || k?.startsWith('trip-outbox:v1:') || k === LAST_USER_KEY) keys.push(k);
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
