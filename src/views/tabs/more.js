import { html, setHTML, delegate, formValues, $ } from '../../lib/dom.js';
import { openSheet, closeSheet, toast, copyText, confirmAction } from '../../components/ui.js';
import { rpc, supabase, errorText } from '../../lib/supabase.js';
import { getUser, isAnonymous, linkGoogle } from '../../lib/auth.js';
import { APP_URL } from '../../config.js';
import { navigate } from '../../router.js';
import { color, icon } from '../../lib/safe.js';
import { openDeviceCodeIssue } from '../../components/account.js';
import { downloadTripMap } from '../../lib/offline-map.js';
import { getPref, setPref, PREF_ANCHOR_NEAR_SORT } from '../../lib/prefs.js';
import { openPlaceImport, openShareCodes } from '../place-import.js';

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

    const groupTitle = (text) => html`<h2 class="text-[11px] font-black text-slate-500 tracking-wider px-1 pt-2">${text}</h2>`;
    const anchorNear = getPref(PREF_ANCHOR_NEAR_SORT);
    const withCoords = store.list('places').filter((p) => p.lat != null).length;
    const geoReviewCount = store.list('places').filter((p) => p.geo_review?.type === 'review').length;
    const geoAutoCount = store.list('places').filter((p) => p.geo_review?.type === 'auto').length;

    setHTML(root, html`
      <div class="p-4 space-y-3">
        ${groupTitle('함께하기')}
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
                ${store.deviceCount(m.id) === 0 ? html`<span class="text-[9px] text-slate-500">미연결</span>`
                  : store.deviceCount(m.id) > 1 ? html`<span class="text-[9px] text-slate-400"><i class="fa-solid fa-laptop-mobile"></i> ${store.deviceCount(m.id)}대</span>` : ''}
              </div>
              <div class="flex gap-1">
                ${m.id === me?.id ? html`<button data-action="rename" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300">이름 변경</button>` : ''}
                ${owner && m.role !== 'owner' ? html`
                  <button data-action="member-menu" data-id="${m.id}" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300"><i class="fa-solid fa-ellipsis"></i></button>` : ''}
              </div>
            </div>`)}
        </section>

        ${groupTitle('지도 · 오프라인')}
        <section class="glass-card p-4 rounded-2xl space-y-2.5">
          <div>
            <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-download text-emerald-300 mr-1"></i>오프라인 지도 저장</h3>
            <p class="text-[10px] text-slate-400 mt-0.5">위치가 있는 장소 ${withCoords}곳 주변 지도를 이 기기에 저장해요. 와이파이에서 출발 전에 한 번 해두세요.</p>
          </div>
          <button data-action="offline-map" class="btn-ghost w-full py-2.5"><i class="fa-solid fa-download mr-1"></i>이 여행 지도 저장하기</button>
          <details class="text-[10px] text-slate-400">
            <summary class="cursor-pointer text-slate-300">출발 전 체크리스트</summary>
            <ol class="list-decimal pl-4 mt-1 space-y-0.5">
              <li>여행 화면의 탭들을 한 번씩 열어 데이터 받아두기</li>
              <li>위의 지도 저장 (지명 글자는 지도를 한 번 둘러봐야 저장돼요)</li>
              <li>홈 화면에 앱 추가 (아이폰: 공유 → 홈 화면에 추가)</li>
            </ol>
          </details>
          <label class="flex items-start gap-2 pt-2 border-t border-white/5 cursor-pointer">
            <input type="checkbox" data-action="anchor-near" ${anchorNear ? 'checked' : ''} class="accent-cyan-400 mt-0.5">
            <span class="text-[11px] text-slate-300">기준점 목록을 지도 중심에서 가까운 순으로 정렬
              <span class="block text-[10px] text-slate-500">여러 도시를 도는 여행에서 유용해요. 이 기기에만 적용돼요.</span></span>
          </label>
        </section>

        ${groupTitle('장소 데이터')}
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
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-copy text-neon-cyan mr-1"></i>장소 가져오기 · 공유</h3>
          <p class="text-[10px] text-slate-400">내 다른 여행이나 공유 코드에서 장소를 골라 이 여행으로 복사해요.</p>
          <div class="grid ${owner ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
            <button data-action="place-import" class="btn-ghost py-2.5"><i class="fa-solid fa-file-import mr-1"></i>가져오기</button>
            ${owner ? html`<button data-action="share-codes" class="btn-ghost py-2.5"><i class="fa-solid fa-share-from-square mr-1"></i>공유 코드</button>` : ''}
          </div>
        </section>
        ${geoReviewCount + geoAutoCount ? html`
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white"><i class="fa-solid fa-location-dot text-amber-300 mr-1"></i>위치 검토</h3>
          <div class="grid grid-cols-2 gap-2">
            <button data-action="geo-review" data-type="review" class="btn-ghost py-2.5 ${geoReviewCount ? 'text-amber-200' : 'opacity-50'}">확인 필요 ${geoReviewCount}곳</button>
            <button data-action="geo-review" data-type="auto" class="btn-ghost py-2.5 ${geoAutoCount ? '' : 'opacity-50'}">자동으로 바뀜 ${geoAutoCount}곳</button>
          </div>
          <p class="text-[10px] text-slate-500">자동으로 바뀐 곳은 구글 좌표가 기존 핀과 300m 이내라 바로 반영한 곳이에요. 비교해 보고 되돌릴 수 있어요.</p>
        </section>` : ''}
        ${owner ? html`
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <h3 class="text-xs font-bold text-white"><i class="fa-brands fa-google text-neon-cyan mr-1"></i>구글 지도 정보</h3>
          <p class="text-[10px] text-slate-400">구글 정보가 없는 등록된 장소에 영업시간, 평점, 정확한 좌표 등을 한 번에 채워요.</p>
          <button data-action="google-bulk" class="btn-ghost w-full py-2.5">등록된 장소 일괄 가져오기</button>
        </section>` : ''}

        ${owner ? html`
        ${groupTitle('여행 관리')}
        <section class="glass-card p-4 rounded-2xl space-y-2">
          <button data-action="edit-trip" class="btn-ghost w-full py-2.5"><i class="fa-solid fa-pen mr-1"></i>여행 정보 수정</button>
          <button data-action="delete-trip" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">여행 삭제</button>
        </section>` : ''}

        ${groupTitle('내 계정')}
        <section class="glass-card p-4 rounded-2xl space-y-2">
          ${anonymous ? html`
            <p class="text-[10px] text-slate-400 leading-relaxed">지금은 이 브라우저에만 연결된 임시 계정이에요. 다른 기기에서도 "${me?.display_name || '나'}"(으)로 쓰려면 둘 중 하나를 선택하세요.
              ${owner ? html`<b class="text-amber-300">owner 는 Google 계정 연결을 권장합니다.</b>` : ''}</p>
            <div class="grid grid-cols-2 gap-2">
              <button data-action="link-google" class="btn-ghost py-2.5"><i class="fa-brands fa-google mr-1"></i>Google 계정 연결</button>
              <button data-action="device-code" class="btn-ghost py-2.5"><i class="fa-solid fa-key mr-1"></i>다른 기기에서도 쓰기</button>
            </div>`
          : html`
            <p class="text-[10px] text-emerald-300 leading-relaxed">Google 계정이 연결되어 있어요. 다른 기기에서도 같은 계정으로 로그인하면 됩니다.</p>
            <button data-action="device-code" class="btn-ghost w-full py-2"><i class="fa-solid fa-key mr-1"></i>로그인 없이 다른 기기 연결 (코드)</button>`}
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
    'google-bulk': () => openGoogleBulk(store),
    'delete-trip': async () => {
      if (!confirmAction(`"${store.trip.title}" 여행과 모든 데이터를 삭제합니다. 되돌릴 수 없어요. 계속할까요?`)) return;
      if (prompt('확인을 위해 여행 이름을 입력하세요') !== store.trip.title) { toast('이름이 일치하지 않습니다.', 'error'); return; }
      const { error } = await supabase.from('trips').delete().eq('id', store.tripId);
      if (error) { toast(errorText(error), 'error'); return; }
      localStorage.removeItem(store.cacheKey); localStorage.removeItem(store.outboxKey);
      toast('삭제했습니다.'); navigate('/');
    },
    'link-google': () => linkGoogle().catch((e) => toast(errorText(e), 'error')),
    'device-code': () => openDeviceCodeIssue(store.tripId),
    'place-import': () => openPlaceImport(store),
    'share-codes': () => openShareCodes(store),
    'geo-review': async (el) => {
      const { openGeoReview } = await import('./places.js');
      openGeoReview(store, el.dataset.type, { onDone: () => closeSheet() });
    },
    'anchor-near': (el) => {
      setPref(PREF_ANCHOR_NEAR_SORT, el.checked);
      toast(el.checked ? '장소 탭의 기준점 목록을 지도 중심에서 가까운 순으로 보여줘요.' : '기준점 목록을 등록 순서로 보여줘요.');
    },
    'offline-map': async (btn) => {
      if (btn.dataset.busy) return;
      if (!navigator.onLine) { toast('온라인 상태에서 받아주세요.', 'error'); return; }
      const points = store.list('places').filter((p) => p.lat != null);
      if (!points.length) { toast('위치가 등록된 장소가 없어요.', 'error'); return; }
      if (!confirmAction(`등록된 장소 ${points.length}곳 주변 지도를 오프라인용으로 저장할까요?\n(와이파이 환경을 권장해요)`)) return;
      btn.dataset.busy = '1';
      const label = btn.innerHTML;
      try {
        const r = await downloadTripMap(points, (done, total) => { btn.textContent = `저장 중... ${Math.floor((done / total) * 100)}%`; });
        toast(`지도 ${r.total - r.failed}장을 저장했어요.${r.failed ? ` (실패 ${r.failed})` : ''}`);
      } catch (e) {
        toast(e.message, 'error');
      } finally {
        delete btn.dataset.busy;
        btn.innerHTML = label;
      }
    },
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
      ${store.deviceCount(memberId) > 0 ? html`
        <button data-action="unlink" class="btn-ghost w-full py-2.5 text-left">
          <b>연결 해제</b><span class="block text-[10px] text-slate-400 font-normal">브라우저를 초기화해 접근을 잃은 경우. 이 이름에 연결된 모든 기기가 끊기고, 같은 링크로 들어와 이 이름을 다시 선택할 수 있게 됩니다.</span></button>
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

// =====================================================================
// 등록된 장소에 구글 정보 일괄 반영 (owner)
//  - 아직 구글 정보가 없는 장소만 대상 (장소당 검색 1건 + 상세 1건)
//  - 이름·소개처럼 직접 쓴 내용은 유지, 빈 칸과 구글 전용 칸만 채움
//  - 좌표가 기존 핀과 멀면 바꾸지 않고 "확인 필요" 목록에 표시
// =====================================================================
async function openGoogleBulk(store) {
  // 장소 탭 모듈은 지도 라이브러리를 포함해 크므로 필요할 때만 불러옴
  const { refreshFromGoogle, openPlaceDetail, openGeoReview } = await import('./places.js');
  const targets = store.list('places').filter((p) => !p.google_place_id);
  if (!targets.length) { toast('모든 장소에 이미 구글 정보가 있어요.'); return; }
  if (!navigator.onLine) { toast('온라인 상태에서 실행해 주세요.', 'error'); return; }

  let quota = null;
  try { quota = await rpc('places_quota_status'); } catch {}
  const left = quota ? Math.max(0, quota.limit - Math.max(quota.details, quota.search)) : null;
  const need = targets.length;

  openSheet(html`
    <h3 class="text-base font-black text-white mb-1">구글 정보 일괄 가져오기</h3>
    <div class="text-[11px] text-slate-300 leading-relaxed space-y-1 mb-3">
      <p>구글 정보가 없는 장소 <b class="text-white">${need}곳</b>에 영업시간, 평점, 폐업 여부, 정확한 좌표 등을 채워요.</p>
      <p class="text-slate-400">이름·소개·메뉴처럼 직접 쓴 내용은 그대로 두고, 빈 칸만 채워요.</p>
      <p class="text-slate-400">구글 분당 한도 때문에 장소당 약 3초씩 걸려요. (${need}곳 ≈ ${Math.ceil(need * 3.5 / 60)}분)</p>
      ${left != null ? html`<p class="text-slate-400">이번 달 남은 조회: <b class="${left < need ? 'text-amber-300' : 'text-emerald-300'}">${left}건</b> / ${quota.limit}건 (장소당 2건)</p>` : ''}
      ${left != null && left < need ? html`<p class="text-amber-300">남은 한도만큼만 처리하고 멈춰요.</p>` : ''}
    </div>
    <div id="bulk-progress" class="hidden mb-3">
      <div class="w-full h-2 rounded-full bg-slate-800 overflow-hidden"><div id="bulk-bar" class="h-full bg-neon-cyan transition-all" style="width:0%"></div></div>
      <p id="bulk-text" class="text-[11px] text-slate-400 mt-1"></p>
    </div>
    <div id="bulk-result" class="space-y-1.5"></div>
    <button data-action="start" class="btn-primary mt-2">시작하기</button>
  `, (el) => {
    let stopped = false;
    const off = delegate(el, {
      start: async (b) => {
        b.disabled = true; b.textContent = '진행 중... (창을 닫으면 멈춰요)';
        $('#bulk-progress', el).classList.remove('hidden');
        const result = { ok: 0, auto: 0, review: [], notFound: [], failed: [] };
        let i = 0;
        for (const p of targets) {
          if (stopped) break;
          i++;
          $('#bulk-text', el).textContent = `${i} / ${need} · ${p.name}`;
          $('#bulk-bar', el).style.width = `${Math.round((i / need) * 100)}%`;
          let stop = false;
          for (let attempt = 1; attempt <= 3 && !stopped; attempt++) {
            try {
              const r = await refreshFromGoogle(store, store.get('places', p.id) || p);
              if (store.get('places', p.id)?.geo_review?.type === 'auto') result.auto++;
              if (r.review) result.review.push({ id: p.id, name: p.name, distance: r.review.distance, gName: r.place.name });
              else result.ok++;
              break;
            } catch (e) {
              // 구글 분당 한도: 1분 기다렸다가 같은 장소를 다시 시도
              if (e.code === 'PLACES_RATE' && attempt < 3) {
                for (let sec = 60; sec > 0 && !stopped; sec--) {
                  $('#bulk-text', el).textContent = `${i} / ${need} · 구글 분당 한도로 잠시 대기 중 (${sec}초)`;
                  await new Promise((r) => setTimeout(r, 1000));
                }
                continue;
              }
              if (e.code === 'PLACES_LIMIT') { result.failed.push({ name: '이번 달 한도 도달로 중단', id: null }); stop = true; }
              else if (e.code === 'NOT_FOUND') result.notFound.push({ id: p.id, name: p.name });
              else result.failed.push({ id: p.id, name: p.name, msg: e.message });
              if (e.code === 'OFFLINE') stop = true;
              break;
            }
          }
          if (stop) break;
          // 장소당 검색 1건 + 상세 1건 → 3초 간격이면 분당 각 20건 (구글 분당 한도 30 안쪽)
          await new Promise((r) => setTimeout(r, 3000));
        }
        const row = (x, note) => html`
          <button data-action="open" data-id="${x.id || ''}" class="w-full text-left text-[11px] px-2 py-1.5 rounded-lg bg-slate-800/80 text-slate-200">
            ${x.name}${note ? html` <span class="text-slate-400">· ${note}</span>` : ''}</button>`;
        setHTML($('#bulk-result', el), html`
          <p class="text-xs text-emerald-300 font-bold">완료 ${result.ok}곳</p>
          ${result.review.length ? html`<p class="text-xs text-amber-300 font-bold mt-2">확인 필요 ${result.review.length}곳 (구글 위치가 기존 핀과 멀어 좌표를 바꾸지 않음)</p>
            <button data-action="review-now" data-type="review" class="w-full py-2 rounded-xl bg-amber-500/20 text-amber-100 text-[11px] font-bold border border-amber-500/40">지도에서 비교하며 검토하기</button>
            <p class="text-[10px] text-slate-500">나중에 장소 탭 위 배너나 설정 → 위치 검토에서도 이어서 볼 수 있어요.</p>` : ''}
          ${result.auto ? html`<p class="text-[11px] text-slate-400 mt-2">구글 좌표로 자동 조정 ${result.auto}곳 · <button data-action="review-now" data-type="auto" class="text-neon-cyan underline">확인하기</button></p>` : ''}
          ${result.notFound.length ? html`<p class="text-xs text-slate-300 font-bold mt-2">구글에서 찾지 못함 ${result.notFound.length}곳</p>
            ${result.notFound.map((x) => row(x, '장소 수정에서 링크를 넣어 다시 시도'))}` : ''}
          ${result.failed.length ? html`<p class="text-xs text-rose-300 font-bold mt-2">실패 ${result.failed.length}건</p>
            ${result.failed.map((x) => row(x, x.msg || ''))}` : ''}`);
        b.textContent = '완료';
        $('#bulk-text', el).textContent = `${i} / ${need} 처리`;
      },
      open: (x) => { if (x.dataset.id) openPlaceDetail(store, x.dataset.id, null); },
      'review-now': (x) => openGeoReview(store, x.dataset.type),
    });
    return () => { stopped = true; off(); };
  });
}

