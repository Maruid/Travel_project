-- =====================================================================
--  migration_002_devices_ai.sql
--  schema.sql 실행 이후 1회 실행 (SQL Editor). 다시 실행해도 안전하도록 작성.
--
--  1) 기기 추가 코드: 멤버 1명이 여러 기기(익명 계정)로 접속할 수 있게
--     - trip_member_devices : 멤버 ↔ 추가 기기 계정 연결
--     - device_link_codes   : 10분짜리 일회용 연결 코드
--     - 권한 판별을 my_member_id() 하나로 통일 (본 계정 + 추가 기기)
--  2) AI 정보 채우기 사용량 제한 (여행당 하루 50회)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. 테이블
-- ---------------------------------------------------------------------
create table if not exists public.trip_member_devices (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  member_id     uuid not null references public.trip_members(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz
);
create unique index if not exists trip_member_devices_trip_user on public.trip_member_devices(trip_id, user_id);
create index if not exists trip_member_devices_user on public.trip_member_devices(user_id);
create index if not exists trip_member_devices_member on public.trip_member_devices(member_id);

create table if not exists public.device_link_codes (
  code        text primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  member_id   uuid not null references public.trip_members(id) on delete cascade,
  created_by  uuid,
  expires_at  timestamptz not null,
  used_at     timestamptz
);

create table if not exists public.ai_usage (
  trip_id  uuid not null references public.trips(id) on delete cascade,
  day      date not null,
  count    int  not null default 0,
  primary key (trip_id, day)
);

alter table public.trip_member_devices enable row level security;
alter table public.device_link_codes   enable row level security;
alter table public.ai_usage            enable row level security;


-- ---------------------------------------------------------------------
-- 2. 권한 헬퍼: "이 여행에서 나는 어느 멤버인가" (본 계정 또는 추가 기기)
-- ---------------------------------------------------------------------
create or replace function public.my_member_id(p_trip uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from (
    select m.id from trip_members m
     where m.trip_id = p_trip and m.user_id = auth.uid() and m.removed_at is null
    union all
    select m.id from trip_member_devices d join trip_members m on m.id = d.member_id
     where d.trip_id = p_trip and d.user_id = auth.uid() and m.removed_at is null
  ) x limit 1;
$$;

create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_member_id(p_trip) is not null;
$$;

create or replace function public.is_trip_owner(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members
     where id = public.my_member_id(p_trip) and role = 'owner' and removed_at is null
  );
$$;


-- ---------------------------------------------------------------------
-- 3. 기존 RPC 를 추가 기기도 인식하도록 수정
-- ---------------------------------------------------------------------
create or replace function public.my_trips()
returns table (trip_id uuid, title text, destination text, start_date date, end_date date,
               cover_emoji text, my_role text, member_count bigint)
language sql stable security definer set search_path = public as $$
  with mine as (
    select m.trip_id, m.role from trip_members m
     where m.user_id = auth.uid() and m.removed_at is null
    union
    select m.trip_id, m.role from trip_member_devices d join trip_members m on m.id = d.member_id
     where d.user_id = auth.uid() and m.removed_at is null
  )
  select t.id, t.title, t.destination, t.start_date, t.end_date, t.cover_emoji, mine.role,
         (select count(*) from trip_members x where x.trip_id = t.id and x.removed_at is null)
    from mine join trips t on t.id = mine.trip_id
   order by t.start_date desc nulls last;
$$;

create or replace function public.join_trip(p_token text, p_display_name text, p_claim_member uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_trip uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select trip_id into v_trip from trip_invites where token = p_token;
  if v_trip is null then raise exception 'INVALID_INVITE'; end if;

  -- 이미 (본 계정 또는 추가 기기로) 참여 중이면 그대로 입장
  if public.my_member_id(v_trip) is not null then
    perform public.touch_trip(v_trip);
    return v_trip;
  end if;

  if p_claim_member is not null then
    update trip_members
       set user_id = auth.uid(), last_seen_at = now()
     where id = p_claim_member and trip_id = v_trip and user_id is null and removed_at is null;
    if not found then raise exception 'CLAIM_FAILED'; end if;
    return v_trip;
  end if;

  if (select count(*) from trip_members where trip_id = v_trip and removed_at is null) >= 30 then
    raise exception 'MEMBER_LIMIT';
  end if;

  insert into trip_members(trip_id, user_id, display_name, role, last_seen_at)
  values (v_trip, auth.uid(), trim(p_display_name), 'member', now());
  return v_trip;
end $$;

create or replace function public.update_my_name(p_trip uuid, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update trip_members set display_name = trim(p_display_name)
   where id = public.my_member_id(p_trip);
  if not found then raise exception 'FORBIDDEN'; end if;
end $$;

create or replace function public.touch_trip(p_trip uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_member uuid := public.my_member_id(p_trip);
begin
  if v_member is null then return; end if;
  update trip_members set last_seen_at = now()
   where id = v_member and (last_seen_at is null or last_seen_at < now() - interval '30 minutes');
  update trip_member_devices set last_seen_at = now()
   where trip_id = p_trip and user_id = auth.uid()
     and (last_seen_at is null or last_seen_at < now() - interval '30 minutes');
end $$;

create or replace function public.leave_trip(p_trip uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_trip_owner(p_trip) then raise exception 'OWNER_MUST_TRANSFER_FIRST'; end if;
  update trip_members set removed_at = now() where id = public.my_member_id(p_trip);
end $$;

-- 연결 해제: 본 계정 + 추가 기기 모두 끊고 자리표시로 되돌림
create or replace function public.unlink_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_role text;
begin
  select trip_id, role into v_trip, v_role from trip_members where id = p_member and removed_at is null;
  if v_trip is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_trip_owner(v_trip) then raise exception 'OWNER_ONLY'; end if;
  if v_role = 'owner' then raise exception 'CANNOT_UNLINK_OWNER'; end if;
  update trip_members set user_id = null where id = p_member;
  delete from trip_member_devices where member_id = p_member;
  delete from device_link_codes where member_id = p_member;
end $$;

create or replace function public.kick_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_role text;
begin
  select trip_id, role into v_trip, v_role from trip_members where id = p_member and removed_at is null;
  if v_trip is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_trip_owner(v_trip) then raise exception 'OWNER_ONLY'; end if;
  if v_role = 'owner' then raise exception 'CANNOT_KICK_OWNER'; end if;
  update trip_members set removed_at = now() where id = p_member;
  delete from trip_member_devices where member_id = p_member;
  delete from device_link_codes where member_id = p_member;
end $$;

create or replace function public.transfer_owner(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_user uuid;
begin
  select trip_id, user_id into v_trip, v_user from trip_members where id = p_member and removed_at is null;
  if v_trip is null then raise exception 'NOT_FOUND'; end if;
  if v_user is null and not exists (select 1 from trip_member_devices where member_id = p_member) then
    raise exception 'NOT_FOUND';
  end if;
  if not public.is_trip_owner(v_trip) then raise exception 'OWNER_ONLY'; end if;
  update trip_members set role = 'member' where trip_id = v_trip and role = 'owner' and removed_at is null;
  update trip_members set role = 'owner'  where id = p_member;
end $$;

create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return json_build_object(
    'trips',     (select count(*) from trips),
    'members',   (select count(*) from trip_members where removed_at is null and user_id is not null),
    'active_1d', (select count(distinct u) from (
                    select user_id u from trip_members where last_seen_at > now() - interval '1 day'
                    union all select user_id from trip_member_devices where last_seen_at > now() - interval '1 day') x),
    'active_7d', (select count(distinct u) from (
                    select user_id u from trip_members where last_seen_at > now() - interval '7 days'
                    union all select user_id from trip_member_devices where last_seen_at > now() - interval '7 days') x),
    'active_30d', (select count(distinct u) from (
                    select user_id u from trip_members where last_seen_at > now() - interval '30 days'
                    union all select user_id from trip_member_devices where last_seen_at > now() - interval '30 days') x),
    'db_size_bytes', pg_database_size(current_database()),
    'codes_active',  (select count(*) from creation_codes
                       where not revoked and (expires_at is null or expires_at > now())
                         and (max_uses is null or used_count < max_uses))
  );
end $$;


-- ---------------------------------------------------------------------
-- 4. 기기 추가 코드
-- ---------------------------------------------------------------------
-- 8자리 (혼동되는 0/O/1/I 제외한 32자) · 10분 · 일회용 · 멤버당 유효 코드 1개
create or replace function public.create_device_code(p_trip uuid)
returns json language plpgsql security definer set search_path = public as $$
declare
  v_member uuid := public.my_member_id(p_trip);
  v_code   text;
  v_alpha  text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_exp    timestamptz := now() + interval '10 minutes';
begin
  if v_member is null then raise exception 'FORBIDDEN'; end if;
  delete from device_link_codes where member_id = v_member and used_at is null;
  loop
    select string_agg(substr(v_alpha, (get_byte(b, i) % 32) + 1, 1), '' order by i)
      into v_code
      from (select extensions.gen_random_bytes(8) b) r, generate_series(0, 7) i;
    exit when not exists (select 1 from device_link_codes where code = v_code);
  end loop;
  insert into device_link_codes(code, trip_id, member_id, created_by, expires_at)
  values (v_code, p_trip, v_member, auth.uid(), v_exp);
  return json_build_object('code', v_code, 'expires_at', v_exp);
end $$;

create or replace function public.redeem_device_code(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  r device_link_codes%rowtype;
  v_existing uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select * into r from device_link_codes where code = v_code for update;
  if r.code is null or r.used_at is not null or r.expires_at < now()
     or not exists (select 1 from trip_members where id = r.member_id and removed_at is null) then
    raise exception 'INVALID_DEVICE_CODE';
  end if;

  v_existing := public.my_member_id(r.trip_id);
  if v_existing is not null and v_existing <> r.member_id then
    raise exception 'ALREADY_OTHER_MEMBER';
  end if;

  if v_existing is null then
    insert into trip_member_devices(trip_id, member_id, user_id, last_seen_at)
    values (r.trip_id, r.member_id, auth.uid(), now());
  end if;
  update device_link_codes set used_at = now() where code = v_code;
  return r.trip_id;
end $$;


-- ---------------------------------------------------------------------
-- 5. AI 사용량 (Edge Function enrich-place 가 사용자 권한으로 호출)
-- ---------------------------------------------------------------------
create or replace function public.consume_ai_quota(p_trip uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_limit int := 50;
  v_count int;
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  insert into ai_usage(trip_id, day, count) values (p_trip, current_date, 1)
  on conflict (trip_id, day) do update set count = ai_usage.count + 1
  returning count into v_count;
  if v_count > v_limit then raise exception 'AI_LIMIT'; end if;   -- 예외 시 증가분도 롤백
  return v_limit - v_count;
end $$;


-- ---------------------------------------------------------------------
-- 6. RLS / 권한
-- ---------------------------------------------------------------------
drop policy if exists devices_select on public.trip_member_devices;
create policy devices_select on public.trip_member_devices for select
  using (public.is_trip_member(trip_id) or public.is_admin());
-- device_link_codes, ai_usage: 정책 없음 → 클라이언트 직접 접근 불가 (RPC 로만)

grant select on public.trip_member_devices to authenticated;

-- 새로 만든 함수는 기본적으로 PUBLIC 실행 권한이 붙으므로 정리
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
grant  execute on function public.ping() to anon;

commit;
