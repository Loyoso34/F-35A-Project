// Gerçek dünya bölgesi (Bodrum / LTFE) testleri: GERÇEK veri (geo/bodrum) ve GERÇEK fizik.
//   node --import ./register.mjs geoworld.mjs
// Denetimler: havaalanı verisi ve datumlar, arazi sürekliliği, ince DEM yüklenince ışınlanma
// olmaması, pistte rölantide kayma olmaması, 10L'den kalkış ve 28R'ye iniş (yüzey = pist).
// v3.9: OSM meydanı (taksi yolu/apron yüzeyi, bekleme çizgileri, bina çarpışması).
import { readFileSync, readdirSync } from 'node:fs';
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
const { FlightAlerts } = await import(M.root + '/js/alerts.js');

// ---- Havaalanı verisi ve datumlar ----
{
  const r0 = L.runways[0], r1 = L.runways[1];
  check(Math.abs(r0.len - 3000) < 1 && Math.abs(r1.len - 2496) < 1, `runway lengths from OSM threshold coordinates: ${fmt(r0.len, 1)} m / ${fmt(r1.len, 1)} m (10L/28R published 3000 m; 10R/28L OSM 2495.5 m)`);
  const sep = Math.abs(r1.vA - r0.vA);
  check(Math.abs(sep - 185) < 4, `parallel runway centreline separation ${fmt(sep, 1)} m (OSM; imagery 185 m)`);
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
  // Gökova Körfezi ve Bodrum–İstanköy arası: Sentinel-2 NDWI güneş parıltısında başarısız olur;
  // açık deniz kaba DEM batimetrisinden su sayılmalı (eskiden 0,5 m kara olarak pişiyordu)
  const seas = [[36.90, 27.60, 'Gulf of Gökova'], [36.80, 27.45, 'south of Gökova'], [36.95, 27.40, 'Bodrum–Kos strait']];
  const bad = seas.filter(([la, lo]) => { const p = W.frame.toLocal(la, lo); return W.surfaceTypeAt(p.x, p.z) !== 'water' || Math.abs(W.heightAt(p.x, p.z) - G.MSL_Y) > 0.01; });
  check(bad.length === 0, `open sea in sun-glint areas is water at 0 m MSL: ${seas.map((s) => s[2]).join(', ')}${bad.length ? ' — NOT: ' + bad.map((s) => s[2]).join(', ') : ''}`);
  // v4.0 batimetri kanalı: açık deniz derin, kıyı sığ, kara 0 (su rengi bundan hesaplanır)
  const dAt = (la, lo) => { const p = W.frame.toLocal(la, lo); return W.terrain.depthAt(p.x, p.z); };
  const dG = dAt(36.90, 27.60), dK = dAt(36.95, 27.40), dL = dAt(37.31, 27.78);
  check(dG > 60 && dK > 20 && dL === 0, `bathymetry: Gulf of Gökova ${fmt(dG, 0)} m, Bodrum–Kos strait ${fmt(dK, 0)} m, Milas (land) ${fmt(dL, 0)} m`);
  const land = W.frame.toLocal(37.31, 27.78);
  check(W.surfaceTypeAt(land.x, land.z) === 'grass', 'Milas town area is land');
}

// ---- OSM meydanı: taksi yolu / apron yüzeyi, bekleme çizgileri, meydan binaları ----
{
  const A = W.ltfe;
  let taxiOk = 0, taxiN = 0;
  for (const sg of A.segs) {
    if (Math.hypot(sg.bx - sg.ax, sg.bz - sg.az) < 30) continue;
    const x = (sg.ax + sg.bx) / 2, z = (sg.az + sg.bz) / 2;
    if (A.inRunway(x, z, 5)) continue;
    taxiN++;
    const st = W.surfaceTypeAt(x, z);
    if (st === 'taxiway' || st === 'apron') taxiOk++;
  }
  check(taxiN > 20 && taxiOk === taxiN, `OSM taxiway centreline midpoints are paved surface: ${taxiOk}/${taxiN}`);
  // Apron: en büyük apron çokgeninin içinden örnekler
  const area = (P) => Math.abs(P.reduce((s, p, i) => s + p.x * P[(i + 1) % P.length].z - P[(i + 1) % P.length].x * p.z, 0)) / 2;
  const big = A.aprons.slice().sort((a, b) => area(b) - area(a))[0];
  let inN = 0, inOk = 0;
  { let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of big) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    for (let i = 0; i < 400; i++) {
      const x = x0 + (x1 - x0) * ((i * 0.618034) % 1), z = z0 + (z1 - z0) * ((i * 0.414214) % 1);
      if (!R.LTFE || !GW || !A.constructor.inPoly(big, x, z) || A.inRunway(x, z, 0)) continue;
      inN++; if (W.surfaceTypeAt(x, z) === 'apron') inOk++;
    } }
  check(A.aprons.length > 0 && inN > 50 && inOk === inN, `main apron (${fmt(area(big) / 1e4, 1)} ha, OSM) samples are apron surface: ${inOk}/${inN}`);
  // Kaplama düzleştirmesi: apron üzerinde zemin kaplama profiline eşit (tümsek yok)
  let maxDev = 0;
  for (const p of big) { const h = W.heightAt(p.x * 0.98 + big[0].x * 0.02, p.z * 0.98 + big[0].z * 0.02), hA = A.aeroSurface(p.x, p.z); maxDev = Math.max(maxDev, Math.abs(h - G.MSL_Y - hA)); }
  check(maxDev < 1.5, `apron surface conformed to the aerodrome profile (max deviation ${fmt(maxDev, 2)} m at polygon vertices)`);
  const holds = A.holdPositions();
  let holdBad = 0;
  for (const h of holds) {
    let best = 1e9;
    for (const r of L.runways) {
      const o = A.rwLocal(r, h.x, h.z), uc = Math.max(-r.len / 2 - r.ends[0].pad, Math.min(r.len / 2 + r.ends[1].pad, o.u));
      best = Math.min(best, Math.hypot(o.u - uc, o.v));
    }
    // yön piste doğru olmalı: 10 m ilerisi daha yakın
    let ahead = 1e9;
    for (const r of L.runways) { const x = h.x + h.dx * 10, z = h.z + h.dz * 10, o = A.rwLocal(r, x, z), uc = Math.max(-r.len / 2 - r.ends[0].pad, Math.min(r.len / 2 + r.ends[1].pad, o.u)); ahead = Math.min(ahead, Math.hypot(o.u - uc, o.v)); }
    if (Math.abs(best - 90) > 2 || A.inRunway(h.x, h.z, 10) || ahead > best - 8) holdBad++;
  }
  check(holds.length >= 4 && holdBad === 0, `${holds.length} runway-holding positions on taxiways, all 90 ± 2 m from the nearest runway pavement centreline and facing it (approximate ICAO distance)`);
  // Meydan binaları: ayak izi çokgeni ile çarpışma
  W.addAirportSolids(); W.colGrid = null;
  const sol = A.buildingSolids;
  const term = sol.filter((b) => /terminal/i.test(b.name)).sort((a, b) => (b.maxX - b.minX) * (b.maxZ - b.minZ) - (a.maxX - a.minX) * (a.maxZ - a.minZ))[0];
  let cx = 0, cz = 0; for (const p of term.poly) { cx += p.x; cz += p.z; } cx /= term.poly.length; cz /= term.poly.length;
  // merkez çokgen dışındaysa (L biçimli) çokgen içinde bir nokta ara
  if (!A.constructor.inPoly(term.poly, cx, cz)) for (const p of term.poly) { const q = { x: p.x * 0.7 + cx * 0.3, z: p.z * 0.7 + cz * 0.3 }; if (A.constructor.inPoly(term.poly, q.x, q.z)) { cx = q.x; cz = q.z; break; } }
  const hitIn = W.hitsBuilding(cx, term.minY + 6, cz, 1);
  const hitAbove = W.hitsBuilding(cx, term.maxY + 15, cz, 1);
  // AABB içinde ama çokgen dışında bir nokta (varsa): çarpışma yok
  let gapMiss = true, gap = null;
  for (let i = 0; i < 200; i++) {
    const x = term.minX + (term.maxX - term.minX) * ((i * 0.618034) % 1), z = term.minZ + (term.maxZ - term.minZ) * ((i * 0.414214) % 1);
    let d = 1e9; for (let k = 0; k < term.poly.length; k++) { const a = term.poly[k], b = term.poly[(k + 1) % term.poly.length]; d = Math.min(d, A.constructor.segDist({ ax: a.x, az: a.z, bx: b.x, bz: b.z }, x, z)); }
    if (A.constructor.inPoly(term.poly, x, z) || d <= 3) continue;
    if (!gap && d > 8) gap = { x, z };
    if (W.hitsBuilding(x, term.minY + 6, z, 1)) { gapMiss = false; break; }
  }
  // Parça testi (füze, kamera yay kolu) de çokgeni kullanır: kutu boşluğundan dikey parça isabet değil
  const segGap = gap ? W.segmentHit(new THREE.Vector3(gap.x, term.maxY + 5, gap.z), new THREE.Vector3(gap.x, term.minY + 2, gap.z)) : -1;
  const segIn = W.segmentHit(new THREE.Vector3(cx, term.maxY + 20, cz), new THREE.Vector3(cx, term.minY + 2, cz));
  check(segGap === -1 && segIn > 0 && segIn < 1, `segment test honours the footprint: through the bounding-box gap ${segGap === -1 ? 'clear' : 'HIT ' + fmt(segGap, 2)}, through the terminal roof hit at t=${fmt(segIn, 2)}`);
  check(sol.length > 50 && hitIn && !hitAbove && gapMiss, `${sol.length} OSM aerodrome buildings collide by footprint polygon: inside "${term.name}" hit, ${fmt(term.maxY - term.minY - 1.5, 0)} m roof + 15 m clear, outside-footprint points in its bounding box clear`);
  let onPave = 0;
  for (const r of L.runways) for (let u = -r.len / 2; u <= r.len / 2; u += 50) { const x = r.cx + r.ux * u, z = r.cz + r.uz * u; if (W.hitsBuilding(x, W.heightAt(x, z) + 3, z, 6)) onPave++; }
  check(onPave === 0, 'no building collision volume along either runway centreline');
}

// v5.0: OSM kutu binaları / yol / bitki karoları kaldırıldı; yeni çekirdek harita core.mjs'de denetlenir.

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
  const AL = new FlightAlerts(), alertsSeen = new Set();
  run(M, fm, { seconds: 50, fps: 60, throttle: 1, ab: true, stick: (t, f) => {
    const T = f.telemetry;
    AL.update(1 / 60, f, W); for (const e of AL.events) alertsSeen.add(e);
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
  check(!alertsSeen.has('pullUp') && !alertsSeen.has('terrain'), `takeoff 10L over the real terrain: no nuisance PULL UP / TERRAIN alert (${[...alertsSeen].join(', ') || 'none'})`);
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
  const AL = new FlightAlerts(), alertsSeen = new Set();
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
    AL.update(1 / 60, f, W); for (const e of AL.events) alertsSeen.add(e);
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
  check(!alertsSeen.has('pullUp') && !alertsSeen.has('terrain'), `3° approach and landing on 28R over the real terrain: no nuisance PULL UP / TERRAIN alert (${[...alertsSeen].join(', ') || 'none'})`);
}

// ---- Arazi uyarısı (v5.1): gerçek DEM'de bir tepeye doğru alçak, düz uçuş ----
{
  // LTFE çevresindeki en yüksek noktayı bul (12 km yarıçap), 4 km gerisinden zirvenin 120 m altında yaklaş
  let best = { h: -1e9, x: 0, z: 0 };
  for (let i = -24; i <= 24; i++) for (let j = -24; j <= 24; j++) {
    const x = L.x + i * 500, z = L.z + j * 500, h = W.heightAt(x, z);
    if (h > best.h) best = { h, x, z };
  }
  // Yaklaşma yönü: ilk 2,5 km'si zirveden en az 220 m alçak olan yön (8 yön denenir)
  const V = 200;
  let pick = null;
  for (let k = 0; k < 8 && !pick; k++) {
    const hdg = k * 45, ux = Math.sin(hdg * DEG), uz = -Math.cos(hdg * DEG);
    let floor = -1e9; for (let d = 0; d <= 2500; d += 50) floor = Math.max(floor, W.heightAt(best.x - ux * (4000 - d), best.z - uz * (4000 - d)));
    if (floor < best.h - 220) pick = { hdg, ux, uz, floor };
  }
  const { hdg, ux, uz } = pick;
  const fm = new M.FlightModel(W, cfg);
  fm.wind = { dirDeg: 0, kt: 0, gustKt: 0, shear: 0 };
  fm.reset({ x: best.x - ux * 4000, z: best.z - uz * 4000, hdg });
  const alt = best.h - 120;
  fm.pos.y = alt; fm.vel.set(ux * V, 0, uz * V); fm.gearCmd = 0; fm.gearPos = 0;
  fm.quat.setFromEuler(new THREE.Euler(3 * DEG, -hdg * DEG, 0, 'YXZ'));
  fm.onGround = false; fm.wasOnGround = false; fm.engine_.n = 0.8; fm.throttle = 0.8;
  const AL = new FlightAlerts();
  let tTerr = null, tPull = null, tCrash = null, t = 0;
  run(M, fm, { seconds: 40, fps: 60, throttle: 0.8, stick: (tt, f) => {
    t = tt; AL.update(1 / 60, f, W);
    if (AL.terrain && tTerr === null) tTerr = tt;
    if (AL.pullUp && tPull === null) tPull = tt;
    return { pitch: 0, roll: 0, yaw: 0 };
  } });
  if (fm.crashed) tCrash = t;
  check(tPull !== null && tCrash !== null && tCrash - tPull > 1.5 && (tTerr === null || tTerr < tPull),
    `CFIT toward the ${fmt(best.h - G.MSL_Y, 0)} m summit at ${fmt(alt - G.MSL_Y, 0)} m MSL, 200 m/s: TERRAIN at ${fmt(tTerr, 1)} s, PULL UP at ${fmt(tPull, 1)} s, impact at ${fmt(tCrash, 1)} s (${fmt(tCrash - tPull, 1)} s warning)`);
  // Aynı uçuş, pilot PULL UP'a 0,6 s'de tam geri çubukla (kanatlar düz) yanıt verir: kurtulmalı
  const f2 = new M.FlightModel(W, cfg);
  f2.wind = { dirDeg: 0, kt: 0, gustKt: 0, shear: 0 };
  f2.reset({ x: best.x - ux * 4000, z: best.z - uz * 4000, hdg });
  f2.pos.y = alt; f2.vel.set(ux * V, 0, uz * V); f2.gearCmd = 0; f2.gearPos = 0;
  f2.quat.setFromEuler(new THREE.Euler(3 * DEG, -hdg * DEG, 0, 'YXZ'));
  f2.onGround = false; f2.wasOnGround = false; f2.engine_.n = 0.8; f2.throttle = 0.8;
  const A2 = new FlightAlerts();
  let tp = null, minClr = Infinity;
  run(M, f2, { seconds: 30, fps: 60, throttle: 1, stick: (tt, f) => {
    A2.update(1 / 60, f, W);
    if (A2.pullUp && tp === null) tp = tt;
    minClr = Math.min(minClr, f.pos.y - W.heightAt(f.pos.x, f.pos.z));
    return { pitch: tp !== null && tt > tp + 0.6 ? 1 : 0, roll: 0, yaw: 0 };
  } });
  check(!f2.crashed && tp !== null, `obeying PULL UP 0.6 s after the alert (full aft stick) clears the ridge: minimum clearance ${fmt(minClr, 0)} m${f2.crashed ? ' — CRASH: ' + f2.crashReason : ''}`);
}

console.log(fails ? `\n${fails} geo-world check(s) FAILED` : '\nall geo-world checks passed');
process.exit(fails ? 1 : 0);
