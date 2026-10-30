// =====================================================================
// resolve-maps-link
//   maps.app.goo.gl 같은 짧은 구글 맵 링크를 서버에서 따라가 최종 URL 을 돌려줌
//   (브라우저는 CORS 때문에 리다이렉트 결과를 읽을 수 없음)
//
//   - 로그인한 사용자만 (익명 로그인 포함)
//   - 구글 맵 관련 호스트만 허용 → 임의 URL 을 대신 요청하는 공개 프록시가 되지 않게
//   - 페이지 본문은 읽지 않고 리다이렉트 Location 만 따라감
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const MAX_HOPS = 6;

function allowedHost(u: URL): boolean {
  const h = u.hostname.toLowerCase();
  return h === 'maps.app.goo.gl'
    || h === 'goo.gl'
    || h === 'maps.google.com'
    || /^(www\.)?google\.[a-z.]+$/.test(h)
    || /^maps\.google\.[a-z.]+$/.test(h);
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  // ---- 인증: 앱 사용자 세션의 JWT 확인 ----
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'AUTH_REQUIRED' }, 401);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
  );
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
  if (authError || !user) return json({ error: 'AUTH_REQUIRED' }, 401);

  // ---- 입력 검증 ----
  let input: string;
  try {
    ({ url: input } = await req.json());
  } catch {
    return json({ error: 'BAD_REQUEST' }, 400);
  }
  let current: URL;
  try {
    current = new URL(String(input).trim());
  } catch {
    return json({ error: 'INVALID_URL' }, 400);
  }
  if (current.protocol !== 'https:' || !allowedHost(current)) return json({ error: 'HOST_NOT_ALLOWED' }, 400);

  // ---- 리다이렉트 따라가기 ----
  const chain: string[] = [current.href];
  for (let i = 0; i < MAX_HOPS; i++) {
    let res: Response;
    try {
      res = await fetch(current.href, {
        method: 'GET',
        redirect: 'manual',
        headers: {
          // 모바일 앱 공유 링크는 UA 에 따라 다른 곳으로 보내는 경우가 있어 일반 브라우저로 요청
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
          'Accept-Language': 'ko,en;q=0.8',
        },
        signal: AbortSignal.timeout(6000),
      });
    } catch {
      return json({ error: 'FETCH_FAILED', chain }, 502);
    }
    await res.body?.cancel();

    const loc = res.headers.get('location');
    if (res.status < 300 || res.status >= 400 || !loc) break;

    let next: URL;
    try { next = new URL(loc, current); } catch { break; }
    if (next.protocol !== 'https:' || !allowedHost(next)) break;   // 동의 페이지 등 외부로 나가면 중단
    current = next;
    chain.push(current.href);
    // 좌표가 들어간 URL 에 도달하면 더 갈 필요 없음
    if (/!3d-?\d|@-?\d+\.\d+,-?\d+\.\d+/.test(current.href)) break;
  }

  return json({ finalUrl: current.href, chain });
});
