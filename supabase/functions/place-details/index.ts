// =====================================================================
// place-details
//   Google Places API (New) 로 장소의 사실 정보(좌표, 영업시간, 가격대, 평점, 폐업 여부 등)를 조회
//
//   흐름: placeId 가 없으면 Text Search (IDs Only) 로 찾고 → Place Details (Enterprise) 1건
//   - 로그인 + 해당 여행 멤버만 (consume_places_quota RPC 가 확인)
//   - 월 한도 900건 (구글 무료량 1,000건/월 안쪽), 종류별로 따로 집계
//   - 요청 필드는 Enterprise 이하만 사용 (리뷰·요약 같은 Atmosphere 필드는 요청하지 않음 → 등급 상승 방지)
//   - 키: Edge Function Secrets 의 GOOGLE_PLACES_API_KEY
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// 이 목록보다 비싼 필드를 추가하면 과금 등급이 올라갈 수 있으니 주의
const DETAIL_FIELDS = [
  'id', 'displayName', 'location', 'googleMapsUri', 'addressComponents', 'primaryType', 'types',
  'businessStatus', 'regularOpeningHours', 'priceRange', 'rating', 'userRatingCount',
  'nationalPhoneNumber', 'websiteUri',
].join(',');

const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];   // Places: 0 = 일요일

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s)));
}

// primaryType / types → 앱 카테고리 종류
export function kindOf(primary?: string, types: string[] = []): string | null {
  const all = [primary, ...types].filter(Boolean) as string[];
  const has = (re: RegExp) => all.some((t) => re.test(t));
  if (has(/^(lodging|hotel|hostel|motel|resort_hotel|bed_and_breakfast|guest_house|inn|japanese_inn|campground)$/)) return 'lodging';
  if (has(/(train|subway|transit|bus|light_rail|ferry)_station$|^airport$|^bus_stop$/)) return 'transit';
  if (has(/^(cafe|coffee_shop|tea_house|bakery|dessert_shop|ice_cream_shop|confectionery|chocolate_shop|juice_shop|cat_cafe|dog_cafe)$/)) return 'cafe';
  if (has(/^(bar|pub|wine_bar|cocktail_bar|night_club|izakaya_restaurant|bar_and_grill|beer_hall|lounge_bar|sports_bar|hookah_bar)$/)) return 'bar';
  if (has(/restaurant$|^(food|meal_takeaway|meal_delivery|food_court|diner|deli|sandwich_shop)$/)) return 'food';
  if (has(/(store|shop|market|mall)$|^(department_store|supermarket|convenience_store)$/)) return 'shop';
  if (has(/^(tourist_attraction|museum|park|national_park|amusement_park|zoo|aquarium|art_gallery|historical_landmark|historical_place|monument|place_of_worship|shinto_shrine|buddhist_temple|church|castle|observation_deck|garden|botanical_garden|beach|hiking_area|scenic_spot|cultural_landmark|plaza|landmark)$/)) return 'spot';
  return null;
}

// periods → 요일별 영업 여부. 24시간 영업은 close 없는 period 하나로 옴
export function closedDays(periods: any[] | undefined): number[] {
  if (!Array.isArray(periods) || !periods.length) return [];
  if (periods.length === 1 && periods[0]?.open && !periods[0]?.close) return [];   // 24시간
  const open = new Set(periods.map((p) => p?.open?.day).filter((d) => Number.isInteger(d)));
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => !open.has(d));
}

// 쉬는 요일 → "화요 휴무", "화·수 휴무", 연속 3일 이상이면 "주말 휴무" 등
export function closedBadge(days: number[]): string | null {
  if (!days.length || days.length >= 7) return null;
  const s = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7));   // 월요일부터 정렬
  if (s.length === 2 && s.includes(0) && s.includes(6)) return '주말 휴무';
  if (s.length === 1) return `${DAY_KO[s[0]]}요 휴무`;
  return `${s.map((d) => DAY_KO[d]).join('·')} 휴무`;
}

function zoneOf(components: any[] | undefined): string | null {
  if (!Array.isArray(components)) return null;
  const order = ['sublocality_level_2', 'sublocality_level_1', 'neighborhood', 'sublocality', 'locality'];
  for (const t of order) {
    const c = components.find((x) => Array.isArray(x?.types) && x.types.includes(t));
    if (c?.shortText || c?.longText) return String(c.shortText || c.longText).slice(0, 50);
  }
  return null;
}

const money = (m: any) => {
  if (!m) return null;
  const v = Number(m.units ?? 0) + Number(m.nanos ?? 0) / 1e9;
  return Number.isFinite(v) && v > 0 ? Math.round(v) : null;
};

export function normalize(p: any) {
  const periods = p?.regularOpeningHours?.periods;
  const closed = closedDays(periods);
  const weekday = Array.isArray(p?.regularOpeningHours?.weekdayDescriptions) ? p.regularOpeningHours.weekdayDescriptions.slice(0, 7) : null;
  const status = ['OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'].includes(p?.businessStatus) ? p.businessStatus : null;
  const priceMin = money(p?.priceRange?.startPrice);
  const priceMax = money(p?.priceRange?.endPrice);
  const currency = p?.priceRange?.startPrice?.currencyCode || p?.priceRange?.endPrice?.currencyCode || null;

  let warn: string | null = null;
  if (status === 'CLOSED_PERMANENTLY') warn = '폐업';
  else if (status === 'CLOSED_TEMPORARILY') warn = '임시 휴업';
  else warn = closedBadge(closed);

  return {
    placeId: p?.id ?? null,
    name: p?.displayName?.text ?? null,
    lat: isNum(p?.location?.latitude) ? p.location.latitude : null,
    lng: isNum(p?.location?.longitude) ? p.location.longitude : null,
    mapsUrl: typeof p?.googleMapsUri === 'string' && p.googleMapsUri.startsWith('https://') ? p.googleMapsUri : null,
    zone: zoneOf(p?.addressComponents),
    kind: kindOf(p?.primaryType, p?.types),
    openingHours: weekday || periods ? { weekday: weekday || [], periods: Array.isArray(periods) ? periods.slice(0, 30) : [], closedDays: closed } : null,
    warnBadge: warn,
    priceMin, priceMax,
    priceCurrency: priceMin || priceMax ? currency : null,
    rating: isNum(p?.rating) ? Math.round(p.rating * 10) / 10 : null,
    ratingCount: Number.isInteger(p?.userRatingCount) ? p.userRatingCount : null,
    businessStatus: status,
    phone: str(p?.nationalPhoneNumber, 40),
    website: typeof p?.websiteUri === 'string' && /^https?:\/\//.test(p.websiteUri) ? p.websiteUri.slice(0, 500) : null,
  };
}

async function placesFetch(url: string, init: RequestInit, key: string, fieldMask: string) {
  const res = await fetch(url, {
    ...init,
    headers: { 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask, 'Content-Type': 'application/json', ...(init.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  const text = await res.text();
  if (!res.ok) {
    console.error(JSON.stringify({ places: 'error', url: url.split('?')[0], status: res.status, body: text.slice(0, 300) }));
    throw Object.assign(new Error('PLACES_FAILED'), { status: res.status });
  }
  return JSON.parse(text || '{}');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  // ---- 인증 ----
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'AUTH_REQUIRED' }, 401);
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!,
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: { user } } = await supabase.auth.getUser(jwt);
  if (!user) return json({ error: 'AUTH_REQUIRED' }, 401);

  const key = Deno.env.get('GOOGLE_PLACES_API_KEY');
  if (!key) return json({ error: 'NO_API_KEY' }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: 'BAD_REQUEST' }, 400); }
  const tripId = typeof body.tripId === 'string' ? body.tripId : null;
  if (!tripId) return json({ error: 'BAD_REQUEST' }, 400);

  const name = str(body.name, 100);
  const address = str(body.address, 200);
  const zone = str(body.zone, 50);
  const destination = str(body.destination, 80);
  const near = isNum(body.lat) && isNum(body.lng) ? { lat: body.lat as number, lng: body.lng as number } : null;
  let placeId = typeof body.placeId === 'string' && /^[A-Za-z0-9_-]{10,300}$/.test(body.placeId) ? body.placeId : null;

  const quota = async (kind: 'details' | 'search') => {
    const { data, error } = await supabase.rpc('consume_places_quota', { p_trip: tripId, p_kind: kind });
    if (error) throw new Error(/PLACES_LIMIT/.test(error.message) ? 'PLACES_LIMIT' : 'FORBIDDEN');
    return data as number;
  };

  try {
    // ---- 1) place_id 찾기 (IDs Only: 가장 저렴한 등급) ----
    let searched = false;
    if (!placeId) {
      if (!name) return json({ error: 'BAD_REQUEST' }, 400);
      // 주소가 있으면 "이름 + 주소", 없으면 "이름 + 지역 + 여행지"
      const textQuery = [name, address || [zone, destination].filter(Boolean).join(' ')].filter(Boolean).join(' ');
      await quota('search');
      const found = await placesFetch('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST',
        body: JSON.stringify({
          textQuery,
          languageCode: 'ko',
          pageSize: 1,
          ...(near ? { locationBias: { circle: { center: { latitude: near.lat, longitude: near.lng }, radius: 1000 } } } : {}),
        }),
      }, key, 'places.id');
      placeId = found?.places?.[0]?.id ?? null;
      searched = true;
      if (!placeId) return json({ error: 'NOT_FOUND', searched }, 404);
    }

    // ---- 2) 상세 정보 (Enterprise 1건) ----
    const remaining = await quota('details');
    const detail = await placesFetch(
      `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=ko`,
      { method: 'GET' }, key, DETAIL_FIELDS,
    );
    const place = normalize(detail);
    const distance = near && place.lat != null && place.lng != null ? distanceM(near, { lat: place.lat, lng: place.lng }) : null;

    return json({ place, searched, distance, remaining });
  } catch (e) {
    const code = (e as Error).message;
    if (code === 'PLACES_LIMIT') return json({ error: 'PLACES_LIMIT' }, 429);
    if (code === 'FORBIDDEN') return json({ error: 'FORBIDDEN' }, 403);
    const status = (e as { status?: number }).status;
    if (status === 404) return json({ error: 'NOT_FOUND' }, 404);
    return json({ error: 'PLACES_FAILED', status: status ?? null }, 502);
  }
});
