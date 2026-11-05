import { supabase, errorText } from './supabase.js';
import { toast } from '../components/ui.js';
import { likeId, likeMap } from './likes.js';

// =====================================================================
// TripStore: 여행 1개의 데이터 캐시 + 오프라인 동기화
//
//  - 읽기: localStorage 캐시 → 즉시 렌더 → 온라인이면 서버 증분 pull (updated_at 커서)
//  - 쓰기: 로컬에 먼저 반영 → outbox(변경 큐)에 연산 저장 → 온라인이면 순서대로 전송
//      insert : 클라이언트가 만든 UUID 로 전송 (재전송돼도 중복 안 생기게 ON CONFLICT DO NOTHING)
//      update : 바뀐 필드만 전송 (필드 단위 마지막 쓰기 우선)
//      remove : deleted_at 설정 (soft delete)
//  - 다른 사람 변경: Realtime 구독으로 수신, 아직 못 보낸 내 변경은 그 위에 다시 덮어씀
// =====================================================================

export const CONTENT_TABLES = [
  'categories', 'places', 'itinerary_days', 'itinerary_items',
  'guides', 'budget_topups', 'expenses', 'todos',
  'place_likes',   // migration_011
];

const LOCAL_ONLY = ['created_at', 'updated_at', 'updated_by', 'created_by'];
const stripMeta = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !LOCAL_ONLY.includes(k)));

const INSERT_CHUNK = 100;     // 한 번에 보내는 추가 행 수
const UPDATE_PARALLEL = 6;    // 수정 요청 동시 전송 수
const CACHE_SAVE_DELAY = 400; // 기기 캐시 저장을 모아서 하는 간격(ms)

// 작업 목록을 동시에 n개씩 실행
async function runLimited(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const it = items[i++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

const isNetworkError = (err) =>
  !navigator.onLine || /fetch|network|Failed to|Load failed|timeout/i.test(err?.message || '');

// 서버에서 온 두 버전 중 더 새 것 (updated_at 기준, 같으면 들어온 쪽)
//  - 로컬에서만 바꾼 값은 updated_at 이 그대로라 들어온 값으로 바뀌지만, 보낼 변경(outbox)이 다시 덮어씀
// Realtime 이 char(3) 통화 코드를 1글자로 잘라 보내던 문제 방어 (migration_008 이후엔 발생하지 않음)
const CODE_KEYS = ['local_currency', 'home_currency', 'price_currency', 'currency'];
const isCode = (v) => typeof v === 'string' && /^[A-Z]{3}$/.test(v);
export function keepValidCodes(incoming, cur) {
  if (!incoming || !cur) return incoming;
  let out = incoming;
  for (const k of CODE_KEYS) {
    if (incoming[k] != null && !isCode(incoming[k]) && isCode(cur[k])) {
      if (out === incoming) out = { ...incoming };
      out[k] = cur[k];
    }
  }
  return out;
}

export function newer(cur, incoming) {
  if (!incoming) return cur ?? incoming;
  const a = ts(cur?.updated_at); const b = ts(incoming.updated_at);
  if (a == null || b == null) return incoming;
  return b >= a ? incoming : cur;
}
// 시각 문자열 → 숫자 (시간대 표시가 없는 값은 UTC 로 간주, 마이크로초까지 비교)
function ts(s) {
  if (!s) return null;
  const m = /^(.*?T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/.exec(String(s).replace(' ', 'T'));
  if (!m) { const t = Date.parse(s); return Number.isNaN(t) ? null : t * 1000; }
  const base = Date.parse(`${m[1]}${m[3] || 'Z'}`);
  if (Number.isNaN(base)) return null;
  return base * 1000 + Number(((m[2] || '') + '000000').slice(0, 6));
}

export class TripStore {
  constructor(tripId, userId) {
    this.tripId = tripId;
    this.userId = userId;
    this.cacheKey = `trip-cache:v1:${tripId}`;
    this.outboxKey = `trip-outbox:v1:${tripId}`;

    this.trip = null;
    this.budget = null;
    this.members = [];
    this.invite = null;
    this.devices = [];        // 멤버별 추가 기기 (기기 추가 코드로 연결)
    this.viewLink = null;     // 읽기 전용 공유 링크 { token, enabled } (migration_011)
    this.globalCategories = [];
    this.tables = Object.fromEntries(CONTENT_TABLES.map((t) => [t, new Map()]));
    this.cursors = {};
    this.outbox = [];

    this.listeners = new Set();
    this.channel = null;
    this.flushing = false;
    this.status = 'idle';     // idle | syncing | offline | error
    this._emitTimer = null;
    this._emitKind = null;
    this._cacheTimer = null;
    this._flushTimer = null;

    this._onOnline = () => this.sync();
    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOnline);

    // navigator.onLine 은 "와이파이는 연결됐지만 인터넷은 안 되는" 상태를 못 잡으므로
    // 화면에 다시 보일 때 + 보낼 게 남아 있으면 30초마다 재시도
    this._onVisible = () => {
      if (document.visibilityState === 'visible') this.sync();
      else this.saveCacheNow();   // 앱을 내리기 전에 모아둔 캐시 저장
    };
    document.addEventListener('visibilitychange', this._onVisible);
    this._onPageHide = () => this.saveCacheNow();
    window.addEventListener('pagehide', this._onPageHide);
    this._retryTimer = setInterval(() => {
      if (this.outbox.length && !this.flushing && document.visibilityState === 'visible') this.sync();
    }, 30000);
  }

  // ---------------------------------------------------------- 구독/알림
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  // kind: 'data'(내용이 바뀜 → 화면 다시 그림) | 'status'(동기화 상태·대기 건수만 → 헤더만)
  //  30ms 안에 여러 번 불리면 하나로 묶고, 하나라도 data 면 data
  emit(kind = 'data') {
    if (kind === 'data' || !this._emitKind) this._emitKind = kind;
    clearTimeout(this._emitTimer);
    this._emitTimer = setTimeout(() => {
      const k = this._emitKind || 'data';
      this._emitKind = null;
      this.listeners.forEach((fn) => fn(this, k));
    }, 30);
  }

  // ---------------------------------------------------------- 캐시
  loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(this.cacheKey) || 'null');
      if (c) {
        this.trip = c.trip; this.budget = c.budget; this.members = c.members || []; this.devices = c.devices || [];
        this.invite = c.invite; this.globalCategories = c.globalCategories || []; this.viewLink = c.viewLink || null;
        this.cursors = c.cursors || {};
        for (const t of CONTENT_TABLES) this.tables[t] = new Map((c.tables?.[t] || []).map((r) => [r.id, r]));
      }
      this.outbox = JSON.parse(localStorage.getItem(this.outboxKey) || '[]');
      this.applyOutboxLocally();
    } catch (e) {
      console.warn('cache load failed', e);
    }
    return !!this.trip;
  }

  // 변경이 몰릴 때 매번 전체를 저장하지 않도록 잠깐 모았다가 한 번에 저장
  saveCache() {
    clearTimeout(this._cacheTimer);
    this._cacheTimer = setTimeout(() => this.saveCacheNow(), CACHE_SAVE_DELAY);
  }

  saveCacheNow() {
    clearTimeout(this._cacheTimer);
    this._cacheTimer = null;
    if (!this.trip) return;
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify({
        trip: this.trip, budget: this.budget, members: this.members, devices: this.devices, invite: this.invite,
        viewLink: this.viewLink, globalCategories: this.globalCategories, cursors: this.cursors,
        tables: Object.fromEntries(CONTENT_TABLES.map((t) => [t, [...this.tables[t].values()]])),
      }));
    } catch (e) { console.warn('cache save failed', e); }
  }

  saveOutbox() {
    try { localStorage.setItem(this.outboxKey, JSON.stringify(this.outbox)); } catch {}
  }

  // ---------------------------------------------------------- 시작/종료
  async start() {
    const hadCache = this.loadCache();
    if (hadCache) this.emit();
    await this.sync();
    this.subscribeRealtime();
    return this;
  }

  destroy() {
    window.removeEventListener('online', this._onOnline);
    window.removeEventListener('offline', this._onOnline);
    document.removeEventListener('visibilitychange', this._onVisible);
    window.removeEventListener('pagehide', this._onPageHide);
    clearInterval(this._retryTimer);
    clearTimeout(this._flushTimer);
    if (this._cacheTimer) this.saveCacheNow();
    if (this.channel) supabase.removeChannel(this.channel);
    this.listeners.clear();
  }

  sync() {
    // 여러 곳(온라인 복귀, 화면 복귀, 타이머)에서 동시에 불려도 한 번만 실행
    if (!this._syncing) this._syncing = this._sync().finally(() => { this._syncing = null; });
    return this._syncing;
  }

  async _sync() {
    if (!navigator.onLine) { this.status = 'offline'; this.emit('status'); return; }
    this.status = 'syncing'; this.emit('status');
    let changed = false;
    try {
      await this.flush();
      changed = await this.pull();
      this.status = this.outbox.length ? 'offline' : 'idle';
      this.lastSyncedAt = Date.now();
    } catch (e) {
      this.status = isNetworkError(e) ? 'offline' : 'error';
      if (!isNetworkError(e)) console.error(e);
    }
    if (changed) this.saveCache();
    this.emit(changed ? 'data' : 'status');   // 받은 게 없으면 헤더만 갱신
  }

  // ---------------------------------------------------------- 서버 → 로컬
  // 반환: 화면에 보이는 내용이 바뀌었는지
  async pull() {
    const id = this.tripId;
    const before = this.headSignature();
    // 기본 정보 · 기기 목록 · 콘텐츠 8개 표를 한 번에 병렬로 요청 (서버 왕복 1번)
    const contentQ = CONTENT_TABLES.map((t) => {
      let q = supabase.from(t).select('*').eq('trip_id', id).order('updated_at').limit(5000);
      if (this.cursors[t]) q = q.gt('updated_at', this.cursors[t]);
      return q;
    });
    const [trip, budget, members, invite, globals, devices, viewLink, ...contents] = await Promise.all([
      supabase.from('trips').select('*').eq('id', id).maybeSingle(),
      supabase.from('trip_budgets').select('*').eq('trip_id', id).maybeSingle(),
      supabase.from('trip_members').select('*').eq('trip_id', id).order('created_at'),
      supabase.from('trip_invites').select('*').eq('trip_id', id).maybeSingle(),
      supabase.from('categories').select('*').is('trip_id', null).is('deleted_at', null).order('sort_order'),
      // 추가 기기 목록 (migration_002 이전 DB 에서는 테이블이 없을 수 있으므로 실패해도 무시)
      supabase.from('trip_member_devices').select('id, member_id, user_id, created_at, last_seen_at').eq('trip_id', id),
      supabase.from('trip_view_links').select('token, enabled').eq('trip_id', id).maybeSingle(),
      ...contentQ,
    ]);
    for (const r of [trip, budget, members, invite, globals, ...contents]) if (r.error) throw r.error;
    if (!trip.data) throw new Error('FORBIDDEN');

    // 받아오는 사이 저장된 더 새 값(저장 응답·실시간 알림)을 옛날 응답으로 덮어쓰지 않도록 수정 시각 비교
    this.trip = newer(this.trip, trip.data);
    this.budget = newer(this.budget, budget.data);
    this.members = members.data;
    this.devices = devices.error ? [] : devices.data;
    this.viewLink = viewLink.error ? null : viewLink.data;
    this.invite = invite.data;
    this.globalCategories = globals.data;

    let applied = 0;
    contents.forEach((r, i) => r.data.forEach((row) => { if (this.applyRemote(CONTENT_TABLES[i], row, false)) applied++; }));
    this.applyOutboxLocally();
    return applied > 0 || this.headSignature() !== before;
  }

  // 여행 정보 · 예산 · 멤버 등 작은 데이터의 비교용 문자열
  headSignature() {
    return JSON.stringify([this.trip, this.budget, this.members, this.devices, this.invite, this.viewLink, this.globalCategories?.length]);
  }

  applyRemote(table, row, notify = true) {
    if (!row?.id) return;
    const cur = this.tables[table].get(row.id);
    if (newer(cur, row) !== row) return false;   // 이미 더 새 버전이 있으면 무시
    // 같은 버전이면 건너뜀 (내 저장이 실시간 알림으로 되돌아온 경우 등 → 화면을 다시 그리지 않음)
    if (cur && cur.updated_at && ts(cur.updated_at) === ts(row.updated_at)) return false;
    row = keepValidCodes(row, cur);
    this.tables[table].set(row.id, row);
    if (row.updated_at && (!this.cursors[table] || row.updated_at > this.cursors[table])) {
      this.cursors[table] = row.updated_at;
    }
    if (notify) { this.applyOutboxLocally(); this.saveCache(); this.emit(); }
    return true;
  }

  // 아직 서버에 못 보낸 변경을 로컬 데이터 위에 다시 적용
  applyOutboxLocally() {
    for (const op of this.outbox) {
      if (op.table === 'trip_budgets') { this.budget = { ...(this.budget || {}), ...op.data }; continue; }
      const map = this.tables[op.table];
      if (!map) continue;
      const cur = map.get(op.id);
      if (op.op === 'insert') map.set(op.id, { ...op.data, ...(cur || {}), ...op.data });
      else if (cur) map.set(op.id, { ...cur, ...op.data });
    }
  }

  subscribeRealtime() {
    if (this.channel) return;
    const id = this.tripId;
    let ch = supabase.channel(`trip:${id}`);
    for (const t of CONTENT_TABLES) {
      ch = ch.on('postgres_changes', { event: '*', schema: 'public', table: t, filter: `trip_id=eq.${id}` },
        (p) => { if (p.new?.id) this.applyRemote(t, p.new); });
    }
    ch = ch
      .on('postgres_changes', { event: '*', schema: 'public', table: 'trip_members', filter: `trip_id=eq.${id}` },
        (p) => {
          if (!p.new?.id) return;
          const i = this.members.findIndex((m) => m.id === p.new.id);
          if (i >= 0) this.members[i] = p.new; else this.members.push(p.new);
          this.saveCache(); this.emit();
        })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trip_budgets', filter: `trip_id=eq.${id}` },
        (p) => { this.budget = newer(this.budget, keepValidCodes(p.new, this.budget)); this.applyOutboxLocally(); this.saveCache(); this.emit(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${id}` },
        (p) => { this.trip = newer(this.trip, p.new); this.saveCache(); this.emit(); });
    this.channel = ch.subscribe((status) => {
      // 재연결되면 놓친 변경을 커서 기준으로 다시 받음
      if (status === 'SUBSCRIBED' && this._subscribedOnce) this.sync();
      if (status === 'SUBSCRIBED') this._subscribedOnce = true;
    });
  }

  // ---------------------------------------------------------- 로컬 → 서버
  enqueue(op) {
    // 아직 안 보낸 같은 행의 update 는 하나로 합침
    if (op.op === 'update') {
      const prev = [...this.outbox].reverse().find((o) => o.table === op.table && o.id === op.id);
      if (prev && !prev.sending) { prev.data = { ...prev.data, ...op.data }; this.saveOutbox(); return; }
    }
    this.outbox.push(op);
    this.saveOutbox();
  }

  // 쓰기 직후 바로 보내지 않고 같은 순간의 변경을 모아서 보냄 (장소 61곳 가져오기 → 요청 1번)
  scheduleFlush() {
    if (this._flushTimer) return;
    this._flushTimer = setTimeout(() => { this._flushTimer = null; this.flush(); }, 0);
  }

  async flush() {
    if (this.flushing || !navigator.onLine) return;
    this.flushing = true;
    let dropped = false;
    try {
      while (this.outbox.length) {
        const batch = this.outbox.slice();          // 지금 쌓인 것 전부 (보내는 중에 쌓이는 건 다음 차례)
        batch.forEach((o) => { o.sending = true; });
        const r = await this.sendBatch(batch);
        const finished = new Set([...r.done, ...r.dropped]);
        this.outbox = this.outbox.filter((o) => !finished.has(o));
        this.saveOutbox();
        if (r.dropped.length) dropped = true;
        if (r.offline) break;                        // 오프라인: 남은 건 다음 기회에 재시도
      }
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    } finally {
      this.outbox.forEach((o) => { o.sending = false; });
      this.flushing = false;
      this.applyOutboxLocally();
      this.saveCache();
      // 저장 실패로 되돌린 게 있으면 화면도 다시 그림, 아니면 헤더(대기 건수)만
      this.emit(dropped ? 'data' : 'status');
    }
  }

  // 순서: 예산 → 추가(표별로 묶음, 처음 나온 표 순서대로: 카테고리가 장소보다 먼저) → 수정(동시 6개)
  async sendBatch(batch) {
    const done = []; const dropped = [];
    const fail = (op, err) => {
      // 권한/제약 위반 등은 재시도해도 실패 → 버리고 서버 상태로 되돌림
      toast(`저장 실패: ${errorText(err)}`, 'error');
      dropped.push(op);
      if (op.op === 'insert') this.tables[op.table]?.delete(op.id);
    };

    for (const op of batch.filter((o) => o.table === 'trip_budgets')) {
      const res = await supabase.from('trip_budgets').update(op.data).eq('trip_id', this.tripId).select().maybeSingle();
      if (res.error) { if (isNetworkError(res.error)) return { done, dropped, offline: true }; fail(op, res.error); continue; }
      done.push(op);
      if (res.data) this.budget = newer(this.budget, res.data);
    }

    const inserts = batch.filter((o) => o.op === 'insert');
    for (const t of [...new Set(inserts.map((o) => o.table))]) {
      const ops = inserts.filter((o) => o.table === t);
      for (let i = 0; i < ops.length; i += INSERT_CHUNK) {
        const chunk = ops.slice(i, i + INSERT_CHUNK);
        const res = await supabase.from(t)
          .upsert(chunk.map((o) => stripMeta(o.data)), { onConflict: 'id', ignoreDuplicates: true, defaultToNull: false })
          .select();
        if (!res.error) {
          done.push(...chunk);
          (res.data || []).forEach((row) => this.applyRemote(t, row, false));
          continue;
        }
        if (isNetworkError(res.error)) return { done, dropped, offline: true };
        // 묶음 중 한 건 때문에 전체가 실패 → 한 건씩 다시 보내서 문제 있는 것만 버림
        for (const op of chunk) {
          const r1 = await supabase.from(t).upsert(stripMeta(op.data), { onConflict: 'id', ignoreDuplicates: true }).select().maybeSingle();
          if (r1.error) { if (isNetworkError(r1.error)) return { done, dropped, offline: true }; fail(op, r1.error); continue; }
          done.push(op);
          if (r1.data) this.applyRemote(t, r1.data, false);
        }
      }
    }

    // 같은 행의 수정이 여러 개면 순서대로 합쳐서 한 번에 (동시에 보내도 순서가 꼬이지 않게)
    const merged = new Map();
    for (const op of batch.filter((o) => o.op === 'update' && o.table !== 'trip_budgets')) {
      const key = `${op.table}:${op.id}`;
      const m = merged.get(key);
      if (m) { m.ops.push(op); Object.assign(m.data, op.data); } else merged.set(key, { table: op.table, id: op.id, data: { ...op.data }, ops: [op] });
    }
    let offline = false;
    await runLimited([...merged.values()], UPDATE_PARALLEL, async (m) => {
      if (offline) return;
      const res = await supabase.from(m.table).update(m.data).eq('id', m.id).select().maybeSingle();
      if (res.error) {
        if (isNetworkError(res.error)) { offline = true; return; }
        m.ops.forEach((op) => fail(op, res.error));
        return;
      }
      done.push(...m.ops);
      if (res.data) this.applyRemote(m.table, res.data, false);
    });
    return { done, dropped, offline };
  }

  // ---------------------------------------------------------- 쓰기 API
  insert(table, data) {
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), trip_id: this.tripId, ...data };
    this.tables[table].set(row.id, { ...row, created_at: now, updated_at: now, created_by: this.userId });
    this.enqueue({ op: 'insert', table, id: row.id, data: row });
    this.emit();
    this.scheduleFlush();
    return row.id;
  }

  update(table, id, patch) {
    const cur = this.tables[table].get(id);
    if (cur) this.tables[table].set(id, { ...cur, ...patch });
    this.enqueue({ op: 'update', table, id, data: patch });
    this.emit();
    this.scheduleFlush();
  }

  remove(table, id) {
    this.update(table, id, { deleted_at: new Date().toISOString() });
  }

  updateBudget(patch) {
    this.budget = { ...(this.budget || {}), ...patch };
    const prev = this.outbox.find((o) => o.table === 'trip_budgets' && !o.sending);
    if (prev) { prev.data = { ...prev.data, ...patch }; this.saveOutbox(); }
    else this.enqueue({ op: 'update', table: 'trip_budgets', id: this.tripId, data: patch });
    this.emit();
    this.scheduleFlush();
  }

  // ---------------------------------------------------------- 읽기 API
  list(table, { includeDeleted = false } = {}) {
    const rows = [...this.tables[table].values()].filter((r) => includeDeleted || !r.deleted_at);
    return rows.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
      || String(a.created_at).localeCompare(String(b.created_at)));
  }

  get(table, id) { return id ? this.tables[table].get(id) : null; }

  categories() {
    const custom = this.list('categories');
    return [...custom, ...this.globalCategories].sort((a, b) => (a.trip_id ? 0 : 1) - (b.trip_id ? 0 : 1)
      || (a.sort_order ?? 0) - (b.sort_order ?? 0));
  }

  category(id) {
    const custom = this.tables.categories.get(id);
    if (custom) return custom.deleted_at ? null : custom;
    return this.globalCategories.find((c) => c.id === id) || null;
  }

  activeMembers() { return this.members.filter((m) => !m.removed_at); }

  // ---------------------------------------------------------- 찜
  // 장소 id → 찜한 멤버 id 목록 (지금 멤버만)
  likeMap() {
    return likeMap(this.list('place_likes'), new Set(this.activeMembers().map((m) => m.id)));
  }
  likedByMe(placeId) {
    const me = this.me;
    if (!me) return false;
    return !!this.tables.place_likes.get(likeId(placeId, me.id))?.liked;
  }
  // 내 찜 켜고 끄기. 내 멤버를 모르면(참여 정보 없음) false
  toggleLike(placeId) {
    const me = this.me;
    if (!me) return false;
    const id = likeId(placeId, me.id);
    const cur = this.tables.place_likes.get(id);
    if (cur) this.update('place_likes', id, { liked: !cur.liked });
    else this.insert('place_likes', { id, place_id: placeId, member_id: me.id, liked: true });
    return true;
  }
  member(id) { return this.members.find((m) => m.id === id) || null; }
  get me() {
    const active = this.members.filter((m) => !m.removed_at);
    const direct = active.find((m) => m.user_id === this.userId);
    if (direct) return direct;
    const dev = this.devices.find((d) => d.user_id === this.userId);
    return dev ? active.find((m) => m.id === dev.member_id) || null : null;
  }
  deviceCount(memberId) {
    const m = this.member(memberId);
    return (m?.user_id ? 1 : 0) + this.devices.filter((d) => d.member_id === memberId).length;
  }
  get isOwner() { return this.me?.role === 'owner'; }
  get pendingCount() { return this.outbox.length; }

  nextSortOrder(table, filter = () => true) {
    const rows = this.list(table).filter(filter);
    return rows.length ? Math.max(...rows.map((r) => r.sort_order ?? 0)) + 10 : 10;
  }
}
