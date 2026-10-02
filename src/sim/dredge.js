import { CONFIG } from '../config.js';
import { SliceSim } from './slice.js';

// Baggersitzung mit zwei Instanzen, die in Echtzeit laufen (die Uhr gehört dem Game):
//  - mode 'map':   Draufsicht, Ponton positionieren
//  - mode 'slice': Querschnitt an der Ankerposition, hier wird abgesaugt
// update() liefert, was in diesem Schritt passiert ist (Delta); Game.collect() verbucht es.
// Reine Simulation ohne Rendering/DOM (deshalb testbar).
export class DredgeSim {
  constructor(lake, stats, rng = Math.random) {
    this.lake = lake;
    this.stats = stats;
    this.rng = rng;
    this.notes = []; // Meldungen aus dem Querschnitt (Verstopfung, Automatik ...)
    this.cutDepth = CONFIG.echolot.defaultCut; // gewünschte Abtragsdicke der Automatik (m)
    this.bufferRoom = Infinity; // so viel m³ passen noch in den Puffer vor der Anlage (setzt das Game)
    this.mode = 'map';
    this.slice = null;
    this.x = 1; // Ponton-Position in Zellenkoordinaten
    this.y = 1;
    this.turbidity = 0; // 0..1
    // Summen seit Spielbeginn (nur Anzeige)
    this.removed = 0; this.toxicRemoved = 0; this.overdug = 0; this.clogs = 0; this.tips = 0;
  }

  get row() { return clamp(Math.floor(this.y), 0, this.lake.rows - 1); }
  get bufferFull() { return this.bufferRoom <= 1e-6; }
  get suctioning() { return this.mode === 'slice' && this.slice.suctioning; }

  setStats(stats) {
    this.stats = stats;
    if (this.slice) this.slice.stats = stats;
  }

  // Anker werfen: Querschnitt an der aktuellen Position öffnen
  anchor() {
    if (this.mode !== 'map') return false;
    this.slice = new SliceSim(this.lake, this.stats, this.x, this.row, this.rng, this.cutDepth);
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

  setCutDepth(v) {
    this.cutDepth = Math.min(CONFIG.echolot.maxCut, Math.max(CONFIG.echolot.minCut, v));
    if (this.slice) this.slice.cutDepth = this.cutDepth;
  }

  toggleAuto() { return this.mode === 'slice' && this.slice.toggleAuto(); }
  fixAuto() { return this.mode === 'slice' && this.slice.fixAuto(); }

  // input: { dx, dy in -1..1, suction: bool }
  // Gibt zurück, was in diesem Schritt passiert ist: { removed, toxicRemoved, overdug, hardRemoved, fines, repairs, tips, clogs, clogItems }
  update(dt, input) {
    const s = this.stats;
    const d = { removed: 0, toxicRemoved: 0, overdug: 0, hardRemoved: 0, fines: 0, repairs: 0, tips: 0, clogs: 0, clogItems: [] };

    if (this.mode === 'map') {
      let dx = input.dx || 0, dy = input.dy || 0;
      const len = Math.hypot(dx, dy);
      if (len > 1) { dx /= len; dy /= len; }
      this.x = clamp(this.x + dx * s.speed * dt, 0, this.lake.cols);
      this.y = clamp(this.y + dy * s.speed * dt, 0, this.lake.rows);
    } else {
      this.slice.blocked = this.bufferFull; // Puffer voll: auch die Automatik darf nicht saugen
      const r = this.slice.update(dt, input);
      for (const n of this.slice.notes.splice(0)) {
        this.notes.push(n);
        if (n.kind === 'clog') { d.clogs++; d.clogItems.push(n.item); }
        if (n.kind === 'tip') { d.tips++; d.repairs += CONFIG.pump.repairCost; }
      }
      d.removed = r.removed; d.toxicRemoved = r.toxicRemoved; d.overdug = r.overdug; d.hardRemoved = r.hardRemoved;
      if (this.slice.suctioning) {
        // Aufgewirbelter Schlamm: mehr Leistung, Bewegung und Altlasten -> mehr Trübung
        const boost = (this.slice.moving ? 1.4 : 1) * (r.toxicRemoved > 0 ? 1.5 : 1);
        this.turbidity += (s.power / 20) * boost * (1 - s.curtain) * dt;
      }
    }

    this.turbidity = clamp(this.turbidity - 0.04 * dt, 0, 1);
    if (this.turbidity > CONFIG.turbidityFineThreshold) d.fines = CONFIG.turbidityFinePerSecond * dt;

    this.removed += d.removed; this.toxicRemoved += d.toxicRemoved; this.overdug += d.overdug;
    this.clogs += d.clogs; this.tips += d.tips;
    return d;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
