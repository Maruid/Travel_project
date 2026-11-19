-- =====================================================================
-- migration_019: 할 일 개선
--  - todos.day_date : 이 날 할 일 (일정 탭 그 날짜에도 보임). 비우면 날짜 없음
--  - todos.assignee : 담당 멤버 (멤버를 지우면 비움)
--  - todos.kind 에 pack(챙길 것 · 준비물) 추가
--  - place_id · assignee 는 같은 여행 것만
-- 앞선 migration (018) 을 먼저 실행하세요. 다시 실행해도 안전합니다.
-- =====================================================================
begin;

alter table public.todos add column if not exists day_date date;
alter table public.todos add column if not exists assignee uuid references public.trip_members(id) on delete set null;

alter table public.todos drop constraint if exists todos_kind_check;
alter table public.todos add constraint todos_kind_check check (kind in ('todo', 'place', 'shop', 'pack'));

create or replace function public.tg_todo_refs_check()
returns trigger language plpgsql as $$
begin
  if new.place_id is not null
     and not exists (select 1 from public.places p where p.id = new.place_id and p.trip_id = new.trip_id) then
    raise exception 'BAD_REQUEST';
  end if;
  if new.assignee is not null
     and not exists (select 1 from public.trip_members m where m.id = new.assignee and m.trip_id = new.trip_id) then
    raise exception 'BAD_REQUEST';
  end if;
  return new;
end $$;
drop trigger if exists todos_refs_check on public.todos;
create trigger todos_refs_check before insert or update of place_id, assignee on public.todos
  for each row execute function public.tg_todo_refs_check();
revoke all on function public.tg_todo_refs_check() from public, anon;

commit;
