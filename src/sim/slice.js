import { CONFIG, DEBRIS } from '../config.js';

// Querschnitt: Minispiel-Instanz 2. Seitenansicht entlang einer Zeile des Seegrunds.
// Spaltenhöhe = Schlammmenge der Zelle (gleiche Einheit), so bleibt Karte und Querschnitt konsistent.
// work = Arbeitsrichtung: nur in diese Richtung (rechts bzw. nach unten) wird gesaugt.
// Rückwärts wird nicht gesaugt; der Kopf muss zum Anfang zurückgezogen werden (schneller).
export const SLICE = { cols: 16, viewH: 10, sinkSpeed: 4, work: { x: 1, y: 1 }, returnBoost: 1.6 };

const AUTO_ERRORS = [
  { id: 'stuck', text: 'Automatik hängt sich auf und starrt ins Wasser' },
  { id: 'wrongway', text: 'Automatik saugt rückwärts und ist sehr stolz darauf' },
  { id: 'high', text: 'Automatik hebt den Kopf und saugt Wasser (sehr sauber, aber nutzlos)' },
];

export class SliceSim {
  constructor(lake, stats, mapX, row, rng = Math.random) {
    this.lake = lake;
    this.stats = stats;
    this.rng = rng;
    this.row = row;
    this.x0 = clamp(Math.round(mapX) - SLICE.cols / 2, 0, lake.cols - SLICE.cols); // linke Zelle des Fensters
    this.x = this.x0 + 0.01; // Saugkopf startet links, absolute Zellenkoordinate
    this.h = SLICE.viewH * 0.6; // Saugkopf-Höhe über Grund
    this.suctioning = false;
    this.moving = false;
    this.blocked = false; // z. B. Puffer voll: kein Saugen
    this.clog = 0; // Sekunden Zwangspause wegen Fremdstoff
    this.auto = { on: false, dir: 'sweep', error: null, errLeft: 0 };
    this.notes = []; // Meldungen für die Oberfläche: { kind, text }
  }

  say(kind, text) { this.notes.push({ kind, text }); }

  surfaceAt(x) {
    const c = clamp(Math.floor(x), 0, this.lake.cols - 1);
    return this.lake.mass[this.lake.idx(c, this.row)];
  }

  windowRemaining() {
    let t = 0;
    for (let c = 0; c < SLICE.cols; c++) t += this.lake.mass[this.lake.idx(this.x0 + c, this.row)];
    return t;
  }

  toggleAuto() {
    if (this.stats.autoLevel <= 0) return false;
    this.auto.on = !this.auto.on;
    this.auto.error = null;
    this.auto.dir = this.x > this.x0 + SLICE.cols / 2 ? 'return' : 'sweep';
    this.say('info', this.auto.on ? 'Automatik läuft. Bitte nicht aus den Augen lassen.' : 'Automatik aus.');
    return true;
  }

  // Fehler der Automatik beheben (Reset)
  fixAuto() {
    if (!this.auto.error) return false;
    this.auto.error = null;
    this.say('good', 'Aus- und wieder einschalten hilft auch hier.');
    return true;
  }

  _autoControl(dt) {
    const a = this.auto, lvl = this.stats.autoLevel;
    if (a.error) {
      a.errLeft -= dt;
      if (a.errLeft <= 0) { a.error = null; this.say('info', 'Automatik hat sich von selbst gefangen.'); }
    } else if (this.rng() < CONFIG.auto.errorRate[lvl] * dt) {
      const e = AUTO_ERRORS[Math.floor(this.rng() * AUTO_ERRORS.length)];
      a.error = e.id; a.errLeft = CONFIG.auto.errorSeconds;
      this.say('bad', `${e.text}! (R = Reset)`);
    }
    if (a.error === 'stuck') return { dx: 0, dy: 0, suction: false };
    if (a.error === 'wrongway') return { dx: -1, dy: 0, suction: true };
    if (a.error === 'high') return { dx: 0, dy: -1, suction: true };
    if (a.dir === 'sweep' && this.x >= this.x0 + SLICE.cols - 0.05) a.dir = 'return';
    else if (a.dir === 'return' && this.x <= this.x0 + 0.05) a.dir = 'sweep';
    return a.dir === 'sweep' ? { dx: 1, dy: 0, suction: true } : { dx: -1, dy: 0, suction: false };
  }

  // input: { dx, dy (dy>0 = nach unten), suction }
  // Der Kopf fährt immer nur auf einer Achse (die mit dem grösseren Ausschlag).
  update(dt, input) {
    const s = this.stats, a = this.auto, lvl = s.autoLevel;
    let ctl = input;
    if (a.on) {
      const manual = Math.abs(input.dx || 0) > 0.2 || Math.abs(input.dy || 0) > 0.2;
      if (manual) { a.on = false; a.error = null; this.say('info', 'Du übernimmst das Steuer.'); }
      else if (this.windowRemaining() < 0.05) { a.on = false; this.say('good', 'Fenster sauber. Automatik meldet Feierabend.'); }
      else ctl = this._autoControl(dt);
    }
    const clogged = this.clog > 0;
    if (clogged) this.clog = Math.max(0, this.clog - dt);

    let dx = ctl.dx || 0, dy = ctl.dy || 0;
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
    dx = clamp(dx, -1, 1); dy = clamp(dy, -1, 1);
    this.moving = Math.abs(dx) + Math.abs(dy) > 0.01;

    const along = dx * SLICE.work.x + dy * SLICE.work.y; // >0: in Arbeitsrichtung
    const working = !!ctl.suction && !clogged && !this.blocked && along > 0.05;
    const af = a.on ? CONFIG.auto.speedFactor[lvl] : 1;
    const speed = s.speed * 1.2 * af * (working ? s.suctionSpeedFactor : along < -0.05 ? SLICE.returnBoost : 1);

    const oldX = this.x;
    this.x = clamp(this.x + dx * speed * dt, this.x0, this.x0 + SLICE.cols - 1e-6);
    this.h -= dy ? dy * speed * dt : SLICE.sinkSpeed * dt; // ohne vertikale Eingabe sinkt der Kopf
    this.h = Math.max(this.surfaceAt(this.x), Math.min(this.h, SLICE.viewH)); // nicht in den Grund

    // Am Anschlag gibt es keine Fahrt, also auch kein Saugen (horizontal)
    this.suctioning = working && (dx === 0 || Math.abs(this.x - oldX) > 1e-9);
    if (!this.suctioning) return { removed: 0, toxicRemoved: 0 };

    // Fremdstoff direkt unter dem Kopf? Wer den Kopf anhebt, fährt drüber weg.
    const di = this.lake.idx(clamp(Math.floor(this.x), 0, this.lake.cols - 1), this.row);
    const d = this.lake.debris[di];
    if (d && this.h <= this.surfaceAt(this.x) + 1.5) {
      this.lake.debris[di] = 0;
      this.clog = a.on ? CONFIG.auto.clogSeconds[lvl] : CONFIG.debris.clogSeconds;
      this.suctioning = false;
      this.say('clog', `Pumpe verstopft: ${DEBRIS[d - 1]}!`);
      return { removed: 0, toxicRemoved: 0 };
    }
    return this.lake.suckProfile(this.row, this.x, this.h, s.radius, s.power * dt);
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
