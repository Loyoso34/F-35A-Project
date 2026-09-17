// Yeşil HUD: hız, irtifa, baş, dikey hız, AoA, G, gaz, takım/flap, yunuslama merdiveni, uçuş yolu işareti.
import * as THREE from 'three';

const GREEN = '#39ff6a';
const DIM = 'rgba(57,255,106,0.55)';

export class HUD {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.w = 1; this.h = 1; this.dpr = 1;
    this._v = new THREE.Vector3();
    this._v2 = new THREE.Vector3();
    this.blink = 0;
  }

  resize(w, h, dpr) {
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  project(worldPos, camera) {
    const v = this._v.copy(worldPos).project(camera);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, behind };
  }

  // Dış kameralar: üst ortada kompakt uçuş bilgisi şeridi (IAS / ALT / VS / HDG) – fizik telemetrisinden, her karede
  drawExternalInfo(T, opts) {
    const ctx = this.ctx; const { w } = this;
    const vs = Math.round(T.vsFpm / 50) * 50;
    const items = [
      ['IAS', String(Math.round(T.kias)), 'KT'],
      ['ALT', Math.round(T.altFt).toLocaleString('en-US'), 'FT'],
      ['VS', (vs > 0 ? '+' : '') + vs, 'FPM'],
      ['HDG', String(Math.round(T.heading) % 360).padStart(3, '0'), ''],
    ];
    // Yolcu uçağı: sistem durumları da şeritte (her kamerada görünür)
    if (opts.extended) {
      items.push(['THR', String(Math.round((T.reverse > 0.05 ? -T.reverse : T.throttle) * 100)), '%']);
      items.push(['GEAR', T.gear > 0.99 ? 'DN' : T.gear < 0.01 ? 'UP' : '···', '']);
      items.push(['FLAPS', T.flapLabel || (T.flaps > 0.5 ? 'DN' : '0'), '']);
      if (T.spoilers > 0.05) items.push(['SPD BRK', String(Math.round(T.spoilers * 100)), '%']);
      if (T.windKt > 0) items.push(['WIND', String(T.windDeg).padStart(3, '0') + '/' + Math.round(T.windKt), 'KT']);
    }
    const fL = '600 9px -apple-system, "Segoe UI", Roboto, sans-serif', fV = 'bold 14px "SF Mono", Menlo, Consolas, monospace', fU = '600 8px -apple-system, "Segoe UI", Roboto, sans-serif';
    const gap = 14, padX = 12, hgt = 26;
    const widths = items.map(([l, v, u]) => { ctx.font = fL; let x = ctx.measureText(l).width + 5; ctx.font = fV; x += ctx.measureText(v).width; if (u) { ctx.font = fU; x += 3 + ctx.measureText(u).width; } return x; });
    // Dar ekranda sığmayan alanlar sondan atılır (okunaklılık korunur)
    let n = items.length;
    const totalOf = (k) => widths.slice(0, k).reduce((a, b) => a + b, 0) + gap * (k - 1) + padX * 2;
    while (n > 2 && totalOf(n) > w - 2 * (opts.safe.left + opts.safe.right) - 120) n--;
    items.length = n; widths.length = n;
    const total = totalOf(n);
    const x0 = Math.round(w / 2 - total / 2), y0 = opts.safe.top + 8;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.fillStyle = 'rgba(8,14,22,0.62)'; ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(x0, y0, total, hgt, 8); ctx.fill(); ctx.stroke();
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    let x = x0 + padX; const cy = y0 + hgt / 2 + 0.5;
    items.forEach(([l, v, u], i) => {
      ctx.font = fL; ctx.fillStyle = 'rgba(255,255,255,0.55)'; ctx.fillText(l, x, cy); x += ctx.measureText(l).width + 5;
      ctx.font = fV; ctx.fillStyle = GREEN; ctx.fillText(v, x, cy); x += ctx.measureText(v).width;
      if (u) { ctx.font = fU; ctx.fillStyle = 'rgba(255,255,255,0.45)'; x += 3; ctx.fillText(u, x, cy + 1); x += ctx.measureText(u).width; }
      x += gap;
    });
    ctx.restore();
    this.externalInfoDrawn = true;
    this.externalInfoBox = { x: x0, y: y0, w: total, h: hgt };
  }

  // Dış kameralarda yalnızca küçük, yeşil olmayan uyarılar (stall / takım)
  drawExternalWarnings(T, opts) {
    const ctx = this.ctx; const { w } = this;
    this.blink += opts.dt || 0.016;
    const on = Math.floor(this.blink * 4) % 2 === 0;
    ctx.save();
    ctx.font = 'bold 13px -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 4;
    const y = opts.safe.top + 50;
    if (T.stall && on) { ctx.fillStyle = '#ff6a6a'; ctx.fillText('STALL', w / 2, y); }
    else if (T.stallWarn && on) { ctx.fillStyle = '#ffc46a'; ctx.fillText('STALL UYARISI', w / 2, y); }
    if (!T.onGround && T.gear < 0.99 && T.aglFt < 800 && T.kias < 200 && T.vsFpm < 0 && on) { ctx.fillStyle = '#ffc46a'; ctx.fillText('İNİŞ TAKIMI', w / 2, y + 18); }
    ctx.restore();
  }

  clear() { const ctx = this.ctx; ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0); ctx.clearRect(0, 0, this.w, this.h); }

  draw(T, camera, fm, opts) {
    const ctx = this.ctx;
    const { w, h } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!T) return;
    // Yolcu uçağı: savaş uçağı HUD'u yerine her kamerada kompakt uçuş bilgisi şeridi
    if (opts.style === 'airliner') { this.drawExternalInfo(T, opts); this.drawExternalWarnings(T, opts); return; }
    if (opts.externalOnly) { this.drawExternalInfo(T, opts); this.drawExternalWarnings(T, opts); return; }
    if (!opts.visible) return;
    this.blink += opts.dt || 0.016;
    ctx.save();
    ctx.font = 'bold 14px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillStyle = GREEN; ctx.strokeStyle = GREEN; ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(0,0,0,0.8)'; ctx.shadowBlur = 3;
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
      ctx.setLineDash(deg < 0 ? [6, 4] : []);
      ctx.moveTo(-ladderW, y); ctx.lineTo(-26, y);
      ctx.moveTo(26, y); ctx.lineTo(ladderW, y);
      // Uç işaretleri: pozitifte aşağı, negatifte yukarı
      const tick = deg > 0 ? 8 : -8;
      ctx.moveTo(-ladderW, y); ctx.lineTo(-ladderW, y + tick);
      ctx.moveTo(ladderW, y); ctx.lineTo(ladderW, y + tick);
      ctx.stroke();
      ctx.setLineDash([]);
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
    ctx.font = 'bold 18px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(String(Math.round(T.kias)), lx + boxW - 6, rowY);
    ctx.font = 'bold 12px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText('KIAS', lx + boxW - 6, rowY - boxH / 2 - 9);
    ctx.fillText('M ' + T.mach.toFixed(2), lx + boxW - 6, rowY + boxH / 2 + 10);
    ctx.fillText('AoA ' + T.alpha.toFixed(1) + '°', lx + boxW - 6, rowY + boxH / 2 + 26);
    ctx.fillText('G ' + T.g.toFixed(1), lx + boxW - 6, rowY + boxH / 2 + 42);

    // ---- İrtifa kutusu (sağ) ----
    ctx.textAlign = 'left';
    ctx.strokeRect(rx, rowY - boxH / 2, boxW, boxH);
    ctx.font = 'bold 18px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText(String(Math.round(T.altFt)), rx + 6, rowY);
    ctx.font = 'bold 12px "SF Mono", Menlo, Consolas, monospace';
    ctx.fillText('ALT ft', rx + 6, rowY - boxH / 2 - 9);
    const vs = Math.round(T.vsFpm / 50) * 50;
    ctx.fillText('VS ' + (vs > 0 ? '+' : '') + vs, rx + 6, rowY + boxH / 2 + 10);
    ctx.fillText('AGL ' + Math.round(T.aglFt), rx + 6, rowY + boxH / 2 + 26);
    ctx.fillText('HDG ' + String(Math.round(T.heading) % 360).padStart(3, '0'), rx + 6, rowY + boxH / 2 + 42);

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
    ctx.fillText('FUEL ' + Math.round(T.fuelKg) + ' kg', rx + boxW, infoY);
    if (opts.cameraName) ctx.fillText(opts.cameraName, rx + boxW, infoY + 16);

    // ---- Uyarılar ----
    ctx.textAlign = 'center';
    ctx.font = 'bold 20px "SF Mono", Menlo, Consolas, monospace';
    const on = Math.floor(this.blink * 4) % 2 === 0;
    if (T.stall && on) { ctx.fillStyle = '#ff5050'; ctx.fillText('STALL', cx, cy + 70); }
    else if (T.stallWarn) { ctx.fillStyle = '#ffd35a'; ctx.font = 'bold 14px "SF Mono", Menlo, Consolas, monospace'; ctx.fillText('AoA ' + (on ? '▲' : '△') + ' STALL WARN', cx, cy + 70); }
    if (!T.onGround && T.gear < 0.99 && T.aglFt < 800 && T.kias < 200 && T.vsFpm < 0 && on) { ctx.fillStyle = '#ffd35a'; ctx.font = 'bold 20px "SF Mono", Menlo, Consolas, monospace'; ctx.fillText('GEAR', cx, cy + 94); }
    ctx.restore();
  }
}
