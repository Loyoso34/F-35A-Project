// Motor modeli.
// İtki yoğunluğa (irtifa), Mach'a (ram geri kazanımı) ve motor durumuna bağlıdır.
// Gaz koluyla itki ARASINDA spool dinamiği vardır: itki asla anında değişmez.

import { RHO0 } from './atmosphere.js';
import { clamp } from './noise.js';

export class Engine {
  constructor(D) {
    this.D = D;
    this.n = 0;          // motor durumu 0..1 (N2 benzeri); gaz koluna gecikmeyle uyar
    this.ab = 0;         // art yakıcı seviyesi 0..1
    this.thrust = 0;     // N, son hesaplanan net itki
    this.fuelFlow = 0;   // kg/s
  }

  reset() { this.n = 0; this.ab = 0; this.thrust = 0; this.fuelFlow = 0; }

  /**
   * Motoru bir adım ilerletir ve net itkiyi döndürür.
   * @param {number} dt saniye
   * @param {number} throttle 0..1
   * @param {boolean} abRequest art yakıcı isteği
   * @param {object} atm atmosphere() çıktısı
   * @param {number} mach
   * @param {number} reverse 0..1 (ters itki oranı; yalnızca yolcu uçağında)
   */
  update(dt, throttle, abRequest, atm, mach, reverse = 0, reverseFrac = 0) {
    const D = this.D;
    // Spool: yukarı çıkarken daha yavaş, düşük N'de ek gecikme (gerçek turbofan davranışı)
    const tau = throttle > this.n
      ? D.spoolUp * (1 - D.spoolIdleLag + D.spoolIdleLag * (1 - this.n))
      : D.spoolDown;
    this.n += (throttle - this.n) * (1 - Math.exp(-dt / tau));
    // Art yakıcı yalnızca motor askeri güce yakınken tutuşur
    const abTarget = (abRequest && this.n > 0.92) ? 1 : 0;
    this.ab += (abTarget - this.ab) * (1 - Math.exp(-dt / D.abSpool));

    // Yoğunluk ve Mach etkisi
    const sigma = atm.rho / RHO0;
    let ram = 1 + D.ramA * mach + (D.ramB || 0) * mach * mach;
    if (D.thrustFloor !== undefined) ram = Math.max(D.thrustFloor, ram);
    const lapse = Math.pow(Math.max(0.02, sigma), D.thrustRhoExp) * Math.max(0.05, ram);

    const Tmil = D.thrustMil * lapse;
    let T = Tmil * (D.idleFrac + (1 - D.idleFrac) * this.n);
    if (D.thrustAB > D.thrustMil) T += (D.thrustAB - D.thrustMil) * lapse * this.ab;
    if (reverse > 0.001 && reverseFrac > 0) T -= Tmil * reverseFrac * reverse * (0.55 + 0.45 * this.n) * 2;

    this.thrust = T;
    this.fuelFlow = D.sfcMil * (0.08 + 0.92 * this.n) + D.sfcAB * this.ab;
    this.lapse = lapse;
    return T;
  }
}
