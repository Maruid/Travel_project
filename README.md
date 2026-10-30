# Trip Guide

여행 일정 · 장소 · 가계부 · 투두를 여러 사람이 링크로 함께 편집하는 웹앱.
GitHub Pages(정적 호스팅) + Supabase(DB, 인증, Realtime, Edge Function) 무료 구성.

## 구조

```
src/
  main.js              라우트 등록, OAuth 복귀 처리
  router.js            해시 라우터 (#/trip/:id/:tab)
  config.js            공개 설정값 (Supabase URL/Key, 지도 스타일)
  lib/
    supabase.js        클라이언트, rpc(), 에러 메시지 변환
    auth.js            익명 로그인, Google 로그인/계정 연결
    store.js           여행 데이터 캐시 + 오프라인 outbox 동기화 + Realtime
    maps-link.js       구글 맵 링크 파서 (순수 함수, 테스트 있음)
    place-lookup.js    짧은 링크 펼치기(Edge Function), Nominatim 검색, GPS
    markdown.js        가이드 카드 마크다운 (DOMPurify, 복사 카드)
    dom.js             html`` 자동 escape 템플릿, data-action 이벤트 위임
  components/          지도(Leaflet + OpenFreeMap), 바텀시트, 토스트
  views/               home, create, join, trip(+tabs), admin
supabase/
  schema.sql           테이블, RLS, RPC
  seed_osaka.sql       기존 오사카 데이터
  functions/resolve-maps-link/   짧은 구글 맵 링크 → 최종 URL
.github/workflows/
  deploy.yml           main push → 빌드 → Pages 배포
  keepalive.yml        3일마다 Supabase ping + 저장소 활동 유지
```

## 설정 순서

### 1. Supabase
1. SQL Editor 에서 `supabase/schema.sql` → `supabase/seed_osaka.sql` 순서로 실행
2. **Authentication → Sign In / Providers**
   - Anonymous sign-ins: **ON**
   - Google: **ON** (Google Cloud Console 에서 OAuth 클라이언트 생성,
     승인된 리디렉션 URI 에 `https://<project-ref>.supabase.co/auth/v1/callback` 등록)
   - Manual linking(Allow manual linking): **ON** — 익명 계정에 Google 계정을 연결할 때 필요
3. **Authentication → URL Configuration**
   - Site URL: `https://<github-id>.github.io/<repo>/`
   - Redirect URLs: 위 주소 + `http://localhost:5173/`
4. Edge Function 배포 (둘 중 하나)
   - CLI: `npx supabase functions deploy resolve-maps-link --no-verify-jwt --project-ref <ref>`
   - 대시보드: Edge Functions → Create function → `index.ts` 내용 붙여넣기 → **Verify JWT 끄기**
     (함수 안에서 직접 사용자 세션을 검증합니다)

### 1-2. 추가 기능 (기기 추가 코드, AI 정보 채우기)
1. SQL Editor 에서 `supabase/migration_002_devices_ai.sql` 실행 (schema.sql 이후, 다시 실행해도 안전)
2. Edge Function `enrich-place` 생성 (이름 정확히) → `supabase/functions/enrich-place/index.ts` 붙여넣기 → **Verify JWT 끄기**
3. Google AI Studio(aistudio.google.com)에서 API 키 발급 →
   Supabase **Edge Functions → Secrets** 에 `GEMINI_API_KEY` 등록
   (모델을 바꾸고 싶으면 `GEMINI_MODEL` 도 등록. 기본 `gemini-flash-latest`)

### 2. GitHub
1. 저장소를 **public** 으로 만들고 이 폴더를 push (무료 계정 Pages 조건)
2. **Settings → Pages → Source: GitHub Actions**
3. **Settings → Secrets and variables → Actions → Variables** 에 등록
   - `SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `SUPABASE_KEY` = Publishable key (`sb_publishable_...`) 또는 legacy anon key
   - 둘 다 브라우저에 공개되는 값입니다. **service_role / secret key 는 절대 넣지 마세요.**
4. Actions 탭에서 `Deploy to GitHub Pages` 실행 (이후엔 main push 시 자동)

### 3. 관리자 등록
1. 배포된 사이트에서 `#/admin` 접속 → Google 로그인
2. 화면에 나온 uid 복사 → SQL Editor 에서
   `insert into public.admins(user_id) values ('<uid>');`

### 4. 오사카 여행 연결
`seed_osaka.sql` 실행 결과의 `invite_token` 으로
`https://<github-id>.github.io/<repo>/#/join/<token>` 접속 → **"준" 선택** → owner 가 됨.
본인이 선택하기 전에는 링크를 공유하지 마세요 (비어 있는 owner 자리는 먼저 고른 사람이 가져감).
이후 멤버 탭에서 Google 계정 연결을 권장합니다.

## 로컬 개발
```bash
npm install
cp .env.example .env.local   # 값 채우기
npm run dev                  # http://localhost:5173
npm test                     # 링크 파서 / escape / 라우터 테스트
```

## 장소 추가 흐름
1. 구글 맵 링크 붙여넣기 → 좌표·이름 자동 추출
   - 긴 URL(`google.com/maps/place/...`)은 브라우저에서 바로 파싱 (`!3d!4d` 핀 좌표 우선)
   - 짧은 링크(`maps.app.goo.gl`)는 Edge Function 으로 펼친 뒤 파싱
2. 좌표가 없으면 이름/주소로 Nominatim(OSM) 검색
3. 미니 지도의 핀을 드래그해서 확인·조정, 또는 "현재 위치"
4. 위치 없이 저장도 가능 (목록에는 나오고 지도에는 안 나옴)

## 오프라인 동작
- **앱 자체**: Service Worker(PWA)가 빌드 파일 전체를 미리 캐시 → 한 번 열어본 기기는 오프라인에서도 앱이 열림
- **데이터**: 여행별로 localStorage 에 캐시 → 한 번 열어본 여행은 오프라인에서도 열람 가능
- **변경**: outbox 에 쌓였다가 온라인 복귀 / 화면 복귀 / 30초마다 재전송 (헤더 배지에 대기 건수 표시)
- **로그인**: 오프라인이라 토큰 갱신이 안 돼도 마지막으로 확인된 사용자로 동작
- **지도**: 한 번 본 지역은 자동 캐시. 장소 탭 지도 오른쪽 위 ⬇ 버튼으로 이 여행 장소 주변 지도를 미리 저장
  (z10~14, 최대 1,500장. 처음 보는 지명 글자는 오프라인에서 표시되지 않을 수 있으니 출발 전 지도를 한 번 둘러보기 권장)

### 출발 전 체크리스트
1. 여행 화면을 한 번 열어서 데이터가 내려받아지게 하기
2. 장소 탭 ⬇ 버튼으로 지도 저장 (와이파이)
3. **홈 화면에 추가** (아이폰: Safari 공유 → 홈 화면에 추가 / 안드로이드: 메뉴 → 앱 설치)
   - 아이폰 Safari 는 오래 방문하지 않은 사이트의 저장 데이터를 지울 수 있는데, 홈 화면 앱은 예외

## 새 버전 배포
main 에 push 하면 자동 배포되고, 사용자 화면에는 다음에 앱을 열거나 다시 볼 때 **"새 버전이 있어요 · 새로고침"** 배너가 뜹니다.
강제로 바꾸지 않으므로 입력 중인 내용이 날아가지 않고, 아직 못 보낸 변경도 localStorage 에 남아 있어 새로고침 후 이어서 전송됩니다.

## keepalive
- `keepalive.yml` 이 3일마다 Supabase `ping()` 을 호출 → 무료 프로젝트 비활성 정지 방지
- 같은 실행에서 `.keepalive` 파일을 커밋 → 공개 저장소의 예약 workflow 가 60일 무활동으로 꺼지는 것 방지
- 처음 한 번은 Actions → Supabase keepalive → Run workflow 로 수동 실행해서 성공하는지 확인

## 로그인과 여러 기기
- 기본은 **익명**: 초대 링크로 들어와 이름만 고르면 됨 (브라우저마다 별도 계정)
- 여러 기기에서 같은 사람으로 쓰려면
  - **Google 로그인**: 홈 오른쪽 위 로그인. 이 기기에서 이미 익명으로 참여 중이면 "계정 연결"(기록 유지) 또는 "기존 계정 로그인" 중 선택
  - **기기 추가 코드**: 쓰던 기기의 멤버 탭 → 다른 기기에서도 쓰기 → 8자리 코드(10분, 1회) → 새 기기의 홈 또는 초대 화면에서 입력
- owner 의 "연결 해제"는 그 멤버의 모든 기기 연결을 끊고 이름을 다시 선택 가능하게 만듦

## AI 정보 채우기
장소 추가/수정 화면의 이름 옆 **AI로 정보 채우기** → Gemini 가 Google 검색으로 확인한 대표 메뉴, 1인 가격대, 방문 팁, 휴무 주의, 소개를 초안으로 채움.
비어 있거나 자동으로 채운 칸만 덮어쓰고, 직접 입력한 칸은 건드리지 않음. 여행당 하루 50회 제한.

