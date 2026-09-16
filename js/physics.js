// F-35A uçuş dinamiği: 120 Hz sabit adım. Kuvvetler fiziksel (taşıma, sürükleme, itki, yerçekimi),
// açısal hareket fly-by-wire "oran/g komutu" modeliyle (9g sınırı, AoA sınırlayıcı, otomatik trim).
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
  S: 42.7, span: 10.7,
  thrustMil: 125000, thrustAB: 191000, idleFrac: 0.04,
  CLa: 4.0, CL0: 0.04, CLmax: 1.75, alphaLin: 17 * DEG, alphaStall: 26 * DEG, alphaLimit: 24 * DEG,
  CD0: 0.016, e: 0.76, CDgear: 0.022, CDflaps: 0.016, CDbrakeAir: 0.0,
  CLflaps: 0.5,
  gMax: 9, gMin: -3,
  rollRateMax: 240 * DEG, pitchRateMax: 45 * DEG, yawRateMax: 20 * DEG,
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

function lerpAngle(a, b, t) { return a + (b - a) * t; }

export class FlightModel {
  constructor(world) {
    this.world = world;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.rates = { p: 0, q: 0, r: 0 }; // yatış, yunuslama, sapma (rad/s, gövde)
    this.throttle = 0;          // 0..1 (askeri güç)
    this.afterburner = false;
    this.engine = 0;            // spool (0..1 askeri)
    this.abLevel = 0;           // art yakıcı seviyesi 0..1
    this.gearCmd = 1; this.gearPos = 1;
    this.flapsCmd = 0; this.flapsPos = 0;
    this.brakes = true;
    this.fuel = AERO.fuel;
    this.crashed = false; this.crashReason = '';
    this.onGround = true;
    this.time = 0;
    this.stick = { pitch: 0, roll: 0, yaw: 0 };
    this.telemetry = {};
    this.wingRockSeed = 0;
    this._v = new THREE.Vector3(); this._f = new THREE.Vector3(); this._q = new THREE.Quaternion();
    this._fwd = new THREE.Vector3(); this._up = new THREE.Vector3(); this._right = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this.reset();
  }

  reset() {
    // Pist 09 eşiği, doğuya bakış, motor rölanti, fren açık
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
    this.updateTelemetry(atmosphere(gy), 0, 0, 0, 1);
  }

  get mass() { return AERO.massEmpty + this.fuel; }

  setControls({ pitch = 0, roll = 0, yaw = 0, throttle, afterburner, brakes }) {
    this.stick.pitch = clamp(pitch, -1, 1);
    this.stick.roll = clamp(roll, -1, 1);
    this.stick.yaw = clamp(yaw, -1, 1);
    if (throttle !== undefined) this.throttle = clamp(throttle, 0, 1);
    if (afterburner !== undefined) this.afterburner = !!afterburner;
    if (brakes !== undefined) this.brakes = !!brakes;
  }
  toggleGear() { this.gearCmd = this.gearCmd > 0.5 ? 0 : 1; }
  toggleFlaps() { this.flapsCmd = this.flapsCmd > 0.5 ? 0 : 1; }
  toggleBrakes() { this.brakes = !this.brakes; }

  // Yere göre en alçak noktanın ağırlık merkezinden aşağı mesafesi (pozitif)
  requiredClearance(pitch, roll) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    let d;
    if (this.gearPos > 0.98) {
      const main = -F35.wheelBottomY * c + F35.mainGearZ * s;   // 2.2cosθ + 0.9 sinθ
      const nose = -F35.wheelBottomY * c - F35.noseGearZ * s;   // 2.2cosθ + 4.1 sinθ (θ<0 iken büyür)
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

    // Sistemler
    const gearRate = 1 / 6; // 6 s
    this.gearPos = clamp(this.gearPos + Math.sign(this.gearCmd - this.gearPos) * gearRate * dt, 0, 1);
    if (Math.abs(this.gearCmd - this.gearPos) < gearRate * dt) this.gearPos = this.gearCmd;
    const flapRate = 1 / 3;
    this.flapsPos = clamp(this.flapsPos + Math.sign(this.flapsCmd - this.flapsPos) * flapRate * dt, 0, 1);
    if (Math.abs(this.flapsCmd - this.flapsPos) < flapRate * dt) this.flapsPos = this.flapsCmd;

    // Motor spool
    const tau = this.throttle > this.engine ? 1.6 : 1.0;
    this.engine += (this.throttle - this.engine) * (1 - Math.exp(-dt / tau));
    const abTarget = (this.afterburner && this.engine > 0.9) ? 1 : 0;
    this.abLevel += (abTarget - this.abLevel) * (1 - Math.exp(-dt / 0.5));

    // Atmosfer
    const atm = atmosphere(pos.y);
    const rho = atm.rho;
    const V = vel.length();
    const mach = V / atm.a;
    const qd = 0.5 * rho * V * V;

    // Gövde eksenli hız
    const vb = this._v.copy(vel).applyQuaternion(this._q.copy(quat).invert());
    const u = -vb.z, w = vb.y, v = vb.x;
    const alpha = V > 1 ? Math.atan2(-w, Math.max(u, 0.5)) : pitch * 0;
    const beta = V > 1 ? Math.asin(clamp(v / V, -1, 1)) : 0;

    // ---- Aerodinamik katsayılar ----
    const aAbs = Math.abs(alpha);
    let CL;
    const lin = AERO.CL0 + AERO.CLa * alpha;
    const post = 1.15 * Math.sin(2 * alpha);
    const blend = smoothstep(AERO.alphaLin, AERO.alphaStall + 6 * DEG, aAbs);
    CL = lin * (1 - blend) + post * blend;
    CL += AERO.CLflaps * this.flapsPos * (1 - smoothstep(AERO.alphaStall, AERO.alphaStall + 10 * DEG, aAbs));
    // Mach etkisi: ses üstü taşıma eğimi düşer
    CL *= 1 - 0.25 * smoothstep(1.0, 1.6, mach);
    const AR = AERO.span * AERO.span / AERO.S;
    const K = 1 / (Math.PI * AR * AERO.e);
    let CD0 = AERO.CD0 + AERO.CDgear * this.gearPos + AERO.CDflaps * this.flapsPos;
    CD0 += 0.052 * smoothstep(0.88, 1.12, mach) + 0.03 * smoothstep(1.35, 1.75, mach);
    let CD = CD0 + K * CL * CL + 0.9 * Math.pow(Math.sin(aAbs), 2) * blend;
    const CY = -0.9 * beta;

    const L = qd * AERO.S * CL;
    const D = qd * AERO.S * CD;
    const Y = qd * AERO.S * CY;

    // ---- Kuvvetler (dünya) ----
    const F = this._f.set(0, -m * G, 0);
    if (V > 0.5) {
      const vhat = this._acc.copy(vel).multiplyScalar(1 / V);
      // taşıma yönü: hız vektörüne dik, gövde "yukarı" düzleminde
      const liftDir = up.clone().addScaledVector(vhat, -up.dot(vhat));
      if (liftDir.lengthSq() > 1e-6) liftDir.normalize();
      F.addScaledVector(liftDir, L);
      F.addScaledVector(vhat, -D);
      F.addScaledVector(right, Y);
    }
    // İtki: yoğunlukla azalır, hafif ram etkisi
    const densityFactor = Math.pow(rho / 1.225, 0.72) * (1 + 0.18 * clamp(mach, 0, 1.6));
    const Tmil = AERO.thrustMil * densityFactor;
    const thrust = Tmil * (AERO.idleFrac + (1 - AERO.idleFrac) * this.engine) + (AERO.thrustAB - AERO.thrustMil) * densityFactor * this.abLevel;
    F.addScaledVector(fwd, thrust);
    // Yakıt
    const sfc = 2.4 * (0.08 + 0.92 * this.engine) + 8.5 * this.abLevel;
    this.fuel = Math.max(0, this.fuel - sfc * dt * (this.fuel > 0 ? 1 : 0));

    // ---- Yer teması ----
    const groundY = this.world.heightAt(pos.x, pos.z);
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
        // Temas anı: iniş koşulları
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
      // Yere kilitle: düşey hızı sıfırla (esnek olmayan), pozisyonu düzelt
      if (vel.y < 0) vel.y = 0;
      pos.y = groundY + clearance;
      groundNormalForce = Math.max(0, m * G - L * Math.cos(pitch));
      // Tekerlek sürtünmesi ve fren
      const rollMu = paved ? 0.02 : 0.09;
      const brakeMu = this.brakes ? (paved ? 0.5 : 0.25) : 0;
      const decel = (rollMu + brakeMu) * groundNormalForce / m;
      // Yanal lastik sürtünmesi (kayma yok): gövde-x hızını söndür
      const lateralKill = 1 - Math.exp(-dt * 12);
      const vbx = vel.dot(right);
      vel.addScaledVector(right, -vbx * lateralKill);
      // İleri hızı yavaşlat
      const vfwd = vel.dot(fwd);
      const dv = Math.min(Math.abs(vfwd), decel * dt);
      vel.addScaledVector(fwd, -Math.sign(vfwd) * dv);
      // Yer düzleminde kalması için düşey hız bileşenini engelle
      F.y = Math.max(F.y, 0);
    }
    this.onGround = onGround;

    // ---- Doğrusal entegrasyon ----
    const acc = this._acc.copy(F).multiplyScalar(1 / m);
    vel.addScaledVector(acc, dt);
    if (onGround && vel.y < 0) vel.y = 0;
    pos.addScaledVector(vel, dt);
    if (onGround) pos.y = Math.max(pos.y, groundY + clearance);

    // ---- Açısal hareket: FBW ----
    const authority = clamp(qd / 9000, 0.12, 1);          // kontrol yüzeyi etkinliği
    const st = this.stick;
    const R = this.rates;
    const Vs = Math.max(V, 30);
    let pCmd, qCmd, rCmd;
    if (onGround) {
      // Yerde: burun tekeri dümeni, yatış sıfır, rotasyon hız gerektirir
      const steerMax = 55 * DEG * clamp(1 - V / 45, 0.05, 1);
      const steer = st.yaw * steerMax;
      const wheelbase = F35.mainGearZ - F35.noseGearZ;
      const vfwd = vel.dot(fwd);
      // Kinematik dönüş oranı, lastik yanal tutuşu (~0.45 g) ile sınırlı
      const rKin = (vfwd * Math.tan(steer)) / wheelbase;
      const rTireMax = 0.45 * G / Math.max(Math.abs(vfwd), 1);
      rCmd = -clamp(rKin, -rTireMax, rTireMax); // sağa dümen -> sağa dönüş (negatif y dönüşü)
      pCmd = -roll * 6;
      const rotAuth = smoothstep(2200, 5200, qd);
      const pullRate = st.pitch > 0 ? st.pitch * 18 * DEG * rotAuth : st.pitch * 10 * DEG;
      qCmd = pullRate;
      // Burun tekeri yerde: yunuslama 0'ın altına inemez; yeterli hız yoksa burun düşer
      if (pitch <= 0.001 && qCmd < 0) qCmd = 0;
      if (pitch > 0.001) qCmd -= 4 * DEG * (1 - rotAuth); // yetersiz hızda burun düşer
      if (pitch > 13 * DEG && qCmd > 0) qCmd = 0;
    } else {
      // Havada: g komutu -> yunuslama oranı; otomatik trim (nötr çubuk = 1g)
      const nCmd = st.pitch >= 0 ? 1 + st.pitch * (AERO.gMax - 1) : 1 + st.pitch * (1 - AERO.gMin);
      qCmd = (nCmd - Math.cos(roll) * Math.cos(pitch)) * G / Vs;
      // Aerodinamik olarak mümkün olan maksimum g (CLmax ile)
      const nAvail = qd * AERO.S * AERO.CLmax / (m * G);
      const qAvail = (Math.max(nAvail, 0.2) + 0.2) * G / Vs;
      qCmd = clamp(qCmd, -qAvail, qAvail);
      // AoA sınırlayıcı
      const aMargin = AERO.alphaLimit - alpha;
      if (qCmd > 0 && aMargin < 6 * DEG) qCmd = Math.min(qCmd, Math.max(0, aMargin) * 1.2);
      if (qCmd < 0 && alpha < -12 * DEG) qCmd = Math.max(qCmd, 0);
      qCmd = clamp(qCmd, -AERO.pitchRateMax, AERO.pitchRateMax);
      // Yatış oranı
      const highAlpha = smoothstep(18 * DEG, 30 * DEG, aAbs);
      pCmd = st.roll * AERO.rollRateMax * authority * (1 - 0.7 * highAlpha);
      pCmd += -beta * 0.6; // dihedral etkisi
      // Sapma: dümen + rüzgar gülü etkisi
      rCmd = -st.yaw * AERO.yawRateMax * authority - beta * (2.5 * authority + 0.5);
      // Stall sonrası: burun düşme eğilimi ve kanat sallanması
      if (aAbs > AERO.alphaStall) {
        const ex = (aAbs - AERO.alphaStall);
        qCmd -= Math.sign(alpha) * ex * 2.5;
        this.wingRockSeed += dt;
        pCmd += Math.sin(this.wingRockSeed * 5.3) * Math.sin(this.wingRockSeed * 2.1) * ex * 6;
      }
    }
    const kq = onGround ? 5 : 3.0 + 5 * authority;
    const kp = onGround ? 8 : 4 + 8 * authority;
    const kr = onGround ? 8 : 2 + 3 * authority;
    R.q += (qCmd - R.q) * (1 - Math.exp(-kq * dt));
    R.p += (pCmd - R.p) * (1 - Math.exp(-kp * dt));
    R.r += (rCmd - R.r) * (1 - Math.exp(-kr * dt));

    // Kuaterniyon entegrasyonu: gövde açısal hızı (x: q, y: r, z: -p)
    const wx = R.q, wy = R.r, wz = -R.p;
    const wlen = Math.hypot(wx, wy, wz);
    if (wlen > 1e-9) {
      this._q.setFromAxisAngle(this._v.set(wx / wlen, wy / wlen, wz / wlen), wlen * dt);
      quat.multiply(this._q).normalize();
    }
    if (onGround) {
      // Yerde yatışı sıfırla, yunuslamayı sınırla
      const fwd2 = this._fwd.set(0, 0, -1).applyQuaternion(quat);
      let p2 = Math.asin(clamp(fwd2.y, -1, 1));
      const heading = Math.atan2(fwd2.x, -fwd2.z);
      if (p2 < 0) p2 = 0;
      const e = new THREE.Euler(0, 0, 0, 'YXZ');
      e.y = -heading; e.x = p2; e.z = 0;
      quat.setFromEuler(e);
      if (p2 <= 0 && R.q < 0) R.q = 0;
      R.p = 0;
    }

    // ---- Çarpışma kontrolleri ----
    if (!onGround && agl < clearance - 0.5) return this.crash('Yere çarptınız');
    if (surface === 'water' && pos.y - 1.0 < WATER_LEVEL) return this.crash('Suya çarptınız');
    if (this.world.hitsBuilding(pos.x, pos.y, pos.z, 4)) return this.crash('Binaya çarptınız');
    if (pos.y > 25000) { pos.y = 25000; if (vel.y > 0) vel.y = 0; }
    const half = 10000 - 100;
    if (Math.abs(pos.x) > half || Math.abs(pos.z) > half) {
      pos.x = clamp(pos.x, -half, half); pos.z = clamp(pos.z, -half, half);
    }

    // Yük faktörü (gövde-yukarı yönündeki özgül kuvvet, yerçekimi hariç)
    const nz = onGround ? 1 : (L * 1 + 0) / (m * G) * (Math.cos(alpha)) + thrust * Math.sin(alpha) / (m * G);
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
      onGround: this.onGround, stall: !this.onGround && Math.abs(alpha) > 21 * DEG && V > 20,
      fuelKg: this.fuel, surface: extra.surface || 'runway', thrustKN: (extra.thrust || 0) / 1000,
      authority,
    };
  }
}
