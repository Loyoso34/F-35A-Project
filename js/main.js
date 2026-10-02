// F-35A Simülatör – uygulama giriş noktası.
import * as THREE from 'three';
import { APP_VERSION } from './version.js';
import { World, LAYER_TREES, QUALITY_PRESETS, SPAWNS, spawnPose, AIRPORT_BY_ID } from './world.js';
import { FlightModel, FIXED_DT } from './physics.js';
import { FLEET, FLEET_ORDER, getAircraftConfig } from './fleet.js';
import { Controls } from './controls.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { CameraRig, CAMERA_NAMES, CAMERA_LABELS } from './cameras.js';
import { liveriesFor, defaultLiveryId } from './liveries.js';
import { UI, isStandalone, isIOS, loadSettings, saveSettings } from './ui.js';
import { AdaptiveQuality, perfMultipliers } from './perf.js';

// ---------------------------------------------------------------------------
// Yükleme ilerlemesi. Yüzde ZAMANA bağlı değildir: yalnızca bir iş (ya da arazi
// parçası) BİTTİĞİNDE ilerler. Her işin payı, o işin süresine göre ağırlıklanır:
//   - ilk açılışta geliştirme makinesinde ölçülen süreler (orta kalite, ms),
//   - sonraki açılışlarda BU cihazda bir önceki yüklemede ölçülen süreler
//     (kalite ayarına göre ayrı ayrı saklanır).
// Böylece çubuk, işin gerçek dağılımına yakın ve eşit hızda ilerler.
// ---------------------------------------------------------------------------
const LOAD_COST_MS = {
  gfx: 60, sky: 3, lights: 1, terrain: 5800, water: 430, trees: 1000, roads: 52, town: 80,
  airbase: 250, baseDetails: 100, civil: 120, city: 285, surroundings: 15, clouds: 45, collision: 2,
  env: 40, systems: 10, previews: 1500, shaders: 900,
};
const LOAD_LABEL = {
  gfx: 'Starting graphics…',
  sky: 'Setting up sky and lighting…', lights: 'Setting up sky and lighting…',
  terrain: 'Building terrain…',
  water: 'Adding lakes, rivers and the sea…',
  trees: 'Planting forests…',
  roads: 'Laying roads…', town: 'Building towns…',
  airbase: 'Building Anadolu Air Base…', baseDetails: 'Building Anadolu Air Base…',
  civil: 'Building Yesilova Airport…',
  city: 'Building the city…',
  surroundings: 'Finishing airport surroundings…', clouds: 'Forming clouds…', collision: 'Finishing scenery…',
  env: 'Preparing reflections…',
  systems: 'Setting up flight systems…',
  previews: 'Rendering aircraft previews…',
  shaders: 'Compiling shaders…',
};
const PROFILE_KEY = 'ffs.loadProfile';

class LoadTracker {
  constructor(stages, profileKey, onUpdate) {
    this.stages = stages;
    this.profileKey = profileKey;
    this.onUpdate = onUpdate;
    let saved = {};
    try { saved = (JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {})[profileKey] || {}; } catch (e) { saved = {}; }
    this.weight = {};
    for (const id of stages) {
      const w = Number(saved[id]);
      this.weight[id] = w > 0 && w < 600000 ? w : (LOAD_COST_MS[id] || 50);
    }
    this.total = stages.reduce((a, id) => a + this.weight[id], 0) || 1;
    this.doneW = 0;       // tamamlanan aşamaların toplam ağırlığı
    this.cur = null; this.curFrac = 0; this.t0 = 0;
    this.measured = {};
    this.value = 0;
  }
  /** Aşamayı başlat (ya da içinde ilerle). frac: aşamanın tamamlanan kesri. */
  step(id, frac = 0, label) {
    if (this.cur !== id) {
      if (this.cur) this.end(this.cur);
      this.cur = id; this.curFrac = 0; this.t0 = performance.now();
    }
    if (frac > this.curFrac) this.curFrac = Math.min(1, frac);
    this.emit(label || LOAD_LABEL[id]);
  }
  end(id) {
    if (this.cur !== id) return;
    this.measured[id] = (this.measured[id] || 0) + (performance.now() - this.t0);
    this.doneW += this.weight[id] || 0;
    this.cur = null; this.curFrac = 0;
    this.emit();
  }
  emit(label) {
    const cw = this.cur ? (this.weight[this.cur] || 0) * this.curFrac : 0;
    const v = Math.min(1, (this.doneW + cw) / this.total);
    if (v > this.value) this.value = v;
    this.onUpdate(this.value, label);
  }
  finish(label) { if (this.cur) this.end(this.cur); this.value = 1; this.onUpdate(1, label); }
  /** Bu cihazda ölçülen süreleri bir sonraki yükleme için sakla (yumuşatılmış). */
  save() {
    try {
      const all = JSON.parse(localStorage.getItem(PROFILE_KEY) || '{}') || {};
      const prev = all[this.profileKey] || {};
      const next = {};
      for (const id of this.stages) {
        const m = this.measured[id];
        if (!(m > 0)) { if (prev[id] > 0) next[id] = prev[id]; continue; }
        next[id] = Math.round(prev[id] > 0 ? prev[id] * 0.4 + m * 0.6 : m);
      }
      all[this.profileKey] = next;
      localStorage.setItem(PROFILE_KEY, JSON.stringify(all));
    } catch (e) { /* özel mod: kalibrasyon yok */ }
  }
}

const WORLD_STAGES = ['sky', 'lights', 'terrain', 'water', 'trees', 'roads', 'town', 'airbase', 'baseDetails', 'civil', 'city', 'surroundings', 'clouds', 'collision'];

class App {
  constructor() {
    this.ui = new UI();
    this.settings = loadSettings();
    this.state = 'loading'; // loading | start | running | paused | crashed
    this.pausedByOrientation = false;
    this.accumulator = 0;
    this.lastTime = 0;
    this.frameCount = 0; this.fpsTime = 0;
    // 60 fps kilidi: hedef kare zamanı (sürüklenmesiz), uyarlanabilir çözünürlük durumu
    this.targetFps = 60;
    this.frameMs = 1000 / 60;
    this.nextRender = 0;
    this.renderScale = 1;      // kalite ön ayarının piksel oranına uygulanan çarpan (0.8–1)
    // Uyarlanabilir kalite: önce ikincil efektler, en son yumuşak adımlarla çözünürlük (perf.js)
    this.aq = new AdaptiveQuality({
      apply: (tier, scale) => {
        if (this.world) this.world.setPerf(perfMultipliers(tier));
        this.renderScale = scale;
        if (this.renderer) this.applyPixelRatio();
      },
    });
    // Çizim pozu: fizik 120 Hz sabit adımla ilerler, ekran ~60 Hz. Uçak ve kamera
    // son İKİ fizik durumu arasında enterpolasyonla çizilir; böylece bir karede 1,
    // ötekinde 3 adım atıldığında görüntü bir fizik adımı kadar (yüksek hızda ~2 m)
    // sıçramaz. Gecikme en fazla bir fizik adımıdır (8,3 ms).
    const app = this;
    this._prevPos = new THREE.Vector3(); this._prevQuat = new THREE.Quaternion();
    this.pose = {
      pos: new THREE.Vector3(), quat: new THREE.Quaternion(),
      get vel() { return app.physics.vel; }, get time() { return app.physics.time; },
      get telemetry() { return app.physics.telemetry; },
    };
    this._acArgs = {};
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.ui.el.version.textContent = APP_VERSION;
    if (this.ui.el.loadingVer) this.ui.el.loadingVer.textContent = 'v' + APP_VERSION;
    this.canvas = document.getElementById('gl');
    this.hudCanvas = document.getElementById('hud');
    this.contextLost = false;
    // Görüntü alanı (js/viewport.js) tek kaynaktır. Yükleme BAŞLAMADAN abone olunur:
    // yükleme sırasında döndürülen telefonda tuval ve arayüz de hemen yeniden boyutlanır.
    this.vp = window.ffsViewport || {
      get w() { return window.innerWidth; }, get h() { return window.innerHeight; },
      get landscape() { return window.innerWidth >= window.innerHeight; }, measure() { return false; }, onChange() {},
    };
    this.vp.onChange(() => this.onResize());
    this.init().catch((err) => {
      console.error(err);
      this.ui.loadingError('Something went wrong while loading: ' + (err && err.message ? err.message : err));
    });
  }

  async init() {
    const ui = this.ui;
    const stages = ['gfx', ...WORLD_STAGES, 'env', 'systems', 'previews', 'shaders'];
    const prog = new LoadTracker(stages, 'boot-' + this.settings.quality, (v, label) => ui.setProgress(v, label));
    ui.resetProgress(LOAD_LABEL.gfx);
    prog.step('gfx');
    await this.breathe();
    this.setupRenderer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 60000);
    this.camera.layers.enable(LAYER_TREES);
    this.scene.add(this.camera);
    this.onResize();
    prog.end('gfx');

    this.world = await this.createWorld(this.settings.quality, prog);

    prog.step('env');
    await this.breathe();
    this.buildEnvironment();
    prog.end('env');

    prog.step('systems');
    await this.breathe();
    this.aircraft = null; this.physics = null; this.aircraftId = null;
    this.hud = new HUD(this.hudCanvas);
    this.audio = new AudioEngine();
    this.cameraRig = new CameraRig(this.camera, null, this.world, null);
    this.controls = new Controls({
      onGear: () => this.toggleGear(),
      onFlaps: () => this.toggleFlaps(),
      onFlapIndex: (i) => this.setFlapIndex(i),
      onBrake: () => this.toggleBrake(),
      onCamera: () => this.cycleCamera(),
      onSound: () => this.toggleSound(),
      onPause: () => this.togglePause(),
      onLights: () => this.toggleLights(),
      onPhysDebug: () => this.togglePhysDebug(),
      onSpoilers: () => this.toggleSpoilers(),
      onMenu: () => this.ui.toggleMenu(),
      onMenuActivity: () => this.ui.menuActivity(),
      onViewDrag: (dx, dy) => this.cameraRig.drag(dx, dy),
      onViewPinch: (f) => this.cameraRig.zoom(f),
      onViewRecenter: () => this.cameraRig.recenterLook(),
    });
    this.bindUI();
    this.bindSystem();
    this.onResize();
    this.applySettingsToUI();
    prog.end('systems');

    prog.step('previews');
    await this.breathe();
    await this.buildThumbnails(null, (k, n) => prog.step('previews', k / n, `Rendering aircraft previews (${Math.min(n, Math.floor(k) + 1)}/${n})…`));
    prog.end('previews');

    prog.step('shaders');
    await this.breathe();
    this.updateSelectCamera(0);
    this.world.update(0, this.camera, this.camera.position);
    await this.precompile(this.scene);
    this.warmupFrame();
    prog.end('shaders');

    prog.finish('Ready');
    await ui.progressSettled();
    prog.save();
    this.loaded = true;
    ui.el.loading.setAttribute('aria-busy', 'false');
    ui.hide('loading');
    this.buildSelectGrid();
    this.showSelect();
    if (isIOS() && !isStandalone()) ui.el.selHint.textContent = 'On iPhone, tap Share → Add to Home Screen to play full screen.';
    this.registerSW();
    this.checkOrientation();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

  // Tarayıcıya nefes aldırır: bir kare çizilir (ilerleme çubuğu), bekleyen olaylar
  // (döndürme, yeniden boyutlandırma) işlenir. rAF sonrası zamanlayıcı kullanılır ki
  // sıradaki iş o karenin ÇİZİMİNDEN sonra başlasın. Sayfa arka plandaysa rAF durur:
  // o durumda yalnızca zamanlayıcı.
  breathe() {
    return new Promise((res) => {
      let done = false;
      const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
      if (!document.hidden) requestAnimationFrame(go);
      setTimeout(go, document.hidden ? 0 : 120);
    });
  }

  /** Dünyayı zaman dilimli kurar; ilerlemeyi aşama aşama bildirir. */
  async createWorld(quality, prog) {
    const world = new World(this.scene, this.renderer, quality, { defer: true });
    await world.build((id, frac) => prog.step(id, frac), () => this.breathe());
    return world;
  }

  /**
   * Gölgelendiricileri yükleme ekranı açıkken derle. Aksi hâlde ilk kare (yükleme
   * ekranı kapandıktan SONRA) derleme için donuyordu.
   *
   * three.js compile() yalnızca GÖRÜNÜR nesneleri dolaşır. Art yakıcı alevi, iniş
   * ışığı merceği, uzak LOD parçaları gibi başlangıçta gizli olan her şey ilk
   * göründüğü karede derlenir ve uçuş sırasında takılma yapardı. Bu yüzden derleme
   * süresince ağaçtaki her nesne geçici olarak görünür yapılır, sonra eski hâline
   * döner. compileAsync paralel derlemeyi destekleyen cihazlarda ana iş parçacığını
   * bekletmez.
   */
  async precompile(target) {
    const hidden = [];
    target.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    let pending = null;
    try {
      // Paralel derleme uzantısı yoksa compileAsync de eşzamanlı derler (ve konsola
      // uyarı yazar): o durumda doğrudan compile kullanılır.
      const parallel = this.renderer.extensions && this.renderer.extensions.has('KHR_parallel_shader_compile');
      if (parallel && this.renderer.compileAsync) pending = this.renderer.compileAsync(target, this.camera, this.scene);
      else this.renderer.compile(target, this.camera, this.scene);
    } catch (e) { console.warn('Shader precompilation skipped', e); }
    finally { for (const o of hidden) o.visible = false; }
    // compile() nesneleri eşzamanlı dolaştı; görünürlük geri alındıktan sonra yalnızca
    // programların hazır olması beklenir
    if (pending) { try { await pending; } catch (e) { console.warn('Shader precompilation skipped', e); } }
  }

  /**
   * Yükleme ekranı (opak) açıkken bir kare çizer. compile() gölge haritasının derinlik
   * gölgelendiricilerini kapsamaz ve onlar da sahnedeki ışık kümesine göre anahtarlanır;
   * ilk uçuş karesinde derlenmesinler diye burada çizilir. Doku yüklemeleri de bu karede
   * GPU'ya gider.
   */
  warmupFrame() {
    try { this.renderer.render(this.scene, this.camera); } catch (e) { console.warn('Warm-up frame skipped', e); }
    this.needsRender = true;
  }

  setupRenderer() {
    const q = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q.pixelRatio <= 1.5, powerPreference: 'high-performance', alpha: false, stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio) * this.renderScale);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = q.shadows;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      if (this.state === 'running') this.pause();
      this.ui.show('contextLost');
    }, false);
    this.canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      this.ui.hide('contextLost');
      this.buildEnvironment();
      this.needsRender = true;
    }, false);
  }

  buildEnvironment() {
    // Gökyüzünden küçük bir ortam haritası: kanopi ve boya yansımaları için
    try {
      if (this.envMap) this.envMap.dispose();
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      const envScene = new THREE.Scene();
      envScene.add(this.world.sky.clone());
      this.envMap = pmrem.fromScene(envScene, 0.02, 1, 100).texture;
      pmrem.dispose();
      this.scene.environment = this.envMap;
      this.scene.environmentIntensity = 0.55;
    } catch (e) {
      console.warn('Could not build the environment map', e);
    }
  }

  // ---- UI bağlama ----
  bindUI() {
    const ui = this.ui, el = ui.el;
    if (el.btnStart) el.btnStart.addEventListener('click', () => this.pickAircraft(this.aircraftId || this.settings.aircraft || FLEET_ORDER[0]));
    el.btnAircraft.addEventListener('click', () => { ui.hide('pause'); this.showSelect(); });
    el.btnResume.addEventListener('click', () => this.resume());
    el.btnRestart.addEventListener('click', () => { ui.hide('pause'); this.restart(); });
    el.btnSettings.addEventListener('click', () => { ui.hide('pause'); ui.show('settings'); });
    el.btnSettingsClose.addEventListener('click', () => { ui.hide('settings'); if (this.state === 'paused') ui.show('pause'); });
    el.btnCrashRestart.addEventListener('click', () => { ui.hide('crash'); this.restart(); });
    el.btnUpdate.addEventListener('click', () => location.reload());
    ui.bindSeg(el.qualitySeg, 'q', (v) => this.setQuality(v));
    ui.bindSeg(el.tiltSeg, 't', async (v) => {
      const on = v === '1';
      const ok = await this.controls.setTiltEnabled(on);
      if (on && !ok) { ui.setSeg(el.tiltSeg, 't', 0); ui.message('Motion access denied — tilt steering is off'); this.settings.tilt = 0; }
      else this.settings.tilt = on ? 1 : 0;
      saveSettings(this.settings);
    });
    ui.bindSeg(el.soundSeg, 's', (v) => { this.settings.sound = v === '1' ? 1 : 0; saveSettings(this.settings); this.applySound(); });
    ui.bindSeg(el.fpsSeg, 'f', (v) => { this.settings.fps = v === '1' ? 1 : 0; saveSettings(this.settings); el.fps.textContent = ''; });
    el.btnCalibrate.addEventListener('click', () => { this.controls.calibrate(); ui.message('Tilt calibrated'); });
  }
  applySettingsToUI() {
    const ui = this.ui, el = ui.el;
    ui.setSeg(el.qualitySeg, 'q', this.settings.quality);
    ui.setSeg(el.tiltSeg, 't', this.settings.tilt);
    ui.setSeg(el.soundSeg, 's', this.settings.sound);
    ui.setSeg(el.fpsSeg, 'f', this.settings.fps);
    this.applySound();
    if (this.physics) this.updateToggleButtons();
  }
  applySound() {
    const muted = !this.settings.sound;
    this.audio.setMuted(muted);
    const ic = this.ui.el.btnSound.querySelector('.i'); if (ic) ic.textContent = muted ? '🔇' : '🔊';
    this.ui.setToggle(this.ui.el.btnSound, !muted);
  }

  bindSystem() {
    // Yeniden boyutlandırma / döndürme olayları js/viewport.js'de toplanır ve
    // ölçülen boyut DEĞİŞTİĞİNDE onResize çağrılır (kurucuda abone olundu).
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'running') this.pause();
        this.audio.suspend();
      } else {
        this.lastTime = performance.now();
        this.accumulator = 0;
        if (this.state !== 'start') this.audio.resume();
      }
    });
    window.addEventListener('pagehide', () => { if (this.state === 'running') this.pause(); });
  }

  // Kalite ön ayarının piksel oranı x uyarlanabilir ölçek. 60 fps tutturulamayınca ölçek düşer, tutturulunca geri yükselir.
  basePixelRatio() {
    const q = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
    return Math.min(window.devicePixelRatio || 1, q.pixelRatio);
  }
  applyPixelRatio() {
    const pr = this.basePixelRatio() * this.renderScale;
    if (Math.abs(this.renderer.getPixelRatio() - pr) < 0.001) return;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.vp.w, this.vp.h, false);
    this.needsRender = true;
  }

  // Boyut her zaman görüntü alanı modülünden gelir (window.innerWidth/innerHeight
  // iOS'ta döndürmeden hemen sonra eski yönelimin değerlerini verebiliyor).
  // Yükleme sırasında da çağrılır: henüz kurulmamış parçalar atlanır.
  onResize() {
    const w = this.vp.w, h = this.vp.h;
    if (this.renderer) {
      this.renderer.setPixelRatio(this.basePixelRatio() * this.renderScale);
      this.renderer.setSize(w, h, false);
    }
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (this.hud) this.hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
    // Güvenli alan değerlerini bir sonda elemanın hesaplanmış padding'inden oku (env() doğrudan okunamaz)
    if (!this.safeProbe) {
      const probe = document.createElement('div');
      probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px);';
      document.body.appendChild(probe);
      this.safeProbe = probe;
    }
    const cs = getComputedStyle(this.safeProbe);
    const px = (v) => parseFloat(v) || 0;
    this.safe = { top: px(cs.paddingTop), right: px(cs.paddingRight), bottom: px(cs.paddingBottom), left: px(cs.paddingLeft) };
    if (this.controls) this.controls.setThrottleUI();
    this.needsRender = true;
    this.checkOrientation();
  }

  checkOrientation() {
    const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    const portrait = this.vp.h > this.vp.w && (coarse || this.vp.w < 600);
    // Yükleme sürerken uyarı kaplaması açılmaz: yükleme kartı dikeyde de düzgün
    // yerleşir ve kendi "yataya çevirin" ipucunu gösterir.
    if (!this.loaded) return;
    if (portrait) {
      this.ui.show('orient');
      if (this.state === 'running') { this.pause(); this.pausedByOrientation = true; }
    } else {
      this.ui.hide('orient');
      this.pausedByOrientation = false;
    }
  }

  // ---- Oyun durumu ----
  // ---- Uçak seçimi ----
  buildSelectGrid() {
    const grid = this.ui.el.selGrid;
    if (!grid || grid.childElementCount) return;
    for (const id of FLEET_ORDER) {
      const cfg = FLEET[id];
      const card = document.createElement('button');
      card.className = 'ac-card';
      card.id = 'card-' + id;
      card.type = 'button';
      card.style.setProperty('--ac', cfg.accent);
      card.setAttribute('aria-label', cfg.name);
      const cv = document.createElement('canvas');
      cv.className = 'ac-thumb'; cv.id = 'thumb-' + id; cv.width = 512; cv.height = 288;
      const info = document.createElement('div');
      info.className = 'ac-info';
      info.innerHTML = '<span class="ac-name"></span><span class="ac-sub"></span><div class="ac-specs"></div>';
      info.querySelector('.ac-name').textContent = cfg.name;
      info.querySelector('.ac-sub').textContent = cfg.sub;
      for (const t of cfg.specs) { const sp = document.createElement('span'); sp.textContent = t; info.querySelector('.ac-specs').appendChild(sp); }
      const go = document.createElement('span');
      go.className = 'ac-go'; go.textContent = 'FLY →';
      card.append(cv, info, go);
      card.addEventListener('click', () => this.pickAircraft(id));
      grid.appendChild(card);
      if (this.thumbData && this.thumbData[id]) cv.getContext('2d').putImageData(this.thumbData[id], 0, 0);
    }
    this.buildSpawnRow();
    this.buildLiveryRows();
  }

  // -------------------------------------------------------------------------
  // Livery seçimi. Tamamen görsel: yalnızca seçilen boya şeması kaydedilir ve
  // uçak kurulurken build() çağrısına geçirilir. Fizik, sistemler, kameralar ve
  // arayüz davranışı bu yoldan etkilenmez.
  // -------------------------------------------------------------------------
  /** Bir uçak için seçili livery kimliği (kayıtlı değer geçersizse varsayılan). */
  liveryId(aircraftId) {
    const list = liveriesFor(aircraftId);
    if (!list.length) return null;
    const saved = (this.settings.livery || {})[aircraftId];
    return list.some((l) => l.id === saved) ? saved : defaultLiveryId(aircraftId);
  }

  /** Uçak başına bir satır livery çipi üretir (seçim ekranında). */
  buildLiveryRows() {
    const host = this.ui.el.selLivery;
    if (!host || host.childElementCount) return;
    for (const acId of FLEET_ORDER) {
      const list = liveriesFor(acId);
      if (list.length < 2) continue;                 // tek şema varsa satır gösterme
      const row = document.createElement('div');
      row.className = 'sel-lv';
      const lbl = document.createElement('span');
      lbl.className = 'sel-lv-lbl';
      lbl.textContent = FLEET[acId].name;
      const chips = document.createElement('div');
      chips.className = 'sel-lv-row';
      chips.id = 'lv-row-' + acId;
      for (const lv of list) {
        const b = document.createElement('button');
        b.className = 'lv-chip'; b.type = 'button'; b.id = 'lv-' + acId + '-' + lv.id;
        b.innerHTML = '<b></b><span></span>';
        b.querySelector('b').textContent = lv.name;
        b.querySelector('span').textContent = lv.sub || '';
        b.addEventListener('click', () => this.setLivery(acId, lv.id));
        chips.appendChild(b);
      }
      row.append(lbl, chips);
      host.appendChild(row);
      this.setLivery(acId, this.liveryId(acId), true);
    }
  }

  /**
   * Livery seçer, kaydeder ve gerekirse görüntüyü tazeler.
   * Uçuş halindeyken seçilen uçağın liverysi değişirse MODEL yeniden kurulur;
   * fizik durumu (konum, hız, yönelim, sistemler) olduğu gibi korunur.
   */
  setLivery(aircraftId, liveryId, quiet) {
    const list = liveriesFor(aircraftId);
    if (!list.length) return;
    if (!list.some((l) => l.id === liveryId)) liveryId = defaultLiveryId(aircraftId);
    this.settings.livery = Object.assign({}, this.settings.livery, { [aircraftId]: liveryId });
    if (!quiet) saveSettings(this.settings);
    for (const lv of list) {
      const b = document.getElementById('lv-' + aircraftId + '-' + lv.id);
      if (b) b.classList.toggle('on', lv.id === liveryId);
    }
    if (quiet) return;
    // Seçim ekranındaki önizlemeyi tazele
    this.refreshThumb(aircraftId);
    // Halihazırda uçulan uçak buysa modeli yeni boyayla yeniden kur
    if (this.aircraft && this.aircraftId === aircraftId) this.reskinAircraft();
  }

  // Kalkış havalimanı seçici: uçak kartlarının altında tek satır
  buildSpawnRow() {
    const row = this.ui.el.selApRow;
    if (!row || row.childElementCount) return;
    for (const sp of SPAWNS) {
      const b = document.createElement('button');
      b.className = 'ap-chip'; b.type = 'button'; b.id = 'ap-' + sp.id;
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = sp.name;
      b.querySelector('span').textContent = sp.sub;
      b.addEventListener('click', () => this.setSpawn(sp.id));
      row.appendChild(b);
    }
    this.setSpawn(this.settings.spawn || 'base', true);
  }

  setSpawn(id, quiet) {
    if (!SPAWNS.some((s) => s.id === id)) id = SPAWNS[0].id;
    this.settings.spawn = id;
    if (!quiet) saveSettings(this.settings);
    for (const sp of SPAWNS) {
      const b = document.getElementById('ap-' + sp.id);
      if (b) b.classList.toggle('on', sp.id === id);
    }
  }

  // Kart önizlemeleri: gerçek modeller bir kez render hedefine çizilir (dış görsel bağımlılığı yok)
  async buildThumbnails(only = null, onProgress = null) {
    const W = 512, H = 288;
    const rt = new THREE.WebGLRenderTarget(W, H);
    const scene = new THREE.Scene();
    const key = new THREE.DirectionalLight(0xfff2e0, 3.4); key.position.set(-9, 11, -7); scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd4ff, 1.3); fill.position.set(10, 3, 9); scene.add(fill);
    scene.add(new THREE.HemisphereLight(0x9ec3ee, 0x2a3038, 1.5));
    if (this.envMap) scene.environment = this.envMap;
    const cam = new THREE.PerspectiveCamera(26, W / H, 0.5, 4000);
    const buf = new Uint8Array(W * H * 4);
    const prevAlpha = this.renderer.getClearAlpha();
    this.renderer.setClearAlpha(0);
    if (!only) this.thumbData = {};
    const list = only ? [only] : FLEET_ORDER;
    for (let k = 0; k < list.length; k++) {
      const id = list[k];
      if (onProgress) onProgress(k, list.length);
      const cfg = FLEET[id];
      let ac = null;
      try {
        ac = cfg.build({ quality: this.settings.quality, livery: this.liveryId(id) });
        if (this.envMap && ac.setEnvironment) ac.setEnvironment(this.envMap);
        ac.update({ gear: 1, flaps: 0, slats: 0, spoilers: 0, throttle: 0.2, engine: 0.2, time: 0.35, dt: 0.016 });
        scene.add(ac.group);
        // Model kurulumu ile ilk çizim (gölgelendirici derlemesi) ayrı dilimlerde:
        // arada tarayıcı bir kare çizer, döndürmeye tepki verir
        if (onProgress) { onProgress(k + 0.5, list.length); await this.breathe(); }
        cam.fov = cfg.thumb.fov;
        cam.position.fromArray(cfg.thumb.pos);
        cam.lookAt(cfg.thumb.look[0], cfg.thumb.look[1], cfg.thumb.look[2]);
        cam.updateProjectionMatrix();
        this.renderer.setRenderTarget(rt);
        this.renderer.clear();
        this.renderer.render(scene, cam);
        this.renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        this.renderer.setRenderTarget(null);
        // WebGL alttan yukarı okur: satırları ters çevirerek 2B tuvale aktar
        const img = new ImageData(W, H);
        for (let y = 0; y < H; y++) {
          const src = (H - 1 - y) * W * 4, dst = y * W * 4;
          img.data.set(buf.subarray(src, src + W * 4), dst);
        }
        this.thumbData[id] = img;
        const cv = document.getElementById('thumb-' + id);
        if (cv) cv.getContext('2d').putImageData(img, 0, 0);
      } catch (e) {
        console.warn('preview could not be generated', id, e);
      } finally {
        if (ac) { scene.remove(ac.group); ac.dispose(); }
      }
      await this.breathe();
    }
    this.renderer.setClearAlpha(prevAlpha);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    key.dispose(); fill.dispose();
  }

  /** Tek uçağın kart önizlemesini yeni liveryle yeniden çizer. */
  refreshThumb(aircraftId) {
    if (!this.renderer || !this.ui.el.selGrid || !this.ui.el.selGrid.childElementCount) return;
    this.buildThumbnails(aircraftId).catch((e) => console.warn('preview could not be generated', e));
  }

  /**
   * Uçuş halindeyken boyayı değiştirir: model yeniden kurulur ama FİZİK NESNESİNE
   * DOKUNULMAZ. Konum, hız, yönelim, motor durumu, takım/flap/spoyler konumları ve
   * kamera kipi olduğu gibi kalır; yalnızca görsel model değişir.
   */
  reskinAircraft() {
    const cfg = getAircraftConfig(this.aircraftId);
    if (!cfg || !this.aircraft) return;
    const old = this.aircraft;
    let ac;
    try {
      ac = cfg.build({ quality: this.settings.quality, livery: this.liveryId(this.aircraftId) });
    } catch (e) { console.warn('livery could not be applied', e); return; }
    this.scene.remove(old.group);
    old.dispose();
    this.aircraft = ac;
    this.scene.add(ac.group);
    if (this.envMap && ac.setEnvironment) ac.setEnvironment(this.envMap);
    // Kamera YAPILANDIRMASI değişmez (setAircraft yörüngeyi sıfırlardı); yalnızca
    // hangi modele bakılacağı güncellenir ve geçerli kip yeniden uygulanır.
    this.cameraRig.aircraft = ac;
    this.cameraRig.applyMode();
    if (ac.setLandingLights) ac.setLandingLights(this.lightsOn);
    if (this.physics) this.syncAircraft(0);
    // Yeni boya malzemeleri: seçim ekranındayken arka planda derlenir
    this.precompile(ac.group);
    this.needsRender = true;
  }

  showSelect() {
    if (this.state === 'running') this.controls.setEnabled(false);
    this.state = 'select';
    this.ui.setMenu(false);
    this.ui.hide('touch'); this.ui.hide('pause'); this.ui.hide('settings'); this.ui.hide('crash'); this.ui.hide('guide');
    this.buildSelectGrid();
    for (const id of FLEET_ORDER) {
      const c = document.getElementById('card-' + id);
      if (c) c.classList.toggle('sel-active', id === this.aircraftId);
    }
    this.ui.show('select');
    this.hud.clear();
    this.needsRender = true;
  }

  async pickAircraft(id) {
    if (this.switching) return;
    this.switching = true;
    try {
      const cfg = getAircraftConfig(id);
      this.ui.hide('select');
      if (this.aircraftId !== id || !this.aircraft) {
        const label = 'Loading ' + cfg.name + '…';
        const prog = new LoadTracker(['model', 'flight', 'shaders'], 'aircraft-' + id, (v, l) => this.ui.setProgress(v, l));
        this.ui.resetProgress(label);
        this.ui.show('loading');
        prog.step('model', 0, label);
        await this.breathe();
        this.installAircraft(id, () => prog.step('flight', 0, label));
        prog.step('shaders', 0, 'Compiling shaders…');
        await this.breathe();
        // Uçağın iniş ışığı sahnenin ışık kümesini değiştirir: DÜNYANIN malzemeleri de
        // yeni program ister. Bu yüzden yalnızca uçak değil tüm sahne derlenir.
        await this.precompile(this.scene);
        this.warmupFrame();
        prog.finish('Ready');
        await this.ui.progressSettled();
        prog.save();
        this.ui.hide('loading');
      } else {
        this.physics.reset(spawnPose(this.settings.spawn));
        this.cameraRig.reset();
      }
      this.settings.aircraft = id;
      saveSettings(this.settings);
      this.start();
    } finally {
      this.switching = false;
    }
  }

  // Uçağı kur: eski model, fizik ve ses profili tamamen bırakılır (artık dinleyici/nesne kalmaz)
  // onModelBuilt: model kurulduktan, uçuş sistemleri kurulmadan önce (yükleme göstergesi için)
  installAircraft(id, onModelBuilt) {
    const cfg = getAircraftConfig(id);
    if (this.aircraft) {
      this.scene.remove(this.aircraft.group);
      this.aircraft.dispose();
      this.aircraft = null;
    }
    this.aircraftId = id;
    this.aircraft = cfg.build({ quality: this.settings.quality, livery: this.liveryId(this.aircraftId) });
    this.scene.add(this.aircraft.group);
    if (this.envMap && this.aircraft.setEnvironment) this.aircraft.setEnvironment(this.envMap);
    if (onModelBuilt) onModelBuilt();
    this.physics = new FlightModel(this.world, cfg);
    this.physics.reset(spawnPose(this.settings.spawn));
    this.cameraRig.setAircraft(this.aircraft, cfg);
    this.cameraRig.modeIndex = 0;
    this.cameraRig.reset();
    this.cameraRig.applyMode();
    this.audio.setProfile(cfg.audio);
    this.lightsOn = false;
    this.aircraft.setLandingLights(false);
    this.ui.setToggle(this.ui.el.btnLights, false);
    this.ui.el.btnSpoiler.hidden = !cfg.ui.spoilerButton;
    this.controls.setAfterburnerEnabled(!!cfg.ui.afterburner);
    this.controls.resetLever(0);
    // Flap kolu: kademe adları ve açıları uçaktan gelir, kol her zaman 0'da başlar
    this.controls.setFlapDetents(cfg.systems.flapNames, cfg.systems.flapNotes);
    this.updateToggleButtons();
    this.syncAircraft(0);
    this.cameraRig.update(1, this.physics);
    this.needsRender = true;
  }

  // Seçim ekranı arka planı: üs üzerinde yavaş sinematik kamera
  updateSelectCamera(dt) {
    this.selT = (this.selT || 0.8) + dt * 0.05;
    // Kamera seçili kalkış havalimanının üzerinde döner: hangi üsten kalkacağı görünür
    const ap = AIRPORT_BY_ID[(SPAWNS.find((s) => s.id === this.settings.spawn) || SPAWNS[0]).airport];
    const c = this.camera, r = 360, cx = ap.x - 120, cz = ap.z + 470, cy = ap.elev + 110;
    c.position.set(cx + Math.cos(this.selT) * r, cy + Math.sin(this.selT * 0.6) * 22, cz + Math.sin(this.selT) * r);
    c.up.set(0, 1, 0);
    c.lookAt(cx, ap.elev + 8, cz);
    if (c.fov !== 46) { c.fov = 46; c.updateProjectionMatrix(); }
  }

  start() {
    this.audio.unlock();
    this.audio.setProfile(getAircraftConfig(this.aircraftId).audio);
    this.ui.hide('select');
    this.ui.hide('start');
    this.ui.show('touch');
    this.ui.show('guide');
    if (this.settings.tilt) {
      this.controls.setTiltEnabled(true).then((ok) => { if (!ok) { this.settings.tilt = 0; this.ui.setSeg(this.ui.el.tiltSeg, 't', 0); } });
    }
    if (isIOS() && !isStandalone()) {
      let shown = false;
      try { shown = localStorage.getItem('f35a.hintShown') === '1'; } catch (e) { /* yok */ }
      if (!shown) {
        // Kontroller ekranı kapanana kadar bekle: aksi halde kısa yatay ekranlarda
        // bildirim kontrol metninin tam üstüne oturuyor ve ikisi de okunmuyor.
        this.ui.afterGuide(() => {
          this.ui.show('standaloneHint');
          try { localStorage.setItem('f35a.hintShown', '1'); } catch (e) { /* yok */ }
          setTimeout(() => this.ui.hide('standaloneHint'), 9000);
        });
      }
    }
    this.state = 'running';
    this.controls.setEnabled(true);
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.snapPose();
    this.aq.reset();
    this.checkOrientation();
  }
  pause() {
    this.ui.setMenu(false);
    if (this.state !== 'running') return;
    this.state = 'paused';
    this.controls.setEnabled(false);
    this.ui.show('pause');
    this.needsRender = true;
  }
  resume() {
    if (this.state !== 'paused') return;
    if (this.pausedByOrientation && this.vp.h > this.vp.w) return;
    if (!this.world || this.ui.isOpen('loading')) return;   // kalite değişimi sürüyor
    this.ui.hide('pause');
    this.ui.hide('settings');
    this.state = 'running';
    this.controls.setEnabled(true);
    this.audio.resume();
    this.lastTime = performance.now();
    this.accumulator = 0;
  }
  togglePause() {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }
  restart() {
    this.physics.reset(spawnPose(this.settings.spawn));
    this.lightsOn = false; this.aircraft.setLandingLights(false); this.ui.setToggle(this.ui.el.btnLights, false);
    this.controls.resetLever(0);
    this.controls.setEnabled(true);
    this.cameraRig.reset();
    this.state = 'running';
    this.audio.resume();
    this.updateToggleButtons();
    this.lastTime = performance.now();
    this.accumulator = 0;
    this.syncAircraft(0);
    const sp = SPAWNS.find((s) => s.id === this.settings.spawn) || SPAWNS[0];
    const rwy = String(Math.round(sp.hdg / 10) % 36 || 36).padStart(2, '0');
    const flaps0 = (getAircraftConfig(this.aircraftId).systems.flapNames || ['UP'])[0];
    this.ui.message(`Runway ${rwy} threshold — brakes released, throttle idle, flaps ${flaps0}`);
  }
  toggleGear() {
    if (this.state !== 'running') return;
    if (!this.physics.toggleGear()) {
      this.ui.message('Gear can’t retract on the ground (weight on wheels)', 1800);
      return;
    }
    this.updateToggleButtons();
    this.ui.message(this.physics.gearCmd ? 'Landing gear extending' : 'Landing gear retracting', 1500);
  }
  toggleFlaps() {
    if (this.state !== 'running') return;
    this.physics.toggleFlaps();
    this.updateToggleButtons();
  }
  /** Flap kolundan gelen doğrudan kademe seçimi. */
  setFlapIndex(i) {
    if (this.state !== 'running') return;
    this.physics.setFlapIndex(i);
    this.updateToggleButtons();
  }
  toggleBrake() {
    if (this.state !== 'running') return;
    this.physics.toggleBrakes();
    this.updateToggleButtons();
  }
  updateToggleButtons() {
    const ui = this.ui, p = this.physics;
    if (!p) return;
    ui.setToggle(ui.el.btnGear, p.gearCmd > 0.5);
    ui.setToggle(ui.el.btnBrake, p.brakes);
    ui.setToggle(ui.el.btnSpoiler, p.spoilerCmd > 0.5);
    // Flap kolu fizikteki kademeyi izler (klavye ya da dokunma, fark etmez)
    this.controls.setFlapUI(p.flapIndex);
  }
  toggleSpoilers() {
    if (this.state !== 'running' || !this.physics) return;
    if (!this.physics.sys.spoilers) return;
    this.physics.toggleSpoilers();
    this.updateToggleButtons();
    this.ui.message(this.physics.spoilerCmd ? 'Speed brakes extended' : 'Speed brakes retracted', 1100);
  }
  toggleLights() {
    if (this.state !== 'running') return;
    this.lightsOn = !this.lightsOn;
    this.aircraft.setLandingLights(this.lightsOn);
    this.ui.setToggle(this.ui.el.btnLights, this.lightsOn);
    this.ui.message(this.lightsOn ? 'Landing lights on' : 'Landing lights off', 1200);
  }
  cycleCamera() {
    this.cameraRig.next();
    this.ui.message('Camera: ' + (CAMERA_LABELS[this.cameraRig.mode] || CAMERA_NAMES[this.cameraRig.mode]), 1200);
  }
  toggleSound() {
    this.settings.sound = this.settings.sound ? 0 : 1;
    saveSettings(this.settings);
    this.ui.setSeg(this.ui.el.soundSeg, 's', this.settings.sound);
    this.applySound();
  }

  async setQuality(q) {
    if (!QUALITY_PRESETS[q] || q === this.settings.quality) return;
    this.settings.quality = q;
    saveSettings(this.settings);
    const wasRunning = this.state === 'running';
    if (wasRunning) this.pause();
    this.ui.hide('settings'); this.ui.hide('pause');
    const prog = new LoadTracker([...WORLD_STAGES, 'env', 'shaders'], 'quality-' + q, (v, l) => this.ui.setProgress(v, l));
    this.ui.resetProgress('Applying graphics quality…');
    this.ui.show('loading');
    await this.breathe();
    const preset = QUALITY_PRESETS[q];
    // Kurulum süresince döngü dünyaya dokunmaz (eski dünya bırakıldı, yenisi hazır değil)
    this.world.dispose();
    this.world = null;
    const world = await this.createWorld(q, prog);
    this.world = world;
    this.physics.world = world;
    this.cameraRig.world = world;
    this.aq.set(0); this.aq.reset();      // yeni kalite ön ayarı: uyarlanabilir kademe baştan
    this.renderScale = 1;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
    prog.step('env');
    await this.breathe();
    this.buildEnvironment();
    this.onResize();
    prog.step('shaders');
    await this.breathe();
    await this.precompile(this.scene);
    this.warmupFrame();
    prog.finish('Ready');
    await this.ui.progressSettled();
    prog.save();
    this.ui.hide('loading');
    if (this.state === 'paused') this.ui.show('pause');
    this.needsRender = true;
  }

  // ---- Service worker ----
  registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) this.ui.show('updateToast');
    });
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      this.swRegistration = reg;
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'activated' && hadController) this.ui.show('updateToast');
        });
      });
      // Sürüm bilgisini SW'den al
      const ask = () => {
        const ctrl = navigator.serviceWorker.controller;
        if (!ctrl) return;
        const ch = new MessageChannel();
        ch.port1.onmessage = (e) => {
          if (e.data && e.data.version && e.data.version !== APP_VERSION) this.ui.el.version.textContent = APP_VERSION + ' (cache ' + e.data.version + ')';
        };
        ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      };
      if (navigator.serviceWorker.controller) ask(); else navigator.serviceWorker.addEventListener('controllerchange', ask, { once: true });
      // Periyodik güncelleme denetimi
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((err) => console.warn('Service worker registration failed', err));
  }

  // ---- Döngü ----
  // -------------------------------------------------------------------------
  // Geliştirici fizik paneli (§40). Shift+D ile açılır. Uçuş modelinin ÜRETTİĞİ
  // değerleri gösterir; ayrı bir hesap yapmaz, bu yüzden panel ile fizik asla
  // birbirinden ayrışamaz. Kapalıyken hiçbir maliyeti yoktur.
  // -------------------------------------------------------------------------
  togglePhysDebug() {
    this.physDebug = !this.physDebug;
    const el = document.getElementById('physdbg');
    if (el) el.hidden = !this.physDebug;
    if (!this.physDebug && el) el.textContent = '';
    this.ui.message(this.physDebug ? 'Physics panel on (Shift+D)' : 'Physics panel off');
  }

  drawPhysDebug() {
    const el = document.getElementById('physdbg');
    if (!el) return;
    // Panel 10 Hz tazelenir: her karede DOM yazmak gereksiz.
    this._dbgT = (this._dbgT || 0) + 1;
    if (this._dbgT % 6) return;
    const p = this.physics, d = p.debug || {}, T = p.telemetry || {}, f = d.fcs || {};
    const DEGR = 180 / Math.PI;
    const n = (v, k = 2) => (Number.isFinite(v) ? v.toFixed(k) : '—');
    const kN = (v) => (Number.isFinite(v) ? (v / 1000).toFixed(1) : '—');
    const L = [];
    // Oyuncuya görünen her yazı İngilizcedir; bu panel de açılabildiği için buna dahildir.
    L.push(`<b>AIR</b>    TAS ${n(T.ktas, 0)} kt   IAS ${n(T.kias, 0)} kt   M ${n(T.mach, 3)}`);
    L.push(`       alt ${n(T.altFt, 0)} ft   q̄ ${n(d.qbar, 0)} Pa   VS ${n(T.vsFpm, 0)} ft/min`);
    L.push(`<b>FLOW</b>   α ${n(T.alpha, 2)}°   β ${n(T.beta, 2)}°   nz ${n(T.g, 2)} g`);
    L.push(`<b>RATES</b>  p ${n(p.rates.p * DEGR, 1)}  q ${n(p.rates.q * DEGR, 1)}  r ${n(p.rates.r * DEGR, 1)} °/s`);
    L.push(`<b>ATT</b>    φ ${n(T.roll, 1)}°  θ ${n(T.pitch, 1)}°  ψ ${n(T.heading, 0)}°`);
    L.push(`<b>COEFF</b>  CL ${n(d.CL, 3)}  CD ${n(d.CD, 4)}  CY ${n(d.CY, 4)}`);
    L.push(`       Cl ${n(d.Cl, 4)}  Cm ${n(d.Cm, 4)}  Cn ${n(d.Cn, 4)}`);
    L.push(`<b>FORCE</b>  L ${kN(d.Lift)}  D ${kN(d.Drag)}  Y ${kN(d.Side)} kN`);
    L.push(`<b>MOMENT</b> L ${kN(d.Lm)}  M ${kN(d.Mm)}  N ${kN(d.Nm)} kN·m`);
    L.push(`  gyro   L ${kN(d.Lgyro)}  M ${kN(d.Mgyro)}  N ${kN(d.Ngyro)} kN·m`);
    L.push(`<b>THRUST</b> ${kN(d.thrust)} kN   mass ${n(d.mass, 0)} kg   fuel ${n(p.fuel, 0)} kg`);
    L.push(`<b>SURF</b>   δe ${n(d.de)}  δa ${n(d.da)}  δr ${n(d.dr)}`);
    L.push(`<b>FCS</b>    qCmd ${n(f.qCmd * DEGR, 1)}  pCmd ${n(f.pCmd * DEGR, 1)}  rCmd ${n(f.rCmd * DEGR, 1)} °/s`);
    L.push(`       pMax ${n(f.pMax * DEGR, 0)}°/s  nTarget ${n(f.nTarget)}  nAvail ${n(f.nAvail)}`);
    L.push(`       αCmd ${n(f.aCmd * DEGR, 1)}°  g-blend ${n(f.wG)}  authority ${n(f.auth)}`);
    L.push(`<b>AERO</b>   separation ${n(d.sepFrac)}  tailEff ${n(d.tailEff)}  CLmax ${n(d.CLmaxCfg)}`);
    L.push(`       αtrim ${n(d.alphaTrim * DEGR, 1)}°  onGround ${p.onGround ? 'yes' : 'no'}  rateClamp ${d.rateClamped ? 'YES' : 'no'}`);
    el.innerHTML = L.join('\n');
  }

  /** Çizim pozunu son iki fizik durumu arasında kurar (a: 0..1, adım kesri). */
  interpolatePose(a) {
    const p = this.physics, pose = this.pose;
    // Işınlanma (yeniden başlatma, uçak değişimi): aradaki yol enterpole edilmez
    if (this._prevPos.distanceToSquared(p.pos) > 400 * 400) { this.snapPose(); return; }
    a = a < 0 ? 0 : a > 1 ? 1 : a;
    pose.pos.lerpVectors(this._prevPos, p.pos, a);
    pose.quat.slerpQuaternions(this._prevQuat, p.quat, a);
  }
  snapPose() {
    const p = this.physics;
    this._prevPos.copy(p.pos); this._prevQuat.copy(p.quat);
    this.pose.pos.copy(p.pos); this.pose.quat.copy(p.quat);
  }

  // dt = 0: anlık eşitleme (yeniden başlatma, kurulum) — poz fiziğe oturtulur
  syncAircraft(dt) {
    const p = this.physics;
    if (dt === 0) this.snapPose();
    const pose = this.pose;
    this.aircraft.group.position.copy(pose.pos);
    this.aircraft.group.quaternion.copy(pose.quat);
    // Amortisör sıkışması kadar gövde alçalır, tekerlekler pistte kalır (yalnızca görsel)
    const gc = p.gearComp || 0;
    if (gc) this.aircraft.group.position.y -= gc;
    const sf = p.surfaces, A = this._acArgs;
    // Argüman nesnesi her karede yeniden kullanılır (tahsis yok)
    A.elevator = sf.elevator; A.aileron = sf.aileron; A.rudder = sf.rudder;
    A.lef = p.lefPos || 0; A.flaperon = p.tefPos || 0; A.toeIn = p.toeIn || 0;
    A.flaps = p.flapsPos; A.slats = p.slatsPos; A.spoilers = p.spoilerPos; A.gear = p.gearPos;
    A.throttle = p.engine; A.engine = p.engine; A.afterburner = p.abLevel; A.reverse = p.reversePos; A.time = p.time;
    A.nozzle = p.engine_.nozzle !== undefined ? p.engine_.nozzle : p.engine;
    A.groundSpeed = p.onGround ? p.vel.length() : 0; A.dt = dt; A.gearComp = gc;
    A.camDist = this.camera.position.distanceTo(pose.pos);
    this.aircraft.update(A);
  }

  // ---- 60 fps kilidi ----
  // Hedef zaman ileri taşınır (sürüklenme yok): 60 Hz ekranda hiçbir kare atlanmaz, 120/144 Hz ekranda
  // fazla kareler atlanır ve ortalama tam 60 fps olur. Cihaz 60'ı tutturamıyorsa kare eklenmez.
  // Fizik bundan bağımsız: 120 Hz sabit adım.
  framePacer(now) {
    if (!this.nextRender) this.nextRender = now;
    if (now < this.nextRender - 1) return false;
    this.nextRender += this.frameMs;
    if (this.nextRender < now - this.frameMs) this.nextRender = now + this.frameMs; // arka plandan dönüş / uzun takılma
    return true;
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.contextLost) return;
    if (!this.framePacer(now)) return;   // 60 fps kilidi
    // Bazı tarayıcılar döndürmede resize olayını geç/eksik gönderir: boyutu her karede
    // doğrula (değiştiyse görüntü alanı modülü onResize'ı çağırır)
    this.vp.measure();
    if (!this.world) { this.lastTime = now; return; }   // kalite değişimi: dünya yeniden kuruluyor
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!(dt > 0)) dt = 0;
    const frameDt = dt;     // ölçüm için ham kare aralığı
    if (dt > 0.1) dt = 0.1; // arka plandan dönüşte sıçramayı sınırla (fizik "ölüm sarmalı" da önlenir)
    const running = this.state === 'running';

    // Uçak seçim ekranı: henüz uçak yok, arka planda üs üzerinde sinematik kamera döner
    if (!this.physics || this.state === 'select') {
      this.updateSelectCamera(dt);
      this.world.update(dt, this.camera, this.camera.position);
      this.renderer.render(this.scene, this.camera);
      this.hud.clear();
      this.needsRender = false;
      this.audio.update(dt, null, false);
      return;
    }

    if (running) {
      // Flap kolu kademesi değiştiyse düğme etiketini tazele (kademe fizik tarafından da değişebilir)
      if (this.physics.flapIndex !== this._lastFlapIndex) { this._lastFlapIndex = this.physics.flapIndex; this.updateToggleButtons(); }
      this.controls.update(dt);
      const c = this.controls.state;
      this.physics.setControls({ pitch: c.pitch, roll: c.roll, yaw: c.yaw, throttle: c.throttle, afterburner: c.afterburner });
      this.accumulator += dt;
      let steps = 0;
      const p = this.physics;
      while (this.accumulator >= FIXED_DT && steps < 12) {
        this._prevPos.copy(p.pos); this._prevQuat.copy(p.quat);
        p.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      // Bir karede en fazla 12 adım (0,1 s): yavaş cihazda biriken açık atılır, fizik
      // kendi kendini besleyen bir gecikme sarmalına girmez.
      if (steps >= 12) this.accumulator = 0;
      this.interpolatePose(this.accumulator / FIXED_DT);
      if (this.physics.crashed) {
        this.state = 'crashed';
        this.controls.setEnabled(false);
        this.ui.showCrash(this.physics.crashReason);
      }
      this.syncAircraft(dt);
      this.cameraRig.update(dt, this.pose);
      if (this.physDebug) this.drawPhysDebug();
    }
    if (running || this.needsRender) {
      this.world.setWind(this.physics.windAt(this.physics.groundY + 8, this.physics.time), this.physics.wind.kt);
      this.world.update(running ? dt : 0, this.camera, this.pose.pos);
      this.renderer.render(this.scene, this.camera);
      const cockpit = this.cameraRig.mode === 'cockpit';
      const style = getAircraftConfig(this.aircraftId).hud;
      this.hud.draw(this.physics.telemetry, this.camera, this.pose, {
        visible: cockpit, externalOnly: !cockpit, style, extended: style === 'airliner',
        dt, safe: this.safe, cameraName: CAMERA_NAMES[this.cameraRig.mode],
      });
      this.needsRender = false;
    }
    this.audio.setListener(this.cameraRig.mode === 'cockpit' ? 'cockpit' : 'external', this.cameraRig.doppler, this.cameraRig.distance);
    this.audio.update(dt, this.physics.telemetry, running);
    // ---- Uyarlanabilir kalite (perf.js): ham kare aralığıyla, yalnızca uçuşta ölçülür ----
    if (running) this.aq.sample(frameDt, this.frameMs);
    // FPS göstergesi
    if (this.settings.fps) {
      this.frameCount++; this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        const sc = this.aq.tier > 0 ? ' · ' + this.aq.label : '';
        this.ui.el.fps.textContent = Math.round(this.frameCount / this.fpsTime) + '/' + this.targetFps + ' fps' + sc + ' · ' + this.renderer.info.render.calls + ' draws';
        this.frameCount = 0; this.fpsTime = 0;
      }
    }
  }
}

window.__app = new App();
