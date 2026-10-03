// Menüler, kaplamalar, bildirimler.

// ---- Geçişler ----
// Tüm açılır/kapanır katmanlar aynı süre ve eğrileri kullanır (CSS'teki --t-med /
// --t-fast ile aynı). Açılış 200 ms yavaşlayarak, kapanış 150 ms hızlanarak.
// Web Animations API ile yapılır: zorunlu yeniden yerleşim (reflow) gerekmez, bir
// geçiş yarıda kesilirse yenisi o anki görünümden devam eder (sıçrama olmaz).
const T_IN = 200, T_OUT = 150;
const EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const EASE_IN = 'cubic-bezier(0.4, 0, 0.9, 0.6)';
const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
// Katman türüne göre ikincil parçanın başlangıç dönüşümü
const ENTER_FROM = {
  overlay: 'translateY(8px) scale(0.965)',   // panel hafifçe büyüyerek yerleşir
  rise: 'translateY(10px)',                  // alttaki bildirimler yukarı kayar
  drop: 'translateY(-10px)',                 // üstteki kontroller kutusu aşağı iner
  fade: null,
};

export class UI {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.el = {
      loading: $('loading'), loadingText: $('loading-text'), loadingBar: $('loading-bar'), loadingPct: $('loading-pct'),
      loadingProgress: $('loading-progress'), loadingVer: $('loading-ver'), btnLoadRetry: $('btn-load-retry'),
      start: $('start-screen'), btnStart: $('btn-start'), startHint: $('start-hint'),
      pause: $('pause-menu'), btnResume: $('btn-resume'), btnRestart: $('btn-restart'), btnSettings: $('btn-settings'),
      settings: $('settings'), btnSettingsClose: $('btn-settings-close'), qualitySeg: $('quality-seg'), tiltSeg: $('tilt-seg'), soundSeg: $('sound-seg'), fpsSeg: $('fps-seg'), btnCalibrate: $('btn-calibrate'), version: $('version'),
      crash: $('crash'), crashReason: $('crash-reason'), btnCrashRestart: $('btn-crash-restart'),
      orient: $('orient-overlay'), contextLost: $('context-lost'), btnReload: $('btn-reload'),
      standaloneHint: $('standalone-hint'), standaloneHintClose: $('standalone-hint-close'),
      updateToast: $('update-toast'), btnUpdate: $('btn-update'),
      guide: $('guide'), guideClose: $('guide-close'),
      touch: $('touch'), msg: $('msg'), fps: $('fps'),
      btnGear: $('btn-gear'), btnBrake: $('btn-brake'), btnSound: $('btn-sound'), btnLights: $('btn-lights'),
      btnMenu: $('btn-menu'), drawer: $('drawer'),
      select: $('select'), selGrid: $('sel-grid'), selHint: $('sel-hint'), btnAircraft: $('btn-aircraft'), selApRow: $('sel-ap-row'), selLivery: $('sel-livery'),
    };
    this.el.guideClose.addEventListener('click', () => this.hide('guide'));
    // Güvenlik ağı: Esc de kapatır (masaüstü). Mobilde ✕ düğmesi 44x44 px,
    // dolu zeminli ve panelin içinde konumlanır.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen('guide')) { this.hide('guide'); e.stopPropagation(); }
    }, true);
    this.el.standaloneHintClose.addEventListener('click', () => this.hide('standaloneHint'));
    this.el.btnReload.addEventListener('click', () => location.reload());
    if (this.el.btnLoadRetry) this.el.btnLoadRetry.addEventListener('click', () => location.reload());
    this.msgTimer = 0; this.msgClearTimer = 0;
    // İlerleme gösterimi: hedef (gerçek ilerleme) ve ekranda çizilen değer
    this.progTarget = 0; this.progShown = 0; this.progRaf = 0; this.progWaiters = [];
  }

  // ---- Katman aç / kapat (animasyonlu) ----
  show(key) { this.reveal(this.el[key]); }
  hide(key) {
    this.conceal(this.el[key]);
    // Kontroller ekranı kapanınca bekleyen bildirim varsa şimdi gösterilir.
    // İkisi aynı anda açıldığında kısa yatay ekranlarda üst üste biniyorlardı.
    if (key === 'guide' && this._afterGuide) { const f = this._afterGuide; this._afterGuide = null; f(); }
  }
  /** Katman MANTIKSAL olarak açık mı (kapanma animasyonu sürüyorsa kapalı sayılır). */
  isOpen(key) {
    const el = this.el[key];
    return !!el && !el.hidden && !(el._ui && el._ui.phase === 'hiding');
  }
  /** Kontroller ekranı kapanınca bir kez çalışacak iş kaydeder. */
  afterGuide(fn) { if (!this.isOpen('guide')) fn(); else this._afterGuide = fn; }

  _animated() { return typeof Element !== 'undefined' && !!Element.prototype.animate && !reduceMotion() && !document.hidden; }
  // Katmanın ikinci parçası: kaplamalarda panel/kart, diğerlerinde öğenin kendisi
  _parts(el) {
    const kind = el.dataset.anim || (el.classList.contains('overlay') ? 'overlay' : 'fade');
    let inner = null;
    if (kind === 'overlay') inner = el.querySelector(':scope > .panel, :scope > .sel-wrap, :scope > .ld-card');
    return { kind, inner, from: ENTER_FROM[kind] };
  }
  _stop(st) { for (const a of st.anims) { try { a.cancel(); } catch (e) { /* yok */ } } st.anims = []; }

  reveal(el) {
    if (!el) return;
    const st = el._ui || (el._ui = { phase: el.hidden ? 'hidden' : 'shown', anims: [] });
    if (st.phase === 'shown' || st.phase === 'showing') { el.hidden = false; return; }
    // Kapanırken yeniden açılıyorsa o anki saydamlıktan devam et
    const p0 = st.phase === 'hiding' ? Math.min(1, Math.max(0, parseFloat(getComputedStyle(el).opacity) || 0)) : 0;
    this._stop(st);
    el.hidden = false;
    el.classList.remove('ui-closing');
    st.phase = 'showing';
    if (!this._animated()) { st.phase = 'shown'; return; }
    const { kind, inner, from } = this._parts(el);
    const dur = Math.max(60, T_IN * (1 - p0));
    st.anims.push(el.animate([{ opacity: p0 }, { opacity: 1 }], { duration: dur, easing: EASE_OUT }));
    const tEl = kind === 'overlay' ? inner : (from ? el : null);
    if (tEl && from) st.anims.push(tEl.animate([{ transform: from }, { transform: 'none' }], { duration: dur, easing: EASE_OUT }));
    const mine = st.anims.slice();
    const done = () => {
      if (st.phase !== 'showing' || st.anims[0] !== mine[0]) return;
      st.phase = 'shown';
      // Animasyon hâlâ bitmediyse (kare üretilmedi, sekme askıda) son hâle atla:
      // katman hiçbir koşulda saydam ya da kaymış kalmaz.
      for (const a of mine) { try { if (a.playState !== 'finished') a.finish(); } catch (e) { /* yok */ } }
      st.anims = [];
    };
    Promise.all(mine.map((a) => a.finished)).then(done, () => {});
    setTimeout(done, dur + 150);
  }

  conceal(el) {
    if (!el) return;
    const st = el._ui || (el._ui = { phase: el.hidden ? 'hidden' : 'shown', anims: [] });
    if (st.phase === 'hidden' || st.phase === 'hiding') return;
    if (el.hidden) { st.phase = 'hidden'; return; }
    const p0 = st.phase === 'showing' ? Math.min(1, Math.max(0, parseFloat(getComputedStyle(el).opacity) || 0)) : 1;
    this._stop(st);
    st.phase = 'hiding';
    // Kapanan katman dokunuşu hemen bırakır: alttaki ekran anında kullanılabilir
    el.classList.add('ui-closing');
    const finish = () => {
      if (st.phase !== 'hiding') return;
      st.phase = 'hidden';
      el.hidden = true;
      el.classList.remove('ui-closing');
      this._stop(st);
    };
    if (!this._animated() || p0 <= 0.01) { finish(); return; }
    const { kind, inner, from } = this._parts(el);
    const dur = Math.max(50, T_OUT * p0);
    st.anims.push(el.animate([{ opacity: p0 }, { opacity: 0 }], { duration: dur, easing: EASE_IN, fill: 'forwards' }));
    const tEl = kind === 'overlay' ? inner : (from ? el : null);
    if (tEl && from) st.anims.push(tEl.animate([{ transform: 'none' }, { transform: from }], { duration: dur, easing: EASE_IN, fill: 'forwards' }));
    Promise.all(st.anims.map((a) => a.finished)).then(finish, () => {});
    // Güvenlik: sekme arka plana geçerse animasyon olayı gecikebilir
    setTimeout(finish, dur + 120);
  }

  // ---- Yükleme ekranı ----
  // Çubuk ve yüzde AYNI değerden çizilir: ikisi hiçbir an ayrışmaz. Çizilen değer
  // gerçek ilerlemeye kısa bir yumuşatmayla yaklaşır ama onu ASLA geçmez; yani
  // ekrandaki yüzde her zaman tamamlanmış işi gösterir (ya da biraz gerisinde kalır).
  setProgress(frac, text) {
    if (text != null && this.el.loadingText.textContent !== text) this.el.loadingText.textContent = text;
    const f = Math.min(1, Math.max(0, frac || 0));
    if (f > this.progTarget) this.progTarget = f;
    if (!this.progRaf) this.progRaf = requestAnimationFrame((t) => this._progTick(t));
  }
  /** Yeni bir yükleme başlat: gösterge sıfırlanır. */
  resetProgress(text) {
    this.progTarget = 0; this.progShown = 0;
    this.el.loading.classList.remove('failed');
    this.el.loading.setAttribute('aria-busy', 'true');
    this._drawProgress(0);
    if (text != null) this.el.loadingText.textContent = text;
  }
  _drawProgress(v) {
    const pct = Math.floor(v * 100 + 1e-6);
    this.el.loadingBar.style.width = (v * 100).toFixed(2) + '%';
    const txt = pct + '%';
    if (this.el.loadingPct.textContent !== txt) {
      this.el.loadingPct.textContent = txt;
      if (this.el.loadingProgress) this.el.loadingProgress.setAttribute('aria-valuenow', String(pct));
    }
  }
  _progTick(t) {
    this.progRaf = 0;
    const dt = this._progLast ? Math.min(0.1, (t - this._progLast) / 1000) : 0.016;
    this._progLast = t;
    const gap = this.progTarget - this.progShown;
    if (gap > 0) {
      // Yaklaşık 0,2 s zaman sabitiyle yaklaş; en az %40/s hızla ilerle
      this.progShown = Math.min(this.progTarget, this.progShown + Math.max(gap * Math.min(1, dt * 7), 0.4 * dt));
      this._drawProgress(this.progShown);
    }
    if (this.progShown < this.progTarget - 1e-6) this.progRaf = requestAnimationFrame((tt) => this._progTick(tt));
    else {
      this._progLast = 0;
      const w = this.progWaiters; this.progWaiters = [];
      for (const fn of w) fn();
    }
  }
  /** Ekrandaki gösterge gerçek ilerlemeye yetişince çözülür (ör. %100 görünsün diye). */
  progressSettled() {
    if (this.progShown >= this.progTarget - 1e-6) return Promise.resolve();
    return new Promise((res) => { this.progWaiters.push(res); setTimeout(res, 600); });
  }
  loadingError(text) {
    this.el.loadingText.textContent = text;
    this.el.loading.classList.add('failed');
    this.el.loading.setAttribute('aria-busy', 'false');
    this.show('loading');
  }
  /** Eski arayüz: metin + kesir. */
  setLoading(text, frac) { this.setProgress(frac, text); }

  message(text, ms = 2500) {
    const m = this.el.msg;
    clearTimeout(this.msgTimer); clearTimeout(this.msgClearTimer);
    m.textContent = text;
    m.classList.add('show');
    this.msgTimer = setTimeout(() => {
      m.classList.remove('show');
      // Metin, solma bittikten sonra temizlenir (yarıda kesilmez)
      this.msgClearTimer = setTimeout(() => { if (!m.classList.contains('show')) m.textContent = ''; }, 220);
    }, ms);
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
  const def = { quality: 'medium', tilt: 0, sound: 1, fps: 0, aircraft: 'f35a', spawn: 'base' };
  let s;
  try { s = Object.assign(def, JSON.parse(localStorage.getItem('f35a.settings') || '{}')); } catch (e) { return def; }
  // Oyunda yalnızca F-35A var: eski kayıtlardaki başka uçak seçimi ve boya kayıtları atılır
  s.aircraft = 'f35a';
  if (s.livery && typeof s.livery === 'object') s.livery = s.livery.f35a ? { f35a: s.livery.f35a } : {};
  return s;
}
export function saveSettings(s) {
  try { localStorage.setItem('f35a.settings', JSON.stringify(s)); } catch (e) { /* özel mod */ }
}
