// Uçak filosu: her uçağın modeli, aerodinamiği, kontrol kanunu, kameraları, sesi ve arayüz davranışı
// tek bir yapılandırma nesnesinde toplanır. Yeni uçak eklemek için buraya bir girdi eklemek yeterlidir.
import * as THREE from 'three';
import { F35A, F35 } from './aircraft.js';
import { A321neo, A321 } from './a321.js';
import { FA90Vesper, FA90 } from './fa90.js';
import { F35A_AERO, A321_AERO, FA90_AERO } from './aerodata.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
const F35_CFG = {
  id: 'f35a',
  name: 'F-35A Lightning II',
  sub: 'Single-seat 5th-generation multirole fighter',
  specs: ['Length 15.7 m', 'Wingspan 10.7 m', 'Max Mach 1.6'],
  accent: '#39ff6a',
  build: (o) => new F35A(o),
  geom: {
    wheelBottomY: F35.wheelBottomY, noseGearZ: F35.noseGearZ, mainGearZ: F35.mainGearZ, mainGearX: F35.mainGearX,
    bellyR: 0.95, bellyArm: 4.0, rollArmX: 5.3, rollArmY: 0.3,
  },
  aero: F35A_AERO,
  law: {
    Kq0: 3.5, KqA: 4.5, Kp0: 5, KpA: 7, Kr0: 2.5, KrA: 3.5,
    zeta: 0.9, prefilter: 0.12, rollFilter: 0.06, actuator: 0.035, stickPow: 1.5,
    qAuth: 9000, qRoll: 6000, qBlend: [2500, 7000],
    rollAuth: 0.85,           // aerodinamik yatış yetkisinin FCS'ye açılan payı
    Vmin: 35,                 // m/s — normalize oran paydası için güvenli taban
    surfRate: 4.0,            // birim/s — eyleyici azami hızı (tam sapma ~0,25 s)
    // Yüksek AoA'da yatış oranı tavanı: atalet çiftlenimi kaynaklı departure'ı önleyen
    // ANA koruma. 20°'de düşmeye başlar, 45°'de %85 kısılır. Gerçek savaş uçağı FCS'leri
    // de tam olarak bunu yapar.
    rollA0: 18 * DEG, rollA1: 45 * DEG, rollAlphaCut: 0.85,
    betaGain: 3.0,            // kayma -> koordinasyon sapma oranı kazancı
    betaRate: 0.55,           // kayma DEĞİŞİM hızı geri beslemesi (Dutch roll sönümü)
    betaAuth: 0.60,           // rad/s — koordinasyon komutunun tavanı
    yawBudgetT: 0.65,          // s — dümenin sapma oranı kurma süresi (yatış tavanı için)
  },
  ground: { steerMax: 55 * DEG, steerV: 45, tireGrip: 0.45, rotQ: [2200, 5200], rotRate: 18 * DEG, pushRate: 10 * DEG, maxPitch: 13 * DEG, rollMu: [0.02, 0.09], brakeMu: [0.5, 0.25], stictionMu: [0.065, 0.17] },
  limits: { alphaWarn: 19 * DEG, hardLandVs: -6.5, landRoll: 12 * DEG, groundRoll: 15 * DEG, landPitch: [-4 * DEG, 15 * DEG], offRunwayV: [55, 60] },
  // flapNames kol üstündeki kademe adı, flapNotes ise altındaki açıklamadır (İngilizce).
  // F-35'in kanat yüzeyi açıları kamuya açık değildir; derece yazmak yerine kademe adı
  // kullanılır (uydurma sayı verilmez).
  systems: { flapDetents: [0, 1], flapNames: ['UP', 'LAND'], flapNotes: ['CLEAN', 'LDG'], flapRate: 1 / 3, slatLead: 0, gearRate: 1 / 6, spoilers: null, reverse: 0 },
  cameras: {
    cockpitEye: [F35.pilotEye.x, F35.pilotEye.y, F35.pilotEye.z], cockpitFov: 58, cockpitNear: 0.10, cockpitPitch: -4 * DEG,
    chase: { dist: [21, 30], vRef: 320, up: 2.8, ahead: 70, lookUp: 1.5, fov: 58 },
    orbit: { dist: 26, min: 6, max: 260, lookUp: 1, fov: 50 },
    flyby: { fov: 42, ahead: [180, 900], side: [60, 150], up: 3, vScale: 4.5, reset: 1300 },
    wing: { eye: [0.55, 0.85, -2.1], look: [5.0, -0.45, 2.2], fov: 62 },
    gear: { eye: [1.05, -0.15, -1.9], look: [1.75, -2.4, 0.8], fov: 58 },
    shake: 1,
  },
  audio: { rumbleF: [38, 75], rumbleFilter: [120, 260], rumbleGain: [0.10, 0.22], roarBP: [220, 620], roarLP: [500, 2200], roarGain: [0.05, 0.55], whineF: [700, 3500], whineGain: [0.004, 0.028], hissHP: [1800, 2500], hissGain: 0.05, ab: 1, reverse: 0, idle: 0.22, rollLP: 220 },
  hud: 'fighter',
  ui: { afterburner: true, spoilerButton: false, flapCycle: false },
  thumb: { pos: [-9.5, 3.4, -12.5], look: [0, 0.2, 0.6], fov: 26 },
};

// ---------------------------------------------------------------------------
// Airbus A321neo — ağır dar gövdeli yolcu uçağı. Değerler gerçek uçağa yakın seçildi.
const A321_CFG = {
  id: 'a321',
  name: 'Airbus A321neo',
  sub: 'Twin-engine narrow-body airliner',
  specs: ['Length 44.5 m', 'Wingspan 35.8 m', 'MTOW 97 t'],
  accent: '#4aa8ff',
  build: (o) => new A321neo(o),
  geom: {
    wheelBottomY: A321.wheelBottomY, noseGearZ: A321.noseGearZ, mainGearZ: A321.mainGearZ, mainGearX: A321.mainGearX,
    bellyR: 2.15, bellyArm: 9.0, rollArmX: 5.75, rollArmY: 3.35,
  },
  aero: A321_AERO,
  law: {
    Kq0: 0.95, KqA: 0.95, Kp0: 1.15, KpA: 1.15, Kr0: 0.7, KrA: 0.7,
    zeta: 0.95, prefilter: 0.26, rollFilter: 0.22, actuator: 0.10, stickPow: 1.9,
    qAuth: 6000, qRoll: 5000, qBlend: [1800, 5200],
    rollAuth: 0.70,
    Vmin: 45, surfRate: 2.2,
    rollA0: 10 * DEG, rollA1: 16 * DEG, rollAlphaCut: 0.70,
    betaGain: 2.0, betaRate: 0.40, betaAuth: 0.25, yawBudgetT: 1.4,
  },
  ground: { steerMax: 45 * DEG, steerV: 40, tireGrip: 0.25, rotQ: [1200, 3100], rotRate: 6 * DEG, pushRate: 3.5 * DEG, maxPitch: 11 * DEG, rollMu: [0.015, 0.075], brakeMu: [0.42, 0.22], stictionMu: [0.060, 0.16] },
  limits: { alphaWarn: 9.5 * DEG, hardLandVs: -3.6, landRoll: 8 * DEG, groundRoll: 10 * DEG, landPitch: [-2 * DEG, 11 * DEG], offRunwayV: [40, 45] },
  systems: {
    // A320 ailesinin kamuya açık kademeleri: CONF 0 / 1 / 2 / 3 / FULL.
    // flapNotes kanat firar kenarı açısını gösterir (slat açısı ayrıca 0/18/22/22/27°).
    flapDetents: [0, 0.25, 0.5, 0.75, 1], flapNames: ['0', '1', '2', '3', 'FULL'],
    flapNotes: ['0°', '10°', '15°', '20°', '40°'],
    flapRate: 1 / 9, slatLead: 1.6, gearRate: 1 / 11,
    // airFrac: havada hız freni yarım açılır (A320 ailesinde olduğu gibi), yerde tam yer spoyleri
    spoilers: { rate: 2.2, groundAuto: true, airFrac: 0.5 }, reverse: 0.38,
  },
  cameras: {
    cockpitEye: [A321.pilotEye.x, A321.pilotEye.y, A321.pilotEye.z], cockpitFov: 55, cockpitNear: 0.10, cockpitPitch: -6 * DEG,
    chase: { dist: [58, 86], vRef: 260, up: 8.5, ahead: 150, lookUp: 2.0, fov: 55 },
    orbit: { dist: 62, min: 14, max: 600, lookUp: 1.5, fov: 50 },
    flyby: { fov: 40, ahead: [280, 1150], side: [120, 280], up: 8, vScale: 5.0, reset: 2200 },
    wing: { eye: [1.82, 0.30, -0.8], look: [9.5, -1.5, 5.0], fov: 66 },
    gear: { eye: [2.15, -1.55, 0.1], look: [3.8, -4.1, 2.9], fov: 60 },
    shake: 0.45,
  },
  audio: { rumbleF: [24, 52], rumbleFilter: [95, 200], rumbleGain: [0.13, 0.26], roarBP: [150, 430], roarLP: [380, 1500], roarGain: [0.05, 0.44], whineF: [360, 2500], whineGain: [0.010, 0.034], hissHP: [1400, 2000], hissGain: 0.035, ab: 0, reverse: 1, idle: 0.20, rollLP: 150 },
  hud: 'airliner',
  ui: { afterburner: false, spoilerButton: true, flapCycle: true },
  thumb: { pos: [-26, 9, -34], look: [0, 0.4, 1.5], fov: 26 },
};

// ---------------------------------------------------------------------------
// FA-90 Vesper — KURGUSAL 7. nesil hava üstünlüğü savaş uçağı.
// "10 kat güçlü" isteği bir OYUN HEDEFİ olarak ele alındı: itki/ağırlık, yuvarlanma
// oranı, yapısal G ve AoA yetkisi çok yüksek; ancak uçak hâlâ kütle, atalet, yer
// çekimi, kaldırma, sürükleme ve açısal momentum yasalarına uyar. Konum ya da dönüş
// DOĞRUDAN oynanmaz: tüm hareket aynı rijit cisim çözücüsünden geçer.
const FA90_CFG = {
  id: 'fa90',
  name: 'FA-90 Vesper',
  sub: 'Single-seat 7th-generation air-dominance fighter (fictional)',
  specs: ['Length 19.6 m', 'MTOW 29 t', 'Supercruise M 1.4'],
  accent: '#c07bff',
  build: (o) => new FA90Vesper(o),
  geom: {
    wheelBottomY: FA90.wheelBottomY, noseGearZ: FA90.noseGearZ, mainGearZ: FA90.mainGearZ, mainGearX: FA90.mainGearX,
    // bellyR: takım içerideyken karın yarıçapı; bellyArm/rollArmX gövde ve kanat kolu
    bellyR: 1.10, bellyArm: 5.2, rollArmX: 7.4, rollArmY: 0.45,
  },
  aero: FA90_AERO,
  law: {
    // Eyleyiciler F-35'ten hızlı, kazançlar yüksek; ama zeta ve prefilter korunur:
    // kapalı çevrim hâlâ SÖNÜMLÜ ikinci derece bir sistem gibi davranır, adım yanıtı
    // anlık değildir. surfRate 6,0 => tam sapma ~0,17 s (fiziksel bir eyleyici sınırı).
    // Kp ve rollFilter, düşürülen yatış oranı tavanıyla birlikte yumuşatıldı:
    // kazanç aynı kalsaydı çubuk yeni tavana yine "çarparak" oturur, oran düştüğü
    // hâlde giriş hissi sert kalırdı.
    Kq0: 4.2, KqA: 5.4, Kp0: 5.4, KpA: 7.4, Kr0: 2.8, KrA: 4.0,
    zeta: 0.92, prefilter: 0.085, rollFilter: 0.055, actuator: 0.022, stickPow: 1.45,
    qAuth: 14000, qRoll: 11000, qBlend: [2200, 9000],
    rollAuth: 0.90,
    Vmin: 38, surfRate: 6.0,
    // Yüksek AoA'da yatış oranı tavanı: kuyruksuz düzende atalet çiftlenimi
    // kaynaklı departure'ı önleyen ANA koruma. F-35'ten daha geç devreye girer
    // (kanat yükü düşük, çine girdapları 45°'ye kadar tutunuyor) ama YOK DEĞİL.
    rollA0: 26 * DEG, rollA1: 56 * DEG, rollAlphaCut: 0.82,
    betaGain: 3.4, betaRate: 0.62, betaAuth: 0.70, yawBudgetT: 0.52,
  },
  ground: { steerMax: 58 * DEG, steerV: 48, tireGrip: 0.48, rotQ: [2400, 5600], rotRate: 20 * DEG, pushRate: 11 * DEG, maxPitch: 12 * DEG, rollMu: [0.02, 0.09], brakeMu: [0.52, 0.26], stictionMu: [0.068, 0.18] },
  limits: { alphaWarn: 30 * DEG, hardLandVs: -7.0, landRoll: 13 * DEG, groundRoll: 16 * DEG, landPitch: [-4 * DEG, 12 * DEG], offRunwayV: [58, 64] },
  // Kuyruksuz delta: firar kenarı yüzeyleri hem flaperon hem elevondur. Kademeler
  // uçağın kendi sistem adlarıdır (kurgusal uçak olduğu için derece yazılabilir).
  systems: {
    flapDetents: [0, 0.5, 1], flapNames: ['UP', 'MVR', 'LAND'], flapNotes: ['0°', '9°', '18°'],
    flapRate: 1 / 2.5, slatLead: 0, gearRate: 1 / 5,
    // Sırt hava frenleri: yerde tam açılır (yer spoyleri gibi), havada tam yetki
    spoilers: { rate: 3.0, groundAuto: true, airFrac: 1.0 }, reverse: 0,
  },
  cameras: {
    cockpitEye: [FA90.pilotEye.x, FA90.pilotEye.y, FA90.pilotEye.z], cockpitFov: 60, cockpitNear: 0.10, cockpitPitch: -5 * DEG,
    chase: { dist: [26, 38], vRef: 420, up: 3.4, ahead: 90, lookUp: 1.8, fov: 58 },
    orbit: { dist: 32, min: 7, max: 320, lookUp: 1.2, fov: 50 },
    flyby: { fov: 42, ahead: [200, 1100], side: [70, 180], up: 3.5, vScale: 4.5, reset: 1500 },
    wing: { eye: [0.70, 0.95, -2.4], look: [6.6, -0.55, 2.6], fov: 62 },
    gear: { eye: [1.25, -0.20, -2.2], look: [2.05, -2.8, 1.0], fov: 58 },
    shake: 1.15,
  },
  audio: { rumbleF: [30, 64], rumbleFilter: [105, 240], rumbleGain: [0.12, 0.26], roarBP: [190, 560], roarLP: [430, 2000], roarGain: [0.06, 0.62], whineF: [620, 3200], whineGain: [0.005, 0.032], hissHP: [1700, 2400], hissGain: 0.055, ab: 1, reverse: 0, idle: 0.24, rollLP: 200 },
  hud: 'fighter',
  ui: { afterburner: true, spoilerButton: true, flapCycle: false },
  thumb: { pos: [-12, 4.2, -15.5], look: [0, 0.2, 0.6], fov: 26 },
};

export const FLEET = { f35a: F35_CFG, a321: A321_CFG, fa90: FA90_CFG };
export const FLEET_ORDER = ['f35a', 'a321', 'fa90'];
export function getAircraftConfig(id) { return FLEET[id] || FLEET.f35a; }
