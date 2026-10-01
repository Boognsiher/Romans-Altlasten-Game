import { CONFIG } from '../config.js';

// Minispiel "Abtragung": reine Simulation ohne Rendering/DOM (deshalb testbar).
export class DredgeSim {
  constructor(lake, stats, shiftSeconds = CONFIG.shiftSeconds) {
    this.lake = lake;
    this.stats = stats;
    this.timeLeft = shiftSeconds;
    this.x = 1; // Ponton-Position in Zellenkoordinaten
    this.y = 1;
    this.suctioning = false;
    this.removed = 0; // m³ gesamt in dieser Schicht
    this.toxicRemoved = 0;
    this.turbidity = 0; // 0..1
    this.fines = 0; // CHF
    this.over = false;
  }

  // input: { dx, dy in -1..1, suction: bool }
  update(dt, input) {
    if (this.over) return;
    const s = this.stats;
    this.suctioning = !!input.suction;

    let dx = input.dx || 0, dy = input.dy || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    const speed = s.speed * (this.suctioning ? s.suctionSpeedFactor : 1);
    this.x = clamp(this.x + dx * speed * dt, 0, this.lake.cols);
    this.y = clamp(this.y + dy * speed * dt, 0, this.lake.rows);
    const moving = len > 0.01;

    if (this.suctioning) {
      const r = this.lake.suck(this.x, this.y, s.radius, s.power * dt);
      this.removed += r.removed;
      this.toxicRemoved += r.toxicRemoved;
      // Aufgewirbelter Schlamm: mehr Leistung & Bewegung -> mehr Trübung
      this.turbidity += (s.power / 20) * (moving ? 1.4 : 1) * (1 - s.curtain) * dt;
    }
    this.turbidity = clamp(this.turbidity - 0.04 * dt, 0, 1);
    if (this.turbidity > CONFIG.turbidityFineThreshold) {
      this.fines += CONFIG.turbidityFinePerSecond * dt;
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.over = true; }
  }

  // Ergebnis der Schicht: Abrechnung macht GameState.
  result() {
    return {
      removed: this.removed,
      toxicRemoved: this.toxicRemoved,
      fines: Math.round(this.fines),
    };
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
