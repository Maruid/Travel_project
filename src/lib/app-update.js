// 앱(APK) 업데이트 판단 (순수 함수)
//   api: 깔린 앱의 기능 버전 · min: 새 웹 화면이 꼭 필요로 하는 버전 · latest: 저장소의 최신 앱 기능 버전
//   required  → 꼭 업데이트 (아래 띠를 매번)
//   available → 새 앱이 있지만 없어도 됨 (띠는 그 버전마다 한 번, 이후 설정에서만)
//   latest    → 최신 · unknown → 아직 확인 못 함
export function appUpdateState({ api = 0, min = 0, latest = null } = {}) {
  if (!api) return 'unknown';
  if (min > api) return 'required';
  if (latest == null) return 'unknown';
  return latest > api ? 'available' : 'latest';
}

// 새 앱에서 쓸 수 있게 되는 기능 이름 (설정 안내용)
export const API_FEATURES = { 2: ['화면 켜두기', '초대 링크 앱에서 열기'], 3: ['구글 지도 [공유]로 장소 추가', '화면 세로 고정'], 4: ['사진을 기기 앨범에 저장'] };
export function newFeatures(api, latest) {
  const out = [];
  for (let v = api + 1; v <= latest; v++) out.push(...(API_FEATURES[v] || []));
  return out;
}
