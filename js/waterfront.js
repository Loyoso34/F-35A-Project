// Sahil şehri rıhtımı: haritanın simge bölgesi.
// Şehir merkezinin güneyindeki ~3,3 km'lik kıyı şeridi tek bir tasarım olarak kurulur
// (batıdan doğuya): kruvaziyer terminali + gemi, marina (dalgakıranlar, deniz fenerleri,
// yüzer iskeleler, yatlar), plaj ve otel promenadı, dönme dolaplı eğlence iskelesi.
// Kıyının iki ucu doğal kıyıya yumuşakça bağlanır; doğudaki yüksek burun doğal kayalık
// kıyı olarak kalır.
//
// Koordinatlar: rıhtım hattı L(x) yumuşak bir eğridir (kıyı çizgisinin ~380 m denizinde).
// Yerleşim eğrisel (x, v) koordinatlarıyla yapılır: P(x, v) = L(x) + N(x) * v; v hatta dik
// uzaklıktır (+ deniz yönü). Böylece promenat, yollar ve yapılar kıyının kavsini izler.
//
// Arazi: hattın kara tarafı düz bir teras (deniz seviyesinin 3,5 m üstü), deniz tarafı rıhtım
// önünde derin su (gemi ve yatlar için), plaj kesiminde yumuşak eğim. Arazi ızgarası (~62 m)
// düşey bir rıhtım duvarını çözemez; eğim bu yüzden rıhtım güvertesinin ALTINDA kalır:
// güverte hattan 45-110 m denize uzanır, ön yüzü su altına inen düşey bir duvardır.
//
// Performans: her şey birleştirilmiş statik ağ ya da InstancedMesh (~18 çizim çağrısı).
// Küçük ayrıntılar (yatlar, palmiyeler, şemsiyeler, arabalar, gondollar) uzakta kapanır.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32, smoothstep, clamp, lerp } from './noise.js';
import { makeFacadeTexture, makePavingTexture, makeBalconyTexture, makeParkingTexture } from './textures.js';

const WL = -4;   // deniz seviyesi (world.js WATER_LEVEL ile aynı; döngüsel içe aktarmadan kaçınmak için)
export const WF = { x0: 2550, x1: 5900, terrace: WL + 3.5, seabed: WL - 13, deck: WL + 3.85 };
// Bölümler (x aralıkları)
export const WF_PARTS = { cruise: [2550, 3470], marina: [3580, 4470], beach: [4570, 5250], pier: [5330, 5880] };
const PIER_X = 5560;            // eğlence iskelesinin kökü
const SHIP_X = 3010;            // kruvaziyer gemisinin ortası
const MARINA_ARMS = { west: 3600, east: 4450, wEnd: 3985, eEnd: 4085 };

// Rıhtım hattı kontrol noktaları (x artan): kıyı çizgisinin ~380 m denizinde, yumuşatılmış
const LINE = [[1500, 22060], [2300, 21960], [2800, 21900], [3300, 21840], [3800, 21600], [4300, 21230], [4800, 20960], [5300, 20860], [5800, 20990], [6200, 21250], [6700, 21430], [7300, 21500]];
function lineRaw(x) {
  const P = LINE, n = P.length;
  if (x <= P[0][0]) return P[0][1];
  if (x >= P[n - 1][0]) return P[n - 1][1];
  let i = 0; while (x > P[i + 1][0]) i++;
  const x0 = P[i][0], x1 = P[i + 1][0], h = x1 - x0, t = (x - x0) / h, t2 = t * t, t3 = t2 * t;
  const m = (k) => { const a = P[Math.max(0, k - 1)], b = P[Math.min(n - 1, k + 1)]; return (b[1] - a[1]) / (b[0] - a[0]); };
  return (2 * t3 - 3 * t2 + 1) * P[i][1] + (t3 - 2 * t2 + t) * m(i) * h + (-2 * t3 + 3 * t2) * P[i + 1][1] + (t3 - t2) * m(i + 1) * h;
}
// Arama tablosu (5 m): hat z'si ve eğimi. Arazi yüksekliği milyonlarca kez sorgulanır.
const TX0 = 1000, TDX = 5, TN = Math.ceil((8000 - TX0) / TDX) + 1;
const TZ = new Float32Array(TN), TM = new Float32Array(TN);
for (let i = 0; i < TN; i++) TZ[i] = lineRaw(TX0 + i * TDX);
for (let i = 0; i < TN; i++) { const a = Math.max(0, i - 1), b = Math.min(TN - 1, i + 1); TM[i] = (TZ[b] - TZ[a]) / ((b - a) * TDX); }
function tab(arr, x) {
  const f = clamp((x - TX0) / TDX, 0, TN - 1.001), i = Math.floor(f), t = f - i;
  return arr[i] + (arr[i + 1] - arr[i]) * t;
}
export function wfLineZ(x) { return tab(TZ, x); }
/** Eğrisel koordinattan dünyaya: P(x, v) = L(x) + N(x) * v */
export function wfPoint(x, v, out = [0, 0]) {
  const m = tab(TM, x), c = 1 / Math.sqrt(1 + m * m);
  out[0] = x - m * c * v; out[1] = tab(TZ, x) + c * v;
  return out;
}
/** Hattın x'teki yerel çerçevesi: teğet (tx, tz) ve deniz yönündeki normal (nx, nz) */
export function wfFrame(x) {
  const m = tab(TM, x), c = 1 / Math.sqrt(1 + m * m);
  return { x, z: tab(TZ, x), tx: c, tz: m * c, nx: -m * c, nz: c };
}
/** Dünya noktasının hatta dik uzaklığı (yaklaşık; + deniz) */
export function wfV(x, z) { const m = tab(TM, x); return (z - tab(TZ, x)) / Math.sqrt(1 + m * m); }

export function wfBeach(x) { return smoothstep(4490, 4570, x) * (1 - smoothstep(5250, 5330, x)); }
// Güvertenin hattan denize uzanan genişliği (v cinsinden)
export function wfDeckW(x) {
  if (x < WF.x0 || x > WF.x1 - 20) return 0;
  let w = lerp(45, 110, 1 - smoothstep(3460, 3580, x));
  w *= 1 - wfBeach(x);
  return lerp(w, 62, smoothstep(5250, 5330, x));
}

/**
 * Arazi biçimlendirme: terrainHeight'ın sonunda çağrılır. Bölge dışında h'yi değiştirmez.
 * Kara tarafı: v = -230..0 düz teras, -500..-230 özgün araziye yumuşak geçiş.
 * Deniz tarafı: rıhtım kesimlerinde 90 m içinde derin tabana iner; plajda 1:16 eğim.
 * Açıkta (700-1600 m) özgün deniz tabanına geri bağlanır. İki uçta 450 m'lik geçiş.
 */
export function waterfrontHeight(x, z, h) {
  if (x < WF.x0 - 450 || x > WF.x1 + 450) return h;
  const v = wfV(x, z);
  if (v < -520 || v > 1600) return h;
  const ex = smoothstep(WF.x0 - 450, WF.x0, x) * (1 - smoothstep(WF.x1, WF.x1 + 450, x));
  if (ex <= 0) return h;
  let t;
  if (v <= 0) t = lerp(h, WF.terrace, smoothstep(-500, -230, v));
  else {
    const quay = lerp(WF.terrace, WF.seabed, smoothstep(0, 90, v));
    const beach = Math.max(WF.seabed, WF.terrace - v * 0.062);
    t = lerp(quay, beach, wfBeach(x));
    t = lerp(t, h, smoothstep(700, 1600, v));
  }
  return lerp(h, t, ex);
}
// Bağlantı sokakları (bulvardan arka caddeye ve şehrin sahil bulvarına uzanır)
const CONNECT_X = [2600, 3040, 3420, 3800, 4140, 4500, 4860, 5200, 5600, 5880];
let PLAN = null;
/**
 * Rıhtım yol planı. Şehir kurulmadan ÖNCE çağrılır (şehir ayrılmış alanı bu plandan bilir).
 * coastZ: şehrin sahil bulvarı (kıyı - 150 m) bu fonksiyondan hesaplanır; bağlantı sokakları
 * bulvara kadar uzanır ve şehir binaları bu koridorlara yerleşmez.
 */
export function wfPlan(coastZ) {
  const vb = [];
  for (let x = WF.x0 - 200; x <= WF.x1 + 200; x += 10) vb.push(wfV(x, coastZ(x) - 150));
  PLAN = { vb, corridors: [] };
  const line = (v, xa, xb, step = 20) => { const pts = []; for (let x = xa; x <= xb + 0.01; x += step) pts.push(wfPoint(Math.min(x, xb), v, [0, 0])); return pts; };
  const roads = [
    { w: 14, kind: 'boulevard', pts: line(-37, WF.x0 + 50, WF.x1 - 20) },
    { w: 9, kind: 'street', over: true, pts: line(-268, WF.x0 + 50, WF.x1 - 20) },
  ];
  for (const x of CONNECT_X) {
    roads.push({ w: 8, kind: 'link', over: true, pts: [wfPoint(x, -44.5, [0, 0]), wfPoint(x, -150, [0, 0]), wfPoint(x, -264, [0, 0])] });
    const v1 = wfVBoul(x);
    if (v1 < -290) {
      const pts = [];
      for (let v = -272; v > v1 + 6; v -= 40) pts.push(wfPoint(x, v, [0, 0]));
      pts.push(wfPoint(x, v1 + 6, [0, 0]));
      if (pts.length >= 2) roads.push({ w: 8, kind: 'link', over: true, pts });
      PLAN.corridors.push({ x, v0: v1 - 12, v1: -400 });
    }
  }
  return roads;
}
/** Şehrin sahil bulvarının hatta dik uzaklığı (v) */
export function wfVBoul(x) {
  if (!PLAN) return -1e9;
  const f = clamp((x - (WF.x0 - 200)) / 10, 0, PLAN.vb.length - 1.001), i = Math.floor(f);
  return PLAN.vb[i] + (PLAN.vb[i + 1] - PLAN.vb[i]) * (f - i);
}
/**
 * Şehir için ayrılmış alan. kind: 'road' (sokak/arter: yalnızca rıhtım şeridi), 'boulevard'
 * (sahil bulvarı hiç kesilmez), 'building' (binalar/ağaçlar/otoparklar: şerit + bağlantı koridorları)
 */
export function wfReserved(x, z, kind = 'building') {
  if (kind === 'boulevard' || x < WF.x0 - 120 || x > WF.x1 + 120) return false;
  const v = wfV(x, z);
  if (v > -425) return true;
  if (kind === 'road' || !PLAN) return false;
  for (const c of PLAN.corridors) if (Math.abs(x - c.x) < 26 && v > c.v0 && v < c.v1) return true;
  return false;
}
/** Arazi renklendirmesi: teras döşemeli/kentsel zemin (0..1) */
export function wfPaved(x, z) {
  if (x < WF.x0 - 450 || x > WF.x1 + 450) return 0;
  const v = wfV(x, z);
  if (v < -470 || v > 120) return 0;
  const ex = smoothstep(WF.x0 - 300, WF.x0, x) * (1 - smoothstep(WF.x1, WF.x1 + 300, x));
  return ex * smoothstep(-470, -400, v) * (v <= 0 ? 1 : 1 - wfBeach(x));
}
/**
 * Şehir sokaklarının rıhtım şeridinde kesilen uçlarını, kendi doğrultularında rıhtım
 * caddesine bağlar (ızgara çizgisi üzerinde kaldığı için şehir binalarıyla çakışmaz).
 * Sokaklar arka caddeye, arterler rıhtım bulvarına kadar uzanır.
 */
export function wfCityLinks(net) {
  const links = [];
  const lists = [[net.roads.street, -264, 9], [net.roads.arterial, -44.5, 12]];
  for (const [list, target, w] of lists) {
    for (const r of list) {
      if (r.pts.length < 2) continue;
      for (const [i0, i1] of [[0, 1], [r.pts.length - 1, r.pts.length - 2]]) {
        const E = r.pts[i0], Q = r.pts[i1];
        let dx = E[0] - Q[0], dz = E[1] - Q[1]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
        if (!wfReserved(E[0] + dx * 60, E[1] + dz * 60, 'road')) continue;
        if (E[0] < WF.x0 + 40 || E[0] > WF.x1 - 40) continue;
        // Kıyıya doğru ilerlemiyorsa (şeride paralel sokak) bağlanmaz
        const v0 = wfV(E[0], E[1]), v1 = wfV(E[0] + dx * 50, E[1] + dz * 50);
        if (v1 - v0 < 25) continue;
        const pts = [[E[0], E[1]]];
        let ok = false;
        for (let t = 20; t <= 560; t += 20) {
          const x = E[0] + dx * t, z = E[1] + dz * t;
          if (x < WF.x0 + 30 || x > WF.x1 - 30) break;
          if (wfV(x, z) >= target) { pts.push([x, z]); ok = true; break; }
        }
        if (ok) links.push({ w, kind: 'citylink', over: true, pts });
      }
    }
  }
  return links;
}

// ---------------------------------------------------------------------------
// Geometri yardımcıları
const _col = new THREE.Color();
function paint(g, hex, jitter = 0, rand = Math.random) {
  if (g.index) g = g.toNonIndexed();
  if (!g.attributes.normal) g.computeVertexNormals();
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (g.attributes.uv1) g.deleteAttribute('uv1');
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  _col.set(hex);
  for (let i = 0; i < n; i += 3) {
    const j = jitter ? 1 + (rand() - 0.5) * jitter : 1;
    for (let k = 0; k < 3 && i + k < n; k++) { a[(i + k) * 3] = _col.r * j; a[(i + k) * 3 + 1] = _col.g * j; a[(i + k) * 3 + 2] = _col.b * j; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}
const _m4 = new THREE.Matrix4(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(0, 1, 0), _bz = new THREE.Vector3();
/** Yerel geometriyi (x teğet, z normal) eğrisel (x, v) noktasına, y yüksekliğine yerleştirir */
function placeAt(g, x, v, y, yaw = 0) {
  const f = wfFrame(x), p = wfPoint(x, v);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // yaw: yerel çerçevede ek dönüş (teğetten normale doğru)
  _bx.set(f.tx * c + f.nx * s, 0, f.tz * c + f.nz * s);
  _bz.set(-f.tx * s + f.nx * c, 0, -f.tz * s + f.nz * c);
  _m4.makeBasis(_bx, _by, _bz).setPosition(p[0], y, p[1]);
  g.applyMatrix4(_m4);
  return g;
}
function quatAt(x, yaw, q) {
  const f = wfFrame(x), c = Math.cos(yaw), s = Math.sin(yaw);
  _bx.set(f.tx * c + f.nx * s, 0, f.tz * c + f.nz * s);
  _bz.set(-f.tx * s + f.nx * c, 0, -f.tz * s + f.nz * c);
  _m4.makeBasis(_bx, _by, _bz);
  return q.setFromRotationMatrix(_m4);
}
// Cephe dokulu kutu: u ~4,2 m, v ~3,6 m (şehir binalarıyla aynı ölçek)
function facadeBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const su = [d, d, w, w, w, w], sv = [h, h, d, d, h, h];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * (su[f] / 4.2), uv.getY(k) * (sv[f] / 3.6)); }
  g.translate(0, h / 2, 0);
  return g.toNonIndexed();
}
// Plan görünüşü (x, z) çokgeninden y0..y1 arası dikey prizma
function prism(pts, y0, y1) {
  const sh = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  const g = new THREE.ExtrudeGeometry(sh, { depth: y1 - y0, bevelEnabled: false, curveSegments: 2 });
  g.rotateX(-Math.PI / 2); g.translate(0, y0, 0);
  return g;
}
// Gemi/tekne planı: kıç aynalığı, düz bordalar, sivri pruva
function hullPlan(x0, x1, halfB, bowLen, n = 12) {
  const pts = [[x0, -halfB * 0.86], [x0 + Math.min(3, (x1 - x0) * 0.05), -halfB]];
  const xb = x1 - bowLen;
  for (let i = 0; i <= n; i++) { const t = i / n; pts.push([xb + bowLen * t, -halfB * (1 - Math.pow(t, 2.1))]); }
  for (let i = n - 1; i >= 0; i--) { const t = i / n; pts.push([xb + bowLen * t, halfB * (1 - Math.pow(t, 2.1))]); }
  pts.push([x0 + Math.min(3, (x1 - x0) * 0.05), halfB], [x0, halfB * 0.86]);
  return pts;
}
function roundedRect(x0, x1, halfB, r, n = 5) {
  const pts = [];
  const arc = (cx, cz, a0) => { for (let i = 0; i <= n; i++) { const a = a0 + (i / n) * (Math.PI / 2); pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
  arc(x1 - r, halfB - r, 0); arc(x0 + r, halfB - r, Math.PI / 2); arc(x0 + r, -halfB + r, Math.PI); arc(x1 - r, -halfB + r, Math.PI * 1.5);
  return pts;
}

// ---------------------------------------------------------------------------
export class Waterfront {
  // opts: { heightAt, surfaceHeight, quality, makeRoad(pts, w, yOff, shoulder) }
  constructor(opts) {
    this.o = opts;
    // Kaçınılacak yollar: plan yolları + şehir bağlantıları (bina/palmiye yerleşimi için)
    this.avoid = [...(opts.roads || []), ...(opts.links || [])];
    this.q = opts.quality;
    this.group = new THREE.Group();
    this.group.name = 'waterfront';
    this.disposables = [];
    this.boxes = [];        // çarpışma: { minX, maxX, minZ, maxZ, minY, maxY }
    this.checks = { ship: null, boats: [], buildings: [], piers: [], wheel: null };
    this.tiers = [];
    this.rand = mulberry32(7171);
    this.P = { struct: [], deck: [], glass: [], apart: [], office: [], lot: [], balcony: [], wheel: [], wheelBase: [] };
    this.I = { palm: [], tree: [], umbrella: [], car: [], motor: [], sail: [], superyacht: [], gondola: [] };
    this.anchors = [];
    for (let x = WF.x0; x <= WF.x1; x += 400) { const p = wfPoint(x, 0); this.anchors.push(p); }
  }
  track(o) { this.disposables.push(o); return o; }
  gy(x, v) { const p = wfPoint(x, v); return this.o.surfaceHeight(p[0], p[1]); }
  addBox(geoWorld, h0, h1) {
    geoWorld.computeBoundingBox();
    const b = geoWorld.boundingBox;
    this.boxes.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z, minY: h0, maxY: h1 });
  }

  build() {
    this.footprints = [];
    this.buildDeck();
    this.buildMarina();
    this.buildCruise();
    this.buildBeach();
    this.buildPier();
    this.buildBuildings();
    this.buildPromenade();
    for (const bd of this.checks.buildings) if (bd.w) { const p = wfPoint(bd.x, bd.v); this.footprints.push({ x: p[0], z: p[1], r: Math.hypot(bd.w, bd.d) / 2 }); }
    this.buildStreetTrees();
    this.flush();
    return this.group;
  }

  // ---- Rıhtım güvertesi: promenat (bej taş) + rıhtım (açık gri), deniz yüzü düşey duvar ----
  buildDeck() {
    const pos = [], uv = [], col = [], idx = [];
    let vi = 0, arc = 0, prev = null;
    // Doğrusal renk uzayı (doku sRGB'den doğrusala çevrilir; köşe rengi çarpandır)
    const beige = [0.62, 0.56, 0.46], grey = [0.46, 0.46, 0.44], wall = [0.20, 0.20, 0.19];
    const step = 8;
    const rows = [];
    for (let x = WF.x0; x <= WF.x1 - 20 + 0.01; x += step) {
      const w = wfDeckW(x), v0 = -28;
      const a = wfPoint(x, v0), m = wfPoint(x, 0), b = wfPoint(x, w);
      if (prev) arc += Math.hypot(m[0] - prev[0], m[1] - prev[1]);
      prev = m;
      rows.push({ x, a, m, b, w, arc });
    }
    const Y = WF.deck, YB = WL - 7, YT = WF.terrace - 0.6;
    // Her satır: [landAlt, landÜst, orta(bej), orta(gri), denizÜst, denizAlt]
    for (const r of rows) {
      const verts = [
        [r.a, YT, wall], [r.a, Y, beige], [r.m, Y, beige], [r.m, Y, grey], [r.b, Y, grey], [r.b, YB, wall],
      ];
      const vv = [-28, -28, 0, 0, r.w, r.w];
      verts.forEach(([p, y, c], k) => { pos.push(p[0], y, p[1]); col.push(...c); uv.push(r.arc / 6, vv[k] / 6 + (k === 0 || k === 5 ? (k === 0 ? -0.1 : 2) : 0)); });
      vi += 6;
    }
    for (let i = 0; i < rows.length - 1; i++) {
      const a = i * 6, b = (i + 1) * 6;
      for (const k of [0, 1, 3, 4]) {
        if (k === 3 && rows[i].w < 0.5 && rows[i + 1].w < 0.5) continue;
        idx.push(a + k, a + k + 1, b + k, a + k + 1, b + k + 1, b + k);
      }
    }
    // Uç duvarları
    for (const r of [rows[0], rows[rows.length - 1]]) {
      const base = pos.length / 3;
      for (const [p, y] of [[r.a, YT], [r.a, Y], [r.b, Y], [r.b, YB]]) { pos.push(p[0], y, p[1]); col.push(...wall); uv.push(0, 0); }
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3, base, base + 2, base + 1, base, base + 3, base + 2);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    this.P.deck.push(g.toNonIndexed());
    this.deckRows = rows;
  }

  // ---- Marina: dalgakıranlar, deniz fenerleri, yüzer iskeleler, yatlar ----
  buildMarina() {
    const R = this.rand, S = this.P.struct;
    const crest = WL + 4.6, toe = WL - 12;
    // Dalgakıran (moloz set): yamuk kesit, üstte beton yürüyüş yolu, yamaçlarda kaba kaya
    const mound = (path) => {
      const pos = [], col = [];
      // Renkler doğrusal uzayda: kaba kaya koyu gri-kahve, üstte açık beton yürüyüş yolu
      const across = [[-24, toe, 0.10], [-13, WL + 0.5, 0.17], [-5.5, crest - 0.6, 0.21], [-4.5, crest, 0.42], [4.5, crest, 0.42], [5.5, crest - 0.6, 0.21], [13, WL + 0.5, 0.17], [24, toe, 0.10]];
      const rows = [];
      for (let i = 0; i < path.length; i++) {
        const p = path[i], pr = path[Math.max(0, i - 1)], nx2 = path[Math.min(path.length - 1, i + 1)];
        let tx = nx2[0] - pr[0], tz = nx2[1] - pr[1]; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
        rows.push(across.map(([o, y, c]) => {
          const rough = Math.abs(o) > 5 && Math.abs(o) < 20 ? (R() - 0.5) * 1.6 : 0;
          return [p[0] - tz * o + (R() - 0.5) * (Math.abs(o) > 5 ? 1.2 : 0), y + rough, p[1] + tx * o, c * (Math.abs(o) > 5 ? 0.8 + R() * 0.4 : 1)];
        }));
      }
      for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < across.length - 1; k++) {
        const a = rows[i][k], b = rows[i][k + 1], c = rows[i + 1][k], d = rows[i + 1][k + 1];
        // Sarım: yüzey normali yukarı/dışa (yol teğeti x enine yön = aşağı olduğundan ters sıra)
        for (const t of [[a, b, c], [b, d, c]]) for (const q of t) { pos.push(q[0], q[1], q[2]); col.push(q[3], q[3] * 0.96, q[3] * 0.9); }
      }
      // Uç (yuvarlak burun yerine basit kapak)
      const L = rows[rows.length - 1];
      for (let k = 1; k < across.length - 2; k++) for (const tri of [[L[0], L[k], L[k + 1]], [L[0], L[k + 1], L[k]]]) for (const q of tri) { pos.push(q[0], q[1], q[2]); col.push(0.2, 0.2, 0.19); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeVertexNormals();
      S.push(g);
    };
    const arm = (x0, x1, vOut, vEnd, n = 18) => {
      const pts = [];
      for (let i = 0; i <= n; i++) pts.push(wfPoint(x0, wfDeckW(x0) - 4 + (vOut - wfDeckW(x0) + 4) * (i / n)));
      // Dönüş: dış kola kavisli geçiş
      for (let i = 1; i <= n; i++) { const t = i / n; pts.push(wfPoint(x0 + (x1 - x0) * t, vOut + (vEnd - vOut) * Math.sin(t * Math.PI / 2))); }
      return pts;
    };
    const W = MARINA_ARMS;
    const westArm = arm(W.west, W.wEnd, 330, 372), eastArm = arm(W.east, W.eEnd, 300, 352);
    mound(westArm); mound(eastArm);
    this.marinaArms = [westArm, eastArm];
    // Deniz fenerleri: batı kolunda kırmızı, doğu kolunda yeşil (liman giriş renkleri)
    const light = (p, color) => {
      const parts = [];
      for (let b = 0; b < 4; b++) { const c = new THREE.CylinderGeometry(1.9, 2.1, 2.6, 10); c.translate(0, crest + 1.3 + b * 2.6, 0); parts.push(paint(c, b % 2 ? 0xf2f2ee : color)); }
      const lan = new THREE.CylinderGeometry(1.3, 1.3, 1.8, 8); lan.translate(0, crest + 11.3, 0); parts.push(paint(lan, 0xcfe6f2));
      const cap = new THREE.ConeGeometry(1.7, 1.6, 8); cap.translate(0, crest + 13, 0); parts.push(paint(cap, color));
      for (const g of parts) { g.translate(p[0], 0, p[1]); S.push(g); }
      this.boxes.push({ minX: p[0] - 2.2, maxX: p[0] + 2.2, minZ: p[1] - 2.2, maxZ: p[1] + 2.2, minY: WL, maxY: crest + 14 });
    };
    light(westArm[westArm.length - 1], 0xc8322a); light(eastArm[eastArm.length - 1], 0x2f9a4a);

    // Yüzer iskeleler: rıhtımdan denize uzanan ana iskeleler, iki yanında parmak iskeleler
    const pontY = WL + 0.55;
    const piers = [3730, 3880, 4030, 4180, 4330];
    for (let pi = 0; pi < piers.length; pi++) {
      const x = piers[pi], dW = wfDeckW(x), len = 230 - pi * 12, v0 = dW - 1, v1 = dW + len;
      const main = new THREE.BoxGeometry(3.2, 0.7, len + 1); main.translate(0, pontY, (v0 + v1) / 2);
      S.push(placeAt(paint(main, 0xb9b4a8), x, 0, 0));
      // Rampa: rıhtım kotundan iskele kotuna
      const ramp = new THREE.BoxGeometry(2.4, 0.3, 12); ramp.rotateX(Math.atan2(WF.deck - pontY, 12)); ramp.translate(0, (WF.deck + pontY) / 2, dW - 6);
      S.push(placeAt(paint(ramp, 0x9a958a), x, 0, 0));
      this.checks.piers.push({ x, v0, deckW: dW });
      // Parmak iskeleler ve tekneler
      for (let v = v0 + 14; v < v1 - 8; v += 13) {
        for (const side of [-1, 1]) {
          const f = new THREE.BoxGeometry(11, 0.5, 1.3); f.translate(side * (1.6 + 5.5), pontY, v);
          S.push(placeAt(paint(f, 0xc4bfb3), x, 0, 0));
          if (R() < 0.18) continue;
          const sail = R() < 0.5, L = sail ? 10 + R() * 4 : 11 + R() * 6;
          // Tekne iki parmak arasında, pruvası ana iskeleye bakar
          const o = side * (1.6 + 0.6 + L / 2), vv = v + 6.5;
          const p = wfPoint(x, vv), f2 = wfFrame(x);
          const px = p[0] + f2.tx * o, pz = p[1] + f2.tz * o;
          (sail ? this.I.sail : this.I.motor).push({ x: px, z: pz, y: WL, yaw: side > 0 ? Math.PI : 0, fx: x, s: L / (sail ? 12 : 15), c: 0.9 + R() * 0.1 });
        }
      }
      // İskele başında süper yat (T başı boyunca)
      const ys = wfPoint(x, v1 + 8);
      this.I.superyacht.push({ x: ys[0], z: ys[1], y: WL, yaw: pi % 2 ? Math.PI : 0, fx: x, s: 0.85 + R() * 0.3, c: 0.95 + R() * 0.05 });
    }
    // Marina rıhtımında restoranlar/kafeler (tente renkleri) ve liman ofisi kulesi
    const awn = [0xc23b2f, 0x2b6cb0, 0xe0a030, 0x2f8f6f, 0xf2f2ee];
    for (let x = 3640; x < 4430; x += 52) {
      if (piers.some((p) => Math.abs(p - x) < 18)) continue;
      const b = facadeBox(17, 7.2, 11); placeAt(b, x, 18, WF.deck); this.P.office.push(b); this.addBox(b, 0, WF.deck + 7.2);
      const roof = new THREE.BoxGeometry(17.6, 0.5, 11.6); roof.translate(0, WF.deck + 7.45, 18); S.push(placeAt(paint(roof, 0x9c9a94), x, 0, 0));
      const a = new THREE.BoxGeometry(17, 0.25, 3.6); a.rotateX(-0.18); a.translate(0, WF.deck + 3.3, 18 + 7.2); S.push(placeAt(paint(a, awn[Math.floor(R() * awn.length)]), x, 0, 0));
      this.checks.buildings.push({ x, v: 18, onDeck: true });
    }
    {
      const x = 4040, tw = facadeBox(9, 22, 9); placeAt(tw, x, 33, WF.deck); this.P.glass.push(tw); this.addBox(tw, 0, WF.deck + 22);
      const top = new THREE.BoxGeometry(11, 3.4, 11); top.translate(0, WF.deck + 23.7, 33); S.push(placeAt(paint(top, 0x3a4d5c), x, 0, 0));
      const cap = new THREE.BoxGeometry(12, 0.6, 12); cap.translate(0, WF.deck + 25.7, 33); S.push(placeAt(paint(cap, 0xe8e8e4), x, 0, 0));
    }
  }

  // ---- Kruvaziyer terminali, gemi ve römorkör ----
  buildCruise() {
    const S = this.P.struct, R = this.rand;
    // Terminal binası: rıhtım güvertesinde uzun cam gövde + dalgalı beyaz çatı kabuğu
    {
      const x = 3000, len = 380, dep = 46, h = 17;
      const b = facadeBox(len, h, dep); placeAt(b, x, 52, WF.deck); this.P.glass.push(b); this.addBox(b, 0, WF.deck + h + 4);
      const n = 24;
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n, xa = -len / 2 - 6 + (len + 12) * t0, xb = -len / 2 - 6 + (len + 12) * t1;
        const y = h + 1.5 + 2.6 * Math.sin(t0 * Math.PI * 3), y2 = h + 1.5 + 2.6 * Math.sin(t1 * Math.PI * 3);
        const seg = new THREE.BoxGeometry(xb - xa + 0.2, 0.8, dep + 10);
        const g = seg.toNonIndexed(); const pa = g.attributes.position;
        for (let k = 0; k < pa.count; k++) { const lx = pa.getX(k); const ty = lx < 0 ? y : y2; pa.setX(k, (xa + xb) / 2 + lx); pa.setY(k, pa.getY(k) + ty + WF.deck); pa.setZ(k, pa.getZ(k) + 52); }
        S.push(placeAt(paint(g, 0xf4f4f0), x, 0, 0));
      }
      // Yolcu köprüleri (terminalden gemiye)
      for (const o of [-80, 60]) { const gw = new THREE.BoxGeometry(3.2, 3.4, 38); gw.translate(o, WF.deck + 13, 94); S.push(placeAt(paint(gw, 0xd8dadc), x, 0, 0)); }
      this.checks.buildings.push({ x, v: 52, onDeck: true });
    }
    // Gemi: yerel çerçeve x boy (pruva +x), z en; y su hattından yukarı
    const shipParts = [], balc = [];
    const L = 300, B = 38;
    const hp = hullPlan(-L / 2, L / 2, B / 2, 78);
    shipParts.push(paint(prism(hp, -8.5, 0.4), 0x7a2a24));            // karina (zehirli boya)
    shipParts.push(paint(prism(hp, 0.4, 3.4), 0x1f2f4a));             // su hattı bandı
    shipParts.push(paint(prism(hp, 3.4, 13.0), 0xf3f4f5));            // beyaz borda
    // Lacivert borda şeridi (pruvadan kıça ince bant)
    shipParts.push(paint(prism(hullPlan(-L / 2 - 0.25, L / 2 - 0.4, B / 2 + 0.25, 78), 9.4, 10.4), 0x1f3f6a));
    // Üst yapı: güverte blokları (balkon dokusu), çatıları açık gri güverte
    const sup1 = roundedRect(-140, 92, 17.6, 9), sup2 = roundedRect(-112, 64, 15.4, 8);
    balc.push(prism(sup1, 13, 40)); balc.push(prism(sup2, 40, 49));
    shipParts.push(paint(prism(sup1, 40, 40.35), 0xc9ced2));
    shipParts.push(paint(prism(sup2, 49, 49.35), 0xc9ced2));
    // Köprü üstü ve kanatları
    const br = new THREE.BoxGeometry(14, 4.2, B + 4); br.translate(55, 42, 0); shipParts.push(paint(br, 0xf3f4f5));
    const brw = new THREE.BoxGeometry(14.4, 1.4, B + 4.4); brw.translate(55, 43, 0); shipParts.push(paint(brw, 0x26323f));
    const mast = new THREE.BoxGeometry(1.4, 10, 1.4); mast.translate(48, 54, 0); shipParts.push(paint(mast, 0xf3f4f5));
    const radar = new THREE.BoxGeometry(1.0, 0.6, 9); radar.translate(48, 57, 0); shipParts.push(paint(radar, 0x3a3f45));
    // Baca: kıçta, beyaz gövde + lacivert başlık + kırmızı şerit
    const fun = roundedRect(-104, -80, 7, 6);
    shipParts.push(paint(prism(fun, 49.35, 60), 0xf3f4f5));
    shipParts.push(paint(prism(fun, 60, 61.6), 0xc8322a));
    shipParts.push(paint(prism(fun, 61.6, 66), 0x1f3f6a));
    // Havuzlar ve güneş güvertesi
    for (const [px, pw, pd, py] of [[-128, 14, 9, 40.4], [-6, 18, 10, 49.4], [22, 9, 7, 49.4]]) {
      const pool = new THREE.BoxGeometry(pw, 0.12, pd); pool.translate(px, py, 0); shipParts.push(paint(pool, 0x3fb6d8));
      const rim = new THREE.BoxGeometry(pw + 3, 0.08, pd + 3); rim.translate(px, py - 0.03, 0); shipParts.push(paint(rim, 0xb48a5c));
    }
    // Su kaydırağı (kıvrımlı tüp yerine renkli eğik bantlar)
    for (let k = 0; k < 4; k++) { const s = new THREE.BoxGeometry(14, 1.2, 1.4); s.rotateZ(0.35 * (k % 2 ? 1 : -1)); s.translate(-60 + k * 2, 52 + k * 2.5, -6 + k * 3); shipParts.push(paint(s, k % 2 ? 0x2f86d0 : 0xf0a020)); }
    // Filikalar: iki bordada turuncu sıra
    for (const side of [-1, 1]) for (let x = -108; x <= 40; x += 14.5) {
      const lb = new THREE.BoxGeometry(10.5, 3.2, 4); lb.translate(x, 17.2, side * (17.6 + 2.2)); shipParts.push(paint(lb, 0xf08a1c));
    }
    // Yerleşim: rıhtım yüzüne paralel, 3 m defans boşluğu
    const xs0 = SHIP_X - 150, xs1 = SHIP_X + 150;
    const faceA = wfPoint(xs0, wfDeckW(xs0)), faceB = wfPoint(xs1, wfDeckW(xs1));
    let tx = faceB[0] - faceA[0], tz = faceB[1] - faceA[1]; const tl = Math.hypot(tx, tz); tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;   // denize doğru (teğet x'ten saat yönü)
    // Yüz noktalarının en denizdeki: gemi bordası onun 3 m dışında
    let maxOff = -Infinity;
    for (let x = xs0; x <= xs1; x += 10) { const f = wfPoint(x, wfDeckW(x)); maxOff = Math.max(maxOff, (f[0] - faceA[0]) * nx + (f[1] - faceA[1]) * nz); }
    const off = maxOff + 3 + B / 2;
    const cx = (faceA[0] + faceB[0]) / 2 + nx * off, cz = (faceA[1] + faceB[1]) / 2 + nz * off;
    _m4.makeBasis(_bx.set(tx, 0, tz), _by, _bz.set(nx, 0, nz)).setPosition(cx, WL, cz);
    for (const g of shipParts) { g.applyMatrix4(_m4); S.push(g); }
    for (const g of balc) { g.applyMatrix4(_m4); this.P.balcony.push(g); }
    // Çarpışma: gövde ve üst yapı kutuları (AABB)
    const hull = new THREE.BoxGeometry(L, 1, B); hull.applyMatrix4(_m4); this.addBox(hull, WL - 9, WL + 49);
    this.checks.ship = { cx, cz, tx, tz, nx, nz, L, B, draft: 8.5 };
    this.shipPos = new THREE.Vector3(cx, WL + 30, cz);
    // Römorkör: geminin kıç tarafında
    {
      const tug = [];
      const tp = hullPlan(-14, 14, 5, 7);
      tug.push(paint(prism(tp, -2.5, 0.3), 0x2a2a2c)); tug.push(paint(prism(tp, 0.3, 2.6), 0xb4302a));
      const wh = new THREE.BoxGeometry(7, 3.4, 6); wh.translate(1, 4.3, 0); tug.push(paint(wh, 0xf2f2ee));
      const wh2 = new THREE.BoxGeometry(4, 2.2, 5); wh2.translate(1.5, 7, 0); tug.push(paint(wh2, 0x2d3a46));
      const st = new THREE.CylinderGeometry(0.8, 0.9, 4, 6); st.translate(-4, 6, 0); tug.push(paint(st, 0xd8a028));
      const p = [cx - tx * (L / 2 + 30) + nx * 26, cz - tz * (L / 2 + 30) + nz * 26];
      const yaw = Math.atan2(-tz, tx) + 0.5;
      _m4.makeRotationY(yaw).setPosition(p[0], WL, p[1]);
      for (const g of tug) { g.applyMatrix4(_m4); S.push(g); }
      this.checks.boats.push({ x: p[0], z: p[1], len: 28, kind: 'tug' });
    }
    // Otopark (terminal arkası): bulvar ile arka cadde arasında iki parsel
    this.parkingLot(2760, 3010, -62, -164);
    this.parkingLot(3070, 3390, -62, -164);
    // Gemi yanında birkaç küçük tekne (pilot botu, servis teknesi)
    for (const [x, v, yaw] of [[3320, 210, 0.6], [2700, 260, -0.4]]) { const p = wfPoint(x, v); this.I.motor.push({ x: p[0], z: p[1], y: WL, yaw, fx: x, s: 1.1, c: 0.9 }); }
  }

  // Otopark: eğrisel dikdörtgen, araziye oturan ızgara + park yerlerinde arabalar
  parkingLot(xa, xb, va, vb) {
    const R = this.rand, pos = [], uv = [], idx = [];
    const nx = Math.ceil((xb - xa) / 10), nv = Math.ceil(Math.abs(vb - va) / 10);
    for (let j = 0; j <= nv; j++) for (let i = 0; i <= nx; i++) {
      const x = xa + (xb - xa) * (i / nx), v = va + (vb - va) * (j / nv);
      const p = wfPoint(x, v);
      pos.push(p[0], this.o.surfaceHeight(p[0], p[1]) + 0.16, p[1]);
      uv.push((x - xa) / 10, (va - v) / 17);
    }
    for (let j = 0; j < nv; j++) for (let i = 0; i < nx; i++) { const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1; idx.push(a, b, c, b, d, c); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    // Sarım yönü: v azalırken yukarı bakması için ters çevrilebilir
    g.computeBoundingBox();
    const n0 = g.attributes.normal.getY(0);
    if (n0 < 0) { const ix = g.index.array; for (let k = 0; k < ix.length; k += 3) { const t = ix[k + 1]; ix[k + 1] = ix[k + 2]; ix[k + 2] = t; } g.computeVertexNormals(); }
    this.P.lot.push(g.toNonIndexed());
    // Arabalar: dokudaki park yerlerine (her 17 m'lik döşemede iki sıra)
    for (let t = 0; t * 17 + 17 <= Math.abs(vb - va); t++) {
      for (const row of [2.5, 14.5]) {
        for (let k = 0; k < (xb - xa) / 2.5 - 1; k++) {
          if (R() > 0.42) continue;
          const x = xa + (k + 0.5) * 2.5, v = va - (t * 17 + row);
          const p = wfPoint(x, v);
          this.I.car.push({ x: p[0], z: p[1], y: this.o.surfaceHeight(p[0], p[1]) + 0.18, fx: x, yaw: R() < 0.5 ? 0 : Math.PI });
        }
      }
    }
  }

  // ---- Plaj: kum (arazi), şemsiyeler, plaj barları ----
  buildBeach() {
    const R = this.rand, [xa, xb] = WF_PARTS.beach;
    for (let x = xa + 10; x < xb - 10; x += 9) {
      for (const v of [14, 23, 32, 41]) {
        if (R() < 0.3) continue;
        const xx = x + (R() - 0.5) * 4, vv = v + (R() - 0.5) * 3;
        const p = wfPoint(xx, vv), y = this.o.surfaceHeight(p[0], p[1]);
        if (y < WL + 0.6) continue;
        this.I.umbrella.push({ x: p[0], z: p[1], y, fx: xx, c: Math.floor(R() * 5) });
      }
    }
    for (const x of [4680, 4930, 5160]) {
      const b = new THREE.BoxGeometry(9, 3.4, 7); b.translate(0, 1.7, 0);
      const p = wfPoint(x, 7), y = this.o.surfaceHeight(p[0], p[1]);
      b.translate(0, y, 7); this.P.struct.push(placeAt(paint(b, 0xa47a4c), x, 0, 0));
      const r = new THREE.ConeGeometry(7.2, 2.4, 4); r.rotateY(Math.PI / 4); r.scale(1.0, 1, 0.8); r.translate(0, y + 4.6, 7); this.P.struct.push(placeAt(paint(r, 0xd9c08a), x, 0, 0));
      this.checks.buildings.push({ x, v: 7, onBeach: true });
    }
  }

  // ---- Eğlence iskelesi: kazıklı iskele, platformda dönme dolap, meydanda oyun alanı ----
  buildPier() {
    const S = this.P.struct, R = this.rand, x = PIER_X;
    const dW = wfDeckW(x), v0 = dW - 1, v1 = 440, Y = WF.deck;
    // İskele tabliyesi: 14 m genişlik + platform (dolap) + uç platformu (köşk)
    const deck = (w, va, vb) => { const g = new THREE.BoxGeometry(w, 1.1, vb - va); g.translate(0, Y - 0.55, (va + vb) / 2); S.push(placeAt(paint(g, 0x9b8064), x, 0, 0)); };
    deck(14, v0, v1); deck(66, 92, 162); deck(46, 396, 446);
    // Korkuluklar
    for (const side of [-1, 1]) { const r = new THREE.BoxGeometry(0.3, 1.1, v1 - v0); r.translate(side * 6.9, Y + 0.55, (v0 + v1) / 2); S.push(placeAt(paint(r, 0xf0f0ec), x, 0, 0)); }
    // Kazıklar
    const piles = [];
    const pile = (o, v) => { const c = new THREE.CylinderGeometry(0.55, 0.6, Y - (WL - 14), 6); c.translate(o, (Y + WL - 14) / 2 - 0.5, v); piles.push(c); };
    for (let v = v0 + 18; v < v1; v += 20) for (const o of [-6, 6]) pile(o, v);
    for (let v = 96; v <= 160; v += 16) for (const o of [-31, -16, 16, 31]) pile(o, v);
    for (const o of [-21, 21]) for (const v of [400, 444]) pile(o, v);
    for (const g of piles) S.push(placeAt(paint(g, 0x5a4a3c), x, 0, 0));
    // Uç köşkü (restoran)
    { const b = facadeBox(34, 7, 24); placeAt(b, x, 421, Y); this.P.office.push(b); this.addBox(b, 0, Y + 9);
      const roof = new THREE.ConeGeometry(25, 4, 4); roof.rotateY(Math.PI / 4); roof.scale(1, 1, 0.72); roof.translate(0, Y + 9, 421); S.push(placeAt(paint(roof, 0x2f6b8f), x, 0, 0)); }
    this.checks.piers.push({ x, v0, deckW: dW });
    // Lambalar
    for (let v = v0 + 10; v < v1; v += 25) for (const side of [-1, 1]) { const l = new THREE.BoxGeometry(0.22, 5, 0.22); l.translate(side * 6.6, Y + 2.5, v); S.push(placeAt(paint(l, 0x3c4248), x, 0, 0)); }

    // Dönme dolap: tekerlek düzlemi kıyıya paralel (şehirden ve denizden tam daire okunur)
    const hubV = 127, hubY = Y + 37, Rw = 30.5;
    this.wheel = { x, v: hubV, y: hubY, r: Rw, angle: 0, n: 24 };
    const base = [];
    // Ayaklar: iki A çerçeve (aks iki yanında)
    for (const side of [-1, 1]) for (const lean of [-1, 1]) {
      const len = Math.hypot(hubY - Y, 17), leg = new THREE.BoxGeometry(1.3, len, 1.3);
      leg.rotateZ(-lean * Math.atan2(17, hubY - Y)); leg.translate(-lean * 8.5, (Y + hubY) / 2, side * 4.2);
      base.push(paint(leg, 0xeeeeea));
    }
    const axle = new THREE.CylinderGeometry(1.4, 1.4, 9.6, 10); axle.rotateX(Math.PI / 2); axle.translate(0, hubY, 0); base.push(paint(axle, 0x9aa0a6));
    // Biniş platformu ve gişe
    const plat = new THREE.BoxGeometry(18, 1.6, 9); plat.translate(0, Y + 0.8, 0); base.push(paint(plat, 0xc84a3a));
    for (const g of base) S.push(placeAt(g, x, hubV, 0));
    // Tekerlek: iki jant halkası + jantlar arası çubuklar + tel kollar (aks etrafında dönen ayrı ağ)
    const wheel = [];
    for (const zz of [-2.2, 2.2]) {
      const rim = new THREE.TorusGeometry(Rw, 0.42, 5, 56); rim.translate(0, 0, zz); wheel.push(paint(rim, 0xf4f4f0));
      const inner = new THREE.TorusGeometry(Rw * 0.86, 0.22, 4, 48); inner.translate(0, 0, zz); wheel.push(paint(inner, 0xf4f4f0));
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * Math.PI * 2, sp = new THREE.BoxGeometry(0.22, Rw, 0.22);
        sp.translate(0, Rw / 2, 0); sp.rotateZ(a); sp.translate(0, 0, zz * 0.8); wheel.push(paint(sp, 0xe6e6e2));
      }
    }
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2, cb = new THREE.BoxGeometry(0.3, 0.3, 4.8); cb.translate(Math.cos(a) * Rw, Math.sin(a) * Rw, 0); wheel.push(paint(cb, 0xd8d8d4)); }
    const hub = new THREE.CylinderGeometry(2.6, 2.6, 5.4, 12); hub.rotateX(Math.PI / 2); wheel.push(paint(hub, 0xc84a3a));
    this.P.wheel = wheel;
    const fr = wfFrame(x), hp = wfPoint(x, hubV);
    this.wheelFrame = { tx: fr.tx, tz: fr.tz, nx: fr.nx, nz: fr.nz, px: hp[0], pz: hp[1] };
    for (let k = 0; k < 24; k++) this.I.gondola.push({ k, c: k % 6 });
    // Çarpışma: tekerlek düzlemi (ince, uzun kutu)
    { const bb = new THREE.BoxGeometry(2 * Rw + 4, 1, 10); placeAt(bb, x, hubV, 0); this.addBox(bb, Y, hubY + Rw + 3); }
    this.checks.wheel = { x, v: hubV, y: hubY, r: Rw, deckY: Y };

    // Meydan (iskele kökü): serbest düşme kulesi, atlıkarınca, büfeler
    {
      const tx = 5420, tv = 30, H = 58;
      const tw = new THREE.BoxGeometry(3, H, 3); tw.translate(0, Y + H / 2, tv); S.push(placeAt(paint(tw, 0xe8e8e4), tx, 0, 0));
      const ring = new THREE.CylinderGeometry(5, 5, 3, 12, 1, true); ring.translate(0, Y + H * 0.62, tv); S.push(placeAt(paint(ring, 0xf0b020), tx, 0, 0));
      const top = new THREE.CylinderGeometry(2.4, 2.4, 2.4, 8); top.translate(0, Y + H + 1.2, tv); S.push(placeAt(paint(top, 0xc8322a), tx, 0, 0));
      const pb = new THREE.BoxGeometry(5, 1, 5); placeAt(pb, tx, tv, Y); this.addBox(pb, 0, Y + H + 3);
      const cx2 = 5700, cv = 28;
      const plat = new THREE.CylinderGeometry(8, 8, 1.2, 16); plat.translate(0, Y + 0.6, cv); S.push(placeAt(paint(plat, 0xd8b070), cx2, 0, 0));
      const pole = new THREE.CylinderGeometry(0.6, 0.6, 6, 8); pole.translate(0, Y + 3.6, cv); S.push(placeAt(paint(pole, 0xf2e2b0), cx2, 0, 0));
      const roof = new THREE.ConeGeometry(9, 4, 16); roof.translate(0, Y + 8.2, cv); S.push(placeAt(paint(roof, 0xc8322a), cx2, 0, 0));
      const cols = [0xc8322a, 0x2b6cb0, 0xe0a030, 0x2f8f6f, 0x8a4fb0];
      for (let xb = 5350; xb <= 5810; xb += 19) {
        if (Math.abs(xb - PIER_X) < 16 || Math.abs(xb - 5700) < 14 || Math.abs(xb - 5420) < 9) continue;
        const b = new THREE.BoxGeometry(5, 3, 4); b.translate(0, Y + 1.5, 52); S.push(placeAt(paint(b, 0xf0ece4), xb, 0, 0));
        const r = new THREE.BoxGeometry(5.6, 0.4, 4.8); r.translate(0, Y + 3.2, 52); S.push(placeAt(paint(r, cols[Math.floor(R() * cols.length)]), xb, 0, 0));
      }
    }
    // Otopark (iskele arkası)
    this.parkingLot(5620, 5840, -62, -164);
    // Açıkta birkaç tekne (yelkenli ve motorlu)
    for (const [bx, bv, yaw, sail] of [[4300, 640, 0.4, false], [5100, 760, -1.1, true], [4720, 520, 2.2, true], [5900, 620, 0.9, false]]) {
      const p = wfPoint(bx, bv);
      (sail ? this.I.sail : this.I.motor).push({ x: p[0], z: p[1], y: WL, yaw, fx: bx, s: 1.05, c: 0.95 });
    }
  }

  // ---- Oteller, rezidanslar, apartmanlar: siluet denize doğru yükselir ----
  // Noktanın en yakın yola uzaklığı (yalnızca plan + bağlantı yolları)
  roadDist(px, pz) {
    let best = Infinity;
    for (const r of this.avoid) {
      const P = r.pts;
      for (let i = 0; i < P.length - 1; i++) {
        const ax = P[i][0], az = P[i][1], vx = P[i + 1][0] - ax, vz = P[i + 1][1] - az, L2 = vx * vx + vz * vz || 1;
        const t = clamp(((px - ax) * vx + (pz - az) * vz) / L2, 0, 1);
        const d = Math.hypot(ax + vx * t - px, az + vz * t - pz) - r.w / 2;
        if (d < best) best = d;
      }
    }
    return best;
  }
  clearOfRoads(x, v, w, d, margin = 4) {
    const f = wfFrame(x), p = wfPoint(x, v);
    for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0], [0, -d / 2], [0, d / 2], [-w / 2, 0], [w / 2, 0]]) {
      if (this.roadDist(p[0] + f.tx * a + f.nx * b, p[1] + f.tz * a + f.nz * b) < margin) return false;
    }
    return true;
  }

  buildBuildings() {
    const R = this.rand, S = this.P.struct;
    const slots = [];
    for (let i = 0; i < CONNECT_X.length - 1; i++) slots.push([CONNECT_X[i] + 28, CONNECT_X[i + 1] - 28]);
    const lots = [[2760, 3010], [3070, 3390], [5620, 5840]];
    const inLot = (x, half, v = -150, hd = 30) => v + hd > -175 && lots.some(([a, b]) => x + half > a - 6 && x - half < b + 6);
    // Yerleşik yapı izleri (çakışma denetimi): eğrisel (x, v) merkez ve yarı boyutlar
    const placed = [];
    const overlaps = (x, v, w, d, m = 6) => placed.some((p) => Math.abs(p.x - x) < (p.w + w) / 2 + m && Math.abs(p.v - v) < (p.d + d) / 2 + m);
    const roofCap = (x, v, w, d, y, color = 0xb8b8b2) => { const r = new THREE.BoxGeometry(w + 0.8, 0.6, d + 0.8); r.translate(0, y + 0.3, v); S.push(placeAt(paint(r, color), x, 0, 0)); };
    const baseY = (x, v, w, d) => { let y = Infinity; for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) { const f = wfFrame(x), p = wfPoint(x, v); y = Math.min(y, this.o.surfaceHeight(p[0] + f.tx * a + f.nx * b, p[1] + f.tz * a + f.nz * b)); } return y - 0.4; };
    // 1. sıra (bulvar ile arka cadde arası): otel kuleleri. Yükseklik plaj ortasında en yüksek.
    const heightAtX = (x) => {
      if (x > 4500 && x < 5320) return 78 + 46 * Math.sin(((x - 4500) / 820) * Math.PI);
      if (x >= 5320) return 58 + 18 * R();
      if (x >= 3500) return 34 + 16 * R();
      return 40 + 16 * R();
    };
    for (const [a, b] of slots) {
      const span = b - a;
      const n = Math.max(1, Math.round(span / 150));
      for (let k = 0; k < n; k++) {
        const x = a + span * ((k + 0.5) / n) + (R() - 0.5) * 16;
        const hotel = x > 4480;
        const tw = hotel ? 40 + R() * 12 : 46 + R() * 12, td = hotel ? 17 + R() * 4 : 18 + R() * 4;
        if (inLot(x, (tw + 24) / 2)) continue;
        const H = heightAtX(x);
        const v = -150 + (R() - 0.5) * 30;
        if (!this.clearOfRoads(x, v, tw + 24, td + 26, 5)) continue;
        const y0 = baseY(x, v, tw + 24, td + 30);
        // Podyum (lobi, restoran) + kule + taç (geri çekilmiş üst katlar)
        const pod = facadeBox(tw + 24, 9, td + 26); placeAt(pod, x, v, y0); this.P.office.push(pod);
        roofCap(x, v, tw + 24, td + 26, y0 + 9, 0x9fa3a6);
        const tower = facadeBox(tw, H, td); placeAt(tower, x, v + 2, y0); (hotel ? this.P.glass : this.P.apart).push(tower);
        const crown = facadeBox(tw * 0.7, 6, td * 0.75); placeAt(crown, x, v + 2, y0 + H); this.P.glass.push(crown);
        roofCap(x, v + 2, tw * 0.7, td * 0.75, y0 + H + 6, 0xe2e2de);
        if (hotel) {
          // Çatı havuzu ve teras; otel adı yerine renkli taç bandı
          const pool = new THREE.BoxGeometry(tw * 0.5, 0.2, td * 0.4); pool.translate(-tw * 0.1, y0 + H + 0.15, v + 2 + td * 0.2); S.push(placeAt(paint(pool, 0x3fb6d8), x, 0, 0));
          roofCap(x, v + 2, tw, td, y0 + H - 0.4, 0xc9c4b8);
          const band = new THREE.BoxGeometry(tw * 0.72, 1.2, td * 0.77); band.translate(0, y0 + H + 4.2, v + 2); S.push(placeAt(paint(band, [0x2f86d0, 0xc8a050, 0x2f8f6f][Math.floor(R() * 3)]), x, 0, 0));
        } else roofCap(x, v + 2, tw, td, y0 + H - 0.4);
        const bb = new THREE.BoxGeometry(tw + 24, 1, td + 26); placeAt(bb, x, v, 0); this.addBox(bb, 0, y0 + H + 6);
        this.checks.buildings.push({ x, v, y0, w: tw + 24, d: td + 26 });
        placed.push({ x, v, w: tw + 24, d: td + 26 });
        this.hotelTops = (this.hotelTops || 0) + 1;
      }
    }
    // Ara dolgu: oteller arasında bulvar cephesine alçak dükkân/restoran blokları (2-4 kat),
    // otellerin arkasına orta yükseklikte konutlar. Şerit boş bir teras gibi görünmez.
    const infill = (v, wMin, wMax, dMin, dMax, hMin, hMax, mat, prob) => {
      for (const [a, b] of slots) {
        for (let x = a + 4; x < b - 10;) {
          const w = wMin + R() * (wMax - wMin), d = dMin + R() * (dMax - dMin), H = hMin + R() * (hMax - hMin);
          const xx = x + w / 2; x += w + 7 + R() * 10;
          if (xx + w / 2 > b || R() > prob) continue;
          if (inLot(xx, w / 2, v, d / 2) || overlaps(xx, v, w, d)) continue;
          if (!this.clearOfRoads(xx, v, w, d, 4)) continue;
          const y0 = baseY(xx, v, w, d);
          const g = facadeBox(w, H, d); placeAt(g, xx, v, y0); (mat === 'office' ? this.P.office : this.P.apart).push(g);
          roofCap(xx, v, w, d, y0 + H - 0.4, mat === 'office' ? 0x8f9396 : 0xb8b8b2);
          if (mat === 'office' && R() < 0.6) {
            // Bulvara bakan tente (kafe/restoran cephesi)
            const aw = new THREE.BoxGeometry(w * 0.9, 0.25, 3.4); aw.rotateX(0.2); aw.translate(0, y0 + 3.4, v + d / 2 + 1.6);
            S.push(placeAt(paint(aw, [0xc23b2f, 0x2b6cb0, 0xe0a030, 0x2f8f6f, 0xf2f2ee][Math.floor(R() * 5)]), xx, 0, 0));
          }
          if (H > 15) { const bb = new THREE.BoxGeometry(w, 1, d); placeAt(bb, xx, v, 0); this.addBox(bb, 0, y0 + H); }
          placed.push({ x: xx, v, w, d });
          this.checks.buildings.push({ x: xx, v, y0, w, d });
        }
      }
    };
    infill(-78, 18, 30, 13, 18, 7.5, 14, 'office', 0.85);
    infill(-222, 26, 36, 15, 19, 16, 30, 'apart', 0.8);
    infill(-120, 22, 30, 15, 18, 22, 38, 'apart', 0.55);
    // Kruvaziyer kesiminde otoparkların arkasında, arka cadde boyunca da oteller vardır (2. sıra)
    // 2. sıra (arka caddenin şehir tarafı): apartmanlar ve dükkânlar, 18-36 m
    for (const [a, b] of slots) {
      for (let x = a + 6; x < b - 20; x += 40 + R() * 12) {
        for (const v of [-306, -352, -398]) {
          if (R() < 0.12) continue;
          const shop = R() < 0.2, w = shop ? 22 : 30 + R() * 10, d = shop ? 14 : 15 + R() * 3, H = shop ? 7.5 : 18 + R() * 18;
          const xx = x + w / 2;
          if (xx + w / 2 > b) continue;
          // Şehrin sahil bulvarına ve bağlantı yollarına girmez
          if (v - d / 2 < wfVBoul(xx) + 16) continue;
          if (!this.clearOfRoads(xx, v, w, d, 4)) continue;
          const y0 = baseY(xx, v, w, d);
          const g = facadeBox(w, H, d); placeAt(g, xx, v, y0); (shop ? this.P.office : this.P.apart).push(g);
          roofCap(xx, v, w, d, y0 + H - 0.4);
          if (H > 15) { const bb = new THREE.BoxGeometry(w, 1, d); placeAt(bb, xx, v, 0); this.addBox(bb, 0, y0 + H); }
          this.checks.buildings.push({ x: xx, v, y0, w, d });
        }
      }
    }
  }

  // ---- Promenat: palmiyeler, lambalar, otel önü palmiyeleri ----
  buildPromenade() {
    const R = this.rand, S = this.P.struct;
    const piers = [3730, 3880, 4030, 4180, 4330];
    for (let x = WF.x0 + 12; x < WF.x1 - 20; x += 15) {
      const beach = wfBeach(x) > 0.5, pierZone = x > 5330;
      for (const v of beach || pierZone ? [-7, -21] : [-9]) {
        const xx = x + (v === -21 ? 7.5 : 0);
        if (Math.abs(xx - PIER_X) < 12) continue;
        const p = wfPoint(xx, v);
        this.I.palm.push({ x: p[0], z: p[1], y: WF.deck - 0.1, s: 0.8 + R() * 0.45, r: R() * 6.28, lean: (R() - 0.5) * 0.12, fx: xx });
      }
      // Lambalar (promenat kenarı)
      if ((Math.round((x - WF.x0) / 15) & 1) === 0) {
        const l = new THREE.BoxGeometry(0.24, 7, 0.24); l.translate(0, WF.deck + 3.5, -1.5); S.push(placeAt(paint(l, 0x3c4248), x, 0, 0));
        const h = new THREE.BoxGeometry(0.5, 0.3, 1.6); h.translate(0, WF.deck + 7, -2.2); S.push(placeAt(paint(h, 0x3c4248), x, 0, 0));
      }
    }
    // Marina rıhtımı kenarı ve otel önleri
    for (let x = 3610; x < 4450; x += 26) {
      if (piers.some((p) => Math.abs(p - x) < 10)) continue;
      const p = wfPoint(x, 39);
      this.I.palm.push({ x: p[0], z: p[1], y: WF.deck - 0.1, s: 0.75 + R() * 0.3, r: R() * 6.28, lean: (R() - 0.5) * 0.1, fx: x });
    }
    for (let x = WF.x0 + 20; x < WF.x1 - 30; x += 22) {
      if ((x > 2740 && x < 3400) || (x > 5610 && x < 5850)) continue;
      const p = wfPoint(x, -54), y = this.o.surfaceHeight(p[0], p[1]);
      if (this.roadDist(p[0], p[1]) < 3) continue;
      this.I.palm.push({ x: p[0], z: p[1], y, s: 0.7 + R() * 0.3, r: R() * 6.28, lean: (R() - 0.5) * 0.1, fx: x });
    }
  }

  // ---- Cadde ağaçları: arka cadde ve bağlantı sokakları boyunca, iki yanda ----
  buildStreetTrees() {
    const R = this.rand;
    for (const r of this.o.roads || []) {
      if (r.kind === 'boulevard') continue;
      const P = r.pts;
      let acc = 0, next = 8;
      for (let i = 0; i < P.length - 1; i++) {
        const ax = P[i][0], az = P[i][1], bx = P[i + 1][0], bz = P[i + 1][1], L = Math.hypot(bx - ax, bz - az);
        if (L < 0.01) continue;
        const tx = (bx - ax) / L, tz = (bz - az) / L;
        while (next <= acc + L) {
          const t = (next - acc) / L, cx = ax + (bx - ax) * t, cz = az + (bz - az) * t;
          for (const side of [-1, 1]) {
            if (R() < 0.2) continue;
            const o = r.w / 2 + 3.2, x = cx - tz * o * side, z = cz + tx * o * side;
            if (this.roadDist(x, z) < 2.2) continue;
            if (this.footprints.some((f) => Math.hypot(f.x - x, f.z - z) < f.r + 2)) continue;
            this.I.tree.push({ x, z, y: this.o.surfaceHeight(x, z), s: 0.8 + R() * 0.4, r: R() * 6.28, c: R() });
          }
          next += 17 + R() * 6;
        }
        acc += L;
      }
    }
  }

  // ---- Birleştirme ve örnekli ağlar ----
  flush() {
    const q = this.q, P = this.P;
    const near = [];   // uzakta kapanan ayrıntılar
    const mk = (geos, mat, opts = {}) => {
      const list = geos.filter(Boolean);
      if (!list.length) return null;
      const merged = this.track(mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)), false));
      list.forEach((g) => g.dispose());
      const m = new THREE.Mesh(merged, mat);
      m.matrixAutoUpdate = false; m.castShadow = false; m.receiveShadow = !!opts.receive && q.shadows;
      if (opts.order !== undefined) m.renderOrder = opts.order;
      this.group.add(m);
      return m;
    };
    const vc = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.04 }));
    const paving = this.track(makePavingTexture(128)); paving.anisotropy = q.anisotropy;
    const deckMat = this.track(new THREE.MeshStandardMaterial({ map: paving, vertexColors: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }));
    const fac = (kind, rough, metal, emis) => this.track(new THREE.MeshStandardMaterial({
      map: this.track(makeFacadeTexture(kind, 256)), roughness: rough, metalness: metal,
      emissive: emis ? 0x0a1420 : 0x000000, emissiveIntensity: emis ? 0.35 : 0,
    }));
    const balTex = this.track(makeBalconyTexture(64)); balTex.repeat.set(1 / 8, 1 / 3); balTex.anisotropy = q.anisotropy;
    const lotTex = this.track(makeParkingTexture()); lotTex.anisotropy = q.anisotropy;
    mk(P.deck, deckMat, { receive: true });
    mk(P.struct, vc);
    mk(P.glass, fac('glass', 0.22, 0.2, true));
    mk(P.apart, fac('apartment', 0.88, 0.02, false));
    mk(P.office, fac('office', 0.8, 0.05, false));
    mk(P.balcony, this.track(new THREE.MeshStandardMaterial({ map: balTex, roughness: 0.45, metalness: 0.05 })));
    const lotMesh = mk(P.lot, this.track(new THREE.MeshStandardMaterial({ map: lotTex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })));
    // Dönme dolap tekerleği: aks etrafında döner (ayrı ağ, kendi matrisi)
    const wm = mk(P.wheel, vc);
    if (wm) { wm.matrixAutoUpdate = false; this.wheelMesh = wm; this.updateWheel(0); }

    // Örnekli ağlar
    const up = new THREE.Vector3(0, 1, 0), m4 = new THREE.Matrix4(), qq = new THREE.Quaternion(), pv = new THREE.Vector3(), sv = new THREE.Vector3(), col = new THREE.Color();
    const close = [];  // en yakın katman (arabalar, şemsiyeler)
    const inst = (geo, mat, list, fill, tier = near) => {
      if (!list.length) return null;
      // Dizinli geometri: ortak köşeler bir kez işlenir
      const im = new THREE.InstancedMesh(this.track(mergeVertices(geo, 1e-4)), mat, list.length);
      list.forEach((it, i) => { fill(it, m4, col); im.setMatrixAt(i, m4); im.setColorAt(i, col); });
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = false; im.matrixAutoUpdate = false; im.computeBoundingSphere();
      this.group.add(im); tier.push(im);
      return im;
    };
    // Palmiye: hafif eğik gövde + sarkık yapraklar (çift yüzlü)
    const palmGeo = (() => {
      const parts = [];
      const trunk = new THREE.CylinderGeometry(0.2, 0.36, 9, 5, 2, true); trunk.translate(0, 4.5, 0);
      const tp = trunk.attributes.position; for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); tp.setX(i, tp.getX(i) + 0.012 * y * y); }
      parts.push(paint(trunk, 0x8a7458));
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3, pos = [];
        const seg = [[0, 0, 0], [2.2, 0.6, 0], [4.6, -0.6, 0]];
        const wdt = [0.15, 0.8, 0.05];
        for (let s = 0; s < seg.length - 1; s++) {
          const A = seg[s], B = seg[s + 1], wa = wdt[s], wb = wdt[s + 1];
          const q4 = [[A[0], A[1], -wa], [A[0], A[1], wa], [B[0], B[1], -wb], [B[0], B[1], wb]];
          pos.push(...q4[0], ...q4[1], ...q4[2], ...q4[1], ...q4[3], ...q4[2]);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.rotateY(a); g.translate(0.97, 9, 0); g.computeVertexNormals();
        parts.push(paint(g, k % 2 ? 0x3f7a2c : 0x4c8a34));
      }
      return mergeGeometries(parts, false);
    })();
    const palmMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    inst(palmGeo, palmMat, this.I.palm, (it, m, c) => {
      qq.setFromEuler(new THREE.Euler(it.lean, it.r, 0)); m.compose(pv.set(it.x, it.y, it.z), qq, sv.set(it.s, it.s, it.s)); c.setRGB(0.9 + (it.s - 0.75) * 0.3, 1, 0.9);
    });
    // Cadde ağacı: gövde + yuvarlak taç (şehir ağaçlarıyla aynı biçim)
    const treeGeo = (() => {
      const tr = new THREE.CylinderGeometry(0.22, 0.34, 3.2, 4, 1, true); tr.translate(0, 1.6, 0);
      const cr = new THREE.IcosahedronGeometry(2.8, 0); cr.translate(0, 5.0, 0);
      return mergeGeometries([paint(tr, 0x6a5038), paint(cr, 0x4f8a3a)], false);
    })();
    inst(treeGeo, this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })), this.I.tree, (it, m, c) => {
      qq.setFromAxisAngle(up, it.r); m.compose(pv.set(it.x, it.y - 0.2, it.z), qq, sv.set(it.s, it.s * (0.9 + it.c * 0.3), it.s)); c.setRGB(0.8 + it.c * 0.3, 0.85 + (1 - it.c) * 0.2, 0.75);
    });
    // Plaj şemsiyesi
    const umbGeo = (() => {
      const pole = new THREE.CylinderGeometry(0.05, 0.05, 2.4, 4); pole.translate(0, 1.2, 0);
      const can = new THREE.ConeGeometry(1.4, 0.6, 8, 1, true); can.translate(0, 2.4, 0);
      return mergeGeometries([paint(pole, 0xffffff), paint(can, 0xffffff)], false);
    })();
    const UMB = [0xe04a3a, 0x2f86d0, 0xf0c040, 0xf4f4f0, 0x2fa07a];
    inst(umbGeo, this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })), this.I.umbrella, (it, m, c) => {
      m.compose(pv.set(it.x, it.y, it.z), qq.identity(), sv.set(1, 1, 1)); c.set(UMB[it.c]);
    }, close);
    // Araba
    // Araba: tek kutu (12 üçgen); üst yüz koyu (cam/tavan izlenimi). Otoparkta yüzlercesi var.
    const carGeo = (() => {
      const g = paint((() => { const b = new THREE.BoxGeometry(1.85, 1.35, 4.3); b.translate(0, 0.8, 0); return b; })(), 0xffffff);
      const pa = g.attributes.position, ca = g.attributes.color;
      for (let i = 0; i < pa.count; i++) if (pa.getY(i) > 1.4) ca.setXYZ(i, 0.42, 0.46, 0.5);
      return g;
    })();
    const carR = mulberry32(99);
    inst(carGeo, this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 })), this.I.car, (it, m, c) => {
      quatAt(it.fx, it.yaw, qq); m.compose(pv.set(it.x, it.y, it.z), qq, sv.set(1, 1, 1)); c.setHSL(carR(), 0.2 + carR() * 0.4, 0.25 + carR() * 0.55);
    }, close);
    // Tekneler: motor yat, yelkenli, süper yat (beyaz gövde, koyu cam bant, tik güverte)
    const boatMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 }));
    const motorGeo = (() => {
      const p = []; const hp = hullPlan(-7.5, 7.5, 2.2, 5, 4);
      p.push(paint(prism(hp, -0.9, 0.2), 0x2d4a6a)); p.push(paint(prism(hp, 0.2, 1.5), 0xf6f6f4));
      const dk = new THREE.BoxGeometry(12, 0.12, 3.8); dk.translate(-0.8, 1.52, 0); p.push(paint(dk, 0xb08a5a));
      const cab = new THREE.BoxGeometry(6.5, 1.5, 3.4); cab.translate(-0.6, 2.3, 0); p.push(paint(cab, 0x26323f));
      const roof = new THREE.BoxGeometry(7.2, 0.35, 3.8); roof.translate(-0.8, 3.2, 0); p.push(paint(roof, 0xf6f6f4));
      const fly = new THREE.BoxGeometry(3, 0.8, 2.8); fly.translate(-1.5, 3.8, 0); p.push(paint(fly, 0xf6f6f4));
      return mergeGeometries(p, false);
    })();
    const sailGeo = (() => {
      const p = []; const hp = hullPlan(-6, 6, 1.9, 4.5, 4);
      p.push(paint(prism(hp, -0.8, 0.15), 0x2a2e33)); p.push(paint(prism(hp, 0.15, 1.1), 0xf6f6f4));
      const cab = new THREE.BoxGeometry(4, 0.8, 2.6); cab.translate(-0.4, 1.5, 0); p.push(paint(cab, 0xe8e8e4));
      const win = new THREE.BoxGeometry(3.4, 0.3, 2.65); win.translate(-0.4, 1.55, 0); p.push(paint(win, 0x26323f));
      const mast = new THREE.BoxGeometry(0.18, 15, 0.18); mast.translate(0.8, 8.6, 0); p.push(paint(mast, 0xd8d8d4));
      const boom = new THREE.BoxGeometry(4.6, 0.16, 0.16); boom.translate(-1.4, 2.6, 0); p.push(paint(boom, 0xd8d8d4));
      const furl = new THREE.BoxGeometry(4.2, 0.4, 0.4); furl.translate(-1.4, 2.95, 0); p.push(paint(furl, 0x2c4f7a));
      return mergeGeometries(p, false);
    })();
    const superGeo = (() => {
      const p = []; const hp = hullPlan(-23, 23, 4.6, 12, 6);
      p.push(paint(prism(hp, -2.2, 0.3), 0x22262b)); p.push(paint(prism(hp, 0.3, 3.4), 0xf6f6f4));
      const d1 = new THREE.BoxGeometry(30, 2.6, 8); d1.translate(-2, 4.7, 0); p.push(paint(d1, 0xf6f6f4));
      const w1 = new THREE.BoxGeometry(28, 1.0, 8.1); w1.translate(-2, 4.9, 0); p.push(paint(w1, 0x1e2a36));
      const d2 = new THREE.BoxGeometry(20, 2.4, 7); d2.translate(-1, 7.2, 0); p.push(paint(d2, 0xf6f6f4));
      const w2 = new THREE.BoxGeometry(18, 0.9, 7.1); w2.translate(-1, 7.4, 0); p.push(paint(w2, 0x1e2a36));
      const d3 = new THREE.BoxGeometry(10, 2, 6); d3.translate(1, 9.4, 0); p.push(paint(d3, 0xf6f6f4));
      const r = new THREE.BoxGeometry(1, 3, 1); r.translate(1, 11.6, 0); p.push(paint(r, 0xd8d8d4));
      return mergeGeometries(p, false);
    })();
    const boatFill = (it, m, c) => { quatAt(it.fx, it.yaw, qq); m.compose(pv.set(it.x, it.y, it.z), qq, sv.set(it.s, it.s, it.s)); c.setRGB(it.c, it.c, it.c); };
    inst(motorGeo, boatMat, this.I.motor, boatFill);
    inst(sailGeo, boatMat, this.I.sail, boatFill);
    inst(superGeo, boatMat, this.I.superyacht, boatFill);
    for (const L of [this.I.motor, this.I.sail, this.I.superyacht]) for (const b of L) this.checks.boats.push({ x: b.x, z: b.z, len: (L === this.I.superyacht ? 46 : L === this.I.sail ? 12 : 15) * b.s, kind: L === this.I.superyacht ? 'super' : L === this.I.sail ? 'sail' : 'motor', fx: b.fx, yaw: b.yaw });
    // Gondollar: dönerken dik kalır (her kare matris güncellenir, yalnızca yakındayken)
    const gGeo = (() => {
      const cab = new THREE.BoxGeometry(2.4, 2.4, 2.6); cab.translate(0, -2.6, 0);
      const roof = new THREE.BoxGeometry(2.8, 0.3, 3.0); roof.translate(0, -1.25, 0);
      const hang = new THREE.BoxGeometry(0.2, 1.2, 0.2); hang.translate(0, -0.6, 0);
      return mergeGeometries([paint(cab, 0xffffff), paint(roof, 0xffffff), paint(hang, 0xbfbfbf)], false);
    })();
    const GC = [0xd8402f, 0x2f86d0, 0xf0c040, 0x2fa07a, 0x8a4fb0, 0xf08a1c];
    const gim = inst(gGeo, this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })), this.I.gondola, (it, m, c) => { m.identity(); c.set(GC[it.c]); });
    if (gim) { gim.instanceMatrix.setUsage(THREE.DynamicDrawUsage); gim.frustumCulled = false; this.gondolaMesh = gim; this.updateWheel(0); }
    if (lotMesh) near.push(lotMesh);
    this.nearMeshes = near;
    this.closeMeshes = close;
    this.counts = { trees: this.I.tree.length, palms: this.I.palm.length, umbrellas: this.I.umbrella.length, cars: this.I.car.length, boats: this.I.motor.length + this.I.sail.length + this.I.superyacht.length, boxes: this.boxes.length };
  }

  updateWheel(dt) {
    const W = this.wheel, F = this.wheelFrame;
    if (!W || !F) return;
    W.angle = (W.angle + dt * (Math.PI * 2 / 300)) % (Math.PI * 2);
    // Tekerlek ağı: yerel xy düzlemi = (teğet, yukarı), aks = normal
    if (this.wheelMesh) {
      const m = this.wheelMesh.matrix;
      _bx.set(F.tx, 0, F.tz); _bz.set(F.nx, 0, F.nz);
      m.makeBasis(_bx, _by, _bz);
      const r = new THREE.Matrix4().makeRotationZ(W.angle);
      m.multiply(r).setPosition(F.px, W.y, F.pz);
      this.wheelMesh.matrixWorldNeedsUpdate = true;
    }
    if (this.gondolaMesh) {
      const g = this.gondolaMesh, m4 = this._gm || (this._gm = new THREE.Matrix4());
      _bx.set(F.tx, 0, F.tz); _bz.set(F.nx, 0, F.nz);
      for (let k = 0; k < W.n; k++) {
        const a = W.angle + (k / W.n) * Math.PI * 2, cx = Math.cos(a) * W.r, cy = Math.sin(a) * W.r;
        m4.makeBasis(_bx, _by, _bz).setPosition(F.px + F.tx * cx, W.y + cy, F.pz + F.tz * cx);
        g.setMatrixAt(k, m4);
      }
      g.instanceMatrix.needsUpdate = true;
    }
  }

  update(dt, cam) {
    let d = Infinity;
    for (const p of this.anchors) d = Math.min(d, Math.hypot(cam.x - p[0], cam.z - p[1]));
    d = Math.max(d, cam.y * 0.6);
    const detail = this.distScale || 1;
    const on = this._near ? d < 6200 * detail + 300 : d < 6200 * detail - 300;
    if (on !== this._near) { this._near = on; for (const m of this.nearMeshes || []) m.visible = on; }
    const on2 = this._close ? d < 3200 * detail + 200 : d < 3200 * detail - 200;
    if (on2 !== this._close) { this._close = on2; for (const m of this.closeMeshes || []) m.visible = on2; }
    // Dönme dolap yalnızca yakındayken döner (uzakta görünmeyen hareket için güncelleme yok)
    if (on && Math.hypot(cam.x - this.wheelFrame.px, cam.z - this.wheelFrame.pz) < 5000) this.updateWheel(dt);
  }

  dispose() { for (const d of this.disposables) if (d && d.dispose) d.dispose(); }
}
