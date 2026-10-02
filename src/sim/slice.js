import { CONFIG, DEBRIS } from '../config.js';

// Querschnitt: Minispiel-Instanz 2. Seitenansicht entlang einer Zeile des Seegrunds.
// Spaltenhöhe = Schlammmenge der Zelle (gleiche Einheit), so bleibt Karte und Querschnitt konsistent.
// work = Arbeitsrichtung: nur in diese Richtung (rechts bzw. nach unten) wird gesaugt.
// Rückwärts wird nicht gesaugt; der Kopf muss zum Anfang zurückgezogen werden (schneller).
export const SLICE = { cols: 16, viewH: 8, work: { x: 1, y: 1 }, returnBoost: 1.6 };

const ZERO = { removed: 0, toxicRemoved: 0, overdug: 0, hardRemoved: 0 };

const AUTO_ERRORS = [
  { id: 'stuck', text: 'Automatik hängt sich auf und starrt ins Wasser' },
  { id: 'wrongway', text: 'Automatik saugt rückwärts und ist sehr stolz darauf' },
  { id: 'high', text: 'Automatik hebt den Kopf und saugt Wasser (sehr sauber, aber nutzlos)' },
];

export class SliceSim {
  constructor(lake, stats, mapX, row, rng = Math.random, cutDepth = CONFIG.echolot.defaultCut) {
    this.lake = lake;
    this.stats = stats;
    this.rng = rng;
    this.row = row;
    this.x0 = clamp(Math.round(mapX) - SLICE.cols / 2, 0, lake.cols - SLICE.cols); // linke Zelle des Fensters
    this.x = this.x0 + 0.01; // Saugkopf startet links, absolute Zellenkoordinate
    this.h = Math.min(SLICE.viewH, this.surfaceAt(this.x) + 1.5); // Pumpenhöhe über Grund: schwebt, bis man sie verstellt
    this.suctioning = false;
    this.moving = false;
    this.cutDepth = cutDepth; // gewünschte Abtragsdicke (m) für die Automatik mit Echolot
    this.sounding = null; // Echolot: gemessene Oberfläche je Spalte vor dem Abtrag (m)
    if (stats.echolot > 0) this.sound();
    this.blocked = false; // z. B. Puffer voll: kein Saugen
    this.tilt = 0; // Schieflage der Pumpe 0..1 (bei 1 kippt sie um)
    this.tipped = 0; // Sekunden, bis die umgekippte Pumpe wieder steht
    this.overNote = 0; // Sperrzeit für die Übertiefungs-Meldung
    this.clog = 0; // Sekunden Zwangspause wegen Fremdstoff
    this.auto = { on: false, dir: 'sweep', error: null, errLeft: 0 };
    this.notes = []; // Meldungen für die Oberfläche: { kind, text }
  }

  say(kind, text, extra = {}) { this.notes.push({ kind, text, ...extra }); }

  surfaceAt(x) {
    const c = clamp(Math.floor(x), 0, this.lake.cols - 1);
    return this.lake.top[this.lake.idx(c, this.row)]; // Oberfläche (Höhe über Felsgrund)
  }

  // Einsaugstelle: unten und rechts von der Pumpe (x, h = Pumpenstandort)
  mouth() { return { x: this.x + CONFIG.pump.offsetX, h: this.h - CONFIG.pump.offsetY }; }

  windowRemaining() {
    let t = 0;
    for (let c = 0; c < SLICE.cols; c++) t += this.lake.mass[this.lake.idx(this.x0 + c, this.row)];
    return t;
  }

  // Echolot: lotet alle Spalten des Fensters aus (mit Messfehler je nach Stufe)
  sound() {
    const amp = CONFIG.echolot.noise[this.stats.echolot] ?? 0;
    this.sounding = new Float32Array(SLICE.cols);
    for (let c = 0; c < SLICE.cols; c++) {
      const i = this.lake.idx(this.x0 + c, this.row);
      this.sounding[c] = Math.max(0, this.lake.top[i] + (this.rng() - 0.5) * 2 * amp);
    }
    return true;
  }

  // Zielhöhe der Spalte c (Fensterindex): Messung minus gewünschte Abtragsdicke
  targetAt(c) { return Math.max(0, this.sounding[c] - this.cutDepth); }

  // Spalte c ist fertig, wenn sie auf der Zielhöhe liegt (Spalten ausserhalb der bestellten Fläche zählen nicht)
  colDone(c) {
    const i = this.lake.idx(this.x0 + c, this.row);
    return !this.lake.initial[i] || this.lake.top[i] <= this.targetAt(c) + CONFIG.echolot.doneEps;
  }

  allDone() {
    for (let c = 0; c < SLICE.cols; c++) if (!this.colDone(c)) return false;
    return true;
  }

  mouthCol() { return clamp(Math.floor(this.mouth().x) - this.x0, 0, SLICE.cols - 1); }

  toggleAuto() {
    if (this.stats.autoLevel <= 0) return false;
    this.auto.on = !this.auto.on;
    this.auto.error = null;
    this.auto.dir = this.x > this.x0 + SLICE.cols / 2 ? 'return' : 'sweep';
    if (this.auto.on && this.stats.echolot > 0) { // vor dem Abtrag neu loten
      this.sound();
      this.say('info', `Echolot: Seegrund vermessen. Abtrag ${this.cutDepth.toFixed(2)} m wird angefahren.`);
    } else this.say('info', this.auto.on ? 'Automatik läuft. Bitte nicht aus den Augen lassen.' : 'Automatik aus.');
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
    if (lvl >= 2 && this.tilt > 0.5) return { dx: 0, dy: -1, suction: false }; // höher ziehen, bevor sie kippt
    if (a.dir === 'sweep' && this.x >= this.x0 + SLICE.cols - CONFIG.pump.offsetX - 0.05) a.dir = 'return';
    else if (a.dir === 'return' && this.x <= this.x0 + 0.05) a.dir = 'sweep';
    // Mit Echolot wird nur dort gesaugt, wo die Zielhöhe noch nicht erreicht ist
    const need = !this.sounding || !this.colDone(this.mouthCol());
    return a.dir === 'sweep' ? { dx: 1, dy: 0, suction: need } : { dx: -1, dy: 0, suction: false };
  }

  // input: { dx, dy (dy>0 = nach unten), suction }
  // Der Kopf fährt immer nur auf einer Achse (die mit dem grösseren Ausschlag).
  update(dt, input) {
    const s = this.stats, a = this.auto, lvl = s.autoLevel, P = CONFIG.pump;
    if (this.tipped > 0) { // Pumpe liegt auf der Seite und wird mit der Kette wieder aufgerichtet
      this.tipped -= dt;
      this.suctioning = false; this.moving = false;
      this.h = Math.min(SLICE.viewH * 0.6, this.h + 3 * dt);
      if (this.tipped <= 0) { this.tipped = 0; this.tilt = 0; this.say('info', 'Pumpe steht wieder. Sie tut so, als wäre nichts gewesen.'); }
      return ZERO;
    }
    this.overNote = Math.max(0, this.overNote - dt);
    let ctl = input;
    if (a.on) {
      const manual = Math.abs(input.dx || 0) > 0.2 || Math.abs(input.dy || 0) > 0.2;
      if (manual) { a.on = false; a.error = null; this.say('info', 'Du übernimmst das Steuer.'); }
      else if (this.sounding ? this.allDone() : this.windowRemaining() < 0.05) {
        a.on = false;
        this.say('good', this.sounding ? 'Abtrag auf Sollwert erreicht. Echolot meldet: passt.' : 'Fenster sauber. Automatik meldet Feierabend.');
      }
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
    this.x = clamp(this.x + dx * speed * dt, this.x0, this.x0 + SLICE.cols - P.offsetX - 1e-6);
    this.h -= dy * speed * dt; // die Pumpe schwebt: nur die Kette (W/S) ändert die Höhe
    if (a.on && !a.error && this.tilt <= 0.5) { // Automatik regelt die Höhe selbst; Stufe 1 schwebt etwas zu hoch
      const v = s.speed * 1.2 * af * 0.8, target = this.surfaceAt(this.x) + (lvl === 1 ? 0.4 : 0);
      this.h += clamp(target - this.h, -v * dt, v * dt);
    }
    this.h = Math.max(this.surfaceAt(this.x), Math.min(this.h, SLICE.viewH)); // nicht in den Grund

    // Am Anschlag gibt es keine Fahrt, also auch kein Saugen (horizontal)
    this.suctioning = working && (dx === 0 || Math.abs(this.x - oldX) > 1e-9);
    if (!this.suctioning) {
      this.tilt = Math.max(0, this.tilt - P.tiltRecover * dt);
      return ZERO;
    }

    // Fremdstoff an der Einsaugstelle? Wer den Kopf anhebt, fährt drüber weg.
    const m = this.mouth();
    const di = this.lake.idx(clamp(Math.floor(m.x), 0, this.lake.cols - 1), this.row);
    const d = this.lake.debris[di];
    if (d && m.h <= this.surfaceAt(m.x) + 1.5) {
      this.lake.debris[di] = 0;
      this.clog = a.on ? CONFIG.auto.clogSeconds[lvl] : CONFIG.debris.clogSeconds;
      this.suctioning = false;
      this.say('clog', `Pumpe verstopft: ${DEBRIS[d - 1]}!`, { item: DEBRIS[d - 1] });
      return ZERO;
    }
    const res = this.lake.suckProfile(this.row, m.x, m.h, s.radius, s.power * dt);

    // Zu tief abgetragen? Pro gefahrene Zelle wird zu viel Material weggesaugt: der Boden bricht
    // vor der Pumpe weg und sie kippt nach vorne. Höher ziehen, schneller fahren oder Ballast helfen.
    const dist = Math.abs(this.x - oldX), cut = dist > 1e-9 ? res.removed / this.lake.area / dist : 0;
    if (cut > s.stability) this.tilt += (cut - s.stability) * P.tiltRate * dt;
    else this.tilt = Math.max(0, this.tilt - P.tiltRecover * dt);
    if (res.overdug > 1e-6 && this.overNote <= 0) {
      this.say('bad', 'Zu tief abgetragen! Der Seegrund ist jetzt tiefer als bestellt (und der Kanton hat es gemerkt).');
      this.overNote = 8;
    }
    if (this.tilt >= 1) {
      this.tilt = 1; this.tipped = P.tipSeconds; this.suctioning = false;
      this.say('tip', 'Pumpe gekippt! Sie liegt jetzt in der Baugrube und nennt es Mittagspause.');
    }
    return res;
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
