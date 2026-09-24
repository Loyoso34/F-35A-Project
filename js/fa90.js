// FA-90 Vesper — KURGUSAL 7. nesil hava üstünlüğü savaş uçağı.
// Tamamen kod ile üretilir. Hiçbir gerçek uçağın geometrisi kopyalanmamıştır.
//
// Eksenler: burun -Z, üst +Y, sağ kanat +X.  Uzunluk 19,6 m, açıklık 14,8 m.
//
// SİLUET (kendine özgü olması için bilinçli seçimler):
//   - TAŞIYAN GÖVDE: gövde 6,7 m genişliğinde, açıklığın %45'i. Kesit elmas biçimli:
//     düz üst güverte, keskin ÇİNE kenarı, düz karın. Kesitin hiçbir yerinde daire yok.
//   - TEK SÜREKLİ KENAR: çine burun ucundan başlar, ~74° ok açısıyla arkaya süpürülür,
//     gövdenin en geniş yerinde KIRILIR ve kanat hücum kenarı olarak 44°/38° ile devam
//     eder. Bu "kırık lambda" hattı uçağın imzasıdır.
//   - TESTERE DİŞLİ FİRAR KENARI: kanat firar kenarı W biçimindedir (iki çentik).
//   - KUYRUKSUZ: yatay kuyruk yoktur; yunuslama ve yatış ELEVONlarla yapılır.
//     Sapma, arka güvertedeki 45° eğik TAM HAREKETLİ iki yüzeyle sağlanır.
//   - 2B DİKDÖRTGEN LÜLELER: arka güvertede gömülü, testere dişli çıkışlı.
//   - DSI benzeri gömülü hava alıkları çinenin altında, sıkıştırma tümseğiyle.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loft, ensureOutward, airfoilPoints, getSharedMaterials } from './aircraft.js';
import { makeFlameNoiseTexture, makeGlowTexture, makeMilInsigniaTexture, makeTextTexture } from './textures.js';
import { getLivery } from './liveries.js';

const DEG = Math.PI / 180;
export const FA90 = {
  length: 19.6, span: 14.8, height: 4.54,
  cgStation: 10.4,
  // Takım boyu kuyruk çarpma açısına göre seçildi: kuyruk altı (s=19,6) y=-0,670,
  // ana teker teması y=-2,50 ve s=11,30 => atan(1,830/8,30) = 12,4°.
  wheelBottomY: -2.50,
  noseGearZ: 4.60 - 10.4, mainGearZ: 11.30 - 10.4, mainGearX: 2.05,
  pilotEye: new THREE.Vector3(0, 1.00, 4.35 - 10.4),
};
const st = (s) => s - FA90.cgStation;

// ---------------------------------------------------------------------------
// Gövde kesitleri: [istasyon, üst y, çine yarı genişliği, çine y, alt merkez y,
//                   üst süperelips üssü, alt süperelips üssü, düz güverte yarı genişliği]
// Yan yüzey ve alt köşe bunlardan türetilir (aşağıda), böylece tablo okunur kalır.
const SECT = [
  [0.00, 0.020, 0.024, 0.000, -0.022, 2.4, 2.6, 0.006],
  [0.30, 0.135, 0.180, -0.004, -0.150, 2.6, 2.8, 0.026],
  [0.70, 0.250, 0.390, -0.012, -0.295, 2.8, 3.0, 0.062],
  [1.20, 0.370, 0.640, -0.024, -0.440, 3.0, 3.2, 0.110],
  [1.80, 0.480, 0.910, -0.042, -0.580, 3.1, 3.4, 0.170],
  [2.50, 0.580, 1.200, -0.064, -0.710, 3.2, 3.6, 0.250],
  [3.30, 0.665, 1.500, -0.090, -0.825, 3.2, 3.8, 0.420],
  [4.20, 0.740, 1.810, -0.120, -0.930, 3.2, 4.0, 0.620],
  [5.20, 0.815, 2.120, -0.152, -1.025, 3.1, 4.2, 0.800],
  [6.30, 0.885, 2.430, -0.185, -1.110, 3.0, 4.3, 0.930],
  [7.50, 0.945, 2.720, -0.215, -1.180, 3.0, 4.4, 1.020],
  [8.80, 0.995, 2.980, -0.240, -1.240, 3.0, 4.5, 1.080],
  [10.20, 1.030, 3.200, -0.258, -1.285, 3.0, 4.5, 1.110],
  [11.60, 1.040, 3.330, -0.266, -1.305, 3.0, 4.5, 1.120],
  [13.00, 1.020, 3.360, -0.264, -1.295, 3.0, 4.5, 1.100],
  [14.40, 0.975, 3.290, -0.252, -1.250, 3.0, 4.4, 1.050],
  [15.80, 0.915, 3.120, -0.230, -1.170, 3.0, 4.3, 0.980],
  [17.00, 0.855, 2.860, -0.205, -1.060, 3.0, 4.2, 0.900],
  [18.20, 0.790, 2.480, -0.170, -0.880, 3.0, 4.0, 0.800],
  [19.10, 0.735, 2.060, -0.135, -0.710, 3.0, 3.8, 0.700],
  [19.60, 0.700, 1.780, -0.110, -0.615, 3.0, 3.6, 0.640],
];
function sectAt(s) {
  if (s <= SECT[0][0]) return SECT[0];
  if (s >= SECT[SECT.length - 1][0]) return SECT[SECT.length - 1];
  for (let i = 0; i < SECT.length - 1; i++) {
    const a = SECT[i], b = SECT[i + 1];
    if (s >= a[0] && s <= b[0]) {
      const t = (s - a[0]) / (b[0] - a[0]);
      // Yumuşak geçiş: türev uçlarda sıfır, böylece istasyonlar arası kırık oluşmaz
      const u = t * t * (3 - 2 * t);
      return a.map((v, k) => (k === 0 ? s : v + (b[k] - v) * u));
    }
  }
  return SECT[SECT.length - 1];
}
export const bodyTop = (s) => sectAt(s)[1];
export const bodyChineX = (s) => sectAt(s)[2];
export const bodyChineY = (s) => sectAt(s)[3];
export const bodyBottom = (s) => sectAt(s)[4];

// Sağ yarı kesit: 12 nokta (üst güverte -> çine -> yan -> düz karın).
function halfSection(sec) {
  const [, yt, xc, yc, ybot, nt, nb, dk0] = sec;
  const dk = Math.min(dk0, xc * 0.92);
  const xb = 0.80 * xc, yb = ybot + 0.06 * (yc - ybot) + 0.02;
  const xs = 0.985 * xc, ys = yc + 0.58 * (ybot - yc);
  const pts = [{ x: 0, y: yt }, { x: dk, y: yt }];
  for (let i = 1; i <= 4; i++) {
    const th = (i / 4) * Math.PI / 2;
    pts.push({ x: dk + (xc - dk) * Math.pow(Math.sin(th), 2 / nt), y: yc + (yt - yc) * Math.pow(Math.cos(th), 2 / nt) });
  }
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    pts.push({
      x: (1 - t) * (1 - t) * xc + 2 * (1 - t) * t * xs + t * t * xb,
      y: (1 - t) * (1 - t) * yc + 2 * (1 - t) * t * ys + t * t * yb,
    });
  }
  for (let i = 1; i <= 3; i++) {
    const th = (i / 3) * Math.PI / 2;
    pts.push({ x: xb * Math.pow(Math.cos(th), 2 / nb), y: ybot + (yb - ybot) * Math.pow(Math.sin(th), 2 / nb) });
  }
  return pts;   // 12 nokta
}

// ---------------------------------------------------------------------------
// Kanat planformu. Hücum kenarı çinenin devamıdır; firar kenarı W biçimlidir.
const WING = { rootX: 2.24, crankX: 5.60, tipX: 7.40, rootY: -0.255, anhedral: 2.5 * DEG };
const LE_PTS = [[2.24, 9.20], [5.60, 12.35], [7.40, 13.75]];
const TE_PTS = [[2.24, 18.00], [4.60, 16.30], [5.60, 16.75], [7.40, 15.30]];
function pw(pts, x) {
  const a = Math.abs(x);
  if (a <= pts[0][0]) return pts[0][1] + (pts[1][1] - pts[0][1]) * (a - pts[0][0]) / (pts[1][0] - pts[0][0]);
  for (let i = 0; i < pts.length - 1; i++) if (a <= pts[i + 1][0]) {
    return pts[i][1] + (pts[i + 1][1] - pts[i][1]) * (a - pts[i][0]) / (pts[i + 1][0] - pts[i][0]);
  }
  const n = pts.length;
  return pts[n - 1][1] + (pts[n - 1][1] - pts[n - 2][1]) * (a - pts[n - 1][0]) / (pts[n - 1][0] - pts[n - 2][0]);
}
export const wingLE = (x) => pw(LE_PTS, x);
export const wingTE = (x) => pw(TE_PTS, x);
export const wingY = (x) => WING.rootY - Math.max(0, Math.abs(x) - WING.rootX) * Math.tan(WING.anhedral);
export const wingThick = (x) => {
  const a = Math.abs(x);
  const f = Math.min(1, Math.max(0, (a - WING.rootX) / (WING.tipX - WING.rootX)));
  // Uçta profil kapanır: loft'un son halkası neredeyse sıfır kalınlıkta olur, böylece
  // kanat ucunda açık delik kalmaz ve seyir feneri kapalı bir yüzeye oturur.
  const tipFade = Math.min(1, Math.max(0, (WING.tipX - a) / 0.18));
  return (0.058 - 0.013 * f) * (0.16 + 0.84 * tipFade);
};
// Menteşe çizgileri DÜZDÜR (firar kenarı W olsa bile): gerçek bir eyleyici için şart.
// Bu yüzden W'nin her kolu AYRI bir yüzeydir; tek bir kırık menteşe etrafında dönen
// yüzey fiziksel olarak imkansız olurdu. Yan başına üç yüzey: flaperon + 2 elevon.
// Değerler firar kenarından sabit veter payı geriye alınarak türetildi.
const SURF = [
  { key: 'flaperon', x0: 2.95, x1: 4.45, h: [[2.95, 16.549], [4.45, 15.368]] },
  { key: 'elevonMid', x0: 4.60, x1: 5.52, h: [[4.60, 15.500], [5.52, 15.914]] },
  { key: 'elevonOut', x0: 5.68, x1: 7.22, h: [[5.68, 16.106], [7.22, 14.865]] },
];
// Eğik tam hareketli dikey yüzeyler (buildFins ve kuyruk işaretleri ortak kullanır).
// travel: GÖRSEL en büyük sapma. Uçuş modeli dümeni birim girdiyle (Cndr) hesaplar;
// bu açı yalnızca animasyondur. 22° iken kök firar kenarı arka gövdenin kenarını
// (çine) aşıp altına sarkıyordu (ölçüm: 21°'de 19,5 cm); 20°'ye kadar taşma yok,
// 18° güvenli paydır.
const FIN = {
  x: 2.35, s: 16.30, cant: 45 * DEG, height: 1.80, bury: 0.07,
  leRoot: 14.20, teRoot: 18.20, leTip: 16.95, teTip: 18.35,
  thickRoot: 0.058, thickTip: 0.042, pivotFrac: 0.26, travel: 18 * DEG,
};
const hingeZ = (tab, x) => tab[0][1] + (tab[1][1] - tab[0][1]) * (Math.abs(x) - tab[0][0]) / (tab[1][0] - tab[0][0]);
// Menteşenin yerel veter kesri
const cfrac = (tab, x) => {
  const le = wingLE(x), te = wingTE(x);
  return Math.min(0.96, Math.max(0.06, (hingeZ(tab, x) - le) / (te - le)));
};
// Sabit kanat panellerinin profil örnek sayısı (buildWings) — işaretler aynı çokgeni izler
const WING_K = 13;

// Gövde üst ve alt yüzeyinin verilen istasyon + x'teki yüksekliği. halfSection()
// çıktısının dallarında doğrusal aranır (0..5 üst, 11..8 alt).
function branchY(s, x, upper) {
  const p = halfSection(sectAt(s));
  const ax = Math.abs(x);
  const b = upper ? [p[0], p[1], p[2], p[3], p[4], p[5]] : [p[11], p[10], p[9], p[8]];
  for (let i = 0; i < b.length - 1; i++) {
    if (ax <= b[i + 1].x) {
      const d = b[i + 1].x - b[i].x;
      const t = d > 1e-6 ? (ax - b[i].x) / d : 0;
      return b[i].y + (b[i + 1].y - b[i].y) * t;
    }
  }
  return b[b.length - 1].y;
}
export const upperY = (s, x) => branchY(s, x, true);
export const lowerY = (s, x) => branchY(s, x, false);
// Kesitin yan dalı (çine -> karın köşesi) üzerinde u parametresi. Gövde loft'uyla
// AYNI çoklu çizgidir (halfSection noktaları 5..8), yani yüzeyin kendisidir.
function sideP(sec, u) {
  const pts = halfSection(sec);
  const b = [pts[5], pts[6], pts[7], pts[8]];
  const t = Math.min(0.9999, Math.max(0, u)) * 3;
  const i = Math.min(2, Math.floor(t)), f = t - i;
  return { x: b[i].x + (b[i + 1].x - b[i].x) * f, y: b[i].y + (b[i + 1].y - b[i].y) * f };
}
function sideN(sec, u) {
  const a = sideP(sec, Math.max(0, u - 0.02)), c = sideP(sec, Math.min(1, u + 0.02));
  const tx = c.x - a.x, ty = c.y - a.y, L = Math.hypot(tx, ty) || 1;
  return { x: -ty / L, y: tx / L };
}
// Gövde yan dalının GERÇEK yüzeyi: loft istasyonları arasında doğrusal ara değer
// (sectAt'in yumuşak ara değeri istasyonlar arasında yüzeyden 1 cm'ye kadar sapar).
function skinSide(sv, u) {
  let j = 0;
  while (j < FUS_S.length - 2 && FUS_S[j + 1] < sv) j++;
  const a = FUS_S[j], b = FUS_S[j + 1], t = Math.min(1, Math.max(0, (sv - a) / (b - a)));
  const pa = sideP(sectAt(a), u), pb = sideP(sectAt(b), u);
  return { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
}
// Kanat profilinin yarı kalınlığı (m): airfoilPoints ile AYNI NACA dağılımı
// (tek noktalı çağrı, t = c).
const halfThick = (c, thick, chord) => airfoilPoints(1, chord, thick, c, c)[0].y;

// ---------------------------------------------------------------------------
// Motor yerleşimi. Arka gövde (motor bölmesi), nasel kabuğu, dudak ve kanal
// AYNI sayılardan türetilir; böylece parçaların sınır halkaları birebir çakışır.
const ENG = { x: 0.90, y: 0.02, w: 0.42, h: 0.30, ow: 0.62, oh: 0.47, n: 24, pow: 3.6 };
// Gövde -> motor bölmesi geçişi. Başlangıç dikey yüzey köklerinin firar kenarıyla
// çakışır (s = 18,2): bu istasyondan önce gövde kesiti HİÇ değişmez, dolayısıyla
// kanat ve dikey yüzey kökleri eskisi gibi gövdeye oturur. sj: ana gövde loft'unun
// son (22 noktalı) halkası; sj..s0 arası çözünürlük uyarlama şerididir.
const AFT = { sj: 18.00, s0: 18.20, s1: 19.10 };
// Hava alığı: rampa S0..SM, kaporta SM..S1; rampa ve kaportanın yan flanşları deriden
// eps kadar dışarıdadır (formasyon ışığı gibi deri üstü ayrıntılar bunun üstüne oturur).
const INTAKE = { s0: 5.10, sm: 6.30, s1: 11.90, prot: 0.46, ramp: 0.34, eps: 0.006 };
// Ana gövde loft istasyonları: burunda sık (eğrilik yoğun), ortada seyrek; AFT.sj'de
// biter. (İşaretler de gövde yüzeyini bu istasyonlar arası DOĞRUSAL ara değerle izler.)
const FUS_S = (() => {
  const S = [];
  for (let sv = 0; sv < 3.0; sv += 0.25) S.push(+sv.toFixed(2));
  for (let sv = 3.0; sv < 8.0; sv += 0.5) S.push(+sv.toFixed(2));
  for (let sv = 8.0; sv < 16.0; sv += 0.8) S.push(+sv.toFixed(2));
  for (let sv = 16.0; sv < AFT.sj - 1e-6; sv += 0.4) S.push(+sv.toFixed(2));
  S.push(AFT.sj);
  return S;
})();
// Motor bölmesinden dışarı çıkan nasel kabuğu: [istasyon, ölçek]
const NAC = [[AFT.s1, 1.00], [19.38, 0.985], [19.62, 0.95]];
// Lüle çıkış alanı açılması (askeri güç + art yakıcı). Biçim hedefi en açık hâle
// göre kurulur; update() ağırlığı buradan hesaplar.
const NOZ_OPEN = { mil: 0.04, ab: 0.16 };
const NOZ_OPEN_MAX = 1 + NOZ_OPEN.mil + NOZ_OPEN.ab;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Yuvarlatılmış dikdörtgen (süperelips) halka
function rrect(cx, cy, w, h, n = ENG.n, p = ENG.pow) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s2 = Math.sin(a);
    out.push({ x: cx + w * Math.sign(c) * Math.pow(Math.abs(c), 2 / p), y: cy + h * Math.sign(s2) * Math.pow(Math.abs(s2), 2 / p) });
  }
  return out;
}

// ---------------------------------------------------------------------------
export class FA90Vesper {
  constructor({ quality = 'medium', forStatic = false, livery = null } = {}) {
    this.group = new THREE.Group();
    this.group.name = 'FA-90 Vesper';
    this.parts = {};
    this.disposables = [];
    this.forStatic = forStatic;
    this.livery = getLivery('fa90', livery);
    this.m = forStatic ? getSharedMaterials() : this.liveryMaterials(getSharedMaterials(), this.livery);
    this.paintGeos = [];
    this.buildFuselage();
    this.buildAftBody();
    this.buildChineEdge();
    this.buildIntakes();
    this.buildCanopy();
    this.buildWings();
    this.buildFins();
    this.buildAirbrake();
    this.buildNozzles();
    this.buildGear();
    this.buildDetails();
    this.buildLights();
    this.finalize();
  }

  track(o) { this.disposables.push(o); return o; }

  // Livery yalnızca görseldir: paylaşılan malzeme nesnesi asla değiştirilmez,
  // yalnızca boyalı malzemelerin kopyası bu örneğe özel hale getirilir.
  liveryMaterials(shared, liv) {
    if (!liv) return shared;
    const m = Object.assign({}, shared);
    const paint = this.track(shared.paint.clone());
    paint.color.setHex(liv.paint);
    if (liv.roughness !== undefined) paint.roughness = liv.roughness;
    if (liv.metalness !== undefined) paint.metalness = liv.metalness;
    m.paint = paint;
    const dark = this.track(shared.paintDark.clone());
    dark.color.setHex(liv.paintDark);
    m.paintDark = dark;
    if (liv.metalTint !== undefined) { const mt = this.track(shared.metal.clone()); mt.color.setHex(liv.metalTint); m.metal = mt; }
    return m;
  }

  sectionPoints(s) { return halfSection(sectAt(s)).map((q) => ({ x: q.x, y: q.y, z: st(s) })); }

  // Kapalı bir loft halkasını üçgen yelpazeyle kapatır.
  //
  // NEDEN: loft() yalnızca halkalar ARASINI örer; ilk ve son halka AÇIK kalır.
  // Mesh denetiminde gövdede 158 m açık kenar ve arka açılardan gelen ışınların
  // %28'inde TEK parite (= ışın gövdeye girip çıkamıyor) bunun sonucuydu.
  // Artık açıkta kalan her loft ucu buradan geçirilir.
  //
  // Sarım yönü Newell normali ile otomatik seçilir, böylece kapak her zaman
  // DIŞA bakar ve ters normal / backface sorunu oluşmaz.
  ringCap(ring, outward) {
    const n = ring.length;
    let cx = 0, cy = 0, cz = 0;
    for (const q of ring) { cx += q.x / n; cy += q.y / n; cz += q.z / n; }
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
    }
    const flip = (nx * outward.x + ny * outward.y + nz * outward.z) < 0;
    const pos = [cx, cy, cz], idx = [];
    for (const q of ring) pos.push(q.x, q.y, q.z);
    // (c, p_i, p_i+1) halkanın kendi yönünde döner ve normali N'dir (sağ el kuralı).
    // ÖNCEKİ SÜRÜMDE DALLAR TERSTİ: her kapak istenen yönün tam tersine bakıyor,
    // FrontSide malzemede dışarıdan ELENİYORDU (birim testle ölçüldü: dört vakanın
    // dördü de ters). Işın paritesi testi tüm malzemeleri çift yüzlü yaptığı için
    // bunu göremiyordu.
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (flip) idx.push(0, j + 1, i + 1); else idx.push(0, i + 1, j + 1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  // Tam kesit halkası: sağ yarı + aynalanmış sol yarı (uç noktalar paylaşılır)
  fullSection(sv) {
    const r = this.sectionPoints(sv);
    const out = r.slice();
    for (let k = r.length - 2; k >= 1; k--) out.push({ x: -r[k].x, y: r[k].y, z: r[k].z });
    return out;
  }

  buildFuselage() {
    // Ana gövde AFT.sj'de (18,0) biter; sonrası buildAftBody()'nin uyarlama şeridi
    // ve motor bölmesidir.
    const full = FUS_S.map((sv) => this.fullSection(sv));
    this.paintGeos.push(ensureOutward(loft(full, { uScale: 2.4, vScale: 1.2, closeRing: true }), (v, o) => o.set(0, -0.1, v.z)));
    // Burun kapağı. Eski el yazımı sarım TERSTİ (normal içe bakıyordu); ringCap
    // ile dışa bakacak şekilde üretilir. Kuyruk kapağı artık YOK: yerini
    // buildAftBody()'nin motor bölmesi ve arka perdesi aldı.
    this.paintGeos.push(this.ringCap(full[0], new THREE.Vector3(0, 0, -1)));
  }

  // ---- MOTOR BÖLMESİ (arka gövde) ---------------------------------------
  //
  // KÖK NEDEN (ölçüldü): gövde loft'u s = 19,6'da düz bir kuyruk kapağıyla
  // bitiyordu ve bu kapağın sarımı TERSTİ — normali ileri, uçağın İÇİNE
  // bakıyordu. FrontSide malzemede arkadan bakıldığında kapak eleniyor, arka yüz
  // tümden kayboluyordu; gövdenin iç yüzleri de (onlar da arka yüz olduğu için)
  // elendiğinden, lüleler BOŞ bir kabuğun içinde asılı görünüyordu. Çift yüzlü
  // kapsama maskesiyle piksel karşılaştırması: arka görünüm 6 387, yakın arka
  // görünüm 33 311 "delik" pikseli.
  //
  // Yalnızca sarımı çevirmek YETMEZDİ: düz kapak kanalları s = 19,6'da keserek
  // egzoz tünelini 4 cm derinliğe indirirdi (tam da istenmeyen "düz kapak").
  // Bunun yerine gövde, 18,2 -> 19,1 arasında iki motoru saran bir MOTOR BÖLMESİ
  // kesitine dönüşür ve 19,1'de motor delikleri olan kısa bir arka perdeyle
  // kapanır. Naseller oradan dışarı çıkar.
  buildAftBody() {
    const S0 = AFT.s0, S1 = AFT.s1, CY = -0.01;       // CY: açısal örnekleme merkezi
    // (1) Motor bölmesi kesiti: iki motor lobu, aralarında bel, dışta bıçak ağzına
    //     incelen raf. A = gövdenin S1'deki çine yarı genişliği, yani PLAN
    //     görünüşündeki gövde genişliği korunur (tasarım dili değişmez).
    const A = bodyChineX(S1), B = 0.60, P = 4.0, WAIST = 0.32, SIG = 0.36;
    const poly = [];
    for (let i = 0; i < 720; i++) {
      const t = (i / 720) * Math.PI * 2, c = Math.cos(t), sn = Math.sin(t);
      const x = A * Math.sign(c) * Math.pow(Math.abs(c), 2 / P);
      const waist = 1 - WAIST * Math.exp(-((x / SIG) ** 2));
      const shelf = 1 - 0.88 * sstep(1.55, A, Math.abs(x));
      poly.push({ x, y: ENG.y + B * waist * shelf * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / P) });
    }
    // Merkezden açıyla ışın -> kesit sınırıyla EN UZAK kesişim
    const hit = (cx, cy, th) => {
      const dx = Math.cos(th), dy = Math.sin(th);
      let best = null, bt = -1;
      for (let i = 0; i < poly.length; i++) {
        const pa = poly[i], pb = poly[(i + 1) % poly.length];
        const ex = pb.x - pa.x, ey = pb.y - pa.y;
        const den = dx * ey - dy * ex;
        if (Math.abs(den) < 1e-12) continue;
        const wx = pa.x - cx, wy = pa.y - cy;
        const t = (wx * ey - wy * ex) / den, u = (wx * dy - wy * dx) / den;
        if (t > 0 && u >= 0 && u <= 1 && t > bt) { bt = t; best = { x: cx + dx * t, y: cy + dy * t }; }
      }
      return best;
    };
    // (2) Gövdenin kendi halkası, kenarları 3'e bölünerek inceltilir (motor lobları
    //     ve bel 22 noktayla temsil edilemeyecek kadar ayrıntılı).
    const refine = (ring, m) => {
      const o = [];
      for (let i = 0; i < ring.length; i++) {
        const qa = ring[i], qb = ring[(i + 1) % ring.length];
        for (let k = 0; k < m; k++) { const t = k / m; o.push({ x: qa.x + (qb.x - qa.x) * t, y: qa.y + (qb.y - qa.y) * t, z: qa.z }); }
      }
      return o;
    };
    const base = refine(this.fullSection(S0), 3);
    // (2b) UYARLAMA ŞERİDİ (AFT.sj -> S0). Eskiden 22 noktalı ana loft ile 66 noktalı
    //      geçiş loft'u AYNI istasyonda buluşuyordu: kaba kenarın ortasındaki ince
    //      noktalar T-kavşağı oluşturuyor, kayan nokta yuvarlaması kenar boyunca
    //      piksel çatlakları açıyordu (arka açılardan gövdenin İÇİNDEN karın ve
    //      burun iç yüzleri görünüyordu). Burada her kaba kenar dört üçgenle üç ince
    //      kenara bağlanır; iki komşu loft'la paylaşılan tüm kenarlar BİREBİR aynıdır.
    {
      const coarse = this.fullSection(AFT.sj), nc = coarse.length, nf = base.length;
      const pos = [], uv = [], idx = [];
      coarse.forEach((q, k) => { pos.push(q.x, q.y, q.z); uv.push(0, (k / nc) * 1.2); });
      base.forEach((q, k) => { pos.push(q.x, q.y, q.z); uv.push(0.03, (k / nf) * 1.2); });
      for (let i = 0; i < nc; i++) {
        const a0 = i, a1 = (i + 1) % nc, b = (k) => nc + ((3 * i + k) % nf);
        idx.push(a0, b(0), b(1), a0, b(1), b(2), a0, b(2), a1, a1, b(2), b(3));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      this.paintGeos.push(ensureOutward(g, (v, o) => o.set(0, CY, v.z)));
    }
    const target = base.map((q) => hit(0, CY, Math.atan2(q.y - CY, q.x)));
    // (3) Geçiş loft'u. smoothstep başta gövdeyle teğet sürekliliği, sonda eksene
    //     paralel varışı sağlar (kırık çizgi oluşmaz).
    const NJ = 7, rows = [];
    for (let j = 0; j <= NJ; j++) {
      const u = j / NJ, bl = u * u * (3 - 2 * u), sv = S0 + (S1 - S0) * u;
      const fus = refine(this.fullSection(sv), 3);
      rows.push(fus.map((q, k) => ({ x: q.x + (target[k].x - q.x) * bl, y: q.y + (target[k].y - q.y) * bl, z: st(sv) })));
    }
    this.paintGeos.push(ensureOutward(loft(rows, { uScale: 1.4, vScale: 1.2, closeRing: true }), (v, o) => o.set(0, CY, v.z)));
    // (4) Arka perde: dış kontur = geçişin son halkası, delikler = naselin S1
    //     halkası. Üçü de BİREBİR aynı noktalardır => birleşim su geçirmez.
    const outer = rows[NJ];
    const holes = [-1, 1].map((sd) => rrect(sd * ENG.x, ENG.y, ENG.ow * NAC[0][1], ENG.oh * NAC[0][1]));
    const faces = THREE.ShapeUtils.triangulateShape(
      outer.map((q) => new THREE.Vector2(q.x, q.y)),
      holes.map((h) => h.map((q) => new THREE.Vector2(q.x, q.y))));
    const zB = st(S1), pos = [], idx = [];
    for (const q of outer) pos.push(q.x, q.y, zB);
    for (const h of holes) for (const q of h) pos.push(q.x, q.y, zB);
    let area = 0;
    for (const f of faces) {
      const [i0, i1, i2] = f;
      area += (pos[i1 * 3] - pos[i0 * 3]) * (pos[i2 * 3 + 1] - pos[i0 * 3 + 1]) - (pos[i2 * 3] - pos[i0 * 3]) * (pos[i1 * 3 + 1] - pos[i0 * 3 + 1]);
      idx.push(i0, i1, i2);
    }
    // Normal +z'ye (ARKAYA) bakmalı; earcut'ın çıktı yönü garanti değil, ölçülür.
    if (area < 0) for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.paintGeos.push(g);
  }

  // Çine kenarı: burun ucundan kanat hücum kenarına kadar uzanan keskin,
  // hafifçe aşağı bükülmüş bir dudak. Uçağın imzası olan tek sürekli hat budur.
  buildChineEdge() {
    const S = [0.6, 1.2, 2.0, 2.9, 3.9, 5.0, 6.2, 7.5, 8.9, 10.2];
    for (const side of [-1, 1]) {
      const rows = S.map((s) => {
        const xc = bodyChineX(s), yc = bodyChineY(s);
        const w = Math.min(0.16, 0.03 + xc * 0.055);      // dudak genişliği
        return [
          { x: side * xc, y: yc + 0.012, z: st(s) },
          { x: side * (xc + w), y: yc - 0.010, z: st(s + 0.05) },
          { x: side * xc, y: yc - 0.014, z: st(s) },
        ];
      });
      this.paintGeos.push(ensureOutward(loft(rows, { uScale: 2, vScale: 1, closeRing: true }), (v, o) => o.set(side * bodyChineX(v.z + FA90.cgStation) * 0.6, v.y, v.z)));
      this.paintGeos.push(this.ringCap(rows[0], new THREE.Vector3(0, 0, -1)));
      this.paintGeos.push(this.ringCap(rows[rows.length - 1], new THREE.Vector3(0, 0, 1)));
    }
  }

  // Çinenin altındaki gömülü hava alıkları (DSI mantığı).
  //
  // Rampa da kaporta da AYRI levhalar değil, deriye oturan KAPALI HACİMLERDİR: her
  // istasyonda kesit, dış yay ile gövde derisini izleyen taban yayı arasındaki
  // halkadır. Uçlar kapaklıdır; tek açıklık ağızdır ve o da kanal cebiyle kapanır.
  //   - RAMPA (S0..SM): sıkıştırma tümseği, ağzın iç tabanını oluşturur.
  //   - NASEL (SM..S1): dış kaporta; motor hizasında şişer, sonra deriye iner.
  //   - KANAL : ağızdan geriye çekilen koyu tüp; koyu kapakla biter.
  buildIntakes() {
    const { s0: S0, sm: SM, s1: S1, prot: PROT, ramp: RAMP, eps: EPS } = INTAKE;
    // Ağız bandı: DÜZ TEPELİ (kenarlarda kısa yuvarlatma) — net kenarlı dörtgen ağız.
    // Bandın dışında TAM SIFIR olduğu için halka orada kendiliğinden kapanır.
    const shp = (u) => {
      const t = (u - 0.15) / 0.66;
      if (t <= 0 || t >= 1) return 0;
      const e = 0.17;
      if (t < e) return Math.pow(Math.sin(Math.PI * 0.5 * t / e), 1.25);
      if (t > 1 - e) return Math.pow(Math.sin(Math.PI * 0.5 * (1 - t) / e), 1.25);
      return 1;
    };
    // Rampa: S0'da sıfır, SM'de (ağız) tam tümsek.
    const rampK = (s) => {
      if (s <= S0) return 0;
      if (s >= SM) return RAMP;
      const t = (s - S0) / (SM - S0);
      return RAMP * t * t * (3 - 2 * t);
    };
    // Kaporta: ağızda 1, motor hizasında hafif şişer, sonra deriye karışır.
    const cowlK = (s) => {
      if (s <= SM) return 1;
      if (s >= S1) return 0;
      if (s <= 8.60) return 1 + 0.22 * ((s - SM) / (8.60 - SM));
      const t = (S1 - s) / (S1 - 8.60);
      return 1.22 * t * t * (3 - 2 * t);
    };
    const ptAt = (side, s, u, k) => {
      const sec = sectAt(s), p = sideP(sec, u), n = sideN(sec, u);
      const off = EPS + PROT * k * shp(u);
      return { x: side * (p.x + n.x * off), y: p.y + n.y * off, z: st(s) };
    };
    const NU = 18;
    const NS = [SM, 6.55, 6.95, 7.45, 8.05, 8.60, 9.30, 10.10, 10.90, S1];
    // Rampa ve nasel deriye oturan KAPALI katılardır: kesit = [dış yay] + [taban
    // yayı]; taban deriden EPS*0,3 dışarıdadır. ESKİ HATA: rampa tek yüzlü açık bir
    // levhaydı (kenarları deriden 6 mm açıkta) ve naselin iç yayı rampayı sürdüren,
    // alta bakan bir yüzeydi. Alçak arka açılardan ışın 6 mm'lik yarıktan girip bu
    // elenen yüzlerin arkasından gökyüzüne çıkıyordu (delik testi: s = 5,98).
    const skinAt = (side, s, u) => {
      const sec = sectAt(s), p = sideP(sec, u), n = sideN(sec, u), off = EPS * 0.3;
      return { x: side * (p.x + n.x * off), y: p.y + n.y * off, z: st(s) };
    };
    const solidRing = (side, sv, k) => {
      const out = [];
      for (let i = 0; i <= NU; i++) out.push(ptAt(side, sv, i / NU, k));
      for (let i = NU; i >= 0; i--) out.push(skinAt(side, sv, i / NU));
      return out;
    };
    // İnce hilal kesitte ensureOutward'ın merkez sezgisi güvenilmez (alt ve üst yüzün
    // katkıları birbirini götürür). Sarım kesitin dönüş yönünden KESİN seçilir: satırlar
    // +z yönünde ilerlerken saat yönü tersine (arkadan bakınca) dönen halkada
    // (teğet x +z) dış normaldir.
    const solidLoft = (rows, opts) => {
      const r = rows[Math.floor(rows.length / 2)];
      let a2 = 0;
      for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length]; a2 += p.x * q.y - q.x * p.y; }
      return loft(rows, Object.assign({ closeRing: true, flip: a2 < 0 }, opts));
    };
    // Uç kapağı: dış yay ile taban yayı aynı u değerlerinde eşleşir ve kapak bu
    // eşleşmeyle ŞERİT olarak üçgenlenir (hilal kesitte merkez yelpazesi kesitin
    // dışına taşardı). Yön, toplam normal ile 'outward' karşılaştırılarak seçilir.
    const stripCap = (ring, outward) => {
      const m = NU + 1, pos = [], idx = [];
      for (const q of ring) pos.push(q.x, q.y, q.z);
      for (let i = 0; i < NU; i++) {
        const o0 = i, o1 = i + 1, b0 = 2 * m - 1 - i, b1 = 2 * m - 2 - i;
        idx.push(o0, o1, b0, o1, b1, b0);
      }
      let dn = 0;
      for (let t = 0; t < idx.length; t += 3) {
        const a = ring[idx[t]], b = ring[idx[t + 1]], c = ring[idx[t + 2]];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        dn += (uy * vz - uz * vy) * outward.x + (uz * vx - ux * vz) * outward.y + (ux * vy - uy * vx) * outward.z;
      }
      if (dn < 0) for (let t = 0; t < idx.length; t += 3) { const tmp = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = tmp; }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3 * 2), 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    };
    const fwd = new THREE.Vector3(0, 0, -1), aft = new THREE.Vector3(0, 0, 1);
    for (const side of [-1, 1]) {
      // Rampa (sıkıştırma tümseği): kapalı katı, iki ucu kapaklı
      const rampRows = [S0, S0 + 0.32, S0 + 0.68, SM - 0.22, SM].map((sv) => solidRing(side, sv, rampK(sv)));
      this.paintGeos.push(solidLoft(rampRows, { uScale: 1.2, vScale: 1 }));
      this.paintGeos.push(stripCap(rampRows[0], fwd));
      this.paintGeos.push(stripCap(rampRows[rampRows.length - 1], aft));
      // Nasel: kapalı katı. Ön yüzü (SM) açıktır ama tamamen örtülüdür: kaporta ile
      // rampa yayı arası AĞIZDIR (aşağıdaki kanal cebi kapatır), rampa yayı ile taban
      // arası rampanın arka kapağıdır. Arka ucu şerit kapakla kapanır.
      const rows = NS.map((sv) => solidRing(side, sv, cowlK(sv)));
      this.paintGeos.push(solidLoft(rows, { uScale: 1.8, vScale: 1 }));
      this.paintGeos.push(stripCap(rows[rows.length - 1], aft));
      // Kanal: ağız halkasından (kaporta yayı + rampa yayı) geriye çekilir, koyu kapakla biter
      const loop = [];
      for (let i = 0; i <= NU; i++) loop.push(ptAt(side, SM, i / NU, cowlK(SM)));
      for (let i = NU - 1; i >= 1; i--) loop.push(ptAt(side, SM, i / NU, rampK(SM)));
      const C = loop.reduce((o, q) => ({ x: o.x + q.x / loop.length, y: o.y + q.y / loop.length, z: o.z + q.z / loop.length }), { x: 0, y: 0, z: 0 });
      const nOut = sideN(sectAt(SM), 0.5);
      const DEPTH = 0.66;
      const duct = [];
      for (let j = 0; j <= 3; j++) {
        const t = j / 3, k = 1 - 0.50 * t;
        duct.push(loop.map((q) => ({
          x: C.x + (q.x - C.x) * k + side * nOut.x * 0.05 * t,
          y: C.y + (q.y - C.y) * k + nOut.y * 0.05 * t,
          z: C.z + (q.z - C.z) * k + DEPTH * t,
        })));
      }
      this.group.add(new THREE.Mesh(this.track(loft(duct, { uScale: 1, vScale: 1, closeRing: true })), this.m.duct));
      const endRing = duct[duct.length - 1];
      const ec = endRing.reduce((o, q) => ({ x: o.x + q.x / endRing.length, y: o.y + q.y / endRing.length, z: o.z + q.z / endRing.length }), { x: 0, y: 0, z: 0 });
      const cp = [ec.x, ec.y, ec.z], ci = [];
      for (const q of endRing) cp.push(q.x, q.y, q.z);
      for (let i = 0; i < endRing.length; i++) ci.push(0, i + 1, ((i + 1) % endRing.length) + 1);
      const capG = new THREE.BufferGeometry();
      capG.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
      capG.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(cp.length / 3 * 2), 2));
      capG.setIndex(ci); capG.computeVertexNormals();
      const capMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.95, side: THREE.DoubleSide }));
      this.group.add(new THREE.Mesh(this.track(capG), capMat));
    }
  }

  buildCanopy() {
    const S0 = 3.00, S1 = 7.60;
    const g = new THREE.Group();
    // Kanopi planformu: ÖNDE SİVRİ, ~%67'de en geniş, arkada sırta sıfırlanan damla.
    // (Önceki sürüm düz tepeli sinüstü ve tepeden bakınca DİKDÖRTGEN görünüyordu.)
    // Tepe noktaları pilotun üzerine (t ~ 0,45) alındı; daha arkada olduğunda kask
    // camı deliyordu ve kanopi "küvet" gibi görünüyordu.
    const wN = Math.pow(0.50, 0.55) * Math.pow(0.50, 0.55);
    const hN = Math.pow(0.45, 0.45) * Math.pow(0.55, 0.55);
    const cw = (t) => 0.66 * Math.pow(Math.max(1e-4, t), 0.55) * Math.pow(Math.max(1e-4, 1 - t), 0.55) / wN;
    const ch = (t) => 0.50 * Math.pow(Math.max(1e-4, t), 0.45) * Math.pow(Math.max(1e-4, 1 - t), 0.55) / hN;
    const rows = [];
    const N = 18;
    for (let j = 0; j <= N; j++) {
      const t = j / N, s = S0 + (S1 - S0) * t;
      const deck = bodyTop(s);
      const h = ch(t), w = cw(t);
      const ring = [];
      // Kesit: hafifçe sivriltilmiş süperelips (n = 1,8) — yarım küre değil, tepesi
      // belirgin bir kubbe; savaş uçağı kanopisinin karakteri budur.
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI * (i / 14);
        const ca = Math.cos(a), sa = Math.sin(a);
        ring.push({
          x: Math.sign(ca) * w * Math.pow(Math.abs(ca), 2 / 1.8),
          y: deck + 0.01 + h * Math.pow(Math.abs(sa), 2 / 1.8),
          z: st(s),
        });
      }
      rows.push(ring);
    }
    const canopyGeo = this.track(ensureOutward(loft(rows, { uScale: 1, vScale: 1 }), (v, o) => o.set(0, bodyTop(v.z + FA90.cgStation), v.z)));
    const canopy = new THREE.Mesh(canopyGeo, this.m.canopy);
    canopy.renderOrder = 4;
    g.add(canopy);
    this.parts.canopy = canopy;
    // Kanopi çerçevesi: yalnızca ön kemer ve arka derz — Airbus tipi direk yok,
    // tek parça dökme cam izlenimi için kenarlar ince tutuldu.
    const frameMat = this.track(new THREE.MeshStandardMaterial({ color: 0x23262a, roughness: 0.5, metalness: 0.4 }));
    for (const t of [0.225, 0.86]) {
      const s = S0 + (S1 - S0) * t;
      const h = ch(t), w = cw(t);
      const arc = [];
      for (let i = 0; i <= 14; i++) {
        const a = Math.PI * (i / 14);
        const ca = Math.cos(a), sa = Math.sin(a);
        arc.push(new THREE.Vector3(
          Math.sign(ca) * w * Math.pow(Math.abs(ca), 2 / 1.8),
          bodyTop(s) + 0.012 + h * Math.pow(Math.abs(sa), 2 / 1.8),
          st(s),
        ));
      }
      const curve = new THREE.CatmullRomCurve3(arc);
      const tube = this.track(new THREE.TubeGeometry(curve, 18, 0.028, 6, false));
      g.add(new THREE.Mesh(tube, frameMat));
    }
    // Sırt: kanopinin arkasından motor güvertesine uzanan alçak omurga
    const spine = [];
    for (let j = 0; j <= 10; j++) {
      const t = j / 10, s = S1 - 0.6 + (12.2 - (S1 - 0.6)) * t;
      const deck = bodyTop(s);
      // Alçak ve GENİŞ: dar-yüksek bir omurga tepeden bakınca boru gibi görünüyordu.
      const h = 0.115 * (1 - t) ** 0.9 + 0.012;
      const w = 0.82 * (1 - 0.28 * t);
      const ring = [];
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI * (i / 8);
        ring.push({ x: Math.cos(a) * w, y: deck + h * Math.pow(Math.sin(a), 0.85), z: st(s) });
      }
      // Halkayı güverte hattı boyunca geri kapat: yarım kemer açık kalırsa omurga
      // tek yüzeyli bir kabuk olur ve yandan bakınca altı boş görünür.
      for (let i = 7; i >= 1; i--) ring.push({ x: Math.cos(Math.PI * (i / 8)) * w, y: deck + 0.004, z: st(s) });
      spine.push(ring);
    }
    this.paintGeos.push(ensureOutward(loft(spine, { uScale: 1.5, vScale: 1, closeRing: true }), (v, o) => o.set(0, bodyTop(v.z + FA90.cgStation), v.z)));
    this.paintGeos.push(this.ringCap(spine[0], new THREE.Vector3(0, 0, -1)));
    this.paintGeos.push(this.ringCap(spine[spine.length - 1], new THREE.Vector3(0, 0, 1)));
    // Kokpit içi: koltuk, gösterge kaidesi, pilot
    const pilotParts = [];
    const inner = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.88, 0.58, 2.9)), this.m.cockpit);
    inner.position.set(0, bodyTop(4.5) - 0.34, st(4.55));
    g.add(inner);
    const seat = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.48, 0.58, 0.20)), this.m.cockpit);
    seat.position.set(0, bodyTop(4.9) + 0.02, st(5.10)); seat.rotation.x = -0.18;
    g.add(seat); pilotParts.push(seat);
    const panel = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.72, 0.30, 0.08)), this.m.glass);
    panel.position.set(0, bodyTop(3.9) + 0.04, st(3.95)); panel.rotation.x = 0.55;
    g.add(panel); pilotParts.push(panel);
    const torso = new THREE.Mesh(this.track(new THREE.CapsuleGeometry(0.17, 0.30, 4, 8)), this.m.pilot);
    torso.position.set(0, bodyTop(4.7) + 0.08, st(4.86)); torso.rotation.x = 0.2;
    g.add(torso); pilotParts.push(torso);
    const helmet = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.135, 12, 10)), this.m.helmet);
    helmet.position.set(0, bodyTop(4.6) + 0.29, st(4.70));
    g.add(helmet); pilotParts.push(helmet);
    this.parts.pilotParts = pilotParts;
    this.group.add(g);
    this.parts.cockpit = g;
  }

  // -------------------------------------------------------------------------
  // Kanat paneli: x0..x1 arasında, veter kesri cs(x)..ce(x) arasında lofted profil.
  wingPanel(side, xs, cs, ce, K) {
    const rows = xs.map((x) => {
      const le = wingLE(x), te = wingTE(x), chord = te - le, y = wingY(x);
      return airfoilPoints(K, chord, wingThick(x), cs(x), ce(x)).map((p) => ({ x: side * x, y: y + p.y, z: st(le + chord * p.c) }));
    });
    // Profil kesiti kapalı bir döngüdür (NACA kalınlığı c=1'de tam sıfırdır), bu
    // yüzden iki uç da yelpaze ile kapatılabilir. Kapatılmadığında kanat ucundan
    // ve her kontrol yüzeyinin YANINDAN gövdenin içi görünüyordu.
    const geos = [ensureOutward(loft(rows, { uScale: 2, vScale: 1 }))];
    geos.push(this.ringCap(rows[0], new THREE.Vector3(-side, 0, 0)));
    geos.push(this.ringCap(rows[rows.length - 1], new THREE.Vector3(side, 0, 0)));
    // Kesit c = ce'de kalınlığı sıfır olmadan biterse profil AÇIK bir eğridir ve
    // menteşe hattı boyunca yarık kalır. Üst ve alt uç noktalarını birleştiren
    // şerit bu kesik yüzü (yüzeyin gövdeye bakan dik duvarı) kapatır.
    const openAt = rows.map((r) => Math.hypot(r[0].y - r[r.length - 1].y, r[0].z - r[r.length - 1].z) > 1e-4);
    let run = [];
    const flushRun = () => {
      if (run.length >= 2) geos.push(ensureOutward(loft(run, { uScale: 1, vScale: 1 }), (v, o) => o.set(v.x, v.y, v.z - 1)));
      run = [];
    };
    for (let j = 0; j < rows.length; j++) {
      if (openAt[j]) run.push([rows[j][0], rows[j][rows[j].length - 1]]);
      else flushRun();
    }
    flushRun();
    return mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  }

  buildWings() {
    const zero = () => 0, one = () => 1;
    // Sabit kanat: yüzey sınırlarında bölünmüş, her biri KAPALI bağımsız paneller.
    // ESKİ YAPI HATASI (ölçüldü): tek loft, her sınırda 12 mm arayla çift istasyon.
    // Veter basamağında (menteşe kesri -> 1) aynı indisli noktalar 0,3–0,7 m kayık
    // bağlanıyor, 12 mm genişliğinde ama metrelerce uzun BURULMUŞ şerit üçgenler
    // oluşuyordu; bir kısmının sarımı ters yüze dönüyordu. Arkadan/alttan bakınca
    // x = 4,46 / 5,55 / 7,24'te bu üçgenler eleniyor, kanadın içinden gökyüzü
    // görünüyordu. Şimdi her aralık kendi kesit tipiyle (tam veter ya da menteşede
    // kesik) ayrı lofte edilir; uçlar kapaklı, menteşe yüzü şeritle kapalıdır.
    // Komşu panellerin kapakları sınır düzleminde çakışır: iç kısımları görünmez,
    // artan kısım veter basamağının GERÇEK duvarıdır.
    const cuts = [WING.rootX];
    for (const sf of SURF) cuts.push(sf.x0, sf.x1);
    cuts.push(WING.tipX);
    const stations = (a, b) => {
      const n = Math.max(1, Math.ceil((b - a) / 0.28 - 1e-6)), xs = [];
      for (let j = 0; j <= n; j++) xs.push(a + (b - a) * (j / n));
      return xs;
    };

    this.parts.surf = { flaperon: {}, elevonMid: {}, elevonOut: {} };
    for (const side of [-1, 1]) {
      for (let k = 0; k < cuts.length - 1; k++) {
        const sf = (k % 2 === 1) ? SURF[(k - 1) / 2] : null;      // tek indis = yüzey önü
        this.paintGeos.push(this.wingPanel(side, stations(cuts[k], cuts[k + 1]), zero, sf ? (x) => cfrac(sf.h, x) : one, WING_K));
      }
      for (const sf of SURF) {
        const xm = (sf.x0 + sf.x1) / 2;
        const hz = hingeZ(sf.h, xm);
        const sxs = [];
        const n = Math.max(2, Math.round((sf.x1 - sf.x0) / 0.5));
        // Yanal pay 12 mm iken menteşe hattında gökyüzü görünen yarıklar kalıyordu
        // (magenta testinde kanatta ince magenta çizgiler). 4 mm'ye indirildi.
        for (let j = 0; j <= n; j++) sxs.push(sf.x0 + 0.004 + (sf.x1 - sf.x0 - 0.008) * (j / n));
        const geo = this.wingPanel(side, sxs, (x) => cfrac(sf.h, x) - 0.004, one, 6);
        geo.translate(-side * xm, -wingY(xm), -st(hz));
        geo.computeVertexNormals();
        const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
        mesh.position.set(side * xm, wingY(xm), st(hz));
        mesh.castShadow = true;
        // Menteşe ekseni her iki kanatta +x baskın: pozitif açı = firar kenarı AŞAĞI.
        // Sol kanadın ekseni GERÇEK eksenin NEGATİFİDİR; bu yüzden y ve z bileşenleri
        // birlikte işaret değiştirir. Yalnızca z çevrilirse (eski hâli) dihedral/anhedral
        // payı aynaya uymaz ve simetrik girdide sol/sağ sapma birkaç milimetre ayrışır.
        mesh.userData.axis = new THREE.Vector3(
          sf.x1 - sf.x0,
          side * (wingY(sf.x1) - wingY(sf.x0)),
          side * (hingeZ(sf.h, sf.x1) - hingeZ(sf.h, sf.x0)),
        ).normalize();
        this.group.add(mesh);
        this.parts.surf[sf.key][side < 0 ? 'left' : 'right'] = mesh;
      }
    }
  }

  // Arka güvertedeki 45° eğik TAM HAREKETLİ iki yüzey. Yatay kuyruk yoktur;
  // bu yüzeyler yalnızca sapma denetimi ve yön kararlılığı sağlar.
  buildFins() {
    // Hücum kenarı ok açısı atan(2,75/1,80) = 57°; uç veteri kök veterinin %35'i.
    // (Önceki 39° / %66 kombinasyonu yamuk bir levha gibi görünüyordu.)
    const F = FIN;
    this.parts.fins = {};
    const y0 = upperY(F.s, F.x);
    const hRoot = F.leRoot + (F.teRoot - F.leRoot) * F.pivotFrac;
    const hTip = F.leTip + (F.teTip - F.leTip) * F.pivotFrac;
    for (const side of [-1, 1]) {
      const up = new THREE.Vector3(side * Math.sin(F.cant), Math.cos(F.cant), 0);
      const nrm = new THREE.Vector3(side * Math.cos(F.cant), -Math.sin(F.cant), 0);
      const rows = [];
      const N = 6, K = 9;
      for (let j = 0; j <= N; j++) {
        // f < 0: kök gövdenin İÇİNE gömülür, böylece dip derzi görünmez
        const f = -F.bury + (1 + F.bury) * (j / N);
        const le = F.leRoot + (F.leTip - F.leRoot) * f, te = F.teRoot + (F.teTip - F.teRoot) * f;
        const chord = te - le;
        const taper = 1 - 0.82 * Math.max(0, (f - 0.90) / 0.10);   // uçta bıçak ağzı
        const th = (F.thickRoot + (F.thickTip - F.thickRoot) * Math.max(0, f)) * taper;
        const base = new THREE.Vector3(side * F.x, y0, 0).addScaledVector(up, F.height * f);
        rows.push(airfoilPoints(K, chord, th, 0, 1).map((p) => {
          const q = base.clone().addScaledVector(nrm, p.y);
          return { x: q.x, y: q.y, z: st(le + chord * p.c) - st(hRoot) };
        }));
      }
      // KÖK DOLGUSU. Kök satırı DÜZ bir çizgiydi, oysa arka gövde firar kenarına
      // doğru alçalır. Ölçüm: s >= 17,7'de kök gövdenin ÜSTÜNDE kalıyordu, firar
      // kenarında 18,4 cm boşluk vardı (dikey yüzey ile gövde arasında gökyüzü).
      // Alt satırlar yüzeyin KENDİ düzleminde (-up yönünde) aşağı uzatılır: yüzey
      // düz kalır, yalnızca kökü gövdenin içine kadar iner. Gerekli uzama, gövde
      // yüzeyinin BURY kadar altına inecek şekilde her veter noktası için ayrı
      // hesaplanır; etki yükseldikçe sönümlenir, gövde üstündeki biçim değişmez.
      const BURY = 0.07, FBL = 0.45, fRoot = -F.bury;
      const rootY = y0 + Math.cos(F.cant) * F.height * fRoot;
      const rootAbsX = F.x + Math.sin(F.cant) * F.height * fRoot;
      const gapAt = (sw) => Math.max(0, rootY - (upperY(sw, rootAbsX) - BURY));
      for (let j = 0; j <= N; j++) {
        const f = -F.bury + (1 + F.bury) * (j / N);
        const wgt = Math.pow(Math.max(0, 1 - (f - fRoot) / (FBL - fRoot)), 2);
        if (wgt <= 0) continue;
        for (const q of rows[j]) {
          const dd = gapAt(q.z + hRoot) / Math.cos(F.cant) * wgt;   // düzlem içi uzama
          q.x -= up.x * dd; q.y -= up.y * dd;
        }
      }
      // KÖK SALMASI. Yüzey tam hareketli ve 45° eğik; menteşe ekseni oklu olduğu için
      // sapmada kök kirişi yüzey düzlemine DİK hareket eder ve bunun yarısı DÜŞEYDİR.
      // Ölçüm: dinlenmede kök yalnızca 3,6 cm gömülüydü; 5° sapmada kök gövdeden
      // 1,9 cm, tam sapmada (22°) 34 cm KALKIYOR, yüzey ile arka gövde arasında
      // gökyüzü görünüyordu. Kök satırının altına, yüzeyin KENDİ düzleminde 0,65 m'lik
      // bir salma eklenir: tamamen gövdenin içinde kalır (görünen biçim değişmez) ve
      // en büyük sapmada (FIN.travel) bile kök gövdeden çıkmaz ne de altından taşar.
      const keel = [0.65, 0.35].map((e) => rows[0].map((q) => ({ x: q.x - up.x * e, y: q.y - up.y * e, z: q.z })));
      rows.unshift(...keel);
      const upv = new THREE.Vector3().copy(up);
      const geo = mergeGeometries([
        ensureOutward(loft(rows, { uScale: 1.6, vScale: 1 })),
        this.ringCap(rows[0], upv.clone().negate()),
        this.ringCap(rows[rows.length - 1], upv.clone()),
      ].map((g) => (g.index ? g.toNonIndexed() : g)), false);
      geo.translate(-side * F.x, -y0, 0);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
      mesh.position.set(side * F.x, y0, st(hRoot));
      mesh.castShadow = true;
      mesh.userData.axis = new THREE.Vector3().copy(up).multiplyScalar(F.height)
        .add(new THREE.Vector3(0, 0, st(hTip) - st(hRoot))).normalize();
      // Kök halkası (yerel): sapmada kökün gövde içinde kaldığını doğrulamak için
      mesh.userData.rootRing = rows[0].map((q) => new THREE.Vector3(q.x - side * F.x, q.y - y0, q.z));
      this.group.add(mesh);
      this.parts.fins[side < 0 ? 'left' : 'right'] = mesh;
    }
  }

  // Sırt hava frenleri: güverte derisini izleyen iki ince kanat, ön kenardan menteşeli.
  buildAirbrake() {
    const S0 = 12.40, S1 = 14.60, X0 = 0.55, X1 = 1.95;
    const hy = upperY(S0, (X0 + X1) / 2) + 0.024;
    this.parts.brakes = {};
    for (const side of [-1, 1]) {
      const rows = [];
      const Ns = 5, Nx = 5;
      for (let j = 0; j <= Ns; j++) {
        const s = S0 + (S1 - S0) * (j / Ns);
        const ring = [];
        for (let i = 0; i <= Nx; i++) { const x = X0 + (X1 - X0) * (i / Nx); ring.push({ x: side * x, y: upperY(s, x) + 0.040, z: st(s) }); }
        for (let i = Nx; i >= 0; i--) { const x = X0 + (X1 - X0) * (i / Nx); ring.push({ x: side * x, y: upperY(s, x) + 0.008, z: st(s) }); }
        rows.push(ring);
      }
      const geo = mergeGeometries([
        ensureOutward(loft(rows, { uScale: 1.4, vScale: 1, closeRing: true }),
          (v, o) => o.set(v.x, upperY(v.z + FA90.cgStation, v.x) + 0.024, v.z)),
        this.ringCap(rows[0], new THREE.Vector3(0, 0, -1)),
        this.ringCap(rows[rows.length - 1], new THREE.Vector3(0, 0, 1)),
      ].map((g) => (g.index ? g.toNonIndexed() : g)), false);
      geo.translate(0, -hy, -st(S0));
      geo.computeVertexNormals();
      const pivot = new THREE.Group();
      pivot.position.set(0, hy, st(S0));
      const mesh = new THREE.Mesh(this.track(geo), this.m.paint);
      mesh.castShadow = true;
      pivot.add(mesh);
      this.group.add(pivot);
      this.parts.brakes[side < 0 ? 'left' : 'right'] = pivot;
    }
  }

  // İki adet gömülü 2B dikdörtgen lüle. Testere dişli çıkış, koyu iç kanal,
  // ısınan yaprak iç yüzeyi ve üç katmanlı art yakıcı alevi.
  buildNozzles() {
    const NZ = { x: ENG.x, y: ENG.y, w: ENG.w, h: ENG.h, s0: 17.90, s1: 19.58, tooth: 0.19 };
    // Yuvarlatılmış dikdörtgen (süperelips) halka
    const rr = rrect;
    const NRING = ENG.n, POW = ENG.pow;
    // Kanal İKİ YÜZLÜ olmalı: BackSide iken uzak duvarın görünüp görünmemesi loft
    // sarım yönüne bağlıydı ve arkadan/alttan bakınca lülenin içinden GÖKYÜZÜ
    // görünüyordu (magenta arka plan testinde iki lüle de tamamen şeffaf çıktı).
    // DoubleSide bu bağımlılığı tümden kaldırır.
    const innerMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1e2024, roughness: 0.78, metalness: 0.65, side: THREE.DoubleSide }));
    innerMat.emissive = new THREE.Color(0xff4a10);
    innerMat.emissiveIntensity = 0;
    this.matNozzleInner = innerMat;
    this.matGlow = this.track(new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    const petalMat = this.track(this.m.metal.clone());
    petalMat.side = THREE.DoubleSide;
    // Türbin yüzü içeriden görülür: tek malzeme, iki lüle paylaşır (ek çizim yok)
    const darkBothMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0a0b0d, roughness: 0.95, metalness: 0.3, side: THREE.DoubleSide }));

    // Alev malzemeleri iki lüle tarafından PAYLAŞILIR (tek uniform seti, tek çizim maliyeti)
    const noiseTex = this.track(makeFlameNoiseTexture(128));
    const mkFlameMat = (params) => this.track(new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 }, intensity: { value: 0 }, noiseTex: { value: noiseTex },
        colorA: { value: new THREE.Color(params.colorA) }, colorB: { value: new THREE.Color(params.colorB) },
        edge: { value: params.edge }, speed: { value: params.speed }, diamonds: { value: params.diamonds }, alphaMul: { value: params.alpha },
      },
      vertexShader: `
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          vUv = uv;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: `
        uniform float time; uniform float intensity; uniform sampler2D noiseTex; uniform vec3 colorA; uniform vec3 colorB;
        uniform float edge; uniform float speed; uniform float diamonds; uniform float alphaMul;
        varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main() {
          float z = vUv.y;
          float ax = exp(-z * 2.2) * pow(max(0.0, 1.0 - z), 0.45);
          float n1 = texture2D(noiseTex, vec2(vUv.x * 2.0 + time * 0.25, z * 2.5 - time * speed)).r;
          float n2 = texture2D(noiseTex, vec2(vUv.x * 3.0 - time * 0.4, z * 5.0 - time * speed * 1.7)).r;
          float turb = 0.55 + 0.6 * n1 + 0.3 * (n2 - 0.5);
          float sh = 0.55 + 0.45 * cos(z * (13.0 + 7.0 * intensity) - time * 9.0);
          sh = mix(1.0, sh, diamonds * exp(-z * 2.2));
          float fres = pow(abs(dot(normalize(vN), normalize(vV))), edge);
          float b = ax * turb * sh * intensity;
          vec3 col = mix(colorA, colorB, clamp(z * 1.4 + (n1 - 0.5) * 0.5, 0.0, 1.0));
          gl_FragColor = vec4(col * b * 1.15, clamp(b * fres * alphaMul, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    const fmCore = mkFlameMat({ colorA: 0xdff0ff, colorB: 0x6aa0ff, edge: 0.6, speed: 6.0, diamonds: 1.0, alpha: 0.85 });
    const fmMid = mkFlameMat({ colorA: 0xff9a48, colorB: 0xff4a14, edge: 1.1, speed: 4.5, diamonds: 0.7, alpha: 0.50 });
    const fmHaze = mkFlameMat({ colorA: 0xb8c8e0, colorB: 0x9ab0d0, edge: 1.8, speed: 2.2, diamonds: 0.0, alpha: 0.10 });
    this.flameMats = [fmCore, fmMid, fmHaze];
    // 2B lülede alev dikdörtgen kesitlidir: yassı bir tüp kullanılır.
    const flatTube = (w, h, wEnd, hEnd, len) => {
      const g = new THREE.CylinderGeometry(1, 1, len, 20, 12, true);
      g.rotateX(Math.PI / 2);
      g.translate(0, 0, len / 2);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const t = p.getZ(i) / len;
        p.setX(i, p.getX(i) * (w + (wEnd - w) * t));
        p.setY(i, p.getY(i) * (h + (hEnd - h) * t));
      }
      g.computeVertexNormals();
      return g;
    };
    this.parts.flame = new THREE.Group();
    this.flameGroups = [];
    this.nozzlePetals = [];
    this.group.add(this.parts.flame);

    for (const side of [-1, 1]) {
      const cx = side * NZ.x;
      // ---- MOTOR GÖVDESİ ------------------------------------------------
      // ESKİ YAPI HATASI: kaporta profili g = sin(pi*t)^0.6 ile İKİ UÇTA da
      // 0,55'e kısılıyordu. Çıkışta kaporta iç kanaldan DAHA DAR kalıyor, lüle
      // gövdeden ayrık çıplak bir boru gibi görünüyordu; önde de deriye karışmadığı
      // için arada açıklık kalıyordu. Üstelik boru iki uçta da KAPAKSIZDI (loft
      // yalnızca halkalar arasını örer), bu yüzden arkadan bakınca gövdenin içi
      // ve gökyüzü görünüyordu.
      //
      // YENİ YAPI üç parçadır ve SINIR HALKALARI BİREBİR ORTAKTIR, birleşim
      // su geçirmezdir:
      //   1) dış nasel kabuğu (boya)        — arka perdeden çıkar, çıkışta boat-tail
      //   2) lüle çıkışı (metal + koyu)     — art yakıcıda açılan hareketli parça
      //   3) iç kanal + türbin yüzü (koyu)  — 2,4 m derinlik, çift yüzlü
      const OW = ENG.ow, OH = ENG.oh;
      const ringAt = (sv, w, h) => rr(cx, NZ.y, w, h, NRING, POW).map((q) => ({ x: q.x, y: q.y, z: st(sv) }));
      const nacRef = (v, o) => o.set(cx, NZ.y, v.z);
      // 1) Nasel kabuğu: motor bölmesinin arka perdesinden (AFT.s1) başlar; perdedeki
      //    delik TAM OLARAK bu kabuğun ilk halkasıdır. (Önceki sürümde kabuk
      //    s = 14,9'dan başlıyordu ama 19,1'in önü tamamen gövde içinde kalıyordu.)
      const shell = NAC.map(([sv, k]) => ringAt(sv, OW * k, OH * k));
      this.paintGeos.push(ensureOutward(loft(shell, { uScale: 1.4, vScale: 1, closeRing: true }), nacRef));
      // İç kanal halkaları [istasyon, ölçek] (3. adımda kullanılır; 2. adımın son
      // halkası bunun ilk halkasıdır).
      const DS = [[19.30, 0.93], [18.80, 0.90], [18.20, 0.97], [17.60, 1.04], [17.24, 1.06]];
      // 2) LÜLE ÇIKIŞI = dudak bandı (metal: dış halka -> testere dişi -> dudak) +
      //    ıraksak bölüm (koyu: dudak -> 19,47 -> 19,30). TEK mesh, iki malzeme grubu,
      //    DÜNYA koordinatında. Dış halka nasel kabuğunun son halkasıyla, son halka
      //    kanalın ilk halkasıyla BİREBİR aynı noktalardır.
      //    ESKİ HATA (ölçüldü): bant, merkezine göre (open, open, 1) ile ölçekleniyordu.
      //    Askeri güç ve art yakıcıda dış halka kabuktan, iç halka kanaldan ayrılıyor,
      //    açılan iki halka biçimli yarıktan gövdenin BOŞ içi görünüyordu (tam gazda
      //    arka görünümlerde 7 500+ delik pikseli; ışınlar burnun iç yüzüne kadar
      //    gidiyordu). Şimdi alan açılması bir BİÇİM HEDEFİDİR (morph target): dış
      //    halka ve 19,30 halkası sabit kalır, yalnızca dişler, dudak ve ıraksak
      //    bölüm açılır — parça hiçbir açıklıkta komşularından ayrılmaz.
      const [sE, kE] = NAC[NAC.length - 1];
      const exitGeo = (open) => {
        const pOut = ringAt(sE, OW * kE, OH * kE);
        const pIn = ringAt(19.64, NZ.w * open, NZ.h * open);
        const pTip = pOut.map((q, i) => {
          const r = pIn[i], k = (i % 2 === 0) ? NZ.tooth : NZ.tooth * 0.42;
          return { x: q.x + (r.x - q.x) * 0.5, y: q.y + (r.y - q.y) * 0.5, z: st(19.63) + k };
        });
        const kd = 0.965 * (1 + (open - 1) * 0.5);
        const div = [pIn, ringAt(19.47, NZ.w * kd, NZ.h * kd), ringAt(DS[0][0], NZ.w * DS[0][1], NZ.h * DS[0][1])];
        return mergeGeometries([
          ensureOutward(loft([pOut, pTip, pIn], { uScale: 1, vScale: 1, closeRing: true }), nacRef),
          loft(div, { uScale: 1, vScale: 1, closeRing: true }),
        ], true);
      };
      const exitG = exitGeo(1), openG = exitGeo(NOZ_OPEN_MAX);
      openG.setIndex(exitG.index.clone());          // aynı üçgenler, aynı sarım
      openG.computeVertexNormals();
      exitG.morphAttributes.position = [openG.attributes.position];
      exitG.morphAttributes.normal = [openG.attributes.normal];
      const petals = new THREE.Mesh(this.track(exitG), [petalMat, innerMat]);
      petals.castShadow = true;
      this.group.add(petals);
      this.nozzlePetals.push(petals);
      // 3) İç kanal: 19,30'dan 2 m İLERİ çekilir. Derinlik şart — içeri bakıldığında
      //    dünya ya da eksik poligon değil KARANLIK görünmeli.
      this.group.add(new THREE.Mesh(
        this.track(loft(DS.map(([sv, k]) => ringAt(sv, NZ.w * k, NZ.h * k)), { uScale: 1, vScale: 1, closeRing: true })),
        innerMat));
      // Türbin / alev tutucu yüzü: düz disk değil, içe ve öne giden konik yüzey,
      // böylece kanalın dibi "dipsiz" görünmez.
      const turbRows = [
        ringAt(17.24, NZ.w * 1.06, NZ.h * 1.06),
        ringAt(17.20, NZ.w * 0.62, NZ.h * 0.62),
        ringAt(16.96, NZ.w * 0.30, NZ.h * 0.30),
        ringAt(16.86, NZ.w * 0.10, NZ.h * 0.10),
      ];
      this.group.add(new THREE.Mesh(this.track(mergeGeometries([
        loft(turbRows, { uScale: 1, vScale: 1, closeRing: true }),
        // Koninin TEPESİ de kapatılır, yoksa ortada iğne deliği kadar bir açıklık
        // kalır ve tünel "dipsiz" görünür.
        this.ringCap(turbRows[turbRows.length - 1], new THREE.Vector3(0, 0, -1)),
      ].map((g) => (g.index ? g.toNonIndexed() : g)), false)), darkBothMat));
      // Merkez gövde (plug): kanalın dibinde durur, tünele derinlik ve ölçek verir
      const plug = new THREE.Mesh(this.track(loft([
        ringAt(17.10, NZ.w * 0.34, NZ.h * 0.34),
        ringAt(18.30, NZ.w * 0.30, NZ.h * 0.30),
        ringAt(19.05, NZ.w * 0.16, NZ.h * 0.16),
        ringAt(19.22, NZ.w * 0.03, NZ.h * 0.03),
      ], { uScale: 1, vScale: 1, closeRing: true })), darkBothMat);
      this.group.add(plug);
      // Parıltı kanalın İÇİNE konur: art yakıcıda derinlikten gelen kızıl ışık
      const glow = new THREE.CircleGeometry(NZ.w * 0.86, 18);
      glow.scale(1, NZ.h / NZ.w, 1);
      glow.translate(cx, NZ.y, st(18.55));
      this.group.add(new THREE.Mesh(this.track(glow), this.matGlow));
      // Alev
      const fg = new THREE.Group();
      fg.position.set(cx, NZ.y, st(NZ.s1 + NZ.tooth - 0.03));
      const core = new THREE.Mesh(this.track(flatTube(NZ.w * 0.52, NZ.h * 0.60, 0.05, 0.05, 1)), fmCore);
      const mid = new THREE.Mesh(this.track(flatTube(NZ.w * 0.86, NZ.h * 0.95, 0.12, 0.12, 1)), fmMid);
      const haze = new THREE.Mesh(this.track(flatTube(NZ.w * 1.20, NZ.h * 1.40, 0.28, 0.28, 1)), fmHaze);
      core.renderOrder = 8; mid.renderOrder = 7; haze.renderOrder = 6;
      fg.add(haze, mid, core);
      fg.userData.haze = haze;
      this.parts.flame.add(fg);
      this.flameGroups.push(fg);
    }
    this.parts.flame.visible = false;
    this.abFlash = 0;
  }

  buildGear() {
    const wheelBottom = FA90.wheelBottomY;
    this.parts.gear = {};
    const strutMat = this.m.metalSmooth;
    const oleoMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8dadc, roughness: 0.2, metalness: 0.9 }));
    const mkWheel = (r, w) => {
      const g = new THREE.Group();
      const tire = new THREE.CylinderGeometry(r, r, w, 18); tire.rotateZ(Math.PI / 2);
      const rim = new THREE.CylinderGeometry(r * 0.56, r * 0.56, w + 0.02, 12); rim.rotateZ(Math.PI / 2);
      const hub = new THREE.CylinderGeometry(r * 0.2, r * 0.2, w + 0.06, 8); hub.rotateZ(Math.PI / 2);
      g.add(new THREE.Mesh(this.track(tire), this.m.tire));
      g.add(new THREE.Mesh(this.track(rim), this.m.metalSmooth));
      g.add(new THREE.Mesh(this.track(hub), this.m.dark));
      return g;
    };
    // Burun takımı: öne katlanır
    {
      const pivot = new THREE.Group();
      const s = FA90.cgStation + FA90.noseGearZ;
      const topY = lowerY(s, 0) + 0.05;
      pivot.position.set(0, topY, FA90.noseGearZ);
      const r = 0.31;
      const strutLen = topY - (wheelBottom + r);
      const strut = new THREE.CylinderGeometry(0.075, 0.088, strutLen * 0.58, 10); strut.translate(0, -strutLen * 0.29, 0);
      pivot.add(new THREE.Mesh(this.track(strut), strutMat));
      const oleo = new THREE.CylinderGeometry(0.055, 0.055, strutLen * 0.52, 10); oleo.translate(0, -strutLen * 0.74, 0);
      pivot.add(new THREE.Mesh(this.track(oleo), oleoMat));
      const fork = new THREE.BoxGeometry(0.28, 0.34, 0.11); fork.translate(0, -strutLen + 0.11, 0);
      pivot.add(new THREE.Mesh(this.track(fork), strutMat));
      const drag = new THREE.CylinderGeometry(0.032, 0.032, strutLen * 0.72, 6); drag.rotateX(0.48); drag.translate(0, -strutLen * 0.40, 0.27);
      pivot.add(new THREE.Mesh(this.track(drag), strutMat));
      const wheel = mkWheel(r, 0.22); wheel.position.set(0, -strutLen, 0);
      pivot.add(wheel);
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      const doors = [];
      for (const side of [-1, 1]) {
        const dp = new THREE.Group();
        dp.position.set(side * 0.36, lowerY(s, 0.36) + 0.02, FA90.noseGearZ + 0.25);
        const door = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.035, 0.52, 1.95)), this.m.paint);
        door.position.set(0, -0.26, 0);
        dp.add(door);
        this.group.add(dp);
        doors.push({ pivot: dp, sign: side });
      }
      this.parts.gear.nose = { pivot, wheel, retractAxis: 'x', retractSign: -1, doors, radius: r };
    }
    // Ana takımlar: içe katlanır
    for (const side of [-1, 1]) {
      const pivot = new THREE.Group();
      const s = FA90.cgStation + FA90.mainGearZ;
      const topY = lowerY(s, FA90.mainGearX) + 0.06;
      pivot.position.set(side * FA90.mainGearX, topY, FA90.mainGearZ);
      const r = 0.42;
      const strutLen = topY - (wheelBottom + r);
      const strut = new THREE.CylinderGeometry(0.10, 0.115, strutLen * 0.60, 10); strut.translate(0, -strutLen * 0.30, 0);
      pivot.add(new THREE.Mesh(this.track(strut), strutMat));
      const oleo = new THREE.CylinderGeometry(0.07, 0.07, strutLen * 0.52, 10); oleo.translate(0, -strutLen * 0.74, 0);
      pivot.add(new THREE.Mesh(this.track(oleo), oleoMat));
      const brace = new THREE.CylinderGeometry(0.045, 0.045, strutLen * 0.86, 6); brace.rotateZ(side * 0.52); brace.translate(side * -0.24, -strutLen * 0.42, 0.07);
      pivot.add(new THREE.Mesh(this.track(brace), strutMat));
      const wheel = mkWheel(r, 0.34); wheel.position.set(side * 0.14, -strutLen, 0);
      pivot.add(wheel);
      pivot.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.group.add(pivot);
      const dp = new THREE.Group();
      dp.position.set(side * (FA90.mainGearX - 0.55), lowerY(s, FA90.mainGearX - 0.55) + 0.02, FA90.mainGearZ);
      const door = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.035, 0.66, 1.80)), this.m.paint);
      door.position.set(0, -0.33, 0);
      dp.add(door);
      this.group.add(dp);
      this.parts.gear[side < 0 ? 'left' : 'right'] = { pivot, wheel, retractAxis: 'z', retractSign: side, doors: [{ pivot: dp, sign: -side }], radius: r };
    }
  }

  buildDetails() {
    const m = this.m;
    // Karın derisini izleyen ince kabuk (kapaklar, yuva ağızları)
    // Karın kabuğu (kapak / yuva ağzı): TEK YÜZEYLİ levha değil, ince KAPALI plaka.
    // Tek yüzey deriden birkaç milimetre dışarıda duruyor ve ışın paritesini bozuyordu
    // (ışın gövdeden çıktıktan sonra bir kez daha levhayı kesiyordu) — denetimde
    // 53 sızdıran ışının kaynağı buydu. Artık dış ve iç yüzü olan kapalı bir dilim.
    const bellyShell = (x0, x1, s0, s1, nx, ns, off) => {
      const rows = [];
      for (let j = 0; j <= ns; j++) {
        const sv = s0 + (s1 - s0) * (j / ns);
        const ring = [];
        for (let i = 0; i <= nx; i++) { const x = x0 + (x1 - x0) * (i / nx); ring.push({ x, y: lowerY(sv, x) - off, z: st(sv) }); }
        for (let i = nx; i >= 0; i--) { const x = x0 + (x1 - x0) * (i / nx); ring.push({ x, y: lowerY(sv, x) - off * 0.25, z: st(sv) }); }
        rows.push(ring);
      }
      const g = ensureOutward(loft(rows, { uScale: 1, vScale: 1, closeRing: true }),
        (v, o) => o.set(v.x, lowerY(v.z + FA90.cgStation, v.x) - off * 0.62, v.z));
      return mergeGeometries([g, this.ringCap(rows[0], new THREE.Vector3(0, 0, -1)),
        this.ringCap(rows[rows.length - 1], new THREE.Vector3(0, 0, 1))].map((q) => (q.index ? q.toNonIndexed() : q)), false);
    };
    // Burun altı çok yüzlü elektro-optik pencere
    const eo = new THREE.ConeGeometry(0.24, 0.30, 7, 1, false);
    eo.rotateX(Math.PI);
    eo.translate(0, bodyBottom(2.55) - 0.05, st(2.55));
    this.group.add(new THREE.Mesh(this.track(eo), m.glass));
    // Yanlara bakan iki gömülü sensör penceresi
    for (const side of [-1, 1]) {
      const w = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.62, 0.20)), m.glass);
      w.position.set(side * (bodyChineX(3.6) * 0.86), bodyChineY(3.6) - 0.16, st(3.6));
      w.rotation.y = side * Math.PI / 2;
      w.rotation.z = -0.12;
      this.group.add(w);
    }
    // Silah yuvası kapakları (iç + dış), etrafında koyu derz
    const gapMat = this.track(new THREE.MeshStandardMaterial({ color: 0x0f1113, roughness: 0.95 }));
    const gapGeos = [];
    for (const side of [-1, 1]) {
      // Silah yuvası kapakları ana takım yuvasının İÇİNDE kalır (takım x = ±2,05,
      // yuva ±1,55…±2,35). Daha geniş kapaklar iki boşluğu üst üste bindiriyordu.
      for (const [x0, x1] of [[0.16, 0.74], [0.84, 1.42]]) {
        this.paintGeos.push(bellyShell(side * x0, side * x1, 8.10, 13.40, 4, 10, 0.016));
        gapGeos.push(bellyShell(side * (x0 - 0.035), side * (x1 + 0.035), 8.05, 13.45, 4, 10, 0.006));
      }
    }
    // İniş takımı yuva ağızları
    gapGeos.push(bellyShell(-0.36, 0.36, 3.85, 5.55, 3, 5, 0.005));
    for (const side of [-1, 1]) gapGeos.push(bellyShell(side * 1.55, side * 2.35, 10.30, 12.40, 3, 6, 0.005));
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(gapGeos.map((g) => (g.index ? g.toNonIndexed() : g)), false)), gapMat));
    // Yakıt ikmal kapağı (sırt)
    const rec = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.55, 0.40)), this.track(new THREE.MeshStandardMaterial({ color: 0x5c6167, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -1 })));
    rec.position.set(0, bodyTop(11.2) + 0.012, st(11.2));
    rec.rotation.x = -Math.PI / 2;
    this.group.add(rec);
    // Formasyon ışık şeritleri: çine hattı boyunca (uçağın imza kenarı). Şerit çine
    // dudağının altında, gövdeden hafif açıkta duran ince bir ışık panelidir; tek
    // yüzlüyken önden-alttan bakınca arkası eleniyor, şerit kayboluyordu. FA-90'a
    // özel çift yüzlü kopya kullanılır (paylaşılan malzeme değişmez).
    const formLight2 = this.track(m.formLight.clone());
    formLight2.side = THREE.DoubleSide;
    for (const side of [-1, 1]) {
      for (const [s, len] of [[6.0, 1.6], [12.8, 2.2]]) {
        const fl = new THREE.Mesh(this.track(new THREE.PlaneGeometry(len, 0.075)), formLight2);
        fl.position.set(side * (bodyChineX(s) + 0.015), bodyChineY(s) - 0.05, st(s));
        fl.rotation.y = side * Math.PI / 2;
        this.group.add(fl);
      }
      const fd = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.07, 0.85)), m.formLight);
      fd.position.set(side * 0.55, bodyTop(8.4) + 0.012, st(8.4));
      fd.rotation.x = -Math.PI / 2;
      this.group.add(fd);
    }
    // Hava verisi: gömülü (flush) basınç portları — düşük gözlenebilirlik için
    // çıkıntılı pitot borusu YOKTUR. Burun yanlarında iki küçük koyu plaka, yan dalın
    // köşesinde (u = 1/3) deriye oturur. (Eskiden dikey düz levhaydı; içe eğimli yan
    // yüzeyden açıkta kalıyor, önden-alttan tek yüzlü arkası görünüyordu.)
    const portMat = this.track(new THREE.MeshStandardMaterial({ color: 0x24282c, roughness: 0.6, metalness: 0.5, polygonOffset: true, polygonOffsetFactor: -1 }));
    for (const side of [-1, 1]) {
      for (const sv of [1.45, 2.05]) {
        const pts = halfSection(sectAt(sv));
        const du1 = 0.05 / (3 * Math.hypot(pts[6].x - pts[5].x, pts[6].y - pts[5].y));
        const du2 = 0.05 / (3 * Math.hypot(pts[7].x - pts[6].x, pts[7].y - pts[6].y));
        const us = [1 / 3 - du1, 1 / 3, 1 / 3 + du2];
        const n0 = sideN(sectAt(sv), 1 / 3);
        const g = this.decalGrid(4, 2, (i, j) => {
          const sw = sv - 0.11 + 0.22 * (i / 4), u = us[j];
          const p = skinSide(sw, u), n = sideN(sectAt(sw), u);
          return { x: side * (p.x + n.x * 0.004), y: p.y + n.y * 0.004, z: st(sw), u: i / 4, v: 1 - j / 2 };
        }, new THREE.Vector3(side * n0.x, n0.y, 0));
        this.group.add(this.decalMesh(g, portMat));
      }
    }
    const ant = new THREE.BoxGeometry(0.035, 0.16, 0.42); ant.translate(0.42, bodyBottom(7.6) - 0.08, st(7.6));
    this.paintGeos.push(ant);
    const ant2 = new THREE.BoxGeometry(0.035, 0.16, 0.42); ant2.translate(-0.42, bodyBottom(14.2) - 0.08, st(14.2));
    this.paintGeos.push(ant2);
    this.buildMarkings();
  }

  // Yüzeyi izleyen çıkartma ızgarası. at(i, j) -> { x, y, z, u, v } (ebeveyn
  // koordinatında). Sarım, toplam normal 'outward' yönüne bakacak şekilde seçilir.
  decalGrid(ni, nj, at, outward) {
    const P = [], UV = [], I = [];
    for (let j = 0; j <= nj; j++) for (let i = 0; i <= ni; i++) { const q = at(i, j); P.push(q.x, q.y, q.z); UV.push(q.u, q.v); }
    for (let j = 0; j < nj; j++) for (let i = 0; i < ni; i++) {
      const a = j * (ni + 1) + i, b = a + 1, c = a + ni + 1, d = c + 1;
      I.push(a, b, d, a, d, c);
    }
    let dn = 0;
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    for (let t = 0; t < I.length; t += 3) {
      va.fromArray(P, I[t] * 3); vb.fromArray(P, I[t + 1] * 3); vc.fromArray(P, I[t + 2] * 3);
      dn += vb.sub(va).cross(vc.sub(va)).dot(outward);
    }
    if (dn < 0) for (let t = 0; t < I.length; t += 3) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(I);
    g.computeVertexNormals();
    return this.track(g);
  }

  // Çıkartma meshi: yapısal yüzey değil, boya katmanıdır (userData.decal).
  decalMesh(g, material) {
    const mesh = new THREE.Mesh(g, material);
    mesh.userData.decal = true;
    return mesh;
  }

  // İŞARETLER yüzeyi izleyen ızgaralardır (yüzeyden birkaç mm dışarıda).
  // ESKİ HATA: hepsi düz levhaydı. Kanat profili ve gövde yanı eğri olduğu için
  // levha bir uçta yüzeye GÖMÜLÜYOR, diğer uçta havada kalıyordu (kanat yıldızı kök
  // tarafında 8 cm kanadın içinde, uç tarafında 12 cm havada; gövde yanı yıldızının
  // üst 18 cm'si kanadın İÇİNDE, alt kenarı içe eğimli yan yüzeyden 20 cm açıkta).
  // Alçak/arka açılardan levhanın arkası görünüyor ve tek yüzlü olduğu için
  // eleniyordu. Kuyruk işaretleri de this.group'taydı: tam hareketli yüzey
  // döndüğünde yerinde kalıp havada asılı görünüyordu — artık yüzeyin çocuğudur.
  buildMarkings() {
    const L = this.livery || {};
    const insig = this.track(makeMilInsigniaTexture(L.insignia || 'starbar', 256));
    const mat = this.track(new THREE.MeshStandardMaterial({ map: insig, transparent: true, roughness: 0.7, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 }));
    const OFF = 0.005;
    // Kanat: sol üst ve sağ alt yüzey, x = 4,9, veterin %40'ı merkez. Yükseklik analitik
    // NACA eğrisinden değil, panelin KENDİ örnek çokgeninden (WING_K nokta, menteşe
    // kesrine kadar) alınır: hücum kenarı yakınında çokgen eğrinin 1–2 cm altındadır.
    {
      const H = 1.35, W = L.insigniaSquare ? H : H * 1.9, xc = 4.9;
      const sMid = wingLE(xc) + (wingTE(xc) - wingLE(xc)) * 0.40;
      const panelCe = (ax) => { for (const sf of SURF) if (ax > sf.x0 && ax < sf.x1) return cfrac(sf.h, ax); return 1; };
      const facetHalf = (ax, c) => {
        const le = wingLE(ax), chord = wingTE(ax) - le, th = wingThick(ax), ce = panelCe(ax);
        const f = Math.min(WING_K, Math.max(0, (1 - Math.min(c, ce) / ce) * WING_K));
        const i = Math.min(WING_K - 1, Math.floor(f)), w = f - i;
        return halfThick(ce * (1 - i / WING_K), th, chord) * (1 - w) + halfThick(ce * (1 - (i + 1) / WING_K), th, chord) * w;
      };
      for (const [side, up] of [[-1, 1], [1, -1]]) {
        const g = this.decalGrid(12, 8, (i, j) => {
          const u = i / 12, v = j / 8;
          const ax = xc - (u - 0.5) * W, sv = sMid - (v - 0.5) * H;     // u: içe, v: ileri
          const le = wingLE(ax), chord = wingTE(ax) - le;
          const c = Math.min(1, Math.max(0, (sv - le) / chord));
          return { x: side * ax, y: wingY(ax) + up * (facetHalf(ax, c) + OFF), z: st(sv), u, v };
        }, new THREE.Vector3(0, up, 0));
        this.group.add(this.decalMesh(g, mat));
      }
    }
    // Gövde yanı: kanadın ALTINDA kalan yan yüzey. Merkez s = 12,5 (nasel kuyruğu
    // 11,9'da biter, eski merkez 12,0 kuyruğa biniyordu). Üst kenar, kanat alt
    // yüzeyinin 5 cm altından başlar; yükseklik yüzey boyunca yay uzunluğudur.
    {
      const sC = 12.50, Wd = L.insigniaSquare ? 0.58 : 1.08, Hd = 0.58, OFFS = 0.005;
      const s0 = sC - Wd / 2, s1 = sC + Wd / 2;
      const skin = skinSide;
      const wingLow = (x, sv) => {
        const ax = Math.abs(x), le = wingLE(ax), chord = wingTE(ax) - le;
        const c = Math.min(1, Math.max(0, (sv - le) / chord));
        return wingY(ax) - halfThick(c, wingThick(ax), chord);
      };
      let uTop = 0;
      for (let u = 0; u <= 0.6; u += 0.0025) {
        let ok = true;
        for (let k = 0; k <= 8 && ok; k++) { const sv = s0 + (s1 - s0) * k / 8, p = skin(sv, u); ok = p.y < wingLow(p.x, sv) - 0.05; }
        if (ok) { uTop = u; break; }
      }
      const secC = sectAt(sC), arc = [0];
      for (let k = 1; k <= 400; k++) { const a = sideP(secC, (k - 1) / 400), b = sideP(secC, k / 400); arc.push(arc[k - 1] + Math.hypot(b.x - a.x, b.y - a.y)); }
      const arcAt = (u) => { const t = Math.min(400, Math.max(0, u * 400)), k = Math.min(399, Math.floor(t)); return arc[k] + (arc[k + 1] - arc[k]) * (t - k); };
      const aTop = arcAt(uTop);
      let uBot = uTop;
      while (uBot < 1 && arcAt(uBot) - aTop < Hd) uBot += 0.0005;
      // Satırlar sabit u'dadır; yan dalın köşeleri (u = 1/3, 2/3) satır olarak eklenir,
      // böylece çıkartma üçgeni köşeyi kesip yüzeyin altına inmez.
      const us = [];
      for (let k = 0; k <= 16; k++) us.push(uTop + (uBot - uTop) * k / 16);
      for (const uk of [1 / 3, 2 / 3]) if (uk > uTop && uk < uBot) us.push(uk);
      us.sort((a, b) => a - b);
      for (const side of [-1, 1]) {
        const g = this.decalGrid(10, us.length - 1, (i, j) => {
          const sv = s0 + (s1 - s0) * (i / 10), u = us[j];
          const p = skin(sv, u), n = sideN(sectAt(sv), u);
          return {
            x: side * (p.x + n.x * OFFS), y: p.y + n.y * OFFS, z: st(sv),
            u: side > 0 ? 1 - i / 10 : i / 10,                 // sağda doku ileri, solda geri okunur
            v: 1 - (arcAt(u) - aTop) / Hd,
          };
        }, new THREE.Vector3(side, 0, 0));
        this.group.add(this.decalMesh(g, mat));
      }
    }
    // Kuyruk kodu ve seri: eğik yüzeylerin dış-alt yüzü. Yüzeyin (FIN) profiline
    // oturur ve yüzey meshinin ÇOCUĞUDUR, yani sapmada yüzeyle birlikte döner.
    const txtMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeTextTexture(L.tailCode || 'VX', { w: 256, h: 128, font: 'bold 96px Arial', color: L.markColor || '#9aa0a8' })), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    const serialMat = this.track(new THREE.MeshStandardMaterial({ map: this.track(makeTextTexture(L.serial || 'FA-90 001', { w: 512, h: 128, font: 'bold 70px Arial', color: L.markColor || '#9aa0a8' })), transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    const F = FIN, y0 = upperY(F.s, F.x);
    const hRoot = F.leRoot + (F.teRoot - F.leRoot) * F.pivotFrac;
    for (const side of [-1, 1]) {
      const fin = this.parts.fins[side < 0 ? 'left' : 'right'];
      const up = new THREE.Vector3(side * Math.sin(F.cant), Math.cos(F.cant), 0);
      const nrm = new THREE.Vector3(side * Math.cos(F.cant), -Math.sin(F.cant), 0);
      const origin = new THREE.Vector3(side * F.x, y0, st(hRoot));     // yüzey meshinin konumu
      const place = (material, W, H, hFrac, sc) => {
        const g = this.decalGrid(8, 3, (i, j) => {
          const u = i / 8, v = j / 3;
          const h = 1.70 * hFrac + (v - 0.5) * H, f = h / F.height;
          const sv = sc - side * (u - 0.5) * W;                        // doku ekseni (0, 0, -side)
          const le = F.leRoot + (F.leTip - F.leRoot) * f, chord = F.teRoot + (F.teTip - F.teRoot) * f - le;
          const th = (F.thickRoot + (F.thickTip - F.thickRoot) * f) * (1 - 0.82 * Math.max(0, (f - 0.90) / 0.10));
          const c = Math.min(1, Math.max(0, (sv - le) / chord));
          const q = new THREE.Vector3(side * F.x, y0, st(sv)).addScaledVector(up, h).addScaledVector(nrm, halfThick(c, th, chord) + OFF).sub(origin);
          return { x: q.x, y: q.y, z: q.z, u, v };
        }, nrm);
        fin.add(this.decalMesh(g, material));
      };
      place(txtMat, 0.50, 0.26, 0.62, 17.15);
      place(serialMat, 0.92, 0.22, 0.26, 16.70);
    }
  }

  buildLights() {
    const glowTex = this.track(makeGlowTexture(64));
    const mkLight = (color, x, y, z, size = 0.2) => {
      const g = new THREE.Group();
      const bulb = new THREE.Mesh(this.track(new THREE.SphereGeometry(0.030, 6, 5)), this.track(new THREE.MeshBasicMaterial({ color })));
      const spr = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
      spr.scale.set(size, size, 1);
      g.add(bulb, spr);
      g.position.set(x, y, z);
      g.userData.sprite = spr; g.userData.size = size;
      this.group.add(g);
      return g;
    };
    // Kanat ucu fenerleri: lens kanat ucu profilinin DIŞ yüzeyine 1 cm ötede durur,
    // böylece havada asılı görünmez (kanat ucu bıçak ağzına kapatılmıştır).
    const tip = WING.tipX, ly = wingY(tip);
    const leTip = wingLE(tip), teTip = wingTE(tip);
    const lensX = tip + 0.012;
    this.lights = {
      navLeft: mkLight(0xff2a2a, -lensX, ly, st(leTip + 0.22), 0.17),
      navRight: mkLight(0x2aff5a, lensX, ly, st(leTip + 0.22), 0.17),
      // Arka perdenin ortasında (motorlar arası bel). Eskiden bodyTop(19,2)'deydi —
      // o istasyonda artık gövde yok, ışık havada kalırdı.
      tail: mkLight(0xffffff, 0, ENG.y + 0.26, st(AFT.s1) + 0.02, 0.15),
      strobeLeft: mkLight(0xffffff, -lensX, ly, st(teTip - 0.28), 0.32),
      strobeRight: mkLight(0xffffff, lensX, ly, st(teTip - 0.28), 0.32),
      beaconTop: mkLight(0xff3020, 0, bodyTop(9.0) + 0.03, st(9.0), 0.26),
      beaconBottom: mkLight(0xff3020, 0, lowerY(9.0, 0) - 0.03, st(9.0), 0.26),
    };
    this.parts.strobe = this.lights.strobeLeft;
    // İniş/taksi ışığı: burun takımı üzerinde
    const spot = new THREE.SpotLight(0xfff2dc, 0, 460, 24 * DEG, 0.45, 0.6);
    spot.castShadow = false;
    const noseGear = this.parts.gear.nose.pivot;
    spot.position.set(0, -0.50, -0.14);
    const target = new THREE.Object3D();
    target.position.set(0, -6.0, -40);
    noseGear.add(spot); noseGear.add(target);
    spot.target = target;
    this.landingSpot = spot;
    this.landingLens = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTex, color: 0xfff4e0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })));
    this.landingLens.scale.set(0.5, 0.5, 1);
    this.landingLens.position.set(0, -0.50, -0.18);
    this.landingLens.visible = false;
    noseGear.add(this.landingLens);
    this.landingLightsOn = false;
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

  setLandingLights(on) { this.landingLightsOn = !!on; }

  // Kontrol yüzeyleri ve efektler. Tüm açılar GERÇEK pilot girdisinden türetilir;
  // hiçbir yüzey "sahte" hareket etmez. slats girdisi yoktur (FA-90'da hücum kenarı
  // kapağı yoktur; aerodata'da CLslats = 0) ve kullanılmaz.
  update({ elevator = 0, aileron = 0, rudder = 0, flaps = 0, spoilers = 0, gear = 1, throttle = 0, afterburner = 0, time = 0, groundSpeed = 0, dt = 0, camDist = 25 } = {}) {
    const p = this.parts;
    const setHinge = (mesh, a) => { mesh.quaternion.setFromAxisAngle(mesh.userData.axis, a); };
    // Kuyruksuz düzen: yunuslama ve yatış aynı firar kenarı yüzeyleriyle yapılır.
    // Pozitif menteşe açısı = firar kenarı AŞAĞI; +elevator = burun yukarı => yukarı.
    const elev = -elevator * 24 * DEG;
    const ail = aileron * 20 * DEG;
    const droop = flaps * 18 * DEG;
    const S = p.surf;
    setHinge(S.flaperon.right, droop + elev * 0.70 - ail * 0.55);
    setHinge(S.flaperon.left, droop + elev * 0.70 + ail * 0.55);
    setHinge(S.elevonMid.right, elev - ail * 0.90);
    setHinge(S.elevonMid.left, elev + ail * 0.90);
    setHinge(S.elevonOut.right, elev * 0.85 - ail * 1.00);
    setHinge(S.elevonOut.left, elev * 0.85 + ail * 1.00);
    // Eğik tam hareketli yüzeyler: sapma için İKİSİ DE aynı yöne döner
    const rud = -rudder * FIN.travel;
    setHinge(p.fins.right, rud);
    setHinge(p.fins.left, rud);
    // Sırt hava frenleri: ön kenardan menteşeli, arka kenar yukarı kalkar
    const brk = -spoilers * 52 * DEG;
    p.brakes.left.rotation.x = brk;
    p.brakes.right.rotation.x = brk;
    // İniş takımı ve kapaklar
    this.wheelSpin += (groundSpeed / 0.42) * dt;
    for (const key of ['nose', 'left', 'right']) {
      const g = p.gear[key];
      const a = (1 - gear) * Math.PI / 2 * g.retractSign;
      g.pivot.rotation.set(0, 0, 0);
      if (g.retractAxis === 'x') g.pivot.rotation.x = a; else g.pivot.rotation.z = a;
      g.pivot.visible = gear > 0.001;
      g.wheel.rotation.x = this.wheelSpin * 0.42 / g.radius;
      const doorOpen = Math.min(1, gear * 1.4);
      for (const d of g.doors) d.pivot.rotation.z = d.sign * (Math.PI / 2) * (1 - doorOpen) + d.sign * 0.35 * doorOpen;
    }
    // Motor: askeri güçte kızıl parıltı, art yakıcıda lüle alanı açılır ve alev uzar
    const mil = Math.max(0, (throttle - 0.55) / 0.45);
    const abRise = afterburner - (this._lastAb || 0); this._lastAb = afterburner;
    this.abFlash = Math.max(0, this.abFlash * (1 - 6 * Math.max(dt, 0.001)) + Math.max(0, abRise) * 40);
    const flash = Math.min(1, this.abFlash);
    this.matGlow.opacity = mil * 0.25 + afterburner * 0.75 + flash * 0.4;
    this.matGlow.color.setRGB(1.0, 0.45 + 0.45 * afterburner, 0.15 + 0.7 * afterburner);
    this.matNozzleInner.emissiveIntensity = mil * 0.35 + afterburner * 1.7 + flash;
    // Yakınsak-ıraksak lüle: art yakıcıda çıkış alanı büyür (gerçek fiziksel davranış)
    const open = 1 + NOZ_OPEN.ab * afterburner + NOZ_OPEN.mil * mil;
    for (const pt of this.nozzlePetals) pt.morphTargetInfluences[0] = (open - 1) / (NOZ_OPEN_MAX - 1);
    const intensity = mil * 0.14 + afterburner;
    if (intensity > 0.02) {
      this.parts.flame.visible = true;
      const flick = 1 + 0.06 * Math.sin(time * 71) * Math.sin(time * 29) + 0.03 * Math.sin(time * 113);
      const len = (1.3 + 1.4 * mil + 7.2 * afterburner) * flick;
      const w = 0.9 + 0.35 * afterburner + 0.25 * flash;
      for (const fg of this.flameGroups) {
        fg.scale.set(w, w, len);
        fg.userData.haze.visible = afterburner > 0.1;
      }
      const I = Math.min(1.5, intensity + flash * 0.6);
      for (const mt of this.flameMats) { mt.uniforms.time.value = time; mt.uniforms.intensity.value = I; }
    } else {
      this.parts.flame.visible = false;
    }
    // Dış ışıklar
    const tp = time % 1.7;
    const strobeOn = (tp < 0.06) || (tp > 0.16 && tp < 0.22);
    const beaconOn = (time % 1.0) < 0.12;
    const L = this.lights;
    L.strobeLeft.visible = strobeOn; L.strobeRight.visible = strobeOn;
    L.beaconTop.visible = beaconOn; L.beaconBottom.visible = beaconOn;
    const pulse = 0.9 + 0.1 * Math.sin(time * 6);
    const far = Math.min(4.5, 1 + Math.sqrt(Math.max(0, camDist)) * 0.22);
    for (const k of ['navLeft', 'navRight', 'tail', 'strobeLeft', 'strobeRight', 'beaconTop', 'beaconBottom']) {
      const g = L[k];
      g.userData.sprite.scale.setScalar(g.userData.size * far * (k.startsWith('nav') ? pulse : 1));
    }
    const ll = this.landingLightsOn && gear > 0.9;
    this.landingSpot.intensity = ll ? 42 : 0;
    this.landingSpot.visible = ll;
    this.landingLens.visible = ll;
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
  }
}
