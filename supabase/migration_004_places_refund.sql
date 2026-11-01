-- =====================================================================
--  migration_004_places_refund.sql
--  구글이 거절한 호출(분당 한도 초과 등)은 과금되지 않으므로 앱 월 사용량에서도 되돌림
--  migration_003 이후 1회 실행 (다시 실행해도 안전)
-- =====================================================================
begin;

create or replace function public.refund_places_quota(p_trip uuid, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  update places_api_usage set count = greatest(count - 1, 0)
   where month = public.places_month() and kind = p_kind;
end $$;

revoke execute on function public.refund_places_quota(uuid, text) from public, anon;
grant  execute on function public.refund_places_quota(uuid, text) to authenticated;

commit;
