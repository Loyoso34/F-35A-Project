// Şehir üreteci: bölgeleme (zoning), yol ağı, bina yerleşimi, sokak detayları, trafik ve LOD.
// Dünya modülünden bağımsızdır: yalnızca arazi yüksekliği ve kıyı çizgisi fonksiyonlarını dışarıdan alır.
// Tasarım ilkesi: binalar tek tek ağ (mesh) değildir — arketip başına InstancedMesh kullanılır,
// çeşitlilik arketip seçimi, ölçek sıçraması, 90° dönüşler ve cephe dokusundan gelir.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex2D, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import { makeFacadeTexture, makeRoadTexture, makeConcreteTexture, makeAsphaltTexture, makeGlowTexture } from './textures.js';

const noise = new Simplex2D(5150);

// ---------------------------------------------------------------------------
// Bölgeleme
// Merkezden dışa: downtown -> core -> urban -> suburb -> outskirt -> kır.
// Sanayi bölgesi kuzeybatı diliminde, ticaret ise ana arterlerin kenarında yer alır.
// Sınırlar gürültüyle bozulur; kusursuz daireler yapay görünür.
export const ZONE = { NONE: 0, DOWNTOWN: 1, CORE: 2, URBAN: 3, SUBURB: 4, OUTSKIRT: 5, INDUSTRIAL: 6, PARK: 7 };

export function makeZoning(cfg) {
  const { x: CX, z: CZ, r: R } = cfg;
  // Halka yarıçapları R'ye oranlıdır; şehir büyüklüğü değişince oranlar korunur
  const rD = R * 0.19, rC = R * 0.37, rU = R * 0.60, rS = R * 0.84;
  return function zoneAt(wx, wz) {
    const dx = wx - CX, dz = wz - CZ;
    // Gürültü: halka sınırlarını dalgalandırır (±%12)
    const wob = 1 + 0.13 * noise.fbm(wx * 0.00035 + 4.2, wz * 0.00035 - 1.7, 3, 2.0, 0.5);
    const d = Math.hypot(dx, dz) * wob;
    if (d > R) return ZONE.NONE;
    const ang = Math.atan2(dz, dx);
    // Sanayi dilimi: kuzeybatı (liman/otoyol tarafı), merkeze çok yaklaşmaz
    const indAng = Math.abs(((ang - 2.45 + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (indAng < 0.46 && d > rC && d < R * 0.97) return ZONE.INDUSTRIAL;
    // Parklar: merkeze yakın birkaç yeşil alan
    const pk = noise.fbm(wx * 0.0011 - 9.3, wz * 0.0011 + 5.5, 2, 2.0, 0.5);
    if (pk > 0.46 && d > rD * 0.7 && d < rU) return ZONE.PARK;
    if (d < rD) return ZONE.DOWNTOWN;
    if (d < rC) return ZONE.CORE;
    if (d < rU) return ZONE.URBAN;
    if (d < rS) return ZONE.SUBURB;
    return ZONE.OUTSKIRT;
  };
}

// ---------------------------------------------------------------------------
// Bina arketipleri
// Her arketip TEMSİLİ boyutta üretilir ve UV'leri o boyuta göre döşenir. Örneklerde
// ölçek yalnızca ±%25 oynatılır; böylece cephe dokusu esnemez ama siluet tekdüze olmaz.
// Yükseklik çeşitliliği arketip seçiminden gelir, tek bir kutuyu uzatmaktan değil.
const FACE_MOD = 4.2;     // yatayda bir doku döşemesi ~4,2 m (kat genişliği)
const FLOOR_MOD = 3.6;    // düşeyde bir doku döşemesi ~3,6 m (kat yüksekliği)

function boxWithUV(w, h, d, uOff = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // BoxGeometry yüz sırası: +X, -X, +Y, -Y, +Z, -Z (her yüz 4 köşe)
  const su = [d, d, w, w, w, w], sv = [h, h, d, d, h, h];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * (su[f] / FACE_MOD) + uOff, uv.getY(k) * (sv[f] / FLOOR_MOD));
    }
  }
  g.translate(0, h / 2, 0);
  return g;
}

// Düz kutu bina
function archBox(w, h, d) { return boxWithUV(w, h, d); }

// Kademeli kule: taban + daralan gövde + kule başlığı
function archStepped(w, h, d) {
  const parts = [boxWithUV(w, h * 0.55, d)];
  const b = boxWithUV(w * 0.72, h * 0.30, d * 0.72); b.translate(0, h * 0.55, 0); parts.push(b);
  const c = boxWithUV(w * 0.46, h * 0.15, d * 0.46); c.translate(0, h * 0.85, 0); parts.push(c);
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

// Podyumlu ofis: geniş alçak taban + ince kule
function archPodium(w, h, d) {
  const parts = [boxWithUV(w, h * 0.16, d)];
  const t = boxWithUV(w * 0.55, h * 0.84, d * 0.62); t.translate(0, h * 0.16, 0); parts.push(t);
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

// Çatısında teknik hacim ve anten olan bina
function archRoofPlant(w, h, d) {
  const parts = [boxWithUV(w, h, d)];
  const m = boxWithUV(w * 0.34, 3.2, d * 0.34); m.translate(w * 0.14, h, -d * 0.1); parts.push(m);
  const m2 = boxWithUV(w * 0.2, 1.8, d * 0.22); m2.translate(-w * 0.22, h, d * 0.2); parts.push(m2);
  const mast = new THREE.CylinderGeometry(0.22, 0.22, 7, 4);
  mast.translate(w * 0.14, h + 3.2 + 3.5, -d * 0.1);
  mast.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(mast.attributes.position.count * 2), 2));
  parts.push(mast);
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

// Müstakil ev: gövde + beşik çatı
function archHouse(w, h, d) {
  const body = boxWithUV(w, h, d);
  const sh = new THREE.Shape();
  sh.moveTo(-w / 2 - 0.4, 0); sh.lineTo(w / 2 + 0.4, 0); sh.lineTo(0, h * 0.62); sh.lineTo(-w / 2 - 0.4, 0);
  const roof = new THREE.ExtrudeGeometry(sh, { depth: d + 0.8, bevelEnabled: false });
  roof.rotateY(0); roof.translate(0, h, -(d + 0.8) / 2);
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(roof.attributes.position.count * 2), 2));
  return mergeGeometries([body, roof].map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

// Arketiplerin temsilî boyutları (çarpışma kutusu ve yerleşim payı için)
export const ARCH_DIMS = {
  towerTall: { w: 30, h: 128, d: 30 }, towerMid: { w: 26, h: 78, d: 30 }, towerSlim: { w: 18, h: 96, d: 18 },
  officeBig: { w: 40, h: 44, d: 34 }, officeLow: { w: 34, h: 26, d: 28 },
  blockMid: { w: 30, h: 30, d: 22 }, blockLow: { w: 26, h: 18, d: 20 },
  apart: { w: 24, h: 21, d: 16 }, apartS: { w: 18, h: 14, d: 14 },
  house: { w: 11, h: 5.4, d: 8.5 }, shop: { w: 20, h: 7.5, d: 14 },
  warehouse: { w: 58, h: 12, d: 34 }, warehouseS: { w: 34, h: 9, d: 24 },
};

// Depo / fabrika: uzun alçak kutu + hafif eğimli çatı bandı
function archWarehouse(w, h, d) {
  const parts = [boxWithUV(w, h, d)];
  const r = boxWithUV(w + 1.4, 1.0, d + 1.4); r.translate(0, h, 0); parts.push(r);
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)), false);
}

// ---------------------------------------------------------------------------
// Yol ağı
// Hiyerarşi: çevre otoyolu (ring) > arterler (radyal) > cadde ızgarası > sokaklar.
// Izgara açısı dünya eksenlerinden döndürülür: hem daha doğal görünür hem de arazi
// ızgarasıyla eş düzlemli desen oluşmaz.
function buildRoadNetwork(cfg, zoneAt, landAt) {
  const { x: CX, z: CZ, r: R } = cfg;
  const TH = cfg.gridAngle;
  const ca = Math.cos(TH), sa = Math.sin(TH);
  const toWorld = (u, v) => [CX + u * ca - v * sa, CZ + u * sa + v * ca];
  const roads = { highway: [], arterial: [], street: [], local: [] };

  // Çevre otoyolu: şehrin dışını dolanan kapalı halka (karada kalan bölümü)
  const ringR = R * 0.95;
  const ringPts = [];
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const rr = ringR * (1 + 0.045 * noise.fbm(Math.cos(a) * 2.1 + 31, Math.sin(a) * 2.1 - 7, 2, 2.0, 0.5));
    ringPts.push([CX + Math.cos(a) * rr, CZ + Math.sin(a) * rr]);
  }
  // Denize düşen bölümleri at, kara parçalarını ayrı polilinelere böl
  let run = [];
  for (const p of ringPts) {
    if (landAt(p[0], p[1])) run.push(p);
    else { if (run.length > 3) roads.highway.push({ w: 24, pts: run }); run = []; }
  }
  if (run.length > 3) roads.highway.push({ w: 24, pts: run });

  // Radyal arterler: ringden merkeze
  const radials = 6;
  for (let i = 0; i < radials; i++) {
    const a = TH + (i / radials) * Math.PI * 2 + 0.11;
    const pts = [];
    for (let t = 1.0; t >= 0.06; t -= 0.055) {
      const rr = ringR * t;
      const bend = 0.10 * Math.sin(t * 5.2 + i);
      pts.push([CX + Math.cos(a + bend) * rr, CZ + Math.sin(a + bend) * rr]);
    }
    const land = pts.filter((p) => landAt(p[0], p[1]));
    if (land.length > 3) roads.arterial.push({ w: 16, pts: land });
  }

  // Cadde ızgarası: bölgeye göre aralık. Merkeze yakın sık, dışta seyrek.
  const step = cfg.block;
  const n = Math.ceil(R / step);
  for (let i = -n; i <= n; i++) {
    const u = i * step;
    // Doğu-batı (ızgara v yönünde tarama)
    let seg = [];
    for (let j = -n; j <= n; j++) {
      const v = j * step;
      const [wx, wz] = toWorld(u, v);
      const z = zoneAt(wx, wz);
      const keep = z !== ZONE.NONE && landAt(wx, wz) && (z !== ZONE.SUBURB || i % 2 === 0) && (z !== ZONE.OUTSKIRT || i % 3 === 0);
      if (keep) seg.push([wx, wz]);
      else { if (seg.length > 2) roads.street.push({ w: 9, pts: seg, over: false }); seg = []; }
    }
    if (seg.length > 2) roads.street.push({ w: 9, pts: seg, over: false });
    // Kuzey-güney
    seg = [];
    for (let j = -n; j <= n; j++) {
      const v = j * step;
      const [wx, wz] = toWorld(v, u);
      const z = zoneAt(wx, wz);
      const keep = z !== ZONE.NONE && landAt(wx, wz) && (z !== ZONE.SUBURB || i % 2 === 0) && (z !== ZONE.OUTSKIRT || i % 3 === 0);
      if (keep) seg.push([wx, wz]);
      else { if (seg.length > 2) roads.street.push({ w: 9, pts: seg, over: true }); seg = []; }
    }
    if (seg.length > 2) roads.street.push({ w: 9, pts: seg, over: true });
  }

  // Sahil bulvarı: kıyı hattını takip eder
  const boul = [];
  for (let i = -28; i <= 28; i++) {
    const u = i * (R / 26);
    const [wx0] = toWorld(u, 0);
    const cz = cfg.coastZ(wx0) - 150;
    if (Math.hypot(wx0 - CX, cz - CZ) < R * 1.02 && landAt(wx0, cz)) boul.push([wx0, cz]);
    else if (boul.length > 3) { roads.arterial.push({ w: 14, pts: boul.slice() }); boul.length = 0; }
  }
  if (boul.length > 3) roads.arterial.push({ w: 14, pts: boul });

  return { roads, toWorld, ringR };
}

// ---------------------------------------------------------------------------
export class City {
  // opts: { center:{x,z,r,elev}, heightAt, coastZ, quality, group }
  constructor(opts) {
    this.o = opts;
    this.cfg = {
      x: opts.center.x, z: opts.center.z, r: opts.center.r, elev: opts.center.elev,
      block: 168, gridAngle: 0.26, coastZ: opts.coastZ,
    };
    this.q = opts.quality;
    this.disposables = [];
    this.group = new THREE.Group();
    this.group.name = 'city';
    this.tiers = [];       // { mesh(es), dist, visible } — mesafeye göre açılıp kapanır
    this.zoneAt = makeZoning(this.cfg);
    this.heightAt = opts.heightAt;
    this.landAt = (x, z) => this.heightAt(x, z) > 2.5;
    this.center = new THREE.Vector3(this.cfg.x, this.cfg.elev, this.cfg.z);
  }

  track(o) { this.disposables.push(o); return o; }

  build() {
    const net = buildRoadNetwork(this.cfg, this.zoneAt, this.landAt);
    this.net = net;
    this.buildRoads(net.roads);
    this.buildBuildings(net);
    this.buildLandmarks();
    this.buildGreenery(net);
    this.buildDetails(net);
    this.buildTraffic(net);
    return this.group;
  }

  buildRoads(roads) {
    const tex = this.track(makeRoadTexture(128, 256));
    tex.anisotropy = this.q.anisotropy;
    // Kesişmelerde z-fighting olmaması için katmanlar ayrı ofsetlerde: otoyol > arter > cadde(DB) > cadde(KG)
    const layers = [
      { list: roads.highway, units: -14, y: 0.42, tier: 'far' },
      { list: roads.arterial, units: -11, y: 0.38, tier: 'far' },
      { list: roads.street.filter((r) => !r.over), units: -7, y: 0.32, tier: 'mid' },
      { list: roads.street.filter((r) => r.over), units: -9, y: 0.34, tier: 'mid' },
    ];
    for (const L of layers) {
      if (!L.list.length) continue;
      const geos = L.list.map((r) => this.ribbon(r.pts, r.w, L.y)).filter(Boolean);
      if (!geos.length) continue;
      const merged = this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false));
      geos.forEach((g) => g.dispose());
      const mat = this.track(new THREE.MeshStandardMaterial({
        map: tex, roughness: 0.92, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: L.units,
      }));
      const mesh = new THREE.Mesh(merged, mat);
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      if (L.tier === 'mid') this.addTier([mesh], 11000);
    }
  }

  // Poliline'dan araziye oturan şerit geometrisi
  ribbon(pts, width, yOff) {
    if (pts.length < 2) return null;
    const positions = [], uvs = [], idx = [];
    let v = 0, dist = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = pts[Math.max(0, i - 1)], next = pts[Math.min(pts.length - 1, i + 1)];
      let tx = next[0] - prev[0], tz = next[1] - prev[1];
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      if (i > 0) dist += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
      const y = this.heightAt(p[0], p[1]) + yOff;
      positions.push(p[0] - nx * width / 2, y, p[1] - nz * width / 2, p[0] + nx * width / 2, y, p[1] + nz * width / 2);
      uvs.push(0, dist / 22, 1, dist / 22);
      if (i > 0) { const a = v - 2, b = v - 1, c = v, d = v + 1; idx.push(a, b, c, b, d, c); }
      v += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  // Mesafeye göre açılıp kapanan katman (histerezisli; eşikte titremez)
  addTier(meshes, dist) { this.tiers.push({ meshes, dist, on: true }); }

  // -------------------------------------------------------------------------
  // Binalar
  buildBuildings(net) {
    const rand = mulberry32(31337);
    const { block } = this.cfg;
    const toWorld = net.toWorld;
    const R = this.cfg.r;
    const n = Math.ceil(R / block);

    // Malzemeler: dört cephe tipi. Bina rengi örnek rengiyle (instanceColor) değişir.
    const mk = (kind, rough, metal, emis) => this.track(new THREE.MeshStandardMaterial({
      map: this.track(makeFacadeTexture(kind, 256)), roughness: rough, metalness: metal,
      emissive: emis ? 0x0a1420 : 0x000000, emissiveIntensity: emis ? 0.35 : 0,
    }));
    const M = {
      glass: mk('glass', 0.20, 0.18, true),
      office: mk('office', 0.82, 0.05, false),
      apartment: mk('apartment', 0.88, 0.02, false),
      industrial: mk('industrial', 0.75, 0.25, false),
    };
    for (const k of Object.keys(M)) { M[k].map.repeat.set(1, 1); }

    // Arketipler: temsilî boyutlarda üretilir, örneklerde yalnızca hafif ölçek sıçraması olur.
    // Yükseklik dağılımı gerçekçidir: çok sayıda alçak, az sayıda orta, birkaç yüksek.
    const A = {
      towerTall: this.track(archStepped(30, 128, 30)),
      towerMid: this.track(archPodium(26, 78, 30)),
      towerSlim: this.track(archBox(18, 96, 18)),
      officeBig: this.track(archRoofPlant(40, 44, 34)),
      officeLow: this.track(archRoofPlant(34, 26, 28)),
      blockMid: this.track(archBox(30, 30, 22)),
      blockLow: this.track(archRoofPlant(26, 18, 20)),
      apart: this.track(archBox(24, 21, 16)),
      apartS: this.track(archBox(18, 14, 14)),
      house: this.track(archHouse(11, 5.4, 8.5)),
      shop: this.track(archBox(20, 7.5, 14)),
      warehouse: this.track(archWarehouse(58, 12, 34)),
      warehouseS: this.track(archWarehouse(34, 9, 24)),
    };

    // Her (arketip, malzeme) çifti bir InstancedMesh'e karşılık gelir; listeler önce doldurulur.
    const buckets = new Map();
    const put = (arch, matKey, tier, m4, col) => {
      const key = arch + '|' + matKey + '|' + tier;
      let b = buckets.get(key);
      if (!b) { b = { arch, matKey, tier, items: [] }; buckets.set(key, b); }
      b.items.push({ m: m4.clone(), c: col });
    };

    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    const place = (wx, wz, arch, matKey, tier, sBase, tint) => {
      const y = this.heightAt(wx, wz);
      if (y < 2.0) return;                                   // suya/bataklığa bina koyma
      const s = sBase * (0.86 + rand() * 0.30);
      const rot = Math.floor(rand() * 4) * (Math.PI / 2) + (rand() - 0.5) * 0.10;
      q.setFromAxisAngle(up, rot);
      sc.set(s * (0.9 + rand() * 0.22), s * (0.78 + rand() * 0.52), s * (0.9 + rand() * 0.22));
      pv.set(wx, y - 0.4, wz);
      m4.compose(pv, q, sc);
      col.setHSL(tint.h + (rand() - 0.5) * tint.hs, tint.s, tint.l + (rand() - 0.5) * tint.ls);
      put(arch, matKey, tier, m4, col.clone());
      // Çarpışma kutusu YALNIZCA anlamlı yükseklikteki yapılar için üretilir. Alçak evlerin
      // kutusunu tutmak hem çarpışma sorgusunu şişirir hem de banliyö üzerinde alçak uçuşu
      // imkânsız kılardı; o irtifada zaten araziye çarpılır.
      const dims = ARCH_DIMS[arch];
      const bh = dims.h * sc.y;
      if (bh > 18) this.boxes.push({ x: wx, z: wz, rx: dims.w * sc.x * 0.5, rz: dims.d * sc.z * 0.5, h: y + bh });
    };

    this.boxes = [];
    const TINT = {
      // Ton dağılımı geniş tutulur: aynı arketip farklı renklerde tekrar edince
      // "aynı binadan bin tane" hissi kaybolur.
      glass: { h: 0.54, hs: 0.16, s: 0.30, l: 1.10, ls: 0.34 },
      office: { h: 0.11, hs: 0.22, s: 0.14, l: 0.92, ls: 0.34 },
      apartment: { h: 0.07, hs: 0.26, s: 0.26, l: 0.86, ls: 0.38 },
      industrial: { h: 0.53, hs: 0.22, s: 0.10, l: 0.95, ls: 0.28 },
    };

    // Blok doldurma: her blok alt ızgaraya bölünür ve hücrelere bina yerleştirilir.
    // Bölgeye göre alt ızgara sıklığı ve doluluk oranı değişir; şehir merkezden dışa
    // doğru kademeli olarak seyrekleşir (ani "gökdelen -> boş çayır" geçişi olmaz).
    const FILL = {
      [ZONE.DOWNTOWN]: { m: 2, p: 0.95, pad: 0.80 },
      [ZONE.CORE]: { m: 3, p: 0.82, pad: 0.80 },
      [ZONE.URBAN]: { m: 3, p: 0.72, pad: 0.82 },
      [ZONE.SUBURB]: { m: 3, p: 0.62, pad: 0.84 },
      [ZONE.OUTSKIRT]: { m: 3, p: 0.20, pad: 0.86 },
      [ZONE.INDUSTRIAL]: { m: 2, p: 0.62, pad: 0.82 },
    };
    for (let i = -n; i <= n; i++) {
      for (let j = -n; j <= n; j++) {
        const [bx, bz] = toWorld(i * block, j * block);
        const zone = this.zoneAt(bx, bz);
        if (zone === ZONE.NONE || zone === ZONE.PARK) continue;
        if (!this.landAt(bx, bz)) continue;
        const F = FILL[zone];
        if (!F) continue;
        // Kenardan içe doğru doluluk azalır: şehir kırlığa yumuşak geçer
        const dn = Math.hypot(bx - this.cfg.x, bz - this.cfg.z) / R;
        const fill = F.p * (1 - 0.55 * smoothstep(0.72, 1.0, dn));
        const cell = (block * F.pad) / F.m;
        for (let a = 0; a < F.m; a++) {
          for (let b = 0; b < F.m; b++) {
            if (rand() > fill) continue;
            const ou = (a - (F.m - 1) / 2) * cell + (rand() - 0.5) * cell * 0.40;
            const ov = (b - (F.m - 1) / 2) * cell + (rand() - 0.5) * cell * 0.40;
            const [cx, cz] = toWorld(i * block + ou, j * block + ov);
            const r = rand();
            if (zone === ZONE.DOWNTOWN) {
              // Yükseklik dağılımı: çoğu orta, azı çok yüksek (gerçekçi siluet)
              if (r < 0.12) place(cx, cz, 'towerTall', 'glass', 'far', 1.0, TINT.glass);
              else if (r < 0.34) place(cx, cz, 'towerSlim', 'glass', 'far', 1.0, TINT.glass);
              else if (r < 0.58) place(cx, cz, 'towerMid', r < 0.47 ? 'glass' : 'office', 'far', 1.0, r < 0.47 ? TINT.glass : TINT.office);
              else if (r < 0.82) place(cx, cz, 'officeBig', 'office', 'mid', 1.0, TINT.office);
              else place(cx, cz, 'officeLow', 'office', 'mid', 1.0, TINT.office);
            } else if (zone === ZONE.CORE) {
              if (r < 0.07) place(cx, cz, 'towerMid', 'glass', 'far', 0.85, TINT.glass);
              else if (r < 0.34) place(cx, cz, 'officeBig', 'office', 'mid', 1.0, TINT.office);
              else if (r < 0.62) place(cx, cz, 'blockMid', 'apartment', 'mid', 1.0, TINT.apartment);
              else if (r < 0.86) place(cx, cz, 'officeLow', 'office', 'mid', 1.0, TINT.office);
              else place(cx, cz, 'apart', 'apartment', 'mid', 1.0, TINT.apartment);
            } else if (zone === ZONE.URBAN) {
              if (r < 0.14) place(cx, cz, 'blockMid', 'apartment', 'mid', 1.0, TINT.apartment);
              else if (r < 0.58) place(cx, cz, 'apart', 'apartment', 'mid', 1.0, TINT.apartment);
              else if (r < 0.84) place(cx, cz, 'apartS', 'apartment', 'near', 1.0, TINT.apartment);
              else place(cx, cz, 'shop', 'office', 'near', 1.0, TINT.office);
            } else if (zone === ZONE.SUBURB) {
              if (r < 0.10) place(cx, cz, 'apartS', 'apartment', 'near', 1.0, TINT.apartment);
              else if (r < 0.16) place(cx, cz, 'shop', 'office', 'near', 1.0, TINT.office);
              else {
                // Müstakil ev bölgesinde hücre içine 2 ev sığar
                place(cx - 13, cz - 11, 'house', 'apartment', 'near', 1.0, TINT.apartment);
                if (rand() < 0.7) place(cx + 13, cz + 11, 'house', 'apartment', 'near', 1.0, TINT.apartment);
              }
            } else if (zone === ZONE.OUTSKIRT) {
              place(cx, cz, 'house', 'apartment', 'near', 1.0, TINT.apartment);
            } else if (zone === ZONE.INDUSTRIAL) {
              if (r < 0.46) place(cx, cz, 'warehouse', 'industrial', 'mid', 1.0, TINT.industrial);
              else if (r < 0.80) place(cx, cz, 'warehouseS', 'industrial', 'mid', 1.0, TINT.industrial);
              else place(cx, cz, 'blockLow', 'industrial', 'mid', 1.0, TINT.industrial);
            }
          }
        }
      }
    }

    // InstancedMesh'lere dök. Katmanlar: far (her zaman), mid (~9 km), near (~4 km)
    const tierMeshes = { far: [], mid: [], near: [] };
    let total = 0;
    for (const b of buckets.values()) {
      if (!b.items.length) continue;
      const im = new THREE.InstancedMesh(A[b.arch], M[b.matKey], b.items.length);
      b.items.forEach((it, k) => { im.setMatrixAt(k, it.m); im.setColorAt(k, it.c); });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      // Binalar gölge ÜRETMEZ: gölge kamerası uçağın çevresinde ±70 m'lik küçük bir
      // hacimdir; 15 bin örnekli ağları gölge geçişine sokmak kare başına ağır maliyet
      // getirir ve görsel kazanç neredeyse yoktur. Uçağın gölge kalitesi korunur.
      im.castShadow = false;
      im.receiveShadow = false;
      im.matrixAutoUpdate = false;
      im.computeBoundingSphere();
      this.group.add(im);
      tierMeshes[b.tier].push(im);
      total += b.items.length;
    }
    this.buildingCount = total;
    this.addTier(tierMeshes.mid, 9000);
    this.addTier(tierMeshes.near, 4200);
  }

  // -------------------------------------------------------------------------
  // Şehir yeşili: park alanları, cadde ağaçları ve banliyö bahçeleri.
  // Tek bir InstancedMesh; yalnızca yakın mesafede görünür.
  buildGreenery(net) {
    const rand = mulberry32(2024);
    const trunk = new THREE.CylinderGeometry(0.28, 0.42, 3.4, 4, 1, true); trunk.translate(0, 1.7, 0);
    const crown = new THREE.IcosahedronGeometry(3.0, 0); crown.translate(0, 5.2, 0);
    for (const g of [trunk, crown]) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    const geo = this.track(mergeGeometries([trunk, crown].map((g) => (g.index ? g.toNonIndexed() : g)), false));
    const mat = this.track(new THREE.MeshStandardMaterial({ color: 0x3c6b2c, roughness: 0.92 }));
    const items = [];
    const R = this.cfg.r, block = this.cfg.block;
    const n = Math.ceil(R / block);
    const col = new THREE.Color();
    // Parklar: yoğun ağaç kümeleri
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const [bx, bz] = net.toWorld(i * block, j * block);
      const zone = this.zoneAt(bx, bz);
      if (!this.landAt(bx, bz)) continue;
      let k = 0;
      if (zone === ZONE.PARK) k = 16;
      else if (zone === ZONE.SUBURB) k = 4;
      else if (zone === ZONE.OUTSKIRT) k = 3;
      else if (zone === ZONE.URBAN) k = 2;
      else if (zone === ZONE.CORE || zone === ZONE.DOWNTOWN) k = 1;
      for (let t = 0; t < k; t++) {
        const x = bx + (rand() - 0.5) * block * 0.9, z = bz + (rand() - 0.5) * block * 0.9;
        const y = this.heightAt(x, z);
        if (y < 2.5) continue;
        items.push({ x, y, z, s: 0.7 + rand() * 0.8, r: rand() * Math.PI * 2, c: rand() });
      }
    }
    if (!items.length) return;
    const im = new THREE.InstancedMesh(geo, mat, items.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    items.forEach((it, k) => {
      v.set(it.x, it.y, it.z); q.setFromAxisAngle(up, it.r); sc.set(it.s, it.s * (0.85 + it.c * 0.5), it.s);
      m4.compose(v, q, sc); im.setMatrixAt(k, m4);
      col.setHSL(0.26 + it.c * 0.07, 0.34 + it.c * 0.2, 0.22 + it.c * 0.14);
      im.setColorAt(k, col);
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false; im.matrixAutoUpdate = false; im.computeBoundingSphere();
    this.group.add(im);
    this.treeCount = items.length;
    this.addTier([im], 5600);
  }

  // -------------------------------------------------------------------------
  // Simgeler: az sayıda, tanınabilir yapı. Navigasyon için referans noktası olurlar.
  buildLandmarks() {
    const { x: CX, z: CZ, r: R } = this.cfg;
    const q = this.q;
    const glass = this.track(new THREE.MeshStandardMaterial({ color: 0x8fb6d4, roughness: 0.15, metalness: 0.55, envMapIntensity: 1.0 }));
    const conc = this.track(new THREE.MeshStandardMaterial({ color: 0xb9bcbe, roughness: 0.85 }));
    const dark = this.track(new THREE.MeshStandardMaterial({ color: 0x3c4249, roughness: 0.7, metalness: 0.2 }));
    const add = (g, mat, shadow = true) => {
      const m = new THREE.Mesh(this.track(g), mat);
      m.castShadow = q.shadows && shadow; m.receiveShadow = q.shadows;
      m.matrixAutoUpdate = false; m.updateMatrix();
      this.group.add(m);
      return m;
    };
    const gy = (x, z) => this.heightAt(x, z);
    this.landmarks = [];

    // 1) İmza gökdelen: daralan, tepesinde kule olan cam kule (şehrin en yükseği)
    {
      const x = CX + 120, z = CZ - 160, y = gy(x, z);
      const rows = [];
      const H = 252;
      for (let i = 0; i <= 10; i++) {
        const t = i / 10;
        const w = 21 * (1 - 0.62 * t * t);
        rows.push([
          { x: -w, y: y + H * t, z: -w }, { x: w, y: y + H * t, z: -w },
          { x: w, y: y + H * t, z: w }, { x: -w, y: y + H * t, z: w },
        ]);
      }
      const pos = [], idx = [], uv = [];
      for (const r of rows) for (const p of r) { pos.push(x + p.x, p.y, z + p.z); uv.push(0, 0); }
      for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < 4; k++) {
        const a = i * 4 + k, b = i * 4 + (k + 1) % 4, c = a + 4, d = b + 4;
        idx.push(a, c, b, b, c, d);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      add(g, glass);
      const spire = new THREE.CylinderGeometry(0.7, 2.2, 52, 6); spire.translate(x, y + H + 26, z);
      add(spire, dark, false);
      this.landmarks.push({ name: 'tower', x, z, h: H + 52 });
      this.boxes.push({ x, z, rx: 26, rz: 26, h: y + H });
    }
    // 2) Stadyum: banliyö kenarında oval
    {
      const x = CX - R * 0.52, z = CZ + R * 0.30, y = gy(x, z);
      if (y > 2) {
        const rows = [];
        for (let i = 0; i <= 3; i++) {
          const t = i / 3;
          const rx = 132 * (1 + 0.16 * t), rz = 104 * (1 + 0.16 * t);
          const yy = y + 4 + 26 * t;
          const ring = [];
          for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; ring.push({ x: x + Math.cos(a) * rx, y: yy, z: z + Math.sin(a) * rz }); }
          rows.push(ring);
        }
        const pos = [], idx = [], uv = [];
        for (const r of rows) for (const p of r) { pos.push(p.x, p.y, p.z); uv.push(0, 0); }
        for (let i = 0; i < rows.length - 1; i++) for (let k = 0; k < 24; k++) {
          const a = i * 24 + k, b = i * 24 + (k + 1) % 24, c = a + 24, d = b + 24;
          idx.push(a, b, c, b, d, c);
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
        g.setIndex(idx); g.computeVertexNormals();
        add(g, conc);
        const pitch = new THREE.CircleGeometry(100, 28); pitch.rotateX(-Math.PI / 2); pitch.scale(1, 1, 0.78); pitch.translate(x, y + 0.4, z);
        add(pitch, this.track(new THREE.MeshStandardMaterial({ color: 0x3e7a34, roughness: 0.95 })), false);
        this.landmarks.push({ name: 'stadium', x, z, h: 34 });
      }
    }
    // 3) Haberleşme kulesi: şehrin kuzey tepesinde, uzaktan görünür
    {
      const x = CX - R * 0.18, z = CZ - R * 1.15, y = gy(x, z);
      if (y > 2) {
        const parts = [];
        for (let i = 0; i < 3; i++) {
          const a = (i / 3) * Math.PI * 2;
          const leg = new THREE.CylinderGeometry(0.8, 1.6, 120, 5);
          leg.translate(Math.cos(a) * 5.5, 60, Math.sin(a) * 5.5);
          leg.rotateZ(0); parts.push(leg);
        }
        const shaft = new THREE.CylinderGeometry(2.4, 3.2, 150, 8); shaft.translate(0, 75, 0); parts.push(shaft);
        const pod = new THREE.CylinderGeometry(9, 7, 11, 12); pod.translate(0, 120, 0); parts.push(pod);
        const mast = new THREE.CylinderGeometry(0.5, 1.0, 46, 5); mast.translate(0, 173, 0); parts.push(mast);
        for (const p of parts) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
        const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
        g.translate(x, y, z);
        add(g, conc);
        this.landmarks.push({ name: 'mast', x, z, h: 196 });
        this.boxes.push({ x, z, rx: 12, rz: 12, h: y + 196 });
      }
    }
    // 4) Liman vinçleri: sanayi/liman bölgesinde, sahilde
    {
      const bx = CX - R * 0.66, bz = this.cfg.coastZ(CX - R * 0.66) - 260;
      const y = gy(bx, bz);
      if (y > 1.5) {
        const parts = [];
        for (let k = 0; k < 4; k++) {
          const ox = k * 86;
          const col1 = new THREE.BoxGeometry(3, 46, 3); col1.translate(ox - 12, 23, -14);
          const col2 = new THREE.BoxGeometry(3, 46, 3); col2.translate(ox + 12, 23, -14);
          const col3 = new THREE.BoxGeometry(3, 46, 3); col3.translate(ox - 12, 23, 14);
          const col4 = new THREE.BoxGeometry(3, 46, 3); col4.translate(ox + 12, 23, 14);
          const beam = new THREE.BoxGeometry(6, 4, 108); beam.translate(ox, 48, 16);
          parts.push(col1, col2, col3, col4, beam);
        }
        for (const p of parts) if (!p.attributes.uv) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
        const g = mergeGeometries(parts.map((p) => (p.index ? p.toNonIndexed() : p)), false);
        g.translate(bx, y, bz);
        add(g, this.track(new THREE.MeshStandardMaterial({ color: 0xc46a2a, roughness: 0.7, metalness: 0.3 })));
        this.landmarks.push({ name: 'port', x: bx, z: bz, h: 52 });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Sokak detayları: aydınlatma direkleri ve otoparklar. Hepsi birleştirilmiş tek
  // ağdır ve yalnızca yakın mesafede görünür (uzakta piksel altı kalıp parıldarlar).
  buildDetails(net) {
    const rand = mulberry32(8123);
    const poles = [];
    const pole = (x, z, h) => {
      const y = this.heightAt(x, z);
      const p = new THREE.CylinderGeometry(0.16, 0.22, h, 4); p.translate(x, y + h / 2, z);
      const arm = new THREE.BoxGeometry(2.2, 0.22, 0.22); arm.translate(x + 1.1, y + h, z);
      const head = new THREE.BoxGeometry(1.0, 0.24, 0.5); head.translate(x + 2.0, y + h - 0.1, z);
      poles.push(p, arm, head);
    };
    // Otoyol ve arterlerde direkler
    for (const r of [...net.roads.highway, ...net.roads.arterial]) {
      for (let i = 2; i < r.pts.length - 1; i += 2) {
        const p = r.pts[i];
        if (this.heightAt(p[0], p[1]) < 2) continue;
        pole(p[0], p[1] + r.w * 0.7, 11);
      }
    }
    // Cadde ızgarasında seyrek direkler (yalnızca merkez ve çevresi)
    for (const r of net.roads.street) {
      if (rand() < 0.62) continue;
      const p = r.pts[Math.floor(r.pts.length / 2)];
      const d = Math.hypot(p[0] - this.cfg.x, p[1] - this.cfg.z);
      if (d > this.cfg.r * 0.62) continue;
      if (this.heightAt(p[0], p[1]) < 2) continue;
      pole(p[0], p[1] + 6, 8);
    }
    if (poles.length) {
      for (const p of poles) if (!p.attributes.uv) p.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.attributes.position.count * 2), 2));
      const g = this.track(mergeGeometries(poles.map((p) => (p.index ? p.toNonIndexed() : p)), false));
      const mesh = new THREE.Mesh(g, this.track(new THREE.MeshStandardMaterial({ color: 0x70767c, roughness: 0.7, metalness: 0.3 })));
      mesh.matrixAutoUpdate = false;
      this.group.add(mesh);
      this.addTier([mesh], 2600);
      this.poleCount = poles.length / 3;
    }

    // Otoparklar: merkez ve sanayi bölgesinde asfalt dörtgenler + çizgiler
    const lots = [], lines = [];
    const n = Math.ceil(this.cfg.r / this.cfg.block);
    for (let i = -n; i <= n; i += 2) for (let j = -n; j <= n; j += 2) {
      const [wx, wz] = net.toWorld(i * this.cfg.block, j * this.cfg.block);
      const zone = this.zoneAt(wx, wz);
      if (zone !== ZONE.INDUSTRIAL && zone !== ZONE.CORE && zone !== ZONE.URBAN) continue;
      if (rand() > 0.22) continue;
      const y = this.heightAt(wx, wz);
      if (y < 2) continue;
      const w = 54 + rand() * 34, d = 40 + rand() * 26;
      const pg = new THREE.PlaneGeometry(w, d); pg.rotateX(-Math.PI / 2); pg.translate(wx, y + 0.22, wz);
      lots.push(pg);
      for (let k = -3; k <= 3; k++) {
        const lg = new THREE.PlaneGeometry(0.35, d * 0.8); lg.rotateX(-Math.PI / 2); lg.translate(wx + k * (w / 8), y + 0.25, wz);
        lines.push(lg);
      }
    }
    if (lots.length) {
      const at = this.track(makeAsphaltTexture(256)); at.anisotropy = this.q.anisotropy;
      const lm = new THREE.Mesh(this.track(mergeGeometries(lots, false)), this.track(new THREE.MeshStandardMaterial({ map: at, roughness: 0.94, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -8 })));
      lm.matrixAutoUpdate = false; this.group.add(lm);
      const ll = new THREE.Mesh(this.track(mergeGeometries(lines, false)), this.track(new THREE.MeshStandardMaterial({ color: 0xd8d8cc, roughness: 0.85, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -12 })));
      ll.matrixAutoUpdate = false; this.group.add(ll);
      this.addTier([lm, ll], 5200);
    }
  }

  // -------------------------------------------------------------------------
  // Trafik: yol poliline'ları üzerinde ilerleyen örneklenmiş kutular.
  // Fizik yok; yalnızca yol boyunca sabit hızla kayarlar. Uzakta tamamen kapanır.
  buildTraffic(net) {
    const q = this.q;
    const budget = q.traffic || 0;
    if (!budget) return;
    const rand = mulberry32(5511);
    // Yol havuzu: otoyol ve arterler ağırlıklı (yoğunluk oraya yığılır)
    const pool = [];
    const addPath = (r, weight) => {
      // Uzunluğu hesapla ve kümülatif tabloyu kur (sabit hızda ilerleyebilmek için)
      const cum = [0];
      for (let i = 1; i < r.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]));
      const len = cum[cum.length - 1];
      if (len < 220) return;
      for (let k = 0; k < weight; k++) pool.push({ pts: r.pts, cum, len, lanes: r.w * 0.26 });
    };
    for (const r of net.roads.highway) addPath(r, 4);
    for (const r of net.roads.arterial) addPath(r, 3);
    for (const r of net.roads.street) addPath(r, 1);
    if (!pool.length) return;

    const carGeo = this.track(mergeGeometries([
      (() => { const g = new THREE.BoxGeometry(1.9, 1.15, 4.4); g.translate(0, 0.72, 0); return g; })(),
      (() => { const g = new THREE.BoxGeometry(1.7, 0.75, 2.1); g.translate(0, 1.62, -0.25); return g; })(),
    ], false));
    const carMat = this.track(new THREE.MeshStandardMaterial({ roughness: 0.42, metalness: 0.35 }));
    const count = Math.min(budget, pool.length * 3);
    const im = new THREE.InstancedMesh(carGeo, carMat, count);
    im.frustumCulled = true;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const col = new THREE.Color();
    this.cars = [];
    for (let i = 0; i < count; i++) {
      const p = pool[Math.floor(rand() * pool.length)];
      this.cars.push({
        p, s: rand() * p.len,
        v: (p.lanes > 4 ? 26 : 13) * (0.8 + rand() * 0.45) * (rand() < 0.5 ? 1 : -1),
        lane: (rand() < 0.5 ? -1 : 1) * p.lanes * 0.5,
      });
      col.setHSL(rand(), 0.25 + rand() * 0.4, 0.28 + rand() * 0.5);
      im.setColorAt(i, col);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false; im.receiveShadow = false;
    this.group.add(im);
    this.trafficMesh = im;
    this.trafficCount = count;
    this._m4 = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._v = new THREE.Vector3(); this._s = new THREE.Vector3(1, 1, 1);
    this.addTier([im], 3200);
  }

  // Yol üzerinde s mesafesindeki konum ve yön
  samplePath(p, s) {
    const len = p.len;
    let t = s % len; if (t < 0) t += len;
    let i = 1;
    while (i < p.cum.length - 1 && p.cum[i] < t) i++;
    const a = p.pts[i - 1], b = p.pts[i];
    const seg = Math.max(1e-3, p.cum[i] - p.cum[i - 1]);
    const f = (t - p.cum[i - 1]) / seg;
    return {
      x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f,
      dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg,
    };
  }

  // -------------------------------------------------------------------------
  update(dt, camPos) {
    // Katman görünürlüğü: mesafe şehrin MERKEZİNE değil, şehir kütlesinin dışına göre
    // ölçülür. Merkeze göre ölçülseydi şehrin içindeyken bile uzak sayılıp trafik ve
    // sokak detayları kapanırdı. Histerezis eşikte açılıp kapanmayı önler.
    const dc = Math.hypot(camPos.x - this.center.x, camPos.y - this.center.y, camPos.z - this.center.z);
    const d = Math.max(0, dc - this.cfg.r * 0.8);
    for (const t of this.tiers) {
      const on = t.on ? d < t.dist + 400 : d < t.dist - 400;
      if (on !== t.on) { t.on = on; for (const m of t.meshes) m.visible = on; }
    }
    // Trafik yalnızca görünürken güncellenir; uzakta hiç işlenmez
    const im = this.trafficMesh;
    if (!im || !im.visible || !this.cars) return;
    const m4 = this._m4, q = this._q, v = this._v, s = this._s;
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.cars.length; i++) {
      const c = this.cars[i];
      c.s += c.v * dt;
      const p = this.samplePath(c.p, c.s);
      const nx = -p.dz, nz = p.dx;
      const x = p.x + nx * c.lane, z = p.z + nz * c.lane;
      v.set(x, this.heightAt(x, z) + 0.35, z);
      q.setFromAxisAngle(up, Math.atan2(p.dx * Math.sign(c.v), p.dz * Math.sign(c.v)));
      m4.compose(v, q, s);
      im.setMatrixAt(i, m4);
    }
    im.instanceMatrix.needsUpdate = true;
  }

  dispose() { for (const d of this.disposables) if (d && d.dispose) d.dispose(); }
}
