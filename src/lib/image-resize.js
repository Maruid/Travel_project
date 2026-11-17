// =====================================================================
// 사진 줄이기 (올리기 전에 기기에서)
//   photo : 긴 변 1280px · 품질 0.75  → 보통 100~200KB
//   doc   : 긴 변 2400px · 품질 0.85  → 바우처 · 티켓 같은 A4 문서도 작은 글씨가 읽히게 (A4 기준 약 205dpi)
//   thumb : 긴 변 320px  · 품질 0.7   → 목록용 (약 15KB)
//   WebP 를 못 만드는 브라우저(아이폰 사파리 등)는 JPEG
//   파일이 상한(1.4MB)을 넘으면 품질을 낮춰 다시 만듦
// =====================================================================

export const PRESETS = {
  photo: { max: 1280, quality: 0.75 },
  doc: { max: 2400, quality: 0.85 },
  thumb: { max: 320, quality: 0.7 },
};
export const MAX_BYTES = 1.4 * 1024 * 1024;

// 긴 변을 max 로 맞춘 크기 (원본이 더 작으면 그대로) — 순수 함수 (테스트)
export function fitSize(w, h, max) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  const long = Math.max(w, h);
  if (long <= max) return { width: w, height: h };
  const r = max / long;
  return { width: Math.max(1, Math.round(w * r)), height: Math.max(1, Math.round(h * r)) };
}

// 품질을 낮춰가며 다시 만들 때의 순서 — 순수 함수 (테스트)
export function qualitySteps(start) {
  const out = [];
  for (let q = start; q >= 0.45 - 1e-9; q = Math.round((q - 0.1) * 100) / 100) out.push(q);
  return out.length ? out : [start];
}

async function decode(file) {
  // 사진의 회전 정보(EXIF)를 반영해서 열기
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch {}
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function toBlob(canvas, type, quality) {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

// 큰 사진을 한 번에 많이 줄이면 글자가 거칠어져서 반씩 나눠 줄임
function drawScaled(src, sw, sh, width, height) {
  let cur = src; let cw = sw; let ch = sh;
  while (cw / 2 > width && ch / 2 > height) {
    const c = document.createElement('canvas');
    c.width = Math.round(cw / 2); c.height = Math.round(ch / 2);
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    x.drawImage(cur, 0, 0, c.width, c.height);
    cur = c; cw = c.width; ch = c.height;
  }
  const out = document.createElement('canvas');
  out.width = width; out.height = height;
  const ctx = out.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#fff';                 // 투명한 PNG 를 JPEG 로 만들 때 검게 되지 않게
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(cur, 0, 0, width, height);
  return out;
}

let webpOk = null;
async function canWebp() {
  if (webpOk != null) return webpOk;
  const c = document.createElement('canvas'); c.width = 2; c.height = 2;
  const b = await toBlob(c, 'image/webp', 0.8);
  webpOk = !!b && b.type === 'image/webp';
  return webpOk;
}

async function encode(canvas, quality, maxBytes) {
  const type = (await canWebp()) ? 'image/webp' : 'image/jpeg';
  let blob = null;
  for (const q of qualitySteps(quality)) {
    blob = await toBlob(canvas, type, q);
    if (!blob) throw new Error('IMAGE_ENCODE');
    if (blob.size <= maxBytes) break;
  }
  return blob;
}

// 파일 하나 → { main, thumb, width, height, ext }
export async function resizeImage(file, kind = 'photo') {
  if (!file || !/^image\//.test(file.type || 'image/')) throw new Error('IMAGE_TYPE');
  let src;
  try { src = await decode(file); } catch { throw new Error('IMAGE_DECODE'); }
  const sw = src.width || src.naturalWidth; const sh = src.height || src.naturalHeight;
  if (!sw || !sh) throw new Error('IMAGE_DECODE');
  const p = PRESETS[kind] || PRESETS.photo;
  const m = fitSize(sw, sh, p.max);
  const t = fitSize(sw, sh, PRESETS.thumb.max);
  const main = await encode(drawScaled(src, sw, sh, m.width, m.height), p.quality, MAX_BYTES);
  const thumb = await encode(drawScaled(src, sw, sh, t.width, t.height), PRESETS.thumb.quality, 250 * 1024);
  src.close?.();
  return { main, thumb, width: m.width, height: m.height, ext: main.type === 'image/webp' ? 'webp' : 'jpg' };
}
