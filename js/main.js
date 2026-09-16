// F-35A Simülatör – uygulama giriş noktası.
import * as THREE from 'three';
import { APP_VERSION } from './version.js';
import { World, LAYER_TREES, QUALITY_PRESETS } from './world.js';
import { F35A } from './aircraft.js';
import { FlightModel, FIXED_DT } from './physics.js';
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

    ui.setLoading('F-35A modeli oluşturuluyor…', 0.55);
    await this.nextFrame();
    this.aircraft = new F35A({ quality: this.settings.quality });
    this.scene.add(this.aircraft.group);
    this.buildEnvironment();

    ui.setLoading('Fizik ve kontroller…', 0.8);
    await this.nextFrame();
    this.physics = new FlightModel(this.world);
    this.hud = new HUD(this.hudCanvas);
    this.audio = new AudioEngine();
    this.cameraRig = new CameraRig(this.camera, this.aircraft, this.world);
    this.cameraRig.applyMode();
    this.controls = new Controls({
      onGear: () => this.toggleGear(),
      onFlaps: () => this.toggleFlaps(),
      onBrake: () => this.toggleBrake(),
      onCamera: () => this.cycleCamera(),
      onSound: () => this.toggleSound(),
      onPause: () => this.togglePause(),
      onLights: () => this.toggleLights(),
      onViewDrag: (dx, dy) => this.cameraRig.drag(dx, dy),
      onViewPinch: (f) => this.cameraRig.zoom(f),
    });
    this.bindUI();
    this.bindSystem();
    this.onResize();
    this.applySettingsToUI();
    this.syncAircraft(0);
    this.cameraRig.update(1, this.physics);
    this.world.update(0, this.camera, this.physics.pos);

    ui.setLoading('Hazır', 1);
    await this.nextFrame();
    ui.hide('loading');
    ui.show('start');
    this.state = 'start';
    if (isIOS() && !isStandalone()) ui.el.startHint.textContent = 'iPhone: Paylaş → Ana Ekrana Ekle ile tam ekran oynayın.';
    this.registerSW();
    this.checkOrientation();
    this.lastTime = performance.now();
    requestAnimationFrame((t) => this.loop(t));
  }

  nextFrame() { return new Promise((r) => requestAnimationFrame(() => r())); }

  setupRenderer() {
    const q = QUALITY_PRESETS[this.settings.quality] || QUALITY_PRESETS.medium;
    const renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: q.pixelRatio <= 1.5, powerPreference: 'high-performance', alpha: false, stencil: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
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
    el.btnStart.addEventListener('click', () => this.start());
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
    this.updateToggleButtons();
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

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
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
  start() {
    this.audio.unlock();
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
    this.physics.reset();
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
    ui.setToggle(ui.el.btnGear, p.gearCmd > 0.5);
    ui.setToggle(ui.el.btnFlap, p.flapsCmd > 0.5);
    ui.setToggle(ui.el.btnBrake, p.brakes);
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
    this.ui.message('Kamera: ' + CAMERA_NAMES[this.cameraRig.mode], 1200);
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
      elevator: sf.elevator, aileron: sf.aileron, rudder: sf.rudder, flaps: p.flapsPos, gear: p.gearPos,
      throttle: p.engine, afterburner: p.abLevel, time: p.time,
      groundSpeed: p.onGround ? p.vel.length() : 0, dt,
    });
  }

  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    if (this.contextLost) return;
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

    if (running) {
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
      this.world.update(running ? dt : 0, this.camera, this.physics.pos);
      this.renderer.render(this.scene, this.camera);
      const cockpit = this.cameraRig.mode === 'cockpit';
      this.hud.draw(this.physics.telemetry, this.camera, this.physics, {
        visible: this.state !== 'start' && cockpit, externalOnly: this.state !== 'start' && !cockpit,
        dt, safe: this.safe, cameraName: CAMERA_NAMES[this.cameraRig.mode],
      });
      this.needsRender = false;
    }
    this.audio.setListener(this.cameraRig.mode === 'cockpit' ? 'cockpit' : 'external', this.cameraRig.doppler, this.cameraRig.distance);
    this.audio.update(dt, this.physics.telemetry, running);
    // FPS göstergesi
    if (this.settings.fps) {
      this.frameCount++; this.fpsTime += dt;
      if (this.fpsTime >= 0.5) {
        this.ui.el.fps.textContent = Math.round(this.frameCount / this.fpsTime) + ' fps · ' + this.renderer.info.render.calls + ' çizim';
        this.frameCount = 0; this.fpsTime = 0;
      }
    }
  }
}

window.__app = new App();
