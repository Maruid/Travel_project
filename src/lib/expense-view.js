// =====================================================================
// 가계부 지출 목록: 필터 · 정렬 · 묶음 (순수 함수, node 테스트)
//   sort: 'date' 날짜별(그날 합계) · 'amount' 큰 금액부터 · 'cat' 카테고리별(합계 · 비율)
//   filter: { method: [], payer: [], share: [], cat: [] }  — 비어 있으면 그 조건은 없음
//     share: 그 사람 몫이 들어간 지출 (나눌 사람을 안 고른 지출은 전원 몫)
// =====================================================================
export const EXPENSE_CATS = ['음식', '교통', '쇼핑', '카페', '관광', '숙박', '기타'];
export const CAT_ICON = {
  음식: 'fa-utensils', 교통: 'fa-train-subway', 쇼핑: 'fa-bag-shopping', 카페: 'fa-mug-hot',
  관광: 'fa-landmark', 숙박: 'fa-bed', 기타: 'fa-receipt',
};
export const CAT_COLOR = {
  음식: '#fb923c', 교통: '#38bdf8', 쇼핑: '#f472b6', 카페: '#d6a46b', 관광: '#c084fc', 숙박: '#34d399', 기타: '#94a3b8',
};
export const EMPTY_EXPENSE_FILTER = { method: [], payer: [], share: [], cat: [] };

export function parseExpenseFilter(s) {
  try {
    const o = JSON.parse(s || '{}');
    const arr = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 30) : []);
    return { method: arr(o.method), payer: arr(o.payer), share: arr(o.share), cat: arr(o.cat) };
  } catch { return { ...EMPTY_EXPENSE_FILTER }; }
}
export const expenseFilterCount = (f) => f.method.length + f.payer.length + f.share.length + f.cat.length;

export const sharesOf = (e, memberIds) => (e.split_with?.length ? e.split_with : memberIds);

// "어디서 냈나" 필터 값: 공금 지갑이면 w:<id>, 개인 돈이면 결제 수단(cash · card · other)
export const sourceKey = (e) => (e.wallet_id ? `w:${e.wallet_id}` : e.method || 'other');

export function filterExpenses(list, f, memberIds) {
  return list.filter((e) => (!f.method.length || f.method.includes(sourceKey(e)))
    && (!f.payer.length || f.payer.includes(e.paid_by))
    && (!f.share.length || sharesOf(e, memberIds).some((id) => f.share.includes(id)))
    && (!f.cat.length || f.cat.includes(e.category || '기타')));
}

const when = (e) => `${e.spent_date || ''} ${e.spent_time || ''}`;

// → [{ key, total, pct, rows }]
export function groupExpenses(list, sort, toLocal) {
  const amt = (e) => toLocal(e) || 0;
  if (sort === 'amount') {
    const rows = [...list].sort((a, b) => amt(b) - amt(a) || when(b).localeCompare(when(a)));
    return rows.length ? [{ key: null, total: rows.reduce((s, e) => s + amt(e), 0), pct: null, rows }] : [];
  }
  const keyOf = sort === 'cat' ? (e) => e.category || '기타' : (e) => e.spent_date || '';
  const map = new Map();
  for (const e of list) {
    const k = keyOf(e);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(e);
  }
  const all = list.reduce((s, e) => s + amt(e), 0);
  const groups = [...map].map(([key, rows]) => {
    const total = rows.reduce((s, e) => s + amt(e), 0);
    rows.sort(sort === 'cat'
      ? (a, b) => amt(b) - amt(a) || when(b).localeCompare(when(a))
      : (a, b) => when(b).localeCompare(when(a)));
    return { key, total, pct: all > 0 ? total / all : 0, rows };
  });
  return groups.sort(sort === 'cat' ? (a, b) => b.total - a.total : (a, b) => String(b.key).localeCompare(String(a.key)));
}
