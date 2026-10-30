-- =====================================================================
--  seed_osaka.sql - 기존 하드코딩 오사카 데이터를 새 스키마로 이전
--  - Supabase SQL Editor 에서 schema.sql 실행 후 1회 실행 (postgres 권한, RLS 우회)
--  - 다시 실행해도 됨: 같은 trip id 를 먼저 삭제(cascade)하고 새로 만듦
--  - 멤버는 자리표시(user_id = null)로 생성 → 링크 접속 후 "준"을 선택(claim)하면 owner 가 됨
--  - 지출 내역은 데모값이라 제외. 실제 기록은 기존 앱의 "백업 파일 받기" JSON 으로 따로 이전
-- =====================================================================

begin;

-- 고정 trip id (재실행 시 같은 여행을 교체하기 위함)
delete from public.trips where id = 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13';

-- ---------------------------------------------------------------------
-- 1. 여행 / 예산 / 멤버 / 초대 링크
-- ---------------------------------------------------------------------
insert into public.trips (id, title, destination, start_date, end_date, timezone, cover_emoji, allow_custom_categories)
values ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '2026 오사카 여행', '오사카', '2026-11-24', '2026-11-28',
        'Asia/Tokyo', '🏯', true);

insert into public.trip_budgets (trip_id, home_currency, local_currency, rate, base_amount)
values ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'KRW', 'JPY', 8.7, 63000);

insert into public.budget_topups (trip_id, topup_date, amount, note)
values ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '2026-11-20', 30000, '추가 외화 체크카드 충전');

insert into public.trip_members (trip_id, user_id, display_name, role, color) values
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', null, '준', 'owner',  '#00f2fe'),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', null, '현', 'member', '#f43f5e');

insert into public.trip_invites (trip_id, token)
values ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', public.new_token());


-- ---------------------------------------------------------------------
-- 2. 카테고리 (trip 커스텀 8종 + 전역 숙소/교통거점 재사용)
-- ---------------------------------------------------------------------
create temp table _cat (key text primary key, id uuid not null default gen_random_uuid()) on commit drop;

insert into _cat (key) values
  ('yakiniku'), ('okonomiyaki'), ('ramen'), ('beef'), ('sushi'), ('curry'), ('snack'), ('spots');

insert into public.categories (id, trip_id, name, kind, icon, color, sort_order)
select c.id, 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', v.name, v.kind, v.icon, v.color, v.ord
from (values
  ('yakiniku',    '야키니쿠',       'food', 'fa-drumstick-bite', '#f43f5e', 10),
  ('okonomiyaki', '오코노미·소바',   'food', 'fa-utensils',       '#10b981', 20),
  ('ramen',       '라멘',           'food', 'fa-bowl-food',      '#f59e0b', 30),
  ('beef',        '규카츠',         'food', 'fa-cubes-stacked',  '#f97316', 40),
  ('sushi',       '스시',           'food', 'fa-fish',           '#06b6d4', 50),
  ('curry',       '카레·일식',       'food', 'fa-pepper-hot',     '#eab308', 60),
  ('snack',       '꼬치·디저트',     'food', 'fa-wine-glass',     '#c084fc', 70),
  ('spots',       '힐링 명소',       'spot', 'fa-landmark',       '#3b82f6', 80)
) as v(key, name, kind, icon, color, ord)
join _cat c on c.key = v.key;

insert into _cat (key, id)
select 'lodging', id from public.categories where trip_id is null and kind = 'lodging' limit 1;
insert into _cat (key, id)
select 'transit', id from public.categories where trip_id is null and kind = 'transit' limit 1;


-- ---------------------------------------------------------------------
-- 3. 장소 (맛집 46 + 명소 11 + 기준점 4)
--    legacy = 기존 코드의 id (일정의 spotId 매핑용)
-- ---------------------------------------------------------------------
create temp table _p (
  legacy text primary key,
  id uuid not null default gen_random_uuid(),
  cat text, name text, zone text, lat double precision, lng double precision,
  signature text, description text, visit_tip text, warn_badge text,
  price_min numeric, price_max numeric, source text,
  youtube_url text, maps_url text, map_query text, is_anchor boolean default false
) on commit drop;

insert into _p (legacy, cat, name, zone, lat, lng, signature, description, visit_tip, warn_badge, price_min, price_max, source, youtube_url, maps_url, map_query) values
  -- 🥩 야키니쿠
  ('f-15', 'yakiniku', '야키니쿠 잇초 (一丁)', '신사이바시', 34.6735, 135.5015, '흑모와규 특선 부위 & 우설', '전 좌석 완전 개별 프라이빗 룸 완비. 부부 여행에서 시끄럽지 않고 오붓하게 최고급 암소 와규를 굽기 가장 좋은 곳.', '구글맵/전화 사전 예약 권장', null, 5000, 8000, null, null, null, 'Yakiniku Itcho Shinsaibashi 大阪'),
  ('f-16', 'yakiniku', '마츠자카규 M 호젠지점', '호젠지 요코초', 34.6685, 135.5022, '일본 3대 와규 마츠자카규 플래터', '호젠지 등불 골목의 운치 있는 정취. 부위별 플래터 코스로 화려한 마블링과 풍미 만끽.', '디너 피크 대기 발생', null, 7000, 12000, null, null, null, 'Matsusakagyu Yakiniku M Hozenji Hanare'),
  ('f-17', 'yakiniku', '야키니쿠 만노 (萬野)', '우라난바', 34.6635, 135.5035, '1점 단위 주문 가능한 극상 와규', '60년 정육 도매상 직영. 신선도 최상의 특수 부위와 내장육을 1점씩 골라 맛볼 수 있는 실속 미식가들의 성지.', '회전율 비교적 양호', null, 4000, 7000, null, null, null, 'Yakiniku Manno Uranamba'),
  ('f-18', 'yakiniku', '호르몬 야키니쿠 시치후쿠', '난바역', 34.6660, 135.5005, '당일 도축 호르몬 & 특선 로스', '난바역 12번 출구 앞 로컬 직장인들이 애용하는 실속형 야키니쿠. 고기 후 카스우동으로 해장 마무리.', '20시 이후 심야 원활', null, 3000, 5000, null, null, null, 'Shichifuku Yakiniku Namba'),
  ('f-19', 'yakiniku', '야키니쿠 소라 (空)', '도톤보리', 34.6688, 135.5052, '마늘 양념 호르몬 노포', '오사카 야키니쿠의 성지 츠루하시 본점의 직영점. 연기 자욱하고 활기찬 진짜 현지 레트로 노포 감성.', '화요일 휴무 주의', '화요 휴무', 3000, 5000, null, null, null, 'Yakiniku Sora Dotonbori'),
  ('f-add-2', 'yakiniku', '우설 리쿠 (난바파크스점)', '난바파크스 6F', 34.6617, 135.5019, '우설 극(極) 정식', '센다이 명물 두툼한 숯불 우설 구이 전문점. 꼬리곰탕과 보리밥, 매콤한 된장 곁들임이 일품.', '백화점 식당가 대기', null, 3000, 8000, '유우키', 'https://youtu.be/OEH2htjEHMo?si=L9_pftA6VP2TrQKP&t=204', 'https://maps.app.goo.gl/tRsAHC3HpNEjFi3D7', 'Rikyu Namba Parks Osaka'),
  ('f-add-12', 'yakiniku', '갓츠 하나레 (がっつ 離れ)', '다니마치9초메', 34.6669, 135.5175, '와규 안창살(하라미) & 솥밥', '주문 즉시 지어주는 윤기 나는 가마솥 쌀밥에 육즙 가득한 안창살 생고기를 얹어 먹는 로컬 찐 맛집.', '사전 예약 권장', null, 4000, 8000, '유우키', 'https://youtu.be/N6Lcngg5C24?si=hDiyeQ66gZBpbOy0&t=198', 'https://maps.app.goo.gl/RRx1La9LSes7jMDP8', 'Gattsu Hanare Osaka'),

  -- 🥞 오코노미야키 & 야키소바
  ('f-1', 'okonomiyaki', '후쿠타로 본점 (福太郎)', '센니치마에', 34.6665, 135.5038, '소힘줄(스지) 네기야키', '대형 카운터 철판 조리. 17:00 오픈 직전 명단 작성하면 수월하게 입장. 파의 향긋함과 부드러운 스지.', '17:00 오픈런 추천', null, 1500, 2500, null, null, null, 'Fukutaro Sennichimae Osaka'),
  ('f-2', 'okonomiyaki', '아지노야 본점 (味乃家)', '난바역', 34.6680, 135.5008, '미쉐린 빕구르망 믹스야키', '양배추 비율이 압도적으로 높아 입안에서 사르르 녹아내리는 부드러움. 다국어 메뉴판 완비.', '상시 1시간 대기', '긴 웨이팅', 1500, 2500, null, null, null, 'Ajinoya Honten Namba'),
  ('f-3', 'okonomiyaki', '모미지 (もみじ)', '다니마치9초메', 34.6665, 135.5185, '타베로그 백명점 두툼 철판구이 & 돈페이야키', '두툼하고 크리미한 반죽. 심야까지 운영하며 현지인 웨이팅이 끊이지 않는 오사카 대표 명점.', '오픈 30분 전 대기 권장 (화요일 휴무)', '화요 휴무', 2500, 4000, '남만득', 'https://youtu.be/jVj1vqI4Bls?si=-GH3dRoTlE2EYGDj&t=669', 'https://maps.app.goo.gl/frFA2CF3uHrqSuG36', 'Momiji Okonomiyaki Osaka'),
  ('f-4', 'okonomiyaki', '키지 우메다스카이점', '우메다', 34.7052, 135.4895, '면이 듬뿍 들어간 모던야키', '닭 육수 반죽의 깊은 풍미. 우메다 공중정원 관람이나 백화점 쇼핑 동선과 연계 추천.', '점심 30분 내외', null, 1200, 1800, null, null, null, 'Kiji Umeda Sky Building'),
  ('f-5', 'okonomiyaki', '오카루 (おかる)', '도톤보리', 34.6687, 135.5030, '70년 노포 & 캐릭터 마요아트', '철판 뚜껑을 덮어 폭신하게 쪄내는 정통 방식. 마요네즈로 도라에몽 등 캐릭터를 그려주는 즐거움.', '목요일 휴무 주의', '목요 휴무', 1200, 1800, null, null, null, 'Okaru Dotonbori Osaka'),
  ('f-add-1', 'okonomiyaki', '아지쿠라야 (味蔵家)', '우에혼마치', 34.6657, 135.5204, '오코노미야키 & 야키소바', '풍자 또간집 오사카편 1위 삐라 획득! 겉은 바삭하고 속은 부드러운 정통 현지인 동네 맛집.', '방송 후 웨이팅 증가', null, 1250, 2000, '풍자 또간집', 'https://youtu.be/ER8NwhJ6yH4?si=OKKfmrVTkPVCcQH0&t=1931', 'https://maps.app.goo.gl/pv4J1wBZ3ErD1Mbo9', 'Ajikuraya Uehommachi Osaka'),
  ('f-add-6', 'okonomiyaki', '오코노미야키 유카리 (소네자키 본점)', '히가시우메다', 34.7018, 135.5005, '특선 믹스 오코노미야키', '박명수 유튜브 출연. 1950년 창업한 대형 프랜차이즈 노포로 깔끔하고 넓은 좌석이 장점.', '점심/저녁 15~20분', null, 1480, 2200, '박명수', 'https://youtu.be/SbJqR-S25vs?si=mk55itt0pdBVTY-f&t=1475', 'https://maps.app.goo.gl/2GoW4Wpd1duPka1w9', 'Yukari Sonezaki Honten Umeda'),
  ('f-add-7', 'okonomiyaki', '미츠키 (三ツ木)', '구로몬 시장', 34.6653, 135.5070, '곱창(호르몬) 야키소바', '구로몬 시장 골목에 위치한 철판 노포. 진한 소스와 쫄깃한 소곱창이 어우러진 볶음면이 명물.', '골목 노포 특성상 협소', null, 1200, 1800, '양산 쇼츠', 'https://youtube.com/shorts/g7qo54Eo8EU?si=uz0RBN4I84P5PRzp', 'https://maps.app.goo.gl/CZs6zqrB53nTyRpv5', 'Mitsuki Kuromon Osaka'),

  -- 🍜 라멘
  ('f-7', 'ramen', '멘야 조로쿠 (麺屋 丈六)', '우라난바', 34.6645, 135.5042, '타카이다계 흑간장 라멘', '오사카 라멘 랭킹 1위 단골 명점. 산미 있는 진한 닭 육수 간장과 굵은 면, 고등어초밥(하야스시) 곁들임 필수.', '수요일 정기 휴무!', '수요 휴무', 900, 1300, null, null, null, 'Menya Joroku Namba'),
  ('f-8', 'ramen', '인류모두면류 (人類みな麺類)', '난바/니시나카지마', 34.6648, 135.5010, '조개 육수 & 두툼한 통차슈', '맑고 깊은 조개 육수 간장 베이스. 입안에서 녹아내리는 거대한 통차슈가 압권.', '회전율 빠름', null, 1000, 1400, null, null, null, 'Jinrui Mina Menrui Namba'),
  ('f-9', 'ramen', '모에요 멘스케 (燃えよ 麺助)', '후쿠시마(우메다)', 34.6980, 135.4865, '키슈 오리 라멘', '타베로그 3.7점대. 오리 육수의 세련된 감칠맛과 저온 조리 차슈의 조화.', '월요일 휴무 주의', '월요 휴무', 1100, 1600, null, null, null, 'Moeyo Mensuke Fukushima Osaka'),
  ('f-10', 'ramen', '카도야 쇼쿠도 본점', '니시나가호리', 34.6765, 135.4870, '클래식 정통 중화소바', '일본 전국구 라멘 마니아들의 성지. 부드럽고 매끄러운 자가제면의 정점.', '점심 한정 (화요일 휴무)', '화요 휴무 / 점심', 1200, 1800, null, null, null, 'Kadoya Shokudo Nishinagahori'),
  ('f-6', 'ramen', '이치란 / 가무쿠라', '도톤보리', 34.6689, 135.5020, '돈코츠 / 맑은 배추 육수 소바', '도톤보리 중심가 위치. 24시간 또는 심야 운영으로 늦은 밤 가벼운 야식으로 최고.', '심야 시간대 여유', null, 980, 1400, null, null, null, 'Kamukura Dotonbori Osaka'),
  ('f-add-3', 'ramen', '라멘 무겐 (Mugen Ramen)', '닛폰바시', 34.6690, 135.5050, '특상 소고기 등심 라멘', '박명수 유튜브 출연. 큼직한 소고기 등심이 통째로 올라간 화려한 비주얼이 특징.', '웨이팅 적음', null, 1800, 2200, '박명수', 'https://youtu.be/SbJqR-S25vs?si=4dn7QOfbUn-AVsU6&t=282', 'https://maps.app.goo.gl/NM4BuzXtovyTGTRS6', 'Ramen Mugen Dotonbori'),
  ('f-add-10', 'ramen', '무기토 멘스케 (麦と麺助)', '우메다 북쪽(나카츠)', 34.7115, 135.4960, '특제 쇼유 라멘 & 차슈덮밥', '모에요 멘스케 2호점. 오사카 라멘계 최정상으로 오픈런 필수. 고급 닭 기름과 깔끔한 수제 간장.', '화요일 휴무 / 오픈런 필수', '화요 휴무 / 오픈런', 1200, 1800, '쇼츠', 'https://youtube.com/shorts/anHRFZBsijA?si=O9xpqd8gfavyotyB', 'https://maps.app.goo.gl/DWGx1Be5SS4kdE7Y7', 'Mugi to Mensuke Nakatsu Osaka'),
  ('f-add-14', 'ramen', '멘 쿠루무 (麺 clm)', '니시오하시', 34.6755, 135.4925, '완탕 쇼유 라멘 (쿠로) & 아침 라멘', '오전 07:00~08:00에 문을 여는 아침 라멘 맛집. 깊은 블랙 간장 육수에 통통한 수제 완탕이 들어감.', '아침 라멘 (07시 오픈)', '아침 7시 오픈', 1100, 1400, '카라미', 'https://youtu.be/HbX9Ot0UE-g?si=jIbFE1XwlVHYiwHv&t=632', 'https://maps.app.goo.gl/gpvyTdpuiG6hNhZr7', 'Men clm Osaka'),
  ('f-add-21', 'ramen', '신푸 라멘 (新風 / Shinpu)', '신세카이', 34.6535, 135.5060, '돈코츠 쇼유 라멘', '신세카이 츠텐카쿠 인근의 진한 돼지뼈 간장 라멘. 묵직하고 고소한 국물로 현지 단골이 많음.', '회전율 빠름', null, 980, 1300, '귤티', 'https://youtu.be/rQwvWpK7XLc?si=x9-p2cn71els444t', 'https://maps.app.goo.gl/JuZQaWbnawdsXxRz5', 'Shinpu Ramen Shinsekai'),

  -- 🍱 규카츠 & 와규 요리
  ('f-12', 'beef', '규카츠 토미타 (牛かつ 冨田)', '닛폰바시', 34.6668, 135.5062, '규카츠 보리밥 정식 (마 세트)', '도미인 호텔 도보 3분! 모토무라급 퀄리티를 유지하면서도 웨이팅 부담이 적은 최고의 실속 대안.', '도보 3분 최고동선', null, 1900, 2600, '박명수', 'https://youtu.be/SbJqR-S25vs?si=GzDzc1LVlTQWmblP&t=645', 'https://maps.app.goo.gl/adQEKaKGMTo81mA98', 'Gyukatsu Tomita Nipponbashi'),
  ('f-11', 'beef', '규카츠 모토무라 난바', '난바역', 34.6648, 135.5012, '화로 구이 규카츠 정식', '한국인 부동의 1위 규카츠. 미니 화로에 원하는 굽기로 구워 먹는 즐거움.', '오픈런 추천', '대기 김', 2000, 3000, null, null, null, 'Gyukatsu Motomura Namba'),
  ('f-13', 'beef', '하리주 본점 카레샵 (はり重)', '도톤보리', 34.6688, 135.5000, '100년 전통 와규 비프카츠', '1919년 창업 정육점 직영. 깊은 품격의 클래식 비프카츠와 와규 카레.', '화요일 휴무 주의', '화요 휴무', 1500, 2500, null, null, null, 'Hariju Dotonbori Curry Shop'),
  ('f-14', 'beef', '니쿠게키조 난바 (肉劇場)', '도톤보리', 34.6686, 135.5018, '직화 고기폭탄 덮밥', '치맛살·갈비살을 센 불에 구워 고봉밥 위에 산처럼 쌓아주는 가성비 극강의 스테이크 덮밥.', '무인 발권기', null, 1000, 1800, null, null, null, 'Niku Gekijo Dotonbori'),

  -- 🍣 스시 & 해산물
  ('f-20', 'sushi', '스시 히데조우 (鮨 ひでぞう)', '센니치마에', 34.6655, 135.5040, '당일 중앙도매시장 직송 모둠회', '오사카 최고의 가성비 해산물 주점. 2인 6,000~8,000엔 수준에 제철 회와 단품 스시 만끽.', '사전 예약 권장 (화요일 휴무)', '화요 휴무 / 예약', 3000, 4500, null, null, null, 'Sushi Hidezou Sennichimae'),
  ('f-21', 'sushi', '스시 사카바 사시스 난바', '난바워크 지하', 34.6672, 135.5015, '참치뱃살 삐져나온 김말이 (토로타쿠)', '박명수 극찬 & SNS 대란 핫플. 지하상가에 있어 접근성 최고. 연어·새우 스시도 가성비 뛰어남.', '11:00 오픈런 권장', '오픈런 추천', 2000, 3500, '박명수', 'https://youtu.be/SbJqR-S25vs?si=aTbo-iQoRD6K5RuQ&t=1158', 'https://maps.app.goo.gl/CT8m8z4JCbgqEYQn8', 'Sushi Sakaba Sashisu Namba Walk'),
  ('f-22', 'sushi', '키타로 스시 (喜多郎寿し)', '센니치마에', 34.6678, 135.5050, '2피스 균일가 로컬스시', '새벽 02시까지 운영. 숙소 바로 앞 가벼운 2차 스시로 최적. 튀김류도 우수함.', '심야 여유로움', null, 2500, 4000, null, null, null, 'Kitaro Sushi Sennichimae'),
  ('f-23', 'sushi', '하루코마 스시 (春駒)', '텐진바시스지', 34.7100, 135.5120, '두툼한 서민 가성비 스시', '밥을 완전히 덮는 거대한 생선회. 현지 서민들이 사랑하는 푸짐한 시장 스시.', '화요일 휴무', '화요 휴무', 2000, 3500, null, null, null, 'Harukoma Sushi Tenjinbashi'),
  ('f-24', 'sushi', '스시잔마이 도톤보리점', '도톤보리', 34.6687, 135.5035, '24시간 연중무휴 참치 스시', '언제든 방문 가능한 24시간 대중형 스시. 첫날 심야 도착 직후 가벼운 야식으로 안성맞춤.', '24시간 영업', null, 2000, 3500, null, null, null, 'Sushizanmai Dotonbori'),
  ('f-add-22', 'sushi', '스시로 (닛폰바시점)', '닛폰바시역 앞', 34.6662, 135.5060, '100엔대 가성비 회전초밥', '숙소 도보 4분. 태블릿 한국어 주문 지원, 원하는 메뉴를 골라 부담 없이 배불리 먹기 좋은 체인.', '앱 예약 또는 현장 대기', null, 1500, 2500, '가성비', null, null, 'Sushiro Nipponbashi Osaka'),

  -- 🍛 카레 & 일식·중화
  ('f-25', 'curry', '하쿠긴테이 (白銀亭)', '혼마치/기타하마', 34.6850, 135.5010, '매운 돈카츠 카레', '첫맛은 달콤하다가 끝맛은 얼얼하게 매콤한 오사카 카레의 최정점. 25일 수변 산책 점심 추천.', '평일 점심 한정 (16시 조기 마감)', '16시 마감 / 점심', 1000, 1400, null, null, null, 'Hakugintei Curry Honmachi'),
  ('f-26', 'curry', '인디안 카레 난바점', '난바역 지하', 34.6655, 135.5012, '오사카 단짠맵 카레 원조', '1947년 창업. 주문 1분 만에 나오는 매력적인 스파이스 카레. 바쁜 일정 속 초스피드 식사.', '초고속 회전', null, 850, 1200, null, null, null, 'Indian Curry Namba Minami'),
  ('f-27', 'curry', '지유켄 본점 (自由軒)', '센니치마에', 34.6675, 135.5030, '110년 날달걀 비빔카레', '1910년 개업 오사카 최초 양식당. 밥에 카레를 미리 비벼 날달걀과 우스터소스를 섞어 먹는 명물.', '월요일 휴무 주의', '월요 휴무', 850, 1200, null, null, null, 'Jiyuken Honten Namba'),
  ('f-28', 'curry', '보타니 카레 (BOTANI:CURRY)', '혼마치', 34.6875, 135.5015, '스파이스 카레 랭킹 1위', '타베로그 3.9점대. 오전 10시 선착순 정리권을 받아야만 먹을 수 있는 예술적인 플레이팅의 카레.', '오전 10시 선착순 번호표 필수', '10시 번호표 필수', 1200, 1600, null, null, null, 'Botani Curry Honmachi Osaka'),
  ('f-add-16', 'curry', '겟토 타니마치 (月兎)', '사카이스지혼마치', 34.6840, 135.5130, '마파두부 & 오믈렛 라이스', '남만득 추천. 몽글몽글한 오믈렛 위에 화자오 향 가득한 매콤한 마파두부를 끼얹은 퓨전 일식.', '일요일 휴무 / 점심 대기', '일요 휴무', 1000, 1500, '남만득', 'https://youtu.be/jVj1vqI4Bls?si=lkDSp_oDa1ER2r-W&t=906', 'https://maps.app.goo.gl/K2NqGarhQyeLAXLV9', 'Gekito Tanimachi Osaka'),

  -- 🍢 꼬치·간식·디저트
  ('f-add-19', 'snack', '야키토리 아키요시 (닛폰바시점)', '닛폰바시역', 34.6668, 135.5058, '순계(순케이) & 우설 꼬치', '도미인 숙소 바로 앞! 5개 단위로 구워주는 가성비 최상 숯불 꼬치 노포. 2차 맥주 한 잔으로 최고.', '퇴근 시간대 대기', null, 2500, 4000, '로컬 찐맛집', null, 'https://maps.app.goo.gl/ZVw9aJbAxdqDiiJL8', 'Yakitori Akiyoshi Nipponbashi'),
  ('f-add-11', 'snack', '카모진 (鴨仁)', '구로몬 시장', 34.6658, 135.5068, '오리 껍질 & 연골 꼬치 코스', '오리고기 전문 프리미엄 숯불 꼬치구이. 육즙과 숯불 향이 고급스러운 타베로그 예약 추천처.', '사전 예약 권장', null, 5000, 10000, '쇼츠', 'https://youtube.com/shorts/anHRFZBsijA?si=O9xpqd8gfavyotyB', 'https://maps.app.goo.gl/qeaZXVwQdv9rNAYy7', 'Kamojin Kuromon Osaka'),
  ('f-add-13', 'snack', '라이트 교자 (Light Gyoza)', '우라난바', 34.6651, 135.5048, '치즈 교자 & 마늘 튀김 교자', '바삭하고 가벼운 한입 교자 주점. 부담 없는 가격에 시원한 하이볼이나 생맥주와 곁들이기 좋음.', '심야 원활', null, 1000, 2000, '남만득', 'https://youtu.be/jVj1vqI4Bls?si=Invxs2XFyyr6N7xv&t=263', 'https://maps.app.goo.gl/oUNXTMEDXk5N1QMi6', 'Light Gyoza Namba Osaka'),
  ('f-add-8', 'snack', '551 호라이 (난바 본점)', '난바역 상점가', 34.6659, 135.5016, '부타만 (돼지고기 왕만두)', '오사카의 국민 간식! 양파의 단맛과 고기 육즙이 꽉 찬 왕만두. 포장해 숙소 온천욕 후 야식으로 최고.', '줄 서도 5분 내 포장', null, 230, 600, '쇼츠', 'https://youtube.com/shorts/g7qo54Eo8EU?si=u-mE20RX79UnzVrG', 'https://maps.app.goo.gl/ukEKxx9yWMyJy2Z2A', '551 Horai Namba Honten'),
  ('f-add-20', 'snack', '하나다코 (はなだこ)', '신우메다 식당가', 34.7028, 135.4990, '네기마요 타코야끼', '신선한 대파를 산처럼 얹어주는 오사카 3대 타코야끼. 서서 먹는 스탠딩 매장으로 알싸한 맛이 별미.', '15~20분 대기', null, 700, 900, '길기행', 'https://youtu.be/VUOGYjzcxzI?si=UY5MtOi7KFAiOPEb&t=1062', null, 'Hanadako Umeda Osaka'),
  ('f-add-17', 'snack', '그루니에 (grenier)', '우메다역', 34.7042, 135.4988, '브륄레 밀푀유 디저트', '한큐 산반가 1층. 바삭한 페이스트리 속에 주문 즉시 커스터드 크림을 듬뿍 채워 캐러멜라이징.', '주말 웨이팅', null, 1200, 1500, '남만득', 'https://youtu.be/pN6zPnyMfidMhYOP', 'https://maps.app.goo.gl/sFRzmUWsogk8xXX57', 'grenier Umeda Hankyu'),
  ('f-add-18', 'snack', '호무라야', '신 후쿠시마', 34.6967, 135.4866, '우니, 호타테(가리비 구이), 카키 후라이(굴 튀김)', '신 후쿠시마 역 근처. 대부분 300엔(세금 제외) 현지인들 맛집.', '웨이팅 없음', null, 2000, 3000, '마츠다', 'https://youtu.be/dCVRISJWTHw?si=pv6IL9Q9atUP02CJ&t=106', 'https://maps.app.goo.gl/fxRma7Dxq2ASirtr5', '炉ばた焼 焔家'),

  -- 🏛️ 힐링 명소
  ('s-1', 'spots', '기타하마 & 나카노시마 공원', '기타하마', 34.6915, 135.5075, '도지마강 수변 & 중앙공회당', '르네상스·네오바로크 양식의 근대 석조 건물군과 가을 플라타너스 가로수길. 부부 산책 최적.', '자유 산책', null, null, null, null, null, null, 'Nakanoshima Park Osaka'),
  ('s-2', 'spots', '모토커피 (MOTO COFFEE)', '기타하마', 34.6908, 135.5065, '강변 테라스 핸드드립 & 푸딩', '도지마강 테라스석 명소. ⚠️ 현금 결제 전용 매장이므로 엔화 실물 지폐 준비 필수.', '오픈 11시 전 방문 권장', '현금전용', null, null, null, null, null, 'MOTO COFFEE Kitahama Osaka'),
  ('s-3', 'spots', '고칸 본점 (Gokan Kitahama)', '기타하마', 34.6898, 135.5058, '1920년대 구 은행 고택 티룸', '높은 층고 아래에서 즐기는 쌀가루 롤케이크와 클래식 애프터눈 티.', '오후 티타임 대기', null, null, null, null, null, null, 'Gokan Kitahama Honten'),
  ('s-4', 'spots', '나카자키초 레트로 골목', '나카자키초', 34.7065, 135.5050, '쇼와시대 목조 나가야 고택 골목', '소형 가죽 공방, 빈티지 헌책방, 100년 고택 개조 살롱 드 아만토 카페. 주민 거주구역 정숙 준수.', '상점별 상이', null, null, null, null, null, null, 'Nakazakicho Osaka'),
  ('s-5', 'spots', '미노오 국립공원 & 대폭포', '미노오', 34.8480, 135.4720, '낙차 33m 폭포 & 가을 단풍길', '한큐 미노오역에서 2.7km(왕복 약 2시간) 완만한 평탄 포장 숲길. 특산 단풍잎 튀김(모미지 덴푸라) 별미.', '오전 방문 쾌적', null, null, null, null, null, null, 'Minoh Waterfall Osaka'),
  ('s-6', 'spots', '유니버셜 스튜디오 재팬 (USJ)', '유니버설시티', 34.6654, 135.4323, '슈퍼 닌텐도 월드 & 동키콩', '11/26(목) 오픈런! 07:20 보안검색 도착 ➔ 동키콩 트램카 직행 ➔ 마리오 카트 싱글라이더 공략.', '목요일 평일 공략', null, null, null, null, null, null, 'Universal Studios Japan'),
  ('s-7', 'spots', '호젠지 요코초 & 부동명왕', '난바', 34.6682, 135.5025, '이끼 낀 부동명왕 물뿌리기', '돌바닥과 붉은 등불이 낭만적인 골목. 소원을 빌며 미즈카케 후도손에 물을 끼얹는 전통.', '상시 관람', null, null, null, null, null, null, 'Hozenji Yokocho Osaka'),
  ('s-8', 'spots', '센니치마에 도구야스지 그릇거리', '난바', 34.6640, 135.5030, '일본 조리도구 & 도자기 쇼핑', '타코야끼 틀, 장인 사시미 칼, 정갈한 일본 찻잔과 그릇을 합리적인 도매가에 쇼핑.', '10:00~18:00', null, null, null, null, null, null, 'Sennichimae Doguyasuji Shopping Street'),
  ('s-9', 'spots', '구로몬 시장 (Kuromon Market)', '닛폰바시', 34.6650, 135.5072, '오사카의 부엌 & 신선 해산물', '도미인 호텔 도보 3분. 가리비 구이, 참치 사시미, 와규 꼬치 등 로컬 식자재 시장 탐방.', '오전 10시 활성화', null, null, null, null, null, null, 'Kuromon Ichiba Market'),
  ('s-10', 'spots', '난바 파크스 (Namba Parks)', '난바', 34.6615, 135.5020, '계단식 옥상 가든 테라스 & 쇼핑', '협곡 형태의 유려한 건축과 옥상 정원 산책. 6층 식당가(우설 리쿠) 및 패션 쇼핑.', '11:00 오픈', null, null, null, null, null, null, 'Namba Parks Osaka'),
  ('s-11', 'spots', '도톤보리 글리코상 & 에비스 다리', '도톤보리', 34.6687, 135.5013, '오사카 상징 만세 포토존', '도톤보리 운하와 네온사인 야경. 인파가 많으므로 아침 일찍 또는 심야 22시 이후 사진 촬영 추천.', '상시 관람', null, null, null, null, null, null, 'Dotonbori Glico Sign');

-- 기준점 (숙소 + 역) → 지도의 "기준: ○○" 드롭다운
insert into _p (legacy, cat, name, zone, lat, lng, signature, description, visit_tip, warn_badge, map_query, is_anchor) values
  ('hotel', 'lodging', '도미인 프리미엄 난바', '시마노우치', 34.6698, 135.5065,
   '천연 온천 대욕장 & 무료 요나키소바',
   '오사카시 주오구 시마노우치 2-14-23. 2층 천연 온천 대욕장 15:00~익일 10:00 밤샘 운영. 무료 야식 요나키소바 매일 21:30~23:00.',
   '고온 사우나는 새벽 01:00~05:00 가동 중단', null,
   'Natural Hot Spring Dormy Inn Premium Namba', true),
  ('namba',       'transit', '난바역',     '난바',     34.6660, 135.5010, null, null, null, null, 'Namba Station Osaka',       true),
  ('nipponbashi', 'transit', '닛폰바시역', '닛폰바시', 34.6670, 135.5065, null, null, null, null, 'Nippombashi Station Osaka', true),
  ('umeda',       'transit', '우메다역',   '우메다',   34.7025, 135.4960, null, null, null, null, 'Umeda Station Osaka',       true);

insert into public.places (id, trip_id, category_id, name, zone, lat, lng, signature, description, visit_tip, warn_badge,
                           price_min, price_max, price_currency, source, youtube_url, maps_url, map_query, is_anchor)
select p.id, 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', c.id, p.name, p.zone, p.lat, p.lng, p.signature, p.description,
       p.visit_tip, p.warn_badge, p.price_min, p.price_max,
       case when p.price_min is not null then 'JPY' end,
       p.source, p.youtube_url, p.maps_url, p.map_query, p.is_anchor
from _p p
left join _cat c on c.key = p.cat;


-- ---------------------------------------------------------------------
-- 4. 일정
--    sort_order 로 순서를 고정 (1일차는 자정을 넘기는 항목이 있어 시간순 정렬하면 순서가 꼬임)
-- ---------------------------------------------------------------------
insert into public.itinerary_days (trip_id, day_date, title, badge, summary) values
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '2026-11-24', '심야 입국 & 안전한 난바 이동', '체력 보존', '22:25 KIX 착륙 ➔ 23:55 공항급행 막차 ➔ 숙소 온천 입욕'),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '2026-11-25', '도심 수변 & 골목 힐링 데이', '저밀도 힐링', '기타하마 수변 테라스 ➔ 매운 돈카츠 카레 ➔ 나카자키초 ➔ 네기야키'),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '2026-11-26', '⭐️ USJ 전일 집중 공략 & 와규 디너', '테마파크 집중', '06:30 숙소출발 ➔ 08:15 동키콩 직행 ➔ 마리오카트 ➔ 야키니쿠 잇초'),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '2026-11-27', '가을 단풍 트레킹 & 우메다 쇼핑', '가을 단풍', '미노오 대폭포 ➔ 우메다 백화점 쇼핑 ➔ 호르몬 시치후쿠'),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '2026-11-28', '센니치마에 산책 & 간사이공항 출국', '귀국 완벽 준비', '체크아웃 짐보관 ➔ 도구야스지/규카츠 ➔ 라피트 ➔ ICOCA 0엔 환불');

insert into public.itinerary_items (trip_id, day_date, start_time, title, description, alert, icon, place_id, sort_order)
select 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', v.d::date, v.t::time, v.title, v.descr, v.alert, v.icon, p.id, v.ord
from (values
  -- 1일차 11/24 (화)
  ('2026-11-24', '22:25', '간사이공항 T1 착륙 및 입국 수속', '검역, 입국 심사, 세관 검사 진행 (약 45~60분 소요).', null, 'fa-plane-arrival', null, 10),
  ('2026-11-24', '23:30', '에어로플라자 철도 개찰구 이동', '2층 연결통로 이동. 23:55 공항급행 막차 탑승 준비.', null, 'fa-person-walking', null, 20),
  ('2026-11-24', '23:55', '난카이 공항급행 최종 막차 탑승', '편도 970엔 (별도 예약 불필요). 00:39 난카이 난바역 도착.', '막차 결행 시 비상 플랜 B: 00:15 우메다행 심야 리무진 ➔ 택시', 'fa-train-subway', null, 30),
  ('2026-11-24', '00:45', '난바역 ➔ 숙소 이동 (택시 추천)', '심야 수하물 보행 피로를 줄이기 위해 난바역 앞 택시(700~900엔) 권장.', null, 'fa-taxi', null, 40),
  ('2026-11-24', '01:00', '도미인 프리미엄 난바 체크인 & 온천', '2층 천연 온천 대욕장 밤샘 입욕으로 비행 여독 해소 후 빠른 취침.', null, 'fa-hot-tub-person', 'hotel', 50),
  -- 2일차 11/25 (수)
  ('2026-11-25', '09:30', '여유로운 기상 및 아침 대욕장 온천', '심야 입국 피로를 완전 해소하고 컨디션 회복. 조식 뷔페.', null, 'fa-sun', null, 10),
  ('2026-11-25', '11:00', '기타하마 모토커피 (MOTO COFFEE)', '도지마강 야외 테라스석에서 핸드드립 커피 & 푸딩 (현금 결제 전용 매장).', null, 'fa-mug-saucer', 's-2', 20),
  ('2026-11-25', '12:30', '하쿠긴테이 (白銀亭) 점심 식사', '오사카 대표 매운 돈카츠 카레로 든든한 에너지 보충 (16시 조기 마감).', null, 'fa-utensils', 'f-25', 30),
  ('2026-11-25', '14:00', '나카노시마 공원 & 중앙공회당 산책', '르네상스 근대 석조 건물군과 가을 플라타너스 가로수길 힐링 산책.', null, 'fa-tree', 's-1', 40),
  ('2026-11-25', '15:30', '나카자키초 레트로 고택 골목 산책', '쇼와시대 목조 나가야 고택 공방, 빈티지 헌책방, 살롱 드 아만토.', null, 'fa-camera-retro', 's-4', 50),
  ('2026-11-25', '18:00', '후쿠타로 본점 저녁 만찬', '대형 철판 카운터석에서 갓 구운 소힘줄(스지) 네기야키 & 생맥주.', null, 'fa-beer-mug-empty', 'f-1', 60),
  ('2026-11-25', '21:30', '숙소 무료 요나키소바 & 2층 온천', '간장 라멘 야식 서비스 즐기고 익일 USJ 오픈런을 위해 조기 취침.', null, 'fa-bowl-rice', 'hotel', 70),
  -- 3일차 11/26 (목) USJ
  ('2026-11-26', '06:30', '기상 및 숙소 출발', '한신 난바선(닛폰바시역) ➔ 니시쿠조역 환승 ➔ 유니버설시티역 (약 38분).', null, 'fa-person-running', 's-6', 10),
  ('2026-11-26', '07:20', 'USJ 정문 보안검색 구역 도착', '음료 페트병 미리 손에 꺼내기. 부부 2인 티켓 한 기기 앱 연동 상태 확인.', null, 'fa-shield-halved', 's-6', 20),
  ('2026-11-26', '08:15', '조기 오픈 & 닌텐도 월드 동키콩 직행', '입장 즉시 슈퍼 닌텐도 월드 [동키콩의 크레이지 트램카] 1순위 탑승!', null, 'fa-gamepad', 's-6', 30),
  ('2026-11-26', '10:00', '마리오 카트 싱글라이더 탑승', '부부 개별 탑승하는 싱글라이더 라인 활용으로 일반 대기 50% 단축.', null, 'fa-flag-checkered', 's-6', 40),
  ('2026-11-26', '11:30', '파크 내 점심 식사 (피노키오 카페)', '12:00~14:00 식당 인파 피크를 피해 11시경 조기 해결.', null, 'fa-burger', 's-6', 50),
  ('2026-11-26', '13:00', '실내 쇼 프로그램 관람 & 다리 휴식', '워터월드 등 대규모 공연을 관람하며 보행 피로 누적 완화.', null, 'fa-masks-theater', 's-6', 60),
  ('2026-11-26', '16:30', '위저딩 월드 오브 해리포터 성 야경', '일몰 후 호그와트 성 조명 연출 감상 및 버터맥주 시음.', null, 'fa-wand-magic-sparkles', 's-6', 70),
  ('2026-11-26', '18:00', '파크 퇴장 후 난바 복귀', 'JR-한신선으로 난바역/닛폰바시역 귀환.', null, 'fa-train', null, 80),
  ('2026-11-26', '19:30', '야키니쿠 잇초 (프라이빗 룸 만찬)', '2만 보 걷고 난 뒤 프라이빗 개별 룸에서 흑모와규 특선 구이로 체력 회복.', null, 'fa-drumstick-bite', 'f-15', 90),
  ('2026-11-26', '22:00', '숙소 2층 천연 온천욕', '도미인 천연 온천 대욕장에서 근육 이완 후 숙면.', null, 'fa-hot-tub-person', 'hotel', 100),
  -- 4일차 11/27 (금)
  ('2026-11-27', '08:30', '미노오 국립공원 출발', '난바 ➔ 우메다 환승 ➔ 한큐 다카라즈카/미노오선 (편도 약 30분, 280엔).', null, 'fa-train-subway', 's-5', 10),
  ('2026-11-27', '09:30', '미노오 대폭포 트레킹 (다키미치 2.7km)', '단풍나무 숲길 산책 (왕복 2시간, 평탄 포장로). 운동화 착용 필수.', null, 'fa-leaf', 's-5', 20),
  ('2026-11-27', '11:00', '낙차 33m 폭포 절경 & 모미지 덴푸라', '붉은 단풍 대폭포 감상 & 특산 단풍잎 튀김 시식.', null, 'fa-water', 's-5', 30),
  ('2026-11-27', '12:30', '한큐선 탑승 후 우메다 복귀', '우메다역 도착 후 쇼핑몰 이동.', null, 'fa-train', null, 40),
  ('2026-11-27', '13:30', '우메다 점심: 하나다코 또는 사시스', '신우메다 식당가 파 듬뿍 하나다코 타코야끼 또는 스시 사시스.', null, 'fa-utensils', 'f-add-20', 50),
  ('2026-11-27', '15:00', '한큐/한신 백화점 쇼핑 & 그루니에 디저트', '밀푀유 디저트 및 굿즈/식품관 쇼핑.', null, 'fa-bag-shopping', 'f-add-17', 60),
  ('2026-11-27', '18:30', '호르몬 시치후쿠 또는 멘야 조로쿠', '난바역 앞 신선 호르몬 구이 & 카스우동 또는 흑간장 라멘.', null, 'fa-bowl-food', 'f-18', 70),
  ('2026-11-27', '21:30', '숙소 요나키소바 & 온천욕', '도미인 2층 대욕장에서 여독 풀기.', null, 'fa-bed', 'hotel', 80),
  -- 5일차 11/28 (토)
  ('2026-11-28', '10:00', '체크아웃 & 호텔 프런트 짐 보관', '캐리어 맡기고 가벼운 복장으로 출발.', null, 'fa-suitcase-rolling', 'hotel', 10),
  ('2026-11-28', '10:30', '구로몬 시장 & 도구야스지 그릇거리', '조리도구, 일본 도자기 찻잔 쇼핑 및 시장 탐방.', null, 'fa-store', 's-8', 20),
  ('2026-11-28', '11:30', '규카츠 토미타 (마지막 점심)', '숙소 4분 거리 닛폰바시역 앞 규카츠 보리밥 정식 만찬.', null, 'fa-utensils', 'f-12', 30),
  ('2026-11-28', '13:00', '호젠지 요코초 & 도톤보리 글리코상', '이끼 낀 부동명왕 물뿌리기 소원 빌기 & 글리코상 기념 촬영.', null, 'fa-camera', 's-7', 40),
  ('2026-11-28', '14:30', '리쿠로 오지상 치즈케이크 포장 & 난바파크스', '갓 구운 폭신한 치즈케이크 구매 및 옥상 정원 테라스 휴식.', null, 'fa-cake-candles', 's-10', 50),
  ('2026-11-28', '19:30', '호텔 프런트 짐 수령 후 난바역 이동', '도보 10분 난카이 난바역 승강장 이동.', null, 'fa-person-walking-luggage', null, 60),
  ('2026-11-28', '20:30', '난카이 특급 라피트 탑승', '지정석 탑승 (21:10 KIX 제1터미널 도착, 출발 2시간 15분 전 여유).', null, 'fa-train-subway', null, 70),
  ('2026-11-28', '21:30', 'ICOCA 카드 0엔 복합결제 & 보증금 환불', '공항 편의점에서 전액 소진 후 창구 반납 (수수료 없이 500엔 전액 수령).', null, 'fa-credit-card', null, 80),
  ('2026-11-28', '22:00', '공항 면세점 잔여 엔화 소진', '닷사이 23 사케, 도쿄바나나 등 구매 후 23:25 비행편 탑승 귀국.', null, 'fa-plane-departure', null, 90)
) as v(d, t, title, descr, alert, icon, spot, ord)
left join _p p on p.legacy = v.spot;


-- ---------------------------------------------------------------------
-- 5. 가이드 카드 (USJ 탭 + 실전팁 탭 + 숙소 안내)
--    코드블록(```)은 프론트에서 "복사" 버튼이 붙는 쇼잉 카드로 렌더링 예정
-- ---------------------------------------------------------------------
insert into public.guides (trip_id, title, body_md, color, icon, day_date, pinned, sort_order) values
('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'USJ 오픈런 3단계 황금 루트', $md$
**11월 26일 (목) 전일 일정 · 평일 쾌적 공략**
심야 입국 피로를 25일에 완전히 회복하고 목요일에 승부!

1. **07:20 ~ 07:30 보안검색 도착**
   숙소에서 **06:30 출발** (한신 난바선 ➔ 니시쿠조 환승 ➔ USJ 38분 소요). 음료 페트병은 손에 미리 꺼내두기.
2. **08:15 조기 입장 & 동키콩 직행**
   2인 티켓 한 기기 등록 완료 후 통과 즉시 신규 에어리어 **동키콩 트램카** 1순위 탑승 (대기 180분 방지).
3. **마리오 카트 싱글라이더 활용**
   부부 개별 탑승인 **싱글라이더(Single Rider)** 라인 탑승 시 일반 대기열 대비 50% 이상 단축.

---

**USJ 퇴장 후 저녁 미식** · 야키니쿠 잇초 (프라이빗 룸)
2만 보 이상 보행 후 조용한 개별 룸에서 흑모와규 만찬
$md$, '#f43f5e', 'fa-wand-magic-sparkles', '2026-11-26', true, 10),

('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '11월 하순 날씨 & 부부 복장 가이드', $md$
**기온 8℃ ~ 16℃**

- **도심 기온:** 서울보다 온화하나 일교차가 커 낮에는 따뜻하고 밤에는 쌀쌀합니다.
- **11/26 USJ 바닷바람 주의:** 바닷가 특유의 찬 강풍으로 체감온도가 급격히 떨어지므로 **탈착 가능한 경량 패딩 또는 윈드브레이커** 필수 지참.
- **11/27 미노오 계곡 숲길:** 단풍 트레킹 시 그늘진 계곡 공기가 차가우니 **도톰한 가디건이나 스카프, 푹신한 운동화**를 착용하세요.
$md$, '#38bdf8', 'fa-cloud-sun', null, false, 20),

('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '24일 심야 입국 동선 & 5대 이동수단 비교', $md$
✈️ **22:25 착륙** ➔ 22:55 입국심사 ➔ 23:15 수하물/세관 ➔ **23:30 철도 개찰구 도착 예상**

- 🥇 **난카이 공항급행 (최적 표준 / 970엔)**
  23:20 / **23:55 (최종 막차 ➔ 난바 00:39 도착)**. 별도 예약 불필요.
- ⚠️ **특급 라피트 (1,670엔):** 23:00 마감으로 심야 입국 시 탑승 불가 위험 큼.
- 🚨 **비상 플랜 B (막차 결행 시):** 00:15 우메다행 심야 리무진(T1) 탑승 ➔ 우메다 한큐 삼번가 01:13 도착 후 택시로 난바 이동.
$md$, '#f43f5e', 'fa-stopwatch', '2026-11-24', false, 30),

('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '심야 택시 탑승 쇼잉 카드', $md$
```
ドーミーイン プレミアムなんば までお願いします。(大阪市中央区島之内2-14-23)
```

오사카시 주오구 시마노우치 2-14-23

*난바역에서 탑승 시 기본요금(700~900엔) 수준으로 도착*
$md$, '#f59e0b', 'fa-taxi', '2026-11-24', false, 40),

('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'ICOCA 0엔 정산 환불 쇼잉 카드', $md$
```
ICOCAの残高を全部使って、不足分は現金で払います。
```

공항 편의점에서 잔액을 0엔으로 전액 결제하면 창구 반납 시 **수수료 220엔 차감 없이 보증금 500엔 전액** 환불!
$md$, '#10b981', 'fa-credit-card', '2026-11-28', false, 50),

('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', '숙소 안내 · 도미인 프리미엄 난바', $md$
오사카시 주오구 시마노우치 2-14-23

- ♨️ **2층 천연 온천 대욕장**
  15:00 ~ 익일 오전 10:00 (밤샘 운영, 새벽 1시 입실 후에도 온천 가능)
- ⚠️ **고온 사우나 점검 시간**
  새벽 01:00 ~ 05:00 가동 중단 (첫날 야간 입실 시 참고)
- 🍜 **무료 야식 요나키소바**
  매일 21:30 ~ 23:00 (첫날은 비행기 시간상 이용 불가, 2일차 저녁 후 추천)
$md$, '#fbbf24', 'fa-hotel', null, true, 5);


-- ---------------------------------------------------------------------
-- 6. To-Do / 위시리스트
-- ---------------------------------------------------------------------
insert into public.todos (trip_id, kind, title, note, done, sort_order) values
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'todo',  'USJ 공식 앱에 2인 입장권 QR 등록하기',      '방문 전날 일괄 등록 완료 필수', true,  10),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'todo',  '모토커피 방문용 엔화 실물 지폐 챙기기',      '현금 결제 전용 매장',           false, 20),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'todo',  'ICOCA 카드 공항 편의점에서 0엔 정산 환불',   '수수료 220엔 절약 꿀팁',        false, 30),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'todo',  '도미인 프리미엄 난바 2층 온천욕 즐기기',     '매일 밤샘 대욕장 힐링',         false, 40),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'place', '11/26 USJ 슈퍼 닌텐도 월드 & 동키콩',       '오픈런 1순위 트램카 직행',      false, 50),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'place', '기타하마 수변 & 나카노시마 공원 산책',       '도지마강 근대 건축물 감상',     false, 60),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'place', '미노오 국립공원 대폭포 단풍 트레킹',         '가을 단풍 절정기',              false, 70),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'shop',  '리쿠로 오지상 갓 구운 치즈케이크',           '난바 본점 포장',                false, 80),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'shop',  '미노오 특산 모미지 덴푸라 (단풍잎 튀김)',     '계곡길 초입 노점',              false, 90),
  ('b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13', 'shop',  '공항 면세점 닷사이 23 사케 구매',            '귀국 전 면세 구역',             false, 100);

commit;


-- ---------------------------------------------------------------------
-- 7. 결과 확인 (초대 토큰 확인용)
-- ---------------------------------------------------------------------
select
  (select token from public.trip_invites where trip_id = 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13') as invite_token,
  (select count(*) from public.places          where trip_id = 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13') as places,          -- 61
  (select count(*) from public.itinerary_items where trip_id = 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13') as itinerary_items, -- 39
  (select count(*) from public.guides          where trip_id = 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13') as guides,          -- 6
  (select count(*) from public.todos           where trip_id = 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13') as todos,           -- 10
  (select count(*) from public.places
    where trip_id = 'b1e4c6d2-5a7f-4c3e-9d81-2f6a0c9e7b13' and category_id is null)                     as places_without_category; -- 0
