// Havaalanı kaplama planı: pist, taksi yolları (kavşak dolgu yaylarıyla), apronlar, taksi yolu
// işaretleri, levhalar ve taksi yolu ışıkları — TEK veri kaynağından.
//
// Aynı plan hem ÇİZİMİ hem de fiziğin yüzey sorgusunu (surfaceTypeAt: tekerlek sürtünmesi,
// pist dışı denetimi) besler: görünen beton ile tekerleğin "gördüğü" beton birebir aynıdır.
//
// Çerçeve: havaalanı yereli (world.js airportLocal): +X pist ekseni (A ucundan B ucuna), +Z
// bu yöne bakan pilotun sağı. Tüm dikdörtgenler eksen hizalıdır ve BİRBİRİNİN ÜSTÜNE BİNMEZ:
// bağlantı taksi yolları pist kenarından paralel taksi yolunun kenarına kadar uzanır, kavşak
// köşeleri ayrı dolgu yaylarıyla (fillet) kapanır. Böylece eş düzlemli üst üste binen yüzey,
// derinlik yarışı (z-fighting) ve "üst üste yığılmış" görünüm oluşmaz.
import * as THREE from 'three';
import { LIGHT_COLORS } from './runway.js';

const EPS = 0.01;

/**
 * Plan kurar. def:
 *  runway: { len, w, pad }
 *  taxiways: [{ id, axis:'x'|'z', c, from, to, w, holdFor?: { side } }]   axis: uzandığı eksen
 *  aprons: [{ x0, x1, z0, z1, kind? }]
 *  filletR: kavşak dolgu yarıçapı
 */
export function makeAirfieldPlan(def) {
  const rects = [];
  const R = def.runway, hl = R.len / 2, hw = R.w / 2;
  rects.push({ type: 'runway', x0: -hl - (R.pad || 0), x1: hl + (R.pad || 0), z0: -hw, z1: hw, id: 'RWY' });
  for (const t of def.taxiways) {
    const h = t.w / 2;
    const r = t.axis === 'x' ? { x0: t.from, x1: t.to, z0: t.c - h, z1: t.c + h } : { x0: t.c - h, x1: t.c + h, z0: t.from, z1: t.to };
    rects.push({ type: 'taxiway', ...r, id: t.id, tw: t });
  }
  for (const a of def.aprons) rects.push({ type: 'apron', x0: a.x0, x1: a.x1, z0: a.z0, z1: a.z1, id: a.id || 'apron', kind: a.kind || 'apron' });
  const plan = { def, rects, fillets: [] };
  // Kavşak dolguları: bir taksi yolunun ucu başka bir kaplamanın kenarına değiyorsa ve o kaplama
  // köşenin ötesine uzanıyorsa (iç bükey köşe) köşeye çeyrek daire dolgu eklenir.
  const r = def.filletR || 30;
  const overlapsPaved = (x0, x1, z0, z1) => rects.some((q) => x0 < q.x1 - EPS && x1 > q.x0 + EPS && z0 < q.z1 - EPS && z1 > q.z0 + EPS);
  for (const L of rects) {
    if (L.type !== 'taxiway') continue;
    const vertical = L.tw.axis === 'z';
    for (const O of rects) {
      if (O === L) continue;
      // Uç kenar eşleşmesi: dikey taksi yolunun z uçları / yatayın x uçları
      const ends = vertical
        ? [[L.z0, O.z1, +1], [L.z1, O.z0, -1]]
        : [[L.x0, O.x1, +1], [L.x1, O.x0, -1]];
      for (const [eL, eO, s] of ends) {
        if (Math.abs(eL - eO) > EPS) continue;
        if (vertical) {
          if (O.x0 > L.x0 + EPS || O.x1 < L.x1 - EPS) continue;           // O ucu tam örtmeli
          for (const [px, sx] of [[L.x0, -1], [L.x1, +1]]) {
            const reach = sx < 0 ? px - O.x0 : O.x1 - px;
            if (reach < r - EPS) continue;
            const fx0 = sx < 0 ? px - r : px, fx1 = sx < 0 ? px : px + r, fz0 = s > 0 ? eL : eL - r, fz1 = s > 0 ? eL + r : eL;
            if (overlapsPaved(fx0, fx1, fz0, fz1)) continue;
            plan.fillets.push({ px, pz: eL, sx, sz: s, r, type: 'taxiway' });
          }
        } else {
          if (O.z0 > L.z0 + EPS || O.z1 < L.z1 - EPS) continue;
          for (const [pz, sz] of [[L.z0, -1], [L.z1, +1]]) {
            const reach = sz < 0 ? pz - O.z0 : O.z1 - pz;
            if (reach < r - EPS) continue;
            const fz0 = sz < 0 ? pz - r : pz, fz1 = sz < 0 ? pz : pz + r, fx0 = s > 0 ? eL : eL - r, fx1 = s > 0 ? eL + r : eL;
            if (overlapsPaved(fx0, fx1, fz0, fz1)) continue;
            plan.fillets.push({ px: eL, pz, sx: s, sz, r, type: 'taxiway' });
          }
        }
      }
    }
  }
  plan.bounds = rects.reduce((b, q) => ({ x0: Math.min(b.x0, q.x0), x1: Math.max(b.x1, q.x1), z0: Math.min(b.z0, q.z0), z1: Math.max(b.z1, q.z1) }), { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity });
  return plan;
}

/** Yerel noktadaki kaplama tipi ('runway' | 'taxiway' | 'apron') ya da null. */
export function planSurfaceAt(plan, x, z) {
  const B = plan.bounds;
  if (x < B.x0 - 60 || x > B.x1 + 60 || z < B.z0 - 60 || z > B.z1 + 60) return null;
  for (const q of plan.rects) if (x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1) return q.type;
  for (const f of plan.fillets) {
    const u = (x - f.px) * f.sx, v = (z - f.pz) * f.sz;
    if (u < 0 || v < 0 || u > f.r || v > f.r) continue;
    // köşe ile yay arasındaki bölge: yay merkezinden uzaklık > r
    if (Math.hypot(u - f.r, v - f.r) >= f.r) return f.type;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Geometri yardımcıları
// ---------------------------------------------------------------------------
function flatRect(pos, uv, x0, x1, z0, z1, y, uvScale) {
  const p = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];
  // +Y normal için sargı: (x0,z0) -> (x0,z1) -> (x1,z1)
  for (const [a, b, c] of [[0, 3, 2], [0, 2, 1]]) for (const k of [a, b, c]) { pos.push(p[k][0], y, p[k][1]); uv.push(p[k][0] / uvScale, p[k][1] / uvScale); }
}
function filletFan(pos, uv, f, y, uvScale, seg = 8) {
  const cx = f.px + f.sx * f.r, cz = f.pz + f.sz * f.r;
  // Yay: köşenin iki kolundaki teğet noktalarını birleştirir (merkez köşenin karşısında)
  const a0 = Math.atan2(f.pz - cz, 0);
  let a1 = Math.atan2(0, f.px - cx);
  // kısa yay (90°): köşeye bakan çeyrek
  if (a1 - a0 > Math.PI) a1 -= 2 * Math.PI; else if (a1 - a0 < -Math.PI) a1 += 2 * Math.PI;
  const pts = [];
  for (let i = 0; i <= seg; i++) {
    const a = a0 + (a1 - a0) * (i / seg);
    pts.push([cx + Math.cos(a) * f.r, cz + Math.sin(a) * f.r]);
  }
  for (let i = 0; i < seg; i++) {
    const A = [f.px, f.pz], B = pts[i], C = pts[i + 1];
    const cr = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
    const tri = cr >= 0 ? [A, B, C] : [A, C, B];
    for (const q of tri) { pos.push(q[0], y, q[1]); uv.push(q[0] / uvScale, q[1] / uvScale); }
  }
}
function geo(pos, uv) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeBoundingSphere();
  return g;
}
// Kalın çizgi (yerel düzlemde): şerit dörtgenleri; yay için çoklu çizgi
function lineStrip(pos, pts, w, y) {
  const h = w / 2;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
    if (L < 1e-4) continue;
    const nx = -dz / L * h, nz = dx / L * h;
    // küçük uzatma: yay parçaları arasında boşluk kalmasın
    const ex = dx / L * h * 0.6, ez = dz / L * h * 0.6;
    const q = [[ax - ex + nx, az - ez + nz], [ax - ex - nx, az - ez - nz], [bx + ex - nx, bz + ez - nz], [bx + ex + nx, bz + ez + nz]];
    for (const [a, b, c] of [[0, 1, 2], [0, 2, 3]]) {
      const A = q[a], B = q[b], C = q[c];
      const cr = (B[1] - A[1]) * (C[0] - A[0]) - (B[0] - A[0]) * (C[1] - A[1]);
      const tri = cr >= 0 ? [A, B, C] : [A, C, B];
      for (const v of tri) pos.push(v[0], y, v[1]);
    }
  }
}
function arcPts(cx, cz, r, a0, a1, n = 10) {
  const out = [];
  for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * (i / n); out.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); }
  return out;
}

// ---------------------------------------------------------------------------
// Levha atlası (canvas): zorunlu talimat (kırmızı zemin, beyaz yazı), konum (siyah zemin,
// sarı yazı + sarı çerçeve), yön (sarı zemin, siyah yazı). ICAO Annex 14, 5.4.
// ---------------------------------------------------------------------------
function makeSignAtlas(faces) {
  const cellW = 256, cellH = 64, cols = 2;
  const rows = Math.ceil((faces.length + 1) / cols);
  const c = document.createElement('canvas');
  c.width = cellW * cols; c.height = THREE.MathUtils.ceilPowerOfTwo(cellH * rows);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#1b1d20'; ctx.fillRect(0, 0, c.width, c.height);
  const cells = [];
  const all = [{ parts: [] }, ...faces];   // hücre 0: koyu kasa rengi
  all.forEach((f, i) => {
    const cx = (i % cols) * cellW, cy = Math.floor(i / cols) * cellH;
    let x = cx;
    const totalW = cellW;
    const widths = f.parts.map((p) => p.weight || 1);
    const sum = widths.reduce((a, b) => a + b, 0) || 1;
    f.parts.forEach((p, k) => {
      const w = Math.round(totalW * widths[k] / sum);
      const bg = p.style === 'mandatory' ? '#c4161c' : p.style === 'location' ? '#111214' : '#f2c21b';
      const fg = p.style === 'mandatory' ? '#ffffff' : p.style === 'location' ? '#f2c21b' : '#111214';
      ctx.fillStyle = bg; ctx.fillRect(x, cy, w, cellH);
      if (p.style === 'location') { ctx.strokeStyle = fg; ctx.lineWidth = 4; ctx.strokeRect(x + 6, cy + 6, w - 12, cellH - 12); }
      ctx.fillStyle = fg;
      ctx.font = 'bold 40px Arial, Helvetica, sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(p.text, x + w / 2, cy + cellH / 2 + 2);
      x += w;
    });
    cells.push({ u0: cx / c.width, u1: (cx + cellW) / c.width, v0: 1 - (cy + cellH) / c.height, v1: 1 - cy / c.height });
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return { tex, cells };
}

/**
 * Kaplama, işaret, levha ve ışık nesnelerini kurar. Dönüş: { group, lights, disposables }.
 * opts: { asphaltMap, concreteMap, shadows, holdDist, runwayLabel: [aText, bText], minHoldClear }
 */
export function buildAirfield(plan, opts) {
  const grp = new THREE.Group();
  grp.name = 'airfield';
  const disposables = [];
  const D = plan.def;
  // --- Kaplama: taksi yolları + dolgular (asfalt), apronlar (beton)
  const tp = [], tuv = [], ap = [], auv = [];
  for (const q of plan.rects) {
    if (q.type === 'taxiway') flatRect(tp, tuv, q.x0, q.x1, q.z0, q.z1, 0.05, 18);
    else if (q.type === 'apron') flatRect(ap, auv, q.x0, q.x1, q.z0, q.z1, 0.06, 30);
  }
  for (const f of plan.fillets) filletFan(tp, tuv, f, 0.05, 18);
  const taxiMat = new THREE.MeshStandardMaterial({ map: opts.asphaltMap, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const apronMat = new THREE.MeshStandardMaterial({ map: opts.concreteMap, roughness: 0.86, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -3 });
  const tg = geo(tp, tuv), ag = geo(ap, auv);
  const tm = new THREE.Mesh(tg, taxiMat), am = new THREE.Mesh(ag, apronMat);
  tm.receiveShadow = am.receiveShadow = !!opts.shadows;
  tm.name = 'taxiways'; am.name = 'aprons';
  grp.add(tm, am);
  disposables.push(tg, ag, taxiMat, apronMat);

  // --- Sarı işaretler: taksi yolu orta çizgisi (kavşaklarda eğrisel dönüşler), pist bekleme
  // noktası (ICAO desen A: 2 düz + 2 kesik çizgi, düz çizgiler taksi yolu tarafında),
  // apron kenarındaki taksi yolu kenar şeritleri (çift çizgi).
  const yel = [];
  const yH = 0.075, CLW = 0.3;
  const RW = D.runway.w / 2;
  const holdDist = opts.holdDist || 90;
  const turnR = 26;
  const signs = [], lights = [];
  const parallel = D.taxiways.filter((t) => t.axis === 'x');
  for (const t of D.taxiways) {
    if (t.axis === 'x') {
      // Uçtaki bağlantıya kıvrılan yay varsa orta çizgi yayın bittiği yerde başlar (taksi
      // yolunun bittiği uçta ileri uzanan kör çizgi kalmaz)
      let x0 = t.from + 12, x1 = t.to - 12;
      for (const o of D.taxiways) {
        if (o.axis !== 'z') continue;
        const touches = Math.abs(o.to - (t.c - t.w / 2)) < EPS || Math.abs(o.from - (t.c + t.w / 2)) < EPS;
        if (!touches) continue;
        if (o.c - o.w / 2 <= t.from + EPS) x0 = Math.max(x0, o.c + turnR);
        if (o.c + o.w / 2 >= t.to - EPS) x1 = Math.min(x1, o.c - turnR);
      }
      lineStrip(yel, [[x0, t.c], [x1, t.c]], CLW, yH);
      continue;
    }
    // Dikey bağlantı: uçları
    const runwaySide = Math.abs(t.from - RW) < EPS ? 'from' : Math.abs(t.to + RW) < EPS ? 'to' : null;
    const zRw = runwaySide === 'from' ? t.from : runwaySide === 'to' ? t.to : null;
    const zOther = runwaySide === 'from' ? t.to : runwaySide === 'to' ? t.from : null;
    const dir = runwaySide === 'from' ? 1 : -1;     // pistten taksi yoluna doğru +z mi
    // Bağlandığı paralel taksi yolu: bağlantının pist dışındaki ucu, paralelin yakın kenarıdır
    const par = zOther === null ? null : parallel.find((p) => Math.abs((p.c - dir * p.w / 2) - zOther) < EPS && t.c >= p.from - EPS && t.c <= p.to + EPS);
    if (zRw !== null && par) {
      // pist kenarından (yan şeridin hemen içi) paralel taksi yolu orta çizgisine kadar düz, sonra dönüş yayları
      const z0 = zRw - dir * 1.5, zT = par.c - dir * turnR;
      lineStrip(yel, [[t.c, z0], [t.c, zT]], CLW, yH);
      for (const sx of [-1, 1]) {
        if (t.c + sx * turnR < par.from + 5 || t.c + sx * turnR > par.to - 5) continue;
        // yay merkezi (t.c + sx*R, par.c - dir*R): (t.c, par.c - dir*R) -> (t.c + sx*R, par.c)
        const cx = t.c + sx * turnR, cz = par.c - dir * turnR;
        const aStart = Math.atan2(0, t.c - cx), aEnd = Math.atan2(par.c - cz, 0);
        let a0 = aStart, a1 = aEnd;
        if (Math.abs(a1 - a0) > Math.PI) a1 += a1 < a0 ? 2 * Math.PI : -2 * Math.PI;
        lineStrip(yel, arcPts(cx, cz, turnR, a0, a1, 12), CLW, yH);
      }
      // Pist bekleme noktası: pist ekseninden holdDist, taksi yolu boyunca tam genişlik
      const zh = dir * holdDist;
      const hw = t.w / 2;
      // taksi yolu tarafından pist tarafına: düz, düz, kesik, kesik (0,15 m çizgi, 0,15 m aralık)
      for (let k = 0; k < 4; k++) {
        const zc = zh + dir * (0.6 - k * 0.3) ;   // k=0 taksi yolu tarafı
        if (k < 2) lineStrip(yel, [[t.c - hw + 0.5, zc], [t.c + hw - 0.5, zc]], 0.15, yH);
        else for (let x = t.c - hw + 0.5; x < t.c + hw - 0.5; x += 1.8) lineStrip(yel, [[x, zc], [Math.min(x + 0.9, t.c + hw - 0.5), zc]], 0.15, yH);
      }
      // Levhalar: bekleme noktasında, taksi yolu kenarından 12 m dışarıda, iki yanda.
      // Pilot pisti karşısında görür (yüzü taksi yoluna, yani pistten uzağa bakar).
      // Zorunlu levha yazısı: pilotun SOLUNDAKİ pist ucu önce (ör. "09-27").
      // Pilot -dir yönünde (piste doğru) ilerler; solu: dir=+1 (−z'ye bakıyor) -> −X; dir=−1 -> +X
      const leftIsA = dir > 0;
      const rw = opts.runwayLabel;
      const mand = leftIsA ? `${rw[0]}-${rw[1]}` : `${rw[1]}-${rw[0]}`;
      for (const sx of [-1, 1]) {
        signs.push({ x: t.c + sx * (hw + 12), z: zh + dir * 2, facing: dir, parts: sx === (leftIsA ? -1 : 1)
          ? [{ text: t.id, style: 'location', weight: 0.8 }, { text: mand, style: 'mandatory', weight: 1.4 }]
          : [{ text: mand, style: 'mandatory', weight: 1.4 }, { text: t.id, style: 'location', weight: 0.8 }] });
      }
      // Taksi yolu kenar ışıkları (mavi): bekleme noktasından taksi yoluna 30 m aralık
      for (let z = zRw + dir * 20; dir > 0 ? z < zOther - 8 : z > zOther + 8; z += dir * 30) {
        lights.push({ x: t.c - hw - 1.2, y: 0.3, z, colA: LIGHT_COLORS.BLUE }, { x: t.c + hw + 1.2, y: 0.3, z, colA: LIGHT_COLORS.BLUE });
      }
    } else {
      // Pist bağlantısı olmayan dikey taksi yolu: düz orta çizgi
      lineStrip(yel, [[t.c, t.from + 2], [t.c, t.to - 2]], CLW, yH);
    }
  }
  // Paralel taksi yolu kenar ışıkları: apron sınırında olmayan kenarlarda 60 m aralık
  // Kenar apronla bitişikse ışık yok (orada kaplama devam eder)
  const isApronEdge = (x, zEdge) => plan.rects.some((q) => q.type === 'apron' && x >= q.x0 - 1 && x <= q.x1 + 1
    && (Math.abs(zEdge - q.z0) < 0.5 || Math.abs(zEdge - q.z1) < 0.5));
  const nearLink = (x) => D.taxiways.some((o) => o.axis === 'z' && Math.abs(o.c - x) < o.w / 2 + 34);
  for (const t of parallel) {
    for (let x = t.from + 10; x <= t.to - 10; x += 60) {
      if (nearLink(x)) continue;
      for (const sz of [-1, 1]) {
        const z = t.c + sz * (t.w / 2 + 1.2);
        if (isApronEdge(x, t.c + sz * t.w / 2)) continue;
        lights.push({ x, y: 0.3, z, colA: LIGHT_COLORS.BLUE });
      }
    }
  }
  // Apron sınırındaki taksi yolu kenar şeritleri (çift sarı çizgi, 0,15 m / 0,15 m)
  for (const q of plan.rects) {
    if (q.type !== 'apron' || q.kind !== 'apron') continue;
    for (const t of parallel) {
      for (const edge of [t.c - t.w / 2, t.c + t.w / 2]) {
        if (Math.abs(edge - q.z0) > EPS && Math.abs(edge - q.z1) > EPS) continue;
        const x0 = Math.max(q.x0, t.from) + 1, x1 = Math.min(q.x1, t.to) - 1;
        if (x1 <= x0) continue;
        const inward = edge > t.c ? -1 : 1;
        for (const off of [0.3, 0.6]) lineStrip(yel, [[x0, edge + inward * off], [x1, edge + inward * off]], 0.15, yH);
      }
    }
  }
  const yGeo = new THREE.BufferGeometry();
  yGeo.setAttribute('position', new THREE.Float32BufferAttribute(yel, 3));
  { const n = new Float32Array(yel.length); for (let i = 1; i < n.length; i += 3) n[i] = 1; yGeo.setAttribute('normal', new THREE.BufferAttribute(n, 3)); }
  yGeo.computeBoundingSphere();
  const yMat = new THREE.MeshStandardMaterial({ color: 0xe2b72e, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
  const ym = new THREE.Mesh(yGeo, yMat);
  ym.name = 'taxi-markings';
  grp.add(ym);
  disposables.push(yGeo, yMat);

  // --- Levhalar: tek ağ (kasa + yüz), atlas dokusu
  if (signs.length && typeof document !== 'undefined') {
    const faces = signs.map((s) => ({ parts: s.parts }));
    const atlas = makeSignAtlas(faces);
    const parts = [];
    signs.forEach((s, i) => {
      const w = 4.2, h = 1.0, d = 0.35, y0 = 0.55;
      const box = new THREE.BoxGeometry(w, h, d);
      const uv = box.attributes.uv, cell = atlas.cells[i + 1], dark = atlas.cells[0];
      // BoxGeometry yüz sırası: +x, -x, +y, -y, +z, -z (her biri 4 köşe)
      for (let f = 0; f < 6; f++) {
        const c = f === 4 ? cell : dark;
        for (let k = 0; k < 4; k++) {
          const idx = f * 4 + k, u = uv.getX(idx), v = uv.getY(idx);
          uv.setXY(idx, f === 4 ? c.u0 + u * (c.u1 - c.u0) : dark.u0 + 0.02, f === 4 ? c.v0 + v * (c.v1 - c.v0) : dark.v0 + 0.02);
        }
      }
      // ön yüz (+z) pistten uzağa, taksi yoluna dönük olsun: facing=+1 -> yüz +z
      if (s.facing < 0) box.rotateY(Math.PI);
      box.translate(s.x, y0 + h / 2, s.z);
      parts.push(box.toNonIndexed());
      for (const lx of [-1.6, 1.6]) {
        const leg = new THREE.BoxGeometry(0.12, y0, 0.12);
        const luv = leg.attributes.uv; for (let k = 0; k < luv.count; k++) luv.setXY(k, dark.u0 + 0.02, dark.v0 + 0.02);
        leg.translate(s.x + lx, y0 / 2, s.z);
        parts.push(leg.toNonIndexed());
      }
    });
    const merged = mergeFlat(parts);
    parts.forEach((g) => g.dispose());
    const sMat = new THREE.MeshStandardMaterial({ map: atlas.tex, roughness: 0.7, emissive: 0xffffff, emissiveMap: atlas.tex, emissiveIntensity: 0.08 });
    const sm = new THREE.Mesh(merged, sMat);
    sm.name = 'taxi-signs';
    sm.castShadow = !!opts.shadows;
    grp.add(sm);
    disposables.push(merged, sMat, atlas.tex);
  }
  return { group: grp, lights, disposables };
}

function mergeFlat(geos) {
  let n = 0;
  for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nrm.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}
