// Bodrum Kalesi (St. Peter Kalesi, 1402-1523): iki koyun arasındaki burunda.
// Biçim: gerçek yerleşimin sadeleştirilmiş, tanınır bir yorumu (ölçüler hava fotoğraflarına göre
// yaklaşık [E]): denizden yükselen burç duvarları, iç sur, Fransız Kulesi (en yüksek, merkez),
// İtalyan Kulesi, İngiliz Kulesi (güneydoğu köşe, köşe kuleciklerle), Alman Kulesi (kuzey),
// Yılanlı Kule (batı), şapel (Gotik, sonradan camiye çevrildiği için minareli), kuzeyde kara
// tarafı dış surları ve kapı. Taş: bal rengi kireçtaşı.
import * as THREE from 'three';
import { ArchBuilder } from './archmat.js';
import { MSL_Y } from './geo.js';
import { mulberry32 } from './noise.js';

const STONE = [0.56, 0.45, 0.32], STONE2 = [0.50, 0.41, 0.30], ROOF = [0.30, 0.20, 0.14];

export function buildCastle(ctx) {
  const { D, P, ground } = ctx;
  const b = new ArchBuilder();
  const rand = mulberry32(1402);
  const C = D.castle;
  const c = P(C.c[0], C.c[1]);
  const ax = ctx.dirAngle(C.axis);            // burun ekseni (güneybatıya doğru)
  const ca = Math.cos(ax), sa = Math.sin(ax);
  // kale çerçevesi: u eksen boyunca (uca doğru +), v ekseninin solu
  const W = (u, v) => [c.x + u * ca - v * sa, c.z + u * sa + v * ca];
  const plateau = MSL_Y + 8.4;
  const st = (s) => [s, 3, 2, 4];
  const wallTop = (x0, z0, x1, z1, y, thick, h, s, merlons = true) => {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2;
    b.box(mx, y, mz, L + thick * 0.6, thick, h, a, rand() < 0.5 ? STONE : STONE2, st(s));
    if (!merlons) return;
    // mazgal dişleri
    const n = Math.floor(L / 2.4);
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      b.box(x0 + dx * t, y + h, z0 + dz * t, 1.3, thick * 0.9, 0.95, a, STONE2, st(s + k * 0.01), { noTop: false });
    }
  };
  const ring = (pts, y, thick, h, s, merl = true) => {
    for (let i = 0; i < pts.length; i++) {
      const A = pts[i], B = pts[(i + 1) % pts.length];
      wallTop(A[0], A[1], B[0], B[1], y, thick, h, s + i * 0.07, merl);
    }
  };
  // 1) Deniz burçları: burun çevresinde denizden (−1,5 m) yükselen duvar, platformun 2,2 m üstüne
  const sea = ctx.city.castlePoly.map((p) => [p.x, p.z]);
  const inset = (pts, d) => {
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    return pts.map(([x, z]) => { const dx = x - cx, dz = z - cz, l = Math.hypot(dx, dz); return [x - dx / l * d, z - dz / l * d]; });
  };
  const seaWall = inset(sea, 6);
  ring(seaWall, MSL_Y - 1.5, 3.2, plateau - (MSL_Y - 1.5) + 2.2, 0.1);
  // köşe burçları (deniz duvarı köşelerinde yarım yuvarlak kuleler)
  for (let i = 0; i < seaWall.length; i += 2) {
    const [x, z] = seaWall[i];
    b.cylinder(x, MSL_Y - 1.5, z, 4.2, plateau - MSL_Y + 4.5, 10, STONE, st(0.3 + i * 0.1));
  }
  // 2) İç sur (yukarı avlu)
  const inner = [W(-58, -46), W(-62, 40), W(10, 52), W(62, 30), W(66, -26), W(20, -52)];
  ring(inner, plateau, 2.6, 9.5, 0.5);
  // 3) Kuleler
  const tower = (u, v, w, d, h, s, opts = {}) => {
    const [x, z] = W(u, v);
    b.box(x, plateau - 2, z, w, d, h + 2, ax, STONE, st(s));
    // taç: hafif çıkıntılı korkuluk + dişler
    const top = plateau + h;
    b.box(x, top - 0.6, z, w + 0.9, d + 0.9, 0.6, ax, STONE2, st(s + 0.2));
    const per = 2 * (w + d), n = Math.floor(per / 2.2);
    for (let k = 0; k < n; k++) {
      const t = k / n * per;
      let lu, lv;
      if (t < w) { lu = -w / 2 + t; lv = -d / 2; } else if (t < w + d) { lu = w / 2; lv = -d / 2 + (t - w); } else if (t < 2 * w + d) { lu = w / 2 - (t - w - d); lv = d / 2; } else { lu = -w / 2; lv = d / 2 - (t - 2 * w - d); }
      const xx = x + lu * ca - lv * sa, zz = z + lu * sa + lv * ca;
      if (k % 2 === 0) b.box(xx, top, zz, 1.2, 1.2, 1.0, ax, STONE2, st(s + k * 0.01));
    }
    if (opts.turrets) for (const [tu, tv] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]) {
      const xx = x + tu * ca - tv * sa, zz = z + tu * sa + tv * ca;
      b.cylinder(xx, plateau + h * 0.55, zz, 1.5, h * 0.45 + 2.2, 8, STONE2, st(s + 0.5));
    }
    ctx.obb(x, z, w / 2 + 0.5, d / 2 + 0.5, ax, MSL_Y, top + 1.2);
    return top;
  };
  tower(-6, -2, 15, 15, 31, 1.1);                          // Fransız Kulesi
  tower(22, 14, 12, 12, 23, 1.3);                          // İtalyan Kulesi
  tower(46, -44, 18, 13, 27, 1.5, { turrets: true });      // İngiliz Kulesi
  tower(-60, 22, 12, 12, 18, 1.7);                       // Alman Kulesi
  tower(4, 52, 11, 11, 16, 1.9);                           // Yılanlı Kule
  tower(68, 24, 10, 10, 12, 2.1);                          // İspanyol Kulesi
  // 4) Şapel (Gotik nef + beşik çatı) ve minare
  {
    const [x, z] = W(14, -20);
    const L = 24, w = 10, h = 10.5;
    b.box(x, plateau - 1, z, L, w, h + 1, ax, STONE, st(2.3), { noTop: true });
    // beşik çatı: iki eğik yüz + alınlıklar
    const r = 3.4, top = plateau + h;
    const Pt = (lu, lv, y) => { const xx = x + lu * ca - lv * sa, zz = z + lu * sa + lv * ca; return [xx, y, zz]; };
    b.quad(Pt(-L / 2, -w / 2, top), Pt(L / 2, -w / 2, top), Pt(L / 2, 0, top + r), Pt(-L / 2, 0, top + r), [0, 0, L, 0, L, 5, 0, 5], ROOF, [2.4, 3, 3, 0]);
    b.quad(Pt(L / 2, w / 2, top), Pt(-L / 2, w / 2, top), Pt(-L / 2, 0, top + r), Pt(L / 2, 0, top + r), [0, 0, L, 0, L, 5, 0, 5], ROOF, [2.4, 3, 3, 0]);
    for (const su of [-1, 1]) {
      const a0 = Pt(su * L / 2, -w / 2, top), a1 = Pt(su * L / 2, w / 2, top), a2 = Pt(su * L / 2, 0, top + r);
      const base = b.count;
      const nx = su * ca, nz = su * sa;
      b.vert(a0[0], a0[1], a0[2], nx, 0, nz, 0, h, STONE, st(2.5));
      b.vert(a1[0], a1[1], a1[2], nx, 0, nz, w, h, STONE, st(2.5));
      b.vert(a2[0], a2[1], a2[2], nx, 0, nz, w / 2, h + r, STONE, st(2.5));
      if (su > 0) b.idx.push(base, base + 2, base + 1); else b.idx.push(base, base + 1, base + 2);
    }
    ctx.obb(x, z, L / 2, w / 2, ax, MSL_Y, top + r);
    // minare: kaide, gövde, şerefe, külah
    const [mx, mz] = W(-2, -27);
    b.box(mx, plateau, mz, 3.4, 3.4, 4, ax, STONE, st(2.7));
    b.cylinder(mx, plateau + 4, mz, 1.35, 15, 10, [0.70, 0.64, 0.54], st(2.8));
    b.cylinder(mx, plateau + 18.2, mz, 1.85, 0.6, 12, STONE2, st(2.9));
    const cone = new THREE.ConeGeometry(1.25, 4.2, 10);
    cone.translate(mx, plateau + 19 + 2.1, mz);
    ctx.obb(mx, mz, 2, 2, 0, MSL_Y, plateau + 23.5);
    ctx.coneGeo = cone;
  }
  // 5) Kara tarafı dış surları, hendek köprüsü ve kapı kulesi (kuzey)
  const outer = [W(-104, -70), W(-112, -10), W(-104, 54), W(-80, 74)];
  for (let i = 0; i + 1 < outer.length; i++) wallTop(outer[i][0], outer[i][1], outer[i + 1][0], outer[i + 1][1], plateau - 3, 3, 9, 3.1 + i * 0.1);
  {
    const [x, z] = W(-112, 20);
    b.box(x, plateau - 3, z, 9, 11, 13, ax, STONE, st(3.4));
    ctx.obb(x, z, 5, 6, ax, MSL_Y, plateau + 10);
  }
  // avlu döşemesi (taş): platformun hafif üstünde
  {
    const g = b.count;
    void g;
  }
  const geo = ctx.track(b.geometry());
  const mesh = new THREE.Mesh(geo, ctx.mats.arch);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'castle';
  ctx.addChunk(mesh, c.x, c.z, 140, 30000);
  if (ctx.coneGeo) {
    const cm = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.5, metalness: 0.6 });
    const m2 = new THREE.Mesh(ctx.track(ctx.coneGeo), ctx.track(cm));
    m2.castShadow = true;
    ctx.addChunk(m2, c.x, c.z, 140, 12000);
  }
  // Rıhtım duvarları (taş): rıhtım çizgileri boyunca, su seviyesinin altından kordon üstüne
  const qb = new ArchBuilder();
  for (const line of ctx.city.quays.slice(0, 2)) {
    for (let i = 0; i + 1 < line.length; i++) {
      const A = line[i], B = line[i + 1];
      const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
      // duvar, çizginin su tarafında (sağ)
      const nx = -dz / L, nz = dx / L;
      const mx = (A.x + B.x) / 2 - nx * 0.8, mz = (A.z + B.z) / 2 - nz * 0.8;
      qb.box(mx, MSL_Y - 3, mz, L + 1.6, 1.6, 4.6, a, [0.62, 0.58, 0.52], [0.4 + i * 0.1, 3, 2, 4]);
      // kordon taşı (açık renk kenar)
      qb.box(mx, MSL_Y + 1.6, mz, L + 1.6, 1.9, 0.18, a, [0.80, 0.78, 0.72], [0.4, 3, 2, 0]);
      // bağlama babaları
      const n = Math.floor(L / 9);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        qb.cylinder(A.x + dx * t - nx * 1.2, MSL_Y + 1.75, A.z + dz * t - nz * 1.2, 0.22, 0.55, 6, [0.08, 0.08, 0.09], [0.4, 3, 2, 0]);
      }
    }
  }
  const qm = new THREE.Mesh(ctx.track(qb.geometry()), ctx.mats.arch);
  qm.receiveShadow = true; qm.castShadow = false; qm.name = 'quays';
  ctx.addChunk(qm, c.x, c.z, 700, 9000);
}
