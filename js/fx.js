// Silah efektleri: parçacıklar, duman izi şeritleri, yer izleri (krater) ve patlama bileşimi.
//
// Mobil için tasarım ilkeleri
//  - Parçacıklar GPU'da ANALİTİK hareket eder: konum, hız, sürüklenme, yerçekimi ve renk
//    eğrileri doğum anındaki değerlerden köşe gölgelendiricisinde hesaplanır. CPU yalnızca
//    doğumda halka tampona yazar (yalnızca yazılan aralık GPU'ya gider); her kare parçacık
//    başına iş yoktur. İki sistem: alfa (duman, toz, enkaz) ve toplamalı (ateş, kıvılcım,
//    parlama). Her biri tek çizim çağrısıdır; içinde canlı parçacık yokken çizilmez.
//  - Füze duman izi kameraya dönük bir şerittir (nokta başına iki köşe): yüksek hızda da
//    kesintisiz kalır ve parçacık yığınından çok daha az piksel doldurur.
//  - Yer izleri (krater) küçük bir havuzdan gelir ve araziye oturtulur; eskileri soluklaşıp
//    yeniden kullanılır.
//  - Sahneye gerçek ışık EKLENMEZ: patlamanın yere vurduğu ışık toplamalı bir zemin
//    parlamasıdır, uçağa vuran ışık aircraft.js'teki FX_LIGHT ile verilir. Böylece hiçbir
//    malzeme yeniden derlenmez (oyun sırasında takılma olmaz).
import * as THREE from 'three';

const TAU = Math.PI * 2;
// Parçacık kipleri (köşe gölgelendiricisindeki dallar ve doku karoları)
export const PM = { SMOKE: 0, SPARK: 1, RING: 2, GLOW: 3, GROUND_GLOW: 4, DEBRIS: 5 };
const TILE = [1, 2, 3, 2, 2, 0];

// ---------------------------------------------------------------------------
// Dokular (prosedürel, yüklemede bir kez)
// ---------------------------------------------------------------------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function makeAtlas() {
  const N = 128, c = document.createElement('canvas');
  c.width = c.height = N * 2;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N * 2, N * 2), d = img.data;
  const r = rng(7);
  // Değer gürültüsü (kabarık kenarlar için)
  const G = 16, grid = []; for (let i = 0; i < G * G; i++) grid.push(r());
  const vn = (x, y) => {
    const xi = Math.floor(x) & (G - 1), yi = Math.floor(y) & (G - 1), xf = x - Math.floor(x), yf = y - Math.floor(y);
    const s = (t) => t * t * (3 - 2 * t), a = grid[yi * G + xi], b = grid[yi * G + ((xi + 1) & (G - 1))], c2 = grid[((yi + 1) & (G - 1)) * G + xi], e = grid[((yi + 1) & (G - 1)) * G + ((xi + 1) & (G - 1))];
    return (a + (b - a) * s(xf)) + ((c2 + (e - c2) * s(xf)) - (a + (b - a) * s(xf))) * s(yf);
  };
  const fbm = (x, y) => vn(x, y) * 0.55 + vn(x * 2.1, y * 2.1) * 0.3 + vn(x * 4.3, y * 4.3) * 0.15;
  const put = (tx, ty, f) => {
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1;
      const [lum, a] = f(u, v);
      const i = ((ty * N + y) * N * 2 + tx * N + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, lum * 255)); d[i + 3] = Math.max(0, Math.min(255, a * 255));
    }
  };
  // 0: enkaz parçası (düzensiz, sert kenarlı)
  put(0, 0, (u, v) => { const ang = Math.atan2(v, u), rr = Math.hypot(u, v); const edge = 0.55 + 0.25 * Math.sin(ang * 3 + 1) + 0.12 * Math.sin(ang * 7); return [0.8 + 0.2 * fbm(u * 4 + 9, v * 4), 1 - smooth(edge - 0.08, edge, rr)]; });
  // 1: kabarık duman topağı (gri ton ayrıntısı + gürültülü kenar)
  put(1, 0, (u, v) => { const rr = Math.hypot(u, v); const n = fbm(u * 2.6 + 3, v * 2.6 + 5); const a = Math.max(0, 1 - smooth(0.35, 1.0, rr + (n - 0.5) * 0.55)); return [0.78 + 0.3 * n - 0.12 * rr, a * (0.75 + 0.25 * n)]; });
  // 2: yumuşak parlama (Gauss)
  put(0, 1, (u, v) => { const rr = u * u + v * v; return [1, Math.exp(-rr * 4.2) * (1 - smooth(0.85, 1, Math.sqrt(rr)))]; });
  // 3: halka (şok/toz halkası)
  put(1, 1, (u, v) => { const rr = Math.hypot(u, v); const n = fbm(u * 3 + 1, v * 3 + 2); return [0.9, Math.exp(-Math.pow((rr - 0.72) / 0.13, 2)) * (0.6 + 0.4 * n) * (1 - smooth(0.92, 1, rr))]; });
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  // Karo indisleri tuval satırlarıyla birebir (karo k -> sütun k%2, satır k/2): çevirme yok
  t.flipY = false;
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
// Döşenebilir değer gürültüsü (duman izi kenarları ve yoğunluk dalgası için)
function makeNoise() {
  const N = 64, c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d'), img = ctx.createImageData(N, N), d = img.data, r = rng(23);
  const G = 16, grid = []; for (let i = 0; i < G * G; i++) grid.push(r());
  const s = (t) => t * t * (3 - 2 * t);
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = s(x - xi), yf = s(y - yi);
    const g = (i, j) => grid[(j & (G - 1)) * G + (i & (G - 1))];
    const a = g(xi, yi) + (g(xi + 1, yi) - g(xi, yi)) * xf, b = g(xi, yi + 1) + (g(xi + 1, yi + 1) - g(xi, yi + 1)) * xf;
    return a + (b - a) * yf;
  };
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N;
    const n = vn(u * 4, v * 4) * 0.5 + vn(u * 8 + 3, v * 8 + 5) * 0.3 + vn(u * 16 + 7, v * 16 + 1) * 0.2;
    const i = (y * N + x) * 4; d[i] = d[i + 1] = d[i + 2] = d[i + 3] = Math.round(n * 255);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
function smooth(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

function makeScorchTexture() {
  const N = 256, c = document.createElement('canvas'); c.width = c.height = N;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(N, N), d = img.data, r = rng(19);
  const rays = []; for (let i = 0; i < 26; i++) rays.push({ a: r() * TAU, w: 0.04 + r() * 0.08, l: 0.55 + r() * 0.45 });
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N * 2 - 1, v = (y + 0.5) / N * 2 - 1, rr = Math.hypot(u, v), ang = Math.atan2(v, u);
    let ray = 0; for (const q of rays) { let da = Math.abs(((ang - q.a + Math.PI) % TAU + TAU) % TAU - Math.PI); ray = Math.max(ray, (1 - smooth(0, q.w, da)) * (1 - smooth(q.l * 0.7, q.l, rr))); }
    const pit = 1 - smooth(0.12, 0.38, rr);                     // ortadaki çukur
    const rim = Math.exp(-Math.pow((rr - 0.36) / 0.07, 2));     // sürülmüş toprak halkası
    const scorch = 1 - smooth(0.25, 0.85, rr + (r() - 0.5) * 0.06);
    let lum = 0.06 + 0.1 * rim + 0.04 * (1 - scorch);
    let a = Math.min(1, scorch * 0.85 + ray * 0.55 + pit * 0.3 + rim * 0.3);
    a *= 1 - smooth(0.8, 1, rr);
    const i = (y * N + x) * 4;
    d[i] = (lum + 0.025 * rim) * 255; d[i + 1] = lum * 0.92 * 255; d[i + 2] = lum * 0.82 * 255; d[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Ortak gölgelendirici parçaları: sis (önçarpımlı çıktı için elle) ve ton eşleme
const FOG_FRAG = `
#ifdef USE_FOG
  float fogF = smoothstep(fogNear, fogFar, vFogDepth);
  #ifdef ADDITIVE
    gl_FragColor.rgb *= 1.0 - fogF;
  #else
    gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor * gl_FragColor.a, fogF);
  #endif
#endif`;

// ---------------------------------------------------------------------------
// Parçacık sistemi
// ---------------------------------------------------------------------------
export class Particles {
  constructor(max, { additive, texture, renderOrder }) {
    this.max = max; this.head = 0; this.additive = additive;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('corner', new THREE.Float32BufferAttribute([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5], 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const mk = (name, n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(max * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.a = {
      pos: mk('iPos', 3), vel: mk('iVel', 3), time: mk('iTime', 4), size: mk('iSize', 4),
      c0: mk('iCol0', 4), c1: mk('iCol1', 4), misc: mk('iMisc', 4), shape: mk('iShape', 4),
    };
    // Tüm doğum zamanları çok geçmişte: başlangıçta hepsi ölü
    for (let i = 0; i < max; i++) { this.a.time.array[i * 4] = -1e6; this.a.time.array[i * 4 + 1] = 1; }
    g.instanceCount = max;
    this.geometry = g;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uWind: { value: new THREE.Vector3() }, uTex: { value: texture } }]);
    this.uniforms.uTex.value = texture;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, fog: true, transparent: true, depthWrite: false,
      defines: additive ? { ADDITIVE: 1 } : {},
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      vertexShader: `
        attribute vec2 corner;
        attribute vec3 iPos; attribute vec3 iVel; attribute vec4 iTime; attribute vec4 iSize;
        attribute vec4 iCol0; attribute vec4 iCol1; attribute vec4 iMisc; attribute vec4 iShape;
        uniform float uTime; uniform vec3 uWind;
        varying vec2 vUv; varying vec4 vCol; varying float vTile; varying float vShade;
        #include <fog_pars_vertex>
        void main() {
          float age = uTime - iTime.x, life = iTime.y;
          if (age < 0.0 || age > life) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); return; }
          float u = age / life, k = iTime.z, g = iTime.w;
          float e = exp(-k * age);
          float dk = k > 1e-4 ? (1.0 - e) / k : age;
          vec3 p = iPos + iVel * dk;
          p.y -= k > 1e-4 ? g * (age - dk) / k : 0.5 * g * age * age;
          p += uWind * (age * iShape.z);
          p.y = max(p.y, iMisc.x);
          vec3 vel = iVel * e - vec3(0.0, g * dk, 0.0);
          float grow = 1.0 - pow(1.0 - u, 2.2);
          float size = mix(iSize.x, iSize.y, grow);
          float rot = iSize.z + iSize.w * age;
          int mode = int(iMisc.w + 0.5);
          float c = cos(rot), s = sin(rot);
          vec2 rc = vec2(corner.x * c - corner.y * s, corner.x * s + corner.y * c);
          vec4 mv;
          if (mode == 2 || mode == 4) {
            mv = modelViewMatrix * vec4(p + vec3(rc.x * size, 0.08, rc.y * size), 1.0);
          } else if (mode == 1) {
            vec4 c0 = modelViewMatrix * vec4(p, 1.0);
            vec2 vv = (modelViewMatrix * vec4(vel, 0.0)).xy;
            float L = length(vv);
            vec2 dir = L > 1e-4 ? vv / L : vec2(1.0, 0.0);
            vec2 nrm = vec2(-dir.y, dir.x);
            float len = size + L * iMisc.y;
            mv = c0; mv.xy += dir * corner.x * len + nrm * corner.y * size;
          } else {
            mv = modelViewMatrix * vec4(p, 1.0);
            mv.xy += rc * size;
          }
          gl_Position = projectionMatrix * mv;
          vec4 mvPosition = mv;
          #include <fog_vertex>
          // Güneşe bakan üst taraf açık: dünya yukarısının ekrandaki yönüne göre
          vec2 upV = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy + vec2(1e-5));
          vShade = 0.86 + 0.26 * dot(rc, upV) * 2.0;
          float cu = pow(u, iShape.x);
          vCol = mix(iCol0, iCol1, cu);
          float fin = iMisc.z > 0.0 ? smoothstep(0.0, iMisc.z, u) : 1.0;
          vCol.a *= fin * pow(1.0 - u, iShape.y);
          vUv = corner + 0.5;
          vTile = iMisc.w;
        }`,
      fragmentShader: `
        uniform sampler2D uTex;
        varying vec2 vUv; varying vec4 vCol; varying float vTile; varying float vShade;
        #include <fog_pars_fragment>
        void main() {
          int mode = int(vTile + 0.5);
          float tile = mode == 0 ? 1.0 : mode == 2 ? 3.0 : mode == 5 ? 0.0 : 2.0;
          vec2 uv = (vUv + vec2(mod(tile, 2.0), floor(tile / 2.0))) * 0.5;
          vec4 t = texture2D(uTex, uv);
          float a = t.a * vCol.a;
          if (a < 0.002) discard;
          vec3 rgb = vCol.rgb * t.rgb;
          #ifndef ADDITIVE
            if (mode == 0) rgb *= vShade;
          #endif
          gl_FragColor = vec4(rgb * a, a);
          ${FOG_FRAG}
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.material = mat;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.lastDeath = -1;
    this.dirtyLo = Infinity; this.dirtyHi = -1; this.wrapped = false;
  }

  /**
   * Bir parçacık doğurur. o: { p, v, life, k (sürüklenme 1/s), g (yerçekimi m/s²),
   * s0, s1 (boyut m), rot, spin, c0 [r,g,b,a], c1 [r,g,b,a], ground (zemin y), stretch (s),
   * fadeIn (ömür kesri), mode, cPow (renk eğrisi), aPow (solma üssü), wind (rüzgâr payı) }
   */
  spawn(t, o) {
    const i = this.head; this.head = (this.head + 1) % this.max;
    if (this.head === 0) this.wrapped = true;
    const A = this.a;
    A.pos.array.set([o.p.x, o.p.y, o.p.z], i * 3);
    const v = o.v; A.vel.array.set(v ? [v.x, v.y, v.z] : [0, 0, 0], i * 3);
    A.time.array.set([t, o.life, o.k || 0, o.g || 0], i * 4);
    A.size.array.set([o.s0, o.s1 === undefined ? o.s0 : o.s1, o.rot || 0, o.spin || 0], i * 4);
    A.c0.array.set(o.c0, i * 4); A.c1.array.set(o.c1 || o.c0, i * 4);
    A.misc.array.set([o.ground === undefined ? -1e5 : o.ground, o.stretch || 0, o.fadeIn || 0, o.mode || 0], i * 4);
    A.shape.array.set([o.cPow || 1, o.aPow === undefined ? 1 : o.aPow, o.wind === undefined ? 1 : o.wind, 0], i * 4);
    if (i < this.dirtyLo) this.dirtyLo = i;
    if (i > this.dirtyHi) this.dirtyHi = i;
    if (t + o.life > this.lastDeath) this.lastDeath = t + o.life;
  }

  /** Bu kare yazılan aralığı GPU'ya gönderir; canlı parçacık yoksa çizimi kapatır. */
  flush(t) {
    if (this.dirtyHi >= 0) {
      for (const k in this.a) {
        const at = this.a[k], n = at.itemSize;
        at.clearUpdateRanges();
        at.addUpdateRange(this.dirtyLo * n, (this.dirtyHi - this.dirtyLo + 1) * n);
        at.needsUpdate = true;
      }
      this.dirtyLo = Infinity; this.dirtyHi = -1;
    }
    this.uniforms.uTime.value = t;
    this.mesh.visible = t < this.lastDeath;
  }

  clear() {
    const T = this.a.time;
    for (let i = 0; i < this.max; i++) T.array[i * 4] = -1e6;
    T.clearUpdateRanges(); T.needsUpdate = true;
    this.lastDeath = -1; this.mesh.visible = false;
  }
}

// ---------------------------------------------------------------------------
// Füze duman izi: kameraya dönük şerit. Noktalar yalnızca eklenir (en eskisi düşer); baş
// nokta her kare lüle konumuna çekilir, böylece iz ile füze arasında boşluk kalmaz.
// Genişlik yaşla büyür, saydamlık yaşla söner, kenarlar gürültüyle kabarır, rüzgârla sürüklenir.
// ---------------------------------------------------------------------------
const TRAIL_CAP = 320;
export function makeTrailMaterial(noiseTex) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uWind: { value: new THREE.Vector3() }, uNoise: { value: null } }]);
  uniforms.uNoise.value = noiseTex;
  return new THREE.ShaderMaterial({
    uniforms, fog: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `
      attribute float aSide; attribute float aBirth; attribute vec3 aDir; attribute float aDist;
      uniform float uTime; uniform vec3 uWind;
      varying vec2 vUv; varying float vA; varying float vHot; varying float vAge;
      #include <fog_pars_vertex>
      void main() {
        float age = max(uTime - aBirth, 0.0);
        vec3 p = position + uWind * age + vec3(0.0, 0.25, 0.0) * age;
        float w = 0.22 + 2.6 * (1.0 - exp(-age / 1.3)) + 0.18 * age;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vec3 dv = (modelViewMatrix * vec4(aDir, 0.0)).xyz;
        vec3 sd = cross(dv, normalize(mv.xyz));
        float sl = length(sd);
        sd = sl > 1e-5 ? sd / sl : vec3(1.0, 0.0, 0.0);
        mv.xyz += sd * aSide * w * 0.5;
        gl_Position = projectionMatrix * mv;
        vec4 mvPosition = mv;
        #include <fog_vertex>
        vUv = vec2(aSide, aDist);
        vA = smoothstep(0.0, 0.05, age) * exp(-age / 3.6) * (1.0 - smoothstep(7.0, 9.0, age));
        vHot = exp(-age * 7.0);
        vAge = age;
      }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform float uTime;
      varying vec2 vUv; varying float vA; varying float vHot; varying float vAge;
      #include <fog_pars_fragment>
      void main() {
        float n = texture2D(uNoise, vec2(vUv.x * 0.18, vUv.y * 0.045 - vAge * 0.05)).a;
        float n2 = texture2D(uNoise, vec2(vUv.x * 0.11 + 0.31, vUv.y * 0.013 + vAge * 0.02)).a;
        float e = 1.0 - abs(vUv.x);
        // Kabarık, yumuşak kenarlı gövde: orta yoğun, kenara doğru gürültüyle söner
        float a = smoothstep(0.0, 0.8, e - 0.6 * (n - 0.5) - 0.08) * vA * (0.35 + 0.65 * n2 * n2 * 1.6) * 0.82;
        a = min(a, 0.9);
        if (a < 0.003) discard;
        vec3 col = vec3(0.86, 0.87, 0.88) * (0.82 + 0.18 * n2) + vec3(1.6, 0.75, 0.25) * vHot;
        gl_FragColor = vec4(col * a, a);
        ${FOG_FRAG}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

export class SmokeTrail {
  constructor(material) {
    const N = TRAIL_CAP, V = N * 2;
    const g = new THREE.BufferGeometry();
    const mk = (name, n) => { const a = new THREE.BufferAttribute(new Float32Array(V * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a; };
    this.pos = mk('position', 3); this.dir = mk('aDir', 3); this.birth = mk('aBirth', 1); this.dist = mk('aDist', 1);
    const side = new Float32Array(V); for (let i = 0; i < V; i++) side[i] = i % 2 ? 1 : -1;
    g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    g.setDrawRange(0, 0);
    this.geometry = g;
    this.mesh = new THREE.Mesh(g, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.visible = false;
    this.n = 0; this.total = 0; this.last = new THREE.Vector3(); this.dieAt = -1;
  }
  reset() { this.n = 0; this.total = 0; this.geometry.setDrawRange(0, 0); this.mesh.visible = false; this.dieAt = -1; }
  _write(i, p, d, t, dist) {
    for (const k of [0, 1]) {
      const v = i * 2 + k;
      this.pos.array[v * 3] = p.x; this.pos.array[v * 3 + 1] = p.y; this.pos.array[v * 3 + 2] = p.z;
      this.dir.array[v * 3] = d.x; this.dir.array[v * 3 + 1] = d.y; this.dir.array[v * 3 + 2] = d.z;
      this.birth.array[v] = t; this.dist.array[v] = dist;
    }
  }
  _shift() {
    // En eski noktayı düşür (bir kare için en fazla bir kez)
    for (const a of [this.pos, this.dir, this.birth, this.dist]) { const n = a.itemSize * 2; a.array.copyWithin(0, n, this.n * n); }
    this.n--;
  }
  /** Lüle konumunu iz başına işler. spacing: yeni nokta aralığı (m). */
  push(p, d, t, spacing) {
    if (this.n === 0) {
      this._write(0, p, d, t, 0); this._write(1, p, d, t, 0.01);
      this.n = 2; this.last.copy(p); this.total = 0; this.mesh.visible = true;
    } else {
      const step = p.distanceTo(this.last);
      if (step >= spacing) {
        if (this.n >= TRAIL_CAP) this._shift();
        this.total += step; this.last.copy(p);
        this._write(this.n - 1, p, d, t, this.total);   // baş noktayı kalıcılaştır
        this._write(this.n, p, d, t, this.total + 0.01); // yeni baş
        this.n++;
      } else {
        this._write(this.n - 1, p, d, t, this.total + step);   // baş lüleyi izler
      }
    }
    this.geometry.setDrawRange(0, (this.n - 1) * 6);
    for (const a of [this.pos, this.dir, this.birth, this.dist]) a.needsUpdate = true;
  }
  /** Füze bitti: yeni nokta yok, iz kendi kendine söner. */
  end(t) { this.dieAt = t + 9.5; }
  update(t) { if (this.dieAt > 0 && t > this.dieAt) this.reset(); }
}

// ---------------------------------------------------------------------------
// Yer izleri: araziye oturan yanık/krater lekesi (havuzlu, soluklaşır)
// ---------------------------------------------------------------------------
export class Craters {
  constructor(scene, count, heightAt) {
    this.heightAt = heightAt;
    this.tex = makeScorchTexture();
    this.items = [];
    for (let i = 0; i < count; i++) {
      const g = new THREE.PlaneGeometry(1, 1, 8, 8); g.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshStandardMaterial({ map: this.tex, transparent: true, depthWrite: false, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
      const m = new THREE.Mesh(g, mat);
      m.visible = false; m.receiveShadow = true; m.renderOrder = 0; m.frustumCulled = true;
      scene.add(m);
      this.items.push({ m, born: -1e9, base: g.attributes.position.array.slice() });
    }
    this.next = 0;
  }
  place(p, r, t) {
    const it = this.items[this.next]; this.next = (this.next + 1) % this.items.length;
    const pa = it.m.geometry.attributes.position, b = it.base, rot = Math.random() * TAU, c = Math.cos(rot), s = Math.sin(rot);
    for (let i = 0; i < pa.count; i++) {
      const x0 = b[i * 3] * r * 2, z0 = b[i * 3 + 2] * r * 2;
      const x = p.x + x0 * c - z0 * s, z = p.z + x0 * s + z0 * c;
      pa.setXYZ(i, x, this.heightAt(x, z) + 0.06, z);
    }
    pa.needsUpdate = true;
    it.m.geometry.computeVertexNormals();
    it.m.geometry.computeBoundingSphere();
    it.born = t; it.m.visible = true; it.m.material.opacity = 1;
  }
  update(t) {
    for (const it of this.items) {
      if (!it.m.visible) continue;
      const age = t - it.born;
      if (age > 40) { it.m.visible = false; continue; }
      it.m.material.opacity = 1 - smooth(30, 40, age);
    }
  }
  clear() { for (const it of this.items) it.m.visible = false; }
  dispose() { for (const it of this.items) { it.m.geometry.dispose(); it.m.material.dispose(); it.m.parent && it.m.parent.remove(it.m); } this.tex.dispose(); }
}

// ---------------------------------------------------------------------------
// Efekt dünyası: sistemleri tutar, patlama bileşimlerini üretir
// ---------------------------------------------------------------------------
export class FX {
  constructor(scene, heightAt) {
    this.scene = scene;
    this.atlas = makeAtlas();
    this.alpha = new Particles(3072, { additive: false, texture: this.atlas, renderOrder: 2 });
    this.add = new Particles(2048, { additive: true, texture: this.atlas, renderOrder: 3 });
    scene.add(this.alpha.mesh, this.add.mesh);
    this.noise = makeNoise();
    this.trailMat = makeTrailMaterial(this.noise);
    this.craters = new Craters(scene, 6, heightAt);
    this.lights = [];       // kısa ömürlü efekt ışıkları (uçağa vuran)
    this.t = 0;
    this._v = new THREE.Vector3(); this._p = new THREE.Vector3();
    this.wind = new THREE.Vector3();
  }

  setWind(w) { this.wind.copy(w); this.alpha.uniforms.uWind.value.copy(w); this.add.uniforms.uWind.value.copy(w); this.trailMat.uniforms.uWind.value.copy(w); }

  /** Kısa ömürlü efekt ışığı: renk, tepe yoğunluğu, sönüm süresi (s). */
  light(p, color, peak, dur) { this.lights.push({ p: p.clone(), c: color, peak, dur, t0: this.t }); }

  update(dt) {
    this.t += dt;
    const t = this.t;
    this.alpha.flush(t); this.add.flush(t);
    this.trailMat.uniforms.uTime.value = t;
    this.craters.update(t);
    for (let i = this.lights.length - 1; i >= 0; i--) if (t - this.lights[i].t0 > this.lights[i].dur) this.lights.splice(i, 1);
  }

  clear() { this.alpha.clear(); this.add.clear(); this.craters.clear(); this.lights.length = 0; }

  // ---- Bileşimler ----
  rnd(a, b) { return a + Math.random() * (b - a); }
  dirUp(spread, out) {   // yukarı yarım küre (spread: 0 dar, 1 geniş)
    const a = Math.random() * TAU, c = 1 - Math.random() * spread, s = Math.sqrt(1 - c * c);
    return out.set(Math.cos(a) * s, c, Math.sin(a) * s);
  }
  dirSphere(out) { const a = Math.random() * TAU, c = Math.random() * 2 - 1, s = Math.sqrt(1 - c * c); return out.set(Math.cos(a) * s, c, Math.sin(a) * s); }

  /**
   * Patlama. kind: 'ground' | 'water' | 'building' | 'air'. p: çarpma noktası, ground: zemin y.
   * Ölçek bir AIM-120 harp başlığına (~20 kg) göredir: ateş topu ~9 m, duman sütunu ~25 m.
   */
  explode(p, kind = 'ground', groundY = -1e5) {
    const t = this.t, A = this.alpha, X = this.add, v = this._v, q = this._p;
    const onGround = kind === 'ground' || kind === 'building';
    const gY = kind === 'air' ? -1e5 : groundY;
    // 1) İlk parlama: çok kısa, beyaz-sarı, yoğun
    X.spawn(t, { p, life: 0.16, s0: 14, s1: 22, c0: [7, 6, 4.5, 1], c1: [3, 1.6, 0.6, 0], mode: PM.GLOW, aPow: 1.5, wind: 0 });
    X.spawn(t, { p, life: 0.07, s0: 5, s1: 9, c0: [12, 11, 9, 1], c1: [6, 5, 3, 0], mode: PM.GLOW, wind: 0 });
    if (kind !== 'air') X.spawn(t, { p: q.set(p.x, gY, p.z), life: 0.7, s0: 16, s1: 30, c0: [2.6, 1.3, 0.45, 1], c1: [0.6, 0.18, 0.04, 0], mode: PM.GROUND_GLOW, aPow: 1.6, wind: 0, rot: Math.random() * TAU });
    this.light(p, new THREE.Color(1, 0.62, 0.3), 90, 0.9);
    if (kind === 'water') { this.splash(p, gY); return; }
    // 2) Ateş topu: toplamalı topaklar, beyaz -> sarı -> turuncu -> koyu kızıl, yükselerek genişler
    for (let i = 0; i < 16; i++) {
      (onGround ? this.dirUp(0.9, v) : this.dirSphere(v)).multiplyScalar(this.rnd(2, 9));
      q.copy(p).addScaledVector(v, 0.12);
      X.spawn(t + Math.random() * 0.05, { p: q, v, life: this.rnd(0.55, 1.05), k: 2.2, g: -3, s0: this.rnd(2.5, 4), s1: this.rnd(6.5, 10), rot: Math.random() * TAU, spin: this.rnd(-1, 1), c0: [5, 3.6, 1.6, 1], c1: [1.1, 0.25, 0.05, 1], cPow: 0.6, aPow: 1.4, fadeIn: 0.04, mode: PM.GLOW, ground: gY + 1, wind: 0.3 });
    }
    // 3) Kıvılcımlar: hızla fırlar, yerçekimiyle düşer, uzayan çizgiler
    for (let i = 0; i < 46; i++) {
      (onGround ? this.dirUp(0.95, v) : this.dirSphere(v)).multiplyScalar(this.rnd(25, 75));
      X.spawn(t, { p, v, life: this.rnd(0.35, 1.1), k: 1.4, g: 9.8, s0: 0.07, s1: 0.04, c0: [6, 4.2, 1.8, 1], c1: [2, 0.6, 0.15, 1], stretch: 0.035, mode: PM.SPARK, aPow: 1.2, ground: gY, wind: 0 });
    }
    // 4) Enkaz: koyu parçalar, balistik, yerde durur
    for (let i = 0; i < (onGround ? 28 : 10); i++) {
      (onGround ? this.dirUp(0.85, v) : this.dirSphere(v)).multiplyScalar(this.rnd(8, 30));
      const dk = this.rnd(0.06, 0.13);
      A.spawn(t, { p, v, life: this.rnd(1.4, 2.6), k: 0.35, g: 9.8, s0: this.rnd(0.18, 0.45), rot: Math.random() * TAU, spin: this.rnd(-9, 9), c0: [dk, dk * 0.95, dk * 0.9, 1], c1: [dk, dk * 0.95, dk * 0.9, 1], aPow: 0.15, mode: PM.DEBRIS, ground: gY + 0.05, wind: 0 });
    }
    // 5) Duman: ateş topundan doğan, yükselip genişleyen, yavaş sönen koyu-gri sütun
    for (let i = 0; i < 16; i++) {
      (onGround ? this.dirUp(0.7, v) : this.dirSphere(v)).multiplyScalar(this.rnd(1, 5));
      v.y += onGround ? this.rnd(2, 6) : 1.5;
      q.copy(p).addScaledVector(v, 0.25);
      const dk = this.rnd(0.12, 0.22);
      A.spawn(t + this.rnd(0.12, 0.6), { p: q, v, life: this.rnd(5.5, 9), k: 0.45, g: -0.6, s0: this.rnd(3, 5), s1: this.rnd(13, 20), rot: Math.random() * TAU, spin: this.rnd(-0.25, 0.25), c0: [dk, dk, dk * 0.98, 0.85], c1: [0.42, 0.41, 0.4, 0.5], cPow: 0.7, aPow: 1.3, fadeIn: 0.05, mode: PM.SMOKE, ground: gY + 1.5 });
    }
    if (!onGround) return;
    // 6) Toz: yerde dışa doğru savrulan kahverengi bulut ve halka
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU, sp = this.rnd(10, 24);
      v.set(Math.cos(a) * sp, this.rnd(0.5, 3), Math.sin(a) * sp);
      q.set(p.x + Math.cos(a) * 1.5, gY + 0.6, p.z + Math.sin(a) * 1.5);
      A.spawn(t + this.rnd(0, 0.08), { p: q, v, life: this.rnd(2.2, 4.2), k: 1.6, g: -0.3, s0: this.rnd(2, 3.5), s1: this.rnd(8, 13), rot: Math.random() * TAU, spin: this.rnd(-0.4, 0.4), c0: [0.48, 0.41, 0.31, 0.7], c1: [0.55, 0.5, 0.42, 0.25], aPow: 1.4, fadeIn: 0.05, mode: PM.SMOKE, ground: gY + 0.8 });
    }
    A.spawn(t, { p: q.set(p.x, gY, p.z), life: 0.9, s0: 3, s1: 34, c0: [0.62, 0.55, 0.45, 0.55], c1: [0.6, 0.55, 0.47, 0], aPow: 1.2, mode: PM.RING, rot: Math.random() * TAU, wind: 0 });
    if (kind === 'ground') this.craters.place(p, this.rnd(3.6, 4.6), t);
  }

  splash(p, waterY) {
    const t = this.t, A = this.alpha, v = this._v, q = this._p;
    for (let i = 0; i < 26; i++) {
      this.dirUp(0.18, v).multiplyScalar(this.rnd(14, 38));
      q.set(p.x, waterY, p.z);
      A.spawn(t + this.rnd(0, 0.1), { p: q, v, life: this.rnd(1.6, 2.8), k: 0.6, g: 9.8, s0: this.rnd(1.4, 2.6), s1: this.rnd(4, 7), rot: Math.random() * TAU, spin: this.rnd(-1, 1), c0: [0.95, 0.97, 1, 0.9], c1: [0.85, 0.9, 0.95, 0.2], aPow: 1.1, mode: PM.SMOKE, ground: waterY, wind: 0.6 });
    }
    for (let i = 0; i < 14; i++) {
      const a = Math.random() * TAU, sp = this.rnd(6, 16);
      v.set(Math.cos(a) * sp, this.rnd(0.5, 2), Math.sin(a) * sp);
      A.spawn(t + this.rnd(0.05, 0.3), { p: q.set(p.x, waterY + 0.5, p.z), v, life: this.rnd(2.5, 4), k: 1.2, g: -0.2, s0: 3, s1: this.rnd(9, 14), rot: Math.random() * TAU, c0: [0.9, 0.93, 0.96, 0.55], c1: [0.9, 0.93, 0.96, 0], mode: PM.SMOKE, ground: waterY + 0.3 });
    }
    A.spawn(t, { p: q.set(p.x, waterY, p.z), life: 1.4, s0: 4, s1: 30, c0: [0.95, 0.97, 1, 0.6], c1: [0.9, 0.95, 1, 0], mode: PM.RING, rot: Math.random() * TAU, wind: 0 });
  }

  /** Ateşleme: lülede kısa beyaz parlama ve kalın beyaz duman topağı. */
  ignition(p, vel, axis) {
    const t = this.t, X = this.add, A = this.alpha, v = this._v, q = this._p;
    X.spawn(t, { p, life: 0.09, s0: 3.5, s1: 6, c0: [9, 7.5, 5, 1], c1: [4, 2, 0.8, 0], mode: PM.GLOW, wind: 0 });
    for (let i = 0; i < 9; i++) {
      this.dirSphere(v).multiplyScalar(this.rnd(2, 7)).addScaledVector(vel, 0.25).addScaledVector(axis, -this.rnd(5, 25));
      q.copy(p).addScaledVector(axis, -this.rnd(0, 1.5));
      A.spawn(t, { p: q, v, life: this.rnd(1.6, 3.2), k: 2.2, g: -0.3, s0: this.rnd(0.8, 1.4), s1: this.rnd(3.5, 6), rot: Math.random() * TAU, spin: this.rnd(-0.6, 0.6), c0: [0.95, 0.94, 0.92, 0.75], c1: [0.8, 0.8, 0.8, 0.0], aPow: 0.9, fadeIn: 0.03, mode: PM.SMOKE });
    }
  }

  /** Ejektörün gaz/toz puflaması (yuvadan). */
  ejectPuff(p, vel) {
    const t = this.t, v = this._v;
    for (let i = 0; i < 4; i++) {
      this.dirSphere(v).multiplyScalar(this.rnd(0.5, 2)).addScaledVector(vel, 0.9);
      this.alpha.spawn(t, { p, v, life: this.rnd(0.5, 0.9), k: 3, s0: 0.3, s1: 1.4, rot: Math.random() * TAU, c0: [0.85, 0.85, 0.85, 0.4], c1: [0.85, 0.85, 0.85, 0], mode: PM.SMOKE, wind: 0.2 });
    }
  }

  /** Motorun yanında düzensiz aralıklarla eklenen hacim topakları (şeridin kenarını kırar). */
  trailPuff(p, vel) {
    const v = this._v;
    this.dirSphere(v).multiplyScalar(this.rnd(0.5, 2.5)).addScaledVector(vel, 0.05);
    this.alpha.spawn(this.t, { p, v, life: this.rnd(2.5, 4.5), k: 1.5, g: -0.25, s0: this.rnd(0.9, 1.6), s1: this.rnd(3.5, 6.5), rot: Math.random() * TAU, spin: this.rnd(-0.3, 0.3), c0: [0.9, 0.9, 0.9, 0.42], c1: [0.82, 0.82, 0.82, 0], aPow: 1.1, fadeIn: 0.06, mode: PM.SMOKE });
  }

  dispose() {
    this.scene.remove(this.alpha.mesh, this.add.mesh);
    for (const s of [this.alpha, this.add]) { s.geometry.dispose(); s.material.dispose(); }
    this.trailMat.dispose(); this.atlas.dispose(); this.noise.dispose(); this.craters.dispose();
  }
}
