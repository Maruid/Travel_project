// AI 일정 짜기 (3차): 요청 만들기 · 결과 검증 · 적용 · 되돌리기
//  - AI 에게는 장소를 번호로만 보여주고, 번호로만 고르게 함 (없는 장소를 만들 수 없음)
//  - 남길 일정(고정)은 F번호로 보여주고, AI 는 그 사이에 새 일정을 끼워 넣은 "하루 순서"를 돌려줌
//  - 결과는 앱이 다시 검증: 없는 번호·중복·고정 빠짐·영업시간 문제
import { hoursIssueAt } from './hours.js';
import { dayStays } from './route-plan.js';

export const DENSITY = {
  easy: { label: '여유', min: 3, max: 4 },
  normal: { label: '보통', min: 5, max: 6 },
  tight: { label: '빡빡', min: 7, max: 9 },
};
export const LIKE_MODES = {
  must: '찜한 곳은 꼭 넣기',
  prefer: '찜한 곳 우선',
  off: '찜 반영 안 함',
};
export const MAX_TEXT = 200;
export const MAX_PLACES = 150;
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const KIND_ICON = { food: 'fa-utensils', cafe: 'fa-mug-saucer', bar: 'fa-beer-mug-empty', spot: 'fa-camera', shop: 'fa-bag-shopping', lodging: 'fa-hotel', transit: 'fa-train-subway' };

// 찜 꼭 넣기인데 찜한 곳이 하루 밀도 × 날짜 수보다 많으면 미리 알려줌
export function tooManyLiked(likedCount, dayCount, density) {
  const cap = (DENSITY[density]?.max || 6) * dayCount;
  return likedCount > cap ? cap : 0;
}

export const weekdayOf = (dateStr) => new Date(`${dateStr}T12:00:00Z`).getUTCDay();
const pad = (n) => String(n).padStart(2, '0');
export const shortHM = (t) => (typeof t === 'string' && /^\d{1,2}:\d{2}/.test(t) ? t.slice(0, 5).padStart(5, '0') : null);

// 요일별 영업시간 한 줄: "화 11:00-22:00 · 수 휴무" (고른 날짜의 요일만)
export function hoursBrief(oh, weekdays) {
  const ps = Array.isArray(oh?.periods) ? oh.periods : [];
  if (!ps.length) return null;
  if (ps.length === 1 && ps[0]?.open && !ps[0]?.close) return '24시간';
  const out = [];
  for (const d of [...new Set(weekdays)].sort()) {
    if (Array.isArray(oh.closedDays) && oh.closedDays.includes(d)) { out.push(`${DAY_KO[d]} 휴무`); continue; }
    const today = ps.filter((p) => p?.open?.day === d && p.close);
    if (!today.length) { out.push(`${DAY_KO[d]} 휴무`); continue; }
    const spans = today.map((p) => `${pad(p.open.hour || 0)}:${pad(p.open.minute || 0)}-${pad(p.close.hour || 0)}:${pad(p.close.minute || 0)}`);
    out.push(`${DAY_KO[d]} ${spans.join(',')}`);
  }
  return out.join(' · ');
}

/**
 * 요청 만들기
 * @param o.dates       채울 날짜 ['YYYY-MM-DD']
 * @param o.mode        'keep'(남기고 채우기) | 'replace'(지우고 새로 짜기)
 * @param o.keepIds     replace 일 때 남길 일정 id (Set)
 * @param o.likes       Map(placeId → 찜한 사람 수)
 * @returns { body(서버로 보낼 것), ctx(검증용) }
 */
export function buildPlanRequest({ trip, places, items, dayHeaders = [], categoryOf, dates, mode = 'keep', keepIds = new Set(), density = 'normal', likeMode = 'prefer', likes = new Map(), text = '', start = '09:00', end = '21:00', skipVisited = false, cats = null }) {
  // 날짜별 숙소 (itinerary_days.stay_place_id, 비워둔 날은 앞 날이 이어짐)
  const live = new Set(places.map((p) => p.id));
  const stays = Object.fromEntries(dates.map((d) => [d, dayStays(dayHeaders, d, (id) => live.has(id))]));
  const stayIds = new Set(Object.values(stays).flatMap((s) => [s.start, s.end]).filter(Boolean));
  const dateSet = new Set(dates);
  const weekdays = dates.map(weekdayOf);
  // 장소: 찜 많은 순 → 안 간 곳 → 이름. 너무 많으면 앞에서부터
  // 후보: 고른 카테고리(cats, null 이면 전체) + 다녀온 곳 빼기. 기준점(숙소)은 출발점으로 항상 보냄, 찜 꼭 넣기면 찜한 곳도
  const liked = (p) => (likes.get(p.id) || 0) > 0;
  const pool = places.filter((p) => p.is_anchor || stayIds.has(p.id)
    || ((!cats || cats.has(p.category_id) || (likeMode === 'must' && liked(p)))
      && (!skipVisited || !p.visited_at || liked(p))));
  const sorted = [...pool].sort((a, b) => (likes.get(b.id) || 0) - (likes.get(a.id) || 0)
    || (a.visited_at ? 1 : 0) - (b.visited_at ? 1 : 0) || String(a.name).localeCompare(String(b.name), 'ko'));
  const picked = sorted.slice(0, MAX_PLACES);
  const placeIds = picked.map((p) => p.id);
  const indexOf = new Map(placeIds.map((id, i) => [id, i + 1]));

  // 다른 날(채우지 않는 날)에 이미 잡힌 장소 → 겹치지 않게 알려줌
  const elsewhere = new Set(items.filter((it) => it.place_id && !dateSet.has(it.day_date)).map((it) => it.place_id));

  const days = [];
  const fixedMap = {};   // date → [itemId] (F1 = 0번째)
  const removed = {};    // date → [itemId]
  for (const date of dates) {
    const dayItems = items.filter((it) => it.day_date === date);
    const keep = mode === 'keep' ? dayItems : dayItems.filter((it) => keepIds.has(it.id));
    removed[date] = mode === 'keep' ? [] : dayItems.filter((it) => !keepIds.has(it.id)).map((it) => it.id);
    fixedMap[date] = keep.map((it) => it.id);
    const header = dayHeaders.find((d) => d.day_date === date);
    days.push({
      date, weekday: DAY_KO[weekdayOf(date)], title: header?.title || null,
      stayStart: indexOf.get(stays[date].start) || null, stayEnd: indexOf.get(stays[date].end) || null,
      fixed: keep.map((it, i) => ({ f: i + 1, time: shortHM(it.start_time), title: it.title, place: indexOf.get(it.place_id) || null })),
    });
  }

  const body = {
    destination: trip.destination || trip.title || null,
    timezone: trip.timezone || null,
    density, likeMode, text: String(text || '').slice(0, MAX_TEXT),
    start: shortHM(start) || '09:00', end: shortHM(end) || '21:00',
    days,
    places: picked.map((p, i) => {
      const cat = categoryOf(p.category_id);
      return {
        i: i + 1, name: p.name, kind: cat?.kind || 'etc', cat: cat?.name || null, zone: p.zone || null,
        lat: p.lat != null ? Math.round(p.lat * 1e4) / 1e4 : null, lng: p.lng != null ? Math.round(p.lng * 1e4) / 1e4 : null,
        hours: hoursBrief(p.opening_hours, weekdays), likes: likes.get(p.id) || 0,
        anchor: !!p.is_anchor || stayIds.has(p.id) || undefined, visited: !!p.visited_at || undefined, elsewhere: elsewhere.has(p.id) || undefined,
        sig: p.signature ? String(p.signature).slice(0, 40) : undefined,
      };
    }),
  };
  return { body, ctx: { placeIds, fixedMap, removed, dates, likeMode, likes, stayIds } };
}

/**
 * AI 결과 검증 → 미리보기용 계획
 * raw: { days: [{ date, items: [{ f?: n, place?: n, time?: 'HH:MM', title?, note? }] }], comment? }
 * getPlace(id), getItem(id)
 */
export function validatePlan(raw, ctx, { getPlace, getItem, categoryOf = () => null } = {}) {
  const days = [];
  const used = new Set();       // 이번 계획에서 이미 쓴 장소
  let added = 0;
  const rawDays = Array.isArray(raw?.days) ? raw.days : [];
  for (const date of ctx.dates) {
    const rd = rawDays.find((d) => d?.date === date) || { items: [] };
    const fixedIds = ctx.fixedMap[date] || [];
    const fixedPlaces = new Set(fixedIds.map((id) => getItem(id)?.place_id).filter(Boolean));
    const seenFixed = new Set();
    const rows = [];
    const warnings = [];
    let looseCount = 0;
    for (const it of Array.isArray(rd.items) ? rd.items : []) {
      const f = Number(it?.f);
      if (Number.isInteger(f) && f >= 1 && f <= fixedIds.length) {
        if (seenFixed.has(f)) continue;
        seenFixed.add(f);
        rows.push({ kind: 'fixed', itemId: fixedIds[f - 1] });
        continue;
      }
      const time = shortHM(it?.time) && /^([01]\d|2[0-3]):[0-5]\d$/.test(shortHM(it.time)) ? shortHM(it.time) : null;
      const n = Number(it?.place);
      if (Number.isInteger(n) && n >= 1 && n <= ctx.placeIds.length) {
        const placeId = ctx.placeIds[n - 1];
        if (used.has(placeId) || fixedPlaces.has(placeId)) continue;   // 같은 곳 두 번은 빼기
        if (ctx.stayIds?.has(placeId)) continue;                          // 숙소 자체는 일정에 넣지 않음
        const p = getPlace(placeId);
        if (!p) continue;
        used.add(placeId);
        const issue = p.opening_hours ? hoursIssueAt(p.opening_hours, date, time) : null;
        rows.push({
          kind: 'new', placeId, time,
          title: clean(it.title, 100) || p.name,
          note: clean(it.note, 300),
          icon: KIND_ICON[categoryOf(p.category_id)?.kind] || 'fa-location-dot',
          issue,
        });
        added++;
        continue;
      }
      // 장소 없는 일정(휴식·이동 등)은 하루 2개까지, 제목이 있을 때만
      const title = clean(it?.title, 100);
      if (title && looseCount < 2) {
        looseCount++;
        rows.push({ kind: 'new', placeId: null, time, title, note: clean(it.note, 300), icon: 'fa-clock', issue: null });
        added++;
      }
    }
    // AI 가 빠뜨린 고정 일정은 시간 순서에 맞춰 다시 넣음
    fixedIds.forEach((id, i) => {
      if (seenFixed.has(i + 1)) return;
      const t = shortHM(getItem(id)?.start_time);
      const at = t ? rows.findIndex((r) => rowTime(r, getItem) && rowTime(r, getItem) > t) : -1;
      rows.splice(at < 0 ? rows.length : at, 0, { kind: 'fixed', itemId: id });
      warnings.push('AI 가 빠뜨린 남길 일정을 다시 넣었어요.');
    });
    // 시간 순서가 뒤집힌 곳 표시
    let last = null;
    for (const r of rows) {
      const t = rowTime(r, getItem);
      if (t && last && t < last) r.order = '앞 일정보다 이른 시간이에요';
      if (t) last = t;
    }
    days.push({ date, rows, removed: ctx.removed[date] || [], warnings: [...new Set(warnings)] });
  }
  const missingLiked = ctx.likeMode === 'must'
    ? ctx.placeIds.filter((id) => (ctx.likes.get(id) || 0) > 0 && !used.has(id)
      && !days.some((d) => d.rows.some((r) => r.kind === 'fixed' && getItem(r.itemId)?.place_id === id)))
    : [];
  return { days, added, missingLiked, comment: clean(raw?.comment, 300) };
}

const clean = (v, max) => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim().slice(0, max) : null);
const rowTime = (r, getItem) => (r.kind === 'fixed' ? shortHM(getItem(r.itemId)?.start_time) : r.time);

// 하루 요약 숫자 (적용 버튼 문구)
export function dayCounts(day) {
  return { add: day.rows.filter((r) => r.kind === 'new').length, remove: day.removed.length };
}

/**
 * 적용: 지울 일정 숨김 → 새 일정 추가 → 그날 순서(sort_order)를 계획 순서대로
 * @returns 되돌리기 기록 { batch, at, tripId, inserted, removed, dates }
 */
export function applyPlan(store, plan, dates, batch) {
  const at = new Date().toISOString();
  const inserted = [];
  const removed = [];
  for (const day of plan.days.filter((d) => dates.includes(d.date))) {
    for (const id of day.removed) {
      if (store.get('itinerary_items', id) && !store.get('itinerary_items', id).deleted_at) { store.remove('itinerary_items', id); removed.push(id); }
    }
    day.rows.forEach((r, i) => {
      const sort_order = (i + 1) * 10;
      if (r.kind === 'fixed') {
        if (store.get('itinerary_items', r.itemId)?.sort_order !== sort_order) store.update('itinerary_items', r.itemId, { sort_order });
        return;
      }
      const id = crypto.randomUUID();
      store.insert('itinerary_items', {
        id, day_date: day.date, start_time: r.time, title: r.title, description: r.note,
        icon: r.icon, place_id: r.placeId, sort_order, ai_plan: batch,
      });
      inserted.push(id);
    });
  }
  return { batch, at, tripId: store.tripId, inserted, removed, dates };
}

/**
 * 되돌리기: 넣은 일정은 숨기고, 지운 일정은 되살림
 * 그 사이 다른 사람이 고친 일정은 건드리지 않음
 */
export function undoPlan(store, rec) {
  const touchedByOther = (row) => row && row.updated_by && row.updated_by !== store.userId && String(row.updated_at) > rec.at;
  let skipped = 0; let done = 0;
  for (const id of rec.inserted) {
    const row = store.get('itinerary_items', id);
    if (!row || row.deleted_at) continue;
    if (touchedByOther(row)) { skipped++; continue; }
    store.remove('itinerary_items', id); done++;
  }
  for (const id of rec.removed) {
    const row = store.get('itinerary_items', id);
    if (!row || !row.deleted_at) continue;
    if (touchedByOther(row)) { skipped++; continue; }
    store.update('itinerary_items', id, { deleted_at: null }); done++;
  }
  return { done, skipped };
}

// 되돌리기 기록: 이 기기에만, 24시간
const UNDO_KEY = (tripId) => `ai-plan-undo:v1:${tripId}`;
const UNDO_MS = 24 * 3600 * 1000;
export function saveUndo(rec) {
  try { localStorage.setItem(UNDO_KEY(rec.tripId), JSON.stringify(rec)); } catch { /* 저장 못 해도 진행 */ }
}
export function loadUndo(tripId, now = Date.now()) {
  try {
    const rec = JSON.parse(localStorage.getItem(UNDO_KEY(tripId)) || 'null');
    if (!rec || now - Date.parse(rec.at) > UNDO_MS) return null;
    return rec;
  } catch { return null; }
}
export function clearUndo(tripId) {
  try { localStorage.removeItem(UNDO_KEY(tripId)); } catch { /* 무시 */ }
}
