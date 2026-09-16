// Kameralar: takip (chase), kokpit, serbest yörünge (sürükle-döndür, pinch-yakınlaştır).
import * as THREE from 'three';
import { F35 } from './aircraft.js';
import { clamp } from './noise.js';

export const CAMERA_MODES = ['chase', 'cockpit', 'orbit'];
export const CAMERA_NAMES = { chase: 'TAKİP', cockpit: 'KOKPİT', orbit: 'SERBEST' };

export class CameraRig {
  constructor(camera, aircraft) {
    this.camera = camera;
    this.aircraft = aircraft;
    this.modeIndex = 0;
    this.pos = new THREE.Vector3();
    this.look = new THREE.Vector3();
    this.orbit = { yaw: 0.6, pitch: 0.22, dist: 28 };
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._up = new THREE.Vector3();
    this.initialized = false;
  }
  get mode() { return CAMERA_MODES[this.modeIndex]; }
  next() { this.modeIndex = (this.modeIndex + 1) % CAMERA_MODES.length; this.initialized = false; this.applyMode(); }
  applyMode() {
    const m = this.mode;
    this.camera.fov = m === 'cockpit' ? 72 : m === 'orbit' ? 50 : 60;
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
  reset() { this.initialized = false; }

  update(dt, fm) {
    const cam = this.camera;
    const pos = fm.pos, quat = fm.quat;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(quat);
    if (this.mode === 'cockpit') {
      cam.position.copy(F35.pilotEye).applyQuaternion(quat).add(pos);
      cam.quaternion.copy(quat);
      return;
    }
    if (this.mode === 'orbit') {
      const o = this.orbit;
      const cy = Math.cos(o.pitch), sy = Math.sin(o.pitch);
      const target = this._v2.set(Math.sin(o.yaw) * cy * o.dist, sy * o.dist + 1.5, Math.cos(o.yaw) * cy * o.dist).add(pos);
      cam.position.copy(target);
      cam.up.set(0, 1, 0);
      cam.lookAt(pos.x, pos.y + 1, pos.z);
      return;
    }
    // Takip kamerası: uçağın gerisinde, yumuşatılmış
    const speed = fm.vel.length();
    const dist = 24 + Math.min(speed / 300, 1) * 8;
    const desired = this._v2.copy(pos).addScaledVector(fwd, -dist).addScaledVector(up, 4.5);
    // Kanat üstü yatışta bir miktar roll paylaş
    if (!this.initialized) { this.pos.copy(desired); this.initialized = true; }
    const s = 1 - Math.exp(-dt * 5);
    this.pos.lerp(desired, s);
    // Yerin altına inmesin
    cam.position.copy(this.pos);
    const worldUp = new THREE.Vector3(0, 1, 0);
    cam.up.copy(worldUp).lerp(up, 0.35).normalize();
    this.look.copy(pos).addScaledVector(fwd, 12);
    cam.lookAt(this.look);
  }
}
