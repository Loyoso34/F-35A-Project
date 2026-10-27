// Çarpışma sınıflandırması: bir temas/çarpma olayını NEDEN ve ŞİDDET olarak sınıflandırır.
//
// Eski sistemde ilk tutan koşul sebep olarak yazılıyordu: takım yukarıyken 300 kt'lık dik
// bir dalış "Landed with the gear up" olarak raporlanıyordu. Burada her olay için önce
// fiziksel büyüklükler hesaplanır (yere dik çarpma hızı, yer hızı, uçuş yolu açısı, tutum,
// takım, yüzey, eğim), sonra nedenler ÖNEM SIRASIYLA denetlenir: en büyük enerjiyi taşıyan /
// en belirleyici neden birincil nedendir; diğerleri ikincil not olarak kalır.
//
// Eşikler fiziksel ve yapılandırılabilirdir (IMPACT_LIMITS). Değerlerin dayanağı:
//  - normalSink 3,05 m/s (600 ft/dk): olağan iniş alçalma hızı üst sınırı [E]
//  - hardSink: fleet.js limits.hardLandVs (−6,5 m/s ≈ 1280 ft/dk): takımın yapısal sınırı [E]
//  - severeSink 12,2 m/s (2400 ft/dk): hiçbir iniş tekniğiyle açıklanamayan çarpma [E]
//  - catastrophicSink 30 m/s (≈5900 ft/dk) / catastrophicSpeed 125 m/s (≈245 kt) + dik yol:
//    gövde bütünlüğünün korunamayacağı çarpma [E]
//  - maxTouchdownGS 103 m/s (≈200 kt): lastik/takım hız sınırı mertebesi [E]
//  ([E]: mühendislik yaklaşımı; F-35A'nın gerçek sertifikasyon değerleri kamuya açık değildir.)

const MS_TO_KT = 1.943844, MS_TO_FPM = 196.8504;
const DEG = Math.PI / 180;

export const IMPACT_LIMITS = {
  normalSink: 3.05,
  severeSink: 12.2,
  catastrophicSink: 30,
  catastrophicSpeed: 125,
  catastrophicPathDeg: 15,
  maxTouchdownGS: 103,
  steepPathDeg: 12,          // bundan dik uçuş yolu iniş girişimi sayılmaz
  gearUpMaxSink: 4.5,        // gövde üstü inişte hayatta kalınabilir alçalma
  gearUpMaxGS: 95,
  terrainSlope: 0.27,        // ~15°: bundan dik zemin "arazi çarpması" (iniş yüzeyi değil)
  obstacleCatastrophic: 60,  // m/s: yapıya bundan hızlı çarpma yıkıcıdır
};

export const SEVERITY_TITLE = {
  minor: 'IMPACT', major: 'SERIOUS IMPACT', critical: 'CRITICAL IMPACT', catastrophic: 'CATASTROPHIC IMPACT',
};

const CAUSE_TEXT = {
  'obstacle': 'Obstacle collision',
  'water': 'Water impact',
  'excessive-vs': 'Excessive vertical impact speed',
  'high-speed': 'High-speed ground impact',
  'terrain': 'Terrain collision',
  'gear-up': 'Gear-up landing',
  'hard-landing': 'Hard landing — landing gear collapsed',
  'wingtip': 'Wingtip strike — excessive bank at touchdown',
  'tail-strike': 'Tail strike — excessive pitch at touchdown',
  'nose-first': 'Nose gear collapsed — landed nose-first',
  'off-runway': 'Landed off the paved runway at high speed',
  'runway-excursion': 'Runway excursion — departed the paved surface at high speed',
  'ground-loop': 'Loss of control on the ground — wingtip struck',
  'catastrophic': 'Catastrophic impact',
};

/**
 * e: {
 *   type: 'touchdown' | 'ground' | 'terrain' | 'obstacle' | 'water',
 *   vx, vy, vz (m/s, yere göre), slope (zemin eğimi, tanθ), nx, ny, nz (zemin normali),
 *   pitch, roll (rad), gear (0..1), surface ('runway'|'taxiway'|'apron'|'grass'|'water'),
 *   lim: fleet.js limits (hardLandVs, landRoll, groundRoll, landPitch, offRunwayV), clearanceDeficit (m)
 * }
 * Dönüş: { crash, cause, severity, title, reason, notes[], data{...} } — crash=false ise normal/sert iniş.
 */
export function classifyImpact(e, L = IMPACT_LIMITS) {
  const lim = e.lim || {};
  const vh = Math.hypot(e.vx, e.vz);
  const v = Math.hypot(vh, e.vy);
  const sink = Math.max(0, -e.vy);
  // Yere dik çarpma hızı: eğimli zeminde (yamaç) normal bileşen
  const nx = e.nx || 0, ny = e.ny === undefined ? 1 : e.ny, nz = e.nz || 0;
  const vN = Math.max(0, -(e.vx * nx + e.vy * ny + e.vz * nz));
  const gammaDeg = Math.atan2(e.vy, Math.max(vh, 0.1)) / DEG;     // negatif: alçalıyor
  const pitchDeg = (e.pitch || 0) / DEG, rollDeg = (e.roll || 0) / DEG;
  const gearDown = (e.gear || 0) >= 0.98;
  const paved = e.surface === 'runway' || e.surface === 'taxiway' || e.surface === 'apron';
  const hardSink = Math.abs(lim.hardLandVs || -6.5);
  const data = {
    impactSpeedKt: v * MS_TO_KT, groundSpeedKt: vh * MS_TO_KT, verticalSpeedFpm: e.vy * MS_TO_FPM,
    normalSpeed: vN, pathDeg: gammaDeg, pitchDeg, rollDeg, gearDown, surface: e.surface, type: e.type,
  };
  const notes = [];
  const out = (cause, severity, extra) => {
    const res = { crash: true, cause, severity, title: SEVERITY_TITLE[severity], reason: CAUSE_TEXT[cause], notes, data };
    if (extra) res.reason += extra;
    // ikincil gözlemler (birincil nedenle aynı olmayanlar)
    if (cause !== 'gear-up' && !gearDown && e.type !== 'obstacle') notes.push('Landing gear was retracted');
    if (cause !== 'excessive-vs' && cause !== 'hard-landing' && sink > hardSink) notes.push(`Sink rate ${Math.round(sink * MS_TO_FPM)} ft/min`);
    if (cause !== 'wingtip' && cause !== 'ground-loop' && Math.abs(rollDeg) > (lim.landRoll || 0.21) / DEG && e.type !== 'obstacle') notes.push(`Bank ${Math.round(Math.abs(rollDeg))}°`);
    return res;
  };

  // 1) Yapı / engel: çarpılan nesne birincil nedendir; hızlıysa yıkıcı
  if (e.type === 'obstacle') return out('obstacle', v > L.obstacleCatastrophic ? 'catastrophic' : v > 25 ? 'critical' : 'major');
  // 2) Yıkıcı enerji: çok yüksek dik çarpma hızı ya da çok hızlı ve dik çarpma
  const steep = -gammaDeg > L.catastrophicPathDeg;
  if (vN > L.catastrophicSink || (v > L.catastrophicSpeed && steep)) {
    // Birincil neden yine fizikseldir: dikey bileşen baskınsa "aşırı dikey hız"
    const cause = e.surface === 'water' ? 'water' : (vN > L.catastrophicSink || sink > L.severeSink) ? 'excessive-vs' : 'high-speed';
    return out(cause, 'catastrophic');
  }
  // 3) Su
  if (e.type === 'water' || e.surface === 'water') {
    const gentle = sink < L.normalSink * 1.5 && vh < 80 && Math.abs(pitchDeg) < 15 && Math.abs(rollDeg) < 15;
    return out('water', gentle ? 'major' : 'critical', gentle ? ' (ditched)' : '');
  }
  // 4) Yerde yuvarlanırken (kalkış/iniş koşusu): yükseklik/eğim olayları
  if (e.type === 'ground') {
    if (Math.abs(rollDeg) > (lim.groundRoll || 0.26) / DEG) return out('ground-loop', 'major');
    if (!paved && vh > (lim.offRunwayV ? lim.offRunwayV[1] : 60)) return out('runway-excursion', 'major');
    return out('terrain', vh > 50 ? 'critical' : 'major');
  }
  // 5) Uçuşta araziye girme (temas anında iniş geometrisi yok): arazi çarpması
  if (e.type === 'terrain') {
    if (sink > L.severeSink) return out('excessive-vs', 'critical');
    return out('terrain', v > 60 ? 'critical' : 'major');
  }
  // ---- type === 'touchdown': ilk teker/gövde teması ----
  // 6) Aşırı dikey hız: iniş girişimi olamayacak alçalma
  if (sink > L.severeSink) return out('excessive-vs', 'critical');
  // 7) Yüksek hızda yer teması (lastik/takım sınırı üstü)
  if (vh > L.maxTouchdownGS) return out('high-speed', vh > 150 ? 'catastrophic' : 'critical');
  // 8) Dik uçuş yolu ya da dik yamaç: iniş değil arazi çarpması
  if (-gammaDeg > L.steepPathDeg || (!paved && (e.slope || 0) > L.terrainSlope)) return out('terrain', v > 60 ? 'critical' : 'major');
  // 9) Takım yukarı: gövde üstü iniş (hayatta kalınabilir sınırdaysa), değilse sert çarpma
  if (!gearDown) {
    if (sink > Math.max(L.gearUpMaxSink, hardSink) || vh > L.gearUpMaxGS) return out('excessive-vs', 'critical', ' — gear retracted');
    return out('gear-up', 'major');
  }
  // 10) Sert iniş: takım yapısal sınırı aşıldı
  if (sink > hardSink) return out('hard-landing', 'major', ` (${Math.round(sink * MS_TO_FPM)} ft/min)`);
  // 11) Tutum: kanat ucu, kuyruk, burun
  if (Math.abs(e.roll || 0) > (lim.landRoll || 0.21)) return out('wingtip', 'major');
  const lp = lim.landPitch || [-4 * DEG, 15 * DEG];
  if ((e.pitch || 0) > lp[1]) return out('tail-strike', 'major');
  if ((e.pitch || 0) < lp[0]) return out('nose-first', 'major');
  // 12) Pist dışına yüksek hızda iniş
  if (!paved && vh > (lim.offRunwayV ? lim.offRunwayV[0] : 55)) return out('off-runway', 'major');
  // Kaza yok: normal ya da sert (ama yapısal sınır içinde) iniş
  return { crash: false, cause: sink > L.normalSink ? 'firm' : 'normal', severity: 'none', data, notes };
}

/** Şiddete göre çarpma sonrası (enkaz) parametreleri: sürtünme, sekme, dönme, sahne süresi. */
export const WRECK_PARAMS = {
  minor: { mu: 0.45, bounce: 0.05, spin: 0.15, settle: 2.2, shake: 0.35, delay: 1.7 },
  major: { mu: 0.55, bounce: 0.10, spin: 0.35, settle: 2.0, shake: 0.55, delay: 2.1 },
  critical: { mu: 1.1, bounce: 0.22, spin: 1.1, settle: 1.2, shake: 0.85, delay: 2.4 },
  // yıkıcı çarpmada ana enkaz kütlesi kısa mesafede durur (parçalanma enerjiyi yutar)
  catastrophic: { mu: 2.4, bounce: 0.28, spin: 2.2, settle: 0.8, shake: 1.0, delay: 2.6 },
};

export const fmtCrashData = {
  speed: (d) => `${Math.round(d.impactSpeedKt)} kt`,
  vs: (d) => `${d.verticalSpeedFpm <= -0.5 ? '−' : ''}${Math.abs(Math.round(d.verticalSpeedFpm)).toLocaleString('en-US')} ft/min`,
  attitude: (d) => `Pitch ${d.pitchDeg >= 0 ? '+' : '−'}${Math.abs(Math.round(d.pitchDeg))}° · Bank ${Math.abs(Math.round(d.rollDeg))}°`,
};
