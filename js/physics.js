// Uçuş fiziği orkestratörü — 120 Hz sabit adım, tam 6 serbestlik dereceli rijit cisim.
//
// Bu dosya AKIŞI yönetir; fizik alt sistemleri kendi modüllerindedir:
//   atmosphere.js  ISA atmosfer
//   aerodata.js    uçağa özgü aerodinamik katsayı veri seti
//   aero.js        katsayı değerlendirmesi (sürekli, ±180° AoA'da tanımlı)
//   engine.js      itki ve spool dinamiği
//   fcs.js         fly-by-wire kontrol kanunu
//   rigidbody.js   6-DOF entegrasyon (kuaterniyon + tam Euler denklemleri)
//
// Zincir: pilot girdisi -> FCS -> yüzey komutu -> aerodinamik katsayı -> kuvvet/moment
//         -> ivme -> hız -> konum/yönelim.
// Hiçbir yerde kontrol girdisinden doğrudan rotasyon ya da konum yazılmaz.

import * as THREE from 'three';
import { clamp, smoothstep } from './noise.js';
import { WATER_LEVEL, surfaceTypeAt } from './world.js';
import { atmosphere, G0, RHO0 } from './atmosphere.js';
import { coefficients, clMaxConfig, alphaForCL } from './aero.js';
import { Engine } from './engine.js';
import { FCS } from './fcs.js';
import { RigidBody } from './rigidbody.js';

export const FIXED_DT = 1 / 120;
const G = G0;
const DEG = Math.PI / 180;
export const KT = 1.943844;
export const FT = 3.28084;
export { atmosphere };

export class FlightModel {
  constructor(world, cfg) {
    this.world = world;
    this.cfg = cfg;
    this.D = cfg.aero;                    // aerodinamik veri seti
    this.aero = cfg.aero;                 // geriye dönük uyumluluk (eski ad)
    this.geom = cfg.geom; this.law = cfg.law;
    this.gnd = cfg.ground; this.lim = cfg.limits; this.sys = cfg.systems;

    this.rb = new RigidBody();
    this.engine_ = new Engine(this.D);
    this.fcs = new FCS(this.D, cfg.law);

    // Rijit cisim durumuna kısayollar (dış arayüz korunur)
    this.pos = this.rb.pos;
    this.vel = this.rb.vel;
    this.quat = this.rb.quat;
    this.rates = { p: 0, q: 0, r: 0 };

    this.throttle = 0; this.afterburner = false;
    this.gearCmd = 1; this.gearPos = 1;
    this.flapIndex = 0; this.flapsCmd = 0; this.flapsPos = 0; this.slatsPos = 0;
    this.spoilerCmd = 0; this.spoilerPos = 0; this.reverseCmd = 0; this.reversePos = 0;
    this.brakes = true;
    this.fuel = this.D.fuel;
    this.crashed = false; this.crashReason = '';
    this.onGround = true; this.wasOnGround = true;
    this.time = 0;
    this.stick = { pitch: 0, roll: 0, yaw: 0 };
    this.surfaces = { elevator: 0, aileron: 0, rudder: 0 };
    this.telemetry = {};
    this.debug = {};

    // Yeniden kullanılan geçiciler — fizik döngüsünde HİÇ tahsis yapılmaz
    this._F = new THREE.Vector3();
    this._fwd = new THREE.Vector3(); this._up = new THREE.Vector3(); this._right = new THREE.Vector3();
    this._air = new THREE.Vector3(); this._wind = new THREE.Vector3();
    this._vb = new THREE.Vector3(); this._qi = new THREE.Quaternion();
    this._vhat = new THREE.Vector3(); this._lift = new THREE.Vector3();
    this._eul = new THREE.Euler(0, 0, 0, 'YXZ');
    this._uSur = { de: 0, da: 0, dr: 0 };
    this._uZero = { de: 0, da: 0, dr: 0 };
    this._st = {};

    this.wind = { dirDeg: 110, kt: 9, gustKt: 4, shear: 0.22 };
    this.groundY = 0;
    this._nz = 1;
    this.reset();
  }

  get mass() { return this.D.massEmpty + this.fuel; }
  get engine() { return this.engine_.n; }
  set engine(v) { this.engine_.n = v; }
  get abLevel() { return this.engine_.ab; }
  set abLevel(v) { this.engine_.ab = v; }

  reset(pose) {
    if (pose) this.spawn = pose;
    const sp = this.spawn || { x: -1400, z: 0, hdg: 90 };
    const gy = this.world.heightAt(sp.x, sp.z);
    this.groundY = gy;
    this.rb.pos.set(sp.x, gy - this.geom.wheelBottomY, sp.z);
    this.rb.quat.setFromEuler(new THREE.Euler(0, -sp.hdg * DEG, 0));
    this.rb.vel.set(0, 0, 0);
    this.rb.p = this.rb.q = this.rb.r = 0;
    this.rates.p = this.rates.q = this.rates.r = 0;
    this.throttle = 0; this.afterburner = false;
    this.engine_.reset();
    this.fcs.reset();
    this.gearCmd = 1; this.gearPos = 1;
    this.flapIndex = 0; this.flapsCmd = 0; this.flapsPos = 0; this.slatsPos = 0;
    this.spoilerCmd = 0; this.spoilerPos = 0; this.reverseCmd = 0; this.reversePos = 0;
    this.brakes = true; this.fuel = this.D.fuel;
    this.crashed = false; this.crashReason = ''; this.onGround = true; this.wasOnGround = true;
    this.time = 0; this._nz = 1; this._buffet = 0;
    this.stick.pitch = this.stick.roll = this.stick.yaw = 0;
    this.surfaces.elevator = this.surfaces.aileron = this.surfaces.rudder = 0;
    this.updateTelemetry(atmosphere(this.rb.pos.y), 0, 0, 1, 0, {});
  }

  setControls({ pitch, roll, yaw, throttle, afterburner, brakes }) {
    const st = this.stick;
    const pw = this.law.stickPow;
    const shape = (x) => Math.sign(x) * Math.pow(Math.min(1, Math.abs(x)), pw);
    if (pitch !== undefined) st.pitch = shape(pitch);
    if (roll !== undefined) st.roll = shape(roll);
    if (yaw !== undefined) st.yaw = clamp(yaw, -1, 1);
    if (throttle !== undefined) this.throttle = clamp(throttle, 0, 1);
    if (afterburner !== undefined) this.afterburner = !!afterburner;
    if (brakes !== undefined) this.brakes = !!brakes;
  }

  /**
   * İniş takımı kolu. Gerçek uçaklardaki AĞIRLIK-TEKERDE (squat switch) kilidi
   * burada modellenir: tekerlekler yerdeyken takım İÇERİ ALINAMAZ. Bu kilit
   * olmadan yerde kola basmak uçağı anında "gövde üstü sürtünme" ile imha
   * ediyordu — oyuncuya hiçbir uyarı vermeyen bir tuzaktı.
   * @returns {boolean} komut kabul edildiyse true, squat switch engellediyse false
   */
  toggleGear() {
    const wantUp = this.gearCmd > 0.5;
    if (wantUp && this.onGround) return false;   // ağırlık tekerde: kilitli
    this.gearCmd = wantUp ? 0 : 1;
    return true;
  }
  toggleFlaps() {
    const d = this.sys.flapDetents;
    this.flapIndex = (this.flapIndex + 1) % d.length;
    this.flapsCmd = d[this.flapIndex];
  }
  setFlapIndex(i) {
    const d = this.sys.flapDetents;
    this.flapIndex = Math.max(0, Math.min(d.length - 1, i | 0));
    this.flapsCmd = d[this.flapIndex];
  }
  get flapLabel() { return this.sys.flapNames[this.flapIndex]; }
  toggleSpoilers() { if (this.sys.spoilers) this.spoilerCmd = this.spoilerCmd > 0.5 ? 0 : 1; }
  toggleBrakes() { this.brakes = !this.brakes; }

  windAt(y, t, out) {
    const w = this.wind, v = out || this._wind;
    if (!w || w.kt <= 0) return v.set(0, 0, 0);
    const agl = Math.max(0, y - this.groundY);
    const prof = 1 - w.shear * Math.exp(-agl / 120);
    const gust = w.gustKt * (0.55 * Math.sin(t * 0.37) + 0.45 * Math.sin(t * 0.91 + 1.7));
    const sp = Math.max(0, (w.kt + gust)) * 0.514444 * prof;
    const th = (w.dirDeg + 8 * Math.sin(t * 0.21)) * DEG;
    return v.set(-Math.sin(th) * sp, 0, Math.cos(th) * sp);
  }

  requiredClearance(pitch, roll) {
    const g = this.geom;
    if (this.gearPos > 0.5) return -g.wheelBottomY + Math.abs(Math.sin(pitch)) * g.bellyArm * 0.25;
    return g.bellyR + Math.abs(Math.sin(pitch)) * g.bellyArm + Math.abs(Math.sin(roll)) * g.rollArmX;
  }

  // =========================================================================
  step(dt) {
    if (this.crashed) return;
    this.time += dt;
    const D = this.D, SYS = this.sys, GND = this.gnd, LIM = this.lim, LAW = this.law;
    const rb = this.rb, pos = rb.pos, vel = rb.vel, quat = rb.quat;
    const m = this.mass;

    // ---------------- Sistemler ----------------
    this.gearPos = clamp(this.gearPos + Math.sign(this.gearCmd - this.gearPos) * SYS.gearRate * dt, 0, 1);
    if (Math.abs(this.gearCmd - this.gearPos) < SYS.gearRate * dt) this.gearPos = this.gearCmd;
    this.flapsPos = clamp(this.flapsPos + Math.sign(this.flapsCmd - this.flapsPos) * SYS.flapRate * dt, 0, 1);
    if (Math.abs(this.flapsCmd - this.flapsPos) < SYS.flapRate * dt) this.flapsPos = this.flapsCmd;
    this.slatsPos = SYS.slatLead ? Math.min(1, this.flapsPos * SYS.slatLead) : 0;
    if (SYS.spoilers) {
      const auto = SYS.spoilers.groundAuto && this.onGround && (this.brakes || this.reversePos > 0.05) && vel.length() > 8;
      const maxDefl = this.onGround ? 1 : (SYS.spoilers.airFrac !== undefined ? SYS.spoilers.airFrac : 1);
      const target = Math.min(maxDefl, Math.max(this.spoilerCmd, auto ? 1 : 0));
      this.spoilerPos += (target - this.spoilerPos) * (1 - Math.exp(-dt * SYS.spoilers.rate));
    } else this.spoilerPos = 0;
    this.reverseCmd = (SYS.reverse > 0 && this.onGround && this.brakes && vel.length() > 12 && this.throttle < 0.5) ? 1 : 0;
    this.reversePos += (this.reverseCmd - this.reversePos) * (1 - Math.exp(-dt / 1.2));

    // ---------------- Atmosfer ve hava verileri ----------------
    const atm = atmosphere(pos.y);
    // Aerodinamik HAVAYA göre bağıl hızla hesaplanır (rüzgar/gust mimarisi buradan gelir)
    const wind = this.windAt(pos.y, this.time);
    const air = this._air.copy(vel).sub(wind);
    const V = air.length();
    const mach = V / atm.a;
    const qbar = 0.5 * atm.rho * V * V;

    rb.axes(this._fwd, this._up, this._right);
    const fwd = this._fwd, up = this._up, right = this._right;
    const eul = rb.eulerFromAxes(fwd, up, right);
    const pitch = eul.pitch, roll = eul.roll;

    // Gövde eksenlerinde hava hızı bileşenleri
    const vb = this._vb.copy(air).applyQuaternion(this._qi.copy(quat).invert());
    const u = -vb.z, w = vb.y, vlat = vb.x;

    // --- HÜCUM AÇISI ve KAYMA AÇISI ---
    // alpha yunuslama açısından DEĞİL, hava akışından hesaplanır ve ±180°'de tanımlıdır.
    // Düşük hızda kırpma yapılmaz; katsayılar zaten qbar ile sıfıra gider.
    let alpha = 0, beta = 0;
    if (V > 1.0) {
      alpha = Math.atan2(-w, u);
      beta = Math.asin(clamp(vlat / V, -1, 1));
    }
    const aAbs = Math.abs(alpha);

    const p = rb.p, q = rb.q, r = rb.r;
    // Normalize oranlar: payda GÜVENLİ referans hızla sınırlı, böylece p̂ = p·b/(2V)
    // düşük hızda patlamaz. Sönüm momentleri ayrıca qbar ile çarpıldığından hız
    // düşerken ZAYIFLAR — eski modeldeki "yavaşken daha güçlü sönüm" hatası yok.
    const Vref = Math.max(V, LAW.Vmin);
    const b2v = D.span / (2 * Vref), c2v = D.chord / (2 * Vref);
    const phat = clamp(p * b2v, -0.6, 0.6);
    const qhat = clamp(q * c2v, -0.6, 0.6);
    const rhat = clamp(r * b2v, -0.6, 0.6);

    // Sol/sağ kanat yerel hücum açısı farkı (yatış oranından).
    // Asimetrik stall ve doğal kanat düşmesi BUNDAN doğar, zamana bağlı yapay torktan değil.
    const dLocal = clamp(p * D.span * 0.32 / Vref, -0.35, 0.35);

    // Yer etkisi
    const groundYq = this.world.heightAt(pos.x, pos.z);
    const hb = 16 * Math.max(0.5, pos.y - groundYq - 1.0) / D.span;
    const sigmaGE = (hb * hb) / (1 + hb * hb);

    const st = this._st;
    st.alpha = alpha; st.beta = beta; st.phat = phat; st.qhat = qhat; st.rhat = rhat;
    st.mach = mach; st.sigmaGE = sigmaGE;
    st.flaps = this.flapsPos; st.slats = this.slatsPos; st.gear = this.gearPos; st.spoilers = this.spoilerPos;
    st.dLeft = -dLocal; st.dRight = dLocal;

    // ---------------- FCS ----------------
    // Önce yüzeysiz aerodinamik momentler: FCS bunları ve jiroskopik terimleri telafi eder.
    const c0 = coefficients(st, D, this._uZero);
    const qS = qbar * D.S;
    const Ixz = D.Ixz || 0;
    const Lgyro = (D.Iyy - D.Izz) * q * r + Ixz * p * q;
    const Mgyro = (D.Izz - D.Ixx) * r * p + Ixz * (r * r - p * p);
    const Ngyro = (D.Ixx - D.Iyy) * p * q - Ixz * q * r;

    const CLmaxCfg = clMaxConfig(D, this.flapsPos, this.slatsPos);
    const alphaTrim = alphaForCL(D, m * G / Math.max(qS, 1), this.flapsPos, this.slatsPos);

    let sur = this.fcs.sur;
    if (!this.onGround) {
      sur = this.fcs.update(dt, this.stick, {
        alpha, beta, V, qbar, mach, p, q, r, nz: this._nz, phi: roll, theta: pitch,
        CLmaxCfg, mass: m, alphaTrim,
        Maero: qS * D.chord * c0.Cm, Laero: qS * D.span * c0.Cl, Naero: qS * D.span * c0.Cn,
        Mgyro, Lgyro, Ngyro,
        sepFrac: c0.sepFrac, tailEff: c0.tailEff, tailEff1: 1,
      });
    }

    // ---------------- Aerodinamik (yüzeyler dahil) ----------------
    const uSur = this._uSur;
    uSur.de = sur.de; uSur.da = sur.da; uSur.dr = sur.dr;
    const c = coefficients(st, D, uSur);
    const L = qS * c.CL;
    const Dr = qS * c.CD;
    const Yf = qS * c.CY;

    // ---------------- Kuvvetler (dünya) ----------------
    const F = this._F.set(0, -m * G, 0);
    if (V > 0.5) {
      const vhat = this._vhat.copy(air).multiplyScalar(1 / V);
      const liftDir = this._lift.copy(up).addScaledVector(vhat, -up.dot(vhat));
      if (liftDir.lengthSq() > 1e-6) liftDir.normalize(); else liftDir.copy(up);
      F.addScaledVector(liftDir, L);
      F.addScaledVector(vhat, -Dr);
      F.addScaledVector(right, Yf);
    }
    // İtki gövde ileri ekseni boyuncadır; eksen kayması olmadığından yapay moment üretmez.
    const thrust = this.engine_.update(dt, this.throttle, this.afterburner, atm, mach, this.reversePos, SYS.reverse || 0);
    F.addScaledVector(fwd, thrust);
    this.fuel = Math.max(0, this.fuel - this.engine_.fuelFlow * dt);

    // ---------------- Yer teması ----------------
    const groundY = groundYq;
    this.groundY = groundY;
    const surface = surfaceTypeAt(pos.x, pos.z);
    const clearance = this.requiredClearance(pitch, roll);
    const agl = pos.y - groundY;
    let onGround = false;
    if (agl <= clearance + 0.01) {
      onGround = true;
      const paved = surface === 'runway' || surface === 'taxiway' || surface === 'apron';
      const vy = vel.y;
      if (!this.wasOnGround) {
        if (surface === 'water') return this.crash('Suya çarptınız');
        if (this.gearPos < 0.98) return this.crash('İniş takımı açık değildi');
        if (vy < LIM.hardLandVs) return this.crash('Sert iniş (' + Math.abs(vy * 196.85).toFixed(0) + ' ft/dk)');
        if (Math.abs(roll) > LIM.landRoll) return this.crash('Yatık iniş – kanat ucu yere çarptı');
        if (pitch < LIM.landPitch[0] || pitch > LIM.landPitch[1]) return this.crash(pitch > 0 ? 'Kuyruk yere çarptı' : 'Burun tekeri kırıldı');
        if (!paved && V > LIM.offRunwayV[0]) return this.crash('Pist dışına yüksek hızda iniş');
      } else {
        if (surface === 'water') return this.crash('Suya girdiniz');
        if (this.gearPos < 0.98) return this.crash('Gövde üstü sürtünme');
        if (Math.abs(roll) > LIM.groundRoll) return this.crash('Kanat ucu yere çarptı');
        if (!paved && V > LIM.offRunwayV[1]) return this.crash('Pist dışında kontrol kaybı');
        if (agl < clearance - 1.5) return this.crash('Yere çarptınız');
      }
      if (vel.y < 0) vel.y = 0;
      pos.y = groundY + clearance;
      const N = Math.max(0, m * G - L * Math.cos(pitch));
      const rollMu = paved ? GND.rollMu[0] : GND.rollMu[1];
      const brakeMu = this.brakes ? (paved ? GND.brakeMu[0] : GND.brakeMu[1]) : 0;
      const decel = (rollMu + brakeMu) * N / m;
      const lateralKill = 1 - Math.exp(-dt * 12);
      vel.addScaledVector(right, -vel.dot(right) * lateralKill);
      const vfwd = vel.dot(fwd);
      vel.addScaledVector(fwd, -Math.sign(vfwd) * Math.min(Math.abs(vfwd), decel * dt));
      F.y = Math.max(F.y, 0);
    }
    this.onGround = onGround;

    // ---------------- Doğrusal entegrasyon ----------------
    rb.integrateLinear(F, m, dt);
    if (onGround && vel.y < 0) vel.y = 0;
    if (onGround) pos.y = Math.max(pos.y, groundY + clearance);

    // ---------------- Açısal hareket ----------------
    let Mtot = 0, Ltot = 0, Ntot = 0;
    if (onGround) {
      this.groundRotation(dt, V, qbar, pitch, roll, vel, fwd);
      this._buffet = 0;
    } else {
      Ltot = qS * D.span * c.Cl;
      Mtot = qS * D.chord * c.Cm;
      Ntot = qS * D.span * c.Cn;
      // İtki ekseni düşey ofseti varsa yunuslama momenti üretir (fiziksel, yapay değil)
      if (D.thrustZ) Mtot += thrust * D.thrustZ;
      rb.integrateAngular(Ltot, Mtot, Ntot, D, dt);
      this._buffet = smoothstep(D.stallA0, D.stallA1, aAbs) * clamp(qbar / 4000, 0, 1);
    }
    this.rates.p = rb.p; this.rates.q = rb.q; this.rates.r = rb.r;

    // Yerdeyken tutum kinematik olarak sabitlenir (teker teması)
    if (onGround) {
      rb.axes(this._fwd, this._up, this._right);
      const heading = Math.atan2(this._fwd.x, -this._fwd.z);
      let p2 = Math.asin(clamp(this._fwd.y, -1, 1));
      if (p2 < 0) p2 = 0;
      this._eul.set(p2, -heading, 0, 'YXZ');
      quat.setFromEuler(this._eul);
      if (p2 <= 0 && rb.q < 0) { rb.q = 0; this.rates.q = 0; }
      rb.p = 0; this.rates.p = 0;
    }

    // ---------------- Çarpışma ----------------
    if (!onGround && agl < clearance - 0.5) return this.crash('Yere çarptınız');
    if (surface === 'water' && pos.y - 1.0 < WATER_LEVEL) return this.crash('Suya çarptınız');
    if (this.world.hitsBuilding(pos.x, pos.y, pos.z, 4)) return this.crash('Binaya çarptınız');
    if (pos.y > 25000) { pos.y = 25000; if (vel.y > 0) vel.y = 0; }
    const half = this.world.halfSize - 100;
    if (Math.abs(pos.x) > half || Math.abs(pos.z) > half) {
      pos.x = clamp(pos.x, -half, half); pos.z = clamp(pos.z, -half, half);
    }

    // Yük faktörü: gövde-dik özgül kuvvet (taşıma + itkinin dik bileşeni)
    const nz = onGround ? 1 : (L * Math.cos(alpha) + thrust * Math.sin(alpha)) / (m * G);
    this._nz = nz;
    this.wasOnGround = onGround;

    // Görsel yüzeyler fiziğin KULLANDIĞI komutla aynıdır (ayrı animasyon yolu yok)
    this.surfaces.elevator = sur.de;
    this.surfaces.aileron = sur.da;
    this.surfaces.rudder = -sur.dr;

    this.debug = {
      CL: c.CL, CD: c.CD, CY: c.CY, Cl: c.Cl, Cm: c.Cm, Cn: c.Cn,
      Lift: L, Drag: Dr, Side: Yf, Lm: Ltot, Mm: Mtot, Nm: Ntot,
      Lgyro, Mgyro, Ngyro, qbar, thrust, mass: m,
      de: sur.de, da: sur.da, dr: sur.dr,
      sepFrac: c.sepFrac, tailEff: c.tailEff, CLmaxCfg, alphaTrim,
      fcs: this.fcs.dbg, rateClamped: rb.rateClamped,
    };
    this.updateTelemetry(atm, alpha, beta, nz, this.fcs.dbg.auth || 0,
      { V, mach, qbar, thrust, surface, agl, pitch, roll, groundY });
  }

  // Yerde: kinematik teker modeli (burun tekeri dümeni, yatış sıfır, rotasyon hız gerektirir)
  groundRotation(dt, V, qbar, pitch, roll, vel, fwd) {
    const GND = this.gnd, rb = this.rb, st = this.stick;
    const steerMax = GND.steerMax * clamp(1 - V / GND.steerV, 0.05, 1);
    const steer = st.yaw * steerMax;
    const wheelbase = this.geom.mainGearZ - this.geom.noseGearZ;
    const vfwd = vel.dot(fwd);
    const rKin = (vfwd * Math.tan(steer)) / wheelbase;
    const rTireMax = GND.tireGrip * G / Math.max(Math.abs(vfwd), 1);
    // Sağ pedal (st.yaw>0) burnu SAĞA çevirir => r > 0 (bkz. rigidbody.js eksen notu)
    const rCmd = clamp(rKin, -rTireMax, rTireMax);
    const rotAuth = smoothstep(GND.rotQ[0], GND.rotQ[1], qbar);
    let qCmd = st.pitch > 0 ? st.pitch * GND.rotRate * rotAuth : st.pitch * GND.pushRate;
    if (pitch <= 0.001 && qCmd < 0) qCmd = 0;
    if (pitch > 0.001) qCmd -= 4 * DEG * (1 - rotAuth);
    if (pitch > GND.maxPitch && qCmd > 0) qCmd = 0;
    rb.q += (qCmd - rb.q) * (1 - Math.exp(-5 * dt));
    rb.r += (rCmd - rb.r) * (1 - Math.exp(-8 * dt));
    rb.p += (-roll * 6 - rb.p) * (1 - Math.exp(-8 * dt));
    rb.integrateQuaternion(dt);
    // Yerde yüzeyler doğrudan çubuğu izler (FCS devre dışı)
    const k = 1 - Math.exp(-10 * dt);
    const s = this.fcs.sur;
    s.de += (st.pitch - s.de) * k;
    s.da += (st.roll - s.da) * k;
    s.dr += (-st.yaw - s.dr) * k;
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.rb.vel.set(0, 0, 0);
    this.rb.p = this.rb.q = this.rb.r = 0;
    this.rates.p = this.rates.q = this.rates.r = 0;
    this.engine_.reset();
  }

  updateTelemetry(atm, alpha, beta, nz, authority, extra = {}) {
    const rb = this.rb;
    rb.axes(this._fwd, this._up, this._right);
    const fwd = this._fwd, up = this._up, right = this._right;
    const V = extra.V !== undefined ? extra.V : this.vel.length();
    const heading = ((Math.atan2(fwd.x, -fwd.z) / DEG) + 360) % 360;
    const groundY = extra.groundY !== undefined ? extra.groundY : this.world.heightAt(this.pos.x, this.pos.z);
    const aAbs = Math.abs(alpha);
    const D = this.D;
    this.telemetry = {
      tas: V, kias: V * Math.sqrt(atm.rho / RHO0) * KT, ktas: V * KT,
      mach: extra.mach !== undefined ? extra.mach : V / atm.a,
      altFt: this.pos.y * FT, aglFt: (this.pos.y - groundY) * FT,
      vsFpm: this.vel.y * FT * 60,
      heading,
      pitch: (extra.pitch !== undefined ? extra.pitch : Math.asin(clamp(fwd.y, -1, 1))) / DEG,
      roll: (extra.roll !== undefined ? extra.roll : Math.atan2(-right.y, up.y)) / DEG,
      alpha: alpha / DEG, beta: beta / DEG, g: nz,
      p: this.rates.p / DEG, q: this.rates.q / DEG, r: this.rates.r / DEG,
      qbar: extra.qbar || 0,
      throttle: this.throttle, engine: this.engine_.n, ab: this.engine_.ab,
      gear: this.gearPos, gearCmd: this.gearCmd, flaps: this.flapsPos, flapsCmd: this.flapsCmd, brakes: this.brakes,
      slats: this.slatsPos, spoilers: this.spoilerPos, reverse: this.reversePos, flapLabel: this.flapLabel,
      onGround: this.onGround,
      stallWarn: !this.onGround && aAbs > this.lim.alphaWarn && V > 20,
      stall: !this.onGround && aAbs > D.stallA1 && V > 15,
      buffet: this._buffet || 0,
      fuelKg: this.fuel, surface: extra.surface || 'runway', thrustKN: (extra.thrust || 0) / 1000,
      gsKt: this.vel.length() * KT,
      windDeg: this.wind.kt > 0 ? Math.round(((this.wind.dirDeg % 360) + 360) % 360) : 0,
      windKt: this.wind.kt,
      xwindKt: this.wind.kt * Math.sin((((this.wind.dirDeg - heading) % 360) + 360) % 360 * DEG),
      authority,
    };
  }
}
