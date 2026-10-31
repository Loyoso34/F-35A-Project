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
import { GeoFeatures } from './geofeatures.js';
import { buildRunway, buildLightPoints, trueHeadingFromEnds } from './runway.js';
import { makePavementTexture, makeTerrainDetailTexture, makeWaterNormalTexture, makeConcreteTexture, makeFacadeTexture, makeCladdingTexture, makeHangarWallTexture } from './textures.js';
import { HAZE_UNIFORMS, hazeAll } from './worldshade.js';
import { clamp, smoothstep } from './noise.js';
import { solarPosition, sunVector, localTimeMs, TIME_PRESETS } from './sun.js';

// Alçak güneşte hedef renkler (doğrusal); setTimeOfDay yüksekliğe göre bunlara doğru karıştırır
const TOD_COLORS = {
  sun: new THREE.Color(1.0, 0.58, 0.32), light: new THREE.Color(1.0, 0.66, 0.42),
  horizon: new THREE.Color(0.86, 0.62, 0.46), zenith: new THREE.Color(0.10, 0.20, 0.42),
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
  low: { drawDistance: 70000, far: 300000, lodFactor: 1.9, textureBudget: 120, nodeBudget: 220, buildMs: 2.5, demBudget: 40,
    bldRadius: 1800, roadRadius: 1400, vegRadius: 900, vegDensity: 0.6, featureMs: 2.0 },
  medium: { drawDistance: 100000, far: 420000, lodFactor: 2.5, textureBudget: 180, nodeBudget: 320, buildMs: 3.5, demBudget: 64,
    bldRadius: 2800, roadRadius: 2300, vegRadius: 1500, vegDensity: 1.0, featureMs: 3.0 },
  high: { drawDistance: 140000, far: 480000, lodFactor: 3.3, textureBudget: 300, nodeBudget: 460, buildMs: 5.0, demBudget: 96,
    bldRadius: 4200, roadRadius: 3300, vegRadius: 2400, vegDensity: 1.35, featureMs: 4.0 },
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
  static get STAGES() { return ['sky', 'lights', 'geodata', 'ltfe', 'features', 'ocean', 'clouds', 'collision']; }

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
    this.buildingBoxes = [];         // meydan binaları (OSM ayak izi) buildAirport ile eklenir; şehir binaları GeoFeatures.hits
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
      { id: 'features', run: () => this.buildFeatures() },
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
    let detail = null, waterN = null;
    if (this.renderer) {
      detail = this.track(makeTerrainDetailTexture(512)); detail.anisotropy = q.anisotropy;
      waterN = this.track(makeWaterNormalTexture(256));
    }
    const tg = new THREE.Group(); tg.name = 'geo-terrain';
    this.group.add(tg);
    this.terrain = new GeoTerrain({
      frame: this.frame, manifest: this.man, base: this.base, group: this.renderer ? tg : null,
      segments: 64, lodFactor: q.lodFactor, anisotropy: q.anisotropy, textureBudget: q.textureBudget,
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
  /**
   * Güneş konumu bölgenin referans noktasında ve görüntü tarihinde (sun.js, Sentinel-2 meta
   * verisiyle doğrulanmış formül), yerel saat (UTC+3). 'default' = görüntünün çekim anı (12:10).
   * Gök/ışık renkleri güneş yüksekliğiyle sanatsal olarak ısınır (fiziksel saçılma modeli değil).
   * Sınır: görüntü kendi çekim anının gölgelerini taşır; başka saatlerde kabartma ışığının payı
   * artırılır ama görüntüdeki gölgeler silinmez. Gece desteklenmez.
   * @returns {{azimuthDeg:number, elevationDeg:number}} uygulanan güneş konumu
   */
  setTimeOfDay(key) {
    const U = this.skyUniforms;
    if (!U || !this.sun || !this.hemi) return null;
    const B = this._todBase || (this._todBase = {
      dir: this.sunDir.clone(), zenith: U.zenith.value.clone(), horizon: U.horizon.value.clone(), ground: U.ground.value.clone(),
      sunColor: U.sunColor.value.clone(), light: this.sun.color.clone(), sunI: this.sun.intensity, hemiI: this.hemi.intensity,
      relief: TERRAIN_UNIFORMS.uRelief.value,
    });
    const t = TIME_PRESETS[key];
    let pos;
    if (t) {
      pos = solarPosition(localTimeMs(this.man.sun.datetime.slice(0, 10), t.h, t.m), this.man.reference.lat, this.man.reference.lon);
      sunVector(pos.azimuthDeg, pos.elevationDeg, this.sunDir);
    } else {
      this.sunDir.copy(B.dir);
      pos = { azimuthDeg: this.man.sun.azimuthDeg, elevationDeg: this.man.sun.elevationDeg };
    }
    const el = Math.asin(clamp(this.sunDir.y, -1, 1)) / DEG;
    const low = smoothstep(24, 2, el);            // 0: yüksek güneş, 1: ufka yakın
    const W = TOD_COLORS;
    U.sunDir.value.copy(this.sunDir);
    U.sunColor.value.copy(B.sunColor).lerp(W.sun, low);
    U.horizon.value.copy(B.horizon).lerp(W.horizon, low * 0.55);
    U.zenith.value.copy(B.zenith).lerp(W.zenith, low * 0.45);
    U.ground.value.copy(B.ground).multiplyScalar(1 - 0.35 * low);
    if (this.scene.fog) this.scene.fog.color.copy(U.horizon.value);
    this.sun.color.copy(B.light).lerp(W.light, low);
    this.sun.intensity = B.sunI * (0.35 + 0.65 * smoothstep(0, 30, el));
    this.hemi.intensity = B.hemiI * (0.55 + 0.45 * smoothstep(0, 35, el));
    if (this.fill) this.fill.position.set(-this.sunDir.x, 0.35, -this.sunDir.z).normalize().multiplyScalar(500);
    // Gölge kamerası tabanı güneş yönüne bağlı: yeniden kurulsun
    this._lightBasis = null; this._lightBasisInv = null;
    TERRAIN_UNIFORMS.uRelief.value = t ? Math.max(B.relief, 0.78) : B.relief;
    this.timeKey = key;
    return pos;
  }

  /** Binalar, yollar, ağaçlar (geofeatures.js): meydan çevresi uçuş başlamadan hazır. */
  async buildFeatures() {
    if (!this.man.buildings) return;
    const fg = new THREE.Group(); fg.name = 'geo-features';
    this.group.add(fg);
    this.features = new GeoFeatures(this, this.renderer ? fg : null);
    await this.features.preload(new THREE.Vector3(LTFE.x, MSL_Y + 120, LTFE.z + 300));
  }

  /** Yapı çarpışması: meydan binaları (çokgen) + şehir binaları (yönlü kutu, yüklü karolar). */
  hitsBuilding(x, y, z, r = 3) {
    return super.hitsBuilding(x, y, z, r) || (this.features ? this.features.hits(x, y, z, r) : false);
  }
  segmentHit(p0, p1) {
    const a = super.segmentHit(p0, p1), b = this.features ? this.features.segmentHit(p0, p1) : -1;
    return a < 0 ? b : b < 0 ? a : Math.min(a, b);
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
    // Süreler performans katmanı içindir (ölçüm: performance.now, ms)
    let t0 = performance.now();
    if (this.terrain) { this.terrain.update(camera, dt, aircraftPos, this.focusVel); const t1 = performance.now(); this.terrain.stats.updateMs = t1 - t0; t0 = t1; }
    if (this.features) { this.features.update(camera, aircraftPos, dt); this.features.stats.updateMs = performance.now() - t0; }
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
    if (this.features) this.features.detail = o.detail;
  }

  dispose() {
    if (this.features) this.features.dispose();
    if (this.terrain) this.terrain.dispose();
    HAZE_UNIFORMS.hzCurv.value = 0;
    super.dispose();
  }
}
