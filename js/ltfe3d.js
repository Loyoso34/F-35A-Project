// Milas–Bodrum Havalimanı (LTFE) 3B meydan: OpenStreetMap aeroway geometrisi (Overture Maps
// üzerinden, geo/bodrum/airport/ltfe.json; tools/geodata/vectors.py).
//
// DOĞRULANMIŞ (OSM geometrisi): pistler, taksi yolu eksenleri, apronlar, stopway'ler, terminal ve
// hangar ayak izleri (adlar: "İç Hatlar Terminali", "Dış Hatlar Terminali").
// YAKLAŞIK (açıkça belirtilir, veri yok): taksi yolu genişliği 23 m (ICAO kod E; OSM width etiketi
// Overture'da yok), bina yükseklikleri (terminal 16 m, hangar 14 m, diğerleri alan sezgisi),
// bekleme konumu çizgilerinin yeri (ICAO Annex 14 Tablo 3-2: kod 4 hassas yaklaşma pisti için
// eksenden 90 m; gerçek konumlar ölçülmedi). KURULMAYANLAR (doğrulanamadı): kontrol kulesi (açık
// veride konumu yok), PAPI, yaklaşma ışıkları, taksi yolu ışıkları, park yeri numaraları.
//
// Zemin: kaplamalı alanlar (pist, taksi yolu, apron) pist profillerinden türetilen meydan yüzeyine
// oturtulur; kaplamanın 120 m dışına doğru ham araziye yumuşak geçiş. Fizik ve arazi örgüsü aynı
// conform() işlevini kullanır (teker havada kalmaz, gömülmez).
import * as THREE from 'three';
import { MSL_Y } from './geo.js';
import { applyHaze } from './worldshade.js';

const TAXI_W = 23;          // m, yaklaşık (bkz. üst not)
const HOLD_DIST = 90;       // m, pist ekseninden (ICAO, yaklaşık konum)
const FADE = 120;           // m, kaplama dışı geçiş
const CELL = 8;             // m, kaplama uzaklık ızgarası

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Ltfe3D {
  /**
   * @param {object} frame LocalFrame
   * @param {object} ap   georegion LTFE (pistler prepareAirport ile yerel çerçevede: A, B, ux, uz, len, eA, eB)
   * @param {object} data airport/ltfe.json
   */
  constructor(frame, ap, data) {
    this.frame = frame; this.ap = ap; this.data = data;
    const L = (c) => frame.toLocal(c[1], c[0]);
    const F = data.features;
    this.taxiways = F.taxiway.map((f) => ({ pts: f.line.map(L), surface: f.surface })).filter((t) => t.pts.length > 1);
    this.aprons = F.apron.map((f) => f.poly.map(L));
    this.stopways = F.stopway.map((f) => f.line.map(L));
    this.gates = F.airport_gate.map((f) => L(f.p));
    this.buildings = data.buildings.map((b) => ({ ...b, pts: b.poly.map(L) }));
    // Taksi yolu parçaları: pist kaplamasının İÇİNDE kalan kısımlar atılır (pistle eş düzlemli
    // kaplama derinlik yarışına girerdi); kalan parçalar fizik yüzey sorgusu ve çizim içindir.
    this.segs = [];
    for (const t of this.taxiways) {
      for (let i = 0; i + 1 < t.pts.length; i++) {
        const a = t.pts[i], b = t.pts[i + 1];
        const pieces = this.clipOutsideRunways(a, b);
        for (const [p, q] of pieces) this.segs.push({ ax: p.x, az: p.z, bx: q.x, bz: q.z });
      }
    }
    this.buildIndex();
    this.buildPavedField();
  }

  // ---- Geometri yardımcıları -----------------------------------------------------------------
  rwLocal(r, x, z) { const dx = x - r.cx, dz = z - r.cz; return { u: dx * r.ux + dz * r.uz, v: -dx * r.uz + dz * r.ux }; }
  inRunway(x, z, margin = 0) {
    for (const r of this.ap.runways) {
      const o = this.rwLocal(r, x, z);
      if (Math.abs(o.v) <= r.width / 2 + margin && o.u >= -r.len / 2 - r.ends[0].pad - margin && o.u <= r.len / 2 + r.ends[1].pad + margin) return r;
    }
    return null;
  }
  /** a–b doğru parçasının pist dikdörtgenleri DIŞINDA kalan alt parçaları (2 m örnekleme). */
  clipOutsideRunways(a, b) {
    const L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 2));
    const out = []; let start = null;
    for (let k = 0; k <= n; k++) {
      const t = k / n, p = { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
      const inside = !!this.inRunway(p.x, p.z, 0.5);
      if (!inside && !start) start = p;
      if ((inside || k === n) && start) { const end = inside ? { x: a.x + (b.x - a.x) * Math.max(0, (k - 1) / n), z: a.z + (b.z - a.z) * Math.max(0, (k - 1) / n) } : p; if (Math.hypot(end.x - start.x, end.z - start.z) > 0.5) out.push([start, end]); start = null; }
    }
    return out;
  }

  /** Taksi yolu parçaları ve apronlar için kaba ızgara dizini (yüzey sorgusu 120 Hz). */
  buildIndex() {
    const C = 100, grid = new Map(), key = (i, j) => i * 100003 + j;
    const put = (x0, z0, x1, z1, item) => {
      for (let i = Math.floor(x0 / C); i <= Math.floor(x1 / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor(z1 / C); j++) {
        const k = key(i, j); let a = grid.get(k); if (!a) grid.set(k, a = []); a.push(item);
      }
    };
    const h = TAXI_W / 2;
    for (const s of this.segs) put(Math.min(s.ax, s.bx) - h, Math.min(s.az, s.bz) - h, Math.max(s.ax, s.bx) + h, Math.max(s.az, s.bz) + h, { seg: s });
    for (const poly of this.aprons) {
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const p of poly) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
      put(x0, z0, x1, z1, { poly });
    }
    this.grid = grid; this.gridC = C; this.gridKey = key;
  }
  static inPoly(poly, x, z) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) c = !c;
    }
    return c;
  }
  static segDist(s, x, z) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
    return Math.hypot(x - s.ax - dx * t, z - s.az - dz * t);
  }
  /** Fizik yüzeyi: 'apron' | 'taxiway' | null (pist ayrı sorgulanır). */
  surfaceAt(x, z) {
    const a = this.grid.get(this.gridKey(Math.floor(x / this.gridC), Math.floor(z / this.gridC)));
    if (!a) return null;
    let taxi = false;
    for (const it of a) {
      if (it.poly) { if (Ltfe3D.inPoly(it.poly, x, z)) return 'apron'; }
      else if (!taxi && Ltfe3D.segDist(it.seg, x, z) <= TAXI_W / 2) taxi = true;
    }
    return taxi ? 'taxiway' : null;
  }

  /**
   * Kaplama uzaklık alanı (m): kaplamanın içinde 0, dışında en yakın kaplamaya uzaklık (8 m ızgara,
   * iki geçişli pah uzaklığı). conform() bunu kullanarak YALNIZCA kaplamayı ve çevresini düzleştirir.
   */
  buildPavedField() {
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
    const grow = (p) => { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); };
    for (const s of this.segs) { grow({ x: s.ax, z: s.az }); grow({ x: s.bx, z: s.bz }); }
    for (const p of this.aprons) p.forEach(grow);
    for (const r of this.ap.runways) { grow(r.A); grow(r.B); }
    const m = FADE + 2 * CELL;
    x0 -= m; x1 += m; z0 -= m; z1 += m;
    const W = Math.ceil((x1 - x0) / CELL) + 1, H = Math.ceil((z1 - z0) / CELL) + 1;
    const d = new Float32Array(W * H).fill(1e6);
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      const x = x0 + i * CELL, z = z0 + j * CELL;
      if (this.inRunway(x, z, 10) || this.surfaceAt(x, z)) d[j * W + i] = 0;
    }
    const D1 = CELL, D2 = CELL * Math.SQRT2;
    for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
      let v = d[j * W + i];
      if (i > 0) v = Math.min(v, d[j * W + i - 1] + D1);
      if (j > 0) { v = Math.min(v, d[(j - 1) * W + i] + D1); if (i > 0) v = Math.min(v, d[(j - 1) * W + i - 1] + D2); if (i < W - 1) v = Math.min(v, d[(j - 1) * W + i + 1] + D2); }
      d[j * W + i] = v;
    }
    for (let j = H - 1; j >= 0; j--) for (let i = W - 1; i >= 0; i--) {
      let v = d[j * W + i];
      if (i < W - 1) v = Math.min(v, d[j * W + i + 1] + D1);
      if (j < H - 1) { v = Math.min(v, d[(j + 1) * W + i] + D1); if (i < W - 1) v = Math.min(v, d[(j + 1) * W + i + 1] + D2); if (i > 0) v = Math.min(v, d[(j + 1) * W + i - 1] + D2); }
      d[j * W + i] = v;
    }
    this.field = { d, W, H, x0, z0 };
  }
  pavedDist(x, z) {
    const F = this.field;
    const fx = (x - F.x0) / CELL, fz = (z - F.z0) / CELL;
    if (fx < 0 || fz < 0 || fx >= F.W - 1 || fz >= F.H - 1) return 1e6;
    const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, W = F.W, d = F.d;
    return (d[j * W + i] * (1 - u) + d[j * W + i + 1] * u) * (1 - v) + (d[(j + 1) * W + i] * (1 - u) + d[(j + 1) * W + i + 1] * u) * v;
  }

  /** Meydan yüzeyi (MSL): pist profilleri; pistler arası doğrusal, dışta en yakın pistin profili. */
  aeroSurface(x, z) {
    const R = this.ap.runways, N = this.ap.rwN, S = this.ap.rwS;
    const prof = (r) => { const o = this.rwLocal(r, x, z); const u = Math.max(-r.len / 2 - 150, Math.min(r.len / 2 + 150, o.u)); return r.eA + (r.eB - r.eA) * (u + r.len / 2) / r.len; };
    const hN = prof(N), hS = prof(S);
    const v = -(x - this.ap.x) * this.ap.uz + (z - this.ap.z) * this.ap.ux;
    const e0 = N.vA + 32.5, e1 = S.vA - 32.5;
    const t = Math.min(1, Math.max(0, (v - e0) / (e1 - e0)));
    void R;
    return hN + (hS - hN) * t;
  }
  conform(x, z, h) {
    const dist = this.pavedDist(x, z);
    if (dist >= FADE) return h;
    const hA = this.aeroSurface(x, z);
    const w = 1 - smooth(0, FADE, dist);
    return h + (hA - h) * w;
  }

  // ---- Çizim ---------------------------------------------------------------------------------
  /**
   * @param {THREE.Group} group
   * @param {(x:number,z:number)=>number} groundY dünya y (MSL_Y dahil)
   * @param {object} o { pavementMap, concreteMap, glassMap, cladMap, hangarMap, shadows, track }
   */
  build(group, groundY, o) {
    const track = o.track || ((x) => x);
    const g = new THREE.Group(); g.name = 'ltfe-3d';
    // Kaplama: taksi yolu şeritleri + apron çokgenleri aynı malzeme, dünya koordinatlı UV
    // (örtüşen yerlerde hangisi çizilirse çizilsin aynı piksel: eş düzlemli titreme görünmez)
    const pos = [], uv = [];
    const Y = (x, z) => groundY(x, z) + 0.012;
    const quad = (a, b, c, d) => { for (const p of [a, b, c, a, c, d]) { pos.push(p.x, Y(p.x, p.z), p.z); uv.push(p.x / 18, p.z / 18); } };
    const hw = TAXI_W / 2;
    for (const s of this.segs) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az); if (L < 0.5) continue;
      const nx = -(s.bz - s.az) / L * hw, nz = (s.bx - s.ax) / L * hw;
      const n = Math.max(1, Math.ceil(L / 40));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const p0 = { x: s.ax + (s.bx - s.ax) * t0, z: s.az + (s.bz - s.az) * t0 }, p1 = { x: s.ax + (s.bx - s.ax) * t1, z: s.az + (s.bz - s.az) * t1 };
        quad({ x: p0.x + nx, z: p0.z + nz }, { x: p0.x - nx, z: p0.z - nz }, { x: p1.x - nx, z: p1.z - nz }, { x: p1.x + nx, z: p1.z + nz });
      }
      // Birleşimlerde köşe dolgusu: uçta taksi yolu genişliğinde kare (eksen sapmasında boşluk kalmaz)
    }
    for (const poly of this.aprons) {
      const shape = poly.map((p) => new THREE.Vector2(p.x, p.z));
      if (THREE.ShapeUtils.isClockWise(shape)) shape.reverse();
      const tris = THREE.ShapeUtils.triangulateShape(shape, []);
      for (const t of tris) for (const k of t) { const p = shape[k]; pos.push(p.x, Y(p.x, p.y), p.y); uv.push(p.x / 18, p.y / 18); }
    }
    const pg = track(new THREE.BufferGeometry());
    pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    pg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    pg.computeVertexNormals();
    // Üçgen sarımı karışık olabilir: normaller yukarı zorlanır
    { const nn = pg.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0); }
    // Açık renk beton (görüntüde apron ve taksi yolları çevresinden açık): doku tonu × açık sıcak gri
    const paveMat = track(new THREE.MeshStandardMaterial({ map: o.concreteMap, color: 0xf2efe8, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    applyHaze(paveMat, 'ltfe-pave');
    const pm = new THREE.Mesh(pg, paveMat); pm.receiveShadow = !!o.shadows; pm.name = 'ltfe-pavement';
    g.add(pm);
    // İşaretler: sarı taksi yolu ekseni (0,3 m) ve bekleme konumu çizgileri (desen A)
    const mk = [];
    const Ym = (x, z) => groundY(x, z) + 0.03;
    const strip = (a, b, w) => {
      const L = Math.hypot(b.x - a.x, b.z - a.z); if (L < 0.05) return;
      const nx = -(b.z - a.z) / L * w / 2, nz = (b.x - a.x) / L * w / 2;
      for (const p of [[a, 1], [a, -1], [b, -1], [a, 1], [b, -1], [b, 1]]) mk.push(p[0].x + nx * p[1], Ym(p[0].x + nx * p[1], p[0].z + nz * p[1]), p[0].z + nz * p[1]);
    };
    for (const s of this.segs) {
      const L = Math.hypot(s.bx - s.ax, s.bz - s.az), n = Math.max(1, Math.ceil(L / 40));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        strip({ x: s.ax + (s.bx - s.ax) * t0, z: s.az + (s.bz - s.az) * t0 }, { x: s.ax + (s.bx - s.ax) * t1, z: s.az + (s.bz - s.az) * t1 }, 0.3);
      }
    }
    this.holds = this.holdPositions();
    for (const h of this.holds) {
      // desen A: pist tarafında iki kesikli, taksi yolu tarafında iki sürekli çizgi (0,15 m, 0,15 m ara)
      const ax = { x: h.dx, z: h.dz }, cx = { x: -h.dz, z: h.dx };      // ax: piste doğru
      for (let k = 0; k < 4; k++) {
        const off = (k - 1.5) * 0.3, dashed = k < 2;
        const c0 = { x: h.x + ax.x * off, z: h.z + ax.z * off };
        for (let s = -hw; s < hw - 0.01; s += dashed ? 2 : hw * 2) {
          const s1 = Math.min(hw, s + (dashed ? 1 : hw * 2));
          strip({ x: c0.x + cx.x * s, z: c0.z + cx.z * s }, { x: c0.x + cx.x * s1, z: c0.z + cx.z * s1 }, 0.15);
        }
      }
    }
    const mg = track(new THREE.BufferGeometry());
    mg.setAttribute('position', new THREE.Float32BufferAttribute(mk, 3));
    mg.computeVertexNormals();
    { const nn = mg.attributes.normal; for (let i = 0; i < nn.count; i++) nn.setXYZ(i, 0, 1, 0); }
    const yel = track(new THREE.MeshStandardMaterial({ color: 0xe8b830, roughness: 0.8, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 }));
    applyHaze(yel, 'ltfe-paint');
    const ym = new THREE.Mesh(mg, yel); ym.receiveShadow = !!o.shadows; ym.name = 'ltfe-taxi-markings';
    g.add(ym);
    // Binalar: OSM ayak izleri, düz çatı; yükseklik yaklaşık (bkz. üst not)
    this.computeSolids(groundY);
    const wallGlass = track(new THREE.MeshStandardMaterial({ map: o.glassMap, color: 0xdfe6ec, roughness: 0.35, metalness: 0.25 }));
    const wallClad = track(new THREE.MeshStandardMaterial({ map: o.cladMap, color: 0xe4e2dc, roughness: 0.8 }));
    const wallHangar = track(new THREE.MeshStandardMaterial({ map: o.hangarMap, color: 0xd0d4d8, roughness: 0.6, metalness: 0.3 }));
    const roof = track(new THREE.MeshStandardMaterial({ color: 0xb9bcbf, roughness: 0.85 }));
    for (const m of [wallGlass, wallClad, wallHangar, roof]) applyHaze(m, 'ltfe-bld');
    // Malzemeye göre BİRLEŞTİRİLMİŞ gövdeler: 129 bina = 4 çizim çağrısı (çatı, cam, kaplama, hangar)
    const lists = { roof: [], glass: [], clad: [], hangar: [] };
    for (const b of this.buildings) {
      const shape = new THREE.Shape(b.pts.map((p) => new THREE.Vector2(p.x, -p.z)));
      const H = this.buildingHeight(b);
      const base = b.base;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: H + 1.5, bevelEnabled: false, curveSegments: 1 });
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, base - 1.5, 0);
      const term = /terminal/i.test(b.name || '');
      const wallKey = term ? 'glass' : b.class === 'hangar' ? 'hangar' : 'clad';
      // ExtrudeGeometry grupları: 0 = kapaklar (çatı/taban), 1 = yanlar
      const P = geo.attributes.position, N = geo.attributes.normal, U = geo.attributes.uv;
      for (const grp of geo.groups) {
        const dst = lists[grp.materialIndex === 0 ? 'roof' : wallKey];
        dst.push({ P, N, U, start: grp.start, count: grp.count });
      }
    }
    const mats = { roof, glass: wallGlass, clad: wallClad, hangar: wallHangar };
    for (const [k, parts] of Object.entries(lists)) {
      const n = parts.reduce((s, p) => s + p.count, 0);
      if (!n) continue;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uvs = new Float32Array(n * 2);
      let o2 = 0;
      for (const p of parts) for (let i = p.start; i < p.start + p.count; i++, o2++) {
        pos.set([p.P.getX(i), p.P.getY(i), p.P.getZ(i)], o2 * 3); nor.set([p.N.getX(i), p.N.getY(i), p.N.getZ(i)], o2 * 3);
        // Cephe UV'si 8 m'lik döşeme (ExtrudeGeometry'nin UV'si metre cinsindendir)
        uvs.set([p.U.getX(i) / 8, p.U.getY(i) / 8], o2 * 2);
      }
      const geo = track(new THREE.BufferGeometry());
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
      const mesh = new THREE.Mesh(geo, mats[k]);
      mesh.castShadow = true; mesh.receiveShadow = !!o.shadows; mesh.name = 'ltfe-bld-' + k;
      g.add(mesh);
    }
    group.add(g);
    return g;
  }

  /** Çarpışma gövdeleri (AABB + ayak izi çokgeni); çizimden bağımsız (başsız testler de kullanır). */
  computeSolids(groundY) {
    this.buildingSolids = [];
    for (const b of this.buildings) {
      let base = Infinity, x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const p of b.pts) {
        base = Math.min(base, groundY(p.x, p.z));
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z);
      }
      b.base = base;
      this.buildingSolids.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, minY: base - 1.5, maxY: base + this.buildingHeight(b), poly: b.pts, name: b.name || '' });
    }
    return this.buildingSolids;
  }

  /** Yükseklik: OSM height / kat; yoksa yaklaşık (terminal 16 m, hangar 14 m, alan sezgisi). */
  buildingHeight(b) {
    if (b.height) return b.height;
    if (b.levels) return b.levels * 3.5 + 1;
    if (/terminal/i.test(b.name || '')) return 16;
    if (b.class === 'hangar') return 14;
    if (b.class === 'industrial') return 8;
    return b.area > 2000 ? 10 : b.area > 400 ? 7 : 4.5;
  }

  /**
   * Bekleme konumu çizgileri: taksi yolu ekseninin en yakın pist eksenine uzaklığının 90 m'yi geçtiği
   * noktalar (yaklaşık: ICAO standart uzaklığı; gerçek konumlar ölçülmedi).
   */
  holdPositions() {
    const out = [];
    // Uzaklık: pist ekseni DOĞRU PARÇASINA (uç pedleri dahil). Eksene dik uzaklık + u penceresi
    // kullanmak en yakın pistin pencere sınırında sıçramasına ve sahte çizgilere yol açıyordu
    // (10R/28L uzantısında eksenden 20 m'de bir çizgi).
    const near = (x, z) => {
      let best = null;
      for (const r of this.ap.runways) {
        const o = this.rwLocal(r, x, z);
        const uc = Math.max(-r.len / 2 - r.ends[0].pad, Math.min(r.len / 2 + r.ends[1].pad, o.u));
        const du = o.u - uc, d = Math.hypot(du, o.v);
        if (!best || d < best.d) best = { r, d, du, dv: o.v };
      }
      return best;
    };
    for (const t of this.taxiways) {
      for (let i = 0; i + 1 < t.pts.length; i++) {
        const a = t.pts[i], b = t.pts[i + 1], L = Math.hypot(b.x - a.x, b.z - a.z), n = Math.max(1, Math.ceil(L / 1.5));
        let prev = null;
        for (let k = 0; k <= n; k++) {
          const p = { x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n };
          const nb = near(p.x, p.z), d = nb ? nb.d : 1e9;
          if (prev !== null && (prev - HOLD_DIST) * (d - HOLD_DIST) < 0 && nb) {
            // piste doğru yön (en yakın eksen noktasına): pist yerelinden dünyaya
            const r = nb.r, ox = nb.du * r.ux - nb.dv * r.uz, oz = nb.du * r.uz + nb.dv * r.ux, l = Math.hypot(ox, oz) || 1;
            const dx = -ox / l, dz = -oz / l;
            if (!out.some((h) => Math.hypot(h.x - p.x, h.z - p.z) < 30)) out.push({ x: p.x, z: p.z, dx, dz });
          }
          prev = d;
        }
      }
    }
    return out;
  }
}
