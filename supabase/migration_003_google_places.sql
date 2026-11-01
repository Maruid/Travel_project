-- =====================================================================
--  migration_003_google_places.sql
--  migration_002 이후 1회 실행 (다시 실행해도 안전)
--
--  1) places 에 구글 장소 정보 컬럼 추가 (Places API 로 채움, 사용자가 수정 가능)
--  2) Places API 월 사용량 집계 + 한도 (무료량 1,000건/월 → 앱 한도 900건)
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. places 컬럼
-- ---------------------------------------------------------------------
alter table public.places
  add column if not exists google_place_id   text  check (char_length(google_place_id) <= 300),
  add column if not exists opening_hours     jsonb,  -- { weekday: ["월요일: 11:00~22:00", ...], periods: [...], closedDays: [0..6] }
  add column if not exists rating            numeric(2,1) check (rating between 0 and 5),
  add column if not exists rating_count      int    check (rating_count >= 0),
  add column if not exists business_status   text   check (business_status in ('OPERATIONAL', 'CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY')),
  add column if not exists phone             text   check (char_length(phone) <= 40),
  add column if not exists website           text   check (char_length(website) <= 500),
  add column if not exists google_synced_at  timestamptz;

-- opening_hours 크기 제한 (용량 보호)
alter table public.places drop constraint if exists places_opening_hours_size;
alter table public.places add constraint places_opening_hours_size
  check (opening_hours is null or pg_column_size(opening_hours) <= 8000);


-- ---------------------------------------------------------------------
-- 2. Places API 월 사용량
--    month: 매달 1일 (구글 무료량 초기화 기준인 미국 태평양 시간으로 계산)
--    kind : 'details' (Place Details Enterprise) / 'search' (Text Search IDs Only)
-- ---------------------------------------------------------------------
create table if not exists public.places_api_usage (
  month  date not null,
  kind   text not null check (kind in ('details', 'search')),
  count  int  not null default 0,
  primary key (month, kind)
);
alter table public.places_api_usage enable row level security;   -- 정책 없음: RPC 로만 접근

create or replace function public.places_month()
returns date language sql stable as $$
  select date_trunc('month', now() at time zone 'America/Los_Angeles')::date;
$$;

-- 호출 직전에 1건 차감. 한도를 넘으면 예외 (증가분도 롤백)
create or replace function public.consume_places_quota(p_trip uuid, p_kind text)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_limit int := 900;
  v_count int;
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('details', 'search') then raise exception 'BAD_REQUEST'; end if;
  insert into places_api_usage(month, kind, count) values (public.places_month(), p_kind, 1)
  on conflict (month, kind) do update set count = places_api_usage.count + 1
  returning count into v_count;
  if v_count > v_limit then raise exception 'PLACES_LIMIT'; end if;
  return v_limit - v_count;
end $$;

-- 이번 달 남은 건수 (일괄 가져오기 전에 확인, 관리자 화면 표시)
create or replace function public.places_quota_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'month',   public.places_month(),
    'limit',   900,
    'details', coalesce((select count from places_api_usage where month = public.places_month() and kind = 'details'), 0),
    'search',  coalesce((select count from places_api_usage where month = public.places_month() and kind = 'search'), 0)
  );
$$;


-- ---------------------------------------------------------------------
-- 3. 권한
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
grant  execute on function public.ping() to anon;

commit;
