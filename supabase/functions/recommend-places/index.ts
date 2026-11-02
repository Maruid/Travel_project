// =====================================================================
// recommend-places
//   키워드(예: "난바 근처 현지인 야키니쿠")로 여행지 안의 장소 후보를 추천
//   1단계: Gemini + Google 검색으로 조사 (자유 서술)
//   2단계: 조사 메모 → 후보 JSON (검색 없이)
//   후보는 "추천"일 뿐이고, 앱에서 [추가]를 누를 때 구글 Places 로 실제 장소를 확인
//
//   - 권한: 관리자는 무제한, 그 외는 관리자가 허용한 Google 로그인 사용자만 (begin_ai_call, migration_009)
//   - 같은 여행·키워드·범위·개수는 24시간 동안 저장된 결과를 돌려줌 (한도 안 씀, force=true 면 새로)
//   - 실패하면 사용 기록이 ok=false 로 남아 한도에서 빠짐 (자동 환불)
//   - 응답은 스트리밍(NDJSON): {"t":"stage",...} → {"t":"result",...} 또는 {"t":"error",...}
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


const KIND_TEXT: Record<string, string> = { food: '식당', cafe: '카페', bar: '술집', spot: '명소', shop: '쇼핑', lodging: '숙소', transit: '교통', etc: '기타' };
const norm = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

type Ctx = {
  keyword: string; destination: string | null; scope: 'anchor' | 'all';
  anchor: { name: string; lat: number | null; lng: number | null } | null;
  count: number; dates: string | null; existing: string[]; currency: string | null;
};

function researchPrompt(c: Ctx) {
  const coords = c.anchor?.lat != null && c.anchor?.lng != null ? `, 좌표 ${c.anchor.lat.toFixed(4)}, ${c.anchor.lng.toFixed(4)}` : '';
  const where = c.scope === 'anchor' && c.anchor
    ? `${c.destination || ''} ${c.anchor.name} 주변 (걸어서 15분 안팎${coords})`
    : `${c.destination || '여행지'} 전체`;
  const avoid = c.existing.length ? `\n이미 일정에 있는 곳(추천에서 제외): ${c.existing.slice(0, 80).join(', ')}` : '';
  return `여행 장소를 찾고 있어요. Google 에서 검색해서 아래 조건에 맞는 장소 ${c.count + 3}곳을 한국어로 정리해줘.

- 지역: ${where}${c.dates ? `\n- 여행 시기: ${c.dates}` : ''}
- 찾는 것: "${c.keyword}"
- 각 장소마다: 정확한 가게/장소 이름(현지 표기도 함께), 동네나 가까운 역, 종류, 추천하는 이유(현지 평판·특징), 1인 기준 가격대, 정기 휴무나 주의할 점
- 지금도 영업 중인 곳만 (폐업·장기 휴업 제외), 체인점이면 해당 지역 지점 기준${avoid}
- 찾는 것이 여행 중 갈 장소와 관계없는 요청이면 장소를 찾지 말고 "해당 없음"이라고만 답해줘.`;
}

function extractPrompt(c: Ctx, memo: string) {
  return `아래 조사 메모에 있는 장소만 사용해서 JSON 하나를 만드세요. 메모에 없는 장소나 정보는 추가하지 마세요.

----- 조사 메모 시작 -----
${memo.slice(0, 8000)}
----- 조사 메모 끝 -----

규칙
- 최대 ${c.count}곳. 메모에 "해당 없음"이거나 장소가 없으면 items 는 빈 배열.
- name: 한국어로 부르는 이름 (없으면 현지 이름), 40자 이내. local_name: 현지 표기 이름, 없으면 null.
- zone: 동네나 가까운 역, 15자 이내.
- kind: ${KINDS.join(' | ')} 중 하나.
- reason: 왜 추천하는지 한국어 1~2문장, 90자 이내.
- price_min, price_max: 1인 기준 숫자만. 모르면 null. currency: ISO 통화 코드 (예: ${c.currency || 'JPY'}).
- warn: 정기 휴무·현금만·예약 필수 같은 주의점, 12자 이내, 없으면 null.

JSON 코드블록 하나만 출력하세요.
\`\`\`json
{"items": [{"name": "", "local_name": null, "zone": null, "kind": "food", "reason": "", "price_min": null, "price_max": null, "currency": null, "warn": null}]}
\`\`\``;
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (o: unknown) => { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* 연결 끊김 */ } };
      try { await run(req, send); } catch (e) { console.error('recommend failed', e); send({ t: 'error', error: 'AI_FAILED' }); }
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

  const tCheck = Date.now();
  stage('check', 'start');
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return fail('AUTH_REQUIRED');
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return fail('BAD_REQUEST'); }
  const tripId = typeof body.tripId === 'string' ? body.tripId : null;
  const keyword = str(body.keyword, 100);
  if (!tripId || !keyword) return fail('BAD_REQUEST');
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return fail('NO_API_KEY');

  const anchor = body.scope === 'anchor' && body.anchor && typeof body.anchor.name === 'string'
    ? { name: str(body.anchor.name, 60) || '', lat: Number.isFinite(body.anchor.lat) ? body.anchor.lat : null, lng: Number.isFinite(body.anchor.lng) ? body.anchor.lng : null }
    : null;
  const ctx: Ctx = {
    keyword,
    destination: str(body.destination, 80),
    scope: anchor ? 'anchor' : 'all',
    anchor,
    count: body.count === 10 ? 10 : 5,
    dates: str(body.dates, 40),
    existing: Array.isArray(body.existing) ? body.existing.map((x: unknown) => str(x, 60)).filter(Boolean).slice(0, 150) as string[] : [],
    currency: str(body.currency, 3),
  };
  // 기준점은 이름 + 대략 좌표(약 1km 단위)로 구분 → "내 위치"처럼 이름이 같아도 위치가 다르면 새로 추천
  const anchorKey = anchor ? `${norm(anchor.name)}@${anchor.lat != null ? anchor.lat.toFixed(2) : ''},${anchor.lng != null ? anchor.lng.toFixed(2) : ''}` : '';
  const cacheKey = [norm(keyword), ctx.scope, anchorKey, ctx.count].join('|');

  // 저장된 결과 (24시간) → 한도 안 씀
  if (!body.force) {
    const cached = await supabase.rpc('get_recommend_cache', { p_trip: tripId, p_key: cacheKey });
    if (cached.error) return fail(/FORBIDDEN/.test(cached.error.message) ? 'FORBIDDEN' : 'AI_FAILED');
    if (cached.data) {
      stage('check', 'done', tCheck);
      return send({ t: 'result', cached: true, key: cacheKey, ...cached.data });
    }
  }

  const call = await supabase.rpc('begin_ai_call', { p_trip: tripId, p_kind: 'recommend' });
  if (call.error) {
    const m = call.error.message;
    const code = ['AI_NOT_ALLOWED', 'AI_LIMIT', 'GOOGLE_REQUIRED', 'AUTH_REQUIRED'].find((c) => m.includes(c)) || 'FORBIDDEN';
    return fail(code);
  }
  const callId: number = call.data.id;
  const remaining: number | null = call.data.remaining ?? null;
  const usage: Usage = { prompt: 0, output: 0, tool: 0, thoughts: 0, total: 0 };
  const finish = (ok: boolean, model: string | null) => supabase.rpc('finish_ai_call', {
    p_id: callId, p_ok: ok, p_model: model,
    p_prompt: usage.prompt, p_output: usage.output, p_tool: usage.tool,
    p_thoughts: usage.thoughts, p_total: usage.total, p_ms: Date.now() - t0,
  }).then(() => {}, () => {});
  stage('check', 'done', tCheck);

  const attempts: Attempt[] = [];
  const textOf = (r: { data: any } | null) =>
    (r?.data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('').trim();
  let research: { data: any; model: string } | null = null;
  let result: { data: any; model: string } | null = null;
  try {
    const tSearch = Date.now();
    stage('search', 'start');
    research = await callGemini(key, researchPrompt(ctx), true, attempts);
    if (research) addUsage(usage, research.data);
    stage('search', 'done', tSearch);
    if (research && textOf(research)) {
      const tExtract = Date.now();
      stage('extract', 'start');
      result = await callGemini(key, extractPrompt(ctx, textOf(research)), false, attempts);
      if (result) { addUsage(usage, result.data); stage('extract', 'done', tExtract); }
    }
  } catch (e) {
    console.error('gemini fetch failed', e);
    await finish(false, null);
    return fail('AI_FAILED', { attempts });
  }
  if (!result) {
    await finish(false, research?.model ?? null);
    return fail(attempts.some((a) => a.status === 429) ? 'AI_BUSY' : 'AI_FAILED', { attempts });
  }

  const text = textOf(result);
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  let raw: any = {};
  try { raw = JSON.parse(match?.[1] || '{}'); } catch {
    console.error('parse failed', text.slice(0, 500));
    await finish(false, result.model);
    return fail('AI_PARSE', { attempts });
  }

  // 정리: 이름 없는 것·이미 있는 곳·중복 제거
  const existing = new Set(ctx.existing.map(norm));
  const seen = new Set<string>();
  const items = (Array.isArray(raw.items) ? raw.items : []).map((it: any) => {
    const name = str(it?.name, 60);
    if (!name) return null;
    let pmin = num(it.price_min), pmax = num(it.price_max);
    if (pmin && pmax && pmin > pmax) [pmin, pmax] = [pmax, pmin];
    const cur = typeof it.currency === 'string' && /^[A-Za-z]{3}$/.test(it.currency.trim()) ? it.currency.trim().toUpperCase() : null;
    const kind = typeof it.kind === 'string' && KINDS.includes(it.kind) ? it.kind : 'etc';
    return {
      name, local_name: str(it.local_name, 60), zone: str(it.zone, 30), kind, kind_text: KIND_TEXT[kind],
      reason: str(it.reason, 200), price_min: pmin, price_max: pmax, currency: pmin || pmax ? (cur || ctx.currency) : null,
      warn: str(it.warn, 30),
    };
  }).filter((it: any) => {
    if (!it) return false;
    const k = norm(it.name);
    const k2 = it.local_name ? norm(it.local_name) : '';
    if (seen.has(k) || existing.has(k) || (k2 && existing.has(k2))) return false;
    seen.add(k);
    return true;
  }).slice(0, ctx.count);

  const meta = research?.data?.candidates?.[0]?.groundingMetadata || {};
  const sources = (meta.groundingChunks || [])
    .map((c: { web?: { uri?: string; title?: string; domain?: string } }) => c.web)
    .filter((w: { uri?: string } | undefined) => w?.uri && /^https:\/\//.test(w.uri))
    .slice(0, 8)
    .map((w: { uri: string; title?: string; domain?: string }) => ({ uri: w.uri, title: (w.title || w.domain || '').slice(0, 100) }));
  const queries = (meta.webSearchQueries || []).filter((q: unknown) => typeof q === 'string').slice(0, 6).map((q: string) => q.slice(0, 80));

  timings.total = Date.now() - t0;
  const payload = {
    keyword, scope: ctx.scope, anchor: anchor?.name || null, count: ctx.count,
    items, sources, queries, model: result.model, timings, created_at: new Date().toISOString(),
  };
  await finish(true, result.model);
  // 결과 저장 (빈 결과는 저장하지 않음)
  if (items.length) {
    await supabase.rpc('save_recommend_cache', {
      p_trip: tripId, p_key: cacheKey, p_keyword: keyword,
      p_scope: anchor ? `${anchor.name} 근처` : '여행지 전체', p_result: payload,
    }).then(() => {}, () => {});
  }
  send({ t: 'result', cached: false, key: cacheKey, remaining, usage, attempts, ...payload });
}
