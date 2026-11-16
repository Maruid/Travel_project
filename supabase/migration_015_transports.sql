-- =====================================================================
-- migration_015: 이동편 (항공편 · 기차 · 배 · 버스)
--  - 가는 편(out) · 오는 편(back) · 그 밖(other). 일정 탭 첫날 · 마지막 날(출발 · 도착 날짜)에 보임
--  - AI 일정 짜기가 도착 · 출발 시각을 보고 첫날 · 마지막 날 일정을 맞춤
--  - AI 가이드(입국 · 출국 동선)도 이 정보를 씀
--  - 다른 콘텐츠 표와 같은 방식: 앱이 만든 UUID · 멤버만 읽고 씀 · soft delete · 행 수 제한 · Realtime
-- =====================================================================
begin;

create table if not exists public.trip_transports (
  id            uuid primary key default gen_random_uuid(),
  trip_id       uuid not null references public.trips(id) on delete cascade,
  direction     text not null default 'out' check (direction in ('out', 'back', 'other')),
  mode          text not null default 'flight' check (mode in ('flight', 'train', 'ship', 'bus')),
  code          text check (char_length(code) <= 20),            -- 편명 (KE723)
  carrier       text check (char_length(carrier) <= 40),         -- 항공사 · 회사
  dep_name      text check (char_length(dep_name) <= 60),        -- 출발 공항 · 역 (인천 ICN)
  dep_date      date,
  dep_time      time,
  dep_terminal  text check (char_length(dep_terminal) <= 20),
  arr_name      text check (char_length(arr_name) <= 60),
  arr_date      date,
  arr_time      time,
  arr_terminal  text check (char_length(arr_terminal) <= 20),
  note          text check (char_length(note) <= 300),           -- 예약 번호 · 수하물 등
  sort_order    double precision not null default 0,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists trip_transports_trip on public.trip_transports(trip_id);

drop trigger if exists trip_transports_meta on public.trip_transports;
create trigger trip_transports_meta before insert or update on public.trip_transports
  for each row execute function public.tg_row_meta();
drop trigger if exists trip_transports_limit on public.trip_transports;
create trigger trip_transports_limit before insert on public.trip_transports
  for each row when (new.trip_id is not null) execute function public.tg_row_limit('30');

alter table public.trip_transports enable row level security;
drop policy if exists trip_transports_select on public.trip_transports;
create policy trip_transports_select on public.trip_transports for select
  using (public.is_trip_member(trip_id) or public.is_admin());
drop policy if exists trip_transports_insert on public.trip_transports;
create policy trip_transports_insert on public.trip_transports for insert
  with check (public.is_trip_member(trip_id));
drop policy if exists trip_transports_update on public.trip_transports;
create policy trip_transports_update on public.trip_transports for update
  using (public.is_trip_member(trip_id)) with check (public.is_trip_member(trip_id));

grant select, insert, update on public.trip_transports to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.trip_transports;
exception when duplicate_object then null; end $$;

-- 보기 전용 링크: 이동편도 같이 보냄 (migration_011 의 view_trip 에 trip_transports 추가)
create or replace function public.view_trip(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_trip uuid;
  meta   text[] := array['trip_id', 'created_by', 'updated_by', 'created_at', 'deleted_at'];
begin
  select trip_id into v_trip from trip_view_links
   where token = p_token and enabled and char_length(coalesce(p_token, '')) >= 16;
  if v_trip is null then raise exception 'VIEW_LINK_INVALID'; end if;

  return jsonb_build_object(
    'trip', (select jsonb_build_object('title', t.title, 'destination', t.destination, 'start_date', t.start_date,
                                       'end_date', t.end_date, 'timezone', t.timezone, 'cover_emoji', t.cover_emoji)
               from trips t where t.id = v_trip),
    'categories', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'kind', c.kind, 'icon', c.icon, 'color', c.color) order by c.sort_order)
                              from categories c where (c.trip_id is null or c.trip_id = v_trip) and c.deleted_at is null), '[]'),
    'places', coalesce((select jsonb_agg(to_jsonb(p) - meta - array['geo_review', 'google_synced_at', 'updated_at'])
                          from places p where p.trip_id = v_trip and p.deleted_at is null), '[]'),
    'itinerary_days', coalesce((select jsonb_agg(to_jsonb(d) - meta - 'updated_at')
                                  from itinerary_days d where d.trip_id = v_trip and d.deleted_at is null), '[]'),
    'itinerary_items', coalesce((select jsonb_agg(to_jsonb(i) - meta - 'updated_at' order by i.day_date, i.sort_order, i.created_at)
                                   from itinerary_items i where i.trip_id = v_trip and i.deleted_at is null), '[]'),
    'guides', coalesce((select jsonb_agg(to_jsonb(g) - meta - 'updated_at' order by g.pinned desc, g.sort_order)
                          from guides g where g.trip_id = v_trip and g.deleted_at is null), '[]'),
    'trip_transports', coalesce((select jsonb_agg(to_jsonb(x) - meta - 'updated_at' order by x.dep_date, x.dep_time, x.sort_order)
                                   from trip_transports x where x.trip_id = v_trip and x.deleted_at is null), '[]'),
    'updated_at', (select max(x) from (
        select max(updated_at) x from places where trip_id = v_trip
        union all select max(updated_at) from itinerary_items where trip_id = v_trip
        union all select max(updated_at) from guides where trip_id = v_trip) s)
  );
end $$;

revoke all on function public.view_trip(text) from public;
grant execute on function public.view_trip(text) to anon, authenticated;

commit;
