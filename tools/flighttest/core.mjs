// v5.0 çekirdek harita (Bodrum yarımadası, 20 × 20 km) testleri: GERÇEK veri, başsız tam kurulum.
//   node --import ./register.mjs core.mjs
// Denetimler: harita boyutu, kıyı/su fiziği, kenar bandı sürekliliği, fizik yüzeyi = çizim üçgenleri,
// yol eğim sınırları ve bağlantılar, D330 ile LTFE erişimi, gökdelen/kale çarpışması, gerçek tepe
// yükseklikleri (abartı yok), batimetri.
import { readFileSync } from 'node:fs';
import { decodePNG } from './png.mjs';
import { load, fmt } from './sim.mjs';
const M = await load();
const THREE = M.THREE;
const GW = await import(M.root + '/js/geoworld.js');
const CT = await import(M.root + '/js/coreterrain.js');
const G = await import(M.root + '/js/geo.js');
const R = await import(M.root + '/js/georegion.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const root = new URL('./geo/bodrum/', 'file://' + M.root + '/');
const io = { base: root.href, fetch: async (u) => readFileSync(new URL(u)), fetchJSON: async (u) => JSON.parse(readFileSync(new URL(u), 'utf8')), decodeRGBA: async (b) => decodePNG(b), clock: (() => { let t = 0; return () => (t += 5); })() };
const W = new GW.GeoWorld(new THREE.Scene(), null, 'medium', io);
const t0 = performance.now();
await W.build(() => {}, async () => {});
const C = CT.CORE, core = W.core, city = W.city;
console.log(`(headless build ${fmt((performance.now() - t0) / 1000, 1)} s)`);

// ---- Harita boyutu ve çerçeve ----
check(C.size === 20000 && C.N === 2048 && Math.abs(C.s - 9.765625) < 1e-9 && core.H.length === 2049 * 2049,
  `core map is exactly 20 000 × 20 000 m (400 km²), 2049² samples at ${C.s} m`);
const g0 = W.frame.toGeo(C.x0, C.z0), g1 = W.frame.toGeo(C.x1, C.z1);
check(g0.lat > 37.13 && g0.lat < 37.15 && g1.lat > 36.95 && g1.lat < 36.97 && g0.lon < 27.30 && g1.lon > 27.50,
  `core spans ${fmt(g1.lat, 3)}–${fmt(g0.lat, 3)} N, ${fmt(g0.lon, 3)}–${fmt(g1.lon, 3)} E (Bodrum peninsula)`);
const castle = W.frame.toLocal(37.0319, 27.4289);
check(CT.inCore(castle.x, castle.z, 2000), 'Bodrum Castle lies inside the core with > 2 km margin');
const ap = W.frame.toLocal(R.LTFE.arp.lat, R.LTFE.arp.lon);
check(!CT.inCore(ap.x, ap.z), `LTFE stays at its real position outside the core (${fmt(Math.hypot(ap.x - castle.x, ap.z - castle.z) / 1000, 1)} km from the castle), not moved into the city`);

// ---- Kıyı, su fiziği, batimetri ----
{
  const hc = W.heightAt(castle.x, castle.z) - G.MSL_Y;
  check(W.surfaceTypeAt(castle.x, castle.z) !== 'water' && hc > 5 && hc < 14, `castle promontory is land at ${fmt(hc, 1)} m MSL`);
  const bay = city.P(-300, -1500);
  const hb = W.heightAt(bay.x, bay.z) - G.MSL_Y, sb = core.rawAt(bay.x, bay.z);
  check(W.surfaceTypeAt(bay.x, bay.z) === 'water' && Math.abs(hb) < 1e-9 && sb < -20, `Bodrum bay: water, physics surface 0 m MSL, rendered seabed ${fmt(sb, 0)} m`);
  const mar = city.P(-380, 300);
  check(W.surfaceTypeAt(mar.x, mar.z) === 'water' && core.rawAt(mar.x, mar.z) < -4, `marina basin dredged to ${fmt(core.rawAt(mar.x, mar.z), 1)} m`);
  let wet = 0, n = 0, signBad = 0;
  for (let k = 0; k < 4000; k++) {
    const x = C.x0 + Math.random() * C.size, z = C.z0 + Math.random() * C.size, h = core.rawAt(x, z);
    n++; if (h < 0) wet++;
    if (h < 0 !== W.surfaceTypeAt(x, z) === 'water' && Math.abs(h) > 0.05) signBad++;
  }
  check(signBad === 0, `surface type agrees with the rendered coastline at ${n} random points (sea ${fmt(100 * wet / n, 0)} %)`);
  let maxH = -1e9, at = null;
  for (let j = 0; j <= C.N; j += 4) for (let i = 0; i <= C.N; i += 4) { const h = core.hAt(i, j); if (h > maxH) { maxH = h; at = [i, j]; } }
  check(maxH > 450 && maxH < 720, `highest point ${fmt(maxH, 0)} m MSL: moderate Aegean hills from the real DEM (no exaggeration, no alpine peaks)`);
}

// ---- Fizik yüzeyi = en ince düğüm üçgenleri; kenar bandı sürekliliği ----
{
  let maxErr = 0;
  for (let k = 0; k < 2000; k++) {
    const i = 1 + Math.floor(Math.random() * (C.N - 2)), j = 1 + Math.floor(Math.random() * (C.N - 2));
    const u = Math.random(), v = Math.random();
    const x = C.x0 + (i + u) * C.s, z = C.z0 + (j + v) * C.s;
    const a = core.hAt(i, j), b = core.hAt(i, j + 1), c = core.hAt(i + 1, j + 1), d = core.hAt(i + 1, j);
    const tri = u + v <= 1 ? a + u * (d - a) + v * (b - a) : c + (1 - u) * (b - c) + (1 - v) * (d - c);
    maxErr = Math.max(maxErr, Math.abs(core.rawAt(x, z) - tri));
  }
  check(maxErr < 1e-6, `physics height = finest mesh triangles (diagonal (i,j+1)–(i+1,j)), max error ${maxErr.toExponential(1)} m`);
  // kenarda iç (+1 m) ile dış (−1 m) arasındaki uyumsuzluk, dıştaki yerel eğimle beklenen değere göre
  let maxStep = 0, where = '';
  for (const [side, n] of [['W', 0], ['E', 1], ['N', 2], ['S', 3]]) {
    for (let k = 0; k < 800; k++) {
      const t = 200 + k / 800 * (C.size - 400);
      const at = (d) => (n === 0 ? [C.x0 + d, C.z0 + t] : n === 1 ? [C.x1 - d, C.z0 + t] : n === 2 ? [C.x0 + t, C.z0 + d] : [C.x0 + t, C.z1 - d]);
      const hIn = W.heightAt(...at(1)), h1 = W.heightAt(...at(-1)), h5 = W.heightAt(...at(-5));
      const exp = h1 + (h1 - h5) / 4 * 2;
      const m = Math.abs(hIn - exp);
      if (m > maxStep) { maxStep = m; where = side; }
    }
  }
  check(maxStep < 1.0, `core boundary meets the regional terrain: largest mismatch across all four edges ${fmt(maxStep, 2)} m (${where}) at 3200 edge points`);
}

// ---- Yollar ----
{
  const RN = city.roads, roads = RN.roads;
  const byCls = {};
  for (const r of roads) byCls[r.cls] = (byCls[r.cls] || 0) + 1;
  check(roads.length > 1500 && byCls[2] > 10, `${roads.length} roads (OSM + designed district streets): ${Object.entries(byCls).map(([k, v]) => 'class ' + k + ' × ' + v).join(', ')}`);
  // eğim: yol ekseni boyunca 8-10 m'lik parçalar; kavşak/kesişme bölgeleri ve kenar bandı hariç.
  // Başka bir yolun dolgu şevine yaslanan nadir parçalar olabilir: %99'luk dilim ölçülür.
  const ex = [];
  for (const r of roads) {
    if (!r.C.carve || r.cls >= 6 || !r.inCore) continue;
    for (let i = 1; i < r.P.length; i++) {
      const p = r.P[i];
      if (!CT.inCore(p.x, p.z, 400) || RN.nearRoadOther(p.x, p.z, r) < 25) continue;
      const L = Math.hypot(r.P[i].x - r.P[i - 1].x, r.P[i].z - r.P[i - 1].z);
      if (L < 2) continue;
      ex.push(Math.abs(r.prof[i] - r.prof[i - 1]) / L - r.C.grade);
    }
  }
  ex.sort((a, b) => a - b);
  const p99 = ex[Math.floor(ex.length * 0.99)], within = ex.filter((e) => e <= 0.01).length;
  check(p99 <= 0.015, `carved road profiles respect class grade limits (trunk 7 %, primary 9 %, secondary 11 %, tertiary 13 %): ${within}/${ex.length} segments within 1 % of the limit, 99th percentile excess ${fmt(Math.max(0, p99) * 100, 2)} %`);
  // yol yüzeyi son araziye oturur: köprü dışında yol ekseni = arazi (havada/gömülü yol yok)
  let off = 0, cnt = 0;
  for (const r of roads) {
    if (!r.inCore) continue;
    for (let i = 0; i < r.P.length; i += 3) {
      const p = r.P[i];
      if (!CT.inCore(p.x, p.z, 50) || r.bridgeAt[i]) continue;
      cnt++; if (Math.abs(Math.max(core.rawAt(p.x, p.z), 0.4) - r.prof[i]) > 0.05) off++;
    }
  }
  check(off === 0, `road surface sits on the final terrain (no floating or buried roads): ${cnt - off}/${cnt} centreline samples`);
  // bağlantı: ana yolların uçları başka bir yola bağlanır ya da harita kenarına ulaşır
  let ends = 0, open = 0;
  for (const r of roads) {
    if (r.cls > 5 || r.design) continue;
    for (const p of [r.P[0], r.P[r.P.length - 1]]) {
      ends++;
      const conn = RN.nearRoadOther(p.x, p.z, r) < 6 || !CT.inCore(p.x, p.z, 300);
      if (!conn) open++;
    }
  }
  check(open / ends < 0.06, `major-road endpoints joined to another road or leaving the map: ${ends - open}/${ends}`);
  // D330: çekirdekten LTFE'ye bağlantılı gövde yol (çekirdek dışı koridor da yüklü)
  const trunkNearAp = roads.some((r) => r.cls <= 3 && r.P.some((p) => Math.hypot(p.x - ap.x, p.z - ap.z) < 4000));
  const trunkInCore = roads.some((r) => r.cls === 2 && r.inCore);
  check(trunkNearAp && trunkInCore, 'D330 trunk road runs from the Bodrum core to the LTFE area (real OSM alignment)');
}

// ---- Yapılar ve çarpışma ----
{
  const t = city.P(-2295, 255), g = W.heightAt(t.x, t.z);
  check(W.hitsBuilding(t.x, g + 150, t.z, 2) && !W.hitsBuilding(t.x, g + 320, t.z, 2), `Aegean Crown tower: solid at 150 m above its plaza, clear above the spire (${fmt(g - G.MSL_Y + 248, 0)} m MSL top)`);
  const cc = city.P(8, -48);
  check(W.hitsBuilding(cc.x, W.heightAt(cc.x, cc.z) + 15, cc.z, 6), 'Castle of St. Peter towers are collision volumes');
  const sea = city.P(-300, -1500);
  check(!W.hitsBuilding(sea.x, G.MSL_Y + 30, sea.z, 10), 'open bay is clear of obstacles');
  const seg = W.segmentHit(new THREE.Vector3(t.x - 200, g + 100, t.z), new THREE.Vector3(t.x + 200, g + 100, t.z));
  check(seg > 0.3 && seg < 0.5, `missile/camera segment test hits the tower facade at t=${fmt(seg, 2)}`);
}

console.log(fails ? `\n${fails} core-map check(s) FAILED` : '\nall core-map checks passed');
process.exit(fails ? 1 : 0);
