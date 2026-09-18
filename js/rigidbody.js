// Rijit cisim 6-DOF dinamiği.
//
// - Yönelim KUATERNİYONdur. Euler açıları yalnızca HUD/telemetri için TÜRETİLİR,
//   asla fiziğin durumu olarak kullanılmaz (gimbal lock ve eksen çiftlenimi yok).
// - Açısal dinamik TAM Euler denklemleridir, atalet çarpımı I_xz dahil:
//       I_xx·ṗ − I_xz·ṙ = L + (I_yy − I_zz)·q·r + I_xz·p·q
//       I_yy·q̇         = M + (I_zz − I_xx)·r·p + I_xz·(r² − p²)
//       I_zz·ṙ − I_xz·ṗ = N + (I_xx − I_yy)·p·q − I_xz·q·r
//   Bu denklemler atalet (jiroskopik) çiftlenimini DOĞAL olarak üretir. Yüksek
//   yatış oranında yunuslama/sapma çiftlenimi gerçek bir olgudur; modelden
//   çıkarılmaz, FCS tarafından yönetilir.
// - Kuvvetler CG'de toplanır; moment kolu gerektiren katkılar (itki ekseni ofseti,
//   iniş takımı temas kuvvetleri) momenti ayrıca üretir.

import * as THREE from 'three';

export class RigidBody {
  constructor() {
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();       // dünya eksenlerinde m/s
    this.quat = new THREE.Quaternion();
    this.p = 0; this.q = 0; this.r = 0;   // gövde açısal hızları rad/s
    // Yeniden kullanılan geçiciler (fizik döngüsünde tahsis yok)
    this._dq = new THREE.Quaternion();
    this._ax = new THREE.Vector3();
    this._t1 = new THREE.Vector3();
  }

  /**
   * Doğrusal ivmeyi uygular ve konumu ilerletir (yarı-örtük Euler: hız önce).
   * @param {THREE.Vector3} force dünya eksenlerinde toplam kuvvet (N)
   * @param {number} mass kg
   */
  integrateLinear(force, mass, dt) {
    const inv = 1 / Math.max(1, mass);
    this.vel.addScaledVector(force, inv * dt);
    this.pos.addScaledVector(this.vel, dt);
  }

  /**
   * Açısal dinamik: tam Euler denklemleri (I_xz dahil), sonra kuaterniyon entegrasyonu.
   * @param {number} L,M,N gövde eksenlerinde toplam moment (N·m)
   * @param {object} I {Ixx, Iyy, Izz, Ixz}
   */
  integrateAngular(L, M, N, I, dt) {
    const p = this.p, q = this.q, r = this.r;
    const { Ixx, Iyy, Izz } = I;
    const Ixz = I.Ixz || 0;

    // Jiroskopik (atalet çiftlenimi) terimleri
    const Lg = (Iyy - Izz) * q * r + Ixz * p * q;
    const Mg = (Izz - Ixx) * r * p + Ixz * (r * r - p * p);
    const Ng = (Ixx - Iyy) * p * q - Ixz * q * r;

    const Lt = L + Lg, Mt = M + Mg, Nt = N + Ng;

    // Yatış-sapma çifti I_xz üzerinden birbirine bağlıdır; 2x2 sistem çözülür
    const Gam = Ixx * Izz - Ixz * Ixz;
    const pdot = (Izz * Lt + Ixz * Nt) / Gam;
    const rdot = (Ixz * Lt + Ixx * Nt) / Gam;
    const qdot = Mt / Iyy;

    this.p += pdot * dt;
    this.q += qdot * dt;
    this.r += rdot * dt;

    // Sayısal güvenlik ağı: fizik bunlara ASLA ulaşmamalı. Ulaşırsa bir hata vardır;
    // bu yüzden aşım telemetride işaretlenir (sessizce kırpılmaz).
    const LIM = 12;   // rad/s ≈ 690°/s — fiziksel olarak erişilemez bir değer
    this.rateClamped = false;
    if (!(Math.abs(this.p) < LIM && Math.abs(this.q) < LIM && Math.abs(this.r) < LIM)
        || !Number.isFinite(this.p + this.q + this.r)) {
      this.p = Number.isFinite(this.p) ? Math.max(-LIM, Math.min(LIM, this.p)) : 0;
      this.q = Number.isFinite(this.q) ? Math.max(-LIM, Math.min(LIM, this.q)) : 0;
      this.r = Number.isFinite(this.r) ? Math.max(-LIM, Math.min(LIM, this.r)) : 0;
      this.rateClamped = true;
    }

    this.integrateQuaternion(dt);
    return { pdot, qdot, rdot, Lg, Mg, Ng };
  }

  /**
   * Kuaterniyon entegrasyonu: gövde açısal hız vektörü etrafında dönüş.
   *
   * Eksen eşlemesi (DOĞRULANMIŞ — bkz. test/axischk.mjs):
   *   Aerodinamik gövde ekseni:  x_ileri = -Z,  y_sağ = +X,  z_aşağı = -Y
   *   ω = p·x_ileri + q·y_sağ + r·z_aşağı  =  (q, -r, -p)  [three.js x,y,z]
   *
   * DİKKAT: sapma bileşeni -r'dir, +r DEĞİL. +Y etrafında pozitif dönüş burnu SOLA
   * çevirir; oysa aerodinamik kuralda r>0 burun SAĞA demektir. İşaret ters olursa
   * Cnb·sinβ yön KARARLILIĞI yerine yön KARARSIZLIĞI üretir (kayma açısı pozitif
   * geri beslemeyle patlar) — bu, yüksek alfada görülen sapma ıraksamasının
   * asıl kaynağıydı.
   */
  integrateQuaternion(dt) {
    const wx = this.q, wy = -this.r, wz = -this.p;
    const w = Math.hypot(wx, wy, wz);
    if (w > 1e-9) {
      this._dq.setFromAxisAngle(this._ax.set(wx / w, wy / w, wz / w), w * dt);
      this.quat.multiply(this._dq);
      // Sürüklenmeyi önlemek için her adımda normalize
      this.quat.normalize();
    }
  }

  /** Gövde ekseni birim vektörleri (dünya eksenlerinde). */
  axes(fwd, up, right) {
    fwd.set(0, 0, -1).applyQuaternion(this.quat);
    up.set(0, 1, 0).applyQuaternion(this.quat);
    right.set(1, 0, 0).applyQuaternion(this.quat);
  }

  /** Telemetri için Euler açıları (fiziğin durumu DEĞİL). */
  eulerFromAxes(fwd, up, right) {
    const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)));
    const roll = Math.atan2(-right.y, up.y);
    const heading = Math.atan2(fwd.x, -fwd.z);
    return { pitch, roll, heading };
  }
}
