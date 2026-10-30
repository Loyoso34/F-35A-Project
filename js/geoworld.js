// Gerçek dünya bölgesi (Bodrum): World'ün arayüzünü uygular, gökyüzü/ışık/bulut/çarpışma kodunu
// World'den devralır; arazi akışlı gerçek veridir (geoterrain.js), havaalanı LTFE'dir.
//
// Fizik çerçevesi: yerel Transvers Merkatör (geo.js), kök = LTFE ARP; y = MSL + MSL_Y. Böylece
// physics.js, cameras.js, weapons.js ve HUD değişmeden çalışır (irtifa = y − WATER_LEVEL = MSL).
import * as THREE from 'three';
import { World, QUALITY_PRESETS } from './world.js';
import { LocalFrame, GeoidGrid, MSL_Y } from './geo.js';
import { GeoTerrain, CURVE_K } from './geoterrain.js';
import { BODRUM, LTFE } from './georegion.js';
import { buildRunway, buildLightPoints, trueHeadingFromEnds } from './runway.js';
import { makePavementTexture, makeTerrainDetailTexture, makeWaterNormalTexture } from './textures.js';
import { HAZE_UNIFORMS, hazeAll } from './worldshade.js';
import { clamp, smoothstep } from './noise.js';

const FT = 0.3048;
const DEG = Math.PI / 180;

// Kalite ön ayarına eklenen gerçek dünya değerleri. Performance / Balanced / Ultra = low / medium / high.
//   drawDistance: pus mesafesi (görüş), far: kamera uzak düzlemi, lodFactor: düğüm bölme eşiği
//   (mesafe < boyut × lodFactor), textureBudget: GPU'daki görüntü karosu sayısı (256² RGBA ≈ 0,35 MB
//   mip dahil), nodeBudget: inşa edilmiş düğüm üst sınırı, buildMs: karede düğüm inşa süresi.
export const GEO_QUALITY = {
  low: { drawDistance: 70000, far: 300000, lodFactor: 1.9, textureBudget: 120, nodeBudget: 220, buildMs: 2.5, demBudget: 40 },
  medium: { drawDistance: 100000, far: 420000, lodFactor: 2.5, textureBudget: 180, nodeBudget: 320, buildMs: 3.5, demBudget: 64 },
  high: { drawDistance: 140000, far: 480000, lodFactor: 3.3, textureBudget: 300, nodeBudget: 460, buildMs: 5.0, demBudget: 96 },
};

/** Bodrum kalkış noktalarının statik tanımı (hangar listesi dünya kurulmadan da gösterilir). */
export function bodrumSpawnInfo() {
  return BODRUM.spawns.map((s) => {
    const rw = LTFE.runways[s.runway], e = rw.ends[s.end];
    const ident = e.num + e.suffix;
    return { id: s.id, region: 'bodrum', airport: s.airport, name: s.name, kindLabel: s.kindLabel, runway: ident,
      sub: `${s.kindLabel} · Runway ${ident} · ${rw.lengthM} m · Elevation ${LTFE.elevFt} ft` };
  });
}

export class GeoWorld extends World {
  static get STAGES() { return ['sky', 'lights', 'geodata', 'ltfe', 'ocean', 'clouds', 'collision']; }

  /**
   * opts.base: bölge veri kökü (varsayılan ./geo/bodrum/); opts.fetch / decodeRGBA / fetchJSON /
   * clock: Node testleri için.
   */
  constructor(scene, renderer, qualityKey, opts = {}) {
    super(scene, renderer, qualityKey, { defer: true });
    this.opts = opts;
    this.region = BODRUM;
    this.quality = Object.assign({}, QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium, GEO_QUALITY[qualityKey] || GEO_QUALITY.medium);
    this.base = opts.base || BODRUM.base;
    this.halfSize = 125000;          // uçuş alanı ±125 km (veri ±150 km)
    this.buildingBoxes = [];         // doğrulanmış yapı yüksekliği yok: çarpışma kutusu yok
    this.townBoxes = [];
    this.cloudSpread = 150000;
    this.cloudBase = 1500;
  }

  get regionId() { return 'bodrum'; }
  /** Hangar arka planı: meydanın üzerinde geniş yörünge (15 m'lik görüntü yakından bulanık kalır) */
  get selectView() { return { r: 1250, h: 360, dx: 0, dz: 150 }; }
  get cameraFar() { return this.quality.far; }
  get spawns() { return this._spawns || (this._spawns = bodrumSpawnInfo()); }
  get airportById() { return this._apById; }

  async loadManifest() {
    const url = this.base + 'manifest.json';
    const man = this.opts.fetchJSON ? await this.opts.fetchJSON(url) : await (await fetch(url)).json();
    this.man = man;
    this.frame = new LocalFrame(man.reference.lat, man.reference.lon);
    this.geoid = new GeoidGrid(man.geoid);
    this.magVar = man.magnetic ? man.magnetic.declinationDeg : 0;
    // Güneş: birincil sahnenin çekim anındaki konumu (görüntüdeki gölgelerle tutarlı ışık)
    const az = man.sun.azimuthDeg * DEG, el = man.sun.elevationDeg * DEG;
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    this.prepareAirport();
  }

  async build(report, pause, sliceMs) {
    report('sky', 0);
    await this.loadManifest();
    return super.build(report, pause, sliceMs);
  }

  buildPlan() {
    return [
      { id: 'sky', run: () => { this.buildSky(); HAZE_UNIFORMS.hzCurv.value = CURVE_K; } },
      { id: 'lights', run: () => this.buildLights() },
      { id: 'geodata', run: (p) => this.buildGeoTerrain(p) },
      { id: 'ltfe', run: () => this.buildAirport() },
      { id: 'ocean', run: () => this.buildOcean() },
      { id: 'clouds', run: () => this.buildClouds() },
      { id: 'collision', run: () => { this.buildCollisionGrid(); hazeAll(this.group); } },
    ];
  }

  // ---- Havaalanı geometrisi (yerel çerçevede) ----------------------------------------------------
  prepareAirport() {
    const f = this.frame, a = LTFE;
    const arp = f.toLocal(a.arp.lat, a.arp.lon);
    a.x = arp.x; a.z = arp.z;
    for (const r of a.runways) {
      const A = f.toLocal(r.ends[0].lat, r.ends[0].lon), B = f.toLocal(r.ends[1].lat, r.ends[1].lon);
      const dx = B.x - A.x, dz = B.z - A.z, L = Math.hypot(dx, dz);
      r.A = A; r.B = B; r.len = L; r.ux = dx / L; r.uz = dz / L;
      r.cx = (A.x + B.x) / 2; r.cz = (A.z + B.z) / 2;
      r.eA = r.ends[0].elevFt * FT; r.eB = r.ends[1].elevFt * FT;
      r.hdg = trueHeadingFromEnds(A.x, A.z, B.x, B.z);      // ızgara yönü (merkez meridyende = gerçek)
    }
    // Meydan çerçevesi: ARP kökenli, ilk pist ekseni boyunca
    const r0 = a.runways[0];
    a.ux = r0.ux; a.uz = r0.uz;
    // Kuzey/güney pistin meydan çerçevesindeki enine konumu (v: pilotun sağı = güney-güneybatı)
    for (const r of a.runways) r.vA = (r.cx - a.x) * -a.uz + (r.cz - a.z) * a.ux;
    a.rwN = a.runways.reduce((p, r) => (r.vA < p.vA ? r : p));
    a.rwS = a.runways.reduce((p, r) => (r.vA > p.vA ? r : p));
    this._apById = { ltfe: { id: 'ltfe', x: a.x, z: a.z, elev: MSL_Y + a.elevFt * FT, name: a.name } };
  }

  /** Pist yereli: u eksen boyunca (merkezden), v pilotun sağı. */
  rwLocal(r, x, z, o) {
    const dx = x - r.cx, dz = z - r.cz;
    o.u = dx * r.ux + dz * r.uz; o.v = -dx * r.uz + dz * r.ux;
    return o;
  }
  /** Pist eksenindeki kot profili (MSL): eşikler arası doğrusal, pad'lere uzatılır. */
  rwProfile(r, u) { return r.eA + (r.eB - r.eA) * (u + r.len / 2) / r.len; }

  /**
   * Havaalanı düzleştirmesi (MSL): pistlerin üzerinde tam profil; pistler arası ve çevresi
   * profillerin doğrusal birleşimi (DEM gürültüsü yok); meydan kutusunun dışında ham araziye
   * yumuşak geçiş. Fizik ve arazi örgüsü AYNI işlevi kullanır.
   */
  conform(x, z, h) {
    const a = LTFE, F = a.flat;
    const dx = x - a.x, dz = z - a.z;
    const u = dx * a.ux + dz * a.uz, v = -dx * a.uz + dz * a.ux;
    const ou = Math.max(F.u0 - u, 0, u - F.u1), ov = Math.max(F.v0 - v, 0, v - F.v1);
    const out = Math.hypot(ou, ov);
    if (out >= F.fade) return h;
    const N = a.rwN, S = a.rwS, o = this._rl || (this._rl = { u: 0, v: 0 });
    this.rwLocal(N, x, z, o); const hN = this.rwProfile(N, clamp(o.u, -N.len / 2 - 120, N.len / 2 + 120));
    this.rwLocal(S, x, z, o); const hS = this.rwProfile(S, clamp(o.u, -S.len / 2 - 120, S.len / 2 + 120));
    // Pist kenarı + 10 m içinde saf profil, aradaki şeritte doğrusal
    const e0 = N.vA + 32.5, e1 = S.vA - 32.5;
    const t = clamp((v - e0) / (e1 - e0), 0, 1);
    const hA = hN + (hS - hN) * t;
    const w = 1 - smoothstep(0, F.fade, out);
    return h + (hA - h) * w;
  }

  // ---- Arazi -------------------------------------------------------------------------------
  async buildGeoTerrain(progress) {
    const q = this.quality;
    let detail = null, waterN = null;
    if (this.renderer) {
      detail = this.track(makeTerrainDetailTexture(512)); detail.anisotropy = q.anisotropy;
      waterN = this.track(makeWaterNormalTexture(256));
    }
    const tg = new THREE.Group(); tg.name = 'geo-terrain';
    this.group.add(tg);
    this.terrain = new GeoTerrain({
      frame: this.frame, manifest: this.man, base: this.base, group: this.renderer ? tg : null,
      segments: 32, lodFactor: q.lodFactor, anisotropy: q.anisotropy, textureBudget: q.textureBudget,
      nodeBudget: q.nodeBudget, buildMs: q.buildMs, demBudget: q.demBudget, detailTex: detail, waterNormalTex: waterN,
      conform: (x, z, h) => this.conform(x, z, h),
      fetch: this.opts.fetch, decodeRGBA: this.opts.decodeRGBA, clock: this.opts.clock,
    });
    await this.terrain.loadCoarse((f) => progress && progress(f * 0.3));
    // Havaalanı ve yaklaşma koridorları (±9 km): uçuş başlamadan ince DEM hazır
    await this.terrain.ensureArea(LTFE.x, LTFE.z, 9000, (f) => progress && progress(0.3 + f * 0.5));
    if (this.renderer) await this.terrain.prefetchImagery(LTFE.x, LTFE.z, 6000, (f) => progress && progress(0.8 + f * 0.2));
  }

  heightAt(x, z) { return this.terrain.mslAt(x, z) + MSL_Y; }

  surfaceTypeAt(x, z) {
    const a = LTFE, o = this._sl || (this._sl = { u: 0, v: 0 });
    for (const r of a.runways) {
      this.rwLocal(r, x, z, o);
      const padA = r.ends[0].pad, padB = r.ends[1].pad;
      if (Math.abs(o.v) <= r.width / 2 + 0.5 && o.u >= -r.len / 2 - padA && o.u <= r.len / 2 + padB) return 'runway';
    }
    const dx = x - a.x, dz = z - a.z;
    const u = dx * a.ux + dz * a.uz, v = -dx * a.uz + dz * a.ux;
    const P = a.apron;
    if (u >= P.u0 && u <= P.u1 && v >= P.v0 && v <= P.v1) return 'apron';
    const F = a.flat;
    if (!(u >= F.u0 && u <= F.u1 && v >= F.v0 && v <= F.v1) && this.terrain.waterAt(x, z) >= 0.5) return 'water';
    return 'grass';
  }

  spawnPose(id) {
    const s = BODRUM.spawns.find((p) => p.id === id) || BODRUM.spawns[0];
    const r = LTFE.runways[s.runway];
    const T = s.end === 0 ? r.A : r.B, sg = s.end === 0 ? 1 : -1;
    const x = T.x + r.ux * sg * 100, z = T.z + r.uz * sg * 100;
    const hdg = s.end === 0 ? r.hdg : (r.hdg + 180) % 360;
    return { x, z, hdg, id: s.id };
  }

  /** Coğrafi bilgi (HUD/panel): enlem/boylam, MSL/elipsoit/AGL yükseklikleri, gerçek ve manyetik yön. */
  geoInfo(pos, gridHdg, out) {
    const o = out || {};
    const g = this.frame.toGeo(pos.x, pos.z, this._gi || (this._gi = { lat: 0, lon: 0 }));
    o.lat = g.lat; o.lon = g.lon;
    o.hMsl = pos.y - MSL_Y;
    o.hEll = this.geoid.ellipsoidal(o.hMsl, g.lat, g.lon);
    o.geoidN = o.hEll - o.hMsl;
    o.terrainMsl = this.terrain.mslAt(pos.x, pos.z);
    o.hAgl = o.hMsl - o.terrainMsl;
    o.convergence = this.frame.convergence(g.lat, g.lon);
    o.hdgTrue = (((gridHdg + o.convergence) % 360) + 360) % 360;
    o.hdgMag = (((o.hdgTrue - this.magVar) % 360) + 360) % 360;
    return o;
  }

  // ---- Havaalanı çizimi ----------------------------------------------------------------------
  buildAirport() {
    const q = this.quality;
    const pave = this.track(makePavementTexture(512, { base: 92 }));
    pave.anisotropy = q.anisotropy;
    const lights = [];
    this.runwayGroups = [];
    for (const r of LTFE.runways) {
      const rw = buildRunway({
        length: r.len, width: r.width, standard: 'ICAO', tdzPattern: 'coded', centerlineW: 0.9,
        // Yaklaşma ışık sistemi ve PAPI doğrulanmış veri olmadan kurulmaz (bkz. georegion.js)
        ends: r.ends.map((e) => ({ text: e.num, suffix: e.suffix, pad: e.pad, approach: false, papi: false })),
        pavementMap: pave, shadows: q.shadows,
      });
      const g = rw.group;
      // Yerleşim: merkez, eksen yönü (Y), boyuna eğim (Z) — 'YXZ' sırası: önce eğim, sonra yön
      g.position.set(r.cx, MSL_Y + this.rwProfile(r, 0), r.cz);
      g.rotation.set(0, Math.atan2(-r.uz, r.ux), Math.atan2(r.eB - r.eA, r.len), 'YXZ');
      rw.disposables.forEach((d) => this.track(d));
      this.group.add(g);
      g.updateMatrixWorld(true);
      // Işıklar pist yerelinde: grubun dönüşüyle aynı çerçevede
      const pts = buildLightPoints(rw.lights);
      g.add(pts);
      this.track(pts.geometry); this.track(pts.material);
      lights.push(pts);
      this.runwayGroups.push(g);
    }
    this.runwayLightSets = lights;
  }

  /** Bölge dışını örten deniz halkası (uzakta pus rengine karışır; ufuk çizgisi doğru batar). */
  buildOcean() {
    // İç kenar: veri sınırının ~4 km İÇİ (arazinin sınır dışı köşeleri −40 m'ye batar; o eğim halkanın
    // altında kalır). Halka deniz seviyesinin 0,6 m altında: örtüştüğü yerde arazi denizi üstte kalır.
    const B0 = this.man.bounds.outer, f = this.frame, inset = 0.04;
    const B = [B0[0] + inset / Math.cos(37.3 * DEG), B0[1] + inset, B0[2] - inset / Math.cos(37.3 * DEG), B0[3] - inset];
    const inner = [];
    const nS = 32;
    const edge = (lo0, la0, lo1, la1) => { for (let k = 0; k < nS; k++) { const t = k / nS; inner.push(f.toLocal(la0 + (la1 - la0) * t, lo0 + (lo1 - lo0) * t)); } };
    edge(B[0], B[3], B[2], B[3]); edge(B[2], B[3], B[2], B[1]); edge(B[2], B[1], B[0], B[1]); edge(B[0], B[1], B[0], B[3]);
    const R = 460000, rings = 14, n = inner.length;
    const pos = [], idx = [];
    for (let k = 0; k <= rings; k++) {
      const t = Math.pow(k / rings, 1.6);
      for (const p of inner) {
        const a = Math.atan2(p.z, p.x), r0 = Math.hypot(p.x, p.z);
        const r = r0 + (R - r0) * t;
        pos.push(Math.cos(a) * r, MSL_Y - 0.6, Math.sin(a) * r);
      }
    }
    for (let k = 0; k < rings; k++) for (let i = 0; i < n; i++) {
      const a = k * n + i, b = k * n + (i + 1) % n, c = a + n, d = b + n;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Derin deniz yansıtırlığı (bake.py SEA_REF), görüntü albedosuyla aynı ölçek
    const m = new THREE.MeshLambertMaterial({ color: new THREE.Color(0.0006, 0.0035, 0.011) });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.receiveShadow = false; mesh.name = 'ocean-ring';
    this.track(g); this.track(m);
    this.group.add(mesh);
  }

  update(dt, camera, aircraftPos) {
    this.time += dt;
    this.updateSun(camera, aircraftPos);
    if (this.terrain) this.terrain.update(camera, dt, aircraftPos, this.focusVel);
    // Pist ışıkları: GL noktaları ucuzdur; yaklaşmada seçilebilsin diye 14 km'ye kadar
    if (this.runwayLightSets) {
      const c = camera.position, d = Math.hypot(c.x - LTFE.x, c.y - MSL_Y, c.z - LTFE.z);
      for (const p of this.runwayLightSets) p.visible = p.visible ? d < 14400 : d < 13600;
    }
  }

  /** Yükleme ekranında: görünür düğümleri bütçesiz kurar (ilk uçuş karesi kaba arazi göstermez). */
  prewarm(camera, maxMs = 2500) {
    if (!this.terrain || !this.terrain.group) return;
    camera.updateMatrixWorld();
    const t0 = performance.now(), keep = this.terrain.buildMs;
    this.terrain.buildMs = 60;
    let prev = -1;
    while (performance.now() - t0 < maxMs) {
      this.terrain.update(camera, 0);
      const n = this.terrain.stats.built;
      if (n === prev) break;
      prev = n;
    }
    this.terrain.buildMs = keep;
  }

  setPerf(o) {
    super.setPerf(o);
    if (this.terrain) this.terrain.detail = o.detail;
  }

  dispose() {
    if (this.terrain) this.terrain.dispose();
    HAZE_UNIFORMS.hzCurv.value = 0;
    super.dispose();
  }
}
