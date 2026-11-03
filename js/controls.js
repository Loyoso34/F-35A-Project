// Dokunmatik (Pointer Events, çoklu dokunuş), klavye ve isteğe bağlı eğim (DeviceOrientation) girişleri.
import { clamp } from './noise.js';

const STICK_RADIUS = 60; // px
const AB_DETENT = 1.0;   // gaz kolu 0..1.15; 1.0 üzeri art yakıcı
// Çubuk yumuşatma hızı (1/s). main.js aynı yumuşatmayı 120 Hz fizik alt adımlarında
// uygular; böylece komut kare hızından bağımsız olarak aynı sürekli eğriyi izler.
export const STICK_SMOOTH = 14;
// Klavye çubuğu (v5.1): tuş basılıyken sapma kademeli artar (0 -> tam ≈ 0,38 s), bırakınca
// ya da ters yöne basınca hızla merkeze döner. Eskiden tuş anında TAM sapma veriyordu: kısa bir
// dokunuş bile 9 g çekiş ya da tam yatış demekti, masaüstünde ince düzeltme yapılamıyordu.
const KB_RISE = 2.6, KB_RETURN = 7.5;   // 1/s
// Gaz kolu tuşları. Ctrl (gaz azalt) + W/S/D tarayıcıda sekme kapat / kaydet / yer imi
// kısayollarına denk geliyordu; uçuş tuşlarında varsayılan davranış engellenir, ayrıca
// kısayolsuz seçenekler vardır (+/−, Page Up/Down).
const THR_UP_KEYS = ['ShiftLeft', 'ShiftRight', 'Equal', 'NumpadAdd', 'PageUp'];
const THR_DOWN_KEYS = ['ControlLeft', 'ControlRight', 'Minus', 'NumpadSubtract', 'PageDown'];
const FLIGHT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...THR_UP_KEYS, ...THR_DOWN_KEYS]);
const THROTTLE_KEY_RATE = 0.5;   // kol/s (rölantiden askeri güce ~2 s)
// Oyun kumandası (v5.1, Gamepad API "standard" eşlemesi): sol çubuk yunuslama/yatış, sağ çubuk bakış,
// RT/LT gaz (basınçla orantılı hız), LB/RB dümen, A ateş, B fren, X takım, Y kamera, D-pad ↑/↓ flap,
// ← ışıklar, → ses, Start duraklat, Back/View kontroller ekranı, R3 bakışı ortala.
const GP_DEAD = 0.14;            // çubuk ölü bölgesi (yarıçapsal)
const GP_THROTTLE_RATE = 0.7;    // kol/s, tetik tam basılıyken
const GP_LOOK = 340;             // px/s eşdeğeri bakış sürüklemesi (sağ çubuk tam sapmada)
const GP = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, BACK: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };
/** Yarıçapsal ölü bölge + yeniden ölçekleme: küçük çubuk kayması girdi üretmez, tam sapma 1 kalır. */
function deadzone2(x, y) {
  const r = Math.hypot(x, y);
  if (r < GP_DEAD) return [0, 0];
  const k = Math.min(1, (r - GP_DEAD) / (1 - GP_DEAD)) / r;
  return [x * k, y * k];
}
/** Klavye ekseni: hedefe doğru artış hızı KB_RISE, merkeze (ya da merkezden geçerek ters yöne) KB_RETURN. */
function rampAxis(v, target, dt) {
  const toward = target === 0 || (v !== 0 && Math.sign(target) !== Math.sign(v)) ? 0 : target;
  const rate = toward === 0 ? KB_RETURN : KB_RISE;
  const d = toward - v, step = rate * dt;
  return Math.abs(d) <= step ? toward : v + Math.sign(d) * step;
}

export class Controls {
  constructor(callbacks = {}) {
    this.cb = callbacks;
    this.state = { pitch: 0, roll: 0, yaw: 0, throttle: 0, afterburner: false };
    this.raw = { pitch: 0, roll: 0, yaw: 0 };   // yumuşatılmamış hedef (fizik alt adımlarında yumuşatılır)
    this.lever = 0; // 0..leverMax
    this.leverMax = 1.15;   // üst %15: art yakıcı kademesi
    this.enabled = false;
    this.keys = new Set();
    this.kb = { pitch: 0, roll: 0 };   // klavye çubuğu (kademeli, bkz. rampAxis)
    this.gp = { index: -1, prev: [], pitch: 0, roll: 0, rudder: 0, active: false };   // oyun kumandası
    this.stickPointer = null;
    this.stickOrigin = { x: 0, y: 0 };
    this.stickVec = { x: 0, y: 0 };
    this.throttlePointer = null;
    this.rudder = 0;           // -1..1 (kaydırıcı)
    this.rudderHeld = false;
    this.rudderPointer = null;
    this.rudderKey = 0;
    this.tiltEnabled = false;
    this.tilt = { beta: 0, gamma: 0, has: false };
    this.tiltZero = { beta: 0, gamma: 0 };
    this.tiltOut = { pitch: 0, roll: 0 };
    this.viewPointers = new Map();
    this.lastPinchDist = 0;
    this.els = {
      stickZone: document.getElementById('stick-zone'),
      stickBase: document.getElementById('stick-base'),
      stickKnob: document.getElementById('stick-knob'),
      throttle: document.getElementById('throttle'),
      throttleTrack: document.getElementById('throttle-track'),
      throttleKnob: document.getElementById('throttle-knob'),
      throttleFill: document.getElementById('throttle-fill'),
      touch: document.getElementById('touch'),
      rudder: document.getElementById('rudder'),
      rudderKnob: document.getElementById('rudder-knob'),
      flaps: document.getElementById('flaps'),
      flapsTrack: document.getElementById('flaps-track'),
      flapsFill: document.getElementById('flaps-fill'),
      flapsKnob: document.getElementById('flaps-knob'),
    };
    // Flap kolu durumu: kademe adları uçaktan gelir, kol her zaman 0'da başlar.
    this.flapNames = ['0'];
    this.flapNotes = [''];
    this.flapIndex = 0;
    this.flapPointer = null;
    this.bindStick();
    this.bindThrottle();
    this.bindRudder();
    this.bindFlaps();
    this.bindButtons();
    this.bindKeyboard();
    this.bindView();
    this.onOrientation = (e) => {
      if (e.beta === null || e.beta === undefined) return;
      this.tilt.beta = e.beta; this.tilt.gamma = e.gamma; this.tilt.has = true;
    };
    // Ekran döndüğünde / yeniden boyutlandığında kol topuzları px cinsinden
    // ESKİ yüksekliğe göre konumlanmış kalıyordu: kısa yatay ekranda gaz topuzu
    // ekranın altına taşıyor ve yüzde yazısı kırpılıyordu. İkisini de tazele.
    this.onResize = () => { this.setThrottleUI(); this.setFlapUI(this.flapIndex); };
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', this.onResize);
    window.addEventListener('gamepadconnected', (e) => {
      this.gp.index = e.gamepad.index; this.gp.prev = [];
      this.cb.onGamepad && this.cb.onGamepad(e.gamepad.id, true);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (e.gamepad.index !== this.gp.index) return;
      this.gp.index = -1; this.gp.active = false; this.gp.pitch = this.gp.roll = this.gp.rudder = 0;
      this.cb.onGamepad && this.cb.onGamepad(e.gamepad.id, false);
    });
    document.addEventListener('gesturestart', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('gesturechange', (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
    this.setThrottleUI();
    // İlk yüklemede de nötr: satır içi stil kalıntısı yok, topuz geometrik merkezde
    this.releaseStick();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) {
      this.releaseStick(); this.rudderHeld = false; this.rudderPointer = null; this.keys.clear();
      this.kb.pitch = this.kb.roll = 0;
      this.throttlePointer = null; this.flapPointer = null;
      if (this.els.flaps) this.els.flaps.classList.remove('moving');
      if (this.els.rudderKnob) this.els.rudderKnob.classList.remove('active');
    }
  }

  /**
   * Tüm geçici girdi durumunu nötre alır (yeniden başlatma / çarpışma sonrası): çubuk ve
   * dümen merkezde, yumuşatılmış komutlar sıfır. Gaz kolu ayrı (resetLever).
   */
  resetInputs() {
    this.releaseStick();
    this.rudder = 0; this.rudderHeld = false; this.rudderPointer = null; this.rudderKey = 0;
    if (this.els.rudderKnob) this.els.rudderKnob.classList.remove('active');
    this.updateRudderUI();
    this.raw.pitch = this.raw.roll = this.raw.yaw = 0;
    this.state.pitch = this.state.roll = this.state.yaw = 0;
    this.kb.pitch = this.kb.roll = 0;
    this.keys.clear();
  }

  // ---- Joystick ----
  // Girdi ile görüntü ayrıdır: stickVec (−1..1) yalnızca parmağın dokunuş noktasına
  // göre sapmasından (STICK_RADIUS px = tam sapma) gelir. Topuz bu DEĞERİ halkanın
  // içinde gösterir; görsel merkezleme hiçbir zaman girdiyi geciktirmez ya da değiştirmez.
  bindStick() {
    const z = this.els.stickZone;
    z.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      if (e.target.closest && e.target.closest('.btn')) return;
      // Önceki parmağın bırakma olayı kaybolduysa (iOS: sistem hareketi, bildirim, ekran
      // kenarı) çubuk kilitli kalıyordu: yeni dokunuş eskisinin yerini alır.
      if (this.stickPointer !== null) this.releaseStick();
      this.stickPointer = e.pointerId;
      z.setPointerCapture && z.setPointerCapture(e.pointerId);
      const r = z.getBoundingClientRect();
      this.stickOrigin = { x: e.clientX - r.left, y: e.clientY - r.top };
      // Halka dokunuş noktasına ortalanır. Yarıçap ölçülür: halka çapı ekrana göre
      // 66–86 px'tir (v4.0: önceki 82–108 px'in %80'i; girdi duyarlılığı STICK_RADIUS ile aynı kaldı) (eskiden sabit 60 px varsayılıyordu ve halka parmağın altında
      // değil yanında açılıyordu).
      const half = this.els.stickBase.offsetWidth / 2 || 43;
      const b = this.els.stickBase.style;
      b.left = (this.stickOrigin.x - half) + 'px';
      b.top = (this.stickOrigin.y - half) + 'px';
      b.bottom = 'auto';
      this.els.stickKnob.classList.add('active');
      this.updateStick(e);
      e.preventDefault();
    });
    z.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickPointer) this.updateStick(e); });
    const end = (e) => { if (e.pointerId === this.stickPointer) this.releaseStick(); };
    z.addEventListener('pointerup', end);
    z.addEventListener('pointercancel', end);
    z.addEventListener('lostpointercapture', end);
    // Parmak bölge dışında / sayfa dışında bırakılsa ya da sayfa arka plana gitse de çubuk merkeze döner
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    window.addEventListener('blur', () => this.releaseStick());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.releaseStick(); });
  }
  updateStick(e) {
    const r = this.els.stickZone.getBoundingClientRect();
    let dx = e.clientX - r.left - this.stickOrigin.x;
    let dy = e.clientY - r.top - this.stickOrigin.y;
    const len = Math.hypot(dx, dy);
    if (len > STICK_RADIUS) { dx *= STICK_RADIUS / len; dy *= STICK_RADIUS / len; }
    this.stickVec = { x: dx / STICK_RADIUS, y: dy / STICK_RADIUS };
    this.setKnob(this.stickVec.x, this.stickVec.y);
  }
  /** Topuzu girdi değerine (−1..1) göre halkanın içinde konumlar; 0,0 tam merkezdir. */
  setKnob(vx, vy) {
    const base = this.els.stickBase, knob = this.els.stickKnob;
    // Topuz merkezinin gidebileceği en büyük yarıçap: halka iç kenarına kadar
    const travel = Math.max(0, (base.clientWidth - knob.offsetWidth * 0.55) / 2);
    const x = vx * travel, y = vy * travel;
    knob.style.transform = (x === 0 && y === 0) ? 'translate3d(0, 0, 0)' : `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
  }
  releaseStick() {
    this.stickPointer = null;
    this.stickVec = { x: 0, y: 0 };
    this.setKnob(0, 0);
    this.els.stickKnob.classList.remove('active');
    const b = this.els.stickBase.style;
    b.left = ''; b.top = ''; b.bottom = '';
  }

  // ---- Gaz kolu ----
  bindThrottle() {
    const t = this.els.throttle;
    t.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.throttlePointer = e.pointerId;
      t.setPointerCapture && t.setPointerCapture(e.pointerId);
      this.updateThrottle(e);
      e.preventDefault();
    });
    t.addEventListener('pointermove', (e) => { if (e.pointerId === this.throttlePointer) this.updateThrottle(e); });
    const end = (e) => { if (e.pointerId === this.throttlePointer) this.throttlePointer = null; };
    t.addEventListener('pointerup', end);
    t.addEventListener('pointercancel', end);
  }
  updateThrottle(e) {
    const r = this.els.throttleTrack.getBoundingClientRect();
    const f = clamp(1 - (e.clientY - r.top) / r.height, 0, 1); // 0 alt, 1 üst
    this.lever = f * this.leverMax;
    // Art yakıcı bölgesine (üst %15) girildiğinde kademe: tam gaz + AB
    if (this.leverMax > 1.05 && this.lever > 1.0 && this.lever < 1.06) this.lever = 1.0;
    this.setThrottleUI();
  }
  setThrottleUI() {
    const r = this.els.throttleTrack;
    const h = r.clientHeight || 200;
    const f = this.lever / this.leverMax;
    // Topuz merkezi izin İÇİNDE tutulur. Önceden merkez doluluk çizgisine konuyor,
    // margin-top:-22px ile yarısı izin dışına taşıyordu: %0'da topuzun alt yarısı ve
    // içindeki yüzde yazısı ekranın altında kalıyordu (kısa yatay ekranlarda görünür).
    const half = (this.els.throttleKnob.offsetHeight || 44) / 2;
    this.els.throttleKnob.style.top = clamp(h * (1 - f), half, Math.max(half, h - half)) + 'px';
    this.els.throttleFill.style.height = (f * 100) + '%';
    const ab = this.lever > AB_DETENT + 0.01;
    this.els.throttleKnob.textContent = ab ? 'AB' : Math.round(Math.min(this.lever, 1) * 100) + '%';
    // AB: parlak beyaz kenar (renk uyarıya ayrılmıştır; art yakıcı normal bir durumdur)
    this.els.throttleKnob.style.borderColor = ab ? '#ffffff' : '';
    this.els.throttleKnob.style.boxShadow = ab ? '0 0 0 2px rgba(203,224,245,0.35), 0 2px 8px rgba(0,0,0,0.5)' : '';
  }

  // ---- Yaylı analog rudder kaydırıcısı ----
  bindRudder() {
    const r = this.els.rudder;
    if (!r) return;
    const setFrom = (e) => {
      const rect = r.getBoundingClientRect();
      // Topuz yarıçapı + 3 px: topuz izin içinde kalır (v4.0 %80 ölçekte de parmağı birebir izler)
      const half = rect.width / 2 - ((this.els.rudderKnob && this.els.rudderKnob.offsetWidth) || 38) / 2 - 3;
      this.rudder = clamp((e.clientX - (rect.left + rect.width / 2)) / half, -1, 1);
      this.updateRudderUI();
    };
    r.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.rudderPointer = e.pointerId;
      this.rudderHeld = true;
      this.els.rudderKnob.classList.add('active');
      r.setPointerCapture && r.setPointerCapture(e.pointerId);
      setFrom(e);
      e.preventDefault();
    });
    r.addEventListener('pointermove', (e) => { if (e.pointerId === this.rudderPointer && this.rudderHeld) setFrom(e); });
    const end = (e) => { if (e.pointerId === this.rudderPointer) { this.rudderHeld = false; this.rudderPointer = null; this.els.rudderKnob.classList.remove('active'); } };
    r.addEventListener('pointerup', end);
    r.addEventListener('pointercancel', end);
    r.addEventListener('lostpointercapture', end);
    r.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  updateRudderUI() {
    const r = this.els.rudder;
    if (!r) return;
    const half = r.clientWidth / 2 - ((this.els.rudderKnob && this.els.rudderKnob.offsetWidth) || 38) / 2 - 3;
    this.els.rudderKnob.style.transform = `translateX(${this.rudder * half}px)`;
  }

  // ---- Flap kolu ----
  // Dikey bir koldur: ÜST uç 0 (temiz), ALT uç son kademe. Sürüklerken en yakın
  // kademeye oturur; ize dokunmak da o kademeye atlar. Her zaman 0'da başlar.
  bindFlaps() {
    const f = this.els.flaps;
    if (!f) return;
    const pick = (e) => {
      const r = this.els.flapsTrack.getBoundingClientRect();
      const n = this.flapNames.length;
      if (n < 2 || r.height <= 0) return;
      const t = clamp((e.clientY - r.top) / r.height, 0, 1);   // 0 üst = temiz
      const i = Math.round(t * (n - 1));
      if (i !== this.flapIndex) { this.flapIndex = i; this.cb.onFlapIndex && this.cb.onFlapIndex(i); }
      this.setFlapUI(this.flapIndex);
    };
    f.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      this.flapPointer = e.pointerId;
      f.setPointerCapture && f.setPointerCapture(e.pointerId);
      f.classList.add('moving');
      pick(e); e.preventDefault();
    });
    f.addEventListener('pointermove', (e) => { if (e.pointerId === this.flapPointer) { pick(e); e.preventDefault(); } });
    const end = (e) => {
      if (e.pointerId !== this.flapPointer) return;
      this.flapPointer = null; f.classList.remove('moving');
    };
    f.addEventListener('pointerup', end);
    f.addEventListener('pointercancel', end);
    f.addEventListener('lostpointercapture', end);
    f.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  /** Uçak kurulunca kademeleri kurar ve kolu 0'a alır. */
  setFlapDetents(names, notes) {
    this.flapNames = (names && names.length) ? names.slice() : ['0'];
    this.flapNotes = (notes && notes.length === this.flapNames.length) ? notes.slice() : this.flapNames.map(() => '');
    // Kademe çizgileri
    const tr = this.els.flapsTrack;
    if (tr) {
      for (const d of [...tr.querySelectorAll('.flap-det')]) d.remove();
      const n = this.flapNames.length;
      for (let i = 0; i < n; i++) {
        const d = document.createElement('div');
        d.className = 'flap-det' + (i === 0 ? ' first' : '');
        d.style.top = (i / Math.max(1, n - 1)) * 100 + '%';
        tr.appendChild(d);
      }
    }
    this.flapIndex = 0;
    this.setFlapUI(0);
  }
  /** Kolu verilen kademeye taşır (fizikten gelen durumla da çağrılır). */
  setFlapUI(index) {
    const n = this.flapNames.length;
    this.flapIndex = clamp(index | 0, 0, n - 1);
    const tr = this.els.flapsTrack, kn = this.els.flapsKnob;
    if (!tr || !kn) return;
    const h = tr.clientHeight || 160;
    const frac = n > 1 ? this.flapIndex / (n - 1) : 0;
    const half = (kn.offsetHeight || 36) / 2;
    // Topuz izin İÇİNDE kalır: uçlarda yarısı dışarı taşıp yazısı kırpılmasın
    kn.style.top = (tr.offsetTop + clamp(h * frac, half, Math.max(half, h - half))) + 'px';
    if (this.els.flapsFill) this.els.flapsFill.style.height = (frac * 100) + '%';
    kn.querySelector('b').textContent = this.flapNames[this.flapIndex];
    kn.querySelector('span').textContent = this.flapNotes[this.flapIndex] || '';
    const f = this.els.flaps;
    if (f) {
      f.setAttribute('aria-valuemax', String(n - 1));
      f.setAttribute('aria-valuenow', String(this.flapIndex));
      f.setAttribute('aria-valuetext', 'Flaps ' + this.flapNames[this.flapIndex] + (this.flapNotes[this.flapIndex] ? ' (' + this.flapNotes[this.flapIndex] + ')' : ''));
    }
  }

  // ---- Düğmeler ----
  bindButtons() {
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      let lastT = 0;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        const now = performance.now();
        if (now - lastT < 250) return; // çift tetiklemeyi önle
        lastT = now;
        fn();
      });
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    };
    tap('btn-gear', () => this.cb.onGear && this.cb.onGear());
    tap('btn-brake', () => this.cb.onBrake && this.cb.onBrake());
    // FIRE: tek basış = tek fırlatma isteği (sıra/soğuma silah sisteminde)
    if (document.getElementById('btn-fire')) tap('btn-fire', () => this.cb.onFire && this.cb.onFire());
    const secondary = (fn) => () => { this.cb.onMenuActivity && this.cb.onMenuActivity(); fn(); };
    tap('btn-menu', () => this.cb.onMenu && this.cb.onMenu());
    tap('btn-camera', secondary(() => this.cb.onCamera && this.cb.onCamera()));
    tap('btn-sound', secondary(() => this.cb.onSound && this.cb.onSound()));
    tap('btn-pause', secondary(() => this.cb.onPause && this.cb.onPause()));
    tap('btn-lights', secondary(() => this.cb.onLights && this.cb.onLights()));
  }

  // ---- Serbest kamera için sürükleme / pinch (merkez bölge) ----
  bindView() {
    const hud = document.getElementById('view-zone');
    if (!hud) return;
    hud.addEventListener('pointerdown', (e) => {
      if (!this.enabled) return;
      // Çift dokunuş: bakışı ileri toparla. Mobilde kokpitte etrafa bakındıktan sonra
      // hızlıca öne dönmenin en doğal yolu.
      const now = performance.now();
      if (this.viewPointers.size === 0 && now - (this._lastViewTap || 0) < 300) {
        this.cb.onViewRecenter && this.cb.onViewRecenter();
      }
      this._lastViewTap = now;
      this.viewPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      hud.setPointerCapture && hud.setPointerCapture(e.pointerId);
      if (this.viewPointers.size === 2) {
        const [a, b] = [...this.viewPointers.values()];
        this.lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
      e.preventDefault();
    });
    hud.addEventListener('pointermove', (e) => {
      const p = this.viewPointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (this.viewPointers.size === 1) {
        this.cb.onViewDrag && this.cb.onViewDrag(dx, dy);
      } else if (this.viewPointers.size === 2) {
        const [a, b] = [...this.viewPointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.lastPinchDist > 0) this.cb.onViewPinch && this.cb.onViewPinch(d / this.lastPinchDist);
        this.lastPinchDist = d;
      }
    });
    const end = (e) => { this.viewPointers.delete(e.pointerId); this.lastPinchDist = 0; };
    hud.addEventListener('pointerup', end);
    hud.addEventListener('pointercancel', end);
    hud.addEventListener('wheel', (e) => { this.cb.onViewPinch && this.cb.onViewPinch(e.deltaY > 0 ? 1.1 : 0.9); e.preventDefault(); }, { passive: false });
  }

  // ---- Klavye ----
  bindKeyboard() {
    window.addEventListener('keydown', (e) => {
      // Uçuşta, uçuş tuşlarının tarayıcı kısayolları (Ctrl+S, Ctrl+D, Ctrl+E…) çalışmaz. Ctrl+W
      // gibi engellenemeyen kısayollar için main.js sayfadan çıkışta onay ister.
      if (this.enabled && FLIGHT_KEYS.has(e.code)) e.preventDefault();
      if (e.repeat) { this.keys.add(e.code); return; }
      this.keys.add(e.code);
      if (!this.enabled && e.code !== 'KeyP' && e.code !== 'Escape' && e.code !== 'KeyH') return;
      switch (e.code) {
        case 'KeyG': this.cb.onGear && this.cb.onGear(); break;
        case 'KeyF': this.cb.onFlaps && this.cb.onFlaps(); break;
        case 'KeyB': this.cb.onBrake && this.cb.onBrake(); break;
        case 'KeyC': this.cb.onCamera && this.cb.onCamera(); break;
        case 'KeyM': this.cb.onSound && this.cb.onSound(); break;
        case 'KeyL': this.cb.onLights && this.cb.onLights(); break;
        case 'KeyR': this.cb.onViewRecenter && this.cb.onViewRecenter(); break;   // bakışı ortala
        case 'Space': this.cb.onFire && this.cb.onFire(); break;                   // füze (basılı tutmak tekrar ateşlemez)
        case 'KeyP': case 'Escape': this.cb.onPause && this.cb.onPause(); break;
        case 'KeyH': this.cb.onHelp && this.cb.onHelp(); break;                     // kontroller ekranı
        // I: geliştirici fizik paneli (§40). Normal oyunda kapalı. (Eskiden Shift+D idi: Shift gaz
        // artırır, D sağa yatırır — gaz verirken sağa yatan pilot paneli açıp kapatıyordu.)
        case 'KeyI': this.cb.onPhysDebug && this.cb.onPhysDebug(); break;
        // `: performans katmanı (kare süreleri, çizim çağrıları, bellek tahmini)
        case 'Backquote': this.cb.onPerfDebug && this.cb.onPerfDebug(); break;
        default: return;
      }
      e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  // ---- Oyun kumandası ----
  /**
   * Kumandayı okur. flying = true: tüm eşleme; false (duraklatılmış): yalnızca Start (devam) ve Back.
   * Düğmeler kenar algılamalıdır (basılı tutmak tekrar tetiklemez).
   */
  pollGamepad(dt, flying) {
    const G = this.gp;
    if (G.index < 0 || typeof navigator === 'undefined' || !navigator.getGamepads) { G.active = false; return; }
    const pad = navigator.getGamepads()[G.index];
    if (!pad || !pad.connected) { G.active = false; return; }
    const b = pad.buttons, prev = G.prev;
    const val = (i) => (b[i] ? (typeof b[i] === 'object' ? b[i].value : b[i]) : 0);
    const down = (i) => !!(b[i] && (b[i].pressed || val(i) > 0.5));
    const edge = (i) => { const d = down(i); const e = d && !prev[i]; return e; };
    const cb = this.cb;
    if (edge(GP.START)) (cb.onGamepadStart || cb.onPause || (() => {}))();
    if (edge(GP.BACK)) cb.onHelp && cb.onHelp();
    if (flying) {
      if (edge(GP.A)) cb.onFire && cb.onFire();
      if (edge(GP.B)) cb.onBrake && cb.onBrake();
      if (edge(GP.X)) cb.onGear && cb.onGear();
      if (edge(GP.Y)) cb.onCamera && cb.onCamera();
      if (edge(GP.LEFT)) cb.onLights && cb.onLights();
      if (edge(GP.RIGHT)) cb.onSound && cb.onSound();
      if (edge(GP.R3)) cb.onViewRecenter && cb.onViewRecenter();
      const n = this.flapNames.length;
      if (edge(GP.UP) && this.flapIndex > 0) cb.onFlapIndex && cb.onFlapIndex(this.flapIndex - 1);
      if (edge(GP.DOWN) && this.flapIndex < n - 1) cb.onFlapIndex && cb.onFlapIndex(this.flapIndex + 1);
      const ax = pad.axes || [];
      const [lx, ly] = deadzone2(ax[0] || 0, ax[1] || 0);
      const [rx, ry] = deadzone2(ax[2] || 0, ax[3] || 0);
      G.roll = lx; G.pitch = ly;   // çubuğu kendine çekmek (aşağı, +) = burun yukarı, dokunmatik çubukla aynı
      G.rudder = (down(GP.RB) ? 1 : 0) - (down(GP.LB) ? 1 : 0);
      if (rx || ry) cb.onViewDrag && cb.onViewDrag(rx * GP_LOOK * dt, ry * GP_LOOK * dt);
      const thr = val(GP.RT) - val(GP.LT);
      if (Math.abs(thr) > 0.05) { this.lever = clamp(this.lever + thr * GP_THROTTLE_RATE * dt, 0, this.leverMax); this.setThrottleUI(); }
      G.active = !!(lx || ly);
    } else { G.active = false; G.pitch = G.roll = G.rudder = 0; }
    for (let i = 0; i < b.length; i++) prev[i] = down(i);
  }

  // ---- Eğim ----
  async setTiltEnabled(on) {
    if (on) {
      const ok = await this.requestTiltPermission();
      if (!ok) { this.tiltEnabled = false; return false; }
      window.addEventListener('deviceorientation', this.onOrientation);
      this.tiltEnabled = true;
      this.tilt.has = false;
      setTimeout(() => this.calibrate(), 600);
      return true;
    }
    window.removeEventListener('deviceorientation', this.onOrientation);
    this.tiltEnabled = false;
    return true;
  }
  async requestTiltPermission() {
    try {
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        const res = await DeviceOrientationEvent.requestPermission();
        return res === 'granted';
      }
      return typeof DeviceOrientationEvent !== 'undefined';
    } catch (err) {
      return false;
    }
  }
  calibrate() {
    this.tiltZero.beta = this.tilt.beta;
    this.tiltZero.gamma = this.tilt.gamma;
  }
  screenAngle() {
    if (screen.orientation && typeof screen.orientation.angle === 'number') return screen.orientation.angle;
    if (typeof window.orientation === 'number') return (window.orientation + 360) % 360;
    return 90;
  }
  computeTilt() {
    if (!this.tiltEnabled || !this.tilt.has) { this.tiltOut.pitch = 0; this.tiltOut.roll = 0; return; }
    let db = this.tilt.beta - this.tiltZero.beta;
    let dg = this.tilt.gamma - this.tiltZero.gamma;
    if (dg > 90) dg -= 180; else if (dg < -90) dg += 180;
    if (db > 180) db -= 360; else if (db < -180) db += 360;
    const ang = this.screenAngle();
    let roll, pitch;
    if (ang === 90) { roll = db; pitch = -dg; }
    else if (ang === 270 || ang === -90) { roll = -db; pitch = dg; }
    else if (ang === 180) { roll = -dg; pitch = -db; }
    else { roll = dg; pitch = db; } // portre (kullanılmaz)
    const dead = 2, range = 28;
    const map = (v) => { const a = Math.abs(v); if (a < dead) return 0; return clamp(Math.sign(v) * (a - dead) / (range - dead), -1, 1); };
    this.tiltOut.roll = map(roll);
    this.tiltOut.pitch = map(pitch);
  }

  update(dt) {
    const k = this.keys;
    let pitch = 0, roll = 0, yaw = 0;
    let kp = 0, kr = 0;
    this.pollGamepad(dt, this.enabled);
    if (this.enabled) {
      if (k.has('KeyS') || k.has('ArrowDown')) kp += 1;
      if (k.has('KeyW') || k.has('ArrowUp')) kp -= 1;
      if (k.has('KeyD') || k.has('ArrowRight')) kr += 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) kr -= 1;
      if (k.has('KeyE')) this.rudderKey = 1; else if (k.has('KeyQ')) this.rudderKey = -1; else this.rudderKey = this.gp.rudder;
      const up = THR_UP_KEYS.some((c) => k.has(c)), down = THR_DOWN_KEYS.some((c) => k.has(c));
      if (up && !down) { this.lever = Math.min(this.leverMax, this.lever + dt * THROTTLE_KEY_RATE); this.setThrottleUI(); }
      else if (down && !up) { this.lever = Math.max(0, this.lever - dt * THROTTLE_KEY_RATE); this.setThrottleUI(); }
    } else this.rudderKey = 0;
    this.kb.pitch = rampAxis(this.kb.pitch, kp, dt);
    this.kb.roll = rampAxis(this.kb.roll, kr, dt);
    pitch = this.kb.pitch; roll = this.kb.roll;
    this.computeTilt();
    if (this.stickPointer !== null) {
      pitch = this.stickVec.y; roll = this.stickVec.x;
    } else if (this.gp.active && !kp && !kr) {
      pitch = this.gp.pitch; roll = this.gp.roll;
    } else if (this.tiltEnabled && !kp && !kr && !this.kb.pitch && !this.kb.roll) {
      pitch = this.tiltOut.pitch; roll = this.tiltOut.roll;
    }
    // Rudder: kaydırıcı basılıysa doğrudan; klavye basılıysa hedefe yaklaş; bırakılınca yay ile tam ortaya dön
    if (this.rudderHeld) { /* pointermove ayarlar */ }
    else if (this.rudderKey !== 0) { this.rudder += (this.rudderKey - this.rudder) * (1 - Math.exp(-dt * 10)); this.updateRudderUI(); }
    else if (this.rudder !== 0) {
      this.rudder *= Math.exp(-dt * 14);
      if (Math.abs(this.rudder) < 0.004) this.rudder = 0;
      this.updateRudderUI();
    }
    yaw += this.rudder;
    const r = this.raw;
    r.pitch = clamp(pitch, -1, 1); r.roll = clamp(roll, -1, 1); r.yaw = clamp(yaw, -1, 1);
    // Yumuşatma: ani sıçramaları azalt (kare sonu değeri; fizik aynısını alt adımlarda yapar)
    const s = this.state;
    const sm = 1 - Math.exp(-dt * STICK_SMOOTH);
    s.pitch += (r.pitch - s.pitch) * sm;
    s.roll += (r.roll - s.roll) * sm;
    s.yaw += (r.yaw - s.yaw) * sm;
    s.throttle = Math.min(this.lever, 1);
    s.afterburner = this.lever > AB_DETENT + 0.01;
  }

  resetLever(v = 0) { this.lever = Math.min(v, this.leverMax); this.setThrottleUI(); }
}
