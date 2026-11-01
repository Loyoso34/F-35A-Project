// Bodrum çekirdek haritası (v5.0): şehir tasarımı ve 3B içerik.
//
// COĞRAFYA (gerçek): kıyı çizgisi, tepeler, koylar ve ana yollar gerçek veridir (DEM, OSM). Tasarım
// koordinatları Bodrum Kalesi'ne (37,0319 K, 27,4289 D) göre doğu/kuzey metredir (E, N) ve her
// nokta enlem/boylam üzerinden yerel TM çerçevesine çevrilir (veri çizimleriyle birebir aynı yer).
//
//  - Bodrum Kalesi (St. Peter): iki koyun arasındaki burun; gerçek konum ve yönelim.
//  - Batı koyu: Milta Bodrum Marina (iskeleler, yatlar), mendirek, guletlerin kıç-kıça bağlandığı
//    rıhtım (Neyzen Tevfik kıyısı).
//  - Doğu koyu: Kumbahçe kumsalı ve kordon.
//  - Eski şehir: OSM sokak ağı boyunca beyaz kübik Bodrum evleri (en çok iki kat, düz çatı,
//    korkuluklu teras, mavi panjur, güneş enerjili su ısıtıcısı).
//  - KURGUSAL: "Gümbet Körfez Bölgesi" — Gümbet koyunun başındaki düzlükte modern gökdelen
//    bölgesi (gerçekte yoktur; tarihi merkez korunur, siluet ayrı vadide bir genişleme olarak durur).
//
// Ayrıntı hiyerarşisi: Kademe 1 (kale, liman, marina, gökdelenler, eski şehir) en yüksek ayrıntı;
// Kademe 2 (köyler, ana yollar) orta; Kademe 3 (çekirdek dışı) yalnızca arazi ve görüntü.
import * as THREE from 'three';
import { CORE, polySignedDist } from './coreterrain.js';
import { MSL_Y } from './geo.js';
import { clamp, smoothstep, mulberry32 } from './noise.js';
import { makeArchMaterial, ArchBuilder, lin } from './archmat.js';
import { buildCastle } from './castle.js';
import { buildMarina } from './marina.js';
import { buildSkyline, SKYLINE, PARK_BLOCK } from './skyline.js';
import { RoadNetwork } from './roads.js';
import { buildFlora } from './flora.js';
import { LAYER_NOREFLECT } from './ocean.js';

const DEG = Math.PI / 180;
const C_LAT = 37.0319, C_LON = 27.4289, MLAT = 111320, MLON = 111320 * Math.cos(37.03 * DEG);

// ---- Tasarım verisi (E, N metre; kaleye göre) ------------------------------------------------
export const DESIGN = {
  // Kale burnu (kara): kuzeydeki boyun dahil
  castle: { c: [8, -48], axis: 202, len: 182, wid: 142 },
  castlePoly: [[-62, 70], [62, 62], [118, -4], [102, -88], [44, -150], [-30, -148], [-92, -82], [-104, 6]],
  // Batı koyu (marina) kuzey rıhtımı, batıdan doğuya (kara solda = kuzey)
  quayMarinaN: [[-640, 300], [-560, 420], [-430, 478], [-270, 486], [-120, 460], [-62, 420]],
  // Kale boynu batı rıhtımı (gulet rıhtımı), kuzeyden güneye (kara solda = doğu)
  quayGulet: [[-62, 420], [-56, 320], [-70, 200], [-96, 90]],
  // Kumbahçe kordonu, batıdan doğuya (kara solda = kuzey)
  quayKumbahce: [[150, 120], [260, 165], [420, 185], [560, 172], [700, 140], [820, 90]],
  // Mendirek: batı burnundan doğuya
  breakwater: [[-668, -36], [-560, -58], [-420, -62], [-300, -44], [-238, -24]],
  // Marina iskeleleri (kuzey rıhtımından güneye): [E, N0, N1]
  pontoons: [[-560, 400, 120], [-480, 452, 150], [-400, 470, 170], [-320, 474, 190], [-240, 466, 210]],
  // Eski şehir (kentsel zemin + ev yerleşimi)
  oldTown: [[-1380, 360], [-1150, 700], [-700, 980], [-200, 1260], [500, 1280], [1150, 1120], [1450, 760], [1350, 220], [900, 60], [180, 110], [-60, 300], [-640, 260], [-900, 120], [-1250, 80]],
  // Gümbet Körfez Bölgesi (kurgusal gökdelen bölgesi) zemin platformu
  skyline: [[-2640, 40], [-2180, 30], [-1960, -40], [-1760, 120], [-1700, 520], [-1820, 830], [-2400, 860], [-2660, 600]],
  // Kumsallar (kum maskesi)
  beaches: [
    [[-2620, -40], [-2200, -50], [-2140, 60], [-2620, 70]],          // Gümbet
    [[160, 90], [760, 120], [760, 200], [160, 190]],                // Kumbahçe
  ],
  // Giriş ekranı sinematik çekimleri (E, N, irtifa MSL): uçak yolu, kamera başlangıç/bitiş, süre (s).
  // 1) Siluet geçişi: Gümbet koyunun ağzında batıya, kamera güneyde su üstünde (arkada gökdelenler)
  // 2) Kale geçişi: güneydoğudan liman ağzına, kamera Kumbahçe tarafında alçakta (arkada kale ve marina)
  // 3) Panorama: uçak yok, Bodrum koylarının yüksekten yavaş yörüngesi
  menuShots: [
    { dur: 15, path: [[-1250, -420, 82], [-1900, -470, 86], [-2550, -520, 92], [-3300, -640, 110]], cam: [[-1700, -820, 58], [-2350, -860, 62]], focus: [-2250, 380, 115], mix: 0.42, fov: 44 },
    { dur: 14, path: [[1000, -1350, 120], [380, -640, 82], [-120, -220, 84], [-640, 300, 125]], cam: [[470, -430, 24], [400, -380, 30]], focus: [0, -40, 26], mix: 0.62, fov: 50 },
    { dur: 16, orbit: { c: [-1150, 120], r: 3300, h: 820, a0: 200, a1: 238, look: [-1100, 250, 30] }, fov: 50 },
  ],
  // Liman sığınakları (deniz dalgası): [E, N, r, kalan genlik]
  shelters: [[-380, 240, 360, 0.18], [480, 30, 420, 0.45], [-2380, -260, 520, 0.55]],
};

export class BodrumCity {
  constructor(world) {
    this.w = world;
    this.core = world.core;
    this.frame = world.frame;
    this.detail = 1;
    this.q = world.quality;
    this.shelters = [];
    this.chunks = [];          // görünürlük kümeleri: { mesh, x, z, r, far }
    this.lightSets = [];
    this.solids = [];
    this.time = 0;
    const o = this.P(0, 0);
    this.castleXZ = o;
    // yerel doğu/kuzey birim vektörleri (TM ızgarasına göre küçük açı)
    const e1 = this.P(1000, 0), n1 = this.P(0, 1000);
    this.east = new THREE.Vector2((e1.x - o.x) / 1000, (e1.z - o.z) / 1000);
    this.north = new THREE.Vector2((n1.x - o.x) / 1000, (n1.z - o.z) / 1000);
  }

  /**
   * Görüntüden türetilen haritalar (1024², çekirdek): yeşillik (maki/çam) ve yerleşim (açık renkli,
   * doygunluğu düşük çatı/beton). Ağaç ve kademe 2 ev yerleşimi bunlardan.
   */
  imageryMaps() {
    if (this._img !== undefined) return this._img;
    this._img = null;
    const cv = this.w.coreMacroCanvas;
    if (!cv || typeof document === 'undefined') return null;
    try {
      const T = 1024, c2 = document.createElement('canvas'); c2.width = c2.height = T;
      const g = c2.getContext('2d', { willReadFrequently: true });
      g.drawImage(cv, 0, 0, T, T);
      const d = g.getImageData(0, 0, T, T).data;
      const green = new Float32Array(T * T), urban = new Float32Array(T * T);
      for (let i = 0; i < T * T; i++) {
        const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2], sm = r + gg + b + 1;
        const lum = (r * 0.2126 + gg * 0.7152 + b * 0.0722) / 255, mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        const sat = (mx - mn) / (mx + 1);
        green[i] = smoothstep(0.345, 0.395, gg / sm) * (1 - smoothstep(0.32, 0.5, lum));
        urban[i] = smoothstep(0.42, 0.6, lum) * (1 - smoothstep(0.12, 0.24, sat));
      }
      this._img = { T, green, urban, at: (arr, x, z) => { const u = Math.floor((x - CORE.x0) / CORE.size * T), v = Math.floor((z - CORE.z0) / CORE.size * T); return u < 0 || v < 0 || u >= T || v >= T ? 0 : arr[v * T + u]; } };
    } catch (e) { this._img = null; }
    return this._img;
  }

  /** Tasarım koordinatı (E, N; kaleye göre m) -> yerel {x, z}. */
  P(e, n) { return this.frame.toLocal(C_LAT + n / MLAT, C_LON + e / MLON); }
  PL(list) { return list.map(([e, n]) => this.P(e, n)); }
  /** Tasarım yönü (derece, kuzeyden saat yönü) -> yerel çerçevede açı (x ekseninden, z güney). */
  dirAngle(deg) {
    const a = deg * DEG, ex = Math.sin(a), nx = Math.cos(a);
    const dx = this.east.x * ex + this.north.x * nx, dz = this.east.y * ex + this.north.y * nx;
    return Math.atan2(dz, dx);
  }
  ground(x, z) { return this.core.rawAt(x, z) + MSL_Y; }

  // =============================================================================================
  // TASARIM: arazi düzenlemeleri ve zemin maskeleri (fizik ve çizim aynı yüzeyi görür)
  // =============================================================================================
  *design() {
    const C = this.core, D = DESIGN;
    for (const f of C.initMask(this.q.coreTex >= 2048 ? 2048 : 1024)) yield f * 0.25;
    // 1) Gümbet Körfez Bölgesi: kıyıdan içeri hafif yükselen platform (+3,2 m -> +13 m)
    const sky = this.PL(D.skyline);
    this.skyPoly = sky;
    const n0 = this.P(0, 0);
    const Nof = (x, z) => (x - n0.x) * this.north.x + (z - n0.z) * this.north.y;
    C.editPoly(sky, (x, z) => 3.2 + 9.8 * smoothstep(60, 820, Nof(x, z)), 45, 'set');
    C.paintMask(sky, 0, 1, 12);
    // park (merkez blok) ve bulvar refüjü: sulanan yeşil
    C.paintMask(this.PL(PARK_BLOCK), 2, 1, 6); C.paintMask(this.PL(PARK_BLOCK), 0, 0, 4, 'set');
    C.paintMask(this.PL(SKYLINE.park), 2, 1, 2);
    yield 0.35;
    // 2) Eski şehir: kabartma yumuşatılır (sokaklar ve teraslar için), kentsel zemin
    const town = this.PL(D.oldTown);
    this.townPoly = town;
    const smooth = (x, z, h) => {
      if (h < 0.3) return h;
      let s = 0;
      for (const [dx, dz] of [[0, 0], [45, 0], [-45, 0], [0, 45], [0, -45], [32, 32], [-32, 32], [32, -32], [-32, -32]]) s += this.core.smoothAt(x + dx, z + dz);
      return Math.max(1.2, s / 9);
    };
    C.editPoly(town, smooth, 30, 'set');
    C.paintMask(town, 0, 0.92, 25);
    yield 0.5;
    // 3) Kale burnu: kaya platformu (+7..+9 m), kenarları denize dik iner
    const cp = this.PL(D.castlePoly);
    this.castlePoly = cp;
    const cc = this.P(...D.castle.c);
    C.editPoly(cp, (x, z) => 7.5 + 1.5 * (1 - smoothstep(0, 90, Math.hypot(x - cc.x, z - cc.z))), 7, 'set');
    C.paintMask(cp, 3, 0.8, 6);
    C.paintMask(cp, 0, 0.0, 4, 'set');
    // 4) Rıhtımlar: kara tarafı +1,5 m kordon, deniz tarafı -4 m (rıhtım duvarı)
    this.quays = [D.quayMarinaN, D.quayGulet, D.quayKumbahce].map((l) => this.PL(l));
    for (const q of this.quays.slice(0, 2)) this.quayEdit(q, 26, 18, 1.5);
    this.quayEdit(this.quays[2], 22, 10, 1.3, true);
    // 5) Mendirek: kaya dolgu (+2,4 m), 18 m taban
    this.breakwater = this.PL(D.breakwater);
    C.editPoly(bufferLine(this.breakwater, 9), 2.4, 9, 'set');
    C.paintMask(bufferLine(this.breakwater, 9), 3, 1, 4);
    // 6) Marina havzası derinleştirme (yatlar için 5-7 m)
    C.editPoly(this.PL([[-640, 280], [-440, 440], [-140, 440], [-120, 120], [-260, 0], [-600, 0]]), (x, z, h) => Math.min(h, -5.5), 25, 'min');
    yield 0.6;
    // 7) Kumsallar
    for (const b of D.beaches) { const p = this.PL(b); C.paintMask(p, 1, 1, 18); C.paintMask(p, 0, 0, 10, 'set'); }
    // 8) Yol ağı: profiller, yarma/dolgu (fizik yüzeyine yazılır)
    this.roads = new RoadNetwork(this, this.w.roadsData);
    yield* this.roads.design();
    // 9) Deniz sığınakları
    this.shelters = D.shelters.map(([e, n, r, k]) => { const p = this.P(e, n); return { x: p.x, z: p.z, r, k }; });
    yield 1;
  }

  /** Rıhtım: çizginin solu kara (+h), sağı derin su; kenar keskin (rıhtım duvarı örgüsü örter). */
  quayEdit(line, landW, waterW, h, beach = false) {
    const C = this.core, s = C.s;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of line) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const M = Math.max(landW, waterW) + 30;
    const [i0, i1, j0, j1] = C.rangeOf(minX - M, minZ - M, maxX + M, maxZ + M);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = CORE.x0 + i * s, z = CORE.z0 + j * s;
      const r = lineSide(line, x, z);
      if (!r || r.d > M || r.t < -0.02 || r.t > 1.02) continue;
      const k = j * C.n1 + i, h0 = C.H[k];
      // kara: "sol" (z güney eksenli yerel çerçevede işaret ters) -> side < 0
      if (r.side < 0) {
        if (r.d < landW) C.H[k] = h0 + (h - h0) * (1 - smoothstep(landW * 0.6, landW, r.d)) * (h0 > 6 ? 0.6 : 1);
      } else if (!beach) {
        if (r.d < waterW) C.H[k] = Math.min(h0, -4.2 + 1.2 * smoothstep(0, waterW, r.d));
        else if (r.d < waterW + 25) C.H[k] = Math.min(h0, -4.2 + (h0 + 4.2) * smoothstep(waterW, waterW + 25, r.d));
      }
    }
  }

  // =============================================================================================
  // 3B İÇERİK
  // =============================================================================================
  *build(group) {
    this.group = group;
    if (!group) {
      // başsız (test): yalnızca çarpışma hacimleri
      yield* this.buildSolidsOnly();
      return;
    }
    const root = new THREE.Group(); root.name = 'bodrum';
    group.add(root);
    this.root = root;
    this.mats = {
      arch: makeArchMaterial(),
      archDS: makeArchMaterial({ side: THREE.DoubleSide }),
    };
    const ctx = this.ctx();
    yield 0.05;
    buildCastle(ctx);
    yield 0.15;
    buildMarina(ctx);
    yield 0.3;
    yield* buildSkyline(ctx);
    yield 0.55;
    yield* this.buildTown(ctx);
    yield 0.75;
    yield* this.roads.build(ctx);
    yield 0.88;
    yield* buildFlora(ctx);
    yield 1;
  }

  /** Alt modüllere verilen bağlam. */
  ctx() {
    const self = this;
    return {
      city: this, w: this.w, core: this.core, root: this.root, mats: this.mats, q: this.q, D: DESIGN,
      P: (e, n) => this.P(e, n), PL: (l) => this.PL(l), ground: (x, z) => this.ground(x, z),
      dirAngle: (d) => this.dirAngle(d), east: this.east, north: this.north,
      track: (o) => this.w.track(o),
      addChunk(mesh, x, z, r, far, opts = {}) {
        mesh.matrixAutoUpdate = false; mesh.updateMatrix();
        if (opts.noReflect) mesh.layers.set(LAYER_NOREFLECT);
        self.root.add(mesh);
        self.chunks.push({ mesh, x, z, r, far, near: opts.near || 0 });
        return mesh;
      },
      solid(s) { self.solids.push(s); self.w.buildingBoxes.push(s); },
      /** Yönlü kutu çarpışma hacmi: merkez, yarı boyutlar, açı (yerel x ekseninden). */
      obb(x, z, hw, hd, a, y0, y1) {
        const ca = Math.cos(a), sa = Math.sin(a), ex = Math.abs(hw * ca) + Math.abs(hd * sa), ez = Math.abs(hw * sa) + Math.abs(hd * ca);
        const s = { minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y0, maxY: y1,
          test: (px, pz, r) => { const dx = px - x, dz = pz - z; const u = dx * ca + dz * sa, v = -dx * sa + dz * ca; return Math.abs(u) < hw + r && Math.abs(v) < hd + r; } };
        self.solids.push(s); self.w.buildingBoxes.push(s);
        return s;
      },
      lights(pts) { self.lightSets.push(pts); },
    };
  }

  *buildSolidsOnly() {
    // başsız: çizim nesneleri kurulur ama sahneye eklenmez; çarpışma hacimleri tarayıcıdakiyle aynı
    this.root = new THREE.Group();
    this.mats = { arch: null, archDS: null };
    const ctx = this.ctx();
    ctx.headless = true;
    ctx.addChunk = (mesh) => mesh;
    ctx.lights = () => {};
    buildCastle(ctx);
    buildMarina(ctx);
    yield* buildSkyline(ctx);
    this.root = null;
    yield 1;
  }

  // ---- Eski şehir ve köyler: beyaz kübik Bodrum evleri ----------------------------------------
  *buildTown(ctx) {
    const rand = mulberry32(1453);
    const R = this.roads;
    // Yerleşim: konut sokakları boyunca iki yanda, sokak kenarından geri çekilerek; çakışma ızgarası
    const occ = new Map();
    const cell = 6;
    const key = (i, j) => i * 100003 + j;
    const occupied = (x, z, r) => {
      const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (occ.has(key(i, j))) return true;
      return false;
    };
    const mark = (x, z, r) => {
      const i0 = Math.floor((x - r) / cell), i1 = Math.floor((x + r) / cell), j0 = Math.floor((z - r) / cell), j1 = Math.floor((z + r) / cell);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) occ.set(key(i, j), 1);
    };
    // Yasak bölgeler: kale, gökdelen bölgesi, rıhtım şeridi, yolların kendisi
    const quayBan = (x, z) => this.quays.some((q) => { const r = lineSide(q, x, z); return r && r.d < 24; });
    const banned = (x, z) => polySignedDist(this.castlePoly, x, z) < 30 || polySignedDist(this.skyPoly, x, z) < 10 || R.nearRoad(x, z) < 5.5 || quayBan(x, z);
    // kümeler: 400 m'lik hücreler (görünürlük ve çizim çağrısı)
    const chunks = new Map();
    const chunkOf = (x, z) => {
      const ci = Math.floor((x - CORE.x0) / 400), cj = Math.floor((z - CORE.z0) / 400), k = ci * 1000 + cj;
      let c = chunks.get(k);
      if (!c) { c = { b: new ArchBuilder(), x: CORE.x0 + (ci + 0.5) * 400, z: CORE.z0 + (cj + 0.5) * 400, n: 0 }; chunks.set(k, c); }
      return c;
    };
    const tierMax = { 1: 1, 2: 0.55 };
    let houses = 0;
    for (const st of R.townStreets()) {
      const pts = st.pts, tier = st.tier;
      for (let i = 0; i + 1 < pts.length; i++) {
        const A = pts[i], B = pts[i + 1];
        const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
        if (L < 6) continue;
        const ux = dx / L, uz = dz / L;
        const step = tier === 1 ? 13 : 22;
        for (let s = step * 0.5; s < L; s += step * (0.75 + rand() * 0.5)) {
          if (rand() > tierMax[tier] * this.q.city) continue;
          for (const side of [-1, 1]) {
            if (rand() < 0.15) continue;
            const w = 7 + rand() * 6, d = 7 + rand() * 5;
            const off = st.hw + 2.5 + d / 2 + rand() * 3;
            const x = A.x + ux * s - uz * off * side, z = A.z + uz * s + ux * off * side;
            const r = Math.hypot(w, d) / 2;
            if (occupied(x, z, r * 0.85) || banned(x, z)) continue;
            const g = this.core.rawAt(x, z);
            if (g < 0.8) continue;
            const sl = this.core.slopeAt(x, z);
            if (sl > 0.42) continue;
            mark(x, z, r * 0.85);
            const c = chunkOf(x, z);
            this.house(c.b, x, g + MSL_Y, z, w, d, Math.atan2(uz, ux), rand, sl, tier);
            c.n++; houses++;
          }
        }
      }
      if (houses % 400 === 0) yield 0.6;
    }
    // Kademe 2: görüntüde yerleşim görünen yerlerde (Konacık, Gümbet yamaçları, Bitez, Torba...) evler;
    // yönelim eş yükselti eğrisine paralel (yamaç evleri), yol ve çakışma denetimiyle
    const IM = this.imageryMaps();
    if (IM) {
      const T = IM.T, px = CORE.size / T;
      for (let v = 2; v < T - 2; v++) {
        for (let u = 2; u < T - 2; u++) {
          const uv = IM.urban[v * T + u];
          if (uv < 0.35 || rand() > uv * 0.5 * this.q.city) continue;
          const x = CORE.x0 + (u + rand()) * px, z = CORE.z0 + (v + rand()) * px;
          if (polySignedDist(this.townPoly, x, z) < 0 || banned(x, z) || R.nearRoad(x, z) > 100) continue;
          const g = this.core.rawAt(x, z);
          if (g < 1.5) continue;
          const sl = this.core.slopeAt(x, z);
          if (sl > 0.38) continue;
          const w = 7 + rand() * 7, d = 7 + rand() * 5, r = Math.hypot(w, d) / 2;
          if (occupied(x, z, r * 0.9)) continue;
          mark(x, z, r * 0.9);
          const e = 6, gx = this.core.smoothAt(x + e, z) - this.core.smoothAt(x - e, z), gz = this.core.smoothAt(x, z + e) - this.core.smoothAt(x, z - e);
          const a = Math.atan2(gz, gx) + Math.PI / 2 + (rand() - 0.5) * 0.3;
          const c = chunkOf(x, z);
          this.house(c.b, x, g + MSL_Y, z, w, d, a, rand, sl, 2);
          c.n++; houses++;
        }
        if ((v & 63) === 0) yield 0.65;
      }
    }
    const far = 5200 * this.q.city;
    for (const c of chunks.values()) {
      if (!c.n) continue;
      const mesh = new THREE.Mesh(this.w.track(c.b.geometry()), this.mats.arch);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.name = 'houses';
      ctx.addChunk(mesh, c.x, c.z, 300, far);
    }
    this.stats = Object.assign(this.stats || {}, { houses });
  }

  /**
   * Bodrum evi: 1-2 katlı badanalı kübik kütle (bazen L planlı ya da kademeli), korkuluklu düz
   * çatı terası, çatıda güneş enerjili su ısıtıcısı (eğik panel + tank), bazen pergola. Eğimde
   * temel duvarı (taş) zemine kadar iner.
   */
  house(b, x, y, z, w, d, a, rand, slope, tier) {
    const floors = rand() < (tier === 1 ? 0.55 : 0.35) ? 2 : 1;
    const fh = 3.0;
    const h = floors * fh + 0.4;
    const tone = rand();
    const col = tone < 0.72 ? [0.86, 0.85, 0.82] : tone < 0.86 ? [0.85, 0.80, 0.70] : tone < 0.95 ? [0.84, 0.74, 0.60] : [0.78, 0.80, 0.82];
    const seed = rand();
    const st = [seed, fh, 3.1 + rand() * 0.8, 2];
    const found = 0.6 + slope * Math.max(w, d) * 0.6;           // eğimde temel payı
    const stone = [0.42, 0.38, 0.33];
    b.box(x, y - found, z, w, d, found, a, stone, [seed, 3, 2, 4], { noTop: true });
    b.box(x, y, z, w, d, h, a, col, st, { topCol: [0.72, 0.71, 0.68] });
    const ca = Math.cos(a), sa = Math.sin(a);
    const L = (lx, lz) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
    // kademeli ikinci kütle (L plan / üst kat geri çekme)
    if (rand() < 0.45) {
      const w2 = w * (0.45 + rand() * 0.3), d2 = d * (0.45 + rand() * 0.3);
      const ox = (rand() - 0.5) * (w - w2), oz = (rand() - 0.5) * (d - d2);
      const [px, pz] = L(ox, oz);
      b.box(px, y + h, pz, w2, d2, fh, a, col, [seed + 0.31, fh, 3.0, 2], { topCol: [0.72, 0.71, 0.68] });
    }
    // korkuluk (parapet) çatı kenarında: 0,6 m
    const ph = 0.6, pt = 0.18, top = y + h;
    for (const [lx, lz, ww, dd] of [[0, -d / 2 + pt / 2, w, pt], [0, d / 2 - pt / 2, w, pt], [-w / 2 + pt / 2, 0, pt, d], [w / 2 - pt / 2, 0, pt, d]]) {
      const [px, pz] = L(lx, lz);
      b.box(px, top, pz, ww, dd, ph, a, col, [seed, 3, 3, 0]);
    }
    // güneş enerjili su ısıtıcısı (Türkiye çatılarının simgesi)
    if (rand() < 0.62) {
      const [px, pz] = L((rand() - 0.5) * w * 0.4, (rand() - 0.5) * d * 0.4);
      b.box(px, top, pz, 1.9, 1.0, 0.9, a + 0.02, [0.10, 0.12, 0.16], [seed, 3, 3, 0]);
      const [tx, tz] = L((rand() - 0.5) * w * 0.4 + 0.2, (rand() - 0.5) * d * 0.4 - 0.9);
      b.cylinder(tx, top + 0.9, tz, 0.28, 1.6, 6, [0.75, 0.75, 0.74], [seed, 3, 3, 0]);
    }
    // pergola (asma çardak) bazı teraslarda
    if (rand() < 0.22 && tier === 1) {
      const [px, pz] = L(-w / 4, 0);
      for (const [lx, lz] of [[-w / 4 + 0.3, -d / 2 + 0.6], [w / 4 - 0.3, -d / 2 + 0.6], [-w / 4 + 0.3, d / 2 - 0.6], [w / 4 - 0.3, d / 2 - 0.6]]) {
        const [qx, qz] = L(-w / 4 + lx, lz);
        b.box(qx, top, qz, 0.16, 0.16, 2.3, a, [0.35, 0.24, 0.14], [seed, 3, 3, 0]);
      }
      b.box(px, top + 2.3, pz, w / 2, d - 1, 0.12, a, [0.33, 0.30, 0.16], [seed, 3, 3, 0]);
    }
  }

  /** Giriş ekranı çekimleri: yerel dünya koordinatlarında (y = MSL + MSL_Y). */
  cinematicShots() {
    const V = ([e, n, h]) => { const p = this.P(e, n); return new THREE.Vector3(p.x, h + MSL_Y, p.z); };
    return DESIGN.menuShots.map((s) => ({
      dur: s.dur, fov: s.fov,
      path: s.path ? new THREE.CatmullRomCurve3(s.path.map(V), false, 'centripetal') : null,
      cam: s.cam ? s.cam.map(V) : null, focus: s.focus ? V(s.focus) : null, mix: s.mix || 0,
      orbit: s.orbit ? { c: this.P(...s.orbit.c), r: s.orbit.r, h: s.orbit.h + MSL_Y, a0: s.orbit.a0 * Math.PI / 180, a1: s.orbit.a1 * Math.PI / 180, look: V(s.orbit.look) } : null,
    }));
  }

  // =============================================================================================
  // Sorgular ve kare güncellemesi
  // =============================================================================================
  surfaceAt() { return 'grass'; }

  update(dt, camera) {
    this.time += dt;
    if (!this.root) return;
    const c = camera.position, k = this.detail;
    for (const ch of this.chunks) {
      const d = Math.hypot(ch.x - c.x, ch.z - c.z, (c.y - MSL_Y) * 0.6) - ch.r;
      const far = ch.far * k;
      const v = ch.mesh.visible ? d < far + 150 : d < far - 150;
      ch.mesh.visible = v && (!ch.near || d >= ch.near);
    }
    if (this.roads) this.roads.update(dt, camera);
  }

  dispose() {
    if (this.mats) for (const m of Object.values(this.mats)) m.dispose();
  }
}

// ---- Geometri yardımcıları --------------------------------------------------------------------
/** Çizgiyi yarı genişlik w kadar şişirip çokgen yapar (basit ofset; uçlar düz). */
export function bufferLine(pts, w) {
  const L = [], R = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    let dx = b.x - a.x, dz = b.z - a.z; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    L.push({ x: pts[i].x - dz * w, z: pts[i].z + dx * w }); R.push({ x: pts[i].x + dz * w, z: pts[i].z - dx * w });
  }
  return L.concat(R.reverse());
}
/** Noktanın çoklu çizgiye uzaklığı, taraf işareti ve parametresi. */
export function lineSide(pts, x, z) {
  let best = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i], B = pts[i + 1], dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
    const tr = ((x - A.x) * dx + (z - A.z) * dz) / L2, t = clamp(tr, 0, 1);
    const d = Math.hypot(x - A.x - t * dx, z - A.z - t * dz);
    if (!best || d < best.d) best = { d, side: Math.sign(dx * (z - A.z) - dz * (x - A.x)), t: (i + tr) / (pts.length - 1), seg: i };
  }
  return best;
}
export { lin };
