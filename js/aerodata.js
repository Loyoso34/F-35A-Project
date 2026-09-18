// Uçak aerodinamik veri setleri.
//
// Her değer PUBLIC_DATA_SOURCES.md içinde etiketlenmiştir:
//   [V] doğrulanmış kamuya açık veri
//   [E] mühendislik yaklaşımı (türetme gösterilir)
//   [T] ayarlanmış yaklaşım (kamuya açık DAVRANIŞI yeniden üretmek için seçildi)
//
// Hiçbir gizli veri kullanılmamış, üretilmemiş veya çıkarılmamıştır.

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// F-35A Lightning II
// ---------------------------------------------------------------------------
export const F35A_AERO = {
  name: 'F-35A',
  lift: 'vortex',                    // Polhamus girdap taşıması (çineli gövde + yüksek ok açısı)

  // --- Geometri [V] ---
  S: 42.7,                           // m²  [V] Lockheed Martin
  span: 10.7,                        // m   [V]
  chord: 4.00,                       // m   [E] planformdan türetilmiş MAC
  get AR() { return this.span * this.span / this.S; },   // 2.68 [E]

  // --- Kütle [V] ---
  massEmpty: 13300,                  // kg  [V] USAF fact sheet (29 300 lb)
  fuel: 8300,                        // kg  [V] iç yakıt 18 250 lb

  // --- Atalet [E] — F-16A kamuya açık değerlerinden ölçeklendi ---
  Ixx: 38100, Iyy: 197300, Izz: 240100, Ixz: 3700,   // kg·m²

  // --- Taşıma: Polhamus katsayıları ---
  Kp: 3.25,                          // [E] πAR/(1+√(1+(AR/2)²)) + gövde katkısı
  CLalpha: 3.25,                     // [E] küçük AoA'da dCL/dα — FCS kazanç ölçeği için.
                                     //     Girdap modelinde bu Kp'ye eşittir.
  Kv: 2.60,                          // [T] CLmax ≈ 2.0 @ ~40° AoA verir
  vortexBurst: 0.55,                 // [T] girdap patlamasında kaybolan girdap taşıması oranı
  burstA0: 42 * DEG, burstA1: 75 * DEG,   // [T]
  alphaPeak: 42 * DEG,               // [E] CL tepesinin yaklaşık yeri (trim aramasında sınır)
  CLref: 1.0,                        // referans CL (Clr ölçeklemesi)
  CLsupK: 1.05,                      // [E] Ackeret ses üstü eğim katsayısı

  // --- Ayrılma / stall harmanlama açıları [T] ---
  sepA0: 22 * DEG, sepA1: 48 * DEG,       // konfigürasyon katkılarının söndüğü bant
  stallA0: 26 * DEG, stallA1: 42 * DEG,   // "stall" göstergesi (yalnızca telemetri/uyarı)
  blankA0: 25 * DEG, blankA1: 55 * DEG,   // dikey kuyrukların gölgelenmesi
  tailBlank: 0.62,                        // [T] 55°'de kuyruk etkinliği %38'e iner
  hiA0: 34 * DEG, hiA1: 55 * DEG,         // burun aşağı momentin devreye girdiği bant
  CmHiAlpha: 0.085,                       // [T] toparlanmaya yardım eden burun aşağı moment

  // --- Sürükleme ---
  CD0: 0.0165,                       // [E] temiz, iç taşımalı stealth savaş uçağı
  e: 0.78, eFlaps: 0.72,             // [E] Oswald verimi
  CDgear: 0.024,                     // [E]
  CDflaps: 0.018, CLflaps: 0.42,     // [E] flaperon iniş konumu
  CDspoiler: 0, CLspoiler: 0, CLslats: 0,
  CDsep: 1.35,                       // [T] ayrılmış akış sürüklemesi (düz plaka yaklaşımı)
  CDwave: 0.047,                     // [E] transonik dalga sürüklemesi tepe değeri
  CDbeta: 0.55,                      // [E] kayma açısı sürüklemesi
  CDde: 0.012, CDda: 0.006, CDdr: 0.010,   // [E] kontrol yüzeyi sapma sürüklemesi
  groundLift: 0.10,                  // [E] yer etkisi taşıma artışı

  // --- Yunuslama ---
  Cm0: 0.010,                        // [E]
  Cma: -0.075,                       // [T] ses altı: hafif kararlı (gerçek uçak gevşek kararlıdır)
  CmaSup: -0.42,                     // [E] ses üstü: aerodinamik merkez geriye kayar
  Cmq: -11.5,                        // [E] yunuslama sönümü
  CmFlaps: -0.045, CmSpoiler: 0,
  Cmde: -0.62,                       // [E] stabilatör yunuslama gücü (δ=1 tam sapma)
  CLde: 0.28,                        // [E] stabilatörün taşıma katkısı

  // --- Yanal / yönsel ---
  CYb: -0.95, CYr: 0.38, CYp: -0.08, CYdr: 0.21,   // [E]
  Clb: -0.075, ClbAlpha: 0.85,       // [E] dihedral etkisi alpha ile artar
  Clp: -0.080, ClpFade: 0.55,        // [E] ARTIK sönüm: gövde+kuyruk. Kanat payı şerit
                                     //     modelinden (rollAsym) gelir; toplam ≈ -0.36
  Clr: 0.14,
  Clda: 0.105, CldaFade: 0.45,       // [E] flaperon/stabilatör diferansiyel yatış gücü
  Cldr: -0.012,                      // [E] dümenin yatış yan etkisi (dikey kuyruk CG üstünde)
  Cnb: 0.135,                        // [E] yönsel kararlılık (eğik çift dikey kuyruk)
  CnbFloor: 0.28,                    // [T] yüksek alpha'da KALAN kararlılık — asla negatife düşmez
  cnbA0: 20 * DEG, cnbA1: 48 * DEG,
  Cnr: -0.38,                        // [E] sapma sönümü
  Cnp: -0.055,                       // [E]
  Cndr: -0.082,                      // [E] dümen sapma gücü
  Cnda: -0.008,                      // [E] ters sapma
  rollAsym: 0.068,                   // [E] şerit modeli kazancı. Doğrusal bölgede
                                     //     Cl_p(kanat) ≈ -k·1.28·Kp = -0.28 verir
  ClpTotal: -0.363,                  // [E] TOPLAM yatış sönümü = Clp(artık) + şerit payı.
                                     //     FCS'nin yetki tavanı hesabı bunu kullanır.

  // --- Motor: Pratt & Whitney F135-PW-100 ---
  thrustMil: 124500,                 // N  [V] 28 000 lbf
  thrustAB: 191300,                  // N  [V] 43 000 lbf
  idleFrac: 0.055,                   // [E] rölanti itkisi / askeri itki
  thrustRhoExp: 0.85,                // [E] yoğunluk üssü
  ramA: -0.28, ramB: 0.42,           // [E] 1 - 0.28M + 0.42M² ram eğrisi
  spoolUp: 4.0, spoolDown: 2.2, spoolIdleLag: 0.6, abSpool: 0.7,   // s [T]
  sfcMil: 2.30, sfcAB: 8.20,         // kg/s [E]
  thrustZ: 0.0,                      // m, itki ekseninin CG'ye göre düşey ofseti [E]

  // --- Limitler ---
  gMax: 9.0,                         // [V] USAF fact sheet
  gMin: -3.0,                        // [E]
  alphaLimit: 50 * DEG,              // [V] kamuya açık uçuş testi ~50° AoA
  alphaSoft: 28 * DEG,               // [T] normal manevra AoA tavanı (yumuşak sınır)
  rollRateMax: 270 * DEG,            // [E] modern savaş uçağı sınıfı
  pitchRateMax: 60 * DEG,
  yawRateMax: 20 * DEG,
};

// ---------------------------------------------------------------------------
// Airbus A321neo — konvansiyonel kanat, aynı arayüz
// ---------------------------------------------------------------------------
export const A321_AERO = {
  name: 'A321neo',
  lift: 'classic',

  S: 128, span: 35.8, chord: 4.29,
  get AR() { return this.span * this.span / this.S; },
  massEmpty: 62000, fuel: 18000,
  Ixx: 2.3e6, Iyy: 8.5e6, Izz: 8.0e6, Ixz: 1.2e5,

  // Klasik taşıma eğrisi
  CLa: 5.4, CL0: 0.45, CLmax: 1.55,
  CLalpha: 5.4,                      // klasik modelde dCL/dα doğrudan CLa'dır
  alphaLin: 14 * DEG, alphaMax: 16.8 * DEG, alphaDrop: 28 * DEG,
  CLplate: 0.95, alphaPeak: 16 * DEG, CLref: 1.2, CLsupK: 1.0,

  sepA0: 15 * DEG, sepA1: 30 * DEG,
  stallA0: 14 * DEG, stallA1: 24 * DEG,
  blankA0: 20 * DEG, blankA1: 45 * DEG, tailBlank: 0.55,
  hiA0: 22 * DEG, hiA1: 40 * DEG, CmHiAlpha: 0.10,

  CD0: 0.021, e: 0.80, eFlaps: 0.72,
  CDgear: 0.022, CDflaps: 0.085, CLflaps: 0.85,
  CDspoiler: 0.075, CLspoiler: 0.42, CLslats: 0.25,
  CDsep: 1.20, CDwave: 0.030, CDbeta: 0.45,
  CDde: 0.010, CDda: 0.004, CDdr: 0.008,
  groundLift: 0.10,

  Cm0: 0.028, Cma: -1.05, CmaSup: -1.30, Cmq: -26.0,
  CmFlaps: -0.13, CmSpoiler: -0.06, Cmde: -1.05, CLde: 0.22,

  CYb: -0.85, CYr: 0.30, CYp: -0.05, CYdr: 0.18,
  Clb: -0.095, ClbAlpha: 0.45, Clp: -0.100, ClpFade: 0.50, Clr: 0.14,   // Clp = artık (şerit modeli hariç)
  Clda: 0.052, CldaFade: 0.40, Cldr: -0.008,
  Cnb: 0.165, CnbFloor: 0.40, cnbA0: 14 * DEG, cnbA1: 30 * DEG,
  Cnr: -0.30, Cnp: -0.05, Cndr: -0.095, Cnda: -0.004,
  rollAsym: 0.070,                   // şerit modeli: Cl_p(kanat) ≈ -0.48, toplam ≈ -0.58
  ClpTotal: -0.584,

  thrustMil: 286000, thrustAB: 286000, idleFrac: 0.05,
  thrustRhoExp: 0.75, ramA: -0.95, ramB: 0.0, thrustFloor: 0.34,
  spoolUp: 7.0, spoolDown: 4.0, spoolIdleLag: 0.75, abSpool: 1.0,
  sfcMil: 2.10, sfcAB: 0, thrustZ: -1.55,

  gMax: 2.5, gMin: 0.0,
  alphaLimit: 14 * DEG, alphaSoft: 10.5 * DEG,
  rollRateMax: 15 * DEG, pitchRateMax: 8 * DEG, yawRateMax: 5 * DEG,
};

// ---------------------------------------------------------------------------
// Veri seti bütünlük denetimi.
//
// Taşıma formülasyonuna bağlı alanlar (Kp/Kv vs CLa/CLmax) yalnızca kendi dalında
// okunur; ama aşağıdaki alanlar HER uçak için koşulsuz okunur. Biri eksikse
// hesap sessizce NaN'a düşer ve uçak ilk adımda kontrolü kaybeder — bu, A321'de
// bir kez gerçekten yaşandı (fcs.js D.Kp okuyordu, A321'de yoktu).
// Bu yüzden eksiklik yükleme anında yüksek sesle bildirilir.
// ---------------------------------------------------------------------------
const REQUIRED = [
  'S', 'span', 'chord', 'AR', 'CLalpha', 'massEmpty', 'fuel',
  'Ixx', 'Iyy', 'Izz', 'Ixz',
  'CD0', 'e', 'CDsep', 'CDwave', 'CDbeta', 'CLde',
  'Cma', 'CmaSup', 'Cmq', 'Cmde', 'CmHiAlpha', 'hiA0', 'hiA1',
  'sepA0', 'sepA1', 'stallA0', 'stallA1', 'blankA0', 'blankA1', 'tailBlank',
  'CYb', 'CYr', 'CYp', 'CYdr',
  'Clb', 'ClbAlpha', 'Clp', 'ClpFade', 'Clr', 'Clda', 'CldaFade', 'Cldr',
  'ClpTotal', 'rollAsym',
  'Cnb', 'CnbFloor', 'cnbA0', 'cnbA1', 'Cnr', 'Cnp', 'Cndr', 'Cnda',
  'thrustMil', 'thrustAB', 'idleFrac', 'thrustRhoExp', 'ramA',
  'spoolUp', 'spoolDown', 'spoolIdleLag', 'abSpool', 'sfcMil', 'sfcAB',
  'gMax', 'gMin', 'alphaLimit', 'alphaSoft',
  'rollRateMax', 'pitchRateMax', 'yawRateMax', 'CLref', 'alphaPeak',
];

export function validateAeroData(D) {
  const missing = REQUIRED.filter((k) => !Number.isFinite(D[k]));
  if (missing.length) console.error(`[aerodata] ${D.name}: eksik/geçersiz alan: ${missing.join(', ')}`);
  return missing;
}

for (const D of [F35A_AERO, A321_AERO]) validateAeroData(D);
