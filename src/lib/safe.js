// 사용자 입력값을 style/class 에 넣을 때 쓰는 화이트리스트 검사
export const color = (c, fallback = '#94a3b8') => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fallback);
export const icon = (i, fallback = 'fa-tag') => (/^fa-[a-z0-9-]+$/.test(i || '') ? i : fallback);
