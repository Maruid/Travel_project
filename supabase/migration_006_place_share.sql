-- =====================================================================
-- migration_006: 장소 공유 코드
--  - owner 가 장소를 골라 8자리 코드 발급 (7일 후 만료, 언제든 끌 수 있음)
--  - 코드를 받은 사람은 멤버가 아니어도 그 장소들을 읽어 자기 여행으로 복사
--  - 테이블은 RLS 만 켜고 정책 없음 → 아래 함수로만 접근
-- =====================================================================
begin;

create table if not exists public.place_share_codes (
  code        text primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  place_ids   uuid[] not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);
create index if not exists place_share_codes_trip on public.place_share_codes(trip_id);
alter table public.place_share_codes enable row level security;

-- 발급 (owner 만). 고른 장소 중 이 여행에 실제로 있는 것만 담음
create or replace function public.create_place_share_code(p_trip uuid, p_place_ids uuid[])
returns json language plpgsql security definer set search_path = public as $$
declare
  v_ids   uuid[];
  v_code  text;
  v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_exp   timestamptz := now() + interval '7 days';
begin
  if not public.is_trip_owner(p_trip) then raise exception 'OWNER_ONLY'; end if;

  select array_agg(id) into v_ids from places
   where trip_id = p_trip and deleted_at is null and id = any(coalesce(p_place_ids, '{}'));
  if v_ids is null then raise exception 'NO_PLACES'; end if;

  delete from place_share_codes where trip_id = p_trip and (expires_at < now() or revoked_at is not null);
  if (select count(*) from place_share_codes where trip_id = p_trip) >= 10 then raise exception 'SHARE_LIMIT'; end if;

  loop
    select string_agg(substr(v_alpha, (get_byte(b, i) % 32) + 1, 1), '' order by i)
      into v_code
      from (select extensions.gen_random_bytes(8) b) r, generate_series(0, 7) i;
    exit when not exists (select 1 from place_share_codes where code = v_code);
  end loop;

  insert into place_share_codes(code, trip_id, place_ids, created_by, expires_at)
  values (v_code, p_trip, v_ids, auth.uid(), v_exp);
  return json_build_object('code', v_code, 'expires_at', v_exp, 'count', cardinality(v_ids));
end $$;

-- 이 여행의 살아 있는 코드 목록 (owner 만)
create or replace function public.list_place_share_codes(p_trip uuid)
returns table (code text, place_count int, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_trip_owner(p_trip) then raise exception 'OWNER_ONLY'; end if;
  return query
    select c.code, cardinality(c.place_ids), c.created_at, c.expires_at
      from place_share_codes c
     where c.trip_id = p_trip and c.revoked_at is null and c.expires_at > now()
     order by c.created_at desc;
end $$;

-- 코드 끄기 (그 여행의 owner 만)
create or replace function public.revoke_place_share_code(p_code text)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid;
begin
  select trip_id into v_trip from place_share_codes where code = upper(p_code);
  if v_trip is null or not public.is_trip_owner(v_trip) then raise exception 'OWNER_ONLY'; end if;
  update place_share_codes set revoked_at = now() where code = upper(p_code);
end $$;

-- 코드로 장소 읽기 (로그인한 누구나). 장소 전체 칸 + 쓰인 커스텀 카테고리
create or replace function public.read_place_share(p_code text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  r place_share_codes%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into r from place_share_codes where code = v_code;
  if r.code is null or r.revoked_at is not null or r.expires_at < now() then
    raise exception 'INVALID_SHARE_CODE';
  end if;
  return json_build_object(
    'trip_id', r.trip_id,
    'title', (select title from trips where id = r.trip_id),
    'destination', (select destination from trips where id = r.trip_id),
    'expires_at', r.expires_at,
    'places', coalesce((select json_agg(to_jsonb(p) - 'geo_review' order by p.created_at)
                          from places p where p.id = any(r.place_ids) and p.deleted_at is null), '[]'::json),
    'categories', coalesce((select json_agg(json_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'icon', c.icon, 'color', c.color))
                              from categories c
                             where c.trip_id = r.trip_id and c.deleted_at is null
                               and c.id in (select category_id from places where id = any(r.place_ids))), '[]'::json)
  );
end $$;

revoke all on function public.create_place_share_code(uuid, uuid[]) from public, anon;
revoke all on function public.list_place_share_codes(uuid) from public, anon;
revoke all on function public.revoke_place_share_code(text) from public, anon;
revoke all on function public.read_place_share(text) from public, anon;
grant execute on function public.create_place_share_code(uuid, uuid[]) to authenticated;
grant execute on function public.list_place_share_codes(uuid) to authenticated;
grant execute on function public.revoke_place_share_code(text) to authenticated;
grant execute on function public.read_place_share(text) to authenticated;

commit;
