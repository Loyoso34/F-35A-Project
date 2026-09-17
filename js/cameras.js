// Kameralar: takip (chase), kokpit, serbest yörünge, uçuş geçişi (sabit dış kamera, Doppler için).
import * as THREE from 'three';
import { clamp } from './noise.js';

export const CAMERA_MODES = ['chase', 'cockpit', 'orbit', 'flyby', 'wingL', 'wingR', 'gear'];
export const CAMERA_NAMES = { chase: 'TAKİP', cockpit: 'KOKPİT', orbit: 'SERBEST', flyby: 'UÇUŞ GEÇİŞİ', wingL: 'SOL KANAT', wingR: 'SAĞ KANAT', gear: 'İNİŞ TAKIMI' };

export class CameraRig {
  constructor(camera, aircraft, world = null, cfg = null) {
    this.camera = camera;
    this.aircraft = aircraft;
    this.world = world;
    this.setConfig(cfg);
    this.modeIndex = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.orbit = { yaw: 0.6, pitch: 0.22, dist: (this.cfg && this.cfg.orbit.dist) || 28 };
    this._eye = new THREE.Vector3(); this._look = new THREE.Vector3();
    this.flybyPos = new THREE.Vector3();
    this.flybyPlaced = false;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._up = new THREE.Vector3(); this._right = new THREE.Vector3();
    this.initialized = false;
    this.doppler = 1;
    this.distance = 0;
  }
  // Uçak değişince kamera yerleşimleri yeni uçağın yapılandırmasından gelir
  setConfig(cfg) {
    this.cfg = cfg ? cfg.cameras : null;
    if (!this.cfg) return;
    this.orbit = this.orbit || { yaw: 0.6, pitch: 0.22, dist: this.cfg.orbit.dist };
    this.orbit.dist = this.cfg.orbit.dist;
    this.initialized = false; this.flybyPlaced = false;
    if (this.camera) this.applyMode();
  }
  setAircraft(aircraft, cfg) { this.aircraft = aircraft; this.setConfig(cfg); }
  get mode() { return CAMERA_MODES[this.modeIndex]; }
  next() { this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length; this.initialized = false; this.flybyPlaced = false; this.applyMode(); }
  applyMode() {
    const c = this.cfg, m = this.mode;
    if (!c) return;
    const fov = m === 'cockpit' ? c.cockpitFov : m === 'orbit' ? c.orbit.fov : m === 'flyby' ? c.flyby.fov
      : m === 'gear' ? c.gear.fov : (m === 'wingL' || m === 'wingR') ? c.wing.fov : c.chase.fov;
    this.camera.fov = fov;
    // Gövdeye yakın görünümlerde yakın düzlem küçülür; dış görünümlerde derinlik hassasiyeti korunur
    this.camera.near = (m === 'cockpit' || m === 'wingL' || m === 'wingR' || m === 'gear') ? c.cockpitNear : 1.0;
    this.camera.updateProjectionMatrix();
    if (this.aircraft) this.aircraft.setCockpitView(m === 'cockpit');
  }
  drag(dx, dy) {
    if (this.mode !== 'orbit') return;
    this.orbit.yaw -= dx * 0.006;
    this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.006, -0.2, 1.3);
  }
  zoom(f) {
    if (this.mode !== 'orbit') return;
    this.orbit.dist = clamp(this.orbit.dist / f, this.cfg.orbit.min, this.cfg.orbit.max);
  }
  reset() { this.initialized = false; this.flybyPlaced = false; }

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

  update(dt, fm) {
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
      cam.position.copy(this._eye.fromArray(C.cockpitEye)).applyQuaternion(quat).add(pos);
      cam.quaternion.copy(quat);
      if (buffet > 0.01) {
        const sx = Math.sin(t * 61) * Math.sin(t * 17) * 0.012 * buffet * shake, sy = Math.sin(t * 53 + 1) * Math.sin(t * 23) * 0.012 * buffet * shake;
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
      const o = this.orbit;
      const cy = Math.cos(o.pitch), sy = Math.sin(o.pitch);
      cam.position.set(Math.sin(o.yaw) * cy * o.dist, sy * o.dist + C.orbit.lookUp * 1.5, Math.cos(o.yaw) * cy * o.dist).add(pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y + C.orbit.lookUp, pos.z);
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
    // Takip kamerası: uçağın gerisinde, ufka göre seviyeli (görüş ekseni ileriye bakar)
    const speed = fm.vel.length();
    const ch = C.chase;
    const dist = ch.dist[0] + Math.min(speed / ch.vRef, 1) * (ch.dist[1] - ch.dist[0]);
    const desired = this._v2.copy(pos).addScaledVector(fwd, -dist).addScaledVector(up, ch.up);
    if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
    this.pos.lerp(desired, 1 - Math.exp(-dt * 5));
    cam.position.copy(this.pos);
    if (buffet > 0.01) cam.position.addScaledVector(up, Math.sin(t * 57) * Math.sin(t * 19) * 0.08 * buffet * shake).addScaledVector(this._right.set(1, 0, 0).applyQuaternion(quat), Math.sin(t * 47 + 2) * 0.06 * buffet * shake);
    cam.up.set(0, 1, 0).lerp(up, 0.4).normalize();
    this.look.copy(pos).addScaledVector(fwd, ch.ahead).addScaledVector(up, ch.lookUp);
    cam.lookAt(this.look);
  }
}
