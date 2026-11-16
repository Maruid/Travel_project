// =====================================================================
// 구글 지도 [공유] → 여행 앱 → 장소 추가 (안드로이드 앱, 앱 기능 버전 3)
//   1) 공유로 받은 글에서 주소(URL)를 찾음 → 구글 지도 링크가 아니면 안내만
//   2) 어느 여행에 넣을지: 진행 중 · 다가오는 여행이 하나면 바로, 여럿이면 고르기 창
//   3) 그 여행의 장소 탭으로 가서 [새 장소 추가] 창에 링크를 넣고 자동으로 가져오기
//      (장소 탭이 열릴 때 takePendingShare 로 꺼내 씀 — 이미 열려 있으면 'share:place' 이벤트)
// =====================================================================
import { isGoogleMapsUrl } from './maps-link.js';

const PENDING_KEY = 'share:pending';

// 공유 글 안의 첫 번째 주소. 구글 지도는 "가게 이름\nhttps://maps.app.goo.gl/…" 처럼 보냄
export function extractUrl(text) {
  const m = String(text || '').match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[),.;!?]+$/, '') : null;
}

// 넣을 만한 여행: 진행 중 → 다가오는(가까운 순). 하나도 없으면 전체(최근 시작 순)
//   my_trips 는 trip_id 로 줌 → id 로 맞춤
export function shareTargets(trips, today) {
  const list = (trips || []).map((t) => (t && !t.id && t.trip_id ? { ...t, id: t.trip_id } : t)).filter((t) => t?.id);
  const ongoing = list.filter((t) => t.start_date && t.start_date <= today && (t.end_date || t.start_date) >= today);
  const upcoming = list.filter((t) => t.start_date && t.start_date > today)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const active = [...ongoing, ...upcoming];
  if (active.length) return { trips: active, auto: active.length === 1 };
  const rest = [...list].sort((a, b) => String(b.start_date || '').localeCompare(String(a.start_date || '')));
  return { trips: rest, auto: false };
}

export function setPendingShare(tripId, url) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ tripId, url, at: Date.now() })); } catch {}
}
// 장소 탭이 열릴 때: 이 여행 것이고 10분 안이면 꺼냄 (한 번만)
export function takePendingShare(tripId) {
  try {
    const v = JSON.parse(sessionStorage.getItem(PENDING_KEY) || 'null');
    if (!v || v.tripId !== tripId) return null;
    sessionStorage.removeItem(PENDING_KEY);
    return Date.now() - (v.at || 0) < 10 * 60 * 1000 ? v.url : null;
  } catch { return null; }
}

const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 앱이 받은 공유 글 처리 (main.js 가 라우터 시작 뒤 연결)
export async function handleSharedText(text, { toast, navigate, currentPath }) {
  const url = extractUrl(text);
  if (!url || !isGoogleMapsUrl(url)) {
    toast('구글 지도 링크만 받을 수 있어요. 구글 지도 앱에서 장소 → [공유] → 여행 을 눌러 주세요.', 'error');
    return;
  }
  const [{ getUser }, { loadTripList }, { rpc }] = await Promise.all([
    import('./auth.js'), import('./offline.js'), import('./supabase.js'),
  ]);
  const user = await getUser();
  if (!user) { toast('먼저 여행을 만들거나 참여해 주세요.', 'error'); return; }
  let trips = loadTripList(user.id)?.trips || [];
  if (navigator.onLine && !user.offline) {
    try { trips = (await rpc('my_trips')) || trips; } catch {}
  }
  if (!trips.length) { toast('넣을 여행이 없어요. 먼저 여행을 만들거나 참여해 주세요.', 'error'); return; }

  const go = (trip) => {
    setPendingShare(trip.id, url);
    const target = `/trip/${trip.id}/places`;
    if (currentPath?.() === target) window.dispatchEvent(new Event('share:place'));
    else navigate(target);
  };
  const { trips: targets, auto } = shareTargets(trips, localToday());
  if (auto) { go(targets[0]); return; }
  const { openPicker } = await import('../components/picker.js');
  openPicker({
    title: '어느 여행에 넣을까요?',
    sections: [{ items: targets.map((t) => ({
      id: t.id, title: t.title || '여행',
      sub: [t.destination, t.start_date ? `${t.start_date} ~ ${t.end_date || ''}` : ''].filter(Boolean).join(' · '),
      icon: 'fa-suitcase-rolling',
    })) }],
    // 고르기 창을 닫는 뒤로가기(history.back)가 끝난 뒤에 이동 (먼저 이동하면 그 뒤로가기가 이동을 되돌림)
    onPick: (id) => {
      const t = targets.find((x) => x.id === id);
      if (!t) return;
      let done = false;
      const run = () => { if (done) return; done = true; window.removeEventListener('popstate', run); setTimeout(() => go(t), 0); };
      window.addEventListener('popstate', run);
      setTimeout(run, 400);
    },
  });
}
