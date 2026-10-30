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
- 데이터는 여행별로 localStorage 에 캐시 → 오프라인에서도 열람 가능
- 변경은 outbox 에 쌓였다가 온라인이 되면 순서대로 전송 (헤더 배지에 대기 건수 표시)
- 행 단위 UUID + 필드 단위 패치 + soft delete 로 동시 편집 충돌 최소화

> 참고: 앱 자체(HTML/JS)를 오프라인에서 여는 Service Worker(PWA)는 아직 없습니다.
> 한 번 열어둔 탭은 오프라인에서도 동작하지만, 새로 여는 건 온라인이 필요합니다.
