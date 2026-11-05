// 구글 영업시간(periods) 해석 — 여행지 시간대 기준
//  periods: [{ open: { day, hour, minute }, close: { day, hour, minute } }]  (day: 0=일요일)
//  24시간 영업: close 없는 period 하나
const WEEK = 7 * 1440;
const DAY_KO = ['일', '월', '화', '수', '목', '금', '토'];
const hhmm = (m) => `${String(Math.floor((m % 1440) / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

function intervals(oh) {
  const ps = Array.isArray(oh?.periods) ? oh.periods : [];
  if (!ps.length) return null;
  if (ps.length === 1 && ps[0]?.open && !ps[0]?.close) return 'always';
  const out = [];
  for (const p of ps) {
    if (!p?.open || !p?.close) continue;
    const o = p.open.day * 1440 + (p.open.hour || 0) * 60 + (p.open.minute || 0);
    let c = p.close.day * 1440 + (p.close.hour || 0) * 60 + (p.close.minute || 0);
    if (c <= o) c += WEEK;   // 자정·일요일을 넘기는 영업
    out.push([o, c]);
  }
  return out.length ? out : null;
}

// 지금 여행지의 요일·시각 (분 단위, 주 기준)
export function weekMinuteIn(tz, now = new Date()) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
      timeZone: tz, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(now).map((x) => [x.type, x.value]));
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
    return day * 1440 + Number(parts.hour) * 60 + Number(parts.minute);
  } catch {
    return now.getDay() * 1440 + now.getHours() * 60 + now.getMinutes();
  }
}

// 주 기준 분이 영업 구간 안인지 → 남은 분(마감까지) 또는 -1
function minutesToClose(iv, t) {
  for (const [o, c] of iv) {
    for (const x of [t, t + WEEK]) if (x >= o && x < c) return c - x;
  }
  return -1;
}

const closedOn = (oh, day) => Array.isArray(oh?.closedDays) && oh.closedDays.includes(day);

/**
 * 지금 영업 상태
 * @returns {null | { state: 'open'|'closing'|'before'|'closed_now'|'closed_today', text }}
 */
export function hoursStatus(oh, tz, now = new Date(), { closingSoon = 60 } = {}) {
  const iv = intervals(oh);
  if (!iv) return null;
  if (iv === 'always') return { state: 'open', text: '24시간 영업' };
  const t = weekMinuteIn(tz, now);
  const left = minutesToClose(iv, t);
  if (left >= 0) {
    const closeAt = hhmm(t + left);
    return left <= closingSoon ? { state: 'closing', text: `곧 마감 ${closeAt}` } : { state: 'open', text: `영업 중 · ${closeAt} 마감` };
  }
  const day = Math.floor(t / 1440);
  if (closedOn(oh, day)) return { state: 'closed_today', text: '오늘 휴무' };
  // 오늘 안에 다시 여는지
  const dayEnd = (day + 1) * 1440;
  const next = iv.map(([o]) => o).filter((o) => o > t && o < dayEnd).sort((a, b) => a - b)[0];
  if (next != null) return { state: 'before', text: `${hhmm(next)} 오픈` };
  return { state: 'closed_now', text: '영업 종료' };
}

/**
 * 특정 날짜·시각에 영업하는지 (일정 확인용)
 * @param dateStr 'YYYY-MM-DD' (여행지 날짜), timeStr 'HH:MM' 또는 null
 * @returns {null | string}  문제가 있으면 안내 문구
 */
export function hoursIssueAt(oh, dateStr, timeStr) {
  const iv = intervals(oh);
  if (!iv || iv === 'always' || !dateStr) return null;
  const day = new Date(`${dateStr}T12:00:00Z`).getUTCDay();
  if (closedOn(oh, day)) return `${DAY_KO[day]}요일 휴무예요`;
  if (!timeStr) return null;
  const [h, m] = timeStr.split(':').map(Number);
  if (!Number.isFinite(h)) return null;
  const t = day * 1440 + h * 60 + (m || 0);
  if (minutesToClose(iv, t) >= 0) return null;
  const desc = Array.isArray(oh.weekday) ? oh.weekday[(day + 6) % 7] : null;   // weekday 는 월요일부터
  return `이 시간엔 영업하지 않아요${desc ? ` (${desc})` : ''}`;
}
