// Performans hata ayıklama katmanı (Ayarlar > FPS counter > Debug ya da ` tuşu).
// HUD'dan AYRI bir DOM paneli: HUD tuvaline çizilmez, uçuş bilgisiyle karışmaz. Yalnızca
// ÖLÇÜLEN ya da sayılan değerler gösterilir; tahmini olanlar "est." ile işaretlidir:
//   - kare aralığı (rAF zaman damgaları arası, ms): ortalama / p95 / en kötü, 2 s pencere
//   - CPU kare işi (JS: fizik + dünya güncellemesi + çizim komutlarının gönderimi). GPU süresi
//     DEĞİLDİR: tarayıcı GPU zamanını vermez (WebGL zaman sorgusu iOS Safari'de yok).
//   - dünya güncellemesi / çizim gönderimi ayrı (ms), arazi ve öğe (bina/ağaç) inşa süresi
//   - çizim çağrısı, üçgen, program, geometri ve doku sayıları (renderer.info)
//   - arazi düğümleri, DEM ve görüntü karoları, görüntü doku belleği (est.: karo × 256² × 4 × 4/3)
//   - geometri belleği (est.: sahnedeki benzersiz geometrilerin öznitelik dizileri + örnek matrisleri)
//   - JS yığını yalnızca tarayıcı bildiriyorsa (Chrome); Safari'de "n/a"
// Kapalıyken maliyeti yoktur; açıkken metin 2 Hz, geometri belleği 0,5 Hz tazelenir.

const WIN = 120;   // 2 s @ 60 fps

export class PerfOverlay {
  constructor(el) {
    this.el = el;
    this.on = false;
    this.dt = new Float32Array(WIN); this.cpu = new Float32Array(WIN);
    this.n = 0; this.i = 0;
    this.t = 0; this.tGeo = 0;
    this.geoMB = 0; this.instMB = 0; this.geoCount = 0;
    this.world = 0; this.render = 0;
  }

  setOn(on) {
    this.on = !!on;
    if (this.el) { this.el.hidden = !this.on; if (!this.on) this.el.textContent = ''; }
    this.n = 0; this.i = 0; this.t = 0; this.tGeo = 0;
  }

  /** Her çizilen karede: ham kare aralığı (ms), CPU işi (ms), dünya güncellemesi ve çizim gönderimi (ms). */
  sample(frameMs, cpuMs, worldMs, renderMs) {
    if (!this.on) return;
    this.dt[this.i] = frameMs; this.cpu[this.i] = cpuMs;
    this.i = (this.i + 1) % WIN; this.n = Math.min(WIN, this.n + 1);
    // üstel ortalama (ayrıntı satırları için yeterli)
    this.world += (worldMs - this.world) * 0.1;
    this.render += (renderMs - this.render) * 0.1;
  }

  /** Geometri belleği tahmini: benzersiz BufferGeometry öznitelikleri + InstancedMesh matris/renk dizileri. */
  measureGeometry(scene) {
    const seen = new Set();
    let bytes = 0, inst = 0;
    scene.traverse((o) => {
      const g = o.geometry;
      if (g && !seen.has(g)) {
        seen.add(g);
        for (const k in g.attributes) { const a = g.attributes[k]; if (a && a.array) bytes += a.array.byteLength; }
        if (g.index) bytes += g.index.array.byteLength;
      }
      if (o.isInstancedMesh) {
        inst += o.instanceMatrix.array.byteLength;
        if (o.instanceColor) inst += o.instanceColor.array.byteLength;
      }
    });
    this.geoMB = bytes / 1048576; this.instMB = inst / 1048576; this.geoCount = seen.size;
  }

  /**
   * Metni tazeler (2 Hz). info: { renderer, scene, world, aq, targetFps, renderScale, pixelRatio }
   * @param {number} dt saniye
   */
  update(dt, info) {
    if (!this.on || !this.el) return;
    this.t += dt; this.tGeo -= dt;
    if (this.t < 0.5) return;
    this.t = 0;
    if (this.tGeo <= 0) { this.tGeo = 2; this.measureGeometry(info.scene); }
    const n = this.n;
    const arr = Array.from(this.dt.subarray(0, n)).sort((a, b) => a - b);
    const cpu = Array.from(this.cpu.subarray(0, n)).sort((a, b) => a - b);
    const avg = n ? arr.reduce((s, v) => s + v, 0) / n : 0;
    const p95 = n ? arr[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
    const worst = n ? arr[n - 1] : 0;
    const cAvg = n ? cpu.reduce((s, v) => s + v, 0) / n : 0, c95 = n ? cpu[Math.min(n - 1, Math.floor(n * 0.95))] : 0;
    const f = (v, k = 1) => (Number.isFinite(v) ? v.toFixed(k) : '—');
    const R = info.renderer, ri = R.info, W = info.world;
    const L = [];
    L.push(`<b>FRAME</b>  ${f(avg > 0 ? 1000 / avg : 0, 0)} fps (target ${info.targetFps})  ${f(avg)} ms avg  p95 ${f(p95)}  worst ${f(worst)}`);
    L.push(`<b>CPU</b>    ${f(cAvg)} ms avg  p95 ${f(c95)}  (world ${f(this.world)}  render submit ${f(this.render)})`);
    L.push(`<b>GPU</b>    calls ${ri.render.calls}  tris ${(ri.render.triangles / 1000).toFixed(0)}k  programs ${ri.programs ? ri.programs.length : '—'}`);
    L.push(`       geometries ${ri.memory.geometries}  textures ${ri.memory.textures}  scale ${f(info.renderScale, 2)} × DPR ${f(info.pixelRatio, 2)}  ${R.domElement.width}×${R.domElement.height}`);
    if (info.aq) L.push(`       adaptive tier ${info.aq.tier}${info.aq.tier ? ' (' + info.aq.label + ')' : ''}`);
    const T = W && W.terrain;
    if (T) {
      const tex = T.img.loadedCount();
      L.push(`<b>TERRAIN</b> nodes ${T.stats.drawn} drawn / ${T.stats.nodes} built  DEM tiles ${T.dem.tiles.size}  imagery ${tex}/${T.img.budget}`);
      L.push(`       imagery tex ${f(tex * 256 * 256 * 4 * 4 / 3 / 1048576, 0)} MB (est.)  update ${f(T.stats.updateMs, 2)} ms`);
    }
    const F = W && W.features;
    if (F) {
      const s = F.stats;
      L.push(`<b>FEATURES</b> tiles ${F.tiles.size}  buildings ${s.drawnBuildings}/${s.buildings}  trees ${s.drawnTrees}/${s.trees}  roads ${f(s.roadsKm, 0)} km  update ${f(s.updateMs, 2)} ms (build ${f(s.buildMs, 2)})`);
    }
    L.push(`<b>MEMORY</b> geometry ${f(this.geoMB)} MB + instances ${f(this.instMB)} MB (est., ${this.geoCount} geometries)`);
    const pm = typeof performance !== 'undefined' && performance.memory;
    L.push(`       JS heap ${pm ? f(pm.usedJSHeapSize / 1048576, 0) + ' / ' + f(pm.jsHeapSizeLimit / 1048576, 0) + ' MB' : 'n/a (not reported by this browser)'}`);
    this.el.innerHTML = L.join('\n');
  }
}
