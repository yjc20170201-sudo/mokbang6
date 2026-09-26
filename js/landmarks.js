// Low-poly landmark models (units: meters, heights exaggerated for the diorama).
import * as THREE from 'three';
import { toon } from './map.js';

const glow = (c, i = 0.9) => { const m = toon(c, { emissive: new THREE.Color(c), emissiveIntensity: 0 }); m.userData.night = i; return m; };
const box = (w, h, d, m, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y + h / 2, z); o.castShadow = true; return o; };
const cyl = (rt, rb, h, m, seg = 16, x = 0, y = 0, z = 0) => { const o = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m); o.position.set(x, y + h / 2, z); o.castShadow = true; return o; };
const roof4 = (w, h, m, y) => { const o = new THREE.Mesh(new THREE.ConeGeometry(w * 0.72, h, 4), m); o.rotation.y = Math.PI / 4; o.position.y = y + h / 2; o.castShadow = true; return o; };

function textTex(lines, { w = 512, h = 256, bg = '#1b3a6b', fg = '#fff', font = 'bold 120px sans-serif' } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d');
  x.fillStyle = bg; x.fillRect(0, 0, w, h); x.fillStyle = fg; x.font = font; x.textAlign = 'center'; x.textBaseline = 'middle';
  lines.forEach((l, i) => x.fillText(l, w / 2, h / 2 + (i - (lines.length - 1) / 2) * (h / lines.length)));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export const LANDMARKS = {
  castle() {
    const g = new THREE.Group();
    const stone = toon('#9a9a92'), wall = toon('#f4f2ea'), roof = toon('#4f8d7b'), gold = glow('#f2c14e', 0.5);
    g.add(box(120, 36, 110, stone));
    let y = 36, w = 90;
    for (let i = 0; i < 5; i++) {
      const h = i === 0 ? 26 : 20;
      g.add(box(w, h, w * 0.86, wall, 0, y));
      g.add(roof4(w * 1.25, 14, roof, y + h - 4));
      y += h + 4; w *= 0.8;
    }
    const top = new THREE.Mesh(new THREE.ConeGeometry(18, 22, 4), roof); top.rotation.y = Math.PI / 4; top.position.y = y + 8; g.add(top);
    for (const s of [-1, 1]) { const f = new THREE.Mesh(new THREE.SphereGeometry(4, 8, 6), gold); f.position.set(12 * s, y + 18, 0); g.add(f); }
    return g;
  },
  tsutenkaku() {
    const g = new THREE.Group();
    const steel = toon('#c9ccd0'), lit = glow('#7fd3ff'), top = glow('#ffcf4d');
    for (const [x, z] of [[-22, -22], [22, -22], [22, 22], [-22, 22]]) { const l = cyl(4, 6, 60, steel, 6, x, 0, z); g.add(l); }
    g.add(box(56, 10, 56, steel, 0, 55));
    g.add(cyl(14, 18, 110, lit, 8, 0, 60));
    g.add(cyl(26, 22, 26, steel, 8, 0, 165));
    g.add(cyl(10, 14, 22, top, 8, 0, 190));
    g.add(cyl(1.5, 1.5, 30, steel, 6, 0, 212));
    return g;
  },
  skybuilding() {
    const g = new THREE.Group();
    const glass = toon('#b9d3e6'), frame = toon('#e9eef2'), ring = glow('#9fd6ff', 0.6);
    g.add(box(40, 220, 34, glass, -32, 0)); g.add(box(40, 220, 34, glass, 32, 0));
    g.add(box(110, 20, 38, frame, 0, 205));
    const r = new THREE.Mesh(new THREE.TorusGeometry(44, 4, 8, 32), ring); r.position.y = 222; r.rotation.x = Math.PI / 2; g.add(r);
    return g;
  },
  harukas() {
    const g = new THREE.Group();
    const glass = toon('#9fb9cc'), lit = glow('#bfe4ff', 0.5);
    g.add(box(90, 150, 70, glass)); g.add(box(76, 110, 60, glass, -8, 150)); g.add(box(60, 90, 50, lit, -14, 260)); g.add(box(20, 30, 20, glass, -14, 350));
    return g;
  },
  ferris({ tower = 70, r = 45 } = {}) {
    const g = new THREE.Group();
    const red = glow('#e0442f', 0.8), white = toon('#f4f4f4');
    if (tower) g.add(box(70, tower, 50, toon('#d9d4cc')));
    const wheel = new THREE.Group(); wheel.position.y = tower + r + 6;
    const rim = new THREE.Mesh(new THREE.TorusGeometry(r, 2.2, 8, 40), red); wheel.add(rim);
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2;
      const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, r * 2, 4), white); sp.rotation.z = a; wheel.add(sp);
      const cab = new THREE.Mesh(new THREE.BoxGeometry(5, 5, 5), toon(['#f7c948', '#5bc0eb', '#9bc53d', '#fa7921'][i % 4])); cab.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); wheel.add(cab);
    }
    g.add(wheel); g.userData.spin = wheel;
    return g;
  },
  runner() { // Dotonbori running-man style billboard (generic)
    const g = new THREE.Group();
    g.add(box(6, 40, 6, toon('#555'), -20, 0)); g.add(box(6, 40, 6, toon('#555'), 20, 0));
    const tex = (() => {
      const c = document.createElement('canvas'); c.width = 256; c.height = 320; const x = c.getContext('2d');
      const gr = x.createLinearGradient(0, 0, 0, 320); gr.addColorStop(0, '#2c7be5'); gr.addColorStop(1, '#8fd3ff'); x.fillStyle = gr; x.fillRect(0, 0, 256, 320);
      x.strokeStyle = '#fff'; x.lineWidth = 16; x.lineCap = 'round';
      x.beginPath(); x.arc(128, 70, 26, 0, 7); x.fillStyle = '#fff'; x.fill();
      x.beginPath(); x.moveTo(128, 100); x.lineTo(128, 190); x.moveTo(128, 120); x.lineTo(60, 80); x.moveTo(128, 120); x.lineTo(200, 90);
      x.moveTo(128, 190); x.lineTo(70, 270); x.moveTo(128, 190); x.lineTo(190, 250); x.lineTo(215, 290); x.stroke();
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const m = new THREE.MeshBasicMaterial({ map: tex }); m.userData.basic = true;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(56, 70), m); p.position.y = 75; g.add(p);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(56, 70), toon('#333')); back.rotation.y = Math.PI; back.position.y = 75; g.add(back);
    return g;
  },
  crab() {
    const g = new THREE.Group();
    const red = toon('#e2462d'), dark = toon('#a12b1b');
    const body = new THREE.Mesh(new THREE.SphereGeometry(22, 16, 10), red); body.scale.set(1.3, 0.55, 1); body.position.y = 70; g.add(body);
    const legs = [];
    for (let s of [-1, 1]) for (let i = 0; i < 4; i++) {
      const l = new THREE.Group(); l.position.set(-14 + i * 9, 66, 18 * s);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(2, 1.4, 34, 6), dark); seg.position.y = 0; seg.rotation.x = 1.1 * s; seg.position.z = 12 * s; l.add(seg); g.add(l); legs.push(l);
    }
    for (const s of [-1, 1]) { const c = new THREE.Mesh(new THREE.SphereGeometry(8, 10, 8), red); c.scale.set(1.4, 0.8, 1); c.position.set(30, 76, 14 * s); g.add(c); }
    for (const s of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(3, 8, 6), toon('#111')); e.position.set(24, 84, 6 * s); g.add(e); }
    g.add(box(8, 60, 8, toon('#6d6d6d'), -10, 0));
    g.userData.legs = legs;
    return g;
  },
  portTower() {
    const g = new THREE.Group();
    const pts = []; for (let i = 0; i <= 20; i++) { const t = i / 20; const y = t * 150; const r = 14 + 14 * Math.pow((t - 0.55) * 2, 2); pts.push(new THREE.Vector2(r, y)); }
    const m = new THREE.Mesh(new THREE.LatheGeometry(pts, 20), glow('#d8342a', 0.6)); m.castShadow = true; g.add(m);
    g.add(cyl(18, 18, 10, toon('#f1f1f1'), 20, 0, 118));
    g.add(cyl(1.2, 1.2, 25, toon('#ddd'), 6, 0, 150));
    return g;
  },
  tokyoTower() {
    const g = new THREE.Group();
    const or = glow('#ff5a1f', 0.9), wh = toon('#f6f4ef');
    const bands = [[0, 60, 46, 30, or], [60, 20, 30, 24, wh], [80, 60, 24, 14, or], [140, 12, 18, 18, wh], [152, 50, 14, 7, or], [202, 10, 10, 10, wh], [212, 70, 7, 2, or]];
    for (const [y, h, rb, rt, m] of bands) { const c = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 4, 1, true), m); c.rotation.y = Math.PI / 4; c.position.y = y + h / 2; g.add(c); }
    g.add(box(40, 12, 40, wh, 0, 135)); g.add(box(20, 8, 20, wh, 0, 205));
    return g;
  },
  skytree() {
    const g = new THREE.Group();
    const wh = toon('#e8eef4'), lit = glow('#6fb8ff', 1.0);
    g.add(cyl(20, 34, 180, wh, 3)); g.add(cyl(14, 20, 120, wh, 12, 0, 180));
    g.add(cyl(30, 30, 14, lit, 24, 0, 190)); g.add(cyl(18, 18, 10, lit, 24, 0, 300));
    g.add(cyl(8, 12, 60, wh, 12, 0, 310)); g.add(cyl(2, 4, 80, wh, 8, 0, 370));
    return g;
  },
  kaminarimon() {
    const g = new THREE.Group();
    const red = toon('#c9302c'), roof = toon('#3a3f45');
    g.add(box(8, 40, 8, red, -28, 0)); g.add(box(8, 40, 8, red, 28, 0)); g.add(box(8, 40, 8, red, -28, 0, 22)); g.add(box(8, 40, 8, red, 28, 0, 22));
    g.add(box(76, 10, 36, red, 0, 40, 11));
    const r = new THREE.Mesh(new THREE.ConeGeometry(56, 18, 4), roof); r.rotation.y = Math.PI / 4; r.scale.set(1.3, 1, 0.8); r.position.set(0, 58, 11); g.add(r);
    const lan = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 20, 16), glow('#e0442f', 0.7)); lan.position.set(0, 26, 11); g.add(lan);
    // five-storied pagoda behind
    const p = new THREE.Group(); p.position.set(70, 0, -60);
    let y = 0, w = 30; for (let i = 0; i < 5; i++) { p.add(box(w * 0.7, 12, w * 0.7, red, 0, y)); p.add(roof4(w * 1.2, 8, roof, y + 10)); y += 17; w *= 0.9; }
    p.add(cyl(1.5, 1.5, 30, toon('#c9a227'), 6, 0, y)); g.add(p);
    return g;
  },
  rainbowBridge() {
    const g = new THREE.Group();
    const wh = glow('#f2f2f2', 0.5);
    const L = 800;
    g.add(box(L, 6, 30, toon('#dfe3e6'), 0, 45));
    for (const s of [-1, 1]) { g.add(box(10, 120, 10, wh, s * 200, 0, -12)); g.add(box(10, 120, 10, wh, s * 200, 0, 12)); }
    const cable = (x1, y1, x2, y2, sag) => { const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(x1, y1, 0), new THREE.Vector3((x1 + x2) / 2, Math.min(y1, y2) - sag, 0), new THREE.Vector3(x2, y2, 0)); const m = new THREE.Mesh(new THREE.TubeGeometry(c, 30, 1.4, 5), wh); return m; };
    for (const z of [-12, 12]) { const a = cable(-200, 120, 200, 120, 70); a.position.z = z; g.add(a); const b = cable(-L / 2, 52, -200, 120, -30); b.position.z = z; g.add(b); const c = cable(200, 120, L / 2, 52, -30); c.position.z = z; g.add(c); }
    return g;
  },
  twinTowers() {
    const g = new THREE.Group(); const m = toon('#c8ccd2');
    g.add(box(60, 150, 50, m, 0, 0)); g.add(box(26, 90, 26, m, -16, 150)); g.add(box(26, 90, 26, m, 16, 150));
    return g;
  },
  tokyoStation() {
    const g = new THREE.Group(); const brick = toon('#b5523b'), wh = toon('#efe9dd'), dome = toon('#4d5a55');
    g.add(box(320, 34, 36, brick)); g.add(box(320, 3, 38, wh, 0, 20));
    for (const x of [-150, 150]) { g.add(cyl(18, 18, 44, brick, 8, x, 0)); const d = new THREE.Mesh(new THREE.SphereGeometry(20, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), dome); d.position.set(x, 44, 0); g.add(d); }
    return g;
  },
  robot() { // generic giant robot statue
    const g = new THREE.Group(); const w = toon('#f4f5f7'), b = toon('#2c4ea3'), r = toon('#d93a2f'), y = glow('#ffd23f', 0.8);
    for (const s of [-1, 1]) { g.add(box(10, 34, 12, w, 9 * s, 0)); g.add(box(12, 8, 16, b, 9 * s, 0, 2)); }
    g.add(box(30, 24, 18, b, 0, 34)); g.add(box(12, 8, 12, r, 0, 38, 4));
    for (const s of [-1, 1]) { g.add(box(12, 12, 14, w, 21 * s, 50)); g.add(box(7, 26, 8, w, 21 * s, 26)); }
    g.add(box(14, 12, 13, w, 0, 58)); const v = new THREE.Mesh(new THREE.ConeGeometry(2, 14, 3), y); v.rotation.z = Math.PI / 2; v.position.set(0, 72, 7); g.add(v);
    g.scale.setScalar(1.3);
    return g;
  },
  fuji() {
    const g = new THREE.Group();
    const m = new THREE.MeshLambertMaterial({ color: '#6f8fb5', fog: false }); const s = new THREE.MeshLambertMaterial({ color: '#ffffff', fog: false });
    const c = new THREE.Mesh(new THREE.ConeGeometry(9000, 3800, 48, 1, true), m); c.position.y = 1900; g.add(c);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2600, 1100, 48, 1), s); cap.position.y = 3800 - 550 - 20; g.add(cap);
    return g;
  },
  terminal() {
    const g = new THREE.Group();
    g.add(box(600, 30, 110, toon('#d9dee4')));
    const r = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 600, 24, 1, false, 0, Math.PI), toon('#9fb4c7')); r.rotation.z = Math.PI / 2; r.scale.set(1, 1, 0.8); r.position.y = 30; g.add(r);
    g.add(box(24, 70, 24, toon('#f0f0f0'), 340, 0, 80)); g.add(box(36, 14, 36, glow('#7fd3ff', 0.5), 340, 70, 80));
    return g;
  },
  arch() { // Engetsu island (rock with a hole)
    const g = new THREE.Group(); const rock = toon('#9a8b74'), green = toon('#5e8f4a');
    for (const s of [-1, 1]) { const b = new THREE.Mesh(new THREE.DodecahedronGeometry(38, 0), rock); b.scale.set(1, 1.6, 0.9); b.position.set(46 * s, 40, 0); g.add(b); }
    const a = new THREE.Mesh(new THREE.TorusGeometry(48, 20, 8, 16, Math.PI), rock); a.position.y = 52; g.add(a);
    const top = new THREE.Mesh(new THREE.SphereGeometry(40, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), green); top.scale.set(2, 0.5, 0.7); top.position.y = 110; g.add(top);
    return g;
  },
  volcano() { // Mt. Omuro
    const g = new THREE.Group();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(160, 520, 320, 32), toon('#8fbf5a')); m.position.y = 160; g.add(m);
    const cr = new THREE.Mesh(new THREE.CylinderGeometry(120, 150, 8, 32), toon('#6f9c43')); cr.position.y = 322; g.add(cr);
    return g;
  },
  lighthouse() {
    const g = new THREE.Group();
    g.add(cyl(9, 13, 70, toon('#f4f4f4'), 12)); g.add(cyl(10, 10, 12, glow('#fff3b0', 1.0), 12, 0, 70)); g.add(new THREE.Mesh(new THREE.ConeGeometry(12, 12, 12), toon('#d23a2a'))); g.children[2].position.y = 88;
    return g;
  },
  brewery() {
    const g = new THREE.Group(); const blk = toon('#2b2a28'), wh = toon('#efeae0'), wood = toon('#7a5433');
    g.add(box(140, 30, 70, wh)); g.add(box(140, 12, 70, blk, 0, 0));
    const r = new THREE.Mesh(new THREE.CylinderGeometry(45, 45, 150, 3, 1), toon('#46403a')); r.rotation.z = Math.PI / 2; r.rotation.x = Math.PI / 6; r.scale.set(1, 1, 0.65); r.position.y = 44; g.add(r);
    const ball = new THREE.Mesh(new THREE.IcosahedronGeometry(11, 1), toon('#6d8f3a')); ball.position.set(0, 26, 40); g.add(ball);
    g.add(box(4, 22, 4, wood, -60, 30, 25));
    return g;
  },
  court() { // tennis court (flat) + net
    const g = new THREE.Group();
    const c = document.createElement('canvas'); c.width = 256; c.height = 512; const x = c.getContext('2d');
    x.fillStyle = '#4b8f5a'; x.fillRect(0, 0, 256, 512); x.fillStyle = '#3b6fb0'; x.fillRect(28, 40, 200, 432);
    x.strokeStyle = '#fff'; x.lineWidth = 5; x.strokeRect(28, 40, 200, 432); x.strokeRect(52, 40, 152, 432);
    x.beginPath(); x.moveTo(52, 156); x.lineTo(204, 156); x.moveTo(52, 356); x.lineTo(204, 356); x.moveTo(128, 156); x.lineTo(128, 356); x.stroke();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(150, 300), new THREE.MeshLambertMaterial({ map: t })); p.rotation.x = -Math.PI / 2; p.position.y = 2; p.receiveShadow = true; g.add(p);
    const net = new THREE.Mesh(new THREE.BoxGeometry(128, 10, 1.5), toon('#f4f4f4', { transparent: true, opacity: 0.8 })); net.position.y = 7; g.add(net);
    for (const s of [-1, 1]) g.add(cyl(1.5, 1.5, 12, toon('#333'), 6, 64 * s, 0));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(3.2, 10, 8), toon('#d9ef3a', { emissive: new THREE.Color('#d9ef3a'), emissiveIntensity: 0.3 })); ball.position.y = 20; g.add(ball);
    g.userData.ball = ball;
    return g;
  },
  parasols() {
    const g = new THREE.Group(); const cols = ['#e0442f', '#f7c948', '#1a8fd6', '#3a9a55', '#ffffff'];
    for (let i = 0; i < 12; i++) { const pp = new THREE.Group(); pp.add(cyl(0.8, 0.8, 14, toon('#eee'), 6)); const top = new THREE.Mesh(new THREE.ConeGeometry(10, 4, 8), toon(cols[i % 5])); top.position.y = 15; pp.add(top); pp.position.set((i % 6) * 26 - 65, 0, Math.floor(i / 6) * 30 - 15); g.add(pp); }
    return g;
  },
  stall() { // market stall / yokocho lanterns row
    const g = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const h = 14 + (i % 2) * 6; g.add(box(22, h, 18, toon(['#6a4b35', '#8a5a3b', '#553a2a'][i % 3]), i * 24 - 48, 0));
      const l = new THREE.Mesh(new THREE.CapsuleGeometry(2.4, 3, 4, 8), glow('#ff7043', 1.0)); l.position.set(i * 24 - 48, h + 2, 10); g.add(l);
    }
    return g;
  },
};

export function buildLandmark(spec) {
  const f = LANDMARKS[spec.type]; if (!f) return null;
  const g = f(spec.opts || {});
  if (spec.scale) g.scale.multiplyScalar(spec.scale);
  if (spec.rot) g.rotation.y = spec.rot * Math.PI / 180;
  g.userData.nightMats = [];
  g.traverse(o => { if (o.material && o.material.userData?.night) g.userData.nightMats.push(o.material); });
  return g;
}
export { textTex };
