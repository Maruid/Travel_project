import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchPlace, linkPlaceHeadings, numberedToLinks, linkedPlaceIds, normKey } from '../src/lib/place-link.js';

const id = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const places = [
  { id: id(1), name: '고칸 키타하마 본점', local_name: '五感 北浜本館' },
  { id: id(2), name: '구로몬 시장', local_name: '黒門市場' },
  { id: id(3), name: '도톤보리', local_name: null },
  { id: id(4), name: '도미인 프리미엄 난바', local_name: null },
  { id: id(5), name: '규카츠 모토무라 난바', local_name: null },
  { id: id(6), name: '규카츠 모토무라 우메다', local_name: null },
];

test('이름 비교', () => {
  assert.equal(normKey('구로몬 (시장)'), '구로몬시장');
  assert.equal(matchPlace('구로몬 시장 (Kuromon Market)', places)?.id, id(2));
  assert.equal(matchPlace('黒門市場', places)?.id, id(2));
  assert.equal(matchPlace('도미인 프리미엄 난바 · 시마노우치', places)?.id, id(4));       // 제목이 더 김
  assert.equal(matchPlace('규카츠 모토무라', places), null);                              // 후보 둘 → 연결 안 함
  assert.equal(matchPlace('옷차림', places), null);
});

test('제목 연결', () => {
  const out = linkPlaceHeadings('### 구로몬 시장 (Kuromon Market)\n- 꼭 볼 것: 해산물\n### 챙길 것', places);
  assert.ok(out.startsWith(`### [구로몬 시장 (Kuromon Market)](#place:${id(2)})`));
  assert.ok(out.includes('\n### 챙길 것'));
  // 이미 링크면 그대로
  const linked = `### [고칸](#place:${id(1)})`;
  assert.equal(linkPlaceHeadings(linked, places), linked);
});

test('AI 번호 제목 → 장소 링크', () => {
  const out = numberedToLinks('### 1. 고칸 본점 (Gokan)\n- a\n### 2. 구로몬 [시장]\n### 9. 없는 번호', [id(1), id(2)]);
  assert.ok(out.includes(`### [고칸 본점 (Gokan)](#place:${id(1)})`));
  assert.ok(out.includes(`### [구로몬 시장](#place:${id(2)})`));
  assert.ok(out.includes('### 없는 번호'));
});

test('연결된 장소 찾기', () => {
  const ids = linkedPlaceIds(`### [아무 이름](#place:${id(3)})\n### 구로몬 시장`, places);
  assert.deepEqual([...ids].sort(), [id(2), id(3)]);
});
