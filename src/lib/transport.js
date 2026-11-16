// =====================================================================
// 이동편 (migration_015 trip_transports) — 순수 함수 (node 테스트)
//   direction: out(가는 편) · back(오는 편) · other
//   mode: flight · train · ship · bus
// =====================================================================

export const MODES = {
  flight: { label: '항공', icon: 'fa-plane', place: '공항' },
  train: { label: '기차', icon: 'fa-train', place: '역' },
  ship: { label: '배', icon: 'fa-ship', place: '항구' },
  bus: { label: '버스', icon: 'fa-bus', place: '터미널' },
};
export const DIRECTIONS = { out: '가는 편', back: '오는 편', other: '이동' };

// 도착 뒤 일정을 시작할 수 있을 때까지 · 출발 전에 미리 가 있어야 하는 시간 (분)
//   항공: 입국 심사 · 짐 찾기 · 시내 이동 / 출국: 3시간 전 공항 도착 + 공항까지 이동
const AFTER_ARRIVE = { flight: 120, train: 30, ship: 60, bus: 30 };
const BEFORE_DEPART = { flight: 210, train: 45, ship: 90, bus: 40 };

const hm = (t) => (t ? String(t).slice(0, 5) : null);
const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})/.exec(t || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
const fromMin = (n) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;

export const modeOf = (t) => MODES[t?.mode] || MODES.flight;

// 그날 보일 이동편: 출발하거나 도착하는 날 (시각 순)
export function transportsOn(list, date) {
  return (list || []).filter((t) => t.dep_date === date || t.arr_date === date)
    .sort((a, b) => String(a.dep_date || '').localeCompare(String(b.dep_date || ''))
      || String(a.dep_time || '').localeCompare(String(b.dep_time || '')));
}

// "인천 ICN T2 09:10 → 간사이 KIX T1 11:05 (+1)"
export function routeText(t) {
  const side = (name, term, time) => [name, term ? (/^t?\d+$/i.test(term) ? `T${term.replace(/^t/i, '')}` : term) : null, hm(time)].filter(Boolean).join(' ');
  const plus = t.dep_date && t.arr_date && t.arr_date > t.dep_date
    ? Math.round((Date.parse(t.arr_date) - Date.parse(t.dep_date)) / 86400000) : 0;
  const a = side(t.dep_name, t.dep_terminal, t.dep_time) || '출발지';
  const b = side(t.arr_name, t.arr_terminal, t.arr_time) || '도착지';
  return `${a} → ${b}${plus > 0 ? ` (+${plus})` : ''}`;
}

export function titleText(t) {
  return [DIRECTIONS[t.direction] || DIRECTIONS.other, t.carrier, t.code].filter(Boolean).join(' · ');
}

// AI 일정 짜기: 그날 일정을 시작 · 끝낼 수 있는 시각 + 설명 한 줄
//   여행지에 도착하는 날(arr_date) → 도착 + 여유 이후 시작, 떠나는 날(dep_date, 오는 편) → 출발 - 여유 전에 끝
export function dayWindow(list, date) {
  let from = null; let until = null; const notes = [];
  for (const t of list || []) {
    const m = t.mode || 'flight';
    const label = `${modeOf(t).label}${t.code ? ` ${t.code}` : ''}`;
    if (t.direction !== 'back' && t.arr_date === date && toMin(t.arr_time) != null) {
      const s = Math.min(toMin(t.arr_time) + AFTER_ARRIVE[m], 23 * 60 + 59);
      if (from == null || s > toMin(from)) from = fromMin(s);
      notes.push(`${hm(t.arr_time)} ${t.arr_name || '도착지'} 도착(${label})`);
    }
    if (t.direction !== 'out' && t.dep_date === date && toMin(t.dep_time) != null) {
      const e = Math.max(toMin(t.dep_time) - BEFORE_DEPART[m], 0);
      if (until == null || e < toMin(until)) until = fromMin(e);
      notes.push(`${hm(t.dep_time)} ${t.dep_name || '출발지'} 출발(${label})`);
    }
  }
  return { from, until, note: notes.join(', ') || null };
}

// AI 가이드(입국 · 출국)에 필요한 정보가 다 있는지
export function transportGaps(list) {
  const out = (list || []).find((t) => t.direction === 'out');
  const back = (list || []).find((t) => t.direction === 'back');
  const miss = [];
  if (!out) miss.push('가는 편');
  else if (!out.arr_name || !out.arr_time) miss.push('가는 편 도착지 · 시각');
  if (!back) miss.push('오는 편');
  else if (!back.dep_name || !back.dep_time) miss.push('오는 편 출발지 · 시각');
  return miss;
}
