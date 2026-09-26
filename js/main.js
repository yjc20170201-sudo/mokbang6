// App glue: state, itinerary engine, UI (bottom sheet, tabs, overlays).
import * as THREE from 'three';
import { World } from './world.js';
import { CREW_DEFAULT } from './chars.js';
import { CAT, KIND, LINES_BY_ACT, PHRASES, CHECKLIST, GROUP_TIPS } from './data/common.js';

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
  crew: store.get('crew', CREW_DEFAULT.map(c => c.role)),
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
function toast(msg, ms = 2400) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), ms); }
function crewDefs() { return CREW_DEFAULT.map((d, i) => ({ ...d, name: S.crew[i] || d.role })); }

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
  else if (leg.m === 'taxi') parts.push(`택시 2대 ${leg.min}분`);
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
    if (leg.note) steps.push({ i: '💡', t: esc(leg.note) });
  } else {
    steps.push({ i: MODE[leg.m]?.ico || '➡️', t: `<b>${esc(leg.name || MODE[leg.m]?.name)}</b> ${esc(leg.fromKo || leg.from || '')}${leg.to ? ' → ' + esc(leg.toKo || leg.to) : ''}`, s: [leg.min ? `${leg.min}분` : '', leg.fare ? (leg.m === 'taxi' ? `1대 약 ${yen(leg.fare)}` : `1인 ${yen(leg.fare)}`) : '', leg.dep ? `${leg.dep} 출발` : '', leg.arr ? `${leg.arr} 도착` : ''].filter(Boolean).join(' · ') });
    for (const x of leg.then || []) steps.push({ i: x.i || '➡️', t: esc(x.t), s: x.s });
    if (leg.note) steps.push({ i: '💡', t: esc(leg.note) });
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
  if (leg.m === 'taxi' || leg.m === 'pickup') { const mid = A.clone().lerp(B, 0.5).add(new THREE.Vector3(-(B.z - A.z), 0, B.x - A.x).multiplyScalar(0.12)); return [{ type: 'taxi', pts: [A, mid, B], label: leg.m === 'pickup' ? '🚐 샵 픽업' : '🚕🚕 택시 2대' }]; }
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
        else if (s.type === 'taxi') await world.ride(s.pts, { vehicle: 'taxi', label: s.label, speed: 600 });
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
      ${leg.note ? `<div class="ticket-tip">💡 ${esc(leg.note)}</div>` : ''}
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
    if (st.leg?.fare) move += st.leg.m === 'taxi' ? st.leg.fare / 3 : st.leg.fare;
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
      <div class="stop-meta"><span class="kind ${K.cls}">${esc(st.k)}</span><span class="tnum">${st.t}</span><span>· ${S.stop + 1}/${C.days[S.day].stops.length}</span>${p.area ? `<span>· ${esc(p.area)}</span>` : ''}</div>
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
  b.innerHTML = S.tab === 'here' ? (S.viewPlace ? placeHTML(S.viewPlace, true) : hereHTML()) : S.tab === 'plan' ? planHTML() : S.tab === 'near' ? nearHTML() : tipsHTML();
  if (!keepScroll) b.scrollTop = 0;
}
function renderAll() { renderDays(); renderClock(); renderHead(); renderBody(); renderParty(); if (GPS.fix) { hideArrive(); checkArrival(); } }
function renderParty() {
  const defs = crewDefs();
  $('#partyDots').innerHTML = defs.map(d => `<i style="background:${d.shirt}" title="${esc(d.name)}"></i>`).join('');
  const st = curStop();
  $('#partyText').textContent = busy ? `${MODE[st.leg?.m]?.ico || '🚶'} ${short(stopPlace().nameKo)}(으)로 이동 중` : `${st.e || ''} ${st.k} 중 · 6명`;
}

function infoGrid(p) {
  const g6 = { easy: ['easy', '👍 6명 바로 OK'], reserve: ['reserve', '📞 예약하면 OK'], split: ['split', '✂️ 3+3 나눠 앉기'] }[p.g6] || null;
  const cells = [
    ['영업시간', p.hours || '—'], ['가격 (1인)', p.price ? `${priceText(p.price)} · ${won((p.price[0] + p.price[1]) / 2)}` : '—'],
    ['6명 자리', g6 ? `<span class="g6 ${g6[0]}">${g6[1]}</span>` : '—'], ['결제', p.cash === true ? '💴 현금만' : p.cash === false ? '💳 카드 OK' : '—'],
    ['예약', p.reserve || '—'], ['가까운 역', p.sta || '—'],
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
    ${p.tips?.length ? `<div class="sec"><h3>💡 알아두면 좋은 것</h3><ul class="tips">${p.tips.map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>` : ''}
    ${p.booking ? `<div class="sec"><h3>📅 예약 방법</h3><div class="card"><p>${esc(p.booking.how || '')}</p>${p.booking.lang ? `<p class="note">언어: ${esc(p.booking.lang)}${p.booking.lead ? ' · ' + esc(p.booking.lead) : ''}</p>` : ''}${p.booking.url ? `<div class="links" style="margin-top:8px"><a href="${esc(p.booking.url)}" target="_blank" rel="noopener">예약 페이지 열기 ↗</a></div>` : ''}</div></div>` : ''}
    ${p.gear ? `<div class="sec"><h3>🎒 장비</h3><p style="margin:0;font-size:13.5px;color:var(--ink-2)">${esc(p.gear)}</p></div>` : ''}
    <div class="sec links"><a href="${gmapsSearch(p)}" target="_blank" rel="noopener">📍 구글맵에서 보기</a><a href="${gmapsDir(p)}" target="_blank" rel="noopener">🧭 여기로 길찾기</a>${p.nameJa && CAT[p.cat]?.g !== 'see' ? `<a href="https://tabelog.com/rstLst/?sw=${encodeURIComponent(p.nameJa)}" target="_blank" rel="noopener">⭐ 타베로그 리뷰</a>` : ''}</div>`;
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
    ${st.say ? `<div class="sec guide"><div class="face" aria-hidden="true">${crewDefs()[2].emoji}</div><div class="bubble"><b>${esc(crewDefs()[2].name)}</b> ${esc(st.say)}</div></div>` : ''}
    ${steps.length ? `<div class="sec"><h3>🧭 여기까지 가는 법</h3><ol class="steps">${steps.map(s => `<li><span class="n">${s.i}</span><span class="t">${s.t}${s.s ? `<small>${esc(s.s)}</small>` : ''}</span></li>`).join('')}</ol></div>` : ''}
    <div class="sec">${placeCore(p)}</div>
    ${p.cat === 'hotel' ? hotelHTML(p) : ''}
    ${allOpts.length ? `<div class="sec"><h3>🔁 근처 다른 선택지</h3>${allOpts.map(a => altRow(a, p)).join('')}${swapped ? `<button class="small-btn swap" data-unswap="1">원래 추천으로 되돌리기</button>` : ''}</div>` : ''}`;
}
function altRow(a, from) {
  const m = from ? dist(from, a) : 0;
  return `<button class="alt" data-place="${a.id}"><span class="e">${catOf(a).e}</span><span><span class="nm">${esc(a.nameKo)}</span><span class="ds" style="display:block">${esc(a.desc || '')}</span></span><span class="dist">${from ? `🚶 ${walkMin(m)}분` : ''}<br>${a.price ? priceText(a.price) : ''}</span></button>`;
}
function placeHTML(id, withBack) {
  const p = place(id); if (!p) return '';
  const st = curStop(), isAlt = (st.alts || []).includes(id) || id === st.p;
  const inPlan = C.days.some((d, di) => d.stops.some((s, si) => stopPlaceId(di, si) === id));
  return `${withBack ? `<button class="small-btn" data-back="1">◀ 지금 일정으로</button>` : ''}
    <div class="sec"><div class="stop-meta" style="margin-top:12px"><span class="kind">${catOf(p).e} ${esc(catOf(p).n)}</span>${p.area ? `<span>${esc(p.area)}</span>` : ''}</div><h2 class="stop-name" style="margin-top:4px">${esc(p.nameKo)}</h2></div>
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
        <button data-jump="${si}" aria-current="${si === S.stop}"><span class="tm">${st.t}</span><span class="em">${st.e || catOf(p).e}</span><span><span class="nm">${esc(st.label || p.nameKo)}</span><span class="sb" style="display:block"><span class="kind ${K.cls}" style="height:18px;font-size:11px">${esc(st.k)}</span> ${esc(p.area || '')}${closedOn(p, dd) ? ' <b class="closed-tag">휴무일!</b>' : (p.closed?.length ? ` · ${p.closed.map(x => DOW[x]).join('·')} 휴무` : '')}</span></span></button></li>`;
    }).join('')}</ol>
    ${d.note ? `<div class="sec card"><p>💡 ${esc(d.note)}</p></div>` : ''}`;
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
    ${list.length ? list.slice(0, 40).map(({ p, m, open }) => `<button class="alt" data-place="${p.id}"><span class="e">${catOf(p).e}</span><span><span class="nm">${esc(p.nameKo)}</span><span class="ds" style="display:block">${open === true ? '🟢 영업중 · ' : open === false ? '⚪ 영업 전/후 · ' : ''}${esc(p.desc || p.area || '')}</span></span><span class="dist">🚶 ${m > 2500 ? (m / 1000).toFixed(1) + 'km' : walkMin(m) + '분'}<br>${p.price ? priceText(p.price) : ''}</span></button>`).join('') : `<p class="note">조건에 맞는 곳이 없어요. 필터를 바꿔 보세요.</p>`}
    <p class="note" style="margin-top:12px">거리는 직선거리 기준 도보 추정이에요. 실제 길은 🧭 길찾기로 확인하세요.</p>`;
}
function tipsHTML() {
  const T = C.tips || {};
  const sec = (title, inner) => `<div class="sec"><h3>${title}</h3>${inner}</div>`;
  const ul = arr => `<div class="card"><ul>${arr.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  const checks = store.get('checks', {});
  return [
    installHTML(),
    T.flight ? sec('✈️ 항공편', `<div class="card"><h4>${esc(T.flight.title)}</h4><ul>${T.flight.items.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`) : '',
    sec('💰 총무 계산기', `<div class="card calc"><label for="calcYen">총액 (엔)<input id="calcYen" inputmode="numeric" value="${store.get('calcYen', 18000)}"></label><label for="calcN">인원<input id="calcN" inputmode="numeric" value="6"></label><label for="calcRate">100엔 = 원<input id="calcRate" inputmode="decimal" value="${(krwRate() * 100).toFixed(1)}"></label><span></span><output id="calcOut"></output></div>`),
    T.transit ? sec('🚃 교통카드 · 패스', ul(T.transit)) : '',
    sec('👥 6명 여행 꿀팁', ul(GROUP_TIPS)),
    sec('🗣️ 일본어 한마디 (화면 보여주기)', `<div class="card">${PHRASES.map((p, i) => `<div class="phrase"><span class="ko">${esc(p.ko)}</span><span class="jp">${esc(p.jp)}</span><span class="rd">${esc(p.rd)}</span><button class="small-btn" data-copy="${i}">복사</button></div>`).join('')}</div>`),
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
    if ((b = q('[data-place]'))) return openPlace(b.dataset.place);
    if ((b = q('[data-back]'))) { S.viewPlace = null; renderBody(); refreshMarkers(); world.setFollow(true); setFollowBtn(true); return; }
    if (busy && q('[data-swap],[data-unswap],[data-hotelpin],[data-hotelreset]')) { toast('이동이 끝나면 바꿀 수 있어요'); return; }
    if ((b = q('[data-swap]'))) { store.set(`swap:${C.id}:${S.day}:${S.stop}`, b.dataset.swap); S.viewPlace = null; toast('이 집으로 바꿨어요! 🔁'); showStop(); return; }
    if ((b = q('[data-unswap]'))) { store.set(`swap:${C.id}:${S.day}:${S.stop}`, null); showStop(); return; }
    if ((b = q('[data-filter]'))) { S.nearFilter = b.dataset.filter; renderBody(); return; }
    if ((b = q('[data-open]'))) { S.openNow = !S.openNow; renderBody(); return; }
    if ((b = q('[data-sethere]'))) { setHereMode(true); return; }
    if ((b = q('[data-clearhere]'))) { if (S.here?.gps) stopGPS(); S.here = null; refreshMarkers(); renderBody(); return; }
    if ((b = q('[data-gps]'))) { startGPS(); return; }
    if ((b = q('[data-gpsoff]'))) { stopGPS(); toast('GPS를 껐어요'); return; }
    if ((b = q('[data-install]'))) { const ev = installEvt; installEvt = null; ev?.prompt(); ev?.userChoice?.finally(() => renderBody()); return; }
    if ((b = q('[data-hotelpin]'))) { S.pinHotel = true; setHereMode(true); toast('지도에서 숙소 위치를 탭하세요 🏨'); return; }
    if ((b = q('[data-hotelreset]'))) { store.set('hotel:' + C.id, null); const p = C.places[hotelId()]; if (p?._orig) Object.assign(p, p._orig); toast('예시 위치로 되돌렸어요'); showStop(); return; }
    if ((b = q('[data-copy]'))) { const p = PHRASES[+b.dataset.copy]; navigator.clipboard?.writeText(p.jp).then(() => toast('복사했어요 📋'), () => toast(p.jp)); return; }
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
  GPS.fix = { lat, lng, acc: accuracy };
  setGpsBtn(true);
  const rid = regionAt(lat, lng);
  if (rid === 'none') {
    world.clearMe(); S.here = null;
    if (!GPS.warnedOut) { GPS.warnedOut = true; toast('📡 지금 위치는 이 지도 밖이에요. 일본에 도착하면 지도에 떠요!', 3800); }
    if (S.tab === 'near' && first) renderBody();
    return;
  }
  const pos = proj(rid, lat, lng);
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
    : ios ? `<p>사파리 아래쪽 <b>공유 버튼(□↑)</b> → <b>홈 화면에 추가</b>를 누르세요. 설치한 앱은 와이파이에서 한 번 열어 두세요 (이름표·숙소 설정은 앱에서 다시 입력).</p>`
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
    <span class="eyebrow">제주 → 일본 · 4박 5일 · 40대 6인</span>
    <h1 class="intro-title" id="introTitle">6인 <em>먹방</em>원정대</h1>
    <p class="lede">아침 밥부터 마지막 해장 라멘까지, 원정대가 3D 지도 위를 걸으며 맛집·이동법·술집을 안내해요. 프리다이빙 하루, 테니스 하루 포함.</p>
    <div class="city-pick">
      ${['osaka', 'tokyo'].map(id => { const m = CITY_META[id]; return `<button class="city-card" data-city="${id}" aria-pressed="${S.city === id}"><span class="nm">${m.emoji} ${m.name}</span><ul>${m.points.map(x => `<li>${esc(x)}</li>`).join('')}</ul></button>`; }).join('')}
    </div>
    <h3 style="font-family:var(--f-display);font-weight:400;font-size:17px;margin:18px 0 0">원정대 이름표</h3>
    <div class="crew">${defs.map((d, i) => `<label for="crew${i}"><span class="av" style="background:${d.shirt}">${d.emoji}</span><input id="crew${i}" data-crew="${i}" value="${esc(d.name)}" maxlength="8" aria-label="${d.role} 이름"></label>`).join('')}</div>
    <button class="btn primary intro-go" id="introGo">${first ? '✈️ 출발!' : '이대로 보기'}</button>
    <p class="fine">대장·총무·길잡이·주당·먹보·막내 — 이름을 바꿔 보세요. 저장은 이 폰에만 돼요. 첫날 비행기 착륙부터 보여줘요.</p>
  </div>`;
  el.hidden = false;
  el.querySelectorAll('[data-city]').forEach(b => b.onclick = () => { el.querySelectorAll('[data-city]').forEach(x => x.setAttribute('aria-pressed', 'false')); b.setAttribute('aria-pressed', 'true'); el.dataset.pick = b.dataset.city; });
  el.dataset.pick = S.city || 'osaka';
  el.querySelector(`[data-city="${el.dataset.pick}"]`).setAttribute('aria-pressed', 'true');
  el.querySelector('#introGo').onclick = async () => {
    S.crew = [...el.querySelectorAll('[data-crew]')].map(i => i.value.trim() || CREW_DEFAULT[+i.dataset.crew].role); store.set('crew', S.crew);
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
  if (!S.city) { $('#loading').hidden = true; openIntro(true); return; }
  try { await loadCity(S.city, false); } catch (e) { console.error(e); $('#loadingText').textContent = '불러오기 실패 — 새로고침 해주세요'; }
})();
