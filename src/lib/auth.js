import { supabase } from './supabase.js';
import { APP_URL } from '../config.js';

const RETURN_KEY = 'auth:returnTo';

export async function getUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

// 링크 참여/일반 사용: 세션이 없으면 조용히 익명 로그인
export async function ensureUser() {
  const existing = await getUser();
  if (existing) return existing;
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw error;
  return data.user;
}

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

export async function signOut() {
  await supabase.auth.signOut();
}
