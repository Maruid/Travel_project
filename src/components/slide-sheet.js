// =====================================================================
// 위 판(지도 · 요약) 위로 손가락을 따라 올라오는 목록 판 — 손짓 처리만 (배치는 화면이 정함)
//   올릴 때 판 먼저 → 이어서 목록, 내릴 때 목록을 맨 위까지 → 이어서 판 (한 손짓 안에서), 손 뗀 뒤 관성
//   계산은 lib/sheet-scroll.js (장소 탭과 같은 규칙)
//   attachSlideSheet({ sheet, scroller, maxOff, skip }) → { setOff, off, stop, destroy }
//     maxOff(): 판이 올라갈 수 있는 거리 · skip(target): 이 손짓은 판이 맡지 않음 (예: 손잡이)
// =====================================================================
import { splitScroll, sheetTakesGesture, releaseVelocity } from '../lib/sheet-scroll.js';

export function attachSlideSheet({ sheet, scroller, maxOff, skip = () => false, onChange = () => {} }) {
  let off = 0;
  let fling = 0;
  let g = null;

  function setOff(v, animate = false) {
    const next = Math.max(0, Math.min(maxOff(), v));
    sheet.style.transition = animate ? 'transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    sheet.style.transform = `translate3d(0, ${-next}px, 0)`;
    if (next !== off) { off = next; onChange(off); }
  }
  function moveBy(d) {
    const r = splitScroll(d, { off, max: maxOff(), scrollTop: scroller.scrollTop, scrollMax: scroller.scrollHeight - scroller.clientHeight });
    if (r.off !== off) setOff(r.off);
    if (r.scrollTop !== scroller.scrollTop) scroller.scrollTop = r.scrollTop;
  }
  function stop() { if (fling) cancelAnimationFrame(fling); fling = 0; }
  function startFling(v) {
    stop();
    if (Math.abs(v) < 0.05) return;
    let last = performance.now();
    const step = (now) => {
      const dt = Math.min(32, now - last); last = now;
      const before = [off, scroller.scrollTop];
      moveBy(v * dt);
      v *= Math.pow(0.996, dt);
      const stuck = before[0] === off && before[1] === scroller.scrollTop;
      fling = Math.abs(v) > 0.02 && !stuck ? requestAnimationFrame(step) : 0;
    };
    fling = requestAnimationFrame(step);
  }
  function swallowNextClick() {
    const block = (e) => { e.stopPropagation(); e.preventDefault(); };
    sheet.addEventListener('click', block, { capture: true, once: true });
    setTimeout(() => sheet.removeEventListener('click', block, { capture: true }), 350);
  }

  const onStart = (e) => {
    stop();
    if (e.touches.length !== 1 || skip(e.target) || maxOff() <= 0 && off === 0) { g = null; return; }
    const t = e.touches[0];
    g = { x: t.clientX, y: t.clientY, last: t.clientY, mode: null, samples: [{ y: t.clientY, t: e.timeStamp }] };
  };
  const onMove = (e) => {
    if (!g || g.mode === 'native') return;
    const t = e.touches[0];
    if (g.mode === null) {
      const dx = t.clientX - g.x; const dy = t.clientY - g.y;
      if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
      const take = Math.abs(dy) > Math.abs(dx) && sheetTakesGesture(dy < 0, { off, max: maxOff() });
      g.mode = take && e.cancelable ? 'sheet' : 'native';
      if (g.mode === 'native') return;
    }
    e.preventDefault();
    moveBy(g.last - t.clientY);
    g.last = t.clientY;
    g.samples.push({ y: t.clientY, t: e.timeStamp });
    if (g.samples.length > 8) g.samples.shift();
  };
  const onEnd = (e) => {
    if (g?.mode === 'sheet') { swallowNextClick(); startFling(releaseVelocity(g.samples, e.timeStamp)); }
    g = null;
  };
  const onWheel = (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    if (!sheetTakesGesture(d > 0, { off, max: maxOff() })) return;
    e.preventDefault();
    stop();
    moveBy(d);
  };
  sheet.addEventListener('touchstart', onStart, { passive: true });
  sheet.addEventListener('touchmove', onMove, { passive: false });
  sheet.addEventListener('touchend', onEnd);
  sheet.addEventListener('touchcancel', onEnd);
  sheet.addEventListener('wheel', onWheel, { passive: false });

  return {
    setOff,
    off: () => off,
    stop,
    destroy() {
      stop();
      sheet.removeEventListener('touchstart', onStart);
      sheet.removeEventListener('touchmove', onMove);
      sheet.removeEventListener('touchend', onEnd);
      sheet.removeEventListener('touchcancel', onEnd);
      sheet.removeEventListener('wheel', onWheel);
    },
  };
}
