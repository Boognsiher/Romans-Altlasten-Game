// Querschnitt: Minispiel-Instanz 2. Seitenansicht entlang einer Zeile des Seegrunds.
// Spaltenhöhe = Schlammmenge der Zelle (gleiche Einheit), so bleibt Karte und Querschnitt konsistent.
// work = Arbeitsrichtung: nur in diese Richtung (rechts bzw. nach unten) wird gesaugt.
// Rückwärts wird nicht gesaugt; der Kopf muss zum Anfang zurückgezogen werden (schneller).
export const SLICE = { cols: 16, viewH: 10, sinkSpeed: 4, work: { x: 1, y: 1 }, returnBoost: 1.6 };

export class SliceSim {
  constructor(lake, stats, mapX, row) {
    this.lake = lake;
    this.stats = stats;
    this.row = row;
    this.x0 = clamp(Math.round(mapX) - SLICE.cols / 2, 0, lake.cols - SLICE.cols); // linke Zelle des Fensters
    this.x = this.x0 + 0.01; // Saugkopf startet links, absolute Zellenkoordinate
    this.h = SLICE.viewH * 0.6; // Saugkopf-Höhe über Grund
    this.suctioning = false;
    this.moving = false;
  }

  surfaceAt(x) {
    const c = clamp(Math.floor(x), 0, this.lake.cols - 1);
    return this.lake.mass[this.lake.idx(c, this.row)];
  }

  // input: { dx, dy (dy>0 = nach unten), suction }
  // Der Kopf fährt immer nur auf einer Achse (die mit dem grösseren Ausschlag).
  update(dt, input) {
    const s = this.stats, base = s.speed * 1.2;
    let dx = input.dx || 0, dy = input.dy || 0;
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
    dx = clamp(dx, -1, 1); dy = clamp(dy, -1, 1);
    const mag = Math.abs(dx) + Math.abs(dy); // eine Achse ist 0
    this.moving = false;
  }

  surfaceAt(x) {
    const c = clamp(Math.floor(x), 0, this.lake.cols - 1);
    return this.lake.mass[this.lake.idx(c, this.row)];
  }

  // input: { dx, dy (dy>0 = nach unten), suction }
  // Der Kopf fährt immer nur auf einer Achse (die mit dem grösseren Ausschlag).
  update(dt, input) {
    const s = this.stats, base = s.speed * 1.2;
    let dx = input.dx || 0, dy = input.dy || 0;
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
    const mag = Math.min(1, Math.hypot(dx, dy));
    if (mag > 0) { dx = (dx / Math.hypot(dx, dy)) * mag; dy = (dy / Math.hypot(dx || 1e-9, dy || 1e-9)) * 0 + dy; }
    this.moving = mag > 0.01;

    const along = dx * SLICE.work.x + dy * SLICE.work.y; // >0: in Arbeitsrichtung
    const working = !!input.suction && along > 0.05;
    const speed = base * (working ? s.suctionSpeedFactor : along < -0.05 ? SLICE.returnBoost : 1);

    const oldX = this.x;
    this.x = clamp(this.x + dx * speed * dt, this.x0, this.x0 + SLICE.cols - 1e-6);
    this.h -= dy ? dy * speed * dt : SLICE.sinkSpeed * dt; // ohne vertikale Eingabe sinkt der Kopf
    this.h = Math.max(this.surfaceAt(this.x), Math.min(this.h, SLICE.viewH)); // nicht in den Grund

    // Am Anschlag gibt es keine Fahrt, also auch kein Saugen (horizontal)
    this.suctioning = working && (dx === 0 || Math.abs(this.x - oldX) > 1e-9);
    if (!this.suctioning) return { removed: 0, toxicRemoved: 0 };
    return this.lake.suckProfile(this.row, this.x, this.h, s.radius, s.power * dt);
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
