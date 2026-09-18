// Uçak filosu: her uçağın modeli, aerodinamiği, kontrol kanunu, kameraları, sesi ve arayüz davranışı
// tek bir yapılandırma nesnesinde toplanır. Yeni uçak eklemek için buraya bir girdi eklemek yeterlidir.
import * as THREE from 'three';
import { F35A, F35 } from './aircraft.js';
import { A321neo, A321 } from './a321.js';
import { F35A_AERO, A321_AERO } from './aerodata.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
const F35_CFG = {
  id: 'f35a',
  name: 'F-35A Lightning II',
  sub: 'Tek kişilik, 5. nesil çok rollü savaş uçağı',
  specs: ['Uzunluk 15,7 m', 'Açıklık 10,7 m', 'Maks. Mach 1,6'],
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
  ground: { steerMax: 55 * DEG, steerV: 45, tireGrip: 0.45, rotQ: [2200, 5200], rotRate: 18 * DEG, pushRate: 10 * DEG, maxPitch: 13 * DEG, rollMu: [0.02, 0.09], brakeMu: [0.5, 0.25] },
  limits: { alphaWarn: 19 * DEG, hardLandVs: -6.5, landRoll: 12 * DEG, groundRoll: 15 * DEG, landPitch: [-4 * DEG, 15 * DEG], offRunwayV: [55, 60] },
  systems: { flapDetents: [0, 1], flapNames: ['0', 'İNİŞ'], flapRate: 1 / 3, slatLead: 0, gearRate: 1 / 6, spoilers: null, reverse: 0 },
  cameras: {
    cockpitEye: [F35.pilotEye.x, F35.pilotEye.y, F35.pilotEye.z], cockpitFov: 72, cockpitNear: 0.25,
    chase: { dist: [21, 30], vRef: 320, up: 2.8, ahead: 70, lookUp: 1.5, fov: 58 },
    orbit: { dist: 28, min: 12, max: 70, lookUp: 1, fov: 50 },
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
  sub: 'Dar gövdeli, iki motorlu yolcu uçağı',
  specs: ['Uzunluk 44,5 m', 'Açıklık 35,8 m', 'MTOW 97 t'],
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
  ground: { steerMax: 45 * DEG, steerV: 40, tireGrip: 0.25, rotQ: [1200, 3100], rotRate: 6 * DEG, pushRate: 3.5 * DEG, maxPitch: 11 * DEG, rollMu: [0.015, 0.075], brakeMu: [0.42, 0.22] },
  limits: { alphaWarn: 9.5 * DEG, hardLandVs: -3.6, landRoll: 8 * DEG, groundRoll: 10 * DEG, landPitch: [-2 * DEG, 11 * DEG], offRunwayV: [40, 45] },
  systems: {
    flapDetents: [0, 0.25, 0.5, 0.75, 1], flapNames: ['0', '1', '2', '3', 'FULL'], flapRate: 1 / 9, slatLead: 1.6, gearRate: 1 / 11,
    // airFrac: havada hız freni yarım açılır (A320 ailesinde olduğu gibi), yerde tam yer spoyleri
    spoilers: { rate: 2.2, groundAuto: true, airFrac: 0.5 }, reverse: 0.38,
  },
  cameras: {
    cockpitEye: [A321.pilotEye.x, A321.pilotEye.y, A321.pilotEye.z], cockpitFov: 70, cockpitNear: 0.25,
    chase: { dist: [58, 86], vRef: 260, up: 8.5, ahead: 150, lookUp: 2.0, fov: 55 },
    orbit: { dist: 78, min: 32, max: 220, lookUp: 1.5, fov: 50 },
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

export const FLEET = { f35a: F35_CFG, a321: A321_CFG };
export const FLEET_ORDER = ['f35a', 'a321'];
export function getAircraftConfig(id) { return FLEET[id] || FLEET.f35a; }
