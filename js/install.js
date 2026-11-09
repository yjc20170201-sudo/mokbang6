// How to put the app on this phone's home screen, worked out from the browser's user agent.
// Pure (no DOM) so it can be checked in node: installGuide(ua, { touch, prompt, url }) → { key, title, steps, escape?, note? }
// steps are HTML strings (trusted, written here); escape is a link that hands the page to a real browser.
// Menu names checked 2026-11-09 (Chrome help, Apple iOS 26 guide, KakaoTalk guides).

export function sniff(ua, touch = 0) {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touch > 1); // iPadOS asks for the desktop site
  const android = !ios && /Android/i.test(ua);
  const inApp = /KAKAOTALK/i.test(ua) ? 'kakao' : /\bLine\//.test(ua) ? 'line' : /NAVER\(inapp|NAVER\//.test(ua) ? 'naver'
    : /Instagram/.test(ua) ? 'instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'facebook' : /DaumApps|DaumDevice/.test(ua) ? 'daum'
    : android && /; wv\)/.test(ua) ? 'webview' : '';
  const browser = /SamsungBrowser/.test(ua) ? 'samsung' : /Whale\//.test(ua) ? 'whale' : /EdgiOS|EdgA|Edg\//.test(ua) ? 'edge'
    : /CriOS/.test(ua) ? 'chrome' : /FxiOS|Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : '';
  const safariMajor = +(ua.match(/Version\/(\d+)/) || [])[1] || 0; // iOS 26+ freezes the OS number in the UA (18_6) but Version/26 stays true
  return { ios, android, inApp, browser, safariMajor };
}

const enc = encodeURIComponent;
const joinToQuery = url => { // an invite's #join= may not survive a hand-off to another app; the query string does
  const u = new URL(url), join = u.hash.match(/join=([\w-]+)/);
  if (join) { u.searchParams.set('join', join[1]); u.hash = ''; }
  return u;
};
export const kakaoOut = url => 'kakaotalk://web/openExternal?url=' + enc(joinToQuery(url).toString());
export const chromeIntent = url => { // Android: open this URL in Chrome from an in-app browser that passes intents on (not KakaoTalk's)
  const u = joinToQuery(url);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${enc(u.toString())};end`;
};
export const lineOut = url => { const u = joinToQuery(url); u.searchParams.set('openExternalBrowser', '1'); return u.toString(); };

const iosSafari = v => [
  v >= 26 ? '오른쪽 아래 <b>⋯</b> → <b>공유</b> (아래쪽에 <b>공유 버튼(□↑)</b>이 바로 보이면 그걸 눌러도 돼요)' : '아래쪽 <b>공유 버튼(□↑)</b>',
  `목록을 위로 올려 <b>홈 화면에 추가</b>${v >= 26 ? ' (안 보이면 <b>더 보기</b>)' : ''}`,
  ...(v >= 26 || !v ? ['<b>웹 앱으로 열기</b>는 <b>켠 채로</b> 두기 (끄면 그냥 사파리로 열려요)'] : []),
  '오른쪽 위 <b>추가</b>',
];
const IOS_MISSING = '<b>홈 화면에 추가</b>가 아예 없으면: 공유 목록 맨 아래 <b>동작 편집</b> → <b>홈 화면에 추가</b> 옆 ＋ → 완료';
const IOS_AFTER = '설치가 끝나면 <b>홈 화면의 먹방원정대 아이콘</b>으로 여세요. 아이폰은 브라우저와 앱의 저장 공간이 따로라, 이름표·공유 앨범은 앱에서 다시 설정해요.';
const ANDROID_AFTER = '홈 화면에 아이콘이 안 보이면 앱스 화면(위로 쓸어 올리기)에서 <b>먹방원정대</b>를 찾아 길게 눌러 홈 화면으로 옮기세요.';

export function installGuide(ua, { touch = 0, prompt = false, url = '' } = {}) {
  const s = sniff(ua, touch);
  const pageURL = url || 'https://yjc20170201-sudo.github.io/mokbang6/';
  const browserName = s.ios ? '사파리' : '크롬';
  if (s.inApp === 'kakao') return {
    key: 'kakao', title: '카톡 안에서는 설치가 안 돼요',
    escape: { label: s.ios ? '🧭 사파리로 열기' : '🌐 크롬으로 열기', href: kakaoOut(pageURL) },
    steps: s.ios
      ? ['위 버튼을 누르면 사파리로 열려요', '안 열리면: 오른쪽 아래 <b>공유 버튼</b> → <b>Safari로 열기</b> (목록에 없으면 <b>더 보기</b>)', '사파리에서 이 화면이 다시 뜨면 거기 적힌 대로 설치']
      : ['위 버튼을 누르면 크롬(기본 브라우저)으로 열려요', '안 열리면: 오른쪽 아래 <b>⋮</b> → <b>다른 브라우저로 열기</b> (물어보면 크롬 → 항상)', '크롬에서 이 화면이 다시 뜨면 거기 적힌 대로 설치'],
  };
  if (s.inApp) {
    const name = { line: '라인', naver: '네이버 앱', instagram: '인스타그램', facebook: '페이스북', daum: '다음 앱', webview: '이 앱' }[s.inApp];
    const escape = s.inApp === 'line' ? { label: s.ios ? '🧭 사파리로 열기' : '🌐 크롬으로 열기', href: lineOut(pageURL) }
      : s.android ? { label: '🌐 크롬으로 열기', href: chromeIntent(pageURL) } : null;
    return {
      key: 'inapp', title: `${name} 안에서는 설치가 안 돼요`, escape,
      steps: [escape ? '위 버튼을 누르면 브라우저로 열려요' : `메뉴(<b>⋯</b>) → <b>${s.ios ? 'Safari로 열기' : '다른 브라우저로 열기'}</b> 같은 항목 누르기`,
        `안 되면 아래 <b>📋 링크 복사</b> → ${browserName} 주소창에 붙여넣기`, `${browserName}에서 이 화면이 다시 뜨면 거기 적힌 대로 설치`],
    };
  }
  if (prompt) return { key: 'prompt', title: '버튼 한 번이면 설치돼요', steps: ['아래 <b>📲 설치하기</b> → <b>설치</b>'], note: s.android ? ANDROID_AFTER : '' };
  if (s.ios) {
    if (s.browser === 'safari') return { key: 'ios-safari', title: '아이폰: 홈 화면에 추가', steps: [...iosSafari(s.safariMajor), IOS_MISSING], note: IOS_AFTER };
    return { // Chrome, Edge and Firefox on iOS 16.4+ can add web apps from their share sheet; anything else falls back to Safari
      key: 'ios-chrome', title: '아이폰: 홈 화면에 추가',
      steps: ['주소창 옆 <b>공유 버튼(□↑)</b> (안 보이면 <b>⋯</b> 메뉴 → <b>공유</b>)', '목록을 위로 올려 <b>홈 화면에 추가</b> → <b>웹 앱으로 열기</b> 켠 채로 → <b>추가</b>',
        '<b>홈 화면에 추가</b>가 없으면 아래 <b>📋 링크 복사</b> → 사파리에서 열어 설치'],
      note: IOS_AFTER,
    };
  }
  if (s.android) {
    if (s.browser === 'samsung') return {
      key: 'samsung', title: '삼성 인터넷: 홈 화면에 추가',
      steps: ['주소창에 <b>설치(↓) 아이콘</b>이 보이면 누르고 아래 확인 창에서 설치',
        '아이콘이 없으면 오른쪽 아래 <b>☰</b> → <b>현재 페이지 추가</b> (없으면 <b>도구</b> 안) → <b>홈 화면</b> → <b>추가</b>', '<b>빠른 실행</b>이 아니라 <b>홈 화면</b>을 고르세요'],
      note: ANDROID_AFTER,
    };
    if (s.browser === 'chrome') return {
      key: 'android-chrome', title: '크롬: 앱 설치',
      steps: ['오른쪽 위 <b>⋮</b>', '<b>설치 및 바로가기 만들기</b> (폰에 따라 <b>홈 화면에 추가</b> 또는 <b>앱 설치</b>)', '<b>설치</b> 고르기 (<b>바로가기 만들기</b>를 고르면 그냥 크롬으로 열려요)',
        '메뉴에 없으면 시크릿 탭인지 확인하고 일반 탭에서 다시'],
      note: ANDROID_AFTER,
    };
    return { key: 'android-other', title: '크롬에서 설치해요', escape: { label: '🌐 크롬으로 열기', href: chromeIntent(pageURL) },
      steps: ['위 버튼으로 크롬에서 열기 (안 되면 <b>📋 링크 복사</b> → 크롬 주소창에 붙여넣기)', '크롬 <b>⋮</b> → <b>설치 및 바로가기 만들기</b> (또는 <b>홈 화면에 추가</b>) → <b>설치</b>'],
      note: ANDROID_AFTER };
  }
  return { key: 'desktop', title: '컴퓨터에서는', steps: ['크롬·엣지 주소창 오른쪽의 <b>설치</b> 아이콘', '여행 중엔 폰에 설치해서 쓰세요'] };
}
