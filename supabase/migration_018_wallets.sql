-- =====================================================================
-- migration_018: 가계부 지갑 (공금) · 충전 · 인출
--  - trip_budgets.money_mode: 돈 쓰는 방식
--      personal  : 각자 내고 나중에 정산 (지금까지와 같음. 기본 환전금 · 추가 환전은 "예산" 숫자)
--      pool_cash : 공금 현금 지갑
--      pool_card : 공금 카드(충전식, 이름은 직접) + 공금 현금
--  - trip_wallets: 공금 지갑 (이름 · 카드/현금 · 들고 있는 사람)
--  - budget_topups 확장: kind = budget(예전 예산 추가) | charge(지갑에 충전 · 환전) | withdraw(지갑 → 지갑, ATM 인출)
--      wallet_id: 받는 지갑 · from_wallet: 인출할 때 빼는 지갑 · home_amount: 실제로 빠져나간 원화
--      shares: 충전을 누가 얼마 넣었나 {member_id: 현지 금액}, null 이면 그때 멤버 모두 같은 금액
--  - expenses.wallet_id: 공금 지갑에서 낸 지출 (null 이면 paid_by 개인 돈)
--  정산: 각자 (넣은 충전 + 개인 돈으로 낸 지출) - (쓴 몫) - (들고 있는 공금 잔액) → 송금 목록 (앱 settle.js)
--  기존 여행은 money_mode = personal 로 시작해서 정산 결과가 그대로입니다.
-- 앞선 migration (015) 을 먼저 실행하세요. 다시 실행해도 안전합니다.
-- =====================================================================
begin;

alter table public.trip_budgets add column if not exists money_mode text not null default 'personal';
do $$ begin
  alter table public.trip_budgets add constraint trip_budgets_money_mode check (money_mode in ('personal', 'pool_cash', 'pool_card'));
exception when duplicate_object then null; end $$;

create table if not exists public.trip_wallets (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  kind        text not null default 'cash' check (kind in ('card', 'cash')),
  name        text not null check (char_length(name) between 1 and 20),
  holder      uuid references public.trip_members(id) on delete set null,
  sort_order  double precision not null default 0,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists trip_wallets_trip on public.trip_wallets(trip_id);

drop trigger if exists trip_wallets_meta on public.trip_wallets;
create trigger trip_wallets_meta before insert or update on public.trip_wallets
  for each row execute function public.tg_row_meta();
drop trigger if exists trip_wallets_limit on public.trip_wallets;
create trigger trip_wallets_limit before insert on public.trip_wallets
  for each row when (new.trip_id is not null) execute function public.tg_row_limit('10');

alter table public.trip_wallets enable row level security;
drop policy if exists trip_wallets_select on public.trip_wallets;
create policy trip_wallets_select on public.trip_wallets for select
  using (public.is_trip_member(trip_id) or public.is_admin());
drop policy if exists trip_wallets_insert on public.trip_wallets;
create policy trip_wallets_insert on public.trip_wallets for insert
  with check (public.is_trip_member(trip_id));
drop policy if exists trip_wallets_update on public.trip_wallets;
create policy trip_wallets_update on public.trip_wallets for update
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));
grant select, insert, update on public.trip_wallets to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.trip_wallets;
exception when duplicate_object then null; end $$;

alter table public.budget_topups
  add column if not exists kind text not null default 'budget',
  add column if not exists wallet_id uuid references public.trip_wallets(id) on delete set null,
  add column if not exists from_wallet uuid references public.trip_wallets(id) on delete set null,
  add column if not exists home_amount numeric(14,2),
  add column if not exists shares jsonb;
do $$ begin
  alter table public.budget_topups add constraint budget_topups_kind check (kind in ('budget', 'charge', 'withdraw'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.budget_topups add constraint budget_topups_home_amount check (home_amount is null or home_amount > 0);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.budget_topups add constraint budget_topups_shares check (
    shares is null or (jsonb_typeof(shares) = 'object' and pg_column_size(shares) < 4000));
exception when duplicate_object then null; end $$;

alter table public.expenses
  add column if not exists wallet_id uuid references public.trip_wallets(id) on delete set null;

commit;
