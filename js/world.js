// Dünya: arazi, gökyüzü, güneş, su, ormanlar ve hava üssü.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Simplex2D, mulberry32, smoothstep, clamp, lerp } from './noise.js';
import {
  makeGrassTexture, makeAsphaltTexture, makeConcreteTexture, makeWaterNormalTexture,
  makeHangarWallTexture, makeHangarDoorTexture, makeTextTexture,
} from './textures.js';

export const MAP_SIZE = 20000;
export const WATER_LEVEL = -4;
export const LAYER_TREES = 1; // Su yansımasına dahil edilmez (performans)

const simplex = new Simplex2D(2024);
const LAKES = [
  { x: -5200, z: -4300, r: 1150 },
  { x: 5700, z: 3900, r: 1450 },
  { x: 1600, z: -6600, r: 850 },
];

// Hava üssü düzlüğü (dikdörtgen + yumuşak geçiş)
function baseFlatMask(x, z) {
  const dx = Math.max(0, Math.abs(x) - 4300);
  const dz = Math.max(0, Math.abs(z) - 950);
  const d = Math.hypot(dx, dz);
  return smoothstep(0, 2200, d);
}

function softplus(v, k) { return k * Math.log1p(Math.exp(v / k)); }

export function terrainHeight(x, z) {
  const n = simplex.fbm(x * 0.00018 + 3.1, z * 0.00018 - 2.7, 5, 2.0, 0.5);
  let h = 110 + n * 240;
  h += simplex.fbm(x * 0.0009 + 7, z * 0.0009 + 3, 3, 2.0, 0.5) * 30;
  h = softplus(h, 25);
  h *= baseFlatMask(x, z);
  for (const L of LAKES) {
    const wob = 1 + 0.22 * simplex.noise(x * 0.0012 + L.x, z * 0.0012 + L.z);
    const d = (Math.hypot(x - L.x, z - L.z) / L.r) * wob;
    const outer = smoothstep(1.9, 1.05, d);
    h = lerp(h, 7, outer);
    const inner = smoothstep(1.06, 0.72, d);
    h = lerp(h, -16, inner);
  }
  return h;
}

export function isWaterAt(x, z) {
  return terrainHeight(x, z) < WATER_LEVEL;
}

function forestMask(x, z) {
  const f = simplex.fbm(x * 0.00055 + 50, z * 0.00055 + 50, 3, 2.0, 0.5);
  return smoothstep(0.08, 0.35, f);
}

// ---- Hava üssü yerleşimi ----
export const AIRBASE = {
  runwayLength: 3000, runwayWidth: 45, runwayZ: 0,
  taxiwayZ: 200, taxiwayWidth: 23,
  apron: { x0: -450, x1: 450, z0: 211.5, z1: 440 },
  links: [-1450, 0, 1450],
  hangars: [-420, -140, 140, 420].map((x) => ({ x, z: 500, w: 60, d: 50, h: 10, arch: 6 })),
  tower: { x: 640, z: 300, r: 4.5, h: 24 },
  opsBuilding: { x: 640, z: 380, w: 44, d: 16, h: 8 },
};

export function surfaceTypeAt(x, z) {
  const A = AIRBASE;
  if (Math.abs(x) <= A.runwayLength / 2 && Math.abs(z - A.runwayZ) <= A.runwayWidth / 2) return 'runway';
  if (Math.abs(x) <= A.runwayLength / 2 && Math.abs(z - A.taxiwayZ) <= A.taxiwayWidth / 2) return 'taxiway';
  for (const lx of A.links) {
    if (Math.abs(x - lx) <= A.taxiwayWidth / 2 && z >= 0 && z <= (lx === 0 ? A.apron.z0 + 1 : A.taxiwayZ)) return 'taxiway';
  }
  if (x >= A.apron.x0 && x <= A.apron.x1 && z >= A.apron.z0 && z <= A.apron.z1) return 'apron';
  if (terrainHeight(x, z) < WATER_LEVEL) return 'water';
  return 'grass';
}

// Bina çarpışma kutuları
export function buildingBoxes() {
  const boxes = [];
  const A = AIRBASE;
  for (const h of A.hangars) {
    boxes.push({ minX: h.x - h.w / 2, maxX: h.x + h.w / 2, minZ: h.z - h.d / 2, maxZ: h.z + h.d / 2, minY: 0, maxY: h.h + h.arch });
  }
  const t = A.tower;
  boxes.push({ minX: t.x - 8, maxX: t.x + 8, minZ: t.z - 8, maxZ: t.z + 8, minY: 0, maxY: t.h + 6 });
  const o = A.opsBuilding;
  boxes.push({ minX: o.x - o.w / 2, maxX: o.x + o.w / 2, minZ: o.z - o.d / 2, maxZ: o.z + o.d / 2, minY: 0, maxY: o.h });
  return boxes;
}

export const QUALITY_PRESETS = {
  low: { pixelRatio: 1, shadows: false, shadowMap: 0, drawDistance: 9000, trees: 3500, treeDistance: 4500, water: 'simple', reflectionSize: 0, terrainSegments: 20, anisotropy: 2 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMap: 1024, drawDistance: 15000, trees: 9000, treeDistance: 7500, water: 'reflective', reflectionSize: 384, terrainSegments: 32, anisotropy: 4 },
  high: { pixelRatio: 2, shadows: true, shadowMap: 2048, drawDistance: 26000, trees: 16000, treeDistance: 12000, water: 'reflective', reflectionSize: 768, terrainSegments: 40, anisotropy: 8 },
};

export class World {
  constructor(scene, renderer, qualityKey) {
    this.scene = scene;
    this.renderer = renderer;
    this.quality = QUALITY_PRESETS[qualityKey] || QUALITY_PRESETS.medium;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.disposables = [];
    this.time = 0;
    this.buildingBoxes = buildingBoxes();

    this.sunDir = new THREE.Vector3(0.45, 0.62, -0.35).normalize();
    this.buildSky();
    this.buildLights();
    this.buildTerrain();
    this.buildWater();
    this.buildTrees();
    this.buildAirbase();
  }

  track(obj) { this.disposables.push(obj); return obj; }

  buildSky() {
    // Gradyan + güneş diski içeren hafif, kontrol edilebilir gökyüzü kabuğu.
    const geo = new THREE.SphereGeometry(1, 32, 16);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        sunDir: { value: this.sunDir.clone() },
        zenith: { value: new THREE.Color(0x2f6fc4) },
        horizon: { value: new THREE.Color(0xb9d0e6) },
        ground: { value: new THREE.Color(0x9fb3c4) },
        sunColor: { value: new THREE.Color(0xfff4dc) },
      },
      vertexShader: `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w * 0.999999; // her zaman en arkada
        }`,
      fragmentShader: `
        uniform vec3 sunDir; uniform vec3 zenith; uniform vec3 horizon; uniform vec3 ground; uniform vec3 sunColor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float t = clamp(d.y, -1.0, 1.0);
          vec3 col;
          if (t >= 0.0) {
            col = mix(horizon, zenith, pow(t, 0.5));
          } else {
            col = mix(horizon, ground, clamp(-t * 6.0, 0.0, 1.0));
          }
          float c = max(dot(d, sunDir), 0.0);
          col += sunColor * (pow(c, 8.0) * 0.10 + pow(c, 128.0) * 0.35);
          col += sunColor * smoothstep(0.99935, 0.99965, c) * 6.0;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    const sky = new THREE.Mesh(geo, mat);
    sky.scale.setScalar(30000);
    sky.renderOrder = -1000;
    sky.frustumCulled = false;
    this.sky = sky;
    this.group.add(sky);
    const fogColor = new THREE.Color(0xb9d0e6);
    this.scene.fog = new THREE.Fog(fogColor, this.quality.drawDistance * 0.35, this.quality.drawDistance * 0.98);
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
    const hemi = new THREE.HemisphereLight(0x9ec3ee, 0x55603c, 0.9);
    this.group.add(hemi);
  }

  buildTerrain() {
    const q = this.quality;
    const chunksPerSide = 10;
    const chunkSize = MAP_SIZE / chunksPerSide;
    const seg = q.terrainSegments;
    const grass = makeGrassTexture(512);
    grass.anisotropy = q.anisotropy;
    grass.repeat.set(1, 1);
    this.track(grass);
    const mat = new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95, metalness: 0 });
    this.track(mat);
    this.terrainMaterial = mat;
    const colGrassA = new THREE.Color(0.55, 0.72, 0.36);
    const colGrassB = new THREE.Color(0.72, 0.78, 0.42);
    const colForest = new THREE.Color(0.32, 0.5, 0.26);
    const colRock = new THREE.Color(0.55, 0.52, 0.48);
    const colSand = new THREE.Color(0.7, 0.66, 0.5);
    const colHigh = new THREE.Color(0.62, 0.6, 0.55);
    const tmp = new THREE.Color();
    const terrainGroup = new THREE.Group();
    terrainGroup.name = 'terrain';
    for (let cz = 0; cz < chunksPerSide; cz++) {
      for (let cx = 0; cx < chunksPerSide; cx++) {
        const x0 = -MAP_SIZE / 2 + cx * chunkSize;
        const z0 = -MAP_SIZE / 2 + cz * chunkSize;
        const n = (seg + 1) * (seg + 1);
        const pos = new Float32Array(n * 3);
        const col = new Float32Array(n * 3);
        const uv = new Float32Array(n * 2);
        let i = 0;
        for (let j = 0; j <= seg; j++) {
          for (let k = 0; k <= seg; k++) {
            const x = x0 + (k / seg) * chunkSize;
            const z = z0 + (j / seg) * chunkSize;
            const h = terrainHeight(x, z);
            pos[i * 3] = x; pos[i * 3 + 1] = h; pos[i * 3 + 2] = z;
            uv[i * 2] = x / 57; uv[i * 2 + 1] = z / 57;
            // Eğim tahmini
            const e = 12;
            const hx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
            const hz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
            const slope = Math.hypot(hx, hz) / (2 * e);
            const f = forestMask(x, z);
            const varn = simplex.noise(x * 0.0021, z * 0.0021) * 0.5 + 0.5;
            tmp.copy(colGrassA).lerp(colGrassB, varn);
            tmp.lerp(colForest, f * 0.8);
            if (h < WATER_LEVEL + 4) tmp.lerp(colSand, smoothstep(WATER_LEVEL + 4, WATER_LEVEL - 4, h));
            tmp.lerp(colRock, smoothstep(0.35, 0.8, slope));
            tmp.lerp(colHigh, smoothstep(260, 380, h));
            col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
            i++;
          }
        }
        const idx = [];
        for (let j = 0; j < seg; j++) {
          for (let k = 0; k < seg; k++) {
            const a = j * (seg + 1) + k, b = a + 1, c = a + seg + 1, d = c + 1;
            idx.push(a, c, b, b, c, d);
          }
        }
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        g.setIndex(idx);
        g.computeVertexNormals();
        g.computeBoundingSphere();
        this.track(g);
        const m = new THREE.Mesh(g, mat);
        m.receiveShadow = q.shadows;
        m.matrixAutoUpdate = false;
        terrainGroup.add(m);
      }
    }
    this.group.add(terrainGroup);
  }

  buildWater() {
    const q = this.quality;
    const geo = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE, 1, 1);
    this.track(geo);
    const normals = makeWaterNormalTexture(512);
    this.track(normals);
    const simpleMat = new THREE.MeshStandardMaterial({
      color: 0x1d4f6e, roughness: 0.25, metalness: 0.1,
      normalMap: normals, normalScale: new THREE.Vector2(0.6, 0.6),
    });
    this.track(simpleMat);
    const simple = new THREE.Mesh(geo, simpleMat);
    simple.rotation.x = -Math.PI / 2;
    simple.position.y = WATER_LEVEL;
    simple.renderOrder = 1;
    // UV tekrarı: 20 km üzerinde 60 m'lik doku döşemesi
    const uvAttr = geo.attributes.uv;
    for (let i = 0; i < uvAttr.count; i++) uvAttr.setXY(i, uvAttr.getX(i) * 330, uvAttr.getY(i) * 330);
    uvAttr.needsUpdate = true;
    this.waterSimple = simple;
    this.group.add(simple);

    if (q.water === 'reflective') {
      const water = new Water(geo, {
        textureWidth: q.reflectionSize, textureHeight: q.reflectionSize,
        waterNormals: normals,
        sunDirection: this.sunDir.clone(),
        sunColor: 0xffffff,
        waterColor: 0x0a2e46,
        distortionScale: 2.5,
        fog: true,
      });
      water.rotation.x = -Math.PI / 2;
      water.position.y = WATER_LEVEL;
      water.material.uniforms.size.value = 0.05;
      water.renderOrder = 1;
      this.waterReflective = water;
      this.group.add(water);
      water.visible = false;
    }
  }

  buildTrees() {
    const q = this.quality;
    const rand = mulberry32(9001);
    const chunks = 4;
    const chunkSize = MAP_SIZE / chunks;
    const perChunk = [];
    for (let i = 0; i < chunks * chunks; i++) perChunk.push({ conifer: [], leafy: [] });
    let placed = 0, tries = 0;
    while (placed < q.trees && tries < q.trees * 25) {
      tries++;
      const x = (rand() - 0.5) * MAP_SIZE * 0.98;
      const z = (rand() - 0.5) * MAP_SIZE * 0.98;
      const f = forestMask(x, z);
      if (rand() > f * f) continue;
      const h = terrainHeight(x, z);
      if (h < WATER_LEVEL + 3) continue;
      if (baseFlatMask(x, z) < 0.97) continue;
      const e = 10;
      const slope = Math.hypot(terrainHeight(x + e, z) - terrainHeight(x - e, z), terrainHeight(x, z + e) - terrainHeight(x, z - e)) / (2 * e);
      if (slope > 0.75) continue;
      const cx = clamp(Math.floor((x + MAP_SIZE / 2) / chunkSize), 0, chunks - 1);
      const cz = clamp(Math.floor((z + MAP_SIZE / 2) / chunkSize), 0, chunks - 1);
      const bucket = perChunk[cz * chunks + cx];
      const conifer = h > 120 || rand() < 0.55;
      (conifer ? bucket.conifer : bucket.leafy).push({ x, y: h, z, s: 0.75 + rand() * 0.6, r: rand() * Math.PI * 2, c: rand() });
      placed++;
    }

    // Kozalaklı ağaç geometrisi (gövde + iki koni)
    const trunk = new THREE.CylinderGeometry(0.3, 0.5, 4, 5);
    trunk.translate(0, 2, 0);
    const cone1 = new THREE.ConeGeometry(2.6, 8, 7);
    cone1.translate(0, 7, 0);
    const cone2 = new THREE.ConeGeometry(1.8, 6, 7);
    cone2.translate(0, 11, 0);
    const colorize = (g, color) => {
      const n = g.attributes.position.count;
      const arr = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { arr[i * 3] = color.r; arr[i * 3 + 1] = color.g; arr[i * 3 + 2] = color.b; }
      g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      return g;
    };
    const brown = new THREE.Color(0.32, 0.22, 0.12);
    const darkGreen = new THREE.Color(0.14, 0.32, 0.14);
    const leafGreen = new THREE.Color(0.28, 0.48, 0.18);
    colorize(trunk, brown); colorize(cone1, darkGreen); colorize(cone2, darkGreen);
    const coniferGeo = mergeGeometries([trunk, cone1, cone2].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    const trunk2 = new THREE.CylinderGeometry(0.35, 0.55, 5, 5);
    trunk2.translate(0, 2.5, 0);
    const crown = new THREE.IcosahedronGeometry(3.6, 1);
    crown.translate(0, 7.5, 0);
    colorize(trunk2, brown); colorize(crown, leafGreen);
    const leafyGeo = mergeGeometries([trunk2, crown].map((g) => (g.index ? g.toNonIndexed() : g)), false);
    this.track(coniferGeo); this.track(leafyGeo);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0 });
    this.track(mat);

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
        im.receiveShadow = false;
        im.layers.set(LAYER_TREES);
        im.frustumCulled = true;
        im.computeBoundingSphere();
        im.matrixAutoUpdate = false;
        this.group.add(im);
        this.treeChunks.push({ mesh: im, center });
      }
    }
    this.treeCount = placed;
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

    // Pist ve taksi yolları
    const asphaltGeos = [flat(A.runwayLength, A.runwayWidth, 0, A.runwayZ, 0.05, 18)];
    asphaltGeos.push(flat(A.runwayLength, A.taxiwayWidth, 0, A.taxiwayZ, 0.05, 18));
    for (const lx of A.links) {
      const zEnd = lx === 0 ? A.apron.z0 + 2 : A.taxiwayZ;
      asphaltGeos.push(flat(A.taxiwayWidth, zEnd, lx, zEnd / 2, 0.05, 18));
    }
    const asphaltMesh = new THREE.Mesh(this.track(mergeGeometries(asphaltGeos, false)), asphaltMat);
    asphaltMesh.receiveShadow = q.shadows;
    base.add(asphaltMesh);

    // Apron
    const ap = A.apron;
    const apronMesh = new THREE.Mesh(this.track(flat(ap.x1 - ap.x0, ap.z1 - ap.z0, (ap.x0 + ap.x1) / 2, (ap.z0 + ap.z1) / 2, 0.06, 30)), concreteMat);
    apronMesh.receiveShadow = q.shadows;
    base.add(apronMesh);

    // Pist işaretleri (beyaz)
    const white = [];
    const L = A.runwayLength / 2, W = A.runwayWidth;
    const y = 0.09;
    // Kenar çizgileri
    white.push(flat(A.runwayLength, 0.9, 0, W / 2 - 0.6, y));
    white.push(flat(A.runwayLength, 0.9, 0, -W / 2 + 0.6, y));
    // Eşik çizgileri (her uçta 12 şerit)
    for (const side of [-1, 1]) {
      const xs = side * (L - 6 - 15);
      for (let i = 0; i < 12; i++) {
        const z = -W / 2 + 3.6 + i * ((W - 7.2) / 11);
        white.push(flat(30, 1.8, xs, z, y));
      }
      // Hedef noktası işaretleri (300 m)
      const xa = side * (L - 300 - 25);
      white.push(flat(50, 8, xa, 10, y));
      white.push(flat(50, 8, xa, -10, y));
      // Temas bölgesi işaretleri
      for (const [dist, count] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]]) {
        const xt = side * (L - dist - 11);
        for (let k = 0; k < count; k++) {
          const off = 9 + k * 3;
          white.push(flat(22, 1.8, xt, off, y));
          white.push(flat(22, 1.8, xt, -off, y));
        }
      }
    }
    // Merkez hattı (30 m çizgi, 20 m boşluk)
    for (let x = -L + 120; x < L - 120; x += 50) white.push(flat(30, 0.9, x + 15, 0, y));
    const whiteMesh = new THREE.Mesh(this.track(mergeGeometries(white, false)), whiteMat);
    base.add(whiteMesh);

    // Pist numaraları
    const numMat09 = this.track(new THREE.MeshBasicMaterial({ map: this.track(makeTextTexture('09', { w: 256, h: 256, font: 'bold 190px Arial', color: '#e8e8e2' })), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const numMat27 = this.track(new THREE.MeshBasicMaterial({ map: this.track(makeTextTexture('27', { w: 256, h: 256, font: 'bold 190px Arial', color: '#e8e8e2' })), transparent: true, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    const numGeo = this.track(new THREE.PlaneGeometry(18, 18));
    const n09 = new THREE.Mesh(numGeo, numMat09);
    n09.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    n09.position.set(-L + 75, 0.1, 0);
    base.add(n09);
    const n27 = new THREE.Mesh(numGeo, numMat27);
    n27.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    n27.position.set(L - 75, 0.1, 0);
    base.add(n27);

    // Taksi yolu sarı merkez hatları
    const yellow = [flat(A.runwayLength - 40, 0.35, 0, A.taxiwayZ, y)];
    for (const lx of A.links) {
      const zEnd = lx === 0 ? A.apron.z0 + 2 : A.taxiwayZ;
      yellow.push(flat(0.35, zEnd - 10, lx, zEnd / 2 + 5, y));
    }
    // Apron park yerleri
    for (let i = 0; i < 8; i++) {
      const x = ap.x0 + 60 + i * 48;
      yellow.push(flat(0.35, 30, x, ap.z0 + 60, y + 0.01));
      yellow.push(flat(24, 0.35, x, ap.z0 + 45, y + 0.01));
    }
    base.add(new THREE.Mesh(this.track(mergeGeometries(yellow, false)), yellowMat));

    // Hangarlar
    const wallTex = this.track(makeHangarWallTexture(512));
    wallTex.repeat.set(4, 1);
    const wallMat = this.track(new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.7, metalness: 0.2 }));
    const roofMat = this.track(new THREE.MeshStandardMaterial({ color: 0x7c8288, roughness: 0.75, metalness: 0.25 }));
    const doorTex = this.track(makeHangarDoorTexture(512, 256));
    const doorMat = this.track(new THREE.MeshStandardMaterial({ map: doorTex, roughness: 0.7, metalness: 0.3 }));
    for (const h of A.hangars) {
      const shape = new THREE.Shape();
      shape.moveTo(-h.w / 2, 0);
      shape.lineTo(h.w / 2, 0);
      shape.lineTo(h.w / 2, h.h);
      shape.absellipse(0, h.h, h.w / 2, h.arch, 0, Math.PI, false);
      shape.lineTo(-h.w / 2, 0);
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h.d, bevelEnabled: false, curveSegments: 12 });
      geo.translate(0, 0, -h.d / 2);
      this.track(geo);
      const mesh = new THREE.Mesh(geo, [wallMat, roofMat]);
      mesh.position.set(h.x, 0, h.z);
      mesh.castShadow = q.shadows; mesh.receiveShadow = q.shadows;
      base.add(mesh);
      // Kapı (kuzey cephe, aprona bakan)
      const door = new THREE.Mesh(this.track(new THREE.PlaneGeometry(h.w * 0.8, h.h * 0.85)), doorMat);
      door.position.set(h.x, h.h * 0.425, h.z - h.d / 2 - 0.05);
      door.rotation.y = Math.PI;
      base.add(door);
      // Beton zemin önü
      base.add(new THREE.Mesh(this.track(flat(h.w + 10, 40, h.x, h.z - h.d / 2 - 20, 0.06, 30)), concreteMat));
    }

    // Kule
    const t = A.tower;
    const towerMat = this.track(new THREE.MeshStandardMaterial({ color: 0xbfc3c8, roughness: 0.6 }));
    const glassMat = this.track(new THREE.MeshStandardMaterial({ color: 0x223344, roughness: 0.15, metalness: 0.6 }));
    const shaft = new THREE.Mesh(this.track(new THREE.CylinderGeometry(t.r, t.r * 1.3, t.h, 12)), towerMat);
    shaft.position.set(t.x, t.h / 2, t.z);
    shaft.castShadow = q.shadows;
    base.add(shaft);
    const cabBase = new THREE.Mesh(this.track(new THREE.CylinderGeometry(t.r * 1.9, t.r * 1.2, 2.2, 12)), towerMat);
    cabBase.position.set(t.x, t.h + 1.1, t.z);
    base.add(cabBase);
    const cab = new THREE.Mesh(this.track(new THREE.CylinderGeometry(t.r * 1.9, t.r * 1.9, 3.6, 12)), glassMat);
    cab.position.set(t.x, t.h + 4, t.z);
    base.add(cab);
    const roof = new THREE.Mesh(this.track(new THREE.ConeGeometry(t.r * 2.1, 1.6, 12)), towerMat);
    roof.position.set(t.x, t.h + 6.6, t.z);
    base.add(roof);
    const antenna = new THREE.Mesh(this.track(new THREE.CylinderGeometry(0.1, 0.1, 6, 6)), towerMat);
    antenna.position.set(t.x, t.h + 10, t.z);
    base.add(antenna);
    // Operasyon binası
    const o = A.opsBuilding;
    const ops = new THREE.Mesh(this.track(new THREE.BoxGeometry(o.w, o.h, o.d)), towerMat);
    ops.position.set(o.x, o.h / 2, o.z);
    ops.castShadow = q.shadows; ops.receiveShadow = q.shadows;
    base.add(ops);
    base.add(new THREE.Mesh(this.track(flat(120, 140, t.x, 340, 0.06, 30)), concreteMat));

    // Pist ışıkları (instanced, kendinden ışıklı)
    const lights = [];
    const push = (x, z, color) => lights.push({ x, z, color });
    const cWhite = new THREE.Color(0xffffff), cGreen = new THREE.Color(0x30ff60), cRed = new THREE.Color(0xff3030), cBlue = new THREE.Color(0x3060ff), cAmber = new THREE.Color(0xffb020);
    for (let x = -L; x <= L; x += 60) { push(x, W / 2 + 1.5, cWhite); push(x, -W / 2 - 1.5, cWhite); }
    for (const side of [-1, 1]) {
      for (let z = -W / 2; z <= W / 2; z += 3) { push(side * (L + 1), z, cGreen); push(side * (L + 4), z, cRed); }
      for (let d = 30; d <= 900; d += 30) {
        push(side * (L + d), 0, cWhite);
        if (d % 150 === 0) for (const zz of [-4, -2, 2, 4]) push(side * (L + d), zz, cWhite);
      }
      // PAPI
      for (let k = 0; k < 4; k++) push(side * (L - 300), -(W / 2 + 12 + k * 3), k < 2 ? cWhite : cRed);
    }
    for (let x = -L + 20; x <= L - 20; x += 60) { push(x, A.taxiwayZ + A.taxiwayWidth / 2 + 1, cBlue); push(x, A.taxiwayZ - A.taxiwayWidth / 2 - 1, cBlue); }
    for (const lx of A.links) for (let z = 30; z < A.taxiwayZ - 10; z += 30) { push(lx + A.taxiwayWidth / 2 + 1, z, cBlue); push(lx - A.taxiwayWidth / 2 - 1, z, cBlue); }
    for (let x = ap.x0; x <= ap.x1; x += 90) push(x, ap.z1 + 3, cAmber);
    const lightGeo = this.track(new THREE.SphereGeometry(0.35, 6, 4));
    const lightMat = this.track(new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
    const lightMesh = new THREE.InstancedMesh(lightGeo, lightMat, lights.length);
    const m4 = new THREE.Matrix4();
    lights.forEach((l, i) => {
      m4.makeTranslation(l.x, 0.35, l.z);
      lightMesh.setMatrixAt(i, m4);
      lightMesh.setColorAt(i, l.color);
    });
    lightMesh.instanceMatrix.needsUpdate = true;
    if (lightMesh.instanceColor) lightMesh.instanceColor.needsUpdate = true;
    lightMesh.frustumCulled = false;
    base.add(lightMesh);

    // Apron direkleri (aydınlatma kuleleri)
    const poleMat = this.track(new THREE.MeshStandardMaterial({ color: 0x777c80, roughness: 0.6, metalness: 0.5 }));
    const poleGeo = this.track(new THREE.CylinderGeometry(0.3, 0.4, 22, 6));
    for (const x of [ap.x0 + 20, ap.x1 - 20]) {
      const p = new THREE.Mesh(poleGeo, poleMat);
      p.position.set(x, 11, ap.z1 - 10);
      base.add(p);
    }
    this.group.add(base);
  }

  // Yükseklik sorgusu (fizik için)
  heightAt(x, z) { return terrainHeight(x, z); }

  // Nesne bir binaya çarpıyor mu?
  hitsBuilding(x, y, z, r = 3) {
    for (const b of this.buildingBoxes) {
      if (x + r > b.minX && x - r < b.maxX && z + r > b.minZ && z - r < b.maxZ && y - r < b.maxY && y + r > b.minY) return true;
    }
    return false;
  }

  nearestLakeDistance(x, z) {
    let best = Infinity;
    for (const L of LAKES) best = Math.min(best, Math.max(0, Math.hypot(x - L.x, z - L.z) - L.r));
    return best;
  }

  update(dt, camera, aircraftPos) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    // Güneş ve gölge kamerası uçağı takip eder
    this.sun.target.position.copy(aircraftPos);
    this.sun.position.copy(aircraftPos).addScaledVector(this.sunDir, 600);
    this.sun.target.updateMatrixWorld();
    // Ağaç parçalarını çizim mesafesine göre gizle
    const td = this.quality.treeDistance;
    for (const c of this.treeChunks) {
      const d = Math.hypot(c.center.x - camera.position.x, c.center.z - camera.position.z);
      c.mesh.visible = d - MAP_SIZE / 8 * 1.42 < td;
    }
    // Su
    if (this.waterReflective) {
      const near = this.nearestLakeDistance(camera.position.x, camera.position.z) < 4000 && camera.position.y > WATER_LEVEL;
      this.waterReflective.visible = near;
      this.waterSimple.visible = !near;
      this.waterReflective.material.uniforms.time.value = this.time * 0.6;
    }
    const nm = this.waterSimple.material.normalMap;
    nm.offset.set(this.time * 0.004, this.time * 0.003);
  }

  dispose() {
    for (const d of this.disposables) if (d && d.dispose) d.dispose();
    this.scene.remove(this.group);
  }
}
