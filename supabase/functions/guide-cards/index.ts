// =====================================================================
// guide-cards  (AI 가이드 카드)
//   card:
//     weather  — 지난 3년 같은 날짜의 실제 기온 · 비(Open-Meteo, 키 없음) + 출발 2주 안이면 예보 → AI 가 옷차림 글
//     landmark — 등록한 명소별 체크포인트 (구글 검색)
//     entry    — 입국(공항 → 첫 숙소) · 출국(마지막 숙소 → 공항) 동선 + 체크리스트 (구글 검색)
//     stay     — 숙소별 체크인 · 체크아웃 · 짐 맡기기 · 가까운 역 (구글 검색)
//   - 권한 · 한도: begin_ai_guide (migration_016) — 하루 한도는 추천 · 일정 짜기와 같이, 카드마다 여행당 3번
//   - 응답은 스트리밍(NDJSON): {"t":"stage",...} → {"t":"result",...} 또는 {"t":"error",...}
//   - 결과는 마크다운 본문 + 출처. 앱이 가이드 카드(guides.ai_guide)로 저장
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

const CARDS = ['weather', 'landmark', 'entry', 'stay'] as const;
type Card = typeof CARDS[number];
const MAX_DAYS = 14;
const MODE_TEXT: Record<string, string> = { flight: '항공편', train: '기차', ship: '배', bus: '버스' };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const str = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};
const coord = (v: unknown, lim: number) => (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= lim ? Math.round(v * 1e4) / 1e4 : null);
const isDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
const hm = (v: unknown) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d/.test(v) ? v.slice(0, 5) : null);
const addDays = (d: string, n: number) => new Date(Date.parse(d) + n * 86400000).toISOString().slice(0, 10);
const shiftYear = (d: string, n: number) => {
  const y = Number(d.slice(0, 4)) + n;
  const md = d.slice(5) === '02-29' ? '02-28' : d.slice(5);
  return `${y}-${md}`;
};

// ---------------------------------------------------------------- 요청 정리
type Leg = { mode: string; code: string | null; dep_name: string | null; dep_date: string | null; dep_time: string | null; dep_terminal: string | null;
  arr_name: string | null; arr_date: string | null; arr_time: string | null; arr_terminal: string | null };
type Stay = { name: string; zone: string | null; local: string | null; from: string | null; to: string | null };
type Req = {
  destination: string; start: string; end: string;
  weather: { lat: number; lng: number; place: string | null } | null;
  landmarks: { name: string; zone: string | null; local: string | null; sig: string | null }[];
  out: Leg | null; back: Leg | null; stays: Stay[];
};
const leg = (x: any): Leg | null => (x && typeof x === 'object' ? {
  mode: MODE_TEXT[x.mode] ? x.mode : 'flight', code: str(x.code, 20),
  dep_name: str(x.dep_name, 60), dep_date: isDate(x.dep_date) ? x.dep_date : null, dep_time: hm(x.dep_time), dep_terminal: str(x.dep_terminal, 20),
  arr_name: str(x.arr_name, 60), arr_date: isDate(x.arr_date) ? x.arr_date : null, arr_time: hm(x.arr_time), arr_terminal: str(x.arr_terminal, 20),
} : null);
function readRequest(b: any): Req | null {
  const destination = str(b?.destination, 80);
  if (!destination || !isDate(b?.start)) return null;
  const end = isDate(b?.end) && b.end >= b.start ? b.end : b.start;
  const lat = coord(b?.weather?.lat, 90); const lng = coord(b?.weather?.lng, 180);
  return {
    destination, start: b.start, end,
    weather: lat != null && lng != null ? { lat, lng, place: str(b.weather.place, 60) } : null,
    landmarks: (Array.isArray(b?.landmarks) ? b.landmarks : []).slice(0, 12).map((p: any) => ({
      name: str(p?.name, 60), zone: str(p?.zone, 30), local: str(p?.local, 60), sig: str(p?.sig, 60),
    })).filter((p: any) => p.name),
    out: leg(b?.out), back: leg(b?.back),
    stays: (Array.isArray(b?.stays) ? b.stays : []).slice(0, 6).map((s: any) => ({
      name: str(s?.name, 60), zone: str(s?.zone, 30), local: str(s?.local, 60),
      from: isDate(s?.from) ? s.from : null, to: isDate(s?.to) ? s.to : null,
    })).filter((s: any) => s.name),
  };
}
// 카드마다 필요한 정보 (앱도 같은 기준으로 버튼을 막지만 한 번 더)
function missing(card: Card, r: Req): boolean {
  if (card === 'weather') return !r.weather;
  if (card === 'landmark') return !r.landmarks.length;
  if (card === 'entry') return !r.out?.arr_name || !r.out?.arr_time || !r.back?.dep_name || !r.back?.dep_time || !r.stays.length;
  return !r.stays.length;
}

// ---------------------------------------------------------------- Open-Meteo
type DayW = { date: string; max: number | null; min: number | null; rain: number | null };
async function meteo(url: string): Promise<DayW[]> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`meteo ${res.status}`);
  const d = (await res.json())?.daily || {};
  return (d.time || []).map((t: string, i: number) => ({
    date: t, max: d.temperature_2m_max?.[i] ?? null, min: d.temperature_2m_min?.[i] ?? null, rain: d.precipitation_sum?.[i] ?? null,
  }));
}
const avg = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number');
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};
async function weatherData(r: Req) {
  const w = r.weather!;
  const start = r.start; const end = r.end > addDays(start, MAX_DAYS - 1) ? addDays(start, MAX_DAYS - 1) : r.end;
  const daily = 'temperature_2m_max,temperature_2m_min,precipitation_sum';
  const q = `latitude=${w.lat}&longitude=${w.lng}&daily=${daily}&timezone=auto`;
  const years = [1, 2, 3];
  const past = await Promise.all(years.map((n) =>
    meteo(`https://archive-api.open-meteo.com/v1/archive?${q}&start_date=${shiftYear(start, -n)}&end_date=${shiftYear(end, -n)}`).catch(() => [] as DayW[])));
  const all = past.flat();
  if (!all.length) return null;
  const rainy = all.filter((d) => (d.rain ?? 0) >= 1).length;
  const summary = {
    years: past.map((p, i) => (p.length ? Number(start.slice(0, 4)) - years[i] : null)).filter(Boolean) as number[],
    avgMax: avg(all.map((d) => d.max)), avgMin: avg(all.map((d) => d.min)),
    hottest: Math.max(...all.map((d) => d.max ?? -99)), coldest: Math.min(...all.map((d) => d.min ?? 99)),
    rainyPct: Math.round((rainy / all.length) * 100),
  };
  // 출발이 16일 안이면 실제 예보도
  const today = new Date().toISOString().slice(0, 10);
  let forecast: DayW[] = [];
  if (start <= addDays(today, 15) && end >= today) {
    const fs = start < today ? today : start;
    const fe = end > addDays(today, 15) ? addDays(today, 15) : end;
    forecast = await meteo(`https://api.open-meteo.com/v1/forecast?${q}&start_date=${fs}&end_date=${fe}`).catch(() => []);
  }
  return { summary, forecast, start, end };
}
function weatherTable(d: NonNullable<Awaited<ReturnType<typeof weatherData>>>, place: string) {
  const s = d.summary;
  const n = (x: number | null) => (x == null ? '-' : `${x}°`);
  const lines = [
    `**${place} · ${d.start.slice(5).replace('-', '/')} ~ ${d.end.slice(5).replace('-', '/')}** (지난 ${s.years.length}년 같은 날짜 실제 기록)`,
    '',
    `| 평균 최고 | 평균 최저 | 가장 더운 날 | 가장 추운 날 | 비 온 날 |`,
    `|---|---|---|---|---|`,
    `| ${n(s.avgMax)} | ${n(s.avgMin)} | ${n(s.hottest)} | ${n(s.coldest)} | ${s.rainyPct}% |`,
  ];
  if (d.forecast.length) {
    lines.push('', '**지금 나온 예보**', '', '| 날짜 | 최고 | 최저 | 비 |', '|---|---|---|---|');
    for (const f of d.forecast) lines.push(`| ${f.date.slice(5).replace('-', '/')} | ${n(f.max)} | ${n(f.min)} | ${f.rain != null ? `${f.rain}mm` : '-'} |`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 프롬프트
const legText = (l: Leg | null, side: 'dep' | 'arr') => (l ? [
  MODE_TEXT[l.mode], l.code, side === 'arr' ? `${l.arr_name || ''}${l.arr_terminal ? ` 터미널 ${l.arr_terminal}` : ''} ${l.arr_date || ''} ${l.arr_time || ''} 도착`
    : `${l.dep_name || ''}${l.dep_terminal ? ` 터미널 ${l.dep_terminal}` : ''} ${l.dep_date || ''} ${l.dep_time || ''} 출발`,
].filter(Boolean).join(' ') : '');
const stayText = (s: Stay) => `${s.name}${s.local ? ` (${s.local})` : ''}${s.zone ? ` · ${s.zone}` : ''}${s.from ? ` · ${s.from}${s.to && s.to !== s.from ? `~${s.to}` : ''}` : ''}`;

const COMMON = `규칙:
- 한국어, 여행 중 휴대폰으로 빠르게 읽는 안내 카드. 마크다운만 출력 (머리말 · 맺음말 · 코드블록 없이).
- 소제목은 "### ", 목록은 "- ". 문장은 짧게. 굵게는 꼭 필요한 곳만.
- 확실하지 않은 숫자(요금 · 시간)는 "약"을 붙이고, 바뀔 수 있는 정보는 "(변동 가능)"을 붙이세요.
- 전체 900자 안팎.`;

function prompt(card: Card, r: Req, extra = ''): string {
  if (card === 'weather') {
    return `${r.destination} 여행 (${r.start} ~ ${r.end}) 옷차림 안내를 써 주세요.
아래는 실제 기상 기록(Open-Meteo)입니다. 숫자를 다시 쓰지 말고, 이 숫자에 맞는 옷차림만 쓰세요.
${extra}

출력 형식:
### 옷차림
- 낮 / 아침저녁 / 실내(냉난방) 기준으로 3~4줄
### 챙길 것
- 우산 · 겉옷 · 신발 등 3~5줄 (비 온 날 비율을 보고 판단)
### 한 줄 팁
- 1줄

${COMMON}`;
  }
  if (card === 'landmark') {
    return `${r.destination} 여행 (${r.start} ~ ${r.end}). 아래 명소마다 가기 전에 알아둘 체크포인트를 구글 검색으로 확인해 써 주세요.
명소:
${r.landmarks.map((p, i) => `${i + 1}. ${p.name}${p.local ? ` (${p.local})` : ''}${p.zone ? ` · ${p.zone}` : ''}${p.sig ? ` · 대표: ${p.sig}` : ''}`).join('\n')}

출력 형식 (명소마다):
### 명소 이름
- 꼭 볼 것 (1~2줄)
- 예약 · 입장권 · 휴무 (여행 날짜 기준, 확인된 것만)
- 덜 붐비는 시간 · 걸리는 시간
- 주의 (복장 · 촬영 금지 등, 있을 때만)

${COMMON.replace('900자', `${Math.min(300 * r.landmarks.length, 2400)}자`)}`;
  }
  if (card === 'entry') {
    const first = r.stays[0]; const last = r.stays[r.stays.length - 1];
    return `${r.destination} 여행의 입국 · 출국 동선과 체크리스트를 구글 검색으로 확인해 써 주세요.
- 가는 편: ${legText(r.out, 'arr')}
- 첫 숙소: ${stayText(first)}
- 오는 편: ${legText(r.back, 'dep')}
- 마지막 숙소: ${stayText(last)}

출력 형식:
### 입국 (도착 → 첫 숙소)
- 도착 뒤 순서: 입국 심사 · 세관 · 짐 찾기 (온라인 사전 등록이 있으면 이름과 함께)
- 공항 → 숙소 가는 방법 2~3가지: 이름 · 약 걸리는 시간 · 약 요금 · 막차/운행 시간 주의
- 도착 시각에 맞춘 추천 1가지
### 출국 (마지막 숙소 → 공항)
- 숙소에서 나설 시각 (출발 시각 기준, 국제선이면 보통 2~3시간 전 공항 도착)
- 가는 방법 1~2가지와 약 걸리는 시간
- 공항 터미널 · 세금 환급(면세) 주의
### 체크리스트
- 출발 전 준비 5~8개 (여권 유효기간 · 입국 사전 등록 · 데이터(eSIM) · 교통카드 · 환전 등, 이 나라에 맞는 것만)

${COMMON.replace('900자', '1500자')}`;
  }
  return `${r.destination} 여행에서 묵는 숙소 정보를 구글 검색으로 확인해 써 주세요.
숙소:
${r.stays.map((s, i) => `${i + 1}. ${stayText(s)}`).join('\n')}

출력 형식 (숙소마다):
### 숙소 이름
- 체크인 · 체크아웃 시간
- 체크인 전 · 체크아웃 뒤 짐 맡기기
- 가까운 역 · 공항 가는 방법 (약 시간)
- 근처 편의점 · 먹을 곳 · 알아둘 점 (1~2줄)
정보를 찾지 못한 항목은 "숙소에 확인"이라고 쓰세요.

${COMMON.replace('900자', `${Math.min(400 * r.stays.length, 2000)}자`)}`;
}

// ---------------------------------------------------------------- Gemini
type Attempt = { model: string; status: number; note?: string };
function requestBody(text: string, grounded: boolean, thinking: string | null) {
  return JSON.stringify({
    contents: [{ role: 'user', parts: [{ text }] }],
    ...(grounded ? { tools: [{ googleSearch: {} }] } : {}),
    ...(thinking ? { generationConfig: { thinkingConfig: { thinkingLevel: thinking } } } : {}),
  });
}
async function callGemini(key: string, text: string, grounded: boolean, attempts: Attempt[]) {
  for (const model of MODELS) {
    const send = (thinking: string | null) => fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: requestBody(text, grounded, thinking),
      signal: AbortSignal.timeout(50000),
    });
    let res = await send('MINIMAL');
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
// 마크다운 정리: 코드블록 · HTML 태그 · 인용 번호 제거, 길이 제한
function tidyMd(text: string) {
  return text
    .replace(/^```[a-z]*\s*|```\s*$/gim, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\[(\d+(,\s*\d+)*)\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 6000);
}

// ---------------------------------------------------------------- 실행
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      const send = (o: unknown) => { try { ctrl.enqueue(enc.encode(JSON.stringify(o) + '\n')); } catch { /* 연결 끊김 */ } };
      try { await run(req, send); } catch (e) { console.error('guide failed', e); send({ t: 'error', error: 'AI_FAILED' }); }
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
  const card = CARDS.includes(body.card) ? body.card as Card : null;
  const r = readRequest(body.request);
  if (!tripId || !card || !r) return fail('BAD_REQUEST');
  if (missing(card, r)) return fail('GUIDE_MISSING');
  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return fail('NO_API_KEY');

  const call = await supabase.rpc('begin_ai_guide', { p_trip: tripId, p_card: card });
  if (call.error) {
    const m = call.error.message;
    const code = ['AI_NOT_ALLOWED', 'AI_GUIDE_LIMIT', 'AI_LIMIT', 'GOOGLE_REQUIRED', 'AUTH_REQUIRED', 'BAD_REQUEST'].find((c) => m.includes(c)) || 'FORBIDDEN';
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

  // 날씨: 실제 기록 먼저
  let head = '';
  let extra = '';
  const sources: { uri: string; title: string }[] = [];
  if (card === 'weather') {
    const tW = Date.now();
    stage('weather', 'start');
    const w = await weatherData(r).catch((e) => { console.error('meteo', e); return null; });
    if (!w) { await finish(false, null); return fail('WEATHER_FAILED'); }
    head = weatherTable(w, r.weather!.place || r.destination);
    extra = JSON.stringify({ 지난기록: w.summary, 예보: w.forecast });
    sources.push({ uri: 'https://open-meteo.com/', title: 'Open-Meteo (기상 기록 · 예보)' });
    stage('weather', 'done', tW);
  }

  const attempts: Attempt[] = [];
  const grounded = card !== 'weather';
  const tAi = Date.now();
  const aiStage = grounded ? 'search' : 'write';
  stage(aiStage, 'start');
  let res: { data: any; model: string } | null = null;
  try {
    res = await callGemini(key, prompt(card, r, extra), grounded, attempts);
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
  stage(aiStage, 'done', tAi);

  const cand = res.data?.candidates?.[0] || {};
  const text = tidyMd((cand.content?.parts || []).map((p: { text?: string }) => p.text || '').join(''));
  if (text.length < 40) {
    console.error('guide empty', text);
    await finish(false, res.model);
    return fail('AI_EMPTY', { attempts });
  }
  const meta = cand.groundingMetadata || {};
  for (const c of meta.groundingChunks || []) {
    const w = c?.web;
    if (w?.uri && /^https:\/\//.test(w.uri) && sources.length < 8) sources.push({ uri: w.uri, title: String(w.title || w.domain || '').slice(0, 80) });
  }
  await finish(true, res.model);
  timings.total = Date.now() - t0;
  send({
    t: 'result', card, body: head ? `${head}\n\n${text}` : text, sources,
    model: res.model, usage, timings, created_at: new Date().toISOString(),
    remaining: call.data.remaining ?? null, card_remaining: call.data.card_remaining ?? null,
  });
}
