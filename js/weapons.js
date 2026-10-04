// Silah sistemi: AIM-120C fırlatma dizisi, füze uçuşu, çarpışma ve efektlerin bağlantısı.
//
// Envanter: 4 füze — iki dış kanat istasyonu (2 ve 10) önce, sonra iki iç silah yuvası.
// Uçakta GÖRÜNEN füze ile fırlatılan füze aynıdır: fırlatma anında o füzenin dünya dönüşümü
// (aircraft.storeWorld / storedMissileWorld) alınır, raydaki ağ gizlenir ve havuzdaki uçan
// füze tam o konum ve yönelimle başlar — ışınlanma ya da geride kalan kopya yoktur.
//
// İç yuva dizisi: FIRE -> kapaklar açılır (iç/dış kapak hafif kademeli, sonda yerleşme
// salınımı) -> ejektör rayı füzeyi aşağı iter -> bırakma (uçak hiyerarşisinden ayrılır) ->
// füze uçaktan güvenli uzaklığa düşer -> motor ateşlenir -> ileri hızlanır, duman izi ->
// füze yuvadan yeterince uzaklaşınca kapaklar kapanır (füze kapak süpürme alanındayken asla).
// Dış istasyon: raydan ayrılır, kısa düşüşten sonra ateşlenir.
//
// Uçuş: fırlatma anındaki burun doğrultusu korunur (otopilot hattı tutar); motor itkisi,
// hava yoğunluğuna bağlı sürükleme, yanal hızın eksene yaklaşması, yanma bitince hafif
// balistik çöküş; gövde hız vektörüne hizalı. Ömür sonunda kendini imha eder (havada patlama).
// Çarpışma süpürülmüştür: kare boyunca kat edilen parça araziye/suya örneklenip ikiye
// bölmeyle inceltilir, yapılara yarık testiyle bakılır (world.segmentHit).
import * as THREE from 'three';
import { getMissileGeometry, getMissileMaterial, FX_LIGHT, BAY, MISSILE, F35 } from './aircraft.js';
import { terrainHeight, WATER_LEVEL } from './world.js';
import { FX, SmokeTrail, PM } from './fx.js';

const G = 9.81;
const COOLDOWN = 1.2;                 // s, ardışık bırakmalar arası
const BOOST_A = 230, BOOST_T = 2.6;   // m/s², s
const SUSTAIN_A = 32, SUSTAIN_T = 3.5;
const LIFE = 16;                      // s, sonra kendini imha
const POOL = 6;
const ease = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);
// Kapak açılışı: yumuşak hızlanma/yavaşlama + sonda küçük mekanik yerleşme salınımı
const doorOpen = (t, T) => (t < T ? ease(t / T) : 1 + 0.022 * Math.exp(-(t - T) / 0.06) * Math.sin((t - T) * 2 * Math.PI / 0.15));
const T_OPEN = 0.42, LAG = 0.05, T_HOLD = 0.08, T_STROKE = 0.12, T_RAIL = 0.45, T_CLOSE = 0.5;

// Lüle alevi (toplamalı koni) ve parlaması: paylaşılan iki gölgelendirici
function plumeMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        vT = clamp(position.z, 0.0, 1.0);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uTime; varying float vT; varying vec3 vN; varying vec3 vV;
      void main() {
        float rim = abs(dot(vN, vV));
        float fl = 0.85 + 0.15 * sin(uTime * 61.0 + vT * 9.0) * sin(uTime * 37.0);
        float core = pow(1.0 - vT, 1.4) * (0.35 + 0.65 * rim * rim);
        vec3 col = mix(vec3(1.0, 0.93, 0.75), vec3(1.0, 0.42, 0.08), smoothstep(0.0, 0.7, vT)) * core * 3.2 * fl;
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}
function glowMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vUv;
      void main() {
        float s = length(modelMatrix[0].xyz);
        vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        mv.xy += position.xy * s;
        vUv = position.xy * 2.0;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec2 vUv;
      void main() {
        float r2 = dot(vUv, vUv);
        float a = (exp(-r2 * 5.0) + 0.25 * exp(-r2 * 1.4)) * (1.0 - smoothstep(0.45, 1.0, r2));
        gl_FragColor = vec4(vec3(1.0, 0.62, 0.28) * a * 1.6, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

class Missile {
  constructor(scene, plumeMat, glowMat, plumeGeo, glowGeo) {
    this.mesh = new THREE.Mesh(getMissileGeometry(), getMissileMaterial());
    this.mesh.castShadow = true;
    this.mesh.matrixAutoUpdate = true;
    this.plume = new THREE.Mesh(plumeGeo, plumeMat);
    this.plume.position.z = MISSILE.len / 2 - 0.02;
    this.plume.renderOrder = 4;
    this.glow = new THREE.Mesh(glowGeo, glowMat);
    this.glow.position.z = MISSILE.len / 2 + 0.15;
    this.glow.renderOrder = 4;
    this.glow.frustumCulled = false;
    this.mesh.add(this.plume, this.glow);
    this.mesh.visible = false;
    scene.add(this.mesh);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.prev = new THREE.Vector3();
    this.quat = new THREE.Quaternion(); this.qLaunch = new THREE.Quaternion();
    this.dir = new THREE.Vector3(); this.local = new THREE.Vector3(); this.t0 = -1e9;
    this.alive = false; this.state = 'off';
  }
}

export class WeaponSystem {
  /**
   * scene, world, audio (AudioEngine), cameraRig (sarsıntı), hooks: { onState(info), message(text) }
   */
  constructor(scene, world, audio, cameraRig, hooks = {}) {
    this.scene = scene; this.world = world; this.audio = audio; this.rig = cameraRig; this.hooks = hooks;
    this.fx = new FX(scene, (x, z) => Math.max(terrainHeight(x, z), WATER_LEVEL));
    const pg = new THREE.CylinderGeometry(0.28, 1, 1, 12, 3, true);
    pg.rotateX(Math.PI / 2); pg.translate(0, 0, 0.5);
    this.plumeGeo = pg; this.glowGeo = new THREE.PlaneGeometry(1, 1);
    this.plumeMat = plumeMaterial(); this.glowMat = glowMaterial();
    this.missiles = [];
    for (let i = 0; i < POOL; i++) this.missiles.push(new Missile(scene, this.plumeMat, this.glowMat, this.plumeGeo, this.glowGeo));
    this.trails = [];
    for (let i = 0; i < 8; i++) { const tr = new SmokeTrail(this.fx.trailMat); scene.add(tr.mesh); this.trails.push(tr); }
    this.aircraft = null; this.physics = null;
    this.time = 0;
    this.pending = false;
    this.nextAllowed = 0;
    this.shakeQueue = [];
    // geçici vektörler (her kare tahsis yok)
    this._v = new THREE.Vector3(); this._v2 = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._qi = new THREE.Quaternion();
    this._p = new THREE.Vector3(); this._n = new THREE.Vector3(); this._m = new THREE.Matrix4(); this._up = new THREE.Vector3(0, 1, 0);
    this._fxPos = new THREE.Vector3(); this._fxCol = new THREE.Color();
    this.stats = { launched: 0, impacts: 0, lastImpact: null };
    this.resetInventory();
  }

  resetInventory() {
    // Sıra: dış sol, dış sağ, iç sağ yuva, iç sol yuva
    this.stations = [
      { kind: 'ext', i: 0, loaded: true }, { kind: 'ext', i: 1, loaded: true },
      { kind: 'bay', i: 1, loaded: true }, { kind: 'bay', i: 0, loaded: true },
    ];
    this.bays = [0, 1].map((i) => ({ i, state: 'closed', t: 0, inner: 0, outer: 0, rail: 0, missile: null }));
  }

  get count() { return this.stations.filter((s) => s.loaded).length; }

  /** Yeni (ya da yeniden boyanmış) uçak modeli: envanter durumu modele uygulanır. */
  attach(aircraft, physics) {
    this.aircraft = aircraft; this.physics = physics;
    this.applyModel(true);
  }

  applyModel(snap) {
    const ac = this.aircraft;
    if (!ac) return;
    for (const s of this.stations) {
      if (s.kind === 'ext' && ac.parts.stores && ac.parts.stores[s.i]) ac.parts.stores[s.i].mesh.visible = s.loaded;
    }
    for (const b of this.bays) {
      if (snap && b.state !== 'closed') { b.state = 'closed'; b.inner = b.outer = b.rail = 0; }
      const st = this.stations.find((x) => x.kind === 'bay' && x.i === b.i);
      if (ac.setWeaponBay) ac.setWeaponBay(b.i, b.inner, b.outer, b.rail, b.state === 'closed' || b.state === 'opening' || b.state === 'eject' ? st.loaded : false);
    }
  }

  /** Yeniden başlatma / hangar: uçan füzeler, efektler temizlenir; envanter dolar. */
  reset() {
    for (const m of this.missiles) this.kill(m, false);
    for (const tr of this.trails) tr.reset();
    this.fx.clear();
    this.resetInventory();
    this.pending = false; this.nextAllowed = 0; this.shakeQueue.length = 0;
    FX_LIGHT.uFxCol.value.setRGB(0, 0, 0);
    this.applyModel(true);
    this.emitState();
  }

  /**
   * Yükleme ekranı (opak) açıkken bir kez: füze, lüle alevi, parıltı, duman izi, iki parçacık
   * sistemi ve bir yer izi kameranın önünde birlikte çizilir, sonra hepsi sıfırlanır.
   * Ön derleme (compile) gölgelendiricileri hazırlar ama gizli nesneler hiç ÇİZİLMEDİĞİ için
   * GPU'nun ilk çizimde yaptığı iş (boru hattı durumu, tamponların ilk yüklenmesi) ilk atışta
   * ve ilk patlamada tek karelik bir takılma olarak görünüyordu.
   */
  warmup(renderer, scene, camera) {
    const fx = this.fx, t = fx.t;
    // Etkin bir füze/efekt varsa (ör. uçuş sırasında kalite değişimi) dokunulmaz: zaten çizildiler
    if (this.missiles.some((x) => x.alive) || this.trails.some((tr) => tr.mesh.visible) || fx.alpha.mesh.visible || fx.add.mesh.visible || fx.craters.items.some((it) => it.m.visible)) return;
    camera.updateMatrixWorld();
    const fwd = this._v.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const p = this._p.copy(camera.position).addScaledVector(fwd, 14);
    const m = this.missiles[0];
    m.mesh.position.copy(p); m.mesh.quaternion.copy(camera.quaternion);
    m.plume.scale.set(0.13, 0.13, 2); m.glow.scale.set(3, 3, 3);
    m.mesh.visible = m.plume.visible = m.glow.visible = true;
    const tr = this.trails[0];
    tr.reset();
    tr.push(this._v2.copy(p).addScaledVector(fwd, 5), fwd, t, 0.5);
    tr.push(p, fwd, t, 0.5);
    fx.trailMat.uniforms.uTime.value = t + 0.3;
    fx.alpha.spawn(t, { p, life: 2, s0: 2, c0: [0.9, 0.9, 0.9, 0.6], mode: PM.SMOKE });
    fx.add.spawn(t, { p, life: 2, s0: 2, c0: [2, 1.5, 1, 1], mode: PM.GLOW });
    fx.alpha.flush(t + 0.1); fx.add.flush(t + 0.1);
    const cr = fx.craters.items[0], pa = cr.m.geometry.attributes.position, b = cr.base;
    for (let i = 0; i < pa.count; i++) pa.setXYZ(i, p.x + b[i * 3] * 8, p.y - 3, p.z + b[i * 3 + 2] * 8);
    pa.needsUpdate = true; cr.m.geometry.computeBoundingSphere();
    cr.m.visible = true; cr.m.material.opacity = 1;
    try { renderer.render(scene, camera); } finally {
      m.mesh.visible = m.plume.visible = m.glow.visible = false;
      tr.reset();
      fx.clear();
    }
  }

  inhibited() {
    const p = this.physics;
    if (!p || p.crashed) return 'Weapons unavailable';
    if (p.onGround) return 'Weapons inhibited on the ground';
    return null;
  }

  /** FIRE düğmesi / Boşluk tuşu. Tek basış tek fırlatma; meşgulken bir fırlatma sıraya alınır. */
  fire() {
    const why = this.inhibited();
    if (why) { this.hooks.message && this.hooks.message(why); return 'inhibited'; }
    if (!this.count) { this.hooks.message && this.hooks.message('No missiles left — land and stop to rearm'); return 'empty'; }
    if (this.canLaunch()) { this.launchNext(); return 'fired'; }
    if (!this.pending) { this.pending = true; this.emitState(); return 'queued'; }
    return 'busy';
  }

  nextStation() {
    for (const s of this.stations) {
      if (!s.loaded) continue;
      if (s.kind === 'ext') return s;
      if (this.bays[s.i].state === 'closed') return s;
    }
    return null;
  }

  canLaunch() {
    if (this.time < this.nextAllowed) return false;
    // aynı anda tek fırlatma dizisi (bırakmaya kadar)
    if (this.bays.some((b) => b.state === 'opening' || b.state === 'eject')) return false;
    return !!this.nextStation();
  }

  launchNext() {
    const s = this.nextStation();
    if (!s) return;
    this.nextAllowed = this.time + COOLDOWN;
    if (s.kind === 'ext') { this.release(s); return; }
    const b = this.bays[s.i];
    b.state = 'opening'; b.t = 0; b.station = s;
    this.audio && this.audio.weaponBay(true);
    this.emitState();
  }

  /** Füzeyi raydan ayırır: görünen ağ gizlenir, havuzdaki füze aynı dünya dönüşümüyle başlar. */
  release(s) {
    const ac = this.aircraft, p = this.physics;
    let m = this.missiles.find((x) => !x.alive);
    if (!m) { m = this.missiles.reduce((a, b) => (a.t0 < b.t0 ? a : b)); this.detonate(m, 'air'); }
    if (s.kind === 'ext') ac.storeWorld(s.i, m.pos, m.quat); else ac.storedMissileWorld(s.i, m.pos, m.quat);
    s.loaded = false;
    if (s.kind === 'ext') ac.parts.stores[s.i].mesh.visible = false;
    // Ayrılma hızı: uçağın hızı + gövde aşağı yönünde ejektör hızı
    const acQ = ac.group.quaternion;
    m.vel.copy(p.vel).addScaledVector(this._v.set(0, -1, 0).applyQuaternion(acQ), s.kind === 'ext' ? 2.0 : 4.6);
    m.qLaunch.copy(m.quat);
    m.dir.set(0, 0, -1).applyQuaternion(m.qLaunch);          // fırlatma anındaki burun doğrultusu
    m.prev.copy(m.pos);
    m.alive = true; m.state = 'drop'; m.t = 0; m.t0 = this.time; m.kind = s.kind; m.bay = s.kind === 'bay' ? s.i : -1;
    m.local.copy(m.pos).sub(ac.group.position).applyQuaternion(this._qi.copy(acQ).invert());  // gövde çerçevesinde başlangıç
    m.trail = null; m.puffDist = 0; m.ignT = -1;
    m.mesh.position.copy(m.pos); m.mesh.quaternion.copy(m.quat);
    m.mesh.visible = true; m.plume.visible = false; m.glow.visible = false;
    this.fx.ejectPuff(m.pos, p.vel);
    this.audio && this.audio.missileEject();
    this.stats.launched++;
    this.emitState();
    return m;
  }

  kill(m, endTrail = true) {
    if (!m.alive && m.state === 'off') return;
    m.alive = false; m.state = 'off'; m.mesh.visible = false;
    if (m.trail && endTrail) m.trail.end(this.fx.t);
    m.trail = null;
  }

  detonate(m, kind, point = null, groundY = null) {
    const p = point || m.pos;
    const gy = groundY !== null ? groundY : Math.max(terrainHeight(p.x, p.z), WATER_LEVEL);
    this.fx.explode(p, kind, gy);
    const cam = this.rig.camera.position, d = cam.distanceTo(p);
    this.audio && this.audio.explosion(d);
    if (d < 700) this.shakeQueue.push({ at: this.time + Math.min(2, d / 343), amt: 0.65 * Math.pow(1 - d / 700, 2) });
    this.stats.impacts++; this.stats.lastImpact = { kind, x: p.x, y: p.y, z: p.z, t: this.time };
    this.kill(m);
  }

  // ---- Kare güncellemesi ----
  update(dt, pose, camera, wind) {
    this.time += dt;
    if (wind) this.fx.setWind(wind);
    if (this.pending && this.canLaunch()) { this.pending = false; this.launchNext(); }
    this.updateBays(dt, pose);
    // Bu karede bırakılan füze (yuva dizisi / sıradaki atış) bu karede İLERLETİLMEZ: konumu zaten
    // uçağın bu kareki pozundan alındı. İlerletilirse bir kare önde (60 fps'de ~4 m) sıçramış görünür.
    for (const m of this.missiles) if (m.alive && m.t0 !== this.time) this.updateMissile(m, dt, pose);
    for (const tr of this.trails) tr.update(this.fx.t);
    this.fx.update(dt);
    this.plumeMat.uniforms.uTime.value = this.time;
    for (let i = this.shakeQueue.length - 1; i >= 0; i--) if (this.time >= this.shakeQueue[i].at) { this.rig.shake(this.shakeQueue[i].amt); this.shakeQueue.splice(i, 1); }
    this.updateFxLight(pose, camera);
    this.rearmCheck(dt);
    if (this.time - (this._lastEmit || 0) > 0.1) this.emitState();
  }

  updateBays(dt, pose) {
    const ac = this.aircraft;
    for (const b of this.bays) {
      if (b.state === 'closed') continue;
      b.t += dt;
      const st = this.stations.find((x) => x.kind === 'bay' && x.i === b.i);
      if (b.state === 'opening') {
        b.inner = doorOpen(b.t, T_OPEN); b.outer = doorOpen(b.t - LAG, T_OPEN);
        if (b.t >= T_OPEN + LAG + T_HOLD) { b.state = 'eject'; b.t = 0; }
      } else if (b.state === 'eject') {
        b.inner = b.outer = 1;
        b.rail = Math.min(1, (b.t / T_STROKE) ** 2);
        ac.setWeaponBay(b.i, b.inner, b.outer, b.rail, true);
        if (b.t >= T_STROKE) { b.missile = this.release(st); b.state = 'released'; b.t = 0; }
      } else if (b.state === 'released') {
        b.rail = b.t < 0.06 ? 1 : 1 - ease((b.t - 0.06) / T_RAIL);
        // Kapaklar ancak füze kapak süpürme hacminin dışındaysa kapanır
        if (b.rail <= 0 && this.clearOfBay(b.missile, pose)) { b.state = 'closing'; b.t = 0; this.audio && this.audio.weaponBay(false); }
      } else if (b.state === 'closing') {
        b.inner = 1 - ease(b.t / T_CLOSE); b.outer = 1 - ease((b.t - 0.03) / T_CLOSE);
        if (b.t >= T_CLOSE + 0.03) { b.state = 'closed'; b.inner = b.outer = b.rail = 0; b.missile = null; }
      }
      const armed = b.state === 'opening' || b.state === 'eject' ? st.loaded : false;
      ac.setWeaponBay(b.i, Math.max(0, b.inner), Math.max(0, b.outer), b.rail, b.state === 'closed' ? st.loaded : armed);
    }
  }

  /** Füze, açık kapakların süpürdüğü hacimden kalıcı olarak çıktı mı? Ateşlemeden sonra füze
   *  fırlatma anındaki burun doğrultusunda (uçuş yolunun birkaç derece üstü) hızlanır, yani
   *  uçağa göre ÖNE ve hafifçe YUKARI gider: "yuvanın 1,7 m altında" anlık bir koşul yetmez,
   *  füze kapak hacmine geri yükselebilir. Kalıcı koşul: kuyruğu yuvanın ön ucunun önünde
   *  (itkiyle yalnızca uzaklaşır) ya da çok aşağıda / yanda / geride. */
  clearOfBay(m, pose) {
    if (!m || !m.alive || m.mesh.visible === false) return true;
    const rel = this._v.copy(m.pos).sub(pose.pos).applyQuaternion(this._qi.copy(pose.quat).invert());
    const bayFront = BAY.s0 - F35.cgStation;   // gövde çerçevesinde yuva ön ucu (burun -z)
    return rel.z + MISSILE.len / 2 < bayFront - 0.5 || rel.y < BAY.my - 3.5 || rel.z > 9 || Math.abs(rel.x) > 4;
  }

  updateMissile(m, dt, pose) {
    m.t += dt;
    m.prev.copy(m.pos);
    const v = m.vel;
    if (m.state === 'drop') {
      v.y -= G * dt;
      m.pos.addScaledVector(v, dt);
      // Ayrılma güvencesi: uçak ani burun aşağı/ yuvarlanma yapsa bile füze, gövde çerçevesinde
      // en az ejektör hızıyla uzaklaşır ve yuva sütununda kalır (kapak/gövdeye değmez).
      const qi = this._qi.copy(pose.quat).invert();
      const rel = this._v.copy(m.pos).sub(pose.pos).applyQuaternion(qi);
      const minDown = (m.kind === 'bay' ? 4.0 : 1.6) * m.t;
      let clamp = false;
      if (rel.y > m.local.y - minDown) { rel.y = m.local.y - minDown; clamp = true; }
      if (m.t < 0.6 && Math.abs(rel.x - m.local.x) > 0.2) { rel.x = m.local.x + Math.sign(rel.x - m.local.x) * 0.2; clamp = true; }
      if (clamp) m.pos.copy(rel.applyQuaternion(pose.quat).add(pose.pos));
      // hafif burun aşağı salınım (ayrılma)
      const dip = Math.min(1, m.t / 0.4) * 2.2 * Math.PI / 180;
      m.quat.copy(m.qLaunch).multiply(this._q.setFromAxisAngle(this._v2.set(1, 0, 0), -dip));
      const below = m.local.y - rel.y;
      const tIgn = m.kind === 'bay' ? 0.3 : 0.22, dIgn = m.kind === 'bay' ? 1.5 : 0.7;
      if ((m.t >= tIgn && below >= dIgn) || m.t > 0.75) this.ignite(m);
    } else {
      const tb = m.t - m.ignT;
      const rho = Math.exp(-Math.max(0, m.pos.y) / 8500);
      const sp = v.length();
      let thrust = tb < BOOST_T ? BOOST_A * Math.min(1, tb / 0.12) : tb < BOOST_T + SUSTAIN_T ? SUSTAIN_A : 0;
      const drag = 2.4e-5 * sp * sp * rho;
      const axial = v.dot(m.dir);
      // Yanal hız eksene yaklaşır (aerodinamik yön kararlılığı); yanma sürerken otopilot hattı tutar,
      // yanma bitince hafif balistik çöküş.
      const lat = this._v.copy(v).addScaledVector(m.dir, -axial);
      lat.multiplyScalar(Math.exp(-7 * dt) - 1);
      v.add(lat);
      v.addScaledVector(m.dir, (thrust - drag) * dt);
      if (thrust === 0) { v.y -= 0.35 * G * dt; }
      if (thrust === 0) m.dir.copy(v).normalize();
      m.pos.addScaledVector(v, dt);
      // Gövde hız vektörüne hizalanır
      if (sp > 1) {
        this._m.lookAt(this._v.set(0, 0, 0), this._v2.copy(v), this._up);   // -z (burun) hız yönüne
        this._q.setFromRotationMatrix(this._m);
        m.quat.slerp(this._q, 1 - Math.exp(-12 * dt));
      }
      // Motor alevi ve parıltı
      const burning = thrust > 0;
      m.plume.visible = m.glow.visible = burning;
      if (burning) {
        const boost = tb < BOOST_T;
        const L = (boost ? 2.2 : 1.1) * (0.9 + 0.1 * Math.sin(this.time * 47)) * Math.min(1, tb / 0.1 + 0.3);
        const R = boost ? 0.13 : 0.09;
        m.plume.scale.set(R, R, L);
        const gs = (boost ? 3.2 : 1.8) * (0.85 + 0.15 * Math.sin(this.time * 53 + m.t0));
        m.glow.scale.set(gs, gs, gs);
      }
      // Duman izi: lüle konumundan
      const noz = this._p.copy(m.dir).multiplyScalar(-MISSILE.len / 2 - 0.2).add(m.pos);
      if (m.trail && burning) {
        m.trail.push(noz, m.dir, this.fx.t, Math.max(1.2, sp * 0.012));
        m.puffDist += sp * dt;
        if (m.puffDist > 22 && m.t - m.ignT < 1.5) { m.puffDist = 0; this.fx.trailPuff(noz, v); }
      } else if (m.trail && !burning) { m.trail.end(this.fx.t); m.trail = null; }
    }
    m.mesh.position.copy(m.pos); m.mesh.quaternion.copy(m.quat);
    // Süpürülmüş çarpışma (bu kare kat edilen parça)
    if (this.collide(m)) return;
    if (m.t > LIFE) this.detonate(m, 'air');
  }

  ignite(m) {
    m.state = 'boost'; m.ignT = m.t;
    let tr = this.trails.find((x) => !x.mesh.visible);
    if (!tr) tr = this.trails.reduce((a, b) => (a.dieAt < b.dieAt ? a : b));
    tr.reset(); m.trail = tr;
    const noz = this._p.copy(m.dir).multiplyScalar(-MISSILE.len / 2 - 0.2).add(m.pos);
    this.fx.ignition(noz, m.vel, m.dir);
    this.fx.light(noz, new THREE.Color(1, 0.62, 0.3), 16, 0.35);
    this.audio && this.audio.missileMotor();
    const d = this.rig.camera.position.distanceTo(m.pos);
    if (d < 80) this.rig.shake(0.16 * (1 - d / 80));
  }

  /** Bu karenin parçası boyunca ilk çarpışma. Döndürür: çarptıysa true. */
  collide(m) {
    const a = m.prev, b = m.pos;
    const len = a.distanceTo(b);
    if (len < 1e-4) return false;
    const surf = (x, z) => { const h = terrainHeight(x, z); return h < WATER_LEVEL ? WATER_LEVEL : h; };
    const p = this._p, q = this._n;
    // Arazi / su: en fazla 4 m adımla örnekle, ilk altına inişi ikiye bölmeyle incelt
    let tHit = -1;
    const n = Math.max(1, Math.ceil(len / 4));
    let t0 = 0;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      p.lerpVectors(a, b, t);
      if (p.y <= surf(p.x, p.z)) {
        let lo = t0, hi = t;
        for (let k = 0; k < 7; k++) { const mid = (lo + hi) / 2; q.lerpVectors(a, b, mid); if (q.y <= surf(q.x, q.z)) hi = mid; else lo = mid; }
        tHit = hi; break;
      }
      t0 = t;
    }
    // Yapılar ve nesneler (hangar, şehir, park halindeki uçaklar...)
    const tb = this.world && this.world.segmentHit ? this.world.segmentHit(a, b) : -1;
    let kind = null, t = -1;
    if (tb >= 0 && (tHit < 0 || tb < tHit)) { kind = 'building'; t = tb; }
    else if (tHit >= 0) { t = tHit; }
    if (t < 0) return false;
    p.lerpVectors(a, b, t);
    const th = terrainHeight(p.x, p.z);
    if (!kind) kind = th < WATER_LEVEL ? 'water' : 'ground';
    if (kind !== 'building') p.y = Math.max(th, WATER_LEVEL);
    m.pos.copy(p);
    this.detonate(m, kind, p.clone(), Math.max(th, WATER_LEVEL));
    return true;
  }

  /** Uçağa vuran efekt ışığı: en etkili kaynak (yanan motor ya da patlama), görünüş uzayında. */
  updateFxLight(pose, camera) {
    let best = 0, bp = null, bc = null;
    const ap = pose.pos;
    for (const m of this.missiles) {
      if (!m.alive || !m.plume.visible) continue;
      const noz = this._v.copy(m.dir).multiplyScalar(-MISSILE.len / 2 - 0.4).add(m.pos);
      const I = 5 * (0.85 + 0.15 * Math.sin(this.time * 41 + m.t0));
      const e = I / (1 + noz.distanceToSquared(ap) * 0.08);
      if (e > best) { best = e; bp = this._fxPos.copy(noz); bc = this._fxCol.setRGB(1, 0.6, 0.26).multiplyScalar(I); }
    }
    for (const L of this.fx.lights) {
      const age = this.fx.t - L.t0, k = Math.max(0, 1 - age / L.dur);
      const I = L.peak * k * k;
      const e = I / (1 + L.p.distanceToSquared(ap) * 0.08);
      if (e > best) { best = e; bp = this._fxPos.copy(L.p); bc = this._fxCol.copy(L.c).multiplyScalar(I); }
    }
    if (best < 0.01) { FX_LIGHT.uFxCol.value.setRGB(0, 0, 0); return; }
    camera.updateMatrixWorld();
    FX_LIGHT.uFxPos.value.copy(bp).applyMatrix4(camera.matrixWorldInverse);
    FX_LIGHT.uFxCol.value.copy(bc);
  }

  /** Yerde durunca füzeler yeniden yüklenir. */
  rearmCheck(dt) {
    const p = this.physics;
    if (!p || this.count === this.stations.length) { this._rearmT = 0; return; }
    if (p.onGround && p.vel.length() < 2 && this.bays.every((b) => b.state === 'closed')) {
      this._rearmT = (this._rearmT || 0) + dt;
      if (this._rearmT > 2) {
        for (const s of this.stations) s.loaded = true;
        this.applyModel(false);
        this._rearmT = 0;
        this.hooks.message && this.hooks.message('Missiles reloaded');
        this.emitState();
      }
    } else this._rearmT = 0;
  }

  emitState() {
    this._lastEmit = this.time;
    const busy = this.bays.some((b) => b.state === 'opening' || b.state === 'eject');
    const cd = Math.max(0, this.nextAllowed - this.time) / COOLDOWN;
    const info = { count: this.count, pending: this.pending, busy, cooldown: cd, ready: this.count > 0 && !busy && cd <= 0 && !this.inhibited() };
    this.hooks.onState && this.hooks.onState(info);
  }

  /** Test/teşhis: canlı nesne sayıları. */
  debug() {
    return {
      count: this.count, pending: this.pending, time: this.time,
      bays: this.bays.map((b) => ({ state: b.state, inner: +b.inner.toFixed(3), outer: +b.outer.toFixed(3), rail: +b.rail.toFixed(3) })),
      missiles: this.missiles.filter((m) => m.alive).map((m) => ({ state: m.state, t: +m.t.toFixed(2), kind: m.kind, pos: m.pos.toArray().map((x) => +x.toFixed(2)), speed: +m.vel.length().toFixed(1) })),
      trails: this.trails.filter((t) => t.mesh.visible).length,
      particles: { alpha: this.fx.alpha.mesh.visible, add: this.fx.add.mesh.visible },
      stats: this.stats,
    };
  }

  dispose() {
    for (const m of this.missiles) this.scene.remove(m.mesh);
    for (const tr of this.trails) { this.scene.remove(tr.mesh); tr.geometry.dispose(); }
    this.plumeGeo.dispose(); this.glowGeo.dispose(); this.plumeMat.dispose(); this.glowMat.dispose();
    this.fx.dispose();
  }
}
