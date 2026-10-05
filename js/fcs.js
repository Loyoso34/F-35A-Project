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
//   çubuk -> istenen UÇAK TEPKİSİ (g / AoA / yunuslama oranı / yatış oranı)
//        -> istenen açısal ivme -> gereken moment -> yüzey komutu -> eyleyici (gecikme +
//           hız sınırı) -> gerçek yüzey konumu
// Hiçbir aşamada rotasyon doğrudan yazılmaz. Fiziğin, görselin ve telemetrinin kullandığı
// TEK yüzey konumu this.sur'dur.
//
// Departure (kontrol kaybı) önlemenin ANAHTARI burada:
//   1. Yatış komutu HIZ VEKTÖRÜ etrafındadır (gövde ekseni değil). Bu, yatarken
//      kayma açısı üretmez.
//   2. Yatış oranı tavanı AoA ile sert biçimde düşer. Atalet çiftlenimi
//      (I_zz−I_xx)·p·r ve (I_xx−I_yy)·p·q yüksek AoA'da yüksek p ile patlar;
//      gerçek uçaklar da bunu tam olarak böyle önler.
//   3. AoA ve g sınırlayıcıları SÜREKLİDİR: sert eşik ya da anahtar yoktur. Bir sınır
//      komutun "üstüne yazılmaz"; komut zarfın kenarına yumuşakça doyar.
//
// SINIRLAYICI TASARIM KURALI (v3.5.0): Eski kodda negatif AoA tabanı bir ANAHTARDI —
//   if (α < −14°) qCmd = max(qCmd, (−14° − α)·0.8)
// α −14°'yi geçtiği adımda komut −25°/s'den +0,1°/s'ye sıçrıyor, stabilatör ters yöne
// dönüyor, α −14°'nin üstüne çıkınca tam burun aşağı komutu geri geliyordu. Aynı anda
// g kanunu −3 g'yi, yani α ≈ −18°'yi istiyordu: iki denetleyici birbirini ~2,5 Hz'de
// kesiyor, tam ileri çubukta uçak "eğil–dur–eğil–dur" yapıyordu. Artık (a) g hedefi
// negatif AoA sınırının üretebileceği yük faktörüyle sınırlanır (çatışma kaynağında
// biter), (b) AoA sınırlayıcısı iki yönde de sürekli bir banttır.

import { clamp, smoothstep } from './noise.js';

const DEG = Math.PI / 180;
const G = 9.80665;
const SURF_KEYS = ['de', 'da', 'dr'];

/**
 * C¹-sürekli yumuşak doyum. [lo+k, hi−k] arasında birebir; bantta sınıra asimptotik
 * yaklaşır (türev sürekli, bant girişinde 1). Sert kırpmanın ürettiği türev
 * süreksizliği ve "duvara çarpma" hissi olmaz; değer sınırı ASLA geçmez.
 */
export function softClamp(x, lo, hi, k) {
  if (!(hi > lo)) return 0.5 * (lo + hi);
  k = Math.min(k, 0.5 * (hi - lo));
  if (k <= 1e-9) return clamp(x, lo, hi);
  const a = hi - k, b = lo + k;
  if (x > a) return hi - k * Math.exp(-(x - a) / k);
  if (x < b) return lo + k * Math.exp((x - b) / k);
  return x;
}

/**
 * Çubuk serbestken istenen yük faktörü: uçuş yolunu tutan değer.
 * @param {number} gamma uçuş yolu açısı (rad)
 * @param {number} phi yatış açısı (rad)
 */
export function neutralLoad(gamma, phi) {
  const ab = Math.abs(phi);
  // Yatış telafisi 35°'ye kadar tam, 65°'te sıfır; ters uçuşta yok
  const bank = 1 - smoothstep(35 * DEG, 65 * DEG, ab);
  const comp = bank / Math.max(0.5, Math.cos(phi)) + (1 - bank);
  // Yol tutma yalnızca sığ yollarda (seyir, yaklaşma, dönüş). Dik tırmanış ve
  // dalışta klasik 1 g'ye geçilir: çubuk bırakılan dalıştaki uçak kendiliğinden
  // yavaşça toparlanır, yere doğru yolunu TUTMAZ.
  const hold = 1 - smoothstep(15 * DEG, 35 * DEG, Math.abs(gamma));
  return hold * Math.cos(gamma) * comp + (1 - hold);
}

export class FCS {
  constructor(D, law) {
    this.D = D;
    this.L = law;
    this.reset();
  }

  reset() {
    this.sf = { pitch: 0, roll: 0, yaw: 0 };   // ön filtreli çubuk
    this.cmd = { de: 0, da: 0, dr: 0 };        // yüzey komutları (-1..1)
    this.sur = { de: 0, da: 0, dr: 0 };        // gerçek yüzey konumları (eyleyici çıktısı)
    this.thetaRef = 0;                         // takım-aşağı kanununun tuttuğu yunuslama tutumu
    this._init = false;                        // ilk adımda referanslar mevcut duruma oturtulur
    this._betaPrev = undefined;
    this._pvPrev = undefined;
    this.dbg = { qCmd: 0, pCmd: 0, rCmd: 0, pvCmd: 0, pMax: 0, nTarget: 1, nAvail: 0, nNeg: 0, aCmd: 0, wG: 0, wPA: 0, auth: 0, aFac: 1, over: 0, under: 0 };
  }

  /**
   * Bir kontrol adımı. Yüzey konumlarını (this.sur) günceller ve döndürür.
   *
   * @param {number} dt
   * @param {object} st  çubuk: {pitch, roll, yaw} (-1..1)
   * @param {object} s   uçuş durumu: alpha, beta, V, qbar, mach, p, q, r, nz, phi, theta,
   *                     gamma, CLmaxCfg, CLneg, mass, alphaTrim, Maero/Laero/Naero (yüzeysiz
   *                     aerodinamik momentler), Mgyro/Lgyro/Ngyro, sepFrac, tailEff, tailEff1,
   *                     gear (takım konumu 0..1), onGround, noseDown (burun tekeri yerde),
   *                     Ipiv (ana takım ekseni etrafında atalet), Mgnd (yer tepkisi momenti)
   */
  update(dt, st, s) {
    const D = this.D, L = this.L;
    // --- Çubuk ön filtresi: ani bırakmada komut basamağı yumuşar ---
    // Yerde de çalışır: havalanma anında filtre bayat bir değerden başlamaz.
    const kp = 1 - Math.exp(-dt / L.prefilter);
    const kr = 1 - Math.exp(-dt / L.rollFilter);
    this.sf.pitch += (st.pitch - this.sf.pitch) * kp;
    this.sf.roll += (st.roll - this.sf.roll) * kr;
    this.sf.yaw += (st.yaw - this.sf.yaw) * (1 - Math.exp(-dt / 0.10));
    const sp = this.sf.pitch, sr = this.sf.roll, sy = this.sf.yaw;
    if (!this._init) { this._init = true; this.thetaRef = s.theta; }

    // Kontrol etkinliği: dinamik basınçla. Hız düşerse yüzeyler ZAYIFLAR, güçlenmez.
    const auth = clamp(s.qbar / L.qAuth, 0.02, 1);
    const Vs = Math.max(s.V, L.Vmin);          // güvenli payda — 1/V asla patlamaz
    const cgv = Math.cos(s.phi) * Math.cos(s.theta);

    // ===================== YUNUSLAMA =====================
    // --- Kullanılabilir yük faktörü zarfı (iki yönde) ---
    // Pozitif: konfigürasyonun azami taşıması. Negatif: negatif AoA SINIRININ ürettiği
    // taşıma. g kanunu zarfın dışını İSTEYEMEZ; böylece g ve AoA sınırlayıcısı aynı
    // anda karşıt yönlere çekmez (eski "dur-kalk" titreşiminin kaynağı).
    const wq = s.qbar * D.S / (s.mass * G);
    const nAvail = wq * s.CLmaxCfg;
    const nNegAvail = wq * s.CLneg;            // CLneg < 0
    const nHi = Math.max(0.2, nAvail * 0.96);
    const nLo = Math.min(-0.2, nNegAvail * 0.96);

    // Yüksek dinamik basınçta g komutu, düşükte AoA komutu; aralarında düzgün harman.
    const wG = smoothstep(L.qBlend[0], L.qBlend[1], s.qbar);

    // -- g komutu --
    // Bırakılan çubuk sığ yollarda UÇUŞ YOLUNU tutar: eski "nötr = 1 g" komutu
    // seyirde ve dönüşte yolu yavaşça büküyordu (yatışta irtifa kaybı, hafif
    // tırmanışta burnun kalkmaya devam etmesi). Yol tutma için gereken yük faktörü
    // cosγ'dır; orta yatışta (≤35°) irtifa kaybetmemek için 1/cosφ ile telafi edilir.
    // Dik yatışta, ters uçuşta ve dik tırmanış/dalışta klasik 1 g'ye döner (bkz.
    // neutralLoad). Yalnızca g kipinde etkilidir; düşük hızdaki AoA kipi trim AoA'yı tutar.
    const nHold = neutralLoad(s.gamma || 0, s.phi);
    const nCmd = sp >= 0 ? nHold + sp * (D.gMax - nHold) : nHold + sp * (nHold - D.gMin);
    // Yapısal sınırlar (gMin..gMax) çubuk eşlemesinin uçlarıdır; aerodinamik zarf
    // yumuşak doyumla uygulanır: hedef zarfa yaklaştıkça artış kademeli olarak azalır.
    const nTarget = softClamp(nCmd, nLo, nHi, 0.5);
    // Kararlı hal yunuslama oranı: uçuş yolunu bükmek için gereken oran
    const qSteady = (nTarget - cgv) * G / Vs;
    // Yük faktörü geri beslemesi
    // L_alpha / (m·g): birim AoA başına g. D.CLalpha veri setinden gelir; böylece
    // girdap (Kp) ve klasik (CLa) taşıma formülasyonlarının İKİSİ de çalışır.
    const kAlpha = Math.max(0.5, D.CLalpha * s.qbar * D.S / (s.mass * G));
    const Kq = L.Kq0 + L.KqA * auth;
    const Kn = clamp(Kq / (4 * L.zeta * L.zeta * kAlpha) - G / Vs, 0.03, 0.8);
    const qCmdG = qSteady + (nTarget - s.nz) * Kn;

    // -- AoA komutu --
    // Nötr çubuk = trim AoA, tam geri = yumuşak AoA tavanı, tam ileri = negatif yumuşak sınır
    const aTrim = clamp(s.alphaTrim, D.alphaNegSoft + 4 * DEG, D.alphaSoft);
    const aCmd = sp >= 0 ? aTrim + sp * (D.alphaSoft - aTrim) : aTrim + sp * (aTrim - D.alphaNegSoft);
    const gkv = G * kAlpha / Vs;
    const Ka = clamp((Kq + gkv) * (Kq + gkv) / (4 * L.zeta * L.zeta * Kq) - gkv, 0.6, 2.4);
    const qCmdA = (aCmd - s.alpha) * Ka;

    // Seyir/manevra kanunu (takım yukarı)
    const qCmdUA = qCmdA * (1 - wG) + qCmdG * wG;

    // -- Kalkış/iniş kanunu (takım aşağı): yunuslama ORANI komutu + tutum tutma --
    // Yerde ve takım aşağı havada çubuk AYNI anlama gelir: yunuslama oranı. Eskiden yerde
    // çubuk kinematik bir dönüş hızı, havada ise g komutuydu: havalanma anında %35 çubuk
    // birden 2,7 g istiyor, burun 20°/s ile kalkıyordu. Takım toplanırken (6 s) kanun
    // sürekli olarak seyir kanununa geçer.
    const wPA = clamp(s.gear, 0, 1);
    let qCmdPA = 0;
    if (wPA > 0) {
      // Oran kanununda çubuk DOĞRUSAL kullanılır: genel çubuk eğrisi (stickPow) seyirde
      // merkezde hassasiyet içindir; oran komutunda küçük girdileri gereksiz zayıflatıp
      // rotasyon ve flare için büyük çubuk istetiyordu.
      const spl = Math.sign(sp) * Math.pow(Math.abs(sp), 1 / L.stickPow);
      const wTrack = smoothstep(0.03, 0.15, Math.abs(spl));
      if (s.onGround) {
        // Yerde: çubuk geri = rotasyon; bırakılırsa burun yavaşça iner. Tutum tavanı
        // kuyruk payının altında yumuşak bir sınırdır (kuyruk sürtmesi önlenir).
        this.thetaRef = s.theta;
        const lower = -Math.min(Math.max(s.theta, 0) * 0.8, L.paLowerRate);
        qCmdPA = spl * L.qPA + (1 - wTrack) * lower;
        qCmdPA = Math.min(qCmdPA, (L.thetaGround - s.theta) * 2.5);
      } else {
        // Havada: çubuk hareketliyken referans tutum mevcut tutumu izler, bırakılınca
        // donar ve tutulur. Ters uçuşta/bıçak sırtında tutum tutmanın anlamı yoktur.
        this.thetaRef += (s.theta - this.thetaRef) * (1 - Math.exp(-dt * 25 * wTrack));
        const phiA = Math.abs(s.phi);
        const qTurn = G / Vs * Math.sin(s.phi) * Math.tan(clamp(s.phi, -1.2, 1.2)) * (1 - smoothstep(60 * DEG, 80 * DEG, phiA));
        const qHold = L.paAttK * (this.thetaRef - s.theta) * Math.max(0, Math.cos(s.phi));
        qCmdPA = spl * L.qPA + (1 - wTrack) * qHold + qTurn;
        // g koruması: oran komutu, zarfın izin verdiği kararlı hal oranına yumuşak doyar
        const qHiG = (Math.min(D.gMax, nHi) - cgv) * G / Vs, qLoG = (Math.max(D.gMin, nLo) - cgv) * G / Vs;
        qCmdPA = softClamp(qCmdPA, qLoG, qHiG, 0.5 * G / Vs);
      }
    } else {
      this.thetaRef = s.theta;
    }

    let qCmd = qCmdUA * (1 - wPA) + qCmdPA * wPA;

    // -- AoA sınırlayıcı (yumuşak, iki yönlü) --
    // alphaSoft üstünde burun yukarı komutu kademeli olarak kısılır; alphaLimit'te
    // tamamen kesilir ve burun aşağı istenir. Negatif tarafta aynısı ayna simetriğiyle.
    // Sert eşik YOK: geçiş smoothstep ile, komut α'nın sürekli fonksiyonudur.
    const over = (s.alpha - D.alphaSoft) / Math.max(1e-3, D.alphaLimit - D.alphaSoft);
    if (over > 0) {
      const cut = 1 - smoothstep(0, 1, over);
      qCmd = Math.min(qCmd, qCmd * cut + (D.alphaSoft - s.alpha) * 0.9 * (1 - cut));
    }
    const under = (D.alphaNegSoft - s.alpha) / Math.max(1e-3, D.alphaNegSoft - D.alphaNegLimit);
    if (under > 0 && !s.onGround) {
      const cut = 1 - smoothstep(0, 1, under);
      qCmd = Math.max(qCmd, qCmd * cut + (D.alphaNegSoft - s.alpha) * 0.9 * (1 - cut));
    }
    // Oran tavanı: sert kırpma yerine yumuşak doyum
    qCmd = softClamp(qCmd, -D.pitchRateMax, D.pitchRateMax, 0.25 * D.pitchRateMax);

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
    // (Eskiden "sinα > 0,05 ise" koşuluyla uygulanıyordu: düşük hızda α ≈ 2,9°'de tavan
    // basamak yapıyordu. sinα'nın tabanı 0,05'e sabitlenerek sürekli hale getirildi.)
    const sa = Math.abs(Math.sin(s.alpha));
    const NdrBudget = Math.max(1, s.qbar * D.S * D.span * Math.abs(D.Cndr)) * s.tailEff;
    const rBudget = clamp(NdrBudget / D.Izz * L.yawBudgetT, 0.05, D.yawRateMax * 3);
    // %20 pay kayma düzeltmesine (rCoord) bırakılır: koordinasyon bütçenin tamamını
    // kullanırsa sapma komutu tavana dayanır ve kayma açısı birkaç derecede takılı kalır.
    pMax = Math.min(pMax, 0.8 * rBudget / Math.max(sa, 0.05));
    // (d) ATALET ÇİFTLENİMİ: yatarken çekilirse (I_xx − I_yy)·p·q kadar bir sapma momenti
    //     doğar. 200 m/s'de tam çekip tam yatışta (p ≈ 275°/s, q ≈ 50°/s) bu ~665 kN·m'dir,
    //     yani dümenin TÜM yetkisi (~680 kN·m): koordinasyona pay kalmıyor, kayma açısı
    //     14°'ye çıkıyordu. Yatış tavanı, bu momenti dümen yetkisinin bir payıyla sınırlayacak
    //     şekilde |q| ile SÜREKLİ düşer (yunuslama yokken etkisizdir).
    const qAbs = Math.max(Math.abs(s.q), Math.abs(qCmd));
    pMax = Math.min(pMax, L.couplingShare * NdrBudget / (Math.abs(D.Ixx - D.Iyy) * Math.max(qAbs, 0.02)));
    let pvCmd = sr * pMax;                      // HIZ VEKTÖRÜ etrafında istenen oran
    // Yatış komutunun DEĞİŞİM hızı, dümenin kurabileceği sapma ivmesiyle sınırlanır: hız
    // vektörü etrafında yatmak ṙ = ṗ·sinα ister. Yüksek AoA'da yatış dümenden hızlı
    // başlarsa koordinasyon gecikir ve kayma açısı birikir. Düşük AoA'da (sinα küçük)
    // sınır çok geniştir; normal yatış tepkisi değişmez.
    const rAccMax = NdrBudget / D.Izz;
    const pSlew = Math.max(3, 0.7 * rAccMax / Math.max(sa, 0.1)) * dt;
    if (this._pvPrev === undefined) this._pvPrev = pvCmd;
    pvCmd = this._pvPrev + clamp(pvCmd - this._pvPrev, -pSlew, pSlew);
    this._pvPrev = pvCmd;

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
    // Tavan: koordinasyon bütçesi + kayma düzeltme yetkisi (düzeltme terimi kırpılmaz)
    const rLim = D.yawRateMax * 3 + L.betaAuth;
    rCmd = clamp(rCmd, -rLim, rLim);

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

    if (s.onGround) {
      // YERDE yunuslama ana takım ekseni etrafındadır (bkz. physics.js groundPitch):
      //   I_piv·q̇ = M_aero + M_yüzey − M_yer
      // Burun tekeri yerde ve rotasyon istenmiyorsa momenti teker taşır; stabilatör
      // çubuğu izler (yer kontrol kontrolü, görsel geri bildirim). Rotasyon istendiğinde
      // (qCmd > 0) ya da burun kalkıkken, yer tepkisi momenti de telafi edilerek oran
      // kanunu uygulanır. İki durum arasında komut sürekli harmanlanır.
      const direct = clamp(-sp, -1, 1);
      const Mreq = s.Ipiv * Kq * (qCmd - s.q) + s.Mgnd - s.Maero;
      const inv = clamp(-Mreq / Mde, -1, 1);
      const wInv = s.noseDown ? smoothstep(0, 0.6 * DEG, qCmd) : 1;
      this.cmd.de = direct + (inv - direct) * wInv;
      // Yatış ve sapma yerde kilitlidir (teker teması): yüzeyler çubuğu doğrudan izler
      this.cmd.da = clamp(st.roll, -1, 1);
      this.cmd.dr = clamp(-st.yaw, -1, 1);
      this._betaPrev = s.beta;
    } else {
      // İstenen açısal ivme -> gereken moment (aerodinamik ve atalet momentleri telafi edilir)
      const Mreq = D.Iyy * Kq * (qCmd - s.q) - s.Maero - s.Mgyro;
      const Lreq = D.Ixx * Kpp * (pCmd - s.p) - s.Laero - s.Lgyro;
      const Nreq = D.Izz * Krr * (rCmd - s.r) - s.Naero - s.Ngyro;
      // Yüzey komutu = gereken moment / birim yüzey momenti, ±1'e kırpılır
      this.cmd.de = clamp(-Mreq / Mde, -1, 1);     // Cmde negatif olduğu için işaret ters
      this.cmd.da = clamp(Lreq / Lda, -1, 1);
      this.cmd.dr = clamp(-Nreq / Ndr, -1, 1);
    }

    // ===================== EYLEYİCİ =====================
    // Birinci mertebe gecikme (τ = L.actuator) ve SONLU HIZ sınırı (L.surfRate birim/s):
    //   δ̇ = clamp((δ_cmd − δ)/τ, −R, R)
    // Eskiden önce hız sınırlı bir adım, ARDINDAN ayrı bir üstel adım uygulanıyordu;
    // ikinci adım hız sınırını aşıyordu (büyük komutlarda 8–18 birim/s ölçüldü) ve küçük
    // komutlarda yüzey hiç gecikmeden komuta atlıyordu. Artık tek bir adım: gecikmeli
    // hedefe doğru hareket, hız sınırıyla kırpılır.
    const rate = L.surfRate * dt;
    const kAct = 1 - Math.exp(-dt / L.actuator);
    for (let i = 0; i < 3; i++) {
      const k = SURF_KEYS[i];
      const step = (this.cmd[k] - this.sur[k]) * kAct;
      this.sur[k] = clamp(this.sur[k] + clamp(step, -rate, rate), -1, 1);
    }

    const g = this.dbg;   // yeniden kullanılır: 120 Hz döngüde tahsis yok
    g.qCmd = qCmd; g.pCmd = pCmd; g.rCmd = rCmd; g.pvCmd = pvCmd; g.pMax = pMax; g.nTarget = nTarget;
    g.nAvail = nAvail; g.nNeg = nNegAvail; g.aCmd = aCmd; g.wG = wG; g.wPA = wPA; g.auth = auth; g.aFac = aFac;
    g.over = over; g.under = under;
    return this.sur;
  }
}
