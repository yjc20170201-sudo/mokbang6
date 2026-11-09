// How to put the app on this phone's home screen, worked out from the browser's user agent.
// Pure (no DOM) so it can be checked in node: installGuide(ua, { touch, prompt }) → { key, title, steps, escape?, note? }
// steps are HTML strings (trusted, written here); escape is a button that hands the page to a real browser.

export function sniff(ua, touch = 0) {
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && touch > 1); // iPadOS asks for the desktop site
  const android = !ios && /Android/i.test(ua);
  const inApp = /KAKAOTALK/i.test(ua) ? 'kakao' : /\bLine\//.test(ua) ? 'line' : /NAVER\(inapp|NAVER\//.test(ua) ? 'naver'
    : /Instagram/.test(ua) ? 'instagram' : /FBAN|FBAV|FB_IAB/.test(ua) ? 'facebook' : /DaumApps|DaumDevice/.test(ua) ? 'daum'
    : android && /; wv\)/.test(ua) ? 'webview' : '';
  const browser = /SamsungBrowser/.test(ua) ? 'samsung' : /Whale\//.test(ua) ? 'whale' : /EdgiOS|EdgA|Edg\//.test(ua) ? 'edge'
    : /CriOS/.test(ua) ? 'chrome' : /FxiOS|Firefox\//.test(ua) ? 'firefox' : /Chrome\//.test(ua) ? 'chrome' : /Safari\//.test(ua) ? 'safari' : '';
  const safariMajor = +(ua.match(/Version\/(\d+)/) || [])[1] || 0; // iOS 26 freezes the OS number in the UA but Safari's Version/26 stays true
  return { ios, android, inApp, browser, safariMajor };
}

const enc = encodeURIComponent;
export const kakaoOut = url => 'kakaotalk://web/openExternal?url=' + enc(url);
export const chromeIntent = url => { // Android: open this URL in Chrome from any in-app browser; the #fragment can't ride along, so an invite moves to ?join=
  const u = new URL(url), join = u.hash.match(/join=([\w-]+)/);
  if (join) u.searchParams.set('join', join[1]);
  return `intent://${u.host}${u.pathname}${u.search}#Intent;scheme=${u.protocol.slice(0, -1)};package=com.android.chrome;S.browser_fallback_url=${enc(u.toString())};end`;
};
export const lineOut = url => { const u = new URL(url); u.searchParams.set('openExternalBrowser', '1'); return u.toString(); };

const IOS_SAFARI = [
  '아래쪽에 <b>공유 버튼(□↑)</b>이 보이면 누르고, 안 보이면 오른쪽 아래 <b>⋯</b> → <b>공유</b>',
  '목록을 아래로 내려 <b>홈 화면에 추가</b> (안 보이면 맨 아래 <b>작업 편집</b>에서 추가)',
  '<b>웹 앱으로 열기</b>가 있으면 켠 채로 → 오른쪽 위 <b>추가</b>',
];
const IOS_AFTER = '설치가 끝나면 <b>홈 화면의 먹방원정대 아이콘</b>으로 여세요. 아이폰은 사파리와 앱의 저장 공간이 따로라, 이름표·공유 앨범은 앱에서 다시 설정해요.';

export function installGuide(ua, { touch = 0, prompt = false, url = '' } = {}) {
  const s = sniff(ua, touch);
  const pageURL = url || 'https://yjc20170201-sudo.github.io/mokbang6/';
  if (s.inApp === 'kakao') return {
    key: 'kakao', title: '카톡 안에서는 설치가 안 돼요',
    escape: { label: s.ios ? '🧭 사파리로 열기' : '🌐 크롬으로 열기', href: kakaoOut(pageURL) },
    steps: s.ios
      ? ['위 버튼을 누르면 사파리로 열려요', '안 열리면: 오른쪽 아래 <b>⋯</b>(또는 공유 버튼) → <b>Safari로 열기</b>', '사파리에서 다시 이 화면이 뜨면 거기서 설치']
      : ['위 버튼을 누르면 크롬(기본 브라우저)으로 열려요', '안 열리면: 오른쪽 위 <b>⋮</b> → <b>다른 브라우저로 열기</b>', '크롬에서 다시 이 화면이 뜨면 거기서 설치'],
  };
  if (s.inApp) {
    const name = { line: '라인', naver: '네이버 앱', instagram: '인스타그램', facebook: '페이스북', daum: '다음 앱', webview: '이 앱' }[s.inApp];
    const escape = s.inApp === 'line' ? { label: s.ios ? '🧭 사파리로 열기' : '🌐 크롬으로 열기', href: lineOut(pageURL) }
      : s.android ? { label: '🌐 크롬으로 열기', href: chromeIntent(pageURL) } : null;
    return {
      key: 'inapp', title: `${name} 안에서는 설치가 안 돼요`, escape,
      steps: [escape ? '위 버튼을 누르면 브라우저로 열려요' : `메뉴(<b>⋯</b> 또는 <b>⋮</b>) → <b>${s.ios ? 'Safari로 열기' : '다른 브라우저로 열기'}</b>`,
        `안 되면 아래 <b>링크 복사</b> → ${s.ios ? '사파리' : '크롬'} 주소창에 붙여넣기`, '브라우저에서 다시 이 화면이 뜨면 거기서 설치'],
    };
  }
  if (prompt) return { key: 'prompt', title: '버튼 한 번이면 설치돼요', steps: ['아래 <b>📲 설치하기</b> → <b>설치</b>', '홈 화면에 생긴 <b>먹방원정대</b> 아이콘으로 여세요'] };
  if (s.ios) {
    if (s.browser === 'safari') return { key: 'ios-safari', title: '아이폰: 홈 화면에 추가', steps: IOS_SAFARI, note: IOS_AFTER };
    if (s.browser === 'chrome' || s.browser === 'edge') return {
      key: 'ios-chrome', title: '아이폰 크롬: 홈 화면에 추가',
      steps: ['주소창 오른쪽 <b>공유 버튼(□↑)</b> (안 보이면 <b>⋯</b> → <b>공유</b>)', '<b>홈 화면에 추가</b> → <b>추가</b>', '안 보이면 아래 <b>링크 복사</b> → 사파리에서 열어 설치'],
      note: IOS_AFTER,
    };
    return { key: 'ios-other', title: '사파리에서 설치해요', steps: ['아래 <b>링크 복사</b> → <b>사파리</b> 주소창에 붙여넣기', ...IOS_SAFARI.slice(0, 2)], note: IOS_AFTER };
  }
  if (s.android) {
    if (s.browser === 'samsung') return {
      key: 'samsung', title: '삼성 인터넷: 홈 화면에 추가',
      steps: ['주소창에 <b>설치(⤓) 아이콘</b>이 보이면 누르기', '없으면 아래쪽 <b>≡</b> → <b>현재 페이지 추가</b> → <b>홈 화면</b>', '홈 화면에 생긴 <b>먹방원정대</b> 아이콘으로 열기'],
    };
    if (s.browser === 'chrome' || s.browser === 'edge') return {
      key: 'android-chrome', title: '크롬: 앱 설치',
      steps: ['오른쪽 위 <b>⋮</b>', '<b>앱 설치</b> 또는 <b>홈 화면에 추가</b> → <b>설치</b>', '홈 화면에 생긴 <b>먹방원정대</b> 아이콘으로 열기'],
    };
    return { key: 'android-other', title: '크롬에서 설치해요', escape: { label: '🌐 크롬으로 열기', href: chromeIntent(pageURL) },
      steps: ['위 버튼으로 크롬에서 열기 (안 되면 <b>링크 복사</b> → 크롬 주소창에 붙여넣기)', '크롬 <b>⋮</b> → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>'] };
  }
  return { key: 'desktop', title: '컴퓨터에서는', steps: ['크롬·엣지 주소창 오른쪽의 <b>설치</b> 아이콘', '여행 중엔 폰에 설치해서 쓰세요'] };
}
