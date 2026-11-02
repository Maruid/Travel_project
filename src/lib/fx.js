// 무료 환율 조회 (키 없음, 브라우저에서 바로 호출, 하루 단위 갱신)
//  1) fawazahmed0 exchange-api (jsDelivr CDN, 실패 시 공식 대체 주소)
//  2) ExchangeRate-API 무료판 open.er-api.com (사용 시 출처 표시 필요)
// 결과: { rate, date, source, attribution? }  rate = from 1단위가 to 몇
const cache = new Map();

async function getJson(url, ms = 4000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

async function fromFawaz(from, to) {
  const f = from.toLowerCase(); const t = to.toLowerCase();
  const urls = [
    `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${f}.json`,
    `https://latest.currency-api.pages.dev/v1/currencies/${f}.json`,
  ];
  for (const u of urls) {
    try {
      const j = await getJson(u);
      const rate = Number(j?.[f]?.[t]);
      if (rate > 0) return { rate, date: j.date || null, source: 'exchange-api' };
    } catch {}
  }
  return null;
}

async function fromErApi(from, to) {
  try {
    const j = await getJson(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`);
    const rate = Number(j?.rates?.[to.toUpperCase()]);
    if (j?.result === 'success' && rate > 0) {
      const d = j.time_last_update_unix ? new Date(j.time_last_update_unix * 1000).toISOString().slice(0, 10) : null;
      return { rate, date: d, source: 'ExchangeRate-API', attribution: 'https://www.exchangerate-api.com' };
    }
  } catch {}
  return null;
}

// 화면 표시·저장용: 유효숫자 4자리
export const roundRate = (r) => Number(Number(r).toPrecision(4));

export async function fetchRate(from, to) {
  if (!from || !to) throw new Error('통화를 골라주세요.');
  if (from === to) return { rate: 1, date: null, source: 'same' };
  const key = `${from}>${to}`;
  if (cache.has(key)) return cache.get(key);
  if (!navigator.onLine) throw new Error('오프라인이에요. 온라인일 때 다시 받을 수 있어요.');
  const r = (await fromFawaz(from, to)) || (await fromErApi(from, to));
  if (!r) throw new Error('환율을 가져오지 못했어요. 직접 입력해 주세요.');
  const out = { ...r, rate: roundRate(r.rate) };
  cache.set(key, out);
  return out;
}
