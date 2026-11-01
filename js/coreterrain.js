// Çekirdek harita (v5.0): Bodrum yarımadası, tam 20 km × 20 km (400 km²).
//
// Yükseklik alanı: 2049 × 2049 örnek, 9,77 m aralık, yerel TM çerçevesinde eksen hizalı kare.
//  - Taban: gerçek DEM (Copernicus/SRTM, z12 ≈ 30 m) Catmull-Rom bikübik ara değerle; deniz
//    hücrelerinde batimetri (deniz tabanı negatif). Yükseklikler ABARTILMAZ: yarımadanın gerçek
//    tepeleri (~600 m) korunur.
//  - Kıyı çizgisi: OSM kıyı çizgisinden gelen su maskesi yumuşatılır; yüksekliğin işareti maskeyle
//    tutarlı kılınır (kara > 0, deniz < 0). 30 m merdiven kıyı oluşmaz.
//  - Mikro kabartma: DEM'in yumuşattığı < 90 m ölçekli ayrıntı (yamaçlarda daha güçlü, kıyıda ve
//    düzlükte sönük; kara/deniz işaretini değiştirmez).
//  - Tasarım düzenlemeleri (bodrum.js): şehir terasları, kıyı rıhtımları, yol yatakları
//    (yarma/dolgu), liman derinleştirme. Hepsi aynı alana yazılır: fizik ve çizim aynı yüzeyi görür.
//  - Kenar bandı (700 m): çekirdek yüzeyi bölgesel araziye (geoterrain.js) yumuşakça bağlanır.
//
// Çizim: 64×64 kareli düğümlerden dörtlü ağaç (kök 20 km, yaprak 625 m = 9,77 m köşe aralığı).
// CDLOD tarzı geçiş: tek indisli köşeler mesafeyle üst seviyenin yüzeyine kayar (LOD sıçraması ve
// çatlak yok). Gölgelemede normal, AO, tasarım maskesi ve makro albedo 2048² dokulardan gelir:
// ışık LOD'dan bağımsızdır. Fizik yüzeyi = en ince düğüm üçgenleri (köşegen (i,j+1)-(i+1,j)).
import * as THREE from 'three';
import { lonToTileX, latToTileY, tileXToLon, tileYToLat, MSL_Y } from './geo.js';
import { clamp, smoothstep, mulberry32 } from './noise.js';
import { makeTerrainMaterial } from './terrainmat.js';
import { CURVE_K } from './geoterrain.js';

export const CORE = (() => {
  const c = { cx: -23400, cz: 22100, half: 10000, N: 2048 };
  c.x0 = c.cx - c.half; c.z0 = c.cz - c.half; c.x1 = c.cx + c.half; c.z1 = c.cz + c.half;
  c.size = 2 * c.half; c.s = c.size / c.N;
  return c;
})();
export const CORE_BAND = 700;
const LEAF_L = 5, QN = 64;                  // yaprak seviyesi, düğüm ızgarası

export function inCore(x, z, margin = 0) {
  return x > CORE.x0 + margin && x < CORE.x1 - margin && z > CORE.z0 + margin && z < CORE.z1 - margin;
}

// Döşenebilir değer gürültüsü tablosu (mikro kabartma; simplex'ten ~20 kat hızlı)
function noiseTile(size, seed, oct) {
  const out = new Float32Array(size * size), rand = mulberry32(seed);
  let amp = 1, norm = 0, f = 4;
  for (let o = 0; o < oct; o++) {
    const n = f, lat = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lat[i] = rand() * 2 - 1;
    const sc = n / size;
    for (let y = 0; y < size; y++) {
      const fy = y * sc, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), y1 = (y0 + 1) % n;
      for (let x = 0; x < size; x++) {
        const fx = x * sc, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), x1 = (x0 + 1) % n;
        const a = lat[y0 * n + x0], b = lat[y0 * n + x1], c = lat[y1 * n + x0], d = lat[y1 * n + x1];
        out[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    norm += amp; amp *= 0.5; f *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}
function tileSample(T, size, x, y) {
  const fx = x - Math.floor(x / size) * size, fy = y - Math.floor(y / size) * size;
  const x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0;
  const x1 = (x0 + 1) % size, y1 = (y0 + 1) % size;
  return (T[y0 * size + x0] * (1 - tx) + T[y0 * size + x1] * tx) * (1 - ty) + (T[y1 * size + x0] * (1 - tx) + T[y1 * size + x1] * tx) * ty;
}
const cr = (p0, p1, p2, p3, t) => p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));

class CNode {
  constructor(L, i0, j0) {
    this.L = L; this.i0 = i0; this.j0 = j0;
    this.span = CORE.N >> L;                 // grid indices covered
    this.st = this.span / QN;                // grid step between vertices
    this.size = CORE.size / (1 << L);
    this.minX = CORE.x0 + i0 * CORE.s; this.maxX = this.minX + this.size;
    this.minZ = CORE.z0 + j0 * CORE.s; this.maxZ = this.minZ + this.size;
    this.cx = (this.minX + this.maxX) / 2; this.cz = (this.minZ + this.maxZ) / 2;
    this.minY = MSL_Y - 60; this.maxY = MSL_Y + 700;
    this.children = null; this.mesh = null; this.built = false; this.lastSeen = 0;
  }
}

export class CoreTerrain {
  /**
   * o: { frame, dem (DemStore), demZ, group (THREE.Group | null), lodFactor, texSize, nodeBudget, buildMs }
   */
  constructor(o) {
    this.o = o;
    this.frame = o.frame; this.dem = o.dem; this.demZ = o.demZ;
    this.group = o.group || null;
    this.N = CORE.N; this.n1 = CORE.N + 1; this.s = CORE.s;
    this.H = new Float32Array(this.n1 * this.n1);
    this.lodFactor = o.lodFactor || 2.2;
    this.detail = 1;
    this.texSize = o.texSize || 2048;
    this.buildMs = o.buildMs || 3;
    this.nodeBudget = o.nodeBudget || 160;
    this.stats = { nodes: 0, drawn: 0, built: 0 };
    this.root = new CNode(0, 0, 0);
    this.pool = [];
    this.frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._box = new THREE.Box3();
    this.time = 0;
  }

  // ===========================================================================================
  // 1) Taban yüzeyi: gerçek DEM'den
  // ===========================================================================================
  /** DEM karolarından çekirdeği örten ham ızgara (batimetri dahil) + su maskesi. */
  buildRaster() {
    const f = this.frame, z = this.demZ, g = { lat: 0, lon: 0 };
    let gx0 = Infinity, gx1 = -Infinity, gy0 = Infinity, gy1 = -Infinity;
    const M = 400;
    for (let b = 0; b <= 8; b++) for (let a = 0; a <= 8; a++) {
      f.toGeo(CORE.x0 - M + (CORE.size + 2 * M) * a / 8, CORE.z0 - M + (CORE.size + 2 * M) * b / 8, g);
      const gx = lonToTileX(g.lon, z) * 256, gy = latToTileY(g.lat, z) * 256;
      gx0 = Math.min(gx0, gx); gx1 = Math.max(gx1, gx); gy0 = Math.min(gy0, gy); gy1 = Math.max(gy1, gy);
    }
    const px0 = Math.floor(gx0) - 4, py0 = Math.floor(gy0) - 4;
    const W = Math.ceil(gx1) - px0 + 8, Hh = Math.ceil(gy1) - py0 + 8;
    const R = new Float32Array(W * Hh), Wm = new Float32Array(W * Hh);
    let missing = 0;
    for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
      const gx = px0 + x, gy = py0 + y;
      const t = this.dem.get(z, gx >> 8, gy >> 8);
      const k = y * W + x;
      if (!t || !t.ready || !t.raw) { R[k] = -40; Wm[k] = 1; missing++; continue; }
      const i = (gy & 255) * 256 + (gx & 255);
      R[k] = t.raw[i]; Wm[k] = t.w[i];
    }
    // Su maskesi yumuşatma (3×3 çadır, iki kez): kıyı çizgisi yuvarlanır
    const Wb = new Float32Array(W * Hh), tmp = new Float32Array(W * Hh);
    const blur = (src, dst) => {
      for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= Hh) continue;
          const wgt = (dx ? 1 : 2) * (dy ? 1 : 2);
          s += src[yy * W + xx] * wgt; n += wgt;
        }
        dst[y * W + x] = s / n;
      }
    };
    blur(Wm, tmp); blur(tmp, Wb);
    this.raster = { px0, py0, W, H: Hh, R, Wb, Wm, missing };
    return missing;
  }

  /** Örnek (i, j) için global z12 piksel koordinatları: 16 örnekte bir kesin, arası çift doğrusal. */
  buildMapping() {
    const K = 16, n = this.N / K + 1, gxA = new Float64Array(n * n), gyA = new Float64Array(n * n);
    const f = this.frame, g = { lat: 0, lon: 0 }, z = this.demZ;
    for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
      f.toGeo(CORE.x0 + a * K * this.s, CORE.z0 + b * K * this.s, g);
      gxA[b * n + a] = lonToTileX(g.lon, z) * 256; gyA[b * n + a] = latToTileY(g.lat, z) * 256;
    }
    this.map16 = { K, n, gxA, gyA };
  }
  pix(i, j, o) {
    const M = this.map16, K = M.K, n = M.n;
    const a = Math.min(Math.floor(i / K), n - 2), b = Math.min(Math.floor(j / K), n - 2);
    const ta = i / K - a, tb = j / K - b, q = b * n + a;
    o.gx = (M.gxA[q] * (1 - ta) + M.gxA[q + 1] * ta) * (1 - tb) + (M.gxA[q + n] * (1 - ta) + M.gxA[q + n + 1] * ta) * tb;
    o.gy = (M.gyA[q] * (1 - ta) + M.gyA[q + 1] * ta) * (1 - tb) + (M.gyA[q + n] * (1 - ta) + M.gyA[q + n + 1] * ta) * tb;
    return o;
  }

  /** Taban yükseklik alanı (üreteç: ilerleme kesri verir). */
  *bakeBase() {
    this.buildRaster();
    this.buildMapping();
    const { px0, py0, W, H: RH, R, Wb, Wm } = this.raster;
    const Hf = this.H, n1 = this.n1, N = this.N;
    const nT = noiseTile(256, 4242, 4);
    const nT2 = noiseTile(256, 4243, 3);
    const o = { gx: 0, gy: 0 };
    const at = (x, y) => R[clamp(y, 0, RH - 1) * W + clamp(x, 0, W - 1)];
    // fizik (geoterrain DemStore): deniz pikseli 0 m, göl ve kara kendi değeri
    const atZ = (x, y) => { const k = clamp(y, 0, RH - 1) * W + clamp(x, 0, W - 1); return Wm[k] && R[k] < 0 ? 0 : R[k]; };
    const band = CORE_BAND / this.s;
    for (let j = 0; j <= N; j++) {
      for (let i = 0; i <= N; i++) {
        this.pix(i, j, o);
        const u = o.gx - px0 - 0.5, v = o.gy - py0 - 0.5;
        const x0 = Math.floor(u), y0 = Math.floor(v), tu = u - x0, tv = v - y0;
        // Catmull-Rom bikübik
        const r0 = cr(at(x0 - 1, y0 - 1), at(x0, y0 - 1), at(x0 + 1, y0 - 1), at(x0 + 2, y0 - 1), tu);
        const r1 = cr(at(x0 - 1, y0), at(x0, y0), at(x0 + 1, y0), at(x0 + 2, y0), tu);
        const r2 = cr(at(x0 - 1, y0 + 1), at(x0, y0 + 1), at(x0 + 1, y0 + 1), at(x0 + 2, y0 + 1), tu);
        const r3 = cr(at(x0 - 1, y0 + 2), at(x0, y0 + 2), at(x0 + 1, y0 + 2), at(x0 + 2, y0 + 2), tu);
        let h = cr(r0, r1, r2, r3, tv);
        // Bölgesel yüzey (kenar bandı hedefi): geoterrain.js'in kanonik yüzeyiyle BİREBİR aynı — köşe değeri
        // dört piksel merkezinin ortalaması, köşegen (i, j+1)–(i+1, j) üçgen ara değeri
        const xb = clamp(x0, 0, W - 2), yb = clamp(y0, 0, RH - 2);
        let hb;
        {
          const cx = o.gx - px0, cy = o.gy - py0, ci = Math.floor(cx), cj = Math.floor(cy), cu = cx - ci, cv = cy - cj;
          const tri = (f) => {
            const corner = (ii, jj) => (f(ii - 1, jj - 1) + f(ii, jj - 1) + f(ii - 1, jj) + f(ii, jj)) * 0.25;
            if (cu + cv <= 1) { const a = corner(ci, cj), b = corner(ci, cj + 1), d = corner(ci + 1, cj); return a + cu * (d - a) + cv * (b - a); }
            const b = corner(ci, cj + 1), d = corner(ci + 1, cj), c = corner(ci + 1, cj + 1); return c + (1 - cu) * (b - c) + (1 - cv) * (d - c);
          };
          hb = tri(at);
          var hbP = tri(atZ);
        }
        // Su payı (yumuşatılmış maske, çift doğrusal)
        const wf = (Wb[yb * W + xb] * (1 - tu) + Wb[yb * W + xb + 1] * tu) * (1 - tv) + (Wb[(yb + 1) * W + xb] * (1 - tu) + Wb[(yb + 1) * W + xb + 1] * tu) * tv;
        const c = 0.5 - wf;
        if (c > 0) {
          h = Math.max(h, 0.3 + 2.4 * c);
          // Mikro kabartma (yalnızca karada, kıyıdan uzakta; eğimle güçlenir)
          if (h > 1.5) {
            const xw = i * this.s, zw = j * this.s;
            const n1v = tileSample(nT, 256, xw / 11.0, zw / 11.0);         // ~90 m
            const n2v = tileSample(nT2, 256, (xw * 0.8 - zw * 0.6) / 4.1, (xw * 0.6 + zw * 0.8) / 4.1);   // ~30 m
            const sl = Math.min(1, Math.abs(hb - h) * 0.05 + Math.abs(at(x0 + 1, y0) - at(x0, y0)) / 30 + Math.abs(at(x0, y0 + 1) - at(x0, y0)) / 30);
            const amp = (0.6 + 4.0 * sl) * smoothstep(1.5, 10, h);
            h += (n1v * 0.75 + n2v * 0.35) * amp;
          }
        } else {
          h = Math.min(h, -0.3 + 4.0 * c);
        }
        // Kenar bandı: bölgesel yüzeye yumuşak geçiş (deniz işaretini koru)
        const e = Math.min(i, j, N - i, N - j);
        if (e < band) {
          const k = smoothstep(0, band, e);
          // kıyı karışık hücrelerinde bölgesel fizik yüzeyi (> 0) esas; açık denizde çizim için taban
          const hr = hbP > 0.05 ? hbP : Math.min(hb, -0.3);
          h = hr + (h - hr) * k;
        }
        Hf[j * n1 + i] = h;
      }
      if ((j & 63) === 0) yield j / N;
    }
    this.raster.R = null;   // bellek
  }

  // ===========================================================================================
  // 2) Tasarım düzenlemeleri
  // ===========================================================================================
  idx(x, z) { return [(x - CORE.x0) / this.s, (z - CORE.z0) / this.s]; }
  /** Tasarım düzenlemelerinin ağırlığı: kenar bandında sıfıra iner (bölgesel araziyle dikiş olmaz). */
  edgeW(x, z) { return smoothstep(80, CORE_BAND, Math.min(x - CORE.x0, CORE.x1 - x, z - CORE.z0, CORE.z1 - z)); }
  /** Izgara indis kutusu (x0..x1, z0..z1 dünya), kenarlarla sınırlı. */
  rangeOf(minX, minZ, maxX, maxZ) {
    const i0 = clamp(Math.floor((minX - CORE.x0) / this.s), 0, this.N), i1 = clamp(Math.ceil((maxX - CORE.x0) / this.s), 0, this.N);
    const j0 = clamp(Math.floor((minZ - CORE.z0) / this.s), 0, this.N), j1 = clamp(Math.ceil((maxZ - CORE.z0) / this.s), 0, this.N);
    return [i0, i1, j0, j1];
  }
  /**
   * Çokgen içini hedef yüksekliğe getirir; dışında `margin` metrede yumuşak geçiş.
   * target: sayı ya da (x, z, hEski) => h. mode: 'set' | 'min' (yalnızca alçalt) | 'max' (yalnızca yükselt)
   */
  editPoly(poly, target, margin = 30, mode = 'set') {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const [i0, i1, j0, j1] = this.rangeOf(minX - margin, minZ - margin, maxX + margin, maxZ + margin);
    const H = this.H, n1 = this.n1, fn = typeof target === 'function';
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const x = CORE.x0 + i * this.s, z = CORE.z0 + j * this.s;
      const d = polySignedDist(poly, x, z);
      if (d > margin) continue;
      const w = (d <= 0 ? 1 : 1 - smoothstep(0, margin, d)) * this.edgeW(x, z);
      if (w <= 0) continue;
      const k = j * n1 + i, h0 = H[k];
      const t = fn ? target(x, z, h0) : target;
      let h = h0 + (t - h0) * w;
      if (mode === 'min') h = Math.min(h0, h); else if (mode === 'max') h = Math.max(h0, h);
      H[k] = h;
    }
  }
  /**
   * Yol yatağı: polyline (her noktada y = yol profili MSL), yarı genişlik hw. Yatak (hw + 1,5 hücre)
   * tam profile oturur; dışında şev (yarma 1:1, dolgu 1:1,5) araziye bağlanır.
   * skip(t): true ise o parça (köprü) dolgu yapılmaz.
   */
  editCorridor(pts, hw, opts = {}) {
    const H = this.H, n1 = this.n1, s = this.s;
    const flat = hw + 1.5 * s;
    const maxSide = opts.maxSide || 45;
    const best = this._corrBest || (this._corrBest = new Map());
    best.clear();
    for (let k = 0; k + 1 < pts.length; k++) {
      const A = pts[k], B = pts[k + 1];
      if (opts.skip && opts.skip(k)) continue;
      const ext = flat + maxSide;
      const [i0, i1, j0, j1] = this.rangeOf(Math.min(A.x, B.x) - ext, Math.min(A.z, B.z) - ext, Math.max(A.x, B.x) + ext, Math.max(A.z, B.z) + ext);
      const dx = B.x - A.x, dz = B.z - A.z, L2 = dx * dx + dz * dz || 1;
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const x = CORE.x0 + i * s, z = CORE.z0 + j * s;
        const t = clamp(((x - A.x) * dx + (z - A.z) * dz) / L2, 0, 1);
        const d = Math.hypot(x - A.x - t * dx, z - A.z - t * dz);
        if (d > ext) continue;
        const key = j * n1 + i;
        const b = best.get(key);
        if (b === undefined || d < b.d) best.set(key, { d, y: A.y + (B.y - A.y) * t });
      }
    }
    for (const [key, b] of best) {
      const h0 = H[key];
      const ew = this.edgeW(CORE.x0 + (key % n1) * s, CORE.z0 + Math.floor(key / n1) * s);
      if (ew <= 0) continue;
      if (b.d <= flat) { H[key] = h0 + (b.y - h0) * ew; continue; }
      const dh = h0 - b.y, side = b.d - flat;
      const reach = Math.min(maxSide, Math.abs(dh) * (dh > 0 ? 1.0 : 1.5) + 3);
      if (side >= reach) continue;
      const w = (1 - smoothstep(0, reach, side)) * ew;
      H[key] = h0 + (b.y - h0) * w;
    }
    best.clear();
  }

  // ===========================================================================================
  // 3) Sorgular (fizik)
  // ===========================================================================================
  /** Çizilen yüzey (deniz tabanı dahil, MSL m): en ince düğüm üçgenleri. */
  rawAt(x, z) {
    let gx = (x - CORE.x0) / this.s, gz = (z - CORE.z0) / this.s;
    gx = clamp(gx, 0, this.N - 1e-6); gz = clamp(gz, 0, this.N - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j, H = this.H, n1 = this.n1;
    const a = H[j * n1 + i], b = H[(j + 1) * n1 + i], d = H[j * n1 + i + 1];
    if (u + v <= 1) return a + u * (d - a) + v * (b - a);
    const c = H[(j + 1) * n1 + i + 1];
    return c + (1 - u) * (b - c) + (1 - v) * (d - c);
  }
  /** Fizik zemini (MSL): deniz yüzeyi 0. */
  mslAt(x, z) { const h = this.rawAt(x, z); return h > 0 ? h : 0; }
  isWater(x, z) { return this.rawAt(x, z) < -0.02; }
  /** Izgara örneği (indisle). */
  hAt(i, j) { return this.H[clamp(j, 0, this.N) * this.n1 + clamp(i, 0, this.N)]; }
  /** Yumuşak (çift doğrusal) örnek: tasarım için. */
  smoothAt(x, z) {
    const gx = clamp((x - CORE.x0) / this.s, 0, this.N - 1e-6), gz = clamp((z - CORE.z0) / this.s, 0, this.N - 1e-6);
    const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j, H = this.H, n1 = this.n1;
    return (H[j * n1 + i] * (1 - u) + H[j * n1 + i + 1] * u) * (1 - v) + (H[(j + 1) * n1 + i] * (1 - u) + H[(j + 1) * n1 + i + 1] * u) * v;
  }
  /** Eğim (gradyan büyüklüğü, m/m). */
  slopeAt(x, z) {
    const e = this.s;
    const dx = (this.smoothAt(x + e, z) - this.smoothAt(x - e, z)) / (2 * e), dz = (this.smoothAt(x, z + e) - this.smoothAt(x, z - e)) / (2 * e);
    return Math.hypot(dx, dz);
  }

  // ===========================================================================================
  // 4) Dokular: normal + AO, tasarım maskesi, makro albedo
  // ===========================================================================================
  /** Normal (RG), boşluk AO (B) dokusu (üreteç; sonuç this.normalTex). */
  *makeNormalTexture() {
    const T = this.texSize, data = new Uint8Array(T * T * 4), sc = this.N / T, e = this.s * sc;
    const H = this.H, n1 = this.n1, N = this.N;
    const at = (gx, gz) => {
      gx = clamp(gx, 0, N - 1e-6); gz = clamp(gz, 0, N - 1e-6);
      const i = gx | 0, j = gz | 0, u = gx - i, v = gz - j;
      return (H[j * n1 + i] * (1 - u) + H[j * n1 + i + 1] * u) * (1 - v) + (H[(j + 1) * n1 + i] * (1 - u) + H[(j + 1) * n1 + i + 1] * u) * v;
    };
    // Boşluk AO: 512² ızgarada, 30 m ve 120 m halka ortalamasıyla fark (vadiler koyu, sırtlar açık)
    const A = 512, ao = new Float32Array(A * A), sa = N / A;
    const r1 = 30 / this.s, r2 = 120 / this.s;
    for (let y = 0; y < A; y++) for (let x = 0; x < A; x++) {
      const gx = (x + 0.5) * sa, gz = (y + 0.5) * sa, h = at(gx, gz);
      if (h < 0) { ao[y * A + x] = 1; continue; }
      let s1 = 0, s2 = 0;
      for (let k = 0; k < 6; k++) {
        const a = k * Math.PI / 3 + 0.3, ca = Math.cos(a), sn = Math.sin(a);
        s1 += at(gx + ca * r1, gz + sn * r1); s2 += at(gx + ca * r2, gz + sn * r2);
      }
      const cav = (s1 / 6 - h) * 0.07 + (s2 / 6 - h) * 0.02;
      ao[y * A + x] = clamp(1 - Math.max(0, cav), 0.5, 1);
    }
    for (let ty = 0; ty < T; ty++) {
      for (let tx = 0; tx < T; tx++) {
        const gx = (tx + 0.5) * sc, gz = (ty + 0.5) * sc;
        const hx = (at(gx + sc, gz) - at(gx - sc, gz)) / (2 * e), hz = (at(gx, gz + sc) - at(gx, gz - sc)) / (2 * e);
        const L = Math.hypot(hx, 1, hz);
        const ax = clamp((tx + 0.5) * A / T - 0.5, 0, A - 1.001), ay = clamp((ty + 0.5) * A / T - 0.5, 0, A - 1.001);
        const ai = ax | 0, aj = ay | 0, au = ax - ai, av = ay - aj;
        const aoV = (ao[aj * A + ai] * (1 - au) + ao[aj * A + ai + 1] * au) * (1 - av) + (ao[(aj + 1) * A + ai] * (1 - au) + ao[(aj + 1) * A + ai + 1] * au) * av;
        const o = (ty * T + tx) * 4;
        data[o] = Math.round((-hx / L * 0.5 + 0.5) * 255); data[o + 1] = Math.round((-hz / L * 0.5 + 0.5) * 255);
        data[o + 2] = Math.round(aoV * 255); data[o + 3] = 255;
      }
      if ((ty & 127) === 0) yield ty / T;
    }
    const t = new THREE.DataTexture(data, T, T, THREE.RGBAFormat);
    t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.anisotropy = this.o.anisotropy || 4;
    t.needsUpdate = true;
    this.normalTex = t;
  }

  /**
   * Tasarım maskesi: R kentsel zemin, G kum (kumsal), B sulanan yeşil, A kaya. Kumsal ve kıyı kayası
   * yükseklikten türetilir; kentsel/yeşil alanlar tasarım katmanından (paint işlevleri).
   */
  *initMask(T = 1024) {
    this.maskT = T;
    this.mask = new Uint8Array(T * T * 4);
    const M = this.mask, s = CORE.size / T;
    for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
      const x = CORE.x0 + (tx + 0.5) * s, z = CORE.z0 + (ty + 0.5) * s;
      const h = this.smoothAt(x, z);
      const o = (ty * T + tx) * 4;
      if (h < 0) continue;
      const sl = this.slopeAt(x, z);
      // kıyıya yakınlık: 8 yönde 45/90 m içinde su (yalnızca alçak zeminde)
      let nearW = 0;
      if (h < 40) for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7]]) {
        if (this.smoothAt(x + dx * 45, z + dz * 45) < 0) { nearW = 1; break; }
        if (this.smoothAt(x + dx * 90, z + dz * 90) < 0) nearW = 0.5;
      }
      const sand = nearW * (1 - smoothstep(1.6, 3.2, h)) * (1 - smoothstep(0.06, 0.16, sl));
      const rock = nearW * smoothstep(0.35, 0.7, sl) + smoothstep(0.75, 1.2, sl) * 0.6;
      M[o + 1] = Math.round(clamp(sand, 0, 1) * 255);
      M[o + 3] = Math.round(clamp(rock, 0, 1) * 255);
      if (tx === T - 1 && (ty & 63) === 0) yield ty / T;
    }
  }
  /** Maskeye çokgen boyar (kanal 0..3, değer 0..1, kenar yumuşatma m). */
  paintMask(poly, ch, val, feather = 15, mode = 'max') {
    const T = this.maskT, s = CORE.size / T, M = this.mask;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const p of poly) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
    const tx0 = clamp(Math.floor((minX - feather - CORE.x0) / s), 0, T - 1), tx1 = clamp(Math.ceil((maxX + feather - CORE.x0) / s), 0, T - 1);
    const ty0 = clamp(Math.floor((minZ - feather - CORE.z0) / s), 0, T - 1), ty1 = clamp(Math.ceil((maxZ + feather - CORE.z0) / s), 0, T - 1);
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const x = CORE.x0 + (tx + 0.5) * s, z = CORE.z0 + (ty + 0.5) * s;
      const d = polySignedDist(poly, x, z);
      if (d > feather) continue;
      const w = d <= 0 ? 1 : 1 - smoothstep(0, feather, d);
      const o = (ty * T + tx) * 4 + ch, v = Math.round(val * w * 255);
      M[o] = mode === 'set' ? Math.round(M[o] * (1 - w) + val * 255 * w) : mode === 'min' ? Math.min(M[o], 255 - Math.round((1 - val) * w * 255)) : Math.max(M[o], v);
    }
  }
  makeMaskTexture() {
    const T = this.maskT;
    const t = new THREE.DataTexture(this.mask, T, T, THREE.RGBAFormat);
    t.flipY = false; t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    t.needsUpdate = true;
    return t;
  }

  /**
   * Makro albedo: Sentinel-2 z13 karoları çekirdek dokusuna (TM ekseninde) afin dönüşümle çizilir.
   * imgUrl(z, x, y) -> URL. Tarayıcıda; başarısız karo gri kalır.
   */
  async makeMacroTexture(imgUrl, zImg, decode) {
    const T = Math.min(this.texSize, 2048);
    const cv = document.createElement('canvas'); cv.width = cv.height = T;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = 'rgb(120,112,96)'; ctx.fillRect(0, 0, T, T);
    const f = this.frame, g = { lat: 0, lon: 0 };
    let tx0 = Infinity, tx1 = -Infinity, ty0 = Infinity, ty1 = -Infinity;
    for (const [x, z] of [[CORE.x0, CORE.z0], [CORE.x1, CORE.z0], [CORE.x0, CORE.z1], [CORE.x1, CORE.z1]]) {
      f.toGeo(x, z, g);
      const tx = lonToTileX(g.lon, zImg), ty = latToTileY(g.lat, zImg);
      tx0 = Math.min(tx0, tx); tx1 = Math.max(tx1, tx); ty0 = Math.min(ty0, ty); ty1 = Math.max(ty1, ty);
    }
    const toTex = (lat, lon) => { const p = f.toLocal(lat, lon); return [(p.x - CORE.x0) / CORE.size * T, (p.z - CORE.z0) / CORE.size * T]; };
    const jobs = [];
    for (let ty = Math.floor(ty0); ty <= Math.floor(ty1); ty++) for (let tx = Math.floor(tx0); tx <= Math.floor(tx1); tx++) {
      jobs.push((async () => {
        let bmp;
        try { bmp = await decode(imgUrl(zImg, tx, ty)); } catch (e) { return; }
        if (!bmp) return;
        const P00 = toTex(tileYToLat(ty, zImg), tileXToLon(tx, zImg));
        const P10 = toTex(tileYToLat(ty, zImg), tileXToLon(tx + 1, zImg));
        const P01 = toTex(tileYToLat(ty + 1, zImg), tileXToLon(tx, zImg));
        const w = bmp.width || 256, h = bmp.height || 256;
        ctx.setTransform((P10[0] - P00[0]) / w, (P10[1] - P00[1]) / w, (P01[0] - P00[0]) / h, (P01[1] - P00[1]) / h, P00[0], P00[1]);
        ctx.drawImage(bmp, 0, 0, w, h, -0.6, -0.6, w + 1.2, h + 1.2);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        if (bmp.close) bmp.close();
      })());
    }
    await Promise.all(jobs);
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace; t.flipY = false;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.anisotropy = this.o.anisotropy || 4;
    t.needsUpdate = true;
    return t;
  }

  // ===========================================================================================
  // 5) Çizim: dörtlü ağaç
  // ===========================================================================================
  initRender(textures) {
    this.tex = textures;
    const n1 = QN + 1;
    const idx = [];
    const v = (i, j) => j * n1 + i;
    for (let j = 0; j < QN; j++) for (let i = 0; i < QN; i++) {
      const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j + 1), d = v(i + 1, j);
      idx.push(a, b, d, b, c, d);
    }
    const ring = [];
    for (let i = 0; i < QN; i++) ring.push([i, 0]);
    for (let j = 0; j < QN; j++) ring.push([QN, j]);
    for (let i = QN; i > 0; i--) ring.push([i, QN]);
    for (let j = QN; j > 0; j--) ring.push([0, j]);
    this.ring = ring;
    const base = n1 * n1, R = ring.length;
    for (let k = 0; k < R; k++) {
      const a = v(ring[k][0], ring[k][1]), b = v(ring[(k + 1) % R][0], ring[(k + 1) % R][1]);
      const a2 = base + k, b2 = base + (k + 1) % R;
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
    }
    this.vcount = base + R;
    this.index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    this.coreUV = { value: new THREE.Vector4(CORE.x0, CORE.z0, 1 / CORE.size, 1 / CORE.size) };
  }

  newMesh() {
    const vc = this.vcount, geo = new THREE.BufferGeometry();
    geo.setIndex(this.index);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
    geo.setAttribute('morph', new THREE.BufferAttribute(new Float32Array(vc), 1));
    const U = { tMacro: { value: this.tex.macro }, tNormal: { value: this.tex.normal }, tMask: { value: this.tex.mask }, uCoreUV: this.coreUV, uMorphK: { value: 1e9 } };
    const mat = makeTerrainMaterial('core', { uniforms: U });
    mat.userData.U = U;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.matrixAutoUpdate = false; mesh.visible = false;
    mesh.name = 'core-terrain-node';
    return mesh;
  }

  buildNode(n) {
    const n1 = QN + 1, st = n.st, H = this.H, N1 = this.n1, s = this.s;
    if (!n.mesh) { n.mesh = this.pool.pop() || this.newMesh(); this.group.add(n.mesh); }
    const geo = n.mesh.geometry;
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, mor = geo.attributes.morph.array;
    const ox = n.cx, oz = n.cz;
    let minY = Infinity, maxY = -Infinity;
    const hg = (i, j) => H[clamp(j, 0, this.N) * N1 + clamp(i, 0, this.N)];
    for (let j = 0; j <= QN; j++) for (let i = 0; i <= QN; i++) {
      const gi = n.i0 + i * st, gj = n.j0 + j * st;
      const h = hg(gi, gj), y = h + MSL_Y;
      const o = j * n1 + i;
      pos[o * 3] = CORE.x0 + gi * s - ox; pos[o * 3 + 1] = y; pos[o * 3 + 2] = CORE.z0 + gj * s - oz;
      // üst seviye yüzeyi (tek indisli köşeler)
      let ht = h;
      const oi = i & 1, oj = j & 1;
      if (oi && !oj) ht = (hg(gi - st, gj) + hg(gi + st, gj)) * 0.5;
      else if (!oi && oj) ht = (hg(gi, gj - st) + hg(gi, gj + st)) * 0.5;
      else if (oi && oj) ht = (hg(gi - st, gj + st) + hg(gi + st, gj - st)) * 0.5;
      mor[o] = ht - h;
      const hx = (hg(gi + st, gj) - hg(gi - st, gj)) / (2 * st * s), hz = (hg(gi, gj + st) - hg(gi, gj - st)) / (2 * st * s);
      const L = Math.hypot(hx, 1, hz);
      nor[o * 3] = -hx / L; nor[o * 3 + 1] = 1 / L; nor[o * 3 + 2] = -hz / L;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    const skirt = 4 + n.size * 0.006, R = this.ring.length;
    for (let r = 0; r < R; r++) {
      const [i, j] = this.ring[r], sI = j * n1 + i, o = n1 * n1 + r;
      pos[o * 3] = pos[sI * 3]; pos[o * 3 + 1] = pos[sI * 3 + 1] - skirt; pos[o * 3 + 2] = pos[sI * 3 + 2];
      nor[o * 3] = nor[sI * 3]; nor[o * 3 + 1] = nor[sI * 3 + 1]; nor[o * 3 + 2] = nor[sI * 3 + 2];
      mor[o] = mor[sI];
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.attributes.morph.needsUpdate = true;
    n.mesh.position.set(ox, 0, oz); n.mesh.updateMatrix();
    n.minY = minY - skirt; n.maxY = maxY;
    n.built = true;
    this.stats.built++;
  }

  inView(n, c) {
    const dx = n.cx - c.x, dz = n.cz - c.z;
    const drop = (dx * dx + dz * dz) * CURVE_K;
    const span = n.size * Math.hypot(dx, dz) * 2 * CURVE_K + 1;
    this._box.min.set(n.minX, n.minY - drop - span, n.minZ);
    this._box.max.set(n.maxX, n.maxY - drop + span, n.maxZ);
    return this.frustum.intersectsBox(this._box);
  }
  dist(n, c) {
    const dx = Math.max(n.minX - c.x, 0, c.x - n.maxX);
    const dz = Math.max(n.minZ - c.z, 0, c.z - n.maxZ);
    const dy = Math.max(n.minY - c.y, 0, c.y - n.maxY);
    return Math.hypot(dx, dy, dz);
  }

  /** Her kare: LOD seçimi, bütçeli inşa, görünürlük. */
  update(camera, dt = 0) {
    if (!this.group) return;
    this.time += dt;
    const c = camera.position;
    camera.updateMatrixWorld();
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pm);
    const F = this.lodFactor * this.detail;
    const sel = this._sel || (this._sel = []), want = this._want || (this._want = []);
    sel.length = 0; want.length = 0;
    const now = this.time;
    const visit = (n) => {
      n.lastSeen = now;
      const vis = this.inView(n, c);
      const d = this.dist(n, c);
      const k = vis ? F : F * 0.5;
      if (n.L < LEAF_L && d < n.size * k) {
        if (!n.children) {
          const h = n.span >> 1, L = n.L + 1;
          n.children = [new CNode(L, n.i0, n.j0), new CNode(L, n.i0 + h, n.j0), new CNode(L, n.i0, n.j0 + h), new CNode(L, n.i0 + h, n.j0 + h)];
        }
        let ready = true;
        for (const ch of n.children) { ch.lastSeen = now; if (!ch.built) { ready = false; want.push(ch); } }
        if (ready) { for (const ch of n.children) visit(ch); return; }
      }
      if (!n.built) want.push(n);
      if (vis) sel.push(n);
    };
    visit(this.root);
    // inşa: yakından uzağa, süre bütçesi (yükleme ekranında sınırsız)
    want.sort((a, b) => this.dist(a, c) / a.size - this.dist(b, c) / b.size);
    const t0 = performance.now();
    for (const n of want) {
      if (n.built) continue;
      this.buildNode(n);
      if (performance.now() - t0 > this.buildMs) break;
    }
    // görünürlük
    for (const m of this.group.children) m.visible = false;
    let drawn = 0;
    for (const n of sel) {
      if (!n.built || !n.mesh) continue;
      n.mesh.visible = true;
      // geçiş mesafesi: bu düğümün üst seviyesinin bölünme uzaklığı
      n.mesh.material.userData.U.uMorphK.value = n.L === 0 ? 1e9 : 2 * n.size * F * (this.inView(n, c) ? 1 : 0.5);
      drawn++;
    }
    this.stats.drawn = drawn;
    this.evict(now);
  }

  /** Uzun süredir görülmeyen düğümlerin örgüsü havuza döner. */
  evict(now) {
    let built = 0;
    const all = [];
    const walk = (n) => { if (n.built) { built++; all.push(n); } if (n.children) for (const ch of n.children) walk(ch); };
    walk(this.root);
    this.stats.nodes = built;
    if (built <= this.nodeBudget) return;
    all.sort((a, b) => a.lastSeen - b.lastSeen);
    for (const n of all) {
      if (built <= this.nodeBudget * 0.85) break;
      if (n.lastSeen >= now || n.L === 0) continue;
      this.release(n);
      built--;
    }
  }
  release(n) {
    if (n.mesh) { n.mesh.visible = false; this.group.remove(n.mesh); this.pool.push(n.mesh); n.mesh = null; }
    n.built = false;
    if (n.children) { for (const ch of n.children) this.release(ch); n.children = null; }
  }
  /** Tasarım değişikliğinden sonra: tüm düğümler yeniden kurulur. */
  invalidate() { this.release(this.root); this.root = new CNode(0, 0, 0); }

  /** Yükleme ekranında: görünür düğümleri bütçesiz kur. */
  prewarm(camera, maxMs = 2000) {
    const keep = this.buildMs; this.buildMs = 1e6;
    const t0 = performance.now();
    let prev = -1;
    while (performance.now() - t0 < maxMs) {
      this.update(camera, 0);
      if (this.stats.built === prev) break;
      prev = this.stats.built;
    }
    this.buildMs = keep;
  }

  dispose() {
    const walk = (n) => { if (n.mesh) { n.mesh.geometry.dispose(); n.mesh.material.dispose(); } if (n.children) n.children.forEach(walk); };
    walk(this.root);
    for (const m of this.pool) { m.geometry.dispose(); m.material.dispose(); }
    if (this.tex) for (const t of Object.values(this.tex)) if (t && t.dispose) t.dispose();
  }
}

/** Çokgene işaretli uzaklık (içeride negatif). poly: [{x, z}] */
export function polySignedDist(poly, x, z) {
  let inside = false, best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
    const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / L2, 0, 1);
    const d = Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
    if (d < best) best = d;
  }
  return inside ? -best : best;
}
