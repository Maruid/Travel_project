-- =====================================================================
--  Travel Web App - Supabase schema (draft v0.1)
--  - 정적 호스팅(GitHub Pages) + 브라우저에서 Supabase 직접 호출
--  - 권한: admin(사이트 관리자) / owner(여행 생성자) / member(링크 참여자)
--  - 모든 권한은 RLS + SECURITY DEFINER RPC 로만 제어 (페이지 숨김에 의존 X)
--  - 동기화: 클라이언트 UUID, soft delete(deleted_at), 서버 updated_at
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. 공통 트리거 함수
-- ---------------------------------------------------------------------

-- INSERT: created_by 채움 / UPDATE: 불변 컬럼 보호 + updated_at 갱신
create or replace function public.tg_row_meta()
returns trigger language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
    new.created_at := now();
  else
    -- 다른 trip 으로 행을 옮기거나 작성자를 위조하는 것 방지
    new.id         := old.id;
    new.trip_id    := old.trip_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;

-- trip 당 행 수 제한 (용량 500MB 보호). 사용: trigger ... execute function tg_row_limit('500')
create or replace function public.tg_row_limit()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_limit int := tg_argv[0]::int;
  v_count int;
begin
  execute format('select count(*) from public.%I where trip_id = $1 and deleted_at is null', tg_table_name)
    into v_count using new.trip_id;
  if v_count >= v_limit then
    raise exception 'ROW_LIMIT: % 는 여행당 최대 %개까지 등록할 수 있습니다', tg_table_name, v_limit;
  end if;
  return new;
end $$;


-- ---------------------------------------------------------------------
-- 1. 관리자 / 여행 생성 코드
-- ---------------------------------------------------------------------

create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.creation_codes (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique check (char_length(code) between 4 and 40),
  type        text not null check (type in ('one_time', 'permanent')),
  max_uses    int  check (max_uses is null or max_uses > 0),   -- null = 무제한 (permanent)
  used_count  int  not null default 0,
  expires_at  timestamptz,
  revoked     boolean not null default false,
  note        text check (char_length(note) <= 200),
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. 여행 / 멤버 / 초대 링크
-- ---------------------------------------------------------------------

create table public.trips (
  id                       uuid primary key default gen_random_uuid(),
  title                    text not null check (char_length(title) between 1 and 80),
  destination              text check (char_length(destination) <= 80),
  start_date               date,
  end_date                 date,
  timezone                 text not null default 'Asia/Seoul',   -- IANA, 일정은 현지 시간 기준
  cover_emoji              text check (char_length(cover_emoji) <= 8),
  allow_custom_categories  boolean not null default true,
  creation_code_id         uuid references public.creation_codes(id) on delete set null,
  created_by               uuid references auth.users(id),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

-- user_id 가 null 인 멤버 = "자리표시 멤버" (앱 미사용 동행자 / 브라우저 초기화로 연결 해제된 멤버)
--   → 결제자/정산 대상으로 쓸 수 있고, 링크 참여 시 이 자리를 "내 이름"으로 다시 차지(claim) 가능
create table public.trip_members (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  display_name  text not null check (char_length(display_name) between 1 and 20),
  role          text not null default 'member' check (role in ('owner', 'member')),
  color         text check (char_length(color) <= 20),
  last_seen_at  timestamptz,
  removed_at    timestamptz,                      -- 강퇴/탈퇴 (지출 이력 보존을 위해 행은 유지)
  created_at    timestamptz not null default now()
);
create unique index trip_members_active_user
  on public.trip_members(trip_id, user_id)
  where user_id is not null and removed_at is null;
create unique index trip_members_one_owner
  on public.trip_members(trip_id)
  where role = 'owner' and removed_at is null;
create index trip_members_user on public.trip_members(user_id);

create table public.trip_invites (
  trip_id     uuid primary key references public.trips(id) on delete cascade,
  token       text not null unique,
  rotated_at  timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 3. 권한 헬퍼 (RLS 재귀 방지를 위해 SECURITY DEFINER)
-- ---------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where user_id = auth.uid());
$$;

create or replace function public.is_trip_member(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip and user_id = auth.uid() and removed_at is null
  );
$$;

create or replace function public.is_trip_owner(p_trip uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip and user_id = auth.uid() and role = 'owner' and removed_at is null
  );
$$;

create or replace function public.new_token()
returns text language sql volatile as $$
  select encode(extensions.gen_random_bytes(12), 'hex');
$$;


-- ---------------------------------------------------------------------
-- 4. 콘텐츠 테이블 (모두 trip_id 소속, member 전원 편집 가능)
--    공통 컬럼: id(클라 UUID 허용), trip_id, created/updated_*, deleted_at
-- ---------------------------------------------------------------------

-- 4-1. 카테고리: trip_id null = 전역 기본 세트, 값 있음 = trip 커스텀
create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid references public.trips(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 20),
  kind        text not null check (kind in ('food', 'cafe', 'bar', 'spot', 'shop', 'lodging', 'transit', 'etc')),
  icon        text check (char_length(icon) <= 40),     -- Font Awesome 클래스명
  color       text check (char_length(color) <= 20),
  sort_order  double precision not null default 0,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index categories_trip on public.categories(trip_id);

-- 4-2. 장소 (맛집/명소/숙소/기준점 통합)
create table public.places (
  id              uuid primary key default gen_random_uuid(),
  trip_id         uuid not null references public.trips(id) on delete cascade,
  category_id     uuid references public.categories(id) on delete set null,
  name            text not null check (char_length(name) between 1 and 100),
  zone            text check (char_length(zone) <= 50),
  lat             double precision check (lat between -90 and 90),
  lng             double precision check (lng between -180 and 180),
  signature       text check (char_length(signature) <= 200),     -- 대표 메뉴/볼거리
  description     text check (char_length(description) <= 2000),
  visit_tip       text check (char_length(visit_tip) <= 300),     -- 웨이팅/방문 팁
  warn_badge      text check (char_length(warn_badge) <= 30),     -- 휴무 주의 등
  price_min       numeric(12,2),
  price_max       numeric(12,2),
  price_currency  char(3),
  source          text check (char_length(source) <= 50),         -- 출처(유튜버 등)
  youtube_url     text check (char_length(youtube_url) <= 500),
  maps_url        text check (char_length(maps_url) <= 500),
  map_query       text check (char_length(map_query) <= 200),
  is_anchor       boolean not null default false,                 -- 거리 계산 기준점(숙소/역)
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index places_trip on public.places(trip_id);

-- 4-3. 일정: 날짜별 헤더 + 항목
create table public.itinerary_days (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  day_date    date not null,
  title       text check (char_length(title) <= 80),
  badge       text check (char_length(badge) <= 20),
  summary     text check (char_length(summary) <= 300),
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index itinerary_days_unique on public.itinerary_days(trip_id, day_date) where deleted_at is null;

create table public.itinerary_items (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  day_date    date not null,
  start_time  time,                                   -- 현지 시간 (trips.timezone)
  title       text not null check (char_length(title) between 1 and 100),
  description text check (char_length(description) <= 1000),
  alert       text check (char_length(alert) <= 300),
  icon        text check (char_length(icon) <= 40),
  place_id    uuid references public.places(id) on delete set null,
  sort_order  double precision not null default 0,    -- 같은 시간대 내 순서 (분수 정렬)
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index itinerary_items_trip_day on public.itinerary_items(trip_id, day_date);

-- 4-4. 가이드 카드 (마크다운, USJ 탭 / 실전팁 탭 대체)
create table public.guides (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 80),
  body_md     text not null default '' check (char_length(body_md) <= 20000),
  color       text check (char_length(color) <= 20),
  icon        text check (char_length(icon) <= 40),
  day_date    date,                                   -- 지정 시 일정 탭 해당 날짜에도 노출
  pinned      boolean not null default false,
  sort_order  double precision not null default 0,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index guides_trip on public.guides(trip_id);

-- 4-5. 가계부
create table public.trip_budgets (
  trip_id         uuid primary key references public.trips(id) on delete cascade,
  home_currency   char(3) not null default 'KRW',
  local_currency  char(3) not null default 'JPY',
  rate            numeric(14,6) not null default 1,   -- 현지통화 1단위 = home 통화 rate
  base_amount     numeric(14,2) not null default 0,   -- 기본 환전금 (현지통화)
  updated_by      uuid,
  updated_at      timestamptz not null default now()
);

create table public.budget_topups (                  -- 추가 환전 / 카드 충전
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  topup_date  date not null default current_date,
  amount      numeric(14,2) not null check (amount > 0),
  note        text check (char_length(note) <= 100),
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index budget_topups_trip on public.budget_topups(trip_id);

create table public.expenses (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  spent_date  date not null,
  spent_time  time,
  place_name  text not null check (char_length(place_name) between 1 and 100),
  place_id    uuid references public.places(id) on delete set null,
  category    text not null default '기타' check (char_length(category) <= 20),
  amount      numeric(14,2) not null check (amount > 0),
  currency    char(3) not null,
  method      text not null default 'card' check (method in ('cash', 'card', 'other')),
  paid_by     uuid references public.trip_members(id) on delete set null,
  split_with  uuid[],                                 -- null = 전체 멤버 균등 (정산용)
  note        text check (char_length(note) <= 200),
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index expenses_trip on public.expenses(trip_id);

-- 4-6. To-Do / 위시리스트
create table public.todos (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references public.trips(id) on delete cascade,
  kind        text not null default 'todo' check (kind in ('todo', 'place', 'shop')),
  title       text not null check (char_length(title) between 1 and 100),
  note        text check (char_length(note) <= 300),
  place_id    uuid references public.places(id) on delete set null,
  done        boolean not null default false,
  sort_order  double precision not null default 0,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index todos_trip on public.todos(trip_id);


-- ---------------------------------------------------------------------
-- 5. 트리거 연결 (메타 + 행 수 제한)
-- ---------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
      ('categories',      '50'),
      ('places',          '500'),
      ('itinerary_days',  '60'),
      ('itinerary_items', '1000'),
      ('guides',          '200'),
      ('budget_topups',   '200'),
      ('expenses',        '3000'),
      ('todos',           '1000')
    ) as t(tbl, lim)
  loop
    execute format('create trigger %I before insert or update on public.%I
                    for each row execute function public.tg_row_meta()', r.tbl || '_meta', r.tbl);
    execute format('create trigger %I before insert on public.%I
                    for each row when (new.trip_id is not null)
                    execute function public.tg_row_limit(%L)', r.tbl || '_limit', r.tbl, r.lim);
  end loop;
end $$;

create or replace function public.tg_budget_meta()
returns trigger language plpgsql as $$
begin
  new.trip_id    := old.trip_id;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger trip_budgets_meta before update on public.trip_budgets
  for each row execute function public.tg_budget_meta();

create or replace function public.tg_trip_touch()
returns trigger language plpgsql as $$
begin
  new.id := old.id; new.created_by := old.created_by; new.created_at := old.created_at;
  new.creation_code_id := old.creation_code_id;
  new.updated_at := now();
  return new;
end $$;
create trigger trips_touch before update on public.trips
  for each row execute function public.tg_trip_touch();


-- ---------------------------------------------------------------------
-- 6. RLS
-- ---------------------------------------------------------------------
alter table public.admins          enable row level security;
alter table public.creation_codes  enable row level security;
alter table public.trips           enable row level security;
alter table public.trip_members    enable row level security;
alter table public.trip_invites    enable row level security;
alter table public.trip_budgets    enable row level security;

-- admins: 클라이언트 직접 접근 없음 (is_admin() RPC 로만 확인)

-- creation_codes: 관리자만 조회/수정 (생성은 admin_create_code RPC)
create policy codes_admin_select on public.creation_codes for select using (public.is_admin());
create policy codes_admin_update on public.creation_codes for update using (public.is_admin());

-- trips: 멤버/관리자 조회, owner 만 정보 수정, owner/관리자 삭제, 생성은 create_trip RPC
create policy trips_select on public.trips for select
  using (public.is_trip_member(id) or public.is_admin());
create policy trips_update on public.trips for update
  using (public.is_trip_owner(id)) with check (public.is_trip_owner(id));
create policy trips_delete on public.trips for delete
  using (public.is_trip_owner(id) or public.is_admin());

-- trip_members: 같은 trip 멤버끼리 조회. 변경은 전부 RPC
create policy members_select on public.trip_members for select
  using (public.is_trip_member(trip_id) or public.is_admin());

-- trip_invites: 멤버 누구나 링크 조회(공유용). 재발급은 owner RPC
create policy invites_select on public.trip_invites for select
  using (public.is_trip_member(trip_id));

-- trip_budgets: 멤버 조회/수정
create policy budgets_select on public.trip_budgets for select
  using (public.is_trip_member(trip_id) or public.is_admin());
create policy budgets_update on public.trip_budgets for update
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

-- 콘텐츠 테이블 공통: 멤버 조회/추가/수정. DELETE 정책 없음 → 삭제는 deleted_at 설정(soft delete)
--   soft delete 된 행도 조회 허용: 오프라인 클라이언트가 삭제 사실(tombstone)을 받아야 하므로
do $$
declare
  t text;
begin
  foreach t in array array['places','itinerary_days','itinerary_items','guides','budget_topups','expenses','todos']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (public.is_trip_member(trip_id) or public.is_admin())', t || '_select', t);
    execute format('create policy %I on public.%I for insert with check (public.is_trip_member(trip_id))', t || '_insert', t);
    execute format('create policy %I on public.%I for update using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id))', t || '_update', t);
  end loop;
end $$;

-- categories: 전역 기본 세트는 누구나 조회, trip 커스텀은 allow_custom_categories 가 켜진 경우만 편집
alter table public.categories enable row level security;
create policy categories_select on public.categories for select
  using (trip_id is null or public.is_trip_member(trip_id) or public.is_admin());
create policy categories_insert on public.categories for insert
  with check (
    trip_id is not null
    and public.is_trip_member(trip_id)
    and exists (select 1 from public.trips where id = trip_id and allow_custom_categories)
  );
create policy categories_update on public.categories for update
  using (
    trip_id is not null
    and public.is_trip_member(trip_id)
    and exists (select 1 from public.trips where id = trip_id and allow_custom_categories)
  )
  with check (trip_id is not null and public.is_trip_member(trip_id));


-- ---------------------------------------------------------------------
-- 7. RPC - 참여 / 멤버
-- ---------------------------------------------------------------------

-- 링크 미리보기: 참여 전이라 RLS 로 못 보는 정보를 최소한만 노출
create or replace function public.preview_invite(p_token text)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  v_trip uuid;
begin
  select trip_id into v_trip from trip_invites where token = p_token;
  if v_trip is null then raise exception 'INVALID_INVITE'; end if;

  return json_build_object(
    'trip', (select json_build_object('id', id, 'title', title, 'destination', destination,
                                      'start_date', start_date, 'end_date', end_date, 'cover_emoji', cover_emoji)
             from trips where id = v_trip),
    'already_member', public.is_trip_member(v_trip),
    'claimable_members', coalesce((
      select json_agg(json_build_object('id', id, 'display_name', display_name))
      from trip_members
      where trip_id = v_trip and user_id is null and removed_at is null
    ), '[]'::json)
  );
end $$;

-- 링크로 참여 (익명 로그인 후 호출). p_claim_member 지정 시 자리표시 멤버를 내 것으로 연결
create or replace function public.join_trip(p_token text, p_display_name text, p_claim_member uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_trip uuid;
  v_member uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select trip_id into v_trip from trip_invites where token = p_token;
  if v_trip is null then raise exception 'INVALID_INVITE'; end if;

  select id into v_member from trip_members
   where trip_id = v_trip and user_id = auth.uid() and removed_at is null;
  if v_member is not null then
    update trip_members set last_seen_at = now() where id = v_member;
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

-- 앱 미사용 동행자 등 자리표시 멤버 추가 (멤버 누구나)
create or replace function public.add_placeholder_member(p_trip uuid, p_display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  if (select count(*) from trip_members where trip_id = p_trip and removed_at is null) >= 30 then
    raise exception 'MEMBER_LIMIT';
  end if;
  insert into trip_members(trip_id, user_id, display_name, role)
  values (p_trip, null, trim(p_display_name), 'member')
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.update_my_name(p_trip uuid, p_display_name text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update trip_members set display_name = trim(p_display_name)
   where trip_id = p_trip and user_id = auth.uid() and removed_at is null;
  if not found then raise exception 'FORBIDDEN'; end if;
end $$;

-- 앱 열 때 호출. 30분 내 재호출은 쓰기 생략 (활성 사용자 통계용)
create or replace function public.touch_trip(p_trip uuid)
returns void language sql security definer set search_path = public as $$
  update trip_members set last_seen_at = now()
   where trip_id = p_trip and user_id = auth.uid() and removed_at is null
     and (last_seen_at is null or last_seen_at < now() - interval '30 minutes');
$$;

create or replace function public.leave_trip(p_trip uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.is_trip_owner(p_trip) then raise exception 'OWNER_MUST_TRANSFER_FIRST'; end if;
  update trip_members set removed_at = now()
   where trip_id = p_trip and user_id = auth.uid() and removed_at is null;
end $$;

-- 내가 속한 여행 목록 (홈 화면)
create or replace function public.my_trips()
returns table (trip_id uuid, title text, destination text, start_date date, end_date date,
               cover_emoji text, my_role text, member_count bigint)
language sql stable security definer set search_path = public as $$
  select t.id, t.title, t.destination, t.start_date, t.end_date, t.cover_emoji, m.role,
         (select count(*) from trip_members x where x.trip_id = t.id and x.removed_at is null)
    from trip_members m join trips t on t.id = m.trip_id
   where m.user_id = auth.uid() and m.removed_at is null
   order by t.start_date desc nulls last;
$$;


-- ---------------------------------------------------------------------
-- 8. RPC - owner 전용
-- ---------------------------------------------------------------------

create or replace function public.regenerate_invite(p_trip uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_token text := public.new_token();
begin
  if not public.is_trip_owner(p_trip) then raise exception 'OWNER_ONLY'; end if;
  update trip_invites set token = v_token, rotated_at = now() where trip_id = p_trip;
  return v_token;
end $$;

-- 강퇴: 이력 보존을 위해 removed_at 만 설정. 재참여를 막으려면 regenerate_invite 를 함께 호출
create or replace function public.kick_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_role text;
begin
  select trip_id, role into v_trip, v_role from trip_members where id = p_member and removed_at is null;
  if v_trip is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_trip_owner(v_trip) then raise exception 'OWNER_ONLY'; end if;
  if v_role = 'owner' then raise exception 'CANNOT_KICK_OWNER'; end if;
  update trip_members set removed_at = now() where id = p_member;
end $$;

-- 연결 해제: 브라우저 초기화로 접근을 잃은 멤버를 자리표시로 되돌려 다시 claim 가능하게
create or replace function public.unlink_member(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_role text;
begin
  select trip_id, role into v_trip, v_role from trip_members where id = p_member and removed_at is null;
  if v_trip is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_trip_owner(v_trip) then raise exception 'OWNER_ONLY'; end if;
  if v_role = 'owner' then raise exception 'CANNOT_UNLINK_OWNER'; end if;
  update trip_members set user_id = null where id = p_member;
end $$;

create or replace function public.transfer_owner(p_member uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v_trip uuid; v_user uuid;
begin
  select trip_id, user_id into v_trip, v_user from trip_members where id = p_member and removed_at is null;
  if v_trip is null or v_user is null then raise exception 'NOT_FOUND'; end if;
  if not public.is_trip_owner(v_trip) then raise exception 'OWNER_ONLY'; end if;
  update trip_members set role = 'member' where trip_id = v_trip and role = 'owner' and removed_at is null;
  update trip_members set role = 'owner'  where id = p_member;
end $$;


-- ---------------------------------------------------------------------
-- 9. RPC - 여행 생성 (생성 코드 필요)
-- ---------------------------------------------------------------------
create or replace function public.create_trip(
  p_code            text,
  p_title           text,
  p_owner_name      text,
  p_destination     text default null,
  p_start_date      date default null,
  p_end_date        date default null,
  p_timezone        text default 'Asia/Seoul',
  p_home_currency   char(3) default 'KRW',
  p_local_currency  char(3) default 'KRW'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_code creation_codes%rowtype;
  v_trip uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  -- 동시 사용 시 초과 방지를 위해 행 잠금
  select * into v_code from creation_codes where code = p_code for update;
  if v_code.id is null or v_code.revoked
     or (v_code.expires_at is not null and v_code.expires_at < now())
     or (v_code.max_uses is not null and v_code.used_count >= v_code.max_uses) then
    raise exception 'INVALID_CODE';
  end if;
  update creation_codes set used_count = used_count + 1 where id = v_code.id;

  insert into trips(title, destination, start_date, end_date, timezone, creation_code_id, created_by)
  values (trim(p_title), p_destination, p_start_date, p_end_date, p_timezone, v_code.id, auth.uid())
  returning id into v_trip;

  insert into trip_members(trip_id, user_id, display_name, role, last_seen_at)
  values (v_trip, auth.uid(), trim(p_owner_name), 'owner', now());

  insert into trip_budgets(trip_id, home_currency, local_currency)
  values (v_trip, p_home_currency, p_local_currency);

  insert into trip_invites(trip_id, token) values (v_trip, public.new_token());

  return v_trip;
end $$;


-- ---------------------------------------------------------------------
-- 10. RPC - 관리자
-- ---------------------------------------------------------------------
create or replace function public.admin_create_code(
  p_type       text,
  p_max_uses   int default null,
  p_expires_at timestamptz default null,
  p_note       text default null,
  p_code       text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_code text := coalesce(p_code, upper(substr(public.new_token(), 1, 10)));
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  insert into creation_codes(code, type, max_uses, expires_at, note, created_by)
  values (v_code, p_type,
          case when p_type = 'one_time' then 1 else p_max_uses end,
          p_expires_at, p_note, auth.uid());
  return v_code;
end $$;

create or replace function public.admin_list_trips()
returns table (trip_id uuid, title text, destination text, start_date date, end_date date,
               owner_name text, member_count bigint, item_count bigint,
               last_active_at timestamptz, created_at timestamptz, creation_code text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return query
  select t.id, t.title, t.destination, t.start_date, t.end_date,
         (select m.display_name from trip_members m where m.trip_id = t.id and m.role = 'owner' and m.removed_at is null),
         (select count(*) from trip_members m where m.trip_id = t.id and m.removed_at is null),
         (select count(*) from places    x where x.trip_id = t.id and x.deleted_at is null)
       + (select count(*) from expenses  x where x.trip_id = t.id and x.deleted_at is null)
       + (select count(*) from todos     x where x.trip_id = t.id and x.deleted_at is null)
       + (select count(*) from itinerary_items x where x.trip_id = t.id and x.deleted_at is null),
         (select max(m.last_seen_at) from trip_members m where m.trip_id = t.id),
         t.created_at,
         (select c.code from creation_codes c where c.id = t.creation_code_id)
    from trips t
   order by t.created_at desc;
end $$;

create or replace function public.admin_stats()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return json_build_object(
    'trips',         (select count(*) from trips),
    'members',       (select count(*) from trip_members where removed_at is null and user_id is not null),
    'active_1d',     (select count(distinct user_id) from trip_members where last_seen_at > now() - interval '1 day'),
    'active_7d',     (select count(distinct user_id) from trip_members where last_seen_at > now() - interval '7 days'),
    'active_30d',    (select count(distinct user_id) from trip_members where last_seen_at > now() - interval '30 days'),
    'db_size_bytes', pg_database_size(current_database()),
    'codes_active',  (select count(*) from creation_codes
                       where not revoked and (expires_at is null or expires_at > now())
                         and (max_uses is null or used_count < max_uses))
  );
end $$;


-- ---------------------------------------------------------------------
-- 11. keepalive (GitHub Actions 에서 anon key 로 호출)
-- ---------------------------------------------------------------------
create or replace function public.ping()
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from categories where trip_id is null;
$$;


-- ---------------------------------------------------------------------
-- 12. 함수 실행 권한
--   익명 로그인 사용자도 role 은 authenticated. 비로그인(anon)은 ping 만 허용
-- ---------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon;
grant  execute on all functions in schema public to authenticated;
grant  execute on function public.ping() to anon;


-- ---------------------------------------------------------------------
-- 12-2. 테이블 접근 권한 (Automatically expose new tables = OFF 대응)
--   GRANT 는 "테이블에 접근할 수 있는가", RLS 는 "어떤 행에 접근할 수 있는가"
--   둘 다 통과해야 하므로, 여기서는 RLS 정책이 있는 동작만 열어줍니다.
--   anon(비로그인)에게는 테이블 권한을 주지 않습니다 (ping 은 함수로만).
-- ---------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- 콘텐츠 테이블: 조회/추가/수정 (삭제는 soft delete 이므로 DELETE 권한 없음)
grant select, insert, update on
  public.places, public.itinerary_days, public.itinerary_items, public.guides,
  public.budget_topups, public.expenses, public.todos, public.categories
to authenticated;

-- 여행: 조회/수정(owner)/삭제(owner, admin). 생성은 create_trip RPC
grant select, update, delete on public.trips to authenticated;

-- 예산: 조회/수정
grant select, update on public.trip_budgets to authenticated;

-- 멤버, 초대 링크: 조회만. 변경은 전부 RPC
grant select on public.trip_members, public.trip_invites to authenticated;

-- 생성 코드: 관리자 조회/수정 (RLS 로 관리자만 통과)
grant select, update on public.creation_codes to authenticated;

-- admins: 권한 없음 (is_admin() 함수로만 확인)


-- ---------------------------------------------------------------------
-- 13. Realtime (RLS 가 그대로 적용됨)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table
  public.trips, public.trip_members, public.trip_budgets, public.categories,
  public.places, public.itinerary_days, public.itinerary_items, public.guides,
  public.budget_topups, public.expenses, public.todos;


-- ---------------------------------------------------------------------
-- 14. 기본 카테고리 세트 (전역)
-- ---------------------------------------------------------------------
insert into public.categories(trip_id, name, kind, icon, color, sort_order) values
  (null, '식당',       'food',    'fa-utensils',        '#f43f5e', 10),
  (null, '카페·디저트', 'cafe',    'fa-mug-saucer',      '#c084fc', 20),
  (null, '술집',       'bar',     'fa-wine-glass',      '#f59e0b', 30),
  (null, '관광·명소',   'spot',    'fa-landmark',        '#3b82f6', 40),
  (null, '쇼핑',       'shop',    'fa-bag-shopping',    '#10b981', 50),
  (null, '숙소',       'lodging', 'fa-hotel',           '#fbbf24', 60),
  (null, '교통 거점',   'transit', 'fa-train-subway',    '#94a3b8', 70),
  (null, '기타',       'etc',     'fa-location-dot',    '#64748b', 80);

-- =====================================================================
-- 관리자 등록 (최초 1회, Supabase SQL Editor 에서 직접 실행)
--   1) 사이트에서 Google 로그인으로 관리자 계정 생성
--   2) Authentication > Users 에서 uid 확인 후:
--   insert into public.admins(user_id) values ('<your-uid>');
-- =====================================================================
