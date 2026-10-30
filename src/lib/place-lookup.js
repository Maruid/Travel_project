import { supabase } from './supabase.js';
import { parseMapsUrl, isShortMapsLink, isGoogleMapsUrl } from './maps-link.js';

// 링크 → 좌표/이름. 짧은 링크는 Edge Function(resolve-maps-link)으로 펼친 뒤 파싱
export async function lookupMapsLink(input) {
  const url = input.trim();
  if (!isGoogleMapsUrl(url)) throw new Error('구글 맵 링크가 아닙니다.');

  if (!isShortMapsLink(url)) return { ...parseMapsUrl(url), resolvedUrl: url };

  const { data, error } = await supabase.functions.invoke('resolve-maps-link', { body: { url } });
  if (error) throw new Error('짧은 링크를 펼치지 못했습니다. 지도에서 직접 위치를 찍어주세요.');

  // 함수는 거쳐간 URL 전부를 돌려줌 → 좌표가 있는 쪽을 우선 사용
  const candidates = [...(data?.chain || []), data?.finalUrl].filter(Boolean);
  let best = { lat: null, lng: null, precision: null, name: null, query: null };
  for (const c of candidates) {
    const p = parseMapsUrl(c);
    if (p.precision === 'pin') return { ...p, name: p.name || best.name, resolvedUrl: c };
    if (p.precision === 'center' && best.precision !== 'center') best = { ...p, name: p.name || best.name, resolvedUrl: c };
    if (!best.name && p.name) best.name = p.name;
    if (!best.query && p.query) best.query = p.query;
  }
  return { ...best, resolvedUrl: data?.finalUrl || url };
}

// 무료 지오코딩 (OpenStreetMap Nominatim)
// 이용 정책: 초당 1회 이하, 자동완성 용도 금지 → 버튼을 눌렀을 때만 호출
export async function geocode(query, { near } = {}) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '5', q: query, 'accept-language': 'ko' });
  if (near) {
    const d = 0.5; // 대략 반경 50km 범위 우선
    params.set('viewbox', `${near.lng - d},${near.lat + d},${near.lng + d},${near.lat - d}`);
  }
  const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if (!res.ok) throw new Error('주소 검색에 실패했습니다.');
  const rows = await res.json();
  return rows.map((r) => ({
    lat: parseFloat(r.lat),
    lng: parseFloat(r.lon),
    label: r.display_name,
    name: r.name || r.display_name.split(',')[0],
  }));
}

export function currentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('이 브라우저는 위치 정보를 지원하지 않습니다.'));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => reject(new Error('위치 접근이 거부되었습니다.')),
      { enableHighAccuracy: true, timeout: 8000 },
    );
  });
}
