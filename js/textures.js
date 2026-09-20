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
  return makeInsigniaTexture(size, kind === 'navy' ? 0.72 : 1);
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

// Kanat üstü işaret dokusu: yıldız-çubuk amblemi (silik, düşük görünürlüklü).
export function makeInsigniaTexture(size = 256, contrast = 1) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, R = size * 0.28;
  // contrast < 1: daha soluk işaret (donanma tipi düşük görünürlük)
  const aLight = 0.9 * contrast, aStar = 0.95 * contrast;
  ctx.fillStyle = `rgba(160,165,172,${aLight})`;
  ctx.lineWidth = size * 0.02;
  ctx.strokeStyle = `rgba(160,165,172,${aLight})`;
  // Çubuklar
  ctx.strokeRect(cx - R * 1.9, cy - R * 0.5, R * 3.8, R);
  // Daire
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fillStyle = `rgba(80,84,90,${contrast})`; ctx.fill(); ctx.stroke();
  // Yıldız
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    const x = cx + Math.cos(a) * R * 0.85, y = cy + Math.sin(a) * R * 0.85;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = `rgba(160,165,172,${aStar})`;
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

// ---- Yolcu uçağı gövde kaplaması: beyaz üst, kabin pencereleri, kuşak çizgisi, gri karın ----
// u: burundan kuyruğa (0..1), v: üst merkezden alt merkeze (0..1)
/**
 * Yolcu uçağı gövde kaplaması. opt = livery paleti (bkz. js/liveries.js):
 *   base   gövde ana rengi
 *   belt   kuşak (cheatline) rengi
 *   belt2  kuşağın altındaki ince ikinci şerit
 *   belly  karın grisi
 *   window kabin penceresi rengi
 * Palet verilmezse eski varsayılanlar kullanılır, yani mevcut görünüm değişmez.
 * Doku boyutu ve maliyeti paletten bağımsızdır: yalnızca renkler değişir.
 */
function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return { r: 176, g: 182, b: 188 };
  const v = parseInt(m[1], 16);
  return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
}

export function makeAirlinerSkinTexture(w = 2048, h = 256, opt = {}) {
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  const belt = opt.belt || '#1b3a6b';
  const base = opt.base || '#f2f4f6';
  const belt2 = opt.belt2 || 'rgba(90,150,210,0.85)';
  const bellyCol = opt.belly || '#b0b6bc';
  const winCol = opt.window || '#20262e';
  ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
  // Hafif panel dokusu
  const n = periodicNoise(256, 3, 913, 6, 0.5);
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const d = (n[(y % 256) * 256 + (x % 256)] - 0.5) * 7;
    img.data[i] += d; img.data[i + 1] += d; img.data[i + 2] += d;
  }
  ctx.putImageData(img, 0, 0);
  // Gövde derzleri (çevresel): her ~1,2 m
  ctx.strokeStyle = 'rgba(120,130,140,0.35)'; ctx.lineWidth = 1;
  for (let k = 0; k < 38; k++) { const x = Math.round((k + 0.5) * (w / 38)) + 0.5; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
  // Boyuna derzler
  for (const v of [0.22, 0.34, 0.47, 0.60, 0.74]) { const y = Math.round(v * h) + 0.5; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
  // Karın: açık gri
  const gy = Math.round(h * 0.70);
  const g = ctx.createLinearGradient(0, gy, 0, h);
  const bc = hexToRgb(bellyCol);
  g.addColorStop(0, `rgba(${bc.r},${bc.g},${bc.b},0)`);
  g.addColorStop(0.25, `rgba(${bc.r},${bc.g},${bc.b},0.9)`);
  g.addColorStop(1, `rgba(${Math.round(bc.r * 0.9)},${Math.round(bc.g * 0.9)},${Math.round(bc.b * 0.9)},1)`);
  ctx.fillStyle = g; ctx.fillRect(0, gy, w, h - gy);
  // Kuşak çizgisi (pencerelerin altında): uzaktan da okunacak kadar geniş (~1 m)
  ctx.fillStyle = belt; ctx.fillRect(0, Math.round(h * 0.492), w, Math.round(h * 0.058));
  ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.fillRect(0, Math.round(h * 0.550), w, Math.round(h * 0.012));
  ctx.fillStyle = belt2; ctx.fillRect(0, Math.round(h * 0.562), w, Math.round(h * 0.016));
  // Kabin pencereleri: 0,5 m aralık; gövde 44,5 m -> ~74 pencere kabin bölümünde
  const y0 = Math.round(h * 0.395), wh = Math.round(h * 0.045);
  const first = 0.135, last = 0.80, count = 70;
  for (let k = 0; k < count; k++) {
    const u = first + (last - first) * (k / (count - 1));
    const x = Math.round(u * w), ww = Math.max(3, Math.round(w * 0.0028));
    ctx.fillStyle = winCol;
    ctx.beginPath(); ctx.roundRect(x, y0, ww, wh, Math.min(3, ww / 2)); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(x, y0, ww, 1);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;                 // v=0 gövdenin üstü (tuvalin ilk satırı)
  tex.anisotropy = 4;
  return tex;
}

// ---- Airbus kokpit ekranları: PFD, ND, ECAM ----
export function makeAirbusScreenTexture(kind = 'pfd', size = 256) {
  const w = size, h = Math.round(size * 0.85);
  const c = makeCanvas(w, h);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#05070a'; ctx.fillRect(0, 0, w, h);
  const cx = w / 2, cy = h / 2;
  if (kind === 'pfd') {
    // Yapay ufuk
    ctx.fillStyle = '#2f7fd0'; ctx.fillRect(w * 0.18, h * 0.08, w * 0.64, h * 0.34);
    ctx.fillStyle = '#8a5a26'; ctx.fillRect(w * 0.18, h * 0.42, w * 0.64, h * 0.30);
    ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, w / 180);
    ctx.beginPath(); ctx.moveTo(w * 0.18, h * 0.42); ctx.lineTo(w * 0.82, h * 0.42); ctx.stroke();
    for (const [f, ww] of [[0.30, 0.10], [0.36, 0.06], [0.48, 0.06], [0.54, 0.10]]) {
      ctx.beginPath(); ctx.moveTo(cx - w * ww / 2, h * f); ctx.lineTo(cx + w * ww / 2, h * f); ctx.stroke();
    }
    // Uçak sembolü (sarı)
    ctx.strokeStyle = '#ffd400'; ctx.lineWidth = Math.max(2, w / 90);
    ctx.beginPath(); ctx.moveTo(cx - w * 0.14, h * 0.42); ctx.lineTo(cx - w * 0.05, h * 0.42); ctx.moveTo(cx + w * 0.05, h * 0.42); ctx.lineTo(cx + w * 0.14, h * 0.42); ctx.stroke();
    // Hız ve irtifa şeritleri
    ctx.fillStyle = 'rgba(20,24,30,0.9)'; ctx.fillRect(w * 0.04, h * 0.08, w * 0.13, h * 0.64); ctx.fillRect(w * 0.83, h * 0.08, w * 0.13, h * 0.64);
    ctx.fillStyle = '#e8ecf0'; ctx.font = `bold ${Math.round(h * 0.055)}px monospace`; ctx.textAlign = 'center';
    for (let i = 0; i < 7; i++) { ctx.fillText(String(200 + i * 20), w * 0.105, h * (0.68 - i * 0.09)); ctx.fillText(String(60 + i * 5), w * 0.895, h * (0.68 - i * 0.09)); }
    ctx.strokeStyle = '#ffd400'; ctx.strokeRect(w * 0.04, h * 0.38, w * 0.13, h * 0.08); ctx.strokeRect(w * 0.83, h * 0.38, w * 0.13, h * 0.08);
    // FMA şeridi
    ctx.fillStyle = '#0b1016'; ctx.fillRect(0, 0, w, h * 0.07);
    ctx.fillStyle = '#2ee06a'; ctx.font = `bold ${Math.round(h * 0.05)}px monospace`;
    ctx.fillText('SPEED', w * 0.2, h * 0.05); ctx.fillText('NAV', w * 0.5, h * 0.05); ctx.fillText('ALT', w * 0.78, h * 0.05);
  } else if (kind === 'nd') {
    ctx.strokeStyle = '#d8dee6'; ctx.lineWidth = Math.max(1, w / 200);
    for (const r of [0.22, 0.34, 0.46]) { ctx.beginPath(); ctx.arc(cx, h * 0.78, w * r, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); }
    ctx.strokeStyle = '#2ee06a'; ctx.lineWidth = Math.max(2, w / 110);
    ctx.beginPath(); ctx.moveTo(cx, h * 0.78); ctx.lineTo(cx, h * 0.26); ctx.stroke();
    ctx.fillStyle = '#ffd400'; ctx.beginPath(); ctx.moveTo(cx, h * 0.70); ctx.lineTo(cx - w * 0.035, h * 0.80); ctx.lineTo(cx + w * 0.035, h * 0.80); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#e8ecf0'; ctx.font = `bold ${Math.round(h * 0.055)}px monospace`; ctx.textAlign = 'center';
    for (const [a, t] of [[1.15, 'W'], [1.5, 'N'], [1.85, 'E']]) {
      const x = cx + Math.cos(Math.PI * a) * w * 0.50, y = h * 0.78 + Math.sin(Math.PI * a) * w * 0.50;
      ctx.fillText(t, x, y);
    }
    ctx.fillStyle = '#2ee06a'; ctx.textAlign = 'left'; ctx.fillText('GS 240', w * 0.04, h * 0.09);
    ctx.fillStyle = '#c8a2ff'; ctx.fillText('TAS 258', w * 0.04, h * 0.17);
    ctx.fillStyle = '#e8ecf0'; ctx.textAlign = 'right'; ctx.fillText('10 NM', w * 0.96, h * 0.09);
  } else {
    // ECAM: N1 / EGT göstergeleri ve durum satırları
    ctx.strokeStyle = '#2a323c'; ctx.lineWidth = 1;
    ctx.fillStyle = '#e8ecf0'; ctx.font = `bold ${Math.round(h * 0.07)}px monospace`; ctx.textAlign = 'center';
    for (const side of [0.28, 0.72]) {
      ctx.strokeStyle = '#8a929c'; ctx.beginPath(); ctx.arc(w * side, h * 0.30, w * 0.13, Math.PI * 0.75, Math.PI * 2.25); ctx.stroke();
      ctx.strokeStyle = '#2ee06a'; ctx.lineWidth = Math.max(2, w / 80);
      ctx.beginPath(); ctx.arc(w * side, h * 0.30, w * 0.13, Math.PI * 0.75, Math.PI * 1.7); ctx.stroke();
      ctx.lineWidth = 1; ctx.fillStyle = '#2ee06a'; ctx.fillText('84.2', w * side, h * 0.33);
      ctx.fillStyle = '#e8ecf0'; ctx.font = `${Math.round(h * 0.05)}px monospace`;
      ctx.fillText('N1', w * side, h * 0.47); ctx.fillText('EGT 612', w * side, h * 0.55);
      ctx.font = `bold ${Math.round(h * 0.07)}px monospace`;
    }
    ctx.fillStyle = '#2ee06a'; ctx.font = `${Math.round(h * 0.055)}px monospace`; ctx.textAlign = 'left';
    ctx.fillText('ENG  1  2', w * 0.06, h * 0.72);
    ctx.fillText('FOB  18400 KG', w * 0.06, h * 0.82);
    ctx.fillStyle = '#ffd400'; ctx.fillText('SEAT BELTS  ON', w * 0.06, h * 0.92);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
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
