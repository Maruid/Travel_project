-- =====================================================================
-- migration_013: 날짜별 "오늘 묵는 숙소"
--  - itinerary_days.stay_place_id: 그날 밤 묵는 숙소(장소). 비워두면 앞 날의 숙소가 이어짐 (앱에서 계산)
--  - 동선 지도의 숙소 출발·복귀, AI 일정 짜기가 추측 대신 이 값을 씀
--  - 숙소 장소를 지우면 자동으로 비워짐 (on delete set null)
-- =====================================================================
begin;

alter table public.itinerary_days
  add column if not exists stay_place_id uuid references public.places(id) on delete set null;

-- 같은 여행의 장소만 고를 수 있게
create or replace function public.tg_day_stay_check()
returns trigger language plpgsql as $$
begin
  if new.stay_place_id is not null
     and not exists (select 1 from public.places p where p.id = new.stay_place_id and p.trip_id = new.trip_id) then
    raise exception 'BAD_REQUEST';
  end if;
  return new;
end $$;
drop trigger if exists itinerary_days_stay_check on public.itinerary_days;
create trigger itinerary_days_stay_check before insert or update of stay_place_id on public.itinerary_days
  for each row execute function public.tg_day_stay_check();
revoke all on function public.tg_day_stay_check() from public, anon;

commit;
