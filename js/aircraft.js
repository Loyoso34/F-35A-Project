// F-35A Lightning II – tamamen kod ile üretilen, gerçek ölçekli model.
// Eksenler: burun -Z, üst +Y, sağ kanat +X. Uzunluk 15.7 m, açıklık 10.7 m, yükseklik 4.4 m.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeStealthPanelTexture, makeRoughnessTexture, makeInsigniaTexture, makeTextTexture, makeCockpitDisplayTexture, makeBayDoorTexture } from './textures.js';

const DEG = Math.PI / 180;
export const F35 = {
  length: 15.7, span: 10.7, height: 4.4,
  cgStation: 8.0,
  wheelBottomY: -2.25,
  noseGearZ: -4.3, mainGearZ: 0.8, mainGearX: 1.75,
  pilotEye: new THREE.Vector3(0, 1.26, -3.05),
};

function st(s) { return s - F35.cgStation; }

// ---------------------------------------------------------------------------
// Gövde kesit profilleri. Her profil: üst merkez -> chine -> alt köşe -> alt merkez (sağ yarı).
// yt: üst y, (xc,yc): chine, (xs,ys): yanak kontrol noktası (hava alığı şişkinliği),
// (xb,yb): alt köşe, ybot: alt merkez, nt: üst süperelips üssü, nb: alt süperelips üssü.
const FORE_PROFILES = [
  [0.00, { yt: 0.02, xc: 0.012, yc: 0.0, xs: 0.012, ys: -0.01, xb: 0.008, yb: -0.015, ybot: -0.02, nt: 2.2, nb: 2.5 }],
  [0.70, { yt: 0.27, xc: 0.30, yc: 0.01, xs: 0.27, ys: -0.10, xb: 0.16, yb: -0.21, ybot: -0.26, nt: 2.2, nb: 2.6 }],
  [1.80, { yt: 0.49, xc: 0.58, yc: 0.04, xs: 0.50, ys: -0.18, xb: 0.30, yb: -0.38, ybot: -0.46, nt: 2.3, nb: 2.8 }],
  [2.90, { yt: 0.61, xc: 0.79, yc: 0.06, xs: 0.68, ys: -0.25, xb: 0.42, yb: -0.52, ybot: -0.62, nt: 2.4, nb: 3.0 }],
  [3.60, { yt: 0.65, xc: 0.90, yc: 0.05, xs: 0.78, ys: -0.28, xb: 0.48, yb: -0.62, ybot: -0.72, nt: 2.5, nb: 3.0 }],
  [4.10, { yt: 0.67, xc: 0.97, yc: 0.03, xs: 0.88, ys: -0.32, xb: 0.50, yb: -0.68, ybot: -0.78, nt: 2.6, nb: 3.0 }],
  [4.50, { yt: 0.68, xc: 1.02, yc: 0.01, xs: 0.94, ys: -0.34, xb: 0.46, yb: -0.71, ybot: -0.80, nt: 2.6, nb: 3.0 }],
];
const MAIN_PROFILES = [
  [5.00, { yt: 0.69, xc: 1.12, yc: 0.00, xs: 1.42, ys: -0.42, xb: 1.22, yb: -0.86, ybot: -0.92, nt: 2.6, nb: 3.5 }],
  [5.80, { yt: 0.73, xc: 1.24, yc: -0.02, xs: 1.47, ys: -0.45, xb: 1.27, yb: -0.90, ybot: -0.96, nt: 2.7, nb: 3.5 }],
  [6.60, { yt: 0.79, xc: 1.44, yc: -0.06, xs: 1.62, ys: -0.48, xb: 1.42, yb: -0.92, ybot: -0.98, nt: 2.8, nb: 3.6 }],
  [7.60, { yt: 0.83, xc: 1.64, yc: -0.10, xs: 1.76, ys: -0.50, xb: 1.57, yb: -0.94, ybot: -1.00, nt: 2.9, nb: 3.6 }],
  [8.80, { yt: 0.83, xc: 1.74, yc: -0.10, xs: 1.82, ys: -0.50, xb: 1.62, yb: -0.95, ybot: -1.00, nt: 2.9, nb: 3.6 }],
  [10.0, { yt: 0.77, xc: 1.74, yc: -0.10, xs: 1.78, ys: -0.50, xb: 1.57, yb: -0.90, ybot: -0.95, nt: 2.8, nb: 3.5 }],
  [11.2, { yt: 0.69, xc: 1.64, yc: -0.08, xs: 1.64, ys: -0.45, xb: 1.42, yb: -0.78, ybot: -0.80, nt: 2.7, nb: 3.2 }],
  [12.4, { yt: 0.63, xc: 1.50, yc: -0.05, xs: 1.47, ys: -0.35, xb: 1.30, yb: -0.62, ybot: -0.64, nt: 2.6, nb: 3.0 }],
  [13.4, { yt: 0.61, xc: 1.37, yc: -0.02, xs: 1.32, ys: -0.30, xb: 1.17, yb: -0.52, ybot: -0.52, nt: 2.5, nb: 2.8 }],
  [14.2, { yt: 0.59, xc: 1.22, yc: 0.00, xs: 1.17, ys: -0.25, xb: 1.04, yb: -0.46, ybot: -0.46, nt: 2.4, nb: 2.6 }],
  [14.6, { yt: 0.57, xc: 1.14, yc: 0.00, xs: 1.10, ys: -0.24, xb: 0.98, yb: -0.44, ybot: -0.44, nt: 2.4, nb: 2.6 }],
];

function lerpProfile(table, s) {
  if (s <= table[0][0]) return table[0][1];
  if (s >= table[table.length - 1][0]) return table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i++) {
    const [s0, a] = table[i], [s1, b] = table[i + 1];
    if (s >= s0 && s <= s1) {
      const t = (s - s0) / (s1 - s0);
      const k = t * t * (3 - 2 * t);
      const out = {};
      for (const key of Object.keys(a)) out[key] = a[key] + (b[key] - a[key]) * k;
      return out;
    }
  }
  return table[0][1];
}
function profileAt(s) { return s < 4.75 ? lerpProfile(FORE_PROFILES, s) : lerpProfile(MAIN_PROFILES, s); }
export function bodyTop(s) { return profileAt(s).yt; }
export function bodyBottom(s) { return profileAt(s).ybot; }
export function bodyHalfWidth(s) { const p = profileAt(s); return Math.max(p.xc, p.xs); }

// Profilden 12 noktalı yarım kesit üretir (indeks 0 üst merkez, 4 chine, 8 alt köşe, 11 alt merkez)
function halfSection(p) {
  const pts = [];
  // Üst: süperelips (0,yt) -> (xc,yc)
  for (let i = 0; i <= 4; i++) {
    const th = (i / 4) * Math.PI / 2;
    const x = p.xc * Math.pow(Math.sin(th), 2 / p.nt);
    const y = p.yc + (p.yt - p.yc) * Math.pow(Math.cos(th), 2 / p.nt);
    pts.push({ x, y });
  }
  // Yan: (xc,yc) -> (xb,yb) kuadratik bezier, kontrol (xs,ys)
  for (let i = 1; i <= 4; i++) {
    const t = i / 4;
    const x = (1 - t) * (1 - t) * p.xc + 2 * (1 - t) * t * p.xs + t * t * p.xb;
    const y = (1 - t) * (1 - t) * p.yc + 2 * (1 - t) * t * p.ys + t * t * p.yb;
    pts.push({ x, y });
  }
  // Alt: süperelips (xb,yb) -> (0,ybot)
  for (let i = 1; i <= 3; i++) {
    const th = (i / 3) * Math.PI / 2;
    const x = p.xb * Math.pow(Math.cos(th), 2 / p.nb);
    const y = p.ybot + (p.yb - p.ybot) * Math.pow(Math.sin(th), 2 / p.nb);
    pts.push({ x, y });
  }
  return pts; // 12 nokta
}

// Genel loft. sections[i] = [{x,y,z}], hepsi aynı uzunlukta.
function loft(sections, { uScale = 1, vScale = 1, closeRing = false, flip = false } = {}) {
  const n = sections.length, m = sections[0].length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m; k++) {
      const p = sections[i][k];
      pos.push(p.x, p.y, p.z);
      uv.push((i / (n - 1)) * uScale, (k / (m - 1)) * vScale);
    }
  }
  const kMax = closeRing ? m : m - 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < kMax; k++) {
      const k1 = (k + 1) % m;
      const a = i * m + k, b = i * m + k1, c = (i + 1) * m + k, d = (i + 1) * m + k1;
      if (flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Normallerin dışa baktığını garanti et. refFn(v) -> referans (iç) nokta
function ensureOutward(g, refFn = null) {
  g.computeBoundingBox();
  const c = new THREE.Vector3();
  g.boundingBox.getCenter(c);
  const p = g.attributes.position, nrm = g.attributes.normal;
  let score = 0;
  const v = new THREE.Vector3(), nn = new THREE.Vector3(), ref = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    if (refFn) refFn(v, ref); else ref.copy(c);
    v.sub(ref);
    nn.fromBufferAttribute(nrm, i);
    score += v.dot(nn);
  }
  if (score < 0) {
    const index = g.index.array;
    for (let i = 0; i < index.length; i += 3) { const t = index[i + 1]; index[i + 1] = index[i + 2]; index[i + 2] = t; }
    g.index.needsUpdate = true;
    g.computeVertexNormals();
  }
  return g;
}
const bodyAxisRef = (v, out) => out.set(0, -0.05, v.z);

function naca(t, thick) {
  const x = Math.min(1, Math.max(0, t));
  const y = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  return Math.max(0, y);
}
function airfoilPoints(K, chord, thickFrac, tStart = 0, tEnd = 1) {
  const pts = [];
  for (let i = 0; i <= K; i++) { const t = tEnd - (tEnd - tStart) * (i / K); pts.push({ c: t, y: naca(t, thickFrac) * chord }); }
  for (let i = 1; i <= K; i++) { const t = tStart + (tEnd - tStart) * (i / K); pts.push({ c: t, y: -naca(t, thickFrac) * chord }); }
  return pts;
}

// Paylaşılan malzemeler (oyuncu uçağı + apronda park halindekiler)
let SHARED = null;
export function getSharedMaterials() {
  if (SHARED) return SHARED;
  const panel = makeStealthPanelTexture(1024);
  const rough = makeRoughnessTexture(512);
  SHARED = {
    disposables: [panel, rough],
    paint: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, map: panel, roughnessMap: rough, roughness: 0.72, metalness: 0.25, envMapIntensity: 0.7 }),
    paintDark: new THREE.MeshStandardMaterial({ color: 0x8b9096, map: panel, roughness: 0.8, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9, metalness: 0.1 }),
    duct: new THREE.MeshStandardMaterial({ color: 0x1a1c1f, roughness: 0.85, metalness: 0.2, side: THREE.DoubleSide }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.5, metalness: 0.9, flatShading: true, envMapIntensity: 0.8 }),
    metalSmooth: new THREE.MeshStandardMaterial({ color: 0xa4a7ab, roughness: 0.4, metalness: 0.85 }),
    canopy: new THREE.MeshPhysicalMaterial({
      color: 0xc99b2a, metalness: 0.55, roughness: 0.08, transparent: true, opacity: 0.5,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false,
    }),
    canopyInside: new THREE.MeshPhysicalMaterial({ color: 0xc99b2a, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.14, side: THREE.FrontSide, depthWrite: false }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    cockpit: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9 }),
    pilot: new THREE.MeshStandardMaterial({ color: 0x3c4a3a, roughness: 0.8 }),
    helmet: new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.3, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0.6, clearcoat: 1, envMapIntensity: 1.2 }),
    formLight: new THREE.MeshBasicMaterial({ color: 0x9fc9a0, transparent: true, opacity: 0.75 }),
  };
  SHARED.disposables.push(...Object.values(SHARED).filter((m) => m && m.isMaterial));
  return SHARED;
}

export class F35A {
  constructor({ quality = 'medium', forStatic = false } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'F-35A';
    this.parts = {};
    this.disposables = [];
    this.forStatic = forStatic;
    this.m = getSharedMaterials();
    this.paintGeos = [];
    this.buildFuselage();
    this.buildIntakes();
    this.buildCanopyAndCockpit();
    this.buildWings();
    this.buildTails();
    this.buildNozzle();
    this.buildGear();
    this.buildDetails();
    this.buildLights();
    this.buildMarkings();
    this.finalize();
  }

  track(o) { this.disposables.push(o); return o; }

  // Belirli s istasyonu için tam kesit noktaları (sağ yarı) ve z
  sectionPoints(s, profile = null) {
    const p = profile || profileAt(s);
    return halfSection(p).map((q) => ({ x: q.x, y: q.y, z: st(s) }));
  }

  buildFuselage() {
    const foreS = [0.0, 0.35, 0.7, 1.2, 1.8, 2.4, 2.9, 3.3, 3.6, 3.85, 4.1, 4.3, 4.5];
    const mainS = [5.0, 5.4, 5.8, 6.2, 6.6, 7.1, 7.6, 8.2, 8.8, 9.4, 10.0, 10.6, 11.2, 11.8, 12.4, 12.9, 13.4, 13.8, 14.2, 14.6];
    const fore = foreS.map((s) => this.sectionPoints(s));
    const main = mainS.map((s) => this.sectionPoints(s));
    const mirror = (pt) => ({ x: -pt.x, y: pt.y, z: pt.z });
    // Üst şerit: tüm istasyonlar (chine'den chine'e, tepe üzerinden)
    const topRows = [...fore, ...main].map((h) => [mirror(h[4]), mirror(h[3]), mirror(h[2]), mirror(h[1]), h[0], h[1], h[2], h[3], h[4]]);
    this.paintGeos.push(ensureOutward(loft(topRows, { uScale: 3, vScale: 1 }), bodyAxisRef));
    // Alt şerit: ön gövde + ana gövde (alt köşeden alt köşeye)
    const botRows = [...fore, ...main.slice(1)].map((h) => [mirror(h[8]), mirror(h[9]), mirror(h[10]), h[11], h[10], h[9], h[8]]);
    // hava alığı alt dudağı: 5.4 istasyonu ana profilden (eğik alt dudak)
    this.paintGeos.push(ensureOutward(loft(botRows, { uScale: 3, vScale: 1 }), bodyAxisRef));
    // Yan şeritler: ön gövde (ayrı) ve ana gövde (ağızdan itibaren, süpürülmüş dudak halkası)
    const lipProfile = lerpProfile(MAIN_PROFILES, 5.0);
    const lipHalf = halfSection(lipProfile);
    for (const side of [-1, 1]) {
      const sideRowsFore = fore.map((h) => h.slice(4, 9).map((q) => ({ x: side * q.x, y: q.y, z: q.z })));
      this.paintGeos.push(ensureOutward(loft(sideRowsFore, { uScale: 1, vScale: 0.5 }), bodyAxisRef));
      // Dudak halkası: chine 4.55'te, alt köşe 5.7'de (süpürülmüş)
      const lipRing = lipHalf.slice(4, 9).map((q, k) => ({ x: side * q.x, y: q.y, z: st(4.55 + (k / 4) * 1.15) }));
      const sideRowsMain = [lipRing, ...main.slice(1).map((h) => h.slice(4, 9).map((q) => ({ x: side * q.x, y: q.y, z: q.z })))];
      this.paintGeos.push(ensureOutward(loft(sideRowsMain, { uScale: 2.5, vScale: 0.5 }), bodyAxisRef));
      // Hava alığı boğazı: dudak halkasından ön gövde duvarına (karanlık kanal)
      const ringA = fore[fore.length - 1].slice(4, 9).map((q) => ({ x: side * q.x, y: q.y, z: st(4.55) }));
      const ringA2 = fore[fore.length - 1].slice(4, 9).map((q) => ({ x: side * q.x * 0.98, y: q.y, z: st(5.3) }));
      const throat = this.track(loft([lipRing, ringA, ringA2], { uScale: 1, vScale: 1 }));
      const throatMesh = new THREE.Mesh(throat, this.m.duct);
      this.group.add(throatMesh);
      // Kanal içi karanlık taban (derin görünüm)
      const inner = this.track(loft([ringA2, ringA2.map((q) => ({ x: q.x * 0.9, y: q.y * 0.9 - 0.05, z: q.z + 1.2 }))], { uScale: 1, vScale: 1 }));
      this.group.add(new THREE.Mesh(inner, this.m.duct));
    }
    // Kuyruk kapağı (bumların arka yüzü)
    const endHalf = main[main.length - 1];
    const endRing = [...endHalf.map(mirror).reverse(), ...endHalf.slice(1)];
    const capShape = new THREE.Shape();
    endRing.forEach((q, i) => { if (i === 0) capShape.moveTo(q.x, q.y); else capShape.lineTo(q.x, q.y); });
    const cap = new THREE.ShapeGeometry(capShape);
    cap.translate(0, 0, st(14.6));
    this.group.add(new THREE.Mesh(this.track(cap), this.m.dark));
  }

  buildIntakes() {
    // DSI tümseği: ağız içinde, ön gövde yan duvarında belirgin bir bombe
    for (const side of [-1, 1]) {
      const bump = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI);
      bump.scale(0.22, 0.36, 0.9);
      bump.rotateY(side * 0.12);
      bump.translate(side * (0.84), -0.36, st(4.9));
      this.paintGeos.push(bump);
      // Dudak kenarı (ince metalik çerçeve)
      const lipProfile = lerpProfile(MAIN_PROFILES, 5.0);
      const lh = halfSection(lipProfile).slice(4, 9);
      const outer = lh.map((q, k) => ({ x: side * q.x, y: q.y, z: st(4.55 + (k / 4) * 1.15) }));
      const innerR = lh.map((q, k) => ({ x: side * (q.x - 0.035), y: q.y + (k < 2 ? -0.03 : 0.02), z: st(4.55 + (k / 4) * 1.15) - 0.05 }));
      const lip = this.track(loft([outer, innerR], { uScale: 1, vScale: 1 }));
      const lipMesh = new THREE.Mesh(lip, this.m.paintDark);
      lipMesh.material = this.m.duct;
      this.group.add(lipMesh);
    }
  }

  buildCanopyAndCockpit() {
    const m = this.m;
    // Kokpit çukuru
    const tub = new THREE.BoxGeometry(1.0, 0.55, 2.7);
    tub.translate(0, bodyTop(4.7) - 0.28, st(4.75));
    this.group.add(new THREE.Mesh(this.track(tub), m.cockpit));
    // Gösterge paneli (panoramik dokunmatik ekran) – pilota bakan yüz
    const pcdTex = this.track(makeCockpitDisplayTexture(1024, 384));
    const pcdMat = this.track(new THREE.MeshStandardMaterial({ map: pcdTex, emissive: 0xffffff, emissiveMap: pcdTex, emissiveIntensity: 0.9, roughness: 0.4 }));
    const panelBox = new THREE.BoxGeometry(1.02, 0.42, 0.14);
    panelBox.translate(0, bodyTop(3.85) + 0.17, st(3.9));
    this.group.add(new THREE.Mesh(this.track(panelBox), m.cockpit));
    const panel = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.96, 0.36)), pcdMat);
    panel.position.set(0, bodyTop(3.85) + 0.17, st(3.9) + 0.075);
    panel.rotation.y = 0; // +z'ye (pilota) bakar
    this.group.add(panel);
    // Parlama siperi (glareshield)
    const glareShape = new THREE.Shape();
    glareShape.moveTo(0, 0); glareShape.lineTo(0.62, 0); glareShape.lineTo(0.62, 0.05); glareShape.lineTo(0.1, 0.12); glareShape.lineTo(0, 0.12); glareShape.lineTo(0, 0);
    const glare = new THREE.ExtrudeGeometry(glareShape, { depth: 1.04, bevelEnabled: false });
    glare.rotateY(-Math.PI / 2);
    glare.translate(0.52, bodyTop(3.75) + 0.29, st(3.5));
    this.group.add(new THREE.Mesh(this.track(glare), m.cockpit));
    // Yan konsollar, gaz kolu (sol) ve yan çubuk (sağ)
    for (const side of [-1, 1]) {
      const console = new THREE.BoxGeometry(0.26, 0.12, 1.6);
      console.translate(side * 0.36, bodyTop(4.7) - 0.05, st(4.85));
      this.group.add(new THREE.Mesh(this.track(console), m.cockpit));
    }
    const throttle = new THREE.BoxGeometry(0.08, 0.14, 0.22);
    throttle.translate(-0.36, bodyTop(4.7) + 0.08, st(4.7));
    this.group.add(new THREE.Mesh(this.track(throttle), m.dark));
    const stick = new THREE.CylinderGeometry(0.025, 0.03, 0.2, 8);
    stick.translate(0.36, bodyTop(4.9) + 0.1, st(4.95));
    this.group.add(new THREE.Mesh(this.track(stick), m.dark));
    // Koltuk: sırt, başlık
    const seatBack = new THREE.BoxGeometry(0.56, 0.95, 0.14);
    seatBack.rotateX(-0.25);
    seatBack.translate(0, bodyTop(5.5) + 0.1, st(5.55));
    this.group.add(new THREE.Mesh(this.track(seatBack), m.cockpit));
    const headbox = new THREE.BoxGeometry(0.46, 0.34, 0.3);
    headbox.translate(0, bodyTop(5.6) + 0.48, st(5.65));
    this.group.add(new THREE.Mesh(this.track(headbox), m.cockpit));
    // Pilot: gövde + kask (kokpit görünümünde gizlenir)
    const torso = new THREE.CylinderGeometry(0.2, 0.25, 0.55, 10);
    torso.translate(0, bodyTop(5.05) + 0.12, st(5.1));
    const torsoMesh = new THREE.Mesh(this.track(torso), m.pilot);
    const helmet = new THREE.SphereGeometry(0.16, 12, 10);
    helmet.translate(0, bodyTop(5.0) + 0.56, st(5.05));
    const helmetMesh = new THREE.Mesh(this.track(helmet), m.helmet);
    const visor = new THREE.SphereGeometry(0.165, 12, 8, -Math.PI / 2 - 0.9, 1.8, 0.9, 1.1);
    visor.translate(0, bodyTop(5.0) + 0.56, st(5.05));
    const visorMesh = new THREE.Mesh(this.track(visor), m.glass);
    this.group.add(torsoMesh, helmetMesh, visorMesh);
    this.parts.pilotParts = [torsoMesh, helmetMesh, visorMesh];

    // Kanopi loft'u (yarım elips kesitler), dik ön cam
    const profile = [
      [3.05, 0.05, 0.02], [3.25, 0.40, 0.24], [3.5, 0.53, 0.50], [3.8, 0.57, 0.70], [4.15, 0.59, 0.82],
      [4.6, 0.59, 0.88], [5.1, 0.57, 0.85], [5.6, 0.53, 0.72], [6.1, 0.44, 0.48], [6.5, 0.30, 0.22], [6.78, 0.10, 0.04],
    ];
    const rows = [];
    const M = 16;
    for (const [s, w, h] of profile) {
      const base = bodyTop(s) - 0.02;
      const row = [];
      for (let k = 0; k <= M; k++) {
        const th = (k / M) * Math.PI;
        row.push({ x: Math.cos(th) * w, y: base + Math.sin(th) * h, z: st(s) });
      }
      rows.push(row);
    }
    const g = this.track(ensureOutward(loft(rows, { uScale: 1, vScale: 1 })));
    const canopy = new THREE.Mesh(g, m.canopy);
    canopy.renderOrder = 5;
    this.group.add(canopy);
    this.parts.canopy = canopy;
    // Çerçeveler: ön cam kemeri ve kanopi bow'u
    const arc = (s, w, h, thick, depth, mat) => {
      const a = [], b = [];
      for (let k = 0; k <= M; k++) {
        const th = (k / M) * Math.PI;
        a.push({ x: Math.cos(th) * w, y: bodyTop(s) - 0.02 + Math.sin(th) * h, z: st(s) });
        b.push({ x: Math.cos(th) * (w + thick), y: bodyTop(s) - 0.02 + Math.sin(th) * (h + thick), z: st(s) + depth });
      }
      const geo = this.track(loft([a, b], { uScale: 1, vScale: 1 }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.material.side = THREE.DoubleSide;
      this.group.add(mesh);
    };
    arc(4.15, 0.585, 0.815, 0.03, 0.09, this.track(m.dark.clone()));
    arc(3.12, 0.22, 0.10, 0.03, 0.06, this.track(m.dark.clone()));
    // Kanopi eşiği: kanopi tabanını izleyen ince çerçeve
    const sillIn = [], sillOut = [];
    for (const [s, w] of profile) {
      sillIn.push({ x: Math.max(0.02, w - 0.02), y: bodyTop(s) + 0.005, z: st(s) });
      sillOut.push({ x: w + 0.05, y: bodyTop(s) + 0.005, z: st(s) });
    }
    for (const side of [-1, 1]) {
      const rows = [sillIn.map((q) => ({ x: side * q.x, y: q.y, z: q.z })), sillOut.map((q) => ({ x: side * q.x, y: q.y, z: q.z }))];
      const geo = this.track(loft(rows, { uScale: 1, vScale: 1 }));
      const mesh = new THREE.Mesh(geo, this.track(m.dark.clone()));
      mesh.material.side = THREE.DoubleSide;
      this.group.add(mesh);
    }
  }

  wingPlanform() {
    return { rootX: 1.35, tipX: 5.35, leRoot: 6.55, teRoot: 12.55, leTip: 9.15, teTip: 11.55, thickRoot: 0.05, thickTip: 0.035, y: -0.12, hinge: 0.76 };
  }

  buildWingPanel(side, x0, x1, P, { cStart = 0, cEnd = 1, K = 10, N = 6 } = {}) {
    const rows = [];
    for (let j = 0; j <= N; j++) {
      const x = x0 + (x1 - x0) * (j / N);
      const f = (x - P.rootX) / (P.tipX - P.rootX);
      const le = P.leRoot + (P.leTip - P.leRoot) * f;
      const te = P.teRoot + (P.teTip - P.teRoot) * f;
      const chord = te - le;
      const thick = P.thickRoot + (P.thickTip - P.thickRoot) * f;
      rows.push(airfoilPoints(K, chord, thick, cStart, cEnd).map((p) => ({ x: side * x, y: P.y + p.y, z: st(le + chord * p.c) })));
    }
    return ensureOutward(loft(rows, { uScale: 2, vScale: 1 }));
  }

  buildWings() {
    const P = this.wingPlanform();
    this.parts.ailerons = {}; this.parts.flaps = {};
    for (const side of [-1, 1]) {
      this.paintGeos.push(this.buildWingPanel(side, P.rootX - 0.4, P.tipX, P, { cStart: 0, cEnd: P.hinge, K: 12, N: 8 }));
      const surfaces = [{ key: 'flaps', x0: P.rootX + 0.05, x1: 3.35 }, { key: 'ailerons', x0: 3.45, x1: P.tipX - 0.1 }];
      for (const sf of surfaces) {
        const xm = (sf.x0 + sf.x1) / 2;
        const fm = (xm - P.rootX) / (P.tipX - P.rootX);
        const leM = P.leRoot + (P.leTip - P.leRoot) * fm, teM = P.teRoot + (P.teTip - P.teRoot) * fm;
        const hingeS = leM + (teM - leM) * P.hinge;
        const f0 = (sf.x0 - P.rootX) / (P.tipX - P.rootX), f1 = (sf.x1 - P.rootX) / (P.tipX - P.rootX);
        const hs = (f) => { const le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f; return le + (te - le) * P.hinge; };
        const axis = new THREE.Vector3(side * (sf.x1 - sf.x0), 0, hs(f1) - hs(f0)).normalize();
        const geo = this.buildWingPanel(side, sf.x0, sf.x1, P, { cStart: P.hinge - 0.01, cEnd: 1, K: 5, N: 3 });
        geo.translate(-side * xm, -P.y, -st(hingeS));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
        mesh.position.set(side * xm, P.y, st(hingeS));
        mesh.castShadow = true;
        mesh.userData.axis = axis;
        this.group.add(mesh);
        this.parts[sf.key][side < 0 ? 'left' : 'right'] = mesh;
      }
    }
  }

  buildTails() {
    this.parts.stabs = {};
    const S = { rootX: 0.8, tipX: 3.45, leRoot: 12.35, teRoot: 15.75, leTip: 14.35, teTip: 15.55, thickRoot: 0.045, thickTip: 0.035, y: -0.08, pivot: 14.25 };
    for (const side of [-1, 1]) {
      const rows = [];
      const N = 5, K = 8;
      for (let j = 0; j <= N; j++) {
        const x = S.rootX + (S.tipX - S.rootX) * (j / N);
        const f = j / N;
        const le = S.leRoot + (S.leTip - S.leRoot) * f, te = S.teRoot + (S.teTip - S.teRoot) * f;
        const chord = te - le;
        const thick = S.thickRoot + (S.thickTip - S.thickRoot) * f;
        rows.push(airfoilPoints(K, chord, thick).map((p) => ({ x: side * x, y: p.y, z: st(le + chord * p.c) - st(S.pivot) })));
      }
      const geo = this.track(ensureOutward(loft(rows, { uScale: 1.5, vScale: 1 })));
      const mesh = new THREE.Mesh(geo, this.m.paint);
      mesh.position.set(0, S.y, st(S.pivot));
      mesh.castShadow = true;
      this.group.add(mesh);
      this.parts.stabs[side < 0 ? 'left' : 'right'] = mesh;
      const boom = new THREE.CylinderGeometry(0.15, 0.12, 0.5, 8);
      boom.rotateZ(Math.PI / 2);
      boom.translate(side * (S.rootX - 0.05), S.y, st(S.pivot));
      this.paintGeos.push(boom);
    }
    // Dikey kuyruklar (dışa 22° eğik) + dümenler
    this.parts.rudders = {};
    const cant = 22 * DEG;
    const V = { rootLE: 10.5, rootTE: 14.2, tipLE: 13.0, tipTE: 14.5, height: 2.2, rootX: 0.66, rootY: 0.42, hinge: 0.68 };
    for (const side of [-1, 1]) {
      const up = new THREE.Vector3(side * Math.sin(cant), Math.cos(cant), 0);
      const nrm = new THREE.Vector3(Math.cos(cant) * side, -Math.sin(cant), 0);
      const N = 5, K = 8;
      const mkRows = (c0, c1, local) => {
        const rows = [];
        for (let j = 0; j <= N; j++) {
          const f = j / N;
          const le = V.rootLE + (V.tipLE - V.rootLE) * f, te = V.rootTE + (V.tipTE - V.rootTE) * f;
          const chord = te - le;
          const thick = 0.045 - 0.012 * f;
          const base = new THREE.Vector3(side * V.rootX, V.rootY, 0).addScaledVector(up, V.height * f);
          rows.push(airfoilPoints(K, chord, thick, c0, c1).map((p) => {
            let z = st(le + chord * p.c);
            if (local) z -= st(le + chord * V.hinge) - local.dz(f);
            return { x: base.x + nrm.x * p.y - (local ? local.x : 0), y: base.y + nrm.y * p.y - (local ? local.y : 0), z };
          }));
        }
        return rows;
      };
      this.paintGeos.push(ensureOutward(loft(mkRows(0, V.hinge), { uScale: 1.5, vScale: 1 })));
      const hingeRoot = V.rootLE + (V.rootTE - V.rootLE) * V.hinge;
      const hingeTip = V.tipLE + (V.tipTE - V.tipLE) * V.hinge;
      const local = { x: side * V.rootX, y: V.rootY, dz: (f) => st(hingeRoot + (hingeTip - hingeRoot) * f) - st(hingeRoot) };
      const rudGeo = this.track(ensureOutward(loft(mkRows(V.hinge - 0.01, 1, local), { uScale: 1, vScale: 1 })));
      const rud = new THREE.Mesh(rudGeo, this.m.paint);
      rud.position.set(side * V.rootX, V.rootY, st(hingeRoot));
      rud.castShadow = true;
      rud.userData.axis = new THREE.Vector3().copy(up).multiplyScalar(V.height).add(new THREE.Vector3(0, 0, st(hingeTip) - st(hingeRoot))).normalize();
      this.group.add(rud);
      this.parts.rudders[side < 0 ? 'left' : 'right'] = rud;
      this.parts['tailTip' + side] = new THREE.Vector3(side * V.rootX, V.rootY, 0).addScaledVector(up, V.height);
      // Kuyruk ucu formasyon ışığı
      const fl = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.06)), this.m.formLight);
      fl.position.copy(new THREE.Vector3(side * V.rootX, V.rootY, st(13.6)).addScaledVector(up, 1.6).addScaledVector(nrm, 0.05));
      fl.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -side), up, nrm));
      this.group.add(fl);
    }
  }

  buildNozzle() {
    const y0 = 0.08;
    const z0 = st(14.0);
    // Nozul gövdesi: bumların arasından çıkar
    const body = new THREE.CylinderGeometry(0.52, 0.56, 1.25, 30, 1, true);
    body.rotateX(Math.PI / 2);
    body.translate(0, y0, z0 + 0.625);
    const nozzle = new THREE.Mesh(this.track(body), this.m.metal);
    nozzle.castShadow = true;
    this.group.add(nozzle);
    this.parts.nozzle = nozzle;
    // Testere dişli yapraklar (15 adet)
    const petals = [];
    const n = 15;
    const zA = z0 + 1.2, zB = z0 + 1.72;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const rA = 0.52, rB = 0.44;
      const p = [
        { x: Math.cos(a0) * rA, y: y0 + Math.sin(a0) * rA, z: zA },
        { x: Math.cos(a1) * rA, y: y0 + Math.sin(a1) * rA, z: zA },
        { x: Math.cos(am) * rB, y: y0 + Math.sin(am) * rB, z: zB },
      ];
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([p[0].x, p[0].y, p[0].z, p[1].x, p[1].y, p[1].z, p[2].x, p[2].y, p[2].z], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      petals.push(g);
    }
    const petalGeo = this.track(mergeGeometries(petals.map((g) => g.toNonIndexed()), false));
    const petalMat = this.track(this.m.metal.clone()); petalMat.side = THREE.DoubleSide;
    this.group.add(new THREE.Mesh(petalGeo, petalMat));
    // İç koni ve türbin
    const inner = new THREE.CylinderGeometry(0.40, 0.50, 1.2, 24, 1, true);
    inner.rotateX(Math.PI / 2);
    inner.translate(0, y0, z0 + 0.62);
    const innerMat = this.track(new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.8, metalness: 0.6, side: THREE.BackSide }));
    this.group.add(new THREE.Mesh(this.track(inner), innerMat));
    const turbine = new THREE.CircleGeometry(0.5, 24);
    turbine.translate(0, y0, z0 + 0.05);
    this.group.add(new THREE.Mesh(this.track(turbine), this.m.dark));
    const glow = new THREE.CircleGeometry(0.44, 20);
    glow.translate(0, y0, z0 + 0.12);
    this.matGlow = this.track(new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(new THREE.Mesh(this.track(glow), this.matGlow));
    // Art yakıcı alevi
    this.matFlameOuter = this.track(new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.matFlameInner = this.track(new THREE.MeshBasicMaterial({ color: 0x88b8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    const flameGroup = new THREE.Group();
    flameGroup.position.set(0, y0, zB - 0.05);
    const outerGeo = new THREE.ConeGeometry(0.44, 1, 16, 1, true);
    outerGeo.rotateX(Math.PI / 2); outerGeo.translate(0, 0, 0.5);
    const innerGeo = new THREE.ConeGeometry(0.27, 1, 12, 1, true);
    innerGeo.rotateX(Math.PI / 2); innerGeo.translate(0, 0, 0.5);
    const outer = new THREE.Mesh(this.track(outerGeo), this.matFlameOuter);
    const innerF = new THREE.Mesh(this.track(innerGeo), this.matFlameInner);
    flameGroup.add(outer, innerF);
    this.parts.diamonds = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.16, 8, 6)), this.matFlameInner);
      d.position.z = 0.14 + i * 0.16;
      flameGroup.add(d);
      this.parts.diamonds.push(d);
    }
    flameGroup.visible = false;
    this.group.add(flameGroup);
    this.parts.flame = flameGroup;
  }

  buildGear() {
    const wheelBottom = F35.wheelBottomY;
    this.parts.gear = {};
    const strutMat = this.m.metalSmooth;
    const mkWheel = (r, w) => {
      const g = new THREE.Group();
      const tire = new THREE.CylinderGeometry(r, r, w, 18); tire.rotateZ(Math.PI / 2);
      const rim = new THREE.CylinderGeometry(r * 0.58, r * 0.58, w + 0.02, 12); rim.rotateZ(Math.PI / 2);
      const hub = new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.06, 8); hub.rotateZ(Math.PI / 2);
      g.add(new THREE.Mesh(this.track(tire), this.m.tire));
      g.add(new THREE.Mesh(this.track(rim), this.m.metalSmooth));
      g.add(new THREE.Mesh(this.track(hub), this.m.dark));
      return g;
    };
    // Burun takımı: öne katlanır
    {
      const pivot = new THREE.Group();
      const s = F35.cgStation + F35.noseGearZ;
      const topY = bodyBottom(s) + 0.05;
      pivot.position.set(0, topY, F35.noseGearZ);
      const r = 0.27;
      const strutLen = topY - (wheelBottom + r);
      const strut = new THREE.CylinderGeometry(0.07, 0.08, strutLen * 0.6, 10); strut.translate(0, -strutLen * 0.3, 0);
      pivot.add(new THREE.Mesh(this.track(strut), strutMat));
      const oleo = new THREE.CylinderGeometry(0.05, 0.05, strutLen * 0.5, 10); oleo.translate(0, -strutLen * 0.75, 0);
      pivot.add(new THREE.Mesh(this.track(oleo), this.track(new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.2, metalness: 0.9 }))));
      const fork = new THREE.BoxGeometry(0.24, 0.32, 0.1); fork.translate(0, -strutLen + 0.1, 0);
      pivot.add(new THREE.Mesh(this.track(fork), strutMat));
      const drag = new THREE.CylinderGeometry(0.03, 0.03, strutLen * 0.7, 6); drag.rotateX(0.5); drag.translate(0, -strutLen * 0.4, 0.25);
      pivot.add(new THREE.Mesh(this.track(drag), strutMat));
      const wheel = mkWheel(r, 0.2); wheel.position.set(0, -strutLen, 0);
      pivot.add(wheel);
      const lamp = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.06, 8, 6)), this.track(new THREE.MeshBasicMaterial({ color: 0xffffff })));
      lamp.position.set(0, -strutLen * 0.45, -0.1);
      pivot.add(lamp);
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      // Kapaklar (gövdeye bağlı, takımla açılır)
      const doors = [];
      for (const side of [-1, 1]) {
        const dp = new THREE.Group();
        dp.position.set(side * 0.34, bodyBottom(s) + 0.02, F35.noseGearZ + 0.2);
        const door = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.03, 0.62, 1.7)), this.m.paint);
        door.position.set(0, -0.31, 0);
        dp.add(door);
        this.group.add(dp);
        doors.push({ pivot: dp, sign: side });
      }
      this.parts.gear.nose = { pivot, wheel, retractAxis: 'x', retractSign: -1, doors, radius: r };
    }
    // Ana takımlar: içe katlanır
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const s = F35.cgStation + F35.mainGearZ;
      const topY = bodyBottom(s) + 0.1;
      pivot.position.set(side * F35.mainGearX, topY, F35.mainGearZ);
      const r = 0.37;
      const strutLen = topY - (wheelBottom + r);
      const strut = new THREE.CylinderGeometry(0.09, 0.1, strutLen * 0.62, 10); strut.translate(0, -strutLen * 0.31, 0);
      pivot.add(new THREE.Mesh(this.track(strut), strutMat));
      const oleo = new THREE.CylinderGeometry(0.06, 0.06, strutLen * 0.5, 10); oleo.translate(0, -strutLen * 0.75, 0);
      pivot.add(new THREE.Mesh(this.track(oleo), this.track(new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.2, metalness: 0.9 }))));
      const brace = new THREE.CylinderGeometry(0.04, 0.04, strutLen * 0.85, 6); brace.rotateZ(side * 0.55); brace.translate(side * -0.22, -strutLen * 0.42, 0.06);
      pivot.add(new THREE.Mesh(this.track(brace), strutMat));
      const wheel = mkWheel(r, 0.3); wheel.position.set(side * 0.12, -strutLen, 0);
      pivot.add(wheel);
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      const dp = new THREE.Group();
      dp.position.set(side * (F35.mainGearX - 0.5), bodyBottom(s) + 0.02, F35.mainGearZ);
      const door = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.03, 0.9, 1.5)), this.m.paint);
      door.position.set(0, -0.45, 0);
      dp.add(door);
      this.group.add(dp);
      this.parts.gear[side < 0 ? 'left' : 'right'] = { pivot, wheel, retractAxis: 'z', retractSign: side, doors: [{ pivot: dp, sign: -side }], radius: r };
    }
  }

  buildDetails() {
    const m = this.m;
    // EOTS: burun altı çok yüzlü pencere
    const eots = new THREE.ConeGeometry(0.2, 0.32, 6, 1, false);
    eots.rotateX(Math.PI);
    eots.translate(0, bodyBottom(2.2) - 0.06, st(2.2));
    this.group.add(new THREE.Mesh(this.track(eots), m.glass));
    // Silah bombesi: sol kanat kökü üst yüzeyi
    const gun = new THREE.CapsuleGeometry(0.16, 1.6, 4, 10);
    gun.rotateX(Math.PI / 2);
    gun.translate(-1.1, 0.22, st(8.7));
    this.paintGeos.push(gun);
    const gunPort = new THREE.CircleGeometry(0.06, 8);
    gunPort.translate(-1.1, 0.22, st(7.85) - 0.01);
    this.group.add(new THREE.Mesh(this.track(gunPort), m.dark));
    // Silah yuvası kapakları: gövde altı çıkartması
    const bayTex = this.track(makeBayDoorTexture(1024, 512));
    const bayMat = this.track(new THREE.MeshStandardMaterial({ map: bayTex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    const bay = new THREE.Mesh(this.track(new THREE.PlaneGeometry(2.8, 4.2)), bayMat);
    bay.position.set(0, bodyBottom(9.0) - 0.012, st(8.9));
    bay.rotation.x = Math.PI / 2;
    this.group.add(bay);
    // Yakıt ikmal kapağı (sırt)
    const rec = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.36)), this.track(new THREE.MeshStandardMaterial({ color: 0x5c6167, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 })));
    rec.position.set(0, bodyTop(7.5) + 0.012, st(7.5));
    rec.rotation.x = -Math.PI / 2;
    this.group.add(rec);
    // Formasyon ışık şeritleri (gövde yanları)
    for (const side of [-1, 1]) {
      const fl = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.2, 0.07)), m.formLight);
      fl.position.set(side * (bodyHalfWidth(9.4) + 0.01), -0.2, st(9.4));
      fl.rotation.y = side * Math.PI / 2;
      this.group.add(fl);
      const fl2 = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.06, 0.6)), m.formLight);
      fl2.position.set(side * 0.45, bodyTop(2.0) - 0.02, st(2.6));
      fl2.rotation.x = -Math.PI / 2;
      fl2.rotation.z = side * 0.3;
      this.group.add(fl2);
    }
    // Antenler
    const ant1 = new THREE.BoxGeometry(0.03, 0.18, 0.4); ant1.translate(0.3, bodyBottom(6.2) - 0.09, st(6.2));
    this.paintGeos.push(ant1);
    const ant2 = new THREE.BoxGeometry(0.03, 0.14, 0.3); ant2.translate(0, bodyTop(10.2) + 0.07, st(10.2));
    this.paintGeos.push(ant2);
  }

  buildLights() {
    const P = this.wingPlanform();
    const mk = (mat, x, y, z) => { const m = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.07, 8, 6)), mat); m.position.set(x, y, z); this.group.add(m); return m; };
    this.matNavRed = this.track(new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.matNavGreen = this.track(new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
    this.matStrobe = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const tipS = (P.leTip + P.teTip) / 2;
    this.parts.navLeft = mk(this.matNavRed, -P.tipX + 0.05, P.y, st(tipS));
    this.parts.navRight = mk(this.matNavGreen, P.tipX - 0.05, P.y, st(tipS));
    this.parts.strobe = mk(this.matStrobe, 0, bodyTop(13.0) + 0.05, st(13.0));
  }

  buildMarkings() {
    const P = this.wingPlanform();
    const insig = this.track(makeInsigniaTexture(256));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: insig, transparent: true, roughness: 0.7, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 }));
    const size = 1.5;
    for (const [side, up] of [[-1, 1], [1, -1]]) {
      const x = side * 3.4;
      const f = (3.4 - P.rootX) / (P.tipX - P.rootX);
      const le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f;
      const sMid = le + (te - le) * 0.42;
      const thick = (P.thickRoot + (P.thickTip - P.thickRoot) * f) * (te - le) * 0.5;
      const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(size * 1.9, size)), mat);
      mesh.position.set(x, P.y + up * (thick + 0.02), st(sMid));
      mesh.rotation.x = up > 0 ? -Math.PI / 2 : Math.PI / 2;
      mesh.rotation.z = up > 0 ? 0 : Math.PI;
      this.group.add(mesh);
    }
    for (const side of [-1, 1]) {
      const mesh = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.9, 0.5)), mat);
      mesh.position.set(side * (bodyHalfWidth(10.6) - 0.15), 0.3, st(10.6));
      mesh.rotation.y = side * Math.PI / 2;
      mesh.rotation.x = side * -0.4;
      this.group.add(mesh);
    }
    const cant = 22 * DEG;
    const txtMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeTextTexture('LF', { w: 256, h: 128, font: 'bold 96px Arial', color: '#9aa0a8' })), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    const serialMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeTextTexture('AF 15-5108', { w: 512, h: 128, font: 'bold 70px Arial', color: '#9aa0a8' })), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    for (const side of [-1, 1]) {
      const up = new THREE.Vector3(side * Math.sin(cant), Math.cos(cant), 0);
      const nrm = new THREE.Vector3(Math.cos(cant) * side, -Math.sin(cant), 0);
      const place = (mesh, hFrac, s, out) => {
        mesh.position.copy(new THREE.Vector3(side * 0.66, 0.42, st(s)).addScaledVector(up, 2.2 * hFrac).addScaledVector(nrm, out));
        mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -side), up, nrm));
        this.group.add(mesh);
      };
      place(new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.7, 0.35)), txtMat), 0.74, 13.3, 0.045);
      place(new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.2, 0.3)), serialMat), 0.24, 12.6, 0.05);
    }
  }

  finalize() {
    const geos = this.paintGeos.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of geos) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    const merged = this.track(mergeGeometries(geos, false));
    merged.computeVertexNormals();
    const body = new THREE.Mesh(merged, this.m.paint);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.parts.body = body;
    this.paintGeos.forEach((g) => g.dispose());
    this.group.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    this.wheelSpin = 0;
  }

  setCockpitView(on) {
    for (const p of this.parts.pilotParts) p.visible = !on;
    this.parts.canopy.material = on ? this.m.canopyInside : this.m.canopy;
  }

  setEnvironment(envMap) {
    this.group.traverse((o) => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.material.envMap = envMap; o.material.needsUpdate = true; }
    });
  }

  // Kontrol yüzeyleri ve efektler. surfaces: {elevator, aileron, rudder} -1..1 (elevator +: burun yukarı)
  update({ elevator = 0, aileron = 0, rudder = 0, flaps = 0, gear = 1, throttle = 0, afterburner = 0, time = 0, groundSpeed = 0, dt = 0 }) {
    const p = this.parts;
    const stab = -elevator * 22 * DEG;
    p.stabs.left.rotation.x = stab - aileron * 5 * DEG;
    p.stabs.right.rotation.x = stab + aileron * 5 * DEG;
    const setHinge = (mesh, angle) => { mesh.quaternion.setFromAxisAngle(mesh.userData.axis, angle); };
    const ail = aileron * 22 * DEG;
    setHinge(p.ailerons.right, ail);
    setHinge(p.ailerons.left, ail);
    const flapAngle = flaps * 28 * DEG;
    setHinge(p.flaps.right, flapAngle + aileron * 10 * DEG);
    setHinge(p.flaps.left, flapAngle - aileron * 10 * DEG);
    const rud = rudder * 25 * DEG;
    setHinge(p.rudders.right, -rud);
    setHinge(p.rudders.left, -rud);
    // İniş takımı ve kapaklar
    this.wheelSpin += (groundSpeed / 0.35) * dt;
    for (const key of ['nose', 'left', 'right']) {
      const g = p.gear[key];
      const a = (1 - gear) * Math.PI / 2 * g.retractSign;
      g.pivot.rotation.set(0, 0, 0);
      if (g.retractAxis === 'x') g.pivot.rotation.x = a; else g.pivot.rotation.z = a;
      g.pivot.visible = gear > 0.001;
      g.wheel.rotation.x = this.wheelSpin * 0.35 / g.radius;
      const doorOpen = Math.min(1, gear * 1.4);
      for (const d of g.doors) d.pivot.rotation.z = d.sign * (Math.PI / 2) * (1 - doorOpen) + d.sign * 0.35 * doorOpen;
    }
    // Motor parıltısı ve art yakıcı
    this.matGlow.opacity = Math.max(0, throttle - 0.6) * 0.8 + afterburner * 0.6;
    if (afterburner > 0.02) {
      p.flame.visible = true;
      const flick = 0.92 + 0.08 * Math.sin(time * 90) * Math.sin(time * 37);
      const len = (2.5 + 4.5 * afterburner) * flick;
      p.flame.scale.set(0.9 + 0.2 * afterburner, 0.9 + 0.2 * afterburner, len);
      this.matFlameOuter.opacity = 0.12 + 0.14 * afterburner;
      this.matFlameInner.opacity = 0.16 + 0.18 * afterburner;
      p.diamonds.forEach((d, i) => { d.visible = afterburner > 0.3 + i * 0.15; d.scale.z = 0.35 / len; });
    } else {
      p.flame.visible = false;
    }
    const blink = (time % 1.2) < 0.08 || ((time + 0.25) % 1.2) < 0.08;
    p.strobe.visible = blink;
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
  }
}

// Apronda park halinde duran uçaklar için: malzemeye göre birleştirilmiş statik geometri listesi
export function buildStaticAircraftGeometries() {
  const ac = new F35A({ forStatic: true });
  ac.update({ gear: 1, time: 0 });
  ac.group.updateMatrixWorld(true);
  const byMat = new Map();
  ac.group.traverse((o) => {
    if (!o.isMesh || !o.visible) return;
    if (o.material === ac.matFlameOuter || o.material === ac.matFlameInner || o.material === ac.matGlow) return;
    if (o.parent && !o.parent.visible) return;
    let mat = o.material;
    if (Array.isArray(mat)) mat = mat[0];
    // Şeffaf/emisif küçük parçaları basitleştir
    if (mat.transparent && mat !== ac.m.canopy) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    const key = mat === ac.m.canopy ? 'canopy' : (mat.isMeshBasicMaterial ? 'basic' : mat === ac.m.tire ? 'tire' : (mat === ac.m.paint ? 'paint' : 'other'));
    if (!byMat.has(key)) byMat.set(key, { mat: key === 'other' ? ac.m.metal : mat, geos: [] });
    const ng = g.index ? g.toNonIndexed() : g;
    for (const a of Object.keys(ng.attributes)) if (!['position', 'normal', 'uv'].includes(a)) ng.deleteAttribute(a);
    if (!ng.attributes.uv) ng.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(ng.attributes.position.count * 2), 2));
    if (!ng.attributes.normal) ng.computeVertexNormals();
    byMat.get(key).geos.push(ng);
  });
  const out = [];
  for (const [key, v] of byMat) {
    if (key === 'basic') continue;
    const merged = mergeGeometries(v.geos, false);
    if (merged) out.push({ key, geometry: merged, material: v.mat });
  }
  // Geçici uçağın kendi geometrilerini serbest bırak (malzemeler paylaşımlı)
  for (const d of ac.disposables) if (d && d.isBufferGeometry) d.dispose();
  return out;
}
