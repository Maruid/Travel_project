-- =====================================================================
-- migration_011: 찜(❤️) + 읽기 전용 공유 링크
--  1) place_likes: 멤버별 찜. 각자 자기 것만 켜고 끔 (자리표시 멤버는 찜 불가)
--     - id 는 앱이 (장소, 멤버)로 계산한 고정 UUID → 여러 기기에서 눌러도 한 줄
--     - 끄면 liked = false (행은 남김: 오프라인 기기가 바뀐 사실을 받을 수 있도록)
--  2) trip_view_links: 여행당 링크 1개. owner 가 만들고 끄고 다시 발급
--     view_trip(token): 로그인 없이(anon) 일정 · 장소 · 가이드만 읽기. 가계부 · 할 일 · 멤버는 없음
-- =====================================================================
begin;

-- ---------------------------------------------------------------------
-- 1. 찜
-- ---------------------------------------------------------------------
create table if not exists public.place_likes (
  id          uuid primary key,
  trip_id     uuid not null references public.trips(id) on delete cascade,
  place_id    uuid not null references public.places(id) on delete cascade,
  member_id   uuid not null references public.trip_members(id) on delete cascade,
  liked       boolean not null default true,
  created_by  uuid, created_at timestamptz not null default now(),
  updated_by  uuid, updated_at timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index if not exists place_likes_one on public.place_likes(place_id, member_id);
create index if not exists place_likes_trip on public.place_likes(trip_id);

drop trigger if exists place_likes_meta on public.place_likes;
create trigger place_likes_meta before insert or update on public.place_likes
  for each row execute function public.tg_row_meta();
drop trigger if exists place_likes_limit on public.place_likes;
create trigger place_likes_limit before insert on public.place_likes
  for each row execute function public.tg_row_limit('5000');

-- 장소 · 멤버는 바꿀 수 없음 (켜고 끄기만)
create or replace function public.tg_like_fixed()
returns trigger language plpgsql as $$
begin
  new.place_id := old.place_id;
  new.member_id := old.member_id;
  return new;
end $$;
drop trigger if exists place_likes_fixed on public.place_likes;
create trigger place_likes_fixed before update on public.place_likes
  for each row execute function public.tg_like_fixed();

alter table public.place_likes enable row level security;
drop policy if exists place_likes_select on public.place_likes;
create policy place_likes_select on public.place_likes for select
  using (public.is_trip_member(trip_id) or public.is_admin());
drop policy if exists place_likes_insert on public.place_likes;
create policy place_likes_insert on public.place_likes for insert
  with check (
    member_id = public.my_member_id(trip_id)
    and exists (select 1 from public.places p where p.id = place_id and p.trip_id = place_likes.trip_id)
  );
drop policy if exists place_likes_update on public.place_likes;
create policy place_likes_update on public.place_likes for update
  using (member_id = public.my_member_id(trip_id))
  with check (member_id = public.my_member_id(trip_id));

grant select, insert, update on public.place_likes to authenticated;

do $$ begin
  alter publication supabase_realtime add table public.place_likes;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------
-- 2. 읽기 전용 공유 링크
-- ---------------------------------------------------------------------
create table if not exists public.trip_view_links (
  trip_id     uuid primary key references public.trips(id) on delete cascade,
  token       text not null unique,
  enabled     boolean not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table public.trip_view_links enable row level security;
-- 멤버는 링크를 보고 복사할 수 있음. 만들기 · 끄기는 아래 함수(owner)로만
drop policy if exists view_links_select on public.trip_view_links;
create policy view_links_select on public.trip_view_links for select
  using (public.is_trip_member(trip_id));
grant select on public.trip_view_links to authenticated;

-- owner: 켜기(없으면 만들기) · 끄기 · 다시 발급(기존 링크는 더 이상 안 열림)
create or replace function public.set_view_link(p_trip uuid, p_enabled boolean, p_regenerate boolean default false)
returns json language plpgsql security definer set search_path = public as $$
declare
  r trip_view_links;
begin
  if not public.is_trip_owner(p_trip) then raise exception 'OWNER_ONLY'; end if;
  insert into trip_view_links(trip_id, token, enabled, created_by)
  values (p_trip, public.new_token(), p_enabled, auth.uid())
  on conflict (trip_id) do update
     set enabled = excluded.enabled,
         token = case when p_regenerate then excluded.token else trip_view_links.token end,
         updated_at = now()
  returning * into r;
  return json_build_object('token', r.token, 'enabled', r.enabled);
end $$;

-- 링크로 열기: 로그인 없이 호출. 꺼졌거나 없는 링크는 VIEW_LINK_INVALID
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
    'updated_at', (select max(x) from (
        select max(updated_at) x from places where trip_id = v_trip
        union all select max(updated_at) from itinerary_items where trip_id = v_trip
        union all select max(updated_at) from guides where trip_id = v_trip) s)
  );
end $$;

revoke all on function public.tg_like_fixed() from public, anon;
revoke all on function public.set_view_link(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_view_link(uuid, boolean, boolean) to authenticated;
revoke all on function public.view_trip(text) from public;
grant execute on function public.view_trip(text) to anon, authenticated;

commit;
