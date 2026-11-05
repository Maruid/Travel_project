-- =====================================================================
-- migration_010: 장소 방문 체크
--  places.visited_at: "다녀옴" 체크한 시각 (null = 안 감). 후기는 저장하지 않음
--  권한은 places 테이블 GRANT/RLS 그대로 (멤버 누구나 체크·해제)
-- =====================================================================
alter table public.places add column if not exists visited_at timestamptz;
