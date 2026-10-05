import { CONFIG } from '../config.js';
import { SLICE } from './slice.js';

// Tauchdrohne: fährt im Kasten unter dem verankerten Ponton (Querschnittsfenster) in x und y.
// Die Lampe leuchtet immer in Fahrtrichtung und leicht nach unten. Eine Boden-Spalte wird nur gescannt,
// solange sie im Lichtkegel liegt, die Drohne langsam fährt und nah genug ist. Das Ergebnis (abgenommen,
// Restschmutz, Fossilien, Befliegungsdaten) gilt für alle Karten-Zeilen des Kastens in dieser Spalte.
// Reine Simulation ohne Rendering/DOM (deshalb testbar). Koordinaten: x = Zellenkoordinate, h = Höhe über Felsgrund.
export class DroneSim {
  // win: { x0: linke Zelle des Fensters, row: gezeigte Zeile, r0: erste Zeile des Kastens (optional) }
  constructor(lake, stats, win) {
    this.lake = lake;
    this.stats = stats;
    this.x0 = win.x0;
    this.row = win.row;
    this.r0 = win.r0 ?? clamp(win.row - Math.floor(CONFIG.box.rows / 2), 0, lake.rows - CONFIG.box.rows); // erste Zeile des Kastens (wie beim Querschnitt)
    this.x = this.x0 + 1;
    this.h = SLICE.viewH - 1;
    this.vx = 0; this.vh = 0;
    this.speed = 0;
    this.face = 1; // Blickrichtung: +1 rechts, -1 links
    this.tilt = CONFIG.drone.beam.baseTilt; // Lampe zeigt um diesen Winkel nach unten
    this.progress = new Float32Array(SLICE.cols); // Scanfortschritt je Spalte (0..1)
    this.scanned = new Uint8Array(SLICE.cols);
    this.timeLeft = stats.droneBattery;
    this.newlyAccepted = 0;
    this.newlyFlagged = 0;
    this.found = []; // neu entdeckte Fossilien (Indizes)
    this.docCells = 0; // neu dokumentierte Zellen (Befliegungsdaten)
    this.over = false;
    this.autopilot = false; // Autopilot (voll ausgebaute Drohne): fliegt den Kasten selbst ab
    this.apDir = 1;
  }

  get range() { return this.stats.droneRadius * 2; } // Leuchtweite in Einheiten
  surfaceAt(x) { return this.lake.top[this.lake.idx(this.x0 + clamp(Math.floor(x) - this.x0, 0, SLICE.cols - 1), this.row)]; }

  // Richtung des Lichtkegels in (x, h): nach vorne und um `tilt` nach unten
  beamDir() { return { x: this.face * Math.cos(this.tilt), h: -Math.sin(this.tilt) }; }

  // Wird die Boden-Spalte c (Fensterindex) beleuchtet? Gibt { lit, dist } zurück.
  light(c) {
    const B = CONFIG.drone.beam, d = this.beamDir();
    const vx = this.x0 + c + 0.5 - this.x, vh = this.lake.top[this.lake.idx(this.x0 + c, this.row)] - this.h;
    const dist = Math.hypot(vx, vh);
    if (dist > this.range || dist < 1e-6) return { lit: dist < 1e-6, dist };
    return { lit: (vx * d.x + vh * d.h) / dist >= Math.cos(B.halfAngle), dist };
  }

  // input: { dx, dy } in -1..1 (dy > 0 = nach unten); beide Achsen gleichzeitig
  // Autopilot: langsam nach rechts, dann nach links zurück, bis alle Spalten gescannt sind; Höhe folgt dem Boden ein Stück voraus
  _autoInput() {
    const col = Math.floor(this.x - this.x0), open = (from, to) => { for (let c = Math.max(0, from); c <= Math.min(SLICE.cols - 1, to); c++) if (!this.scanned[c]) return true; return false; };
    if (this.apDir > 0 && !open(col, SLICE.cols - 1)) this.apDir = -1;
    else if (this.apDir < 0 && !open(0, col)) this.apDir = 1;
    const target = Math.max(this.surfaceAt(this.x), this.surfaceAt(this.x + this.apDir * 1.5)) + CONFIG.drone.beam.clearance + 0.45;
    return { dx: this.apDir * 0.3, dy: clamp((this.h - target) * 2, -1, 1) };
  }

  update(dt, input) {
    if (this.over) return;
    if (this.autopilot) {
      if (Math.abs(input?.dx || 0) > 0.2 || Math.abs(input?.dy || 0) > 0.2) this.autopilot = false; // Spieler übernimmt
      else input = this._autoInput();
    }
    const B = CONFIG.drone.beam;
    let ix = input.dx || 0, iy = input.dy || 0;
    const len = Math.hypot(ix, iy);
    if (len > 1) { ix /= len; iy /= len; }
    const vmax = this.stats.droneSpeed * 0.6, k = Math.min(1, dt * 4); // Unterwasser etwas träge
    this.vx += (ix * vmax - this.vx) * k;
    this.vh += (-iy * vmax - this.vh) * k;
    if (Math.abs(ix) > 0.2) this.face = Math.sign(ix); // Lampe folgt der Fahrtrichtung
    this.tilt += (clamp(B.baseTilt + 0.5 * iy, -0.3, 1.1) - this.tilt) * Math.min(1, dt * 5); // beim Tauchen steiler, beim Steigen flacher

    this.x = clamp(this.x + this.vx * dt, this.x0 + 0.3, this.x0 + SLICE.cols - 0.3);
    this.h += this.vh * dt;
    const floor = this.surfaceAt(this.x) + B.clearance;
    if (this.h < floor) { this.h = floor; this.vh = Math.max(0, this.vh); }
    if (this.h > SLICE.viewH - 0.3) { this.h = SLICE.viewH - 0.3; this.vh = Math.min(0, this.vh); }
    this.speed = Math.hypot(this.vx, this.vh);

    // Scannen: nur beleuchtete Spalten, nur bei langsamer Fahrt, nah am Boden schneller
    const speedFactor = clamp(1 - this.speed / B.maxScanSpeed, 0, 1);
    for (let c = 0; c < SLICE.cols; c++) {
      if (this.scanned[c]) continue;
      const { lit, dist } = this.light(c);
      if (!lit) continue;
      this.progress[c] += (dt / B.scanSeconds) * speedFactor * clamp(1.4 - dist / this.range, 0.25, 1);
      if (this.progress[c] >= 1) this._scanColumn(c);
    }
    this.timeLeft -= dt;
    if (this.autopilot && this.scanned.every(Boolean)) this.over = true; // alles gescannt
    if (this.timeLeft <= 0) { this.timeLeft = 0; this.over = true; }
  }

  // Ergebnis der Spalte c für alle Zeilen des Kastens
  _scanColumn(c) {
    const L = this.lake;
    this.scanned[c] = 1; this.progress[c] = 1;
    for (let y = this.r0; y < this.r0 + CONFIG.box.rows; y++) {
      const i = L.idx(this.x0 + c, y);
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
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
