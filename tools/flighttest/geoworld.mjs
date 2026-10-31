// Gerçek dünya bölgesi (Bodrum / LTFE) testleri: GERÇEK veri (geo/bodrum) ve GERÇEK fizik.
//   node --import ./register.mjs geoworld.mjs
// Denetimler: havaalanı verisi ve datumlar, arazi sürekliliği, ince DEM yüklenince ışınlanma
// olmaması, pistte rölantide kayma olmaması, 10L'den kalkış ve 28R'ye iniş (yüzey = pist).
// v3.9: OSM meydanı (taksi yolu/apron yüzeyi, bekleme çizgileri, bina çarpışması), şehir binaları
// (karo biçimi, çarpışma), yol karoları, bitki örtüsü karo dizini.
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

// ---- Şehir binaları, yollar, bitki örtüsü karoları ----
{
  const base = M.root + '/geo/bodrum/';
  const man = W.man;
  // Bina karosu biçimi: u32 n + n × 12 bayt
  let files = 0, sizeOk = 0, recs = 0, osm = 0, badDim = 0;
  const bdir = base + 'bld/14/';
  for (const x of readdirSync(bdir).slice(0, 60)) for (const f of readdirSync(bdir + x)) {
    const b = readFileSync(bdir + x + '/' + f), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint32(0, true);
    files++; if (b.byteLength === 4 + 12 * n) sizeOk++;
    for (let i = 0, p = 4; i < n; i++, p += 12) {
      const w = dv.getUint16(p + 4, true) * 0.05, d = dv.getUint16(p + 6, true) * 0.05, H = dv.getUint8(p + 10) * 0.25, fl = dv.getUint8(p + 11);
      recs++; if (fl & 128) osm++;
      if (!(w > 0.5 && d > 0.5 && H >= 2 && H <= 63.75 && w * d < 60000 * 1.6)) badDim++;
    }
  }
  check(files > 100 && sizeOk === files && badDim === 0, `building tiles: ${files} files are exactly 4 + 12·n bytes; ${recs} records with plausible size/height (${osm} OSM-tagged)`);
  // Yol karosu biçimi: tüm baytlar tüketilir
  let rFiles = 0, rOk = 0;
  const rdir = base + 'road/14/';
  for (const x of readdirSync(rdir).slice(0, 60)) for (const f of readdirSync(rdir + x)) {
    const b = readFileSync(rdir + x + '/' + f), dv = new DataView(b.buffer, b.byteOffset, b.byteLength), n = dv.getUint16(0, true);
    let p = 2, ok = true;
    for (let k = 0; k < n && ok; k++) { const cls = dv.getUint8(p), nv = dv.getUint16(p + 2, true); if (cls < 1 || cls > 11 || nv < 2) ok = false; p += 4 + nv * 4; }
    rFiles++; if (ok && p === b.byteLength) rOk++;
  }
  check(rFiles > 100 && rOk === rFiles, `road tiles: ${rOk}/${rFiles} parse to their exact byte length with valid classes`);
  // Karo dizinleri: dizin, diskteki dosyalarla birebir (eksik karo istenmez -> 404 yok)
  const idxMatch = (sub, ix) => {
    const bin = Buffer.from(ix.bits, 'base64');
    let mism = 0, n = 0;
    const have = new Set();
    for (const x of readdirSync(base + sub)) for (const f of readdirSync(base + sub + '/' + x)) have.add(x + '/' + parseInt(f, 10));
    for (let y = ix.y0; y < ix.y0 + ix.h; y++) for (let x = ix.x0; x < ix.x0 + ix.w; x++) {
      const i = (y - ix.y0) * ix.w + (x - ix.x0), on = (bin[i >> 3] >> (i & 7)) & 1;
      if (on) n++;
      if (!!on !== have.has(x + '/' + y)) mism++;
    }
    return { n, mism, files: have.size };
  };
  const ib = idxMatch('bld/14', man.buildings.index), ir = idxMatch('road/14', man.roads.index), iv = idxMatch('veg/12', man.vegetation.index);
  check(ib.mism === 0 && ir.mism === 0 && iv.mism === 0 && ib.n === ib.files && iv.n === iv.files,
    `tile indexes match the files on disk (buildings ${ib.n}, roads ${ir.n}, vegetation ${iv.n}); sea tiles are never requested`);
  // Çalışma zamanı: meydan + Bodrum çevresi karoları yüklenir, çarpışma kutuları oluşur
  await W.terrain.ensureArea(L.x, L.z, 2500);
  await W.buildFeatures();
  const Fe = W.features;
  const bod = W.frame.toLocal(37.0385, 27.4290);
  await W.terrain.ensureArea(bod.x, bod.z, 1500);
  await Fe.preload(new THREE.Vector3(bod.x, G.MSL_Y + 150, bod.z), 15000);
  let near = null, nb = 0, inAero = 0;
  for (const t of Fe.tiles.values()) {
    if (!t.col) continue;
    nb += t.col.n;
    for (let i = 0; i < t.col.n; i++) {
      if (W.ltfe.pavedDist(t.col.x[i], t.col.z[i]) < 2) inAero++;
      const d = Math.hypot(t.col.x[i] - bod.x, t.col.z[i] - bod.z);
      if (t.col.hw[i] > 4 && t.col.hd[i] > 4 && (!near || d < near.d)) near = { d, t, i };
    }
  }
  check(nb > 2000 && inAero === 0, `runtime: ${nb} city/aerodrome-area buildings loaded headless; none on OSM aerodrome pavement`);
  const C = near.t.col, i = near.i;
  const yMid = (C.y0[i] + C.y1[i]) / 2;
  const hit = W.hitsBuilding(C.x[i], yMid, C.z[i], 1);
  const above = W.hitsBuilding(C.x[i], C.y1[i] + 10, C.z[i], 1);
  const beside = W.hitsBuilding(C.x[i] + C.c[i] * (C.hw[i] + 8), yMid, C.z[i] - C.s[i] * (C.hw[i] + 8), 1);
  // Dikey parça: çatının 40 m üstünden binanın içine; ilk temas çatı kotunda (4 m adım)
  const top = C.y1[i] + 40, bot = C.y0[i] + 1, seg = W.segmentHit(new THREE.Vector3(C.x[i], top, C.z[i]), new THREE.Vector3(C.x[i], bot, C.z[i]));
  const yHit = top + (bot - top) * seg;
  check(hit && !above && seg > 0 && Math.abs(yHit - C.y1[i]) < 5, `Bodrum building ${fmt(near.d, 0)} m from 37.0385 N 27.4290 E (${fmt(C.hw[i] * 2, 1)} × ${fmt(C.hd[i] * 2, 1)} m, top ${fmt(C.y1[i] - G.MSL_Y, 1)} m MSL): inside hit, 10 m above clear, falling segment first hits at ${fmt(yHit - G.MSL_Y, 1)} m MSL${beside ? ' (8 m beside its wall: another building)' : ''}`);
  let vegOn = 0, vegOff = 0;
  for (let y = 1585; y <= 1598; y++) for (let x = 2355; x <= 2367; x++) { if (Fe.vegExists(x, y)) vegOn++; else vegOff++; }
  check(vegOn === iv.files && vegOff > 0, `vegetation index at runtime: ${vegOn} land tiles requested, ${vegOff} empty sea tiles skipped`);
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
