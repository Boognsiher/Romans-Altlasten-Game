import { CONFIG, DEBRIS } from '../config.js';

// Querschnitt: Minispiel-Instanz 2. Seitenansicht entlang einer Zeile des Seegrunds.
// Spaltenhöhe = Schlammmenge der Zelle (gleiche Einheit), so bleibt Karte und Querschnitt konsistent.
// work = Arbeitsrichtung: nur in diese Richtung (rechts bzw. nach unten) wird gesaugt.
// Rückwärts wird nicht gesaugt; der Kopf muss zum Anfang zurückgezogen werden (schneller).
export const SLICE = { cols: 16, viewH: 8, work: { x: 1, y: 1 }, returnBoost: 1.6 };

const ZERO = { removed: 0, toxicRemoved: 0, overdug: 0, hardRemoved: 0, fossilsLost: [] };

const AUTO_ERRORS = [
  { id: 'stuck', text: 'Automatik hängt sich auf und starrt ins Wasser' },
  { id: 'wrongway', text: 'Automatik saugt rückwärts und ist sehr stolz darauf' },
  { id: 'high', text: 'Automatik hebt den Kopf und saugt Wasser (sehr sauber, aber nutzlos)' },
];

export class SliceSim {
  constructor(lake, stats, mapX, row, rng = Math.random, cutDepth = CONFIG.echolot.defaultCut, speedSetting = CONFIG.pumpSpeed.default) {
    this.lake = lake;
    this.stats = stats;
    this.rng = rng;
    this.row = row;
    const R = CONFIG.box.rows; // der Kasten deckt R Karten-Zeilen ab; jede wird einzeln gefahren, der Querschnitt zeigt die gewählte
    this.r0 = clamp(row - Math.floor(R / 2), 0, lake.rows - R);
    this.rows = Array.from({ length: R }, (_, k) => this.r0 + k);
    this.ci = row - this.r0; // Index der angezeigten Zeile im Kasten
    this.x0 = clamp(Math.round(mapX) - SLICE.cols / 2, 0, lake.cols - SLICE.cols); // linke Zelle des Fensters
    this.x = this.x0 + 0.01; // Saugkopf startet links, absolute Zellenkoordinate
    this.h = Math.min(SLICE.viewH, this.surfaceAt(this.x) + 1.5); // Pumpenhöhe: schwebt, bis man sie verstellt (setzt auch die eingestellte Höhe)
    this.suctioning = false;
    this.moving = false;
    this.speedSetting = speedSetting; // Tempo-Regler: Anteil des Höchsttempos (Katze und Winde)
    this.cutDepth = cutDepth; // gewünschte Abtragsdicke (m) für die Automatik mit Echolot
    this.sounding = null; // Echolot: gemessene Oberfläche je Spalte vor dem Abtrag (m)
    if (stats.echolot > 0) this.sound();
    this.blocked = false; // z. B. Puffer voll: kein Saugen
    this.tilt = 0; // Schieflage der Pumpe 0..1 (bei 1 kippt sie um)
    this.tipped = 0; // Sekunden, bis die umgekippte Pumpe wieder steht
    this.overNote = 0; // Sperrzeit für die Übertiefungs-Meldung
    this.clog = 0; // Sekunden Zwangspause wegen Fremdstoff
    this.freeing = null; // Freispül-Minispiel: { pos, dir, speed, zoneC, hits, need }
    this.auto = { on: false, dir: 'sweep', error: null, errLeft: 0, startX: this.x }; // startX: dort wurde die Automatik eingeschaltet, ab hier arbeitet sie
    this.notes = []; // Meldungen für die Oberfläche: { kind, text }
  }

  // h = tatsächliche Höhe, setH = eingestellte Höhe (Kettenlänge). Wer h direkt setzt, stellt auch die Kette ein.
  get h() { return this._h; }
  set h(v) { this._h = v; this.setH = v; }

  // Freispülen: Marker pendelt von 0 nach 1 und zurück; ein Versuch trifft, wenn er in der Zone liegt
  _debrisNames() { return this.lake.theme?.debrisNames ?? DEBRIS; }

  // idx = Index in DEBRIS (0-basiert): jeder Fremdstoff hat eigene Zonenbreite, Trefferzahl und Tempo
  _startFreeing(idx) {
    const U = CONFIG.unclog, info = CONFIG.debrisInfo[idx] ?? {};
    const f = { pos: 0, dir: 1, speed: info.speed ?? U.speed, zone: info.zone ?? U.zone, hits: 0, need: info.hits ?? U.hits, item: this._debrisNames()[idx] ?? null };
    this.freeing = f;
    f.zoneC = this._zone(f);
  }
  _zone(f = this.freeing) { const half = (f?.zone ?? CONFIG.unclog.zone) / 2; return half + this.rng() * (1 - 2 * half); }
  freeAttempt() {
    const f = this.freeing, U = CONFIG.unclog;
    if (!f || this.clog <= 0) return null;
    if (Math.abs(f.pos - f.zoneC) <= f.zone / 2) {
      f.hits++;
      if (f.hits >= f.need) { this.clog = 0; this.freeing = null; this.say('good', 'Pfropfen gelöst! Die Pumpe spuckt den Fremdstoff aus.'); return 'cleared'; }
      f.speed *= U.speedUp; f.zoneC = this._zone();
      return 'hit';
    }
    this.clog += U.missPenalty;
    return 'miss';
  }

  say(kind, text, extra = {}) { this.notes.push({ kind, text, ...extra }); }

  // Zeile des Kastens wählen (k = 0..R-1). Die Pumpe bleibt an ihrer Stelle, das Gelände der neuen Zeile kann sie anheben.
  selectRow(k) {
    k = clamp(Math.round(k), 0, this.rows.length - 1);
    if (k === this.ci || this.tipped > 0) return false;
    this.ci = k; this.row = this.rows[k];
    this.auto.error = null;
    if (this.auto.on) this.auto.dir = this.x >= this.auto.startX - 0.05 ? 'sweep' : 'return';
    return true;
  }

  // Stand der Zeile k des Kastens: Restschicht (Zellen über acceptMax), zu tief (unter Toleranz), Restmenge in m³
  rowStatus(k) {
    const r = this.rows[k]; let rest = 0, deep = 0, n = 0, vol = 0;
    for (let c = 0; c < SLICE.cols; c++) {
      const i = this.lake.idx(this.x0 + c, r);
      if (!this.lake.initial[i]) continue;
      n++; vol += this.lake.mass[i] * this.lake.area;
      if (this.lake.mass[i] >= CONFIG.drone.acceptMax) rest++;
      if (this.lake.target[i] - this.lake.top[i] > CONFIG.layer.tolerance) deep++;
    }
    return { n, rest, deep, vol, done: n > 0 && rest === 0 };
  }

  surfaceAt(x, row = this.row) {
    const c = clamp(Math.floor(x), 0, this.lake.cols - 1);
    return this.lake.top[this.lake.idx(c, row)]; // Oberfläche (Höhe über Felsgrund)
  }

  // Einsaugstelle: unten und rechts von der Pumpe (x, h = Pumpenstandort)
  mouth() { return { x: this.x + CONFIG.pump.offsetX, h: this.h - CONFIG.pump.offsetY }; }

  // Erste Spalte, die die Automatik bearbeitet (dort, wo sie eingeschaltet wurde); davor ist alles Sache des Spielers
  autoFromCol() { return clamp(Math.floor(this.auto.startX + CONFIG.pump.offsetX - this.x0), 0, SLICE.cols - 1); }

  windowRemaining() {
    let t = 0;
    for (let c = this.auto.on ? this.autoFromCol() : 0; c < SLICE.cols; c++) t += this.lake.mass[this.lake.idx(this.x0 + c, this.row)];
    return t;
  }

  // Echolot: lotet alle Spalten und alle Zeilen des Kastens aus (mit Messfehler je nach Stufe)
  sound() {
    const amp = CONFIG.echolot.noise[this.stats.echolot] ?? 0;
    this.sounding = this.rows.map((r) => {
      const a = new Float32Array(SLICE.cols);
      for (let c = 0; c < SLICE.cols; c++) a[c] = Math.max(0, this.lake.top[this.lake.idx(this.x0 + c, r)] + (this.rng() - 0.5) * 2 * amp);
      return a;
    });
    return true;
  }

  // Zielhöhe der Spalte c in Zeile k des Kastens (Standard: angezeigte Zeile): Messung minus gewünschte Abtragsdicke
  targetAt(c, k = this.ci) { return Math.max(0, this.sounding[k][c] - this.cutDepth); }

  // Spalte c ist fertig, wenn alle Zeilen des Kastens auf der Zielhöhe liegen (Zellen ausserhalb der bestellten Fläche zählen nicht)
  colDone(c) {
    const i = this.lake.idx(this.x0 + c, this.row);
    return !this.lake.initial[i] || this.lake.top[i] <= this.targetAt(c, this.ci) + CONFIG.echolot.doneEps;
  }

  allDone() {
    for (let c = this.auto.on ? this.autoFromCol() : 0; c < SLICE.cols; c++) if (!this.colDone(c)) return false;
    return true;
  }

  mouthCol() { return clamp(Math.floor(this.mouth().x) - this.x0, 0, SLICE.cols - 1); }

  toggleAuto() {
    if (this.stats.autoLevel <= 0) return false;
    this.auto.on = !this.auto.on;
    this.auto.error = null;
    this.auto.startX = this.x; // ab hier, nicht ab dem Anfang des Fensters
    this.auto.dir = 'sweep';
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

  // Ist Zeile k des Kastens am Sollwert (mit Echolot) bzw. sauber (ohne)?
  _rowDone(k) {
    const r = this.rows[k];
    for (let c = this.autoFromCol(); c < SLICE.cols; c++) {
      const i = this.lake.idx(this.x0 + c, r);
      if (!this.lake.initial[i]) continue;
      if (this.sounding ? this.lake.top[i] > this.targetAt(c, k) + CONFIG.echolot.doneEps : this.lake.mass[i] >= 0.05 / SLICE.cols) return false;
    }
    return true;
  }

  _nextOpenRow() {
    for (let d = 1; d < this.rows.length; d++) for (const k of [this.ci + d, this.ci - d]) if (k >= 0 && k < this.rows.length && !this._rowDone(k)) return k;
    return -1;
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
    else if (a.dir === 'return' && this.x <= a.startX + 0.05) a.dir = 'sweep';
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
        const next = lvl >= 3 ? this._nextOpenRow() : -1; // Vollautomatik macht mit der nächsten offenen Zeile weiter
        if (next >= 0) { this.selectRow(next); this.say('info', `Zeile fertig. Automatik wechselt zu Zeile ${next + 1}.`); ctl = this._autoControl(dt); }
        else {
          a.on = false;
          this.say('good', this.sounding ? 'Zeile auf Sollwert. Echolot meldet: passt.' : 'Zeile sauber. Automatik meldet Feierabend.');
        }
      }
      else ctl = this._autoControl(dt);
    }
    const clogged = this.clog > 0;
    if (clogged) this.clog = Math.max(0, this.clog - dt);
    if (this.freeing) {
      const f = this.freeing;
      if (this.clog <= 0) this.freeing = null;
      else { f.pos += f.dir * f.speed * dt; if (f.pos >= 1) { f.pos = 1; f.dir = -1; } else if (f.pos <= 0) { f.pos = 0; f.dir = 1; } }
    }

    let dx = ctl.dx || 0, dy = ctl.dy || 0;
    if (Math.abs(dx) >= Math.abs(dy)) dy = 0; else dx = 0;
    dx = clamp(dx, -1, 1); dy = clamp(dy, -1, 1);
    this.moving = Math.abs(dx) + Math.abs(dy) > 0.01;

    const along = dx * SLICE.work.x + dy * SLICE.work.y; // >0: in Arbeitsrichtung
    const pumpOk = !a.on || input.pumpOn !== false; // läuft die Automatik, entscheidet der Pumpenschalter über das Saugen
    const working = !!ctl.suction && pumpOk && !clogged && !this.blocked && along > -0.05; // Pumpe an: saugt auch im Stillstand, nur rückwärts nicht
    const af = a.on ? CONFIG.auto.speedFactor[lvl] : 1;
    const speed = s.headSpeed * this.speedSetting * af * (working ? s.suctionSpeedFactor : along < -0.05 ? SLICE.returnBoost : 1);

    const oldX = this.x;
    this.x = clamp(this.x + dx * speed * dt, this.x0, this.x0 + SLICE.cols - P.offsetX - 1e-6);
    const floor = this.surfaceAt(this.x); // nicht in den Grund
    if (dy) { // Kette von Hand: die neue Höhe ist die eingestellte
      this._h = clamp(this._h - dy * speed * dt, floor, SLICE.viewH);
      this.setH = this._h;
    }
    if (a.on && !a.error && this.tilt <= 0.5) { // Automatik regelt die Höhe selbst; Stufe 1 schwebt etwas zu hoch
      const v = s.headSpeed * this.speedSetting * af * 0.8, target = floor + (lvl === 1 ? 0.4 : 0);
      this._h += clamp(target - this._h, -v * dt, v * dt);
      this.setH = this._h;
    }
    if (this._h < floor) this._h = floor; // erhöhtes Gelände schiebt die Pumpe nach oben …
    else if (this._h > this.setH && !dy) { // … danach sinkt sie wieder auf die eingestellte Höhe
      this._h = Math.max(this.setH, floor, this._h - s.headSpeed * this.speedSetting * 0.8 * dt);
    }
    this._h = Math.min(this._h, SLICE.viewH);
    // zu hoch (über eingestellter Höhe, vom Gelände angehoben): die Pumpe hängt schief an der Kette
    const lift = Math.max(0, this._h - this.setH - P.liftTolerance), liftGain = lift * P.liftTiltRate * dt;

    this.suctioning = working;
    if (!this.suctioning) {
      if (liftGain > 0) this.tilt += liftGain; else this.tilt = Math.max(0, this.tilt - P.tiltRecover * dt);
      if (this.tilt >= 1) this._tip();
      return ZERO;
    }

    // Fremdstoff an der Einsaugstelle? Wer den Kopf anhebt, fährt drüber weg.
    const m = this.mouth();
    const mcol = clamp(Math.floor(m.x), 0, this.lake.cols - 1);
    const di = this.lake.debris[this.lake.idx(mcol, this.row)] ? this.lake.idx(mcol, this.row) : undefined;
    const d = di === undefined ? 0 : this.lake.debris[di];
    if (d && m.h <= this.surfaceAt(m.x) + 1.5) {
      this.lake.debris[di] = 0;
      this.clog = a.on ? CONFIG.auto.clogSeconds[lvl] : (CONFIG.debrisInfo[d - 1]?.clog ?? CONFIG.debris.clogSeconds);
      if (!a.on) this._startFreeing(d - 1); // von Hand: Minispiel
      this.suctioning = false;
      this.say('clog', `Pumpe verstopft: ${this._debrisNames()[d - 1]}!`, { item: this._debrisNames()[d - 1] });
      return ZERO;
    }
    const res = this.lake.suckProfile(this.row, m.x, m.h, s.radius, s.power * dt); // nur die gewählte Zeile

    // Zu tief abgetragen? Pro gefahrene Zelle wird zu viel Material weggesaugt: der Boden bricht
    // vor der Pumpe weg und sie kippt nach vorne. Höher ziehen, schneller fahren oder Ballast helfen.
    const dist = Math.max(Math.abs(this.x - oldX), P.minTravel * dt), cut = res.removed / this.lake.area / dist; // im Stillstand zählt eine Mindestfahrt: wer stehen bleibt, untergräbt den Boden
    if (cut > s.stability || liftGain > 0) this.tilt += Math.max(0, cut - s.stability) * P.tiltRate * dt + liftGain;
    else this.tilt = Math.max(0, this.tilt - P.tiltRecover * dt);
    if (res.overdug > 1e-6 && this.overNote <= 0) {
      this.say('bad', 'Zu tief abgetragen! Der Seegrund ist jetzt tiefer als bestellt (und der Kanton hat es gemerkt).');
      this.overNote = 8;
    }
    if (this.tilt >= 1) this._tip();
    return res;
  }

  _tip() {
    this.tilt = 1; this.tipped = CONFIG.pump.tipSeconds; this.suctioning = false;
    this.say('tip', 'Pumpe gekippt! Sie liegt jetzt in der Baugrube und nennt es Mittagspause.');
  }
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
