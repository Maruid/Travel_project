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
