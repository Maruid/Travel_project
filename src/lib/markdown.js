import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import { esc, raw } from './dom.js';
import { copyText } from '../components/ui.js';

// 가이드 카드용 마크다운
// - 코드블록(```)은 "복사" 버튼이 붙은 쇼잉 카드로 렌더링
// - 결과는 DOMPurify 로 정리 (다른 멤버가 쓴 내용이 그대로 HTML 이 되므로 필수)
const md = new Marked({
  gfm: true,
  breaks: true,
  // 취소선은 ~~글자~~ 만. 한 개짜리 ~ 는 범위(5~6분 · 09:00~18:00)로 자주 써서 그대로 둠
  tokenizer: {
    del(src) {
      const m = /^~~(?=[^\s~])([\s\S]*?[^\s~])~~(?!~)/.exec(src);
      if (m) return { type: 'del', raw: m[0], text: m[1], tokens: this.lexer.inlineTokens(m[1]) };
      return undefined;
    },
  },
  renderer: {
    code({ text }) {
      return `<div class="copy-card"><pre>${esc(text)}</pre><button type="button" data-copy>복사</button></div>`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

// 목록 첫머리 "머리말: 내용" → 머리말을 작은 색 글씨로 따로 (AI 카드 · 직접 쓴 가이드 공통)
//   머리말: 1~18자, 숫자로 끝나지 않음(09:30 · 체크인 15:00 제외), 뒤가 // 아님(주소 제외)
const LABEL_RE = /<li>(<p>)?(?:<strong>([^<>:\n]{1,18}?)\s*(?::\s*<\/strong>|<\/strong>\s*:)|([^<>:\n]{1,18}?):)(?!\/\/)\s*/g;
export function labelListItems(htmlStr) {
  return htmlStr.replace(LABEL_RE, (all, p, bold, plain) => {
    const label = (bold ?? plain).trim();
    if (!label || /\d$/.test(label) || !/[^\d\s.,]/.test(label)) return all;
    return `<li class="md-li-label">${p || ''}<span class="md-label">${label}</span>`;
  });
}

export function renderMarkdown(src) {
  const dirty = labelListItems(md.parse(src || ''));
  return raw(DOMPurify.sanitize(dirty, { ADD_ATTR: ['data-copy'] }));
}

// 복사 버튼 위임 (전역 1회)
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-card [data-copy]');
  if (!btn) return;
  const text = btn.parentElement.querySelector('pre')?.textContent ?? '';
  copyText(text, '문구');
});

// 새 카드 템플릿
export const GUIDE_TEMPLATES = [
  { key: 'blank', label: '빈 카드', icon: 'fa-note-sticky', color: '#94a3b8', title: '', body: '' },
  {
    key: 'weather', label: '날씨/복장', icon: 'fa-cloud-sun', color: '#38bdf8', title: '날씨 & 복장 가이드',
    body: '**기온 ○℃ ~ ○℃**\n\n- **도심:** \n- **주의할 날:** \n',
  },
  {
    key: 'transport', label: '교통 비교', icon: 'fa-train-subway', color: '#f43f5e', title: '이동수단 비교',
    body: '- 🥇 **추천:** \n- ⚠️ **주의:** \n- 🚨 **플랜 B:** \n',
  },
  {
    key: 'show', label: '쇼잉 카드', icon: 'fa-language', color: '#f59e0b', title: '현지어 쇼잉 카드',
    body: '```\n여기에 현지어 문장\n```\n\n뜻: \n',
  },
];
