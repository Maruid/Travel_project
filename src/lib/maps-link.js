// 구글 맵 링크 파서 (순수 함수, 네트워크 없음 → node 테스트 가능)
//
// 지원 형태
//  1) .../maps/place/<이름>/@lat,lng,17z/data=...!3d<lat>!4d<lng>...   ← !3d!4d 가 실제 핀 좌표
//  2) .../maps/@lat,lng,15z                                             ← 화면 중심 좌표
//  3) ...?q=lat,lng  /  ?ll=lat,lng  /  ?query=lat,lng  /  ?destination=lat,lng
//  4) ...?q=<가게 이름 주소>  (좌표 없음 → 이름/검색어만 추출, 지오코딩 필요)
//  5) maps.app.goo.gl/xxxx, goo.gl/maps/xxxx                            ← 짧은 링크 (서버에서 펼쳐야 함)

const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';

export function isShortMapsLink(input) {
  try {
    const u = new URL(input.trim());
    return u.hostname === 'maps.app.goo.gl' || (u.hostname === 'goo.gl' && u.pathname.startsWith('/maps'));
  } catch { return false; }
}

export function isGoogleMapsUrl(input) {
  try {
    const u = new URL(input.trim());
    const host = u.hostname.replace(/^www\./, '');
    return isShortMapsLink(input)
      || (/^google\.[a-z.]+$/.test(host) && u.pathname.startsWith('/maps'))
      || host === 'maps.google.com' || /^maps\.google\.[a-z.]+$/.test(host);
  } catch { return false; }
}

const valid = (lat, lng) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

function decodePart(s) {
  try { return decodeURIComponent(s.replace(/\+/g, ' ')).trim(); } catch { return s.replace(/\+/g, ' ').trim(); }
}

/**
 * @returns {{ lat:number|null, lng:number|null, precision:'pin'|'center'|'query'|null, name:string|null, query:string|null }}
 */
export function parseMapsUrl(input) {
  const result = { lat: null, lng: null, precision: null, name: null, query: null };
  if (!input) return result;
  const url = input.trim();

  let u;
  try { u = new URL(url); } catch { return result; }

  // 장소 이름: /maps/place/<name>/
  const placeMatch = u.pathname.match(/\/maps\/place\/([^/]+)/);
  if (placeMatch) result.name = decodePart(placeMatch[1]);

  // 1) !3d<lat>!4d<lng> (여러 개면 마지막이 해당 장소인 경우가 많음)
  const pinRe = new RegExp(`!3d${NUM}!4d${NUM}`, 'g');
  let pin, lastPin = null;
  while ((pin = pinRe.exec(url)) !== null) lastPin = pin;
  if (lastPin) {
    const lat = parseFloat(lastPin[1]), lng = parseFloat(lastPin[2]);
    if (valid(lat, lng)) return { ...result, lat, lng, precision: 'pin' };
  }

  // 3) 쿼리 파라미터 좌표
  for (const key of ['q', 'query', 'll', 'destination', 'daddr', 'center']) {
    const v = u.searchParams.get(key);
    if (!v) continue;
    const m = v.match(new RegExp(`^\\s*${NUM}\\s*,\\s*${NUM}\\s*$`));
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (valid(lat, lng)) return { ...result, lat, lng, precision: 'pin' };
    } else if (['q', 'query', 'destination', 'daddr'].includes(key)) {
      result.query = v.trim();
      if (!result.name) result.name = v.split(',')[0].trim();
    }
  }

  // 2) @lat,lng (지도 화면 중심)
  const at = url.match(new RegExp(`@${NUM},${NUM}`));
  if (at) {
    const lat = parseFloat(at[1]), lng = parseFloat(at[2]);
    if (valid(lat, lng)) return { ...result, lat, lng, precision: 'center' };
  }

  if (result.name && !result.query) result.query = result.name;
  if (result.query) result.precision = 'query';
  return result;
}
