// Başsız uçuş modeli test kütüphanesi: main.js döngüsünü birebir taklit eder
// (kare başına çubuk yumuşatma, 120 Hz sabit adım biriktiricisi, 12 adım tavanı).
const DEG = Math.PI / 180;
export async function load(root = process.env.APP || new URL('../../', import.meta.url).pathname.replace(/\/$/, '')) {
  const phys = await import(root + '/js/physics.js');
  const fleet = await import(root + '/js/fleet.js');
  const THREE = await import('three');
  return { ...phys, ...fleet, THREE, root };
}
export function flatWorld() { return { halfSize: 36000, heightAt: () => 0, hitsBuilding: () => false }; }

// Havada başlat: irtifa (m), hız (m/s), yunuslama (derece), gaz, AB, takım
export function makeAir(M, o = {}) {
  const { alt = 3000, V = 200, pitchDeg = 0, hdg = 90, throttle = 0.85, ab = false, gear = 0, flaps = 0, fuel = null, settle = 4, trim = true, gammaDeg = 0 } = o;
  const fm = new M.FlightModel(flatWorld(), M.getAircraftConfig('f35a'));
  fm.wind = { dirDeg: 0, kt: 0, gustKt: 0, shear: 0 };
  if (fuel !== null) fm.fuel = fuel;
  fm.gearCmd = gear; fm.gearPos = gear; if (flaps) { fm.setFlapIndex(1); fm.flapsPos = 1; }
  // Trim: hız vektörü gammaDeg yolunda, gövde trim AoA kadar yukarıda (1 g için)
  let trimDeg = 0;
  if (trim) {
    const rho = M.atmosphere(alt).rho, qS = 0.5 * rho * V * V * 42.7;
        let lo = -0.2, hi = 0.6; const need = fm.mass * 9.80665 / qS;
    const cl = (a) => 3.25 * Math.sin(a) * Math.cos(a) ** 2 + 2.6 * Math.sin(a) * Math.abs(Math.sin(a)) * Math.cos(a) + (flaps ? 0.42 : 0);
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (cl(m) < need) lo = m; else hi = m; }
    trimDeg = (lo + hi) / 2 / DEG;
  }
  const e = new M.THREE.Euler((pitchDeg + gammaDeg + trimDeg) * DEG, -hdg * DEG, 0, 'YXZ');
  fm.quat.setFromEuler(e);
  const fwd = new M.THREE.Vector3(Math.sin(hdg * DEG) * Math.cos(gammaDeg * DEG), Math.sin(gammaDeg * DEG), -Math.cos(hdg * DEG) * Math.cos(gammaDeg * DEG));
  fm.pos.set(0, alt, 0); fm.vel.copy(fwd).multiplyScalar(V);
  fm.onGround = false; fm.wasOnGround = false;
  fm.engine_.n = Math.min(1, throttle); fm.throttle = throttle; fm.afterburner = ab;
  if (ab) { fm.engine_.abLin = 1; fm.engine_.ab = 1; }
  // Nötr çubukla oturt (FCS yolu tutar); kayıt yapılmaz
  if (settle > 0) run(M, fm, { seconds: settle, fps: 120, stick: () => ({ pitch: 0, roll: 0, yaw: 0 }), throttle, ab });
  return fm;
}

// main.js döngüsünü taklit eder. fps: sayı ya da (kareIndex)=>dt fonksiyonu.
// stick(t) -> {pitch, roll, yaw} HAM pilot girdisi (Controls.update yumuşatması uygulanır).
export function run(M, fm, { seconds, fps = 60, stick, throttle = null, ab = null, log = null, dtFn = null, rawStick = false }) {
  const FIXED_DT = M.FIXED_DT;
  const cs = fm._csim || (fm._csim = { pitch: 0, roll: 0, yaw: 0, acc: 0, t: 0, frame: 0 });
  const t0 = cs.t;
  while (cs.t - t0 < seconds - 1e-9) {
    let dt = dtFn ? dtFn(cs.frame, cs.t) : 1 / fps;
    cs.frame++;
    const frameDt = dt;
    if (dt > 0.1) dt = 0.1;
    const s = stick(cs.t - t0, fm);
    const raw = { pitch: Math.max(-1, Math.min(1, s.pitch || 0)), roll: Math.max(-1, Math.min(1, s.roll || 0)), yaw: Math.max(-1, Math.min(1, s.yaw || 0)) };
    fm.setControls({ throttle: throttle !== null ? throttle : fm.throttle, afterburner: ab !== null ? ab : fm.afterburner });
    cs.acc += dt;
    let steps = 0;
    // MODE=sub (varsayılan, main.js v3.5): yumuşatma alt adımlarda; MODE=zoh: eski
    // davranış (kare sonu değeri tüm alt adımlarda sabit)
    const zoh = process.env.MODE === 'zoh';
    if (zoh) { const sm = rawStick ? 1 : 1 - Math.exp(-dt * 14); cs.pitch += (raw.pitch - cs.pitch) * sm; cs.roll += (raw.roll - cs.roll) * sm; cs.yaw += (raw.yaw - cs.yaw) * sm; }
    const kSm = rawStick ? 1 : 1 - Math.exp(-FIXED_DT * 14);
    while (cs.acc >= FIXED_DT && steps < 12) {
      if (!zoh) { cs.pitch += (raw.pitch - cs.pitch) * kSm; cs.roll += (raw.roll - cs.roll) * kSm; cs.yaw += (raw.yaw - cs.yaw) * kSm; }
      fm.setControls({ pitch: cs.pitch, roll: cs.roll, yaw: cs.yaw });
      fm.step(FIXED_DT);
      cs.acc -= FIXED_DT; steps++;
      if (log) log(rec(fm, cs.t - t0 + (steps) * FIXED_DT, frameDt, s));
      if (fm.crashed) return fm;
    }
    if (steps >= 12) cs.acc = 0;
    cs.t += frameDt > 0.1 ? 0.1 : frameDt;
  }
  return fm;
}

export function rec(fm, t, frameDt, s) {
  const T = fm.telemetry, f = fm.fcs, rb = fm.rb, d = f.dbg;
  return {
    t, frameDt, stickRaw: s.pitch || 0, stick: fm.stick.pitch, sf: f.sf.pitch,
    deCmd: f.cmd.de, de: f.sur.de, elev: fm.surfaces.elevator,
    qdot: (rb.qdot || 0) / DEG, q: rb.q / DEG, p: rb.p / DEG, r: rb.r / DEG,
    pitch: T.pitch, roll: T.roll, alpha: T.alpha, beta: T.beta, nz: T.g, kias: T.kias, mach: T.mach, alt: fm.pos.y,
    qCmd: (d.qCmd || 0) / DEG, nTarget: d.nTarget, wG: d.wG, aCmd: (d.aCmd || 0) / DEG, onGround: fm.onGround,
    da: f.sur.da, dr: f.sur.dr, Mm: fm.debug.Mm, vs: fm.vel.y,
  };
}

// Kesintisizlik ölçütleri: zaman serisi üzerinde
export function smoothness(rows, key, { from = 0, to = 1e9, thr = 0 } = {}) {
  const v = rows.filter((r) => r.t >= from && r.t <= to).map((r) => r[key]);
  let signFlips = 0, prevS = 0, maxAbs = 0, maxStep = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    maxStep = Math.max(maxStep, Math.abs(d));
    const s = Math.abs(d) <= thr ? 0 : Math.sign(d);
    if (s !== 0) { if (prevS !== 0 && s !== prevS) signFlips++; prevS = s; }
  }
  for (const x of v) maxAbs = Math.max(maxAbs, Math.abs(x));
  return { n: v.length, signFlips, maxAbs, maxStep };
}

// "Dur-kalk" sayacı: yunuslama oranının (q) bir yöndeki hareketi sırasında kaç kez
// tepe değerinin belirgin bir kesrine düşüp yeniden arttığı (sert çentik).
export function stutter(rows, key = 'q', { from = 0, to = 1e9, sign = -1, frac = 0.35, minPeak = 3 } = {}) {
  const v = rows.filter((r) => r.t >= from && r.t <= to).map((r) => sign * r[key]);
  let peak = 0, dips = 0, inDip = false;
  for (const x of v) {
    if (x > peak) peak = x;
    if (peak < minPeak) continue;
    if (!inDip && x < peak * frac) { inDip = true; dips++; }
    else if (inDip && x > peak * 0.8) { inDip = false; }
  }
  return dips;
}
export const fmt = (x, n = 2) => (x === undefined || x === null || Number.isNaN(x) ? 'nan' : (+x).toFixed(n));
