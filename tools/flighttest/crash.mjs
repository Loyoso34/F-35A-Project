// Çarpma sınıflandırması ve çarpma sonrası (enkaz) dinamiği testleri.
// Gerçek FlightModel düz bir dünyada belirli çarpma koşullarına sokulur; birincil neden,
// şiddet, kazanın tek kez tetiklenmesi ve çarpma sonrası hareketin sürekliliği denetlenir.
//   node --import ./register.mjs crash.mjs
import { load, flatWorld } from './sim.mjs';

const M = await load();
const { FlightModel, getAircraftConfig, THREE } = M;
const DEG = Math.PI / 180, FPM = 1 / 196.8504, KT = 1 / 1.943844;
let fails = 0;
const check = (ok, msg) => { console.log((ok ? 'PASS ' : 'FAIL ') + msg); if (!ok) fails++; };

/**
 * Uçağı yerin hemen üstüne, verilen hız/alçalma/tutumla koyar ve çarpana kadar adımlar.
 * x, z: dünya konumu (yüzey tipi world.js planından gelir: (0,0) üs pisti)
 */
function impact({ x = -600, z = 0, hdg = 90, kt = 150, fpm = -600, pitchDeg = 5, rollDeg = 0, gear = 1, world = flatWorld(), agl = 0.35 }) {
  const fm = new FlightModel(world, getAircraftConfig('f35a'));
  fm.wind = { dirDeg: 0, kt: 0, gustKt: 0, shear: 0 };
  fm.reset({ x, z, hdg });
  fm.gearCmd = gear; fm.gearPos = gear;
  const V = kt * KT, vy = fpm * FPM;
  const vh = Math.sqrt(Math.max(0, V * V - vy * vy));
  fm.quat.setFromEuler(new THREE.Euler(pitchDeg * DEG, -hdg * DEG, -rollDeg * DEG, 'YXZ'));
  fm.vel.set(Math.sin(hdg * DEG) * vh, vy, -Math.cos(hdg * DEG) * vh);
  fm.pos.y = world.heightAt(x, z) + fm.requiredClearance(pitchDeg * DEG, rollDeg * DEG) + agl;
  fm.onGround = false; fm.wasOnGround = false;
  fm.engine_.n = 0.4; fm.throttle = 0.4;
  let steps = 0, crashCalls = 0;
  const orig = fm.crash.bind(fm);
  fm.crash = (r) => { crashCalls++; return orig(r); };
  let preVel = null, prePos = null;
  while (!fm.crashed && !fm.onGround && steps < 1200) {
    preVel = fm.vel.clone(); prePos = fm.pos.clone();
    fm.setControls({ pitch: 0, roll: 0, yaw: 0 }); fm.step(1 / 120); steps++;
  }
  return { fm, crashCalls, preVel, prePos };
}

const cases = [
  { name: 'normal landing 600 fpm, gear down', o: { kt: 150, fpm: -600 }, expect: { crash: false } },
  { name: 'firm landing 900 fpm (within gear limit)', o: { kt: 150, fpm: -900 }, expect: { crash: false, cause: 'firm' } },
  { name: 'gear-up landing 140 kt / 400 fpm', o: { kt: 140, fpm: -400, gear: 0 }, expect: { cause: 'gear-up', severity: 'major' } },
  { name: 'hard landing 1600 fpm, gear down', o: { kt: 150, fpm: -1600 }, expect: { cause: 'hard-landing', severity: 'major' } },
  // Kullanıcı örneği: çok hızlı + aşırı dikey hız + takım yukarı -> "gear up" DEĞİL
  { name: 'gear-up 480 kt dive at -9000 fpm', o: { kt: 480, fpm: -9000, pitchDeg: -20, gear: 0 }, expect: { cause: 'excessive-vs', severity: 'catastrophic' } },
  { name: 'gear-down 300 kt at -3500 fpm', o: { kt: 300, fpm: -3500, pitchDeg: -6 }, expect: { cause: 'excessive-vs', severity: 'critical' } },
  { name: 'high-speed touchdown 260 kt shallow', o: { kt: 260, fpm: -300, pitchDeg: 1 }, expect: { cause: 'high-speed' } },
  // 250 kt'da gövde teması: birincil neden hız; takımın yukarıda olması ikincil not
  { name: 'gear-up 250 kt shallow slide', o: { kt: 250, fpm: -500, pitchDeg: 1, gear: 0 }, expect: { cause: 'high-speed', note: 'Landing gear was retracted' } },
  { name: 'wingtip strike, 20° bank', o: { kt: 150, fpm: -500, rollDeg: 20 }, expect: { cause: 'wingtip' } },
  { name: 'tail strike, 17° pitch', o: { kt: 140, fpm: -400, pitchDeg: 17 }, expect: { cause: 'tail-strike' } },
  { name: 'off-runway landing 150 kt on grass', o: { x: -3000, z: 0, kt: 150, fpm: -500 }, expect: { cause: 'off-runway' } },
  { name: 'shallow 350 kt flight into terrain (grass)', o: { x: -3000, z: 0, kt: 350, fpm: -2000, pitchDeg: -3 }, expect: { cause: 'high-speed' } },
  { name: 'water impact (sea), 200 kt', o: { x: 0, z: 30500, kt: 200, fpm: -1500, pitchDeg: -2 }, expect: { cause: 'water' } },
];
for (const c of cases) {
  const { fm, crashCalls, preVel } = impact(c.o);
  const info = fm.crashInfo || (fm.lastLanding ? { crash: false, cause: fm.lastLanding.cause } : { crash: false });
  const got = { crash: !!fm.crashed, cause: info.cause, severity: info.severity };
  let ok = (c.expect.crash === false) ? !fm.crashed : fm.crashed;
  if (c.expect.cause) ok = ok && got.cause === c.expect.cause;
  if (c.expect.severity) ok = ok && got.severity === c.expect.severity;
  if (c.expect.note) ok = ok && (info.notes || []).includes(c.expect.note);
  check(ok, `${c.name} -> ${got.crash ? `${got.cause} / ${got.severity} — "${info.reason}"` : 'no crash (' + (got.cause || 'normal') + ')'}`);
  if (fm.crashed) check(crashCalls === 1, `  crash triggered exactly once (${crashCalls})`);
  if (fm.crashed && preVel) {
    // Çarpma sonrası süreklilik: ilk adımda yatay hız korunur (donma yok), konum ışınlanmaz
    const p0 = fm.pos.clone(), vh0 = Math.hypot(fm.vel.x, fm.vel.z);
    fm.step(1 / 120);
    const jump = fm.pos.distanceTo(p0);
    const vhPre = Math.hypot(preVel.x, preVel.z);
    check(vh0 > vhPre * 0.85 && jump < (vhPre + Math.abs(preVel.y)) / 120 * 1.6 + 0.05, `  post-impact motion continuous (vh ${vhPre.toFixed(1)} -> ${vh0.toFixed(1)} m/s, step ${jump.toFixed(2)} m)`);
    // Enkaz sınırlı sürede durur ve kaza yeniden tetiklenmez
    let t = 0;
    while (!fm.wreck.rest && t < 40) { fm.step(1 / 120); t += 1 / 120; }
    const finite = Number.isFinite(fm.pos.x + fm.pos.y + fm.pos.z) && Number.isFinite(fm.quat.x + fm.quat.w);
    check(finite && fm.wreck.rest && crashCalls === 1, `  wreck comes to rest in ${t.toFixed(1)} s, no repeat crash, finite state`);
  }
}
// Yeniden başlatma: kaza durumu ve enkaz temizlenir
{
  const { fm } = impact({ kt: 300, fpm: -4000, gear: 0 });
  fm.reset({ x: -1400, z: 0, hdg: 90 });
  check(!fm.crashed && !fm.crashInfo && !fm.wreck && fm.vel.length() === 0 && fm.onGround, 'reset clears crash state, wreck and velocity');
}
console.log(fails ? `\n${fails} FAILED` : '\nall crash checks passed');
process.exit(fails ? 1 : 0);
