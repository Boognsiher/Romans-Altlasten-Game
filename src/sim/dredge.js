import { CONFIG } from '../config.js';
import { SliceSim } from './slice.js';

// Eine Schicht mit zwei Instanzen und gemeinsamer Uhr:
//  - mode 'map':   Draufsicht, Ponton positionieren (Zeit läuft beim Fahren)
//  - mode 'slice': Querschnitt an der Ankerposition, hier wird abgesaugt
// Reine Simulation ohne Rendering/DOM (deshalb testbar).
export class DredgeSim {
  constructor(lake, stats, shiftSeconds = CONFIG.shiftSeconds) {
    this.lake = lake;
    this.stats = stats;
    this.timeLeft = shiftSeconds;
    this.mode = 'map';
    this.slice = null;
    this.x = 1; // Ponton-Position in Zellenkoordinaten
    this.y = 1;
    this.removed = 0; // m³ gesamt in dieser Schicht
    this.toxicRemoved = 0;
    this.turbidity = 0; // 0..1
    this.fines = 0; // CHF
    this.over = false;
  }

  get row() { return clamp(Math.floor(this.y), 0, this.lake.rows - 1); }
  get suctioning() { return this.mode === 'slice' && this.slice.suctioning; }

  // Anker werfen: Querschnitt an der aktuellen Position öffnen
  anchor() {
    if (this.over || this.mode !== 'map') return false;
    this.slice = new SliceSim(this.lake, this.stats, this.x, this.row);
    this.mode = 'slice';
    return true;
  }

  // Anker lichten: zurück zur Karte
  leave() {
    if (this.mode !== 'slice') return false;
    this.slice = null;
    this.mode = 'map';
    return true;
  }

  // input: { dx, dy in -1..1, suction: bool }
  update(dt, input) {
    if (this.over) return;
    const s = this.stats;

    if (this.mode === 'map') {
      let dx = input.dx || 0, dy = input.dy || 0;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.x = clamp(this.x + dx * s.speed * dt, 0, this.lake.cols);
      this.y = clamp(this.y + dy * s.speed * dt, 0, this.lake.rows);
    } else {
      const r = this.slice.update(dt, input);
      this.removed += r.removed;
      this.toxicRemoved += r.toxicRemoved;
      if (this.slice.suctioning) {
        // Aufgewirbelter Schlamm: mehr Leistung, Bewegung und Altlasten -> mehr Trübung
        const boost = (this.slice.moving ? 1.4 : 1) * (r.toxicRemoved > 0 ? 1.5 : 1);
        this.turbidity += (s.power / 20) * boost * (1 - s.curtain) * dt;
      }
    }

    this.turbidity = clamp(this.turbidity - 0.04 * dt, 0, 1);
    if (this.turbidity > CONFIG.turbidityFineThreshold) this.fines += CONFIG.turbidityFinePerSecond * dt;

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.over = true; }
  }

  // Ergebnis der Schicht: Abrechnung macht Game.
  result() {
    return { removed: this.removed, toxicRemoved: this.toxicRemoved, fines: Math.round(this.fines) };
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
