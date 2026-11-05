-- =====================================================================
-- migration_012: AI 일정 짜기 (3차)
--  - 권한: AI 추천과 같음 (관리자 무제한, 그 외는 관리자가 허용한 Google 로그인 사용자)
--  - 하루 한도: AI 추천과 같이 씀 (일정 짜기 1번 = 추천 1번)
--  - 여행당 한도: 멤버 모두 합쳐 ai_plan_trip_limit() 번 (기본 3). 관리자는 제한 없음
--  - 실패(ok=false)는 세지 않음. 결과가 나온 뒤 미리보기에서 취소한 것은 셈
--  - itinerary_items.ai_plan: AI 가 넣은 일정 표시 (같은 실행에서 넣은 일정은 같은 값)
-- =====================================================================
begin;

-- 여행당 횟수: 이 숫자만 바꾸면 됩니다 (다시 실행해도 안전)
create or replace function public.ai_plan_trip_limit()
returns int language sql immutable as $$ select 3 $$;

-- AI 기록 종류에 plan 추가
alter table public.ai_calls drop constraint if exists ai_calls_kind_check;
alter table public.ai_calls add constraint ai_calls_kind_check check (kind in ('enrich', 'recommend', 'plan'));
create index if not exists ai_calls_trip_kind on public.ai_calls(trip_id, kind);

-- AI 가 넣은 일정 표시
alter table public.itinerary_items add column if not exists ai_plan text check (char_length(ai_plan) <= 40);

-- 하루 한도: 추천 + 일정 짜기 합산 (진행 중 10분까지 포함)
create or replace function public.ai_recommend_used_today(p_user uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from ai_calls
   where user_id = p_user and kind in ('recommend', 'plan') and created_at >= public.ai_day_start()
     and (ok is true or (ok is null and created_at > now() - interval '10 minutes'));
$$;

-- 여행당 사용 횟수 (멤버 모두 합산, 관리자 실행은 제외)
create or replace function public.ai_plan_used(p_trip uuid)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from ai_calls c
   where c.trip_id = p_trip and c.kind = 'plan'
     and (c.ok is true or (c.ok is null and c.created_at > now() - interval '10 minutes'))
     and not exists (select 1 from admins a where a.user_id = c.user_id);
$$;

-- AI 호출 시작: plan 추가
create or replace function public.begin_ai_call(p_trip uuid, p_kind text)
returns json language plpgsql security definer set search_path = public as $$
declare
  g ai_grants%rowtype;
  v_used int;
  v_id bigint;
  v_remaining int;
  v_trip_left int;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  if p_kind not in ('enrich', 'recommend', 'plan') then raise exception 'BAD_REQUEST'; end if;

  if p_kind in ('recommend', 'plan') and not public.is_admin() then
    if not public.is_google_user() then raise exception 'GOOGLE_REQUIRED'; end if;
    select * into g from ai_grants where user_id = auth.uid() for update;
    if g.user_id is null or g.revoked_at is not null or (g.expires_at is not null and g.expires_at <= now()) then
      raise exception 'AI_NOT_ALLOWED';
    end if;
    v_used := public.ai_recommend_used_today(auth.uid());
    if v_used >= g.daily_limit then raise exception 'AI_LIMIT'; end if;
    v_remaining := g.daily_limit - v_used - 1;
    if p_kind = 'plan' then
      -- 같은 여행에서 동시에 눌러도 한도를 넘지 않도록
      perform pg_advisory_xact_lock(hashtext('ai_plan:' || p_trip::text));
      v_trip_left := public.ai_plan_trip_limit() - public.ai_plan_used(p_trip);
      if v_trip_left <= 0 then raise exception 'AI_PLAN_LIMIT'; end if;
      v_trip_left := v_trip_left - 1;
    end if;
  end if;

  insert into ai_calls(user_id, trip_id, kind) values (auth.uid(), p_trip, p_kind) returning id into v_id;
  return json_build_object('id', v_id, 'remaining', v_remaining, 'trip_remaining', v_trip_left);
end $$;

-- 일정 짜기 시작 화면용: 권한 + 오늘 남은 횟수 + 이 여행 남은 횟수
create or replace function public.ai_plan_status(p_trip uuid)
returns json language plpgsql stable security definer set search_path = public as $$
declare
  g ai_grants%rowtype;
  v_admin boolean := public.is_admin();
  v_active boolean;
begin
  if not public.is_trip_member(p_trip) then raise exception 'FORBIDDEN'; end if;
  select * into g from ai_grants where user_id = auth.uid();
  v_active := g.user_id is not null and g.revoked_at is null and (g.expires_at is null or g.expires_at > now());
  return json_build_object(
    'admin', v_admin,
    'google', public.is_google_user(),
    'allowed', v_admin or v_active,
    'requested', exists (select 1 from ai_grant_requests where user_id = auth.uid()),
    'daily_limit', case when v_admin then null when v_active then g.daily_limit end,
    'used_today', public.ai_recommend_used_today(auth.uid()),
    'trip_limit', case when v_admin then null else public.ai_plan_trip_limit() end,
    'trip_used', public.ai_plan_used(p_trip)
  );
end $$;

-- 관리자 화면: 사람별 7일 일정 짜기 횟수·토큰 추가
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
               (select count(*) from ai_calls c where c.user_id = u.id and c.kind = 'plan' and c.ok
                   and c.created_at > now() - interval '7 days') as plan_7d,
               (select count(*) from ai_calls c where c.user_id = u.id and c.kind = 'enrich' and c.ok
                   and c.created_at > now() - interval '7 days') as enrich_7d,
               (select coalesce(sum(c.total_tokens), 0) from ai_calls c where c.user_id = u.id and c.kind = 'recommend'
                   and c.created_at > now() - interval '7 days') as recommend_tokens_7d,
               (select coalesce(sum(c.total_tokens), 0) from ai_calls c where c.user_id = u.id and c.kind = 'plan'
                   and c.created_at > now() - interval '7 days') as plan_tokens_7d,
               (select coalesce(sum(c.total_tokens), 0) from ai_calls c where c.user_id = u.id and c.kind = 'enrich'
                   and c.created_at > now() - interval '7 days') as enrich_tokens_7d
          from auth.users u
          left join ai_grants g on g.user_id = u.id
          left join ai_grant_requests r on r.user_id = u.id
         where not coalesce(u.is_anonymous, false)
      ) x
  ), '[]'::json);
end $$;

-- 실행 권한
revoke all on function public.ai_plan_trip_limit() from public, anon;
grant execute on function public.ai_plan_trip_limit() to authenticated;
revoke all on function public.ai_plan_used(uuid) from public, anon, authenticated;   -- 내부용
revoke all on function public.ai_recommend_used_today(uuid) from public, anon, authenticated;
revoke all on function public.begin_ai_call(uuid, text) from public, anon;
grant execute on function public.begin_ai_call(uuid, text) to authenticated;
revoke all on function public.ai_plan_status(uuid) from public, anon;
grant execute on function public.ai_plan_status(uuid) to authenticated;
revoke all on function public.admin_ai_users() from public, anon;
grant execute on function public.admin_ai_users() to authenticated;

commit;
