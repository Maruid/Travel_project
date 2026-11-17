-- =====================================================================
-- migration_017: 사진 붙이기 (일정 · 가이드 · 할 일)
--  - 파일: Storage 버킷 trip-images (비공개). 경로 {trip_id}/{image_id}.webp(원본) · {image_id}_t.webp(썸네일)
--  - 기록: trip_images (다른 콘텐츠 표와 같은 방식: 앱이 만든 UUID · 멤버만 · soft delete · Realtime)
--  - 한도: 여행당 100장 · 항목당 4장 · 파일 1.5MB · 저장공간 / 월 전송량은 image_settings (관리자 화면에서 조정)
--  - 월 전송량(추정): 앱이 Supabase 에서 실제로 받을 때만 note_image_download 로 더함 (기기 캐시에서 보면 안 셈)
--      70% 경고 · 85% 썸네일과 문서만 · 100% 모두 막음 (이미 받은 사진은 기기에서 계속 보임)
--  - 보관: 여행 종료일 + keep_days(기본 30일)가 지나면 사진 삭제 (행은 purged_at 으로 남아 "삭제됨" 표시)
--  - 정리: Edge Function cleanup-images 가 image_gc_candidates → Storage 삭제 → image_gc_done
--          (keepalive 가 3일마다 호출. 끝난 여행 · 지운 항목 · 지운 여행 · 기록 없는 파일)
-- 앞선 migration (002 · 015) 를 먼저 실행하세요. 다시 실행해도 안전합니다.
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. 설정 · 월 사용량 (앱에서 직접 읽고 쓰지 않음 → 함수로만)
-- ---------------------------------------------------------------------
create table if not exists public.image_settings (
  id               int primary key default 1 check (id = 1),
  egress_limit_mb  int not null default 4000 check (egress_limit_mb between 100 and 1000000),   -- 월 사진 전송 예산 (무료 5GB 의 80%)
  storage_limit_mb int not null default 900 check (storage_limit_mb between 50 and 1000000),   -- 저장공간 예산 (무료 1GB 의 약 90%)
  cycle_day        int not null default 1 check (cycle_day between 1 and 28),                  -- Supabase 결제 주기 시작일 (UTC)
  keep_days        int not null default 30 check (keep_days between 1 and 365),                -- 여행 종료 후 보관 일수
  last_gc_at       timestamptz,
  updated_at       timestamptz not null default now()
);
insert into public.image_settings(id) values (1) on conflict (id) do nothing;
alter table public.image_settings enable row level security;

create table if not exists public.image_usage (
  period     date primary key,                 -- 주기 시작일
  bytes      bigint not null default 0,
  files      int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.image_usage enable row level security;

-- 지금 주기의 시작일 (cycle_day 기준, UTC)
create or replace function public.image_period_start()
returns date language sql stable security definer set search_path = public as $$
  select case when extract(day from x.d)::int >= s.cycle_day
              then make_date(extract(year from x.d)::int, extract(month from x.d)::int, s.cycle_day)
              else (make_date(extract(year from x.d)::int, extract(month from x.d)::int, s.cycle_day) - interval '1 month')::date end
    from (select (now() at time zone 'utc')::date as d) x, image_settings s where s.id = 1;
$$;

create or replace function public.image_storage_bytes()
returns bigint language sql stable security definer set search_path = public, storage as $$
  select coalesce(sum((o.metadata->>'size')::bigint), 0)::bigint from storage.objects o where o.bucket_id = 'trip-images';
$$;

-- ok | warn(70%) | thumbs(85%: 썸네일 · 문서만) | blocked(100%)
create or replace function public.image_level()
returns text language plpgsql stable security definer set search_path = public as $$
declare u bigint; lim bigint;
begin
  select coalesce((select bytes from image_usage where period = public.image_period_start()), 0) into u;
  select egress_limit_mb::bigint * 1048576 into lim from image_settings where id = 1;
  return case when u >= lim then 'blocked' when u >= lim * 0.85 then 'thumbs' when u >= lim * 0.7 then 'warn' else 'ok' end;
end $$;

-- 여행의 사진 삭제일 (종료일 + 보관 일수). 종료일이 없으면 null
create or replace function public.image_purge_date(p_trip uuid)
returns date language sql stable security definer set search_path = public as $$
  select t.end_date + s.keep_days from trips t, image_settings s where t.id = p_trip and s.id = 1;
$$;

-- ---------------------------------------------------------------------
-- 2. 사진 기록
-- ---------------------------------------------------------------------
create table if not exists public.trip_images (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references public.trips(id) on delete cascade,
  target_type  text not null check (target_type in ('item', 'guide', 'todo')),
  target_id    uuid not null,
  kind         text not null default 'photo' check (kind in ('photo', 'doc')),   -- doc: 바우처 · 티켓 (고해상도)
  path         text not null check (char_length(path) <= 120),
  thumb_path   text not null check (char_length(thumb_path) <= 120),
  width        int check (width between 1 and 10000),
  height       int check (height between 1 and 10000),
  bytes        int not null default 0 check (bytes between 0 and 2000000),
  thumb_bytes  int not null default 0 check (thumb_bytes between 0 and 300000),
  purged_at    timestamptz,                                -- 보관 기간이 지나 파일을 지움
  sort_order   double precision not null default 0,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz,
  constraint trip_images_path_in_trip check (
    path like trip_id::text || '/%' and thumb_path like trip_id::text || '/%')
);
create index if not exists trip_images_trip on public.trip_images(trip_id);
create index if not exists trip_images_target on public.trip_images(target_id);

drop trigger if exists trip_images_meta on public.trip_images;
create trigger trip_images_meta before insert or update on public.trip_images
  for each row execute function public.tg_row_meta();
drop trigger if exists trip_images_limit on public.trip_images;
create trigger trip_images_limit before insert on public.trip_images
  for each row when (new.trip_id is not null) execute function public.tg_row_limit('100');

-- 항목당 4장 · 보관 기간이 지난 여행에는 추가 안 됨
create or replace function public.tg_image_rules()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_purge date;
begin
  v_purge := public.image_purge_date(new.trip_id);
  if v_purge is not null and current_date > v_purge then
    raise exception 'IMAGE_EXPIRED: 보관 기간이 지난 여행에는 사진을 붙일 수 없어요';
  end if;
  if (select count(*) from trip_images
       where target_id = new.target_id and deleted_at is null and purged_at is null) >= 4 then
    raise exception 'IMAGE_TARGET_LIMIT: 항목 하나에 사진은 4장까지예요';
  end if;
  return new;
end $$;
drop trigger if exists trip_images_rules on public.trip_images;
create trigger trip_images_rules before insert on public.trip_images
  for each row execute function public.tg_image_rules();

alter table public.trip_images enable row level security;
drop policy if exists trip_images_select on public.trip_images;
create policy trip_images_select on public.trip_images for select
  using (public.is_trip_member(trip_id) or public.is_admin());
drop policy if exists trip_images_insert on public.trip_images;
create policy trip_images_insert on public.trip_images for insert
  with check (public.is_trip_member(trip_id));
drop policy if exists trip_images_update on public.trip_images;
create policy trip_images_update on public.trip_images for update
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
grant select, insert, update on public.trip_images to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.trip_images;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 3. Storage 버킷 + 권한
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trip-images', 'trip-images', false, 1572864, array['image/webp', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 파일 이름 → 여행 id / 사진 id (형식이 다르면 null)
create or replace function public.image_trip_of(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then return null;
end $$;
create or replace function public.image_id_of(p_name text)
returns uuid language plpgsql immutable as $$
begin
  return left(split_part(p_name, '/', 2), 36)::uuid;
exception when others then return null;
end $$;

-- 받기 허용: 전송 단계에 따라 (thumbs 단계에서는 썸네일과 문서 원본만)
create or replace function public.image_read_allowed(p_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare v_level text := public.image_level();
begin
  if v_level in ('ok', 'warn') then return true; end if;
  if v_level = 'blocked' then return false; end if;
  return p_name like '%\_t.%' or exists (select 1 from trip_images where id = public.image_id_of(p_name) and kind = 'doc');
end $$;

-- 올리기 허용: 저장공간 예산 · 보관 기간 · 여행당 파일 수
create or replace function public.image_upload_allowed(p_trip uuid)
returns boolean language plpgsql stable security definer set search_path = public, storage as $$
declare v_purge date := public.image_purge_date(p_trip);
begin
  if v_purge is not null and current_date > v_purge then return false; end if;
  if public.image_storage_bytes() >= (select storage_limit_mb::bigint * 1048576 from image_settings where id = 1) then return false; end if;
  return (select count(*) from storage.objects where bucket_id = 'trip-images' and name like p_trip::text || '/%') < 240;
end $$;

drop policy if exists trip_images_obj_select on storage.objects;
create policy trip_images_obj_select on storage.objects for select to authenticated
  using (bucket_id = 'trip-images' and (
    public.is_admin() or (public.is_trip_member(public.image_trip_of(name)) and public.image_read_allowed(name))));
drop policy if exists trip_images_obj_insert on storage.objects;
create policy trip_images_obj_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'trip-images'
    and name ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}(_t)?\.(webp|jpg)$'
    and public.is_trip_member(public.image_trip_of(name))
    and public.image_upload_allowed(public.image_trip_of(name)));
drop policy if exists trip_images_obj_delete on storage.objects;
create policy trip_images_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'trip-images' and (public.is_admin() or public.is_trip_member(public.image_trip_of(name))));

-- ---------------------------------------------------------------------
-- 4. 앱용 함수
-- ---------------------------------------------------------------------
-- 실제로 서버에서 받은 크기를 더하고 지금 단계를 돌려줌
create or replace function public.note_image_download(p_trip uuid, p_bytes int)
returns text language plpgsql security definer set search_path = public as $$
begin
  if not (public.is_trip_member(p_trip) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
  insert into image_usage(period, bytes, files)
  values (public.image_period_start(), greatest(0, least(coalesce(p_bytes, 0), 3000000)), 1)
  on conflict (period) do update set bytes = image_usage.bytes + excluded.bytes,
                                     files = image_usage.files + 1, updated_at = now();
  return public.image_level();
end $$;

-- 여행 화면용: 단계 · 올리기 가능 · 삭제일
create or replace function public.image_status(p_trip uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare s image_settings%rowtype;
begin
  if not (public.is_trip_member(p_trip) or public.is_admin()) then raise exception 'FORBIDDEN'; end if;
  select * into s from image_settings where id = 1;
  return json_build_object(
    'level', public.image_level(),
    'storage_full', public.image_storage_bytes() >= s.storage_limit_mb::bigint * 1048576,
    'keep_days', s.keep_days,
    'purge_date', public.image_purge_date(p_trip),
    'next_period', (public.image_period_start() + interval '1 month')::date);
end $$;
grant execute on function public.note_image_download(uuid, int) to authenticated;
grant execute on function public.image_status(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. 관리자
-- ---------------------------------------------------------------------
create or replace function public.admin_image_stats()
returns json language plpgsql stable security definer set search_path = public, storage as $$
declare s image_settings%rowtype; v_period date := public.image_period_start();
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  select * into s from image_settings where id = 1;
  return json_build_object(
    'storage_bytes', public.image_storage_bytes(),
    'storage_limit_mb', s.storage_limit_mb,
    'objects', (select count(*) from storage.objects where bucket_id = 'trip-images'),
    'period', v_period,
    'next_period', (v_period + interval '1 month')::date,
    'period_bytes', coalesce((select bytes from image_usage where period = v_period), 0),
    'period_files', coalesce((select files from image_usage where period = v_period), 0),
    'egress_limit_mb', s.egress_limit_mb,
    'cycle_day', s.cycle_day,
    'keep_days', s.keep_days,
    'level', public.image_level(),
    'last_gc_at', s.last_gc_at,
    'expiring_7d_bytes', coalesce((
      select sum(i.bytes + i.thumb_bytes) from trip_images i join trips t on t.id = i.trip_id
       where i.deleted_at is null and i.purged_at is null
         and t.end_date + s.keep_days between current_date and current_date + 7), 0),
    'trips', coalesce((
      select json_agg(x order by x.bytes desc) from (
        select t.id, t.title, t.end_date, t.end_date + s.keep_days as purge_date,
               count(*) as images, sum(i.bytes + i.thumb_bytes)::bigint as bytes
          from trip_images i join trips t on t.id = i.trip_id
         where i.deleted_at is null and i.purged_at is null
         group by t.id order by sum(i.bytes + i.thumb_bytes) desc limit 20) x), '[]'::json));
end $$;

create or replace function public.admin_set_image_settings(p_egress_mb int, p_storage_mb int, p_cycle_day int, p_keep_days int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  update image_settings set egress_limit_mb = p_egress_mb, storage_limit_mb = p_storage_mb,
         cycle_day = p_cycle_day, keep_days = p_keep_days, updated_at = now() where id = 1;
end $$;
grant execute on function public.admin_image_stats() to authenticated;
grant execute on function public.admin_set_image_settings(int, int, int, int) to authenticated;

-- ---------------------------------------------------------------------
-- 6. 정리 (Edge Function cleanup-images 가 서비스 키로 부름)
-- ---------------------------------------------------------------------
-- 1시간 안에 다시 부르면 false (아무나 불러도 서버에 부담이 없도록)
create or replace function public.image_gc_begin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update image_settings set last_gc_at = now()
   where id = 1 and (last_gc_at is null or last_gc_at < now() - interval '1 hour');
  return found;
end $$;

-- 지울 파일 목록
--  trip-gone   : 여행이 지워짐
--  expired     : 종료일 + 보관 일수가 지남
--  orphan      : 기록이 없는 파일 (올리다 실패 등, 하루 뒤)
--  deleted     : 사진을 지움 (7일 뒤)
--  target-gone : 붙어 있던 일정 · 가이드 · 할 일을 지움 (7일 뒤)
create or replace function public.image_gc_candidates(p_limit int default 1000)
returns table(name text, reason text) language sql stable security definer set search_path = public, storage as $$
  with o as (
    select o.name, o.created_at, public.image_trip_of(o.name) as trip_id, public.image_id_of(o.name) as image_id
      from storage.objects o where o.bucket_id = 'trip-images'
  ), r as (
    select o.name,
      case
        when t.id is null then 'trip-gone'
        when t.end_date + s.keep_days < current_date then 'expired'
        when i.id is null then case when o.created_at < now() - interval '1 day' then 'orphan' end
        when i.purged_at is not null then 'expired'
        when i.deleted_at is not null and i.deleted_at < now() - interval '7 days' then 'deleted'
        when i.created_at < now() - interval '7 days' and not exists (
          select 1 from itinerary_items x where i.target_type = 'item' and x.id = i.target_id and (x.deleted_at is null or x.deleted_at > now() - interval '7 days')
          union all select 1 from guides x where i.target_type = 'guide' and x.id = i.target_id and (x.deleted_at is null or x.deleted_at > now() - interval '7 days')
          union all select 1 from todos x where i.target_type = 'todo' and x.id = i.target_id and (x.deleted_at is null or x.deleted_at > now() - interval '7 days'))
          then 'target-gone'
      end as reason
      from o
      cross join image_settings s
      left join trips t on t.id = o.trip_id
      left join trip_images i on i.id = o.image_id
     where s.id = 1
  )
  select name, reason from r where reason is not null limit greatest(1, least(p_limit, 5000));
$$;

-- 파일을 지운 뒤: 기록 정리
create or replace function public.image_gc_done(p_names text[])
returns json language plpgsql security definer set search_path = public as $$
declare n_purged int; n_gone int; n_rows int;
begin
  -- 보관 기간이 지난 여행: 행은 남기고 "삭제됨" 표시 (파일 유무와 상관없이)
  update trip_images i set purged_at = now()
    from trips t, image_settings s
   where s.id = 1 and t.id = i.trip_id and i.purged_at is null and t.end_date + s.keep_days < current_date;
  get diagnostics n_purged = row_count;
  -- 붙은 항목이 사라진 사진: 지운 것으로 표시
  update trip_images i set deleted_at = now()
   where i.deleted_at is null and i.id in (select public.image_id_of(x) from unnest(coalesce(p_names, '{}')) x)
     and i.purged_at is null;
  get diagnostics n_gone = row_count;
  -- 지운 지 30일이 넘은 행은 완전 삭제
  delete from trip_images where deleted_at < now() - interval '30 days';
  get diagnostics n_rows = row_count;
  return json_build_object('purged', n_purged, 'marked_deleted', n_gone, 'rows_removed', n_rows);
end $$;

revoke all on function public.image_gc_begin() from public, anon, authenticated;
revoke all on function public.image_gc_candidates(int) from public, anon, authenticated;
revoke all on function public.image_gc_done(text[]) from public, anon, authenticated;
grant execute on function public.image_gc_begin() to service_role;
grant execute on function public.image_gc_candidates(int) to service_role;
grant execute on function public.image_gc_done(text[]) to service_role;

commit;
