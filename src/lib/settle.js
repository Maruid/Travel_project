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

// ---------------------------------------------------------------------
// 공금 지갑 (migration_018)
//   충전(charge): 지갑에 amount(현지 돈) 들어옴. shares {member: 금액} 이 넣은 사람, 없으면 그때 멤버 모두 같은 금액
//   인출(withdraw): from_wallet → wallet_id 로 옮김 (공금 카드 → 공금 현금)
//   지출: wallet_id 가 있으면 그 지갑에서 나감 (낸 사람 없음), 없으면 paid_by 개인 돈
// ---------------------------------------------------------------------
export function walletBalances(wallets, topups, expenses, toAmount) {
  const bal = new Map(wallets.map((w) => [w.id, 0]));
  const add = (id, v) => { if (id && bal.has(id)) bal.set(id, bal.get(id) + v); };
  for (const t of topups) {
    const a = Number(t.amount) || 0;
    if (t.kind === 'charge') add(t.wallet_id, a);
    else if (t.kind === 'withdraw') { add(t.from_wallet, -a); add(t.wallet_id, a); }
  }
  for (const e of expenses) if (e.wallet_id) add(e.wallet_id, -(toAmount(e) || 0));
  return bal;
}

// 충전 한 건을 누가 얼마 넣었나 → Map(member → 금액)
export function chargeShares(t, memberIds) {
  const out = new Map();
  const a = Number(t.amount) || 0;
  const s = t.shares && typeof t.shares === 'object' ? Object.entries(t.shares).filter(([, v]) => Number(v) > 0) : [];
  if (s.length) for (const [id, v] of s) out.set(id, Number(v));
  else if (memberIds.length) memberIds.forEach((id) => out.set(id, a / memberIds.length));
  return out;
}

// 사람별: 낸 돈(충전 + 개인 돈 지출) · 쓴 몫 · 들고 있는 공금 · 차액
//   차액 = 낸 돈 - 쓴 몫 - 들고 있는 공금  (합은 0 → settleTransfers 로 송금 목록)
//   지갑에 들고 있는 사람이 없으면 남은 공금은 모두가 같이 들고 있는 것으로 침
export function poolBalances({ expenses, topups = [], wallets = [], memberIds, toAmount }) {
  const paid = new Map(); const owed = new Map(); const held = new Map();
  const plus = (m, id, v) => m.set(id, (m.get(id) || 0) + v);
  for (const t of topups) {
    if (t.kind !== 'charge') continue;
    for (const [id, v] of chargeShares(t, memberIds)) plus(paid, id, v);
  }
  for (const e of expenses) {
    const amt = toAmount(e);
    if (!amt) continue;
    if (!e.wallet_id && e.paid_by) plus(paid, e.paid_by, amt);
    const split = e.split_with?.length ? e.split_with : memberIds;
    split.forEach((mid) => plus(owed, mid, amt / split.length));
  }
  const wb = walletBalances(wallets, topups, expenses, toAmount);
  for (const w of wallets) {
    const b = wb.get(w.id) || 0;
    if (!b) continue;
    if (w.holder) plus(held, w.holder, b);
    else memberIds.forEach((id) => plus(held, id, b / memberIds.length));
  }
  const ids = [...new Set([...memberIds, ...paid.keys(), ...owed.keys(), ...held.keys()])];
  return ids.map((id) => {
    const p = paid.get(id) || 0; const o = owed.get(id) || 0; const h = held.get(id) || 0;
    return { id, paid: p, owed: o, held: h, net: p - o - h };
  });
}

// 충전 기록으로 낸 실제 환율 (현지 1 = 원화 ?) — 원화를 적은 충전만
export function chargedRate(topups) {
  let local = 0; let home = 0;
  for (const t of topups) {
    if (t.kind === 'charge' && Number(t.home_amount) > 0 && Number(t.amount) > 0) { local += Number(t.amount); home += Number(t.home_amount); }
  }
  return local > 0 ? home / local : null;
}
