// Jeodezi testleri: yerel TM çerçevesi (js/geo.js) PROJ referans noktalarıyla (geo_ref.json,
// PROJ tmerc ile üretilmiştir), ters dönüşüm, yakınsama, Web Merkatör karo matematiği.
//   node --import ./register.mjs geo.mjs
import { readFileSync } from 'node:fs';
const G = await import('../../js/geo.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };
const ref = JSON.parse(readFileSync(new URL('./geo_ref.json', import.meta.url)));
const F = new G.LocalFrame(37.249314, 27.66401);
let maxErr = 0, maxInv = 0;
for (const r of ref) {
  const p = F.toLocal(r.lat, r.lon);
  maxErr = Math.max(maxErr, Math.hypot(p.x - r.e, -p.z - r.n));
  const g = F.toGeo(p.x, p.z);
  maxInv = Math.max(maxInv, Math.hypot((g.lat - r.lat) * 111000, (g.lon - r.lon) * 88000));
}
check(maxErr < 0.005, `TM forward matches PROJ tmerc within 5 mm out to ±160 km (max ${(maxErr * 1000).toFixed(2)} mm)`);
check(maxInv < 0.005, `TM inverse round trip within 5 mm (max ${(maxInv * 1000).toFixed(3)} mm)`);
const o = F.toLocal(37.249314, 27.66401);
check(Math.abs(o.x) < 1e-6 && Math.abs(o.z) < 1e-6, 'origin maps to (0, 0)');
check(Math.abs(F.convergence(37.25, 27.66401)) < 1e-9, 'no convergence on the central meridian');
const gEast = F.convergence(37.25, 28.66);
check(gEast > 0.6 && gEast < 0.62, `convergence 1° east of CM at 37.25°N = Δλ·sinφ ≈ 0.605° (${gEast.toFixed(4)}°)`);
check(Math.abs(F.scale(37.25, 27.66401) - 1) < 1e-9 && F.scale(37.25, 29.4) < 1.0003, 'scale 1 on the CM, < 1.0003 at 150 km');
// Web Merkatör: bilinen karo (z12, LTFE)
check(Math.floor(G.lonToTileX(27.66401, 12)) === 2362 && Math.floor(G.latToTileY(37.249314, 12)) === 1590, 'LTFE lies in Web Mercator tile 12/2362/1590');
const y = G.latToTileY(37.2, 13);
check(Math.abs(G.tileYToLat(y, 13) - 37.2) < 1e-10 && Math.abs(G.tileXToLon(G.lonToTileX(27.5, 13), 13) - 27.5) < 1e-10, 'tile <-> lat/lon round trip');
check(G.yFromMsl(0) === G.MSL_Y && G.mslFromY(G.yFromMsl(123.4)) === 123.4, 'MSL datum: sea level at y = MSL_Y');
const gg = new G.GeoidGrid({ lat0: 37, lon0: 27, dlat: 1, dlon: 1, nlat: 2, nlon: 2, v: [30, 32, 34, 36] });
check(Math.abs(gg.undulation(37.5, 27.5) - 33) < 1e-9 && gg.ellipsoidal(10, 37, 27) === 40, 'geoid grid bilinear; h_ell = h_msl + N');
// Güneş konumu (gün saati): bağımsız referans = Sentinel-2 sahne meta verisi (manifest.sun)
{
  const S = await import('../../js/sun.js');
  const man = JSON.parse(readFileSync(new URL('../../geo/bodrum/manifest.json', import.meta.url)));
  const p = S.solarPosition(new Date(man.sun.datetime), man.reference.lat, man.reference.lon);
  check(Math.abs(p.azimuthDeg - man.sun.azimuthDeg) < 0.5 && Math.abs(p.elevationDeg - man.sun.elevationDeg) < 0.5,
    `solar position at the imagery time: az ${p.azimuthDeg.toFixed(2)}° el ${p.elevationDeg.toFixed(2)}° vs Sentinel-2 metadata ${man.sun.azimuthDeg}° / ${man.sun.elevationDeg}° (scene centre differs from the ARP)`);
  const ev = S.solarPosition(S.localTimeMs('2024-10-03', 18, 25), man.reference.lat, man.reference.lon);
  const ss = S.solarPosition(S.localTimeMs('2024-10-03', 18, 45), man.reference.lat, man.reference.lon);
  check(ev.elevationDeg > 2 && ev.elevationDeg < 6 && ss.elevationDeg < 0.5 && ev.azimuthDeg > 255 && ev.azimuthDeg < 268, `evening preset 18:25 local: sun ${ev.elevationDeg.toFixed(1)}° high at ${ev.azimuthDeg.toFixed(0)}° (west); 18:45: ${ss.elevationDeg.toFixed(1)}°`);
}
console.log(fails ? `\n${fails} geo check(s) FAILED` : '\nall geo checks passed');
process.exit(fails ? 1 : 0);
