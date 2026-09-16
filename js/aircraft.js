// F-35A Lightning II – tamamen kod ile üretilen, gerçek ölçekli model.
// Eksenler: burun -Z, üst +Y, sağ kanat +X. Uzunluk 15.7 m, açıklık 10.7 m, yükseklik 4.4 m.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeStealthPanelTexture, makeRoughnessTexture, makeInsigniaTexture, makeTextTexture } from './textures.js';

const DEG = Math.PI / 180;
export const F35 = {
  length: 15.7, span: 10.7, height: 4.4,
  cgStation: 8.0,          // orijin (ağırlık merkezi) burundan itibaren
  wheelBottomY: -2.2,      // tekerlek altı (gövde merkez hattına göre)
  noseGearZ: -4.1, mainGearZ: 0.9, mainGearX: 1.7,
  pilotEye: new THREE.Vector3(0, 1.32, -3.45),
};

function st(s) { return s - F35.cgStation; } // istasyon -> z

// ---- Gövde kesit tablosu: [s, yarıGenişlik, üstYükseklik, altDerinlik, merkezY, chine, altDüzlük]
const BODY_SECTIONS = [
  [0.0, 0.03, 0.03, 0.03, 0.06, 0.9, 2.0],
  [0.5, 0.20, 0.19, 0.15, 0.03, 0.85, 2.2],
  [1.4, 0.42, 0.38, 0.30, 0.0, 0.72, 2.4],
  [2.6, 0.66, 0.56, 0.44, 0.0, 0.58, 2.6],
  [3.6, 0.84, 0.66, 0.54, 0.02, 0.48, 2.8],
  [4.6, 1.00, 0.72, 0.64, 0.0, 0.42, 3.0],
  [5.6, 1.30, 0.78, 0.76, -0.05, 0.36, 3.2],
  [6.8, 1.62, 0.82, 0.86, -0.06, 0.32, 3.4],
  [8.2, 1.78, 0.84, 0.90, -0.06, 0.30, 3.4],
  [9.8, 1.74, 0.82, 0.88, -0.05, 0.30, 3.4],
  [11.4, 1.50, 0.74, 0.74, -0.02, 0.34, 3.2],
  [12.8, 1.12, 0.64, 0.58, 0.04, 0.38, 3.0],
  [13.9, 0.78, 0.56, 0.50, 0.10, 0.30, 2.6],
  [14.7, 0.58, 0.50, 0.48, 0.12, 0.1, 2.2],
];

function lerpSection(s) {
  const T = BODY_SECTIONS;
  if (s <= T[0][0]) return T[0].slice();
  if (s >= T[T.length - 1][0]) return T[T.length - 1].slice();
  for (let i = 0; i < T.length - 1; i++) {
    if (s >= T[i][0] && s <= T[i + 1][0]) {
      const t = (s - T[i][0]) / (T[i + 1][0] - T[i][0]);
      const sm = t * t * (3 - 2 * t);
      return T[i].map((v, k) => (k === 0 ? s : v + (T[i + 1][k] - v) * sm));
    }
  }
  return T[0].slice();
}
export function bodyTop(s) { const c = lerpSection(s); return c[4] + c[2]; }
export function bodyBottom(s) { const c = lerpSection(s); return c[4] - c[3]; }
export function bodyHalfWidth(s) { return lerpSection(s)[1]; }

// Kesit noktası: süperelips + chine (baklava) karışımı
function sectionPoint(sec, theta) {
  const [, w, ht, hb, yc, chine, nb] = sec;
  const c = Math.cos(theta), sn = Math.sin(theta);
  const top = sn >= 0;
  const n = top ? 2.15 : nb;
  const h = top ? ht : hb;
  // süperelips
  const ax = Math.abs(c), ay = Math.abs(sn);
  const denom = Math.pow(Math.pow(ax, n) + Math.pow(ay, n), 1 / n) || 1;
  let x = (c / denom) * w, y = (sn / denom) * h;
  // baklava (chine)
  const dr = 1 / (ax / w + ay / h);
  const dx = c * dr, dy = sn * dr;
  const k = chine * Math.pow(ax, 3);
  x = x + (dx - x) * k; y = y + (dy - y) * k;
  return { x, y: y + yc };
}

// Genel loft: sections[i] = [{x,y,z}], hepsi aynı uzunlukta. Otomatik dışa bakan yüz sarımı.
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

// Normallerin dışa baktığını garanti et (ağırlık merkezine göre)
function ensureOutward(g) {
  g.computeBoundingBox();
  const c = new THREE.Vector3();
  g.boundingBox.getCenter(c);
  const p = g.attributes.position, nrm = g.attributes.normal;
  let score = 0;
  const v = new THREE.Vector3(), nn = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).sub(c);
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

// NACA benzeri simetrik kalınlık dağılımı (0..1 kord)
function naca(t, thick) {
  const x = Math.min(1, Math.max(0, t));
  const y = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  return Math.max(0, y);
}

// Kanat profili noktaları: TE üst -> LE -> TE alt.  chordFrac0..chordFrac1 aralığı (kesilmiş kanatlar için)
function airfoilPoints(K, chord, thickFrac, tStart = 0, tEnd = 1, sharpEnd = true) {
  const pts = [];
  for (let i = 0; i <= K; i++) { // üst yüzey: TE -> LE
    const t = tEnd - (tEnd - tStart) * (i / K);
    let y = naca(t, thickFrac) * chord;
    if (!sharpEnd && i === 0) y = naca(tEnd, thickFrac) * chord;
    pts.push({ c: t, y });
  }
  for (let i = 1; i <= K; i++) { // alt yüzey: LE -> TE
    const t = tStart + (tEnd - tStart) * (i / K);
    pts.push({ c: t, y: -naca(t, thickFrac) * chord });
  }
  return pts;
}

export class F35A {
  constructor({ quality = 'medium' } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'F-35A';
    this.parts = {};
    this.disposables = [];
    this.q = quality;
    this.buildMaterials();
    this.buildFuselage();
    this.buildIntakes();
    this.buildCanopy();
    this.buildWings();
    this.buildTails();
    this.buildNozzle();
    this.buildGear();
    this.buildLights();
    this.buildMarkings();
    this.finalize();
  }

  track(o) { this.disposables.push(o); return o; }

  buildMaterials() {
    const panel = this.track(makeStealthPanelTexture(1024));
    panel.repeat.set(1, 1);
    const rough = this.track(makeRoughnessTexture(512));
    this.matPaint = this.track(new THREE.MeshStandardMaterial({
      color: 0xe4e8ec, map: panel, roughnessMap: rough, roughness: 0.72, metalness: 0.25, envMapIntensity: 0.7,
    }));
    this.matDark = this.track(new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9, metalness: 0.1 }));
    this.matMetal = this.track(new THREE.MeshStandardMaterial({ color: 0x8e9196, roughness: 0.45, metalness: 0.9, flatShading: true, envMapIntensity: 0.8 }));
    this.matMetalSmooth = this.track(new THREE.MeshStandardMaterial({ color: 0xa4a7ab, roughness: 0.4, metalness: 0.85 }));
    this.matCanopy = this.track(new THREE.MeshPhysicalMaterial({
      color: 0xc99b2a, metalness: 0.55, roughness: 0.08, transparent: true, opacity: 0.55,
      clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.4, side: THREE.DoubleSide, depthWrite: false,
    }));
    this.matTire = this.track(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }));
    this.matCockpit = this.track(new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.9 }));
    this.matPilot = this.track(new THREE.MeshStandardMaterial({ color: 0x3c4a3a, roughness: 0.8 }));
    this.matHelmet = this.track(new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.3, metalness: 0.3 }));
    this.matFlameOuter = this.track(new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.matFlameInner = this.track(new THREE.MeshBasicMaterial({ color: 0x88b8ff, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.matGlow = this.track(new THREE.MeshBasicMaterial({ color: 0xff5a10, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.matNavRed = this.track(new THREE.MeshBasicMaterial({ color: 0xff2020 }));
    this.matNavGreen = this.track(new THREE.MeshBasicMaterial({ color: 0x20ff40 }));
    this.matStrobe = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff }));
    this.paintGeos = []; // birleştirilecek sabit boyalı parçalar
  }

  buildFuselage() {
    const H = 18; // yarım kesit çözünürlüğü
    const top = [], bottom = [];
    const sMax = 14.7;
    for (let s = 0; s <= sMax + 1e-6; s += 0.2) {
      const sec = lerpSection(Math.min(s, sMax));
      const z = st(s);
      const tRow = [], bRow = [];
      for (let k = 0; k <= H; k++) {
        const th = (k / H) * Math.PI;
        const p = sectionPoint(sec, th);
        tRow.push({ x: p.x, y: p.y, z });
        const p2 = sectionPoint(sec, Math.PI + th);
        bRow.push({ x: p2.x, y: p2.y, z });
      }
      top.push(tRow); bottom.push(bRow);
    }
    const gTop = ensureOutward(loft(top, { uScale: 3, vScale: 1 }));
    const gBot = ensureOutward(loft(bottom, { uScale: 3, vScale: 1 }));
    this.paintGeos.push(gTop, gBot);
    // Kuyruk kapağı (koyu), nozul tabanı
    const cap = new THREE.CircleGeometry(0.56, 24);
    cap.translate(0, 0.12, st(14.7));
    this.group.add(new THREE.Mesh(this.track(cap), this.matDark));
    // EOTS penceresi (burun altı, yönlü küçük kristal)
    const eots = new THREE.ConeGeometry(0.22, 0.35, 6);
    eots.rotateX(Math.PI);
    eots.translate(0, bodyBottom(2.4) - 0.08, st(2.4));
    this.group.add(new THREE.Mesh(this.track(eots), this.matDark));
  }

  buildIntakes() {
    // DSI tümseği + yanak kanalı; her iki taraf
    for (const side of [-1, 1]) {
      const secs = [];
      const stations = [
        { s: 4.55, cx: 0.92, cy: -0.10, w: 0.42, h: 0.62, cant: 0.12 },
        { s: 5.3, cx: 1.20, cy: -0.14, w: 0.50, h: 0.72, cant: 0.08 },
        { s: 6.4, cx: 1.40, cy: -0.14, w: 0.46, h: 0.78, cant: 0.02 },
        { s: 7.8, cx: 1.42, cy: -0.10, w: 0.36, h: 0.74, cant: 0 },
        { s: 9.2, cx: 1.30, cy: -0.05, w: 0.20, h: 0.55, cant: 0 },
      ];
      const M = 16;
      for (const t of stations) {
        const row = [];
        for (let k = 0; k <= M; k++) {
          const th = (k / M) * Math.PI * 2;
          const c = Math.cos(th), sn = Math.sin(th);
          const n = 2.6;
          const d = Math.pow(Math.pow(Math.abs(c), n) + Math.pow(Math.abs(sn), n), 1 / n);
          const x = (c / d) * t.w, y = (sn / d) * t.h;
          // Dış dudak geriye süpürülmüş: dış tarafta z artar
          const sweep = 0.55 * (x / t.w + 1) * 0.5;
          row.push({ x: side * (t.cx + x + t.cant * y), y: t.cy + y, z: st(t.s + sweep * (t.s < 5 ? 1 : 0.2)) });
        }
        secs.push(row);
      }
      const g = ensureOutward(loft(secs, { uScale: 1, vScale: 1, closeRing: false }));
      this.paintGeos.push(g);
      // Kanal ağzı (karanlık) – dudak kesitinin biraz içine yerleştirilmiş kapak
      const lip = stations[0];
      const mouth = new THREE.CircleGeometry(1, 20);
      mouth.scale(lip.w * 0.9, lip.h * 0.9, 1);
      mouth.translate(0, 0, 0.04);
      const mm = new THREE.Mesh(this.track(mouth), this.matDark);
      mm.position.set(side * lip.cx, lip.cy, st(lip.s + 0.25));
      mm.rotation.y = side * 0.35;
      this.group.add(mm);
      // DSI tümseği: gövde yanında, ağız önünde
      const bump = new THREE.SphereGeometry(1, 20, 14);
      bump.scale(0.38, 0.5, 1.15);
      bump.translate(side * (bodyHalfWidth(4.6) - 0.05), -0.12, st(4.75));
      this.paintGeos.push(bump);
    }
  }

  buildCanopy() {
    // Kokpit çukuru
    const tub = new THREE.BoxGeometry(0.9, 0.5, 2.4);
    tub.translate(0, bodyTop(4.6) - 0.15, st(4.6));
    this.group.add(new THREE.Mesh(this.track(tub), this.matCockpit));
    // Pilot: gövde + kask
    const torso = new THREE.CylinderGeometry(0.22, 0.26, 0.6, 10);
    torso.translate(0, bodyTop(4.7) + 0.12, st(4.7));
    const torsoMesh = new THREE.Mesh(this.track(torso), this.matPilot);
    this.group.add(torsoMesh);
    const helmet = new THREE.SphereGeometry(0.17, 12, 10);
    helmet.translate(0, bodyTop(4.65) + 0.55, st(4.65));
    const helmetMesh = new THREE.Mesh(this.track(helmet), this.matHelmet);
    this.group.add(helmetMesh);
    // Ejeksiyon koltuğu başlığı
    const seat = new THREE.BoxGeometry(0.5, 0.75, 0.25);
    seat.translate(0, bodyTop(5.2) + 0.25, st(5.25));
    const seatMesh = new THREE.Mesh(this.track(seat), this.matCockpit);
    this.group.add(seatMesh);
    // Gösterge paneli (kokpit görünümünde referans)
    const dash = new THREE.BoxGeometry(0.8, 0.2, 0.35);
    dash.translate(0, bodyTop(3.9) + 0.12, st(3.95));
    const dashMesh = new THREE.Mesh(this.track(dash), this.matCockpit);
    this.group.add(dashMesh);
    this.parts.pilotParts = [torsoMesh, helmetMesh, seatMesh];
    // Kanopi loft'u (yarım elips kesitler)
    const profile = [
      [3.05, 0.06, 0.04], [3.35, 0.36, 0.34], [3.8, 0.52, 0.66], [4.3, 0.58, 0.86], [4.9, 0.58, 0.88],
      [5.5, 0.54, 0.74], [6.1, 0.42, 0.44], [6.55, 0.22, 0.14], [6.75, 0.06, 0.03],
    ];
    const rows = [];
    const M = 14;
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
    const canopy = new THREE.Mesh(g, this.matCanopy);
    canopy.renderOrder = 5;
    this.group.add(canopy);
    this.parts.canopy = canopy;
    // Ön cam çerçevesi (bow frame) ve kanopi kenar çıtası
    const bowRow = [];
    const bow = [];
    for (let k = 0; k <= M; k++) {
      const th = (k / M) * Math.PI;
      const w = 0.50, h = 0.60, s = 3.72;
      bow.push({ x: Math.cos(th) * w, y: bodyTop(s) - 0.02 + Math.sin(th) * h, z: st(s) });
      bowRow.push({ x: Math.cos(th) * (w + 0.04), y: bodyTop(s) - 0.02 + Math.sin(th) * (h + 0.04), z: st(s) + 0.06 });
    }
    const bowGeo = this.track(loft([bow, bowRow], { uScale: 1, vScale: 1 }));
    this.group.add(new THREE.Mesh(bowGeo, this.matDark));
    const sillGeo = new THREE.BoxGeometry(1.2, 0.05, 3.6);
    sillGeo.translate(0, bodyTop(4.9) - 0.03, st(4.9));
    this.group.add(new THREE.Mesh(this.track(sillGeo), this.matDark));
  }

  // Kanat düzlemi tanımı (sağ kanat için; sol aynalanır)
  wingPlanform() {
    return {
      rootX: 1.35, tipX: 5.35,
      leRoot: 6.55, teRoot: 12.55, leTip: 9.15, teTip: 11.55,
      thickRoot: 0.05, thickTip: 0.035, y: -0.18, hinge: 0.76,
    };
  }

  buildWingPanel(side, x0, x1, P, { cStart = 0, cEnd = 1, hingeLocal = null, thickScale = 1, K = 10, N = 6 } = {}) {
    // Belirli açıklık aralığı ve kord aralığı için loft geometrisi
    const rows = [];
    for (let j = 0; j <= N; j++) {
      const x = x0 + (x1 - x0) * (j / N);
      const f = (x - P.rootX) / (P.tipX - P.rootX);
      const le = P.leRoot + (P.leTip - P.leRoot) * f;
      const te = P.teRoot + (P.teTip - P.teRoot) * f;
      const chord = te - le;
      const thick = (P.thickRoot + (P.thickTip - P.thickRoot) * f) * thickScale;
      const pts = airfoilPoints(K, chord, thick, cStart, cEnd);
      rows.push(pts.map((p) => {
        let z = st(le + chord * p.c), y = P.y + p.y;
        let xx = side * x;
        if (hingeLocal) { // menteşe çizgisine göre yerel koordinat
          const hz = st(le + chord * hingeLocal.c);
          z -= hz + hingeLocal.dz(f);
          y -= P.y;
          xx -= hingeLocal.x;
        }
        return { x: xx, y, z };
      }));
    }
    return ensureOutward(loft(rows, { uScale: 2, vScale: 1 }));
  }

  buildWings() {
    const P = this.wingPlanform();
    this.parts.ailerons = {}; this.parts.flaps = {};
    for (const side of [-1, 1]) {
      // Ana kanat (menteşeye kadar)
      const main = this.buildWingPanel(side, P.rootX - 0.3, P.tipX, P, { cStart: 0, cEnd: P.hinge, K: 12, N: 8 });
      this.paintGeos.push(main);
      // Kanat ucu kapaması: ince, ihmal edilebilir. Kanat kökü (gövde içinde).
      // Kontrol yüzeyleri: flaperon (iç) ve kanatçık (dış)
      const surfaces = [
        { key: 'flaps', x0: P.rootX + 0.05, x1: 3.35 },
        { key: 'ailerons', x0: 3.45, x1: P.tipX - 0.1 },
      ];
      for (const sf of surfaces) {
        const xm = (sf.x0 + sf.x1) / 2;
        const fm = (xm - P.rootX) / (P.tipX - P.rootX);
        const leM = P.leRoot + (P.leTip - P.leRoot) * fm;
        const teM = P.teRoot + (P.teTip - P.teRoot) * fm;
        const hingeS = leM + (teM - leM) * P.hinge;
        // Menteşe doğrultusu (süpürülmüş)
        const f0 = (sf.x0 - P.rootX) / (P.tipX - P.rootX), f1 = (sf.x1 - P.rootX) / (P.tipX - P.rootX);
        const hs0 = (P.leRoot + (P.leTip - P.leRoot) * f0) + ((P.teRoot + (P.teTip - P.teRoot) * f0) - (P.leRoot + (P.leTip - P.leRoot) * f0)) * P.hinge;
        const hs1 = (P.leRoot + (P.leTip - P.leRoot) * f1) + ((P.teRoot + (P.teTip - P.teRoot) * f1) - (P.leRoot + (P.leTip - P.leRoot) * f1)) * P.hinge;
        const axis = new THREE.Vector3(side * (sf.x1 - sf.x0), 0, hs1 - hs0).normalize();
        const geo = this.buildWingPanel(side, sf.x0, sf.x1, P, {
          cStart: P.hinge - 0.01, cEnd: 1, K: 5, N: 3, thickScale: 1,
          hingeLocal: { c: P.hinge, x: side * xm, dz: () => 0 },
        });
        // hingeLocal z: her istasyonun kendi menteşe noktasına göre; süpürme için gerçek menteşe hattına çevir
        // (menteşe hattı düz olduğundan, istasyon başına z-kayması axis ile hesaplanır)
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          const x = pos.getX(i);
          // yerel x'ten menteşe hattı üzerindeki z ofsetini geri ekle
          const f = (side * x + xm - P.rootX) / (P.tipX - P.rootX);
          const le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f;
          const hz = le + (te - le) * P.hinge;
          pos.setZ(i, pos.getZ(i) + (hz - hingeS));
        }
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(this.track(geo), this.matPaint);
        mesh.position.set(side * xm, P.y, st(hingeS));
        mesh.castShadow = true;
        mesh.userData.axis = axis;
        this.group.add(mesh);
        this.parts[sf.key][side < 0 ? 'left' : 'right'] = mesh;
      }
    }
  }

  buildTails() {
    // Stabilatörler (tamamı hareketli)
    this.parts.stabs = {};
    const S = { rootX: 0.75, tipX: 3.45, leRoot: 12.35, teRoot: 15.75, leTip: 14.35, teTip: 15.55, thickRoot: 0.045, thickTip: 0.035, y: -0.05, pivot: 14.25 };
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
      const mesh = new THREE.Mesh(geo, this.matPaint);
      mesh.position.set(0, S.y, st(S.pivot));
      mesh.castShadow = true;
      this.group.add(mesh);
      this.parts.stabs[side < 0 ? 'left' : 'right'] = mesh;
      // Stabilatör mili yuvası
      const boom = new THREE.CylinderGeometry(0.16, 0.12, 0.6, 8);
      boom.rotateZ(Math.PI / 2);
      boom.translate(side * (S.rootX - 0.1), S.y, st(S.pivot));
      this.paintGeos.push(boom);
    }
    // Dikey kuyruklar (dışa 22° eğik) + dümenler
    this.parts.rudders = {};
    const cant = 22 * DEG;
    const V = { rootLE: 10.6, rootTE: 14.15, tipLE: 13.0, tipTE: 14.45, height: 2.15, rootX: 0.62, rootY: 0.55, hinge: 0.68 };
    for (const side of [-1, 1]) {
      const up = new THREE.Vector3(side * Math.sin(cant), Math.cos(cant), 0);
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
            // Kalınlık kanat düzlemine dik yönde (normal = up x z)
            const nrm = new THREE.Vector3(Math.cos(cant) * side, -Math.sin(cant), 0);
            let z = st(le + chord * p.c);
            if (local) z -= st(le + chord * V.hinge) - local.dz(f);
            const px = base.x + nrm.x * p.y, py = base.y + nrm.y * p.y;
            return { x: px - (local ? local.x : 0), y: py - (local ? local.y : 0), z };
          }));
        }
        return rows;
      };
      const fin = this.track(ensureOutward(loft(mkRows(0, V.hinge), { uScale: 1.5, vScale: 1 })));
      this.paintGeos.push(fin);
      // Dümen: menteşe hattı süpürülmüş; yerel orijin kök menteşe noktası
      const hingeRoot = V.rootLE + (V.rootTE - V.rootLE) * V.hinge;
      const hingeTip = V.tipLE + (V.tipTE - V.tipLE) * V.hinge;
      const local = { x: side * V.rootX, y: V.rootY, dz: (f) => st(hingeRoot + (hingeTip - hingeRoot) * f) - st(hingeRoot) };
      const rudGeo = this.track(ensureOutward(loft(mkRows(V.hinge - 0.01, 1, local), { uScale: 1, vScale: 1 })));
      const rud = new THREE.Mesh(rudGeo, this.matPaint);
      rud.position.set(side * V.rootX, V.rootY, st(hingeRoot));
      rud.castShadow = true;
      rud.userData.axis = new THREE.Vector3().copy(up).multiplyScalar(V.height).add(new THREE.Vector3(0, 0, st(hingeTip) - st(hingeRoot))).normalize();
      this.group.add(rud);
      this.parts.rudders[side < 0 ? 'left' : 'right'] = rud;
      // Kuyruk ucu ışığı / anten (küçük)
      const tipPos = new THREE.Vector3(side * V.rootX, V.rootY, 0).addScaledVector(up, V.height);
      this.parts['tailTip' + side] = tipPos;
    }
  }

  buildNozzle() {
    const z0 = st(14.65), len = 1.05;
    const petals = new THREE.CylinderGeometry(0.44, 0.56, len, 15, 1, true);
    petals.rotateX(Math.PI / 2);
    petals.translate(0, 0.12, z0 + len / 2);
    const nozzle = new THREE.Mesh(this.track(petals), this.matMetal);
    nozzle.castShadow = true;
    this.group.add(nozzle);
    this.parts.nozzle = nozzle;
    // İç koni ve türbin arka yüzü
    const inner = new THREE.CylinderGeometry(0.40, 0.48, len - 0.05, 15, 1, true);
    inner.rotateX(Math.PI / 2);
    inner.translate(0, 0.12, z0 + len / 2);
    const innerMat = this.track(new THREE.MeshStandardMaterial({ color: 0x222226, roughness: 0.8, metalness: 0.6, side: THREE.BackSide }));
    this.group.add(new THREE.Mesh(this.track(inner), innerMat));
    const turbine = new THREE.CircleGeometry(0.47, 24);
    turbine.translate(0, 0.12, z0 + 0.06);
    this.group.add(new THREE.Mesh(this.track(turbine), this.matDark));
    // Motor parıltısı (askeri güçte kızıl, AB'de parlak)
    const glow = new THREE.CircleGeometry(0.40, 20);
    glow.translate(0, 0.12, z0 + 0.12);
    const glowMesh = new THREE.Mesh(this.track(glow), this.matGlow);
    this.group.add(glowMesh);
    this.parts.glow = glowMesh;
    // Art yakıcı alevi (dış + iç koni), z ekseninde geriye
    const flameGroup = new THREE.Group();
    flameGroup.position.set(0, 0.12, z0 + len - 0.05);
    const outerGeo = new THREE.ConeGeometry(0.42, 1, 16, 1, true);
    outerGeo.rotateX(Math.PI / 2);
    outerGeo.translate(0, 0, 0.5);
    const outer = new THREE.Mesh(this.track(outerGeo), this.matFlameOuter);
    const innerGeo = new THREE.ConeGeometry(0.26, 1, 12, 1, true);
    innerGeo.rotateX(Math.PI / 2);
    innerGeo.translate(0, 0, 0.5);
    const innerF = new THREE.Mesh(this.track(innerGeo), this.matFlameInner);
    flameGroup.add(outer, innerF);
    // Şok elmasları
    this.parts.diamonds = [];
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.16, 8, 6)), this.matFlameInner);
      d.position.z = 0.14 + i * 0.16;
      d.scale.set(1, 1, 1);
      flameGroup.add(d);
      this.parts.diamonds.push(d);
    }
    flameGroup.visible = false;
    this.group.add(flameGroup);
    this.parts.flame = flameGroup;
    this.parts.flameOuter = outer;
    this.parts.flameInner = innerF;
  }

  buildGear() {
    const wheelBottom = F35.wheelBottomY;
    this.parts.gear = {};
    const strutMat = this.matMetalSmooth;
    const mkWheel = (r, w) => {
      const tire = new THREE.CylinderGeometry(r, r, w, 16);
      tire.rotateZ(Math.PI / 2);
      const rim = new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12);
      rim.rotateZ(Math.PI / 2);
      const g = new THREE.Group();
      g.add(new THREE.Mesh(this.track(tire), this.matTire));
      g.add(new THREE.Mesh(this.track(rim), this.matMetalSmooth));
      return g;
    };
    // Burun takımı: menteşe gövde altında, öne katlanır
    {
      const pivot = new THREE.Group();
      const s = F35.cgStation + F35.noseGearZ;
      const topY = bodyBottom(s) + 0.05;
      pivot.position.set(0, topY, F35.noseGearZ);
      const r = 0.27;
      const strutLen = topY - (wheelBottom + r);
      const strut = new THREE.CylinderGeometry(0.06, 0.07, strutLen, 8);
      strut.translate(0, -strutLen / 2, 0);
      pivot.add(new THREE.Mesh(this.track(strut), strutMat));
      const fork = new THREE.BoxGeometry(0.22, 0.3, 0.1);
      fork.translate(0, -strutLen + 0.1, 0);
      pivot.add(new THREE.Mesh(this.track(fork), strutMat));
      const wheel = mkWheel(r, 0.18);
      wheel.position.set(0, -strutLen, 0);
      pivot.add(wheel);
      // Taksi ışığı
      const lamp = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.05, 8, 6)), this.matStrobe);
      lamp.position.set(0, -strutLen * 0.5, -0.1);
      pivot.add(lamp);
      // Kapaklar
      for (const side of [-1, 1]) {
        const door = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.03, 0.55, 1.5)), this.matPaint);
        door.position.set(side * 0.3, -0.2, 0.2);
        door.rotation.z = side * 0.35;
        pivot.add(door);
      }
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      this.parts.gear.nose = { pivot, wheel, retractAxis: 'x', retractSign: -1 };
    }
    // Ana takımlar: içe katlanır
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const s = F35.cgStation + F35.mainGearZ;
      const topY = bodyBottom(s) + 0.1;
      pivot.position.set(side * F35.mainGearX, topY, F35.mainGearZ);
      const r = 0.36;
      const strutLen = topY - (wheelBottom + r);
      const strut = new THREE.CylinderGeometry(0.08, 0.09, strutLen, 8);
      strut.translate(0, -strutLen / 2, 0);
      pivot.add(new THREE.Mesh(this.track(strut), strutMat));
      const brace = new THREE.CylinderGeometry(0.04, 0.04, strutLen * 0.8, 6);
      brace.rotateZ(side * 0.5);
      brace.translate(side * -0.18, -strutLen * 0.45, 0.05);
      pivot.add(new THREE.Mesh(this.track(brace), strutMat));
      const wheel = mkWheel(r, 0.28);
      wheel.position.set(side * 0.1, -strutLen, 0);
      pivot.add(wheel);
      const door = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.03, 0.8, 1.3)), this.matPaint);
      door.position.set(side * -0.4, -0.35, 0);
      door.rotation.z = side * 0.6;
      pivot.add(door);
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      this.parts.gear[side < 0 ? 'left' : 'right'] = { pivot, wheel, retractAxis: 'z', retractSign: side };
    }
  }

  buildLights() {
    const P = this.wingPlanform();
    const mk = (mat, x, y, z) => {
      const m = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.07, 8, 6)), mat);
      m.position.set(x, y, z);
      this.group.add(m);
      return m;
    };
    const tipS = (P.leTip + P.teTip) / 2;
    this.parts.navLeft = mk(this.matNavRed, -P.tipX + 0.05, P.y, st(tipS));
    this.parts.navRight = mk(this.matNavGreen, P.tipX - 0.05, P.y, st(tipS));
    const t = this.parts['tailTip1'];
    this.parts.strobe = mk(this.matStrobe, 0, bodyTop(13.5) + 0.05, st(13.6));
    this.parts.strobe2 = mk(this.matStrobe, t.x * 0.2, t.y, t.z + st(13.8) + 0.2);
    this.parts.strobe2.visible = false;
  }

  buildMarkings() {
    const P = this.wingPlanform();
    const insig = this.track(makeInsigniaTexture(256));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: insig, transparent: true, roughness: 0.7, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 }));
    const size = 1.5;
    // Sol kanat üstü, sağ kanat altı
    for (const [side, up] of [[-1, 1], [1, -1]]) {
      const x = side * 3.4;
      const f = (3.4 - P.rootX) / (P.tipX - P.rootX);
      const le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f;
      const sMid = le + (te - le) * 0.42;
      const thick = (P.thickRoot + (P.thickTip - P.thickRoot) * f) * (te - le) * 0.5;
      const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(size * 1.9, size)), mat);
      m.position.set(x, P.y + up * (thick + 0.02), st(sMid));
      m.rotation.x = up > 0 ? -Math.PI / 2 : Math.PI / 2;
      m.rotation.z = up > 0 ? 0 : Math.PI;
      this.group.add(m);
    }
    // Gövde yanı: hava alığı arkasında küçük amblem
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.9, 0.5)), mat);
      m.position.set(side * (bodyHalfWidth(10.6) - 0.1), 0.35, st(10.6));
      m.rotation.y = side * Math.PI / 2;
      m.rotation.x = side * -0.35;
      this.group.add(m);
    }
    // Kuyruk yazıları
    const cant = 22 * DEG;
    const txtMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeTextTexture('LF', { w: 256, h: 128, font: 'bold 96px Arial', color: '#9aa0a8' })), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    const serialMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeTextTexture('AF 15-5108', { w: 512, h: 128, font: 'bold 70px Arial', color: '#9aa0a8' })), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    for (const side of [-1, 1]) {
      const up = new THREE.Vector3(side * Math.sin(cant), Math.cos(cant), 0);
      const nrm = new THREE.Vector3(Math.cos(cant) * side, -Math.sin(cant), 0);
      const place = (mesh, hFrac, s, out) => {
        const base = new THREE.Vector3(side * 0.62, 0.55, st(s)).addScaledVector(up, 2.15 * hFrac).addScaledVector(nrm, out);
        mesh.position.copy(base);
        mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -side), up, nrm.clone().multiplyScalar(1)));
        this.group.add(mesh);
      };
      place(new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.7, 0.35)), txtMat), 0.72, 13.35, 0.045);
      place(new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.2, 0.3)), serialMat), 0.22, 12.7, 0.05);
    }
  }

  finalize() {
    // Sabit boyalı parçaları tek mesh'te birleştir
    const geos = this.paintGeos.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of geos) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    const merged = this.track(mergeGeometries(geos, false));
    merged.computeVertexNormals();
    const body = new THREE.Mesh(merged, this.matPaint);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.parts.body = body;
    this.paintGeos.forEach((g) => g.dispose());
    this.group.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    this._tmpQ = new THREE.Quaternion();
  }

  setCockpitView(on) {
    for (const m of this.parts.pilotParts) m.visible = !on;
    // İçeriden bakarken kanopi tonu hafif olsun
    this.matCanopy.opacity = on ? 0.16 : 0.55;
    this.matCanopy.side = on ? THREE.FrontSide : THREE.DoubleSide;
    this.matCanopy.needsUpdate = true;
  }

  setEnvironment(envMap) {
    this.group.traverse((o) => {
      if (o.isMesh && o.material && 'envMap' in o.material && o.material.isMeshStandardMaterial) {
        o.material.envMap = envMap;
        o.material.needsUpdate = true;
      }
    });
  }

  // Kontrol yüzeyleri ve efektlerin animasyonu
  // pitch: +1 burun yukarı, roll: +1 sağa yatış, yaw: +1 sağa
  update({ pitch = 0, roll = 0, yaw = 0, flaps = 0, gear = 1, throttle = 0, afterburner = 0, time = 0, engineRpm = 0 }) {
    const p = this.parts;
    // Stabilatörler: burun yukarı = firar kenarı yukarı (negatif x dönüşü)
    const stab = -pitch * 22 * DEG;
    p.stabs.left.rotation.x = stab - roll * 4 * DEG;
    p.stabs.right.rotation.x = stab + roll * 4 * DEG;
    // Kanatçıklar: sağa yatış -> sağ kanatçık yukarı
    const ail = roll * 22 * DEG;
    const setHinge = (mesh, angle) => { mesh.quaternion.setFromAxisAngle(mesh.userData.axis, angle); };
    // Sağ kanat için eksen +x yönlü: pozitif açı TE'yi aşağı çevirir (sağ el kuralı: z -> -y)
    setHinge(p.ailerons.right, ail);
    setHinge(p.ailerons.left, ail);
    const flapAngle = flaps * 28 * DEG;
    setHinge(p.flaps.right, flapAngle + roll * 10 * DEG);
    setHinge(p.flaps.left, flapAngle - roll * 10 * DEG);
    // Dümenler: sağa sapma -> TE sağa
    const rud = yaw * 25 * DEG;
    setHinge(p.rudders.right, -rud);
    setHinge(p.rudders.left, -rud);
    // İniş takımı
    for (const key of ['nose', 'left', 'right']) {
      const g = p.gear[key];
      const a = (1 - gear) * Math.PI / 2 * g.retractSign;
      g.pivot.rotation.set(0, 0, 0);
      if (g.retractAxis === 'x') g.pivot.rotation.x = a; else g.pivot.rotation.z = a;
      g.pivot.visible = gear > 0.001;
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
    // Seyir ışıkları / flaş
    const blink = (time % 1.2) < 0.08 || ((time + 0.25) % 1.2) < 0.08;
    p.strobe.visible = blink;
    // Tekerlek dönüşü basit
    this._wheelSpin = (this._wheelSpin || 0) + engineRpm * 0;
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
  }
}
