// Dünya: 40 km arazi (LOD'lu parçalar), gökyüzü, güneş, su, ormanlar, nehir, yollar, kasaba, bulutlar ve hava üssü.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex2D, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import {
  makeGrassTexture, makeAsphaltTexture, makeConcreteTexture, makeWaterNormalTexture,
  makeHangarWallTexture, makeHangarDoorTexture, makeTextTexture, makeCloudTexture, makeRoadTexture, makeWindowsTexture,
  makeChainLinkTexture, makeBarbedWireTexture, makeOliveTexture,
} from './textures.js';
import { buildStaticAircraftGeometries } from './aircraft.js';

export const MAP_SIZE = 72000;   // 72 x 72 km: iki havaalanı arası uçuş anlamlı bir mesafe olsun
export const WATER_LEVEL = -4;
export const LAYER_TREES = 1;

const simplex = new Simplex2D(2024);
const LAKES = [
  { x: -9000, z: -6200, r: 1900 },
  { x: 8600, z: 5600, r: 2300 },
  { x: 3200, z: -11500, r: 1400 },
  { x: -12500, z: 9000, r: 1600 },
  { x: 17500, z: 4200, r: 2600 },      // doğu büyük göl (iki havaalanı arasındaki koridorda)
  { x: -19500, z: -13000, r: 2100 },
  { x: 9500, z: -18500, r: 1500 },
  { x: -6000, z: 17500, r: 1800 },
];
// Nehir: doğudaki gölden batıya doğru, üssün güneyinden geçer (+z güney)
const RIVER = [
  [17500, 4200], [13000, 4900], [10600, 5400], [8600, 5600], [6200, 4600], [4200, 4300], [2200, 4400],
  [0, 3800], [-2200, 3300], [-4600, 3000], [-7500, 2500], [-10500, 2200], [-14000, 1800],
  [-18500, 1400], [-23500, 900], [-29000, 300],
];
const TOWN = { x: 2600, z: 6900, r: 1250 };
// İkinci yerleşim: sivil havalimanının yanındaki kasaba
const TOWN2 = { x: 21200, z: -13600, r: 1050 };

// ---- Havaalanları ----------------------------------------------------------
// Her havaalanı kendi yerel çerçevesinde tanımlanır: (x, z) merkez, hdg pist yönü (derece,
// 90 = doğu). Yerel koordinatlarda +X pist ekseni, +Z pistin sağ tarafıdır. Böylece ikinci
// havaalanı döndürülebilir ve tüm sorgular (yüzey tipi, düzleştirme) tek kod yolundan geçer.
export const AIRPORTS = [
  {
    id: 'base', name: 'Anadolu Hava Üssü', sub: 'Askeri üs', kind: 'military',
    x: 0, z: 0, hdg: 90, elev: 0, halfX: 4600, halfZ: 1500, fade: 2400,
    rwy: { len: 3000, w: 45 }, marks: ['09', '27'],
  },
  {
    id: 'civil', name: 'Yeşilova Havalimanı', sub: 'Sivil havalimanı', kind: 'civil',
    x: 24000, z: -10000, hdg: 120, elev: 185, halfX: 2900, halfZ: 1250, fade: 2600,
    rwy: { len: 3400, w: 45 }, marks: ['12', '30'],
  },
];
export const AIRPORT_BY_ID = Object.fromEntries(AIRPORTS.map((a) => [a.id, a]));
// Kalkış noktaları: pist başında, pist yönüne dönük. Seçim ekranı bu listeden beslenir.
export const SPAWNS = [
  { id: 'base', airport: 'base', name: 'Anadolu Hava Üssü', sub: 'Askeri üs · Pist 09/27 · 3000 m', lx: -1400, lz: 0, hdg: 90 },
  { id: 'civil', airport: 'civil', name: 'Yeşilova Havalimanı', sub: 'Sivil · Pist 12/30 · 3400 m · 185 m', lx: -1600, lz: 0, hdg: 120 },
];
for (const a of AIRPORTS) { const r = a.hdg * Math.PI / 180; a.cos = Math.cos(r); a.sin = Math.sin(r); }
// Dünya -> havaalanı yerel koordinatı. hdg=90 için birim dönüşüm (lx = x, lz = z).
export function airportLocal(a, x, z, out) {
  const dx = x - a.x, dz = z - a.z;
  const o = out || { x: 0, z: 0 };
  o.x = dx * a.sin - dz * a.cos;
  o.z = dx * a.cos + dz * a.sin;
  return o;
}
export function airportWorld(a, lx, lz, out) {
  const o = out || { x: 0, z: 0 };
  o.x = a.x + lx * a.sin + lz * a.cos;
  o.z = a.z - lx * a.cos + lz * a.sin;
  return o;
}
// Kalkış noktasının dünya koordinatı ve yönü
export function spawnPose(spawnId) {
  const sp = SPAWNS.find((s) => s.id === spawnId) || SPAWNS[0];
  const a = AIRPORT_BY_ID[sp.airport];
  const w = airportWorld(a, sp.lx, sp.lz);
  return { x: w.x, z: w.z, hdg: sp.hdg, id: sp.id };
}
// Yollar (poligon çizgileri) – hepsi düzlük koridorunda
const ROADS = [
  { name: 'base-town', w: 9, pts: [[0, 1050], [300, 2200], [1000, 3400], [1700, 4200], [2100, 5200], [2500, 6100], [2600, 6900]] },
  { name: 'town-east', w: 8, pts: [[2600, 6900], [3800, 7100], [5200, 6900], [6700, 6500], [7600, 6200]] },
  // Yollar kenar dağlarından önce biter: yol koridoru düzleştirmesi dağların içine kanyon açmasın
  { name: 'base-west', w: 9, pts: [[-1200, 1050], [-2500, 1300], [-4500, 1500], [-7500, 1700], [-10500, 1500]] },
  { name: 'town-north', w: 7, over: true, pts: [[2600, 6900], [2650, 8300], [2900, 10200]] },
  // Doğu otoyolu: kasabadan sivil havalimanına — iki havaalanı arasındaki koridoru görünür kılar
  { name: 'highway-east', w: 11, pts: [[7600, 6200], [10200, 4200], [12600, 1600], [15200, -2200], [18000, -6200], [20400, -9600], [21200, -12600]] },
  { name: 'civil-town', w: 9, pts: [[21200, -13600], [22600, -12400], [23600, -11200]] },
  { name: 'civil-apron', w: 8, pts: [[23600, -11200], [24300, -10700]] },
];
// Kasaba sokakları (yalnızca yol ağı ve ev yerleşimi için; arazi düzleştirmesine dahil değil)
const TOWN_STREETS = [];
for (const T of [TOWN, TOWN2]) {
  for (let i = -4; i <= 4; i++) {
    const half = Math.sqrt(Math.max(0, T.r * T.r - (i * 240) * (i * 240))) * 0.95;
    if (half < 200) continue;
    TOWN_STREETS.push({ w: 6, pts: [[T.x - half, T.z + i * 240], [T.x + half, T.z + i * 240]] });
    TOWN_STREETS.push({ w: 6, over: true, pts: [[T.x + i * 240, T.z - half], [T.x + i * 240, T.z + half]] });
  }
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const L2 = vx * vx + vz * vz || 1;
  const t = clamp((wx * vx + wz * vz) / L2, 0, 1);
  const dx = ax + vx * t - px, dz = az + vz * t - pz;
  return Math.hypot(dx, dz);
}
function distToPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

// Havaalanı düzlüğü: yerel dikdörtgen + yumuşak geçiş. 0 = tam düz (havaalanı kotu), 1 = doğal arazi.
const _lp = { x: 0, z: 0 };
function airportFlatMask(a, x, z) {
  airportLocal(a, x, z, _lp);
  const dx = Math.max(0, Math.abs(_lp.x) - a.halfX);
  const dz = Math.max(0, Math.abs(_lp.z) - a.halfZ);
  return smoothstep(0, a.fade, Math.hypot(dx, dz));
}
function townMask(x, z) {
  const t1 = smoothstep(TOWN.r + 1100, TOWN.r - 200, Math.hypot(x - TOWN.x, z - TOWN.z));
  const t2 = smoothstep(TOWN2.r + 950, TOWN2.r - 200, Math.hypot(x - TOWN2.x, z - TOWN2.z));
  return Math.max(t1, t2);
}
function roadMask(x, z) {
  let d = Infinity;
  for (const r of ROADS) { const dd = distToPolyline(x, z, r.pts); if (dd < d) d = dd; }
  // Dağ bölgesinde koridor düzleştirmesi sönümlenir (güvenlik payı)
  const edge = Math.max(Math.abs(x), Math.abs(z));
  return smoothstep(520, 230, d) * (1 - smoothstep(MTN_IN - 3000, MTN_IN + 500, edge));
}
// Dağ kuşağının başladığı ve doruğa ulaştığı kenar mesafeleri (harita yarısı 36 km)
const MTN_IN = 27000, MTN_OUT = 34500;
function softplus(v, k) { return k * Math.log1p(Math.exp(v / k)); }

export function terrainHeight(x, z) {
  // Bölgesel karakter: harita her yerde aynı görünmesin. Çok geniş ölçekli gürültü kabartma
  // çarpanını değiştirir; bazı bölgeler yayvan ova, bazıları engebeli tepelik olur.
  const region = simplex.fbm(x * 0.000032 + 17, z * 0.000032 - 23, 2, 2.0, 0.5);
  const relief = 0.55 + 0.85 * (0.5 + 0.5 * region);
  const n = simplex.fbm(x * 0.00016 + 3.1, z * 0.00016 - 2.7, 5, 2.0, 0.5);
  let h = 95 + n * 245 * relief;
  // Sırt gürültüsü: |noise| tersi doğal vadi/sırt hatları verir, düzlüklerde devreye girmez
  const ridge = 1 - Math.abs(simplex.fbm(x * 0.00040 - 8, z * 0.00040 + 14, 4, 2.05, 0.5));
  h += ridge * ridge * 170 * relief * smoothstep(55, 230, h);
  h += simplex.fbm(x * 0.0009 + 7, z * 0.0009 + 3, 3, 2.0, 0.5) * 26;
  h += simplex.fbm(x * 0.0034 + 21, z * 0.0034 - 9, 2, 2.0, 0.5) * 5.5;   // ince yüzey kabartması
  h = softplus(h, 25);
  // Kenarlara doğru dağlar
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const mtn = smoothstep(MTN_IN, MTN_OUT, edge);
  if (mtn > 0) {
    const m1 = simplex.fbm(x * 0.00030 + 11, z * 0.00030 - 5, 5, 2.1, 0.5);
    const rg = 1 - Math.abs(simplex.fbm(x * 0.00050 - 4, z * 0.00050 + 9, 3, 2.0, 0.5));
    h += mtn * (520 + 1150 * (0.5 + 0.5 * m1) + 420 * rg * rg);
  }
  // Havaalanları: yerel düzlük + kendi kotu
  for (const a of AIRPORTS) {
    const m = airportFlatMask(a, x, z);
    if (m < 0.999) h = lerp(a.elev, h, m);
  }
  h = lerp(h, 12, townMask(x, z) * 0.85);
  const rm = roadMask(x, z);
  h = lerp(h, Math.min(h, 60), rm);
  for (const L of LAKES) {
    const wob = 1 + 0.22 * simplex.noise(x * 0.0012 + L.x, z * 0.0012 + L.z);
    const d = (Math.hypot(x - L.x, z - L.z) / L.r) * wob;
    const outer = smoothstep(1.9, 1.05, d);
    h = lerp(h, 7, outer);
    const inner = smoothstep(1.06, 0.72, d);
    h = lerp(h, -16, inner);
  }
  // Nehir yatağı: kenar dağlarına yaklaşırken daralır ve sığlaşır; dağların içine kanyon oyulmaz
  const rd = distToPolyline(x, z, RIVER) * (1 + 0.25 * simplex.noise(x * 0.002 + 1, z * 0.002 + 2));
  const rt = smoothstep(MTN_IN - 8000, MTN_IN, edge);
  const wf = 1 - 0.75 * rt;
  const rOuter = smoothstep(820 * wf, 300 * wf, rd) * (1 - rt);
  h = lerp(h, 6.5, rOuter);
  const rInner = smoothstep(210 * wf, 105 * wf, rd) * (1 - smoothstep(MTN_IN - 1500, MTN_IN, edge));
  h = lerp(h, -14 + 18 * rt, rInner);
  return h;
}

export function isWaterAt(x, z) { return terrainHeight(x, z) < WATER_LEVEL; }

// Orman maskesi: iki ölçekli gürültü. Geniş ölçek orman bölgelerini, ince ölçek kenar
// düzensizliğini verir. Dar eşik aralığı ağaçları dağıtmak yerine kümeleyerek gerçek
// koruluklar oluşturur (aynı ağaç bütçesiyle çok daha dolu görünür).
function forestMask(x, z) {
  const broad = simplex.fbm(x * 0.00040 + 50, z * 0.00040 + 50, 3, 2.0, 0.5);
  const fine = simplex.fbm(x * 0.0018 - 12, z * 0.0018 + 31, 2, 2.0, 0.5);
  const hills = smoothstep(40, 240, terrainHeight(x, z));
  return smoothstep(0.02, 0.26, broad + hills * 0.14 + fine * 0.18);
}
// Bölgesel iklim: haritanın bazı bölümleri kurak (sarımsı), bazıları daha yeşil olur
function biomeDry(x, z) {
  return clamp(0.5 + 0.5 * simplex.fbm(x * 0.000045 - 61, z * 0.000045 + 44, 2, 2.0, 0.5), 0, 1);
}
// Tarla deseni: düzlüklerde dikdörtgen hücreler
function fieldPattern(x, z) {
  const cx = Math.floor(x / 360 + 0.35 * Math.sin(z * 0.0007)), cz = Math.floor(z / 240 + 0.3 * Math.cos(x * 0.0005));
  const r = mulberry32((cx * 73856093) ^ (cz * 19349663))();
  return r;
}

// ---- Hava üssü yerleşimi ----
export const AIRBASE = {
  runwayLength: 3000, runwayWidth: 45, runwayZ: 0,
  taxiwayZ: 200, taxiwayNorthZ: -200, taxiwayWidth: 23,
  apron: { x0: -760, x1: 760, z0: 211.5, z1: 580 },
  links: [-1450, -725, 0, 725, 1450],
  linksNorth: [-1450, 0, 1450],
  hangars: [-560, -280, 0, 280, 560].map((x) => ({ x, z: 700, w: 72, d: 62, h: 14, arch: 7 })),
  shelters: [-560, -400, -240, -80, 80, 240, 400, 560].map((x) => ({ x, z: 480, w: 34, d: 30, h: 8 })),
  parking: Array.from({ length: 16 }, (_, i) => ({ x: -600 + i * 80, z: 330 })),
  has: [-720, -480, -240, 0, 240, 480, 720].map((x) => ({ x, z: -470, w: 32, d: 44, h: 11 })),
  hasLaneZ: -330,
  tower: { x: 980, z: 300, r: 4.5, h: 32 },
  hq: { x: 980, z: 420, w: 70, d: 22, h: 12 },
  fuel: [-1000, -1000, -960, -960].map((x, i) => ({ x: x + (i % 2) * 0, z: 380 + Math.floor(i / 2) * 32 + (i % 2) * 0, r: 10, h: 8 })),
  waterTower: { x: 1120, z: 640 },
  radar: { x: -1200, z: -380 },
  gateZ: 1050,
};
AIRBASE.fuel = [{ x: -1010, z: 380, r: 10, h: 8 }, { x: -975, z: 380, r: 10, h: 8 }, { x: -1010, z: 410, r: 10, h: 8 }, { x: -975, z: 410, r: 10, h: 8 }];

// Sivil havalimanı yerleşimi (yerel koordinat: +X pist ekseni, +Z pistin kuzey tarafı)
export const CIVIL = {
  rwyHalf: 1700, rwyW: 45,
  taxiZ: 190, taxiW: 23, taxiHalf: 1760,
  links: [-1420, -700, 0, 700, 1420],
  apron: { x0: -940, x1: 940, z0: 201.5, z1: 560 },
  cargo: { x0: 1080, x1: 1560, z0: 215, z1: 430 },
  terminal: { x: 0, z: 655, w: 430, d: 68, h: 23 },
  pier: { x: 0, z: 585, w: 300, d: 22, h: 8 },
  tower: { x: 610, z: 640, r: 5.5, h: 42 },
  stands: [-780, -600, -420, -240, -60, 120, 300, 480, 660, 840].map((x) => ({ x, z: 300 })),
  hangars: [{ x: -1250, z: 430, w: 96, d: 74, h: 19 }, { x: -1250, z: 620, w: 96, d: 74, h: 19 }],
  fuel: [{ x: 1350, z: 560, r: 11, h: 9 }, { x: 1310, z: 600, r: 11, h: 9 }],
  carPark: { x: 0, z: 800, w: 380, d: 130 },
};

const _sp = { x: 0, z: 0 };
export function surfaceTypeAt(x, z) {
  const C = CIVIL, ca = AIRPORT_BY_ID.civil;
  airportLocal(ca, x, z, _sp);
  const lx = _sp.x, lz = _sp.z, ctw = C.taxiW / 2;
  if (Math.abs(lx) <= C.rwyHalf && Math.abs(lz) <= C.rwyW / 2) return 'runway';
  if (Math.abs(lx) <= C.taxiHalf && Math.abs(lz - C.taxiZ) <= ctw) return 'taxiway';
  for (const cl of C.links) if (Math.abs(lx - cl) <= ctw && lz >= 0 && lz <= C.apron.z0 + 1) return 'taxiway';
  if (lx >= C.apron.x0 && lx <= C.apron.x1 && lz >= C.apron.z0 && lz <= C.apron.z1) return 'apron';
  if (lx >= C.cargo.x0 && lx <= C.cargo.x1 && lz >= C.cargo.z0 && lz <= C.cargo.z1) return 'apron';
  if (Math.abs(lx) <= C.pier.w / 2 + 40 && lz > C.apron.z1 && lz <= C.terminal.z - C.terminal.d / 2) return 'apron';
  const A = AIRBASE;
  const L2 = A.runwayLength / 2, tw = A.taxiwayWidth / 2;
  if (Math.abs(x) <= L2 && Math.abs(z - A.runwayZ) <= A.runwayWidth / 2) return 'runway';
  if (Math.abs(x) <= L2 && Math.abs(z - A.taxiwayZ) <= tw) return 'taxiway';
  if (Math.abs(x) <= L2 && Math.abs(z - A.taxiwayNorthZ) <= tw) return 'taxiway';
  for (const lx of A.links) if (Math.abs(x - lx) <= tw && z >= 0 && z <= (Math.abs(lx) <= 725 ? A.apron.z0 + 1 : A.taxiwayZ)) return 'taxiway';
  for (const lx of A.linksNorth) if (Math.abs(x - lx) <= tw && z <= 0 && z >= A.taxiwayNorthZ) return 'taxiway';
  if (Math.abs(x) <= 800 && Math.abs(z - A.hasLaneZ) <= tw) return 'taxiway';
  for (const lx of [0]) if (Math.abs(x - lx) <= tw && z <= A.taxiwayNorthZ && z >= A.hasLaneZ) return 'taxiway';
  if (x >= A.apron.x0 && x <= A.apron.x1 && z >= A.apron.z0 && z <= A.apron.z1) return 'apron';
  if (Math.abs(x) <= 700 && z >= A.apron.z1 && z <= 770) return 'apron';
  if (terrainHeight(x, z) < WATER_LEVEL) return 'water';
  return 'grass';
}

export function buildingBoxes() {
  const boxes = [];
  const A = AIRBASE;
  const add = (cx, cz, w, d, h) => boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: 0, maxY: h });
  for (const h of A.hangars) add(h.x, h.z, h.w, h.d, h.h + h.arch);
  for (const s of A.shelters) add(s.x, s.z, s.w, s.d, s.h + 1);
  for (const s of A.has) add(s.x, s.z, s.w, s.d, s.h);
  add(A.tower.x, A.tower.z, 16, 16, A.tower.h + 8);
  add(A.hq.x, A.hq.z, A.hq.w, A.hq.d, A.hq.h);
  for (const f of A.fuel) add(f.x, f.z, f.r * 2, f.r * 2, f.h + 1);
  add(A.waterTower.x, A.waterTower.z, 14, 14, 30);
  add(A.radar.x, A.radar.z, 14, 14, 24);
  // Sivil havalimanı: yerel kutular dünya koordinatına çevrilerek eklenir (pist döndürülmüştür,
  // bu yüzden eksen hizalı kutu biraz büyütülerek kapsayıcı hale getirilir)
  const C = CIVIL, ca = AIRPORT_BY_ID.civil, w0 = { x: 0, z: 0 };
  const addLocal = (lx, lz, w, d, h) => {
    airportWorld(ca, lx, lz, w0);
    const e = (Math.abs(w * ca.cos) + Math.abs(d * ca.sin)) / 2, f = (Math.abs(w * ca.sin) + Math.abs(d * ca.cos)) / 2;
    boxes.push({ minX: w0.x - e, maxX: w0.x + e, minZ: w0.z - f, maxZ: w0.z + f, minY: ca.elev, maxY: ca.elev + h });
  };
  addLocal(C.terminal.x, C.terminal.z, C.terminal.w, C.terminal.d, C.terminal.h);
  addLocal(C.pier.x, C.pier.z, C.pier.w, C.pier.d, C.pier.h);
  addLocal(C.tower.x, C.tower.z, 16, 16, C.tower.h + 6);
  for (const h of C.hangars) addLocal(h.x, h.z, h.w, h.d, h.h);
  for (const f of C.fuel) addLocal(f.x, f.z, f.r * 2, f.r * 2, f.h + 1);
  return boxes;
}

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 0, drawDistance: 16000, trees: 19000, treeDistance: 5200, water: 'simple', terrainSegments: 24, anisotropy: 2, clouds: 46, lod: [4500, 9500] },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, drawDistance: 26000, trees: 42000, treeDistance: 8000, water: 'reflective', terrainSegments: 32, anisotropy: 4, clouds: 80, lod: [7000, 15500] },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, drawDistance: 42000, trees: 72000, treeDistance: 12000, water: 'reflective', terrainSegments: 40, anisotropy: 8, clouds: 125, lod: [9500, 21000] },
};

export class World {
  constructor(scene, renderer, qualityKey) {
    this.scene = scene;
    this.renderer = renderer;
    this.qualityKey = qualityKey;
    this.quality = QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.disposables = [];
    this.time = 0;
    this.halfSize = MAP_SIZE / 2;
    this.buildingBoxes = buildingBoxes();
    this.townBoxes = [];
    this.sunDir = new THREE.Vector3(0.45, 0.62, -0.35).normalize();
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildRoads();
    this.buildTown();
    this.buildAirbase();
    this.buildBaseDetails();
    this.buildCivilAirport();
    this.buildClouds();
  }

  track(obj) { this.disposables.push(obj); return obj; }

  // Gökyüzü renk fonksiyonu (su shader'ı ile paylaşılır)
  static skyGLSL() {
    return `
      vec3 skyColor(vec3 d, vec3 sunDir, vec3 zenith, vec3 horizon, vec3 ground, vec3 sunColor, float sunStrength) {
        float t = clamp(d.y, -1.0, 1.0);
        vec3 col;
        if (t >= 0.0) col = mix(horizon, zenith, pow(t, 0.5));
        else col = mix(horizon, ground, clamp(-t * 6.0, 0.0, 1.0));
        float c = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(c, 8.0) * 0.10 + pow(c, 128.0) * 0.35) * sunStrength;
        col += sunColor * smoothstep(0.99935, 0.99965, c) * 6.0 * sunStrength;
        return col;
      }`;
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    this.skyUniforms = {
      sunDir: { value: this.sunDir.clone() },
      zenith: { value: new THREE.Color(0x2f6fc4) },
      horizon: { value: new THREE.Color(0xb9d0e6) },
      ground: { value: new THREE.Color(0x9fb3c4) },
      sunColor: { value: new THREE.Color(0xfff4dc) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.999999;
        }`,
      fragmentShader: `
        uniform vec3 sunDir; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor;
        varying vec3 vDir;
        ${World.skyGLSL()}
        void main() {
          vec3 col = skyColor(normalize(vDir), sunDir, zenith, horizon, ground, sunColor, 1.0);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.scale.setScalar(30000);
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    this.sky = sky;
    this.group.add(sky);
    this.scene.fog = new THREE.Fog(new THREE.Color(0xb9d0e6), this.quality.drawDistance * 0.3, this.quality.drawDistance * 0.98);
    this.scene.background = null;
  }

  buildLights() {
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.copy(this.sunDir).multiplyScalar(600);
    sun.target.position.set(0, 0, 0);
    this.group.add(sun.target);
    if (this.quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
      const s = 70;
      sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
      sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
      sun.shadow.camera.near = 50; sun.shadow.camera.far = 1400;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.05;
      sun.shadow.radius = 2;
    }
    this.sun = sun;
    this.group.add(sun);
    this.group.add(new THREE.HemisphereLight(0x9ec3ee, 0x55603c, 1.05));
    const fill = new THREE.DirectionalLight(0xcfe0f5, 0.55);
    fill.position.set(-this.sunDir.x, 0.35, -this.sunDir.z).normalize().multiplyScalar(500);
    this.group.add(fill);
  }

  // ---- Arazi: 12x12 parça, her biri 3 LOD (etekli) ----
  buildTerrain() {
    const q = this.quality;
    // 18x18 parça = 4 km'lik hücreler. Çözünürlük üç kademelidir: havaalanı/su çevresi 2x,
    // iç bölge normal, dış dağ kuşağı yarı çözünürlük. Böylece harita 3,2 kat büyürken
    // toplam örnekleme maliyeti eskisinin altında kalır.
    const chunksPerSide = 18;
    const chunkSize = MAP_SIZE / chunksPerSide;
    this.terrainChunkSize = chunkSize;
    const segHi = q.terrainSegments;
    const grass = this.track(makeGrassTexture(512));
    grass.anisotropy = q.anisotropy;
    const mat = this.track(new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.terrainMaterial = mat;
    const C = {
      grassA: new THREE.Color(0.30, 0.54, 0.18), grassB: new THREE.Color(0.50, 0.60, 0.24),
      forest: new THREE.Color(0.15, 0.36, 0.13), rock: new THREE.Color(0.44, 0.41, 0.37),
      sand: new THREE.Color(0.64, 0.58, 0.40), high: new THREE.Color(0.50, 0.47, 0.42),
      snow: new THREE.Color(0.93, 0.94, 0.96), fieldA: new THREE.Color(0.72, 0.60, 0.26),
      fieldB: new THREE.Color(0.38, 0.52, 0.20), fieldC: new THREE.Color(0.52, 0.40, 0.22),
      town: new THREE.Color(0.56, 0.53, 0.46), road: new THREE.Color(0.55, 0.62, 0.36),
      fieldD: new THREE.Color(0.60, 0.55, 0.30), dry: new THREE.Color(0.68, 0.63, 0.36),
      lush: new THREE.Color(0.22, 0.45, 0.17), scrub: new THREE.Color(0.45, 0.45, 0.30),
      scree: new THREE.Color(0.52, 0.49, 0.45),
    };
    const tmp = new THREE.Color();
    const terrainGroup = new THREE.Group();
    terrainGroup.name = 'terrain';
    this.terrainChunks = [];
    // Su kıyıları ve üs çevresindeki parçalar 2x çözünürlük alır (nehir yatağı ızgarada kaybolmasın)
    const nMax = segHi * 2 + 1, nbMax = nMax + 2;
    const hb = new Float32Array(nbMax * nbMax);
    const cgrid = new Float32Array(nMax * nMax * 3);
    const ngrid = new Float32Array(nMax * nMax * 3);
    const isDetailChunk = (cxm, czm) => {
      const r = chunkSize * 0.72;
      for (const a of AIRPORTS) if (Math.hypot(cxm - a.x, czm - a.z) < a.halfX + a.fade * 0.5 + r) return true;
      if (distToPolyline(cxm, czm, RIVER) < r + 300) return true;
      for (const L of LAKES) if (Math.hypot(cxm - L.x, czm - L.z) < L.r * 1.9 + r) return true;
      return false;
    };
    // Dış dağ kuşağı: yakından hiç uçulmayan bölge, yarı çözünürlükte örneklenir
    const isCoarseChunk = (cxm, czm) => Math.max(Math.abs(cxm), Math.abs(czm)) > MTN_IN - chunkSize * 0.5;
    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const x0 = -MAP_SIZE / 2 + cx * chunkSize;
        const z0 = -MAP_SIZE / 2 + cz * chunkSize;
        const cxm = x0 + chunkSize / 2, czm = z0 + chunkSize / 2;
        const detail = isDetailChunk(cxm, czm);
        const segC = detail ? segHi * 2 : isCoarseChunk(cxm, czm) ? Math.max(8, segHi >> 1) : segHi;
        const n = segC + 1;
        const nb = n + 2; // kenarlıklı ızgara (normal hesabı için)
        const step = chunkSize / segC;
        for (let j = 0; j < nb; j++) for (let k = 0; k < nb; k++) hb[j * nb + k] = terrainHeight(x0 + (k - 1) * step, z0 + (j - 1) * step);
        const H = (j, k) => hb[(j + 1) * nb + (k + 1)];
        for (let j = 0; j < n; j++) {
          for (let k = 0; k < n; k++) {
            const x = x0 + k * step, z = z0 + j * step;
            const h = H(j, k);
            const dhx = (H(j, k + 1) - H(j, k - 1)) / (2 * step);
            const dhz = (H(j + 1, k) - H(j - 1, k)) / (2 * step);
            const slope = Math.hypot(dhx, dhz);
            const nl = 1 / Math.hypot(dhx, 1, dhz);
            const i3 = (j * n + k) * 3;
            ngrid[i3] = -dhx * nl; ngrid[i3 + 1] = nl; ngrid[i3 + 2] = -dhz * nl;
            const f = forestMask(x, z);
            const varn = simplex.noise(x * 0.0021, z * 0.0021) * 0.5 + 0.5;
            tmp.copy(C.grassA).lerp(C.grassB, varn);
            // Bölgesel iklim: kurak bölgeler samanlı, nemli bölgeler koyu yeşil
            const dry = biomeDry(x, z);
            tmp.lerp(C.dry, smoothstep(0.55, 0.95, dry) * 0.55);
            tmp.lerp(C.lush, smoothstep(0.45, 0.08, dry) * 0.40);
            // Yamaç yönü: güneye bakan yüzler daha açık (büyük ölçekte hacim hissi)
            tmp.offsetHSL(0, 0, clamp(-dhz * 0.35, -0.05, 0.05));
            const plains = smoothstep(110, 25, h) * (1 - f) * smoothstep(0.09, 0.02, slope);
            if (plains > 0.05) {
              const r = fieldPattern(x, z);
              const fc = r < 0.26 ? C.fieldA : r < 0.48 ? C.fieldB : r < 0.62 ? C.fieldC : r < 0.72 ? C.fieldD : null;
              if (fc) tmp.lerp(fc, plains * 0.8);
            }
            tmp.lerp(C.forest, f * 0.85);
            // Orman üst sınırı üzerinde çalılık/bodur örtü
            tmp.lerp(C.scrub, smoothstep(520, 900, h) * (1 - smoothstep(0.55, 1.1, slope)) * 0.7);
            if (h < WATER_LEVEL + 4) tmp.lerp(C.sand, smoothstep(WATER_LEVEL + 4, WATER_LEVEL - 4, h));
            tmp.lerp(C.rock, smoothstep(0.32, 0.75, slope));
            tmp.lerp(C.scree, smoothstep(0.75, 1.15, slope) * smoothstep(350, 650, h));
            tmp.lerp(C.high, smoothstep(320, 600, h));
            tmp.lerp(C.snow, smoothstep(1050, 1420, h) * (1 - smoothstep(0.9, 1.4, slope)));
            const tm = townMask(x, z);
            if (tm > 0.4) tmp.lerp(C.town, Math.min(1, (tm - 0.4) * 1.6) * 0.85);
            cgrid[i3] = tmp.r; cgrid[i3 + 1] = tmp.g; cgrid[i3 + 2] = tmp.b;
          }
        }
        const center = new THREE.Vector3(x0 + chunkSize / 2, 0, z0 + chunkSize / 2);
        const meshes = [];
        const strides = [1, 2];
        const skirts = [45, 110];
        for (let L = 0; L < 2; L++) {
          const stride = strides[L];
          const seg = segC / stride;
          const m = seg + 1;
          const nv = m * m + 4 * m;
          const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
          let vi = 0;
          const setV = (x, y, z, ci) => {
            pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z;
            col[vi * 3] = cgrid[ci]; col[vi * 3 + 1] = cgrid[ci + 1]; col[vi * 3 + 2] = cgrid[ci + 2];
            nrm[vi * 3] = ngrid[ci]; nrm[vi * 3 + 1] = ngrid[ci + 1]; nrm[vi * 3 + 2] = ngrid[ci + 2];
            uv[vi * 2] = x / 57; uv[vi * 2 + 1] = z / 57; vi++;
          };
          for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) { const gj = j * stride, gk = k * stride; setV(x0 + gk * step, H(gj, gk), z0 + gj * step, (gj * n + gk) * 3); }
          const idx = [];
          for (let j = 0; j < seg; j++) for (let k = 0; k < seg; k++) { const a = j * m + k, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d); }
          const skirt = skirts[L];
          const edges = [
            { ring: (k) => k }, { ring: (k) => (m - 1) * m + k }, { ring: (j) => j * m }, { ring: (j) => j * m + (m - 1) },
          ];
          for (let e = 0; e < 4; e++) {
            const base = vi;
            for (let t = 0; t < m; t++) {
              const src = edges[e].ring(t);
              const gj = Math.floor(src / m) * stride, gk = (src % m) * stride;
              setV(pos[src * 3], pos[src * 3 + 1] - skirt, pos[src * 3 + 2], (gj * n + gk) * 3);
            }
            for (let t = 0; t < m - 1; t++) {
              const a = edges[e].ring(t), b = edges[e].ring(t + 1), c = base + t, d = base + t + 1;
              if (e === 0 || e === 3) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
            }
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          g.setIndex(idx);
          g.computeBoundingSphere();
          this.track(g);
          const mesh = new THREE.Mesh(g, mat);
          mesh.receiveShadow = q.shadows && L === 0;
          mesh.matrixAutoUpdate = false;
          mesh.visible = L === 1;
          terrainGroup.add(mesh);
          meshes.push(mesh);
        }
        this.terrainChunks.push({ meshes, center, lod: 1 });
      }
    }
    this.group.add(terrainGroup);
  }

  // ---- Su: her su kütlesi için derinlik öznitelikli ızgara; analitik gökyüzü yansıması + fresnel + güneş parıltısı ----
  waterGrid(x0, z0, w, d, nx, nz) {
    const pos = [], dep = [], idx = [];
    for (let j = 0; j <= nz; j++) {
      for (let i = 0; i <= nx; i++) {
        const x = x0 + (i / nx) * w, z = z0 + (j / nz) * d;
        pos.push(x, WATER_LEVEL, z);
        dep.push(WATER_LEVEL - terrainHeight(x, z));
      }
    }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, dd = c + 1;
      // Tamamen karada kalan (derinliği çok negatif) dörtgenleri atla
      if (dep[a] < -6 && dep[b] < -6 && dep[c] < -6 && dep[dd] < -6) continue;
      idx.push(a, c, b, b, c, dd);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  waterStrip(pts, width, step, across) {
    const pos = [], dep = [], idx = [];
    let row = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(len / step));
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
        const t = k / n;
        const cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
        for (let q = 0; q <= across; q++) {
          const off = (q / across - 0.5) * width;
          const x = cx + nx * off, z = cz + nz * off;
          pos.push(x, WATER_LEVEL, z);
          dep.push(WATER_LEVEL - terrainHeight(x, z));
        }
        row++;
      }
    }
    const cols = across + 1;
    for (let r = 0; r < row - 1; r++) for (let q = 0; q < across; q++) {
      const a = r * cols + q, b = a + 1, c = a + cols, dd = c + 1;
      if (dep[a] < -6 && dep[b] < -6 && dep[c] < -6 && dep[dd] < -6) continue;
      // Satır yönü (akış) x enine (sol normal) -> normalin yukarı bakması için sarım ters
      idx.push(a, b, c, b, dd, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }

  buildWater() {
    const q = this.quality;
    const normals = this.track(makeWaterNormalTexture(512));
    normals.anisotropy = q.anisotropy;
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        normalMap: { value: null }, time: { value: 0 }, sunDir: { value: this.sunDir.clone() },
        shallowColor: { value: new THREE.Color(0x2e7f8e) }, waterColor: { value: new THREE.Color(0x0c3a55) }, deepColor: { value: new THREE.Color(0x04202e) },
        zenith: { value: this.skyUniforms.zenith.value }, horizon: { value: this.skyUniforms.horizon.value },
        ground: { value: this.skyUniforms.ground.value }, sunColor: { value: this.skyUniforms.sunColor.value },
        detail: { value: q.water === 'reflective' ? 1.0 : 0.6 },
      },
    ]);
    uniforms.normalMap.value = normals;
    const mat = this.track(new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        attribute float depth;
        varying vec3 vWorldPos; varying float vDepth;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz; vDepth = depth;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D normalMap; uniform float time; uniform vec3 sunDir; uniform vec3 shallowColor; uniform vec3 waterColor; uniform vec3 deepColor;
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform float detail;
        varying vec3 vWorldPos; varying float vDepth;
        #include <fog_pars_fragment>
        ${World.skyGLSL()}
        void main() {
          vec2 uv = vWorldPos.xz * 0.018;
          // Pürüzlülük değişimi: büyük ölçekli yavaş desen (sakin/rüzgarlı bölgeler)
          float rough = 0.55 + 0.45 * texture2D(normalMap, vWorldPos.xz * 0.00045 + time * 0.0015).b;
          vec3 n1 = texture2D(normalMap, uv + time * vec2(0.020, 0.014)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, uv * 2.9 - time * vec2(0.011, 0.023)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(normalMap, uv * 0.23 + time * vec2(0.004, -0.003)).xyz * 2.0 - 1.0;
          float dist = length(cameraPosition - vWorldPos);
          float fadeFine = clamp(1.0 - dist / 2200.0, 0.0, 1.0);
          float fadeCoarse = clamp(1.0 - dist / 7000.0, 0.08, 1.0);
          vec3 nt = ((n1 + n2 * 0.35) * fadeFine + n3 * 0.9 * fadeCoarse) * detail * rough;
          vec3 n = normalize(vec3(nt.x * 0.13, 1.0, nt.y * 0.13));
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 R = reflect(-V, n);
          R.y = abs(R.y) + 0.02;
          vec3 sky = skyColor(normalize(R), sunDir, zenith, horizon, ground, sunColor, 0.35);
          float cosT = max(dot(V, n), 0.0);
          float fres = 0.03 + 0.97 * pow(1.0 - cosT, 5.0);
          fres = clamp(fres, 0.10, 0.75);
          // Derinliğe göre renk: sığda turkuaz, derinde koyu
          float dNorm = clamp(vDepth / 10.0, 0.0, 1.0);
          vec3 base = mix(shallowColor, mix(waterColor, deepColor, clamp((vDepth - 6.0) / 10.0, 0.0, 1.0)), smoothstep(0.0, 0.6, dNorm));
          base = mix(base, base * 1.25, clamp(cosT * 0.6, 0.0, 1.0));
          vec3 col = mix(base, sky, fres);
          // Güneş parıltısı: pürüzlülüğe göre yayılım
          float rs = max(dot(normalize(R), sunDir), 0.0);
          float shine = mix(1400.0, 250.0, rough);
          col += sunColor * (pow(rs, shine) * (2.4 - rough) + pow(rs, 50.0) * 0.10);
          // Kıyı köpüğü: çok sığ bantta hafif beyaz
          float foamN = texture2D(normalMap, vWorldPos.xz * 0.06 + time * vec2(0.03, 0.02)).r;
          float foam = (1.0 - smoothstep(0.05, 1.1, vDepth)) * smoothstep(-0.3, 0.2, vDepth) * (0.35 + 0.65 * foamN);
          col = mix(col, vec3(0.85, 0.9, 0.92), foam * 0.45);
          // Uzaklık pusu (ufka doğru)
          col = mix(col, horizon, clamp(dist / 26000.0, 0.0, 0.35));
          float alpha = smoothstep(-0.35, 1.4, vDepth);
          gl_FragColor = vec4(col, alpha);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: true, transparent: true, depthWrite: false,
    }));
    this.waterUniforms = uniforms;
    this.waterMeshes = [];
    const addWater = (g) => {
      this.track(g);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 1;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.waterMeshes.push(m);
    };
    for (const L of LAKES) {
      const R = L.r * 1.75;
      addWater(this.waterGrid(L.x - R, L.z - R, 2 * R, 2 * R, 48, 48));
    }
    addWater(this.waterStrip(RIVER, 820, 50, 12));
    this.water = this.waterMeshes[0];
  }

  buildTrees() {
    const q = this.quality;
    const rand = mulberry32(9001);
    // Parça boyutu arazi ile aynı (4 km): 12 km'lik parçalarda tek bir parça açılınca
    // binlerce uzak ağaç birden çiziliyordu.
    const chunks = 18;
    const chunkSize = MAP_SIZE / chunks;
    const perChunk = [];
    for (let i = 0; i < chunks * chunks; i++) perChunk.push({ conifer: [], leafy: [] });
    let placed = 0, tries = 0;
    // Ağaçlar tek tek değil KORULUK olarak yerleşir: önce orman maskesine göre bir küme
    // merkezi seçilir, sonra o merkezin çevresine 8-22 ağaç dağıtılır. Aynı ağaç bütçesiyle
    // seyrek nokta dağılımı yerine gerçek koru/orman dokusu oluşur.
    const blocked = (x, z) => {
      for (const a of AIRPORTS) { airportLocal(a, x, z, _lp); if (Math.abs(_lp.x) < a.halfX * 0.62 && Math.abs(_lp.z) < a.halfZ * 0.95) return true; }
      if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 150) return true;
      if (Math.hypot(x - TOWN2.x, z - TOWN2.z) < TOWN2.r + 150) return true;
      return roadMask(x, z) > 0.9 && distToPolylineAny(x, z) < 22;
    };
    const drop = (x, z, h) => {
      const cx = clamp(Math.floor((x + MAP_SIZE / 2) / chunkSize), 0, chunks - 1);
      const cz = clamp(Math.floor((z + MAP_SIZE / 2) / chunkSize), 0, chunks - 1);
      const bucket = perChunk[cz * chunks + cx];
      const conifer = h > 160 || rand() < 0.5;
      (conifer ? bucket.conifer : bucket.leafy).push({ x, y: h, z, s: 0.75 + rand() * 0.7, r: rand() * Math.PI * 2, c: rand() });
      placed++;
    };
    // Ağaç bütçesi haritanın tamamına eşit dağıtılırsa 72x72 km'de her yer seyrek kalır.
    // Bu yüzden bütçe, oyuncunun neredeyse tüm zamanını geçirdiği bölgeye — iki havaalanı
    // arasındaki koridora ve havaalanı çevrelerine — ağırlıklı dağıtılır. Uzak köşeler
    // tamamen boş kalmaz, yalnızca daha seyrektir.
    const A0 = AIRPORTS[0], A1 = AIRPORTS[1];
    const activity = (x, z) => {
      const d = distToSegment(x, z, A0.x, A0.z, A1.x, A1.z);
      return 0.26 + 0.74 * smoothstep(21000, 8000, d);
    };
    while (placed < q.trees && tries < q.trees * 3) {
      tries++;
      const x0 = (rand() - 0.5) * MAP_SIZE * 0.98;
      const z0 = (rand() - 0.5) * MAP_SIZE * 0.98;
      if (rand() > activity(x0, z0)) continue;
      const f = forestMask(x0, z0);
      if (rand() > f * 0.95 + 0.01) continue;
      const h0 = terrainHeight(x0, z0);
      if (h0 < WATER_LEVEL + 3 || h0 > 1250) continue;
      if (blocked(x0, z0)) continue;
      // Koru yarıçapı ve ağaç sayısı maske gücüne göre: maskenin güçlü olduğu yerde sık orman
      const radius = 34 + rand() * 62;
      const count = Math.round(7 + f * 16 + rand() * 5);
      for (let k = 0; k < count && placed < q.trees; k++) {
        const a = rand() * Math.PI * 2, rr = radius * Math.sqrt(rand());
        const x = x0 + Math.cos(a) * rr, z = z0 + Math.sin(a) * rr;
        const h = terrainHeight(x, z);
        if (h < WATER_LEVEL + 3 || h > 1300) continue;
        const e = 9;
        const slope = Math.hypot(terrainHeight(x + e, z) - terrainHeight(x - e, z), terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
        if (slope > 0.85) continue;
        drop(x, z, h);
      }
    }
    // Düşük üçgen bütçesi: ağaçlar kare maliyetinin en büyük kalemi olduğundan gövde ve
    // taçlar mümkün olan en az segmentle kurulur (siluet uzaktan aynı okunur).
    const trunk = new THREE.CylinderGeometry(0.3, 0.5, 4, 4, 1, true); trunk.translate(0, 2, 0);
    const cone1 = new THREE.ConeGeometry(2.6, 8, 6); cone1.translate(0, 7, 0);
    const cone2 = new THREE.ConeGeometry(1.8, 6, 6); cone2.translate(0, 11, 0);
    const colorize = (g, color) => { const n = g.attributes.position.count; const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; } g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g; };
    const brown = new THREE.Color(0.32, 0.22, 0.12), darkGreen = new THREE.Color(0.14, 0.32, 0.14), leafGreen = new THREE.Color(0.28, 0.48, 0.18);
    colorize(trunk, brown); colorize(cone1, darkGreen); colorize(cone2, darkGreen);
    const coniferGeo = mergeGeometries([trunk, cone1, cone2].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const trunk2 = new THREE.CylinderGeometry(0.35, 0.55, 5, 4, 1, true); trunk2.translate(0, 2.5, 0);
    const crown = new THREE.IcosahedronGeometry(3.6, 0); crown.translate(0, 7.5, 0);
    colorize(trunk2, brown); colorize(crown, leafGreen);
    const leafyGeo = mergeGeometries([trunk2, crown].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    this.track(coniferGeo); this.track(leafyGeo);
    const mat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    this.treeAssets = { coniferGeo, leafyGeo, mat };
    this.treeChunks = [];
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    for (let i = 0; i < perChunk.length; i++) {
      const cx = i % chunks, cz = Math.floor(i / chunks);
      const center = new THREE.Vector3(-MAP_SIZE / 2 + (cx + 0.5) * chunkSize, 0, -MAP_SIZE / 2 + (cz + 0.5) * chunkSize);
      for (const [key, geo] of [['conifer', coniferGeo], ['leafy', leafyGeo]]) {
        const list = perChunk[i][key];
        if (list.length === 0) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        for (let k = 0; k < list.length; k++) {
          const t = list[k];
          pos.set(t.x, t.y - 0.3, t.z);
          quat.setFromAxisAngle(up, t.r);
          scl.set(t.s, t.s * (0.9 + t.c * 0.4), t.s);
          m4.compose(pos, quat, scl);
          im.setMatrixAt(k, m4);
          tint.setRGB(0.85 + t.c * 0.3, 0.85 + (1 - t.c) * 0.3, 0.9);
          im.setColorAt(k, tint);
        }
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = q.shadows && q.shadowMap >= 2048;
        im.layers.set(LAYER_TREES);
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false;
        this.group.add(im);
        this.treeChunks.push({ mesh: im, center, radius: chunkSize * 0.71 });
      }
    }
    this.treeCount = placed;
  }

  // Yol şeridi: poligon çizgi boyunca araziyi izleyen üçgen şerit
  roadGeometry(pts, width, yOffset = 0.3, minY = -Infinity) {
    const positions = [], uvs = [], idx = [];
    let v = 0, dist = 0;
    const samples = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(len / 18));
      for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
        const t = k / n;
        samples.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len });
      }
    }
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
      let tx = next.x - prev.x, tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      if (i > 0) dist += Math.hypot(s.x - prev.x, s.z - prev.z);
      const y = Math.max(terrainHeight(s.x, s.z), minY) + yOffset;
      positions.push(s.x - nx * width / 2, y, s.z - nz * width / 2, s.x + nx * width / 2, y, s.z + nz * width / 2);
      uvs.push(0, dist / 20, 1, dist / 20);
      if (i > 0) { const a = v - 2, b = v - 1, c = v, d = v + 1; idx.push(a, b, c, b, d, c); }
      v += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildRoads() {
    const tex = this.track(makeRoadTexture(128, 256));
    tex.anisotropy = this.quality.anisotropy;
    // Kavşaklarda z-fighting olmaması için yollar iki katmana ayrılır: doğu-batı (alt) ve kuzey-güney (üst).
    // Aynı malzemede eş düzlemli kesişen dörtgenler derinlik tamponunda yarışırdı; ayrı ofsetlerle sıra kesinleşir.
    const mkMat = (units) => this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units }));
    const all = [...ROADS, ...TOWN_STREETS];
    for (const [over, units, yOff] of [[false, -3, 0.30], [true, -6, 0.33]]) {
      const geos = all.filter((r) => !!r.over === over).map((r) => this.roadGeometry(r.pts, r.w, yOff, WATER_LEVEL + 9));
      if (!geos.length) continue;
      const merged = this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false));
      geos.forEach((g) => g.dispose());
      const mesh = new THREE.Mesh(merged, mkMat(units));
      mesh.receiveShadow = false;
      this.group.add(mesh);
    }
    // Nehir köprüsü ayakları
    const pierMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.8 }));
    const piers = [];
    for (const [x, z] of [[1750, 4280], [1850, 4360]]) {
      const g = new THREE.BoxGeometry(6, 26, 4); g.translate(x, -8, z); piers.push(g);
    }
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(piers, false)), pierMat));
  }

  buildTown() {
    const rand = mulberry32(4242);
    // Ev geometrisi: gövde + çatı, vertex renkleri
    const body = new THREE.BoxGeometry(9, 4, 7); body.translate(0, 2, 0);
    const roofShape = new THREE.Shape(); roofShape.moveTo(-4.9, 0); roofShape.lineTo(4.9, 0); roofShape.lineTo(0, 2.6); roofShape.lineTo(-4.9, 0);
    const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 7.6, bevelEnabled: false }); roof.translate(0, 4, -3.8);
    const colorize = (g, color) => { const n = g.attributes.position.count; const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; } g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g; };
    colorize(body, new THREE.Color(0.88, 0.84, 0.74));
    colorize(roof, new THREE.Color(0.55, 0.26, 0.20));
    const bodyNI = body.index ? body.toNonIndexed() : body; const roofNI = roof.index ? roof.toNonIndexed() : roof;
    for (const g of [bodyNI, roofNI]) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    const houseGeo = this.track(mergeGeometries([bodyNI, roofNI], false));
    const houseMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    const houses = [];
    const gridX = 30, gridZ = 27;
    for (const T of [TOWN, TOWN2]) {
      for (let gz = -40; gz <= 40; gz++) {
        for (let gx = -40; gx <= 40; gx++) {
          const x = T.x + gx * gridX + (rand() - 0.5) * 8, z = T.z + gz * gridZ + (rand() - 0.5) * 8;
          const d = Math.hypot(x - T.x, z - T.z);
          if (d > T.r * (0.75 + 0.35 * rand())) continue;
          if (rand() < 0.5) continue;
          if (distToPolylineAny(x, z) < 12) continue;
          const h = terrainHeight(x, z);
          if (h < 3) continue;
          houses.push({ x, y: h, z, rot: (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.15, s: 0.8 + rand() * 0.5, c: rand() });
        }
      }
    }
    const im = new THREE.InstancedMesh(houseGeo, houseMat, houses.length);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qu = new THREE.Quaternion(), sc = new THREE.Vector3(), tint = new THREE.Color();
    houses.forEach((hh, i) => {
      p.set(hh.x, hh.y, hh.z); qu.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hh.rot); sc.set(hh.s, hh.s * (0.9 + hh.c * 0.5), hh.s);
      m4.compose(p, qu, sc); im.setMatrixAt(i, m4);
      tint.setRGB(0.8 + hh.c * 0.25, 0.8 + (1 - hh.c) * 0.2, 0.75 + hh.c * 0.2); im.setColorAt(i, tint);
      this.townBoxes.push({ minX: hh.x - 5 * hh.s, maxX: hh.x + 5 * hh.s, minZ: hh.z - 4 * hh.s, maxZ: hh.z + 4 * hh.s, minY: 0, maxY: hh.y + 7 * hh.s });
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false; im.computeBoundingSphere(); im.matrixAutoUpdate = false;
    this.group.add(im);
    this.houseCount = houses.length;
    // Apartman blokları ve depo
    const winTex = this.track(makeWindowsTexture(512, 256, 10, 4));
    const blockMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const blocks = [];
    const blockDefs = [
      [2600, 6650, 26, 16, 16], [2400, 7100, 22, 14, 13], [2850, 7150, 30, 16, 19], [2350, 6600, 20, 14, 12], [3000, 6650, 24, 15, 15],
      [21200, -13800, 24, 15, 15], [21000, -13350, 20, 13, 12], [21500, -13300, 26, 15, 17], [20900, -13900, 18, 13, 11],
    ];
    for (const [x, z, w, d, h] of blockDefs) {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 14), uv.getY(i) * (h / 8));
      const y = terrainHeight(x, z);
      g.translate(x, y + h / 2, z);
      blocks.push(g);
      this.townBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: y + h });
    }
    const bm = new THREE.Mesh(this.track(mergeGeometries(blocks, false)), blockMat);
    bm.castShadow = false;
    this.group.add(bm);
    this.townCenter = new THREE.Vector3(TOWN.x, 12, TOWN.z);
  }

  buildClouds() {
    const q = this.quality;
    const tex = this.track(makeCloudTexture(256));
    const rand = mulberry32(777);
    const n = q.clouds;
    const quad = this.track(new THREE.PlaneGeometry(1, 1));
    const vert = `
      attribute vec2 uv2;
      varying vec2 vUv; varying float vFog;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        camRight = normalize(vec3(camRight.x, 0.0, camRight.z));
        vec3 wp = center + camRight * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`;
    const frag = `
      uniform sampler2D map; uniform vec3 sunDir;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec4 c = texture2D(map, vUv);
        float shade = 0.82 + 0.18 * vUv.y;
        gl_FragColor = vec4(c.rgb * shade, c.a * 0.92);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, sunDir: { value: this.sunDir } }]);
    uniforms.map.value = tex;
    const billMat = this.track(new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide }));
    const flatMat = this.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.6, side: THREE.DoubleSide, fog: true }));
    const per = 3;
    const bill = new THREE.InstancedMesh(quad, billMat, n * per);
    const flat = new THREE.InstancedMesh(quad, flatMat, n);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qu = new THREE.Quaternion(), sc = new THREE.Vector3();
    const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < n; i++) {
      const x = (rand() - 0.5) * MAP_SIZE * 0.9, z = (rand() - 0.5) * MAP_SIZE * 0.9;
      const y = 1900 + rand() * 1500;
      const w = 900 + rand() * 1500;
      for (let k = 0; k < per; k++) {
        const ox = (rand() - 0.5) * w * 0.7, oz = (rand() - 0.5) * w * 0.7, oy = (rand() - 0.3) * w * 0.12;
        const ww = w * (0.55 + rand() * 0.6), hh = ww * (0.32 + rand() * 0.2);
        p.set(x + ox, y + oy, z + oz); qu.identity(); sc.set(ww, hh, 1);
        m4.compose(p, qu, sc); bill.setMatrixAt(i * per + k, m4);
      }
      p.set(x, y - w * 0.12, z); sc.set(w * 1.3, w * 1.0, 1);
      m4.compose(p, flatQ, sc); flat.setMatrixAt(i, m4);
    }
    bill.instanceMatrix.needsUpdate = true; flat.instanceMatrix.needsUpdate = true;
    bill.frustumCulled = false; flat.frustumCulled = false;
    bill.renderOrder = 3; flat.renderOrder = 2;
    this.group.add(flat); this.group.add(bill);
    this.clouds = [bill, flat];
  }

  // ---- Sivil havalimanı --------------------------------------------------
  // Tümü yerel koordinatta kurulur (+X pist ekseni), sonunda grup döndürülüp yerine taşınır.
  // Böylece pist istenen yöne çevrilebilir ve yüzey sorguları tek kod yolunu kullanır.
  buildCivilAirport() {
    const C = CIVIL, ap = AIRPORT_BY_ID.civil, q = this.quality;
    const g = new THREE.Group();
    g.name = 'civil-airport';
    g.position.set(ap.x, ap.elev, ap.z);
    g.rotation.y = -(ap.hdg - 90) * Math.PI / 180;
    const asphalt = this.track(makeAsphaltTexture(512));
    const concrete = this.track(makeConcreteTexture(512));
    asphalt.anisotropy = q.anisotropy; concrete.anisotropy = q.anisotropy;
    const asphaltMat = this.track(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const concreteMat = this.track(new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }));
    const whiteMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    const yellowMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8b52a, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    const flat = (w, d, x, z, y, uvScale = 1) => {
      const pg = new THREE.PlaneGeometry(w, d);
      pg.rotateX(-Math.PI / 2); pg.translate(x, y, z);
      const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / uvScale), uv.getY(i) * (d / uvScale));
      return pg;
    };
    const tw = C.taxiW;
    // Asfalt: pist, paralel taksi yolu, bağlantılar
    const asphaltGeos = [
      flat(C.rwyHalf * 2, C.rwyW, 0, 0, 0.05, 18),
      flat(C.taxiHalf * 2, tw, 0, C.taxiZ, 0.05, 18),
    ];
    const z0 = C.rwyW / 2, z1 = C.taxiZ - tw / 2;
    for (const lx of C.links) asphaltGeos.push(flat(tw, z1 - z0, lx, (z0 + z1) / 2, 0.05, 18));
    // Taksi yolundan aprona bağlantılar
    for (const lx of [-700, 0, 700]) asphaltGeos.push(flat(tw, C.apron.z0 - (C.taxiZ + tw / 2), lx, (C.apron.z0 + C.taxiZ + tw / 2) / 2, 0.05, 18));
    // Pist sonu emniyet sahaları
    for (const side of [-1, 1]) asphaltGeos.push(flat(90, C.rwyW, side * (C.rwyHalf + 45), 0, 0.04, 18));
    const am = new THREE.Mesh(this.track(mergeGeometries(asphaltGeos, false)), asphaltMat);
    am.receiveShadow = q.shadows; g.add(am);
    // Beton: apron, kargo apronu, terminal önü, otopark
    const conGeos = [
      flat(C.apron.x1 - C.apron.x0, C.apron.z1 - C.apron.z0, (C.apron.x0 + C.apron.x1) / 2, (C.apron.z0 + C.apron.z1) / 2, 0.06, 14),
      flat(C.cargo.x1 - C.cargo.x0, C.cargo.z1 - C.cargo.z0, (C.cargo.x0 + C.cargo.x1) / 2, (C.cargo.z0 + C.cargo.z1) / 2, 0.06, 14),
      // Terminal önü: terminalin tamamı beton üzerinde otursun, apronla arada boşluk kalmasın
      flat(C.terminal.w + 20, C.terminal.z + C.terminal.d / 2 + 30 - C.apron.z1, 0, (C.apron.z1 + C.terminal.z + C.terminal.d / 2 + 30) / 2, 0.06, 14),
      flat(C.carPark.w, C.carPark.d, C.carPark.x, C.carPark.z, 0.06, 14),
      // Otopark bağlantısı ve kargo apronu bağlantısı
      flat(70, C.carPark.z - C.carPark.d / 2 - (C.terminal.z + C.terminal.d / 2 + 30), 0, (C.terminal.z + C.terminal.d / 2 + 30 + C.carPark.z - C.carPark.d / 2) / 2, 0.06, 14),
      flat(C.cargo.x0 - C.apron.x1, 60, (C.apron.x1 + C.cargo.x0) / 2, 300, 0.06, 14),
    ];
    const cm = new THREE.Mesh(this.track(mergeGeometries(conGeos, false)), concreteMat);
    cm.receiveShadow = q.shadows; g.add(cm);
    // Pist işaretleri: orta çizgi, eşik şeritleri, kenar çizgileri, temas bölgesi
    const marks = [];
    for (let x = -C.rwyHalf + 40; x < C.rwyHalf - 40; x += 60) marks.push(flat(30, 0.9, x, 0, 0.11));
    for (const side of [-1, 1]) {
      marks.push(flat(C.rwyHalf * 2, 0.35, 0, side * (C.rwyW / 2 - 0.6), 0.11));
      for (let k = 0; k < 8; k++) marks.push(flat(28, 1.6, side * (C.rwyHalf - 60), (k - 3.5) * 3.6, 0.11));   // eşik tarağı
      for (const d of [150, 300, 450]) for (const s2 of [-1, 1]) marks.push(flat(22, 2.6, side * (C.rwyHalf - d), s2 * 9, 0.11));
    }
    const mm = new THREE.Mesh(this.track(mergeGeometries(marks, false)), whiteMat);
    g.add(mm);
    // Taksi yolu ve apron sarı çizgileri
    const yel = [flat(C.taxiHalf * 2, 0.6, 0, C.taxiZ, 0.11)];
    for (const st of C.stands) { yel.push(flat(0.6, 92, st.x, st.z + 46, 0.12)); yel.push(flat(34, 0.6, st.x, st.z, 0.12)); }
    for (const lx of C.links) yel.push(flat(0.6, z1 - z0, lx, (z0 + z1) / 2, 0.11));
    const ym = new THREE.Mesh(this.track(mergeGeometries(yel, false)), yellowMat);
    g.add(ym);
    // Pist numaraları (12 / 30)
    for (const [i, side] of [[0, -1], [1, 1]]) {
      const tex = this.track(makeTextTexture(ap.marks[i], 256, 128));
      const pg = new THREE.PlaneGeometry(26, 42);
      pg.rotateX(-Math.PI / 2); pg.rotateY(side > 0 ? Math.PI : 0);
      const nm = new THREE.Mesh(this.track(pg), this.track(new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -9 })));
      nm.position.set(side * (C.rwyHalf - 105), 0.12, 0);
      g.add(nm);
    }
    // Terminal: uzun cam cepheli bina + parmak iskele
    const winTex = this.track(makeWindowsTexture(512, 256, 16, 3));
    const glassMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.45, metalness: 0.25 }));
    const wallMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd6dadd, roughness: 0.8 }));
    const roofMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6f767c, roughness: 0.9 }));
    const T = C.terminal;
    const tBody = new THREE.BoxGeometry(T.w, T.h, T.d);
    const tuv = tBody.attributes.uv; for (let i = 0; i < tuv.count; i++) tuv.setXY(i, tuv.getX(i) * (T.w / 26), tuv.getY(i) * (T.h / 6));
    tBody.translate(T.x, T.h / 2, T.z);
    const tMesh = new THREE.Mesh(this.track(tBody), glassMat); tMesh.castShadow = q.shadows; tMesh.receiveShadow = q.shadows; g.add(tMesh);
    const tRoof = new THREE.BoxGeometry(T.w + 14, 2.2, T.d + 14); tRoof.translate(T.x, T.h + 1.1, T.z);
    g.add(new THREE.Mesh(this.track(tRoof), roofMat));
    // Çatı üstü teknik hacim: terminal uzaktan ince bir çubuk gibi görünmesin
    const tPent = new THREE.BoxGeometry(T.w * 0.55, 6, T.d * 0.55); tPent.translate(T.x, T.h + 5.2, T.z);
    const tp = new THREE.Mesh(this.track(tPent), roofMat); tp.castShadow = q.shadows; g.add(tp);
    const P = C.pier;
    const pBody = new THREE.BoxGeometry(P.w, P.h, P.d);
    const puv = pBody.attributes.uv; for (let i = 0; i < puv.count; i++) puv.setXY(i, puv.getX(i) * (P.w / 26), puv.getY(i) * (P.h / 6));
    pBody.translate(P.x, P.h / 2, P.z);
    const pMesh = new THREE.Mesh(this.track(pBody), glassMat); pMesh.castShadow = q.shadows; g.add(pMesh);
    // Körükler: iskeleden apron duraklarına
    const jet = [];
    for (const st of C.stands.filter((_, i) => i % 2 === 0)) {
      const len = P.z - P.d / 2 - (st.z + 50);
      if (len < 4) continue;
      const b = new THREE.BoxGeometry(3.4, 3.2, len);
      b.translate(st.x, 4.6, st.z + 50 + len / 2);
      jet.push(b);
      const leg = new THREE.CylinderGeometry(0.5, 0.5, 4.6, 6); leg.translate(st.x, 2.3, st.z + 52);
      jet.push(leg.toNonIndexed ? leg : leg);
    }
    if (jet.length) {
      for (const jg of jet) if (!jg.attributes.uv) jg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(jg.attributes.position.count * 2), 2));
      const jm = new THREE.Mesh(this.track(mergeGeometries(jet.map((x2) => (x2.index ? x2.toNonIndexed() : x2)), false)), wallMat);
      jm.castShadow = q.shadows; g.add(jm);
    }
    // Kule
    const tw2 = C.tower;
    const shaft = new THREE.CylinderGeometry(tw2.r * 0.7, tw2.r, tw2.h, 12); shaft.translate(tw2.x, tw2.h / 2, tw2.z);
    g.add(new THREE.Mesh(this.track(shaft), wallMat));
    const cab = new THREE.CylinderGeometry(tw2.r * 1.9, tw2.r * 1.5, 6, 12); cab.translate(tw2.x, tw2.h + 3, tw2.z);
    const cabMesh = new THREE.Mesh(this.track(cab), this.track(new THREE.MeshStandardMaterial({ color: 0x1d2a35, roughness: 0.25, metalness: 0.4 })));
    cabMesh.castShadow = q.shadows; g.add(cabMesh);
    const cabRoof = new THREE.CylinderGeometry(tw2.r * 2.1, tw2.r * 2.1, 0.8, 12); cabRoof.translate(tw2.x, tw2.h + 6.4, tw2.z);
    g.add(new THREE.Mesh(this.track(cabRoof), roofMat));
    // Hangarlar ve yakıt tankları
    const hangarGeos = [], tankGeos = [];
    for (const h of C.hangars) {
      const b = new THREE.BoxGeometry(h.w, h.h, h.d); b.translate(h.x, h.h / 2, h.z); hangarGeos.push(b);
      const arc = new THREE.CylinderGeometry(h.d / 2, h.d / 2, h.w, 14, 1, false, 0, Math.PI);
      arc.rotateZ(Math.PI / 2); arc.translate(h.x, h.h, h.z); hangarGeos.push(arc);
    }
    for (const f of C.fuel) { const t2 = new THREE.CylinderGeometry(f.r, f.r, f.h, 14); t2.translate(f.x, f.h / 2, f.z); tankGeos.push(t2); }
    const addM = (geos, mat, shadow) => {
      if (!geos.length) return;
      for (const gg of geos) if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
      const mesh = new THREE.Mesh(this.track(mergeGeometries(geos.map((x2) => (x2.index ? x2.toNonIndexed() : x2)), false)), mat);
      mesh.castShadow = q.shadows && shadow; mesh.receiveShadow = q.shadows; g.add(mesh);
    };
    addM(hangarGeos, wallMat, true);
    addM(tankGeos, this.track(new THREE.MeshStandardMaterial({ color: 0xc8ccce, roughness: 0.6, metalness: 0.3 })), true);
    // Park halinde yolcu uçakları: apron boş bir beton levha gibi görünmesin.
    // Kutu/silindirden kurulu düşük maliyetli siluet (uçak başına ~120 üçgen).
    const planeGeos = [], planeDark = [];
    const parkPlane = (px, pz, rot, scale) => {
      const parts = [], dark = [];
      const L = 38 * scale, R = 1.9 * scale, SP = 17 * scale;
      const fus = new THREE.CylinderGeometry(R, R * 0.55, L, 8);
      fus.rotateX(Math.PI / 2); fus.translate(0, R + 3.0 * scale, 0);
      parts.push(fus);
      const nose = new THREE.SphereGeometry(R, 8, 5); nose.scale(1, 1, 1.6); nose.translate(0, R + 3.0 * scale, -L / 2);
      parts.push(nose);
      const wing = new THREE.BoxGeometry(SP * 2, 0.55 * scale, 6.5 * scale);
      wing.translate(0, R + 2.2 * scale, 1.5 * scale); parts.push(wing);
      const tail = new THREE.BoxGeometry(0.6 * scale, 9.5 * scale, 7 * scale);
      tail.translate(0, R + 7.5 * scale, L / 2 - 3.5 * scale); parts.push(tail);
      const htail = new THREE.BoxGeometry(12 * scale, 0.45 * scale, 3.5 * scale);
      htail.translate(0, R + 3.4 * scale, L / 2 - 2 * scale); parts.push(htail);
      for (const sx of [-1, 1]) {
        const nac = new THREE.CylinderGeometry(1.3 * scale, 1.15 * scale, 4.6 * scale, 8);
        nac.rotateX(Math.PI / 2); nac.translate(sx * 6.2 * scale, R - 0.4 * scale, -0.5 * scale);
        dark.push(nac);
      }
      const m4 = new THREE.Matrix4().makeRotationY(rot).setPosition(px, 0, pz);
      for (const gg of parts) { gg.applyMatrix4(m4); planeGeos.push(gg); }
      for (const gg of dark) { gg.applyMatrix4(m4); planeDark.push(gg); }
    };
    C.stands.forEach((st2, i) => { if (i % 3 !== 1) return; parkPlane(st2.x, st2.z + 26, Math.PI, 1); });
    parkPlane((C.cargo.x0 + C.cargo.x1) / 2, (C.cargo.z0 + C.cargo.z1) / 2, Math.PI * 0.5, 0.92);
    const planeMat = this.track(new THREE.MeshStandardMaterial({ color: 0xeceff2, roughness: 0.5, metalness: 0.1 }));
    addM2(planeGeos, planeMat, g, q);
    addM2(planeDark, this.track(new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.45, metalness: 0.5 })), g, q);
    // Pist kenar ışıkları ve yaklaşma ışıkları (uzakta gizlenir: piksel altı parıldamayı önler)
    const lights = [];
    const lg = new THREE.SphereGeometry(0.42, 5, 4);
    for (let x = -C.rwyHalf; x <= C.rwyHalf; x += 60) for (const s2 of [-1, 1]) { const b = lg.clone(); b.translate(x, 0.45, s2 * (C.rwyW / 2 + 1.6)); lights.push(b); }
    for (let k = 1; k <= 8; k++) for (const s2 of [-1, 1]) { const b = lg.clone(); b.translate(s2 * (C.rwyHalf + k * 55), 0.5, 0); lights.push(b); }
    const lm = new THREE.Mesh(this.track(mergeGeometries(lights, false)), this.track(new THREE.MeshStandardMaterial({ color: 0xf2f4e2, emissive: 0xfff3c8, emissiveIntensity: 0.55, roughness: 0.5 })));
    g.add(lm);
    this.civilLights = lm;
    this.civilCenter = new THREE.Vector3(ap.x, ap.elev, ap.z);
    this.group.add(g);
    this.civilGroup = g;
  }

  buildAirbase() {
    const A = AIRBASE;
    const q = this.quality;
    const asphalt = this.track(makeAsphaltTexture(512));
    const concrete = this.track(makeConcreteTexture(512));
    asphalt.anisotropy = q.anisotropy; concrete.anisotropy = q.anisotropy;
    // Derinlik katmanlaması: arazi (0) < asfalt < beton < yollar < işaretler < pist numaraları.
    // polygonOffset "units" pencere-derinlik çözünürlüğü cinsinden olduğundan her mesafede z-fighting'i keser
    // (5–10 cm'lik fiziksel yükseklik farkları uzaktan çözülemez).
    const asphaltMat = this.track(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const concreteMat = this.track(new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 }));
    const whiteMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    const yellowMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8b52a, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    const base = new THREE.Group();
    base.name = 'airbase';
    const flat = (w, d, x, z, y, uvScale = 1) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / uvScale), uv.getY(i) * (d / uvScale));
      return g;
    };
    const L = A.runwayLength / 2, W = A.runwayWidth, tw = A.taxiwayWidth;
    const y = 0.09;

    // Asfalt: pist, iki paralel taksi yolu, bağlantılar, HAS şeridi, üs yolları
    const asphaltGeos = [
      flat(A.runwayLength, W, 0, A.runwayZ, 0.05, 18),
      flat(A.runwayLength + 60, tw, 0, A.taxiwayZ, 0.05, 18),
      flat(A.runwayLength + 60, tw, 0, A.taxiwayNorthZ, 0.05, 18),
      flat(1620, tw, 0, A.hasLaneZ, 0.05, 18),
      flat(tw, (A.taxiwayNorthZ - tw / 2) - (A.hasLaneZ + tw / 2), 0, ((A.taxiwayNorthZ - tw / 2) + (A.hasLaneZ + tw / 2)) / 2, 0.05, 18),
    ];
    // Bağlantı taksi yolları yalnızca pist kenarı ile taksi yolu kenarı arasında (çakışan eş düzlemli yüzey yok;
    // apron kenarı taksi yolunun uzak kenarıyla çakışık olduğundan ek parça gerekmez)
    const linkZ0 = W / 2, linkZ1 = A.taxiwayZ - tw / 2;
    for (const lx of A.links) asphaltGeos.push(flat(tw, linkZ1 - linkZ0, lx, (linkZ0 + linkZ1) / 2, 0.05, 18));
    const nZ0 = A.taxiwayNorthZ + tw / 2, nZ1 = -W / 2;
    for (const lx of A.linksNorth) asphaltGeos.push(flat(tw, nZ1 - nZ0, lx, (nZ0 + nZ1) / 2, 0.05, 18));
    // Pist kenarı toprak sahalar (kırılma sahası)
    for (const side of [-1, 1]) asphaltGeos.push(flat(80, W, side * (L + 40), 0, 0.04, 18));
    // Üs iç yolları
    // (kesişimlerde çakışma olmaması için yollar parçalara bölünür; z=800 yolu tam geçer, dikey yollar ona kadar gelir)
    asphaltGeos.push(flat(1720, 10, 0, 800, 0.06, 20));
    asphaltGeos.push(flat(10, 235, -830, 687.5, 0.06, 20), flat(10, 245, -830, 927.5, 0.06, 20));   // batı yolu (z 570–795, 805–1050)
    asphaltGeos.push(flat(10, 295, 830, 647.5, 0.06, 20));                                          // doğu yolu (z 500–795)
    asphaltGeos.push(flat(10, 25, 0, 782.5, 0.06, 20), flat(10, 245, 0, 927.5, 0.06, 20));         // orta yol (beton bitişi 770'ten 795'e, 805–1050)
    asphaltGeos.push(flat(240, 10, 1000, 500, 0.06, 20));
    const asphaltMesh = new THREE.Mesh(this.track(mergeGeometries(asphaltGeos, false)), asphaltMat);
    asphaltMesh.receiveShadow = q.shadows;
    base.add(asphaltMesh);

    // Beton: ana apron, hangar önleri, HAS önleri, HQ çevresi, yakıt çiftliği
    const ap = A.apron;
    const concreteGeos = [flat(ap.x1 - ap.x0, ap.z1 - ap.z0, (ap.x0 + ap.x1) / 2, (ap.z0 + ap.z1) / 2, 0.06, 30)];
    concreteGeos.push(flat(1400, 190, 0, 675, 0.06, 30));
    for (const s of A.has) concreteGeos.push(flat(s.w + 16, 100, s.x, s.z + s.d / 2 + 50 - 20, 0.06, 30));
    concreteGeos.push(flat(200, 200, A.tower.x, 360, 0.06, 30));
    concreteGeos.push(flat(120, 100, -990, 395, 0.06, 30));
    concreteGeos.push(flat(90, 60, 1120, 640, 0.06, 30));
    concreteGeos.push(flat(60, 60, A.radar.x, A.radar.z, 0.06, 30));
    const concreteMesh = new THREE.Mesh(this.track(mergeGeometries(concreteGeos, false)), concreteMat);
    concreteMesh.receiveShadow = q.shadows;
    base.add(concreteMesh);

    // Pist işaretleri (beyaz)
    const white = [];
    white.push(flat(A.runwayLength, 0.9, 0, W / 2 - 0.6, y));
    white.push(flat(A.runwayLength, 0.9, 0, -W / 2 + 0.6, y));
    for (const side of [-1, 1]) {
      const xs = side * (L - 6 - 15);
      for (let i = 0; i < 12; i++) { const z = -W / 2 + 3.6 + i * ((W - 7.2) / 11); white.push(flat(30, 1.8, xs, z, y)); }
      const xa = side * (L - 300 - 25);
      white.push(flat(50, 8, xa, 10, y)); white.push(flat(50, 8, xa, -10, y));
      for (const [dist, count] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) {
        const xt = side * (L - dist - 11);
        for (let k = 0; k < count; k++) { const off = 9 + k * 3; white.push(flat(22, 1.8, xt, off, y)); white.push(flat(22, 1.8, xt, -off, y)); }
      }
    }
    for (let x = -L + 120; x < L - 120; x += 50) white.push(flat(30, 0.9, x + 15, 0, y));
    base.add(new THREE.Mesh(this.track(mergeGeometries(white, false)), whiteMat));
    const numMat = (t) => this.track(new THREE.MeshBasicMaterial({ map: this.track(makeTextTexture(t, { w: 256, h: 256, font: 'bold 190px Arial', color: '#e8e8e2' })), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 }));
    const numGeo = this.track(new THREE.PlaneGeometry(18, 18));
    const n09 = new THREE.Mesh(numGeo, numMat('09')); n09.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); n09.position.set(-L + 75, 0.1, 0); base.add(n09);
    const n27 = new THREE.Mesh(numGeo, numMat('27')); n27.rotation.set(-Math.PI / 2, 0, Math.PI / 2); n27.position.set(L - 75, 0.1, 0); base.add(n27);

    // Sarı taksi hatları ve park yerleri
    const yellow = [flat(A.runwayLength + 20, 0.35, 0, A.taxiwayZ, y), flat(A.runwayLength + 20, 0.35, 0, A.taxiwayNorthZ, y), flat(1600, 0.35, 0, A.hasLaneZ, y)];
    for (const lx of A.links) yellow.push(flat(0.35, linkZ1 - linkZ0 - 2, lx, (linkZ0 + linkZ1) / 2 + 1, y));
    for (const lx of A.linksNorth) yellow.push(flat(0.35, nZ1 - nZ0 - 2, lx, (nZ0 + nZ1) / 2 - 1, y));
    yellow.push(flat(0.35, -A.hasLaneZ + A.taxiwayNorthZ, 0, (A.taxiwayNorthZ + A.hasLaneZ) / 2, y));
    yellow.push(flat(ap.x1 - ap.x0 - 40, 0.35, 0, 300, y));
    for (const p of A.parking) { yellow.push(flat(0.35, 40, p.x, p.z + 10, y + 0.01)); yellow.push(flat(24, 0.35, p.x, p.z - 6, y + 0.01)); }
    for (const s of A.has) yellow.push(flat(0.35, 110, s.x, s.z + 55, y));
    base.add(new THREE.Mesh(this.track(mergeGeometries(yellow, false)), yellowMat));

    // Hangarlar
    const wallTex = this.track(makeHangarWallTexture(512)); wallTex.repeat.set(4, 1);
    const wallMat = this.track(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.0 }));
    const roofMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6f757b, roughness: 0.9, metalness: 0.0 }));
    const doorTex = this.track(makeHangarDoorTexture(512, 256));
    const doorMat = this.track(new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.8, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const plainMat = this.track(new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.9, metalness: 0.0 }));
    const hasMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8e8c84, roughness: 0.95, metalness: 0.0 }));
    const hangarGeos = [], roofGeos = [], doorGeos = [], plainGeos = [], hasGeos = [];
    for (const h of A.hangars) {
      const shape = new THREE.Shape();
      shape.moveTo(-h.w / 2, 0); shape.lineTo(h.w / 2, 0); shape.lineTo(h.w / 2, h.h);
      shape.absellipse(0, h.h, h.w / 2, h.arch, 0, Math.PI, false); shape.lineTo(-h.w / 2, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h.d, bevelEnabled: false, curveSegments: 12 });
      geo.translate(h.x, 0, h.z - h.d / 2);
      // Malzeme grupları: yan yüzler (duvar) ve uçlar. Basitlik için tümü duvar dokusu, çatı ayrı değil.
      hangarGeos.push(geo.index ? geo.toNonIndexed() : geo);
      const door = new THREE.PlaneGeometry(h.w * 0.82, h.h * 0.88);
      door.rotateY(Math.PI); door.translate(h.x, h.h * 0.44, h.z - h.d / 2 - 0.06);
      doorGeos.push(door);
    }
    // Güneşlikler (açık önlü): çatı + kolonlar
    for (const s of A.shelters) {
      const roof = new THREE.BoxGeometry(s.w, 0.6, s.d); roof.translate(s.x, s.h, s.z); roofGeos.push(roof);
      const back = new THREE.BoxGeometry(s.w, s.h, 0.5); back.translate(s.x, s.h / 2, s.z + s.d / 2); roofGeos.push(back);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const c = new THREE.CylinderGeometry(0.35, 0.35, s.h, 8); c.translate(s.x + sx * (s.w / 2 - 1), s.h / 2, s.z + sz * (s.d / 2 - 1)); roofGeos.push(c); }
    }
    // HAS: yarım silindir beton sığınaklar
    for (const s of A.has) {
      const g = new THREE.CylinderGeometry(s.w / 2, s.w / 2, s.d, 16, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2);
      g.scale(1, s.h / (s.w / 2), 1);
      g.translate(s.x, 0, s.z);
      hasGeos.push(g.index ? g.toNonIndexed() : g);
      const back = new THREE.BoxGeometry(s.w + 2, s.h, 2); back.translate(s.x, s.h / 2, s.z - s.d / 2); hasGeos.push(back);
    }
    // HQ binası (pencereli), kule, yakıt tankları, su kulesi, radar
    const winTex = this.track(makeWindowsTexture(512, 256, 14, 3));
    const hqMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const hqGeo = new THREE.BoxGeometry(A.hq.w, A.hq.h, A.hq.d);
    { const uv = hqGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i)); }
    hqGeo.translate(A.hq.x, A.hq.h / 2, A.hq.z);
    base.add(new THREE.Mesh(this.track(hqGeo), hqMat));
    const t = A.tower;
    const shaft = new THREE.CylinderGeometry(t.r, t.r * 1.4, t.h, 12); shaft.translate(t.x, t.h / 2, t.z); plainGeos.push(shaft);
    const cabBase = new THREE.CylinderGeometry(t.r * 2.0, t.r * 1.2, 2.5, 12); cabBase.translate(t.x, t.h + 1.25, t.z); plainGeos.push(cabBase);
    const glassMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1e2c3a, roughness: 0.35, metalness: 0.3 }));
    const cab = new THREE.Mesh(this.track(new THREE.CylinderGeometry(t.r * 2.0, t.r * 2.0, 3.8, 12)), glassMat); cab.position.set(t.x, t.h + 4.4, t.z); base.add(cab);
    const roofC = new THREE.ConeGeometry(t.r * 2.2, 1.8, 12); roofC.translate(t.x, t.h + 7.2, t.z); plainGeos.push(roofC);
    const ant = new THREE.CylinderGeometry(0.12, 0.12, 8, 6); ant.translate(t.x, t.h + 12, t.z); plainGeos.push(ant);
    const tankMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd9d9d2, roughness: 0.6, metalness: 0.1 }));
    const tankGeos = [];
    for (const f of A.fuel) { const g = new THREE.CylinderGeometry(f.r, f.r, f.h, 18); g.translate(f.x, f.h / 2, f.z); tankGeos.push(g); }
    // Su kulesi
    const wt = A.waterTower;
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { const leg = new THREE.CylinderGeometry(0.35, 0.45, 22, 6); leg.translate(wt.x + dx, 11, wt.z + dz); tankGeos.push(leg); }
    const tank = new THREE.CylinderGeometry(7, 5, 8, 16); tank.translate(wt.x, 26, wt.z); tankGeos.push(tank);
    const tankTop = new THREE.ConeGeometry(7, 2.5, 16); tankTop.translate(wt.x, 31.2, wt.z); tankGeos.push(tankTop);
    // Radar kubbesi
    const rd = A.radar;
    const rTower = new THREE.CylinderGeometry(3, 4, 12, 10); rTower.translate(rd.x, 6, rd.z); plainGeos.push(rTower);
    const dome = new THREE.SphereGeometry(6.5, 18, 12); dome.translate(rd.x, 17, rd.z); tankGeos.push(dome);
    // Rüzgar tulumu: direk sabit, tulum gerçek rüzgar yönüne döner (setWind ile güncellenir)
    const pole = new THREE.CylinderGeometry(0.12, 0.15, 8, 6); pole.translate(-1600, 4, 120); plainGeos.push(pole);
    const sockPivot = new THREE.Group();
    sockPivot.position.set(-1600, 7.8, 120);
    const sock = new THREE.ConeGeometry(0.6, 3.2, 8); sock.rotateZ(-Math.PI / 2); sock.translate(1.7, 0, 0);
    sockPivot.add(new THREE.Mesh(this.track(sock), this.track(new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.9, side: THREE.DoubleSide }))));
    base.add(sockPivot);
    this.windsock = sockPivot;
    // (Nizamiye buildBaseDetails içinde: nöbetçi kulübesi, sundurma, bariyerler)
    // Depolar (üs)
    for (const [x, z, w, d, h] of [[-1100, 620, 40, 20, 7], [-1160, 620, 40, 20, 7], [-1100, 660, 40, 20, 7], [1180, 420, 30, 18, 6], [1180, 470, 30, 18, 6]]) {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, h / 2, z); plainGeos.push(g);
      this.buildingBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: h });
    }
    const addMerged = (geos, mat, shadow = true) => {
      if (!geos.length) return;
      for (const g of geos) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
      const merged = this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false));
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = q.shadows && shadow; mesh.receiveShadow = q.shadows;
      base.add(mesh);
    };
    addMerged(hangarGeos, wallMat);
    addMerged(doorGeos, doorMat, false);
    addMerged(roofGeos, roofMat);
    addMerged(hasGeos, hasMat);
    addMerged(plainGeos, plainMat);
    addMerged(tankGeos, tankMat);

    // Işıklar (instanced, kendinden ışıklı)
    const lights = [];
    const push = (x, z, color, yy = 0.35) => lights.push({ x, z, color, y: yy });
    const cWhite = new THREE.Color(0xffffff), cGreen = new THREE.Color(0x30ff60), cRed = new THREE.Color(0xff3030), cBlue = new THREE.Color(0x3060ff), cAmber = new THREE.Color(0xffb020);
    for (let x = -L; x <= L; x += 60) { push(x, W / 2 + 1.5, cWhite); push(x, -W / 2 - 1.5, cWhite); }
    for (const side of [-1, 1]) {
      for (let z = -W / 2; z <= W / 2; z += 3) { push(side * (L + 1), z, cGreen); push(side * (L + 4), z, cRed); }
      for (let d = 30; d <= 900; d += 30) {
        push(side * (L + d), 0, cWhite);
        if (d % 150 === 0) for (const zz of [-6, -4, -2, 2, 4, 6]) push(side * (L + d), zz, cWhite);
      }
      for (let k = 0; k < 4; k++) push(side * (L - 300), -(W / 2 + 12 + k * 3), k < 2 ? cWhite : cRed);
    }
    for (const tz of [A.taxiwayZ, A.taxiwayNorthZ]) for (let x = -L + 20; x <= L - 20; x += 60) { push(x, tz + tw / 2 + 1, cBlue); push(x, tz - tw / 2 - 1, cBlue); }
    for (const lx of A.links) for (let z = 30; z < A.taxiwayZ - 10; z += 30) { push(lx + tw / 2 + 1, z, cBlue); push(lx - tw / 2 - 1, z, cBlue); }
    for (let x = ap.x0; x <= ap.x1; x += 90) push(x, ap.z1 + 3, cAmber);
    push(t.x, t.z, cRed, t.h + 15); push(wt.x, wt.z, cRed, 33); push(rd.x, rd.z, cRed, 24);
    const lightGeo = this.track(new THREE.SphereGeometry(0.28, 6, 4));
    const lightMat = this.track(new THREE.MeshBasicMaterial({ color: 0xbfbfbf }));
    const lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
    const m4 = new THREE.Matrix4();
    lights.forEach((l, i) => { m4.makeTranslation(l.x, l.y, l.z); lightMesh.setMatrixAt(i, m4); lightMesh.setColorAt(i, l.color); });
    lightMesh.instanceMatrix.needsUpdate = true; if (lightMesh.instanceColor) lightMesh.instanceColor.needsUpdate = true;
    lightMesh.frustumCulled = false;
    base.add(lightMesh);
    this.runwayLights = lightMesh;
    // Apron aydınlatma direkleri
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x777c80, roughness: 0.6, metalness: 0.3 }));
    const poles = [];
    for (const x of [ap.x0 + 30, -250, 250, ap.x1 - 30]) { const g = new THREE.CylinderGeometry(0.3, 0.4, 24, 6); g.translate(x, 12, ap.z1 - 12); poles.push(g); }
    base.add(new THREE.Mesh(this.track(mergeGeometries(poles, false)), poleMat));

    // Park halinde F-35'ler (statik, instanced)
    try {
      const parts = buildStaticAircraftGeometries();
      const spots = A.parking.filter((_, i) => i % 2 === 0);
      const shelterSpots = A.shelters.filter((_, i) => i % 2 === 1).map((s) => ({ x: s.x, z: s.z + 2 }));
      const all = [...spots, ...shelterSpots];
      const rnd = mulberry32(31);
      const mats = all.map((p) => { const m = new THREE.Matrix4(); const yaw = -Math.PI / 2 + Math.PI / 2 * 0 + (rnd() - 0.5) * 0.06; m.compose(new THREE.Vector3(p.x, 2.25, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + yaw + Math.PI / 2), new THREE.Vector3(1, 1, 1)); return m; });
      for (const part of parts) {
        this.track(part.geometry);
        const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = q.shadows && part.key !== 'canopy';
        im.computeBoundingSphere();
        if (part.key === 'canopy') im.renderOrder = 5;
        base.add(im);
      }
      for (const p of all) this.buildingBoxes.push({ minX: p.x - 6, maxX: p.x + 6, minZ: p.z - 8, maxZ: p.z + 8, minY: 0, maxY: 4.5 });
      this.parkedCount = mats.length;
    } catch (e) {
      console.warn('Park halindeki uçaklar oluşturulamadı', e);
    }

    // Araçlar (basit kutular)
    const carGeo = this.track(new THREE.BoxGeometry(4.4, 1.5, 1.9));
    carGeo.translate(0, 0.75, 0);
    const carMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 }));
    const carPos = [];
    const rndc = mulberry32(88);
    for (let i = 0; i < 24; i++) carPos.push({ x: 900 + (i % 12) * 6, z: 470 + Math.floor(i / 12) * 8, r: 0 });
    for (let i = 0; i < 10; i++) carPos.push({ x: -1140 + i * 7, z: 700, r: 0 });
    for (let i = 0; i < 40; i++) carPos.push({ x: TOWN.x + (rndc() - 0.5) * 1800, z: TOWN.z + (rndc() - 0.5) * 1600, r: rndc() * Math.PI });
    const cars = new THREE.InstancedMesh(carGeo, carMat, carPos.length);
    const cc = new THREE.Color();
    carPos.forEach((c, i) => {
      const yy = terrainHeight(c.x, c.z);
      m4.compose(new THREE.Vector3(c.x, yy + 0.1, c.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r), new THREE.Vector3(1, 1, 1));
      cars.setMatrixAt(i, m4);
      cc.setHSL(rndc(), 0.4, 0.35 + rndc() * 0.4); cars.setColorAt(i, cc);
    });
    cars.instanceMatrix.needsUpdate = true; if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
    base.add(cars);
    this.group.add(base);
  }

  // ---- Üs detayları: çevre çiti, kapılar, çevre yolu, servis binaları, yakıt sahası, araçlar, ekipman, bitki örtüsü ----
  buildBaseDetails() {
    const q = this.quality;
    const A = AIRBASE;
    const grp = new THREE.Group();
    grp.name = 'base-details';
    const rand = mulberry32(5150);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qu = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1);
    const yAxis = new THREE.Vector3(0, 1, 0);
    const addBox = (cx, cz, w, d, h) => this.buildingBoxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: 0, maxY: h });
    const colorize = (g, color) => { const n = g.attributes.position.count; const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; } g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g; };
    const ni = (g) => (g.index ? g.toNonIndexed() : g);

    // --- Çevre çiti: dikdörtgen (kapı boşlukları hariç)
    const F = { x0: -2080, x1: 2080, z0: -820, z1: A.gateZ };
    const gates = [{ x: 0, w: 30, side: 's' }, { x: -1200, w: 16, side: 's' }];
    const postGeo = this.track(new THREE.BoxGeometry(0.12, 2.7, 0.12)); postGeo.translate(0, 1.35, 0);
    const postMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.7, metalness: 0.4 }));
    const posts = [];
    const segs = [
      { a: [F.x0, F.z0], b: [F.x1, F.z0] }, { a: [F.x1, F.z0], b: [F.x1, F.z1] },
      { a: [F.x1, F.z1], b: [F.x0, F.z1], gate: true }, { a: [F.x0, F.z1], b: [F.x0, F.z0] },
    ];
    const chainTex = this.track(makeChainLinkTexture(64)); chainTex.anisotropy = q.anisotropy;
    const barbTex = this.track(makeBarbedWireTexture(128, 32));
    const chainMat = this.track(new THREE.MeshStandardMaterial({ map: chainTex, transparent: true, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5, depthWrite: true }));
    const barbMat = this.track(new THREE.MeshStandardMaterial({ map: barbTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.6 }));
    const chainGeos = [], barbGeos = [];
    const inGate = (x, z) => gates.some((g) => Math.abs(z - A.gateZ) < 1 && Math.abs(x - g.x) < g.w / 2);
    for (const sg of segs) {
      const len = Math.hypot(sg.b[0] - sg.a[0], sg.b[1] - sg.a[1]);
      const dx = (sg.b[0] - sg.a[0]) / len, dz = (sg.b[1] - sg.a[1]) / len;
      for (let t = 0; t <= len; t += 4) {
        const x = sg.a[0] + dx * t, z = sg.a[1] + dz * t;
        if (inGate(x, z)) continue;
        posts.push([x, z]);
      }
      // Tel örgü şeridi: kapı boşluklarıyla parçalara böl
      const pieces = [];
      if (sg.gate) {
        // güney çizgisi: x1 -> x0 yönünde; kapılar x konumunda
        let cursor = 0;
        const cuts = gates.map((g) => ({ s: (sg.a[0] - (g.x + g.w / 2)) / (sg.a[0] - sg.b[0]) * len, e: (sg.a[0] - (g.x - g.w / 2)) / (sg.a[0] - sg.b[0]) * len })).sort((u, v) => u.s - v.s);
        for (const c of cuts) { pieces.push([cursor, c.s]); cursor = c.e; }
        pieces.push([cursor, len]);
      } else pieces.push([0, len]);
      for (const [t0, t1] of pieces) {
        if (t1 - t0 < 2) continue;
        const L = t1 - t0;
        const mk = (h, y0, tex) => {
          const g = new THREE.PlaneGeometry(L, h);
          const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (L / (tex === 'barb' ? 4 : 1)), uv.getY(i) * (tex === 'barb' ? 1 : h));
          g.rotateY(Math.atan2(dx, dz) + Math.PI / 2);
          g.translate(sg.a[0] + dx * (t0 + L / 2), y0 + h / 2, sg.a[1] + dz * (t0 + L / 2));
          return g;
        };
        chainGeos.push(mk(2.4, 0.05, 'chain'));
        barbGeos.push(mk(0.45, 2.45, 'barb'));
      }
    }
    const postMesh = new THREE.InstancedMesh(postGeo, postMat, posts.length);
    posts.forEach(([x, z], i) => { m4.makeTranslation(x, terrainHeight(x, z), z); postMesh.setMatrixAt(i, m4); });
    postMesh.instanceMatrix.needsUpdate = true; postMesh.computeBoundingSphere();
    grp.add(postMesh);
    const chainMesh = new THREE.Mesh(this.track(mergeGeometries(chainGeos, false)), chainMat);
    const barbMesh = new THREE.Mesh(this.track(mergeGeometries(barbGeos, false)), barbMat);
    grp.add(chainMesh, barbMesh);
    this.fenceMeshes = [chainMesh, barbMesh, postMesh];

    // --- Kapılar: nöbet kulübesi, bariyer kolları, beton bariyerler
    const plain = this.track(new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.9 }));
    const redWhite = this.track(new THREE.MeshStandardMaterial({ color: 0xff3b30, roughness: 0.6 }));
    const white = this.track(new THREE.MeshStandardMaterial({ color: 0xf2f2ee, roughness: 0.6 }));
    const concrete = this.track(new THREE.MeshStandardMaterial({ color: 0x9a9a94, roughness: 0.95 }));
    const plainGeos = [], redGeos = [], whiteGeos = [], concGeos = [], gateSigns = [];
    for (const g of gates) {
      const gh = new THREE.BoxGeometry(6, 3.2, 4); gh.translate(g.x + g.w / 2 + 5, 1.6, A.gateZ - 2); plainGeos.push(ni(gh));
      const roof = new THREE.BoxGeometry(7, 0.3, 5); roof.translate(g.x + g.w / 2 + 5, 3.35, A.gateZ - 2); concGeos.push(ni(roof));
      addBox(g.x + g.w / 2 + 5, A.gateZ - 2, 6, 4, 3.5);
      // Bariyer kolları (kırmızı-beyaz): iki yön
      for (const side of [-1, 1]) {
        const arm = new THREE.BoxGeometry(g.w / 2 - 1, 0.12, 0.12); arm.translate(g.x + side * (g.w / 4), 1.1, A.gateZ + side * 4); redGeos.push(ni(arm));
        const arm2 = new THREE.BoxGeometry(g.w / 2 - 1, 0.13, 0.13); arm2.translate(g.x + side * (g.w / 4), 1.1, A.gateZ + side * 4 + 0.001);
        // beyaz bantlar: ince kutular
        for (let k = 0; k < 4; k++) { const b = new THREE.BoxGeometry(0.6, 0.14, 0.14); b.translate(g.x + side * (g.w / 4) - (g.w / 4 - 1) + k * ((g.w / 2 - 1) / 4) + 0.3, 1.1, A.gateZ + side * 4); whiteGeos.push(ni(b)); }
        const pole = new THREE.CylinderGeometry(0.18, 0.18, 1.2, 8); pole.translate(g.x + side * (g.w / 2 - 0.6), 0.6, A.gateZ + side * 4); plainGeos.push(ni(pole));
      }
      // Ana kapı: yol üstü sundurma (kolonlu), tabela
      if (g.w >= 24) {
        const slab = new THREE.BoxGeometry(g.w + 8, 0.5, 9); slab.translate(g.x, 6.0, A.gateZ); concGeos.push(ni(slab));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const col = new THREE.CylinderGeometry(0.28, 0.28, 5.8, 8); col.translate(g.x + sx * (g.w / 2 + 3), 2.9, A.gateZ + sz * 3.6); plainGeos.push(ni(col)); }
        const sign = new THREE.BoxGeometry(10, 1.3, 0.25); sign.translate(g.x, 6.95, A.gateZ + 4.4); gateSigns.push(sign);
      }
      // Beton bariyerler (jersey): şaşırtmalı
      for (let k = 0; k < 6; k++) {
        const b = new THREE.BoxGeometry(3.2, 0.9, 0.7);
        const x = g.x + (k % 2 ? 1 : -1) * (g.w / 2 - 3.5), z = A.gateZ + 14 + k * 9;
        b.translate(x, 0.45, z); concGeos.push(ni(b));
      }
    }
    // --- Çevre yolu (çit içinde) ve servis yolları
    const roadTex = this.track(makeRoadTexture(128, 256)); roadTex.anisotropy = q.anisotropy;
    const roadMat = this.track(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    const inset = 14;
    const perim = [[F.x0 + inset, F.z1 - inset], [F.x0 + inset, F.z0 + inset], [F.x1 - inset, F.z0 + inset], [F.x1 - inset, F.z1 - inset], [F.x0 + inset, F.z1 - inset]];
    const perimGeo = this.roadGeometry(perim, 6, 0.31);
    const roadGeos = [];
    const serviceRoads = [
      [[0, A.gateZ + 60], [0, A.gateZ - 40], [0, 800]],                       // ana giriş -> hangar yolu
      [[-1200, A.gateZ + 30], [-1200, 900], [-1120, 760], [-1060, 700]],      // batı kapısı -> depolar
      [[A.hq.x, 560], [A.hq.x, 470]],                                          // HQ
      [[-1400, 640], [-1400, 214]],                                            // yakıt sahası -> taksi yolu kenarı (taksi yolunu kesmez)
      [[-900, -560], [900, -560]],                                             // HAS arka yolu
      [[-1700, -300], [-1700, -700], [-1300, -700]],                           // mühimmat sahası
    ];
    for (const r of serviceRoads) roadGeos.push(this.roadGeometry(r, 6, 0.28));
    grp.add(new THREE.Mesh(this.track(mergeGeometries(roadGeos.map(ni), false)), roadMat));
    // Çevre yolu ayrı katman (üstte): servis yollarıyla kavşaklarda derinlik yarışı olmaz
    const perimMat = this.track(new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -7 }));
    grp.add(new THREE.Mesh(this.track(ni(perimGeo)), perimMat));
    roadGeos.forEach((g) => g.dispose());

    // --- Servis binaları: bakım atölyeleri, filo binası, kışla/yemekhane, jeneratör binası
    const winTex = this.track(makeWindowsTexture(512, 256, 12, 2));
    const winMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const winGeos = [];
    const building = (x, z, w, d, h, rot = 0, mat = 'win') => {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(w / 12)), uv.getY(i) * Math.max(1, Math.round(h / 7)));
      g.rotateY(rot); g.translate(x, h / 2, z);
      (mat === 'win' ? winGeos : plainGeos).push(ni(g));
      addBox(x, z, Math.abs(Math.cos(rot)) * w + Math.abs(Math.sin(rot)) * d, Math.abs(Math.sin(rot)) * w + Math.abs(Math.cos(rot)) * d, h);
      const roof = new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6); roof.rotateY(rot); roof.translate(x, h + 0.2, z); concGeos.push(ni(roof));
    };
    building(-820, 800 + 60, 34, 14, 7, 0, 'plain');   // atölye 1
    building(-780, 900, 34, 14, 7, 0, 'plain');        // atölye 2
    building(700, 640, 44, 16, 8);                     // filo operasyon
    building(-300, 940, 70, 18, 9);                    // kışla
    building(-400, 990, 30, 14, 5, 0, 'plain');        // yemekhane
    building(300, 960, 26, 12, 6, 0, 'plain');         // jeneratör/enerji
    building(1500, 860, 40, 18, 6, 0, 'plain');        // depo
    building(1600, 700, 24, 12, 5, 0, 'plain');        // araç bakım
    // Bakım atölyesi kapıları (koyu dikdörtgenler)
    const doorMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3b4046, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const doorGeos = [];
    for (const [x, z] of [[-820, 853], [-780, 893]]) { const d = new THREE.PlaneGeometry(8, 5); d.translate(x, 2.5, z + 0.01); doorGeos.push(d); }
    grp.add(new THREE.Mesh(this.track(mergeGeometries([...doorGeos, ...gateSigns], false)), doorMat));

    // --- Yakıt sahası: set duvarı, pompa adası, borular
    const fuelC = [-992, 395];
    for (const [w, d, x, z] of [[130, 1.2, fuelC[0], fuelC[1] - 55], [130, 1.2, fuelC[0], fuelC[1] + 55], [1.2, 110, fuelC[0] - 65, fuelC[1]], [1.2, 110, fuelC[0] + 65, fuelC[1]]]) {
      const g = new THREE.BoxGeometry(w, 1.3, d); g.translate(x, 0.65, z); concGeos.push(ni(g));
    }
    for (let k = 0; k < 3; k++) { const pump = new THREE.BoxGeometry(1.2, 1.8, 0.8); pump.translate(-950 + k * 6, 0.9, 445); plainGeos.push(ni(pump)); }
    const pipeMat = this.track(new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.5, metalness: 0.7 }));
    const pipes = [];
    for (const f of A.fuel) { const pipe = new THREE.CylinderGeometry(0.18, 0.18, 26, 8); pipe.rotateZ(Math.PI / 2); pipe.translate(f.x + 13, 0.7, f.z); pipes.push(ni(pipe)); }
    const mainPipe = new THREE.CylinderGeometry(0.22, 0.22, 60, 8); mainPipe.rotateX(Math.PI / 2); mainPipe.translate(-960, 0.6, 420); pipes.push(ni(mainPipe));
    grp.add(new THREE.Mesh(this.track(mergeGeometries(pipes, false)), pipeMat));

    // --- Mühimmat depolama: toprak örtülü iglolar + set
    const dirtMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6f7a4a, roughness: 1 }));
    const dirtGeos = [];
    for (let k = 0; k < 5; k++) {
      const x = -1750 + k * 90, z = -700;
      const ig = new THREE.CylinderGeometry(9, 9, 22, 12, 1, false, 0, Math.PI); ig.rotateZ(Math.PI / 2); ig.rotateY(Math.PI / 2); ig.scale(1, 0.6, 1); ig.translate(x, 0, z);
      dirtGeos.push(ni(ig));
      const face = new THREE.BoxGeometry(12, 4, 1.2); face.translate(x, 2, z + 11); concGeos.push(ni(face));
      const door = new THREE.PlaneGeometry(4, 3.2); door.translate(x, 1.6, z + 11.62); doorGeos.push(door);
      addBox(x, z, 20, 24, 6);
    }
    // Toprak set: yamaçlı tümsek (kesit yamuk), çimenli toprak rengi
    const bermShape = new THREE.Shape([new THREE.Vector2(-9, -0.4), new THREE.Vector2(-1.6, 3.2), new THREE.Vector2(1.6, 3.2), new THREE.Vector2(9, -0.4)]);
    const berm = new THREE.ExtrudeGeometry(bermShape, { depth: 520, bevelEnabled: false });
    berm.rotateY(Math.PI / 2); berm.translate(-1820, 0, -760);
    const bermMat = this.track(new THREE.MeshStandardMaterial({ color: 0x7c8a52, roughness: 1 }));
    grp.add(new THREE.Mesh(this.track(ni(berm)), bermMat));
    grp.add(new THREE.Mesh(this.track(mergeGeometries(dirtGeos, false)), dirtMat));

    // --- Pist ucu jet sapıtıcıları, taksi yolu levhaları, tutuş çizgileri
    const deflMat = this.track(new THREE.MeshStandardMaterial({ color: 0x777c82, roughness: 0.6, metalness: 0.5 }));
    const deflGeos = [];
    for (const side of [-1, 1]) { const dfl = new THREE.BoxGeometry(60, 4, 0.6); dfl.rotateX(-side * 0.5); dfl.translate(side * (A.runwayLength / 2 + 95), 1.6, 0); deflGeos.push(ni(dfl)); }
    grp.add(new THREE.Mesh(this.track(mergeGeometries(deflGeos, false)), deflMat));
    const signMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe8c22a, roughness: 0.7 }));
    const signGeos = [];
    for (const lx of A.links) for (const z of [A.taxiwayZ - 20, 32]) { const sg = new THREE.BoxGeometry(1.4, 0.7, 0.2); sg.translate(lx + 16, 0.5, z); signGeos.push(ni(sg)); }
    for (const lx of A.linksNorth) { const sg = new THREE.BoxGeometry(1.4, 0.7, 0.2); sg.translate(lx + 16, 0.5, -32); signGeos.push(ni(sg)); }
    grp.add(new THREE.Mesh(this.track(mergeGeometries(signGeos, false)), signMat));
    const holdMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8b52a, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -7 }));
    const holdGeos = [];
    const flatY = (w, d, x, z) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, 0.1, z); return g; };
    for (const lx of A.links) { holdGeos.push(flatY(A.taxiwayWidth, 0.3, lx, 40)); holdGeos.push(flatY(A.taxiwayWidth, 0.3, lx, 41.2)); }
    for (const lx of A.linksNorth) { holdGeos.push(flatY(A.taxiwayWidth, 0.3, lx, -40)); holdGeos.push(flatY(A.taxiwayWidth, 0.3, lx, -41.2)); }
    grp.add(new THREE.Mesh(this.track(mergeGeometries(holdGeos, false)), holdMat));

    // --- Araçlar ve ekipman (instanced, vertex renkli basit gövdeler)
    const olive = new THREE.Color(0.36, 0.40, 0.28), tan = new THREE.Color(0.66, 0.60, 0.45), red = new THREE.Color(0.75, 0.12, 0.10), yellow = new THREE.Color(0.85, 0.75, 0.2), grey = new THREE.Color(0.55, 0.57, 0.6), black = new THREE.Color(0.08, 0.08, 0.08);
    const vehMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15 }));
    const wheelSet = (positions, r, w) => positions.map(([x, y, z]) => { const wg = new THREE.CylinderGeometry(r, r, w, 8); wg.rotateZ(Math.PI / 2); wg.translate(x, y, z); return colorize(ni(wg), black); });
    const mkVehicle = (parts) => {
      const gs = parts.map(([g, c]) => colorize(ni(g), c));
      for (const g of gs) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      return this.track(mergeGeometries(gs, false));
    };
    // Hafif taktik araç
    const humvee = mkVehicle([
      [new THREE.BoxGeometry(4.6, 0.9, 2.2).translate(0, 1.0, 0), tan],
      [new THREE.BoxGeometry(2.6, 0.8, 2.1).translate(-0.3, 1.85, 0), tan],
      ...wheelSet([[1.5, 0.45, 1.0], [1.5, 0.45, -1.0], [-1.5, 0.45, 1.0], [-1.5, 0.45, -1.0]], 0.45, 0.35).map((g) => [g, black]),
    ]);
    // Kamyon
    const truck = mkVehicle([
      [new THREE.BoxGeometry(2.2, 2.0, 2.4).translate(2.6, 1.9, 0), olive],
      [new THREE.BoxGeometry(5.0, 2.2, 2.4).translate(-1.2, 2.0, 0), olive],
      [new THREE.BoxGeometry(7.6, 0.5, 2.3).translate(0.4, 0.95, 0), black],
      ...wheelSet([[2.6, 0.55, 1.15], [2.6, 0.55, -1.15], [-1.4, 0.55, 1.15], [-1.4, 0.55, -1.15], [-2.8, 0.55, 1.15], [-2.8, 0.55, -1.15]], 0.55, 0.4).map((g) => [g, black]),
    ]);
    // Yakıt tankeri
    const tanker = mkVehicle([
      [new THREE.BoxGeometry(2.2, 2.0, 2.4).translate(2.8, 1.9, 0), olive],
      [new THREE.CylinderGeometry(1.15, 1.15, 5.6, 14).rotateZ(Math.PI / 2).translate(-1.0, 2.1, 0), yellow],
      [new THREE.BoxGeometry(8.0, 0.5, 2.3).translate(0.4, 0.95, 0), black],
      ...wheelSet([[2.8, 0.55, 1.15], [2.8, 0.55, -1.15], [-1.6, 0.55, 1.15], [-1.6, 0.55, -1.15], [-3.0, 0.55, 1.15], [-3.0, 0.55, -1.15]], 0.55, 0.4).map((g) => [g, black]),
    ]);
    // İtfaiye
    const fire = mkVehicle([
      [new THREE.BoxGeometry(2.4, 2.2, 2.5).translate(2.8, 2.0, 0), red],
      [new THREE.BoxGeometry(5.4, 2.4, 2.5).translate(-1.2, 2.1, 0), red],
      [new THREE.BoxGeometry(8.4, 0.5, 2.3).translate(0.4, 0.95, 0), black],
      [new THREE.CylinderGeometry(0.12, 0.12, 1.6, 6).rotateX(Math.PI / 2).translate(2.2, 3.5, 0), grey],
      ...wheelSet([[2.8, 0.6, 1.2], [2.8, 0.6, -1.2], [-1.6, 0.6, 1.2], [-1.6, 0.6, -1.2], [-3.2, 0.6, 1.2], [-3.2, 0.6, -1.2]], 0.6, 0.45).map((g) => [g, black]),
    ]);
    // Yer güç ünitesi / çekici
    const gpu = mkVehicle([
      [new THREE.BoxGeometry(2.4, 1.2, 1.4).translate(0, 0.95, 0), yellow],
      ...wheelSet([[0.8, 0.35, 0.75], [0.8, 0.35, -0.75], [-0.8, 0.35, 0.75], [-0.8, 0.35, -0.75]], 0.35, 0.25).map((g) => [g, black]),
    ]);
    // Konteyner
    const container = mkVehicle([[new THREE.BoxGeometry(12, 2.6, 2.4).translate(0, 1.3, 0), olive]]);
    const containerTan = mkVehicle([[new THREE.BoxGeometry(6, 2.6, 2.4).translate(0, 1.3, 0), tan]]);
    const place = (geo, list) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, vehMat, list.length);
      list.forEach(([x, z, rot], i) => { p.set(x, terrainHeight(x, z) + 0.05, z); qu.setFromAxisAngle(yAxis, rot); m4.compose(p, qu, sc); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = q.shadows && q.shadowMap >= 2048;
      grp.add(im);
    };
    const humvees = [], trucks = [], tankers = [], fires = [], gpus = [], containers = [], containersTan = [];
    for (let i = 0; i < 6; i++) humvees.push([A.hq.x - 60 + i * 7, 480, 0]);
    for (let i = 0; i < 3; i++) humvees.push([-1250 + i * 8, 880, Math.PI / 2]);
    humvees.push([30, A.gateZ - 30, 0.2], [-1215, A.gateZ - 28, 1.4]);
    for (let i = 0; i < 4; i++) trucks.push([1470 + i * 10, 900, Math.PI / 2]);
    trucks.push([-1140, 740, 0], [-700, 640, 0.1], [700, 720, -0.05]);
    tankers.push([-1060, 445, Math.PI / 2], [-1030, 470, Math.PI / 2], [-560, 300, 0]);
    fires.push([1080, 300, 0], [1080, 310, 0]);
    for (const spot of A.parking) if (spot.x % 160 === 40 || spot.x % 160 === -120) gpus.push([spot.x + 14, spot.z + 18, 0.3 * (rand() - 0.5)]);
    for (const s2 of A.shelters) gpus.push([s2.x + s2.w / 2 + 4, s2.z, Math.PI / 2]);
    for (let i = 0; i < 8; i++) containers.push([1520 + (i % 4) * 13.5, 800 + Math.floor(i / 4) * 4, 0]);
    for (let i = 0; i < 6; i++) containersTan.push([-1160 + (i % 3) * 7, 560 + Math.floor(i / 3) * 4, 0]);
    for (let i = 0; i < 4; i++) containers.push([-620 + i * 13.5, 780, 0]);
    place(humvee, humvees); place(truck, trucks); place(tanker, tankers); place(fire, fires); place(gpu, gpus); place(container, containers); place(containerTan, containersTan);

    // --- Otoparklar (asfalt) ve aydınlatma direkleri
    const asph = this.track(new THREE.MeshStandardMaterial({ color: 0x3a3c3f, roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    const lotGeos = [];
    for (const [x, z, w, d] of [[A.hq.x - 40, 484, 70, 24], [-1250, 885, 40, 22], [1480, 905, 60, 20], [-300, 1000 + 8, 60, 16]]) lotGeos.push(flatY(w, d, x, z));
    grp.add(new THREE.Mesh(this.track(mergeGeometries(lotGeos, false)), asph));
    const lotMarkMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -7 }));
    const lotMarkGeos = [];
    for (const [x, z, w, d] of [[A.hq.x - 40, 484, 70, 24], [-1250, 885, 40, 22], [1480, 905, 60, 20], [-300, 1000 + 8, 60, 16]]) {
      for (let sx = -w / 2 + 2; sx <= w / 2 - 2; sx += 2.7) { lotMarkGeos.push(flatY(0.12, d * 0.42, x + sx, z - d * 0.27)); lotMarkGeos.push(flatY(0.12, d * 0.42, x + sx, z + d * 0.27)); }
    }
    grp.add(new THREE.Mesh(this.track(mergeGeometries(lotMarkGeos, false)), lotMarkMat));
    const poleGeo = this.track(new THREE.CylinderGeometry(0.15, 0.2, 9, 6)); poleGeo.translate(0, 4.5, 0);
    const poleList = [];
    for (let x = -1900; x <= 1900; x += 200) poleList.push([x, A.gateZ - 26]);
    for (let z = -700; z <= 900; z += 200) { poleList.push([F.x0 + 26, z]); poleList.push([F.x1 - 26, z]); }
    for (let x = -600; x <= 600; x += 150) poleList.push([x, 780]);
    const poleMesh = new THREE.InstancedMesh(poleGeo, postMat, poleList.length);
    poleList.forEach(([x, z], i) => { m4.makeTranslation(x, terrainHeight(x, z), z); poleMesh.setMatrixAt(i, m4); });
    poleMesh.instanceMatrix.needsUpdate = true; poleMesh.computeBoundingSphere();
    grp.add(poleMesh);

    // --- Bitki örtüsü: çevre yolu boyunca ağaç sıraları, binalar çevresinde ağaçlar ve çalılar
    if (this.treeAssets) {
      const { leafyGeo, coniferGeo, mat } = this.treeAssets;
      const leafy = [], conif = [];
      for (let x = -1950; x <= 1950; x += 38) { leafy.push([x, A.gateZ - 40, rand() * 6.28, 0.7 + rand() * 0.4]); }
      for (let z = -700; z <= 950; z += 42) { conif.push([F.x0 + 40, z, rand() * 6.28, 0.8 + rand() * 0.5]); conif.push([F.x1 - 40, z, rand() * 6.28, 0.8 + rand() * 0.5]); }
      for (const [bx, bz, n] of [[-300, 960, 14], [700, 600, 10], [A.hq.x, 450, 12], [-820, 780, 6], [1500, 830, 8]]) {
        for (let k = 0; k < n; k++) leafy.push([bx + (rand() - 0.5) * 90, bz + (rand() - 0.5) * 70, rand() * 6.28, 0.6 + rand() * 0.5]);
      }
      const treeIm = (geo, list) => {
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        list.forEach(([x, z, rot, s2], i) => { p.set(x, terrainHeight(x, z) - 0.2, z); qu.setFromAxisAngle(yAxis, rot); sc.set(s2, s2, s2); m4.compose(p, qu, sc); im.setMatrixAt(i, m4); });
        sc.set(1, 1, 1);
        im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.layers.set(LAYER_TREES);
        grp.add(im);
      };
      treeIm(leafyGeo, leafy); treeIm(coniferGeo, conif);
      const bushGeo = this.track(new THREE.IcosahedronGeometry(1.1, 1)); bushGeo.translate(0, 0.8, 0);
      const bushMat = this.track(new THREE.MeshStandardMaterial({ color: 0x3f6b2e, roughness: 0.95 }));
      const bushes = [];
      for (const [bx, bz, n, r] of [[-300, 940, 30, 60], [700, 640, 18, 40], [A.hq.x, 420, 24, 50], [0, A.gateZ - 15, 24, 40], [-1200, A.gateZ - 12, 12, 20], [-400, 990, 12, 30]]) {
        for (let k = 0; k < n; k++) bushes.push([bx + (rand() - 0.5) * r * 2, bz + (rand() - 0.5) * r, 0.6 + rand() * 0.8]);
      }
      const bim = new THREE.InstancedMesh(bushGeo, bushMat, bushes.length);
      bushes.forEach(([x, z, s2], i) => { p.set(x, terrainHeight(x, z), z); sc.set(s2, s2 * 0.8, s2); qu.identity(); m4.compose(p, qu, sc); bim.setMatrixAt(i, m4); });
      sc.set(1, 1, 1);
      bim.instanceMatrix.needsUpdate = true; bim.computeBoundingSphere();
      grp.add(bim);
    }

    // Birleştirilmiş sabit geometriler
    const addMerged = (geos, mat) => { if (!geos.length) return; for (const g of geos) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); const mm = new THREE.Mesh(this.track(mergeGeometries(geos, false)), mat); mm.castShadow = q.shadows; mm.receiveShadow = q.shadows; grp.add(mm); };
    addMerged(plainGeos, plain); addMerged(redGeos, redWhite); addMerged(whiteGeos, white); addMerged(concGeos, concrete); addMerged(winGeos, winMat);
    this.group.add(grp);
  }

  heightAt(x, z) { return terrainHeight(x, z); }

  hitsBuilding(x, y, z, r = 3) {
    for (const b of this.buildingBoxes) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y - r < b.maxY && y + r > b.minY) return true;
    }
    if (this.townCenter && Math.hypot(x - this.townCenter.x, z - this.townCenter.z) < TOWN.r + 200 && y < 60) {
      for (const b of this.townBoxes) {
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y - r < b.maxY && y + r > b.minY) return true;
      }
    }
    return false;
  }

  // Rüzgar tulumunu gerçek rüzgar vektörüne çevirir: tulum rüzgarın gittiği yönü gösterir,
  // dolgunluğu (yatay durması) hızla artar.
  setWind(vec, kt) {
    const sock = this.windsock;
    if (!sock) return;
    const sp = Math.hypot(vec.x, vec.z);
    if (sp > 0.05) sock.rotation.y = Math.atan2(vec.x, vec.z) - Math.PI / 2;
    const fill = Math.min(1, (kt || sp * 1.944) / 15);
    sock.rotation.z = -(1 - fill) * 0.85;      // zayıf rüzgarda aşağı sarkar
    sock.scale.set(1, 0.55 + 0.45 * fill, 0.55 + 0.45 * fill);
  }

  update(dt, camera, aircraftPos) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    // Gölge kamerası: hedefi ışık uzayında doku hücresi (texel) ızgarasına yuvarla -> düz yüzeylerde gölge "yüzmesi" olmaz
    const target = this._shadowTarget || (this._shadowTarget = new THREE.Vector3());
    target.copy(aircraftPos);
    if (this.sun.castShadow) {
      const cam = this.sun.shadow.camera;
      const texel = (cam.right - cam.left) / this.sun.shadow.mapSize.width;
      const m = this._lightBasis || (this._lightBasis = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0)));
      const inv = this._lightBasisInv || (this._lightBasisInv = m.clone().invert());
      target.applyMatrix4(inv);
      target.x = Math.round(target.x / texel) * texel;
      target.y = Math.round(target.y / texel) * texel;
      target.applyMatrix4(m);
    }
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 600);
    this.sun.target.updateMatrixWorld();
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    // Tüm mesafe eşiklerinde histerezis: eşik üzerinde duran kamerada kare kare açılıp kapanma (titreme) olmaz.
    // Görünürse eşik + bant'a kadar açık kalır, gizliyse ancak eşik - bant'ta açılır.
    const band = (visible, x, t, b) => (visible ? x < t + b : x < t - b);
    // Ağaç parçaları
    const td = this.quality.treeDistance;
    for (const c of this.treeChunks) {
      const d = Math.hypot(c.center.x - cx, c.center.z - cz) - c.radius;
      c.mesh.visible = band(c.mesh.visible, d, td, 250);
    }
    // Arazi LOD (histerezisli: sınırda ileri geri geçiş yok)
    const [l1] = this.quality.lod;
    const half = (this.terrainChunkSize || MAP_SIZE / 18) * 0.71;   // parça yarı köşegeni
    const lodBand = l1 * 0.07;
    for (const ch of this.terrainChunks) {
      const d = Math.max(0, Math.hypot(ch.center.x - cx, ch.center.z - cz) - half);
      const lod = ch.lod === 0 ? (d > l1 + lodBand ? 1 : 0) : (d < l1 - lodBand ? 0 : 1);
      if (lod !== ch.lod) { ch.meshes[ch.lod].visible = false; ch.meshes[lod].visible = true; ch.lod = lod; }
    }
    this.waterUniforms.time.value = this.time;
    // Üs ışıkları ve tel örgü: uzakta piksel altı kalıp parıldadıkları için 3B mesafeye göre kapatılır
    const baseDist = Math.hypot(cx, cy, cz);
    if (this.runwayLights) this.runwayLights.visible = band(this.runwayLights.visible, baseDist, 4500, 300);
    if (this.fenceMeshes) { const v = band(this.fenceMeshes[0].visible, baseDist, 2600, 200); for (const m of this.fenceMeshes) m.visible = v; }
    if (this.civilLights) {
      const d = Math.hypot(cx - this.civilCenter.x, cy - this.civilCenter.y, cz - this.civilCenter.z);
      this.civilLights.visible = band(this.civilLights.visible, d, 4500, 300);
    }
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.scene.remove(this.group);
  }
}

// Birden çok geometriyi tek ağa birleştirip gruba ekler (uv eksikse tamamlar)
function addM2(geos, mat, group, q) {
  if (!geos.length) return;
  for (const gg of geos) if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
  const mesh = new THREE.Mesh(mergeGeometries(geos.map((x2) => (x2.index ? x2.toNonIndexed() : x2)), false), mat);
  mesh.castShadow = q.shadows; mesh.receiveShadow = q.shadows;
  group.add(mesh);
  return mesh;
}

function distToPolylineAny(x, z) {
  let d = Infinity;
  for (const r of ROADS) { const dd = distToPolyline(x, z, r.pts); if (dd < d) d = dd; }
  for (const r of TOWN_STREETS) { const dd = distToPolyline(x, z, r.pts); if (dd < d) d = dd; }
  return d;
}
