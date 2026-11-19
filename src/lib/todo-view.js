// 할 일 탭 보기 규칙 (순수 함수)
//  - 분류 · 담당 · 완료 숨기기 거르기, 안 한 것 먼저(같은 상태 안에서는 sort_order)
//  - 분류별 개수, 끌어서 옮긴 자리의 sort_order, 메모 속 링크 나누기, 준비물 기본 목록

export const KINDS = { todo: '🎯 할 것', place: '📍 갈 곳', shop: '🛍️ 살 것', pack: '🧳 챙길 것' };

const byOrder = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
  || String(a.created_at || '').localeCompare(String(b.created_at || ''));

// rows: store.list('todos') · opts: { kind: 'all'|종류, hideDone, mine: 내 멤버 id 또는 null }
export function filterTodos(rows, { kind = 'all', hideDone = false, mine = null } = {}) {
  const base = rows.filter((t) => (kind === 'all' || t.kind === kind) && (!mine || t.assignee === mine));
  const open = base.filter((t) => !t.done).sort(byOrder);
  const done = base.filter((t) => t.done).sort(byOrder);
  return { open, done, shown: hideDone ? open : [...open, ...done], hiddenDone: hideDone ? done.length : 0 };
}

// 분류별 { done, total } (담당 필터는 반영, 분류 필터는 무시)
export function kindCounts(rows, { mine = null } = {}) {
  const out = { all: { done: 0, total: 0 } };
  for (const k of Object.keys(KINDS)) out[k] = { done: 0, total: 0 };
  for (const t of rows) {
    if (mine && t.assignee !== mine) continue;
    for (const k of ['all', t.kind]) {
      if (!out[k]) continue;
      out[k].total++;
      if (t.done) out[k].done++;
    }
  }
  return out;
}

// 끌어서 옮기기: list(옮기기 전 보이는 순서)에서 from 번째를 to 번째 자리로 → 그 항목의 새 sort_order
//  옆 항목 사이 가운데 값. 맨 앞/뒤면 이웃에서 10 빼거나 더함. 자리가 안 바뀌면 null
export function movedSortOrder(list, from, to) {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return null;
  const rest = list.filter((_, i) => i !== from);
  const before = rest[to - 1];
  const after = rest[to];
  const o = (r) => r.sort_order ?? 0;
  if (before && after) {
    if (o(before) === o(after)) return o(before);   // 같은 값이면 정렬은 만든 시각에 맡김
    return (o(before) + o(after)) / 2;
  }
  if (before) return o(before) + 10;
  if (after) return o(after) - 10;
  return null;
}

// 메모 글 → [{ text } | { url }] (https 링크만 링크로)
export function linkParts(text) {
  const s = String(text ?? '');
  const out = [];
  const re = /https:\/\/[^\s<>"']+/gi;
  let last = 0;
  let m;
  while ((m = re.exec(s))) {
    let url = m[0];
    // 문장 끝 기호는 링크에서 뺌
    const trail = /[).,!?。、]+$/.exec(url);
    if (trail) url = url.slice(0, -trail[0].length);
    if (m.index > last) out.push({ text: s.slice(last, m.index) });
    out.push({ url });
    last = m.index + url.length;
    re.lastIndex = last;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out;
}

// 메모가 한 줄에 다 안 보일 만큼 긴지 (펼치기 버튼)
export const noteIsLong = (note) => !!note && (note.length > 36 || /\n/.test(note));

// 준비물 기본 목록 (해외여행 공통)
export const PACK_TEMPLATE = [
  { title: '여권 (유효기간 6개월 이상)', group: '서류' },
  { title: '여권 사본 · 증명사진', group: '서류' },
  { title: '항공권 e-티켓', group: '서류' },
  { title: '숙소 예약 확인서', group: '서류' },
  { title: '여행자 보험 가입', group: '서류' },
  { title: '현지 돈 환전 · 트래블카드 충전', group: '돈' },
  { title: '해외 결제 되는 카드', group: '돈' },
  { title: '유심 · eSIM · 로밍', group: '전자기기' },
  { title: '휴대폰 충전기 · 케이블', group: '전자기기' },
  { title: '보조배터리 (기내 휴대)', group: '전자기기' },
  { title: '멀티 어댑터 (전압 · 플러그 확인)', group: '전자기기' },
  { title: '상비약', group: '생활' },
  { title: '세면도구 · 화장품', group: '생활' },
  { title: '옷 · 잠옷 · 속옷', group: '생활' },
  { title: '우산 · 우비', group: '생활' },
];

const norm = (s) => String(s || '').replace(/[\s·()]/g, '').toLowerCase();

// 기본 목록 중 이미 있는 항목(제목이 같으면) 표시
export function packTemplateState(rows) {
  const have = new Set(rows.map((t) => norm(t.title)));
  return PACK_TEMPLATE.map((x) => ({ ...x, exists: have.has(norm(x.title)) }));
}

// 수정 창 값 → 바뀐 칸만 (새 칸은 값이 있을 때만 보내서 migration_019 전에도 저장되게)
export function todoPatch(cur, v) {
  const n = (x) => (x == null || x === '' ? null : x);
  const out = {};
  for (const k of ['kind', 'title', 'note', 'place_id', 'day_date', 'assignee']) {
    if (n(v[k]) !== n(cur[k])) out[k] = n(v[k]);
  }
  return out;
}
