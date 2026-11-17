// =====================================================================
// 사진 (migration_017) — 올리기 · 기기 캐시 · 받기 한도 · 보관 기간
//   파일: Storage trip-images/{trip}/{id}.webp(원본) · {id}_t.webp(썸네일)
//   기록: trip_images (TripStore 로 동기화)
//   캐시: Cache Storage 에 경로를 키로 저장 → 한 번 받은 사진은 다시 받지 않음 (전송량 0)
//          (경로가 사진마다 새 uuid 라 내용이 바뀌는 일이 없음)
//   전송량: 서버에서 실제로 받았을 때만 note_image_download 로 크기를 더함
//   위쪽 순수 함수는 node 테스트
// =====================================================================
import { supabase, errorText } from './supabase.js';
import { isApp, nativeApiLevel, nativePlugin } from './native.js';

export const BUCKET = 'trip-images';
export * from './image-rules.js';
import { PER_TARGET, PER_TRIP, DEFAULT_KEEP_DAYS, canFetch, imagePaths, imagesOf } from './image-rules.js';

// ---------------------------------------------------------- 상태 (서버 단계 · 보관 일수)
const STATUS_KEY = (trip) => `img-status:v1:${trip}`;
const STATUS_TTL = 10 * 60 * 1000;

export function cachedStatus(tripId) {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY(tripId)) || 'null'); } catch { return null; }
}
function saveStatus(tripId, patch) {
  const s = { ...(cachedStatus(tripId) || {}), ...patch, at: Date.now() };
  try { localStorage.setItem(STATUS_KEY(tripId), JSON.stringify(s)); } catch {}
  window.dispatchEvent(new CustomEvent('app:image-status', { detail: { tripId } }));
  return s;
}
export const keepDaysOf = (tripId) => cachedStatus(tripId)?.keep_days ?? DEFAULT_KEEP_DAYS;
export const levelOf = (tripId) => cachedStatus(tripId)?.level || 'ok';

let statusReq = new Map();
export function refreshStatus(tripId, { force = false } = {}) {
  const c = cachedStatus(tripId);
  if (!force && c && Date.now() - c.at < STATUS_TTL) return Promise.resolve(c);
  if (!navigator.onLine) return Promise.resolve(c);
  if (statusReq.has(tripId)) return statusReq.get(tripId);
  const p = supabase.rpc('image_status', { p_trip: tripId })
    .then(({ data, error }) => (error ? c : saveStatus(tripId, data)))
    .catch(() => c)
    .finally(() => statusReq.delete(tripId));
  statusReq.set(tripId, p);
  return p;
}

// ---------------------------------------------------------- 기기 캐시
const CACHE = 'trip-images-v1';
const cacheUrl = (path) => `https://trip-images.cache/${path}`;
const hasCaches = () => typeof caches !== 'undefined';
const mem = new Map();   // path → objectURL (이 화면에서 다시 그릴 때)

async function cacheGet(path) {
  if (!hasCaches()) return null;
  try {
    const r = await (await caches.open(CACHE)).match(cacheUrl(path));
    return r ? await r.blob() : null;
  } catch { return null; }
}
async function cachePut(path, blob) {
  if (!hasCaches()) return;
  try {
    await (await caches.open(CACHE)).put(cacheUrl(path), new Response(blob, { headers: { 'Content-Type': blob.type || 'image/webp' } }));
  } catch {}
}
export async function isCached(path) {
  if (mem.has(path)) return true;
  if (!hasCaches()) return false;
  try { return !!(await (await caches.open(CACHE)).match(cacheUrl(path))); } catch { return false; }
}
async function cacheDelete(paths) {
  for (const p of paths) {
    const u = mem.get(p);
    if (u) { URL.revokeObjectURL(u); mem.delete(p); }
  }
  if (!hasCaches()) return;
  try {
    const c = await caches.open(CACHE);
    await Promise.all(paths.map((p) => c.delete(cacheUrl(p))));
  } catch {}
}
// 그 여행의 사진 캐시 전부 지움 (보관 기간이 지남 · 여행 삭제)
export async function purgeTripCache(tripId) {
  for (const [p, u] of mem) if (p.startsWith(`${tripId}/`)) { URL.revokeObjectURL(u); mem.delete(p); }
  if (!hasCaches()) return;
  try {
    const c = await caches.open(CACHE);
    const keys = await c.keys();
    await Promise.all(keys.filter((k) => k.url.includes(`/${tripId}/`)).map((k) => c.delete(k)));
  } catch {}
}

// ---------------------------------------------------------- 받기
const inflight = new Map();

// 사진 → Blob (캐시 → 서버). 서버에서 받으면 전송량 기록
//   오류 코드: OFFLINE · IMAGE_LIMIT(한도) · IMAGE_PURGED · IMAGE_FAILED
export async function getImageBlob(tripId, img, { thumb = false } = {}) {
  if (img.purged_at) throw new Error('IMAGE_PURGED');
  const path = thumb ? img.thumb_path : img.path;
  const hit = await cacheGet(path);
  if (hit) return hit;
  if (!navigator.onLine) throw new Error('OFFLINE');
  if (!canFetch(levelOf(tripId), { thumb, kind: img.kind })) throw new Error('IMAGE_LIMIT');
  if (inflight.has(path)) return inflight.get(path);
  const p = (async () => {
    const { data, error } = await supabase.storage.from(BUCKET).download(path);
    if (error || !data) {
      // 한도에 막혔을 수 있으니 단계를 다시 확인
      const s = await refreshStatus(tripId, { force: true });
      if (s && !canFetch(s.level, { thumb, kind: img.kind })) throw new Error('IMAGE_LIMIT');
      throw new Error('IMAGE_FAILED');
    }
    await cachePut(path, data);
    supabase.rpc('note_image_download', { p_trip: tripId, p_bytes: data.size })
      .then(({ data: level }) => { if (level && level !== levelOf(tripId)) saveStatus(tripId, { level }); })
      .catch(() => {});
    return data;
  })().finally(() => inflight.delete(path));
  inflight.set(path, p);
  return p;
}

export async function getImageUrl(tripId, img, opts = {}) {
  const path = opts.thumb ? img.thumb_path : img.path;
  if (mem.has(path)) return mem.get(path);
  const blob = await getImageBlob(tripId, img, opts);
  const url = URL.createObjectURL(blob);
  mem.set(path, url);
  return url;
}

// 미리 받기 (여행 전 · 오프라인 대비): 썸네일 + 문서 원본. 이미 있으면 건너뜀
export async function prefetchTripImages(tripId, rows) {
  if (!navigator.onLine) return 0;
  const s = await refreshStatus(tripId);
  const level = s?.level || 'ok';
  if (level === 'blocked') return 0;
  let n = 0;
  for (const img of rows) {
    if (img.deleted_at || img.purged_at) continue;
    const jobs = [{ thumb: true }];
    if (img.kind === 'doc') jobs.push({ thumb: false });
    for (const j of jobs) {
      if (!navigator.onLine) return n;
      if (await isCached(j.thumb ? img.thumb_path : img.path)) continue;
      try { await getImageBlob(tripId, img, j); n++; } catch { /* 다음 기회 */ }
    }
  }
  return n;
}

// ---------------------------------------------------------- 올리기 · 지우기
// files → 줄여서 올리고 기록 추가. 반환: 올린 장수
export async function uploadImages(store, files, { targetType, targetId, kind = 'photo', onProgress } = {}) {
  if (!navigator.onLine) throw new Error('OFFLINE');
  const tripId = store.tripId;
  const all = store.list('trip_images').filter((r) => !r.purged_at);
  const here = imagesOf(all, targetType, targetId).length;
  const room = Math.min(PER_TARGET - here, PER_TRIP - all.length);
  if (room <= 0) throw new Error(here >= PER_TARGET ? 'IMAGE_TARGET_LIMIT' : 'ROW_LIMIT');
  const s = await refreshStatus(tripId, { force: true });
  if (s?.storage_full) throw new Error('IMAGE_STORAGE_FULL');
  const today = new Date().toISOString().slice(0, 10);
  if (s?.purge_date && today > s.purge_date) throw new Error('IMAGE_EXPIRED');

  const { resizeImage } = await import('./image-resize.js');
  const list = [...files].slice(0, room);
  let done = 0;
  let sort = all.filter((r) => r.target_id === targetId).reduce((m, r) => Math.max(m, r.sort_order ?? 0), 0);
  for (const file of list) {
    onProgress?.(done, list.length);
    const r = await resizeImage(file, kind);
    const id = crypto.randomUUID();
    const paths = imagePaths(tripId, id, r.ext);
    const type = r.ext === 'webp' ? 'image/webp' : 'image/jpeg';
    const up1 = await supabase.storage.from(BUCKET).upload(paths.path, r.main, { contentType: type, upsert: false, cacheControl: '31536000' });
    if (up1.error) throw up1.error;
    const up2 = await supabase.storage.from(BUCKET).upload(paths.thumb_path, r.thumb, { contentType: type, upsert: false, cacheControl: '31536000' });
    if (up2.error) { supabase.storage.from(BUCKET).remove([paths.path]).catch(() => {}); throw up2.error; }
    // 올린 사람은 다시 받을 필요 없음
    await cachePut(paths.path, r.main);
    await cachePut(paths.thumb_path, r.thumb);
    sort += 10;
    store.insert('trip_images', {
      id, target_type: targetType, target_id: targetId, kind, ...paths,
      width: r.width, height: r.height, bytes: r.main.size, thumb_bytes: r.thumb.size, sort_order: sort,
    });
    done++;
  }
  onProgress?.(done, list.length);
  return { done, skipped: files.length - list.length };
}

// 사진 지우기: 기록은 바로 지움(동기화), 파일은 바로 지워 보고 안 되면 서버 정리가 처리
export function removeImage(store, img) {
  store.remove('trip_images', img.id);
  const paths = [img.path, img.thumb_path];
  cacheDelete(paths);
  if (navigator.onLine) supabase.storage.from(BUCKET).remove(paths).catch(() => {});
}

// 여행을 지우기 전에: 그 여행의 파일을 지워 봄 (실패해도 서버 정리가 며칠 안에 지움)
//  rows 를 안 주면 서버에서 목록을 받음 (관리자 화면)
export async function removeTripFiles(tripId, rows = null) {
  if (!rows) {
    const { data } = await supabase.from('trip_images').select('path, thumb_path').eq('trip_id', tripId).limit(1000);
    rows = data || [];
  }
  const paths = rows.flatMap((r) => [r.path, r.thumb_path]).filter(Boolean);
  try {
    for (let i = 0; i < paths.length; i += 100) await supabase.storage.from(BUCKET).remove(paths.slice(i, i + 100));
  } catch {}
  await purgeTripCache(tripId);
}

// ---------------------------------------------------------- 기기에 저장
const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

// 앱: 사진 앨범(Pictures/여행)에 저장 (앱 기능 4 이상) · 웹: 내려받기
export async function saveBlob(blob, name) {
  if (isApp()) {
    if ((await nativeApiLevel()) < 4) throw new Error('APP_UPDATE_NEEDED');
    await nativePlugin().saveImage({ data: await toBase64(blob), name, mime: blob.type || 'image/webp' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const fileName = (img, i = 0) => `trip-${String(img.created_at || '').slice(0, 10) || 'photo'}-${img.id.slice(0, 8)}${i ? `-${i}` : ''}.${img.path.endsWith('.jpg') ? 'jpg' : 'webp'}`;

const IMAGE_ERRORS = {
  OFFLINE: '인터넷에 연결된 뒤 다시 해 주세요.',
  IMAGE_LIMIT: '이번 달 사진 보기 한도에 가까워져서 원본은 잠시 막혔어요. 썸네일과 문서는 볼 수 있어요.',
  IMAGE_PURGED: '보관 기간이 지나 삭제된 사진이에요.',
  IMAGE_FAILED: '사진을 받지 못했어요. 잠시 후 다시 해 주세요.',
  IMAGE_TARGET_LIMIT: `항목 하나에 사진은 ${PER_TARGET}장까지예요.`,
  ROW_LIMIT: `이 여행에는 사진을 ${PER_TRIP}장까지 붙일 수 있어요.`,
  IMAGE_STORAGE_FULL: '사진 저장공간이 거의 찼어요. 관리자에게 알려 주세요.',
  IMAGE_EXPIRED: '보관 기간이 지난 여행에는 사진을 붙일 수 없어요.',
  IMAGE_TYPE: '사진 파일만 붙일 수 있어요.',
  IMAGE_DECODE: '이 사진 형식은 열 수 없어요. (HEIC 등) JPG · PNG 로 바꿔 주세요.',
  IMAGE_ENCODE: '사진을 줄이지 못했어요.',
  APP_UPDATE_NEEDED: '기기에 저장하려면 앱을 업데이트해 주세요. (설정 → 앱)',
};
export function imageErrorText(e) {
  const msg = `${e?.message || e}`;
  const key = Object.keys(IMAGE_ERRORS).find((k) => msg.includes(k));
  if (key) return IMAGE_ERRORS[key];
  if (/row-level security|violates/i.test(msg)) return '올리지 못했어요. 저장공간이 찼거나 보관 기간이 지났을 수 있어요.';
  if (/exceeded the maximum allowed size|Payload too large/i.test(msg)) return '사진이 너무 커요.';
  return errorText(e);
}
