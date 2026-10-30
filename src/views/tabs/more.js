import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, copyText, confirmAction } from '../../components/ui.js';
import { rpc, supabase, errorText } from '../../lib/supabase.js';
import { getUser, isAnonymous, linkGoogle } from '../../lib/auth.js';
import { APP_URL } from '../../config.js';
import { navigate } from '../../router.js';
import { color, icon } from '../../lib/safe.js';

const CAT_KINDS = { food: '식당', cafe: '카페', bar: '술집', spot: '명소', shop: '쇼핑', lodging: '숙소', transit: '교통', etc: '기타' };
const CAT_COLORS = ['#f43f5e', '#10b981', '#f59e0b', '#f97316', '#06b6d4', '#eab308', '#c084fc', '#3b82f6', '#94a3b8'];
const CAT_ICONS = ['fa-utensils', 'fa-bowl-food', 'fa-drumstick-bite', 'fa-fish', 'fa-pepper-hot', 'fa-mug-saucer',
  'fa-wine-glass', 'fa-ice-cream', 'fa-landmark', 'fa-tree', 'fa-bag-shopping', 'fa-hotel', 'fa-train-subway', 'fa-star'];

export function mount(root, store) {
  let anonymous = true;
  getUser().then((u) => { anonymous = isAnonymous(u); update(); });

  const inviteUrl = () => (store.invite ? `${APP_URL}#/join/${store.invite.token}` : null);

  function update() {
    const owner = store.isOwner;
    const me = store.me;
    const members = store.activeMembers();
    const customCats = store.list('categories');

    setHTML(root, html`
      <div class="p-4 space-y-3">
        <!-- 초대 링크 -->
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-link text-neon-cyan mr-1"></i>초대 링크</h3>
          <p class="text-[10px] text-slate-400">이 링크를 받은 사람은 누구나 참여해서 편집할 수 있어요.</p>
          <div class="flex gap-1.5">
            <input readonly class="input font-mono text-[10px]" value="${inviteUrl() || '불러오는 중...'}">
            <button data-action="copy-invite" class="btn-ghost flex-shrink-0">복사</button>
            ${navigator.share ? html`<button data-action="share-invite" class="btn-ghost flex-shrink-0"><i class="fa-solid fa-share-nodes"></i></button>` : ''}
          </div>
          ${owner ? html`<button data-action="regen" class="text-[10px] text-amber-300 underline">링크 재발급 (기존 링크는 더 이상 동작하지 않음)</button>` : ''}
        </section>

        <!-- 멤버 -->
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-users text-neon-cyan mr-1"></i>멤버 ${members.length}명</h3>
            <button data-action="add-placeholder" class="text-[10px] text-neon-cyan">+ 동행자 추가</button>
          </div>
          ${members.map((m) => html`
            <div class="flex items-center justify-between p-2 rounded-xl bg-night-950/60">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color(m.color, '#64748b')}"></span>
                <span class="text-xs font-bold text-white truncate">${m.display_name}</span>
                ${m.role === 'owner' ? html`<span class="text-[9px] px-1.5 rounded bg-amber-500/20 text-amber-300 font-bold">owner</span>` : ''}
                ${m.id === me?.id ? html`<span class="text-[9px] px-1.5 rounded bg-neon-cyan/20 text-neon-cyan font-bold">나</span>` : ''}
                ${!m.user_id ? html`<span class="text-[9px] text-slate-500">미연결</span>` : ''}
              </div>
              <div class="flex gap-1">
                ${m.id === me?.id ? html`<button data-action="rename" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300">이름 변경</button>` : ''}
                ${owner && m.role !== 'owner' ? html`
                  <button data-action="member-menu" data-id="${m.id}" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300"><i class="fa-solid fa-ellipsis"></i></button>` : ''}
              </div>
            </div>`)}
        </section>

        <!-- 카테고리 -->
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <div class="flex items-center justify-between">
            <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-tags text-neon-cyan mr-1"></i>커스텀 카테고리</h3>
            ${store.trip.allow_custom_categories ? html`<button data-action="add-cat" class="text-[10px] text-neon-cyan">+ 추가</button>` : ''}
          </div>
          ${store.trip.allow_custom_categories ? html`
            <div class="flex flex-wrap gap-1.5">
              ${customCats.length ? customCats.map((c) => html`
                <button data-action="edit-cat" data-id="${c.id}" class="text-[11px] px-2 py-1 rounded-lg bg-slate-800 border" style="color:${color(c.color)};border-color:${color(c.color)}55">
                  <i class="fa-solid ${icon(c.icon)} text-[10px]"></i> ${c.name}</button>`)
              : html`<p class="text-[11px] text-slate-500">기본 카테고리만 사용 중입니다.</p>`}
            </div>` : html`<p class="text-[11px] text-slate-500">owner 가 커스텀 카테고리를 꺼두었습니다.</p>`}
        </section>

        ${owner ? html`
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-gear text-amber-300 mr-1"></i>여행 설정 (owner)</h3>
          <button data-action="edit-trip" class="btn-ghost w-full py-2.5">여행 정보 수정</button>
          <button data-action="delete-trip" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">여행 삭제</button>
        </section>` : ''}

        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-user-shield text-neon-cyan mr-1"></i>내 계정</h3>
          ${anonymous ? html`
            <p class="text-[10px] text-slate-400 leading-relaxed">지금은 이 브라우저에만 연결된 임시 계정이에요. 브라우저 데이터를 지우면 다시 링크로 들어와야 합니다.
              ${owner ? html`<b class="text-amber-300">owner 는 Google 계정 연결을 권장합니다.</b>` : ''}</p>
            <button data-action="link-google" class="btn-ghost w-full py-2.5"><i class="fa-brands fa-google mr-1"></i>Google 계정 연결</button>`
          : html`<p class="text-[10px] text-emerald-300">Google 계정이 연결되어 있습니다.</p>`}
          ${!owner ? html`<button data-action="leave" class="w-full py-2 rounded-xl text-slate-400 text-[11px]">이 여행에서 나가기</button>` : ''}
        </section>
      </div>`);
  }

  async function run(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await store.sync(); }
    catch (e) { toast(errorText(e), 'error'); }
  }

  const off = delegate(root, {
    'copy-invite': () => inviteUrl() && copyText(inviteUrl(), '초대 링크'),
    'share-invite': () => navigator.share?.({ title: store.trip.title, url: inviteUrl() }).catch(() => {}),
    regen: () => confirmAction('링크를 재발급하면 기존 링크로는 더 이상 참여할 수 없습니다. 계속할까요?')
      && run(() => rpc('regenerate_invite', { p_trip: store.tripId }), '새 링크를 발급했습니다.'),
    rename: () => {
      const name = prompt('새 이름', store.me?.display_name || '');
      if (name?.trim()) run(() => rpc('update_my_name', { p_trip: store.tripId, p_display_name: name.trim() }), '이름을 바꿨습니다.');
    },
    'add-placeholder': () => {
      const name = prompt('동행자 이름 (앱을 쓰지 않는 사람도 결제자로 지정할 수 있어요)');
      if (name?.trim()) run(() => rpc('add_placeholder_member', { p_trip: store.tripId, p_display_name: name.trim() }), '추가했습니다.');
    },
    'member-menu': (el) => openMemberMenu(store, el.dataset.id, run),
    'add-cat': () => openCategoryEditor(store, null),
    'edit-cat': (el) => openCategoryEditor(store, el.dataset.id),
    'edit-trip': () => openTripEditor(store, run),
    'delete-trip': async () => {
      if (!confirmAction(`"${store.trip.title}" 여행과 모든 데이터를 삭제합니다. 되돌릴 수 없어요. 계속할까요?`)) return;
      if (prompt('확인을 위해 여행 이름을 입력하세요') !== store.trip.title) { toast('이름이 일치하지 않습니다.', 'error'); return; }
      const { error } = await supabase.from('trips').delete().eq('id', store.tripId);
      if (error) { toast(errorText(error), 'error'); return; }
      localStorage.removeItem(store.cacheKey); localStorage.removeItem(store.outboxKey);
      toast('삭제했습니다.'); navigate('/');
    },
    'link-google': () => linkGoogle().catch((e) => toast(errorText(e), 'error')),
    leave: () => confirmAction('이 여행에서 나갈까요?')
      && run(async () => { await rpc('leave_trip', { p_trip: store.tripId }); navigate('/'); }, '여행에서 나왔습니다.'),
  });

  update();
  return { update, destroy: off };
}

function openMemberMenu(store, memberId, run) {
  const m = store.member(memberId);
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">${m.display_name}</h3>
    <p class="text-[11px] text-slate-400 mb-3">owner 전용 관리 기능</p>
    <div class="space-y-2">
      ${m.user_id ? html`
        <button data-action="unlink" class="btn-ghost w-full py-2.5 text-left">
          <b>연결 해제</b><span class="block text-[10px] text-slate-400 font-normal">브라우저를 초기화해 접근을 잃은 경우. 같은 링크로 들어와 이 이름을 다시 선택할 수 있게 됩니다.</span></button>
        <button data-action="transfer" class="btn-ghost w-full py-2.5 text-left">
          <b>owner 넘기기</b><span class="block text-[10px] text-slate-400 font-normal">나는 일반 멤버가 됩니다.</span></button>` : ''}
      <button data-action="kick" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold text-left px-3">
        강퇴 + 링크 재발급<span class="block text-[10px] text-rose-300/70 font-normal">지출 기록은 남고, 기존 링크로는 재참여할 수 없게 됩니다.</span></button>
    </div>`, (el) => delegate(el, {
    unlink: () => confirmAction('연결을 해제할까요?') && run(() => rpc('unlink_member', { p_member: memberId }), '연결을 해제했습니다.').then(closeSheet),
    transfer: () => confirmAction(`${m.display_name} 님에게 owner 를 넘길까요?`)
      && run(() => rpc('transfer_owner', { p_member: memberId }), 'owner 를 넘겼습니다.').then(closeSheet),
    kick: () => confirmAction(`${m.display_name} 님을 강퇴하고 링크를 재발급할까요?`)
      && run(async () => {
        await rpc('kick_member', { p_member: memberId });
        await rpc('regenerate_invite', { p_trip: store.tripId });
      }, '강퇴하고 새 링크를 발급했습니다. 남은 멤버에게 새 링크를 공유하세요.').then(closeSheet),
  }));
}

function openTripEditor(store, run) {
  const t = store.trip;
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">여행 정보</h3>
    <form id="trip-form" class="space-y-2.5">
      <div class="grid grid-cols-[1fr_auto] gap-2">
        <div><label class="label">이름</label><input name="title" class="input" required maxlength="80" value="${t.title}"></div>
        <div><label class="label">이모지</label><input name="cover_emoji" class="input w-16 text-center" maxlength="4" value="${t.cover_emoji || ''}"></div>
      </div>
      <div><label class="label">여행지</label><input name="destination" class="input" maxlength="80" value="${t.destination || ''}"></div>
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">시작일</label><input type="date" name="start_date" class="input" value="${t.start_date || ''}"></div>
        <div><label class="label">종료일</label><input type="date" name="end_date" class="input" value="${t.end_date || ''}"></div>
      </div>
      <div><label class="label">현지 시간대</label><input name="timezone" class="input font-mono" value="${t.timezone}"></div>
      <label class="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" name="allow_custom_categories" ${t.allow_custom_categories ? 'checked' : ''} class="accent-cyan-400"> 멤버의 커스텀 카테고리 편집 허용</label>
      <button class="btn-primary">저장</button>
    </form>`, (el) => {
    $('#trip-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
      v.allow_custom_categories = e.target.elements.allow_custom_categories.checked;
      run(async () => {
        const { error } = await supabase.from('trips').update(v).eq('id', store.tripId);
        if (error) throw error;
      }, '저장했습니다.').then(closeSheet);
    });
  });
}

function openCategoryEditor(store, id) {
  const c = id ? store.get('categories', id) : { name: '', kind: 'food', color: CAT_COLORS[0], icon: CAT_ICONS[0] };
  openSheet(html`
    <h3 class="text-base font-black text-white mb-3">${id ? '카테고리 수정' : '새 카테고리'}</h3>
    <form id="cat-form" class="space-y-2.5">
      <div class="grid grid-cols-2 gap-2">
        <div><label class="label">이름 *</label><input name="name" class="input" required maxlength="20" value="${c.name}"></div>
        <div><label class="label">종류</label><select name="kind" class="input">
          ${Object.entries(CAT_KINDS).map(([k, t]) => html`<option value="${k}" ${k === c.kind ? 'selected' : ''}>${t}</option>`)}</select></div>
      </div>
      <div><label class="label">색상</label><div class="flex gap-1.5 flex-wrap">
        ${CAT_COLORS.map((x) => html`<button type="button" data-action="pick-color" data-v="${x}" class="w-7 h-7 rounded-full border-2 ${x === c.color ? 'border-white' : 'border-transparent'}" style="background:${x}"></button>`)}
      </div><input type="hidden" name="color" value="${color(c.color)}"></div>
      <div><label class="label">아이콘</label><div class="flex gap-1.5 flex-wrap">
        ${CAT_ICONS.map((x) => html`<button type="button" data-action="pick-icon" data-v="${x}" class="w-8 h-8 rounded-lg ${x === c.icon ? 'bg-neon-cyan text-night-950' : 'bg-slate-800 text-slate-300'}"><i class="fa-solid ${x} text-xs"></i></button>`)}
      </div><input type="hidden" name="icon" value="${icon(c.icon)}"></div>
      <button class="btn-primary">${id ? '수정 저장' : '추가'}</button>
      ${id ? html`<button type="button" data-action="delete" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">삭제</button>` : ''}
    </form>`, (el) => {
    const form = $('#cat-form', el);
    const pick = (attr, cls) => (b) => {
      form.elements[attr].value = b.dataset.v;
      el.querySelectorAll(`[data-action="pick-${attr}"]`).forEach((x) => {
        const on = x === b;
        cls.on.forEach((k) => x.classList.toggle(k, on));
        cls.off.forEach((k) => x.classList.toggle(k, !on));
      });
    };
    const off = delegate(el, {
      'pick-color': pick('color', { on: ['border-white'], off: ['border-transparent'] }),
      'pick-icon': pick('icon', { on: ['bg-neon-cyan', 'text-night-950'], off: ['bg-slate-800', 'text-slate-300'] }),
      delete: () => {
        if (!confirmAction('삭제할까요? 이 카테고리의 장소는 "카테고리 없음"으로 표시됩니다.')) return;
        store.remove('categories', id); closeSheet();
      },
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(form);
      if (id) store.update('categories', id, v);
      else store.insert('categories', { ...v, sort_order: store.nextSortOrder('categories') });
      closeSheet();
    });
    return off;
  });
}
