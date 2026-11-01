import { supabase } from './supabase.js';

// =====================================================================
// 구글 장소 정보 (Edge Function place-details → Places API)
//  - 링크 붙여넣기 시 자동 조회 / 등록된 장소는 버튼으로 조회
//  - 가져온 값은 편집 가능한 칸에 채워 저장 (사용자가 직접 쓴 값은 덮어쓰지 않음)
// =====================================================================

const ERRORS = {
  PLACES_LIMIT: '이번 달 구글 장소 조회 한도(900건)를 모두 썼어요. 다음 달 1일에 초기화돼요.',
  NOT_FOUND: '구글 지도에서 이 장소를 찾지 못했어요. 이름이나 지역을 확인해 주세요.',
  NO_API_KEY: '구글 장소 키가 아직 설정되지 않았어요. (관리자: Edge Function Secrets 에 GOOGLE_PLACES_API_KEY 등록)',
  FORBIDDEN: '이 여행의 멤버만 사용할 수 있어요.',
};

// 같은 링크/장소를 반복 조회하지 않도록 세션 동안 기억 (요청 키 → 결과)
const cache = new Map();

export async function fetchPlaceDetails(params, { cacheKey } = {}) {
  if (!navigator.onLine) throw Object.assign(new Error('온라인 상태에서만 조회할 수 있어요.'), { code: 'OFFLINE' });
  if (cacheKey && cache.has(cacheKey)) return cache.get(cacheKey);

  const { data, error } = await supabase.functions.invoke('place-details', { body: params });
  if (error) {
    let body = null;
    try { body = await error.context?.json(); } catch {}
    const code = body?.error || 'PLACES_FAILED';
    throw Object.assign(new Error(ERRORS[code] || '구글 장소 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.'), { code });
  }
  if (cacheKey) cache.set(cacheKey, data);
  return data;   // { place, distance, searched, remaining }
}

// DB 에 저장하는 구글 전용 컬럼
export function googleColumns(g) {
  if (!g) return {};
  return {
    google_place_id: g.placeId,
    opening_hours: g.openingHours,
    rating: g.rating,
    rating_count: g.ratingCount,
    business_status: g.businessStatus,
    phone: g.phone,
    website: g.website,
    google_synced_at: new Date().toISOString(),
  };
}

// 저장된 장소 → 편집기에서 다시 쓸 수 있는 형태
export function googleFromPlace(p) {
  if (!p?.google_place_id) return null;
  return {
    placeId: p.google_place_id, openingHours: p.opening_hours, rating: p.rating, ratingCount: p.rating_count,
    businessStatus: p.business_status, phone: p.phone, website: p.website,
  };
}

export const REVIEW_DISTANCE_M = 300;

/**
 * 이미 등록된 장소에 구글 정보를 합칠 때의 변경분
 *  - 구글 전용 칸(영업시간, 평점 등)은 항상 갱신
 *  - 비어 있는 칸(지역, 가격, 주의 뱃지, 길찾기 링크, 좌표)만 채움
 *  - 좌표: 기존 위치와 가까우면 더 정확한 구글 좌표로 교체, 멀면 바꾸지 않고 "확인 필요"
 *  - 이름·소개·메뉴처럼 직접 쓴 내용은 건드리지 않음
 */
export function mergeIntoExisting(p, g, distance) {
  const patch = googleColumns(g);
  const empty = (v) => v == null || v === '';
  let review = null;

  if (empty(p.zone) && g.zone) patch.zone = g.zone;
  if (empty(p.price_min) && empty(p.price_max) && (g.priceMin || g.priceMax)) {
    patch.price_min = g.priceMin; patch.price_max = g.priceMax; patch.price_currency = g.priceCurrency;
  }
  if (g.businessStatus === 'CLOSED_PERMANENTLY' || g.businessStatus === 'CLOSED_TEMPORARILY') {
    patch.warn_badge = g.warnBadge;            // 폐업·임시휴업은 기존 뱃지보다 중요
  } else if (empty(p.warn_badge) && g.warnBadge) {
    patch.warn_badge = g.warnBadge;
  }
  if (empty(p.maps_url) && g.mapsUrl) patch.maps_url = g.mapsUrl;

  if (g.lat != null && g.lng != null) {
    if (p.lat == null || p.lng == null) {
      patch.lat = g.lat; patch.lng = g.lng;
    } else if (distance != null && distance <= REVIEW_DISTANCE_M) {
      patch.lat = g.lat; patch.lng = g.lng;
    } else if (distance != null) {
      review = { distance, gLat: g.lat, gLng: g.lng, gName: g.name };
    }
  }
  return { patch, review };
}

// 오늘 요일 (여행지 시간대 기준). weekdayDescriptions 는 월요일부터 시작
export function todayIndexMondayFirst(timezone) {
  try {
    const wd = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(new Date());
    return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(wd);
  } catch {
    return (new Date().getDay() + 6) % 7;
  }
}

export const STATUS_TEXT = {
  CLOSED_PERMANENTLY: '구글 지도에 폐업으로 표시된 곳이에요.',
  CLOSED_TEMPORARILY: '구글 지도에 임시 휴업으로 표시된 곳이에요.',
};
