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
// Tekerlerin "durdu" sayıldığı hız: bunun altında kopma sürtünmesi devreye girer (m/s).
const GND_CREEP = 0.25;
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
    this.flapIndex = 0; this.flapsCmd = 0; this.flapsPos = 0;
    // Uçak piste "yuvarlanmaya hazır" durumda doğar: park freni BASILI DEĞİLDİR.
    // Kendiliğinden ileri kaymayı fren değil, aşağıdaki kopma (statik) sürtünmesi engeller.
    this.brakes = false;
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
    this._fcsIn = {};
    this._tx = { V: 0, mach: 0, qbar: 0, thrust: 0, surface: 'runway', agl: 0, pitch: 0, roll: 0, groundY: 0 };
    this.debug = {};
    this.telemetry = {};

    this.wind = { dirDeg: 110, kt: 9, gustKt: 4, shear: 0.22 };
    this.groundY = 0;
    this._nz = 1;
    this.reset();
  }

  get mass() { return this.D.massEmpty + this.fuel; }
  get engine() { return this.engine_.n; }
  set engine(v) { this.engine_.n = v; }
  get abLevel() { return this.engine_.ab; }
  set abLevel(v) { this.engine_.ab = v; this.engine_.abLin = v; }

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
    this.flapIndex = 0; this.flapsCmd = 0; this.flapsPos = 0;
    this.lefPos = 0; this.camber = 0; this.toeIn = 0;
    this.gearComp = 0.07; this._gcv = 0;
    this.brakes = false; this.fuel = this.D.fuel;
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

    // Uçuş yolu açısı (yere göre): FCS'nin bırakılan çubukta yolu tutması için
    const Vg = vel.length();
    const gamma = Vg > 1 ? Math.asin(clamp(vel.y / Vg, -1, 1)) : 0;

    // ---------------- Otomatik hücum kenarı flapı (F-35 LEF) ----------------
    // FCS hücum kenarı flaplarını yalnızca AoA ile indirir (ses üstünde toplanır);
    // seyirde, yerde ve taksi sırasında tamamen kapalıdır. Eyleyici hız sınırlı.
    // FİRAR KENARI: flaperonun simetrik konumu yalnızca pilotun flap kolundan gelir.
    // (v2.9.0'da takım aşağı ve yavaşken otomatik %70 sarkma vardı; kol UP iken bile
    // flaperonlar pistte ~21° aşağıda duruyordu.) Yüksek AoA'daki küçük FCS manevra
    // kamburluğu (camber, en fazla 0,22) uçuş karakteristiğini korumak için
    // aerodinamikte kalır; yalnızca havada ve AoA 8°'nin üstünde etkindir.
    const AF = SYS.autoFlaps;
    if (AF) {
      const supFade = 1 - smoothstep(0.85, 1.05, mach);
      const lefT = this.onGround ? 0 : smoothstep(AF.lefA0, AF.lefA1, aAbs) * supFade;
      const rate = AF.rate * dt;
      this.lefPos += clamp(lefT - this.lefPos, -rate, rate);
      const camT = this.onGround ? 0 : AF.tefManeuver * smoothstep(AF.tefA0, AF.tefA1, aAbs) * supFade;
      this.camber += clamp(camT - this.camber, -rate, rate);
      // Dümen toe-in: kalkış koşusunda ve rotasyonda dümenler içe döner (burun yukarı
      // moment yardımı); yüksek AoA'da da kısmen. Görseldir, kuvveti rotasyon
      // yetkisinin içinde zaten vardır.
      const toeT = this.onGround
        ? smoothstep(AF.toeV0, AF.toeV1, V) * (0.35 + 0.65 * Math.max(0, this.stick.pitch))
        : 0.6 * smoothstep(AF.toeA0, AF.toeA1, aAbs);
      this.toeIn += clamp(toeT - this.toeIn, -rate, rate);
    }
    // Aerodinamiğin gördüğü flap: pilotun flap kolu (görsel flaperon açısı) ile
    // manevra kamburluğunun büyüğü. Seyirde, yerde ve kalkışta camber = 0.
    const flapsEff = Math.max(this.flapsPos, this.camber);

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
    st.flaps = flapsEff; st.gear = this.gearPos;
    st.lef = this.lefPos;
    st.dLeft = -dLocal; st.dRight = dLocal;

    // ---------------- FCS ----------------
    // Önce yüzeysiz aerodinamik momentler: FCS bunları ve jiroskopik terimleri telafi eder.
    const c0 = coefficients(st, D, this._uZero);
    const qS = qbar * D.S;
    const Ixz = D.Ixz || 0;
    const Lgyro = (D.Iyy - D.Izz) * q * r + Ixz * p * q;
    const Mgyro = (D.Izz - D.Ixx) * r * p + Ixz * (r * r - p * p);
    const Ngyro = (D.Ixx - D.Iyy) * p * q - Ixz * q * r;

    const CLmaxCfg = clMaxConfig(D, flapsEff);
    const alphaTrim = alphaForCL(D, m * G / Math.max(qS, 1), flapsEff);

    let sur = this.fcs.sur;
    if (!this.onGround) {
      const fi = this._fcsIn;   // yeniden kullanılan giriş nesnesi
      fi.alpha = alpha; fi.beta = beta; fi.V = V; fi.qbar = qbar; fi.mach = mach; fi.p = p; fi.q = q; fi.r = r;
      fi.nz = this._nz; fi.phi = roll; fi.theta = pitch; fi.gamma = gamma;
      fi.CLmaxCfg = CLmaxCfg; fi.mass = m; fi.alphaTrim = alphaTrim;
      fi.Maero = qS * D.chord * c0.Cm; fi.Laero = qS * D.span * c0.Cl; fi.Naero = qS * D.span * c0.Cn;
      fi.Mgyro = Mgyro; fi.Lgyro = Lgyro; fi.Ngyro = Ngyro;
      fi.sepFrac = c0.sepFrac; fi.tailEff = c0.tailEff; fi.tailEff1 = 1;
      sur = this.fcs.update(dt, this.stick, fi);
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
    const thrust = this.engine_.update(dt, this.throttle, this.afterburner, atm, mach);
    F.addScaledVector(fwd, thrust);
    this.fuel = Math.max(0, this.fuel - this.engine_.fuelFlow * dt);

    // ---------------- Yer teması ----------------
    const groundY = groundYq;
    this.groundY = groundY;
    const surface = surfaceTypeAt(pos.x, pos.z);
    const clearance = this.requiredClearance(pitch, roll);
    const agl = pos.y - groundY;
    let onGround = false;
    let Nload = 0, touchSink = 0;
    if (agl <= clearance + 0.01) {
      onGround = true;
      const paved = surface === 'runway' || surface === 'taxiway' || surface === 'apron';
      const vy = vel.y;
      if (!this.wasOnGround) {
        if (surface === 'water') return this.crash('Crashed into the water');
        if (this.gearPos < 0.98) return this.crash('Landed with the gear up');
        if (vy < LIM.hardLandVs) return this.crash('Hard landing (' + Math.abs(vy * 196.85).toFixed(0) + ' ft/min)');
        if (Math.abs(roll) > LIM.landRoll) return this.crash('Wingtip strike on landing — too much bank');
        if (pitch < LIM.landPitch[0] || pitch > LIM.landPitch[1]) return this.crash(pitch > 0 ? 'Tail strike' : 'Nose gear collapsed — landed nose-first');
        if (!paved && V > LIM.offRunwayV[0]) return this.crash('Landed off the runway at high speed');
      } else {
        if (surface === 'water') return this.crash('Rolled into the water');
        if (this.gearPos < 0.98) return this.crash('Belly landing — gear not fully down');
        if (Math.abs(roll) > LIM.groundRoll) return this.crash('Wingtip struck the ground');
        if (!paved && V > LIM.offRunwayV[1]) return this.crash('Lost control off the runway');
        if (agl < clearance - 1.5) return this.crash('Crashed into the ground');
      }
      if (vel.y < 0) vel.y = 0;
      pos.y = groundY + clearance;
      const N = Math.max(0, m * G - L * Math.cos(pitch));
      Nload = N;
      if (!this.wasOnGround) touchSink = Math.max(0, -vy);
      const rollMu = paved ? GND.rollMu[0] : GND.rollMu[1];
      const brakeMu = this.brakes ? (paved ? GND.brakeMu[0] : GND.brakeMu[1]) : 0;
      const lateralKill = 1 - Math.exp(-dt * 12);
      vel.addScaledVector(right, -vel.dot(right) * lateralKill);
      const vfwd = vel.dot(fwd);
      // KOPMA (STATİK) SÜRTÜNMESİ.
      // Duran bir uçağın yuvarlanmaya BAŞLAMASI, yuvarlanmayı sürdürmekten daha çok
      // kuvvet ister: lastik deformasyonu, rulman direnci ve fren balatası teması
      // birlikte bir eşik oluşturur. Kamuya açık ölçümlerde beton üzerinde kopma
      // direnci ~0,04-0,08, yuvarlanma direnci ise ~0,02'dir. [E]
      //
      // Bu eşik yokken model yalnızca kinetik yuvarlanmayı biliyordu ve rölanti itkisi
      // onu aşıyordu: F-35'te rölanti 6,8 kN, yuvarlanma direnci 4,2 kN — uçak gaz
      // sıfırken ve fren bırakılmışken ~0,12 m/s² ile kendiliğinden ileri kayıyordu.
      const stictionMu = (paved ? GND.stictionMu[0] : GND.stictionMu[1]) + brakeMu;
      const Ffwd = F.dot(fwd);                       // net boyuna kuvvet (itki - direnç ± eğim)
      if (Math.abs(vfwd) < GND_CREEP && Math.abs(Ffwd) <= stictionMu * N) {
        // Eşiğin altında: tekerler dönmeye başlamaz, uçak yerinde durur.
        vel.addScaledVector(fwd, -vfwd);
        F.addScaledVector(fwd, -Ffwd);
      } else {
        const decel = (rollMu + brakeMu) * N / m;
        vel.addScaledVector(fwd, -Math.sign(vfwd) * Math.min(Math.abs(vfwd), decel * dt));
      }
      F.y = Math.max(F.y, 0);
    }
    this.onGround = onGround;

    // ---------------- Amortisör (YALNIZCA görsel) ----------------
    // Yer teması kinematiktir (sekme ya da piste gömülme olmaz); burada yalnızca
    // amortisörün görünür sıkışması hesaplanır: ağırlık tekerdeyken statik sıkışma
    // (taşıma arttıkça azalır) + teker koyarken alçalma hızıyla tetiklenen sönümlü yay.
    {
      const target = onGround && this.gearPos > 0.98 ? 0.07 * clamp(Nload / (m * G), 0, 1.6) : 0;
      if (touchSink > 0) this._gcv += touchSink * 0.55;
      const acc = 400 * (target - this.gearComp) - 22 * this._gcv;
      this._gcv += acc * dt;
      this.gearComp = clamp(this.gearComp + this._gcv * dt, 0, 0.22);
      if (this.gearComp <= 0 && this._gcv < 0) this._gcv = 0;
    }

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
    if (!onGround && agl < clearance - 0.5) return this.crash('Crashed into the ground');
    if (surface === 'water' && pos.y - 1.0 < WATER_LEVEL) return this.crash('Crashed into the water');
    if (this.world.hitsBuilding(pos.x, pos.y, pos.z, 4)) return this.crash('Crashed into a building');
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

    // Hata ayıklama ve telemetri nesneleri YERİNDE güncellenir (120 Hz'de tahsis yok)
    const d = this.debug;
    d.CL = c.CL; d.CD = c.CD; d.CY = c.CY; d.Cl = c.Cl; d.Cm = c.Cm; d.Cn = c.Cn;
    d.Lift = L; d.Drag = Dr; d.Side = Yf; d.Lm = Ltot; d.Mm = Mtot; d.Nm = Ntot;
    d.Lgyro = Lgyro; d.Mgyro = Mgyro; d.Ngyro = Ngyro; d.qbar = qbar; d.thrust = thrust; d.mass = m;
    d.de = sur.de; d.da = sur.da; d.dr = sur.dr;
    d.sepFrac = c.sepFrac; d.tailEff = c.tailEff; d.CLmaxCfg = CLmaxCfg; d.alphaTrim = alphaTrim;
    d.fcs = this.fcs.dbg; d.rateClamped = rb.rateClamped;
    const tx = this._tx;
    tx.V = V; tx.mach = mach; tx.qbar = qbar; tx.thrust = thrust; tx.surface = surface;
    tx.agl = agl; tx.pitch = pitch; tx.roll = roll; tx.groundY = groundY;
    this.updateTelemetry(atm, alpha, beta, nz, this.fcs.dbg.auth || 0, tx);
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
    // Aynı nesne yerinde güncellenir: tüketiciler (HUD, ses, testler) her zaman
    // güncel değeri okur, fizik döngüsü çöp üretmez.
    const t = this.telemetry;
    t.tas = V; t.kias = V * Math.sqrt(atm.rho / RHO0) * KT; t.ktas = V * KT;
    t.mach = extra.mach !== undefined ? extra.mach : V / atm.a;
    t.altFt = this.pos.y * FT; t.aglFt = (this.pos.y - groundY) * FT;
    t.vsFpm = this.vel.y * FT * 60;
    t.heading = heading;
    t.pitch = (extra.pitch !== undefined ? extra.pitch : Math.asin(clamp(fwd.y, -1, 1))) / DEG;
    t.roll = (extra.roll !== undefined ? extra.roll : Math.atan2(-right.y, up.y)) / DEG;
    t.alpha = alpha / DEG; t.beta = beta / DEG; t.g = nz;
    t.p = this.rates.p / DEG; t.q = this.rates.q / DEG; t.r = this.rates.r / DEG;
    t.qbar = extra.qbar || 0;
    t.throttle = this.throttle; t.engine = this.engine_.n; t.ab = this.engine_.ab;
    t.gear = this.gearPos; t.gearCmd = this.gearCmd; t.flaps = this.flapsPos; t.flapsCmd = this.flapsCmd; t.brakes = this.brakes;
    t.flapLabel = this.flapLabel;
    t.lef = this.lefPos;
    t.onGround = this.onGround;
    t.stallWarn = !this.onGround && aAbs > this.lim.alphaWarn && V > 20;
    t.stall = !this.onGround && aAbs > D.stallA1 && V > 15;
    t.buffet = this._buffet || 0;
    t.fuelKg = this.fuel; t.surface = extra.surface || 'runway'; t.thrustKN = (extra.thrust || 0) / 1000;
    t.gsKt = this.vel.length() * KT;
    t.windDeg = this.wind.kt > 0 ? Math.round(((this.wind.dirDeg % 360) + 360) % 360) : 0;
    t.windKt = this.wind.kt;
    t.xwindKt = this.wind.kt * Math.sin((((this.wind.dirDeg - heading) % 360) + 360) % 360 * DEG);
    t.authority = authority;
  }
}
