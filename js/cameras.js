// Kameralar: serbest (orbit), kokpit, takip (chase), uçuş geçişi, kanat ve iniş takımı.
//
// Tasarım ilkeleri
//  - VARSAYILAN kamera SERBEST kameradır (dizinin ilk elemanı). Oyun kokpitte başlamaz.
//  - Serbest kamera gerçekten serbesttir: uçağın çevresinde sınırsız yatay dönüş,
//    geniş dikey açı (alttan ve üstten bakılabilir) ve yumuşak yakınlaştırma.
//  - Kokpitte SERBEST BAKIŞ vardır: görüş uçağa kilitli değildir, oyuncu sağa/sola/
//    yukarı/aşağı ve çapraz bakabilir.
//  - Tüm bakış girdileri HEDEF değere yazılır, kamera hedefe üstel olarak yaklaşır.
//    Parmak kalkınca hedef değişmeyi bırakır, kamera kendiliğinden durur: ATALET YOK,
//    ani sıçrama yok. Bu, mobilde "kamera kendi kendine kayıyor" hissini engeller.

import * as THREE from 'three';
import { clamp } from './noise.js';

// Sıra = geçiş sırası. İlk eleman başlangıç kamerasıdır.
export const CAMERA_MODES = ['orbit', 'cockpit', 'chase', 'rear', 'flyby', 'cinematic', 'wingL', 'wingR', 'gear'];
export const CAMERA_NAMES = {
  orbit: 'FREE CAMERA', cockpit: 'COCKPIT', chase: 'CHASE', rear: 'REAR', flyby: 'FLYBY', cinematic: 'CINEMATIC',
  wingL: 'LEFT WING', wingR: 'RIGHT WING', gear: 'LANDING GEAR',
};
// Bildirim satırı için cümle düzeninde adlar (HUD büyük harfli adları kullanır)
export const CAMERA_LABELS = {
  orbit: 'Free', cockpit: 'Cockpit', chase: 'Chase', rear: 'Rear', flyby: 'Flyby', cinematic: 'Cinematic',
  wingL: 'Left wing', wingR: 'Right wing', gear: 'Landing gear',
};
// Uçak gövdesini saran elipsoit (gövde ekseninde yarı eksenler, m): serbest kamera içine giremez
const BODY_ELLIPSOID = [6.2, 2.7, 8.9];
// Sinematik kamera: ekrandaki uçak boyu (m, görüş alanının kapsadığı genişlik) ve FOV sınırları
const CINE_FRAME = 34, CINE_FOV = [4, 50];

const DEG = Math.PI / 180;
// Kokpit serbest bakış sınırları: boyun hareketi kadar, daha fazlası değil.
const LOOK_YAW = 145 * DEG;
const LOOK_UP = 78 * DEG;
const LOOK_DOWN = 72 * DEG;
// Bakış yumuşatma zaman sabiti (s). Küçük = daha doğrudan, büyük = daha yumuşak.
const LOOK_TAU = 0.075;
const ORBIT_TAU = 0.10;

export class CameraRig {
  constructor(camera, aircraft, world = null, cfg = null) {
    this.camera = camera;
    this.aircraft = aircraft;
    this.world = world;
    this.setConfig(cfg);
    this.modeIndex = 0;                    // 0 = 'orbit' = SERBEST KAMERA (varsayılan)
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    // Serbest kamera: hedef ve yumuşatılmış geçerli değer ayrı tutulur
    this.orbit = { yaw: 0.65, pitch: 0.22, dist: (this.cfg && this.cfg.orbit.dist) || 28 };
    this.orbitT = { yaw: 0.65, pitch: 0.22, dist: this.orbit.dist };
    // Kokpit serbest bakış
    this.lookOff = { yaw: 0, pitch: 0 };
    this.lookT = { yaw: 0, pitch: 0 };
    this._eye = new THREE.Vector3(); this._look = new THREE.Vector3();
    this.flybyPos = new THREE.Vector3();
    this.flybyPlaced = false;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._up = new THREE.Vector3(); this._right = new THREE.Vector3();
    this._q = new THREE.Quaternion(); this._q2 = new THREE.Quaternion();
    this._ax = new THREE.Vector3();
    this._shakeE = new THREE.Euler(); this.trauma = 0;
    // Kip geçişi: önceki kameranın UÇAĞA GÖRE pozundan yeni kipe yumuşak geçiş
    this.blend = null; this._bp = new THREE.Vector3(); this._bq = new THREE.Quaternion(); this._qi = new THREE.Quaternion();
    this.chaseZoom = 1;      // takip kamerası uzaklık çarpanı (iki parmak / tekerlek)
    this.fovScale = 1;       // ayarlardan: dar / normal / geniş görüş açısı
    this.initialized = false;
    this.doppler = 1;
    this.distance = 0;
  }

  // Kamera yerleşimleri uçak yapılandırmasından (fleet.js) gelir
  setConfig(cfg) {
    this.cfg = cfg ? cfg.cameras : null;
    if (!this.cfg) return;
    this.orbit = this.orbit || { yaw: 0.65, pitch: 0.22, dist: this.cfg.orbit.dist };
    this.orbitT = this.orbitT || { yaw: 0.65, pitch: 0.22, dist: this.cfg.orbit.dist };
    this.orbit.dist = this.orbitT.dist = this.cfg.orbit.dist;
    this.initialized = false; this.flybyPlaced = false;
    if (this.camera) this.applyMode();
  }
  setAircraft(aircraft, cfg) { this.aircraft = aircraft; this.setConfig(cfg); }

  get mode() { return CAMERA_MODES[this.modeIndex]; }

  setMode(m) {
    const i = CAMERA_MODES.indexOf(m);
    if (i < 0) return false;
    this.modeIndex = i;
    this.onModeChanged();
    return true;
  }
  next() { this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length; this.onModeChanged(); }

  onModeChanged() {
    // Geçiş başlangıcı: şu anki kamera pozu uçağın yerel çerçevesinde saklanır; her karede uçağın
    // güncel pozuyla yeniden kurulur. Böylece 250 m/s'de de kamera geride kalmadan, ~0,55 s'de
    // yumuşakça yeni kipe akar (konum doğrusal, yönelim küresel ara değer). Yalnızca görseldir.
    if (this._lastPose && this.camera) {
      const P = this._lastPose, inv = this._qi.copy(P.quat).invert();
      this.blend = {
        t: 0, dur: 0.55, fov0: this.camera.fov,
        relPos: this.camera.position.clone().sub(P.pos).applyQuaternion(inv),
        relQuat: inv.clone().multiply(this.camera.quaternion),
      };
    }
    this.initialized = false;      // takip kamerası yeni yerine ışınlanmadan oturur
    this.flybyPlaced = false;
    // Kokpite her girişte bakış ileriye toplanır: oyuncu geçen seferki açıyla karşılaşmaz
    this.lookOff.yaw = this.lookOff.pitch = 0;
    this.lookT.yaw = this.lookT.pitch = 0;
    this.applyMode();
  }

  applyMode() {
    const c = this.cfg, m = this.mode;
    if (!c) return;
    const fov = m === 'cockpit' ? c.cockpitFov : m === 'orbit' ? c.orbit.fov : (m === 'flyby' || m === 'cinematic') ? c.flyby.fov
      : m === 'gear' ? c.gear.fov : (m === 'wingL' || m === 'wingR') ? c.wing.fov : c.chase.fov;
    this.camera.fov = Math.min(100, fov * (this.fovScale || 1));
    this.targetFov = this.camera.fov;
    // Gövdeye yakın görünümlerde yakın düzlem küçülür; dış görünümlerde derinlik hassasiyeti korunur
    this.camera.near = (m === 'cockpit' || m === 'wingL' || m === 'wingR' || m === 'gear') ? c.cockpitNear : 1.0;
    this.camera.updateProjectionMatrix();
    // Kokpite geçişte dış model (pilot, kanopi dış yüzü) geçiş bitene kadar korunur
    if (this.aircraft) this.aircraft.setCockpitView(m === 'cockpit' && !this.blend);
  }

  /**
   * Bakış sürükleme. Serbest kamerada yörüngeyi, kokpitte baş dönüşünü sürer.
   * Girdi doğrudan HEDEFE yazılır; kamera hedefe yumuşak yaklaşır. Parmak kalkınca
   * hedef sabitlenir ve hareket temiz biçimde durur (atalet yok).
   */
  drag(dx, dy) {
    if (this.mode === 'orbit') {
      this.orbitT.yaw -= dx * 0.0062;
      // Alttan ve üstten bakılabilsin: eski ±(-0,2..1,3) aralığı uçağın altını göstermiyordu
      this.orbitT.pitch = clamp(this.orbitT.pitch + dy * 0.0062, -1.15, 1.40);
    } else if (this.mode === 'cockpit') {
      this.lookT.yaw = clamp(this.lookT.yaw - dx * 0.0042, -LOOK_YAW, LOOK_YAW);
      this.lookT.pitch = clamp(this.lookT.pitch - dy * 0.0042, -LOOK_DOWN, LOOK_UP);
    }
  }

  zoom(f) {
    if (this.mode === 'chase') { this.chaseZoom = clamp(this.chaseZoom / f, 0.6, 2.2); return; }
    if (this.mode !== 'orbit') return;
    this.orbitT.dist = clamp(this.orbitT.dist / f, this.cfg.orbit.min, this.cfg.orbit.max);
  }

  /** Kokpit bakışını ileri toplar (çift dokunuş / tuş ile). */
  recenterLook() { this.lookT.yaw = this.lookT.pitch = 0; }

  reset() { this.initialized = false; this.flybyPlaced = false; this.blend = null; }

  placeFlyby(fm) {
    const pos = fm.pos, vel = fm.vel;
    const V = Math.max(vel.length(), 30);
    const dir = this._v.copy(vel).normalize();
    if (vel.length() < 5) dir.set(0, 0, -1).applyQuaternion(fm.quat);
    const side = this._right.set(dir.z, 0, -dir.x).normalize(); // dir'e dik yatay
    const fb = this.cfg.flyby;
    const ahead = clamp(V * fb.vScale, fb.ahead[0], fb.ahead[1]);
    const sideSign = Math.random() < 0.5 ? -1 : 1;
    this.flybyPos.copy(pos).addScaledVector(dir, ahead).addScaledVector(side, sideSign * (fb.side[0] + Math.random() * (fb.side[1] - fb.side[0])));
    this.flybyPos.y += (Math.random() - 0.4) * 40;
    if (this.world) {
      const g = this.world.heightAt(this.flybyPos.x, this.flybyPos.z);
      this.flybyPos.y = Math.max(this.flybyPos.y, g + this.cfg.flyby.up);
    }
    this.flybyPlaced = true;
  }

  /**
   * Kısa sarsıntı darbesi (füze ateşlemesi, yakın patlama). amount 0..1; birikir, üstel söner.
   * Yalnızca kameranın YÖNELİMİNE küçük açısal sapma ekler (konum değişmez, uçak titremez).
   */
  shake(amount) { this.trauma = Math.min(1, (this.trauma || 0) + amount); }

  // ---------------------------------------------------------------------------
  // Kaza kamerası. Gövdeye bağlı görünümler (kokpit, kanat, takım) ve gövde eksenini izleyen
  // takip kamerası takla atan enkazla birlikte döneceği için, kaza anında kamera o anki
  // pozundan (ışınlanmadan) dışarıdan bakan bir kaza görünümüne YUMUŞAKÇA geçer: konum
  // doğrusal, yönelim küresel ara değerle, ~1,2 s smoothstep. Serbest kamera ve uçuş geçişi
  // kamerası zaten dışarıdan baktığı için korunur. Sarsıntı şiddetle orantılıdır.
  // ---------------------------------------------------------------------------
  beginCrash(fm, severity, shake) {
    const cam = this.camera;
    const keep = this.mode === 'orbit' || this.mode === 'flyby' || this.mode === 'cinematic';
    this.crash = {
      t: 0, keep, severity,
      fromPos: cam.position.clone(), fromQuat: cam.quaternion.clone(),
      impact: fm.pos.clone(),
      off: new THREE.Vector3(), look: fm.pos.clone(), pos: cam.position.clone(),
    };
    // Kaza görünümünün ofseti: çarpmadan önceki hareket yönünün gerisinde, yanda ve yukarıda
    // (dünya ekseninde sabit: enkaz takla atsa da kamera dönmez)
    const v = this._v.copy(fm.vel); v.y = 0;
    if (v.lengthSq() < 1) v.set(0, 0, -1).applyQuaternion(fm.quat).setY(0);
    v.normalize();
    const side = this._right.set(-v.z, 0, v.x);
    const sev = { minor: 0.8, major: 1, critical: 1.25, catastrophic: 1.6 }[severity] || 1;
    this.crash.off.copy(v).multiplyScalar(-34 * sev).addScaledVector(side, 16 * sev).setY(10 + 6 * sev);
    if (this.aircraft) this.aircraft.setCockpitView(false);
    if (!keep && this.cfg) { cam.near = 1.0; cam.fov = this.cfg.chase.fov; cam.updateProjectionMatrix(); }
    this.shake(shake);
  }
  endCrash() {
    this.crash = null;
    this.trauma = 0;
    this.applyMode();
    this.initialized = false;
  }
  _updateCrash(dt, fm) {
    const C = this.crash, cam = this.camera;
    C.t += dt;
    if (C.keep) { this._update(dt, fm); return; }
    // Geçişin başlangıç KONUMU önceki kipin canlı pozudur (kokpit/takip enkazla birlikte
    // ilerler, kamera geride kopup kalmaz); başlangıç YÖNELİMİ ise kaza anında dondurulur
    // (takla atan gövdeyle birlikte dönmez).
    if (C.t < 1.2) { this._update(dt, fm); C.fromPos.copy(cam.position); }
    // Bakış hedefi: enkaz (yıkıcı çarpmada çarpma noktasına yakın: ateş topu oradadır)
    const target = this._v2.copy(fm.pos);
    if (C.severity === 'catastrophic') target.lerp(C.impact, 0.55);
    const k = 1 - Math.exp(-dt / 0.35);
    C.look.lerp(target, k);
    C.pos.lerp(this._v.copy(C.look).add(C.off), k);
    if (this.world) {
      const g = this.world.heightAt(C.pos.x, C.pos.z);
      if (C.pos.y < g + 3) C.pos.y = g + 3;
    }
    // Hedef poz
    const tq = this._q2;
    this._eye.copy(C.pos);
    cam.position.copy(C.pos); cam.up.set(0, 1, 0); cam.lookAt(this._look.copy(C.look).setY(C.look.y + 1.5));
    tq.copy(cam.quaternion);
    // Geçiş: kaza anındaki pozdan hedef poza (ışınlanma yok)
    const u = Math.min(1, C.t / 1.2), s = u * u * (3 - 2 * u);
    cam.position.lerpVectors(C.fromPos, this._eye, s);
    cam.quaternion.slerpQuaternions(C.fromQuat, tq, s);
  }

  update(dt, fm) {
    this._lastPose = fm;
    if (this.crash) this._updateCrash(dt, fm);
    else {
      this._update(dt, fm);
      if (this.blend) this._applyBlend(dt, fm);
    }
    if (this.trauma > 0.001) {
      const t = (fm.time || 0), k = this.trauma * this.trauma;
      const ax = (Math.sin(t * 39.1) * 0.6 + Math.sin(t * 71.7 + 1.3) * 0.4) * 0.022 * k;
      const ay = (Math.sin(t * 43.3 + 2.1) * 0.6 + Math.sin(t * 67.9) * 0.4) * 0.022 * k;
      const az = Math.sin(t * 29.7 + 0.7) * 0.012 * k;
      this.camera.quaternion.multiply(this._q.setFromEuler(this._shakeE.set(ax, ay, az)));
      this.trauma *= Math.exp(-dt * 3.2);
    } else this.trauma = 0;
  }

  _applyBlend(dt, fm) {
    const B = this.blend, cam = this.camera;
    B.t += dt;
    const u = Math.min(1, B.t / B.dur), s = u * u * (3 - 2 * u);
    this._bp.copy(B.relPos).applyQuaternion(fm.quat).add(fm.pos);
    this._bq.copy(fm.quat).multiply(B.relQuat);
    cam.position.lerpVectors(this._bp, cam.position, s);
    cam.quaternion.slerpQuaternions(this._bq, cam.quaternion, s);
    const f = B.fov0 + (this.targetFov - B.fov0) * s;
    if (Math.abs(cam.fov - f) > 1e-3) { cam.fov = f; cam.updateProjectionMatrix(); }
    if (u >= 1) {
      this.blend = null;
      if (this.aircraft) this.aircraft.setCockpitView(this.mode === 'cockpit');
    }
  }

  _update(dt, fm) {
    const cam = this.camera;
    const pos = fm.pos, quat = fm.quat;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(quat);
    const buffet = (fm.telemetry && fm.telemetry.buffet) || 0;
    const t = fm.time || 0;
    this.doppler = 1; this.distance = 0;
    const C = this.cfg;
    const shake = C.shake === undefined ? 1 : C.shake;

    if (this.mode === 'cockpit') {
      // Göz noktası uçakla birlikte taşınır ve döner
      cam.position.copy(this._eye.fromArray(C.cockpitEye)).applyQuaternion(quat).add(pos);
      // Serbest bakış: hedefe üstel yaklaşma (kare hızından bağımsız)
      const k = 1 - Math.exp(-dt / LOOK_TAU);
      this.lookOff.yaw += (this.lookT.yaw - this.lookOff.yaw) * k;
      this.lookOff.pitch += (this.lookT.pitch - this.lookOff.pitch) * k;
      // Baş dönüşü GÖVDE eksenlerinde uygulanır: önce uçağın yönelimi, sonra
      // yerel yatay (yukarı) ekseni etrafında yaw, sonra yerel yanal eksende pitch.
      // Taban eğimi: pilot bakışı doğal olarak ufkun biraz ALTINA yönelir. Böylece
      // hem pist hem gösterge panelinin üst kısmı varsayılan görüşe girer.
      const basePitch = C.cockpitPitch || 0;
      cam.quaternion.copy(quat);
      const yawOff = this.lookOff.yaw, pitchOff = this.lookOff.pitch + basePitch;
      if (yawOff) cam.quaternion.multiply(this._q.setFromAxisAngle(this._ax.set(0, 1, 0), yawOff));
      if (pitchOff) cam.quaternion.multiply(this._q2.setFromAxisAngle(this._ax.set(1, 0, 0), pitchOff));
      // Sarsıntı yalnızca gerçek buffet'te ve çok hafif: abartılı kafa sallanması yok
      if (buffet > 0.01) {
        const sx = Math.sin(t * 61) * Math.sin(t * 17) * 0.010 * buffet * shake;
        const sy = Math.sin(t * 53 + 1) * Math.sin(t * 23) * 0.010 * buffet * shake;
        cam.position.addScaledVector(this._right.set(1, 0, 0).applyQuaternion(quat), sx).addScaledVector(up, sy);
      }
      return;
    }

    // Gövdeye sabit görünümler: kanat ve iniş takımı kameraları (uçakla birlikte döner)
    if (this.mode === 'wingL' || this.mode === 'wingR' || this.mode === 'gear') {
      const spec = this.mode === 'gear' ? C.gear : C.wing;
      const mirror = this.mode === 'wingL' ? -1 : 1;
      this._eye.set(spec.eye[0] * mirror, spec.eye[1], spec.eye[2]).applyQuaternion(quat).add(pos);
      this._look.set(spec.look[0] * mirror, spec.look[1], spec.look[2]).applyQuaternion(quat).add(pos);
      cam.position.copy(this._eye);
      cam.up.copy(up);
      cam.lookAt(this._look);
      return;
    }

    if (this.mode === 'orbit') {
      // Hedefe yumuşak yaklaşma: sürükleme ve yakınlaştırma basamaklı değil akıcı hissedilir
      const o = this.orbit, T = this.orbitT;
      const k = 1 - Math.exp(-dt / ORBIT_TAU);
      o.yaw += (T.yaw - o.yaw) * k;
      o.pitch += (T.pitch - o.pitch) * k;
      o.dist += (T.dist - o.dist) * k;
      const cy = Math.cos(o.pitch), sy = Math.sin(o.pitch);
      cam.position.set(Math.sin(o.yaw) * cy * o.dist, sy * o.dist + C.orbit.lookUp * 1.5, Math.cos(o.yaw) * cy * o.dist).add(pos);
      // Gövdenin içine girmesin: gövde ekseninde elipsoit dışına itilir (yakın yakınlaştırmada)
      {
        const qi = this._q.copy(quat).invert();
        const r = this._v2.copy(cam.position).sub(pos).applyQuaternion(qi);
        const [ex, ey, ez] = BODY_ELLIPSOID;
        const s = Math.hypot(r.x / ex, r.y / ey, r.z / ez);
        if (s < 1 && s > 1e-6) cam.position.copy(r.multiplyScalar(1 / s).applyQuaternion(quat)).add(pos);
      }
      // Yere gömülmesin: zemin altına inen serbest kamera sahneyi kaybettiriyordu
      if (this.world) {
        const g = this.world.heightAt(cam.position.x, cam.position.z);
        if (cam.position.y < g + 2) cam.position.y = g + 2;
      }
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y + C.orbit.lookUp, pos.z);
      return;
    }

    if (this.mode === 'rear') {
      // Arka kamera: kuyruğun gerisinde ve üstünde, gövdeye SABİT (gecikme yok); uçak ekranda
      // hiç kaymaz. Araziye gömülmez.
      this._eye.set(0, 2.9, 21.5).applyQuaternion(quat).add(pos);
      this._look.set(0, 1.1, -40).applyQuaternion(quat).add(pos);
      if (this.world) { const g = this.world.heightAt(this._eye.x, this._eye.z); if (this._eye.y < g + 1.5) this._eye.y = g + 1.5; }
      cam.position.copy(this._eye);
      cam.up.copy(up);
      cam.lookAt(this._look);
      return;
    }

    if (this.mode === 'cinematic') {
      // Yer gözlemcisi gibi izleyen kamera: uçuş yolunun ilerisine/yanına yerleşir, bakış hedefi
      // kritik sönümlü yaklaşır (kare hızından bağımsız), FOV uçağın ekrandaki boyunu sabit tutar.
      // Uçak 1,8 km'den uzaklaşınca ileriye yeniden yerleşir.
      if (!this.flybyPlaced || cam.position.distanceTo(pos) > C.flyby.reset * 1.4) {
        this.placeFlyby(fm);
        this.cine = { look: pos.clone(), v: new THREE.Vector3() };
      }
      const L = this.cine, w = 9.0, h = Math.min(dt, 0.05);
      // kritik sönümlü yay (ω = 9/s): hedefin gerisinde kalmaz, aşmaz
      const acc = this._v2.copy(pos).sub(L.look).multiplyScalar(w * w).addScaledVector(L.v, -2 * w);
      L.v.addScaledVector(acc, h); L.look.addScaledVector(L.v, h);
      cam.position.copy(this.flybyPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(L.look);
      const d = this.flybyPos.distanceTo(pos) || 1;
      const fovT = clamp(2 * Math.atan(CINE_FRAME / (2 * d)) / DEG, CINE_FOV[0], CINE_FOV[1]) * (this.fovScale || 1);
      const f = cam.fov + (fovT - cam.fov) * (1 - Math.exp(-dt / 0.35));
      if (Math.abs(f - cam.fov) > 1e-3) { cam.fov = f; cam.updateProjectionMatrix(); }
      const toCam = this._v2.copy(this.flybyPos).sub(pos);
      const vr = fm.vel.dot(toCam) / d;
      this.doppler = clamp(340 / (340 - clamp(vr, -300, 300)), 0.6, 1.6);
      this.distance = d;
      return;
    }

    if (this.mode === 'flyby') {
      if (!this.flybyPlaced || cam.position.distanceTo(pos) > C.flyby.reset) this.placeFlyby(fm);
      cam.position.copy(this.flybyPos);
      cam.up.set(0, 1, 0);
      cam.lookAt(pos);
      // Doppler: uçağın kameraya yaklaşma hızı
      const toCam = this._v2.copy(this.flybyPos).sub(pos);
      const d = toCam.length() || 1;
      const vr = fm.vel.dot(toCam) / d;      // pozitif: yaklaşıyor
      this.doppler = clamp(340 / (340 - clamp(vr, -300, 300)), 0.6, 1.6);
      this.distance = d;
      return;
    }

    // Takip kamerası: uçağın gerisinde, uçağa göre SABİT bir ofsette durur; yalnızca
    // ofsetin YÖNÜ kısa bir zaman sabitiyle (≈0,12 s) gövde yönelimini izler.
    // Eskiden dünya konumu 5/s oranıyla izleniyordu: konum gecikmesi hızla doğru
    // orantılı büyüdüğünden 250 m/s'de kamera hedefinin ~50 m gerisinde kalıyor,
    // sert dönüşte dışa savruluyor ve uçak ekran merkezinden kayıyordu. Şimdi uçak
    // her hızda aynı yerde görünür, sert manevrada yalnızca birkaç derece kayar ve
    // geri gelir. Üstel yaklaşım kare hızından bağımsızdır.
    const speed = fm.vel.length();
    const ch = C.chase;
    const dist = (ch.dist[0] + Math.min(speed / ch.vRef, 1) * (ch.dist[1] - ch.dist[0])) * this.chaseZoom;
    const desired = this._v2.copy(fwd).multiplyScalar(-dist).addScaledVector(up, ch.up);
    const off = this.chaseOff || (this.chaseOff = new THREE.Vector3());
    const cup = this.chaseUp || (this.chaseUp = new THREE.Vector3(0, 1, 0));
    const upT = this._ax.set(0, 1, 0).lerp(up, 0.4).normalize();
    if (!this.initialized) { off.copy(desired); cup.copy(upT); this.initialized = true; }
    const k = 1 - Math.exp(-dt / (ch.lag || 0.12));
    off.lerp(desired, k).setLength(desired.length());
    cup.lerp(upT, k).normalize();
    this.pos.copy(pos).add(off);
    // Araziye gömülmesin (alçak, ters ya da dik dalışta kamera zemin altına inmiyor)
    if (this.world) {
      const g = this.world.heightAt(this.pos.x, this.pos.z);
      if (this.pos.y < g + 1.8) this.pos.y = g + 1.8;
    }
    cam.position.copy(this.pos);
    if (buffet > 0.01) cam.position.addScaledVector(up, Math.sin(t * 57) * Math.sin(t * 19) * 0.08 * buffet * shake).addScaledVector(this._right.set(1, 0, 0).applyQuaternion(quat), Math.sin(t * 47 + 2) * 0.06 * buffet * shake);
    cam.up.copy(cup);
    this.look.copy(pos).addScaledVector(fwd, ch.ahead).addScaledVector(up, ch.lookUp);
    cam.lookAt(this.look);
  }
}
