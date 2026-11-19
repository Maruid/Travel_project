// =====================================================================
// 사용 방법 (홈 화면 [사용 방법]) — 처음 쓰는 사람을 위한 짧은 안내
//   기능이 바뀌면 여기 문구도 같이 고쳐 주세요 (docs/PROJECT_GUIDE.md 와 같은 순서)
// =====================================================================
import { html } from '../lib/dom.js';
import { openSheet } from './ui.js';
import { isApp } from '../lib/native.js';

const SECTIONS = () => [
  {
    icon: 'fa-flag-checkered', color: '#22d3ee', title: '시작하기', open: true,
    items: [
      ['새 여행', '홈의 [생성 코드로 새 여행 만들기]. 생성 코드는 관리자에게 받아요.'],
      ['함께 쓰기', '여행 안 [설정] 탭 → 초대 링크를 보내면 같이 편집해요. 보기만 할 사람은 보기 전용 링크.'],
      ['다른 기기', 'Google 로그인을 하거나, 설정 탭의 기기 추가 코드를 새 기기에 입력하면 같은 여행이 보여요.'],
      isApp() ? null : ['앱처럼 쓰기', '브라우저 메뉴의 "홈 화면에 추가"로 설치하면 오프라인에서도 열려요.'],
    ],
  },
  {
    icon: 'fa-map-location-dot', color: '#f472b6', title: '장소',
    items: [
      ['추가', '[+] → 이름 검색 또는 구글 지도 링크 붙여넣기.' + (isApp() ? ' 구글 지도에서 [공유] → 이 앱을 골라도 바로 추가돼요.' : '')],
      ['AI 정보 채우기', '추가할 때 대표 메뉴 · 가격 · 영업 팁 · 카테고리를 AI 가 채워 줘요.'],
      ['AI 추천 ✨', '"현지인 맛집", "야경 명소"처럼 쓰면 기준점 근처나 여행지 전체에서 골라 줘요. 마음에 드는 곳만 추가.'],
      ['기준점', '숙소를 기준점으로 정하면 카드마다 걸어서 몇 분인지 보이고 가까운 순으로 정렬돼요.'],
      ['목록 보기', '목록을 끌어 올리면 지도 위로 올라와요. 손잡이 왼쪽 [자세히 ↔ 간단히]로 한 줄 보기.'],
      ['찜 · 다녀옴', '같이 가는 사람이 찜한 곳이 표시되고, 다녀온 곳은 흐리게 보여요.'],
    ],
  },
  {
    icon: 'fa-calendar-days', color: '#a78bfa', title: '일정',
    items: [
      ['일정 넣기', '날짜를 고르고 [+], 또는 장소 상세의 [일정에]. 시간 · 메모 · 사진을 붙일 수 있어요.'],
      ['묵는 곳', '날짜마다 숙소를 정하면 하루 동선과 거리가 숙소 기준으로 계산돼요.'],
      ['이동편', '가는 편 · 오는 편 항공(기차 · 배 · 버스)을 등록하면 첫날 · 마지막 날 일정이 그 시간에 맞춰져요.'],
      ['AI 일정 짜기', '등록한 장소로 날짜별 동선을 짜 줘요. 마음에 안 들면 되돌리기.'],
    ],
  },
  {
    icon: 'fa-lightbulb', color: '#facc15', title: '가이드',
    items: [
      ['카드', '날씨 · 교통 · 현지어 쇼잉 카드 등 템플릿으로 만들고 마크다운으로 꾸며요.'],
      ['AI 가이드', '날씨 · 옷차림, 명소 체크포인트, 입국 · 출국 동선, 숙소 정보 카드를 등록한 정보로 만들어 줘요.'],
      ['장소 연결', '카드의 📍 이름을 누르면 그 장소가 열리고, 장소 상세의 [가이드에서 보기]로 돌아와요.'],
    ],
  },
  {
    icon: 'fa-wallet', color: '#34d399', title: '가계부',
    items: [
      ['돈 쓰는 방식', '가계부 ⚙에서 고르세요. 각자 내고 정산 · 공금 현금 · 공금 카드(트래블월렛 등) + 현금.'],
      ['공금', '[충전 · 환전]에 누가 얼마 넣었는지 적고, ATM에서 뽑으면 [현금 인출]. 지갑마다 남은 돈이 위에 보여요.'],
      ['내 용돈', '[지갑 추가]에서 "개인"으로 만들면 잔액은 나만 보고, 그 지갑으로 낸 돈은 내가 낸 것으로 정산돼요.'],
      ['지출 적기', '[+ 지출]에서 어디서 냈나(공금 · 내 지갑 · 개인 돈)와 누구 몫(모두 · 나만)을 골라요.'],
      ['목록 보기', '목록을 끌어 올리면 위 요약이 한 줄로 줄어요. 날짜순 · 금액순 · 카테고리별 정렬과 필터(어디서 · 누가 · 누구 몫).'],
      ['사전 결제', '항공권 · 숙소처럼 여행 전에 낸 돈. 이동편 · 숙소 장소의 [결제 금액]으로도 넣고, 정산과 여행 총비용에 들어가요.'],
      ['정산', '[정산]에서 누가 누구에게 얼마 보내면 되는지 보여주고, [복사]해서 단톡방에 붙여 넣어요.'],
      ['환율', '머리줄 계산기로 현지 돈 ↔ 원화 계산. 충전할 때 원화를 적으면 실제 평균 환율로 맞출 수 있어요.'],
    ],
  },
  {
    icon: 'fa-list-check', color: '#a3e635', title: '할 일',
    items: [
      ['할 일', '할 것 · 갈 곳 · 살 것 · 챙길 것 체크리스트. ✎로 열어 메모 · 사진 · 장소 · 날짜 · 담당을 정해요.'],
      ['날짜 · 담당', '날짜를 정하면 일정 탭 그 날에도 보여요. [내 담당만]으로 내 것만 볼 수 있어요.'],
      ['연결', '갈 곳을 체크하면 연결한 장소도 다녀옴으로, 살 것을 체크하면 [지출 기록]으로 가계부에 바로 적어요.'],
      ['정리', '왼쪽 손잡이를 끌어 순서를 바꾸고, [완료 숨기기]로 남은 것만 봐요. 지운 항목은 알림의 [되돌리기]로 살려요.'],
      ['준비물', '[🧳 준비물 목록]에서 여권 · 충전기 같은 기본 항목을 골라 한 번에 넣어요.'],
    ],
  },
  {
    icon: 'fa-image', color: '#38bdf8', title: '사진',
    items: [
      ['붙이기', '일정 · 가이드 · 할 일 편집 창 아래 [추가]. 바우처 · 티켓은 [문서]로 고르면 작은 글씨까지 선명해요.'],
      ['보관 기간', '여행이 끝나고 30일 뒤 자동으로 삭제돼요. 남길 사진은 크게 보기에서 [저장].'],
    ],
  },
  {
    icon: 'fa-plane-circle-check', color: '#fb923c', title: '오프라인',
    items: [
      ['자동 저장', '한 번 연 여행은 기기에 저장돼서 인터넷 없이도 보고 고칠 수 있어요. 연결되면 자동으로 맞춰져요.'],
      ['지도', '설정 탭 → 오프라인 지도 저장으로 여행지 지도를 미리 받아 두세요.'],
      ['사진', '출발 일주일 전부터 사진 썸네일과 문서 사진을 미리 받아 둬요.'],
    ],
  },
];

export function howToButtonHtml() {
  return html`
    <button data-action="how-to" class="w-full glass-card px-4 py-3 rounded-2xl flex items-center gap-3 text-left">
      <span class="w-8 h-8 rounded-xl bg-neon-cyan/15 text-neon-cyan flex items-center justify-center flex-shrink-0"><i class="fa-solid fa-book-open text-sm"></i></span>
      <span class="flex-1 min-w-0">
        <span class="block text-xs font-bold text-white">사용 방법</span>
        <span class="block text-[10px] text-slate-400 truncate">장소 · 일정 · AI 가이드 · 가계부 · 공금 정산 · 오프라인</span>
      </span>
      <i class="fa-solid fa-chevron-right text-[10px] text-slate-500"></i>
    </button>`;
}

export function openHowTo() {
  openSheet(html`
    <h3 class="text-base font-black text-white mb-1"><i class="fa-solid fa-book-open text-neon-cyan mr-1.5"></i>사용 방법</h3>
    <p class="text-[11px] text-slate-400 mb-3">여행 하나를 만들면 아래 탭으로 준비부터 정산까지 함께 써요.</p>
    <div class="space-y-2">
      ${SECTIONS().map((s) => html`
        <details class="glass-card rounded-2xl group" ${s.open ? 'open' : ''}>
          <summary class="px-3 py-2.5 flex items-center gap-2 cursor-pointer list-none">
            <i class="fa-solid ${s.icon} w-4 text-center text-xs" style="color:${s.color}"></i>
            <span class="flex-1 text-xs font-bold text-white">${s.title}</span>
            <i class="fa-solid fa-chevron-down text-[10px] text-slate-500 group-open:rotate-180 transition"></i>
          </summary>
          <ul class="px-3 pb-3 space-y-2">
            ${s.items.filter(Boolean).map(([k, v]) => html`
              <li class="text-[11px] leading-relaxed">
                <span class="block text-[10px] font-bold" style="color:${s.color}">${k}</span>
                <span class="text-slate-300">${v}</span>
              </li>`)}
          </ul>
        </details>`)}
    </div>
  `);
}
