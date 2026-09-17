// Uçak filosu: her uçağın modeli, aerodinamiği, kontrol kanunu, kameraları, sesi ve arayüz davranışı
// tek bir yapılandırma nesnesinde toplanır. Yeni uçak eklemek için buraya bir girdi eklemek yeterlidir.
import * as THREE from 'three';
import { F35A, F35 } from './aircraft.js';
import { A321neo, A321 } from './a321.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// F-35A Lightning II — mevcut davranış birebir korunur.
const F35_AERO = {
  massEmpty: 13300, fuel: 8300,
  S: 42.7, span: 10.7, chord: 4.0,
  Ixx: 5.0e4, Iyy: 2.8e5, Izz: 3.2e5,
  thrustMil: 125000, thrustAB: 191000, idleFrac: 0.045,
  // Düşük baypaslı askeri turbofan: ram basıncı Mach ile itkiyi artırır
  thrustRhoExp: 0.72, thrustRam: 0.18, thrustFloor: 0, sfcMil: 2.4, sfcAB: 8.5,
  spool: { up: 3.5, idleLag: 0.65, down: 2.0 },
  CLa: 4.0, CL0: 0.04, CLmax: 1.72,
  alphaLin: 16 * DEG, alphaMax: 24 * DEG, alphaDrop: 34 * DEG, alphaLimit: 25 * DEG,
  CD0: 0.016, e: 0.78, eFlaps: 0.70, CDgear: 0.024, CDflaps: 0.018,
  CLflaps: 0.5,
  gMax: 9, gMin: -3,
  rollRateMax: 250 * DEG, pitchRateMax: 50 * DEG, yawRateMax: 18 * DEG,
  // Moment katsayıları
  Cm0: 0.015, Cma: -0.35, Cmq: -9.0, CmFlaps: -0.05, CmStall: -2.2,
  Clb: -0.06, Clp: -0.36, Clr: 0.10,
  Cnb: 0.10, Cnr: -0.34, Cnp: -0.03,
  CmCtl: 0.50, ClCtl: 0.062, CnCtl: 0.040,
};

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
  aero: F35_AERO,
  law: {
    Kq0: 3.5, KqA: 4.5, Kp0: 5, KpA: 7, Kr0: 2.5, KrA: 3.5,
    zeta: 0.9, prefilter: 0.12, rollFilter: 0.06, actuator: 0.04, stickPow: 1.5,
    qAuth: 9000, qRoll: 6000, qBlend: [2500, 7000],
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
const A321_AERO = {
  massEmpty: 62000, fuel: 18000,            // ~80 t kalkış ağırlığı
  S: 128, span: 35.8, chord: 4.29,
  Ixx: 2.3e6, Iyy: 8.5e6, Izz: 8.0e6,   // ~80 t kalkış ağırlığında atalet momentleri
  thrustMil: 286000, thrustAB: 286000, idleFrac: 0.05,   // 2 x CFM LEAP-1A33 (143 kN, statik)
  // Yüksek baypaslı turbofan: net itki hızla düşer (M0.23'te ~%78, M0.5'te ~%53), yüksek Mach'ta tabana oturur
  thrustRhoExp: 0.75, thrustRam: -0.95, thrustFloor: 0.34, sfcMil: 2.1, sfcAB: 0,
  // Rölantiden tam güce ~8 s: LEAP gibi büyük baypaslı motorun karakteristik gecikmesi
  spool: { up: 7.0, idleLag: 0.75, down: 4.0 },
  // CL0 kanadın ~5° oturma açısını temsil eder: gövde burnu seyirde yataya yakın durur, yaklaşmada ~4° yukarıdadır
  CLa: 5.4, CL0: 0.45, CLmax: 1.55,
  // alphaLin/Max/Drop sıfır taşıma açısından ölçülür (a0 = -CL0/CLa = -4,8°), alphaLimit/alphaWarn gövde açısıdır
  alphaLin: 14 * DEG, alphaMax: 16.8 * DEG, alphaDrop: 28 * DEG, alphaLimit: 10.5 * DEG,
  CD0: 0.021, e: 0.80, eFlaps: 0.72, CDgear: 0.022, CDflaps: 0.085,
  CLflaps: 0.85, CLslats: 0.25, alphaSlat: 4.5 * DEG,
  CDspoiler: 0.075, CLspoiler: 0.42, CmSpoiler: -0.06,
  gMax: 2.5, gMin: 0.0,
  rollRateMax: 15 * DEG, pitchRateMax: 8 * DEG, yawRateMax: 5 * DEG,
  Cm0: 0.028, Cma: -1.15, Cmq: -24.0, CmFlaps: -0.13, CmStall: -1.4,
  Clb: -0.09, Clp: -0.58, Clr: 0.13,
  Cnb: 0.16, Cnr: -0.28, Cnp: -0.05,
  // Kontrol gücü (δ=1'de moment katsayısı). Yaklaşma hızında ~7,7°/s² yunuslama ivmesi verir:
  // ağır bir jet için gerçekçi. Daha düşük değerde flare sırasında asansör doyuma giriyordu.
  CmCtl: 0.55, ClCtl: 0.045, CnCtl: 0.045,
};

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
