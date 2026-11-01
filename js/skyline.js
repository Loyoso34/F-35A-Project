// Gümbet Körfez Bölgesi (KURGUSAL): Gümbet koyunun başındaki düzlükte modern siluet.
// Az sayıda, her biri özgün tasarımlı simge yapı + orta yükseklikte destek yapıları. Hiçbiri
// örneklenmiş kopya değildir; biçim, yükseklik, cam tonu, cephe bölmesi ve taç farklıdır.
//
//   1 Ege Tacı (248 m)   : yuvarlatılmış kare plan, yükseldikçe 28° burulur ve incelir, gökbahçe
//                          bantları, kafes taç + 36 m sivri uç (gece aydınlatmalı)
//   2 Yelken (192 m)     : mercek plan; arka kenar yukarı doğru içe kıvrılır (yelken silueti), direk
//   3 Teraslar (150 m)   : kademeli geri çekilmeler, bitkili teraslar, bronz cam + taş dikey kanatlar
//   4 İkiz Kapılar (2 × 158 m): pahlı kare iki kule, 118-130 m'de gök köprüsü
//   5 Prizma (176 m)     : pahlı üçgen plan, yönlü cephe, eğik yüzlü taç
//   6 Silindir (128 m)   : yatay güneş kırıcı halkalar, helikopter pisti
//   7 Konut kuleleri (104 / 92 m): kesintisiz balkon döşemeleri, cam korkuluk
//   8 Otel (72 m)        : körfeze bakan kavisli levha, balkonlar
// Podyumlar (vitrinli zemin kat), çatı mekanik katları, cephe bakım vinçleri (BMU), antenler,
// ICAO uyarı ışıkları (kırmızı, gece yanıp söner) — havacılık açısından da tutarlı.
import * as THREE from 'three';
import { ArchBuilder } from './archmat.js';
import { mulberry32 } from './noise.js';
import { buildLightPoints } from './runway.js';

const DEG = Math.PI / 180;

// Blok ızgarası (E ve N sokak hatları): dolgu blokları ve park için
const GRID_E = [-2650, -2570, -2385, -2195, -1990, -1760];
const GRID_N = [40, 150, 340, 530, 715, 860];
export const PARK_BLOCK = [[-2560, 540], [-2395, 540], [-2395, 705], [-2560, 705]];

export const SKYLINE = {
  // Sokaklar (E, N): bulvar + çapraz sokaklar. cls: 3 bulvar, 5 sokak
  streets: [
    { pts: [[-2385, 40], [-2385, 860]], hw: 13, cls: 3, median: 6 },
    { pts: [[-2650, 150], [-1760, 150]], hw: 7.5, cls: 5 },
    { pts: [[-2660, 340], [-1720, 340]], hw: 7.5, cls: 5 },
    { pts: [[-2650, 530], [-1720, 530]], hw: 7.5, cls: 5 },
    { pts: [[-2600, 715], [-1790, 715]], hw: 7.5, cls: 5 },
    { pts: [[-2570, 40], [-2570, 760]], hw: 6.5, cls: 5 },
    { pts: [[-2195, 30], [-2195, 840]], hw: 6.5, cls: 5 },
    { pts: [[-1990, -10], [-1990, 800]], hw: 6.5, cls: 5 },
    { pts: [[-2630, 55], [-2200, 50], [-2060, 0]], hw: 6, cls: 5, promenade: true },
  ],
  park: [[-2391, 60], [-2379, 60], [-2379, 840], [-2391, 840]],
  plaza: [[-2350, 200], [-2210, 200], [-2210, 300], [-2350, 300]],
};

// ---- Yardımcılar ------------------------------------------------------------------------------
function roundedRect(w, d, r, n = 4) {
  const pts = [];
  const cs = [[w / 2 - r, d / 2 - r, 0], [-w / 2 + r, d / 2 - r, 90], [-w / 2 + r, -d / 2 + r, 180], [w / 2 - r, -d / 2 + r, 270]];
  for (const [cx, cz, a0] of cs) for (let k = 0; k <= n; k++) { const a = (a0 + k / n * 90) * DEG; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return pts;
}
function chamferRect(w, d, c) {
  return [[w / 2, -d / 2 + c], [w / 2, d / 2 - c], [w / 2 - c, d / 2], [-w / 2 + c, d / 2], [-w / 2, d / 2 - c], [-w / 2, -d / 2 + c], [-w / 2 + c, -d / 2], [w / 2 - c, -d / 2]];
}
const rot = (pts, a) => { const c = Math.cos(a), s = Math.sin(a); return pts.map(([x, z]) => [x * c - z * s, x * s + z * c]); };
const scl = (pts, k, kz = k) => pts.map(([x, z]) => [x * k, z * kz]);
const tr = (pts, x, z) => pts.map(([a, b]) => [a + x, b + z]);
function area2(p) { let s = 0; for (let i = 0; i < p.length; i++) { const a = p[i], b = p[(i + 1) % p.length]; s += a[0] * b[1] - b[0] * a[1]; } return s; }
const orient = (p) => (area2(p) < 0 ? p.slice().reverse() : p);

/**
 * Halkalar arası örgü (eş köşe sayılı çokgenler). rings: [{ y, pts }] (merkeze göre). Yumuşak yatay
 * normaller; u: çevre metresi, v: zeminden yükseklik.
 */
function loft(b, cx, cz, y0, rings, col, style, opts = {}) {
  const n = rings[0].pts.length;
  for (let r = 0; r + 1 < rings.length; r++) {
    const A = orient(rings[r].pts), B = orient(rings[r + 1].pts);
    const ya = rings[r].y, yb = rings[r + 1].y;
    let u = 0;
    for (let k = 0; k < n; k++) {
      const k1 = (k + 1) % n;
      const L = Math.hypot(A[k1][0] - A[k][0], A[k1][1] - A[k][1]);
      const nrm = (P, i) => {
        const p = P[(i - 1 + n) % n], q = P[(i + 1) % n];
        const dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz) || 1;
        return opts.flat ? null : [dz / l, -dx / l];
      };
      let nA0 = nrm(A, k), nA1 = nrm(A, k1), nB0 = nrm(B, k), nB1 = nrm(B, k1);
      if (opts.flat) { const dx = A[k1][0] - A[k][0], dz = A[k1][1] - A[k][1], l = L || 1; nA0 = nA1 = nB0 = nB1 = [dz / l, -dx / l]; }
      const i0 = b.vert(cx + A[k][0], ya, cz + A[k][1], nA0[0], 0, nA0[1], u, ya - y0, col, style);
      const i1 = b.vert(cx + A[k1][0], ya, cz + A[k1][1], nA1[0], 0, nA1[1], u + L, ya - y0, col, style);
      const i2 = b.vert(cx + B[k1][0], yb, cz + B[k1][1], nB1[0], 0, nB1[1], u + L, yb - y0, col, style);
      const i3 = b.vert(cx + B[k][0], yb, cz + B[k][1], nB0[0], 0, nB0[1], u, yb - y0, col, style);
      b.idx.push(i0, i2, i1, i0, i3, i2);
      u += L;
    }
  }
  if (!opts.noTop) {
    const T = rings[rings.length - 1];
    b.cap(T.pts.map(([x, z]) => [cx + x, cz + z]), T.y, 1, opts.topCol || [0.55, 0.56, 0.57], [style[0], 3, 3, 0]);
  }
}

/** Çatı: mekanik kat, soğutma üniteleri, antenler, BMU vinci; uyarı ışıkları listeye eklenir. */
function rooftop(b, cx, cz, y, w, d, a, rand, lights, opts = {}) {
  const gray = [0.42, 0.43, 0.44], dark = [0.22, 0.23, 0.24];
  const s = [rand(), 3, 3, 0];
  b.box(cx, y, cz, w * 0.55, d * 0.45, opts.pent || 5.5, a, [0.5, 0.51, 0.52], [s[0], 2.2, 1.2, 3]);
  const ca = Math.cos(a), sa = Math.sin(a);
  const L = (u, v) => [cx + u * ca - v * sa, cz + u * sa + v * ca];
  for (let i = 0; i < 4; i++) {
    const [x, z] = L((rand() - 0.5) * w * 0.7, (rand() > 0.5 ? 1 : -1) * d * 0.33);
    b.box(x, y, z, 2.4, 2.4, 1.8, a, gray, s);
    b.cylinder(x, y + 1.8, z, 0.9, 0.35, 8, dark, s);
  }
  if (!opts.noBmu) {
    // cephe bakım vinci: ray + kule + kol
    const [x, z] = L(w * 0.18, 0);
    b.box(x, y + (opts.pent || 5.5), z, 1.2, 1.2, 3.2, a, [0.85, 0.85, 0.82], s);
    const [x2, z2] = L(w * 0.18 + 5, 0);
    b.box(x2, y + (opts.pent || 5.5) + 3.2, z2, 12, 0.7, 0.7, a, [0.85, 0.85, 0.82], s);
  }
  const top = y + (opts.pent || 5.5);
  for (let i = 0; i < (opts.antennas || 2); i++) {
    const [x, z] = L((rand() - 0.5) * w * 0.3, (rand() - 0.5) * d * 0.2);
    const h = 6 + rand() * 9;
    b.cylinder(x, top, z, 0.12, h, 5, [0.75, 0.75, 0.76], s);
    lights.push({ x, y: top + h + 0.3, z, colA: [1.0, 0.08, 0.05], kind: 0, flash: 3 });
  }
  // köşe uyarı ışıkları
  for (const [u, v] of [[w / 2, d / 2], [-w / 2, -d / 2]]) { const [x, z] = L(u * 0.95, v * 0.95); lights.push({ x, y: y + 0.6, z, colA: [1.0, 0.08, 0.05], kind: 0, flash: 3 }); }
}

/** Podyum: vitrinli zemin kat + üst katlarda bant pencere; çatı terası. */
function podium(b, cx, y, cz, w, d, h, a, tint, rand) {
  const s = rand();
  b.box(cx, y - 2, cz, w, d, 2, a, [0.55, 0.53, 0.5], [s, 3, 3, 0], { noTop: true });
  b.box(cx, y, cz, w, d, 5, a, [0.62, 0.6, 0.57], [s, 5, 6.5, 5], { topCol: [0.5, 0.5, 0.48] });
  b.box(cx, y + 5, cz, w, d, h - 5, a, tint, [s, 3.8, 4.5, 3], { topCol: [0.47, 0.48, 0.46] });
  // saçak (giriş kanopisi)
  const ca = Math.cos(a), sa = Math.sin(a);
  b.box(cx + (d / 2 + 2.5) * -sa, y + 4.6, cz + (d / 2 + 2.5) * ca, w * 0.45, 5, 0.35, a, [0.82, 0.83, 0.84], [s, 3, 3, 0]);
}

// ---- Simge yapılar ----------------------------------------------------------------------------
const TOWERS = [
  { id: 'crown', e: -2295, n: 255, h: 248, a: 12 },
  { id: 'sail', e: -2490, n: 175, h: 192, a: -18 },
  { id: 'terraces', e: -2495, n: 445, h: 150, a: 0 },
  { id: 'twins', e: -2095, n: 450, h: 158, a: 0 },
  { id: 'prism', e: -2285, n: 615, h: 176, a: 25 },
  { id: 'cylinder', e: -1915, n: 255, h: 128, a: 0 },
  { id: 'resA', e: -2640, n: 300, h: 104, a: 0 },
  { id: 'resB', e: -1890, n: 620, h: 92, a: 90 },
  { id: 'hotel', e: -2095, n: 95, h: 72, a: 0 },
];
// Destek yapıları (orta yükseklik): [E, N, en, derinlik, yükseklik, tür, ton]
const MIDS = [
  [-2480, 255, 26, 22, 48, 3, 0], [-2280, 430, 30, 24, 64, 1, 1], [-2100, 250, 28, 26, 56, 1, 2],
  [-2120, 610, 28, 28, 78, 1, 4], [-1880, 440, 30, 24, 50, 3, 5],
  [-2620, 470, 24, 24, 38, 3, 6], [-2290, 780, 40, 22, 34, 3, 7], [-2090, 780, 30, 22, 46, 1, 0],
  [-1890, 770, 26, 26, 30, 3, 1], [-2620, 640, 22, 30, 44, 1, 2], [-1990, 60, 34, 18, 36, 3, 3],
];
const TINTS = [
  [0.10, 0.20, 0.24], [0.16, 0.20, 0.24], [0.12, 0.17, 0.15], [0.22, 0.17, 0.12],
  [0.10, 0.14, 0.22], [0.18, 0.19, 0.20], [0.70, 0.66, 0.58], [0.55, 0.52, 0.47],
];

export function* buildSkyline(ctx) {
  const rand = mulberry32(2026);
  const lights = [];
  const b = new ArchBuilder();
  const groundAt = (x, z) => ctx.ground(x, z);
  const solids = [];
  const addSolid = (x, z, hw, hd, a, y0, y1) => solids.push([x, z, hw, hd, a, y0, y1]);
  for (const T of TOWERS) {
    const p = ctx.P(T.e, T.n);
    const g = groundAt(p.x, p.z);
    const a = ctx.dirAngle(90 + T.a);     // yapının yerel x ekseni (doğu) + dönüş
    const st = (tint, fh, bw, kind, seed) => [seed !== undefined ? seed : rand(), fh, bw, kind];
    if (ctx.headless) { addSolid(p.x, p.z, 22, 22, a, g, g + T.h); continue; }
    switch (T.id) {
      case 'crown': {
        podium(b, p.x, g, p.z, 64, 58, 14, a, TINTS[6], rand);
        const y0 = g + 14, H = T.h - 14 - 36, rings = [];
        const base = roundedRect(40, 40, 9, 5), NR = 34;
        for (let r = 0; r <= NR; r++) {
          const t = r / NR, k = 1 - 0.2 * t * t;
          rings.push({ y: y0 + t * H, pts: rot(scl(base, k), a + t * 28 * DEG) });
        }
        const style = st(TINTS[0], 3.9, 1.5, 1, 0.11);
        loft(b, p.x, p.z, g, rings, TINTS[0], style, { noTop: true });
        // gökbahçe bantları (koyu, girintili): üç yükseklikte
        for (const t of [0.28, 0.55, 0.8]) {
          const k = 1 - 0.2 * t * t, ang = a + t * 28 * DEG;
          const ring2 = [{ y: y0 + t * H - 2.2, pts: rot(scl(base, k * 1.012), ang) }, { y: y0 + t * H + 2.2, pts: rot(scl(base, k * 1.012), ang) }];
          loft(b, p.x, p.z, g, ring2, [0.08, 0.09, 0.1], [0.5, 4.4, 2.2, 3], { noTop: true });
        }
        const top = y0 + H, kTop = 0.8, angT = a + 28 * DEG;
        b.cap(rot(scl(base, kTop), angT).map(([x, z]) => [p.x + x, p.z + z]), top, 1, [0.4, 0.4, 0.42], [0.1, 3, 3, 0]);
        // kafes taç: ince dikey elemanlar halkası + iki yatay halka, ortada sivri uç
        const crownPts = rot(scl(base, kTop * 0.98), angT);
        for (let i = 0; i < crownPts.length; i += 1) {
          const [x, z] = crownPts[i];
          b.box(p.x + x, top, p.z + z, 0.8, 0.8, 22 - (i % 2) * 6, angT, [0.82, 0.84, 0.86], [0.2, 3, 3, 6]);
        }
        for (const yy of [top + 8, top + 15]) loft(b, p.x, p.z, g, [{ y: yy, pts: rot(scl(base, kTop * 0.99), angT) }, { y: yy + 1.0, pts: rot(scl(base, kTop * 0.99), angT) }], [0.8, 0.82, 0.84], [0.2, 3, 3, 6], { noTop: true });
        rooftop(b, p.x, p.z, top, 22, 22, angT, rand, lights, { noBmu: true, antennas: 0, pent: 6 });
        b.cylinder(p.x, top + 6, p.z, 1.6, 10, 8, [0.8, 0.82, 0.84], [0.3, 3, 3, 0]);
        b.cylinder(p.x, top + 16, p.z, 0.7, 20, 6, [0.85, 0.86, 0.88], [0.3, 3, 3, 6]);
        lights.push({ x: p.x, y: top + 36.5, z: p.z, colA: [1.0, 0.08, 0.05], kind: 0, flash: 3 });
        for (const yy of [g + 90, g + 170]) for (const s of [-1, 1]) lights.push({ x: p.x + s * 18 * Math.cos(a), y: yy, z: p.z + s * 18 * Math.sin(a), colA: [1.0, 0.1, 0.06], kind: 0, flash: 3 });
        addSolid(p.x, p.z, 21, 21, a, g, top + 36);
        break;
      }
      case 'sail': {
        podium(b, p.x, g, p.z, 70, 40, 12, a, TINTS[7], rand);
        const y0 = g + 12, H = T.h - 12, rings = [], NR = 26;
        for (let r = 0; r <= NR; r++) {
          const t = r / NR;
          const Lf = 30, Lb = 30 - 26 * Math.pow(t, 1.6), D = 24 * (1 - 0.35 * t);
          const pts = [];
          const n = 18;
          for (let k = 0; k <= n; k++) { const s = k / n; const xx = -Lb + (Lf + Lb) * s; pts.push([xx, -D / 2 * Math.sin(Math.PI * s) - 0.01]); }
          for (let k = n - 1; k >= 1; k--) { const s = k / n; const xx = -Lb + (Lf + Lb) * s; pts.push([xx, D / 2 * Math.sin(Math.PI * s) * 0.55 + 0.01]); }
          rings.push({ y: y0 + t * H, pts: rot(pts, a) });
        }
        loft(b, p.x, p.z, g, rings, TINTS[1], st(TINTS[1], 3.7, 1.6, 1, 0.31));
        // direk: ön kenar boyunca, çatının 30 m üstüne
        const [mx, mz] = [p.x + Math.cos(a) * 30, p.z + Math.sin(a) * 30];
        b.box(mx, g + 12, mz, 1.6, 1.6, H + 30, a, [0.86, 0.87, 0.88], [0.4, 3, 3, 6]);
        lights.push({ x: mx, y: g + T.h + 30.5, z: mz, colA: [1.0, 0.08, 0.05], kind: 0, flash: 3 });
        addSolid(p.x, p.z, 30, 12, a, g, g + T.h + 30);
        break;
      }
      case 'terraces': {
        podium(b, p.x, g, p.z, 52, 52, 10, a, TINTS[6], rand);
        let y = g + 10;
        const steps = [[36, 46], [31, 40], [26, 34], [21, 20]];
        for (const [w, h] of steps) {
          const pts = rot(chamferRect(w, w, 2), a);
          loft(b, p.x, p.z, g, [{ y, pts }, { y: y + h, pts }], TINTS[3], st(TINTS[3], 3.6, 1.35, 1, 0.52), { flat: true, topCol: [0.45, 0.44, 0.4] });
          // dikey taş kanatlar
          const ca = Math.cos(a), sa = Math.sin(a);
          for (let f = -w / 2 + 2; f <= w / 2 - 2; f += 3) for (const [fu, fv, fa] of [[f, -w / 2 - 0.5, 0], [f, w / 2 + 0.5, 0], [-w / 2 - 0.5, f, 90], [w / 2 + 0.5, f, 90]]) {
            b.box(p.x + fu * ca - fv * sa, y, p.z + fu * sa + fv * ca, fa ? 1.0 : 0.5, fa ? 0.5 : 1.0, h, a, [0.74, 0.70, 0.62], [0.5, 3, 3, 0]);
          }
          // teras saksıları (yeşil)
          for (let k = 0; k < 6; k++) {
            const ang = k / 6 * Math.PI * 2, rr = w / 2 + 1.6;
            b.box(p.x + Math.cos(ang) * rr, y + h, p.z + Math.sin(ang) * rr, 2.4, 2.4, 1.6, a, [0.10, 0.20, 0.06], [0.5, 3, 3, 0]);
          }
          y += h;
        }
        rooftop(b, p.x, p.z, y, 20, 20, a, rand, lights);
        addSolid(p.x, p.z, 18, 18, a, g, y + 8);
        break;
      }
      case 'twins': {
        podium(b, p.x, g, p.z, 110, 40, 12, a, TINTS[6], rand);
        const ca = Math.cos(a), sa = Math.sin(a);
        for (const s of [-1, 1]) {
          const cx = p.x + s * 30 * ca, cz = p.z + s * 30 * sa;
          const pts = rot(chamferRect(24, 24, 5), a);
          loft(b, cx, cz, g, [{ y: g + 12, pts }, { y: g + T.h - 10, pts }], TINTS[4], st(TINTS[4], 3.8, 1.5, 1, 0.71), { flat: true });
          // eğik cam taç
          const top = g + T.h - 10;
          const ptsTop = rot(chamferRect(18, 10, 3), a);
          loft(b, cx, cz, g, [{ y: top, pts }, { y: top + 10, pts: ptsTop }], TINTS[4], st(TINTS[4], 3.8, 1.5, 1, 0.73), { flat: true });
          rooftop(b, cx, cz, top + 10, 12, 6, a, rand, lights, { noBmu: true, antennas: 1, pent: 2 });
          addSolid(cx, cz, 12, 12, a, g, g + T.h + 6);
        }
        // gök köprüsü
        b.box(p.x, g + 118, p.z, 38, 14, 12, a, TINTS[4], [0.75, 3.8, 1.5, 1]);
        addSolid(p.x, p.z, 19, 7, a, g + 118, g + 130);
        break;
      }
      case 'prism': {
        podium(b, p.x, g, p.z, 60, 56, 12, a, TINTS[7], rand);
        const tri = (S, c) => {
          const out = [];
          for (let k = 0; k < 3; k++) {
            const a0 = (k * 120 - 90) * DEG, a1 = ((k + 1) * 120 - 90) * DEG;
            const P0 = [Math.cos(a0) * S, Math.sin(a0) * S], P1 = [Math.cos(a1) * S, Math.sin(a1) * S];
            const t0 = c / (S * 1.732);
            out.push([P0[0] + (P1[0] - P0[0]) * t0, P0[1] + (P1[1] - P0[1]) * t0], [P1[0] + (P0[0] - P1[0]) * t0, P1[1] + (P0[1] - P1[1]) * t0]);
          }
          return out;
        };
        const H = T.h - 12 - 22;
        const pts = rot(tri(30, 9), a);
        loft(b, p.x, p.z, g, [{ y: g + 12, pts }, { y: g + 12 + H, pts: rot(tri(27, 8), a) }], TINTS[5], st(TINTS[5], 3.6, 1.4, 1, 0.9), { flat: true, noTop: true });
        // eğik yüzlü taç (piramit kesik)
        loft(b, p.x, p.z, g, [{ y: g + 12 + H, pts: rot(tri(27, 8), a) }, { y: g + T.h, pts: rot(tri(9, 3), a + 0.3) }], TINTS[5], st(TINTS[5], 3.6, 1.4, 1, 0.93), { flat: true });
        lights.push({ x: p.x, y: g + T.h + 0.5, z: p.z, colA: [1.0, 0.08, 0.05], kind: 0, flash: 3 });
        addSolid(p.x, p.z, 24, 24, a, g, g + T.h);
        break;
      }
      case 'cylinder': {
        podium(b, p.x, g, p.z, 44, 44, 9, a, TINTS[6], rand);
        const y0 = g + 9, H = T.h - 9;
        b.cylinder(p.x, y0, p.z, 17, H, 32, TINTS[2], st(TINTS[2], 3.6, 1.6, 1, 0.13));
        // güneş kırıcı halkalar (her kat)
        for (let y = y0 + 3.6; y < y0 + H - 2; y += 3.6) b.cylinder(p.x, y, p.z, 18.1, 0.28, 32, [0.84, 0.85, 0.86], [0.15, 3, 3, 0]);
        // helikopter pisti
        b.cylinder(p.x, y0 + H, p.z, 15, 0.5, 24, [0.22, 0.23, 0.24], [0.16, 3, 3, 0]);
        b.box(p.x, y0 + H + 0.5, p.z, 1.2, 8, 0.05, a, [0.95, 0.95, 0.95], [0.1, 3, 3, 0]);
        b.box(p.x - 2.5 * Math.cos(a), y0 + H + 0.5, p.z - 2.5 * Math.sin(a), 1.2, 8, 0.05, a + Math.PI / 2, [0.95, 0.95, 0.95], [0.1, 3, 3, 0]);
        lights.push({ x: p.x + 15, y: y0 + H + 1, z: p.z, colA: [1.0, 0.08, 0.05], kind: 0, flash: 3 });
        addSolid(p.x, p.z, 18, 18, 0, g, g + T.h + 1);
        break;
      }
      case 'resA': case 'resB': {
        const W = 38, D = 20, a2 = a;
        podium(b, p.x, g, p.z, W + 8, D + 10, 8, a2, TINTS[6], rand);
        const pts = rot(chamferRect(W, D, 1.5), a2);
        const top = g + T.h;
        loft(b, p.x, p.z, g, [{ y: g + 8, pts }, { y: top, pts }], TINTS[6], st(TINTS[6], 3.15, 2.6, 3, rand()), { flat: true });
        const ca = Math.cos(a2), sa = Math.sin(a2);
        for (let y = g + 8 + 3.15; y < top - 1; y += 3.15) for (const s of [-1, 1]) {
          b.box(p.x - s * (D / 2 + 0.8) * sa, y - 0.15, p.z + s * (D / 2 + 0.8) * ca, W - 2, 1.6, 0.22, a2, [0.88, 0.88, 0.86], [0.5, 3, 3, 0]);
          b.box(p.x - s * (D / 2 + 1.55) * sa, y + 0.07, p.z + s * (D / 2 + 1.55) * ca, W - 2, 0.08, 1.0, a2, [0.30, 0.42, 0.45], [0.5, 3, 3, 0]);
        }
        rooftop(b, p.x, p.z, top, W * 0.6, D * 0.7, a2, rand, lights);
        addSolid(p.x, p.z, W / 2 + 2, D / 2 + 2, a2, g, top + 6);
        break;
      }
      case 'hotel': {
        const pts = [];
        const R0 = 150, ang0 = -22 * DEG, ang1 = 22 * DEG, n = 16;
        for (let k = 0; k <= n; k++) { const t = ang0 + (ang1 - ang0) * k / n; pts.push([Math.sin(t) * R0, R0 - Math.cos(t) * R0 - 9]); }
        for (let k = n; k >= 0; k--) { const t = ang0 + (ang1 - ang0) * k / n; pts.push([Math.sin(t) * (R0 + 18), R0 - Math.cos(t) * (R0 + 18) + 9]); }
        const P2 = rot(pts, a);
        loft(b, p.x, p.z, g, [{ y: g, pts: P2 }, { y: g + 6, pts: P2 }], [0.66, 0.64, 0.6], [0.4, 6, 6.5, 5], { flat: true, noTop: true });
        loft(b, p.x, p.z, g, [{ y: g + 6, pts: P2 }, { y: g + T.h, pts: P2 }], [0.80, 0.78, 0.74], [0.41, 3.1, 3.4, 3], { flat: true });
        // körfeze bakan balkonlar (güney yüzü)
        for (let y = g + 9.1; y < g + T.h - 1; y += 3.1) {
          for (let k = 0; k < n; k++) {
            const t = ang0 + (ang1 - ang0) * (k + 0.5) / n;
            const lx = Math.sin(t) * (R0 - 1.1), lz = R0 - Math.cos(t) * (R0 - 1.1) - 9;
            const [rx, rz] = rot([[lx, lz]], a)[0];
            b.box(p.x + rx, y, p.z + rz, (ang1 - ang0) / n * R0 - 0.4, 2.2, 0.2, a + t, [0.9, 0.9, 0.88], [0.5, 3, 3, 0]);
          }
        }
        rooftop(b, p.x, p.z, g + T.h, 40, 12, a, rand, lights, { antennas: 1 });
        addSolid(p.x, p.z, 55, 14, a, g, g + T.h + 6);
        break;
      }
    }
    yield 0.3;
  }
  // ---- Orta yükseklikte destek yapıları
  for (const [e, n, w, d, h, kind, ti] of MIDS) {
    const p = ctx.P(e, n), g = groundAt(p.x, p.z), a = ctx.dirAngle(90 + (rand() - 0.5) * 6);
    if (ctx.headless) { addSolid(p.x, p.z, w / 2, d / 2, a, g, g + h); continue; }
    const tint = kind === 1 ? TINTS[ti % 6] : TINTS[6 + (ti % 2)];
    b.box(p.x, g - 2, p.z, w + 4, d + 4, 2, a, [0.55, 0.53, 0.5], [rand(), 3, 3, 0], { noTop: true });
    b.box(p.x, g, p.z, w + 4, d + 4, 5, a, [0.62, 0.6, 0.57], [rand(), 5, 6.5, 5]);
    const fh = kind === 1 ? 3.7 : 3.3;
    b.box(p.x, g + 5, p.z, w, d, h - 5, a, tint, [rand(), fh, kind === 1 ? 1.5 : 3.2, kind], { topCol: [0.48, 0.49, 0.49] });
    rooftop(b, p.x, p.z, g + h, w, d, a, rand, lights, { antennas: rand() < 0.5 ? 1 : 0, noBmu: h < 50 });
    addSolid(p.x, p.z, w / 2 + 2, d / 2 + 2, a, g, g + h + 6);
  }
  // ---- Dolgu blokları: avlulu çevre blokları (5-8 kat) ve kule podyumlarının çevresinde alçak kanatlar
  const occ = TOWERS.map((T) => [T.e, T.n, T.id === 'twins' ? 60 : T.id === 'hotel' ? 70 : 38]).concat(MIDS.map((m) => [m[0], m[1], Math.max(m[2], m[3]) * 0.8 + 6]));
  for (let bi = 0; bi + 1 < GRID_E.length; bi++) for (let bj = 0; bj + 1 < GRID_N.length; bj++) {
    const e0 = GRID_E[bi] + (bi === 0 ? 0 : 8), e1 = GRID_E[bi + 1] - 8, n0 = GRID_N[bj] + 8, n1 = GRID_N[bj + 1] - 8;
    if (e1 - e0 < 30 || n1 - n0 < 30) continue;
    if (e0 >= -2560 && e1 <= -2395 && n0 >= 530 && n1 <= 715) continue;            // park
    const ce = (e0 + e1) / 2, cn = (n0 + n1) / 2;
    const taken = occ.filter(([e, n, r]) => e > e0 - r * 0.5 && e < e1 + r * 0.5 && n > n0 - r * 0.5 && n < n1 + r * 0.5);
    const wing = 13;
    const wings = [
      [ce, n0 + wing / 2, e1 - e0, wing], [ce, n1 - wing / 2, e1 - e0, wing],
      [e0 + wing / 2, cn, wing, n1 - n0 - 2 * wing], [e1 - wing / 2, cn, wing, n1 - n0 - 2 * wing],
    ];
    for (const [we, wn, ww, wd] of wings) {
      if (ww < 12 || wd < 10) continue;
      // kule/orta yapı ayak izine çarpan kanat atlanır
      if (taken.some(([e, n, r]) => Math.abs(e - we) < ww / 2 + r * 0.55 && Math.abs(n - wn) < wd / 2 + r * 0.55)) continue;
      const p = ctx.P(we, wn), g = groundAt(p.x, p.z), a = ctx.dirAngle(90);
      const floors = 5 + Math.floor(rand() * 4), h = floors * 3.3 + 1;
      if (ctx.headless) { addSolid(p.x, p.z, ww / 2, wd / 2, a, g, g + h); continue; }
      const tone = TINTS[6 + (rand() < 0.5 ? 0 : 1)].map((v) => v * (0.92 + rand() * 0.16));
      b.box(p.x, g - 2, p.z, ww, wd, 2, a, [0.5, 0.48, 0.45], [rand(), 3, 3, 0], { noTop: true });
      b.box(p.x, g, p.z, ww, wd, 4.6, a, [0.6, 0.58, 0.55], [rand(), 4.6, 6, 5]);
      b.box(p.x, g + 4.6, p.z, ww, wd, h - 4.6, a, tone, [rand(), 3.3, rand() < 0.5 ? 2.8 : 3.6, rand() < 0.3 ? 1 : 3], { topCol: [0.36, 0.42, 0.30] });
      // çatı: korkuluk + birkaç mekanik ünite
      b.box(p.x, g + h, p.z, ww - 4, wd - 4 > 2 ? wd - 4 : 2, 2.6, a, [0.55, 0.56, 0.56], [rand(), 3, 3, 0]);
      addSolid(p.x, p.z, ww / 2, wd / 2, a, g, g + h + 3);
    }
  }
  for (const s of solids) ctx.obb(s[0], s[1], s[2], s[3], s[4], s[5], s[6]);
  if (ctx.headless) return;
  const mesh = new THREE.Mesh(ctx.track(b.geometry()), ctx.mats.arch);
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = 'skyline';
  const c = ctx.P(-2250, 420);
  ctx.addChunk(mesh, c.x, c.z, 600, 60000);
  const lp = buildLightPoints(lights, { far: 30000, minPx: 1.8 });
  lp.name = 'skyline-obstruction-lights';
  ctx.track(lp.geometry); ctx.track(lp.material);
  ctx.root.add(lp);
  ctx.lights(lp);
  ctx.city.skylineCenter = c;
}
