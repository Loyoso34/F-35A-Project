// Dünya: 40 km arazi (LOD'lu parçalar), gökyüzü, güneş, su, ormanlar, nehir, yollar, kasaba, bulutlar ve hava üssü.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex2D, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import {
  makeGrassTexture, makeAsphaltTexture, makeConcreteTexture, makeWaterNormalTexture,
  makeHangarWallTexture, makeHangarDoorTexture, makeTextTexture, makeCloudTexture, makeRoadTexture, makeWindowsTexture,
} from './textures.js';
import { buildStaticAircraftGeometries } from './aircraft.js';

export const MAP_SIZE = 40000;
export const WATER_LEVEL = -4;
export const LAYER_TREES = 1;

const simplex = new Simplex2D(2024);
const LAKES = [
  { x: -9000, z: -6200, r: 1900 },
  { x: 8600, z: 5600, r: 2300 },
  { x: 3200, z: -11500, r: 1400 },
  { x: -12500, z: 9000, r: 1600 },
];
// Nehir: doğudaki gölden batıya doğru, üssün güneyinden geçer (+z güney)
const RIVER = [
  [8600, 5600], [6200, 4600], [4200, 4300], [2200, 4400], [0, 3800], [-2200, 3300], [-4600, 3000],
  [-7500, 2500], [-10500, 2200], [-14000, 1800], [-20500, 1200],
];
const TOWN = { x: 2600, z: 6900, r: 1250 };
// Yollar (poligon çizgileri) – hepsi düzlük koridorunda
const ROADS = [
  { name: 'base-town', w: 9, pts: [[0, 1050], [300, 2200], [1000, 3400], [1700, 4200], [2100, 5200], [2500, 6100], [2600, 6900]] },
  { name: 'town-east', w: 8, pts: [[2600, 6900], [3800, 7100], [5200, 6900], [6700, 6500], [7600, 6200]] },
  { name: 'base-west', w: 9, pts: [[-1200, 1050], [-2500, 1300], [-4500, 1500], [-7500, 1700], [-11000, 1500], [-14500, 1200], [-19500, 900]] },
  { name: 'town-north', w: 7, pts: [[2600, 6900], [2650, 8300], [2900, 10200], [3400, 12500], [3800, 15000]] },
];
// Kasaba sokakları (yalnızca yol ağı ve ev yerleşimi için; arazi düzleştirmesine dahil değil)
const TOWN_STREETS = [];
for (let i = -4; i <= 4; i++) {
  const half = Math.sqrt(Math.max(0, TOWN.r * TOWN.r - (i * 240) * (i * 240))) * 0.95;
  if (half < 200) continue;
  TOWN_STREETS.push({ w: 6, pts: [[TOWN.x - half, TOWN.z + i * 240], [TOWN.x + half, TOWN.z + i * 240]] });
  TOWN_STREETS.push({ w: 6, pts: [[TOWN.x + i * 240, TOWN.z - half], [TOWN.x + i * 240, TOWN.z + half]] });
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az;
  const wx = px - ax, wz = pz - az;
  const L2 = vx * vx + vz * vz || 1;
  const t = clamp((wx * vx + wz * vz) / L2, 0, 1);
  const dx = ax + vx * t - px, dz = az + vz * t - pz;
  return Math.hypot(dx, dz);
}
function distToPolyline(px, pz, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, pz, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
    if (d < best) best = d;
  }
  return best;
}

// Hava üssü düzlüğü (dikdörtgen + yumuşak geçiş)
function baseFlatMask(x, z) {
  const dx = Math.max(0, Math.abs(x) - 4600);
  const dz = Math.max(0, Math.abs(z) - 1500);
  const d = Math.hypot(dx, dz);
  return smoothstep(0, 2400, d);
}
function townMask(x, z) {
  return smoothstep(TOWN.r + 1100, TOWN.r - 200, Math.hypot(x - TOWN.x, z - TOWN.z));
}
function roadMask(x, z) {
  let d = Infinity;
  for (const r of ROADS) { const dd = distToPolyline(x, z, r.pts); if (dd < d) d = dd; }
  return smoothstep(520, 230, d);
}
function softplus(v, k) { return k * Math.log1p(Math.exp(v / k)); }

export function terrainHeight(x, z) {
  const n = simplex.fbm(x * 0.00018 + 3.1, z * 0.00018 - 2.7, 5, 2.0, 0.5);
  let h = 110 + n * 240;
  h += simplex.fbm(x * 0.0009 + 7, z * 0.0009 + 3, 3, 2.0, 0.5) * 30;
  h = softplus(h, 25);
  // Kenarlara doğru dağlar
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const mtn = smoothstep(10500, 18500, edge);
  if (mtn > 0) {
    const m1 = simplex.fbm(x * 0.00032 + 11, z * 0.00032 - 5, 5, 2.1, 0.5);
    const ridge = 1 - Math.abs(simplex.fbm(x * 0.00055 - 4, z * 0.00055 + 9, 3, 2.0, 0.5));
    h += mtn * (500 + 1100 * (0.5 + 0.5 * m1) + 380 * ridge * ridge);
  }
  h *= baseFlatMask(x, z);
  h = lerp(h, 12, townMask(x, z));
  const rm = roadMask(x, z) * baseFlatMask(x, z);
  h = lerp(h, 6, rm);
  for (const L of LAKES) {
    const wob = 1 + 0.22 * simplex.noise(x * 0.0012 + L.x, z * 0.0012 + L.z);
    const d = (Math.hypot(x - L.x, z - L.z) / L.r) * wob;
    const outer = smoothstep(1.9, 1.05, d);
    h = lerp(h, 7, outer);
    const inner = smoothstep(1.06, 0.72, d);
    h = lerp(h, -16, inner);
  }
  const rd = distToPolyline(x, z, RIVER) * (1 + 0.25 * simplex.noise(x * 0.002 + 1, z * 0.002 + 2));
  const rOuter = smoothstep(650, 200, rd);
  h = lerp(h, 6.5, rOuter);
  const rInner = smoothstep(120, 55, rd);
  h = lerp(h, -14, rInner);
  return h;
}

export function isWaterAt(x, z) { return terrainHeight(x, z) < WATER_LEVEL; }

function forestMask(x, z) {
  const f = simplex.fbm(x * 0.00055 + 50, z * 0.00055 + 50, 3, 2.0, 0.5);
  const hills = smoothstep(40, 220, terrainHeight(x, z));
  return smoothstep(0.08, 0.35, f + hills * 0.12);
}
// Tarla deseni: düzlüklerde dikdörtgen hücreler
function fieldPattern(x, z) {
  const cx = Math.floor(x / 360 + 0.35 * Math.sin(z * 0.0007)), cz = Math.floor(z / 240 + 0.3 * Math.cos(x * 0.0005));
  const r = mulberry32((cx * 73856093) ^ (cz * 19349663))();
  return r;
}

// ---- Hava üssü yerleşimi ----
export const AIRBASE = {
  runwayLength: 3000, runwayWidth: 45, runwayZ: 0,
  taxiwayZ: 200, taxiwayNorthZ: -200, taxiwayWidth: 23,
  apron: { x0: -760, x1: 760, z0: 211.5, z1: 580 },
  links: [-1450, -725, 0, 725, 1450],
  linksNorth: [-1450, 0, 1450],
  hangars: [-560, -280, 0, 280, 560].map((x) => ({ x, z: 700, w: 72, d: 62, h: 14, arch: 7 })),
  shelters: [-560, -400, -240, -80, 80, 240, 400, 560].map((x) => ({ x, z: 480, w: 34, d: 30, h: 8 })),
  parking: Array.from({ length: 16 }, (_, i) => ({ x: -600 + i * 80, z: 330 })),
  has: [-720, -480, -240, 0, 240, 480, 720].map((x) => ({ x, z: -470, w: 32, d: 44, h: 11 })),
  hasLaneZ: -330,
  tower: { x: 980, z: 300, r: 4.5, h: 32 },
  hq: { x: 980, z: 420, w: 70, d: 22, h: 12 },
  fuel: [-1000, -1000, -960, -960].map((x, i) => ({ x: x + (i % 2) * 0, z: 380 + Math.floor(i / 2) * 32 + (i % 2) * 0, r: 10, h: 8 })),
  waterTower: { x: 1120, z: 640 },
  radar: { x: -1200, z: -380 },
  gateZ: 1050,
};
AIRBASE.fuel = [{ x: -1010, z: 380, r: 10, h: 8 }, { x: -975, z: 380, r: 10, h: 8 }, { x: -1010, z: 410, r: 10, h: 8 }, { x: -975, z: 410, r: 10, h: 8 }];

export function surfaceTypeAt(x, z) {
  const A = AIRBASE;
  const L2 = A.runwayLength / 2, tw = A.taxiwayWidth / 2;
  if (Math.abs(x) <= L2 && Math.abs(z - A.runwayZ) <= A.runwayWidth / 2) return 'runway';
  if (Math.abs(x) <= L2 && Math.abs(z - A.taxiwayZ) <= tw) return 'taxiway';
  if (Math.abs(x) <= L2 && Math.abs(z - A.taxiwayNorthZ) <= tw) return 'taxiway';
  for (const lx of A.links) if (Math.abs(x - lx) <= tw && z >= 0 && z <= (Math.abs(lx) <= 725 ? A.apron.z0 + 1 : A.taxiwayZ)) return 'taxiway';
  for (const lx of A.linksNorth) if (Math.abs(x - lx) <= tw && z <= 0 && z >= A.taxiwayNorthZ) return 'taxiway';
  if (Math.abs(x) <= 800 && Math.abs(z - A.hasLaneZ) <= tw) return 'taxiway';
  for (const lx of [0]) if (Math.abs(x - lx) <= tw && z <= A.taxiwayNorthZ && z >= A.hasLaneZ) return 'taxiway';
  if (x >= A.apron.x0 && x <= A.apron.x1 && z >= A.apron.z0 && z <= A.apron.z1) return 'apron';
  if (Math.abs(x) <= 700 && z >= A.apron.z1 && z <= 770) return 'apron';
  if (terrainHeight(x, z) < WATER_LEVEL) return 'water';
  return 'grass';
}

export function buildingBoxes() {
  const boxes = [];
  const A = AIRBASE;
  const add = (cx, cz, w, d, h) => boxes.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, minY: 0, maxY: h });
  for (const h of A.hangars) add(h.x, h.z, h.w, h.d, h.h + h.arch);
  for (const s of A.shelters) add(s.x, s.z, s.w, s.d, s.h + 1);
  for (const s of A.has) add(s.x, s.z, s.w, s.d, s.h);
  add(A.tower.x, A.tower.z, 16, 16, A.tower.h + 8);
  add(A.hq.x, A.hq.z, A.hq.w, A.hq.d, A.hq.h);
  for (const f of A.fuel) add(f.x, f.z, f.r * 2, f.r * 2, f.h + 1);
  add(A.waterTower.x, A.waterTower.z, 14, 14, 30);
  add(A.radar.x, A.radar.z, 14, 14, 24);
  return boxes;
}

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 0, drawDistance: 13000, trees: 6000, treeDistance: 5500, water: 'simple', terrainSegments: 24, anisotropy: 2, clouds: 40, lod: [4500, 9500] },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, drawDistance: 21000, trees: 13000, treeDistance: 8500, water: 'reflective', terrainSegments: 32, anisotropy: 4, clouds: 70, lod: [7000, 15500] },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, drawDistance: 34000, trees: 24000, treeDistance: 13000, water: 'reflective', terrainSegments: 40, anisotropy: 8, clouds: 110, lod: [9500, 21000] },
};

export class World {
  constructor(scene, renderer, qualityKey) {
    this.scene = scene;
    this.renderer = renderer;
    this.qualityKey = qualityKey;
    this.quality = QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.disposables = [];
    this.time = 0;
    this.halfSize = MAP_SIZE / 2;
    this.buildingBoxes = buildingBoxes();
    this.townBoxes = [];
    this.sunDir = new THREE.Vector3(0.45, 0.62, -0.35).normalize();
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildRoads();
    this.buildTown();
    this.buildAirbase();
    this.buildClouds();
  }

  track(obj) { this.disposables.push(obj); return obj; }

  // Gökyüzü renk fonksiyonu (su shader'ı ile paylaşılır)
  static skyGLSL() {
    return `
      vec3 skyColor(vec3 d, vec3 sunDir, vec3 zenith, vec3 horizon, vec3 ground, vec3 sunColor, float sunStrength) {
        float t = clamp(d.y, -1.0, 1.0);
        vec3 col;
        if (t >= 0.0) col = mix(horizon, zenith, pow(t, 0.5));
        else col = mix(horizon, ground, clamp(-t * 6.0, 0.0, 1.0));
        float c = max(dot(d, sunDir), 0.0);
        col += sunColor * (pow(c, 8.0) * 0.10 + pow(c, 128.0) * 0.35) * sunStrength;
        col += sunColor * smoothstep(0.99935, 0.99965, c) * 6.0 * sunStrength;
        return col;
      }`;
  }

  buildSky() {
    const geo = new THREE.SphereGeometry(1, 32, 16);
    this.skyUniforms = {
      sunDir: { value: this.sunDir.clone() },
      zenith: { value: new THREE.Color(0x2f6fc4) },
      horizon: { value: new THREE.Color(0xb9d0e6) },
      ground: { value: new THREE.Color(0x9fb3c4) },
      sunColor: { value: new THREE.Color(0xfff4dc) },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms,
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.999999;
        }`,
      fragmentShader: `
        uniform vec3 sunDir; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor;
        varying vec3 vDir;
        ${World.skyGLSL()}
        void main() {
          vec3 col = skyColor(normalize(vDir), sunDir, zenith, horizon, ground, sunColor, 1.0);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.scale.setScalar(30000);
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    this.sky = sky;
    this.group.add(sky);
    this.scene.fog = new THREE.Fog(new THREE.Color(0xb9d0e6), this.quality.drawDistance * 0.3, this.quality.drawDistance * 0.98);
    this.scene.background = null;
  }

  buildLights() {
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
    sun.position.copy(this.sunDir).multiplyScalar(600);
    sun.target.position.set(0, 0, 0);
    this.group.add(sun.target);
    if (this.quality.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.quality.shadowMap, this.quality.shadowMap);
      const s = 70;
      sun.shadow.camera.left = -s; sun.shadow.camera.right = s;
      sun.shadow.camera.top = s; sun.shadow.camera.bottom = -s;
      sun.shadow.camera.near = 50; sun.shadow.camera.far = 1400;
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.05;
      sun.shadow.radius = 2;
    }
    this.sun = sun;
    this.group.add(sun);
    this.group.add(new THREE.HemisphereLight(0x9ec3ee, 0x55603c, 1.05));
    const fill = new THREE.DirectionalLight(0xcfe0f5, 0.55);
    fill.position.set(-this.sunDir.x, 0.35, -this.sunDir.z).normalize().multiplyScalar(500);
    this.group.add(fill);
  }

  // ---- Arazi: 12x12 parça, her biri 3 LOD (etekli) ----
  buildTerrain() {
    const q = this.quality;
    const chunksPerSide = 12;
    const chunkSize = MAP_SIZE / chunksPerSide;
    const segHi = q.terrainSegments;
    const grass = this.track(makeGrassTexture(512));
    grass.anisotropy = q.anisotropy;
    const mat = this.track(new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95, metalness: 0 }));
    this.terrainMaterial = mat;
    const C = {
      grassA: new THREE.Color(0.30, 0.54, 0.18), grassB: new THREE.Color(0.50, 0.60, 0.24),
      forest: new THREE.Color(0.15, 0.36, 0.13), rock: new THREE.Color(0.44, 0.41, 0.37),
      sand: new THREE.Color(0.64, 0.58, 0.40), high: new THREE.Color(0.50, 0.47, 0.42),
      snow: new THREE.Color(0.93, 0.94, 0.96), fieldA: new THREE.Color(0.72, 0.60, 0.26),
      fieldB: new THREE.Color(0.38, 0.52, 0.20), fieldC: new THREE.Color(0.52, 0.40, 0.22),
      town: new THREE.Color(0.56, 0.53, 0.46), road: new THREE.Color(0.55, 0.62, 0.36),
    };
    const tmp = new THREE.Color();
    const terrainGroup = new THREE.Group();
    terrainGroup.name = 'terrain';
    this.terrainChunks = [];
    const n = segHi + 1;
    const nb = n + 2; // kenarlıklı ızgara (normal hesabı için)
    const hb = new Float32Array(nb * nb);
    const cgrid = new Float32Array(n * n * 3);
    const ngrid = new Float32Array(n * n * 3);
    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const x0 = -MAP_SIZE / 2 + cx * chunkSize;
        const z0 = -MAP_SIZE / 2 + cz * chunkSize;
        const step = chunkSize / segHi;
        for (let j = 0; j < nb; j++) for (let k = 0; k < nb; k++) hb[j * nb + k] = terrainHeight(x0 + (k - 1) * step, z0 + (j - 1) * step);
        const H = (j, k) => hb[(j + 1) * nb + (k + 1)];
        for (let j = 0; j < n; j++) {
          for (let k = 0; k < n; k++) {
            const x = x0 + k * step, z = z0 + j * step;
            const h = H(j, k);
            const dhx = (H(j, k + 1) - H(j, k - 1)) / (2 * step);
            const dhz = (H(j + 1, k) - H(j - 1, k)) / (2 * step);
            const slope = Math.hypot(dhx, dhz);
            const nl = 1 / Math.hypot(dhx, 1, dhz);
            const i3 = (j * n + k) * 3;
            ngrid[i3] = -dhx * nl; ngrid[i3 + 1] = nl; ngrid[i3 + 2] = -dhz * nl;
            const f = forestMask(x, z);
            const varn = simplex.noise(x * 0.0021, z * 0.0021) * 0.5 + 0.5;
            tmp.copy(C.grassA).lerp(C.grassB, varn);
            const plains = smoothstep(90, 25, h) * (1 - f) * smoothstep(0.08, 0.02, slope);
            if (plains > 0.05) {
              const r = fieldPattern(x, z);
              const fc = r < 0.3 ? C.fieldA : r < 0.55 ? C.fieldB : r < 0.7 ? C.fieldC : null;
              if (fc) tmp.lerp(fc, plains * 0.75);
            }
            tmp.lerp(C.forest, f * 0.8);
            if (h < WATER_LEVEL + 4) tmp.lerp(C.sand, smoothstep(WATER_LEVEL + 4, WATER_LEVEL - 4, h));
            tmp.lerp(C.rock, smoothstep(0.35, 0.8, slope));
            tmp.lerp(C.high, smoothstep(320, 600, h));
            tmp.lerp(C.snow, smoothstep(1100, 1450, h) * (1 - smoothstep(0.9, 1.4, slope)));
            const tm = townMask(x, z);
            if (tm > 0.4) tmp.lerp(C.town, Math.min(1, (tm - 0.4) * 1.6) * 0.85);
            cgrid[i3] = tmp.r; cgrid[i3 + 1] = tmp.g; cgrid[i3 + 2] = tmp.b;
          }
        }
        const center = new THREE.Vector3(x0 + chunkSize / 2, 0, z0 + chunkSize / 2);
        const meshes = [];
        const strides = [1, 2];
        const skirts = [45, 110];
        for (let L = 0; L < 2; L++) {
          const stride = strides[L];
          const seg = segHi / stride;
          const m = seg + 1;
          const nv = m * m + 4 * m;
          const pos = new Float32Array(nv * 3), col = new Float32Array(nv * 3), nrm = new Float32Array(nv * 3), uv = new Float32Array(nv * 2);
          let vi = 0;
          const setV = (x, y, z, ci) => {
            pos[vi * 3] = x; pos[vi * 3 + 1] = y; pos[vi * 3 + 2] = z;
            col[vi * 3] = cgrid[ci]; col[vi * 3 + 1] = cgrid[ci + 1]; col[vi * 3 + 2] = cgrid[ci + 2];
            nrm[vi * 3] = ngrid[ci]; nrm[vi * 3 + 1] = ngrid[ci + 1]; nrm[vi * 3 + 2] = ngrid[ci + 2];
            uv[vi * 2] = x / 57; uv[vi * 2 + 1] = z / 57; vi++;
          };
          for (let j = 0; j < m; j++) for (let k = 0; k < m; k++) { const gj = j * stride, gk = k * stride; setV(x0 + gk * step, H(gj, gk), z0 + gj * step, (gj * n + gk) * 3); }
          const idx = [];
          for (let j = 0; j < seg; j++) for (let k = 0; k < seg; k++) { const a = j * m + k, b = a + 1, c = a + m, d = c + 1; idx.push(a, c, b, b, c, d); }
          const skirt = skirts[L];
          const edges = [
            { ring: (k) => k }, { ring: (k) => (m - 1) * m + k }, { ring: (j) => j * m }, { ring: (j) => j * m + (m - 1) },
          ];
          for (let e = 0; e < 4; e++) {
            const base = vi;
            for (let t = 0; t < m; t++) {
              const src = edges[e].ring(t);
              const gj = Math.floor(src / m) * stride, gk = (src % m) * stride;
              setV(pos[src * 3], pos[src * 3 + 1] - skirt, pos[src * 3 + 2], (gj * n + gk) * 3);
            }
            for (let t = 0; t < m - 1; t++) {
              const a = edges[e].ring(t), b = edges[e].ring(t + 1), c = base + t, d = base + t + 1;
              if (e === 0 || e === 3) idx.push(a, b, c, b, d, c); else idx.push(a, c, b, b, c, d);
            }
          }
          const g = new THREE.BufferGeometry();
          g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
          g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
          g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
          g.setIndex(idx);
          g.computeBoundingSphere();
          this.track(g);
          const mesh = new THREE.Mesh(g, mat);
          mesh.receiveShadow = q.shadows && L === 0;
          mesh.matrixAutoUpdate = false;
          mesh.visible = L === 1;
          terrainGroup.add(mesh);
          meshes.push(mesh);
        }
        this.terrainChunks.push({ meshes, center, lod: 1 });
      }
    }
    this.group.add(terrainGroup);
  }

  // ---- Su: analitik gökyüzü yansıması + fresnel + güneş parıltısı + hareketli dalga normalleri ----
  buildWater() {
    const q = this.quality;
    const geo = this.track(new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1));
    const normals = this.track(makeWaterNormalTexture(512));
    normals.anisotropy = q.anisotropy;
    const uniforms = THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        normalMap: { value: null }, time: { value: 0 }, sunDir: { value: this.sunDir.clone() },
        waterColor: { value: new THREE.Color(0x0b3550) }, deepColor: { value: new THREE.Color(0x041d2a) },
        zenith: { value: this.skyUniforms.zenith.value }, horizon: { value: this.skyUniforms.horizon.value },
        ground: { value: this.skyUniforms.ground.value }, sunColor: { value: this.skyUniforms.sunColor.value },
        detail: { value: q.water === 'reflective' ? 1.0 : 0.6 },
      },
    ]);
    uniforms.normalMap.value = normals;
    const mat = this.track(new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        varying vec3 vWorldPos;
        #include <fog_pars_vertex>
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorldPos = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: `
        uniform sampler2D normalMap; uniform float time; uniform vec3 sunDir; uniform vec3 waterColor; uniform vec3 deepColor;
        uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor; uniform float detail;
        varying vec3 vWorldPos;
        #include <fog_pars_fragment>
        ${World.skyGLSL()}
        void main() {
          vec2 uv = vWorldPos.xz * 0.018;
          vec3 n1 = texture2D(normalMap, uv + time * vec2(0.020, 0.014)).xyz * 2.0 - 1.0;
          vec3 n2 = texture2D(normalMap, uv * 2.9 - time * vec2(0.011, 0.023)).xyz * 2.0 - 1.0;
          vec3 n3 = texture2D(normalMap, uv * 0.23 + time * vec2(0.004, -0.003)).xyz * 2.0 - 1.0;
          float dist = length(cameraPosition - vWorldPos);
          float fadeFine = clamp(1.0 - dist / 2200.0, 0.0, 1.0);
          float fadeCoarse = clamp(1.0 - dist / 7000.0, 0.08, 1.0);
          vec3 nt = ((n1 + n2 * 0.35) * fadeFine + n3 * 0.9 * fadeCoarse) * detail;
          vec3 n = normalize(vec3(nt.x * 0.13, 1.0, nt.y * 0.13));
          vec3 V = normalize(cameraPosition - vWorldPos);
          vec3 R = reflect(-V, n);
          R.y = abs(R.y) + 0.02;
          vec3 sky = skyColor(normalize(R), sunDir, zenith, horizon, ground, sunColor, 0.35);
          float cosT = max(dot(V, n), 0.0);
          float fres = 0.03 + 0.97 * pow(1.0 - cosT, 5.0);
          fres = clamp(fres, 0.12, 0.8);
          vec3 base = mix(deepColor, waterColor, clamp(cosT * 1.4, 0.0, 1.0));
          vec3 col = mix(base, sky, fres);
          float rs = max(dot(normalize(R), sunDir), 0.0);
          col += sunColor * (pow(rs, 900.0) * 3.0 + pow(rs, 60.0) * 0.12);
          gl_FragColor = vec4(col, 1.0);
          #include <fog_fragment>
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: true,
    }));
    const water = new THREE.Mesh(geo, mat);
    water.rotation.x = -Math.PI / 2;
    water.position.y = WATER_LEVEL;
    water.renderOrder = 1;
    this.water = water;
    this.waterUniforms = uniforms;
    this.group.add(water);
  }

  buildTrees() {
    const q = this.quality;
    const rand = mulberry32(9001);
    const chunks = 6;
    const chunkSize = MAP_SIZE / chunks;
    const perChunk = [];
    for (let i = 0; i < chunks * chunks; i++) perChunk.push({ conifer: [], leafy: [] });
    let placed = 0, tries = 0;
    const A = AIRBASE;
    while (placed < q.trees && tries < q.trees * 30) {
      tries++;
      const x = (rand() - 0.5) * MAP_SIZE * 0.98;
      const z = (rand() - 0.5) * MAP_SIZE * 0.98;
      const f = forestMask(x, z);
      if (rand() > f * f + 0.01) continue;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 3 || h > 1250) continue;
      if (Math.abs(x) < 2500 && Math.abs(z) < 1250) continue; // üs alanı
      if (Math.hypot(x - TOWN.x, z - TOWN.z) < TOWN.r + 150 && rand() < 0.85) continue;
      if (roadMask(x, z) > 0.9 && distToPolylineAny(x, z) < 20) continue;
      const e = 10;
      const slope = Math.hypot(terrainHeight(x + e, z) - terrainHeight(x - e, z), terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
      if (slope > 0.8) continue;
      const cx = clamp(Math.floor((x + MAP_SIZE / 2) / chunkSize), 0, chunks - 1);
      const cz = clamp(Math.floor((z + MAP_SIZE / 2) / chunkSize), 0, chunks - 1);
      const bucket = perChunk[cz * chunks + cx];
      const conifer = h > 160 || rand() < 0.5;
      (conifer ? bucket.conifer : bucket.leafy).push({ x, y: h, z, s: 0.75 + rand() * 0.7, r: rand() * Math.PI * 2, c: rand() });
      placed++;
    }
    void A;
    const trunk = new THREE.CylinderGeometry(0.3, 0.5, 4, 5); trunk.translate(0, 2, 0);
    const cone1 = new THREE.ConeGeometry(2.6, 8, 7); cone1.translate(0, 7, 0);
    const cone2 = new THREE.ConeGeometry(1.8, 6, 7); cone2.translate(0, 11, 0);
    const colorize = (g, color) => { const n = g.attributes.position.count; const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; } g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g; };
    const brown = new THREE.Color(0.32, 0.22, 0.12), darkGreen = new THREE.Color(0.14, 0.32, 0.14), leafGreen = new THREE.Color(0.28, 0.48, 0.18);
    colorize(trunk, brown); colorize(cone1, darkGreen); colorize(cone2, darkGreen);
    const coniferGeo = mergeGeometries([trunk, cone1, cone2].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const trunk2 = new THREE.CylinderGeometry(0.35, 0.55, 5, 5); trunk2.translate(0, 2.5, 0);
    const crown = new THREE.IcosahedronGeometry(3.6, 1); crown.translate(0, 7.5, 0);
    colorize(trunk2, brown); colorize(crown, leafGreen);
    const leafyGeo = mergeGeometries([trunk2, crown].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    this.track(coniferGeo); this.track(leafyGeo);
    const mat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 }));
    this.treeChunks = [];
    const m4 = new THREE.Matrix4();
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();
    for (let i = 0; i < perChunk.length; i++) {
      const cx = i % chunks, cz = Math.floor(i / chunks);
      const center = new THREE.Vector3(-MAP_SIZE / 2 + (cx + 0.5) * chunkSize, 0, -MAP_SIZE / 2 + (cz + 0.5) * chunkSize);
      for (const [key, geo] of [['conifer', coniferGeo], ['leafy', leafyGeo]]) {
        const list = perChunk[i][key];
        if (list.length === 0) continue;
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        for (let k = 0; k < list.length; k++) {
          const t = list[k];
          pos.set(t.x, t.y - 0.3, t.z);
          quat.setFromAxisAngle(up, t.r);
          scl.set(t.s, t.s * (0.9 + t.c * 0.4), t.s);
          m4.compose(pos, quat, scl);
          im.setMatrixAt(k, m4);
          tint.setRGB(0.85 + t.c * 0.3, 0.85 + (1 - t.c) * 0.3, 0.9);
          im.setColorAt(k, tint);
        }
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
        im.castShadow = q.shadows && q.shadowMap >= 2048;
        im.layers.set(LAYER_TREES);
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false;
        this.group.add(im);
        this.treeChunks.push({ mesh: im, center, radius: chunkSize * 0.71 });
      }
    }
    this.treeCount = placed;
  }

  // Yol şeridi: poligon çizgi boyunca araziyi izleyen üçgen şerit
  roadGeometry(pts, width, yOffset = 0.3, minY = -Infinity) {
    const positions = [], uvs = [], idx = [];
    let v = 0, dist = 0;
    const samples = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(2, Math.ceil(len / 18));
      for (let k = (i === 0 ? 0 : 1); k <= n; k++) {
        const t = k / n;
        samples.push({ x: ax + (bx - ax) * t, z: az + (bz - az) * t, dx: (bx - ax) / len, dz: (bz - az) / len });
      }
    }
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const prev = samples[Math.max(0, i - 1)], next = samples[Math.min(samples.length - 1, i + 1)];
      let tx = next.x - prev.x, tz = next.z - prev.z;
      const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
      const nx = -tz, nz = tx;
      if (i > 0) dist += Math.hypot(s.x - prev.x, s.z - prev.z);
      const y = Math.max(terrainHeight(s.x, s.z), minY) + yOffset;
      positions.push(s.x - nx * width / 2, y, s.z - nz * width / 2, s.x + nx * width / 2, y, s.z + nz * width / 2);
      uvs.push(0, dist / 20, 1, dist / 20);
      if (i > 0) { const a = v - 2, b = v - 1, c = v, d = v + 1; idx.push(a, b, c, b, d, c); }
      v += 2;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }

  buildRoads() {
    const tex = this.track(makeRoadTexture(128, 256));
    tex.anisotropy = this.quality.anisotropy;
    const mat = this.track(new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    const geos = [...ROADS, ...TOWN_STREETS].map((r) => this.roadGeometry(r.pts, r.w, 0.3, WATER_LEVEL + 9));
    const merged = this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false));
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.receiveShadow = false;
    this.group.add(mesh);
    // Nehir köprüsü ayakları
    const pierMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8d8f92, roughness: 0.8 }));
    const piers = [];
    for (const [x, z] of [[1750, 4280], [1850, 4360]]) {
      const g = new THREE.BoxGeometry(6, 26, 4); g.translate(x, -8, z); piers.push(g);
    }
    this.group.add(new THREE.Mesh(this.track(mergeGeometries(piers, false)), pierMat));
  }

  buildTown() {
    const rand = mulberry32(4242);
    // Ev geometrisi: gövde + çatı, vertex renkleri
    const body = new THREE.BoxGeometry(9, 4, 7); body.translate(0, 2, 0);
    const roofShape = new THREE.Shape(); roofShape.moveTo(-4.9, 0); roofShape.lineTo(4.9, 0); roofShape.lineTo(0, 2.6); roofShape.lineTo(-4.9, 0);
    const roof = new THREE.ExtrudeGeometry(roofShape, { depth: 7.6, bevelEnabled: false }); roof.translate(0, 4, -3.8);
    const colorize = (g, color) => { const n = g.attributes.position.count; const arr = new Float32Array(n * 3); for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; } g.setAttribute('color', new THREE.BufferAttribute(arr, 3)); return g; };
    colorize(body, new THREE.Color(0.88, 0.84, 0.74));
    colorize(roof, new THREE.Color(0.55, 0.26, 0.20));
    const bodyNI = body.index ? body.toNonIndexed() : body; const roofNI = roof.index ? roof.toNonIndexed() : roof;
    for (const g of [bodyNI, roofNI]) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
    const houseGeo = this.track(mergeGeometries([bodyNI, roofNI], false));
    const houseMat = this.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
    const houses = [];
    const gridX = 30, gridZ = 27;
    for (let gz = -40; gz <= 40; gz++) {
      for (let gx = -40; gx <= 40; gx++) {
        const x = TOWN.x + gx * gridX + (rand() - 0.5) * 8, z = TOWN.z + gz * gridZ + (rand() - 0.5) * 8;
        const d = Math.hypot(x - TOWN.x, z - TOWN.z);
        if (d > TOWN.r * (0.75 + 0.35 * rand())) continue;
        if (rand() < 0.5) continue;
        if (distToPolylineAny(x, z) < 12) continue;
        const h = terrainHeight(x, z);
        if (h < 3) continue;
        houses.push({ x, y: h, z, rot: (rand() < 0.5 ? 0 : Math.PI / 2) + (rand() - 0.5) * 0.15, s: 0.8 + rand() * 0.5, c: rand() });
      }
    }
    const im = new THREE.InstancedMesh(houseGeo, houseMat, houses.length);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qu = new THREE.Quaternion(), sc = new THREE.Vector3(), tint = new THREE.Color();
    houses.forEach((hh, i) => {
      p.set(hh.x, hh.y, hh.z); qu.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hh.rot); sc.set(hh.s, hh.s * (0.9 + hh.c * 0.5), hh.s);
      m4.compose(p, qu, sc); im.setMatrixAt(i, m4);
      tint.setRGB(0.8 + hh.c * 0.25, 0.8 + (1 - hh.c) * 0.2, 0.75 + hh.c * 0.2); im.setColorAt(i, tint);
      this.townBoxes.push({ minX: hh.x - 5 * hh.s, maxX: hh.x + 5 * hh.s, minZ: hh.z - 4 * hh.s, maxZ: hh.z + 4 * hh.s, minY: 0, maxY: hh.y + 7 * hh.s });
    });
    im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = false; im.computeBoundingSphere(); im.matrixAutoUpdate = false;
    this.group.add(im);
    this.houseCount = houses.length;
    // Apartman blokları ve depo
    const winTex = this.track(makeWindowsTexture(512, 256, 10, 4));
    const blockMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const blocks = [];
    const blockDefs = [[2600, 6650, 26, 16, 16], [2400, 7100, 22, 14, 13], [2850, 7150, 30, 16, 19], [2350, 6600, 20, 14, 12], [3000, 6650, 24, 15, 15]];
    for (const [x, z, w, d, h] of blockDefs) {
      const g = new THREE.BoxGeometry(w, h, d);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 14), uv.getY(i) * (h / 8));
      const y = terrainHeight(x, z);
      g.translate(x, y + h / 2, z);
      blocks.push(g);
      this.townBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: y + h });
    }
    const bm = new THREE.Mesh(this.track(mergeGeometries(blocks, false)), blockMat);
    bm.castShadow = false;
    this.group.add(bm);
    this.townCenter = new THREE.Vector3(TOWN.x, 12, TOWN.z);
  }

  buildClouds() {
    const q = this.quality;
    const tex = this.track(makeCloudTexture(256));
    const rand = mulberry32(777);
    const n = q.clouds;
    const quad = this.track(new THREE.PlaneGeometry(1, 1));
    const vert = `
      attribute vec2 uv2;
      varying vec2 vUv; varying float vFog;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
        float sx = length(instanceMatrix[0].xyz), sy = length(instanceMatrix[1].xyz);
        vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        camRight = normalize(vec3(camRight.x, 0.0, camRight.z));
        vec3 wp = center + camRight * position.x * sx + vec3(0.0, 1.0, 0.0) * position.y * sy;
        vec4 mvPosition = viewMatrix * vec4(wp, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`;
    const frag = `
      uniform sampler2D map; uniform vec3 sunDir;
      varying vec2 vUv;
      #include <fog_pars_fragment>
      void main() {
        vec4 c = texture2D(map, vUv);
        float shade = 0.82 + 0.18 * vUv.y;
        gl_FragColor = vec4(c.rgb * shade, c.a * 0.92);
        #include <fog_fragment>
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`;
    const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null }, sunDir: { value: this.sunDir } }]);
    uniforms.map.value = tex;
    const billMat = this.track(new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, fog: true, side: THREE.DoubleSide }));
    const flatMat = this.track(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.6, side: THREE.DoubleSide, fog: true }));
    const per = 3;
    const bill = new THREE.InstancedMesh(quad, billMat, n * per);
    const flat = new THREE.InstancedMesh(quad, flatMat, n);
    const m4 = new THREE.Matrix4(), p = new THREE.Vector3(), qu = new THREE.Quaternion(), sc = new THREE.Vector3();
    const flatQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    for (let i = 0; i < n; i++) {
      const x = (rand() - 0.5) * MAP_SIZE * 0.9, z = (rand() - 0.5) * MAP_SIZE * 0.9;
      const y = 1900 + rand() * 1500;
      const w = 900 + rand() * 1500;
      for (let k = 0; k < per; k++) {
        const ox = (rand() - 0.5) * w * 0.7, oz = (rand() - 0.5) * w * 0.7, oy = (rand() - 0.3) * w * 0.12;
        const ww = w * (0.55 + rand() * 0.6), hh = ww * (0.32 + rand() * 0.2);
        p.set(x + ox, y + oy, z + oz); qu.identity(); sc.set(ww, hh, 1);
        m4.compose(p, qu, sc); bill.setMatrixAt(i * per + k, m4);
      }
      p.set(x, y - w * 0.12, z); sc.set(w * 1.3, w * 1.0, 1);
      m4.compose(p, flatQ, sc); flat.setMatrixAt(i, m4);
    }
    bill.instanceMatrix.needsUpdate = true; flat.instanceMatrix.needsUpdate = true;
    bill.frustumCulled = false; flat.frustumCulled = false;
    bill.renderOrder = 3; flat.renderOrder = 2;
    this.group.add(flat); this.group.add(bill);
    this.clouds = [bill, flat];
  }

  buildAirbase() {
    const A = AIRBASE;
    const q = this.quality;
    const asphalt = this.track(makeAsphaltTexture(512));
    const concrete = this.track(makeConcreteTexture(512));
    asphalt.anisotropy = q.anisotropy; concrete.anisotropy = q.anisotropy;
    const asphaltMat = this.track(new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.92 }));
    const concreteMat = this.track(new THREE.MeshStandardMaterial({ map: concrete, roughness: 0.85 }));
    const whiteMat = this.track(new THREE.MeshStandardMaterial({ color: 0xe6e6e0, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const yellowMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd8b52a, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const base = new THREE.Group();
    base.name = 'airbase';
    const flat = (w, d, x, z, y, uvScale = 1) => {
      const g = new THREE.PlaneGeometry(w, d);
      g.rotateX(-Math.PI / 2);
      g.translate(x, y, z);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / uvScale), uv.getY(i) * (d / uvScale));
      return g;
    };
    const L = A.runwayLength / 2, W = A.runwayWidth, tw = A.taxiwayWidth;
    const y = 0.09;

    // Asfalt: pist, iki paralel taksi yolu, bağlantılar, HAS şeridi, üs yolları
    const asphaltGeos = [
      flat(A.runwayLength, W, 0, A.runwayZ, 0.05, 18),
      flat(A.runwayLength + 60, tw, 0, A.taxiwayZ, 0.05, 18),
      flat(A.runwayLength + 60, tw, 0, A.taxiwayNorthZ, 0.05, 18),
      flat(1620, tw, 0, A.hasLaneZ, 0.05, 18),
      flat(tw, -A.hasLaneZ + A.taxiwayNorthZ + 2, 0, (A.taxiwayNorthZ + A.hasLaneZ) / 2, 0.05, 18),
    ];
    for (const lx of A.links) { const zEnd = Math.abs(lx) <= 725 ? A.apron.z0 + 2 : A.taxiwayZ; asphaltGeos.push(flat(tw, zEnd, lx, zEnd / 2, 0.05, 18)); }
    for (const lx of A.linksNorth) asphaltGeos.push(flat(tw, -A.taxiwayNorthZ, lx, A.taxiwayNorthZ / 2, 0.05, 18));
    // Pist kenarı toprak sahalar (kırılma sahası)
    for (const side of [-1, 1]) asphaltGeos.push(flat(80, W, side * (L + 40), 0, 0.04, 18));
    // Üs iç yolları
    asphaltGeos.push(flat(10, 480, -830, 810, 0.06, 20), flat(1720, 10, 0, 800, 0.06, 20), flat(10, 300, 830, 650, 0.06, 20), flat(10, 300, 0, 900, 0.06, 20), flat(240, 10, 1000, 500, 0.06, 20));
    const asphaltMesh = new THREE.Mesh(this.track(mergeGeometries(asphaltGeos, false)), asphaltMat);
    asphaltMesh.receiveShadow = q.shadows;
    base.add(asphaltMesh);

    // Beton: ana apron, hangar önleri, HAS önleri, HQ çevresi, yakıt çiftliği
    const ap = A.apron;
    const concreteGeos = [flat(ap.x1 - ap.x0, ap.z1 - ap.z0, (ap.x0 + ap.x1) / 2, (ap.z0 + ap.z1) / 2, 0.06, 30)];
    concreteGeos.push(flat(1400, 190, 0, 675, 0.06, 30));
    for (const s of A.has) concreteGeos.push(flat(s.w + 16, 100, s.x, s.z + s.d / 2 + 50 - 20, 0.06, 30));
    concreteGeos.push(flat(200, 200, A.tower.x, 360, 0.06, 30));
    concreteGeos.push(flat(120, 100, -990, 395, 0.06, 30));
    concreteGeos.push(flat(90, 60, 1120, 640, 0.06, 30));
    concreteGeos.push(flat(60, 60, A.radar.x, A.radar.z, 0.06, 30));
    const concreteMesh = new THREE.Mesh(this.track(mergeGeometries(concreteGeos, false)), concreteMat);
    concreteMesh.receiveShadow = q.shadows;
    base.add(concreteMesh);

    // Pist işaretleri (beyaz)
    const white = [];
    white.push(flat(A.runwayLength, 0.9, 0, W / 2 - 0.6, y));
    white.push(flat(A.runwayLength, 0.9, 0, -W / 2 + 0.6, y));
    for (const side of [-1, 1]) {
      const xs = side * (L - 6 - 15);
      for (let i = 0; i < 12; i++) { const z = -W / 2 + 3.6 + i * ((W - 7.2) / 11); white.push(flat(30, 1.8, xs, z, y)); }
      const xa = side * (L - 300 - 25);
      white.push(flat(50, 8, xa, 10, y)); white.push(flat(50, 8, xa, -10, y));
      for (const [dist, count] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) {
        const xt = side * (L - dist - 11);
        for (let k = 0; k < count; k++) { const off = 9 + k * 3; white.push(flat(22, 1.8, xt, off, y)); white.push(flat(22, 1.8, xt, -off, y)); }
      }
    }
    for (let x = -L + 120; x < L - 120; x += 50) white.push(flat(30, 0.9, x + 15, 0, y));
    base.add(new THREE.Mesh(this.track(mergeGeometries(white, false)), whiteMat));
    const numMat = (t) => this.track(new THREE.MeshBasicMaterial({ map: this.track(makeTextTexture(t, { w: 256, h: 256, font: 'bold 190px Arial', color: '#e8e8e2' })), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const numGeo = this.track(new THREE.PlaneGeometry(18, 18));
    const n09 = new THREE.Mesh(numGeo, numMat('09')); n09.rotation.set(-Math.PI / 2, 0, -Math.PI / 2); n09.position.set(-L + 75, 0.1, 0); base.add(n09);
    const n27 = new THREE.Mesh(numGeo, numMat('27')); n27.rotation.set(-Math.PI / 2, 0, Math.PI / 2); n27.position.set(L - 75, 0.1, 0); base.add(n27);

    // Sarı taksi hatları ve park yerleri
    const yellow = [flat(A.runwayLength + 20, 0.35, 0, A.taxiwayZ, y), flat(A.runwayLength + 20, 0.35, 0, A.taxiwayNorthZ, y), flat(1600, 0.35, 0, A.hasLaneZ, y)];
    for (const lx of A.links) { const zEnd = Math.abs(lx) <= 725 ? A.apron.z0 + 2 : A.taxiwayZ; yellow.push(flat(0.35, zEnd - 10, lx, zEnd / 2 + 5, y)); }
    for (const lx of A.linksNorth) yellow.push(flat(0.35, -A.taxiwayNorthZ - 10, lx, A.taxiwayNorthZ / 2 - 5, y));
    yellow.push(flat(0.35, -A.hasLaneZ + A.taxiwayNorthZ, 0, (A.taxiwayNorthZ + A.hasLaneZ) / 2, y));
    yellow.push(flat(ap.x1 - ap.x0 - 40, 0.35, 0, 300, y));
    for (const p of A.parking) { yellow.push(flat(0.35, 40, p.x, p.z + 10, y + 0.01)); yellow.push(flat(24, 0.35, p.x, p.z - 6, y + 0.01)); }
    for (const s of A.has) yellow.push(flat(0.35, 110, s.x, s.z + 55, y));
    base.add(new THREE.Mesh(this.track(mergeGeometries(yellow, false)), yellowMat));

    // Hangarlar
    const wallTex = this.track(makeHangarWallTexture(512)); wallTex.repeat.set(4, 1);
    const wallMat = this.track(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.85, metalness: 0.0 }));
    const roofMat = this.track(new THREE.MeshStandardMaterial({ color: 0x6f757b, roughness: 0.9, metalness: 0.0 }));
    const doorTex = this.track(makeHangarDoorTexture(512, 256));
    const doorMat = this.track(new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.8, metalness: 0.0 }));
    const plainMat = this.track(new THREE.MeshStandardMaterial({ color: 0xb8b4aa, roughness: 0.9, metalness: 0.0 }));
    const hasMat = this.track(new THREE.MeshStandardMaterial({ color: 0x8e8c84, roughness: 0.95, metalness: 0.0 }));
    const hangarGeos = [], roofGeos = [], doorGeos = [], plainGeos = [], hasGeos = [];
    for (const h of A.hangars) {
      const shape = new THREE.Shape();
      shape.moveTo(-h.w / 2, 0); shape.lineTo(h.w / 2, 0); shape.lineTo(h.w / 2, h.h);
      shape.absellipse(0, h.h, h.w / 2, h.arch, 0, Math.PI, false); shape.lineTo(-h.w / 2, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h.d, bevelEnabled: false, curveSegments: 12 });
      geo.translate(h.x, 0, h.z - h.d / 2);
      // Malzeme grupları: yan yüzler (duvar) ve uçlar. Basitlik için tümü duvar dokusu, çatı ayrı değil.
      hangarGeos.push(geo.index ? geo.toNonIndexed() : geo);
      const door = new THREE.PlaneGeometry(h.w * 0.82, h.h * 0.88);
      door.rotateY(Math.PI); door.translate(h.x, h.h * 0.44, h.z - h.d / 2 - 0.06);
      doorGeos.push(door);
    }
    // Güneşlikler (açık önlü): çatı + kolonlar
    for (const s of A.shelters) {
      const roof = new THREE.BoxGeometry(s.w, 0.6, s.d); roof.translate(s.x, s.h, s.z); roofGeos.push(roof);
      const back = new THREE.BoxGeometry(s.w, s.h, 0.5); back.translate(s.x, s.h / 2, s.z + s.d / 2); roofGeos.push(back);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const c = new THREE.CylinderGeometry(0.35, 0.35, s.h, 8); c.translate(s.x + sx * (s.w / 2 - 1), s.h / 2, s.z + sz * (s.d / 2 - 1)); roofGeos.push(c); }
    }
    // HAS: yarım silindir beton sığınaklar
    for (const s of A.has) {
      const g = new THREE.CylinderGeometry(s.w / 2, s.w / 2, s.d, 16, 1, false, 0, Math.PI);
      g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2);
      g.scale(1, s.h / (s.w / 2), 1);
      g.translate(s.x, 0, s.z);
      hasGeos.push(g.index ? g.toNonIndexed() : g);
      const back = new THREE.BoxGeometry(s.w + 2, s.h, 2); back.translate(s.x, s.h / 2, s.z - s.d / 2); hasGeos.push(back);
    }
    // HQ binası (pencereli), kule, yakıt tankları, su kulesi, radar
    const winTex = this.track(makeWindowsTexture(512, 256, 14, 3));
    const hqMat = this.track(new THREE.MeshStandardMaterial({ map: winTex, roughness: 0.85 }));
    const hqGeo = new THREE.BoxGeometry(A.hq.w, A.hq.h, A.hq.d);
    { const uv = hqGeo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 2, uv.getY(i)); }
    hqGeo.translate(A.hq.x, A.hq.h / 2, A.hq.z);
    base.add(new THREE.Mesh(this.track(hqGeo), hqMat));
    const t = A.tower;
    const shaft = new THREE.CylinderGeometry(t.r, t.r * 1.4, t.h, 12); shaft.translate(t.x, t.h / 2, t.z); plainGeos.push(shaft);
    const cabBase = new THREE.CylinderGeometry(t.r * 2.0, t.r * 1.2, 2.5, 12); cabBase.translate(t.x, t.h + 1.25, t.z); plainGeos.push(cabBase);
    const glassMat = this.track(new THREE.MeshStandardMaterial({ color: 0x1e2c3a, roughness: 0.35, metalness: 0.3 }));
    const cab = new THREE.Mesh(this.track(new THREE.CylinderGeometry(t.r * 2.0, t.r * 2.0, 3.8, 12)), glassMat); cab.position.set(t.x, t.h + 4.4, t.z); base.add(cab);
    const roofC = new THREE.ConeGeometry(t.r * 2.2, 1.8, 12); roofC.translate(t.x, t.h + 7.2, t.z); plainGeos.push(roofC);
    const ant = new THREE.CylinderGeometry(0.12, 0.12, 8, 6); ant.translate(t.x, t.h + 12, t.z); plainGeos.push(ant);
    const tankMat = this.track(new THREE.MeshStandardMaterial({ color: 0xd9d9d2, roughness: 0.6, metalness: 0.1 }));
    const tankGeos = [];
    for (const f of A.fuel) { const g = new THREE.CylinderGeometry(f.r, f.r, f.h, 18); g.translate(f.x, f.h / 2, f.z); tankGeos.push(g); }
    // Su kulesi
    const wt = A.waterTower;
    for (const [dx, dz] of [[-4, -4], [4, -4], [-4, 4], [4, 4]]) { const leg = new THREE.CylinderGeometry(0.35, 0.45, 22, 6); leg.translate(wt.x + dx, 11, wt.z + dz); tankGeos.push(leg); }
    const tank = new THREE.CylinderGeometry(7, 5, 8, 16); tank.translate(wt.x, 26, wt.z); tankGeos.push(tank);
    const tankTop = new THREE.ConeGeometry(7, 2.5, 16); tankTop.translate(wt.x, 31.2, wt.z); tankGeos.push(tankTop);
    // Radar kubbesi
    const rd = A.radar;
    const rTower = new THREE.CylinderGeometry(3, 4, 12, 10); rTower.translate(rd.x, 6, rd.z); plainGeos.push(rTower);
    const dome = new THREE.SphereGeometry(6.5, 18, 12); dome.translate(rd.x, 17, rd.z); tankGeos.push(dome);
    // Rüzgar tulumu
    const pole = new THREE.CylinderGeometry(0.12, 0.15, 8, 6); pole.translate(-1600, 4, 120); plainGeos.push(pole);
    const sock = new THREE.ConeGeometry(0.6, 3.2, 8); sock.rotateZ(-Math.PI / 2); sock.rotateY(0.4); sock.translate(-1598.5, 7.8, 120.6);
    base.add(new THREE.Mesh(this.track(sock), this.track(new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.9 }))));
    // Nizamiye ve çevre duvarı parçaları
    const gate = new THREE.BoxGeometry(12, 4, 6); gate.translate(-8, 2, A.gateZ); plainGeos.push(gate);
    const gate2 = new THREE.BoxGeometry(12, 4, 6); gate2.translate(8, 2, A.gateZ); plainGeos.push(gate2);
    const gateRoof = new THREE.BoxGeometry(36, 0.5, 8); gateRoof.translate(0, 5, A.gateZ); plainGeos.push(gateRoof);
    // Depolar (üs)
    for (const [x, z, w, d, h] of [[-1100, 620, 40, 20, 7], [-1160, 620, 40, 20, 7], [-1100, 660, 40, 20, 7], [1180, 420, 30, 18, 6], [1180, 470, 30, 18, 6]]) {
      const g = new THREE.BoxGeometry(w, h, d); g.translate(x, h / 2, z); plainGeos.push(g);
      this.buildingBoxes.push({ minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2, minY: 0, maxY: h });
    }
    const addMerged = (geos, mat, shadow = true) => {
      if (!geos.length) return;
      for (const g of geos) { if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2)); }
      const merged = this.track(mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)), false));
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = q.shadows && shadow; mesh.receiveShadow = q.shadows;
      base.add(mesh);
    };
    addMerged(hangarGeos, wallMat);
    addMerged(doorGeos, doorMat, false);
    addMerged(roofGeos, roofMat);
    addMerged(hasGeos, hasMat);
    addMerged(plainGeos, plainMat);
    addMerged(tankGeos, tankMat);

    // Işıklar (instanced, kendinden ışıklı)
    const lights = [];
    const push = (x, z, color, yy = 0.35) => lights.push({ x, z, color, y: yy });
    const cWhite = new THREE.Color(0xffffff), cGreen = new THREE.Color(0x30ff60), cRed = new THREE.Color(0xff3030), cBlue = new THREE.Color(0x3060ff), cAmber = new THREE.Color(0xffb020);
    for (let x = -L; x <= L; x += 60) { push(x, W / 2 + 1.5, cWhite); push(x, -W / 2 - 1.5, cWhite); }
    for (const side of [-1, 1]) {
      for (let z = -W / 2; z <= W / 2; z += 3) { push(side * (L + 1), z, cGreen); push(side * (L + 4), z, cRed); }
      for (let d = 30; d <= 900; d += 30) {
        push(side * (L + d), 0, cWhite);
        if (d % 150 === 0) for (const zz of [-6, -4, -2, 2, 4, 6]) push(side * (L + d), zz, cWhite);
      }
      for (let k = 0; k < 4; k++) push(side * (L - 300), -(W / 2 + 12 + k * 3), k < 2 ? cWhite : cRed);
    }
    for (const tz of [A.taxiwayZ, A.taxiwayNorthZ]) for (let x = -L + 20; x <= L - 20; x += 60) { push(x, tz + tw / 2 + 1, cBlue); push(x, tz - tw / 2 - 1, cBlue); }
    for (const lx of A.links) for (let z = 30; z < A.taxiwayZ - 10; z += 30) { push(lx + tw / 2 + 1, z, cBlue); push(lx - tw / 2 - 1, z, cBlue); }
    for (let x = ap.x0; x <= ap.x1; x += 90) push(x, ap.z1 + 3, cAmber);
    push(t.x, t.z, cRed, t.h + 15); push(wt.x, wt.z, cRed, 33); push(rd.x, rd.z, cRed, 24);
    const lightGeo = this.track(new THREE.SphereGeometry(0.28, 6, 4));
    const lightMat = this.track(new THREE.MeshBasicMaterial({ color: 0xbfbfbf }));
    const lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
    const m4 = new THREE.Matrix4();
    lights.forEach((l, i) => { m4.makeTranslation(l.x, l.y, l.z); lightMesh.setMatrixAt(i, m4); lightMesh.setColorAt(i, l.color); });
    lightMesh.instanceMatrix.needsUpdate = true; if (lightMesh.instanceColor) lightMesh.instanceColor.needsUpdate = true;
    lightMesh.frustumCulled = false;
    base.add(lightMesh);
    this.runwayLights = lightMesh;
    // Apron aydınlatma direkleri
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x777c80, roughness: 0.6, metalness: 0.3 }));
    const poles = [];
    for (const x of [ap.x0 + 30, -250, 250, ap.x1 - 30]) { const g = new THREE.CylinderGeometry(0.3, 0.4, 24, 6); g.translate(x, 12, ap.z1 - 12); poles.push(g); }
    base.add(new THREE.Mesh(this.track(mergeGeometries(poles, false)), poleMat));

    // Park halinde F-35'ler (statik, instanced)
    try {
      const parts = buildStaticAircraftGeometries();
      const spots = A.parking.filter((_, i) => i % 2 === 0);
      const shelterSpots = A.shelters.filter((_, i) => i % 2 === 1).map((s) => ({ x: s.x, z: s.z + 2 }));
      const all = [...spots, ...shelterSpots];
      const rnd = mulberry32(31);
      const mats = all.map((p) => { const m = new THREE.Matrix4(); const yaw = -Math.PI / 2 + Math.PI / 2 * 0 + (rnd() - 0.5) * 0.06; m.compose(new THREE.Vector3(p.x, 2.25, p.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI + yaw + Math.PI / 2), new THREE.Vector3(1, 1, 1)); return m; });
      for (const part of parts) {
        this.track(part.geometry);
        const im = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
        mats.forEach((m, i) => im.setMatrixAt(i, m));
        im.instanceMatrix.needsUpdate = true;
        im.castShadow = q.shadows && part.key !== 'canopy';
        im.computeBoundingSphere();
        if (part.key === 'canopy') im.renderOrder = 5;
        base.add(im);
      }
      for (const p of all) this.buildingBoxes.push({ minX: p.x - 6, maxX: p.x + 6, minZ: p.z - 8, maxZ: p.z + 8, minY: 0, maxY: 4.5 });
      this.parkedCount = mats.length;
    } catch (e) {
      console.warn('Park halindeki uçaklar oluşturulamadı', e);
    }

    // Araçlar (basit kutular)
    const carGeo = this.track(new THREE.BoxGeometry(4.4, 1.5, 1.9));
    carGeo.translate(0, 0.75, 0);
    const carMat = this.track(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.3 }));
    const carPos = [];
    const rndc = mulberry32(88);
    for (let i = 0; i < 24; i++) carPos.push({ x: 900 + (i % 12) * 6, z: 470 + Math.floor(i / 12) * 8, r: 0 });
    for (let i = 0; i < 10; i++) carPos.push({ x: -1140 + i * 7, z: 700, r: 0 });
    for (let i = 0; i < 40; i++) carPos.push({ x: TOWN.x + (rndc() - 0.5) * 1800, z: TOWN.z + (rndc() - 0.5) * 1600, r: rndc() * Math.PI });
    const cars = new THREE.InstancedMesh(carGeo, carMat, carPos.length);
    const cc = new THREE.Color();
    carPos.forEach((c, i) => {
      const yy = terrainHeight(c.x, c.z);
      m4.compose(new THREE.Vector3(c.x, yy + 0.1, c.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), c.r), new THREE.Vector3(1, 1, 1));
      cars.setMatrixAt(i, m4);
      cc.setHSL(rndc(), 0.4, 0.35 + rndc() * 0.4); cars.setColorAt(i, cc);
    });
    cars.instanceMatrix.needsUpdate = true; if (cars.instanceColor) cars.instanceColor.needsUpdate = true;
    base.add(cars);
    this.group.add(base);
  }

  heightAt(x, z) { return terrainHeight(x, z); }

  hitsBuilding(x, y, z, r = 3) {
    for (const b of this.buildingBoxes) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y - r < b.maxY && y + r > b.minY) return true;
    }
    if (this.townCenter && Math.hypot(x - this.townCenter.x, z - this.townCenter.z) < TOWN.r + 200 && y < 60) {
      for (const b of this.townBoxes) {
        if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y - r < b.maxY && y + r > b.minY) return true;
      }
    }
    return false;
  }

  update(dt, camera, aircraftPos) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.sun.target.position.copy(aircraftPos);
    this.sun.position.copy(aircraftPos).addScaledVector(this.sunDir, 600);
    this.sun.target.updateMatrixWorld();
    const cx = camera.position.x, cz = camera.position.z;
    // Ağaç parçaları
    const td = this.quality.treeDistance;
    for (const c of this.treeChunks) {
      const d = Math.hypot(c.center.x - cx, c.center.z - cz);
      c.mesh.visible = d - c.radius < td;
    }
    // Arazi LOD
    const [l1] = this.quality.lod;
    const half = MAP_SIZE / 24 * 1.42;
    for (const ch of this.terrainChunks) {
      const d = Math.max(0, Math.hypot(ch.center.x - cx, ch.center.z - cz) - half);
      const lod = d < l1 ? 0 : 1;
      if (lod !== ch.lod) { ch.meshes[ch.lod].visible = false; ch.meshes[lod].visible = true; ch.lod = lod; }
    }
    this.waterUniforms.time.value = this.time;
    if (this.runwayLights) this.runwayLights.visible = Math.hypot(cx, cz) < 4500;
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.scene.remove(this.group);
  }
}

function distToPolylineAny(x, z) {
  let d = Infinity;
  for (const r of ROADS) { const dd = distToPolyline(x, z, r.pts); if (dd < d) d = dd; }
  for (const r of TOWN_STREETS) { const dd = distToPolyline(x, z, r.pts); if (dd < d) d = dd; }
  return d;
}
