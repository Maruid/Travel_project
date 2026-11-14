import { html, setHTML, delegate, $ } from '../lib/dom.js';
import { canShare, shareContent } from '../lib/native.js';
import { openSheet, closeSheet, toast, copyText, confirmAction } from '../components/ui.js';
import { rpc, supabase, errorText } from '../lib/supabase.js';
import { color, icon } from '../lib/safe.js';
import { duplicateChecker, planCategories, copyRow, normName } from '../lib/place-copy.js';

// =====================================================================
// 장소 가져오기 / 공유 코드
//  - 가져오기: 내 다른 여행(멤버인 여행) 또는 공유 코드 → 골라서 지금 여행으로 복사
//  - 공유 코드(owner): 이 여행의 장소를 골라 8자리 코드 발급 (7일 후 만료)
// =====================================================================

const fmtDate = (s) => (s ? String(s).slice(0, 10) : '');

// ---------- 1단계: 어디서 가져올지 ----------
export async function openPlaceImport(store) {
  if (!navigator.onLine) { toast('온라인 상태에서만 가져올 수 있어요.', 'error'); return; }
  openSheet(html`
    <h3 class="text-sm font-black text-white mb-1">다른 여행에서 장소 가져오기</h3>
    <p class="text-[11px] text-slate-400 mb-3">가져온 장소는 이 여행에 복사돼요. 원본 여행은 바뀌지 않아요.</p>
    <p class="text-[11px] font-bold text-slate-300 mb-1.5">내 여행</p>
    <div id="imp-trips" class="space-y-1.5"><p class="text-[11px] text-slate-500">불러오는 중...</p></div>
    <p class="text-[11px] font-bold text-slate-300 mt-4 mb-1.5">공유 코드로 가져오기</p>
    <div class="flex gap-1.5">
      <input id="imp-code" class="input font-mono uppercase tracking-widest" maxlength="12" placeholder="8자리 코드" autocomplete="off">
      <button data-action="by-code" class="btn-ghost flex-shrink-0">확인</button>
    </div>
  `, (el) => {
    const off = delegate(el, {
      trip: async (b) => {
        b.disabled = true;
        try {
          const src = await loadFromTrip(b.dataset.id);
          openPicker(store, { ...src, title: b.dataset.title, keepGoogle: true });
        } catch (e) { toast(errorText(e), 'error'); b.disabled = false; }
      },
      'by-code': async (b) => {
        const code = $('#imp-code', el).value.trim();
        if (code.replace(/[^A-Za-z0-9]/g, '').length < 8) { toast('8자리 코드를 입력해 주세요.', 'error'); return; }
        b.disabled = true;
        try {
          const r = await rpc('read_place_share', { p_code: code });
          if (r.trip_id === store.tripId) { toast('지금 여행의 코드예요.', 'error'); b.disabled = false; return; }
          openPicker(store, { places: r.places || [], sourceCats: r.categories || [], title: `${r.title || '공유된 여행'} (코드)` });
        } catch (e) { toast(errorText(e), 'error'); b.disabled = false; }
      },
    });
    rpc('my_trips').then((trips) => {
      const others = (trips || []).filter((t) => t.trip_id !== store.tripId);
      setHTML($('#imp-trips', el), others.length ? html`${others.map((t) => html`
        <button data-action="trip" data-id="${t.trip_id}" data-title="${t.title}" class="w-full text-left p-2.5 rounded-xl bg-slate-800/80 border border-white/10 flex items-center gap-2">
          <span class="text-lg">${t.cover_emoji || '✈️'}</span>
          <span class="min-w-0 flex-1">
            <span class="block text-xs font-bold text-white truncate">${t.title}</span>
            <span class="block text-[10px] text-slate-400 truncate">${t.destination || ''}${t.start_date ? ` · ${fmtDate(t.start_date)}` : ''}</span>
          </span>
          <i class="fa-solid fa-chevron-right text-[10px] text-slate-500"></i>
        </button>`)}` : html`<p class="text-[11px] text-slate-500">다른 여행이 없어요.</p>`);
    }).catch((e) => setHTML($('#imp-trips', el), html`<p class="text-[11px] text-rose-300">${errorText(e)}</p>`));
    return off;
  });
}

async function loadFromTrip(tripId) {
  const [pl, cats] = await Promise.all([
    supabase.from('places').select('*').eq('trip_id', tripId).is('deleted_at', null).order('created_at'),
    supabase.from('categories').select('id,name,kind,icon,color').eq('trip_id', tripId).is('deleted_at', null),
  ]);
  if (pl.error) throw pl.error;
  if (cats.error) throw cats.error;
  return { places: pl.data || [], sourceCats: cats.data || [] };
}

// ---------- 2단계: 장소 고르기 (가져오기 · 공유 코드 발급 공용) ----------
//  mode 'import': 이미 있는 장소는 "이미 있음" 표시 + 기본 체크 해제
//  mode 'share' : 지금 여행 장소 중 공유할 것 고르기
function openPicker(store, { places, sourceCats, title, mode = 'import', onConfirm }) {
  if (!places.length) { toast('가져올 장소가 없어요.', 'error'); return; }
  // 가져오기 기본 동작: 지금 여행으로 복사
  const confirmFn = onConfirm || (async (chosen) => {
    const n = importPlaces(store, chosen, sourceCats);
    closeSheet();
    toast(`${n.places}곳을 가져왔어요.${n.cats ? ` (카테고리 ${n.cats}개 추가)` : ''}`);
  });
  const isDup = mode === 'import' ? duplicateChecker(store.list('places')) : () => false;
  const catOf = (id) => sourceCats.find((c) => c.id === id) || store.globalCategories.find((c) => c.id === id) || null;

  // 카테고리별 묶음 (카테고리 없는 장소는 '미분류')
  const groups = new Map();
  for (const p of places) {
    const key = p.category_id && catOf(p.category_id) ? p.category_id : '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const selected = new Set(places.filter((p) => !isDup(p)).map((p) => p.id));
  let query = '';

  openSheet(html`
    <div class="flex items-center justify-between mb-1">
      <h3 class="text-sm font-black text-white truncate">${mode === 'share' ? '공유할 장소 고르기' : title}</h3>
      <button data-action="all" class="text-[11px] text-neon-cyan flex-shrink-0">전체 선택/해제</button>
    </div>
    <input id="pk-search" class="input mb-2" placeholder="이름·지역으로 찾기">
    <div id="pk-list" class="space-y-3"></div>
    <div class="sticky bottom-0 pt-3 pb-1 bg-gradient-to-t from-night-950 via-night-950 to-transparent">
      <button data-action="confirm" id="pk-confirm" class="btn-primary w-full"></button>
    </div>
  `, (el) => {
    const visible = (p) => !query || normName(`${p.name} ${p.zone || ''}`).includes(normName(query));

    function render() {
      setHTML($('#pk-list', el), html`${[...groups.entries()].map(([cid, list]) => {
        const rows = list.filter(visible);
        if (!rows.length) return '';
        const cat = cid ? catOf(cid) : null;
        const on = rows.filter((p) => selected.has(p.id)).length;
        return html`
          <div>
            <label class="flex items-center gap-2 px-1 py-1 cursor-pointer">
              <input type="checkbox" data-action="group" data-cat="${cid}" class="accent-cyan-400" ${on === rows.length ? 'checked' : ''}>
              <span class="text-[11px] font-bold" style="color:${cat ? color(cat.color) : '#94a3b8'}">
                ${cat ? html`<i class="fa-solid ${icon(cat.icon)} text-[10px] mr-0.5"></i>` : ''}${cat ? cat.name : '미분류'}</span>
              <span class="text-[10px] text-slate-500">${on}/${rows.length}</span>
            </label>
            <div class="space-y-1">
              ${rows.map((p) => html`
                <label class="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-slate-800/60 cursor-pointer">
                  <input type="checkbox" data-action="one" data-id="${p.id}" class="accent-cyan-400 flex-shrink-0" ${selected.has(p.id) ? 'checked' : ''}>
                  <span class="min-w-0 flex-1">
                    <span class="block text-xs text-white truncate">${p.name}</span>
                    <span class="block text-[10px] text-slate-500 truncate">${[p.zone, p.rating ? `★${Number(p.rating).toFixed(1)}` : null, p.lat == null ? '위치 없음' : null].filter(Boolean).join(' · ')}</span>
                  </span>
                  ${isDup(p) ? html`<span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 flex-shrink-0">이미 있음</span>` : ''}
                </label>`)}
            </div>
          </div>`;
      })}`);
      const n = selected.size;
      const btn = $('#pk-confirm', el);
      btn.textContent = n ? (mode === 'share' ? `${n}곳으로 공유 코드 만들기` : `${n}곳 가져오기`) : '장소를 골라주세요';
      btn.disabled = !n;
    }

    const offClick = delegate(el, {
      all: () => {
        const rows = places.filter(visible);
        const allOn = rows.every((p) => selected.has(p.id));
        rows.forEach((p) => (allOn ? selected.delete(p.id) : selected.add(p.id)));
        render();
      },
      confirm: async (b) => {
        if (!selected.size || b.dataset.busy) return;
        b.dataset.busy = '1';
        try { await confirmFn(places.filter((p) => selected.has(p.id))); }
        finally { delete b.dataset.busy; }
      },
    });
    // 체크박스는 click 기본 동작(체크 토글)을 막지 않도록 change 로 처리
    const onChange = (e) => {
      const t = e.target;
      if (t.dataset.action === 'one') { t.checked ? selected.add(t.dataset.id) : selected.delete(t.dataset.id); render(); }
      if (t.dataset.action === 'group') {
        (groups.get(t.dataset.cat) || []).filter(visible).forEach((p) => (t.checked ? selected.add(p.id) : selected.delete(p.id)));
        render();
      }
    };
    const onInput = (e) => { if (e.target.id === 'pk-search') { query = e.target.value.trim(); render(); } };
    el.addEventListener('change', onChange);
    el.addEventListener('input', onInput);
    render();
    return () => { offClick(); el.removeEventListener('change', onChange); el.removeEventListener('input', onInput); };
  });

}

// 실제 복사: 카테고리 대응 → 필요한 커스텀 카테고리 생성 → 장소 추가
function importPlaces(store, chosen, sourceCats) {
  const usedIds = [...new Set(chosen.map((p) => p.category_id).filter(Boolean))];
  const plan = planCategories(usedIds, {
    sourceCats,
    targetCustom: store.list('categories'),
    globals: store.globalCategories,
    allowCustom: !!store.trip.allow_custom_categories,
  });
  const created = new Map();   // 이름 → 새 id (같은 이름 두 번 만들지 않도록)
  let cats = 0;
  const target = (srcId) => {
    const e = srcId ? plan.get(srcId) : null;
    if (!e) return null;
    if (!e.create) return e.id;
    const key = normName(e.create.name);
    if (!created.has(key)) {
      created.set(key, store.insert('categories', { ...e.create, sort_order: store.nextSortOrder('categories') }));
      cats++;
    }
    return created.get(key);
  };
  for (const p of chosen) store.insert('places', copyRow(p, target(p.category_id)));
  return { places: chosen.length, cats };
}

// ---------- 공유 코드 (owner) ----------
export function openShareCodes(store) {
  if (!navigator.onLine) { toast('온라인 상태에서만 할 수 있어요.', 'error'); return; }
  openSheet(html`
    <h3 class="text-sm font-black text-white mb-1">장소 공유 코드</h3>
    <p class="text-[11px] text-slate-400 mb-3">이 여행의 장소를 골라 코드를 만들면, 코드를 받은 사람이 자기 여행으로 복사해 갈 수 있어요.
      설명·팁·구글 정보까지 모두 넘어가요. 코드는 7일 뒤 만료돼요.</p>
    <button data-action="new" class="btn-primary w-full mb-3"><i class="fa-solid fa-plus mr-1"></i>새 공유 코드 만들기</button>
    <p class="text-[11px] font-bold text-slate-300 mb-1.5">사용 중인 코드</p>
    <div id="sc-list" class="space-y-1.5"><p class="text-[11px] text-slate-500">불러오는 중...</p></div>
  `, (el) => {
    const load = () => rpc('list_place_share_codes', { p_trip: store.tripId }).then((rows) => {
      setHTML($('#sc-list', el), rows?.length ? html`${rows.map((r) => html`
        <div class="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-800/80 border border-white/10">
          <div class="min-w-0">
            <p class="font-mono text-sm font-black text-neon-cyan tracking-widest">${r.code}</p>
            <p class="text-[10px] text-slate-400">${r.place_count}곳 · ${fmtDate(r.expires_at)} 만료</p>
          </div>
          <div class="flex gap-1 flex-shrink-0">
            <button data-action="copy" data-code="${r.code}" class="text-[10px] px-2 py-1 rounded bg-slate-700 text-slate-200">복사</button>
            <button data-action="revoke" data-code="${r.code}" class="text-[10px] px-2 py-1 rounded bg-rose-500/15 text-rose-300">끄기</button>
          </div>
        </div>`)}` : html`<p class="text-[11px] text-slate-500">없어요.</p>`);
    }).catch((e) => setHTML($('#sc-list', el), html`<p class="text-[11px] text-rose-300">${errorText(e)}</p>`));

    const off = delegate(el, {
      new: () => openPicker(store, {
        places: store.list('places'), sourceCats: store.list('categories'), mode: 'share',
        onConfirm: async (chosen) => {
          try {
            const r = await rpc('create_place_share_code', { p_trip: store.tripId, p_place_ids: chosen.map((p) => p.id) });
            showNewCode(store, r);
          } catch (e) { toast(errorText(e), 'error'); }
        },
      }),
      copy: (b) => copyText(b.dataset.code, '코드'),
      revoke: async (b) => {
        if (!confirmAction(`코드 ${b.dataset.code} 를 끌까요? 이 코드로는 더 이상 가져갈 수 없어요.`)) return;
        try { await rpc('revoke_place_share_code', { p_code: b.dataset.code }); toast('코드를 껐어요.'); load(); }
        catch (e) { toast(errorText(e), 'error'); }
      },
    });
    load();
    return off;
  });
}

function showNewCode(store, r) {
  const text = `여행 장소 공유 코드: ${r.code}\n앱의 설정 → 장소 데이터 → 다른 여행에서 장소 가져오기 에서 입력하세요. (${fmtDate(r.expires_at)}까지)`;
  openSheet(html`
    <h3 class="text-sm font-black text-white mb-2 text-center">공유 코드를 만들었어요</h3>
    <p class="font-mono text-3xl font-black text-neon-cyan tracking-[0.3em] text-center my-4">${r.code}</p>
    <p class="text-[11px] text-slate-400 text-center mb-4">장소 ${r.count}곳 · ${fmtDate(r.expires_at)}까지 사용 가능</p>
    <div class="grid ${canShare() ? 'grid-cols-2' : 'grid-cols-1'} gap-2">
      <button data-action="copy" class="btn-ghost py-2.5">복사</button>
      ${canShare() ? html`<button data-action="share" class="btn-ghost py-2.5"><i class="fa-solid fa-share-nodes mr-1"></i>보내기</button>` : ''}
    </div>
    <button data-action="back" class="w-full mt-2 py-2 text-[11px] text-slate-400">코드 목록으로</button>
  `, (el) => delegate(el, {
    copy: () => copyText(text, '코드와 안내'),
    share: () => shareContent({ text }),
    back: () => openShareCodes(store),
  }));
}
