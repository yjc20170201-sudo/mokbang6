// App glue: state, itinerary engine, UI (bottom sheet, tabs, overlays).
import * as THREE from 'three';
import { World } from './world.js';
import { CREW_DEFAULT } from './chars.js';
import { CAT, KIND, LINES_BY_ACT, phrasesFor, CHECKLIST, groupTips, splitText } from './data/common.js';
import * as J from './journal.js';
import { ShareClient, makeInvite, openInvite, REPO } from './share.js';

const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('mokbang6:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mokbang6:' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- quality ----------
const coarse = matchMedia('(pointer: coarse)').matches;
const lowEnd = (navigator.hardwareConcurrency || 8) <= 4 || store.get('low', false);
const Q = {
  tex: lowEnd ? 1536 : 2048, buildings: lowEnd ? 2500 : coarse ? 4200 : 7000,
  shadows: !lowEnd, shadowMap: coarse ? 1024 : 2048, aa: !lowEnd,
  pixelRatio: Math.min(window.devicePixelRatio || 1, lowEnd ? 1.25 : coarse ? 1.75 : 2),
};

const CITY_LOADERS = { osaka: () => import('./data/osaka.js'), tokyo: () => import('./data/tokyo.js') };
const S = {
  city: store.get('city', null), day: 0, stop: 0,
  tab: 'here', sheet: 'peek', viewPlace: null, here: null, nearFilter: 'all', openNow: false,
  crew: loadCrew(),
  krw: store.get('krw', null),
};
let C = null;            // current city data
let world = null;
let regionId = null;
let busy = false;
let gen = 0; // bumps on city switch so stale animations stop touching the new city

// ---------- helpers ----------
const krwRate = () => S.krw || C?.fx?.krwPerJpy || 8.6;
const yen = n => '¥' + Math.round(n).toLocaleString('ko-KR');
const won = n => { const w = n * krwRate(); return w >= 10000 ? `약 ${(w / 10000).toFixed(w >= 100000 ? 0 : 1)}만원` : `약 ${Math.round(w / 100) * 100}원`; };
const priceText = p => !p ? '—' : p[0] === p[1] ? yen(p[0]) : `${yen(p[0])}–${yen(p[1]).slice(1)}`;
const place = id => C.places[id];
function regionOf(p) {
  if (!p) return 'none';
  if (p.region) return p.region;
  for (const [rid, R] of Object.entries(C.regions)) { const [s, w, n, e] = R.bbox; if (p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e) return rid; }
  return C.mainRegion;
}
function proj(rid, lat, lng) { // same projection as tools/fetch-geo.mjs
  const [s, w, n, e] = C.regions[rid].bbox, lat0 = (s + n) / 2, lng0 = (w + e) / 2;
  return new THREE.Vector3((lng - lng0) * 111320 * Math.cos(lat0 * Math.PI / 180), 0, -(lat - lat0) * 110574);
}
const posOf = (p, rid = regionOf(p)) => proj(rid, p.lat, p.lng);
const dist = (a, b) => Math.hypot(a.lat - b.lat, (a.lng - b.lng) * Math.cos(a.lat * Math.PI / 180)) * 111000;
const walkMin = m => Math.max(1, Math.round(m * 1.3 / 75));
function stopPlaceId(di, si) { const st = C.days[di].stops[si]; return store.get(`swap:${C.id}:${di}:${si}`, null) || st.p; }
function stopPlace(di = S.day, si = S.stop) { return place(stopPlaceId(di, si)); }
const curStop = () => C.days[S.day].stops[S.stop];
const DOW = ['일', '월', '화', '수', '목', '금', '토'];
function tripDate(di) { const v = store.get('start:' + C.id, null); if (!v) return null; const d = new Date(v + 'T12:00:00'); if (isNaN(d)) return null; d.setDate(d.getDate() + di); return d; }
const fmtDate = d => `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]})`;
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function closedOn(p, d) { return !!(d && p && ((p.closed || []).includes(d.getDay()) || (p.closedDates || []).includes(isoDate(d)))); }
const FLIGHT_DAYS = { tokyo: [1, 3, 5, 0] };
const kindOf = st => KIND[st.k] || KIND['관광'];
const catOf = p => CAT[p?.cat] || CAT.sight;
function jpNow() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Tokyo', hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date());
  const g = t => parts.find(p => p.type === t)?.value;
  return { dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday')), min: (+g('hour') % 24) * 60 + +g('minute') };
}
function isOpen(p, dow, min) {
  if (!p.open || !p.open.length) return null;
  const toM = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  for (const [a, b] of p.open) {
    const A = toM(a), B = toM(b);
    if ((p.closed || []).includes(dow) === false && min >= A && min < B) return true;
    if (B > 1440 && min < B - 1440 && !(p.closed || []).includes((dow + 6) % 7)) return true;
  }
  return false;
}
function gmapsDir(p, mode = 'transit') { return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(p.q || p.nameJa || p.nameKo)}&travelmode=${mode}`; }
function gmapsSearch(p) { return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.q || p.nameJa || p.nameKo)}`; }
// real-world views: Google Street View (nearest panorama), Google Earth 3D (opens the Earth app on phones), Apple Look Around (iOS 18.4+ unified Maps URL; Apple has no Look Around in Wakayama)
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ll = p => `${(+p.lat).toFixed(6)},${(+p.lng).toFixed(6)}`;
function realViewLinks(p) {
  if (p.lat == null || p.lng == null || !isFinite(p.lat) || !isFinite(p.lng)) return '';
  const a = (href, label) => `<a href="${href}" target="_blank" rel="noopener">${label}</a>`;
  return a(`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${ll(p)}`, '🚶 스트리트뷰')
    + a(`https://earth.google.com/web/@${ll(p)},40a,450d,35y,0h,65t,0r`, '🌍 3D로 보기')
    + (IS_IOS && regionOf(p) !== 'shirahama' ? a(`https://maps.apple.com/look-around?coordinate=${ll(p)}`, '🍎 애플 둘러보기') : '');
}
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
function loadCrew() { // [{ c: character index, name }], 2–8 people
  const v2 = store.get('crew2', null);
  if (Array.isArray(v2) && v2.length >= 2) return v2.filter(m => CREW_DEFAULT[m?.c]).slice(0, 8);
  const old = store.get('crew', null); // first version: six names in fixed order
  return CREW_DEFAULT.slice(0, 6).map((d, i) => ({ c: i, name: (Array.isArray(old) && typeof old[i] === 'string' && old[i]) || '' }));
}
function crewDefs() { return S.crew.map(m => ({ ...CREW_DEFAULT[m.c], name: m.name || CREW_DEFAULT[m.c].role, idx: m.c })); }
const N = () => S.crew.length;
const taxis = () => Math.ceil(N() / 4);
const nameOfIdx = i => S.crew.find(m => m.c === i)?.name || CREW_DEFAULT[i]?.role || '';
const guideDef = () => crewDefs().find(d => d.id === 'guide') || crewDefs()[0];
// research notes were written for six people; say the real headcount when it differs
const fitN = t => N() === 6 || typeof t !== 'string' ? t : t.replace(/(^|[^\d])6명/g, `$1${N()}명`).replace(/3\+3/g, splitText(N()));

// ---------- legs ----------
const MODE = {
  walk: { ico: '🚶', name: '도보' }, metro: { ico: '🚇', name: '지하철' }, jr: { ico: '🚃', name: 'JR' }, private: { ico: '🚆', name: '전철' },
  taxi: { ico: '🚕', name: '택시' }, travel: { ico: '🚄', name: '특급열차' }, fly: { ico: '✈️', name: '비행기' }, bus: { ico: '🚌', name: '버스' },
  boat: { ico: '🚤', name: '보트' }, stay: { ico: '📍', name: '같은 곳' }, pickup: { ico: '🚐', name: '샵 픽업' },
};
function lineInfo(id) { return C.lineInfo?.[id] || null; }
function koSta(line, jp) { const L = lineInfo(line); const s = L?.st.find(([j]) => j === jp); return s ? s[1] : jp; }
const ridesOf = leg => leg.rides || (leg.line ? [{ line: leg.line, from: leg.from, to: leg.to }] : []);
function legSummary(leg) {
  if (!leg) return '';
  const M = MODE[leg.m] || MODE.walk;
  const parts = [];
  if (leg.m === 'walk') parts.push(`도보 ${leg.min || '?'}분`);
  else if (leg.m === 'stay') parts.push('바로 옆!');
  else if (['metro', 'jr', 'private'].includes(leg.m)) { const R = ridesOf(leg); parts.push(R.map(r => lineInfo(r.line)?.name || r.line).join(' → '), `${koSta(R[0].line, R[0].from)}→${koSta(R[R.length - 1].line, R[R.length - 1].to)}`, `${leg.min}분`); }
  else if (leg.m === 'taxi') parts.push(`택시 ${taxis()}대 ${leg.min}분`);
  else if (leg.m === 'pickup') parts.push(`샵 픽업 ${leg.min || ''}분`);
  else parts.push(`${leg.name || M.name}`, leg.min ? `${leg.min >= 60 ? Math.floor(leg.min / 60) + '시간 ' + (leg.min % 60 ? (leg.min % 60) + '분' : '') : leg.min + '분'}` : '');
  if (leg.fare) parts.push(leg.m === 'taxi' ? `1대 약 ${yen(leg.fare)}` : `1인 ${yen(leg.fare)}`);
  return `<span class="ico">${M.ico}</span><span>${parts.filter(Boolean).map((s, i) => i ? esc(s) : `<b>${esc(s)}</b>`).join(' · ')}</span>`;
}
function legSteps(leg, from, to) {
  if (!leg) return [];
  const steps = [];
  if (leg.m === 'walk' || leg.m === 'stay') steps.push({ i: '🚶', t: `${to ? esc(to.nameKo) + '까지 ' : ''}걸어서 약 ${leg.min || walkMin(from && to ? dist(from, to) : 300)}분`, s: leg.note });
  else if (['metro', 'jr', 'private'].includes(leg.m)) {
    const R = ridesOf(leg);
    if (leg.walkIn) steps.push({ i: '🚶', t: `${esc(koSta(R[0].line, R[0].from))}역까지 도보 ${leg.walkIn}분` });
    R.forEach((r, k) => {
      const L2 = lineInfo(r.line), last = k === R.length - 1;
      steps.push({ i: k ? '🔁' : MODE[leg.m].ico, t: `<span class="linebar" style="background:${L2?.color || '#888'}"></span><b>${esc(L2?.name || r.line)}</b> ${esc(koSta(r.line, r.from))} → ${esc(koSta(r.line, r.to))}`,
        s: last ? [R.length === 1 && leg.stops ? `${leg.stops}정거장` : '', leg.min ? `${R.length > 1 ? '전체 ' : ''}${leg.min}분` : '', leg.fare ? `${R.length > 1 ? '합계 ' : ''}${yen(leg.fare)}` : 'IC카드로 자동 정산', leg.dir ? `${leg.dir} 방면` : ''].filter(Boolean).join(' · ') : `${esc(koSta(r.line, r.to))}에서 환승` });
    });
    if (leg.walkOut) steps.push({ i: '🚶', t: `${esc(leg.gate ? leg.gate + ' 출구로 나와 ' : '')}도보 ${leg.walkOut}분` });
    if (leg.note) steps.push({ i: '💡', t: esc(fitN(leg.note)) });
  } else {
    steps.push({ i: MODE[leg.m]?.ico || '➡️', t: `<b>${esc(leg.name || MODE[leg.m]?.name)}</b> ${esc(leg.fromKo || leg.from || '')}${leg.to ? ' → ' + esc(leg.toKo || leg.to) : ''}`, s: [leg.min ? `${leg.min}분` : '', leg.fare ? (leg.m === 'taxi' ? `1대 약 ${yen(leg.fare)}` : `1인 ${yen(leg.fare)}`) : '', leg.dep ? `${leg.dep} 출발` : '', leg.arr ? `${leg.arr} 도착` : ''].filter(Boolean).join(' · ') });
    for (const x of leg.then || []) steps.push({ i: x.i || '➡️', t: esc(x.t), s: x.s });
    if (leg.note) steps.push({ i: '💡', t: esc(fitN(leg.note)) });
  }
  return steps;
}

// ---------- path planning in a region ----------
function segmentsFor(di, si) {
  const R = world.region; if (!R) return [];
  const st = C.days[di].stops[si], leg = st.leg || { m: 'walk' };
  const to = stopPlace(di, si), rid = regionOf(to);
  const prevIdx = si - 1; if (prevIdx < 0) return [];
  const from = stopPlace(di, prevIdx);
  if (regionOf(from) !== rid || rid !== regionId) return [];
  const A = posOf(from, rid), B = posOf(to, rid);
  if (['metro', 'jr', 'private'].includes(leg.m)) {
    const segs = []; let cur = A, ok = true;
    for (const r of ridesOf(leg)) {
      const sA = R.station(r.line, r.from), sB = R.station(r.line, r.to), path = R.linePath(r.line, r.from, r.to);
      if (!sA || !sB || !path) { ok = false; break; }
      if (cur.distanceTo(sA) > 25) segs.push({ type: 'walk', pts: [cur, sA] });
      segs.push({ type: 'ride', pts: path, color: lineInfo(r.line)?.color, label: `${MODE[leg.m].ico} ${lineInfo(r.line)?.name || ''}` });
      cur = sB;
    }
    if (ok) { if (cur.distanceTo(B) > 25) segs.push({ type: 'walk', pts: [cur, B] }); return segs; }
  }
  if (leg.m === 'taxi' || leg.m === 'pickup') { const mid = A.clone().lerp(B, 0.5).add(new THREE.Vector3(-(B.z - A.z), 0, B.x - A.x).multiplyScalar(0.12)); return [{ type: 'taxi', pts: [A, mid, B], label: leg.m === 'pickup' ? '🚐 샵 픽업' : `${'🚕'.repeat(taxis())} 택시 ${taxis()}대` }]; }
  if (leg.m === 'boat') return [{ type: 'boat', pts: [A, B] }];
  if (A.distanceTo(B) < 30) return [];
  return [{ type: 'walk', pts: [A, A.clone().lerp(B, 0.5).add(new THREE.Vector3(1, 0, 1).multiplyScalar(Math.min(40, A.distanceTo(B) * 0.05))), B] }];
}
function routeFor(di) { // all ribbons for the day in the current region
  const out = [];
  for (let si = 1; si < C.days[di].stops.length; si++) for (const s of segmentsFor(di, si)) out.push({ ...s, si });
  return out;
}
function clearZones() {
  const zones = [];
  for (const [di, d] of C.days.entries()) d.stops.forEach((st, si) => {
    const ids = [stopPlaceId(di, si), ...(st.alts || [])];
    for (const id of ids) { const p = place(id); if (p && p.lat != null && regionOf(p) === regionId) { const v = posOf(p, regionId); zones.push({ x: v.x, y: -v.z, r: 70 }); } }
  });
  for (let di = 0; di < C.days.length; di++) for (let si = 1; si < C.days[di].stops.length; si++) for (const s of segmentsFor(di, si)) if (s.type === 'walk') for (let i = 0; i + 1 < s.pts.length; i++) zones.push({ seg: [s.pts[i].x, -s.pts[i].z, s.pts[i + 1].x, -s.pts[i + 1].z], r: 22 });
  return zones;
}

// ---------- region loading ----------
let regionLoad = null;
async function ensureRegion(rid, opts = {}) {
  if (regionId === rid && world.region) return;
  if (!C.regions[rid]) return;
  if (regionLoad?.rid === rid) return regionLoad.p;
  const p = loadRegionNow(rid, opts);
  regionLoad = { rid, p };
  try { return await p; } finally { if (regionLoad?.p === p) regionLoad = null; }
}
async function loadRegionNow(rid, { quiet = false } = {}) {
  if (!quiet) { $('#loading').hidden = false; $('#loadingText').textContent = `${C.regions[rid].title} 지도 만드는 중…`; }
  try {
    const res = await fetch(`geo/${C.regions[rid].geo || rid}.json`);
    if (!res.ok) throw new Error('geo ' + res.status);
    const geo = await res.json();
    regionId = rid;
    if (S.here && !S.here.gps && S.here.region !== rid) S.here = null; // a tapped spot belongs to the old map
    await world.loadRegion(geo, { ...C.regions[rid] }, { clear: () => clearZones() });
    if (S.here?.gps && S.here.region === rid) world.setMe(S.here.pos, S.here.acc);
    refreshJournal();
  } catch (e) {
    toast('📴 지도를 못 불러왔어요 — 연결을 확인하고 다시 눌러 주세요', 3800);
    throw e;
  } finally { $('#loading').hidden = true; }
}

// ---------- rendering the scene state ----------
function refreshMarkers() {
  const d = C.days[S.day], items = [], seen = new Map();
  // one marker per place: the current stop wins, otherwise the first visit
  const order = d.stops.map((_, si) => si).sort((a, b) => (b === S.stop) - (a === S.stop) || a - b);
  for (const si of order) {
    const st = d.stops[si], p = stopPlace(S.day, si); if (!p || regionOf(p) !== regionId) continue;
    if (seen.has(p.id)) { seen.get(p.id).time += ' · ' + st.t; continue; }
    const K = kindOf(st), cur = si === S.stop;
    const it = { pos: posOf(p, regionId), emoji: st.e || catOf(p).e, text: short(st.label || p.nameKo, 16), time: st.t, cls: cur ? 'cur' : '', big: cur, color: cur ? '#e0442f' : K.color, onClick: () => jumpTo(S.day, si) };
    seen.set(p.id, it); items.push(it);
  }
  const st = curStop();
  for (const id of st.alts || []) {
    const p = place(id); if (!p || regionOf(p) !== regionId || id === stopPlaceId(S.day, S.stop)) continue;
    items.push({ pos: posOf(p, regionId), emoji: catOf(p).e, text: short(p.nameKo), cls: 'altm', color: '#7b8894', onClick: () => openPlace(id) });
  }
  if (S.viewPlace && !items.some(i => i.onClick && place(S.viewPlace) && regionOf(place(S.viewPlace)) === regionId)) {
    const p = place(S.viewPlace); if (p && regionOf(p) === regionId) items.push({ pos: posOf(p, regionId), emoji: catOf(p).e, text: short(p.nameKo), cls: 'altm', color: '#16847f', onClick: () => openPlace(S.viewPlace) });
  }
  if (S.here && !S.here.gps && S.here.region === regionId) items.push({ pos: S.here.pos, emoji: '🙋', text: '내 위치', cls: 'me', color: '#128f97' });
  world.setMarkers(items);
}
function refreshRoute() {
  world.clearRoute();
  for (const s of routeFor(S.day)) {
    const done = s.si <= S.stop;
    if (s.type === 'walk') world.addRoute(s.pts, { color: '#e0442f', dashed: true, width: 9, done });
    else if (s.type === 'ride') world.addRoute(s.pts, { color: s.color || '#555', dashed: false, width: 16, done });
    else world.addRoute(s.pts, { color: '#f0a91f', dashed: true, width: 12, done });
  }
}
const short = (s, n = 14) => { const t = String(s || '').replace(/\s*\(.*?\)\s*/g, '').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };

async function showStop({ animateFrom = null } = {}) {
  const st = curStop(), p = stopPlace();
  const rid = regionOf(p);
  if (rid !== regionId) { try { await ensureRegion(rid); } catch { renderAll(); return false; } }
  world.setTime(st.t);
  refreshMarkers(); refreshRoute();
  const pos = posOf(p, rid);
  if (!animateFrom) { world.clearActivity(); world.setOutfit(st.outfit || 'casual'); world.placeParty(pos, 0); world.setFollow(true); }
  startActivity();
  renderAll();
  store.set('pos', { city: C.id, day: S.day, stop: S.stop });
}
function startActivity() {
  const st = curStop(), p = stopPlace(), K = kindOf(st);
  const act = st.act || K.act;
  const pos = posOf(p, regionId);
  world.setOutfit(st.outfit || (act === 'dive' ? 'dive' : act === 'tennis' ? 'tennis' : 'casual'));
  world.activity(act, pos, { emoji: st.e || catOf(p).e, lines: st.lines || LINES_BY_ACT[act] || LINES_BY_ACT.sight, toast: st.toast, rot: st.courtRot, water: st.water ? proj(regionId, st.water[0], st.water[1]) : null });
  const d = world.members;
  d.forEach(m => m.acc.mug && (m.acc.mug.visible = act === 'drink' || (m.def.acc === 'mug' && m.outfit === 'casual')));
}

async function go(delta) {
  if (busy) return;
  const d = C.days[S.day];
  let di = S.day, si = S.stop + delta;
  if (delta < 0) {
    if (si < 0) { if (di === 0) return; di--; si = C.days[di].stops.length - 1; }
    S.day = di; S.stop = si; S.viewPlace = null; await showStop(); return;
  }
  if (si >= d.stops.length) { // next day
    if (di >= C.days.length - 1) { await finishTrip(); return; }
    busy = true; renderActions();
    await nightCard(di);
    S.day = di + 1; S.stop = 0; S.viewPlace = null;
    busy = false;
    await arriveAtStop(true);
    return;
  }
  busy = true; renderActions();
  const myGen = gen;
  S.viewPlace = null;
  const prevPlace = stopPlace(di, S.stop), prevStop = S.stop;
  S.stop = si;
  const st = curStop(), to = stopPlace(), leg = st.leg || { m: 'walk' };
  const fromR = regionOf(prevPlace), toR = regionOf(to);
  try {
    world.clearActivity();
    world.setOutfit('casual');
    world.setFollow(true);
    renderAll();
    if (fromR !== toR || leg.m === 'travel' || leg.m === 'fly') {
      await travel(leg, prevPlace, to, fromR, toR, myGen);
    } else {
      world.setTime(st.t);
      for (const s of segmentsFor(S.day, S.stop)) {
        if (s.type === 'walk') await world.walk(s.pts, { speed: 380, minDur: 1.2, maxDur: 5 });
        else if (s.type === 'ride') await world.ride(s.pts, { color: s.color, label: s.label, speed: 950, minDur: 1.8, maxDur: 4.5 });
        else if (s.type === 'taxi') await world.ride(s.pts, { vehicle: 'taxi', label: s.label, speed: 600, count: s.label.startsWith('🚐') ? 1 : taxis() });
        else if (s.type === 'boat') await world.ride(s.pts, { vehicle: 'boat', label: '🚤', speed: 400 });
        if (myGen !== gen) return;
      }
      refreshMarkers(); refreshRoute();
    }
    if (myGen !== gen) return;
    startActivity();
    world.say(arriveLine(st), world.members[2]);
  } catch (e) {
    console.warn(e);
    if (myGen === gen) { // put the crew back where they were
      S.stop = prevStop; $('#travel').hidden = true;
      if (regionOf(prevPlace) === regionId) { world.placeParty(posOf(prevPlace, regionId), 0); refreshMarkers(); refreshRoute(); startActivity(); }
    }
  } finally { if (myGen === gen) { busy = false; renderAll(); store.set('pos', { city: C.id, day: S.day, stop: S.stop }); } }
}
function arriveLine(st) { const K = kindOf(st); return st.hello || K.hello || '도착!'; }

async function arriveAtStop(fromNewDay) { // start of a day: teleport (or plane landing on day 1)
  const st = curStop(), p = stopPlace();
  if (st.leg?.m === 'fly' && st.leg.arrive) {
    const myGen = gen;
    busy = true; renderAll();
    try {
      const loading = ensureRegion(regionOf(p), { quiet: true });
      await ticket(st.leg, null, p, { auto: true, loading });
      await ensureRegion(regionOf(p), { quiet: true });
      if (myGen !== gen) return;
      world.setTime(st.t, true); refreshMarkers(); refreshRoute();
      const rw = C.regions[regionId].runway;
      if (rw) { world.setFollow(true); await world.planeLand(proj(regionId, ...rw[0]), proj(regionId, ...rw[1]), posOf(p, regionId)); }
      if (myGen !== gen) return;
      await showStop({ animateFrom: true });
      world.placeParty(posOf(p, regionId), 0);
      startActivity();
    } catch (e) { console.warn(e); }
    finally { if (myGen === gen) { busy = false; renderAll(); } }
    return;
  }
  await showStop();
  if (fromNewDay) world.say(`${S.day + 1}일차 시작! 가즈아 🔥`, world.members[0]);
}

async function travel(leg, from, to, fromR, toR, myGen = gen) {
  const R = world.region;
  const stale = () => myGen !== gen;
  // departure animation inside the current region
  if (leg.m === 'fly' && !leg.arrive) {
    const rw = C.regions[fromR].runway;
    if (rw && R) { await world.walk([posOf(from, fromR), proj(fromR, ...rw[0])], { speed: 400 }); if (stale()) return; await world.planeTakeoff(proj(fromR, ...rw[0]), proj(fromR, ...rw[1])); }
  } else if (leg.exit && R) {
    const sA = R.station(leg.exit.line, leg.exit.from), path = R.exitPath(leg.exit.line, leg.exit.from);
    if (sA) await world.walk([posOf(from, fromR), sA], { speed: 320 });
    if (stale()) return;
    if (path) await world.departOffMap(path, { color: leg.color || lineInfo(leg.exit.line)?.color, label: `${MODE[leg.m]?.ico || '🚄'} ${leg.name || ''}` });
  }
  if (stale()) return;
  // ticket card while the next region loads
  const loading = toR !== regionId ? ensureRegion(toR, { quiet: true }) : Promise.resolve();
  await ticket(leg, from, to, { loading });
  await loading;
  if (stale()) return;
  world.setTime(curStop().t, true);
  refreshMarkers(); refreshRoute();
  const R2 = world.region, B = posOf(to, toR);
  if (leg.enter && R2) {
    const sB = R2.station(leg.enter.line, leg.enter.at), path = R2.exitPath(leg.enter.line, leg.enter.at);
    if (sB && path) {
      world.members.forEach(m => m.root.visible = false);
      world.focus(sB, 1100, true); world.setFollow(true);
      await world.ride(path.slice().reverse(), { color: leg.color || lineInfo(leg.enter.line)?.color, label: `${MODE[leg.m]?.ico || '🚄'} ${leg.name || ''}`, minDur: 2.4, maxDur: 3.2 });
      if (stale()) return;
      await world.walk([sB, B], { speed: 300 });
      return;
    }
  }
  if (leg.m === 'fly' && leg.arrive && R2) {
    const rw = C.regions[toR].runway; if (rw) { await world.planeLand(proj(toR, ...rw[0]), proj(toR, ...rw[1]), B); return; }
  }
  world.placeParty(B, 0); world.focus(B, 900, true); world.setFollow(true);
}

// ---------- overlays ----------
function ticket(leg, from, to, { loading = null, auto = true } = {}) {
  return new Promise(async (resolve) => {
    const el = $('#travel'), M = MODE[leg.m] || MODE.travel;
    const dur = leg.min ? (leg.min >= 60 ? `${Math.floor(leg.min / 60)}시간${leg.min % 60 ? ' ' + (leg.min % 60) + '분' : ''}` : `${leg.min}분`) : '';
    el.innerHTML = `<div class="ticket" role="dialog" aria-label="이동 중">
      <div class="ticket-top" style="background:${leg.color || 'var(--ai)'}"><div class="mode">${M.ico} ${esc(M.name)} · ${esc(leg.dep ? leg.dep + ' 출발' : '이동 중')}</div><h3>${esc(leg.name || M.name)}</h3></div>
      <div class="ticket-route"><div class="st"><small>출발</small>${esc(leg.fromKo || from?.nameKo || leg.from || '')}</div><div style="font-size:22px">➜</div><div class="st"><small>도착</small>${esc(leg.toKo || to?.nameKo || leg.to || '')}</div></div>
      <div class="track"><i></i><b>${M.ico}</b></div>
      <div class="ticket-info">${dur ? `<span>⏱ ${dur}</span>` : ''}${leg.fare ? `<span>💴 1인 ${yen(leg.fare)} (${won(leg.fare)})</span>` : ''}${leg.arr ? `<span>🛬 ${esc(leg.arr)} 도착</span>` : ''}</div>
      ${leg.note ? `<div class="ticket-tip">💡 ${esc(fitN(leg.note))}</div>` : ''}
      <button class="btn primary" id="ticketGo">도착! ▶</button></div>`;
    el.hidden = false;
    const bar = el.querySelector('.track i'), icon = el.querySelector('.track b');
    let done = false, t0 = performance.now();
    const T = 2600;
    const step = () => { const k = Math.min(1, (performance.now() - t0) / T); bar.style.width = (k * 100) + '%'; icon.style.left = (k * 100) + '%'; if (k < 1 && !done) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    const btn = el.querySelector('#ticketGo');
    btn.disabled = true; btn.textContent = '이동 중…';
    await Promise.all([sleep(T), Promise.resolve(loading).catch(() => {})]);
    btn.disabled = false; btn.textContent = '도착! ▶';
    const close = () => { if (done) return; done = true; el.hidden = true; resolve(); };
    btn.onclick = close; btn.focus();
    if (auto) setTimeout(close, 1800);
  });
}
function nightCard(di) {
  return new Promise(res => {
    const el = $('#travel'), next = C.days[di + 1];
    el.innerHTML = `<div class="ticket"><div class="ticket-top" style="background:#1d2a4d"><div class="mode">🌙 ${di + 1}일차 끝</div><h3>푹 자고 내일 또 달립시다</h3></div>
      <div class="ticket-tip" style="padding-top:14px">☀️ <b>${di + 2}일차 · ${esc(next.title)}</b><br>${esc(next.sub || '')}</div>
      <button class="btn primary" id="ticketGo">${di + 2}일차 시작 ▶</button></div>`;
    el.hidden = false;
    world.setTime('23:50');
    el.querySelector('#ticketGo').onclick = () => { el.hidden = true; res(); };
    el.querySelector('#ticketGo').focus();
  });
}
async function finishTrip() {
  const st = curStop(), rw = C.regions[regionId]?.runway;
  if (st.act === 'fly' && rw) { busy = true; world.clearActivity(); await world.walk([posOf(stopPlace(), regionId), proj(regionId, ...rw[0])], { speed: 400 }); await world.planeTakeoff(proj(regionId, ...rw[0]), proj(regionId, ...rw[1])); busy = false; }
  const el = $('#travel'), total = tripBudget();
  el.innerHTML = `<div class="ticket"><div class="ticket-top" style="background:var(--sea)"><div class="mode">✈️ ${esc(C.name)} 원정 완료</div><h3>수고하셨습니다, 형님들!</h3></div>
    <div class="ticket-tip" style="padding-top:14px">4박 5일 먹방 원정 끝! 예상 경비는 1인 <b>${yen(total)}</b> (${won(total)}) 정도. 항공·숙소는 빼고 계산했어요.</div>
    <button class="btn primary" id="ticketGo">처음부터 다시 보기</button></div>`;
  el.hidden = false;
  el.querySelector('#ticketGo').onclick = async () => { el.hidden = true; S.day = 0; S.stop = 0; await arriveAtStop(true); };
}
function dayBudget(di) {
  let food = 0, move = 0;
  C.days[di].stops.forEach((st, si) => {
    const p = stopPlace(di, si); if (p?.price) food += (p.price[0] + p.price[1]) / 2 * (st.share ?? 1);
    if (st.leg?.fare) move += st.leg.m === 'taxi' ? st.leg.fare * taxis() / N() : st.leg.fare;
    if (st.extra) food += st.extra;
  });
  return { food, move, total: food + move };
}
const tripBudget = () => C.days.reduce((a, _, i) => a + dayBudget(i).total, 0);

// ---------- UI rendering ----------
function renderDays() {
  $('#days').innerHTML = C.days.map((d, i) => `<button class="chip" aria-pressed="${i === S.day}" data-day="${i}"><b>${i + 1}일</b>${esc(d.chip || '')}${tripDate(i) ? ` <small class="tnum">${tripDate(i).getMonth() + 1}/${tripDate(i).getDate()}</small>` : ''}</button>`).join('');
}
function renderClock() {
  const st = curStop(); const h = +st.t.split(':')[0];
  $('#clockTime').textContent = st.t;
  $('#clockIcon').textContent = h < 5 || h >= 20 ? '🌙' : h < 7 ? '🌅' : h < 17 ? '☀️' : h < 19 ? '🌇' : '🌆';
  $('#clockDay').textContent = `${S.day + 1}일차`;
  $('#cityName').textContent = `${C.emoji} ${C.name}`;
}
function renderHead() {
  const st = curStop(), p = stopPlace(), K = kindOf(st), next = C.days[S.day].stops[S.stop + 1];
  $('#sheetHead').innerHTML = `
    <div class="stop-head">
      <div class="stop-emoji" aria-hidden="true">${st.e || catOf(p).e}</div>
      <div class="stop-meta"><span class="kind ${K.cls}">${esc(st.k)}</span>${indoorChip(p)}<span class="tnum">${st.t}</span><span>· ${S.stop + 1}/${C.days[S.day].stops.length}</span>${p.area ? `<span>· ${esc(p.area)}</span>` : ''}</div>
      <h2 class="stop-name">${esc(st.label || p.nameKo)}</h2>
    </div>
    ${st.leg ? `<div class="leg-line">${legSummary(st.leg)}</div>` : ''}`;
  const nav = $('#navBtn');
  nav.href = st.leg?.m === 'walk' ? gmapsDir(p, 'walking') : gmapsDir(p, 'transit');
  renderActions(next);
  if (S.sheet === 'peek') setSheet('peek');
}
function renderActions(next = C.days[S.day].stops[S.stop + 1]) {
  const nb = $('#nextBtn');
  const last = S.stop >= C.days[S.day].stops.length - 1;
  nb.disabled = busy;
  nb.textContent = busy ? '이동 중…' : last ? (S.day >= C.days.length - 1 ? '여행 마무리 ✈️' : `${S.day + 2}일차로 ▶`) : `다음: ${short(next?.label || place(next?.p)?.nameKo || '')} ▶`;
  $('#prevBtn').disabled = busy || (S.day === 0 && S.stop === 0);
}
function renderBody(keepScroll = false) {
  document.querySelectorAll('.tab').forEach(t => t.setAttribute('aria-selected', String(t.dataset.tab === S.tab)));
  const b = $('#sheetBody');
  b.innerHTML = S.tab === 'here' ? (S.viewPlace ? placeHTML(S.viewPlace, true) : hereHTML()) : S.tab === 'plan' ? planHTML() : S.tab === 'near' ? nearHTML() : S.tab === 'album' ? albumHTML() : tipsHTML();
  hydrateThumbs(b);
  if (!keepScroll) b.scrollTop = 0;
}
function renderAll() { renderDays(); renderClock(); renderHead(); renderBody(); renderParty(); if (GPS.fix) { hideArrive(); checkArrival(); } }
function renderParty() {
  const defs = crewDefs();
  $('#partyDots').innerHTML = defs.map(d => `<i style="background:${d.shirt}" title="${esc(d.name)}"></i>`).join('');
  const st = curStop();
  $('#partyText').textContent = busy ? `${MODE[st.leg?.m]?.ico || '🚶'} ${short(stopPlace().nameKo)}(으)로 이동 중` : `${st.e || ''} ${st.k} 중 · ${N()}명`;
}

// indoor/outdoor tag for courts and pools (p.indoor: 'all' | 'some' | 'none', p.courts: court summary)
const INDOOR = { all: ['k-in', '🏠 실내'], some: ['k-in', '🏠 실내 코트 있음'], none: ['k-out', '☀️ 실외만'] };
const indoorChip = (p, style = '') => INDOOR[p?.indoor] ? `<span class="kind ${INDOOR[p.indoor][0]}"${style ? ` style="${style}"` : ''}>${INDOOR[p.indoor][1]}</span>` : '';
const indoorPre = p => INDOOR[p?.indoor] ? INDOOR[p.indoor][1] + ' · ' : '';
function infoGrid(p) {
  const g6 = { easy: ['easy', `👍 ${N()}명 바로 OK`], reserve: ['reserve', '📞 예약하면 OK'], split: ['split', N() <= 4 ? '🪑 카운터석 위주' : `✂️ ${splitText(N())} 나눠 앉기`] }[p.g6] || null;
  const cells = [
    ['영업시간', p.hours || '—'], ['가격 (1인)', p.price ? `${priceText(p.price)} · ${won((p.price[0] + p.price[1]) / 2)}` : '—'],
    [`${N()}명 자리`, g6 ? `<span class="g6 ${g6[0]}">${g6[1]}</span>` : '—'], ['결제', p.cash === true ? '💴 현금만' : p.cash === false ? '💳 카드 OK' : '—'],
    ['예약', p.reserve || '—'], ['가까운 역', p.sta || '—'], ['코트', p.courts || '—'],
  ];
  const shown = cells.filter(([, v]) => v && v !== '—');
  return shown.length ? `<dl class="grid2">${shown.map(([k, v]) => `<div class="cell"><dt>${k}</dt><dd>${v.startsWith('<') ? v : esc(v)}</dd></div>`).join('')}</dl>` : '';
}
function placeCore(p) {
  return `
    ${p.desc ? `<p style="margin:0 0 10px;font-size:14.5px">${esc(p.desc)}</p>` : ''}
    ${p.nameJa ? `<p class="note" style="margin:-4px 0 10px"><span class="ja" style="font-size:14px;color:var(--ink-2)">${esc(p.nameJa)}</span>${p.addrJa ? ` · <span class="ja">${esc(p.addrJa)}</span>` : ''}</p>` : ''}
    ${p.menu?.length ? `<div class="sec"><h3>🍽️ 이거 시켜요</h3><ul class="menu">${p.menu.map(m => `<li>${esc(m)}</li>`).join('')}</ul></div>` : ''}
    <div class="sec">${infoGrid(p)}</div>
    ${p.tips?.length ? `<div class="sec"><h3>💡 알아두면 좋은 것</h3><ul class="tips">${p.tips.map(t => `<li>${esc(fitN(t))}</li>`).join('')}</ul></div>` : ''}
    ${p.rain ? `<div class="sec"><h3>☔ 비 오면</h3><div class="card"><p>${esc(fitN(p.rain))}</p></div></div>` : ''}
    ${p.booking ? `<div class="sec"><h3>📅 예약 방법</h3><div class="card"><p>${esc(p.booking.how || '')}</p>${p.booking.lang ? `<p class="note">언어: ${esc(p.booking.lang)}${p.booking.lead ? ' · ' + esc(p.booking.lead) : ''}</p>` : ''}${p.booking.url ? `<div class="links" style="margin-top:8px"><a href="${esc(p.booking.url)}" target="_blank" rel="noopener">예약 페이지 열기 ↗</a></div>` : ''}</div></div>` : ''}
    ${p.gear ? `<div class="sec"><h3>🎒 장비</h3><p style="margin:0;font-size:13.5px;color:var(--ink-2)">${esc(p.gear)}</p></div>` : ''}
    <div class="sec links"><a href="${gmapsSearch(p)}" target="_blank" rel="noopener">📍 구글맵에서 보기</a><a href="${gmapsDir(p)}" target="_blank" rel="noopener">🧭 여기로 길찾기</a>${realViewLinks(p)}${p.nameJa && CAT[p.cat]?.g !== 'see' ? `<a href="https://tabelog.com/rstLst/?sw=${encodeURIComponent(p.nameJa)}" target="_blank" rel="noopener">⭐ 타베로그 리뷰</a>` : ''}</div>`;
}
function hereHTML() {
  const st = curStop(), p = stopPlace(), prev = S.stop ? stopPlace(S.day, S.stop - 1) : null;
  const steps = legSteps(st.leg, prev, p);
  const alts = (st.alts || []).map(place).filter(Boolean);
  const mainId = stopPlaceId(S.day, S.stop), swapped = mainId !== st.p;
  const allOpts = swapped ? [place(st.p), ...alts.filter(a => a.id !== mainId)] : alts;
  const dd = tripDate(S.day);
  const warnHTML = closedOn(p, dd) ? `<div class="sec card warn-card"><h4>⚠️ ${fmtDate(dd)}은 휴무일이에요</h4><p>아래 '근처 다른 선택지'에서 다른 집으로 바꾸세요.</p></div>` : '';
  return `${warnHTML}
    ${st.say ? `<div class="sec guide"><div class="face" aria-hidden="true">${guideDef().emoji}</div><div class="bubble"><b>${esc(guideDef().name)}</b> ${esc(fitN(st.say))}</div></div>` : ''}
    ${steps.length ? `<div class="sec"><h3>🧭 여기까지 가는 법</h3><ol class="steps">${steps.map(s => `<li><span class="n">${s.i}</span><span class="t">${s.t}${s.s ? `<small>${esc(s.s)}</small>` : ''}</span></li>`).join('')}</ol></div>` : ''}
    ${journalStrip(p)}
    <div class="sec">${placeCore(p)}</div>
    ${p.cat === 'hotel' ? hotelHTML(p) : ''}
    ${allOpts.length ? `<div class="sec"><h3>🔁 근처 다른 선택지</h3>${allOpts.map(a => altRow(a, p)).join('')}${swapped ? `<button class="small-btn swap" data-unswap="1">원래 추천으로 되돌리기</button>` : ''}</div>` : ''}`;
}
function altRow(a, from) {
  const m = from ? dist(from, a) : 0;
  return `<button class="alt" data-place="${a.id}"><span class="e">${catOf(a).e}</span><span><span class="nm">${esc(a.nameKo)}</span><span class="ds" style="display:block">${esc(indoorPre(a) + (a.desc || ''))}</span></span><span class="dist">${from ? `🚶 ${walkMin(m)}분` : ''}<br>${a.price ? priceText(a.price) : ''}</span></button>`;
}
function placeHTML(id, withBack) {
  const p = place(id); if (!p) return '';
  const st = curStop(), isAlt = (st.alts || []).includes(id) || id === st.p;
  const inPlan = C.days.some((d, di) => d.stops.some((s, si) => stopPlaceId(di, si) === id));
  return `${withBack ? `<button class="small-btn" data-back="1">◀ 지금 일정으로</button>` : ''}
    <div class="sec"><div class="stop-meta" style="margin-top:12px"><span class="kind">${catOf(p).e} ${esc(catOf(p).n)}</span>${indoorChip(p)}${p.area ? `<span>${esc(p.area)}</span>` : ''}</div><h2 class="stop-name" style="margin-top:4px">${esc(p.nameKo)}</h2></div>
    ${isAlt && id !== stopPlaceId(S.day, S.stop) && p.region !== 'none' ? `<button class="btn primary" style="width:100%;margin-top:12px;height:44px;font-size:16px" data-swap="${id}">🔁 이 집으로 바꾸기</button>` : ''}
    ${inPlan && !isAlt ? `<p class="note">일정에 들어 있는 곳이에요.</p>` : ''}
    <div class="sec">${placeCore(p)}</div>`;
}
function planHTML() {
  const d = C.days[S.day], b = dayBudget(S.day);
  const start = store.get('start:' + C.id, ''), dd = tripDate(S.day);
  const fd = FLIGHT_DAYS[C.id];
  const flightWarn = start && fd && (!fd.includes(tripDate(0).getDay()) || !fd.includes(tripDate(C.days.length - 1).getDay()))
    ? `<div class="card warn-card" style="margin-top:8px"><p>⚠️ 제주↔나리타 직항은 월·수·금·일만 있어요. 출발 ${fmtDate(tripDate(0))} / 귀국 ${fmtDate(tripDate(C.days.length - 1))} 조합은 직항 왕복이 안 돼요 (월→금, 수→일 추천).</p></div>` : '';
  const closedCount = d.stops.filter((st, si) => closedOn(stopPlace(S.day, si), dd)).length;
  return `<div class="tripdate"><label for="tripStart">🗓️ 출발일</label><input type="date" id="tripStart" value="${start}"><span class="note">${start ? '요일별 휴무를 체크해 드려요' : '날짜를 넣으면 휴무일을 체크해 드려요'}</span></div>${flightWarn}
    ${closedCount ? `<div class="card warn-card" style="margin-top:8px"><p>⚠️ 이날 휴무인 곳이 ${closedCount}곳 있어요. 빨간 표시를 눌러 대안으로 바꾸세요.</p></div>` : ''}
    <div class="day-hero" style="margin-top:12px"><span class="eyebrow">${S.day + 1}일차${dd ? ' · ' + fmtDate(dd) : ''}</span><h2>${esc(d.title)}</h2><p>${esc(d.sub || '')}</p>
    <div class="budget"><span>🍽️ 먹고 마시고 ${yen(b.food)}</span><span>🚃 교통 ${yen(b.move)}</span><span>💰 1인 약 ${won(b.total)}</span></div></div>
    <ol class="tl">${d.stops.map((st, si) => {
      const p = stopPlace(S.day, si), K = kindOf(st);
      return `<li class="${si < S.stop ? 'done' : ''}">${si && st.leg ? `<div class="mv">${legSummary(st.leg).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')}</div>` : ''}
        <button data-jump="${si}" aria-current="${si === S.stop}"><span class="tm">${st.t}</span><span class="em">${st.e || catOf(p).e}</span><span><span class="nm">${esc(st.label || p.nameKo)}</span><span class="sb" style="display:block"><span class="kind ${K.cls}" style="height:18px;font-size:11px">${esc(st.k)}</span> ${indoorChip(p, 'height:18px;font-size:11px')} ${esc(p.area || '')}${closedOn(p, dd) ? ' <b class="closed-tag">휴무일!</b>' : (p.closed?.length ? ` · ${p.closed.map(x => DOW[x]).join('·')} 휴무` : '')}</span></span></button></li>`;
    }).join('')}</ol>
    ${d.note ? `<div class="sec card"><p>💡 ${esc(fitN(d.note))}</p></div>` : ''}`;
}
function nearHTML() {
  const origin = S.here ? { lat: S.here.lat, lng: S.here.lng, nameKo: S.here.gps ? `📡 내 위치 (GPS ±${Math.round(S.here.acc || 0)}m)` : '📍 지도에서 찍은 위치' } : stopPlace();
  const oRegion = S.here ? S.here.region : regionOf(origin);
  const { dow, min } = jpNow();
  const groups = [['all', '전체'], ['food', '🍚 밥'], ['snack', '🍡 간식·카페'], ['drink', '🍺 술'], ['see', '👀 볼거리'], ['shop', '🛍️ 쇼핑']];
  let list = Object.values(C.places).filter(p => p.lat != null && regionOf(p) === oRegion && p.id !== origin.id);
  if (S.nearFilter !== 'all') list = list.filter(p => (CAT[p.cat]?.g || 'see') === S.nearFilter);
  list = list.map(p => ({ p, m: dist(origin, p), open: isOpen(p, dow, min) }));
  if (S.openNow) list = list.filter(x => x.open);
  list.sort((a, b) => a.m - b.m);
  const gpsOn = GPS.watch != null;
  return `<div class="origin">기준: <b>${esc(origin.nameKo)}</b></div>
    <div class="origin">${gpsOn ? `<button class="small-btn" data-gpsoff="1">📡 GPS 끄기</button>` : `<button class="small-btn" data-gps="1">📡 GPS로 내 위치</button>`}<button class="small-btn" data-sethere="1">👆 지도에서 찍기</button>${S.here ? `<button class="small-btn" data-clearhere="1">일정 기준으로</button>` : ''}</div>
    <div class="filters">${groups.map(([k, n]) => `<button class="chip" data-filter="${k}" aria-pressed="${S.nearFilter === k}">${n}</button>`).join('')}<button class="chip" data-open="1" aria-pressed="${S.openNow}">🟢 지금 영업중 (일본 ${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')})</button></div>
    ${list.length ? list.slice(0, 40).map(({ p, m, open }) => `<button class="alt" data-place="${p.id}"><span class="e">${catOf(p).e}</span><span><span class="nm">${esc(p.nameKo)}</span><span class="ds" style="display:block">${open === true ? '🟢 영업중 · ' : open === false ? '⚪ 영업 전/후 · ' : ''}${esc(indoorPre(p) + (p.desc || p.area || ''))}</span></span><span class="dist">🚶 ${m > 2500 ? (m / 1000).toFixed(1) + 'km' : walkMin(m) + '분'}<br>${p.price ? priceText(p.price) : ''}</span></button>`).join('') : `<p class="note">조건에 맞는 곳이 없어요. 필터를 바꿔 보세요.</p>`}
    <p class="note" style="margin-top:12px">거리는 직선거리 기준 도보 추정이에요. 실제 길은 🧭 길찾기로 확인하세요.</p>`;
}
function tipsHTML() {
  const T = C.tips || {};
  const sec = (title, inner) => `<div class="sec"><h3>${title}</h3>${inner}</div>`;
  const ul = arr => `<div class="card"><ul>${arr.map(x => `<li>${esc(fitN(x))}</li>`).join('')}</ul></div>`;
  const checks = store.get('checks', {});
  return [
    installHTML(),
    T.flight ? sec('✈️ 항공편', `<div class="card"><h4>${esc(T.flight.title)}</h4><ul>${T.flight.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`) : '',
    sec('💰 총무 계산기', `<div class="card calc"><label for="calcYen">총액 (엔)<input id="calcYen" inputmode="numeric" value="${store.get('calcYen', 18000)}"></label><label for="calcN">인원<input id="calcN" inputmode="numeric" value="${N()}"></label><label for="calcRate">100엔 = 원<input id="calcRate" inputmode="decimal" value="${(krwRate() * 100).toFixed(1)}"></label><span></span><output id="calcOut"></output></div>`),
    T.transit ? sec('🚃 교통카드 · 패스', ul(T.transit)) : '',
    sec(`👥 ${N()}명 여행 꿀팁`, ul(groupTips(N()))),
    sec('🗣️ 일본어 한마디 (화면 보여주기)', `<div class="card">${phrasesFor(N()).map((p, i) => `<div class="phrase"><span class="ko">${esc(p.ko)}</span><span class="jp">${esc(p.jp)}</span><span class="rd">${esc(p.rd)}</span><button class="small-btn" data-copy="${i}">복사</button></div>`).join('')}</div>`),
    T.diving ? sec('🤿 프리다이빙 안전·규칙', ul(T.diving)) : '',
    T.tennis ? sec('🎾 테니스 예약', ul(T.tennis)) : '',
    sec('⚠️ 2026년 바뀐 것들', ul(T.changes || [])),
    T.general ? sec('🇯🇵 일본 기본 상식', ul(T.general)) : '',
    T.money ? sec('💴 환전 · 카드 · 현금', ul(T.money)) : '',
    sec('🧳 준비물 체크', `<div class="card">${CHECKLIST.map((c, i) => `<label class="check"><input type="checkbox" id="chk${i}" data-check="${i}" ${checks[i] ? 'checked' : ''}>${esc(c)}</label>`).join('')}</div>`),
    T.emergency ? sec('🚨 비상연락', ul(T.emergency)) : '',
    `<p class="fine">지도 데이터 © OpenStreetMap 기여자 (ODbL). 영업시간·가격은 2026년 9월 조사 기준이라 바뀔 수 있어요. 가기 전에 구글맵에서 한 번 더 확인하세요.</p>`,
  ].join('');
}
function updateCalc() {
  const y = +($('#calcYen')?.value || 0).toString().replace(/[^\d.]/g, ''), n = Math.max(1, +$('#calcN')?.value || 6), r = +$('#calcRate')?.value || krwRate() * 100;
  if ($('#calcRate')) { S.krw = r / 100; store.set('krw', S.krw); }
  store.set('calcYen', y);
  const per = y / n; const o = $('#calcOut'); if (o) o.textContent = `1인 ${yen(Math.ceil(per))} ≈ ${Math.round(per * r / 100).toLocaleString('ko-KR')}원`;
}

// ---------- interactions ----------
function jumpTo(di, si) { if (busy) return; S.day = di; S.stop = si; S.viewPlace = null; S.tab = 'here'; return showStop(); }
function openPlace(id) {
  S.viewPlace = id; S.tab = 'here'; renderBody(); refreshMarkers();
  const p = place(id); if (p && regionOf(p) === regionId) { world.focus(posOf(p, regionId), 900); world.follow = false; setFollowBtn(false); }
  if (S.sheet === 'peek') setSheet('half');
}
function setFollowBtn(on) { $('#followBtn').setAttribute('aria-pressed', String(on)); }

function bindUI() {
  $('#nextBtn').onclick = () => go(1);
  $('#prevBtn').onclick = () => go(-1);
  $('#days').onclick = e => { const b = e.target.closest('[data-day]'); if (b && !busy) { S.day = +b.dataset.day; S.stop = 0; S.viewPlace = null; arriveAtStop(false); } };
  $('#tabs').onclick = e => { const t = e.target.closest('.tab'); if (!t) return; S.tab = t.dataset.tab; if (S.tab !== 'here') S.viewPlace = null; renderBody(); if (S.sheet === 'peek') setSheet('half'); };
  $('#sheetBody').addEventListener('click', e => {
    const q = s => e.target.closest(s);
    let b;
    if ((b = q('[data-jump]'))) return jumpTo(S.day, +b.dataset.jump);
    if ((b = q('[data-rec-open]'))) return openRecorder();
    if (q('[data-share-create],[data-share-join],[data-share-invite],[data-share-sync],[data-share-leave]')) { onShareClick(q); return; }
    if ((b = q('[data-entry]'))) return openEntry(b.dataset.entry);
    if ((b = q('[data-share-day]'))) return shareDay(+b.dataset.shareDay, b);
    if ((b = q('[data-track-toggle]'))) { JR.showTrack = !JR.showTrack; store.set('showTrack', JR.showTrack); refreshTrack(); renderBody(true); return; }
    if ((b = q('[data-track-clear]'))) { if (b.dataset.sure) { JR.track = []; JR.lastPt = null; J.clearTrack().catch(() => {}); refreshTrack(); toast('발자취를 지웠어요'); renderBody(true); } else { b.dataset.sure = '1'; b.textContent = '정말 지울까요? 한 번 더'; } return; }
    if ((b = q('[data-place]'))) return openPlace(b.dataset.place);
    if ((b = q('[data-back]'))) { S.viewPlace = null; renderBody(); refreshMarkers(); world.setFollow(true); setFollowBtn(true); return; }
    if (busy && q('[data-swap],[data-unswap],[data-hotelpin],[data-hotelreset]')) { toast('이동이 끝나면 바꿀 수 있어요'); return; }
    if ((b = q('[data-swap]'))) { store.set(`swap:${C.id}:${S.day}:${S.stop}`, b.dataset.swap); S.viewPlace = null; toast('이 집으로 바꿨어요! 🔁'); showStop(); return; }
    if ((b = q('[data-unswap]'))) { store.set(`swap:${C.id}:${S.day}:${S.stop}`, null); showStop(); return; }
    if ((b = q('[data-filter]'))) { S.nearFilter = b.dataset.filter; renderBody(); return; }
    if ((b = q('[data-open]'))) { S.openNow = !S.openNow; renderBody(); return; }
    if ((b = q('[data-sethere]'))) { if (JR.picking) cancelPick(); setHereMode(true); return; }
    if ((b = q('[data-clearhere]'))) { if (S.here?.gps) stopGPS(); S.here = null; refreshMarkers(); renderBody(); return; }
    if ((b = q('[data-gps]'))) { startGPS(); return; }
    if ((b = q('[data-gpsoff]'))) { stopGPS(); toast('GPS를 껐어요'); return; }
    if ((b = q('[data-install]'))) { const ev = installEvt; installEvt = null; ev?.prompt(); ev?.userChoice?.finally(() => renderBody()); return; }
    if ((b = q('[data-hotelpin]'))) { if (JR.picking) cancelPick(); S.pinHotel = true; setHereMode(true); toast('지도에서 숙소 위치를 탭하세요 🏨'); return; }
    if ((b = q('[data-hotelreset]'))) { store.set('hotel:' + C.id, null); const p = C.places[hotelId()]; if (p?._orig) Object.assign(p, p._orig); toast('예시 위치로 되돌렸어요'); showStop(); return; }
    if ((b = q('[data-copy]'))) { const p = phrasesFor(N())[+b.dataset.copy]; navigator.clipboard?.writeText(p.jp).then(() => toast('복사했어요 📋'), () => toast(p.jp)); return; }
  });
  $('#sheetBody').addEventListener('input', e => { if (e.target.closest('.calc') && $('#calcYen')) updateCalc(); });
  $('#sheetBody').addEventListener('change', e => {
    if (e.target.id === 'hotelName') { const h = store.get('hotel:' + C.id, {}) || {}; h.name = e.target.value.trim(); store.set('hotel:' + C.id, h); applyHotel(); renderHead(); toast('숙소 이름 저장! 길찾기에 반영돼요'); return; }
    if (e.target.id === 'tripStart') { store.set('start:' + C.id, e.target.value || null); renderDays(); renderBody(); } });
  $('#sheetBody').addEventListener('change', e => { const c = e.target.closest('[data-check]'); if (c) { const k = store.get('checks', {}); k[c.dataset.check] = c.checked; store.set('checks', k); } });
  const obs = new MutationObserver(() => { if ($('#calcOut') && !$('#calcOut').textContent) updateCalc(); });
  obs.observe($('#sheetBody'), { childList: true });
  $('#followBtn').onclick = () => { const on = !world.follow; world.setFollow(on); setFollowBtn(on); };
  $('#overviewBtn').onclick = () => { const pts = C.days[S.day].stops.map((_, si) => stopPlace(S.day, si)).filter(p => regionOf(p) === regionId).map(p => posOf(p, regionId)); world.overview(pts); setFollowBtn(false); };
  $('#hereBtn').onclick = () => startGPS();
  $('#snapBtn').onclick = () => openRecorder();
  $('#pickCancel').onclick = () => { const t = cancelPick(); if (t && t !== 'draft') openEntry(t); };
  $('#fileCam').addEventListener('change', e => onFiles(e.target));
  $('#fileLib').addEventListener('change', e => onFiles(e.target));
  $('#jModal').addEventListener('click', onJournalClick);
  $('#jModal').addEventListener('input', e => { if (e.target.id === 'jMemo' && JR.draft) JR.draft.entry.memo = e.target.value; });
  $('#jModal').addEventListener('change', e => { if (e.target.id === 'jMemoEdit') updateEntry(e.target.closest('[data-entry-id]')?.dataset.entryId, { memo: e.target.value }); });
  $('#arriveGo').onclick = () => { hideArrive(); go(1); };
  $('#arriveX').onclick = () => { GPS.dismissed = $('#arrive').dataset.key; hideArrive(); };
  window.addEventListener('offline', () => toast('📴 오프라인이에요 — 저장된 지도·일정은 계속 볼 수 있어요', 3500));
  window.addEventListener('online', () => toast('📶 다시 온라인!'));
  $('#themeBtn').onclick = () => {
    const root = document.documentElement, cur = root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const nx = cur === 'dark' ? 'light' : 'dark'; root.setAttribute('data-theme', nx); store.set('theme', nx);
  };
  $('#cityBtn').onclick = () => openIntro();
  $('#partyTag').onclick = () => openIntro();
  world.onFollowChange = on => setFollowBtn(on);
  world.onMapTap = (hit) => {
    if (JR.picking) { const [lat, lng] = world.region.toLatLng(hit.x, hit.z); applyPick(lat, lng); return; }
    if (!S.tapMode) return;
    const [lat, lng] = world.region.toLatLng(hit.x, hit.z);
    if (S.pinHotel) {
      if (busy) { toast('이동이 끝나면 다시 찍어 주세요'); return; }
      S.pinHotel = false; setHereMode(false);
      const h = store.get('hotel:' + C.id, {}) || {}; h.lat = lat; h.lng = lng; store.set('hotel:' + C.id, h);
      applyHotel(); toast('숙소 위치 저장! 🏨'); showStop(); return;
    }
    if (GPS.watch != null) stopGPS();
    S.here = { lat, lng, pos: hit.clone(), region: regionId };
    setHereMode(false); S.tab = 'near'; S.nearFilter = 'all'; refreshMarkers(); renderBody(); setSheet('half');
    toast('여기 기준으로 가까운 곳을 보여줄게요 📍');
  };
  // sheet drag (mobile)
  const sheet = $('#sheet'), grab = $('#grab');
  let drag = null;
  const heights = () => ({ peek: peekH(), half: Math.round(innerHeight * 0.45), full: Math.min(Math.round(innerHeight * 0.8), sheet.offsetHeight) });
  const onDown = e => { if (innerWidth >= 900) return; drag = { y: e.clientY, h: heights()[S.sheet], moved: false }; sheet.classList.add('dragging'); grab.setPointerCapture?.(e.pointerId); };
  const onMove = e => { if (!drag) return; const dy = drag.y - e.clientY; if (Math.abs(dy) > 4) drag.moved = true; const h = Math.max(120, Math.min(innerHeight * 0.9, sheet.offsetHeight, drag.h + dy)); sheet.style.transform = `translateY(calc(100% - ${h}px))`; drag.cur = h; };
  const onUp = () => {
    if (!drag) return; sheet.classList.remove('dragging'); sheet.style.transform = '';
    if (!drag.moved) { setSheet(S.sheet === 'peek' ? 'half' : S.sheet === 'half' ? 'full' : 'peek'); drag = null; return; }
    const H = heights(), h = drag.cur; const best = Object.entries(H).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0];
    setSheet(best); drag = null;
  };
  grab.addEventListener('pointerdown', onDown); $('#sheetHead').addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp); window.addEventListener('pointercancel', onUp);
  window.addEventListener('resize', () => setSheet(S.sheet));
  window.addEventListener('keydown', e => { if (e.target.closest('input')) return; if (e.key === 'ArrowRight') go(1); if (e.key === 'ArrowLeft') go(-1); });
}
function peekH() { const head = $('#sheetHead').offsetHeight; return Math.min(innerHeight * 0.45, 22 + head + 46); }
function setSheet(s) {
  S.sheet = s; const sheet = $('#sheet');
  const H = { peek: peekH(), half: Math.round(innerHeight * 0.45), full: Math.min(Math.round(innerHeight * 0.8), sheet.offsetHeight) }[s];
  sheet.style.setProperty('--peek', H + 'px');
  const act = $('#actions').offsetHeight;
  const bottom = innerWidth >= 900 ? 12 : Math.min(H, innerHeight * 0.55) + act + 10;
  const fabs = $('#fabs'), hudB = $('.hud').getBoundingClientRect().bottom + 8;
  const fb = innerWidth >= 900 ? 12 : Math.min(bottom, innerHeight - hudB - fabs.offsetHeight);
  fabs.style.bottom = fb + 'px'; fabs.style.visibility = innerWidth < 900 && fb < act + 10 ? 'hidden' : '';
  $('#partyTag').style.bottom = bottom + 'px';
}
function setHereMode(on) {
  S.tapMode = on;
  document.body.classList.toggle('tap-mode', on);
  if (on) { toast('지도에서 지금 있는 곳을 탭하세요 👆'); if (innerWidth < 900) setSheet('peek'); }
}

// ---------- GPS (works in the installed app / normal browser; the Claude viewer blocks it) ----------
const GPS = { watch: null, fix: null, lastRender: null, dismissed: null, warnedOut: false };
function regionAt(lat, lng) {
  for (const [rid, R] of Object.entries(C.regions)) { const [s, w, n, e] = R.bbox; if (lat >= s && lat <= n && lng >= w && lng <= e) return rid; }
  return 'none';
}
function gpsAvailable() {
  if (!('geolocation' in navigator) || !window.isSecureContext) return false;
  try { const pp = document.permissionsPolicy || document.featurePolicy; if (pp?.allowsFeature && !pp.allowsFeature('geolocation')) return false; } catch { /* unknown: try anyway */ }
  return true;
}
function setGpsBtn(state) {
  const b = $('#hereBtn');
  b.setAttribute('aria-pressed', String(state === true));
  b.classList.toggle('gps-wait', state === 'wait');
  b.textContent = state === false ? '📍' : '📡';
}
function startGPS() {
  if (!C) return;
  if (!gpsAvailable()) { setHereMode(true); toast('이 화면에선 GPS를 못 써요 → 지도를 탭해서 위치를 찍으세요', 3200); return; }
  if (GPS.watch != null) { focusMe(); return; }
  setGpsBtn('wait'); toast('📡 위치 찾는 중…');
  GPS.watch = navigator.geolocation.watchPosition(onGPS, onGPSError, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function stopGPS() {
  if (GPS.watch != null) navigator.geolocation.clearWatch(GPS.watch);
  GPS.watch = null; GPS.fix = null; GPS.lastRender = null;
  world.clearMe(); if (S.here?.gps) S.here = null;
  setGpsBtn(false); hideArrive();
  if (S.tab === 'near') renderBody();
}
function onGPS(p) {
  if (!C) return;
  if (S.here && !S.here.gps) { S.here = null; refreshMarkers(); }
  const { latitude: lat, longitude: lng, accuracy } = p.coords;
  const first = !GPS.fix;
  GPS.fix = { lat, lng, acc: accuracy }; GPS.fixAt = Date.now();
  setGpsBtn(true);
  const rid = regionAt(lat, lng);
  if (rid === 'none') {
    world.clearMe(); S.here = null;
    if (!GPS.warnedOut) { GPS.warnedOut = true; toast('📡 지금 위치는 이 지도 밖이에요. 일본에 도착하면 지도에 떠요!', 3800); }
    if (S.tab === 'near' && first) renderBody();
    return;
  }
  const pos = proj(rid, lat, lng);
  recordTrack(GPS.fix);
  S.here = { lat, lng, pos, region: rid, gps: true, acc: accuracy };
  if (rid === regionId) {
    world.setMe(pos, accuracy);
    if (first) { world.focus(pos, 700); world.follow = false; setFollowBtn(false); toast('📡 내 위치를 찾았어요'); }
  } else { world.clearMe(); if (first) toast(`📡 지금 ${C.regions[rid].title} 근처예요. 그쪽 일정을 열면 지도에 떠요`, 3800); }
  if (S.tab === 'near' && (!GPS.lastRender || dist(GPS.lastRender, GPS.fix) > 25)) { GPS.lastRender = { lat, lng }; renderBody(true); }
  checkArrival();
}
function onGPSError(e) {
  if (e.code === 1) { stopGPS(); setHereMode(true); toast('위치 권한이 꺼져 있어요. 폰 설정에서 허용하거나, 지도를 탭해서 위치를 찍으세요', 4200); }
  else if (!GPS.fix) toast('GPS 신호를 찾는 중… 건물 밖에서 다시 해보세요', 3000);
}
function focusMe() {
  if (S.here?.gps && S.here.region === regionId) { world.focus(S.here.pos, 700); world.follow = false; setFollowBtn(false); }
  else toast(GPS.fix ? '지금 위치는 이 지도 밖이에요' : '📡 아직 위치를 찾는 중이에요');
}
function checkArrival() {
  if (!S.here?.gps || busy) return;
  const next = C.days[S.day].stops[S.stop + 1];
  if (!next) return hideArrive();
  const np = stopPlace(S.day, S.stop + 1), key = `${C.id}:${S.day}:${S.stop + 1}`;
  if (!np || np.lat == null) return;
  const cp = stopPlace(), dc = cp?.lat != null ? dist(S.here, cp) : Infinity;
  const d = dist(S.here, np), near = Math.max(90, Math.min(200, (S.here.acc || 30) + 60));
  if (d < near && d < dc * 0.6 && GPS.dismissed !== key) showArrive(np, key);
  else if (d > near * 3 || d >= dc) hideArrive();
}
function showArrive(p, key) {
  const el = $('#arrive'); if (!el.hidden && el.dataset.key === key) return;
  el.dataset.key = key; $('#arriveText').textContent = `📍 ${short(p.nameKo, 18)} 근처예요!`; el.hidden = false;
}
function hideArrive() { $('#arrive').hidden = true; }

// ---------- trip journal: photos + memos + walked trail, kept on this phone ----------
const JR = { ok: 'indexedDB' in window, entries: [], urls: new Map(), track: [], lastPt: null, showTrack: store.get('showTrack', true), who: store.get('who', 0), draft: null, loc: null, picking: null, prepared: null };
const pad2 = n => String(n).padStart(2, '0');
const fmtTime = t => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} (${DOW[d.getDay()]}) ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
async function journalInit() {
  if (!JR.ok) return;
  try { JR.entries = await J.listEntries(); JR.track = (await J.listTrack()).sort((a, b) => a.t - b.t); JR.lastPt = JR.track[JR.track.length - 1] || null; }
  catch (e) { console.warn('journal unavailable', e); JR.ok = false; return; }
  refreshJournal();
  if (C && (S.tab === 'album' || S.tab === 'here')) renderBody(true);
}
async function thumbURL(e) {
  if (!e?.photo) return null;
  if (JR.urls.has(e.id)) return JR.urls.get(e.id);
  const b = await J.getBlob(e.id, 'thumb').catch(() => null);
  if (!b) return null;
  const u = URL.createObjectURL(b); JR.urls.set(e.id, u); return u;
}
async function hydrateThumbs(root) {
  for (const img of root.querySelectorAll('img[data-thumb]')) {
    const u = await thumbURL(JR.entries.find(e => e.id === img.dataset.thumb));
    if (u && img.isConnected) img.src = u;
  }
}
async function refreshJournal() { // photo pins + trail for the loaded map
  if (!JR.ok || !C || !world.region) return;
  const rid = regionId;
  const here = JR.entries.filter(e => e.city === C.id && e.lat != null && regionAt(e.lat, e.lng) === rid).slice(-80);
  const items = [];
  for (const e of here) items.push({ pos: proj(rid, e.lat, e.lng), thumb: await thumbURL(e), emoji: '📝', onClick: () => JR.picking ? applyPick(e.lat, e.lng) : openEntry(e.id) });
  if (rid !== regionId) return; // the map changed while thumbnails loaded
  world.setPhotoPins(items);
  refreshTrack();
}
const walkHop = (a, b) => { const d = dist(a, b), s = (b.t - a.t) / 1000; return d < 400 && s < 600 && d / Math.max(1, s) < 2.5; };
function trackSegments() {
  const segs = []; let cur = [], prev = null;
  for (const p of JR.track) {
    if (p.city !== C.id || regionAt(p.lat, p.lng) !== regionId) { if (cur.length > 1) segs.push(cur); cur = []; prev = null; continue; }
    if (prev && !walkHop(prev, p)) { if (cur.length > 1) segs.push(cur); cur = []; }
    cur.push(p); prev = p;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}
function refreshTrack() {
  if (!C || !world.region) return;
  world.setTrack(JR.showTrack ? trackSegments().map(s => s.map(p => proj(regionId, p.lat, p.lng))) : []);
}
function walkedKm() {
  let m = 0, prev = null;
  for (const p of JR.track) { if (p.city !== C.id) continue; if (prev && walkHop(prev, p)) m += dist(prev, p); prev = p; }
  return m / 1000;
}
function recordTrack(fix) {
  if (!JR.ok || !C || !(fix.acc <= 60)) return;
  const p = { lat: fix.lat, lng: fix.lng, acc: Math.round(fix.acc), t: Date.now(), city: C.id };
  if (JR.lastPt && JR.lastPt.city === p.city && dist(JR.lastPt, p) < Math.max(25, (p.acc + (JR.lastPt.acc || 0)) / 2)) return;
  JR.lastPt = p; JR.track.push(p);
  J.addTrackPoint(p).catch(() => {});
  clearTimeout(JR.trackTimer); JR.trackTimer = setTimeout(refreshTrack, 3000);
}
function nearestPlace(lat, lng) {
  let best = null, bd = 160;
  for (const p of Object.values(C.places)) { if (p.lat == null) continue; const d = dist({ lat, lng }, p); if (d < bd) { bd = d; best = p; } }
  return best;
}
function getLocation() { // best effort, never rejects; started when 📷 is tapped
  if (GPS.fix && Date.now() - (GPS.fixAt || 0) < 120000) return Promise.resolve({ ...GPS.fix, src: 'gps' });
  if (!gpsAvailable()) return Promise.resolve(null);
  return new Promise(res => navigator.geolocation.getCurrentPosition(
    p => res({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, src: 'gps' }),
    () => res(null), { enableHighAccuracy: true, timeout: 60000, maximumAge: 60000 }));
}
const waitLoc = p => Promise.race([p || getLocation(), sleep(5000).then(() => (GPS.fix && Date.now() - (GPS.fixAt || 0) < 120000 ? { ...GPS.fix, src: 'gps' } : null))]);
function trackAt(t) { // the trail point closest in time (±15 min)
  let b = null;
  for (const p of JR.track) if (p.city === C.id && Math.abs(p.t - t) < 9e5 && (!b || Math.abs(p.t - t) < Math.abs(b.t - t))) b = p;
  return b && { lat: b.lat, lng: b.lng, acc: b.acc, src: 'track' };
}
function dayOf(t) { // trip day from the photo's time when a start date is set
  const d0 = tripDate(0); if (!d0) return S.day;
  d0.setHours(0, 0, 0, 0); const d = new Date(t); d.setHours(0, 0, 0, 0);
  const i = Math.round((d - d0) / 864e5);
  return i >= 0 && i < C.days.length ? i : S.day;
}
const planLoc = () => { const p = stopPlace(); return { lat: p.lat, lng: p.lng, acc: null, src: 'plan' }; };
function makeDraft(img, loc, { cam = true } = {}) {
  const ex = img?.exif;
  const t = ex?.time && Math.abs(Date.now() - ex.time) < 400 * 864e5 ? ex.time : Date.now();
  const recent = Date.now() - t < 10 * 60000;
  // where: the photo's own GPS > our trail at that time > the phone's position now (only for fresh shots) > today's plan
  const where = ex?.lat != null ? { lat: ex.lat, lng: ex.lng, acc: 30, src: 'exif' }
    : (!cam && !recent) ? (trackAt(t) || { lat: null, lng: null, acc: null, src: 'none' })
    : (loc || trackAt(t) || planLoc());
  const np = where.lat != null ? nearestPlace(where.lat, where.lng) : null;
  const day = dayOf(t);
  return { img, entry: { id: J.newId(), t, city: C.id, day, stop: day === S.day ? S.stop : 0, lat: where.lat, lng: where.lng, acc: where.acc ?? null, src: where.src,
    placeId: np?.id || null, placeName: np?.nameKo || (where.src === 'plan' ? stopPlace().nameKo : where.src === 'none' ? '위치 모름 (지도에서 고쳐 주세요)' : '길 위 어딘가'), memo: '', rating: 0, who: S.crew.some(m => m.c === JR.who) ? JR.who : S.crew[0].c, photo: !!img,
    owner: SH.device, sync: 'new' } };
}
function cancelPick() {
  const t = JR.picking; JR.picking = null; document.body.classList.remove('tap-mode'); $('#pickBar').hidden = true;
  if (t === 'draft' && JR.draft) $('#jModal').hidden = false;
  return t;
}
function openRecorder() {
  if (!C) return;
  if (!JR.ok) { toast('이 화면에선 기록을 저장할 수 없어요'); return; }
  if (JR.draft) { cancelPick(); renderEditor(); toast('저장 안 한 사진이 있어요 — 먼저 저장하거나 취소해 주세요', 3000); return; }
  if (JR.busy) return;
  JR.modalGen = (JR.modalGen || 0) + 1;
  const el = $('#jModal');
  el.innerHTML = `<div class="modal jrec" role="dialog" aria-label="기록 남기기">
    <h2 class="j-title">📸 여기서 한 장!</h2>
    <p class="note">사진·메모에 위치, 시간, 가게 이름이 같이 저장돼요. ${SH.client ? `👥 공유 앨범에 올라가서 ${N()}명이 같이 봐요.` : '이 폰에만 보관돼요.'}</p>
    <div class="rec-btns">
      <button class="btn primary" data-rec="cam">📷 사진 찍기</button>
      <p class="note" style="margin:0">앱에서 찍은 사진은 폰 사진앱에 자동 저장이 안 돼요. 나중에 📤 공유 → '이미지 저장'으로 옮겨 두세요.</p>
      <button class="btn" data-rec="lib">🖼️ 앨범에서 고르기 (여러 장 OK)</button>
      <button class="btn" data-rec="memo">📝 메모만 남기기</button>
    </div>
    <button class="small-btn" data-jclose="1" style="margin-top:14px">닫기</button></div>`;
  el.hidden = false; el.dataset.mode = 'rec';
}
async function onFiles(input) {
  const list = [...(input.files || [])], cam = input.id === 'fileCam'; input.value = '';
  if (!list.length || JR.busy) return;
  JR.busy = true;
  $('#jModal').innerHTML = '<div class="modal"><p class="note" style="margin:0">📸 사진 정리 중…</p></div>'; $('#jModal').dataset.mode = 'busy';
  try {
    if (list.length === 1) return await startDraft(list[0], cam);
    const loc = cam ? await waitLoc(JR.loc) : null; JR.loc = null;
    let n = 0;
    for (const f of list) {
      try { const d = makeDraft(await J.processImage(f), loc, { cam }); if (cam) d.orig = f; await saveDraft(d); n++; } catch (e) { console.warn(e); }
    }
    closeJModal();
    toast(n ? `📸 ${n}장 저장했어요` : '사진을 저장하지 못했어요', 3000);
    refreshJournal(); if (S.tab === 'album' || S.tab === 'here') renderBody(true);
  } finally { JR.busy = false; }
}
async function startDraft(file, cam = true) {
  let img = null;
  if (file) {
    try { img = await J.processImage(file); } catch { closeJModal(); toast('사진을 못 읽었어요. 다른 사진으로 해 보세요', 3000); return; }
  }
  const loc = img?.exif?.lat != null || (file && !cam) ? null : await waitLoc(JR.loc);
  JR.loc = null;
  JR.draft = makeDraft(img, loc, { cam: !file || cam });
  if (file && cam) JR.draft.orig = file; // keep the camera original (full size + EXIF) for sharing/saving
  renderEditor();
}
function renderEditor() {
  JR.modalGen = (JR.modalGen || 0) + 1;
  const { img, entry: e } = JR.draft, el = $('#jModal');
  if (JR.draftURL) URL.revokeObjectURL(JR.draftURL);
  JR.draftURL = img ? URL.createObjectURL(img.full) : null;
  const srcTxt = { gps: `📡 GPS${e.acc ? ' ±' + Math.round(e.acc) + 'm' : ''}`, exif: '📷 사진에 담긴 위치', track: '👣 그 시간 걸은 길 위치', plan: '🗓️ 일정 위치 (대략)', tap: '👆 지도에서 고른 위치', none: '❓ 위치 정보 없음' }[e.src] || '';
  el.innerHTML = `<div class="modal jedit" role="dialog" aria-label="기록 저장">
    ${img ? `<img class="j-preview" src="${JR.draftURL}" alt="찍은 사진">` : '<h2 class="j-title">📝 메모 남기기</h2>'}
    <div class="j-where"><b>📍 ${esc(e.placeName)}</b><span>${srcTxt} · ${fmtTime(e.t)}</span><button class="small-btn" data-jfix="draft">👆 지도에서 위치 고치기</button></div>
    <label class="j-label" for="jMemo">메모</label>
    <textarea id="jMemo" rows="3" maxlength="300" placeholder="예: 우설 미쳤음, 다음에 또 오자">${esc(e.memo)}</textarea>
    <div class="j-label">별점</div><div class="stars" role="group" aria-label="별점">${[1, 2, 3, 4, 5].map(n => `<button class="star" data-star="${n}" aria-pressed="${e.rating >= n}" aria-label="별 ${n}개">★</button>`).join('')}</div>
    <div class="j-label">누가 남겼어?</div><div class="who">${crewDefs().map(d => `<button class="chip" data-who="${d.idx}" aria-pressed="${e.who === d.idx}">${d.emoji} ${esc(d.name)}</button>`).join('')}</div>
    <div class="j-actions"><button class="btn" data-jcancel="1">취소</button><button class="btn primary" data-jsave="1">💾 저장</button></div></div>`;
  el.hidden = false; el.dataset.mode = 'edit';
}
async function saveDraft(d) {
  const e = d.entry;
  await J.saveEntry(e, d.img ? { full: d.img.full, thumb: d.img.thumb, orig: d.orig || null } : {});
  if (!JR.entries.some(x => x.id === e.id)) JR.entries.push(e);
  JR.entries.sort((a, b) => a.t - b.t);
  scheduleSync();
  if (!JR.persistAsked) { JR.persistAsked = true; navigator.storage?.persist?.().catch(() => {}); }
  return e;
}
async function updateEntry(id, patch) {
  const e = JR.entries.find(x => x.id === id); if (!e || e.remote) return;
  Object.assign(e, patch);
  if (e.sync === 'done') e.sync = 'dirty';
  try { await J.saveEntry(e); } catch { toast('저장 실패 — 저장공간을 확인해 주세요'); }
  scheduleSync();
}
function closeJModal() {
  JR.modalGen = (JR.modalGen || 0) + 1;
  if (JR.picking) { JR.picking = null; document.body.classList.remove('tap-mode'); $('#pickBar').hidden = true; }
  const el = $('#jModal'); el.hidden = true; el.innerHTML = ''; el.dataset.mode = '';
  if (JR.draftURL) { URL.revokeObjectURL(JR.draftURL); JR.draftURL = null; }
  if (JR.viewURL) { URL.revokeObjectURL(JR.viewURL); JR.viewURL = null; }
  JR.draft = null; JR.viewFile = null;
}
function startPick(target) {
  S.pinHotel = false; if (S.tapMode) setHereMode(false);
  JR.picking = target; $('#jModal').hidden = true; $('#pickBar').hidden = false;
  document.body.classList.add('tap-mode');
  if (innerWidth < 900) setSheet('peek');
  toast('지도를 탭해서 사진 찍은 곳을 고르세요 👆', 3500);
}
async function applyPick(lat, lng) {
  const target = JR.picking; JR.picking = null; document.body.classList.remove('tap-mode'); $('#pickBar').hidden = true;
  const np = nearestPlace(lat, lng);
  const patch = { lat, lng, acc: null, src: 'tap', placeId: np?.id || null, placeName: np?.nameKo || '길 위 어딘가' };
  if (target === 'draft' && JR.draft) { Object.assign(JR.draft.entry, patch); renderEditor(); return; }
  await updateEntry(target, patch); refreshJournal(); openEntry(target);
}
async function openEntry(id) {
  if (JR.picking === 'draft' && JR.draft) { cancelPick(); return; } // never drop an unsaved photo
  if (JR.picking) cancelPick();
  const e = JR.entries.find(x => x.id === id); if (!e) return;
  const my = JR.modalGen = (JR.modalGen || 0) + 1; // a later dialog wins over this one while the photo loads
  let url = null, file = null;
  if (e.photo) {
    let b = await J.getBlob(e.id, 'full').catch(() => null);
    if (!b && SH.client) { toast('📥 사진 받는 중…', 1500); try { b = await SH.client.get(`p/${e.id}.jpg`); await J.saveEntry(e, { full: b }); } catch { toast('사진을 못 받았어요 — 연결을 확인해 주세요', 3000); } }
    const o = await J.getBlob(e.id, 'orig').catch(() => null);
    if (b) url = URL.createObjectURL(b);
    if (o || b) file = new File([o || b], `mokbang6-${isoDate(new Date(e.t))}-${e.id.slice(-5)}.jpg`, { type: 'image/jpeg' });
  }
  if (my !== JR.modalGen) { if (url) URL.revokeObjectURL(url); return; }
  closeJModal();
  JR.viewURL = url; JR.viewFile = file;
  const who = whoOf(e), mine = !e.remote;
  const el = $('#jModal');
  el.innerHTML = `<div class="modal jview" role="dialog" aria-label="기록 보기" data-entry-id="${e.id}">
    ${url ? `<img class="j-photo" src="${url}" alt="${esc(e.placeName)}에서 찍은 사진">` : ''}
    <div class="j-where"><b>📍 ${esc(e.placeName)}</b><span>${fmtTime(e.t)}${who ? ' · ' + who.emoji + ' ' + esc(who.name) : ''}${e.remote ? ' · 👥 공유 앨범' : ''}</span></div>
    ${stars(e) ? `<div class="j-stars" aria-label="별점 ${stars(e)}점">${'★'.repeat(stars(e))}${'☆'.repeat(5 - stars(e))}</div>` : ''}
    <label class="j-label" for="jMemoEdit">메모</label>
    ${mine ? `<textarea id="jMemoEdit" rows="3" maxlength="300" placeholder="메모 추가">${esc(e.memo)}</textarea>` : (e.memo ? `<p class="j-memo">${esc(e.memo)}</p>` : '')}
    <div class="links" style="margin-top:10px">
      <button class="small-btn" data-jshare="${e.id}">📤 공유 · 사진앱 저장</button>
      <button class="small-btn" data-jmap="${e.id}">🗺️ 지도에서 보기</button>
      ${e.lat != null ? `<a href="https://www.google.com/maps/search/?api=1&query=${e.lat.toFixed(6)},${e.lng.toFixed(6)}" target="_blank" rel="noopener">🧭 구글맵</a>` : ''}
      ${mine ? `<button class="small-btn" data-jfix="${e.id}">👆 위치 고치기</button>` : ''}
      <button class="small-btn danger" data-jdel="${e.id}">🗑️ ${mine ? '삭제' : '공유 앨범에서 삭제'}</button>
    </div>
    <div class="j-actions"><button class="btn primary" data-jclose="1">닫기</button></div></div>`;
  el.hidden = false; el.dataset.mode = 'view';
}
function shareText(list) {
  return list.map(e => `📍 ${e.placeName} · ${fmtTime(e.t)}${stars(e) ? ' ' + '★'.repeat(stars(e)) : ''}${e.memo ? '\n' + e.memo : ''}${e.lat != null ? `\nhttps://maps.google.com/?q=${e.lat.toFixed(6)},${e.lng.toFixed(6)}` : ''}`).join('\n\n');
}
async function shareFiles(files, text) {
  try {
    if (files.length && !navigator.canShare?.({ files })) { toast('이 화면에선 사진 공유가 안 돼요. 설치한 앱이나 사파리·크롬에서 해 보세요', 3500); return; }
    if (files.length) await navigator.share({ files, text, title: '먹방원정대' });
    else if (navigator.share) await navigator.share({ text, title: '먹방원정대' });
    else { await navigator.clipboard.writeText(text); toast('기록을 복사했어요 📋 (이 화면에선 사진 공유가 안 돼요)', 3500); }
  } catch (err) { if (err?.name !== 'AbortError') toast('공유가 안 되는 화면이에요. 설치한 앱이나 사파리·크롬에서 해 보세요', 3500); }
}
const shareLabel = p => p.batches.length > 1 ? `📤 지금 공유 ${p.i + 1}/${p.batches.length} 묶음` : `📤 지금 공유하기 (${p.batches[0]?.length || 0}장)`;
async function shareDay(day, btn) { // two taps: prepare (reads the photos), then share within the tap; 10 photos per share (Android limit)
  const list = JR.entries.filter(e => e.city === C.id && albumDay(e) === day);
  if (JR.prepared?.day === day) {
    const p = JR.prepared, part = p.batches[p.i++];
    if (p.i >= p.batches.length) { JR.prepared = null; btn.textContent = '📤 이 날 사진 공유'; } else btn.textContent = shareLabel(p);
    return shareFiles(part || [], p.i === 1 ? p.text : `🍜 ${day + 1}일차 사진 (${p.i}/${p.batches.length})`);
  }
  btn.textContent = '준비 중…';
  const files = [];
  for (const e of list) if (e.photo) {
    let b = await J.getBlob(e.id, 'orig').catch(() => null) || await J.getBlob(e.id, 'full').catch(() => null);
    if (!b && e.remote && SH.client) { b = await SH.client.get(`p/${e.id}.jpg`).catch(() => null); if (b) await J.saveEntry(e, { full: b }).catch(() => {}); }
    if (b) files.push(new File([b], `mokbang6-d${day + 1}-${files.length + 1}.jpg`, { type: 'image/jpeg' }));
  }
  const batches = []; for (let i = 0; i < files.length; i += 10) batches.push(files.slice(i, i + 10));
  JR.prepared = { day, batches, i: 0, text: `🍜 먹방원정대 ${day + 1}일차\n\n` + shareText(list) };
  btn.textContent = shareLabel(JR.prepared);
}
async function onJournalClick(e) {
  const el = $('#jModal'), q = s => e.target.closest(s);
  let b;
  if (await onShareClick(q)) return;
  if (e.target === el && el.dataset.mode !== 'edit') return closeJModal();
  if (q('[data-jclose]')) return closeJModal();
  if ((b = q('[data-jcancel]'))) {
    if (JR.draft?.img && !b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '사진 버릴까요? 한 번 더'; return; }
    return closeJModal();
  }
  if ((b = q('[data-rec]'))) {
    if (JR.busy) return;
    const how = b.dataset.rec;
    if (how === 'memo') { JR.loc = getLocation(); return startDraft(null); }
    JR.loc = getLocation(); // ask for the position while the camera is open
    return (how === 'cam' ? $('#fileCam') : $('#fileLib')).click();
  }
  if ((b = q('[data-star]')) && JR.draft) { const n = +b.dataset.star; JR.draft.entry.rating = JR.draft.entry.rating === n ? 0 : n; el.querySelectorAll('[data-star]').forEach(s => s.setAttribute('aria-pressed', String(JR.draft.entry.rating >= +s.dataset.star))); return; }
  if ((b = q('[data-who]')) && JR.draft) { JR.draft.entry.who = +b.dataset.who; el.querySelectorAll('[data-who]').forEach(s => s.setAttribute('aria-pressed', String(s === b))); return; }
  if ((b = q('[data-jfix]'))) return startPick(b.dataset.jfix);
  if (q('[data-jsave]') && JR.draft) {
    if (JR.saving) return;
    const d = JR.draft; d.entry.memo = $('#jMemo')?.value.trim() || '';
    JR.saving = true;
    try { await saveDraft(d); } catch (err) { console.warn(err); toast('저장 실패 — 폰 저장공간을 확인해 주세요', 3500); return; } finally { JR.saving = false; }
    JR.who = d.entry.who; store.set('who', JR.who);
    closeJModal(); toast(d.entry.photo ? '📸 저장했어요!' : '📝 저장했어요!');
    if (d.entry.lat != null && regionAt(d.entry.lat, d.entry.lng) === regionId) world.pop(d.entry.photo ? '📸' : '📝', proj(regionId, d.entry.lat, d.entry.lng), 3);
    refreshJournal(); if (S.tab === 'album' || S.tab === 'here') renderBody(true);
    return;
  }
  if ((b = q('[data-jshare]'))) { const x = JR.entries.find(v => v.id === b.dataset.jshare); return shareFiles(JR.viewFile ? [JR.viewFile] : [], shareText([x])); }
  if ((b = q('[data-jmap]'))) {
    const x = JR.entries.find(v => v.id === b.dataset.jmap); closeJModal();
    if (x?.lat != null && regionAt(x.lat, x.lng) === regionId) { world.focus(proj(regionId, x.lat, x.lng), 600); world.follow = false; setFollowBtn(false); }
    else toast('이 기록은 다른 지역 지도에 있어요 (그날 일정을 열면 보여요)', 3200);
    return;
  }
  if ((b = q('[data-jdel]'))) {
    const id = b.dataset.jdel, was = JR.entries.find(v => v.id === id);
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = was?.remote ? '원정대 모두에게서 지워져요 — 한 번 더' : '정말 삭제? 한 번 더 누르세요'; return; }
    try { await J.deleteEntry(id); } catch { toast('삭제 실패'); return; }
    if (SH.client || was?.rsha || was?.remote) { SH.tomb = [...new Set([...SH.tomb, id])]; store.set('tomb', SH.tomb); scheduleSync(); }
    JR.entries = JR.entries.filter(v => v.id !== id);
    const u = JR.urls.get(id); if (u) { URL.revokeObjectURL(u); JR.urls.delete(id); }
    closeJModal(); toast('🗑️ 삭제했어요'); refreshJournal(); if (S.tab === 'album' || S.tab === 'here') renderBody(true);
  }
}
function journalStrip(p) {
  if (!JR.ok) return '';
  const list = JR.entries.filter(e => e.placeId === p.id);
  return `<div class="sec"><div class="album-h"><h3>📸 여기 기록${list.length ? ' ' + list.length : ''}</h3><button class="small-btn" data-rec-open="1">📸 남기기</button></div>
    ${list.length ? `<div class="album-grid">${list.slice(-6).map(albumItem).join('')}</div>` : ''}</div>`;
}
const stars = e => Math.max(0, Math.min(5, Math.round(+e.rating) || 0));
function whoOf(e) { const d = CREW_DEFAULT[e.who] || null; if (!d) return null; return { emoji: d.emoji, name: e.remote ? (e.whoName || d.role) : nameOfIdx(e.who) }; }
function albumDay(e) {
  const fb = Number.isInteger(e.day) && e.day >= 0 && e.day < C.days.length ? e.day : 0;
  const d0 = tripDate(0); if (!d0) return fb;
  d0.setHours(0, 0, 0, 0); const d = new Date(e.t); d.setHours(0, 0, 0, 0);
  const i = Math.round((d - d0) / 864e5);
  return i >= 0 && i < C.days.length ? i : fb;
}
function albumItem(e) {
  return `<button class="album-item${e.remote ? ' remote' : ''}" data-entry="${e.id}">${e.remote ? `<span class="who-badge">${whoOf(e)?.emoji || '👤'}</span>` : ''}${e.photo ? '<img data-thumb="' + e.id + '" alt="">' : `<span class="memo-card">📝 ${esc((e.memo || '메모').slice(0, 40))}</span>`}<span class="cap">${fmtTime(e.t).split(' ').pop()} · ${esc(short(e.placeName, 10))}${stars(e) ? ' ' + '★'.repeat(stars(e)) : ''}</span></button>`;
}
function albumHTML() {
  if (!JR.ok) return '<p class="note">이 브라우저에선 사진·메모 저장을 쓸 수 없어요.</p>';
  const mine = JR.entries.filter(e => e.city === C.id), photos = mine.filter(e => e.photo).length;
  const head = shareCardHTML() + `<div class="day-hero"><h2>📸 우리 여행 기록</h2><p>사진 ${photos}장 · 메모 ${mine.length - photos}개 · 걸은 길 ${walkedKm().toFixed(1)}km</p>
    <button class="btn primary" style="height:44px;font-size:16px;margin-top:8px" data-rec-open="1">📸 사진·메모 남기기</button>
    <div class="links" style="margin-top:8px"><button class="small-btn" data-track-toggle="1">👣 발자취 ${JR.showTrack ? '숨기기' : '보기'}</button>${JR.track.length ? '<button class="small-btn" data-track-clear="1">발자취 지우기</button>' : ''}</div>
    <p class="note">📡 GPS를 켜 두면 걸은 길이 지도에 파란 점선으로 남아요. ${SH.client ? '사진은 공유 앨범에도 올라가요. 폰 사진앱에 남기려면 📤 공유 → 이미지 저장.' : '사진은 이 폰에만 저장되니 📤 공유로 단톡방이나 사진앱에도 옮겨 두세요.'}${isPWA() && !isStandalone() ? (mine.length ? ' 앱으로 설치해도 지금까지 기록은 옮겨지지 않아요 — 설치 전에 날짜별 📤 공유로 사진앱에 저장해 두세요.' : ' 홈 화면에 앱으로 먼저 설치하고 기록을 시작하면 사진이 더 안전하게 보관돼요.') : ''}</p></div>`;
  if (!mine.length) return head + '<div class="card"><p>아직 기록이 없어요. 지도 오른쪽 빨간 📸 버튼으로 첫 사진을 남겨 보세요!</p></div>';
  const groups = new Map();
  for (const e of mine) { const d = albumDay(e); if (!groups.has(d)) groups.set(d, []); groups.get(d).push(e); }
  return head + [...groups.entries()].sort((a, b) => a[0] - b[0]).map(([d, list]) => `<div class="sec album-day">
    <div class="album-h"><h3>${d + 1}일차 · ${esc(C.days[d]?.chip || '')}</h3>${list.some(e => e.photo) ? `<button class="small-btn" data-share-day="${d}">${JR.prepared?.day === d ? shareLabel(JR.prepared) : '📤 이 날 사진 공유'}</button>` : ''}</div>
    <div class="album-grid">${list.map(albumItem).join('')}</div></div>`).join('');
}

// ---------- shared album (private GitHub repo; installed app / normal browser only) ----------
const SH = { client: null, device: null, syncing: false, lastSync: store.get('shareSync', 0), err: null, tomb: store.get('tomb', []), timer: null };
SH.device = store.get('device', null) || (() => { const d = 'd' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); store.set('device', d); return d; })();
{ const s = store.get('share', null); if (s?.token) SH.client = new ShareClient(s.token); }
const shareAllowed = () => isPWA() && JR.ok; // the Claude viewer blocks calls to GitHub
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? '방금' : m < 60 ? `${m}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
function scheduleSync(ms = 1500) { if (!SH.client) return; clearTimeout(SH.timer); SH.timer = setTimeout(() => syncShare(), ms); }
function metaOf(e) {
  const { id, t, city, day, stop, lat, lng, acc, src, placeId, placeName, memo, rating, who, photo, owner } = e;
  return { v: 1, id, t, city, day, stop, lat, lng, acc, src, placeId, placeName, memo, rating, who, whoName: nameOfIdx(who), photo, owner: owner || SH.device };
}
const str = (v, n) => typeof v === 'string' ? v.slice(0, n) : '';
const num = v => typeof v === 'number' && isFinite(v) ? v : null;
const int = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi ? v : lo;
function normMeta(m) { // records come from other phones: keep only known fields with the right types
  if (!m || typeof m !== 'object') throw new Error('bad record');
  const la = num(m.lat), lo = num(m.lng), ok = la != null && lo != null && Math.abs(la) <= 90 && Math.abs(lo) <= 180;
  return { t: num(m.t) ?? 0, city: str(m.city, 40), day: int(m.day, 0, 60), stop: int(m.stop, 0, 99), lat: ok ? la : null, lng: ok ? lo : null, acc: num(m.acc),
    src: str(m.src, 10), placeId: typeof m.placeId === 'string' ? m.placeId.slice(0, 80) : null, placeName: str(m.placeName, 80) || '어딘가', memo: str(m.memo, 300),
    rating: int(m.rating, 0, 5), who: int(m.who, 0, CREW_DEFAULT.length - 1), whoName: str(m.whoName, 20), photo: m.photo === true, owner: str(m.owner, 40) };
}
async function syncShare({ quiet = true } = {}) {
  if (!SH.client || !JR.ok || !navigator.onLine) return;
  if (SH.syncing) { SH.again = true; return; }
  if (Date.now() < (SH.pauseUntil || 0)) return;
  const client = SH.client;
  SH.syncing = true; SH.err = null; shareRefresh();
  let changed = false;
  try {
    // 1) upload my new/edited records (photos first, the record last, so friends never see a record without its photo)
    for (const e of JR.entries.filter(x => !x.remote && x.sync !== 'done')) {
      if (e.photo && (e.sync == null || e.sync === 'new')) { // records made before sharing have no sync state yet
        const thumb = await J.getBlob(e.id, 'thumb').catch(() => null), full = await J.getBlob(e.id, 'full').catch(() => null);
        if (thumb) await client.put(`t/${e.id}.jpg`, thumb, { message: 'thumb ' + e.id });
        if (full) await client.put(`p/${e.id}.jpg`, full, { message: 'photo ' + e.id });
      }
      if (!JR.entries.includes(e)) continue; // deleted while its photo uploaded; the tombstone cleans up
      const body = JSON.stringify(metaOf(e));
      e.rsha = await client.put(`e/${e.id}.json`, body, { sha: e.rsha || null, message: 'record ' + e.id });
      if (!JR.entries.includes(e)) continue;
      e.sync = JSON.stringify(metaOf(e)) === body ? 'done' : 'dirty'; // edited during the upload → send again
      if (e.sync === 'dirty') SH.again = true;
      await J.saveEntry(e);
    }
    let tree = await client.tree();
    // 2) remove what I deleted
    if (SH.tomb.length) {
      for (const id of [...SH.tomb]) {
        for (const p of [`e/${id}.json`, `t/${id}.jpg`, `p/${id}.jpg`]) if (tree.has(p)) await client.del(p, tree.get(p));
        SH.tomb = SH.tomb.filter(x => x !== id); store.set('tomb', SH.tomb);
      }
      tree = await client.tree();
    }
    // 3) pull friends' records (and mine from an earlier install)
    const ids = new Set();
    for (const [path, sha] of tree) {
      const m = path.match(/^e\/([\w-]+)\.json$/); if (!m) continue;
      const id = m[1]; ids.add(id);
      if (SH.tomb.includes(id)) continue;
      const local = JR.entries.find(x => x.id === id);
      if (local && (!local.remote || local.rsha === sha)) continue;
      let meta;
      try { meta = normMeta(JSON.parse(await (await client.get(path)).text())); } catch (err) { if (err.rateLimited) throw err; console.warn('skip bad record', path, err); continue; }
      const e = { ...meta, id, remote: meta.owner !== SH.device, rsha: sha, sync: 'done' };
      const thumb = e.photo && !local && tree.has(`t/${id}.jpg`) ? await client.get(`t/${id}.jpg`).catch(() => null) : null;
      if (e.photo && !local && tree.has(`t/${id}.jpg`) && !thumb) continue; // try again next sync instead of a blank tile forever
      await J.saveEntry(e, thumb ? { thumb } : {});
      if (local) Object.assign(local, e); else JR.entries.push(e);
      changed = true;
    }
    // 4) drop friends' records their owners deleted
    for (const e of JR.entries.filter(x => x.remote && !ids.has(x.id))) {
      await J.deleteEntry(e.id).catch(() => {});
      const u = JR.urls.get(e.id); if (u) { URL.revokeObjectURL(u); JR.urls.delete(e.id); }
      JR.entries = JR.entries.filter(x => x !== e); changed = true;
    }
    JR.entries.sort((a, b) => a.t - b.t);
    SH.lastSync = Date.now(); store.set('shareSync', SH.lastSync);
    if (!quiet) toast('✅ 공유 앨범 동기화 완료');
  } catch (err) {
    SH.err = err; console.warn('share sync', err);
    if (err.rateLimited) { SH.pauseUntil = err.retryAt; if (!quiet) toast('사진이 많아 GitHub가 잠깐 쉬래요 — 조금 뒤 자동으로 이어서 올릴게요', 3500); }
    else if (err.status === 401 || err.status === 403 || err.status === 404) toast('공유 앨범 권한이 끊겼어요 — 앨범 탭에서 새 초대 링크를 넣어 주세요', 4500);
    else if (!quiet) toast('동기화 실패 — 연결되면 다시 시도할게요', 3000);
  } finally {
    SH.syncing = false;
    if (SH.again) { SH.again = false; scheduleSync(2000); }
    if (changed) refreshJournal();
    shareRefresh(changed);
  }
}
function shareRefresh(changed = false) { if (C && (S.tab === 'album' || (changed && S.tab === 'here'))) renderBody(true); }
function shareCardHTML() {
  if (!shareAllowed()) return isPWA() ? '' : `<div class="card share-card"><h4>👥 원정대 공유 앨범</h4><p>공유 앨범은 설치형 앱(깃허브 주소)에서만 돼요: <b>yjc20170201-sudo.github.io/mokbang6</b></p></div>`;
  if (!SH.client) return `<div class="card share-card"><h4>👥 원정대 공유 앨범</h4><p>모두가 찍은 사진이 한 앨범과 지도에 모여요. 방장이 한 번 만들고, 나머지는 카톡으로 받은 초대 링크 + 암호로 들어오면 돼요.</p>
    <div class="links" style="margin-top:8px"><button class="small-btn" data-share-join="1">🔑 초대받았어요</button><button class="small-btn" data-share-create="1">👑 방장: 공유 앨범 만들기</button></div></div>`;
  const pending = JR.entries.filter(e => !e.remote && e.sync !== 'done').length, friends = JR.entries.filter(e => e.remote).length;
  const authBad = SH.err && !SH.err.rateLimited && [401, 403, 404].includes(SH.err.status);
  const status = SH.syncing ? '🔄 동기화 중…' : authBad ? '🔑 토큰이 만료됐거나 권한이 없어요' : SH.err?.rateLimited ? '⏸️ GitHub 요청 한도 — 잠시 후 자동 재개' : SH.err ? '⚠️ 동기화 실패 (연결 확인)' : SH.lastSync ? `✅ ${ago(SH.lastSync)} 동기화` : '⏳ 첫 동기화 전';
  return `<div class="card share-card on${authBad ? ' bad' : ''}"><h4>👥 공유 앨범 연결됨</h4><p>${status}${pending ? ` · 올릴 기록 ${pending}개` : ''} · 친구 기록 ${friends}개</p>
    ${authBad ? '<div class="links" style="margin-top:8px"><button class="small-btn" data-share-join="1">🔑 새 초대 링크 넣기</button><button class="small-btn" data-share-create="1">👑 방장: 새 토큰 넣기</button></div>' : ''}
    <div class="links" style="margin-top:8px"><button class="small-btn" data-share-sync="1">🔄 지금 동기화</button><button class="small-btn" data-share-invite="1">📨 친구 초대 링크</button><button class="small-btn" data-share-leave="1">연결 끊기</button></div></div>`;
}
function shareModal(html) { const el = $('#jModal'); closeJModal(); el.innerHTML = `<div class="modal jshare" role="dialog" aria-label="공유 앨범">${html}</div>`; el.hidden = false; el.dataset.mode = 'share'; }
async function showRepoDiag(c) {
  const box = $('#shDiag'); if (!box) return;
  let seen = null; try { seen = await c.visibleRepos(); } catch { /* fall back to the generic hint */ }
  const fix = `GitHub <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">내 토큰 목록</a> → 이 토큰 → <b>편집</b> → <b>저장소 액세스</b>를 <b>저장소만 선택합니다</b>로 바꾸고 <b>${REPO.name}</b>에 체크 → 권한에 <b>콘텐츠: 읽기 및 쓰기</b> → 맨 아래 저장. 편집이 안 보이면 이 토큰은 지우고 위 버튼으로 새로 만들어요.`;
  let what;
  if (!seen) what = `이 토큰은 <b>${REPO.name}</b> 저장소를 못 봐요.`;
  else if (!seen.length) what = `이 토큰에 <b>선택된 저장소가 하나도 없어요</b>.`;
  else {
    const priv = seen.filter(r => r.priv), list = seen.slice(0, 6).map(r => `${esc(r.owner)}/${esc(r.name)}${r.priv ? ' 🔒' : ''}`).join(', ') + (seen.length > 6 ? ` 외 ${seen.length - 6}개` : '');
    what = priv.length ? `이 토큰이 보는 저장소: <b>${list}</b> — <b>${REPO.name}</b>이 빠져 있어요.`
      : `이 토큰은 <b>공개 저장소만</b> 봐요 (${list}). 사진 저장소는 비공개라 안 보여요.`;
  }
  box.innerHTML = `<div class="card warn-soft" style="margin-top:12px"><p><b>⚠️ 토큰 설정이 달라요</b></p><p style="margin-top:4px">${what}</p><p class="note" style="margin-top:6px">${fix}</p></div>`;
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function openShareCreate() {
  shareModal(`<h2 class="j-title">👑 공유 앨범 만들기</h2>
    <p class="note">방장 한 명만 하면 돼요. 사진은 형님 GitHub의 <b>비공개</b> 저장소 <b>${REPO.name}</b>에 모여요.</p>
    <ol class="mini-steps">
      <li>아래 버튼으로 GitHub 토큰 만들기 화면을 열어요 (이름·만료·권한은 미리 채워져요).</li>
      <li><b>만료</b>가 여행 끝나는 날 이후인지 확인</li>
      <li><b>저장소 액세스</b> → <b>저장소만 선택합니다</b> → <b>${REPO.name}</b> 고르기 <span style="opacity:.75">(“공개 저장소”로 두면 안 돼요)</span></li>
      <li><b>권한</b> → <b>저장소</b> 칸에 <b>콘텐츠: 읽기 및 쓰기</b>가 있는지 확인 (없으면 ＋로 추가)</li>
      <li><b>토큰 생성</b> → 나온 <code>github_pat_…</code>를 복사해서 아래에 붙여넣기</li>
    </ol>
    <a class="btn map" style="width:100%;margin-top:8px" href="https://github.com/settings/personal-access-tokens/new?name=mokbang6-album&description=%EB%A8%B9%EB%B0%A9%EC%9B%90%EC%A0%95%EB%8C%80%20%EA%B3%B5%EC%9C%A0%20%EC%95%A8%EB%B2%94&expires_in=180&contents=write&metadata=read" target="_blank" rel="noopener">🔗 GitHub 토큰 만들기 열기</a>
    <p class="note" style="margin-top:6px">이미 만든 토큰을 고칠 땐 <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">내 토큰 목록</a> → 토큰 이름 → 편집 (토큰 값은 그대로예요)</p>
    <label class="j-label" for="shToken">토큰</label><input class="j-input" id="shToken" type="password" autocomplete="off" spellcheck="false" placeholder="github_pat_...">
    <label class="j-label" for="shPass">그룹 암호 (친구들이 입력할 말 · 8글자 이상, 숫자만은 안 돼요)</label><input class="j-input" id="shPass" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="우리만 아는 말 8글자 이상">
    <p class="note">토큰은 이 저장소 하나만 읽고 쓸 수 있어요(Fine-grained 토큰만 받아요). 초대 링크에는 암호로 잠근 토큰이 들어가요.</p>
    <div id="shDiag"></div>
    <div class="j-actions"><button class="btn" data-jclose="1">취소</button><button class="btn primary" data-share-save="1">만들기</button></div>`);
}
function openShareJoin(code = '') {
  const ua = navigator.userAgent, inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(ua), iosBrowser = /iPhone|iPad|iPod/i.test(ua) && !isStandalone();
  const where = inApp || iosBrowser ? `<div class="card warn-soft" style="margin-top:8px"><p>${inApp ? '카톡·네이버 안 브라우저예요. 여기서 들어가면 이 창에서만 공유돼요.' : '사파리에서 열었어요.'} 홈 화면에 설치한 앱에서 쓰려면: <b>링크 복사 → 설치한 앱 열기 → 📸 앨범 → 🔑 초대받았어요 → 붙여넣기</b></p>${code ? `<button class="small-btn" style="margin-top:6px" data-share-copy="${esc(inviteURL(code))}">📋 초대 링크 복사</button>` : ''}</div>` : '';
  shareModal(`<h2 class="j-title">🔑 공유 앨범 들어가기</h2>
    <p class="note">방장이 카톡으로 보낸 초대 링크로 열었다면 암호만 넣으면 돼요.${SH.client ? ' (지금 연결을 새 초대로 바꿔요)' : ''}</p>${where}
    <label class="j-label" for="shCode">초대 코드</label><textarea class="j-input" id="shCode" rows="2" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="초대 링크나 코드 붙여넣기">${esc(code)}</textarea>
    <label class="j-label" for="shJoinPass">그룹 암호</label><input class="j-input" id="shJoinPass" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="방장이 알려준 암호">
    <div class="j-actions"><button class="btn" data-jclose="1">나중에</button><button class="btn primary" data-share-joingo="1">들어가기</button></div>`);
}
function openShareInvite() {
  shareModal(`<h2 class="j-title">📨 친구 초대 링크</h2>
    <label class="j-label" for="shInvPass">그룹 암호 (처음 정한 암호)</label><input class="j-input" id="shInvPass" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="처음 정한 암호">
    <div id="shInvOut"></div>
    <div class="j-actions"><button class="btn" data-jclose="1">닫기</button><button class="btn primary" data-share-invgo="1">링크 만들기</button></div>`);
}
const inviteURL = code => `${location.origin}${location.pathname}#join=${code}`;
function showInvite(code) {
  const url = inviteURL(code), out = $('#shInvOut') || null;
  const html = `<div class="card" style="margin-top:12px"><h4>✅ 초대 링크</h4><p class="note" style="word-break:break-all">${esc(url)}</p>
    <div class="links" style="margin-top:8px"><button class="small-btn" data-share-send="${esc(url)}">📤 카톡으로 보내기</button><button class="small-btn" data-share-copy="${esc(url)}">📋 복사</button></div>
    <p class="note" style="margin-top:6px">암호는 링크와 같이 보내지 말고 따로(말로·다른 메시지로) 알려 주세요.</p></div>`;
  if (out) out.innerHTML = html; else shareModal(`<h2 class="j-title">👥 공유 앨범 준비 완료!</h2>${html}<div class="j-actions"><button class="btn primary" data-jclose="1">닫기</button></div>`);
}
async function onShareClick(q) {
  let b;
  if (q('[data-share-create]')) { openShareCreate(); return true; }
  if (q('[data-share-join]')) { openShareJoin(); return true; }
  if (q('[data-share-invite]')) { openShareInvite(); return true; }
  if (q('[data-share-sync]')) { syncShare({ quiet: false }); return true; }
  if ((b = q('[data-share-leave]'))) {
    if (!b.dataset.sure) { b.dataset.sure = '1'; b.textContent = '정말 끊을까요? 한 번 더'; return true; }
    SH.client = null; store.set('share', null); toast('공유 앨범 연결을 끊었어요 (폰에 있는 사진은 그대로)', 3000); renderBody(true); return true;
  }
  if (q('[data-share-save]')) {
    const token = $('#shToken').value.trim(), pass = $('#shPass').value;
    const diag = $('#shDiag'); if (diag) diag.innerHTML = '';
    if (!/^github_pat_\w{60,}$/.test(token)) { toast('Fine-grained 토큰(github_pat_…) 전체를 붙여넣어 주세요', 3500); return true; }
    if (pass.trim().length < 8 || /^\d+$/.test(pass.trim())) { toast('암호는 숫자만 말고 8글자 이상으로 정해 주세요', 3200); return true; }
    const c = new ShareClient(token);
    try { if (!(await c.check())) { toast('토큰 권한이 모자라요 — GitHub 내 토큰 목록 → 토큰 → 편집 → 권한 → 저장소 → 콘텐츠를 “읽기 및 쓰기”로 바꿔 주세요', 6000); return true; } }
    catch (err) { if (err.status === 404) { await showRepoDiag(c); return true; } toast(err.status === 401 ? '토큰이 틀렸거나 만료됐어요 — 토큰 생성 후 전체를 다시 복사해 주세요' : err.status === 404 ? `토큰이 ${REPO.name} 저장소를 못 봐요 — GitHub 내 토큰 목록 → 토큰 → 편집 → 저장소 액세스를 “저장소만 선택합니다 → ${REPO.name}”로 바꾸고 다시 눌러 주세요` : '확인 실패 — 인터넷 연결을 확인해 주세요', 6000); return true; }
    SH.client = c; store.set('share', { token }); SH.err = null;
    showInvite(await makeInvite(token, pass));
    syncShare({ quiet: false });
    return true;
  }
  if (q('[data-share-joingo]')) {
    let code = $('#shCode').value.trim(); const m = code.match(/#join=([\w-]+)/); if (m) code = m[1];
    const pass = $('#shJoinPass').value;
    let token;
    try { token = await openInvite(code, pass); } catch { toast('암호나 초대 코드가 달라요 — 다시 확인해 주세요', 3500); return true; }
    if (!/^github_pat_\w{60,}$/.test(token)) { toast('초대 코드가 이상해요 — 방장에게 다시 받아 주세요', 3500); return true; }
    const c = new ShareClient(token);
    try { await c.check(); } catch (err) { toast(err.status === 401 || err.status === 404 ? '초대 링크가 만료됐어요 — 방장에게 새 링크를 받아 주세요' : '확인 실패 — 인터넷 연결을 확인해 주세요', 4000); return true; }
    SH.client = c; store.set('share', { token }); SH.err = null; SH.pauseUntil = 0;
    if (/join=/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
    closeJModal(); toast('👥 공유 앨범에 들어왔어요! 사진을 받는 중…', 3000);
    S.tab = 'album'; renderBody(); if (S.sheet === 'peek') setSheet('half');
    syncShare({ quiet: false });
    return true;
  }
  if (q('[data-share-invgo]')) {
    const pass = $('#shInvPass').value; if (pass.trim().length < 8) { toast('처음 정한 그룹 암호(8글자 이상)를 넣어 주세요', 3000); return true; }
    const token = store.get('share', null)?.token; if (!token) return true;
    try { await new ShareClient(token).check(); } catch (err) { if ([401, 404].includes(err.status)) { toast('토큰이 만료됐거나 권한이 없어요 — 새 토큰을 넣어 주세요', 3800); openShareCreate(); return true; } }
    showInvite(await makeInvite(token, pass)); return true;
  }
  if ((b = q('[data-share-send]'))) {
    const url = b.dataset.shareSend, text = '🍜 먹방원정대 공유 앨범 초대! 링크 열고 암호 넣으면 돼요 (암호는 따로 알려줄게)';
    try { if (navigator.share) await navigator.share({ title: '먹방원정대', text, url }); else { await navigator.clipboard.writeText(text + '\n' + url); toast('복사했어요 📋'); } } catch (err) { if (err?.name !== 'AbortError') toast('공유가 안 되면 복사 버튼을 쓰세요'); }
    return true;
  }
  if ((b = q('[data-share-copy]'))) { navigator.clipboard?.writeText(b.dataset.shareCopy).then(() => toast('복사했어요 📋'), () => toast('길게 눌러서 복사해 주세요')); return true; }
  return false;
}

// ---------- install as an app (GitHub Pages build only) ----------
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (S.tab === 'tips' && C) renderBody(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('📲 설치 완료! 홈 화면에서 여세요'); });
const isPWA = () => !!document.querySelector('link[rel="manifest"]');
let offlineOK = false;
async function checkOffline() {
  try { offlineOK = !!navigator.serviceWorker?.controller && !!(await caches.match('https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js')); } catch { offlineOK = false; }
  if (S.tab === 'tips' && C) renderBody(true);
}
async function setupSW() {
  const sw = navigator.serviceWorker, had = !!sw.controller;
  sw.addEventListener('controllerchange', () => { if (had) location.reload(); else checkOffline(); });
  try {
    const reg = await sw.register('sw.js');
    const offer = w => { if (!sw.controller) return; const bar = $('#updateBar'); bar.hidden = false; $('#updateGo').onclick = () => { bar.hidden = true; w.postMessage('skip'); }; };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => { const w = reg.installing; w?.addEventListener('statechange', () => { if (w.state === 'installed') { offer(w); checkOffline(); } }); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch { /* offline cache is optional */ }
  checkOffline();
}
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installHTML() {
  if (!isPWA()) return '';
  if (isStandalone()) return offlineOK
    ? `<div class="sec card"><h4>✅ 앱으로 실행 중</h4><p>오프라인에서도 지도·일정이 떠요. 위치는 📍 버튼으로 켜세요.</p></div>`
    : `<div class="sec card"><h4>⏳ 오프라인 준비 중</h4><p>와이파이에서 1분쯤 켜 두세요. 준비되면 여기가 ✅로 바뀌어요.</p></div>`;
  const ua = navigator.userAgent, ios = /iPhone|iPad|iPod/i.test(ua), inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(ua);
  const how = installEvt ? `<p>버튼 한 번이면 홈 화면에 아이콘이 생겨요.</p><button class="btn primary" style="margin-top:10px;width:100%" data-install="1">📲 설치하기</button>`
    : inApp ? `<p>카톡·네이버 안에서는 설치가 안 돼요. 오른쪽 아래(또는 위) <b>⋯ 메뉴 → 다른 브라우저로 열기</b>를 누른 뒤 설치하세요.</p>`
    : ios ? `<p>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요. 설치한 앱은 와이파이에서 한 번 열어 두세요. 이름표·숙소 설정과 사진 기록은 앱으로 옮겨지지 않으니 여행 전에 설치하세요.</p>`
    : `<p>크롬 오른쪽 위 <b>⋮ 메뉴 → 앱 설치</b> (또는 홈 화면에 추가)를 누르세요.</p>`;
  return `<div class="sec card install"><h4>📲 폰에 앱으로 설치</h4>${how}<p class="note" style="margin-top:6px">설치하면 전체화면·오프라인·GPS가 다 돼요.</p></div>`;
}

// ---------- our own hotel ----------
const hotelId = () => Object.keys(C.places).find(k => C.places[k].cat === 'hotel');
function applyHotel() {
  const id = hotelId(), h = store.get('hotel:' + C.id, null); if (!id || !h) return;
  const p = C.places[id];
  p._orig ||= { lat: p.lat, lng: p.lng, nameKo: p.nameKo, q: p.q };
  if (h.lat != null) { p.lat = h.lat; p.lng = h.lng; }
  if (h.name) { p.nameKo = `우리 숙소 · ${h.name}`; p.q = h.name; } else if (h.lat != null) { p.nameKo = '우리 숙소'; p.q = `${h.lat.toFixed(6)},${h.lng.toFixed(6)}`; }
}
function hotelHTML(p) {
  const h = store.get('hotel:' + C.id, {}) || {};
  return `<div class="sec card"><h4>🏨 실제 숙소로 바꾸기</h4><p>호텔 이름을 넣으면 길찾기가 그 호텔로 안내되고, 지도에서 위치를 찍으면 원정대가 거기서 출발해요.</p>
    <div class="calc" style="margin-top:8px"><label for="hotelName" style="grid-column:1/-1">호텔 이름 (구글맵 검색어)<input id="hotelName" value="${esc(h.name || '')}" placeholder="예: 호텔 이름 + 지역"></label></div>
    <div class="links" style="margin-top:10px"><button class="small-btn" data-hotelpin="1">📍 지도에서 숙소 위치 찍기</button>${h.name || h.lat != null ? '<button class="small-btn" data-hotelreset="1">예시 위치로 되돌리기</button>' : ''}</div></div>`;
}

// ---------- intro ----------
function openIntro(first = false) {
  const el = $('#intro'); const defs = crewDefs();
  el.innerHTML = `<div class="modal" role="dialog" aria-labelledby="introTitle">
    <span class="eyebrow">제주 → 일본 · 4박 5일 · 40대 <span id="crewCount">${N()}</span>인</span>
    <h1 class="intro-title" id="introTitle"><span id="crewCount2">${N()}</span>인 <em>먹방</em>원정대</h1>
    <p class="lede">아침 밥부터 마지막 해장 라멘까지, 원정대가 3D 지도 위를 걸으며 맛집·이동법·술집을 안내해요. 프리다이빙 하루, 테니스 하루 포함.</p>
    <div class="city-pick">
      ${['osaka', 'tokyo'].map(id => { const m = CITY_META[id]; return `<button class="city-card" data-city="${id}" aria-pressed="${S.city === id}"><span class="nm">${m.emoji} ${m.name}</span><ul>${m.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul></button>`; }).join('')}
    </div>
    <div id="crewEd"></div>
    <button class="btn primary intro-go" id="introGo">${first ? '✈️ 출발!' : '이대로 보기'}</button>
    <p class="fine">이름을 바꾸거나 ✕로 빼고, ＋로 더할 수 있어요 (2~8명). 저장은 이 폰에만 돼요. 첫날 비행기 착륙부터 보여줘요.</p>
  </div>`;
  el.hidden = false;
  const draft = S.crew.map(x => ({ ...x }));
  const readCrew = () => el.querySelectorAll('[data-crew]').forEach(i => { draft[+i.dataset.crew].name = i.value; });
  const drawCrew = () => {
    el.querySelector('#crewEd').innerHTML = `<div class="crew-head"><h3>원정대 ${draft.length}명</h3><span class="note">이름 바꾸기 · ✕ 빼기 · ＋ 더하기</span></div>
      <div class="crew">${draft.map((x, i) => { const d = CREW_DEFAULT[x.c]; return `<div class="crew-m"><span class="av" style="background:${d.shirt}">${d.emoji}</span><input id="crew${x.c}" data-crew="${i}" value="${esc(x.name || d.role)}" maxlength="8" aria-label="${d.role} 이름">${draft.length > 2 ? `<button type="button" class="crew-x" data-crew-del="${i}" aria-label="${esc(x.name || d.role)} 빼기">✕</button>` : ''}</div>`; }).join('')}
      ${draft.length < 8 ? '<button type="button" class="crew-add" data-crew-add="1">＋<br>한 명 추가</button>' : ''}</div>`;
    el.querySelector('#crewCount').textContent = draft.length; el.querySelector('#crewCount2').textContent = draft.length;
  };
  drawCrew();
  el.querySelector('#crewEd').onclick = e => {
    const del = e.target.closest('[data-crew-del]'), add = e.target.closest('[data-crew-add]');
    if (!del && !add) return;
    readCrew();
    if (del && draft.length > 2) draft.splice(+del.dataset.crewDel, 1);
    if (add && draft.length < 8) { const free = CREW_DEFAULT.findIndex((_, c) => !draft.some(x => x.c === c)); if (free >= 0) draft.push({ c: free, name: '' }); }
    drawCrew();
  };
  el.querySelectorAll('[data-city]').forEach(b => b.onclick = () => { el.querySelectorAll('[data-city]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); el.dataset.pick = b.dataset.city; });
  el.dataset.pick = S.city || 'osaka';
  el.querySelector(`[data-city="${el.dataset.pick}"]`).setAttribute('aria-pressed', 'true');
  el.querySelector('#introGo').onclick = async () => {
    readCrew(); S.crew = draft.map(x => ({ c: x.c, name: x.name.trim() })); store.set('crew2', S.crew);
    if (!S.crew.some(x => x.c === JR.who)) { JR.who = S.crew[0].c; store.set('who', JR.who); }
    el.hidden = true;
    const pick = el.dataset.pick;
    world.setCrew(crewDefs());
    if (pick !== S.city || !C) { await loadCity(pick, true); }
    else { renderAll(); startActivity(); }
  };
}
const CITY_META = {
  osaka: { emoji: '🐙', name: '오사카', points: ['제주 직항 매일 (16:05→17:55)', '시라하마 바다 프리다이빙', '쿠시카츠·오코노미야키·고베규', '실제 여행 약 3.5일'] },
  tokyo: { emoji: '🗼', name: '도쿄', points: ['대한항공 직항 주 4회 (월·수·금·일)', '이즈 바다 프리다이빙', '츠키지·몬자·골든가이', '규모 크고 이동 많음'] },
};

async function loadCity(id, fresh) {
  gen++; busy = false;
  $('#travel').hidden = true;
  $('#loading').hidden = false; $('#loadingText').textContent = '일정 불러오는 중…';
  const mod = await CITY_LOADERS[id]();
  C = mod.default;
  for (const [pid, p] of Object.entries(C.places)) p.id = pid;
  applyHotel();
  S.city = id; store.set('city', id);
  regionId = null;
  const saved = store.get('pos', null);
  if (!fresh && saved && saved.city === id && C.days[saved.day]?.stops[saved.stop]) { S.day = saved.day; S.stop = saved.stop; }
  else { S.day = 0; S.stop = 0; }
  S.here = null; S.viewPlace = null; GPS.warnedOut = false; GPS.dismissed = null;
  if (GPS.fix) setTimeout(() => onGPS({ coords: { latitude: GPS.fix.lat, longitude: GPS.fix.lng, accuracy: GPS.fix.acc } }), 0);
  document.documentElement.style.setProperty('--city', C.accent || '#e0442f');
  $('#loading').hidden = true;
  renderAll();
  if (fresh && S.day === 0 && S.stop === 0) await arriveAtStop(true);
  else await showStop();
  setSheet('peek');
}

// ---------- boot ----------
(async function boot() {
  const th = store.get('theme', null); if (th) document.documentElement.setAttribute('data-theme', th);
  world = new World($('#gl'), $('#labels'), Q);
  window.__trip = { world, S, get C() { return C; }, jump: (d, s) => jumpTo(d, s), next: () => go(1), city: id => loadCity(id, false) };
  world.setCrew(crewDefs());
  bindUI();
  if ('serviceWorker' in navigator && isPWA()) setupSW();
  journalInit().then(() => {
    if (!shareAllowed()) return;
    const checkJoin = () => { // invite links: #join=<code>
      const m = location.hash.match(/join=([\w-]+)/); if (!m) return;
      openShareJoin(m[1]);
    };
    checkJoin(); window.addEventListener('hashchange', checkJoin);
    scheduleSync(800);
    setInterval(() => { if (document.visibilityState === 'visible') syncShare(); }, 90000);
    window.addEventListener('online', () => scheduleSync(500));
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - SH.lastSync > 30000) scheduleSync(300); });
  });
  if (!S.city) { $('#loading').hidden = true; openIntro(true); return; }
  try { await loadCity(S.city, false); } catch (e) { console.error(e); $('#loadingText').textContent = '불러오기 실패 — 새로고침 해주세요'; }
})();
