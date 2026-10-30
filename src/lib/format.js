// 거리 (Haversine)
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2
    + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function walkInfo(from, to) {
  if (!from || to?.lat == null || to?.lng == null) return { text: '', min: Infinity, meters: Infinity };
  const meters = Math.round(distanceKm(from, to) * 1000);
  const min = Math.max(1, Math.round(meters / 75));
  const text = meters < 1000 ? `도보 ${min}분 (${meters}m)` : `약 ${(meters / 1000).toFixed(1)}km`;
  return { text, min, meters };
}

// 통화
const fmtCache = new Map();
export function money(amount, currency) {
  const n = Number(amount) || 0;
  if (!currency) return n.toLocaleString();
  const key = currency;
  if (!fmtCache.has(key)) {
    try {
      fmtCache.set(key, new Intl.NumberFormat('ko-KR', { style: 'currency', currency, maximumFractionDigits: 0 }));
    } catch {
      fmtCache.set(key, { format: (v) => `${v.toLocaleString()} ${currency}` });
    }
  }
  return fmtCache.get(key).format(n);
}

export function priceRange(p) {
  if (p.price_min == null && p.price_max == null) return '';
  const c = p.price_currency;
  if (p.price_min != null && p.price_max != null && Number(p.price_min) !== Number(p.price_max)) {
    return `${money(p.price_min, c)}~${Number(p.price_max).toLocaleString()}`;
  }
  return money(p.price_min ?? p.price_max, c);
}

// 날짜
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export function dayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${d.getMonth() + 1}/${d.getDate()} (${WEEK[d.getDay()]})`;
}

export function dateRange(start, end) {
  if (!start) return [];
  const out = [];
  const d = new Date(`${start}T00:00:00`);
  const last = new Date(`${end || start}T00:00:00`);
  while (d <= last && out.length < 60) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function todayIn(timezone) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export const shortTime = (t) => (t ? t.slice(0, 5) : '');

export const CURRENCIES = ['KRW', 'JPY', 'USD', 'EUR', 'CNY', 'TWD', 'HKD', 'THB', 'VND', 'SGD', 'PHP', 'GBP', 'AUD', 'CAD'];
