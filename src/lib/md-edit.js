// 가이드 편집기 서식 버튼: 글자(value)와 선택 범위(start, end)를 받아 바뀐 글자와 새 선택 범위를 돌려줌
// 같은 버튼을 다시 누르면 서식이 풀림 (굵게 · 목록 · 번호 · 제목)

const PREFIX = {
  bullet: { re: /^- /, make: () => '- ' },
  number: { re: /^\d+\. /, make: (i) => `${i + 1}. ` },
  heading: { re: /^#{1,3} /, make: () => '### ' },
};

export function applyFormat(kind, value, start, end) {
  if (kind === 'bold') return toggleBold(value, start, end);
  if (kind === 'code') return codeBlock(value, start, end);
  if (PREFIX[kind]) return toggleLinePrefix(kind, value, start, end);
  return { value, start, end };
}

function toggleBold(value, start, end) {
  const sel = value.slice(start, end);
  // 이미 **로 감싼 선택(바깥 또는 안쪽)이면 풀기
  if (value.slice(start - 2, start) === '**' && value.slice(end, end + 2) === '**') {
    return { value: value.slice(0, start - 2) + sel + value.slice(end + 2), start: start - 2, end: end - 2 };
  }
  if (sel.length >= 4 && sel.startsWith('**') && sel.endsWith('**')) {
    const inner = sel.slice(2, -2);
    return { value: value.slice(0, start) + inner + value.slice(end), start, end: start + inner.length };
  }
  // 앞뒤 공백은 밖으로 (마크다운은 "** 글자**" 를 굵게로 안 봄)
  const lead = sel.match(/^\s*/)[0].length;
  const trail = sel.match(/\s*$/)[0].length;
  const core = sel.slice(lead, sel.length - trail) || '굵게';
  const s2 = start + lead;
  const out = `${value.slice(0, s2)}**${core}**${value.slice(s2 + (sel.length - lead - trail))}`;
  return { value: out, start: s2 + 2, end: s2 + 2 + core.length };
}

function lineBounds(value, start, end) {
  const ls = value.lastIndexOf('\n', start - 1) + 1;
  // 선택 끝이 줄 맨 앞이면 그 줄은 빼기 (여러 줄을 끝까지 드래그한 경우)
  const e = end > start && value[end - 1] === '\n' ? end - 1 : end;
  let le = value.indexOf('\n', e);
  if (le < 0) le = value.length;
  return [ls, le];
}

function toggleLinePrefix(kind, value, start, end) {
  const [ls, le] = lineBounds(value, start, end);
  const lines = value.slice(ls, le).split('\n');
  const { re, make } = PREFIX[kind];
  const content = lines.filter((l) => l.trim());
  const allHave = content.length > 0 && content.every((l) => re.test(l));
  let n = 0;
  const next = lines.map((l) => {
    if (allHave) return l.replace(re, '');
    if (!l.trim() && lines.length > 1) return l;   // 여러 줄 중 빈 줄은 그대로
    // 다른 머리표가 붙어 있으면 바꿔 끼움 (목록 → 번호)
    const bare = l.replace(PREFIX.bullet.re, '').replace(PREFIX.number.re, '').replace(PREFIX.heading.re, '');
    return make(n++) + bare;
  });
  const block = next.join('\n');
  const out = value.slice(0, ls) + block + value.slice(le);
  // 한 줄에 커서만 있었다면 커서를 줄 끝으로
  if (start === end && lines.length === 1) return { value: out, start: ls + block.length, end: ls + block.length };
  return { value: out, start: ls, end: ls + block.length };
}

function codeBlock(value, start, end) {
  const sel = value.slice(start, end);
  const body = sel.replace(/^\n+|\n+$/g, '') || '여기에 현지어 문장';
  const before = value.slice(0, start);
  const after = value.slice(end);
  const pre = before && !before.endsWith('\n') ? '\n' : '';
  const post = after && !after.startsWith('\n') ? '\n' : '';
  const block = `${pre}\`\`\`\n${body}\n\`\`\`${post}`;
  const s2 = before.length + pre.length + 4;
  return { value: before + block + after, start: s2, end: s2 + body.length };
}
