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
    this.abLin = 0;      // art yakıcı kademe ilerlemesi (doğrusal); ab bunun S eğrisidir
    this.abTimer = 0;    // tutuşma gecikmesi sayacı
    this.nozzle = 0.55;  // nozul açıklığı 0 (askeri güçte kısılı) .. 1 (tam AB)
  }

  reset() { this.n = 0; this.ab = 0; this.abLin = 0; this.abTimer = 0; this.thrust = 0; this.fuelFlow = 0; this.nozzle = 0.55; }

  /**
   * Motoru bir adım ilerletir ve net itkiyi döndürür.
   * @param {number} dt saniye
   * @param {number} throttle 0..1
   * @param {boolean} abRequest art yakıcı isteği
   * @param {object} atm atmosphere() çıktısı
   * @param {number} mach
   */
  update(dt, throttle, abRequest, atm, mach) {
    const D = this.D;
    // Spool: yukarı çıkarken daha yavaş, düşük N'de ek gecikme (gerçek turbofan davranışı)
    const tau = throttle > this.n
      ? D.spoolUp * (1 - D.spoolIdleLag + D.spoolIdleLag * (1 - this.n))
      : D.spoolDown;
    this.n += (throttle - this.n) * (1 - Math.exp(-dt / tau));
    // ART YAKICI. Yalnızca motor askeri güce yakınken tutuşur. İstek geldikten sonra
    // kısa bir tutuşma gecikmesi (ateşleme + manifold dolumu), ardından bölgeler sırayla
    // yanar: itki doğrusal bir kademe ilerlemesinin S eğrisiyle artar. Böylece hem itki
    // hem alev "ışık anahtarı" gibi birden açılmaz; kesmede ise hızla söner.
    const want = abRequest && this.n > 0.92;
    this.abTimer = want ? this.abTimer + dt : 0;
    if (want && this.abTimer >= (D.abLightOff || 0)) this.abLin = Math.min(1, this.abLin + dt / (D.abRamp || D.abSpool * 2.2));
    else if (!want) this.abLin = Math.max(0, this.abLin - dt / (D.abCut || D.abSpool * 0.8));
    const x = this.abLin;
    this.ab = x * x * (3 - 2 * x);
    // Nozul: rölantide açık (düşük basınç oranı), askeri güçte kısılı, AB'de tam açık
    const nozT = Math.max(0, 0.55 * (1 - this.n / 0.6)) + this.ab;
    this.nozzle += (Math.min(1, nozT) - this.nozzle) * (1 - Math.exp(-dt / 0.45));

    // Yoğunluk ve Mach etkisi
    const sigma = atm.rho / RHO0;
    let ram = 1 + D.ramA * mach + (D.ramB || 0) * mach * mach;
    // Sabit geometrili (DSI) hava alığında ses üstü basınç geri kazanımı kaybı:
    // ram kazancı ~M 1.3'ten sonra alığın şok kayıplarıyla giderek yenilir.
    if (D.inletLoss && mach > D.inletM0) { const x = mach - D.inletM0; ram *= Math.max(0.5, 1 - D.inletLoss * x * x); }
    if (D.thrustFloor !== undefined) ram = Math.max(D.thrustFloor, ram);
    // Yoğunluk sıfıra giderken itki de SIFIRA gitmelidir. Eskiden sigma için 0,02
    // tabanı vardı; ~100 000 ft üzerinde sürükleme sıfıra yaklaşırken itki sabit
    // kaldığı için uçak sınırsız hızlanabiliyordu (ölçümde M > 100). pow(0, 0.78)
    // tanımlı ve sıfırdır, dolayısıyla sayısal bir tehlike yok.
    const lapse = Math.pow(Math.max(0, sigma), D.thrustRhoExp) * Math.max(0.05, ram);

    const Tmil = D.thrustMil * lapse;
    // Rölanti payı ram sürüklemesiyle Mach'a bağlı düşer (yüksek hızda rölanti net
    // itkisi ~0 / hafif negatif). Güç arttıkça bu ek terim söner: askeri güçte ram
    // etkisi zaten itki kaybı eğrisinin (ram) içindedir, ikinci kez düşülmez.
    const idleNet = D.idleFrac * Math.max(-0.6, 1 - (D.idleRamDrag || 0) * mach * (1 - this.n));
    let T = Tmil * (idleNet + (1 - D.idleFrac) * this.n);
    if (D.thrustAB > D.thrustMil) T += (D.thrustAB - D.thrustMil) * lapse * this.ab;

    this.thrust = T;
    this.fuelFlow = D.sfcMil * (0.08 + 0.92 * this.n) + D.sfcAB * this.ab;
    this.lapse = lapse;
    return T;
  }
}
