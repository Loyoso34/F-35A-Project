// F-35A Simülatör – uygulama giriş noktası.
import * as THREE from 'three';
import { APP_VERSION } from './version.js';
import { World, LAYER_TREES, QUALITY_PRESETS, WATER_LEVEL } from './world.js';
import { GeoWorld, bodrumSpawnInfo } from './geoworld.js';
import { LTFE } from './georegion.js';
import { F35 } from './aircraft.js';
import { fmtDMS } from './geo.js';
import { HAZE_UNIFORMS } from './worldshade.js';
import { TIME_ORDER } from './sun.js';
import { fmtCrashData } from './crash.js';
import { FlightModel, FIXED_DT, DEFAULT_WIND } from './physics.js';
import { FLEET, FLEET_ORDER, getAircraftConfig } from './fleet.js';
import { Controls, STICK_SMOOTH } from './controls.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { CameraRig, CAMERA_NAMES, CAMERA_LABELS } from './cameras.js';
import { liveriesFor, defaultLiveryId } from './liveries.js';
import { UI, isStandalone, isIOS, loadSettings, saveSettings } from './ui.js';
import { AdaptiveQuality, perfMultipliers } from './perf.js';
import { PerfOverlay } from './perfoverlay.js';
import { WeaponSystem } from './weapons.js';
import { LAYER_NOREFLECT } from './ocean.js';
import { FlightAlerts, FUEL_LOW_KG } from './alerts.js';

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
  geodata: 2600, ltfe: 300, features: 1500, ocean: 60,
  core: 1400, design: 900, coretex: 1600,
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
  previews: 'Rendering aircraft preview…',
  shaders: 'Compiling shaders…',
  geodata: 'Streaming regional terrain and Sentinel-2 imagery…',
  core: 'Shaping the Bodrum peninsula (20 × 20 km)…',
  design: 'Laying out the city, harbour and roads…',
  coretex: 'Baking terrain lighting and materials…',
  city: 'Building Bodrum: castle, marina, skyline…',
  ltfe: 'Building Milas–Bodrum Airport (LTFE)…',
  features: 'Placing buildings, roads and trees…',
  ocean: 'Adding the Aegean Sea…',
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

// Bölgeler: gerçek dünya (Bodrum, varsayılan) ve kurgusal eğitim bölgesi. Kalkış noktası bölgeyi
// belirler; bölge değişince dünya yeniden kurulur (kalite değişimiyle aynı yol).
const REGIONS = {
  bodrum: { World: GeoWorld, stages: GeoWorld.STAGES, label: 'Loading Bodrum region…' },
  training: { World, stages: WORLD_STAGES, label: 'Loading the training area…' },
};
// v4.0: simülatörde YALNIZCA Milas–Bodrum (LTFE) vardır. Kurgusal eğitim bölgesi (World) GeoWorld'ün
// temel sınıfı ve başsız testleri için kodda kalır, arayüzden seçilemez; bölge verisi
// alınamazsa (ör. ilk açılış çevrimdışı) yükleme ekranı yeniden denemeyi önerir.
const ALL_SPAWNS = bodrumSpawnInfo();
const spawnDesc = (id) => ALL_SPAWNS.find((s) => s.id === id) || ALL_SPAWNS[0];
const thousandsKg = (n) => Math.round(n).toLocaleString('en-US') + ' kg';
const PREVIEW_COMP = 0.07;                 // önizleme: park hâlinde amortisör sıkışması (fizik reset ile aynı)
const _prevEuler = new THREE.Euler();

class App {
  constructor() {
    this.ui = new UI();
    this.settings = loadSettings();
    this.state = 'loading'; // loading | start | running | paused | crashing (kaza sahnesi) | crashed (sonuç ekranı)
    this.pausedByOrientation = false;
    this.accumulator = 0; this._stickSynced = false;
    this._weaponsT = null;   // silah saati: çizilen poz saati (fizik zamanı + artık), bkz. loop
    this.lastTime = 0;
    this.frameCount = 0; this.fpsTime = 0;
    // 60 fps kilidi: hedef kare zamanı (sürüklenmesiz), uyarlanabilir çözünürlük durumu
    this.targetFps = 60;
    this.frameMs = 1000 / 60;
    this.nextRender = 0;
    this.renderScale = 1;      // kalite ön ayarının piksel oranına uygulanan çarpan (0.8–1)
    this.perfOverlay = new PerfOverlay(document.getElementById('perfdbg'));
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
    const region = spawnDesc(this.settings.spawn).region;
    const stages = ['gfx', ...REGIONS[region].stages, 'env', 'systems', 'previews', 'shaders'];
    const prog = new LoadTracker(stages, 'boot-' + region + '-' + this.settings.quality, (v, label) => ui.setProgress(v, label));
    ui.resetProgress(LOAD_LABEL.gfx);
    prog.step('gfx');
    await this.breathe();
    this.setupRenderer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 60000);
    this.camera.layers.enable(LAYER_TREES);
    this.camera.layers.enable(LAYER_NOREFLECT);   // yollar, şemsiyeler, çalılar: deniz yansımasına girmez
    this.scene.add(this.camera);
    this.onResize();
    prog.end('gfx');

    this.world = await this.createWorld(this.settings.quality, prog, region);

    prog.step('env');
    await this.breathe();
    this.buildEnvironment();
    prog.end('env');

    prog.step('systems');
    await this.breathe();
    this.aircraft = null; this.physics = null; this.aircraftId = null;
    this.hud = new HUD(this.hudCanvas);
    this.audio = new AudioEngine();
    this.alerts = new FlightAlerts();
    this._alertList = [];
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
      onFire: () => this.fireMissile(),
      onPhysDebug: () => this.togglePhysDebug(),
      onHelp: () => this.toggleGuide(),
      onGamepadStart: () => this.gamepadStart(),
      onGamepad: (id, on) => this.ui.message(on ? 'Controller connected — left stick flies, triggers throttle, Start pauses' : 'Controller disconnected', on ? 3200 : 1800),
      onPerfDebug: () => this.togglePerfDebug(),
      onMenu: () => this.ui.toggleMenu(),
      onMenuActivity: () => this.ui.menuActivity(),
      onViewDrag: (dx, dy) => this.cameraRig.drag(dx, dy),
      onViewPinch: (f) => this.cameraRig.zoom(f),
      onViewRecenter: () => this.cameraRig.recenterLook(),
    });
    // Silah sistemi: füze havuzu, iz şeritleri ve efekt malzemeleri burada (yükleme ekranında)
    // sahneye eklenir; gölgelendiricileri aşağıdaki ön derlemeye girer, uçuşta takılma olmaz.
    this.weapons = new WeaponSystem(this.scene, this.world, this.audio, this.cameraRig, {
      onState: (i) => this.updateFireButton(i),
      message: (t) => this.ui.message(t, 1600),
    });
    this.bindUI();
    this.bindSystem();
    this.onResize();
    this.applySettingsToUI();
    prog.end('systems');

    prog.step('previews');
    await this.breathe();
    this.buildPreview();
    prog.end('previews');

    prog.step('shaders');
    await this.breathe();
    this.updateSelectCamera(0);
    this.world.update(0, this.camera, this.camera.position);
    if (this.world.prewarm) this.world.prewarm(this.camera);
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
  async createWorld(quality, prog, region = 'bodrum') {
    const WC = (REGIONS[region] || REGIONS.bodrum).World;
    const world = new WC(this.scene, this.renderer, quality, { defer: true });
    try {
      await world.build((id, frac) => prog.step(id, frac), () => this.breathe());
    } catch (e) {
      // Bölge verisi alınamadı (çevrimdışı, önbellekte yok). Kurgusal bir meydana geçilmez:
      // yükleme ekranı nedeni ve yeniden deneme düğmesini gösterir.
      world.dispose();
      throw new Error('Bodrum terrain data could not be loaded. Check the connection and tap Reload. (' + (e && e.message ? e.message : e) + ')');
    }
    this.applyTimeOfDay(world);
    // Uzak düzlem bölgeye göre (gerçek dünyada ufuk yüzlerce km)
    this.camera.far = world.cameraFar;
    this.camera.updateProjectionMatrix();
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
  /**
   * Silah efektlerinin (füze, alev, iz, parçacıklar, yer izi) ilk ÇİZİMİ de yükleme ekranında
   * yapılır. Uçuş sahnesinde yapılmalıdır: uçağın iniş ışığı sahnenin ışık kümesini değiştirir
   * ve GPU boru hattı durumları uçuş sahnesine özgüdür (hangar sahnesinde ısıtmak yetmiyordu,
   * ilk atışta takılma kalıyordu). Ardından temiz bir kare çizilir: aynı görev içinde olduğu için
   * ekrana yalnızca o gider, ısıtma nesneleri hiç görünmez.
   */
  weaponsWarmup() {
    if (!this.weapons) return;
    try {
      this.weapons.warmup(this.renderer, this.scene, this.camera);
      this.renderer.render(this.scene, this.camera);
    } catch (e) { console.warn('Weapons warm-up skipped', e); }
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
      const nk = this.world && this.world.nightK ? this.world.nightK : 0;
      this.scene.environmentIntensity = 0.55 * (1 - 0.75 * nk);
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
    if (el.btnCrashHangar) el.btnCrashHangar.addEventListener('click', () => { ui.hide('crash'); this.clearCrash(); this.showSelect(); });
    el.btnUpdate.addEventListener('click', () => { window.__ffsAllowUnload = true; location.reload(); });
    if (el.btnControls) el.btnControls.addEventListener('click', () => this.toggleGuide());
    ui.bindSeg(el.qualitySeg, 'q', (v) => this.setQuality(v));
    ui.bindSeg(el.tiltSeg, 't', async (v) => {
      const on = v === '1';
      const ok = await this.controls.setTiltEnabled(on);
      if (on && !ok) { ui.setSeg(el.tiltSeg, 't', 0); ui.message('Motion access denied — tilt steering is off'); this.settings.tilt = 0; }
      else this.settings.tilt = on ? 1 : 0;
      saveSettings(this.settings);
    });
    ui.bindSeg(el.soundSeg, 's', (v) => { this.settings.sound = v === '1' ? 1 : 0; saveSettings(this.settings); this.applySound(); });
    ui.bindSeg(el.fpsSeg, 'f', (v) => { this.settings.fps = v === '2' ? 2 : v === '1' ? 1 : 0; saveSettings(this.settings); el.fps.textContent = ''; this.perfOverlay.setOn(this.settings.fps === 2); });
    if (el.fovSeg) ui.bindSeg(el.fovSeg, 'v', (v) => { this.settings.fov = v; saveSettings(this.settings); this.applyFov(); });
    if (el.todSeg) ui.bindSeg(el.todSeg, 'd', (v) => {
      this.settings.tod = v; saveSettings(this.settings);
      this.applyTimeOfDay();
      this.syncTodChips();
      this.updateBriefing();
    });
    el.btnCalibrate.addEventListener('click', () => { this.controls.calibrate(); ui.message('Tilt calibrated'); });
  }
  applySettingsToUI() {
    const ui = this.ui, el = ui.el;
    ui.setSeg(el.qualitySeg, 'q', this.settings.quality);
    ui.setSeg(el.tiltSeg, 't', this.settings.tilt);
    ui.setSeg(el.soundSeg, 's', this.settings.sound);
    ui.setSeg(el.fpsSeg, 'f', this.settings.fps);
    this.perfOverlay.setOn(this.settings.fps === 2);
    if (el.fovSeg) ui.setSeg(el.fovSeg, 'v', this.settings.fov || 'normal');
    if (el.todSeg) ui.setSeg(el.todSeg, 'd', this.settings.tod || 'default');
    this.applyFov();
    this.applySound();
    if (this.physics) this.updateToggleButtons();
  }
  /** Kamera görüş açısı ayarı: tüm kiplerin FOV'u bu çarpanla ölçeklenir (yalnızca görsel). */
  applyFov() {
    const k = { narrow: 0.86, normal: 1, wide: 1.16 }[this.settings.fov] || 1;
    if (!this.cameraRig) return;
    this.cameraRig.fovScale = k;
    if (this.physics && !this.cameraRig.crash) this.cameraRig.applyMode();
    this.needsRender = true;
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
        this.accumulator = 0; this._stickSynced = false;
        if (this.state !== 'start') this.audio.resume();
      }
    });
    window.addEventListener('pagehide', () => { if (this.state === 'running') this.pause(); });
    // Uçuş sürerken sayfadan çıkış onayı: klavyede Ctrl (gaz azalt) + W (burun aşağı) tarayıcıda
    // sekmeyi KAPATIR ve bu kısayol sayfa tarafından engellenemez. Bilinçli yenilemeler
    // (güncelleme, yeniden deneme) window.__ffsAllowUnload ile bu onayı atlar.
    window.addEventListener('beforeunload', (e) => {
      if (window.__ffsAllowUnload) return;
      if (this.state !== 'running' && this.state !== 'paused') return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  /** Oyun kumandasının Start düğmesi: görev hazırlığında uç, kazadan sonra yeniden başlat, uçuşta duraklat/devam. */
  gamepadStart() {
    if (this.state === 'select') { if (this.loaded && !this.switching && !this.ui.isOpen('loading')) this.pickAircraft(FLEET_ORDER[0]); return; }
    if (this.state === 'crashed') { this.ui.hide('crash'); this.restart(); return; }
    this.togglePause();
  }

  /** Kontroller ekranı (H tuşu / duraklatma menüsü). */
  toggleGuide() {
    if (this.ui.isOpen('guide')) { this.ui.hide('guide'); return; }
    if (this.state !== 'running' && this.state !== 'paused') return;
    if (this.state === 'paused') {
      // Duraklatma menüsü kontrollerin önündedir: menü kapanır, kontroller kapanınca geri gelir
      this.ui.hide('pause');
      this.ui.show('guide');
      this.ui.afterGuide(() => { if (this.state === 'paused') this.ui.show('pause'); });
      return;
    }
    this.ui.show('guide');
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
  /**
   * Görev hazırlığı ekranı (v4.0): tek uçak (F-35A) ve tek meydan (LTFE) için brifing panelleri.
   * Tüm sayılar yayımlanmış/kaynaklı değerlerdir ya da simülatörün kendi ayarıdır (ör. rüzgâr).
   */
  buildSelectGrid() {
    const el = this.ui.el;
    if (!el.mpSpecs || el.mpSpecs.childElementCount) return;
    const dl = (host, rows) => {
      host.textContent = '';
      for (const [k, v] of rows) {
        const dt = document.createElement('dt'); dt.textContent = k;
        const dd = document.createElement('dd'); dd.textContent = v;
        host.append(dt, dd);
      }
    };
    // Uçak: USAF F-35A bilgi sayfası / Lockheed Martin yayımlanmış değerleri (PUBLIC_DATA_SOURCES.md)
    const n = this.weapons ? this.weapons.stations.length : 0;
    dl(el.mpSpecs, [
      ['Engine', 'P&W F135-PW-100'],
      ['Thrust class', '43,000 lbf (AB)'],
      ['Length · span', `${F35.length.toFixed(2)} · ${F35.span.toFixed(2)} m`],
      ['Height', `${F35.height.toFixed(2)} m`],
      ['Internal fuel', '8,278 kg'],
      ['Max speed', 'Mach 1.6'],
      ['Loadout (sim)', n ? `AIM-120 ×${n}` : 'AIM-120'],
    ]);
    this._mpDl = dl;
    // Gün saati: Ayarlar'daki seçimle aynı ayar
    if (el.mpTod && !el.mpTod.childElementCount) {
      for (const [k, lbl] of TIME_ORDER) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'mp-chip'; b.dataset.d = k; b.textContent = lbl;
        b.addEventListener('click', () => this.setTimeOfDayKey(k));
        el.mpTod.appendChild(b);
      }
    }
    const w = DEFAULT_WIND;
    dl(el.mpWx, [['Wind (sim)', `${String(w.dirDeg).padStart(3, '0')}° / ${w.kt} kt, gusts ${w.kt + w.gustKt} kt`]]);
    this.syncTodChips();
    if (el.btnFly && !el.btnFly._bound) { el.btnFly._bound = true; el.btnFly.addEventListener('click', () => this.pickAircraft(FLEET_ORDER[0])); }
    this.buildSpawnRow();
    this.buildLiveryRows();
    this.updateBriefing();
  }

  /** Gün saati ayarı (görev hazırlığı ve Ayarlar aynı değeri paylaşır). */
  setTimeOfDayKey(k) {
    this.settings.tod = k; saveSettings(this.settings);
    if (this.ui.el.todSeg) this.ui.setSeg(this.ui.el.todSeg, 'd', k);
    this.applyTimeOfDay();
    this.syncTodChips();
    this.updateBriefing();
  }
  syncTodChips() {
    const host = this.ui.el.mpTod, k = this.settings.tod || 'default';
    if (host) for (const b of host.children) b.classList.toggle('on', b.dataset.d === k);
  }

  /** Pist brifingi ve meydan şeması: seçili kalkış ucuna göre (OSM/OurAirports geometrisi). */
  updateBriefing() {
    const el = this.ui.el;
    const sp = spawnDesc(this.settings.spawn);
    const id = this.settings.spawn;
    const w = this.world;
    const geo = w && w.spawnPose && w.ltfe ? w : null;
    const rw = LTFE.runways[0];
    const end0 = id === 'ltfe-28r' ? rw.ends[1] : rw.ends[0];
    const magVar = w && w.magVar !== undefined ? w.magVar : 0;
    const mag = (h) => String(Math.round((((h - magVar) % 360) + 360) % 360) || 360).padStart(3, '0');
    const hdg = id === 'ltfe-28r' ? (rw.hdg + 180) % 360 : rw.hdg;
    if (el.mpRwy && this._mpDl) {
      this._mpDl(el.mpRwy, [
        ['Runway', `${sp.runway} · ${rw.lengthM} × ${rw.width} m`],
        ['Heading', `${mag(hdg)}° M`],
        ['Threshold elev.', `${end0.elevFt} ft`],
        ['Start', 'Lined up, 100 m in'],
      ]);
    }
    const tod = (TIME_ORDER.find(([k]) => k === (this.settings.tod || 'default')) || TIME_ORDER[2])[1];
    if (el.flySub) el.flySub.textContent = `Runway ${sp.runway} · ${tod}`;
    if (el.mpMap && geo) this.drawAirportMap(el.mpMap, geo, id);
  }

  /** Meydan şeması (SVG, kuzey yukarı): apronlar, taksi yolları, pistler, kalkış noktası. */
  drawAirportMap(svg, w, spawnId) {
    const A = w.ltfe, rws = LTFE.runways;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of rws) for (const p of [r.A, r.B]) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    for (const poly of A.aprons) for (const p of poly) { z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
    const W = 300, H = 96, pad = 10;
    const sc = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (z1 - z0));
    const ox = (W - (x1 - x0) * sc) / 2, oz = (H - (z1 - z0) * sc) / 2;
    const X = (x) => (ox + (x - x0) * sc).toFixed(1), Y = (z) => (oz + (z - z0) * sc).toFixed(1);
    const parts = [];
    for (const poly of A.aprons) parts.push(`<polygon points="${poly.map((p) => X(p.x) + ',' + Y(p.z)).join(' ')}" fill="rgba(203,211,221,0.16)" stroke="rgba(203,211,221,0.28)" stroke-width="0.5"/>`);
    let d = '';
    for (const g of A.segs) d += `M${X(g.ax)} ${Y(g.az)}L${X(g.bx)} ${Y(g.bz)}`;
    parts.push(`<path d="${d}" stroke="rgba(203,211,221,0.42)" stroke-width="1.4" fill="none" stroke-linecap="round"/>`);
    for (const b of A.buildings) if ((b.area || 0) > 1500) parts.push(`<polygon points="${b.pts.map((p) => X(p.x) + ',' + Y(p.z)).join(' ')}" fill="rgba(156,180,206,0.35)"/>`);
    for (const r of rws) {
      const hw = r.width / 2, nx = -r.uz * hw, nz = r.ux * hw;
      const q = [[r.A.x + nx, r.A.z + nz], [r.B.x + nx, r.B.z + nz], [r.B.x - nx, r.B.z - nz], [r.A.x - nx, r.A.z - nz]];
      parts.push(`<polygon points="${q.map(([x, z]) => X(x) + ',' + Y(z)).join(' ')}" fill="rgba(245,247,250,0.88)" stroke="rgba(245,247,250,0.9)" stroke-width="1.6"/>`);
      const lbl = (p, e, dir) => parts.push(`<text x="${(+X(p.x) - dir * 11).toFixed(1)}" y="${(+Y(p.z) + 3).toFixed(1)}" font-size="7" fill="#cbd3dd" text-anchor="middle" font-family="-apple-system,Segoe UI,sans-serif">${e.num}${e.suffix}</text>`);
      lbl(r.A, r.ends[0], 1); lbl(r.B, r.ends[1], -1);
    }
    // Kalkış noktası: pist ekseninde, kalkış yönünü gösteren üçgen
    const sp = w.spawnPose(spawnId), h = sp.hdg * Math.PI / 180, fx = Math.sin(h), fz = -Math.cos(h);
    const cx = +X(sp.x), cz = +Y(sp.z);
    const tri = [[cx + fx * 7, cz + fz * 7], [cx - fx * 4 - fz * 4, cz - fz * 4 + fx * 4], [cx - fx * 4 + fz * 4, cz - fz * 4 - fx * 4]];
    parts.push(`<polygon points="${tri.map(([a, b]) => a.toFixed(1) + ',' + b.toFixed(1)).join(' ')}" fill="#9cc3e8" stroke="#05080c" stroke-width="0.6"/>`);
    parts.push(`<text x="${W - 6}" y="12" font-size="7" fill="#9cb4ce" text-anchor="end" font-family="-apple-system,Segoe UI,sans-serif">N ↑</text>`);
    svg.innerHTML = parts.join('');
  }

  liveryId(aircraftId) {
    const list = liveriesFor(aircraftId);
    if (!list.length) return null;
    const saved = (this.settings.livery || {})[aircraftId];
    return list.some((l) => l.id === saved) ? saved : defaultLiveryId(aircraftId);
  }

  /** Hangarda livery çip satırını üretir. */
  buildLiveryRows() {
    const host = this.ui.el.selLivery;
    if (!host || host.childElementCount) return;
    const acId = FLEET_ORDER[0];
    for (const lv of liveriesFor(acId)) {
      const b = document.createElement('button');
      b.className = 'lv-chip'; b.type = 'button'; b.id = 'lv-' + acId + '-' + lv.id;
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = lv.name;
      b.querySelector('span').textContent = lv.sub || '';
      b.addEventListener('click', () => this.setLivery(acId, lv.id));
      host.appendChild(b);
    }
    this.setLivery(acId, this.liveryId(acId), true);
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
    // Görev hazırlığındaki 3B önizlemeyi yeni boyayla yeniden kur
    if (this.state === 'select') this.buildPreview();
    // Halihazırda uçulan uçak buysa modeli yeni boyayla yeniden kur
    if (this.aircraft && this.aircraftId === aircraftId) this.reskinAircraft();
  }

  // Kalkış pisti seçici (yalnızca LTFE: 10L ve 28R kalkış uçları)
  buildSpawnRow() {
    const row = this.ui.el.selApRow;
    if (!row || row.childElementCount) return;
    for (const sp of ALL_SPAWNS) {
      const b = document.createElement('button');
      b.className = 'ap-chip'; b.type = 'button'; b.id = 'ap-' + sp.id;
      b.innerHTML = '<b></b><span></span>';
      b.querySelector('b').textContent = sp.runway;
      b.querySelector('span').textContent = sp.id === 'ltfe-28r' ? 'Westbound' : 'Eastbound';
      b.setAttribute('aria-label', 'Runway ' + sp.runway);
      b.addEventListener('click', () => this.setSpawn(sp.id));
      row.appendChild(b);
    }
    this.setSpawn(this.settings.spawn || ALL_SPAWNS[0].id, true);
  }

  setSpawn(id, quiet) {
    if (!ALL_SPAWNS.some((s) => s.id === id)) id = ALL_SPAWNS[0].id;
    this.settings.spawn = id;
    if (!quiet) saveSettings(this.settings);
    for (const sp of ALL_SPAWNS) {
      const b = document.getElementById('ap-' + sp.id);
      if (b) b.classList.toggle('on', sp.id === id);
    }
    this.updateBriefing();
    this.placePreview();
  }

  /**
   * Görev hazırlığının 3B önizlemesi: seçili pist ucunda park hâlinde F-35A (takım açık, seyir
   * ışıkları yanar). Uçuşta kullanılan modelden ayrı bir örnektir; uçuşta gizlenir.
   */
  buildPreview() {
    if (!this.scene || !this.world) return;
    const id = FLEET_ORDER[0], cfg = FLEET[id];
    if (this.previewAc) { this.scene.remove(this.previewAc.group); this.previewAc.dispose(); this.previewAc = null; }
    let ac;
    try { ac = cfg.build({ quality: this.settings.quality, livery: this.liveryId(id) }); } catch (e) { console.warn('preview could not be built', e); return; }
    if (this.envMap && ac.setEnvironment) ac.setEnvironment(this.envMap);
    ac.group.name = 'F-35A-preview';
    ac.group.visible = this.state !== 'running';
    this.scene.add(ac.group);
    this.previewAc = ac;
    this.placePreview();
    if (this.renderer && this.state === 'select') this.precompile(ac.group);
  }
  placePreview() {
    const ac = this.previewAc, w = this.world;
    if (!ac || !w || !w.spawnPose) return;
    const sp = w.spawnPose(this.settings.spawn);
    const gy = w.heightAt(sp.x, sp.z);
    ac.group.position.set(sp.x, gy - F35.wheelBottomY - PREVIEW_COMP, sp.z);
    ac.group.quaternion.setFromEuler(_prevEuler.set(0, -sp.hdg * Math.PI / 180, 0));
    ac.group.updateMatrixWorld(true);
    this.selTarget = (this.selTarget || new THREE.Vector3()).copy(ac.group.position);
    this.selHdg = sp.hdg;
    this.needsRender = true;
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
    this.weapons.attach(ac, this.physics);   // envanter (atılmış füzeler) yeni modele uygulanır
    if (ac.setLandingLights) ac.setLandingLights(this.lightsOn);
    if (this.physics) this.syncAircraft(0);
    // Yeni boya malzemeleri: seçim ekranındayken arka planda derlenir
    this.precompile(ac.group);
    this.needsRender = true;
  }

  showSelect() {
    if (this.state === 'running') this.controls.setEnabled(false);
    if (this.crashSeq || (this.cameraRig && this.cameraRig.crash)) this.clearCrash();
    this.state = 'select';
    if (this.weapons) this.weapons.reset();
    this.ui.setMenu(false);
    this.ui.hide('touch'); this.ui.hide('pause'); this.ui.hide('settings'); this.ui.hide('crash'); this.ui.hide('guide');
    this.buildSelectGrid();
    // Önizleme uçağı seçili pist ucunda görünür; uçuştaki model (varsa) gizlenir
    if (this.aircraft) this.aircraft.group.visible = false;
    if (!this.previewAc) this.buildPreview();
    if (this.previewAc) { this.previewAc.group.visible = true; this.placePreview(); }
    this.updateBriefing();
    this.syncTodChips();
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
      // Seçilen kalkış noktası başka bölgedeyse önce dünya o bölgeye kurulur
      const region = spawnDesc(this.settings.spawn).region;
      if (this.world.regionId !== region) await this.rebuildWorld(this.settings.quality, region, null, true);
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
        this.weaponsWarmup();
        prog.finish('Ready');
        await this.ui.progressSettled();
        prog.save();
        this.ui.hide('loading');
      } else {
        this.physics.reset(this.world.spawnPose(this.settings.spawn));
        this.cameraRig.reset();
        this.weapons.reset(); this._weaponsT = null;
        // Hangardan yeniden uçuş: gaz kolu ve kumandalar da kalkış durumuna döner (eskiden kol
        // önceki uçuştaki konumunda kalıyordu; %100'de bırakılmışsa uçak pistte hemen hızlanıyordu)
        this.resetCockpit();
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
    this.physics.reset(this.world.spawnPose(this.settings.spawn));
    this.cameraRig.setAircraft(this.aircraft, cfg);
    this.weapons.attach(this.aircraft, this.physics);
    this.weapons.reset(); this._weaponsT = null;
    this.cameraRig.modeIndex = 0;
    this.cameraRig.reset();
    this.cameraRig.applyMode();
    this.audio.setProfile(cfg.audio);
    this.lightsOn = false;
    this.aircraft.setLandingLights(false);
    this.ui.setToggle(this.ui.el.btnLights, false);
    this.controls.resetLever(0);
    if (this.alerts) this.alerts.reset();
    // Flap kolu: kademe adları ve açıları uçaktan gelir, kol her zaman 0'da başlar
    this.controls.setFlapDetents(cfg.systems.flapNames, cfg.systems.flapNotes);
    this.updateToggleButtons();
    this.syncAircraft(0);
    this.cameraRig.update(1, this.physics);
    this.needsRender = true;
  }

  /**
   * Giriş ekranı (v5.0): yeni haritanın simge bölgesinde sinematik uçuş. F-35A kapalı bir rota
   * boyunca (kale, marina, Gümbet silueti, açık deniz) 70 m/s ile uçar; yatış rota eğriliğinden
   * (tan φ = v²κ/g), takım kapalı. Kamera kritik sönümlü takip: arkadan-yandan, yavaşça değişen açı,
   * araziye ve yapılara girmez. Gölge odağı uçağın çevresinde şehir ölçeğinde (binaların uzun gölgeleri).
   * Bu bir ÇİZİM animasyonudur: fizik modeli kullanılmaz ve değiştirilmez.
   */
  updateCinematic(dt) {
    const w = this.world, c = this.camera;
    if (!this._cine) this._cine = { shots: w.city.cinematicShots(), k: 0, t: 0, look: new THREE.Vector3(), bank: 0, prevP: null };
    const C = this._cine;
    C.t += dt;
    let S = C.shots[C.k];
    if (C.t >= S.dur) { C.t -= S.dur; C.k = (C.k + 1) % C.shots.length; S = C.shots[C.k]; C.prevP = null; C.lookInit = false; }
    const f = C.t / S.dur;
    // çekim geçişi: kısa karartma (DOM katmanı)
    const fade = this.ui.el.cineFade || (this.ui.el.cineFade = document.getElementById('cine-fade'));
    if (fade) fade.style.opacity = String(Math.max(0, 1 - C.t / 0.6, (C.t - (S.dur - 0.6)) / 0.6));
    const ac = this.previewAc;
    if (S.path) {
      const P = S.path.getPointAt(f), T = S.path.getTangentAt(f).normalize();
      const f2 = Math.min(1, f + 0.04), T2 = S.path.getTangentAt(f2);
      const v = S.path.getLength() / S.dur;
      const hdg = Math.atan2(T.x, -T.z), hdg2 = Math.atan2(T2.x, -T2.z);
      let dh = hdg2 - hdg; if (dh > Math.PI) dh -= 2 * Math.PI; if (dh < -Math.PI) dh += 2 * Math.PI;
      const ds = Math.max(1, (f2 - f) * S.path.getLength());
      const bankT = f2 > f ? Math.atan(v * v * (dh / ds) / 9.81) : C.bank;
      C.bank = C.prevP ? C.bank + (bankT - C.bank) * (1 - Math.exp(-dt * 2)) : bankT;
      C.prevP = P;
      if (ac) {
        ac.group.visible = true;
        ac.group.position.copy(P);
        ac.group.quaternion.setFromEuler(_prevEuler.set(Math.asin(THREE.MathUtils.clamp(T.y, -1, 1)) + 0.04, -hdg, -C.bank, 'YXZ'));
        ac.group.updateMatrixWorld(true);
        this.selClock = (this.selClock || 0) + dt;
        const A = this._cineArgs || (this._cineArgs = {});
        Object.assign(A, { elevator: 0, aileron: 0, rudder: 0, lef: 0, toeIn: 0, flaps: 0, gear: 0, throttle: 0.75, engine: 0.75, afterburner: 0,
          time: this.selClock, nozzle: 0.7, groundSpeed: 0, dt, gearComp: 0, steer: 0, camDist: c.position.distanceTo(P) });
        ac.update(A);
      }
      // kamera: çekim boyunca yavaşça kayar, uçağı yumuşak izler
      c.position.lerpVectors(S.cam[0], S.cam[1], f * f * (3 - 2 * f));
      // bakış: uçak ile simge yapı (siluet / kale) arasında: ikisi de kadrajda
      const tgt = S.focus ? P.clone().lerp(S.focus, S.mix) : P;
      if (!C.lookInit) { C.look.copy(tgt); C.lookInit = true; } else C.look.lerp(tgt, 1 - Math.exp(-dt * 4));
      c.up.set(0, 1, 0); c.lookAt(C.look);
      w.shadowFocus = { x: P.x, z: P.z, y: P.y - 100, half: 650 };
    } else if (S.orbit) {
      if (ac) ac.group.visible = false;
      const O = S.orbit, a = O.a0 + (O.a1 - O.a0) * f;
      c.position.set(O.c.x + Math.cos(a) * O.r, O.h, O.c.z + Math.sin(a) * O.r);
      c.up.set(0, 1, 0); c.lookAt(O.look);
      w.shadowFocus = { x: O.look.x, z: O.look.z, y: O.look.y, half: 1100 };
    }
    const gy = w.heightAt(c.position.x, c.position.z);
    if (c.position.y < gy + 8) c.position.y = gy + 8;
    const narrow = this.vp && this.vp.w / Math.max(1, this.vp.h) < 1.4;
    const fov = S.fov * (narrow ? 1.3 : 1);
    if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
  }

  // Seçim ekranı arka planı: üs üzerinde yavaş sinematik kamera
  updateSelectCamera(dt) {
    if (this.world && this.world.city && this.world.city.cinematicShots && this.previewAc && this.state !== 'running') { this.updateCinematic(dt); return; }
    this.selT = (this.selT === undefined ? 2.2 : this.selT) + dt * 0.055;
    const c = this.camera, tgt = this.selTarget;
    if (!tgt) {
      // Önizleme yoksa (eski yol): meydan üzerinde sinematik daire
      const aps = this.world.airportById, ap = aps[spawnDesc(this.settings.spawn).airport] || aps[Object.keys(aps)[0]];
      const V = this.world.selectView || { r: 360, h: 110, dx: -120, dz: 470 };
      c.position.set(ap.x + V.dx + Math.cos(this.selT) * V.r, ap.elev + V.h, ap.z + V.dz + Math.sin(this.selT) * V.r);
      c.lookAt(ap.x + V.dx, ap.elev + 8, ap.z + V.dz);
      return;
    }
    // Yumuşak kamera geçişi: odak seçili pist ucuna üstel olarak kayar; yoldayken kamera yükselip
    // açılır (pist değişiminde meydanın üzerinden süzülür, arazinin içinden geçmez)
    const f = this.selFocus || (this.selFocus = tgt.clone());
    if (dt > 0) f.lerp(tgt, 1 - Math.exp(-dt * 1.4)); else f.copy(tgt);
    const travel = f.distanceTo(tgt);
    const r = 19.5 + Math.min(260, travel * 0.12), up = 3.4 + Math.min(320, travel * 0.16);
    // Yörünge açısı uçağın burnuna göre: önden-yandan başlar, yavaşça çevresinde döner
    const a = this.selT - (this.selHdg || 0) * Math.PI / 180;
    c.position.set(f.x + Math.cos(a) * r, f.y + up + Math.sin(this.selT * 0.6) * 0.6, f.z + Math.sin(a) * r);
    const gy = this.world.heightAt(c.position.x, c.position.z);
    if (c.position.y < gy + 2.5) c.position.y = gy + 2.5;
    c.up.set(0, 1, 0);
    c.lookAt(f.x, f.y + 0.4, f.z);
    const fov = this.vp && this.vp.w / Math.max(1, this.vp.h) < 1.6 ? 44 : 38;
    if (c.fov !== fov) { c.fov = fov; c.updateProjectionMatrix(); }
    if (this.previewAc && this.previewAc.group.visible) {
      this.selClock = (this.selClock || 0) + dt;
      this.previewAc.update({ gear: 1, gearComp: PREVIEW_COMP, throttle: 0, time: this.selClock, dt, camDist: r, groundSpeed: 0 });
    }
  }

  start() {
    if (this.world) this.world.shadowFocus = null;
    // Önizleme uçağı uçuşta bellekten atılır (≈ 80 geometri, kendi 1024² boya dokuları); görev
    // hazırlığına dönüşte showSelect() yeniden kurar. iPhone'da GPU belleği uçuşa kalır.
    if (this.previewAc) { this.scene.remove(this.previewAc.group); this.previewAc.dispose(); this.previewAc = null; }
    if (this.aircraft) this.aircraft.group.visible = true;
    this.audio.unlock();
    this.audio.setProfile(getAircraftConfig(this.aircraftId).audio);
    this.ui.hide('select');
    this.ui.hide('start');
    this.ui.show('touch');
    // Kontroller ekranı oturumdaki ilk uçuşta açılır; sonra H tuşu / Duraklat → Controls ile
    if (!this._guideShown) { this._guideShown = true; this.ui.show('guide'); }
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
    this.accumulator = 0; this._stickSynced = false;
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
    this.accumulator = 0; this._stickSynced = false;
  }
  togglePause() {
    if (this.state === 'running') this.pause();
    else if (this.state === 'paused') this.resume();
  }
  /** Kaza sahnesinin geçici durumunu temizler: enkaz görünürlüğü, kaza kamerası, efektler, girdi. */
  clearCrash() {
    this.crashSeq = null;
    if (this.aircraft) this.aircraft.group.visible = true;
    if (this.cameraRig.crash) this.cameraRig.endCrash();
    this.cameraRig.trauma = 0;
    if (this.weapons) this.weapons.reset();     // füzeler + parçacıklar + krater izleri
    this._weaponsT = null;
    this.controls.resetInputs();
  }
  /** Kalkış durumu: gaz rölanti, kumandalar nötr, iniş ışıkları kapalı, uyarılar sıfır. */
  resetCockpit() {
    this.lightsOn = false;
    if (this.aircraft) this.aircraft.setLandingLights(false);
    this.ui.setToggle(this.ui.el.btnLights, false);
    this.controls.resetLever(0);
    this.controls.resetInputs();
    this._lastLandingShown = null;
    if (this.alerts) this.alerts.reset();
    this.updateToggleButtons();
  }
  restart() {
    this.clearCrash();
    this.ui.hide('crash');
    this.physics.reset(this.world.spawnPose(this.settings.spawn));
    this.resetCockpit();
    this.controls.setEnabled(true);
    this.cameraRig.reset();
    this.ui.show('touch');
    this.state = 'running';
    this.audio.resume();
    this.lastTime = performance.now();
    this.accumulator = 0; this._stickSynced = false;
    this.syncAircraft(0);
    const sp = spawnDesc(this.settings.spawn);
    // Pist tanımlayıcısı pist geometrisinden hesaplanır (world.js / runway.js), uçak başından değil
    const rwy = sp.runway;
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
    // Flap kolu fizikteki kademeyi izler (klavye ya da dokunma, fark etmez)
    this.controls.setFlapUI(p.flapIndex);
  }
  toggleLights() {
    if (this.state !== 'running') return;
    this.lightsOn = !this.lightsOn;
    this.aircraft.setLandingLights(this.lightsOn);
    this.ui.setToggle(this.ui.el.btnLights, this.lightsOn);
    this.ui.message(this.lightsOn ? 'Landing lights on' : 'Landing lights off', 1200);
  }
  fireMissile() {
    if (this.state !== 'running') return;
    this.weapons.fire();
  }
  updateFireButton(i) {
    const b = this.ui.el.btnFire || (this.ui.el.btnFire = document.getElementById('btn-fire'));
    if (!b) return;
    const inhibit = !!(this.physics && (this.physics.onGround || this.physics.crashed));
    b.classList.toggle('busy', i.busy);
    b.classList.toggle('queued', i.pending);
    b.classList.toggle('empty', i.count === 0);
    b.classList.toggle('inhibit', inhibit && i.count > 0);
    b.style.setProperty('--cd', i.cooldown.toFixed(2));
    const c = this._fireCount || (this._fireCount = document.getElementById('fire-count'));
    const txt = i.pending ? 'QUEUED' : 'AIM-120 ×' + i.count;
    if (c && c.textContent !== txt) c.textContent = txt;
  }
  /** Uçuş uyarıları (alerts.js): yere yaklaşma, yakıt, motor. Yeni tetiklenenler bildirim olarak da çıkar. */
  updateAlerts(dt) {
    const A = this.alerts;
    A.update(dt, this.physics, this.world);
    for (const ev of A.events) {
      if (ev === 'fuelLow') this.ui.message(`Low fuel — ${thousandsKg(FUEL_LOW_KG)} remaining. Head back to LTFE`, 3200);
      else if (ev === 'flameout') this.ui.message('Engine flameout — fuel exhausted. Glide to a landing', 4200);
    }
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
    await this.rebuildWorld(q, this.world.regionId, 'Applying graphics quality…');
    if (this.state === 'paused') this.ui.show('pause');
    this.needsRender = true;
  }

  /**
   * Dünyayı yeniden kurar (kalite ön ayarı ya da bölge değişimi). Fizik, kamera ve silahlar yeni
   * dünyaya bağlanır; uçak modeli ve fizik durumu korunur (bölge değişiminde uçuş zaten yeniden
   * başlatılır).
   */
  async rebuildWorld(q, region, label, atSpawn = false) {
    const R = REGIONS[region] || REGIONS.bodrum;
    const prog = new LoadTracker([...R.stages, 'env', 'shaders'], 'rebuild-' + region + '-' + q, (v, l) => this.ui.setProgress(v, l));
    this.ui.resetProgress(label || R.label);
    this.ui.show('loading');
    await this.breathe();
    const preset = QUALITY_PRESETS[q];
    // Kurulum süresince döngü dünyaya dokunmaz (eski dünya bırakıldı, yenisi hazır değil)
    this.world.dispose();
    this.world = null;
    const world = await this.createWorld(q, prog, region);
    this.world = world;
    if (this.physics) this.physics.world = world;
    this.cameraRig.world = world;
    this.weapons.world = world;
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
    // Görünür arazi düğümleri yükleme ekranında kurulur ve programları derlenir (uçuşta takılma yok)
    if (atSpawn && this.physics) this.camera.position.copy(this._spawnCamPos());
    this.world.update(0, this.camera, this.camera.position);
    if (this.world.prewarm) this.world.prewarm(this.camera);
    await this.precompile(this.scene);
    this.warmupFrame();
    this.weaponsWarmup();
    prog.finish('Ready');
    await this.ui.progressSettled();
    prog.save();
    this.ui.hide('loading');
    this.needsRender = true;
  }

  /** Kalkış noktasının biraz arkası ve yukarısı (yeni bölgede ilk görüntü için arazi ısıtma konumu). */
  _spawnCamPos() {
    const sp = this.world.spawnPose(this.settings.spawn), h = sp.hdg * Math.PI / 180;
    const gy = this.world.heightAt(sp.x, sp.z);
    return new THREE.Vector3(sp.x - Math.sin(h) * 40, gy + 12, sp.z + Math.cos(h) * 40);
  }

  // ---- Service worker ----
  registerSW() {
    if (!('serviceWorker' in navigator) || !/^https?:$/.test(location.protocol)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) this.ui.show('updateToast');
    });
    navigator.serviceWorker.register('./sw.js').then((reg) => {
      if (!reg) return;            // kayıt engellendi (ör. otomasyon / gizli mod)
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

  perfInfo() {
    const pi = this._perfInfo || (this._perfInfo = {});
    pi.renderer = this.renderer; pi.scene = this.scene; pi.world = this.world; pi.aq = this.aq;
    pi.targetFps = this.targetFps; pi.renderScale = this.renderScale; pi.pixelRatio = this.renderer.getPixelRatio();
    return pi;
  }

  /** Gün saati (yalnızca gerçek bölge; eğitim haritasında yapı gölgeleri sabit güneşe göre pişmiştir). */
  applyTimeOfDay(world = this.world) {
    if (!world) return;
    const key = this.settings.tod || 'default';
    if (world.supportsTimeOfDay) {
      world.setTimeOfDay(key);
      // ortam haritası (cam/boya yansımaları) yeni gökten yeniden kurulur; gece ortam ışığı azalır
      if (this.envMap && this.renderer) this.buildEnvironment();
      this.needsRender = true;
    }
  }

  /** Performans katmanı (` tuşu ya da Ayarlar > FPS counter > Debug): HUD'dan ayrı DOM paneli. */
  togglePerfDebug() {
    this.settings.fps = this.settings.fps === 2 ? 0 : 2;
    saveSettings(this.settings);
    this.ui.setSeg(this.ui.el.fpsSeg, 'f', this.settings.fps);
    this.ui.el.fps.textContent = '';
    this.perfOverlay.setOn(this.settings.fps === 2);
    this.ui.message(this.settings.fps === 2 ? 'Performance overlay on (`)' : 'Performance overlay off');
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
    L.push(`<b>AIR</b>    TAS ${n(T.ktas, 0)} kt   IAS(CAS) ${n(T.kias, 0)} kt   EAS ${n(T.keas, 0)} kt   M ${n(T.mach, 3)}`);
    L.push(`       GS ${n(T.gsKt, 0)} kt   track ${n(T.trackDeg, 0)}°   RA ${n(T.aglFt, 0)} ft`);
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
    if (this.world && this.world.geoInfo) {
      // Gerçek dünya: konum ve ÜÇ AYRI yükseklik (MSL / WGS84 elipsoit / zemin üstü), yön (ızgara/gerçek/manyetik)
      const G = this.world.geoInfo(p.pos, T.heading, this._geo || (this._geo = {}));
      L.push(`<b>GEO</b>    ${fmtDMS(G.lat, 'N', 'S')} ${fmtDMS(G.lon, 'E', 'W')}`);
      L.push(`       MSL ${n(G.hMsl, 1)} m  ELL ${n(G.hEll, 1)} m (N ${n(G.geoidN, 1)})  AGL ${n(G.hAgl, 1)} m  terrain ${n(G.terrainMsl, 1)} m`);
      L.push(`       HDG grid ${n(T.heading, 1)}°  true ${n(G.hdgTrue, 1)}°  mag ${n(G.hdgMag, 1)}°  conv ${n(G.convergence, 3)}°`);
    }
    L.push(`<b>AERO</b>   separation ${n(d.sepFrac)}  tailEff ${n(d.tailEff)}  CLmax ${n(d.CLmaxCfg)}`);
    L.push(`       αtrim ${n(d.alphaTrim * DEGR, 1)}°  onGround ${p.onGround ? 'yes' : 'no'}  rateClamp ${d.rateClamped ? 'YES' : 'no'}  forceGuard ${d.forceGuard ? 'YES' : 'no'}`);
    el.innerHTML = L.join('\n');
  }

  // ---- Kaza sahnesi ----
  // 1) Çarpma algılanır (fizik, tek sefer) ve sınıflandırılır (crash.js).
  // 2) Enkaz dinamiği sürer (fizik wreckStep, 120 Hz): uçak donmaz/ışınlanmaz.
  // 3) Kamera kaza görünümüne yumuşak geçer, şiddetle orantılı sarsılır; çarpma sesi ve
  //    yüzeye/şiddete uygun efektler (toz, kıvılcım, enkaz, sıçrama; yalnızca yıkıcı
  //    çarpmada ateş topu ve yangın).
  // 4) Şiddete göre ~1,7-2,6 s sonra (ya da enkaz durunca) sonuç ekranı sinematik olarak açılır;
  //    sahne arkada akmaya devam eder.
  beginCrash() {
    const p = this.physics, info = p.crashInfo || { severity: 'critical', cause: 'terrain', data: {} };
    const P = p.wreck ? p.wreck.P : { shake: 0.8, delay: 2.4 };
    this.state = 'crashing';
    this.controls.setEnabled(false);
    this.ui.setMenu(false);
    this.ui.hide('touch'); this.ui.hide('guide');
    const pos = p.pos, gY = Math.max(this.world.heightAt(pos.x, pos.z), WATER_LEVEL);
    const surface = this.world.surfaceTypeAt(pos.x, pos.z);
    const paved = surface === 'runway' || surface === 'taxiway' || surface === 'apron';
    const dir = p.vel.clone().setY(0); const vh = dir.length(); if (vh > 0.1) dir.multiplyScalar(1 / vh);
    this.crashSeq = {
      t: 0, delay: P.delay, info, destroyed: info.severity === 'catastrophic', paved, dir, scrapeT: 0, fireT: 0,
      fire: info.severity === 'catastrophic' || (info.severity === 'critical' && (info.data.impactSpeedKt || 0) > 175 && info.cause !== 'water'),
      impact: pos.clone(),
    };
    this.cameraRig.beginCrash(this.pose, info.severity, P.shake);
    const fx = this.weapons.fx;
    const intensity = { minor: 0.45, major: 0.7, critical: 1.0, catastrophic: 1.4 }[info.severity] || 1;
    if (info.cause === 'water' || surface === 'water') { fx.splash(pos, WATER_LEVEL); if (intensity > 0.9) fx.splash(pos.clone().addScaledVector(dir, 12), WATER_LEVEL); }
    else if (this.crashSeq.destroyed) {
      // Yıkıcı çarpma: birkaç ateş topu (yakıt), toz ve enkaz; ana kütle kısa sürede durur
      // (ölçek: ~1 tonluk iç yakıtın küçük bir kısmının alev alması; füze harp başlığının ~2,5 katı)
      fx.explode(pos, 'ground', gY, 2.6);
      fx.explode(pos.clone().addScaledVector(dir, 18).setY(gY + 4), 'ground', gY, 1.8);
      fx.explode(pos.clone().addScaledVector(dir, 40).setY(gY + 6), 'air', gY, 1.4);
      fx.impactDust(pos, gY, intensity, paved, dir);
    } else fx.impactDust(pos, gY, intensity, paved, dir);
    this.audio.crashImpact(info.severity, this.camera.position.distanceTo(pos), this.crashSeq.destroyed ? 0.6 : 1.8);
    this.needsRender = true;
  }

  updateCrash(dt) {
    const p = this.physics, C = this.crashSeq;
    if (!C) return;
    C.t += dt;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= FIXED_DT && steps < 12) {
      this._prevPos.copy(p.pos); this._prevQuat.copy(p.quat);
      p.step(FIXED_DT);
      this.accumulator -= FIXED_DT; steps++;
    }
    if (steps >= 12) this.accumulator = 0;
    this.interpolatePose(this.accumulator / FIXED_DT);
    this.syncAircraft(dt);
    // Yıkıcı çarpma: model ateş topunun içinde kalır ve parçalanmış sayılır (enkaz parçacıkları sürer)
    if (C.destroyed && C.t > 0.22 && this.aircraft.group.visible) this.aircraft.group.visible = false;
    this.cameraRig.update(dt, this.pose);
    // Süren efektler: kayma izi (kıvılcım/toz) ve varsa yangın dumanı
    const fx = this.weapons.fx, pos = this.pose.pos;
    const gY = Math.max(this.world.heightAt(pos.x, pos.z), WATER_LEVEL);
    const vh = Math.hypot(p.vel.x, p.vel.z);
    C.scrapeT -= dt;
    if (p.onGround && vh > 4 && C.scrapeT <= 0 && !C.destroyed && !(p.wreck && p.wreck.water)) {
      C.scrapeT = 0.07;
      const d = C.dir.set(p.vel.x, 0, p.vel.z).multiplyScalar(1 / vh);
      const sf = this.world.surfaceTypeAt(pos.x, pos.z);
      fx.scrape(pos, gY, vh, sf === 'runway' || sf === 'taxiway' || sf === 'apron', d);
    }
    if (C.fire) {
      C.fireT -= dt;
      if (C.fireT <= 0) {
        C.fireT = C.t < 3 ? 0.09 : 0.22;
        const heat = Math.max(0, 1 - C.t / 14);
        fx.fireSmoke(C.destroyed ? C.impact.clone().lerp(pos, 0.5) : pos, gY, heat, C.destroyed ? 1.8 : 1.2);
      }
    }
    this._wind = p.windAt(gY + 8, p.time);
    const poseT = p.time + this.accumulator;
    const wdt = this._weaponsT === null ? dt : Math.min(0.1, Math.max(0, poseT - this._weaponsT));
    this._weaponsT = poseT;
    this.weapons.update(wdt || dt, this.pose, this.camera, this._wind);
    // Sonuç ekranı: şiddete göre gecikme ya da enkaz durduktan kısa süre sonra
    if (this.state === 'crashing' && (C.t > C.delay || (p.wreck && p.wreck.rest && C.t > C.delay * 0.6))) {
      this.state = 'crashed';
      this.ui.showCrash(p.crashInfo, fmtCrashData);
    }
  }

  /** Çizim pozunu son iki fizik durumu arasında kurar (a: 0..1, adım kesri). */
  interpolatePose(a) {
    const p = this.physics, pose = this.pose;
    // Işınlanma (yeniden başlatma, hangardan yeniden uçuş): aradaki yol enterpole edilmez
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
    // Gerçek dünya bölgesinde zemin çizimde kameraya göre d²/2R alçalır: uçak da aynı miktarda
    // (yalnızca görsel; fizik düz yerel çerçevededir). Kurgusal dünyada hzCurv = 0.
    const kc = HAZE_UNIFORMS.hzCurv.value;
    if (kc) { const dx = pose.pos.x - this.camera.position.x, dz = pose.pos.z - this.camera.position.z; this.aircraft.group.position.y -= (dx * dx + dz * dz) * kc; }
    // Amortisör sıkışması kadar gövde alçalır, tekerlekler pistte kalır (yalnızca görsel)
    const gc = p.gearComp || 0;
    if (gc) this.aircraft.group.position.y -= gc;
    const sf = p.surfaces, A = this._acArgs;
    // Argüman nesnesi her karede yeniden kullanılır (tahsis yok)
    A.elevator = sf.elevator; A.aileron = sf.aileron; A.rudder = sf.rudder;
    A.lef = p.lefPos || 0; A.toeIn = p.toeIn || 0;
    A.flaps = p.flapsPos; A.gear = p.gearPos;
    A.throttle = p.engine; A.engine = p.engine; A.afterburner = p.abLevel; A.time = p.time;
    A.nozzle = p.engine_.nozzle !== undefined ? p.engine_.nozzle : p.engine;
    A.groundSpeed = p.onGround ? p.vel.length() : 0; A.dt = dt; A.gearComp = gc;
    A.steer = p.noseSteer || 0;
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
    const cpu0 = performance.now();
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
    if (this.state !== 'running' && this.controls) this.controls.pollGamepad(dt, false);
    if (!this.physics || this.state === 'select') {
      this.updateSelectCamera(dt);
      const w0 = performance.now();
      this.world.update(dt, this.camera, this.camera.position);
      const w1 = performance.now();
      this.renderer.render(this.scene, this.camera);
      if (this.perfOverlay.on) { const r1 = performance.now(); this.perfOverlay.sample(frameDt * 1000, r1 - cpu0, w1 - w0, r1 - w1); this.perfOverlay.update(dt, this.perfInfo()); }
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
      this.physics.setControls({ throttle: c.throttle, afterburner: c.afterburner });
      this.accumulator += dt;
      let steps = 0;
      const p = this.physics;
      // Çubuk karede bir örneklenir ama fizik karede birkaç adım atar. Eskiden kare sonu
      // değeri tüm alt adımlarda sabit tutuluyordu: 30 fps'de (4 adım) FCS'ye basamaklı bir
      // komut gidiyordu. Artık Controls'un üstel yumuşatması 120 Hz alt adımlarda uygulanır
      // (üstel adımlar birleşir: kare sonunda değer aynıdır, aradaki adımlar da doğrudur).
      // Aynı girdi her kare hızında aynı sürekli komutu üretir.
      const raw = this.controls.raw, sc = this._stickCmd || (this._stickCmd = { pitch: 0, roll: 0, yaw: 0 });
      if (!this._stickSynced) { sc.pitch = c.pitch; sc.roll = c.roll; sc.yaw = c.yaw; this._stickSynced = true; }
      const kSm = 1 - Math.exp(-FIXED_DT * STICK_SMOOTH);
      while (this.accumulator >= FIXED_DT && steps < 12) {
        sc.pitch += (raw.pitch - sc.pitch) * kSm;
        sc.roll += (raw.roll - sc.roll) * kSm;
        sc.yaw += (raw.yaw - sc.yaw) * kSm;
        p.setControls(sc);
        this._prevPos.copy(p.pos); this._prevQuat.copy(p.quat);
        p.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      // Bir karede en fazla 12 adım (0,1 s): yavaş cihazda biriken açık atılır, fizik
      // kendi kendini besleyen bir gecikme sarmalına girmez.
      if (steps >= 12) this.accumulator = 0;
      this.interpolatePose(this.accumulator / FIXED_DT);
      if (this.physics.crashed) this.beginCrash();
      else if (p.lastLanding && p.lastLanding !== this._lastLandingShown) {
        // Teker koyma bildirimi: alçalma hızı (normal / sert ama sınır içinde)
        this._lastLandingShown = p.lastLanding;
        const fpm = Math.round(Math.abs(p.lastLanding.data.verticalSpeedFpm));
        this.ui.message(`${p.lastLanding.cause === 'firm' ? 'Firm touchdown' : 'Touchdown'} · ${fpm} ft/min`, 2200);
      }
      if (!this.physics.crashed) this.updateAlerts(dt);
      this.syncAircraft(dt);
      this.cameraRig.update(dt, this.pose);
      this._wind = this.physics.windAt(this.physics.groundY + 8, this.physics.time);
      // Silahlar, çizilen uçak pozuyla AYNI saatle ilerler (poz saati = fizik zamanı + artık).
      // Çok yavaş karede fizik en fazla 12 adım atıp artığı atar; kare dt'si kullanılsaydı
      // bırakılmış füze o karede uçağa göre bir fizik adımı (~2 m) öne kayardı.
      const poseT = this.physics.time + this.accumulator;
      const wdt = this._weaponsT === null ? dt : Math.min(0.1, Math.max(0, poseT - this._weaponsT));
      this._weaponsT = poseT;
      this.weapons.update(wdt, this.pose, this.camera, this._wind);
      // Gerçek dünya: HUD manyetik yön gösterir (ızgara + yakınsama − WMM sapması)
      const Tm = this.physics.telemetry;
      if (this.world.geoInfo) { const G = this.world.geoInfo(this.pose.pos, Tm.heading, this._geoHud || (this._geoHud = {})); Tm.hdgMag = G.hdgMag; }
      else Tm.hdgMag = undefined;
      // Kokpit panoramik ekranı: yalnızca kokpitten bakılırken canlı tazelenir
      if (this.cameraRig.mode === 'cockpit' && this.aircraft.updateDisplay) {
        const di = this._pcdInfo || (this._pcdInfo = { home: { x: LTFE.x, z: LTFE.z, name: 'LTFE' } });
        di.alerts = this.alerts; di.pos = this.pose.pos; di.nozzle = this.physics.engine_.nozzle;
        this.aircraft.updateDisplay(dt, Tm, di);
      }
      if (this.physDebug) this.drawPhysDebug();
    }
    const wrecking = this.state === 'crashing' || this.state === 'crashed';
    if (wrecking) this.updateCrash(dt);
    if (running || wrecking || this.needsRender) {
      this.world.setWind(this.physics.windAt(this.physics.groundY + 8, this.physics.time), this.physics.wind.kt);
      this.world.focusVel = this.physics.vel;
      const w0 = performance.now();
      this.world.update(running || wrecking ? dt : 0, this.camera, this.pose.pos);
      const w1 = performance.now();
      this.renderer.render(this.scene, this.camera);
      if (this.perfOverlay.on) { const r1 = performance.now(); this.perfOverlay.sample(frameDt * 1000, r1 - cpu0, w1 - w0, r1 - w1); }
      if (wrecking) this.hud.clear();
      else {
        const cockpit = this.cameraRig.mode === 'cockpit';
        const W = this.weapons, wi = this._hudWpn || (this._hudWpn = {});
        wi.count = W.count; wi.pending = W.pending; wi.inhibit = !!W.inhibited();
        wi.busy = false; for (const b of W.bays) if (b.state === 'opening' || b.state === 'eject') wi.busy = true;
        this.hud.draw(this.physics.telemetry, this.camera, this.pose, {
          visible: cockpit, externalOnly: !cockpit,
          dt, safe: this.safe, cameraName: CAMERA_NAMES[this.cameraRig.mode], weapons: wi,
          alertList: this.alerts.list(this.physics.telemetry, this._alertList), fuelLow: this.alerts.fuelLow,
        });
      }
      this.needsRender = false;
    }
    const crashCam = wrecking && this.cameraRig.crash && !this.cameraRig.crash.keep;
    this.audio.setListener(this.cameraRig.mode === 'cockpit' && !crashCam ? 'cockpit' : 'external', this.cameraRig.doppler, this.cameraRig.distance);
    // Kaza sahnesinde motor sesi (yıkıcı değilse) gaz kesik hâlde doğal olarak söner
    this.audio.update(dt, this.physics.telemetry, running || (wrecking && this.crashSeq && !this.crashSeq.destroyed), running ? this.alerts : null);
    // ---- Uyarlanabilir kalite (perf.js): ham kare aralığıyla, yalnızca uçuşta ölçülür ----
    if (running) this.aq.sample(frameDt, this.frameMs);
    if (this.perfOverlay.on) this.perfOverlay.update(dt, this.perfInfo());
    // FPS göstergesi
    if (this.settings.fps) {
      this.frameCount++; this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        const sc = this.aq.tier > 0 ? ' · ' + this.aq.label : '';
        // Gerçek dünyada bellek baskısı göstergesi: GPU'daki görüntü karosu / bütçe, inşa edilmiş düğüm
        const T = this.world.terrain, ts = T ? ` · terrain ${T.stats.drawn}/${T.stats.nodes} · tex ${T.img.loadedCount()}/${T.img.budget}` : '';
        this.ui.el.fps.textContent = Math.round(this.frameCount / this.fpsTime) + '/' + this.targetFps + ' fps' + sc + ' · ' + this.renderer.info.render.calls + ' draws' + ts;
        this.frameCount = 0; this.fpsTime = 0;
      }
    }
  }
}

window.__app = new App();
window.__THREE = THREE;   // geliştirme/test kancası (başsız ekran görüntüsü betikleri)
