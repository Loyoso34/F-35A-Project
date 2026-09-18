// Airbus A321neo – tamamen kod ile üretilen, gerçek ölçekli model.
// Eksenler: burun -Z, üst +Y, sağ kanat +X. Uzunluk 44,51 m, açıklık 35,8 m, yükseklik 11,76 m.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, ensureOutward, airfoilPoints } from './aircraft.js';
import { makeAirlinerSkinTexture, makeAirbusScreenTexture, makeGlowTexture, makeRoughnessTexture } from './textures.js';

const DEG = Math.PI / 180;
export const A321 = {
  length: 44.51, span: 35.8, height: 11.76,
  cgStation: 20.6,
  wheelBottomY: -4.35,
  noseGearZ: 5.1 - 20.6, mainGearZ: 23.5 - 20.6, mainGearX: 3.8,
  pilotEye: new THREE.Vector3(-0.44, 0.92, 4.9 - 20.6),
};
const st = (s) => s - A321.cgStation;

// Gövde kesitleri: [istasyon, yarı genişlik, üst y, alt y].
// Kesit merkezi (yt+yb)/2'dir; böylece burun aşağı doğru kamburlanabilir (A320 ailesinin
// düşük radom ekseni). Radom ayrı bir küre değil, bu tablonun ilk parçasının loft'udur.
const SECTIONS = [
  [0.00, 0.050, -0.46, -0.66],   // radom ucu: gövde ekseninin ~0,56 m altında
  [0.35, 0.330, -0.11, -0.97],
  [0.80, 0.640, 0.26, -1.28],
  [1.40, 0.960, 0.66, -1.55],
  [2.10, 1.250, 1.02, -1.74],
  [2.85, 1.490, 1.34, -1.87],   // radom kökü / basınç perdesi
  [3.60, 1.680, 1.57, -1.94],   // ön cam tabanı
  [4.50, 1.820, 1.78, -2.00],   // kokpit tavanı
  [5.60, 1.930, 1.91, -2.04],
  [6.80, 1.975, 1.99, -2.06], [12.0, 1.975, 1.99, -2.06],
  [20.0, 1.975, 1.99, -2.06], [28.0, 1.975, 1.99, -2.06], [33.0, 1.97, 1.99, -2.04],
  [35.5, 1.90, 2.03, -1.86], [38.0, 1.66, 2.16, -1.38], [40.5, 1.30, 2.30, -0.76],
  [42.5, 0.88, 2.40, -0.18], [43.8, 0.48, 2.44, 0.30], [44.51, 0.10, 2.42, 0.72],
];
const RADOME_END = 5;            // SECTIONS içinde radom loft'unun bittiği indeks (istasyon 2,85)
const NS = 15;                                    // kesit başına nokta (tam halka = 2*NS)
const SE = 2.15;                                  // süperelips üssü (dolgun yuvarlak kesit)
function ring(sec) {
  const [s, r, yt, yb] = sec, z = st(s), out = [];
  const cy = (yt + yb) / 2, hy = (yt - yb) / 2;               // kesit merkezi ve yarı yüksekliği
  for (let i = 0; i < 2 * NS; i++) {
    const ang = Math.PI / 2 - (i / (2 * NS - 1)) * Math.PI;   // sağ yarı: üstten alta
    const ca = Math.cos(ang), sa = Math.sin(ang);
    const x = r * Math.sign(ca) * Math.pow(Math.abs(ca), 2 / SE);
    const y = cy + hy * Math.sign(sa) * Math.pow(Math.abs(sa), 2 / SE);
    out.push({ x, y, z });
  }
  return out;
}
// u = istasyon / uzunluk (kaplama dokusu boyuna doğru uzamaz), v = 0 üst -> 1 alt
function loftSkin(secs) {
  const rows = secs.map(ring);
  const n = rows.length, m = 2 * NS, pos = [], uv = [], idx = [];
  const full = [];
  for (let i = 0; i < n; i++) {
    const half = rows[i], r = [];
    for (let k = 0; k < m; k++) r.push(half[k]);                       // sağ yarı
    for (let k = m - 2; k >= 1; k--) r.push({ x: -half[k].x, y: half[k].y, z: half[k].z });  // sol yarı
    full.push(r);
  }
  const M = full[0].length;
  for (let i = 0; i < n; i++) {
    const u = secs[i][0] / A321.length;
    for (let k = 0; k < M; k++) {
      const p = full[i][k];
      pos.push(p.x, p.y, p.z);
      uv.push(u, k < m ? k / (m - 1) : (2 * m - 2 - k) / (m - 1));
    }
  }
  for (let i = 0; i < n - 1; i++) for (let k = 0; k < M; k++) {
    const k1 = (k + 1) % M;
    const a = i * M + k, b = i * M + k1, c = (i + 1) * M + k, d = (i + 1) * M + k1;
    idx.push(a, c, b, b, c, d);   // yüzler dışa bakar
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
// Gövde yüzeyi üzerinde bir nokta (çıkartma/kapı yerleşimi için)
function surfacePoint(s, v) {
  let a = SECTIONS[0], b = SECTIONS[SECTIONS.length - 1];
  for (let i = 0; i < SECTIONS.length - 1; i++) if (s >= SECTIONS[i][0] && s <= SECTIONS[i + 1][0]) { a = SECTIONS[i]; b = SECTIONS[i + 1]; break; }
  const t = Math.min(1, Math.max(0, (s - a[0]) / Math.max(1e-6, b[0] - a[0])));
  const sec = [s, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
  const ang = Math.PI / 2 - v * Math.PI;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  const cy = (sec[2] + sec[3]) / 2, hy = (sec[2] - sec[3]) / 2;
  return {
    x: sec[1] * Math.sign(ca) * Math.pow(Math.abs(ca), 2 / SE),
    y: cy + hy * Math.sign(sa) * Math.pow(Math.abs(sa), 2 / SE),
    z: st(s),
  };
}

const WING = { rootX: 1.95, tipX: 17.0, leRoot: 18.3, teRoot: 24.70, leTip: 25.90, teTip: 27.65, tRoot: 0.125, tTip: 0.098, yRoot: -1.25, dihedral: 5 * DEG };
function wingY(x) { return WING.yRoot + (Math.abs(x) - WING.rootX) * Math.tan(WING.dihedral); }
function wingLE(x) { const f = (Math.abs(x) - WING.rootX) / (WING.tipX - WING.rootX); return WING.leRoot + (WING.leTip - WING.leRoot) * f; }
function wingTE(x) { const f = (Math.abs(x) - WING.rootX) / (WING.tipX - WING.rootX); return WING.teRoot + (WING.teTip - WING.teRoot) * f; }
function wingThick(x) { const f = (Math.abs(x) - WING.rootX) / (WING.tipX - WING.rootX); return WING.tRoot + (WING.tTip - WING.tRoot) * f; }

export class A321neo {
  constructor({ quality = 'medium' } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'A321neo';
    this.parts = {};
    this.disposables = [];
    this.quality = quality;
    this.paintGeos = [];
    this.m = this.materials();
    this.buildFuselage();
    this.buildWings();
    this.buildEngines();
    this.buildTail();
    this.buildGear();
    this.buildDetails();
    this.buildCockpit();
    this.buildLights();
    this.finalize();
  }
  track(o) { this.disposables.push(o); return o; }

  materials() {
    const skin = this.track(makeAirlinerSkinTexture(2048, 256));
    const rough = this.track(makeRoughnessTexture(256));
    return {
      skin: this.track(new THREE.MeshStandardMaterial({ map: skin, roughnessMap: rough, roughness: 0.42, metalness: 0.06, envMapIntensity: 0.9 })),
      paint: this.track(new THREE.MeshStandardMaterial({ color: 0xf2f4f6, roughness: 0.42, metalness: 0.06, envMapIntensity: 0.9 })),
      belly: this.track(new THREE.MeshStandardMaterial({ color: 0xb2b8be, roughness: 0.55, metalness: 0.1 })),
      // Radom: kompozit, mat ve gövdeden bir tık koyu — ayrı bir top değil, gövdenin devamı
      radome: this.track(new THREE.MeshStandardMaterial({ color: 0xa8aeb4, roughness: 0.72, metalness: 0.04, envMapIntensity: 0.5 })),
      accent: this.track(new THREE.MeshStandardMaterial({ color: 0x1b3a6b, roughness: 0.4, metalness: 0.1 })),
      metal: this.track(new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.0 })),
      dark: this.track(new THREE.MeshStandardMaterial({ color: 0x1a1d21, roughness: 0.8, metalness: 0.2 })),
      duct: this.track(new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.7, metalness: 0.3, side: THREE.DoubleSide })),
      glass: this.track(new THREE.MeshPhysicalMaterial({ color: 0x0c1218, roughness: 0.06, metalness: 0.5, clearcoat: 1, envMapIntensity: 1.3 })),
      tire: this.track(new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 })),
      cockpit: this.track(new THREE.MeshStandardMaterial({ color: 0x2b2f34, roughness: 0.9, side: THREE.DoubleSide })),
      seat: this.track(new THREE.MeshStandardMaterial({ color: 0x2e3a48, roughness: 0.85 })),
    };
  }

  buildFuselage() {
    // Gövde iki parçadır ama TEK kesit tablosundan üretilir: radom ile kaplama aynı halkayı
    // paylaşır (RADOME_END), bu yüzden geçişte ne dikiş ne de çap sıçraması olur.
    const body = new THREE.Mesh(this.track(loftSkin(SECTIONS.slice(RADOME_END))), this.m.skin);
    body.castShadow = true; body.receiveShadow = true;
    this.group.add(body);
    this.parts.body = body;
    const radome = new THREE.Mesh(this.track(loftSkin(SECTIONS.slice(0, RADOME_END + 1))), this.m.radome);
    radome.castShadow = true; radome.receiveShadow = true;
    this.group.add(radome);
    // Kanat-gövde birleşim kaportası (karın düz kalmaz): alttan taşan yumuşak şişkinlik
    const fair = [];
    for (const [s, w, yb] of [[15.0, 2.00, -2.05], [17.0, 2.55, -2.35], [19.5, 2.95, -2.62], [22.0, 3.05, -2.72], [25.0, 2.90, -2.66], [28.0, 2.45, -2.40], [30.5, 2.00, -2.10]]) {
      const row = [];
      for (let i = 0; i <= 12; i++) {
        const t = i / 12, ang = Math.PI * t;                    // sağdan sola, alt yarı
        const x = Math.cos(ang) * w;
        const yTop = -1.55, yLow = yb;
        const y = yTop + (yLow - yTop) * Math.pow(Math.sin(ang), 0.75);
        row.push({ x, y, z: st(s) });
      }
      fair.push(row);
    }
    const fg = this.track(ensureOutward(loft(fair, { uScale: 1, vScale: 1 }), (v, out) => out.set(0, -1.2, v.z)));
    const fm = new THREE.Mesh(fg, this.m.belly);
    fm.castShadow = true; fm.receiveShadow = true;
    this.group.add(fm);
  }

  // Kanat paneli: x0..x1 arası, veter oranı cStart..cEnd
  wingPanel(side, x0, x1, cStart, cEnd, N = 6, K = 8) {
    const rows = [];
    for (let j = 0; j <= N; j++) {
      const x = x0 + (x1 - x0) * (j / N);
      const le = wingLE(x), te = wingTE(x), chord = te - le;
      rows.push(airfoilPoints(K, chord, wingThick(x), cStart, cEnd).map((p) => ({ x: side * x, y: wingY(x) + p.y, z: st(le + chord * p.c) })));
    }
    return ensureOutward(loft(rows, { uScale: 1, vScale: 1 }));
  }

  buildWings() {
    this.parts.ailerons = {}; this.parts.flaps = {}; this.parts.slats = {}; this.parts.spoilers = {};
    const hingeAxis = (side, x0, x1, fn) => new THREE.Vector3(x1 - x0, 0, side * (fn(x1) - fn(x0))).normalize();
    for (const side of [-1, 1]) {
      // Ana kanat kutusu: slat hattından (0.14) spoyler/flap hattına (0.72)
      this.paintGeos.push(this.wingPanel(side, WING.rootX, WING.tipX, 0.13, 0.74, 8, 10));
      // Sharklet: uçta yukarı kıvrılan kanatçık
      const shRows = [];
      for (let j = 0; j <= 5; j++) {
        const t = j / 5;
        const x = WING.tipX + 0.35 * t;
        const le = wingLE(WING.tipX) + 0.45 * t, chord = (wingTE(WING.tipX) - wingLE(WING.tipX)) * (1 - 0.55 * t);
        const y = wingY(WING.tipX) + 2.40 * t;
        shRows.push(airfoilPoints(6, chord, 0.09, 0, 1).map((p) => ({ x: side * x, y: y + p.y, z: st(le + chord * p.c) })));
      }
      this.paintGeos.push(ensureOutward(loft(shRows, { uScale: 1, vScale: 1 })));
      // Firar kenarı hareketli yüzeyleri: flap (iç, iki panel) ve aileron (dış)
      const teSurfaces = [
        { key: 'flaps', i: 0, x0: 2.30, x1: 6.60 },
        { key: 'flaps', i: 1, x0: 7.00, x1: 12.20 },
        { key: 'ailerons', i: 0, x0: 13.00, x1: 16.40 },
      ];
      for (const sf of teSurfaces) {
        const hinge = (x) => wingLE(x) + (wingTE(x) - wingLE(x)) * 0.74;
        const xm = (sf.x0 + sf.x1) / 2;
        const geo = this.wingPanel(side, sf.x0, sf.x1, 0.735, 1.0, 3, 5);
        geo.translate(-side * xm, -wingY(xm), -st(hinge(xm)));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
        mesh.position.set(side * xm, wingY(xm), st(hinge(xm)));
        mesh.castShadow = true;
        mesh.userData.axis = hingeAxis(side, sf.x0, sf.x1, hinge);
        mesh.userData.home = mesh.position.clone();
        this.group.add(mesh);
        const bucket = this.parts[sf.key][side < 0 ? 'left' : 'right'] || (this.parts[sf.key][side < 0 ? 'left' : 'right'] = []);
        bucket.push(mesh);
      }
      // Hücum kenarı slatları (üç panel)
      for (const [x0, x1] of [[2.40, 6.80], [7.20, 11.60], [12.00, 16.60]]) {
        const hinge = (x) => wingLE(x) + (wingTE(x) - wingLE(x)) * 0.135;
        const xm = (x0 + x1) / 2;
        const geo = this.wingPanel(side, x0, x1, 0.0, 0.14, 3, 6);
        geo.translate(-side * xm, -wingY(xm), -st(hinge(xm)));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
        mesh.position.set(side * xm, wingY(xm), st(hinge(xm)));
        mesh.castShadow = true;
        mesh.userData.axis = hingeAxis(side, x0, x1, hinge);
        mesh.userData.home = mesh.position.clone();
        this.group.add(mesh);
        (this.parts.slats[side < 0 ? 'left' : 'right'] || (this.parts.slats[side < 0 ? 'left' : 'right'] = [])).push(mesh);
      }
      // Spoyler / hız freni panelleri: üst yüzeyde, flapların önünde
      const spo = [];
      for (let k = 0; k < 5; k++) {
        const x0 = 4.6 + k * 1.55, x1 = x0 + 1.35;
        const xm = (x0 + x1) / 2;
        const c0 = 0.58, c1 = 0.735;
        const le = wingLE(xm), te = wingTE(xm), chord = te - le;
        const w0 = chord * (c1 - c0);
        const g = new THREE.BoxGeometry(x1 - x0, 0.06, w0);
        g.translate(0, 0, w0 / 2);
        const mesh = new THREE.Mesh(this.track(g), this.m.paint);
        mesh.position.set(side * xm, wingY(xm) + wingThick(xm) * chord * 0.42, st(le + chord * c0));
        mesh.castShadow = true;
        mesh.userData.axis = new THREE.Vector3(1, 0, 0);
        this.group.add(mesh);
        spo.push(mesh);
      }
      this.parts.spoilers[side < 0 ? 'left' : 'right'] = spo;
    }
  }

  buildEngines() {
    this.parts.fans = [];
    const R = 1.34, RI = 1.05, LEN = 4.70, zF = st(17.0);
    for (const side of [-1, 1]) {
      const ex = side * 5.75, ey = wingY(5.75) - 1.55;
      const grp = new THREE.Group();
      grp.position.set(ex, ey, 0);
      // Nacelle dış kabuğu: giriş dudağı yuvarlak, arkaya doğru daralır
      const prof = [[0.00, R * 0.87], [0.16, R * 0.995], [0.50, R], [1.90, R], [2.90, R * 0.96], [3.90, R * 0.87], [4.70, R * 0.76]];
      const rows = prof.map(([dz, r]) => {
        const row = [];
        for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2; row.push({ x: Math.cos(a) * r, y: Math.sin(a) * r, z: zF + dz }); }
        return row;
      });
      const cowl = this.track(ensureOutward(loft(rows, { uScale: 1, vScale: 1, closeRing: true }), (v, out) => out.set(0, 0, v.z)));
      const cm = new THREE.Mesh(cowl, this.m.paint); cm.castShadow = true; grp.add(cm);
      // Giriş dudağı iç yüzeyi ve fan kanalı
      const lipRows = [
        rows[1].map((p) => ({ ...p })),
        rows[0].map((p) => ({ x: p.x * (RI / (R * 0.86)), y: p.y * (RI / (R * 0.86)), z: zF + 0.10 })),
        rows[0].map((p) => ({ x: p.x * (RI / (R * 0.86)), y: p.y * (RI / (R * 0.86)), z: zF + 1.05 })),
      ];
      grp.add(new THREE.Mesh(this.track(loft(lipRows, { uScale: 1, vScale: 1, closeRing: true })), this.m.duct));
      // Fan: 18 kanat + göbek + spinner
      const fan = new THREE.Group();
      fan.position.set(0, 0, zF + 0.92);
      const blades = [];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        const b = new THREE.BoxGeometry(0.085, RI * 0.78, 0.30);
        b.translate(0, RI * 0.60, 0);
        b.rotateZ(a); b.rotateY(0.42);
        blades.push(b);
      }
      const bl = new THREE.Mesh(this.track(mergeGeometries(blades, false)), this.m.metal);
      fan.add(bl);
      const hub = new THREE.CylinderGeometry(0.30, 0.30, 0.34, 14); hub.rotateX(Math.PI / 2);
      fan.add(new THREE.Mesh(this.track(hub), this.m.metal));
      const spin = new THREE.ConeGeometry(0.30, 0.62, 14); spin.rotateX(-Math.PI / 2); spin.translate(0, 0, -0.45);
      const spinMesh = new THREE.Mesh(this.track(spin), this.track(new THREE.MeshStandardMaterial({ color: 0xdadde0, roughness: 0.3, metalness: 0.7 })));
      fan.add(spinMesh);
      grp.add(fan);
      this.parts.fans.push(fan);
      // Ters itki kaskat kuşağı: nacelle'in ortasında koyu bir bant
      const rv = new THREE.CylinderGeometry(R * 0.985, R * 0.97, 0.52, 22, 1, true);
      rv.rotateX(Math.PI / 2); rv.translate(0, 0, zF + 2.55);
      grp.add(new THREE.Mesh(this.track(rv), this.track(new THREE.MeshStandardMaterial({ color: 0x8d949b, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide }))));
      // Egzoz konisi ve sıcak kısım
      const ex1 = new THREE.CylinderGeometry(0.62, 0.50, 1.15, 16, 1, true); ex1.rotateX(Math.PI / 2); ex1.translate(0, 0, zF + LEN + 0.45);
      grp.add(new THREE.Mesh(this.track(ex1), this.m.metal));
      const plug = new THREE.ConeGeometry(0.42, 1.25, 16); plug.rotateX(-Math.PI / 2); plug.translate(0, 0, zF + LEN + 1.15);
      grp.add(new THREE.Mesh(this.track(plug), this.m.dark));
      // Pylon: kanadın alt yüzeyine bağlanır
      const py = new THREE.Shape();
      py.moveTo(zF + 0.55, 0.55); py.lineTo(zF + LEN + 0.30, 0.75); py.lineTo(zF + LEN + 0.10, 1.95); py.lineTo(zF + 1.30, 1.95);
      const pyGeo = new THREE.ExtrudeGeometry(py, { depth: 0.30, bevelEnabled: false });
      pyGeo.rotateY(Math.PI / 2); pyGeo.translate(0.15, 0, 0);
      const pyM = new THREE.Mesh(this.track(pyGeo), this.m.paint);
      pyM.castShadow = true;
      pyM.rotation.set(0, 0, 0);
      const pyWrap = new THREE.Group(); pyWrap.add(pyM);
      pyWrap.rotation.x = 0;
      grp.add(pyWrap);
      this.group.add(grp);
    }
  }

  buildTail() {
    // Dikey stabilizatör + dümen
    const V = { rootLE: 34.6, rootTE: 41.6, tipLE: 39.3, tipTE: 42.9, y0: 1.85, h: 5.70, hinge: 0.66, tRoot: 0.11, tTip: 0.09 };
    const vRow = (f, c0, c1) => {
      const le = V.rootLE + (V.tipLE - V.rootLE) * f, te = V.rootTE + (V.tipTE - V.rootTE) * f, chord = te - le;
      const th = V.tRoot + (V.tTip - V.tRoot) * f;
      return airfoilPoints(8, chord, th, c0, c1).map((p) => ({ x: p.y, y: V.y0 + V.h * f, z: st(le + chord * p.c) }));
    };
    const fin = []; for (let j = 0; j <= 6; j++) fin.push(vRow(j / 6, 0, V.hinge));
    this.paintGeos.push(ensureOutward(loft(fin, { uScale: 1, vScale: 1 })));
    // Dorsal fileto: hücum kenarı gövdeye dik bir kök yerine yayvan bir kama ile bağlanır
    const dors = [];
    for (let j = 0; j <= 5; j++) {
      const f = j / 5;
      const yTop = V.y0 + 1.30 * f;                         // fileto yalnızca kökün alt bölümünde
      const zLE = st(V.rootLE - 3.4 * (1 - f) * (1 - f));   // öne doğru uzayan kama
      const w = 0.22 * (1 - f) + V.tRoot * 0.5 * f;
      dors.push([
        { x: 0, y: yTop - 0.02, z: zLE }, { x: w, y: yTop, z: st(V.rootLE + 1.2 * f) },
        { x: 0, y: yTop + 0.10, z: st(V.rootLE + 2.2) }, { x: -w, y: yTop, z: st(V.rootLE + 1.2 * f) },
      ]);
    }
    this.paintGeos.push(ensureOutward(loft(dors, { uScale: 1, vScale: 1, closeRing: true })));
    const hz = (f) => { const le = V.rootLE + (V.tipLE - V.rootLE) * f, te = V.rootTE + (V.tipTE - V.rootTE) * f; return le + (te - le) * V.hinge; };
    const rud = []; for (let j = 0; j <= 4; j++) { const f = j / 4; rud.push(vRow(f, V.hinge - 0.01, 1).map((p) => ({ x: p.x, y: p.y - V.y0, z: p.z - st(hz(f)) + (st(hz(f)) - st(hz(0))) }))); }
    const rg = this.track(ensureOutward(loft(rud, { uScale: 1, vScale: 1 })));
    const rudder = new THREE.Mesh(rg, this.m.accent);
    rudder.position.set(0, V.y0, st(hz(0)));
    rudder.castShadow = true;
    rudder.userData.axis = new THREE.Vector3(0, V.h, st(hz(1)) - st(hz(0))).normalize();
    this.group.add(rudder);
    this.parts.rudder = rudder;
    // Dikey stabilizatör boyası (Airbus mavi alın)
    const finPaint = [];
    for (let j = 2; j <= 6; j++) finPaint.push(vRow(j / 6, 0.02, V.hinge - 0.02));
    const fp = this.track(ensureOutward(loft(finPaint, { uScale: 1, vScale: 1 })));
    fp.scale(1.06, 1, 1);
    const fpm = new THREE.Mesh(fp, this.m.accent);
    this.group.add(fpm);
    // Yatay stabilizatör + asansörler
    const H = { rootX: 0.9, tipX: 6.22, leRoot: 39.2, teRoot: 43.0, leTip: 42.0, teTip: 43.5, y: 0.55, hinge: 0.62, tRoot: 0.10, tTip: 0.09 };
    this.parts.elevators = {};
    const hLE = (x) => { const f = (Math.abs(x) - H.rootX) / (H.tipX - H.rootX); return H.leRoot + (H.leTip - H.leRoot) * f; };
    const hTE = (x) => { const f = (Math.abs(x) - H.rootX) / (H.tipX - H.rootX); return H.teRoot + (H.teTip - H.teRoot) * f; };
    const hY = (x) => H.y + (Math.abs(x) - H.rootX) * Math.tan(6 * DEG);
    const hPanel = (side, x0, x1, c0, c1, N = 4) => {
      const rows = [];
      for (let j = 0; j <= N; j++) {
        const x = x0 + (x1 - x0) * (j / N);
        const f = (x - H.rootX) / (H.tipX - H.rootX);
        const le = hLE(x), te = hTE(x), chord = te - le;
        rows.push(airfoilPoints(6, chord, H.tRoot + (H.tTip - H.tRoot) * f, c0, c1).map((p) => ({ x: side * x, y: hY(x) + p.y, z: st(le + chord * p.c) })));
      }
      return ensureOutward(loft(rows, { uScale: 1, vScale: 1 }));
    };
    for (const side of [-1, 1]) {
      this.paintGeos.push(hPanel(side, H.rootX, H.tipX, 0, H.hinge, 5));
      const hinge = (x) => hLE(x) + (hTE(x) - hLE(x)) * H.hinge;
      const x0 = H.rootX + 0.3, x1 = H.tipX - 0.15, xm = (x0 + x1) / 2;
      const geo = hPanel(side, x0, x1, H.hinge - 0.01, 1, 3);
      geo.translate(-side * xm, -hY(xm), -st(hinge(xm)));
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
      mesh.position.set(side * xm, hY(xm), st(hinge(xm)));
      mesh.castShadow = true;
      mesh.userData.axis = new THREE.Vector3(x1 - x0, 0, side * (hinge(x1) - hinge(x0))).normalize();
      this.group.add(mesh);
      this.parts.elevators[side < 0 ? 'left' : 'right'] = mesh;
    }
  }

  buildGear() {
    this.parts.gear = {};
    const wb = A321.wheelBottomY;
    const mkWheel = (r, w) => {
      const g = new THREE.Group();
      const tire = new THREE.CylinderGeometry(r, r, w, 16); tire.rotateZ(Math.PI / 2);
      const rim = new THREE.CylinderGeometry(r * 0.52, r * 0.52, w + 0.03, 10); rim.rotateZ(Math.PI / 2);
      g.add(new THREE.Mesh(this.track(tire), this.m.tire));
      g.add(new THREE.Mesh(this.track(rim), this.m.metal));
      return g;
    };
    // Burun takımı: öne katlanır, iki teker
    {
      const pivot = new THREE.Group();
      const topY = -1.95;
      pivot.position.set(0, topY, A321.noseGearZ);
      const r = 0.38, len = topY - (wb + r);
      const strut = new THREE.CylinderGeometry(0.11, 0.13, len * 0.62, 10); strut.translate(0, -len * 0.31, 0);
      pivot.add(new THREE.Mesh(this.track(strut), this.m.metal));
      const oleo = new THREE.CylinderGeometry(0.085, 0.085, len * 0.5, 10); oleo.translate(0, -len * 0.75, 0);
      pivot.add(new THREE.Mesh(this.track(oleo), this.track(new THREE.MeshStandardMaterial({ color: 0xd6d9dc, roughness: 0.18, metalness: 0.92 }))));
      const drag = new THREE.CylinderGeometry(0.05, 0.05, len * 0.8, 6); drag.rotateX(0.45); drag.translate(0, -len * 0.45, 0.30);
      pivot.add(new THREE.Mesh(this.track(drag), this.m.metal));
      for (const dx of [-0.23, 0.23]) { const wheel = mkWheel(r, 0.26); wheel.position.set(dx, -len, 0); pivot.add(wheel); }
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      const doors = [];
      for (const side of [-1, 1]) {
        const dp = new THREE.Group();
        dp.position.set(side * 0.30, -2.00, A321.noseGearZ);
        const d = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, 0.62, 2.10)), this.m.belly);
        d.position.set(0, -0.31, 0); dp.add(d);
        this.group.add(dp);
        doors.push({ pivot: dp, sign: side });
      }
      this.parts.gear.nose = { pivot, wheel: pivot, retractAxis: 'x', retractSign: -1, doors, radius: r };
    }
    // Ana takımlar: içe katlanır, iki tekerli bogi
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const topY = -2.45;
      pivot.position.set(side * A321.mainGearX, topY, A321.mainGearZ);
      const r = 0.56, len = topY - (wb + r);
      const strut = new THREE.CylinderGeometry(0.15, 0.17, len * 0.60, 10); strut.translate(0, -len * 0.30, 0);
      pivot.add(new THREE.Mesh(this.track(strut), this.m.metal));
      const oleo = new THREE.CylinderGeometry(0.115, 0.115, len * 0.55, 10); oleo.translate(0, -len * 0.74, 0);
      pivot.add(new THREE.Mesh(this.track(oleo), this.track(new THREE.MeshStandardMaterial({ color: 0xd6d9dc, roughness: 0.18, metalness: 0.92 }))));
      const brace = new THREE.CylinderGeometry(0.07, 0.07, len * 0.9, 6); brace.rotateZ(side * 0.42); brace.translate(side * -0.28, -len * 0.45, 0.10);
      pivot.add(new THREE.Mesh(this.track(brace), this.m.metal));
      const axle = new THREE.CylinderGeometry(0.09, 0.09, 1.05, 8); axle.rotateZ(Math.PI / 2); axle.translate(0, -len, 0);
      pivot.add(new THREE.Mesh(this.track(axle), this.m.metal));
      for (const dx of [-0.45, 0.45]) { const wheel = mkWheel(r, 0.34); wheel.position.set(dx, -len, 0); pivot.add(wheel); }
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      const dp = new THREE.Group();
      dp.position.set(side * (A321.mainGearX - 0.75), -2.50, A321.mainGearZ);
      const d = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.06, 1.35, 2.30)), this.m.belly);
      d.position.set(0, -0.67, 0); dp.add(d);
      this.group.add(dp);
      this.parts.gear[side < 0 ? 'left' : 'right'] = { pivot, wheel: pivot, retractAxis: 'z', retractSign: side, doors: [{ pivot: dp, sign: -side }], radius: r };
    }
  }

  buildDetails() {
    const m = this.m;
    // Yüzeyi izleyen çıkartma paneli: gövde eğrisine oturur, aynalanan tarafta sarım çevrilir.
    // Cam, kapı, çerçeve ve kargo kapakları aynı yardımcıyı kullanır.
    const surfPanel = (side, s0, s1, v0, v1, lift, into, cols = 4, rows = 4) => {
      const pos = [], idx = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const p = surfacePoint(s0 + (s1 - s0) * (i / cols), v0 + (v1 - v0) * (j / rows));
        pos.push(side * p.x * lift, p.y * lift, p.z);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        if (side > 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((cols + 1) * (rows + 1) * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };
    // Kokpit camları: A320 ailesinin altı pencereli düzeni — iki ön cam, açılabilir DV penceresi
    // ve arka yan pencere. Her camın arkasında koyu bir çerçeve paneli var (cam direkleri).
    const winGeos = [], winFrameGeos = [];
    const WINDOWS = [
      [2.92, 3.62, 0.150, 0.352],   // ön cam (iç pano)
      [3.70, 4.30, 0.163, 0.355],   // ön cam (dış pano)
      [4.40, 5.02, 0.193, 0.350],   // DV penceresi (açılabilir)
      [5.12, 5.66, 0.214, 0.344],   // arka yan pencere
    ];
    for (const side of [-1, 1]) for (const [a, b, v0, v1] of WINDOWS) {
      surfPanel(side, a, b, v0, v1, 1.0045, winGeos, 3, 3);
      surfPanel(side, a - 0.085, b + 0.085, v0 - 0.020, v1 + 0.020, 1.0025, winFrameGeos, 3, 3);
    }
    const frameMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2a2f35, roughness: 0.55, metalness: 0.2, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }));
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(winFrameGeos, false)), frameMat));
    const glassMat = this.track(new THREE.MeshPhysicalMaterial({ color: 0x0c1218, roughness: 0.06, metalness: 0.5, clearcoat: 1, envMapIntensity: 1.3, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -5, polygonOffsetUnits: -10 }));
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(winGeos, false)), glassMat));
    // Kapılar, acil çıkışlar, kargo kapakları (ince çerçeveli çıkartmalar)
    // Kapı gövdesi gövdeden bir tık farklı tonda, çerçevesi belirgin koyu: uzaktan da okunur
    // Çift yüzlü: bu ince çıkartmalarda sarım yönüne bağımlılık kalmasın (aynalanan tarafta kaybolmasın)
    const doorMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe9ecef, roughness: 0.45, metalness: 0.06, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    const seamMat = this.track(new THREE.MeshStandardMaterial({ color: 0x424a52, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    const panelGeos = [], seamGeos = [];
    const addPanel = (side, s0, s1, v0, v1, into) => surfPanel(side, s0, s1, v0, v1, 1.002, into);
    for (const side of [-1, 1]) {
      // Yolcu kapıları (4 adet, ~1,85 m yüksek): iç panel + belirgin koyu çerçeve
      for (const s of [6.2, 15.6, 27.6, 37.0]) { addPanel(side, s, s + 0.92, 0.300, 0.590, panelGeos); addPanel(side, s - 0.10, s + 1.02, 0.283, 0.607, seamGeos); }
      // Kanat üstü acil çıkışlar (2 adet, daha küçük)
      for (const s of [21.0, 22.7]) { addPanel(side, s, s + 0.60, 0.322, 0.508, panelGeos); addPanel(side, s - 0.09, s + 0.69, 0.307, 0.523, seamGeos); }
      // Kargo kapakları: alt gövdede, çerçeveli
      for (const [a, b] of [[11.4, 13.4], [29.8, 31.6]]) { addPanel(side, a, b, 0.655, 0.760, panelGeos); addPanel(side, a - 0.11, b + 0.11, 0.638, 0.777, seamGeos); }
    }
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(seamGeos, false)), seamMat));
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(panelGeos, false)), doorMat));
    // Antenler, pitot/statik problar, APU egzozu
    const met = [];
    // VHF blade antenler: ince, arkaya eğimli, gövdeden ~0,3 m taşar
    const blade = (y, s0, h, sign) => {
      const g = new THREE.BufferGeometry();
      const z0 = st(s0), z1 = st(s0 + 0.40), z2 = st(s0 + 0.62);
      const p = [0, y, z0, 0, y, z2, 0, y + sign * h, z1, 0.03, y, z0, 0.03, y, z2, 0.03, y + sign * h, z1];
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      g.setIndex([0, 1, 2, 5, 4, 3, 0, 3, 1, 1, 3, 4, 1, 4, 2, 2, 4, 5, 2, 5, 0, 0, 5, 3]);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));  // birleştirme için gerekli
      g.computeVertexNormals();
      return g;
    };
    met.push(blade(1.96, 12.5, 0.34, 1), blade(-2.02, 9.0, 0.26, -1), blade(1.99, 30.5, 0.28, 1));
    const satcom = new THREE.SphereGeometry(0.28, 10, 8); satcom.scale(1, 0.40, 1.6); satcom.translate(0, 2.02, st(24.0)); met.push(satcom);
    for (const side of [-1, 1]) {
      const pitot = new THREE.CylinderGeometry(0.030, 0.030, 0.52, 6); pitot.rotateX(Math.PI / 2);
      const pp = surfacePoint(3.05, side > 0 ? 0.40 : 0.40);
      pitot.translate(side * (pp.x + 0.10), pp.y, pp.z - 0.10); met.push(pitot);
      const aoa = new THREE.CylinderGeometry(0.035, 0.035, 0.16, 6); aoa.rotateZ(Math.PI / 2);
      const ap = surfacePoint(4.0, 0.48); aoa.translate(side * (ap.x + 0.06), ap.y, ap.z); met.push(aoa);
    }
    const apu = new THREE.CylinderGeometry(0.30, 0.26, 0.5, 12); apu.rotateX(Math.PI / 2); apu.translate(0, 0.72, st(44.4)); met.push(apu);
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(met.map((g) => (g.index ? g.toNonIndexed() : g)), false)), m.metal));
  }

  buildCockpit() {
    const m = this.m;
    const g = new THREE.Group();
    const Z = (s) => st(s);
    // Zemin, yan duvarlar ve tavan (kokpit görünümünde dış ışık sızmasın)
    const shell = [];
    for (const [s, w, y0, y1] of [[3.1, 0.95, 0.15, 1.55], [4.0, 1.42, 0.05, 1.62], [5.2, 1.55, 0.00, 1.66], [6.6, 1.58, 0.00, 1.66], [7.4, 1.50, 0.02, 1.62]]) {
      const row = [{ x: -w, y: y0, z: Z(s) }, { x: -w, y: y1, z: Z(s) }, { x: w, y: y1, z: Z(s) }, { x: w, y: y0, z: Z(s) }];
      shell.push(row);
    }
    g.add(new THREE.Mesh(this.track(loft(shell, { uScale: 1, vScale: 1 })), m.cockpit));
    const floor = new THREE.BoxGeometry(3.1, 0.08, 4.3); floor.translate(0, 0.12, Z(5.3));
    g.add(new THREE.Mesh(this.track(floor), m.cockpit));
    // Gösterge paneli ve 6 ekran (PFD / ND x2, ECAM x2)
    const panel = new THREE.BoxGeometry(2.05, 0.66, 0.28); panel.rotateX(-0.22); panel.translate(0, 0.86, Z(3.95));
    g.add(new THREE.Mesh(this.track(panel), m.dark));
    const glare = new THREE.BoxGeometry(2.25, 0.16, 0.52); glare.rotateX(-0.18); glare.translate(0, 1.26, Z(3.85));
    g.add(new THREE.Mesh(this.track(glare), m.cockpit));
    const screens = [
      ['pfd', -0.76], ['nd', -0.30], ['ecam', 0.02], ['ecam', 0.02], ['nd', 0.34], ['pfd', 0.78],
    ];
    const texs = { pfd: this.track(makeAirbusScreenTexture('pfd', 256)), nd: this.track(makeAirbusScreenTexture('nd', 256)), ecam: this.track(makeAirbusScreenTexture('ecam', 256)) };
    const mats = {};
    for (const k of Object.keys(texs)) mats[k] = this.track(new THREE.MeshStandardMaterial({ map: texs[k], emissive: 0xffffff, emissiveMap: texs[k], emissiveIntensity: 1.05, roughness: 0.35 }));
    const place = (kind, x, y, z, w, h) => {
      const q = new THREE.Mesh(this.track(new THREE.PlaneGeometry(w, h)), mats[kind]);
      q.position.set(x, y, z); q.rotation.x = 0.22;
      g.add(q);
    };
    for (const [kind, x] of [['pfd', -0.76], ['nd', -0.34], ['nd', 0.34], ['pfd', 0.76]]) place(kind, x, 0.93, Z(3.95) + 0.16, 0.36, 0.30);
    place('ecam', 0, 1.02, Z(3.95) + 0.15, 0.32, 0.26);
    place('ecam', 0, 0.72, Z(3.95) + 0.20, 0.32, 0.26);
    // FCU (otopilot paneli) glareshield üstünde
    const fcu = new THREE.BoxGeometry(1.35, 0.17, 0.20); fcu.rotateX(-0.5); fcu.translate(0, 1.36, Z(3.72));
    g.add(new THREE.Mesh(this.track(fcu), m.dark));
    const fcuFace = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.25, 0.12)), this.track(new THREE.MeshStandardMaterial({ color: 0x0b1016, emissive: 0x1b6f3a, emissiveIntensity: 0.7, roughness: 0.4 })));
    fcuFace.position.set(0, 1.39, Z(3.72) + 0.09); fcuFace.rotation.x = 0.5;
    g.add(fcuFace);
    // Orta konsol (pedestal): gaz kolları, flap ve hız freni kolları, radyolar
    const ped = new THREE.BoxGeometry(0.52, 0.30, 1.50); ped.rotateX(-0.12); ped.translate(0, 0.46, Z(5.05));
    g.add(new THREE.Mesh(this.track(ped), m.dark));
    const thrGrp = new THREE.Group();
    for (const dx of [-0.11, 0.11]) {
      const lev = new THREE.BoxGeometry(0.075, 0.30, 0.10); lev.translate(dx, 0.15, 0);
      const knob = new THREE.SphereGeometry(0.06, 8, 6); knob.scale(1, 1.2, 1); knob.translate(dx, 0.31, 0);
      thrGrp.add(new THREE.Mesh(this.track(lev), m.metal), new THREE.Mesh(this.track(knob), this.track(new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.6 }))));
    }
    thrGrp.position.set(0, 0.52, Z(4.72));
    g.add(thrGrp);
    this.parts.thrustLevers = thrGrp;
    const flapLever = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.06, 0.26, 0.07)), m.metal);
    flapLever.position.set(0.18, 0.66, Z(5.35));
    g.add(flapLever); this.parts.flapLever = flapLever;
    const sbLever = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, 0.22, 0.06)), this.track(new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.6 })));
    sbLever.position.set(-0.18, 0.64, Z(5.25));
    g.add(sbLever); this.parts.sbLever = sbLever;
    // Sidestick'ler (kaptan sol, yardımcı sağ) ve iniş takımı kolu
    this.parts.sidesticks = [];
    for (const side of [-1, 1]) {
      const s = new THREE.Group();
      const col = new THREE.CylinderGeometry(0.035, 0.045, 0.30, 8); col.translate(0, 0.15, 0);
      const grip = new THREE.CapsuleGeometry(0.045, 0.12, 4, 8); grip.translate(0, 0.36, 0);
      s.add(new THREE.Mesh(this.track(col), m.dark), new THREE.Mesh(this.track(grip), this.track(new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.7 }))));
      s.position.set(side * 0.62, 0.50, Z(4.95));
      g.add(s);
      this.parts.sidesticks.push(s);
      // Koltuklar
      const seat = new THREE.Group();
      const cush = new THREE.BoxGeometry(0.52, 0.12, 0.52); cush.translate(0, 0.44, 0);
      const back = new THREE.BoxGeometry(0.52, 0.72, 0.12); back.rotateX(-0.18); back.translate(0, 0.84, 0.30);
      seat.add(new THREE.Mesh(this.track(cush), m.seat), new THREE.Mesh(this.track(back), m.seat));
      seat.position.set(side * 0.44, 0, Z(5.35));
      g.add(seat);
    }
    const gearLever = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, 0.16, 0.05)), this.track(new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.4 })));
    gearLever.position.set(0.55, 0.95, Z(4.18));
    g.add(gearLever); this.parts.gearLever = gearLever;
    // Tavan paneli
    const oh = new THREE.BoxGeometry(1.25, 0.20, 1.10); oh.rotateX(0.32); oh.translate(0, 1.62, Z(5.20));
    g.add(new THREE.Mesh(this.track(oh), m.dark));
    const ohFace = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.15, 0.95)), this.track(new THREE.MeshStandardMaterial({ color: 0x1d2228, emissive: 0x3a4a2a, emissiveIntensity: 0.35, roughness: 0.6 })));
    ohFace.position.set(0, 1.55, Z(5.20)); ohFace.rotation.x = Math.PI / 2 + 0.32;
    g.add(ohFace);
    g.visible = false;
    this.group.add(g);
    this.parts.cockpit = g;
  }

  buildLights() {
    const glowTex = this.track(makeGlowTexture(64));
    const mk = (color, x, y, z, size = 1.1) => {
      const grp = new THREE.Group();
      const bulb = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.05, 6, 5)), this.track(new THREE.MeshBasicMaterial({ color })));
      const sprite = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      sprite.scale.setScalar(size);
      grp.add(bulb, sprite);
      grp.position.set(x, y, z);
      grp.userData.size = size;
      grp.userData.sprite = sprite;
      this.group.add(grp);
      return grp;
    };
    const tipY = wingY(WING.tipX) + 2.3, tipZ = st(wingLE(WING.tipX) + 0.4);
    this.lights = {
      navLeft: mk(0xff2a2a, -(WING.tipX + 0.35), tipY, tipZ, 0.30),
      navRight: mk(0x22ff44, WING.tipX + 0.35, tipY, tipZ, 0.30),
      tail: mk(0xffffff, 0, 2.55, st(44.2), 0.26),
      strobeLeft: mk(0xffffff, -(WING.tipX + 0.35), tipY, tipZ + 0.35, 0.52),
      strobeRight: mk(0xffffff, WING.tipX + 0.35, tipY, tipZ + 0.35, 0.52),
      beaconTop: mk(0xff3020, 0, 2.18, st(19.0), 0.40),
      beaconBottom: mk(0xff3020, 0, -2.68, st(21.5), 0.40),
    };
    // İniş farları (kanat kökü) ve taksi farı (burun takımı)
    this.landingSpot = new THREE.SpotLight(0xfff4e2, 0, 520, 26 * DEG, 0.5, 0.65);
    this.landingSpot.position.set(0, -2.1, st(19.5));
    this.landingSpot.target.position.set(0, -9, st(19.5) - 60);
    this.group.add(this.landingSpot, this.landingSpot.target);
    this.landingSpot.visible = false;
    this.landingLens = new THREE.Group();
    for (const side of [-1, 1]) {
      const lens = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff4e2, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      lens.scale.setScalar(1.6);
      lens.position.set(side * 2.6, -1.85, st(18.9));
      this.landingLens.add(lens);
    }
    const taxi = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff0d0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    taxi.scale.setScalar(1.1); taxi.position.set(0, -3.1, A321.noseGearZ - 0.25);
    this.landingLens.add(taxi);
    this.landingLens.visible = false;
    this.group.add(this.landingLens);
    // Kanat inceleme farları (gövde yanı, kanada doğru)
    this.wingLens = new THREE.Group();
    for (const side of [-1, 1]) {
      const s = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff6e6, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      s.scale.setScalar(0.9); s.position.set(side * 2.0, -0.35, st(18.0));
      this.wingLens.add(s);
    }
    this.wingLens.visible = false;
    this.group.add(this.wingLens);
    this.landingLightsOn = false;
  }
  setLandingLights(on) { this.landingLightsOn = !!on; }

  finalize() {
    const geos = this.paintGeos.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of geos) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const merged = this.track(mergeGeometries(geos, false));
    merged.computeVertexNormals();
    const mesh = new THREE.Mesh(merged, this.m.paint);
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.group.add(mesh);
    this.parts.surfaces = mesh;
    this.paintGeos.forEach((g) => g.dispose());
    this.group.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    this.wheelSpin = 0;
    this.fanAngle = 0;
    this.smooth = { elevator: 0, aileron: 0, rudder: 0, flap: 0, slat: 0, spoiler: 0 };
  }

  setCockpitView(on) {
    this.parts.cockpit.visible = !!on;
    if (this.parts.surfaces) this.parts.surfaces.visible = true;
  }
  setEnvironment(envMap) {
    this.group.traverse((o) => { if (o.isMesh && o.material && o.material.isMeshStandardMaterial) { o.material.envMap = envMap; o.material.needsUpdate = true; } });
  }

  update({ elevator = 0, aileron = 0, rudder = 0, flaps = 0, slats = 0, spoilers = 0, gear = 1, throttle = 0, engine = 0, reverse = 0, time = 0, groundSpeed = 0, dt = 0, camDist = 25 }) {
    const p = this.parts;
    // Yüzeyler mekanik hızla hareket eder (anında sıçrama yok)
    const k = (rate) => 1 - Math.exp(-Math.max(dt, 0.0001) * rate);
    const sm = this.smooth;
    sm.elevator += (elevator - sm.elevator) * k(6);
    sm.aileron += (aileron - sm.aileron) * k(6);
    sm.rudder += (rudder - sm.rudder) * k(5);
    sm.flap += (flaps - sm.flap) * k(1.2);
    sm.slat += (slats - sm.slat) * k(1.4);
    sm.spoiler += (spoilers - sm.spoiler) * k(3.5);
    const setHinge = (mesh, angle) => mesh.quaternion.setFromAxisAngle(mesh.userData.axis, angle);
    // Asansörler (pozitif = burun yukarı -> firar kenarı yukarı)
    const elev = -sm.elevator * 17 * DEG;
    setHinge(p.elevators.left, elev); setHinge(p.elevators.right, elev);
    // Aileronlar: sağa yatışta sağ yukarı / sol aşağı
    const ail = sm.aileron * 20 * DEG;
    for (const a of p.ailerons.right) setHinge(a, -ail);
    for (const a of p.ailerons.left) setHinge(a, ail);
    // Flaplar: her iki kanatta aynı yönde aşağı + Fowler geri kayması
    const flapAngle = sm.flap * 25 * DEG;
    for (const side of ['left', 'right']) {
      for (const f of p.flaps[side]) {
        setHinge(f, flapAngle);
        f.position.copy(f.userData.home).add(new THREE.Vector3(0, -0.10 * sm.flap, 0.62 * sm.flap));
      }
      // Slatlar: öne ve aşağı uzar
      for (const s of p.slats[side]) {
        setHinge(s, -sm.slat * 20 * DEG);
        s.position.copy(s.userData.home).add(new THREE.Vector3(0, -0.14 * sm.slat, -0.42 * sm.slat));
      }
      // Spoyler panelleri: ön kenardan yukarı kalkar (yatışta yukarı giden kanatta ek açılma)
      const rollAssist = side === 'right' ? Math.max(0, -sm.aileron) : Math.max(0, sm.aileron);
      const sp = Math.min(1, sm.spoiler + rollAssist * 0.55);
      for (const s of p.spoilers[side]) s.rotation.x = -sp * 45 * DEG;
    }
    setHinge(p.rudder, -sm.rudder * 22 * DEG);
    // İniş takımı ve kapaklar
    this.wheelSpin += (groundSpeed / 0.56) * dt;
    for (const key of ['nose', 'left', 'right']) {
      const gr = p.gear[key];
      const a = (1 - gear) * Math.PI / 2 * gr.retractSign;
      gr.pivot.rotation.set(0, 0, 0);
      if (gr.retractAxis === 'x') gr.pivot.rotation.x = a; else gr.pivot.rotation.z = a;
      gr.pivot.visible = gear > 0.001;
      // A320 ailesinde büyük takım kapakları yalnızca hareket sırasında açılır; takım tam açık
      // ya da tam kapalıyken kapanırlar. Bu yüzden açıklık iki uçta da sıfırdır.
      const doorOpen = Math.min(gear, 1 - gear) * 2;
      for (const d of gr.doors) d.pivot.rotation.z = d.sign * (Math.PI / 2) * (1 - doorOpen);
    }
    // Fan dönüşü: N1 ile orantılı, ters itkide de döner
    const n1 = Math.max(engine, throttle * 0.2);
    this.fanAngle += dt * (6 + n1 * 95);
    for (const f of this.parts.fans) f.rotation.z = this.fanAngle;
    // Gaz kolları kokpitte hareket eder
    if (p.thrustLevers) p.thrustLevers.rotation.x = -0.52 + throttle * 0.72 - reverse * 0.30;
    if (p.flapLever) p.flapLever.position.y = 0.66 - sm.flap * 0.14;
    if (p.sbLever) p.sbLever.rotation.x = sm.spoiler * 0.7;
    if (p.gearLever) p.gearLever.position.y = 0.95 - (1 - gear) * 0.12;
    if (p.sidesticks) for (const s of p.sidesticks) { s.rotation.x = sm.elevator * 0.28; s.rotation.z = -sm.aileron * 0.30; }
    // Dış ışıklar
    const tp = time % 1.6;
    const strobeOn = tp < 0.05 || (tp > 0.14 && tp < 0.19);
    const beaconOn = (time % 1.15) < 0.14;
    const L = this.lights;
    L.strobeLeft.visible = strobeOn; L.strobeRight.visible = strobeOn;
    L.beaconTop.visible = beaconOn; L.beaconBottom.visible = beaconOn;
    const pulse = 0.92 + 0.08 * Math.sin(time * 5);
    // Parıltılar gerçek boyutta; mesafeyle ölçeklenerek uzakta görünür kalır (bkz. aircraft.js)
    const far = Math.min(4.5, 1 + Math.sqrt(Math.max(0, camDist)) * 0.22);
    for (const k of ['navLeft', 'navRight', 'tail', 'strobeLeft', 'strobeRight', 'beaconTop', 'beaconBottom']) {
      const g = L[k];
      g.userData.sprite.scale.setScalar(g.userData.size * far * (k.startsWith('nav') ? pulse : 1));
    }
    const ll = this.landingLightsOn;
    this.landingSpot.intensity = ll ? 55 : 0;
    this.landingSpot.visible = ll;
    this.landingLens.visible = ll;
    this.wingLens.visible = ll && gear > 0.5;
  }

  dispose() { for (const d of this.disposables) if (d && d.dispose) d.dispose(); }
}
