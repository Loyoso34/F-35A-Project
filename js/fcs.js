// Fly-by-wire uçuş kontrol sistemi.
//
// ÖNEMLİ: Bu, gerçek F-35 kontrol kanunlarının bir kopyası DEĞİLDİR. Gerçek kanunlar
// gizlidir, modellenmemiştir ve modellenmeye çalışılmamıştır. Burada yalnızca KAMUYA
// AÇIK DAVRANIŞ ifadelerinden kurulmuş genel bir modern savaş uçağı FBW mimarisi vardır:
//   - "care-free handling" (kamuya açık uçuş testi açıklamaları)
//   - 9 g sınıfı uçak (USAF fact sheet)
//   - çok yüksek AoA'da kontrollü uçuş (kamuya açık gösteri malzemesi)
//
// Mimari:
//   çubuk -> istenen UÇAK TEPKİSİ (g / AoA / yatış oranı) -> istenen açısal ivme
//        -> gereken moment -> yüzey komutu (oran ve sapma sınırlı)
// Hiçbir aşamada rotasyon doğrudan yazılmaz.
//
// Departure (kontrol kaybı) önlemenin ANAHTARI burada:
//   1. Yatış komutu HIZ VEKTÖRÜ etrafındadır (gövde ekseni değil). Bu, yatarken
//      kayma açısı üretmez.
//   2. Yatış oranı tavanı AoA ile sert biçimde düşer. Atalet çiftlenimi
//      (I_zz−I_xx)·p·r ve (I_xx−I_yy)·p·q yüksek AoA'da yüksek p ile patlar;
//      gerçek uçaklar da bunu tam olarak böyle önler.
//   3. AoA sınırlayıcı yumuşak bir bantla çalışır, sert eşikle değil.

import { clamp, smoothstep } from './noise.js';

const DEG = Math.PI / 180;

export class FCS {
  constructor(D, law) {
    this.D = D;
    this.L = law;
    this.reset();
  }

  reset() {
    this.sf = { pitch: 0, roll: 0, yaw: 0 };   // ön filtreli çubuk
    this.cmd = { de: 0, da: 0, dr: 0 };        // yüzey komutları (-1..1)
    this.sur = { de: 0, da: 0, dr: 0 };        // gerçek yüzey konumları (oran sınırlı)
    this.dbg = {};
  }

  /**
   * Bir kontrol adımı. Yüzey konumlarını (this.sur) günceller.
   *
   * @param {number} dt
   * @param {object} st  çubuk: {pitch, roll, yaw} (-1..1)
   * @param {object} s   uçuş durumu: alpha, beta, V, qbar, mach, p, q, r, nz, phi, theta,
   *                     CLmaxCfg, mass, rho
   * @param {object} aeroMoments  mevcut aerodinamik moment katsayıları (telafi için)
   */
  update(dt, st, s) {
    const D = this.D, L = this.L;
    // --- Çubuk ön filtresi: ani bırakmada komut basamağı yumuşar ---
    const kp = 1 - Math.exp(-dt / L.prefilter);
    const kr = 1 - Math.exp(-dt / L.rollFilter);
    this.sf.pitch += (st.pitch - this.sf.pitch) * kp;
    this.sf.roll += (st.roll - this.sf.roll) * kr;
    this.sf.yaw += (st.yaw - this.sf.yaw) * (1 - Math.exp(-dt / 0.10));
    const sp = this.sf.pitch, sr = this.sf.roll, sy = this.sf.yaw;

    // Kontrol etkinliği: dinamik basınçla. Hız düşerse yüzeyler ZAYIFLAR, güçlenmez.
    const auth = clamp(s.qbar / L.qAuth, 0.02, 1);
    const Vs = Math.max(s.V, L.Vmin);          // güvenli payda — 1/V asla patlamaz

    // ===================== YUNUSLAMA =====================
    // Yüksek dinamik basınçta g komutu, düşükte AoA komutu; aralarında düzgün harman.
    const wG = smoothstep(L.qBlend[0], L.qBlend[1], s.qbar);

    // -- g komutu --
    const nCmd = sp >= 0 ? 1 + sp * (D.gMax - 1) : 1 + sp * (1 - D.gMin);
    // Kullanılabilir g: mevcut konfigürasyonun azami taşımasıyla sınırlı
    const nAvail = s.qbar * D.S * s.CLmaxCfg / (s.mass * 9.80665);
    const nTarget = clamp(nCmd, D.gMin, Math.max(0.2, Math.min(D.gMax, nAvail * 0.96)));
    // Kararlı hal yunuslama oranı: uçuş yolunu bükmek için gereken oran
    const qSteady = (nTarget - Math.cos(s.phi) * Math.cos(s.theta)) * 9.80665 / Vs;
    // Yük faktörü geri beslemesi
    // L_alpha / (m·g): birim AoA başına g. D.CLalpha veri setinden gelir; böylece
    // girdap (Kp) ve klasik (CLa) taşıma formülasyonlarının İKİSİ de çalışır.
    const kAlpha = Math.max(0.5, D.CLalpha * s.qbar * D.S / (s.mass * 9.80665));
    const Kq = L.Kq0 + L.KqA * auth;
    const Kn = clamp(Kq / (4 * L.zeta * L.zeta * kAlpha) - 9.80665 / Vs, 0.03, 0.8);
    const qCmdG = qSteady + (nTarget - s.nz) * Kn;

    // -- AoA komutu --
    // Nötr çubuk = trim AoA, tam çubuk = yumuşak AoA tavanı
    const aTrim = clamp(s.alphaTrim, -6 * DEG, D.alphaSoft);
    const aCmd = sp >= 0 ? aTrim + sp * (D.alphaSoft - aTrim) : aTrim + sp * (aTrim + 10 * DEG);
    const gkv = 9.80665 * kAlpha / Vs;
    const Ka = clamp((Kq + gkv) * (Kq + gkv) / (4 * L.zeta * L.zeta * Kq) - gkv, 0.6, 2.4);
    const qCmdA = (aCmd - s.alpha) * Ka;

    let qCmd = qCmdA * (1 - wG) + qCmdG * wG;

    // -- AoA sınırlayıcı (yumuşak) --
    // alphaSoft üstünde burun yukarı komutu kademeli olarak kısılır; alphaLimit'te
    // tamamen kesilir ve burun aşağı istenir. Sert eşik YOK: geçiş smoothstep ile.
    const over = (s.alpha - D.alphaSoft) / Math.max(1e-3, D.alphaLimit - D.alphaSoft);
    if (over > 0) {
      const cut = 1 - smoothstep(0, 1, over);
      qCmd = Math.min(qCmd, qCmd * cut + (D.alphaSoft - s.alpha) * 0.9 * (1 - cut));
    }
    if (s.alpha < -14 * DEG) qCmd = Math.max(qCmd, (-14 * DEG - s.alpha) * 0.8);
    qCmd = clamp(qCmd, -D.pitchRateMax, D.pitchRateMax);

    // ===================== YATIŞ =====================
    // Yatış oranı tavanı üç şeyle sınırlanır:
    //   (a) dinamik basınç (düşük hızda daha az),
    //   (b) HÜCUM AÇISI — bu, atalet çiftlenimi kaynaklı departure'ı önleyen ana koruma,
    //   (c) kayma açısı (zaten kayıyorsak yatış oranını kıs).
    // (a) AERODİNAMİK YETKİ TAVANI — tuned bir katsayı değil, kararlı hal çözümü:
    //       Cl_da·δ_a  =  -Cl_p(toplam)·p̂ ,   p̂ = p·b/(2V)
    //   =>  p_yetki = (Cl_da / |Cl_p|) · 2V/b
    //   Hız düştükçe bu doğrusal olarak düşer; ayrılmada Cl_da da zayıflar.
    //   FCS asla aerodinamik tavanın tamamını istemez (rollAuth payı bırakılır).
    const cldaEff = Math.abs(D.Clda) * (1 - D.CldaFade * s.sepFrac);
    const pAuth = cldaEff / Math.abs(D.ClpTotal) * 2 * Vs / D.span * L.rollAuth;
    const aFac = 1 - L.rollAlphaCut * smoothstep(L.rollA0, L.rollA1, Math.abs(s.alpha));
    const bFac = 1 - 0.55 * smoothstep(8 * DEG, 25 * DEG, Math.abs(s.beta));
    let pMax = Math.min(D.rollRateMax, pAuth) * aFac * bFac;

    // Hız vektörü etrafında yatmak için gereken gövde sapma oranı pv·sinα'dır.
    // Yüksek AoA'da bu oran dümenin üretebileceğinin üstüne çıkarsa koordinasyon
    // kaybolur ve kayma açısı birikir. Bu yüzden yatış oranı, DÜMEN YETKİSİNE göre
    // de sınırlanır: uçak koordine edemeyeceği bir yatışı hiç başlatmaz.
    // rBudget: dümenin bu dinamik basınçta makul sürede kurabileceği sapma oranı.
    const sa = Math.abs(Math.sin(s.alpha));
    const NdrBudget = Math.max(1, s.qbar * D.S * D.span * Math.abs(D.Cndr)) * s.tailEff;
    const rBudget = clamp(NdrBudget / D.Izz * L.yawBudgetT, 0.05, D.yawRateMax * 3);
    if (sa > 0.05) pMax = Math.min(pMax, rBudget / sa);
    const pvCmd = sr * pMax;                    // HIZ VEKTÖRÜ etrafında istenen oran

    // Hız vektörü yatışını gövde eksenlerine çöz: yatarken kayma üretilmez.
    const ca = Math.cos(s.alpha);
    const pCmd = pvCmd * ca;
    const rFromRoll = pvCmd * Math.sin(s.alpha);

    // ===================== SAPMA =====================
    // Üç katkı:
    //   (a) yatışın gerektirdiği koordine sapma oranı,
    //   (b) kayma açısını sıfıra süren geri besleme + türev (sönüm) terimi,
    //   (c) pilot dümen girdisi.
    // Türev terimi olmadan yavaş Dutch roll modu kaymayı biriktirir; bu terim
    // kaymanın BÜYÜME hızını da bastırır.
    const betaGain = L.betaGain * clamp(s.qbar / L.qAuth, 0.25, 1);
    const bdot = (s.beta - (this._betaPrev !== undefined ? this._betaPrev : s.beta)) / Math.max(dt, 1e-4);
    this._betaPrev = s.beta;
    // İŞARET: beta > 0 => hız vektörü burnun SAĞINDA. Kaymayı sıfırlamak için burun
    // SAĞA çevrilmeli, yani r > 0. Dolayısıyla koordinasyon komutu beta ile AYNI
    // işaretlidir. (Eskiden ters işaretliydi ve kuaterniyon entegrasyonundaki sapma
    // işareti hatasını maskeliyordu; ikisi birlikte düzeltildi.)
    const rCoord = clamp(s.beta * betaGain + clamp(bdot, -2, 2) * L.betaRate, -L.betaAuth, L.betaAuth);
    const rPilot = sy * D.yawRateMax;
    let rCmd = rFromRoll + rCoord + rPilot;
    rCmd = clamp(rCmd, -D.yawRateMax * 3, D.yawRateMax * 3);

    // ===================== İÇ DÖNGÜ: oran -> yüzey =====================
    // İstenen açısal ivme, mevcut atalet ve kontrol gücü üzerinden yüzey komutuna çevrilir.
    // Kontrol gücü qbar ile ölçeklenir: yavaşken yüzeyler zayıflar (fiziksel doğru).
    const Kpp = L.Kp0 + L.KpA * auth;
    const Krr = L.Kr0 + L.KrA * auth;
    const qS = s.qbar * D.S;
    // Bir birim yüzey sapmasının üreteceği moment (sıfıra bölme koruması ile)
    const Mde = Math.max(1, qS * D.chord * Math.abs(D.Cmde)) * s.tailEff1;
    const Lda = Math.max(1, qS * D.span * Math.abs(D.Clda)) * (1 - D.CldaFade * s.sepFrac);
    const Ndr = Math.max(1, qS * D.span * Math.abs(D.Cndr)) * s.tailEff;

    // İstenen açısal ivme -> gereken moment (aerodinamik ve atalet momentleri telafi edilir)
    const Mreq = D.Iyy * Kq * (qCmd - s.q) - s.Maero - s.Mgyro;
    const Lreq = D.Ixx * Kpp * (pCmd - s.p) - s.Laero - s.Lgyro;
    const Nreq = D.Izz * Krr * (rCmd - s.r) - s.Naero - s.Ngyro;

    // Yüzey komutu = gereken moment / birim yüzey momenti, ±1'e kırpılır
    this.cmd.de = clamp(-Mreq / Mde, -1, 1);     // Cmde negatif olduğu için işaret ters
    this.cmd.da = clamp(Lreq / Lda, -1, 1);
    this.cmd.dr = clamp(-Nreq / Ndr, -1, 1);

    // ===================== EYLEYİCİ =====================
    // Sonlu sapma ve SONLU HIZ sınırı: yüzey bir karede 0'dan tam sapmaya atlayamaz.
    const rate = L.surfRate * dt;                // birim/s cinsinden azami hız
    for (const k of ['de', 'da', 'dr']) {
      const d = this.cmd[k] - this.sur[k];
      this.sur[k] += clamp(d, -rate, rate);
      // İkinci mertebe yumuşatma (eyleyici gecikmesi τ)
      this.sur[k] += (this.cmd[k] - this.sur[k]) * (1 - Math.exp(-dt / L.actuator)) * 0.35;
      this.sur[k] = clamp(this.sur[k], -1, 1);
    }

    this.dbg = { qCmd, pCmd, rCmd, pvCmd, pMax, nTarget, nAvail, aCmd, wG, auth, aFac, over };
    return this.sur;
  }
}
