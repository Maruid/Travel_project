// 통화 표시: 설정·입력 화면은 "일본 - 엔 (JPY)", 바깥 화면은 코드(JPY) 그대로
//  - 통화 이름은 나라가 앞에 붙으므로 짧게 (달러류는 그냥 '달러')
export const CURRENCY_INFO = {
  KRW: ['대한민국', '원'],
  JPY: ['일본', '엔'],
  USD: ['미국', '달러'],
  EUR: ['유럽연합', '유로'],
  CNY: ['중국', '위안'],
  TWD: ['대만', '달러'],
  HKD: ['홍콩', '달러'],
  MOP: ['마카오', '파타카'],
  THB: ['태국', '바트'],
  VND: ['베트남', '동'],
  SGD: ['싱가포르', '달러'],
  PHP: ['필리핀', '페소'],
  MYR: ['말레이시아', '링깃'],
  IDR: ['인도네시아', '루피아'],
  GBP: ['영국', '파운드'],
  CHF: ['스위스', '프랑'],
  AUD: ['호주', '달러'],
  NZD: ['뉴질랜드', '달러'],
  CAD: ['캐나다', '달러'],
};
export const CURRENCIES = Object.keys(CURRENCY_INFO);

// 통화별 돈 감각: 기준 단위(환율 표시 "100엔 = 870원"), 자주 쓰는 지폐·동전(계산기 칩), 소수점(센트) 여부
//  - 표에 없는 통화는 환율로 자동 (moneyProfile)
export const CURRENCY_MONEY = {
  KRW: { base: 1000, bills: [1000, 5000, 10000, 50000], dec: false },
  JPY: { base: 100, bills: [100, 500, 1000, 5000, 10000], dec: false },
  USD: { base: 1, bills: [1, 5, 10, 20, 50, 100], dec: true },
  EUR: { base: 1, bills: [5, 10, 20, 50, 100], dec: true },
  CNY: { base: 1, bills: [10, 20, 50, 100], dec: true },
  TWD: { base: 100, bills: [50, 100, 500, 1000], dec: false },
  HKD: { base: 1, bills: [10, 20, 50, 100, 500], dec: true },
  MOP: { base: 1, bills: [10, 20, 50, 100, 500], dec: true },
  THB: { base: 100, bills: [20, 50, 100, 500, 1000], dec: false },
  VND: { base: 10000, bills: [10000, 20000, 50000, 100000, 200000, 500000], dec: false },
  SGD: { base: 1, bills: [2, 5, 10, 50, 100], dec: true },
  PHP: { base: 100, bills: [20, 50, 100, 500, 1000], dec: false },
  MYR: { base: 1, bills: [1, 5, 10, 20, 50, 100], dec: true },
  IDR: { base: 10000, bills: [5000, 10000, 20000, 50000, 100000], dec: false },
  GBP: { base: 1, bills: [5, 10, 20, 50], dec: true },
  CHF: { base: 1, bills: [10, 20, 50, 100], dec: true },
  AUD: { base: 1, bills: [5, 10, 20, 50, 100], dec: true },
  NZD: { base: 1, bills: [5, 10, 20, 50, 100], dec: true },
  CAD: { base: 1, bills: [5, 10, 20, 50, 100], dec: true },
};

// rate: 이 통화 1 = 내 통화 rate (표에 없는 통화의 기준 단위를 정할 때만 씀)
//  자동 규칙: 내 통화로 100 이상이 될 때까지 1, 10, 100 … / 칩은 기준 단위의 1·5·10·50·100배
export function moneyProfile(code, rate = 0) {
  const known = CURRENCY_MONEY[code];
  if (known) return { ...known, big: known.bills[known.bills.length - 1] >= 100000 };
  let base = 1;
  if (rate > 0) while (base * rate < 100 && base < 1e6) base *= 10;
  return { base, bills: [1, 5, 10, 50, 100].map((k) => k * base), dec: base === 1, big: base >= 1000 };
}

export const isCurrencyCode = (c) => typeof c === 'string' && /^[A-Z]{3}$/.test(c);

// 한국어 단위 (엔, 원, 달러 ...). 모르는 코드는 null
export const unitOf = (code) => CURRENCY_INFO[code]?.[1] ?? null;

export function currencyLabel(code) {
  const info = CURRENCY_INFO[code];
  return info ? `${info[0]} - ${info[1]} (${code})` : code;
}

// <option> 목록
//  - 지원 목록에 없어도 정상 코드(영문 3글자)면 맨 앞에 유지
//  - 잘린 값('J' 등)은 버리고 fallback 을 선택 (그대로 다시 저장되는 것 방지)
export function currencyOptions(selected, extra = [], fallback = null) {
  if (!isCurrencyCode(selected)) selected = isCurrencyCode(fallback) ? fallback : null;
  const keep = selected && !CURRENCY_INFO[selected] ? [selected] : [];
  const codes = [...new Set([...extra.filter(isCurrencyCode), ...keep, ...CURRENCIES])];
  return codes.map((c) => ({ code: c, label: currencyLabel(c), selected: c === selected }));
}
