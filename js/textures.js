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
export function makeStealthPanelTexture(size = 1024) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = periodicNoise(size, 4, 41, 6, 0.5);
  const rand = mulberry32(42);
  for (let i = 0; i < size * size; i++) {
    const v = 118 + (n[i] - 0.5) * 26 + (rand() - 0.5) * 6;
    img.data[i * 4] = v; img.data[i * 4 + 1] = v + 1; img.data[i * 4 + 2] = v + 3; img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  // Panel çizgileri (F-35 tarzı testere dişi kenarlar için kırık çizgiler)
  ctx.strokeStyle = 'rgba(30,32,36,0.75)';
  ctx.lineWidth = 2;
  const cols = 10, rows = 8;
  for (let i = 0; i <= cols; i++) {
    const x = Math.round((i / cols) * size) + (i % 2 ? 18 : 0);
    ctx.beginPath(); ctx.moveTo(x, 0);
    for (let y = 0; y <= size; y += 64) {
      const zig = (Math.floor(y / 64) % 2) ? 6 : -6;
      ctx.lineTo(x + (i % 3 === 0 ? zig : 0), y);
    }
    ctx.stroke();
  }
  for (let j = 0; j <= rows; j++) {
    const y = Math.round((j / rows) * size) + (j % 2 ? 30 : 0);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(size, y); ctx.stroke();
  }
  // Küçük kapaklar ve perçin sıraları
  ctx.strokeStyle = 'rgba(40,42,46,0.6)';
  ctx.lineWidth = 1.5;
  for (let k = 0; k < 60; k++) {
    const x = rand() * size, y = rand() * size, w = 20 + rand() * 90, h = 12 + rand() * 40;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.fillStyle = 'rgba(60,62,66,0.5)';
  for (let k = 0; k < 2500; k++) {
    const x = rand() * size, y = rand() * size;
    ctx.fillRect(x, y, 1.5, 1.5);
  }
  return finishTexture(new THREE.CanvasTexture(c));
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

// Kanat üstü işaret dokusu: yıldız-çubuk amblemi (silik, düşük görünürlüklü).
export function makeInsigniaTexture(size = 256) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, R = size * 0.28;
  ctx.fillStyle = 'rgba(160,165,172,0.9)';
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = 'rgba(160,165,172,0.9)';
  // Çubuklar
  ctx.strokeRect(cx - R * 1.9, cy - R * 0.5, R * 3.8, R);
  // Daire
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = 'rgba(80,84,90,1)'; ctx.fill(); ctx.stroke();
  // Yıldız
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = cx + Math.cos(a) * R * 0.85, y = cy + Math.sin(a) * R * 0.85;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = 'rgba(160,165,172,0.95)';
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
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
