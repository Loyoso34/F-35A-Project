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
  CD0: 0.0190,                       // [E] temiz, iç taşımalı stealth savaş uçağı. 0.0165 rölantide
                                     //     480 kt'tan yalnızca ~1,5 kt/s yavaşlatıyordu (gerçekçi değil)
  e: 0.78, eFlaps: 0.72,             // [E] Oswald verimi
  CDgear: 0.024,                     // [E]
  CDflaps: 0.018, CLflaps: 0.42,     // [E] flaperon iniş konumu
  CLlef: 0.06, CDlef: 0.004,         // [E] hücum kenarı flapı (tam sapma): küçük taşıma ve sürükleme artışı
  CDsep: 1.35,                       // [T] ayrılmış akış sürüklemesi (düz plaka yaklaşımı)
  CDwave: 0.0443,                    // [E] transonik dalga sürüklemesi tepe değeri; CD0 artışı kadar
                                     //     azaltıldı: M 1.6'daki toplam (≈0.060) ve azami hız değişmez
  CDbeta: 0.55,                      // [E] kayma açısı sürüklemesi
  CDde: 0.012, CDda: 0.006, CDdr: 0.010,   // [E] kontrol yüzeyi sapma sürüklemesi
  groundLift: 0.10,                  // [E] yer etkisi taşıma artışı

  // --- Yunuslama ---
  Cm0: 0.010,                        // [E]
  Cma: -0.075,                       // [T] ses altı: hafif kararlı (gerçek uçak gevşek kararlıdır)
  CmaSup: -0.42,                     // [E] ses üstü: aerodinamik merkez geriye kayar
  Cmq: -11.5,                        // [E] yunuslama sönümü
  CmFlaps: -0.045,
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
  idleFrac: 0.055,                   // [E] rölanti itkisi / askeri itki (statik)
  idleRamDrag: 1.45,                 // [E] rölantide ram sürüklemesi: net rölanti itkisi Mach ile düşer,
                                     //     ~M 0.7'de sıfıra iner (brüt itki ≈ giriş momentum kaybı)
  thrustRhoExp: 0.85,                // [E] yoğunluk üssü
  ramA: -0.28, ramB: 0.42,           // [E] 1 - 0.28M + 0.42M² ram eğrisi
  inletM0: 1.3, inletLoss: 0.55,     // [E] DSI alığı: M 1.3 üstünde basınç geri kazanımı kaybı
                                     //     (ram × (1 − 0.55·(M−1.3)²)); azami hızı kamuya açık M 1.6'ya oturtur
  spoolUp: 3.3, spoolDown: 2.2, spoolIdleLag: 0.6, abSpool: 0.7,   // s [T] rölanti->askeri ≈ 4,5 s
  abLightOff: 0.22,                  // s [E] art yakıcı tutuşma gecikmesi (ateşleme + yakıt manifoldu dolumu)
  abRamp: 1.5, abCut: 0.35,          // s [E] tutuşmadan tam AB'ye kademeli artış / kesmede sönme
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

//
// Aşağıdaki alanlar fizik ve FCS tarafından koşulsuz okunur. Biri eksikse hesap
// sessizce NaN'a düşer ve uçak ilk adımda kontrolü kaybeder; bu yüzden eksiklik
// yükleme anında yüksek sesle bildirilir.
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

validateAeroData(F35A_AERO);
