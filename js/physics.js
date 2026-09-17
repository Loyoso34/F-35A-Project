// F-35A uçuş dinamiği: 120 Hz sabit adım.
// Kuvvetler: taşıma (stall sonrası ani düşüş), sürükleme, itki, yerçekimi, yer etkisi.
// Momentler: aerodinamik (statik kararlılık, sönüm, dihedral, rüzgar gülü, stall sonrası burun düşmesi,
// kanat sallanması) + kontrol yüzeylerinin dinamik basınçla sınırlı kontrol gücü.
// Fly-by-wire: g/oran komutu, 9g ve AoA sınırlayıcı, otomatik trim; yetki yetmeyince aerodinamik kazanır.
import * as THREE from 'three';
import { clamp, smoothstep } from './noise.js';
import { WATER_LEVEL, surfaceTypeAt } from './world.js';

export const FIXED_DT = 1 / 120;
const G = 9.80665;
const DEG = Math.PI / 180;
export const KT = 1.943844;   // m/s -> knot
export const FT = 3.28084;    // m -> feet


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
export function liftCoefficient(alpha, flaps = 0, mach = 0, AERO = null, slats = 0) {
  if (!AERO) return 0;
  const a0 = -AERO.CL0 / AERO.CLa;            // sıfır taşıma açısı
  const ae = alpha - a0;
  const s = Math.sign(ae) || 1;
  const a = Math.abs(ae);
  // Slatlar stall açısını geciktirir
  const dAlpha = (AERO.alphaSlat || 0) * slats;
  const aLin = AERO.alphaLin + dAlpha, aMax = AERO.alphaMax + dAlpha, aDrop = AERO.alphaDrop + dAlpha;
  let CL;
  if (a <= aLin) {
    CL = AERO.CLa * a;
  } else if (a <= aMax) {
    // doğrusaldan tepeye yumuşak yuvarlanma (tepe eğimi sıfır)
    const clAtLin = AERO.CLa * aLin;
    const t = (aMax - a) / (aMax - aLin);
    CL = AERO.CLmax - (AERO.CLmax - clAtLin) * t * t;
  } else if (a <= aDrop) {
    // stall: taşıma hızla düşer
    const t = smoothstep(aMax, aDrop, a);
    CL = AERO.CLmax + (0.95 - AERO.CLmax) * t;
  } else {
    // düz plaka
    CL = 0.95 * Math.sin(2 * a) / Math.sin(2 * aDrop);
  }
  CL *= s;
  // Flap ve slat katkısı stall ile kaybolur
  const fade = 1 - smoothstep(aMax, aDrop, a);
  CL += AERO.CLflaps * flaps * fade;
  if (AERO.CLslats) CL += AERO.CLslats * slats * fade;
  // Ses üstü: taşıma eğimi düşer
  CL *= 1 - 0.25 * smoothstep(1.0, 1.6, mach);
  return CL;
}

export class FlightModel {
  constructor(world, cfg) {
    this.world = world;
    this.cfg = cfg;
    this.aero = cfg.aero; this.geom = cfg.geom; this.law = cfg.law;
    this.gnd = cfg.ground; this.lim = cfg.limits; this.sys = cfg.systems;
    this.pos = new THREE.Vector3();
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.rates = { p: 0, q: 0, r: 0 }; // yatış, yunuslama, sapma (rad/s, gövde)
    this.throttle = 0;
    this.afterburner = false;
    this.engine = 0;
    this.abLevel = 0;
    this.gearCmd = 1; this.gearPos = 1;
    this.flapIndex = 0; this.flapsCmd = 0; this.flapsPos = 0; this.slatsPos = 0;
    this.spoilerCmd = 0; this.spoilerPos = 0; this.reverseCmd = 0; this.reversePos = 0;
    this.brakes = true;
    this.fuel = cfg.aero.fuel;
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
    this._air = new THREE.Vector3(); this._wind = new THREE.Vector3();
    // Rüzgar: yönü meteorolojik (rüzgarın GELDİĞİ yön, derece), hız kt. Pist 09/27 doğu-batı uzanır;
    // 110° pist 09 için hafif karşı rüzgar ve ~3 kt çapraz bileşen verir. Kesme ve gust dahil.
    this.wind = { dirDeg: 110, kt: 9, gustKt: 4, shear: 0.22 };
    this.reset();
  }

  reset() {
    const x = -1400, z = 0;
    const gy = this.world.heightAt(x, z);
    this.groundY = gy;
    this.pos.set(x, gy - this.geom.wheelBottomY, z);
    this.quat.setFromEuler(new THREE.Euler(0, -Math.PI / 2, 0));
    this.vel.set(0, 0, 0);
    this.rates.p = this.rates.q = this.rates.r = 0;
    this.throttle = 0; this.afterburner = false; this.engine = 0; this.abLevel = 0;
    this.gearCmd = 1; this.gearPos = 1; this.flapIndex = 0; this.flapsCmd = 0; this.flapsPos = 0; this.slatsPos = 0;
    this.spoilerCmd = 0; this.spoilerPos = 0; this.reverseCmd = 0; this.reversePos = 0;
    this.brakes = true; this.fuel = this.aero.fuel;
    this.crashed = false; this.crashReason = ''; this.onGround = true; this.time = 0;
    this.wasOnGround = true;
    this.surfaces.elevator = this.surfaces.aileron = this.surfaces.rudder = 0;
    this.stickF.pitch = this.stickF.roll = 0; this.act.M = this.act.L = this.act.N = 0;
    this.updateTelemetry(atmosphere(gy), 0, 0, 1, 1);
  }

  get mass() { return this.aero.massEmpty + this.fuel; }

  setControls({ pitch = 0, roll = 0, yaw = 0, throttle, afterburner, brakes }) {
    // Çubuk şekillendirme: küçük girişlerde daha hassas
    const shape = (v) => Math.sign(v) * Math.pow(Math.min(1, Math.abs(v)), this.law.stickPow);
    this.stick.pitch = shape(clamp(pitch, -1, 1));
    this.stick.roll = shape(clamp(roll, -1, 1));
    this.stick.yaw = clamp(yaw, -1, 1);
    if (throttle !== undefined) this.throttle = clamp(throttle, 0, 1);
    if (afterburner !== undefined) this.afterburner = !!afterburner;
    if (brakes !== undefined) this.brakes = !!brakes;
  }
  toggleGear() { this.gearCmd = this.gearCmd > 0.5 ? 0 : 1; }
  // Belirli bir irtifadaki rüzgar vektörü (dünya eksenleri, m/s).
  // Yüzeye yakın sürtünme katmanında hız düşer (kesme), üstte tam değere çıkar; gust yavaş salınır.
  windAt(y, t, out) {
    const w = this.wind, v = out || this._wind;
    if (!w || w.kt <= 0) return v.set(0, 0, 0);
    const agl = Math.max(0, y - this.groundY);
    const prof = 1 - w.shear * Math.exp(-agl / 120);            // yer sürtünmesi: alçakta daha zayıf
    const gust = w.gustKt * (0.55 * Math.sin(t * 0.37) + 0.45 * Math.sin(t * 0.91 + 1.7));
    const sp = Math.max(0, (w.kt + gust)) * 0.514444 * prof;    // kt -> m/s
    const th = (w.dirDeg + 8 * Math.sin(t * 0.21)) * DEG;       // yön de yavaşça gezinir
    // Meteorolojik yön rüzgarın geldiği yer: vektör ters yöne akar. 0° = -Z'den (kuzeyden) eser.
    return v.set(-Math.sin(th) * sp, 0, Math.cos(th) * sp);
  }
  // Flap kolu: iki kademeli uçakta aç/kapat, çok kademelide sırayla ilerler
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

  requiredClearance(pitch, roll) {
    const c = Math.cos(pitch), s = Math.sin(pitch);
    let d;
    if (this.gearPos > 0.98) {
      const g = this.geom;
      const main = -g.wheelBottomY * c + g.mainGearZ * s;
      const nose = -g.wheelBottomY * c - g.noseGearZ * s;
      d = Math.max(main, nose);
    } else {
      d = this.geom.bellyR * c + this.geom.bellyArm * Math.abs(s);
    }
    d = Math.max(d, Math.abs(Math.sin(roll)) * this.geom.rollArmX + this.geom.rollArmY);
    return d;
  }

  step(dt) {
    if (this.crashed) return;
    this.time += dt;
    const A = this.aero, LAW = this.law, GND = this.gnd, LIM = this.lim, SYS = this.sys;
    const m = this.mass;
    const pos = this.pos, vel = this.vel, quat = this.quat;
    const fwd = this._fwd.set(0, 0, -1).applyQuaternion(quat);
    const up = this._up.set(0, 1, 0).applyQuaternion(quat);
    const right = this._right.set(1, 0, 0).applyQuaternion(quat);
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const roll = Math.atan2(-right.y, up.y);

    // ---- Sistemler ----
    const gearRate = SYS.gearRate;
    this.gearPos = clamp(this.gearPos + Math.sign(this.gearCmd - this.gearPos) * gearRate * dt, 0, 1);
    if (Math.abs(this.gearCmd - this.gearPos) < gearRate * dt) this.gearPos = this.gearCmd;
    const flapRate = SYS.flapRate;
    this.flapsPos = clamp(this.flapsPos + Math.sign(this.flapsCmd - this.flapsPos) * flapRate * dt, 0, 1);
    if (Math.abs(this.flapsCmd - this.flapsPos) < flapRate * dt) this.flapsPos = this.flapsCmd;
    // Slatlar flaplardan önce açılır (CONF 1'de slat var, flap yok)
    this.slatsPos = SYS.slatLead ? Math.min(1, this.flapsPos * SYS.slatLead) : 0;
    // Spoyler: havada HIZ FRENİ olarak kısıtlı açılır (airFrac), yerde tam YER SPOYLERİ olarak açılır.
    // Yerde fren ya da ters itkiyle otomatik devreye girer (yer temas mantığı).
    if (SYS.spoilers) {
      const auto = SYS.spoilers.groundAuto && this.onGround && (this.brakes || this.reversePos > 0.05) && Math.abs(this.vel.length()) > 8;
      const maxDefl = this.onGround ? 1 : (SYS.spoilers.airFrac !== undefined ? SYS.spoilers.airFrac : 1);
      const target = Math.min(maxDefl, Math.max(this.spoilerCmd, auto ? 1 : 0));
      this.spoilerPos += (target - this.spoilerPos) * (1 - Math.exp(-dt * SYS.spoilers.rate));
    } else this.spoilerPos = 0;
    // Ters itki: yalnızca yerde, belirgin bir yer hızındayken ve fren komutuyla devreye girer.
    // Hız eşiği olmadan park halinde fren tutarken de açılırdı. Gaz kolu ileri itilirse geri alınır.
    this.reverseCmd = (SYS.reverse > 0 && this.onGround && this.brakes && this.vel.length() > 12 && this.throttle < 0.5) ? 1 : 0;
    this.reversePos += (this.reverseCmd - this.reversePos) * (1 - Math.exp(-dt / 1.2));

    // Motor: F135 rölanti->askeri ~4 s, geri ~2 s, art yakıcı ~0.7 s
    // Motor spool gecikmesi uçağa özgüdür: yüksek baypaslı ticari turbofan, savaş uçağı motorundan
    // belirgin biçimde yavaş toparlanır (rölantiden TOGA'ya ~8 s). idleLag düşük N1'de ek gecikme verir.
    const SP = A.spool;
    const tau = this.throttle > this.engine
      ? SP.up * (1 - SP.idleLag + SP.idleLag * (1 - this.engine))
      : SP.down;
    this.engine += (this.throttle - this.engine) * (1 - Math.exp(-dt / tau));
    const abTarget = (this.afterburner && this.engine > 0.92) ? 1 : 0;
    this.abLevel += (abTarget - this.abLevel) * (1 - Math.exp(-dt / 0.7));

    // ---- Atmosfer ve hava verileri ----
    const atm = atmosphere(pos.y);
    const rho = atm.rho;
    // Aerodinamik her zaman HAVAYA göre bağıl hızla hesaplanır: rüzgar sürüklenme, yengeç açısı,
    // yerde rüzgar gülü etkisi ve iniş/kalkışta hız farkı bundan doğar.
    const wind = this.windAt(pos.y, this.time);
    const air = this._air.copy(vel).sub(wind);
    const V = air.length();
    const mach = V / atm.a;
    const qd = 0.5 * rho * V * V;
    const vb = this._v.copy(air).applyQuaternion(this._q.copy(quat).invert());
    const u = -vb.z, w = vb.y, v = vb.x;
    const alpha = V > 1 ? Math.atan2(-w, Math.max(u, 0.5)) : 0;
    const beta = V > 1 ? Math.asin(clamp(v / V, -1, 1)) : 0;
    const aAbs = Math.abs(alpha);

    // ---- Aerodinamik katsayılar (rüzgar eksenleri) ----
    // Yer etkisi: kanat yere yaklaşınca indüklenmiş sürükleme azalır, taşıma eğimi hafif artar
    const groundYq = this.world.heightAt(pos.x, pos.z);
    const hWing = Math.max(0.5, pos.y - groundYq - 1.0);
    const hb = 16 * hWing / A.span;
    const sigma = (hb * hb) / (1 + hb * hb);           // 1: yer etkisi yok, ->0: yerde
    let CL = liftCoefficient(alpha, this.flapsPos, mach, A, this.slatsPos);
    CL *= 1 + 0.10 * (1 - sigma);
    const AR = A.span * A.span / A.S;
    const e = A.e + (A.eFlaps - A.e) * this.flapsPos;
    const K = (1 / (Math.PI * AR * e)) * sigma;
    // Parazit sürükleme: temiz + takım + flap + dalga sürüklemesi (ses altı-üstü geçişi)
    let CD0 = A.CD0 + A.CDgear * this.gearPos + A.CDflaps * this.flapsPos;
    if (A.CDspoiler) { CD0 += A.CDspoiler * this.spoilerPos; CL *= 1 - A.CLspoiler * this.spoilerPos; }
    CD0 += 0.052 * smoothstep(0.88, 1.12, mach) + 0.03 * smoothstep(1.35, 1.75, mach);
    const stallBlend = smoothstep(A.alphaMax, A.alphaDrop, aAbs);
    // İndüklenmiş sürükleme (stall sonrası ayrılmış akış: düz plaka terimi devralır)
    const CDi = K * CL * CL * (1 - 0.5 * stallBlend);
    const CDsep = 1.4 * Math.pow(Math.sin(aAbs), 2) * smoothstep(20 * DEG, 40 * DEG, aAbs);
    const CD = CD0 + CDi + CDsep;
    const CY = -0.9 * beta;

    const L = qd * A.S * CL;
    const D = qd * A.S * CD;
    const Y = qd * A.S * CY;

    // ---- Kuvvetler (dünya) ----
    const F = this._f.set(0, -m * G, 0);
    if (V > 0.5) {
      const vhat = this._acc.copy(air).multiplyScalar(1 / V);
      const liftDir = this._lift.copy(up).addScaledVector(vhat, -up.dot(vhat));
      if (liftDir.lengthSq() > 1e-6) liftDir.normalize();
      F.addScaledVector(liftDir, L);
      F.addScaledVector(vhat, -D);
      F.addScaledVector(right, Y);
    }
    // İtki kaybı: yoğunlukla (irtifa) ve Mach ile. Düşük baypaslı askeri turbofanda Mach itkiyi artırır
    // (ram basıncı), yüksek baypaslı ticari turbofanda ise net itki hızla belirgin biçimde düşer.
    const machLapse = Math.max(A.thrustFloor, 1 + A.thrustRam * clamp(mach, 0, 1.6));
    const densityFactor = Math.pow(rho / 1.225, A.thrustRhoExp) * machLapse;
    const Tmil = A.thrustMil * densityFactor;
    let thrust = Tmil * (A.idleFrac + (1 - A.idleFrac) * this.engine) + (A.thrustAB - A.thrustMil) * densityFactor * this.abLevel;
    if (this.reversePos > 0.001) thrust -= Tmil * (SYS.reverse || 0) * this.reversePos * (0.55 + 0.45 * this.engine) * 2;
    F.addScaledVector(fwd, thrust);
    const sfc = A.sfcMil * (0.08 + 0.92 * this.engine) + A.sfcAB * this.abLevel;
    this.fuel = Math.max(0, this.fuel - sfc * dt);

    // ---- Yer teması ----
    const groundY = groundYq;
    this.groundY = groundY;   // rüzgar kesme profili bir sonraki adımda bunu kullanır
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
      groundNormalForce = Math.max(0, m * G - L * Math.cos(pitch));
      const rollMu = paved ? GND.rollMu[0] : GND.rollMu[1];
      const brakeMu = this.brakes ? (paved ? GND.brakeMu[0] : GND.brakeMu[1]) : 0;
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
    const highAlpha = smoothstep(A.alphaMax * 0.85, A.alphaDrop, aAbs);
    const ctlEff = 1 - 0.65 * highAlpha;               // stall sonrası yüzey etkinliği
    const authority = clamp(qd / LAW.qAuth, 0.05, 1);

    if (onGround) {
      // Yerde: kinematik model (burun tekeri dümeni, yatış sıfır, rotasyon hız gerektirir)
      const steerMax = GND.steerMax * clamp(1 - V / GND.steerV, 0.05, 1);
      const steer = st.yaw * steerMax;
      const wheelbase = this.geom.mainGearZ - this.geom.noseGearZ;
      const vfwd = vel.dot(fwd);
      const rKin = (vfwd * Math.tan(steer)) / wheelbase;
      const rTireMax = GND.tireGrip * G / Math.max(Math.abs(vfwd), 1);
      const rCmd = -clamp(rKin, -rTireMax, rTireMax);
      const rotAuth = smoothstep(GND.rotQ[0], GND.rotQ[1], qd);
      let qCmd = st.pitch > 0 ? st.pitch * GND.rotRate * rotAuth : st.pitch * GND.pushRate;
      if (pitch <= 0.001 && qCmd < 0) qCmd = 0;
      if (pitch > 0.001) qCmd -= 4 * DEG * (1 - rotAuth);
      if (pitch > GND.maxPitch && qCmd > 0) qCmd = 0;
      R.q += (qCmd - R.q) * (1 - Math.exp(-5 * dt));
      R.r += (rCmd - R.r) * (1 - Math.exp(-8 * dt));
      R.p += (-roll * 6 - R.p) * (1 - Math.exp(-8 * dt));
      this.surfaces.elevator += (st.pitch - this.surfaces.elevator) * (1 - Math.exp(-10 * dt));
      this.surfaces.aileron += (st.roll - this.surfaces.aileron) * (1 - Math.exp(-10 * dt));
      this.surfaces.rudder += (st.yaw - this.surfaces.rudder) * (1 - Math.exp(-10 * dt));
    } else {
      // --- FBW komutları ---
      // Çubuk ön filtresi (τ 0.12 s): ani bırakmada komut basamağı yumuşar, gecikme hissedilmez
      const kPre = 1 - Math.exp(-dt / LAW.prefilter);
      this.stickF.pitch += (st.pitch - this.stickF.pitch) * kPre;
      this.stickF.roll += (st.roll - this.stickF.roll) * (1 - Math.exp(-dt / LAW.rollFilter));
      const sp = this.stickF.pitch;
      // İç döngü (oran) kazancı: q, komuta 1/Kq zaman sabitiyle yaklaşır
      const Kq = LAW.Kq0 + LAW.KqA * authority, Kp = LAW.Kp0 + LAW.KpA * authority, Kr = LAW.Kr0 + LAW.KrA * authority;
      // Gerçek yük faktörü (gövde-dik özgül kuvvet): taşıma + itkinin dik bileşeni
      const nAct = (L * Math.cos(alpha) + thrust * Math.sin(alpha)) / (m * G);
      // Yüksek hız: g komutu (nötr çubuk = 1g, uçuş yolu korunur; tutum hıza göre kendini ayarlar)
      const nCmd = sp >= 0 ? 1 + sp * (A.gMax - 1) : 1 + sp * (1 - A.gMin);
      // Kullanılabilir g, İÇİNDE BULUNULAN KONFİGÜRASYONUN azami taşımasıyla hesaplanır.
      // Yalnızca temiz CLmax kullanılırsa flap/slat açıkken tavan 1 g'nin altına düşer ve
      // uçak flare yapamaz (yaklaşmada burun kaldırma komutu kırpılırdı).
      const CLmaxCfg = A.CLmax + A.CLflaps * this.flapsPos + (A.CLslats || 0) * this.slatsPos;
      const nAvail = qd * A.S * CLmaxCfg / (m * G);
      const nTarget = clamp(nCmd, Math.min(nCmd, A.gMin), Math.max(0.25, nAvail * 0.98));
      const qSteady = (nTarget - Math.cos(roll) * Math.cos(pitch)) * G / Vs;   // hedef g için kararlı hal yunuslama oranı
      // Dış döngü kazancı dinamik basınca göre programlanır: kısa periyot kapalı döngü sönümü ζ≈0.9
      // (ωn² = Kq·kα·(Kn + g/V), 2ζωn = Kq + kα·g/V; kα = taşıma eğimi [g/rad])
      const kAlpha = Math.max(0.5, A.CLa * qd * A.S / (m * G));
      const zeta = LAW.zeta;
      const Kn = clamp(Kq / (4 * zeta * zeta * kAlpha) - G / Vs, 0.03, 0.8);
      let qCmdG = qSteady + (nTarget - nAct) * Kn;
      // Düşük hız: AoA komutu (nötr çubuk = trim AoA'sı ~ 1g, tam çubuk = sınır AoA); aynı sönüm hedefiyle programlanır
      const alphaTrim = clamp((m * G / Math.max(qd * A.S, 1) - A.CL0 - A.CLflaps * this.flapsPos - (A.CLslats || 0) * this.slatsPos) / A.CLa, 2 * DEG, A.alphaLimit);
      const alphaCmd = sp >= 0 ? alphaTrim + sp * (A.alphaLimit - alphaTrim) : alphaTrim + sp * (alphaTrim + 8 * DEG);
      const gkv = G * kAlpha / Vs;
      const Ka = clamp((Kq + gkv) * (Kq + gkv) / (4 * zeta * zeta * Kq) - gkv, 0.6, 2.2);
      const qCmdA = (alphaCmd - alpha) * Ka;
      const wG = smoothstep(LAW.qBlend[0], LAW.qBlend[1], qd);
      let qCmd = qCmdA * (1 - wG) + qCmdG * wG;
      // AoA sınırlayıcı: sınıra yaklaşınca burun yukarı komutu kısılır, aşınca burun aşağı istenir
      const aMargin = A.alphaLimit - alpha;
      if (aMargin < 5 * DEG) qCmd = Math.min(qCmd, aMargin * 1.5);
      if (alpha < -12 * DEG) qCmd = Math.max(qCmd, 0);
      qCmd = clamp(qCmd, -A.pitchRateMax, A.pitchRateMax);
      const pCmd = this.stickF.roll * A.rollRateMax * clamp(qd / LAW.qRoll, 0.15, 1);
      // Hız vektörü etrafında yatış için koordineli sapma + kayma sıfırlama + dümen
      let rCmd = -pCmd * Math.tan(clamp(alpha, -0.6, 0.6)) * 0.85 - beta * 3.0 - st.yaw * A.yawRateMax;

      // --- Aerodinamik momentler ---
      const qS = qd * A.S;
      const c2v = A.chord / (2 * Vs), b2v = A.span / (2 * Vs);
      const qhat = R.q * c2v, phat = R.p * b2v, rhat = R.r * b2v;
      const t = this.time;
      const buffet = smoothstep(18 * DEG, 26 * DEG, aAbs);
      const noiseA = Math.sin(t * 47.0) * Math.sin(t * 13.3) + Math.sin(t * 29.0) * 0.5;
      const noiseB = Math.sin(t * 41.0 + 1.7) * Math.sin(t * 11.1) + Math.sin(t * 23.0 + 0.4) * 0.5;
      let Cm = A.Cm0 + A.Cma * alpha + A.Cmq * qhat + A.CmFlaps * this.flapsPos + (A.CmSpoiler || 0) * this.spoilerPos;
      if (aAbs > A.alphaMax) Cm += A.CmStall * (aAbs - A.alphaMax) * Math.sign(alpha);
      Cm += buffet * noiseA * 0.02;
      let Cl = A.Clb * beta + A.Clp * phat + A.Clr * rhat;
      Cl += highAlpha * (Math.sin(t * 5.3) * Math.sin(t * 2.1) * 0.05 + noiseB * 0.015); // kanat sallanması
      let Cn = A.Cnb * (1 - 0.8 * highAlpha) * beta + A.Cnr * rhat + A.Cnp * phat;
      Cn += highAlpha * 0.02 * Math.sign(beta || 1) * smoothstep(8 * DEG, 20 * DEG, Math.abs(beta)); // burun kayması
      const Maero = qS * A.chord * Cm;
      const Laero = qS * A.span * Cl;
      const Naero = qS * A.span * Cn;
      // Atalet eşleşmesi
      const Mine = (A.Izz - A.Ixx) * R.p * R.r;
      const Line = (A.Iyy - A.Izz) * R.q * R.r;
      const Nine = (A.Ixx - A.Iyy) * R.p * R.q;

      // --- Kontrol gücü (dinamik basınçla sınırlı) ---
      const Mmax = qS * A.chord * A.CmCtl * ctlEff;
      const Lmax = qS * A.span * A.ClCtl * ctlEff;
      const Nmax = qS * A.span * A.CnCtl * (1 - 0.4 * highAlpha);
      // FBW: istenen ivme için gereken momenti hesapla, bilinen momentleri telafi et, sınırla
      const MctlCmd = clamp(A.Iyy * Kq * (qCmd - R.q) - Maero - Mine, -Mmax, Mmax);
      const LctlCmd = clamp(A.Ixx * Kp * (pCmd - R.p) - Laero - Line, -Lmax, Lmax);
      const NctlCmd = clamp(A.Izz * Kr * (rCmd - R.r) - Naero - Nine, -Nmax, Nmax);
      // Eyleyici gecikmesi (yüzey sapma hızı sınırı, τ 0.04 s): anlık moment sıçraması yok
      const kAct = 1 - Math.exp(-dt / LAW.actuator);
      const ACT = this.act;
      ACT.M += (MctlCmd - ACT.M) * kAct; ACT.L += (LctlCmd - ACT.L) * kAct; ACT.N += (NctlCmd - ACT.N) * kAct;
      const Mctl = clamp(ACT.M, -Mmax, Mmax), Lctl = clamp(ACT.L, -Lmax, Lmax), Nctl = clamp(ACT.N, -Nmax, Nmax);
      // Görsel yüzey sapmaları (kontrol momentinin doygunluk oranı)
      this.surfaces.elevator += ((Mmax > 1 ? Mctl / Mmax : 0) - this.surfaces.elevator) * (1 - Math.exp(-12 * dt));
      this.surfaces.aileron += ((Lmax > 1 ? Lctl / Lmax : 0) - this.surfaces.aileron) * (1 - Math.exp(-12 * dt));
      this.surfaces.rudder += ((Nmax > 1 ? -Nctl / Nmax : 0) - this.surfaces.rudder) * (1 - Math.exp(-12 * dt));

      R.q += ((Maero + Mine + Mctl) / A.Iyy) * dt;
      R.p += ((Laero + Line + Lctl) / A.Ixx) * dt;
      R.r += ((Naero + Nine + Nctl) / A.Izz) * dt;
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
      slats: this.slatsPos, spoilers: this.spoilerPos, reverse: this.reversePos, flapLabel: this.flapLabel,
      onGround: this.onGround,
      stallWarn: !this.onGround && aAbs > this.lim.alphaWarn && V > 20,
      stall: !this.onGround && aAbs > this.aero.alphaMax && V > 15,
      buffet: this._buffet || 0,
      fuelKg: this.fuel, surface: extra.surface || 'runway', thrustKN: (extra.thrust || 0) / 1000,
      gsKt: this.vel.length() * KT,                 // yer hızı (rüzgarla hava hızından ayrışır)
      windDeg: this.wind.kt > 0 ? Math.round(((this.wind.dirDeg % 360) + 360) % 360) : 0,
      windKt: this.wind.kt,
      // Çapraz rüzgar bileşeni: burna göre sağdan esiyorsa pozitif
      xwindKt: this.wind.kt * Math.sin((((this.wind.dirDeg - heading) % 360) + 360) % 360 * DEG),
      authority,
    };
  }
}
