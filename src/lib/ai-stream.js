import { supabase } from './supabase.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../config.js';

// =====================================================================
// 스트리밍 Edge Function 호출 (enrich-place, recommend-places, plan-itinerary)
//  - 응답은 NDJSON: 한 줄에 JSON 하나
//      {"t":"stage","stage":"check|search|extract","state":"start|done","ms":...}  → onEvent
//      {"t":"result", ...}  → 반환값
//      {"t":"error","error":"AI_LIMIT", ...}  → 예외 (e.code, e.attempts)
// =====================================================================

export const AI_ERRORS = {
  AI_LIMIT: '오늘 사용 한도를 모두 썼어요. 내일 다시 시도해 주세요.',
  AI_BUSY: 'AI 사용량이 잠시 몰렸어요. 1분 뒤 다시 시도해 주세요.',
  AI_NOT_ALLOWED: 'AI 추천·일정 짜기는 관리자가 허용한 사람만 쓸 수 있어요.',
  GOOGLE_REQUIRED: 'Google 로그인 후 사용할 수 있어요.',
  NO_API_KEY: 'AI 키가 아직 설정되지 않았어요. (관리자: Edge Function Secrets 에 GEMINI_API_KEY 등록)',
  FORBIDDEN: '이 여행의 멤버만 사용할 수 있어요.',
  AUTH_REQUIRED: '로그인이 필요해요.',
  AI_PARSE: 'AI 응답을 해석하지 못했어요. 다시 시도해 주세요. (횟수는 차감되지 않아요)',
  AI_EMPTY: 'AI 가 일정을 만들지 못했어요. 조건을 바꿔 다시 시도해 주세요. (횟수는 차감되지 않아요)',
  AI_PLAN_LIMIT: '이 여행의 AI 일정 짜기 횟수를 모두 썼어요.',
  BAD_REQUEST: '요청 내용이 올바르지 않아요.',
  OFFLINE: '온라인 상태에서만 사용할 수 있어요.',
};
const aiError = (code, extra = {}) => Object.assign(
  new Error(AI_ERRORS[code] || 'AI 요청에 실패했어요. 잠시 후 다시 시도해 주세요.'), { code, ...extra });

export async function streamFunction(name, body, onEvent) {
  if (!navigator.onLine) throw aiError('OFFLINE');
  const { data: { session } } = await supabase.auth.getSession();
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session?.access_token || SUPABASE_KEY}`,
        apikey: SUPABASE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch {
    throw aiError('AI_FAILED');
  }
  if (!res.ok || !res.body) {
    let code = 'AI_FAILED';
    try { code = (await res.json()).error || code; } catch {}
    throw aiError(code);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let result = null;
  const handle = (line) => {
    if (!line.trim()) return;
    let ev;
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.t === 'error') {
      if (ev.attempts?.length) console.warn(`${name} attempts`, ev.attempts);
      throw aiError(ev.error, { attempts: ev.attempts || [] });
    }
    if (ev.t === 'result') result = ev;
    else onEvent?.(ev);
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 1); }
    }
    handle(buf);
  } catch (e) {
    reader.cancel().catch(() => {});
    if (e.code) throw e;
    throw aiError('AI_FAILED');   // 중간에 연결이 끊긴 경우
  }
  if (!result) throw aiError('AI_FAILED');
  return result;
}

// 진행 표시: 단계 이름 + 경과 초. render(text) 를 0.5초마다 호출, stop() 으로 끝
const STAGE_TEXT = { check: '확인 중', search: '구글 검색 중', extract: '결과 정리 중', plan: 'AI 가 일정 짜는 중' };
export function progressTicker(render) {
  const t0 = Date.now();
  let label = '시작하는 중';
  const done = [];
  const draw = () => {
    const sec = ((Date.now() - t0) / 1000).toFixed(0);
    render(`${label}... ${sec}초`, done.slice());
  };
  const timer = setInterval(draw, 500);
  draw();
  return {
    onEvent(ev) {
      if (ev.t !== 'stage') return;
      if (ev.state === 'start') label = STAGE_TEXT[ev.stage] || ev.stage;
      if (ev.state === 'done' && ev.ms != null) done.push(`${STAGE_TEXT[ev.stage]?.replace(' 중', '') || ev.stage} ${(ev.ms / 1000).toFixed(1)}초`);
      draw();
    },
    stop() { clearInterval(timer); },
  };
}

// 단계별 시간 요약: "검색 8.2초 · 정리 1.4초 · 총 9.9초"
export function timingText(t = {}) {
  const s = (ms) => `${(ms / 1000).toFixed(1)}초`;
  return [t.search != null && `검색 ${s(t.search)}`, t.extract != null && `정리 ${s(t.extract)}`, t.total != null && `총 ${s(t.total)}`]
    .filter(Boolean).join(' · ');
}

// 근거 링크 표시용 이름 (Google 이 제목 대신 도메인만 주는 경우가 많음)
export function sourceLabel(s) {
  const t = (s.title || '').trim();
  return t || 'Google 검색 결과';
}
