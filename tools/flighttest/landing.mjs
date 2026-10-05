// İniş senaryosu: trimli 3° yaklaşma (takım + flap), 11 m'de flare, teker koyma ve rulman.
// Test pilotu insan gibi TUTUM uçar: istenen yol açısı + mevcut AoA = istenen yunuslama;
// çubuk = tutum hatası ve yunuslama oranıyla orantılı. Otomatik gaz KIAS tutar.
import { makeAir, run, fmt } from './sim.mjs';
const DEG = Math.PI / 180;
export function landing(M, W, { verbose = false, fps = 60, Vapp = 145 } = {}) {
  const fm = makeAir(M, { alt: 400, V: Vapp / 1.943844, gammaDeg: -3, throttle: 0.5, gear: 1, flaps: 1, settle: 0 });
  let thr = 0.5;
  const pilot = (f, vsT) => {
    const T = f.telemetry, V = Math.max(30, f.vel.length());
    const gDes = Math.asin(Math.max(-0.5, Math.min(0.5, vsT / V))) / DEG;
    const thDes = gDes + T.alpha;
    return Math.max(-0.6, Math.min(0.6, (thDes - T.pitch) * 0.07 - T.q * 0.04));
  };
  const auto = (f, Vt, dt) => { thr = Math.max(0.08, Math.min(1, thr + (Vt - f.telemetry.kias) * 0.04 * dt)); f.throttle = thr; };
  // Oturtma: süzülüş hattında 10 s
  run(M, fm, { seconds: 10, fps, throttle: null, stick: (t, f) => { auto(f, Vapp, 1 / fps); return { pitch: pilot(f, -3 * DEG * Vapp / 1.943844) }; } });
  // Pist eşiğine taşı: süzülüş hattında 60 m AGL, teker koyma noktası x = −1200
  const agl0 = 60, xTd = -1200;
  const h0 = -fm.geom.wheelBottomY;
  fm.pos.set(xTd - agl0 / Math.tan(3 * DEG), agl0 + h0, 0);
  const rows = []; let td = null, bounces = 0, prevG = false, prevVs = 0, flareT = null;
  run(M, fm, { seconds: 45, fps, throttle: null, log: (r) => {
    rows.push(r);
    if (r.onGround && !prevG) { if (td) bounces++; else td = { ...r, vsTd: prevVs }; }
    if (!r.onGround) prevVs = r.vs;
    prevG = r.onGround;
  }, stick: (t, f) => {
    const agl = f.pos.y - h0;
    if (f.onGround || td) { f.throttle = 0; f.brakes = f.telemetry.kias < 120; return { pitch: f.telemetry.pitch > 1 ? -0.15 : 0 }; }
    const flare = agl < 11;
    if (flare && flareT === null) flareT = t;
    if (agl < 7) f.throttle = Math.max(0, f.throttle - 0.5 / fps); else auto(f, Vapp, 1 / fps);
    const vsT = flare ? -0.55 - 0.10 * agl : Math.max(-4.2, -0.07 * agl - 0.4);
    return { pitch: pilot(f, vsT) };
  } });
  if (verbose) for (const r of rows) if (Math.round(r.t * 60) % 15 === 0 && (!td || r.t < td.t + 4)) console.log(`t ${fmt(r.t,2)} agl ${fmt(r.alt + 0 - h0,1)} vs ${fmt(r.vs,2)} kias ${fmt(r.kias,0)} pitch ${fmt(r.pitch,1)} alpha ${fmt(r.alpha,1)} q ${fmt(r.q,2)} de ${fmt(r.de,3)} gnd ${r.onGround?1:0}`);
  return { rows, td, bounces, flareT, fm };
}
