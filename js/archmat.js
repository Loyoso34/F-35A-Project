// Mimari malzemeler (v5.0): tek program, çok yapı. Cephe ayrıntısı (pencere bölmeleri, kayıt
// profilleri, döşeme bantları, panjurlar, iç mekân) gölgelendiricide cephe UV'sinden üretilir:
// az üçgenle yüksek ayrıntı, dokusuz (bellek yok), her mesafede keskin.
//
// Köşe öznitelikleri (tüm mimari örgülerde ortak):
//   uv     : cephe metresi (u: duvar boyunca, v: zeminden yukarı)
//   aStyle : vec4 (yapıya özgü: x tohum, y kat yüksekliği, z bölme genişliği, w tür kodu)
//   color  : yapı tonu (sıva rengi / cam tonu)
// Tür kodu (aStyle.w): 0 düz yüzey (çatı, parapet, beton), 1 giydirme cephe (cam + kayıt),
// 2 Bodrum evi (sıva + panjurlu pencere), 3 bant pencereli ofis/otel, 4 taş (kale), 5 vitrin (zemin kat)
//
// Cam: fiziksel tabanlı (MeshStandardMaterial): düşük pürüzlülük, metalik pay ile renkli F0, gök ortam
// haritası yansıması, güneşin keskin speküler parıltısı; Fresnel açıya bağlı. Camın arkasında
// "iç mekân eşlemesi" (interior mapping): her pencere bölmesinin arkasında ışın-kutu kesişimiyle
// derinliği olan bir oda (arka duvar, tavan, döşeme, yan duvarlar); oda rengi ve gece ışığı
// bölme başına rastgele. Bu sayede yakından ve eğik bakışta pencereler düz siyah değil derinlikli.
import * as THREE from 'three';
import { HAZE_UNIFORMS, HAZE_PARS_VS, CURVE_PROJECT } from './worldshade.js';

export const ARCH_UNIFORMS = {
  uNight: { value: 0 },        // 0 gündüz .. 1 gece (pencere ve tepe ışıkları)
  uDusk: { value: 0 },         // alacakaranlık: ışıkların bir kısmı yanar
  uTimeA: { value: 0 },
};

const ARCH_PARS_FS = /* glsl */`
  uniform float uNight; uniform float uDusk; uniform float uTimeA;
  varying vec4 vStyle; varying vec2 vFac; varying vec3 vAW; varying vec3 vAN; varying vec4 vHaze;
  float aHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float aBox(vec2 p, vec2 lo, vec2 hi) { vec2 a = step(lo, p) * step(p, hi); return a.x * a.y; }
  float aBoxS(vec2 p, vec2 lo, vec2 hi, float e) { vec2 a = smoothstep(lo - e, lo + e, p) * (1.0 - smoothstep(hi - e, hi + e, p)); return a.x * a.y; }
  // İç mekân: oda kutusu [0,1]² × derinlik; dönüş: renk (doğrusal) ve ışık maskesi
  vec3 interiorRoom(vec2 f, vec3 vt, float seed, float depth, out float lit) {
    vec3 r = normalize(vec3(vt.xy, max(vt.z, 0.08)));
    vec3 p = vec3(f, 0.0);
    vec3 tB = vec3((step(0.0, r.xy) - p.xy) / (r.xy + sign(r.xy) * 1e-4), depth / r.z);
    float t = min(min(tB.x, tB.y), tB.z);
    vec3 h = p + r * t;
    float hue = aHash(vec2(seed, 3.7));
    vec3 wallC = mix(vec3(0.62, 0.58, 0.52), vec3(0.50, 0.55, 0.58), hue);
    vec3 col;
    if (t == tB.z) col = wallC * (0.75 + 0.25 * aHash(vec2(seed, 9.1)));               // arka duvar
    else if (t == tB.y) col = r.y > 0.0 ? vec3(0.78, 0.78, 0.76) : vec3(0.32, 0.27, 0.22) * (0.8 + 0.4 * hue);   // tavan / döşeme
    else col = wallC * 0.62;                                                          // yan duvar
    // derinlikle kararma ve perde/jaluzi bandı
    col *= 1.0 - 0.45 * clamp(h.z / depth, 0.0, 1.0);
    float blind = aHash(vec2(seed, 1.3));
    if (blind > 0.62) col = mix(col, vec3(0.70, 0.68, 0.62), step(1.0 - (blind - 0.62) * 1.6, f.y) * 0.85);
    lit = step(0.5, aHash(vec2(seed, 5.9)) + uDusk * 0.15) ;
    // tavan armatürü parlaması
    float lamp = smoothstep(0.35, 0.0, length(h.xz - vec2(0.5, depth * 0.45))) * step(0.98, h.y);
    col += vec3(1.0, 0.9, 0.7) * lamp * 0.5;
    return col;
  }
`;

const ARCH_FS_SURF = /* glsl */`
  float aEmis = 0.0; vec3 aEmisC = vec3(0.0);
  {
    vec2 F = vFac;                   // cephe metresi
    float kind = vStyle.w, seed = vStyle.x, fh = max(vStyle.y, 2.6), bw = max(vStyle.z, 1.0);
    vec3 Nw = normalize(vAN);
    float vertical = 1.0 - smoothstep(0.35, 0.7, abs(Nw.y));
    vec3 base = diffuseColor.rgb;
    float rough = roughnessFactor, metal = 0.0;
    vec3 V = normalize(cameraPosition - vAW);
    float camD = length(cameraPosition - vAW);
    float aaw = clamp(camD * 0.0009, 0.01, 0.25);        // kenar yumuşatma (mesafeyle; parıltı yok)
    if (kind > 0.5 && kind < 1.5 && vertical > 0.5) {
      // ---- Giydirme cephe: cam + yatay/dikey kayıtlar, kat döşemesi bandı (spandrel)
      vec2 cell = vec2(F.x / bw, F.y / fh);
      vec2 ci = floor(cell), f = fract(cell);
      float mull = 1.0 - aBoxS(f, vec2(0.04, 0.0), vec2(0.96, 1.0), aaw);
      float sp = 1.0 - smoothstep(0.17 - aaw, 0.17 + aaw, f.y);                  // döşeme bandı
      float glass = (1.0 - mull) * (1.0 - sp);
      vec3 tint = base;
      float rs = aHash(ci + seed);
      vec3 glassC = tint * (0.85 + 0.3 * rs);
      vec3 frameC = vec3(0.16, 0.17, 0.18) * (0.8 + 0.6 * seed);
      vec3 spC = mix(tint * 0.6, vec3(0.20, 0.21, 0.22), 0.6);
      base = mix(mix(spC, frameC, mull), glassC, glass);
      rough = mix(mix(0.45, 0.35, mull), 0.05 + 0.04 * rs, glass);
      metal = mix(mix(0.2, 0.75, mull), 0.32, glass);
      // iç mekân (yakında; uzakta ortalama koyu cam)
      float nearI = 1.0 - smoothstep(250.0, 1400.0, camD);
      if (glass > 0.01) {
        vec3 T = normalize(cross(vec3(0.0, 1.0, 0.0), Nw) + vec3(1e-4));
        vec3 B = vec3(0.0, 1.0, 0.0);
        vec3 vt = vec3(dot(-V, T), dot(-V, B), dot(V, Nw));
        float lit;
        vec2 fr = vec2(f.x, (f.y - 0.17) / 0.83);
        vec3 room = interiorRoom(fr, vt, aHash(ci * 1.37 + seed), 1.1, lit);
        float trans = (1.0 - pow(1.0 - clamp(dot(V, Nw), 0.0, 1.0), 4.0)) * 0.5;    // camdan geçen
        base = mix(base, base * 0.4 + room * 0.22, trans * nearI * glass);
        float onN = lit * smoothstep(0.0, 1.0, uNight);
        aEmis = glass * onN * (0.55 + 0.45 * aHash(ci + 7.1));
        aEmisC = mix(room, vec3(1.0, 0.86, 0.62), 0.5) * (nearI * 0.7 + 0.3);
      }
    } else if (kind > 1.5 && kind < 2.5 && vertical > 0.5) {
      // ---- Bodrum evi: badanalı sıva, mavi/yeşil ahşap panjurlu pencereler, zemin katta kapı
      float n1 = aHash(floor(F * 0.9) + seed * 13.0);
      vec3 plaster = base * (0.92 + 0.08 * n1);
      float col = floor(F.x / bw), row = floor(F.y / fh);
      vec2 f = vec2(fract(F.x / bw), fract(F.y / fh));
      float has = step(0.25, aHash(vec2(col, row) + seed * 3.1));
      float isDoor = step(row, 0.5) * step(0.72, aHash(vec2(col, 7.0) + seed));
      vec2 lo = isDoor > 0.5 ? vec2(0.36, 0.0) : vec2(0.36, 0.34), hi = isDoor > 0.5 ? vec2(0.64, 0.78) : vec2(0.64, 0.78);
      float win = aBoxS(f, lo, hi, aaw * 0.6) * has;
      float frame = aBoxS(f, lo - vec2(0.05, 0.04), hi + vec2(0.05, 0.04), aaw * 0.6) * has - win;
      // panjur kanatları (açık): pencerenin iki yanında
      float sh = (aBoxS(f, vec2(lo.x - 0.17, lo.y), vec2(lo.x - 0.03, hi.y), aaw * 0.6) + aBoxS(f, vec2(hi.x + 0.03, lo.y), vec2(hi.x + 0.17, hi.y), aaw * 0.6)) * has * (1.0 - isDoor) * step(0.35, aHash(vec2(row, col) + seed * 5.0));
      float sk = aHash(vec2(seed, 2.0));
      vec3 shC = sk < 0.55 ? vec3(0.04, 0.16, 0.42) : sk < 0.8 ? vec3(0.06, 0.24, 0.20) : vec3(0.22, 0.12, 0.06);
      float slats = 0.85 + 0.15 * step(0.5, fract(F.y * 8.0));
      float lit = step(0.6, aHash(vec2(col, row) + seed * 1.7));
      vec3 glassC = vec3(0.025, 0.03, 0.035);
      base = plaster;
      base = mix(base, plaster * 0.82, clamp(frame, 0.0, 1.0));
      base = mix(base, shC * slats, sh);
      base = mix(base, isDoor > 0.5 ? shC * 0.8 : glassC, win);
      rough = mix(0.88, isDoor > 0.5 ? 0.6 : 0.12, win);
      aEmis = win * (1.0 - isDoor) * lit * smoothstep(0.2, 1.0, uNight) * 0.8;
      aEmisC = vec3(1.0, 0.78, 0.48);
      // zemin kirlenmesi (sıvanın dibinde)
      base *= 0.88 + 0.12 * smoothstep(0.0, 0.8, F.y);
    } else if (kind > 2.5 && kind < 3.5 && vertical > 0.5) {
      // ---- Bant pencereli ofis/otel: taş/sıva bantlar, sürekli pencere bantları, balkon gölgesi
      vec2 cell = vec2(F.x / bw, F.y / fh);
      vec2 ci = floor(cell), f = fract(cell);
      float band = smoothstep(0.30 - aaw, 0.30 + aaw, f.y) * (1.0 - smoothstep(0.88 - aaw, 0.88 + aaw, f.y));
      float mull = 1.0 - smoothstep(0.03, 0.03 + aaw, f.x) * (1.0 - smoothstep(0.97 - aaw, 0.97, f.x));
      float glass = band * (1.0 - mull);
      vec3 glassC = vec3(0.035, 0.045, 0.05) * (0.8 + 0.4 * aHash(ci + seed));
      base = mix(base * (0.9 + 0.1 * aHash(ci.yy + seed)), glassC, glass);
      base = mix(base, base * 0.55, (1.0 - smoothstep(0.88, 0.95, f.y)) * smoothstep(0.82, 0.88, f.y));
      rough = mix(0.8, 0.08, glass); metal = glass * 0.25;
      float lit = step(0.55, aHash(ci + seed * 2.3));
      aEmis = glass * lit * smoothstep(0.0, 1.0, uNight) * 0.7;
      aEmisC = vec3(1.0, 0.86, 0.66);
    } else if (kind > 3.5 && kind < 4.5) {
      // ---- Taş (kale): blok dizisi, harç derzleri, yaşlanma
      vec2 bs = vec2(1.1, 0.55);
      vec2 q = F / bs; q.x += step(1.0, mod(floor(q.y), 2.0)) * 0.5;
      vec2 bi = floor(q), bf = fract(q);
      float mortar = 1.0 - aBoxS(bf, vec2(0.04, 0.07), vec2(0.96, 0.93), aaw * 2.0);
      float tone = 0.82 + 0.3 * aHash(bi + seed);
      base = base * tone * mix(1.0, 0.72, mortar * (1.0 - smoothstep(60.0, 400.0, camD)));
      base *= 0.85 + 0.15 * smoothstep(0.0, 3.0, F.y);
      rough = 0.9;
      // gece projektör aydınlatması (kale): alttan sıcak ışık
      aEmis = uNight * 0.22 * (1.0 - smoothstep(2.0, 26.0, F.y) * 0.6) * vertical;
      aEmisC = base * vec3(1.6, 1.1, 0.6);
    } else if (kind > 4.5 && kind < 5.5 && vertical > 0.5) {
      // ---- Vitrin (zemin kat): yüksek cam, ince kayıt, tabela bandı
      vec2 f = vec2(fract(F.x / bw), F.y);
      float glass = aBoxS(f, vec2(0.05, 0.25), vec2(0.95, 3.6), aaw);
      float signB = aBoxS(f, vec2(0.05, 3.85), vec2(0.95, 4.5), aaw);
      float sc = aHash(vec2(floor(F.x / bw), seed));
      vec3 signC = sc < 0.3 ? vec3(0.55, 0.08, 0.06) : sc < 0.6 ? vec3(0.06, 0.18, 0.4) : vec3(0.75, 0.62, 0.2);
      base = mix(base, vec3(0.05, 0.055, 0.06), glass);
      base = mix(base, signC, signB);
      rough = mix(0.7, 0.06, glass); metal = glass * 0.2;
      aEmis = glass * smoothstep(0.0, 1.0, max(uNight, uDusk * 0.6)) * 0.9 + signB * uNight * 0.6;
      aEmisC = mix(vec3(1.0, 0.85, 0.6), signC * 2.0, signB);
    } else if (kind > 5.5 && kind < 6.5) {
      // ---- Aydınlatma bandı (taç, kanopi altı, sokak lambası başlığı): gece yanar
      base *= 1.0;
      rough = 0.35; metal = 0.6;
      aEmis = smoothstep(0.1, 0.8, uNight) * 1.4;
      aEmisC = vec3(1.0, 0.93, 0.8);
    } else {
      // düz yüzey: hafif yaşlanma
      float n = aHash(floor(vAW.xz * 0.7) + seed);
      base *= 0.9 + 0.1 * n;
    }
    diffuseColor.rgb = base;
    roughnessFactor = rough;
    metalnessFactor = metal;
  }
`;

/**
 * Mimari malzeme. opts: { name, roughness, metalness, envMapIntensity, side }
 */
export function makeArchMaterial(opts = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: opts.roughness || 0.85, metalness: opts.metalness || 0, side: opts.side || THREE.FrontSide });
  m.envMapIntensity = opts.envMapIntensity !== undefined ? opts.envMapIntensity : 1.0;
  m.userData.hazed = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, HAZE_UNIFORMS, ARCH_UNIFORMS);
    sh.vertexShader = 'attribute vec4 aStyle;\nvarying vec4 vStyle; varying vec2 vFac; varying vec3 vAW; varying vec3 vAN;\n' + HAZE_PARS_VS + '\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vStyle = aStyle; vFac = uv;')
      .replace('#include <project_vertex>', CURVE_PROJECT + `
        vAW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        #ifdef USE_INSTANCING
          vAW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
          vAN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal);
        #else
          vAN = normalize(mat3(modelMatrix) * objectNormal);
        #endif
        vHaze = hazeAt(transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition);`);
    sh.fragmentShader = ARCH_PARS_FS + '\n' + sh.fragmentShader
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + ARCH_FS_SURF)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance += aEmisC * aEmis * 2.2;')
      .replace('#include <fog_fragment>', '')
      .replace('#include <tonemapping_fragment>', `
        gl_FragColor.rgb = mix(gl_FragColor.rgb, vHaze.rgb, vHaze.a);
        #include <tonemapping_fragment>`);
  };
  m.customProgramCacheKey = () => 'arch5';
  return m;
}

// ---------------------------------------------------------------------------------------------
// Geometri yardımcıları: tek dizi tamponda toplayıcı (konum, normal, uv, renk, stil)
// ---------------------------------------------------------------------------------------------
export class ArchBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.s = []; this.idx = []; this.vc = 0; }
  get count() { return this.vc; }
  vert(x, y, z, nx, ny, nz, u, v, col, st) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, v);
    this.c.push(col[0], col[1], col[2]); this.s.push(st[0], st[1], st[2], st[3]);
    return this.vc++;
  }
  /** Dörtgen (a, b, c, d saat yönü tersine, dışarıdan bakınca), düz normal. */
  quad(a, b, c, d, uvs, col, st) {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const L = Math.hypot(nx, ny, nz) || 1; nx /= L; ny /= L; nz /= L;
    const i0 = this.vert(a[0], a[1], a[2], nx, ny, nz, uvs[0], uvs[1], col, st);
    const i1 = this.vert(b[0], b[1], b[2], nx, ny, nz, uvs[2], uvs[3], col, st);
    const i2 = this.vert(c[0], c[1], c[2], nx, ny, nz, uvs[4], uvs[5], col, st);
    const i3 = this.vert(d[0], d[1], d[2], nx, ny, nz, uvs[6], uvs[7], col, st);
    this.idx.push(i0, i1, i2, i0, i2, i3);
  }
  /** Eksen hizalı olmayan kutu: merkez (x, z), taban y0, yükseklik h, genişlik w (yerel x), derinlik d, dönüş a. */
  box(x, y0, z, w, d, h, a, col, st, opts = {}) {
    const ca = Math.cos(a), sa = Math.sin(a);
    const P = (lx, lz) => [x + lx * ca - lz * sa, z + lx * sa + lz * ca];
    const hw = w / 2, hd = d / 2;
    const c = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
    const y1 = y0 + h;
    const stW = opts.wallStyle || st, stT = opts.topStyle || [st[0], st[1], st[2], 0];
    // duvarlar: u = çevre metresi
    let u = opts.u0 || 0;
    const sideLen = [w, d, w, d];
    for (let k = 0; k < 4; k++) {
      const A = c[k], B = c[(k + 1) % 4], L = sideLen[k];
      if (opts.skipWall && opts.skipWall(k)) { u += L; continue; }
      // dışa bakan: alt A, alt B, üst B, üst A  (sıra çevreyi saat yönü TERSİNE dolaşır, yukarıdan bakınca)
      this.quad([B[0], y0, B[1]], [A[0], y0, A[1]], [A[0], y1, A[1]], [B[0], y1, B[1]], [u + L, opts.v0 || 0, u, opts.v0 || 0, u, (opts.v0 || 0) + h, u + L, (opts.v0 || 0) + h], col, stW);
      u += L;
    }
    if (!opts.noTop) this.quad([c[0][0], y1, c[0][1]], [c[3][0], y1, c[3][1]], [c[2][0], y1, c[2][1]], [c[1][0], y1, c[1][1]], [0, 0, 0, d, w, d, w, 0], opts.topCol || col, stT);
    if (opts.bottom) this.quad([c[0][0], y0, c[0][1]], [c[1][0], y0, c[1][1]], [c[2][0], y0, c[2][1]], [c[3][0], y0, c[3][1]], [0, 0, w, 0, w, d, 0, d], col, stT);
  }
  /**
   * Çokgen prizma (dışbükey olması gerekmez; çatı üçgenlemesi THREE.ShapeUtils). poly: [[x,z],...] saat
   * yönü tersine (yukarıdan, +y'den bakınca; x doğu, z güney => ekranda saat yönü). smooth: kenar
   * normalleri yumuşatılır (eğri cephe).
   */
  prism(poly, y0, h, col, st, opts = {}) {
    // Yön: (x, z) düzleminde pozitif alan (dış normal = (dz, −dx)); ters verilmişse çevrilir
    let A2 = 0;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; A2 += a[0] * b[1] - b[0] * a[1]; }
    if (A2 < 0) poly = poly.slice().reverse();
    const n = poly.length, y1 = y0 + h;
    let u = opts.u0 || 0;
    const v0 = opts.v0 || 0;
    // köşe normalleri (yumuşak) ya da kenar normalleri
    const en = [];
    for (let i = 0; i < n; i++) {
      const A = poly[i], B = poly[(i + 1) % n];
      const dx = B[0] - A[0], dz = B[1] - A[1], L = Math.hypot(dx, dz) || 1;
      en.push([dz / L, -dx / L]);
    }
    for (let i = 0; i < n; i++) {
      const A = poly[i], B = poly[(i + 1) % n], L = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (opts.skipEdge && opts.skipEdge(i)) { u += L; continue; }
      let nA = en[i], nB = en[i];
      if (opts.smooth) {
        const p = en[(i - 1 + n) % n], q = en[(i + 1) % n];
        const sA = [en[i][0] + p[0], en[i][1] + p[1]], sB = [en[i][0] + q[0], en[i][1] + q[1]];
        const la = Math.hypot(...sA) || 1, lb = Math.hypot(...sB) || 1;
        nA = [sA[0] / la, sA[1] / la]; nB = [sB[0] / lb, sB[1] / lb];
      }
      const s = opts.wallStyle || st;
      const i0 = this.vert(A[0], y0, A[1], nA[0], 0, nA[1], u, v0, col, s);
      const i1 = this.vert(B[0], y0, B[1], nB[0], 0, nB[1], u + L, v0, col, s);
      const i2 = this.vert(B[0], y1, B[1], nB[0], 0, nB[1], u + L, v0 + h, col, s);
      const i3 = this.vert(A[0], y1, A[1], nA[0], 0, nA[1], u, v0 + h, col, s);
      // yukarıdan saat yönü tersine çevre -> dış normal (dz, -dx); üçgen sırası dışa bakar
      this.idx.push(i0, i2, i1, i0, i3, i2);
      u += L;
    }
    if (!opts.noTop) this.cap(poly, y1, 1, opts.topCol || col, opts.topStyle || [st[0], st[1], st[2], 0]);
    if (opts.bottom) this.cap(poly, y0, -1, col, opts.topStyle || [st[0], st[1], st[2], 0]);
    return u;
  }
  cap(poly, y, dir, col, st) {
    const pts = poly.map((p) => new THREE.Vector2(p[0], p[1]));
    let tri;
    try { tri = THREE.ShapeUtils.triangulateShape(pts, []); } catch (e) { return; }
    const base = this.vc;
    for (const p of poly) this.vert(p[0], y, p[1], 0, dir, 0, p[0], p[1], col, st);
    // normal.y = −cross2D(b−a, c−a): yukarı (+y) için üçgen (x, z)'de saat yönünde olmalı
    for (const t of tri) {
      let [a, b, c] = t;
      const pa = poly[a], pb = poly[b], pc = poly[c];
      const cr = (pb[0] - pa[0]) * (pc[1] - pa[1]) - (pb[1] - pa[1]) * (pc[0] - pa[0]);
      if ((cr < 0) !== (dir > 0)) { const tmp = b; b = c; c = tmp; }
      this.idx.push(base + a, base + b, base + c);
    }
  }
  /** Silindir (n kenar), eksen y. */
  cylinder(x, y0, z, r, h, n, col, st, opts = {}) {
    const poly = [];
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; poly.push([x + Math.cos(a) * r, z + Math.sin(a) * r]); }
    return this.prism(poly, y0, h, col, st, Object.assign({ smooth: true }, opts));
  }
  merge(o) {
    const off = this.vc;
    for (let i = 0; i < o.p.length; i++) this.p.push(o.p[i]);
    for (let i = 0; i < o.n.length; i++) this.n.push(o.n[i]);
    for (let i = 0; i < o.uv.length; i++) this.uv.push(o.uv[i]);
    for (let i = 0; i < o.c.length; i++) this.c.push(o.c[i]);
    for (let i = 0; i < o.s.length; i++) this.s.push(o.s[i]);
    for (let i = 0; i < o.idx.length; i++) this.idx.push(o.idx[i] + off);
    this.vc += o.vc;
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aStyle', new THREE.Float32BufferAttribute(this.s, 4));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** sRGB onaltılık -> doğrusal [r, g, b] */
export function lin(hex) {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}
