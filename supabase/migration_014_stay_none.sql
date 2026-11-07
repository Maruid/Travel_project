-- =====================================================================
-- migration_014: "이 날 밤 숙소 없음"
--  - itinerary_days.stay_none: 그날 밤 숙소에서 자지 않음 (귀국 · 야간 이동 · 공항 대기)
--  - 앞 날 숙소가 이어지는 것을 여기서 끊음. 다음에 숙소를 고른 날부터 다시 이어짐
--  - 여행 마지막 날은 정하지 않으면 앱이 자동으로 "숙소 없음"으로 봄 (DB 값은 없음)
-- =====================================================================
begin;
alter table public.itinerary_days add column if not exists stay_none boolean not null default false;
commit;
