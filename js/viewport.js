// Görüntü alanı: uygulamanın GERÇEK boyutunun tek kaynağı.
//
// Neden ayrı ve modül olmayan bir betik: <head> içinde, sayfa daha çizilmeden
// çalışır. Yükleme ekranı da dahil her katman ilk kareden itibaren bu ölçüyü
// kullanır; three.js indirilirken döndürülen telefon da doğru yerleşir.
//
// Neden CSS'in 100vh / 100dvh / inset:0 değerlerine güvenilmez:
//   - iOS Safari ve ana ekrana eklenmiş PWA'da döndürmeden sonra tarayıcı son
//     boyutu GEÇ bildirir; ilk resize olayındaki değerler eski yönelime aittir.
//   - iOS tam ekran PWA'da dikey açılıp yataya çevrilince yerleşim alanı durum
//     çubuğu kadar KISA kalabiliyor: alt kenarda boş bir şerit oluşuyordu.
//   - Ana iş parçacığı meşgulken (dünya kurulurken) gelen döndürme, iş bitene
//     kadar yerleşime yansımaz; o yüzden ölçüm olaydan sonra bir süre tekrarlanır.
// Ölçülen boyut :root'a --app-w / --app-h olarak yazılır; uygulama kabı (#app),
// tuvaller ve tüm katmanlar bu değerlerle boyutlanır.
(function () {
  'use strict';
  var root = document.documentElement;
  var ua = navigator.userAgent || '';
  var IOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function standalone() {
    return window.navigator.standalone === true ||
      (!!window.matchMedia && (matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches));
  }
  var state = { w: 0, h: 0, landscape: true, version: 0 };
  var listeners = [];

  // Tam ekran ölçü sondası: position:fixed; inset:0 olan görünmez bir öğe. CSS'in
  // gerçekte yerleştirdiği alanı (ilk kapsayıcı blok) verir.
  var probe = null;
  function probeSize() {
    if (!document.body) return null;
    if (!probe) {
      probe = document.createElement('div');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.cssText = 'position:fixed;left:0;top:0;right:0;bottom:0;visibility:hidden;pointer-events:none;z-index:-1;';
      document.body.appendChild(probe);
    }
    return { w: probe.clientWidth, h: probe.clientHeight };
  }
  // Yönelim: önce CSS'in kullandığı medya sorgusu, yoksa ekran açısı, en son pencere oranı
  var mqLand = window.matchMedia ? matchMedia('(orientation: landscape)') : null;
  function isLandscape() {
    if (mqLand) return mqLand.matches;
    var a = screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle
      : (typeof window.orientation === 'number' ? window.orientation : null);
    if (a !== null) return Math.abs(a) % 180 === 90;
    return window.innerWidth >= window.innerHeight;
  }

  function read() {
    // Ölçü kaynakları (pencere, görsel alan, belge kökü, tam ekran sondası) içinden her kenar
    // için EN BÜYÜĞÜ alınır. Eskiden görsel alan önceliklendiriliyordu; iOS'ta yatayda bu değer
    // gerçek alandan ~60 px KISA kalabiliyor, uygulama kabı o yüksekliğe ayarlandığı için altta
    // siyah bir şerit kalıyor ve alt kumandalar kesiliyordu. Oyunda klavye girişi yoktur, yani
    // görünen alanı meşru olarak daraltan bir durum yok: en büyük değer gerçek oyun alanıdır.
    // Döndürme sırasında bazı kaynaklar ESKİ yönelimi bildirebilir; bu yüzden her kaynağın uzun
    // ve kısa kenarı ayrı toplanır, genişlik/yükseklik yönelime göre atanır (kare olmaz).
    var long = 0, short = 0;
    function src(a, b) { if (!(a > 0 && b > 0)) return; long = Math.max(long, Math.max(a, b)); short = Math.max(short, Math.min(a, b)); }
    src(window.innerWidth, window.innerHeight);
    var vv = window.visualViewport;
    if (vv && Math.abs((vv.scale || 1) - 1) < 0.01) src(Math.round(vv.width), Math.round(vv.height));
    var de = document.documentElement;
    if (de) src(de.clientWidth, de.clientHeight);
    var p = probeSize();
    if (p) src(p.w, p.h);
    var land = isLandscape();
    // iOS tam ekran (ana ekrana eklenmiş) uygulama: iPhone'da pencere her zaman ekranın
    // TAMAMIDIR (Split View yok), ölçü ne derse desin ekran boyutu kullanılır. iPad'de
    // gerçekten küçük pencere (Split View) korunur.
    if (IOS && standalone() && screen && screen.width > 0 && screen.height > 0) {
      var sMax = Math.max(screen.width, screen.height), sMin = Math.min(screen.width, screen.height);
      if (/iPhone|iPod/.test(ua) || (sMax - long <= 120 && sMin - short <= 120)) { long = sMax; short = sMin; }
    }
    var w = land ? long : short, h = land ? short : long;
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  function measure() {
    var m = read();
    if (m.w === state.w && m.h === state.h) return false;
    state.w = m.w; state.h = m.h; state.landscape = m.w >= m.h; state.version++;
    root.style.setProperty('--app-w', m.w + 'px');
    root.style.setProperty('--app-h', m.h + 'px');
    root.classList.toggle('is-landscape', state.landscape);
    root.classList.toggle('is-portrait', !state.landscape);
    for (var i = 0; i < listeners.length; i++) {
      try { listeners[i](state); } catch (e) { if (window.console) console.error(e); }
    }
    return true;
  }

  // Olaydan sonra ~1,2 s boyunca her karede ve birkaç zamanlayıcıyla yeniden ölç:
  // tarayıcının son boyutu ne zaman bildireceği belli değildir. Arka arkaya hızlı
  // döndürmelerde süre uzatılır, döngü tek kalır.
  var settleUntil = 0, settling = false;
  function tick() {
    measure();
    if (performance.now() < settleUntil) requestAnimationFrame(tick);
    else settling = false;
  }
  function settle() {
    measure();
    settleUntil = performance.now() + 1200;
    if (!settling) { settling = true; requestAnimationFrame(tick); }
    // rAF arka planda/meşgulken gecikebilir: zamanlayıcılar da ölçer
    setTimeout(measure, 60); setTimeout(measure, 200); setTimeout(measure, 450); setTimeout(measure, 900);
  }

  window.addEventListener('resize', settle);
  window.addEventListener('orientationchange', settle);
  window.addEventListener('pageshow', settle);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) settle(); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', settle);
  if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', settle);
  if (window.matchMedia) {
    var mq = matchMedia('(orientation: portrait)');
    if (mq.addEventListener) mq.addEventListener('change', settle); else if (mq.addListener) mq.addListener(settle);
  }
  measure();

  window.ffsViewport = {
    get w() { return state.w; },
    get h() { return state.h; },
    get landscape() { return state.landscape; },
    get version() { return state.version; },
    measure: measure,
    settle: settle,
    onChange: function (fn) { listeners.push(fn); },
    isIOS: IOS,
    isStandalone: standalone,
  };
})();
