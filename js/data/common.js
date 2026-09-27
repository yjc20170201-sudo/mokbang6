// Shared vocabulary: categories, stop kinds, speech lines, phrases, checklists.
export const CAT = {
  breakfast: { e: '🍳', n: '아침', g: 'food' }, cafe: { e: '☕', n: '카페', g: 'snack' }, ramen: { e: '🍜', n: '라멘', g: 'food' },
  udon: { e: '🍲', n: '우동', g: 'food' }, soba: { e: '🥢', n: '소바', g: 'food' }, sushi: { e: '🍣', n: '스시', g: 'food' },
  seafood: { e: '🦐', n: '해산물', g: 'food' }, okonomiyaki: { e: '🥞', n: '오코노미야키', g: 'food' }, takoyaki: { e: '🐙', n: '타코야키', g: 'snack' },
  kushikatsu: { e: '🍢', n: '쿠시카츠', g: 'food' }, yakiniku: { e: '🥩', n: '야키니쿠', g: 'food' }, wagyu: { e: '🥩', n: '와규', g: 'food' },
  yakitori: { e: '🍗', n: '야키토리', g: 'drink' }, izakaya: { e: '🏮', n: '이자카야', g: 'drink' }, standbar: { e: '🍶', n: '다치노미', g: 'drink' },
  bar: { e: '🥃', n: '바', g: 'drink' }, curry: { e: '🍛', n: '카레', g: 'food' }, tonkatsu: { e: '🐖', n: '돈카츠', g: 'food' },
  tempura: { e: '🍤', n: '텐푸라', g: 'food' }, monja: { e: '🍳', n: '몬자야키', g: 'food' }, street: { e: '🍡', n: '길거리 음식', g: 'snack' },
  market: { e: '🐟', n: '시장', g: 'food' }, sweets: { e: '🍰', n: '디저트', g: 'snack' }, souvenir: { e: '🎁', n: '기념품', g: 'shop' },
  sight: { e: '📸', n: '구경', g: 'see' }, onsen: { e: '♨️', n: '온천', g: 'see' }, diving: { e: '🤿', n: '프리다이빙', g: 'see' },
  pool: { e: '🏊', n: '다이빙풀', g: 'see' }, tennis: { e: '🎾', n: '테니스', g: 'see' }, hotel: { e: '🏨', n: '숙소', g: 'see' },
  station: { e: '🚉', n: '역', g: 'see' }, airport: { e: '✈️', n: '공항', g: 'see' }, shop: { e: '🛍️', n: '쇼핑', g: 'shop' },
  brewery: { e: '🍶', n: '양조장', g: 'see' }, sportshop: { e: '🎾', n: '테니스 용품', g: 'shop' },
};

export const KIND = {
  '아침': { act: 'eat', cls: '', color: '#f0a91f', hello: '아침은 든든하게!' },
  '점심': { act: 'eat', cls: '', color: '#e0442f', hello: '점심 먹자~' },
  '간식': { act: 'eat', cls: '', color: '#f08a1f', hello: '간식 타임!' },
  '저녁': { act: 'eat', cls: '', color: '#e0442f', hello: '저녁이다!! 🍽️' },
  '1차': { act: 'drink', cls: '', color: '#b8321f', hello: '1차 가즈아 🍺' },
  '2차': { act: 'drink', cls: '', color: '#8e2a1b', hello: '2차!! 🍶' },
  '3차': { act: 'drink', cls: '', color: '#6b1f16', hello: '3차…? 🥃' },
  '해장': { act: 'eat', cls: '', color: '#c7621f', hello: '마무리는 라멘이지 🍜' },
  '다이빙': { act: 'dive', cls: 'k-act', color: '#128f97', hello: '입수 준비! 🤿' },
  '테니스': { act: 'tennis', cls: 'k-tennis', color: '#9fb826', hello: '랠리 한 판! 🎾' },
  '온천': { act: 'onsen', cls: 'k-act', color: '#128f97', hello: '온천 가자 ♨️' },
  '관광': { act: 'sight', cls: 'k-act', color: '#1f6fb5', hello: '구경하자 📸' },
  '양조장': { act: 'drink', cls: 'k-act', color: '#6d8f3a', hello: '시음 가즈아 🍶' },
  '쇼핑': { act: 'shop', cls: 'k-act', color: '#7b4c9e', hello: '쇼핑 타임 🛍️' },
  '숙소': { act: 'sleep', cls: 'k-move', color: '#1f3a5f', hello: '짐 풀자~' },
  '공항': { act: 'fly', cls: 'k-move', color: '#1f3a5f', hello: '공항 도착 ✈️' },
  '이동': { act: 'sight', cls: 'k-move', color: '#1f3a5f', hello: '이동 중' },
};

export const LINES_BY_ACT = {
  eat: ['잘 먹겠습니다! 🙏', '이거 미쳤다…', '한 그릇 더?', '사진 먼저 찍어!', '총무, 여기 계산 좀~', '와 이 집 인정', '먹보 형 벌써 다 먹음'],
  drink: ['나마 로쿠! 🍺', '오늘 달린다 🔥', '한 잔 더?', '안주 추가요~', '2차 어디야?', '형님 원샷!', '막내야 주문 좀'],
  sight: ['사진 한 장 찍자 📸', '와… 크다', '인증샷 필수', '여기 좋다~', '단톡방에 올려!'],
  shop: ['총무! 이거 경비로 돼?', '와이프 선물 샀다', '면세 되나?', '하나 더 사자'],
  fly: ['출발~ ✈️', '벌써 끝이야?', '다음엔 어디 가?', '또 오자 형님들'],
  dive: ['시야 좋다!', '이퀄 잘 돼?', '버디 체크!'],
  tennis: ['나이스!', '듀스!'],
  onsen: ['으어~ 녹는다', '다리 풀린다…', '맥주 생각나네'],
  sleep: ['내일 몇 시 기상?', '코 골면 쫓아낸다', '💤'],
};

const PEOPLE = { 1: ['1人', '히토리'], 2: ['2人', '후타리'], 3: ['3人', '산닌'], 4: ['4人', '요닌'], 5: ['5人', '고닌'], 6: ['6人', '로쿠닌'], 7: ['7人', '나나닌'], 8: ['8人', '하치닌'] };
const THINGS = { 1: ['1つ', '히토츠'], 2: ['2つ', '후타츠'], 3: ['3つ', '밋츠'], 4: ['4つ', '욧츠'], 5: ['5つ', '이츠츠'], 6: ['6つ', '뭇츠'], 7: ['7つ', '나나츠'], 8: ['8つ', '얏츠'] };
export const splitOf = n => n <= 4 ? null : [Math.ceil(n / 2), Math.floor(n / 2)];
export const splitText = n => { const s = splitOf(n); return s ? s.join('+') : '한 테이블'; };
export function phrasesFor(n) {
  const [pj, pr] = PEOPLE[n] || PEOPLE[6], [tj, tr] = THINGS[n] || THINGS[6], sp = splitOf(n), cars = Math.ceil(n / 4);
  return [
    { ko: `${n}명이에요`, jp: `${pj}です`, rd: `${pr} 데스` },
    { ko: `${n}명 들어갈 수 있나요?`, jp: `${pj}、入れますか？`, rd: `${pr}, 하이레마스카?` },
    ...(sp ? [sp[0] === sp[1]
      ? { ko: `${sp[0]}명씩 나눠 앉아도 괜찮아요`, jp: `${PEOPLE[sp[0]][0]}ずつ分かれても大丈夫です`, rd: `${PEOPLE[sp[0]][1]}즈츠 와카레테모 다이조부데스` }
      : { ko: '두 테이블로 나눠 앉아도 괜찮아요', jp: '2つのテーブルに分かれても大丈夫です', rd: '후타츠노 테-부루니 와카레테모 다이조부데스' }] : []),
    { ko: `생맥주 ${n}잔 주세요`, jp: `生ビール${tj}ください`, rd: `나마비-루 ${tr} 쿠다사이` },
    { ko: '무제한 음료(노미호다이) 있어요?', jp: '飲み放題はありますか？', rd: '노미호-다이와 아리마스카?' },
    { ko: '추천 메뉴가 뭐예요?', jp: 'おすすめは何ですか？', rd: '오스스메와 난데스카?' },
    { ko: '이거 하나 더 주세요', jp: 'これ、もう一つください', rd: '코레, 모- 히토츠 쿠다사이' },
    { ko: '얼마나 기다려요?', jp: 'どのくらい待ちますか？', rd: '도노쿠라이 마치마스카?' },
    { ko: '계산해 주세요', jp: 'お会計お願いします', rd: '오카이케- 오네가이시마스' },
    { ko: '카드 되나요?', jp: 'カードで払えますか？', rd: '카-도데 하라에마스카?' },
    cars > 1 ? { ko: `택시 ${cars}대 불러 주세요`, jp: `タクシーを${cars}台お願いします`, rd: `타쿠시-오 ${cars === 2 ? '니' : '산'}다이 오네가이시마스` } : { ko: '택시 불러 주세요', jp: 'タクシーをお願いします', rd: '타쿠시-오 오네가이시마스' },
    { ko: '여기 어떻게 가요? (지도 보여주며)', jp: 'ここへはどう行けばいいですか？', rd: '코코에와 도- 이케바 이이데스카?' },
    { ko: '맛있어요!', jp: 'おいしいです！', rd: '오이시- 데스!' },
    { ko: '건배!', jp: '乾杯！', rd: '칸파이!' },
  ];
}

export const CHECKLIST = [
  '여권 (남은 기간 넉넉히)', 'Visit Japan Web 입국·세관 QR 등록', '항공권 e티켓 (요일·시간 재확인)', '숙소 방·침대 수 확인 (인원 맞춰)',
  'eSIM 또는 포켓와이파이', '트래블카드 + 엔화 현금 (1인 3~5만엔)', '교통카드 (모바일 Suica/ICOCA)',
  '프리다이빙 장비 (마스크·스노클·핀·웨이트) + 자격증 카드', '수영복·래시가드·비치타월', '테니스 라켓·테니스화·양말 여분',
  '상비약 (소화제·숙취해소제·파스)', '돼지코 어댑터 (일본 100V, 11자형 플러그)', '온천용 작은 수건', '보조배터리 (기내 반입만 가능)',
];

export function groupTips(n) {
  const cars = Math.ceil(n / 4), sp = splitOf(n);
  return [
    sp ? `작은 이자카야·바는 ${n}명이 한 번에 못 앉는 곳이 많아요. 입구에서 "${(PEOPLE[n] || PEOPLE[6])[1]}" 먼저 묻고, 안 되면 ${sp.join('+')}로 나눠 앉겠다고 하면 들어갈 때가 많아요.` : `${n}명이면 대부분 한 테이블에 앉을 수 있어요. 카운터석만 있는 곳은 나란히 앉기.`,
    '저녁과 1차는 가능하면 예약하세요. TableCheck, 구글맵 예약 버튼, 호텔 프런트 전화 부탁이 제일 쉬워요.',
    `택시는 1대에 4명까지라 ${n}명이면 ${cars}대. GO·Uber 앱으로 일본 택시를 부를 수 있어요.`,
    '이자카야는 자리값 오토시(お通し)가 1인 300~600엔쯤 자동으로 붙어요. 바가지 아니에요.',
    `노미호다이(음료 무제한) 90~120분 1,500~2,500엔. ${n}명이 달릴 땐 이득.`,
    '총무 1명이 공금 관리하고 매일 밤 정산. 꿀팁 탭 계산기로 1인당 금액 바로 나와요.',
    '팁 문화 없음. 계산은 보통 자리에서 영수증 들고 카운터로.',
    '편의점 아침·해장 퀄리티 좋아요: 오니기리, 계란 샌드, 컵라멘, 우콘(숙취음료).',
    '길거리 흡연은 대부분 금지. 흡연 구역에서만 피우세요.',
    `막차는 보통 자정 전후. 놓치면 택시 ${cars}대 (밤 10시~새벽 5시 할증 20%).`,
  ];
}

export const COMMON_TIPS = {
  changes: [
    '출국세(국제관광여객세)가 2026.7.1부터 1,000엔 → 3,000엔 (항공권 값에 포함).',
    '2026.11.1 구매분부터 면세가 환급형으로 바뀜: 가게에선 세금 내고, 출국 때 공항에서 돌려받음 (산 물건 들고 있어야 함, 90일 이내).',
    '2026.3.14 JR 동일본 운임 인상 등으로 교통비가 조금 올랐어요 (앱의 요금은 인상 반영).',
  ],
};
