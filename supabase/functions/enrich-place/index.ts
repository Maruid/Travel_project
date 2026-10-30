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
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
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

function buildPrompt(p: Record<string, unknown>, grounded: boolean) {
  const lines = [
    `장소 이름: ${p.name}`,
    p.zone ? `지역/동네: ${p.zone}` : '',
    p.destination ? `여행지: ${p.destination}` : '',
    p.lat != null ? `좌표: ${p.lat}, ${p.lng}` : '',
    p.mapsUrl ? `구글 맵 링크: ${p.mapsUrl}` : '',
  ].filter(Boolean).join('\n');

  const intro = grounded
    ? '당신은 여행 가이드북 편집자입니다. 아래 장소를 Google 검색으로 확인하고, 검색으로 확인된 정보만으로 JSON 하나를 만드세요.'
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

type Attempt = { model: string; grounded: boolean; status: number; quota?: string };

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

async function callGemini(key: string, prompt: string, grounded: boolean, attempts: Attempt[]) {
  for (const model of MODELS) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        ...(grounded ? { tools: [{ google_search: {} }] } : {}),
        generationConfig: { temperature: 0.2 },
      }),
      signal: AbortSignal.timeout(30000),
    });
    if (res.ok) {
      attempts.push({ model, grounded, status: 200 });
      return { data: await res.json(), model };
    }
    const quota = summarizeError(await res.text());
    attempts.push({ model, grounded, status: res.status, quota });
    console.error(JSON.stringify({ gemini: 'error', model, grounded, status: res.status, quota }));
    if (res.status !== 404 && res.status !== 429) return null;   // 그 밖의 에러는 다른 모델로도 해결되지 않음
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  // ---- 인증 + 사용량 (사용자 권한으로 RPC 호출 → 여행 멤버인지도 함께 확인) ----
  const auth = req.headers.get('Authorization') || '';
  const jwt = auth.replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'AUTH_REQUIRED' }, 401);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: 'AUTH_REQUIRED' }, 401);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const name = str(body.name, 100);
  if (!name || typeof body.tripId !== 'string') return json({ error: 'BAD_REQUEST' }, 400);

  const key = Deno.env.get('GEMINI_API_KEY');
  if (!key) return json({ error: 'NO_API_KEY' }, 500);

  const { data: remaining, error: quotaError } = await supabase.rpc('consume_ai_quota', { p_trip: body.tripId });
  if (quotaError) {
    const code = /AI_LIMIT/.test(quotaError.message) ? 'AI_LIMIT' : 'FORBIDDEN';
    return json({ error: code }, code === 'AI_LIMIT' ? 429 : 403);
  }

  // ---- Gemini 호출: 검색 그라운딩 → (전부 한도 초과면) 검색 없이 ----
  const info = {
    name,
    zone: str(body.zone, 50),
    destination: str(body.destination, 80),
    lat: typeof body.lat === 'number' ? body.lat : null,
    lng: typeof body.lng === 'number' ? body.lng : null,
    mapsUrl: str(body.mapsUrl, 500),
    currency: str(body.currency, 3),
  };
  const attempts: Attempt[] = [];
  let result: { data: any; model: string } | null = null;
  let grounded = true;
  try {
    result = await callGemini(key, buildPrompt(info, true), true, attempts);
    if (!result && attempts.length && attempts.every((a) => a.status === 404 || a.status === 429)) {
      grounded = false;
      result = await callGemini(key, buildPrompt(info, false), false, attempts);
    }
  } catch (e) {
    console.error('gemini fetch failed', e);
    return json({ error: 'AI_FAILED', attempts }, 502);
  }
  if (!result) {
    const busy = attempts.some((a) => a.status === 429);
    return json({ error: busy ? 'AI_BUSY' : 'AI_FAILED', attempts }, busy ? 429 : 502);
  }

  const { data, model } = result;
  const cand = data.candidates?.[0];
  const text: string = (cand?.content?.parts || []).map((p: { text?: string }) => p.text || '').join('');
  const match = text.match(/```json\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})/);
  let raw: Record<string, unknown> = {};
  try { raw = JSON.parse(match?.[1] || '{}'); } catch {
    console.error('parse failed', text.slice(0, 500));
    return json({ error: 'AI_PARSE' }, 502);
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

  // 근거 링크 + Google 검색 제안(그라운딩 사용 시 표시 권장)
  const meta = cand?.groundingMetadata || {};
  const sources = (meta.groundingChunks || [])
    .map((c: { web?: { uri?: string; title?: string } }) => c.web)
    .filter((w: { uri?: string } | undefined) => w?.uri && /^https:\/\//.test(w.uri))
    .slice(0, 5)
    .map((w: { uri: string; title?: string }) => ({ uri: w.uri, title: (w.title || w.uri).slice(0, 100) }));

  return json({
    fields,
    sources,
    searchSuggestions: meta.searchEntryPoint?.renderedContent || null,
    grounded: grounded && sources.length > 0,
    remaining,
    model,
    attempts,
  });
});
