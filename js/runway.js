// Pist sistemi: tanımlayıcılar, işaretler, kaplama ve pist ışıkları — TEK kod yolu.
//
// İki havaalanı da pistini buradan kurar; böylece numara, yön ve işaret yerleşimi iki pistte
// aynı kurallardan gelir ve elle yazılmış (yanlış yöne dönmüş / esnemiş) bir doku kalmaz.
//
// Koordinat çerçevesi (pist yereli, metre): pist ortası (0, 0, 0); +X pist ekseni boyunca
// "A ucundan B ucuna" (A ucuna inen uçağın uçuş yönü), +Z bu yöne bakan pilotun SAĞI, +Y yukarı.
// world.js'teki havaalanı yerel çerçevesiyle aynıdır (airportLocal / airportWorld).
//
// Tanımlayıcı: pistin GERÇEK yönü pist uçlarının dünya koordinatlarından hesaplanır (HUD'daki
// uçak başı ya da sabit bir etiket kullanılmaz), manyetik sapma ile manyetik yöne çevrilir,
// en yakın 10°'ye yuvarlanır. Karşı uç 180° fazlasıdır. Paralel pistlerde L/C/R eki karşı uçta
// aynalanır (L <-> R).
//
// İşaret ölçüleri seçilen standarttan gelir (ICAO Annex 14 Cilt I Bölüm 5.2 ya da FAA AC
// 150/5340-1). Rakamlar bir doku değil, vektör vuruşlu GEOMETRİDİR: keskin kalır, saydamlık
// sıralaması gerektirmez ve diğer işaretlerle aynı çizim çağrısında birleşir.
import * as THREE from 'three';
import { HAZE_UNIFORMS } from './worldshade.js';

// ---------------------------------------------------------------------------
// Manyetik sapma
// ---------------------------------------------------------------------------
// Dünya kurgusaldır (gerçek bir coğrafi konumu yoktur), bu yüzden güvenilir bir manyetik sapma
// verisi YOKTUR ve uydurulmaz. Varsayılan 0°: manyetik = gerçek. Gerçek bir konuma bağlanırsa
// buraya (ya da havaalanı kaydındaki magVar alanına) o konumun yayımlanmış değeri yazılmalıdır.
// İşaret: DOĞU sapması pozitif. Manyetik yön = gerçek yön − doğu sapması.
export const MAGNETIC_VARIATION_DEG = 0;

const norm360 = (d) => ((d % 360) + 360) % 360;

/** Dünya düzleminde a'dan b'ye gerçek yön (derece; kuzey = −Z, doğu = +X). */
export function trueHeadingFromEnds(ax, az, bx, bz) {
  return norm360(Math.atan2(bx - ax, -(bz - az)) * 180 / Math.PI);
}

/** Gerçek yön + sapma -> manyetik yön (derece, 0..360). */
export function magneticHeading(trueDeg, magVarDeg = MAGNETIC_VARIATION_DEG) {
  return norm360(trueDeg - magVarDeg);
}

/**
 * Pist numarası (havacılık kuralı): manyetik yön / 10, en yakın tamsayı; 0 -> 36.
 * @param {boolean} leadingZero ICAO "09", FAA "9"
 */
export function designatorNumber(magDeg, leadingZero = true) {
  let n = Math.round(norm360(magDeg) / 10) % 36;
  if (n === 0) n = 36;
  return leadingZero ? String(n).padStart(2, '0') : String(n);
}

const MIRROR_SUFFIX = { L: 'R', R: 'L', C: 'C', '': '' };
/**
 * Bir pistin iki ucunun tanımlayıcıları.
 * @param {number} trueDeg A ucundan B ucuna gerçek yön (A ucuna inişin yönü)
 * @param {string} suffix A ucundan bakıldığında paralel pist eki ('', 'L', 'C', 'R')
 */
export function runwayDesignators(trueDeg, { magVar = MAGNETIC_VARIATION_DEG, leadingZero = true, suffix = '' } = {}) {
  const magA = magneticHeading(trueDeg, magVar), magB = norm360(magA + 180);
  return {
    trueA: norm360(trueDeg), trueB: norm360(trueDeg + 180), magA, magB,
    a: { num: designatorNumber(magA, leadingZero), suffix: suffix || '' },
    b: { num: designatorNumber(magB, leadingZero), suffix: MIRROR_SUFFIX[suffix || ''] },
  };
}
export const designatorText = (d) => d.num + (d.suffix || '');

// ---------------------------------------------------------------------------
// İşaret standartları (metre). Değerler ilgili belgenin anma ölçüleridir.
// ---------------------------------------------------------------------------
export const MARKING_STANDARDS = {
  // ICAO Annex 14 Vol I, 5.2 (Figure 5-3..5-6, Table 5-1)
  ICAO: {
    leadingZero: true,
    threshold: { offset: 6, len: 30, edgeMargin: 3, maxHalf: 27, stripes: [[60, 16], [45, 12], [30, 8], [23, 6], [18, 4]] },
    // Rakam yüksekliği en az 9 m (Fig. 5-3); eşik çizgilerinin 12 m ötesinde
    designation: { gap: 12, h: 9, w: 3.0, stroke: 0.75, digitGap: 1.5, rowGap: 3 },
    centerline: { stripe: 30, gap: 20, maxPeriod: 75 },
    // Table 5-1, LDA >= 2400 m: 400 m'de başlar, 45-60 x 6-10 m, iç kenarlar arası 18-22,5 m
    aiming: [[2400, 400, 60, 10, 18], [1200, 300, 45, 6, 18], [800, 250, 30, 4, 9], [0, 150, 30, 4, 6]],
    // 5.2.6: 150 m aralıklı çiftler; LDA'ya göre çift sayısı; nişan noktasına 50 m'den yakın çift silinir
    tdz: { spacing: 150, first: 150, len: 22.5, pairs: [[2400, 6], [1500, 4], [1200, 3], [900, 2], [0, 1]],
      // Fig. 5-6 (B) "mesafe kodlu": 1,8 m'lik şeritler, 1,5 m aralık
      coded: [3, 3, 2, 2, 1, 1], stripeW: 1.8, stripeGap: 1.5, basicW: 3, deleteNearAim: 50 },
    edgeW: 0.9,
    chevron: { minPad: 60, spacing: 30, w: 0.9 },
  },
  // FAA AC 150/5340-1 (precision instrument runway)
  FAA: {
    leadingZero: false,
    threshold: { offset: 6.1, len: 45.7, edgeMargin: 0.9, maxHalf: 30, stripes: [[60.9, 16], [45.7, 12], [30.4, 8], [22.8, 6], [18.2, 4]], stripeW: 1.75 },
    designation: { gap: 12.2, h: 18.3, w: 6.1, stroke: 1.4, digitGap: 4.6, rowGap: 6 },
    centerline: { stripe: 36.6, gap: 24.4, maxPeriod: 64 },
    aiming: [[0, 311, 45.7, 9.1, 21.9]],
    tdz: { spacing: 152.4, first: 152.4, len: 22.9, pairs: [[0, 6]], coded: [3, 2, 2, 2, 1, 1], stripeW: 1.83, stripeGap: 1.52, basicW: 1.83, deleteNearAim: 50, faaAimSlot: 1 },
    edgeW: 0.91,
    chevron: { minPad: 0, spacing: 30.5, w: 0.91 },
  },
};

// ---------------------------------------------------------------------------
// Vektör vuruşlu rakam/harf yazı tipi. Kutu: x 0..1 (genişlik), y 0..3 (yükseklik).
// Pist rakamlarının bloklu, dar biçimi (yükseklik ≈ 3 x genişlik).
// ---------------------------------------------------------------------------
function arc(cx, cy, rx, ry, a0, a1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + (a1 - a0) * (i / n)) * Math.PI / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
const G = {};
G['0'] = [{ closed: true, pts: [...arc(0.5, 2.5, 0.5, 0.5, 0, 180, 10), ...arc(0.5, 0.5, 0.5, 0.5, 180, 360, 10)] }];
G['1'] = [{ pts: [[0.12, 2.5], [0.6, 3], [0.6, 0]] }];
G['2'] = [{ pts: [...arc(0.5, 2.5, 0.5, 0.5, 180, -35, 11), [0, 0], [1, 0]] }];
G['3'] = [{ pts: [[0.04, 3], [0.96, 3], [0.42, 1.74], ...arc(0.5, 0.86, 0.5, 0.88, 90, -152, 14)] }];
G['4'] = [{ pts: [[0.74, 0], [0.74, 3], [0, 1.0], [1, 1.0]] }];
G['5'] = [{ pts: [[0.96, 3], [0.06, 3], [0, 1.68], ...arc(0.5, 0.84, 0.5, 0.84, 118, -152, 14)] }];
G['6'] = [{ pts: [...arc(0.5, 2.4, 0.5, 0.6, 32, 180, 8), ...arc(0.5, 0.8, 0.5, 0.8, 180, 540, 20)] }];
G['7'] = [{ pts: [[0, 3], [1, 3], [0.3, 0]] }];
G['8'] = [{ closed: true, pts: arc(0.5, 2.3, 0.43, 0.7, 0, 360, 18).slice(0, -1) }, { closed: true, pts: arc(0.5, 0.8, 0.5, 0.8, 0, 360, 20).slice(0, -1) }];
G['9'] = G['6'].map((s) => ({ ...s, pts: s.pts.map(([x, y]) => [1 - x, 3 - y]) }));
G.L = [{ pts: [[0, 3], [0, 0], [1, 0]] }];
G.C = [{ pts: [...arc(0.5, 2.5, 0.5, 0.5, 22, 180, 8), [0, 0.5], ...arc(0.5, 0.5, 0.5, 0.5, 180, 338, 8)] }];
G.R = [{ pts: [[0, 0], [0, 3], [0.45, 3], ...arc(0.45, 2.25, 0.55, 0.75, 90, -90, 10), [0, 1.5]] }, { pts: [[0.42, 1.5], [1, 0]] }];
export const GLYPHS = G;

// ---------------------------------------------------------------------------
// Düzlem çokgen biriktirici (y sabit). Üçgenler her zaman yukarı bakar (+Y normal):
// pist yereli -> metin ekseni eşlemesi ayna içerse bile sargı yönü burada düzeltilir.
// ---------------------------------------------------------------------------
class FlatBuilder {
  constructor() { this.pos = []; }
  tri(a, b, c, y) {
    // (b - a) x (c - a) y bileşeni: (bz-az)(cx-ax) - (bx-ax)(cz-az) > 0 ise normal +Y
    const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
    if (Math.abs(cr) < 1e-9) return;
    if (cr < 0) { const t = b; b = c; c = t; }
    this.pos.push(a[0], y, a[1], b[0], y, b[1], c[0], y, c[1]);
  }
  quad(a, b, c, d, y) { this.tri(a, b, c, y); this.tri(a, c, d, y); }
  /** Eksen hizalı dikdörtgen: merkez (x, z), X boyunca lx, Z boyunca wz */
  rect(x, z, lx, wz, y) {
    const hx = lx / 2, hz = wz / 2;
    this.quad([x - hx, z - hz], [x + hx, z - hz], [x + hx, z + hz], [x - hx, z + hz], y);
  }
  geometry() {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(this.pos);
    const n = new Float32Array(p.length);
    for (let i = 1; i < n.length; i += 3) n[i] = 1;
    const uv = new Float32Array((p.length / 3) * 2);
    for (let i = 0, j = 0; i < p.length; i += 3, j += 2) { uv[j] = p[i] / 20; uv[j + 1] = p[i + 2] / 20; }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.computeBoundingSphere();
    return g;
  }
  get triangles() { return this.pos.length / 9; }
}

/**
 * Bir çoklu çizgiyi kalınlaştırır (2B). Birleşim noktalarında parçalar dış köşenin gönye
 * noktasına kadar uzatılır (boşluk ya da diken kalmaz); açık uçlar düz kesilir.
 * map(x, y) -> [lx, lz]: yazı tipi metresinden pist yereline.
 */
function strokePolyline(B, pts, closed, halfW, map, y) {
  const n = pts.length, segs = closed ? n : n - 1;
  const dir = (i) => {
    const a = pts[i % n], b = pts[(i + 1) % n];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    return [dx / L, dy / L];
  };
  const ext = (d0, d1) => {
    const c = Math.max(-1, Math.min(1, d0[0] * d1[0] + d0[1] * d1[1]));
    const turn = Math.min(Math.acos(c), Math.PI / 2);
    return halfW * Math.tan(turn / 2);
  };
  for (let i = 0; i < segs; i++) {
    const p0 = pts[i % n], p1 = pts[(i + 1) % n];
    if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1e-6) continue;
    const d = dir(i), nx = -d[1], ny = d[0];
    const e0 = (closed || i > 0) ? ext(dir((i - 1 + segs) % segs), d) : 0;
    const e1 = (closed || i < segs - 1) ? ext(d, dir((i + 1) % segs)) : 0;
    const ax = p0[0] - d[0] * e0, ay = p0[1] - d[1] * e0, bx = p1[0] + d[0] * e1, by = p1[1] + d[1] * e1;
    B.quad(map(ax + nx * halfW, ay + ny * halfW), map(ax - nx * halfW, ay - ny * halfW),
      map(bx - nx * halfW, by - ny * halfW), map(bx + nx * halfW, by + ny * halfW), y);
  }
}

/**
 * Metin (rakam/harf) geometrisi. Glif kutusu: genişlik w, yükseklik h, vuruş t (metre).
 * place(gx, gy) -> [lx, lz]: metin uzayından (sağ, yukarı) pist yereline.
 */
function drawText(B, text, { w, h, stroke, digitGap }, place, y) {
  const chars = [...text];
  const total = chars.length * w + (chars.length - 1) * digitGap;
  const sx = w - stroke, sy = (h - stroke) / 3;
  chars.forEach((ch, k) => {
    const glyph = GLYPHS[ch];
    if (!glyph) return;
    const x0 = -total / 2 + k * (w + digitGap) + stroke / 2;
    const map = (gx, gy) => place(x0 + gx, stroke / 2 + gy);
    for (const s of glyph) {
      const pts = s.pts.map(([gx, gy]) => [gx * sx, gy * sy]);
      strokePolyline(B, pts, !!s.closed, stroke / 2, map, y);
    }
  });
}

function pick(table, value) {
  for (const row of table) if (value >= row[0]) return row;
  return table[table.length - 1];
}

/**
 * Pist işaret geometrileri (pist yereli). Dönüş: { white, yellow, layout }.
 * spec: { length, width, standard, ends: [{ text, suffix, displaced, pad }, {..}], centerlineW }
 *  ends[0] = A ucu (x = −L/2, okuma yönü +X), ends[1] = B ucu (x = +L/2, okuma yönü −X)
 */
export function buildRunwayMarkings(spec) {
  const S = MARKING_STANDARDS[spec.standard] || MARKING_STANDARDS.ICAO;
  const L = spec.length, W = spec.width, half = L / 2;
  // İşaretler kaplamanın 1,5 cm üstünde (derinlik sırası polygonOffset ile; havada süzülmez)
  const y = spec.y !== undefined ? spec.y : 0.03;
  const white = new FlatBuilder(), yellow = new FlatBuilder();
  const layout = { ends: [] };
  const lda = (e) => L - (e.displaced || 0);
  // s: eşikten pist içine mesafe (A ucunda +X, B ucunda −X); q: okuma yönüne göre SAĞ
  const toLocal = (endIdx, s, q) => (endIdx === 0 ? [-half + s, q] : [half - s, -q]);
  const rectS = (B, endIdx, s0, s1, q0, q1) => {
    const a = toLocal(endIdx, s0, q0), b = toLocal(endIdx, s1, q1);
    B.rect((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), y);
  };
  // Kenar şeritleri (side stripe): dış kenarı pist kenarında, tüm uzunlukta
  for (const side of [-1, 1]) white.rect(0, side * (W / 2 - S.edgeW / 2), L, S.edgeW, y);
  const desigEnd = [];
  spec.ends.forEach((e, ei) => {
    const D = e.displaced || 0;
    const T = S.threshold;
    // --- Eşik işareti
    // Şerit sayısı pist genişliğinden (tablo genişlikleri anma değeridir; %2 tolerans)
    const n = pick(T.stripes, W * 1.02)[1];
    const halfAvail = Math.min(W / 2 - T.edgeMargin, T.maxHalf);
    // Şerit genişliği = aralık; merkezde çift aralık (n·s = halfAvail). FAA'da şerit genişliği sabittir.
    const s = T.stripeW || halfAvail / n;
    const gap = T.stripeW ? T.stripeW : s;
    for (let k = 0; k < n / 2; k++) {
      const q0 = gap + k * (s + gap);   // merkezden şeridin iç kenarına (yarım çift aralık = gap)
      for (const sg of [-1, 1]) rectS(white, ei, D + T.offset, D + T.offset + T.len, sg * q0, sg * (q0 + s));
    }
    // --- Kaydırılmış eşik: enine şerit + eşiğe dönük oklar (yalnızca D > 0 ise)
    if (D > 0) {
      rectS(white, ei, D - 1.8, D, -(W / 2 - S.edgeW), W / 2 - S.edgeW);
      for (let sa = 12; sa + 30 < D - 6; sa += 50) {
        rectS(white, ei, sa, sa + 30, -0.45, 0.45);
        const tip = toLocal(ei, sa + 30, 0);
        for (const sg of [-1, 1]) {
          const back = toLocal(ei, sa + 30 - 6, sg * 3.6);
          strokePolyline(white, [tip, back], false, 0.45, (a, b) => [a, b], y);
        }
      }
    }
    // --- Pist ucu öncesi kaplamalı alan (blast pad): sarı ok başları (chevron) eşiğe dönük
    const pad = e.pad || 0;
    if (pad > S.chevron.minPad && D === 0) {
      const cw = S.chevron.w / 2;
      for (let sp = -pad + S.chevron.spacing * 0.5; sp < -6; sp += S.chevron.spacing) {
        // Tepe noktası eksende (eşiğe yakın), kollar 45° ile kenara iner
        const reach = W / 2 - 1.5;
        const apex = toLocal(ei, sp, 0);
        for (const sg of [-1, 1]) {
          const tip = toLocal(ei, sp - reach, sg * reach);
          if (sp - reach < -pad + 1) {
            // kenara ulaşmadan pad biterse kesilir
            const r = sp + pad - 1;
            if (r <= 0) continue;
            strokePolyline(yellow, [apex, toLocal(ei, sp - r, sg * r)], false, cw, (a, b) => [a, b], y);
          } else strokePolyline(yellow, [apex, tip], false, cw, (a, b) => [a, b], y);
        }
      }
    }
    // --- Tanımlayıcı (rakam + varsa ek). Okuma yönü: A ucunda +X, B ucunda −X.
    const Dg = S.designation;
    let sD = D + T.offset + T.len + Dg.gap;
    const place = (gx, gy) => toLocal(ei, sD + gy, gx);
    if (e.suffix) {
      // ek harf rakamların ALTINDA (eşiğe daha yakın) durur
      drawText(white, e.suffix, Dg, place, y);
      sD += Dg.h + Dg.rowGap;
    }
    drawText(white, e.text, Dg, place, y);
    sD += Dg.h;
    desigEnd.push(sD);
    // --- Nişan noktası ve temas bölgesi
    const L_ = lda(e);
    const aim = pick(S.aiming, L_);
    const aimS = D + aim[1], aimLen = aim[2], aimW = aim[3], inner = aim[4] / 2;
    for (const sg of [-1, 1]) rectS(white, ei, aimS, aimS + aimLen, sg * inner, sg * (inner + aimW));
    const Z = S.tdz;
    const pairs = pick(Z.pairs, L_)[1];
    const tdzList = [];
    for (let k = 0; k < pairs; k++) {
      const s0 = D + Z.first + k * Z.spacing, s1 = s0 + Z.len;
      // nişan noktasıyla çakışan ya da 50 m'den yakın çift silinir
      if (s1 > aimS - Z.deleteNearAim && s0 < aimS + aimLen + Z.deleteNearAim) continue;
      if (s1 > L_ / 2) break;   // pistin yarısını geçmez
      const cnt = spec.tdzPattern === 'basic' ? 1 : (Z.coded[k] || 1);
      const sw = spec.tdzPattern === 'basic' ? Z.basicW : Z.stripeW;
      for (let c = 0; c < cnt; c++) {
        const q0 = inner + c * (sw + Z.stripeGap);
        for (const sg of [-1, 1]) rectS(white, ei, s0, s1, sg * q0, sg * (q0 + sw));
      }
      tdzList.push([s0, s1, cnt]);
    }
    layout.ends.push({ text: e.text + (e.suffix || ''), designation: [desigEnd[ei] - Dg.h, desigEnd[ei]], aiming: [aimS, aimS + aimLen], tdz: tdzList, stripes: n, stripeW: s });
  });
  // --- Orta çizgi: iki tanımlayıcı arasında, uçlarda tanımlayıcıdan 12 m sonra başlar.
  // Şerit + aralık periyodu, şerit sayısı tam sığacak şekilde ayarlanır (iki uç simetrik).
  const C = S.centerline, cw = spec.centerlineW || 0.9;
  const c0 = -half + desigEnd[0] + 12, c1 = half - desigEnd[1] - 12;
  const avail = c1 - c0;
  let nS = Math.max(1, Math.floor((avail + C.gap) / (C.stripe + C.gap)));
  let gapC = nS > 1 ? (avail - nS * C.stripe) / (nS - 1) : 0;
  if (C.stripe + gapC > C.maxPeriod) { nS++; gapC = (avail - nS * C.stripe) / (nS - 1); }
  for (let k = 0; k < nS; k++) { const x0 = c0 + k * (C.stripe + gapC); white.rect(x0 + C.stripe / 2, 0, C.stripe, cw, y); }
  layout.centerline = { from: c0, to: c1, stripes: nS, stripe: C.stripe, gap: gapC, width: cw };
  return { white: white.geometry(), yellow: yellow.triangles ? yellow.geometry() : null, layout };
}

// ---------------------------------------------------------------------------
// Kaplama ve işaret malzemeleri: lastik izi, aşınma, kenarlarda açık ton (pist yereli
// konumla; ek doku ya da geometri yok). İşaretler de aynı lastik izinden kararır
// (temas bölgesi çizgileri gerçekte de lastikle örtülür).
// ---------------------------------------------------------------------------
const RUBBER_GLSL = `
  uniform float uRwyHalf; uniform float uRwyHalfW;
  varying vec2 vRwy;
  float rwyHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float rwyNoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(rwyHash(i), rwyHash(i + vec2(1.0, 0.0)), f.x), mix(rwyHash(i + vec2(0.0, 1.0)), rwyHash(i + vec2(1.0, 1.0)), f.x), f.y); }
  // 0..1: lastik birikintisi. Her iki eşikten ~120-950 m, eksen çevresinde; ana takım izlerinde yoğun.
  float rubberAt(vec2 p) {
    float sA = p.x + uRwyHalf, sB = uRwyHalf - p.x;
    float zone = max(smoothstep(110.0, 300.0, sA) * (1.0 - smoothstep(520.0, 980.0, sA)),
                     smoothstep(110.0, 300.0, sB) * (1.0 - smoothstep(520.0, 980.0, sB)));
    if (zone <= 0.0) return 0.0;
    float az = abs(p.y);
    float lat = exp(-pow((az - 4.2) / 2.6, 2.0)) * 0.85 + exp(-pow(az / 2.2, 2.0)) * 0.35 + 0.18 * (1.0 - smoothstep(6.0, 12.0, az));
    // boyuna çizgiler (tekerlek izleri) ve lekeli dağılım
    float streak = rwyNoise(vec2(p.x * 0.035, p.y * 1.7)) * 0.6 + rwyNoise(vec2(p.x * 0.11, p.y * 4.3)) * 0.4;
    float blot = rwyNoise(p * vec2(0.012, 0.06) + 3.7);
    return clamp(zone * lat * (0.45 + 0.75 * streak) * (0.65 + 0.6 * blot), 0.0, 1.0);
  }`;

function rwyShader(mat, kind, half, halfW) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uRwyHalf = { value: half };
    sh.uniforms.uRwyHalfW = { value: halfW };
    sh.vertexShader = 'varying vec2 vRwy;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRwy = position.xz;');
    const body = kind === 'pave' ? `
      {
        float rb = rubberAt(vRwy);
        float az = abs(vRwy.y);
        // seyrek kullanılan kenarlar daha açık ve gri, eksen hattında hafif yağ izi
        float edge = smoothstep(uRwyHalfW * 0.55, uRwyHalfW * 0.95, az);
        diffuseColor.rgb *= 1.0 + 0.10 * edge - 0.05 * exp(-az * az / 3.0);
        // büyük ölçekli yama/onarım tonları (kaplama parçaları)
        float pn = rwyNoise(vRwy * vec2(0.008, 0.05) + 11.0);
        diffuseColor.rgb *= 0.92 + 0.14 * pn;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.30, 0.30, 0.31), rb * 0.85);
      }` : `
      {
        float rb = rubberAt(vRwy);
        // boya aşınması: hafif lekeli, lastikli bölgede belirgin kararma
        float wn = rwyNoise(vRwy * vec2(0.9, 0.9)) * 0.5 + rwyNoise(vRwy * 0.21 + 5.0) * 0.5;
        diffuseColor.rgb *= 0.86 + 0.16 * wn;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.24, 0.24, 0.25), rb * 0.9);
      }`;
    sh.fragmentShader = RUBBER_GLSL + '\n' + sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n' + body);
  };
  mat.customProgramCacheKey = () => 'rwy-' + kind;
}

// ---------------------------------------------------------------------------
// Pist ışıkları: GL noktaları (tek çizim çağrısı). Boyut uzaklığa göre en az ~2 piksel:
// uzaktan nokta ışık kaynağı gibi seçilir, yakında gerçek armatür boyutundadır.
// Yönlü ışıklar: aDir yönünden bakana colA, arkadan bakana colB (eşik yeşil / pist sonu kırmızı,
// kenar ışıklarının son 600 m'si sarı). PAPI: bakış yükselme açısı ayarın üstündeyse beyaz,
// altındaysa kırmızı.
// ---------------------------------------------------------------------------
const LIGHT_VS = `
  attribute vec3 colA; attribute vec3 colB; attribute vec4 aDir;   // xy yön (yerel XZ), z tür (0 çok yönlü, 1 yönlü, 2 PAPI), w PAPI açısı (rad)
  uniform float uScale; uniform float uMinPx; uniform float uFar; uniform float hzCurv;
  varying vec3 vCol; varying float vA;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    { vec3 dc = wp.xyz - cameraPosition; wp.y -= (dc.x * dc.x + dc.z * dc.z) * hzCurv; }   // dünya eğriliği (çizim)
    vec3 toCam = cameraPosition - wp.xyz;
    float dist = length(toCam);
    vec3 dirW = normalize(mat3(modelMatrix) * vec3(aDir.x, 0.0, aDir.y));
    float facing = dot(normalize(vec3(toCam.x, 0.0, toCam.z)), dirW);
    vec3 col = colA; float a = 1.0;
    if (aDir.z > 0.5) {
      col = mix(colB, colA, smoothstep(-0.05, 0.05, facing));
      if (aDir.z > 1.5) {
        float elev = atan(toCam.y, length(toCam.xz));
        col = mix(vec3(1.0, 0.12, 0.08), vec3(1.0, 0.97, 0.92), smoothstep(aDir.w - 0.0009, aDir.w + 0.0009, elev));
        a = smoothstep(0.15, 0.45, facing);   // PAPI yalnızca yaklaşma yönünden görünür
      }
    }
    // Tek yönlü armatür (arka rengi siyah): arkadan bakınca görünmez
    if (aDir.z > 0.5 && dot(colB, vec3(1.0)) < 0.01) a *= smoothstep(-0.05, 0.15, facing);
    a *= 1.0 - smoothstep(uFar * 0.7, uFar, dist);
    vCol = col; vA = a;
    gl_Position = projectionMatrix * viewMatrix * wp;
    gl_PointSize = max(uMinPx, 0.45 * uScale / max(dist, 1.0)) * step(0.01, a);
  }`;
const LIGHT_FS = `
  varying vec3 vCol; varying float vA;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = dot(c, c) * 4.0;
    float core = 1.0 - smoothstep(0.35, 1.0, r);
    if (core <= 0.01) discard;
    gl_FragColor = vec4(vCol * (0.75 + 0.6 * (1.0 - r)), core * vA);
  }`;

/**
 * lights: [{ x, y, z, colA:[r,g,b], colB?:[r,g,b], dir?:[dx,dz], kind?:0|1|2, papi?: rad }]
 */
export function buildLightPoints(lights, { far = 12000, minPx = 2.0 } = {}) {
  const n = lights.length;
  const pos = new Float32Array(n * 3), ca = new Float32Array(n * 3), cb = new Float32Array(n * 3), ad = new Float32Array(n * 4);
  lights.forEach((l, i) => {
    pos[i * 3] = l.x; pos[i * 3 + 1] = l.y; pos[i * 3 + 2] = l.z;
    const A = l.colA, B = l.colB || l.colA;
    ca.set(A, i * 3); cb.set(B, i * 3);
    const d = l.dir || [1, 0];
    ad[i * 4] = d[0]; ad[i * 4 + 1] = d[1]; ad[i * 4 + 2] = l.kind || 0; ad[i * 4 + 3] = l.papi || 0;
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('colA', new THREE.BufferAttribute(ca, 3));
  g.setAttribute('colB', new THREE.BufferAttribute(cb, 3));
  g.setAttribute('aDir', new THREE.BufferAttribute(ad, 4));
  g.computeBoundingSphere();
  const mat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 400 }, uMinPx: { value: minPx }, uFar: { value: far }, hzCurv: HAZE_UNIFORMS.hzCurv },
    vertexShader: LIGHT_VS, fragmentShader: LIGHT_FS,
    transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false,
  });
  mat.userData.noHaze = true;
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = 4;
  const size = new THREE.Vector2();
  // Piksel ölçeği: çizim arabelleği yüksekliği x projeksiyon odak uzaklığı (her çizimde; yeniden
  // boyutlandırma ve FOV değişimi kendiliğinden izlenir)
  pts.onBeforeRender = (renderer, scene, camera) => {
    renderer.getDrawingBufferSize(size);
    mat.uniforms.uScale.value = size.y * camera.projectionMatrix.elements[5] * 0.5;
    mat.uniforms.uMinPx.value = minPx * Math.min(2, renderer.getPixelRatio());
  };
  return pts;
}

const WHITE = [1.0, 0.97, 0.88], YELLOW = [1.0, 0.78, 0.25], GREEN = [0.25, 1.0, 0.45], RED = [1.0, 0.16, 0.1];

/** Pist ışık listesi (pist yereli): kenar, eşik/son, yaklaşma (CAT I), PAPI. */
export function runwayLightList(spec, layout) {
  const L = spec.length, W = spec.width, half = L / 2, out = [];
  const y = 0.35;
  // Kenar ışıkları: 60 m aralık, kenarın 1,5 m dışında. Her iki yöne: pist sonuna kalan
  // son 600 m (ya da pistin üçte biri) sarı.
  const caution = Math.min(600, L / 3);
  const nE = Math.round(L / 60);
  for (let k = 0; k <= nE; k++) {
    const x = -half + (k / nE) * L;
    const toB = half - x, toA = x + half;
    for (const sg of [-1, 1]) {
      out.push({ x, y, z: sg * (W / 2 + 1.5), kind: 1, dir: [-1, 0], colA: toB < caution ? YELLOW : WHITE, colB: toA < caution ? YELLOW : WHITE });
    }
  }
  spec.ends.forEach((e, ei) => {
    const sgn = ei === 0 ? -1 : 1;                // uç x işareti
    const xT = sgn * half + -sgn * (e.displaced || 0);
    // Eşik (yaklaşana yeşil) / pist sonu (pistten bakana kırmızı): 3 m aralıklı sıra
    for (let z = -W / 2; z <= W / 2 + 0.01; z += 3) out.push({ x: xT, y, z, kind: 1, dir: [sgn, 0], colA: GREEN, colB: RED });
    // Yaklaşma ışıkları (ICAO CAT I): 900 m eksen, 30 m aralıklı 3'lü barret, 300 m'de 30 m'lik çapraz çubuk.
    // Gerçek bir havaalanında yalnızca DOĞRULANMIŞ veri varsa kurulur (uç kaydında approach: false).
    if (e.approach !== false) for (let d = 30; d <= 900; d += 30) {
      const x = xT + sgn * d;
      for (const zz of [-1.5, 0, 1.5]) out.push({ x, y: y + 0.4, z: zz, kind: 1, dir: [sgn, 0], colA: WHITE, colB: [0, 0, 0] });
      if (d === 300) for (let zz = -15; zz <= 15; zz += 2.5) if (Math.abs(zz) > 3) out.push({ x, y: y + 0.4, z: zz, kind: 1, dir: [sgn, 0], colA: WHITE, colB: [0, 0, 0] });
    }
    // PAPI: yaklaşan pilotun SOLUNDA, nişan noktası hizasında; kenardan 15 m, 9 m aralık.
    // Piste en yakın birim en yüksek ayar: 3°30', 3°10', 2°50', 2°30' (3° süzülüş: 2 beyaz 2 kırmızı)
    const aimS = (layout && layout.ends[ei]) ? layout.ends[ei].aiming[0] : 400;
    const xP = xT - sgn * aimS;
    const left = ei === 0 ? -1 : 1;              // A ucuna inen (+X) pilotun solu −Z
    const angles = [3.5, 3 + 10 / 60, 2 + 50 / 60, 2.5];
    if (e.papi !== false) angles.forEach((deg, k) => out.push({ x: xP, y: y + 0.5, z: left * (W / 2 + 15 + k * 9), kind: 2, dir: [sgn, 0], papi: deg * Math.PI / 180, colA: WHITE }));
  });
  return out;
}

/**
 * Tam pist: kaplama (pist + uç sahaları), beyaz/sarı işaretler, ışıklar. Pist yereli bir grup döner.
 * spec: { length, width, standard, ends, pad, centerlineW, tdzPattern, pavementMap, anisotropy, shadows }
 */
export function buildRunway(spec) {
  const grp = new THREE.Group();
  grp.name = 'runway';
  const L = spec.length, W = spec.width, half = L / 2;
  const disposables = [];
  // Kaplama: pist + iki uçta pist öncesi kaplamalı alan
  const pave = new FlatBuilder();
  pave.rect(0, 0, L, W, 0.015);
  for (const [ei, e] of spec.ends.entries()) {
    const pad = e.pad || 0;
    if (pad > 0) pave.rect((ei === 0 ? -1 : 1) * (half + pad / 2), 0, pad, W, 0.015);
  }
  const paveGeo = pave.geometry();
  // UV: 18 m'lik döşeme (eski asfalt ölçeği)
  const uv = paveGeo.attributes.uv, p = paveGeo.attributes.position;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / 18, p.getZ(i) / 18);
  const paveMat = new THREE.MeshStandardMaterial({ map: spec.pavementMap, roughness: 0.9, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  rwyShader(paveMat, 'pave', half, W / 2);
  const paveMesh = new THREE.Mesh(paveGeo, paveMat);
  paveMesh.receiveShadow = !!spec.shadows;
  paveMesh.name = 'runway-pavement';
  grp.add(paveMesh);
  const M = buildRunwayMarkings(spec);
  const whiteMat = new THREE.MeshStandardMaterial({ color: 0xeeeee8, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  rwyShader(whiteMat, 'paint', half, W / 2);
  const wm = new THREE.Mesh(M.white, whiteMat);
  wm.receiveShadow = !!spec.shadows;
  wm.name = 'runway-markings';
  grp.add(wm);
  disposables.push(paveGeo, paveMat, M.white, whiteMat);
  if (M.yellow) {
    const ym = new THREE.MeshStandardMaterial({ color: 0xe0b52c, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
    const mesh = new THREE.Mesh(M.yellow, ym);
    mesh.receiveShadow = !!spec.shadows;
    mesh.name = 'runway-chevrons';
    grp.add(mesh);
    disposables.push(M.yellow, ym);
  }
  return { group: grp, layout: M.layout, disposables, lights: runwayLightList(spec, M.layout) };
}

// Sabitler dış kullanım için (taksi yolu ışıkları vb.)
export const LIGHT_COLORS = { WHITE, YELLOW, GREEN, RED, BLUE: [0.25, 0.45, 1.0], AMBER: [1.0, 0.62, 0.15] };
