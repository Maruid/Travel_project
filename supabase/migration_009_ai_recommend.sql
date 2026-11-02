-- =====================================================================
-- migration_009: AI 장소 추천 권한 · 권한 요청 · AI 사용 기록(토큰) · 추천 결과 저장
--  - AI 추천은 관리자는 무제한, 그 외에는 관리자가 허용한 Google 로그인 사용자만
--  - 허용: 기간(만료일) 또는 영구(expires_at null). 관리자가 언제든 끌 수 있음(revoked_at)
--  - 한도: 사람별 하루 횟수(daily_limit, 기본 10). 하루 기준은 한국 시간 0시
--  - 사용 기록(ai_calls): AI 정보 채우기·추천 모두 호출마다 토큰 수와 걸린 시간 기록
--      시작 시 ok=null 로 넣어 횟수를 먼저 잡고, 끝나면 결과로 갱신.
--      실패(ok=false)는 한도에서 빠짐 = 자동 환불
--  - 추천 결과(recommend_cache): 같은 여행·키워드·범위는 24시간 재사용(한도 안 씀), 여행 멤버 공유
--
--  ★ 새로 허용할 때 기본 한도 바꾸기:
--      alter table public.ai_grants alter column daily_limit set default 10;   -- 10 을 원하는 값으로
--    이미 허용된 사람의 한도는 관리자 화면 → AI 추천 권한 에서 사람마다 수정
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. 테이블 (RLS 켜고 정책 없음 → 아래 함수로만 접근)
-- ---------------------------------------------------------------------
create table if not exists public.ai_grants (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  daily_limit  int  not null default 10 check (daily_limit between 0 and 1000),
  expires_at   timestamptz,                 -- null = 영구
  revoked_at   timestamptz,                 -- 관리자가 끈 시각 (null = 사용 중)
  note         text check (char_length(note) <= 200),
  granted_by   uuid,
  granted_at   timestamptz not null default now()
);

create table if not exists public.ai_grant_requests (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  message       text check (char_length(message) <= 200),
  requested_at  timestamptz not null default now()
);

create table if not exists public.ai_calls (
  id             bigint generated always as identity primary key,
  user_id        uuid,
  trip_id        uuid references public.trips(id) on delete set null,
  kind           text not null check (kind in ('enrich', 'recommend')),
  ok             boolean,                   -- null = 진행 중, true = 성공, false = 실패(한도에서 제외)
  model          text,
  prompt_tokens  int, output_tokens int, tool_tokens int, thoughts_tokens int, total_tokens int,
  ms             int,
  created_at     timestamptz not null default now()
);
create index if not exists ai_calls_user_time on public.ai_calls(user_id, created_at);
create index if not exists ai_calls_time on public.ai_calls(created_at);

create table if not exists public.recommend_cache (
  trip_id     uuid not null references public.trips(id) on delete cascade,
  key         text not null check (char_length(key) <= 300),
  keyword     text not null check (char_length(keyword) <= 100),
  scope       text,
  result      jsonb not null,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  primary key (trip_id, key)
);
create index if not exists recommend_cache_time on public.recommend_cache(created_at);

alter table public.ai_grants         enable row level security;
alter table public.ai_grant_requests enable row level security;
alter table public.ai_calls          enable row level security;
alter table public.recommend_cache   enable row level security;

-- ---------------------------------------------------------------------
-- 2. 헬퍼
-- ---------------------------------------------------------------------
-- 한국 시간 오늘 0시
create or replace function public.ai_day_start()
returns timestamptz language sql stable as $$
  select date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
$$;

-- Google 로그인 사용자인지 (익명 계정 제외)
create or replace function public.is_google_user()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users u where u.id = auth.uid() and not coalesce(u.is_anonymous, false));
$$;

-- 오늘 추천 사용 횟수 (진행 중인 것 포함, 10분 넘게 끝나지 않은 건 실패로 보고 제외)
create or replace function public.ai_recommend_used_today(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from ai_calls
   where user_id = p_user and kind = 'recommend' and created_at >= public.ai_day_start()
     and (ok is true or (ok is null and created_at > now() - interval '10 minutes'));
$$;

-- ---------------------------------------------------------------------
-- 3. 사용자용
-- ---------------------------------------------------------------------
-- 내 AI 추천 사용 가능 상태 (화면 표시용)
create or replace function public.my_ai_access()
returns json language plpgsql stable security definer set search_path = public as $$
declare
  g ai_grants%rowtype;
  v_admin boolean := public.is_admin();
  v_active boolean;
begin
  select * into g from ai_grants where user_id = auth.uid();
  v_active := g.user_id is not null and g.revoked_at is null and (g.expires_at is null or g.expires_at > now());
  return json_build_object(
    'admin', v_admin,
    'google', public.is_google_user(),
    'allowed', v_admin or v_active,
    'expires_at', case when v_active then g.expires_at end,
    'daily_limit', case when v_admin then null when v_active then g.daily_limit end,
    'used_today', public.ai_recommend_used_today(auth.uid()),
    'requested', exists (select 1 from ai_grant_requests where user_id = auth.uid())
  );
end $$;

-- 권한 요청 (Google 로그인 사용자만)
create or replace function public.request_ai_access(p_message text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_google_user() then raise exception 'GOOGLE_REQUIRED'; end if;
  insert into ai_grant_requests(user_id, message) values (auth.uid(), left(p_message, 200))
  on conflict (user_id) do update set message = excluded.message, requested_at = now();
end $$;

-- AI 호출 시작 (Edge Function 이 사용자 권한으로 호출). 반환: { id, remaining(null = 무제한) }
--  enrich    : 여행 멤버면 기록만 (횟수 제한은 기존 consume_ai_quota, 여행당 하루 50회)
--  recommend : 관리자 무제한 / 허용된 Google 사용자는 하루 한도
create or replace function public.begin_ai_call(p_trip uuid, p_kind text)
returns json language plpgsql security definer set search_path = public as $$
declare
  g ai_grants%rowtype;
  v_used int;
  v_id bigint;
  v_remaining int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('enrich', 'recommend') then raise exception 'BAD_REQUEST'; end if;

  if p_kind = 'recommend' and not public.is_admin() then
    if not public.is_google_user() then raise exception 'GOOGLE_REQUIRED'; end if;
    select * into g from ai_grants where user_id = auth.uid() for update;
    if g.user_id is null or g.revoked_at is not null or (g.expires_at is not null and g.expires_at <= now()) then
      raise exception 'AI_NOT_ALLOWED';
    end if;
    v_used := public.ai_recommend_used_today(auth.uid());
    if v_used >= g.daily_limit then raise exception 'AI_LIMIT'; end if;
    v_remaining := g.daily_limit - v_used - 1;
  end if;

  insert into ai_calls(user_id, trip_id, kind) values (auth.uid(), p_trip, p_kind) returning id into v_id;
  return json_build_object('id', v_id, 'remaining', v_remaining);
end $$;

-- AI 호출 끝: 결과와 토큰 기록 (본인 호출만, 한 번만)
create or replace function public.finish_ai_call(
  p_id bigint, p_ok boolean, p_model text default null,
  p_prompt int default null, p_output int default null, p_tool int default null,
  p_thoughts int default null, p_total int default null, p_ms int default null
) returns void language sql security definer set search_path = public as $$
  update ai_calls set ok = p_ok, model = left(p_model, 60),
         prompt_tokens = p_prompt, output_tokens = p_output, tool_tokens = p_tool,
         thoughts_tokens = p_thoughts, total_tokens = p_total, ms = p_ms
   where id = p_id and user_id = auth.uid() and ok is null;
$$;

-- 추천 결과: 24시간 안의 같은 요청 결과
create or replace function public.get_recommend_cache(p_trip uuid, p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  return (select result from recommend_cache
           where trip_id = p_trip and key = p_key and created_at > now() - interval '24 hours');
end $$;

create or replace function public.save_recommend_cache(p_trip uuid, p_key text, p_keyword text, p_scope text, p_result jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  insert into recommend_cache(trip_id, key, keyword, scope, result, created_by)
  values (p_trip, left(p_key, 300), left(p_keyword, 100), left(p_scope, 100), p_result, auth.uid())
  on conflict (trip_id, key) do update
    set keyword = excluded.keyword, scope = excluded.scope, result = excluded.result,
        created_by = excluded.created_by, created_at = now();
end $$;

-- 최근 추천 (여행 멤버 공유, 최근 30일 · 20개)
create or replace function public.recent_recommendations(p_trip uuid)
returns table (key text, keyword text, scope text, created_at timestamptz, created_by_name text, count int, result jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  return query
    select c.key, c.keyword, c.scope, c.created_at,
           (select m.display_name from trip_members m
             where m.trip_id = p_trip and m.removed_at is null
               and (m.user_id = c.created_by
                    or m.id in (select d.member_id from trip_member_devices d where d.user_id = c.created_by))
             limit 1),
           coalesce(jsonb_array_length(c.result -> 'items'), 0),
           c.result
      from recommend_cache c
     where c.trip_id = p_trip and c.created_at > now() - interval '30 days'
     order by c.created_at desc
     limit 20;
end $$;

-- ---------------------------------------------------------------------
-- 4. 관리자용
-- ---------------------------------------------------------------------
-- Google 사용자 목록 + 권한 + 요청 + 사용량(오늘/7일) + 토큰(7일)
create or replace function public.admin_ai_users()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return coalesce((
    select json_agg(row_to_json(x) order by x.requested_at desc nulls last, x.last_seen desc nulls last)
      from (
        select u.id as user_id, u.email,
               (select string_agg(distinct t.title || ' · ' || m.display_name, ', ')
                  from trip_members m join trips t on t.id = m.trip_id
                 where m.removed_at is null
                   and (m.user_id = u.id or m.id in (select d.member_id from trip_member_devices d where d.user_id = u.id))) as trips,
               greatest(u.last_sign_in_at, (select max(m.last_seen_at) from trip_members m where m.user_id = u.id)) as last_seen,
               exists (select 1 from admins a where a.user_id = u.id) as is_admin,
               g.daily_limit, g.expires_at, g.revoked_at, g.granted_at,
               (g.user_id is not null and g.revoked_at is null and (g.expires_at is null or g.expires_at > now())) as active,
               r.requested_at, r.message as request_message,
               public.ai_recommend_used_today(u.id) as used_today,
               (select count(*) from ai_calls c where c.user_id = u.id and c.kind = 'recommend' and c.ok
                   and c.created_at > now() - interval '7 days') as recommend_7d,
               (select count(*) from ai_calls c where c.user_id = u.id and c.kind = 'enrich' and c.ok
                   and c.created_at > now() - interval '7 days') as enrich_7d,
               (select coalesce(sum(c.total_tokens), 0) from ai_calls c where c.user_id = u.id and c.kind = 'recommend'
                   and c.created_at > now() - interval '7 days') as recommend_tokens_7d,
               (select coalesce(sum(c.total_tokens), 0) from ai_calls c where c.user_id = u.id and c.kind = 'enrich'
                   and c.created_at > now() - interval '7 days') as enrich_tokens_7d
          from auth.users u
          left join ai_grants g on g.user_id = u.id
          left join ai_grant_requests r on r.user_id = u.id
         where not coalesce(u.is_anonymous, false)
      ) x
  ), '[]'::json);
end $$;

-- 전체 7일 합계 (관리자 화면 상단)
create or replace function public.admin_ai_summary()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  return (select json_object_agg(kind, json_build_object(
                   'calls', calls, 'failed', failed, 'tokens', tokens, 'avg_ms', avg_ms))
            from (select kind,
                         count(*) filter (where ok) as calls,
                         count(*) filter (where ok is false) as failed,
                         coalesce(sum(total_tokens), 0) as tokens,
                         round(avg(ms) filter (where ok))::int as avg_ms
                    from ai_calls where created_at > now() - interval '7 days'
                   group by kind) s);
end $$;

-- 권한 주기/바꾸기/끄기. p_enabled=false 면 끔. p_expires_at null = 영구. p_daily_limit null = 기본값(새로 줄 때) 또는 기존 값 유지
create or replace function public.admin_set_ai_grant(p_user uuid, p_enabled boolean, p_expires_at timestamptz default null, p_daily_limit int default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  if not p_enabled then
    update ai_grants set revoked_at = now() where user_id = p_user and revoked_at is null;
    return;
  end if;
  if exists (select 1 from auth.users where id = p_user and coalesce(is_anonymous, false)) then
    raise exception 'GOOGLE_REQUIRED';
  end if;
  insert into ai_grants(user_id, expires_at, granted_by)
  values (p_user, p_expires_at, auth.uid())
  on conflict (user_id) do update set expires_at = excluded.expires_at, revoked_at = null,
                                      granted_by = excluded.granted_by, granted_at = now();
  if p_daily_limit is not null then
    update ai_grants set daily_limit = p_daily_limit where user_id = p_user;
  end if;
  delete from ai_grant_requests where user_id = p_user;
end $$;

-- 한도만 바꾸기
create or replace function public.admin_set_ai_limit(p_user uuid, p_daily_limit int)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  update ai_grants set daily_limit = p_daily_limit where user_id = p_user;
end $$;

-- 요청 거절(목록에서 지우기)
create or replace function public.admin_dismiss_ai_request(p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
  delete from ai_grant_requests where user_id = p_user;
end $$;

-- ---------------------------------------------------------------------
-- 5. 자동 정리에 추가 (추천 결과 30일, AI 사용 기록 180일)
-- ---------------------------------------------------------------------
create or replace function public.cleanup_expired()
returns json language plpgsql security definer set search_path = public as $$
declare
  n_dev int; n_share int; n_ai int; n_places int; n_codes int; n_rec int; n_calls int;
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

  delete from recommend_cache where created_at < now() - interval '30 days';
  get diagnostics n_rec = row_count;

  delete from ai_calls where created_at < now() - interval '180 days';
  get diagnostics n_calls = row_count;

  return json_build_object('device_codes', n_dev, 'share_codes', n_share, 'ai_usage', n_ai,
                           'places_usage', n_places, 'creation_codes', n_codes,
                           'recommend_cache', n_rec, 'ai_calls', n_calls);
end $$;
revoke all on function public.cleanup_expired() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 6. 실행 권한
-- ---------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'public.ai_day_start()', 'public.is_google_user()', 'public.ai_recommend_used_today(uuid)',
    'public.my_ai_access()', 'public.request_ai_access(text)', 'public.begin_ai_call(uuid, text)',
    'public.finish_ai_call(bigint, boolean, text, int, int, int, int, int, int)',
    'public.get_recommend_cache(uuid, text)', 'public.save_recommend_cache(uuid, text, text, text, jsonb)',
    'public.recent_recommendations(uuid)', 'public.admin_ai_users()', 'public.admin_ai_summary()',
    'public.admin_set_ai_grant(uuid, boolean, timestamptz, int)', 'public.admin_set_ai_limit(uuid, int)',
    'public.admin_dismiss_ai_request(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
-- 다른 사람 사용량을 직접 세지 못하도록 (내부용)
revoke execute on function public.ai_recommend_used_today(uuid) from authenticated;

commit;
