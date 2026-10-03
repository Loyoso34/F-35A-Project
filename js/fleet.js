// F-35A yapılandırması: modeli, aerodinamiği, kontrol kanunu, kameraları, sesi ve arayüz
// davranışı tek bir nesnede toplanır. Oyundaki tek uçak budur.
import { F35A, F35 } from './aircraft.js';
import { F35A_AERO } from './aerodata.js';

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
  systems: {
    flapDetents: [0, 1], flapNames: ['UP', 'LAND'], flapNotes: ['CLEAN', 'LDG'], flapRate: 1 / 3, gearRate: 1 / 6,
    // FCS'nin otomatik hücum kenarı flapı, manevra kamburluğu ve dümen toe-in programı
    // (0..1; görsel açılar aircraft.js'te). Firar kenarı flaperonlarının simetrik açısı
    // yalnızca pilotun flap kolundan gelir.
    autoFlaps: {
      lefA0: 3 * DEG, lefA1: 24 * DEG,                            // hücum kenarı flapı (yerde kapalı)
      tefA0: 8 * DEG, tefA1: 20 * DEG, tefManeuver: 0.22,         // manevra kamburluğu (yalnızca aerodinamik)
      toeV0: 30, toeV1: 60, toeA0: 22 * DEG, toeA1: 38 * DEG,     // dümen toe-in
      rate: 1.4,                                                  // tam aralık/s
    },
  },
  cameras: {
    cockpitEye: [F35.pilotEye.x, F35.pilotEye.y, F35.pilotEye.z], cockpitFov: 58, cockpitNear: 0.10, cockpitPitch: -4 * DEG,
    chase: { dist: [21, 30], vRef: 320, up: 2.8, ahead: 70, lookUp: 1.5, fov: 58 },
    orbit: { dist: 26, min: 6, max: 260, lookUp: 1, fov: 50 },
    flyby: { fov: 42, ahead: [180, 900], side: [60, 150], up: 3, vScale: 4.5, reset: 1300 },
    wing: { eye: [0.55, 0.85, -2.1], look: [5.0, -0.45, 2.2], fov: 62 },
    gear: { eye: [1.05, -0.15, -1.9], look: [1.75, -2.4, 0.8], fov: 58 },
    shake: 1,
  },
  audio: { rumbleF: [38, 75], rumbleFilter: [120, 260], rumbleGain: [0.10, 0.22], roarBP: [220, 620], roarLP: [500, 2200], roarGain: [0.05, 0.55], whineF: [700, 3500], whineGain: [0.004, 0.028], hissHP: [1800, 2500], hissGain: 0.05, ab: 1, idle: 0.22, rollLP: 220 },
  thumb: { pos: [-9.5, 3.4, -12.5], look: [0, 0.2, 0.6], fov: 26 },
};

export const FLEET = { f35a: F35_CFG };
export const FLEET_ORDER = ['f35a'];
export function getAircraftConfig() { return F35_CFG; }
