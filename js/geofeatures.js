// Gerçek dünya bölgesinin 3B ayrıntısı: binalar, yollar, bitki örtüsü (z14 Web Merkatör karoları;
// tools/geodata/vectors.py). Kamera (ve uçak) çevresinde akışlı yüklenir, kare başına süre bütçesiyle
// kurulur, uzaklaşınca bırakılır.
//
// Binalar  : Overture Maps (OpenStreetMap + Microsoft ML ayak izleri). Her bina ayak izine oturan
//            yönlü kutu (alan korunur); yükseklik OSM'den, yoksa belgelenmiş alan sezgisi. Örnekli
//            (instanced) kutu + kırma çatı; cephe pencereleri gölgelendiricide (doku yok). Örnekler
//            alana göre sıralı: uzaklıkta yalnızca büyük binalar çizilir (mesh.count ile LOD).
//            Yakındaki binalar çarpışma geometrisidir (yönlü kutu testi, karo içi ızgara).
// Yollar   : OSM yol parçaları arazi yüzeyine (fiziğin kanonik yüzeyi) 20 m aralıkla oturtulmuş
//            şeritler; sınıfa göre genişlik (OSM width yok: yaklaşık), birleşimlerde gönye.
//            Derinlik yazmaz (kesişen şeritler eş düzlemli titreme yapmaz), binalardan sonra çizilir.
// Bitki    : ESA WorldCover 2021 ağaç / çalı payı (30 m hücre) -> hücre başına çam ve çalı örnekleri.
//            Örnek sırası karışık: uzaklıkta yoğunluk mesh.count ile düşer (uzamsal olarak düzgün).
import * as THREE from 'three';
import { lonToTileX, latToTileY, tileXToLon, tileYToLat, MSL_Y } from './geo.js';
import { applyHaze } from './worldshade.js';

const Z = 14;
// Yol genişlikleri (m; OSM width etiketi Overture'da çoğunlukla yok: sınıfa göre yaklaşık)
const ROAD_W = { 1: 22, 2: 16, 3: 11, 4: 9, 5: 7.5, 6: 6, 7: 5.5, 8: 5, 9: 4.5, 10: 3.5, 11: 5 };
const ROAD_GROUP = (c, unpaved) => (unpaved || c === 10 ? 2 : c <= 5 ? 0 : 1);   // 0 ana, 1 tali, 2 toprak

function decodeIndex(ix) {
  if (!ix) return null;
  const bin = typeof atob === 'function' ? atob(ix.bits) : Buffer.from(ix.bits, 'base64').toString('binary');
  const bits = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bits[i] = bin.charCodeAt(i);
  return (x, y) => {
    const i = (y - ix.y0) * ix.w + (x - ix.x0);
    if (x < ix.x0 || y < ix.y0 || x >= ix.x0 + ix.w || y >= ix.y0 + ix.h) return false;
    return (bits[i >> 3] >> (i & 7)) & 1;
  };
}
const hash = (a, b) => { let h = (a * 374761393 + b * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };

// ---- Geometriler (birim, paylaşılan) ----------------------------------------------------------
function boxGeometry() {
  // Taban y=0, tepe y=1; x,z ∈ [-0.5, 0.5]. face: 1 çatı, 0 duvar (cephe deseni için)
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.translate(0, 0.5, 0);
  const n = g.attributes.normal, f = new Float32Array(n.count);
  for (let i = 0; i < n.count; i++) f[i] = n.getY(i) > 0.5 ? 1 : 0;
  g.setAttribute('face', new THREE.BufferAttribute(f, 1));
  return g;
}
function hipRoofGeometry() {
  // Kırma çatı: taban dikdörtgen y=0, mahya x boyunca (-0.25..0.25) y=1
  const v = [[-0.5, 0, -0.5], [0.5, 0, -0.5], [0.5, 0, 0.5], [-0.5, 0, 0.5], [-0.25, 1, 0], [0.25, 1, 0]];
  const f = [[0, 4, 5, 1], [2, 5, 4, 3], [1, 5, 2], [3, 4, 0]];
  const pos = [];
  for (const q of f) {
    const tris = q.length === 4 ? [[q[0], q[1], q[2]], [q[0], q[2], q[3]]] : [q];
    for (const t of tris) for (const k of t) pos.push(...v[k]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}
function pineGeometry() {
  // Kızılçam silueti: ince gövde + iki kat yassı tepe (Ege kıyı ormanı), birim yükseklik
  const parts = [];
  // Açık uçlu (taban kapağı yok): ağaç başına ~20 üçgen
  const trunk = new THREE.CylinderGeometry(0.035, 0.05, 0.45, 3, 1, true); trunk.translate(0, 0.225, 0);
  const c1 = new THREE.ConeGeometry(0.42, 0.42, 7, 1, true); c1.translate(0, 0.62, 0);
  const c2 = new THREE.ConeGeometry(0.30, 0.34, 6, 1, true); c2.translate(0, 0.86, 0);
  for (const [g, col] of [[trunk, [0.32, 0.24, 0.17]], [c1, [1, 1, 1]], [c2, [1.08, 1.08, 1.02]]]) {
    const gg = g.index ? g.toNonIndexed() : g;
    const c = new Float32Array(gg.attributes.position.count * 3);
    for (let i = 0; i < c.length; i += 3) { c[i] = col[0]; c[i + 1] = col[1]; c[i + 2] = col[2]; }
    gg.setAttribute('color', new THREE.BufferAttribute(c, 3));
    for (const a of Object.keys(gg.attributes)) if (!['position', 'normal', 'color'].includes(a)) gg.deleteAttribute(a);
    parts.push(gg);
  }
  const pos = [], nor = [], col = [];
  for (const p of parts) { pos.push(...p.attributes.position.array); nor.push(...p.attributes.normal.array); col.push(...p.attributes.color.array); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}
function shrubGeometry() {
  const g = new THREE.OctahedronGeometry(0.5, 0);
  g.scale(1, 0.55, 1); g.translate(0, 0.22, 0);
  return g.index ? g.toNonIndexed() : g;
}

// Bina malzemesi: Lambert + örnek ölçeğinden cephe deseni (katlar ~3 m, pencere sütunları ~3,2 m)
function buildingMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute float face;\nvarying float vFace; varying vec3 vFac; varying vec3 vNl; varying float vDist;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vFace = face; vNl = normal;
      #ifdef USE_INSTANCING
        vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
      #else
        vec3 sc = vec3(1.0);
      #endif
      vFac = position * sc; vFac.y = sc.y - vFac.y;   // y: çatıdan aşağı metre
      vDist = length((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);`);
    sh.fragmentShader = 'varying float vFace; varying vec3 vFac; varying vec3 vNl; varying float vDist;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      if (vFace > 0.5) {
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.80, 0.80, 0.78), 0.45);          // açık renk düz çatı
      } else {
        float near = 1.0 - smoothstep(350.0, 1100.0, vDist);
        if (near > 0.0) {
          float hz = abs(vNl.x) > 0.5 ? vFac.z : vFac.x;
          float fl = mod(vFac.y + 0.6, 3.0), col = mod(hz + 40.0, 3.2);
          float win = step(0.9, fl) * step(fl, 2.1) * step(0.9, col) * step(col, 2.3) * step(1.2, vFac.y);
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.32, 0.36, 0.42), win * near * 0.85);
        }
      }`);
  };
  m.customProgramCacheKey = () => 'geobld1';
  applyHaze(m, 'geobld');
  return m;
}

// Tek yol malzemesi: renk köşe özniteliğinden (ana / tali asfalt / toprak), ruv.z > 0.5 ise kesikli
// beyaz eksen çizgisi (ana yollar). Karo başına tek çizim çağrısı.
function roadMaterial() {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = 'attribute vec3 ruv; varying vec3 vRuv;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRuv = ruv;');
    sh.fragmentShader = 'varying vec3 vRuv;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      {
        float e = abs(vRuv.x - 0.5) * 2.0;
        diffuseColor.rgb *= 0.92 + 0.08 * fract(sin(dot(floor(vRuv.xy * vec2(6.0, 2.0)), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= 1.0 - 0.12 * smoothstep(0.75, 1.0, e);      // kenar
        float dash = step(0.5, vRuv.z) * step(abs(vRuv.x - 0.5), 0.02) * step(fract(vRuv.y / 4.5), 0.45);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.86, 0.82), dash);
      }`);
  };
  m.customProgramCacheKey = () => 'georoad2';
  applyHaze(m, 'georoad2');
  return m;
}
const ROAD_COL = [[0.27, 0.28, 0.30], [0.40, 0.40, 0.38], [0.58, 0.50, 0.38]].map((c) => c.map((v) => Math.pow(v, 2.2)));

export class GeoFeatures {
  /**
   * @param {object} w GeoWorld (frame, terrain, base, man, ltfe, quality)
   * @param {THREE.Group} group
   */
  constructor(w, group) {
    this.w = w; this.group = group;
    const q = w.quality;
    this.R = { bld: q.bldRadius || 2800, road: q.roadRadius || 2400, veg: q.vegRadius || 1600 };
    this.vegDensity = q.vegDensity || 1;
    this.budgetMs = q.featureMs || 3;
    this.detail = 1;
    const man = w.man;
    this.has = { bld: decodeIndex(man.buildings && man.buildings.index), road: decodeIndex(man.roads && man.roads.index) };
    this.vegZ = man.vegetation ? man.vegetation.z : 12;
    this.tiles = new Map();            // key -> tile
    this.vegCache = new Map();         // z12 key -> RGBA (çözülmüş)
    this.fetch = w.opts.fetch || ((u) => fetch(u).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + u); return r.arrayBuffer(); }));
    this.queue = [];
    this.inflight = 0;
    this.stats = { tiles: 0, buildings: 0, drawnBuildings: 0, roadsKm: 0, trees: 0, drawnTrees: 0, buildMs: 0, geomMB: 0 };
    if (group) {
      this.geo = { box: boxGeometry(), roof: hipRoofGeometry(), pine: pineGeometry(), shrub: shrubGeometry() };
      this.mat = {
        bld: buildingMaterial(),
        roof: applyHaze(new THREE.MeshLambertMaterial({ color: 0xffffff }), 'georoof'),
        road: roadMaterial(),
        tree: applyHaze(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }), 'geotree'),
        shrub: applyHaze(new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), 'geoshrub'),
      };
    }
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._p = new THREE.Vector3(); this._s = new THREE.Vector3();
    this._c = new THREE.Color(); this._Y = new THREE.Vector3(0, 1, 0);
  }

  key(x, y) { return x * 1e5 + y; }

  /** Karonun dört köşesinin yerel konumu (çift doğrusal eşleme; z14'te TM eğriliği mm düzeyinde). */
  tileFrame(tx, ty) {
    const f = this.w.frame;
    const c = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([i, j]) => f.toLocal(tileYToLat(ty + j, Z), tileXToLon(tx + i, Z)));
    const lat = tileYToLat(ty + 0.5, Z), lon = tileXToLon(tx + 0.5, Z);
    return { c, conv: f.convergence(lat, lon) * Math.PI / 180, cx: (c[0].x + c[3].x) / 2, cz: (c[0].z + c[3].z) / 2,
      size: Math.hypot(c[3].x - c[0].x, c[3].z - c[0].z) / Math.SQRT2 };
  }
  local(F, u, v, o) {
    const c = F.c;
    o.x = (c[0].x * (1 - u) + c[1].x * u) * (1 - v) + (c[2].x * (1 - u) + c[3].x * u) * v;
    o.z = (c[0].z * (1 - u) + c[1].z * u) * (1 - v) + (c[2].z * (1 - u) + c[3].z * u) * v;
    return o;
  }
  /** Zemin y (MSL_Y dahil), hızlı yol; ince DEM yoksa NaN. */
  ground(tx, ty, u, v, x, z) {
    const s = 256 / (1 << (Z - this.w.terrain.demFine));
    const h = this.w.terrain.mslAtFine((tx + u) * s, (ty + v) * s, x, z);
    return Number.isNaN(h) ? NaN : h + MSL_Y;
  }

  // ---- Akış --------------------------------------------------------------------------------
  update(camera, focus, dt) {
    if (!this.w.terrain) return;
    const c = camera.position, now = performance.now() / 1000;
    const k = this.detail;
    const rMax = Math.max(this.R.bld, this.R.road, this.R.veg) * k;
    // İstenen karolar: kamera çevresi (+ uçak çevresi 1,2 km: çarpışma verisi kameradan bağımsız)
    const want = new Set();
    const addAround = (p, r) => {
      const g = this.w.frame.toGeo(p.x, p.z);
      const tx = lonToTileX(g.lon, Z), ty = latToTileY(g.lat, Z), span = r / 1950 + 1;
      for (let y = Math.floor(ty - span); y <= Math.floor(ty + span); y++) for (let x = Math.floor(tx - span); x <= Math.floor(tx + span); x++) want.add(this.key(x, y));
    };
    if (c.y - MSL_Y < 6000) addAround(c, rMax);
    if (focus) addAround(focus, 1200);
    for (const kk of want) {
      if (this.tiles.has(kk)) continue;
      const tx = Math.floor(kk / 1e5), ty = kk - tx * 1e5;
      const F = this.tileFrame(tx, ty);
      const d = Math.hypot(F.cx - c.x, F.cz - c.z) - F.size * 0.71;
      const dF = focus ? Math.hypot(F.cx - focus.x, F.cz - focus.z) - F.size * 0.71 : 1e9;
      if (d > rMax && dF > 1200) continue;
      const t = { tx, ty, F, state: 'new', bld: null, road: null, veg: null, d, used: now };
      this.tiles.set(kk, t);
      this.queue.push(t);
    }
    // Yükleme (en yakın önce; aynı anda 4 istek)
    this.queue.sort((a, b) => a.d - b.d);
    while (this.inflight < 4 && this.queue.length) this.load(this.queue.shift());
    // İnşa: süre bütçesi
    const t0 = performance.now();
    for (const t of this.tiles.values()) {
      t.d = Math.hypot(t.F.cx - c.x, t.F.cz - c.z) - t.F.size * 0.71;
      if (t.state === 'parsed' && performance.now() - t0 < this.budgetMs) this.buildTile(t);
    }
    this.stats.buildMs = performance.now() - t0;
    // Görünürlük + LOD + bırakma
    let drawnB = 0, drawnT = 0, nT = 0;
    for (const [kk, t] of this.tiles) {
      const keep = want.has(kk) || t.d < rMax * 1.2;
      if (!keep && now - t.used > 4) { this.dropTile(kk, t); continue; }
      if (keep) t.used = now;
      if (t.state !== 'ready') continue;
      nT++;
      if (t.bldMesh) {
        const vis = t.d < this.R.bld * k;
        // Uzaklıkta küçük binalar çizilmez (alan eşiği uzaklığın karesiyle büyür)
        const thr = t.d < 700 ? 0 : 30 * (t.d / 700) * (t.d / 700) / k;
        const n = vis ? countAbove(t.areas, thr) : 0;
        t.bldMesh.count = n; t.bldMesh.visible = n > 0;
        if (t.roofMesh) { const nr = vis ? countAbove(t.roofAreas, thr) : 0; t.roofMesh.count = nr; t.roofMesh.visible = nr > 0; }
        drawnB += n;
      }
      if (t.roadMeshes) for (const m of t.roadMeshes) m.visible = t.d < this.R.road * k;
      if (t.treeMesh || t.shrubMesh) {
        const vis = t.d < this.R.veg * k;
        const f = t.d < 600 ? 1 : Math.max(0.25, 600 / t.d);
        if (t.treeMesh) { t.treeMesh.count = vis ? Math.round(t.nTree * f) : 0; t.treeMesh.visible = t.treeMesh.count > 0; drawnT += t.treeMesh.count; }
        if (t.shrubMesh) { t.shrubMesh.count = vis ? Math.round(t.nShrub * f) : 0; t.shrubMesh.visible = t.shrubMesh.count > 0; }
      }
    }
    this.stats.tiles = nT; this.stats.drawnBuildings = drawnB; this.stats.drawnTrees = drawnT;
  }

  async load(t) {
    this.inflight++;
    t.state = 'loading';
    const base = this.w.base, { tx, ty } = t;
    try {
      const jobs = [];
      if (this.has.bld && this.has.bld(tx, ty)) jobs.push(this.fetch(base + `bld/${Z}/${tx}/${ty}.bin`).then((b) => { t.bldBuf = b; }));
      if (this.has.road && this.has.road(tx, ty)) jobs.push(this.fetch(base + `road/${Z}/${tx}/${ty}.bin`).then((b) => { t.roadBuf = b; }));
      const s = Z - this.vegZ, vx = tx >> s, vy = ty >> s;
      jobs.push(this.vegTile(vx, vy).then((v) => { t.vegData = v; }));
      await Promise.all(jobs);
      if (t.state === 'dropped') return;
      t.state = 'parsed';
    } catch (e) {
      console.warn('feature tile failed', tx, ty, e && e.message);
      t.state = 'failed';
    } finally { this.inflight--; }
  }
  /** WorldCover payları (z12, RGBA çözülmüş); bölgede yoksa null. */
  vegTile(x, y) {
    const k = x * 1e5 + y;
    if (this.vegCache.has(k)) return this.vegCache.get(k);
    const man = this.w.man.vegetation;
    const r = this.w.man.dem.levels[String(this.vegZ)];
    let p;
    if (!man || !r || x < r.x0 || x > r.x1 || y < r.y0 || y > r.y1 || !this.vegExists(x, y)) p = Promise.resolve(null);
    else p = this.fetch(this.w.base + `veg/${this.vegZ}/${x}/${y}.png`).then((b) => this.w.terrain.dem.decode(b)).catch(() => null);
    this.vegCache.set(k, p);
    if (this.vegCache.size > 24) this.vegCache.delete(this.vegCache.keys().next().value);
    return p;
  }
  vegExists(x, y) {
    const v = this.w.man.vegetation;
    if (!v.index) return true;
    if (!this._vegHas) this._vegHas = decodeIndex(v.index);
    return this._vegHas(x, y);
  }

  buildTile(t) {
    const { tx, ty } = t;
    // İnce DEM (zemin oturtma) hazır değilse bekle: bina/yol yanlış kotta doğup sonra sıçramasın
    const s = Z - this.w.terrain.demFine;
    if (!this.w.terrain.fineReady(tx >> s, ty >> s)) return;
    if (this.group) {
      if (t.bldBuf) this.buildBuildings(t);
      if (t.roadBuf) this.buildRoads(t);
      if (t.vegData) this.buildVegetation(t);
    } else if (t.bldBuf) this.buildBuildings(t);       // başsız (test): yalnızca çarpışma
    t.bldBuf = t.roadBuf = null; t.vegData = null;
    t.state = 'ready';
  }

  buildBuildings(t) {
    const dv = view(t.bldBuf), n = dv.getUint32(0, true);
    const F = t.F, conv = F.conv, o = { x: 0, z: 0 };
    const recs = [];
    for (let i = 0, p = 4; i < n && p + 12 <= dv.byteLength; i++, p += 12) {
      const u = dv.getUint16(p, true) / 65535, v = dv.getUint16(p + 2, true) / 65535;
      const w = dv.getUint16(p + 4, true) * 0.05, d = dv.getUint16(p + 6, true) * 0.05;
      const az = dv.getUint16(p + 8, true) / 65535 * Math.PI, H = dv.getUint8(p + 10) * 0.25, fl = dv.getUint8(p + 11);
      this.local(F, u, v, o);
      const g = this.ground(t.tx, t.ty, u, v, o.x, o.z);
      if (Number.isNaN(g)) continue;
      // Meydan kaplaması üzerinde (ML ayak izi hatası) bina kurulmaz
      if (this.w.ltfe && this.w.ltfe.pavedDist(o.x, o.z) < 2) continue;
      recs.push({ x: o.x, z: o.z, g, w, d, th: Math.PI / 2 - (az - conv), H, kind: fl & 15, pitched: !!(fl & 16), col: (fl >> 5) & 3, area: w * d });
    }
    recs.sort((a, b) => b.area - a.area);
    t.areas = new Float32Array(recs.map((r) => r.area));
    // Çarpışma: yönlü kutular + 64 m ızgara
    const col = { n: recs.length, x: new Float32Array(recs.length), z: new Float32Array(recs.length), c: new Float32Array(recs.length), s: new Float32Array(recs.length),
      hw: new Float32Array(recs.length), hd: new Float32Array(recs.length), y0: new Float32Array(recs.length), y1: new Float32Array(recs.length), grid: new Map() };
    recs.forEach((r, i) => {
      const sink = 1 + Math.min(6, 0.22 * Math.max(r.w, r.d));
      col.x[i] = r.x; col.z[i] = r.z; col.c[i] = Math.cos(r.th); col.s[i] = Math.sin(r.th);
      col.hw[i] = r.w / 2; col.hd[i] = r.d / 2; col.y0[i] = r.g - sink; col.y1[i] = r.g + r.H + (r.pitched ? Math.min(3, r.w * 0.3) : 0);
      const R = Math.hypot(r.w, r.d) / 2;
      for (let gx = Math.floor((r.x - R) / 64); gx <= Math.floor((r.x + R) / 64); gx++) for (let gz = Math.floor((r.z - R) / 64); gz <= Math.floor((r.z + R) / 64); gz++) {
        const k = gx * 100003 + gz; let a = col.grid.get(k); if (!a) col.grid.set(k, a = []); a.push(i);
      }
      r.sink = sink;
    });
    t.col = col;
    this.stats.buildings += recs.length;
    if (!this.group || !recs.length) return;
    const mesh = new THREE.InstancedMesh(this.geo.box, this.mat.bld, recs.length);
    const roofs = recs.filter((r) => r.pitched);
    const roofMesh = roofs.length ? new THREE.InstancedMesh(this.geo.roof, this.mat.roof, roofs.length) : null;
    const m4 = this._m4, q = this._q, P = this._p, S = this._s, C = this._c;
    // Ege kıyısı paleti (beyaz/krem ağırlıklı); sera, sanayi ayrı
    const pal = [[0.93, 0.93, 0.91], [0.91, 0.88, 0.80], [0.88, 0.80, 0.68], [0.82, 0.82, 0.80]];
    recs.forEach((r, i) => {
      q.setFromAxisAngle(this._Y, r.th);
      P.set(r.x, r.g - r.sink, r.z); S.set(r.w, r.H + r.sink, r.d);
      mesh.setMatrixAt(i, m4.compose(P, q, S));
      const p = r.kind === 5 ? [0.86, 0.90, 0.88] : r.kind === 4 ? [0.72, 0.75, 0.78] : pal[r.col];
      mesh.setColorAt(i, C.setRGB(p[0], p[1], p[2], THREE.SRGBColorSpace));
    });
    t.roofAreas = new Float32Array(roofs.map((r) => r.area));
    if (roofMesh) roofs.forEach((r, i) => {
      q.setFromAxisAngle(this._Y, r.th);
      P.set(r.x, r.g + r.H, r.z); S.set(r.w * 1.04, Math.min(3, r.w * 0.3), r.d * 1.04);
      roofMesh.setMatrixAt(i, m4.compose(P, q, S));
      const v = 0.85 + 0.3 * hash(i, r.col);
      roofMesh.setColorAt(i, C.setRGB(0.62 * v, 0.31 * v, 0.20 * v, THREE.SRGBColorSpace));
    });
    for (const m of [mesh, roofMesh]) {
      if (!m) continue;
      m.frustumCulled = true; m.castShadow = false; m.receiveShadow = true; m.matrixAutoUpdate = false;
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere();
      // eğrilik payı: uzak kümeler sınır küresi dışında kalıp yanlış kırpılmasın
      m.boundingSphere.radius += 50;
      this.group.add(m);
    }
    t.bldMesh = mesh; t.roofMesh = roofMesh;
    this.stats.geomMB += (recs.length + roofs.length) * 80 / 1e6;
  }

  buildRoads(t) {
    const dv = view(t.roadBuf), n = dv.getUint16(0, true);
    const F = t.F, o = { x: 0, z: 0 };
    const g = { p: [], uv: [], c: [] };
    let p = 2, km = 0;
    for (let k = 0; k < n; k++) {
      const cls = dv.getUint8(p), fl = dv.getUint8(p + 1), nv = dv.getUint16(p + 2, true); p += 4;
      const pts = [];
      for (let i = 0; i < nv; i++, p += 4) pts.push([dv.getUint16(p, true) / 65535, dv.getUint16(p + 2, true) / 65535]);
      // 20 m'den uzun parçalar bölünür: şerit arazi yüzeyini izler
      const L = [];
      for (let i = 0; i < pts.length; i++) {
        const [u, v] = pts[i];
        this.local(F, u, v, o);
        if (i > 0) {
          const a = L[L.length - 1], dd = Math.hypot(o.x - a.x, o.z - a.z), m = Math.ceil(dd / 20);
          const [u0, v0] = pts[i - 1];
          for (let s = 1; s < m; s++) { const tt = s / m, q = this.local(F, u0 + (u - u0) * tt, v0 + (v - v0) * tt, { x: 0, z: 0 }); L.push({ x: q.x, z: q.z, u: u0 + (u - u0) * tt, v: v0 + (v - v0) * tt }); }
        }
        L.push({ x: o.x, z: o.z, u, v });
      }
      for (const q of L) { q.y = this.ground(t.tx, t.ty, q.u, q.v, q.x, q.z); }
      if (L.some((q) => Number.isNaN(q.y))) continue;
      if (fl & 1) { const y0 = L[0].y, y1 = L[L.length - 1].y; L.forEach((q, i) => { q.y = Math.max(q.y, y0 + (y1 - y0) * i / Math.max(1, L.length - 1)); }); }
      // Pist/taksi yolu üstünde yol çizilmez (meydan içi servis yolları kaplamayı kesmez)
      const grp = ROAD_GROUP(cls, fl & 2), col = ROAD_COL[grp], dash = grp === 0 && cls >= 3 ? 1 : 0, hw = (ROAD_W[cls] || 5) / 2;
      let along = 0;
      for (let i = 0; i < L.length; i++) {
        const a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)];
        let dx = b.x - a.x, dz = b.z - a.z; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        L[i].nx = -dz * hw; L[i].nz = dx * hw;
        if (i > 0) along += Math.hypot(L[i].x - L[i - 1].x, L[i].z - L[i - 1].z);
        L[i].s = along;
      }
      km += along / 1000;
      for (let i = 0; i + 1 < L.length; i++) {
        const A = L[i], B = L[i + 1];
        if (this.w.ltfe && (this.w.ltfe.inRunway(A.x, A.z, 3) || this.w.ltfe.surfaceAt(A.x, A.z))) continue;
        const yA = A.y + 0.3, yB = B.y + 0.3;
        const quad = [[A.x + A.nx, yA, A.z + A.nz, 0, A.s], [A.x - A.nx, yA, A.z - A.nz, 1, A.s], [B.x - B.nx, yB, B.z - B.nz, 1, B.s], [B.x + B.nx, yB, B.z + B.nz, 0, B.s]];
        for (const k2 of [0, 1, 2, 0, 2, 3]) { const v = quad[k2]; g.p.push(v[0], v[1], v[2]); g.uv.push(v[3], v[4] / (hw * 2) * 2, dash); g.c.push(col[0], col[1], col[2]); }
      }
    }
    t.roadMeshes = [];
    if (g.p.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('ruv', new THREE.Float32BufferAttribute(g.uv, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(g.c, 3));
      const nn = new Float32Array(g.p.length); for (let k = 1; k < nn.length; k += 3) nn[k] = 1;
      geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
      geo.computeBoundingSphere(); geo.boundingSphere.radius += 50;
      const m = new THREE.Mesh(geo, this.mat.road);
      m.renderOrder = 5; m.receiveShadow = true; m.matrixAutoUpdate = false;
      this.group.add(m); t.roadMeshes.push(m);
      this.stats.geomMB += g.p.length * 4 * 4 / 1e6;
    }
    this.stats.roadsKm += km; t.roadKm = km;
  }

  buildVegetation(t) {
    const V = t.vegData, s = Z - this.vegZ, F = t.F, o = { x: 0, z: 0 };
    const ox = (t.tx - ((t.tx >> s) << s)) * (256 >> s), oy = (t.ty - ((t.ty >> s) << s)) * (256 >> s), cells = 256 >> s;
    const trees = [], shrubs = [];
    const Dt = 5 * this.vegDensity, Ds = 4 * this.vegDensity;
    for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) {
      const pi = ((oy + j) * 256 + (ox + i)) * 4;
      const ft = V[pi] / 255, fs = V[pi + 1] / 255;
      if (ft < 0.05 && fs < 0.05) continue;
      const nt = Math.floor(ft * Dt + hash(t.tx * 4096 + i, t.ty * 4096 + j)), ns = Math.floor(fs * Ds + hash(t.ty * 4096 + j, t.tx * 4096 + i + 7));
      for (let k = 0; k < nt + ns; k++) {
        const u = (i + hash(i * 31 + k, j * 17 + t.tx)) / cells, v = (j + hash(j * 29 + k, i * 13 + t.ty)) / cells;
        this.local(F, u, v, o);
        if (this.w.ltfe && this.w.ltfe.pavedDist(o.x, o.z) < 40) continue;
        const g = this.ground(t.tx, t.ty, u, v, o.x, o.z);
        if (Number.isNaN(g) || g - MSL_Y < 0.6) continue;               // deniz/kıyı çizgisi
        // Bina içinde/üstünde ağaç olmaz (meydan binaları + bu ve komşu karolardaki yüklü binalar)
        if (this.w.hitsBuilding(o.x, g + 2, o.z, 1.5)) continue;
        (k < nt ? trees : shrubs).push({ x: o.x, z: o.z, g, r: hash(k * 7 + i, j * 3 + k) });
      }
    }
    // Karışık sıra: önek alt kümeleri uzamsal olarak düzgün (uzaklık LOD'u mesh.count ile)
    const shuffle = (a) => a.sort((p, q) => p.r - q.r);
    shuffle(trees); shuffle(shrubs);
    const m4 = this._m4, q = this._q, P = this._p, S = this._s, C = this._c;
    if (trees.length) {
      const m = new THREE.InstancedMesh(this.geo.pine, this.mat.tree, trees.length);
      trees.forEach((tr, i) => {
        const h = 7 + tr.r * 9, w = h * (0.75 + 0.3 * hash(i, 3));
        q.setFromAxisAngle(this._Y, tr.r * 6.283);
        m.setMatrixAt(i, m4.compose(P.set(tr.x, tr.g - 0.3, tr.z), q, S.set(w, h, w)));
        const v = 0.8 + 0.35 * hash(i, 11);
        m.setColorAt(i, C.setRGB(0.20 * v, 0.30 * v, 0.14 * v, THREE.SRGBColorSpace));
      });
      t.treeMesh = m; t.nTree = trees.length;
    }
    if (shrubs.length) {
      const m = new THREE.InstancedMesh(this.geo.shrub, this.mat.shrub, shrubs.length);
      shrubs.forEach((sh, i) => {
        const r = 1.2 + sh.r * 2.4;
        q.setFromAxisAngle(this._Y, sh.r * 6.283);
        m.setMatrixAt(i, m4.compose(P.set(sh.x, sh.g - 0.15, sh.z), q, S.set(r * 1.3, r, r)));
        const v = 0.8 + 0.4 * hash(i, 5);
        m.setColorAt(i, C.setRGB(0.27 * v, 0.31 * v, 0.17 * v, THREE.SRGBColorSpace));
      });
      t.shrubMesh = m; t.nShrub = shrubs.length;
    }
    for (const m of [t.treeMesh, t.shrubMesh]) {
      if (!m) continue;
      m.castShadow = false; m.receiveShadow = false; m.matrixAutoUpdate = false;
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
      m.computeBoundingSphere(); m.boundingSphere.radius += 50;
      this.group.add(m);
    }
    this.stats.trees += trees.length;
    this.stats.geomMB += (trees.length + shrubs.length) * 80 / 1e6;
  }

  dropTile(k, t) {
    t.state = 'dropped';
    for (const m of [t.bldMesh, t.roofMesh, t.treeMesh, t.shrubMesh, ...(t.roadMeshes || [])]) {
      if (!m) continue;
      this.group.remove(m);
      if (m.isInstancedMesh) { m.dispose(); this.stats.geomMB -= m.count * 80 / 1e6; } else { this.stats.geomMB -= m.geometry.attributes.position.count * 12 / 1e6; m.geometry.dispose(); }
    }
    if (t.col) this.stats.buildings -= t.col.n;
    if (t.nTree) this.stats.trees -= t.nTree;
    if (t.roadKm) this.stats.roadsKm -= t.roadKm;
    this.tiles.delete(k);
  }

  // ---- Çarpışma ------------------------------------------------------------------------------
  /** Yüklü binalarla küre (r) çarpışması (yönlü kutu). */
  hits(x, y, z, r) {
    if (y - MSL_Y > 400) return false;                  // en yüksek yapının çok üstünde: hızlı çıkış
    const g = this.w.frame.toGeo(x, z, this._g || (this._g = { lat: 0, lon: 0 }));
    const fx = lonToTileX(g.lon, Z), fy = latToTileY(g.lat, Z), tx = Math.floor(fx), ty = Math.floor(fy);
    const ck = Math.floor(x / 64) * 100003 + Math.floor(z / 64);
    // Karo kenarına yakınsa komşu karolar da (bina merkezi komşu karoda olabilir)
    const ex = fx - tx < 0.04 ? -1 : fx - tx > 0.96 ? 1 : 0, ey = fy - ty < 0.04 ? -1 : fy - ty > 0.96 ? 1 : 0;
    for (let dy = Math.min(0, ey); dy <= Math.max(0, ey); dy++) for (let dx0 = Math.min(0, ex); dx0 <= Math.max(0, ex); dx0++) {
      const t = this.tiles.get(this.key(tx + dx0, ty + dy));
      if (!t || !t.col) continue;
      const C = t.col, cell = C.grid.get(ck);
      if (!cell) continue;
      for (const i of cell) {
        if (y - r > C.y1[i] || y + r < C.y0[i]) continue;
        const dx = x - C.x[i], dz = z - C.z[i];
        // kutu yerel ekseni: setFromAxisAngle(Y, th): yerel x -> (cos, 0, -sin)
        const lx = dx * C.c[i] - dz * C.s[i], lz = dx * C.s[i] + dz * C.c[i];
        if (Math.abs(lx) <= C.hw[i] + r && Math.abs(lz) <= C.hd[i] + r) return true;
      }
    }
    return false;
  }

  /** Başlangıç: verilen konum çevresindeki karoları yükleyip kurar (yükleme ekranında). */
  async preload(pos, ms = 6000) {
    const cam = { position: pos };
    const t0 = performance.now(), keep = this.budgetMs;
    this.budgetMs = 40;
    while (performance.now() - t0 < ms) {
      this.update(cam, pos, 0);
      let pending = 0;
      for (const t of this.tiles.values()) if (t.state !== 'ready' && t.state !== 'failed') pending++;
      if (!pending && this.tiles.size) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    this.budgetMs = keep;
  }
  segmentHit(p0, p1) {
    const L = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z), n = Math.max(1, Math.ceil(L / 4));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      if (this.hits(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t, p0.z + (p1.z - p0.z) * t, 1)) return t;
    }
    return -1;
  }

  dispose() {
    for (const [k, t] of this.tiles) this.dropTile(k, t);
    if (this.geo) for (const g of Object.values(this.geo)) g.dispose();
    if (this.mat) for (const m of Object.values(this.mat)) [].concat(m).forEach((x) => x.dispose());
  }
}

/** ArrayBuffer (tarayıcı) ya da Uint8Array/Buffer (Node testleri) üzerinde DataView. */
function view(b) { return b instanceof ArrayBuffer ? new DataView(b) : new DataView(b.buffer, b.byteOffset, b.byteLength); }

function countAbove(sortedDesc, thr) {
  if (!sortedDesc || !sortedDesc.length) return 0;
  if (thr <= 0) return sortedDesc.length;
  let lo = 0, hi = sortedDesc.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sortedDesc[m] >= thr) lo = m + 1; else hi = m; }
  return lo;
}
