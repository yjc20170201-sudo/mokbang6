// Builds one 3D map region (ground texture from OSM layers, sea/seabed, buildings, transit lines).
import * as THREE from 'three';

const PAL = {
  land: '#ebe5d6', park: '#bcdc98', wood: '#9ccb80', golf: '#c9e5a2', cem: '#d5dccb', farm: '#e2e5b3',
  sand: '#f3e2b0', apron: '#d5d7da', runway: '#7f858d', taxi: '#b7bcc2', rail: '#9d978d',
  road: ['#f6cf7c', '#f9dd98', '#ffffff', '#fbfaf5', '#f8f6f0'], casing: '#d9cfbd', water: '#6fb3de',
};
const ROAD_W = [30, 24, 17, 11, 7]; // meters (exaggerated for readability)

export const TOON_GRAD = (() => {
  const d = new Uint8Array([90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
export const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: TOON_GRAD, ...extra });

function mkCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function rand(seed) { let s = seed >>> 0 || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917), (s ^= s >>> 16) >>> 0) / 4294967296); }

export class Region {
  constructor(geo, cfg = {}, quality = {}) {
    this.geo = geo; this.cfg = cfg; this.q = quality;
    const [W, H] = geo.size; this.W = W; this.H = H;
    const S = quality.tex || 2048;
    this.scale = S / Math.max(W, H);
    this.cw = Math.round(W * this.scale); this.ch = Math.round(H * this.scale);
    this.group = new THREE.Group();
    this.depth = cfg.depth || 34;
    this.disposables = [];
    this.lines = {};
    this.prepareLines();
  }
  prepareLines() {
    for (const [id, L] of Object.entries(this.geo.lines || {})) {
      if (!L.st.length) continue;
      const pts = L.st.map(([x, y]) => new THREE.Vector3(x, 0, -y));
      let curve = null, cps = pts.slice();
      if (pts.length >= 2) {
        if (L.exit === 'end') { const a = pts[pts.length - 2], b = pts[pts.length - 1]; cps.push(b.clone().add(b.clone().sub(a).setLength(9000))); }
        if (L.exit === 'start') { const a = pts[1], b = pts[0]; cps.unshift(b.clone().add(b.clone().sub(a).setLength(9000))); }
        curve = new THREE.CatmullRomCurve3(cps, !!L.loop, 'centripetal', 0.5);
      }
      this.lines[id] = { ...L, pts, curve, cps };
    }
  }
  // lat/lng -> world (x east, z south). y = 0 ground.
  toWorld(lat, lng, y = 0) {
    const [lat0, lng0] = this.geo.center, [kx, ky] = this.geo.k;
    return new THREE.Vector3((lng - lng0) * kx, y, -(lat - lat0) * ky);
  }
  toLatLng(x, z) {
    const [lat0, lng0] = this.geo.center, [kx, ky] = this.geo.k;
    return [lat0 + (-z) / ky, lng0 + x / kx];
  }
  inBounds(x, z, pad = 0) { return Math.abs(x) <= this.W / 2 - pad && Math.abs(z) <= this.H / 2 - pad; }
  px(x, y) { return [(x + this.W / 2) * this.scale, (this.H / 2 - y) * this.scale]; } // geo y (north+) -> canvas

  pathOf(ctx, flat, close) {
    for (let i = 0; i < flat.length; i += 2) {
      const [a, b] = this.px(flat[i], flat[i + 1]);
      i ? ctx.lineTo(a, b) : ctx.moveTo(a, b);
    }
    if (close) ctx.closePath();
  }
  fillPolys(ctx, polys, style) {
    ctx.fillStyle = style;
    for (const rings of polys) { ctx.beginPath(); for (const r of rings) this.pathOf(ctx, r, true); ctx.fill('evenodd'); }
  }

  // ---------- ground texture ----------
  drawGround() {
    const { cw, ch, geo } = this;
    // 1. sea mask by flood fill bounded by coastline
    const wm = mkCanvas(cw, ch), w = wm.getContext('2d', { willReadFrequently: true });
    const sea = this.floodSea();
    if (sea) {
      const id = w.createImageData(cw, ch), d32 = new Uint32Array(id.data.buffer);
      for (let i = 0; i < sea.length; i++) if (sea[i]) d32[i] = 0xffffffff;
      w.putImageData(id, 0, 0);
    }
    w.fillStyle = '#fff'; w.strokeStyle = '#fff'; w.lineCap = w.lineJoin = 'round';
    for (const rings of geo.water) { w.beginPath(); for (const r of rings) this.pathOf(w, r, true); w.fill('evenodd'); }
    for (const r of geo.rivers) { w.lineWidth = Math.max(1.2, (r.w ? 26 : 9) * this.scale); w.beginPath(); this.pathOf(w, r.p); w.stroke(); }
    this.waterMask = w.getImageData(0, 0, cw, ch).data; // alpha>0 => water

    // 2. color map
    const cc = mkCanvas(cw, ch), c = cc.getContext('2d');
    c.fillStyle = PAL.land; c.fillRect(0, 0, cw, ch);
    // subtle paper noise for texture
    const rnd = rand(7);
    c.globalAlpha = 0.05;
    for (let i = 0; i < (cw * ch) / 900; i++) { c.fillStyle = rnd() > 0.5 ? '#fff' : '#b9ab90'; c.fillRect(rnd() * cw, rnd() * ch, 2 + rnd() * 5, 2 + rnd() * 5); }
    c.globalAlpha = 1;
    for (const [k, polys] of Object.entries(geo.green || {})) this.fillPolys(c, polys, PAL[k] || PAL.park);
    this.fillPolys(c, geo.sand || [], PAL.sand);
    // airport
    for (const a of geo.aero || []) {
      if (a.t === 'apron' || a.t === 'terminal') { c.fillStyle = a.t === 'terminal' ? '#c4c8cd' : PAL.apron; c.beginPath(); this.pathOf(c, a.p, true); c.fill(); }
    }
    for (const a of geo.aero || []) {
      if (a.t !== 'runway' && a.t !== 'taxiway') continue;
      c.strokeStyle = a.t === 'runway' ? PAL.runway : PAL.taxi; c.lineCap = 'butt';
      c.lineWidth = Math.max(1.5, (a.wd || (a.t === 'runway' ? 60 : 23)) * this.scale); c.beginPath(); this.pathOf(c, a.p); c.stroke();
      if (a.t === 'runway') { c.setLineDash([14 * this.scale * 4, 14 * this.scale * 4]); c.strokeStyle = '#f4f4f4'; c.lineWidth = Math.max(0.8, 2.5 * this.scale); c.beginPath(); this.pathOf(c, a.p); c.stroke(); c.setLineDash([]); }
    }
    // water on top of green (tint the mask)
    const tint = mkCanvas(cw, ch), t = tint.getContext('2d');
    t.drawImage(wm, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = PAL.water; t.fillRect(0, 0, cw, ch);
    c.drawImage(tint, 0, 0);
    // roads (casing then fill), minor first
    c.lineCap = c.lineJoin = 'round';
    const roads = geo.roads.slice().sort((a, b) => b.c - a.c);
    const emc = mkCanvas(cw, ch), e = emc.getContext('2d'); // night glow map
    e.fillStyle = '#000'; e.fillRect(0, 0, cw, ch); e.lineCap = e.lineJoin = 'round';
    for (const pass of [0, 1]) {
      for (const r of roads) {
        const wpx = Math.max(pass ? 0.9 : 1.6, ROAD_W[r.c] * this.scale * (pass ? 1 : 1.35));
        c.lineWidth = wpx; c.strokeStyle = pass ? PAL.road[r.c] : PAL.casing;
        c.beginPath(); this.pathOf(c, r.p); c.stroke();
        if (pass) { e.lineWidth = wpx * (r.c <= 2 ? 1.6 : 1.1); e.strokeStyle = r.c <= 1 ? '#ffb54a' : r.c === 2 ? '#e8963a' : '#9b6428'; e.beginPath(); this.pathOf(e, r.p); e.stroke(); }
      }
    }
    // rails
    c.strokeStyle = PAL.rail; c.lineWidth = Math.max(1, 5 * this.scale); c.setLineDash([Math.max(2, 10 * this.scale), Math.max(1.5, 5 * this.scale)]);
    for (const r of geo.rail) { c.beginPath(); this.pathOf(c, r); c.stroke(); }
    c.setLineDash([]);
    // cut water out (transparent -> alphaTest) so the seabed shows through
    c.globalCompositeOperation = 'destination-out'; c.drawImage(wm, 0, 0);
    // keep bridges visible above water
    c.globalCompositeOperation = 'source-over';
    for (const r of roads) { if (!r.b) continue; c.lineWidth = Math.max(1, ROAD_W[r.c] * this.scale); c.strokeStyle = PAL.road[r.c]; c.beginPath(); this.pathOf(c, r.p); c.stroke(); }

    // 3. block mask for building placement (roads, water, parks, rail, airport)
    const bm = mkCanvas(cw >> 1, ch >> 1), b = bm.getContext('2d', { willReadFrequently: true });
    b.scale(0.5, 0.5); b.fillStyle = '#000'; b.fillRect(0, 0, cw, ch);
    b.drawImage(wm, 0, 0);
    b.fillStyle = '#fff'; b.strokeStyle = '#fff'; b.lineCap = 'round';
    for (const polys of Object.values(geo.green || {})) for (const rings of polys) { b.beginPath(); for (const r of rings) this.pathOf(b, r, true); b.fill('evenodd'); }
    for (const rings of geo.sand || []) { b.beginPath(); for (const r of rings) this.pathOf(b, r, true); b.fill('evenodd'); }
    for (const a of geo.aero || []) { b.lineWidth = 60 * this.scale; b.beginPath(); this.pathOf(b, a.p, a.t === 'apron'); a.t === 'apron' || a.t === 'terminal' ? b.fill() : b.stroke(); }
    for (const r of geo.roads) { b.lineWidth = Math.max(2, ROAD_W[r.c] * this.scale * 1.7); b.beginPath(); this.pathOf(b, r.p); b.stroke(); }
    b.lineWidth = Math.max(2, 14 * this.scale);
    for (const r of geo.rail) { b.beginPath(); this.pathOf(b, r); b.stroke(); }
    this.blockW = bm.width; this.blockH = bm.height;
    this.block = b.getImageData(0, 0, bm.width, bm.height).data;

    // 4. seabed shading: blurred land/water -> shallow near shore
    const sb = mkCanvas(cw >> 3, ch >> 3), s = sb.getContext('2d');
    s.fillStyle = '#000'; s.fillRect(0, 0, sb.width, sb.height);
    s.drawImage(wm, 0, 0, sb.width, sb.height);
    const sb2 = mkCanvas(512, Math.round(512 * ch / cw)), s2 = sb2.getContext('2d');
    s2.imageSmoothingEnabled = true; s2.imageSmoothingQuality = 'high';
    const tiny = mkCanvas(Math.max(8, sb.width >> 2), Math.max(8, sb.height >> 2)); tiny.getContext('2d').drawImage(sb, 0, 0, tiny.width, tiny.height);
    s2.drawImage(tiny, 0, 0, sb2.width, sb2.height);
    const img = s2.getImageData(0, 0, sb2.width, sb2.height), dd = img.data;
    const shallow = [226, 212, 168], deep = [24, 78, 118];
    for (let i = 0; i < dd.length; i += 4) {
      const k = Math.pow(dd[i] / 255, 1.4); // 1 = deep water around
      dd[i] = shallow[0] + (deep[0] - shallow[0]) * k; dd[i + 1] = shallow[1] + (deep[1] - shallow[1]) * k; dd[i + 2] = shallow[2] + (deep[2] - shallow[2]) * k; dd[i + 3] = 255;
    }
    s2.putImageData(img, 0, 0);

    this.texColor = cc; this.texEmit = emc; this.texSeabed = sb2;
  }

  floodSea() {
    const { cw, ch, geo } = this;
    if (!geo.coast || !geo.coast.length) return null;
    const mc = mkCanvas(cw, ch), m = mc.getContext('2d', { willReadFrequently: true });
    m.fillStyle = '#fff'; m.fillRect(0, 0, cw, ch);
    m.strokeStyle = '#000'; m.lineWidth = 2.4; m.lineJoin = m.lineCap = 'round';
    for (const cst of geo.coast) { m.beginPath(); this.pathOf(m, cst); m.stroke(); }
    const px = m.getImageData(0, 0, cw, ch).data;
    const N = cw * ch, wall = new Uint8Array(N);
    for (let i = 0; i < N; i++) wall[i] = px[i * 4] < 160 ? 1 : 0;
    const label = new Int32Array(N);
    const comps = [0];
    const fill = (sx, sy, id) => {
      let count = 0; const st = [sx, sy];
      while (st.length) {
        const y = st.pop(), x0 = st.pop();
        let x = x0; const row = y * cw;
        while (x >= 0 && !wall[row + x] && !label[row + x]) x--;
        x++;
        let upOpen = false, dnOpen = false;
        while (x < cw && !wall[row + x] && !label[row + x]) {
          label[row + x] = id; count++;
          if (y > 0) { const o = !wall[row - cw + x] && !label[row - cw + x]; if (o && !upOpen) { st.push(x, y - 1); upOpen = true; } else if (!o) upOpen = false; }
          if (y < ch - 1) { const o = !wall[row + cw + x] && !label[row + cw + x]; if (o && !dnOpen) { st.push(x, y + 1); dnOpen = true; } else if (!o) dnOpen = false; }
          x++;
        }
      }
      return count;
    };
    // seeds: a few meters to the right of each coastline segment (OSM: water on the right)
    const off = 5 / this.scale;
    for (const cst of geo.coast) {
      const n = cst.length / 2;
      const step = Math.max(1, Math.floor(n / 12));
      for (let i = 0; i < n - 1; i += step) {
        const x1 = cst[i * 2], y1 = cst[i * 2 + 1], x2 = cst[i * 2 + 2], y2 = cst[i * 2 + 3];
        const len = Math.hypot(x2 - x1, y2 - y1); if (len < 1) continue;
        const mx = (x1 + x2) / 2 + (y2 - y1) / len * off, my = (y1 + y2) / 2 - (x2 - x1) / len * off;
        const [sx, sy] = this.px(mx, my).map(Math.round);
        if (sx < 0 || sy < 0 || sx >= cw || sy >= ch) continue;
        const k = sy * cw + sx;
        if (wall[k] || label[k]) continue;
        const id = comps.length; comps.push(fill(sx, sy, id));
      }
    }
    // reject components that contain stations (that's land) or that swallow most of the map
    const bad = new Set();
    for (const s of geo.stations || []) {
      const [sx, sy] = this.px(s.x, s.y).map(Math.round);
      if (sx >= 0 && sy >= 0 && sx < cw && sy < ch) { const l = label[sy * cw + sx]; if (l) bad.add(l); }
    }
    comps.forEach((cnt, id) => { if (id && cnt > N * 0.9) bad.add(id); });
    const sea = new Uint8Array(N);
    for (let i = 0; i < N; i++) { const l = label[i]; if (l && !bad.has(l)) sea[i] = 1; else if (wall[i]) { /* coastline pixels: water if neighbour is sea */ } }
    // thicken into the coastline stroke so no seam remains
    for (let y = 1; y < ch - 1; y++) for (let x = 1; x < cw - 1; x++) { const i = y * cw + x; if (wall[i] && (sea[i - 1] || sea[i + 1] || sea[i - cw] || sea[i + cw])) sea[i] = 2; }
    return sea;
  }

  isWater(x, z) {
    const [a, b] = this.px(x, -z); const i = (Math.floor(b) * this.cw + Math.floor(a)) * 4 + 3;
    return this.waterMask && this.waterMask[i] > 100;
  }
  isBlocked(x, y) { // geo coords
    const [a, b] = this.px(x, y); const i = (Math.floor(b / 2) * this.blockW + Math.floor(a / 2)) * 4;
    return this.block[i] > 90;
  }

  // ---------- meshes ----------
  build({ clear = [] } = {}) {
    this.drawGround();
    const { W, H } = this;
    const mkTex = (cv, srgb = true) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; this.disposables.push(t); return t; };
    this.groundMat = new THREE.MeshLambertMaterial({ map: mkTex(this.texColor), emissiveMap: mkTex(this.texEmit), emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0, alphaTest: 0.5 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.groundMat);
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; ground.name = 'ground';
    this.group.add(ground); this.ground = ground;

    // seabed + water surface
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: mkTex(this.texSeabed) }));
    bed.rotation.x = -Math.PI / 2; bed.position.y = -this.depth; this.group.add(bed);
    this.waterMat = new THREE.MeshPhongMaterial({ color: '#2f86c2', transparent: true, opacity: 0.62, shininess: 90, specular: new THREE.Color('#bfe3ff'), normalMap: waterNormals(), normalScale: new THREE.Vector2(0.6, 0.6), depthWrite: false });
    this.waterMat.normalMap.repeat.set(W / 900, H / 900);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(W, H), this.waterMat);
    water.rotation.x = -Math.PI / 2; water.position.y = -2.5; water.renderOrder = 2; this.group.add(water); this.water = water;

    // diorama skirt
    const soil = new THREE.MeshLambertMaterial({ color: '#8b6e4e' });
    const skirtH = this.depth + 30;
    for (const [w, x, z, ry] of [[W, 0, H / 2, 0], [W, 0, -H / 2, Math.PI], [H, W / 2, 0, Math.PI / 2], [H, -W / 2, 0, -Math.PI / 2]]) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, skirtH), soil);
      m.position.set(x, -skirtH / 2 + 0.5, z); m.rotation.y = ry; this.group.add(m);
    }
    const base = new THREE.Mesh(new THREE.PlaneGeometry(W, H), soil); base.rotation.x = Math.PI / 2; base.position.y = -skirtH; this.group.add(base);

    this.buildBuildings(clear);
    this.buildLines();
    return this.group;
  }

  buildBuildings(clear) {
    const cfg = this.cfg, q = this.q;
    const centers = (cfg.centers || []).map(c => ({ ...c, p: this.toWorld(c.lat, c.lng) }));
    if (!centers.length && !cfg.baseDensity) return;
    const grid = cfg.grid || 30, maxN = Math.round((q.buildings || 6000) * (cfg.buildingScale || 1));
    const rnd = rand(this.geo.id.length * 7919 + 13);
    // road segment hash for orientation
    const cell = 120, hash = new Map();
    for (const r of this.geo.roads) for (let i = 0; i + 3 < r.p.length; i += 2) {
      const x1 = r.p[i], y1 = r.p[i + 1], x2 = r.p[i + 2], y2 = r.p[i + 3];
      const k = Math.floor((x1 + x2) / 2 / cell) + ',' + Math.floor((y1 + y2) / 2 / cell);
      if (!hash.has(k)) hash.set(k, []); hash.get(k).push([x1, y1, x2, y2]);
    }
    const nearestAngle = (x, y) => {
      let best = 1e9, ang = 0; const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const [x1, y1, x2, y2] of hash.get((cx + i) + ',' + (cy + j)) || []) {
        const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1; let t = ((x - x1) * dx + (y - y1) * dy) / l2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x1 + t * dx - x, y1 + t * dy - y); if (d < best) { best = d; ang = Math.atan2(dy, dx); }
      }
      return best < 160 ? ang : null;
    };
    const clearHit = (x, y) => clear.some(c => c.seg
      ? distSeg(x, y, c.seg) < c.r
      : (x - c.x) ** 2 + (y - c.y) ** 2 < c.r * c.r);
    const items = [];
    const halfW = this.W / 2 - 40, halfH = this.H / 2 - 40;
    for (let gy = -halfH; gy < halfH; gy += grid) for (let gx = -halfW; gx < halfW; gx += grid) {
      const x = gx + (rnd() - 0.5) * grid * 0.5, y = gy + (rnd() - 0.5) * grid * 0.5;
      let dens = cfg.baseDensity || 0, hmax = cfg.baseHeight || 22;
      for (const c of centers) {
        const d = Math.hypot(x - c.p.x, y + c.p.z), f = Math.exp(-(d * d) / (c.r * c.r));
        if (f * (c.w || 1) > dens) { dens = f * (c.w || 1); hmax = Math.max(cfg.baseHeight || 22, c.h * f); }
      }
      if (dens < 0.05 || rnd() > dens) continue;
      if (this.isBlocked(x, y) || clearHit(x, y)) continue;
      const fw = grid * (0.45 + rnd() * 0.5), fd = grid * (0.45 + rnd() * 0.5);
      let h = 8 + Math.pow(rnd(), 2.2) * hmax;
      if (rnd() < 0.03 * dens) h *= 1.8;
      const ang = nearestAngle(x, y) ?? (cfg.gridAngle || 0);
      items.push([x, y, fw, fd, h, ang]);
    }
    // cap: keep taller/denser first when over budget
    if (items.length > maxN) { for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; } items.length = maxN; }
    if (!items.length) return;
    const geom = new THREE.BoxGeometry(1, 1, 1); geom.translate(0, 0.5, 0);
    const mat = buildingMaterial();
    this.buildingMat = mat;
    const mesh = new THREE.InstancedMesh(geom, mat, items.length);
    const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color();
    const roofs = cfg.palette || ['#f2efe8', '#e6e2d8', '#d9dde2', '#cfd6de', '#e9dccb', '#c9ced3', '#f5f1ea', '#dfe6ec', '#e4d2c3'];
    items.forEach(([x, y, fw, fd, h, ang], i) => {
      q4.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
      m4.compose(p.set(x, 0, -y), q4, s.set(fw, h, fd));
      mesh.setMatrixAt(i, m4);
      col.set(roofs[Math.floor(rnd() * roofs.length)]); mesh.setColorAt(i, col);
    });
    mesh.castShadow = !!q.shadows; mesh.receiveShadow = !!q.shadows;
    mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    mesh.frustumCulled = false; mesh.name = 'buildings';
    this.group.add(mesh);
    this.buildings = mesh;
    this.buildingCount = items.length;
  }

  // transit lines as colored ribbons with station dots
  buildLines() {
    const dotGeo = new THREE.CylinderGeometry(9, 9, 3, 16);
    let k = 0;
    for (const L of Object.values(this.lines)) {
      if (L.curve) this.group.add(ribbonMesh(L.curve, L.loop ? L.cps.length * 24 : L.cps.length * 20, 11, L.color, 3 + (k++ % 5) * 0.6));
      const dotMat = new THREE.MeshLambertMaterial({ color: '#ffffff', emissive: new THREE.Color(L.color), emissiveIntensity: 0.25 });
      for (const p of L.pts) { const d = new THREE.Mesh(dotGeo, dotMat); d.position.set(p.x, 4.5, p.z); this.group.add(d); }
    }
  }

  // path along a line between two stations (by Japanese or Korean name)
  linePath(lineId, from, to) {
    const L = this.lines[lineId]; if (!L) return null;
    const idx = n => L.st.findIndex(s => s[3] === n || s[2] === n);
    let a = idx(from), b = idx(to);
    if (a < 0 || b < 0) return null;
    const pts = L.pts;
    const seq = [];
    if (L.loop) {
      const n = pts.length, fwd = (b - a + n) % n, back = (a - b + n) % n;
      const dir = fwd <= back ? 1 : -1, steps = Math.min(fwd, back);
      for (let i = 0; i <= steps; i++) seq.push(pts[(a + dir * i + n) % n]);
    } else {
      const dir = b >= a ? 1 : -1;
      for (let i = a; dir > 0 ? i <= b : i >= b; i += dir) seq.push(pts[i]);
    }
    if (seq.length < 2) return seq.map(p => p.clone());
    const c = new THREE.CatmullRomCurve3(seq, false, 'centripetal', 0.5);
    return c.getSpacedPoints(Math.max(8, seq.length * 14));
  }
  // leave the map along a line from a station (for inter-region trips)
  exitPath(lineId, from) {
    const L = this.lines[lineId]; if (!L) return null;
    const i = L.st.findIndex(s => s[3] === from || s[2] === from);
    if (i < 0) return null;
    const pts = L.pts;
    let seq;
    if (L.exit === 'start') seq = pts.slice(0, i + 1).reverse();
    else seq = pts.slice(i);
    if (seq.length === 1) { const p = seq[0]; const dir = L.exit === 'north' ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(1, 0, 0); seq = [p, p.clone().add(dir.multiplyScalar(5000))]; }
    const a = seq[seq.length - 2], b = seq[seq.length - 1];
    seq = seq.concat([b.clone().add(b.clone().sub(a).setLength(6000))]);
    return new THREE.CatmullRomCurve3(seq, false, 'centripetal', 0.5).getSpacedPoints(seq.length * 14);
  }
  station(lineId, name) {
    const L = this.lines[lineId]; if (!L) return null;
    const s = L.st.find(s => s[3] === name || s[2] === name);
    return s ? new THREE.Vector3(s[0], 0, -s[1]) : null;
  }
  update(dt, t) {
    if (this.waterMat) { const o = this.waterMat.normalMap.offset; o.x = (t * 0.004) % 1; o.y = (t * 0.0025) % 1; }
  }
  dispose() {
    this.group.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach(m => { if (m.map && !this.disposables.includes(m.map)) m.map.dispose?.(); m.dispose(); }); } });
    this.disposables.forEach(t => t.dispose());
  }
}

function distSeg(x, y, [x1, y1, x2, y2]) {
  const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy || 1; let t = ((x - x1) * dx + (y - y1) * dy) / l2; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x1 + t * dx - x, y1 + t * dy - y);
}

// flat ribbon following a curve, lying on the ground
export function ribbonMesh(curve, segments, width, color, y = 3, region = null, opts = {}) {
  const pts = curve.getSpacedPoints(segments);
  const pos = [], uv = [], idx = [];
  let acc = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[Math.min(i + 1, pts.length - 1)], r = pts[Math.max(i - 1, 0)];
    const dir = q.clone().sub(r); dir.y = 0; dir.normalize();
    const n = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(width / 2);
    if (i) acc += p.distanceTo(pts[i - 1]);
    pos.push(p.x + n.x, y, p.z + n.z, p.x - n.x, y, p.z - n.z);
    uv.push(acc / (opts.dash || 60), 0, acc / (opts.dash || 60), 1);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const mat = opts.material || new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const m = new THREE.Mesh(g, mat); m.renderOrder = 3; m.userData.length = acc;
  return m;
}

let _waterNormals = null;
function waterNormals() {
  if (_waterNormals) return _waterNormals.clone();
  const S = 256, c = mkCanvas(S, S), x = c.getContext('2d'), img = x.createImageData(S, S), d = img.data;
  const hgt = (u, v) => Math.sin(u * 0.19) * 0.5 + Math.sin((u + v) * 0.11) * 0.7 + Math.sin(v * 0.23 + Math.sin(u * 0.05) * 2) * 0.6 + Math.sin((u - v) * 0.07) * 0.8;
  for (let v = 0; v < S; v++) for (let u = 0; u < S; u++) {
    const w = (a, b) => hgt(a * (2 * Math.PI) / S * 8, b * (2 * Math.PI) / S * 8);
    const dx = w(u + 1, v) - w(u - 1, v), dy = w(u, v + 1) - w(u, v - 1);
    const n = new THREE.Vector3(-dx, -dy, 2).normalize(), i = (v * S + u) * 4;
    d[i] = (n.x * 0.5 + 0.5) * 255; d[i + 1] = (n.y * 0.5 + 0.5) * 255; d[i + 2] = (n.z * 0.5 + 0.5) * 255; d[i + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  _waterNormals = new THREE.CanvasTexture(c); _waterNormals.wrapS = _waterNormals.wrapT = THREE.RepeatWrapping;
  return _waterNormals.clone();
}

// Lambert material with procedural windows that glow at night
export function buildingMaterial() {
  const mat = new THREE.MeshLambertMaterial({ color: '#ffffff' });
  mat.userData.uNight = { value: 0 };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = mat.userData.uNight;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos; varying vec3 vWNorm; varying float vSeed;')
      .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 wp4 = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          wp4 = instanceMatrix * wp4;
          vWNorm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
          vSeed = float(gl_InstanceID);
        #else
          vWNorm = normalize(mat3(modelMatrix) * objectNormal); vSeed = 0.0;
        #endif
        vWPos = (modelMatrix * wp4).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec3 vWPos; varying vec3 vWNorm; varying float vSeed;
        float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float side = 1.0 - step(0.5, abs(vWNorm.y));
        vec2 axis = normalize(vec2(-vWNorm.z, vWNorm.x) + 1e-5);
        vec2 wuv = vec2(dot(vWPos.xz, axis), vWPos.y);
        vec2 cell = wuv / vec2(5.5, 4.6);
        vec2 f = fract(cell);
        float win = side * step(0.22, f.x) * step(f.x, 0.78) * step(0.28, f.y) * step(f.y, 0.78) * step(3.0, vWPos.y);
        float lit = step(0.52, h21(floor(cell) + vSeed * 3.17));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.62, 0.7, 0.8), win * (1.0 - uNight * 0.6));
        diffuseColor.rgb *= mix(1.0, 1.07, 1.0 - side);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += win * lit * uNight * vec3(1.0, 0.78, 0.42) * 0.95;`);
  };
  return mat;
}
