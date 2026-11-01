-- =====================================================================
-- migration_007: 오래된 기록 자동 정리 + 여행 생성 코드 완전 삭제
--  - keepalive(GitHub Actions, 3일마다)가 부르는 ping() 안에서 cleanup_expired() 실행
--  - 정리 기준
--      기기 연결 코드      : 만료 1일 후
--      장소 공유 코드      : 만료되거나 끈 지 7일 후
--      AI 사용량          : 90일 지난 날짜
--      구글 장소 사용량    : 12개월 지난 달
--      여행 생성 코드      : 만료·소진·폐기된 지 90일 후 (여행은 남고 "생성 코드" 칸만 비워짐)
-- =====================================================================
begin;

-- 1. 생성 코드가 "끝난" 시각 기록 (폐기·소진은 시각이 없어서 칸 추가)
alter table public.creation_codes add column if not exists ended_at timestamptz;

create or replace function public.tg_creation_code_ended()
returns trigger language plpgsql as $$
begin
  if new.ended_at is null and (new.revoked or (new.max_uses is not null and new.used_count >= new.max_uses)) then
    new.ended_at := now();
  end if;
  return new;
end $$;
drop trigger if exists creation_code_ended on public.creation_codes;
create trigger creation_code_ended before update on public.creation_codes
  for each row execute function public.tg_creation_code_ended();

-- 이미 폐기·소진된 코드는 지금부터 90일 세기 시작
update public.creation_codes set ended_at = now()
 where ended_at is null and (revoked or (max_uses is not null and used_count >= max_uses));

-- 2. 정리 함수 (외부에서 직접 호출 불가, ping 안에서만)
create or replace function public.cleanup_expired()
returns json language plpgsql security definer set search_path = public as $$
declare
  n_dev int; n_share int; n_ai int; n_places int; n_codes int;
begin
  delete from device_link_codes where expires_at < now() - interval '1 day';
  get diagnostics n_dev = row_count;

  delete from place_share_codes
   where least(expires_at, coalesce(revoked_at, expires_at)) < now() - interval '7 days';
  get diagnostics n_share = row_count;

  delete from ai_usage where day < (now() at time zone 'utc')::date - 90;
  get diagnostics n_ai = row_count;

  delete from places_api_usage where month < (public.places_month() - interval '12 months')::date;
  get diagnostics n_places = row_count;

  delete from creation_codes
   where coalesce(ended_at, case when expires_at < now() then expires_at end) < now() - interval '90 days';
  get diagnostics n_codes = row_count;

  return json_build_object('device_codes', n_dev, 'share_codes', n_share, 'ai_usage', n_ai,
                           'places_usage', n_places, 'creation_codes', n_codes);
end $$;
revoke all on function public.cleanup_expired() from public, anon, authenticated;

-- 3. ping: 기존처럼 숫자를 돌려주되 정리도 같이 (keepalive 가 3일마다 호출)
create or replace function public.ping()
returns int language plpgsql volatile security definer set search_path = public as $$
begin
  perform public.cleanup_expired();
  return (select count(*)::int from categories where trip_id is null);
end $$;
grant execute on function public.ping() to anon, authenticated;

-- 4. 관리자: 끝난 생성 코드 완전 삭제 (사용 가능한 코드는 먼저 폐기해야 함)
--    p_id 를 주면 그 코드 하나, null 이면 끝난 코드 전부
create or replace function public.admin_delete_codes(p_id uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  delete from creation_codes
   where (p_id is null or id = p_id)
     and (revoked or (max_uses is not null and used_count >= max_uses)
          or (expires_at is not null and expires_at < now()));
  get diagnostics n = row_count;
  if p_id is not null and n = 0 then raise exception 'CODE_IN_USE'; end if;
  return n;
end $$;
revoke all on function public.admin_delete_codes(uuid) from public, anon;
grant execute on function public.admin_delete_codes(uuid) to authenticated;

commit;
