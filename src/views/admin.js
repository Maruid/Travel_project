import { html, setHTML, delegate, formValues, $ } from '../lib/dom.js';
import { getUser, isAnonymous, signInWithGoogle, signOut } from '../lib/auth.js';
import { rpc, supabase, errorText } from '../lib/supabase.js';
import { spinner, toast, copyText, confirmAction, emptyCard } from '../components/ui.js';
import { navigate } from '../router.js';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const kTok = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n || 0));
const day = (ts) => (ts ? String(ts).slice(0, 10) : '');

// AI 추천 권한 섹션 (migration_009 이전이면 users 가 null → 섹션 숨김)
function aiSection(users, summary) {
  if (!users) return '';
  const s = summary || {};
  const line = (k, label) => (s[k] ? `${label} ${s[k].calls}회${s[k].failed ? `(실패 ${s[k].failed})` : ''} · 토큰 ${kTok(s[k].tokens)}${s[k].avg_ms ? ` · 평균 ${(s[k].avg_ms / 1000).toFixed(1)}초` : ''}` : `${label} 0회`);
  const requests = users.filter((u) => u.requested_at && !u.active);
  const status = (u) => {
    if (u.is_admin) return html`<span class="text-amber-300">관리자 · 무제한</span>`;
    if (u.active) return html`<span class="text-emerald-300">허용 · ${u.expires_at ? `${day(u.expires_at)}까지` : '영구'}</span>`;
    if (u.revoked_at) return html`<span class="text-slate-500">꺼짐 (${day(u.revoked_at)})</span>`;
    if (u.daily_limit != null && u.expires_at) return html`<span class="text-slate-500">만료 (${day(u.expires_at)})</span>`;
    return html`<span class="text-slate-500">권한 없음</span>`;
  };
  const row = (u) => html`
    <div class="p-2.5 rounded-xl bg-night-950/60 space-y-1.5 ${u.requested_at && !u.active ? 'border border-amber-400/40' : ''}">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="text-xs font-bold text-white truncate">${u.email || '(이메일 없음)'}</p>
          <p class="text-[10px] text-slate-400 truncate">${u.trips || '참여 여행 없음'} · 최근 ${ago(u.last_seen)}</p>
        </div>
        <span class="text-[10px] flex-shrink-0">${status(u)}</span>
      </div>
      ${u.requested_at && !u.active ? html`<p class="text-[10px] text-amber-200"><i class="fa-solid fa-hand mr-1"></i>사용 요청 · ${ago(u.requested_at)}${u.request_message ? ` · ${u.request_message}` : ''}</p>` : ''}
      <p class="text-[10px] text-slate-400">오늘 추천·일정 ${u.used_today}${u.active && !u.is_admin ? `/${u.daily_limit}` : ''}회 · 7일: 추천 ${u.recommend_7d}회(토큰 ${kTok(u.recommend_tokens_7d)})${u.plan_7d ? ` · 일정 짜기 ${u.plan_7d}회(토큰 ${kTok(u.plan_tokens_7d)})` : ''} · 정보 채우기 ${u.enrich_7d}회(토큰 ${kTok(u.enrich_tokens_7d)})</p>
      ${u.is_admin ? '' : html`
        <div class="flex flex-wrap items-center gap-1">
          <button data-action="ai-grant" data-user="${u.user_id}" data-days="7" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-200">7일</button>
          <button data-action="ai-grant" data-user="${u.user_id}" data-days="30" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-200">30일</button>
          <input type="date" id="ai-date-${u.user_id}" class="text-[10px] px-1.5 py-1 rounded bg-slate-800 text-slate-200 border border-white/10">
          <button data-action="ai-grant" data-user="${u.user_id}" data-days="date" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-200">날짜까지</button>
          <button data-action="ai-grant" data-user="${u.user_id}" data-days="perm" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-200">영구</button>
          ${u.active ? html`<button data-action="ai-off" data-user="${u.user_id}" class="text-[10px] px-2 py-1 rounded bg-rose-500/15 text-rose-300">끄기</button>` : ''}
          ${u.requested_at && !u.active ? html`<button data-action="ai-dismiss" data-user="${u.user_id}" class="text-[10px] px-2 py-1 rounded text-slate-400">요청 지우기</button>` : ''}
        </div>
        ${u.daily_limit != null ? html`
          <div class="flex items-center gap-1 text-[10px] text-slate-400">하루 한도
            <input type="number" min="0" max="1000" id="ai-limit-${u.user_id}" value="${u.daily_limit}" class="w-16 px-1.5 py-0.5 rounded bg-slate-800 text-slate-100 border border-white/10">회
            <button data-action="ai-limit" data-user="${u.user_id}" class="px-2 py-0.5 rounded bg-slate-800 text-slate-200">저장</button>
          </div>` : ''}`}
    </div>`;
  return html`
    <section class="glass-card p-4 rounded-2xl space-y-2">
      <div class="flex items-center justify-between">
        <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-wand-magic-sparkles text-purple-300 mr-1"></i>AI 추천 권한</h3>
        ${requests.length ? html`<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-200 font-bold">요청 ${requests.length}건</span>` : ''}
      </div>
      <p class="text-[10px] text-slate-400">최근 7일: ${line('recommend', '추천')} / ${line('plan', '일정 짜기')} / ${line('enrich', '정보 채우기')}</p>
      <p class="text-[10px] text-slate-500">Google 로그인 사용자만 표시돼요. 새로 허용하면 하루 10회로 시작하고, 아래 칸에서 사람마다 바꿀 수 있어요.</p>
      ${users.length ? users.map(row) : emptyCard('Google 로그인 사용자가 없어요.')}
    </section>`;
}
const ago = (ts) => {
  if (!ts) return '-';
  const d = (Date.now() - new Date(ts).getTime()) / 86400000;
  return d < 1 ? '오늘' : `${Math.floor(d)}일 전`;
};

export async function render(app) {
  setHTML(app, spinner());
  const user = await getUser();

  const header = html`
    <header class="px-4 py-3 glass-nav sticky top-0 z-40 flex items-center justify-between" style="padding-top:calc(0.75rem + var(--sat))">
      <div class="flex items-center gap-2">
        <button data-action="home" class="w-7 h-7 text-slate-400"><i class="fa-solid fa-chevron-left"></i></button>
        <h1 class="text-sm font-black text-white">관리자</h1>
      </div>
      ${user && !isAnonymous(user) ? html`<button data-action="logout" class="text-[10px] text-slate-400">${user.email} · 로그아웃</button>` : ''}
    </header>`;

  const actions = {
    home: () => navigate('/'),
    login: () => signInWithGoogle().catch((e) => toast(errorText(e), 'error')),
    logout: async () => { await signOut(); navigate('/'); },
  };

  // 오프라인(또는 로그인 확인 전)이면 로그인을 요구하지 않고 안내만 — 관리자 화면은 서버 데이터만 다룸
  if (!navigator.onLine || user?.offline) {
    setHTML(app, html`${header}
      <main class="p-6 text-center space-y-3 mt-10">
        <i class="fa-solid fa-plane text-3xl text-amber-300"></i>
        <p class="text-sm text-slate-300">관리자 화면은 인터넷에 연결된 상태에서만 쓸 수 있어요.</p>
        <p class="text-[10px] text-slate-500">${navigator.onLine ? '로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' : '연결된 뒤 다시 시도해 주세요.'}</p>
        <button data-action="retry" class="btn-ghost">다시 시도</button>
      </main>`);
    return { cleanup: delegate(app, { ...actions, retry: () => location.reload() }) };
  }

  // 익명 세션이면 Google 로그인 요구
  if (!user || isAnonymous(user)) {
    setHTML(app, html`${header}
      <main class="p-6 text-center space-y-4 mt-10">
        <i class="fa-solid fa-user-shield text-3xl text-neon-cyan"></i>
        <p class="text-sm text-slate-300">관리자 계정(Google)으로 로그인하세요.</p>
        <p class="text-[10px] text-slate-500">현재 브라우저의 임시 계정은 로그아웃됩니다. 참여 중인 여행은 링크로 다시 들어오면 됩니다.</p>
        <button data-action="login" class="btn-primary"><i class="fa-brands fa-google mr-1"></i>Google 로그인</button>
      </main>`);
    return { cleanup: delegate(app, actions) };
  }

  let isAdmin = false;
  try { isAdmin = await rpc('is_admin'); } catch {}
  if (!isAdmin) {
    setHTML(app, html`${header}
      <main class="p-6 text-center space-y-3 mt-10">
        <p class="text-sm text-slate-300">관리자 권한이 없는 계정입니다.</p>
        <p class="text-[10px] text-slate-500 font-mono break-all">uid: ${user.id}</p>
        <p class="text-[10px] text-slate-500">SQL Editor 에서 admins 테이블에 위 uid 를 등록하세요.</p>
        <button data-action="copy-uid" class="btn-ghost">uid 복사</button>
      </main>`);
    return { cleanup: delegate(app, { ...actions, 'copy-uid': () => copyText(user.id, 'uid') }) };
  }

  async function load() {
    const [stats, trips, codes, places, aiUsers, aiSummary] = await Promise.all([
      rpc('admin_stats'),
      rpc('admin_list_trips'),
      supabase.from('creation_codes').select('*').order('created_at', { ascending: false }).then((r) => {
        if (r.error) throw r.error; return r.data;
      }),
      rpc('places_quota_status').catch(() => null),   // migration_003 이전이면 없음
      rpc('admin_ai_users').catch(() => null),        // migration_009 이전이면 없음
      rpc('admin_ai_summary').catch(() => null),
    ]);

    // 생성 코드: 사용 가능 / 지난 코드(만료·소진·폐기)
    const now = new Date();
    const usable = (c) => !c.revoked && (!c.expires_at || new Date(c.expires_at) > now) && (c.max_uses == null || c.used_count < c.max_uses);
    const live = codes.filter(usable);
    const ended = codes.filter((c) => !usable(c));
    const daysLeft = (c) => {
      const t = c.ended_at || c.expires_at;
      return t ? Math.max(0, 90 - Math.floor((now - new Date(t)) / 86400000)) : null;
    };
    const codeRow = (c, ok) => html`<div class="flex items-center justify-between p-2 rounded-xl bg-night-950/60 text-[11px]">
      <div class="min-w-0">
        <button data-action="copy-code" data-code="${c.code}" class="font-mono font-bold ${ok ? 'text-neon-cyan' : 'text-slate-500 line-through'}">${c.code}</button>
        <span class="text-[10px] text-slate-400 block truncate">${c.type === 'one_time' ? '일회성' : '영구'} · ${c.used_count}/${c.max_uses ?? '∞'}회 ${c.expires_at ? `· ~${c.expires_at.slice(0, 10)}` : ''} ${c.note ? `· ${c.note}` : ''}${!ok && daysLeft(c) != null ? ` · ${daysLeft(c)}일 뒤 자동 삭제` : ''}</span>
      </div>
      ${ok ? html`<button data-action="revoke" data-id="${c.id}" class="text-rose-400 text-[10px] px-2 flex-shrink-0">폐기</button>`
        : html`<button data-action="delete-code" data-id="${c.id}" data-code="${c.code}" class="text-rose-400 text-[10px] px-2 flex-shrink-0">삭제</button>`}
    </div>`;

    setHTML(app, html`${header}
      <main class="p-4 space-y-3 pb-10">
        <section class="grid grid-cols-3 gap-2">
          ${[['여행', stats.trips], ['오늘 활성', stats.active_1d], ['7일 활성', stats.active_7d],
             ['30일 활성', stats.active_30d], ['연결된 멤버', stats.members], ['DB 용량', mb(stats.db_size_bytes)],
             ...(places ? [['구글 상세 조회', `${places.details}/${places.limit}`], ['구글 검색', `${places.search}/${places.limit}`]] : [])]
            .map(([k, v]) => html`<div class="glass-card p-3 rounded-2xl">
              <span class="text-[10px] text-slate-400 block">${k}</span>
              <span class="text-base font-black font-mono text-white">${v}</span></div>`)}
        </section>
        <div class="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
          <div class="h-full bg-neon-cyan" style="width:${Math.min(100, (stats.db_size_bytes / (500 * 1024 * 1024)) * 100).toFixed(1)}%"></div>
        </div>
        <p class="text-[10px] text-slate-500 text-right -mt-2">무료 한도 500MB 대비</p>

        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white">여행 생성 코드</h3>
          <form id="code-form" class="grid grid-cols-2 gap-2">
            <select name="type" class="input"><option value="one_time">일회성</option><option value="permanent">영구</option></select>
            <input name="max_uses" type="number" min="1" class="input" placeholder="최대 사용 (영구, 비우면 무제한)">
            <input name="expires" type="date" class="input" title="만료일 (선택)">
            <input name="code" class="input font-mono uppercase" placeholder="코드 직접 지정 (선택)">
            <input name="note" class="input col-span-2" maxlength="200" placeholder="메모 (누구에게 줬는지 등)">
            <button class="btn-primary col-span-2">코드 발급</button>
          </form>
          <div class="space-y-1.5 pt-1">
            ${live.length ? live.map((c) => codeRow(c, true)) : emptyCard('사용 가능한 코드가 없습니다.')}
          </div>
          ${ended.length ? html`
          <details class="pt-1">
            <summary class="text-[11px] text-slate-400 cursor-pointer">지난 코드 ${ended.length}개 (만료·소진·폐기 · 90일 뒤 자동 삭제)</summary>
            <div class="space-y-1.5 mt-2">
              ${ended.map((c) => codeRow(c, false))}
              <button data-action="delete-ended" class="w-full py-2 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-[11px] font-bold">지난 코드 모두 삭제</button>
            </div>
          </details>` : ''}
        </section>

        ${aiSection(aiUsers, aiSummary)}

        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white">전체 여행 ${trips.length}개</h3>
          ${trips.map((t) => html`
            <div class="flex items-center justify-between p-2.5 rounded-xl bg-night-950/60 gap-2">
              <div class="min-w-0">
                <p class="text-xs font-bold text-white truncate">${t.title}</p>
                <p class="text-[10px] text-slate-400 truncate">${t.owner_name || '-'} · ${t.member_count}명 · 항목 ${t.item_count} · 최근 활동 ${ago(t.last_active_at)}${t.creation_code ? ` · ${t.creation_code}` : ''}</p>
              </div>
              <button data-action="delete-trip" data-id="${t.trip_id}" data-title="${t.title}" class="text-rose-400 text-[10px] px-2 flex-shrink-0">삭제</button>
            </div>`)}
        </section>
      </main>`);

    $('#code-form', app).addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      try {
        const code = await rpc('admin_create_code', {
          p_type: v.type,
          p_max_uses: v.max_uses ? Number(v.max_uses) : null,
          p_expires_at: v.expires ? new Date(`${v.expires}T23:59:59`).toISOString() : null,
          p_note: v.note,
          p_code: v.code ? v.code.toUpperCase() : null,
        });
        await copyText(code, `코드 ${code}`);
        load();
      } catch (err) { toast(errorText(err), 'error'); }
    });
  }

  try { await load(); } catch (e) { toast(errorText(e), 'error'); }

  return {
    cleanup: delegate(app, {
      ...actions,
      'copy-code': (el) => copyText(el.dataset.code, '코드'),
      revoke: async (el) => {
        if (!confirmAction('이 코드를 폐기할까요?')) return;
        const { error } = await supabase.from('creation_codes').update({ revoked: true }).eq('id', el.dataset.id);
        if (error) toast(errorText(error), 'error'); else load();
      },
      'delete-code': async (el) => {
        if (!confirmAction(`코드 ${el.dataset.code} 를 완전히 삭제할까요? 이 코드로 만든 여행은 그대로 남아요.`)) return;
        try { await rpc('admin_delete_codes', { p_id: el.dataset.id }); toast('삭제했습니다.'); load(); }
        catch (e) { toast(errorText(e), 'error'); }
      },
      'delete-ended': async () => {
        if (!confirmAction('지난 코드(만료·소진·폐기)를 모두 삭제할까요? 이 코드들로 만든 여행은 그대로 남아요.')) return;
        try { const n = await rpc('admin_delete_codes', { p_id: null }); toast(`${n}개를 삭제했습니다.`); load(); }
        catch (e) { toast(errorText(e), 'error'); }
      },
      'ai-grant': async (el) => {
        const id = el.dataset.user;
        let expires = null;
        if (el.dataset.days === 'date') {
          const v = document.getElementById(`ai-date-${id}`)?.value;
          if (!v) { toast('날짜를 먼저 골라주세요.', 'error'); return; }
          expires = new Date(`${v}T23:59:59`).toISOString();
        } else if (el.dataset.days !== 'perm') {
          expires = new Date(Date.now() + Number(el.dataset.days) * 86400000).toISOString();
        }
        try {
          await rpc('admin_set_ai_grant', { p_user: id, p_enabled: true, p_expires_at: expires, p_daily_limit: null });
          toast(expires ? `${day(expires)}까지 허용했어요.` : '영구로 허용했어요.');
          load();
        } catch (e) { toast(errorText(e), 'error'); }
      },
      'ai-off': async (el) => {
        if (!confirmAction('이 사람의 AI 추천 권한을 끌까요?')) return;
        try { await rpc('admin_set_ai_grant', { p_user: el.dataset.user, p_enabled: false }); toast('껐어요.'); load(); }
        catch (e) { toast(errorText(e), 'error'); }
      },
      'ai-limit': async (el) => {
        const v = Number(document.getElementById(`ai-limit-${el.dataset.user}`)?.value);
        if (!Number.isInteger(v) || v < 0 || v > 1000) { toast('0~1000 사이 숫자를 넣어주세요.', 'error'); return; }
        try { await rpc('admin_set_ai_limit', { p_user: el.dataset.user, p_daily_limit: v }); toast(`하루 ${v}회로 바꿨어요.`); load(); }
        catch (e) { toast(errorText(e), 'error'); }
      },
      'ai-dismiss': async (el) => {
        try { await rpc('admin_dismiss_ai_request', { p_user: el.dataset.user }); load(); }
        catch (e) { toast(errorText(e), 'error'); }
      },
      'delete-trip': async (el) => {
        if (!confirmAction(`"${el.dataset.title}" 여행과 모든 데이터를 삭제할까요? 되돌릴 수 없습니다.`)) return;
        const { error } = await supabase.from('trips').delete().eq('id', el.dataset.id);
        if (error) toast(errorText(error), 'error'); else { toast('삭제했습니다.'); load(); }
      },
    }),
  };
}
