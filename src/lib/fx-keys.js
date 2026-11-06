// 환율 계산기 키패드 규칙 (화면 코드와 분리해 테스트)

const MAX_DIGITS = 12;

// 칩 내역 → "1,280 + 5,000 × 2 + 1,000" (같은 금액은 묶음)
//  parts: [{ v, typed? }]  typed = 칩을 누르기 전에 직접 친 숫자
export function partsText(parts) {
  const groups = [];
  for (const p of parts) {
    const g = !p.typed && groups.find((x) => x.v === p.v && !x.typed);
    if (g) g.n++; else groups.push({ v: p.v, n: 1, typed: !!p.typed });
  }
  return groups.map((g) => (g.n > 1 ? `${fmtNum(g.v)} × ${g.n}` : fmtNum(g.v))).join(' + ');
}
export const fmtNum = (v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });

// 키 입력 → 새 문자열 (숫자 문자열, 소수점 최대 2자리)
export function pressKey(cur, key, { dec = false } = {}) {
  let s = cur === '0' ? '' : cur;
  if (key === 'back') return s.slice(0, -1);
  if (key === '.') {
    if (!dec || s.includes('.')) return cur;
    return (s || '0') + '.';
  }
  if (!/^0+$/.test(key) && !/^\d$/.test(key)) return cur;
  if (!s && /^0+$/.test(key)) return '0';
  const [i, f] = (s + key).split('.');
  if (f != null && f.length > 2) return cur;
  if (i.length > MAX_DIGITS) return cur;
  return s + key;
}

