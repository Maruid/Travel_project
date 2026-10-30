// 빌드 시 주입되는 공개 설정값 (GitHub Actions 의 repository variables 에서 넘어옴)
// 여기 들어가는 값은 전부 브라우저에 공개되는 값이어야 합니다. service_role key 는 절대 금지.
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
export const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_KEY;   // publishable(또는 legacy anon) key

// OpenFreeMap 벡터 스타일 (키 불필요). 다크 스타일 로딩이 실패하면 liberty 로 대체
export const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';
export const MAP_STYLE_FALLBACK = 'https://tiles.openfreemap.org/styles/liberty';

// 앱 루트 URL (OAuth 리다이렉트용). 해시 라우팅이라 base 경로까지만 사용
export const APP_URL = new URL(import.meta.env.BASE_URL, window.location.origin).href;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('VITE_SUPABASE_URL / VITE_SUPABASE_KEY 가 설정되지 않았습니다. .env.local 을 확인하세요.');
}
