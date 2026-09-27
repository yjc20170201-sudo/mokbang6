// Chibi crew members + vehicles, built from primitives with toon shading.
import * as THREE from 'three';
import { toon } from './map.js';

const G = {
  head: new THREE.SphereGeometry(0.52, 22, 16),
  hair: new THREE.SphereGeometry(0.545, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.46),
  eye: new THREE.SphereGeometry(0.065, 10, 8),
  ear: new THREE.SphereGeometry(0.11, 10, 8),
  nose: new THREE.SphereGeometry(0.075, 10, 8),
  torso: new THREE.CapsuleGeometry(0.4, 0.42, 6, 16),
  arm: new THREE.CapsuleGeometry(0.12, 0.46, 4, 10),
  hand: new THREE.SphereGeometry(0.13, 10, 8),
  leg: new THREE.CapsuleGeometry(0.14, 0.36, 4, 10),
  shoe: new THREE.SphereGeometry(0.17, 12, 8),
  capTop: new THREE.SphereGeometry(0.56, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42),
  brim: new THREE.CylinderGeometry(0.34, 0.34, 0.05, 20, 1, false, -Math.PI / 2, Math.PI),
  lens: new THREE.TorusGeometry(0.13, 0.03, 6, 18),
  maskGlass: new THREE.BoxGeometry(0.62, 0.24, 0.12),
  strap: new THREE.TorusGeometry(0.54, 0.035, 6, 30),
  snorkel: new THREE.CylinderGeometry(0.04, 0.04, 0.75, 8),
  fin: new THREE.BoxGeometry(0.3, 0.05, 0.95),
  headband: new THREE.TorusGeometry(0.53, 0.06, 6, 30),
  racketHead: new THREE.TorusGeometry(0.26, 0.04, 6, 22),
  racketNet: new THREE.CircleGeometry(0.25, 18),
  stick: new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8),
  mug: new THREE.CylinderGeometry(0.13, 0.12, 0.3, 12),
  foam: new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
  pole: new THREE.CylinderGeometry(0.025, 0.025, 1.5, 6),
  flag: new THREE.PlaneGeometry(0.45, 0.3),
  pack: new THREE.BoxGeometry(0.5, 0.55, 0.28),
  blush: new THREE.CircleGeometry(0.09, 12),
  shadow: new THREE.CircleGeometry(0.7, 24),
};
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.22, depthWrite: false });
const M = {};
const mat = (c, extra) => (M[c + (extra ? JSON.stringify(extra) : '')] ||= toon(c, extra));

export const CREW_DEFAULT = [
  { id: 'boss',  role: '대장',   shirt: '#e0442f', pants: '#2c3542', hair: '#1f1b18', skin: '#f2c9a0', acc: 'cap',      cap: '#1f3a5f', emoji: '🧢' },
  { id: 'money', role: '총무',   shirt: '#16847f', pants: '#3b3f47', hair: '#2a2420', skin: '#eec39a', acc: 'glasses',  emoji: '💰' },
  { id: 'guide', role: '길잡이', shirt: '#f0a91f', pants: '#34404e', hair: '#231d19', skin: '#f0c49b', acc: 'flag',     emoji: '🚩' },
  { id: 'drink', role: '주당',   shirt: '#7b4c9e', pants: '#2a2f38', hair: '#3a2d25', skin: '#e9b98f', acc: 'mug',      emoji: '🍺' },
  { id: 'eat',   role: '먹보',   shirt: '#3a9a55', pants: '#3d3a36', hair: '#15130f', skin: '#f3cba5', acc: 'belly',    emoji: '🍙' },
  { id: 'young', role: '막내',   shirt: '#3b82c4', pants: '#2f3b4a', hair: '#1b1714', skin: '#f5cfa9', acc: 'backpack', emoji: '🎒' },
  { id: 'photo', role: '찍사',   shirt: '#d9486f', pants: '#2f3440', hair: '#241e1a', skin: '#f1c8a0', acc: 'none',     emoji: '📷' },
  { id: 'fixer', role: '해결사', shirt: '#5a6b7c', pants: '#2a2f36', hair: '#1c1815', skin: '#eab893', acc: 'cap',      cap: '#e0442f', emoji: '🔧' },
];

export class Member {
  constructor(def, scale = 12) {
    this.def = def;
    this.root = new THREE.Group();
    this.root.scale.setScalar(scale);
    this.body = new THREE.Group(); this.root.add(this.body);
    const skin = mat(def.skin), shirt = mat(def.shirt), pants = mat(def.pants), hair = mat(def.hair), dark = mat('#1a1a1a');
    this.mats = { shirt, pants };
    const sh = new THREE.Mesh(G.shadow, shadowMat); sh.rotation.x = -Math.PI / 2; sh.position.y = 0.02; this.root.add(sh); this.shadow = sh;

    const torso = new THREE.Mesh(G.torso, shirt); torso.position.y = 1.02; this.body.add(torso); this.torso = torso;
    if (def.acc === 'belly') torso.scale.set(1.28, 1, 1.3);
    // head
    const head = new THREE.Group(); head.position.y = 1.78; this.body.add(head); this.head = head;
    head.add(new THREE.Mesh(G.head, skin));
    const hairM = new THREE.Mesh(G.hair, hair); hairM.rotation.x = -0.28; hairM.position.y = 0.02; head.add(hairM); this.hair = hairM;
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(G.eye, dark); e.position.set(0.17 * s, 0.02, 0.47); head.add(e);
      const ear = new THREE.Mesh(G.ear, skin); ear.position.set(0.52 * s, 0, 0); head.add(ear);
      const b = new THREE.Mesh(G.blush, mat('#ff8f86', { transparent: true, opacity: 0 })); b.position.set(0.3 * s, -0.12, 0.45); b.rotation.y = 0.5 * s; head.add(b); (this.blush ||= []).push(b);
    }
    const nose = new THREE.Mesh(G.nose, mat(shade(def.skin, -0.08))); nose.position.set(0, -0.08, 0.52); head.add(nose);
    // limbs
    this.arms = []; this.legs = [];
    for (const s of [-1, 1]) {
      const a = new THREE.Group(); a.position.set(0.5 * s, 1.36, 0); this.body.add(a);
      const am = new THREE.Mesh(G.arm, shirt); am.position.y = -0.32; a.add(am);
      const hd = new THREE.Mesh(G.hand, skin); hd.position.y = -0.66; a.add(hd);
      a.rotation.z = 0.18 * s; this.arms.push(a);
      const l = new THREE.Group(); l.position.set(0.2 * s, 0.62, 0); this.body.add(l);
      const lm = new THREE.Mesh(G.leg, pants); lm.position.y = -0.27; l.add(lm);
      const shoe = new THREE.Mesh(G.shoe, mat('#f4f4f4')); shoe.scale.set(1, 0.6, 1.35); shoe.position.set(0, -0.56, 0.06); l.add(shoe);
      this.legs.push(l);
    }
    // accessories
    this.acc = {};
    const addTo = (parent, key, obj) => { parent.add(obj); this.acc[key] = obj; return obj; };
    if (def.acc === 'cap') {
      const g = new THREE.Group(); g.add(new THREE.Mesh(G.capTop, mat(def.cap)));
      const br = new THREE.Mesh(G.brim, mat(def.cap)); br.position.set(0, 0.06, 0.38); br.rotation.x = 0.12; g.add(br);
      g.position.y = 0.06; g.rotation.x = -0.12; addTo(head, 'cap', g); hairM.visible = false;
    }
    if (def.acc === 'glasses') {
      const g = new THREE.Group();
      for (const s of [-1, 1]) { const l = new THREE.Mesh(G.lens, dark); l.position.set(0.18 * s, 0.03, 0.5); g.add(l); }
      addTo(head, 'glasses', g);
    }
    if (def.acc === 'flag') {
      const g = new THREE.Group(); const p = new THREE.Mesh(G.pole, mat('#8a8f96')); p.position.y = 0.6; g.add(p);
      const f = new THREE.Mesh(G.flag, mat('#e0442f', { side: THREE.DoubleSide })); f.position.set(0.23, 1.2, 0); g.add(f);
      g.position.set(0, -0.7, 0.05); addTo(this.arms[1], 'flag', g);
    }
    if (def.acc === 'backpack') { const b = new THREE.Mesh(G.pack, mat('#e8a33b')); b.position.set(0, 1.08, -0.42); addTo(this.body, 'pack', b); }
    // mug (all members get one for bars; the drinker always carries his)
    const mug = new THREE.Group(); mug.add(new THREE.Mesh(G.mug, mat('#f3b23a', { transparent: true, opacity: 0.92 })));
    const foam = new THREE.Mesh(G.foam, mat('#ffffff')); foam.position.y = 0.14; mug.add(foam);
    mug.position.set(0, -0.72, 0.12); addTo(this.arms[1], 'mug', mug); mug.visible = def.acc === 'mug';
    // dive gear
    const mask = new THREE.Group();
    const glass = new THREE.Mesh(G.maskGlass, mat('#3ab7d8', { transparent: true, opacity: 0.85 })); glass.position.set(0, 0.05, 0.5); mask.add(glass);
    const strap = new THREE.Mesh(G.strap, dark); strap.rotation.x = Math.PI / 2; strap.position.y = 0.05; mask.add(strap);
    const sn = new THREE.Mesh(G.snorkel, mat('#f7d23e')); sn.position.set(0.5, 0.35, 0.1); mask.add(sn);
    addTo(head, 'mask', mask); mask.visible = false;
    this.fins = this.legs.map(l => { const f = new THREE.Mesh(G.fin, mat('#1c1f24')); f.position.set(0, -0.6, 0.5); l.add(f); f.visible = false; return f; });
    // tennis gear
    const band = new THREE.Mesh(G.headband, mat('#ffffff')); band.rotation.x = Math.PI / 2 - 0.15; band.position.y = 0.2; addTo(head, 'band', band); band.visible = false;
    const racket = new THREE.Group();
    const rh = new THREE.Mesh(G.racketHead, mat('#e0442f')); rh.position.y = 0.55; racket.add(rh);
    const rn = new THREE.Mesh(G.racketNet, mat('#f7f7f7', { transparent: true, opacity: 0.55, side: THREE.DoubleSide })); rn.position.y = 0.55; racket.add(rn);
    const st = new THREE.Mesh(G.stick, mat('#2b2b2b')); st.position.y = 0.05; racket.add(st);
    racket.position.set(0, -0.72, 0.1); racket.rotation.x = -0.3; addTo(this.arms[1], 'racket', racket); racket.visible = false;

    this.phase = Math.random() * 6;
    this.mode = 'idle';
    this.t = 0;
    this.outfit = 'casual';
  }
  setOutfit(o) {
    if (o === this.outfit) return; this.outfit = o;
    const d = this.def;
    const dive = o === 'dive', tennis = o === 'tennis';
    this.acc.mask.visible = dive; this.fins.forEach(f => f.visible = dive);
    this.acc.band.visible = tennis; this.acc.racket.visible = tennis;
    if (this.acc.flag) this.acc.flag.visible = !dive && !tennis;
    if (this.acc.pack) this.acc.pack.visible = !dive;
    this.torso.material = dive ? mat('#20262e') : tennis ? mat('#fbfbf6') : this.mats.shirt;
    this.torso.children.length || null;
    this.arms.forEach(a => a.children[0].material = dive ? mat('#20262e') : tennis ? mat(d.shirt) : this.mats.shirt);
    this.legs.forEach(l => l.children[0].material = dive ? mat('#20262e') : tennis ? mat('#f2f2ee') : this.mats.pants);
    if (dive && !this.stripe) { this.stripe = new THREE.Mesh(new THREE.TorusGeometry(0.41, 0.045, 6, 24), mat(d.shirt)); this.stripe.rotation.x = Math.PI / 2; this.stripe.position.y = 1.18; this.body.add(this.stripe); }
    if (this.stripe) this.stripe.visible = dive;
    this.acc.mug.visible = this.def.acc === 'mug' && !dive && !tennis;
  }
  setMode(m) { if (this.mode !== m) { this.mode = m; this.t = 0; } }
  setNight(k) { this.blush.forEach(b => b.material.opacity = k * 0.55); }
  update(dt) {
    this.t += dt;
    const t = this.t, [la, ra] = this.arms, [ll, rl] = this.legs;
    let bob = 0, lean = 0, bodyY = 0, ax = [0, 0], az = [0.18, -0.18], lx = [0, 0], bodyRotX = 0, headTilt = 0;
    switch (this.mode) {
      case 'walk': case 'run': {
        const sp = this.mode === 'run' ? 13 : 9; this.phase += dt * sp;
        const s = Math.sin(this.phase);
        lx = [s * 0.7, -s * 0.7]; ax = [-s * 0.6, s * 0.6]; bob = Math.abs(Math.cos(this.phase)) * 0.09; lean = 0.08;
        break;
      }
      case 'cheer': {
        const s = Math.sin(t * 7); bob = Math.max(0, s) * 0.35; ax = [-2.7, -2.7]; az = [0.35 + s * 0.15, -0.35 - s * 0.15];
        break;
      }
      case 'drink': {
        const cyc = (t + this.phase) % 3.2; const up = cyc < 1.1 ? Math.sin(cyc / 1.1 * Math.PI) : 0;
        ax = [-0.2, -0.9 - up * 1.3]; az = [0.25, -0.1]; headTilt = -up * 0.35; bob = Math.sin(t * 2.2) * 0.02;
        break;
      }
      case 'clink': { const s = Math.min(1, t * 2); ax = [-0.2, -2.3 * s]; az = [0.25, 0.25 * s]; bob = s > 0.95 ? Math.abs(Math.sin(t * 9)) * 0.05 : 0; break; }
      case 'eat': {
        const cyc = (t + this.phase) % 1.2; const up = Math.sin(cyc / 1.2 * Math.PI);
        ax = [-0.9, -1.2 - up * 0.9]; az = [0.1, -0.1]; headTilt = 0.1 + up * 0.08; bob = Math.sin(t * 5) * 0.015;
        break;
      }
      case 'tennis': {
        const cyc = (t + this.phase) % 2.4; const sw = cyc < 0.5 ? Math.sin(cyc / 0.5 * Math.PI) : 0;
        ax = [-0.4, -0.5 - sw * 1.6]; az = [0.3, -0.9 + sw * 1.4]; lean = 0.15; bob = Math.abs(Math.sin(t * 6)) * 0.08; lx = [0.25, -0.25];
        this.body.rotation.y = -sw * 1.1;
        break;
      }
      case 'swim': {
        this.phase += dt * 8; const s = Math.sin(this.phase);
        bodyRotX = Math.PI / 2 * 0.95; lx = [s * 0.5, -s * 0.5]; ax = [-3.0, -3.0]; az = [0.15, -0.15]; bodyY = 0.9;
        break;
      }
      case 'float': { bodyRotX = 0.25; bob = Math.sin(t * 1.8) * 0.06; ax = [-0.6 + Math.sin(t * 2) * 0.3, -0.6 - Math.sin(t * 2) * 0.3]; az = [0.9, -0.9]; lx = [Math.sin(t * 3) * 0.3, -Math.sin(t * 3) * 0.3]; break; }
      case 'wave': { ax = [0, -2.6]; az = [0.2, -0.4 + Math.sin(t * 8) * 0.35]; bob = Math.sin(t * 2) * 0.02; break; }
      case 'sleep': { bodyRotX = 0; headTilt = 0.5; bob = Math.sin(t * 1.2) * 0.02; break; }
      default: { bob = Math.sin(t * 2 + this.phase) * 0.025; ax = [Math.sin(t * 1.3 + this.phase) * 0.05, -Math.sin(t * 1.3 + this.phase) * 0.05]; }
    }
    if (this.mode !== 'tennis') this.body.rotation.y *= 0.85;
    const k = Math.min(1, dt * 12);
    la.rotation.x += (ax[0] - la.rotation.x) * k; ra.rotation.x += (ax[1] - ra.rotation.x) * k;
    la.rotation.z += (az[0] - la.rotation.z) * k; ra.rotation.z += (az[1] - ra.rotation.z) * k;
    ll.rotation.x += (lx[0] - ll.rotation.x) * k; rl.rotation.x += (lx[1] - rl.rotation.x) * k;
    this.body.position.y += (bob + bodyY - this.body.position.y) * Math.min(1, dt * 18);
    this.body.rotation.x += ((bodyRotX || lean) - this.body.rotation.x) * k;
    this.head.rotation.x += (headTilt - this.head.rotation.x) * k;
    this.shadow.material.opacity = 0.22;
  }
}

function shade(hex, amt) { const c = new THREE.Color(hex); c.offsetHSL(0, 0, amt); return '#' + c.getHexString(); }

// ---------- vehicles ----------
export function makeTrain(color = '#e5171f', cars = 3) {
  const g = new THREE.Group();
  const body = toon('#f4f5f2'), stripe = toon(color), win = toon('#29445e'), dark = toon('#2a2d31');
  const carGeo = new THREE.BoxGeometry(12, 4.2, 3.4), stripeGeo = new THREE.BoxGeometry(12.04, 0.7, 3.44), winGeo = new THREE.BoxGeometry(10.5, 1.2, 3.46), noseGeo = new THREE.CapsuleGeometry(1.7, 1.2, 6, 12);
  const list = [];
  for (let i = 0; i < cars; i++) {
    const c = new THREE.Group();
    const b = new THREE.Mesh(carGeo, body); b.position.y = 2.6; c.add(b);
    const s = new THREE.Mesh(stripeGeo, stripe); s.position.y = 1.4; c.add(s);
    const w = new THREE.Mesh(winGeo, win); w.position.y = 3.2; c.add(w);
    const u = new THREE.Mesh(new THREE.BoxGeometry(11, 0.6, 3), dark); u.position.y = 0.4; c.add(u);
    if (i === 0) { const n = new THREE.Mesh(noseGeo, stripe); n.rotation.z = Math.PI / 2; n.scale.set(1, 1, 1); n.position.set(6.2, 2.4, 0); c.add(n); }
    g.add(c); list.push(c);
  }
  g.userData.cars = list; g.userData.carLen = 12.6;
  g.scale.setScalar(5.5);
  return g;
}
export function makeTaxi(color = '#1c2b3a', top = '#f7c948') {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.BoxGeometry(4.6, 1.1, 1.9), toon(color)); b.position.y = 0.9; g.add(b);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.85, 1.75), toon('#cfe3f1')); cab.position.set(-0.2, 1.85, 0); g.add(cab);
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.3, 0.3), toon(top, { emissive: new THREE.Color(top), emissiveIntensity: 0.4 })); lamp.position.set(-0.2, 2.42, 0); g.add(lamp);
  const wg = new THREE.CylinderGeometry(0.42, 0.42, 0.3, 14), wm = toon('#1b1b1b');
  for (const [x, z] of [[1.5, 0.95], [1.5, -0.95], [-1.5, 0.95], [-1.5, -0.95]]) { const w = new THREE.Mesh(wg, wm); w.rotation.x = Math.PI / 2; w.position.set(x, 0.42, z); g.add(w); }
  g.scale.setScalar(6.5);
  return g;
}
export function makePlane() {
  const g = new THREE.Group();
  const white = toon('#f7f8fa'), blue = toon('#1f3a5f'), red = toon('#e0442f');
  const fus = new THREE.Mesh(new THREE.CapsuleGeometry(1.3, 11, 8, 16), white); fus.rotation.z = Math.PI / 2; g.add(fus);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.25, 15), white); wing.position.set(0.5, -0.4, 0); g.add(wing);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(2.2, 3, 0.25), red); tail.position.set(-6.3, 1.6, 0); g.add(tail);
  const stab = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 5.5), white); stab.position.set(-6.2, 0.3, 0); g.add(stab);
  const stripe = new THREE.Mesh(new THREE.CapsuleGeometry(1.32, 10.6, 8, 16, 1), blue); stripe.rotation.z = Math.PI / 2; stripe.scale.set(1, 1, 0.25); stripe.position.y = -0.2; g.add(stripe);
  for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.5, 2, 12), blue); e.rotation.z = Math.PI / 2; e.position.set(1.4, -1.0, 3.6 * s); g.add(e); }
  g.scale.setScalar(9);
  return g;
}
export function makeBoat() {
  const g = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.BoxGeometry(6, 1.2, 2.4), toon('#f4f4f0')); hull.position.y = 0.3; g.add(hull);
  const bow = new THREE.Mesh(new THREE.ConeGeometry(1.2, 2, 4), toon('#f4f4f0')); bow.rotation.z = -Math.PI / 2; bow.rotation.x = Math.PI / 4; bow.position.set(3.9, 0.3, 0); g.add(bow);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(2, 1.2, 1.8), toon('#1a8fd6')); cab.position.set(-0.6, 1.4, 0); g.add(cab);
  g.scale.setScalar(9);
  return g;
}
export function makeBuoy() {
  const g = new THREE.Group();
  const b = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), toon('#ff7a1a')); g.add(b);
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 6), toon('#333')); p.position.y = 1.6; g.add(p);
  const f = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1), toon('#e0442f', { side: THREE.DoubleSide })); f.position.set(0.7, 2.6, 0); g.add(f);
  const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.22), toon('#ffffff', { side: THREE.DoubleSide })); s.rotation.z = -0.62; s.position.set(0.7, 2.6, 0.01); g.add(s);
  g.scale.setScalar(7);
  return g;
}
