// Ege bitki örtüsü (v5.0): kızılçam (Pinus brutia — yarımadanın tepelerinde baskın), zeytin (alçak
// eğimlerde sıralı bahçeler), servi (köy ve şehir içinde), maki çalısı, palmiye (kordon ve bulvar).
// Yerleşim: çekirdek makro görüntüsünün yeşilliği (gerçek bitki dağılımı) + eğim + tasarım maskesi
// (kent, kum, kaya) + yollar. Her tür kendi örgüsüyle örneklenir; 2 km'lik kümeler mesafeyle
// gizlenir. Hafif rüzgâr salınımı (köşe gölgelendiricisi).
import * as THREE from 'three';
import { CORE, polySignedDist } from './coreterrain.js';
import { MSL_Y } from './geo.js';
import { mulberry32, smoothstep } from './noise.js';

function colored(geo, col, jitter, rand) {
  const n = geo.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const k = 1 - jitter + rand() * jitter * 2; c[i * 3] = col[0] * k; c[i * 3 + 1] = col[1] * k; c[i * 3 + 2] = col[2] * k; }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}
function merge(list) {
  let n = 0, ni = 0;
  for (const g of list) { n += g.attributes.position.count; ni += g.index ? g.index.count : g.attributes.position.count; }
  const p = new Float32Array(n * 3), nr = new Float32Array(n * 3), c = new Float32Array(n * 3), idx = [];
  let o = 0;
  for (const g0 of list) {
    const g = g0.index ? g0 : g0;
    p.set(g.attributes.position.array, o * 3); nr.set(g.attributes.normal.array, o * 3); c.set(g.attributes.color.array, o * 3);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx.push(g.index.array[i] + o);
    else for (let i = 0; i < g.attributes.position.count; i++) idx.push(i + o);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(p, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  out.setAttribute('color', new THREE.BufferAttribute(c, 3));
  out.setIndex(idx);
  return out;
}
/** Taç öbeği: küre benzeri, normaller merkezden dışa (yumuşak, hacimli ışık). */
function clump(r, sx, sy, sz, x, y, z, col, rand) {
  const g = new THREE.IcosahedronGeometry(r, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    const k = 1 + (rand() - 0.5) * 0.22;
    pos.setXYZ(i, vx * sx * k + x, vy * sy * k + y, vz * sz * k + z);
  }
  g.computeVertexNormals();
  // normal: merkezden dışa (yumuşak taç)
  const nr = g.attributes.normal;
  for (let i = 0; i < pos.count; i++) { const dx = pos.getX(i) - x, dy = pos.getY(i) - y, dz = pos.getZ(i) - z, l = Math.hypot(dx, dy, dz) || 1; nr.setXYZ(i, dx / l, dy / l, dz / l); }
  const gi = g.toNonIndexed ? g : g;
  return colored(gi, col, 0.12, rand);
}
function trunk(r0, r1, h, col, rand) {
  const g = new THREE.CylinderGeometry(r1, r0, h, 6, 1, true);
  g.translate(0, h / 2, 0);
  return colored(g, col, 0.08, rand);
}

function makeSpecies(rand) {
  const BARK = [0.16, 0.11, 0.07], PINE = [0.040, 0.075, 0.028], OLIVE = [0.12, 0.14, 0.085], CYP = [0.028, 0.055, 0.025], SHRUB = [0.055, 0.075, 0.035], PALM = [0.09, 0.15, 0.04];
  const pine = merge([trunk(0.32, 0.16, 7.5, BARK, rand), clump(1, 3.8, 1.5, 3.6, 0.4, 7.6, 0.2, PINE, rand), clump(1, 3.0, 1.3, 3.2, -1.6, 6.7, -0.8, PINE, rand), clump(1, 2.6, 1.1, 2.5, 1.5, 8.6, -1.0, [PINE[0] * 1.15, PINE[1] * 1.15, PINE[2] * 1.1], rand)]);
  const olive = merge([trunk(0.28, 0.18, 1.7, [0.2, 0.17, 0.13], rand), clump(1, 2.3, 1.5, 2.2, 0.2, 2.6, 0, OLIVE, rand), clump(1, 1.7, 1.2, 1.8, -0.9, 2.2, 0.6, OLIVE, rand)]);
  const cyp = merge([trunk(0.18, 0.12, 1.2, BARK, rand), clump(1, 0.95, 5.2, 0.95, 0, 5.6, 0, CYP, rand)]);
  const shrub = merge([clump(1, 1.5, 0.75, 1.4, 0, 0.55, 0, SHRUB, rand), clump(1, 1.0, 0.6, 1.1, 0.8, 0.45, 0.4, SHRUB, rand)]);
  // palmiye: hafif eğik gövde + 11 sarkık yaprak (çift yüzlü)
  const fronds = [];
  for (let k = 0; k < 11; k++) {
    const a = k / 11 * Math.PI * 2 + rand() * 0.3, L = 3.4 + rand() * 0.8;
    const pts = [], idx = [];
    const N = 5;
    for (let i = 0; i <= N; i++) {
      const t = i / N, rr = t * L, droop = -t * t * 1.8 + t * 0.8, w = 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.1));
      const cx = Math.cos(a) * rr, cz = Math.sin(a) * rr, px = -Math.sin(a) * w, pz = Math.cos(a) * w;
      pts.push(cx + px, 9.2 + droop, cz + pz, cx - px, 9.2 + droop - 0.1, cz - pz);
    }
    for (let i = 0; i < N; i++) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.setIndex(idx); g.computeVertexNormals();
    const nr = g.attributes.normal; for (let i = 0; i < nr.count; i++) { nr.setXYZ(i, nr.getX(i) * 0.4, Math.abs(nr.getY(i)) * 0.6 + 0.4, nr.getZ(i) * 0.4); }
    fronds.push(colored(g, PALM, 0.15, rand));
  }
  const pt = new THREE.CylinderGeometry(0.2, 0.28, 9.2, 7, 4, true); pt.translate(0, 4.6, 0);
  const palm = merge([colored(pt, [0.30, 0.25, 0.18], 0.1, rand), ...fronds]);
  return { pine, olive, cyp, shrub, palm };
}

function floraMaterial(side = THREE.FrontSide) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, side });
  m.envMapIntensity = 0.5;
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    sh.uniforms.uWind = FLORA_UNIFORMS.uWind;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      {
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float sway = sin(uWind * 1.3 + ip.x * 0.05 + ip.z * 0.07) * 0.05 * max(0.0, transformed.y - 1.5) / 8.0;
        transformed.x += sway; transformed.z += sway * 0.6;
      }`);
  };
  m.customProgramCacheKey = () => 'flora5' + side;
  return m;
}
export const FLORA_UNIFORMS = { uWind: { value: 0 } };

export function* buildFlora(ctx) {
  const city = ctx.city, core = ctx.core, q = ctx.q;
  const rand = mulberry32(1923);
  const sp = makeSpecies(rand);
  for (const g of Object.values(sp)) ctx.track(g);
  const mat = ctx.track(floraMaterial()), matDS = ctx.track(floraMaterial(THREE.DoubleSide));
  // yeşillik haritası (makro görüntüden; bodrum.js imageryMaps)
  const IM = city.imageryMaps();
  const green = (x, z) => (IM ? IM.at(IM.green, x, z) : 0.45);
  const mask = (x, z, ch) => {
    const T = core.maskT, u = Math.floor((x - CORE.x0) / CORE.size * T), v = Math.floor((z - CORE.z0) / CORE.size * T);
    if (u < 0 || v < 0 || u >= T || v >= T) return 0;
    return core.mask[(v * T + u) * 4 + ch] / 255;
  };
  const S = 2000;
  const chunks = new Map();
  const put = (kind, x, y, z, s, a, tint) => {
    const ci = Math.floor((x - CORE.x0) / S), cj = Math.floor((z - CORE.z0) / S), k = ci * 100 + cj;
    let c = chunks.get(k);
    if (!c) { c = { x: CORE.x0 + (ci + 0.5) * S, z: CORE.z0 + (cj + 0.5) * S, l: {} }; chunks.set(k, c); }
    (c.l[kind] || (c.l[kind] = [])).push([x, y, z, s, a, tint]);
  };
  const R = city.roads;
  const dens = q.trees || 1;
  let n = 0;
  // doğal örtü: 18 m hücreler
  const cell = 22;
  const N = Math.floor(CORE.size / cell);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = CORE.x0 + (i + rand()) * cell, z = CORE.z0 + (j + rand()) * cell;
      const h = core.rawAt(x, z);
      if (h < 1.2) continue;
      const urb = mask(x, z, 0), sand = mask(x, z, 1), rock = mask(x, z, 3);
      if (sand > 0.3) continue;
      const gr = green(x, z);
      const r0 = rand();
      if (urb > 0.4) {
        // kent içi: seyrek bahçe ağaçları (servi, zeytin)
        if (r0 < 0.035 * dens && R.nearRoad(x, z) > 3) { if (polySignedDist(city.skyPoly, x, z) < 0 || polySignedDist(city.castlePoly, x, z) < 15) continue; put(rand() < 0.5 ? 'cyp' : 'olive', x, h + MSL_Y, z, 0.8 + rand() * 0.5, rand() * 6.28, rand()); n++; }
        continue;
      }
      const sl = core.slopeAt(x, z);
      const pPine = gr * (0.62 - rock * 0.4) * smoothstep(0.02, 0.12, sl + 0.05) * dens;
      const pShrub = (0.08 + gr * 0.5) * (1 - rock * 0.5) * dens * 0.6;
      if (r0 < pPine) { if (R.nearRoad(x, z) < 4) continue; put('pine', x, h + MSL_Y - 0.3, z, 0.7 + rand() * 0.65, rand() * 6.28, rand()); n++; }
      else if (r0 < pPine + pShrub) { if (R.nearRoad(x, z) < 2.5) continue; put('shrub', x, h + MSL_Y - 0.15, z, 0.6 + rand() * 0.9, rand() * 6.28, rand()); n++; }
    }
    if ((j & 63) === 0) yield 0.2 + 0.5 * j / N;
  }
  // zeytin bahçeleri: alçak eğimlerde, düzenli sıralar (bahçe başına yön)
  for (let k = 0; k < 140 * dens; k++) {
    const x0 = CORE.x0 + 1500 + rand() * (CORE.size - 3000), z0 = CORE.z0 + 1500 + rand() * (CORE.size - 3000);
    const h0 = core.rawAt(x0, z0);
    if (h0 < 4 || h0 > 220 || core.slopeAt(x0, z0) > 0.14 || mask(x0, z0, 0) > 0.2) continue;
    const a = rand() * Math.PI, ca = Math.cos(a), sa = Math.sin(a), W = 60 + rand() * 120, D = 50 + rand() * 100;
    for (let u = -W / 2; u < W / 2; u += 7) for (let v = -D / 2; v < D / 2; v += 7) {
      const x = x0 + u * ca - v * sa + (rand() - 0.5), z = z0 + u * sa + v * ca + (rand() - 0.5);
      const h = core.rawAt(x, z);
      if (h < 1 || mask(x, z, 0) > 0.3 || R.nearRoad(x, z) < 4 || core.slopeAt(x, z) > 0.22) continue;
      put('olive', x, h + MSL_Y - 0.1, z, 0.75 + rand() * 0.4, rand() * 6.28, rand()); n++;
    }
  }
  yield 0.8;
  // palmiyeler: kordonlar ve bulvar refüjü
  const palmLine = (pts, step, off, kind = 'palm') => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const A = pts[i], B = pts[i + 1], L = Math.hypot(B.x - A.x, B.z - A.z), nx = -(B.z - A.z) / L, nz = (B.x - A.x) / L;
      for (let s = step / 2; s < L; s += step) {
        const x = A.x + (B.x - A.x) * s / L + nx * off, z = A.z + (B.z - A.z) * s / L + nz * off;
        const h = core.rawAt(x, z);
        if (h < 0.5) continue;
        if (kind !== 'palm' && R.nearRoad(x, z) < 1.5) continue;
        put(kind, x, h + MSL_Y, z, kind === 'palm' ? 0.85 + rand() * 0.3 : 1.25 + rand() * 0.35, rand() * 6.28, rand()); n++;
      }
    }
  };
  palmLine(city.quays[0], 14, -9);
  palmLine(city.quays[2], 12, -12);
  palmLine(ctx.PL([[-2385, 70], [-2385, 840]]), 16, 0);
  palmLine(ctx.PL([[-2630, 75], [-2200, 70]]), 13, -4);
  // bölge sokak ağaçları (her iki yanda) ve park
  for (const st of ctx.city.skylineStreets || []) for (const sd of [-1, 1]) palmLine(st.pts, 13, sd * st.off, 'olive');
  {
    const PB = ctx.PL([[-2550, 550], [-2405, 695]]);
    for (let k = 0; k < 70; k++) {
      const x = PB[0].x + (PB[1].x - PB[0].x) * rand(), z = PB[0].z + (PB[1].z - PB[0].z) * rand();
      put(rand() < 0.35 ? 'pine' : rand() < 0.6 ? 'olive' : 'cyp', x, ctx.ground(x, z), z, 0.8 + rand() * 0.5, rand() * 6.28, rand()); n++;
    }
  }
  // kale avlusunda birkaç zeytin ve servi
  for (const [e, nn] of [[20, -60], [-10, -90], [40, 0], [-40, -30]]) { const p = ctx.P(e, nn); put(rand() < 0.5 ? 'olive' : 'cyp', p.x, ctx.ground(p.x, p.z), p.z, 1, rand() * 6.28, rand()); n++; }
  // örgüler
  const m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  const far = { pine: 3600, olive: 2400, cyp: 2600, shrub: 1300, palm: 3000 };
  for (const c of chunks.values()) {
    for (const [kind, list] of Object.entries(c.l)) {
      const im = new THREE.InstancedMesh(sp[kind], kind === 'palm' ? matDS : mat, list.length);
      list.forEach(([x, y, z, s, a, t], i) => {
        qt.setFromAxisAngle(up, a);
        const sy = s * (0.9 + t * 0.25);
        m4.compose(pv.set(x, y, z), qt, sv.set(s, sy, s));
        im.setMatrixAt(i, m4);
        im.setColorAt(i, col.setRGB(0.85 + t * 0.3, 0.88 + t * 0.24, 0.85 + t * 0.2));
      });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = true; im.receiveShadow = true;
      im.computeBoundingSphere();
      im.name = 'flora-' + kind;
      ctx.addChunk(im, c.x, c.z, S * 0.72, far[kind] * (q.city || 1), { noReflect: kind === 'shrub' });
    }
  }
  city.stats = Object.assign(city.stats || {}, { trees: n });
}
