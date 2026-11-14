# 여행 안드로이드 앱 (APK) 안내

> 스토어 없이 GitHub Releases 에서 받아 설치하는 안드로이드 전용 앱입니다.
> 웹 화면을 앱 안에 넣은 구조(Capacitor)라 화면·기능은 웹과 같고, 앱에서만 되는 것만 더해집니다.
> 웹(크롬·PWA·아이폰)은 그대로 동작합니다 — 앱 기능은 모두 "앱 안일 때만" 켜집니다.
> 구조와 코드는 서재 앱(Maruid/seojae)의 방식을 그대로 따릅니다.

## 1. 앱에서 달라지는 것 (앱 기능 버전 1)
| 기능 | 내용 |
|---|---|
| 앱 저장 공간 | 여행 데이터·보낼 변경·지도가 크롬과 따로, 앱 안에 저장 (앱 삭제·데이터 지우기 때만 지워짐) |
| 로그인 | 구글은 앱 안 로그인을 막으므로 **크롬 탭**으로 열고 `io.github.maruid.travel://login` 으로 앱에 돌아옴. 계정 연결(익명 → Google)도 같은 방식 |
| 처음 실행 안내 | 앱은 "새 기기"로 보이므로 홈 위에 안내: Google 로그인 / 기기 추가 코드 / 초대 링크 붙여넣기. [✕]로 닫으면 다시 안 나옴 |
| 초대 링크로 참여 | 링크를 누르면 크롬이 열리므로, 홈의 [초대 링크로 참여]에 붙여넣기(메시지와 섞여 있어도 됨). 보기 전용 링크도 됨 |
| 보내는 링크 | 초대·보기 전용 링크는 앱 안에서도 웹 주소(`https://maruid.github.io/Travel_project/#/…`)로 만듦 |
| 공유 | 안드로이드 공유 창 (`@capacitor/share`) |
| 오프라인 지도 | 서비스 워커 대신 `lib/map-cache.js` 가 지도 요청을 기기 저장소(Cache API)로. 설정 탭 "오프라인 지도 저장"도 그대로 |
| 위치 | 처음 [내 위치]를 누를 때 안드로이드 위치 권한 창 |
| 뒤로가기 | Capacitor 기본 동작(웹 기록이 있으면 뒤로, 없으면 종료) + 기존 `back-nav.js` 규칙 그대로. 홈에서 "한 번 더 누르면 종료" |
| 화면 자동 업데이트 | 웹을 배포하면 앱이 다음에 열릴 때(또는 앱으로 돌아올 때) 새 화면 묶음을 받아 "새 버전이 있어요 [새로고침]" (APK 다시 설치 불필요) |
| 앱 업데이트 안내 | 새 화면이 더 새 앱 기능을 필요로 하면 "앱을 업데이트해 주세요 [받기]" |
| 설치 안내 띠 | 앱에서는 숨김. 웹(안드로이드 크롬)의 설정 → 앱에 [안드로이드 앱 받기] |

## 2. 처음 한 번 설정
### 2-1. 서명 키 만들기 (내 PC)
```
pip install cryptography
python tools/make_keystore.py        # 비밀번호 두 번 입력
```
- `travel-release.p12`(키)와 `travel-release.base64.txt`(Secret 용)가 생깁니다. **서재 키와 따로** 만듭니다.
- **`.p12` 파일과 비밀번호는 두 곳 이상 백업**(예: PC + 개인 클라우드). 잃어버리면 이미 깐 앱을 업데이트할 수 없어 지우고 다시 깔아야 하고, 그때 앱에 저장된 여행 데이터(아직 못 보낸 변경 포함)도 지워집니다.
- 저장소(공개)·대화·메신저에는 넣지 않습니다. `.gitignore` 에 `*.p12` 가 들어 있습니다.

### 2-2. GitHub Secrets (Travel_project → Settings → Secrets and variables → Actions → **Secrets**)
| 이름 | 값 |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | `travel-release.base64.txt` 내용 전체 |
| `ANDROID_KEYSTORE_PASSWORD` | 정한 비밀번호 |
| `ANDROID_KEY_ALIAS` | `travel` |
| `ANDROID_KEY_PASSWORD` | 같은 비밀번호 |

등록한 뒤 `travel-release.base64.txt` 는 지워도 됩니다(`.p12` 는 백업 보관).
Variables 의 `SUPABASE_URL` / `SUPABASE_KEY` 는 웹 배포와 같은 값을 그대로 씁니다.

### 2-3. Supabase 로그인 돌아올 주소
Authentication → URL Configuration → Redirect URLs 에 추가:
```
io.github.maruid.travel://login
```

## 3. APK 만들기 · 올리기
- GitHub → Actions → **Android APK** → Run workflow (또는 `app-v1.2.0` 같은 태그 push)
- 약 5~10분 뒤 Releases 에 `여행 앱 1.0.N` 과 `travel.apk` 가 올라감
- 받는 주소(항상 최신): `https://github.com/Maruid/Travel_project/releases/latest/download/travel.apk`
  - 웹의 설정 탭 → 앱 → [안드로이드 앱 받기] 버튼(안드로이드 크롬에서만 보임)
- 버전: 버전 코드 = 빌드 번호(자동 증가), 이름 = 태그 또는 `1.0.<빌드 번호>`

## 4. 휴대폰에 설치
1. 크롬에서 받기 링크를 누름 → 받기 완료 알림을 누름
2. 처음 한 번 "출처를 알 수 없는 앱 설치" → 크롬 허용
3. Play 프로텍트 경고가 뜨면 "무시하고 설치"(스토어에 없는 앱이라 뜨는 것)
4. 앱을 열면 처음 실행 안내 → 크롬에서 쓰던 여행을 이어서 쓰려면
   - Google 로 쓰던 사람: [로그인] → 크롬 탭에서 계정 고르기 → 앱으로 돌아옴
   - 로그인 없이 쓰던 사람: 크롬의 여행 → 설정 탭 → "다른 기기에서도 쓰기" 코드 → 앱의 [기기 코드]
- 앱과 크롬(웹)은 저장소가 따로 → 앱에서 처음 열 때 여행 데이터를 다시 받음(진행 중·출발 7일 전 여행은 자동으로 미리 받음)
- 오프라인 지도도 앱에서 한 번 다시 저장해야 함

## 5. 언제 APK 를 다시 만들어야 하나
| 바꾼 것 | 할 일 |
|---|---|
| 웹 화면(`src/` 등) | 지금처럼 main 에 push → Pages 배포(앱용 화면 묶음도 같이). 앱은 다음에 열 때 자동으로 새 화면 |
| 앱 쪽 코드(`android/`), 앱 플러그인 추가, 앱 이름·아이콘·권한 | Android APK 워크플로 실행 → 새 APK 설치 |
| 새 화면이 새 앱 기능을 씀 | `TravelPlugin.NATIVE_API` 와 `app-version.json` 의 `min_native_api` 를 올리고, 새 APK 먼저 → 그다음 웹 배포 (옛 앱은 업데이트 안내) |

## 6. 구조 (개발 참고)
- `capacitor.config.json` — 앱 ID `io.github.maruid.travel`, 이름 "여행", 화면 파일 `dist-app`(`npm run build:app`, `VITE_BASE=/ VITE_APP=1`)
- `vite.config.js` — `VITE_APP=1` 이면 PWA 플러그인을 빼고 `virtual:pwa-register` 를 빈 함수로 (앱에는 서비스 워커 없음)
- `src/config.js` — 앱 빌드에서는 `APP_URL` 을 웹 주소로 (`VITE_WEB_URL` 로 바꿀 수 있음)
- `src/lib/native.js` — 웹 쪽 앱 기능 (`isApp()` 일 때만): 로그인 · 계정 연결 복귀, 화면 묶음 업데이트(`@capgo/capacitor-updater`, 자동 업데이트·통계 끔), 앱 업데이트 안내, 공유, 상태바 글자색
  - `isApp()` = `window.Capacitor.isNativePlatform()` (앱 WebView 에 안드로이드 브리지가 있을 때)
  - 시작할 때 앱 쪽이 답하지 않아도 2초 뒤 계속 진행 (`getLaunchUrl` 시간 제한)
- `src/lib/map-cache.js` — 앱의 지도 저장: MapLibre `transformRequest` 로 `https://tiles.openfreemap.org/…` → `tcache://…`, `addProtocol('tcache')` 가 Cache API(`map-style` 최신 우선 4초 / `map-tiles` 저장본 우선)로 처리
- `src/lib/app-link.js` — 붙여넣은 초대·보기 전용 링크 → 앱 경로 (순수 함수)
- `android/` — Capacitor 안드로이드 프로젝트. `MainActivity`(플러그인 등록), `TravelPlugin`(기능 버전 `info`), 로그인 딥링크 intent-filter, 위치 권한, 서명은 환경 변수
  - `android/app/src/main/assets/public`, `capacitor-cordova-android-plugins` 는 `cap sync` 가 만드는 것이라 저장소에 넣지 않음(`android/.gitignore`)
- 화면 묶음: Pages 배포 때 `dist/app/bundle-<커밋>.zip` + `dist/app/version.json` 을 함께 올림 (deploy.yml)
- 화면 가장자리 여백: CSS `--sat` · `--sab` (앱은 Capacitor 가 `--safe-area-inset-*` 를 넣어 줌, 웹은 `env()`)
- 로컬에서 앱 빌드(선택): Android Studio + JDK 21 → `npm run cap:sync` → `android/` 열기

## 7. 글꼴 (웹 · 앱 공통 내장)
- `src/fonts/noto-sans-kr.woff2`(가변 100~900, 약 1.1MB) · `src/fonts/outfit.woff2`(약 33KB), `styles.css` 의 `@font-face`. Google Fonts 는 쓰지 않음.
- Noto Sans KR 담은 글자: 한글 11,172자 + 자모 + 영문·숫자·기호(원 숫자 ①② 등). 일본어·한자 등 그 밖의 글자는 기기 기본 글꼴.
- 다시 만들기 (fonttools):
  ```
  pip install fonttools brotli
  # google/fonts 저장소의 ofl/notosanskr/NotoSansKR[wght].ttf, ofl/outfit/Outfit[wght].ttf
  pyftsubset "NotoSansKR[wght].ttf" --text-file=kr-chars.txt --flavor=woff2 --layout-features='*' --output-file=noto-sans-kr.woff2
  pyftsubset "Outfit[wght].ttf" --text-file=latin-chars.txt --flavor=woff2 --layout-features='*' --output-file=outfit.woff2
  ```
  - `kr-chars.txt`: U+AC00–D7A3, U+3131–318E, U+0020–007E, U+00A0–00FF, U+2000–206F, U+2100–214F, U+2190–22FF, U+2460–26FF, U+2713–2714, U+3000–303F, U+FF01–FF5E, ₩ € ￦
  - 라이선스: `src/fonts/OFL-*.txt` (SIL Open Font License)

## 8. 휴대폰에서 확인할 것 (처음 APK)
1. 앱 열기 → 처음 실행 안내, 상태바·제스처 바에 화면이 가려지지 않는지
2. Google 로그인 → 크롬 탭 → 앱으로 돌아와 로그인됨
3. 뒤로가기: 시트 닫기 → 여행에서 홈 → 홈에서 "한 번 더 누르면 종료"
4. [내 위치] → 위치 권한 창
5. 일정·장소의 [길찾기] → 구글 지도 앱으로 열림
6. 설정 → 오프라인 지도 저장 → 비행기 모드에서 지도 보임
7. 초대 링크 [공유] → 안드로이드 공유 창
8. 웹을 한 번 더 배포 → 앱을 다시 열면 "새 버전이 있어요"
