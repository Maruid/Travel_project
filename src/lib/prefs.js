// 이 기기에만 저장되는 화면 설정 (localStorage, 실패해도 기본값으로 동작)
export const PREF_MAP_COLLAPSED = 'places:mapCollapsed';
export const PREF_ANCHOR_NEAR_SORT = 'places:anchorNearSort';
export const PREF_MAP_SIZE = 'places:mapSize';
export const PREF_HIDE_VISITED = 'places:hideVisited';   // 안 간 곳만 보기   // 's' | 'm' | 'l'

export function getPref(key) {
  try { return localStorage.getItem(key) === '1'; } catch { return false; }
}
export function setPref(key, on) {
  try { localStorage.setItem(key, on ? '1' : '0'); } catch {}
}

// 문자열 설정 (예: 장소 정렬 "rating:desc")
export const PREF_PLACE_SORT = 'places:sort';
export function getPrefStr(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function setPrefStr(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}
