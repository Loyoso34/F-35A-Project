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

  function read() {
    var w = window.innerWidth, h = window.innerHeight;
    var vv = window.visualViewport;
    // Yakınlaştırma kapalı olduğu için görsel alan = görünen alan. iOS'ta döndürmeden
    // sonra innerWidth/innerHeight'tan önce güncellenir.
    if (vv && vv.width > 0 && vv.height > 0 && Math.abs((vv.scale || 1) - 1) < 0.01) {
      w = Math.round(vv.width); h = Math.round(vv.height);
    }
    // iOS tam ekran PWA: uygulama ekranın TAMAMINI kaplar. Ölçülen değer ekrana
    // çok yakın ama ondan küçükse (durum çubuğu kadar kısa yerleşim alanı hatası)
    // ekran boyutu kullanılır. Gerçekten küçük bir pencere (iPad Split View) bu
    // eşiğin dışında kalır ve ölçülen değer korunur.
    if (IOS && standalone() && screen && screen.width > 0 && screen.height > 0) {
      var sMin = Math.min(screen.width, screen.height), sMax = Math.max(screen.width, screen.height);
      var land = w > h;
      var ew = land ? sMax : sMin, eh = land ? sMin : sMax;
      if (w <= ew && h <= eh && ew - w <= 80 && eh - h <= 80) { w = ew; h = eh; }
    }
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
