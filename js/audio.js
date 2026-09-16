// Prosedürel Web Audio: motor (gaz ile), art yakıcı gürlemesi, rüzgar, stall uyarı tonu.
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.ready = false;
    this.stallPhase = 0;
  }

  // Kullanıcı hareketi ile çağrılmalı (iOS)
  unlock() {
    if (this.ready) { this.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const master = ctx.createGain();
    master.gain.value = this.muted ? 0 : 0.8;
    master.connect(ctx.destination);
    this.master = master;

    const noise = this.makeNoiseBuffer(2.0);
    // Motor: iki osilatör + filtreli gürültü
    this.oscA = ctx.createOscillator(); this.oscA.type = 'sawtooth'; this.oscA.frequency.value = 55;
    this.oscB = ctx.createOscillator(); this.oscB.type = 'triangle'; this.oscB.frequency.value = 110;
    this.engFilter = ctx.createBiquadFilter(); this.engFilter.type = 'lowpass'; this.engFilter.frequency.value = 300; this.engFilter.Q.value = 0.7;
    this.engGain = ctx.createGain(); this.engGain.gain.value = 0.0;
    this.oscA.connect(this.engFilter); this.oscB.connect(this.engFilter);
    this.engFilter.connect(this.engGain); this.engGain.connect(master);
    this.oscA.start(); this.oscB.start();

    this.engNoise = ctx.createBufferSource(); this.engNoise.buffer = noise; this.engNoise.loop = true;
    this.engNoiseFilter = ctx.createBiquadFilter(); this.engNoiseFilter.type = 'bandpass'; this.engNoiseFilter.frequency.value = 600; this.engNoiseFilter.Q.value = 0.8;
    this.engNoiseGain = ctx.createGain(); this.engNoiseGain.gain.value = 0.0;
    this.engNoise.connect(this.engNoiseFilter); this.engNoiseFilter.connect(this.engNoiseGain); this.engNoiseGain.connect(master);
    this.engNoise.start();

    // Türbin ıslığı
    this.whine = ctx.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 1200;
    this.whineGain = ctx.createGain(); this.whineGain.gain.value = 0;
    this.whine.connect(this.whineGain); this.whineGain.connect(master); this.whine.start();

    // Art yakıcı: düşük frekanslı gürleme
    this.abNoise = ctx.createBufferSource(); this.abNoise.buffer = noise; this.abNoise.loop = true; this.abNoise.playbackRate.value = 0.6;
    this.abFilter = ctx.createBiquadFilter(); this.abFilter.type = 'lowpass'; this.abFilter.frequency.value = 140; this.abFilter.Q.value = 1.2;
    this.abGain = ctx.createGain(); this.abGain.gain.value = 0;
    this.abNoise.connect(this.abFilter); this.abFilter.connect(this.abGain); this.abGain.connect(master);
    this.abNoise.start();

    // Rüzgar
    this.wind = ctx.createBufferSource(); this.wind.buffer = noise; this.wind.loop = true; this.wind.playbackRate.value = 1.3;
    this.windFilter = ctx.createBiquadFilter(); this.windFilter.type = 'bandpass'; this.windFilter.frequency.value = 900; this.windFilter.Q.value = 0.5;
    this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
    this.wind.connect(this.windFilter); this.windFilter.connect(this.windGain); this.windGain.connect(master);
    this.wind.start();

    // Stall uyarısı
    this.stallOsc = ctx.createOscillator(); this.stallOsc.type = 'square'; this.stallOsc.frequency.value = 720;
    this.stallGain = ctx.createGain(); this.stallGain.gain.value = 0;
    this.stallOsc.connect(this.stallGain); this.stallGain.connect(master); this.stallOsc.start();

    // Tekerlek / yer gürültüsü
    this.roll = ctx.createBufferSource(); this.roll.buffer = noise; this.roll.loop = true; this.roll.playbackRate.value = 0.4;
    this.rollFilter = ctx.createBiquadFilter(); this.rollFilter.type = 'lowpass'; this.rollFilter.frequency.value = 200;
    this.rollGain = ctx.createGain(); this.rollGain.gain.value = 0;
    this.roll.connect(this.rollFilter); this.rollFilter.connect(this.rollGain); this.rollGain.connect(master);
    this.roll.start();

    this.ready = true;
    this.resume();
  }

  makeNoiseBuffer(seconds) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    return buf;
  }

  resume() { if (this.ctx && this.ctx.state !== 'running') this.ctx.resume().catch(() => {}); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  update(dt, T, running) {
    if (!this.ready || !T) return;
    const ctx = this.ctx, t = ctx.currentTime, k = 0.08;
    const eng = running ? T.engine : 0;
    const ab = running ? T.ab : 0;
    const rpm = 0.25 + 0.75 * eng; // rölanti %25
    this.oscA.frequency.setTargetAtTime(40 + rpm * 110, t, k);
    this.oscB.frequency.setTargetAtTime(80 + rpm * 220, t, k);
    this.engFilter.frequency.setTargetAtTime(150 + rpm * 900, t, k);
    this.engGain.gain.setTargetAtTime(running ? 0.05 + rpm * 0.16 : 0, t, k);
    this.engNoiseFilter.frequency.setTargetAtTime(300 + rpm * 1800, t, k);
    this.engNoiseGain.gain.setTargetAtTime(running ? 0.08 + rpm * 0.32 : 0, t, k);
    this.whine.frequency.setTargetAtTime(600 + rpm * 2600, t, k);
    this.whineGain.gain.setTargetAtTime(running ? 0.01 + rpm * 0.03 : 0, t, k);
    this.abGain.gain.setTargetAtTime(ab * 0.9, t, k);
    this.abFilter.frequency.setTargetAtTime(100 + ab * 120, t, k);
    const spd = Math.min(T.tas / 300, 1.6);
    this.windGain.gain.setTargetAtTime(running ? spd * spd * 0.35 : 0, t, k);
    this.windFilter.frequency.setTargetAtTime(500 + spd * 1500, t, k);
    const rollG = running && T.onGround ? Math.min(T.tas / 60, 1) * 0.25 : 0;
    this.rollGain.gain.setTargetAtTime(rollG, t, k);
    // Stall: 4 Hz kesikli ton
    if (running && (T.stall || T.stallWarn)) {
      this.stallPhase += dt * 4;
      const on = (this.stallPhase % 1) < 0.5;
      this.stallGain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.01);
    } else {
      this.stallGain.gain.setTargetAtTime(0, t, 0.02);
    }
  }
}
