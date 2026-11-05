// 정산: 멤버별 (낸 돈 - 써야 할 몫) → 최소 송금 목록
//  큰 빚진 사람 → 큰 받을 사람 순으로 짝지음 (대부분 n-1번 이하)

const ZERO_DECIMAL = new Set(['KRW', 'JPY', 'VND', 'IDR', 'TWD', 'HUF', 'CLP', 'ISK']);

export function roundFor(currency) {
  const d = ZERO_DECIMAL.has(currency) ? 0 : 2;
  const f = 10 ** d;
  return (v) => Math.round(v * f) / f;
}

// nets: [{ id, net }]  net > 0 받을 돈, < 0 보낼 돈
export function settleTransfers(nets, currency) {
  const round = roundFor(currency);
  const eps = ZERO_DECIMAL.has(currency) ? 1 : 0.01;
  const pay = nets.filter((x) => x.net < -eps / 2).map((x) => ({ id: x.id, left: -x.net })).sort((a, b) => b.left - a.left);
  const get = nets.filter((x) => x.net > eps / 2).map((x) => ({ id: x.id, left: x.net })).sort((a, b) => b.left - a.left);
  const out = [];
  let i = 0; let j = 0;
  while (i < pay.length && j < get.length) {
    const amt = Math.min(pay[i].left, get[j].left);
    const r = round(amt);
    if (r >= eps) out.push({ from: pay[i].id, to: get[j].id, amount: r });
    pay[i].left -= amt; get[j].left -= amt;
    if (pay[i].left < eps / 2) i++;
    if (get[j].left < eps / 2) j++;
  }
  return out;
}

// 지출 목록 → 멤버별 낸 돈 · 몫 · 차액
//  split_with 가 없으면 지금 멤버 전원 균등. toAmount(e) 는 기준 통화로 환산한 금액
export function balances(expenses, memberIds, toAmount) {
  const paid = new Map(); const owed = new Map();
  for (const e of expenses) {
    const amt = toAmount(e);
    if (!amt) continue;
    if (e.paid_by) paid.set(e.paid_by, (paid.get(e.paid_by) || 0) + amt);
    const split = e.split_with?.length ? e.split_with : memberIds;
    if (!split.length) continue;
    split.forEach((mid) => owed.set(mid, (owed.get(mid) || 0) + amt / split.length));
  }
  const ids = [...new Set([...memberIds, ...paid.keys(), ...owed.keys()])];
  return ids.map((id) => ({ id, paid: paid.get(id) || 0, owed: owed.get(id) || 0, net: (paid.get(id) || 0) - (owed.get(id) || 0) }));
}
