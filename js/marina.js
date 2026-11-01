// Milta Bodrum Marina, gulet rıhtımı, mendirek ve kumsallar.
// Tekneler: Akdeniz usulü kıçtan bağlama (kıç iskeleye, baş açığa). Her tekne kendi gövde biçimiyle
// (sivri baş, yuvarlak kıç, güverte sehimi) üretilir; boy, en, renk ve yön değişir: aynı tekne
// tekrar edilmez. Türler: motoryat (12-26 m), yelkenli (11-18 m, direk + bom), gulet (20-32 m,
// iki direk, cilalı ahşap gövde, kıç tentesi — Bodrum'un simgesi), mega yat (40-55 m).
// Mendirek: kaya tahkimatı (tek tek yerleştirilmiş bloklar) + beton kret duvarı + giriş feneri
// (IALA A bölgesi: denizden girerken iskele tarafı kırmızı).
import * as THREE from 'three';
import { ArchBuilder } from './archmat.js';
import { MSL_Y } from './geo.js';
import { mulberry32 } from './noise.js';
import { buildLightPoints } from './runway.js';

const WHITE = [0.86, 0.87, 0.88], NAVY = [0.05, 0.08, 0.16], GLASS = [0.03, 0.035, 0.04], TEAK = [0.36, 0.22, 0.11];

/**
 * Tekne gövdesi + üst yapı. (x, z) kıç ortası, a: başa doğru yön (yerel x ekseninden).
 * kind: 'motor' | 'sail' | 'gulet' | 'mega'
 */
export function boat(b, x, z, a, L, kind, rand) {
  const ca = Math.cos(a), sa = Math.sin(a);
  const W = (u, v, y) => [x + u * ca - v * sa, y, z + u * sa + v * ca];
  const B = kind === 'gulet' ? L * 0.27 : kind === 'sail' ? L * 0.31 : kind === 'mega' ? L * 0.19 : L * 0.29;
  const fb = kind === 'mega' ? 3.2 : kind === 'gulet' ? 1.9 : kind === 'sail' ? 1.1 : 1.6;     // fribord
  const sy = MSL_Y + 0.05;
  const hc = kind === 'gulet' ? (rand() < 0.6 ? TEAK : [0.06, 0.18, 0.30]) : kind === 'sail' ? (rand() < 0.75 ? WHITE : rand() < 0.5 ? NAVY : [0.12, 0.13, 0.14]) : (rand() < 0.85 ? WHITE : [0.20, 0.22, 0.25]);
  const st = [rand(), 3, 3, 0];
  // gövde kesitleri: t 0 (kıç) .. 1 (baş); yarı en, sehim ve baş lançası (güvertede öne taşma)
  const NS = 14, sec = [];
  for (let k = 0; k <= NS; k++) {
    const t = k / NS;
    let half = B / 2 * (t < 0.5 ? (kind === 'gulet' ? 0.84 + 0.16 * Math.sin(t / 0.5 * Math.PI / 2) : 0.90 + 0.10 * Math.sin(t / 0.5 * Math.PI / 2)) : Math.pow(Math.cos((t - 0.5) / 0.5 * Math.PI / 2), 0.75));
    half = Math.max(0.03, half);
    const sheer = fb + (kind === 'gulet' ? 1.0 * t * t * t + 0.25 * (1 - t) * (1 - t) : 0.45 * t * t);
    const rake = Math.pow(t, 3) * (kind === 'sail' ? 0.05 : 0.09) * L;     // baş lançası
    sec.push({ u: t * L, h: half, y: sy + sheer, rake, wl: half * (t > 0.85 ? 0.35 : 0.80) });
  }
  // yan yüzler: su hattında daralan V kesit (iki yüz bandı) + su hattı şeridi
  for (const side of [-1, 1]) {
    for (let k = 0; k < NS; k++) {
      const A = sec[k], Bs = sec[k + 1];
      const midA = sy + 0.45, midB = sy + 0.45;
      const p0 = W(A.u, side * A.wl, sy - 0.35), p1 = W(Bs.u, side * Bs.wl, sy - 0.35);
      const m0 = W(A.u + A.rake * 0.3, side * A.h * 0.97, midA), m1 = W(Bs.u + Bs.rake * 0.3, side * Bs.h * 0.97, midB);
      const p2 = W(Bs.u + Bs.rake, side * Bs.h, Bs.y), p3 = W(A.u + A.rake, side * A.h, A.y);
      const bt = kind === 'gulet' ? [0.85, 0.85, 0.82] : NAVY;
      if (side > 0) { b.quad(p0, p1, m1, m0, [A.u, 0, Bs.u, 0, Bs.u, 1, A.u, 1], bt, st); b.quad(m0, m1, p2, p3, [A.u, 1, Bs.u, 1, Bs.u, 2, A.u, 2], hc, st); }
      else { b.quad(p1, p0, m0, m1, [Bs.u, 0, A.u, 0, A.u, 1, Bs.u, 1], bt, st); b.quad(m1, m0, p3, p2, [Bs.u, 1, A.u, 1, A.u, 2, Bs.u, 2], hc, st); }
    }
  }
  // kıç aynası
  {
    const A = sec[0];
    b.quad(W(0, A.wl, sy - 0.35), W(0, -A.wl, sy - 0.35), W(0, -A.h, A.y), W(0, A.h, A.y), [0, 0, 1, 0, 1, 1, 0, 1], kind === 'gulet' ? TEAK : hc, st);
  }
  // güverte (tik ya da beyaz): kesitler arası şeritler
  const deckC = kind === 'gulet' || kind === 'sail' ? [0.42, 0.30, 0.18] : [0.80, 0.80, 0.78];
  for (let k = 0; k < NS; k++) {
    const A = sec[k], Bs = sec[k + 1];
    b.quad(W(A.u + A.rake, -A.h, A.y), W(A.u + A.rake, A.h, A.y), W(Bs.u + Bs.rake, Bs.h, Bs.y), W(Bs.u + Bs.rake, -Bs.h, Bs.y), [0, 0, 1, 0, 1, 1, 0, 1], deckC, st);
  }
  // üst yapı
  const dy = sec[5].y;
  const ubox = (u0, u1, w, y0, h, col, s = st) => {
    const [cx, , cz] = W((u0 + u1) / 2, 0, 0);
    b.box(cx, y0, cz, u1 - u0, w, h, a, col, s);
  };
  if (kind === 'motor' || kind === 'mega') {
    const decks = kind === 'mega' ? 3 : (L > 18 ? 2 : 1);
    let y0 = dy, u0 = L * 0.18, u1 = L * 0.72, w = B * 0.78;
    for (let d = 0; d < decks; d++) {
      const h = 2.3;
      ubox(u0, u1, w, y0, h * 0.42, WHITE);
      ubox(u0 + 0.3, u1 - 0.3, w * 0.97, y0 + h * 0.42, h * 0.4, GLASS);
      ubox(u0, u1, w, y0 + h * 0.82, 0.18, WHITE);
      y0 += h; u0 += L * 0.06; u1 -= L * 0.08; w *= 0.88;
    }
    if (kind === 'mega') { ubox(L * 0.45, L * 0.52, 1.2, y0, 3.5, [0.7, 0.7, 0.72]); }
    // hardtop direği
    ubox(L * 0.42, L * 0.46, 0.25, y0, 1.6, [0.6, 0.6, 0.62]);
  } else if (kind === 'sail') {
    ubox(L * 0.32, L * 0.6, B * 0.45, dy, 0.75, WHITE);
    ubox(L * 0.34, L * 0.58, B * 0.46, dy + 0.35, 0.22, GLASS);
    const mh = L * 1.25 + rand() * 2;
    const [mx, , mz] = W(L * 0.56, 0, 0);
    b.cylinder(mx, dy, mz, 0.09, mh, 5, [0.75, 0.75, 0.76], st);
    ubox(L * 0.2, L * 0.56, 0.16, dy + 2.2, 0.18, [0.6, 0.6, 0.6]);           // bom (sarılı yelken)
    ubox(L * 0.22, L * 0.54, 0.3, dy + 2.38, 0.28, [0.08, 0.12, 0.25]);       // yelken kılıfı
    return mh + dy;
  } else if (kind === 'gulet') {
    // kıç güvertesi yükseltilmiş, ahşap küpeşte, tente (beyaz), iki direk
    ubox(L * 0.0, L * 0.3, B * 0.92, dy, 0.9, TEAK);
    ubox(L * 0.02, L * 0.3, B * 0.95, dy + 2.6, 0.08, [0.92, 0.91, 0.86]);   // tente
    for (const u of [L * 0.04, L * 0.28]) for (const v of [-B * 0.42, B * 0.42]) { const [px, , pz] = W(u, v, 0); b.box(px, dy + 0.9, pz, 0.1, 0.1, 1.7, a, [0.3, 0.2, 0.12], st); }
    ubox(L * 0.3, L * 0.62, B * 0.6, dy, 1.4, [0.40, 0.26, 0.14]);
    ubox(L * 0.31, L * 0.61, B * 0.61, dy + 0.55, 0.45, GLASS);
    for (const [u, h] of [[L * 0.38, L * 0.85], [L * 0.7, L * 0.62]]) {
      const [mx, , mz] = W(u, 0, 0);
      b.cylinder(mx, dy, mz, 0.16, h, 6, [0.42, 0.30, 0.18], st);
    }
    // baş bastonu (bowsprit)
    const [bx, , bz] = W(L * 1.02, 0, 0);
    b.box(bx, sec[NS].y - 0.1, bz, L * 0.12, 0.2, 0.2, a, [0.42, 0.30, 0.18], st);
  }
  return dy + 3;
}

export function buildMarina(ctx) {
  const { D, P, PL } = ctx;
  const rand = mulberry32(48);
  const b = new ArchBuilder();
  const lights = [];
  let boats = 0;
  const yPont = MSL_Y + 0.45;
  // ---- İskeleler (yüzer beton) + kıçtan bağlı tekneler
  for (const [e, n0, n1] of D.pontoons) {
    const A = P(e, n0), B2 = P(e, n1);
    const dx = B2.x - A.x, dz = B2.z - A.z, L = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    b.box((A.x + B2.x) / 2, MSL_Y - 0.4, (A.z + B2.z) / 2, L, 3.2, 0.85, a, [0.66, 0.64, 0.6], [0.2, 3, 3, 0]);
    // elektrik/su dikmeleri ve iskele lambaları
    for (let s = 6; s < L; s += 12) {
      for (const sd of [-1, 1]) b.box(A.x + ux * s + nx * sd * 1.2, yPont, A.z + uz * s + nz * sd * 1.2, 0.35, 0.35, 0.9, a, [0.85, 0.85, 0.82], [0.3, 3, 3, 0]);
      if ((s / 12 | 0) % 2 === 0) lights.push({ x: A.x + ux * s, y: yPont + 3.2, z: A.z + uz * s, colA: [1.0, 0.82, 0.55], kind: 0, night: 1 });
    }
    // her iki yanda tekneler: kıç iskeleye dönük
    for (const sd of [-1, 1]) {
      let s = 4 + rand() * 3;
      while (s < L - 4) {
        const r = rand();
        const kind = r < 0.42 ? 'motor' : r < 0.82 ? 'sail' : 'gulet';
        const len = kind === 'motor' ? 12 + rand() * 12 : kind === 'sail' ? 11 + rand() * 7 : 20 + rand() * 9;
        const beam = len * (kind === 'gulet' ? 0.27 : 0.3);
        s += beam / 2 + 0.6;
        if (s > L - 3) break;
        const yaw = Math.atan2(nz * sd, nx * sd) + (rand() - 0.5) * 0.06;
        const bx = A.x + ux * s + nx * sd * 2.4, bz = A.z + uz * s + nz * sd * 2.4;
        boat(b, bx, bz, yaw, len, kind, rand);
        ctx.obb(bx + Math.cos(yaw) * len / 2, bz + Math.sin(yaw) * len / 2, len / 2, beam / 2, yaw, MSL_Y - 2, MSL_Y + (kind === 'sail' ? len * 1.3 : 6));
        s += beam / 2 + 0.6; boats++;
      }
    }
  }
  // ---- Gulet rıhtımı: kale boynunun batısında kıçtan bağlı guletler (baş batıya)
  {
    const line = ctx.city.quays[1];
    for (let i = 0; i + 1 < line.length; i++) {
      const A = line[i], B2 = line[i + 1];
      const dx = B2.x - A.x, dz = B2.z - A.z, L = Math.hypot(dx, dz);
      const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;     // su tarafı
      let s = 5;
      while (s < L - 5) {
        const len = 22 + rand() * 10, beam = len * 0.27;
        s += beam / 2 + 0.8;
        const yaw = Math.atan2(nz, nx) + (rand() - 0.5) * 0.05;
        const bx = A.x + ux * s + nx * 3.2, bz = A.z + uz * s + nz * 3.2;
        boat(b, bx, bz, yaw, len, 'gulet', rand);
        ctx.obb(bx + Math.cos(yaw) * len / 2, bz + Math.sin(yaw) * len / 2, len / 2, beam / 2, yaw, MSL_Y - 2, MSL_Y + 20);
        s += beam / 2 + 0.8; boats++;
      }
    }
  }
  // ---- Mega yatlar (mendirek iç tarafı) ve demirli tekneler (Kumbahçe, Gümbet)
  for (const [e, n, h, len] of [[-520, 40, 75, 48], [-380, 30, 82, 42], [-280, 60, 70, 36]]) {
    const p = P(e, n);
    boat(b, p.x, p.z, ctx.dirAngle(h), len, 'mega', rand);
    boats++;
  }
  const anchor = (e0, n0, r, k, kinds) => {
    for (let i = 0; i < k; i++) {
      const p = P(e0 + (rand() - 0.5) * r * 2, n0 + (rand() - 0.5) * r);
      if (ctx.ground(p.x, p.z) > MSL_Y - 2.5) continue;
      const kind = kinds[Math.floor(rand() * kinds.length)];
      const len = kind === 'gulet' ? 22 + rand() * 8 : kind === 'sail' ? 10 + rand() * 6 : 9 + rand() * 9;
      // demirdeki tekneler rüzgâra (meltem: KKB) burnunu verir
      boat(b, p.x, p.z, ctx.dirAngle(330 + (rand() - 0.5) * 30), len, kind, rand);
      boats++;
    }
  };
  anchor(450, -120, 260, 9, ['sail', 'motor', 'gulet']);
  anchor(-2380, -350, 260, 8, ['sail', 'motor', 'gulet', 'gulet']);
  anchor(-150, -380, 320, 6, ['gulet', 'sail', 'motor']);
  // ---- Mendirek: kaya bloklar + kret duvarı + fener
  const bw = ctx.city.breakwater;
  const rocks = [];
  for (let i = 0; i + 1 < bw.length; i++) {
    const A = bw[i], B2 = bw[i + 1], dx = B2.x - A.x, dz = B2.z - A.z, L = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
    const ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
    b.box((A.x + B2.x) / 2, MSL_Y + 1.6, (A.z + B2.z) / 2, L + 1, 5, 1.2, a, [0.70, 0.68, 0.64], [0.6, 3, 3, 0]);
    b.box((A.x + B2.x) / 2 + nx * 2.2, MSL_Y + 2.8, (A.z + B2.z) / 2 + nz * 2.2, L + 1, 1.0, 1.4, a, [0.66, 0.64, 0.6], [0.6, 3, 3, 0]);
    for (let s = 0; s < L; s += 2.2) for (const sd of [-1, 1]) for (let row = 0; row < 3; row++) {
      const off = sd * (4.2 + row * 2.6) + (rand() - 0.5) * 1.2;
      rocks.push([A.x + ux * s + nx * off, MSL_Y + 1.3 - row * 1.25 + (rand() - 0.5) * 0.5, A.z + uz * s + nz * off, 1.0 + rand() * 0.9, rand() * 6.28, rand() * 6.28]);
    }
  }
  {
    const E = bw[bw.length - 1];
    b.cylinder(E.x, MSL_Y + 2.4, E.z, 1.5, 7.5, 10, [0.85, 0.12, 0.1], [0.7, 3, 3, 0]);
    b.cylinder(E.x, MSL_Y + 9.9, E.z, 0.9, 1.4, 8, [0.9, 0.9, 0.9], [0.7, 3, 3, 0]);
    lights.push({ x: E.x, y: MSL_Y + 11.6, z: E.z, colA: [1.0, 0.12, 0.08], kind: 0, flash: 1 });
    ctx.obb(E.x, E.z, 2, 2, 0, MSL_Y, MSL_Y + 12);
    // kale ucunda yeşil fener (giriş sancak tarafı)
    const g = P(-40, -150);
    lights.push({ x: g.x, y: MSL_Y + 12, z: g.z, colA: [0.2, 1.0, 0.4], kind: 0, flash: 2 });
  }
  if (ctx.headless) return;
  const rockGeo = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8c877d, roughness: 0.95, flatShading: true });
  const rm = new THREE.InstancedMesh(ctx.track(rockGeo), ctx.track(rockMat), rocks.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e3 = new THREE.Euler(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  rocks.forEach((r, i) => { q.setFromEuler(e3.set(r[4], r[5], 0)); sc.set(r[3] * 1.2, r[3] * 0.8, r[3]); m4.compose(pv.set(r[0], r[1], r[2]), q, sc); rm.setMatrixAt(i, m4); });
  rm.castShadow = true; rm.receiveShadow = true; rm.name = 'breakwater-rocks';
  const c0 = P(-420, 200);
  ctx.addChunk(rm, c0.x, c0.z, 300, 7000);
  // ---- Kumsal şemsiyeleri ve şezlonglar (Kumbahçe, Gümbet)
  const umb = [];
  for (const [e0, n0, e1, n1] of [[200, 140, 720, 165], [-2580, 0, -2230, 20]]) {
    const A = P(e0, n0), B2 = P(e1, n1), L = Math.hypot(B2.x - A.x, B2.z - A.z);
    for (let s = 6; s < L; s += 7.5) for (let row = 0; row < 3; row++) {
      const t = s / L, px = A.x + (B2.x - A.x) * t, pz = A.z + (B2.z - A.z) * t;
      const n = { x: -(B2.z - A.z) / L, z: (B2.x - A.x) / L };
      const off = -8 - row * 7;
      const x = px + n.x * off, z = pz + n.z * off;
      const g = ctx.ground(x, z);
      if (g < MSL_Y + 0.3) continue;
      umb.push([x, g, z, row]);
    }
  }
  const ub = new ArchBuilder();
  for (const [x, y, z, row] of umb) {
    const col = row % 2 ? [0.80, 0.42, 0.18] : [0.10, 0.30, 0.55];
    ub.cylinder(x, y, z, 0.04, 2.3, 4, [0.85, 0.85, 0.85], [0.1, 3, 3, 0]);
    // şemsiye: alçak altıgen koni
    const n = 6, r = 1.25, top = y + 2.45, base = ub.count;
    ub.vert(x, top, z, 0, 1, 0, 0, 0, col, [0.1, 3, 3, 0]);
    for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; ub.vert(x + Math.cos(a) * r, top - 0.35, z + Math.sin(a) * r, Math.cos(a) * 0.4, 0.9, Math.sin(a) * 0.4, 0, 0, col, [0.1, 3, 3, 0]); }
    for (let k = 0; k < n; k++) ub.idx.push(base, base + 1 + (k + 1) % n, base + 1 + k);
    for (const sd of [-1, 1]) ub.box(x + sd * 0.9, y, z + 1.2, 0.7, 1.9, 0.32, 0.1, [0.92, 0.92, 0.9], [0.1, 3, 3, 0]);
  }
  if (umb.length) {
    const um = new THREE.Mesh(ctx.track(ub.geometry()), ctx.mats.archDS);
    um.castShadow = true; um.receiveShadow = true; um.name = 'beach-umbrellas';
    ctx.addChunk(um, c0.x, c0.z, 1800, 3500, { noReflect: true });
  }
  const mesh = new THREE.Mesh(ctx.track(b.geometry()), ctx.mats.arch);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'marina';
  ctx.addChunk(mesh, c0.x, c0.z, 1200, 12000);
  // ışıklar (gece; GL noktaları)
  if (ctx.headless) return;
  const lp = buildLightPoints(lights, { far: 9000, minPx: 1.6 });
  lp.name = 'marina-lights';
  ctx.track(lp.geometry); ctx.track(lp.material);
  ctx.root.add(lp);
  ctx.lights(lp);
  ctx.city.stats = Object.assign(ctx.city.stats || {}, { boats, rocks: rocks.length, umbrellas: umb.length });
}
