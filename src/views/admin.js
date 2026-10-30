import { html, setHTML, delegate, formValues, $ } from '../lib/dom.js';
import { getUser, isAnonymous, signInWithGoogle, signOut } from '../lib/auth.js';
import { rpc, supabase, errorText } from '../lib/supabase.js';
import { spinner, toast, copyText, confirmAction, emptyCard } from '../components/ui.js';
import { navigate } from '../router.js';

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const ago = (ts) => {
  if (!ts) return '-';
  const d = (Date.now() - new Date(ts).getTime()) / 86400000;
  return d < 1 ? '오늘' : `${Math.floor(d)}일 전`;
};

export async function render(app) {
  setHTML(app, spinner());
  const user = await getUser();

  const header = html`
    <header class="px-4 py-3 glass-nav sticky top-0 z-40 flex items-center justify-between">
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
    const [stats, trips, codes] = await Promise.all([
      rpc('admin_stats'),
      rpc('admin_list_trips'),
      supabase.from('creation_codes').select('*').order('created_at', { ascending: false }).then((r) => {
        if (r.error) throw r.error; return r.data;
      }),
    ]);

    setHTML(app, html`${header}
      <main class="p-4 space-y-3 pb-10">
        <section class="grid grid-cols-3 gap-2">
          ${[['여행', stats.trips], ['오늘 활성', stats.active_1d], ['7일 활성', stats.active_7d],
             ['30일 활성', stats.active_30d], ['연결된 멤버', stats.members], ['DB 용량', mb(stats.db_size_bytes)]]
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
            ${codes.length ? codes.map((c) => {
              const usable = !c.revoked && (!c.expires_at || new Date(c.expires_at) > new Date()) && (c.max_uses == null || c.used_count < c.max_uses);
              return html`<div class="flex items-center justify-between p-2 rounded-xl bg-night-950/60 text-[11px]">
                <div class="min-w-0">
                  <button data-action="copy-code" data-code="${c.code}" class="font-mono font-bold ${usable ? 'text-neon-cyan' : 'text-slate-500 line-through'}">${c.code}</button>
                  <span class="text-[10px] text-slate-400 block truncate">${c.type === 'one_time' ? '일회성' : '영구'} · ${c.used_count}/${c.max_uses ?? '∞'}회 ${c.expires_at ? `· ~${c.expires_at.slice(0, 10)}` : ''} ${c.note ? `· ${c.note}` : ''}</span>
                </div>
                ${!c.revoked ? html`<button data-action="revoke" data-id="${c.id}" class="text-rose-400 text-[10px] px-2 flex-shrink-0">폐기</button>` : ''}
              </div>`;
            }) : emptyCard('발급된 코드가 없습니다.')}
          </div>
        </section>

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
      'delete-trip': async (el) => {
        if (!confirmAction(`"${el.dataset.title}" 여행과 모든 데이터를 삭제할까요? 되돌릴 수 없습니다.`)) return;
        const { error } = await supabase.from('trips').delete().eq('id', el.dataset.id);
        if (error) toast(errorText(error), 'error'); else { toast('삭제했습니다.'); load(); }
      },
    }),
  };
}
