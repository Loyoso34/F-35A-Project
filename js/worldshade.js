// Dünya gölgelendirme yardımcıları: atmosferik pus ve arazi malzemesi.
//
// Pus (aerial perspective): YALNIZCA dünya malzemelerine uygulanır (arazi, su, yollar,
// binalar, ağaçlar). Uçak ve silah malzemeleri sahnenin olağan sisini kullanmaya devam eder.
//  - Pus rengi, o bakış yönündeki GÖKYÜZÜ rengidir (gökyüzü gölgelendiricisiyle aynı işlev):
//    uzak dağlar tam olarak arkalarındaki göğe karışır, ufukta açık renkli "sis bandı" kalmaz.
//  - Yoğunluk irtifaya bağlıdır: kamera ve nokta yükseldikçe hava incelir; yüksekten aşağı
//    bakınca zemin daha net, alçakta uzaklar daha puslu.
//  - Uzaklıkla hafif doygunluk kaybı ve maviye kayma (renkler ufka doğru solar).
//  - Çizim mesafesinde pus tamdır: kırpılan arazi kenarı hiçbir irtifada görünmez.
// Maliyet: yerleşik malzemelerde pus rengi ve oranı KÖŞEDE hesaplanır (mesafeyle yumuşak
// değişir); pikselde yalnızca bir karışım kalır. Mobil GPU'da doluluk maliyeti eklenmez.
// Su (kaba ızgara) pusu piksel başına hesaplar.
import * as THREE from 'three';

export const HAZE_UNIFORMS = {
  hazeDensity: { value: 7.7e-5 },
  hazeFar: { value: 26000 },
  hzSunDir: { value: new THREE.Vector3(0, 1, 0) },
  hzZenith: { value: new THREE.Color() },
  hzHorizon: { value: new THREE.Color() },
  hzGround: { value: new THREE.Color() },
  hzSunColor: { value: new THREE.Color() },
};

// Gökyüzü renk işlevi: World.skyGLSL ile birebir aynı (gök kubbesi de bunu kullanır)
export const SKY_GLSL = `
  vec3 skyColor(vec3 d, vec3 sunDir, vec3 zenith, vec3 horizon, vec3 ground, vec3 sunColor, float sunStrength) {
    float t = clamp(d.y, -1.0, 1.0);
    vec3 col;
    if (t >= 0.0) col = mix(horizon, zenith, 1.0 - exp(-t * 3.6));
    else col = mix(horizon, ground, clamp(-t * 6.0, 0.0, 1.0));
    float c = max(dot(d, sunDir), 0.0);
    col += sunColor * (pow(c, 8.0) * 0.10 + pow(c, 128.0) * 0.35) * sunStrength;
    col += sunColor * smoothstep(0.99935, 0.99965, c) * 6.0 * sunStrength;
    return col;
  }`;

const HAZE_UNI_DECL = `
  uniform float hazeDensity; uniform float hazeFar;
  uniform vec3 hzSunDir; uniform vec3 hzZenith; uniform vec3 hzHorizon; uniform vec3 hzGround; uniform vec3 hzSunColor;`;
// Pus rengi (rgb) ve oranı (a). Köşe gölgelendiricisinde (yerleşik malzemeler) ve su için
// piksel gölgelendiricisinde aynı işlev kullanılır.
const HAZE_FN = `
  vec4 hazeAt(vec3 wp) {
    vec3 dv = wp - cameraPosition;
    float dist = length(dv);
    // Optik derinlik: üstel sınır tabakası (ölçek yüksekliği 1200 m) boyunca ışın integrali.
    // Alçakta uzaklar puslu; yüksekten aşağı bakınca ışın çoğunlukla ince havadan geçer.
    float h0 = max(cameraPosition.y, 0.0) / 1200.0, h1 = max(wp.y, 0.0) / 1200.0;
    float dh = h1 - h0;
    float k = abs(dh) > 0.001 ? (exp(-h0) - exp(-h1)) / dh : exp(-h0);
    float od = dist * hazeDensity * k;
    float f = 1.0 - exp(-(0.85 * od * od + 0.15 * od));
    float fFar = smoothstep(hazeFar * 0.8, hazeFar * 1.5, dist);
    f = max(f, fFar);
    // Pus rengi: ufuk yönündeki gök rengi. Çizim mesafesine yaklaşan (tam puslanan) yüzeyler
    // GERÇEK bakış yönündeki gök kubbesi rengini alır: yüksekten bakınca uzak deniz/arazi
    // kenarı arkasındaki gök kubbesiyle birebir birleşir (açık renkli bant/basamak oluşmaz).
    vec3 dir = dv / max(dist, 1.0);
    vec3 hd = vec3(dir.x, mix(max(dir.y, 0.0), dir.y, fFar), dir.z + 1e-4);
    vec3 hc = skyColor(normalize(hd), hzSunDir, hzZenith, hzHorizon, hzGround, hzSunColor, 1.0);
    return vec4(hc, f);
  }`;
// Uzaklıkla hafif doygunluk kaybı ve maviye kayma, sonra pus rengine karışım (doğrusal uzay)
const HAZE_MIX = `
  vec3 hazeMix(vec3 col, vec4 hz) {
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * vec3(0.95, 0.99, 1.06), smoothstep(0.10, 0.85, hz.a) * 0.25);
    return mix(col, hz.rgb, hz.a);
  }`;
// Köşe başına pus (yerleşik malzemeler): pikselde yalnızca bir karışım kalır. Pus mesafeyle
// yumuşak değiştiği için arazi/bina üçgenleri boyunca doğrusal ara değer yeterlidir.
export const HAZE_PARS_VS = HAZE_UNI_DECL + SKY_GLSL + HAZE_FN + '\n  varying vec4 vHaze;';
const HAZE_PARS_FS_V = '\n  varying vec4 vHaze;' + HAZE_MIX;
// Piksel başına pus (su: kaba ızgara, ayna yansıması zaten piksel başına)
export const HAZE_PARS_FS = HAZE_UNI_DECL + SKY_GLSL + HAZE_FN + HAZE_MIX + `
  vec3 worldHaze(vec3 col, vec3 wp) { return hazeMix(col, hazeAt(wp)); }`;

// three.js sisi ton eşleme ve sRGB dönüşümünden SONRA uygular; pus ise doğrusal uzayda,
// ton eşlemeden ÖNCE uygulanır (gök kubbesiyle aynı uzayda: renkler birebir eşleşir).
const HAZE_APPLY = `
  gl_FragColor.rgb = hazeMix(gl_FragColor.rgb, vHaze);
  #include <tonemapping_fragment>`;

const HAZE_VS = `
  vHaze = hazeAt(transpose(mat3(viewMatrix)) * mvPosition.xyz + cameraPosition);`;

/** Pus işlevini bir three.js yerleşik malzemesine bağlar (onBeforeCompile). */
export function applyHaze(material, key = 'h') {
  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (sh, r) => {
    if (prev) prev(sh, r);
    Object.assign(sh.uniforms, HAZE_UNIFORMS);
    sh.vertexShader = HAZE_PARS_VS + '\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n' + HAZE_VS);
    sh.fragmentShader = HAZE_PARS_FS_V + '\n' + sh.fragmentShader.replace('#include <fog_fragment>', '').replace('#include <tonemapping_fragment>', HAZE_APPLY);
  };
  const prevKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  material.customProgramCacheKey = () => 'haze2|' + key + '|' + (prevKey ? prevKey() : '');
  material.needsUpdate = true;
  return material;
}

/** Dünya grubundaki tüm yerleşik (ShaderMaterial olmayan) malzemelere pus uygular. */
export function hazeAll(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (!o.material) return;
    for (const m of [].concat(o.material)) {
      if (!m || seen.has(m) || m.isShaderMaterial || m.userData.noHaze || m.userData.hazed) continue;
      // Işıklar/parıltılar (toplamalı, sprite) ve sissiz malzemeler: puslanmaz
      if (m.fog === false || m.isSpriteMaterial || m.isPointsMaterial || m.blending !== THREE.NormalBlending) continue;
      seen.add(m); m.userData.hazed = true;
      applyHaze(m);
    }
  });
}

// ---------------------------------------------------------------------------
// Arazi malzemesi
// Köşe rengi geniş ölçekli biyomu (iklim, irtifa, orman, kıyı, kar) taşır. Piksel başına:
//  - çok ölçekli makro değişim (4 km, 1,1 km, 290 m; döndürülmüş örneklerle döşeme izi yok),
//  - kurak/yeşil lekeler ve çıplak toprak alanları,
//  - TARLALAR: bölgesel yönelimli, değişken boyutlu parseller; ürün paleti, ekin sıraları,
//    çit/patika sınırları (köşe çözünürlüğünde değil, piksel çözünürlüğünde; havadan keskin),
//  - orman örtüsü kümelenmesi (ağaçlar uzakta çizilmese de orman dokulu okunur),
//  - eğime bağlı kaya: eşik gürültüyle bozulur, katmanlaşma bantları, sıcak/soğuk ton,
//  - yakında ince ayrıntı (uzakta söner: parıltı/aliasing olmaz).
// land özniteliği: x tarım uygunluğu, y orman, z kentsel/yerleşim, w kuraklık.
const TERRAIN_PARS = `
  uniform sampler2D tDetail;
  varying vec4 vLand; varying vec3 vTWP; varying vec3 vTN; varying vec4 vMac;
  float tHash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
  float tHash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
`;

const TERRAIN_FS = `
  {
    vec2 P = vTWP.xz;
    float camD = length(vTWP - cameraPosition);
    float urb = clamp(vLand.z, 0.0, 1.0);
    vec3 col = diffuseColor.rgb;
    float bright = dot(col, vec3(0.333));
    float nat = (1.0 - urb) * (1.0 - smoothstep(0.62, 0.80, bright));   // kar ve kent zemini korunur
    vec2 Pr = vec2(P.x * 0.866 - P.y * 0.5, P.x * 0.5 + P.y * 0.866);
    // 4,1 km ve 1,1 km'lik makro örnekler köşede alınır (köşe aralığı 62-250 m): pikselde tek makro örnek
    vec3 mA = vec3(0.0, vMac.y, vMac.x), mB = vec3(0.0, vMac.w, vMac.z);
    vec3 mC = texture2D(tDetail, Pr * 0.00345 + vec2(0.13, 0.52)).rgb;
    float macro = mA.b * 0.5 + mB.b * 0.32 + mC.b * 0.18;
    float nearF = 1.0 - smoothstep(250.0, 1600.0, camD);
    // İnce ayrıntı yalnızca yakında örneklenir (uzakta 3 doku örneği; dal mesafeyle tutarlı)
    vec3 dA = vec3(0.5), dB = vec3(0.5);
    if (nearF > 0.0) {
      dA = mix(vec3(0.5), texture2D(tDetail, P * 0.027).rgb, nearF);
      dB = mix(vec3(0.5), texture2D(tDetail, Pr * 0.088 + 0.31).rgb, nearF);
    }
    float fine = dA.r * 0.55 + dB.r * 0.45;
    // 1) makro ton ve renk: geniş parlaklık, kurak/yeşil lekeler, çıplak toprak
    col *= mix(1.0, 0.80 + 0.42 * macro, nat);
    float dryP = smoothstep(0.58, 0.86, mB.b * 0.6 + mC.b * 0.4) * nat;
    col = mix(col, col * vec3(1.13, 1.04, 0.78), dryP * 0.55);
    float lushP = smoothstep(0.42, 0.14, mB.g * 0.5 + mA.b * 0.5) * nat;
    col = mix(col, col * vec3(0.82, 1.04, 0.80), lushP * 0.35);
    float dirt = smoothstep(0.70, 0.88, mC.g * 0.55 + mB.b * 0.45) * smoothstep(0.30, 0.80, vLand.w) * nat * (1.0 - vLand.y);
    col = mix(col, vec3(0.50, 0.43, 0.32) * (0.85 + 0.3 * fine), dirt * 0.55);
    // 2) tarlalar
    float farm = vLand.x * nat;
    if (farm > 0.01) {
      // Tarım bölgesi (~2,6 km): kendi sabit yönelimi ve parsel boyutu; döndürme bölge
      // merkezine göre yapılır (büyük dünya koordinatlarında ızgara bükülmez)
      vec2 rgid = floor(P / 2600.0);
      float ra = tHash12(rgid + 5.3), rb = tHash12(rgid + 11.9);
      float ang = (ra - 0.5) * 1.5;
      float ca = cos(ang), sa = sin(ang);
      vec2 Pl = P - (rgid + 0.5) * 2600.0;
      vec2 q = vec2(ca * Pl.x - sa * Pl.y, sa * Pl.x + ca * Pl.y);
      vec2 cs = vec2(215.0, 140.0) * (0.65 + 0.7 * rb);
      vec2 g = q / cs;
      float row = floor(g.y);
      g.x += tHash11(row + 0.5) * 3.17;
      vec2 id = vec2(floor(g.x), row);
      vec2 f = fract(g);
      float h2 = tHash12(id + 31.7);
      float split = step(0.62, h2);
      float sub = step(0.5, f.y) * split;
      vec2 idS = id + vec2(0.0, sub * 0.5);
      float h1 = tHash12(idS + 7.7);
      vec2 fl = vec2(f.x, mix(f.y, fract(f.y * 2.0), split));
      vec2 csl = vec2(cs.x, cs.y * mix(1.0, 0.5, split));
      vec3 fc;
      if (h1 < 0.20) fc = vec3(0.76, 0.66, 0.36);
      else if (h1 < 0.37) fc = vec3(0.45, 0.58, 0.24);
      else if (h1 < 0.50) fc = vec3(0.29, 0.45, 0.18);
      else if (h1 < 0.62) fc = vec3(0.49, 0.38, 0.26);
      else if (h1 < 0.72) fc = vec3(0.64, 0.60, 0.40);
      else if (h1 < 0.84) fc = vec3(0.53, 0.61, 0.30);
      else if (h1 < 0.93) fc = vec3(0.68, 0.56, 0.34);
      else fc = vec3(0.40, 0.52, 0.30);
      fc *= 0.9 + 0.2 * tHash12(idS + 3.1);
      fc *= 0.9 + 0.2 * dB.r;
      float rowsW = h2 > 0.5 ? fl.x * csl.x : fl.y * csl.y;
      fc *= 1.0 - 0.08 * nearF * (0.5 + 0.5 * sin(rowsW * 2.6)) * step(0.36, h1) * step(h1, 0.72);
      vec2 em = min(fl, 1.0 - fl) * csl;
      float edge = min(em.x, em.y);
      float aa = fwidth(edge) + 0.6;
      float hedge = 1.0 - smoothstep(1.7, 1.7 + aa * 1.5, edge);
      vec3 bcol = h2 > 0.33 ? vec3(0.16, 0.27, 0.11) : vec3(0.58, 0.53, 0.40);
      fc = mix(fc, bcol, hedge * smoothstep(15000.0, 3000.0, camD) * 0.9);
      fc = mix(fc, vec3(0.56, 0.54, 0.32), smoothstep(9000.0, 22000.0, camD) * 0.5);
      float isField = step(0.17, tHash12(id + 91.0));
      col = mix(col, fc * (0.88 + 0.24 * macro), farm * isField * 0.92);
    }
    // 3) orman örtüsü: taç kümeleri ve boşluklar
    // Taç kümeleri: yakında ince ayrıntı dokusundan, uzakta 290 m'lik makro örnekten (ek örnek yok)
    float cl = mix(mix(0.5, mC.r, smoothstep(9000.0, 2500.0, camD)), dA.r, nearF);
    col *= mix(1.0, 0.70 + 0.58 * cl, vLand.y * nat);
    // 4) dik yamaçta kaya (eşik gürültüyle bozulur), katmanlaşma ve ton değişimi
    float ny = normalize(vTN).y;
    float rk = smoothstep(0.905, 0.77, ny + (mC.g - 0.5) * 0.10 + (dA.g - 0.5) * 0.05) * (1.0 - urb);
    vec3 rockCol = vec3(0.47, 0.44, 0.40) * (0.78 + 0.44 * mix(mB.g, dA.g, nearF * 0.7));
    rockCol *= 0.95 + 0.05 * sin(vTWP.y * 0.21 + mB.g * 9.0 + dA.g * 3.0);
    rockCol = mix(rockCol, rockCol * vec3(1.07, 0.98, 0.88), mA.g);
    col = mix(col, rockCol, rk);
    // 5) ince ayrıntı
    col *= mix(1.0, 0.88 + 0.24 * fine, 1.0 - urb * 0.5);
    // Genel yansıtırlık: eski çim dokusunun (sRGB ~188/186/176) ortalama çarpanı; köşe renkleri
    // bu çarpana göre ayarlıdır (ton ve parlaklık eski dünya ile tutarlı kalır)
    diffuseColor.rgb = col * vec3(0.55, 0.54, 0.50);
  }
`;

export function createTerrainMaterial(detailTex) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.tDetail = { value: detailTex };
    Object.assign(sh.uniforms, HAZE_UNIFORMS);
    sh.vertexShader = 'attribute vec4 land;\nuniform sampler2D tDetail;\nvarying vec4 vLand; varying vec3 vTWP; varying vec3 vTN; varying vec4 vMac;\n' + HAZE_PARS_VS + '\n' + sh.vertexShader
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  vLand = land; vTWP = (modelMatrix * vec4(position, 1.0)).xyz; vTN = normalize(mat3(modelMatrix) * normal);
  {
    // Bulanık mip düzeyi: köşe hızında örtüşme (aliasing) olmaz
    vec3 ta = textureLod(tDetail, vTWP.xz * 0.000244, 4.0).rgb;
    vec3 tb = textureLod(tDetail, vTWP.xz * 0.000885 + vec2(0.37, 0.71), 3.0).rgb;
    vMac = vec4(ta.b, ta.g, tb.b, tb.g);
  }`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n' + HAZE_VS);
    sh.fragmentShader = TERRAIN_PARS + HAZE_PARS_FS_V + '\n' + sh.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + TERRAIN_FS)
      .replace('#include <fog_fragment>', '').replace('#include <tonemapping_fragment>', HAZE_APPLY);
  };
  mat.customProgramCacheKey = () => 'terrain3';
  mat.userData.hazed = true;
  return mat;
}
