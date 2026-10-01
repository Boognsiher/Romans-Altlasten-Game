// Querschnitt: Minispiel-Instanz 2. Seitenansicht entlang einer Zeile des Seegrunds.
// Spaltenhöhe = Schlammmenge der Zelle (gleiche Einheit), so bleibt Karte und Querschnitt konsistent.
export const SLICE = { cols: 16, viewH: 10, sinkSpeed: 4 };

export class SliceSim {
  constructor(lake, stats, mapX, row) {
    this.lake = lake;
    this.stats = stats;
    this.row = row;
    this.x0 = clamp(Math.round(mapX) - SLICE.cols / 2, 0, lake.cols - SLICE.cols); // linke Zelle des Fensters
    this.x = this.x0 + SLICE.cols / 2; // Saugkopf, absolute Zellenkoordinate
    this.h = SLICE.viewH * 0.6; // Saugkopf-Höhe über Grund
    this.suctioning = false;
    this.moving = false;
  }

  surfaceAt(x) {
    const c = clamp(Math.floor(x), 0, this.lake.cols - 1);
    return this.lake.mass[this.lake.idx(c, this.row)];
  }

  // input: { dx, dy (dy>0 = nach unten), suction }
  update(dt, input) {
    const s = this.stats, speed = s.speed * 1.2;
    let dx = input.dx || 0, dy = input.dy || 0;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    this.moving = len > 0.01;
    this.x = clamp(this.x + dx * speed * dt, this.x0, this.x0 + SLICE.cols - 1e-6);
    this.h -= dy ? dy * speed * dt : SLICE.sinkSpeed * dt; // ohne Eingabe sinkt der Kopf
    this.h = Math.max(this.surfaceAt(this.x), Math.min(this.h, SLICE.viewH)); // nicht in den Grund

    this.suctioning = !!input.suction;
    if (!this.suctioning) return { removed: 0, toxicRemoved: 0 };
    return this.lake.suckProfile(this.row, this.x, this.h, s.radius, s.power * dt);
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
