// =====================================================================
// cleanup-images  (사진 정리)
//   keepalive(GitHub Actions, 3일마다)가 부름. 지울 파일 목록은 DB 가 정함 (migration_017 image_gc_candidates)
//     끝난 지 보관 일수가 지난 여행 · 지운 여행 · 지운 사진/항목(7일 뒤) · 기록 없는 파일(하루 뒤)
//   - 서비스 키는 함수 안에서만 씀 (Supabase 가 자동으로 넣어 주는 SUPABASE_SERVICE_ROLE_KEY)
//   - 아무나 불러도 DB 가 고른 쓰레기만 지우고, 1시간 안에 다시 부르면 건너뜀
// =====================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const BUCKET = 'trip-images';
const CHUNK = 100;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

Deno.serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'NOT_CONFIGURED' }, 500);
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const begin = await sb.rpc('image_gc_begin');
  if (begin.error) return json({ error: begin.error.message }, 500);
  if (!begin.data) return json({ skipped: 'ran within the last hour' });

  const cand = await sb.rpc('image_gc_candidates', { p_limit: 2000 });
  if (cand.error) return json({ error: cand.error.message }, 500);
  const rows = (cand.data || []) as { name: string; reason: string }[];

  const removed: string[] = [];
  const reasons: Record<string, number> = {};
  const errors: string[] = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const res = await sb.storage.from(BUCKET).remove(chunk.map((r) => r.name));
    if (res.error) { errors.push(res.error.message); continue; }
    for (const r of chunk) { removed.push(r.name); reasons[r.reason] = (reasons[r.reason] || 0) + 1; }
  }

  // 파일이 하나도 없어도 "기간이 지난 여행 표시"는 해야 하므로 늘 부름
  const done = await sb.rpc('image_gc_done', { p_names: removed });
  if (done.error) errors.push(done.error.message);

  return json({ removed: removed.length, reasons, rows: done.data ?? null, errors });
});
