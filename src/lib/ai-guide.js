// =====================================================================
// AI 가이드 카드 (guide-cards Edge Function, migration_016) — 요청 만들기 · 빠진 정보 · 저장 본문
//   순수 함수 (node 테스트). 데이터 모양은 TripStore 와 같음
// =====================================================================
import { stayFor } from './route-plan.js';
import { transportGaps } from './transport.js';
import { numberedToLinks } from './place-link.js';
import { dateRange } from './format.js';

export const GUIDE_CARDS = [
  { key: 'weather', title: '날씨 · 옷차림', icon: 'fa-cloud-sun', color: '#38bdf8', desc: '지난 3년 같은 날짜의 실제 기온 · 비 + 옷차림' },
  { key: 'landmark', title: '명소 체크포인트', icon: 'fa-landmark', color: '#c084fc', desc: '등록한 명소별 꼭 볼 것 · 예약 · 붐비는 시간' },
  { key: 'entry', title: '입국 · 출국 동선', icon: 'fa-plane-arrival', color: '#f59e0b', desc: '공항 ↔ 숙소 가는 방법 + 출발 전 체크리스트' },
  { key: 'stay', title: '숙소 정보', icon: 'fa-hotel', color: '#10b981', desc: '체크인 · 체크아웃 · 짐 맡기기 · 가까운 역' },
];
export const cardOf = (key) => GUIDE_CARDS.find((c) => c.key === key) || null;

const MAX_LANDMARKS = 12;

// 묵는 숙소 (날짜순, 이어지는 밤은 하나로). 일정 탭 숙소가 없으면 '숙소' 카테고리 장소
export function tripStays({ trip, places, days, categoryOf }) {
  const live = new Map(places.map((p) => [p.id, p]));
  const dates = dateRange(trip.start_date, trip.end_date);
  const nights = dates.slice(0, -1).length ? dates.slice(0, -1) : dates;
  const out = [];
  for (const d of nights) {
    const id = stayFor(days, d, (x) => live.has(x))?.placeId;
    if (!id) continue;
    const last = out[out.length - 1];
    if (last && last.id === id) { last.to = d; continue; }
    out.push({ id, from: d, to: d });
  }
  if (!out.length) {
    for (const p of places) if (categoryOf(p.category_id)?.kind === 'lodging') out.push({ id: p.id, from: null, to: null });
  }
  return out.map((s) => ({ ...s, place: live.get(s.id) })).filter((s) => s.place);
}

function landmarks({ places, categoryOf, likes }) {
  return places.filter((p) => categoryOf(p.category_id)?.kind === 'spot')
    .sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0) || String(a.name).localeCompare(String(b.name), 'ko'))
    .slice(0, MAX_LANDMARKS);
}

function weatherPoint(stays, places) {
  const p = stays.find((s) => s.place.lat != null)?.place
    || places.find((x) => x.is_anchor && x.lat != null)
    || places.find((x) => x.lat != null);
  return p ? { lat: p.lat, lng: p.lng, place: p.zone || null } : null;
}

// 카드마다 빠진 정보 (빈 배열이면 만들 수 있음)
export function guideGaps(card, data) {
  const { trip } = data;
  const miss = [];
  if (!trip.destination) miss.push('여행지');
  if (!trip.start_date) miss.push('여행 날짜');
  const stays = tripStays(data);
  if (card === 'weather' && !weatherPoint(stays, data.places)) miss.push('위치가 있는 숙소나 장소');
  if (card === 'landmark' && !landmarks(data).length) miss.push("'명소' 카테고리 장소");
  if (card === 'entry') {
    miss.push(...transportGaps(data.transports));
    if (!stays.length) miss.push('숙소');
  }
  if (card === 'stay' && !stays.length) miss.push('숙소 (일정 탭의 묵는 곳 또는 숙소 카테고리 장소)');
  return miss;
}

const legOf = (t) => (t ? {
  mode: t.mode, code: t.code || null,
  dep_name: t.dep_name || null, dep_date: t.dep_date || null, dep_time: t.dep_time ? String(t.dep_time).slice(0, 5) : null, dep_terminal: t.dep_terminal || null,
  arr_name: t.arr_name || null, arr_date: t.arr_date || null, arr_time: t.arr_time ? String(t.arr_time).slice(0, 5) : null, arr_terminal: t.arr_terminal || null,
} : null);

// 서버로 보낼 요청 (카드에 필요한 것만)
export function buildGuideRequest(card, data) {
  const { trip, places } = data;
  const base = { destination: trip.destination || trip.title, start: trip.start_date, end: trip.end_date || trip.start_date };
  const stays = tripStays(data);
  const stayRow = (s) => ({ name: s.place.name, local: s.place.local_name || null, zone: s.place.zone || null, from: s.from, to: s.to });
  if (card === 'weather') return { ...base, weather: weatherPoint(stays, places) };
  if (card === 'landmark') {
    return { ...base, landmarks: landmarks(data).map((p) => ({ name: p.name, local: p.local_name || null, zone: p.zone || null, sig: p.signature || null })) };
  }
  if (card === 'entry') {
    const out = data.transports.find((t) => t.direction === 'out');
    const back = data.transports.find((t) => t.direction === 'back');
    return { ...base, out: legOf(out), back: legOf(back), stays: [stays[0], stays[stays.length - 1]].filter(Boolean).map(stayRow) };
  }
  return { ...base, stays: stays.slice(0, 6).map(stayRow) };
}

// 요청에 넣은 장소 id (AI 가 쓴 "### 1. 이름" 번호와 같은 순서) → 제목을 그 장소에 연결
export function guideTargetIds(card, data) {
  if (card === 'landmark') return landmarks(data).map((p) => p.id);
  if (card === 'stay') return tripStays(data).slice(0, 6).map((s) => s.place.id);
  return [];
}

// 가이드 카드에 저장할 본문: AI 본문(번호 제목 → 장소 링크) + 맨 아래 출처 · 만든 날짜
export function guideBody(result, today, ids = []) {
  const src = (result.sources || []).slice(0, 6)
    .map((s) => `[${String(s.title || '출처').replace(/[[\]]/g, '')}](${s.uri})`).join(' · ');
  return `${numberedToLinks(String(result.body || '').trim(), ids)}\n\n---\n*AI 가 ${today} 에 만든 안내예요. 바뀔 수 있으니 중요한 건 다시 확인하세요.*${src ? `\n\n출처: ${src}` : ''}`.slice(0, 19000);
}
