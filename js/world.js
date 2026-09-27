// Scene, camera, lighting (time of day), markers, party movement and activity animations.
import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { Region, ribbonMesh, toon } from './map.js';
import { Member, makeTrain, makeTaxi, makePlane, makeBoat, makeBuoy } from './chars.js';
import { buildLandmark, LANDMARKS } from './landmarks.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// time-of-day keyframes: hour, sky, hemiSky, hemiGround, hemiI, sunColor, sunI, night
const SKY = [
  [0, '#0a1630', '#2a4577', '#0d1522', 0.75, '#a9bdff', 0.35, 1],
  [5, '#1f2c55', '#4a5c8f', '#141a26', 0.8, '#b7c2ff', 0.35, 0.85],
  [6.5, '#f1b384', '#ffd9b3', '#4a4038', 0.95, '#ffb47a', 1.3, 0.25],
  [9, '#a8d3f2', '#d9ecff', '#6d6452', 1.05, '#fff1d8', 2.3, 0],
  [13, '#9fcff3', '#e3f1ff', '#736a57', 1.1, '#ffffff', 2.6, 0],
  [16.5, '#b4d4ef', '#e7eefa', '#6d6150', 1.0, '#ffe3bd', 2.1, 0],
  [18, '#f5a27a', '#ffd6b8', '#5d5364', 1.0, '#ffa266', 1.2, 0.3],
  [19.4, '#46508f', '#8b8fd0', '#2a2c44', 0.95, '#c2b6ff', 0.55, 0.78],
  [21, '#0f1b38', '#2c4677', '#0e1422', 0.75, '#a9bdff', 0.35, 1],
  [24, '#0a1630', '#2a4577', '#0d1522', 0.75, '#a9bdff', 0.35, 1],
];
function skyAt(h) {
  h = ((h % 24) + 24) % 24;
  let i = SKY.findIndex(k => k[0] > h); if (i <= 0) i = 1;
  const a = SKY[i - 1], b = SKY[i], t = (h - a[0]) / (b[0] - a[0]);
  const c = (x, y) => new THREE.Color(x).lerp(new THREE.Color(y), t);
  return { sky: c(a[1], b[1]), hs: c(a[2], b[2]), hg: c(a[3], b[3]), hi: lerp(a[4], b[4], t), sc: c(a[5], b[5]), si: lerp(a[6], b[6], t), night: lerp(a[7], b[7], t) };
}

export class World {
  constructor(canvas, labelsEl, quality) {
    this.q = quality;
    this.canvas = canvas; this.labelsEl = labelsEl;
    const r = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality.aa, powerPreference: 'high-performance' });
    r.setPixelRatio(quality.pixelRatio);
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = !!quality.shadows; r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog('#a8d3f2', 3000, 14000);
    this.camera = new THREE.PerspectiveCamera(42, 1, 8, 90000);
    this.camera.position.set(0, 900, 900);
    const c = this.controls = new MapControls(this.camera, canvas);
    c.enableDamping = true; c.dampingFactor = 0.09; c.screenSpacePanning = false;
    c.minDistance = 90; c.maxDistance = 14000; c.maxPolarAngle = 1.32; c.minPolarAngle = 0.12;
    c.zoomSpeed = 1.1; c.rotateSpeed = 0.6;
    c.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.hemi = new THREE.HemisphereLight('#dfefff', '#6d6452', 1.0); this.scene.add(this.hemi);
    const sun = this.sun = new THREE.DirectionalLight('#ffffff', 2.4);
    sun.castShadow = !!quality.shadows;
    sun.shadow.mapSize.set(quality.shadowMap || 1024, quality.shadowMap || 1024);
    const sc = sun.shadow.camera; sc.left = sc.bottom = -900; sc.right = sc.top = 900; sc.near = 10; sc.far = 6000;
    sun.shadow.bias = -0.0008; sun.shadow.normalBias = 1.5;
    this.scene.add(sun); this.scene.add(sun.target);
    this.hour = 12; this.hourTarget = 12;
    this.follow = true;
    this.labels = new Set();
    this.members = [];
    this.party = new THREE.Group(); this.scene.add(this.party);
    this.fx = new THREE.Group(); this.scene.add(this.fx);
    this.markers = new THREE.Group(); this.scene.add(this.markers);
    this.routeGroup = new THREE.Group(); this.scene.add(this.routeGroup);
    this.activityGroup = new THREE.Group(); this.scene.add(this.activityGroup);
    this.clock = new THREE.Clock();
    this.animators = new Set();
    this.dashTex = dashTexture();
    this._raycaster = new THREE.Raycaster();
    this._down = null;
    canvas.addEventListener('pointerdown', e => { this._down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    canvas.addEventListener('pointerup', e => {
      if (!this._down) return; const d = Math.hypot(e.clientX - this._down.x, e.clientY - this._down.y);
      if (d < 6 && performance.now() - this._down.t < 450) this._tap(e);
      this._down = null;
    });
    c.addEventListener('start', () => { this._userMoving = true; });
    c.addEventListener('end', () => { this._userMoving = false; });
    c.addEventListener('change', () => { if (this._userMoving && this.follow) { this.follow = false; this.onFollowChange?.(false); } });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }
  resize() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  // ---------- region ----------
  async loadRegion(geo, cfg, { clear = [] } = {}) {
    if (this.region) { this.scene.remove(this.region.group); this.region.dispose(); this.region = null; }
    this.clearMarkers(); this.clearRoute(); this.clearActivity();
    for (const L of [...this.labels]) this.removeLabel(L);
    this.clearMe();
    const region = new Region(geo, cfg, this.q);
    this.region = region; // lines are ready, so callers can plan paths before the heavy build
    await sleep(16);
    if (this.region !== region) return null; // a newer load replaced this one
    region.build({ clear: typeof clear === 'function' ? clear() : clear });
    this.scene.add(region.group);
    this.landmarks = [];
    for (const lm of cfg.landmarks || []) {
      const g = buildLandmark(lm); if (!g) continue;
      const p = lm.far ? V(lm.far[0], 0, lm.far[1]) : region.toWorld(lm.lat, lm.lng);
      g.position.copy(p); region.group.add(g); this.landmarks.push({ spec: lm, g });
      if (lm.label) this.addLabel({ html: `<div class="bdg">${lm.label}</div>`, cls: 'lm', pos: p.clone().setY((lm.labelY || 120)), minDist: 0, maxDist: lm.maxDist || 5200 });
    }
    const maxD = Math.max(region.W, region.H) * 1.1;
    this.controls.maxDistance = maxD;
    this.scene.fog.far = maxD * 1.6; this.scene.fog.near = maxD * 0.35;
    return region;
  }

  // ---------- crew ----------
  setCrew(defs) {
    for (const m of this.members) this.party.remove(m.root);
    this.members = defs.map(d => { const m = new Member(d, 13); m.root.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.party.add(m.root); return m; });
  }
  get leader() { return this.members[0]; }
  partyCenter() { const c = V(); if (!this.members.length) return c; for (const m of this.members) c.add(m.root.position); return c.multiplyScalar(1 / this.members.length); }
  placeParty(pos, heading = 0) {
    this.members.forEach((m, i) => {
      const a = heading + Math.PI + (i - 2.5) * 0.35, r = 18 + (i % 2) * 14;
      m.root.position.set(pos.x + Math.sin(a) * r, 0, pos.z + Math.cos(a) * r);
      m.root.rotation.y = heading; m.root.visible = true; m.setMode('idle');
    });
  }
  setOutfit(o) { this.members.forEach(m => m.setOutfit(o)); }

  // ---------- time of day ----------
  setTime(hhmm, instant = false) {
    const [h, mi] = hhmm.split(':').map(Number); const v = h + mi / 60;
    this.hourTarget = v; if (instant) this.hour = v;
  }
  applySky(h) {
    const s = skyAt(h);
    this.scene.background = s.sky; this.scene.fog.color.copy(s.sky);
    this.hemi.color.copy(s.hs); this.hemi.groundColor.copy(s.hg); this.hemi.intensity = s.hi;
    this.sun.color.copy(s.sc); this.sun.intensity = s.si;
    const day = Math.max(0, Math.min(1, (h - 6) / 12));
    const az = lerp(-Math.PI * 0.55, Math.PI * 0.55, day), el = s.night > 0.6 ? 0.9 : Math.max(0.18, Math.sin(day * Math.PI) * 1.05);
    const tgt = this.controls.target;
    this.sun.position.set(tgt.x + Math.sin(az) * 2500, Math.sin(el) * 3000 + 300, tgt.z + Math.cos(az) * 1400);
    this.sun.target.position.copy(tgt);
    this.night = s.night;
    const R = this.region;
    if (R && R.groundMat) {
      R.groundMat.emissiveIntensity = s.night * 0.55;
      R.groundMat.color.setScalar(1 - s.night * 0.35);
      if (R.buildingMat) R.buildingMat.userData.uNight.value = s.night;
      R.waterMat.color.set(s.night > 0.5 ? '#123a63' : '#2f86c2');
    }
    for (const l of this.landmarks || []) for (const m of l.g.userData.nightMats) m.emissiveIntensity = m.userData.night * s.night;
    for (const m of this.members) m.setNight(s.night);
    this.markerMats?.forEach(m => m.emissiveIntensity = 0.3 + s.night * 0.9);
  }

  // ---------- labels (HTML pinned to 3D points) ----------
  addLabel({ html, cls = '', pos, obj = null, offsetY = 0, onClick = null, minDist = 0, maxDist = 1e9, ttl = 0 }) {
    const el = document.createElement('div'); el.className = 'lbl ' + cls; el.innerHTML = html;
    if (onClick) el.addEventListener('click', e => { e.stopPropagation(); onClick(); });
    this.labelsEl.appendChild(el);
    const L = { el, pos: pos ? pos.clone() : V(), obj, offsetY, minDist, maxDist, born: performance.now(), ttl };
    this.labels.add(L);
    return L;
  }
  removeLabel(L) { if (!L) return; L.el.remove(); this.labels.delete(L); }
  updateLabels() {
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight, cam = this.camera, v = V();
    const dist = cam.position.distanceTo(this.controls.target);
    const now = performance.now();
    for (const L of this.labels) {
      if (L.ttl && now - L.born > L.ttl) { this.removeLabel(L); continue; }
      if (L.obj) { L.obj.getWorldPosition(v); v.y += L.offsetY; } else v.copy(L.pos);
      v.project(cam);
      const vis = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.15 && Math.abs(v.y) < 1.15 && dist >= L.minDist && dist <= L.maxDist && L.el.dataset.hide !== '1';
      if (!vis) { if (!L.el.classList.contains('hidden')) L.el.classList.add('hidden'); continue; }
      L.el.classList.remove('hidden');
      L.el.style.left = ((v.x + 1) / 2 * w).toFixed(1) + 'px';
      L.el.style.top = ((1 - v.y) / 2 * h).toFixed(1) + 'px';
      L.el.style.zIndex = String(1000 - Math.round(v.z * 1000));
    }
  }
  pop(emoji, pos, n = 3) { // floating emoji particles
    for (let i = 0; i < n; i++) {
      const p = pos.clone().add(V((Math.random() - 0.5) * 50, 40 + Math.random() * 20, (Math.random() - 0.5) * 50));
      const L = this.addLabel({ html: `<div class="fx" style="font-size:${20 + Math.random() * 10}px;animation-delay:${i * 180}ms">${emoji}</div>`, pos: p, ttl: 2200 });
      L.el.style.pointerEvents = 'none';
    }
  }
  say(text, member = null, ms = 2600) {
    const m = member || this.members[Math.floor(Math.random() * this.members.length)];
    if (!m || !m.root.visible) return;
    const L = this.addLabel({ html: `<div class="bdg">${text}</div>`, cls: 'say', obj: m.root, offsetY: 42, ttl: ms });
    L.el.style.pointerEvents = 'none';
  }

  // ---------- markers ----------
  clearMarkers() {
    for (const L of [...this.labels]) if (L.kind === 'marker') this.removeLabel(L);
    this.markers.clear(); this.markerMats = [];
  }
  setMarkers(items) { // items: {pos, emoji, text, time, cls, onClick, color, big}
    this.clearMarkers();
    const stickGeo = new THREE.CylinderGeometry(1.6, 1.6, 1, 6); stickGeo.translate(0, 0.5, 0);
    const ringGeo = new THREE.RingGeometry(16, 22, 32);
    for (const it of items) {
      const color = new THREE.Color(it.color || '#e0442f');
      const m = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.3 }); this.markerMats.push(m);
      const h = it.big ? 70 : it.cls === 'altm' ? 26 : 46;
      const s = new THREE.Mesh(stickGeo, m); s.scale.y = h; s.position.copy(it.pos); this.markers.add(s);
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: it.big ? 0.9 : 0.55, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.copy(it.pos).setY(4); ring.scale.setScalar(it.big ? 1.6 : it.cls === 'altm' ? 0.6 : 1);
      if (it.big) ring.userData.pulse = true;
      this.markers.add(ring);
      const L = this.addLabel({ html: `<div class="bdg"><span class="e">${it.emoji}</span>${it.time ? `<span class="t">${it.time}</span>` : ''}<span>${esc(it.text)}</span></div>`, cls: it.cls || '', pos: it.pos.clone().setY(h + 4), onClick: it.onClick, maxDist: it.cls === 'altm' ? 2600 : 1e9 });
      L.kind = 'marker';
    }
  }

  // ---------- live GPS position ----------
  setMe(pos, acc = 30) {
    if (!pos) return this.clearMe();
    if (!this.me) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({ color: '#1a8fd6', transparent: true, opacity: 0.18, depthWrite: false }));
      disc.rotation.x = -Math.PI / 2; disc.renderOrder = 4;
      const dot = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 6, 24), new THREE.MeshBasicMaterial({ color: '#1a8fd6' }));
      const rim = new THREE.Mesh(new THREE.RingGeometry(9, 13, 32), new THREE.MeshBasicMaterial({ color: '#ffffff', depthWrite: false }));
      rim.rotation.x = -Math.PI / 2;
      const g = new THREE.Group(); g.add(disc, dot, rim); this.scene.add(g);
      const label = this.addLabel({ html: '<div class="bdg"><span class="e">📡</span><span>나 (GPS)</span></div>', cls: 'me', obj: g, offsetY: 40 });
      label.el.style.pointerEvents = 'none'; label.kind = 'me';
      this.me = { g, disc, label };
    }
    this.me.g.position.set(pos.x, 6, pos.z);
    this.me.disc.scale.setScalar(Math.max(20, Math.min(400, acc)));
    this.me.g.visible = true;
  }
  clearMe() { if (!this.me) return; this.scene.remove(this.me.g); this.me.g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); this.removeLabel(this.me.label); this.me = null; }

  // ---------- journal: photo pins + walked trail ----------
  setPhotoPins(items) { // items: {pos, thumb (url|null), emoji, onClick}
    for (const L of [...this.labels]) if (L.kind === 'photo') this.removeLabel(L);
    for (const it of items) {
      const inner = it.thumb ? `<img src="${it.thumb}" alt="" loading="lazy">` : `<span>${it.emoji || '📝'}</span>`;
      const L = this.addLabel({ html: `<div class="ph">${inner}</div>`, cls: 'photo', pos: it.pos.clone().setY(30), onClick: it.onClick, maxDist: 5000 });
      L.kind = 'photo';
    }
  }
  setTrack(segments) { // segments: arrays of Vector3 (already projected to this region)
    if (this.trackGroup) { this.trackGroup.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); }); this.scene.remove(this.trackGroup); }
    this.trackGroup = new THREE.Group(); this.scene.add(this.trackGroup);
    for (const seg of segments) {
      if (seg.length < 2) continue;
      const curve = new THREE.CatmullRomCurve3(seg.map(p => p.clone().setY(0)), false, 'centripetal', 0.2);
      const mat = new THREE.MeshBasicMaterial({ color: '#1a8fd6', map: this.dashTex, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -5 });
      const m = ribbonMesh(curve, Math.max(8, Math.round(curve.getLength() / 15)), 7, '#1a8fd6', 7, null, { material: mat, dash: 40 });
      this.trackGroup.add(m);
    }
  }

  // ---------- route ribbons ----------
  clearRoute() { this.routeGroup.children.forEach(o => { o.geometry.dispose(); o.material.dispose(); }); this.routeGroup.clear(); }
  addRoute(points, { color = '#e0442f', dashed = true, width = 10, done = false } = {}) {
    if (!points || points.length < 2) return;
    const curve = new THREE.CatmullRomCurve3(points.map(p => p.clone().setY(0)), false, 'centripetal', 0.3);
    const mat = new THREE.MeshBasicMaterial({ color, map: dashed ? this.dashTex : null, transparent: true, opacity: done ? 0.35 : 0.95, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    const mesh = ribbonMesh(curve, Math.max(12, Math.round(curve.getLength() / 20)), width, color, 6, null, { material: mat, dash: 70 });
    mesh.userData.dashed = dashed && !done;
    this.routeGroup.add(mesh);
  }

  // ---------- camera ----------
  focus(pos, dist = null, instant = false) {
    const c = this.controls, cam = this.camera;
    const off = cam.position.clone().sub(c.target);
    if (dist) off.setLength(dist);
    const to = pos.clone().setY(0);
    if (instant) { c.target.copy(to); cam.position.copy(to).add(off); c.update(); return; }
    this._fly = { from: c.target.clone(), to, offFrom: cam.position.clone().sub(c.target), offTo: off, t: 0, dur: 1.1 };
  }
  overview(points) {
    if (!points.length) return;
    const box = new THREE.Box3().setFromPoints(points); const c = box.getCenter(V()), size = box.getSize(V());
    const d = Math.max(700, Math.max(size.x, size.z) * 1.25);
    const off = V(0, d * 0.85, d * 0.62);
    this.follow = false; this.onFollowChange?.(false);
    this._fly = { from: this.controls.target.clone(), to: c.setY(0), offFrom: this.camera.position.clone().sub(this.controls.target), offTo: off, t: 0, dur: 1.2 };
  }
  setFollow(on) { this.follow = on; if (on) this.focus(this.partyCenter(), Math.min(this.camera.position.distanceTo(this.controls.target), 1100)); }

  // ---------- movement ----------
  // path-follow: leader walks along pts; others trail behind in a two-column formation
  async walk(pts, { speed = 260, mode = 'walk', minDur = 1.6, maxDur = 6.5 } = {}) {
    if (!pts || pts.length < 2) return;
    pts = pts.map(p => p.clone().setY(0));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2);
    const len = curve.getLength();
    const dur = Math.min(maxDur, Math.max(minDur, len / speed));
    const spacing = 26, total = len + spacing * 3;
    const members = this.members;
    members.forEach(m => { m.root.visible = true; m.setMode(mode); });
    const start = members.map(m => m.root.position.clone());
    await this.animate(dur, (t) => {
      const lead = ease(t) * total;
      members.forEach((m, i) => {
        const row = Math.floor(i / 2), side = i % 2 ? 1 : -1;
        const d = Math.max(0, Math.min(len, lead - row * spacing - spacing * 0.5 * (i % 2)));
        const u = d / len, p = curve.getPointAt(u), tan = curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
        const lat = V(-tan.z, 0, tan.x).multiplyScalar(side * 11);
        const target = p.add(lat);
        if (t < 0.12) target.lerp(start[i], 1 - t / 0.12);
        m.root.position.copy(target);
        m.root.rotation.y = Math.atan2(tan.x, tan.z);
      });
    });
    members.forEach(m => m.setMode('idle'));
  }
  async ride(pts, opts = {}) {
    const { vehicle = 'train', color = '#e5171f', speed = 700, minDur = 2.2, maxDur = 6, label = '' } = opts;
    if (!pts || pts.length < 2) return;
    pts = pts.map(p => p.clone().setY(0));
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.2);
    const len = curve.getLength(), dur = Math.min(maxDur, Math.max(minDur, len / speed));
    const vs = vehicle === 'taxi' ? Array.from({ length: Math.max(1, opts.count || 2) }, (_, i) => i % 2 ? makeTaxi('#2d4a2b', '#ffd54f') : makeTaxi()) : vehicle === 'boat' ? [makeBoat()] : vehicle === 'plane' ? [makePlane()] : [makeTrain(color, 3)];
    vs.forEach(v => { v.traverse(o => { if (o.isMesh) o.castShadow = true; }); this.fx.add(v); });
    // members hop in
    const c0 = curve.getPointAt(0);
    await this.animate(0.45, t => this.members.forEach(m => { m.root.position.lerp(c0, t * 0.25); m.root.scale.setScalar(13 * (1 - t)); }));
    this.members.forEach(m => { m.root.visible = false; m.root.scale.setScalar(13); });
    let tag = null;
    if (label) { tag = this.addLabel({ html: `<div class="bdg">${label}</div>`, cls: 'say', obj: vs[0], offsetY: vehicle === 'train' ? 60 : 40 }); tag.el.style.pointerEvents = 'none'; }
    const carLen = vs[0].userData.carLen ? vs[0].userData.carLen * vs[0].scale.x : 40;
    await this.animate(dur, t => {
      const e = ease(t);
      vs.forEach((v, k) => {
        if (v.userData.cars) {
          v.userData.cars.forEach((car, j) => {
            const u = Math.max(0, Math.min(1, e - (j * carLen) / len));
            const p = curve.getPointAt(u), tan = curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
            car.position.copy(p).divideScalar(v.scale.x); car.position.y = 0.5;
            car.rotation.y = Math.atan2(-tan.z, tan.x);
          });
        } else {
          const u = Math.max(0, Math.min(1, e - k * 0.03));
          const p = curve.getPointAt(u), tan = curve.getTangentAt(Math.min(0.999, Math.max(0.001, u)));
          v.position.copy(p).add(V(-tan.z, 0, tan.x).multiplyScalar(k ? 18 : -18));
          if (vehicle === 'boat') v.position.y = -3 + Math.sin(t * 20) * 1.5;
          v.rotation.y = Math.atan2(-tan.z, tan.x);
        }
      });
      this._rideFocus = vs[0].userData.cars ? vs[0].userData.cars[0].getWorldPosition(V()) : vs[0].position.clone();
    });
    this._rideFocus = null;
    this.removeLabel(tag);
    const end = curve.getPointAt(1);
    vs.forEach(v => { this.fx.remove(v); disposeTree(v); });
    this.members.forEach((m, i) => { m.root.visible = true; m.root.position.copy(end).add(V((i % 3 - 1) * 16, 0, (Math.floor(i / 3) - 0.5) * 16)); });
    await this.animate(0.3, t => this.members.forEach(m => m.root.scale.setScalar(13 * (0.3 + 0.7 * t))));
  }
  async departOffMap(pts, opts) { // board and leave the region (camera stays)
    await this.ride(pts, { ...opts, minDur: 2.2, maxDur: 3.2 });
    this.members.forEach(m => m.root.visible = false);
  }
  async planeLand(runwayA, runwayB, gate) {
    const plane = makePlane(); this.fx.add(plane);
    const dir = runwayB.clone().sub(runwayA).normalize();
    const start = runwayA.clone().sub(dir.clone().multiplyScalar(2400)).setY(700);
    const ang = Math.atan2(-dir.z, dir.x);
    plane.rotation.y = ang;
    this.members.forEach(m => m.root.visible = false);
    await this.animate(3.4, t => {
      const e = 1 - Math.pow(1 - t, 2);
      const p = t < 0.72 ? start.clone().lerp(runwayA, e / 0.9) : runwayA.clone().lerp(runwayB, (t - 0.72) / 0.28 * 0.55);
      if (t < 0.72) p.y = lerp(700, 12, Math.min(1, e / 0.9)); else p.y = 12;
      plane.position.copy(p); plane.rotation.z = t < 0.72 ? -0.06 : 0;
      this._rideFocus = p.clone().setY(0);
    });
    this._rideFocus = null;
    this.fx.remove(plane); disposeTree(plane);
    this.placeParty(gate, 0);
  }
  async planeTakeoff(runwayA, runwayB) {
    const plane = makePlane(); this.fx.add(plane);
    const dir = runwayB.clone().sub(runwayA).normalize();
    plane.rotation.y = Math.atan2(-dir.z, dir.x);
    this.members.forEach(m => m.root.visible = false);
    await this.animate(3.2, t => {
      const p = runwayA.clone().lerp(runwayB, Math.min(1, t * 1.3));
      p.add(dir.clone().multiplyScalar(Math.max(0, t - 0.6) * 3000));
      p.y = 12 + Math.max(0, t - 0.55) ** 2 * 2200;
      plane.position.copy(p); plane.rotation.z = t > 0.55 ? 0.12 : 0;
      this._rideFocus = p.clone().setY(0);
    });
    this._rideFocus = null;
    this.fx.remove(plane); disposeTree(plane);
  }

  // ---------- activities ----------
  clearActivity() {
    if (this._actStop) this._actStop();
    this._actStop = null;
    this.activityGroup.children.slice().forEach(o => { this.activityGroup.remove(o); disposeTree(o); });
    this.members.forEach(m => { m.root.visible = true; m.acc.mug.visible = m.def.acc === 'mug' && m.outfit === 'casual'; m.setMode('idle'); if (m.towel) m.towel.visible = false; });
  }
  gather(center, radius = 34, face = true) {
    this.members.forEach((m, i) => {
      const a = (i / this.members.length) * Math.PI * 2 + 0.3;
      m.root.position.set(center.x + Math.sin(a) * radius, 0, center.z + Math.cos(a) * radius);
      if (face) m.root.rotation.y = Math.atan2(center.x - m.root.position.x, center.z - m.root.position.z);
    });
  }
  activity(kind, pos, opts = {}) {
    this.clearActivity();
    const stops = [];
    const every = (ms, fn) => { const id = setInterval(fn, ms); stops.push(() => clearInterval(id)); };
    const later = (ms, fn) => { const id = setTimeout(fn, ms); stops.push(() => clearTimeout(id)); };
    this._actStop = () => stops.forEach(f => f());
    const lines = opts.lines || [];
    const talk = () => { if (lines.length) this.say(lines[Math.floor(Math.random() * lines.length)]); };
    const table = new THREE.Mesh(new THREE.CylinderGeometry(20, 20, 10, 20), toon('#8a5a3b')); table.position.copy(pos).setY(5);
    switch (kind) {
      case 'eat': {
        this.activityGroup.add(table); this.gather(pos, 36);
        this.members.forEach(m => m.setMode('eat'));
        later(400, talk); every(2600, () => this.pop(opts.emoji || '😋', pos, 2)); every(5200, talk);
        break;
      }
      case 'drink': {
        this.activityGroup.add(table); this.gather(pos, 36);
        const lan = new THREE.Mesh(new THREE.CapsuleGeometry(5, 6, 4, 10), toon('#ff6a3d', { emissive: new THREE.Color('#ff6a3d'), emissiveIntensity: 1 })); lan.position.copy(pos).setY(62); this.activityGroup.add(lan);
        this.members.forEach(m => { m.acc.mug.visible = true; m.setMode('drink'); });
        const cheers = () => { this.members.forEach(m => m.setMode('clink')); this.say(opts.toast || '건배~! 🍻', this.members[3]); this.pop('🍻', pos, 3); later(1400, () => this.members.forEach(m => m.setMode('drink'))); };
        later(500, cheers); every(7000, cheers); every(4100, talk);
        break;
      }
      case 'tennis': {
        this.setOutfit('tennis');
        const court = buildLandmark({ type: 'court' }); court.position.copy(pos); court.rotation.y = opts.rot || 0; this.activityGroup.add(court);
        const toW = (x, z) => V(x, 0, z).applyAxisAngle(V(0, 1, 0), court.rotation.y).add(pos);
        const spots = [[-35, -120], [35, -105], [-35, 110], [35, 125]];
        this.members.forEach((m, i) => {
          if (i < 4) { m.root.position.copy(toW(...spots[i])); m.root.rotation.y = court.rotation.y + (i < 2 ? 0 : Math.PI); m.setMode('tennis'); }
          else { m.root.position.copy(toW(95, -20 + (i - 4) * 40)); m.root.rotation.y = court.rotation.y - Math.PI / 2; m.setMode('cheer'); }
        });
        const ball = court.userData.ball; let dir = 1, t0 = performance.now(); const hitters = [[0, 1], [2, 3]];
        const anim = { update: () => {
          const T = 1300, t = ((performance.now() - t0) % T) / T;
          const from = dir > 0 ? -110 : 115, to = -from;
          ball.position.set(lerp(dir > 0 ? -20 : 20, dir > 0 ? 20 : -20, t), 12 + Math.sin(t * Math.PI) * 55, lerp(from, to, t));
          if (performance.now() - t0 >= T) { t0 = performance.now(); dir *= -1; const hs = hitters[dir > 0 ? 0 : 1]; this.members[hs[Math.random() > 0.5 ? 1 : 0]].t = 0; }
        } };
        this.animators.add(anim); stops.push(() => this.animators.delete(anim));
        every(4200, () => this.say(['나이스 샷!', '아웃 아니야?!', '무릎 조심해 형님', '듀스!', '서브 들어간다~'][Math.floor(Math.random() * 5)]));
        break;
      }
      case 'dive': {
        this.setOutfit('dive');
        const R = this.region;
        const spot = opts.water || findWater(R, pos) || pos.clone();
        const buoy = makeBuoy(); buoy.position.copy(spot).setY(-2); this.activityGroup.add(buoy);
        const boat = makeBoat(); boat.position.copy(spot).add(V(90, -3, 30)); boat.rotation.y = 0.6; this.activityGroup.add(boat);
        this.members.forEach((m, i) => { const a = i / 6 * Math.PI * 2; m.root.position.copy(spot).add(V(Math.sin(a) * 40, -6, Math.cos(a) * 40)); m.root.rotation.y = a + Math.PI; m.setMode('float'); });
        let k = 0;
        const diveOne = async () => {
          const m = this.members[k++ % this.members.length]; const home = m.root.position.clone(); const depth = -(R.depth - 6);
          m.setMode('swim'); m.body.rotation.x = Math.PI; this.say('덕다이브~ 🤿', m, 1500);
          const bubbles = setInterval(() => this.pop('🫧', m.root.position.clone().setY(-10), 1), 380);
          await this.animate(2.2, t => { m.root.position.y = lerp(-6, depth, ease(t)); m.root.rotation.y += 0.004; });
          this.pop(['🐠', '🐟', '🐙', '🐢'][k % 4], m.root.position.clone().setY(-5), 1);
          await this.animate(2.4, t => { m.root.position.y = lerp(depth, -6, ease(t)); });
          clearInterval(bubbles); m.root.position.copy(home); m.setMode('float');
          this.say(['후~ 개운하다!', '시야 미쳤다', '물 좋네!!', '한 번 더?'][k % 4], m, 1800);
        };
        later(600, diveOne); every(5600, diveOne);
        break;
      }
      case 'onsen': {
        const pool = new THREE.Mesh(new THREE.CylinderGeometry(70, 74, 6, 28), toon('#7cc6d8', { transparent: true, opacity: 0.85 })); pool.position.copy(pos).setY(3); this.activityGroup.add(pool);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(72, 7, 6, 28), toon('#8c8176')); rim.rotation.x = Math.PI / 2; rim.position.copy(pos).setY(6); this.activityGroup.add(rim);
        this.gather(pos, 42);
        this.members.forEach(m => { m.root.position.y = -12; m.setMode('sleep'); if (!m.towel) { m.towel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.14, 0.42), toon('#ffffff')); m.towel.position.y = 0.55; m.head.add(m.towel); } m.towel.visible = true; });
        every(1300, () => this.pop('♨️', pos, 1)); later(500, () => this.say('으어~ 살 것 같다 ♨️')); every(5000, talk);
        break;
      }
      case 'sleep': {
        this.gather(pos, 30); this.members.forEach(m => m.setMode('sleep'));
        every(1800, () => this.pop('💤', pos, 1));
        break;
      }
      case 'shop': {
        this.gather(pos, 40, true); this.members.forEach((m, i) => m.setMode(i % 2 ? 'wave' : 'idle'));
        later(400, talk); every(2600, () => this.pop('🛍️', pos, 1)); every(5000, talk);
        break;
      }
      case 'fly': { this.gather(pos, 34); this.members.forEach(m => m.setMode('wave')); later(300, talk); break; }
      default: { // sightseeing
        this.gather(pos, 44, false);
        this.members.forEach((m, i) => { m.root.rotation.y = Math.PI; m.setMode(i === 2 ? 'wave' : 'idle'); });
        later(400, talk); every(3200, () => this.pop('📸', pos, 1)); every(5200, talk);
      }
    }
  }

  // ---------- loop helpers ----------
  animate(dur, fn) {
    return new Promise(res => {
      const a = { t: 0, update: (dt) => { a.t += dt; const k = Math.min(1, a.t / dur); fn(k); if (k >= 1) { this.animators.delete(a); res(); } } };
      this.animators.add(a);
    });
  }
  _tap(e) {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this._raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(V(0, 1, 0), 0), hit = V();
    if (this._raycaster.ray.intersectPlane(plane, hit)) this.onMapTap?.(hit);
  }
  frame() {
    const dt = Math.min(0.05, this.clock.getDelta()), t = this.clock.elapsedTime;
    for (const a of [...this.animators]) a.update(dt);
    // camera fly / follow
    const c = this.controls;
    if (this._fly) {
      const f = this._fly; f.t += dt / f.dur; const k = ease(Math.min(1, f.t));
      c.target.lerpVectors(f.from, f.to, k);
      this.camera.position.copy(c.target).add(f.offFrom.clone().lerp(f.offTo, k));
      if (f.t >= 1) this._fly = null;
    } else if (this.follow && this.members.length) {
      const goal = this._rideFocus || this.partyCenter().setY(0);
      const delta = goal.sub(c.target).multiplyScalar(Math.min(1, dt * 3));
      c.target.add(delta); this.camera.position.add(delta);
    }
    c.update();
    // time of day easing
    const dh = ((this.hourTarget - this.hour + 36) % 24) - 12;
    this.hour = (this.hour + dh * Math.min(1, dt * 1.8) + 24) % 24;
    this.applySky(this.hour);
    // shadow camera follows view target
    if (this.sun.castShadow) { this.sun.shadow.camera.updateProjectionMatrix(); }
    for (const m of this.members) m.update(dt);
    if (this.region?.water) this.region.update(dt, t);
    for (const l of this.landmarks || []) { if (l.g.userData.spin) l.g.userData.spin.rotation.z += dt * 0.15; if (l.g.userData.legs) l.g.userData.legs.forEach((g, i) => g.rotation.z = Math.sin(t * 1.5 + i) * 0.15); }
    this.markers.children.forEach(o => { if (o.userData.pulse) { const s = 1.4 + Math.sin(t * 3) * 0.3; o.scale.setScalar(s); } });
    if (this.me) this.me.disc.material.opacity = 0.14 + Math.sin(t * 2.5) * 0.06;
    if (this.dashTex) this.dashTex.offset.x = (this.dashTex.offset.x - dt * 0.9) % 1;
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }
}

function findWater(R, pos) {
  if (!R) return null;
  for (let r = 60; r < 1600; r += 40) for (let a = 0; a < Math.PI * 2; a += Math.PI / 12) {
    const x = pos.x + Math.cos(a) * r, z = pos.z + Math.sin(a) * r;
    if (R.inBounds(x, z, 50) && R.isWater(x, z) && R.isWater(x + 60, z) && R.isWater(x - 60, z) && R.isWater(x, z + 60) && R.isWater(x, z - 60)) return V(x, 0, z);
  }
  return null;
}
function dashTexture() {
  const c = document.createElement('canvas'); c.width = 64; c.height = 8; const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, 38, 8);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
}
function disposeTree(o) { o.traverse(n => { if (n.geometry) n.geometry.dispose(); }); }
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
export { findWater };
