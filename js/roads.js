// Yol ağı (v5.0): gerçek OSM iskeleti (geo/bodrum/roads.json) + tasarlanmış bölge sokakları.
//
// Kesit sınıfa göre (Türkiye karayolu tipik değerleri, yaklaşık [E]):
//   trunk (D330)    : taşıt yolu başına 2 şerit × 3,6 m + 2,5 m banket; kenar çizgileri sürekli, şerit
//                     çizgisi kesikli (OSM bölünmüş yolu iki ayrı tek yönlü hat olarak tutar)
//   primary         : 2 × 3,6 m, kesikli eksen, sürekli kenar, 1,5 m banket
//   secondary       : 2 × 3,4 m, kesikli eksen, kenar çizgisi
//   tertiary        : 2 × 3,0 m, kesikli eksen
//   unclassified    : 5 m, çizgisiz
//   residential     : eski şehirde 4,6 m TAŞ DÖŞEME (Bodrum sokakları), bordür + kaldırım yok
//   bölge bulvarı   : 2 × 3 şerit, orta refüj, 5 m kaldırım, bordür
// Boy profili: arazi örneklenir, pencere ortalamasıyla yumuşatılır, sınıfa göre en büyük eğim
// (%7-%16) ileri/geri geçişle sınırlanır. Çekirdekte yol yatağı araziye yazılır (yarma/dolgu şevi);
// dolgu 7 m'yi aşarsa köprü (döşeme + ayaklar + korkuluk), 3 m'yi aşan dolguda bariyer.
// Kavşaklar: her yol köşesi en yakın kavşağa uzaklığı taşır; kavşak içinde işaret yok, şehir içinde
// yaya geçidi (zebra) ve dur çizgisi. İşaretler gölgelendiricide (keskin, dokusuz, her mesafede).
import * as THREE from 'three';
import { CORE, inCore, polySignedDist } from './coreterrain.js';
import { MSL_Y } from './geo.js';
import { clamp, smoothstep, mulberry32 } from './noise.js';
import { HAZE_UNIFORMS, HAZE_PARS_VS, CURVE_PROJECT } from './worldshade.js';
import { ArchBuilder } from './archmat.js';
import { SKYLINE } from './skyline.js';
import { buildLightPoints } from './runway.js';
import { LAYER_NOREFLECT } from './ocean.js';

// sınıf: [yarı genişlik (kaplama), işaret türü, en büyük eğim, yumuşatma penceresi m, banket m, yüzey]
// işaret: 0 yok, 1 iki yönlü (kesikli eksen + kenar), 2 tek yönlü 2 şerit, 3 iki yönlü kenarsız, 5 tek yönlü 3 şerit
const CLS = {
  2: { hw: 3.9, mark: 2, grade: 0.07, win: 70, sh: 2.5, surf: 0, lanes: 2, carve: true, light: 34 },
  3: { hw: 3.7, mark: 1, grade: 0.09, win: 55, sh: 1.5, surf: 0, lanes: 2, carve: true, light: 32 },
  4: { hw: 3.5, mark: 1, grade: 0.11, win: 45, sh: 1.0, surf: 0, lanes: 2, carve: true, light: 0 },
  5: { hw: 3.1, mark: 3, grade: 0.13, win: 35, sh: 0.8, surf: 0, lanes: 2, carve: true, light: 0 },
  6: { hw: 2.5, mark: 0, grade: 0.16, win: 25, sh: 0.5, surf: 0, lanes: 1, carve: false, light: 0 },
  7: { hw: 2.3, mark: 0, grade: 0.18, win: 15, sh: 0.0, surf: 1, lanes: 1, carve: false, light: 0 },
  8: { hw: 2.0, mark: 0, grade: 0.18, win: 15, sh: 0.0, surf: 1, lanes: 1, carve: false, light: 0 },
};

const ROAD_VS = /* glsl */`
  attribute vec4 aRoad; attribute float aJ;
  varying vec2 vR; varying vec4 vRoad; varying float vJ; varying vec3 vRW;
  uniform float hzCurv;
`;
const ROAD_FS = /* glsl */`
  uniform float uNightR;
  varying vec2 vR; varying vec4 vRoad; varying float vJ; varying vec3 vRW; varying vec4 vHaze;
  float rH(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float rN(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(rH(i), rH(i + vec2(1, 0)), f.x), mix(rH(i + vec2(0, 1)), rH(i + vec2(1, 1)), f.x), f.y); }
  float band(float x, float c, float w, float aa) { return 1.0 - smoothstep(w * 0.5 - aa, w * 0.5 + aa, abs(x - c)); }
`;
const ROAD_SURF = /* glsl */`
  float rMark = 0.0; vec3 rMarkC = vec3(0.92, 0.92, 0.88);
  {
    float x = vR.x, s = vR.y, hw = vRoad.x, mark = vRoad.z, surf = vRoad.w, lanes = vRoad.y;
    float camD = length(cameraPosition - vRW);
    float aa = clamp(camD * 0.0011, 0.02, 0.5);
    vec3 col;
    float rough = 0.88;
    if (surf < 0.5) {
      // asfalt: çok ölçekli tane, yamalar, tekerlek izleri (her şeritte iki iz), kenar kirlenmesi
      float g = rN(vRW.xz * 1.7) * 0.5 + rN(vRW.xz * 7.3) * 0.3 + rN(vRW.xz * 0.21) * 0.2;
      col = vec3(0.075, 0.077, 0.08) * (0.85 + 0.3 * g);
      float patchM = smoothstep(0.62, 0.66, rN(vRW.xz * 0.06 + 3.1));
      col = mix(col, vec3(0.05, 0.052, 0.055), patchM * 0.6);
      float lw = hw / max(lanes, 1.0);
      float lx = mod(x + hw, lw) / lw;
      float wear = band(lx, 0.27, 0.16, 0.05) + band(lx, 0.73, 0.16, 0.05);
      col = mix(col, col * 0.78, wear * 0.55 * (1.0 - smoothstep(300.0, 900.0, camD)));
      float edge = smoothstep(hw - 0.6, hw + 0.2, abs(x));
      col = mix(col, vec3(0.16, 0.145, 0.12), edge * 0.5);
      // banket (çakıl)
      float sh = step(hw + 0.05, abs(x));
      col = mix(col, vec3(0.22, 0.20, 0.16) * (0.8 + 0.4 * rN(vRW.xz * 3.0)), sh);
      rough = mix(0.86, 0.95, sh);
    } else if (surf < 1.5) {
      // taş döşeme (eski şehir): kaldırım taşı, derzler
      vec2 q = vec2(s * 1.6, x * 1.6 + 0.5 * step(1.0, mod(floor(s * 1.6), 2.0)));
      vec2 f = fract(q), i = floor(q);
      float j = 1.0 - smoothstep(0.06, 0.06 + aa * 2.0, min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)));
      col = mix(vec3(0.42, 0.40, 0.36), vec3(0.55, 0.52, 0.46), rH(i)) * (1.0 - j * 0.45 * (1.0 - smoothstep(60.0, 300.0, camD)));
      rough = 0.82;
    } else {
      col = vec3(0.36, 0.36, 0.35) * (0.9 + 0.2 * rN(vRW.xz * 2.0));
    }
    // işaretler (kavşak içinde yok)
    float jr = vJ;
    float inJ = 1.0 - step(0.0, jr);
    float m = 0.0;
    if (mark > 0.5 && jr > 0.0) {
      float dash = step(0.5, fract(s / 9.0 + 0.25)) ;    // 4,5 m çizgi / 4,5 m boşluk
      if (mark < 1.5) {
        m += band(x, 0.0, 0.15, aa) * dash;
        m += band(abs(x), hw - 0.25, 0.15, aa);
      } else if (mark < 2.5) {
        m += band(x, 0.0, 0.15, aa) * dash;
        m += band(abs(x), hw - 0.3, 0.2, aa);
      } else if (mark < 3.5) {
        m += band(x, 0.0, 0.12, aa) * dash;
      } else {
        float lw = 2.0 * hw / 3.0;
        m += (band(x, -hw + lw, 0.15, aa) + band(x, -hw + 2.0 * lw, 0.15, aa)) * dash;
        m += band(abs(x), hw - 0.3, 0.2, aa);
      }
      // dur çizgisi + yaya geçidi (kentsel kavşak yaklaşımı)
      if (vRoad.y > 1.5 || mark > 3.5) {
        float zb = step(jr, 6.5) * step(2.5, jr) * step(0.5, fract((x + hw) / 1.0)) * step(abs(x), hw - 0.4);
        m = max(m, zb);
        m = max(m, step(jr, 8.0) * step(7.4, jr) * step(abs(x), hw - 0.3));
      }
    }
    m *= 1.0 - smoothstep(1500.0, 3500.0, camD);
    col = mix(col, rMarkC * (0.92 + 0.08 * rN(vRW.xz * 3.0)), clamp(m, 0.0, 1.0) * 0.9);
    rough = mix(rough, 0.6, clamp(m, 0.0, 1.0));
    diffuseColor.rgb = col;
    roughnessFactor = rough;
  }
`;

function makeRoadMaterial() {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.userData.hazed = true;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, HAZE_UNIFORMS, { uNightR: { value: 0 } });
    sh.vertexShader = ROAD_VS + HAZE_PARS_VS.replace('uniform float hazeDensity; uniform float hazeFar; uniform float hzCurv;', 'uniform float hazeDensity; uniform float hazeFar;') + '\n' + sh.vertexShader
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n vR = uv; vRoad = aRoad; vJ = aJ;')
      .replace('#include <project_vertex>', CURVE_PROJECT + `
        vRW = (modelMatrix * vec4(transformed, 1.0)).xyz;
        // uzaklıkla artan derinlik payı: kaba LOD'daki arazinin altında kalmaz
        { float dd = length(mvPosition.xyz); mvPosition.xyz *= 1.0 - clamp((0.12 + dd * 0.0012) / max(dd, 1.0), 0.0, 0.2); gl_Position = projectionMatrix * mvPosition; }
        vHaze = hazeAt(vRW);`);
    sh.fragmentShader = ROAD_FS + '\n' + sh.fragmentShader
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n' + ROAD_SURF)
      .replace('#include <fog_fragment>', '')
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, vHaze.rgb, vHaze.a);\n#include <tonemapping_fragment>');
  };
  m.customProgramCacheKey = () => 'road5';
  return m;
}

/** Çizgiyi eşit aralıklı yeniden örnekler. */
function resample(pts, step) {
  const out = [{ x: pts[0].x, z: pts[0].z }];
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i], B = pts[i + 1], L = Math.hypot(B.x - A.x, B.z - A.z);
    let t = step - acc;
    while (t < L) { out.push({ x: A.x + (B.x - A.x) * t / L, z: A.z + (B.z - A.z) * t / L }); t += step; }
    acc = L - (t - step);
  }
  const E = pts[pts.length - 1], Lst = out[out.length - 1];
  if (Math.hypot(E.x - Lst.x, E.z - Lst.z) > step * 0.3) out.push({ x: E.x, z: E.z }); else { Lst.x = E.x; Lst.z = E.z; }
  return out;
}

export class RoadNetwork {
  constructor(city, data) {
    this.city = city; this.core = city.core; this.w = city.w;
    this.roads = [];
    const f = city.frame;
    if (data && data.roads) for (const r of data.roads) {
      const pts = r.p.map(([la, lo]) => f.toLocal(la, lo));
      const C = CLS[r.c]; if (!C) continue;
      // gökdelen bölgesi içindeki OSM sokakları tasarım sokaklarıyla değiştirilir
      const mid = pts[pts.length >> 1];
      if (city.skyPoly && polySignedDist(city.skyPoly, mid.x, mid.z) < -20 && r.c >= 5) continue;
      this.roads.push({ cls: r.c, bridge: !!r.b, pts, C, osm: true });
    }
    for (const s of SKYLINE.streets) {
      const pts = s.pts.map(([e, n]) => city.P(e, n));
      const C = Object.assign({}, CLS[s.cls === 3 ? 3 : 5], s.cls === 3 ? { hw: 10.5, mark: 5, lanes: 3, sh: 0 } : { hw: 4.0, mark: 3, sh: 0 });
      if (s.cls === 3) {
        // bulvar: iki tek yönlü taşıt yolu + refüj (6 m)
        for (const sd of [-1, 1]) {
          const off = pts.map((p, i) => {
            const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
            const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz);
            return { x: p.x - dz / l * sd * 8.5, z: p.z + dx / l * sd * 8.5 };
          });
          this.roads.push({ cls: 3, pts: off, C: Object.assign({}, C, { hw: 5.4 }), urban: true, curb: 5, design: true });
        }
      } else {
        this.roads.push({ cls: 5, pts, C, urban: true, curb: s.promenade ? 9 : 3.5, design: true });
        if (!s.promenade) (city.skylineStreets || (city.skylineStreets = [])).push({ pts, off: C.hw + 2.2 });
      }
    }
    this.junctions = [];
    this.grid = new Map(); this.cell = 60;
    this.stats = { km: 0, bridges: 0, lights: 0 };
  }

  // ---- Tasarım: profil + arazi yatağı -------------------------------------------------------
  *design() {
    const core = this.core, city = this.city;
    let k = 0;
    // sıra: küçük sınıflar önce, ana yollar en son (kavşakta ana yolun yatağı geçerli)
    const order = this.roads.slice().sort((a, b) => b.cls - a.cls);
    for (const r of order) {
      const step = r.cls <= 4 ? 8 : 10;
      const P = resample(r.pts, step);
      r.P = P;
      const inC = P.map((p) => inCore(p.x, p.z, 30));
      r.inCore = inC.some((v) => v);
      // arazi profili
      const terr = P.map((p) => (inCore(p.x, p.z, 2) ? core.smoothAt(p.x, p.z) : this.w.terrain.mslAt(p.x, p.z)));
      if (!r.C.carve || r.cls >= 6) {
        r.prof = terr.map((h) => Math.max(h, 0.4));
      } else {
        // pencere ortalaması
        const W = Math.max(1, Math.round(r.C.win / step));
        const sm = terr.map((_, i) => { let s = 0, n = 0; for (let j = Math.max(0, i - W); j <= Math.min(terr.length - 1, i + W); j++) { s += Math.max(terr[j], 1.2); n++; } return Math.max(1.0, s / n); });
        // uçlar araziye bağlı kalır (kavşak)
        sm[0] = Math.max(terr[0], 1.0); sm[sm.length - 1] = Math.max(terr[terr.length - 1], 1.0);
        const g = r.C.grade * step;
        for (let i = 1; i < sm.length; i++) sm[i] = clamp(sm[i], sm[i - 1] - g, sm[i - 1] + g);
        for (let i = sm.length - 2; i >= 0; i--) sm[i] = clamp(sm[i], sm[i + 1] - g, sm[i + 1] + g);
        // çekirdek dışında arazi düzenlenmez: profil araziyi izler (kenar bandında yumuşak geçiş)
        r.prof = sm.map((h, i) => {
          const p = P[i];
          const w = inCore(p.x, p.z) ? core.edgeW(p.x, p.z) : 0;
          return terr[i] + (h - terr[i]) * w;
        });
      }
      // OSM köprüsü (üst geçit, dere köprüsü): profil iki ucun arasında doğrusal, araziye yazılmaz
      if (r.bridge && r.prof.length > 1) {
        const a = r.prof[0], b = r.prof[r.prof.length - 1], n = r.prof.length - 1;
        r.prof = r.prof.map((_, i) => Math.max(a + (b - a) * i / n, terr[i] + 1));
      }
      r.terr = terr;
      // köprü: profil araziden 7 m'den yüksek (ya da su üstünde) ya da OSM köprüsü
      r.bridgeAt = r.prof.map((h, i) => r.bridge || h - terr[i] > 7 || (terr[i] < 0.2 && r.cls <= 5));
      if (r.C.carve && r.inCore) {
        const pts3 = P.map((p, i) => ({ x: p.x, z: p.z, y: r.prof[i] }));
        core.editCorridor(pts3, r.C.hw + r.C.sh + (r.curb || 0), { skip: (i) => r.bridgeAt[i] && r.bridgeAt[i + 1] });
      }
      if (++k % 40 === 0) yield 0.4 + 0.5 * k / order.length;
    }
    // Tüm yataklar yazıldıktan sonra: yollar SON araziye oturur (paralel taşıt yolları ve kesişen yollar
    // birbirinin yatağını değiştirdiyse yol yüzeyi havada kalmaz/gömülmez). Köprü açıklıkları profilde kalır.
    for (const r of this.roads) {
      r.prof = r.P.map((p, i) => {
        if (r.bridgeAt && r.bridgeAt[i] && r.C.carve && r.cls < 6) return r.prof[i];
        return inCore(p.x, p.z, 2) ? Math.max(core.rawAt(p.x, p.z), 0.4) : this.w.terrain.mslAt(p.x, p.z);
      });
    }
    this.index();
    this.findJunctions();
    // yol altındaki maske: kentsel zemin değil (yol kendi örgüsüyle çizilir); kum maskesini sil
    yield 0.95;
  }

  /** Kentsel/köy ev yerleşimi için sokaklar (kademe 1: eski şehir, 2: köyler). */
  *townStreets() {
    const city = this.city;
    const villages = [[-4700, 350, 900], [-7200, 600, 900], [-7600, -1300, 700], [-1300, 2300, 1300], [2300, 5300, 700], [-4400, 10600, 900], [-2000, 10800, 800], [1500, 1200, 900], [2700, -700, 700], [-3600, 1600, 700], [-11000, 8000, 1000]]
      .map(([e, n, r]) => { const p = city.P(e, n); return { x: p.x, z: p.z, r }; });
    for (const r of this.roads) {
      if (r.design || !r.inCore) continue;
      const mid = r.P[r.P.length >> 1];
      const inTown = city.townPoly && polySignedDist(city.townPoly, mid.x, mid.z) < 0;
      if (inTown && r.cls >= 4) { yield { pts: r.P, hw: r.C.hw, tier: 1 }; continue; }
      if (r.cls < 5) continue;
      const v = villages.find((q) => Math.hypot(q.x - mid.x, q.z - mid.z) < q.r);
      if (v) yield { pts: r.P, hw: r.C.hw, tier: 2 };
    }
  }

  index() {
    const add = (x, z, id, hw) => {
      const k = Math.floor(x / this.cell) * 100003 + Math.floor(z / this.cell);
      let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); }
      a.push([x, z, hw, id]);
    };
    this.roads.forEach((r, id) => { r.id = id; for (const p of r.P) add(p.x, p.z, id, r.C.hw + (r.curb || 0)); });
  }
  /** En yakın yol kenarına uzaklık (yaklaşık, örnek noktalarından). */
  nearRoad(x, z) {
    let best = 1e9;
    const i0 = Math.floor(x / this.cell), j0 = Math.floor(z / this.cell);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const a = this.grid.get(i * 100003 + j); if (!a) continue;
      for (const [px, pz, hw] of a) { const d = Math.hypot(px - x, pz - z) - hw; if (d < best) best = d; }
    }
    return best;
  }
  findJunctions() {
    // uç noktalar başka bir yola 4 m'den yakınsa kavşak
    const J = [];
    for (const r of this.roads) for (const p of [r.P[0], r.P[r.P.length - 1]]) {
      if (this.nearRoadOther(p.x, p.z, r) < 4) J.push({ x: p.x, z: p.z, r: r.C.hw });
    }
    // birleştir
    const out = [];
    for (const j of J) { const o = out.find((q) => Math.hypot(q.x - j.x, q.z - j.z) < 15); if (o) o.r = Math.max(o.r, j.r); else out.push(Object.assign({}, j)); }
    this.junctions = out;
    this.jgrid = new Map();
    for (const j of out) { const k = Math.floor(j.x / 100) * 100003 + Math.floor(j.z / 100); let a = this.jgrid.get(k); if (!a) { a = []; this.jgrid.set(k, a); } a.push(j); }
  }
  nearRoadOther(x, z, self) {
    let best = 1e9;
    const i0 = Math.floor(x / this.cell), j0 = Math.floor(z / this.cell);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const a = this.grid.get(i * 100003 + j); if (!a) continue;
      for (const [px, pz, hw, id] of a) {
        if (id === self.id) continue;
        const d = Math.hypot(px - x, pz - z) - hw; if (d < best) best = d;
      }
    }
    return best;
  }
  /** Kavşak işaret uzaklığı: kavşak yarıçapı dışında pozitif (m), içinde negatif. */
  jDist(x, z) {
    let best = 1e4;
    const i0 = Math.floor(x / 100), j0 = Math.floor(z / 100);
    for (let i = i0 - 1; i <= i0 + 1; i++) for (let j = j0 - 1; j <= j0 + 1; j++) {
      const a = this.jgrid.get(i * 100003 + j); if (!a) continue;
      for (const q of a) { const d = Math.hypot(q.x - x, q.z - z) - (q.r + 2.5); if (d < best) best = d; }
    }
    return best;
  }

  // ---- Çizim ----------------------------------------------------------------------------------
  *build(ctx) {
    const mat = makeRoadMaterial();
    this.material = mat;
    ctx.track(mat);
    const rand = mulberry32(77);
    const chunks = new Map();
    const chunkOf = (x, z, major) => {
      const S = 800, ci = Math.floor(x / S), cj = Math.floor(z / S), k = (ci * 10007 + cj) * 2 + (major ? 1 : 0);
      let c = chunks.get(k);
      if (!c) { c = { p: [], uv: [], ar: [], aj: [], idx: [], x: (ci + 0.5) * S, z: (cj + 0.5) * S, major, arch: new ArchBuilder() }; chunks.set(k, c); }
      return c;
    };
    const lamps = [], lampPts = [];
    const H = (r, i) => r.prof[i] + MSL_Y;
    for (const r of this.roads) {
      const P = r.P, n = P.length;
      if (n < 2) continue;
      const C = r.C, hw = C.hw, sh = C.sh, major = r.cls <= 4;
      // normaller
      const N = P.map((p, i) => {
        const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)];
        const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1;
        return { x: -dz / l, z: dx / l };
      });
      let s = 0;
      for (let i = 0; i + 1 < n; i++) {
        const A = P[i], B = P[i + 1], segL = Math.hypot(B.x - A.x, B.z - A.z);
        const c = chunkOf((A.x + B.x) / 2, (A.z + B.z) / 2, major);
        const W = hw + sh;
        const yA = H(r, i), yB = H(r, i + 1);
        const draped = !C.carve || r.cls >= 6;
        const off = 0.06;
        // kesit: kaplama + banket (5 köşe: -W, -hw, 0, +hw, +W)
        const xs = [-W, -hw, 0, hw, W];
        const base = c.p.length / 3;
        for (const [Pp, Nn, y0, ss, idx] of [[A, N[i], yA, s, i], [B, N[i + 1], yB, s + segL, i + 1]]) {
          const jd = this.jDist(Pp.x, Pp.z);
          for (const xx of xs) {
            const x = Pp.x + Nn.x * xx, z = Pp.z + Nn.z * xx;
            let y = y0;
            if (!r.bridgeAt[idx]) {
              const t = inCore(x, z, 2) ? this.core.rawAt(x, z) + MSL_Y : this.w.heightAt(x, z);
              y = Math.max(t, MSL_Y + 0.3);
            }
            c.p.push(x, y + off, z);
            c.uv.push(xx, ss);
            c.ar.push(hw, C.lanes, C.mark, C.surf);
            c.aj.push(jd);
          }
        }
        for (let k = 0; k < 4; k++) {
          const a = base + k, b = base + k + 1, d = base + 5 + k, e = base + 5 + k + 1;
          c.idx.push(a, b, d, b, e, d);   // yukarıdan bakınca saat yönü tersine (ön yüz yukarı)
        }
        // bordür + kaldırım (kentsel)
        if (r.curb) for (const sd of [-1, 1]) {
          const ca = { x: A.x + N[i].x * sd * (hw + 0.1), z: A.z + N[i].z * sd * (hw + 0.1) }, cb = { x: B.x + N[i + 1].x * sd * (hw + 0.1), z: B.z + N[i + 1].z * sd * (hw + 0.1) };
          const ang = Math.atan2(cb.z - ca.z, cb.x - ca.x);
          c.arch.box((ca.x + cb.x) / 2, (yA + yB) / 2 - 0.05, (ca.z + cb.z) / 2, segL + 0.2, 0.22, 0.2, ang, [0.72, 0.71, 0.68], [0.3, 3, 3, 0]);
          const sw = r.curb, mx = (A.x + B.x) / 2 + (N[i].x + N[i + 1].x) / 2 * sd * (hw + 0.2 + sw / 2), mz = (A.z + B.z) / 2 + (N[i].z + N[i + 1].z) / 2 * sd * (hw + 0.2 + sw / 2);
          c.arch.box(mx, (yA + yB) / 2 - 0.1, mz, segL + 0.3, sw, 0.22, ang, [0.56, 0.53, 0.49], [0.31, 3, 3, 0]);
        }
        // köprü: döşeme kenarı, korkuluk, ayaklar
        if (r.bridgeAt[i] && r.bridgeAt[i + 1]) {
          const ang = Math.atan2(B.z - A.z, B.x - A.x);
          c.arch.box((A.x + B.x) / 2, (yA + yB) / 2 - 1.3, (A.z + B.z) / 2, segL + 0.2, 2 * (hw + sh) + 0.6, 1.3, ang, [0.62, 0.61, 0.58], [0.4, 3, 3, 0], { bottom: true });
          for (const sd of [-1, 1]) c.arch.box((A.x + B.x) / 2 + N[i].x * sd * (hw + sh + 0.15), (yA + yB) / 2, (A.z + B.z) / 2 + N[i].z * sd * (hw + sh + 0.15), segL + 0.2, 0.3, 0.95, ang, [0.7, 0.7, 0.68], [0.4, 3, 3, 0]);
          if (Math.floor(s / 32) !== Math.floor((s + segL) / 32)) {
            const t = inCore(A.x, A.z, 2) ? this.core.rawAt(A.x, A.z) + MSL_Y : this.w.heightAt(A.x, A.z);
            const hgt = yA - 1.3 - Math.min(t, MSL_Y) + 3;
            c.arch.box(A.x, yA - 1.3 - hgt, A.z, 2.2, 2 * hw * 0.8, hgt, ang, [0.6, 0.59, 0.56], [0.41, 3, 3, 0]);
          }
          this.stats.bridges++;
        } else if (r.cls <= 4 && !draped) {
          // dolgu > 3 m: çelik bariyer (dikmeler + W kuşak)
          for (const sd of [-1, 1]) {
            const ox = (A.x + B.x) / 2 + (N[i].x) * sd * (hw + sh + 4), oz = (A.z + B.z) / 2 + N[i].z * sd * (hw + sh + 4);
            const t = inCore(ox, oz, 2) ? this.core.rawAt(ox, oz) + MSL_Y : this.w.heightAt(ox, oz);
            if ((yA + yB) / 2 - t > 3) {
              const ang = Math.atan2(B.z - A.z, B.x - A.x);
              const gx = (A.x + B.x) / 2 + N[i].x * sd * (hw + sh - 0.3), gz = (A.z + B.z) / 2 + N[i].z * sd * (hw + sh - 0.3);
              c.arch.box(gx, (yA + yB) / 2 + 0.45, gz, segL + 0.1, 0.12, 0.32, ang, [0.72, 0.74, 0.75], [0.5, 3, 3, 0]);
              for (let q = 0; q < segL; q += 4) c.arch.box(A.x + (B.x - A.x) * q / segL + N[i].x * sd * (hw + sh - 0.2), yA + (yB - yA) * q / segL, A.z + (B.z - A.z) * q / segL + N[i].z * sd * (hw + sh - 0.2), 0.12, 0.12, 0.8, ang, [0.6, 0.62, 0.63], [0.5, 3, 3, 0]);
            }
          }
        }
        // sokak lambaları: sınıf aralığıyla, yolun bir yanında (kentsel: iki yanda şaşırtmalı)
        const spacing = r.urban ? 28 : C.light;
        if (spacing && (r.urban || this.nearCity(A.x, A.z))) {
          let q0 = Math.ceil(s / spacing) * spacing;
          for (let q = q0; q < s + segL; q += spacing) {
            const t = (q - s) / segL, sd = r.urban ? (Math.round(q / spacing) % 2 ? 1 : -1) : 1;
            const lx = A.x + (B.x - A.x) * t + N[i].x * sd * (hw + sh + 0.8), lz = A.z + (B.z - A.z) * t + N[i].z * sd * (hw + sh + 0.8);
            const ly = yA + (yB - yA) * t;
            lamps.push([lx, ly, lz, Math.atan2(-N[i].z * sd, -N[i].x * sd), c]);
            lampPts.push({ x: lx - N[i].x * sd * 1.8, y: ly + 9.2, z: lz - N[i].z * sd * 1.8, colA: [1.0, 0.80, 0.52], kind: 0, night: 1 });
          }
        }
        s += segL;
      }
      this.stats.km += s / 1000;
      if (rand() < 0.02) yield 0.3;
    }
    // lamba direkleri (ince, 9 m, kollu)
    for (const [x, y, z, a, c] of lamps) {
      c.arch.cylinder(x, y, z, 0.11, 9.3, 6, [0.32, 0.34, 0.36], [0.6, 3, 3, 0]);
      c.arch.box(x + Math.cos(a) * 0.9, y + 9.1, z + Math.sin(a) * 0.9, 1.9, 0.18, 0.12, a, [0.32, 0.34, 0.36], [0.6, 3, 3, 0]);
      c.arch.box(x + Math.cos(a) * 1.8, y + 8.95, z + Math.sin(a) * 1.8, 0.7, 0.32, 0.18, a, [0.85, 0.85, 0.8], [0.6, 3, 3, 6]);
    }
    this.stats.lights = lamps.length;
    yield 0.6;
    // örgüler
    for (const c of chunks.values()) {
      if (!c.idx.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(c.p, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(c.uv, 2));
      g.setAttribute('aRoad', new THREE.Float32BufferAttribute(c.ar, 4));
      g.setAttribute('aJ', new THREE.Float32BufferAttribute(c.aj, 1));
      g.setIndex(c.p.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(c.idx, 1) : new THREE.Uint16BufferAttribute(c.idx, 1));
      g.computeVertexNormals();
      g.computeBoundingSphere();
      ctx.track(g);
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true; m.name = c.major ? 'roads-major' : 'roads-minor';
      ctx.addChunk(m, c.x, c.z, 600, c.major ? 14000 : 5000, { noReflect: true });
      if (c.arch.count) {
        const am = new THREE.Mesh(ctx.track(c.arch.geometry()), ctx.mats.arch);
        am.castShadow = true; am.receiveShadow = true; am.name = 'road-furniture';
        ctx.addChunk(am, c.x, c.z, 600, 4500);
      }
    }
    if (lampPts.length) {
      const lp = buildLightPoints(lampPts, { far: 12000, minPx: 1.4 });
      lp.name = 'street-lights';
      ctx.track(lp.geometry); ctx.track(lp.material);
      ctx.root.add(lp); ctx.lights(lp);
      lp.layers.set(0);
    }
    this.buildSigns(ctx);
    yield 1;
  }

  nearCity(x, z) {
    const c = this.city;
    return (c.townPoly && polySignedDist(c.townPoly, x, z) < 400) || (c.skyPoly && polySignedDist(c.skyPoly, x, z) < 300);
  }

  /** Yön levhaları (mavi, Türkiye şehirlerarası): gerçek yer adları, D330 kavşaklarında. */
  buildSigns(ctx) {
    if (typeof document === 'undefined') return;
    const signs = [
      { e: 1950, n: 1450, h: 215, lines: ['MİLAS  ↑', '✈ HAVALİMANI  36', 'TORBA  →'] },
      { e: -1350, n: 900, h: 300, lines: ['GÜMBET  ←', 'MERKEZ  ↑', 'TURGUTREİS  ←'] },
      { e: -2300, n: 960, h: 120, lines: ['BODRUM  ↑', 'GÜMBET KÖRFEZ  →', 'BİTEZ  ↑'] },
    ];
    const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 256 * signs.length;
    const g = cv.getContext('2d');
    signs.forEach((s, i) => {
      const y0 = i * 256;
      g.fillStyle = '#123f8c'; g.fillRect(0, y0, 1024, 256);
      g.strokeStyle = '#f2f2f2'; g.lineWidth = 10; g.strokeRect(10, y0 + 10, 1004, 236);
      g.fillStyle = '#f5f5f5'; g.font = 'bold 62px Arial, sans-serif';
      s.lines.forEach((t, k) => g.fillText(t, 40, y0 + 78 + k * 72));
    });
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    ctx.track(tex);
    const mat = ctx.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.1 }));
    const post = ctx.track(new THREE.MeshStandardMaterial({ color: 0x8b8f93, roughness: 0.6, metalness: 0.5 }));
    signs.forEach((s, i) => {
      const p = this.city.P(s.e, s.n);
      const y = this.core.rawAt(p.x, p.z) + MSL_Y;
      const a = this.city.dirAngle(s.h);
      const geo = new THREE.PlaneGeometry(6.4, 1.6);
      const uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setY(k, 1 - (i + (1 - uv.getY(k))) / signs.length);
      const m = new THREE.Mesh(ctx.track(geo), mat);
      m.position.set(p.x, y + 5.2, p.z); m.rotation.y = -a + Math.PI / 2;
      m.castShadow = true;
      ctx.addChunk(m, p.x, p.z, 10, 2500);
      const th = -a + Math.PI / 2, lx = Math.cos(th), lz = -Math.sin(th);
      for (const sd of [-1, 1]) {
        const pg = new THREE.Mesh(ctx.track(new THREE.CylinderGeometry(0.1, 0.1, 6, 6)), post);
        pg.position.set(p.x + lx * sd * 2.6, y + 3, p.z + lz * sd * 2.6);
        ctx.addChunk(pg, p.x, p.z, 10, 2500);
      }
    });
  }

  update() {}
}
void smoothstep; void LAYER_NOREFLECT; void CORE;
