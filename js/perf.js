// Uyarlanabilir kalite: 60 fps hedefi tutturulamadığında ÖNCE ikincil efektler,
// en son (ve yumuşak adımlarla) çözünürlük düşer. Uçak modeli hiçbir kademede
// değişmez.
//
// Kademe sırası (her biri bir öncekinin üstüne eklenir):
//   1  uzak gölgeler   — gölge kamerası daralır: uzaktaki gölge düşürücüler gölge
//                         geçişine girmez (yakın gölgeler ve uçağın gölgesi kalır)
//   2  bulut yoğunluğu — bulut örneklerinin bir kısmı çizilmez (saydam örtüşme azalır)
//   3  çevre detayı    — ağaç ve ayrıntılı arazi mesafeleri kısalır
//   4  ikincil efektler — bulutlar daha da seyrekleşir, şehir katmanları ve trafik
//                         daha yakında kapanır
//   5+ çözünürlük      — render ölçeği %5'lik adımlarla, en fazla %80'e kadar
//
// Hiçbir kademe gölgelendirici programını değiştiren bir şeye (ışık sayısı,
// shadowMap.enabled, receiveShadow) dokunmaz: kademe değişimi takılma üretmez.
//
// Karar ölçütü ORTALAMA değil, kare dağılımıdır: 2 s'lik pencerede kareler
// hedef aralığın %20 üstüne sık sık çıkıyorsa (kare atlama) bir kademe düşülür.
// Geri yükselme 8 s boyunca temiz kare ister; yükselttikten kısa süre sonra yine
// düşmek zorunda kalınırsa o kademe için bekleme süresi ikiye katlanır (salınım yok).

export const QUALITY_TIERS = ['full', 'nearShadows', 'clouds', 'detail', 'effects'];
const RES_STEPS = [1, 0.95, 0.9, 0.85, 0.8];
const MAX_TIER = QUALITY_TIERS.length - 1 + (RES_STEPS.length - 1);

/** Kademenin dünya çarpanları (world.setPerf'e verilir). 1 = tam kalite. */
export function perfMultipliers(tier) {
  return {
    shadow: tier >= 1 ? 0.62 : 1,
    clouds: tier >= 4 ? 0.35 : tier >= 2 ? 0.6 : 1,
    detail: tier >= 3 ? 0.78 : 1,
    effects: tier >= 4 ? 0.7 : 1,
  };
}

export class AdaptiveQuality {
  /**
   * @param {object} hooks  apply(tier, renderScale) — kademe değişince çağrılır
   */
  constructor(hooks) {
    this.hooks = hooks;
    this.tier = 0;
    this.win = 0; this.winSlow = 0; this.winN = 0; this.winSum = 0;
    this.good = 0;
    this.holdUntil = 0;            // bu zamana kadar yükselme denenmez
    this.backoff = 8;              // s, yükselme için gereken temiz süre
    this.lastUpAt = -1e9;
    this.clock = 0;
  }

  get renderScale() { return RES_STEPS[Math.max(0, this.tier - (QUALITY_TIERS.length - 1))]; }
  get label() {
    const n = QUALITY_TIERS.length - 1;
    return this.tier <= n ? QUALITY_TIERS[this.tier] : 'res' + Math.round(this.renderScale * 100);
  }

  reset() {
    this.win = this.winSlow = this.winN = this.winSum = 0;
    this.good = 0;
  }

  /** Oyun çalışırken her çizilen karede çağrılır. dt saniye, targetMs hedef kare aralığı. */
  sample(dt, targetMs) {
    const ms = dt * 1000;
    // Arka plandan dönüş, duraklatma, sekme değişimi: ölçüme alınmaz
    if (!(ms > 0) || ms > 250) return;
    this.clock += dt;
    this.win += dt; this.winN++; this.winSum += ms;
    if (ms > targetMs * 1.2) this.winSlow++;
    if (this.win < 2) return;
    const slowFrac = this.winSlow / this.winN;
    const mean = this.winSum / this.winN;
    this.win = this.winSlow = this.winN = this.winSum = 0;
    if ((slowFrac > 0.12 || mean > targetMs * 1.1) && this.tier < MAX_TIER) {
      // Yükseltmeden hemen sonra düşüyorsak bu seviye sürdürülemiyor: bekleme uzar
      if (this.clock - this.lastUpAt < 12) this.backoff = Math.min(120, this.backoff * 2);
      this.set(this.tier + 1);
      this.good = 0;
      return;
    }
    if (slowFrac < 0.03 && mean < targetMs * 1.04) this.good += 2; else this.good = 0;
    if (this.tier > 0 && this.good >= this.backoff) {
      this.set(this.tier - 1);
      this.lastUpAt = this.clock;
      this.good = 0;
    }
  }

  set(tier) {
    tier = Math.max(0, Math.min(MAX_TIER, tier));
    if (tier === this.tier) return;
    this.tier = tier;
    this.hooks.apply(this.tier, this.renderScale);
  }
}
