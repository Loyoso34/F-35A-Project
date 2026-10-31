// Gösterge doğruluğu: IAS (=CAS), EAS, TAS, yer hızı, Mach, dikey hız, yön, G, AoA, radar irtifa.
//   node --import ./register.mjs instruments.mjs
// Referanslar: standart pitot bağıntıları (izantropik / Rayleigh) ve ISA; elle hesaplanmış
// değerler yorumlarda.
import { load, makeAir, run, fmt } from './sim.mjs';
const M = await load();
const A = await import(M.root + '/js/atmosphere.js');
const KT = 1.943844, FT = 3.28084, DEG = Math.PI / 180;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// ---- CAS bağıntısı ----
{
  const sl = A.atmosphere(0);
  let maxSl = 0;
  for (let v = 30; v <= 330; v += 10) maxSl = Math.max(maxSl, Math.abs(A.calibratedAirspeed(v, sl) - v));
  check(maxSl < 1e-6, `ISA sea level: CAS = TAS for 30..330 m/s (max diff ${maxSl.toExponential(1)} m/s)`);
  // Tropopoz (11 km), M1,0: qc = p(1,2^3,5 − 1) = 0,22336·p0·0,89293 = 0,19945·p0
  // CAS = a0·√(5·((1,19945)^(2/7) − 1)) = 340,294·0,51648 = 175,76 m/s = 341,7 kt (elle)
  const tr = A.atmosphere(11000), cas = A.calibratedAirspeed(tr.a, tr) * KT;
  check(Math.abs(cas - 341.7) < 0.5, `M1.0 at the tropopause: ${fmt(cas, 1)} KCAS (hand calculation 341.7)`);
  // M = 1'de ses altı ve Rayleigh kolları süreklidir
  const lo = A.calibratedAirspeed(tr.a * (1 - 1e-7), tr), hi = A.calibratedAirspeed(tr.a * (1 + 1e-7), tr);
  check(Math.abs(hi - lo) < 1e-3, 'subsonic and Rayleigh pitot branches join continuously at M = 1');
  const fl300 = A.atmosphere(9144), e = 0.8 * fl300.a * Math.sqrt(fl300.sigma) * KT, c = A.calibratedAirspeed(0.8 * fl300.a, fl300) * KT;
  check(c > e + 10, `FL300 M0.80: CAS ${fmt(c, 1)} kt > EAS ${fmt(e, 1)} kt (compressibility; the old IAS read EAS)`);
}

// ---- Uçuşta telemetri ----
{
  const fm = makeAir(M, { alt: 9144, V: 0.8 * A.atmosphere(9144).a, hdg: 90, throttle: 0.9 });
  run(M, fm, { seconds: 2, fps: 60, stick: () => ({ pitch: 0, roll: 0, yaw: 0 }) });
  const T = fm.telemetry, atm = A.atmosphere(fm.pos.y);
  const cas = A.calibratedAirspeed(T.tas, atm) * KT;
  check(Math.abs(T.kias - cas) < 0.01 && Math.abs(T.mach - T.tas / atm.a) < 1e-6 && Math.abs(T.ktas - T.tas * KT) < 1e-6,
    `FL300 cruise: IAS ${fmt(T.kias, 1)} = CAS, TAS ${fmt(T.ktas, 1)} kt, EAS ${fmt(T.keas, 1)} kt, M ${fmt(T.mach, 3)}`);
  check(Math.abs(T.g - 1) < 0.08 && T.alpha > 0 && T.alpha < 8 && Math.abs(T.heading - 90) < 1,
    `level cruise: ${fmt(T.g, 2)} g, AoA ${fmt(T.alpha, 2)}°, heading ${fmt(T.heading, 1)}°`);
}
{
  // Tırmanış: yer hızı YATAY bileşendir (eskiden 3B hız boyu)
  const fm = makeAir(M, { alt: 3000, V: 200, hdg: 0, gammaDeg: 25, throttle: 1, ab: true, settle: 0 });
  run(M, fm, { seconds: 0.5, fps: 60, stick: () => ({ pitch: 0, roll: 0, yaw: 0 }) });
  fm.wind = { dirDeg: 0, kt: 0, gustKt: 0, shear: 0 };
  run(M, fm, { seconds: 0.1, fps: 60, stick: () => ({ pitch: 0, roll: 0, yaw: 0 }) });
  const T = fm.telemetry, v = fm.vel;
  const gam = Math.atan2(v.y, Math.hypot(v.x, v.z)) / DEG;
  check(Math.abs(T.gsKt - Math.hypot(v.x, v.z) * KT) < 1e-6 && Math.abs(T.gsKt - v.length() * KT * Math.cos(gam * DEG)) < 0.01 && T.gsKt < T.ktas - 5,
    `climb at ${fmt(gam, 1)}° flight path: GS ${fmt(T.gsKt, 1)} kt = TAS·cos γ (TAS ${fmt(T.ktas, 1)} kt)`);
  check(Math.abs(T.vsFpm - v.y * FT * 60) < 1e-6 && T.vsFpm > 10000, `vertical speed ${fmt(T.vsFpm, 0)} ft/min = vertical velocity`);
}
{
  // 30 kt karşı rüzgâr: GS ≈ TAS − 30 kt (rüzgâr yönü ±8° yavaş salınır)
  const fm = makeAir(M, { alt: 1500, V: 150, hdg: 90, throttle: 0.7, settle: 0 });
  fm.wind = { dirDeg: 90, kt: 30, gustKt: 0, shear: 0 };
  run(M, fm, { seconds: 20, fps: 60, stick: () => ({ pitch: 0, roll: 0, yaw: 0 }) });
  const T = fm.telemetry;
  check(Math.abs(T.ktas - T.gsKt - 30) < 2 && Math.abs(((T.trackDeg - 90 + 540) % 360) - 180) < 6,
    `30 kt headwind: TAS ${fmt(T.ktas, 1)} − GS ${fmt(T.gsKt, 1)} = ${fmt(T.ktas - T.gsKt, 1)} kt, track ${fmt(T.trackDeg, 1)}°`);
}
{
  // Radar irtifa: ana teker tabanından zemine
  const W = { halfSize: 36000, heightAt: () => 120, hitsBuilding: () => false };
  const fm = new M.FlightModel(W, M.getAircraftConfig('f35a'));
  fm.reset({ x: 0, z: 0, hdg: 0 });
  run(M, fm, { seconds: 2, fps: 60, throttle: 0, stick: () => ({ pitch: 0, roll: 0, yaw: 0 }) });
  const T = fm.telemetry;
  check(fm.onGround && T.aglFt < 0.5 && Math.abs(T.altFt - (120 + 4) * FT) < 12, `on a 124 m MSL plateau: RA ${fmt(T.aglFt, 2)} ft, MSL ${fmt(T.altFt, 0)} ft (= field elevation + gear height)`);
}

console.log(fails ? `\n${fails} instrument check(s) FAILED` : '\nall instrument checks passed');
process.exit(fails ? 1 : 0);
