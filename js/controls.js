// Dokunmatik (Pointer Events, çoklu dokunuş), klavye ve isteğe bağlı eğim (DeviceOrientation) girişleri.
import { clamp } from './noise.js';

const STICK_RADIUS = 60; // px
const AB_DETENT = 1.0;   // gaz kolu 0..1.15; 1.0 üzeri art yakıcı

export class Controls {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.state = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };
    this.lever = 0; // 0..1.15
    this.enabled = false;
    this.keys = new Set();
    this.stickPointer = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.stickVec = { x: 0, y: 0 };
    this.throttlePointer = null;
    this.rudder = 0;           // -1..1 (kaydırıcı)
    this.rudderHeld = false;
    this.rudderPointer = null;
    this.rudderKey = 0;
    this.tiltEnabled = false;
    this.tilt = { beta: 0, gamma: 0, has: false };
    this.tiltZero = { beta: 0, gamma: 0 };
    this.tiltOut = { pitch: 0, roll: 0 };
    this.viewPointers = new Map();
    this.lastPinchDist = 0;
    this.els = {
      stickZone: document.getElementById('stick-zone'),
      stickBase: document.getElementById('stick-base'),
      stickKnob: document.getElementById('stick-knob'),
      throttle: document.getElementById('throttle'),
      throttleTrack: document.getElementById('throttle-track'),
      throttleKnob: document.getElementById('throttle-knob'),
      throttleFill: document.getElementById('throttle-fill'),
      touch: document.getElementById('touch'),
      rudder: document.getElementById('rudder'),
      rudderKnob: document.getElementById('rudder-knob'),
    };
    this.bindStick();
    this.bindThrottle();
    this.bindRudder();
    this.bindButtons();
    this.bindKeyboard();
    this.bindView();
    this.onOrientation = (e) => {
      if (e.beta === null || e.beta === undefined) return;
      this.tilt.beta = e.beta; this.tilt.gamma = e.gamma; this.tilt.has = true;
    };
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    this.setThrottleUI();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) { this.releaseStick(); this.rudderHeld = false; this.rudderPointer = null; this.keys.clear(); }
  }

  // ---- Joystick ----
  bindStick() {
    const z = this.els.stickZone;
    z.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null || !this.enabled) return;
      if (e.target.closest && e.target.closest('.btn')) return;
      this.stickPointer = e.pointerId;
      z.setPointerCapture && z.setPointerCapture(e.pointerId);
      const r = z.getBoundingClientRect();
      this.stickOrigin = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.els.stickBase.style.left = (this.stickOrigin.x - 60) + 'px';
      this.els.stickBase.style.top = (this.stickOrigin.y - 60) + 'px';
      this.els.stickBase.style.bottom = 'auto';
      this.updateStick(e);
      e.preventDefault();
    });
    z.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickPointer) this.updateStick(e); });
    const end = (e) => { if (e.pointerId === this.stickPointer) this.releaseStick(); };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
  }
  updateStick(e) {
    const r = this.els.stickZone.getBoundingClientRect();
    let dx = e.clientX - r.left - this.stickOrigin.x;
    let dy = e.clientY - r.top - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
    this.stickVec = { x: dx / STICK_RADIUS, y: dy / STICK_RADIUS };
    this.els.stickKnob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  releaseStick() {
    this.stickPointer = null;
    this.stickVec = { x: 0, y: 0 };
    this.els.stickKnob.style.transform = 'translate(0px, 0px)';
    const b = this.els.stickBase.style;
    b.left = ''; b.top = ''; b.bottom = '';
  }

  // ---- Gaz kolu ----
  bindThrottle() {
    const t = this.els.throttle;
    t.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.throttlePointer = e.pointerId;
      t.setPointerCapture && t.setPointerCapture(e.pointerId);
      this.updateThrottle(e);
      e.preventDefault();
    });
    t.addEventListener('pointermove', (e) => { if (e.pointerId === this.throttlePointer) this.updateThrottle(e); });
    const end = (e) => { if (e.pointerId === this.throttlePointer) this.throttlePointer = null; };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
  }
  updateThrottle(e) {
    const r = this.els.throttleTrack.getBoundingClientRect();
    const f = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); // 0 alt, 1 üst
    this.lever = f * 1.15;
    // Art yakıcı bölgesine (üst %15) girildiğinde kademe: tam gaz + AB
    if (this.lever > 1.0 && this.lever < 1.06) this.lever = 1.0;
    this.setThrottleUI();
  }
  setThrottleUI() {
    const r = this.els.throttleTrack;
    const h = r.clientHeight || 200;
    const f = this.lever / 1.15;
    this.els.throttleKnob.style.top = (h * (1 - f)) + 'px';
    this.els.throttleFill.style.height = (f * 100) + '%';
    const ab = this.lever > AB_DETENT + 0.01;
    this.els.throttleKnob.textContent = ab ? 'AB' : Math.round(Math.min(this.lever, 1) * 100) + '%';
    this.els.throttleKnob.style.borderColor = ab ? '#ff9a3a' : '';
  }

  // ---- Yaylı analog rudder kaydırıcısı ----
  bindRudder() {
    const r = this.els.rudder;
    if (!r) return;
    const setFrom = (e) => {
      const rect = r.getBoundingClientRect();
      const half = rect.width / 2 - 22;
      this.rudder = clamp((e.clientX - (rect.left + rect.width / 2)) / half, -1, 1);
      this.updateRudderUI();
    };
    r.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.rudderPointer = e.pointerId;
      this.rudderHeld = true;
      r.setPointerCapture && r.setPointerCapture(e.pointerId);
      setFrom(e);
      e.preventDefault();
    });
    r.addEventListener('pointermove', (e) => { if (e.pointerId === this.rudderPointer && this.rudderHeld) setFrom(e); });
    const end = (e) => { if (e.pointerId === this.rudderPointer) { this.rudderHeld = false; this.rudderPointer = null; } };
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', end);
    r.addEventListener('lostpointercapture', end);
    r.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  updateRudderUI() {
    const r = this.els.rudder;
    if (!r) return;
    const half = r.clientWidth / 2 - 22;
    this.els.rudderKnob.style.transform = `translateX(${this.rudder * half}px)`;
  }

  // ---- Düğmeler ----
  bindButtons() {
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      let lastT = 0;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - lastT < 250) return; // çift tetiklemeyi önle
        lastT = now;
        fn();
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    tap('btn-gear', () => this.cb.onGear && this.cb.onGear());
    tap('btn-flap', () => this.cb.onFlaps && this.cb.onFlaps());
    tap('btn-brake', () => this.cb.onBrake && this.cb.onBrake());
    tap('btn-camera', () => this.cb.onCamera && this.cb.onCamera());
    tap('btn-sound', () => this.cb.onSound && this.cb.onSound());
    tap('btn-pause', () => this.cb.onPause && this.cb.onPause());
    tap('btn-lights', () => this.cb.onLights && this.cb.onLights());
  }

  // ---- Serbest kamera için sürükleme / pinch (merkez bölge) ----
  bindView() {
    const hud = document.getElementById('view-zone');
    if (!hud) return;
    hud.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.viewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      hud.setPointerCapture && hud.setPointerCapture(e.pointerId);
      if (this.viewPointers.size === 2) {
        const [a, b] = [...this.viewPointers.values()];
        this.lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      e.preventDefault();
    });
    hud.addEventListener('pointermove', (e) => {
      const p = this.viewPointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.viewPointers.size === 1) {
        this.cb.onViewDrag && this.cb.onViewDrag(dx, dy);
      } else if (this.viewPointers.size === 2) {
        const [a, b] = [...this.viewPointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.lastPinchDist > 0) this.cb.onViewPinch && this.cb.onViewPinch(d / this.lastPinchDist);
        this.lastPinchDist = d;
      }
    });
    const end = (e) => { this.viewPointers.delete(e.pointerId); this.lastPinchDist = 0; };
    hud.addEventListener('pointerup', end);
    hud.addEventListener('pointercancel', end);
    hud.addEventListener('wheel', (e) => { this.cb.onViewPinch && this.cb.onViewPinch(e.deltaY > 0 ? 1.1 : 0.9); e.preventDefault(); }, { passive: false });
  }

  // ---- Klavye ----
  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { this.keys.add(e.code); return; }
      this.keys.add(e.code);
      if (!this.enabled && e.code !== 'KeyP' && e.code !== 'Escape') return;
      switch (e.code) {
        case 'KeyG': this.cb.onGear && this.cb.onGear(); break;
        case 'KeyF': this.cb.onFlaps && this.cb.onFlaps(); break;
        case 'KeyB': this.cb.onBrake && this.cb.onBrake(); break;
        case 'KeyC': this.cb.onCamera && this.cb.onCamera(); break;
        case 'KeyM': this.cb.onSound && this.cb.onSound(); break;
        case 'KeyL': this.cb.onLights && this.cb.onLights(); break;
        case 'KeyP': case 'Escape': this.cb.onPause && this.cb.onPause(); break;
        default: return;
      }
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ---- Eğim ----
  async setTiltEnabled(on) {
    if (on) {
      const ok = await this.requestTiltPermission();
      if (!ok) { this.tiltEnabled = false; return false; }
      window.addEventListener('deviceorientation', this.onOrientation);
      this.tiltEnabled = true;
      this.tilt.has = false;
      setTimeout(() => this.calibrate(), 600);
      return true;
    }
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.tiltEnabled = false;
    return true;
  }
  async requestTiltPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        return res === 'granted';
      }
      return typeof DeviceOrientationEvent !== 'undefined';
    } catch (err) {
      return false;
    }
  }
  calibrate() {
    this.tiltZero.beta = this.tilt.beta;
    this.tiltZero.gamma = this.tilt.gamma;
  }
  screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    if (typeof window.orientation === 'number') return (window.orientation + 360) % 360;
    return 90;
  }
  computeTilt() {
    if (!this.tiltEnabled || !this.tilt.has) { this.tiltOut.pitch = 0; this.tiltOut.roll = 0; return; }
    let db = this.tilt.beta - this.tiltZero.beta;
    let dg = this.tilt.gamma - this.tiltZero.gamma;
    if (dg > 90) dg -= 180; else if (dg < -90) dg += 180;
    if (db > 180) db -= 360; else if (db < -180) db += 360;
    const ang = this.screenAngle();
    let roll, pitch;
    if (ang === 90) { roll = db; pitch = -dg; }
    else if (ang === 270 || ang === -90) { roll = -db; pitch = dg; }
    else if (ang === 180) { roll = -dg; pitch = -db; }
    else { roll = dg; pitch = db; } // portre (kullanılmaz)
    const dead = 2, range = 28;
    const map = (v) => { const a = Math.abs(v); if (a < dead) return 0; return clamp(Math.sign(v) * (a - dead) / (range - dead), -1, 1); };
    this.tiltOut.roll = map(roll);
    this.tiltOut.pitch = map(pitch);
  }

  update(dt) {
    const k = this.keys;
    let pitch = 0, roll = 0, yaw = 0;
    if (this.enabled) {
      if (k.has('KeyS') || k.has('ArrowDown')) pitch += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) pitch -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) roll += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) roll -= 1;
      if (k.has('KeyE')) this.rudderKey = 1; else if (k.has('KeyQ')) this.rudderKey = -1; else this.rudderKey = 0;
      if (k.has('ShiftLeft') || k.has('ShiftRight')) { this.lever = Math.min(1.15, this.lever + dt * 0.5); this.setThrottleUI(); }
      if (k.has('ControlLeft') || k.has('ControlRight')) { this.lever = Math.max(0, this.lever - dt * 0.5); this.setThrottleUI(); }
    }
    this.computeTilt();
    if (this.stickPointer !== null) {
      pitch = this.stickVec.y; roll = this.stickVec.x;
    } else if (this.tiltEnabled) {
      pitch = this.tiltOut.pitch; roll = this.tiltOut.roll;
    }
    // Rudder: kaydırıcı basılıysa doğrudan; klavye basılıysa hedefe yaklaş; bırakılınca yay ile tam ortaya dön
    if (this.rudderHeld) { /* pointermove ayarlar */ }
    else if (this.rudderKey !== 0) { this.rudder += (this.rudderKey - this.rudder) * (1 - Math.exp(-dt * 10)); this.updateRudderUI(); }
    else if (this.rudder !== 0) {
      this.rudder *= Math.exp(-dt * 14);
      if (Math.abs(this.rudder) < 0.004) this.rudder = 0;
      this.updateRudderUI();
    }
    yaw += this.rudder;
    // Yumuşatma: ani sıçramaları azalt
    const s = this.state;
    const sm = 1 - Math.exp(-dt * 14);
    s.pitch += (clamp(pitch, -1, 1) - s.pitch) * sm;
    s.roll += (clamp(roll, -1, 1) - s.roll) * sm;
    s.yaw += (clamp(yaw, -1, 1) - s.yaw) * sm;
    s.throttle = Math.min(this.lever, 1);
    s.afterburner = this.lever > AB_DETENT + 0.01;
  }

  resetLever(v = 0) { this.lever = v; this.setThrottleUI(); }
}
