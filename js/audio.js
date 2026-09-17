// Prosedürel Web Audio: modern savaş uçağı motoru.
// Katmanlar: gövde gürlemesi (rezonanslı düşük frekans), türbin ıslığı (harmonikler), egzoz kükremesi
// (kahverengi gürültü, gaz kolu ile spektrum değişir), art yakıcı (yumuşak kırpma + çıtırtı + ateşleme darbesi),
// rüzgar, yer gürültüsü, stall uyarısı. Kokpit içinde boğuk/gürlemeli, dışarıda parlak ve kükremeli.
// Dış "uçuş geçişi" kamerasında Doppler ve mesafe zayıflaması uygulanır. Master kompresör kırpmayı önler.
// Varsayılan (savaş uçağı) ses profili
const DEFAULT_PROFILE = {
  rumbleF: [38, 75], rumbleFilter: [120, 260], rumbleGain: [0.10, 0.22],
  roarBP: [220, 620], roarLP: [500, 2200], roarGain: [0.05, 0.55],
  whineF: [700, 3500], whineGain: [0.004, 0.028], hissHP: [1800, 2500], hissGain: 0.05,
  ab: 1, reverse: 0, idle: 0.22, rollLP: 220,
};

export class AudioEngine {
  // Uçak sesi profili: motor türüne göre frekans ve seviye eşlemesi (fleet.js'ten gelir)
  setProfile(p) { this.profile = p || null; }

  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.stallPhase = 0;
    this.lastAb = 0;
    this.view = 'external';
    this.doppler = 1;
    this.distanceGain = 1;
    this.lfoPhase = 0;
  }

  unlock() {
    if (this.ready) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    // Master zinciri: katmanlar -> görünüm filtresi -> kompresör -> master gain
    this.viewFilter = ctx.createBiquadFilter(); this.viewFilter.type = 'lowpass'; this.viewFilter.frequency.value = 12000; this.viewFilter.Q.value = 0.5;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -16; this.comp.knee.value = 12; this.comp.ratio.value = 6; this.comp.attack.value = 0.004; this.comp.release.value = 0.18;
    this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.75;
    this.viewFilter.connect(this.comp); this.comp.connect(this.master); this.master.connect(ctx.destination);
    this.bus = this.viewFilter;

    const brownA = this.makeNoiseBuffer(6.1, 'brown', 11);
    const brownB = this.makeNoiseBuffer(5.3, 'brown', 23);
    const pink = this.makeNoiseBuffer(4.7, 'pink', 37);
    const white = this.makeNoiseBuffer(3.9, 'white', 41);

    // --- Gövde gürlemesi: iki hafif detune testere + alt sinüs, rezonanslı alçak geçiren, yavaş AM
    this.rumbleOscs = [];
    this.rumbleFilter = ctx.createBiquadFilter(); this.rumbleFilter.type = 'lowpass'; this.rumbleFilter.frequency.value = 180; this.rumbleFilter.Q.value = 2.2;
    this.rumbleGain = ctx.createGain(); this.rumbleGain.gain.value = 0;
    this.rumbleAM = ctx.createGain(); this.rumbleAM.gain.value = 1;
    for (const [type, mul, g] of [['sawtooth', 1.0, 0.5], ['sawtooth', 1.012, 0.5], ['sine', 0.5, 0.9], ['triangle', 2.0, 0.25]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 45 * mul;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(this.rumbleFilter); o.start();
      this.rumbleOscs.push({ o, mul });
    }
    this.rumbleFilter.connect(this.rumbleAM); this.rumbleAM.connect(this.rumbleGain); this.rumbleGain.connect(this.bus);
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 1.7;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.12;
    lfo.connect(lfoG); lfoG.connect(this.rumbleAM.gain); lfo.start();
    const lfo2 = ctx.createOscillator(); lfo2.type = 'sine'; lfo2.frequency.value = 0.37;
    const lfo2G = ctx.createGain(); lfo2G.gain.value = 0.08;
    lfo2.connect(lfo2G); lfo2G.connect(this.rumbleAM.gain); lfo2.start();

    // --- Egzoz kükremesi: iki kahverengi gürültü kaynağı, bant geçiren (rpm ile yükselir) + alçak geçiren
    this.roarA = this.loopSource(brownA, 1.0);
    this.roarB = this.loopSource(brownB, 0.83);
    this.roarBP = ctx.createBiquadFilter(); this.roarBP.type = 'bandpass'; this.roarBP.frequency.value = 260; this.roarBP.Q.value = 0.55;
    this.roarLP = ctx.createBiquadFilter(); this.roarLP.type = 'lowpass'; this.roarLP.frequency.value = 1400; this.roarLP.Q.value = 0.4;
    this.roarGain = ctx.createGain(); this.roarGain.gain.value = 0;
    this.roarA.connect(this.roarBP); this.roarB.connect(this.roarLP);
    this.roarBP.connect(this.roarGain); this.roarLP.connect(this.roarGain); this.roarGain.connect(this.bus);
    // Kükremede yavaş spektral dalgalanma (döngü hissini kırar)
    const lfo3 = ctx.createOscillator(); lfo3.type = 'triangle'; lfo3.frequency.value = 0.23;
    const lfo3G = ctx.createGain(); lfo3G.gain.value = 60;
    lfo3.connect(lfo3G); lfo3G.connect(this.roarBP.frequency); lfo3.start();

    // --- Türbin ıslığı: temel + 2 harmonik, hafif vibrato, yüksek geçiren
    this.whineOscs = [];
    this.whineHP = ctx.createBiquadFilter(); this.whineHP.type = 'highpass'; this.whineHP.frequency.value = 500;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    for (const [type, mul, g] of [['triangle', 1.0, 1.0], ['sine', 2.003, 0.45], ['sine', 3.01, 0.22]]) {
      const o = ctx.createOscillator(); o.type = type; o.frequency.value = 1200 * mul;
      const og = ctx.createGain(); og.gain.value = g;
      o.connect(og); og.connect(this.whineHP); o.start();
      this.whineOscs.push({ o, mul });
    }
    this.whineHP.connect(this.whineGain); this.whineGain.connect(this.bus);
    const vib = ctx.createOscillator(); vib.type = 'sine'; vib.frequency.value = 5.3;
    const vibG = ctx.createGain(); vibG.gain.value = 4;
    vib.connect(vibG); for (const w of this.whineOscs) vibG.connect(w.o.frequency); vib.start();

    // --- Yüksek frekanslı egzoz hışırtısı (pembe gürültü, yüksek geçiren) – ince, düşük seviye
    this.hiss = this.loopSource(pink, 1.0);
    this.hissHP = ctx.createBiquadFilter(); this.hissHP.type = 'highpass'; this.hissHP.frequency.value = 2200;
    this.hissGain = ctx.createGain(); this.hissGain.gain.value = 0;
    this.hiss.connect(this.hissHP); this.hissHP.connect(this.hissGain); this.hissGain.connect(this.bus);

    // --- Art yakıcı: kahverengi gürültü, rezonanslı alçak geçiren, yumuşak kırpma, hafif titreme; çıtırtı bandı
    this.abSrc = this.loopSource(brownB, 0.62);
    this.abLP = ctx.createBiquadFilter(); this.abLP.type = 'lowpass'; this.abLP.frequency.value = 110; this.abLP.Q.value = 1.6;
    this.abShaper = ctx.createWaveShaper(); this.abShaper.curve = this.makeSoftClip(3.0); this.abShaper.oversample = '2x';
    this.abAM = ctx.createGain(); this.abAM.gain.value = 1;
    this.abGain = ctx.createGain(); this.abGain.gain.value = 0;
    this.abSrc.connect(this.abLP); this.abLP.connect(this.abShaper); this.abShaper.connect(this.abAM); this.abAM.connect(this.abGain); this.abGain.connect(this.bus);
    const abLfo = ctx.createOscillator(); abLfo.type = 'sine'; abLfo.frequency.value = 2.9;
    const abLfoG = ctx.createGain(); abLfoG.gain.value = 0.18;
    abLfo.connect(abLfoG); abLfoG.connect(this.abAM.gain); abLfo.start();
    this.crackle = this.loopSource(white, 0.9);
    this.crackleBP = ctx.createBiquadFilter(); this.crackleBP.type = 'bandpass'; this.crackleBP.frequency.value = 900; this.crackleBP.Q.value = 0.8;
    this.crackleAM = ctx.createGain(); this.crackleAM.gain.value = 1;
    this.crackleGain = ctx.createGain(); this.crackleGain.gain.value = 0;
    this.crackle.connect(this.crackleBP); this.crackleBP.connect(this.crackleAM); this.crackleAM.connect(this.crackleGain); this.crackleGain.connect(this.bus);
    const crLfo = ctx.createOscillator(); crLfo.type = 'square'; crLfo.frequency.value = 11;
    const crLfoG = ctx.createGain(); crLfoG.gain.value = 0.35;
    crLfo.connect(crLfoG); crLfoG.connect(this.crackleAM.gain); crLfo.start();

    // --- Rüzgar
    this.wind = this.loopSource(pink, 1.27);
    this.windBP = ctx.createBiquadFilter(); this.windBP.type = 'bandpass'; this.windBP.frequency.value = 700; this.windBP.Q.value = 0.45;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.wind.connect(this.windBP); this.windBP.connect(this.windGain); this.windGain.connect(this.bus);

    // --- Yer gürültüsü (tekerlek)
    this.roll = this.loopSource(brownA, 0.45);
    this.rollLP = ctx.createBiquadFilter(); this.rollLP.type = 'lowpass'; this.rollLP.frequency.value = 220;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    this.roll.connect(this.rollLP); this.rollLP.connect(this.rollGain); this.rollGain.connect(this.bus);

    // --- Stall uyarısı
    this.stallOsc = ctx.createOscillator(); this.stallOsc.type = 'square'; this.stallOsc.frequency.value = 720;
    this.stallGain = ctx.createGain(); this.stallGain.gain.value = 0;
    this.stallOsc.connect(this.stallGain); this.stallGain.connect(this.master); this.stallOsc.start();

    this.rateNodes = [this.roarA, this.roarB, this.hiss, this.abSrc, this.crackle];
    this.baseRates = this.rateNodes.map((n) => n.playbackRate.value);
    this.ready = true;
    this.resume();
  }

  loopSource(buffer, rate) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer; s.loop = true; s.playbackRate.value = rate;
    s.start(0, Math.random() * buffer.duration);
    return s;
  }

  makeSoftClip(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = Math.tanh(k * x) / Math.tanh(k); }
    return curve;
  }

  makeNoiseBuffer(seconds, kind, seed) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = rnd();
      if (kind === 'white') d[i] = w * 0.5;
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    }
    // Döngü dikişini yumuşat
    const fade = Math.floor(ctx.sampleRate * 0.05);
    for (let i = 0; i < fade; i++) { const k = i / fade; d[i] *= k; d[n - 1 - i] *= k; }
    return buf;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.75, this.ctx.currentTime, 0.05);
  }

  // view: 'cockpit' | 'external'; doppler: frekans çarpanı; distance: metre (uçuş geçişi kamerası için)
  setListener(view, doppler = 1, distance = 0) {
    this.view = view;
    this.doppler = Math.max(0.6, Math.min(1.6, doppler));
    this.distanceGain = 1 / (1 + Math.max(0, distance) / 180);
  }

  update(dt, T, running) {
    if (!this.ready || !T) return;
    const ctx = this.ctx, t = ctx.currentTime, k = 0.06;
    const P = this.profile || DEFAULT_PROFILE;
    const eng = running ? T.engine : 0;
    // Art yakıcı kanalı: savaş uçağında AB, yolcu uçağında ters itki gürlemesi için kullanılır
    const ab = running ? (T.ab * P.ab + (T.reverse || 0) * P.reverse) : 0;
    const rpm = P.idle + (1 - P.idle) * eng;     // rölanti hissi profile göre
    const cockpit = this.view === 'cockpit';
    const dg = cockpit ? 1 : this.distanceGain;
    const dop = cockpit ? 1 : this.doppler;

    // Görünüm filtresi: kokpitte boğuk (kanopi), dışarıda açık
    this.viewFilter.frequency.setTargetAtTime(cockpit ? 1500 : 14000, t, 0.1);

    // Gövde gürlemesi: frekans rpm ile 40->115 Hz, kokpitte daha baskın
    const fr = (P.rumbleF[0] + rpm * P.rumbleF[1]) * dop;
    for (const r of this.rumbleOscs) r.o.frequency.setTargetAtTime(fr * r.mul, t, k);
    this.rumbleFilter.frequency.setTargetAtTime(P.rumbleFilter[0] + rpm * P.rumbleFilter[1], t, k);
    this.rumbleGain.gain.setTargetAtTime(running ? (P.rumbleGain[0] + rpm * P.rumbleGain[1]) * (cockpit ? 1.25 : 0.9) * dg : 0, t, k);

    // Kükreme: spektrum rpm ile yukarı, seviye rpm² ile
    this.roarBP.frequency.setTargetAtTime((P.roarBP[0] + rpm * P.roarBP[1]) * dop, t, k);
    this.roarLP.frequency.setTargetAtTime((P.roarLP[0] + rpm * P.roarLP[1]) * dop, t, k);
    this.roarGain.gain.setTargetAtTime(running ? (P.roarGain[0] + rpm * rpm * P.roarGain[1]) * (cockpit ? 0.45 : 1.0) * dg : 0, t, k);

    // Islık: 700 Hz -> 4200 Hz, dışarıda belirgin, kokpitte kısık
    const fw = (P.whineF[0] + rpm * P.whineF[1]) * dop;
    for (const w of this.whineOscs) w.o.frequency.setTargetAtTime(fw * w.mul, t, k);
    this.whineGain.gain.setTargetAtTime(running ? (P.whineGain[0] + rpm * P.whineGain[1]) * (cockpit ? 0.5 : 1.0) * dg : 0, t, k);
    this.hissHP.frequency.setTargetAtTime(P.hissHP[0] + rpm * P.hissHP[1], t, k);
    this.hissGain.gain.setTargetAtTime(running ? rpm * rpm * P.hissGain * (cockpit ? 0.3 : 1.0) * dg : 0, t, k);

    // Art yakıcı: ateşleme darbesi + gürleme + çıtırtı
    if (P.ab && ab > 0.25 && this.lastAb <= 0.25 && running) this.thump();
    this.lastAb = ab;
    // Ters itki: daha derin ve daha az çıtırtılı
    const deep = P.ab ? 1 : 0.62;
    this.abLP.frequency.setTargetAtTime((90 * deep + ab * 90 * deep) * dop, t, k);
    this.abGain.gain.setTargetAtTime(ab * (cockpit ? 0.7 : 1.0) * dg, t, 0.08);
    this.crackleBP.frequency.setTargetAtTime((700 + ab * 600) * dop, t, k);
    this.crackleGain.gain.setTargetAtTime(P.ab * ab * ab * (cockpit ? 0.06 : 0.16) * dg, t, k);

    // Doppler için gürültü kaynaklarının hızı
    this.rateNodes.forEach((n, i) => n.playbackRate.setTargetAtTime(this.baseRates[i] * dop, t, 0.1));

    // Rüzgar: hızın karesiyle, kokpitte hafif, dışarıda belirgin
    const spd = Math.min(T.tas / 320, 1.5);
    this.windGain.gain.setTargetAtTime(running ? spd * spd * (cockpit ? 0.12 : 0.30) * dg : 0, t, k);
    this.windBP.frequency.setTargetAtTime(400 + spd * 1600, t, k);
    const rollG = running && T.onGround ? Math.min(T.tas / 60, 1) * (cockpit ? 0.35 : 0.2) : 0;
    this.rollGain.gain.setTargetAtTime(rollG, t, k);
    this.rollLP.frequency.setTargetAtTime(P.rollLP, t, k);
    // Stall: 4 Hz kesikli ton (yalnızca kokpit uyarısı; dışarıda daha kısık)
    if (running && (T.stall || T.stallWarn)) {
      this.stallPhase += dt * 4;
      const on = (this.stallPhase % 1) < 0.5;
      this.stallGain.gain.setTargetAtTime(on ? (cockpit ? 0.05 : 0.02) : 0, t, 0.01);
    } else {
      this.stallGain.gain.setTargetAtTime(0, t, 0.02);
    }
  }

  // Art yakıcı ateşleme darbesi: kısa düşük frekanslı patlama
  thump() {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(95, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.45);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.5, t + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(g); g.connect(this.bus); o.start(t); o.stop(t + 0.6);
    const n = ctx.createBufferSource(); n.buffer = this.makeNoiseBuffer(0.4, 'brown', 77);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0.35, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 400;
    n.connect(nf); nf.connect(ng); ng.connect(this.bus); n.start(t); n.stop(t + 0.45);
  }
}
