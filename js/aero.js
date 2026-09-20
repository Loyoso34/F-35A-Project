// Aerodinamik katsayı modeli.
//
// Tasarım ilkeleri:
//  1. TÜM katsayılar alpha ve beta'nın SÜREKLİ fonksiyonlarıdır. Hiçbir yerde
//     "if (alpha > stallAngle) { farklı model }" yoktur. Stall, eğrinin kendi
//     şeklinden doğar.
//  2. Alpha ±180°'de tanımlıdır. Post-stall bölgesinde hesap durmaz.
//  3. İki taşıma formülasyonu vardır ve veri setinden seçilir:
//       'vortex'  — Polhamus hücum kenarı emme analojisi (çineli/delta savaş uçağı)
//       'classic' — doğrusal + yumuşak tepe + düz plaka (konvansiyonel kanat)
//  4. Normalize açısal oranlar (p̂, q̂, r̂) düşük hızda patlamaz: payda
//     güvenli bir referans hızla sınırlanır ve sönüm momentleri qbar ile
//     ölçeklendiği için hız düşerken küçülür, büyümez.
//
// Referans: E. C. Polhamus, NASA TN D-3767 (1966) — kamuya açık yöntem.

import { clamp, smoothstep } from './noise.js';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Taşıma katsayısı
// ---------------------------------------------------------------------------

/**
 * Polhamus hücum kenarı emme analojisi.
 * CL = Kp·sinα·cos²α + Kv·sin²α·cosα
 * İlk terim potansiyel akış (bağlı), ikincisi hücum kenarı girdap taşıması.
 * Her ikisi de alpha'nın düzgün (C∞) fonksiyonudur; hiçbir eşik yoktur.
 */
function clVortex(alpha, D) {
  const sa = Math.sin(alpha), ca = Math.cos(alpha);
  const pot = D.Kp * sa * ca * ca;
  const vor = D.Kv * sa * Math.abs(sa) * ca;      // |sa| ile işaret alpha ile taşınır
  // Girdap patlaması: çok yüksek alpha'da girdap taşıması kaybolur
  const burst = 1 - D.vortexBurst * smoothstep(D.burstA0, D.burstA1, Math.abs(alpha));
  return pot + vor * burst;
}

/**
 * Konvansiyonel kanat: doğrusal bölge, yumuşak tepe, stall sonrası düz plakaya geçiş.
 * Geçişler smoothstep ile harmanlanır, kırılma noktası yoktur.
 */
function clClassic(alpha, D) {
  const s = Math.sign(alpha) || 1;
  const a = Math.abs(alpha);
  const lin = D.CLa * a;
  // Tepe civarı yuvarlanma
  const t = smoothstep(D.alphaLin, D.alphaMax, a);
  const peak = lin + (D.CLmax - D.CLa * D.alphaLin) * t * (2 - t) - (lin - D.CLa * D.alphaLin) * t;
  // Düz plaka (ayrılmış akış)
  const plate = D.CLplate * Math.sin(2 * a);
  const sep = smoothstep(D.alphaMax, D.alphaDrop, a);
  return s * (peak * (1 - sep) + plate * sep);
}

// ---------------------------------------------------------------------------
// Ana değerlendirme
// ---------------------------------------------------------------------------

// Sonuç nesnesi yeniden kullanılır (fizik döngüsünde tahsis yok)
const C = {
  CL: 0, CD: 0, CY: 0, Cl: 0, Cm: 0, Cn: 0,
  CLa_eff: 0, CLmaxCfg: 0, stallFrac: 0, sepFrac: 0,
};

/**
 * Tüm aerodinamik katsayıları hesaplar.
 *
 * @param {object} s  uçuş durumu:
 *   alpha, beta (rad), phat, qhat, rhat (normalize açısal oranlar),
 *   mach, sigmaGE (yer etkisi: 1 = etki yok), flaps, slats, gear, spoilers (0..1),
 *   dLeft, dRight (sol/sağ kanat yerel alpha farkı, rad) — asimetrik stall için
 * @param {object} D  uçağa ait aerodinamik veri seti (aerodata.js)
 * @param {object} u  kontrol yüzeyi konumları: de, da, dr (-1..1, normalize)
 */
export function coefficients(s, D, u) {
  const alpha = s.alpha, beta = s.beta;
  const aAbs = Math.abs(alpha);
  const M = s.mach;

  // --- Taşıma ---
  // Sol ve sağ kanat ayrı yerel hücum açısı görür (yatış oranı ve kayma nedeniyle).
  // İkisinin ortalaması toplam taşımayı, farkı ise doğal yatış momentini verir.
  // Bu, asimetrik stall'ı YAPAY bir tork olmadan üretir.
  const base = D.lift === 'vortex' ? clVortex : clClassic;
  const clL = base(alpha + s.dLeft, D);
  const clR = base(alpha + s.dRight, D);
  let CL = 0.5 * (clL + clR);

  // Konfigürasyon katkıları (stall ile sönerek kaybolur)
  const sepFrac = smoothstep(D.sepA0, D.sepA1, aAbs);        // ayrılmış akış oranı 0..1
  const cfgFade = 1 - 0.85 * sepFrac;
  CL += (D.CLflaps * s.flaps + D.CLslats * s.slats) * cfgFade;
  if (D.CLspoiler) CL *= 1 - D.CLspoiler * s.spoilers;
  // Yer etkisi: indüklenmiş akı azalır, taşıma eğimi hafif artar
  CL *= 1 + D.groundLift * (1 - s.sigmaGE);
  // Sıkıştırılabilirlik: Prandtl-Glauert ses altında artırır, ses üstünde eğim düşer
  CL *= machLiftFactor(M, D);
  // Asansör taşıma katkısı (kuyruk taşıması gövde taşımasına eklenir)
  CL += D.CLde * u.de;

  // --- Sürükleme ---
  // Parazit + bağlı akış indüklenmiş + girdap/ayrılma sürüklemesi + dalga sürüklemesi.
  // Girdap terimi sin³ ile büyür: yüksek alpha'da enerji kaybı bundan gelir.
  const AR = D.AR;
  const e = D.e + (D.eFlaps - D.e) * s.flaps;
  const ca = Math.cos(alpha), sa = Math.sin(alpha);
  const clPot = D.lift === 'vortex' ? D.Kp * sa * ca * ca : CL * (1 - sepFrac);
  const CDi = (clPot * clPot) / (Math.PI * AR * e) * s.sigmaGE;
  const CDvortex = D.lift === 'vortex' ? D.Kv * Math.abs(sa) * sa * sa : 0;
  const CDsep = D.CDsep * sa * sa * sepFrac;
  let CD0 = D.CD0 + D.CDgear * s.gear + D.CDflaps * s.flaps + D.CDspoiler * s.spoilers;
  CD0 += machWaveDrag(M, D);
  // Kontrol yüzeyi sapma sürüklemesi
  const CDctl = D.CDde * u.de * u.de + D.CDda * u.da * u.da + D.CDdr * u.dr * u.dr;
  const CD = CD0 + CDi + CDvortex + CDsep + CDctl + D.CDbeta * Math.abs(Math.sin(beta));

  // --- Yan kuvvet ---
  // Kayma açısı, sapma oranı, dümen. Yüksek alpha'da dikey kuyruklar gölgede kalır.
  const tailEff = 1 - D.tailBlank * smoothstep(D.blankA0, D.blankA1, aAbs);
  const CY = D.CYb * Math.sin(beta) * tailEff
    + D.CYr * s.rhat * tailEff
    + D.CYp * s.phat
    + D.CYdr * u.dr * tailEff;

  // --- Yunuslama momenti ---
  // Cma: ses altında gevşek kararlılık, ses üstünde aerodinamik merkez geriye kayar.
  const cma = D.Cma + (D.CmaSup - D.Cma) * smoothstep(0.92, 1.25, M);
  let Cm = D.Cm0 + cma * Math.sin(alpha)
    + D.Cmq * s.qhat
    + D.CmFlaps * s.flaps
    + D.CmSpoiler * s.spoilers
    + D.Cmde * u.de;
  // Çok yüksek alpha'da burun aşağı eğilim (girdap patlaması basınç merkezini geri taşır).
  // Bu bir EŞİK değil, düzgün bir smoothstep ile devreye giren sürekli bir terimdir
  // ve toparlanmaya yardım eder.
  Cm += D.CmHiAlpha * smoothstep(D.hiA0, D.hiA1, aAbs) * -Math.sign(alpha || 1);

  // --- Yatış momenti ---
  // ŞERİT (strip) MODELİ — yatış sönümünün ASIL kaynağı.
  //
  // Yatış oranı p > 0 iken (sağ kanat aşağı) sağ kanat yerel hücum açısı ARTAR,
  // sol kanadınki AZALIR. Bağlı akışta sağ kanat daha çok taşır; daha çok taşıyan
  // kanat YUKARI iter, yani moment yatışa KARŞIDIR:
  //       Cl_asym = -k · (CL_sağ - CL_sol)
  // İşaretin ters olması (pozitif) yatış sönümünü NEGATİFE çevirir ve hiçbir
  // kanatçık girdisi olmadan bile yatış oranı ıraksar.
  //
  // Stall ÜSTÜNDE eğri tersine döner: aşağı giden kanat CLmax'ı geçtiği için
  // taşıma KAYBEDER, fark işaret değiştirir ve terim yatışı DESTEKLER. Otorotasyon
  // ve kanat düşmesi böylece tek bir sürekli denklemden KENDİLİĞİNDEN doğar;
  // ayrı bir "stall modu" ya da zamana bağlı yapay tork yoktur.
  //
  // Bu terim doğrusal bölgede Clp'nin kanat payını zaten üretir; bu yüzden D.Clp
  // yalnızca gövde + kuyruk ARTIK katkısıdır (bkz. PUBLIC_DATA_SOURCES.md).
  const clAsym = -D.rollAsym * (clR - clL);
  const clp = D.Clp * (1 - D.ClpFade * sepFrac);              // artık sönüm (gövde+kuyruk)
  const clb = D.Clb * (1 + D.ClbAlpha * smoothstep(8 * DEG, 32 * DEG, aAbs));  // dihedral etkisi alpha ile artar
  const Cl = clb * Math.sin(beta)
    + clp * s.phat
    + D.Clr * s.rhat * (0.3 + 0.7 * Math.abs(CL) / Math.max(0.3, D.CLref))
    + D.Clda * u.da * (1 - D.CldaFade * sepFrac)
    + D.Cldr * u.dr * tailEff
    + clAsym;

  // --- Sapma momenti ---
  // Cnb yüksek alpha'da AZALIR ama POZİTİF KALIR: F-35'in eğik dikey kuyrukları
  // konvansiyonel bir kuyruğun yönsel kararlılığını kaybettiği açılarda bir miktar
  // kararlılık korur. Negatife düşürülseydi yönsel ıraksama (nose slice) kaçınılmaz olurdu.
  const cnb = D.Cnb * (D.CnbFloor + (1 - D.CnbFloor) * (1 - smoothstep(D.cnbA0, D.cnbA1, aAbs)));
  const Cn = cnb * Math.sin(beta)
    + D.Cnr * s.rhat * (0.45 + 0.55 * tailEff)
    + D.Cnp * s.phat
    + D.Cndr * u.dr * tailEff
    + D.Cnda * u.da;                                        // ters sapma (adverse yaw)

  C.CL = CL; C.CD = CD; C.CY = CY; C.Cl = Cl; C.Cm = Cm; C.Cn = Cn;
  C.sepFrac = sepFrac;
  C.stallFrac = smoothstep(D.stallA0, D.stallA1, aAbs);
  C.tailEff = tailEff;
  return C;
}

// Ses altı sıkıştırılabilirlik ve ses üstü eğim düşüşü
const TRANS_PEAK = 2.2;          // transonik taşıma eğimi tavanı
// Ackeret dalı: eğim 1/sqrt(M²-1) ile düşer
function ackeret(M, D) { return clamp(D.CLsupK / Math.sqrt(Math.max(0.35, M * M - 1)), 0.45, 1.6); }
function machLiftFactor(M, D) {
  if (M < 0.75) return 1 / Math.sqrt(Math.max(0.36, 1 - M * M));   // Prandtl-Glauert, 0.8'de sınırlanır
  if (M < 1.05) {
    // Transonik: PG'den ses üstü değere düzgün geçiş
    const pg = 1 / Math.sqrt(Math.max(0.36, 1 - 0.75 * 0.75));
    const sup = 1 / Math.sqrt(Math.max(0.2, 1.05 * 1.05 - 1));
    return pg + (Math.min(sup, TRANS_PEAK) - pg) * smoothstep(0.75, 1.05, M);
  }
  // M = 1,05'te iki dal arasında BASAMAK vardı: altses dalı TRANS_PEAK (2,2) ile
  // biterken Ackeret dalı tavanı olan 1,6'dan başlıyordu — taşıma eğiminde tek
  // adımda %27'lik sıçrama. Tam g çekerken bu bant geçildiğinde uçak "kopuyor",
  // AoA bir kayıt adımında 3° düşüyor ve yük faktöründe sahte bir tepe oluşuyordu.
  // 1,05–1,18 arasında yumuşak geçiş kurulur; bandın dışında davranış aynıdır.
  if (M < 1.18) return TRANS_PEAK + (ackeret(M, D) - TRANS_PEAK) * smoothstep(1.05, 1.18, M);
  return ackeret(M, D);
}

// Transonik/süpersonik dalga sürüklemesi.
// M 0.88'de yükselmeye başlar, 1.12'de tam değerine ulaşır ve süpersonik bölgede
// yalnızca hafifçe azalır. Genlik, itki-sürükleme dengesinin KAMUYA AÇIK azami
// hızda kurulmasına göre seçilmiştir (bkz. PUBLIC_DATA_SOURCES.md):
//   36 000 ft, M 1.6 => qbar·S ≈ 1.73 MN, art yakıcı itkisi ≈ 110 kN
//   => denge için CD0(süpersonik) ≈ 0.062, yani CDwave·decay ≈ 0.0455.
function machWaveDrag(M, D) {
  if (M < 0.80) return 0;
  const rise = smoothstep(0.88, 1.12, M);
  const decay = 1 - 0.15 * smoothstep(1.2, 2.0, M);
  return D.CDwave * rise * decay;
}

/**
 * Konfigürasyondaki azami taşıma katsayısı (FCS'nin kullanılabilir g hesabı için).
 * Eğriyi tarayarak bulunur; böylece formülasyon değişse de doğru kalır.
 */
export function clMaxConfig(D, flaps, slats) {
  let best = 0;
  const base = D.lift === 'vortex' ? clVortex : clClassic;
  for (let a = 2 * DEG; a < 60 * DEG; a += 2 * DEG) {
    const v = base(a, D) + (D.CLflaps * flaps + D.CLslats * slats) * (1 - 0.85 * smoothstep(D.sepA0, D.sepA1, a));
    if (v > best) best = v;
  }
  return best;
}

/**
 * Verilen taşıma katsayısını üreten hücum açısı (trim tahmini için).
 * Eğri tek tepeli olduğundan tepe öncesi bölgede ikiye bölme ile aranır.
 */
export function alphaForCL(D, target, flaps, slats) {
  const base = D.lift === 'vortex' ? clVortex : clClassic;
  const f = (a) => base(a, D) + (D.CLflaps * flaps + D.CLslats * slats) * (1 - 0.85 * smoothstep(D.sepA0, D.sepA1, Math.abs(a)));
  let lo = -14 * DEG, hi = D.alphaPeak;
  if (target <= f(lo)) return lo;
  if (target >= f(hi)) return hi;
  for (let i = 0; i < 18; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) < target) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}
