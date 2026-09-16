// F-35A uçuş dinamiği: 120 Hz sabit adım.
// Kuvvetler: taşıma (stall sonrası ani düşüş), sürükleme, itki, yerçekimi, yer etkisi.
// Momentler: aerodinamik (statik kararlılık, sönüm, dihedral, rüzgar gülü, stall sonrası burun düşmesi,
// kanat sallanması) + kontrol yüzeylerinin dinamik basınçla sınırlı kontrol gücü.
// Fly-by-wire: g/oran komutu, 9g ve AoA sınırlayıcı, otomatik trim; yetki yetmeyince aerodinamik kazanır.
import * as THREE from 'three';
import { clamp, smoothstep } from './noise.js';
import { F35 } from './aircraft.js';
import { WATER_LEVEL, surfaceTypeAt } from './world.js';

export const FIXED_DT = 1 / 120;
const G = 9.80665;
const DEG = Math.PI / 180;
export const KT = 1.943844;   // m/s -> knot
export const FT = 3.28084;    // m -> feet

const AERO = {
  massEmpty: 13300, fuel: 8300,
  S: 42.7, span: 10.7, chord: 4.0,
  Ixx: 5.0e4, Iyy: 2.8e5, Izz: 3.2e5,
  thrustMil: 125000, thrustAB: 191000, idleFrac: 0.045,
  CLa: 4.0, CL0: 0.04, CLmax: 1.72,
  alphaLin: 16 * DEG, alphaMax: 24 * DEG, alphaDrop: 34 * DEG, alphaLimit: 25 * DEG,
  CD0: 0.016, e: 0.78, eFlaps: 0.70, CDgear: 0.024, CDflaps: 0.018,
  CLflaps: 0.5,
  gMax: 9, gMin: -3,
  rollRateMax: 250 * DEG, pitchRateMax: 50 * DEG, yawRateMax: 18 * DEG,
  // Moment katsayıları
  Cm0: 0.015, Cma: -0.35, Cmq: -9.0, CmFlaps: -0.05, CmStall: -2.2,
  Clb: -0.06, Clp: -0.36, Clr: 0.10,
  Cnb: 0.10, Cnr: -0.34, Cnp: -0.03,
  CmCtl: 0.50, ClCtl: 0.062, CnCtl: 0.040,
};

// ISA atmosfer
export function atmosphere(h) {
  const hh = Math.max(0, h);
  let T, p;
  if (hh < 11000) {
    T = 288.15 - 0.0065 * hh;
    p = 101325 * Math.pow(T / 288.15, 5.2559);
  } else {
    T = 216.65;
    p = 22632 * Math.exp(-G * (hh - 11000) / (287.05 * T));
  }
  const rho = p / (287.05 * T);
  const a = Math.sqrt(1.4 * 287.05 * T);
  return { rho, a, T, p };
}

// Taşıma katsayısı (stall dahil). alpha radyan, işaretli. Eğri, sıfır taşıma açısı etrafında simetriktir.
export function liftCoefficient(alpha, flaps = 0, mach = 0) {
  const a0 = -AERO.CL0 / AERO.CLa;            // sıfır taşıma açısı
  const ae = alpha - a0;
  const s = Math.sign(ae) || 1;
  const a = Math.abs(ae);
  let CL;
  if (a <= AERO.alphaLin) {
    CL = AERO.CLa * a;
  } else if (a <= AERO.alphaMax) {
    // doğrusaldan tepeye yumuşak yuvarlanma (tepe eğimi sıfır)
    const clAtLin = AERO.CLa * AERO.alphaLin;
    const t = (AERO.alphaMax - a) / (AERO.alphaMax - AERO.alphaLin);
    CL = AERO.CLmax - (AERO.CLmax - clAtLin) * t * t;
  } else if (a <= AERO.alphaDrop) {
    // stall: taşıma hızla düşer
    const t = smoothstep(AERO.alphaMax, AERO.alphaDrop, a);
    CL = AERO.CLmax + (0.95 - AERO.CLmax) * t;
  } else {
    // düz plaka
    CL = 0.95 * Math.sin(2 * a) / Math.sin(2 * AERO.alphaDrop);
  }
  CL *= s;
  // Flap katkısı stall ile kaybolur
  CL += AERO.CLflaps * flaps * (1 - smoothstep(AERO.alphaMax, AERO.alphaDrop, a));
  // Ses üstü: taşıma eğimi düşer
  CL *= 1 - 0.25 * smoothstep(1.0, 1.6, mach);
  return CL;
}

export class FlightModel {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.rates = { p: 0, q: 0, r: 0 }; // yatış, yunuslama, sapma (rad/s, gövde)
    this.throttle = 0;
    this.afterburner = false;
    this.engine = 0;
    this.abLevel = 0;
    this.gearCmd = 1; this.gearPos = 1;
    this.flapsCmd = 0; this.flapsPos = 0;
    this.brakes = true;
    this.fuel = AERO.fuel;
    this.crashed = false; this.crashReason = '';
    this.onGround = true;
    this.time = 0;
    this.stick = { pitch: 0, roll: 0, yaw: 0 };
    this.stickF = { pitch: 0, roll: 0 };                    // ön filtreli çubuk (komut sıçramasını yumuşatır)
    this.act = { M: 0, L: 0, N: 0 };                        // eyleyici (kontrol momenti) durumu
    this.surfaces = { elevator: 0, aileron: 0, rudder: 0 }; // görsel yüzey sapmaları (-1..1)
    this.telemetry = {};
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._fwd = new THREE.Vector3(); this._up = new THREE.Vector3(); this._right = new THREE.Vector3();
    this._acc = new THREE.Vector3(); this._lift = new THREE.Vector3();
    this.reset();
  }

  reset() {
    const x = -1400, z = 0;
    const gy = this.world.heightAt(x, z);
    this.pos.set(x, gy - F35.wheelBottomY, z);
    this.quat.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
    this.vel.set(0, 0, 0);
    this.rates.p = this.rates.q = this.rates.r = 0;
    this.throttle = 0; this.afterburner = false; this.engine = 0; this.abLevel = 0;
    this.gearCmd = 1; this.gearPos = 1; this.flapsCmd = 0; this.flapsPos = 0;
    this.brakes = true; this.fuel = AERO.fuel;
    this.crashed = false; this.crashReason = ''; this.onGround = true; this.time = 0;
    this.wasOnGround = true;
    this.surfaces.elevator = this.surfaces.aileron = this.surfaces.rudder = 0;
    this.stickF.pitch = this.stickF.roll = 0; this.act.M = this.act.L = this.act.N = 0;
    this.updateTelemetry(atmosphere(gy), 0, 0, 1, 1);
  }

  get mass() { return AERO.massEmpty + this.fuel; }

  setControls({ pitch = 0, roll = 0, yaw = 0, throttle, afterburner, brakes }) {
    // Çubuk şekillendirme: küçük girişlerde daha hassas
    const shape = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), 1.5);
    this.stick.pitch = shape(clamp(pitch, -1, 1));
    this.stick.roll = shape(clamp(roll, -1, 1));
    this.stick.yaw = clamp(yaw, -1, 1);
    if (throttle !== undefined) this.throttle = clamp(throttle, 0, 1);
    if (afterburner !== undefined) this.afterburner = !!afterburner;
    if (brakes !== undefined) this.brakes = !!brakes;
  }
  toggleGear() { this.gearCmd = this.gearCmd > 0.5 ? 0 : 1; }
  toggleFlaps() { this.flapsCmd = this.flapsCmd > 0.5 ? 0 : 1; }
  toggleBrakes() { this.brakes = !this.brakes; }

  requiredClearance(pitch, roll) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    let d;
    if (this.gearPos > 0.98) {
      const main = -F35.wheelBottomY * c + F35.mainGearZ * s;
      const nose = -F35.wheelBottomY * c - F35.noseGearZ * s;
      d = Math.max(main, nose);
    } else {
      d = 0.95 * c + 4.0 * Math.abs(s);
    }
    d = Math.max(d, Math.abs(Math.sin(roll)) * 5.3 + 0.3);
    return d;
  }

  step(dt) {
    if (this.crashed) return;
    this.time += dt;
    const m = this.mass;
    const pos = this.pos, vel = this.vel, quat = this.quat;
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(quat);
    const right = this._right.set(1, 0, 0).applyQuaternion(quat);
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const roll = Math.atan2(-right.y, up.y);

    // ---- Sistemler ----
    const gearRate = 1 / 6;
    this.gearPos = clamp(this.gearPos + Math.sign(this.gearCmd - this.gearPos) * gearRate * dt, 0, 1);
    if (Math.abs(this.gearCmd - this.gearPos) < gearRate * dt) this.gearPos = this.gearCmd;
    const flapRate = 1 / 3;
    this.flapsPos = clamp(this.flapsPos + Math.sign(this.flapsCmd - this.flapsPos) * flapRate * dt, 0, 1);
    if (Math.abs(this.flapsCmd - this.flapsPos) < flapRate * dt) this.flapsPos = this.flapsCmd;

    // Motor: F135 rölanti->askeri ~4 s, geri ~2 s, art yakıcı ~0.7 s
    const tau = this.throttle > this.engine ? 3.5 * (0.35 + 0.65 * (1 - this.engine)) : 2.0;
    this.engine += (this.throttle - this.engine) * (1 - Math.exp(-dt / tau));
    const abTarget = (this.afterburner && this.engine > 0.92) ? 1 : 0;
    this.abLevel += (abTarget - this.abLevel) * (1 - Math.exp(-dt / 0.7));

    // ---- Atmosfer ve hava verileri ----
    const atm = atmosphere(pos.y);
    const rho = atm.rho;
    const V = vel.length();
    const mach = V / atm.a;
    const qd = 0.5 * rho * V * V;
    const vb = this._v.copy(vel).applyQuaternion(this._q.copy(quat).invert());
    const u = -vb.z, w = vb.y, v = vb.x;
    const alpha = V > 1 ? Math.atan2(-w, Math.max(u, 0.5)) : 0;
    const beta = V > 1 ? Math.asin(clamp(v / V, -1, 1)) : 0;
    const aAbs = Math.abs(alpha);

    // ---- Aerodinamik katsayılar (rüzgar eksenleri) ----
    // Yer etkisi: kanat yere yaklaşınca indüklenmiş sürükleme azalır, taşıma eğimi hafif artar
    const groundYq = this.world.heightAt(pos.x, pos.z);
    const hWing = Math.max(0.5, pos.y - groundYq - 1.0);
    const hb = 16 * hWing / AERO.span;
    const sigma = (hb * hb) / (1 + hb * hb);           // 1: yer etkisi yok, ->0: yerde
    let CL = liftCoefficient(alpha, this.flapsPos, mach);
    CL *= 1 + 0.10 * (1 - sigma);
    const AR = AERO.span * AERO.span / AERO.S;
    const e = AERO.e + (AERO.eFlaps - AERO.e) * this.flapsPos;
    const K = (1 / (Math.PI * AR * e)) * sigma;
    // Parazit sürükleme: temiz + takım + flap + dalga sürüklemesi (ses altı-üstü geçişi)
    let CD0 = AERO.CD0 + AERO.CDgear * this.gearPos + AERO.CDflaps * this.flapsPos;
    CD0 += 0.052 * smoothstep(0.88, 1.12, mach) + 0.03 * smoothstep(1.35, 1.75, mach);
    const stallBlend = smoothstep(AERO.alphaMax, AERO.alphaDrop, aAbs);
    // İndüklenmiş sürükleme (stall sonrası ayrılmış akış: düz plaka terimi devralır)
    const CDi = K * CL * CL * (1 - 0.5 * stallBlend);
    const CDsep = 1.4 * Math.pow(Math.sin(aAbs), 2) * smoothstep(20 * DEG, 40 * DEG, aAbs);
    const CD = CD0 + CDi + CDsep;
    const CY = -0.9 * beta;

    const L = qd * AERO.S * CL;
    const D = qd * AERO.S * CD;
    const Y = qd * AERO.S * CY;

    // ---- Kuvvetler (dünya) ----
    const F = this._f.set(0, -m * G, 0);
    if (V > 0.5) {
      const vhat = this._acc.copy(vel).multiplyScalar(1 / V);
      const liftDir = this._lift.copy(up).addScaledVector(vhat, -up.dot(vhat));
      if (liftDir.lengthSq() > 1e-6) liftDir.normalize();
      F.addScaledVector(liftDir, L);
      F.addScaledVector(vhat, -D);
      F.addScaledVector(right, Y);
    }
    const densityFactor = Math.pow(rho / 1.225, 0.72) * (1 + 0.18 * clamp(mach, 0, 1.6));
    const Tmil = AERO.thrustMil * densityFactor;
    const thrust = Tmil * (AERO.idleFrac + (1 - AERO.idleFrac) * this.engine) + (AERO.thrustAB - AERO.thrustMil) * densityFactor * this.abLevel;
    F.addScaledVector(fwd, thrust);
    const sfc = 2.4 * (0.08 + 0.92 * this.engine) + 8.5 * this.abLevel;
    this.fuel = Math.max(0, this.fuel - sfc * dt);

    // ---- Yer teması ----
    const groundY = groundYq;
    const surface = surfaceTypeAt(pos.x, pos.z);
    const clearance = this.requiredClearance(pitch, roll);
    const agl = pos.y - groundY;
    let onGround = false;
    let groundNormalForce = 0;
    if (agl <= clearance + 0.01) {
      onGround = true;
      const paved = surface === 'runway' || surface === 'taxiway' || surface === 'apron';
      const vy = vel.y;
      if (!this.wasOnGround) {
        if (surface === 'water') return this.crash('Suya çarptınız');
        if (this.gearPos < 0.98) return this.crash('İniş takımı açık değildi');
        if (vy < -6.5) return this.crash('Sert iniş (' + Math.abs(vy * 196.85).toFixed(0) + ' ft/dk)');
        if (Math.abs(roll) > 12 * DEG) return this.crash('Yatık iniş – kanat ucu yere çarptı');
        if (pitch < -4 * DEG || pitch > 15 * DEG) return this.crash(pitch > 0 ? 'Kuyruk yere çarptı' : 'Burun tekeri kırıldı');
        if (!paved && V > 55) return this.crash('Pist dışına yüksek hızda iniş');
      } else {
        if (surface === 'water') return this.crash('Suya girdiniz');
        if (this.gearPos < 0.98) return this.crash('Gövde üstü sürtünme');
        if (Math.abs(roll) > 15 * DEG) return this.crash('Kanat ucu yere çarptı');
        if (!paved && V > 60) return this.crash('Pist dışında kontrol kaybı');
        if (agl < clearance - 1.5) return this.crash('Yere çarptınız');
      }
      if (vel.y < 0) vel.y = 0;
      pos.y = groundY + clearance;
      groundNormalForce = Math.max(0, m * G - L * Math.cos(pitch));
      const rollMu = paved ? 0.02 : 0.09;
      const brakeMu = this.brakes ? (paved ? 0.5 : 0.25) : 0;
      const decel = (rollMu + brakeMu) * groundNormalForce / m;
      const lateralKill = 1 - Math.exp(-dt * 12);
      const vbx = vel.dot(right);
      vel.addScaledVector(right, -vbx * lateralKill);
      const vfwd = vel.dot(fwd);
      const dv = Math.min(Math.abs(vfwd), decel * dt);
      vel.addScaledVector(fwd, -Math.sign(vfwd) * dv);
      F.y = Math.max(F.y, 0);
    }
    this.onGround = onGround;

    // ---- Doğrusal entegrasyon ----
    const acc = this._acc.copy(F).multiplyScalar(1 / m);
    vel.addScaledVector(acc, dt);
    if (onGround && vel.y < 0) vel.y = 0;
    pos.addScaledVector(vel, dt);
    if (onGround) pos.y = Math.max(pos.y, groundY + clearance);

    // ---- Açısal hareket ----
    const st = this.stick;
    const R = this.rates;
    const Vs = Math.max(V, 20);
    const highAlpha = smoothstep(20 * DEG, 34 * DEG, aAbs);
    const ctlEff = 1 - 0.65 * highAlpha;               // stall sonrası yüzey etkinliği
    const authority = clamp(qd / 9000, 0.05, 1);

    if (onGround) {
      // Yerde: kinematik model (burun tekeri dümeni, yatış sıfır, rotasyon hız gerektirir)
      const steerMax = 55 * DEG * clamp(1 - V / 45, 0.05, 1);
      const steer = st.yaw * steerMax;
      const wheelbase = F35.mainGearZ - F35.noseGearZ;
      const vfwd = vel.dot(fwd);
      const rKin = (vfwd * Math.tan(steer)) / wheelbase;
      const rTireMax = 0.45 * G / Math.max(Math.abs(vfwd), 1);
      const rCmd = -clamp(rKin, -rTireMax, rTireMax);
      const rotAuth = smoothstep(2200, 5200, qd);
      let qCmd = st.pitch > 0 ? st.pitch * 18 * DEG * rotAuth : st.pitch * 10 * DEG;
      if (pitch <= 0.001 && qCmd < 0) qCmd = 0;
      if (pitch > 0.001) qCmd -= 4 * DEG * (1 - rotAuth);
      if (pitch > 13 * DEG && qCmd > 0) qCmd = 0;
      R.q += (qCmd - R.q) * (1 - Math.exp(-5 * dt));
      R.r += (rCmd - R.r) * (1 - Math.exp(-8 * dt));
      R.p += (-roll * 6 - R.p) * (1 - Math.exp(-8 * dt));
      this.surfaces.elevator += (st.pitch - this.surfaces.elevator) * (1 - Math.exp(-10 * dt));
      this.surfaces.aileron += (st.roll - this.surfaces.aileron) * (1 - Math.exp(-10 * dt));
      this.surfaces.rudder += (st.yaw - this.surfaces.rudder) * (1 - Math.exp(-10 * dt));
    } else {
      // --- FBW komutları ---
      // Çubuk ön filtresi (τ 0.12 s): ani bırakmada komut basamağı yumuşar, gecikme hissedilmez
      const kPre = 1 - Math.exp(-dt / 0.12);
      this.stickF.pitch += (st.pitch - this.stickF.pitch) * kPre;
      this.stickF.roll += (st.roll - this.stickF.roll) * (1 - Math.exp(-dt / 0.06));
      const sp = this.stickF.pitch;
      // İç döngü (oran) kazancı: q, komuta 1/Kq zaman sabitiyle yaklaşır
      const Kq = 3.5 + 4.5 * authority, Kp = 5 + 7 * authority, Kr = 2.5 + 3.5 * authority;
      // Gerçek yük faktörü (gövde-dik özgül kuvvet): taşıma + itkinin dik bileşeni
      const nAct = (L * Math.cos(alpha) + thrust * Math.sin(alpha)) / (m * G);
      // Yüksek hız: g komutu (nötr çubuk = 1g, uçuş yolu korunur; tutum hıza göre kendini ayarlar)
      const nCmd = sp >= 0 ? 1 + sp * (AERO.gMax - 1) : 1 + sp * (1 - AERO.gMin);
      const nAvail = qd * AERO.S * AERO.CLmax / (m * G);
      const nTarget = clamp(nCmd, Math.min(nCmd, AERO.gMin), Math.max(0.25, nAvail * 0.98));
      const qSteady = (nTarget - Math.cos(roll) * Math.cos(pitch)) * G / Vs;   // hedef g için kararlı hal yunuslama oranı
      // Dış döngü kazancı dinamik basınca göre programlanır: kısa periyot kapalı döngü sönümü ζ≈0.9
      // (ωn² = Kq·kα·(Kn + g/V), 2ζωn = Kq + kα·g/V; kα = taşıma eğimi [g/rad])
      const kAlpha = Math.max(0.5, AERO.CLa * qd * AERO.S / (m * G));
      const zeta = 0.9;
      const Kn = clamp(Kq / (4 * zeta * zeta * kAlpha) - G / Vs, 0.03, 0.8);
      let qCmdG = qSteady + (nTarget - nAct) * Kn;
      // Düşük hız: AoA komutu (nötr çubuk = trim AoA'sı ~ 1g, tam çubuk = sınır AoA); aynı sönüm hedefiyle programlanır
      const alphaTrim = clamp((m * G / Math.max(qd * AERO.S, 1) - AERO.CL0 - AERO.CLflaps * this.flapsPos) / AERO.CLa, 2 * DEG, AERO.alphaLimit);
      const alphaCmd = sp >= 0 ? alphaTrim + sp * (AERO.alphaLimit - alphaTrim) : alphaTrim + sp * (alphaTrim + 8 * DEG);
      const gkv = G * kAlpha / Vs;
      const Ka = clamp((Kq + gkv) * (Kq + gkv) / (4 * zeta * zeta * Kq) - gkv, 0.6, 2.2);
      const qCmdA = (alphaCmd - alpha) * Ka;
      const wG = smoothstep(2500, 7000, qd);
      let qCmd = qCmdA * (1 - wG) + qCmdG * wG;
      // AoA sınırlayıcı: sınıra yaklaşınca burun yukarı komutu kısılır, aşınca burun aşağı istenir
      const aMargin = AERO.alphaLimit - alpha;
      if (aMargin < 5 * DEG) qCmd = Math.min(qCmd, aMargin * 1.5);
      if (alpha < -12 * DEG) qCmd = Math.max(qCmd, 0);
      qCmd = clamp(qCmd, -AERO.pitchRateMax, AERO.pitchRateMax);
      const pCmd = this.stickF.roll * AERO.rollRateMax * clamp(qd / 6000, 0.15, 1);
      // Hız vektörü etrafında yatış için koordineli sapma + kayma sıfırlama + dümen
      let rCmd = -pCmd * Math.tan(clamp(alpha, -0.6, 0.6)) * 0.85 - beta * 3.0 - st.yaw * AERO.yawRateMax;

      // --- Aerodinamik momentler ---
      const qS = qd * AERO.S;
      const c2v = AERO.chord / (2 * Vs), b2v = AERO.span / (2 * Vs);
      const qhat = R.q * c2v, phat = R.p * b2v, rhat = R.r * b2v;
      const t = this.time;
      const buffet = smoothstep(18 * DEG, 26 * DEG, aAbs);
      const noiseA = Math.sin(t * 47.0) * Math.sin(t * 13.3) + Math.sin(t * 29.0) * 0.5;
      const noiseB = Math.sin(t * 41.0 + 1.7) * Math.sin(t * 11.1) + Math.sin(t * 23.0 + 0.4) * 0.5;
      let Cm = AERO.Cm0 + AERO.Cma * alpha + AERO.Cmq * qhat + AERO.CmFlaps * this.flapsPos;
      if (aAbs > AERO.alphaMax) Cm += AERO.CmStall * (aAbs - AERO.alphaMax) * Math.sign(alpha);
      Cm += buffet * noiseA * 0.02;
      let Cl = AERO.Clb * beta + AERO.Clp * phat + AERO.Clr * rhat;
      Cl += highAlpha * (Math.sin(t * 5.3) * Math.sin(t * 2.1) * 0.05 + noiseB * 0.015); // kanat sallanması
      let Cn = AERO.Cnb * (1 - 0.8 * highAlpha) * beta + AERO.Cnr * rhat + AERO.Cnp * phat;
      Cn += highAlpha * 0.02 * Math.sign(beta || 1) * smoothstep(8 * DEG, 20 * DEG, Math.abs(beta)); // burun kayması
      const Maero = qS * AERO.chord * Cm;
      const Laero = qS * AERO.span * Cl;
      const Naero = qS * AERO.span * Cn;
      // Atalet eşleşmesi
      const Mine = (AERO.Izz - AERO.Ixx) * R.p * R.r;
      const Line = (AERO.Iyy - AERO.Izz) * R.q * R.r;
      const Nine = (AERO.Ixx - AERO.Iyy) * R.p * R.q;

      // --- Kontrol gücü (dinamik basınçla sınırlı) ---
      const Mmax = qS * AERO.chord * AERO.CmCtl * ctlEff;
      const Lmax = qS * AERO.span * AERO.ClCtl * ctlEff;
      const Nmax = qS * AERO.span * AERO.CnCtl * (1 - 0.4 * highAlpha);
      // FBW: istenen ivme için gereken momenti hesapla, bilinen momentleri telafi et, sınırla
      const MctlCmd = clamp(AERO.Iyy * Kq * (qCmd - R.q) - Maero - Mine, -Mmax, Mmax);
      const LctlCmd = clamp(AERO.Ixx * Kp * (pCmd - R.p) - Laero - Line, -Lmax, Lmax);
      const NctlCmd = clamp(AERO.Izz * Kr * (rCmd - R.r) - Naero - Nine, -Nmax, Nmax);
      // Eyleyici gecikmesi (yüzey sapma hızı sınırı, τ 0.04 s): anlık moment sıçraması yok
      const kAct = 1 - Math.exp(-dt / 0.04);
      const A = this.act;
      A.M += (MctlCmd - A.M) * kAct; A.L += (LctlCmd - A.L) * kAct; A.N += (NctlCmd - A.N) * kAct;
      const Mctl = clamp(A.M, -Mmax, Mmax), Lctl = clamp(A.L, -Lmax, Lmax), Nctl = clamp(A.N, -Nmax, Nmax);
      // Görsel yüzey sapmaları (kontrol momentinin doygunluk oranı)
      this.surfaces.elevator += ((Mmax > 1 ? Mctl / Mmax : 0) - this.surfaces.elevator) * (1 - Math.exp(-12 * dt));
      this.surfaces.aileron += ((Lmax > 1 ? Lctl / Lmax : 0) - this.surfaces.aileron) * (1 - Math.exp(-12 * dt));
      this.surfaces.rudder += ((Nmax > 1 ? -Nctl / Nmax : 0) - this.surfaces.rudder) * (1 - Math.exp(-12 * dt));

      R.q += ((Maero + Mine + Mctl) / AERO.Iyy) * dt;
      R.p += ((Laero + Line + Lctl) / AERO.Ixx) * dt;
      R.r += ((Naero + Nine + Nctl) / AERO.Izz) * dt;
      // Sayısal güvenlik
      R.q = clamp(R.q, -3, 3); R.p = clamp(R.p, -6, 6); R.r = clamp(R.r, -3, 3);
      this._buffet = buffet * clamp(qd / 4000, 0, 1);
    }

    // Kuaterniyon entegrasyonu: gövde açısal hızı (x: q, y: r, z: -p)
    const wx = R.q, wy = R.r, wz = -R.p;
    const wlen = Math.hypot(wx, wy, wz);
    if (wlen > 1e-9) {
      this._q.setFromAxisAngle(this._v.set(wx / wlen, wy / wlen, wz / wlen), wlen * dt);
      quat.multiply(this._q).normalize();
    }
    if (onGround) {
      const fwd2 = this._fwd.set(0, 0, -1).applyQuaternion(quat);
      let p2 = Math.asin(clamp(fwd2.y, -1, 1));
      const heading = Math.atan2(fwd2.x, -fwd2.z);
      if (p2 < 0) p2 = 0;
      const e = new THREE.Euler(0, 0, 0, 'YXZ');
      e.y = -heading; e.x = p2; e.z = 0;
      quat.setFromEuler(e);
      if (p2 <= 0 && R.q < 0) R.q = 0;
      R.p = 0;
      this._buffet = 0;
    }

    // ---- Çarpışma kontrolleri ----
    if (!onGround && agl < clearance - 0.5) return this.crash('Yere çarptınız');
    if (surface === 'water' && pos.y - 1.0 < WATER_LEVEL) return this.crash('Suya çarptınız');
    if (this.world.hitsBuilding(pos.x, pos.y, pos.z, 4)) return this.crash('Binaya çarptınız');
    if (pos.y > 25000) { pos.y = 25000; if (vel.y > 0) vel.y = 0; }
    const half = this.world.halfSize - 100;
    if (Math.abs(pos.x) > half || Math.abs(pos.z) > half) {
      pos.x = clamp(pos.x, -half, half); pos.z = clamp(pos.z, -half, half);
    }

    const nz = onGround ? 1 : (L * Math.cos(alpha) + thrust * Math.sin(alpha)) / (m * G);
    this.wasOnGround = onGround;
    this.updateTelemetry(atm, alpha, beta, nz, authority, { V, mach, qd, L, D, thrust, surface, agl, pitch, roll, groundY });
  }

  crash(reason) {
    this.crashed = true;
    this.crashReason = reason;
    this.vel.set(0, 0, 0);
    this.rates.p = this.rates.q = this.rates.r = 0;
    this.abLevel = 0; this.engine = 0;
  }

  updateTelemetry(atm, alpha, beta, nz, authority, extra = {}) {
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(this.quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(this.quat);
    const right = this._right.set(1, 0, 0).applyQuaternion(this.quat);
    const V = extra.V !== undefined ? extra.V : this.vel.length();
    const heading = ((Math.atan2(fwd.x, -fwd.z) / DEG) + 360) % 360;
    const groundY = extra.groundY !== undefined ? extra.groundY : this.world.heightAt(this.pos.x, this.pos.z);
    const aAbs = Math.abs(alpha);
    this.telemetry = {
      tas: V, kias: V * Math.sqrt(atm.rho / 1.225) * KT, ktas: V * KT,
      mach: extra.mach || V / atm.a,
      altFt: this.pos.y * FT, aglFt: (this.pos.y - groundY) * FT,
      vsFpm: this.vel.y * FT * 60,
      heading, pitch: (extra.pitch !== undefined ? extra.pitch : Math.asin(clamp(fwd.y, -1, 1))) / DEG,
      roll: (extra.roll !== undefined ? extra.roll : Math.atan2(-right.y, up.y)) / DEG,
      alpha: alpha / DEG, beta: beta / DEG, g: nz,
      throttle: this.throttle, engine: this.engine, ab: this.abLevel,
      gear: this.gearPos, gearCmd: this.gearCmd, flaps: this.flapsPos, flapsCmd: this.flapsCmd, brakes: this.brakes,
      onGround: this.onGround,
      stallWarn: !this.onGround && aAbs > 19 * DEG && V > 20,
      stall: !this.onGround && aAbs > AERO.alphaMax && V > 15,
      buffet: this._buffet || 0,
      fuelKg: this.fuel, surface: extra.surface || 'runway', thrustKN: (extra.thrust || 0) / 1000,
      authority,
    };
  }
}
