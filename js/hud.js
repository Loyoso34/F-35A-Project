// Yeşil HUD: hız, irtifa, baş, dikey hız, AoA, G, gaz, takım/flap, yunuslama merdiveni, uçuş yolu işareti.
import * as THREE from 'three';

// Havacılık yeşili: neon yerine hafif yumuşatılmış ton; koyu kenar gölgesiyle açık gökyüzünde de okunur
const GREEN = '#4cff7c';
const DIM = 'rgba(76,255,124,0.55)';
const AMBER = '#ffc46a', RED = '#ff6a5e';
const MONO = '"SF Mono", Menlo, Consolas, "Roboto Mono", monospace';
const SANS = '-apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif';
// Gösterge yumuşatma (s): yalnızca sayısal okumadaki titreşimi alır. Zaman sabitleri küçüktür,
// gerçek hızlı değişimler (dalış, pull-up) gecikmeden görünür. VSI gerçek uçakta da sönümlüdür.
const TAU_IAS = 0.12, TAU_VS = 0.30, TAU_ALT = 0.08;
// Radar altimetre gösterim sınırı (ft): üstünde AGL gizlenir (gerçek RA davranışı gibi)
const RA_MAX = 5000;
const DASH = [6, 4], SOLID = [];
// Binlik ayraçlı tamsayı (toLocaleString her karede pahalı ve tahsis yapıyor)
const thousands = (n) => { const s = String(Math.abs(n)); let o = ''; for (let i = 0; i < s.length; i++) { if (i && (s.length - i) % 3 === 0) o += ','; o += s[i]; } return n < 0 ? '-' + o : o; };
// Dış görünüm bilgi şeridi en fazla bu sıklıkta yeniden çizilir (s). Okunabilir
// sayısal göstergeler için 15 Hz yeterlidir; değişmeyen karede HİÇ çizilmez.
const EXT_INTERVAL = 1 / 15;

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.blink = 0;
    this.sm = null;           // yumuşatılmış gösterge değerleri
  }

  /** Gösterge değerlerini (kare hızından bağımsız) üstel olarak yumuşatır; ilk karede eşitler. */
  smooth(T, dt) {
    const s = this.sm || (this.sm = { ias: T.kias, vs: T.vsFpm, alt: T.altFt, agl: T.aglFt });
    const k = (tau) => 1 - Math.exp(-Math.max(0, Math.min(dt || 0.016, 0.1)) / tau);
    // Büyük sıçramada (yeniden başlatma, ışınlanma) doğrudan eşitle
    if (Math.abs(T.altFt - s.alt) > 2000 || Math.abs(T.kias - s.ias) > 150) { s.ias = T.kias; s.vs = T.vsFpm; s.alt = T.altFt; s.agl = T.aglFt; }
    s.ias += (T.kias - s.ias) * k(TAU_IAS);
    s.vs += (T.vsFpm - s.vs) * k(TAU_VS);
    s.alt += (T.altFt - s.alt) * k(TAU_ALT);
    s.agl += (T.aglFt - s.agl) * k(TAU_ALT);
    return s;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.mode = 'clear'; this.extKey = '';   // boyut atamak tuvali zaten temizler
  }

  project(worldPos, camera) {
    const v = this._v.copy(worldPos).project(camera);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, behind };
  }

  // Dış kameralar: üst ortada kompakt uçuş bilgisi şeridi. Alan genişlikleri ŞABLON metinden
  // ölçülür (ör. IAS '0000'): değerler değişince şerit genişlemez/daralmaz, yazılar zıplamaz.
  // ALT ortalama deniz seviyesine (MSL), RA ise ana teker tabanından araziye göredir (AGL);
  // RA yalnızca 5000 ft altında gösterilir.
  drawExternalInfo(T, opts) {
    const ctx = this.ctx; const { w } = this;
    const S = this.sm || T;
    const vs = Math.round((this.sm ? S.vs : T.vsFpm) / 50) * 50;
    const agl = this.sm ? S.agl : T.aglFt;
    const items = [
      ['IAS', String(Math.round(this.sm ? S.ias : T.kias)), 'KT', '0000'],
      ['ALT', thousands(Math.round(this.sm ? S.alt : T.altFt)), 'FT MSL', '00,000'],
    ];
    // RA: 100 ft üstünde 10 ft adımlarla (titremesin), altında 1 ft
    if (agl < RA_MAX) items.push(['RA', thousands(agl > 100 ? Math.round(agl / 10) * 10 : Math.round(agl)), 'FT', '0,000']);
    items.push(['VS', (vs > 0 ? '+' : vs < 0 ? '−' : '') + thousands(Math.abs(vs)), 'FPM', '+0,000']);
    items.push(['HDG', String(Math.round(T.heading) % 360 || 360).padStart(3, '0'), '°', '000']);
    const fL = `600 9px ${SANS}`, fV = `700 14px ${MONO}`, fU = `600 8px ${SANS}`;
    const gap = 16, padX = 12, hgt = 26;
    const widths = items.map(([l, , u, tpl]) => { ctx.font = fL; let x = ctx.measureText(l).width + 5; ctx.font = fV; x += ctx.measureText(tpl).width; if (u) { ctx.font = fU; x += 3 + ctx.measureText(u).width; } return x; });
    // Dar ekranda sığmayan alanlar sondan atılır (okunaklılık korunur)
    let n = items.length;
    const totalOf = (k) => widths.slice(0, k).reduce((a, b) => a + b, 0) + gap * (k - 1) + padX * 2;
    while (n > 2 && totalOf(n) > w - 2 * (opts.safe.left + opts.safe.right) - 120) n--;
    items.length = n; widths.length = n;
    const total = totalOf(n);
    const x0 = Math.round(w / 2 - total / 2), y0 = opts.safe.top + 8;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.fillStyle = 'rgba(14,17,21,0.66)'; ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x0, y0, total, hgt, 7); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'middle';
    let x = x0 + padX; const cy = y0 + hgt / 2 + 0.5;
    items.forEach(([l, v, u, tpl], i) => {
      ctx.textAlign = 'left';
      ctx.font = fL; ctx.fillStyle = 'rgba(214,222,230,0.58)'; ctx.fillText(l, x, cy); const lw = ctx.measureText(l).width + 5;
      ctx.font = fV; const vw = ctx.measureText(tpl).width;
      // değer sağa hizalı (sabit alan): basamak sayısı değişince yazı kaymaz
      ctx.textAlign = 'right'; ctx.fillStyle = GREEN; ctx.fillText(v, x + lw + vw, cy);
      let xe = x + lw + vw;
      if (u) { ctx.textAlign = 'left'; ctx.font = fU; ctx.fillStyle = 'rgba(214,222,230,0.45)'; ctx.fillText(u, xe + 3, cy + 1); xe += 3 + ctx.measureText(u).width; }
      if (i < items.length - 1) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(Math.round(xe + gap / 2), y0 + 6, 1, hgt - 12); }
      x = xe + gap;
    });
    ctx.restore();
    this.externalInfoDrawn = true;
    this.externalInfoBox = { x: x0, y: y0, w: total, h: hgt };
  }

  // Dış kameralarda yalnızca küçük, yeşil olmayan uyarılar (stall / takım)
  drawExternalWarnings(T, opts, on) {
    const ctx = this.ctx; const { w } = this;
    ctx.save();
    ctx.font = `700 12.5px ${SANS}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.85)'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 1;
    const y = opts.safe.top + 50;
    if (T.stall && on) { ctx.fillStyle = RED; ctx.fillText('STALL', w / 2, y); }
    else if (T.stallWarn && on) { ctx.fillStyle = AMBER; ctx.fillText('STALL WARNING', w / 2, y); }
    if (!T.onGround && T.gear < 0.99 && T.aglFt < 800 && T.kias < 200 && T.vsFpm < 0 && on) { ctx.fillStyle = AMBER; ctx.fillText('LANDING GEAR', w / 2, y + 18); }
    ctx.restore();
  }

  clear() {
    this.sm = null;
    if (this.mode === 'clear') return;      // seçim ekranında her karede çağrılır: boşsa dokunma
    const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h);
    this.mode = 'clear'; this.extKey = '';
  }

  // Dış görünüm: bilgi şeridi + uyarılar. Yalnızca gösterilen bir değer (ya da uyarı
  // yanıp sönme fazı) değiştiğinde ve en fazla 15 Hz ile yeniden çizilir; yalnızca
  // üst bant temizlenir. Değişmeyen karede tuval dokunulmaz, tarayıcı da onu yeniden
  // bileştirmek zorunda kalmaz.
  drawExternal(T, opts) {
    const ctx = this.ctx;
    const S = this.smooth(T, opts.dt);
    this.blink += opts.dt || 0.016;
    this.extAge = (this.extAge || 0) + (opts.dt || 0.016);
    const on = Math.floor(this.blink * 4) % 2 === 0;
    const warnStall = T.stall ? 2 : T.stallWarn ? 1 : 0;
    const warnGear = !T.onGround && T.gear < 0.99 && T.aglFt < 800 && T.kias < 200 && T.vsFpm < 0;
    const key = Math.round(S.ias) + '|' + Math.round(S.alt) + '|' + Math.round(S.vs / 50) + '|' + Math.round(T.heading) + '|' + (S.agl < RA_MAX ? Math.round(S.agl / 10) : -1)
      + '|' + warnStall + (warnGear ? 'g' : '') + ((warnStall || warnGear) && on ? '*' : '')
      + '|' + this.w + 'x' + this.h + '|' + opts.safe.top + ',' + opts.safe.left + ',' + opts.safe.right;
    if (this.mode === 'external' && key === this.extKey) return;
    if (this.mode === 'external' && this.extAge < EXT_INTERVAL) return;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this.mode === 'external') ctx.clearRect(0, 0, this.w, Math.min(this.h, opts.safe.top + 96));
    else ctx.clearRect(0, 0, this.w, this.h);
    this.mode = 'external'; this.extKey = key; this.extAge = 0;
    this.drawExternalInfo(T, opts);
    this.drawExternalWarnings(T, opts, on);
  }

  draw(T, camera, fm, opts) {
    const ctx = this.ctx;
    const { w, h } = this;
    if (!T) { this.clear(); return; }
    // Dış kameralar: HUD yerine kompakt uçuş bilgisi şeridi
    if (opts.externalOnly) { this.drawExternal(T, opts); return; }
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    this.mode = 'cockpit'; this.extKey = '';
    if (!opts.visible) return;
    const S = this.smooth(T, opts.dt);
    this.blink += opts.dt || 0.016;
    ctx.save();
    ctx.font = `bold 14px ${MONO}`;
    ctx.fillStyle = GREEN; ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
    // Okunurluk için koyu gölge: bulanıklık (shadowBlur) her çizimde Gauss süzgeci
    // demektir ve HUD'da kare başına ~40 çizim var. 1 px kaydırılmış keskin gölge
    // aynı kontrastı çok daha ucuza verir.
    ctx.shadowColor = 'rgba(0,0,0,0.75)'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 1; ctx.shadowOffsetY = 1;
    ctx.textBaseline = 'middle';

    const insetL = opts.safe.left + 8, insetR = opts.safe.right + 8, insetT = opts.safe.top + 8, insetB = opts.safe.bottom + 8;
    const cx = w / 2, cy = h / 2;
    const compact = w < 700;

    // ---- Yunuslama merdiveni: burun doğrultusu etrafında ----
    const fwd = this._v2.set(0, 0, -1).applyQuaternion(fm.quat);
    const nosePt = this.project(this._v.copy(fm.pos).addScaledVector(fwd, 400), camera);
    const vfov = (camera.fov * Math.PI) / 180;
    const ppd = ((h / 2) / Math.tan(vfov / 2)) * (Math.PI / 180); // piksel / derece
    const rollRad = (T.roll * Math.PI) / 180;
    const bx = nosePt.behind ? cx : Math.min(Math.max(nosePt.x, w * 0.25), w * 0.75);
    const by = nosePt.behind ? cy : Math.min(Math.max(nosePt.y, h * 0.2), h * 0.8);
    ctx.save();
    // Kırpma: merdiven yalnızca orta bölgede
    ctx.beginPath(); ctx.rect(cx - 150, insetT + 78, 300, h - insetT - insetB - 140); ctx.clip();
    ctx.translate(bx, by);
    ctx.rotate(-rollRad);
    const ladderW = compact ? 52 : 70;
    for (let deg = -90; deg <= 90; deg += 10) {
      if (deg === 0) continue;
      const y = (T.pitch - deg) * ppd;
      if (Math.abs(y) > h * 0.6) continue;
      ctx.beginPath();
      ctx.setLineDash(deg < 0 ? DASH : SOLID);
      ctx.moveTo(-ladderW, y); ctx.lineTo(-26, y);
      ctx.moveTo(26, y); ctx.lineTo(ladderW, y);
      // Uç işaretleri: pozitifte aşağı, negatifte yukarı
      const tick = deg > 0 ? 8 : -8;
      ctx.moveTo(-ladderW, y); ctx.lineTo(-ladderW, y + tick);
      ctx.moveTo(ladderW, y); ctx.lineTo(ladderW, y + tick);
      ctx.stroke();
      ctx.setLineDash(SOLID);
      ctx.textAlign = 'right'; ctx.fillText(String(Math.abs(deg)), -ladderW - 4, y);
      ctx.textAlign = 'left'; ctx.fillText(String(Math.abs(deg)), ladderW + 4, y);
    }
    // Ufuk çizgisi
    const yh = T.pitch * ppd;
    ctx.beginPath(); ctx.moveTo(-ladderW * 2.2, yh); ctx.lineTo(-40, yh); ctx.moveTo(40, yh); ctx.lineTo(ladderW * 2.2, yh); ctx.stroke();
    ctx.restore();

    // Su hattı (burun) işareti
    ctx.beginPath();
    ctx.moveTo(bx - 22, by); ctx.lineTo(bx - 8, by); ctx.lineTo(bx - 4, by + 6); ctx.lineTo(bx, by); ctx.lineTo(bx + 4, by + 6); ctx.lineTo(bx + 8, by); ctx.lineTo(bx + 22, by);
    ctx.stroke();

    // ---- Uçuş yolu işareti (hız vektörü) ----
    if (T.tas > 3) {
      const dir = this._v2.copy(fm.vel).normalize();
      const p = this.project(this._v.copy(fm.pos).addScaledVector(dir, 400), camera);
      if (!p.behind) {
        const px = Math.min(Math.max(p.x, 30), w - 30), py = Math.min(Math.max(p.y, insetT + 30), h - insetB - 30);
        ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(px - 7, py); ctx.lineTo(px - 18, py);
        ctx.moveTo(px + 7, py); ctx.lineTo(px + 18, py);
        ctx.moveTo(px, py - 7); ctx.lineTo(px, py - 14);
        ctx.stroke();
      }
    }

    // ---- Hız kutusu (sol) ----
    const boxW = compact ? 74 : 86, boxH = 30;
    const lx = compact ? cx - 168 : cx - 210;
    const rx = compact ? cx + 168 - boxW : cx + 210 - boxW;
    const rowY = cy - 10;
    ctx.textAlign = 'right';
    ctx.strokeRect(lx, rowY - boxH / 2, boxW, boxH);
    ctx.font = `bold 18px ${MONO}`;
    ctx.fillText(String(Math.round(S.ias)), lx + boxW - 6, rowY);
    ctx.font = `bold 12px ${MONO}`;
    ctx.fillText('KIAS', lx + boxW - 6, rowY - boxH / 2 - 9);
    ctx.fillText('M ' + T.mach.toFixed(2), lx + boxW - 6, rowY + boxH / 2 + 10);
    ctx.fillText('AoA ' + T.alpha.toFixed(1) + '°', lx + boxW - 6, rowY + boxH / 2 + 26);
    ctx.fillText('G ' + T.g.toFixed(1), lx + boxW - 6, rowY + boxH / 2 + 42);

    // ---- İrtifa kutusu (sağ) ----
    ctx.textAlign = 'left';
    ctx.strokeRect(rx, rowY - boxH / 2, boxW, boxH);
    ctx.font = `bold 18px ${MONO}`;
    ctx.fillText(thousands(Math.round(S.alt)), rx + 6, rowY);
    ctx.font = `bold 12px ${MONO}`;
    ctx.fillText('ALT MSL', rx + 6, rowY - boxH / 2 - 9);
    const vs = Math.round(S.vs / 50) * 50;
    ctx.fillText('VS ' + (vs > 0 ? '+' : '') + vs, rx + 6, rowY + boxH / 2 + 10);
    // Radar altimetre (AGL, ana teker tabanından): 5000 ft altında "R" ile gösterilir
    ctx.fillText(S.agl < RA_MAX ? 'R ' + thousands(S.agl > 100 ? Math.round(S.agl / 10) * 10 : Math.round(S.agl)) : 'R ----', rx + 6, rowY + boxH / 2 + 26);
    ctx.fillText('HDG ' + String(Math.round(T.heading) % 360 || 360).padStart(3, '0'), rx + 6, rowY + boxH / 2 + 42);

    // ---- Baş bandı (üst) ----
    const tapeY = insetT + 62;
    const tapeW = compact ? 200 : 260;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - tapeW / 2, tapeY - 16, tapeW, 34); ctx.clip();
    const pxPerDeg = tapeW / 60;
    for (let d = -40; d <= 40; d += 5) {
      const hd = Math.round(T.heading / 5) * 5 + d;
      const x = cx + (hd - T.heading) * pxPerDeg;
      const major = hd % 10 === 0;
      ctx.beginPath(); ctx.moveTo(x, tapeY + 4); ctx.lineTo(x, tapeY + (major ? 12 : 8)); ctx.stroke();
      if (major) {
        const hh = ((hd % 360) + 360) % 360;
        const label = hh === 0 ? 'N' : hh === 90 ? 'E' : hh === 180 ? 'S' : hh === 270 ? 'W' : String(hh / 10).padStart(2, '0');
        ctx.textAlign = 'center'; ctx.fillText(label, x, tapeY - 6);
      }
    }
    ctx.restore();
    ctx.beginPath(); ctx.moveTo(cx, tapeY + 14); ctx.lineTo(cx - 5, tapeY + 22); ctx.lineTo(cx + 5, tapeY + 22); ctx.closePath(); ctx.fill();

    // ---- Alt bilgi: gaz, takım, flap, fren ----
    ctx.textAlign = 'left';
    const infoY = h - insetB - (compact ? 74 : 86);
    const thrTxt = T.ab > 0.05 ? 'THR AB' : 'THR ' + Math.round(T.throttle * 100) + '%';
    ctx.fillStyle = T.ab > 0.05 ? '#ffa040' : GREEN;
    ctx.fillText(thrTxt, lx, infoY);
    ctx.fillStyle = GREEN;
    ctx.fillText('ENG ' + Math.round(T.engine * 100) + '%', lx, infoY + 16);
    const gearTxt = T.gear >= 0.99 ? 'GEAR DN' : T.gear <= 0.01 ? 'GEAR UP' : 'GEAR ···';
    ctx.fillStyle = T.gear > 0.01 && T.gear < 0.99 ? '#ffd35a' : GREEN;
    ctx.fillText(gearTxt, lx, infoY + 32);
    ctx.fillStyle = GREEN;
    let flags = [];
    if (T.flaps > 0.05) flags.push('FLAP ' + Math.round(T.flaps * 100) + '%');
    if (T.brakes) flags.push('BRK');
    if (flags.length) ctx.fillText(flags.join('  '), lx, infoY + 48);
    ctx.textAlign = 'right';
    ctx.fillText('FUEL ' + thousands(Math.round(T.fuelKg)) + ' kg', rx + boxW, infoY);
    // Silah durumu: kalan füze, sıradaki/meşgul/engelli
    if (opts.weapons) {
      const wpn = opts.weapons;
      ctx.fillStyle = wpn.count === 0 ? DIM : wpn.inhibit ? DIM : GREEN;
      ctx.fillText('AIM-120 ' + wpn.count + (wpn.pending ? ' Q' : wpn.inhibit ? ' SAFE' : wpn.busy ? ' …' : ' RDY'), rx + boxW, infoY + 16);
      ctx.fillStyle = GREEN;
    }
    if (opts.cameraName) ctx.fillText(opts.cameraName, rx + boxW, infoY + (opts.weapons ? 32 : 16));

    // ---- Uyarılar ----
    ctx.textAlign = 'center';
    ctx.font = `bold 20px ${MONO}`;
    const on = Math.floor(this.blink * 4) % 2 === 0;
    if (T.stall && on) { ctx.fillStyle = RED; ctx.fillText('STALL', cx, cy + 70); }
    else if (T.stallWarn) { ctx.fillStyle = AMBER; ctx.font = `bold 14px ${MONO}`; ctx.fillText('AoA ' + (on ? '▲' : '△') + ' STALL WARN', cx, cy + 70); }
    if (!T.onGround && T.gear < 0.99 && T.aglFt < 800 && T.kias < 200 && T.vsFpm < 0 && on) { ctx.fillStyle = AMBER; ctx.font = `bold 20px ${MONO}`; ctx.fillText('GEAR', cx, cy + 94); }
    ctx.restore();
  }
}
