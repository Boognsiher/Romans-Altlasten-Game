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

  // Gewichtetes Abtragen: verteilt `amount` (m³) auf die Zellen [index, gewicht].
  // Gibt { removed, toxicRemoved } zurück. Masse wird nie erzeugt oder vernichtet.
  _drain(cells, amount) {
    let wSum = 0, removed = 0, toxicRemoved = 0;
    for (const c of cells) wSum += c[1];
    if (wSum === 0) return { removed, toxicRemoved };
    for (const [i, w] of cells) {
      const take = Math.min(this.mass[i], (amount * w) / wSum);
      this.mass[i] -= take;
      removed += take;
      if (this.toxic[i]) toxicRemoved += take;
      if (this.mass[i] < 1e-4) {
        removed += this.mass[i];
        if (this.toxic[i]) toxicRemoved += this.mass[i];
        this.mass[i] = 0; this.toxic[i] = 0;
      }
    }
    return { removed, toxicRemoved };
  }

  // Draufsicht-Saugen um (cx, cy) – flächig. (Im Spiel wird der Querschnitt genutzt, siehe suckProfile.)
  suck(cx, cy, radius, amount) {
    const cells = [];
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(this.cols - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(this.rows - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        const i = this.idx(x, y);
        if (d < 1 && this.mass[i] > 0) cells.push([i, 1 - d * d]);
      }
    }
    return this._drain(cells, amount);
  }

  // Querschnitt entlang Zeile `row`: Spaltenhöhe = mass. Der Saugkopf sitzt bei (headX, headH)
  // (headH = Höhe über Grund, gleiche Einheit wie mass). Gesaugt wird, was im Radius um den
  // Kopf an der Schlammoberfläche liegt – der Kopf muss also nah an die Oberfläche.
  suckProfile(row, headX, headH, radius, amount) {
    const cells = [];
    const x0 = Math.max(0, Math.floor(headX - radius)), x1 = Math.min(this.cols - 1, Math.ceil(headX + radius));
    for (let x = x0; x <= x1; x++) {
      const i = this.idx(x, row), m = this.mass[i];
      if (m <= 0) continue;
      const d = Math.hypot(x + 0.5 - headX, m - headH) / radius;
      if (d < 1) cells.push([i, 1 - d * d]);
    }
    return this._drain(cells, amount);
  }
}
