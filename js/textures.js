// Tüm dokular canvas ile prosedürel olarak üretilir. Hiçbir dış görsel kullanılmaz.
import * as THREE from 'three';
import { mulberry32 } from './noise.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

// Kenarları birbirine uyan (döşenebilir) periyodik değer gürültüsü.
export function periodicNoise(size, octaves = 4, seed = 1, baseFreq = 4, gain = 0.5) {
  const out = new Float32Array(size * size);
  const rand = mulberry32(seed);
  let amp = 1, norm = 0, freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    const n = freq;
    const lattice = new Float32Array(n * n);
    for (let i = 0; i < n * n; i++) lattice[i] = rand();
    const scale = n / size;
    for (let y = 0; y < size; y++) {
      const fy = y * scale;
      const y0 = Math.floor(fy);
      const ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      const y1 = (y0 + 1) % n;
      for (let x = 0; x < size; x++) {
        const fx = x * scale;
        const x0 = Math.floor(fx);
        const tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % n;
        const a = lattice[y0 * n + x0], b = lattice[y0 * n + x1];
        const c = lattice[y1 * n + x0], d = lattice[y1 * n + x1];
        const v = (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
        out[y * size + x] += amp * v;
      }
    }
    norm += amp; amp *= gain; freq *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= norm;
  return out;
}

function finishTexture(tex, { repeat = true, srgb = true, aniso = 4 } = {}) {
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

export function makeGrassTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n1 = periodicNoise(size, 5, 11, 4);
  const n2 = periodicNoise(size, 3, 12, 32, 0.6);
  for (let i = 0; i < size * size; i++) {
    const v = n1[i] * 0.7 + n2[i] * 0.3;
    const t = (v - 0.4) * 1.1;
    // Nötr (renk vertex renklerinden gelir); hafif sıcak ton
    const r = 188 + t * 44, g = 186 + t * 44, b = 176 + t * 40;
    img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

export function makeAsphaltTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = periodicNoise(size, 5, 21, 8, 0.55);
  const rand = mulberry32(22);
  for (let i = 0; i < size * size; i++) {
    let v = 52 + (n[i] - 0.5) * 40 + (rand() - 0.5) * 14;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 2; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

export function makeConcreteTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = periodicNoise(size, 4, 31, 6, 0.5);
  const rand = mulberry32(32);
  for (let i = 0; i < size * size; i++) {
    let v = 150 + (n[i] - 0.5) * 30 + (rand() - 0.5) * 10;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v - 4; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Beton plaka derzleri
  ctx.strokeStyle = 'rgba(60,60,60,0.55)';
  ctx.lineWidth = 3;
  const cells = 4;
  for (let i = 0; i <= cells; i++) {
    const p = Math.round((i * size) / cells) + 0.5;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(size, p); ctx.stroke();
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

// Su için döşenebilir normal haritası: periyodik dalga toplamından türetilir.
export function makeWaterNormalTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const waves = [];
  const rand = mulberry32(77);
  for (let k = 0; k < 36; k++) {
    const kx = Math.round(rand() * 16) - 8;
    const ky = Math.round(rand() * 16) - 8;
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, amp: (0.5 + rand()) / (1 + Math.hypot(kx, ky) * 0.55), ph: rand() * Math.PI * 2 });
  }
  const noise = periodicNoise(size, 5, 78, 6, 0.55);
  const noise2 = periodicNoise(size, 3, 79, 24, 0.5);
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2, v = (y / size) * Math.PI * 2;
      let s = 0;
      for (const w of waves) s += w.amp * Math.sin(w.kx * u + w.ky * v + w.ph);
      h[y * size + x] = s * 0.35 + (noise[y * size + x] - 0.5) * 3.2 + (noise2[y * size + x] - 0.5) * 1.2;
    }
  }
  const strength = 6;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const l = h[y * size + (x + size - 1) % size], r = h[y * size + (x + 1) % size];
      const u = h[((y + size - 1) % size) * size + x], d = h[((y + 1) % size) * size + x];
      let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
      const len = Math.hypot(nx, ny, nz); nx /= len; ny /= len; nz /= len;
      const i = (y * size + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { srgb: false });
}

// Uçak gövdesi: koyu gri gizlilik boyası, panel çizgileri, perçinler, hafif aşınma.
// İniş takımı yuvası iç yüzü: açık gri boyalı yapı (F-35 yuvaları açık renklidir), enine
// çerçeveler ve boyuna kirişler, hidrolik borular, kenarlara doğru koyulaşan gölge (derinlik
// hissi). u: yuvanın enine (0..1), v: boyuna (0..1).
export function makeGearBayTexture(w = 256, h = 512) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9ba1a7';
  ctx.fillRect(0, 0, w, h);
  // Enine çerçeveler (gölgeli kenarlı)
  const nf = 7;
  for (let i = 1; i < nf; i++) {
    const y = (i / nf) * h;
    ctx.fillStyle = '#b9bec3'; ctx.fillRect(0, y - 5, w, 7);
    ctx.fillStyle = '#5d6369'; ctx.fillRect(0, y + 2, w, 3);
  }
  // Boyuna kirişler
  for (const x of [0.22, 0.78]) {
    ctx.fillStyle = '#c3c8cc'; ctx.fillRect(x * w - 4, 0, 6, h);
    ctx.fillStyle = '#5a6066'; ctx.fillRect(x * w + 2, 0, 3, h);
  }
  // Hidrolik/elektrik hatları
  const pipes = [[0.34, '#3a3f44', 4], [0.40, '#7a5a2a', 3], [0.62, '#3a3f44', 5], [0.67, '#2f5a7a', 3]];
  for (const [x, col, wd] of pipes) {
    ctx.fillStyle = col; ctx.fillRect(x * w, 0, wd, h);
    ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x * w, 0, 1, h);
    for (let k = 0; k < 6; k++) { ctx.fillStyle = '#2a2d31'; ctx.fillRect(x * w - 2, (k + 0.5) / 6 * h, wd + 4, 5); }
  }
  // Kutular / aktüatör yuvaları
  ctx.fillStyle = '#7d848a';
  ctx.fillRect(0.05 * w, 0.18 * h, 0.12 * w, 0.14 * h);
  ctx.fillRect(0.83 * w, 0.58 * h, 0.12 * w, 0.18 * h);
  ctx.strokeStyle = '#4c5257'; ctx.lineWidth = 2;
  ctx.strokeRect(0.05 * w, 0.18 * h, 0.12 * w, 0.14 * h);
  ctx.strokeRect(0.83 * w, 0.58 * h, 0.12 * w, 0.18 * h);
  // Derinlik gölgesi: kenarlar koyu, orta hafif açık
  const gx = ctx.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, 'rgba(10,12,14,0.75)'); gx.addColorStop(0.18, 'rgba(10,12,14,0.15)');
  gx.addColorStop(0.82, 'rgba(10,12,14,0.15)'); gx.addColorStop(1, 'rgba(10,12,14,0.75)');
  ctx.fillStyle = gx; ctx.fillRect(0, 0, w, h);
  const gy = ctx.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, 'rgba(10,12,14,0.65)'); gy.addColorStop(0.1, 'rgba(10,12,14,0)');
  gy.addColorStop(0.9, 'rgba(10,12,14,0)'); gy.addColorStop(1, 'rgba(10,12,14,0.65)');
  ctx.fillStyle = gy; ctx.fillRect(0, 0, w, h);
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

// F-35 kaplama dokusu (döşenir). Eski doku: düzgün 10x8 ızgara, 2 px siyah çizgiler, 60 rastgele
// dikdörtgen ve kum gibi noktalar — "kareli kâğıt" gibi görünüyordu. Yeni doku:
//   - düzensiz panel yerleşimi, her panel tonu çok hafif farklı (RAM kaplama yamaları),
//   - ince koyu panel derzleri + yanında açık renkli sızdırmazlık bandı,
//   - bazı dikey derzlerde F-35'e özgü testere dişi kenar,
//   - derzler boyunca düzenli perçin sıraları, az sayıda yuvarlak köşeli servis kapağı.
// Doku kenarlardan kesintisiz döşenir. Büyük ölçekli ton/kir değişimi gölgelendiricide
// (applyPaintDetail) nesne uzayında eklenir; döşeme tekrarı böylece seçilmez.
export function makeStealthPanelTexture(size = 1024) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = periodicNoise(size, 4, 41, 4, 0.5);
  for (let i = 0; i < size * size; i++) {
    const v = 124 + (n[i] - 0.5) * 9;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v + 1; img.data[i * 4 + 2] = v + 3; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const rand = mulberry32(42);
  const S = size;
  const colsF = [0, 0.12, 0.27, 0.39, 0.53, 0.66, 0.80, 0.91];
  const rowsF = [0, 0.16, 0.34, 0.49, 0.67, 0.83];
  const X = colsF.map((f) => Math.round(f * S)), Y = rowsF.map((f) => Math.round(f * S));
  // Panel tonları (ızgara hücreleri; satırlar arasında sütunlar kaydırılmaz, sarmalama korunur)
  for (let j = 0; j < Y.length; j++) {
    const y0 = Y[j], y1 = j + 1 < Y.length ? Y[j + 1] : S;
    for (let i = 0; i < X.length; i++) {
      const x0 = X[i], x1 = i + 1 < X.length ? X[i + 1] : S;
      const d = (rand() - 0.5) * 2;
      ctx.fillStyle = d > 0 ? `rgba(255,255,255,${0.022 * d})` : `rgba(0,0,0,${-0.028 * d})`;   // hafif: büyük düz kanatta şerit gibi görünmesin
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  const seam = (pts, dark = 0.42) => {
    ctx.lineJoin = 'miter';
    ctx.strokeStyle = 'rgba(205,210,214,0.20)'; ctx.lineWidth = 1.2;
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x + 1.6, y + 1.6) : ctx.moveTo(x + 1.6, y + 1.6))); ctx.stroke();
    ctx.strokeStyle = `rgba(38,41,45,${dark})`; ctx.lineWidth = 1.4;
    ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
  };
  const rivets = (x0, y0, x1, y1, off, gap = 13) => {
    const len = Math.hypot(x1 - x0, y1 - y0), nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    ctx.fillStyle = 'rgba(52,55,60,0.30)';
    for (let t = gap * 0.5; t < len; t += gap) {
      const x = x0 + (x1 - x0) * (t / len) + nx * off, y = y0 + (y1 - y0) * (t / len) + ny * off;
      ctx.beginPath(); ctx.arc(x, y, 1.1, 0, Math.PI * 2); ctx.fill();
    }
  };
  // Dikey derzler (bazıları testere dişi); x=0 ve x=S aynı çizgi
  X.forEach((x, i) => {
    const saw = i % 3 === 1;
    for (const xx of i === 0 ? [0, S] : [x]) {
      const pts = [];
      if (saw) { const t = 22; for (let y = 0; y <= S; y += t) pts.push([xx + ((y / t) % 2 ? 9 : -9), y]); }
      else pts.push([xx, 0], [xx, S]);
      seam(pts);
      if (!saw) { rivets(xx, 0, xx, S, 5); rivets(xx, 0, xx, S, -5); }
    }
  });
  Y.forEach((y, j) => { for (const yy of j === 0 ? [0, S] : [y]) { seam([[0, yy], [S, yy]]); rivets(0, yy, S, yy, 5); } });
  // Servis kapakları: hücre içinde, yuvarlak köşeli, çevresi perçinli
  for (let k = 0; k < 16; k++) {
    const i = Math.floor(rand() * X.length), j = Math.floor(rand() * Y.length);
    const cx0 = X[i], cx1 = i + 1 < X.length ? X[i + 1] : S, cy0 = Y[j], cy1 = j + 1 < Y.length ? Y[j + 1] : S;
    const w = Math.min(cx1 - cx0 - 30, 36 + rand() * 80), h = Math.min(cy1 - cy0 - 30, 26 + rand() * 50);
    if (w < 20 || h < 16) continue;
    const x = cx0 + 15 + rand() * (cx1 - cx0 - 30 - w), y = cy0 + 15 + rand() * (cy1 - cy0 - 30 - h), r = 5;
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    ctx.fillStyle = rand() > 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.03)'; ctx.fill();
    ctx.strokeStyle = 'rgba(40,43,47,0.36)'; ctx.lineWidth = 1.1; ctx.stroke();
    ctx.fillStyle = 'rgba(50,53,58,0.30)';
    const per = 2 * (w + h), nR = Math.max(6, Math.round(per / 11));
    for (let q = 0; q < nR; q++) {
      let t = (q / nR) * per, px, py;
      if (t < w) { px = x + t; py = y + 4; } else if ((t -= w) < h) { px = x + w - 4; py = y + t; } else if ((t -= h) < w) { px = x + w - t; py = y + h - 4; } else { t -= w; px = x + 4; py = y + h - t; }
      ctx.beginPath(); ctx.arc(px, py, 0.9, 0, Math.PI * 2); ctx.fill();
    }
  }
  return finishTexture(new THREE.CanvasTexture(c), { aniso: 8 });
}

// Büyük ölçekli değişim dokusu (nesne uzayında örneklenir): R düşük frekans ton,
// G orta frekans leke, B akış yönünde (boyuna) uzamış kir izleri için.
export function makeMacroNoiseTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const a = periodicNoise(size, 4, 71, 3, 0.55), b = periodicNoise(size, 4, 72, 9, 0.5), s = periodicNoise(size, 3, 73, 16, 0.5);
  for (let i = 0; i < size * size; i++) {
    img.data[i * 4] = a[i] * 255; img.data[i * 4 + 1] = b[i] * 255; img.data[i * 4 + 2] = s[i] * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { srgb: false });
}

// Bakım/uyarı işaretleri atlası (düşük görünürlüklü koyu gri). Her öğenin uv dikdörtgeni
// STENCIL_ATLAS'ta; tek doku + tek malzeme, tüm işaretler tek çizime birleşir.
export const STENCIL_ATLAS = {
  warn: [0, 0, 0.125, 0.5], rescue: [0.125, 0, 0.5, 0.5], nostep: [0.5, 0, 0.75, 0.25],
  fuel: [0.5, 0.25, 0.75, 0.5], intake: [0.75, 0, 1, 0.5], jack: [0, 0.5, 0.125, 1],
  ground: [0.125, 0.5, 0.375, 0.75], data: [0.375, 0.5, 0.75, 1], walk: [0.75, 0.5, 1, 0.625],
  line: [0.79, 0.66, 0.96, 0.69], bay: [0.75, 0.72, 1, 1],
};
export function makeStencilAtlas(w = 1024, h = 256, ink = '#4b5056') {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const R = (k) => { const [u0, v0, u1, v1] = STENCIL_ATLAS[k]; return { x: u0 * w, y: v0 * h, w: (u1 - u0) * w, h: (v1 - v0) * h }; };
  ctx.fillStyle = ink; ctx.strokeStyle = ink; ctx.lineJoin = 'round';
  const text = (s, x, y, px, align = 'center') => { ctx.font = `bold ${px}px Arial, Helvetica, sans-serif`; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(s, x, y); };
  // Fırlatma koltuğu uyarı üçgeni
  { const r = R('warn'), cx = r.x + r.w / 2, cy = r.y + r.h * 0.52, s = r.w * 0.42;
    ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(cx, cy - s); ctx.lineTo(cx + s, cy + s * 0.8); ctx.lineTo(cx - s, cy + s * 0.8); ctx.closePath(); ctx.stroke();
    text('!', cx, cy + s * 0.15, 54); }
  // Kurtarma oku + yazı
  { const r = R('rescue'), y = r.y + r.h * 0.38;
    ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(r.x + 30, y); ctx.lineTo(r.x + r.w - 70, y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r.x + r.w - 30, y); ctx.lineTo(r.x + r.w - 76, y - 26); ctx.lineTo(r.x + r.w - 76, y + 26); ctx.closePath(); ctx.fill();
    text('RESCUE', r.x + r.w / 2 - 20, r.y + r.h * 0.72, 40);
    text('CANOPY JETTISON', r.x + r.w / 2 - 20, r.y + r.h * 0.9, 18); }
  // NO STEP
  { const r = R('nostep'); ctx.lineWidth = 3; ctx.strokeRect(r.x + 8, r.y + 10, r.w - 16, r.h - 20); text('NO STEP', r.x + r.w / 2, r.y + r.h / 2, 30); }
  // Yakıt bilgisi
  { const r = R('fuel'); text('FUEL  JP-8', r.x + r.w / 2, r.y + r.h * 0.35, 24); text('SPR 55 PSI MAX', r.x + r.w / 2, r.y + r.h * 0.72, 18); }
  // Hava alığı tehlike şeridi (köşeli)
  { const r = R('intake');
    ctx.lineWidth = 6; ctx.beginPath();
    for (let k = 0; k < 5; k++) { const x = r.x + 18 + k * 44; ctx.moveTo(x, r.y + r.h * 0.18); ctx.lineTo(x + 22, r.y + r.h * 0.36); ctx.lineTo(x, r.y + r.h * 0.54); }
    ctx.stroke(); text('DANGER', r.x + r.w / 2, r.y + r.h * 0.72, 30); text('JET INTAKE', r.x + r.w / 2, r.y + r.h * 0.9, 20); }
  // Kriko noktası
  { const r = R('jack'), cx = r.x + r.w / 2, cy = r.y + r.h * 0.45; ctx.beginPath(); ctx.moveTo(cx, cy - 36); ctx.lineTo(cx + 34, cy + 24); ctx.lineTo(cx - 34, cy + 24); ctx.closePath(); ctx.fill(); text('JACK', cx, r.y + r.h * 0.86, 22); }
  // Topraklama
  { const r = R('ground'); text('GROUND HERE', r.x + r.w / 2, r.y + r.h * 0.3, 26); ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h * 0.7, 12, 0, Math.PI * 2); ctx.stroke(); }
  // Veri bloğu (seri/bakım)
  { const r = R('data'); ctx.font = 'bold 19px Arial, Helvetica, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ['F-35A  LIGHTNING II', 'LOCKHEED MARTIN AERONAUTICS', 'SERVICE: OIL MIL-PRF-23699', 'HYD: MIL-PRF-87257  3000/4000 PSI', 'OXY: OBOGS - NO SERVICING'].forEach((s, k) => ctx.fillText(s, r.x + 10, r.y + 8 + k * 23)); }
  // Düz çizgi (kapak dikiş çizgileri için dolu bant)
  { const r = R('line'); ctx.fillRect(r.x - 2, r.y - 1, r.w + 4, r.h + 2); }
  // Silah yuvası kapak uyarısı
  { const r = R('bay'); ctx.lineWidth = 3; ctx.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    text('WEAPON BAY', r.x + r.w / 2, r.y + r.h * 0.36, 30); text('KEEP CLEAR', r.x + r.w / 2, r.y + r.h * 0.68, 22); }
  // Yürüme yolu sınır çizgisi parçası (kesikli)
  { const r = R('walk'); ctx.lineWidth = 5; ctx.setLineDash([22, 12]); ctx.beginPath(); ctx.moveTo(r.x, r.y + r.h / 2); ctx.lineTo(r.x + r.w, r.y + r.h / 2); ctx.stroke(); ctx.setLineDash([]); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}

// Pürüzlülük haritası: panel çizgilerinde daha parlak, geri kalanda mat.
export function makeRoughnessTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = periodicNoise(size, 3, 51, 5, 0.5);
  for (let i = 0; i < size * size; i++) {
    const v = 150 + (n[i] - 0.5) * 60;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { srgb: false });
}

/**
 * Kanat/gövde amblemi. kind:
 *   'starbar'   ABD yıldız-çubuk (USAF/US Navy ortak amblemi)
 *   'navy'      aynı amblem + altında düşük görünürlüklü "NAVY" yazısı
 *   'ironcross' modern Alman demir haçı (Balkenkreuz)
 * Hepsi DÜŞÜK GÖRÜNÜRLÜKLÜDÜR: gri tonlar, keskin renk yok — gerçek modern
 * savaş uçağı işaretleri gibi. Saydam zeminli, dekal olarak kullanılır.
 */
export function makeMilInsigniaTexture(kind = 'starbar', size = 256) {
  if (kind === 'ironcross') return makeIronCrossTexture(size);
  // 'navy' ve 'starbar' AYNI amblemi kullanır — gerçekte de US Navy ve USAF aynı
  // yıldız-çubuk işaretini taşır. Donanma şemasında yalnızca ton daha soluktur.
  // (Amblemin üstüne yazı EKLENMEZ: dekal düzlemleri dönüşe göre simetrik amblem
  //  için kurulmuştur, yazı kanadın bir yüzünde ters görünür.)
  return makeInsigniaTexture(Math.max(512, size), kind === 'navy' ? 0.8 : 1);
}

// Balkenkreuz: dört kollu, içi boş, gri konturlu modern Alman işareti.
function makeIronCrossTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2;
  const arm = size * 0.40;      // kol yarı uzunluğu
  const th = size * 0.145;      // kol yarı kalınlığı
  // Haç gövdesi (iki dikdörtgenin birleşimi)
  const draw = (fill, stroke, lw, inset) => {
    const a = arm - inset, t = th - inset;
    ctx.beginPath();
    ctx.rect(cx - a, cy - t, 2 * a, 2 * t);
    ctx.rect(cx - t, cy - a, 2 * t, 2 * a);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
  };
  // DÜŞÜK GÖRÜNÜRLÜK: tonlar birbirine ve gövde grisine yakın tutulur.
  // Parlak beyaz kontur gerçekçi olmaz ve "ölçülü işaret" isteğine aykırıdır.
  draw('rgba(118,124,130,0.88)', null, 0, 0);            // dış kontur
  draw('rgba(162,168,166,0.85)', null, 0, size * 0.030); // ince açık gri bant
  draw('rgba(118,124,130,0.88)', null, 0, size * 0.062); // merkez
  const t2 = new THREE.CanvasTexture(c);
  t2.colorSpace = THREE.SRGBColorSpace;
  t2.needsUpdate = true;
  return t2;
}

// Yıldız-çubuk amblemi, düşük görünürlüklü (iki ton gri). Gerçek oranlar: daire yarıçapı R,
// çubuklar daireden R uzunluğunda ve R/2 yüksekliğinde dışa uzanır, hepsini ince bir kontur
// çevreler; toplam en-boy 4R x 2R. Yüksek çözünürlük + anizotropi: keskin kenar.
export function makeInsigniaTexture(size = 512, contrast = 1) {
  const W = size, H = size / 2;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const cx = W / 2, cy = H / 2, R = H * 0.44, k = contrast;
  const light = `rgba(168,173,179,${0.92 * k})`, dark = `rgba(92,97,104,${0.95 * k})`, edge = `rgba(70,74,80,${0.9 * k})`;
  const bh = R * 0.5, bl = R * 0.98;
  const outline = (grow) => {
    ctx.beginPath();
    ctx.rect(cx - R - bl - grow, cy - bh / 2 - grow, 2 * (R + bl + grow), bh + 2 * grow);
    ctx.moveTo(cx + R + grow, cy); ctx.arc(cx, cy, R + grow, 0, Math.PI * 2);
  };
  ctx.fillStyle = edge; outline(R * 0.07); ctx.fill('nonzero');
  ctx.fillStyle = light; ctx.fillRect(cx - R - bl, cy - bh / 2, 2 * (R + bl), bh);
  ctx.fillStyle = dark; ctx.fillRect(cx - R - bl, cy - bh * 0.08, 2 * (R + bl), bh * 0.16);   // çubuk ortası çizgi
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = dark; ctx.fill();
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? R * 0.382 : R * 0.98;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fillStyle = light; ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export function makeTextTexture(text, { w = 512, h = 256, font = 'bold 200px Arial', color = '#e0e0e0' } = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Hangar duvarı: oluklu sac.
export function makeHangarWallTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#9aa0a6';
  ctx.fillRect(0, 0, size, size);
  for (let x = 0; x < size; x += 16) {
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(x, 0, 4, size);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(x + 8, 0, 3, size);
  }
  const n = periodicNoise(size, 3, 61, 4, 0.5);
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) {
    const d = (n[i] - 0.5) * 30;
    img.data[i * 4] += d; img.data[i * 4 + 1] += d; img.data[i * 4 + 2] += d;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

// Hangar kapısı: büyük sürgülü panel.
export function makeHangarDoorTexture(w = 512, h = 256) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#6b7075';
  ctx.fillRect(0, 0, w, h);
  const panels = 6;
  for (let i = 0; i < panels; i++) {
    const x = (i * w) / panels;
    ctx.fillStyle = i % 2 ? '#5d6267' : '#70757a';
    ctx.fillRect(x, 0, w / panels, h);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 4, 6, w / panels - 8, h - 12);
  }
  ctx.fillStyle = '#c9a227';
  ctx.fillRect(0, h - 14, w, 6);
  return finishTexture(new THREE.CanvasTexture(c), { repeat: false });
}

// Ağaç yaprak gölgesi/renk çeşidi için küçük gürültü dokusu (gövde rengi vertex ile).
export function makeSoftNoiseTexture(size = 256, seed = 91) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = periodicNoise(size, 3, seed, 4, 0.5);
  for (let i = 0; i < size * size; i++) {
    const v = 200 + (n[i] - 0.5) * 110;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

// Kokpit panoramik ekranı (PCD): koyu arka plan, portal pencereler, semboloji.
export function makeCockpitDisplayTexture(w = 1024, h = 384) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0d10';
  ctx.fillRect(0, 0, w, h);
  // Ekran alanı
  const pad = 26;
  ctx.fillStyle = '#0f1a24';
  ctx.fillRect(pad, pad, w - pad * 2, h - pad * 2);
  const cols = [pad, w * 0.5, w - pad];
  const rows = [pad, h * 0.22, h - pad];
  ctx.strokeStyle = '#3f5a6e';
  ctx.lineWidth = 2;
  ctx.strokeRect(pad, pad, w - pad * 2, h - pad * 2);
  ctx.beginPath(); ctx.moveTo(w * 0.5, pad); ctx.lineTo(w * 0.5, h - pad); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(pad, rows[1]); ctx.lineTo(w - pad, rows[1]); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(w * 0.25, rows[1]); ctx.lineTo(w * 0.25, h - pad); ctx.moveTo(w * 0.75, rows[1]); ctx.lineTo(w * 0.75, h - pad); ctx.stroke();
  // Üst şerit: uyarı/menü hücreleri
  ctx.font = 'bold 20px Arial';
  ctx.fillStyle = '#8fd3ff';
  const menu = ['TSD', 'SMS', 'FCS', 'DAS', 'CNI', 'ENG', 'FUEL', 'CKLST'];
  menu.forEach((t, i) => {
    const x = pad + ((i + 0.5) * (w - pad * 2)) / menu.length;
    ctx.textAlign = 'center';
    ctx.fillText(t, x, rows[1] - 24);
  });
  // Sol: taktik durum (menzil halkaları)
  const cx = w * 0.125, cy = (rows[1] + rows[2]) / 2;
  ctx.strokeStyle = '#5cc2ff';
  for (let r = 20; r <= 100; r += 40) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  ctx.fillStyle = '#5cc2ff';
  ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx - 8, cy + 8); ctx.lineTo(cx + 8, cy + 8); ctx.closePath(); ctx.fill();
  // Yapay ufuk
  const ax = w * 0.375;
  ctx.fillStyle = '#2a6cb0'; ctx.fillRect(ax - 100, cy - 100, 200, 100);
  ctx.fillStyle = '#6b4a2a'; ctx.fillRect(ax - 100, cy, 200, 100);
  ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(ax - 100, cy); ctx.lineTo(ax + 100, cy); ctx.stroke();
  for (const d of [-60, -30, 30, 60]) { ctx.beginPath(); ctx.moveTo(ax - 30, cy + d); ctx.lineTo(ax + 30, cy + d); ctx.stroke(); }
  ctx.strokeStyle = '#ffd35a'; ctx.beginPath(); ctx.moveTo(ax - 40, cy); ctx.lineTo(ax - 12, cy); ctx.lineTo(ax, cy + 8); ctx.lineTo(ax + 12, cy); ctx.lineTo(ax + 40, cy); ctx.stroke();
  // Sağ: motor/yakıt çubukları
  const bx = w * 0.625;
  ctx.fillStyle = '#8fd3ff'; ctx.font = '18px Arial'; ctx.textAlign = 'left';
  ['RPM 68%', 'FTIT 540', 'OIL 45', 'NOZ 85%'].forEach((t, i) => ctx.fillText(t, bx - 90, cy - 60 + i * 34));
  const fx = w * 0.875;
  ctx.fillStyle = '#2b4a5e'; ctx.fillRect(fx - 80, cy - 90, 160, 180);
  ctx.fillStyle = '#39ff6a'; ctx.fillRect(fx - 70, cy + 60 - 130, 40, 130); ctx.fillRect(fx + 30, cy + 60 - 120, 40, 120);
  ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.fillText('FUEL', fx, cy + 82);
  ctx.fillText('8300 kg', fx, cy - 100);
  // Bezel yansıması
  ctx.strokeStyle = '#2c3138'; ctx.lineWidth = 6; ctx.strokeRect(6, 6, w - 12, h - 12);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Silah yuvası kapakları: testere dişli çizgili, şeffaf çıkartma
export function makeBayDoorTexture(w = 1024, h = 512) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(25,27,30,0.85)';
  ctx.lineWidth = 3;
  const zig = (x0, y0, x1, y1, teeth) => {
    ctx.beginPath(); ctx.moveTo(x0, y0);
    for (let i = 1; i <= teeth; i++) {
      const t = i / teeth;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const nx = -(y1 - y0), ny = (x1 - x0);
      const len = Math.hypot(nx, ny) || 1;
      const off = (i % 2 ? 8 : -8);
      ctx.lineTo(x + (nx / len) * off, y + (ny / len) * off);
    }
    ctx.lineTo(x1, y1); ctx.stroke();
  };
  for (const side of [0, 1]) {
    const x0 = side ? w * 0.53 : w * 0.1, x1 = side ? w * 0.9 : w * 0.47;
    const y0 = h * 0.08, y1 = h * 0.92;
    zig(x0, y0, x1, y0, 12); zig(x0, y1, x1, y1, 12);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x0, y1); ctx.moveTo(x1, y0); ctx.lineTo(x1, y1); ctx.stroke();
    // Ortadaki kapak ayrımı
    const xm = (x0 + x1) / 2;
    ctx.setLineDash([12, 6]); ctx.beginPath(); ctx.moveTo(xm, y0); ctx.lineTo(xm, y1); ctx.stroke(); ctx.setLineDash([]);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Yumuşak bulut dokusu (alfa): üst üste binen radyal gradyanlar + gürültü
export function makeCloudTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const rand = mulberry32(501);
  for (let i = 0; i < 14; i++) {
    const x = size * (0.3 + rand() * 0.4), y = size * (0.35 + rand() * 0.3);
    const r = size * (0.12 + rand() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.25)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  // kenar yumuşatma: merkezden uzak pikselleri sönümle
  const img = ctx.getImageData(0, 0, size, size);
  const n = periodicNoise(size, 3, 502, 6, 0.5);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2.4;
      const edge = 1 - Math.min(1, Math.hypot(dx, dy));
      const k = Math.min(1, edge * 1.6) * (0.75 + 0.5 * n[y * size + x]);
      img.data[i + 3] = Math.min(255, img.data[i + 3] * k);
      // hafif alt gölge
      const shade = 235 + 20 * (1 - y / size);
      img.data[i] = shade; img.data[i + 1] = shade; img.data[i + 2] = Math.min(255, shade + 6);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Yol dokusu: asfalt + kesikli orta çizgi (v yönünde tekrar eder)
export function makeRoadTexture(w = 128, h = 256) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const rand = mulberry32(601);
  for (let i = 0; i < w * h; i++) {
    const v = 58 + (rand() - 0.5) * 18;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 2; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.fillStyle = '#d8d8d0';
  ctx.fillRect(w / 2 - 2, 0, 4, h * 0.45);
  ctx.fillRect(2, 0, 3, h); ctx.fillRect(w - 5, 0, 3, h);
  return finishTexture(new THREE.CanvasTexture(c));
}

// Yol atlası (u yönü yolun enine kesiti): [0, 0.25) çakıllı banket (dışta çimen-toprak
// geçişi), [0.25, 1] asfalt şerit: kenar çizgileri, kesikli orta çizgi, tekerlek izi aşınması,
// yama lekeleri. Kavşak dolguları çizgisiz asfalt bölgesini (u ~ 0.42) kullanır.
export function makeRoadAtlasTexture(w = 256, h = 256) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const rand = mulberry32(611);
  const patch = periodicNoise(w, 4, 612, 4, 0.55);
  const grit = periodicNoise(w, 5, 613, 32, 0.6);
  const g0 = w * 0.25;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, pn = patch[(y % w) * w + x], gn = grit[(y % w) * w + x];
      let r, g, b;
      if (x < g0) {
        // banket: dışta (x=0) çimenli toprak, içe doğru açık gri çakıl
        const t = smoothstepJS(0, g0 * 0.55, x);
        const sp = (rand() - 0.5) * 30 + (gn - 0.5) * 26;
        r = 92 + 40 * t + sp; g = 96 + 28 * t + sp; b = 64 + 38 * t + sp;
        if (x > g0 - 3) { r *= 0.8; g *= 0.8; b *= 0.8; }   // asfalt kenarı gölge çizgisi
      } else {
        const u = (x - g0) / (w - g0);
        const wear = Math.exp(-Math.pow((u - 0.30) / 0.06, 2)) + Math.exp(-Math.pow((u - 0.70) / 0.06, 2));
        let v = 50 + (pn - 0.5) * 26 + (gn - 0.5) * 10 + (rand() - 0.5) * 12 - wear * 7;
        r = v; g = v; b = v + 3;
      }
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const px = (u) => g0 + u * (w - g0);
  ctx.fillStyle = 'rgba(222,222,212,0.92)';
  ctx.fillRect(px(0.035), 0, 4, h); ctx.fillRect(px(0.965) - 4, 0, 4, h);
  ctx.fillStyle = 'rgba(226,222,200,0.95)';
  ctx.fillRect(px(0.5) - 2, 0, 4, h * 0.45);
  return finishTexture(new THREE.CanvasTexture(c));
}
function smoothstepJS(a, b, x) { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Ev atlası 2x2: [0,0.5)x[0.5,1] tek katlı cephe (pencere+kapı), [0.5,1]x[0.5,1] iki katlı
// cephe, [0,0.5)x[0,0.5) dükkan cephesi (vitrin + üst kat), [0.5,1]x[0,0.5) kiremit/çatı.
// Cephe renkleri beyaza yakın: duvar rengi örnek rengiyle (instanceColor) çarpılır.
export function makeHouseAtlasTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const H = size / 2;
  const n = periodicNoise(size, 4, 721, 8, 0.5);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 236 + (n[i] - 0.5) * 16;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v - 2; img.data[i * 4 + 2] = v - 6; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const win = (x, y, w, h) => {
    ctx.fillStyle = '#f4f2ee'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
    ctx.fillStyle = '#3c4a58'; ctx.fillRect(x, y, w, h);
    ctx.fillStyle = 'rgba(190,210,230,0.35)'; ctx.fillRect(x, y, w * 0.45, h * 0.5);
  };
  // canvas y aşağı doğru: üst yarı (y<H) dokuda v=[0.5,1]
  // tek katlı: 3 pencere, kapı
  win(10, 38, 22, 26); win(84, 38, 22, 26); ctx.fillStyle = '#6a4a34'; ctx.fillRect(50, 40, 22, 82);
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(0, H - 8, H, 8);
  // iki katlı
  for (const yy of [16, 74]) { win(H + 10, yy, 20, 30); win(H + 54, yy, 20, 30); win(H + 98, yy, 20, 30); }
  ctx.fillStyle = 'rgba(0,0,0,0.12)'; ctx.fillRect(H, H - 8, H, 8);
  // dükkan: geniş vitrin + tente + üst kat pencereleri
  for (let k = 0; k < 3; k++) win(8 + k * 40, H + 14, 30, 30);
  ctx.fillStyle = '#2d3a44'; ctx.fillRect(4, H + 72, H - 8, 50);
  ctx.fillStyle = 'rgba(200,220,235,0.4)'; ctx.fillRect(8, H + 76, H - 16, 20);
  ctx.fillStyle = '#9c3b2c'; ctx.fillRect(2, H + 62, H - 4, 9);
  // çatı: kiremit sıraları (gri ton; renk örnek başına gölgelendiricide)
  for (let y = H; y < size; y += 8) {
    ctx.fillStyle = '#c8c8c8'; ctx.fillRect(H, y, H, 8);
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(H, y + 6, H, 2);
    for (let x = H + ((y / 8) % 2) * 6; x < size; x += 12) { ctx.fillStyle = '#a8a8a8'; ctx.fillRect(x, y, 1, 6); }
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

// Promenat döşemesi: bir doku döşemesi 6 m; açık renkli taş levhalar, kaydırmalı sıralar,
// koyu derzler ve hafif renk/ton değişimi
export function makePavingTexture(size = 128) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rand = mulberry32(811);
  const n = 4, cell = size / n;
  ctx.fillStyle = '#8f8a80'; ctx.fillRect(0, 0, size, size);
  for (let r = 0; r < n; r++) {
    const off = (r % 2) * cell / 2;
    for (let k = -1; k < n; k++) {
      const v = 214 + (rand() - 0.5) * 22, w = (rand() - 0.5) * 8;
      ctx.fillStyle = `rgb(${v + w},${v - 3},${v - 12 - w})`;
      ctx.fillRect(k * cell + off + 1, r * cell + 1, cell - 2, cell - 2);
    }
  }
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < size * size; i++) { const d = (rand() - 0.5) * 10; img.data[i * 4] += d; img.data[i * 4 + 1] += d; img.data[i * 4 + 2] += d; }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

// Kruvaziyer gemisi balkon dokusu: bir döşeme 8 m x 1 güverte (3 m); koyu cam kapı,
// beyaz korkuluk bandı ve kabin ayırıcıları
export function makeBalconyTexture(size = 64) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#f2f3f4'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#2c3b4a'; ctx.fillRect(0, 6, size, 34);
  ctx.fillStyle = 'rgba(160,190,215,0.35)'; ctx.fillRect(0, 8, size, 10);
  ctx.fillStyle = '#e8eaec'; for (let x = 0; x < size; x += size / 2) ctx.fillRect(x, 6, 3, 34);
  ctx.fillStyle = '#b8bec4'; ctx.fillRect(0, 40, size, 3);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 43, size, 4);
  ctx.fillStyle = '#d0d4d8'; ctx.fillRect(0, 0, size, 6);
  return finishTexture(new THREE.CanvasTexture(c));
}

// Otopark: bir döşeme 10 m (u) x 17 m (v): iki sıra 5 m'lik park yeri (2,5 m aralıklı
// çizgiler) ve arada 7 m'lik geçiş koridoru
export function makeParkingTexture(w = 64, h = 108) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const rand = mulberry32(823);
  for (let i = 0; i < w * h; i++) { const v = 62 + (rand() - 0.5) * 16; img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v + 3; img.data[i * 4 + 3] = 255; }
  ctx.putImageData(img, 0, 0);
  const py = (m) => (m / 17) * h, px = (m) => (m / 10) * w;
  ctx.fillStyle = '#d9d9d0';
  for (const [a, b] of [[0, 5], [12, 17]]) {
    for (let k = 0; k <= 4; k++) ctx.fillRect(px(k * 2.5) - 0.6, py(a), 1.4, py(b) - py(a));
    ctx.fillRect(0, py(a === 0 ? 5 : 12) - 0.6, w, 1.2);
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

// Bina cephesi: pencere ızgarası
export function makeWindowsTexture(w = 512, h = 256, cols = 12, rows = 3) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b9b4a8';
  ctx.fillRect(0, 0, w, h);
  const n = periodicNoise(w, 3, 701, 4, 0.5);
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4; const d = (n[(y % w) * w + x] - 0.5) * 18; img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d; }
  ctx.putImageData(img, 0, 0);
  const rand = mulberry32(702);
  for (let r = 0; r < rows; r++) {
    for (let k = 0; k < cols; k++) {
      const x = (k + 0.2) * (w / cols), y = (r + 0.25) * (h / rows);
      const ww = (w / cols) * 0.6, hh = (h / rows) * 0.5;
      ctx.fillStyle = rand() < 0.75 ? '#3a4a5c' : '#c9d3dc';
      ctx.fillRect(x, y, ww, hh);
      ctx.strokeStyle = 'rgba(40,40,40,0.6)'; ctx.lineWidth = 2; ctx.strokeRect(x, y, ww, hh);
    }
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

// Alev/ısı türbülansı için döşenebilir gürültü dokusu (tek kanal, kırmızıda)
export function makeFlameNoiseTexture(size = 128) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n1 = periodicNoise(size, 4, 811, 4, 0.5);
  const n2 = periodicNoise(size, 3, 812, 12, 0.5);
  for (let i = 0; i < size * size; i++) {
    const v = Math.min(255, Math.max(0, (n1[i] * 0.65 + n2[i] * 0.35) * 255));
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { srgb: false });
}

// Işık parıltısı (radyal gradyan, alfa)
export function makeGlowTexture(size = 64) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

// Formasyon (elektrolüminesan) şerit ışığı: koyu, yuvarlak uçlu gövde çerçevesi içinde keskin
// kenarlı mercek; merkezde açık yeşil-beyaz, kenara doğru doygun yeşil. Saydam zemin.
export function makeStripLightTexture(w = 256, h = 32) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  const rr = (x, y, ww, hh, r) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + ww, y, x + ww, y + hh, r); ctx.arcTo(x + ww, y + hh, x, y + hh, r); ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + ww, y, r); ctx.closePath(); };
  rr(1, 1, w - 2, h - 2, (h - 2) / 2); ctx.fillStyle = 'rgba(40,46,44,0.92)'; ctx.fill();
  const g = ctx.createLinearGradient(0, 4, 0, h - 4);
  g.addColorStop(0, '#6fd486'); g.addColorStop(0.5, '#effff0'); g.addColorStop(1, '#6fd486');
  rr(5, 5, w - 10, h - 10, (h - 10) / 2); ctx.fillStyle = g; ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
// Şeridin hafif halesi: uzun kapsül biçimli yumuşak düşüş (alfa), ışığın boyaya taşması.
export function makeStripGlowTexture(w = 256, h = 64) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const x0 = w * 0.2, x1 = w * 0.8, cy = h / 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y - cy;
    const d2 = (dx * dx) / (w * w * 0.012) + (dy * dy) / (h * h * 0.05);
    const a = Math.exp(-d2) * 255;
    const i = (y * w + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.needsUpdate = true;
  return t;
}

// Tel örgü (chain-link) dokusu: şeffaf zemin üzerinde baklava deseni
export function makeChainLinkTexture(size = 64) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = 'rgba(190,196,200,0.95)';
  ctx.lineWidth = 2.2;
  const s = size / 2;
  for (let i = -1; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s + size, size); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(i * s + size, 0); ctx.lineTo(i * s, size); ctx.stroke();
  }
  const t = finishTexture(new THREE.CanvasTexture(c));
  return t;
}

// Dikenli tel şeridi: 3 yatay tel + dikenler, şeffaf zemin
export function makeBarbedWireTexture(w = 128, h = 32) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(170,176,180,0.95)';
  ctx.lineWidth = 1.5;
  for (const y of [6, 16, 26]) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    for (let x = 6; x < w; x += 16) { ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); }
  }
  return finishTexture(new THREE.CanvasTexture(c));
}

// Kamuflaj/zeytin araç boyası için hafif gürültü dokusu
export function makeOliveTexture(size = 128) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = periodicNoise(size, 3, 901, 4, 0.5);
  for (let i = 0; i < size * size; i++) {
    const v = (n[i] - 0.5) * 30;
    img.data[i * 4] = 96 + v; img.data[i * 4 + 1] = 102 + v; img.data[i * 4 + 2] = 72 + v; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c));
}

// ---- Şehir cephe dokuları --------------------------------------------------
// Dört cephe tipi: cam giydirme, ofis paneli, apartman, sanayi cephesi.
// Hepsi döşenebilir ve 256 px'tir; binalar örneklendiği (instanced) için doku sayısı
// az tutulur, çeşitlilik geometri oranı, renk tonu ve tip seçiminden gelir.
export function makeFacadeTexture(kind = 'office', size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const rand = mulberry32(kind.length * 977 + 31);
  const px = (v) => Math.round(v);
  if (kind === 'glass') {
    ctx.fillStyle = '#93aec4'; ctx.fillRect(0, 0, size, size);
    const cols = 10, rows = 14;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const t = rand();
      ctx.fillStyle = t < 0.42 ? '#a8c2d6' : t < 0.78 ? '#8aa6bd' : '#c4d8e6';
      ctx.fillRect(px(k * size / cols + 1), px(r * size / rows + 1), px(size / cols - 2), px(size / rows - 2.5));
    }
    ctx.strokeStyle = 'rgba(58,74,90,0.7)'; ctx.lineWidth = 1.5;
    for (let k = 0; k <= cols; k++) { ctx.beginPath(); ctx.moveTo(px(k * size / cols) + 0.5, 0); ctx.lineTo(px(k * size / cols) + 0.5, size); ctx.stroke(); }
    for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, px(r * size / rows) + 0.5); ctx.lineTo(size, px(r * size / rows) + 0.5); ctx.stroke(); }
  } else if (kind === 'office') {
    ctx.fillStyle = '#cfc9be'; ctx.fillRect(0, 0, size, size);
    const cols = 8, rows = 12;
    for (let r = 0; r < rows; r++) {
      ctx.fillStyle = 'rgba(150,145,136,0.75)';
      ctx.fillRect(0, px(r * size / rows), size, 3);
      for (let k = 0; k < cols; k++) {
        const t = rand();
        ctx.fillStyle = t < 0.7 ? '#55647a' : t < 0.88 ? '#6a7c92' : '#dae2e8';
        ctx.fillRect(px(k * size / cols + size / cols * 0.18), px(r * size / rows + size / rows * 0.30), px(size / cols * 0.64), px(size / rows * 0.44));
      }
    }
  } else if (kind === 'apartment') {
    ctx.fillStyle = '#ddd2be'; ctx.fillRect(0, 0, size, size);
    const cols = 6, rows = 9;
    for (let r = 0; r < rows; r++) for (let k = 0; k < cols; k++) {
      const bx = px(k * size / cols), by = px(r * size / rows);
      if (rand() < 0.5) { ctx.fillStyle = 'rgba(190,178,158,0.6)'; ctx.fillRect(bx, by, px(size / cols), px(size / rows)); }
      ctx.fillStyle = rand() < 0.72 ? '#5d6c7c' : '#ccd5db';
      ctx.fillRect(bx + px(size / cols * 0.22), by + px(size / rows * 0.24), px(size / cols * 0.34), px(size / rows * 0.42));
      // Balkon bandı
      ctx.fillStyle = 'rgba(105,98,88,0.55)';
      ctx.fillRect(bx + px(size / cols * 0.62), by + px(size / rows * 0.30), px(size / cols * 0.28), px(size / rows * 0.36));
    }
  } else {   // industrial
    ctx.fillStyle = '#b4bbc0'; ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(120,128,134,0.9)'; ctx.lineWidth = 2;
    for (let k = 0; k < 26; k++) { const x = px(k * size / 26) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, size); ctx.stroke(); }
    ctx.fillStyle = '#6d757b';
    ctx.fillRect(0, px(size * 0.08), size, px(size * 0.06));
    ctx.fillStyle = '#5f6e7c';
    for (let k = 0; k < 7; k++) ctx.fillRect(px(k * size / 7 + size / 7 * 0.15), px(size * 0.24), px(size / 7 * 0.7), px(size * 0.10));
  }
  const t = finishTexture(new THREE.CanvasTexture(c));
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Arazi ayrıntı dokusu (veri dokusu, sRGB DEĞİL; döşenebilir). Arazi gölgelendiricisi bunu
// birçok ölçekte ve döndürülmüş olarak örnekler; tek bir döşeme deseni görünmez.
//  R: ince toprak/çim dokusu   G: kaya (çatlaklı, sırtlı)   B: makro bulutsu değişim
export function makeTerrainDetailTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const fine = periodicNoise(size, 5, 101, 16, 0.55);
  const fine2 = periodicNoise(size, 3, 104, 64, 0.5);
  const rock = periodicNoise(size, 5, 102, 8, 0.6);
  const rock2 = periodicNoise(size, 4, 105, 32, 0.5);
  const macro = periodicNoise(size, 5, 103, 3, 0.55);
  const st = (v, k) => Math.max(0, Math.min(1, (v - 0.5) * k + 0.5));
  for (let i = 0; i < size * size; i++) {
    const f = st(fine[i] * 0.7 + fine2[i] * 0.3, 2.6);
    const r1 = 1 - Math.abs(rock[i] * 2 - 1);                  // sırtlı: çatlak hatları
    const r = st(r1 * 0.55 + rock2[i] * 0.45, 2.4);
    const m = st(macro[i], 2.8);
    img.data[i * 4] = f * 255; img.data[i * 4 + 1] = r * 255; img.data[i * 4 + 2] = m * 255; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return finishTexture(new THREE.CanvasTexture(c), { srgb: false });
}
