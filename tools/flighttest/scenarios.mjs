// 21 senaryoluk uçuş fiziği test matrisi (bkz. README.md). js/physics.js'in KENDİSİ çalışır;
// main.js döngüsü birebir taklit edilir (kare başına girdi, 120 Hz sabit adım, alt adımlarda
// çubuk yumuşatma). APP=<kök> başka bir kopyayı test eder; MODE=zoh v3.4.0 ve öncesinin
// döngüsünü (kare sonu çubuğu tüm alt adımlarda sabit) taklit eder — eski sürümlerle
// karşılaştırma içindir. OUT=dosya ölçütleri JSON olarak yazar. Çıkış kodu: başarısız
// denetim varsa 1.
import { load, makeAir, run, fmt } from './sim.mjs';
import { landing } from './landing.mjs';
import { writeFileSync } from 'node:fs';
const M = await load();
const W = await import(M.root + '/js/world.js');
const DEG = Math.PI / 180;

// Bir dizide (ölü bantlı) yön değişimi = yerel uç sayısı
function extrema(v, thr) {
  let n = 0, dir = 0, ref = v[0];
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - ref;
    if (dir >= 0 && d < -thr) { if (dir > 0) n++; dir = -1; ref = v[i]; }
    else if (dir <= 0 && d > thr) { if (dir < 0) n++; dir = 1; ref = v[i]; }
    else if ((dir > 0 && v[i] > ref) || (dir < 0 && v[i] < ref)) ref = v[i];
  }
  return n;
}
const seg = (rows, a, b) => rows.filter((r) => r.t >= a && r.t <= b);
const col = (rows, k) => rows.map((r) => r[k]);
const mx = (a) => Math.max(...a), mn = (a) => Math.min(...a);
const finite = (rows) => rows.every((r) => Number.isFinite(r.q) && Number.isFinite(r.alpha) && Number.isFinite(r.nz) && Number.isFinite(r.de));

function hold(o, stickFn, seconds, extra = {}) {
  const fm = makeAir(M, o);
  const rows = [];
  run(M, fm, { seconds, fps: extra.fps || 60, dtFn: extra.dtFn || null, stick: stickFn, log: (r) => rows.push(r), throttle: o.throttle ?? 0.85, ab: !!o.ab });
  return { fm, rows };
}
// Standart yunuslama ölçütleri (tutma bölümü [a,b])
function pitchMetrics(rows, a, b) {
  const s = seg(rows, a, b);
  return {
    qExtrema: extrema(col(s, 'q'), 1.0),            // q'da 1°/s üstü yön değişimi sayısı
    deReversals: extrema(col(s, 'de'), 0.02),       // stabilatör yön değişimi
    qdotFlips: extrema(col(s, 'qdot'), 15),          // açısal ivme işaret dalgalanması
    nzExtrema: extrema(col(s, 'nz'), 0.08),
    maxAbsQ: +mx(col(s, 'q').map(Math.abs)).toFixed(1),
    minNz: +mn(col(s, 'nz')).toFixed(2), maxNz: +mx(col(s, 'nz')).toFixed(2),
    minAlpha: +mn(col(s, 'alpha')).toFixed(1), maxAlpha: +mx(col(s, 'alpha')).toFixed(1),
    maxDeRate: +mx(s.slice(1).map((r, i) => Math.abs(r.de - s[i].de) * 120)).toFixed(2),
  };
}
const R = {};
const t0 = Date.now();

// 1. Tam ileri çubuk (burun aşağı)
{ const { fm, rows } = hold({ alt: 3000, V: 150 }, (t) => ({ pitch: t < 0.5 ? 0 : -1 }), 5.5);
  R['01 full forward stick'] = { ...pitchMetrics(rows, 0.5, 5.5), crashed: fm.crashed, finite: finite(rows) }; }
// 2. Tam geri çubuk
{ const { fm, rows } = hold({ alt: 3000, V: 150 }, (t) => ({ pitch: t < 0.5 ? 0 : 1 }), 5.5);
  R['02 full aft stick'] = { ...pitchMetrics(rows, 0.5, 5.5), crashed: fm.crashed, finite: finite(rows) }; }
// 3. Nötr çubuk sönümü: 0,25 s tam geri darbe, sonra bırak
{ const { fm, rows } = hold({ alt: 3000, V: 180 }, (t) => ({ pitch: t >= 0.5 && t < 0.75 ? 1 : 0 }), 5);
  const s = seg(rows, 1.0, 5);
  const q = col(s, 'q');
  const settle = s.find((r, i) => s.slice(i).every((x) => Math.abs(x.q) < 0.5));
  let zc = 0; for (let i = 1; i < q.length; i++) if (Math.sign(q[i]) !== Math.sign(q[i - 1]) && Math.abs(q[i] - q[i - 1]) > 0.05) zc++;
  R['03 neutral-stick damping'] = { qZeroCross: zc, qExtrema: extrema(q, 0.5), settleTime: settle ? +(settle.t - 0.75).toFixed(2) : null, maxOppositeQ: +(-mn(q)).toFixed(2), crashed: fm.crashed }; }
// 4. Azami pozitif g
{ const { fm, rows } = hold({ alt: 3000, V: 250 }, (t) => ({ pitch: t < 0.5 ? 0 : 1 }), 4.5);
  const m = pitchMetrics(rows, 0.5, 4.5);
  R['04 max positive G'] = { ...m, overshootG: +(m.maxNz - 9).toFixed(2), crashed: fm.crashed }; }
// 5. Azami negatif g
{ const { fm, rows } = hold({ alt: 3000, V: 250 }, (t) => ({ pitch: t < 0.5 ? 0 : -1 }), 4.5);
  const m = pitchMetrics(rows, 0.5, 4.5);
  R['05 max negative G'] = { ...m, undershootG: +(-3 - m.minNz).toFixed(2), crashed: fm.crashed }; }
// 6. Yüksek hızda burun aşağı
{ const { fm, rows } = hold({ alt: 1000, V: 290 }, (t) => ({ pitch: t < 0.5 ? 0 : -1 }), 4.5);
  R['06 high-speed pitch-down'] = { ...pitchMetrics(rows, 0.5, 4.5), crashed: fm.crashed }; }
// 7. Düşük hızda burun aşağı
{ const { fm, rows } = hold({ alt: 3000, V: 95, throttle: 0.9 }, (t) => ({ pitch: t < 0.5 ? 0 : -1 }), 4.5);
  R['07 low-speed pitch-down'] = { ...pitchMetrics(rows, 0.5, 4.5), crashed: fm.crashed }; }
// 8. Ses üstü: tam geri, sonra tam ileri
{ const a = 303.8; const { fm, rows } = hold({ alt: 9000, V: 1.4 * a, throttle: 1, ab: true }, (t) => ({ pitch: t < 0.5 ? 0 : t < 3.5 ? 1 : -1 }), 6.5);
  const up = pitchMetrics(rows, 0.5, 3.5), dn = pitchMetrics(rows, 3.5, 6.5);
  R['08 supersonic pitch'] = { up: { maxNz: up.maxNz, qExtrema: up.qExtrema, deReversals: up.deReversals }, down: { minNz: dn.minNz, qExtrema: dn.qExtrema, deReversals: dn.deReversals }, machStart: +rows[0].mach.toFixed(2), crashed: fm.crashed }; }
// 9. Yüksek AoA manevrası
{ const { fm, rows } = hold({ alt: 5000, V: 130, throttle: 0.9 }, (t) => ({ pitch: t < 0.5 ? 0 : 1 }), 7);
  const s = seg(rows, 2.5, 7);
  let toggles = 0; const lim = 42; for (let i = 1; i < s.length; i++) if ((s[i].alpha > lim) !== (s[i - 1].alpha > lim)) toggles++;
  R['09 high-AoA maneuver'] = { maxAlpha: +mx(col(rows, 'alpha')).toFixed(1), alphaExtremaPlateau: extrema(col(s, 'alpha'), 0.5), stallThresholdToggles: toggles, maxAbsBeta: +mx(col(rows, 'beta').map(Math.abs)).toFixed(2), maxAbsP: +mx(col(rows, 'p').map(Math.abs)).toFixed(1), crashed: fm.crashed, finite: finite(rows) }; }
// 10. Stall ve toparlanma: uçak derin stall'a (α ≈ 50°, 140 kt, burun 35° yukarı, yol −15°)
//     sokulur; (a) çubuk bırakılır, (b) tam geri çubuk tutulur. Toparlanma süresi, irtifa
//     kaybı, departure (p, r) ve α salınımı ölçülür.
function stallCase(stickP) {
  const fm = makeAir(M, { alt: 6000, V: 72, gammaDeg: -15, pitchDeg: 35 + 15, trim: false, throttle: 0.2, settle: 0 });
  const rows = [];
  run(M, fm, { seconds: 12, fps: 60, throttle: 1, stick: () => ({ pitch: stickP }), log: (r) => rows.push(r) });
  const a0 = rows[0].alpha;
  const rec = rows.find((r) => r.alpha < (stickP > 0 ? 30 : 25));
  const late = seg(rows, 4, 12);
  return { alphaStart: +a0.toFixed(1), recoverTime: rec ? +rec.t.toFixed(2) : null, altLost: +(rows[0].alt - mn(col(rows, 'alt'))).toFixed(0),
    maxAbsP: +mx(col(rows, 'p').map(Math.abs)).toFixed(1), maxAbsR: +mx(col(rows, 'r').map(Math.abs)).toFixed(1),
    alphaExtremaAfter: extrema(col(late, 'alpha'), 0.5), alphaEnd: +rows[rows.length - 1].alpha.toFixed(1), crashed: fm.crashed, finite: finite(rows) };
}
R['10a stall recovery (release)'] = stallCase(0);
R['10b stall, full aft held'] = stallCase(1);
// 11. Tam yatış
{ const { fm, rows } = hold({ alt: 3000, V: 200 }, (t) => ({ roll: t >= 0.5 && t < 3.5 ? 1 : 0 }), 5.5);
  const s = seg(rows, 0.5, 3.5);
  let t90 = null; let acc = 0; for (const r of s) { if (t90 === null && Math.abs(r.roll) >= 90) t90 = r.t - 0.5; }
  R['11 full roll'] = { maxP: +mx(col(s, 'p')).toFixed(1), t90: t90 !== null ? +t90.toFixed(2) : null, pExtremaHold: extrema(col(seg(rows, 1.2, 3.5), 'p'), 3), maxAbsBeta: +mx(col(rows, 'beta').map(Math.abs)).toFixed(2), pAfterRelease: +Math.abs(rows[rows.length - 1].p).toFixed(2), crashed: fm.crashed }; }
// 12. Tam dümen
{ const { fm, rows } = hold({ alt: 3000, V: 200 }, (t) => ({ yaw: t >= 0.5 && t < 3.5 ? 1 : 0 }), 6);
  R['12 full rudder'] = { maxBeta: +mx(col(rows, 'beta').map(Math.abs)).toFixed(2), maxR: +mx(col(rows, 'r').map(Math.abs)).toFixed(1), betaExtrema: extrema(col(rows, 'beta'), 0.2), betaAfter: +Math.abs(rows[rows.length - 1].beta).toFixed(2), maxAbsRoll: +mx(col(rows, 'roll').map(Math.abs)).toFixed(1), crashed: fm.crashed }; }
// 13. Yunuslama + yatış
{ const { fm, rows } = hold({ alt: 3000, V: 200 }, (t) => (t >= 0.5 && t < 4.5 ? { pitch: 1, roll: 1 } : { pitch: 0, roll: 0 }), 6);
  R['13 pitch+roll'] = { maxNz: +mx(col(rows, 'nz')).toFixed(2), maxP: +mx(col(rows, 'p').map(Math.abs)).toFixed(1), maxAbsBeta: +mx(col(rows, 'beta').map(Math.abs)).toFixed(2), maxAlpha: +mx(col(rows, 'alpha')).toFixed(1), qExtrema: extrema(col(seg(rows, 0.5, 4.5), 'q'), 1), crashed: fm.crashed, finite: finite(rows) }; }
// 14. Yunuslama + sapma
{ const { fm, rows } = hold({ alt: 3000, V: 200 }, (t) => (t >= 0.5 && t < 4.5 ? { pitch: 1, yaw: 1 } : { pitch: 0, yaw: 0 }), 6);
  R['14 pitch+yaw'] = { maxNz: +mx(col(rows, 'nz')).toFixed(2), maxAbsBeta: +mx(col(rows, 'beta').map(Math.abs)).toFixed(2), maxR: +mx(col(rows, 'r').map(Math.abs)).toFixed(1), maxAbsP: +mx(col(rows, 'p').map(Math.abs)).toFixed(1), qExtrema: extrema(col(seg(rows, 0.5, 4.5), 'q'), 1), crashed: fm.crashed, finite: finite(rows) }; }

// 15. Kalkış rotasyonu: pist başı, tam güç + AB. Vr'de çubuk çekilir; havalanınca 12° tutulur.
function takeoff(pull, vr = 150) {
  const fm = new M.FlightModel({ halfSize: 36000, heightAt: () => 0, hitsBuilding: () => false }, M.getAircraftConfig('f35a'));
  fm.wind = { dirDeg: 0, kt: 0, gustKt: 0, shear: 0 };
  fm.reset(W.spawnPose('base'));
  const x0 = fm.pos.x; const rows = [];
  let liftT = null, liftKias = null, liftX = null, noseKias = null, touchBacks = 0, wasAir = false, maxPitchGnd = 0, maxPitchAir = 0, air = false;
  run(M, fm, { seconds: 45, fps: 60, throttle: 1, ab: true, log: (r) => rows.push(r), stick: (t, f) => {
    const T = f.telemetry;
    if (!f.onGround) air = true;
    if (f.onGround && !air) return { pitch: T.kias >= vr ? pull : 0 };
    // havada: 12° yunuslama tutan basit pilot
    return { pitch: Math.max(-0.5, Math.min(0.6, (12 - T.pitch) * 0.08 - T.q * 0.03)) };
  } });
  for (const r of rows) {
    if (noseKias === null && r.pitch > 0.5) noseKias = r.kias;
    if (r.onGround) { maxPitchGnd = Math.max(maxPitchGnd, r.pitch); if (wasAir) touchBacks++; wasAir = false; }
    else { if (liftT === null) { liftT = r.t; liftKias = r.kias; } wasAir = true; if (liftT !== null && r.t < liftT + 5) maxPitchAir = Math.max(maxPitchAir, r.pitch); }
  }
  const after = liftT !== null ? rows.find((r) => r.t >= liftT + 3) : null;
  const rot = rows.filter((r) => noseKias !== null && r.pitch > 0.3 && r.onGround);
  return { noseLiftKias: noseKias !== null ? +noseKias.toFixed(0) : null, liftoffKias: liftKias !== null ? +liftKias.toFixed(0) : null,
    maxPitchOnGround: +maxPitchGnd.toFixed(1), maxPitchFirst5s: +maxPitchAir.toFixed(1), touchBacks, vsAt3s: after ? +(after.vs * 196.85).toFixed(0) : null,
    rotationQExtrema: extrema(col(rot, 'q'), 0.5), crashed: fm.crashed, crashReason: fm.crashReason || '' };
}
R['15a takeoff full pull'] = takeoff(1.0);
R['15b takeoff 60% pull'] = takeoff(0.6);
R['15c takeoff 35% pull'] = takeoff(0.35);
R['15d takeoff full pull @130kt'] = takeoff(1.0, 130);

// 16. İniş: trimli 3° yaklaşma, 145 kt, takım + flap; 11 m'de flare
{ const r = landing(M, W, {});
  const fl = r.flareT !== null ? seg(r.rows, r.flareT, r.td ? r.td.t : r.flareT + 5) : [];
  const after = r.td ? seg(r.rows, r.td.t, r.td.t + 6) : [];
  R['16 landing flare'] = { touchdownFpm: r.td ? +(r.td.vsTd * 196.85).toFixed(0) : null, touchdownPitch: r.td ? +r.td.pitch.toFixed(1) : null, touchdownKias: r.td ? +r.td.kias.toFixed(0) : null, bounces: r.bounces, flareQExtrema: extrema(col(fl, 'q'), 0.5), maxPitchRollout: after.length ? +mx(col(after, 'pitch')).toFixed(1) : null, nosePitchAfter3s: after.length ? +after[Math.min(after.length - 1, 360)].pitch.toFixed(1) : null, crashed: r.fm.crashed, crashReason: r.fm.crashReason || '' }; }

// 17. Takım yukarı seyir: nötr çubuk 12 s
{ const { fm, rows } = hold({ alt: 3000, V: 200, throttle: 0.7 }, () => ({}), 12);
  R['17 gear-up cruise'] = { altDrift: +(rows[rows.length - 1].alt - rows[0].alt).toFixed(1), maxAbsQ: +mx(col(rows, 'q').map(Math.abs)).toFixed(2), nzExtrema: extrema(col(rows, 'nz'), 0.02), crashed: fm.crashed }; }
// 18. Takım aşağı yavaş uçuş
{ const { fm, rows } = hold({ alt: 1500, V: 80, throttle: 0.75, gear: 1, flaps: 1 }, () => ({}), 12);
  R['18 gear-down slow flight'] = { altDrift: +(rows[rows.length - 1].alt - rows[0].alt).toFixed(1), maxAbsQ: +mx(col(rows, 'q').map(Math.abs)).toFixed(2), nzExtrema: extrema(col(rows, 'nz'), 0.02), alpha: +rows[rows.length - 1].alpha.toFixed(1), crashed: fm.crashed }; }

// 19–21. Kare hızı bağımsızlığı: aynı manevra 120 / 60 / 30 fps ve değişken kare süresiyle
function fpsRun(fps, dtFn) {
  const fm = makeAir(M, { alt: 3000, V: 170 });
  const rows = [];
  // Girdi değişimleri 1/30 s'nin katlarında ve zaman 1/1200 s'ye yuvarlanır: 30/60/120 fps
  // hepsi değişimi AYNI anda görür (kayan nokta birikiminden bir kare kayma olmaz)
  run(M, fm, { seconds: 6, fps, dtFn, stick: (tt) => { const t = Math.round(tt * 1200) / 1200;
    return { pitch: t < 0.5 ? 0 : t < 3 ? -1 : t < 4.5 ? 0.8 : 0, roll: t >= 1 && t < 2 ? 0.5 : 0 }; }, log: (r) => rows.push(r) });
  return { fm, rows };
}
const ref = fpsRun(120);
let seed = 12345; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const variants = { '19 30 fps': fpsRun(30), '20 60 fps': fpsRun(60), '21 variable frame time': fpsRun(0, () => 1 / 120 + rnd() * (1 / 25 - 1 / 120)) };
// Zaman serisi RMS farkı (0,1 s aralıklarla, en yakın kayıt)
function rmsDiff(ra, rb, key) {
  let acc = 0, n = 0, j = 0;
  for (let t = 0.1; t < 6; t += 0.1) {
    const a = ra.reduce((best, r) => (Math.abs(r.t - t) < Math.abs(best.t - t) ? r : best), ra[0]);
    while (j < rb.length - 1 && Math.abs(rb[j + 1].t - t) <= Math.abs(rb[j].t - t)) j++;
    const d = a[key] - rb[j][key];
    acc += d * d; n++;
  }
  return +Math.sqrt(acc / n).toFixed(3);
}
for (const [k, v] of Object.entries(variants)) {
  const a = ref.fm, b = v.fm;
  const de = col(v.rows, 'de'); let jerk = 0; for (let i = 2; i < de.length; i++) jerk = Math.max(jerk, Math.abs(de[i] - 2 * de[i - 1] + de[i - 2]));
  R[k] = { deJerk: +jerk.toFixed(4), rmsPitchDeg: rmsDiff(ref.rows, v.rows, 'pitch'), rmsRollDeg: rmsDiff(ref.rows, v.rows, 'roll'), rmsQ: rmsDiff(ref.rows, v.rows, 'q'), posDiffM: +a.pos.distanceTo(b.pos).toFixed(2), pitchDiffDeg: +Math.abs(a.telemetry.pitch - b.telemetry.pitch).toFixed(2), rollDiffDeg: +Math.abs(a.telemetry.roll - b.telemetry.roll).toFixed(2), qExtremaPush: extrema(col(seg(v.rows, 0.5, 3), 'q'), 1), deReversalsPush: extrema(col(seg(v.rows, 0.5, 3), 'de'), 0.02), refQExtremaPush: extrema(col(seg(ref.rows, 0.5, 3), 'q'), 1), crashed: b.crashed };
}

const out = JSON.stringify(R, null, 1);
if (process.env.OUT) writeFileSync(process.env.OUT, out);
for (const [k, v] of Object.entries(R)) console.log(k.padEnd(26), JSON.stringify(v));

// ---- Kabul denetimleri ----
const g = (k) => R[k];
const checks = [
  ['01 tam ileri çubuk: q tek ve düzgün (≤ 2 uç)', g('01 full forward stick').qExtrema <= 2],
  ['01 stabilatör yön değişimi ≤ 3', g('01 full forward stick').deReversals <= 3],
  ['01 eyleyici hız sınırı (≤ 4 birim/s)', g('01 full forward stick').maxDeRate <= 4.001],
  ['01 negatif AoA sınırı içinde (≥ −16°)', g('01 full forward stick').minAlpha >= -16],
  ['02 tam geri çubuk düzgün, AoA ≤ 50°', g('02 full aft stick').qExtrema <= 2 && g('02 full aft stick').maxAlpha <= 50],
  ['03 nötr çubuk sönümü ≤ 1 sıfır geçişi', g('03 neutral-stick damping').qZeroCross <= 1],
  ['04 +g sınırı ≤ 9,3 g', g('04 max positive G').maxNz <= 9.3],
  ['05 −g sınırı ≥ −3,3 g', g('05 max negative G').minNz >= -3.3],
  ['06 yüksek hızda burun aşağı düzgün', g('06 high-speed pitch-down').qExtrema <= 2],
  ['07 düşük hızda burun aşağı düzgün, AoA ≥ −16°', g('07 low-speed pitch-down').qExtrema <= 2 && g('07 low-speed pitch-down').minAlpha >= -16],
  ['08 ses üstü ±g sınırları', g('08 supersonic pitch').up.maxNz <= 9.3 && g('08 supersonic pitch').down.minNz >= -3.3],
  ['09 yüksek AoA: eşik titremesi yok, AoA ≤ 50°', g('09 high-AoA maneuver').stallThresholdToggles === 0 && g('09 high-AoA maneuver').maxAlpha <= 50],
  ['10 stall: departure yok, toparlanır', ['10a stall recovery (release)', '10b stall, full aft held'].every((k) => g(k).recoverTime !== null && g(k).maxAbsP < 30 && g(k).maxAbsR < 30)],
  ['11 tam yatış ≥ 200°/s, kayma < 2°', g('11 full roll').maxP >= 200 && g('11 full roll').maxAbsBeta < 2],
  ['13 yuvarlanarak çekiş: kayma < 10°', g('13 pitch+roll').maxAbsBeta < 10],
  ['15 kalkış: çarpma/sekme yok, yerde yunuslama ≤ 13°, kopma < 200 kt', ['15a takeoff full pull', '15b takeoff 60% pull', '15c takeoff 35% pull', '15d takeoff full pull @130kt'].every((k) => !g(k).crashed && g(k).touchBacks === 0 && g(k).maxPitchOnGround <= 13 && g(k).liftoffKias !== null && g(k).liftoffKias < 200)],
  ['16 iniş: teker koyma, çarpma ve sekme yok', g('16 landing flare').touchdownFpm !== null && !g('16 landing flare').crashed && g('16 landing flare').bounces === 0],
  ['19/20 30 ve 60 fps = 120 fps (aynı girdi)', g('19 30 fps').rmsPitchDeg < 1e-6 && g('19 30 fps').rmsRollDeg < 1e-6 && g('20 60 fps').rmsPitchDeg < 1e-6],
  ['21 değişken kare süresi: tutarlı (RMS yunuslama < 0,5°)', g('21 variable frame time').rmsPitchDeg < 0.5],
  ['hiçbir senaryoda çarpma yok', Object.values(R).every((v) => !v.crashed)],
  ['NaN / sonsuz yok', Object.values(R).every((v) => v.finite !== false)],
];
let fail = 0;
console.log('');
for (const [name, ok] of checks) { console.log((ok ? 'PASS ' : 'FAIL ') + name); if (!ok) fail++; }
console.log(`\n${checks.length - fail}/${checks.length} denetim geçti · süre ${((Date.now() - t0) / 1000).toFixed(1)} s`);
process.exit(fail ? 1 : 0);
