// Kameralar: takip (chase), kokpit, serbest yörünge, uçuş geçişi (sabit dış kamera, Doppler için).
import * as THREE from 'three';
import { F35 } from './aircraft.js';
import { clamp } from './noise.js';

export const CAMERA_MODES = ['chase', 'cockpit', 'orbit', 'flyby'];
export const CAMERA_NAMES = { chase: 'TAKİP', cockpit: 'KOKPİT', orbit: 'SERBEST', flyby: 'UÇUŞ GEÇİŞİ' };

export class CameraRig {
  constructor(camera, aircraft, world = null) {
    this.camera = camera;
    this.aircraft = aircraft;
    this.world = world;
    this.modeIndex = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.orbit = { yaw: 0.6, pitch: 0.22, dist: 28 };
    this.flybyPos = new THREE.Vector3();
    this.flybyPlaced = false;
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._up = new THREE.Vector3(); this._right = new THREE.Vector3();
    this.initialized = false;
    this.doppler = 1;
    this.distance = 0;
  }
  get mode() { return CAMERA_MODES[this.modeIndex]; }
  next() { this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length; this.initialized = false; this.flybyPlaced = false; this.applyMode(); }
  applyMode() {
    const m = this.mode;
    this.camera.fov = m === 'cockpit' ? 72 : m === 'orbit' ? 50 : m === 'flyby' ? 42 : 58;
    this.camera.near = m === 'cockpit' ? 0.25 : 0.5;
    this.camera.updateProjectionMatrix();
    this.aircraft.setCockpitView(m === 'cockpit');
  }
  drag(dx, dy) {
    if (this.mode !== 'orbit') return;
    this.orbit.yaw -= dx * 0.006;
    this.orbit.pitch = clamp(this.orbit.pitch + dy * 0.006, -0.2, 1.3);
  }
  zoom(f) {
    if (this.mode !== 'orbit') return;
    this.orbit.dist = clamp(this.orbit.dist / f, 8, 120);
  }
  reset() { this.initialized = false; this.flybyPlaced = false; }

  placeFlyby(fm) {
    const pos = fm.pos, vel = fm.vel;
    const V = Math.max(vel.length(), 30);
    const dir = this._v.copy(vel).normalize();
    if (vel.length() < 5) dir.set(0, 0, -1).applyQuaternion(fm.quat);
    const side = this._right.set(dir.z, 0, -dir.x).normalize(); // dir'e dik yatay
    const ahead = clamp(V * 4.5, 180, 900);
    const sideSign = Math.random() < 0.5 ? -1 : 1;
    this.flybyPos.copy(pos).addScaledVector(dir, ahead).addScaledVector(side, sideSign * (60 + Math.random() * 90));
    this.flybyPos.y += (Math.random() - 0.4) * 40;
    if (this.world) {
      const g = this.world.heightAt(this.flybyPos.x, this.flybyPos.z);
      this.flybyPos.y = Math.max(this.flybyPos.y, g + 3);
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
    if (this.mode === 'cockpit') {
      cam.position.copy(F35.pilotEye).applyQuaternion(quat).add(pos);
      cam.quaternion.copy(quat);
      if (buffet > 0.01) {
        const sx = Math.sin(t * 61) * Math.sin(t * 17) * 0.012 * buffet, sy = Math.sin(t * 53 + 1) * Math.sin(t * 23) * 0.012 * buffet;
        cam.position.addScaledVector(this._right.set(1, 0, 0).applyQuaternion(quat), sx).addScaledVector(up, sy);
      }
      return;
    }
    if (this.mode === 'orbit') {
      const o = this.orbit;
      const cy = Math.cos(o.pitch), sy = Math.sin(o.pitch);
      cam.position.set(Math.sin(o.yaw) * cy * o.dist, sy * o.dist + 1.5, Math.cos(o.yaw) * cy * o.dist).add(pos);
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y + 1, pos.z);
      return;
    }
    if (this.mode === 'flyby') {
      if (!this.flybyPlaced || cam.position.distanceTo(pos) > 1300) this.placeFlyby(fm);
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
    const dist = 21 + Math.min(speed / 320, 1) * 9;
    const desired = this._v2.copy(pos).addScaledVector(fwd, -dist).addScaledVector(up, 2.8);
    if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
    this.pos.lerp(desired, 1 - Math.exp(-dt * 5));
    cam.position.copy(this.pos);
    if (buffet > 0.01) cam.position.addScaledVector(up, Math.sin(t * 57) * Math.sin(t * 19) * 0.08 * buffet).addScaledVector(this._right.set(1, 0, 0).applyQuaternion(quat), Math.sin(t * 47 + 2) * 0.06 * buffet);
    cam.up.set(0, 1, 0).lerp(up, 0.4).normalize();
    this.look.copy(pos).addScaledVector(fwd, 70).addScaledVector(up, 1.5);
    cam.lookAt(this.look);
  }
}
