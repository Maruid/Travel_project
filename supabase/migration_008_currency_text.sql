-- =====================================================================
-- migration_008: 통화 코드 칸 char(3) → text (+ 영문 대문자 3글자 검사)
--  원인: Supabase Realtime 이 바뀐 행을 보낼 때 char(3) 값을 길이 없는 character(=1글자)로
--        변환해 'JPY' → 'J' 로 잘라 보냄. 그 값을 화면에서 다시 저장하면서 DB 에도 'J' 가 들어감
--  조치: 4개 칸을 text 로 바꾸고, 이미 잘린 값을 복구
-- =====================================================================
begin;

-- 1. 타입 변경 (char 의 뒤 공백 제거)
alter table public.trip_budgets
  alter column home_currency  type text using nullif(trim(home_currency), ''),
  alter column local_currency type text using nullif(trim(local_currency), '');
alter table public.trip_budgets
  alter column home_currency  set default 'KRW',
  alter column local_currency set default 'JPY';
alter table public.places   alter column price_currency type text using nullif(trim(price_currency), '');
alter table public.expenses alter column currency       type text using trim(currency);

-- 2. 잘린 예산 통화 복구 (J → JPY, K → KRW, 그 외 1~2글자는 기본값)
update public.trip_budgets set
  local_currency = case when local_currency ~ '^[A-Z]{3}$' then local_currency
                        when upper(local_currency) = 'J' then 'JPY'
                        when upper(local_currency) = 'K' then 'KRW'
                        else 'JPY' end,
  home_currency  = case when home_currency ~ '^[A-Z]{3}$' then home_currency
                        when upper(home_currency) = 'K' then 'KRW'
                        when upper(home_currency) = 'J' then 'JPY'
                        else 'KRW' end
 where local_currency !~ '^[A-Z]{3}$' or home_currency !~ '^[A-Z]{3}$'
    or local_currency is null or home_currency is null;

-- 3. 장소 가격 통화: 3글자가 아니면 그 여행의 현지 통화로
update public.places p set price_currency = b.local_currency
  from public.trip_budgets b
 where b.trip_id = p.trip_id and p.price_currency is not null and p.price_currency !~ '^[A-Z]{3}$';

-- 4. 지출 통화: 첫 글자가 내 통화와 같으면 내 통화, 아니면 현지 통화
update public.expenses e set currency =
       case when upper(left(e.currency, 1)) = left(b.home_currency, 1)
             and upper(left(e.currency, 1)) <> left(b.local_currency, 1) then b.home_currency
            else b.local_currency end
  from public.trip_budgets b
 where b.trip_id = e.trip_id and e.currency !~ '^[A-Z]{3}$';

-- 5. 앞으로는 영문 대문자 3글자만 허용
alter table public.trip_budgets
  add constraint trip_budgets_home_currency_code  check (home_currency  ~ '^[A-Z]{3}$'),
  add constraint trip_budgets_local_currency_code check (local_currency ~ '^[A-Z]{3}$');
alter table public.places
  add constraint places_price_currency_code check (price_currency is null or price_currency ~ '^[A-Z]{3}$');
alter table public.expenses
  add constraint expenses_currency_code check (currency ~ '^[A-Z]{3}$');

commit;

-- 확인: 모두 3글자여야 함
-- select local_currency, home_currency from trip_budgets;
-- select price_currency, count(*) from places group by 1;
-- select currency, count(*) from expenses group by 1;
