import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlanRequest, validatePlan, hoursBrief, applyPlan, undoPlan, dayCounts } from '../src/lib/ai-plan.js';

const cats = { c1: { kind: 'food', name: '라멘' }, c2: { kind: 'spot', name: '명소' } };
// 화요일 휴무, 그 외 11~22
const oh = { periods: [0, 1, 3, 4, 5, 6].map((d) => ({ open: { day: d, hour: 11, minute: 0 }, close: { day: d, hour: 22, minute: 0 } })), closedDays: [2] };
const places = [
  { id: 'pa', name: '이치란', category_id: 'c1', lat: 34.66871, lng: 135.50132, opening_hours: oh },
  { id: 'pb', name: '호젠지', category_id: 'c2', lat: 34.667, lng: 135.502 },
  { id: 'pc', name: '쿠로몬', category_id: 'c2', lat: 34.665, lng: 135.506, visited_at: '2026-11-01' },
  { id: 'ph', name: '호텔', category_id: 'c2', lat: 34.66, lng: 135.5, is_anchor: true },
];
const items = [
  { id: 'i1', day_date: '2026-11-10', start_time: '09:00:00', title: '체크아웃', place_id: null },
  { id: 'i2', day_date: '2026-11-10', start_time: '12:00:00', title: '점심', place_id: 'pb' },
  { id: 'i3', day_date: '2026-11-11', start_time: '10:00:00', title: 'USJ', place_id: null },
];
const get = (t) => (id) => (t === 'p' ? places : items).find((x) => x.id === id);
const base = { trip: { destination: '오사카', timezone: 'Asia/Tokyo' }, places, items, categoryOf: (id) => cats[id] };

test('영업시간 한 줄: 고른 요일만', () => {
  assert.equal(hoursBrief(oh, [2, 3]), '화 휴무 · 수 11:00-22:00');
  assert.equal(hoursBrief({ periods: [{ open: { day: 0, hour: 0 } }] }, [1]), '24시간');
  assert.equal(hoursBrief(null, [1]), null);
});

test('요청: 찜 많은 순 번호, 남길 일정 F번호, 지우고 새로 짜기면 남길 것만', () => {
  const likes = new Map([['pb', 2], ['pa', 1]]);
  const { body, ctx } = buildPlanRequest({ ...base, dates: ['2026-11-10'], mode: 'replace', keepIds: new Set(['i1']), likes });
  assert.deepEqual(ctx.placeIds.slice(0, 2), ['pb', 'pa']);
  assert.equal(body.places[0].likes, 2);
  assert.equal(body.days[0].weekday, '화');
  assert.deepEqual(body.days[0].fixed, [{ f: 1, time: '09:00', title: '체크아웃', place: null }]);
  assert.deepEqual(ctx.removed['2026-11-10'], ['i2']);
  assert.equal(body.places.find((p) => p.name === '이치란').hours, '화 휴무');
  assert.equal(body.places.find((p) => p.name === '쿠로몬').visited, true);
  const keep = buildPlanRequest({ ...base, dates: ['2026-11-10'], mode: 'keep' });
  assert.equal(keep.body.days[0].fixed.length, 2);
  assert.equal(keep.body.places.find((p) => p.name === '호젠지').elsewhere, undefined);
});

test('검증: 없는 번호·중복·고정 장소 겹침 제거, 빠진 고정 다시 넣기, 휴무 경고', () => {
  const { ctx } = buildPlanRequest({ ...base, dates: ['2026-11-10'], mode: 'keep', likes: new Map([['pa', 1]]), likeMode: 'must' });
  const n = (id) => ctx.placeIds.indexOf(id) + 1;
  const raw = { days: [{ date: '2026-11-10', items: [
    { place: n('pa'), time: '11:00', note: '줄 서기 전' },   // 화요일 휴무 → 경고
    { f: 2 },                                              // 점심(호젠지)
    { place: n('pb'), time: '13:00' },                     // 고정 일정 장소와 같음 → 제거
    { place: 99, time: '14:00' },                          // 없는 번호 → 제거
    { place: n('pa'), time: '15:00' },                     // 중복 → 제거
    { title: '호텔 휴식', time: '16:00' },
    { title: '산책', time: '17:00' }, { title: '야경', time: '19:00' },   // 장소 없는 일정 3번째 → 제거
  ] }, { date: '2099-01-01', items: [{ place: 1 }] }] };
  const plan = validatePlan(raw, ctx, { getPlace: get('p'), getItem: get('i'), categoryOf: (id) => cats[id] });
  const d = plan.days[0];
  assert.deepEqual(d.rows.map((r) => r.kind === 'fixed' ? `F:${r.itemId}` : (r.placeId || r.title)),
    ['F:i1', 'pa', 'F:i2', '호텔 휴식', '산책']);
  assert.equal(d.rows[1].issue, '화요일 휴무예요');
  assert.equal(d.rows[1].icon, 'fa-utensils');
  assert.equal(d.rows[1].title, '이치란');
  assert.ok(d.warnings.length === 1);
  assert.deepEqual(plan.missingLiked, []);
  assert.deepEqual(dayCounts(d), { add: 3, remove: 0 });
});

test('찜 필수인데 빠진 곳 알려주기', () => {
  const { ctx } = buildPlanRequest({ ...base, dates: ['2026-11-11'], likes: new Map([['pa', 2]]), likeMode: 'must' });
  const plan = validatePlan({ days: [{ date: '2026-11-11', items: [{ f: 1 }, { place: ctx.placeIds.indexOf('pc') + 1, time: '15:00' }] }] }, ctx, { getPlace: get('p'), getItem: get('i') });
  assert.deepEqual(plan.missingLiked, ['pa']);
});

test('적용 → 되돌리기 (다른 사람이 고친 것은 그대로)', () => {
  const rows = new Map(items.map((x) => [x.id, { ...x }]));
  const store = {
    tripId: 't', userId: 'me',
    get: (t, id) => rows.get(id),
    insert: (t, v) => rows.set(v.id, { ...v }),
    update: (t, id, v) => Object.assign(rows.get(id), v),
    remove: (t, id) => Object.assign(rows.get(id), { deleted_at: 'now' }),
  };
  const { ctx } = buildPlanRequest({ ...base, items: [...rows.values()], dates: ['2026-11-10'], mode: 'replace', keepIds: new Set(['i1']) });
  const plan = validatePlan({ days: [{ date: '2026-11-10', items: [{ f: 1 }, { place: 1, time: '10:00' }, { place: 2, time: '12:00' }] }] }, ctx, { getPlace: get('p'), getItem: (id) => rows.get(id) });
  const rec = applyPlan(store, plan, ['2026-11-10'], 'b1');
  assert.equal(rec.inserted.length, 2);
  assert.deepEqual(rec.removed, ['i2']);
  assert.equal(rows.get('i2').deleted_at, 'now');
  assert.equal(rows.get(rec.inserted[0]).ai_plan, 'b1');
  assert.equal(rows.get(rec.inserted[0]).sort_order, 20);
  // 다른 사람이 새 일정 하나를 고침
  Object.assign(rows.get(rec.inserted[1]), { updated_by: 'other', updated_at: '2999-01-01' });
  const r = undoPlan(store, rec);
  assert.deepEqual(r, { done: 2, skipped: 1 });
  assert.equal(rows.get('i2').deleted_at, null);
  assert.equal(rows.get(rec.inserted[0]).deleted_at, 'now');
  assert.equal(rows.get(rec.inserted[1]).deleted_at, undefined);
});

test('시작·끝 시간, 다녀온 곳 빼기(찜은 남김), 찜 너무 많음', async () => {
  const { tooManyLiked } = await import('../src/lib/ai-plan.js');
  const { body } = buildPlanRequest({ ...base, dates: ['2026-11-10'], skipVisited: true, start: '10:00', end: '20:30' });
  assert.equal(body.start, '10:00'); assert.equal(body.end, '20:30');
  assert.equal(body.places.some((p) => p.name === '쿠로몬'), false);
  const b2 = buildPlanRequest({ ...base, dates: ['2026-11-10'], skipVisited: true, likes: new Map([['pc', 1]]) }).body;
  assert.equal(b2.places.some((p) => p.name === '쿠로몬'), true);
  assert.equal(tooManyLiked(13, 2, 'normal'), 12);
  assert.equal(tooManyLiked(12, 2, 'normal'), 0);
});

test('후보 카테고리: 고른 것만 + 기준점은 항상 + 찜 꼭 넣기면 찜한 곳 포함', () => {
  const { body } = buildPlanRequest({ ...base, dates: ['2026-11-10'], cats: new Set(['c1']) });
  assert.deepEqual(body.places.map((p) => p.name).sort(), ['이치란', '호텔']);
  const must = buildPlanRequest({ ...base, dates: ['2026-11-10'], cats: new Set(['c1']), likeMode: 'must', likes: new Map([['pb', 1]]) }).body;
  assert.ok(must.places.some((p) => p.name === '호젠지'));
});
