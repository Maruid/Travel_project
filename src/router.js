// 해시 라우터: GitHub Pages 는 서버 라우팅이 없어서 #/ 경로를 사용
//   #/                     내 여행 목록
//   #/create               생성 코드로 새 여행
//   #/join/:token          초대 링크 참여
//   #/trip/:id/:tab?       여행 화면 (places | schedule | guides | budget | todos | more)
//   #/admin                관리자

const routes = [];
let current = { cleanup: null, key: null };

export function route(pattern, loader) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)(\?)?/g, (_, k, opt) => {
    keys.push(k);
    return opt ? '(?:([^/]+))?' : '([^/]+)';
  }).replace(/\/\(\?:/g, '/?(?:') + '/?$');
  routes.push({ re, keys, loader });
}

export function navigate(path, { replace = false } = {}) {
  const hash = '#' + path;
  if (replace) history.replaceState(null, '', hash);
  else if (location.hash !== hash) { location.hash = hash; return; }
  render();
}

export function currentPath() {
  return location.hash.replace(/^#/, '') || '/';
}

export async function render() {
  const path = currentPath();
  const app = document.getElementById('app');
  for (const r of routes) {
    const m = path.match(r.re);
    if (!m) continue;
    const params = Object.fromEntries(r.keys.map((k, i) => [k, m[i + 1] ? decodeURIComponent(m[i + 1]) : undefined]));
    const view = await r.loader();
    // 같은 뷰 안에서 파라미터만 바뀐 경우(탭 전환 등) 뷰가 직접 처리할 수 있게 함
    if (current.key === r.re.source && current.update) {
      current.update(params);
      return;
    }
    if (typeof current.cleanup === 'function') current.cleanup();
    const result = await view.render(app, params);
    current = { key: r.re.source, cleanup: result?.cleanup || null, update: result?.update || null };
    window.scrollTo(0, 0);
    return;
  }
  navigate('/', { replace: true });
}

export function startRouter() {
  window.addEventListener('hashchange', render);
  return render();
}
