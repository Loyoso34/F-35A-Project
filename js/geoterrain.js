// Gerçek dünya arazisi: Web Merkatör karo dörtlü ağacı (quadtree), akışlı yükseklik (DEM) ve uydu
// görüntüsü, mesafeye bağlı ayrıntı düzeyi (LOD), fizik için yükseklik/su sorgusu.
//
// Veri: geo/<bölge>/manifest.json + dem/{z}/{x}/{y}.png (Terrarium, 0,25 m, mavi bit0 = su) +
// img/{z}/{x}/{y}.webp (Sentinel-2 yansıtırlığı; tools/geodata/bake.py üretir). Hepsi aynı
// kaynaktan (GitHub Pages) gelir: API anahtarı, kota ya da üçüncü taraf hizmet yoktur; service
// worker görülen karoları önbelleğe alır.
//
// Kanonik yüzey (fizik = en ince LOD çizimi):
//   DEM pikselleri piksel MERKEZİNDE örnektir. Köşe ızgarasının değeri çevresindeki 4 piksel
//   merkezinin ortalamasıdır; yüzey köşe ızgarası üzerinde üçgen ara değerlemedir (köşegen
//   (i, j+1)–(i+1, j)). En ince düğümler köşe ızgarasıyla birebir aynı köşeleri ve köşegeni
//   kullandığı için fiziğin gördüğü zemin ile ekranda çizilen zemin aynıdır (teker havada kalmaz,
//   görünmez tepeye çarpılmaz). Kaba düğümler aynı yüzeyden örnekler.
//
// Işınlanma önlemi: ince DEM karosu yüklendiğinde fizik yüksekliği eski (kaba) değerden yenisine
// BLEND_S saniyede geçer; uçağın altındaki zemin tek adımda sıçramaz. Kalkış havaalanının
// çevresi uçuş başlamadan yüklenir (ensureArea).
//
// Çizim kesinliği: her düğümün köşeleri düğüm merkezine göredir (küçük float32 değerler);
// three.js model-görünüm matrisini çift duyarlıkla CPU'da kurar, bu yüzden bölgenin her yerinde
// titreme yoktur (yerel kayan köken). Fizik konumu JS çift duyarlıklı sayılardır.
// Dünya eğriliği yalnızca çizimde uygulanır (köşe gölgelendiricisi, kameraya göre d²/2R):
// fizik düz TM çerçevesinde kalır, ufuk ve uzak deniz doğru batar.
import * as THREE from 'three';
import { lonToTileX, latToTileY, tileXToLon, tileYToLat, MSL_Y } from './geo.js';
import { HAZE_UNIFORMS, HAZE_PARS_VS, HAZE_PARS_FS, CURVE_PROJECT } from './worldshade.js';

export const EARTH_R = 6371000;
export const CURVE_K = 0.5 / EARTH_R;
const BLEND_S = 1.2;
const TILE = 256;

// ---------------------------------------------------------------------------------------------
// Karo çözümleme (tarayıcı). Testler Node'da kendi PNG çözücüsünü verir (decodeRGBA seçeneği).
// ---------------------------------------------------------------------------------------------
let _decCanvas = null, _decCtx = null;
async function browserDecodeRGBA(buf) {
  const blob = new Blob([buf], { type: 'image/png' });
  const src = await decodeImage(blob);
  if (!_decCanvas) {
    _decCanvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(TILE, TILE) : Object.assign(document.createElement('canvas'), { width: TILE, height: TILE });
    _decCtx = _decCanvas.getContext('2d', { willReadFrequently: true });
  }
  _decCtx.clearRect(0, 0, TILE, TILE);
  _decCtx.drawImage(src, 0, 0);
  if (src.close) src.close();
  return _decCtx.getImageData(0, 0, TILE, TILE).data;
}

/**
 * Görüntü çözme: ImageBitmap (renk dönüşümsüz) -> seçeneksiz ImageBitmap -> <img> (eski Safari).
 * Her durumda satır 0 = kuzey; doku flipY = false ile kullanılır.
 */
async function decodeImage(blob) {
  if (typeof createImageBitmap !== 'undefined') {
    try { return await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }); } catch (e) { /* seçenek desteklenmiyor */ }
    try { return await createImageBitmap(blob); } catch (e) { /* biçim desteklenmiyor: <img> dene */ }
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

async function browserFetch(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(r.status + ' ' + url);
  return r.arrayBuffer();
}

// ---------------------------------------------------------------------------------------------
// DEM deposu
// ---------------------------------------------------------------------------------------------
class DemStore {
  constructor(man, base, opts) {
    this.base = base;
    this.url = man.dem.url || 'dem/{z}/{x}/{y}.png';
    this.levels = Object.keys(man.dem.levels).map(Number).sort((a, b) => b - a);   // ince -> kaba
    this.range = man.dem.levels;
    this.tiles = new Map();
    this.fetch = opts.fetch || browserFetch;
    this.decode = opts.decodeRGBA || browserDecodeRGBA;
    this.clock = opts.clock || (() => performance.now() / 1000);
    this.onTile = null;
    this.inflight = 0;
    this.maxInflight = 6;
    this.queue = [];
  }
  inRange(z, x, y) {
    const r = this.range[z];
    return !!r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  }
  key(z, x, y) { return z * 1e8 + x * 1e4 + y; }
  get(z, x, y) { return this.tiles.get(this.key(z, x, y)); }
  /** Karo isteği; söz döner (aynı karo için tek istek). pri: küçük = önce. */
  request(z, x, y, pri = 0) {
    if (!this.inRange(z, x, y)) return null;
    const k = this.key(z, x, y);
    let t = this.tiles.get(k);
    if (t) { t.used = this.clock(); if (!t.ready && t.pri > pri) t.pri = pri; return t.promise; }
    t = { z, x, y, h: null, w: null, ready: false, t0: 0, used: this.clock(), pri };
    t.promise = new Promise((res) => { t.resolve = res; });
    this.tiles.set(k, t);
    this.queue.push(t);
    this.pump();
    return t.promise;
  }
  pump() {
    if (this.inflight >= this.maxInflight || !this.queue.length) return;
    this.queue.sort((a, b) => a.pri - b.pri);
    while (this.inflight < this.maxInflight && this.queue.length) {
      const t = this.queue.shift();
      this.inflight++;
      this.load(t).catch((e) => { console.warn('DEM tile failed', t.z, t.x, t.y, e && e.message); t.failed = true; t.resolve(t); })
        .finally(() => { this.inflight--; this.pump(); });
    }
  }
  async load(t) {
    const url = this.base + this.url.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
    const rgba = await this.decode(await this.fetch(url));
    const n = TILE * TILE, h = new Float32Array(n), w = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
      const b = rgba[p + 2];
      h[i] = rgba[p] * 256 + rgba[p + 1] + (b & 0xfe) / 256 - 32768;
      w[i] = b & 1;
    }
    t.h = h; t.w = w; t.ready = true; t.t0 = this.clock();
    this._lastK = -1;
    t.resolve(t);
    if (this.onTile) this.onTile(t);
  }
  /** Global piksel (seviye z). Bölge dışı: en yakın kenar pikseline sıkıştırılır. Yüklenmemiş: null. */
  pixelTile(z, ix, iy) {
    const r = this.range[z];
    if (ix < r.x0 * TILE) ix = r.x0 * TILE; else if (ix > r.x1 * TILE + TILE - 1) ix = r.x1 * TILE + TILE - 1;
    if (iy < r.y0 * TILE) iy = r.y0 * TILE; else if (iy > r.y1 * TILE + TILE - 1) iy = r.y1 * TILE + TILE - 1;
    const k = this.key(z, ix >> 8, iy >> 8);
    let t = this._lastK === k ? this._lastT : null;
    if (!t) { t = this.tiles.get(k); this._lastK = k; this._lastT = t; }
    if (!t || !t.ready) return null;
    _px.t = t; _px.i = (iy & 255) * TILE + (ix & 255);
    return _px;
  }
}
const _px = { t: null, i: 0 };

// ---------------------------------------------------------------------------------------------
// Görüntü deposu (dokular; GPU belleği sayı bütçesiyle sınırlı, en eski kullanılmayan atılır)
// ---------------------------------------------------------------------------------------------
class ImageryStore {
  constructor(man, base, opts) {
    this.base = base;
    this.url = man.imagery.url || 'img/{z}/{x}/{y}.webp';
    this.range = man.imagery.levels;
    this.maxZ = Math.max(...Object.keys(this.range).map(Number));
    this.tiles = new Map();
    this.inflight = 0; this.maxInflight = 6; this.queue = [];
    this.anisotropy = opts.anisotropy || 4;
    this.budget = opts.textureBudget || 220;
    this.clock = opts.clock || (() => performance.now() / 1000);
    this.onTile = null;
    this.enabled = typeof document !== 'undefined' || typeof createImageBitmap !== 'undefined';
  }
  inRange(z, x, y) {
    const r = this.range[z];
    return !!r && x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
  }
  key(z, x, y) { return z * 1e8 + x * 1e4 + y; }
  get(z, x, y) { return this.tiles.get(this.key(z, x, y)); }
  request(z, x, y, pri = 0) {
    if (!this.enabled || !this.inRange(z, x, y)) return;
    const k = this.key(z, x, y);
    let t = this.tiles.get(k);
    if (t) { t.used = this.clock(); if (!t.ready && t.pri > pri) t.pri = pri; return t.promise; }
    t = { z, x, y, tex: null, ready: false, used: this.clock(), pri, refs: 0 };
    t.promise = new Promise((res) => { t.resolve = res; });
    this.tiles.set(k, t);
    this.queue.push(t);
    this.pump();
    return t.promise;
  }
  pump() {
    if (this.inflight >= this.maxInflight || !this.queue.length) return;
    this.queue.sort((a, b) => a.pri - b.pri);
    while (this.inflight < this.maxInflight && this.queue.length) {
      const t = this.queue.shift();
      if (t.dropped) continue;
      this.inflight++;
      this.load(t).catch((e) => { console.warn('imagery tile failed', t.z, t.x, t.y, e && e.message); t.failed = true; })
        .finally(() => { this.inflight--; t.resolve(t); this.pump(); });
    }
  }
  async load(t) {
    const url = this.base + this.url.replace('{z}', t.z).replace('{x}', t.x).replace('{y}', t.y);
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    const bmp = await decodeImage(await r.blob());
    if (t.dropped) { if (bmp.close) bmp.close(); return; }
    const tex = new THREE.Texture(bmp);
    tex.flipY = false;                       // ImageBitmap: satır 0 = kuzey (uv.y = 0)
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    t.tex = tex; t.ready = true;
    if (this.onTile) this.onTile(t);
  }
  loadedCount() { let n = 0; for (const t of this.tiles.values()) if (t.ready) n++; return n; }
  /** Bütçe aşımında kullanılmayan (refs = 0) en eski dokuları bırakır. */
  trim() {
    let n = 0;
    for (const t of this.tiles.values()) if (t.ready) n++;
    if (n <= this.budget) return;
    const list = [...this.tiles.values()].filter((t) => t.ready && t.refs === 0 && t.z > 8).sort((a, b) => a.used - b.used);
    for (const t of list) {
      if (n <= this.budget * 0.9) break;
      t.tex.dispose(); if (t.tex.image && t.tex.image.close) t.tex.image.close();
      t.tex.image = null;
      this.tiles.delete(this.key(t.z, t.x, t.y)); n--;
    }
  }
  dispose() {
    for (const t of this.tiles.values()) { t.dropped = true; if (t.tex) t.tex.dispose(); }
    this.tiles.clear();
  }
}

// ---------------------------------------------------------------------------------------------
// Arazi malzemesi: uydu görüntüsü albedosu + yumuşatılmış kabartma ışığı + su yansıması/parıltısı
// + yakın ayrıntı + pus + eğrilik. Lambert tabanlıdır: gölge haritası (uçak gölgesi), yarımküre
// ve güneş ışığı three.js'in kendi yolundan gelir.
// ---------------------------------------------------------------------------------------------
export const TERRAIN_UNIFORMS = {
  uRelief: { value: 0.55 },          // 0 = görüntünün kendi gölgelemesi, 1 = tam Lambert
  uAlbedo: { value: 1 / 1.6 },       // depolanan = albedo * 1.6
  uExposure: { value: 1.0 },         // görüntü albedosu kazancı (bölge ayarı)
  uDetail: { value: null },
  uWaterN: { value: null },
  uTime: { value: 0 },
};

function terrainCompile(sh) {
  Object.assign(sh.uniforms, HAZE_UNIFORMS, TERRAIN_UNIFORMS);
  sh.vertexShader = `attribute float water;
    varying float vWater; varying vec3 vWP; varying float vNy;
    ` + HAZE_PARS_VS + '\n' + sh.vertexShader
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vWater = water; vWP = (modelMatrix * vec4(position, 1.0)).xyz; vNy = objectNormal.y;')
    .replace('#include <project_vertex>', CURVE_PROJECT + `
  vHaze = hazeAt(transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition);`);
  sh.fragmentShader = `uniform float uRelief; uniform float uAlbedo; uniform float uExposure; uniform sampler2D uDetail; uniform sampler2D uWaterN; uniform float uTime;
    varying float vWater; varying vec3 vWP; varying vec4 vHaze; varying float vNy;
    ` + HAZE_PARS_FS.replace('varying vec4 vHaze;', '') + '\n' + sh.fragmentShader
    .replace('#include <map_fragment>', `#include <map_fragment>
    diffuseColor.rgb *= uAlbedo * uExposure;
    {
      // Yakın ayrıntı (yalnızca yakında; ORTALAMAYI KORUYAN ton çarpanı: uzaktan görüntü rengi aynen
      // kalır). Görüntü 10 m çözünürlüklüdür; bu katman gerçek ayrıntı ÜRETMEZ, yalnızca pikselin
      // içindeki düzgün boyamayı kırar. Karakter görüntü renginden türetilir: yeşil pikseller
      // (maki/çam) öbekli koyu-açık lekeler, çıplak ve eğimli pikseller kaya çatlağı + ince tane.
      float camD = length(vWP - cameraPosition);
      float nf = (1.0 - smoothstep(150.0, 1800.0, camD)) * (1.0 - vWater);
      if (nf > 0.0) {
        vec2 p = vWP.xz;
        vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * p;            // döndürülmüş eksen: karo tekrarı kırılır
        vec3 alb = diffuseColor.rgb;
        float green = smoothstep(0.004, 0.03, alb.g - 0.5 * (alb.r + alb.b));
        vec3 fn = normalize(cross(dFdx(vWP), dFdy(vWP)));
        float slope = smoothstep(0.08, 0.45, 1.0 - abs(fn.y));
        // Doku 512 piksel/tekrar: B 3, G 8, R 16 kafes hücresi -> ölçek = tekrar boyu / hücre sayısı
        float m0 = texture2D(uDetail, p * 0.0042).b;        // ~80 m: ton dalgalanması
        float d1 = texture2D(uDetail, pr * 0.0065).r;       // ~10 m öbekler
        float d2 = texture2D(uDetail, p * 0.021 + 0.37).g;  // ~6 m, sırtlı (kaya hattı)
        float clump = smoothstep(0.40, 0.66, d1 * 0.65 + d2 * 0.35);
        float mVeg = 1.16 - 0.32 * clump;                   // öbek: koyu taç lekeleri (ortalama ~1)
        float mBare = 0.82 + 0.36 * mix(d1 * 0.5 + d2 * 0.5, d2, slope);
        float mm = mix(mBare, mVeg, green) * (0.92 + 0.16 * m0);
        float nf2 = 1.0 - smoothstep(80.0, 450.0, camD);
        if (nf2 > 0.0) {
          float d3 = texture2D(uDetail, pr * 0.026 + 0.11).r;  // ~2,4 m
          float d4 = texture2D(uDetail, p * 0.071 + 0.53).g;   // ~0,9 m tane
          mm *= mix(1.0, (0.88 + 0.24 * d3) * (0.94 + 0.12 * d4), nf2);
        }
        diffuseColor.rgb *= mix(1.0, mm, nf);
      }
    }`)
    // Kabartma: görüntü güneşin gerçek konumunda çekildi ve gölgelemeyi zaten içerir. Doğrudan
    // ışık düz zemin referansına göre yalnızca uRelief oranında değişir (gölge haritası korunur).
    .replace('#include <lights_lambert_pars_fragment>', `
    float reliefDot(vec3 n, vec3 l) {
      float flatNL = saturate(dot(normalize(mat3(viewMatrix)[1]), l));
      return mix(flatNL, saturate(dot(n, l)), uRelief);
    }
    ` + LAMBERT_RELIEF)
    .replace('#include <tonemapping_fragment>', `
    {
      // Su: Fresnel gök yansıması + güneş parıltısı (dalga normal haritası, iki ölçek, akan)
      // Yansıma payı: su bayrağı × düzlük. Deniz yüzeyi düzdür; bayrağın kısmi olduğu eğimli
      // hücrelerde (görüntü-DEM kıyı uyumsuzluğu, gölgede NDWI) karada gök yansıması çizilmez.
      // Köşe normali kullanılır (düğüm dikişindeki dikey etekler kenar normalini taşır: düz sayılır).
      float wK = vWater * smoothstep(0.94, 0.99, vNy);
      if (wK > 0.01) {
        vec3 V = normalize(cameraPosition - vWP);
        vec2 p = vWP.xz;
        // Dalga normali: iki ölçek; genlik mesafeyle ve bakış yüksekliğiyle hızla söner. Yükseklerden
        // tek tek dalga görünmez: ince ölçekli normal karo deseni (24-80 m) orada parıltılı gürültü
        // olurdu. Uzakta yansıma pürüzsüz yüzeyin gök gradyanıdır; parıltı geniş bir güneş lekesidir.
        float camD = length(vWP - cameraPosition);
        float waveK = 0.16 * (1.0 - smoothstep(300.0, 2500.0, camD));
        vec3 n1 = texture2D(uWaterN, p * 0.0125 + vec2(uTime * 0.011, uTime * 0.007)).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D(uWaterN, p * 0.041 - vec2(uTime * 0.017, -uTime * 0.013)).xyz * 2.0 - 1.0;
        vec3 N = normalize(vec3((n1.x + n2.x) * waveK, 1.0, (n1.y + n2.y) * waveK));
        float NdV = max(dot(N, V), 0.02);
        float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
        vec3 R = reflect(-V, N); R.y = abs(R.y);
        vec3 sky = skyColor(normalize(R), hzSunDir, hzZenith, hzHorizon, hzGround, hzSunColor, 0.0);
        vec3 H = normalize(V + hzSunDir);
        // Parıltı keskinliği mesafeyle azalır (uzakta dalga eğimlerinin dağılımı: geniş, sönük leke)
        float shin = mix(420.0, 70.0, smoothstep(500.0, 15000.0, camD));
        float spec = pow(max(dot(N, H), 0.0), shin) * mix(30.0, 1.6, smoothstep(500.0, 15000.0, camD));
        vec3 wcol = gl_FragColor.rgb * (1.0 - F) + sky * F * 0.85 + hzSunColor * spec * step(0.0, hzSunDir.y);
        gl_FragColor.rgb = mix(gl_FragColor.rgb, wcol, wK);
      }
    }
    gl_FragColor.rgb = hazeMix(gl_FragColor.rgb, vHaze);
    #include <tonemapping_fragment>`)
    .replace('#include <fog_fragment>', '');
}
// Lambert doğrudan ışığı: kabartma dengeli nokta çarpımı (include'lar onBeforeCompile'da henüz
// açılmamıştır; bu yüzden parça açılmış hâliyle değiştirilir)
const LAMBERT_RELIEF = THREE.ShaderChunk.lights_lambert_pars_fragment.replace(
  'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
  'float dotNL = reliefDot( geometryNormal, directLight.direction );');
if (LAMBERT_RELIEF === THREE.ShaderChunk.lights_lambert_pars_fragment) console.warn('geoterrain: Lambert chunk changed; relief lighting disabled');

/** Düğüm malzemesi: hepsi aynı programı paylaşır (aynı önbellek anahtarı), yalnızca map farklıdır. */
function makeTerrainMaterial(map) {
  const m = new THREE.MeshLambertMaterial({ map });
  m.onBeforeCompile = terrainCompile;
  m.customProgramCacheKey = () => 'geoterrain4';
  m.userData.hazed = true;
  return m;
}

// ---------------------------------------------------------------------------------------------
// Dörtlü ağaç düğümü
// ---------------------------------------------------------------------------------------------
class Node {
  constructor(t, z, x, y, parent) {
    this.t = t; this.z = z; this.x = x; this.y = y; this.parent = parent;
    this.key = z * 1e8 + x * 1e4 + y;
    this.children = null;
    this.mesh = null; this.built = false; this.dirty = false; this.building = false;
    this.demLevel = -1; this.imgKey = -1;
    // Coğrafi kapsam -> yerel köşeler (sınır kutusu ve boyut için)
    const f = t.frame, c = [];
    for (const [i, j] of [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]]) {
      c.push(f.toLocal(tileYToLat(y + j, z), tileXToLon(x + i, z)));
    }
    this.cx = c[4].x; this.cz = c[4].z;
    this.minX = Math.min(c[0].x, c[2].x); this.maxX = Math.max(c[1].x, c[3].x);
    this.minZ = Math.min(c[0].z, c[1].z); this.maxZ = Math.max(c[2].z, c[3].z);
    this.size = Math.max(this.maxX - this.minX, this.maxZ - this.minZ);
    this.minY = MSL_Y - 30; this.maxY = MSL_Y + 2500;
    const B = t.bounds;
    this.lon0 = tileXToLon(x, z); this.lon1 = tileXToLon(x + 1, z);
    this.lat1 = tileYToLat(y, z); this.lat0 = tileYToLat(y + 1, z);
    this.inCore = this.lon1 > B.core[0] && this.lon0 < B.core[2] && this.lat1 > B.core[1] && this.lat0 < B.core[3];
    this.inOuter = this.lon1 > B.outer[0] && this.lon0 < B.outer[2] && this.lat1 > B.outer[1] && this.lat0 < B.outer[3];
    this.lastSeen = 0;
  }
  get maxDepth() { return this.inCore ? this.t.maxZ : this.t.maxZOuter; }
}

// ---------------------------------------------------------------------------------------------
// GeoTerrain
// ---------------------------------------------------------------------------------------------
export class GeoTerrain {
  /**
   * @param {object} o
   *   frame: LocalFrame, manifest, base (URL öneki, '/' ile biter), group (THREE.Group),
   *   segments (düğüm ızgarası: 16 / 32 / 48), lodFactor, anisotropy, textureBudget, nodeBudget,
   *   detailTex, waterNormalTex, conform(x, z, hMsl) => hMsl (havaalanı düzleştirmesi),
   *   fetch / decodeRGBA / clock (testler için)
   */
  constructor(o) {
    this.o = o;
    this.frame = o.frame;
    this.man = o.manifest;
    this.bounds = this.man.bounds;
    this.dem = new DemStore(this.man, o.base, o);
    this.img = new ImageryStore(this.man, o.base, o);
    this.N = o.segments || 32;
    // Çarpan 32'lik ızgaraya göre tanımlıdır: N büyüdükçe düğüm başına köşe artar, aynı ekran
    // yoğunluğu için bölme uzaklığı N/32 oranında küçülür (64'lük ızgarada ~1/4 düğüm = çizim çağrısı)
    this.lodFactor = (o.lodFactor || 2.6) * 32 / this.N;
    this.detail = 1;       // uyarlanabilir kalite çarpanı (perf.js 'detail')
    this.nodeBudget = o.nodeBudget || 260;
    this.buildMs = o.buildMs || 3.0;
    this.conform = o.conform || null;
    this.group = o.group || null;
    // En ince düğüm seviyesi: köşe aralığı = en ince DEM pikseli (z12 için 30 m)
    this.demFine = this.dem.levels[0];
    this.demCoarse = this.dem.levels[this.dem.levels.length - 1];
    this.maxZ = this.demFine + 8 - Math.round(Math.log2(this.N));
    this.maxZOuter = Math.min(this.maxZ, this.demCoarse + 3);
    this.rootZ = 7;
    this.nodes = new Map();
    this.roots = [];
    this.pool = [];
    this.demBudget = o.demBudget || 64;      // bellekte tutulan ince DEM karosu (~320 KB/karo)
    this._aheadT = 0;
    if (this.group) this.initRender();
    // Kök düğümler: dış sınırları örten z7 karoları
    const ob = this.bounds.outer, z = this.rootZ;
    const x0 = Math.floor(lonToTileX(ob[0], z)), x1 = Math.floor(lonToTileX(ob[2], z));
    const y0 = Math.floor(latToTileY(ob[3], z)), y1 = Math.floor(latToTileY(ob[1], z));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.roots.push(this.node(z, x, y, null));
    this.dem.onTile = (t) => this.onDemTile(t);
    this.img.onTile = (t) => this.onImgTile(t);
    this._g = { lat: 0, lon: 0 };
    this._l = { x: 0, z: 0 };
    this.frustum = new THREE.Frustum(); this._pm = new THREE.Matrix4(); this._box = new THREE.Box3();
    this.stats = { nodes: 0, drawn: 0, built: 0, demTiles: 0, imgTiles: 0 };
  }

  node(z, x, y, parent) {
    const k = z * 1e8 + x * 1e4 + y;
    let n = this.nodes.get(k);
    if (!n) { n = new Node(this, z, x, y, parent); this.nodes.set(k, n); }
    return n;
  }

  // ---- Başlatma / ön yükleme ------------------------------------------------------------------
  /** Tüm kaba DEM'i ve kaba görüntüyü yükler (bölge geneli, ~2 MB). */
  async loadCoarse(onProgress) {
    const jobs = [];
    const r = this.dem.range[this.demCoarse];
    for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) jobs.push(this.dem.request(this.demCoarse, x, y, -10));
    let done = 0;
    await Promise.all(jobs.map((p) => p.then(() => { done++; if (onProgress) onProgress(done / jobs.length); })));
    // Kaba görüntü (z8) kökler için; ayrıca ilk karede siyah düğüm olmasın
    const zi = Math.min(...Object.keys(this.img.range).map(Number));
    const ri = this.img.range[zi];
    for (let y = ri.y0; y <= ri.y1; y++) for (let x = ri.x0; x <= ri.x1; x++) this.img.request(zi, x, y, -10);
  }

  /** (x, z) çevresinde r metre içindeki ince DEM karolarını yükler (kalkış için bekle). */
  ensureArea(x, z, r, onProgress) {
    const f = this.frame, d = this.demFine, g = this._g;
    const pts = [[x - r, z - r], [x + r, z - r], [x - r, z + r], [x + r, z + r]];
    let tx0 = Infinity, tx1 = -Infinity, ty0 = Infinity, ty1 = -Infinity;
    for (const [px, pz] of pts) {
      f.toGeo(px, pz, g);
      const tx = lonToTileX(g.lon, d), ty = latToTileY(g.lat, d);
      tx0 = Math.min(tx0, tx); tx1 = Math.max(tx1, tx); ty0 = Math.min(ty0, ty); ty1 = Math.max(ty1, ty);
    }
    const jobs = [];
    for (let ty = Math.floor(ty0) - 1; ty <= Math.floor(ty1) + 1; ty++) {
      for (let tx = Math.floor(tx0) - 1; tx <= Math.floor(tx1) + 1; tx++) {
        const p = this.dem.request(d, tx, ty, -5);
        if (p) jobs.push(p);
      }
    }
    let done = 0;
    return Promise.all(jobs.map((p) => p.then(() => { done++; if (onProgress) onProgress(done / jobs.length); })));
  }

  /** (x, z) çevresinde r metre içindeki en ince görüntü karolarını ve iki üst seviyeyi önceden yükler. */
  prefetchImagery(x, z, r, onProgress) {
    const f = this.frame, g = this._g, jobs = [];
    const zMax = this.img.maxZ;
    for (let zi = zMax; zi >= zMax - 2; zi--) {
      let tx0 = Infinity, tx1 = -Infinity, ty0 = Infinity, ty1 = -Infinity;
      for (const [px, pz] of [[x - r, z - r], [x + r, z + r]]) {
        f.toGeo(px, pz, g);
        const tx = lonToTileX(g.lon, zi), ty = latToTileY(g.lat, zi);
        tx0 = Math.min(tx0, tx); tx1 = Math.max(tx1, tx); ty0 = Math.min(ty0, ty); ty1 = Math.max(ty1, ty);
      }
      for (let ty = Math.floor(ty0); ty <= Math.floor(ty1); ty++) for (let tx = Math.floor(tx0); tx <= Math.floor(tx1); tx++) {
        const p = this.img.request(zi, tx, ty, -4 + (zMax - zi));
        if (p) jobs.push(p);
      }
    }
    let done = 0;
    return Promise.all(jobs.map((p) => p.then(() => { done++; if (onProgress) onProgress(done / jobs.length); })));
  }

  // ---- Yüzey sorgusu (fizik) --------------------------------------------------------------------
  /** Köşe ızgarası değeri (seviye d, global köşe indisleri). Veri yoksa NaN. */
  cornerH(d, ix, iy) {
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const p = this.dem.pixelTile(d, ix - 1 + (k & 1), iy - 1 + (k >> 1));
      if (!p) return NaN;
      s += p.t.h[p.i];
    }
    return s * 0.25;
  }
  cornerW(d, ix, iy) {
    let s = 0;
    for (let k = 0; k < 4; k++) {
      const p = this.dem.pixelTile(d, ix - 1 + (k & 1), iy - 1 + (k >> 1));
      if (!p) return 0;
      s += p.t.w[p.i];
    }
    return s * 0.25;
  }
  /** Köşe değeri: yükseklik ve su payı birlikte (_cw'ye yazılır). Veri yoksa NaN. */
  cornerHW(d, ix, iy) {
    let s = 0, w = 0;
    for (let k = 0; k < 4; k++) {
      const p = this.dem.pixelTile(d, ix - 1 + (k & 1), iy - 1 + (k >> 1));
      if (!p) { this._cw = 1; return NaN; }
      s += p.t.h[p.i]; w += p.t.w[p.i];
    }
    this._cw = w * 0.25;
    return s * 0.25;
  }
  /** Kanonik yüzey (MSL, m): seviye d köşe ızgarasında üçgen ara değer. gx, gy: global köşe koordinatı. */
  surfaceAtLevel(d, gx, gy, wantWater = false) {
    const i = Math.floor(gx), j = Math.floor(gy), u = gx - i, v = gy - j;
    // Köşenin tam üstü (düğüm köşeleri çoğunlukla buraya düşer): tek köşe değeri
    if (u === 0 && v === 0) { const h = this.cornerHW(d, i, j); return wantWater ? this._cw : h; }
    // köşegen (i, j+1)–(i+1, j): u + v <= 1 -> (a, b, dd) üçgeni
    if (u + v <= 1) {
      const a = this.cornerH(d, i, j), b = this.cornerH(d, i, j + 1), c = this.cornerH(d, i + 1, j);
      if (wantWater) return this.cornerW(d, i, j) * (1 - u - v) + this.cornerW(d, i + 1, j) * u + this.cornerW(d, i, j + 1) * v;
      return a + u * (c - a) + v * (b - a);
    }
    const b = this.cornerH(d, i, j + 1), c = this.cornerH(d, i + 1, j), e = this.cornerH(d, i + 1, j + 1);
    if (wantWater) return this.cornerW(d, i + 1, j + 1) * (u + v - 1) + this.cornerW(d, i, j + 1) * (1 - u) + this.cornerW(d, i + 1, j) * (1 - v);
    return e + (1 - u) * (b - e) + (1 - v) * (c - e);
  }
  /** Ham arazi MSL yüksekliği (havaalanı düzleştirmesi hariç), enlem/boylamdan. */
  rawMslGeo(lat, lon) {
    const levels = this.dem.levels;
    for (let li = 0; li < levels.length; li++) {
      const d = levels[li];
      const gx = lonToTileX(lon, d) * TILE, gy = latToTileY(lat, d) * TILE;
      const r = this.dem.range[d];
      if (gx < r.x0 * TILE || gx >= (r.x1 + 1) * TILE || gy < r.y0 * TILE || gy >= (r.y1 + 1) * TILE) continue;
      const h = this.surfaceAtLevel(d, gx, gy);
      if (Number.isNaN(h)) continue;
      // Işınlanma önlemi: yeni yüklenen ince karo kaba değerden yumuşakça devralır
      if (li < levels.length - 1) {
        const p = this.dem.pixelTile(d, Math.floor(gx), Math.floor(gy));
        const age = p ? this.dem.clock() - p.t.t0 : BLEND_S;
        if (age < BLEND_S) {
          const hc = this.rawMslGeo2(levels[li + 1], lat, lon);
          if (!Number.isNaN(hc)) { const k = age / BLEND_S; return hc + (h - hc) * k * k * (3 - 2 * k); }
        }
      }
      return h;
    }
    return 0;   // veri yok: deniz
  }
  rawMslGeo2(d, lat, lon) {
    return this.surfaceAtLevel(d, lonToTileX(lon, d) * TILE, latToTileY(lat, d) * TILE);
  }
  /** Fizik yüksekliği: yerel (x, z) -> MSL (m), havaalanı düzleştirmesi dahil. */
  mslAt(x, z) {
    const g = this.frame.toGeo(x, z, this._g);
    const h = this.rawMslGeo(g.lat, g.lon);
    return this.conform ? this.conform(x, z, h) : h;
  }
  /**
   * Hızlı yol (3B nesneler): ince DEM seviyesinin köşe koordinatı (gx, gy) ve aynı noktanın yerel
   * (x, z)'si zaten biliniyorsa ters TM atlanır. İnce karo yüklü değilse NaN (çağıran bekler).
   */
  mslAtFine(gx, gy, x, z) {
    const h = this.surfaceAtLevel(this.demFine, gx, gy);
    if (Number.isNaN(h)) return NaN;
    return this.conform ? this.conform(x, z, h) : h;
  }
  /** İnce DEM karosu (z12 x, y) ve komşuları hazır mı; değilse iste. */
  fineReady(tx, ty) {
    let ok = true;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx, y = ty + dy, d = this.demFine;
      if (!this.dem.inRange(d, x, y)) continue;
      const t = this.dem.get(d, x, y);
      if (!t) { this.dem.request(d, x, y, 0); ok = false; } else if (!t.ready && !t.failed) ok = false;
    }
    return ok;
  }

  /** Su payı 0..1 (en ince yüklü seviye). */
  waterAt(x, z) {
    const g = this.frame.toGeo(x, z, this._g);
    for (const d of this.dem.levels) {
      const gx = lonToTileX(g.lon, d) * TILE, gy = latToTileY(g.lat, d) * TILE;
      // Seviyenin kapsamı dışında bir sonraki (kaba) seviyeye geç: pixelTile kenar pikseline
      // sıkıştırır; eskiden ince seviyenin kenar değeri kapsam dışına taşınıyordu.
      const r = this.dem.range[d];
      if (gx < r.x0 * TILE || gx >= (r.x1 + 1) * TILE || gy < r.y0 * TILE || gy >= (r.y1 + 1) * TILE) continue;
      const p = this.dem.pixelTile(d, Math.floor(gx), Math.floor(gy));
      if (!p) continue;
      return this.surfaceAtLevel(d, gx, gy, true);
    }
    return 1;
  }

  // ---- Çizim ----------------------------------------------------------------------------------
  initRender() {
    const N = this.N, n1 = N + 1;
    // Paylaşılan indeks ve UV (köşe sırası: ızgara (N+1)², ardından etek halkası 4N)
    const idx = [];
    const v = (i, j) => j * n1 + i;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = v(i, j), b = v(i, j + 1), c = v(i + 1, j + 1), d = v(i + 1, j);
      idx.push(a, b, d, b, c, d);      // köşegen b–d = (i, j+1)–(i+1, j): kanonik yüzeyle aynı
    }
    // Etek: çevre köşeleri sırayla (saat yönü tersine), her birinin altında bir kopya
    const ring = [];
    for (let i = 0; i < N; i++) ring.push([i, 0]);
    for (let j = 0; j < N; j++) ring.push([N, j]);
    for (let i = N; i > 0; i--) ring.push([i, N]);
    for (let j = N; j > 0; j--) ring.push([0, j]);
    this.ring = ring;
    const base = n1 * n1, R = ring.length;
    for (let k = 0; k < R; k++) {
      const a = v(ring[k][0], ring[k][1]), b = v(ring[(k + 1) % R][0], ring[(k + 1) % R][1]);
      const a2 = base + k, b2 = base + (k + 1) % R;
      // İki yönlü: etek hangi yandan görülürse görülsün LOD çatlağını örter (arka yüz kırpılmaz)
      idx.push(a, a2, b, b, a2, b2, a, b, a2, b, b2, a2);
    }
    const vcount = base + R;
    this.index = new THREE.BufferAttribute(vcount > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1);
    const uv = new Float32Array(vcount * 2);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { uv[(j * n1 + i) * 2] = i / N; uv[(j * n1 + i) * 2 + 1] = j / N; }
    for (let k = 0; k < R; k++) { uv[(base + k) * 2] = ring[k][0] / N; uv[(base + k) * 2 + 1] = ring[k][1] / N; }
    this.uv = new THREE.BufferAttribute(uv, 2);
    this.vcount = vcount;
    // Yedek doku (görüntü yoksa): nötr kurak toprak
    const blank = new THREE.DataTexture(new Uint8Array([110, 104, 88, 255]), 1, 1);
    blank.colorSpace = THREE.SRGBColorSpace; blank.needsUpdate = true;
    this.blank = blank;
    TERRAIN_UNIFORMS.uDetail.value = this.o.detailTex || blank;
    TERRAIN_UNIFORMS.uWaterN.value = this.o.waterNormalTex || blank;
    // Ara diziler (her inşada yeniden kullanılır)
    const E = N + 3;
    this._ex = new Float64Array(E * E); this._ez = new Float64Array(E * E); this._eh = new Float64Array(E * E); this._ew = new Float32Array(E * E);
    this._sub = 8;
    this._sx = new Float64Array((this._sub + 1) ** 2); this._sz = new Float64Array((this._sub + 1) ** 2);
  }

  /** Düğüm için kullanılacak DEM seviyesi (köşe aralığına en yakın, yüklüyse ince). */
  demLevelFor(n) {
    const want = n.z - 8 + Math.round(Math.log2(this.N));
    if (want >= this.demFine - 2 && n.inCore) return this.demFine;
    return this.demCoarse;
  }

  /** İnce DEM karoları (düğümün kapsadığı + kenar komşuları) hazır mı; değilse iste. */
  demReady(n, d, pri) {
    if (d === this.demCoarse) return true;
    const s = n.z - d;
    let x0, x1, y0, y1;
    if (s >= 0) { x0 = x1 = n.x >> s; y0 = y1 = n.y >> s; } else { x0 = n.x << -s; x1 = x0 + (1 << -s) - 1; y0 = n.y << -s; y1 = y0 + (1 << -s) - 1; }
    let ok = true;
    // Kenarda komşu karo da gerekir (köşe değeri iki karodan piksel alır)
    for (let ty = y0 - 1; ty <= y1 + 1; ty++) for (let tx = x0 - 1; tx <= x1 + 1; tx++) {
      if (!this.dem.inRange(d, tx, ty)) continue;
      const edge = tx < x0 || tx > x1 || ty < y0 || ty > y1;
      const t = this.dem.get(d, tx, ty);
      if (!t) { this.dem.request(d, tx, ty, pri + (edge ? 1 : 0)); ok = false; }
      else if (!t.ready && !t.failed) ok = false;
    }
    return ok;
  }

  buildNode(n) {
    const N = this.N, E = N + 3, f = this.frame, z = n.z;
    const d = this.demLevelFor(n) === this.demFine && this.demReady(n, this.demFine, 0) ? this.demFine : this.demCoarse;
    // 1) Yerel konumlar: 9x9 kesin TM alt ızgarası + çift doğrusal ara değer (genişletilmiş ızgara)
    const S = this._sub, sx = this._sx, sz = this._sz, l = this._l;
    for (let b = 0; b <= S; b++) for (let a = 0; a <= S; a++) {
      f.toLocal(tileYToLat(n.y + b / S, z), tileXToLon(n.x + a / S, z), l);
      sx[b * (S + 1) + a] = l.x; sz[b * (S + 1) + a] = l.z;
    }
    const ex = this._ex, ez = this._ez, eh = this._eh, ew = this._ew;
    const sc = TILE * Math.pow(2, d - z) / N, rd = this.dem.range[d];
    const gxMin = rd.x0 * TILE, gxMax = (rd.x1 + 1) * TILE, gyMin = rd.y0 * TILE, gyMax = (rd.y1 + 1) * TILE;
    const gx0 = n.x * TILE * Math.pow(2, d - z), gy0 = n.y * TILE * Math.pow(2, d - z);
    const conform = this.conform;
    let minY = Infinity, maxY = -Infinity, fallback = 0;
    const B = this.bounds.outer;
    const lonCol = this._lonCol || (this._lonCol = new Float64Array(E));
    for (let ii = 0; ii < E; ii++) lonCol[ii] = tileXToLon(n.x + (ii - 1) / N, z);
    for (let jj = 0; jj < E; jj++) {
      const j = jj - 1;
      const latRow = tileYToLat(n.y + j / N, z);
      const fb = Math.min(Math.max(j / N * S, 0), S - 1e-9), b0 = Math.min(Math.floor(fb), S - 1), tb = j / N * S - b0;
      for (let ii = 0; ii < E; ii++) {
        const i = ii - 1;
        const fa = Math.min(Math.max(i / N * S, 0), S - 1e-9), a0 = Math.min(Math.floor(fa), S - 1), ta = i / N * S - a0;
        const q = b0 * (S + 1) + a0;
        const X = (sx[q] * (1 - ta) + sx[q + 1] * ta) * (1 - tb) + (sx[q + S + 1] * (1 - ta) + sx[q + S + 2] * ta) * tb;
        const Z = (sz[q] * (1 - ta) + sz[q + 1] * ta) * (1 - tb) + (sz[q + S + 1] * (1 - ta) + sz[q + S + 2] * ta) * tb;
        const e = jj * E + ii;
        ex[e] = X; ez[e] = Z;
        // 2) Yükseklik: kanonik yüzey (seviye d), ince seviye eksikse kaba
        const gx = gx0 + i * sc, gy = gy0 + j * sc;
        const cov = gx >= gxMin && gx <= gxMax && gy >= gyMin && gy <= gyMax;
        let h = NaN, w = 1;
        if (cov) {
          if (gx === Math.floor(gx) && gy === Math.floor(gy)) { h = this.cornerHW(d, gx, gy); w = this._cw; }
          else { h = this.surfaceAtLevel(d, gx, gy); w = this.surfaceAtLevel(d, gx, gy, true); }
        }
        if (Number.isNaN(h) && d !== this.demCoarse) {
          fallback++;
          const s2 = Math.pow(2, this.demCoarse - d);
          h = this.surfaceAtLevel(this.demCoarse, gx * s2, gy * s2); w = this.surfaceAtLevel(this.demCoarse, gx * s2, gy * s2, true);
        }
        if (Number.isNaN(h)) { h = 0; w = 1; }
        // Bölge dışı: denize batar (dış halka deniz yüzeyi örter)
        const lon = this._lonCol[ii], lat = latRow;
        if (lon < B[0] || lon > B[2] || lat < B[1] || lat > B[3]) { h = -40; w = 1; }
        else if (conform) h = conform(X, Z, h);
        eh[e] = h + MSL_Y; ew[e] = w;
        if (i >= 0 && i <= N && j >= 0 && j <= N) { if (eh[e] < minY) minY = eh[e]; if (eh[e] > maxY) maxY = eh[e]; }
      }
    }
    // 3) Köşe öznitelikleri (düğüm merkezine göre)
    const ox = n.cx, oz = n.cz, oy = Math.round((minY + maxY) * 0.5);
    const n1 = N + 1;
    // Örgü havuzu: bırakılan düğümlerin örgüsü (geometri + malzeme) yeniden kullanılır; akış
    // sırasında çöp toplama ve GPU tampon tahsisi oluşmaz (veri bufferSubData ile güncellenir)
    if (!n.mesh) {
      const mesh = this.pool.pop() || this.newMesh();
      mesh.visible = false;
      n.mesh = mesh;
      this.group.add(mesh);
    }
    const geo = n.mesh.geometry;
    const pos = geo.attributes.position.array, nor = geo.attributes.normal.array, wat = geo.attributes.water.array;
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const e = (j + 1) * E + (i + 1), o = j * n1 + i;
      pos[o * 3] = ex[e] - ox; pos[o * 3 + 1] = eh[e] - oy; pos[o * 3 + 2] = ez[e] - oz;
      // normal: merkezi farklar (komşu düğümle aynı örnekler -> dikişsiz gölgeleme)
      const ax = ex[e + 1] - ex[e - 1], ay = eh[e + 1] - eh[e - 1], az = ez[e + 1] - ez[e - 1];
      const bx = ex[e + E] - ex[e - E], by = eh[e + E] - eh[e - E], bz = ez[e + E] - ez[e - E];
      // n = b x a  (b: +j güney, a: +i doğu -> yukarı)
      let nx = by * az - bz * ay, ny = bz * ax - bx * az, nz = bx * ay - by * ax;
      const L = Math.hypot(nx, ny, nz) || 1;
      nor[o * 3] = nx / L; nor[o * 3 + 1] = ny / L; nor[o * 3 + 2] = nz / L;
      wat[o] = Math.round(Math.min(1, Math.max(0, ew[e])) * 255);
    }
    // Etek: çevre köşeleri düğüm boyutu VE yerel kabartmayla orantılı aşağı. Dik sırtlarda kaba
    // komşunun kenarı ince yüzeyden onlarca metre sapar; sığ etek orada gök görünen çatlak bırakırdı.
    const skirt = Math.max(6, n.size * 0.03 + (maxY - minY) * 0.2), R = this.ring.length;
    for (let r = 0; r < R; r++) {
      const [i, j] = this.ring[r], s = j * n1 + i, o = n1 * n1 + r;
      pos[o * 3] = pos[s * 3]; pos[o * 3 + 1] = pos[s * 3 + 1] - skirt; pos[o * 3 + 2] = pos[s * 3 + 2];
      nor[o * 3] = nor[s * 3]; nor[o * 3 + 1] = nor[s * 3 + 1]; nor[o * 3 + 2] = nor[s * 3 + 2];
      wat[o] = wat[s];
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.normal.needsUpdate = true; geo.attributes.water.needsUpdate = true;
    n.mesh.position.set(ox, oy, oz); n.mesh.updateMatrix();
    geo.boundingSphere = null;
    n.minY = minY - skirt; n.maxY = maxY;
    // partial: ince seviyede kurulduğu hâlde kenar köşelerinin bir kısmı (komşu karo yüklü değildi)
    // kaba veriden geldi; komşu karo gelince yeniden kurulur
    n.demLevel = d; n.partial = d === this.demFine && fallback > 0; n.built = true; n.dirty = false;
    this.applyImagery(n);
    this.stats.built++;
  }

  newMesh() {
    const vc = this.vcount, geo = new THREE.BufferGeometry();
    geo.setIndex(this.index);
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
    geo.setAttribute('uv', this.uv);
    geo.setAttribute('water', new THREE.BufferAttribute(new Uint8Array(vc), 1, true));
    const mesh = new THREE.Mesh(geo, makeTerrainMaterial(this.blank));
    mesh.frustumCulled = false; mesh.receiveShadow = true; mesh.castShadow = false;
    mesh.matrixAutoUpdate = false; mesh.visible = false;
    mesh.name = 'terrain-node';
    return mesh;
  }

  /** Düğümün görüntüsü: kendi seviyesindeki karo ya da yüklü en yakın ata (alt dikdörtgen). */
  applyImagery(n) {
    if (!n.mesh) return;
    let requested = false;
    for (let zi = Math.min(n.z, this.img.maxZ); zi >= 0; zi--) {
      const s = n.z - zi, x = n.x >> s, y = n.y >> s;
      if (!this.img.inRange(zi, x, y)) continue;
      const t = this.img.get(zi, x, y);
      if (!requested) { requested = true; if (!t) this.img.request(zi, x, y, this.priority(n)); }
      if (!t || !t.ready) continue;
      const key = t.z * 1e8 + t.x * 1e4 + t.y;
      if (n.imgKey === key) return;
      const m = n.mesh.material;
      this.releaseImagery(n);
      // Klon aynı kaynağı (Source) paylaşır: GPU'ya bir kez yüklenir; klonun dispose'u yalnızca
      // kullanım sayacını düşürür, son kullanıcı bırakınca GL dokusu silinir.
      const tex = t.tex.clone();
      const k = 1 << s;
      tex.repeat.set(1 / k, 1 / k);
      tex.offset.set((n.x - (x << s)) / k, (n.y - (y << s)) / k);
      tex.updateMatrix();
      m.map = tex;
      t.refs++; n.imgTile = t; n.imgKey = key; n.tex = tex;
      return;
    }
  }
  releaseImagery(n) {
    if (n.tex) { n.tex.dispose(); n.tex = null; }
    if (n.imgTile) { n.imgTile.refs--; n.imgTile = null; }
    n.imgKey = -1;
    if (n.mesh) n.mesh.material.map = this.blank;
  }

  onDemTile(t) {
    this.stats.demTiles++;
    // Bu karoyu kullanabilecek yapılı düğümleri yeniden inşa et
    // Yeniden inşa yalnızca gerekirse: kaba veriyle kurulmuş ve bu karonun içinde olan düğümler,
    // ya da ince kurulup kenarında bu (komşu) karonun eksikliği yüzünden kaba veri kullanan düğümler
    for (const n of this.nodes.values()) {
      if (!n.built || this.demLevelFor(n) !== this.demFine) continue;
      const s = n.z - t.z;
      if (s < 0) continue;
      const tx = n.x >> s, ty = n.y >> s;
      if (n.demLevel !== this.demFine ? (tx === t.x && ty === t.y) : (n.partial && Math.abs(tx - t.x) <= 1 && Math.abs(ty - t.y) <= 1)) n.dirty = true;
    }
  }
  onImgTile(t) {
    this.stats.imgTiles++;
    for (const n of this.nodes.values()) {
      if (!n.built || n.z < t.z) continue;
      const s = n.z - t.z;
      if ((n.x >> s) === t.x && (n.y >> s) === t.y) this.applyImagery(n);
    }
  }

  priority(n) {
    const c = this._cam;
    if (!c) return 0;
    return Math.hypot(n.cx - c.x, n.cz - c.z) / Math.max(n.size, 1) - n.z * 0.01;
  }

  /** Görüş konisi testi; kutu dünya eğriliği kadar alçaltılır (uzak düğümler yanlışlıkla kırpılmaz). */
  inView(n, c) {
    const dx = n.cx - c.x, dz = n.cz - c.z;
    const drop = (dx * dx + dz * dz) * CURVE_K;
    const span = n.size * Math.hypot(dx, dz) * 2 * CURVE_K + 1;
    this._box.min.set(n.minX, n.minY - drop - span, n.minZ);
    this._box.max.set(n.maxX, n.maxY - drop + span, n.maxZ);
    return this.frustum.intersectsBox(this._box);
  }

  /** Kameradan düğüm kutusuna 3B mesafe. */
  dist(n, c) {
    const dx = Math.max(n.minX - c.x, 0, c.x - n.maxX);
    const dz = Math.max(n.minZ - c.z, 0, c.z - n.maxZ);
    const dy = Math.max(n.minY - c.y, 0, c.y - n.maxY);
    return Math.hypot(dx, dy, dz);
  }

  /**
   * Uçağın altındaki ve önündeki ince DEM karolarını ister (fizik zemini her zaman ince veridir;
   * 0,5 s'de bir). 7,8 km'lik z12 karoları: 3x3 komşuluk + hız yönünde 20 s ilerisi.
   */
  lookAhead(focus, vel) {
    const d = this.demFine, g = this._g, f = this.frame;
    const pts = [[focus.x, focus.z]];
    if (vel) pts.push([focus.x + vel.x * 20, focus.z + vel.z * 20]);
    for (const [x, z] of pts) {
      f.toGeo(x, z, g);
      const tx = Math.floor(lonToTileX(g.lon, d)), ty = Math.floor(latToTileY(g.lat, d));
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) this.dem.request(d, tx + dx, ty + dy, -2 + Math.abs(dx) + Math.abs(dy));
    }
  }

  /** İnce DEM bellek bütçesi: kameradan ve uçaktan en uzak karolar bırakılır (12 km içindekiler asla). */
  evictDem(c, focus) {
    const d = this.demFine, list = [];
    for (const t of this.dem.tiles.values()) if (t.z === d && t.ready) list.push(t);
    if (list.length <= this.demBudget) return;
    const g = this._g, f = this.frame;
    for (const t of list) {
      const lon = tileXToLon(t.x + 0.5, d), lat = tileYToLat(t.y + 0.5, d);
      const p = f.toLocal(lat, lon, this._l);
      t._d = Math.min(Math.hypot(p.x - c.x, p.z - c.z), focus ? Math.hypot(p.x - focus.x, p.z - focus.z) : Infinity);
    }
    list.sort((a, b) => b._d - a._d);
    for (const t of list) {
      if (list.length <= this.demBudget * 0.85 || t._d < 12000) break;
      this.dem.tiles.delete(this.dem.key(t.z, t.x, t.y));
      this.dem._lastK = -1;
      list.length--;
      // Kurulmuş örgüler yükseklikleri kopyaladığı için geçerli kalır; yeniden gerekirse karo yeniden istenir
    }
    void g;
  }

  /** Her karede: LOD seçimi, veri istekleri, bütçeli inşa, görünürlük. focus/vel: uçak (fizik). */
  update(camera, dt = 0, focus = null, vel = null) {
    const c = camera.position;
    this._aheadT -= dt;
    if (focus && this._aheadT <= 0) { this._aheadT = 0.5; this.lookAhead(focus, vel); this.evictDem(c, focus); }
    this._cam = c;
    TERRAIN_UNIFORMS.uTime.value += dt;
    // Kamera matrisi BU karenin pozundan: bir önceki çizimin matrisiyle kırpmak, hızlı dönüşte ya da
    // kamera kipi değişiminde ekran kenarında bir karelik delik bırakırdı
    camera.updateMatrixWorld();
    this._pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this._pm);
    const now = this.dem.clock();
    const sel = this._sel || (this._sel = []);
    sel.length = 0;
    const want = this._want || (this._want = []);
    want.length = 0;
    const K = this.lodFactor * this.detail;
    const visit = (n) => {
      if (!n.inOuter) return;
      n.lastSeen = now;
      const d = this.dist(n, c);
      // Görüş dışındaki düğümler daha kaba kalır (0,45 x çarpan): bellek ve inşa tasarrufu; kamera
      // dönünce yakın arazi yine makul ayrıntıdadır ve inşa bütçesiyle hızla incelir
      const k = this.inView(n, c) ? K : K * 0.45;
      if (n.z < n.maxDepth && d < n.size * k) {
        if (!n.children) {
          const z = n.z + 1, x = n.x * 2, y = n.y * 2;
          n.children = [this.node(z, x, y, n), this.node(z, x + 1, y, n), this.node(z, x, y + 1, n), this.node(z, x + 1, y + 1, n)];
        }
        let ready = true;
        // İstenen çocuklar "görüldü" sayılır: kardeşleri inşa edilirken erken inşa edilmiş olanlar
        // (henüz ziyaret edilmez) bütçe tahliyesinde silinip yeniden kurulmasın (kısır döngü)
        for (const ch of n.children) { ch.lastSeen = now; if (ch.inOuter && !ch.built) { ready = false; want.push(ch); } }
        if (ready) { for (const ch of n.children) visit(ch); return; }
      }
      if (!n.built) want.push(n);
      sel.push(n);
    };
    for (const r of this.roots) visit(r);
    // İnşa: önce kamerayı içeren / yakın düğümler; süre bütçesi
    for (const n of sel) if (n.built && n.dirty) want.push(n);
    want.sort((a, b) => this.priority(a) - this.priority(b));
    const t0 = performance.now();
    let built = 0;
    for (const n of want) {
      if (n.built && !n.dirty) continue;
      if (built > 0 && performance.now() - t0 > this.buildMs) break;
      const d = this.demLevelFor(n);
      if (d === this.demFine && !this.demReady(n, d, this.priority(n)) && n.built) continue;
      this.buildNode(n);
      built++;
    }
    // Görünürlük + manuel görüş konisi testi (eğrilik payıyla)
    for (const m of this.group.children) m.visible = false;
    let drawn = 0;
    for (const n of sel) {
      if (!n.built) continue;
      if (!this.inView(n, c)) continue;
      n.mesh.visible = true; drawn++;
      n.lastDrawn = now;
      if (n.imgKey === -1) this.applyImagery(n);      // görünmezken bırakılmış dokuyu geri al
      if (n.imgTile) n.imgTile.used = now;
    }
    let builtN = 0; for (const n of this.nodes.values()) if (n.built) builtN++;
    this.stats.nodes = builtN; this.stats.drawn = drawn;
    this._evictT = (this._evictT || 0) - dt;
    if (this._evictT <= 0 || dt === 0) {
      this._evictT = 0.5;
      this.evict(now);
      // GPU belleği: 3 s'dir çizilmeyen (görüş dışı / LOD dışı) düğümler görüntü referansını bırakır;
      // böylece trim() bütçeyi gerçekten uygulayabilir. Yeniden görününce doku önbellekten geri gelir.
      for (const n of this.nodes.values()) {
        if (n.built && n.imgTile && !(n.mesh && n.mesh.visible) && now - (n.lastDrawn || 0) > 3) this.releaseImagery(n);
      }
      this.img.trim();
    }
  }

  /**
   * Uzun süredir seçilmeyen düğümlerin geometrisini bırakır (bellek bütçesi). Kardeşler BİRLİKTE
   * bırakılır (ebeveynin çocuk listesi sıfırlanır): yarım kalmış bir çocuk listesi, haritada olmayan
   * bir düğüme yeniden örgü kurulmasına (gizlenemeyen yetim örgü) yol açardı.
   */
  evict(now) {
    let builtN = 0;
    for (const n of this.nodes.values()) if (n.built) builtN++;
    if (builtN <= this.nodeBudget) return;
    // Alt ağaç en son görülme zamanı: tek geçişte, derinden sığa (özyineleme yok)
    const list = this._evList || (this._evList = []);
    list.length = 0;
    for (const n of this.nodes.values()) list.push(n);
    list.sort((a, b) => b.z - a.z);
    for (const n of list) {
      let t = n.lastSeen;
      if (n.children) for (const ch of n.children) if (ch._st > t) t = ch._st;
      n._st = t;
    }
    const parents = [];
    for (const n of list) {
      if (!n.children) continue;
      let newest = 0;
      for (const ch of n.children) if (ch._st > newest) newest = ch._st;
      if (now - newest > 2) parents.push({ n, t: newest });
    }
    parents.sort((a, b) => a.t - b.t);
    for (const { n } of parents) {
      if (builtN <= this.nodeBudget * 0.85) break;
      if (!n.children) continue;            // daha önce bir atasıyla birlikte bırakıldı
      for (const ch of n.children) builtN -= this.dropNode(ch);
      n.children = null;
    }
  }
  /** Düğümü ve alt ağacını bırakır; bırakılan inşa edilmiş düğüm sayısını döner. */
  dropNode(n) {
    let c = n.built ? 1 : 0;
    if (n.mesh) {
      this.releaseImagery(n);
      this.group.remove(n.mesh);
      if (this.pool.length < 48) this.pool.push(n.mesh);
      else { n.mesh.geometry.dispose(); n.mesh.material.dispose(); }
      n.mesh = null;
    }
    n.built = false;
    // Çocuklar da gider (ebeveyn yokken çocuk seçilemez)
    if (n.children) for (const ch of n.children) c += this.dropNode(ch);
    n.children = null;
    if (n.parent) this.nodes.delete(n.key);
    return c;
  }

  dispose() {
    for (const n of this.nodes.values()) if (n.mesh) { n.mesh.geometry.dispose(); n.mesh.material.dispose(); }
    for (const m of this.pool) { m.geometry.dispose(); m.material.dispose(); }
    this.pool.length = 0;
    this.nodes.clear();
    this.img.dispose();
    if (this.blank) this.blank.dispose();
  }
}
