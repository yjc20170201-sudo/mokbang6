// Shared trip album stored in a private GitHub repo.
// The group leader creates a fine-grained token that can only read/write that one repo and pastes it into
// the app once; the app turns it into an invite code encrypted with a group passcode (PBKDF2 + AES-GCM).
// Friends open the invite link, type the passcode, and their phones sync photos through the GitHub API.
export const REPO = { owner: 'yjc20170201-sudo', name: 'mokbang6-photos', branch: 'main' };
let API = 'https://api.github.com';
try { const o = localStorage.getItem('mokbang6:shareApi'); if (o && /^(localhost|127\.0\.0\.1)$/.test(location.hostname)) API = JSON.parse(o); } catch { /* default API */ }

const te = new TextEncoder(), td = new TextDecoder();
const b64u = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));

async function keyFrom(pass, salt) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass.normalize('NFC').trim()), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 250000, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
export async function makeInvite(token, pass) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await keyFrom(pass, salt), te.encode(token)));
  const out = new Uint8Array(1 + 16 + 12 + ct.length); out[0] = 1; out.set(salt, 1); out.set(iv, 17); out.set(ct, 29);
  return b64u(out);
}
export async function openInvite(code, pass) { // throws when the passcode is wrong
  const raw = unb64u(code.trim());
  if (raw[0] !== 1 || raw.length < 40) throw new Error('bad-code');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: raw.slice(17, 29) }, await keyFrom(pass, raw.slice(1, 17)), raw.slice(29));
  return td.decode(pt);
}

// ---------- GitHub REST ----------
export class ShareClient {
  constructor(token) { this.token = token; }
  async req(path, { method = 'GET', body = null, raw = false, okStatus = [] } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(API + path, {
        method, cache: 'no-store',
        headers: { Authorization: 'Bearer ' + this.token, Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : null,
      });
      if (res.ok || okStatus.includes(res.status)) return res;
      if (res.status === 403 || res.status === 429) { // GitHub rate limits look like 403s: back off instead of calling it a permission problem
        const ra = +res.headers.get('retry-after') || 0, rem = res.headers.get('x-ratelimit-remaining'), reset = +res.headers.get('x-ratelimit-reset') || 0;
        const msg = (await res.clone().json().catch(() => ({}))).message || '';
        if (ra || rem === '0' || /rate limit/i.test(msg) || res.status === 429) {
          const err = new Error('github rate limit'); err.status = res.status; err.rateLimited = true;
          err.retryAt = ra ? Date.now() + ra * 1000 : (rem === '0' && reset) ? reset * 1000 : Date.now() + 60000;
          throw err;
        }
      }
      // 409: the branch moved under a concurrent commit; 5xx/429: GitHub hiccup — retry with backoff
      if ((res.status === 409 || res.status >= 500) && attempt < 4) { await new Promise(r => setTimeout(r, 600 * 2 ** attempt + Math.random() * 400)); continue; }
      const err = new Error(`github ${res.status}`); err.status = res.status;
      try { err.detail = (await res.json()).message; } catch { /* no body */ }
      throw err;
    }
  }
  base() { return `/repos/${REPO.owner}/${REPO.name}`; }
  async check() { // → true when the token can reach the album repo with write rights; classic (account-wide) tokens are refused
    const res = await this.req(this.base());
    if (res.headers.get('x-oauth-scopes')) return false;
    const r = await res.json();
    return !!(r.permissions?.push || r.permissions?.admin);
  }
  async tree() { // → Map(path → blob sha)
    const res = await this.req(`${this.base()}/git/trees/${REPO.branch}?recursive=1`, { okStatus: [409] });
    if (res.status === 409) return new Map(); // empty repository; a 404 (no access) throws instead of looking like "everything deleted"
    const j = await res.json();
    return new Map((j.tree || []).filter(t => t.type === 'blob').map(t => [t.path, t.sha]));
  }
  async put(path, data, { sha = null, message = 'photo' } = {}) { // data: Blob | string → new blob sha
    const b = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : te.encode(data);
    let bin = ''; for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    const content = btoa(bin);
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await this.req(`${this.base()}/contents/${path}`, { method: 'PUT', body: { message, content, branch: REPO.branch, ...(sha ? { sha } : {}) }, okStatus: [409, 422] });
      if (res.ok) return (await res.json()).content.sha;
      // 422 = the file exists but we sent no/old sha; 409 = sha mismatch or the branch moved under a concurrent commit
      const cur = await this.req(`${this.base()}/contents/${path}?ref=${REPO.branch}`, { okStatus: [404] });
      if (cur.ok) {
        const j = await cur.json();
        if (data instanceof Blob) return j.sha; // photos never change: an earlier upload already made it
        if (j.sha !== sha) { sha = j.sha; continue; }
      } else sha = null;
      await new Promise(r => setTimeout(r, 700 * 2 ** attempt + Math.random() * 500));
    }
    throw new Error('github put failed');
  }
  async get(path) { return (await this.req(`${this.base()}/contents/${path}?ref=${REPO.branch}`, { raw: true })).blob(); }
  async del(path, sha) { await this.req(`${this.base()}/contents/${path}`, { method: 'DELETE', body: { message: 'delete', sha, branch: REPO.branch }, okStatus: [404, 422] }); }
}
