import { CONFIG } from '../config.js';

// Seegrund als Raster. Jede Zelle enthält Schlamm (m³); toxic-Zellen sind Altlasten (Fässer).
export class Lake {
  constructor(cols, rows) {
    this.cols = cols;
    this.rows = rows;
    this.mass = new Float32Array(cols * rows);
    this.toxic = new Uint8Array(cols * rows);
    this.initialTotal = 0;
  }

  static generate(rng, cfg = CONFIG.lake) {
    const lake = new Lake(cfg.cols, cfg.rows);
    const blob = (cx, cy, r, amp, toxic) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(lake.rows - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(lake.cols - 1, Math.ceil(cx + r)); x++) {
          const d = Math.hypot(x - cx, y - cy) / r;
          if (d >= 1) continue;
          const i = y * lake.cols + x;
          lake.mass[i] += amp * (1 - d * d);
          if (toxic && d < 0.8) lake.toxic[i] = 1;
        }
      }
    };
    for (let i = 0; i < cfg.blobs; i++) {
      blob(rng.range(0, lake.cols), rng.range(0, lake.rows), rng.range(3, 7), rng.range(1, 4), false);
    }
    for (let i = 0; i < cfg.toxicBlobs; i++) {
      blob(rng.range(2, lake.cols - 2), rng.range(2, lake.rows - 2), rng.range(1.5, 3), rng.range(4, 8), true);
    }
    lake.initialTotal = lake.remaining();
    return lake;
  }

  idx(x, y) { return y * this.cols + x; }

  remaining() {
    let s = 0;
    for (let i = 0; i < this.mass.length; i++) s += this.mass[i];
    return s;
  }

  // Anteil bereits entfernten Materials (0..1)
  cleanFraction() {
    return this.initialTotal > 0 ? 1 - this.remaining() / this.initialTotal : 1;
  }

  // Saugt um (cx, cy) mit Radius; verteilt `amount` (m³) gewichtet auf die Zellen.
  // Gibt { removed, toxicRemoved } in m³ zurück. Masse wird nie erzeugt oder vernichtet.
  suck(cx, cy, radius, amount) {
    const cells = [];
    let wSum = 0;
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(this.cols - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(this.rows - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        if (d >= 1) continue;
        const i = this.idx(x, y);
        if (this.mass[i] <= 0) continue;
        const w = 1 - d * d;
        cells.push([i, w]);
        wSum += w;
      }
    }
    let removed = 0, toxicRemoved = 0;
    if (wSum === 0) return { removed, toxicRemoved };
    for (const [i, w] of cells) {
      const take = Math.min(this.mass[i], (amount * w) / wSum);
      this.mass[i] -= take;
      removed += take;
      if (this.toxic[i]) toxicRemoved += take;
      if (this.mass[i] < 1e-4) { removed += this.mass[i]; if (this.toxic[i]) toxicRemoved += this.mass[i]; this.mass[i] = 0; this.toxic[i] = 0; }
    }
    return { removed, toxicRemoved };
  }
}
