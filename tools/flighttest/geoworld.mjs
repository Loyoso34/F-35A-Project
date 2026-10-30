// Gerçek dünya bölgesi (Bodrum / LTFE) testleri: GERÇEK veri (geo/bodrum) ve GERÇEK fizik.
//   node --import ./register.mjs geoworld.mjs
// Denetimler: havaalanı verisi ve datumlar, arazi sürekliliği, ince DEM yüklenince ışınlanma
// olmaması, pistte rölantide kayma olmaması, 10L'den kalkış ve 28R'ye iniş (yüzey = pist).
import { readFileSync } from 'node:fs';
import { decodePNG } from './png.mjs';
import { load, run, fmt } from './sim.mjs';
const M = await load();
const THREE = M.THREE;
const G = await import(M.root + '/js/geo.js');
const GW = await import(M.root + '/js/geoworld.js');
const GT = await import(M.root + '/js/geoterrain.js');
const R = await import(M.root + '/js/georegion.js');
const DEG = Math.PI / 180, FT = 0.3048;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

const root = new URL('./geo/bodrum/', 'file://' + M.root + '/');
const io = {
  base: root.href,
  fetch: async (u) => readFileSync(new URL(u)),
  fetchJSON: async (u) => JSON.parse(readFileSync(new URL(u), 'utf8')),
  decodeRGBA: async (b) => decodePNG(b),
  clock: () => 1e6,
};
async function makeWorld() {
  const w = new GW.GeoWorld(new THREE.Scene(), null, 'medium', io);
  await w.loadManifest();
  await w.buildGeoTerrain();
  return w;
}
const W = await makeWorld();
const L = R.LTFE;

// ---- Havaalanı verisi ve datumlar ----
{
  const r0 = L.runways[0], r1 = L.runways[1];
  check(Math.abs(r0.len - 3000) < 1 && Math.abs(r1.len - 2940) < 1, `runway lengths from threshold coordinates: ${fmt(r0.len, 1)} m / ${fmt(r1.len, 1)} m (published 3000 / 2940)`);
  const sep = Math.abs(r1.vA - r0.vA);
  check(Math.abs(sep - 185) < 3, `parallel runway centreline separation ${fmt(sep, 1)} m (imagery: 185 m)`);
  const mag = (r0.hdg - W.magVar + 360) % 360;
  check(Math.round(mag / 10) === 10 && Math.round(((mag + 180) % 360) / 10) === 28, `true ${fmt(r0.hdg, 2)}° − WMM ${W.magVar}° = ${fmt(mag, 1)}° magnetic -> 10/28 (published)`);
  for (const r of L.runways) for (const [i, e] of r.ends.entries()) {
    const T = i === 0 ? r.A : r.B;
    const h = W.heightAt(T.x, T.z) - G.MSL_Y;
    check(Math.abs(h - e.elevFt * FT) < 0.01, `${e.num}${e.suffix} threshold elevation ${fmt(h, 2)} m MSL = ${e.elevFt} ft`);
  }
  const arp = W.geoInfo(new THREE.Vector3(L.x, G.MSL_Y + 6.4, L.z), 0);
  check(Math.abs(arp.lat - L.arp.lat) < 1e-9 && Math.abs(arp.lon - L.arp.lon) < 1e-9, 'ARP round trip through the local TM frame');
  check(Math.abs(arp.hMsl - 6.4) < 1e-9 && arp.geoidN > 30 && arp.geoidN < 38 && Math.abs(arp.hEll - arp.hMsl - arp.geoidN) < 1e-9,
    `datums kept apart at the ARP: MSL ${fmt(arp.hMsl, 1)} m, ellipsoid ${fmt(arp.hEll, 1)} m (EGM96 N ${fmt(arp.geoidN, 2)} m), AGL ${fmt(arp.hAgl, 2)} m`);
}

// ---- Yüzey tipleri ----
{
  const r0 = L.runways[0], r1 = L.runways[1];
  check(W.surfaceTypeAt(r0.cx, r0.cz) === 'runway' && W.surfaceTypeAt(r1.cx, r1.cz) === 'runway', 'both runway centres are runway surface');
  const mx = (r0.cx + r1.cx) / 2, mz = (r0.cz + r1.cz) / 2;
  check(W.surfaceTypeAt(mx, mz) === 'grass', 'between the runways: grass');
  const sea = W.frame.toLocal(37.20, 27.55);
  check(W.surfaceTypeAt(sea.x, sea.z) === 'water', 'Gulf of Güllük (37.20 N, 27.55 E) is water');
  const land = W.frame.toLocal(37.31, 27.78);
  check(W.surfaceTypeAt(land.x, land.z) === 'grass', 'Milas town area is land');
}

// ---- Arazi sürekliliği (düzleştirme kenarı, kıyı, seviye geçişi) ----
{
  let maxStep = 0, at = null;
  for (const [lat0, lon0, lat1, lon1] of [[37.30, 27.55, 37.20, 27.78], [37.25, 27.40, 37.25, 27.90]]) {
    let prev = null;
    for (let k = 0; k <= 4000; k++) {
      const t = k / 4000, p = W.frame.toLocal(lat0 + (lat1 - lat0) * t, lon0 + (lon1 - lon0) * t);
      const h = W.heightAt(p.x, p.z);
      if (prev !== null) { const s = Math.abs(h - prev.h) / Math.max(0.5, Math.hypot(p.x - prev.x, p.z - prev.z)); if (s > maxStep) { maxStep = s; at = p; } }
      prev = { h, x: p.x, z: p.z };
    }
  }
  check(maxStep < 1.6, `terrain is continuous along 2 × 4000 samples across the aerodrome and coast (max slope ${fmt(maxStep, 2)})`);
}

// ---- Işınlanma önlemi: ince DEM karosu yüklenince yükseklik yumuşakça geçer ----
{
  let now = 0;
  const man = W.man;
  const T = new GT.GeoTerrain({ frame: W.frame, manifest: man, base: io.base, fetch: io.fetch, decodeRGBA: io.decodeRGBA, clock: () => now });
  await T.loadCoarse();
  const p = W.frame.toLocal(37.40, 27.60);           // tepelik arazi
  const hCoarse = T.mslAt(p.x, p.z);
  await T.ensureArea(p.x, p.z, 100);
  const t0 = now, h0 = T.mslAt(p.x, p.z);
  now = t0 + 0.6; const hMid = T.mslAt(p.x, p.z);
  now = t0 + 5; const hFine = T.mslAt(p.x, p.z);
  check(Math.abs(h0 - hCoarse) < 1e-6 && Math.abs(hFine - hCoarse) > 0.5 && Math.min(hCoarse, hFine) < hMid && hMid < Math.max(hCoarse, hFine),
    `fine DEM arrival blends ${fmt(hCoarse, 1)} m -> ${fmt(hMid, 1)} m -> ${fmt(hFine, 1)} m (no step under the aircraft)`);
}

// ---- Fizik: rölantide pistte kayma yok ----
const cfg = M.getAircraftConfig('f35a');
{
  const fm = new M.FlightModel(W, cfg);
  fm.reset(W.spawnPose('ltfe-10l'));
  const x0 = fm.pos.clone();
  run(M, fm, { seconds: 30, fps: 60, throttle: 0, stick: () => ({ pitch: 0, roll: 0, yaw: 0 }) });
  const d = fm.pos.distanceTo(x0);
  check(!fm.crashed && fm.onGround && d < 0.1, `parked on 10L (0.12 % slope, 9 kt wind) 30 s at idle: moved ${fmt(d, 3)} m, AGL ${fmt(fm.telemetry.aglFt, 2)} ft`);
}

// ---- Kalkış: 10L, tam art yakıcı ----
{
  const fm = new M.FlightModel(W, cfg);
  fm.reset(W.spawnPose('ltfe-10l'));
  const r0 = L.runways[0];
  let lift = null, crashed = false, surfAtLift = null, air = false;
  run(M, fm, { seconds: 50, fps: 60, throttle: 1, ab: true, stick: (t, f) => {
    const T = f.telemetry;
    if (!f.onGround) air = true;
    if (!f.onGround && lift === null) { lift = { kias: T.kias, x: f.pos.x, z: f.pos.z }; surfAtLift = W.surfaceTypeAt(f.pos.x, f.pos.z); }
    if (T.aglFt > 300 && f.gearCmd > 0.5) f.toggleGear();
    if (f.onGround && !air) return { pitch: T.kias >= 150 ? 0.8 : 0 };
    return { pitch: Math.max(-0.5, Math.min(0.6, (12 - T.pitch) * 0.08 - T.q * 0.03)) };
  } });
  crashed = fm.crashed;
  const o = { u: 0, v: 0 }; if (lift) W.rwLocal(r0, lift.x, lift.z, o);
  const roll = lift ? o.u + r0.len / 2 : NaN;
  check(!crashed && lift && surfAtLift === 'runway' && roll < r0.len && fm.telemetry.altFt > 1500,
    `takeoff 10L: lift-off ${fmt(lift && lift.kias, 0)} KIAS after ${fmt(roll, 0)} m of 3000 m, climbing through ${fmt(fm.telemetry.altFt, 0)} ft MSL`);
}

// ---- İniş: 28R, 3° yaklaşma, flap + takım ----
{
  const r0 = L.runways[0];
  const fm = new M.FlightModel(W, cfg);
  fm.wind = { dirDeg: 290, kt: 6, gustKt: 0, shear: 0.22 };
  // 28R: B ucu (doğu) -> A ucu (batı). Teker koyma hedefi eşikten 400 m içeride.
  const dir = { x: -r0.ux, z: -r0.uz }, T28 = r0.B;
  const td = { x: T28.x + dir.x * 400, z: T28.z + dir.z * 400 };
  const dist = 2600, V = 145 / 1.943844, gam = -3 * DEG;
  const hdg = (r0.hdg + 180) % 360;
  const gy = W.heightAt(td.x, td.z);
  fm.reset({ x: td.x - dir.x * dist, z: td.z - dir.z * dist, hdg });
  fm.pos.y = gy - fm.geom.wheelBottomY + dist * Math.tan(-gam);
  // Trim: AoA ~ 7° (yaklaşma), hız yol boyunca
  fm.quat.setFromEuler(new THREE.Euler(4 * DEG, -hdg * DEG, 0, 'YXZ'));
  fm.vel.set(dir.x * Math.cos(gam), Math.sin(gam), dir.z * Math.cos(gam)).multiplyScalar(V);
  fm.onGround = false; fm.wasOnGround = false; fm.gearCmd = 1; fm.gearPos = 1;
  fm.setFlapIndex(fm.sys.flapNames.length - 1); fm.flapsPos = fm.flapsCmd;
  fm.engine_.n = 0.55; fm.throttle = 0.55;
  let thr = 0.55, tdInfo = null, bounces = 0, prevG = false, prevVs = 0;
  const pilot = (f, vsT) => {
    const T = f.telemetry, Vv = Math.max(30, f.vel.length());
    const gDes = Math.asin(Math.max(-0.5, Math.min(0.5, vsT / Vv))) / DEG;
    return Math.max(-0.6, Math.min(0.6, (gDes + T.alpha - T.pitch) * 0.07 - T.q * 0.04));
  };
  // Yanal: pist eksenine dönük yönelim tutan basit dümen/yatış pilotu
  const lateral = (f) => {
    const o = { u: 0, v: 0 }; W.rwLocal(r0, f.pos.x, f.pos.z, o);
    const T = f.telemetry, err = ((T.heading - hdg + 540) % 360) - 180;
    // 28R yönünde v ekseni ters: sağ = −v
    const rollDes = Math.max(-10, Math.min(10, -err * 1.2 + (o.v) * 0.25));
    return { roll: Math.max(-0.4, Math.min(0.4, (rollDes - T.roll) * 0.05 - T.p * 0.01)), yaw: 0 };
  };
  run(M, fm, { seconds: 120, fps: 60, throttle: null, log: (r) => {
    if (r.onGround && !prevG) { if (tdInfo) bounces++; else tdInfo = { vs: prevVs, x: fm.pos.x, z: fm.pos.z, kias: r.kias }; }
    if (!r.onGround) prevVs = r.vs;
    prevG = r.onGround;
  }, stick: (t, f) => {
    const agl = f.telemetry.aglFt * FT;
    const lat = lateral(f);
    if (f.onGround || tdInfo) {
      // Rulman: burun indikten sonra fren (anti-skid), burun tekeriyle eksen tutma
      f.throttle = 0; f.brakes = f.telemetry.kias < 140 && f.telemetry.pitch < 1.5;
      const o = { u: 0, v: 0 }; W.rwLocal(r0, f.pos.x, f.pos.z, o);
      const err = ((f.telemetry.heading - hdg + 540) % 360) - 180;
      return { pitch: f.telemetry.pitch > 1 ? -0.15 : 0, roll: 0, yaw: Math.max(-1, Math.min(1, -err * 0.25 + o.v * 0.04)) };
    }
    const flare = agl < 11;
    if (agl < 7) f.throttle = Math.max(0, f.throttle - 0.5 / 60); else { thr = Math.max(0.08, Math.min(1, thr + (145 - f.telemetry.kias) * 0.04 / 60)); f.throttle = thr; }
    const vsT = flare ? -0.55 - 0.10 * agl : Math.max(-4.2, -0.07 * agl - 0.4);
    return { pitch: pilot(f, vsT), roll: lat.roll, yaw: 0 };
  } });
  const surfTd = tdInfo ? W.surfaceTypeAt(tdInfo.x, tdInfo.z) : null;
  const stopSurf = W.surfaceTypeAt(fm.pos.x, fm.pos.z);
  console.log(`      (rollout end: ${fmt(fm.vel.length(), 2)} m/s, brakes ${fm.brakes}, onGround ${fm.onGround}, throttle ${fmt(fm.throttle, 2)} engine ${fmt(fm.engine, 2)})`);
  check(!fm.crashed && tdInfo && surfTd === 'runway' && bounces === 0 && stopSurf === 'runway' && fm.vel.length() < 3,
    `landing 28R: touchdown on ${surfTd} at ${fmt(tdInfo && tdInfo.vs * 196.85, 0)} ft/min, ${fmt(tdInfo && tdInfo.kias, 0)} KIAS, no bounce; stopped on ${stopSurf}${fm.crashed ? ' — CRASH: ' + fm.crashReason : ''}`);
}

console.log(fails ? `\n${fails} geo-world check(s) FAILED` : '\nall geo-world checks passed');
process.exit(fails ? 1 : 0);
