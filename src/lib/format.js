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

// 통화: "93,000엔", "809,100원" 처럼 한국어 단위로 표시 (모르는 코드는 "12.5 XYZ")
import { CURRENCY_INFO, isCurrencyCode, unitOf } from './currency.js';
const ZERO_DECIMAL = new Set(['KRW', 'JPY', 'VND', 'IDR', 'TWD']);
const fmt0 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 2 });
const num = (v, c) => (ZERO_DECIMAL.has(c) ? fmt0 : fmt2).format(Number(v) || 0);

export function money(amount, currency) {
  if (!currency) return num(amount);
  const u = unitOf(currency);
  return u ? `${num(amount, currency)}${u}` : `${num(amount, currency)} ${currency}`;
}

// 대략 금액: 원화는 "약 1.2만원" / "약 9,000원", 그 외는 "약 12달러"
function approxNum(v, c) {
  const n = Number(v) || 0;
  if (c === 'KRW') {
    if (n >= 10000) return { text: (Math.round(n / 1000) / 10).toLocaleString('ko-KR'), unit: '만원' };
    return { text: fmt0.format(Math.round(n / 100) * 100), unit: '원' };
  }
  return { text: num(n, c), unit: unitOf(c) ?? ` ${c}` };
}
export function approxMoney(v, c) {
  const a = approxNum(v, c);
  return `약 ${a.text}${a.unit}`;
}
export function approxRange(min, max, c) {
  if (min == null || max == null || Number(min) === Number(max)) return approxMoney(min ?? max, c);
  const a = approxNum(min, c); const b = approxNum(max, c);
  return a.unit === b.unit ? `약 ${a.text}~${b.text}${b.unit}` : `약 ${a.text}${a.unit}~${b.text}${b.unit}`;
}

// 장소 가격: "7,000~12,000엔"
export function priceRange(p) {
  if (p.price_min == null && p.price_max == null) return '';
  const c = isCurrencyCode(p.price_currency) ? p.price_currency : null;
  if (p.price_min != null && p.price_max != null && Number(p.price_min) !== Number(p.price_max)) {
    return `${num(p.price_min, c)}~${money(p.price_max, c)}`;
  }
  return money(p.price_min ?? p.price_max, c);
}

// 장소 가격을 내 통화로 환산 ("약 6.1~10.4만원"). 현지 통화 가격일 때만
export function priceInHome(p, budget) {
  const rate = Number(budget?.rate);
  if (!budget || !(rate > 0) || p.price_currency !== budget.local_currency || budget.home_currency === budget.local_currency) return '';
  if (p.price_min == null && p.price_max == null) return '';
  const lo = p.price_min != null ? Number(p.price_min) * rate : null;
  const hi = p.price_max != null ? Number(p.price_max) * rate : null;
  return approxRange(lo, hi, budget.home_currency);
}

// 환율 표시: 환산 결과가 100 이상이 되는 단위로 ("100엔 = 870원", "1달러 = 1,400원")
export function rateText(budget) {
  const L = budget?.local_currency; const H = budget?.home_currency; const rate = Number(budget?.rate) || 0;
  if (!L || !H || !(rate > 0)) return '환율 미설정';
  let base = 1;
  while (base * rate < 100 && base < 1e6) base *= 10;
  return `${money(base, L)} = ${money(base * rate, H)}`;
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

export { CURRENCIES } from './currency.js';
export { CURRENCY_INFO };
