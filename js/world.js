// Dünya: 40 km arazi (LOD'lu parçalar), gökyüzü, güneş, su, ormanlar, nehir, yollar, kasaba, bulutlar ve hava üssü.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex2D, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import {
  makeAsphaltTexture, makeConcreteTexture, makeWaterNormalTexture,
  makeHangarWallTexture, makeHangarDoorTexture, makeTextTexture, makeCloudTexture, makeRoadTexture, makeWindowsTexture,
  makeChainLinkTexture, makeBarbedWireTexture, makeOliveTexture, makeFacadeTexture, makeTerrainDetailTexture,
  makeRoadAtlasTexture, makeHouseAtlasTexture, makePavementTexture, makeCladdingTexture, makeTowerGlassTexture, makeShelterDoorTexture,
} from './textures.js';
import { HAZE_UNIFORMS, HAZE_PARS_FS, SKY_GLSL, hazeAll, createTerrainMaterial, WATER_OPTICS, WATER_OPTICS_GLSL } from './worldshade.js';
import { buildStaticAircraftGeometries } from './aircraft.js';
import { City, makeZoning, ZONE } from './city.js';
import { Waterfront, waterfrontHeight, wfReserved, wfPaved, wfPlan, wfCityLinks } from './waterfront.js';
import { makeAirfieldPlan, planSurfaceAt, buildAirfield } from './airfield.js';
import { buildRunway, buildLightPoints, runwayDesignators, designatorText, trueHeadingFromEnds, MARKING_STANDARDS, MAGNETIC_VARIATION_DEG, LIGHT_COLORS } from './runway.js';

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

// ---- Yol/nehir geometrisi yardımcıları ------------------------------------
// Catmull-Rom: kontrol noktalarından geçen yumuşak eğri (sub: parça başına ara nokta)
function smoothPath(pts, sub) {
  const n = pts.length, out = [];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push([pts[n - 1][0], pts[n - 1][1]]);
  return out;
}
// Parça dizini: poliline parçalarını ızgara hücrelerine dağıtır; mesafe sorgusu yalnızca
// noktanın hücresindeki parçalara bakar (reach dışında Infinity döner). Arazi yüksekliği
// milyonlarca kez sorgulandığı için tüm yol/nehir mesafeleri bu dizinden geçer.
class SegIndex {
  constructor(polys, reach, cell = 900) {
    this.cell = cell; this.map = new Map(); this.segs = [];
    for (const pts of polys) {
      for (let i = 0; i < pts.length - 1; i++) {
        const s = [pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]];
        const k = this.segs.push(s) - 1;
        const i0 = Math.floor((Math.min(s[0], s[2]) - reach) / cell), i1 = Math.floor((Math.max(s[0], s[2]) + reach) / cell);
        const j0 = Math.floor((Math.min(s[1], s[3]) - reach) / cell), j1 = Math.floor((Math.max(s[1], s[3]) + reach) / cell);
        for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) {
          const key = a * 65536 + b;
          let l = this.map.get(key);
          if (!l) { l = []; this.map.set(key, l); }
          l.push(k);
        }
      }
    }
  }
  dist(x, z) {
    const l = this.map.get(Math.floor(x / this.cell) * 65536 + Math.floor(z / this.cell));
    if (!l) return Infinity;
    let best = Infinity;
    for (let i = 0; i < l.length; i++) {
      const s = this.segs[l[i]];
      const vx = s[2] - s[0], vz = s[3] - s[1], wx = x - s[0], wz = z - s[1];
      const L2 = vx * vx + vz * vz || 1;
      let t = (wx * vx + wz * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = s[0] + vx * t - x, dz = s[1] + vz * t - z;
      const d = dx * dx + dz * dz;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }
}
// Nehir: kontrol noktaları yumuşatılır ve doğal kıvrımlar (menderes) eklenir. Kıvrım
// genliği nehir boyunca değişir; göllere girişte söner (göl ağzı yerinde kalır).
const RIVER_S = (() => {
  const base = smoothPath(RIVER, 10);
  const out = [];
  let s = 0;
  for (let i = 0; i < base.length; i++) {
    const p = base[i], q = base[Math.min(base.length - 1, i + 1)], o = base[Math.max(0, i - 1)];
    if (i > 0) s += Math.hypot(p[0] - o[0], p[1] - o[1]);
    let tx = q[0] - o[0], tz = q[1] - o[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    let taper = 1;
    for (const L of LAKES) taper = Math.min(taper, smoothstep(L.r * 1.05, L.r * 1.9, Math.hypot(p[0] - L.x, p[1] - L.z)));
    taper *= smoothstep(0, 900, s);
    const amp = 210 * (0.55 + 0.45 * simplex.noise(s * 0.00021 + 3.3, 1.7));
    const off = taper * amp * (Math.sin(s * 0.0034 + 0.6) * 0.75 + Math.sin(s * 0.0081 + 2.1) * 0.25);
    out.push([p[0] - tz * off, p[1] + tx * off]);
  }
  return out;
})();
const RIVER_IDX = new SegIndex([RIVER_S], 1300);
function riverDist(x, z) { return RIVER_IDX.dist(x, z); }

// ---- Deniz ve kıyı -------------------------------------------------------
// Güneyde büyük bir körfez. Kıyı çizgisi düz bir kenar değil: iki ölçekli gürültüyle
// koylar ve burunlar oluşur. Şehrin güney cephesi bu kıyıya bakar.
const COAST_Z = 20800;
export function coastLineZ(x) {
  return COAST_Z
    + 1500 * simplex.fbm(x * 0.000085 + 7.3, 11.7, 3, 2.0, 0.5)
    + 520 * simplex.fbm(x * 0.00042 - 3.1, 21.4, 2, 2.0, 0.5);
}
// >0 denizde, <0 karada (metre cinsinden kıyıya uzaklık, kabaca)
function seaDist(x, z) { return z - coastLineZ(x); }

// ---- Şehir ---------------------------------------------------------------
// Merkez sahilde; kuzeye doğru şehir merkezi -> apartmanlar -> banliyö -> sanayi -> kır.
// Merkez kıyıya yakın: şehir merkezi -> sahil bandı -> deniz kompozisyonu kurulur.
export const CITY = { x: 4500, z: 18400, r: 5300, elev: 14 };
// Arazi renklendirmesi de bölgelemeyi kullanır: kentsel zemin ayrı bir levha değil,
// arazinin köşe rengidir. Böylece ek geometri, z-fighting ve sert kenar oluşmaz.
const cityZone = makeZoning({ x: CITY.x, z: CITY.z, r: CITY.r });
// 0 kır, 1 tam kentsel. Kenarda yumuşak geçiş.
export function urbanDensity(x, z) {
  const zn = cityZone(x, z);
  if (zn === ZONE.NONE) return 0;
  const d = Math.hypot(x - CITY.x, z - CITY.z);
  const edge = smoothstep(CITY.r, CITY.r * 0.80, d);
  if (zn === ZONE.PARK) return 0.10 * edge;
  const w = zn === ZONE.DOWNTOWN ? 1.0 : zn === ZONE.CORE ? 0.92 : zn === ZONE.URBAN ? 0.80
    : zn === ZONE.INDUSTRIAL ? 0.85 : zn === ZONE.SUBURB ? 0.55 : 0.28;
  return w * edge;
}
// İkinci yerleşim: sivil havalimanının yanındaki kasaba
const TOWN2 = { x: 21200, z: -13600, r: 1050 };
// Batı yolunun bittiği yol köyü: evler yalnızca ana yol boyunca dizilir (sokak ağı yok)
const HAMLET = { x: -11150, z: 1440, r: 720 };

// ---- Havaalanları ----------------------------------------------------------
// Her havaalanı kendi yerel çerçevesinde tanımlanır: (x, z) merkez, hdg pist yönü (derece,
// 90 = doğu). Yerel koordinatlarda +X pist ekseni, +Z pistin sağ tarafıdır. Böylece ikinci
// havaalanı döndürülebilir ve tüm sorgular (yüzey tipi, düzleştirme) tek kod yolundan geçer.
// Pist numaraları burada YAZILMAZ: pist uçlarının dünya konumundan (gerçek yön) ve manyetik
// sapmadan hesaplanır (bkz. runway.js). magVar: doğu +, derece; kurgusal dünyada veri yok -> 0.
// markings: işaret standardı (ICAO / FAA). pad: pist ucu öncesi kaplamalı alan (m).
export const AIRPORTS = [
  {
    id: 'base', name: 'Anadolu Air Base', sub: 'Military base', kind: 'military',
    x: 0, z: 0, hdg: 90, elev: 0, halfX: 4600, halfZ: 1500, fade: 2400,
    rwy: { len: 3000, w: 45, pad: 80, suffix: '' }, magVar: MAGNETIC_VARIATION_DEG, markings: 'ICAO', tdzPattern: 'coded',
  },
  {
    id: 'civil', name: 'Yesilova Airport', sub: 'Civil airport', kind: 'civil',
    x: 24000, z: -10000, hdg: 120, elev: 185, halfX: 2900, halfZ: 1250, fade: 2600,
    rwy: { len: 3400, w: 45, pad: 90, suffix: '' }, magVar: MAGNETIC_VARIATION_DEG, markings: 'ICAO', tdzPattern: 'coded',
  },
];
export const AIRPORT_BY_ID = Object.fromEntries(AIRPORTS.map((a) => [a.id, a]));
for (const a of AIRPORTS) {
  const r = a.hdg * Math.PI / 180; a.cos = Math.cos(r); a.sin = Math.sin(r);
  // Pist geometrisinden gerçek yön: A ucu (yerel −X) -> B ucu (yerel +X)
  const A = airportWorld(a, -a.rwy.len / 2, 0), B = airportWorld(a, a.rwy.len / 2, 0);
  a.rwyTrueHdg = trueHeadingFromEnds(A.x, A.z, B.x, B.z);
  const std = MARKING_STANDARDS[a.markings] || MARKING_STANDARDS.ICAO;
  a.desig = runwayDesignators(a.rwyTrueHdg, { magVar: a.magVar, leadingZero: std.leadingZero, suffix: a.rwy.suffix });
  a.marks = [designatorText(a.desig.a), designatorText(a.desig.b)];
}
/** Kalkış noktasının pist ucunu ve tanımlayıcısını verir (uçak yönüne göre A ya da B ucu). */
export function spawnRunway(sp) {
  const a = AIRPORT_BY_ID[sp.airport];
  const d = Math.abs(((sp.hdg - a.rwyTrueHdg + 540) % 360) - 180);
  return d < 90 ? a.marks[0] : a.marks[1];
}
// Kalkış noktaları: pist başında, pist yönüne dönük. Seçim ekranı bu listeden beslenir.
export const SPAWNS = [
  { id: 'base', airport: 'base', name: 'Anadolu Air Base', kindLabel: 'Military base', lx: -1400, lz: 0, hdg: 90 },
  { id: 'civil', airport: 'civil', name: 'Yesilova Airport', kindLabel: 'Civil airport', lx: -1600, lz: 0, hdg: 120 },
];
for (const sp of SPAWNS) {
  const a = AIRPORT_BY_ID[sp.airport];
  sp.runway = spawnRunway(sp);
  sp.sub = `${sp.kindLabel} · Runway ${a.marks[0]}/${a.marks[1]} · ${a.rwy.len} m` + (a.elev ? ` · Elevation ${a.elev} m` : '');
}
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
// Yollar (poligon çizgileri). Her yolun iki ucu da anlamlı bir yere bağlanır: başka bir yol
// (kavşak), bir kapı, bir yerleşim ya da bir tesis (otopark, kargo alanı). Kaldırılanlar:
//  - town-north: town-city ile aynı koridorda, 300 m yanında koşup tarlada biten kopya yol,
//  - base-perimeter / base-cargo: uçları kapısız çit hattında biten yollar (cargo depoların
//    içinden geçiyordu),
//  - civil-town / civil-apron: sivil havalimanının YANLIŞ (terminalsiz) tarafında, pistin 750 m
//    yanında çimde biten ve yayladan 125 m'lik bir yarma açan yol.
// Havaalanı yerel noktaları dünya koordinatına çevrilerek yazılır (pist döndürülmüştür).
const CIVIL_W = (lx, lz) => { const w = airportWorld(AIRPORTS[1], lx, lz); return [w.x, w.z]; };
const ROADS = [
  { name: 'base-town', w: 9, pts: [[0, 1050], [300, 2200], [1000, 3400], [1700, 4200], [2100, 5200], [2500, 6100], [2600, 6900]] },
  { name: 'town-east', w: 8, pts: [[2600, 6900], [3800, 7100], [5200, 6900], [6700, 6500], [7600, 6200]] },
  // Batı kapısından batıya; batı göl kıyısındaki dinlenme alanında (otopark) biter
  // Batı kapısından batıya; yol boyunca dizilmiş bir köyde (HAMLET) biter
  { name: 'base-west', w: 9, pts: [[-1200, 1050], [-1200, 1110], [-2500, 1300], [-4500, 1500], [-7500, 1700], [-10500, 1500], [-11800, 1350]] },
  // Doğu otoyolu: kasabadan sivil havalimanına — iki havaalanı arasındaki koridoru görünür kılar
  { name: 'highway-east', w: 11, pts: [[7600, 6200], [10200, 4200], [12600, 1600], [15200, -2200], [18000, -6200], [20400, -9600], [21200, -12600]] },
  // Üs -> kasaba -> ŞEHİR ana otoyolu: haritanın belkemiği. Kasabadan güneye iner,
  // şehrin çevre yoluna bağlanır. Oyuncu havadan bu hattı takip ederek şehri bulur.
  { name: 'town-city', w: 13, pts: [[2600, 6900], [2950, 8000], [3350, 9200], [3800, 10400], [4200, 11600], [4430, 12800], [4480, 13500]] },
  // Şehir çevre yolundan sanayi bölgesine ve limana giden bağlantı
  { name: 'city-port', w: 11, pts: [[1600, 16000], [900, 17200], [500, 18400], [600, 19700]] },
  // Üssün güney cephesi: iki kapıyı ve kargo alanını bağlayan servis yolu (çitin 60 m dışında)
  { name: 'base-frontage', w: 8, pts: [[-1200, 1110], [1600, 1110]] },
  // Kargo/lojistik alanı erişimi + otopark girişleri (depo sıralarının batısından)
  { name: 'cargo-access', w: 8, pts: [[1600, 1110], [1600, 2230]] },
  { name: 'cargo-lot-1', w: 7, pts: [[1600, 1898], [1660, 1898]] },
  { name: 'cargo-lot-2', w: 7, pts: [[1600, 2048], [1660, 2048]] },
  { name: 'cargo-lot-3', w: 7, pts: [[1600, 2198], [1660, 2198]] },
  // Batı kapısı dışındaki otel/ofis bölgesi: base-west'ten ayrılır, otoparkta biter
  { name: 'hotel-access', w: 7, from: { road: 'base-west', x: -2240 }, pts: [[-2240, 1700]] },
  // Sivil havalimanı erişim yolu: otoyoldan ayrılır, pistin batı ucunun güneyinden dolanır
  // (yaklaşma ışıklarının ve pist ucu emniyet alanının dışında) ve terminal otoparkına girer.
  { name: 'civil-access', w: 10, from: { road: 'highway-east', near: CIVIL_W(-2950, 2150) }, pts: [CIVIL_W(-2500, 1500), CIVIL_W(-1950, 1010), CIVIL_W(-600, 960), CIVIL_W(0, 960), CIVIL_W(0, 866)] },
  // Kargo apronu servis yolu (terminal yolundan)
  { name: 'civil-cargo', w: 8, from: { road: 'civil-access', near: CIVIL_W(0, 960) }, pts: [CIVIL_W(1450, 960), CIVIL_W(1450, 431)] },
];
// Yol kıvrımları: her köşe, yol sınıfına göre yarıçaplı bir yayla yumuşatılır (gerçek yollar
// düzlükler + kavislerden oluşur). Yarıçap komşu parçaların uzunluğuyla sınırlıdır; kontrol
// noktaları arasındaki bağlantılar (kavşak, kapı, şehir girişi) yerinde kalır.
function filletPath(pts, radius, step = 25) {
  if (pts.length < 3) return pts.map((p) => [p[0], p[1]]);
  const out = [[pts[0][0], pts[0][1]]];
  for (let i = 1; i < pts.length - 1; i++) {
    const A = pts[i - 1], B = pts[i], Cp = pts[i + 1];
    const la = Math.hypot(A[0] - B[0], A[1] - B[1]), lc = Math.hypot(Cp[0] - B[0], Cp[1] - B[1]);
    const ux = (A[0] - B[0]) / la, uz = (A[1] - B[1]) / la, vx = (Cp[0] - B[0]) / lc, vz = (Cp[1] - B[1]) / lc;
    const cosT = clamp(ux * vx + uz * vz, -1, 1), th = Math.acos(cosT);
    if (th > Math.PI - 0.02) { out.push([B[0], B[1]]); continue; }      // neredeyse düz
    let t = radius / Math.tan(th / 2);
    t = Math.min(t, 0.45 * la, 0.45 * lc);
    const p1 = [B[0] + ux * t, B[1] + uz * t], p2 = [B[0] + vx * t, B[1] + vz * t];
    const n = Math.max(2, Math.ceil((2 * t) / step));
    for (let k = 0; k <= n; k++) {
      const s = k / n, a = (1 - s) * (1 - s), b = 2 * s * (1 - s), c = s * s;
      out.push([a * p1[0] + b * B[0] + c * p2[0], a * p1[1] + b * B[1] + c * p2[1]]);
    }
  }
  out.push([pts[pts.length - 1][0], pts[pts.length - 1][1]]);
  return out;
}
// Bir yolun (yumuşatılmış) çizgisi üzerinde en yakın nokta
function nearestOnPolyline(pts, x, z) {
  let best = null, bd = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1;
    const t = clamp(((x - ax) * vx + (z - az) * vz) / L2, 0, 1);
    const px = ax + vx * t, pz = az + vz * t, d = Math.hypot(px - x, pz - z);
    if (d < bd) { bd = d; best = [px, pz]; }
  }
  return best;
}
// Kollar ana yoldan çıkar: başlangıç noktası ana yolun YUMUŞATILMIŞ çizgisinden hesaplanır
// (kontrol noktası değil), böylece kol ana yolun tam üstünde başlar — boşluk ya da bindirme yok.
for (const r of ROADS) {
  if (r.from) continue;
  r.pts = filletPath(r.pts, r.w >= 11 ? 900 : r.over ? 70 : 420);
}
for (const r of ROADS) {
  if (!r.from) continue;
  const host = ROADS.find((q) => q.name === r.from.road);
  let p0;
  if (r.from.x !== undefined) {
    // ana yolun verilen x'teki noktası
    for (let i = 0; i < host.pts.length - 1 && !p0; i++) {
      const [ax, az] = host.pts[i], [bx, bz] = host.pts[i + 1];
      if ((ax - r.from.x) * (bx - r.from.x) <= 0 && ax !== bx) { const t = (r.from.x - ax) / (bx - ax); p0 = [r.from.x, az + (bz - az) * t]; }
    }
  } else p0 = nearestOnPolyline(host.pts, r.from.near[0], r.from.near[1]);
  r.pts = filletPath([p0, ...r.pts], r.w >= 11 ? 600 : 160);
}
// Yol dizini: en yakın parça + yol boyunca konum (yol profili için)
class RoadSegIndex extends SegIndex {
  constructor(roads, reach, cell) {
    super(roads.map((r) => r.pts), reach, cell);
    this.meta = [];
    roads.forEach((r, ri) => {
      let acc = 0;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const L = Math.hypot(r.pts[i + 1][0] - r.pts[i][0], r.pts[i + 1][1] - r.pts[i][1]);
        this.meta.push([ri, acc, L]); acc += L;
      }
    });
  }
  nearest(x, z, out) {
    out.d = Infinity;
    const l = this.map.get(Math.floor(x / this.cell) * 65536 + Math.floor(z / this.cell));
    if (!l) return out;
    let best = Infinity, bi = -1, bt = 0;
    for (let i = 0; i < l.length; i++) {
      const s = this.segs[l[i]];
      const vx = s[2] - s[0], vz = s[3] - s[1], wx = x - s[0], wz = z - s[1];
      const L2 = vx * vx + vz * vz || 1;
      let t = (wx * vx + wz * vz) / L2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = s[0] + vx * t - x, dz = s[1] + vz * t - z, d = dx * dx + dz * dz;
      if (d < best) { best = d; bi = l[i]; bt = t; }
    }
    if (bi < 0) return out;
    const m = this.meta[bi];
    out.d = Math.sqrt(best); out.ri = m[0]; out.s = m[1] + bt * m[2];
    return out;
  }
}
const ROAD_IDX = new RoadSegIndex(ROADS, 620);
// Yol boyuna doğal arazi profili (yol düzleştirmesinden ÖNCEKİ arazi, ±250 m kayan ortalama).
// Yol koridoru bu profilin üstündeki tümsekleri keser, altındaki çukurları doldurmaz. Eskiden
// koridor sabit 60 m'ye kesiliyordu: 185 m'lik yaylada pistin yanında 125 m derin, 1 km genişlikte
// bir yarma ve havaalanı kenarında biten bir "kanyon" oluşuyordu.
let ROAD_PROFILE_PASS = false;
let ROAD_PROF = null;
function roadProfileAt(ri, s) {
  if (!ROAD_PROF) {
    ROAD_PROFILE_PASS = true;
    try {
      ROAD_PROF = ROADS.map((r) => {
        const samples = [];
        let acc = 0;
        for (let i = 0; i < r.pts.length - 1; i++) {
          const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
          const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(L / 25));
          for (let k = i === 0 ? 0 : 1; k <= n; k++) samples.push([acc + L * k / n, terrainHeight(ax + (bx - ax) * k / n, az + (bz - az) * k / n)]);
          acc += L;
        }
        const S = Float32Array.from(samples.map((q) => q[0]));
        let H = Float32Array.from(samples.map((q) => q[1]));
        for (let pass = 0; pass < 2; pass++) {
          const out = new Float32Array(H.length);
          for (let i = 0; i < H.length; i++) {
            let sum = 0, n = 0;
            for (let j = i; j >= 0 && S[i] - S[j] <= 250; j--) { sum += H[j]; n++; }
            for (let j = i + 1; j < H.length && S[j] - S[i] <= 250; j++) { sum += H[j]; n++; }
            out[i] = sum / n;
          }
          H = out;
        }
        return { S, H };
      });
    } finally { ROAD_PROFILE_PASS = false; }
  }
  const P = ROAD_PROF[ri], S = P.S;
  let lo = 0, hi = S.length - 1;
  if (s <= S[0]) return P.H[0];
  if (s >= S[hi]) return P.H[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= s) lo = m; else hi = m; }
  const t = (s - S[lo]) / (S[hi] - S[lo] || 1);
  return P.H[lo] + (P.H[hi] - P.H[lo]) * t;
}
// Kasaba sokakları (yalnızca yol ağı ve ev yerleşimi için; arazi düzleştirmesine dahil değil).
// Izgara yerine organik plan: merkezden geçen ana yollar (ROADS) + bükülmüş iç ve dış halka
// yolu + halkaları bağlayan, ana yol yönlerinden kaçınan ara sokaklar + dış halkadan kırsala
// uzanan kısa çıkmaz sokaklar. Ana yolların kasaba içindeki bölümü "çarşı" caddesidir.
const TOWN_STREETS = [];
// Kasaba merkezlerindeki apartman blokları [x, z, genişlik, derinlik, yükseklik]
const TOWN_BLOCKS = [
  [2600, 6650, 26, 16, 16], [2400, 7100, 22, 14, 13], [2850, 7150, 30, 16, 19], [2350, 6600, 20, 14, 12], [3000, 6650, 24, 15, 15],
  [21200, -13800, 24, 15, 15], [21000, -13350, 20, 13, 12], [21500, -13300, 26, 15, 17], [20900, -13900, 18, 13, 11],
];
function townDirs(T) {
  // Merkezden çıkan ana yolların yönleri (ara sokaklar bunlarla çakışmasın)
  const dirs = [];
  for (const r of ROADS) {
    for (const [a, b] of [[0, 1], [r.pts.length - 1, -1]]) {
      const p = r.pts[a];
      if (Math.hypot(p[0] - T.x, p[1] - T.z) > 60) continue;
      let k = a; while (k + b >= 0 && k + b < r.pts.length && Math.hypot(r.pts[k][0] - T.x, r.pts[k][1] - T.z) < 400) k += b;
      dirs.push(Math.atan2(r.pts[k][1] - T.z, r.pts[k][0] - T.x));
    }
  }
  return dirs;
}
// Halka yolu: merkezi hafifçe kaydırılmış, iki/üç/beş loblu bükülmeyle düzensiz kapalı eğri
function ringXY(T, R, a) {
  const r = R.r * (1 + R.k2 * Math.sin(a * 2 + R.ph * 1.7) + 0.07 * Math.sin(a * 3 + R.ph) + 0.04 * Math.sin(a * 5 + R.ph * 2.3));
  return [T.x + R.ox + Math.cos(a) * r, T.z + R.oz + Math.sin(a) * r];
}
function ringPts(T, R, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(ringXY(T, R, (i / n) * Math.PI * 2));
  return pts;
}
for (const [T, seed, extra] of [[TOWN, 31, null], [TOWN2, 47, [[21200, -12600], [21180, -13050], [21200, -13600]]]]) {
  const rnd = mulberry32(seed);
  // Halkalar: çekirdek, iç, orta, dış (yarıçap oranı, faz). Her biri gürültüyle bükülür.
  const rings = [0.34, 0.52, 0.69, 0.86].map((f) => ({ r: T.r * f, ph: rnd() * 6, k2: 0.03 + rnd() * 0.05, ox: (rnd() - 0.5) * T.r * 0.07, oz: (rnd() - 0.5) * T.r * 0.07 }));
  for (const R of rings) TOWN_STREETS.push({ w: R === rings[3] || R === rings[1] ? 6.5 : 6, town: T, pts: ringPts(T, R, Math.round(R.r / 14)) });
  if (extra) TOWN_STREETS.push({ w: 9, town: T, main: true, pts: extra });
  const dirs = townDirs(T);
  if (extra) dirs.push(Math.atan2(extra[0][1] - T.z, extra[0][0] - T.x));
  const angOK = (a, lim) => dirs.every((d) => Math.abs(Math.atan2(Math.sin(a - d), Math.cos(a - d))) > lim);
  const nearBlock = (x, z) => TOWN_BLOCKS.some((B) => Math.hypot(x - B[0], z - B[1]) < Math.max(B[2], B[3]) + 22);
  // Halkalar arası ara sokaklar: her halka aralığında ~180 m arayla, aralıklar arasında
  // kaydırılmış (organik kasabalarda ara sokaklar hizalı değildir); hafif kavisli
  for (let g = 0; g < rings.length - 1; g++) {
    const A = rings[g], B = rings[g + 1];
    const mid = (A.r + B.r) / 2, n = Math.max(5, Math.round((Math.PI * 2 * mid) / 185));
    const off = rnd() * 6.28;
    for (let i = 0; i < n; i++) {
      const a = off + (i / n) * Math.PI * 2 + (rnd() - 0.5) * 0.12;
      if (!angOK(a, 0.11 + 60 / mid)) continue;
      if (rnd() < 0.12) continue;
      const bend = (rnd() - 0.5) * 0.10, da = (rnd() - 0.5) * 0.08;
      const p0 = ringXY(T, A, a), p1 = ringXY(T, B, a + da);
      const pts = [];
      for (let k = 0; k <= 5; k++) {
        // İki halka noktası arasında, ortası yana bükülmüş eğri
        const t = k / 5, sb = Math.sin(t * Math.PI) * bend * mid;
        const lx = p0[0] + (p1[0] - p0[0]) * t, lz = p0[1] + (p1[1] - p0[1]) * t;
        const ex = -(p1[1] - p0[1]), ez = p1[0] - p0[0], el = Math.hypot(ex, ez) || 1;
        const x = lx + (ex / el) * sb, z = lz + (ez / el) * sb;
        if (nearBlock(x, z)) break;
        pts.push([x, z]);
      }
      if (pts.length === 6) TOWN_STREETS.push({ w: 5.5, town: T, pts });
    }
  }
  // Çekirdek: halkadan merkezdeki meydana doğru kısa sokaklar (bloklara girmeden)
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3 + rnd() * 0.3;
    if (!angOK(a, 0.4)) continue;
    const p0 = ringXY(T, rings[0], a);
    const pts = [];
    for (let k = 0; k <= 4; k++) {
      const f = 1 - 0.55 * (k / 4), x = T.x + (p0[0] - T.x) * f, z = T.z + (p0[1] - T.z) * f;
      if (nearBlock(x, z)) break;
      pts.push([x, z]);
    }
    if (pts.length >= 3) TOWN_STREETS.push({ w: 5.5, town: T, pts });
  }
  // Dış halkadan kırsala uzanan kısa çıkmaz sokaklar (kasaba kenarı dağınık biter)
  const nOut = 13;
  for (let i = 0; i < nOut; i++) {
    const a = (i / nOut) * Math.PI * 2 + rnd() * 0.3 + 0.2;
    if (!angOK(a, 0.2) || rnd() < 0.2) continue;
    const p0 = ringXY(T, rings[3], a), len = 140 + rnd() * 190, curl = (rnd() - 0.5) * 0.5;
    const pts = [];
    for (let k = 0; k <= 4; k++) { const t = k / 4, aa = a + curl * t * t; pts.push([p0[0] + Math.cos(aa) * len * t, p0[1] + Math.sin(aa) * len * t]); }
    TOWN_STREETS.push({ w: 5.5, town: T, pts });
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
// Şehir düzleştirme maskesi: merkezde 1, kenarlara doğru yumuşak sıfır.
// Kıyının hemen dibinde sönümlenir ki sahil kotu doğal kalsın.
function cityFlatMask(x, z) {
  const d = Math.hypot(x - CITY.x, z - CITY.z);
  const m = smoothstep(CITY.r + 2600, CITY.r - 900, d);
  return m * (1 - smoothstep(-500, 260, seaDist(x, z)));
}
function townMask(x, z) {
  const t1 = smoothstep(TOWN.r + 1100, TOWN.r - 200, Math.hypot(x - TOWN.x, z - TOWN.z));
  const t2 = smoothstep(TOWN2.r + 950, TOWN2.r - 200, Math.hypot(x - TOWN2.x, z - TOWN2.z));
  return Math.max(t1, t2);
}
function roadMask(x, z) {
  const d = ROAD_IDX.dist(x, z);
  if (d > 520) return 0;
  const edge = Math.max(Math.abs(x), Math.abs(z));
  return smoothstep(520, 230, d) * (1 - smoothstep(MTN_IN - 3000, MTN_IN + 500, edge));
}
const _rn = { d: 0, ri: 0, s: 0 };
// Yol koridoru: yolun 230 m yakınında tam, 520 m'de sıfır. Üst sınır: 60 m (eski ova davranışı,
// şehir/kasaba yakınında arazi birebir aynı kalır) ya da yolun kendi doğal profili, hangisi yüksekse.
function roadAdjust(x, z, h) {
  ROAD_IDX.nearest(x, z, _rn);
  if (_rn.d > 520) return h;
  // Dağ bölgesinde koridor düzleştirmesi sönümlenir (güvenlik payı)
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const rm = smoothstep(520, 230, _rn.d) * (1 - smoothstep(MTN_IN - 3000, MTN_IN + 500, edge));
  if (rm <= 0) return h;
  const cap = Math.max(60, roadProfileAt(_rn.ri, _rn.s) + 1.5);
  return lerp(h, Math.min(h, cap), rm);
}
// Dağ kuşağının başladığı ve doruğa ulaştığı kenar mesafeleri (harita yarısı 36 km)
const MTN_IN = 27000, MTN_OUT = 34500;
function softplus(v, k) { return k * Math.log1p(Math.exp(v / k)); }

// ---- Kıyı ve arazi ayrıntısı (v3.6.0) ---------------------------------------
// Korunan bölgeler: havaalanları (düzlük + geçiş + pay), şehir/rıhtım etki alanı, kasabalar.
// 1 = yeni ayrıntı uygulanır, 0 = arazi eski hâliyle BİREBİR aynı (lerp(a, b, 0) = a).
// Şehir, binalarını ve rıhtımını bu yüksekliklerden kurar; havaalanı pistleri ve fizik de
// aynı işlevi kullanır. Bu bölgelerde geometri değişmez, iyileştirme yalnızca gölgelendiricidedir.
function protectW(x, z) {
  let w = smoothstep(CITY.r + 2900, CITY.r + 4300, Math.hypot(x - CITY.x, z - CITY.z));
  if (w <= 0) return 0;
  w *= smoothstep(TOWN.r + 1100, TOWN.r + 1800, Math.hypot(x - TOWN.x, z - TOWN.z));
  w *= smoothstep(TOWN2.r + 950, TOWN2.r + 1650, Math.hypot(x - TOWN2.x, z - TOWN2.z));
  for (const a of AIRPORTS) {
    if (w <= 0) return 0;
    airportLocal(a, x, z, _lp);
    const dx = Math.max(0, Math.abs(_lp.x) - a.halfX), dz = Math.max(0, Math.abs(_lp.z) - a.halfZ);
    w *= smoothstep(a.fade, a.fade + 700, Math.hypot(dx, dz));
  }
  return w;
}
// Son terrainHeight çağrısının kıyı bilgisi: arazi/su parçası üreticileri yükseklikle aynı
// döngüde okur (yeniden hesaplanmaz). sdD: ayrıntılı kıyı uzaklığı (+ deniz, m);
// ct: kıyı tipi 0 kum plajı .. 0,5 çakıl .. 1 kaya/falez; lake: göl kıyısı yakınlığı 0..1.
export const COAST_SCRATCH = { sdD: 1e9, ct: 0, lake: 0, P: 0 };
// Eski kıyı profili (korunan bölgelerde birebir kullanılır)
function seaFloorOld(x, z, sd) {
  return -2 - 48 * smoothstep(0, 4200, sd) - 34 * smoothstep(3500, 13000, sd)
    + 9 * simplex.fbm(x * 0.00035 + 61, z * 0.00035 - 17, 3, 2.0, 0.5) * smoothstep(300, 3000, sd);
}
// Ayrıntılı kıyı uzaklığı: temel kıyı çizgisi (coastLineZ, değişmez) iki ölçekli 2B gürültüyle
// bükülür: 1-2 km'lik koylar/burunlar ve ~500 m'lik girinti-çıkıntılar. Böylece kıyı tek
// değişkenli düzgün bir eğri olmaktan çıkar; yer yer küçük adacıklar ve kayalık burunlar oluşur.
function coastDetail(x, z, sd) {
  const n1 = simplex.fbm(x * 0.00055 + 13.1, z * 0.00055 - 4.2, 3, 2.0, 0.5);
  const n2 = simplex.noise(x * 0.0021 - 7.7, z * 0.0021 + 3.9);
  return sd + 300 * n1 + 70 * n2;
}
/**
 * Yeni kıyı profili. h: kıyı biçimlendirmesinden önceki arazi. Kıyı tipi iç kesimin
 * engebesinden ve kıyı boyunca değişen geniş ölçekli gürültüden gelir: alçak kıyıda kum plajı ve
 * sığ şelf, orta engebede çakıllı kıyı, tepelik kıyıda kayalık / falez ve hızla derinleşen taban.
 * Kara tarafında eski 820 m'lik düzleştirme yok: plaj yüzü + kumul, falezde dik yamaç.
 */
function coastProfile(x, z, h, sd, sdD, ct) {
  const WL = WATER_LEVEL;
  if (sdD < 0) {
    const d = -sdD;
    const face = lerp(34, 10, ct), back = lerp(170, 32, ct), blend = lerp(300, 110, ct);
    // Falez: yüzü 18-45 m (gürültüyle), genişliği arazi ızgarasından dar değil (dişli
    // basamak olmaz); kalan engebe arkasındaki 250-450 m'lik dik kıyı yamacıyla iner.
    const cliffH = 18 + 27 * (0.5 + 0.5 * simplex.noise(x * 0.0011 - 21, z * 0.0011 + 6));
    const cliffW = lerp(150, 95, ct), slopeW = lerp(450, 250, ct);
    if (d >= Math.max(back + blend, cliffW + slopeW)) return h;
    const dune = (1 - ct) * (1.6 + 1.6 * (0.5 + 0.5 * simplex.noise(x * 0.004 + 3, z * 0.004 - 9)));
    const tBeach = WL + 2.3 * smoothstep(0, face, d) + dune * smoothstep(face, back, d);
    const rise = Math.max(h - WL, 2.3);
    const tCliff = WL + Math.min(rise, cliffH) * smoothstep(0, cliffW, d)
      + Math.max(0, rise - cliffH) * smoothstep(cliffW * 0.6, cliffW + slopeW, d);
    const wc = smoothstep(0.35, 0.85, ct);
    const tgt = lerp(tBeach, tCliff, wc);
    return lerp(h, tgt, 1 - smoothstep(lerp(back, cliffW + slopeW * 0.85, wc), lerp(back + blend, cliffW + slopeW, wc), d));
  }
  // Deniz tarafı: kıyıya yakın eğim kıyı tipine göre; açıkta eski tabana bağlanır
  const s0 = lerp(0.011, 0.075, ct), L = lerp(1500, 900, ct);
  let depth = s0 * L * (1 - Math.exp(-sdD / L));
  depth -= (1 - ct) * 0.9 * Math.exp(-((sdD - 115) * (sdD - 115)) / 2450);            // kum barı
  const reef = ct * Math.max(0, simplex.noise(x * 0.0062 + 41, z * 0.0062 - 5) - 0.32) * 13 * (1 - smoothstep(60, 420, sdD));
  depth -= reef;                                                                        // kayalık sığlar / adacıklar
  return Math.min(WL - depth, seaFloorOld(x, z, sdD));
}
// Tepelik bölgelerde aşınma benzeri ayrıntı: ~900 m ve ~380 m'lik sırtlı gürültü (keskin
// sırtlar, yuvarlak dereler). Ortalaması ~0; ova ve korunan bölgelerde sönümlüdür.
function erosionDetail(wx, wz, h) {
  const hill = smoothstep(70, 280, h);
  if (hill <= 0) return 0;
  const g1 = 1 - Math.abs(simplex.noise(wx * 0.0011 + 3.7, wz * 0.0011 - 8.3));
  const g2 = 1 - Math.abs(simplex.noise(wx * 0.0026 - 5.1, wz * 0.0026 + 2.2));
  return ((g1 * g1 * g1 - 0.25) * 22 + (g2 * g2 - 0.33) * 7) * hill;
}

// Dağ kuşağı (v3.7). Eski sürüm 4 oktavlı keskin sırtlı gürültüydü: en ince oktavların dalga boyu
// (~400-800 m) dağ parçalarının örnekleme aralığına (167 m; uzak LOD'da 334 m) yakın olduğundan
// her sırt dişli üçgen yelpazelerine dönüşüyor, dağlar tekrarlayan sivri piramitler gibi görünüyordu.
// Yeni biçim:
//  - iki kademeli alan bükme: sıradağlar kıvrılan zincirler, vadiler doğal menderesli,
//  - geniş kütle zarfı (8-15 km): bazı bölgeler yüksek masif, bazıları alçak sırt,
//  - 3 oktavlı sırtlı fraktal, en ince dalga boyu ~1,1 km (örneklemenin 6 katı); tepe hatları
//    "yumuşak mutlak değer" ile hafif yuvarlatılır (keskin bıçak sırtı yerine doğal omuz),
//  - etek kuşağı: dağ maskesinin düşük olduğu geçişte sırtlar yerine yuvarlak tepeler; ova ile dağ
//    arasında rampa değil, giderek yükselen tepelik bir geçiş,
//  - vadi tabanları geniş ve yumuşak (aşınma/dolgu), yükseklere doğru eğim artar.
function mountainHeight(x, z, mtn) {
  const wx1 = x + 2600 * simplex.noise(x * 0.000085 + 5, z * 0.000085 - 9);
  const wz1 = z + 2600 * simplex.noise(x * 0.000085 - 17, z * 0.000085 + 21);
  const mwx = wx1 + 700 * simplex.noise(wx1 * 0.00031 + 2.1, wz1 * 0.00031 - 6.4);
  const mwz = wz1 + 700 * simplex.noise(wx1 * 0.00031 - 8.7, wz1 * 0.00031 + 3.3);
  const mass = clamp(0.5 + 0.62 * simplex.fbm(mwx * 0.000105 + 11, mwz * 0.000105 - 5, 3, 2.0, 0.5), 0, 1);
  let r = 0, amp = 1, freq = 0.000142, w = 1, norm = 0;
  for (let o = 0; o < 3; o++) {
    const n = simplex.noise(mwx * freq + 7.3 * o, mwz * freq - 3.1 * o);
    let v = 1 - Math.sqrt(n * n + 0.008);             // yumuşak sırt (tepe yuvarlatılır)
    v = v * v * w;
    w = clamp(v * 1.6, 0, 1);
    r += v * amp; norm += amp; amp *= 0.42; freq *= 2.2;
  }
  r /= norm;
  // Vadi tabanı genişletme: alçak r değerleri bastırılır (geniş, düz tabanlı vadiler)
  r = smoothstep(0.1, 1.0, r);
  const rolling = 0.5 + 0.5 * simplex.fbm(mwx * 0.00032 - 3, mwz * 0.00032 + 8, 3, 2.0, 0.5);
  const ridgeW = smoothstep(0.18, 0.72, mtn);           // eteklerde sırt yok, yuvarlak tepeler
  return mtn * (260 + 680 * mass)
    + ridgeW * mtn * 1250 * r * (0.42 + 0.58 * mass)
    + (1 - ridgeW) * mtn * 320 * rolling;
}

export function terrainHeight(x, z) {
  // Bölgesel karakter: harita her yerde aynı görünmesin. Çok geniş ölçekli gürültü kabartma
  // çarpanını değiştirir; bazı bölgeler yayvan ova, bazıları engebeli tepelik olur.
  const region = simplex.fbm(x * 0.000032 + 17, z * 0.000032 - 23, 2, 2.0, 0.5);
  const relief = 0.55 + 0.85 * (0.5 + 0.5 * region);
  // Alan bükme (domain warp): yuvarlak "baloncuk" tepeler yerine uzamış sırtlar ve vadiler
  const wx = x + 650 * simplex.noise(x * 0.00019 + 41, z * 0.00019 - 13);
  const wz = z + 650 * simplex.noise(x * 0.00019 - 27, z * 0.00019 + 33);
  const n = simplex.fbm(wx * 0.00016 + 3.1, wz * 0.00016 - 2.7, 5, 2.0, 0.5);
  let h = 95 + n * 245 * relief;
  // Sırt gürültüsü: |noise| tersi doğal vadi/sırt hatları verir, düzlüklerde devreye girmez.
  // Küp: tepeler keskin sırt, aralar yayvan vadi (aşınmış yamaç profili)
  const ridge = 1 - Math.abs(simplex.fbm(wx * 0.00040 - 8, wz * 0.00040 + 14, 4, 2.05, 0.5));
  h += ridge * ridge * ridge * 215 * relief * smoothstep(55, 230, h);
  h += simplex.fbm(x * 0.0009 + 7, z * 0.0009 + 3, 3, 2.0, 0.5) * 26;
  h += simplex.fbm(x * 0.0034 + 21, z * 0.0034 - 9, 2, 2.0, 0.5) * 5.5;   // ince yüzey kabartması
  const P = protectW(x, z);
  // Aşınma ayrıntısı: korunan bölgelerde ve nehir koridorunda sıfır (köprüler/nehir yatağı aynı)
  if (P > 0) {
    const ero = erosionDetail(wx, wz, h);
    if (ero !== 0) h += ero * P * smoothstep(1300, 1900, riverDist(x, z));
  }
  h = softplus(h, 25);
  // Kenarlara doğru dağlar. Deniz tarafında dağ oluşmaz (kıyı gerçekçi kalsın).
  const sd0 = seaDist(x, z);
  const landness = 1 - smoothstep(-1400, 200, sd0);
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const mtn = smoothstep(MTN_IN, MTN_OUT, edge) * landness;
  if (mtn > 0) h += mountainHeight(x, z, mtn);
  // Havaalanları: yerel düzlük + kendi kotu
  for (const a of AIRPORTS) {
    const m = airportFlatMask(a, x, z);
    if (m < 0.999) h = lerp(a.elev, h, m);
  }
  // Şehir platosu: hafif yükseltili, düze yakın bir alan. Kıyıya doğru kotu düşer.
  const cm = cityFlatMask(x, z);
  if (cm > 0.001) h = lerp(h, CITY.elev + 8 * smoothstep(0, 1, cm), cm * 0.88);
  h = lerp(h, 12, townMask(x, z) * 0.85);
  if (ROAD_PROFILE_PASS) return h;      // yol profili örneklemesi: yol koridorundan önceki arazi
  h = roadAdjust(x, z, h);
  // Deniz. Korunan bölgelerde (şehir kıyısı) eski profil birebir: kıyıdan itibaren plaj
  // eğimi, sonra derinleşen taban. Diğer kıyılarda yeni profil (bkz. coastProfile).
  const sd = sd0;
  const C = COAST_SCRATCH;
  C.P = P; C.sdD = sd; C.ct = 0; C.lake = 0;
  if (sd > -1700) {
    let hOld = h;
    if (sd > -900) hOld = lerp(h, seaFloorOld(x, z, sd), smoothstep(-820, 180, sd));
    if (P > 0) {
      const sdD = coastDetail(x, z, sd);
      const typeN = simplex.fbm(x * 0.00012 + 31, z * 0.00012 - 17, 2, 2.0, 0.5);
      const ct = clamp(smoothstep(18, 120, h) * 0.85 + typeN * 0.7 + 0.08, 0, 1);
      C.sdD = lerp(sd, sdD, P); C.ct = ct;
      h = lerp(hOld, coastProfile(x, z, h, sd, sdD, ct), P);
    } else h = hOld;
  }
  // Sahil şehri rıhtımı: teras + rıhtım önünde derin su + plaj (bkz. waterfront.js)
  h = waterfrontHeight(x, z, h);
  for (const L of LAKES) {
    const dr = Math.hypot(x - L.x, z - L.z) / L.r;
    if (dr > 2.4) continue;
    // Eski göl (korunan bölgelerde birebir)
    const wob = 1 + 0.22 * simplex.noise(x * 0.0012 + L.x, z * 0.0012 + L.z);
    const d = dr * wob;
    let hO = lerp(h, 7, smoothstep(1.9, 1.05, d));
    hO = lerp(hO, -16, smoothstep(1.06, 0.72, d));
    // Yol koridorunda eski göl kıyısı korunur: göl içinden geçen yollar (kasaba-doğu, doğu
    // otoyolu) eski kara dillerinin üzerinde kalır, suya inmez
    const PL = protectW(L.x, L.z) > 0 ? P * smoothstep(160, 460, ROAD_IDX.dist(x, z)) : 0;
    if (PL <= 0) { h = hO; continue; }
    // Yeni göl kıyısı: yıldız biçimli loblar yerine iki ölçekli, daha yumuşak kıvrımlı kıyı
    // (koylar ve küçük burunlar); düz +7 m'lik halka yerine kıyıdan yükselen alçak bir kıyı
    // şeridi; su altında kıyıdan merkeze kademeli derinleşme.
    const wob2 = 1 + 0.13 * simplex.fbm(x * 0.00062 + L.x * 0.001, z * 0.00062 - L.z * 0.001, 2, 2.0, 0.5)
      + 0.035 * simplex.noise(x * 0.0029 + 5, z * 0.0029 - 3);
    const d2 = dr * wob2;
    const bank = WATER_LEVEL + 1.2 + 9 * smoothstep(1.0, 1.7, d2);
    let hN = lerp(h, Math.min(h, bank), smoothstep(2.0, 1.05, d2));
    const lakeFloor = WATER_LEVEL - 1.5 - 13 * smoothstep(0.98, 0.45, d2);
    hN = lerp(hN, lakeFloor, smoothstep(1.03, 0.94, d2));
    h = lerp(hO, hN, PL);
    C.lake = Math.max(C.lake, smoothstep(1.35, 0.98, d2) * PL);
  }
  // Nehir yatağı: kenar dağlarına yaklaşırken daralır ve sığlaşır; dağların içine kanyon oyulmaz
  const rd0 = riverDist(x, z);
  if (rd0 < 1300) {
    const rd = rd0 * (1 + 0.18 * simplex.noise(x * 0.002 + 1, z * 0.002 + 2));
    const rt = smoothstep(MTN_IN - 8000, MTN_IN, edge);
    // Genişlik nehir boyunca değişir (dar boğazlar, geniş kıvrımlar)
    const wf = (1 - 0.75 * rt) * (0.78 + 0.44 * (0.5 + 0.5 * simplex.noise(x * 0.00042 + 9, z * 0.00042 - 4)));
    const rOuter = smoothstep(820 * wf, 300 * wf, rd) * (1 - rt);
    h = lerp(h, 6.5, rOuter);
    const rInner = smoothstep(235 * wf, 95 * wf, rd) * (1 - smoothstep(MTN_IN - 1500, MTN_IN, edge));
    h = lerp(h, -14 + 18 * rt, rInner);
  }
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

// ---- Hava üssü yerleşimi ----
export const AIRBASE = {
  runwayLength: 3000, runwayWidth: 45, runwayZ: 0,
  taxiwayZ: 200, taxiwayNorthZ: -200, taxiwayWidth: 23,
  apron: { x0: -760, x1: 760, z0: 211.5, z1: 580 },
  // Uç bağlantılar pist eşiğinde (tam uzunluk kalkış için); paralel taksi yolu onlarla biter
  links: [-1480, -725, 0, 725, 1480],
  linksNorth: [-1480, 0, 1480],
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
// Üs içi servis yolları (çit içinde). TEK bağlı ağ: her yol ya başka bir yola, ya kapıya, ya da
// bir tesise (otopark, apron kenarı, yakıt sahası, depo, sığınak) bağlanır. Eskiden aynı hat
// üzerinde düz asfalt levha + servis yolu üst üste çiziliyordu, bazı yollar atölyelerin içinden
// geçiyordu, bazıları da çimenin ortasında bitiyordu.
const BASE_FENCE = { x0: -2080, x1: 2080, z0: -820, z1: AIRBASE.gateZ };
const PI_ = 14;   // çevre yolunun çitten içeri uzaklığı
export const BASE_ROADS = [
  // Çevre yolu (kapalı halka; düz bir kenarın ortasından başlar, köşeler yuvarlatılır)
  { id: 'perimeter', w: 6, closed: true, pts: [[0, BASE_FENCE.z0 + PI_], [BASE_FENCE.x1 - PI_, BASE_FENCE.z0 + PI_], [BASE_FENCE.x1 - PI_, BASE_FENCE.z1 - PI_], [BASE_FENCE.x0 + PI_, BASE_FENCE.z1 - PI_], [BASE_FENCE.x0 + PI_, BASE_FENCE.z0 + PI_], [0, BASE_FENCE.z0 + PI_]] },
  { id: 'main-gate', w: 8, pts: [[0, AIRBASE.gateZ], [0, 800]] },                                   // ana kapı -> hangar yolu
  { id: 'hangar-road', w: 8, pts: [[-870, 800], [1450, 800]] },                                    // hangarların arkası
  { id: 'west-road', w: 6, pts: [[-870, BASE_FENCE.z1 - PI_], [-870, 800]] },
  { id: 'east-road', w: 6, pts: [[830, BASE_FENCE.z1 - PI_], [830, 530]] },
  { id: 'hq-road', w: 6, pts: [[830, 530], [1150, 530]] },                                         // HQ otoparkı ve depolar
  { id: 'depot-road', w: 6, pts: [[1450, 800], [1450, 895]] },                                     // araç deposu otoparkı
  { id: 'barracks-road', w: 6, pts: [[-450, 800], [-450, 1008], [-330, 1008]] },                   // kışla otoparkı
  { id: 'generator-road', w: 5, pts: [[300, 800], [300, 952]] },
  // Batı kapısı -> depolar -> yakıt sahası kuzey kapısı; yakıt sahası doğu kapısı -> apron
  { id: 'west-gate', w: 6, pts: [[-1200, AIRBASE.gateZ], [-1200, 905], [-1120, 765], [-1065, 700], [-990, 640], [-990, 451]] },
  { id: 'west-lot', w: 5, pts: [[-1230, 885], [-1190, 885]] },
  { id: 'fuel-apron', w: 7, pts: [[-926, 395], [-761, 395]] },
  // HAS arkası: çevre yolunun iki yakasını bağlar; mühimmat sahası ondan ayrılır
  { id: 'has-back', w: 6, pts: [[BASE_FENCE.x0 + PI_, -560], [BASE_FENCE.x1 - PI_, -560]] },
  { id: 'munitions', w: 6, pts: [[-1700, -560], [-1700, -668]] },
  { id: 'igloo-front', w: 6, pts: [[-1790, -668], [-1340, -668]] },
];
for (const r of BASE_ROADS) r.pts = filletPath(r.pts, 28, 6);
function baseRoadDist(x, z) {
  let best = Infinity;
  for (const r of BASE_ROADS) best = Math.min(best, distToPolyline(x, z, r.pts) - r.w / 2);
  return best;
}

// Sivil havalimanı yerleşimi (yerel koordinat: +X pist ekseni, +Z pistin kuzey tarafı)
export const CIVIL = {
  rwyHalf: 1700, rwyW: 45,
  taxiZ: 190, taxiW: 23, taxiHalf: 1760,
  links: [-1680, -700, 0, 700, 1680],
  apron: { x0: -940, x1: 940, z0: 201.5, z1: 560 },
  // Kargo apronu taksi yoluna bitişik (eskiden arada 13,5 m çim vardı: apron erişilemezdi)
  cargo: { x0: 1080, x1: 1560, z0: 201.5, z1: 430 },
  terminal: { x: 0, z: 655, w: 430, d: 68, h: 23 },
  pier: { x: 0, z: 585, w: 300, d: 22, h: 8 },
  tower: { x: 610, z: 640, r: 5.5, h: 42 },
  stands: [-780, -600, -420, -240, -60, 120, 300, 480, 660, 840].map((x) => ({ x, z: 300 })),
  hangars: [{ x: -1250, z: 430, w: 96, d: 74, h: 19 }, { x: -1250, z: 620, w: 96, d: 74, h: 19 }],
  fuel: [{ x: 1350, z: 560, r: 11, h: 9 }, { x: 1310, z: 600, r: 11, h: 9 }],
  carPark: { x: 0, z: 800, w: 380, d: 130 },
};

// ---- Kaplama planları (airfield.js): çizim ve fizik yüzey sorgusu AYNI veriden ----
// Taksi yolları birbirine bindirilmez; bağlantılar pist kenarından paralel taksi yolu kenarına
// uzanır, kavşak köşeleri dolgu yaylarıyla kapanır. Apronlar taksi yolu kenarına bitişiktir.
function basePlanDef() {
  const A = AIRBASE, tw = A.taxiwayWidth, h = tw / 2, W2 = A.runwayWidth / 2, L2 = A.runwayLength / 2;
  const endX = A.links[A.links.length - 1] + h;           // paralel taksi yolları uç bağlantılarla biter
  const taxiways = [
    { id: 'A', axis: 'x', c: A.taxiwayZ, from: -endX, to: endX, w: tw },
    { id: 'B', axis: 'x', c: A.taxiwayNorthZ, from: -endX, to: endX, w: tw },
    { id: 'C', axis: 'x', c: A.hasLaneZ, from: -810, to: 810, w: tw },
    ...A.links.map((x, i) => ({ id: 'A' + (i + 1), axis: 'z', c: x, from: W2, to: A.taxiwayZ - h, w: tw })),
    ...A.linksNorth.map((x, i) => ({ id: 'B' + (i + 1), axis: 'z', c: x, from: A.taxiwayNorthZ + h, to: -W2, w: tw })),
    { id: 'C1', axis: 'z', c: 0, from: A.hasLaneZ + h, to: A.taxiwayNorthZ - h, w: tw },
  ];
  const ap = A.apron;
  const aprons = [
    { x0: ap.x0, x1: ap.x1, z0: ap.z0, z1: ap.z1, id: 'main apron' },
    { x0: -700, x1: 700, z0: ap.z1, z1: 770, id: 'hangar apron' },
    // Sığınak önleri: sığınak tabanından HAS şeridinin kenarına kadar (eskiden 26 m çim boşluk vardı)
    ...A.has.map((s) => ({ x0: s.x - (s.w + 16) / 2, x1: s.x + (s.w + 16) / 2, z0: s.z - s.d / 2 + 2, z1: A.hasLaneZ - h, id: 'HAS', kind: 'pad' })),
    // Kara tarafı beton sahalar (yolla erişilir, taksi yoluyla değil)
    { x0: A.tower.x - 100, x1: A.tower.x + 100, z0: 260, z1: 460, id: 'tower', kind: 'lot' },
    { x0: -1050, x1: -930, z0: 345, z1: 445, id: 'fuel', kind: 'lot' },
    { x0: 1075, x1: 1165, z0: 610, z1: 670, id: 'water tower', kind: 'lot' },
    { x0: A.radar.x - 30, x1: A.radar.x + 30, z0: A.radar.z - 30, z1: A.radar.z + 30, id: 'radar', kind: 'lot' },
  ];
  return { runway: { len: A.runwayLength, w: A.runwayWidth, pad: AIRPORT_BY_ID.base.rwy.pad }, taxiways, aprons, filletR: 30 };
}
function civilPlanDef() {
  const C = CIVIL, tw = C.taxiW, h = tw / 2, W2 = C.rwyW / 2;
  const endX = C.links[C.links.length - 1] + h;
  const taxiways = [
    { id: 'A', axis: 'x', c: C.taxiZ, from: -endX, to: endX, w: tw },
    ...C.links.map((x, i) => ({ id: 'A' + (i + 1), axis: 'z', c: x, from: W2, to: C.taxiZ - h, w: tw })),
  ];
  const T = C.terminal, front = T.z + T.d / 2 + 30;
  const aprons = [
    { x0: C.apron.x0, x1: C.apron.x1, z0: C.apron.z0, z1: C.apron.z1, id: 'main apron' },
    { x0: C.cargo.x0, x1: C.cargo.x1, z0: C.cargo.z0, z1: C.cargo.z1, id: 'cargo apron' },
    { x0: C.apron.x1, x1: C.cargo.x0, z0: C.apron.z0, z1: 330, id: 'cargo link' },
    // Hangar apronu: bakım hangarlarının kapı önü, ana apronun batı kenarına bitişik
    { x0: C.hangars[0].x + C.hangars[0].w / 2, x1: C.apron.x0, z0: 380, z1: 665, id: 'hangar apron' },
    { x0: -(T.w + 20) / 2, x1: (T.w + 20) / 2, z0: C.apron.z1, z1: front, id: 'terminal', kind: 'pad' },
    { x0: -35, x1: 35, z0: front, z1: C.carPark.z - C.carPark.d / 2, id: 'curb', kind: 'lot' },
    { x0: C.carPark.x - C.carPark.w / 2, x1: C.carPark.x + C.carPark.w / 2, z0: C.carPark.z - C.carPark.d / 2, z1: C.carPark.z + C.carPark.d / 2, id: 'car park', kind: 'lot' },
  ];
  return { runway: { len: C.rwyHalf * 2, w: C.rwyW, pad: AIRPORT_BY_ID.civil.rwy.pad }, taxiways, aprons, filletR: 30 };
}
export const AIRFIELD_PLANS = { base: makeAirfieldPlan(basePlanDef()), civil: makeAirfieldPlan(civilPlanDef()) };

const _sp = { x: 0, z: 0 };
export function surfaceTypeAt(x, z) {
  for (const a of AIRPORTS) {
    airportLocal(a, x, z, _sp);
    const t = planSurfaceAt(AIRFIELD_PLANS[a.id], _sp.x, _sp.z);
    if (t) return t;
  }
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
  add(A.tower.x, A.tower.z, 16, 16, A.tower.h + 14);
  add(A.tower.x + 16, A.tower.z + 6, 30, 16, 8);
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
  addLocal(C.tower.x, C.tower.z, 16, 16, C.tower.h + 14);
  for (const h of C.hangars) addLocal(h.x, h.z, h.w, h.d, h.h);
  for (const f of C.fuel) addLocal(f.x, f.z, f.r * 2, f.r * 2, f.h + 1);
  return boxes;
}

// ---- Havaalanı yapı yardımcıları (v3.7) ----------------------------------------
// Kontrol kulesi: gövde (kare askerî ya da yuvarlak sivil), dışa eğimli sekizgen cam kabin
// (kayıtlı koyu cam, gökyüzünü yansıtır), saçaklı çatı, anten direği ve küçük radom; isteğe bağlı
// alt operasyon binası. Dönüş: malzemeye göre geometri listeleri (birleştirilmek üzere).
function controlTowerGeos({ h, shaft, cab, square = false, base = null }) {
  const conc = [], glass = [], dark = [];
  if (base) { const b = new THREE.BoxGeometry(base.w, base.h, base.d); b.translate(base.x, base.h / 2, base.z); conc.push(b); }
  const sh = new THREE.CylinderGeometry(shaft * 0.84, shaft, h, square ? 4 : 18, 1);
  if (square) sh.rotateY(Math.PI / 4);
  sh.translate(0, h / 2, 0); conc.push(sh);
  const y0 = h;
  const fl = new THREE.CylinderGeometry(cab * 1.06, cab * 0.86, 1.1, 8); fl.rotateY(Math.PI / 8); fl.translate(0, y0 + 0.55, 0); conc.push(fl);
  const gl = new THREE.CylinderGeometry(cab * 1.10, cab * 0.95, 4.4, 8, 1, true); gl.rotateY(Math.PI / 8); gl.translate(0, y0 + 1.1 + 2.2, 0); glass.push(gl);
  const core = new THREE.CylinderGeometry(cab * 0.86, cab * 0.86, 4.3, 8); core.rotateY(Math.PI / 8); core.translate(0, y0 + 1.1 + 2.2, 0); dark.push(core);
  const rf = new THREE.CylinderGeometry(cab * 1.24, cab * 1.14, 0.9, 8); rf.rotateY(Math.PI / 8); rf.translate(0, y0 + 5.5 + 0.45, 0); conc.push(rf);
  const top = y0 + 6.4;
  const mast = new THREE.CylinderGeometry(0.11, 0.16, 7.5, 6); mast.translate(cab * 0.45, top + 3.75, 0); dark.push(mast);
  const dome = new THREE.SphereGeometry(1.15, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2); dome.translate(-cab * 0.42, top, 0.4); conc.push(dome);
  const hut = new THREE.BoxGeometry(2.4, 1.6, 2.0); hut.translate(0, top + 0.8, -cab * 0.5); conc.push(hut);
  return { conc, glass, dark, top: top + 7.5 };
}
// Bir ExtrudeGeometry'yi malzeme gruplarına ayırır (0: kapaklar/ön-arka yüz, 1: yan yüzler)
function splitGroups(geo, uvScale = [1, 1]) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const out = [];
  for (const gr of g.groups) {
    const part = new THREE.BufferGeometry();
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      part.setAttribute(name, new THREE.BufferAttribute(a.array.slice(gr.start * a.itemSize, (gr.start + gr.count) * a.itemSize), a.itemSize));
    }
    const uv = part.attributes.uv;
    if (uv) for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale[gr.materialIndex === 0 ? 0 : 1], uv.getY(i) * uvScale[gr.materialIndex === 0 ? 0 : 1]);
    (out[gr.materialIndex] = out[gr.materialIndex] || []).push(part);
  }
  return out;
}
// Kutunun UV'lerini metre ölçeğine göre döşer (cephe dokusu esnemesin)
function boxUVScale(g, w, h, d, su = 4.2, sv = 3.6) {
  const uv = g.attributes.uv;
  const U = [d, d, w, w, w, w], V = [h, h, d, d, h, h];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * (U[f] / su), uv.getY(k) * (V[f] / sv)); }
  return g;
}

// Sabit yapı gölgeleri: güneş sabit olduğundan düz zemindeki gölge, taban dikdörtgeninin
// köşeleri ile güneş yönünde h kadar kaydırılmış köşelerinin dışbükey zarfıdır. Tek bir
// yarı saydam ağda pişirilir: tüm havaalanında doğru yönlü gölgeler, çalışma anında maliyet yok
// (gerçek zamanlı gölge haritası yalnızca uçağın çevresindeki ±32-70 m'yi kapsar).
// items: [{ x, z, w, d, h, rot? }]  sunL: yerel çerçevede güneş yönü {x, y, z}
function bakedShadowGeometry(items, sunL, y = 0.04) {
  const pos = [];
  const k = 1 / Math.max(0.15, sunL.y);
  for (const it of items) {
    const c = Math.cos(it.rot || 0), s = Math.sin(it.rot || 0);
    const hw = it.w / 2, hd = it.d / 2, ox = -sunL.x * it.h * k, oz = -sunL.z * it.h * k;
    const pts = [];
    for (const [a, b] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) {
      const x = it.x + a * c + b * s, z = it.z - a * s + b * c;
      pts.push([x, z], [x + ox, z + oz]);
    }
    // dışbükey zarf (Andrew monotone chain)
    pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lower = [], upper = [];
    for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
    const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
    for (let i = 1; i < hull.length - 1; i++) {
      // +Y normal için sargı (x,z düzleminde saat yönü tersine bakış aşağıdan): (0, i+1, i)
      for (const q of [hull[0], hull[i + 1], hull[i]]) pos.push(q[0], y, q[1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  return g;
}

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 0, drawDistance: 16000, trees: 19000, treeDistance: 5200, traffic: 160, water: 'simple', terrainSegments: 24, anisotropy: 2, clouds: 46, lod: [4500, 9500] },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, drawDistance: 26000, trees: 42000, treeDistance: 8000, traffic: 420, water: 'reflective', terrainSegments: 32, anisotropy: 4, clouds: 80, lod: [7000, 15500] },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, drawDistance: 42000, trees: 72000, treeDistance: 12000, traffic: 800, water: 'reflective', terrainSegments: 40, anisotropy: 8, clouds: 125, lod: [9500, 21000] },
};

export class World {
  // defer: true ise kurucu yalnızca alanları hazırlar; dünya build() ile parça parça
  // kurulur (yükleme ekranı ilerlemesi ve döndürmeye tepki için). Varsayılan
  // davranış değişmedi: kurucu dünyayı tek seferde kurar.
  constructor(scene, renderer, qualityKey, { defer = false } = {}) {
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
    // Güneş: kuzey yarımkürede (~39°K) geç sabah, azimut 140° (GD), yükseklik 50°. Eskiden
    // KD'de 47° yükseklikteydi: bu enlemde fiziksel olarak imkânsız bir konum, ayrıca arazi
    // gölgelendirmesinin varsaydığı güneye bakan aydınlık yamaçlarla çelişiyordu (güneye bakan
    // cepheler gölgede kalıyordu).
    this.sunDir = new THREE.Vector3(Math.sin(140 * Math.PI / 180) * Math.cos(50 * Math.PI / 180), Math.sin(50 * Math.PI / 180), -Math.cos(140 * Math.PI / 180) * Math.cos(50 * Math.PI / 180)).normalize();
    if (!defer) {
      for (const step of this.buildPlan()) {
        const r = step.run();
        if (r && typeof r.next === 'function') while (!r.next().done) { /* parça parça */ }
      }
    }
  }

  // Kurulum planı. SIRA DEĞİŞMEZ: senkron kurucu da zaman dilimli build() de bu
  // listeyi aynı sırayla çalıştırır, dolayısıyla üretilen dünya birebir aynıdır.
  // Üreteç döndüren adım (arazi) iş ilerledikçe 0..1 kesir verir.
  buildPlan() {
    return [
      { id: 'sky', run: () => this.buildSky() },
      { id: 'lights', run: () => this.buildLights() },
      { id: 'terrain', run: () => this.buildTerrainSteps() },
      { id: 'water', run: () => this.buildWater() },
      { id: 'trees', run: () => this.buildTreesSteps() },
      { id: 'roads', run: () => this.buildRoads() },
      { id: 'town', run: () => this.buildTown() },
      { id: 'airbase', run: () => this.buildAirbase() },
      { id: 'baseDetails', run: () => this.buildBaseDetails() },
      { id: 'civil', run: () => this.buildCivilAirport() },
      { id: 'city', run: () => this.buildCity() },
      { id: 'surroundings', run: () => this.buildAirportSurroundings() },
      { id: 'clouds', run: () => this.buildClouds() },
      // tüm yapılar eklendikten sonra: çarpışma ızgarası ve dünya malzemelerine atmosferik pus
      { id: 'collision', run: () => { this.buildCollisionGrid(); hazeAll(this.group); } },
    ];
  }

  /**
   * Zaman dilimli kurulum. report(id, kesir) her adım ve arazi parçası bittiğinde
   * çağrılır; iş kesintisiz sliceMs'yi aşınca pause() beklenir (tarayıcı bir kare
   * çizer, döndürme/yeniden boyutlandırma olaylarını işler).
   */
  async build(report, pause, sliceMs = 70) {
    let t = performance.now();
    const breathe = async () => {
      if (performance.now() - t < sliceMs) return;
      await pause();
      t = performance.now();
    };
    for (const step of this.buildPlan()) {
      report(step.id, 0);
      // Uzun bir işten sonra, sıradaki iş başlamadan bir kare çizilsin: ekrandaki
      // durum metni o an yapılan işi gösterir
      if (performance.now() - t > 16) { await pause(); t = performance.now(); }
      // Adım: senkron, üreteç (kesir verir) ya da söz (gerçek dünya verisi yüklenir; ilerlemeyi
      // geri çağırmayla bildirir)
      const r = step.run((frac) => report(step.id, frac));
      if (r && typeof r.then === 'function') await r;
      else if (r && typeof r.next === 'function') {
        for (let x = r.next(); !x.done; x = r.next()) { report(step.id, x.value); await breathe(); }
      }
      report(step.id, 1);
    }
  }

  track(obj) { this.disposables.push(obj); return obj; }

  // Gökyüzü renk fonksiyonu (su shader'ı ile paylaşılır)
  // Ufukta pus bandı: ufka yakın gök pus rengindedir, yukarı doğru üstel olarak maviye döner
  // (dünya pusu da aynı işlevi kullanır; bkz. worldshade.js)
  static skyGLSL() { return SKY_GLSL; }

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
    // Dünya pusu: gökyüzüyle aynı renk nesneleri (değerler paylaşılır)
    const U = this.skyUniforms;
    HAZE_UNIFORMS.hzSunDir.value = U.sunDir.value; HAZE_UNIFORMS.hzZenith.value = U.zenith.value;
    HAZE_UNIFORMS.hzHorizon.value = U.horizon.value; HAZE_UNIFORMS.hzGround.value = U.ground.value;
    HAZE_UNIFORMS.hzSunColor.value = U.sunColor.value;
    HAZE_UNIFORMS.hazeFar.value = this.quality.drawDistance;
    HAZE_UNIFORMS.hazeDensity.value = 2.05 / this.quality.drawDistance;
    HAZE_UNIFORMS.hzCurv.value = 0;      // düz kurgusal harita
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
      this.shadowHalf = s;
      sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
      sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
      sun.shadow.camera.near = 50; sun.shadow.camera.far = 1400;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.05;
      sun.shadow.radius = 2;
    }
    this.sun = sun;
    this.group.add(sun);
    this.hemi = new THREE.HemisphereLight(0x9ec3ee, 0x55603c, 1.05);
    this.group.add(this.hemi);
    const fill = new THREE.DirectionalLight(0xcfe0f5, 0.55);
    fill.position.set(-this.sunDir.x, 0.35, -this.sunDir.z).normalize().multiplyScalar(500);
    this.group.add(fill);
    this.fill = fill;
  }

  /**
   * Gün saati: kurgusal eğitim haritasında desteklenmez (yapı gölgeleri sabit güneşe göre
   * pişirilmiştir; güneş değişirse gölgeler yanlış yöne düşerdi). Gerçek bölge (GeoWorld) uygular.
   */
  get supportsTimeOfDay() { return false; }
  setTimeOfDay() { return false; }

  /**
   * Gölge kamerasının yarı genişliği: kamera uçağa yakınken daralır (aynı gölge haritasıyla
   * daha keskin uçak gölgesi; 1024'te ±70 m -> 13,7 cm/doku, ±32 m -> 6,3 cm/doku), uzaklaşınca
   * genişler (yakındaki yapıların gölgeleri de kadraja girer). Uyarlanabilir kalite çarpanı korunur.
   * Değer 4 m'lik basamaklarla değişir: projeksiyon her karede yeniden kurulmaz, gölge titremez.
   */
  applyShadowExtent(camDist) {
    if (!this.sun || !this.sun.castShadow || !this.shadowHalf) return;
    if (camDist !== undefined) this._shadowCamDist = camDist;
    const d = this._shadowCamDist === undefined ? 60 : this._shadowCamDist;
    const want = clamp(Math.ceil((22 + d * 0.9) / 4) * 4, 32, this.shadowHalf);
    const s = want * (this.perf ? this.perf.shadow : 1), cam = this.sun.shadow.camera;
    if (cam.right !== s) { cam.left = -s; cam.right = s; cam.top = s; cam.bottom = -s; cam.updateProjectionMatrix(); }
  }

  // ---- Arazi: 12x12 parça, her biri 3 LOD (etekli) ----
  buildTerrain() { const it = this.buildTerrainSteps(); while (!it.next().done) { /* tek seferde */ } }

  // Arazi üreteci: her parça bitince tamamlanan örnek sayısının oranını verir
  // (ayrıntılı parçalar 4 kat örnek içerir; ilerleme gerçek işle orantılıdır).
  // Üretim mantığı ve sırası buildTerrain'in eski hâliyle aynıdır.
  *buildTerrainSteps() {
    const q = this.quality;
    // 18x18 parça = 4 km'lik hücreler. Çözünürlük üç kademelidir: havaalanı/su çevresi 2x,
    // iç bölge normal, dış dağ kuşağı yarı çözünürlük. Böylece harita 3,2 kat büyürken
    // toplam örnekleme maliyeti eskisinin altında kalır.
    const chunksPerSide = 18;
    const chunkSize = MAP_SIZE / chunksPerSide;
    this.terrainChunkSize = chunkSize;
    const segHi = q.terrainSegments;
    const detail = this.track(makeTerrainDetailTexture(512));
    detail.anisotropy = q.anisotropy;
    this.terrainDetail = detail;
    const mat = this.track(createTerrainMaterial(detail));
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
      urban: new THREE.Color(0.42, 0.41, 0.39), urbanCore: new THREE.Color(0.29, 0.29, 0.30),
      coastGrass: new THREE.Color(0.55, 0.56, 0.36), upland: new THREE.Color(0.42, 0.45, 0.27),
      alpine: new THREE.Color(0.40, 0.43, 0.30), riverLush: new THREE.Color(0.24, 0.44, 0.17),
      townGround: new THREE.Color(0.40, 0.47, 0.27),
    };
    const tmp = new THREE.Color();
    const terrainGroup = new THREE.Group();
    terrainGroup.name = 'terrain';
    this.terrainChunks = [];
    // Su kıyıları ve üs çevresindeki parçalar 2x çözünürlük alır (nehir yatağı ızgarada kaybolmasın)
    const nMax = segHi * 2 + 1, nbMax = nMax + 2;
    const hb = new Float32Array(nbMax * nbMax);
    // Kıyı bilgisi (terrainHeight ile aynı döngüde okunur): kıyı tipi, ayrıntılı deniz uzaklığı, göl yakınlığı
    const ctb = new Float32Array(nbMax * nbMax), sdb = new Float32Array(nbMax * nbMax), lkb = new Float32Array(nbMax * nbMax);
    const sgrid = new Float32Array(nMax * nMax * 4);
    const cgrid = new Float32Array(nMax * nMax * 3);
    const lgrid = new Float32Array(nMax * nMax * 4);
    const ngrid = new Float32Array(nMax * nMax * 3);
    const isDetailChunk = (cxm, czm) => {
      const r = chunkSize * 0.72;
      for (const a of AIRPORTS) if (Math.hypot(cxm - a.x, czm - a.z) < a.halfX + a.fade * 0.5 + r) return true;
      if (Math.hypot(cxm - CITY.x, czm - CITY.z) < CITY.r + r) return true;
      if (riverDist(cxm, czm) < r + 300 || distToPolyline(cxm, czm, RIVER_S) < r + 300) return true;
      for (const L of LAKES) if (Math.hypot(cxm - L.x, czm - L.z) < L.r * 1.9 + r) return true;
      // Deniz kıyısı: kıyı çizgisi ve ayrıntıları (koylar, falezler) ızgarada çözülsün
      if (Math.abs(czm - coastLineZ(cxm)) < r + 900) return true;
      return false;
    };
    // Dış dağ kuşağı: ufku oluşturan büyük sırtlar; sırt hatları kırık üçgenlere dönüşmesin diye
    // 3/4 çözünürlükte örneklenir (eskiden 1/2: uzak LOD'da 500 m'lik basamaklar)
    const isCoarseChunk = (cxm, czm) => Math.max(Math.abs(cxm), Math.abs(czm)) > MTN_IN - chunkSize * 0.5;
    // Parça çözünürlükleri önceden belirlenir: ilerleme kesri örnek sayısıyla ağırlıklanır
    const segOf = [];
    this.terrainSegOf = segOf;
    let samplesTotal = 0, samplesDone = 0;
    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const cxm = -MAP_SIZE / 2 + cx * chunkSize + chunkSize / 2, czm = -MAP_SIZE / 2 + cz * chunkSize + chunkSize / 2;
        const sc = isDetailChunk(cxm, czm) ? segHi * 2 : isCoarseChunk(cxm, czm) ? Math.max(16, Math.round(segHi * 0.75)) : segHi;
        segOf.push(sc);
        samplesTotal += (sc + 3) * (sc + 3);
      }
    }
    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const x0 = -MAP_SIZE / 2 + cx * chunkSize;
        const z0 = -MAP_SIZE / 2 + cz * chunkSize;
        const segC = segOf[cz * chunksPerSide + cx];
        const n = segC + 1;
        const nb = n + 2; // kenarlıklı ızgara (normal hesabı için)
        const step = chunkSize / segC;
        for (let j = 0; j < nb; j++) for (let k = 0; k < nb; k++) {
          const ii = j * nb + k;
          hb[ii] = terrainHeight(x0 + (k - 1) * step, z0 + (j - 1) * step);
          ctb[ii] = COAST_SCRATCH.ct; sdb[ii] = COAST_SCRATCH.sdD; lkb[ii] = COAST_SCRATCH.lake;
        }
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
            // İrtifa kuşakları: ova yeşil, yayla zeytin yeşili/kahve, yüksek çayır
            tmp.lerp(C.upland, smoothstep(150, 420, h) * 0.55);
            tmp.lerp(C.alpine, smoothstep(650, 950, h) * 0.5);
            // Kıyı: denize yakın çayır solgun (tuzlu rüzgâr); nehir ve göl kıyısı daha gür.
            // Ayrıntılı kıyı uzaklığı (koylar/burunlar) kullanılır.
            const ib = (j + 1) * nb + (k + 1);
            const sdv = sdb[ib] < 1e8 ? sdb[ib] : seaDist(x, z);
            tmp.lerp(C.coastGrass, smoothstep(-1100, -150, sdv) * 0.45);
            const rdv = riverDist(x, z);
            tmp.lerp(C.riverLush, smoothstep(700, 240, rdv) * 0.45);
            tmp.lerp(C.riverLush, lkb[ib] * 0.35);
            // Yamaç yönü: güneye bakan yüzler daha açık (büyük ölçekte hacim hissi)
            tmp.offsetHSL(0, 0, clamp(-dhz * 0.35, -0.05, 0.05));
            tmp.lerp(C.forest, f * 0.85);
            // Orman üst sınırı üzerinde çalılık/bodur örtü
            tmp.lerp(C.scrub, smoothstep(520, 900, h) * (1 - smoothstep(0.55, 1.1, slope)) * 0.7);
            // Kum/çakıl/kaya kıyı şeridi ve su altı tabanı artık piksel gölgelendiricisinde
            // (kıyı tipi + suya göre yükseklik); burada yalnızca uzak görünüm için hafif ton.
            if (h < WATER_LEVEL && lkb[ib] < 0.01) tmp.lerp(C.sand, smoothstep(WATER_LEVEL, WATER_LEVEL - 2, h) * (1 - ctb[ib]) * 0.6);
            // Kaya ve yüksek kesim (piksel kayası gölgelendiricide; burada uzak ton)
            tmp.lerp(C.scree, smoothstep(0.75, 1.15, slope) * smoothstep(350, 650, h) * 0.6);
            tmp.lerp(C.high, smoothstep(380, 700, h) * 0.6);
            tmp.lerp(C.snow, smoothstep(1050, 1420, h) * (1 - smoothstep(0.9, 1.4, slope)));
            const tm = townMask(x, z);
            // Kasaba zemini: bahçeli yerleşim (çimen + toprak + az kaldırım); evler ve sokaklar
            // kentsel görünümü verir, zemin doğal değişimini korur
            if (tm > 0.4) tmp.lerp(C.townGround, Math.min(1, (tm - 0.4) * 1.6) * 0.75);
            // Kentsel zemin: yoğunluğa göre asfalt/beton grisi. Park bölgeleri yeşil kalır.
            const ud = urbanDensity(x, z);
            if (ud > 0.01) {
              const gritty = 0.5 + 0.5 * simplex.noise(x * 0.004 + 71, z * 0.004 - 33);
              tmp.lerp(ud > 0.6 ? C.urbanCore : C.urban, Math.min(0.96, ud * (0.80 + 0.30 * gritty)));
            }
            // Rıhtım terası: döşemeli kentsel zemin (plajın kumu korunur)
            const wpv = wfPaved(x, z);
            if (wpv > 0.01) tmp.lerp(C.urban, wpv * 0.92);
            // Arazi kullanımı (gölgelendirici): tarım uygunluğu, orman, yerleşim, kuraklık
            let farm = smoothstep(200, 70, h) * smoothstep(0.62, 0.25, f) * smoothstep(0.15, 0.05, slope);
            if (farm > 0) {
              farm *= smoothstep(-0.42, -0.05, simplex.fbm(x * 0.00011 - 5, z * 0.00011 + 9, 2, 2.0, 0.5));   // tarım bölgeleri
              for (const a of AIRPORTS) farm *= smoothstep(0.15, 0.6, airportFlatMask(a, x, z));
              farm *= (1 - Math.min(1, ud * 3)) * (1 - smoothstep(0.15, 0.5, tm));
              farm *= smoothstep(-250, -700, sdv) * smoothstep(260, 420, rdv) * (1 - lkb[ib]) * smoothstep(WATER_LEVEL + 3, WATER_LEVEL + 9, h);
              farm = smoothstep(0.12, 0.5, farm);
            }
            const il = (j * n + k) * 4;
            // shore: x kıyı tipi, y suya yakınlık/nem (deniz, göl, nehir), z eğrilik (+ dere/çukur,
            // - sırt; ızgara aralığından bağımsız ölçek), w kıyı bandı ağırlığı (deniz/göl/nehir kıyısı)
            const lap = (H(j, k + 1) + H(j, k - 1) + H(j + 1, k) + H(j - 1, k) - 4 * h) * (125 / step) * (125 / step);
            const seaNear = 1 - smoothstep(0, 650, -sdv);
            const rivNear = smoothstep(520, 140, rdv);
            sgrid[il] = lkb[ib] > 0.01 || rivNear > 0.01 ? Math.max(ctb[ib] * seaNear, 0.12 + 0.2 * varn) : ctb[ib];
            sgrid[il + 1] = Math.max(seaNear, lkb[ib], rivNear);
            sgrid[il + 2] = clamp(lap / 9, -1, 1);
            // işaret: + deniz, - göl/nehir (gölgelendirici su optiğini buna göre seçer)
            const inl = Math.max(lkb[ib], rivNear * 0.8);
            sgrid[il + 3] = inl > seaNear ? -Math.max(inl, 0.002) : seaNear;
            lgrid[il] = farm; lgrid[il + 1] = f; lgrid[il + 2] = Math.max(Math.min(1, ud * 1.4), smoothstep(0.35, 0.8, tm) * 0.4, wpv); lgrid[il + 3] = dry;
            cgrid[i3] = tmp.r; cgrid[i3 + 1] = tmp.g; cgrid[i3 + 2] = tmp.b;
          }
        }
        const center = new THREE.Vector3(x0 + chunkSize / 2, 0, z0 + chunkSize / 2);
        const meshes = [];
        // Dış dağ kuşağı parçaları zaten 3/4 çözünürlükte (167 m): uzak LOD'da yarıya inince
        // (334 m) sırtlar iri üçgen dişlerine dönüşüyordu. Bu parçalarda uzak LOD aynı geometriyi
        // paylaşır (ek bellek yok); üçgen sayısı yalnızca görünen dağ parçalarında artar.
        const coarse = segC < segHi;
        const strides = [1, 2];
        const skirts = [45, 110];
        for (let L = 0; L < 2; L++) {
          if (coarse && L === 1) {
            const mesh = new THREE.Mesh(meshes[0].geometry, mat);
            mesh.receiveShadow = false; mesh.matrixAutoUpdate = false; mesh.visible = true;
            terrainGroup.add(mesh); meshes.push(mesh);
            continue;
          }
          const stride = strides[L];
          const seg = segC / stride;
          const m = seg + 1;
          const nv = m * m + 4 * m;
          const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), land = new Float32Array(nv * 4), shr = new Float32Array(nv * 4);
          let vi = 0;
          const setV = (x, y, z, ci) => {
            pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z;
            col[vi * 3] = cgrid[ci]; col[vi * 3 + 1] = cgrid[ci + 1]; col[vi * 3 + 2] = cgrid[ci + 2];
            nrm[vi * 3] = ngrid[ci]; nrm[vi * 3 + 1] = ngrid[ci + 1]; nrm[vi * 3 + 2] = ngrid[ci + 2];
            const li = (ci / 3) * 4;
            land[vi * 4] = lgrid[li]; land[vi * 4 + 1] = lgrid[li + 1]; land[vi * 4 + 2] = lgrid[li + 2]; land[vi * 4 + 3] = lgrid[li + 3];
            shr[vi * 4] = sgrid[li]; shr[vi * 4 + 1] = sgrid[li + 1]; shr[vi * 4 + 2] = sgrid[li + 2]; shr[vi * 4 + 3] = sgrid[li + 3];
            vi++;
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
          g.setAttribute('land', new THREE.BufferAttribute(land, 4));
          g.setAttribute('shore', new THREE.BufferAttribute(shr, 4));
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
        samplesDone += (segC + 3) * (segC + 3);
        if (samplesDone < samplesTotal) yield samplesDone / samplesTotal;
      }
    }
    this.group.add(terrainGroup);
  }

  // ---- Su: her su kütlesi için derinlik + kıyı tipi öznitelikli ızgara ----
  // depth: su yüzeyinden tabana derinlik (m, karada negatif). wtype: kıyı tipi (0 kum .. 1 kaya;
  // köpük ve kıyı dalgası buna göre). Kıyıda köşeler sık: derinlik pikselde doğru ara değer alır,
  // sığlık, taban ve köpük kıyının gerçek biçimini izler.
  waterFinish(pos, dep, typ, idx) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(dep, 1));
    g.setAttribute('wtype', new THREE.Float32BufferAttribute(typ, 1));
    g.setIndex(idx);
    g.computeBoundingSphere();
    return g;
  }
  // Dörtgenleri ekler; dört köşesi de karada kalanlar (derinlik < lim) atlanır
  waterQuads(idx, dep, cols, rows, lim, flip = false, skip = null) {
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) {
      const a = j * cols + i, b = a + 1, c = a + cols, dd = c + 1;
      if (dep[a] < lim && dep[b] < lim && dep[c] < lim && dep[dd] < lim) continue;
      if (skip && skip[a] && skip[b] && skip[c] && skip[dd]) continue;
      if (flip) idx.push(a, b, c, b, dd, c); else idx.push(a, c, b, b, c, dd);
    }
  }
  waterGrid(x0, z0, w, d, nx, nz, type = 0) {
    const pos = [], dep = [], typ = [], idx = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
      const x = x0 + (i / nx) * w, z = z0 + (j / nz) * d;
      pos.push(x, WATER_LEVEL, z);
      dep.push(WATER_LEVEL - terrainHeight(x, z));
      typ.push(type < 0 ? COAST_SCRATCH.ct : type);
    }
    this.waterQuads(idx, dep, nx + 1, nz + 1, -6);
    return this.waterFinish(pos, dep, typ, idx);
  }
  // Düzgün olmayan satırlı su ızgarası: [zf0, zf1] aralığında sık satırlar (dz), dışında seyrek
  waterGridRows(x0, w, nx, z0, z1, zf0, zf1, dz) {
    const rows = [];
    for (let z = z0; z < zf0; z += 277) rows.push(z);
    for (let z = zf0; z < zf1; z += dz) rows.push(z);
    for (let z = zf1; z < z1; z += 277) rows.push(z);
    rows.push(z1);
    const pos = [], dep = [], typ = [], idx = [];
    for (const z of rows) for (let i = 0; i <= nx; i++) { const x = x0 + (i / nx) * w; pos.push(x, WATER_LEVEL, z); dep.push(WATER_LEVEL - terrainHeight(x, z)); typ.push(COAST_SCRATCH.ct); }
    // İnce ızgarada kıyı satırları yeterince sık: karada kalan (rıhtım terası dahil) dörtgenler atlanır
    this.waterQuads(idx, dep, nx + 1, rows.length, -1.5);
    return this.waterFinish(pos, dep, typ, idx);
  }
  // Kıyıyı izleyen deniz şeridi. Sütunlar dx aralıklı; satırlar temel kıyı çizgisine (coastLineZ)
  // göre ofsetlidir: ayrıntılı kıyı (koylar, burunlar, adacıklar) temel çizginin ±~400 m'sinde
  // olduğundan ±650 m sık, sonra açık deniz ızgarasının ilk satırına (zEnd) kadar seyrekleşir.
  waterCoastStrip(xa, xb, dx, zEnd) {
    const fine = [-650, -540, -450, -375, -310, -255, -205, -160, -120, -85, -52, -22, 8, 38, 70, 105, 145, 195, 255, 330, 420, 520, 640];
    const fr = [0.10, 0.24, 0.42, 0.66];
    const nxc = Math.max(1, Math.round((xb - xa) / dx));
    const rowsN = fine.length + fr.length + 1;
    const pos = [], dep = [], typ = [], idx = [];
    for (let j = 0; j < rowsN; j++) for (let i = 0; i <= nxc; i++) {
      const x = xa + (i / nxc) * (xb - xa), c = coastLineZ(x);
      const z0 = c + fine[fine.length - 1];
      const z = j < fine.length ? c + fine[j] : j < rowsN - 1 ? z0 + (zEnd - z0) * fr[j - fine.length] : zEnd;
      pos.push(x, WATER_LEVEL, z);
      dep.push(WATER_LEVEL - terrainHeight(x, z));
      typ.push(COAST_SCRATCH.ct);
    }
    this.waterQuads(idx, dep, nxc + 1, rowsN, -3);
    return this.waterFinish(pos, dep, typ, idx);
  }
  // Göl: kutupsal ızgara. Kıyı bandı (0,8R..1,45R) sık halkalı, merkez seyrek; açısal aralık
  // kıyıda ~55 m. Kare ızgaranın aksine sığlık ve kıyı köpüğü kıyı boyunca eşit çözünürlükte.
  waterLake(L, segLen) {
    const nA = Math.max(48, Math.round(2 * Math.PI * 1.15 * L.r / segLen));
    const radii = [0, 0.25, 0.45, 0.6, 0.7, 0.77];
    for (let r = 0.82; r < 1.47; r += 52 / L.r) radii.push(r);
    const pos = [], dep = [], typ = [], idx = [], riv = [];
    for (const rr of radii) for (let i = 0; i <= nA; i++) {
      const t = (i / nA) * Math.PI * 2, x = L.x + Math.cos(t) * rr * L.r, z = L.z + Math.sin(t) * rr * L.r;
      pos.push(x, WATER_LEVEL, z);
      dep.push(WATER_LEVEL - terrainHeight(x, z));
      typ.push(0.18);
      riv.push(rr > 1.3 && riverDist(x, z) < 430);
    }
    this.waterQuads(idx, dep, nA + 1, radii.length, -4, true, riv);
    return this.waterFinish(pos, dep, typ, idx);
  }
  waterStrip(pts, width, step, across) {
    const pos = [], dep = [], typ = [], idx = [], inLake = [];
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
          inLake.push(LAKES.some((L) => Math.hypot(x - L.x, z - L.z) < 1.3 * L.r));
          typ.push(0.22);
        }
        row++;
      }
    }
    // Satır yönü (akış) x enine (sol normal) -> normalin yukarı bakması için sarım ters
    // Göl ağının içinde (1,3 R) kalan dörtgenler atlanır; göl ağı da 1,3 R dışındaki nehir
    // yatağını atlar: iki saydam su katmanı üst üste binip yansımayı ikiye katlamaz
    this.waterQuads(idx, dep, across + 1, row, -6, true, inLake);
    return this.waterFinish(pos, dep, typ, idx);
  }

  buildWater() {
    const q = this.quality;
    const normals = this.track(makeWaterNormalTexture(512));
    normals.anisotropy = q.anisotropy;
    // Su yüzeyi yalnızca yüzeyin kendi katkısını çizer: Fresnel'e göre gök yansıması, güneş
    // parıltısı ve köpük. Su altındaki taban, arazi gölgelendiricisinde ışığın su içindeki
    // yolu (soğurma + saçılma, WATER_OPTICS) uygulanmış olarak zaten görünür: sığlıkta kum ve
    // kaya seçilir, derinleştikçe su kütlesinin rengine döner. Derin suda ve harita kenarında
    // (altında arazi yok) yüzey aynı saçılma rengiyle opaklaşır, geçişte basamak oluşmaz.
    const uniforms = {
      normalMap: { value: normals }, macroMap: { value: this.terrainDetail }, time: { value: 0 }, sunDir: { value: this.sunDir.clone() },
      zenith: { value: this.skyUniforms.zenith.value }, horizon: { value: this.skyUniforms.horizon.value },
      ground: { value: this.skyUniforms.ground.value }, sunColor: { value: this.skyUniforms.sunColor.value },
      detail: { value: q.water === 'reflective' ? 1.0 : 0.6 }, inland: { value: 0 },
      mapHalf: { value: MAP_SIZE / 2 },
    };
    Object.assign(uniforms, HAZE_UNIFORMS, WATER_OPTICS);   // pus ve su optiği değerleri paylaşılır
    const vertexShader = `
        attribute float depth; attribute float wtype;
        varying vec3 vWorldPos; varying float vDepth; varying float vType;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz; vDepth = depth; vType = wtype;
          gl_Position = projectionMatrix * (viewMatrix * wp);
        }`;
    const fragmentShader = `
        uniform sampler2D normalMap; uniform sampler2D macroMap; uniform float time; uniform vec3 sunDir;
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform float detail;
        uniform float inland; uniform float mapHalf;
        varying vec3 vWorldPos; varying float vDepth; varying float vType;
        ${HAZE_PARS_FS}
        ${WATER_OPTICS_GLSL}
        vec2 rot(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }
        vec3 nrm(vec2 uv) { return texture2D(normalMap, uv).xyz * 2.0 - 1.0; }
        void main() {
          vec3 wp = vWorldPos;
          vec3 dv = cameraPosition - wp; float dist = length(dv); vec3 V = dv / dist;
          // Rüzgâr lekeleri: büyük ölçekli (km) sakin/dalgalı alanlar; tekrar eden deseni kırar
          vec4 mac = texture2D(macroMap, wp.xz * 0.000043 + vec2(time * 0.00016, -time * 0.00011));
          float wind = clamp(0.25 + 1.1 * mac.b - 0.25 * inland, 0.12, 1.15);
          // Dört ölçek, her biri farklı açıda döndürülmüş ve farklı yönde akan normal (~3 m .. ~250 m)
          vec2 p = wp.xz;
          vec3 n0 = nrm(rot(p, 0.6) * 0.0042 + time * vec2(0.0021, 0.0013));
          vec3 n1 = nrm(rot(p, -0.9) * 0.0175 + time * vec2(0.0150, -0.0080));
          vec3 n2 = nrm(rot(p, 2.1) * 0.061 - time * vec2(0.024, 0.031));
          vec3 n3 = nrm(rot(p, -2.6) * 0.23 + time * vec2(0.055, -0.040));
          float fineF = 1.0 - smoothstep(500.0, 2600.0, dist);
          float midF = 1.0 - smoothstep(2500.0, 11000.0, dist);
          // Kıyıya çok yakın sığlıkta dalgacıklar sönümlü (taban net görünür)
          float shoal = smoothstep(0.0, 2.5, vDepth);
          vec2 sl = (n0.xy * 0.55 + n1.xy * 0.55 * midF + (n2.xy * 0.45 + n3.xy * 0.30) * fineF) * detail * wind * mix(0.45, 1.0, shoal);
          vec3 n = normalize(vec3(sl.x * 0.135, 1.0, sl.y * 0.135));
          float NdV = max(dot(n, V), 0.02);
          // Fresnel (Schlick, su F0 = 0,02)
          float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
          vec3 R = reflect(-V, n); R.y = abs(R.y) + 0.01;
          vec3 sky = skyColor(normalize(R), sunDir, zenith, horizon, ground, sunColor, 0.0);
          // Güneş parıltısı: Beckmann dağılımı; pürüzlülük rüzgârla ve uzaklıkla artar (piksel
          // altındaki dalga eğimleri parıltıyı geniş, sönük bir banda yayar - enerji korunur)
          vec3 H = normalize(V + sunDir);
          float NdH = max(dot(n, H), 0.0), NdL = max(dot(n, sunDir), 0.0);
          float m = clamp(mix(0.065, 0.13, wind) + 0.16 * smoothstep(800.0, 14000.0, dist), 0.05, 0.3);
          float c2 = NdH * NdH, t2 = (1.0 - c2) / max(c2, 1e-4);
          float D = exp(-t2 / (m * m)) / (3.14159 * m * m * c2 * c2);
          float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
          vec3 spec = sunColor * 2.6 * min(D * Fs * NdL / (4.0 * NdV * max(NdL, 0.1)), 6.0) * step(0.0, sunDir.y);
          // Su kütlesi opaklığı: derin su (ışık tabana ulaşıp dönemez) ve harita dışı (altında arazi yok)
          float edge = smoothstep(mapHalf - 900.0, mapHalf - 60.0, max(abs(wp.x), wp.z));
          float op = max(smoothstep(30.0, 85.0, vDepth) * (1.0 - inland), edge);
          vec3 scat = mix(uScatSea, uScatIn, inland);
          // Köpük: YALNIZCA dalganın kırıldığı yerde. Kıyıya doğru ilerleyen kırılma bantları
          // (derinliğe bağlı faz) + kıyı boyunca kesintili maske; kaya kıyıda daha çok, kumda
          // ince ve sönük. Uzakta incelir; kıyı boyunca sürekli beyaz çizgi oluşmaz.
          float foam = 0.0;
          if (vDepth < 2.5 && vDepth > -0.4 && inland < 0.5) {
            // Kıyıya yatay uzaklık: derinlik / derinlik eğimi (ekran türevlerinden, dünya xz'de).
            // Köpük metre cinsinden dar bir kuşakta kalır; sığ ve düz kıyıda geniş beyaz şerit olmaz.
            vec2 px = dFdx(wp.xz), py = dFdy(wp.xz);
            float ddx = dFdx(vDepth), ddy = dFdy(vDepth);
            float det = px.x * py.y - px.y * py.x;
            vec2 gD = abs(det) > 1e-6 ? vec2(py.y * ddx - px.y * ddy, -py.x * ddx + px.x * ddy) / det : vec2(0.0);
            float sDist = max(vDepth, 0.0) / max(length(gD), 0.004);
            vec2 fp = rot(p, 0.35);
            float seg = texture2D(macroMap, fp * 0.0011 + vec2(time * 0.002, 0.0)).g;
            float seg2 = texture2D(macroMap, rot(p, 1.7) * 0.0047 - time * 0.003).r;
            float mask = smoothstep(0.32, 0.72, seg * 0.65 + seg2 * 0.35 + vType * 0.2);
            float tex = smoothstep(0.40, 0.78, texture2D(normalMap, fp * 0.085 + time * vec2(0.02, 0.013)).r * 0.6
                                              + texture2D(normalMap, fp * 0.031 - time * 0.011).g * 0.4);
            // kırılma bantları kıyıya doğru ilerler (faz uzaklığa bağlı), kıyıdan uzaklaştıkça söner
            float surfW = mix(38.0, 14.0, vType) * (0.6 + 0.8 * seg);
            float ph = fract(sDist / mix(13.0, 6.0, vType) + time * 0.11 + seg2 * 1.7);
            float bandW = smoothstep(0.0, 0.12, ph) * (1.0 - smoothstep(0.2, 0.6, ph));
            float reach = 1.0 - smoothstep(surfW * 0.35, surfW, sDist);
            float swash = 1.0 - smoothstep(1.0, mix(7.0, 3.5, vType), sDist);
            foam = (bandW * reach * 0.75 + swash * 0.55) * tex * mask * mix(0.55, 1.0, vType);
            foam *= mix(1.0, 0.4, smoothstep(1500.0, 9000.0, dist));
          }
          foam = clamp(foam, 0.0, 0.9);
          // Ön-çarpımlı birleşim: yansıma (F) + opak su kütlesi + köpük; parıltı toplamalı
          vec3 foamCol = vec3(0.80, 0.83, 0.84) * (0.55 + 0.45 * max(sunDir.y, 0.0));
          float a = F + (1.0 - F) * op;
          vec3 Cp = sky * F + scat * (1.0 - F) * op;
          Cp = Cp * (1.0 - foam) + foamCol * foam;
          a = a * (1.0 - foam) + foam;
          spec *= 1.0 - foam;
          // Atmosferik pus: ön-çarpımlı biçimde (arka plan zaten kendi pusunu taşır)
          vec4 hz = hazeAt(wp);
          vec3 col = hazeMix(Cp / max(a, 1e-3), hz);
          spec *= 1.0 - hz.a;
          // Ton eşleme ve sRGB dönüşümü burada (karışım ön-çarpımlı)
          #ifdef TONE_MAPPING
            col = toneMapping(col); spec = toneMapping(spec);
          #endif
          vec4 o = linearToOutputTexel(vec4(col, 1.0));
          vec4 s = linearToOutputTexel(vec4(spec, 1.0));
          // Su yalnızca analitik zeminin su seviyesinin altında kaldığı yerde: uzak (kaba LOD)
          // arazi üçgenleri alçak kıyıda su düzleminin altına inse de su karada parlak kenar yapmaz
          float wet = smoothstep(-0.5, 0.1, vDepth);
          gl_FragColor = vec4(o.rgb * a + s.rgb, a) * wet;
        }`;
    const mkMat = (inl) => {
      const u = Object.assign({}, uniforms, { inland: { value: inl } });
      return this.track(new THREE.ShaderMaterial({
        uniforms: u, vertexShader, fragmentShader,
        fog: false, transparent: true, depthWrite: false, premultipliedAlpha: true,
      }));
    };
    const seaMat = mkMat(0), inMat = mkMat(1);
    this.waterUniforms = uniforms;
    this.waterMeshes = [];
    const addWater = (g, mat = seaMat) => {
      this.track(g);
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 1;
      m.matrixAutoUpdate = false;
      this.group.add(m);
      this.waterMeshes.push(m);
    };
    // Göller kutupsal ızgarayla (kıyı bandı sık), nehir kendi şeridiyle; ikisi de iç su rengi
    for (const L of LAKES) addWater(this.waterLake(L, q.water === 'reflective' ? 55 : 80), inMat);
    addWater(this.waterStrip(RIVER_S, 820, 40, 12), inMat);
    // Deniz: ufka kadar uzanır; oyuncu su kütlesinin kenarını göremez (harita sınırını da gizler).
    const SX0 = -MAP_SIZE / 2 - 12000, SW = MAP_SIZE + 24000;
    // Kıyı bandı: rıhtım bölgesi (x 1280..7680) eski ince ızgarasıyla (rıhtım/marina/plaj
    // planına göre), kalanı kıyı çizgisini izleyen şeritlerle (±650 m sık satır, ~45 m sütun).
    // Harita dışındaki kıyı (altında arazi yok, su opak) seyrek sütunlu.
    const cw = SW / 150, i0 = Math.round((1280 - SX0) / cw), i1 = Math.round((7680 - SX0) / cw);
    const xa = SX0 + i0 * cw, xb = SX0 + i1 * cw;
    const zEnd = COAST_Z + 4000;
    const dx = q.water === 'reflective' ? 45 : 70;
    const strip = (x0, x1, d) => {
      const n = Math.max(1, Math.round((x1 - x0) / 6000));
      for (let k = 0; k < n; k++) addWater(this.waterCoastStrip(x0 + (x1 - x0) * k / n, x0 + (x1 - x0) * (k + 1) / n, d, zEnd));
    };
    const half = MAP_SIZE / 2;
    strip(SX0, -half, 400); strip(-half, xa, dx);
    strip(xb, half, dx); strip(half, SX0 + SW, 400);
    addWater(this.waterGridRows(xa, xb - xa, Math.round((xb - xa) / 45), COAST_Z - 3200, COAST_Z + 4000, 19900, 22700, 36));
    addWater(this.waterGrid(SX0, COAST_Z + 4000, SW, 26000, 40, 18));          // açık deniz
    this.water = this.waterMeshes[0];
    this.seaMeshes = this.waterMeshes.slice(-2);
  }

  buildTrees() { const it = this.buildTreesSteps(); while (!it.next().done) { /* tek seferde */ } }

  // Ağaç üreteci: yerleştirme ilerledikçe 0..1 kesir verir. Rastgele sayı sırası ve
  // yerleştirme mantığı değişmedi; yalnızca döngü aralarında duraklama noktaları var.
  *buildTreesSteps() {
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
      if (Math.hypot(x - HAMLET.x, z - HAMLET.z) < HAMLET.r + 100 && ROAD_IDX.dist(x, z) < 90) return true;
      if (wfReserved(x, z, 'building')) return true;
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
      if ((tries & 255) === 0) yield 0.85 * Math.min(1, Math.max(placed / q.trees, tries / (q.trees * 3)));
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
    let coniferGeo = mergeGeometries([trunk, cone1, cone2].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const trunk2 = new THREE.CylinderGeometry(0.35, 0.55, 5, 4, 1, true); trunk2.translate(0, 2.5, 0);
    const crown = new THREE.IcosahedronGeometry(3.6, 0); crown.translate(0, 7.5, 0);
    colorize(trunk2, brown); colorize(crown, leafGreen);
    let leafyGeo = mergeGeometries([trunk2, crown].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    // Dizinli geometri: ortak köşeler bir kez işlenir (on binlerce örnekte köşe maliyeti düşer)
    coniferGeo = mergeVertices(coniferGeo, 1e-4); leafyGeo = mergeVertices(leafyGeo, 1e-4);
    this.track(coniferGeo); this.track(leafyGeo);
    const mat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    this.treeAssets = { coniferGeo, leafyGeo, mat };
    this.treeChunks = [];
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    for (let i = 0; i < perChunk.length; i++) {
      if ((i & 31) === 0) yield 0.85 + 0.15 * (i / perChunk.length);
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
  // Görünen arazi yüzeyi: en ayrıntılı LOD parçasının üçgenleri üzerinde doğrusal yükseklik.
  // Yollar ve kavşak dolguları analitik yüksekliğe değil bu yüzeye oturur: ızgara üçgenleri
  // eğimli/kavisli zeminde analitik yüzeyin altında veya üstünde kalabilir; yol kenarları
  // böylece ne gömülür ne havada kalır.
  surfaceHeight(x, z) {
    const segOf = this.terrainSegOf, cs = this.terrainChunkSize;
    if (!segOf) return terrainHeight(x, z);
    const N = 18;
    const cx = clamp(Math.floor((x + MAP_SIZE / 2) / cs), 0, N - 1), cz = clamp(Math.floor((z + MAP_SIZE / 2) / cs), 0, N - 1);
    const segC = segOf[cz * N + cx], step = cs / segC;
    const x0 = -MAP_SIZE / 2 + cx * cs, z0 = -MAP_SIZE / 2 + cz * cs;
    const fk = (x - x0) / step, fj = (z - z0) / step;
    const k = clamp(Math.floor(fk), 0, segC - 1), j = clamp(Math.floor(fj), 0, segC - 1);
    const u = fk - k, v = fj - j;
    if (!this._sh) this._sh = new Map();
    const H = (jj, kk) => {
      const key = (cz * N + cx) * 20000 + jj * 130 + kk;
      let h = this._sh.get(key);
      if (h === undefined) { h = terrainHeight(x0 + kk * step, z0 + jj * step); this._sh.set(key, h); }
      return h;
    };
    // Parça üçgenleri: (a, c, b) ve (b, c, d); köşegen b(j,k+1) - c(j+1,k)
    if (u + v <= 1) { const ha = H(j, k); return ha + (H(j, k + 1) - ha) * u + (H(j + 1, k) - ha) * v; }
    const hd = H(j + 1, k + 1);
    return hd + (H(j + 1, k) - hd) * (1 - u) + (H(j, k + 1) - hd) * (1 - v);
  }

  // Yol şeridi: enine kesit [banket | asfalt | banket]. Her kesit noktası görünen arazi
  // yüzeyine oturur (eğimli zeminde kenarlar gömülmez). Doku atlası: u [0,0.25) banket,
  // [0.25,1] asfalt. Örnekler en fazla ~22 m arayla (kavis noktaları zaten poliline içindedir).
  roadGeometry(pts, width, yOffset = 0.3, minY = -Infinity, shoulder = 2) {
    const positions = [], uvs = [], idx = [];
    let v = 0, dist = 0;
    const samples = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      const n = Math.max(1, Math.ceil(len / 22));
      for (let k = (samples.length === 0 ? 0 : 1); k <= n; k++) {
        const t = k / n;
        samples.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t });
      }
    }
    const hw = width / 2, ow = hw + shoulder;
    const across = [[-ow, 0], [-hw, 0.25], [-hw, 0.25], [hw, 1], [hw, 0.25], [ow, 0]];
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
      let tx = next.x - prev.x, tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      if (i > 0) dist += Math.hypot(s.x - prev.x, s.z - prev.z);
      const yc = Math.max(this.surfaceHeight(s.x, s.z), minY);
      for (const [o, u] of across) {
        const x = s.x + nx * o, z = s.z + nz * o;
        // Kesit kenarları kendi noktalarındaki yüzeye oturur; asfalt düz kalsın diye merkezden
        // en fazla 0,6 m sapar (köprü tabliyesinde merkez kotu geçerli)
        const ys = Math.max(this.surfaceHeight(x, z), minY);
        const y = (Math.abs(o) > hw ? ys : clamp(ys, yc - 0.6, yc + 0.6)) + yOffset;
        positions.push(x, Math.max(y, ys + yOffset), z);
        uvs.push(u, dist / 20);
      }
      if (i > 0) {
        const b0 = v - 6, b1 = v;
        for (const q of [0, 2, 4]) { const a = b0 + q, b = a + 1, c = b1 + q, d = c + 1; idx.push(a, b, c, b, d, c); }
      }
      v += 6;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Kavşak dolgusu: çizgisiz asfalt disk (kesişen yolların orta/kenar çizgileri kavşakta kesilir)
  junctionPad(x, z, r, yOffset) {
    const n = 12, positions = [], uvs = [], idx = [];
    positions.push(x, this.surfaceHeight(x, z) + yOffset, z); uvs.push(0.42, 0.5);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      positions.push(px, Math.max(this.surfaceHeight(px, pz), this.surfaceHeight(x, z) - 0.6) + yOffset, pz);
      uvs.push(0.42 + Math.cos(a) * 0.03, 0.5 + Math.sin(a) * r / 20);
      idx.push(0, 1 + ((i + 1) % n), 1 + i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Kavşaklar: farklı yolların kesişme noktaları ve bir yolun ucunun başka bir yola değdiği
  // T kavşakları. Yakın noktalar birleştirilir.
  findJunctions(roads) {
    const out = [];
    const bb = roads.map((r) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, z] of r.pts) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); } return [a - 30, b + 30, c - 30, d + 30]; });
    const add = (x, z, w1, w2) => {
      const r = Math.hypot(w1 / 2 + 2, w2 / 2 + 2);
      for (const J of out) if (Math.hypot(J.x - x, J.z - z) < Math.max(J.r, r)) { J.r = Math.max(J.r, r); return; }
      out.push({ x, z, r });
    };
    for (let i = 0; i < roads.length; i++) {
      for (let j = i + 1; j < roads.length; j++) {
        const A = roads[i], B = roads[j], ba = bb[i], bbj = bb[j];
        if (ba[1] < bbj[0] || bbj[1] < ba[0] || ba[3] < bbj[2] || bbj[3] < ba[2]) continue;
        for (let p = 0; p < A.pts.length - 1; p++) {
          const [ax, az] = A.pts[p], [bx, bz] = A.pts[p + 1];
          for (let q = 0; q < B.pts.length - 1; q++) {
            const [cx, cz] = B.pts[q], [dx, dz] = B.pts[q + 1];
            const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
            if (Math.abs(den) < 1e-9) continue;
            const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
            const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
            if (t < -0.001 || t > 1.001 || u < -0.001 || u > 1.001) continue;
            add(ax + (bx - ax) * t, az + (bz - az) * t, A.w, B.w);
          }
        }
        // T kavşakları: uç noktası diğer yolun üzerinde (veya çok yakınında) duran yollar
        for (const [S, T] of [[A, B], [B, A]]) {
          for (const e of [S.pts[0], S.pts[S.pts.length - 1]]) {
            if (distToPolyline(e[0], e[1], T.pts) < T.w / 2 + 6) add(e[0], e[1], S.w, T.w);
          }
        }
      }
    }
    return out;
  }

  buildRoads() {
    const tex = this.track(makeRoadAtlasTexture(256, 256));
    tex.anisotropy = this.quality.anisotropy;
    // Kavşaklarda z-fighting olmaması için yollar iki katmana ayrılır: doğu-batı (alt) ve kuzey-güney (üst).
    // Aynı malzemede eş düzlemli kesişen dörtgenler derinlik tamponunda yarışırdı; ayrı ofsetlerle sıra kesinleşir.
    // Kavşak dolguları üçüncü (en üst) katmandır.
    const mkMat = (units) => this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: units }));
    this.roadMats = { base: mkMat(-3), over: mkMat(-6), pad: mkMat(-9) };
    const all = [...ROADS, ...TOWN_STREETS];
    // Banket genişliği yol sınıfına göre: otoyol 2,8 m, yol 2 m, kasaba sokağı 0,9 m
    const shoulderOf = (r) => (r.town ? 0.9 : r.w >= 11 ? 2.8 : 2.0);
    // Kır yolları tek ağda; kasaba sokakları kasaba başına ayrı ağda (kasaba evleriyle birlikte
    // uzakta kapanır, görüş dışındaysa kesilir)
    this.townStreetMeshes = [];
    for (const T of [null, TOWN, TOWN2]) {
      const list = all.filter((r) => (T ? r.town === T : !r.town));
      for (const [over, units, yOff] of [[false, -3, 0.30], [true, -6, 0.33]]) {
        const geos = list.filter((r) => !!r.over === over).map((r) => this.roadGeometry(r.pts, r.w, yOff, WATER_LEVEL + 9, shoulderOf(r)));
        if (!geos.length) continue;
        const merged = this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false));
        geos.forEach((g) => g.dispose());
        const mesh = new THREE.Mesh(merged, over ? this.roadMats.over : this.roadMats.base);
        mesh.receiveShadow = false;
        this.group.add(mesh);
        if (T) this.townStreetMeshes.push({ mesh, x: T.x, z: T.z, r: T.r });
      }
    }
    const junctions = this.findJunctions(all.map((r) => ({ pts: r.pts, w: r.w + shoulderOf(r) * 0.6 })));
    this.junctions = junctions;
    if (junctions.length) {
      const pads = junctions.map((J) => this.junctionPad(J.x, J.z, J.r, 0.36));
      const pm = new THREE.Mesh(this.track(mergeGeometries(pads.map((g) => g.toNonIndexed()), false)), this.roadMats.pad);
      pads.forEach((g) => g.dispose());
      this.group.add(pm);
    }
    // Köprüler: yolların nehirle kesiştiği her nokta yumuşatılmış hatlardan hesaplanır (nehir
    // kıvrımlı olduğu için sabit koordinat kullanılmaz). Tabliye zaten su seviyesinin üstünde
    // kalır; buraya ayaklar ve korkuluk eklenir. Üs-kasaba yolundaki köprü kule-askılıdır
    // (haritanın simgelerinden biri), diğerleri kirişli köprüdür.
    const pierMat = this.track(new THREE.MeshStandardMaterial({ color: 0x9a9d9f, roughness: 0.8 }));
    const cableMat = this.track(new THREE.MeshStandardMaterial({ color: 0x5c6064, roughness: 0.55, metalness: 0.4 }));
    const piers = [], cables = [];
    const deckY = WATER_LEVEL + 9.3;
    const crossings = [];
    for (const r of ROADS) {
      for (let i = 0; i < r.pts.length - 1; i++) {
        const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
        for (let k = 0; k < RIVER_S.length - 1; k++) {
          const [cx, cz] = RIVER_S[k], [dx, dz] = RIVER_S[k + 1];
          const den = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx);
          if (Math.abs(den) < 1e-9) continue;
          const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / den;
          const u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / den;
          if (t < 0 || t > 1 || u < 0 || u > 1) continue;
          const L = Math.hypot(bx - ax, bz - az);
          crossings.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / L, dz: (bz - az) / L, landmark: r.name === 'base-town' });
        }
      }
    }
    this.bridges = [];
    for (const c of crossings) {
      const { dx: dirx, dz: dirz } = c;
      const nx = -dirz, nz = dirx, yaw = Math.atan2(dirx, dirz);
      // Açıklık: tabliyenin araziden yükseldiği bölüm (her iki yöne arazi tabliyeye ulaşana dek)
      const span = (sg) => { let t = 0; while (t < 700 && terrainHeight(c.x + dirx * t * sg, c.z + dirz * t * sg) < deckY - 0.6) t += 10; return t + 25; };
      const t0 = -span(-1), t1 = span(1), len = t1 - t0, mid = (t0 + t1) / 2;
      this.bridges.push({ x: c.x, z: c.z, len });
      for (let t = t0 + 40; t < t1 - 30; t += 72) {
        const px = c.x + dirx * t, pz = c.z + dirz * t;
        const g = new THREE.BoxGeometry(7, 34, 5); g.rotateY(yaw); g.translate(px, deckY - 17.6, pz); piers.push(g);
      }
      // Kiriş (tabliyenin altında koyu yan yüz) ve korkuluklar
      const beam = new THREE.BoxGeometry(11, 1.6, len); beam.rotateY(yaw);
      beam.translate(c.x + dirx * mid, deckY - 1.0, c.z + dirz * mid); piers.push(beam);
      for (const sgn of [-1, 1]) {
        const rail = new THREE.BoxGeometry(0.5, 1.4, len);
        rail.rotateY(yaw);
        rail.translate(c.x + dirx * mid + nx * sgn * 5.6, deckY + 0.85, c.z + dirz * mid + nz * sgn * 5.6);
        piers.push(rail);
      }
      if (!c.landmark) continue;
      // Kule-askı: iki kule, kiriş, askı halatları
      for (const t of [-95, 95]) {
        for (const sgn of [-1, 1]) {
          const g = new THREE.BoxGeometry(3.4, 40, 3.4); g.translate(c.x + dirx * t + nx * sgn * 5.2, deckY + 20, c.z + dirz * t + nz * sgn * 5.2); piers.push(g);
        }
        const cross = new THREE.BoxGeometry(15, 2.4, 2.4);
        cross.rotateY(yaw + Math.PI / 2);
        cross.translate(c.x + dirx * t, deckY + 36, c.z + dirz * t); piers.push(cross);
      }
      for (const sgn of [-1, 1]) {
        for (let k = -8; k <= 8; k++) {
          if (Math.abs(k) < 1) continue;
          const t = k * 11;
          const drop = 2 + 33 * Math.pow(Math.abs(t) / 95, 2);
          const g = new THREE.BoxGeometry(0.3, drop, 0.3);
          g.translate(c.x + dirx * t + nx * sgn * 5.2, deckY + drop / 2, c.z + dirz * t + nz * sgn * 5.2);
          cables.push(g);
        }
      }
    }
    for (const g of [...piers, ...cables]) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const bm = new THREE.Mesh(this.track(mergeGeometries(piers.map((g) => (g.index ? g.toNonIndexed() : g)), false)), pierMat);
    bm.castShadow = this.quality.shadows; this.group.add(bm);
    this.bridgeMeshes = [bm];
    if (cables.length) {
      const cm2 = new THREE.Mesh(this.track(mergeGeometries(cables.map((g) => (g.index ? g.toNonIndexed() : g)), false)), cableMat);
      this.group.add(cm2); this.bridgeMeshes.push(cm2);
    }
  }

  // Ev tipleri: gövde (duvar, rf=0) + çatı (rf=1). uv'ler ev atlasının bölgelerine eşlenir
  // (bkz. makeHouseAtlasTexture). Duvar rengi örnek rengidir; çatı rengi gölgelendiricide
  // örnek kimliğinden seçilir: tek çizim çağrısında farklı duvar ve çatı renkleri.
  makeHouseType(kind) {
    const REG = { one: [0, 0.5], two: [0.5, 0.5], shop: [0, 0], roof: [0.5, 0] };
    const parts = [];
    const finish = (g, rfFn, uvFn) => {
      g = g.index ? g.toNonIndexed() : g;
      g.computeVertexNormals();
      const pos = g.attributes.position, nrm = g.attributes.normal, n = pos.count;
      const rf = new Float32Array(n), uv = new Float32Array(n * 2);
      const old = g.attributes.uv;
      for (let i = 0; i < n; i++) {
        const r = rfFn(pos.getX(i), pos.getY(i), pos.getZ(i), nrm.getX(i), nrm.getY(i), nrm.getZ(i));
        rf[i] = r;
        const [u, v] = uvFn(pos.getX(i), pos.getY(i), pos.getZ(i), r, old ? old.getX(i) : 0, old ? old.getY(i) : 0, nrm.getY(i));
        uv[i * 2] = u; uv[i * 2 + 1] = v;
      }
      g.setAttribute('rf', new THREE.BufferAttribute(rf, 1));
      g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      parts.push(g);
    };
    const WALL = [0.02, 0.97];    // pencere içermeyen düz duvar tekseli
    const body = (w, h, d, reg) => {
      const g = new THREE.BoxGeometry(w, h + 0.6, d); g.translate(0, h / 2 - 0.3, 0);
      finish(g, () => 0, (x, y, z, r, u0, v0, ny) => (Math.abs(ny) > 0.5 ? WALL : [REG[reg][0] + u0 * 0.5, REG[reg][1] + v0 * 0.5]));
    };
    const gable = (w, d, h, y0) => {
      const sh = new THREE.Shape(); sh.moveTo(-w / 2, 0); sh.lineTo(w / 2, 0); sh.lineTo(0, h); sh.lineTo(-w / 2, 0);
      const g = new THREE.ExtrudeGeometry(sh, { depth: d, bevelEnabled: false }); g.translate(0, y0, -d / 2);
      // Kalkan duvarı (±z yüzleri) duvar rengindedir; eğik yüzeyler kiremit
      finish(g, (x, y, z, nx, ny, nz) => (Math.abs(nz) > 0.9 ? 0 : 1),
        (x, y, z, r) => (r ? [0.5 + ((z / d) + 0.5) * 0.5, ((y - y0) / h) * 0.5] : WALL));
    };
    const hip = (w, d, h, y0) => {
      const g = new THREE.ConeGeometry(Math.SQRT1_2, h, 4, 1, true); g.rotateY(Math.PI / 4); g.scale(w, 1, d); g.translate(0, y0 + h / 2, 0);
      finish(g, () => 1, (x, y) => [0.5 + 0.25 + x / w * 0.25, ((y - y0) / h) * 0.5]);
    };
    const slab = (w, h, d, y0) => {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y0 + h / 2, 0);
      finish(g, () => 1, (x, y, z, r, u0, v0) => [0.5 + u0 * 0.1, 0.02 + v0 * 0.04]);
    };
    let dims;
    if (kind === 'cottage') { body(9, 4, 7, 'one'); gable(9.8, 7.8, 2.8, 4); dims = [4.9, 3.9, 6.8]; }
    else if (kind === 'twostory') { body(10, 6.4, 8, 'two'); hip(10.8, 8.8, 2.6, 6.4); dims = [5.4, 4.4, 9.0]; }
    else if (kind === 'shop') { body(12, 7, 10, 'shop'); slab(12.4, 0.8, 10.4, 7); slab(2.4, 1.2, 2.4, 7.8); dims = [6.2, 5.2, 9.0]; }
    else { body(14, 5.5, 9, 'one'); gable(14.8, 9.8, 4.4, 5.5); dims = [7.4, 4.9, 9.9]; }
    // Dizinli geometri: ortak köşeler bir kez işlenir (binlerce örnekte köşe maliyeti ~%40 azalır)
    const geo = this.track(mergeVertices(mergeGeometries(parts, false), 1e-4));
    parts.forEach((g) => g.dispose());
    return { geo, dims };
  }

  buildTown() {
    const rand = mulberry32(4242);
    const atlas = this.track(makeHouseAtlasTexture(256));
    atlas.anisotropy = this.quality.anisotropy;
    const houseMat = this.track(new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.88 }));
    houseMat.onBeforeCompile = (sh) => {
      sh.vertexShader = 'attribute float rf;\n' + sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
        {
          float hr = fract(sin(float(gl_InstanceID) * 12.9898 + 4.1) * 43758.5453);
          vec3 rc = hr < 0.40 ? vec3(0.60, 0.25, 0.16) : hr < 0.58 ? vec3(0.30, 0.30, 0.33) : hr < 0.74 ? vec3(0.47, 0.31, 0.22)
            : hr < 0.88 ? vec3(0.70, 0.38, 0.24) : vec3(0.34, 0.39, 0.44);
          vColor = mix(vColor, rc, rf);
        }`);
    };
    houseMat.customProgramCacheKey = () => 'house1';
    const KINDS = ['cottage', 'twostory', 'shop', 'barn'];
    const types = Object.fromEntries(KINDS.map((k) => [k, this.makeHouseType(k)]));
    // Duvar paleti: kireç beyazı, krem, açık sarı, somon, açık gri, taş
    const WALLS = [[0.93, 0.91, 0.86], [0.90, 0.84, 0.70], [0.94, 0.86, 0.62], [0.90, 0.72, 0.62], [0.80, 0.80, 0.78], [0.78, 0.72, 0.62], [0.95, 0.94, 0.92]];
    // Yerleşim: evler sokak boyunca, iki yanda, cepheleri sokağa dönük dizilir. Merkezde ana
    // yol üzerinde dükkanlar ve iki katlı evler, dışa doğru müstakil evler, kenarda çiftlik
    // ambarları. Çakışma: 12 m'lik hücre ızgarasıyla ev-ev, bloklar ve diğer yollar denetlenir.
    const grid = new Map();
    const gkey = (x, z) => Math.floor(x / 14) * 100003 + Math.floor(z / 14);
    const free = (x, z, r) => {
      const gx = Math.floor(x / 14), gz = Math.floor(z / 14);
      for (let a = -2; a <= 2; a++) for (let b = -2; b <= 2; b++) {
        const l = grid.get((gx + a) * 100003 + gz + b); if (!l) continue;
        for (const o of l) if (Math.hypot(o.x - x, o.z - z) < (o.r + r) * 0.92) return false;
      }
      return !TOWN_BLOCKS.some((B) => Math.abs(x - B[0]) < B[2] / 2 + r + 5 && Math.abs(z - B[1]) < B[3] / 2 + r + 5);
    };
    const houses = [];
    for (const T of [TOWN, TOWN2, HAMLET]) {
      const streets = [
        ...ROADS.filter((r) => r.pts.some(([x, z]) => Math.hypot(x - T.x, z - T.z) < T.r * 1.1)).map((r) => ({ ...r, main: true })),
        ...TOWN_STREETS.filter((r) => r.town === T),
      ];
      for (const S of streets) {
        const sh = S.town ? 0.9 : S.w >= 11 ? 2.8 : 2.0;
        // Sokak boyunca örnekleme (yay uzunluğu ile)
        let acc = 0, next = 6 + rand() * 10;
        for (let i = 0; i < S.pts.length - 1; i++) {
          const [ax, az] = S.pts[i], [bx, bz] = S.pts[i + 1];
          const L = Math.hypot(bx - ax, bz - az); if (L < 0.01) continue;
          const tx = (bx - ax) / L, tz = (bz - az) / L, nx = -tz, nz = tx;
          while (next <= acc + L) {
            const t = (next - acc) / L, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
            const dT = Math.hypot(cx - T.x, cz - T.z) / T.r;
            let step = 14;
            if (dT < 1.02) {
              for (const side of [-1, 1]) {
                if (rand() < (S.main && dT < 0.5 ? 0.08 : 0.26)) continue;
                const rr = rand();
                let kind = 'cottage';
                if (S.main && dT < 0.55) kind = rr < 0.62 ? 'shop' : 'twostory';
                else if (dT < 0.6) kind = rr < 0.45 ? 'twostory' : 'cottage';
                else if (dT > 0.88 && !S.main && rr < 0.22) kind = 'barn';
                else kind = rr < 0.2 ? 'twostory' : 'cottage';
                const s = 0.88 + rand() * 0.3;
                const [hw, hd, H] = types[kind].dims;
                for (let row = 0; row < 2; row++) {
                  if (row === 1 && (dT > 0.8 || rand() < 0.75 || kind === 'shop')) break;
                  const set = S.w / 2 + sh + 3.2 + hd * s + row * (hd * s * 2 + 7);
                  const x = cx + nx * side * set, z = cz + nz * side * set;
                  const rad = Math.hypot(hw, hd) * s * 0.82;
                  if (Math.hypot(x - T.x, z - T.z) > T.r * 1.08) continue;
                  if (distToPolylineAny(x, z) < hd * s + 4.5) continue;
                  if (!free(x, z, rad)) continue;
                  const yaw = Math.atan2(-nx * side, -nz * side) + (rand() - 0.5) * 0.06;
                  const c = Math.cos(yaw), si = Math.sin(yaw);
                  // Taban: görünen yüzeyin köşelerdeki en düşük noktası (hiçbir köşe havada kalmaz)
                  let y = Infinity, yMax = -Infinity;
                  for (const [a, b] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, 0]]) {
                    const px = x + (a * c + b * si) * s, pz = z + (-a * si + b * c) * s;
                    const hh = this.surfaceHeight(px, pz); y = Math.min(y, hh); yMax = Math.max(yMax, hh);
                  }
                  if (y < 3 || yMax - y > 2.5) continue;
                  const ex = (Math.abs(c) * hw + Math.abs(si) * hd) * s, ez = (Math.abs(si) * hw + Math.abs(c) * hd) * s;
                  const o = { kind, x, y: y - 0.05, z, yaw, s, r: rad, ex, ez, H, town: T, wall: WALLS[Math.floor(rand() * WALLS.length)], tint: 0.9 + rand() * 0.12 };
                  houses.push(o);
                  const k = gkey(x, z); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(o);
                  step = Math.max(step, hw * s * 2 + 3 + rand() * 7);
                }
              }
            }
            next += step;
          }
          acc += L;
        }
      }
    }
    // Örnekli çizim: kasaba x tip başına bir InstancedMesh (kasaba uzaktayken tümü gizlenir)
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qu = new THREE.Quaternion(), sc = new THREE.Vector3(), tint = new THREE.Color();
    const up = new THREE.Vector3(0, 1, 0);
    this.townMeshes = [...(this.townStreetMeshes || [])];
    for (const T of [TOWN, TOWN2, HAMLET]) {
      for (const kind of KINDS) {
        const list = houses.filter((h) => h.town === T && h.kind === kind);
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(types[kind].geo, houseMat, list.length);
        list.forEach((hh, i) => {
          p.set(hh.x, hh.y, hh.z); qu.setFromAxisAngle(up, hh.yaw); sc.set(hh.s, hh.s, hh.s);
          m4.compose(p, qu, sc); im.setMatrixAt(i, m4);
          tint.setRGB(hh.wall[0] * hh.tint, hh.wall[1] * hh.tint, hh.wall[2] * hh.tint); im.setColorAt(i, tint);
          this.townBoxes.push({ minX: hh.x - hh.ex, maxX: hh.x + hh.ex, minZ: hh.z - hh.ez, maxZ: hh.z + hh.ez, minY: 0, maxY: hh.y + hh.H * hh.s });
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = false; im.computeBoundingSphere(); im.matrixAutoUpdate = false;
        this.group.add(im);
        this.townMeshes.push({ mesh: im, x: T.x, z: T.z, r: T.r });
      }
    }
    this.houseCount = houses.length;
    this.houses = houses;
    // Bahçe ağaçları: evlerin arka bahçesinde (kasabada orman ağacı yoktur; bu katman yeşil
    // dokuyu verir). Ağaç geometrisi ve malzemesi orman ağaçlarıyla ortaktır.
    if (this.treeAssets) {
      for (const T of [TOWN, TOWN2, HAMLET]) {
        const list = [];
        for (const hh of houses) {
          if (hh.town !== T || rand() > 0.3) continue;
          const back = (types[hh.kind].dims[1] * hh.s + 5 + rand() * 4), lat = (rand() - 0.5) * 10;
          const fx = Math.sin(hh.yaw), fz = Math.cos(hh.yaw);
          const x = hh.x - fx * back + fz * lat, z = hh.z - fz * back - fx * lat;
          if (!free(x, z, 2.5) || distToPolylineAny(x, z) < 7) continue;
          list.push({ x, z, y: this.surfaceHeight(x, z), s: 0.55 + rand() * 0.35, r: rand() * 6.28, c: rand() });
        }
        if (!list.length) continue;
        const im = new THREE.InstancedMesh(this.treeAssets.leafyGeo, this.treeAssets.mat, list.length);
        list.forEach((t, i) => {
          p.set(t.x, t.y - 0.3, t.z); qu.setFromAxisAngle(up, t.r); sc.set(t.s, t.s * (0.9 + t.c * 0.3), t.s);
          m4.compose(p, qu, sc); im.setMatrixAt(i, m4);
          tint.setRGB(0.85 + t.c * 0.3, 0.9 + (1 - t.c) * 0.2, 0.85); im.setColorAt(i, tint);
        });
        im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = false; im.layers.set(LAYER_TREES); im.computeBoundingSphere(); im.matrixAutoUpdate = false;
        this.group.add(im);
        this.townMeshes.push({ mesh: im, x: T.x, z: T.z, r: T.r, trees: true });
        this.gardenTrees = (this.gardenTrees || 0) + list.length;
      }
    }
    // Apartman blokları ve depo
    const winTex = this.track(makeWindowsTexture(512, 256, 10, 4));
    const blockMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const blocks = [];
    const blockDefs = TOWN_BLOCKS;
    for (const [x, z, w, d, h] of blockDefs) {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 14), uv.getY(i) * (h / 8));
      let y = Infinity;
      for (const [a, b2] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) y = Math.min(y, this.surfaceHeight(x + a, z + b2));
      g.translate(x, y + h / 2 - 0.3, z);
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
    flatMat.userData.noHaze = true;
    const per = 3;
    const bill = new THREE.InstancedMesh(quad, billMat, n * per);
    const flat = new THREE.InstancedMesh(quad, flatMat, n);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qu = new THREE.Quaternion(), sc = new THREE.Vector3();
    const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < n; i++) {
      const spread = this.cloudSpread || MAP_SIZE * 0.9;
      const x = (rand() - 0.5) * spread, z = (rand() - 0.5) * spread;
      const y = (this.cloudBase || 1900) + rand() * 1500;
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
    // Örnekler rastgele dağıtıldığından sayıyı kısmak bulutları DÜZGÜN seyreltir
    // (uyarlanabilir kalite için; malzeme ve program değişmez)
    this.cloudCounts = [bill.count, flat.count];
  }

  /**
   * Uyarlanabilir kalite ayarları. Hiçbiri gölgelendirici programını değiştirmez.
   * @param {{shadow:number, clouds:number, detail:number, effects:number}} o  çarpanlar (1 = tam)
   */
  setPerf(o) {
    this.perf = o;
    this.applyShadowExtent();
    if (this.clouds && this.cloudCounts) {
      for (let i = 0; i < this.clouds.length; i++) this.clouds[i].count = Math.max(1, Math.round(this.cloudCounts[i] * o.clouds));
    }
    if (this.city) this.city.distScale = o.effects;
    if (this.waterfront) this.waterfront.distScale = o.effects;
  }

  // ---- Sivil havalimanı --------------------------------------------------
  // Tümü yerel koordinatta kurulur (+X pist ekseni), sonunda grup döndürülüp yerine taşınır.
  // Böylece pist istenen yöne çevrilebilir ve yüzey sorguları tek kod yolunu kullanır.
  // Havaalanı çevresi: kargo/lojistik alanı, ticari binalar, otopark ve tarım alanları.
  // Pist, taksi yolları, apron ve yaklaşma koridorları serbest bırakılır.
  buildAirportSurroundings() {
    const q = this.quality;
    const rand = mulberry32(6602);
    const wallMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeFacadeTexture('industrial', 256)), roughness: 0.8, metalness: 0.1 }));
    const officeMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeFacadeTexture('office', 256)), roughness: 0.82 }));
    const asph = this.track(makeAsphaltTexture(256)); asph.anisotropy = q.anisotropy;
    const lotMat = this.track(new THREE.MeshStandardMaterial({ map: asph, roughness: 0.94, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    const whGeos = [], offGeos = [], lotGeos = [];
    const boxUV = (w, h, d, x, y, z) => {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv;
      const su = [d, d, w, w, w, w], sv = [h, h, d, d, h, h];
      for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * (su[f] / 4.2), uv.getY(k) * (sv[f] / 3.6)); }
      g.translate(x, y + h / 2, z);
      return g;
    };
    // Kargo/lojistik: üssün doğu kapısı dışında sıralı depolar
    for (let i = 0; i < 9; i++) {
      const x = 1750 + (i % 3) * 210, z = 1830 + Math.floor(i / 3) * 150;
      const y = terrainHeight(x, z);
      if (y < 1) continue;
      whGeos.push(boxUV(150 + rand() * 50, 11 + rand() * 4, 74 + rand() * 20, x, y, z));
      const lg = new THREE.PlaneGeometry(190, 46); lg.rotateX(-Math.PI / 2); lg.translate(x, y + 0.18, z + 68);
      lotGeos.push(lg);
      this.buildingBoxes.push({ minX: x - 100, maxX: x + 100, minZ: z - 45, maxZ: z + 45, minY: 0, maxY: y + 16 });
    }
    // Ticari: havaalanı oteli ve ofisler (batı kapısı)
    for (const [x, z, w, h, d] of [[-2150, 1400, 46, 30, 36], [-2320, 1560, 40, 21, 30], [-2000, 1620, 54, 16, 34], [-2380, 1330, 34, 24, 26]]) {
      const y = terrainHeight(x, z);
      if (y < 1) continue;
      offGeos.push(boxUV(w, h, d, x, y, z));
      this.buildingBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: y + h });
    }
    const addMesh = (geos, mat) => {
      if (!geos.length) return null;
      for (const g of geos) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const m = new THREE.Mesh(this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)), mat);
      m.castShadow = false; m.receiveShadow = q.shadows; m.matrixAutoUpdate = false;
      this.group.add(m);
      return m;
    };
    const a = addMesh(whGeos, wallMat), b = addMesh(offGeos, officeMat), c = addMesh(lotGeos, lotMat);
    this.airportSurround = [a, b, c].filter(Boolean);
  }

  // Şehir: kendi modülünde üretilir (bölgeleme, yollar, binalar, detaylar, trafik, LOD)
  buildCity() {
    // Rıhtım yol planı şehirden önce: şehir rıhtım şeridini ve bağlantı koridorlarını boş bırakır
    const wfRoads = wfPlan(coastLineZ);
    this.city = new City({
      center: CITY,
      quality: this.quality,
      heightAt: terrainHeight,
      surfaceHeight: (x, z) => this.surfaceHeight(x, z),
      coastZ: coastLineZ,
      reserved: wfReserved,
    });
    this.group.add(this.city.build());
    // Şehir binaları çarpışma kutularına eklenir (alçak uçuşta binalara çarpılabilsin)
    for (const b of this.city.boxes) {
      this.buildingBoxes.push({ minX: b.x - b.rx, maxX: b.x + b.rx, minZ: b.z - b.rz, maxZ: b.z + b.rz, minY: 0, maxY: b.h });
    }
    this.buildWaterfront(wfRoads);
  }

  // Sahil şehri rıhtımı (simge bölge): yapılar + rıhtım yolları + şehir bağlantıları
  buildWaterfront(wfRoads) {
    const links = wfCityLinks(this.city.net);
    this.waterfront = new Waterfront({
      quality: this.quality, heightAt: terrainHeight, surfaceHeight: (x, z) => this.surfaceHeight(x, z),
      roads: wfRoads, links,
    });
    this.group.add(this.waterfront.build());
    for (const b of this.waterfront.boxes) this.buildingBoxes.push(b);
    // Yollar: rıhtım bulvarı, arka cadde, bağlantılar (diğer yollarla aynı atlas ve katmanlar)
    const roads = [...wfRoads, ...links];
    for (const [over, mat, yOff] of [[false, this.roadMats.base, 0.30], [true, this.roadMats.over, 0.33]]) {
      const geos = roads.filter((r) => !!r.over === over).map((r) => this.roadGeometry(r.pts, r.w, yOff, -Infinity, r.w >= 12 ? 1.4 : 0.9));
      if (!geos.length) continue;
      const m = new THREE.Mesh(this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false)), mat);
      geos.forEach((g) => g.dispose());
      this.group.add(m);
    }
    const J = this.findJunctions(roads.map((r) => ({ pts: r.pts, w: r.w + 1 })));
    if (J.length) {
      const pads = J.map((j) => this.junctionPad(j.x, j.z, j.r, 0.36));
      this.group.add(new THREE.Mesh(this.track(mergeGeometries(pads.map((g) => g.toNonIndexed()), false)), this.roadMats.pad));
      pads.forEach((g) => g.dispose());
    }
    this.waterfrontRoads = roads;
    this.disposables.push(this.waterfront);
  }

  buildCivilAirport() {
    const C = CIVIL, ap = AIRPORT_BY_ID.civil, q = this.quality;
    const g = new THREE.Group();
    g.name = 'civil-airport';
    g.position.set(ap.x, ap.elev, ap.z);
    g.rotation.y = -(ap.hdg - 90) * Math.PI / 180;
    const flat = (w, d, x, z, y, uvScale = 1) => {
      const pg = new THREE.PlaneGeometry(w, d);
      pg.rotateX(-Math.PI / 2); pg.translate(x, y, z);
      const uv = pg.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / uvScale), uv.getY(i) * (d / uvScale));
      return pg;
    };
    // Pist, taksi yolları, apronlar, işaretler, levhalar, pist/taksi ışıkları: ortak kurucu
    // (bkz. buildAirportSurfaces). Kule tepesindeki engel ışığı da aynı ışık nesnesinde.
    const tw0 = C.tower;
    this.civilLights = this.buildAirportSurfaces(ap, g, [{ x: tw0.x + 6.2 * 0.45, y: tw0.h + 14.2, z: tw0.z, colA: LIGHT_COLORS.RED }]);
    // Apron duraklarının sarı giriş çizgileri ve durma çizgileri
    const yellowMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe2b72e, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    const yel = [flat(C.apron.x1 - C.apron.x0 - 40, 0.3, 0, 245, 0.035)];
    // giriş çizgisi apron taksi şeridinden (z 245) durma çizgisine (körük ucunun önü)
    for (const st of C.stands) { yel.push(flat(0.3, st.z + 50 - 245, st.x, (245 + st.z + 50) / 2, 0.036)); yel.push(flat(8, 0.3, st.x, st.z + 48, 0.036)); }
    g.add(new THREE.Mesh(this.track(mergeGeometries(yel, false)), yellowMat));
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
    // Kule: yuvarlak beton gövde, dışa eğimli kayıtlı cam kabin, saçaklı çatı, anten ve radom
    const tw2 = C.tower;
    {
      const T = controlTowerGeos({ h: tw2.h, shaft: 3.8, cab: 6.2, square: false });
      const conc = [], dark = [];
      for (const gg of T.conc) { gg.translate(tw2.x, 0, tw2.z); conc.push(gg.index ? gg.toNonIndexed() : gg); }
      for (const gg of T.dark) { gg.translate(tw2.x, 0, tw2.z); dark.push(gg.index ? gg.toNonIndexed() : gg); }
      const cm2 = new THREE.Mesh(this.track(mergeGeometries(conc, false)), wallMat); cm2.castShadow = q.shadows; g.add(cm2);
      g.add(new THREE.Mesh(this.track(mergeGeometries(dark, false)), this.track(new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7, metalness: 0.3 }))));
      const gm = T.glass[0]; gm.translate(tw2.x, 0, tw2.z);
      g.add(new THREE.Mesh(this.track(gm), this.track(new THREE.MeshStandardMaterial({ map: this.track(makeTowerGlassTexture(256, 64)), roughness: 0.12, metalness: 0.6, envMapIntensity: 1.3, side: THREE.DoubleSide }))));
    }
    // Hangarlar ve yakıt tankları
    const hangarGeos = [], tankGeos = [];
    const cladGeos = [];
    for (const h of C.hangars) {
      const b = boxUVScale(new THREE.BoxGeometry(h.w, h.h, h.d), h.w, h.h, h.d, 4, 4); b.translate(h.x, h.h / 2, h.z); cladGeos.push(b);
      const arc = new THREE.CylinderGeometry(h.d / 2, h.d / 2, h.w, 14, 1, false, 0, Math.PI);
      { const uv = arc.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * h.d * 1.57 / 4, uv.getY(i) * h.w / 4); }
      arc.rotateZ(Math.PI / 2); arc.translate(h.x, h.h, h.z); cladGeos.push(arc);
      // büyük kapı +x yüzünde: hangar apronu üzerinden ana aprona bakar
      const door = new THREE.PlaneGeometry(h.d * 0.84, h.h * 0.86); door.rotateY(Math.PI / 2); door.translate(h.x + h.w / 2 + 0.06, h.h * 0.43, h.z); hangarGeos.push(door);
    }
    for (const f of C.fuel) { const t2 = new THREE.CylinderGeometry(f.r, f.r, f.h, 14); t2.translate(f.x, f.h / 2, f.z); tankGeos.push(t2); }
    const addM = (geos, mat, shadow) => {
      if (!geos.length) return;
      for (const gg of geos) if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
      const mesh = new THREE.Mesh(this.track(mergeGeometries(geos.map((x2) => (x2.index ? x2.toNonIndexed() : x2)), false)), mat);
      mesh.castShadow = q.shadows && shadow; mesh.receiveShadow = q.shadows; g.add(mesh);
    };
    const cladTex = this.track(makeCladdingTexture(256)); cladTex.anisotropy = q.anisotropy;
    addM(cladGeos, this.track(new THREE.MeshStandardMaterial({ map: cladTex, color: 0xb6bcc0, roughness: 0.55, metalness: 0.35 })), true);
    addM(hangarGeos, this.track(new THREE.MeshStandardMaterial({ map: this.track(makeHangarDoorTexture(512, 256)), roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 })), false);
    addM(tankGeos, this.track(new THREE.MeshStandardMaterial({ color: 0xc8ccce, roughness: 0.6, metalness: 0.3 })), true);
    {
      const T2 = C.terminal, P2 = C.pier, tw3 = C.tower;
      const sh = [{ x: T2.x, z: T2.z, w: T2.w + 14, d: T2.d + 14, h: T2.h + 2 }, { x: P2.x, z: P2.z, w: P2.w, d: P2.d, h: P2.h }, { x: tw3.x, z: tw3.z, w: 7.5, d: 7.5, h: tw3.h + 5 }];
      for (const h of C.hangars) sh.push({ x: h.x, z: h.z, w: h.w, d: h.d, h: h.h + h.d * 0.35 });
      for (const f of C.fuel) sh.push({ x: f.x, z: f.z, w: f.r * 1.7, d: f.r * 1.7, h: f.h });
      this.addStaticShadows(g, sh, ap);
      g.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.castShadow) o.castShadow = false; });
    }
    this.civilCenter = new THREE.Vector3(ap.x, ap.elev, ap.z);
    this.group.add(g);
    this.civilGroup = g;
  }

  /** Pişmiş yapı gölgesi ağı (yerel çerçeve; sivilde grup döndürülmüştür). */
  addStaticShadows(parent, items, ap) {
    if (!items.length) return;
    const sd = this.sunDir;
    const sunL = ap ? { x: sd.x * ap.sin - sd.z * ap.cos, y: sd.y, z: sd.x * ap.cos + sd.z * ap.sin } : { x: sd.x, y: sd.y, z: sd.z };
    if (!this._shadowMat) {
      this._shadowMat = this.track(new THREE.MeshBasicMaterial({ color: 0x0b0f14, transparent: true, opacity: 0.34, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -12 }));
    }
    const m = new THREE.Mesh(this.track(bakedShadowGeometry(items, sunL)), this._shadowMat);
    m.renderOrder = 1; m.matrixAutoUpdate = false; m.name = 'baked-shadows';
    parent.add(m);
  }

  // Pist + taksi yolları + apronlar + işaretler + levhalar + ışıklar (runway.js / airfield.js).
  // Havaalanının yerel çerçevesindeki bir gruba eklenir (sivilde grup döndürülmüştür).
  buildAirportSurfaces(ap, parent, extraLights = []) {
    const q = this.quality;
    if (!this._paveTex) {
      this._paveTex = this.track(makePavementTexture(512, { base: 94 }));
      this._taxiTex = this.track(makePavementTexture(512, { base: 86, contrast: 1.15 }));
      this._concTex = this.track(makeConcreteTexture(512));
      for (const t of [this._paveTex, this._taxiTex, this._concTex]) t.anisotropy = q.anisotropy;
      this.runwayLayouts = {};
    }
    const rw = buildRunway({
      length: ap.rwy.len, width: ap.rwy.w, standard: ap.markings, tdzPattern: ap.tdzPattern, centerlineW: 0.9,
      ends: [{ text: ap.desig.a.num, suffix: ap.desig.a.suffix, pad: ap.rwy.pad }, { text: ap.desig.b.num, suffix: ap.desig.b.suffix, pad: ap.rwy.pad }],
      pavementMap: this._paveTex, shadows: q.shadows,
    });
    parent.add(rw.group);
    rw.disposables.forEach((d) => this.track(d));
    const af = buildAirfield(AIRFIELD_PLANS[ap.id], { asphaltMap: this._taxiTex, concreteMap: this._concTex, shadows: q.shadows, holdDist: 90, runwayLabel: ap.marks });
    parent.add(af.group);
    af.disposables.forEach((d) => this.track(d));
    const pts = buildLightPoints([...rw.lights, ...af.lights, ...extraLights]);
    parent.add(pts);
    this.track(pts.geometry); this.track(pts.material);
    this.runwayLayouts[ap.id] = rw.layout;
    return pts;
  }

  buildAirbase() {
    const A = AIRBASE;
    const q = this.quality;
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
    const tw = A.taxiwayWidth;
    const y = 0.09;
    const ap = A.apron;
    const t = A.tower, wt = A.waterTower, rd = A.radar;
    // Kaplama, pist işaretleri, taksi yolu işaretleri, levhalar ve ışıklar: ortak kurucu.
    // Engel ışıkları (kırmızı, çok yönlü) aynı ışık nesnesine eklenir: tek çizim çağrısı.
    const red = LIGHT_COLORS.RED;
    this.runwayLights = this.buildAirportSurfaces(AIRPORT_BY_ID.base, base, [
      { x: t.x + 5.8 * 0.45, y: t.h + 14.2, z: t.z, colA: red }, { x: wt.x, y: 33, z: wt.z, colA: red }, { x: rd.x, y: 24, z: rd.z, colA: red },
    ]);

    // Apron işaretleri (sarı): apron taksi şeridi, park yerleri, sığınak giriş çizgileri.
    // Taksi yolu ve pist işaretleri airfield.js / runway.js'tedir.
    const yellowMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe2b72e, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    const yellow = [];
    yellow.push(flat(ap.x1 - ap.x0 - 40, 0.3, 0, 300, 0.035));
    for (const p of A.parking) { yellow.push(flat(0.3, 40, p.x, p.z + 10, 0.036)); yellow.push(flat(24, 0.3, p.x, p.z - 6, 0.036)); }
    // HAS giriş çizgisi: sığınağın içinden HAS şeridinin orta çizgisine kadar
    for (const s of A.has) { const z0 = s.z - 10, z1 = A.hasLaneZ; yellow.push(flat(0.3, z1 - z0, s.x, (z0 + z1) / 2, 0.035)); }
    base.add(new THREE.Mesh(this.track(mergeGeometries(yellow, false)), yellowMat));

    // Hangarlar: kemerli çatı + duvarlar oluklu metal kaplama, ön/arka alın duvarı panel dokusu,
    // büyük sürgülü kapı. (Eskiden tüm yüzeyler tek doku ve 4x288 kez tekrarlanan UV ile çiziliyordu.)
    const wallTex = this.track(makeHangarWallTexture(512));
    const wallMat = this.track(new THREE.MeshStandardMaterial({ map: wallTex, color: 0xd9d6cf, roughness: 0.85, metalness: 0.0 }));
    const cladTex = this.track(makeCladdingTexture(256)); cladTex.anisotropy = q.anisotropy;
    const cladMat = this.track(new THREE.MeshStandardMaterial({ map: cladTex, color: 0xa9b0b4, roughness: 0.55, metalness: 0.35 }));
    const roofMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6f757b, roughness: 0.9, metalness: 0.0 }));
    const doorTex = this.track(makeHangarDoorTexture(512, 256));
    const doorMat = this.track(new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.8, metalness: 0.0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const facTex = this.track(makeFacadeTexture('industrial', 256)); facTex.anisotropy = q.anisotropy;
    const plainMat = this.track(new THREE.MeshStandardMaterial({ map: facTex, color: 0xe4e0d6, roughness: 0.85, metalness: 0.05 }));
    const towerConcMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeConcreteTexture(256)), color: 0xe2dfd6, roughness: 0.88, metalness: 0.0 }));
    const darkMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.7, metalness: 0.3 }));
    const hasTex = this.track(makeConcreteTexture(512)); hasTex.anisotropy = q.anisotropy;
    const hasMat = this.track(new THREE.MeshStandardMaterial({ map: hasTex, color: 0xb3b0a6, roughness: 0.96, metalness: 0.0 }));
    const sDoorMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeShelterDoorTexture(256, 128)), roughness: 0.7, metalness: 0.45, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const hangarGeos = [], cladGeos = [], roofGeos = [], doorGeos = [], plainGeos = [], hasGeos = [], sDoorGeos = [], towerGeos = [], darkGeos = [];
    for (const h of A.hangars) {
      const shape = new THREE.Shape();
      shape.moveTo(-h.w / 2, 0); shape.lineTo(h.w / 2, 0); shape.lineTo(h.w / 2, h.h);
      shape.absellipse(0, h.h, h.w / 2, h.arch, 0, Math.PI, false); shape.lineTo(-h.w / 2, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h.d, bevelEnabled: false, curveSegments: 14 });
      geo.translate(h.x, 0, h.z - h.d / 2);
      const [caps, sides] = splitGroups(geo, [1 / 18, 1 / 4]);
      geo.dispose();
      hangarGeos.push(...caps); cladGeos.push(...sides);
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
    // HAS (korumalı uçak sığınağı): eliptik beton tonoz (dokulu, metre ölçekli UV), önde kalın
    // beton portal kemeri, sürgülü çelik kapı (nervürlü, eşik bandı), arkada egzoz bacası.
    for (const s of A.has) {
      const a = s.w / 2, b = s.h;
      const g = new THREE.CylinderGeometry(a, a, s.d, 18, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2);
      g.scale(1, b / a, 1);
      { const uv = g.attributes.uv; const per = Math.PI * (a + b) / 2; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * per / 9, uv.getY(i) * s.d / 9); }
      g.translate(s.x, 0, s.z);
      hasGeos.push(g.index ? g.toNonIndexed() : g);
      // Portal: dış elips - iç elips halka profili, 1,6 m derinlikte
      const ring = [];
      for (let i = 0; i <= 18; i++) { const t = Math.PI * (1 - i / 18); ring.push(new THREE.Vector2(Math.cos(t) * (a + 1.3), Math.sin(t) * (b + 1.0))); }
      for (let i = 0; i <= 18; i++) { const t = Math.PI * (i / 18); ring.push(new THREE.Vector2(Math.cos(t) * a, Math.sin(t) * b)); }
      const pg = new THREE.ExtrudeGeometry(new THREE.Shape(ring), { depth: 1.6, bevelEnabled: false, curveSegments: 1 });
      { const uv = pg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 9, uv.getY(i) / 9); }
      pg.translate(s.x, 0, s.z + s.d / 2 - 0.6);
      hasGeos.push(pg.index ? pg.toNonIndexed() : pg);
      const back = new THREE.BoxGeometry(s.w + 2, s.h, 2); boxUVScale(back, s.w + 2, s.h, 2, 9, 9); back.translate(s.x, s.h / 2, s.z - s.d / 2); hasGeos.push(back);
      const stack = new THREE.BoxGeometry(2.4, 3.2, 2.4); boxUVScale(stack, 2.4, 3.2, 2.4, 9, 9); stack.translate(s.x, s.h + 0.6, s.z - s.d / 2 + 4); hasGeos.push(stack);
      // Çelik kapı: iki kanat, açıklığın önünde (tonoz eğrisi içinde kalır)
      const dw = s.w * 0.70, dh = b * Math.sqrt(1 - Math.pow(dw / 2 / a, 2)) - 0.4;
      const door = new THREE.BoxGeometry(dw, dh, 0.5); door.translate(s.x, dh / 2, s.z + s.d / 2 + 0.45);
      sDoorGeos.push(door);
    }
    // HQ binası (pencereli), kule, yakıt tankları, su kulesi, radar
    const winTex = this.track(makeWindowsTexture(512, 256, 14, 3));
    const hqMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const hqGeo = new THREE.BoxGeometry(A.hq.w, A.hq.h, A.hq.d);
    { const uv = hqGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i)); }
    hqGeo.translate(A.hq.x, A.hq.h / 2, A.hq.z);
    base.add(new THREE.Mesh(this.track(hqGeo), hqMat));
    // Kontrol kulesi: kare beton gövde, dışa eğimli cam kabin, alt operasyon binası
    const glassTex = this.track(makeTowerGlassTexture(256, 64));
    const glassMat = this.track(new THREE.MeshStandardMaterial({ map: glassTex, roughness: 0.12, metalness: 0.6, envMapIntensity: 1.3, side: THREE.DoubleSide }));
    {
      const T = controlTowerGeos({ h: t.h, shaft: 4.6, cab: 5.8, square: true });
      for (const g of T.conc) { g.translate(t.x, 0, t.z); towerGeos.push(g.index ? g.toNonIndexed() : g); }
      // Alt operasyon binası: pencereli cephe (metre ölçekli UV)
      const ob = new THREE.BoxGeometry(30, 8, 16);
      { const uv = ob.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2.5, uv.getY(i) * 0.75); }
      ob.translate(t.x + 16, 4, t.z + 6);
      base.add(new THREE.Mesh(this.track(ob), hqMat));
      const obRoof = new THREE.BoxGeometry(31, 0.5, 17); obRoof.translate(t.x + 16, 8.25, t.z + 6); roofGeos.push(obRoof);
      for (const g of T.dark) { g.translate(t.x, 0, t.z); darkGeos.push(g.index ? g.toNonIndexed() : g); }
      const gm = T.glass[0]; gm.translate(t.x, 0, t.z);
      const cab = new THREE.Mesh(this.track(gm), glassMat); cab.castShadow = false; base.add(cab);
    }
    const tankMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd9d9d2, roughness: 0.6, metalness: 0.1 }));
    const tankGeos = [];
    for (const f of A.fuel) { const g = new THREE.CylinderGeometry(f.r, f.r, f.h, 18); g.translate(f.x, f.h / 2, f.z); tankGeos.push(g); }
    // Su kulesi
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { const leg = new THREE.CylinderGeometry(0.35, 0.45, 22, 6); leg.translate(wt.x + dx, 11, wt.z + dz); tankGeos.push(leg); }
    const tank = new THREE.CylinderGeometry(7, 5, 8, 16); tank.translate(wt.x, 26, wt.z); tankGeos.push(tank);
    const tankTop = new THREE.ConeGeometry(7, 2.5, 16); tankTop.translate(wt.x, 31.2, wt.z); tankGeos.push(tankTop);
    // Radar kubbesi
    const rTower = new THREE.CylinderGeometry(3, 4, 12, 10); rTower.translate(rd.x, 6, rd.z); towerGeos.push(rTower);
    const dome = new THREE.SphereGeometry(6.5, 18, 12); dome.translate(rd.x, 17, rd.z); tankGeos.push(dome);
    // Rüzgar tulumu: direk sabit, tulum gerçek rüzgar yönüne döner (setWind ile güncellenir)
    const pole = new THREE.CylinderGeometry(0.12, 0.15, 8, 6); pole.translate(-1600, 4, 120); darkGeos.push(pole);
    const sockPivot = new THREE.Group();
    sockPivot.position.set(-1600, 7.8, 120);
    const sock = new THREE.ConeGeometry(0.6, 3.2, 8); sock.rotateZ(-Math.PI / 2); sock.translate(1.7, 0, 0);
    sockPivot.add(new THREE.Mesh(this.track(sock), this.track(new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.9, side: THREE.DoubleSide }))));
    base.add(sockPivot);
    this.windsock = sockPivot;
    // (Nizamiye buildBaseDetails içinde: nöbetçi kulübesi, sundurma, bariyerler)
    // Depolar (üs)
    for (const [x, z, w, d, h] of [[-1100, 620, 40, 20, 7], [-1160, 620, 40, 20, 7], [-1100, 660, 40, 20, 7], [1180, 420, 30, 18, 6], [1180, 470, 30, 18, 6]]) {
      const g = boxUVScale(new THREE.BoxGeometry(w, h, d), w, h, d); g.translate(x, h / 2, z); plainGeos.push(g);
      const rf = new THREE.BoxGeometry(w + 0.8, 0.5, d + 0.8); rf.translate(x, h + 0.25, z); roofGeos.push(rf);
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
    addMerged(cladGeos, cladMat);
    addMerged(doorGeos, doorMat, false);
    addMerged(roofGeos, roofMat);
    addMerged(hasGeos, hasMat);
    addMerged(sDoorGeos, sDoorMat, false);
    addMerged(plainGeos, plainMat);
    addMerged(towerGeos, towerConcMat);
    addMerged(darkGeos, darkMat, false);
    addMerged(tankGeos, tankMat);

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
      console.warn('Could not build parked aircraft', e);
    }

    // Araçlar (basit kutular): HQ otoparkında ve kasaba sokaklarının kenarında park halinde.
    // (Eskiden kasaba çevresine rastgele konum ve yönle dağıtılıyordu: tarlaların ve evlerin
    // ortasında araçlar.)
    const m4 = new THREE.Matrix4();
    const carGeo = this.track(new THREE.BoxGeometry(4.4, 1.5, 1.9));
    carGeo.translate(0, 0.75, 0);
    const carMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 }));
    const carPos = [];
    const rndc = mulberry32(88);
    for (let i = 0; i < 24; i++) carPos.push({ x: 912 + (i % 12) * 5.4, z: 506 + Math.floor(i / 12) * 12, r: Math.PI / 2 });
    const streets = TOWN_STREETS.filter((r) => r.town === TOWN);
    for (let i = 0, tries = 0; i < 40 && tries < 400; tries++) {
      const S = streets[Math.floor(rndc() * streets.length)];
      const k = Math.floor(rndc() * (S.pts.length - 1)), f = rndc();
      const [ax, az] = S.pts[k], [bx, bz] = S.pts[k + 1];
      const L = Math.hypot(bx - ax, bz - az); if (L < 8) continue;
      const tx = (bx - ax) / L, tz = (bz - az) / L, side = rndc() < 0.5 ? -1 : 1, off = S.w / 2 + 1.4;
      const x = ax + (bx - ax) * f - tz * side * off, z = az + (bz - az) * f + tx * side * off;
      if (this.houses && this.houses.some((h) => Math.hypot(h.x - x, h.z - z) < h.r + 2.5)) continue;
      carPos.push({ x, z, r: Math.atan2(-tz, tx) });
      i++;
    }
    const cars = new THREE.InstancedMesh(carGeo, carMat, carPos.length);
    const cc = new THREE.Color();
    carPos.forEach((c, i) => {
      const yy = this.surfaceHeight(c.x, c.z);
      m4.compose(new THREE.Vector3(c.x, yy + 0.32, c.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r), new THREE.Vector3(1, 1, 1));
      cars.setMatrixAt(i, m4);
      cc.setHSL(rndc(), 0.4, 0.35 + rndc() * 0.4); cars.setColorAt(i, cc);
    });
    cars.instanceMatrix.needsUpdate = true; if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
    base.add(cars);
    // Pişmiş gölgeler: hangarlar (kemer tepesi ~%70), güneşlikler, HAS tonozları, kule, HQ, depolar,
    // yakıt tankları, su kulesi. Bu yapılar gerçek zamanlı gölge geçişine girmez (çift gölge olmaz,
    // gölge haritası çizimi de hafifler).
    const sh = [];
    for (const h of A.hangars) sh.push({ x: h.x, z: h.z, w: h.w, d: h.d, h: h.h + h.arch * 0.7 });
    for (const s2 of A.shelters) sh.push({ x: s2.x, z: s2.z, w: s2.w, d: s2.d, h: s2.h });
    for (const s2 of A.has) sh.push({ x: s2.x, z: s2.z, w: s2.w * 0.86, d: s2.d, h: s2.h * 0.8 });
    sh.push({ x: t.x, z: t.z, w: 8, d: 8, h: t.h + 5 }, { x: t.x + 16, z: t.z + 6, w: 30, d: 16, h: 8 });
    sh.push({ x: A.hq.x, z: A.hq.z, w: A.hq.w, d: A.hq.d, h: A.hq.h });
    for (const [x, z, w, d, hh] of [[-1100, 620, 40, 20, 7], [-1160, 620, 40, 20, 7], [-1100, 660, 40, 20, 7], [1180, 420, 30, 18, 6], [1180, 470, 30, 18, 6]]) sh.push({ x, z, w, d, h: hh });
    for (const f of A.fuel) sh.push({ x: f.x, z: f.z, w: f.r * 1.7, d: f.r * 1.7, h: f.h });
    sh.push({ x: wt.x, z: wt.z, w: 10, d: 10, h: 30 }, { x: rd.x, z: rd.z, w: 9, d: 9, h: 20 });
    this.addStaticShadows(base, sh, null);
    base.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.castShadow && o.name !== 'runway-markings') o.castShadow = false; });
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
    const flatY = (w, d, x, z) => { const g = new THREE.PlaneGeometry(w, d); g.rotateX(-Math.PI / 2); g.translate(x, 0.1, z); return g; };

    // --- Çevre çiti: dikdörtgen (kapı boşlukları hariç)
    const F = BASE_FENCE;
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
    // --- Servis yolları (çit içinde): tek ağ + kavşak dolguları (bkz. BASE_ROADS).
    // Diğer yollarla aynı atlas ve katman düzeni: kesişen yolların kavşakları dolgu diskleriyle
    // kapanır (kırık kavşak ya da üst üste binen şerit yok).
    {
      // Üs düzlüğü tamamen düz: yollar arazinin 12 cm üstünde yeterli (kırsal yollarda uzak LOD için 30 cm)
      const geos = BASE_ROADS.map((r) => this.roadGeometry(r.pts, r.w, 0.12, -Infinity, r.w >= 8 ? 1.6 : 1.1));
      const mesh = new THREE.Mesh(this.track(mergeGeometries(geos.map(ni), false)), this.roadMats.base);
      geos.forEach((g) => g.dispose());
      grp.add(mesh);
      const J = this.findJunctions(BASE_ROADS.map((r) => ({ pts: r.pts, w: r.w + 1.5 })));
      if (J.length) {
        const pads = J.map((j) => this.junctionPad(j.x, j.z, j.r, 0.16));
        grp.add(new THREE.Mesh(this.track(mergeGeometries(pads.map((g) => g.toNonIndexed()), false)), this.roadMats.pad));
        pads.forEach((g) => g.dispose());
      }
      this.baseJunctions = J.length;
    }

    // --- Servis binaları: bakım atölyeleri, filo binası, kışla/yemekhane, jeneratör binası
    const winTex = this.track(makeWindowsTexture(512, 256, 12, 2));
    const winMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const winGeos = [];
    // Atölye/depo/jeneratör binaları sanayi cephe dokusunu (metre ölçekli UV) kullanır;
    // eskiden dokusuz bej kutulardı.
    const facTex = this.track(makeFacadeTexture('industrial', 256)); facTex.anisotropy = q.anisotropy;
    const facMat = this.track(new THREE.MeshStandardMaterial({ map: facTex, color: 0xe0dcd2, roughness: 0.85, metalness: 0.05 }));
    const facGeos = [];
    let building = (x, z, w, d, h, rot = 0, mat = 'win') => {
      const g = new THREE.BoxGeometry(w, h, d);
      if (mat === 'win') { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.max(1, Math.round(w / 12)), uv.getY(i) * Math.max(1, Math.round(h / 7))); }
      else boxUVScale(g, w, h, d);
      g.rotateY(rot); g.translate(x, h / 2, z);
      (mat === 'win' ? winGeos : facGeos).push(ni(g));
      addBox(x, z, Math.abs(Math.cos(rot)) * w + Math.abs(Math.sin(rot)) * d, Math.abs(Math.sin(rot)) * w + Math.abs(Math.cos(rot)) * d, h);
      const roof = new THREE.BoxGeometry(w + 0.6, 0.4, d + 0.6); roof.rotateY(rot); roof.translate(x, h + 0.2, z); concGeos.push(ni(roof));
    };
    const detailShadows = [];
    const building0 = building;
    building = (x, z, w, d, h, rot = 0, mat = 'win') => { detailShadows.push({ x, z, w, d, h, rot }); building0(x, z, w, d, h, rot, mat); };
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
    // Kapılar kuzey yüzde, hangar yoluna dönük (eskiden duvarın 1 cm içinde, görünmez durumdaydı)
    for (const [x, z] of [[-820, 853], [-780, 893]]) { const d = new THREE.PlaneGeometry(8, 5); d.rotateY(Math.PI); d.translate(x, 2.5, z - 0.03); doorGeos.push(d); }
    grp.add(new THREE.Mesh(this.track(mergeGeometries([...doorGeos, ...gateSigns], false)), doorMat));

    // --- Yakıt sahası: set duvarı, pompa adası, borular
    const fuelC = [-992, 395];
    // Set duvarı: kuzeyde (servis yolu) ve doğuda (apron yolu) 12 m'lik kapı açıklıkları
    const fw = [[130, 1.2, fuelC[0], fuelC[1] - 55], [1.2, 110, fuelC[0] - 65, fuelC[1]]];
    const nx0 = fuelC[0] - 65, nx1 = fuelC[0] + 65, gx = -990;
    fw.push([gx - 6 - nx0, 1.2, (nx0 + gx - 6) / 2, fuelC[1] + 55], [nx1 - (gx + 6), 1.2, (gx + 6 + nx1) / 2, fuelC[1] + 55]);
    const ez0 = fuelC[1] - 55, ez1 = fuelC[1] + 55;
    fw.push([1.2, 395 - 6 - ez0, fuelC[0] + 65, (ez0 + 389) / 2], [1.2, ez1 - 401, fuelC[0] + 65, (401 + ez1) / 2]);
    for (const [w, d, x, z] of fw) {
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

    // (Pist ucu jet sapıtıcıları kaldırıldı: yaklaşma ışıklarının ve pist ucu emniyet alanının
    // içinde, süzülüş hattında 4 m'lik bir engel oluşturuyorlardı. Taksi yolu levhaları ve pist
    // bekleme çizgileri artık airfield.js'tedir: doğru konum (pist ekseninden 90 m), ICAO desen A.)

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
      list = list.filter(([x, z]) => baseRoadDist(x, z) > 2.5);   // yol üstünde araç bırakma
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, vehMat, list.length);
      list.forEach(([x, z, rot], i) => { p.set(x, terrainHeight(x, z) + 0.05, z); qu.setFromAxisAngle(yAxis, rot); m4.compose(p, qu, sc); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true; im.computeBoundingSphere(); im.castShadow = q.shadows && q.shadowMap >= 2048;
      grp.add(im);
    };
    const humvees = [], trucks = [], tankers = [], fires = [], gpus = [], containers = [], containersTan = [];
    for (let i = 0; i < 6; i++) humvees.push([A.hq.x - 64 + i * 6, 512, Math.PI / 2]);
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
    for (const [x, z, w, d] of [[A.hq.x - 30, 512, 90, 24], [-1250, 885, 40, 22], [1480, 905, 60, 20], [-300, 1000 + 8, 60, 16]]) lotGeos.push(flatY(w, d, x, z));
    grp.add(new THREE.Mesh(this.track(mergeGeometries(lotGeos, false)), asph));
    const lotMarkMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -7 }));
    const lotMarkGeos = [];
    for (const [x, z, w, d] of [[A.hq.x - 30, 512, 90, 24], [-1250, 885, 40, 22], [1480, 905, 60, 20], [-300, 1000 + 8, 60, 16]]) {
      for (let sx = -w / 2 + 2; sx <= w / 2 - 2; sx += 2.7) { lotMarkGeos.push(flatY(0.12, d * 0.42, x + sx, z - d * 0.27)); lotMarkGeos.push(flatY(0.12, d * 0.42, x + sx, z + d * 0.27)); }
    }
    grp.add(new THREE.Mesh(this.track(mergeGeometries(lotMarkGeos, false)), lotMarkMat));
    const poleGeo = this.track(new THREE.CylinderGeometry(0.15, 0.2, 9, 6)); poleGeo.translate(0, 4.5, 0);
    let poleList = [];
    for (let x = -1900; x <= 1900; x += 200) poleList.push([x, A.gateZ - 26]);
    for (let z = -700; z <= 900; z += 200) { poleList.push([F.x0 + 26, z]); poleList.push([F.x1 - 26, z]); }
    for (let x = -600; x <= 600; x += 150) poleList.push([x, 780]);
    poleList = poleList.filter(([x, z]) => baseRoadDist(x, z) > 2);
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
        list = list.filter(([x, z]) => baseRoadDist(x, z) > 4.5);   // ağaç gövdesi yolda kalmasın
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
      bushes.splice(0, bushes.length, ...bushes.filter(([x, z]) => baseRoadDist(x, z) > 2.5));
      const bim = new THREE.InstancedMesh(bushGeo, bushMat, bushes.length);
      bushes.forEach(([x, z, s2], i) => { p.set(x, terrainHeight(x, z), z); sc.set(s2, s2 * 0.8, s2); qu.identity(); m4.compose(p, qu, sc); bim.setMatrixAt(i, m4); });
      sc.set(1, 1, 1);
      bim.instanceMatrix.needsUpdate = true; bim.computeBoundingSphere();
      grp.add(bim);
    }

    // Birleştirilmiş sabit geometriler
    const addMerged = (geos, mat) => { if (!geos.length) return; for (const g of geos) if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); const mm = new THREE.Mesh(this.track(mergeGeometries(geos, false)), mat); mm.castShadow = q.shadows; mm.receiveShadow = q.shadows; grp.add(mm); };
    addMerged(plainGeos, plain); addMerged(redGeos, redWhite); addMerged(whiteGeos, white); addMerged(concGeos, concrete); addMerged(winGeos, winMat); addMerged(facGeos, facMat);
    // Servis binaları ve mühimmat iglolarının pişmiş gölgeleri
    for (let k = 0; k < 5; k++) detailShadows.push({ x: -1750 + k * 90, z: -700, w: 16, d: 22, h: 4.5 });
    this.addStaticShadows(grp, detailShadows, null);
    for (const o of grp.children) if (o.isMesh && !o.isInstancedMesh) o.castShadow = false;
    this.group.add(grp);
  }

  heightAt(x, z) { return terrainHeight(x, z); }

  // Çarpışma sorgusu uzamsal karma ızgara üzerinden yapılır. Doğrusal tarama, şehir
  // eklendikten sonra 120 Hz'de binlerce kutuyu gezerdi; ızgarada yalnızca sorgunun
  // örttüğü hücrelerdeki kutulara bakılır.
  buildCollisionGrid() {
    const CELL = 260;
    const grid = new Map();
    const key = (i, j) => i * 100003 + j;
    const add = (b) => {
      const i0 = Math.floor(b.minX / CELL), i1 = Math.floor(b.maxX / CELL);
      const j0 = Math.floor(b.minZ / CELL), j1 = Math.floor(b.maxZ / CELL);
      for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        const k = key(i, j);
        let a = grid.get(k);
        if (!a) { a = []; grid.set(k, a); }
        a.push(b);
      }
    };
    for (const b of this.buildingBoxes) add(b);
    for (const b of this.townBoxes) add(b);
    this.colGrid = grid; this.colCell = CELL; this.colKey = key;
    this.colBoxCount = this.buildingBoxes.length + this.townBoxes.length;
  }

  hitsBuilding(x, y, z, r = 3) {
    if (!this.colGrid) this.buildCollisionGrid();
    const CELL = this.colCell, key = this.colKey;
    const i0 = Math.floor((x - r) / CELL), i1 = Math.floor((x + r) / CELL);
    const j0 = Math.floor((z - r) / CELL), j1 = Math.floor((z + r) / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const cell = this.colGrid.get(key(i, j));
        if (!cell) continue;
        for (const b of cell) {
          if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y - r < b.maxY && y + r > b.minY && (!b.test || b.test(x, z, r))) return true;
        }
      }
    }
    return false;
  }

  /**
   * Doğru parçası (p0 -> p1) ile yapı kutularının ilk kesişimi: kesir t (0..1) ya da -1.
   * Füze çarpışması için süpürülmüş test: parçanın XZ kutusunun örttüğü ızgara hücrelerindeki
   * kutulara yarık (slab) testi uygulanır; hızlı füze ince bir yapının içinden geçip kaçamaz.
   */
  segmentHit(p0, p1) {
    if (!this.colGrid) this.buildCollisionGrid();
    const CELL = this.colCell, key = this.colKey;
    const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
    const i0 = Math.floor(Math.min(p0.x, p1.x) / CELL), i1 = Math.floor(Math.max(p0.x, p1.x) / CELL);
    const j0 = Math.floor(Math.min(p0.z, p1.z) / CELL), j1 = Math.floor(Math.max(p0.z, p1.z) / CELL);
    let best = -1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const cell = this.colGrid.get(key(i, j));
      if (!cell) continue;
      for (const b of cell) {
        let t0 = 0, t1 = 1, ok = true;
        for (const [o, d, lo, hi] of [[p0.x, dx, b.minX, b.maxX], [p0.y, dy, b.minY, b.maxY], [p0.z, dz, b.minZ, b.maxZ]]) {
          if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) { ok = false; break; } continue; }
          let a = (lo - o) / d, c = (hi - o) / d;
          if (a > c) { const t = a; a = c; c = t; }
          if (a > t0) t0 = a;
          if (c < t1) t1 = c;
          if (t0 > t1) { ok = false; break; }
        }
        // Ayak izi çokgenli yapı (meydan binaları): kutu içindeki aralıkta çokgen testi (≈2 m adım);
        // eğik binanın kutusundaki boşluk isabet sayılmaz
        if (ok && b.test) {
          const L = Math.hypot(dx, dz) * (t1 - t0), n = Math.max(1, Math.ceil(L / 2));
          let hit = -1;
          for (let k = 0; k <= n; k++) {
            const t = t0 + (t1 - t0) * k / n;
            if (b.test(p0.x + dx * t, p0.z + dz * t, 0.5)) { hit = t; break; }
          }
          if (hit < 0) ok = false; else t0 = hit;
        }
        if (ok && (best < 0 || t0 < best)) best = t0;
      }
    }
    return best;
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

  // ---- Bölgeden bağımsız dünya arayüzü (gerçek dünya bölgesi de aynı yöntemleri sağlar) ----
  get regionId() { return 'training'; }
  get spawns() { return SPAWNS; }
  get airportById() { return AIRPORT_BY_ID; }
  /** Kamera uzak düzlemi (m): kurgusal harita 72 km. */
  get cameraFar() { return 60000; }
  spawnPose(id) { return spawnPose(id); }
  surfaceTypeAt(x, z) { return surfaceTypeAt(x, z); }

  update(dt, camera, aircraftPos) {
    this.time += dt;
    this.updateSun(camera, aircraftPos);
    this.updateLayers(dt, camera);
  }

  /** Gök kubbesi kamerayı izler; güneş/gölge kamerası uçağın çevresinde, doku ızgarasına hizalı. */
  updateSun(camera, aircraftPos) {
    this.sky.position.copy(camera.position);
    // Gölge kamerası: hedefi ışık uzayında doku hücresi (texel) ızgarasına yuvarla -> düz yüzeylerde gölge "yüzmesi" olmaz
    const target = this._shadowTarget || (this._shadowTarget = new THREE.Vector3());
    target.copy(aircraftPos);
    this.applyShadowExtent(camera.position.distanceTo(aircraftPos));
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
  }

  updateLayers(dt, camera) {
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    // Tüm mesafe eşiklerinde histerezis: eşik üzerinde duran kamerada kare kare açılıp kapanma (titreme) olmaz.
    // Görünürse eşik + bant'a kadar açık kalır, gizliyse ancak eşik - bant'ta açılır.
    const band = (visible, x, t, b) => (visible ? x < t + b : x < t - b);
    // Ağaç parçaları
    const detail = this.perf ? this.perf.detail : 1;
    const td = this.quality.treeDistance * detail;
    for (const c of this.treeChunks) {
      const d = Math.hypot(c.center.x - cx, c.center.z - cz) - c.radius;
      c.mesh.visible = band(c.mesh.visible, d, td, 250);
    }
    // Kasaba evleri: uzakta piksel altı kalır (arazi gölgelendiricisi yerleşim zeminini gösterir)
    // 3B mesafe: yüksekten bakınca 9 m'lik evler piksel altında kalır (ağaçlar daha erken kapanır)
    if (this.townMeshes) for (const t of this.townMeshes) t.mesh.visible = band(t.mesh.visible, Math.hypot(t.x - cx, t.z - cz, cy) - t.r, (t.trees ? 4800 : 7500) * detail, 300);
    // Arazi LOD (histerezisli: sınırda ileri geri geçiş yok)
    const l1 = this.quality.lod[0] * detail;
    const half = (this.terrainChunkSize || MAP_SIZE / 18) * 0.71;   // parça yarı köşegeni
    const lodBand = l1 * 0.07;
    for (const ch of this.terrainChunks) {
      const d = Math.max(0, Math.hypot(ch.center.x - cx, ch.center.z - cz) - half);
      const lod = ch.lod === 0 ? (d > l1 + lodBand ? 1 : 0) : (d < l1 - lodBand ? 0 : 1);
      if (lod !== ch.lod) { ch.meshes[ch.lod].visible = false; ch.meshes[lod].visible = true; ch.lod = lod; }
    }
    this.waterUniforms.time.value = this.time;
    WATER_OPTICS.uWTime.value = this.time;
    // Üs ışıkları ve tel örgü: uzakta piksel altı kalıp parıldadıkları için 3B mesafeye göre kapatılır
    const baseDist = Math.hypot(cx, cy, cz);
    const fx = this.perf ? this.perf.effects : 1;
    // Pist ışıkları GL noktalarıdır (en az ~2 piksel, gölgelendiricide uzaklıkla söner): ucuzdur,
    // bu yüzden yaklaşmada pist uzaktan seçilebilsin diye 12 km'ye kadar açık kalır
    if (this.runwayLights) this.runwayLights.visible = band(this.runwayLights.visible, baseDist, 12000, 400);
    if (this.fenceMeshes) { const v = band(this.fenceMeshes[0].visible, baseDist, 2600 * fx, 200); for (const m of this.fenceMeshes) m.visible = v; }
    if (this.city) this.city.update(dt, camera.position);
    if (this.waterfront) this.waterfront.update(dt, camera.position);
    if (this.civilLights) {
      const d = Math.hypot(cx - this.civilCenter.x, cy - this.civilCenter.y, cz - this.civilCenter.z);
      this.civilLights.visible = band(this.civilLights.visible, d, 12000, 400);
    }
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.scene.remove(this.group);
  }
}

let ALL_ROAD_IDX = null;
function distToPolylineAny(x, z) {
  if (!ALL_ROAD_IDX) ALL_ROAD_IDX = new SegIndex([...ROADS, ...TOWN_STREETS].map((r) => r.pts), 150, 400);
  return ALL_ROAD_IDX.dist(x, z);
}
export const __debug = { ROADS, TOWN_STREETS, BASE_ROADS, HAMLET };
