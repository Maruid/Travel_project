// =====================================================================
// plan-itinerary  (3차: AI 일정 짜기)
//   앱이 보낸 장소 목록(번호) · 날짜 · 남길 일정으로 하루 순서를 짜서 돌려줌
//   - 장소는 번호로만 고름 (새 장소를 만들지 않음, 검색 없음)
//   - 권한: AI 추천과 같음. 하루 한도는 추천과 같이 쓰고, 여행당 3번 (begin_ai_call 'plan', migration_012)
//   - 결과가 비었거나 읽을 수 없으면 ok=false 로 남아 한도에서 빠짐 (자동 환불)
//   - 응답은 스트리밍(NDJSON): {"t":"stage",...} → {"t":"result",...} 또는 {"t":"error",...}
//   - 최종 검증(영업시간·중복·고정 일정)은 앱이 다시 함
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODELS = [...new Set([
  Deno.env.get('GEMINI_MODEL'),
  'gemini-3.5-flash-lite',
  'gemini-3.1-flash-lite',
].filter((m): m is string => !!m && m.trim() !== '').map((m) => m.trim()))];

const MAX_PLACES = 150;
const MAX_DAYS = 14;
const DENSITY: Record<string, string> = { easy: '하루 3~4곳, 여유 있게', normal: '하루 5~6곳', tight: '하루 7~9곳, 빡빡하게' };
const KIND_TEXT: Record<string, string> = { food: '식당', cafe: '카페', bar: '술집', spot: '명소', shop: '쇼핑', lodging: '숙소', transit: '교통', etc: '기타' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const str = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const int = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};
const coord = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : null);
const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const hm = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);

type Place = { i: number; name: string; kind: string; cat: string | null; zone: string | null; lat: number | null; lng: number | null;
  hours: string | null; likes: number; anchor: boolean; visited: boolean; elsewhere: boolean; sig: string | null };
type Day = { date: string; weekday: string; title: string | null; stayStart: number | null; stayEnd: number | null; fixed: { f: number; time: string | null; title: string; place: number | null }[] };
type Req = { destination: string | null; timezone: string | null; density: string; likeMode: string; text: string | null; start: string; end: string; places: Place[]; days: Day[] };

// 앱이 보낸 값 정리 (길이·개수 제한)
function readRequest(b: any): Req | null {
  const places: Place[] = (Array.isArray(b?.places) ? b.places : []).slice(0, MAX_PLACES).map((p: any, k: number) => ({
    i: k + 1,
    name: str(p?.name, 60) || `장소${k + 1}`,
    kind: typeof p?.kind === 'string' && KIND_TEXT[p.kind] ? p.kind : 'etc',
    cat: str(p?.cat, 20), zone: str(p?.zone, 30), lat: coord(p?.lat), lng: coord(p?.lng),
    hours: str(p?.hours, 160), likes: int(p?.likes, 0, 99) || 0,
    anchor: !!p?.anchor, visited: !!p?.visited, elsewhere: !!p?.elsewhere, sig: str(p?.sig, 40),
  }));
  const days: Day[] = (Array.isArray(b?.days) ? b.days : []).filter((d: any) => isDate(d?.date)).slice(0, MAX_DAYS).map((d: any) => ({
    date: d.date, weekday: str(d.weekday, 2) || '', title: str(d.title, 60),
    stayStart: int(d.stayStart, 1, places.length), stayEnd: int(d.stayEnd, 1, places.length),
    fixed: (Array.isArray(d.fixed) ? d.fixed : []).slice(0, 30).map((x: any, k: number) => ({
      f: k + 1, time: hm(x?.time), title: str(x?.title, 60) || '일정', place: int(x?.place, 1, places.length),
    })),
  }));
  if (!places.length || !days.length) return null;
  return {
    destination: str(b?.destination, 80), timezone: str(b?.timezone, 40),
    density: DENSITY[b?.density] ? b.density : 'normal',
    likeMode: ['must', 'prefer', 'off'].includes(b?.likeMode) ? b.likeMode : 'prefer',
    text: str(b?.text, 200), start: hm(b?.start) || '09:00', end: hm(b?.end) || '21:00', places, days,
  };
}

function prompt(r: Req) {
  const placeLine = (p: Place) => [
    `${p.i}. ${p.name}`, `[${p.cat || KIND_TEXT[p.kind]}]`,
    p.zone, p.lat != null && p.lng != null ? `(${p.lat},${p.lng})` : null,
    p.hours ? `영업 ${p.hours}` : null,
    r.likeMode !== 'off' && p.likes ? `찜${p.likes}` : null,
    p.anchor ? '숙소/기준점' : null, p.visited ? '이미 다녀옴' : null, p.elsewhere ? '다른 날 일정에 있음' : null,
    p.sig ? `대표: ${p.sig}` : null,
  ].filter(Boolean).join(' ');
  const dayLine = (d: Day) => {
    const fixed = d.fixed.length
      ? d.fixed.map((x) => `    F${x.f}. ${x.time || '시간 미정'} ${x.title}${x.place ? ` (장소 ${x.place})` : ''}`).join('\n')
      : '    (없음)';
    const stay = d.stayStart || d.stayEnd
      ? `\n  숙소: ${d.stayStart === d.stayEnd || !d.stayEnd ? `${d.stayStart || d.stayEnd}번에서 출발해 돌아옴` : !d.stayStart ? `${d.stayEnd}번으로 돌아옴` : `${d.stayStart}번에서 출발해 ${d.stayEnd}번으로 이동(체크아웃 → 체크인)`}`
      : '';
    return `- ${d.date} (${d.weekday})${d.title ? ` "${d.title}"` : ''}${stay}\n  남길 일정:\n${fixed}`;
  };
  const likeRule = {
    must: '찜이 있는 장소는 모두 일정 어딘가에 꼭 넣으세요. 찜이 많은 곳을 먼저 배치하세요.',
    prefer: '찜이 많은 장소를 우선 넣되, 동선이 너무 나빠지면 빼도 됩니다.',
    off: '찜은 고려하지 마세요.',
  }[r.likeMode];
  const anchors = r.places.filter((p) => p.anchor).map((p) => p.i);
  return `${r.destination || '여행지'} 여행 일정을 짜주세요. 아래 장소 목록에 있는 곳만, 번호로만 고르세요. 목록에 없는 장소는 만들지 마세요.

[날짜와 남길 일정]
${r.days.map(dayLine).join('\n')}

[장소 목록] (번호. 이름 [종류] 동네 (위도,경도) 영업시간 찜 수)
${r.places.map(placeLine).join('\n')}

[규칙]
- 각 날짜의 하루 순서를 처음부터 끝까지 출력하세요. 남길 일정은 {"f": 번호} 로 그 자리에 그대로 넣고, 시간과 순서를 지키세요. 남길 일정을 빼거나 바꾸지 마세요.
- 하루에 들르는 곳은 ${DENSITY[r.density]} (남길 일정 포함). 날짜마다 빠짐없이 짜세요.
- 새 일정은 ${r.start} 이후에 시작해서 ${r.end} 전에 끝나게. 남길 일정이 이 시간 밖에 있으면 그대로 두세요.
- 좌표를 보고 가까운 곳끼리 묶어 이동이 짧게, 같은 동네는 같은 날에. ${r.days.some((d) => d.stayStart || d.stayEnd) ? '날짜마다 적힌 숙소에서 출발해 그 숙소로 돌아오는 동선으로 짜세요(숙소를 옮기는 날은 앞 숙소 근처에서 시작해 새 숙소 근처에서 끝나게).' : anchors.length ? `숙소/기준점(${anchors.join(', ')})에서 출발해 돌아온다고 생각하세요.` : ''} 숙소·기준점 자체는 일정에 넣지 마세요.
- 식당은 점심(11:30~13:30)·저녁(18:00~20:00) 무렵에, 카페는 오후에, 술집은 저녁 이후에.
- 영업시간이 있으면 그 요일·시간에 영업하는 때에만 넣으세요. "휴무"인 요일에는 넣지 마세요.
- 같은 장소를 두 번 넣지 마세요. "이미 다녀옴"·"다른 날 일정에 있음"인 곳은 되도록 빼세요.
- ${likeRule}
- 시간은 현지 시간 "HH:MM" (24시간). 장소 없는 일정(호텔 휴식 등)은 하루 2개까지만, {"title": "..."} 로.
- title 은 비워두면 장소 이름을 씁니다. 꼭 필요할 때만 짧게(예: "점심 - 이치란"). note 는 한국어 한 문장(왜 이 순서인지, 주문 팁 등), 60자 이내, 없으면 생략.
${r.text ? `- 사용자 요청(최우선, 단 위 규칙과 장소 목록 안에서): "${r.text}"\n` : ''}
JSON 코드블록 하나만 출력하세요.
\`\`\`json
{"days": [{"date": "${r.days[0].date}", "items": [{"f": 1}, {"place": <장소 번호>, "time": "10:00", "title": null, "note": "..."}, {"title": "호텔 휴식", "time": "15:00"}]}], "comment": "전체 동선 한 줄 설명"}
\`\`\``;
}

// 생각 수준: 일정 짜기는 LOW (추천보다 조금 더 생각), 지원하지 않으면 설정 없이
function requestBody(text: string, thinking: string | null) {
  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text }] }],
    ...(thinking ? { generationConfig: { thinkingConfig: { thinkingLevel: thinking } } } : {}),
  });
}

type Attempt = { model: string; status: number; note?: string };
async function callGemini(key: string, text: string, attempts: Attempt[]) {
  for (const model of MODELS) {
    const send = (thinking: string | null) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: requestBody(text, thinking),
      signal: AbortSignal.timeout(45000),
    });
    let res = await send('LOW');
    if (res.status === 400) {
      const t = await res.text();
      res = /thinking/i.test(t) ? await send(null) : new Response(t, { status: 400 });
    }
    if (res.ok) {
      attempts.push({ model, status: 200 });
      return { data: await res.json(), model };
    }
    const note = (await res.text()).slice(0, 160);
    attempts.push({ model, status: res.status, note });
    console.error(JSON.stringify({ gemini: 'error', model, status: res.status, note }));
    if (res.status !== 404 && res.status !== 429) return null;
  }
  return null;
}

type Usage = { prompt: number; output: number; tool: number; thoughts: number; total: number };
function addUsage(u: Usage, data: any) {
  const m = data?.usageMetadata || {};
  u.prompt += Number(m.promptTokenCount || 0);
  u.output += Number(m.candidatesTokenCount || 0);
  u.tool += Number(m.toolUsePromptTokenCount || 0);
  u.thoughts += Number(m.thoughtsTokenCount || 0);
  u.total += Number(m.totalTokenCount || 0);
}

// AI 결과 1차 정리: 날짜·번호가 맞는 것만 (최종 검증은 앱)
function tidy(raw: any, r: Req) {
  const dates = new Set(r.days.map((d) => d.date));
  let count = 0;
  const days = (Array.isArray(raw?.days) ? raw.days : []).filter((d: any) => dates.has(d?.date)).map((d: any) => {
    const fixedN = r.days.find((x) => x.date === d.date)?.fixed.length || 0;
    const items = (Array.isArray(d.items) ? d.items : []).slice(0, 20).map((it: any) => {
      const f = int(typeof it?.f === 'string' ? it.f.replace(/^F/i, '') : it?.f, 1, fixedN);
      if (f) return { f };
      const place = int(it?.place, 1, r.places.length);
      const title = str(it?.title, 100);
      if (!place && !title) return null;
      count++;
      return { place, time: hm(typeof it?.time === 'string' ? it.time.trim().padStart(5, '0') : null), title, note: str(it?.note, 200) };
    }).filter(Boolean);
    return { date: d.date, items };
  });
  return { days, comment: str(raw?.comment, 300), count };
}

Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (o: unknown) => { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* 연결 끊김 */ } };
      try { await run(req, send); } catch (e) { console.error('plan failed', e); send({ t: 'error', error: 'AI_FAILED' }); }
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
  const r = readRequest(body.request);
  if (!tripId || !r) return fail('BAD_REQUEST');
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return fail('NO_API_KEY');

  const call = await supabase.rpc('begin_ai_call', { p_trip: tripId, p_kind: 'plan' });
  if (call.error) {
    const m = call.error.message;
    const code = ['AI_NOT_ALLOWED', 'AI_PLAN_LIMIT', 'AI_LIMIT', 'GOOGLE_REQUIRED', 'AUTH_REQUIRED', 'BAD_REQUEST'].find((c) => m.includes(c)) || 'FORBIDDEN';
    return fail(code);
  }
  const callId: number = call.data.id;
  const usage: Usage = { prompt: 0, output: 0, tool: 0, thoughts: 0, total: 0 };
  const finish = (ok: boolean, model: string | null) => supabase.rpc('finish_ai_call', {
    p_id: callId, p_ok: ok, p_model: model,
    p_prompt: usage.prompt, p_output: usage.output, p_tool: usage.tool,
    p_thoughts: usage.thoughts, p_total: usage.total, p_ms: Date.now() - t0,
  }).then(() => {}, () => {});
  stage('check', 'done', tCheck);

  const attempts: Attempt[] = [];
  const tPlan = Date.now();
  stage('plan', 'start');
  let res: { data: any; model: string } | null = null;
  try {
    res = await callGemini(key, prompt(r), attempts);
  } catch (e) {
    console.error('gemini fetch failed', e);
    await finish(false, null);
    return fail('AI_FAILED', { attempts });
  }
  if (!res) {
    await finish(false, null);
    return fail(attempts.some((a) => a.status === 429) ? 'AI_BUSY' : 'AI_FAILED', { attempts });
  }
  addUsage(usage, res.data);
  stage('plan', 'done', tPlan);

  const text = (res.data?.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('').trim();
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  let raw: any = null;
  try { raw = JSON.parse(match?.[1] || ''); } catch { raw = null; }
  const out = raw ? tidy(raw, r) : null;
  if (!out || !out.count) {
    console.error('plan parse/empty', text.slice(0, 500));
    await finish(false, res.model);
    return fail(out ? 'AI_EMPTY' : 'AI_PARSE', { attempts });
  }
  await finish(true, res.model);
  timings.total = Date.now() - t0;
  send({
    t: 'result', days: out.days, comment: out.comment, model: res.model, usage, timings,
    remaining: call.data.remaining ?? null, trip_remaining: call.data.trip_remaining ?? null,
  });
}
