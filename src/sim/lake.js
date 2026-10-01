import { CONFIG, DEBRIS } from '../config.js';

// Seegrund als Raster (Zelle = cellArea m²).
// - top:    aktuelle Oberfläche (Höhe über dem Felsgrund, in m)
// - target: Sollsohle = ursprüngliche Oberfläche - Schichtdicke (bei sauberen Zellen = Oberfläche)
// - mass:   Restdicke der belasteten Schicht in m (= max(0, top - target))
// Darunter liegt fester, sauberer Untergrund. Alle öffentlichen Mengen sind in m³.
export class Lake {
  constructor(cols, rows) {
    const n = cols * rows;
    this.cols = cols;
    this.rows = rows;
    this.area = CONFIG.layer.cellArea;
    this.top = new Float32Array(n);
    this.target = new Float32Array(n);
    this.mass = new Float32Array(n);
    this.toxic = new Uint8Array(n);
    this.hard = new Uint8Array(n); // 0 weich, 1 verdichtet, 2 hart (mehrere Überfahrten)
    this.debris = new Uint8Array(n); // 0 nichts, sonst Index in DEBRIS + 1
    this.initial = new Uint8Array(n); // 1 = Zelle gehörte zur abzutragenden Schicht
    this.accepted = new Uint8Array(n); // von der Drohne abgenommen
    this.flagged = new Uint8Array(n); // Drohne meldet Restschmutz
    this.initialTotal = 0;
  }

  static generate(rng, cfg = CONFIG.lake) {
    const lake = new Lake(cfg.cols, cfg.rows);
    const T = CONFIG.layer.thickness;
    const each = (cx, cy, r, fn) => {
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(lake.rows - 1, Math.ceil(cy + r)); y++) {
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(lake.cols - 1, Math.ceil(cx + r)); x++) {
          const d = Math.hypot(x - cx, y - cy) / r;
          if (d < 1) fn(lake.idx(x, y), d);
        }
      }
    };
    // Wo liegt belastetes Material? (Blobs; toxische Kerne = Fässer)
    for (let i = 0; i < cfg.blobs; i++) {
      each(rng.range(0, lake.cols), rng.range(0, lake.rows), rng.range(3, 7), (k, d) => { lake.mass[k] += 1 - d * d; });
    }
    for (let i = 0; i < cfg.toxicBlobs; i++) {
      each(rng.range(2, lake.cols - 2), rng.range(2, lake.rows - 2), rng.range(1.5, 3), (k, d) => { lake.mass[k] += 2; if (d < 0.8) lake.toxic[k] = 1; });
    }
    for (let k = 0; k < lake.mass.length; k++) {
      lake.initial[k] = lake.mass[k] > 0.5 ? 1 : 0;
      lake.mass[k] = lake.initial[k] ? T : 0; // überall gleich dick
      if (!lake.initial[k]) lake.toxic[k] = 0;
    }
    // Unebener Seegrund: Hügel und Mulden
    lake.top.fill(4);
    for (let i = 0; i < 14; i++) {
      const a = rng.range(-1.8, 2.2);
      each(rng.range(0, lake.cols), rng.range(0, lake.rows), rng.range(4, 9), (k, d) => { lake.top[k] += a * (1 - d * d); });
    }
    for (let k = 0; k < lake.top.length; k++) {
      lake.top[k] = Math.min(6.5, Math.max(2.2, lake.top[k]));
      lake.target[k] = lake.top[k] - lake.mass[k];
    }
    // Harte Schichten und Fremdstoffe liegen in der belasteten Schicht
    for (let i = 0; i < CONFIG.hard.blobs; i++) {
      each(rng.range(0, lake.cols), rng.range(0, lake.rows), rng.range(2.5, 5), (k, d) => {
        if (lake.mass[k] > 0) lake.hard[k] = Math.max(lake.hard[k], d < 0.5 ? 2 : 1);
      });
    }
    for (let n = 0, tries = 0; n < CONFIG.debris.count && tries < 1000; tries++) {
      const k = lake.idx(rng.int(0, lake.cols - 1), rng.int(0, lake.rows - 1));
      if (lake.mass[k] > 0 && !lake.debris[k]) { lake.debris[k] = rng.int(1, DEBRIS.length); n++; }
    }
    lake.initialTotal = lake.remaining();
    return lake;
  }

  // Testhilfe: ebener See, überall Schichtdicke `thickness` auf Höhe `top` (Standard: Sollsohle bei 0)
  setFlat(thickness, top = thickness) {
    this.top.fill(top); this.target.fill(top - thickness); this.mass.fill(thickness);
    this.initial.fill(1); this.hard.fill(0); this.debris.fill(0); this.toxic.fill(0);
    this.initialTotal = this.remaining();
    return this;
  }

  idx(x, y) { return y * this.cols + x; }

  // Noch zu entfernende belastete Menge in m³
  remaining() {
    let s = 0;
    for (let i = 0; i < this.mass.length; i++) s += this.mass[i];
    return s * this.area;
  }

  // Anteil der ursprünglich belasteten Zellen, die die Drohne abgenommen hat (0..1)
  acceptedFraction() {
    let n = 0, ok = 0;
    for (let i = 0; i < this.initial.length; i++) if (this.initial[i]) { n++; if (this.accepted[i]) ok++; }
    return n ? ok / n : 1;
  }

  // Anteil der belasteten Schicht, der bereits entfernt ist (0..1)
  cleanFraction() {
    return this.initialTotal > 0 ? 1 - this.remaining() / this.initialTotal : 1;
  }

  // Zu tief abgetragen? (Oberfläche liegt unter der Sollsohle)
  overdug(i, tolerance = CONFIG.layer.tolerance) { return this.initial[i] === 1 && this.top[i] < this.target[i] - tolerance; }

  // Gewichtetes Abtragen: verteilt `amount` (Höhe in m) auf die Zellen [index, gewicht].
  // Der feste Untergrund unter der Sollsohle geht nur mit groundFirmness. Gibt Höhen zurück:
  // removed (gesamt), toxicRemoved (aus der belasteten Schicht), overdug (unter der Sollsohle).
  _drain(cells, amount) {
    let wSum = 0, removed = 0, toxicRemoved = 0, overdug = 0;
    for (const c of cells) wSum += c[1];
    if (wSum === 0) return { removed, toxicRemoved, overdug };
    for (const [i, w] of cells) {
      const above = this.mass[i]; // belastete Schicht über der Sollsohle
      let eff = 1 / (1 + this.hard[i] * CONFIG.hard.factor); // harte Schicht: weniger Leistung
      if (above <= 1e-6) eff *= CONFIG.layer.groundFirmness; // nur noch Untergrund
      const take = Math.min(this.top[i], ((amount * w) / wSum) * eff);
      const fromLayer = Math.min(take, above);
      const tol = CONFIG.layer.tolerance, depth = () => Math.max(0, this.target[i] - this.top[i]);
      const overBefore = Math.max(0, depth() - tol);
      this.top[i] -= take;
      this.mass[i] = Math.max(0, this.top[i] - this.target[i]);
      removed += take; overdug += Math.max(0, depth() - tol) - overBefore; // erst tiefer als die Toleranz zählt
      if (this.toxic[i]) toxicRemoved += fromLayer;
      if (this.mass[i] > 0 && this.mass[i] < 0.01) { // winziger Rest: gilt als erledigt
        const rest = this.mass[i];
        this.top[i] = this.target[i]; this.mass[i] = 0;
        removed += rest;
        if (this.toxic[i]) toxicRemoved += rest;
      }
      if (this.mass[i] === 0) { this.toxic[i] = 0; this.hard[i] = 0; }
    }
    return { removed, toxicRemoved, overdug };
  }

  _vol(r) { return { removed: r.removed * this.area, toxicRemoved: r.toxicRemoved * this.area, overdug: r.overdug * this.area }; }

  // Draufsicht-Saugen um (cx, cy) – flächig, nur belastete Zellen. (Im Spiel zählt der Querschnitt.)
  suck(cx, cy, radius, amount) {
    const cells = [];
    const x0 = Math.max(0, Math.floor(cx - radius)), x1 = Math.min(this.cols - 1, Math.ceil(cx + radius));
    const y0 = Math.max(0, Math.floor(cy - radius)), y1 = Math.min(this.rows - 1, Math.ceil(cy + radius));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        const i = this.idx(x, y);
        if (d < 1 && this.initial[i]) cells.push([i, 1 - d * d]);
      }
    }
    return this._vol(this._drain(cells, amount / this.area));
  }

  // Querschnitt entlang Zeile `row`. Die Einsaugstelle sitzt bei (headX, headH) (Höhe über Felsgrund).
  // Gesaugt wird, was im Radius an der Oberfläche liegt: Der Kopf muss also nah an die Oberfläche.
  // amount in m³; Ergebnis in m³.
  suckProfile(row, headX, headH, radius, amount) {
    const cells = [];
    const x0 = Math.max(0, Math.floor(headX - radius)), x1 = Math.min(this.cols - 1, Math.ceil(headX + radius));
    for (let x = x0; x <= x1; x++) {
      const i = this.idx(x, row), s = this.top[i];
      if (s <= 0 || !this.initial[i]) continue; // nur die bestellte Fläche wird bearbeitet
      const d = Math.hypot(x + 0.5 - headX, s - headH) / radius;
      if (d < 1) cells.push([i, 1 - d * d]);
    }
    return this._vol(this._drain(cells, amount / this.area));
  }
}
