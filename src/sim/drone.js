import { CONFIG } from '../config.js';

// Instanz 3: Tauchdrohne nimmt den gereinigten Seegrund ab (Draufsicht).
// Was im Scanradius liegt und praktisch sauber ist, gilt als abgenommen; Restschmutz wird gemeldet.
export class DroneSim {
  constructor(lake, stats) {
    this.lake = lake;
    this.stats = stats;
    this.x = 1;
    this.y = 1;
    this.timeLeft = stats.droneBattery;
    this.newlyAccepted = 0;
    this.newlyFlagged = 0;
    this.found = []; // neu entdeckte Fossilien (Indizes)
    this.docCells = 0; // neu dokumentierte Zellen (Befliegungsdaten)
    this.over = false;
  }

  update(dt, input) {
    if (this.over) return;
    let dx = input.dx || 0, dy = input.dy || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const L = this.lake, v = this.stats.droneSpeed;
    this.x = clamp(this.x + dx * v * dt, 0, L.cols);
    this.y = clamp(this.y + dy * v * dt, 0, L.rows);

    const r = this.stats.droneRadius;
    for (let y = Math.max(0, Math.floor(this.y - r)); y <= Math.min(L.rows - 1, Math.ceil(this.y + r)); y++) {
      for (let x = Math.max(0, Math.floor(this.x - r)); x <= Math.min(L.cols - 1, Math.ceil(this.x + r)); x++) {
        if (Math.hypot(x + 0.5 - this.x, y + 0.5 - this.y) > r) continue;
        const i = L.idx(x, y);
        if (L.fossil[i] && !L.fossilFound[i]) { L.fossilFound[i] = 1; this.found.push(L.fossil[i]); }
        if (L.initial[i]) { // Befliegungsdaten: einmal vorher (verschmutzt), einmal nachher (sauber)
          const bit = L.mass[i] < CONFIG.drone.acceptMax ? 2 : 1;
          if (!(L.docBits[i] & bit)) { L.docBits[i] |= bit; this.docCells++; }
        }
        if (L.mass[i] < CONFIG.drone.acceptMax) {
          if (!L.accepted[i] && L.initial[i]) this.newlyAccepted++;
          L.accepted[i] = 1; L.flagged[i] = 0;
        } else {
          if (!L.flagged[i]) this.newlyFlagged++;
          L.accepted[i] = 0; L.flagged[i] = 1;
        }
      }
    }
    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.over = true; }
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
