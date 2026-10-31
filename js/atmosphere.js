// ISA (International Standard Atmosphere) — troposfer ve alt stratosfer.
// Kaynak: ISO 2533 / U.S. Standard Atmosphere 1976 (kamuya açık standart).
// Uçuş modelinin tek atmosfer kaynağıdır; yoğunluk, ses hızı ve basınç buradan gelir.

export const G0 = 9.80665;        // m/s², standart yerçekimi
const R_AIR = 287.05287;          // J/(kg·K), kuru hava gaz sabiti
const GAMMA = 1.4;                // özgül ısı oranı
const T0 = 288.15;                // K, deniz seviyesi
const P0 = 101325;                // Pa
export const RHO0 = 1.225;        // kg/m³
const LAPSE = 0.0065;             // K/m, troposfer sıcaklık gradyanı
const H_TROP = 11000;             // m, tropopoz

// Tek bir nesne yeniden kullanılır: fizik döngüsünde çöp üretilmez.
const _atm = { rho: RHO0, a: 340.294, T: T0, p: P0, sigma: 1, delta: 1, theta: 1 };

/**
 * Verilen geopotansiyel yükseklikte ISA özellikleri.
 * @param {number} h metre
 * @returns {{rho:number,a:number,T:number,p:number,sigma:number,delta:number,theta:number}}
 *   sigma = rho/rho0, delta = p/p0, theta = T/T0 (motor ve performans ölçeklemesi için)
 */
export function atmosphere(h) {
  const hh = h < 0 ? 0 : (h > 47000 ? 47000 : h);
  let T, p;
  if (hh < H_TROP) {
    T = T0 - LAPSE * hh;
    p = P0 * Math.pow(T / T0, G0 / (LAPSE * R_AIR));
  } else if (hh < 20000) {
    T = 216.65;
    p = 22632.06 * Math.exp(-G0 * (hh - H_TROP) / (R_AIR * T));
  } else {
    // 20–47 km: +0.001 K/m (stratosfer ikinci katman)
    const Tb = 216.65, hb = 20000, L = -0.001;
    T = Tb - L * (hh - hb);
    p = 5474.89 * Math.pow(T / Tb, G0 / (L * R_AIR));
  }
  _atm.T = T;
  _atm.p = p;
  _atm.rho = p / (R_AIR * T);
  _atm.a = Math.sqrt(GAMMA * R_AIR * T);
  _atm.sigma = _atm.rho / RHO0;
  _atm.delta = p / P0;
  _atm.theta = T / T0;
  return _atm;
}

/**
 * Eşdeğer hava hızı (EAS) — gösterge hızının (IAS) sıkıştırılamaz yaklaşımı.
 * V_eas = V_tas * sqrt(sigma)
 */
export function equivalentAirspeed(tas, sigma) { return tas * Math.sqrt(sigma); }

const A0 = Math.sqrt(GAMMA * R_AIR * T0);   // 340,294 m/s

/**
 * Kalibre hava hızı (CAS) = konum/alet hatası olmayan gösterge hızı (IAS). Pitot darbe basıncından:
 * ses altında izantropik bağıntı, ses üstünde Rayleigh pitot formülü (pitot önünde normal şok);
 * sonra deniz seviyesi ISA'da aynı darbe basıncını veren hız (CAS < a0 kolu). Standart aerodinamik
 * bağıntılardır (ör. Anderson, Introduction to Flight, böl. 4). Eskiden IAS olarak EAS
 * (V·√σ) gösteriliyordu: yüksekte ve yüksek Mach'ta düşük okur (FL300 M0,80: EAS 288, CAS 304 kt).
 * @param {number} tas m/s
 * @param {{p:number,a:number}} atm atmosphere() çıktısı
 * @returns {number} m/s
 */
export function calibratedAirspeed(tas, atm) {
  const M = Math.abs(tas) / atm.a;
  const qc = M <= 1
    ? atm.p * (Math.pow(1 + 0.2 * M * M, 3.5) - 1)
    : atm.p * (166.92158 * Math.pow(M, 7) / Math.pow(7 * M * M - 1, 2.5) - 1);
  return A0 * Math.sqrt(5 * (Math.pow(qc / P0 + 1, 2 / 7) - 1));
}
