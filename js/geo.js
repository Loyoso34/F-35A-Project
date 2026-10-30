// Jeodezi: WGS84, yerel Transvers Merkatör çerçevesi, Web Merkatör karo matematiği ve
// yükseklik datumları. Gerçek dünya bölgesinin (js/georegion.js) TEK koordinat kaynağı.
//
// Çerçeveler
//  - Coğrafi: WGS84 enlem/boylam (derece).
//  - Fizik/çizim (yerel): Transvers Merkatör (TM), merkez meridyen ve başlangıç = bölge kökü,
//    ölçek k0 = 1. x = doğu (m), z = −kuzey (m; +z güney, mevcut dünya kuralıyla aynı),
//    y = MSL yüksekliği + MSL_Y. TM konformdur ve bölge içinde (±150 km) ölçek hatası
//    < 3·10⁻⁴'tür; böylece fizikteki mesafe, hız ve irtifa gerçek dünyayla birebirdir.
//  - Karo: Web Merkatör XYZ (EPSG:3857), DEM ve uydu görüntüsü karoları bu ızgaradadır.
//
// Krüger serisi (n⁴ mertebesi; bölge ölçeğinde hata mm altıdır). Kaynak: L. Krüger (1912);
// C. F. F. Karney, "Transverse Mercator with an accuracy of a few nanometers", J. Geodesy 85
// (2011). tools/flighttest/geo.mjs PROJ (tmerc) referans noktalarıyla doğrular.
//
// Yükseklikler (HİÇBİR YERDE KARIŞTIRILMAZ)
//  - hMsl: ortalama deniz seviyesine göre (ortometrik, EGM96 geoidi). DEM, havaalanı kotları,
//    HUD ALT ve fizik y bu datumdadır: y = hMsl + MSL_Y.
//  - hEll: WGS84 elipsoidine göre (jeodezik/GNSS yüksekliği) = hMsl + N(enlem, boylam), N =
//    EGM96 geoid ondülasyonu (bölge ızgarasından, Bodrum'da ~26–37 m).
//  - hAgl: zemin üstü = y − zemin y (radar altimetre; ana teker tabanından).

export const WGS84 = { a: 6378137.0, f: 1 / 298.257223563 };
/** Fizik/çizim y ekseninde ortalama deniz seviyesi (world.js WATER_LEVEL ile aynı). */
export const MSL_Y = -4;
const DEG = Math.PI / 180;

// ---- Krüger katsayıları ----------------------------------------------------
const n = WGS84.f / (2 - WGS84.f);
const n2 = n * n, n3 = n2 * n, n4 = n3 * n;
const A = WGS84.a / (1 + n) * (1 + n2 / 4 + n4 / 64);
const ALPHA = [
  n / 2 - 2 * n2 / 3 + 5 * n3 / 16 + 41 * n4 / 180,
  13 * n2 / 48 - 3 * n3 / 5 + 557 * n4 / 1440,
  61 * n3 / 240 - 103 * n4 / 140,
  49561 * n4 / 161280,
];
const BETA = [
  n / 2 - 2 * n2 / 3 + 37 * n3 / 96 - n4 / 360,
  n2 / 48 + n3 / 15 - 437 * n4 / 1440,
  17 * n3 / 480 - 37 * n4 / 840,
  4397 * n4 / 161280,
];
const DELTA = [
  2 * n - 2 * n2 / 3 - 2 * n3 + 116 * n4 / 45,
  7 * n2 / 3 - 8 * n3 / 5 - 227 * n4 / 45,
  56 * n3 / 15 - 136 * n4 / 35,
  4279 * n4 / 630,
];
const E2N = 2 * Math.sqrt(n) / (1 + n);

// Konform enlem parametresi t = tan(χ)
function confT(phi) {
  const s = Math.sin(phi);
  return Math.sinh(Math.atanh(s) - E2N * Math.atanh(E2N * s));
}

/**
 * Yerel TM çerçevesi. Ayrılan nesne yok: çıktı nesnesi verilirse yerinde doldurulur
 * (fizik ve arazi akışı saniyede binlerce kez çağırır).
 */
export class LocalFrame {
  constructor(lat0, lon0) {
    this.lat0 = lat0; this.lon0 = lon0;
    this.N0 = 0;
    this.N0 = this._fwd(lat0 * DEG, 0, { e: 0, n: 0 }).n;
  }

  _fwd(phi, lam, o) {
    const t = confT(phi);
    const cl = Math.cos(lam);
    const xi = Math.atan2(t, cl);
    const eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let e = eta, nn = xi;
    for (let j = 1; j <= 4; j++) {
      const a = ALPHA[j - 1];
      e += a * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
      nn += a * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
    }
    o.e = A * e; o.n = A * nn - this.N0;
    return o;
  }

  /** Enlem/boylam (derece) -> yerel {x, z} (metre; z = −kuzey). */
  toLocal(lat, lon, out) {
    const o = out || { x: 0, z: 0 };
    const r = this._fwd(lat * DEG, (lon - this.lon0) * DEG, _en);
    o.x = r.e; o.z = -r.n;
    return o;
  }

  /** Yerel {x, z} -> {lat, lon} (derece). */
  toGeo(x, z, out) {
    const o = out || { lat: 0, lon: 0 };
    const xi = (-z + this.N0) / A, eta = x / A;
    let xp = xi, ep = eta;
    for (let j = 1; j <= 4; j++) {
      const b = BETA[j - 1];
      xp -= b * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
      ep -= b * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
    let phi = chi;
    for (let j = 1; j <= 4; j++) phi += DELTA[j - 1] * Math.sin(2 * j * chi);
    o.lat = phi / DEG;
    o.lon = this.lon0 + Math.atan2(Math.sinh(ep), Math.cos(xp)) / DEG;
    return o;
  }

  /**
   * Meridyen yakınsaması γ (derece): gerçek kuzeyden ızgara kuzeyine, saat yönünde pozitif.
   * Gerçek yön = ızgara yönü + γ. Merkez meridyenin doğusunda (kuzey yarımküre) γ > 0.
   */
  convergence(lat, lon) {
    const phi = lat * DEG, lam = (lon - this.lon0) * DEG;
    const t = confT(phi), cl = Math.cos(lam);
    const xi = Math.atan2(t, cl), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let s = 1, tau = 0;
    for (let j = 1; j <= 4; j++) {
      const a = ALPHA[j - 1];
      s += 2 * j * a * Math.cos(2 * j * xi) * Math.cosh(2 * j * eta);
      tau += 2 * j * a * Math.sin(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const st = Math.sqrt(1 + t * t), tl = Math.tan(lam);
    return Math.atan2(tau * st + s * t * tl, s * st - tau * t * tl) / DEG;
  }

  /** Nokta ölçek faktörü k (1 = gerçek mesafe). */
  scale(lat, lon) {
    const phi = lat * DEG, lam = (lon - this.lon0) * DEG;
    const t = confT(phi), cl = Math.cos(lam);
    const xi = Math.atan2(t, cl), eta = Math.atanh(Math.sin(lam) / Math.sqrt(1 + t * t));
    let s = 1, tau = 0;
    for (let j = 1; j <= 4; j++) {
      const a = ALPHA[j - 1];
      s += 2 * j * a * Math.cos(2 * j * xi) * Math.cosh(2 * j * eta);
      tau += 2 * j * a * Math.sin(2 * j * xi) * Math.sinh(2 * j * eta);
    }
    const q = (1 - n) / (1 + n) * Math.tan(phi);
    return A / WGS84.a * Math.sqrt((1 + q * q) * (s * s + tau * tau) / (t * t + cl * cl));
  }
}
const _en = { e: 0, n: 0 };

// ---- Web Merkatör (XYZ) karo matematiği --------------------------------------
// Karo koordinatı kesirlidir: tam kısım karo indisi, kesir karo içindeki konum.
export function lonToTileX(lon, z) { return (lon + 180) / 360 * (1 << z); }
export function latToTileY(lat, z) {
  const s = Math.sin(lat * DEG);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * (1 << z);
}
export function tileXToLon(x, z) { return x / (1 << z) * 360 - 180; }
export function tileYToLat(y, z) { return Math.atan(Math.sinh(Math.PI * (1 - 2 * y / (1 << z)))) / DEG; }

// ---- Yükseklik datumları -------------------------------------------------------
export const yFromMsl = (hMsl) => hMsl + MSL_Y;
export const mslFromY = (y) => y - MSL_Y;

/**
 * EGM96 geoid ondülasyonu ızgarası (bölge manifestinden). {lat0, lon0, dlat, dlon, nlat, nlon, v[]}
 * v satır sırası: enlem lat0'dan artan, boylam lon0'dan artan.
 */
export class GeoidGrid {
  constructor(g) { this.g = g; }
  /** N (m): elipsoit yüksekliği = MSL yüksekliği + N. Izgara dışında en yakın kenar değeri. */
  undulation(lat, lon) {
    const g = this.g;
    if (!g) return 0;
    let fi = (lat - g.lat0) / g.dlat, fj = (lon - g.lon0) / g.dlon;
    fi = Math.min(Math.max(fi, 0), g.nlat - 1.000001); fj = Math.min(Math.max(fj, 0), g.nlon - 1.000001);
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, w = fj - j;
    const v = g.v, k = i * g.nlon + j;
    return (v[k] * (1 - w) + v[k + 1] * w) * (1 - u) + (v[k + g.nlon] * (1 - w) + v[k + g.nlon + 1] * w) * u;
  }
  ellipsoidal(hMsl, lat, lon) { return hMsl + this.undulation(lat, lon); }
}

/** Derece -> "37°14'57.5"N" biçimi (HUD/panel için). */
export function fmtDMS(deg, pos, neg) {
  const h = deg >= 0 ? pos : neg;
  let a = Math.abs(deg);
  const d = Math.floor(a); a = (a - d) * 60;
  const m = Math.floor(a); const s = (a - m) * 60;
  return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${h}`;
}
