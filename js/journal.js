// Trip journal stored on this device only (IndexedDB): photo/memo entries with location, and the GPS trail.
const DB_NAME = 'mokbang6-journal', DB_VER = 1;
let dbPromise = null;

function openDB() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, DB_VER);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('entries')) d.createObjectStore('entries', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('blobs')) d.createObjectStore('blobs');
      if (!d.objectStoreNames.contains('track')) d.createObjectStore('track', { keyPath: 'id', autoIncrement: true });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => { dbPromise = null; reject(r.error); };
    r.onblocked = () => reject(new Error('journal database is blocked by another tab'));
  });
}
const done = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new Error('aborted')); });
const result = rq => new Promise((res, rej) => { rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); });

export async function listEntries() {
  const d = await openDB();
  const all = await result(d.transaction('entries').objectStore('entries').getAll());
  return all.sort((a, b) => a.t - b.t);
}
export async function saveEntry(entry, blobs = {}) {
  const d = await openDB();
  const t = d.transaction(['entries', 'blobs'], 'readwrite');
  t.objectStore('entries').put(entry);
  for (const [k, b] of Object.entries(blobs)) if (b) t.objectStore('blobs').put(b, `${entry.id}:${k}`);
  await done(t);
  return entry;
}
export async function deleteEntry(id) {
  const d = await openDB();
  const t = d.transaction(['entries', 'blobs'], 'readwrite');
  t.objectStore('entries').delete(id);
  t.objectStore('blobs').delete(`${id}:full`);
  t.objectStore('blobs').delete(`${id}:thumb`);
  t.objectStore('blobs').delete(`${id}:orig`);
  await done(t);
}
export async function getBlob(id, kind = 'full') {
  const d = await openDB();
  return result(d.transaction('blobs').objectStore('blobs').get(`${id}:${kind}`));
}
export async function addTrackPoint(p) {
  const d = await openDB();
  const t = d.transaction('track', 'readwrite');
  t.objectStore('track').add(p);
  await done(t);
}
export async function listTrack() {
  const d = await openDB();
  return result(d.transaction('track').objectStore('track').getAll());
}
export async function clearTrack() {
  const d = await openDB();
  const t = d.transaction('track', 'readwrite');
  t.objectStore('track').clear();
  await done(t);
}
export function newId() { return 'e' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36); }

// ---------- images ----------
function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 읽을 수 없어요')); };
    img.src = url;
  });
}
function toBlob(canvas, q) { return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('encode failed')), 'image/jpeg', q)); }
// Browsers apply the photo's EXIF orientation when drawing an <img>, so the result is upright.
export async function processImage(file) {
  const exif = await readExif(file).catch(() => null);
  const { img, url } = await loadImage(file);
  try {
    const W = img.naturalWidth, H = img.naturalHeight;
    const k = Math.min(1, 1600 / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const full = await toBlob(c, 0.82);
    const s = Math.min(W, H), T = 240, t = document.createElement('canvas'); t.width = t.height = T;
    t.getContext('2d').drawImage(img, (W - s) / 2, (H - s) / 2, s, s, 0, 0, T, T);
    const thumb = await toBlob(t, 0.78);
    return { full, thumb, w: c.width, h: c.height, exif };
  } finally { URL.revokeObjectURL(url); }
}

// ---------- minimal EXIF reader: GPS position + DateTimeOriginal from JPEG ----------
export async function readExif(file) {
  if (!file || !/jpe?g/i.test(file.type || file.name || '')) return null;
  const buf = await file.slice(0, 256 * 1024).arrayBuffer();
  const v = new DataView(buf);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xFFD8) return null;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off), len = v.getUint16(off + 2);
    if (marker === 0xFFE1 && v.getUint32(off + 4) === 0x45786966) return parseTiff(v, off + 10);
    if ((marker & 0xFF00) !== 0xFF00 || len < 2) return null;
    off += 2 + len;
  }
  return null;
}
function parseTiff(v, base) {
  if (base + 8 > v.byteLength) return null;
  const le = v.getUint16(base) === 0x4949;
  const u16 = o => v.getUint16(base + o, le), u32 = o => v.getUint32(base + o, le);
  const ifd = (o) => {
    const out = {}; if (base + o + 2 > v.byteLength) return out;
    const n = u16(o);
    for (let i = 0; i < n; i++) {
      const e = o + 2 + i * 12; if (base + e + 12 > v.byteLength) break;
      out[u16(e)] = { type: u16(e + 2), count: u32(e + 4), val: e + 8 };
    }
    return out;
  };
  const rationals = (t) => { const p = u32(t.val), r = []; for (let i = 0; i < t.count; i++) { const d = u32(p + i * 8 + 4); r.push(d ? u32(p + i * 8) / d : 0); } return r; };
  const ascii = (t) => { const p = t.count > 4 ? u32(t.val) : t.val; let s = ''; for (let i = 0; i < t.count - 1 && base + p + i < v.byteLength; i++) s += String.fromCharCode(v.getUint8(base + p + i)); return s; };
  const ref = (t) => String.fromCharCode(v.getUint8(base + t.val));
  const out = {};
  const i0 = ifd(u32(4));
  if (i0[0x8769]) { const ex = ifd(u32(i0[0x8769].val)); const dt = ex[0x9003] || ex[0x9004]; if (dt) out.date = ascii(dt); }
  if (!out.date && i0[0x0132]) out.date = ascii(i0[0x0132]);
  if (i0[0x8825]) {
    const g = ifd(u32(i0[0x8825].val));
    if (g[2] && g[4]) {
      const la = rationals(g[2]), lo = rationals(g[4]);
      let lat = la[0] + la[1] / 60 + la[2] / 3600, lng = lo[0] + lo[1] / 60 + lo[2] / 3600;
      if (g[1] && ref(g[1]) === 'S') lat = -lat;
      if (g[3] && ref(g[3]) === 'W') lng = -lng;
      if (isFinite(lat) && isFinite(lng) && (lat || lng)) { out.lat = lat; out.lng = lng; }
    }
  }
  if (out.date) { // "YYYY:MM:DD HH:MM:SS" in the camera's local time
    const m = out.date.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    out.time = m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : null;
  }
  return out;
}
