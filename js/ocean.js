// Deniz yüzeyi (v5.0): tek, küresel su yüzeyi (çekirdek harita + bölge + ufka kadar).
//
// Fizik değil, yalnızca çizim: fizik denizi 0 m MSL'de görür (geoworld.js).
// Optik ayrımı: SU KÜTLESİ (soğurma, saçılma, deniz tabanı, kostik) arazi gölgelendiricisinde
// çizilir (terrainmat.js) — her taban pikseli kendi derinliğini bilir. Bu yüzey yalnızca YÜZEY
// optiğidir: Fresnel yansıması (gök + düzlemsel yansıma), güneş parıltısı (GGX), köpük; alfa = Fresnel
// ağırlığı. Sonuç: sığlıkta turkuaz kum görünür, derinde lacivert, yatay bakışta ayna gibi yansıma.
//
// Dalgalar: 10 yönlü dalga (derin su dağılımı ω = √(g·k)), hâkim rüzgâr KKB (yaz meltemi) ->
// dalgalar GGD'ye ilerler. Her dalga mesafeyle süzülür; süzülen eğim varyansı GGX pürüzlülüğüne
// eklenir (uzakta parıltı yolu genişler, yakında keskin pırıltı) — doku tekrarı ve aliasing yok.
// Kılcal dalgacıklar normal haritasıyla yalnızca yakında. Limanlarda (sığınak bölgeleri) dalga
// genliği düşer.
//
// Yansıma: düzlemsel yansıma (ayna kamera, eğik yakın düzlem kırpma, yarım çözünürlüklü HDR hedef)
// dalga normaliyle bükülür; binalar, tekneler, kale, uçak ve gece ışıkları yansır. Kalite
// 'low' ise yalnızca analitik gök yansıması (mobil). Yansıma kamerası NOREFLECT katmanını görmez.
import * as THREE from 'three';
import { HAZE_UNIFORMS, HAZE_PARS_FS } from './worldshade.js';
import { MSL_Y } from './geo.js';
import { TMAT_UNIFORMS } from './terrainmat.js';

export const LAYER_NOREFLECT = 3;

// Dalga kümesi: [yön (derece, ilerleme; 0 = kuzey, saat yönü), dalga boyu m, diklik a·k]
const WAVES = [
  [152, 57, 0.026], [118, 43, 0.030], [189, 33, 0.034], [101, 24, 0.040], [214, 18.5, 0.044],
  [141, 13.7, 0.050], [77, 10.3, 0.048], [233, 7.6, 0.052], [166, 5.6, 0.054], [123, 4.1, 0.052],
  [58, 3.0, 0.048], [197, 2.2, 0.046], [149, 1.6, 0.042], [96, 1.15, 0.038],
];

const OCEAN_VS = /* glsl */`
  uniform float hzCurv;
  varying vec3 vWP;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWP = wp.xyz;
    vec4 mv = viewMatrix * wp;
    vec3 dW = wp.xyz - cameraPosition;
    mv.xyz -= mat3(viewMatrix)[1] * ((dW.x * dW.x + dW.z * dW.z) * hzCurv);
    gl_Position = projectionMatrix * mv;
  }`;

const OCEAN_FS = /* glsl */`
  #define NW ${WAVES.length}
  uniform float uTime; uniform vec4 uW[NW];
  uniform sampler2D tNrm; uniform sampler2D tNoise; uniform sampler2D tRefl; uniform mat4 uReflMat; uniform float uReflOn;
  uniform vec4 uShelter[8]; uniform vec4 uDataRect; uniform vec3 uSunRad; uniform vec3 uDeep;
  uniform float uNight; uniform float uSeaY; uniform float uWaveK;
  varying vec3 vWP;
  ${HAZE_PARS_FS}
  float D_GGX(float NoH, float a) { float a2 = a * a; float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (3.14159265 * d * d + 1e-7); }
  float V_Smith(float NoV, float NoL, float a) {
    float a2 = a * a;
    float gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2), gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
    return 0.5 / max(gv + gl, 1e-5);
  }
  void main() {
    vec3 V = cameraPosition - vWP; float camD = length(V); V /= camD;
    vec2 p = vWP.xz;
    // sığınak (liman): dalga genliği
    float shel = 1.0;
    for (int i = 0; i < 8; i++) {
      vec4 s = uShelter[i];
      if (s.z <= 0.0) continue;
      float d = length(p - s.xy);
      shel = min(shel, mix(1.0, s.w, 1.0 - smoothstep(s.z * 0.55, s.z, d)));
    }
    float amp = uWaveK * shel;
    // dalga grupları: her dalganın genliği büyük ölçekli, yavaş kayan bir gürültüyle değişir
    // (düzenli şerit deseni oluşmaz; açık denizde gerçek "set"ler gibi)
    vec4 gm = texture2D(tNoise, p * (1.0 / 1900.0) + vec2(uTime * 0.0011, uTime * 0.0007));
    vec4 gm2 = texture2D(tNoise, p * (1.0 / 640.0) - vec2(uTime * 0.0017, -uTime * 0.0009) + 0.37);
    vec2 sl = vec2(0.0); float hgt = 0.0, lost = 0.0, hmax = 0.0;
    for (int i = 0; i < NW; i++) {
      vec4 w = uW[i];
      float k = w.z, L = 6.2831853 / k;
      float fade = 1.0 - smoothstep(L * 22.0, L * 95.0, camD);
      float ph = k * dot(w.xy, p) - sqrt(9.81 * k) * uTime + float(i) * 1.731;
      float gi = i < 5 ? mix(gm.r, gm.b, float(i) * 0.25) : mix(gm2.g, gm2.a, fract(float(i) * 0.37));
      float a = w.w * amp * (0.25 + 1.5 * gi * gi);
      sl += w.xy * (a * cos(ph) * fade);
      hgt += a / k * sin(ph) * fade; hmax += a / k * fade;
      lost += a * a * (1.0 - fade) * 0.5;
    }
    // orta ölçekli rüzgâr dalgacıkları (normal haritası, 3 ölçek; yönleri farklı, akış hızı farklı):
    // uzakta parıltı yolunu kırar, desen tekrarı görünmez
    {
      float mf = 1.0 - smoothstep(1500.0, 9000.0, camD);
      vec2 m1 = texture2D(tNrm, p * (1.0 / 31.0) + vec2(uTime * 0.008, -uTime * 0.005)).xy * 2.0 - 1.0;
      vec2 m2 = texture2D(tNrm, mat2(0.8, -0.6, 0.6, 0.8) * p * (1.0 / 87.0) - vec2(uTime * 0.004, uTime * 0.006)).xy * 2.0 - 1.0;
      sl += (m1 * 0.035 + m2 * 0.03) * mf * (0.4 + 0.6 * shel) * (0.5 + gm.g);
      lost += 0.0012 * (1.0 - mf);
    }
    // kılcal dalgacıklar (yakında)
    float nf = 1.0 - smoothstep(60.0, 420.0, camD);
    if (nf > 0.0) {
      vec2 n1 = texture2D(tNrm, p * (1.0 / 7.3) + vec2(uTime * 0.021, uTime * 0.013)).xy * 2.0 - 1.0;
      vec2 n2 = texture2D(tNrm, p * (1.0 / 2.9) - vec2(uTime * 0.034, -uTime * 0.027)).xy * 2.0 - 1.0;
      sl += (n1 * 0.06 + n2 * 0.045) * nf * (0.45 + 0.55 * shel);
      lost += 0.0016 * (1.0 - nf);
    } else lost += 0.0016;
    vec3 N = normalize(vec3(-sl.x, 1.0, -sl.y));
    float NoV = max(dot(N, V), 0.02);
    float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
    vec3 R = reflect(-V, N);
    if (R.y < 0.0) R.y = -R.y * 0.6;
    vec3 sky = skyColor(normalize(R), hzSunDir, hzZenith, hzHorizon, hzGround, hzSunColor, 0.0);
    vec3 refl = sky;
    if (uReflOn > 0.5) {
      vec4 pr = uReflMat * vec4(vWP.x, uSeaY, vWP.z, 1.0);
      vec2 uv = pr.xy / pr.w;
      uv += N.xz * (0.035 / (1.0 + camD * 0.0012));
      vec2 e = smoothstep(vec2(0.0), vec2(0.04), uv) * smoothstep(vec2(0.0), vec2(0.04), 1.0 - uv);
      vec3 pl = texture2D(tRefl, clamp(uv, 0.002, 0.998)).rgb;
      refl = mix(sky, pl, e.x * e.y);
    }
    // güneş parıltısı (GGX), pürüzlülük: süzülen dalga eğimi varyansı
    vec3 Lg = normalize(hzSunDir);
    float rough = clamp(0.045 + sqrt(lost) * 1.6 + camD * 2.0e-6, 0.045, 0.5);
    vec3 Hh = normalize(V + Lg);
    float NoL = max(dot(N, Lg), 0.0), NoH = max(dot(N, Hh), 0.0), VoH = max(dot(V, Hh), 0.0);
    float Fs = 0.02 + 0.98 * pow(1.0 - VoH, 5.0);
    vec3 spec = uSunRad * (D_GGX(NoH, rough * rough) * V_Smith(NoV, NoL, rough * rough) * Fs * NoL) * step(0.0, Lg.y);
    // köpük: dalga tepeleri (açık deniz, beyaz kıvrım) — seyrek
    float crest = smoothstep(0.55, 0.95, hgt / max(hmax, 1e-3));
    float fn = texture2D(tNoise, p * (1.0 / 13.0) + vec2(uTime * 0.01, 0.0)).g;
    float foam = crest * smoothstep(0.62, 0.85, fn) * shel * (1.0 - smoothstep(400.0, 3000.0, camD)) * 0.55;
    vec3 foamC = vec3(0.75, 0.78, 0.8) * (dot(uSunRad, vec3(0.33)) * 0.3 + 0.12) * (1.0 - 0.85 * uNight);
    // bileşim (ön çarpılmamış; standart alfa karışımı): alfa = yüzeyin opaklığı
    vec3 surf = refl * F + spec + foamC * foam;
    float a = clamp(F + dot(spec, vec3(0.3333)) + foam, 0.0, 1.0);
    // veri sınırının dışında (taban yok): opak derin su
    float outside = 1.0 - (step(uDataRect.x, vWP.x) * step(vWP.x, uDataRect.z) * step(uDataRect.y, vWP.z) * step(vWP.z, uDataRect.w));
    surf += uDeep * (1.0 - F) * outside;
    a = mix(a, 1.0, outside);
    vec4 hz = hazeAt(vWP);
    // pus: alttaki taban zaten puslu; yüzey katmanı yalnızca kendi payını taşır
    vec3 col = surf * (1.0 - hz.a) + hz.rgb * hz.a * a;
    vec3 unp = col / max(a, 1e-3);
    gl_FragColor = vec4(unp, a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

/** Düzlemsel yansıma (three.js Reflector ile aynı ayna kamera ve eğik kırpma matematiği). */
class PlanarReflection {
  constructor(renderer, scale = 0.5) {
    this.renderer = renderer; this.scale = scale;
    const hdr = renderer.capabilities.isWebGL2;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType, depthBuffer: true });
    this.rt.texture.generateMipmaps = false;
    this.cam = new THREE.PerspectiveCamera();
    this.cam.layers.enableAll(); this.cam.layers.disable(LAYER_NOREFLECT);
    this.texMat = new THREE.Matrix4();
    this._n = new THREE.Vector3(0, 1, 0); this._p = new THREE.Vector3();
    this._cw = new THREE.Vector3(); this._rot = new THREE.Matrix4(); this._look = new THREE.Vector3();
    this._view = new THREE.Vector3(); this._tgt = new THREE.Vector3();
    this._plane = new THREE.Plane(); this._clip = new THREE.Vector4(); this._q = new THREE.Vector4();
    this._size = new THREE.Vector2();
  }
  setSize() {
    this.renderer.getDrawingBufferSize(this._size);
    const w = Math.max(64, Math.round(this._size.x * this.scale)), h = Math.max(64, Math.round(this._size.y * this.scale));
    if (this.rt.width !== w || this.rt.height !== h) this.rt.setSize(w, h);
  }
  render(scene, camera, planeY, hide) {
    const r = this.renderer, cam = this.cam, n = this._n;
    this.setSize();
    const cw = this._cw.setFromMatrixPosition(camera.matrixWorld);
    if (cw.y <= planeY + 0.05) return false;
    this._p.set(cw.x, planeY, cw.z);
    // ayna poz: konum ve bakış noktası düzleme göre yansıtılır
    cam.position.set(cw.x, 2 * planeY - cw.y, cw.z);
    this._rot.extractRotation(camera.matrixWorld);
    const look = this._look.set(0, 0, -1).applyMatrix4(this._rot).add(cw);
    this._tgt.set(look.x, 2 * planeY - look.y, look.z);
    cam.up.set(0, 1, 0).applyMatrix4(this._rot); cam.up.y = -cam.up.y;
    cam.lookAt(this._tgt);
    cam.far = camera.far; cam.near = camera.near;
    cam.updateMatrixWorld();
    cam.projectionMatrix.copy(camera.projectionMatrix);
    cam.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.texMat.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.texMat.multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    // eğik yakın düzlem: su düzleminin altı kırpılır
    this._plane.setFromNormalAndCoplanarPoint(n, this._p);
    this._plane.applyMatrix4(cam.matrixWorldInverse);
    const c = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const P = cam.projectionMatrix.elements, q = this._q;
    q.x = (Math.sign(c.x) + P[8]) / P[0]; q.y = (Math.sign(c.y) + P[9]) / P[5]; q.z = -1; q.w = (1 + P[10]) / P[14];
    c.multiplyScalar(2 / c.dot(q));
    P[2] = c.x; P[6] = c.y; P[10] = c.z + 1 - 0.003; P[14] = c.w;
    const prevRT = r.getRenderTarget(), prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    for (const o of hide) o.visible = false;
    r.setRenderTarget(this.rt);
    r.state.buffers.depth.setMask(true);
    r.clear();
    r.render(scene, cam);
    r.setRenderTarget(prevRT);
    for (const o of hide) o.visible = true;
    r.shadowMap.autoUpdate = prevShadow;
    return true;
  }
  dispose() { this.rt.dispose(); }
}

export class Ocean {
  /**
   * o: { renderer, scene, quality ('low'|'medium'|'high'), normalTex, dataRect: [x0, z0, x1, z1], sun (DirectionalLight) }
   */
  constructor(o) {
    this.o = o;
    this.seaY = MSL_Y;
    const wv = WAVES.map(([dir, L, st]) => {
      const a = dir * Math.PI / 180;
      return new THREE.Vector4(Math.sin(a), -Math.cos(a), 2 * Math.PI / L, st);
    });
    this.uniforms = Object.assign({}, HAZE_UNIFORMS, {
      uTime: { value: 0 }, uW: { value: wv },
      tNrm: { value: o.normalTex || null }, tNoise: TMAT_UNIFORMS.tDet, tRefl: { value: null }, uReflMat: { value: new THREE.Matrix4() }, uReflOn: { value: 0 },
      uShelter: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 1)) },
      uDataRect: { value: new THREE.Vector4(...(o.dataRect || [-1e9, -1e9, 1e9, 1e9])) },
      uSunRad: { value: new THREE.Vector3(2.6, 2.5, 2.3) }, uDeep: { value: new THREE.Color(0.0036, 0.019, 0.052) },
      uNight: { value: 0 }, uSeaY: { value: this.seaY }, uWaveK: { value: 1 },
    });
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: OCEAN_VS, fragmentShader: OCEAN_FS,
      transparent: true, depthWrite: false, fog: false,
    });
    mat.userData.noHaze = true;
    this.material = mat;
    this.mesh = new THREE.Mesh(this.makeGeometry(), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'ocean';
    this.mesh.layers.set(0);
    const rq = o.reflections !== undefined ? o.reflections : o.quality !== 'low';
    this.reflection = rq && o.renderer ? new PlanarReflection(o.renderer, o.quality === 'high' ? 0.6 : 0.42) : null;
    if (this.reflection) this.uniforms.tRefl.value = this.reflection.rt.texture;
    this.hide = [this.mesh];
  }

  /** Kamera merkezli kutupsal ızgara: yakında 2 m, ufukta 450 km (geometrik aralık). */
  makeGeometry() {
    const A = 128, rs = [0];
    let r = 2.5;
    while (r < 450000) { rs.push(r); r *= 1.085; }
    rs.push(450000);
    const pos = [], idx = [];
    pos.push(0, 0, 0);
    for (let k = 1; k < rs.length; k++) for (let a = 0; a < A; a++) {
      const t = a / A * Math.PI * 2;
      pos.push(Math.cos(t) * rs[k], 0, Math.sin(t) * rs[k]);
    }
    for (let a = 0; a < A; a++) idx.push(0, 1 + (a + 1) % A, 1 + a);
    for (let k = 1; k < rs.length - 1; k++) {
      const b0 = 1 + (k - 1) * A, b1 = 1 + k * A;
      for (let a = 0; a < A; a++) {
        const a1 = (a + 1) % A;
        idx.push(b0 + a, b0 + a1, b1 + a, b0 + a1, b1 + a1, b1 + a);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    return g;
  }

  /** Liman sığınakları: [{x, z, r, k}] (k: kalan genlik oranı). */
  setShelters(list) {
    const U = this.uniforms.uShelter.value;
    for (let i = 0; i < 8; i++) {
      const s = list[i];
      if (s) U[i].set(s.x, s.z, s.r, s.k); else U[i].set(0, 0, 0, 1);
    }
  }

  setSun(light, night = 0) {
    const c = light.color, I = light.intensity;
    this.uniforms.uSunRad.value.set(c.r * I, c.g * I, c.b * I);
    this.uniforms.uNight.value = night;
  }

  /** Her kare (çizimden önce): konum, zaman; yansıma hedefi çizilir. */
  update(dt, camera, scene) {
    this.uniforms.uTime.value += dt;
    const c = camera.position;
    this.mesh.position.set(c.x, this.seaY, c.z);
    this.mesh.updateMatrixWorld();
    const R = this.reflection;
    let on = 0;
    if (R && this.reflectEnabled !== false) {
      const alt = c.y - this.seaY;
      // yüksekte düzlemsel yansımanın katkısı küçük (Fresnel ~ 0,02-0,05): kapatılır
      if (alt < 6000 && R.render(scene, camera, this.seaY, this.hide)) {
        this.uniforms.uReflMat.value.copy(R.texMat);
        on = 1;
      }
    }
    this.uniforms.uReflOn.value = on;
  }

  dispose() {
    this.mesh.geometry.dispose(); this.material.dispose();
    if (this.reflection) this.reflection.dispose();
  }
}
