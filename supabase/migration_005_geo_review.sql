-- =====================================================================
-- migration_005: 구글 위치 검토 대기
--  places.geo_review (jsonb, 없으면 null)
--   - 확인 필요 (구글 위치가 기존 핀과 300m 넘게 떨어져 좌표를 바꾸지 않음)
--       {"type":"review","lat":..,"lng":..,"name":"구글 장소명","distance":2300,"at":"..."}
--   - 자동 변경 (300m 이내라 구글 좌표로 바꿈, 되돌리기용 이전 좌표 보관)
--       {"type":"auto","prevLat":..,"prevLng":..,"distance":120,"at":"..."}
--  검토에서 결정하면 null 로 지움. 권한은 places 테이블 GRANT/RLS 그대로 적용됨
-- =====================================================================
alter table public.places add column if not exists geo_review jsonb;
