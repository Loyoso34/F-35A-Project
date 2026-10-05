// Tam ileri çubuk (3000 m, 150 m/s) zaman serisi: çubuk, stabilatör komutu/gerçek konumu,
// yunuslama ivmesi/oranı, tutum, AoA, g ve adım süresi — CSV. OUT=dosya_adı_öneki (varsayılan nosedown)
import { load, makeAir, run } from './sim.mjs';
import { writeFileSync } from 'node:fs';
const M = await load();
const fm = makeAir(M, { alt: 3000, V: 150 });
const rows = [];
run(M, fm, { seconds: 4, fps: 60, stick: (t) => ({ pitch: t < 0.5 ? 0 : -1 }), log: (r) => rows.push(r) });
const cols = ['t', 'stickRaw', 'stick', 'sf', 'deCmd', 'de', 'qdot', 'q', 'pitch', 'alpha', 'nz', 'frameDt'];
const csv = [ 'time_s,stick_raw,stick_shaped,stick_prefiltered,stab_cmd_TEdown,stab_actual_TEdown,pitch_accel_dps2,pitch_rate_dps,pitch_deg,aoa_deg,load_factor_g,frame_dt_s,physics_dt_s' ]
  .concat(rows.map((r) => cols.map((c) => (+r[c]).toFixed(5)).join(',') + ',' + (1 / 120).toFixed(6)));
const OUT = process.env.OUT || 'nosedown';
writeFileSync(OUT + '.csv', csv.join('\n') + '\n');
writeFileSync(OUT + '.json', JSON.stringify(rows.map((r) => ({ t: +r.t.toFixed(4), de: +r.de.toFixed(4), qdot: +r.qdot.toFixed(2), q: +r.q.toFixed(3), pitch: +r.pitch.toFixed(3), alpha: +r.alpha.toFixed(3), nz: +r.nz.toFixed(4), stick: +r.stickRaw.toFixed(2) }))));
console.log(OUT + '.csv', rows.length, 'satır');
