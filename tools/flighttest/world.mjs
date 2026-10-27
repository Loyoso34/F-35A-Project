// Dünya geometrisi testleri: pist tanımlayıcıları ve işaretleri, kaplama planı (kesişme/örtüşme),
// yol ağı uç noktaları, yol koridoru yarması, yüzey sorgusu. Tarayıcı gerekmez.
//   node --import ./register.mjs world.mjs
const W = await import('../../js/world.js');
const R = await import('../../js/runway.js');
const AF = await import('../../js/airfield.js');
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

// --- Pistler: tanımlayıcı geometriden
for (const a of W.AIRPORTS) {
  const A = W.airportWorld(a, -a.rwy.len / 2, 0), B = W.airportWorld(a, a.rwy.len / 2, 0);
  const hdg = R.trueHeadingFromEnds(A.x, A.z, B.x, B.z);
  const exp = R.runwayDesignators(hdg, { magVar: a.magVar });
  check(a.marks[0] === R.designatorText(exp.a) && a.marks[1] === R.designatorText(exp.b), `${a.id}: runway ${a.marks.join('/')} from geometry (true ${hdg.toFixed(1)}°, magVar ${a.magVar}°)`);
  const diff = ((+a.marks[1] - +a.marks[0]) + 36) % 36;
  check(diff === 18, `${a.id}: reciprocal differs by 180°`);
}
// Tanımlayıcı kuralları: yuvarlama, 0 -> 36, manyetik sapma işareti, paralel pist harfi
const des = (h, o) => { const d = R.runwayDesignators(h, o); return R.designatorText(d.a) + '/' + R.designatorText(d.b); };
check(des(120) === '12/30' && des(90) === '09/27' && des(4) === '36/18' && des(176) === '18/36', 'designators: 120°→12/30, 090°→09/27, 004°→36/18, 176°→18/36');
check(R.runwayDesignators(90, { leadingZero: false }).a.num === '9', 'FAA style: no leading zero');
check(R.runwayDesignators(125, { magVar: 6 }).a.num === '12' && R.runwayDesignators(125, { magVar: -6 }).a.num === '13', 'magnetic variation: 125°T with 6°E -> 12, with 6°W -> 13');
check(des(270, { suffix: 'L' }) === '27L/09R', 'parallel runway: 27L reciprocal is 09R');
check(R.trueHeadingFromEnds(0, 0, 0, -100) === 0 && Math.abs(R.trueHeadingFromEnds(0, 0, 100, 0) - 90) < 1e-9, 'heading convention: north = -Z, east = +X');

// İşaret geometrisi (ICAO Annex 14, 45 m pist)
{
  const spec = { length: 3000, width: 45, standard: 'ICAO', ends: [{ text: '09', pad: 80 }, { text: '27', pad: 80 }] };
  const M = R.buildRunwayMarkings(spec);
  const P = M.white.attributes.position;
  let down = 0, outside = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < P.count; i += 3) {
    const ax = P.getX(i), az = P.getZ(i), bx = P.getX(i + 1), bz = P.getZ(i + 1), cx = P.getX(i + 2), cz = P.getZ(i + 2);
    if ((bz - az) * (cx - ax) - (bx - ax) * (cz - az) < 0) down++;
    for (let k = 0; k < 3; k++) {
      minY = Math.min(minY, P.getY(i + k)); maxY = Math.max(maxY, P.getY(i + k));
      if (Math.abs(P.getZ(i + k)) > 22.5 + 1e-6 || Math.abs(P.getX(i + k)) > 1500 + 1e-6) outside++;
    }
  }
  check(down === 0, 'markings: every triangle faces up');
  check(outside === 0, 'markings: nothing outside the runway pavement');
  check(maxY - minY < 1e-6 && maxY > 0.015, `markings: coplanar at ${maxY.toFixed(3)} m, above pavement (0.015 m)`);
  const E = M.layout.ends[0];
  check(E.stripes === 12, '45 m runway: 12 threshold stripes');
  check(Math.abs(E.designation[0] - 48) < 1e-6 && Math.abs(E.designation[1] - 57) < 1e-6, 'designation 9 m tall, 12 m past the 6 + 30 m threshold stripes');
  check(E.aiming[0] === 400, 'aiming point at 400 m');
  check(E.tdz.map((t) => t[0]).join(',') === '150,300,600,750,900' && E.tdz.map((t) => t[2]).join(',') === '3,3,2,1,1', 'TDZ pairs every 150 m, pair at 450 m dropped near the aiming point');
  check(M.layout.centerline.from > -1500 + 57 && M.layout.centerline.gap >= 20, 'centerline starts after designation, gap >= 20 m');
  // Yazı yönü: her iki uçta da yaklaşan pilot için dik ve aynalanmamış ('7' üst çizgisi eşikten uzakta, ayağı solda)
  const one = R.buildRunwayMarkings({ length: 3000, width: 45, standard: 'ICAO', ends: [{ text: '7' }, { text: '7' }] });
  const pp = one.white.attributes.position, A7 = [], B7 = [];
  for (let i = 0; i < pp.count; i++) {
    const x = pp.getX(i), z = pp.getZ(i);
    if (x > -1500 + 47 && x < -1500 + 58) A7.push([x, z]);
    if (x < 1500 - 47 && x > 1500 - 58) B7.push([x, z]);
  }
  const span = (pts, sel) => { const s = pts.filter(sel).map((p) => p[1]); return Math.max(...s) - Math.min(...s); };
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  check(span(A7, (p) => p[0] > -1500 + 56) > 2.5 && span(A7, (p) => p[0] < -1500 + 49) < 1.5
    && span(B7, (p) => p[0] < 1500 - 56) > 2.5 && span(B7, (p) => p[0] > 1500 - 49) < 1.5, 'designation text upright from both approach directions');
  check(mean(A7.filter((p) => p[0] < -1500 + 49).map((p) => p[1])) < 0 && mean(B7.filter((p) => p[0] > 1500 - 49).map((p) => p[1])) > 0, 'designation text not mirrored at either end');
  const lights = R.runwayLightList(spec, M.layout);
  check(lights.filter((l) => l.kind === 2 && l.x < 0).every((l) => l.z < 0), 'PAPI on the approaching pilot\'s left');
  const disp = R.buildRunwayMarkings({ length: 3000, width: 45, standard: 'ICAO', ends: [{ text: '09', displaced: 300 }, { text: '27' }] });
  check(Math.abs(disp.layout.ends[0].designation[0] - 348) < 1e-6 && disp.layout.ends[0].aiming[0] === 700, 'displaced threshold shifts markings by 300 m');
  const faa = R.buildRunwayMarkings({ length: 3000, width: 45.7, standard: 'FAA', ends: [{ text: '9' }, { text: '27' }] });
  check(faa.layout.ends[0].tdz.map((t) => t[2]).join(',') === '3,2,2,1,1' && Math.abs(faa.layout.ends[0].aiming[0] - 311) < 1e-6, 'FAA table: aiming point 1020 ft, TDZ 3/2/2/1/1');
}
check(W.SPAWNS.every((sp) => sp.sub.includes(W.AIRPORT_BY_ID[sp.airport].marks.join('/'))), 'hangar labels show computed designators');
check(W.SPAWNS.find((s) => s.id === 'base').runway === '09' && W.SPAWNS.find((s) => s.id === 'civil').runway === '12', 'spawn runway = takeoff direction (09 / 12)');

// --- Kaplama planı: dikdörtgenler birbirine binmez; dolgu yayları dikdörtgenlere binmez
for (const [id, plan] of Object.entries(W.AIRFIELD_PLANS)) {
  let overlaps = 0;
  const R2 = plan.rects;
  for (let i = 0; i < R2.length; i++) for (let j = i + 1; j < R2.length; j++) {
    const a = R2[i], b = R2[j];
    if (a.x0 < b.x1 - 0.01 && a.x1 > b.x0 + 0.01 && a.z0 < b.z1 - 0.01 && a.z1 > b.z0 + 0.01) { overlaps++; console.log('   overlap', a.id, b.id); }
  }
  check(overlaps === 0, `${id}: ${R2.length} pavement rectangles, no coplanar overlap`);
  let fo = 0;
  for (const f of plan.fillets) {
    const cx = f.px + f.sx * f.r * 0.25, cz = f.pz + f.sz * f.r * 0.25;   // köşeye yakın, dolgu içinde
    if (R2.some((q) => cx > q.x0 && cx < q.x1 && cz > q.z0 && cz < q.z1)) fo++;
    if (AF.planSurfaceAt(plan, cx, cz) !== 'taxiway') fo++;
  }
  check(fo === 0 && plan.fillets.length > 0, `${id}: ${plan.fillets.length} junction fillets, outside rectangles and reported as taxiway`);
  // Bağlantı: pistten başlayarak kenar paylaşan kaplamalar üzerinden erişilebilirlik (BFS).
  // Kara tarafı otopark/kaldırım ('lot') hariç her taksi yolu ve apron piste bağlı olmalı.
  const touch = (a, b) => {
    const e = 0.02;
    const xOv = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), zOv = Math.min(a.z1, b.z1) - Math.max(a.z0, b.z0);
    return (zOv > 1 && (Math.abs(a.x1 - b.x0) < e || Math.abs(b.x1 - a.x0) < e)) || (xOv > 1 && (Math.abs(a.z1 - b.z0) < e || Math.abs(b.z1 - a.z0) < e));
  };
  const seen = new Set([R2[0]]), queue = [R2[0]];
  while (queue.length) { const a = queue.shift(); for (const b of R2) if (!seen.has(b) && touch(a, b)) { seen.add(b); queue.push(b); } }
  const orphans = R2.filter((q) => !seen.has(q) && q.kind !== 'lot');
  orphans.forEach((q) => console.log('   orphan', q.id));
  check(orphans.length === 0, `${id}: every taxiway/apron is reachable from the runway (${seen.size}/${R2.length} incl. landside)`);
}
// --- Yüzey sorgusu fizik ile çizim aynı veriden: bilinen noktalar
const S = W.surfaceTypeAt;
check(S(-1400, 0) === 'runway' && S(0, 200) === 'taxiway' && S(-725, 100) === 'taxiway' && S(0, 400) === 'apron' && S(0, 100) === 'taxiway', 'base surface types (runway / taxiway / link / apron)');
check(S(-1540, 0) === 'runway', 'base blast pad is paved');
check(S(-700, 100) === 'grass', 'grass between links');
const ca = W.AIRPORT_BY_ID.civil, cw = (lx, lz) => { const p = W.airportWorld(ca, lx, lz); return S(p.x, p.z); };
check(cw(-1600, 0) === 'runway' && cw(0, 190) === 'taxiway' && cw(0, 400) === 'apron' && cw(1300, 300) === 'apron' && cw(-1100, 500) === 'apron', 'civil surface types incl. cargo + hangar aprons');

// --- Yol ağı: her uç ya bir yola değer ya da izin verilen bir tesiste biter
const D = W.__debug, roads = D.ROADS, base = D.BASE_ROADS, streets = D.TOWN_STREETS;
const distPoly = (x, z, pts) => { let b = Infinity; for (let i = 0; i < pts.length - 1; i++) { const [ax, az] = pts[i], [bx, bz] = pts[i + 1]; const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1; let t = ((x - ax) * vx + (z - az) * vz) / L2; t = Math.max(0, Math.min(1, t)); b = Math.min(b, Math.hypot(ax + vx * t - x, az + vz * t - z)); } return b; };
const civW = (lx, lz) => W.airportWorld(ca, lx, lz);
const facilities = [
  { n: 'base main gate', x: 0, z: 1050, r: 20 }, { n: 'base west gate', x: -1200, z: 1050, r: 20 },
  { n: 'town centre', x: 2600, z: 6900, r: 60 }, { n: 'town2 centre', x: 21200, z: -13600, r: 60 }, { n: 'hamlet', x: D.HAMLET.x, z: D.HAMLET.z, r: D.HAMLET.r },
  { n: 'city ring', x: 4480, z: 13500, r: 60 }, { n: 'city', x: 1600, z: 16000, r: 60 }, { n: 'port', x: 600, z: 19700, r: 80 },
  { n: 'cargo lots', x: 1750, z: 2048, r: 260 }, { n: 'hotel lot', x: -2240, z: 1700, r: 30 },
  { n: 'civil car park', ...(() => { const p = civW(0, 866); return { x: p.x, z: p.z }; })(), r: 25 },
  { n: 'civil cargo apron', ...(() => { const p = civW(1450, 431); return { x: p.x, z: p.z }; })(), r: 25 },
];
let bad = 0;
for (const r of roads) for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) {
  const onRoad = [...roads, ...streets].some((q) => q !== r && distPoly(e[0], e[1], q.pts) < q.w / 2 + 8);
  const fac = facilities.find((f) => Math.hypot(e[0] - f.x, e[1] - f.z) < f.r);
  if (!onRoad && !fac) { bad++; console.log('   dead end', r.name, e.map((v) => Math.round(v))); }
}
check(bad === 0, `${roads.length} roads: every endpoint joins another road or ends at a facility`);
let badB = 0;
const baseFac = [[0, W.AIRBASE.gateZ], [-1200, W.AIRBASE.gateZ], [-1230, 885], [-926, 395], [-761, 395], [-990, 451], [-330, 1008], [300, 952], [1450, 895], [1150, 530], [-1340, -668], [-1790, -668]];
for (const r of base) {
  if (r.closed) continue;
  for (const e of [r.pts[0], r.pts[r.pts.length - 1]]) {
    const onRoad = base.some((q) => q !== r && distPoly(e[0], e[1], q.pts) < q.w / 2 + 4);
    const fac = baseFac.some(([x, z]) => Math.hypot(e[0] - x, e[1] - z) < 12);
    if (!onRoad && !fac) { badB++; console.log('   base dead end', r.id, e.map((v) => Math.round(v))); }
  }
}
check(badB === 0, `${base.length} base service roads connected (gates, lots, facilities)`);
// Yollar pist kaplamasını kesmez
let cross = 0;
for (const r of [...roads, ...base]) for (const p of r.pts) { const t = S(p[0], p[1]); if (t === 'runway' || t === 'taxiway') cross++; }
check(cross === 0, 'no road vertex on a runway or taxiway');
// Yol koridoru yarma açmaz: civil yaylası
const ap = W.AIRPORT_BY_ID.civil;
let minH = Infinity;
for (let lz = -1400; lz <= 1400; lz += 50) { const p = W.airportWorld(ap, -900, lz); minH = Math.min(minH, W.terrainHeight(p.x, p.z)); }
check(minH > 150, `civil plateau intact around the airport (min terrain ${minH.toFixed(0)} m, was 60 m road trench)`);
console.log(fails ? `\n${fails} FAILED` : '\nall world checks passed');
process.exit(fails ? 1 : 0);
