// Gerçek dünya bölgesi (Bodrum): World'ün arayüzünü uygular, gökyüzü/ışık/bulut/çarpışma kodunu
// World'den devralır; arazi akışlı gerçek veridir (geoterrain.js), havaalanı LTFE'dir.
//
// Fizik çerçevesi: yerel Transvers Merkatör (geo.js), kök = LTFE ARP; y = MSL + MSL_Y. Böylece
// physics.js, cameras.js, weapons.js ve HUD değişmeden çalışır (irtifa = y − WATER_LEVEL = MSL).
import * as THREE from 'three';
import { World, QUALITY_PRESETS } from './world.js';
import { LocalFrame, GeoidGrid, MSL_Y } from './geo.js';
import { GeoTerrain, CURVE_K, TERRAIN_UNIFORMS } from './geoterrain.js';
import { BODRUM, LTFE } from './georegion.js';
import { Ltfe3D } from './ltfe3d.js';
import { CoreTerrain, CORE, inCore } from './coreterrain.js';
import { makeTerrainMaterial, makeDetailAtlas, TMAT_UNIFORMS } from './terrainmat.js';
import { Ocean } from './ocean.js';
import { BodrumCity } from './bodrum.js';
import { buildLtfeExtras } from './ltfeplus.js';
import { makeArchMaterial, ARCH_UNIFORMS } from './archmat.js';
import { buildRunway, buildLightPoints, trueHeadingFromEnds, LIGHT_FX } from './runway.js';
import { makePavementTexture, makeWaterNormalTexture, makeConcreteTexture, makeFacadeTexture, makeCladdingTexture, makeHangarWallTexture } from './textures.js';
import { HAZE_UNIFORMS, hazeAll } from './worldshade.js';
import { clamp, smoothstep } from './noise.js';
import { solarPosition, sunVector, localTimeMs, TIME_PRESETS } from './sun.js';

// Alçak güneşte hedef renkler (doğrusal); setTimeOfDay yüksekliğe göre bunlara doğru karıştırır
const TOD_COLORS = {
  sun: new THREE.Color(1.0, 0.55, 0.26), light: new THREE.Color(1.0, 0.63, 0.36),
  horizon: new THREE.Color(0.95, 0.66, 0.44), zenith: new THREE.Color(0.075, 0.15, 0.36),
};

const FT = 0.3048;
const DEG = Math.PI / 180;

// Kalite ön ayarına eklenen gerçek dünya değerleri. Performance / Balanced / Ultra = low / medium / high.
//   drawDistance: pus mesafesi (görüş), far: kamera uzak düzlemi, lodFactor: düğüm bölme eşiği
//   (mesafe < boyut × lodFactor), textureBudget: GPU'daki görüntü karosu sayısı (256² RGBA ≈ 0,35 MB
//   mip dahil), nodeBudget: inşa edilmiş düğüm üst sınırı, buildMs: karede düğüm inşa süresi.
export const GEO_QUALITY = {
  // 3B ayrıntı: bldRadius / roadRadius / vegRadius (m, kameradan), vegDensity (ağaç yoğunluğu
  // çarpanı), featureMs (karede bina/yol/ağaç inşa süresi).
  // v5.0 çekirdek: coreLod (düğüm bölme çarpanı), coreTex (normal/makro doku), coreNodes (örgü bütçesi),
  // reflections (düzlemsel deniz yansıması), city (şehir ayrıntı mesafesi çarpanı), trees (ağaç sayısı çarpanı)
  low: { drawDistance: 70000, far: 300000, lodFactor: 1.9, textureBudget: 110, nodeBudget: 200, buildMs: 2.5, demBudget: 40,
    coreLod: 1.6, coreTex: 1024, coreNodes: 110, reflections: false, city: 0.65, trees: 0.35, shadowWide: 0 },
  medium: { drawDistance: 100000, far: 420000, lodFactor: 2.5, textureBudget: 160, nodeBudget: 280, buildMs: 3.5, demBudget: 64,
    coreLod: 2.2, coreTex: 2048, coreNodes: 170, reflections: true, city: 1.0, trees: 1.0, shadowMap: 2048, shadowWide: 650 },
  high: { drawDistance: 140000, far: 480000, lodFactor: 3.0, textureBudget: 260, nodeBudget: 400, buildMs: 5.0, demBudget: 96,
    coreLod: 2.8, coreTex: 2048, coreNodes: 240, reflections: true, city: 1.3, trees: 1.4, shadowMap: 4096, shadowWide: 1100 },
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
  static get STAGES() { return ['sky', 'lights', 'geodata', 'core', 'design', 'coretex', 'ltfe', 'city', 'ocean', 'clouds', 'collision']; }

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
    this.buildingBoxes = [];         // meydan binaları (OSM ayak izi) buildAirport ile, şehir yapıları bodrum.js ile eklenir
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
    // OSM meydan geometrisi (taksi yolları, apronlar, terminaller): conform() ve yüzey sorgusu bundan
    if (man.airport) {
      const u = this.base + man.airport.url;
      const data = this.opts.fetchJSON ? await this.opts.fetchJSON(u) : await (await fetch(u)).json();
      this.ltfe = new Ltfe3D(this.frame, LTFE, data);
    }
    // v5.0: gerçek yol ağı (OSM; çekirdek + D330 koridoru + meydan erişimi)
    try {
      const u = this.base + 'roads.json';
      this.roadsData = this.opts.fetchJSON ? await this.opts.fetchJSON(u) : await (await fetch(u)).json();
    } catch (e) { console.warn('roads.json unavailable', e); this.roadsData = null; }
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
      { id: 'core', run: () => this.bakeCore() },
      { id: 'design', run: () => this.designCity() },
      { id: 'coretex', run: (p) => this.buildCoreTextures(p) },
      { id: 'ltfe', run: () => this.buildAirport() },
      { id: 'city', run: () => this.buildCity() },
      { id: 'ocean', run: () => this.buildOcean() },
      { id: 'clouds', run: () => { if (this.renderer) this.buildClouds(); } },
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
    // v3.9: OSM kaplamasına göre (yalnızca kaplama + 120 m geçiş); veri yoksa eski kutu
    if (this.ltfe) return this.ltfe.conform(x, z, h);
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
    const tg = new THREE.Group(); tg.name = 'geo-terrain';
    this.group.add(tg);
    if (this.renderer) {
      const det = this.track(makeDetailAtlas(512));
      if (det) det.anisotropy = q.anisotropy;
      TMAT_UNIFORMS.tDet.value = det;
    }
    TMAT_UNIFORMS.uCoreRect.value.set(CORE.x0, CORE.z0, CORE.x1, CORE.z1);
    const az = this.man.sun.azimuthDeg * DEG, el = this.man.sun.elevationDeg * DEG;
    TMAT_UNIFORMS.uAcqSun.value.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
    TMAT_UNIFORMS.uMacroGain.value = 1 / (this.man.imagery.albedoScale || 1.6);
    this.terrain = new GeoTerrain({
      frame: this.frame, manifest: this.man, base: this.base, group: this.renderer ? tg : null,
      segments: 64, lodFactor: q.lodFactor, anisotropy: q.anisotropy, textureBudget: q.textureBudget,
      nodeBudget: q.nodeBudget, buildMs: q.buildMs, demBudget: q.demBudget,
      conform: (x, z, h) => this.conform(x, z, h),
      makeMaterial: (map) => makeTerrainMaterial('outer', { map }),
      exclude: { x0: CORE.x0, z0: CORE.z0, x1: CORE.x1, z1: CORE.z1 },
      fetch: this.opts.fetch, decodeRGBA: this.opts.decodeRGBA, clock: this.opts.clock,
    });
    await this.terrain.loadCoarse((f) => progress && progress(f * 0.25));
    // Havaalanı (±9 km) ve 20 × 20 km çekirdek harita: ince DEM uçuş başlamadan hazır
    await this.terrain.ensureArea(LTFE.x, LTFE.z, 9000, (f) => progress && progress(0.25 + f * 0.3));
    await this.terrain.ensureArea(CORE.cx, CORE.cz, CORE.half + 1200, (f) => progress && progress(0.55 + f * 0.35));
    if (this.renderer) await this.terrain.prefetchImagery(LTFE.x, LTFE.z, 4000, (f) => progress && progress(0.9 + f * 0.1));
  }

  /** Çekirdek yükseklik alanı (gerçek DEM'den, üreteç). */
  *bakeCore() {
    const q = this.quality;
    this.core = new CoreTerrain({
      frame: this.frame, dem: this.terrain.dem, demZ: this.terrain.demFine,
      lodFactor: q.coreLod || 2.2, texSize: q.coreTex || 2048, anisotropy: q.anisotropy,
      buildMs: q.buildMs, nodeBudget: q.coreNodes || 170,
    });
    yield* this.core.bakeBase();
    // pişirme sonrası: batimetrili ham DEM dizileri ve çekirdek ızgarası artık gerekmez (bellek; fizik
    // dış bölgede h/w/dp dizilerini kullanır)
    for (const t of this.terrain.dem.tiles.values()) t.raw = null;
    this.core.raster = null; this.core.map16 = null;
  }

  /** Şehir ve kıyı tasarımı: arazi düzenlemeleri (teras, rıhtım, yol yatağı) ve zemin maskeleri. */
  *designCity() {
    this.city = new BodrumCity(this);
    yield* this.city.design();
  }

  /** Çekirdek dokuları (normal/AO, maske, makro görüntü) ve dörtlü ağaç çizimi. */
  async buildCoreTextures(progress) {
    const C = this.core;
    if (!this.renderer) return;
    let k = 0;
    for (const f of C.makeNormalTexture()) { if (progress) progress(f * 0.6); if (++k % 4 === 0) await new Promise((r) => setTimeout(r, 0)); }
    const mask = this.track(C.makeMaskTexture());
    const url = (z, x, y) => this.base + this.man.imagery.url.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const decode = async (u) => {
      const r = await fetch(u); if (!r.ok) throw new Error(r.status);
      const b = await r.blob();
      try { return await createImageBitmap(b, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch (e) { return await createImageBitmap(b); }
    };
    const zImg = Math.max(...Object.keys(this.man.imagery.levels).map(Number));
    const macro = this.track(await C.makeMacroTexture(url, zImg, decode));
    this.coreMacroCanvas = macro.image;
    if (progress) progress(0.95);
    this.track(C.normalTex);
    const cg = new THREE.Group(); cg.name = 'core-terrain';
    this.group.add(cg);
    C.group = cg;
    C.initRender({ macro, normal: C.normalTex, mask });
  }

  heightAt(x, z) {
    if (this.core && inCore(x, z)) return this.core.mslAt(x, z) + MSL_Y;
    return this.terrain.mslAt(x, z) + MSL_Y;
  }

  surfaceTypeAt(x, z) {
    if (this.core && inCore(x, z)) return this.core.isWater(x, z) ? 'water' : (this.city ? this.city.surfaceAt(x, z) : 'grass');
    const a = LTFE, o = this._sl || (this._sl = { u: 0, v: 0 });
    for (const r of a.runways) {
      this.rwLocal(r, x, z, o);
      const padA = r.ends[0].pad, padB = r.ends[1].pad;
      if (Math.abs(o.v) <= r.width / 2 + 0.5 && o.u >= -r.len / 2 - padA && o.u <= r.len / 2 + padB) return 'runway';
    }
    if (this.ltfe) {
      const s = this.ltfe.surfaceAt(x, z);           // OSM taksi yolu (23 m, yaklaşık genişlik) / apron
      if (s) return s;
      if (this.ltfe.pavedDist(x, z) > 60 && this.terrain.waterAt(x, z) >= 0.5) return 'water';
      return 'grass';
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
    o.terrainMsl = this.heightAt(pos.x, pos.z) - MSL_Y;
    o.hAgl = o.hMsl - o.terrainMsl;
    o.convergence = this.frame.convergence(g.lat, g.lon);
    o.hdgTrue = (((gridHdg + o.convergence) % 360) + 360) % 360;
    o.hdgMag = (((o.hdgTrue - this.magVar) % 360) + 360) % 360;
    return o;
  }

  // ---- Havaalanı çizimi ----------------------------------------------------------------------
  /** Yönlü kutu çarpışma hacmi (meydan ayrıntıları: kule, direkler, park hâlindeki uçaklar). */
  addSolidOBB(x, z, hw, hd, a, y0, y1) {
    const ca = Math.cos(a), sa = Math.sin(a), ex = Math.abs(hw * ca) + Math.abs(hd * sa), ez = Math.abs(hw * sa) + Math.abs(hd * ca);
    this.buildingBoxes.push({ minX: x - ex, maxX: x + ex, minZ: z - ez, maxZ: z + ez, minY: y0, maxY: y1,
      test: (px, pz, r) => { const dx = px - x, dz = pz - z; const u = dx * ca + dz * sa, v = -dx * sa + dz * ca; return Math.abs(u) < hw + r && Math.abs(v) < hd + r; } });
  }
  get ltfeRunways() { return LTFE.runways; }
  get mslY() { return MSL_Y; }

  buildAirport() {
    // başsız (test): çizim yok, yalnızca meydan binası ve ayrıntı çarpışma hacimleri
    if (!this.renderer) { if (this.ltfe) { this.addAirportSolids(); this.ltfe.holds = this.ltfe.holdPositions(); buildLtfeExtras(this, null); } return; }
    const q = this.quality;
    const pave = this.track(makePavementTexture(512, { base: 92 }));
    pave.anisotropy = q.anisotropy;
    const lights = [];
    this.runwayGroups = [];
    for (const r of LTFE.runways) {
      const rw = buildRunway({
        length: r.len, width: r.width, standard: 'ICAO', tdzPattern: 'coded', centerlineW: 0.9,
        // Işıklandırma yayımlanmış yapılandırmadan (georegion.js: CAT II ALS, PAPI 3,3° / 3,9°, TDZ, RCL)
        ends: r.ends.map((e) => Object.assign({ text: e.num, suffix: e.suffix, pad: e.pad, approach: false, papi: false }, e.light || {})),
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
    // OSM meydanı: taksi yolları, apronlar, işaretler, terminal/hangar gövdeleri (+ çarpışma)
    if (this.ltfe) {
      const conc = this.track(makeConcreteTexture(512)); conc.anisotropy = q.anisotropy;
      const glass = this.track(makeFacadeTexture('glass', 256));
      const clad = this.track(makeCladdingTexture(256));
      const hang = this.track(makeHangarWallTexture(256));
      for (const t of [conc, glass, clad, hang]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
      this.ltfe.build(this.group, (x, z) => this.heightAt(x, z), {
        concreteMap: conc, glassMap: glass, cladMap: clad, hangarMap: hang, shadows: q.shadows, track: (o) => this.track(o),
      });
      this.addAirportSolids();
      const am = this.track(makeArchMaterial());
      this.ltfeExtras = buildLtfeExtras(this, this.group, { material: am });
      if (this.ltfeExtras && this.ltfeExtras.mesh) { this.track(this.ltfeExtras.mesh.geometry); this.track(this.ltfeExtras.points.geometry); this.track(this.ltfeExtras.points.material); }
    }
  }

  /** Meydan binalarını çarpışma listesine ekler (çizim olmadan da çağrılabilir). */
  addAirportSolids() {
    if (!this.ltfe.buildingSolids) this.ltfe.computeSolids((x, z) => this.heightAt(x, z));
    for (const b of this.ltfe.buildingSolids) {
      if (b.test) continue;
      const poly = b.poly;
      // Kutu testi geçerse ayak izi çokgeniyle kesin test (eğik terminalin AABB'si boşluğu da kapsar)
      b.test = (x, z, r) => Ltfe3D.inPoly(poly, x, z) || poly.some((p, i) => Ltfe3D.segDist({ ax: p.x, az: p.z, bx: poly[(i + 1) % poly.length].x, bz: poly[(i + 1) % poly.length].z }, x, z) < r);
      this.buildingBoxes.push(b);
    }
  }

  // ---- Gün saati -----------------------------------------------------------------------------
  get supportsTimeOfDay() { return true; }

  /** Gök kubbesi: World'ün gökyüzü + yıldızlar ve ay (gece). */
  buildSky() {
    super.buildSky();
    const U = this.skyUniforms;
    U.uStars = { value: 0 };
    U.uMoonDir = { value: new THREE.Vector3(0.45, 0.62, 0.64).normalize() };
    U.uNightSky = { value: 0 };
    const m = this.sky.material;
    m.fragmentShader = m.fragmentShader
      .replace('uniform vec3 sunColor;', 'uniform vec3 sunColor; uniform float uStars; uniform vec3 uMoonDir; uniform float uNightSky;')
      .replace('gl_FragColor = vec4(col, 1.0);', `
          vec3 d = normalize(vDir);
          if (uStars > 0.0 && d.y > 0.0) {
            // yıldızlar: yön ızgarasında seyrek, parlaklık dağılımlı; ufka doğru sönük (pus)
            vec3 q = d * 420.0; vec3 cell = floor(q);
            float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
            float h2 = fract(sin(dot(cell, vec3(39.346, 11.135, 83.155))) * 24634.6345);
            vec3 f = fract(q) - 0.5;
            float st = step(0.9965, h) * smoothstep(0.32, 0.0, length(f)) * (0.35 + 1.6 * h2 * h2);
            col += vec3(0.85, 0.9, 1.0) * st * uStars * smoothstep(0.02, 0.25, d.y);
            // Samanyolu: hafif bant
            float mw = exp(-pow(dot(d, normalize(vec3(0.3, 0.55, -0.78))) / 0.16, 2.0));
            col += vec3(0.010, 0.011, 0.016) * mw * uStars * smoothstep(0.0, 0.3, d.y);
          }
          // ay diski ve halesi
          if (uNightSky > 0.0) {
            float mc = dot(d, uMoonDir);
            col += vec3(0.9, 0.92, 1.0) * smoothstep(0.99975, 0.99985, mc) * 3.0 * uNightSky;
            col += vec3(0.05, 0.06, 0.09) * pow(max(mc, 0.0), 60.0) * uNightSky;
          }
          gl_FragColor = vec4(col, 1.0);`);
    m.needsUpdate = true;
  }

  /**
   * Gün saati: güneş konumu bölgenin referans noktasında ve görüntü tarihinde (sun.js, Sentinel-2
   * meta verisiyle doğrulanmış formül), yerel saat (UTC+3). 'default' = görüntünün çekim anı (12:10).
   * Işık bütçesi güneş yüksekliğinden: gündüz → altın saat (sıcak, alçak güneş, uzun gölgeler) →
   * alacakaranlık (güneş ufkun altında; gök parıltısı, şehir ışıkları yanar) → gece (ay ışığı,
   * yıldızlar, pencereler, sokak/liman/pist ışıkları). Pozlama gece hafif yükselir (göz uyumu).
   * @returns {{azimuthDeg:number, elevationDeg:number}} uygulanan güneş konumu
   */
  setTimeOfDay(key) {
    const U = this.skyUniforms;
    if (!U || !this.sun || !this.hemi) return null;
    const B = this._todBase || (this._todBase = {
      dir: this.sunDir.clone(), zenith: U.zenith.value.clone(), horizon: U.horizon.value.clone(), ground: U.ground.value.clone(),
      sunColor: U.sunColor.value.clone(), light: this.sun.color.clone(), sunI: this.sun.intensity, hemiI: this.hemi.intensity,
      hemiSky: this.hemi.color.clone(), hemiGround: this.hemi.groundColor.clone(),
    });
    const t = TIME_PRESETS[key];
    let pos;
    const sunTrue = new THREE.Vector3();
    if (t) {
      pos = solarPosition(localTimeMs(this.man.sun.datetime.slice(0, 10), t.h, t.m), this.man.reference.lat, this.man.reference.lon);
      sunVector(pos.azimuthDeg, pos.elevationDeg, sunTrue);
    } else {
      sunTrue.copy(B.dir);
      pos = { azimuthDeg: this.man.sun.azimuthDeg, elevationDeg: this.man.sun.elevationDeg };
    }
    const el = Math.asin(clamp(sunTrue.y, -1, 1)) / DEG;
    // 0 gündüz .. 1 gece; alacakaranlık (−0,8°..−9°) arasında
    const night = smoothstep(-0.8, -9, el), dusk = smoothstep(4, -3, el);
    const low = smoothstep(26, 1, el);                 // altın saat ağırlığı
    const W = TOD_COLORS;
    // Gök renkleri
    const zen = B.zenith.clone().lerp(W.zenith, low * 0.7).lerp(new THREE.Color(0.012, 0.022, 0.06), dusk * 0.85).lerp(new THREE.Color(0.0016, 0.0028, 0.008), night);
    const hor = B.horizon.clone().lerp(new THREE.Color(0.40, 0.38, 0.45), low * 0.75).lerp(new THREE.Color(0.30, 0.17, 0.12), dusk * 0.7).lerp(new THREE.Color(0.006, 0.009, 0.016), night);
    const gnd = B.ground.clone().multiplyScalar(1 - 0.4 * low).lerp(new THREE.Color(0.003, 0.004, 0.006), Math.max(night, dusk * 0.6));
    const sunC = B.sunColor.clone().lerp(W.sun, low).multiplyScalar(1 - night);
    U.zenith.value.copy(zen); U.horizon.value.copy(hor); U.ground.value.copy(gnd); U.sunColor.value.copy(sunC);
    U.uStars.value = night; U.uNightSky.value = night;
    // gök ve pus güneşi: alacakaranlıkta ufkun hemen altındaki güneş (parıltı yönü)
    this.sunDir.copy(sunTrue);
    if (el < 0) { this.sunDir.y = Math.max(this.sunDir.y, -0.02); this.sunDir.normalize(); }
    U.sunDir.value.copy(this.sunDir);
    if (this.scene.fog) this.scene.fog.color.copy(U.horizon.value);
    // Işıklar: güneş (gece: ay ışığı, aynı ışık; yön ayın yönü)
    const moon = U.uMoonDir.value;
    if (night > 0.5) this.sunDir.copy(moon);
    const sunGain = smoothstep(-2.0, 3.5, el);
    this.sun.color.copy(B.light).lerp(W.light, low);
    this.sun.intensity = B.sunI * (0.92 + 0.08 * smoothstep(0, 30, el)) * sunGain;
    if (night > 0.5) { this.sun.color.setRGB(0.55, 0.66, 0.95); this.sun.intensity = 0.22 * night; }
    this.hemi.color.copy(B.hemiSky).lerp(new THREE.Color(0.8, 0.62, 0.5), low * 0.35).lerp(new THREE.Color(0.18, 0.22, 0.36), Math.max(dusk * 0.6, night));
    this.hemi.groundColor.copy(B.hemiGround).multiplyScalar(1 - 0.85 * Math.max(dusk, night));
    this.hemi.intensity = B.hemiI * (0.45 + 0.55 * smoothstep(0, 30, el)) * (1 - 0.25 * low) * (1 - 0.75 * dusk) * (1 - night) + 0.06 * night;
    if (this.fill) { this.fill.intensity = 0.55 * (1 - Math.max(dusk, night)); this.fill.position.set(-this.sunDir.x, 0.35, -this.sunDir.z).normalize().multiplyScalar(500); }
    this._lightBasis = null; this._lightBasisInv = null;
    // Dünya malzemeleri: gece oranları
    const cityNight = smoothstep(2, -5, el);
    ARCH_UNIFORMS.uNight.value = cityNight; ARCH_UNIFORMS.uDusk.value = dusk;
    LIGHT_FX.uLNight.value = cityNight;
    TMAT_UNIFORMS.uNight.value = night; TMAT_UNIFORMS.uSunI.value = Math.max(0.05, sunGain);
    if (this.ocean) this.ocean.setSun(this.sun, night);
    if (this.ltfeSignMat) this.ltfeSignMat.emissiveIntensity = 0.55 * cityNight;
    // bulutlar gök ışığıyla: altın saatte sıcak, gece karanlık
    if (this.cloudTint) {
      const cb = (0.08 + 0.92 * smoothstep(-8, 6, el));
      this.cloudTint.setRGB(cb, cb * (1 - 0.18 * low), cb * (1 - 0.32 * low)).lerp(new THREE.Color(0.05, 0.06, 0.09), night);
    }
    // pozlama: gece göz uyumu (ACES), altın saatte hafif
    if (this.renderer) this.renderer.toneMappingExposure = 1.0 + 0.12 * low * (1 - dusk) + 0.9 * dusk * (1 - night) + 1.6 * night;
    this.timeKey = key; this.nightK = night; this.cityNight = cityNight;
    if (this.onTimeOfDay) this.onTimeOfDay();
    return pos;
  }

  buildClouds() {
    super.buildClouds();
    // gün saati tonu: billboard malzemesine çarpan, düz bulut tabakasına renk
    this.cloudTint = new THREE.Color(1, 1, 1);
    const [bill, flat] = this.clouds || [];
    if (bill) {
      const m = bill.material;
      m.uniforms.uTint = { value: this.cloudTint };
      m.fragmentShader = m.fragmentShader.replace('uniform sampler2D map;', 'uniform sampler2D map; uniform vec3 uTint;').replace('gl_FragColor = vec4(c.rgb * shade, c.a * 0.92);', 'gl_FragColor = vec4(c.rgb * shade * uTint, c.a * 0.92);');
      m.needsUpdate = true;
    }
    if (flat) flat.material.color = this.cloudTint;
  }

  /** Şehir 3B içeriği (bodrum.js): kale, liman, marina, gökdelenler, evler, yollar, ağaçlar. */
  *buildCity() {
    if (!this.city) return;
    yield* this.city.build(this.renderer ? this.group : null);
  }

  /** Yapı çarpışması: meydan binaları (çokgen) + şehir yapıları. */
  hitsBuilding(x, y, z, r = 3) {
    return super.hitsBuilding(x, y, z, r);
  }
  segmentHit(p0, p1) {
    return super.segmentHit(p0, p1);
  }

  /** Küresel deniz yüzeyi (ocean.js): çekirdek, bölge ve ufuk; tek gölgelendirici, dikiş yok. */
  buildOcean() {
    if (!this.renderer) return;
    const B = this.man.bounds.outer, f = this.frame;
    const a = f.toLocal(B[3], B[0]), b = f.toLocal(B[1], B[2]);
    const inset = 3000;
    this.ocean = new Ocean({
      renderer: this.renderer, quality: this.qualityKey, normalTex: this.track(makeWaterNormalTexture(256)),
      dataRect: [Math.min(a.x, b.x) + inset, Math.min(a.z, b.z) + inset, Math.max(a.x, b.x) - inset, Math.max(a.z, b.z) - inset],
      reflections: this.quality.reflections,
    });
    if (this.city && this.city.shelters) this.ocean.setShelters(this.city.shelters);
    this.ocean.setSun(this.sun);
    this.group.add(this.ocean.mesh);
    this.track(this.ocean);
  }

  /**
   * Gölge kamerası (v5.0): uçağın çevresinde dar (keskin uçak gölgesi) + şehir ölçeğinde geniş kip.
   * Kamera alçakta ve çekirdek haritadaysa kapsam irtifa/kamera uzaklığıyla genişler (binaların uzun
   * altın saat gölgeleri sokaklara düşer); sinematik kameralar shadowFocus ile odak/kapsam verir.
   * Kapsam 8 m'lik basamaklarla değişir ve hedef doku ızgarasına oturtulur (titreme yok).
   */
  updateSun(camera, aircraftPos) {
    this.sky.position.copy(camera.position);
    const sun = this.sun;
    if (!sun.castShadow) { sun.target.position.copy(aircraftPos); sun.position.copy(aircraftPos).addScaledVector(this.sunDir, 600); sun.target.updateMatrixWorld(); return; }
    const F = this.shadowFocus;
    const target = this._shadowTarget || (this._shadowTarget = new THREE.Vector3());
    const wideMax = this.quality.shadowWide || 0;
    let half;
    if (F) { target.set(F.x, F.y !== undefined ? F.y : aircraftPos.y, F.z); half = Math.min(F.half, wideMax || 70); }
    else {
      target.copy(aircraftPos);
      const camD = camera.position.distanceTo(aircraftPos);
      half = clamp(22 + camD * 0.9, 32, 70);
      if (wideMax && this.core && inCore(aircraftPos.x, aircraftPos.z, -500)) {
        const agl = aircraftPos.y - this.heightAt(aircraftPos.x, aircraftPos.z);
        half = Math.max(half, clamp(agl * 0.9 + camD * 0.4, 70, wideMax));
      }
    }
    half = Math.ceil(half * (this.perf ? this.perf.shadow : 1) / 8) * 8;
    const cam = sun.shadow.camera;
    if (cam.right !== half) { cam.left = -half; cam.right = half; cam.top = half; cam.bottom = -half; cam.near = 10; cam.far = 6000; cam.updateProjectionMatrix(); }
    const texel = 2 * half / sun.shadow.mapSize.width;
    const m = this._lightBasis || (this._lightBasis = new THREE.Matrix4().lookAt(new THREE.Vector3(), this.sunDir.clone().negate(), new THREE.Vector3(0, 1, 0)));
    const inv = this._lightBasisInv || (this._lightBasisInv = m.clone().invert());
    target.applyMatrix4(inv);
    target.x = Math.round(target.x / texel) * texel; target.y = Math.round(target.y / texel) * texel;
    target.applyMatrix4(m);
    sun.target.position.copy(target);
    sun.position.copy(target).addScaledVector(this.sunDir, 3000);
    sun.target.updateMatrixWorld();
    // geniş kipte sapma ölçeklenir (gölge akne/peter-pan dengesi)
    sun.shadow.bias = -0.0002 - half * 0.0000012;
    sun.shadow.normalBias = 0.04 + half * 0.0006;
  }

  update(dt, camera, aircraftPos) {
    this.time += dt;
    this.updateSun(camera, aircraftPos);
    TMAT_UNIFORMS.uTime.value = this.time;
    LIGHT_FX.uLTime.value = this.time;
    // Süreler performans katmanı içindir (ölçüm: performance.now, ms)
    let t0 = performance.now();
    if (this.terrain) { this.terrain.update(camera, dt, aircraftPos, this.focusVel); const t1 = performance.now(); this.terrain.stats.updateMs = t1 - t0; t0 = t1; }
    if (this.core && this.core.group) this.core.update(camera, dt);
    if (this.city) this.city.update(dt, camera);
    // Pist ışıkları: GL noktaları ucuzdur; yaklaşmada seçilebilsin diye 14 km'ye kadar
    if (this.runwayLightSets) {
      const c = camera.position, d = Math.hypot(c.x - LTFE.x, c.y - MSL_Y, c.z - LTFE.z);
      for (const p of this.runwayLightSets) p.visible = p.visible ? d < 16400 : d < 15600;
    }
    // Deniz: en son (düzlemsel yansıma bu karenin sahnesini çizer)
    if (this.ocean) this.ocean.update(dt, camera, this.scene);
  }

  /** Yükleme ekranında: görünür düğümleri bütçesiz kurar (ilk uçuş karesi kaba arazi göstermez). */
  prewarm(camera, maxMs = 2500) {
    camera.updateMatrixWorld();
    if (this.core && this.core.group) this.core.prewarm(camera, maxMs * 0.5);
    if (!this.terrain || !this.terrain.group) return;
    const t0 = performance.now(), keep = this.terrain.buildMs;
    this.terrain.buildMs = 60;
    let prev = -1;
    while (performance.now() - t0 < maxMs * 0.5) {
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
    if (this.core) this.core.detail = o.detail;
    if (this.city) this.city.detail = o.detail;
    // uyarlanabilir kalite: kare süresi yetmezse önce düzlemsel deniz yansıması kapanır (gök yansıması kalır)
    if (this.ocean) this.ocean.reflectEnabled = o.effects >= 0.75;
  }

  dispose() {
    if (this.city) this.city.dispose();
    if (this.core) this.core.dispose();
    if (this.terrain) this.terrain.dispose();
    HAZE_UNIFORMS.hzCurv.value = 0;
    super.dispose();
  }
}
