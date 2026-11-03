// Arazi malzemesi (v5.0): çekirdek harita (coreterrain.js) ve dış bölge (geoterrain.js) AYNI
// gölgelendirici mantığını kullanır; çekirdeğin kenarında malzeme dikişi oluşmaz.
//
// Katmanlar:
//  1) Makro albedo: Sentinel-2 görüntüsü (fiziksel yansıtırlık). Görüntü kendi çekim anının
//     güneşiyle gölgelenmiştir (azimut 162°, yükseklik 47°): o gölgeleme arazi normaliyle
//     kaba bir Lambert tahmini üzerinden geri alınır (de-shading), böylece gün batımında yamaçlar
//     iki kez gölgelenmez.
//  2) Malzeme sınıfları (makro renk + eğim + çekirdekte tasarım maskeleri): Ege makisi (öbekli
//     koyu taç + açık toprak boşlukları), kuru ot/toprak, kireçtaşı kaya (çatlak, katman bantları),
//     kumsal, kentsel zemin, sulanan yeşil alan. Yakında yordamsal ayrıntı (ortalamayı korur),
//     uzakta görüntünün kendisi: yüksekten bakınca gerçek peyzaj, alçakta keskin yüzey.
//  3) Fiziksel tabanlı ışık: MeshStandardMaterial (pürüzlülük sınıfa göre), gölge haritası,
//     gök ortam haritası. Ayrıntı normali türev tabanlı tümsek (bump) ile yalnızca yakında.
//  4) Deniz tabanı: kum / Posidonia çayırı / kaya; su içindeki ışık yolu (kanal başına Beer-Lambert)
//     ve saçılma rengi; sığlıkta hareketli kostik desen. Su yüzeyi ayrı örgüdür (ocean.js): yalnızca
//     yansıma ve parıltı ekler, bu yüzden taban derinliğe göre doğal biçimde turkuaz -> lacivert olur.
//  5) Kıyı çizgisi: ıslak kum bandı ve dalga yalağı köpüğü (yükseklikten; kıyı çizgisi geometrisiyle
//     birebir hizalı).
import * as THREE from 'three';
import { HAZE_UNIFORMS, HAZE_PARS_VS, CURVE_PROJECT } from './worldshade.js';
import { periodicNoise } from './textures.js';
import { MSL_Y } from './geo.js';

export const SEA_Y = MSL_Y;   // deniz yüzeyi (fizik y)

export const TMAT_UNIFORMS = {
  tDet: { value: null },
  uTime: { value: 0 },
  uAcqSun: { value: new THREE.Vector3(0.21, 0.73, 0.65).normalize() },   // görüntü çekim güneşi (manifestten)
  uMacroGain: { value: 1 / 1.6 },
  uCoreRect: { value: new THREE.Vector4(1e9, 1e9, -1e9, -1e9) },        // x0, z0, x1, z1
  uSunDirW: HAZE_UNIFORMS.hzSunDir,
  uNight: { value: 0 },
  // Su optiği (1/m): berrak, oligotrofik Ege suyu. Kırmızı hızla söner; mavi-yeşil uzun yol alır.
  uSig: { value: new THREE.Vector3(0.38, 0.078, 0.058) },
  uScat: { value: new THREE.Color(0.0036, 0.019, 0.052) },     // derin su kütlesi (doğrusal; Ege laciverti)
  uSunI: { value: 1 },
};

// ---------------------------------------------------------------------------------------------
// Ayrıntı atlası (döşenebilir, 512²): R kaya çatlakları (sırtlı), G ince tane, B öbek (bitki),
// A orta ölçekli gürültü. Tek doku, birkaç ölçekte örneklenir.
// ---------------------------------------------------------------------------------------------
export function makeDetailAtlas(size = 512) {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rk = periodicNoise(size, 5, 211, 6, 0.62), rk2 = periodicNoise(size, 4, 212, 24, 0.5);
  const gr = periodicNoise(size, 3, 213, 64, 0.55), gr2 = periodicNoise(size, 2, 214, 128, 0.5);
  const cl = periodicNoise(size, 4, 215, 12, 0.5), cl2 = periodicNoise(size, 3, 216, 40, 0.5);
  const md = periodicNoise(size, 4, 217, 4, 0.55);
  const st = (v, k) => Math.max(0, Math.min(1, (v - 0.5) * k + 0.5));
  for (let i = 0; i < size * size; i++) {
    const ridge = 1 - Math.abs(rk[i] * 2 - 1);
    const r = st(Math.pow(ridge, 3.0) * 0.75 + rk2[i] * 0.35, 1.8);
    const g = st(gr[i] * 0.65 + gr2[i] * 0.35, 2.4);
    const b = st(cl[i] * 0.7 + cl2[i] * 0.3, 2.2);
    const a = st(md[i], 2.0);
    img.data[i * 4] = r * 255; img.data[i * 4 + 1] = g * 255; img.data[i * 4 + 2] = b * 255; img.data[i * 4 + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// ---------------------------------------------------------------------------------------------
// GLSL: ortak yüzey işlevleri
// ---------------------------------------------------------------------------------------------
export const TERRAIN_GLSL = /* glsl */`
  uniform sampler2D tDet; uniform float uTime; uniform vec3 uAcqSun; uniform float uMacroGain;
  uniform vec4 uCoreRect; uniform vec3 uSunDirW; uniform float uNight;
  uniform vec3 uSig; uniform vec3 uScat; uniform float uSunI;
  float tHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  // Türev tabanlı tümsek (Mikkelsen): dünya uzayı konum/normal, skaler yükseklik
  vec3 bumpWorld(vec3 P, vec3 N, float h) {
    vec3 sx = dFdx(P), sy = dFdy(P);
    vec3 r1 = cross(sy, N), r2 = cross(N, sx);
    float det = dot(sx, r1);
    float bx = dFdx(h), by = dFdy(h);
    vec3 grad = sign(det) * (bx * r1 + by * r2);
    return normalize(abs(det) * N - grad);
  }
  // Ekran ayak izine göre ayrıntı sönümü (v5.1): döşenen bir ayrıntı katmanının bir karosu ekranda
  // en sıkışık ekseninde 32 pikselden azına düştüğünde katman ortalamasına (0.5) doğru söner, 8 pikselde
  // tamamen. Yalnızca mesafeye bağlı sönüm (nf) bakış açısını bilmiyordu: sığ açıda 4–17 m'lik karolar
  // birkaç piksele sıkışıyor, eşikli karışımlar (çalı öbekleri, çatlaklar) mip artığını büyütüp yerde
  // "televizyon karıncalanması" gibi bir benek üretiyordu. Türevler dallanmanın DIŞINDA alınır.
  // tileFoot: piksel başına karo kesrinin karesi (en sıkışık eksen).
  float tileFoot(vec2 uv) { vec2 a = dFdx(uv), b = dFdy(uv); return max(dot(a, a), dot(b, b)); }
  float tileFade(float f) { return 1.0 - smoothstep(1.0 / 1024.0, 1.0 / 64.0, f); }
  // İnce tane (G kanalı, karonun ~1/96'sı): tane 4 pikselden küçülünce söner, 1 pikselde tamamen. Yakında
  // (10–60 m) tane piksel boyutundaydı ve pist kenarında dijital parazit gibi görünüyordu.
  float grainFade(float f) { return 1.0 - smoothstep(1.0 / 147456.0, 1.0 / 9216.0, f); }
  // Görüntünün çekim anı gölgelemesini geri al (kaba Lambert; ortam payı ~%45)
  vec3 deshade(vec3 macro, vec3 N) {
    float flatS = 0.45 + 0.55 * max(uAcqSun.y, 0.0);
    float s = 0.45 + 0.55 * max(dot(N, uAcqSun), 0.0);
    return macro * clamp(flatS / max(s, 0.3), 0.7, 1.6);
  }
  struct TSurf { vec3 albedo; float rough; vec3 N; float wet; };
  // P: dünya konumu, N: yüzey normali (dünya), macro: doğrusal görüntü albedosu (deshade edilmiş),
  // mask: çekirdek tasarım maskesi (x kentsel, y kum, z yeşil alan, w kaya), seaH: deniz üstü yükseklik
  TSurf terrainSurface(vec3 P, vec3 N, vec3 macro, vec4 mask, float camD, float seaH) {
    TSurf S; S.N = N; S.wet = 0.0;
    vec2 p = P.xz;
    vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * p;
    float slope = 1.0 - clamp(N.y, 0.0, 1.0);
    float lumM = dot(macro, vec3(0.2126, 0.7152, 0.0722));
    float sumM = macro.r + macro.g + macro.b + 1e-4;
    float gr = macro.g / sumM, rr = macro.r / sumM;
    float mx = max(macro.r, max(macro.g, macro.b)), mn = min(macro.r, min(macro.g, macro.b));
    float sat = (mx - mn) / max(mx, 1e-4);
    // Sınıf ağırlıkları (makro renk + eğim + maske)
    float veg = smoothstep(0.350, 0.392, gr) * (1.0 - smoothstep(0.11, 0.22, lumM));
    float rockS = smoothstep(0.32, 0.55, slope);
    float bareBright = (1.0 - veg) * smoothstep(0.13, 0.26, lumM) * (1.0 - smoothstep(0.10, 0.22, sat));
    float rock = clamp(max(rockS, bareBright * smoothstep(0.06, 0.25, slope)) + mask.w, 0.0, 1.0);
    float sand = mask.y, urban = mask.x, park = mask.z;
    float terra = smoothstep(0.415, 0.465, rr) * (1.0 - veg) * 0.6;          // kırmızı toprak (terra rossa)
    // Ayrıntı örnekleri (mesafeyle sönen)
    vec2 uvA = p * (1.0 / 61.0), uvB = pr * (1.0 / 17.0) + 0.37, uvC = pr * (1.0 / 4.3) + 0.71, uvM = p * (1.0 / 233.0) + 0.61;
    float tfA = tileFoot(uvA), tfB = tileFoot(uvB), tfC = tileFoot(uvC);
    vec4 kA = vec4(tileFade(tfA)), kB = vec4(tileFade(tfB)), kC = vec4(tileFade(tfC));
    kA.g *= grainFade(tfA); kB.g *= grainFade(tfB); kC.g *= grainFade(tfC);
    float nf = 1.0 - smoothstep(350.0, 3200.0, camD);
    float nf2 = 1.0 - smoothstep(40.0, 420.0, camD);
    vec4 dA = vec4(0.5), dB = vec4(0.5), dC = vec4(0.5);
    vec4 dM = mix(vec4(0.5), texture2D(tDet, uvM), tileFade(tileFoot(uvM)));   // ~40 m öbek ölçeği (uzakta da)
    if (nf > 0.0) {
      dA = mix(vec4(0.5), texture2D(tDet, uvA), nf * kA);
      dB = mix(vec4(0.5), texture2D(tDet, uvB), nf * kB);
    }
    if (nf2 > 0.0) dC = mix(vec4(0.5), texture2D(tDet, uvC), nf2 * kC);
    float macroN = texture2D(tDet, p * (1.0 / 1450.0) + 0.13).a;
    // ---- Malzeme paletleri (doğrusal albedo; yerel Ege peyzajı)
    // maki: koyu, öbekli taçlar + aralarında açık kuru toprak; öbek oranı görüntü yeşilliğinden
    float cover = clamp(veg * 0.85 + 0.1, 0.0, 1.0);
    float clump = smoothstep(0.56 - cover * 0.3, 0.72 - cover * 0.3, dM.b * 0.35 + dA.b * 0.35 + dB.b * 0.2 + dC.b * 0.1);
    vec3 soilC = mix(vec3(0.19, 0.165, 0.12), vec3(0.22, 0.14, 0.09), terra) * (0.85 + 0.3 * dB.g);
    vec3 maquisC = mix(vec3(0.050, 0.068, 0.030), vec3(0.032, 0.048, 0.020), dB.b) * (0.85 + 0.3 * dC.g);
    vec3 vegC = mix(soilC * 0.9, maquisC, clump);
    // kuru ot / toprak: saman, kırmızı toprak lekeleri, ince tane
    vec3 dryC = mix(vec3(0.25, 0.215, 0.15), vec3(0.20, 0.185, 0.145), smoothstep(0.4, 0.7, dA.a));
    dryC = mix(dryC, vec3(0.22, 0.145, 0.095), terra * 0.7 + smoothstep(0.7, 0.84, dM.a) * 0.15);
    dryC = mix(dryC, vec3(0.33, 0.32, 0.29), smoothstep(0.68, 0.8, dB.r) * 0.35);   // açığa çıkmış kireçtaşı
    dryC *= (0.82 + 0.32 * dA.g) * (0.9 + 0.2 * dC.g);
    dryC = mix(dryC, maquisC, smoothstep(0.66, 0.80, dM.b * 0.6 + dB.b * 0.4) * 0.75);     // seyrek çalı
    // kireçtaşı kaya: açık gri-bej, çatlaklar, katman bantları
    float crack = smoothstep(0.55, 0.85, dB.r) * 0.55 + smoothstep(0.6, 0.9, dC.r) * 0.35 * nf2;
    float strata = 0.5 + 0.5 * sin(P.y * 0.9 + dA.a * 6.0 + dA.r * 3.0);
    vec3 rockC = vec3(0.40, 0.38, 0.34) * (0.9 + 0.18 * strata) * (1.0 - crack * 0.55) * (0.85 + 0.3 * dA.a);
    rockC = mix(rockC, maquisC, smoothstep(0.7, 0.85, dM.b) * 0.5 * (1.0 - rockS));
    vec3 nat = mix(dryC, vegC, veg);
    nat = mix(nat, rockC, rock);
    // görüntüden zayıf ton (bölgesel çeşitlilik korunur, bulanıklık taşınmaz)
    vec3 natMean = mix(mix(vec3(0.23, 0.19, 0.12), vec3(0.08, 0.10, 0.05), veg), vec3(0.38, 0.36, 0.32), rock);
    vec3 tint = clamp(macro / max(natMean, vec3(0.02)), vec3(0.7), vec3(1.4));
    nat *= mix(vec3(1.0), tint, 0.35);
    nat *= 0.93 + 0.14 * macroN;
    // --- tasarım maskeleri (çekirdek)
    vec3 sandC = vec3(0.50, 0.43, 0.31) * (0.9 + 0.2 * dC.g) * (0.95 + 0.1 * dA.a);
    float wet = (1.0 - smoothstep(0.05, 0.7, seaH)) * step(-0.5, seaH);
    sandC *= mix(1.0, 0.55, wet);
    float paveTile = smoothstep(0.02, 0.06, abs(fract(p.x * 0.5) - 0.5)) * smoothstep(0.02, 0.06, abs(fract(p.y * 0.5) - 0.5));
    // kentsel zemin: koyu döşeme/asfalt + bahçe yeşili lekeleri (avlular, ağaçlık bahçeler)
    vec3 urbC = vec3(0.155, 0.150, 0.140) * (0.82 + 0.3 * dB.g) * (0.92 + 0.08 * mix(1.0, paveTile, nf2)) * (0.9 + 0.2 * dA.a);
    float gardens = smoothstep(0.52, 0.70, dA.b * 0.6 + macroN * 0.4);
    urbC = mix(urbC, vec3(0.05, 0.075, 0.03) * (0.8 + 0.4 * dB.b), gardens * 0.55);
    vec3 parkC = vec3(0.060, 0.105, 0.035) * (0.8 + 0.4 * dB.b) * (0.9 + 0.2 * dC.g);
    vec3 col = nat;
    col = mix(col, parkC, park);
    col = mix(col, urbC, urban);
    col = mix(col, sandC, sand);
    // uzak: görüntünün kendisine yakınsar (gerçek peyzaj); yakında yordamsal malzeme
    float farW = smoothstep(500.0, 5000.0, camD) * (1.0 - max(urban, sand) * 0.7);
    col = mix(col, macro, farW * 0.8);
    S.albedo = col;
    S.rough = mix(mix(0.92, 0.84, rock), 0.95, veg);
    S.rough = mix(S.rough, 0.78, urban);
    S.rough = mix(S.rough, mix(0.9, 0.35, wet), sand);
    S.wet = wet * sand;
    // --- ayrıntı normali (yalnızca yakında)
    if (nf > 0.01) {
      float hb = (dA.r * 0.6 + dB.r * 0.4) * (0.4 + 2.6 * rock) * 0.9 + clump * veg * 0.9 + (dC.g - 0.5) * 0.25;
      hb += (dC.r - 0.5) * rock * 0.6 * nf2;
      hb *= mix(1.0, 0.25, max(urban, sand));
      S.N = bumpWorld(P, N, hb * nf);
    }
    return S;
  }
  // Deniz tabanı: kum, Posidonia çayırları (3-30 m), kıyıya yakın eğimlerde kaya
  vec3 seabedAlbedo(vec3 P, vec3 N, float depth, float camD) {
    vec2 p = P.xz;
    float nf = 1.0 - smoothstep(400.0, 4000.0, camD);
    vec4 a = mix(vec4(0.5), texture2D(tDet, p * (1.0 / 140.0) + 0.21), nf);
    vec4 b = texture2D(tDet, p * (1.0 / 900.0) + 0.6);
    float seag = smoothstep(0.48, 0.62, a.b * 0.5 + b.b * 0.5) * smoothstep(2.5, 6.0, depth) * (1.0 - smoothstep(28.0, 40.0, depth));
    float rk = smoothstep(0.25, 0.5, 1.0 - N.y) + smoothstep(0.72, 0.9, b.r) * 0.5;
    vec3 sandC = vec3(0.40, 0.36, 0.28) * (0.85 + 0.3 * a.g);
    vec3 col = mix(sandC, vec3(0.06, 0.075, 0.045), seag * 0.75);
    col = mix(col, vec3(0.23, 0.22, 0.19) * (0.8 + 0.4 * a.r), clamp(rk, 0.0, 1.0) * 0.8);
    return col;
  }
  // Kostik desen (sığlıkta, güneşe bağlı, hareketli)
  float caustics(vec2 p, float t) {
    float a = texture2D(tDet, p * 0.11 + vec2(t * 0.021, t * 0.013)).b;
    float b = texture2D(tDet, p * 0.137 - vec2(t * 0.017, -t * 0.019) + 0.5).b;
    float r = 1.0 - abs(a + b - 1.0);
    return pow(r, 8.0);
  }
  // Su içi ışık yolu: kamera su üstündeyse görüş ışını yüzeyde kırılır (n = 1,33)
  vec3 underwaterOptics(vec3 lit, vec3 P, float seaY) {
    float D = seaY - P.y;
    if (D <= 0.0) return lit;
    vec3 dv = P - cameraPosition; float dl = max(length(dv), 1e-3); vec3 dir = dv / dl;
    float ci = clamp(-dir.y, 0.03, 1.0);
    float ct = sqrt(1.0 - (1.0 - ci * ci) / 1.77);
    float pathV = cameraPosition.y > seaY ? D / ct : dl;
    float pathS = D / max(uSunDirW.y, 0.25);
    vec3 Tv = exp(-uSig * pathV), Ts = exp(-uSig * pathS);
    float sunK = (0.25 + 0.75 * clamp(uSunDirW.y * 2.0, 0.0, 1.0)) * uSunI;
    return lit * Ts * Tv + uScat * sunK * (1.0 - Tv);
  }
`;

// Köşe gölgelendiricisi ekleri (konum dünya uzayında, pus köşede)
const VS_PARS = `
  varying vec3 vTW; varying vec3 vTN;
` + HAZE_PARS_VS;

/**
 * Arazi malzemesi kurucusu.
 * kind: 'core' (tMacro/tNormal/tMask çekirdek dokuları, morph özniteliği) | 'outer' (map = karo görüntüsü)
 */
export function makeTerrainMaterial(kind, opts = {}) {
  const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, map: opts.map || null });
  m.userData.hazed = true;
  m.envMapIntensity = 0.55;
  const core = kind === 'core';
  const U = opts.uniforms || {};
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, HAZE_UNIFORMS, TMAT_UNIFORMS, U);
    let vs = VS_PARS + '\n' + (core ? 'attribute float morph; uniform float uMorphK;\n' : '') + sh.vertexShader;
    if (core) {
      // CDLOD tarzı geçiş: düğümün üst seviyesinin yüzeyine (tek indisli köşelerde) mesafeyle kayar
      vs = vs.replace('#include <begin_vertex>', `#include <begin_vertex>
        {
          vec3 wpm = (modelMatrix * vec4(transformed, 1.0)).xyz;
          float dm = distance(wpm, cameraPosition);
          float mk = clamp((dm - uMorphK * 0.70) / (uMorphK * 0.30), 0.0, 1.0);
          transformed.y += morph * mk;
        }`);
    }
    vs = vs.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
      vTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);`)
      .replace('#include <project_vertex>', CURVE_PROJECT + `
      vHaze = hazeAt(transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition);`);
    // worldpos_vertex yalnızca gölge/env varsa açılır: her durumda vTW yazılsın
    if (!vs.includes('vTW =')) vs = vs.replace('#include <fog_vertex>', '#include <fog_vertex>\n vTW = (modelMatrix * vec4(transformed, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * objectNormal);');
    sh.vertexShader = vs;
    let fs = `varying vec3 vTW; varying vec3 vTN; varying vec4 vHaze;\n` + TERRAIN_GLSL +
      (core ? '\nuniform sampler2D tMacro; uniform sampler2D tNormal; uniform sampler2D tMask; uniform vec4 uCoreUV;\n' : '') +
      `
      vec3 hazeMixT(vec3 col, vec4 hz) {
        float lum = dot(col, vec3(0.299, 0.587, 0.114));
        col = mix(col, vec3(lum) * vec3(0.95, 0.99, 1.06), smoothstep(0.10, 0.85, hz.a) * 0.25);
        return mix(col, hz.rgb, hz.a);
      }
      ` + sh.fragmentShader;
    const seaY = SEA_Y.toFixed(3);
    const surfBlock = `
      vec3 tN0; vec3 tMacroC; vec4 tMaskV = vec4(0.0); float tAO = 1.0;
      {
        ${core ? `
        vec2 cuv = (vTW.xz - uCoreUV.xy) * uCoreUV.zw;
        vec4 nt = texture2D(tNormal, cuv);
        vec2 nxz = nt.xy * 2.0 - 1.0;
        tN0 = normalize(vec3(nxz.x, sqrt(max(0.0, 1.0 - dot(nxz, nxz))), nxz.y));
        tAO = 0.55 + 0.45 * nt.z;
        tMacroC = texture2D(tMacro, cuv).rgb * uMacroGain;
        tMaskV = texture2D(tMask, cuv);
        ` : `
        if (vTW.x > uCoreRect.x && vTW.x < uCoreRect.z && vTW.z > uCoreRect.y && vTW.z < uCoreRect.w) discard;
        tN0 = normalize(vTN);
        tMacroC = diffuseColor.rgb * uMacroGain;
        `}
      }
      float tCamD = length(vTW - cameraPosition);
      float tSeaH = vTW.y - ${seaY};
      float tUnder = 0.0;
      {
        vec3 macro = deshade(tMacroC, tN0);
        if (tSeaH < 0.0) {
          // deniz tabanı (görüntü burada suyun kendisidir: kullanılmaz)
          vec3 sb = seabedAlbedo(vTW, tN0, -tSeaH, tCamD);
          diffuseColor.rgb = sb;
          roughnessFactor = 0.9;
          tUnder = 1.0;
          normal = normalize((viewMatrix * vec4(tN0, 0.0)).xyz);
        } else {
          TSurf S = terrainSurface(vTW, tN0, macro, tMaskV, tCamD, tSeaH);
          diffuseColor.rgb = S.albedo * tAO;
          roughnessFactor = S.rough;
          normal = normalize((viewMatrix * vec4(S.N, 0.0)).xyz);
        }
      }
    `;
    fs = fs.replace('#include <map_fragment>', core ? '' : '#include <map_fragment>')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + surfBlock)
      .replace('#include <fog_fragment>', '')
      .replace('#include <tonemapping_fragment>', `
      {
        vec3 c = gl_FragColor.rgb;
        if (tUnder > 0.5) {
          float D = -tSeaH;
          // kostik: sığlıkta güneş deseni
          float cs = caustics(vTW.xz, uTime) * exp(-D / 5.0) * (1.0 - smoothstep(600.0, 2500.0, tCamD)) * clamp(uSunDirW.y * 3.0, 0.0, 1.0);
          c *= 1.0 + cs * 2.2;
          c = underwaterOptics(c, vTW, ${seaY});
          // dalga yalağı: kıyı çizgisinin hemen altı
          float sw = sin(uTime * 0.9 + dot(vTW.xz, vec2(0.013, 0.017)) * 6.0 + texture2D(tDet, vTW.xz * 0.02).a * 9.0);
          float edge = smoothstep(-0.45 + 0.2 * sw, -0.05, tSeaH) * (1.0 - smoothstep(0.0, 0.0001, tSeaH));
          float foamN = texture2D(tDet, vTW.xz * 0.21 + vec2(uTime * 0.03, 0.0)).g;
          c = mix(c, vec3(0.85, 0.88, 0.88) * (0.4 + 0.6 * uSunI) * (1.0 - 0.8 * uNight), edge * smoothstep(0.35, 0.7, foamN) * 0.75 * (1.0 - smoothstep(300.0, 1500.0, tCamD)));
        } else if (tSeaH < 0.25) {
          // dalga sınırının hemen üstü: ince ıslak köpük izi
          float sw = sin(uTime * 0.9 + dot(vTW.xz, vec2(0.013, 0.017)) * 6.0 + texture2D(tDet, vTW.xz * 0.02).a * 9.0);
          float edge = (1.0 - smoothstep(0.02, 0.18 + 0.06 * sw, tSeaH));
          float foamN = texture2D(tDet, vTW.xz * 0.21 + vec2(uTime * 0.03, 0.0)).g;
          c = mix(c, vec3(0.8, 0.82, 0.82) * (0.4 + 0.6 * uSunI) * (1.0 - 0.8 * uNight), edge * smoothstep(0.45, 0.75, foamN) * 0.6 * (1.0 - smoothstep(300.0, 1500.0, tCamD)));
        }
        gl_FragColor.rgb = hazeMixT(c, vHaze);
      }
      #include <tonemapping_fragment>`);
    sh.fragmentShader = fs;
  };
  m.customProgramCacheKey = () => 'terrain5-' + kind;
  return m;
}
