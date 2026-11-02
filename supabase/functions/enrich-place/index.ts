// =====================================================================
// enrich-place
//   장소 이름/지역/좌표를 받아 Gemini + Google 검색 그라운딩으로
//   대표 메뉴, 1인 가격대, 방문 팁, 휴무 주의, 짧은 소개를 초안으로 만들어 돌려줌
//
//   - 로그인 사용자 + 해당 여행 멤버만 (consume_ai_quota RPC 가 확인, 여행당 하루 50회)
//   - API 키는 Edge Function Secrets 의 GEMINI_API_KEY (브라우저에 노출되지 않음)
//   - 모델: GEMINI_MODEL → 무료 한도가 넉넉한 Lite 모델들 순서로 시도 (404/429 면 다음 후보)
//   - 검색 그라운딩이 모든 모델에서 막히면(무료 티어 한도 0 등) 검색 없이 한 번 더 시도하고
//     grounded:false 로 표시 → 클라이언트는 가격·휴무처럼 틀리기 쉬운 값은 자동으로 채우지 않음
//   - 결과는 "초안": 클라이언트가 빈 칸만 채우고 사용자가 확인 후 저장
//   - 응답은 스트리밍(NDJSON, 한 줄에 JSON 하나): 단계 진행 → 마지막에 결과
//       {"t":"stage","stage":"check|search|extract","state":"start|done","ms":1234}
//       {"t":"result", fields, sources, queries, grounded, searched, remaining, model, timings, attempts}
//       {"t":"error","error":"AI_LIMIT", attempts}
//   - 호출마다 ai_calls 에 토큰 수·걸린 시간 기록 (migration_009, 없으면 기록만 건너뜀)
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 존재하지 않는 ID 는 404 로 건너뛰므로 후보를 넉넉히 둠
const MODELS = [...new Set([
  Deno.env.get('GEMINI_MODEL'),
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
].filter((m): m is string => !!m && m.trim() !== '').map((m) => m.trim()))];
const KINDS = ['food', 'cafe', 'bar', 'spot', 'shop', 'lodging', 'transit', 'etc'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const str = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  if (!s || /^(null|none|n\/a|unknown|없음|정보 없음|확인 불가)$/i.test(s)) return null;
  return s.slice(0, max);
};
const num = (v: unknown) => {
  const n = typeof v === 'string' ? Number(v.replace(/[^\d.]/g, '')) : Number(v);
  return Number.isFinite(n) && n > 0 && n < 1e9 ? Math.round(n) : null;
};

function buildPrompt(p: Record<string, unknown>, grounded: boolean, forceSearch = false) {
  const lines = [
    `장소 이름: ${p.name}`,
    p.zone ? `지역/동네: ${p.zone}` : '',
    p.destination ? `여행지: ${p.destination}` : '',
    p.lat != null ? `좌표: ${p.lat}, ${p.lng}` : '',
    p.mapsUrl ? `구글 맵 링크: ${p.mapsUrl}` : '',
  ].filter(Boolean).join('\n');

  const where = [p.zone, p.destination].filter(Boolean).join(' ');
  const queries = [`${p.name} ${where} 메뉴 가격`, `${p.name} ${where} 정기휴무 영업시간`]
    .map((q) => `"${q.replace(/\s+/g, ' ').trim()}"`).join(', ');
  const intro = grounded
    ? `당신은 여행 가이드북 편집자입니다. 아는 가게라도 기억에 의존하지 말고, 답하기 전에 반드시 Google 검색 도구로 ${queries} 를 검색하세요. 검색으로 확인된 정보만으로 JSON 하나를 만드세요.${forceSearch ? ' (이전 응답에서 검색을 하지 않았습니다. 이번에는 검색을 먼저 실행해야 합니다.)' : ''}`
    : '당신은 여행 가이드북 편집자입니다. 검색 도구 없이 답해야 합니다. 이 장소를 확실히 알고 있는 경우에만 값을 채우고, 조금이라도 불확실하면 null 로 두세요. 잘 알려지지 않은 가게라면 대부분 null 이 정상입니다.';
  return `${intro}

${lines}

규칙
- 이름이 같은 다른 지점·다른 도시의 가게와 혼동하지 말고, 위 지역/좌표에 있는 바로 그 장소 기준으로 작성.
- 확인되지 않는 값은 절대 추측하지 말고 null.
- 모든 문장은 자연스러운 한국어.
- price_min, price_max: 1인 기준 일반적인 식사·이용 비용. 숫자만 (통화 기호·쉼표 없이). 무료 명소는 0이 아니라 null.
- currency: 가격의 ISO 통화 코드 (예: ${p.currency || 'JPY'}).
- signature: 대표 메뉴 또는 볼거리 1~3개, 60자 이내.
- description: 이 장소의 특징 2문장 이내, 150자 이내.
- visit_tip: 웨이팅·예약·결제·추천 시간대 같은 실용 팁, 80자 이내.
- warn_badge: 정기 휴무일이나 꼭 알아야 할 주의점을 아주 짧게 (예: "화요 휴무", "현금만", "예약 필수"). 없으면 null. 12자 이내.
- zone: 동네나 가까운 역 이름, 15자 이내.
- kind: ${KINDS.join(' | ')} 중 하나.

다른 설명 없이 아래 형식의 JSON 코드블록 하나만 출력하세요.
\`\`\`json
{"signature": null, "description": null, "price_min": null, "price_max": null, "currency": null, "visit_tip": null, "warn_badge": null, "zone": null, "kind": null}
\`\`\``;
}

// 1단계: AI Studio 에서 검색이 잘 되던 것처럼 자연스러운 질문으로 조사 (자유 서술, JSON 요구 없음)
function researchPrompt(p: Record<string, unknown>) {
  const where = [p.zone, p.destination].filter(Boolean).join(' ');
  return `${p.name}${where ? ` (${where})` : ''} 를 Google 에서 검색해서 아래 내용을 한국어로 정리해줘.
- 대표 메뉴나 볼거리
- 1인 기준 가격대 (현지 통화)
- 영업시간과 정기 휴무일
- 예약·웨이팅·결제 방법 같은 방문 팁
- 어떤 곳인지 한두 문장 소개
같은 이름의 다른 지점과 헷갈리지 않게 ${where || '해당 지역'}에 있는 곳 기준으로 찾아줘.${p.mapsUrl ? `\n참고 구글 맵 링크: ${p.mapsUrl}` : ''}`;
}

// 2단계: 조사 메모에 있는 내용만 JSON 으로 옮김 (검색 없이, 새 정보 추가 금지)
function extractPrompt(p: Record<string, unknown>, memo: string) {
  const facts = typeof p.facts === 'string' && p.facts ? `
확정 정보 (구글 지도 공식 데이터, 메모와 다르면 이것이 우선):
${p.facts}
- price_min, price_max, currency, warn_badge 는 확정 정보에 값이 있으면 그 값을 그대로 쓰세요.
` : '';
  return `아래 조사 메모에 적힌 내용만 사용해서 JSON 하나를 만드세요. 메모에 없는 내용은 추측하지 말고 null.

장소: ${p.name}
${facts}
----- 조사 메모 시작 -----
${memo.slice(0, 6000)}
----- 조사 메모 끝 -----

규칙
- 모든 문장은 자연스러운 한국어.
- price_min, price_max: 1인 기준 가격. 숫자만. 메모에 가격이 없으면 null.
- currency: ISO 통화 코드 (예: ${p.currency || 'JPY'}).
- signature: 대표 메뉴 또는 볼거리 1~3개, 60자 이내.
- description: 특징 2문장 이내, 150자 이내.
- visit_tip: 웨이팅·예약·결제·추천 시간대 같은 실용 팁, 80자 이내.
- warn_badge: 정기 휴무일이나 꼭 알아야 할 주의점을 아주 짧게 (예: "화요 휴무", "현금만"). 없으면 null. 12자 이내.
- zone: 동네나 가까운 역 이름, 15자 이내.
- kind: ${KINDS.join(' | ')} 중 하나.

JSON 코드블록 하나만 출력하세요.
\`\`\`json
{"signature": null, "description": null, "price_min": null, "price_max": null, "currency": null, "visit_tip": null, "warn_badge": null, "zone": null, "kind": null}
\`\`\``;
}

type Attempt = {
  model: string; grounded: boolean; status: number; quota?: string;
  // 성공 응답 진단: 검색을 실제로 했는지 판단하는 신호들
  finish?: string; toolTokens?: number; queries?: number; chunks?: number; metaKeys?: string[]; partKinds?: string[];
};

// 검색 실행 신호 (Gemini 3.x 는 근거 메타데이터를 빠뜨리는 경우가 있어 여러 신호를 함께 봄)
//  - groundingChunks / webSearchQueries      : 근거·검색어
//  - usageMetadata.toolUsePromptTokenCount   : 도구(검색) 결과가 입력으로 들어간 토큰 수
//  - content.parts 의 toolCall / toolResponse : 서버 측 도구 호출 흔적
function diagnose(data: any) {
  const cand = data?.candidates?.[0] || {};
  const meta = cand.groundingMetadata || {};
  const parts: any[] = cand.content?.parts || [];
  const partKinds = [...new Set(parts.flatMap((p) => Object.keys(p)))];
  const d = {
    finish: cand.finishReason,
    toolTokens: Number(data?.usageMetadata?.toolUsePromptTokenCount || 0),
    queries: meta.webSearchQueries?.length || 0,
    chunks: meta.groundingChunks?.length || 0,
    metaKeys: Object.keys(meta),
    partKinds,
  };
  const searched = d.chunks > 0 || d.queries > 0 || d.toolTokens > 0 || partKinds.some((k) => /tool/i.test(k));
  return { ...d, searched };
}

// Google 에러 본문에서 걸린 한도 이름만 추려냄 (로그가 잘리지 않도록 짧게)
function summarizeError(text: string): string {
  try {
    const err = JSON.parse(text).error;
    const parts: string[] = [];
    for (const d of err?.details || []) {
      for (const v of d.violations || []) {
        const dims = v.quotaDimensions ? Object.entries(v.quotaDimensions).map(([k, x]) => `${k}=${x}`).join(',') : '';
        parts.push([v.quotaMetric, v.quotaId, dims].filter(Boolean).join(' | '));
      }
    }
    return parts.join(' ; ') || String(err?.message || '').slice(0, 160);
  } catch {
    return text.slice(0, 160);
  }
}

// AI Studio "Get code" 와 같은 형식 (google_search 표기로는 검색이 실행되지 않았음)
function requestBody(prompt: string, grounded: boolean, minimalThinking: boolean) {
  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
    ...(minimalThinking ? { generationConfig: { thinkingConfig: { thinkingLevel: 'MINIMAL' } } } : {}),
  });
}

async function callGemini(key: string, prompt: string, grounded: boolean, attempts: Attempt[]) {
  for (const model of MODELS) {
    const send = (minimalThinking: boolean) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: requestBody(prompt, grounded, minimalThinking),
      signal: AbortSignal.timeout(30000),
    });
    let res = await send(true);
    // 일부 모델은 MINIMAL 생각 수준을 지원하지 않음 → 생각 설정 없이 한 번 더
    if (res.status === 400) {
      const text = await res.text();
      if (/thinking/i.test(text)) res = await send(false);
      else res = new Response(text, { status: 400 });
    }
    if (res.ok) {
      const data = await res.json();
      const { searched: _s, ...diag } = diagnose(data);
      attempts.push({ model, grounded, status: 200, ...diag });
      console.log(JSON.stringify({ gemini: 'ok', model, grounded, ...diag }));
      return { data, model };
    }
    const quota = summarizeError(await res.text());
    attempts.push({ model, grounded, status: res.status, quota });
    console.error(JSON.stringify({ gemini: 'error', model, grounded, status: res.status, quota }));
    if (res.status !== 404 && res.status !== 429) return null;   // 그 밖의 에러는 다른 모델로도 해결되지 않음
  }
  return null;
}

// 앱이 보낸 구글 지도 확정 정보 → 프롬프트용 짧은 문장
function factsText(f: any): string | null {
  if (!f || typeof f !== 'object') return null;
  const lines: string[] = [];
  if (Array.isArray(f.hours) && f.hours.length) lines.push(`영업시간: ${f.hours.slice(0, 7).map((h: unknown) => String(h).slice(0, 80)).join(' / ')}`);
  if (Number.isFinite(f.priceMin) || Number.isFinite(f.priceMax)) {
    lines.push(`1인 가격: ${f.priceMin ?? '?'} ~ ${f.priceMax ?? '?'} ${typeof f.priceCurrency === 'string' ? f.priceCurrency.slice(0, 3) : ''}`);
  }
  if (typeof f.closed === 'string' && f.closed) lines.push(`주의: ${f.closed.slice(0, 30)}`);
  return lines.length ? lines.join('\n') : null;
}

// 사용량 합산 (Gemini usageMetadata)
type Usage = { prompt: number; output: number; tool: number; thoughts: number; total: number };
function addUsage(u: Usage, data: any) {
  const m = data?.usageMetadata || {};
  u.prompt += Number(m.promptTokenCount || 0);
  u.output += Number(m.candidatesTokenCount || 0);
  u.tool += Number(m.toolUsePromptTokenCount || 0);
  u.thoughts += Number(m.thoughtsTokenCount || 0);
  u.total += Number(m.totalTokenCount || 0);
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (o: unknown) => { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* 연결 끊김 */ } };
      try { await run(req, send); } catch (e) { console.error('enrich failed', e); send({ t: 'error', error: 'AI_FAILED' }); }
      try { ctrl.close(); } catch { /* 이미 닫힘 */ }
    },
  });
  return new Response(stream, { headers: { ...CORS, 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache' } });
});

async function run(req: Request, send: (o: unknown) => void) {
  const t0 = Date.now();
  const timings: Record<string, number> = {};
  const stage = (name: string, state: 'start' | 'done', since?: number) => {
    const ms = since != null ? Date.now() - since : undefined;
    if (ms != null) timings[name] = ms;
    send({ t: 'stage', stage: name, state, ms });
  };
  const fail = (error: string, extra: Record<string, unknown> = {}) => send({ t: 'error', error, ...extra });

  // ---- 인증 + 사용량 (사용자 권한으로 RPC 호출 → 여행 멤버인지도 함께 확인) ----
  const tCheck = Date.now();
  stage('check', 'start');
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return fail('AUTH_REQUIRED');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return fail('BAD_REQUEST'); }
  const name = str(body.name, 100);
  if (!name || typeof body.tripId !== 'string') return fail('BAD_REQUEST');
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return fail('NO_API_KEY');

  // 로그인 확인 · 여행당 하루 한도 · 사용 기록 시작을 동시에
  const [{ data: { user } }, quota, call] = await Promise.all([
    supabase.auth.getUser(jwt),
    supabase.rpc('consume_ai_quota', { p_trip: body.tripId }),
    supabase.rpc('begin_ai_call', { p_trip: body.tripId, p_kind: 'enrich' }),
  ]);
  const callId: number | null = call.error ? null : call.data?.id ?? null;   // migration_009 전이면 null (기록만 생략)
  const finish = (ok: boolean, model: string | null, u?: Usage) => callId == null ? Promise.resolve() :
    supabase.rpc('finish_ai_call', {
      p_id: callId, p_ok: ok, p_model: model,
      p_prompt: u?.prompt ?? null, p_output: u?.output ?? null, p_tool: u?.tool ?? null,
      p_thoughts: u?.thoughts ?? null, p_total: u?.total ?? null, p_ms: Date.now() - t0,
    }).then(() => {}, () => {});
  if (!user) { await finish(false, null); return fail('AUTH_REQUIRED'); }
  if (quota.error) {
    await finish(false, null);
    return fail(/AI_LIMIT/.test(quota.error.message) ? 'AI_LIMIT' : 'FORBIDDEN');
  }
  const remaining = quota.data;
  stage('check', 'done', tCheck);

  // ---- Gemini 호출: 검색 그라운딩 → (전부 한도 초과면) 검색 없이 ----
  const info = {
    name,
    zone: str(body.zone, 50),
    destination: str(body.destination, 80),
    lat: typeof body.lat === 'number' ? body.lat : null,
    lng: typeof body.lng === 'number' ? body.lng : null,
    mapsUrl: str(body.mapsUrl, 500),
    currency: str(body.currency, 3),
    facts: factsText(body.facts),
  };
  const attempts: Attempt[] = [];
  const usage: Usage = { prompt: 0, output: 0, tool: 0, thoughts: 0, total: 0 };
  const searched = (r: { data: any } | null) => !!r && diagnose(r.data).searched;
  const textOf = (r: { data: any } | null) =>
    (r?.data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('').trim();

  let research: { data: any; model: string } | null = null;   // 1단계 결과 (근거 링크는 여기서 나옴)
  let result: { data: any; model: string } | null = null;     // JSON 이 담긴 최종 결과
  let grounded = true;
  try {
    // 1단계: 검색 조사
    const tSearch = Date.now();
    stage('search', 'start');
    research = await callGemini(key, researchPrompt(info), true, attempts);
    if (research) addUsage(usage, research.data);
    stage('search', 'done', tSearch);
    const tExtract = Date.now();
    if (research && textOf(research)) {
      // 2단계: 메모 → JSON (검색 없이)
      stage('extract', 'start');
      result = await callGemini(key, extractPrompt(info, textOf(research)), false, attempts);
      grounded = searched(research);
    } else if (!research && attempts.length && attempts.every((a) => a.status === 404 || a.status === 429)) {
      // 검색을 쓸 수 없는 경우(무료 티어 등): 검색 없이 보수적으로
      stage('extract', 'start');
      grounded = false;
      result = await callGemini(key, buildPrompt(info, false), false, attempts);
    }
    if (result) { addUsage(usage, result.data); stage('extract', 'done', tExtract); }
  } catch (e) {
    console.error('gemini fetch failed', e);
    await finish(false, null, usage);
    return fail('AI_FAILED', { attempts });
  }
  if (!result) {
    await finish(false, null, usage);
    return fail(attempts.some((a) => a.status === 429) ? 'AI_BUSY' : 'AI_FAILED', { attempts });
  }

  const { model } = result;
  const text = textOf(result);
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(match?.[1] || '{}'); } catch {
    console.error('parse failed', text.slice(0, 500));
    await finish(false, model, usage);
    return fail('AI_PARSE', { attempts });
  }

  let priceMin = num(raw.price_min), priceMax = num(raw.price_max);
  if (priceMin && priceMax && priceMin > priceMax) [priceMin, priceMax] = [priceMax, priceMin];
  const currency = typeof raw.currency === 'string' && /^[A-Za-z]{3}$/.test(raw.currency.trim()) ? raw.currency.trim().toUpperCase() : null;
  const kind = typeof raw.kind === 'string' && KINDS.includes(raw.kind) ? raw.kind : null;

  const fields = {
    signature: str(raw.signature, 200),
    description: str(raw.description, 500),
    price_min: priceMin,
    price_max: priceMax,
    price_currency: priceMin || priceMax ? currency : null,
    visit_tip: str(raw.visit_tip, 300),
    warn_badge: str(raw.warn_badge, 30),
    zone: str(raw.zone, 50),
    kind,
  };

  // 근거 링크 + AI 가 검색한 말
  const meta = research?.data?.candidates?.[0]?.groundingMetadata || {};
  const sources = (meta.groundingChunks || [])
    .map((c: { web?: { uri?: string; title?: string; domain?: string } }) => c.web)
    .filter((w: { uri?: string } | undefined) => w?.uri && /^https:\/\//.test(w.uri))
    .slice(0, 5)
    .map((w: { uri: string; title?: string; domain?: string }) => ({ uri: w.uri, title: (w.title || w.domain || '').slice(0, 100) }));
  const queries = (meta.webSearchQueries || []).filter((q: unknown) => typeof q === 'string').slice(0, 6).map((q: string) => q.slice(0, 80));

  timings.total = Date.now() - t0;
  await finish(true, model, usage);
  send({
    t: 'result',
    fields,
    sources,
    queries,
    // 근거 링크가 빠져도 검색 실행 신호가 있으면 검색 기반 결과로 취급
    grounded: grounded && (sources.length > 0 || searched(research)),
    searched: grounded && searched(research),
    remaining,
    model,
    timings,
    usage,
    attempts,
  });
}
