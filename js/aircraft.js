// F-35A Lightning II – tamamen kod ile üretilen, gerçek ölçekli model.
// Eksenler: burun -Z, üst +Y, sağ kanat +X. Uzunluk 15.7 m, açıklık 10.7 m, yükseklik 4.4 m.
import * as THREE from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeStealthPanelTexture, makeRoughnessTexture, makeMilInsigniaTexture, makeTextTexture, makeCockpitDisplayTexture, makeFlameNoiseTexture, makeGlowTexture, makeGearBayTexture, makeMacroNoiseTexture, makeStencilAtlas, STENCIL_ATLAS, makeStripLightTexture, makeStripGlowTexture } from './textures.js';
import { getLivery } from './liveries.js';

const DEG = Math.PI / 180;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const F35 = {
  length: 15.7, span: 10.7, height: 4.4,
  cgStation: 8.0,
  wheelBottomY: -2.25,
  noseGearZ: -4.3, mainGearZ: 0.8, mainGearX: 1.75,
  pilotEye: new THREE.Vector3(0, 1.26, -3.05),
};

function st(s) { return s - F35.cgStation; }

// Kanopi kesit profili [istasyon, yarı genişlik, yükseklik] (güverte üstü), süperelips
// üssü CANOPY_N. Kokpit içi parçalar bu profilden türetilen yüzeyle (canopySurfaceY)
// kırpılır: hiçbir köşe camdan ya da gövdeden dışarı taşamaz.
const CANOPY = [
  [3.0, 0.08, 0.02], [3.25, 0.30, 0.17], [3.55, 0.44, 0.37], [3.9, 0.52, 0.54], [4.3, 0.57, 0.69],
  [4.7, 0.59, 0.78], [5.1, 0.59, 0.80], [5.5, 0.57, 0.75], [5.9, 0.52, 0.60], [6.3, 0.43, 0.40], [6.65, 0.28, 0.17], [6.9, 0.10, 0.03],
];
const CANOPY_N = 2.3;

// Geometriye tek renkli köşe rengi özniteliği ekler (köşe renkli malzemelerle birleşik çizim)
function paintVC(g, hex) {
  const c = new THREE.Color(hex), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// ---------------------------------------------------------------------------
// Gövde kesit profilleri. Her profil: üst merkez -> chine -> alt köşe -> alt merkez (sağ yarı).
// yt: üst y, (xc,yc): chine, (xs,ys): yanak kontrol noktası (hava alığı şişkinliği),
// (xb,yb): alt köşe, ybot: alt merkez, nt: üst süperelips üssü, nb: alt süperelips üssü.
// Radom: TEĞET OJİV. Yarıçap r(s) = √(ρ² − (L−s)²) − ρ + R,  ρ = (R²+L²)/2R,
// L = 2.90 m radom boyu, R = 0.70 m taban yarıçapı. Ojiv uçta HIZLA genişler
// (r(0.15) zaten tabanın %11'i), bu yüzden burun küt ve yuvarlak görünür.
// Önceki tablo yalnızca 0 / 0.70 / 1.80 istasyonlarını tanımlıyordu ve aradaki
// smoothstep enterpolasyonunun uçta türevi sıfır olduğu için burun uzun, ince
// bir İĞNEye dönüşüyordu. Ara istasyonlar ojivden hesaplanarak eklendi.
const FORE_PROFILES = [
  [0.00, { yt: 0.013, xc: 0.017, yc: 0.001, xs: 0.015, ys: -0.006, xb: 0.009, yb: -0.011, ybot: -0.014, nt: 2.15, nb: 2.15, dk: 0.004 }],
  [0.15, { yt: 0.065, xc: 0.084, yc: 0.006, xs: 0.072, ys: -0.028, xb: 0.043, yb: -0.054, ybot: -0.066, nt: 2.15, nb: 2.15, dk: 0.004 }],
  [0.35, { yt: 0.145, xc: 0.188, yc: 0.014, xs: 0.161, ys: -0.062, xb: 0.095, yb: -0.121, ybot: -0.147, nt: 2.18, nb: 2.18, dk: 0.004 }],
  [0.70, { yt: 0.268, xc: 0.347, yc: 0.026, xs: 0.298, ys: -0.114, xb: 0.176, yb: -0.224, ybot: -0.272, nt: 2.2, nb: 2.2, dk: 0.004 }],
  [1.20, { yt: 0.408, xc: 0.529, yc: 0.040, xs: 0.455, ys: -0.174, xb: 0.268, yb: -0.341, ybot: -0.415, nt: 2.25, nb: 2.25, dk: 0.004 }],
  [1.80, { yt: 0.526, xc: 0.682, yc: 0.052, xs: 0.587, ys: -0.224, xb: 0.345, yb: -0.440, ybot: -0.535, nt: 2.3, nb: 2.3, dk: 0.004 }],
  [2.40, { yt: 0.593, xc: 0.768, yc: 0.058, xs: 0.661, ys: -0.253, xb: 0.389, yb: -0.496, ybot: -0.603, nt: 2.35, nb: 2.35, dk: 0.03 }],
  [2.90, { yt: 0.61, xc: 0.79, yc: 0.06, xs: 0.68, ys: -0.26, xb: 0.40, yb: -0.51, ybot: -0.62, nt: 2.4, nb: 2.4, dk: 0.10 }],
  [3.30, { yt: 0.635, xc: 0.85, yc: 0.055, xs: 0.73, ys: -0.27, xb: 0.44, yb: -0.57, ybot: -0.67, nt: 2.45, nb: 2.5, dk: 0.35 }],
  [3.60, { yt: 0.65, xc: 0.90, yc: 0.05, xs: 0.78, ys: -0.29, xb: 0.47, yb: -0.62, ybot: -0.72, nt: 2.5, nb: 2.6, dk: 0.49 }],
  [4.10, { yt: 0.67, xc: 0.97, yc: 0.03, xs: 0.88, ys: -0.33, xb: 0.49, yb: -0.68, ybot: -0.78, nt: 2.6, nb: 2.8, dk: 0.60 }],
  [4.50, { yt: 0.68, xc: 1.02, yc: 0.01, xs: 0.94, ys: -0.35, xb: 0.46, yb: -0.71, ybot: -0.80, nt: 2.6, nb: 3.0, dk: 0.63 }],
];
// Ana gövde: chine altındaki yan yüzey (hava alığı yanağı -> alt köşe) iki fasetli, orta karın düz;
// arka gövde motor yatağı etrafında yuvarlaklaşır.
const MAIN_PROFILES = [
  [5.00, { yt: 0.69, xc: 1.12, yc: 0.00, xs: 1.46, ys: -0.42, xb: 1.18, yb: -0.85, ybot: -0.92, nt: 2.6, nb: 3.2, dk: 0.64 }],
  [5.80, { yt: 0.73, xc: 1.26, yc: -0.02, xs: 1.54, ys: -0.47, xb: 1.22, yb: -0.90, ybot: -0.98, nt: 2.7, nb: 3.3, dk: 0.57 }],
  [6.60, { yt: 0.79, xc: 1.46, yc: -0.06, xs: 1.74, ys: -0.53, xb: 1.28, yb: -0.95, ybot: -1.02, nt: 2.8, nb: 3.4, dk: 0.35 }],
  [7.60, { yt: 0.83, xc: 1.66, yc: -0.10, xs: 1.92, ys: -0.57, xb: 1.33, yb: -0.99, ybot: -1.04, nt: 2.9, nb: 3.5, dk: 0.04 }],
  [8.80, { yt: 0.83, xc: 1.76, yc: -0.10, xs: 1.98, ys: -0.58, xb: 1.36, yb: -1.00, ybot: -1.05, nt: 2.9, nb: 3.5, dk: 0.004 }],
  [10.0, { yt: 0.77, xc: 1.76, yc: -0.10, xs: 1.92, ys: -0.56, xb: 1.32, yb: -0.96, ybot: -1.00, nt: 2.8, nb: 3.4, dk: 0.004 }],
  [11.2, { yt: 0.69, xc: 1.66, yc: -0.08, xs: 1.74, ys: -0.50, xb: 1.20, yb: -0.84, ybot: -0.88, nt: 2.7, nb: 3.0, dk: 0.004 }],
  [12.4, { yt: 0.64, xc: 1.52, yc: -0.05, xs: 1.52, ys: -0.40, xb: 1.02, yb: -0.68, ybot: -0.74, nt: 2.6, nb: 2.6, dk: 0.004 }],
  [13.4, { yt: 0.63, xc: 1.40, yc: -0.02, xs: 1.34, ys: -0.34, xb: 0.86, yb: -0.56, ybot: -0.64, nt: 2.5, nb: 2.2, dk: 0.004 }],
  [14.2, { yt: 0.62, xc: 1.26, yc: 0.00, xs: 1.16, ys: -0.28, xb: 0.72, yb: -0.48, ybot: -0.58, nt: 2.4, nb: 2.0, dk: 0.004 }],
  [14.6, { yt: 0.61, xc: 1.18, yc: 0.00, xs: 1.08, ys: -0.26, xb: 0.66, yb: -0.46, ybot: -0.56, nt: 2.4, nb: 2.0, dk: 0.004 }],
];

export function lerpProfile(table, s) {
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
// Alt yüzeyin (chine'den karın ortasına) verilen |x| için en alt y değeri (kapaklar, yuvalar, takım pivotları için)
export function bottomSurfaceY(s, x) {
  const pts = halfSection(profileAt(s));
  const ax = Math.abs(x);
  let best = Infinity;
  for (let i = 4; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
    if (ax < lo - 1e-6 || ax > hi + 1e-6) continue;
    const t = hi - lo < 1e-6 ? 0 : (ax - a.x) / (b.x - a.x);
    const y = a.y + (b.y - a.y) * Math.min(1, Math.max(0, t));
    if (y < best) best = y;
  }
  if (best !== Infinity) return best;
  // Kesitin en geniş noktasının dışı: silüet noktasına kenetlenir. Eskiden karın
  // ortası (ybot) döndürülüyordu ve dış kenarı buraya taşan parçalar (ana takım yuvası
  // kabuğu) gövde yanından ~0,45 m aşağı sarkan koyu bir kanat gibi görünüyordu.
  let wx = -Infinity, wy = profileAt(s).ybot;
  for (let i = 4; i < pts.length; i++) if (pts[i].x > wx) { wx = pts[i].x; wy = pts[i].y; }
  return wy;
}
// Gövde kaplamasının loft istasyonları (buildFuselage). Alt şerit 4.5'ten doğrudan 5.4'e geçer.
const FORE_S = [0.0, 0.10, 0.22, 0.35, 0.52, 0.7, 0.95, 1.2, 1.5, 1.8, 2.1, 2.4, 2.65, 2.9, 3.1, 3.3, 3.6, 3.85, 4.1, 4.3, 4.5];
// 7.0 ve 10.8: iç silah yuvası ağzının ön/arka kenarı (v3.2). Bu istasyonlar TÜM şeritlere
// eklenir (üst, yan, alt): kesik yalnızca alt şeritte olsa da şeritlerin ortak kenarlarında
// T-kavşağı (piksel çatlağı) oluşmaz.
const MAIN_S = [5.0, 5.4, 5.8, 6.2, 6.6, 7.0, 7.1, 7.6, 8.2, 8.8, 9.4, 10.0, 10.6, 10.8, 11.2, 11.8, 12.4, 12.9, 13.4, 13.8, 14.2, 14.6];
const HULL_S = [...FORE_S, ...MAIN_S.slice(1)];
// Panel dokusunun yeri değişmesin: loft UV'leri satır/sütun SIRASINDAN üretilir; yeni
// istasyon ve sütunlar eklenince doku kayardı. UV'ler eski dizideki kesirli sıraya göre verilir.
const MAIN_S_OLD = [5.0, 5.4, 5.8, 6.2, 6.6, 7.1, 7.6, 8.2, 8.8, 9.4, 10.0, 10.6, 11.2, 11.8, 12.4, 12.9, 13.4, 13.8, 14.2, 14.6];
function oldIdx(s, list) {
  if (s <= list[0]) return 0;
  for (let j = 0; j < list.length - 1; j++) if (s <= list[j + 1]) return j + (s - list[j]) / (list[j + 1] - list[j]);
  return list.length - 1;
}

// ---------------------------------------------------------------------------
// İç silah yuvası (her yanda bir). Ağız alt kaplamada |x| = x0..x1, s = s0..s1 dikdörtgenidir;
// iki kapak (iç: menteşe x0'da, dış: menteşe x1'de) xs çizgisinde birleşir. Tavan gövde
// ekseninde ceil yüksekliğindedir. AIM-120C taşıma konumu: eksen (mx, my), orta nokta ms.
// Fırlatıcı rayı (ejektör) füzeyi stroke kadar aşağı itip bırakır.
export const BAY = {
  x0: 0.10, x1: 1.10, xs: 0.60, gap: 0.0012, s0: 7.0, s1: 10.8, ceil: -0.40,
  mx: 0.60, my: -0.624, ms: 8.905, railY: -0.4875, stroke: 0.22, tilt: 6 * DEG,
};
export const MISSILE = { len: 3.65, r: 0.089, span: 0.447 };

// Efekt ışığı: füze ateşlemesi ve yakın patlamaların uçağı aydınlatması. Sahneye gerçek
// bir nokta ışığı EKLENMEZ (her malzeme yeniden derlenir ve mobilde her pikselin ışık
// döngüsü uzardı); boya, yuva içi, füze ve takım malzemelerinin gölgelendiricisine tek
// bir paylaşılan tekdüze değerle eklenir. Konum GÖRÜNÜŞ uzayındadır (weapons.js her kare).
export const FX_LIGHT = { uFxPos: { value: new THREE.Vector3() }, uFxCol: { value: new THREE.Color(0, 0, 0) }, uFxFall: { value: 0.08 } };
function addFxLight(sh) {
  Object.assign(sh.uniforms, FX_LIGHT);
  sh.fragmentShader = 'uniform vec3 uFxPos;\nuniform vec3 uFxCol;\nuniform float uFxFall;\n' + sh.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
  {
    vec3 fxL = uFxPos + vViewPosition;
    float fxD2 = dot(fxL, fxL);
    float fxN = max(dot(normal, fxL * inversesqrt(max(fxD2, 1e-4))), 0.0) * 0.85 + 0.15;
    reflectedLight.directDiffuse += BRDF_Lambert(diffuseColor.rgb) * uFxCol * (fxN / (1.0 + fxD2 * uFxFall));
  }`);
}
export function withFxLight(mat, key) {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => { if (prev && prev !== withFxLight._noop) prev(sh, r); addFxLight(sh); };
  mat.customProgramCacheKey = () => key;
  return mat;
}
withFxLight._noop = THREE.Material.prototype.onBeforeCompile;

// ---------------------------------------------------------------------------
// AIM-120C AMRAAM (iç yuvaya sığan kırpık kanatçıklı sürüm): 3,65 m, Ø178 mm, kanat ve kuyruk
// açıklığı ~447 mm, X düzeninde. Ekseni -z'dir (burun ileri), askı kulakları +y'de.
// Gövde döndürme yüzeyidir; bant renkleri (sarı = harp başlığı, kahverengi = roket motoru)
// keskin geçişli köşe renkleridir. Tek ağ, tek çizim çağrısı; yuvadaki ve uçan füzeler
// aynı geometri ve malzemeyi paylaşır.
// ---------------------------------------------------------------------------
const _tmpScale = new THREE.Vector3();
let MISSILE_GEO = null, MISSILE_MAT = null;
export function getMissileGeometry() {
  if (MISSILE_GEO) return MISSILE_GEO;
  const L = MISSILE.len, R = MISSILE.r, half = L / 2;
  const RADOME = 0xe2e4e6, BODY = 0xcdd1d5, YEL = 0xc8a22c, BRN = 0x75583a, AFT = 0x8d9297, NOZ = 0x2b2d30, FIN = 0xc3c7cb;
  // Profil: [yarıçap, burundan uzaklık, renk]. Aynı uzaklıkta iki halka = keskin renk geçişi.
  const P = [
    [0.0005, 0, 0xb9bdc2], [0.018, 0.025, RADOME], [0.04, 0.09, RADOME], [0.06, 0.18, RADOME], [0.075, 0.28, RADOME], [0.085, 0.38, RADOME], [R, 0.47, RADOME],
    [R, 0.47, BODY], [R, 0.62, BODY], [R, 0.62, YEL], [R, 0.675, YEL], [R, 0.675, BODY], [R, 2.0, BODY], [R, 2.0, BRN], [R, 2.055, BRN], [R, 2.055, BODY],
    [R, 3.48, BODY], [R, 3.48, AFT], [0.084, 3.58, AFT], [0.078, 3.63, AFT], [0.078, 3.63, NOZ], [0.066, 3.65, NOZ], [0.045, 3.6, NOZ], [0.0005, 3.6, NOZ],
  ];
  const SEG = 18;
  const pts = P.map(([r, d]) => new THREE.Vector2(r, half - d));
  const lathe = new THREE.LatheGeometry(pts, SEG);
  // Köşe renkleri: lathe köşeleri (segment başına profil sırası)
  {
    const n = lathe.attributes.position.count, a = new Float32Array(n * 3), c = new THREE.Color();
    for (let i = 0; i < n; i++) { c.setHex(P[i % P.length][2]); a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    lathe.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  lathe.rotateX(-Math.PI / 2);            // +y (burun) -> -z
  const parts = [lathe.toNonIndexed()];
  // Kanatçık: eksen düzleminde ince prizma. dLE0/dTE0 kök, dLE1/dTE1 uç (burundan uzaklık), rOut uç yarıçapı.
  const fin = (phi, dLE0, dTE0, dLE1, dTE1, rOut, t, hex) => {
    const u = new THREE.Vector3(Math.sin(phi), Math.cos(phi), 0), w = new THREE.Vector3(Math.cos(phi), -Math.sin(phi), 0);
    const P2 = (d, r) => new THREE.Vector3().addScaledVector(u, r).add(new THREE.Vector3(0, 0, d - half));
    const q = [P2(dLE0, R * 0.95), P2(dLE1, rOut), P2(dTE1, rOut), P2(dTE0, R * 0.95)];
    const top = q.map((p) => p.clone().addScaledVector(w, t / 2)), bot = q.map((p) => p.clone().addScaledVector(w, -t / 2));
    const tri = [];
    const quad = (a, b, c, d) => tri.push(a, b, c, a, c, d);
    quad(top[0], top[1], top[2], top[3]); quad(bot[3], bot[2], bot[1], bot[0]);
    for (let k = 0; k < 4; k++) { const k1 = (k + 1) % 4; quad(top[k], bot[k], bot[k1], top[k1]); }
    const g = new THREE.BufferGeometry().setFromPoints(tri);
    g.computeVertexNormals();
    return paintVC(g, hex);
  };
  const span = MISSILE.span / 2;
  for (let k = 0; k < 4; k++) {
    const phi = Math.PI / 4 + k * Math.PI / 2;
    parts.push(fin(phi, 1.36, 1.86, 1.72, 1.84, span, 0.008, FIN));      // orta kanatlar (geriye ok açılı)
    parts.push(fin(phi, 3.14, 3.6, 3.36, 3.58, span, 0.009, FIN));       // kuyruk kontrol kanatçıkları
  }
  // Askı kulakları (üstte) ve göbek kablo kanalı
  for (const d of [half - 0.45, half + 0.45]) { const g = new THREE.BoxGeometry(0.03, 0.025, 0.07); g.translate(0, R + 0.01, d - half); parts.push(paintVC(g.toNonIndexed(), 0x6d7277)); }
  { const g = new THREE.BoxGeometry(0.035, 0.02, 1.1); g.translate(0, R + 0.005, 1.25 - half + 0.55); parts.push(paintVC(g.toNonIndexed(), 0xb6babe)); }
  for (const g of parts) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); if (g.attributes.uv && g.attributes.uv.itemSize !== 2) g.deleteAttribute('uv'); }
  MISSILE_GEO = mergeGeometries(parts.map((g) => { const o = g.index ? g.toNonIndexed() : g; for (const a of Object.keys(o.attributes)) if (!['position', 'normal', 'color', 'uv'].includes(a)) o.deleteAttribute(a); if (!o.attributes.uv) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(o.attributes.position.count * 2), 2)); return o; }), false);
  MISSILE_GEO.computeBoundingSphere();
  return MISSILE_GEO;
}
export function getMissileMaterial() {
  if (MISSILE_MAT) return MISSILE_MAT;
  MISSILE_MAT = withFxLight(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.18, envMapIntensity: 0.8, vertexColors: true }), 'f35missile');
  return MISSILE_MAT;
}

// GERÇEK kaplamanın alt yüzeyi: istasyonlar arasında doğrusal (loft böyle bağlar). bottomSurfaceY
// profili istasyonlar arasında smoothstep ile enterpole eder; kaplamayla birkaç cm farklı olabilir
// ve yüzeye yapışık paneller (takım yuvaları, kapaklar) yer yer kaplamanın içine gömülüp
// tırtıklı kenar bırakıyordu.
const _gearYawQ = new THREE.Quaternion(), _Y_AXIS = new THREE.Vector3(0, 1, 0);
export function hullBottomY(s, x) {
  const S = HULL_S;
  if (s <= S[0]) return bottomSurfaceY(S[0], x);
  for (let i = 0; i < S.length - 1; i++) {
    if (s <= S[i + 1]) { const t = (s - S[i]) / (S[i + 1] - S[i]); return bottomSurfaceY(S[i], x) * (1 - t) + bottomSurfaceY(S[i + 1], x) * t; }
  }
  return bottomSurfaceY(S[S.length - 1], x);
}
// Kurulum ışınları için bölgesel ağ: kutuyla (min/max) çakışan kaplama üçgenlerinden geçici
// bir ağ. Her dekal/kapak ışını tüm gövde üçgenlerini değil yalnızca bunları tarar; sonuç
// aynıdır (isabet her zaman kutunun içindedir), kurulum birkaç kat hızlanır.
function regionMesh(geos, min, max, material) {
  const out = [];
  for (const g of geos) {
    const p = g.attributes.position.array, idx = g.index ? g.index.array : null;
    const n = idx ? idx.length : p.length / 3;
    for (let i = 0; i < n; i += 3) {
      const a = 3 * (idx ? idx[i] : i), b = 3 * (idx ? idx[i + 1] : i + 1), c = 3 * (idx ? idx[i + 2] : i + 2);
      if (Math.max(p[a], p[b], p[c]) < min.x || Math.min(p[a], p[b], p[c]) > max.x) continue;
      if (Math.max(p[a + 1], p[b + 1], p[c + 1]) < min.y || Math.min(p[a + 1], p[b + 1], p[c + 1]) > max.y) continue;
      if (Math.max(p[a + 2], p[b + 2], p[c + 2]) < min.z || Math.min(p[a + 2], p[b + 2], p[c + 2]) > max.z) continue;
      out.push(p[a], p[a + 1], p[a + 2], p[b], p[b + 1], p[b + 2], p[c], p[c + 1], p[c + 2]);
    }
  }
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
  return new THREE.Mesh(bg, material);
}
// Üst yüzeyin (güverte + omuz) verilen |x| için y değeri – kaplama loft'unun kullandığı 5 noktalı kırık çizgi üzerinden
export function topSurfaceY(s, x) {
  const pts = halfSection(profileAt(s));
  const ax = Math.abs(x);
  for (let i = 0; i < 4; i++) {
    const a = pts[i], b = pts[i + 1];
    if (ax >= a.x - 1e-6 && ax <= b.x + 1e-6) { const t = b.x - a.x < 1e-6 ? 0 : (ax - a.x) / (b.x - a.x); return a.y + (b.y - a.y) * Math.min(1, Math.max(0, t)); }
  }
  return pts[4].y;
}
// Yan yüzeyin (chine altı) verilen y için x değeri
export function sideSurfaceX(s, y) {
  const pts = halfSection(profileAt(s));
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((y <= a.y && y >= b.y) || (y >= a.y && y <= b.y)) { const t = Math.abs(b.y - a.y) < 1e-6 ? 0 : (y - a.y) / (b.y - a.y); return a.x + (b.x - a.x) * t; }
  }
  return bodyHalfWidth(s);
}

// Profilden 12 noktalı yarım kesit üretir (indeks 0 üst merkez, 4 chine, 8 alt köşe, 11 alt merkez)
function halfSection(p) {
  const pts = [];
  // Üst: düz güverte (0..dk) + süperelips (dk,yt) -> (xc,yc). Kokpit bölgesinde güverte kanopi eşiğidir.
  const dk = Math.min(p.dk || 0.004, p.xc * 0.9);
  pts.push({ x: 0, y: p.yt });
  pts.push({ x: dk, y: p.yt });
  for (let i = 1; i <= 3; i++) {
    const th = (i / 3) * Math.PI / 2;
    const x = dk + (p.xc - dk) * Math.pow(Math.sin(th), 2 / p.nt);
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
export function loft(sections, { uScale = 1, vScale = 1, closeRing = false, flip = false, skipQuad = null, uvAt = null } = {}) {
  const n = sections.length, m = sections[0].length;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < m; k++) {
      const p = sections[i][k];
      pos.push(p.x, p.y, p.z);
      if (uvAt) { const t = uvAt(i, k); uv.push(t[0], t[1]); } else uv.push((i / (n - 1)) * uScale, (k / (m - 1)) * vScale);
    }
  }
  const kMax = closeRing ? m : m - 1;
  for (let i = 0; i < n - 1; i++) {
    for (let k = 0; k < kMax; k++) {
      const k1 = (k + 1) % m;
      if (skipQuad && skipQuad(i, k)) continue;
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
export function ensureOutward(g, refFn = null) {
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

/**
 * KAPALI panel: kesit halkaları kapalı (closeRing) loft edilir ve iki uç yüz üçgen
 * yelpazesiyle kapatılır. Açık kesit bırakan eski paneller (kanat ucu, menteşe kesiti)
 * belirli açılardan içi görünen yarıklar oluşturuyordu. Uç yüzlerin yönü panelin
 * diğer ucuna göre DIŞA dönük kurulur; keskin kenar için ayrı köşe noktaları kullanılır.
 */
export function closedLoft(rows, opts = {}) {
  const body = ensureOutward(loft(rows, Object.assign({}, opts, { closeRing: true })));
  const cen = (row) => { const c = new THREE.Vector3(); for (const p of row) c.add(new THREE.Vector3(p.x, p.y, p.z)); return c.multiplyScalar(1 / row.length); };
  const caps = [body.index ? body.toNonIndexed() : body];
  const ends = [[rows[0], cen(rows[rows.length - 1])], [rows[rows.length - 1], cen(rows[0])]];
  for (const [row, other] of ends) {
    const c = cen(row);
    const out = c.clone().sub(other);
    const pos = [];
    for (let k = 0; k < row.length; k++) {
      const a = row[k], b = row[(k + 1) % row.length];
      pos.push(c.x, c.y, c.z, a.x, a.y, a.z, b.x, b.y, b.z);
    }
    // İlk anlamlı üçgenin normaline göre sarım yönü
    let sum = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    for (let i = 0; i < pos.length; i += 9) {
      e1.set(pos[i + 3] - pos[i], pos[i + 4] - pos[i + 1], pos[i + 5] - pos[i + 2]);
      e2.set(pos[i + 6] - pos[i], pos[i + 7] - pos[i + 1], pos[i + 8] - pos[i + 2]);
      sum.add(e1.cross(e2));
    }
    if (sum.dot(out) < 0) for (let i = 0; i < pos.length; i += 9) for (let j = 0; j < 3; j++) { const t = pos[i + 3 + j]; pos[i + 3 + j] = pos[i + 6 + j]; pos[i + 6 + j] = t; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
    g.computeVertexNormals();
    caps.push(g);
  }
  return mergeGeometries(caps, false);
}

function naca(t, thick) {
  const x = Math.min(1, Math.max(0, t));
  const y = 5 * thick * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
  return Math.max(0, y);
}
// Kesit noktaları: üst yüz tEnd -> tStart, alt yüz tStart -> tEnd.
// cutStart: tStart > 0 olan (hücum kenarından başlamayan) kesitlerde alt yüzün tStart
// noktası da eklenir; kesit yüzü menteşe çizgisinde DİK olur. Bu olmadan halka üst
// tStart'tan alt (tStart + adım)'a çapraz kapanıyor ve menteşenin hemen arkasında alt
// yüzde bir adım genişliğinde V oluk kalıyordu (flaperon altında ~20 cm, LEF arkasında
// ~30 cm): nötrde bile yüzey "ayrık, sarkık flap" gibi görünüyordu.
export function airfoilPoints(K, chord, thickFrac, tStart = 0, tEnd = 1, cutStart = false) {
  const pts = [];
  for (let i = 0; i <= K; i++) { const t = tEnd - (tEnd - tStart) * (i / K); pts.push({ c: t, y: naca(t, thickFrac) * chord }); }
  for (let i = (cutStart && tStart > 0) ? 0 : 1; i <= K; i++) { const t = tStart + (tEnd - tStart) * (i / K); pts.push({ c: t, y: -naca(t, thickFrac) * chord }); }
  return pts;
}

// Boya detayı (gölgelendirici eki): döşenen panel dokusunun üstüne NESNE uzayında büyük ölçekli
// ton değişimi, akış yönünde (boyuna) uzamış çok hafif kir izleri, alt yüzeyde hafif kirlenme ve
// egzoz çevresinde is. Döşeme tekrarını kırar; boya, dekal ve işaretlerde AYNI hesap çalışır,
// böylece işaretler kaplamanın üstüne yapıştırılmış çıkartma gibi değil boyanın parçası gibi
// görünür. Tek doku okuması x3, ışık sayısından bağımsız.
function applyPaintDetail(mat, macro) {
  if (!mat || !macro) return mat;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: macro };
    sh.vertexShader = 'varying vec3 vObjPos;\nvarying vec3 vObjN;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vObjPos = position; vObjN = normal;');
    sh.fragmentShader = 'uniform sampler2D uMacro;\nvarying vec3 vObjPos;\nvarying vec3 vObjN;\n' + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    float mA = texture2D(uMacro, vObjPos.xz * 0.045 + vec2(vObjPos.y * 0.03)).r;
    float mB = texture2D(uMacro, vObjPos.zy * 0.13 + vec2(0.37, vObjPos.x * 0.05)).g;
    float streak = texture2D(uMacro, vec2(vObjPos.x * 0.42 + vObjPos.y * 0.3, vObjPos.z * 0.016)).b;
    float tone = 0.94 + 0.09 * mA + 0.05 * (mB - 0.5) - 0.045 * smoothstep(0.55, 0.85, streak);
    float under = smoothstep(0.15, -0.7, normalize(vObjN).y);
    float soot = smoothstep(4.2, 7.4, vObjPos.z) * smoothstep(1.5, 0.3, abs(vObjPos.x)) * smoothstep(1.0, 0.2, vObjPos.y);
    tone *= 1.0 - 0.04 * under * (0.6 + 0.8 * mB) - 0.16 * soot * (0.55 + 0.45 * mB);
    diffuseColor.rgb *= tone;
  }`);
    addFxLight(sh);
  };
  mat.customProgramCacheKey = () => 'f35paintDetail';
  return mat;
}

// Paylaşılan malzemeler (oyuncu uçağı + apronda park halindekiler)
let SHARED = null;
export function getSharedMaterials() {
  if (SHARED) return SHARED;
  const panel = makeStealthPanelTexture(1024);
  const rough = makeRoughnessTexture(512);
  const macro = makeMacroNoiseTexture(256);
  SHARED = {
    disposables: [panel, rough, macro],
    macro,
    paint: new THREE.MeshStandardMaterial({ color: 0xdfe3e8, map: panel, roughnessMap: rough, roughness: 0.72, metalness: 0.25, envMapIntensity: 0.7 }),
    paintDark: new THREE.MeshStandardMaterial({ color: 0x8b9096, map: panel, roughness: 0.8, metalness: 0.2 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.9, metalness: 0.1 }),
    // F-35 hava alığı kanalı: köşe renkleriyle derinliğe göre kararır (ağızda koyu gri,
    // içeride neredeyse siyah). Renk özniteliği olmayan geometride kullanılmaz. Ortam
    // yansıması kısık: kapalı bir kanalın içine gökyüzü yansımaz (köşe rengi yalnızca
    // dağınık ışığı kararttığından, tam yansıma içeriyi gri gösteriyordu).
    ductShade: new THREE.MeshStandardMaterial({ color: 0x3a3f45, roughness: 1, metalness: 0, envMapIntensity: 0.15, side: THREE.DoubleSide, vertexColors: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0x6f7378, roughness: 0.5, metalness: 0.9, flatShading: true, envMapIntensity: 0.8 }),
    metalSmooth: new THREE.MeshStandardMaterial({ color: 0xa4a7ab, roughness: 0.4, metalness: 0.85 }),
    // F-35 kanopisi: indiyum-kalay-oksit kaplamalı, dışarıdan koyu, altın-bronz yansımalı
    // görünür (sarı plastik değil). Koyu renk + yüksek metaliklik yansımayı altına boyar,
    // opaklık iç kokpitin seçilebilmesine yetecek kadar düşük kalır.
    canopy: new THREE.MeshPhysicalMaterial({
      color: 0x7a5f2a, metalness: 0.72, roughness: 0.05, transparent: true, opacity: 0.66,
      clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.9, side: THREE.DoubleSide, depthWrite: false,
    }),
    canopyInside: new THREE.MeshPhysicalMaterial({ color: 0xb08a3a, metalness: 0.3, roughness: 0.1, transparent: true, opacity: 0.12, side: THREE.FrontSide, depthWrite: false }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.95 }),
    cockpit: new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9 }),
    pilot: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, vertexColors: true }),   // renkler köşe renginde
    helmet: new THREE.MeshStandardMaterial({ color: 0x60666d, roughness: 0.32, metalness: 0.25 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0a0c10, roughness: 0.05, metalness: 0.6, clearcoat: 1, envMapIntensity: 1.2 }),
  };
  applyPaintDetail(SHARED.paint, macro);
  applyPaintDetail(SHARED.paintDark, macro);
  SHARED.disposables.push(...Object.values(SHARED).filter((m) => m && m.isMaterial));
  return SHARED;
}

export class F35A {
  constructor({ quality = 'medium', forStatic = false, livery = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'F-35A';
    this.parts = {};
    this.disposables = [];
    this.forStatic = forStatic;
    this.quality = quality;
    // Livery YALNIZCA görseldir: malzeme renkleri ve dekallar. Geometri, kütle,
    // bağlantı noktaları ve uçuş modeliyle ilgili hiçbir şey değişmez.
    this.livery = getLivery('f35a', livery);
    // Apronda park eden uçaklar (forStatic) paylaşılan malzemeleri olduğu gibi
    // kullanır: onların görünümü değişmez ve gereksiz kopya üretilmez.
    this.m = forStatic ? getSharedMaterials() : this.liveryMaterials(getSharedMaterials(), this.livery);
    this.paintGeos = [];
    this.buildFuselage();
    this.buildIntakes();
    this.buildCanopyAndCockpit();
    this.buildWings();
    this.buildTails();
    this.buildNozzle();
    this.buildGear();
    this.buildDetails();
    this.buildWeaponBays();
    this.buildStores();
    this.buildLights();
    this.buildMarkings();
    this._hull = null; this._skinTop = null; this._fins = null;   // yalnızca kurulumda gereken ışın yüzeyleri
    this.finalize();
  }

  track(o) { this.disposables.push(o); return o; }

  /**
   * Livery renklerini uygular. Paylaşılan malzeme nesnesi (apronda park eden
   * uçaklar da onu kullanır) ASLA değiştirilmez; yalnızca boyalı malzemelerin
   * KOPYASI alınır ve bu uçak örneğine özel hale getirilir. Panel/pürüzlülük
   * dokuları paylaşılmaya devam eder, bu yüzden livery başına ek doku belleği
   * ya da ek doku üretimi maliyeti YOKTUR.
   */
  liveryMaterials(shared, liv) {
    if (!liv) return shared;
    const m = Object.assign({}, shared);
    const paint = this.track(shared.paint.clone());
    paint.color.setHex(liv.paint);
    if (liv.roughness !== undefined) paint.roughness = liv.roughness;
    if (liv.metalness !== undefined) paint.metalness = liv.metalness;
    m.paint = applyPaintDetail(paint, shared.macro);   // clone() gölgelendirici ekini taşımaz
    const dark = this.track(shared.paintDark.clone());
    dark.color.setHex(liv.paintDark);
    m.paintDark = applyPaintDetail(dark, shared.macro);
    if (liv.metalTint !== undefined) {
      const mt = this.track(shared.metal.clone());
      mt.color.setHex(liv.metalTint);
      m.metal = mt;
    }
    return m;
  }

  // Belirli s istasyonu için tam kesit noktaları (sağ yarı) ve z
  sectionPoints(s, profile = null) {
    const p = profile || profileAt(s);
    return halfSection(p).map((q) => ({ x: q.x, y: q.y, z: st(s) }));
  }

  buildFuselage() {
    const foreS = FORE_S, mainS = MAIN_S;
    const fore = foreS.map((s) => this.sectionPoints(s));
    const main = mainS.map((s) => this.sectionPoints(s));
    const mirror = (pt) => ({ x: -pt.x, y: pt.y, z: pt.z });
    // Üst şerit: tüm istasyonlar (chine'den chine'e, tepe üzerinden)
    const topRows = [...fore, ...main].map((h) => [mirror(h[4]), mirror(h[3]), mirror(h[2]), mirror(h[1]), h[0], h[1], h[2], h[3], h[4]]);
    // Kokpit açıklığı: kanopi altındaki güverte dörtgenleri (k=3,4) atlanır; içi kokpit teknesi doldurur
    const allS = [...foreS, ...mainS];
    const skipQuad = (i, k) => (k === 3 || k === 4) && allS[i] >= 3.25 && allS[i + 1] <= 6.7;
    const ALL_OLD = [...FORE_S, ...MAIN_S_OLD];
    const uvTop = (i, k) => [oldIdx(allS[i], ALL_OLD) / (ALL_OLD.length - 1) * 3, k / 8];
    this.paintGeos.push(ensureOutward(loft(topRows, { skipQuad, uvAt: uvTop }), bodyAxisRef));
    this._skinTop = this.paintGeos[this.paintGeos.length - 1];
    // Alt şerit: ön gövde + ana gövde (alt köşeden alt köşeye). Silah yuvaları için her yarıya
    // dört sütun eklenir — hepsi MEVCUT kesit çizgisinin üzerindedir, biçim değişmez:
    //   c0 = BAY.x0 (h11–h10 arası, iç menteşe), cA/cB = BAY.xs ∓ gap (kapak ayrım çizgisi),
    //   c1 = BAY.x1 (h10–h9 arası, dış menteşe).
    // Yuva istasyonlarında (7.0–10.8) bu x'ler tam tutturulur (düz menteşe/kenar çizgileri);
    // dar kesitlerde (burun, kuyruk) sırayı koruyan sabit kesirlere düşer.
    const botS = [...foreS, ...mainS.slice(1)];
    const lerpP = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });
    const colT = [];   // satır başına eklenen sütunların kesirleri (UV için)
    const botRows = [...fore, ...main.slice(1)].map((h, i) => {
      const fitIn = h[10].x > BAY.xs + 0.08, fitOut = BAY.x1 > h[10].x + 0.03 && BAY.x1 < h[9].x - 0.01;
      const t0 = fitIn ? BAY.x0 / h[10].x : 0.15, tA = fitIn ? (BAY.xs - BAY.gap) / h[10].x : 0.6, tB = fitIn ? (BAY.xs + BAY.gap) / h[10].x : 0.62;
      const t1 = fitOut ? (BAY.x1 - h[10].x) / (h[9].x - h[10].x) : 0.5;
      colT.push([t0, tA, tB, t1]);
      const R = [h[11], lerpP(h[11], h[10], t0), lerpP(h[11], h[10], tA), lerpP(h[11], h[10], tB), h[10], lerpP(h[10], h[9], t1), h[9], h[8]];
      return [...R.slice(1).reverse().map(mirror), ...R];
    });
    // Eski 7 sütunlu satırdaki kesirli sütun sırası: [-h8,-h9,-h10,h11,h10,h9,h8] = 0..6
    const BOT_OLD = [...FORE_S, ...MAIN_S_OLD.slice(1)];
    const vBot = (i, k) => {
      const [t0, tA, tB, t1] = colT[i];
      const right = [3, 3 + t0, 3 + tA, 3 + tB, 4, 4 + t1, 5, 6];   // h11, c0, cA, cB, h10, c1, h9, h8
      return k >= 7 ? right[k - 7] : 6 - right[7 - k];
    };
    const uvBot = (i, k) => [oldIdx(botS[i], BOT_OLD) / (BOT_OLD.length - 1) * 3, vBot(i, k) / 6];
    // Yuva ağzı: iki yanda c0..c1 arasındaki dörtlüler atlanır (kesik). Ağzı kapalıyken
    // aynı köşelerden kurulan yama (buildWeaponBays) doldurur, açılınca kapaklar ve yuva içi.
    const iS0 = botS.indexOf(BAY.s0), iS1 = botS.indexOf(BAY.s1);
    const BAY_K = [2, 3, 4, 5, 8, 9, 10, 11];
    const skipBot = (i, k) => i >= iS0 && i < iS1 && BAY_K.includes(k);
    this._bay = { rows: botRows, stations: botS, iS0, iS1, uv: uvBot };
    this._hull = [];   // alt/yan kaplama: takım yuvaları ve kapaklar bu yüzeye ışınla oturtulur
    this.paintGeos.push(ensureOutward(loft(botRows, { skipQuad: skipBot, uvAt: uvBot }), bodyAxisRef));
    this._hull.push(this.paintGeos[this.paintGeos.length - 1]);
    // Yan şeritler: ön gövde (ayrı) ve ana gövde (ağızdan itibaren, süpürülmüş dudak halkası)
    const lipProfile = lerpProfile(MAIN_PROFILES, 5.0);
    const lipHalf = halfSection(lipProfile);
    for (const side of [-1, 1]) {
      const sideRowsFore = fore.map((h) => h.slice(4, 9).map((q) => ({ x: side * q.x, y: q.y, z: q.z })));
      this.paintGeos.push(ensureOutward(loft(sideRowsFore, { uScale: 1, vScale: 0.5 }), bodyAxisRef));
      this._hull.push(this.paintGeos[this.paintGeos.length - 1]);
      // Dudak halkası: chine 4.55'te, alt köşe 5.7'de (süpürülmüş)
      const lipRing = lipHalf.slice(4, 9).map((q, k) => ({ x: side * q.x, y: q.y, z: st(4.55 + (k / 4) * 1.15) }));
      const sideRowsMain = [lipRing, ...main.slice(1).map((h) => h.slice(4, 9).map((q) => ({ x: side * q.x, y: q.y, z: q.z })))];
      const uvSide = (i, k) => [(i === 0 ? 0 : oldIdx(mainS[i], MAIN_S_OLD)) / (MAIN_S_OLD.length - 1) * 2.5, k / 4 * 0.5];
      this.paintGeos.push(ensureOutward(loft(sideRowsMain, { uvAt: uvSide }), bodyAxisRef));
      this._hull.push(this.paintGeos[this.paintGeos.length - 1]);
      // Hava alığı: ağız halkası = DIŞ dudak zinciri (süpürülmüş) + İÇ duvar zinciri (ön
      // gövde yan duvarı, 4.5 istasyonu; ön gövde yan şeridiyle aynı noktalar, yarık yok).
      const ringA = fore[fore.length - 1].slice(4, 9).map((q) => ({ x: side * q.x, y: q.y, z: q.z }));
      this.buildIntakeDuct(side, lipRing, ringA);
      // Chine kıymığı: üst şeridin chine kenarı (4.5 -> 5.0 -> 5.4) ile dudak/yan şerit kenarı
      // (dudak chine'i -> 5.4) arasındaki ince bölge. Eski düz boğaz levhası arkasını
      // örtüyordu; gerçek kanalla birlikte açıkta kalıyordu.
      const c0 = ringA[0], c1 = lipRing[0], c2 = main[1][4], c3 = main[0][4];
      const sliver = new THREE.BufferGeometry();
      const pp = (q, sx = true) => [sx ? side * q.x : q.x, q.y, q.z];
      sliver.setAttribute('position', new THREE.Float32BufferAttribute([...pp(c0, false), ...pp(c1, false), ...pp(c3), ...pp(c1, false), ...pp(c2), ...pp(c3)], 3));
      sliver.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
      sliver.setIndex([0, 1, 2, 3, 4, 5]);
      sliver.computeVertexNormals();
      this.paintGeos.push(ensureOutward(sliver, (v, o) => o.set(v.x, v.y - 1, v.z)));
      // Ağız tabanı: boğazın alt kenarı (dudak alt köşesi -> ön gövde alt köşesi) ile
      // karın şeridinin kenarı (4.5 -> 5.4 alt köşeleri) arasında kalan üçgen bölge.
      // Kapatılmazsa ağızdan bakınca karın kaplamasının arka yüzü (görünmez) ve
      // ardındaki gökyüzü görünüyordu.
      const f8 = fore[fore.length - 1][8], m8 = main[1][8];
      const P1 = [side * f8.x, f8.y, f8.z], P2 = [side * m8.x, m8.y, m8.z];
      const P3 = [lipRing[4].x, lipRing[4].y, lipRing[4].z], P4 = [ringA[4].x, ringA[4].y, ringA[4].z];
      const floor = new THREE.BufferGeometry();
      floor.setAttribute('position', new THREE.Float32BufferAttribute([...P1, ...P2, ...P3, ...P1, ...P3, ...P4], 3));
      floor.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(0.4), 3));
      floor.computeVertexNormals();
      this.group.add(new THREE.Mesh(this.track(floor), this.m.ductShade));
    }
    // Burun ucu: kesitler s=0'da küçük ama AÇIK bir halkayla başlıyordu (önden-yukarıdan
    // bakınca uçta delik). Birkaç santim önde bir tepe noktasına kapatılır.
    const tip = this.bellyRing(fore[0], botRows[0]);
    const apex = tip.ring.map(() => ({ x: 0, y: 0, z: st(-0.025) }));
    this.paintGeos.push(ensureOutward(loft([apex, tip.ring], { closeRing: true, uvAt: (i, k) => [i, tip.uk[k]] }), (v, o) => o.set(0, 0, st(0.3))));
    this.buildAftBody(this.bellyRing(main[main.length - 1], botRows[botRows.length - 1]));
  }

  // Tam kesit halkası (sağ yarı üst merkez -> alt merkez, sonra sol yarı geri). Karın
  // şeridinin satırındaki ek sütunlar (c0, cA, cB, c1) halkaya da eklenir: burun ucu ve
  // arka gövde bu satırlara dikilir; eklenmezse kenarda T-birleşimi (piksel delikleri) kalır.
  // uk: eski 22 noktalı halkadaki kesirli indisle UV (desen kaymaz).
  bellyRing(half, botRow) {
    const R = botRow.slice(7);   // h11, c0, cA, cB, h10, c1, h9, h8 (sağ yarı)
    const t = (q, a, b) => { const d = Math.hypot(b.x - a.x, b.y - a.y); return d > 1e-9 ? Math.hypot(q.x - a.x, q.y - a.y) / d : 0; };
    const fr = [8, 9, 10 - t(R[5], half[10], half[9]), 10, 11 - t(R[3], half[11], half[10]), 11 - t(R[2], half[11], half[10]), 11 - t(R[1], half[11], half[10]), 11];
    const right = [...half.slice(0, 8), ...R.slice().reverse()];
    const fRight = [0, 1, 2, 3, 4, 5, 6, 7, ...fr];
    const ring = [...right, ...right.slice(1, -1).reverse().map((q) => ({ x: -q.x, y: q.y, z: q.z }))];
    const fk = [...fRight, ...fRight.slice(1, -1).reverse().map((f) => 22 - f)];
    return { ring, uk: fk.map((f) => f / 21) };
  }

  // Arka gövde. Eskiden gövde 14.6 istasyonunda 2,4 m genişliğinde düz, siyah bir
  // levhayla bitiyordu: arkadan bakınca uçak "kutu" gibi, motor bölümü boş görünüyordu.
  // Gerçek F-35A'da arka gövde nozul kılıfına doğru daralır (boat-tail) ve iki yanda
  // stabilatörleri taşıyan kuyruk bumları uzanır.
  buildAftBody(end) {
    const Y0 = 0.08;                     // nozul ekseni yüksekliği (buildNozzle ile aynı)
    const sA = 14.6, sB = 14.95, sC = 15.28, R = 0.585;
    // Son gövde kesitinin tam halkası (karın şeridinin ek sütunlarıyla, bkz. bellyRing)
    const ring = end.ring;
    const toCircle = (q, r, t, sv) => {
      const a = Math.atan2(q.y - Y0, q.x);
      const cx = Math.cos(a) * r, cy = Y0 + Math.sin(a) * r;
      return { x: q.x + (cx - q.x) * t, y: q.y + (cy - q.y) * t, z: st(sv) };
    };
    const rows = [
      ring.map((q) => ({ x: q.x, y: q.y, z: st(sA) })),
      ring.map((q) => toCircle(q, R * 1.08, 0.58, sB)),
      ring.map((q) => toCircle(q, R, 1, sC)),
    ];
    this.paintGeos.push(ensureOutward(loft(rows, { closeRing: true, uvAt: (i, k) => [i / 2, end.uk[k]] }), (v, o) => o.set(0, Y0, v.z)));
    // Kılıf ile nozul arasındaki ince halka (sıcak bölüm conta yüzü)
    const ann = new THREE.RingGeometry(0.50, R + 0.002, 40, 1);
    ann.translate(0, Y0, st(sC));
    const annMat = this.track(this.m.metal.clone()); annMat.side = THREE.DoubleSide;
    this.group.add(new THREE.Mesh(this.track(ann), annMat));
    // Kuyruk bumları: stabilatör kökünü taşır, gövde yanından çıkıp incelerek biter
    const BX = 0.97, BY = -0.07;
    const sec = (sv, w, h) => {
      const pts = [];
      for (let k = 0; k < 14; k++) {
        const a = (k / 14) * Math.PI * 2;
        const c = Math.cos(a), sn = Math.sin(a);
        pts.push({ x: Math.sign(c) * Math.pow(Math.abs(c), 0.75) * w, y: Math.sign(sn) * Math.pow(Math.abs(sn), 0.85) * h, z: st(sv) });
      }
      return pts;
    };
    for (const side of [-1, 1]) {
      const bRows = [[13.2, 0.19, 0.16], [14.0, 0.21, 0.17], [14.9, 0.2, 0.16], [15.35, 0.15, 0.115], [15.6, 0.05, 0.04]]
        .map(([sv, w, h]) => sec(sv, w, h).map((q) => ({ x: side * BX + q.x, y: BY + q.y, z: q.z })));
      this.paintGeos.push(closedLoft(bRows, { uScale: 1, vScale: 1 }));
    }
  }

  /**
   * Hava alığı dudağı ve kanalı. Eski "boğaz" bir kanal değil, ağzın önüne gerilmiş
   * tek bir yüzeydi (dudaktan gövde duvarına): içeri bakınca derinliği olmayan düz
   * siyah bir levha görünüyordu; dudak şeridi ise ağızdan DIŞARI (ileri) uzanıp bir
   * bıçak gibi duruyordu. Şimdi:
   *   - dudak: dış kaplamadan kanala doğru (içe ve geriye) kısa, keskin bir eğim; gövde
   *     boyasıyla birleşir, kırışma normalleri kenarı keskin tutar,
   *   - kanal: ağız halkasından ~1,8 m geriye, motora doğru daralıp içe kıvrılan kapalı
   *     tüp; derinlikle kararan köşe renkleri ve kapalı dip.
   * İki taraf aynı fonksiyonla, yalnızca x işaretiyle kurulur: birebir simetrik.
   */
  buildIntakeDuct(side, lipRing, wall) {
    // Dudak iç kenarı: halka merkezine doğru 5 cm, geriye 7 cm
    const ring0 = [...lipRing, ...wall.slice().reverse()];
    const C = ring0.reduce((a, q) => a.add(new THREE.Vector3(q.x, q.y, q.z)), new THREE.Vector3()).multiplyScalar(1 / ring0.length);
    const lipIn = lipRing.map((q) => {
      const d = new THREE.Vector3(C.x - q.x, C.y - q.y, 0).normalize();
      return { x: q.x + d.x * 0.05, y: q.y + d.y * 0.05, z: q.z + 0.07 };
    });
    // Eğim geriye doğru daralan bir huni: görünen yüzü İLERİ (ve kanal eksenine) bakar
    this.paintGeos.push(ensureOutward(loft([lipRing, lipIn], { uScale: 0.3, vScale: 0.3 }), (v, o) => o.set(v.x, v.y, v.z + 1)));
    // Kanal halkaları: ağız (dudak iç kenarı + duvar), sonra daralarak geriye ve içe
    const mouth = [...lipIn, ...wall.slice().reverse()];
    const M = mouth.length;
    const stage = (shrink, aft, inward) => mouth.map((q) => ({
      x: (C.x + (q.x - C.x) * shrink) * (1 - inward),
      y: C.y + (q.y - C.y) * shrink,
      z: q.z + aft,
    }));
    // Kanal 1,2 m'de biter (eskiden 1,8): sonu en fazla 6,9 istasyonunda kalır, silah
    // yuvasının ön duvarına (7,0) girmez. Dip neredeyse siyah olduğundan önden fark edilmez.
    const rows = [mouth, stage(0.9, 0.3, 0.03), stage(0.74, 0.72, 0.1), stage(0.56, 1.2, 0.18)];
    const shade = [0.55, 0.24, 0.08, 0.02];
    const tube = loft(rows, { uScale: 1, vScale: 1, closeRing: true });
    const col = [];
    for (let i = 0; i < rows.length; i++) for (let k = 0; k < M; k++) col.push(shade[i], shade[i], shade[i]);
    tube.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    // Kanal dibi (motor yüzü yönü): neredeyse siyah kapak
    const end = rows[rows.length - 1];
    const ec = end.reduce((a, q) => a.add(new THREE.Vector3(q.x, q.y, q.z)), new THREE.Vector3()).multiplyScalar(1 / M);
    const capPos = [];
    for (let k = 0; k < M; k++) { const a = end[k], b = end[(k + 1) % M]; capPos.push(ec.x, ec.y, ec.z, a.x, a.y, a.z, b.x, b.y, b.z); }
    const cap = new THREE.BufferGeometry();
    cap.setAttribute('position', new THREE.Float32BufferAttribute(capPos, 3));
    cap.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(capPos.length / 3 * 2), 2));
    cap.setAttribute('color', new THREE.Float32BufferAttribute(new Array(capPos.length).fill(0.01), 3));
    cap.computeVertexNormals();
    // Ağız köşeleri: dudak eğiminin iç kenarı (lipIn) chine ve alt köşede duvar zincirine
    // değmez; aradaki iki küçük üçgen kapatılmazsa gövdenin iç yüzü görünür.
    const tri = [];
    for (const k of [0, lipRing.length - 1]) for (const q of [lipRing[k], lipIn[k], wall[k]]) tri.push(q.x, q.y, q.z);
    const seal = new THREE.BufferGeometry();
    seal.setAttribute('position', new THREE.Float32BufferAttribute(tri, 3));
    seal.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(tri.length / 3 * 2), 2));
    seal.setAttribute('color', new THREE.Float32BufferAttribute(new Array(tri.length).fill(shade[0]), 3));
    seal.computeVertexNormals();
    const duct = mergeGeometries([tube.toNonIndexed(), cap, seal], false);
    duct.computeVertexNormals();
    this.group.add(new THREE.Mesh(this.track(duct), this.m.ductShade));
  }

  buildIntakes() {
    // DSI tümseği: ön gövde yan duvarında, ağzın içine doğru uzanan YUMUŞAK bir bombe.
    // Eskisi duvardan 21 cm dışarı taşan kısa bir elipsoitti ve ağızdan sarkan ayrı bir
    // "yumurta" gibi görünüyordu; daha yassı ve uzun yapılarak duvara kaynaştırıldı.
    for (const side of [-1, 1]) {
      const bump = new THREE.SphereGeometry(1, 18, 12, 0, Math.PI * 2, 0, Math.PI);
      bump.scale(0.15, 0.33, 0.95);
      bump.rotateY(side * 0.06);
      bump.translate(side * 0.85, -0.36, st(4.85));
      this.paintGeos.push(bump);
    }
  }

  /**
   * Koltuk/pilot ortak çerçevesi. Kalça noktası (hip) ve sırt eğimi (recline, dikeyden
   * geriye ~14°) tek yerde tanımlıdır; koltuk parçaları da pilot uzuvları da buradan
   * konumlanır, böylece pilot koltuğa gerçekten oturur (havada asılı ya da koltuğa
   * gömülü değil). Kask merkezi kokpit kamerasının göz noktasının ~8 cm gerisine düşer.
   */
  seatFrame() {
    const recline = 14 * DEG;
    const hip = { y: 0.50, z: st(4.88) };
    const dir = { y: Math.cos(recline), z: Math.sin(recline) };     // sırt boyunca yukarı-geri
    const back = { y: -Math.sin(recline), z: Math.cos(recline) };   // sırta dik, geriye
    return {
      recline, hip, dir, back,
      at: (along, off = 0) => ({ y: hip.y + dir.y * along + back.y * off, z: hip.z + dir.z * along + back.z * off }),
    };
  }

  /**
   * Pilot: F-35 pilotu — Gen III HMDS kaskı (büyük, yuvarlak kabuk, yüzü örten koyu
   * vizör, yan projektör çıkıntıları), oksijen maskesi ve hortumu, adaçayı yeşili uçuş
   * tulumu, koşum kayışları ve can yeleği, eldivenler, botlar. Sağ el yan çubukta, sol el
   * gaz kolunda, ayaklar pedallarda. Tüm vücut köşe renkli TEK ağdır; kask kabuğu ve
   * vizörle birlikte 3 çizim çağrısı (eskisiyle aynı). Kokpit görünümünde gizlenir.
   */
  buildPilot(SEAT) {
    const m = this.m;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const P = (along, off, x = 0) => { const c = SEAT.at(along, off); return V(x, c.y, c.z); };
    const body = [];
    const add = (g, hex) => { body.push(paintVC(g.index ? g.toNonIndexed() : g, hex)); return g; };
    const up = V(0, 1, 0), q = new THREE.Quaternion();
    // İki nokta arasında kapsül (uzuv)
    const limb = (a, b, r, hex) => {
      const d = b.clone().sub(a), len = d.length();
      const g = new THREE.CapsuleGeometry(r, Math.max(0.001, len), 3, 9);
      q.setFromUnitVectors(up, d.normalize());
      g.applyQuaternion(q);
      const mid = a.clone().add(b).multiplyScalar(0.5);
      g.translate(mid.x, mid.y, mid.z);
      return add(g, hex);
    };
    // İki nokta arasında yassı şerit (kayış): genişlik w, kalınlık t, yüz normali n
    const strap = (a, b, w, t, n, hex) => {
      const d = b.clone().sub(a), len = d.length();
      const yA = d.clone().normalize(), zA = n.clone().sub(yA.clone().multiplyScalar(n.dot(yA))).normalize(), xA = yA.clone().cross(zA);
      const g = new THREE.BoxGeometry(w, len, t);
      g.applyMatrix4(new THREE.Matrix4().makeBasis(xA, yA, zA));
      const mid = a.clone().add(b).multiplyScalar(0.5);
      g.translate(mid.x, mid.y, mid.z);
      return add(g, hex);
    };
    const SUIT = 0x5b6650, HARNESS = 0x262826, VEST = 0x474d3c, GLOVE = 0x2b2826, BOOT = 0x17181a, MASK = 0x24272a;
    const fwd = V(0, Math.sin(SEAT.recline), -Math.cos(SEAT.recline));   // gövdenin önü

    // --- Gövde: süperelips halkalarla loft (kalçadan omuza), sırt eğimini izler ---
    const RING = [
      // [eksen boyunca, yarı genişlik, yarı derinlik]
      [-0.085, 0.02, 0.02], [-0.06, 0.12, 0.09], [-0.02, 0.163, 0.118], [0.08, 0.168, 0.122], [0.20, 0.152, 0.114],
      [0.32, 0.178, 0.128], [0.42, 0.203, 0.133], [0.49, 0.207, 0.12], [0.545, 0.17, 0.095], [0.575, 0.075, 0.06], [0.585, 0.02, 0.02],
    ];
    const NR = 14, EXP = 2.6;
    const rows = RING.map(([al, a, b]) => {
      const c = SEAT.at(al, 0), row = [];
      for (let k = 0; k < NR; k++) {
        const th = (k / NR) * Math.PI * 2, cs = Math.cos(th), sn = Math.sin(th);
        const x = Math.sign(cs) * Math.pow(Math.abs(cs), 2 / EXP) * a;
        const dd = Math.sign(sn) * Math.pow(Math.abs(sn), 2 / EXP) * b;       // + = öne
        row.push({ x, y: c.y + fwd.y * dd, z: c.z + fwd.z * dd });
      }
      return row;
    });
    const torso = ensureOutward(loft(rows, { uScale: 1, vScale: 1, closeRing: true }), (v, o) => { const al = (v.y - SEAT.hip.y) * SEAT.dir.y + (v.z - SEAT.hip.z) * SEAT.dir.z; const c = SEAT.at(al, 0); o.set(0, c.y, c.z); });
    add(torso, SUIT);
    const frontAt = (al, x, lift = 0.006) => {
      // Gövdenin ön yüzeyinde (al, x) noktası: halka tablosundan doğrusal yarı derinlik
      let b = RING[0][2], a = RING[0][1];
      for (let i = 0; i < RING.length - 1; i++) if (al >= RING[i][0] && al <= RING[i + 1][0]) { const t = (al - RING[i][0]) / (RING[i + 1][0] - RING[i][0]); b = RING[i][2] + (RING[i + 1][2] - RING[i][2]) * t; a = RING[i][1] + (RING[i + 1][1] - RING[i][1]) * t; }
      const u = Math.min(0.999, Math.abs(x) / a);
      const d = b * Math.pow(1 - Math.pow(u, EXP), 1 / EXP) + lift;
      const c = SEAT.at(al, 0);
      return V(x, c.y + fwd.y * d, c.z + fwd.z * d);
    };
    // Koşum: omuzlardan inen iki kayış, bel kemeri, göğüs tokası; can yeleği yakası
    for (const sx of [-1, 1]) {
      const pts = [0.53, 0.44, 0.33, 0.20, 0.07].map((al) => frontAt(al, sx * 0.085, 0.008));
      for (let i = 0; i < pts.length - 1; i++) strap(pts[i], pts[i + 1], 0.045, 0.012, fwd, HARNESS);
      limb(frontAt(0.47, sx * 0.17, 0.012), frontAt(0.39, sx * 0.05, 0.02), 0.028, VEST);
      const pk = new THREE.BoxGeometry(0.075, 0.08, 0.035);
      pk.applyMatrix4(new THREE.Matrix4().makeRotationX(SEAT.recline));
      const pp = frontAt(0.27, sx * 0.13, 0.012); pk.translate(pp.x, pp.y, pp.z);
      add(pk, VEST);
    }
    for (let i = 0; i < 4; i++) { const x0 = -0.15 + i * 0.1; strap(frontAt(0.04, x0, 0.01), frontAt(0.04, x0 + 0.1, 0.01), 0.05, 0.014, fwd, HARNESS); }
    { const b = new THREE.BoxGeometry(0.07, 0.06, 0.02); b.applyMatrix4(new THREE.Matrix4().makeRotationX(SEAT.recline)); const p = frontAt(0.30, 0, 0.018); b.translate(p.x, p.y, p.z); add(b, 0x8a8f94); }
    // Boyun
    const neck0 = P(0.56, -0.005), neck1 = P(0.66, -0.02);
    limb(neck0, neck1, 0.05, SUIT);
    // --- Kollar: omuz -> dirsek -> el (sağ el yan çubukta, sol el gaz kolunda) ---
    const dk = (sv) => bodyTop(sv);
    const arms = [
      { s: V(0.20, SEAT.at(0.49, 0.01).y, SEAT.at(0.49, 0.01).z), e: V(0.29, 0.735, st(5.13)), h: V(0.40, dk(4.95) + 0.145, st(4.93)) },
      { s: V(-0.20, SEAT.at(0.49, 0.01).y, SEAT.at(0.49, 0.01).z), e: V(-0.30, 0.745, st(5.04)), h: V(-0.40, dk(4.80) + 0.11, st(4.80)) },
    ];
    for (const a of arms) {
      const sh = new THREE.SphereGeometry(0.06, 10, 8); sh.translate(a.s.x, a.s.y, a.s.z); add(sh, SUIT);
      limb(a.s, a.e, 0.054, SUIT);
      limb(a.e, a.h.clone().add(a.e.clone().sub(a.h).normalize().multiplyScalar(0.05)), 0.044, SUIT);
      const hand = new THREE.SphereGeometry(1, 8, 6); hand.scale(0.04, 0.035, 0.058); hand.translate(a.h.x, a.h.y, a.h.z); add(hand, GLOVE);
    }
    // --- Bacaklar: kalça -> diz -> ayak bileği, botlar pedallarda ---
    for (const sx of [-1, 1]) {
      const hp = V(sx * 0.095, SEAT.hip.y + 0.005, SEAT.hip.z - 0.02);
      const kn = V(sx * 0.125, 0.645, st(4.44));
      const an = V(sx * 0.145, 0.345, st(4.21));
      limb(hp, kn, 0.074, SUIT);
      limb(kn, an, 0.056, SUIT);
      const boot = new THREE.BoxGeometry(0.085, 0.085, 0.24);
      boot.translate(an.x, an.y - 0.035, an.z - 0.07);
      add(boot, BOOT);
      if (sx > 0) { // diz tahtası (sağ uyluk)
        const kb = new THREE.BoxGeometry(0.11, 0.012, 0.16);
        kb.rotateX(Math.atan2(0.645 - SEAT.hip.y, SEAT.hip.z - st(4.44)) * -1);
        const c = hp.clone().lerp(kn, 0.6); kb.translate(c.x, c.y + 0.078, c.z);
        add(kb, 0xc9c7bd);
      }
    }
    // --- Kask: büyük yuvarlak kabuk, arka-üst şişkinlik, yan projektörler ---
    const H = P(0.735, -0.03);
    const helmetGeos = [];
    const shell = new THREE.SphereGeometry(1, 22, 16); shell.scale(0.13, 0.142, 0.157); shell.translate(H.x, H.y, H.z); helmetGeos.push(shell);
    const crown = new THREE.SphereGeometry(1, 16, 10); crown.scale(0.115, 0.09, 0.13); crown.translate(H.x, H.y + 0.06, H.z + 0.025); helmetGeos.push(crown);
    for (const sx of [-1, 1]) {
      const pj = new THREE.BoxGeometry(0.03, 0.05, 0.10); pj.translate(H.x + sx * 0.125, H.y + 0.02, H.z - 0.035); helmetGeos.push(pj);
    }
    const helmetGeo = this.track(mergeGeometries(helmetGeos.map((g) => g.toNonIndexed()), false));
    const helmetMesh = new THREE.Mesh(helmetGeo, m.helmet);
    // Vizör: kabuğun önünü kaşlardan çeneye kadar örten koyu, yansıtıcı küre parçası
    const visor = new THREE.SphereGeometry(1, 22, 10, -Math.PI / 2 - 1.08, 2.16, 0.82, 1.22);
    visor.scale(0.136, 0.148, 0.163); visor.translate(H.x, H.y, H.z);
    const visorMesh = new THREE.Mesh(this.track(visor), m.glass);
    // Oksijen maskesi ve hortumu (vizörün altında)
    const mask = new THREE.SphereGeometry(1, 10, 8); mask.scale(0.052, 0.046, 0.05); mask.translate(H.x, H.y - 0.098, H.z - 0.125); add(mask, MASK);
    const hose = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      V(0, H.y - 0.12, H.z - 0.15), V(-0.05, H.y - 0.20, H.z - 0.15), frontAt(0.47, -0.10, 0.03), frontAt(0.37, -0.13, 0.02),
    ]), 10, 0.016, 6, false);
    add(hose, MASK);

    const bodyMesh = new THREE.Mesh(this.track(mergeGeometries(body, false)), m.pilot);
    this.group.add(bodyMesh, helmetMesh, visorMesh);
    this.parts.pilotParts = [bodyMesh, helmetMesh, visorMesh];
  }

  canopyWH(sv) {
    const P = CANOPY;
    if (sv <= P[0][0] || sv >= P[P.length - 1][0]) return [0, 0];
    for (let i = 0; i < P.length - 1; i++) {
      const [s0, w0, h0] = P[i], [s1, w1, h1] = P[i + 1];
      if (sv >= s0 && sv <= s1) { const t = (sv - s0) / (s1 - s0); return [w0 + (w1 - w0) * t, h0 + (h1 - h0) * t]; }
    }
    return [0, 0];
  }
  /** Kanopi camının (iç yüz) x'teki yüksekliği; kanopi dışında -Infinity. */
  canopySurfaceY(sv, x) {
    const [w, h] = this.canopyWH(sv);
    const ax = Math.abs(x);
    if (w <= 0 || ax >= w) return -Infinity;
    const N = CANOPY_N;
    return bodyTop(sv) - 0.012 + h * Math.pow(1 - Math.pow(ax / w, N), 1 / N);
  }
  /** Kokpit içinde bir noktanın izin verilen en yüksek y'si (kanopi ya da gövde üstü). */
  cockpitCeil(sv, x) { return Math.max(topSurfaceY(sv, x), this.canopySurfaceY(sv, x)); }

  buildCanopyAndCockpit() {
    const m = this.m;
    const cockpitMat = this.track(new THREE.MeshStandardMaterial({ color: 0x24272b, roughness: 0.9, side: THREE.DoubleSide }));
    cockpitMat.userData.cockpit = true;
    // Kokpit donanımı: köşe renkli tek malzeme (koltuk, konsollar, kollar, kapaklar...)
    // — kaç parça olursa olsun tek çizim çağrısına birleşir.
    const ckMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82, metalness: 0.12, vertexColors: true }));
    ckMat.userData.cockpit = true;   // kokpit-içi denetimi (test) bu işareti kullanır
    const ck = (g, hex) => { this.group.add(new THREE.Mesh(this.track(paintVC(g, hex)), ckMat)); return g; };
    const deck = (sv) => bodyTop(sv);
    // Kokpit teknesi: güverteyi izleyen U kesitli oluk; gövde açıklığından koyu iç hacim görünür
    // Üst kenar, güverte açıklığının kenarıyla (dk) çakışır: ne dışarı taşar ne aralık bırakır
    const tubS = [3.2, 3.4, 3.8, 4.2, 4.6, 5.0, 5.4, 5.8, 6.2, 6.5, 6.75];
    const tubRows = tubS.map((sv) => { const yt = bodyTop(sv), z = st(sv), dk = Math.min(profileAt(sv).dk, profileAt(sv).xc * 0.9), wi = Math.min(0.60, dk - 0.05); return [
      { x: -dk, y: yt - 0.001, z }, { x: -wi, y: yt - 0.34, z }, { x: -Math.min(0.26, wi * 0.6), y: yt - 0.42, z },
      { x: Math.min(0.26, wi * 0.6), y: yt - 0.42, z }, { x: wi, y: yt - 0.34, z }, { x: dk, y: yt - 0.001, z }]; });
    this.group.add(new THREE.Mesh(this.track(loft(tubRows, { uScale: 1, vScale: 1 })), cockpitMat));
    for (const row of [tubRows[0], tubRows[tubRows.length - 1]]) {
      const mid = row.map((q) => ({ x: 0, y: q.y - 0.002, z: q.z }));
      this.group.add(new THREE.Mesh(this.track(loft([row, mid], { uScale: 1, vScale: 1 })), cockpitMat));
    }
    // İç eşik: açıklık kenarından dışa doğru, dış kaplamanın hemen altında koyu raf (kokpit görünümünde dışarı sızma olmaz)
    for (const side of [-1, 1]) {
      const inner = tubRows.map((r) => ({ x: side * Math.abs(r[0].x), y: r[0].y, z: r[0].z }));
      // Dış kenar chine'in 6 cm içinde kalır: eskiden dk + 0,45 m idi ve 3.8–4.6
      // istasyonlarında gövde yanından 7–9 cm DIŞARI taşıyordu (chine boyunca koyu şerit).
      const outer = tubS.map((sv) => { const p = profileAt(sv), dk = Math.min(p.dk, p.xc * 0.9), xm = Math.min(dk + 0.45, p.xc - 0.06); return { x: side * xm, y: topSurfaceY(sv, xm) - 0.035, z: st(sv) }; });
      this.group.add(new THREE.Mesh(this.track(loft([inner, outer], { uScale: 1, vScale: 1 })), cockpitMat));
    }

    // --- Panoramik ekran (PCD): tek geniş dokunmatik ekran, göze dönük ~26° eğik ---
    const pcdTex = this.track(makeCockpitDisplayTexture(1024, 384));
    const pcdMat = this.track(new THREE.MeshStandardMaterial({ map: pcdTex, emissive: 0xffffff, emissiveMap: pcdTex, emissiveIntensity: 0.9, roughness: 0.4 }));
    pcdMat.userData.cockpit = true;
    const PS = 3.97, tilt = 26 * DEG, panelY = deck(PS) + 0.115;
    const housing = new THREE.BoxGeometry(0.86, 0.31, 0.05);
    housing.translate(0, 0, -0.03); housing.rotateX(-tilt); housing.translate(0, panelY, st(PS));
    ck(housing, 0x1d2024);
    const panel = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.80, 0.27)), pcdMat);
    panel.rotation.x = -tilt;
    panel.position.set(0, panelY, st(PS) + 0.001);
    this.group.add(panel);
    // Ekran çerçevesi (ince bezel) ve ortadaki bölme
    for (const [w, h, x, y] of [[0.84, 0.014, 0, 0.142], [0.84, 0.014, 0, -0.142], [0.014, 0.29, -0.418, 0], [0.014, 0.29, 0.418, 0], [0.008, 0.27, 0, 0]]) {
      const b = new THREE.BoxGeometry(w, h, 0.012);
      b.translate(x, y, 0.004); b.rotateX(-tilt); b.translate(0, panelY, st(PS));
      ck(b, 0x2c3036);
    }
    // Diz paneli: ekranın altından tekne tabanına
    const knee = new THREE.BoxGeometry(0.34, 0.30, 0.10);
    knee.translate(0, deck(4.05) - 0.17, st(4.05));
    ck(knee, 0x202327);
    // --- Parlama siperi (coaming): ekranın üstünde, kanopiye göre şekillenen kavisli kapak ---
    {
      const rowsS = [3.60, 3.70, 3.80, 3.88, 3.95];
      const rise = [0.05, 0.16, 0.235, 0.27, 0.265];
      const NX = 10, XW = 0.47;
      const rows = rowsS.map((sv, i) => {
        const row = [];
        for (let k = 0; k <= NX; k++) {
          const x = -XW + (2 * XW * k) / NX;
          let y = deck(sv) + rise[i] - 0.18 * x * x;
          y = Math.min(y, this.cockpitCeil(sv, x) - 0.03);
          y = Math.max(y, topSurfaceY(sv, x) - 0.004);
          row.push({ x, y, z: st(sv) });
        }
        return row;
      });
      ck(loft(rows, { uScale: 1, vScale: 1 }), 0x202327);
    }
    // --- Yan konsollar (üstleri güverte hizasının biraz altında) + düğme sıraları ---
    for (const side of [-1, 1]) {
      const con = new THREE.BoxGeometry(0.20, 0.12, 1.2);
      con.translate(side * 0.41, deck(4.95) - 0.09, st(4.95));
      ck(con, 0x26292d);
      for (let i = 0; i < 4; i++) {
        const sw = new THREE.BoxGeometry(0.15, 0.012, 0.16);
        sw.translate(side * 0.41, deck(4.95) - 0.024, st(4.52 + i * 0.27));
        ck(sw, i % 2 ? 0x3a3f45 : 0x31353a);
        const knob = new THREE.CylinderGeometry(0.011, 0.011, 0.02, 6);
        knob.translate(side * (0.41 + (i % 2 ? 0.04 : -0.04)), deck(4.95) - 0.012, st(4.52 + i * 0.27));
        ck(knob, 0xb9bec4);
      }
    }
    // HOTAS: gaz kolu (sol) ve yan çubuk (sağ)
    const thrS = 4.80, stkS = 4.95;
    { const b = new THREE.BoxGeometry(0.07, 0.04, 0.22); b.translate(-0.40, deck(thrS) - 0.02, st(thrS) + 0.02); ck(b, 0x1a1c1f);
      const g = new THREE.BoxGeometry(0.055, 0.10, 0.10); g.rotateX(0.25); g.translate(-0.40, deck(thrS) + 0.045, st(thrS)); ck(g, 0x111315); }
    { const b = new THREE.CylinderGeometry(0.04, 0.05, 0.04, 8); b.translate(0.40, deck(stkS) - 0.01, st(stkS)); ck(b, 0x1a1c1f);
      const g = new THREE.CapsuleGeometry(0.022, 0.09, 3, 8); g.rotateX(-0.2); g.translate(0.40, deck(stkS) + 0.07, st(stkS) - 0.01); ck(g, 0x111315); }
    // Pedallar
    for (const side of [-1, 1]) { const p = new THREE.BoxGeometry(0.09, 0.14, 0.03); p.rotateX(-0.35); p.translate(side * 0.15, deck(4.12) - 0.30, st(4.12)); ck(p, 0x2a2d31); }

    // --- Fırlatma koltuğu (US16E benzeri): kalça noktası ve sırt eğimi pilotla ortak ---
    const SEAT = this.seatFrame();
    const sb = (w, h, d, off, along, hex) => {
      // Sırt eksenine bağlı kutu: along = eksen boyunca (m), off = eksene dik geri (m)
      const g = new THREE.BoxGeometry(w, h, d);
      g.rotateX(SEAT.recline);
      const c = SEAT.at(along, off);
      g.translate(0, c.y, c.z);
      return ck(g, hex);
    };
    // Oturak minderi + kova yanları
    { const g = new THREE.BoxGeometry(0.46, 0.07, 0.46); g.translate(0, SEAT.hip.y - 0.075, SEAT.hip.z - 0.06); ck(g, 0x3b3f36); }
    for (const side of [-1, 1]) { const g = new THREE.BoxGeometry(0.035, 0.17, 0.50); g.translate(side * 0.245, SEAT.hip.y - 0.05, SEAT.hip.z - 0.05); ck(g, 0x2e3236); }
    { const g = new THREE.BoxGeometry(0.50, 0.10, 0.48); g.translate(0, SEAT.hip.y - 0.16, SEAT.hip.z - 0.05); ck(g, 0x2a2d31); }
    // Sırt minderi, sırt gövdesi, yan raylar, başlık kutusu
    sb(0.42, 0.62, 0.06, 0.155, 0.30, 0x3b3f36);
    sb(0.50, 0.86, 0.09, 0.225, 0.36, 0x2b2e33);
    for (const side of [-1, 1]) {
      const g = new THREE.BoxGeometry(0.04, 1.02, 0.07);
      g.rotateX(SEAT.recline);
      const c = SEAT.at(0.42, 0.20);
      g.translate(side * 0.25, c.y, c.z);
      ck(g, 0x3a3e44);
    }
    { // Başlık kutusu: üstü daralan, kaskın hemen arkasında
      const g = new THREE.CylinderGeometry(0.17, 0.20, 0.30, 4, 1);
      g.rotateY(Math.PI / 4); g.scale(1, 1, 0.62);
      g.rotateX(SEAT.recline);
      const c = SEAT.at(0.80, 0.215);
      g.translate(0, c.y, c.z);
      ck(g, 0x2b2e33);
      const pad = new THREE.BoxGeometry(0.20, 0.13, 0.03);
      pad.rotateX(SEAT.recline);
      const c2 = SEAT.at(0.76, 0.115);
      pad.translate(0, c2.y, c2.z);
      ck(pad, 0x3b3f36);
    }
    // Fırlatma kolu: oturak önünde sarı-siyah halka
    { const g = new THREE.TorusGeometry(0.055, 0.011, 5, 10, Math.PI); g.translate(0, SEAT.hip.y - 0.06, SEAT.hip.z - 0.30); ck(g, 0xe0b020); }
    // Koltuğun arkası: avyonik güvertesi (kanopi altında, arkaya doğru alçalır)
    {
      // İlk satır aynı istasyonda tekne içine iner: güvertenin önü kapalı bir yüzdür
      // (havada asılı bir levha gibi görünmez).
      const rowsS = [5.62, 5.62, 5.9, 6.2, 6.5, 6.72];
      const rise = [-0.30, 0.16, 0.13, 0.09, 0.05, 0.02];
      const NX = 8, rows = rowsS.map((sv, i) => {
        const wi = Math.min(0.55, Math.min(profileAt(sv).dk, profileAt(sv).xc * 0.9) - 0.02);
        const row = [];
        for (let k = 0; k <= NX; k++) {
          const x = -wi + (2 * wi * k) / NX;
          const y = i === 0 ? deck(sv) + rise[0] : Math.max(topSurfaceY(sv, x) - 0.004, Math.min(deck(sv) + rise[i], this.cockpitCeil(sv, x) - 0.03));
          row.push({ x, y, z: st(sv) });
        }
        return row;
      });
      ck(loft(rows, { uScale: 1, vScale: 1 }), 0x25282c);
    }

    this.buildPilot(SEAT);

    // Kanopi: eğik ön cam, en yüksek nokta pilot başı hizasında, arkaya doğru incelen damla biçimi.
    // Kesit süperelips (n=2.3): yanlar dik, üst yuvarlak. Taban düz güverteye oturur (çıkıntı/ledge yok).
    const CN = CANOPY_N;
    const profile = CANOPY;
    const M = 16;
    const shapeRow = (sv, w, h, base, grow = 0) => {
      const row = [];
      for (let k = 0; k <= M; k++) {
        const th = (k / M) * Math.PI;
        const c = Math.cos(th), sn = Math.sin(th);
        const x = Math.sign(c) * Math.pow(Math.abs(c), 2 / CN) * (w + grow);
        const y = base + Math.pow(Math.abs(sn), 2 / CN) * (h + grow);
        row.push({ x, y, z: st(sv) });
      }
      return row;
    };
    const rows = profile.map(([sv, w, h]) => shapeRow(sv, w, h, bodyTop(sv) - 0.012));
    const g = this.track(ensureOutward(loft(rows, { uScale: 1, vScale: 1 })));
    const canopy = new THREE.Mesh(g, m.canopy);
    canopy.renderOrder = 5;
    this.group.add(canopy);
    this.parts.canopy = canopy;
    // Kokpit görünümünde kanopi malzemesi değişir. Ön derleme (main.js precompile)
    // yalnızca sahnedeki malzemeleri görür; iç malzemenin programı da yükleme
    // ekranında derlensin diye hiç çizilmeyen bir vekil ağ eklenir.
    const canopyProxy = new THREE.Mesh(canopy.geometry, m.canopyInside);
    canopyProxy.visible = false;
    canopyProxy.renderOrder = canopy.renderOrder;
    this.group.add(canopyProxy);
    // Kanopi bow çerçevesi (ön üçte birde) ve ince ön cam tabanı
    const frameMat = this.track(m.dark.clone()); frameMat.side = THREE.DoubleSide;
    const interp = (sv) => this.canopyWH(sv);
    const arc = (sv, thick, depth) => {
      const [w, h] = interp(sv);
      const base = bodyTop(sv) - 0.012;
      const a = shapeRow(sv, w, h, base, 0.004), b = shapeRow(sv, w, h, base, thick).map((q) => ({ x: q.x, y: q.y, z: q.z + depth }));
      this.group.add(new THREE.Mesh(this.track(loft([a, b], { uScale: 1, vScale: 1 })), frameMat));
    };
    arc(4.3, 0.026, 0.05);
    arc(3.14, 0.025, 0.04);
    arc(6.62, 0.018, 0.035);
    // Kanopi çerçevesi: camın taban kenarı boyunca koyu, sızdırmaz kenar bandı (iki yan).
    // Camın kendi yüzeyi üzerinde, 3 mm dışarıda; gövde güvertesine oturur, boşluk yok.
    const rail = (side) => {
      const lo = [], hi = [];
      for (const [sv, w, h] of profile) {
        const base = bodyTop(sv) - 0.012, ww = w + 0.003, hh = h + 0.003, band = Math.min(0.05, hh * 0.6);
        const xAt = (dy) => ww * Math.pow(1 - Math.pow(Math.min(0.999, dy / hh), CN), 1 / CN);
        lo.push({ x: side * ww, y: base + 0.012, z: st(sv) });
        hi.push({ x: side * xAt(band + 0.012), y: base + 0.012 + band, z: st(sv) });
      }
      this.group.add(new THREE.Mesh(this.track(loft([lo, hi], { uScale: 1, vScale: 1 })), frameMat));
    };
    rail(-1); rail(1);
    // Kanopi eşiği: gövde güvertesi üzerinde, kanopi tabanını izleyen ince koyu bant (her iki yan)
    const sillProfile = profile.slice(1);
    const taper = (i) => (i === 0 || i === sillProfile.length - 1) ? 0.3 : 1;   // uçlarda incelir (dışarı taşan köşe olmaz)
    for (const side of [-1, 1]) {
      // Güverteye yatık ince şerit (dik yüzü yok): kanopi tabanındaki conta çizgisi
      const lo = sillProfile.map(([sv, w], i) => ({ x: side * (w + 0.04 * taper(i)), y: bodyTop(sv) + 0.003, z: st(sv) }));
      const hi = sillProfile.map(([sv, w], i) => ({ x: side * (w + 0.004 * taper(i)), y: bodyTop(sv) + 0.009, z: st(sv) }));
      this.group.add(new THREE.Mesh(this.track(loft([lo, hi], { uScale: 1, vScale: 1 })), frameMat));
    }
  }

  wingPlanform() {
    return { rootX: 1.35, tipX: 5.35, leRoot: 6.55, teRoot: 12.55, leTip: 9.15, teTip: 11.55, thickRoot: 0.05, thickTip: 0.035, y: -0.12, hinge: 0.76 };
  }

  // Kanat paneli kesitleri (sağ yarı için x>0; side ile aynalanır)
  wingRows(side, x0, x1, P, cStart, cEnd, K, N) {
    const rows = [];
    for (let j = 0; j <= N; j++) {
      const x = x0 + (x1 - x0) * (j / N);
      const f = (x - P.rootX) / (P.tipX - P.rootX);
      const le = P.leRoot + (P.leTip - P.leRoot) * f;
      const te = P.teRoot + (P.teTip - P.teRoot) * f;
      const chord = te - le;
      const thick = P.thickRoot + (P.thickTip - P.thickRoot) * f;
      rows.push(airfoilPoints(K, chord, thick, cStart, cEnd, true).map((p) => ({ x: side * x, y: P.y + p.y, z: st(le + chord * p.c) })));
    }
    return rows;
  }

  buildWingPanel(side, x0, x1, P, { cStart = 0, cEnd = 1, K = 10, N = 6 } = {}) {
    return closedLoft(this.wingRows(side, x0, x1, P, cStart, cEnd, K, N), { uScale: 2, vScale: 1 });
  }

  // Menteşeli yüzey: kanat kesitinden (cStart..cEnd) kapalı panel, menteşe ekseni
  // (chord kesri hc) etrafında döner. Eksen her iki kanatta +x yönlüdür: pozitif açı
  // menteşenin ARKASINI aşağı, ÖNÜNÜ yukarı indirir.
  buildHinged(side, x0, x1, P, cStart, cEnd, hc, K, N) {
    const hs = (x) => { const f = (x - P.rootX) / (P.tipX - P.rootX); const le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f; return le + (te - le) * hc; };
    const xm = (x0 + x1) / 2;
    const axis = new THREE.Vector3(x1 - x0, 0, side * (hs(x1) - hs(x0))).normalize();
    const geo = this.buildWingPanel(side, x0, x1, P, { cStart, cEnd, K, N });
    geo.translate(-side * xm, -P.y, -st(hs(xm)));
    const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
    mesh.position.set(side * xm, P.y, st(hs(xm)));
    mesh.castShadow = true;
    mesh.userData.axis = axis;
    this.group.add(mesh);
    return mesh;
  }

  // F-35A kanat kontrol yüzeyleri (kamuya açık yerleşim):
  //   - TAM AÇIKLIKLI hücum kenarı flapı (LEF), veterin ~%15'i
  //   - kanat başına TEK flaperon (iç ~%65 açıklık): flap ve yatış birlikte. Ayrı bir
  //     kanatçık YOKTUR (o F-35C'nin katlanır kanadına özgüdür).
  //   - flaperonun dışında firar kenarı sabittir.
  buildWings() {
    const P = this.wingPlanform();
    const LEF = 0.15, FLAP_X1 = 3.95;
    this.parts.flaperons = {}; this.parts.lefs = {};
    for (const side of [-1, 1]) {
      const key = side < 0 ? 'left' : 'right';
      // Sabit kanat: iç (LEF ile flaperon arası) ve dış (LEF'ten firar kenarına)
      this.paintGeos.push(this.buildWingPanel(side, P.rootX - 0.4, FLAP_X1, P, { cStart: LEF, cEnd: P.hinge, K: 10, N: 6 }));
      this.paintGeos.push(this.buildWingPanel(side, FLAP_X1, P.tipX, P, { cStart: LEF, cEnd: 1, K: 11, N: 3 }));
      // Hareketli yüzeyler sabit kanatla AYNI kesitten, menteşe çizgisinde birebir
      // birleşecek şekilde kurulur: örtüşme yok (örtüşen şeritte iki yüzey aynı
      // derinlikte kalıp titreşiyordu), nötrde yüzey kesintisiz kanat profilidir.
      this.parts.lefs[key] = this.buildHinged(side, P.rootX - 0.02, P.tipX, P, 0, LEF, LEF, 7, 6);
      this.parts.flaperons[key] = this.buildHinged(side, P.rootX + 0.04, FLAP_X1 - 0.004, P, P.hinge, 1, P.hinge, 5, 4);
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
      const geo = this.track(closedLoft(rows, { uScale: 1.5, vScale: 1 }));
      const mesh = new THREE.Mesh(geo, this.m.paint);
      mesh.position.set(0, S.y, st(S.pivot));
      mesh.castShadow = true;
      this.group.add(mesh);
      this.parts.stabs[side < 0 ? 'left' : 'right'] = mesh;
    }
    // Dikey kuyruklar (dışa 22° eğik) + dümenler
    this.parts.rudders = {};
    const cant = 22 * DEG;
    // height: dikey kuyruk kök-uç mesafesi. Toplam yükseklik (teker altından kuyruk
    // ucuna) kamuya açık 4.38 m değerine oturması için seçildi:
    //   rootY + height·cos(22°) − wheelBottomY = 0.42 + 1.95·0.927 + 2.25 = 4.48 m
    const V = { rootLE: 10.5, rootTE: 14.2, tipLE: 13.0, tipTE: 14.5, height: 1.95, rootX: 0.66, rootY: 0.42, hinge: 0.68 };
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
          rows.push(airfoilPoints(K, chord, thick, c0, c1, true).map((p) => {
            let z = st(le + chord * p.c);
            if (local) z -= st(le + chord * V.hinge) - local.dz(f);
            return { x: base.x + nrm.x * p.y - (local ? local.x : 0), y: base.y + nrm.y * p.y - (local ? local.y : 0), z };
          }));
        }
        return rows;
      };
      this.paintGeos.push(closedLoft(mkRows(0, V.hinge), { uScale: 1.5, vScale: 1 }));
      (this._fins || (this._fins = [])).push({ geo: this.paintGeos[this.paintGeos.length - 1], side, up, nrm, V });
      const hingeRoot = V.rootLE + (V.rootTE - V.rootLE) * V.hinge;
      const hingeTip = V.tipLE + (V.tipTE - V.tipLE) * V.hinge;
      const local = { x: side * V.rootX, y: V.rootY, dz: (f) => st(hingeRoot + (hingeTip - hingeRoot) * f) - st(hingeRoot) };
      // Dümen dikey kuyrukla menteşe çizgisinde birebir birleşir (örtüşme şeridi yok)
      const rudGeo = this.track(closedLoft(mkRows(V.hinge, 1, local), { uScale: 1, vScale: 1 }));
      const rud = new THREE.Mesh(rudGeo, this.m.paint);
      rud.position.set(side * V.rootX, V.rootY, st(hingeRoot));
      rud.castShadow = true;
      rud.userData.axis = new THREE.Vector3().copy(up).multiplyScalar(V.height).add(new THREE.Vector3(0, 0, st(hingeTip) - st(hingeRoot))).normalize();
      this.group.add(rud);
      this.parts.rudders[side < 0 ? 'left' : 'right'] = rud;
      this.parts['tailTip' + side] = new THREE.Vector3(side * V.rootX, V.rootY, 0).addScaledVector(up, V.height);
    }
  }

  buildNozzle() {
    const y0 = 0.08;
    const z0 = st(14.0);
    // Nozul gövdesi: bumların arasından çıkar
    // Egzoz bölümü uzunluğu, uçağın KAMUYA AÇIK toplam boyunu tutturacak şekilde
    // seçilir: burun ucu st(0) = -8.0, testere dişi ucu +7.70 => 15.70 m (yayımlanan
    // F-35A boyu 15.7 m / 51.4 ft). Önceki 1.25 m'lik bölüm uçağı 15.38 m yapıyordu.
    const NOZ_LEN = 1.57;
    const body = new THREE.CylinderGeometry(0.52, 0.56, NOZ_LEN, 30, 1, true);
    body.rotateX(Math.PI / 2);
    body.translate(0, y0, z0 + NOZ_LEN / 2);
    // Dış kabuk iki yüzlü: arkadan bakınca iç astar ile kabuk arasından kabuğun iç
    // yüzü görünür (tek yüzlüyken orada gökyüzü görünüyordu)
    const nozMat = this.track(this.m.metal.clone()); nozMat.side = THREE.DoubleSide;
    this.nozzleMat = nozMat;
    const nozzle = new THREE.Mesh(this.track(body), nozMat);
    nozzle.castShadow = true;
    this.group.add(nozzle);
    this.parts.nozzle = nozzle;
    // Testere dişli yapraklar (15 adet)
    const petals = [];
    const n = 15;
    // Testere dişleri KISA olmalı: gerçek nozulda tırtıklı kenar, yaprak boyunun
    // küçük bir kesridir. Diş boyu nozul yarıçapı kadar uzun olursa uçak arkadan
    // "sivri diş demeti" gibi görünür. 0.18 m diş + neredeyse tam yarıçap uç.
    const zA = z0 + 1.52, zB = z0 + 1.70;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
      const rA = 0.52, rB = 0.505;
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
    const petalMesh = new THREE.Mesh(petalGeo, petalMat);
    this.group.add(petalMesh);
    // İç koni ve türbin
    const inner = new THREE.CylinderGeometry(0.40, 0.50, NOZ_LEN - 0.05, 24, 1, true);
    inner.rotateX(Math.PI / 2);
    inner.translate(0, y0, z0 + NOZ_LEN / 2 - 0.005);
    const innerMat = this.track(new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.8, metalness: 0.6, side: THREE.BackSide }));
    this.group.add(new THREE.Mesh(this.track(inner), innerMat));
    // Çıkış dudağı: iç astar (r 0,40) ile dış kabuk (r 0,52) arasını kapatan halka
    const lip = new THREE.RingGeometry(0.395, 0.525, 30, 1);
    lip.translate(0, y0, z0 + NOZ_LEN - 0.004);
    const lipMesh = new THREE.Mesh(this.track(lip), nozMat);
    this.group.add(lipMesh);
    // Değişken alanlı çıkış: yapraklar ve dudak nozul ekseni etrafında ölçeklenir
    this.parts.nozzleExit = [petalMesh, lipMesh];
    this.nozzleY0 = y0;
    // Türbin arka yüzü: merkez konisi ve koyu halka (düz siyah disk yerine derinlik)
    const cone = new THREE.ConeGeometry(0.17, 0.42, 18, 1, true);
    cone.rotateX(Math.PI / 2);
    cone.translate(0, y0, z0 + 0.26);
    this.group.add(new THREE.Mesh(this.track(cone), this.track(new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.6, metalness: 0.7, side: THREE.DoubleSide }))));
    const turbine = new THREE.CircleGeometry(0.5, 24);
    turbine.translate(0, y0, z0 + 0.05);
    this.group.add(new THREE.Mesh(this.track(turbine), this.m.dark));
    // Nozul içi parıltı (askeri güçte kızıl, art yakıcıda parlak beyaz-mavi)
    const glow = new THREE.CircleGeometry(0.44, 20);
    glow.translate(0, y0, z0 + 0.12);
    this.matGlow = this.track(new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.group.add(new THREE.Mesh(this.track(glow), this.matGlow));
    // Yaprakların iç yüzü: art yakıcıda ısınır
    this.matNozzleInner = innerMat;
    innerMat.emissive = new THREE.Color(0xff4a10);
    innerMat.emissiveIntensity = 0;
    // Art yakıcı: TEK hacimsel alev. Eskiden iç içe üç saydam tüptü; tüp kenarları sert
    // çizgiler hâlinde görünüyor, çekirdek beyaza patlıyor ve alev katı bir koni gibi
    // duruyordu. Şimdi sınırlayıcı bir silindirin içinde kısa bir ışın yürüyüşü (14
    // örnek) analitik bir yoğunluk alanını tarar:
    //   - dış alev zarfı: nozul çıkışında dolu, hafif genişleyip uca doğru incelir;
    //     turuncu-sarıdan kızıla geçer, gürültüyle dalgalanır,
    //   - sıcak çekirdek: ilk ~%55'te, açık sarı-beyaz,
    //   - şok elmasları (Mach diskleri): çekirdekte düzenli aralıklı parlak halkalar,
    //   - ısı pusu: alevin ötesine uzanan, titreşen çok soluk bulanıklık (kırılma taklidi;
    //     ek render hedefi gerektirmez).
    // Çıktı önçarpımlı (yayılım + soğurma): gündüz göğünün önünde de renkli görünür,
    // gece parlar; ton eşlemesi beyaza patlamayı önler. Tek çizim çağrısı.
    const noiseTex = this.track(makeFlameNoiseTexture(128));
    const flameMat = this.track(new THREE.ShaderMaterial({
      // Örnek sayısı kaliteye bağlı: düşük kalitede 9 (zayıf mobil GPU'da dolum maliyeti)
      defines: { STEPS: this.quality === 'low' ? 9 : 14 },
      uniforms: {
        time: { value: 0 }, ab: { value: 0 }, mil: { value: 0 }, flash: { value: 0 },
        flameFrac: { value: 0.6 }, rExit: { value: 0.74 }, haze: { value: 0 },
        scaleW: { value: new THREE.Vector3(1, 1, 1) }, camLocal: { value: new THREE.Vector3() },
        noiseTex: { value: noiseTex },
      },
      vertexShader: `
        varying vec3 vLocal;
        void main() { vLocal = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `
        uniform float time; uniform float ab; uniform float mil; uniform float flash;
        uniform float flameFrac; uniform float rExit; uniform float haze;
        uniform vec3 scaleW; uniform vec3 camLocal; uniform sampler2D noiseTex;
        varying vec3 vLocal;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
        void main() {
          // Yerel uzayda ışın: silindir yarıçapı 1, z = 0 (nozul) .. 1 (pus ucu)
          vec3 ro = camLocal, rd = normalize(vLocal - camLocal);
          float a = dot(rd.xy, rd.xy), b = 2.0 * dot(ro.xy, rd.xy), c = dot(ro.xy, ro.xy) - 1.0;
          float disc = b * b - 4.0 * a * c;
          if (disc <= 0.0 || a < 1e-6) discard;
          float sq = sqrt(disc);
          float t0 = (-b - sq) / (2.0 * a), t1 = (-b + sq) / (2.0 * a);
          float tz0 = (0.0 - ro.z) / rd.z, tz1 = (1.0 - ro.z) / rd.z;
          float tn = max(max(t0, min(tz0, tz1)), 0.0), tf = min(t1, max(tz0, tz1));
          if (tf <= tn) discard;
          const int N = STEPS;
          float dt = (tf - tn) / float(N);
          float dsW = length(rd * scaleW) * dt;                 // örnek başına dünya uzunluğu (m)
          // Titreşimli başlangıç (bantlanmayı kırar); genlik yarım adım: kumlanma olmaz
          float t = tn + dt * (0.25 + 0.5 * hash(gl_FragCoord.xy + fract(time)));
          vec3 em = vec3(0.0); float tau = 0.0;
          for (int i = 0; i < N; i++) {
            vec3 p = ro + rd * t; t += dt;
            float z = p.z, r = length(p.xy);
            float n = texture2D(noiseTex, vec2(p.x * 0.31 + z * 1.7 - time * 0.9, p.y * 0.31 + z * 3.3 - time * 3.1)).r;
            float n2 = texture2D(noiseTex, vec2(p.y * 0.6 - time * 0.5, z * 7.0 - time * 6.0)).r;
            float u = z / flameFrac;                                   // alev boyunca 0..1
            // Dış alev zarfı
            float re = rExit * (1.0 + 0.22 * u) * pow(max(0.0, 1.0 - u), 0.75) * (0.86 + 0.3 * n);
            float dOut = (1.0 - smoothstep(re * 0.45, re, r)) * pow(max(0.0, 1.0 - u), 0.4) * (0.55 + 0.9 * n2);
            // Sıcak çekirdek ve şok elmasları
            // Çekirdek uca doğru incelir ama sıfıra inmez; yoğunluğu yumuşakça söner
            // (incecik bir çekirdek 12 örnekle tutarsız örneklenip kumlanıyordu)
            float rc = rExit * 0.62 * max(0.22, 1.0 - u / 0.55);
            float dCore = (1.0 - smoothstep(rc * 0.25, rc, r)) * (1.0 - smoothstep(0.42, 0.62, u));
            float ph = fract(u / 0.085 - 0.15);
            float dDia = dCore * exp(-pow((ph - 0.5) * 2.0, 2.0) * 10.0) * (1.0 - u / 0.6);
            // Isı pusu (alev ötesi, geniş, titreşen)
            float rh = rExit * (0.9 + 0.9 * z);
            float dHaze = (1.0 - smoothstep(rh * 0.15, rh, r)) * (1.0 - z) * (0.6 + 0.8 * n2);
            vec3 outC = mix(vec3(1.0, 0.60, 0.20), vec3(0.95, 0.26, 0.08), clamp(u * 1.1 + (n - 0.5) * 0.3, 0.0, 1.0));
            em += (outC * dOut * 0.85 * (ab + flash * 0.5)
                 + vec3(1.0, 0.84, 0.62) * dCore * 1.5 * (ab * 0.85 + mil * 0.25)
                 + vec3(1.0, 0.80, 0.95) * dDia * 4.5 * ab
                 + vec3(0.9, 0.93, 1.0) * dHaze * haze * 0.05 * n) * dsW;
            tau += (dOut * 0.9 * ab + dCore * 0.8 * ab + dHaze * haze * (0.02 + 0.05 * n2)) * dsW;
          }
          float alpha = 1.0 - exp(-tau * 1.6);
          gl_FragColor = vec4(em, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, side: THREE.BackSide,
      blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    }));
    const flameGroup = new THREE.Group();
    flameGroup.position.set(0, y0, zB - 0.06);
    // Sınırlayıcı hacim: yarıçap 1, boy 1 (yerel); ölçek update() içinde verilir
    const vol = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false);
    vol.rotateX(Math.PI / 2);
    vol.translate(0, 0, 0.5);
    this.flameVol = new THREE.Mesh(this.track(vol), flameMat);
    this.flameVol.renderOrder = 7;
    this.flameVol.frustumCulled = false;
    const invM = new THREE.Matrix4(), camP = new THREE.Vector3();
    this.flameVol.onBeforeRender = (renderer, scene, camera) => {
      invM.copy(this.flameVol.matrixWorld).invert();
      flameMat.uniforms.camLocal.value.setFromMatrixPosition(camera.matrixWorld).applyMatrix4(invM);
    };
    flameGroup.add(this.flameVol);
    // Nozul parıltısı: kameraya dönük yumuşak hale (uzaktan da okunur)
    this.abGlowMat = this.track(new THREE.SpriteMaterial({ map: this.track(makeGlowTexture(64)), color: 0xffa860, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.abGlow = new THREE.Sprite(this.abGlowMat);
    this.abGlow.position.set(0, y0, zB + 0.25);
    this.abGlow.renderOrder = 8;
    this.abGlow.visible = false;
    this.group.add(this.abGlow);
    flameGroup.visible = false;
    this.group.add(flameGroup);
    this.parts.flame = flameGroup;
    this.flameMats = [flameMat];
    this.abFlash = 0;
  }

  /**
   * İniş takımı (v3.1). Her bacak: gövdeye bağlı pivot (geri çekme dönüşü) -> bacak çerçevesi
   * (sabit eğim) -> sabit parçalar + amortisörle kayan grup -> tekerlek (dönüş). Bacak geometrisi
   * pivot ile tekerlek merkezinden TÜRETİLİR: tekerlek tabanı fizik geometrisiyle (wheelBottomY,
   * noseGearZ, mainGearZ, mainGearX) birebir aynı yerde kalır.
   *   - Burun takımı: öne ~23° eğik bacak, direksiyon bileziği, krom piston, çatal, arkaya giden
   *     katlanır sürükleme dikmesi, bacak önünde iki iniş/taksi lambası; ÖNE katlanır.
   *   - Ana takımlar: dikmeye yakın bacak, rakor bileziği, krom piston, makas (tork) kolları,
   *     hidrolik hatlar, gövdeye giden katlanır yan dikme, dışa ofsetli aks; ÖNE katlanır.
   *   - Lastikler profilli (yuvarlak omuz, iki diş oluğu), jantlar çanak biçimli (cıvata dairesi,
   *     iç yüzde fren diski).
   *   - Kapaklar gövde altının eğrisini izleyen ince kabuk paneller; menteşe çizgisi etrafında
   *     döner, iç yüzde kaburga ve aktüatör kolu. Yuvaların içi açık gri yapı dokusudur.
   * Çizim: bacak başına sabit + kayan + lastik + jant (4), kapak başına 2.
   */
  buildGear() {
    const m = this.m;
    this.parts.gear = {};
    const gearMat = this.track(withFxLight(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.34, metalness: 0.5, vertexColors: true }), 'f35gear'));
    const WHITE = 0xdfe2e5, CHROME = 0xf4f7fa, GREY = 0x9aa0a6, DARK = 0x3a3e43, HUB = 0xc2c6ca, BRAKE = 0x4a4d51, LENS = 0xfff4dc;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const yAxis = V(0, 1, 0), qq = new THREE.Quaternion();
    const add = (list, g, hex) => { list.push(paintVC(g.index ? g.toNonIndexed() : g, hex)); return g; };
    const rod = (list, a, b, r, hex, seg = 10) => {
      const d = b.clone().sub(a), len = d.length();
      const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
      g.applyQuaternion(qq.setFromUnitVectors(yAxis, d.normalize()));
      const c = a.clone().add(b).multiplyScalar(0.5); g.translate(c.x, c.y, c.z);
      return add(list, g, hex);
    };
    const taper = (list, y0, y1, r0, r1, hex, seg = 14) => {
      const g = new THREE.CylinderGeometry(r0, r1, Math.abs(y1 - y0), seg, 1);
      g.translate(0, (y0 + y1) / 2, 0);
      return add(list, g, hex);
    };
    const box = (list, w, h, d, x, y, z, hex) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return add(list, g, hex); };
    const ball = (list, r, p, hex) => { const g = new THREE.SphereGeometry(r, 10, 8); g.translate(p.x, p.y, p.z); return add(list, g, hex); };
    const merged = (list, mat) => { const mesh = new THREE.Mesh(this.track(mergeGeometries(list, false)), mat); mesh.castShadow = true; return mesh; };
    // Profilli lastik ve çanak jant: aks +y boyunca kurulur, sonra +x'e çevrilir
    const lathe = (pts, seg, flip) => {
      let p = pts.map(([a, b]) => new THREE.Vector2(a, flip ? -b : b));
      if (flip) p = p.reverse();
      return new THREE.LatheGeometry(p, seg);
    };
    const mkWheel = (r, w) => {
      const hw = w / 2, rr = r * 0.63;
      const tire = lathe([[rr, -hw * 0.9], [r * 0.82, -hw], [r * 0.95, -hw * 0.9], [r, -hw * 0.6], [r, -hw * 0.3], [r * 0.985, -hw * 0.22], [r, -hw * 0.14],
        [r, hw * 0.14], [r * 0.985, hw * 0.22], [r, hw * 0.3], [r, hw * 0.6], [r * 0.95, hw * 0.9], [r * 0.82, hw], [rr, hw * 0.9]], 26, false);
      tire.rotateZ(-Math.PI / 2);
      const hub = [];
      const barrel = new THREE.CylinderGeometry(rr, rr, w * 0.88, 22, 1, true); add(hub, barrel, HUB);
      for (const flip of [false, true]) {
        add(hub, lathe([[rr + 0.004, hw * 0.9], [rr * 0.94, hw * 0.78], [r * 0.42, hw * 0.5], [r * 0.27, hw * 0.58], [r * 0.16, hw * 0.82], [0.001, hw * 0.86]], 20, flip), flip ? GREY : HUB);
      }
      // Cıvata dairesi (dış yüz) ve fren diski (iç yüz)
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, b = new THREE.CylinderGeometry(r * 0.03, r * 0.03, 0.03, 6);
        b.translate(Math.cos(a) * r * 0.22, hw * 0.74, Math.sin(a) * r * 0.22); add(hub, b, DARK);
      }
      const disc = new THREE.CylinderGeometry(r * 0.52, r * 0.52, 0.025, 22); disc.translate(0, -hw * 0.6, 0); add(hub, disc, BRAKE);
      const hubG = mergeGeometries(hub, false); hubG.rotateZ(-Math.PI / 2);
      const grp = new THREE.Group();
      const tm = new THREE.Mesh(this.track(tire), m.tire); tm.castShadow = true;
      const hm = new THREE.Mesh(this.track(hubG), gearMat); hm.castShadow = true;
      grp.add(tm, hm);
      return grp;
    };
    // Bacak: pivot P, tekerlek merkezi W (takım inik, amortisör serbest), aks ofseti W.x - P.x
    const mkLeg = (P, W, r, w, build) => {
      const pivot = new THREE.Group(); pivot.position.copy(P);
      const dy = W.y - P.y, dz = W.z - P.z, L = Math.hypot(dy, dz);
      const rake = Math.atan2(-dz, -dy);
      const leg = new THREE.Group(); leg.rotation.x = rake; pivot.add(leg);
      const slide = new THREE.Group(); leg.add(slide);
      const fixedG = [], slideG = [];
      const extra = build({ L, rake, fixedG, slideG });
      leg.add(merged(fixedG, gearMat));
      slide.add(merged(slideG, gearMat));
      const wheel = mkWheel(r, w);
      wheel.position.set(W.x - P.x, -L, 0);
      if (W.x - P.x < 0) wheel.rotation.y = Math.PI;   // jantın dış yüzü dışarı baksın
      slide.add(wheel);
      this.group.add(pivot);
      return { pivot, leg, slide, wheel, L, rake, baseY: P.y, cosRake: Math.cos(rake), radius: r, extra, rest: V(0, dy, dz).normalize() };
    };
    // Gövde altını izleyen kapak: menteşe x0'da, serbest kenar x1'de; s0..s1 boyunca
    // Serbest kenar, gövdenin alt yan çizgisini (kesit noktası h6) aşmaz: ana takım yuvasının
    // ön ucunda (7.05–7.5) gövde 1,72'den dardır; sabit kenarlı kapağın dış köşesi gövde
    // yanına tırmanıp kaplamayı kesiyordu. edge(sv) = o istasyondaki azami |x|.
    const freeX = (x1, sv, edge) => (edge ? Math.sign(x1) * Math.min(Math.abs(x1), edge(sv)) : x1);
    const mkDoor = (x0, x1, s0, s1, edge = null) => {
      useRegion(x0, x1, s0, s1);
      const off = 0.011, th = 0.024, NX = 7, NS = 12;   // sık örnek: dışbükey kaplamada düz kirişler kaplamanın altına girmesin
      const rows = [];
      for (let j = 0; j <= NS; j++) {
        const sv = s0 + (s1 - s0) * (j / NS), row = [], xe = freeX(x1, sv, edge);
        for (let i = 0; i <= NX; i++) { const x = x0 + (xe - x0) * (i / NX); row.push({ x, y: below(sv, x, off), z: st(sv) }); }
        rows.push(row);
      }
      const h0 = V(x0, hullY(s0, x0) - off, st(s0)), h1 = V(x0, hullY(s1, x0) - off, st(s1));
      const mid = h0.clone().add(h1).multiplyScalar(0.5);
      const panel = closedLoft(rows.map((row) => [...row, ...row.slice().reverse().map((q) => ({ x: q.x, y: q.y + th, z: q.z }))]), { uScale: 1, vScale: 1 });
      panel.translate(-mid.x, -mid.y, -mid.z);
      // İç yüz donanımı: iki boyuna kaburga, menteşe kulakları, aktüatör kolu
      const fit = [];
      // Kaburgalar kaplamanın eğrisini izler (düz çubuk, burnun yükselen altında kaplamadan dışarı taşıyordu)
      for (const f of [0.35, 0.7]) {
        const x = x0 + (x1 - x0) * f, NSR = 6;
        const pts = [];
        for (let j = 0; j <= NSR; j++) { const sv = s0 + 0.07 + (s1 - s0 - 0.14) * (j / NSR); pts.push(V(x - mid.x, hullY(sv, x) - off + th + 0.016 - mid.y, st(sv) - mid.z)); }
        for (let j = 0; j < NSR; j++) rod(fit, pts[j], pts[j + 1], 0.011, GREY, 6);
      }
      for (const f of [0.12, 0.5, 0.88]) {
        const sv = s0 + (s1 - s0) * f, g = new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8);
        g.rotateX(Math.PI / 2); g.translate(x0 - mid.x, hullY(sv, x0) - off + th + 0.02 - mid.y, st(sv) - mid.z); add(fit, g, DARK);   // kapalıyken kaplamanın içinde
      }
      // Aktüatör bağlantı ucu: kısa. Eskiden 0,2 m'lik çubuk açık kapaktan takımın katlanma
      // yoluna taşıyor, bacak geçerken çubuğun içinden geçiyordu.
      { const x = x0 + (x1 - x0) * 0.6, sv = (s0 + s1) / 2, y = hullY(sv, x) - off + th - mid.y;
        rod(fit, V(x - mid.x, y, st(sv) - mid.z), V(x - mid.x - (x1 - x0) * 0.3, y + 0.07, st(sv) - mid.z), 0.016, GREY, 8); }
      const grp = new THREE.Group(); grp.position.copy(mid);
      const pm = new THREE.Mesh(this.track(panel), m.paint); pm.castShadow = true;
      grp.add(pm, merged(fit, gearMat));
      this.group.add(grp);
      // Açılış açısı: kapak, kapalı eğiminden bağımsız olarak DİKEY (hafifçe menteşenin dışına
      // eğik) asılı kalacak kadar döner. Sabit 95° yan yüzeyin eğimli kısmında kapağı dışa
      // doğru yatık bırakıyordu.
      const axis = h1.clone().sub(h0).normalize();
      const free = V(x1, hullY((s0 + s1) / 2, x1) - off, st((s0 + s1) / 2)).sub(mid);
      const phiC = Math.atan2(free.y, free.x);
      const phiT = -Math.PI / 2 + Math.sign(x0 - x1) * 6 * DEG;   // aşağı, menteşe tarafına 6° yatık
      let d = phiT - phiC; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      return { grp, axis, ang: d * Math.sign(axis.z || 1) };
    };
    // Yuva içi: açık gri yapı dokusu, kaplamanın 6 mm dışında (kapak kapalıyken 12 mm'deki kapak örter)
    // Çift yüzlü: yuva kaplamanın 6 mm dışında durduğundan önden/yandan neredeyse yatay bakışta
    // aradaki boşluktan yuvanın üst yüzü görünür; tek yüzlüyken orada gökyüzü (delik) görünüyordu.
    const bayMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeGearBayTexture()), roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide }));
    const mkBay = (x0, x1, s0, s1, edge = null) => {
      useRegion(x0, x1, s0, s1);
      const rows = [];
      for (let j = 0; j <= 12; j++) { const sv = s0 + (s1 - s0) * (j / 12), row = [], xe = freeX(x1, sv, edge) + (edge ? Math.sign(x1) * 0.006 : 0); for (let i = 0; i <= 8; i++) { const x = x0 + (xe - x0) * (i / 8); row.push({ x, y: below(sv, x, 0.006), z: st(sv) }); } rows.push(row); }
      const g = ensureOutward(loft(rows, { uScale: 1, vScale: 1 }), (v, o) => o.set(v.x, v.y + 1, v.z));
      // uv: u enine, v boyuna (loft: u satır = boyuna, v sütun = enine) -> yer değiştir
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) { const a = uv.getX(i), b = uv.getY(i); uv.setXY(i, b, a); }
      this.group.add(new THREE.Mesh(this.track(g), bayMat));
    };
    const wb = F35.wheelBottomY;
    // Kaplamanın GERÇEK alt yüzeyi: alt/yan loft üçgenlerine aşağıdan dikey ışın. Analitik yüzey
    // (dörtgenlerin üçgenlenmesini bilmez) birkaç mm sapıyor ve yuva kenarı yer yer kaplamaya
    // gömülüp tırtıklı görünüyordu.
    const hullMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const rc = new THREE.Raycaster(), upDir = V(0, 1, 0), org = V();
    // Işınlar yalnızca o anki kapak/yuva bölgesinin üçgenlerini tarar (bkz. regionMesh)
    let hullRegion = null;
    const useRegion = (xa, xb, sa, sb) => {
      hullRegion = [regionMesh(this._hull, V(Math.min(xa, xb) - 0.05, -10, st(Math.min(sa, sb)) - 0.05), V(Math.max(xa, xb) + 0.05, 10, st(Math.max(sa, sb)) + 0.05), hullMat)];
    };
    let hullNy = 1;
    const hullY = (sv, x) => {
      rc.set(org.set(x, -6, st(sv)), upDir);
      const hit = rc.intersectObjects(hullRegion, false);
      hullNy = hit.length ? Math.abs(hit[0].face.normal.y) : 1;
      return hit.length ? hit[0].point.y : hullBottomY(sv, x);
    };
    // Kaplamanın DIŞINA dik mesafe: eğik fasette düşey ofset 1/|ny| kadar büyütülür. Sabit
    // düşey ofset 57° eğimli dış fasette yalnızca birkaç mm kalıyor; kapalı kapağın üçgenleri
    // kaplamanın burkulmuş dörtlülerinin içine giriyor, arkadaki yuva dokusu çizgi çizgi
    // görünüyordu (alttan yakın bakışta).
    const below = (sv, x, off) => { const y = hullY(sv, x); return y - off / Math.max(0.4, hullNy); };
    // Toplanma: bacağın dinlenme yönünü hedef yöne çeviren eksen ve açı (pivot çerçevesinde)
    const stowTo = (g, target) => {
      const t = target.clone().normalize();
      g.retAxis = g.rest.clone().cross(t).normalize();
      g.stow = Math.acos(Math.min(1, Math.max(-1, g.rest.dot(t))));
      return g;
    };

    // ---------------- Burun takımı ----------------
    {
      const r = 0.28, w = 0.17;
      // Muylu tekerleğin 0,30 m gerisinde: bacak ~12° öne yatık, neredeyse dik (gerçek F-35A).
      // Eskiden muylu 0,6–0,75 m gerideydi; bacak 23–28° öne eğik, "yamuk" görünüyordu.
      // Katlanırken amortisör önce 0,30 m kısalır (aşağıdaki shrink): kısalan bacağın
      // tekerleği öne süpürürken yuvanın ön kenarına ve EOTS'a varmaz.
      const P = V(0, bottomSurfaceY(4.0, 0) + 0.20, st(4.0));
      const W = V(0, wb + r, F35.noseGearZ);
      const g = mkLeg(P, W, r, w, ({ L, rake, fixedG, slideG }) => {
        rod(fixedG, V(-0.15, 0, 0), V(0.15, 0, 0), 0.06, WHITE, 12);                     // muylu
        taper(fixedG, 0, -0.50 * L, 0.085, 0.078, WHITE);                                // dış silindir
        taper(fixedG, -0.47 * L, -0.53 * L, 0.104, 0.104, GREY);                         // direksiyon bileziği
        box(fixedG, 0.06, 0.08, 0.10, 0.09, -0.50 * L, 0.04, DARK);                      // direksiyon eyleyicisi
        rod(fixedG, V(0.05, -0.04, 0.06), V(0.05, -0.46 * L, 0.06), 0.011, DARK, 6);     // hidrolik hat
        // Sürükleme dikmesi: bacağın ÖNÜNDEN öne-yukarı yuva tavanına (dizli). Öne toplanan
        // takımda dikme öndedir; eskiden arkaya gidip yuvanın arka kenarının gerisinde
        // kaplamayı deliyordu. Gövde ucu muyluya yakın: katlanınca gövdenin içinde kalır.
        const toLeg = (y, z) => V(0, y * Math.cos(rake) + z * Math.sin(rake), -y * Math.sin(rake) + z * Math.cos(rake));
        const a = V(0, -0.40 * L, -0.07), b = toLeg(0.06, -0.34), k = a.clone().lerp(b, 0.5).add(V(0, -0.02, -0.09));
        rod(fixedG, a, k, 0.032, WHITE); rod(fixedG, k, b, 0.032, WHITE); ball(fixedG, 0.045, k, DARK);
        // Lambalar: bacak önünde braket + iki mercek (ileri bakar)
        const lp = V(0, -0.60 * L, -0.12);
        box(fixedG, 0.16, 0.10, 0.07, 0, lp.y, lp.z + 0.03, GREY);
        for (const x of [-0.045, 0.045]) {
          const lens = new THREE.CylinderGeometry(0.036, 0.036, 0.03, 12);
          lens.rotateX(Math.PI / 2 - rake); lens.translate(x, lp.y, lp.z - 0.01); add(fixedG, lens, LENS);
        }
        // Kayan grup: krom piston, çatal tacı, çatal plakaları, aks, tork kolları
        const yc = -L + r + 0.07;
        taper(slideG, -0.48 * L, yc, 0.056, 0.056, CHROME);
        box(slideG, w + 0.13, 0.06, 0.15, 0, yc, 0, WHITE);
        for (const x of [-(w / 2 + 0.035), w / 2 + 0.035]) box(slideG, 0.03, r + 0.08, 0.10, x, -L + (r + 0.07) / 2 - 0.01, 0, WHITE);
        rod(slideG, V(-(w / 2 + 0.06), -L, 0), V(w / 2 + 0.06, -L, 0), 0.028, GREY, 10);
        rod(fixedG, V(0, -0.53 * L, -0.07), V(0, -0.62 * L, -0.15), 0.016, GREY, 6);
        rod(slideG, V(0, -0.62 * L, -0.15), V(0, yc + 0.02, -0.07), 0.016, GREY, 6);
        return { lamp: V(0, lp.y, lp.z - 0.03) };
      });
      // Pivot çerçevesinde lamba konumu (takım inik)
      const lampP = g.extra.lamp.clone().applyAxisAngle(V(1, 0, 0), g.rake);
      // Öne ve hafifçe yukarı katlanır (yuvanın içine)
      stowTo(g, V(0, 0.10, -1));
      this.parts.gear.nose = Object.assign(g, {
        lift: 0.22, flat: 0, lampLocal: lampP, shrink: 0.30,
        // Yuva, tekerleğin ön kenarının süpürdüğü yay kadar öne uzar (EOTS 2,46'da biter)
        doors: [mkDoor(-0.30, -0.006, 2.48, 4.50), mkDoor(0.30, 0.006, 2.48, 4.50)],
      });
      mkBay(-0.30, 0.30, 2.48, 4.50);
    }
    // ---------------- Ana takımlar ----------------
    // Gövde kaplamasının (istasyonlar arası doğrusal loft) alt yan noktası h6'nın |x|'i, 2 cm pay
    const sideEdge = (sv) => {
      const S = HULL_S; let j = 0; while (j < S.length - 2 && S[j + 1] < sv) j++;
      const t = Math.min(1, Math.max(0, (sv - S[j]) / (S[j + 1] - S[j])));
      return this.sectionPoints(S[j])[6].x * (1 - t) + this.sectionPoints(S[j + 1])[6].x * t - 0.02;
    };
    for (const side of [-1, 1]) {
      const r = 0.37, w = 0.29;
      const legX = 1.60, bx0 = 1.36, bx1 = 1.72;   // yuva alt fasette kalır (dış kenar gövdenin en geniş yerine taşmaz)
      const P = V(side * legX, bottomSurfaceY(8.95, legX) + 0.28, st(8.95));
      const W = V(side * F35.mainGearX, wb + r, F35.mainGearZ);
      const g = mkLeg(P, W, r, w, ({ L, rake, fixedG, slideG }) => {
        rod(fixedG, V(0, 0, -0.19), V(0, 0, 0.19), 0.075, WHITE, 12);                     // muylu (x ekseni dönüşü için z boyunca gövdeye bağlı)
        rod(fixedG, V(-side * 0.17, 0, 0), V(side * 0.07, 0, 0), 0.06, WHITE, 12);       // dışa kısa: yuva kenarında (1,72) yan kaplamadan dışarı taşmasın
        taper(fixedG, 0, -0.58 * L, 0.106, 0.095, WHITE);                                 // dış silindir
        taper(fixedG, -0.555 * L, -0.605 * L, 0.118, 0.118, GREY);                        // rakor bileziği
        rod(fixedG, V(side * 0.07, -0.04, 0.08), V(side * 0.07, -0.56 * L, 0.08), 0.012, DARK, 6);   // hidrolik hatlar
        rod(fixedG, V(side * 0.03, -0.04, 0.105), V(side * 0.03, -0.56 * L, 0.09), 0.010, 0x7a5a2a, 6);
        // Yan dikme: bacak ortasından içe-yukarı gövdeye (dizli); gövde ucu yuva tavanında,
        // böylece dikme kapak menteşesinin (1,36) içinden değil yuvanın içinden geçer
        const a = V(0, -0.44 * L, 0.04), b = V(-side * 0.40, 0.16, 0.10), k = a.clone().lerp(b, 0.48).add(V(0, -0.08, 0.02));
        rod(fixedG, a, k, 0.036, WHITE); rod(fixedG, k, b, 0.036, WHITE); ball(fixedG, 0.05, k, DARK);
        // Tork (makas) kolları: üst sabit, alt kayan
        rod(fixedG, V(0, -0.60 * L, -0.10), V(0, -0.72 * L, -0.20), 0.02, GREY, 6);
        rod(slideG, V(0, -0.72 * L, -0.20), V(0, -L + 0.13, -0.10), 0.02, GREY, 6);
        ball(slideG, 0.028, V(0, -0.72 * L, -0.20), DARK);
        // Kayan grup: krom piston, aks gövdesi, aks, fren kaliperi
        taper(slideG, -0.56 * L, -L + 0.08, 0.072, 0.072, CHROME);
        box(slideG, 0.17, 0.19, 0.20, 0, -L, 0, WHITE);
        const ox = W.x - P.x;
        rod(slideG, V(0, -L, 0), V(ox * 1.02, -L, 0), 0.05, GREY, 10);
        box(slideG, 0.05, 0.12, 0.10, ox - Math.sign(ox) * (w * 0.32), -L + r * 0.42, -0.06, DARK);
        return null;
      });
      // Öne katlanır; tekerlek yuvaya DİK (bıçak gibi) girer: 0,74 m çaplı tekerlek ancak
      // 0,29 m genişliğiyle 0,36 m'lik ağızdan geçer. Yuvanın ön ucunda gövde daralır, ağız
      // tekerlekten ancak birkaç santim geniştir; bu yüzden üç hareket birlikte ayarlandı:
      //  - içe kayma 2° (fazlası tekerleğin iç omzunu menteşe hattının içinden, asılı kapaktan geçirir),
      //  - katlanırken tekerlek bacak ekseni etrafında 15° yatar (flat): üstü içe eğilir, gövde
      //    içine önce giren üst kısım yan duvardan uzak kalır, alt kısım ağzın dış yarısından geçer,
      //  - merkeze dönüş 9,75°, katlanmanın %60'ından sonra (ağızdan geçince).
      // Takım inikken (gear 1) üçü de sıfırdır: yer teması değişmez. Parametreler, 0,01 adımlı
      // taramada takım kenarlarının ne kaplamayı (yuva ağzı dışında) ne de kendi açık kapağını
      // kestiği bölgenin ortasından seçildi (komşu değerler de 0/0).
      stowTo(g, V(-side * Math.sin(2 * DEG), 0.08, -Math.cos(2 * DEG)));
      this.parts.gear[side < 0 ? 'left' : 'right'] = Object.assign(g, {
        lift: 0.22, flat: side * 15 * DEG, yaw: side * 9.75 * DEG, yawFrom: 0.6,
        doors: [mkDoor(side * bx0, side * (bx1 - 0.006), 7.05, 9.15, sideEdge)],
      });
      mkBay(side * bx0, side * (bx1 - 0.006), 7.05, 9.15, sideEdge);
    }
  }

  buildDetails() {
    const m = this.m;
    // EOTS: burun altı alçak, çok yüzlü safir pencere. Eskisi burundan 22 cm sarkan ters
    // bir koniydi (yandan sivri bir diken); gerçek pencere gövdeye yakın, basık bir kubbe.
    const eots = new THREE.SphereGeometry(1, 7, 3, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2).toNonIndexed();
    eots.scale(0.17, 0.14, 0.26);
    // Açık üst kenar her noktada gövde alt yüzeyinin 1,5 cm içinde kalır
    let rimY = -Infinity;
    for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; rimY = Math.max(rimY, bottomSurfaceY(2.2 + 0.26 * Math.cos(a), 0.17 * Math.sin(a)) + 0.015); }
    eots.translate(0, rimY, st(2.2));
    eots.computeVertexNormals(); // indekssiz: yüzey başına düz normal (fasetler)
    this.group.add(new THREE.Mesh(this.track(eots), m.glass));
    // Silah bombesi: sol kanat kökü üst yüzeyi
    const gun = new THREE.CapsuleGeometry(0.16, 1.6, 4, 10);
    gun.rotateX(Math.PI / 2);
    gun.translate(-1.1, 0.22, st(8.7));
    this.paintGeos.push(gun);
    const gunPort = new THREE.CircleGeometry(0.06, 8);
    gunPort.translate(-1.1, 0.22, st(7.85) - 0.01);
    this.group.add(new THREE.Mesh(this.track(gunPort), m.dark));
    // Silah yuvaları: buildWeaponBays (gerçek iç hacim + menteşeli kapaklar). Eski düz kapak
    // kabukları ve koyu aralık levhası kaldırıldı. İniş takımı yuvaları buildGear'da.
    // Kuyruk kancası kaportası (gövde altı, orta hat) ve kanca
    const hookFair = new THREE.BoxGeometry(0.26, 0.20, 1.7);
    hookFair.rotateX(0.05);
    hookFair.translate(0, bottomSurfaceY(13.2, 0) - 0.05, st(13.2));
    this.paintGeos.push(hookFair);
    const hook = new THREE.BoxGeometry(0.07, 0.07, 0.5);
    hook.translate(0, bottomSurfaceY(14.2, 0) - 0.10, st(14.15));
    this.group.add(new THREE.Mesh(this.track(hook), m.dark));
    // Yakıt ikmal kapağı (sırt)
    const rec = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.5, 0.36)), this.track(new THREE.MeshStandardMaterial({ color: 0x5c6167, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 })));
    rec.position.set(0, bodyTop(7.5) + 0.012, st(7.5));
    rec.rotation.x = -Math.PI / 2;
    rec.userData.decal = true;
    this.group.add(rec);
    // Formasyon ışık şeritleri: buildMarkings (kaplamaya oturtulur)
    // Antenler
    const ant1 = new THREE.BoxGeometry(0.03, 0.18, 0.4); ant1.translate(0.3, bodyBottom(6.2) - 0.09, st(6.2));
    this.paintGeos.push(ant1);
    const ant2 = new THREE.BoxGeometry(0.03, 0.14, 0.3); ant2.translate(0, bodyTop(10.2) + 0.07, st(10.2));
    this.paintGeos.push(ant2);
  }

  buildLights() {
    const P = this.wingPlanform();
    const glowTex = this.track(makeGlowTexture(64));
    const mkLight = (color, x, y, z, size = 0.8) => {
      const g = new THREE.Group();
      const bulb = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.028, 6, 5)), this.track(new THREE.MeshBasicMaterial({ color })));
      const spr = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      spr.scale.set(size, size, 1);
      g.add(bulb, spr);
      g.position.set(x, y, z);
      g.userData.sprite = spr; g.userData.size = size;
      this.group.add(g);
      return g;
    };
    // Seyir ışıkları: sol kırmızı, sağ yeşil, kuyruk beyaz (sürekli).
    // Lensler kanat ucu kesitinin DIŞ yüzeyinde durur (tipX + 1 cm) — eskiden 5 cm
    // İÇERİDEYDİ, yani ampul kanadın içine gömülüyor ve yalnızca parıltı görünüyordu.
    // Kırmızı/yeşil hücum kenarında, beyaz çakar firar kenarındadır.
    const lensX = P.tipX + 0.01;
    this.lights = {
      navLeft: mkLight(0xff2a2a, -lensX, P.y, st(P.leTip + 0.20), 0.16),
      navRight: mkLight(0x2aff5a, lensX, P.y, st(P.leTip + 0.20), 0.16),
      tail: mkLight(0xffffff, 0, 0.42, st(14.62), 0.14),
      // Çarpışma önleyici flaşörler: kanat uçları (beyaz, çift flaş), gövde üst/alt (kırmızı beacon)
      strobeLeft: mkLight(0xffffff, -lensX, P.y, st(P.teTip - 0.30), 0.30),
      strobeRight: mkLight(0xffffff, lensX, P.y, st(P.teTip - 0.30), 0.30),
      beaconTop: mkLight(0xff3020, 0, bodyTop(9.6) + 0.06, st(9.6), 0.24),
      beaconBottom: mkLight(0xff3020, 0, bodyBottom(9.6) - 0.06, st(9.6), 0.24),
    };
    this.parts.strobe = this.lights.strobeLeft; // geriye dönük uyumluluk
    // İniş/taksi ışığı: burun takımı üzerinde, öne-aşağı bakan spot
    const spot = new THREE.SpotLight(0xfff2dc, 0, 420, 24 * DEG, 0.45, 0.6);
    spot.castShadow = false;
    const noseGear = this.parts.gear.nose.pivot;
    // Işık burun takımının (indirilmiş) konumuna yerleştirilir ama gövde grubuna
    // bağlanır: takım içeri alınınca pivot GİZLENİR ve ona bağlı bir ışık sahnenin
    // ışık sayısını değiştirip tüm gölgelendiricileri yeniden derletirdi.
    noseGear.updateMatrix();
    const lampL = this.parts.gear.nose.lampLocal;
    spot.position.copy(lampL).applyMatrix4(noseGear.matrix);
    const target = new THREE.Object3D();
    target.position.copy(lampL).add(new THREE.Vector3(0, -6.0, -40)).applyMatrix4(noseGear.matrix);
    this.group.add(spot); this.group.add(target);
    spot.target = target;
    this.landingSpot = spot;
    this.landingLens = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff4e0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.landingLens.scale.set(0.5, 0.5, 1);
    this.landingLens.position.copy(lampL).add(new THREE.Vector3(0, 0, -0.03));
    this.landingLens.visible = false;
    noseGear.add(this.landingLens);
    this.landingLightsOn = false;
  }

  setLandingLights(on) { this.landingLightsOn = !!on; }

  buildMarkings() {
    const P = this.wingPlanform();
    const L = this.livery || {};
    const macro = this.m.macro || getSharedMaterials().macro;
    const decalMat = (map, extra = {}) => applyPaintDetail(this.track(new THREE.MeshStandardMaterial(Object.assign({ map, transparent: true, roughness: 0.72, metalness: 0.2, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }, extra))), macro);
    const insig = this.track(makeMilInsigniaTexture(L.insignia || 'starbar', 512));
    const mat = decalMat(insig);
    // Kaplamaya OTURAN dekal: teğet düzlemde ızgara kurulur, her köşe dış normal boyunca
    // gövde kaplamasına ışınla izdüşürülür ve 5 mm dışarı alınır. Düz levha dekallar eğri
    // gövdede kenarlarından havaya kalkıp "üstüne yapıştırılmış çıkartma" gibi duruyordu.
    const skinMat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
    const skin = [...(this._hull || []), this._skinTop].filter(Boolean).map((g) => new THREE.Mesh(g, skinMat));
    const rc = new THREE.Raycaster(), tmp = new THREE.Vector3(), dirV = new THREE.Vector3();
    const conform = (material, center, nOut, upHint, w, h, uvRect = null, nx = 10, ny = 6, targets = skin, off = 0.005) => {
      const n = nOut.clone().normalize();
      const u = upHint.clone().sub(n.clone().multiplyScalar(upHint.dot(n))).normalize();
      const r = u.clone().cross(n);
      const g = new THREE.PlaneGeometry(w, h, nx, ny);
      const pa = g.attributes.position, uv = g.attributes.uv;
      // Işın parçası düzlemin 0,8 m dışından 1 m içine: bu hacmi kapsayan üçgenler yeterli
      const bb = new THREE.Box3();
      for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const q = center.clone().addScaledVector(r, a * w / 2).addScaledVector(u, b * h / 2);
        bb.expandByPoint(q.clone().addScaledVector(n, 0.8)).expandByPoint(q.addScaledVector(n, -1.0));
      }
      bb.expandByScalar(0.02);
      const region = [regionMesh(targets.map((t) => t.geometry), bb.min, bb.max, skinMat)];
      for (let i = 0; i < pa.count; i++) {
        const p = center.clone().addScaledVector(r, pa.getX(i)).addScaledVector(u, pa.getY(i));
        rc.set(tmp.copy(p).addScaledVector(n, 0.8), dirV.copy(n).negate());
        const hit = rc.intersectObjects(region, false)[0];
        if (hit) {
          const hn = hit.face.normal.clone(); if (hn.dot(n) < 0) hn.negate();
          p.copy(hit.point).addScaledVector(hn, off);
        }
        pa.setXYZ(i, p.x, p.y, p.z);
        if (uvRect) { const [u0, v0, u1, v1] = uvRect; uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), 1 - v1 + uv.getY(i) * (v1 - v0)); }
      }
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(this.track(g), material);
      mesh.userData.decal = true;
      this.group.add(mesh);
      return mesh;
    };
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const size = 1.5;
    // Yıldız-çubuk 2:1 (gerçek oran 4R x 2R), demir haçı kare.
    const insigW = L.insigniaSquare ? size : size * 2;
    // Kanat amblemi: sol kanat ÜSTÜ ve sağ kanat ALTI (ABD hava kuvvetleri ve donanmasının
    // ortak yerleşimi); kanat profiline oturtulur.
    for (const [side, up] of [[-1, 1], [1, -1]]) {
      const x = side * 3.4;
      const f = (3.4 - P.rootX) / (P.tipX - P.rootX);
      const le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f;
      const sMid = le + (te - le) * 0.42;
      const g = new THREE.PlaneGeometry(insigW, size, 14, 8);
      const o = new THREE.Object3D();
      o.position.set(x, P.y, st(sMid));
      o.rotation.x = up > 0 ? -Math.PI / 2 : Math.PI / 2;
      o.rotation.z = up > 0 ? 0 : Math.PI;
      o.updateMatrix();
      g.applyMatrix4(o.matrix);
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const vx = Math.abs(pa.getX(i)), sv = pa.getZ(i) + F35.cgStation;
        const ff = (vx - P.rootX) / (P.tipX - P.rootX);
        const l = P.leRoot + (P.leTip - P.leRoot) * ff, t = P.teRoot + (P.teTip - P.teRoot) * ff, ch = t - l;
        const th = P.thickRoot + (P.thickTip - P.thickRoot) * ff;
        pa.setY(i, P.y + up * (naca((sv - l) / ch, th) * ch + 0.006));
      }
      g.computeVertexNormals();
      const mesh = new THREE.Mesh(this.track(g), mat);
      mesh.userData.decal = true;
      this.group.add(mesh);
    }
    const navy = L.insignia === 'navy';
    const markColor = L.markColor || '#9aa0a8';
    for (const side of [-1, 1]) {
      if (navy) {
        // DONANMA: ulusal amblem ön gövde yanında, hava alığının hemen arkasında (F/A-18 ve
        // F-35C ile aynı yer); arka gövdede alçak görünürlüklü "NAVY" yazısı.
        conform(mat, V(side * 1.62, -0.50, st(6.35)), V(side, -0.12, 0), V(0, 1, 0), 0.92, 0.46);
      } else {
        // USAF / Luftwaffe: amblem arka gövde yanında, kanat kökünün hemen üstünde. Tümüyle
        // TEK bir kesit fasetinin üzerinde durur (chine ile üst omuz arasındaki dik faset);
        // eskiden iki fasetin kırık çizgisine biniyor, yıldız ortadan kırılmış görünüyordu.
        conform(mat, V(side * 1.62, 0.15, st(10.6)), V(side, 0.34, 0), V(0, 1, 0), L.insigniaSquare ? 0.4 : 0.8, 0.4);
      }
    }
    if (navy) {
      const navyTxt = decalMat(this.track(makeTextTexture('NAVY', { w: 512, h: 128, font: 'bold 104px Arial', color: markColor })));
      const modex = decalMat(this.track(makeTextTexture(L.modex || '100', { w: 256, h: 128, font: 'bold 104px Arial', color: markColor })));
      for (const side of [-1, 1]) {
        conform(navyTxt, V(side * 1.45, 0.22, st(10.75)), V(side, 0.75, 0), V(0, 1, 0), 1.0, 0.25, null, 12, 4);
        conform(modex, V(side * 0.86, -0.13, st(2.15)), V(side, -0.25, 0), V(0, 1, 0), 0.46, 0.23, null, 8, 4);
      }
    }
    // Bakım ve uyarı işaretleri (düşük görünürlüklü koyu gri; tek atlas, tek çizim)
    const sten = decalMat(this.track(makeStencilAtlas()), { roughness: 0.75 });
    const A = STENCIL_ATLAS;
    const fwd = V(0, 0, -1);
    for (const side of [-1, 1]) {
      // Fırlatma koltuğu uyarı üçgeni: kanopi eşiğinin dışında
      conform(sten, V(side * 0.78, topSurfaceY(4.25, 0.78), st(4.25)), V(side * 0.55, 1, 0), fwd, 0.13, 0.13, A.warn, 4, 4);
      // Hava alığı uyarısı: dudağın önünde, chine altında
      conform(sten, V(side * 0.97, -0.10, st(3.9)), V(side, -0.1, 0), V(0, 1, 0), 0.32, 0.16, A.intake, 6, 4);
      // NO STEP: flaperon menteşesinin önünde, kanat üstü
      { const x = 2.45, f = (x - P.rootX) / (P.tipX - P.rootX), le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f, sv = le + (te - le) * 0.66;
        const g = conform(sten, V(side * x, P.y + 0.06, st(sv)), V(0, 1, 0), fwd, 0.36, 0.09, A.nostep, 4, 2);
        // kanat yüzeyine oturt (gövde ışın listesinde kanat yok): profil üst yüzeyi
        const pa = g.geometry.attributes.position;
        for (let i = 0; i < pa.count; i++) {
          const vx = Math.abs(pa.getX(i)), s2 = pa.getZ(i) + F35.cgStation, ff = (vx - P.rootX) / (P.tipX - P.rootX);
          const l = P.leRoot + (P.leTip - P.leRoot) * ff, t = P.teRoot + (P.teTip - P.teRoot) * ff, ch = t - l, th = P.thickRoot + (P.thickTip - P.thickRoot) * ff;
          pa.setY(i, P.y + naca((s2 - l) / ch, th) * ch + 0.005);
        }
        pa.needsUpdate = true; g.geometry.computeVertexNormals(); }
      // Kriko noktası: silah yuvasının önünde, gövde altı (yuva kapağının üstünde olmaz)
      conform(sten, V(side * 0.85, bottomSurfaceY(6.65, 0.85), st(6.65)), V(0, -1, 0), fwd, 0.09, 0.13, A.jack, 2, 2);
    }
    // Kurtarma oku (sol, kanopiyi gösterir), veri bloğu (sol ön gövde), yakıt bilgisi (sırt, ikmal kapağının arkası)
    conform(sten, V(-0.86, topSurfaceY(3.7, 0.86), st(3.7)), V(-0.6, 1, 0), fwd, 0.48, 0.16, A.rescue, 6, 3);
    conform(sten, V(-0.92, -0.16, st(3.2)), V(-1, -0.2, 0), V(0, 1, 0), 0.34, 0.11, A.data, 6, 3);
    conform(sten, V(0, bodyTop(7.95), st(7.95)), V(0, 1, 0), V(1, 0, 0), 0.30, 0.075, A.fuel, 4, 2);
    conform(sten, V(0.9, -0.2, st(3.25)), V(1, -0.2, 0), V(0, 1, 0), 0.22, 0.055, A.ground, 4, 2);
    // Kapalı silah yuvası kapaklarının dikiş çizgileri ve uyarı yazısı. Yalnızca yamanın
    // üzerindedir: yuva açılınca yamayla birlikte gizlenir (kapaklar havada çizgi taşımaz).
    if (this._bayPatch && this.parts.weaponBays && !this.forStatic) {
      const pm = [new THREE.Mesh(this._bayPatch, skinMat)];
      const segs = [], B = BAY, sm = (B.s0 + B.s1) / 2;
      for (const side of [-1, 1]) {
        for (const x of [B.x0 + 0.004, B.xs, B.x1 - 0.004]) segs.push(conform(sten, V(side * x, hullBottomY(sm, x), st(sm)), V(0, -1, 0), fwd, 0.007, B.s1 - B.s0 - 0.012, A.line, 1, 24, pm, 0.0015));
        for (const sv of [B.s0 + 0.004, B.s1 - 0.004]) segs.push(conform(sten, V(side * (B.x0 + B.x1) / 2, hullBottomY(sv, 0.6), st(sv)), V(0, -1, 0), V(1, 0, 0), 0.007, B.x1 - B.x0 - 0.012, A.line, 1, 8, pm, 0.0015));
        segs.push(conform(sten, V(side * 0.86, hullBottomY(10.25, 0.86), st(10.25)), V(0, -1, 0), fwd, 0.36, 0.29, A.bay, 4, 4, pm, 0.0015));
      }
      const geo = mergeGeometries(segs.map((s2) => s2.geometry), false);
      for (const s2 of segs) this.group.remove(s2);
      const seams = new THREE.Mesh(this.track(geo), sten);
      seams.userData.decal = true;
      this.group.add(seams);
      this.parts.weaponBays.seams = seams;
    }

    // Dikey kuyruk (sabit kısım) ışın hedefi: kuyruk işaretleri ve ışıkları yalnızca ona
    // oturtulur (gövde ışını kökte kuyruktan önce gövdeye çarpabilir).
    const finMesh = (fin) => fin.mesh || (fin.mesh = new THREE.Mesh(fin.geo, skinMat));
    // Formasyon şerit ışıkları (F-35 yerleşimi): her iki yanda kokpitin arkasında gövde
    // omzunda, ve dikey kuyrukların dış yüzünde uca yakın, veter boyunca. Keskin kenarlı
    // mercek + yüzeye taşan çok hafif hale; ikisi de kaplamaya oturtulur. Eskiden düz
    // levhalar kanadın altında havada, burunda kaplamaya gömülü ve kuyrukta kod yazısının
    // üstündeydi.
    {
      const lensMat = this.track(new THREE.MeshBasicMaterial({ map: this.track(makeStripLightTexture()), transparent: true, alphaTest: 0.04, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
      const haloMat = this.track(new THREE.MeshBasicMaterial({ map: this.track(makeStripGlowTexture()), color: 0x63f57f, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
      const strip = (center, n, upv, len, wid, targets = skin) => {
        // hale merceğin 4 mm altında: aynı yükseklikte olunca eğri kaplamada üçgenleri
        // yer yer merceğin önüne geçip onu beyaza boyuyordu
        conform(lensMat, center, n, upv, len, wid, null, 12, 1, targets, 0.007);
        conform(haloMat, center, n, upv, len * 1.5, wid * 6, null, 12, 4, targets, 0.003);
      };
      for (const side of [-1, 1]) {
        // Gövde omzu: chine üstündeki dik faset, 7.0–7.9 istasyonları
        strip(V(side * 1.56, 0.17, st(7.45)), V(side, 0.33, 0), V(0, 1, 0), 0.85, 0.045);
        // Dikey kuyruk dış yüzü: hücum kenarına paralel, kenarın 0,32 m gerisinde, yükseklik
        // kesri ~0,58 (kuyruk kodu ile seri numarasının arasında, ikisine de değmez).
        const fin = (this._fins || []).find((f) => f.side === side);
        if (fin) {
          const FV = fin.V, hF = 0.58;
          const leDir = fin.up.clone().multiplyScalar(FV.height).add(V(0, 0, FV.tipLE - FV.rootLE)).normalize();
          const c = V(side * FV.rootX, FV.rootY, st(FV.rootLE + (FV.tipLE - FV.rootLE) * hF + 0.32)).addScaledVector(fin.up, FV.height * hF);
          strip(c, fin.nrm.clone(), fin.nrm.clone().cross(leDir), 0.58, 0.045, [finMesh(fin)]);
        }
      }
    }

    // Kuyruk kodu ve seri numarası: kuyruk profiline oturtulur. Eskiden düz levhalar sabit
    // 4,5–5 cm dışarıdaydı; kökte profil daha kalın olduğundan seri numarası kuyruğun içinde
    // kalıp yalnızca bir iki harfi görünüyordu. İkisi de dümen menteşesinin önünde kalır.
    const txtMat = decalMat(this.track(makeTextTexture(L.tailCode || 'LF', { w: 256, h: 128, font: 'bold 96px Arial', color: markColor })));
    const serialMat = decalMat(this.track(makeTextTexture(L.serial || 'AF 15-5108', { w: 512, h: 128, font: 'bold 70px Arial', color: markColor })));
    for (const fin of this._fins || []) {
      const at = (h, s) => V(fin.side * fin.V.rootX, fin.V.rootY, st(s)).addScaledVector(fin.up, h);
      conform(txtMat, at(1.63, 13.3), fin.nrm, fin.up, 0.7, 0.35, null, 8, 4, [finMesh(fin)]);
      conform(serialMat, at(0.53, 12.5), fin.nrm, fin.up, 1.2, 0.3, null, 12, 3, [finMesh(fin)]);
    }
  }

  finalize() {
    const geos = this.paintGeos.map((g) => (g.index ? g.toNonIndexed() : g));
    for (const g of geos) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    // Normaller kırışma açısıyla: 38°'den yumuşak eğimler (gövde kesitleri, burun,
    // kanat profili) PÜRÜZSÜZ gölgelenir; chine, firar kenarı ve panel kenarları gibi
    // keskin kırılmalar korunur. Eskiden birleşik geometri yüz yüz düz gölgeleniyordu
    // ve burunda/gövdede üçgen desenleri görünüyordu. Yalnızca yükleme anında çalışır.
    const flat = mergeGeometries(geos, false);
    const merged = this.track(toCreasedNormals(flat, 38 * DEG));
    flat.dispose();
    const body = new THREE.Mesh(merged, this.m.paint);
    body.castShadow = true;
    body.receiveShadow = true;
    this.group.add(body);
    this.parts.body = body;
    this.paintGeos.forEach((g) => g.dispose());
    this.mergeStatic();
    this.group.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    this.wheelSpin = 0;
  }

  /**
   * Çizim çağrısı azaltma: grubun DOĞRUDAN çocuğu olan, hiçbir yerde canlandırılmayan
   * ya da gizlenip açılmayan ağlar malzemelerine göre tek ağa birleştirilir (kokpit
   * parçaları, hava alığı kanalları, panel aralıkları, nozul içi, dekallar...).
   * Hareketli yüzeyler, takımlar, kanopi, alev, ışıklar ve this.parts altında başvurusu
   * tutulan her şey korunur. Görünüm birebir aynıdır; yalnızca çizim sayısı düşer.
   */
  mergeStatic() {
    const keep = new Set();
    const mark = (v, depth = 0) => {
      if (!v || depth > 3) return;
      if (v.isObject3D) { v.traverse((o) => keep.add(o)); return; }
      if (Array.isArray(v)) { for (const x of v) mark(x, depth + 1); return; }
      if (typeof v === 'object' && !v.isVector3) for (const k of Object.keys(v)) mark(v[k], depth + 1);
    };
    mark(this.parts);
    if (this.lights) mark(this.lights);
    if (this.landingSpot) keep.add(this.landingSpot);
    const groups = new Map();
    for (const o of this.group.children) {
      if (!o.isMesh || keep.has(o) || !o.visible || o.renderOrder !== 0 || o.children.length) continue;
      const g = o.geometry;
      if (!g.attributes.position || g.morphAttributes.position) continue;
      const key = o.material.uuid + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0) + (o.userData.decal ? 'd' : '');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      // Köşe renkli malzeme (kanal gölgelemesi): renkler korunur
      const keepColor = list.every((o) => o.geometry.attributes.color);
      const geos = list.map((o) => {
        o.updateMatrix();
        let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
        g.applyMatrix4(o.matrix);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv' && !(n === 'color' && keepColor)) g.deleteAttribute(n);
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((g) => g.dispose());
      if (!merged) continue;
      const m = new THREE.Mesh(this.track(merged), list[0].material);
      m.castShadow = list[0].castShadow; m.receiveShadow = list[0].receiveShadow;
      m.userData.decal = !!list[0].userData.decal;
      for (const o of list) this.group.remove(o);
      this.group.add(m);
    }
  }

  // ---------------------------------------------------------------------------
  // İç silah yuvaları (v3.2). Alt kaplama yuva ağzında KESİKTİR (buildFuselage); kapalıyken
  // ağzı, kaplamanın AYNI köşelerinden ve aynı UV'lerinden kurulan tek bir yama doldurur:
  // dikiş, aralık ya da kayma olamaz ve panel dokusu kesintisiz sürer. Bir fırlatma
  // başlayınca yama gizlenir, yerini yine aynı köşelerden kurulan menteşeli kapaklar alır
  // (geçişte görüntü değişmez) ve yuva içi görünür olur. Kapalıyken iç kısım çizilmez:
  // uçuşta ek çizim çağrısı yalnızca yama ve kapak çizgileridir.
  //
  // Yuva içi: duvarlar ve tavan ağız kenarındaki kaplama köşelerinden başlar; çerçeveler,
  // kirişler, hidrolik/elektrik hatları, menteşe yatakları, fırlatıcı (ejektör) gövdesi ve
  // piston kovanları. Renk dış boyadan koyu, derinlere doğru köşe renkleriyle kararır (ortam
  // kapanması taklidi); malzeme gölge alır ve ortam haritasını yansıtır.
  // ---------------------------------------------------------------------------
  buildWeaponBays() {
    const B = BAY, info = this._bay, m = this.m;
    const rows = info.rows, iS0 = info.iS0, iS1 = info.iS1;
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    const wb = this.parts.weaponBays = { bays: [], interior: null, patch: null, seams: null, active: false };
    for (let i = iS0; i <= iS1; i++) {
      const r = rows[i], c0 = r[8], c1 = r[12];
      if (Math.abs(c0.x - B.x0) > 1e-4 || Math.abs(c1.x - B.x1) > 1e-4) console.warn('weapon bay edge off its station line', i, c0.x, c1.x);
    }
    // Kaplama köşelerinden alt-loft: satırlar iS0..iS1, sütunlar kA..kB (sınırlar dahil)
    const sub = (kA, kB, mutate = null) => {
      const sec = [];
      for (let i = iS0; i <= iS1; i++) sec.push(rows[i].slice(kA, kB + 1).map((q, k) => (mutate ? mutate(q, i, kA + k) : q)));
      return ensureOutward(loft(sec, { uvAt: (i, k) => info.uv(i + iS0, k + kA) }), bodyAxisRef);
    };
    // Kapalı yama: iki yanın ağız dörtlüleri, birebir kaplama üçgenleri. Kapak ayrım
    // şeridi (cA–cB, 2,4 mm) 2,5 mm içeri basık: yakından ince bir oluk olarak okunur.
    const groove = (q, i, k) => ((k === 4 || k === 5 || k === 9 || k === 10) && i > iS0 && i < iS1 ? { x: q.x, y: q.y + 0.0025, z: q.z } : q);
    const patchGeo = mergeGeometries([sub(2, 6, groove), sub(8, 12, groove)].map((g) => g.toNonIndexed()), false);
    patchGeo.computeVertexNormals();
    const patch = new THREE.Mesh(this.track(patchGeo), m.paint);
    patch.castShadow = true; patch.receiveShadow = true;
    this.group.add(patch);
    wb.patch = patch;
    this._bayPatch = patchGeo;
    if (this.forStatic) return;

    // ---- Malzeme ve köşe renkli yapı parçaları ----
    const bayMat = this.track(withFxLight(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.3, envMapIntensity: 0.75, vertexColors: true }), 'f35bay'));
    this.bayMat = bayMat;
    const BASE = 0x737a82, FRAME = 0x8a9199, DEEP = 0x3e4349, LINE = 0x2c2f33, BRASS = 0x8f7038, BLUE = 0x4c6782, KNUCKLE = 0x8d949c, HOUSING = 0x60666e, SEAL = 0x1d1f22;
    const col = (g, hex, ao = null) => {
      const c = new THREE.Color(hex), p = g.attributes.position, a = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const f = ao ? ao(p.getX(i), p.getY(i), p.getZ(i)) : 1; a[i * 3] = c.r * f; a[i * 3 + 1] = c.g * f; a[i * 3 + 2] = c.b * f; }
      g.setAttribute('color', new THREE.BufferAttribute(a, 3));
      return g;
    };
    const ni = (g) => (g.index ? g.toNonIndexed() : g);
    const qq = new THREE.Quaternion(), yAxis = V(0, 1, 0);
    const rod = (list, a, b, r, hex, seg = 8) => {
      const d = b.clone().sub(a), len = d.length();
      const g = new THREE.CylinderGeometry(r, r, len, seg, 1);
      g.applyQuaternion(qq.setFromUnitVectors(yAxis, d.normalize()));
      const c = a.clone().add(b).multiplyScalar(0.5); g.translate(c.x, c.y, c.z);
      list.push(col(ni(g), hex)); return g;
    };
    const box = (list, w, h, d, x, y, z, hex) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); list.push(col(ni(g), hex)); return g; };
    // Derinliğe göre kararma: ağız kenarında 1, tavanda ~0,58
    const aoDepth = (y, yOpen) => 0.7 + 0.3 * Math.min(1, Math.max(0, (B.ceil - y) / Math.max(0.05, B.ceil - yOpen)));
    const yOpenAt = (s) => hullBottomY(s, B.mx);

    const interior = [];
    for (const side of [-1, 1]) {
      const sx = (x) => side * x;
      const kc0 = side > 0 ? 8 : 6, kc1 = side > 0 ? 12 : 2;            // menteşe sütunları (c0, c1)
      const kSpan = side > 0 ? [8, 9, 10, 11, 12] : [6, 5, 4, 3, 2];      // c0 -> c1
      const stS = []; for (let i = iS0; i <= iS1; i++) stS.push(i);
      // Yan duvarlar: alt kenar = ağız kenarındaki kaplama köşeleri, üst kenar = tavan
      const wall = (k, refX) => {
        const sec = stS.map((i) => { const q = rows[i][k]; return [q, { x: q.x, y: B.ceil, z: q.z }]; });
        const g = ensureOutward(loft(sec), (v, o) => o.set(refX, v.y, v.z));
        return col(ni(g), BASE, (x, y, z) => aoDepth(y, -0.98));
      };
      interior.push(wall(kc0, sx(B.x0 - 1)), wall(kc1, sx(B.x1 + 1)));
      // Ön/arka duvar: ağız kenarı satırı -> tavan
      const endWall = (i, refDz) => {
        const sec = kSpan.map((k) => { const q = rows[i][k]; return [q, { x: q.x, y: B.ceil, z: q.z }]; });
        const g = ensureOutward(loft(sec), (v, o) => o.set(v.x, v.y, v.z + refDz));
        return col(ni(g), BASE, (x, y, z) => aoDepth(y, -0.98));
      };
      interior.push(endWall(iS0, -1), endWall(iS1, 1));
      // Tavan
      {
        const sec = stS.map((i) => kSpan.map((k) => ({ x: rows[i][k].x, y: B.ceil, z: rows[i][k].z })));
        const g = ensureOutward(loft(sec), (v, o) => o.set(v.x, v.y + 1, v.z));
        interior.push(col(ni(g), BASE, (x) => 0.7 + 0.05 * Math.sin(x * 9)));
      }
      // Çerçeveler: tavanda enine kiriş + iki duvarda dikme (U kesit gibi), 0,5 m arayla
      for (let sv = B.s0 + 0.45; sv < B.s1 - 0.2; sv += 0.5) {
        const z = st(sv), yo0 = hullBottomY(sv, B.x0), yo1 = hullBottomY(sv, B.x1);
        box(interior, B.x1 - B.x0 - 0.02, 0.045, 0.035, sx((B.x0 + B.x1) / 2), B.ceil - 0.0225, z, FRAME);
        box(interior, 0.035, B.ceil - yo0 - 0.05, 0.035, sx(B.x0 + 0.0175), (B.ceil + yo0 + 0.05) / 2, z, FRAME);
        box(interior, 0.035, B.ceil - yo1 - 0.05, 0.035, sx(B.x1 - 0.0175), (B.ceil + yo1 + 0.05) / 2, z, FRAME);
      }
      // Duvar kirişleri (boyuna) ve tavan kenar kirişleri
      for (const [x, y, w, h] of [[B.x0 + 0.012, -0.70, 0.024, 0.03], [B.x1 - 0.012, -0.70, 0.024, 0.03], [B.x0 + 0.03, B.ceil - 0.02, 0.06, 0.04], [B.x1 - 0.03, B.ceil - 0.02, 0.06, 0.04]]) {
        box(interior, w, h, B.s1 - B.s0 - 0.04, sx(x), y, st((B.s0 + B.s1) / 2), FRAME);
      }
      // Hidrolik / elektrik hatları (iç duvar boyunca) ve kablo kanalı (dış duvar)
      const sA = st(B.s0 + 0.04), sB = st(B.s1 - 0.04);
      rod(interior, V(sx(B.x0 + 0.05), B.ceil - 0.075, sA), V(sx(B.x0 + 0.05), B.ceil - 0.075, sB), 0.011, LINE, 6);
      rod(interior, V(sx(B.x0 + 0.05), B.ceil - 0.105, sA), V(sx(B.x0 + 0.05), B.ceil - 0.105, sB), 0.009, BRASS, 6);
      rod(interior, V(sx(B.x0 + 0.05), B.ceil - 0.13, sA), V(sx(B.x0 + 0.05), B.ceil - 0.13, sB), 0.008, BLUE, 6);
      rod(interior, V(sx(B.x1 - 0.06), B.ceil - 0.09, sA), V(sx(B.x1 - 0.06), B.ceil - 0.09, sB), 0.02, LINE, 8);
      for (let sv = B.s0 + 0.3; sv < B.s1; sv += 0.6) box(interior, 0.03, 0.05, 0.02, sx(B.x0 + 0.04), B.ceil - 0.105, st(sv), DEEP);   // hat kelepçeleri
      // Fırlatıcı (ejektör) gövdesi: tavanda füze ekseni üzerinde; altında iki piston kovanı
      box(interior, 0.26, 0.07, 2.3, sx(B.mx), B.ceil - 0.035, st(B.ms + 0.0), HOUSING);
      box(interior, 0.30, 0.012, 2.36, sx(B.mx), B.ceil - 0.006, st(B.ms), DEEP);
      for (const ds of [-0.62, 0.62]) {
        const g = new THREE.CylinderGeometry(0.042, 0.042, 0.014, 12); g.translate(sx(B.mx), B.ceil - 0.063, st(B.ms + ds)); interior.push(col(ni(g), DEEP));
      }
      // Ön duvarda donanım kutusu ve konektör, arka duvarda havalandırma ızgarası
      box(interior, 0.34, 0.16, 0.07, sx(B.mx), B.ceil - 0.15, st(B.s0) + 0.035, HOUSING);
      box(interior, 0.08, 0.05, 0.03, sx(B.mx + 0.1), B.ceil - 0.15, st(B.s0) + 0.085, BRASS);
      box(interior, 0.4, 0.12, 0.02, sx(B.mx), -0.62, st(B.s1) - 0.012, DEEP);
      // Menteşe yatakları (sabit yarı): kapak kulaklarının arasına
      for (const sv of [7.42, 8.32, 9.27, 10.22]) for (const [x, hx] of [[B.x0, 1], [B.x1, -1]]) {
        const y = hullBottomY(sv + 0.075, x) + 0.012;
        const g = new THREE.CylinderGeometry(0.017, 0.017, 0.06, 10); g.rotateX(Math.PI / 2); g.translate(sx(x + hx * 0.002), y, st(sv + 0.075)); interior.push(col(ni(g), KNUCKLE));
        box(interior, 0.03, 0.05, 0.05, sx(x + hx * 0.02), y + 0.03, st(sv + 0.075), FRAME);
      }
    }
    const interiorGeo = mergeGeometries(interior, false);
    interior.forEach((g) => g.dispose());
    const inner = new THREE.Mesh(this.track(interiorGeo), bayMat);
    inner.castShadow = true; inner.receiveShadow = true; inner.visible = false;
    this.group.add(inner);
    wb.interior = inner;

    // ---- Kapaklar, ray ve füzeler ----
    const missileGeo = getMissileGeometry(), missileMat = getMissileMaterial();
    for (const side of [-1, 1]) {
      const bay = { side, doors: [], rail: null, missile: null };
      // Kapak: dış yüz = kaplama köşeleri (boya, birebir UV), içte köşe renkli levha + kaburgalar + menteşe kolları
      const mkDoor = (kA, kB, hingeK, freeX) => {
        const hx = rows[iS0][hingeK].x;
        const h0 = V(hx, hullBottomY(B.s0, Math.abs(hx)) + 0.012, st(B.s0)), h1 = V(hx, hullBottomY(B.s1, Math.abs(hx)) + 0.012, st(B.s1));
        const axis = h1.clone().sub(h0).normalize();
        const skin = sub(kA, kB); skin.translate(-h0.x, -h0.y, -h0.z);
        const grp = new THREE.Group(); grp.position.copy(h0);
        const sm = new THREE.Mesh(this.track(skin), m.paint); sm.castShadow = true;
        grp.add(sm);
        const parts = [];
        // İç levha: dış yüzün 4 mm–34 mm içi (kapalı kalın panel: açılınca kenar kalınlığı görünür)
        const sec = []; for (let i = iS0; i <= iS1; i++) { const r = rows[i].slice(kA, kB + 1); sec.push([...r.map((q) => ({ x: q.x, y: q.y + 0.004, z: q.z })), ...r.slice().reverse().map((q) => ({ x: q.x, y: q.y + 0.034, z: q.z }))]); }
        parts.push(col(ni(closedLoft(sec)), 0x6a7178, (x, y, z) => 0.92 + 0.08 * Math.sin(z * 3.1)));
        // Kenar bandı: dış kaplama ile iç levha arasındaki 4 mm yarık (açık kapağa yandan
        // bakınca piksel çizgisi) kapatılır; iki yönlü sarım, ince olduğundan maliyeti yok.
        {
          const per = [];
          for (let k = kA; k <= kB; k++) per.push(rows[iS0][k]);
          for (let i = iS0 + 1; i <= iS1; i++) per.push(rows[i][kB]);
          for (let k = kB - 1; k >= kA; k--) per.push(rows[iS1][k]);
          for (let i = iS1 - 1; i >= iS0; i--) per.push(rows[i][kA]);
          const pos = [];
          for (let j = 0; j < per.length - 1; j++) {
            const a = per[j], b = per[j + 1], a2 = [a.x, a.y + 0.0045, a.z], b2 = [b.x, b.y + 0.0045, b.z];
            const A = [a.x, a.y, a.z], Bq = [b.x, b.y, b.z];
            pos.push(...A, ...Bq, ...a2, ...Bq, ...b2, ...a2, ...A, ...a2, ...Bq, ...Bq, ...a2, ...b2);
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
          g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
          g.computeVertexNormals();
          parts.push(col(g, 0x6a7178));
        }
        const ax = Math.abs(hx), fx = Math.abs(freeX), sgn = Math.sign(hx);
        const at = (sv, x, dy = 0.034) => V(sgn * x, hullBottomY(sv, x) + dy, st(sv));
        // Boyuna kaburgalar (yüzeyi izleyen parçalar) ve enine kaburgalar
        for (const f of [0.33, 0.67]) { const x = ax + (fx - ax) * f; let prev = null; for (let j = 0; j <= 8; j++) { const sv = B.s0 + 0.06 + (B.s1 - B.s0 - 0.12) * j / 8, p = at(sv, x, 0.046); if (prev) rod(parts, prev, p, 0.011, 0x7a8189, 6); prev = p; } }
        for (let sv = B.s0 + 0.25; sv < B.s1 - 0.1; sv += 0.62) rod(parts, at(sv, ax + (fx - ax) * 0.06, 0.046), at(sv, ax + (fx - ax) * 0.94, 0.046), 0.01, 0x7a8189, 6);
        // Serbest kenar contası
        rod(parts, at(B.s0 + 0.03, fx - (fx - ax) * 0.02, 0.036), at(B.s1 - 0.03, fx - (fx - ax) * 0.02, 0.036), 0.007, SEAL, 6);
        // Menteşe kolları (kaz boynu) + kulaklar: yatakların arasında, kapakla döner
        for (const sv of [7.42, 8.32, 9.27, 10.22]) {
          const hp = h0.clone().lerp(h1, (sv - B.s0) / (B.s1 - B.s0));
          const g = new THREE.CylinderGeometry(0.018, 0.018, 0.075, 10); g.rotateX(Math.PI / 2); g.translate(hp.x, hp.y, hp.z); parts.push(col(ni(g), KNUCKLE));
          const foot = at(sv, ax + (fx - ax) * 0.08, 0.04);
          rod(parts, foot, hp.clone().add(V(0, 0.01, 0)), 0.014, 0x7a8189, 8);
        }
        const fit = mergeGeometries(parts, false); parts.forEach((g) => g.dispose());
        fit.translate(-h0.x, -h0.y, -h0.z);
        const fm = new THREE.Mesh(this.track(fit), bayMat); fm.castShadow = true; fm.receiveShadow = true;
        grp.add(fm);
        grp.visible = false;
        this.group.add(grp);
        // Açık konum: kapak dik asılır, serbest kenarı yuva merkezine doğru BAY.tilt kadar yatık
        const sm2 = (B.s0 + B.s1) / 2, hm = h0.clone().lerp(h1, 0.5);
        const r0 = V(freeX, hullBottomY(sm2, fx), st(sm2)).sub(hm); r0.addScaledVector(axis, -r0.dot(axis)).normalize();
        const tgt = V(Math.sign(freeX - hx) * Math.sin(B.tilt), -Math.cos(B.tilt), 0); tgt.addScaledVector(axis, -tgt.dot(axis)).normalize();
        const ang = Math.atan2(axis.dot(r0.clone().cross(tgt)), r0.dot(tgt));
        return { grp, axis, ang };
      };
      if (side > 0) bay.doors.push(mkDoor(8, 9, 8, B.xs), mkDoor(10, 12, 12, B.xs));
      else bay.doors.push(mkDoor(5, 6, 6, -B.xs), mkDoor(2, 4, 2, -B.xs));
      // Fırlatıcı rayı: kiriş, pistonlar (kovanlara girer), kancalar ve yan destek pabuçları
      const rail = new THREE.Group();
      rail.position.set(side * B.mx, B.railY, st(B.ms));
      const rp = [];
      box(rp, 0.11, 0.035, 2.1, 0, 0, 0, FRAME);
      box(rp, 0.13, 0.008, 2.0, 0, -0.019, 0, DEEP);
      for (const ds of [-0.62, 0.62]) rod(rp, V(0, 0.015, ds), V(0, 0.33, ds), 0.024, 0xb9bec4, 10);   // krom pistonlar
      for (const ds of [-0.45, 0.45]) {
        box(rp, 0.05, 0.03, 0.09, 0, -0.035, ds, DEEP);                                              // kancalar
        for (const k of [-1, 1]) { const g = new THREE.BoxGeometry(0.03, 0.05, 0.05); g.rotateZ(k * 0.65); g.translate(k * 0.07, -0.045, ds + 0.13); rp.push(col(ni(g), HOUSING)); }   // yan destekler
      }
      const railGeo = mergeGeometries(rp, false); rp.forEach((g) => g.dispose());
      const railMesh = new THREE.Mesh(this.track(railGeo), bayMat); railMesh.castShadow = true;
      rail.add(railMesh);
      const missile = new THREE.Mesh(missileGeo, missileMat);
      missile.position.set(0, B.my - B.railY, 0);
      missile.castShadow = true;
      rail.add(missile);
      rail.visible = false;
      this.group.add(rail);
      bay.rail = rail; bay.missile = missile;
      wb.bays.push(bay);
    }
  }

  /**
   * Silah yuvası durumu (weapons.js her kare çağırır). i: 0 sol, 1 sağ.
   * inner/outer: kapak açıklık kesri (0 kapalı, 1 açık; yerleşme salınımı için 1'i biraz
   * aşabilir), rail: ejektör stroku kesri (0..1), armed: füze rayda mı.
   * Herhangi bir yuva kullanımdayken yama gizlenir, kapaklar ve iç kısım çizilir.
   */
  setWeaponBay(i, inner, outer, rail, armed) {
    const wb = this.parts.weaponBays;
    if (!wb || !wb.bays.length) return;
    const bay = wb.bays[i];
    bay.state = { inner, outer, rail, armed };
    const d0 = bay.doors[0], d1 = bay.doors[1];
    d0.grp.quaternion.setFromAxisAngle(d0.axis, d0.ang * inner);
    d1.grp.quaternion.setFromAxisAngle(d1.axis, d1.ang * outer);
    bay.rail.position.y = BAY.railY - BAY.stroke * rail;
    bay.missile.visible = !!armed;
    const busy = (b) => b.state && (b.state.inner > 0 || b.state.outer > 0 || b.state.rail > 0);
    const active = wb.bays.some(busy);
    if (active !== wb.active) {
      wb.active = active;
      wb.patch.visible = !active;
      if (wb.seams) wb.seams.visible = !active;
      wb.interior.visible = active;
      for (const b of wb.bays) { for (const d of b.doors) d.grp.visible = active; b.rail.visible = active; }
    }
  }

  /** Raydaki füzenin dünya dönüşümü (fırlatılan füze tam buradan devralır: ışınlanma yok). */
  /**
   * Dış kanat istasyonları (F-35A 2 ve 10 numaralı istasyon): kanat altı pilonu, fırlatma rayı
   * ve AIM-120C. İç yuvadaki füzeler kapaklar kapalıyken görünmez; uçakta GÖRÜNEN füzeler
   * bunlardır. Füze ağı ve malzemesi iç yuvadakilerle aynıdır (getMissileGeometry/Material),
   * uçak grubunun çocuğudur (uçakla birlikte hareket eder) ve uçuş modeline etkisi yoktur
   * (yalnızca görsel). Pilon gövde boyasına birleşir: ek çizim çağrısı yalnızca iki füzedir.
   */
  buildStores() {
    this.parts.stores = [];
    const P = this.wingPlanform();
    // Füze ortası 9,45: tam sarkık hücum kenarı flapının ucu radomdan ~7 cm yukarıda kalır,
    // kuyruk kanatçıkları aşağı sapmış flaperonun ~17 cm altında. Pilon sabit kanat kutusunda
    // (LEF menteşesi %15, flaperon menteşesi %76 veter): hareketli yüzeye bağlı değil.
    const X = 2.9, SM = 9.45, R = MISSILE.r;
    const f = (X - P.rootX) / (P.tipX - P.rootX);
    const le = P.leRoot + (P.leTip - P.leRoot) * f, te = P.teRoot + (P.teTip - P.teRoot) * f, ch = te - le;
    const th = P.thickRoot + (P.thickTip - P.thickRoot) * f;
    const lowerY = (sv) => P.y - naca((sv - le) / ch, th) * ch;          // kanat alt yüzeyi
    const s0 = SM - 0.95, s1 = SM + 0.85;                               // pilon boyu 1,8 m
    const yb = Math.min(lowerY(s0), lowerY(s1)) - 0.22;                 // pilon alt kenarı (düz)
    const axisY = yb - 0.035 - R;                                       // füze ekseni (ray + kulak)
    for (const side of [-1, 1]) {
      const x = side * X;
      // Pilon: alt kenarı düz, üstü kanat profiline 3 cm gömülü, önü süpürülmüş kesik
      const g = new THREE.BoxGeometry(0.1, 1, s1 - s0, 1, 1, 8);
      const pa = g.attributes.position;
      for (let i = 0; i < pa.count; i++) {
        const sv = (s1 + s0) / 2 + pa.getZ(i), top = pa.getY(i) > 0;
        const y = top ? lowerY(sv) + 0.03 : yb;
        // Alt kenar boyunca doğrusal yeniden eşleme: ön uç 0,35 m geride (süpürülmüş), arka uç 0,12 m
        const sNew = top ? sv : (s0 + 0.35) + (sv - s0) / (s1 - s0) * ((s1 - 0.12) - (s0 + 0.35));
        pa.setXYZ(i, x + pa.getX(i) * (top ? 1 : 0.8), y, st(sNew));
      }
      g.computeVertexNormals();
      this.paintGeos.push(g);
      // Fırlatma rayı (LAU-128 benzeri): pilonun altında koyu ray
      const rail = new THREE.BoxGeometry(0.075, 0.035, 1.5);
      rail.translate(x, yb - 0.0175, st(SM + 0.05));
      this.group.add(new THREE.Mesh(this.track(rail), this.m.metal));
      if (this.forStatic) continue;
      const mesh = new THREE.Mesh(getMissileGeometry(), getMissileMaterial());
      mesh.position.set(x, axisY, st(SM));
      mesh.castShadow = true;
      mesh.name = 'AIM-120C STA' + (side < 0 ? '2' : '10');
      this.group.add(mesh);
      this.parts.stores.push({ side, station: side < 0 ? 2 : 10, mesh, armed: true });
    }
  }

  /** Dış istasyondaki füzenin dünya dönüşümü (ileride fırlatma bu dönüşümden devralır). */
  storeWorld(i, outPos, outQuat) {
    const st0 = this.parts.stores[i];
    st0.mesh.updateWorldMatrix(true, false);
    st0.mesh.matrixWorld.decompose(outPos, outQuat, _tmpScale);
  }

  storedMissileWorld(i, outPos, outQuat) {
    const bay = this.parts.weaponBays.bays[i];
    bay.missile.updateWorldMatrix(true, false);
    bay.missile.matrixWorld.decompose(outPos, outQuat, _tmpScale);
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
  update({ elevator = 0, aileron = 0, rudder = 0, flaps = 0, lef = 0, toeIn = 0, nozzle = null, gearComp = 0, gear = 1, throttle = 0, afterburner = 0, time = 0, groundSpeed = 0, dt = 0, camDist = 25 }) {
    const p = this.parts;
    // Yüzeyler FCS'nin eyleyici çıktısını (hız sınırlı) izler; ayrıca burada da kısa
    // bir yumuşatma yapılır ki 60 Hz çizimde 120 Hz fiziğin basamakları görünmesin.
    // Tüm açılar kamuya açık sınıf değerleridir; işaretler fizikle aynıdır.
    const k = 1 - Math.exp(-Math.max(dt, 0) / 0.035);
    const sm = this._sm || (this._sm = { e: elevator, a: aileron, r: rudder, lef, toe: toeIn });
    if (dt > 0) {
      sm.e += (elevator - sm.e) * k; sm.a += (aileron - sm.a) * k; sm.r += (rudder - sm.r) * k;
      sm.lef += (lef - sm.lef) * k; sm.toe += (toeIn - sm.toe) * k;
    } else { sm.e = elevator; sm.a = aileron; sm.r = rudder; sm.lef = lef; sm.toe = toeIn; }
    // Tümüyle hareketli stabilatörler: simetrik yunuslama + diferansiyel yatış payı
    const stab = -sm.e * 20 * DEG;
    // Sağa yatış: sağ stabilatörün firar kenarı YUKARI (sağ flaperon gibi), sol aşağı.
    // (Ölçümle doğrulandı; önceki sürümde diferansiyel ters yöndeydi.)
    p.stabs.left.rotation.x = stab + sm.a * 8 * DEG;
    p.stabs.right.rotation.x = stab - sm.a * 8 * DEG;
    const setHinge = (mesh, angle) => { mesh.quaternion.setFromAxisAngle(mesh.userData.axis, angle); };
    // Flaperon: simetrik kısım YALNIZCA flap kolu konumu (fizikteki flapsPos, hız
    // sınırlı: kol 0 => tam 0°, LAND => 30°) + diferansiyel yatış. Sağa yatış: sağ
    // flaperon yukarı, sol aşağı. Kol 0 ve yatış komutu yokken kanat düz profildir.
    const sym = flaps * 30 * DEG;
    const diff = sm.a * 20 * DEG;
    setHinge(p.flaperons.right, clamp(sym - diff, -30 * DEG, 35 * DEG));
    setHinge(p.flaperons.left, clamp(sym + diff, -30 * DEG, 35 * DEG));
    // Hücum kenarı flapları: AoA ile aşağı (negatif açı = burun kenarı aşağı)
    const lefA = -sm.lef * 30 * DEG;
    setHinge(p.lefs.right, lefA);
    setHinge(p.lefs.left, lefA);
    // İkiz dümenler: sapma için AYNI yöne, kalkış rotasyonunda / yüksek AoA'da toe-in
    // (firar kenarları içe). Pozitif açı her iki dümenin firar kenarını +x'e (sağa)
    // götürür: burnu sağa sapmak için firar kenarları SAĞA döner (ölçümle doğrulandı;
    // önceki sürümde dümenler ters yöne sapıyordu).
    const rud = sm.r * 25 * DEG, toe = sm.toe * 14 * DEG;
    setHinge(p.rudders.right, rud - toe);
    setHinge(p.rudders.left, rud + toe);
    // İniş takımı ve kapaklar — sıralı ve yumuşak: indirmede önce kapaklar açılır
    // (gear 0 -> 0,22), takım görünür olur ve son evrede gövdeden aşağı iner, sonra
    // yumuşak hızlanma/yavaşlamayla (smoothstep) öne katlı konumdan dikey konuma döner
    // (0,26 -> 0,97). Toplamada aynı sıra tersten işler: takım katlanıp gövdeye çekilir,
    // EN SON kapaklar kapanır. Eskiden kapak ve bacak aynı doğrusal açıyla dönüyordu.
    this.wheelSpin += (groundSpeed / 0.35) * dt;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const doorT = ss(0.0, 0.22, gear), swing = ss(0.26, 0.97, gear), lift = 1 - ss(0.22, 0.42, gear);
    for (const key of ['nose', 'left', 'right']) {
      const g = p.gear[key];
      g.pivot.visible = gear > 0.235;
      g.pivot.quaternion.setFromAxisAngle(g.retAxis, (1 - swing) * g.stow);
      // Geç sapma: tekerlek yuva ağzından geçtikten SONRA gövde içinde merkeze doğru döner
      if (g.yaw) g.pivot.quaternion.premultiply(_gearYawQ.setFromAxisAngle(_Y_AXIS, g.yaw * ss(g.yawFrom, 1, 1 - swing)));
      g.slide.rotation.y = (1 - swing) * g.flat;
      g.pivot.position.y = g.baseY + lift * g.lift;
      g.wheel.rotation.x = this.wheelSpin * 0.35 / g.radius;
      // Amortisör: kayan grup bacak ekseni boyunca; düşey bileşeni gearComp (main.js
      // syncAircraft gövdeyi aynı miktarda alçaltır, tekerlek yerde kalır)
      // Katlanma başında amortisör kısalır (burun takımı), açılışın sonunda uzar
      g.slide.position.y = gearComp / g.cosRake + (g.shrink ? g.shrink * (1 - ss(0.55, 0.95, gear)) : 0);
      for (const d of g.doors) d.grp.quaternion.setFromAxisAngle(d.axis, d.ang * doorT);
    }
    // Değişken alanlı nozul: rölantide açık, askeri güçte kısılı, AB'de tam açık
    // (motor modelinin nozul durumu; yoksa gaz kolundan türetilir)
    const noz = nozzle !== null ? nozzle : Math.max(0, 0.55 * (1 - throttle / 0.6)) + afterburner;
    const kn = 0.95 + 0.11 * Math.min(1, noz);
    for (const m of p.nozzleExit) { m.scale.set(kn, kn, 1); m.position.y = this.nozzleY0 * (1 - kn); }
    // Motor parıltısı, nozul ısısı ve art yakıcı
    const mil = Math.max(0, (throttle - 0.55) / 0.45);
    // Ateşleme parlaması: AB seviyesi hızla yükselirken kısa flaş
    const abRise = afterburner - (this._lastAb || 0); this._lastAb = afterburner;
    this.abFlash = Math.max(0, this.abFlash * (1 - 6 * Math.max(dt, 0.001)) + Math.max(0, abRise) * 40);
    const flash = Math.min(1, this.abFlash);
    this.matGlow.opacity = mil * 0.10 + afterburner * 0.75 + flash * 0.4;
    this.matGlow.color.setRGB(1.0, 0.45 + 0.45 * afterburner, 0.15 + 0.7 * afterburner);
    this.matNozzleInner.emissiveIntensity = mil * 0.06 + afterburner * 1.6 + flash;   // askeri güçte yalnızca derinde sıcak bir ton
    // Nozul petallerinin ısınması (AB'de turuncu ton)
    this.nozzleMat.emissive.setRGB(1.0, 0.38, 0.12);
    this.nozzleMat.emissiveIntensity = afterburner * 0.012 + flash * 0.03;
    const heat = mil * 0.6 + afterburner;
    if (heat > 0.02 || flash > 0.02) {
      p.flame.visible = true;
      // Alev boyu: AB ile ~1 m -> ~7,5 m; hafif titreme. Pus kuyruğu alevin ötesine uzanır.
      const flick = 1 + 0.05 * Math.sin(time * 71) * Math.sin(time * 29) + 0.03 * Math.sin(time * 113);
      const flameLen = (0.8 + 5.2 * afterburner + 0.6 * flash) * flick;
      const volLen = flameLen + 2.2 + 1.8 * mil;
      // Yarıçap nozul çıkışını izler (değişken alanlı nozul: kn); hacim çıkıştan %35 geniş
      const rOut = 0.505 * kn, R = rOut * 1.35 * (1 + 0.12 * afterburner);
      this.flameVol.scale.set(R, R, volLen);
      const U = this.flameMats[0].uniforms;
      U.time.value = time; U.ab.value = afterburner; U.mil.value = mil; U.flash.value = flash;
      U.flameFrac.value = Math.min(0.92, flameLen / volLen);
      U.rExit.value = rOut / R;
      U.haze.value = Math.min(1, mil * 0.8 + afterburner);
      U.scaleW.value.set(R, R, volLen);
      // Parıltı: AB'de, mesafeyle büyür (uzakta kaybolmaz)
      const gI = afterburner * 0.32 + flash * 0.4;
      this.abGlow.visible = gI > 0.02;
      this.abGlowMat.opacity = Math.min(1, gI);
      const gs = (1.6 + 0.8 * afterburner) * Math.min(3, Math.max(1, camDist / 45));
      this.abGlow.scale.set(gs, gs, 1);
    } else {
      p.flame.visible = false;
      this.abGlow.visible = false;
    }
    // Dış ışıklar: seyir ışıkları sürekli; flaşörler çift flaş (periyot 1.7 s); beacon 1 Hz
    const tp = time % 1.7;
    const strobeOn = (tp < 0.06) || (tp > 0.16 && tp < 0.22);
    const beaconOn = (time % 1.0) < 0.12;
    const L = this.lights;
    L.strobeLeft.visible = strobeOn; L.strobeRight.visible = strobeOn;
    L.beaconTop.visible = beaconOn; L.beaconBottom.visible = beaconOn;
    // Parıltı boyutu: yakında GERÇEK boyutunda (10.7 m açıklıklı uçakta kanat ucu
    // lambası birkaç santimdir), uzakta ise ekranda kaybolmaması için mesafeyle
    // ölçeklenir. Tek bir sqrt ifadesi; kare başına maliyeti ihmal edilebilir.
    const pulse = 0.9 + 0.1 * Math.sin(time * 6);
    const far = Math.min(4.5, 1 + Math.sqrt(Math.max(0, camDist)) * 0.22);
    for (const k of ['navLeft', 'navRight', 'tail', 'strobeLeft', 'strobeRight', 'beaconTop', 'beaconBottom']) {
      const g = L[k];
      g.userData.sprite.scale.setScalar(g.userData.size * far * (k.startsWith('nav') ? pulse : 1));
    }
    // İniş ışığı: takım açık ve anahtar açıkken
    const ll = this.landingLightsOn && gear > 0.9;
        // Spot ışığı HER ZAMAN sahnededir, kapalıyken yoğunluğu 0'dır. Görünürlüğünü
    // değiştirmek sahnedeki ışık SAYISINI değiştirir ve her aydınlatılan malzemenin
    // gölgelendiricisini yeniden derletir (telefonda yüzlerce ms takılma).
this.landingSpot.intensity = ll ? 40 : 0;
    this.landingLens.visible = ll;
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
    if (ac.parts.pilotParts.includes(o)) return;   // park halindeki uçaklarda pilot yok
    if (ac.flameMats.includes(o.material) || o.material === ac.matGlow || o.isSprite) return;
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
