// F-35A Simülatör – uygulama giriş noktası.
import * as THREE from 'three';
import { APP_VERSION } from './version.js';
import { World, LAYER_TREES, QUALITY_PRESETS, SPAWNS, spawnPose, AIRPORT_BY_ID } from './world.js';
import { FlightModel, FIXED_DT } from './physics.js';
import { FLEET, FLEET_ORDER, getAircraftConfig } from './fleet.js';
import { Controls } from './controls.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { CameraRig, CAMERA_NAMES } from './cameras.js';
import { UI, isStandalone, isIOS, loadSettings, saveSettings } from './ui.js';

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
    this.renderScale = 1;      // kalite ön ayarının piksel oranına uygulanan çarpan (0.6–1)
    this.slowTime = 0; this.goodTime = 0;
    this.safe = { top: 0, right: 0, bottom: 0, left: 0 };
    this.ui.el.version.textContent = APP_VERSION;
    this.canvas = document.getElementById('gl');
    this.hudCanvas = document.getElementById('hud');
    this.contextLost = false;
    this.init().catch((err) => {
      console.error(err);
      this.ui.setLoading('Hata: ' + (err && err.message ? err.message : err), 0);
    });
  }

  async init() {
    const ui = this.ui;
    ui.setLoading('Grafik başlatılıyor…', 0.05);
    await this.nextFrame();
    this.setupRenderer();
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 60000);
    this.camera.layers.enable(LAYER_TREES);
    this.scene.add(this.camera);

    ui.setLoading('Arazi ve hava üssü oluşturuluyor…', 0.2);
    await this.nextFrame();
    this.world = new World(this.scene, this.renderer, this.settings.quality);

    this.buildEnvironment();

    ui.setLoading('Fizik ve kontroller…', 0.6);
    await this.nextFrame();
    this.aircraft = null; this.physics = null; this.aircraftId = null;
    this.hud = new HUD(this.hudCanvas);
    this.audio = new AudioEngine();
    this.cameraRig = new CameraRig(this.camera, null, this.world, null);
    this.controls = new Controls({
      onGear: () => this.toggleGear(),
      onFlaps: () => this.toggleFlaps(),
      onBrake: () => this.toggleBrake(),
      onCamera: () => this.cycleCamera(),
      onSound: () => this.toggleSound(),
      onPause: () => this.togglePause(),
      onLights: () => this.toggleLights(),
      onSpoilers: () => this.toggleSpoilers(),
      onMenu: () => this.ui.toggleMenu(),
      onMenuActivity: () => this.ui.menuActivity(),
      onViewDrag: (dx, dy) => this.cameraRig.drag(dx, dy),
      onViewPinch: (f) => this.cameraRig.zoom(f),
    });
    this.bindUI();
    this.bindSystem();
    this.onResize();
    this.applySettingsToUI();

    ui.setLoading('Uçak önizlemeleri hazırlanıyor…', 0.85);
    await this.nextFrame();
    await this.buildThumbnails();
    this.updateSelectCamera(0);
    this.world.update(0, this.camera, this.camera.position);

    ui.setLoading('Hazır', 1);
    await this.nextFrame();
    ui.hide('loading');
    this.buildSelectGrid();
    this.showSelect();
    if (isIOS() && !isStandalone()) ui.el.selHint.textContent = 'iPhone: Paylaş → Ana Ekrana Ekle ile tam ekran oynayın.';
    this.registerSW();
    this.checkOrientation();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

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
      console.warn('Ortam haritası oluşturulamadı', e);
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
      if (on && !ok) { ui.setSeg(el.tiltSeg, 't', 0); ui.message('Eğim izni verilmedi'); this.settings.tilt = 0; }
      else this.settings.tilt = on ? 1 : 0;
      saveSettings(this.settings);
    });
    ui.bindSeg(el.soundSeg, 's', (v) => { this.settings.sound = v === '1' ? 1 : 0; saveSettings(this.settings); this.applySound(); });
    ui.bindSeg(el.fpsSeg, 'f', (v) => { this.settings.fps = v === '1' ? 1 : 0; saveSettings(this.settings); el.fps.textContent = ''; });
    el.btnCalibrate.addEventListener('click', () => { this.controls.calibrate(); ui.message('Eğim kalibre edildi'); });
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
    window.addEventListener('resize', () => this.onResize());
    if (window.visualViewport) window.visualViewport.addEventListener('resize', () => this.onResize());
    const mq = window.matchMedia('(orientation: portrait)');
    (mq.addEventListener ? mq.addEventListener('change', () => this.checkOrientation()) : mq.addListener(() => this.checkOrientation()));
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
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.needsRender = true;
  }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(this.basePixelRatio() * this.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.hud.resize(w, h, Math.min(window.devicePixelRatio || 1, 2));
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
    const portrait = window.innerHeight > window.innerWidth && (coarse || window.innerWidth < 600);
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
      go.className = 'ac-go'; go.textContent = 'UÇ →';
      card.append(cv, info, go);
      card.addEventListener('click', () => this.pickAircraft(id));
      grid.appendChild(card);
      if (this.thumbData && this.thumbData[id]) cv.getContext('2d').putImageData(this.thumbData[id], 0, 0);
    }
    this.buildSpawnRow();
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
  async buildThumbnails() {
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
    this.thumbData = {};
    for (const id of FLEET_ORDER) {
      const cfg = FLEET[id];
      let ac = null;
      try {
        ac = cfg.build({ quality: this.settings.quality });
        if (this.envMap && ac.setEnvironment) ac.setEnvironment(this.envMap);
        ac.update({ gear: 1, flaps: 0, slats: 0, spoilers: 0, throttle: 0.2, engine: 0.2, time: 0.35, dt: 0.016 });
        scene.add(ac.group);
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
        console.warn('önizleme oluşturulamadı', id, e);
      } finally {
        if (ac) { scene.remove(ac.group); ac.dispose(); }
      }
      await this.nextFrame();
    }
    this.renderer.setClearAlpha(prevAlpha);
    this.renderer.setRenderTarget(null);
    rt.dispose();
    key.dispose(); fill.dispose();
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
        this.ui.setLoading(cfg.name + ' hazırlanıyor…', 0.35);
        this.ui.show('loading');
        await this.nextFrame(); await this.nextFrame();
        this.installAircraft(id);
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
  installAircraft(id) {
    const cfg = getAircraftConfig(id);
    if (this.aircraft) {
      this.scene.remove(this.aircraft.group);
      this.aircraft.dispose();
      this.aircraft = null;
    }
    this.aircraftId = id;
    this.aircraft = cfg.build({ quality: this.settings.quality });
    this.scene.add(this.aircraft.group);
    if (this.envMap && this.aircraft.setEnvironment) this.aircraft.setEnvironment(this.envMap);
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
        this.ui.show('standaloneHint');
        try { localStorage.setItem('f35a.hintShown', '1'); } catch (e) { /* yok */ }
        setTimeout(() => this.ui.hide('standaloneHint'), 9000);
      }
    }
    this.state = 'running';
    this.controls.setEnabled(true);
    this.lastTime = performance.now();
    this.accumulator = 0;
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
    if (this.pausedByOrientation && window.innerHeight > window.innerWidth) return;
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
    this.ui.message('Pist 09 eşiği – fren açık, motor rölanti');
  }
  toggleGear() {
    if (this.state !== 'running') return;
    this.physics.toggleGear();
    this.updateToggleButtons();
    this.ui.message(this.physics.gearCmd ? 'İniş takımı açılıyor' : 'İniş takımı kapanıyor', 1500);
  }
  toggleFlaps() {
    if (this.state !== 'running') return;
    this.physics.toggleFlaps();
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
    ui.setToggle(ui.el.btnFlap, p.flapsCmd > 0.5);
    ui.setToggle(ui.el.btnBrake, p.brakes);
    ui.setToggle(ui.el.btnSpoiler, p.spoilerCmd > 0.5);
    // Çok kademeli flap kolunda etiket kademeyi gösterir
    const lab = ui.el.btnFlap.querySelector('.l');
    if (lab) lab.textContent = p.sys.flapDetents.length > 2 ? 'Flaps ' + p.flapLabel : 'Flaps';
  }
  toggleSpoilers() {
    if (this.state !== 'running' || !this.physics) return;
    if (!this.physics.sys.spoilers) return;
    this.physics.toggleSpoilers();
    this.updateToggleButtons();
    this.ui.message(this.physics.spoilerCmd ? 'Hız frenleri açık' : 'Hız frenleri kapalı', 1100);
  }
  toggleLights() {
    if (this.state !== 'running') return;
    this.lightsOn = !this.lightsOn;
    this.aircraft.setLandingLights(this.lightsOn);
    this.ui.setToggle(this.ui.el.btnLights, this.lightsOn);
    this.ui.message(this.lightsOn ? 'İniş ışıkları açık' : 'İniş ışıkları kapalı', 1200);
  }
  cycleCamera() {
    this.cameraRig.next();
    this.ui.message('Camera: ' + CAMERA_NAMES[this.cameraRig.mode], 1200);
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
    this.ui.setLoading('Kalite değiştiriliyor…', 0.3);
    this.ui.show('loading');
    await this.nextFrame(); await this.nextFrame();
    const preset = QUALITY_PRESETS[q];
    this.world.dispose();
    this.world = new World(this.scene, this.renderer, q);
    this.physics.world = this.world;
    this.cameraRig.world = this.world;
    this.renderScale = 1; this.slowTime = 0; this.goodTime = 0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, preset.pixelRatio));
    this.renderer.shadowMap.enabled = preset.shadows;
    this.scene.traverse((o) => { if (o.material) { const ms = Array.isArray(o.material) ? o.material : [o.material]; ms.forEach((m) => { m.needsUpdate = true; }); } });
    this.buildEnvironment();
    this.onResize();
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
          if (e.data && e.data.version && e.data.version !== APP_VERSION) this.ui.el.version.textContent = APP_VERSION + ' (önbellek ' + e.data.version + ')';
        };
        ctrl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      };
      if (navigator.serviceWorker.controller) ask(); else navigator.serviceWorker.addEventListener('controllerchange', ask, { once: true });
      // Periyodik güncelleme denetimi
      setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
    }).catch((err) => console.warn('SW kaydı başarısız', err));
  }

  // ---- Döngü ----
  syncAircraft(dt) {
    const p = this.physics, T = p.telemetry;
    this.aircraft.group.position.copy(p.pos);
    this.aircraft.group.quaternion.copy(p.quat);
    const sf = p.surfaces;
    this.aircraft.update({
      elevator: sf.elevator, aileron: sf.aileron, rudder: sf.rudder,
      flaps: p.flapsPos, slats: p.slatsPos, spoilers: p.spoilerPos, gear: p.gearPos,
      throttle: p.engine, engine: p.engine, afterburner: p.abLevel, reverse: p.reversePos, time: p.time,
      groundSpeed: p.onGround ? p.vel.length() : 0, dt,
    });
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
    // Bazı tarayıcılar döndürmede resize olayını geç/eksik gönderir: boyutu her karede doğrula
    if (window.innerWidth !== this._lastW || window.innerHeight !== this._lastH) {
      this._lastW = window.innerWidth; this._lastH = window.innerHeight;
      this.onResize();
    }
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.1) dt = 0.1; // arka plandan dönüşte sıçramayı sınırla
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
      while (this.accumulator >= FIXED_DT && steps < 12) {
        this.physics.step(FIXED_DT);
        this.accumulator -= FIXED_DT;
        steps++;
      }
      if (steps >= 12) this.accumulator = 0;
      if (this.physics.crashed) {
        this.state = 'crashed';
        this.controls.setEnabled(false);
        this.ui.showCrash(this.physics.crashReason);
      }
      this.syncAircraft(dt);
      this.cameraRig.update(dt, this.physics);
    }
    if (running || this.needsRender) {
      this.world.setWind(this.physics.windAt(this.physics.groundY + 8, this.physics.time), this.physics.wind.kt);
      this.world.update(running ? dt : 0, this.camera, this.physics.pos);
      this.renderer.render(this.scene, this.camera);
      const cockpit = this.cameraRig.mode === 'cockpit';
      const style = getAircraftConfig(this.aircraftId).hud;
      this.hud.draw(this.physics.telemetry, this.camera, this.physics, {
        visible: cockpit, externalOnly: !cockpit, style, extended: style === 'airliner',
        dt, safe: this.safe, cameraName: CAMERA_NAMES[this.cameraRig.mode],
      });
      this.needsRender = false;
    }
    this.audio.setListener(this.cameraRig.mode === 'cockpit' ? 'cockpit' : 'external', this.cameraRig.doppler, this.cameraRig.distance);
    this.audio.update(dt, this.physics.telemetry, running);
    // ---- Uyarlanabilir çözünürlük: 60 fps hedefini tutturmak için ----
    // Kare süresi 19,5 ms'yi (≈51 fps) aşan süre birikince render ölçeği düşer; 6 s boyunca
    // hedef tutturulursa kademeli geri yükselir. Arayüz ve HUD tam çözünürlükte kalır.
    if (running && dt > 0) {
      if (dt > 0.0195) { this.slowTime += dt; this.goodTime = 0; }
      else { this.goodTime += dt; this.slowTime = Math.max(0, this.slowTime - dt * 0.25); }
      if (this.slowTime > 0.6 && this.renderScale > 0.6) {
        this.renderScale = Math.max(0.6, this.renderScale - 0.12);
        this.slowTime = 0; this.goodTime = 0; this.applyPixelRatio();
      } else if (this.goodTime > 6 && this.renderScale < 1) {
        this.renderScale = Math.min(1, this.renderScale + 0.1);
        this.goodTime = 0; this.applyPixelRatio();
      }
    }
    // FPS göstergesi
    if (this.settings.fps) {
      this.frameCount++; this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        const sc = this.renderScale < 0.999 ? ' · ölçek %' + Math.round(this.renderScale * 100) : '';
        this.ui.el.fps.textContent = Math.round(this.frameCount / this.fpsTime) + '/' + this.targetFps + ' fps' + sc + ' · ' + this.renderer.info.render.calls + ' çizim';
        this.frameCount = 0; this.fpsTime = 0;
      }
    }
  }
}

window.__app = new App();
