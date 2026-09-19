// Menüler, kaplamalar, bildirimler.
export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      loading: $('loading'), loadingText: $('loading-text'), loadingBar: $('loading-bar'),
      start: $('start-screen'), btnStart: $('btn-start'), startHint: $('start-hint'),
      pause: $('pause-menu'), btnResume: $('btn-resume'), btnRestart: $('btn-restart'), btnSettings: $('btn-settings'),
      settings: $('settings'), btnSettingsClose: $('btn-settings-close'), qualitySeg: $('quality-seg'), tiltSeg: $('tilt-seg'), soundSeg: $('sound-seg'), fpsSeg: $('fps-seg'), btnCalibrate: $('btn-calibrate'), version: $('version'),
      crash: $('crash'), crashReason: $('crash-reason'), btnCrashRestart: $('btn-crash-restart'),
      orient: $('orient-overlay'), contextLost: $('context-lost'), btnReload: $('btn-reload'),
      standaloneHint: $('standalone-hint'), standaloneHintClose: $('standalone-hint-close'),
      updateToast: $('update-toast'), btnUpdate: $('btn-update'),
      guide: $('guide'), guideClose: $('guide-close'),
      touch: $('touch'), msg: $('msg'), fps: $('fps'),
      btnGear: $('btn-gear'), btnFlap: $('btn-flap'), btnBrake: $('btn-brake'), btnSound: $('btn-sound'), btnLights: $('btn-lights'),
      btnMenu: $('btn-menu'), drawer: $('drawer'), btnSpoiler: $('btn-spoiler'),
      select: $('select'), selGrid: $('sel-grid'), selHint: $('sel-hint'), btnAircraft: $('btn-aircraft'), selApRow: $('sel-ap-row'),
    };
    this.el.guideClose.addEventListener('click', () => this.hide('guide'));
    // Güvenlik ağı: Esc de kapatır (masaüstü). Mobilde ✕ düğmesi 44x44 px,
    // dolu zeminli ve panelin içinde konumlanır.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.el.guide.hidden) { this.hide('guide'); e.stopPropagation(); }
    }, true);
    this.el.standaloneHintClose.addEventListener('click', () => this.hide('standaloneHint'));
    this.el.btnReload.addEventListener('click', () => location.reload());
    this.msgTimer = 0;
  }
  show(key) { this.el[key].hidden = false; }
  hide(key) {
    this.el[key].hidden = true;
    // Kontroller ekranı kapanınca bekleyen bildirim varsa şimdi gösterilir.
    // İkisi aynı anda açıldığında kısa yatay ekranlarda üst üste biniyorlardı.
    if (key === 'guide' && this._afterGuide) { const f = this._afterGuide; this._afterGuide = null; f(); }
  }
  /** Kontroller ekranı kapanınca bir kez çalışacak iş kaydeder. */
  afterGuide(fn) { if (this.el.guide.hidden) fn(); else this._afterGuide = fn; }
  setLoading(text, frac) {
    this.el.loadingText.textContent = text;
    this.el.loadingBar.style.width = Math.round(frac * 100) + '%';
  }
  message(text, ms = 2500) {
    this.el.msg.textContent = text;
    clearTimeout(this.msgTimer);
    this.msgTimer = setTimeout(() => { this.el.msg.textContent = ''; }, ms);
  }
  setSeg(seg, attr, value) {
    for (const b of seg.querySelectorAll('button')) b.classList.toggle('on', b.dataset[attr] === String(value));
  }
  bindSeg(seg, attr, fn) {
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      this.setSeg(seg, attr, b.dataset[attr]);
      fn(b.dataset[attr]);
    });
  }
  setToggle(btn, on) { btn.classList.toggle('on', !!on); }
  // İkincil kontroller çekmecesi (Duraklat / Kamera / Ses / Işık): açılır-kapanır, 7 s hareketsizlikte kendini kapatır
  setMenu(open) {
    const d = this.el.drawer, b = this.el.btnMenu;
    if (!d || !b) return;
    d.classList.toggle('open', open);
    document.body.classList.toggle('menu-open', open);
    d.setAttribute('aria-hidden', String(!open));
    b.setAttribute('aria-expanded', String(open));
    b.classList.toggle('on', open);
    clearTimeout(this._menuTimer);
    if (open) this._menuTimer = setTimeout(() => this.setMenu(false), this.menuAutoClose || 7000);
  }
  toggleMenu() { this.setMenu(!this.isMenuOpen()); }
  isMenuOpen() { return !!(this.el.drawer && this.el.drawer.classList.contains('open')); }
  menuActivity() { if (this.isMenuOpen()) this.setMenu(true); }
  showCrash(reason) { this.el.crashReason.textContent = reason; this.show('crash'); }
}

export function isStandalone() {
  return window.navigator.standalone === true || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
}
export function isIOS() {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function loadSettings() {
  try { return Object.assign({ quality: 'medium', tilt: 0, sound: 1, fps: 0, aircraft: 'f35a', spawn: 'base' }, JSON.parse(localStorage.getItem('f35a.settings') || '{}')); }
  catch (e) { return { quality: 'medium', tilt: 0, sound: 1, fps: 0, aircraft: 'f35a', spawn: 'base' }; }
}
export function saveSettings(s) {
  try { localStorage.setItem('f35a.settings', JSON.stringify(s)); } catch (e) { /* özel mod */ }
}
