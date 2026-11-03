// Kokpit panoramik ekranı (PCD, v5.1): CANLI. Eskiden sabit bir dokuydu ("FUEL 8300 kg", "RPM 68%"
// hiç değişmiyordu). Dört portal:
//   TSD  — yön yukarı taktik durum: dönen pusula gülü, menzil halkaları (10/20/40 km), ana meydana
//          (LTFE) yön oku ve yazıyla kerteriz/uzaklık — LOW FUEL uyarısında eve dönüş için.
//   ADI  — yapay ufuk: yatış ve yunuslama (±30° pencere), uçak sembolü.
//   ENG  — devir, FTIT (yaklaşık), nozul, gaz; art yakıcı ve motor sönmesi göstergesi.
//   FUEL — iki tank çubuğu, kalan kg; azalınca kehribar, bitince kırmızı.
// Üst şeritteki menü hücreleri uyarı durumunda renklenir (ENG kırmızı, FUEL kehribar…).
// Yalnızca kokpit kamerası etkinken ve en fazla 6 Hz ile yeniden çizilir (doku yükleme maliyeti sınırlı);
// sabit kısımlar bir kez ayrı tuvale çizilir ve her karede kopyalanır.
import * as THREE from 'three';

const W0 = 1024, H0 = 384, PAD = 26;
const C_LINE = '#3f5a6e', C_SYM = '#5cc2ff', C_TXT = '#8fd3ff', C_WHITE = '#e9f3fb';
const C_GREEN = '#39ff6a', C_AMBER = '#ffc46a', C_RED = '#ff5a4e';
const RATE = 1 / 6;
const FUEL_FULL = 8300;

export class CockpitDisplay {
  constructor(w = W0, h = H0) {
    this.w = w; this.h = h;
    this.canvas = document.createElement('canvas'); this.canvas.width = w; this.canvas.height = h;
    this.ctx = this.canvas.getContext('2d');
    this.bg = document.createElement('canvas'); this.bg.width = w; this.bg.height = h;
    this.drawStatic(this.bg.getContext('2d'));
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.acc = RATE;
    this.draw(null, null);
    this.texture.needsUpdate = true;
  }

  get rows() { return [PAD, this.h * 0.22, this.h - PAD]; }

  drawStatic(ctx) {
    const { w, h } = this, rows = this.rows;
    ctx.fillStyle = '#0b0d10'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#0f1a24'; ctx.fillRect(PAD, PAD, w - PAD * 2, h - PAD * 2);
    ctx.strokeStyle = C_LINE; ctx.lineWidth = 2;
    ctx.strokeRect(PAD, PAD, w - PAD * 2, h - PAD * 2);
    ctx.beginPath(); ctx.moveTo(w * 0.5, PAD); ctx.lineTo(w * 0.5, h - PAD); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(PAD, rows[1]); ctx.lineTo(w - PAD, rows[1]); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w * 0.25, rows[1]); ctx.lineTo(w * 0.25, h - PAD); ctx.moveTo(w * 0.75, rows[1]); ctx.lineTo(w * 0.75, h - PAD); ctx.stroke();
    // Bezel yansıması
    ctx.strokeStyle = '#2c3138'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, w - 12, h - 12);
  }

  /** dt: s; T: telemetri; info: { alerts, pos, home: {x, z, name} }. 6 Hz ile çizer. */
  update(dt, T, info) {
    this.acc += dt;
    if (this.acc < RATE) return;
    this.acc = 0;
    this.draw(T, info);
    this.texture.needsUpdate = true;
  }

  draw(T, info) {
    const ctx = this.ctx, { w, h } = this, rows = this.rows;
    ctx.drawImage(this.bg, 0, 0);
    const A = info && info.alerts;
    const fuel = T ? T.fuelKg : FUEL_FULL;
    const out = !!(T && T.flameout), low = !!(A && A.fuelLow);
    // ---- Üst şerit: menü hücreleri, uyarıda renkli ----
    const menu = ['TSD', 'SMS', 'FCS', 'DAS', 'CNI', 'ENG', 'FUEL', 'CKLST'];
    const cellW = (w - PAD * 2) / menu.length;
    ctx.font = 'bold 22px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const cy0 = (PAD + rows[1]) / 2;
    menu.forEach((t, i) => {
      let col = C_TXT, fill = null;
      if (t === 'ENG' && out) { col = '#1a0505'; fill = C_RED; }
      else if (t === 'FUEL' && (out || low)) { col = '#1a1205'; fill = out ? C_RED : C_AMBER; }
      else if (t === 'FCS' && A && (A.pullUp || (T && T.stall))) { col = '#1a0505'; fill = C_RED; }
      else if (t === 'CNI' && A && A.terrain) { col = '#1a1205'; fill = C_AMBER; }
      const x = PAD + (i + 0.5) * cellW;
      if (fill) { ctx.fillStyle = fill; ctx.fillRect(x - cellW / 2 + 6, PAD + 8, cellW - 12, rows[1] - PAD - 16); }
      ctx.fillStyle = col; ctx.fillText(t, x, cy0);
    });
    const cy = (rows[1] + rows[2]) / 2;
    this.drawTSD(ctx, w * 0.125, cy, T, info);
    this.drawADI(ctx, w * 0.375, cy, T);
    this.drawENG(ctx, w * 0.625, cy, T, info);
    this.drawFuel(ctx, w * 0.875, cy, fuel, low, out);
  }

  drawTSD(ctx, cx, cy, T, info) {
    const hdg = T ? (T.hdgMag !== undefined ? T.hdgMag : T.heading) : 0;
    const R = 100;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - 120, cy - 118, 240, 236); ctx.clip();
    ctx.strokeStyle = C_SYM; ctx.lineWidth = 2;
    for (const r of [25, 50, 100]) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
    // Pusula gülü (yön yukarı): 30°'de bir çentik, ana yönler harfli
    ctx.font = 'bold 18px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let d = 0; d < 360; d += 30) {
      const a = (d - hdg) * Math.PI / 180, sx = Math.sin(a), sy = -Math.cos(a);
      ctx.beginPath(); ctx.moveTo(cx + sx * R, cy + sy * R); ctx.lineTo(cx + sx * (R - 9), cy + sy * (R - 9)); ctx.stroke();
      const lbl = d === 0 ? 'N' : d === 90 ? 'E' : d === 180 ? 'S' : d === 270 ? 'W' : '';
      if (lbl) { ctx.fillStyle = d === 0 ? C_WHITE : C_SYM; ctx.fillText(lbl, cx + sx * (R - 22), cy + sy * (R - 22)); }
    }
    // Ana meydan: kerteriz ve uzaklık (ölçek: dış halka 40 km)
    if (T && info && info.pos && info.home) {
      const dx = info.home.x - info.pos.x, dz = info.home.z - info.pos.z;
      const dist = Math.hypot(dx, dz);
      const grid = Math.atan2(dx, -dz) * 180 / Math.PI;
      const brg = ((grid + (hdg - T.heading)) % 360 + 360) % 360;   // ızgara -> manyetik (HUD ile aynı fark)
      const a = (brg - hdg) * Math.PI / 180, sx = Math.sin(a), sy = -Math.cos(a);
      const rr = Math.min(R - 4, dist / 40000 * R);
      ctx.fillStyle = C_GREEN; ctx.strokeStyle = C_GREEN;
      if (dist / 40000 * R < R - 4) {
        // meydan sembolü (küçük kare + pist çizgisi)
        const px = cx + sx * rr, py = cy + sy * rr;
        ctx.strokeRect(px - 6, py - 6, 12, 12);
      } else {
        // ufukta yön oku
        ctx.beginPath();
        ctx.moveTo(cx + sx * (R + 2), cy + sy * (R + 2));
        ctx.lineTo(cx + sx * (R - 14) - sy * 7, cy + sy * (R - 14) + sx * 7);
        ctx.lineTo(cx + sx * (R - 14) + sy * 7, cy + sy * (R - 14) - sx * 7);
        ctx.closePath(); ctx.fill();
      }
      ctx.font = 'bold 17px Arial'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
      ctx.fillText(`${info.home.name} ${String(Math.round(brg) % 360 || 360).padStart(3, '0')}° ${(dist / 1852).toFixed(dist < 18520 ? 1 : 0)} NM`, cx - 116, cy + 112);
    }
    ctx.restore();
    // Uçak sembolü + yön yazısı
    ctx.fillStyle = C_SYM;
    ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx - 8, cy + 8); ctx.lineTo(cx + 8, cy + 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = C_WHITE; ctx.font = 'bold 20px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillText(String(Math.round(hdg) % 360 || 360).padStart(3, '0'), cx, cy - 100);
  }

  drawADI(ctx, ax, cy, T) {
    const pitch = T ? T.pitch : 0, roll = T ? T.roll : 0;
    const k = 100 / 30;   // px/derece
    ctx.save();
    ctx.beginPath(); ctx.rect(ax - 100, cy - 100, 200, 200); ctx.clip();
    ctx.translate(ax, cy); ctx.rotate(-roll * Math.PI / 180); ctx.translate(0, pitch * k);
    ctx.fillStyle = '#2a6cb0'; ctx.fillRect(-300, -600, 600, 600);
    ctx.fillStyle = '#6b4a2a'; ctx.fillRect(-300, 0, 600, 600);
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-300, 0); ctx.lineTo(300, 0); ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 14px Arial'; ctx.textBaseline = 'middle';
    for (let d = -60; d <= 60; d += 10) {
      if (!d) continue;
      const y = -d * k, half = d % 20 === 0 ? 34 : 18;
      ctx.beginPath(); ctx.moveTo(-half, y); ctx.lineTo(half, y); ctx.stroke();
      if (d % 20 === 0) { ctx.textAlign = 'left'; ctx.fillText(String(Math.abs(d)), half + 4, y); }
    }
    ctx.restore();
    // Sabit uçak sembolü
    ctx.strokeStyle = '#ffd35a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(ax - 46, cy); ctx.lineTo(ax - 14, cy); ctx.lineTo(ax, cy + 9); ctx.lineTo(ax + 14, cy); ctx.lineTo(ax + 46, cy); ctx.stroke();
    ctx.strokeStyle = C_LINE; ctx.lineWidth = 2; ctx.strokeRect(ax - 100, cy - 100, 200, 200);
  }

  drawENG(ctx, bx, cy, T, info) {
    const eng = T ? T.engine : 0, ab = T ? T.ab : 0, run = T && T.engineRun !== undefined ? T.engineRun : 1;
    const rpm = Math.round((62 + 38 * eng) * (0.25 + 0.75 * run));   // %N2 (rölanti ~%62)
    const ftit = Math.round((420 + 330 * eng + 120 * ab) * (0.35 + 0.65 * run));   // [E] gösterim amaçlı yaklaşık
    const noz = Math.round((info && info.nozzle !== undefined ? info.nozzle : 0.55) * 100);
    const thr = T ? Math.round(T.throttle * 100) : 0;
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    const rowsE = [['RPM', rpm + '%'], ['FTIT', ftit + '°'], ['NOZ', noz + '%'], ['THR', ab > 0.05 ? 'AB' : thr + '%']];
    rowsE.forEach(([k, v], i) => {
      const y = cy - 72 + i * 40;
      ctx.font = 'bold 20px Arial'; ctx.fillStyle = C_TXT; ctx.fillText(k, bx - 104, y);
      ctx.font = 'bold 26px Arial'; ctx.fillStyle = out(T) ? C_RED : C_WHITE; ctx.textAlign = 'right'; ctx.fillText(v, bx + 104, y); ctx.textAlign = 'left';
    });
    // RPM şeridi
    ctx.fillStyle = '#16303f'; ctx.fillRect(bx - 104, cy + 86, 208, 12);
    ctx.fillStyle = out(T) ? C_RED : ab > 0.05 ? C_AMBER : C_GREEN; ctx.fillRect(bx - 104, cy + 86, 208 * Math.max(0, Math.min(1, rpm / 100)), 12);
    if (out(T)) { ctx.font = 'bold 22px Arial'; ctx.fillStyle = C_RED; ctx.textAlign = 'center'; ctx.fillText('ENG OUT', bx, cy + 70); }
  }

  drawFuel(ctx, fx, cy, fuel, low, isOut) {
    const f = Math.max(0, Math.min(1, fuel / FUEL_FULL));
    ctx.fillStyle = '#2b4a5e'; ctx.fillRect(fx - 80, cy - 90, 160, 180);
    const col = isOut ? C_RED : low ? C_AMBER : C_GREEN;
    // iki tank (sol/sağ besleme), hafif dengesiz boşalma
    const fl = Math.min(1, f * 1.02), fr = Math.max(0, f * 0.98);
    ctx.fillStyle = '#16303f'; ctx.fillRect(fx - 70, cy - 70, 40, 130); ctx.fillRect(fx + 30, cy - 70, 40, 130);
    ctx.fillStyle = col; ctx.fillRect(fx - 70, cy + 60 - 130 * fl, 40, 130 * fl); ctx.fillRect(fx + 30, cy + 60 - 130 * fr, 40, 130 * fr);
    ctx.fillStyle = C_WHITE; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.font = 'bold 18px Arial'; ctx.fillText('FUEL', fx, cy + 82);
    ctx.font = 'bold 24px Arial'; ctx.fillStyle = isOut ? C_RED : low ? C_AMBER : C_WHITE;
    ctx.fillText(Math.round(fuel).toLocaleString('en-US') + ' kg', fx, cy - 98);
    if (low || isOut) { ctx.font = 'bold 16px Arial'; ctx.fillText(isOut ? 'EMPTY' : 'BINGO', fx, cy + 4); }
  }
}

function out(T) { return !!(T && T.flameout); }
