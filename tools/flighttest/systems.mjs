// v5.1 sistem testleri: yakıt bitince motor sönmesi ve uçuş uyarıları (alerts.js).
// Gerçek FlightModel + FlightAlerts, düz ya da basamaklı test dünyasında.
import { load, flatWorld, makeAir, run } from './sim.mjs';

const M = await load();
const { FlightAlerts, FUEL_LOW_KG } = await import(M.root + '/js/alerts.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const fmt = (v, k = 1) => (Number.isFinite(v) ? v.toFixed(k) : String(v));
const hold = () => ({ pitch: 0, roll: 0, yaw: 0 });

// ---- 1. Yakıt bitince motor söner ----
{
  const fm = makeAir(M, { alt: 3000, V: 220, throttle: 1, ab: true });
  const T0 = fm.engine_.thrust;
  fm.fuel = 6;   // ~0,6 s tam AB
  run(M, fm, { seconds: 1.5, fps: 60, throttle: 1, ab: true, stick: hold });
  const dry = fm.fuel === 0;
  run(M, fm, { seconds: 8, fps: 60, throttle: 1, ab: true, stick: hold });
  const e = fm.engine_;
  check(dry && e.thrust < 0.02 * T0 && e.fuelFlow === 0 && e.run < 0.02 && fm.telemetry.flameout,
    `fuel exhausted at full AB: thrust ${fmt(T0 / 1000)} kN -> ${fmt(e.thrust / 1000, 2)} kN after 8 s, fuel flow ${fmt(e.fuelFlow, 2)} kg/s, burn ${fmt(e.run, 3)}`);
  check(fm.engine_.ab < 0.01 && fm.telemetry.engine < 0.2, `afterburner and spool wind down without fuel (AB ${fmt(fm.engine_.ab, 3)}, N ${fmt(fm.telemetry.engine, 2)})`);
}
{
  // Yakıt varken davranış aynı (regresyon): aynı başlangıçtan 10 s tam AB
  const a = makeAir(M, { alt: 3000, V: 220, throttle: 1, ab: true });
  run(M, a, { seconds: 10, fps: 60, throttle: 1, ab: true, stick: hold });
  check(a.engine_.run === 1 && a.engine_.thrust > 150000 && !a.telemetry.flameout,
    `with fuel the engine is unaffected: run ${a.engine_.run}, thrust ${fmt(a.engine_.thrust / 1000)} kN, fuel ${fmt(a.fuel, 0)} kg`);
}
{
  // Sönmüş motorla süzülme: sabit irtifada hız düşer (yapay itki yok), uçak kontrol edilebilir kalır
  const fm = makeAir(M, { alt: 4000, V: 180, throttle: 0.8, fuel: 0 });
  const v0 = fm.vel.length();
  run(M, fm, { seconds: 20, fps: 60, throttle: 1, ab: true, stick: hold });
  check(!fm.crashed && fm.vel.length() < v0 && Number.isFinite(fm.pos.y),
    `dead-stick glide: ${fmt(v0 * 1.944, 0)} -> ${fmt(fm.vel.length() * 1.944, 0)} kt TAS in 20 s, no crash, no NaN`);
}

// ---- 2. Uyarılar ----
const evalAlerts = (fm, world, seconds = 1.2) => {
  // Telemetri bu başlangıç durumundan bir kare (tek fizik adımı) ile tazelenir
  fm.step(M.FIXED_DT);
  const A = new FlightAlerts();
  const seen = new Set();
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    A.update(dt, fm, world);
    for (const e of A.events) seen.add(e);
  }
  return { A, seen };
};
{
  const W = flatWorld();
  const fm = makeAir(M, { alt: 3000, V: 230, throttle: 0.85 });
  const { A, seen } = evalAlerts(fm, W);
  check(!A.pullUp && !A.terrain && !A.fuelLow && !A.flameout && seen.size === 0, `level cruise at 3000 m: no alerts (TTI ${A.tti})`);
}
{
  // 35° dalış, 400 m, 230 m/s: 1,6 s tepki + 5 g çekişle ~440 m kaybedilir -> PULL UP
  const W = flatWorld();
  const fm = makeAir(M, { alt: 400, V: 230, gammaDeg: -35, settle: 0, trim: false });
  const { A, seen } = evalAlerts(fm, W);
  check(A.pullUp && seen.has('pullUp'), `35° dive from 400 m at 230 m/s: PULL UP (straight-line impact in ${fmt(A.tti)} s)`);
}
{
  // 25° dalış, 520 m, 220 m/s: 1,6 s içinde çekilirse ~260 m kayıp (toparlanır), 5 s beklenirse ~580 m
  // -> TERRAIN, PULL UP değil
  const W = flatWorld();
  const fm = makeAir(M, { alt: 520, V: 220, gammaDeg: -25, settle: 0, trim: false });
  const { A } = evalAlerts(fm, W);
  check(A.terrain && !A.pullUp, `25° dive from 520 m at 220 m/s (recoverable): TERRAIN caution, not PULL UP`);
}
{
  const W = flatWorld();
  const fm = makeAir(M, { alt: 1500, V: 220, gammaDeg: -25, settle: 0, trim: false });
  const { A } = evalAlerts(fm, W);
  check(!A.terrain && !A.pullUp, `25° dive from 1500 m: no alert yet (straight-line impact ${fmt(A.tti)} s, ample room to recover)`);
}
{
  // Tepeye doğru düz uçuş: 250 m'de doğuya; 600 m'lik sırt 1,2 km ilerde -> PULL UP; 400 m'lik sırt 1,6 km -> TERRAIN
  const fmR = (ridgeX, h) => {
    const W = { halfSize: 36000, heightAt: (x) => (x > ridgeX ? h : 0), hitsBuilding: () => false };
    const fm = makeAir(M, { alt: 250, V: 220, hdg: 90, settle: 0 });
    fm.pos.x = 0;
    return evalAlerts(fm, W).A;
  };
  const a = fmR(1200, 600), b = fmR(1600, 400), c = fmR(6000, 400);
  check(a.pullUp, 'level at 250 m toward a 600 m ridge 1.2 km ahead at 220 m/s: PULL UP');
  check(b.terrain && !b.pullUp, 'level at 250 m toward a 400 m ridge 1.6 km ahead: TERRAIN caution');
  check(!c.terrain && !c.pullUp, 'same ridge 6 km ahead: no alert yet');
}
{
  // Alçak seviye deniz uçuşu: 40 m, düz: uyarı yok (alçak uçuş serbesttir)
  const W = flatWorld();
  const fm = makeAir(M, { alt: 40, V: 220, settle: 0 });
  const { A } = evalAlerts(fm, W);
  check(!A.terrain && !A.pullUp, 'level low pass at 40 m over flat ground: no nuisance alert');
}
{
  // Ters uçuşta alçalma: önce yatış düzeltilmeli (180° / 150°/s = 1,2 s) -> PULL UP daha erken
  const W = flatWorld();
  const up = makeAir(M, { alt: 200, V: 220, gammaDeg: -15, settle: 0, trim: false });
  const inv = makeAir(M, { alt: 200, V: 220, gammaDeg: -15, settle: 0, trim: false });
  inv.quat.multiply(new M.THREE.Quaternion().setFromAxisAngle(new M.THREE.Vector3(0, 0, 1), Math.PI));
  const a = evalAlerts(up, W).A, b = evalAlerts(inv, W).A;
  check(!a.pullUp && b.pullUp, `15° descent at 200 m: upright -> ${a.pullUp ? 'PULL UP' : a.terrain ? 'TERRAIN' : 'none'}, inverted (roll-out first) -> ${b.pullUp ? 'PULL UP' : b.terrain ? 'TERRAIN' : 'none'}`);
}
{
  // Yapı: segmentHit ile yüksek kule (çekirdek haritadaki gökdelen gibi); 200 m/s'de 650 m = 3,3 s, 1200 m = 6 s
  const tower = (X) => {
    const W = { halfSize: 36000, heightAt: () => 0, hitsBuilding: () => false,
      segmentHit: (a, b) => { // x = X m'de 300 m yüksekliğinde duvar
        if ((a.x - X) * (b.x - X) > 0) return -1; const t = (X - a.x) / (b.x - a.x); const y = a.y + (b.y - a.y) * t; return y < 300 ? t : -1; } };
    const fm = makeAir(M, { alt: 150, V: 200, hdg: 90, settle: 0 });
    fm.pos.x = 0;
    return evalAlerts(fm, W).A;
  };
  const near = tower(650), far = tower(1200);
  check(near.pullUp && far.terrain && !far.pullUp, `300 m tower ahead at 150 m: TERRAIN at 1.2 km, PULL UP at 650 m (obstacle query)`);
}
{
  // İniş: takım ve flap aşağı, 3° süzülüş, 70 m/s, 60 m: uyarı YOK
  const W = flatWorld();
  const fm = makeAir(M, { alt: 60, V: 72, gammaDeg: -3, gear: 1, flaps: 1, throttle: 0.5, settle: 0 });
  const { A, seen } = evalAlerts(fm, W, 3);
  check(!A.pullUp && !A.terrain && !seen.has('pullUp'), `3° ILS-like final with gear and flaps down at 200 ft: no PULL UP / TERRAIN`);
}
{
  // Takım aşağı ama dik dalış: iniş düzeni sayılmaz
  const W = flatWorld();
  const fm = makeAir(M, { alt: 180, V: 150, gammaDeg: -30, gear: 1, settle: 0, trim: false });
  const { A } = evalAlerts(fm, W);
  check(A.pullUp, `gear down but 30° dive from 180 m: still PULL UP (not treated as a landing)`);
}
{
  // Yakıt uyarısı bir kez, histerezisli
  const W = flatWorld();
  const fm = makeAir(M, { alt: 3000, V: 230, throttle: 0.85, fuel: FUEL_LOW_KG + 2 });
  const A = new FlightAlerts();
  let n = 0;
  for (let i = 0; i < 600; i++) {
    fm.fuel = FUEL_LOW_KG + 2 - i * 0.01 + (i % 2) * 0.03;   // eşik çevresinde dalgalanan ölçüm
    A.update(1 / 60, fm, W);
    n += A.events.filter((e) => e === 'fuelLow').length;
  }
  check(n === 1 && A.fuelLow, `LOW FUEL fires once below ${FUEL_LOW_KG} kg (events: ${n})`);
  fm.fuel = 0; A.update(1 / 60, fm, W);
  check(A.flameout && A.events.includes('flameout') && !A.fuelLow, 'ENGINE OUT replaces LOW FUEL when the tanks are dry');
}

console.log(fails ? `\n${fails} system check(s) FAILED` : '\nall system checks passed');
process.exit(fails ? 1 : 0);
