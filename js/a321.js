// Airbus A321neo – tamamen kod ile üretilen, gerçek ölçekli model.
// Eksenler: burun -Z, üst +Y, sağ kanat +X. Uzunluk 44,51 m, açıklık 35,8 m, yükseklik 11,76 m.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, ensureOutward, airfoilPoints } from './aircraft.js';
import { makeAirlinerSkinTexture, makeAirbusScreenTexture, makeGlowTexture, makeRoughnessTexture } from './textures.js';
import { getLivery } from './liveries.js';

const DEG = Math.PI / 180;
export const A321 = {
  length: 44.51, span: 35.8, height: 11.76,
  cgStation: 20.6,
  wheelBottomY: -4.35,
  noseGearZ: 5.1 - 20.6, mainGearZ: 23.5 - 20.6, mainGearX: 3.8,
  // Göz noktası: kokpit zemininin ~1,34 m, glareshield tepesinin ~0,16 m üstünde;
  // yanal olarak kaptan koltuğu hizasında (-0,44 m). Ön cam bandının üst üçte birinde durur.
  pilotEye: new THREE.Vector3(-0.44, 0.92, 4.9 - 20.6),
};
const st = (s) => s - A321.cgStation;

// Gövde kesitleri: [istasyon, yarı genişlik, üst y, alt y].
// Kesit merkezi (yt+yb)/2'dir; böylece burun aşağı doğru kamburlanabilir (A320 ailesinin
// düşük radom ekseni). Radom ayrı bir küre değil, bu tablonun ilk parçasının loft'udur.
// A320 ailesinin ayırt edici özelliği DÜŞÜK (sarkık) burun eksenidir: radom ucu
// kabin ekseninin ~1,1 m ALTINDADIR. Önceki tabloda uç yalnızca 0,53 m aşağıdaydı,
// bu yüzden kesit merkezi neredeyse sabit kalıyor ve burun simetrik bir MERMİ/balon
// gibi görünüyordu (kullanıcının "çok yuvarlak, jenerik" tarifi). Artık:
//   - kesit merkezi c(s) uçta -1,125'ten kabinde -0,035'e yükselir (gerçek sarkma),
//   - ALT hat neredeyse düz (yb -1,30 -> -2,02: 3,5 m'de yalnızca 0,72 m),
//   - ÜST hat dik iner (yt -0,95 -> +1,38: aynı mesafede 2,33 m),
// yani yandan bakıldığında burun A320'nin karakteristik "aşağı bakan" siluetini alır.
// Kesitler dairesele yakın (h/2 ≈ w), çünkü A320 ön gövdesi dairesel kesitlidir.
const SECTIONS = [
  // --- ÖN GÖVDE (0 -> 6,50 m) ---
  // Yarı genişlik oranı f(s) kontrol noktalarından MONOTON KÜBİK (PCHIP) ile üretildi.
  // İlk 1,5 m gerçek bir TEĞET OJİV radomdan gelir: taban yarıçapı 1,35 m, uzunluk
  // 2,5 m -> ojiv yarıçapı rho = (Rb² + Ln²)/(2·Rb) = 2,99 m,
  //   r(x) = sqrt(rho² - (Ln - x)²) + Rb - rho
  // Bu ojiv s = 0,25 / 0,50 / 1,00 / 1,50'de gövde genişliğinin %17 / %29 / %48 / %60'ı
  // kadardır — yani A320 radomu KÜTTÜR. Radom tabanı silindire teğet değildir (gövde
  // arkasında genişlemeyi sürdürür), bu yüzden eğri 1,9 m'den sonra sekant gibi devam
  // eder ve 6,8 m'de tam kesite teğet oturur.
  //
  // Karina doğrudan tanımlıdır: yb(s) = -2,06 + 1,15·(1 - s/5)³  (uçta -0,90).
  // Üs 3'tür: karina uçta HIZLA yükselir, böylece siluet alttan da daralır. Üs 2 ile
  // alt hat neredeyse yataydı ve burun yuvarlak kapaklı bir BORU gibi görünüyordu.
  // Sarkma buradan gelir; taç yb + 4,05·f(s) olarak türetilir, böylece kesit her yerde
  // dairesele yakın kalır ve alt hat baştan sona düz ilerler.
  //
  // Önceki iki eğri burnu çok İNCE bırakıyordu: 0,25 m'de %9-14, 0,50 m'de %16-25,
  // 1,00 m'de %31-35 — gerçek radomun yarısı kadar. Yandan bakıldığında burun sivri bir
  // kamaydı; üstelik ön cam bölgesi neredeyse silindirik kaldığı için camlar ÖNE değil
  // YANA bakıyor, önden bakınca ön cam yok gibi duruyordu.
  [0.01, 0.020, -0.879, -0.920],
  [0.07, 0.091, -0.771, -0.958],
  [0.14, 0.170, -0.655, -1.004],
  [0.23, 0.266, -0.515, -1.062],
  [0.34, 0.371, -0.368, -1.129],
  [0.47, 0.486, -0.208, -1.205],
  [0.62, 0.607, -0.042, -1.287],
  [0.79, 0.723, 0.109, -1.374],
  [0.99, 0.843, 0.263, -1.467],
  [1.22, 0.961, 0.408, -1.563],
  [1.48, 1.069, 0.533, -1.659],
  [1.78, 1.175, 0.657, -1.753],
  [2.10, 1.279, 0.787, -1.836],
  [2.44, 1.383, 0.929, -1.906],   // radom derzi
  [2.80, 1.487, 1.087, -1.962],
  [3.18, 1.593, 1.261, -2.005],
  [3.58, 1.687, 1.425, -2.034],
  [4.00, 1.768, 1.575, -2.051],
  [4.44, 1.840, 1.716, -2.058],
  [4.90, 1.897, 1.830, -2.060],
  [5.38, 1.936, 1.910, -2.060],
  [5.90, 1.963, 1.965, -2.060],
  [6.50, 1.972, 1.984, -2.060],
  // --- KABİN ve ARKA GÖVDE ---
  [7.60, 1.975, 1.99, -2.06],
  [12.0, 1.975, 1.99, -2.06],
  [20.0, 1.975, 1.99, -2.06], [28.0, 1.975, 1.99, -2.06], [33.0, 1.97, 1.99, -2.04],
  [35.5, 1.90, 2.03, -1.86], [38.0, 1.66, 2.16, -1.38], [40.5, 1.30, 2.30, -0.76],
  [42.5, 0.88, 2.40, -0.18], [43.8, 0.48, 2.44, 0.30], [44.51, 0.10, 2.42, 0.72],
];
// Kokpit camları — [s0, s1, v0ön, v1ön, v0arka, v1arka]; v: 0 kesit tepesi, 1 kesit altı.
// A320 ailesinin gerçek düzeni: iki büyük ÖN CAM (No.1), yan ön cam (No.2), açılabilir
// DV penceresi ve küçük arka çeyrek pencere. Modül düzeyindedir çünkü hem DIŞ cam
// panelleri hem KOKPİT KABUĞUNDAKİ açıklıklar bu tek tablodan üretilir; ikisi asla
// birbirinden kayamaz.
//
// Belirleyici iki ölçü:
//
// 1) ÜST KENAR ÖNDE NEREDEYSE TACA DEĞER (v = 0,030 @ 2,78) ve arkaya doğru hızla
//    iner (v = 0,242 @ 5,56). Gerçek A320'de No.1 ön camın üst-ön köşesi burnun üst
//    hattına dokunur; kaş (brow) yalnızca arkaya doğru açılır. Önceki tabloda üst
//    kenar önde de 0,089'daydı: iki cam grubu burnun tepesinde 0,88 m'lik bir açıklıkla
//    ayrılıyor ve uçak önden bakınca ÖN CAMI OLMAYAN, yanlarında iki "göz" taşıyan bir
//    şeye benziyordu. Yeni değerlerde aradaki açıklık ~0,11 m: gerçek bir orta direk.
//
// 2) CAMLAR ARASINDA GERÇEK DİREK VAR: istasyon boşlukları 0,16-0,18 m (eskiden
//    0,07-0,08 m). Çerçeve halkaları her yandan 0,04 m taştığı için eski boşluklarda
//    direk görünmüyor, dört cam tek bir kara leke gibi birleşiyordu.
//
// Panellerin yüksekliği de öne doğru belirgin biçimde artar (v aralığı 0,286 -> 0,050):
// No.1 büyük ve dik, No.4 küçük ve yatık. Eşit yükseklikli bir bant "otobüs camı" gibi
// duruyordu.
export const COCKPIT_WINDOWS = [
  // Kenarlar MUTLAK YÜKSEKLİKTEN çözüldü, sabit v'den değil: üst kenar y = 1,38 -> 1,17 m,
  // alt kenar (eşik) y = 0,66 -> 0,75 m. Bant böylece neredeyse YATAY kalır ve gövde onun
  // çevresinde büyür — A320'nin kaşı (üst camın üstündeki gövde) önde 0,01 m'den arkada
  // 0,80 m'ye açılır. Cam yükseklikleri 0,71 -> 0,42 m.
  // Sabit v ile çalışırken eşik arkaya doğru YÜKSELİYOR, DV penceresinin alt kenarı pilot
  // göz hizasının ÜSTÜNDE kalıyordu (yana bakınca gövde duvarı görünüyordu).
  //
  // Bant, burun tacının yeterince yükseldiği yere (3,47 m) oturtuldu: daha önde taç
  // alçak olduğu için ön cam kısa kalıyor ve kokpitten bakınca dar bir kemer görünüyordu.
  [3.47, 4.27, 0.038, 0.313, 0.190, 0.353],   // No.1 ön cam — öne bakar, orta direğe dayanır
  [4.44, 4.98, 0.211, 0.358, 0.249, 0.373],   // No.2 yan ön cam
  [5.16, 5.62, 0.262, 0.375, 0.283, 0.381],   // DV penceresi (açılabilir)
  [5.78, 6.16, 0.292, 0.381, 0.303, 0.380],   // arka çeyrek pencere
];
// Kokpit astarında bir dörtgen AÇIK mı? Camların içi açıktır; ayrıca No.1 ön camın
// ÖNÜNDE kalan bölüm de aynı v aralığında açıktır.
//
// Astar gövdeyi izleyen kapalı bir tüptür ve ön camın önünde de devam eder. Oradaki
// duvar, camdan çıkan bakış ışınını birkaç on santim sonra yeniden kesiyordu: pilot
// düz ileri baktığında dışarıyı göremiyor, kokpit dar bir kemer gibi görünüyordu.
// Ön camın önünde bir KORİDOR açılır; eşiğin altı ve tacın üstü kapalı kalır, yani
// burnun içinden aşağı/yukarı bakılamaz.
function linerOpen(sv, v) {
  const w0 = COCKPIT_WINDOWS[0];
  if (sv < w0[0]) return v >= w0[2] && v <= w0[3];
  return inWindow(sv, v, 0);
}
// Bir (istasyon, v) noktası herhangi bir camın içine düşüyor mu? Kabuk açıklıkları için.
function inWindow(sv, v, pad = 0) {
  for (const [a, b, v0, v1, v0b, v1b] of COCKPIT_WINDOWS) {
    if (sv < a - pad || sv > b + pad) continue;
    const f = (sv - a) / Math.max(1e-6, b - a);
    const top = v0 + (v0b - v0) * f, bot = v1 + (v1b - v1) * f;
    if (v >= top - pad && v <= bot + pad) return true;
  }
  return false;
}

const RADOME_END = 13;           // radom derzi istasyon 2,44 — ön camın belirgin biçimde önünde
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

// Gövde yüzeyinin o noktadaki DIŞ normali (birim).
// Çıkartmaları ve kokpit camlarını yüzeyden "belirli bir metre" kaldırmak için gerekir.
// Önceden kaldırma işi x ve y'yi bir katsayıyla çarpmakla yapılıyordu; bu, modelin
// ORİJİNİ etrafında ölçekleme demektir, yüzey normali boyunca ötelemek değil. Burunda
// kesit merkezi aşağıda (cy ~ -1,1) ve yüzey z yönünde hızla daraldığı için o ölçekleme
// camı yüzeyden neredeyse hiç ayırmıyordu; panel kaplamanın içine giriyor ve z-fighting
// (alacalı siyah/beyaz lekeler) oluşuyordu.
function surfaceNormal(s, v) {
  const ds = 0.02, dv = 0.004;
  const vc = Math.min(0.995, Math.max(0.005, v));
  const a = surfacePoint(s + ds, vc), b = surfacePoint(s - ds, vc);
  const c = surfacePoint(s, Math.min(0.999, vc + dv)), d = surfacePoint(s, Math.max(0.001, vc - dv));
  const ts = new THREE.Vector3(a.x - b.x, a.y - b.y, a.z - b.z);
  const tv = new THREE.Vector3(c.x - d.x, c.y - d.y, c.z - d.z);
  const n = new THREE.Vector3().crossVectors(tv, ts);
  if (n.lengthSq() < 1e-12) return new THREE.Vector3(0, 1, 0);
  n.normalize();
  // Dışa baksın: kesit merkezinden noktaya giden yönle aynı yarımküre olmalı.
  const p = surfacePoint(s, vc), cy = sectionCenterY(s);
  if (n.x * p.x + n.y * (p.y - cy) < 0) n.negate();
  return n;
}
// Kesit merkezinin y'si (normal yönünü belirlemek için)
function sectionCenterY(s) {
  let a = SECTIONS[0], b = SECTIONS[SECTIONS.length - 1];
  for (let i = 0; i < SECTIONS.length - 1; i++) if (s >= SECTIONS[i][0] && s <= SECTIONS[i + 1][0]) { a = SECTIONS[i]; b = SECTIONS[i + 1]; break; }
  const t = Math.min(1, Math.max(0, (s - a[0]) / Math.max(1e-6, b[0] - a[0])));
  return ((a[2] + (b[2] - a[2]) * t) + (a[3] + (b[3] - a[3]) * t)) / 2;
}
// Kokpit cam bandının üst/alt kenarı: COCKPIT_WINDOWS köşelerinden geçen parçalı doğru.
// Tek bir sürekli fonksiyon olması şart: çerçeve şeritleri, direkler ve camlar bu aynı
// kenardan üretilir, böylece birbirine TAM oturur — aralarında ne boşluk ne bindirme kalır.
const BAND = (() => {
  const k = [];
  for (const [a, b, v0, v1, v0b, v1b] of COCKPIT_WINDOWS) { k.push([a, v0, v1]); k.push([b, v0b, v1b]); }
  return k;
})();
function bandAt(s) {
  let i = 0;
  while (i < BAND.length - 2 && s > BAND[i + 1][0]) i++;
  const A = BAND[i], B = BAND[i + 1];
  const t = (s - A[0]) / Math.max(1e-6, B[0] - A[0]);       // uçlarda dışarı uzatılır
  return { top: A[1] + (B[1] - A[1]) * t, bot: A[2] + (B[2] - A[2]) * t };
}

const WING = { rootX: 1.95, tipX: 17.0, leRoot: 18.3, teRoot: 24.70, leTip: 25.90, teTip: 27.65, tRoot: 0.125, tTip: 0.098, yRoot: -1.25, dihedral: 5 * DEG };
function wingY(x) { return WING.yRoot + (Math.abs(x) - WING.rootX) * Math.tan(WING.dihedral); }
function wingLE(x) { const f = (Math.abs(x) - WING.rootX) / (WING.tipX - WING.rootX); return WING.leRoot + (WING.leTip - WING.leRoot) * f; }
function wingTE(x) { const f = (Math.abs(x) - WING.rootX) / (WING.tipX - WING.rootX); return WING.teRoot + (WING.teTip - WING.teRoot) * f; }
function wingThick(x) { const f = (Math.abs(x) - WING.rootX) / (WING.tipX - WING.rootX); return WING.tRoot + (WING.tTip - WING.tRoot) * f; }

export class A321neo {
  constructor({ quality = 'medium', livery = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'A321neo';
    this.parts = {};
    this.disposables = [];
    this.quality = quality;
    // Livery YALNIZCA görseldir: kaplama paleti, boya ve kuyruk rengi.
    // Geometri, ölçüler, bağlantı noktaları ve uçuş modeli etkilenmez.
    this.livery = getLivery('a321', livery);
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
    const L = this.livery || {};
    // Kaplama dokusu zaten uçak örneğine özeldir; palet vermek ek maliyet getirmez.
    const skin = this.track(makeAirlinerSkinTexture(2048, 256, L.skin || {}));
    const rough = this.track(makeRoughnessTexture(256));
    return {
      skin: this.track(new THREE.MeshStandardMaterial({ map: skin, roughnessMap: rough, roughness: 0.42, metalness: 0.06, envMapIntensity: 0.9 })),
      paint: this.track(new THREE.MeshStandardMaterial({ color: L.paint !== undefined ? L.paint : 0xf2f4f6, roughness: 0.42, metalness: 0.06, envMapIntensity: 0.9 })),
      belly: this.track(new THREE.MeshStandardMaterial({ color: L.belly !== undefined ? L.belly : 0xb2b8be, roughness: 0.55, metalness: 0.1 })),
      // Radom: kompozit, mat ve gövdeden bir tık koyu — ayrı bir top değil, gövdenin devamı
      radome: this.track(new THREE.MeshStandardMaterial({ color: L.radome !== undefined ? L.radome : 0xdcdfe2, roughness: 0.66, metalness: 0.04, envMapIntensity: 0.5 })),
      accent: this.track(new THREE.MeshStandardMaterial({ color: L.accent !== undefined ? L.accent : 0x1b3a6b, roughness: 0.4, metalness: 0.1 })),
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

  // Kanat paneli: x0..x1 arası, veter oranı cStart..cEnd.
  // `bulge` verilirse profil üst yüzeyde +, alt yüzeyde - o kadar ötelenir: hareketli
  // yüzeyler sabit kanadın kabuğunun hemen DIŞINDA kalır, böylece nötr konumda iki
  // yüzey çakışıp z-fighting yapmaz.
  wingPanel(side, x0, x1, cStart, cEnd, N = 6, K = 8, bulge = 0) {
    const rows = [];
    for (let j = 0; j <= N; j++) {
      const x = x0 + (x1 - x0) * (j / N);
      const le = wingLE(x), te = wingTE(x), chord = te - le;
      rows.push(airfoilPoints(K, chord, wingThick(x), cStart, cEnd)
        .map((p, i) => ({ x: side * x, y: wingY(x) + p.y + (i <= K ? bulge : -bulge), z: st(le + chord * p.c) })));
    }
    return ensureOutward(loft(rows, { uScale: 1, vScale: 1 }));
  }

  // Kanat yüzeyinde bir nokta: veter oranı c, üst (up=true) ya da alt yüzey.
  wingSurfY(x, c, up) {
    const le = wingLE(x), chord = wingTE(x) - le;
    const p = airfoilPoints(1, chord, wingThick(x), c, c)[0];
    return wingY(x) + (up ? p.y : -p.y);
  }

  buildWings() {
    this.parts.ailerons = {}; this.parts.flaps = {}; this.parts.slats = {}; this.parts.spoilers = {};
    const hingeAxis = (side, x0, x1, fn) => new THREE.Vector3(x1 - x0, 0, side * (fn(x1) - fn(x0))).normalize();
    const BULGE = 0.014;          // hareketli yüzeylerin kabuk dışına çıkma payı (m)
    for (const side of [-1, 1]) {
      // ---- Sabit kanat ----
      // TAM profil (0..1). Eskiden yalnızca 0,13-0,74 arası bir "kutu" vardı; slat ve
      // flap panellerinin arasındaki açıklıklarda kanadın İÇİ görünüyor, hücum ve firar
      // kenarları kesik duruyordu. Artık altta kapalı bir kanat var, hareketli yüzeyler
      // onun üstüne oturuyor: açılırken altından gerçek kanat yapısı çıkıyor.
      // wingLE/wingTE/wingY/wingThick hepsi x'te DOĞRUSAL: yüzey çizgisel (ruled),
      // bu yüzden açıklık yönünde 4 sıra 14 sırayla birebir aynı geometriyi verir.
      this.paintGeos.push(this.wingPanel(side, WING.rootX, WING.tipX, 0, 1, 4, 12));

      // ---- Sharklet ----
      // Kök kesiti kanadın uç kesitiyle BİREBİR aynı (aynı veter, aynı kalınlık, aynı y),
      // böylece geçişte basamak kalmaz. Yükselme dairesel bir kıvrımla başlar ve sonra
      // düz devam eder — A320neo sharklet'inin karakteristik "yumuşak dip, dik uç" silueti.
      {
        const Rb = 0.95, TH = 1.40;                       // kıvrım yarıçapı ve yatma açısı (80°)
        const leTip = wingLE(WING.tipX), cTip = wingTE(WING.tipX) - leTip;
        const shRows = [];
        const NS2 = 12;
        for (let j = 0; j <= NS2; j++) {
          const t = j / NS2;
          const th = TH * Math.min(1, t / 0.5);
          const ext = Math.max(0, t - 0.5) / 0.5 * 1.72;
          const dx = Rb * Math.sin(th) + ext * Math.cos(TH);
          const dy = Rb * (1 - Math.cos(th)) + ext * Math.sin(TH);
          const f = dy / 2.50;                            // yükseklik oranı
          const chord = cTip * (1 - 0.64 * f);
          const le = leTip + 1.28 * f;
          const thick = 0.098 - 0.030 * f;
          const y = wingY(WING.tipX) + dy;
          shRows.push(airfoilPoints(10, chord, thick * (j === NS2 ? 0.18 : 1), 0, 1)
            .map((p) => ({ x: side * (WING.tipX + dx), y: y + p.y, z: st(le + chord * p.c) })));
        }
        this.paintGeos.push(ensureOutward(loft(shRows, { uScale: 1, vScale: 1 })));
      }

      // ---- Firar kenarı: flaplar (iç/dış) ve aileron ----
      const teSurfaces = [
        { key: 'flaps', x0: 2.30, x1: 6.60 },
        { key: 'flaps', x0: 7.00, x1: 12.20 },
        { key: 'ailerons', x0: 13.00, x1: 16.40 },
      ];
      for (const sf of teSurfaces) {
        const hinge = (x) => wingLE(x) + (wingTE(x) - wingLE(x)) * 0.74;
        const xm = (sf.x0 + sf.x1) / 2;
        const geo = this.wingPanel(side, sf.x0, sf.x1, 0.735, 1.0, 2, 6, BULGE);
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

      // ---- Hücum kenarı slatları (üç panel) ----
      for (const [x0, x1] of [[2.40, 6.80], [7.20, 11.60], [12.00, 16.60]]) {
        const hinge = (x) => wingLE(x) + (wingTE(x) - wingLE(x)) * 0.135;
        const xm = (x0 + x1) / 2;
        const geo = this.wingPanel(side, x0, x1, 0.0, 0.14, 2, 7, BULGE);
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

      // ---- Spoyler / hız freni panelleri ----
      // Eskiden düz BoxGeometry'lerdi: kanat yüzeyi eğri olduğu için panellerin ön kenarı
      // havada duruyor, arka kenarı kabuğa gömülüyordu (yandan bakınca merdiven basamağı
      // gibi görünüyordu). Artık her panel ÜST YÜZEYİ İZLEYEN ince bir levha: kapalıyken
      // kabuğa oturur, açılınca menteşe çizgisi etrafında kalkar.
      const spo = [];
      for (let k = 0; k < 5; k++) {
        const x0 = 4.6 + k * 1.55, x1 = x0 + 1.35;
        const xm = (x0 + x1) / 2;
        const c0 = 0.58, c1 = 0.732;
        const hinge = (x) => wingLE(x) + (wingTE(x) - wingLE(x)) * c0;
        const rows = [];
        const NK = 5;
        for (let j = 0; j <= 2; j++) {
          const x = x0 + (x1 - x0) * (j / 2);
          const le = wingLE(x), chord = wingTE(x) - le;
          const ring = [];
          for (let i = 0; i <= NK; i++) { const c = c0 + (c1 - c0) * (i / NK); ring.push({ x: side * x, y: this.wingSurfY(x, c, true) + 0.052, z: st(le + chord * c) }); }
          for (let i = NK; i >= 0; i--) { const c = c0 + (c1 - c0) * (i / NK); ring.push({ x: side * x, y: this.wingSurfY(x, c, true) + 0.012, z: st(le + chord * c) }); }
          rows.push(ring);
        }
        const geo = ensureOutward(loft(rows, { uScale: 1, vScale: 1, closeRing: true }), (v, out) => out.set(v.x, this.wingSurfY(Math.abs(v.x), (c0 + c1) / 2, true) + 0.032, v.z));
        geo.translate(-side * xm, -wingY(xm), -st(hinge(xm)));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
        mesh.position.set(side * xm, wingY(xm), st(hinge(xm)));
        mesh.castShadow = true;
        // Menteşe ekseni SÜPÜRÜLMÜŞ menteşe çizgisiyle aynı; düz X ekseni etrafında
        // döndürmek 45°'de panelin uçlarında ~0,2 m'lik sapma bırakıyordu.
        mesh.userData.axis = hingeAxis(side, x0, x1, hinge);
        this.group.add(mesh);
        spo.push(mesh);
      }
      this.parts.spoilers[side < 0 ? 'left' : 'right'] = spo;

      // ---- Flap ray karinaları ----
      // A320 ailesinin en tanınır alt-kanat detayı: firar kenarının altından geriye
      // uzanan dört "kano". Kanadın altına oturur, arkaya doğru sivrilir.
      for (const xT of [3.35, 6.25, 9.10, 11.85]) {
        const le = wingLE(xT), chord = wingTE(xT) - le;
        const c0 = 0.45, cEnd = 1.26;                      // firar kenarının ~1,5 m gerisine taşar
        const rows = [];
        const NF = 8;
        for (let j = 0; j <= NF; j++) {
          const u = j / NF;
          const c = c0 + (cEnd - c0) * u;
          // Kesit ölçeği: önde kanada gömülü, ortada dolgun, arkada küt biter.
          // İğne gibi sivrilmemeli: gerçek flap ray kanoları kalın ve yuvarlak uçludur.
          const s = j === NF ? 0.05 : Math.pow(Math.sin(Math.PI * (0.04 + 0.86 * u)), 0.80);
          const w = 0.30 * s + 0.015, h = 0.36 * s + 0.015;
          const yTop = this.wingSurfY(xT, Math.min(1, c), false) + 0.04;
          const cy = yTop - h * 0.72;
          const ring = [];
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2;
            ring.push({ x: side * (xT + Math.cos(a) * w), y: cy + Math.sin(a) * h, z: st(le + chord * c) });
          }
          rows.push(ring);
        }
        this.paintGeos.push(ensureOutward(loft(rows, { uScale: 1, vScale: 1, closeRing: true }), (v, out) => out.set(side * xT, v.y, v.z)));
      }
    }
  }

  // ---------------------------------------------------------------------
  // MOTORLAR — CFM LEAP-1A (A321neo)
  // ---------------------------------------------------------------------
  // Kamuya açık ölçüler: fan çapı 1,98 m, nacelle dış çapı ~2,42 m, giriş düzlemi
  // kanat hücum kenarının ~2,8 m önünde. Yerden açıklık A320 ailesinde düşüktür
  // (~0,6-0,7 m); nacelle kanadın altına sıkıca sokulur ve pylon kısadır.
  //
  // Nacelle TEK eksenel profilden döndürülerek üretilir; böylece yüzey her yerde
  // pürüzsüz ve simetriktir. Önceki sürümde ters itki kuşağı, daralan kaportanın
  // İÇİNDEN geçen ayrı bir silindirdi: iki yüzey kesişiyor ve ekranda testere
  // dişi gibi bir z-fighting bandı oluşuyordu. Artık kaporta üç ardışık parçadan
  // kurulur (fan kaportası / derz / ters itki kaportası) ve parçalar uç uca,
  // ORTAK yarıçapla birleşir: kesişme yok, derz gerçek bir oluk olarak okunur.
  buildEngines() {
    this.parts.fans = [];
    const R = 1.21;              // nacelle en büyük dış yarıçapı
    const RF = 0.985;            // fan yarıçapı
    const zF = st(17.4);         // giriş (highlight) düzlemi
    const SEG = 28;
    // Eksenel profili (yarıçap, z) döndürerek yüzey üretir. z profil içinde girişe
    // göredir; parça sonra motorun kendi yerine ötelenir.
    const revolve = (pts, seg = SEG) => {
      const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(1e-4, r), z)), seg);
      g.rotateX(Math.PI / 2);    // dönme ekseni +Y -> +Z
      g.translate(0, 0, zF);
      return this.track(g);
    };
    // Dış kaporta profili — derzden önce ve sonra ORTAK yarıçap kullanılır.
    const FAN_COWL = [
      [1.035, 0.00],             // giriş dudağı (highlight)
      [1.108, 0.055], [1.163, 0.135], [1.198, 0.270],
      [R, 0.470], [R, 0.860], [1.206, 1.300], [1.190, 1.780], [1.178, 2.020],
    ];
    const SEAM = [               // fan kaportası / ters itki derzi: sığ bir oluk
      [1.178, 2.020], [1.150, 2.048], [1.148, 2.092], [1.174, 2.120],
    ];
    const REV_COWL = [
      [1.174, 2.120], [1.168, 2.450], [1.146, 2.850],
      [1.100, 3.150], [1.040, 3.350], [1.005, 3.420],   // fan lülesi çıkışı
    ];
    const NOZ_IN = [             // fan lülesinin iç yüzeyi (arkadan görünür kalınlık)
      [1.005, 3.420], [0.986, 3.370], [0.974, 3.150], [0.970, 3.020],
    ];
    const INLET_IN = [           // giriş kanalı: dudaktan boğaza, oradan fan düzlemine
      [1.035, 0.00], [0.996, 0.060], [0.974, 0.175],
      [0.970, 0.340], [0.980, 0.570], [0.992, 0.780], [0.998, 0.960],
    ];
    const CORE_COWL = [          // sıcak kısım kaportası: fan lülesinin arkasından çıkar
      [0.720, 2.700], [0.712, 3.100], [0.690, 3.550], [0.640, 4.000],
      [0.575, 4.400], [0.510, 4.720], [0.470, 4.900],
    ];
    const CORE_LIP = [           // sıcak lüle dudağının iç yüzü
      [0.470, 4.900], [0.442, 4.868], [0.418, 4.700],
    ];
    const PLUG = [               // merkez konisi
      [0.405, 4.560], [0.362, 4.850], [0.255, 5.220], [0.125, 5.450], [0.000, 5.560],
    ];
    const seamMat = this.track(new THREE.MeshStandardMaterial({ color: 0x9aa1a8, roughness: 0.55, metalness: 0.45 }));
    const spinMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd6dade, roughness: 0.28, metalness: 0.72 }));
    for (const side of [-1, 1]) {
      const grp = new THREE.Group();
      grp.position.set(side * 5.75, wingY(5.75) - 1.50, 0);
      const addMesh = (geo, mat, shadow = true) => { const m2 = new THREE.Mesh(geo, mat); m2.castShadow = shadow; grp.add(m2); return m2; };
      addMesh(revolve(FAN_COWL), this.m.paint);
      addMesh(revolve(SEAM), seamMat, false);
      addMesh(revolve(REV_COWL), this.m.paint);
      addMesh(revolve(NOZ_IN), this.m.duct, false);
      addMesh(revolve(INLET_IN), this.m.duct, false);
      addMesh(revolve(CORE_COWL), this.m.metal);
      addMesh(revolve(CORE_LIP), this.m.duct, false);
      addMesh(revolve(PLUG), this.m.dark);
      // Fan düzleminin arkasını kapatan koyu disk: giriş "delik" gibi görünmesin
      const back = new THREE.CircleGeometry(RF, SEG); back.translate(0, 0, zF + 1.24);
      addMesh(this.track(back), this.m.dark, false);
      // Fan: 18 geniş kirişli, burularak açılan kanat + göbek + spinner
      const fan = new THREE.Group();
      fan.position.set(0, 0, zF + 1.05);
      const blades = [];
      for (let i = 0; i < 18; i++) {
        const rows = [];
        // Kanat kesiti (teğet, eksenel) düzleminde durur ve yarıçapla birlikte BURULUR.
        // Uçta çevresel hız büyük olduğu için bağıl akı eksenden çok saparak gelir:
        // gerçek bir fanda kesit uçta neredeyse teğete yatar (burada 62°), kökte ise
        // eksene yakındır (30°). Bu burulma olmadan kanatlar öne bakan bıçaklar gibi
        // görünüyor ve disk "seyrek" okunuyordu.
        // Kök yarıçapı göbeğin, uç yarıçapı ise kanal duvarının İÇİNDE kalır; böylece
        // kapatılmamış uçlar hiçbir açıdan görünmez.
        for (let k = 0; k <= 4; k++) {
          const t = k / 4;
          const r = 0.22 + (1.00 - 0.22) * t;
          const chord = 0.42 + 0.10 * t;                 // geniş kirişli fan
          const tw = 0.52 + 0.56 * t;                    // 30° -> 62° yatma
          const half = 0.030 - 0.014 * t;
          const row = [];
          for (const [cf, sgn] of [[-0.5, 1], [-0.15, 1], [0.25, 1], [0.5, 0], [0.25, -1], [-0.15, -1], [-0.5, -1]]) {
            const camber = sgn * half * (1 - Math.abs(cf) * 1.4);
            row.push({
              x: cf * chord * Math.sin(tw) + camber * Math.cos(tw),
              y: r,
              z: cf * chord * Math.cos(tw) - camber * Math.sin(tw),
            });
          }
          rows.push(row);
        }
        const g = ensureOutward(loft(rows, { uScale: 1, vScale: 1, closeRing: true }), (v, out) => out.set(0, v.y, 0));
        g.rotateZ((i / 18) * Math.PI * 2);
        blades.push(g);
      }
      const bl = new THREE.Mesh(this.track(mergeGeometries(blades, false)), this.m.metal);
      fan.add(bl);
      const hub = new THREE.CylinderGeometry(0.28, 0.30, 0.30, 18); hub.rotateX(Math.PI / 2);
      fan.add(new THREE.Mesh(this.track(hub), this.m.metal));
      // Spinner: öne bakan koni, ucu giriş düzleminin biraz gerisinde
      const spin = new THREE.ConeGeometry(0.28, 0.66, 18); spin.rotateX(-Math.PI / 2); spin.translate(0, 0, -0.48);
      fan.add(new THREE.Mesh(this.track(spin), spinMat));
      grp.add(fan);
      this.parts.fans.push(fan);
      // Pylon: dikey bir kanatçık gibi; alt sıraları nacelle'in, üst sıraları kanadın
      // İÇİNDE kalır, böylece iki uçta da boşluk ya da taşma olmaz. Yandan bakıldığında
      // hücum kenarı yukarı gittikçe geriye yatar — A320 ailesinin pylon silueti budur.
      const yWing = wingY(5.75) - (wingY(5.75) - 1.50) + 0.06;   // kanat veter hattı (yerel)
      const pyRows = [];
      for (let k = 0; k <= 5; k++) {
        const t = k / 5;
        const yl = 0.82 + (yWing - 0.82) * t;
        // Alt sıra nacelle'in üstünde girişin GERİSİNDEN başlar; üst sıra kanat hücum
        // kenarının hemen önünde. Böylece pylon yukarı gittikçe geriye yatar ve hiçbir
        // yerde nacelle'in önüne taşmaz.
        const le = zF + (0.62 + 1.93 * t), te = zF + (3.35 + 1.80 * t);
        const chord = te - le, thick = 0.105 - 0.020 * t;
        pyRows.push(airfoilPoints(7, chord, thick, 0, 1).map((p) => ({ x: p.y, y: yl, z: le + chord * p.c })));
      }
      const pyGeo = ensureOutward(loft(pyRows, { uScale: 1, vScale: 1 }), (v, out) => out.set(0, v.y, v.z));
      addMesh(this.track(pyGeo), this.m.paint);
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
    // Yüzeyi izleyen panel: gövde eğrisine oturur, aynalanan tarafta sarım çevrilir.
    // Cam, çerçeve, kapı ve kargo kapakları aynı yardımcıyı kullanır.
    //
    // `off` panelin yüzeyden YÜZEY NORMALİ boyunca kaç METRE kaldırılacağıdır. Eskiden
    // bunun yerine koordinatlar bir katsayıyla çarpılıyordu (orijin etrafında ölçekleme);
    // burun bölgesinde bu, panelleri kaplamanın içinde bırakıyordu.
    //
    // v0b/v1b verilirse panel (istasyon, v) uzayında bir YAMUK olur: ön ve arka kenarın
    // v aralıkları farklı olabilir. A320 kokpit camları buna ihtiyaç duyar — ön cam
    // arkadaki yan camlardan belirgin biçimde DAHA YÜKSEKTİR ve alt kenar öne doğru
    // aşağı iner. Dikdörtgen panellerle bant "otobüs camı" gibi düz görünüyordu.
    //
    // Bölüntü SAYISI otomatik sıkılaştırılır: panelin kendi dörtgenleri gövde kaplamasının
    // halkalarından daha kaba olursa, kirişleri kaplamanın İÇİNE girer ve hangi kaldırma
    // verilirse verilsin z-fighting kalır. Gereken incelik kaldırma payına bağlıdır:
    // 12 mm ötelenen kapı çıkartmaları için ~6°, yalnızca 5 mm ötelenen camlar için ~3°
    // yeterlidir (r≈1,9 m'de 3°'lik kirişin sarkması 0,7 mm, 6°'lik kirişinki 2,7 mm).
    const surfPanel = (side, s0, s1, v0, v1, off, into, cols = 4, rows = 4, v0b = null, v1b = null, stepDeg = 6) => {
      const pos = [], idx = [];
      const va = v0b === null ? v0 : v0b, vb = v1b === null ? v1 : v1b;
      const dv = Math.max(Math.abs(v1 - v0), Math.abs(vb - va));
      rows = Math.max(rows, Math.ceil(dv * 180 / stepDeg));  // 1 v birimi = 180°
      cols = Math.max(cols, Math.ceil(Math.abs(s1 - s0) / 0.16));
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const fi = i / cols;
        const sv = s0 + (s1 - s0) * fi;
        const vt = v0 + (va - v0) * fi, vBot = v1 + (vb - v1) * fi;
        const vv = vt + (vBot - vt) * (j / rows);
        const p = surfacePoint(sv, vv), n = surfaceNormal(sv, vv);
        pos.push(side * (p.x + n.x * off), p.y + n.y * off, p.z + n.z * off);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        // Sarım: sağ tarafta yüzler DIŞA baksın. i istasyon (+z), j ise v (aşağı) yönünde
        // arttığı için dışa bakan normal ts x tv'dir; aynalanan tarafta x işareti değişince
        // elin yönü döner, sarım da ters çevrilir.
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((cols + 1) * (rows + 1) * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };
    // Cam bandının üst/alt kenarını izleyen şerit: (istasyon -> v) sürekli bir fonksiyondan
    // üretilir, bu yüzden komşu parçalar birbirine tam oturur.
    const bandStrip = (side, sA, sB, edge, inner, outer, off, into) => {
      // edge: 'top' | 'bot';  inner/outer: kenardan v cinsinden sapmalar
      const pos = [], idx = [];
      const cols = Math.max(2, Math.ceil((sB - sA) / 0.10)), rows = 1;
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const sv = sA + (sB - sA) * (i / cols);
        const e = bandAt(sv)[edge];
        const vv = e + (inner + (outer - inner) * (j / rows));
        const p = surfacePoint(sv, vv), n = surfaceNormal(sv, vv);
        pos.push(side * (p.x + n.x * off), p.y + n.y * off, p.z + n.z * off);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        // Sarım: sağ tarafta yüzler DIŞA baksın. i istasyon (+z), j ise v (aşağı) yönünde
        // arttığı için dışa bakan normal ts x tv'dir; aynalanan tarafta x işareti değişince
        // elin yönü döner, sarım da ters çevrilir.
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((cols + 1) * (rows + 1) * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };
    // Cam bandını boydan boya dolduran direk/dolgu parçası (camların arasında ve uçlarında).
    const bandFill = (side, sA, sB, off, into) => {
      const pos = [], idx = [];
      const cols = Math.max(2, Math.ceil((sB - sA) / 0.08)), rows = 10;
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const sv = sA + (sB - sA) * (i / cols);
        const e = bandAt(sv);
        const vv = e.top + (e.bot - e.top) * (j / rows);
        const p = surfacePoint(sv, vv), n = surfaceNormal(sv, vv);
        pos.push(side * (p.x + n.x * off), p.y + n.y * off, p.z + n.z * off);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        // Sarım: sağ tarafta yüzler DIŞA baksın. i istasyon (+z), j ise v (aşağı) yönünde
        // arttığı için dışa bakan normal ts x tv'dir; aynalanan tarafta x işareti değişince
        // elin yönü döner, sarım da ters çevrilir.
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((cols + 1) * (rows + 1) * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };
    // Pencere açıklığının çevresini dolaşan, dıştan içe inen şerit (cam yanağı / reveal).
    // Aynı (istasyon, v) sınırını iki farklı normal ötelemesinde örnekleyip bağlar;
    // derinliği ve kenardaki gölge çizgisini asıl bu parça verir.
    const revealStrip = (side, s0, s1, v0, v1, v0b, v1b, offOut, offIn, into) => {
      const pts = [];                       // açıklık sınırı: saat yönünde
      const N = 10;
      const at = (f, g) => {                // f: istasyon oranı, g: v oranı
        const vt = v0 + (v0b - v0) * f, vb = v1 + (v1b - v1) * f;
        return { sv: s0 + (s1 - s0) * f, v: vt + (vb - vt) * g };
      };
      for (let i = 0; i <= N; i++) pts.push(at(i / N, 0));          // üst kenar
      for (let i = 1; i <= N; i++) pts.push(at(1, i / N));          // arka kenar
      for (let i = N - 1; i >= 0; i--) pts.push(at(i / N, 1));      // alt kenar
      for (let i = N - 1; i >= 1; i--) pts.push(at(0, i / N));      // ön kenar
      const pos = [], idx = [];
      for (const q of pts) {
        const vv = Math.min(0.999, Math.max(0.001, q.v));
        const o = surfacePoint(q.sv, vv), n = surfaceNormal(q.sv, vv);
        pos.push(side * (o.x + n.x * offOut), o.y + n.y * offOut, o.z + n.z * offOut);
        pos.push(side * (o.x + n.x * offIn), o.y + n.y * offIn, o.z + n.z * offIn);
      }
      const n = pts.length;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0 = i * 2, a1 = i * 2 + 1, b0 = j * 2, b1 = j * 2 + 1;
        if (side > 0) idx.push(a0, a1, b0, b1, b0, a1);
        else idx.push(a0, b0, a1, b1, a1, b0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };

    // ---------------------------------------------------------------------
    // KOKPİT CAMLARI
    // ---------------------------------------------------------------------
    // A320 ailesinin altı pencereli düzeni: iki ön cam, açılabilir DV penceresi ve
    // arka çeyrek pencere. Her cam (u, w) parametre uzayında YUVARLATILMIŞ KÖŞELİ
    // bir dış hattan üretilir — u = 0 ön direk, 1 arka direk; w = 0 üst, 1 alt kenar.
    // Gerçek Airbus ön camının en tanınır çizgisi No.1 camın üst-ön köşesindeki geniş
    // yuvarlamadır; köşeleri dik olan dikdörtgen paneller uçağı "jenerik" gösteriyordu.
    //
    // Katmanlar (hepsi yüzey normali boyunca, metre cinsinden ötelenir):
    //   1) PARLAMA MASKESİ — 4 mm, mat siyah. Bandın tamamını cömert bir payla örter;
    //      uçlara doğru pay sıfıra iner, yani öne doğru kama gibi sivrilir. Gerçek
    //      uçakta camların çevresindeki siyah alan budur ve camlardan çok daha geniştir.
    //   2) ÇERÇEVE HALKASI — 22 mm, koyu gri metal. Cam başına ayrı bir halka; dış
    //      hattı aynı yuvarlatılmış eğrinin genişletilmiş kopyasıdır. Halkalar
    //      birbirine değmez, aralarında maske görünür (gerçek direk görüntüsü).
    //   3) YANAK (reveal) — çerçeve yüzeyinden cam yüzeyine inen 17 mm'lik duvar.
    //   4) CAM — 5 mm, koyu ve parlak.
    const winGeos = [], winFrameGeos = [], winMaskGeos = [];
    const GLASS_OUT = 0.005;     // cam yüzeyi: gövdeden 5 mm taşar
    const FRAME_OUT = 0.022;     // çerçeve: gövdeden 22 mm taşar
    const MASK_OUT = 0.004;      // parlama maskesi: boya kalınlığı kadar

    // (u, w) birim karesinde yuvarlatılmış köşeli kapalı dış hat, saat yönünde.
    // r = [üst-ön, üst-arka, alt-arka, alt-ön] köşe yarıçapları (birim kare oranı).
    const unitOutline = (r, seg = 5, edgeSeg = 3) => {
      const P = [];
      const HP = Math.PI / 2;
      const arc = (cu, cw, rad, a0, a1) => {
        for (let i = 0; i <= seg; i++) { const a = a0 + (a1 - a0) * (i / seg); P.push([cu + rad * Math.cos(a), cw + rad * Math.sin(a)]); }
      };
      const line = (u0, w0, u1, w1) => {
        for (let i = 1; i < edgeSeg; i++) { const f = i / edgeSeg; P.push([u0 + (u1 - u0) * f, w0 + (w1 - w0) * f]); }
      };
      const [r0, r1, r2, r3] = r;
      arc(r0, r0, r0, Math.PI, Math.PI + HP);                 // üst-ön köşe
      line(r0, 0, 1 - r1, 0);                                 // üst kenar
      arc(1 - r1, r1, r1, Math.PI + HP, 2 * Math.PI);         // üst-arka köşe
      line(1, r1, 1, 1 - r2);                                 // arka direk
      arc(1 - r2, 1 - r2, r2, 0, HP);                         // alt-arka köşe
      line(1 - r2, 1, r3, 1);                                 // alt kenar
      arc(r3, 1 - r3, r3, HP, Math.PI);                       // alt-ön köşe
      line(0, 1 - r3, 0, r0);                                 // ön direk
      return P;
    };
    // Bir camın (u, w) noktasını gövde yüzeyine taşır. u ve w [0,1] dışına da
    // taşabilir (çerçeve halkasının dış hattı bunu kullanır) — eşleme doğrusaldır.
    const paneUV = (win, u, w) => {
      const [a, b, v0, v1, v0b, v1b] = win;
      const sv = a + (b - a) * u;
      const vt = v0 + (v0b - v0) * u, vb = v1 + (v1b - v1) * u;
      return { sv, v: Math.min(0.999, Math.max(0.001, vt + (vb - vt) * w)) };
    };
    const putPoint = (side, win, u, w, off, pos) => {
      const q = paneUV(win, u, w);
      const p = surfacePoint(q.sv, q.v), n = surfaceNormal(q.sv, q.v);
      pos.push(side * (p.x + n.x * off), p.y + n.y * off, p.z + n.z * off);
    };
    // Kapalı iki halka arasındaki şerit (çerçeve halkası ve yanak bunu kullanır).
    const ringBand = (side, win, outer, oOff, inner, iOff, into) => {
      const pos = [], idx = [];
      const n = outer.length;
      for (let i = 0; i < n; i++) {
        putPoint(side, win, outer[i][0], outer[i][1], oOff, pos);
        putPoint(side, win, inner[i][0], inner[i][1], iOff, pos);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a0 = i * 2, a1 = i * 2 + 1, b0 = j * 2, b1 = j * 2 + 1;
        if (side > 0) idx.push(a0, a1, b0, b1, b0, a1); else idx.push(a0, b0, a1, b1, a1, b0);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };
    // Dış hattın içini dolduran yüzey: eş merkezli halkalar + merkezde yelpaze.
    // Düz bir üçgen yelpazeye göre gövde eğriliğini doğru izler.
    const fillOutline = (side, win, outline, off, into, rings = 3) => {
      const pos = [], idx = [];
      const n = outline.length;
      for (let k = 0; k < rings; k++) {
        const sc = 1 - k / rings;
        for (const [u, w] of outline) putPoint(side, win, 0.5 + (u - 0.5) * sc, 0.5 + (w - 0.5) * sc, off, pos);
      }
      putPoint(side, win, 0.5, 0.5, off, pos);                 // merkez
      const cIdx = rings * n;
      for (let k = 0; k < rings - 1; k++) for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const a0 = k * n + i, b0 = k * n + j, a1 = (k + 1) * n + i, b1 = (k + 1) * n + j;
        if (side > 0) idx.push(a0, a1, b0, b1, b0, a1); else idx.push(a0, b0, a1, b1, a1, b0);
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n, a0 = (rings - 1) * n + i, b0 = (rings - 1) * n + j;
        if (side > 0) idx.push(a0, cIdx, b0); else idx.push(a0, b0, cIdx);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };
    // Parlama maskesi: bandın tamamını örten, uçlara doğru sivrilen düz panel.
    const bandMask = (side, sA, sB, mTop, mBot, off, into) => {
      const cols = Math.max(10, Math.ceil((sB - sA) / 0.085)), rows = 7;
      const pos = [], idx = [];
      for (let j = 0; j <= rows; j++) for (let i = 0; i <= cols; i++) {
        const u = i / cols, sv = sA + (sB - sA) * u;
        const e = bandAt(sv);
        const k = Math.pow(Math.sin(Math.PI * u), 0.42);      // uçlarda pay -> 0 (kama)
        // Üst kenar taç çizgisine (v = 0,008) kadar çıkabilir, daha yukarı değil:
        // iki taraftaki maske burnun tepesinde birleşirse orta direk kaybolur.
        const vTop = Math.max(0.008, e.top - mTop * k), vBot = e.bot + mBot * k;
        const vv = Math.min(0.999, Math.max(0.001, vTop + (vBot - vTop) * (j / rows)));
        const p = surfacePoint(sv, vv), n = surfaceNormal(sv, vv);
        pos.push(side * (p.x + n.x * off), p.y + n.y * off, p.z + n.z * off);
      }
      for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
        const a = j * (cols + 1) + i, b = a + 1, c = a + cols + 1, d = c + 1;
        if (side > 0) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx); g.computeVertexNormals();
      into.push(g);
    };

    // Cam başına köşe yarıçapları. No.1 ön camın üst-ön köşesi belirgin biçimde
    // daha geniş yuvarlanır — Airbus ön camının imzası budur.
    // Köşeler HAFİFÇE yuvarlatılır. Gerçek Airbus camı köşeli/yamuktur; önceki
    // yarıçaklar (0,20-0,30) panelleri badem biçimli, organik bir "göz"e çeviriyordu.
    // No.1 camın üst-ön köşesi yine de diğerlerinden geniştir — Airbus imzası budur.
    const PANE_R = [
      [0.15, 0.08, 0.09, 0.07],
      [0.10, 0.09, 0.10, 0.09],
      [0.12, 0.12, 0.12, 0.12],
      [0.14, 0.16, 0.16, 0.14],
    ];
    const FW_S = 0.062;          // çerçeve genişliği — istasyon yönünde (m); astar hücresinden (0,055) geniş
    const FW_V = 0.028;          // çerçeve genişliği — çevresel yönde (v birimi); astar hücresinden (0,023) geniş
    const S_FIRST = COCKPIT_WINDOWS[0][0], S_LAST = COCKPIT_WINDOWS[COCKPIT_WINDOWS.length - 1][1];
    for (const side of [-1, 1]) {
      // Maske payı dar tutulur: camların çevresini saran ince bir parlama önleyici
      // şerittir, kocaman bir leke değil. Üst pay, taç çizgisini GEÇMEYECEK biçimde
      // kırpılır (bandMask içinde), böylece burnun tepesinde gövde rengi bir ORTA
      // DİREK şeridi kalır ve iki ön cam birbirinden ayrı okunur.
      bandMask(side, S_FIRST - 0.10, S_LAST + 0.16, 0.016, 0.030, MASK_OUT, winMaskGeos);
      for (let k = 0; k < COCKPIT_WINDOWS.length; k++) {
        const win = COCKPIT_WINDOWS[k];
        const [a, b, v0, v1] = win;
        const inner = unitOutline(PANE_R[k]);
        // Dış hat: birim kare (istasyon ve v yönünde) çerçeve kalınlığı kadar büyütülür
        const du = FW_S / (b - a), dw = FW_V / Math.max(0.04, v1 - v0);
        const outer = inner.map(([u, w]) => [-du + u * (1 + 2 * du), -dw + w * (1 + 2 * dw)]);
        ringBand(side, win, outer, FRAME_OUT, inner, FRAME_OUT, winFrameGeos);   // çerçeve yüzeyi
        ringBand(side, win, inner, FRAME_OUT, inner, GLASS_OUT, winFrameGeos);   // yanak (reveal)
        fillOutline(side, win, inner, GLASS_OUT, winGeos);                       // cam
      }
    }
    // Parlama maskesi: mat, neredeyse siyah. Gövde boyasının üstüne boyanmış gibi durur.
    const maskMat = this.track(new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.82, metalness: 0.05 }));
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(winMaskGeos, false)), maskMat));
    // Çerçeve çift yüzlü: yanak (reveal) şeridinin hangi yöne baktığı bakış açısına göre
    // değişir; çift yüzlü malzemede three.js arka yüzlerde normali kendisi çevirir,
    // dolayısıyla aydınlatma her iki durumda da doğru kalır.
    const frameMat = this.track(new THREE.MeshStandardMaterial({ color: 0x2b3137, roughness: 0.55, metalness: 0.22, side: THREE.DoubleSide }));
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(winFrameGeos, false)), frameMat));
    // Cam: dışarıdan koyu, hafif mavi ve parlak. Ortamda env map yok, bu yüzden metalness
    // düşük tutulur (yüksek metalness env map'siz yüzeyi tamamen karartır) ve parlaklık
    // clearcoat ile verilir: güneş yansıması tek, temiz bir vurgu olarak okunur.
    const glassMat = this.track(new THREE.MeshPhysicalMaterial({
      color: 0x131b24, roughness: 0.14, metalness: 0.10,
      clearcoat: 1, clearcoatRoughness: 0.05, reflectivity: 0.9,
    }));
    // Kokpit camı DIŞARIDAN koyu ve yansımalı görünür (opak malzeme). Bu yüzden
    // KOKPİT GÖRÜNÜMÜNDE gizlenir: aksi halde pilot koyu cama bakar ve dışarısı
    // tamamen kararır. Çerçeveler görünür kalır, böylece ön cam yapısı yerinde durur.
    const glassMesh = new THREE.Mesh(this.track(mergeGeometries(winGeos, false)), glassMat);
    this.group.add(glassMesh);
    this.parts.cockpitGlass = glassMesh;
    // Kapılar, acil çıkışlar, kargo kapakları (ince çerçeveli çıkartmalar)
    // Kapı gövdesi gövdeden bir tık farklı tonda, çerçevesi belirgin koyu: uzaktan da okunur
    // Çift yüzlü: bu ince çıkartmalarda sarım yönüne bağımlılık kalmasın (aynalanan tarafta kaybolmasın)
    // Kapılar gövdeyle aynı boyanır; koyu şemalarda beyaz kapılar yapıştırma gibi durur
    const doorMat = this.track(new THREE.MeshStandardMaterial({ color: (this.livery && this.livery.door !== undefined) ? this.livery.door : 0xe9ecef, roughness: 0.45, metalness: 0.06, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    const seamMat = this.track(new THREE.MeshStandardMaterial({ color: 0x424a52, roughness: 0.75, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }));
    const panelGeos = [], seamGeos = [];
    // Kapı/derz çıkartmaları gövdeden 12 mm taşar (yüzey normali boyunca), böylece
    // kaplamaya gömülmez ve kaba bölüntüyle bile z-fighting yapmaz.
    const addPanel = (side, s0, s1, v0, v1, into) => surfPanel(side, s0, s1, v0, v1, 0.012, into, 3, 3);
    for (const side of [-1, 1]) {
      // Yolcu kapıları (4 adet, ~1,85 m yüksek): iç panel + belirgin koyu çerçeve
      for (const s of [6.45, 15.6, 27.6, 37.0]) { addPanel(side, s, s + 0.92, 0.300, 0.590, panelGeos); addPanel(side, s - 0.10, s + 1.02, 0.283, 0.607, seamGeos); }
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
    // Kokpit İÇ DONANIMI ayrı bir grupta ve 0,48 m aşağıda durur.
    // Önceden pilot göz noktası (y=0,92) glareshield'in (y=1,26) ALTINDA kalıyordu:
    // yani pilot panelin arkasına bakıyordu, dışarıyı göremiyordu. Artık göz noktası
    // glareshield tepesinin ~0,16 m üstünde — gerçek A320'deki gibi panelin üzerinden
    // bakılır, pist ve ufuk doğal biçimde görünür.
    // Kabuk ve tavan paneli kaydırılmaz: kabuğun tavanı cam bandının üstünde kalmalı.
    const gi = new THREE.Group();
    gi.position.y = -0.52;
    g.add(gi);
    // Gösterge paneli + glareshield + FCU ayrıca 0,26 m daha aşağıda durur.
    // Bunlar pilotun İLERİ bakışını kapatmamalıdır: FCU tam göz hizasındayken
    // düz ileri bakışta ekranın ortasını kapatıyor, dışarısı görünmüyordu.
    // Şimdi FCU üst kenarı göz hizasının ~14° altında kalır; ufuk ve pist açıktır,
    // panel ise hafif aşağı bakınca doğal biçimde görünür.
    const gp = new THREE.Group();
    gp.position.y = -0.26;
    gi.add(gp);
    // Zemin, yan duvarlar ve tavan (kokpit görünümünde dış ışık sızmasın)
    // KOKPİT ASTARI (kabuk).
    //
    // Eskiden bu, gövdenin içinde duran basit bir KUTU TÜPtü. Pilot o kutunun ön
    // ağzından dışarı bakıyordu, dolayısıyla görüşü kutunun kenarları kırpıyordu:
    // dışarısı dar bir yarık gibi görünüyor, köşe kirişleri ekranı çaprazlamasına
    // kesiyordu. Camların kendisi hiç işe karışmıyordu.
    //
    // Artık astar GÖVDE KESİTİNİ izler (içeriden ~%1,5 içeride) ve cam bandına denk
    // gelen dörtgenler ATLANIR. Sonuç: içerisi kapalı ve karanlık, dışarısı yalnızca
    // gerçek cam açıklıklarından görünür — yani görüşü uçağın cam çerçeveleri sınırlar.
    // Astar hücresi cam çerçevesinden KÜÇÜK olmalı: açıklık camdan bir hücre büyük
    // kesildiği için, hücre çerçeveden büyükse kesim izi çerçevenin dışına taşar ve
    // kokpitten bakınca testere dişi bir kenar görünür (0,11 m x 0,023 v hücre,
    // 0,042 m x 0,015 v çerçeve ile tam olarak bu oluyordu).
    const SH_S = []; for (let sv = 2.55; sv <= 7.401; sv += 0.055) SH_S.push(+sv.toFixed(3));
    // Halka adımı (1/44 = 0,023 v) cam çerçevesinin payından (0,026) küçük: kesim izi
      // her zaman çerçevenin altında kalır, ama üçgen sayısı gereksiz yere şişmez.
      const SH_N = 88;
    {
      const rows = SH_S.map((sv) => {
        const row = [];
        for (let i = 0; i < SH_N; i++) {
          // v: 0 tepe -> 1 alt, sağ yarıdan sol yarıya tam tur
          const h = i / (SH_N / 2);
          const v = h <= 1 ? h : 2 - h;
          const sign = h <= 1 ? 1 : -1;
          // Astar gövde yüzeyinin 3 cm İÇİNDEDİR; öteleme yüzey normali boyunca
          // yapılır (koordinatları katsayıyla çarpmak burunda yanlış yön verir).
          const vc = Math.min(0.9999, Math.max(0.0001, v));
          const q = surfacePoint(sv, vc), nq = surfaceNormal(sv, vc);
          row.push({ x: sign * (q.x - nq.x * 0.03), y: q.y - nq.y * 0.03, z: q.z - nq.z * 0.03, v, sv });
        }
        return row;
      });
      const pos = [], idx = [];
      for (const r of rows) for (const q of r) pos.push(q.x, q.y, q.z);
      const M = SH_N;
      for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < M; k++) {
        const k1 = (k + 1) % M;
        // Dörtgenin köşelerinden biri cam bandına düşüyorsa yüzey açılır: açıklık
        // camdan bir hücre BÜYÜK olur, asla küçük değil (küçük olsaydı camın kenarında
        // karanlık bir şerit kalırdı). Örnekleme yeterince sık olduğu için bu taşma
        // cam çerçevesinin altında kalır ve görünmez.
        const cells = [[i, k], [i, k1], [i + 1, k], [i + 1, k1]];
        let open = false;
        for (const [ii, kk] of cells) { const q = rows[ii][kk]; if (linerOpen(q.sv, q.v)) { open = true; break; } }
        if (open) continue;
        const a = i * M + k, b = i * M + k1, c = (i + 1) * M + k, d = (i + 1) * M + k1;
        idx.push(a, c, b, b, c, d);
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      sg.setIndex(idx); sg.computeVertexNormals();
      g.add(new THREE.Mesh(this.track(sg), m.cockpit));
      // Arka bölme: kabin tarafından ışık sızmasın
      const bulk = new THREE.CircleGeometry(1.95, 20);
      bulk.translate(0, -0.03, Z(7.42));
      g.add(new THREE.Mesh(this.track(bulk), m.cockpit));
    }
    const floor = new THREE.BoxGeometry(3.1, 0.08, 4.3); floor.translate(0, 0.12, Z(5.3));
    gi.add(new THREE.Mesh(this.track(floor), m.cockpit));
    // Gösterge paneli ve 6 ekran (PFD / ND x2, ECAM x2)
    const panel = new THREE.BoxGeometry(2.05, 0.66, 0.28); panel.rotateX(-0.22); panel.translate(0, 0.86, Z(3.95));
    gp.add(new THREE.Mesh(this.track(panel), m.dark));
    const glare = new THREE.BoxGeometry(2.25, 0.16, 0.52); glare.rotateX(-0.18); glare.translate(0, 1.26, Z(3.85));
    gp.add(new THREE.Mesh(this.track(glare), m.cockpit));
    const screens = [
      ['pfd', -0.76], ['nd', -0.30], ['ecam', 0.02], ['ecam', 0.02], ['nd', 0.34], ['pfd', 0.78],
    ];
    const texs = { pfd: this.track(makeAirbusScreenTexture('pfd', 256)), nd: this.track(makeAirbusScreenTexture('nd', 256)), ecam: this.track(makeAirbusScreenTexture('ecam', 256)) };
    const mats = {};
    for (const k of Object.keys(texs)) mats[k] = this.track(new THREE.MeshStandardMaterial({ map: texs[k], emissive: 0xffffff, emissiveMap: texs[k], emissiveIntensity: 1.05, roughness: 0.35 }));
    const place = (kind, x, y, z, w, h) => {
      const q = new THREE.Mesh(this.track(new THREE.PlaneGeometry(w, h)), mats[kind]);
      q.position.set(x, y, z); q.rotation.x = 0.22;
      gp.add(q);
    };
    for (const [kind, x] of [['pfd', -0.76], ['nd', -0.34], ['nd', 0.34], ['pfd', 0.76]]) place(kind, x, 0.93, Z(3.95) + 0.16, 0.36, 0.30);
    place('ecam', 0, 1.02, Z(3.95) + 0.15, 0.32, 0.26);
    place('ecam', 0, 0.72, Z(3.95) + 0.20, 0.32, 0.26);
    // FCU (otopilot paneli) glareshield üstünde
    const fcu = new THREE.BoxGeometry(1.35, 0.17, 0.20); fcu.rotateX(-0.5); fcu.translate(0, 1.36, Z(3.72));
    gp.add(new THREE.Mesh(this.track(fcu), m.dark));
    const fcuFace = new THREE.Mesh(this.track(new THREE.PlaneGeometry(1.25, 0.12)), this.track(new THREE.MeshStandardMaterial({ color: 0x0b1016, emissive: 0x1b6f3a, emissiveIntensity: 0.7, roughness: 0.4 })));
    fcuFace.position.set(0, 1.39, Z(3.72) + 0.09); fcuFace.rotation.x = 0.5;
    gp.add(fcuFace);
    // Orta konsol (pedestal): gaz kolları, flap ve hız freni kolları, radyolar
    const ped = new THREE.BoxGeometry(0.52, 0.30, 1.50); ped.rotateX(-0.12); ped.translate(0, 0.46, Z(5.05));
    gi.add(new THREE.Mesh(this.track(ped), m.dark));
    const thrGrp = new THREE.Group();
    for (const dx of [-0.11, 0.11]) {
      const lev = new THREE.BoxGeometry(0.075, 0.30, 0.10); lev.translate(dx, 0.15, 0);
      const knob = new THREE.SphereGeometry(0.06, 8, 6); knob.scale(1, 1.2, 1); knob.translate(dx, 0.31, 0);
      thrGrp.add(new THREE.Mesh(this.track(lev), m.metal), new THREE.Mesh(this.track(knob), this.track(new THREE.MeshStandardMaterial({ color: 0x14181c, roughness: 0.6 }))));
    }
    thrGrp.position.set(0, 0.52, Z(4.72));
    gi.add(thrGrp);
    this.parts.thrustLevers = thrGrp;
    const flapLever = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.06, 0.26, 0.07)), m.metal);
    flapLever.position.set(0.18, 0.66, Z(5.35));
    gi.add(flapLever); this.parts.flapLever = flapLever;
    const sbLever = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, 0.22, 0.06)), this.track(new THREE.MeshStandardMaterial({ color: 0x2c3238, roughness: 0.6 })));
    sbLever.position.set(-0.18, 0.64, Z(5.25));
    gi.add(sbLever); this.parts.sbLever = sbLever;
    // Sidestick'ler (kaptan sol, yardımcı sağ) ve iniş takımı kolu
    this.parts.sidesticks = [];
    for (const side of [-1, 1]) {
      const s = new THREE.Group();
      const col = new THREE.CylinderGeometry(0.035, 0.045, 0.30, 8); col.translate(0, 0.15, 0);
      const grip = new THREE.CapsuleGeometry(0.045, 0.12, 4, 8); grip.translate(0, 0.36, 0);
      s.add(new THREE.Mesh(this.track(col), m.dark), new THREE.Mesh(this.track(grip), this.track(new THREE.MeshStandardMaterial({ color: 0x20252a, roughness: 0.7 }))));
      s.position.set(side * 0.62, 0.50, Z(4.95));
      gi.add(s);
      this.parts.sidesticks.push(s);
      // Koltuklar
      const seat = new THREE.Group();
      const cush = new THREE.BoxGeometry(0.52, 0.12, 0.52); cush.translate(0, 0.44, 0);
      const back = new THREE.BoxGeometry(0.52, 0.72, 0.12); back.rotateX(-0.18); back.translate(0, 0.84, 0.30);
      seat.add(new THREE.Mesh(this.track(cush), m.seat), new THREE.Mesh(this.track(back), m.seat));
      seat.position.set(side * 0.44, 0, Z(5.35));
      gi.add(seat);
    }
    const gearLever = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.05, 0.16, 0.05)), this.track(new THREE.MeshStandardMaterial({ color: 0xd8dade, roughness: 0.4 })));
    gearLever.position.set(0.55, 0.95, Z(4.18));
    gi.add(gearLever); this.parts.gearLever = gearLever;
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
    // Seyir ışıkları KANAT UCU KAPORTASINA oturur: kırmızı/yeşil hücum kenarında,
    // beyaz flaşör firar kenarında — sharklet'in dibinde, gerçek A320neo'daki gibi.
    //
    // Önceden ışıklar (tipX + 0,35; wingY + 2,30) noktasındaydı. Bu, sharklet'ten
    // ÖNCEKİ modelin kanat ucuydu; sharklet eklendikten sonra o nokta ne kanadın ne
    // de sharklet'in üstünde kaldı: ışıklar havada, uçağın ~1 m yanında asılı
    // duruyordu. Artık konumlar doğrudan kanat geometrisinden türetilir.
    const tipX = WING.tipX, tipY = wingY(tipX), tipLE = wingLE(tipX), tipTE = wingTE(tipX);
    const navZ = st(tipLE + 0.26);        // uç veterin hemen arkası: lens hücum kenarında
    const strZ = st(tipTE - 0.16);        // firar kenarı: beyaz çakar
    const lensX = tipX + 0.02;            // kaportanın dış yüzeyi
    this.lights = {
      navLeft: mk(0xff2a2a, -lensX, tipY + 0.02, navZ, 0.30),
      navRight: mk(0x22ff44, lensX, tipY + 0.02, navZ, 0.30),
      tail: mk(0xffffff, 0, 2.41, st(44.05), 0.26),
      strobeLeft: mk(0xffffff, -lensX, tipY + 0.01, strZ, 0.46),
      strobeRight: mk(0xffffff, lensX, tipY + 0.01, strZ, 0.46),
      beaconTop: mk(0xff3020, 0, 2.05, st(19.0), 0.40),
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
    if (this.parts.cockpitGlass) this.parts.cockpitGlass.visible = !on;
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
      for (const s of p.spoilers[side]) setHinge(s, -sp * 45 * DEG);
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
