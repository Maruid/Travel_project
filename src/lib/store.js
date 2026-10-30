import { supabase, errorText } from './supabase.js';
import { toast } from '../components/ui.js';

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
];

const LOCAL_ONLY = ['created_at', 'updated_at', 'updated_by', 'created_by'];
const stripMeta = (row) => Object.fromEntries(Object.entries(row).filter(([k]) => !LOCAL_ONLY.includes(k)));

const isNetworkError = (err) =>
  !navigator.onLine || /fetch|network|Failed to|Load failed|timeout/i.test(err?.message || '');

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
    this.globalCategories = [];
    this.tables = Object.fromEntries(CONTENT_TABLES.map((t) => [t, new Map()]));
    this.cursors = {};
    this.outbox = [];

    this.listeners = new Set();
    this.channel = null;
    this.flushing = false;
    this.status = 'idle';     // idle | syncing | offline | error
    this._emitTimer = null;

    this._onOnline = () => this.sync();
    window.addEventListener('online', this._onOnline);
    window.addEventListener('offline', this._onOnline);

    // navigator.onLine 은 "와이파이는 연결됐지만 인터넷은 안 되는" 상태를 못 잡으므로
    // 화면에 다시 보일 때 + 보낼 게 남아 있으면 30초마다 재시도
    this._onVisible = () => { if (document.visibilityState === 'visible') this.sync(); };
    document.addEventListener('visibilitychange', this._onVisible);
    this._retryTimer = setInterval(() => {
      if (this.outbox.length && !this.flushing && document.visibilityState === 'visible') this.sync();
    }, 30000);
  }

  // ---------------------------------------------------------- 구독/알림
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit() {
    clearTimeout(this._emitTimer);
    this._emitTimer = setTimeout(() => this.listeners.forEach((fn) => fn(this)), 30);
  }

  // ---------------------------------------------------------- 캐시
  loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(this.cacheKey) || 'null');
      if (c) {
        this.trip = c.trip; this.budget = c.budget; this.members = c.members || []; this.devices = c.devices || [];
        this.invite = c.invite; this.globalCategories = c.globalCategories || [];
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

  saveCache() {
    try {
      localStorage.setItem(this.cacheKey, JSON.stringify({
        trip: this.trip, budget: this.budget, members: this.members, devices: this.devices, invite: this.invite,
        globalCategories: this.globalCategories, cursors: this.cursors,
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
    clearInterval(this._retryTimer);
    if (this.channel) supabase.removeChannel(this.channel);
    this.listeners.clear();
  }

  sync() {
    // 여러 곳(온라인 복귀, 화면 복귀, 타이머)에서 동시에 불려도 한 번만 실행
    if (!this._syncing) this._syncing = this._sync().finally(() => { this._syncing = null; });
    return this._syncing;
  }

  async _sync() {
    if (!navigator.onLine) { this.status = 'offline'; this.emit(); return; }
    this.status = 'syncing'; this.emit();
    try {
      await this.flush();
      await this.pull();
      this.status = this.outbox.length ? 'offline' : 'idle';
    } catch (e) {
      this.status = isNetworkError(e) ? 'offline' : 'error';
      if (!isNetworkError(e)) console.error(e);
    }
    this.saveCache();
    this.emit();
  }

  // ---------------------------------------------------------- 서버 → 로컬
  async pull() {
    const id = this.tripId;
    const [trip, budget, members, invite, globals] = await Promise.all([
      supabase.from('trips').select('*').eq('id', id).maybeSingle(),
      supabase.from('trip_budgets').select('*').eq('trip_id', id).maybeSingle(),
      supabase.from('trip_members').select('*').eq('trip_id', id).order('created_at'),
      supabase.from('trip_invites').select('*').eq('trip_id', id).maybeSingle(),
      supabase.from('categories').select('*').is('trip_id', null).is('deleted_at', null).order('sort_order'),
    ]);
    for (const r of [trip, budget, members, invite, globals]) if (r.error) throw r.error;
    if (!trip.data) throw new Error('FORBIDDEN');

    this.trip = trip.data;
    this.budget = budget.data;
    this.members = members.data;
    // 추가 기기 목록 (migration_002 이전 DB 에서는 테이블이 없을 수 있으므로 실패해도 무시)
    const devices = await supabase.from('trip_member_devices').select('id, member_id, user_id, created_at, last_seen_at').eq('trip_id', id);
    this.devices = devices.error ? [] : devices.data;
    this.invite = invite.data;
    this.globalCategories = globals.data;

    await Promise.all(CONTENT_TABLES.map(async (t) => {
      let q = supabase.from(t).select('*').eq('trip_id', id).order('updated_at').limit(5000);
      if (this.cursors[t]) q = q.gt('updated_at', this.cursors[t]);
      const { data, error } = await q;
      if (error) throw error;
      data.forEach((row) => this.applyRemote(t, row, false));
    }));
    this.applyOutboxLocally();
  }

  applyRemote(table, row, notify = true) {
    if (!row?.id) return;
    this.tables[table].set(row.id, row);
    if (row.updated_at && (!this.cursors[table] || row.updated_at > this.cursors[table])) {
      this.cursors[table] = row.updated_at;
    }
    if (notify) { this.applyOutboxLocally(); this.saveCache(); this.emit(); }
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
        (p) => { this.budget = p.new; this.applyOutboxLocally(); this.saveCache(); this.emit(); })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trips', filter: `id=eq.${id}` },
        (p) => { this.trip = p.new; this.saveCache(); this.emit(); });
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

  async flush() {
    if (this.flushing || !navigator.onLine) return;
    this.flushing = true;
    try {
      while (this.outbox.length) {
        const op = this.outbox[0];
        op.sending = true;
        let res;
        if (op.table === 'trip_budgets') {
          res = await supabase.from('trip_budgets').update(op.data).eq('trip_id', this.tripId).select().maybeSingle();
        } else if (op.op === 'insert') {
          res = await supabase.from(op.table)
            .upsert(stripMeta(op.data), { onConflict: 'id', ignoreDuplicates: true }).select().maybeSingle();
        } else {
          res = await supabase.from(op.table).update(op.data).eq('id', op.id).select().maybeSingle();
        }

        if (res.error) {
          op.sending = false;
          if (isNetworkError(res.error)) break;          // 오프라인: 다음 기회에 재시도
          // 권한/제약 위반 등은 재시도해도 실패 → 버리고 서버 상태로 되돌림
          toast(`저장 실패: ${errorText(res.error)}`, 'error');
          this.outbox.shift();
          this.saveOutbox();
          if (op.op === 'insert') this.tables[op.table]?.delete(op.id);
          continue;
        }

        this.outbox.shift();
        this.saveOutbox();
        if (res.data) {
          if (op.table === 'trip_budgets') this.budget = res.data;
          else this.applyRemote(op.table, res.data, false);
        }
      }
    } catch (e) {
      if (!isNetworkError(e)) throw e;
    } finally {
      this.outbox.forEach((o) => { o.sending = false; });
      this.flushing = false;
      this.applyOutboxLocally();
      this.saveCache();
      this.emit();
    }
  }

  // ---------------------------------------------------------- 쓰기 API
  insert(table, data) {
    const now = new Date().toISOString();
    const row = { id: crypto.randomUUID(), trip_id: this.tripId, ...data };
    this.tables[table].set(row.id, { ...row, created_at: now, updated_at: now, created_by: this.userId });
    this.enqueue({ op: 'insert', table, id: row.id, data: row });
    this.emit();
    this.flush();
    return row.id;
  }

  update(table, id, patch) {
    const cur = this.tables[table].get(id);
    if (cur) this.tables[table].set(id, { ...cur, ...patch });
    this.enqueue({ op: 'update', table, id, data: patch });
    this.emit();
    this.flush();
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
    this.flush();
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
