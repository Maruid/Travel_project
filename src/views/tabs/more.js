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
import { canShare, shareContent } from '../../lib/native.js';
import { appSectionHtml, appSectionActions } from '../../components/app-settings.js';
import { openHowTo } from '../../components/how-to.js';
import { shortDateRange } from '../../lib/format.js';

const CAT_KINDS = { food: '식당', cafe: '카페', bar: '술집', spot: '명소', shop: '쇼핑', lodging: '숙소', transit: '교통', etc: '기타' };
const CAT_COLORS = ['#f43f5e', '#10b981', '#f59e0b', '#f97316', '#06b6d4', '#eab308', '#c084fc', '#3b82f6', '#94a3b8'];
const CAT_ICONS = ['fa-utensils', 'fa-bowl-food', 'fa-drumstick-bite', 'fa-fish', 'fa-pepper-hot', 'fa-mug-saucer',
  'fa-wine-glass', 'fa-ice-cream', 'fa-landmark', 'fa-tree', 'fa-bag-shopping', 'fa-hotel', 'fa-train-subway', 'fa-star'];

// ---------- 설정 화면 공통 모양: 묶음 제목 + 한 줄 행 (아이콘 · 제목 · 설명 · 오른쪽 값) ----------
const CHEVRON = html`<i class="fa-solid fa-chevron-right text-[10px] text-slate-500 flex-shrink-0"></i>`;
const TINT = { cyan: 'bg-neon-cyan/15 text-neon-cyan', amber: 'bg-amber-500/15 text-amber-300', green: 'bg-emerald-500/15 text-emerald-300' };
const groupTitle = (text) => html`<h2 class="text-[11px] font-black text-slate-500 tracking-wider px-1 pt-2">${text}</h2>`;

// action 이 없으면 누를 수 없는 줄, nested 면 안에 버튼이 있어서 <div role="button"> 으로 그림
function row({ action, nested, ic, tint = TINT.cyan, title, sub, right = CHEVRON, dim = false }) {
  const inner = html`
    <span class="set-ico ${tint}"><i class="${ic}"></i></span>
    <span class="flex-1 min-w-0"><span class="set-title">${title}</span>${sub ? html`<span class="set-sub">${sub}</span>` : ''}</span>
    ${right}`;
  const cls = `set-row${dim ? ' opacity-50' : ''}`;
  if (!action) return html`<div class="${cls}">${inner}</div>`;
  if (nested) return html`<div role="button" tabindex="0" data-action="${action}" class="${cls}">${inner}</div>`;
  return html`<button data-action="${action}" class="${cls}">${inner}</button>`;
}

export function mount(root, store) {
  let anonymous = true;
  getUser().then((u) => { anonymous = isAnonymous(u); update(); });

  const inviteUrl = () => (store.invite ? `${APP_URL}#/join/${store.invite.token}` : null);
  const viewUrl = () => (store.viewLink?.token ? `${APP_URL}#/view/${store.viewLink.token}` : null);

  function update() {
    const owner = store.isOwner;
    const me = store.me;
    const t = store.trip;
    const members = store.activeMembers();
    const customCats = store.list('categories');
    const allowCats = !!t.allow_custom_categories;
    const anchorNear = getPref(PREF_ANCHOR_NEAR_SORT);
    const withCoords = store.list('places').filter((p) => p.lat != null).length;
    const geoReviewCount = store.list('places').filter((p) => p.geo_review?.type === 'review').length;
    const geoAutoCount = store.list('places').filter((p) => p.geo_review?.type === 'auto').length;
    const viewOn = !!store.viewLink?.enabled;

    setHTML(root, html`
      <div class="p-4 space-y-3">
        <section class="glass-card rounded-2xl p-4 flex items-center gap-3">
          <span class="text-3xl leading-none flex-shrink-0">${t.cover_emoji || '✈️'}</span>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-black text-white truncate">${t.title}</p>
            <p class="text-[10px] text-slate-400 truncate">${[t.destination, shortDateRange(t.start_date, t.end_date), `멤버 ${members.length}명`].filter(Boolean).join(' · ')}</p>
          </div>
          ${owner ? html`<button data-action="edit-trip" class="btn-ghost flex-shrink-0"><i class="fa-solid fa-pen mr-1"></i>수정</button>` : ''}
        </section>

        ${groupTitle('함께하기')}
        <section class="set-group">
          ${row({ action: 'invite', nested: true, ic: 'fa-solid fa-link', title: '초대 링크', sub: '받은 사람은 누구나 참여해서 편집할 수 있어요',
            right: html`<span class="flex gap-1 flex-shrink-0">
              <button data-action="copy-invite" class="btn-ghost">복사</button>
              ${canShare() ? html`<button data-action="share-invite" class="btn-ghost"><i class="fa-solid fa-share-nodes"></i></button>` : ''}</span>` })}
          ${row({ action: 'view-link', ic: 'fa-solid fa-eye', title: '보기 전용 링크', sub: '로그인 없이 일정 · 장소 · 가이드만 봐요',
            right: html`<span class="text-[10px] font-bold ${viewOn ? 'text-emerald-300' : 'text-slate-500'}">${viewOn ? '켜짐' : '꺼짐'}</span>${CHEVRON}` })}
        </section>
        <section class="set-group">
          <div class="set-row">
            <span class="set-ico ${TINT.cyan}"><i class="fa-solid fa-users"></i></span>
            <span class="flex-1 set-title">멤버 ${members.length}명</span>
            <button data-action="add-placeholder" class="text-[10px] text-neon-cyan font-bold">+ 동행자 추가</button>
          </div>
          ${members.map((m) => html`
            <div class="flex items-center justify-between gap-2 px-3.5 py-2.5">
              <div class="flex items-center gap-2 min-w-0">
                <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${color(m.color, '#64748b')}"></span>
                <span class="text-xs font-bold text-white truncate">${m.display_name}</span>
                ${m.role === 'owner' ? html`<span class="text-[9px] px-1.5 rounded bg-amber-500/20 text-amber-300 font-bold">owner</span>` : ''}
                ${m.id === me?.id ? html`<span class="text-[9px] px-1.5 rounded bg-neon-cyan/20 text-neon-cyan font-bold">나</span>` : ''}
                ${store.deviceCount(m.id) === 0 ? html`<span class="text-[9px] text-slate-500">미연결</span>`
                  : store.deviceCount(m.id) > 1 ? html`<span class="text-[9px] text-slate-400"><i class="fa-solid fa-mobile-screen-button"></i> ${store.deviceCount(m.id)}대</span>` : ''}
              </div>
              <div class="flex gap-1 flex-shrink-0">
                ${m.id === me?.id ? html`<button data-action="rename" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300">이름 변경</button>` : ''}
                ${owner && m.role !== 'owner' ? html`
                  <button data-action="member-menu" data-id="${m.id}" class="text-[10px] px-2 py-1 rounded bg-slate-800 text-slate-300"><i class="fa-solid fa-ellipsis"></i></button>` : ''}
              </div>
            </div>`)}
        </section>

        ${groupTitle('장소')}
        <section class="set-group">
          ${row({ action: 'categories', ic: 'fa-solid fa-tags', title: '카테고리',
            sub: !allowCats ? '직접 만들기 꺼짐' : customCats.length ? `기본 + 직접 만든 ${customCats.length}개` : '기본 카테고리만 쓰는 중' })}
          ${row({ action: 'place-import', ic: 'fa-solid fa-file-import', title: '장소 가져오기', sub: '내 다른 여행이나 공유 코드에서 골라 복사해요' })}
          ${owner ? row({ action: 'share-codes', ic: 'fa-solid fa-share-from-square', title: '장소 공유 코드', sub: '이 여행 장소를 다른 여행에서 가져갈 수 있게 해요' }) : ''}
          ${row({ action: 'geo', ic: 'fa-solid fa-location-dot', tint: TINT.amber, title: '위치 검토', dim: !(geoReviewCount + geoAutoCount),
            sub: geoReviewCount + geoAutoCount ? `확인 필요 ${geoReviewCount}곳 · 자동으로 바뀜 ${geoAutoCount}곳` : '검토할 장소가 없어요',
            right: geoReviewCount ? html`<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/25 text-amber-200 font-black">${geoReviewCount}</span>${CHEVRON}` : CHEVRON })}
          ${owner ? row({ action: 'google-bulk', ic: 'fa-brands fa-google', title: '구글 정보 일괄 채우기', sub: '구글 정보가 없는 장소에 영업시간 · 평점 · 좌표를 채워요' }) : ''}
        </section>

        ${groupTitle('이 기기')}
        <section class="set-group">
          ${row({ ic: 'fa-solid fa-download', tint: TINT.green, title: '오프라인 지도', sub: `장소 ${withCoords}곳 주변 · 와이파이에서 출발 전에 한 번`,
            right: html`<button data-action="offline-map" class="btn-ghost flex-shrink-0 whitespace-nowrap">저장</button>` })}
          <label class="set-row cursor-pointer">
            <span class="set-ico ${TINT.cyan}"><i class="fa-solid fa-arrow-down-short-wide"></i></span>
            <span class="flex-1 min-w-0"><span class="set-title">기준점 가까운 순</span>
              <span class="set-sub">장소 탭 기준점 목록을 지도 중심에서 가까운 순으로</span></span>
            <input type="checkbox" data-action="anchor-near" ${anchorNear ? 'checked' : ''} class="accent-cyan-400 w-4 h-4 flex-shrink-0">
          </label>
        </section>
        <section class="glass-card p-4 rounded-2xl space-y-2">
          ${appSectionHtml()}
        </section>

        ${groupTitle('계정')}
        <section class="set-group">
          ${anonymous
            ? row({ action: 'link-google', ic: 'fa-brands fa-google', title: 'Google 계정 연결',
                sub: owner ? 'owner 는 연결을 권장해요. 기기를 바꿔도 이어서 써요' : `다른 기기에서도 "${me?.display_name || '나'}"(으)로 쓸 수 있어요` })
            : row({ ic: 'fa-brands fa-google', tint: TINT.green, title: 'Google 계정 연결됨', sub: '다른 기기에서도 같은 계정으로 로그인하면 돼요',
                right: html`<i class="fa-solid fa-check text-emerald-300 text-xs"></i>` })}
          ${row({ action: 'device-code', ic: 'fa-solid fa-key', title: '다른 기기 연결 코드', sub: '로그인 없이 코드로 다른 기기에서 이 여행을 열어요' })}
          ${row({ action: 'how-to', ic: 'fa-solid fa-book-open', title: '사용 방법', sub: '장소 · 일정 · 가이드 · 가계부 · 할 일 · 오프라인' })}
        </section>

        <div class="pt-3">
          ${owner
            ? html`<button data-action="delete-trip" class="w-full py-2.5 rounded-xl bg-rose-500/10 text-rose-300 border border-rose-500/30 text-xs font-bold">여행 삭제</button>`
            : html`<button data-action="leave" class="w-full py-2.5 rounded-xl text-rose-300/80 border border-rose-500/20 text-xs font-bold">이 여행에서 나가기</button>`}
        </div>
      </div>`);
  }

  // 보기 전용 링크 켜기 · 끄기 · 다시 만들기 (owner, migration_011)
  async function setViewLink(enabled, regenerate, checkbox = null) {
    try {
      store.viewLink = await rpc('set_view_link', { p_trip: store.tripId, p_enabled: enabled, p_regenerate: regenerate });
      store.saveCache();
      toast(regenerate ? '새 링크를 만들었어요.' : enabled ? '보기 전용 링크를 켰어요.' : '보기 전용 링크를 껐어요. 이제 링크로 열 수 없어요.');
      update();
    } catch (e) {
      if (checkbox) checkbox.checked = !enabled;
      toast(errorText(e), 'error');
    }
  }

  async function run(fn, okMsg) {
    try { await fn(); if (okMsg) toast(okMsg); await store.sync(); }
    catch (e) { toast(errorText(e), 'error'); }
  }

  // 시트 하나를 draw() 로 다시 그릴 수 있게 열기 (링크 재발급 · 켜기처럼 시트 안에서 값이 바뀌는 경우)
  function openLiveSheet(body, actions) {
    openSheet(html`<div data-live></div>`, (el) => {
      const box = el.querySelector('[data-live]');
      const draw = () => setHTML(box, body());
      draw();
      return delegate(el, actions(draw));
    });
  }

  const linkBox = (url, copy, share) => html`
    <div class="flex gap-1.5">
      <input readonly class="input font-mono text-[10px]" value="${url || '불러오는 중...'}">
      <button data-action="${copy}" class="btn-ghost flex-shrink-0">복사</button>
      ${canShare() ? html`<button data-action="${share}" class="btn-ghost flex-shrink-0"><i class="fa-solid fa-share-nodes"></i></button>` : ''}
    </div>`;

  const openInviteSheet = () => openLiveSheet(() => html`
    <h3 class="text-base font-black text-white mb-1"><i class="fa-solid fa-link text-neon-cyan mr-1"></i>초대 링크</h3>
    <p class="text-[11px] text-slate-400 mb-3">이 링크를 받은 사람은 누구나 참여해서 편집할 수 있어요.</p>
    ${linkBox(inviteUrl(), 'copy-invite', 'share-invite')}
    ${store.isOwner ? html`<button data-action="regen" class="mt-3 text-[11px] text-amber-300 underline">링크 재발급 (기존 링크는 더 이상 동작하지 않아요)</button>` : ''}`,
  (draw) => ({
    'copy-invite': () => inviteUrl() && copyText(inviteUrl(), '초대 링크'),
    'share-invite': () => shareContent({ title: store.trip.title, url: inviteUrl() }),
    regen: () => confirmAction('링크를 재발급하면 기존 링크로는 더 이상 참여할 수 없습니다. 계속할까요?')
      && run(() => rpc('regenerate_invite', { p_trip: store.tripId }), '새 링크를 발급했습니다.').then(draw),
  }));

  const openViewLinkSheet = () => openLiveSheet(() => {
    const on = !!store.viewLink?.enabled;
    return html`
      <div class="flex items-center justify-between gap-2 mb-1">
        <h3 class="text-base font-black text-white"><i class="fa-solid fa-eye text-neon-cyan mr-1"></i>보기 전용 링크</h3>
        ${store.isOwner ? html`<label class="flex items-center gap-1.5 text-[11px] text-slate-300">
          <input type="checkbox" data-action="view-toggle" ${on ? 'checked' : ''} class="accent-cyan-400 w-4 h-4"> 켜기</label>`
          : html`<span class="text-[10px] font-bold ${on ? 'text-emerald-300' : 'text-slate-500'}">${on ? '켜짐' : '꺼짐'}</span>`}
      </div>
      <p class="text-[11px] text-slate-400 mb-3">로그인 없이 일정 · 장소 · 가이드만 볼 수 있어요. 가계부 · 할 일 · 멤버는 보이지 않고, 고칠 수 없어요. 부모님께 일정 공유할 때 좋아요.</p>
      ${on ? html`${linkBox(viewUrl(), 'copy-view', 'share-view')}
        ${store.isOwner ? html`<button data-action="view-regen" class="mt-3 text-[11px] text-amber-300 underline">링크 다시 만들기 (기존 링크는 더 이상 열리지 않아요)</button>` : ''}`
        : store.isOwner ? '' : html`<p class="text-[11px] text-slate-500">여행 관리자(owner)가 켤 수 있어요.</p>`}`;
  }, (draw) => ({
    'copy-view': () => viewUrl() && copyText(viewUrl(), '보기 전용 링크'),
    'share-view': () => shareContent({ title: `${store.trip.title} 일정`, url: viewUrl() }),
    'view-toggle': (el) => setViewLink(el.checked, false, el).then(draw),
    'view-regen': () => confirmAction('새 링크를 만들면 지금 링크로는 더 이상 볼 수 없어요. 계속할까요?') && setViewLink(true, true).then(draw),
  }));

  // 카테고리: 직접 만든 카테고리 목록 + (owner) 직접 만들기 허용 켜기 · 끄기
  const openCategories = () => openLiveSheet(() => {
    const allow = !!store.trip.allow_custom_categories;
    const cats = store.list('categories');
    return html`
      <div class="flex items-center justify-between mb-1">
        <h3 class="text-base font-black text-white"><i class="fa-solid fa-tags text-neon-cyan mr-1"></i>카테고리</h3>
        ${allow ? html`<button data-action="add-cat" class="text-[11px] text-neon-cyan font-bold">+ 추가</button>` : ''}
      </div>
      <p class="text-[11px] text-slate-400 mb-3">기본 카테고리(식당 · 카페 · 명소 등)에 더해 이 여행에서 쓸 카테고리를 만들어요.</p>
      ${allow ? html`
        <div class="flex flex-wrap gap-1.5">
          ${cats.length ? cats.map((c) => html`
            <button data-action="edit-cat" data-id="${c.id}" class="text-[11px] px-2 py-1 rounded-lg bg-slate-800 border" style="color:${color(c.color)};border-color:${color(c.color)}55">
              <i class="fa-solid ${icon(c.icon)} text-[10px]"></i> ${c.name}</button>`)
          : html`<p class="text-[11px] text-slate-500">아직 직접 만든 카테고리가 없어요.</p>`}
        </div>` : html`<p class="text-[11px] text-slate-500">${store.isOwner ? '직접 만들기가 꺼져 있어요.' : 'owner 가 직접 만들기를 꺼두었어요.'}</p>`}
      ${store.isOwner ? html`
        <label class="flex items-start gap-2 mt-3 pt-3 border-t border-white/5 cursor-pointer">
          <input type="checkbox" data-action="allow-cats" ${allow ? 'checked' : ''} class="accent-cyan-400 mt-0.5 w-4 h-4">
          <span class="text-[11px] text-slate-300">카테고리 직접 만들기 허용
            <span class="block text-[10px] text-slate-500">끄면 모든 멤버가 기본 카테고리만 써요.</span></span>
        </label>` : ''}`;
  }, (draw) => ({
    'add-cat': () => openCategoryEditor(store, null),
    'edit-cat': (el) => openCategoryEditor(store, el.dataset.id),
    'allow-cats': (el) => run(async () => {
      const { error } = await supabase.from('trips').update({ allow_custom_categories: el.checked }).eq('id', store.tripId);
      if (error) throw error;
    }, el.checked ? '카테고리 직접 만들기를 켰어요.' : '카테고리 직접 만들기를 껐어요.').then(draw),
  }));

  // 위치 검토: 한 종류만 있으면 바로 열고, 둘 다 있으면 고르기
  async function openGeo() {
    const places = store.list('places');
    const review = places.filter((p) => p.geo_review?.type === 'review').length;
    const auto = places.filter((p) => p.geo_review?.type === 'auto').length;
    if (!review && !auto) { toast('검토할 장소가 없어요.'); return; }
    const { openGeoReview } = await import('./places.js');
    const go = (type) => openGeoReview(store, type, { onDone: () => closeSheet() });
    if (!review || !auto) { go(review ? 'review' : 'auto'); return; }
    openSheet(html`
      <h3 class="text-base font-black text-white mb-3"><i class="fa-solid fa-location-dot text-amber-300 mr-1"></i>위치 검토</h3>
      <div class="grid grid-cols-2 gap-2">
        <button data-action="go" data-type="review" class="btn-ghost py-2.5 text-amber-200">확인 필요 ${review}곳</button>
        <button data-action="go" data-type="auto" class="btn-ghost py-2.5">자동으로 바뀜 ${auto}곳</button>
      </div>
      <p class="text-[10px] text-slate-500 mt-2">자동으로 바뀐 곳은 구글 좌표가 기존 핀과 300m 이내라 바로 반영한 곳이에요. 비교해 보고 되돌릴 수 있어요.</p>`,
    (el) => delegate(el, { go: (b) => go(b.dataset.type) }));
  }

  const off = delegate(root, {
    'copy-invite': () => inviteUrl() && copyText(inviteUrl(), '초대 링크'),
    ...appSectionActions(() => update()),
    'share-invite': () => shareContent({ title: store.trip.title, url: inviteUrl() }),
    invite: () => openInviteSheet(),
    'view-link': () => openViewLinkSheet(),
    categories: () => openCategories(),
    geo: () => openGeo(),
    'how-to': () => openHowTo(),
    rename: () => {
      const name = prompt('새 이름', store.me?.display_name || '');
      if (name?.trim()) run(() => rpc('update_my_name', { p_trip: store.tripId, p_display_name: name.trim() }), '이름을 바꿨습니다.');
    },
    'add-placeholder': () => {
      const name = prompt('동행자 이름 (앱을 쓰지 않는 사람도 결제자로 지정할 수 있어요)');
      if (name?.trim()) run(() => rpc('add_placeholder_member', { p_trip: store.tripId, p_display_name: name.trim() }), '추가했습니다.');
    },
    'member-menu': (el) => openMemberMenu(store, el.dataset.id, run),
    'edit-trip': () => openTripEditor(store, run),
    'google-bulk': () => openGoogleBulk(store),
    'delete-trip': async () => {
      if (!confirmAction(`"${store.trip.title}" 여행과 모든 데이터를 삭제합니다. 되돌릴 수 없어요. 계속할까요?`)) return;
      if (prompt('확인을 위해 여행 이름을 입력하세요') !== store.trip.title) { toast('이름이 일치하지 않습니다.', 'error'); return; }
      // 사진 파일을 먼저 지움 (여행 행이 지워지면 권한 확인이 안 되므로). 남은 건 서버 정리가 지움
      const { removeTripFiles } = await import('../../lib/images.js');
      await removeTripFiles(store.tripId, store.list('trip_images', { includeDeleted: true }));
      const { error } = await supabase.from('trips').delete().eq('id', store.tripId);
      if (error) { toast(errorText(error), 'error'); return; }
      localStorage.removeItem(store.cacheKey); localStorage.removeItem(store.outboxKey);
      toast('삭제했습니다.'); navigate('/');
    },
    'link-google': () => linkGoogle().catch((e) => toast(errorText(e), 'error')),
    'device-code': () => openDeviceCodeIssue(store.tripId),
    'place-import': () => openPlaceImport(store),
    'share-codes': () => openShareCodes(store),
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

  // 앱 버전 · 새 APK 확인 결과가 오면 다시 그림
  window.addEventListener('app:update-info', update);
  update();
  return { update, destroy: () => { off(); window.removeEventListener('app:update-info', update); } };
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
      <button class="btn-primary">저장</button>
    </form>`, (el) => {
    $('#trip-form', el).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = formValues(e.target);
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

