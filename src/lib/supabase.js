import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

// flowType 'pkce': OAuth 결과가 ?code= 쿼리로 돌아옴 → #/ 해시 라우터와 충돌하지 않음
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    flowType: 'pkce',
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// RPC 호출 헬퍼: 에러를 throw 로 통일
export async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw error;
  return data;
}

// 서버가 raise 한 코드를 사용자 메시지로 변환
const ERROR_TEXT = {
  INVALID_INVITE: '유효하지 않은 초대 링크입니다. 링크가 재발급되었을 수 있어요.',
  INVALID_CODE: '사용할 수 없는 생성 코드입니다.',
  CLAIM_FAILED: '이미 다른 사람이 선택한 이름입니다.',
  MEMBER_LIMIT: '이 여행은 인원 제한(30명)에 도달했습니다.',
  OWNER_ONLY: '여행 관리자(owner)만 할 수 있습니다.',
  ADMIN_ONLY: '사이트 관리자만 할 수 있습니다.',
  OWNER_MUST_TRANSFER_FIRST: 'owner 는 다른 멤버에게 권한을 넘긴 뒤 나갈 수 있습니다.',
  CANNOT_KICK_OWNER: 'owner 는 강퇴할 수 없습니다.',
  CANNOT_UNLINK_OWNER: 'owner 는 연결 해제할 수 없습니다.',
  AUTH_REQUIRED: '로그인이 필요합니다.',
  FORBIDDEN: '권한이 없습니다.',
  ROW_LIMIT: '이 여행에 등록할 수 있는 최대 개수를 넘었습니다.',
};

export function errorText(err) {
  const msg = err?.message || String(err);
  const key = Object.keys(ERROR_TEXT).find((k) => msg.includes(k));
  return key ? ERROR_TEXT[key] : msg;
}
