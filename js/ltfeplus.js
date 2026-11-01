// LTFE meydan ayrıntıları (v5.0): taksi yolu/apron ışıkları, durma çubukları, zorunlu talimat
// levhaları, yaklaşma ışığı direkleri, apron projektörleri, meydan feneri, kontrol kulesi, park hâlinde
// yolcu uçakları ve yer hizmet araçları.
//
// Kaynak ve doğruluk ([V] doğrulanmış, [E] yaklaşık):
//  [V] Taksi yolu eksenleri, apron çokgenleri, kapı noktaları: OSM (airport/ltfe.json).
//  [E] Taksi yolu kenar ışıkları: ICAO Annex 14 5.3.18 — mavi, düz kesimde ≤ 60 m (burada 30 m), virajda sık.
//      Gerçek yerleşim ölçülmedi; taksi yolu genişliği 23 m varsayımına göre kenardan 1,5 m dışarıda.
//  [E] Durma çubukları: CAT II işletmesi için ICAO 5.3.20 gereği; bekleme çizgilerinde, kırmızı, 3 m aralık,
//      taksi eden uçağa dönük. Bekleme konumları ICAO tipik uzaklığıyla (90 m) hesaplanır (ltfe3d.js).
//  [V] Zorunlu talimat levhası içeriği: kesişen pistin tanımlayıcıları, eşikler görüş yönüne göre sıralı
//      (soldaki tanımlayıcı soldaki eşiğe aittir). Taksi yolu harfi/konum levhası KURULMAZ: OSM'de taksi
//      yolu adı yok, uydurma etiket yazılmaz.
//  [E] Kontrol kulesi konumu ve biçimi YAKLAŞIKTIR (açık veride konumu yok); terminal bölgesinin karada kalan
//      kenarına yerleştirildi.
//  [E] Park hâlindeki yolcu uçakları kurgusal boya taşır (gerçek havayolu markası yok); A320 sınıfı ölçüler.
import * as THREE from 'three';
import { ArchBuilder } from './archmat.js';
import { buildLightPoints, LIGHT_COLORS } from './runway.js';
import { mulberry32 } from './noise.js';

const BLUE = LIGHT_COLORS.BLUE, RED = LIGHT_COLORS.RED, WHITE = LIGHT_COLORS.WHITE;

function pointInPoly(poly, x, z) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/** Genel yolcu uçağı (A320 sınıfı, 37,6 m, kanat 34 m) — kurgusal boya. Burun +x (yerel). */
function airliner(b, x, y, z, a, tail, rand) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const W = (u, v) => [x + u * ca - v * sa, z + u * sa + v * ca];
  const white = [0.86, 0.87, 0.88], gray = [0.55, 0.56, 0.58], dark = [0.06, 0.07, 0.08];
  const st = [rand(), 3, 3, 0];
  // gövde: 14 halka, dairesel kesit (r 2,0 m), burun ve kuyruk konisi
  const L = 37.6, R = 2.0, yc = y + 3.3;
  const ring = (u) => {
    const t = (u + L / 2) / L;
    const rr = t < 0.1 ? R * Math.sqrt(t / 0.1) * 0.98 + 0.05 : t > 0.78 ? R * (1 - (t - 0.78) / 0.22 * 0.85) : R;
    const yoff = t > 0.78 ? (t - 0.78) / 0.22 * 1.1 : 0;
    return { rr, yoff };
  };
  const NS = 16, NR = 10;
  let prev = null;
  for (let k = 0; k <= NS; k++) {
    const u = -L / 2 + k / NS * L, { rr, yoff } = ring(u);
    const cur = [];
    for (let j = 0; j < NR; j++) {
      const t = j / NR * Math.PI * 2;
      const [px, pz] = W(u, Math.cos(t) * rr);
      cur.push([px, yc + yoff + Math.sin(t) * rr * 1.05, pz]);
    }
    if (prev) for (let j = 0; j < NR; j++) {
      const j1 = (j + 1) % NR;
      const mid = (prev[j][1] + cur[j][1]) / 2;
      const col = mid > yc + 0.6 && mid < yc + 1.0 ? dark : mid < yc - 0.9 ? gray : white;    // pencere bandı, alt gövde
      b.quad(prev[j], prev[j1], cur[j1], cur[j], [0, 0, 1, 0, 1, 1, 0, 1], col, st);
    }
    prev = cur;
  }
  // kanatlar (ok açılı), yatay stabilizeler, dikey kuyruk
  const wing = (u0, span, chord, sweep, y0, col) => {
    for (const sd of [-1, 1]) {
      const r0 = W(u0, sd * 1.8), r1 = W(u0 - chord, sd * 1.8), t0 = W(u0 - sweep, sd * span / 2), t1 = W(u0 - sweep - chord * 0.35, sd * span / 2);
      const pts = [[r0[0], y0, r0[1]], [t0[0], y0 + span * 0.03, t0[1]], [t1[0], y0 + span * 0.03, t1[1]], [r1[0], y0, r1[1]]];
      if (sd > 0) { b.quad(pts[0], pts[3], pts[2], pts[1], [0, 0, 1, 0, 1, 1, 0, 1], col, st); b.quad(pts[0], pts[1], pts[2], pts[3], [0, 0, 1, 0, 1, 1, 0, 1], gray, st); }
      else { b.quad(pts[0], pts[1], pts[2], pts[3], [0, 0, 1, 0, 1, 1, 0, 1], col, st); b.quad(pts[0], pts[3], pts[2], pts[1], [0, 0, 1, 0, 1, 1, 0, 1], gray, st); }
    }
  };
  wing(3.0, 34.1, 6.2, 7.0, yc - 1.3, white);
  wing(-14.5, 12.4, 3.4, 3.2, yc + 0.6, white);
  {
    const r0 = W(-12.5, 0), r1 = W(-18.4, 0), t0 = W(-17.2, 0), t1 = W(-19.4, 0);
    const pts = [[r0[0], yc + 1.6, r0[1]], [r1[0], yc + 1.8, r1[1]], [t1[0], yc + 7.6, t1[1]], [t0[0], yc + 7.6, t0[1]]];
    b.quad(pts[0], pts[1], pts[2], pts[3], [0, 0, 1, 0, 1, 1, 0, 1], tail, st);
    b.quad(pts[0], pts[3], pts[2], pts[1], [0, 0, 1, 0, 1, 1, 0, 1], tail, st);
  }
  // motorlar ve iniş takımı
  for (const sd of [-1, 1]) {
    const [ex, ez] = W(5.0, sd * 5.7);
    b.box(ex, yc - 2.9, ez, 4.4, 2.0, 2.0, a, [0.78, 0.79, 0.80], st);
    const [lx, lz] = W(-1.0, sd * 3.8);
    b.box(lx, y, lz, 0.6, 0.6, 2.2, a, dark, st);
  }
  const [nx, nz] = W(13.5, 0);
  b.box(nx, y, nz, 0.4, 0.4, 2.0, a, dark, st);
}

export function buildLtfeExtras(world, group, o = {}) {
  const A = world.ltfe;
  if (!A) return null;
  const H = (x, z) => world.heightAt(x, z);
  const rand = mulberry32(330);
  const lights = [];
  const b = new ArchBuilder();
  const solids = [];
  const TW = 23;
  // ---- Taksi yolu kenar ışıkları (mavi)
  const nearTaxi = (x, z, self) => {
    let best = 1e9;
    for (const s of A.segs) {
      if (s === self) continue;
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
      best = Math.min(best, Math.hypot(x - s.ax - t * dx, z - s.az - t * dz));
    }
    return best;
  };
  for (const s of A.segs) {
    const L = Math.hypot(s.bx - s.ax, s.bz - s.az); if (L < 4) continue;
    const ux = (s.bx - s.ax) / L, uz = (s.bz - s.az) / L, nx = -uz, nz = ux;
    for (let d = 7.5; d < L; d += 30) for (const sd of [-1, 1]) {
      const x = s.ax + ux * d + nx * sd * (TW / 2 + 1.5), z = s.az + uz * d + nz * sd * (TW / 2 + 1.5);
      if (A.inRunway(x, z, 6) || A.aprons.some((p) => pointInPoly(p, x, z)) || nearTaxi(x, z, s) < TW / 2 + 0.5) continue;
      lights.push({ x, y: H(x, z) + 0.35, z, colA: BLUE, kind: 0, night: 1 });
    }
  }
  // ---- Apron kenar ışıkları (mavi)
  for (const poly of A.aprons) for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length], L = Math.hypot(q.x - p.x, q.z - p.z);
    for (let d = 10; d < L; d += 40) {
      const x = p.x + (q.x - p.x) * d / L, z = p.z + (q.z - p.z) * d / L;
      if (nearTaxi(x, z, null) < TW / 2 + 2 || A.inRunway(x, z, 8)) continue;
      lights.push({ x, y: H(x, z) + 0.35, z, colA: BLUE, kind: 0, night: 1 });
    }
  }
  // ---- Durma çubukları ve zorunlu talimat levhaları (bekleme konumlarında)
  const signs = [];
  for (const h of A.holds || []) {
    const cx = -h.dz, cz = h.dx;                         // taksi yolu enine
    for (let s = -TW / 2 + 1.5; s <= TW / 2 - 1.5; s += 3) {
      const x = h.x + cx * s - h.dx * 0.6, z = h.z + cz * s - h.dz * 0.6;
      lights.push({ x, y: H(x, z) + 0.12, z, colA: RED, colB: [0, 0, 0], kind: 1, dir: [-h.dx, -h.dz], world: true });
    }
    // pist tanımlayıcıları: eşik soldaysa önce o (görüş yönü: piste doğru)
    let best = null;
    for (const r of world.ltfeRunways) { const d = Math.abs((h.x - r.cx) * -r.uz + (h.z - r.cz) * r.ux); if (!best || d < best.d) best = { r, d }; }
    const r = best.r, lx = h.dz, lz = -h.dx;              // görüş yönünün solu
    const AonLeft = (r.A.x - h.x) * lx + (r.A.z - h.z) * lz > 0;
    const nA = r.ends[0].num + r.ends[0].suffix, nB = r.ends[1].num + r.ends[1].suffix;
    const text = AonLeft ? `${nA}-${nB}` : `${nB}-${nA}`;
    for (const sd of [1, -1]) {
      const x = h.x + lx * sd * (TW / 2 + 9), z = h.z + lz * sd * (TW / 2 + 9);
      signs.push({ x, y: H(x, z), z, a: Math.atan2(-h.dz, -h.dx), text });
    }
  }
  // ---- Yaklaşma ışığı direkleri (eksen barretlerinin altında, arazi alçalırsa)
  for (const r of world.ltfeRunways) r.ends.forEach((e, ei) => {
    if (!e.light || !e.light.approach) return;
    const sgn = ei === 0 ? -1 : 1, T = ei === 0 ? r.A : r.B, yT = (ei === 0 ? r.eA : r.eB) + world.mslY;
    for (let d = 30; d <= e.light.approach.length; d += 30) {
      const x = T.x + r.ux * sgn * d, z = T.z + r.uz * sgn * d;
      const g = Math.max(H(x, z), world.mslY - 0.5), top = yT + 0.75 + sgn * 0;
      if (top - g > 0.4) {
        b.box(x, g - 0.3, z, 0.25, 0.25, top - g + 0.3, Math.atan2(r.uz, r.ux), [0.85, 0.42, 0.12], [0.2, 3, 3, 0]);
        b.box(x, top - 0.05, z, 0.2, 5.0, 0.1, Math.atan2(r.uz, r.ux), [0.8, 0.8, 0.8], [0.2, 3, 3, 0]);
      }
    }
  });
  // ---- Kontrol kulesi (YAKLAŞIK konum): en büyük terminal binasının karaya bakan yanında
  const term = A.buildings.filter((bb) => /terminal/i.test(bb.name || '')).sort((p, q) => (q.area || 0) - (p.area || 0))[0];
  let towerXZ = null;
  if (term) {
    const cx = term.pts.reduce((s, p) => s + p.x, 0) / term.pts.length, cz = term.pts.reduce((s, p) => s + p.z, 0) / term.pts.length;
    // pistlerden uzağa (apronun karşı tarafı): en yakın pist eksenine dik yönde 160 m
    const r = world.ltfeRunways[0];
    const v = (cx - r.cx) * -r.uz + (cz - r.cz) * r.ux, sg = Math.sign(v) || 1;
    towerXZ = { x: cx - r.uz * sg * 150 + r.ux * 120, z: cz + r.ux * sg * 150 + r.uz * 120 };
    const g = H(towerXZ.x, towerXZ.z);
    b.cylinder(towerXZ.x, g - 1, towerXZ.z, 3.6, 36, 12, [0.78, 0.77, 0.74], [0.3, 3, 3, 0]);
    b.cylinder(towerXZ.x, g + 35, towerXZ.z, 6.4, 1.2, 8, [0.7, 0.7, 0.7], [0.3, 3, 3, 0]);
    b.cylinder(towerXZ.x, g + 36.2, towerXZ.z, 6.0, 4.6, 8, [0.10, 0.16, 0.18], [0.31, 4.6, 2.2, 1]);
    b.cylinder(towerXZ.x, g + 40.8, towerXZ.z, 6.8, 0.9, 8, [0.72, 0.72, 0.72], [0.3, 3, 3, 0]);
    b.cylinder(towerXZ.x, g + 41.7, towerXZ.z, 0.15, 7, 5, [0.8, 0.8, 0.8], [0.3, 3, 3, 0]);
    lights.push({ x: towerXZ.x, y: g + 49, z: towerXZ.z, colA: RED, kind: 0, flash: 3 });
    // meydan feneri: beyaz/yeşil dönüşümlü (sivil kara meydanı)
    lights.push({ x: towerXZ.x + 0.8, y: g + 42.2, z: towerXZ.z, colA: [1, 1, 1], kind: 0, flash: 5, phase: 0 });
    lights.push({ x: towerXZ.x - 0.8, y: g + 42.2, z: towerXZ.z, colA: [0.25, 1, 0.45], kind: 0, flash: 5, phase: 1 });
    solids.push([towerXZ.x, towerXZ.z, 7, 7, 0, g - 1, g + 49]);
  }
  // ---- Apron projektör direkleri (25 m) — gece sıcak beyaz
  for (const poly of A.aprons) {
    const area = Math.abs(THREE.ShapeUtils.area(poly.map((p) => new THREE.Vector2(p.x, p.z))));
    if (area < 20000) continue;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length], L = Math.hypot(q.x - p.x, q.z - p.z);
      for (let d = 60; d < L - 20; d += 150) {
        const x = p.x + (q.x - p.x) * d / L, z = p.z + (q.z - p.z) * d / L;
        if (A.inRunway(x, z, 60) || nearTaxi(x, z, null) < 30) continue;
        const g = H(x, z);
        b.cylinder(x, g, z, 0.35, 25, 8, [0.72, 0.73, 0.74], [0.4, 3, 3, 0]);
        b.box(x, g + 25, z, 3.2, 1.2, 1.0, Math.atan2(q.z - p.z, q.x - p.x), [0.85, 0.85, 0.82], [0.4, 3, 3, 6]);
        lights.push({ x, y: g + 25.6, z, colA: [1.0, 0.93, 0.78], kind: 0, night: 1 });
        lights.push({ x, y: g + 26.6, z, colA: RED, kind: 0, flash: 3 });
        solids.push([x, z, 1.2, 1.2, 0, g, g + 26.5]);
      }
    }
  }
  // ---- Park hâlindeki uçaklar (kapılarda) + yer hizmet araçları
  const tails = [[0.70, 0.08, 0.08], [0.06, 0.22, 0.48], [0.95, 0.55, 0.08], [0.08, 0.40, 0.30], [0.30, 0.08, 0.40]];
  const gates = A.gates || [];
  for (let i = 0; i < gates.length; i++) {
    if (rand() < 0.3) continue;
    const gp = gates[i];
    // burun en yakın binaya dönük
    let near = null;
    for (const bb of A.buildings) for (const p of bb.pts) { const d = Math.hypot(p.x - gp.x, p.z - gp.z); if (!near || d < near.d) near = { d, p }; }
    const a = near ? Math.atan2(near.p.z - gp.z, near.p.x - gp.x) : 0;
    const cx = gp.x - Math.cos(a) * 18, cz = gp.z - Math.sin(a) * 18;
    const g = H(cx, cz);
    airliner(b, cx, g, cz, a, tails[i % tails.length], rand);
    solids.push([cx, cz, 19, 3, a, g, g + 12]);
    solids.push([cx + Math.cos(a) * 3, cz + Math.sin(a) * 3, 3.5, 17, a, g + 2, g + 4.5]);
    // çekici + iki bagaj arabası
    const tx = cx + Math.cos(a) * 24, tz = cz + Math.sin(a) * 24;
    b.box(tx, g, tz, 4.5, 2.4, 1.5, a, [0.92, 0.75, 0.12], [0.5, 3, 3, 0]);
    for (let k = 0; k < 2; k++) {
      const bx = cx - Math.sin(a) * (9 + k * 3.5) + Math.cos(a) * 6, bz = cz + Math.cos(a) * (9 + k * 3.5) + Math.sin(a) * 6;
      b.box(bx, g + 0.3, bz, 3.0, 1.6, 1.4, a, [0.5, 0.52, 0.55], [0.5, 3, 3, 0]);
    }
  }
  for (const s of solids) world.addSolidOBB(...s);
  if (!group) return { lights: lights.length, signs: signs.length };
  const mesh = new THREE.Mesh(b.geometry(), o.material);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'ltfe-extras';
  group.add(mesh);
  // levhalar: kırmızı zemin, beyaz yazı (ICAO zorunlu talimat levhası), kutu gövde
  if (signs.length && typeof document !== 'undefined') {
    const texts = [...new Set(signs.map((s) => s.text))];
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 128 * texts.length;
    const g2 = cv.getContext('2d');
    texts.forEach((t, i) => {
      g2.fillStyle = '#c4161c'; g2.fillRect(0, i * 128, 512, 128);
      g2.strokeStyle = '#111'; g2.lineWidth = 8; g2.strokeRect(4, i * 128 + 4, 504, 120);
      g2.fillStyle = '#ffffff'; g2.font = 'bold 84px Arial, sans-serif'; g2.textAlign = 'center'; g2.textBaseline = 'middle';
      g2.fillText(t, 256, i * 128 + 66);
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sm = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.0 });
    sm.userData.signNight = true;
    const geo0 = new THREE.BoxGeometry(0.3, 1.1, 3.6);
    for (const s of signs) {
      const geo = geo0.clone();
      const i = texts.indexOf(s.text), uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + 1 - uv.getY(k)) / texts.length);
      const m = new THREE.Mesh(geo, sm);
      m.position.set(s.x, s.y + 0.95, s.z); m.rotation.y = -s.a;
      m.castShadow = true;
      group.add(m);
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 2.8), sm);
      leg.position.set(s.x, s.y + 0.2, s.z); leg.rotation.y = -s.a;
      group.add(leg);
    }
    geo0.dispose();
    world.ltfeSignMat = sm;
  }
  const lp = buildLightPoints(lights, { far: 9000, minPx: 1.3 });
  lp.name = 'ltfe-taxi-apron-lights';
  group.add(lp);
  return { lights: lights.length, signs: signs.length, points: lp, mesh, tower: towerXZ };
}
