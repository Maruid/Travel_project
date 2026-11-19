// =====================================================================
// 관리자 보기의 "관리" 탭 (설정 탭 자리, 읽기 전용)
//   여행 정보 · 멤버 · 데이터 양 · 여행 삭제(관리자). 고치는 기능은 없음
// =====================================================================
import { html, setHTML, delegate } from '../../lib/dom.js';
import { toast, confirmAction } from '../../components/ui.js';
import { supabase, errorText } from '../../lib/supabase.js';
import { navigate } from '../../router.js';
import { color } from '../../lib/safe.js';
import { shortDateRange } from '../../lib/format.js';

const ago = (ts) => {
  if (!ts) return '없음';
  const m = Math.round((Date.now() - new Date(ts)) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  if (m < 1440) return `${Math.round(m / 60)}시간 전`;
  return `${Math.round(m / 1440)}일 전`;
};

export function mount(root, store) {
  function update() {
    const t = store.trip;
    const members = store.activeMembers();
    const lastSeen = members.map((m) => m.last_seen_at).filter(Boolean).sort().pop();
    const counts = [
      ['장소', store.list('places').length], ['일정', store.list('itinerary_items').length],
      ['가이드', store.list('guides').length], ['지출', store.list('expenses').length],
      ['할 일', store.list('todos').length], ['사진', store.list('trip_images').length],
    ];
    setHTML(root, html`
      <div class="p-4 space-y-3">
        <section class="glass-card rounded-2xl p-4 flex items-center gap-3">
          <span class="text-3xl leading-none flex-shrink-0">${t.cover_emoji || '✈️'}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-black text-white truncate">${t.title}</p>
            <p class="text-[10px] text-slate-400 truncate">${[t.destination, shortDateRange(t.start_date, t.end_date), t.timezone].filter(Boolean).join(' · ')}</p>
          </div>
        </section>
        <p class="text-[10px] text-amber-200/80 px-1"><i class="fa-solid fa-user-shield mr-1"></i>관리자 보기는 읽기 전용이에요. 고치려면 초대 링크로 참여해야 해요. 열어 봐도 최근 활동은 바뀌지 않아요.</p>

        <h2 class="text-[11px] font-black text-slate-500 tracking-wider px-1 pt-2">데이터</h2>
        <section class="glass-card rounded-2xl p-3 grid grid-cols-3 gap-2">
          ${counts.map(([k, v]) => html`<div class="text-center py-1">
            <span class="block text-base font-black font-mono text-white">${v}</span>
            <span class="block text-[10px] text-slate-400">${k}</span></div>`)}
        </section>
        <p class="text-[10px] text-slate-500 px-1">만든 날 ${String(t.created_at || '').slice(0, 10) || '-'} · 최근 활동 ${ago(lastSeen)}</p>

        <h2 class="text-[11px] font-black text-slate-500 tracking-wider px-1 pt-2">멤버 ${members.length}명</h2>
        <section class="set-group">
          ${members.map((m) => html`
            <div class="flex items-center justify-between gap-2 px-3.5 py-2.5">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color(m.color, '#64748b')}"></span>
                <span class="text-xs font-bold text-white truncate">${m.display_name}</span>
                ${m.role === 'owner' ? html`<span class="text-[9px] px-1.5 rounded bg-amber-500/20 text-amber-300 font-bold">owner</span>` : ''}
                ${store.deviceCount(m.id) === 0 ? html`<span class="text-[9px] text-slate-500">미연결</span>` : ''}
              </div>
              <span class="text-[10px] text-slate-500 flex-shrink-0">${ago(m.last_seen_at)}</span>
            </div>`)}
        </section>

        <div class="pt-3">
          <button data-action="admin-delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">여행 삭제 (관리자)</button>
        </div>
      </div>`);
  }

  const off = delegate(root, {
    'admin-delete': async () => {
      const title = store.trip.title;
      if (!confirmAction(`"${title}" 여행과 모든 데이터를 삭제할까요? 되돌릴 수 없어요.`)) return;
      if (prompt('확인을 위해 여행 이름을 입력하세요') !== title) { toast('이름이 일치하지 않습니다.', 'error'); return; }
      const { removeTripFiles } = await import('../../lib/images.js');
      await removeTripFiles(store.tripId, store.list('trip_images', { includeDeleted: true }));
      const { error } = await supabase.from('trips').delete().eq('id', store.tripId);
      if (error) { toast(errorText(error), 'error'); return; }
      toast('삭제했습니다.');
      navigate('/admin', { replace: true });
    },
  });

  update();
  return { update, destroy: off };
}
