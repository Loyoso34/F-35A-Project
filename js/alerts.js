// Uçuş uyarıları (v5.1): yere yaklaşma (Auto-GCAS / GPWS benzeri), yakıt ve motor. HUD, dış kamera
// şeridi ve ses aynı durumu okur; hesap tek yerdedir.
//
// Yere yaklaşma — TOPARLANMA YÖRÜNGESİ yöntemi (F-35 Auto-GCAS mantığı; kumandaya DOKUNULMAZ, yalnızca
// uyarı verilir). Düz bir "çarpmaya kalan süre" eşiği yanıltıcıdır: 600 m'den 25°'lik dalış 5 g çekişle
// rahatça toparlanır, oysa tepeye doğru düz uçuşta uyarının çok daha erken gelmesi gerekir. Bu yüzden
// her değerlendirmede şu manevra uçağın yer izinin düşey düzleminde benzetilir:
//   1) tepki gecikmesi boyunca mevcut yörünge sürer,
//   2) kanatlar yatışa göre düzeltilir (yatış / 150°/s),
//   3) kullanılabilir yük katsayısıyla (en fazla 5 g; düşük hızda taşıma sınırlı) 25°'lik tırmanışa çekilir.
// Yörünge LOOK saniye boyunca zeminden (arazi ya da deniz) MARGIN m yukarıda kalmıyorsa:
//   PULL UP  (kırmızı):  gecikme 1,6 s ile bile çarpıyor — hemen çek
//   TERRAIN  (kehribar): gecikme 5 s ile çarpıyor — yakında çekmek gerekecek
// Yüksek yapılar (kule, kale, meydan binaları) düz yörünge boyunca çarpışma sorgusuyla: 3,5 s / 6,5 s.
// İniş düzeninde (takım aşağı, yol açısı > −7°, alçalma < 2000 ft/dk) ve 50 ft altında uyarı verilmez:
// her yaklaşma piste doğru bir "çarpma" yörüngesidir.
//
// Yakıt: LOW FUEL < 1200 kg (≈ iç yakıtın %15'i; tam AB'de ~2 dk, askeri güçte ~9 dk), motor sönünce
// ENGINE OUT. Uyarı bayrakları histerezislidir (eşik çevresinde yanıp sönmez).
import { WATER_LEVEL } from './world.js';

export const FUEL_LOW_KG = 1200;
const LOOK = 10;            // s, ileri bakış ufku
const STEP = 0.3;           // s, yörünge örnek aralığı
const MARGIN = 12;          // m, yörünge ile zemin arasında istenen pay (gövde + takım)
const D_PULL = 1.6, D_TERRAIN = 5.0;   // s, tepki gecikmeleri
const N_MAX = 5, CLIMB = 25 * Math.PI / 180, ROLL_RATE = 150 * Math.PI / 180;
const S_REF = 42.7, CL_MAX = 1.8;   // kullanılabilir yük katsayısı tahmini (kanat alanı, flaplı en büyük CL ≈)
const G = 9.81;
const RATE = 1 / 10;        // s, değerlendirme aralığı (10 Hz yeterli; kare başına maliyet yok)
// Uyarı satırları (sabit diziler: HUD her kare okur, tahsis yok)
const PULL_UP = Object.freeze(['PULL UP', 'red', true]), STALL = Object.freeze(['STALL', 'red', true]);
const ENGINE_OUT = Object.freeze(['ENGINE OUT', 'red', false]), TERRAIN = Object.freeze(['TERRAIN', 'amber', true]);
const STALL_WARN = Object.freeze(['STALL WARNING', 'amber', true]), GEAR = Object.freeze(['LANDING GEAR', 'amber', true]);
const LOW_FUEL = Object.freeze(['LOW FUEL', 'amber', false]);

export class FlightAlerts {
  constructor() { this.reset(); }

  reset() {
    this.tti = Infinity;
    this.pullUp = false; this.terrain = false;
    this.fuelLow = false; this.flameout = false; this.gearWarn = false;
    this._acc = RATE;        // ilk güncellemede hemen değerlendir
    this.events = [];        // yeni tetiklenen uyarılar (bildirim/ses için tek seferlik)
  }

  /** Düz yörünge boyunca çarpmaya kalan süre (s); yoksa Infinity. (Teşhis/gösterim için.) */
  timeToImpact(fm, world) {
    const p = fm.pos, v = fm.vel;
    if (v.length() < 25) return Infinity;
    for (let t = STEP; t <= LOOK + 1e-6; t += STEP) {
      const x = p.x + v.x * t, z = p.z + v.z * t, y = p.y + v.y * t;
      if (y < Math.max(world.heightAt(x, z), WATER_LEVEL) + MARGIN) return t;
    }
    return Infinity;
  }

  /**
   * Gecikmeli toparlanma manevrası (bkz. başlık) zemine çarpıyor mu? Çarpıyorsa çarpma anı (s), yoksa -1.
   */
  recoveryHit(fm, world, delay) {
    const p = fm.pos, v = fm.vel, T = fm.telemetry;
    const vh = Math.hypot(v.x, v.z), V = Math.hypot(vh, v.y);
    if (V < 25) return -1;
    const dx = vh > 1 ? v.x / vh : 0, dz = vh > 1 ? v.z / vh : 0;
    let gam = Math.atan2(v.y, vh);
    const n = Math.max(1, Math.min(N_MAX, (T.qbar || 0) * S_REF * CL_MAX / (fm.mass * G)));
    const t0 = delay + Math.abs(T.roll || 0) * Math.PI / 180 / ROLL_RATE;
    let x = p.x, z = p.z, y = p.y;
    for (let t = STEP; t <= LOOK + 1e-6; t += STEP) {
      if (t > t0 && gam < CLIMB) gam = Math.min(CLIMB, gam + (n - Math.cos(gam)) * G / V * STEP);
      const c = Math.cos(gam);
      x += dx * V * c * STEP; z += dz * V * c * STEP; y += V * Math.sin(gam) * STEP;
      if (y < Math.max(world.heightAt(x, z), WATER_LEVEL) + MARGIN) return t;
    }
    return -1;
  }

  /** Düz yörüngede ilk H saniye içinde yapıya çarpma anı (s), yoksa -1. */
  obstacleHit(fm, world, H) {
    if (!world.segmentHit) return -1;
    const p = fm.pos, v = fm.vel;
    const b = this._b || (this._b = p.clone());
    b.set(p.x + v.x * H, p.y + v.y * H, p.z + v.z * H);
    const s = world.segmentHit(p, b);
    return s >= 0 && s <= 1 ? s * H : -1;
  }

  /**
   * fm: FlightModel, world: heightAt sağlayan dünya. Telemetri bayraklarını günceller ve yeni
   * tetiklenen uyarıları this.events'e yazar ('pullUp' | 'terrain' | 'fuelLow' | 'flameout' | 'gear').
   */
  update(dt, fm, world) {
    this.events.length = 0;
    const T = fm.telemetry;
    // ---- Yakıt / motor ----
    const low = this.fuelLow ? fm.fuel < FUEL_LOW_KG + 60 : fm.fuel < FUEL_LOW_KG;
    if (low && !this.fuelLow && fm.fuel > 0) this.events.push('fuelLow');
    this.fuelLow = low && fm.fuel > 0;
    const out = fm.fuel <= 0;
    if (out && !this.flameout) this.events.push('flameout');
    this.flameout = out;
    // ---- Takım uyarısı: alçakta, yavaş, alçalırken takım yukarıda (iniş unutulmuş) ----
    const gw = !fm.crashed && !T.onGround && T.gear < 0.99 && T.aglFt < 800 && T.kias < 200 && T.vsFpm < 0;
    if (gw && !this.gearWarn) this.events.push('gear');
    this.gearWarn = gw;
    // ---- Yere yaklaşma (10 Hz) ----
    this._acc += dt;
    if (this._acc < RATE) return;
    this._acc = 0;
    if (fm.crashed || fm.onGround || !world || T.aglFt < 50) { this.tti = Infinity; this.setGpws(false, false); return; }
    // İniş düzeni: takım aşağı, yol açısı sığ (> −7°) ve alçalma 2000 ft/dk'nın altında
    const V = fm.vel.length() || 1;
    const gammaDeg = Math.asin(Math.max(-1, Math.min(1, fm.vel.y / V))) * 57.2958;
    const landing = fm.gearCmd > 0.5 && fm.gearPos > 0.9 && gammaDeg > -7 && T.vsFpm > -2000;
    if (landing) { this.setGpws(false, false); return; }
    this.tti = this.timeToImpact(fm, world);
    // Histerezis: etkin uyarı biraz daha uzun gecikmeyle (daha temkinli) değerlendirilir
    const ob = this.obstacleHit(fm, world, this.terrain || this.pullUp ? 7.5 : 6.5);
    const pull = this.recoveryHit(fm, world, D_PULL + (this.pullUp ? 0.6 : 0)) >= 0 || (ob >= 0 && ob < (this.pullUp ? 4.2 : 3.5));
    const terr = !pull && (this.recoveryHit(fm, world, D_TERRAIN + (this.terrain ? 1 : 0)) >= 0 || ob >= 0);
    this.setGpws(pull, terr);
  }

  setGpws(pull, terr) {
    if (pull && !this.pullUp) this.events.push('pullUp');
    else if (terr && !this.terrain && !this.pullUp) this.events.push('terrain');
    this.pullUp = pull; this.terrain = terr;
  }

  /** HUD/şerit için: öncelik sırasıyla etkin uyarılar [metin, 'red'|'amber', yanıp sönsün mü]. */
  list(T, out = []) {
    out.length = 0;
    if (this.pullUp) out.push(PULL_UP);
    if (T.stall) out.push(STALL);
    if (this.flameout) out.push(ENGINE_OUT);
    if (this.terrain) out.push(TERRAIN);
    if (!T.stall && T.stallWarn) out.push(STALL_WARN);
    if (this.gearWarn) out.push(GEAR);
    if (this.fuelLow) out.push(LOW_FUEL);
    return out;
  }
}
