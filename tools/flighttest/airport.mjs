// v5.0 LTFE meydan ışıklandırması ve ayrıntıları: yayımlanmış yapılandırmaya uygunluk, PAPI işlevi,
// ALS/TDZ/RCL düzeni, durma çubukları, zorunlu levha yazıları, pist şeridi engel serbestliği.
//   node --import ./register.mjs airport.mjs
import { readFileSync } from 'node:fs';
import { decodePNG } from './png.mjs';
import { load, fmt } from './sim.mjs';
const M = await load();
const THREE = M.THREE;
const GW = await import(M.root + '/js/geoworld.js');
const RW = await import(M.root + '/js/runway.js');
const R = await import(M.root + '/js/georegion.js');
const G = await import(M.root + '/js/geo.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const root = new URL('./geo/bodrum/', 'file://' + M.root + '/');
const io = { base: root.href, fetch: async (u) => readFileSync(new URL(u)), fetchJSON: async (u) => JSON.parse(readFileSync(new URL(u), 'utf8')), decodeRGBA: async (b) => decodePNG(b), clock: (() => { let t = 0; return () => (t += 5); })() };
const W = new GW.GeoWorld(new THREE.Scene(), null, 'medium', io);
await W.loadManifest(); await W.buildGeoTerrain();
W.buildAirport();
const L = R.LTFE, DEG = Math.PI / 180;

// ---- Pist ışık listeleri (pist yereli) ----
const spec = (r) => ({ length: r.len, width: r.width, standard: 'ICAO', tdzPattern: 'coded', ends: r.ends.map((e) => Object.assign({ text: e.num, suffix: e.suffix, pad: e.pad, approach: false, papi: false }, e.light || {})) });
const main = L.runways[0], sec = L.runways[1];
const sm = spec(main), lay = RW.buildRunwayMarkings(sm).layout, lm = RW.runwayLightList(sm, lay);
const ss = spec(sec), ls = RW.runwayLightList(ss, RW.buildRunwayMarkings(ss).layout);
const papi = lm.filter((l) => l.kind === 2);
check(papi.length === 8 && ls.filter((l) => l.kind === 2).length === 0, '10L/28R: two PAPI bars of four units; 10R/28L (civil taxiway use, AIP) has no PAPI and no ALS');
for (const [ei, gs, name] of [[0, 3.3, '10L'], [1, 3.9, '28R']]) {
  const sg = ei === 0 ? 1 : -1;                 // pist içine doğru x işareti (A: +x)
  const units = papi.filter((l) => Math.sign(l.dir[0]) === (ei === 0 ? -1 : 1));
  const ang = units.map((u) => u.papi / DEG).sort((a, b) => a - b);
  const exp = [gs - 0.5, gs - 1 / 6, gs + 1 / 6, gs + 0.5];
  check(ang.every((a, i) => Math.abs(a - exp[i]) < 1e-6), `${name} PAPI settings ${ang.map((a) => fmt(a, 2)).join(' / ')}° around the published ${gs}° slope (±30′, ±10′)`);
  // sol taraf: A ucuna (+x) inen pilotun solu −z; B ucuna (−x) inenin solu +z
  const left = units.every((u) => (ei === 0 ? u.z < 0 : u.z > 0));
  const nearestHighest = units.slice().sort((a, b) => Math.abs(a.z) - Math.abs(b.z))[0].papi / DEG === Math.max(...ang);
  check(left && nearestHighest, `${name} PAPI on the approaching pilot's left, unit nearest the runway set highest`);
  // işlev: göz konumu süzülüş açısında, üstünde ve altında (birimden 3 km)
  const xP = units[0].x, zP = units[0].z;
  const eye = (deg) => { const d = 3000; return { x: xP - sg * d, y: units[0].y + d * Math.tan(deg * DEG), z: zP }; };
  const whites = (deg) => { const e = eye(deg); return units.filter((u) => Math.atan2(e.y - u.y, Math.hypot(e.x - u.x, e.z - u.z)) > u.papi).length; };
  check(whites(gs) === 2 && whites(gs + 0.4) === 3 && whites(gs + 0.7) === 4 && whites(gs - 0.3) === 1 && whites(gs - 0.7) === 0,
    `${name} PAPI reads 2 white / 2 red on the ${gs}° path, more white above (3 at +0.4°, 4 at +0.7°), more red below (1 at −0.3°, 0 at −0.7°)`);
}
{
  const p10 = lay.papi[0], p28 = lay.papi[1];
  const meht28 = p28.dist * Math.tan((3.9 - 1 / 6) * DEG) / 0.3048;
  check(Math.abs(meht28 - 68) < 0.5 && p10.dist > 230 && p10.dist < 330, `PAPI positions: 10L ${fmt(p10.dist, 0)} m, 28R ${fmt(p28.dist, 0)} m from threshold (28R MEHT ${fmt(meht28, 1)} ft = AIP 68 ft)`);
}
{
  // ALS CAT II: eksen barretleri 30 m'de 900 m'ye (30 sıra × 5), iç 270 m kırmızı yan barretler, 150 ve 300 m çapraz çubuklar, dış 600 m flaşörler
  for (const [sgn, name] of [[-1, '10L'], [1, '28R']]) {
    const T = sgn * main.len / 2;
    const beyond = lm.filter((l) => (l.x - T) * sgn > 1);
    const cl = beyond.filter((l) => Math.abs(l.z) <= 2.01 && !l.flash && l.colA[1] > 0.9);
    const rows = new Set(cl.map((l) => Math.round((l.x - T) * sgn)));
    const red = beyond.filter((l) => l.colA === RW.LIGHT_COLORS.RED && Math.abs(l.z) > 8);
    const fl = beyond.filter((l) => l.flash === 4);
    check(rows.size === 30 && Math.max(...rows) === 900 && red.length === 9 * 2 * 3 && red.every((l) => (l.x - T) * sgn <= 270.01) && fl.length === 20,
      `${name} approach lights: CAT II barrette centreline 30–900 m (${rows.size} bars), red side barrettes on the inner 270 m (${red.length} lights), ${fl.length} sequenced flashers on the outer 600 m`);
  }
  const tdz = lm.filter((l) => l.inset && Math.abs(l.z) >= 9);
  const rcl = lm.filter((l) => l.inset && Math.abs(l.z) < 1);
  const last = rcl.filter((l) => main.len / 2 - l.x < 300), mid = rcl.filter((l) => { const d = main.len / 2 - l.x; return d >= 300 && d < 900; });
  check(tdz.length === 2 * 30 * 2 * 3 && rcl.length > 190 && last.every((l) => l.colA === RW.LIGHT_COLORS.RED) && mid.some((l) => l.colA === RW.LIGHT_COLORS.RED) && mid.some((l) => l.colA !== RW.LIGHT_COLORS.RED),
    `TDZ lights (${tdz.length}: 900 m barrettes both ends) and runway centreline lights every 15 m (${rcl.length}): last 300 m red, 900–300 m alternating red/white`);
}

// ---- Durma çubukları, levhalar, engeller ----
{
  const A = W.ltfe;
  const holds = A.holds;
  check(holds.length >= 10, `${holds.length} runway-holding positions carry stop bars and mandatory signs`);
  // levha yazısı: eşik görüş yönünün solundaysa önce o
  let ok = 0;
  for (const h of holds) {
    let best = null;
    for (const r of L.runways) { const d = Math.abs((h.x - r.cx) * -r.uz + (h.z - r.cz) * r.ux); if (!best || d < best.d) best = { r, d }; }
    const r = best.r, lx = h.dz, lz = -h.dx;
    const aLeft = (r.A.x - h.x) * lx + (r.A.z - h.z) * lz > 0;
    // A eşiği (10L/10R) batıda: kuzeyden piste bakan (güneye) için batı SAĞDADIR
    const facingSouth = h.dz > 0;
    if (aLeft === !facingSouth) ok++;
  }
  check(ok === holds.length, `sign designators ordered by threshold side as seen from each holding position (${ok}/${holds.length}); e.g. facing south the west threshold (10L) is on the right -> "28R-10L"`);
  // pist şeridi (eksenden 75 m) içinde yeni engel yok
  let bad = 0;
  for (const b of W.buildingBoxes) {
    if (!b.test || b.poly) continue;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2;
    for (const r of L.runways) {
      const u = (cx - r.cx) * r.ux + (cz - r.cz) * r.uz, v = -(cx - r.cx) * r.uz + (cz - r.cz) * r.ux;
      if (Math.abs(u) < r.len / 2 + 60 && Math.abs(v) < 75) bad++;
    }
  }
  check(bad === 0, 'tower, apron floodlight masts and parked aircraft stay outside both runway strips (75 m from the centreline)');
}
// ---- Manyetik tutarlılık ----
{
  const r = main, mag = (r.hdg - W.magVar + 360) % 360;
  check(RW.designatorNumber(mag) === '10' && RW.designatorNumber((mag + 180) % 360) === '28', `designators from magnetic bearing: true ${fmt(r.hdg, 1)}° − ${W.magVar}° E = ${fmt(mag, 1)}° M -> 10 / 28 (opposite ends differ by 18)`);
}
console.log(fails ? `\n${fails} airport check(s) FAILED` : '\nall airport checks passed');
process.exit(fails ? 1 : 0);
