import { CONFIG, UPGRADES } from '../config.js';
import { Lake } from './lake.js';
import { DredgeSim } from './dredge.js';
import { DroneSim } from './drone.js';
import { EVENTS } from './events.js';
import { computeStats, upgradeCost } from './stats.js';
import { createRng } from './rng.js';
import { processBatch } from './plant.js';

const freshDay = () => ({ removed: 0, fines: 0, repairs: 0, overCost: 0, overdug: 0, clogs: 0 });

// Gesamtzustand des Spiels (Management-Ebene), läuft in Echtzeit. Kein DOM, kein Canvas.
// Gewonnen hat, wer am Ende am meisten Geld hat: das Endergebnis ist `end.finalMoney`.
export class Game {
  constructor(seed = Date.now() & 0xffffff) {
    this.seed = seed;
    this.rng = createRng(seed);
    this.lake = Lake.generate(this.rng);
    this.time = 0; // Spielzeit in Sekunden
    this.day = 1;
    this.money = CONFIG.startMoney;
    this.levels = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
    this.stock = { normal: 0, toxic: 0 }; // Rohschlamm im Puffer vor der Anlage (m³)
    this.batch = { vol: 0, toxic: 0, idle: 0 }; // Charge, die gerade in der Anlage zusammenkommt
    this.cutDepth = CONFIG.echolot.defaultCut; // Abtragsdicke-Sollwert der Automatik
    this.overclock = false; // Anlage übertakten: mehr Durchsatz, höheres Risiko teurer Klassen
    this.totals = { removed: 0, income: 0, disposalPaid: 0, finesPaid: 0, repairsPaid: 0, overdigPaid: 0, eventCosts: 0, overdug: 0, classes: { B: 0, E: 0, C: 0 } };
    this.today = freshDay();
    this.status = 'playing'; // 'playing' | 'ended'
    this.end = null; // { reason: 'early' | 'deadline' | 'bankrupt', finalMoney, bonus, external }
    this.log = [];
    this.endCheck = 0;
  }

  get stats() { return computeStats(this.levels); }
  get stockTotal() { return this.stock.normal + this.stock.toxic; }
  get bufferRoom() { return Math.max(0, this.stats.bufferCapacity - this.stockTotal); }
  get totalSeconds() { return CONFIG.deadlineDays * CONFIG.daySeconds; }
  get timeLeft() { return Math.max(0, this.totalSeconds - this.time); }

  say(text, kind = 'info') { this.log.unshift({ day: this.day, text, kind }); this.log.length = Math.min(this.log.length, 60); }

  nextUpgradeCost(id) {
    return this.levels[id] >= UPGRADES[id].maxLevel ? null : upgradeCost(id, this.levels[id]);
  }

  buyUpgrade(id) {
    const cost = this.nextUpgradeCost(id);
    if (cost === null || this.money < cost || this.status !== 'playing') return false;
    this.money -= cost;
    this.levels[id]++;
    this.say(`${UPGRADES[id].name} auf Stufe ${this.levels[id]} (−${cost} CHF)`, 'upgrade');
    return true;
  }

  createSession() {
    const sim = new DredgeSim(this.lake, this.stats, this.rng);
    sim.cutDepth = this.cutDepth;
    sim.bufferRoom = this.bufferRoom;
    return sim;
  }

  // Verbucht, was der Ponton in einem Schritt getan hat (siehe DredgeSim.update)
  collect(d) {
    if (this.status !== 'playing') return;
    const toxic = d.toxicRemoved, overCost = d.overdug * CONFIG.layer.overdigCostPerM3;
    this.stock.normal += d.removed - toxic; // zu viel abgetragener Boden muss auch entsorgt werden
    this.stock.toxic += toxic;
    this.money -= d.fines + d.repairs + overCost;
    const t = this.totals, y = this.today;
    t.removed += d.removed; t.overdug += d.overdug; t.finesPaid += d.fines; t.repairsPaid += d.repairs; t.overdigPaid += overCost;
    y.removed += d.removed; y.fines += d.fines; y.repairs += d.repairs; y.overCost += overCost; y.overdug += d.overdug; y.clogs += d.clogs;
    if (d.tips) this.say(`Pumpe umgekippt, Bergung −${d.repairs} CHF`, 'bad');
  }

  startDrone() { return new DroneSim(this.lake, this.stats); }

  // Drohnenflug abrechnen: Pauschale für den Einsatz
  finishDrone(sim) {
    this.money -= CONFIG.drone.fee;
    this.say(`Drohne: ${sim.newlyAccepted} Zellen abgenommen, ${sim.newlyFlagged} mit Restschmutz gemeldet. Einsatz −${CONFIG.drone.fee} CHF`, sim.newlyFlagged ? 'bad' : 'good');
    return { accepted: sim.newlyAccepted, flagged: sim.newlyFlagged };
  }

  // Zeit läuft: Einkommen pro Sekunde, Anlage, Tageswechsel, Spielende
  update(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    const gain = CONFIG.incomePerSec * dt;
    this.money += gain; this.totals.income += gain;
    this._plant(dt);
    const day = Math.floor(this.time / CONFIG.daySeconds) + 1;
    while (this.day < day && this.status === 'playing') this._newDay();
    this.endCheck += dt;
    if (this.endCheck >= 0.5) { this.endCheck = 0; this.checkEnd(); }
  }

  // Anlage verarbeitet laufend aus dem Puffer; jede volle Charge wird analysiert und entsorgt.
  _plant(dt) {
    const cap = this.stats.plantCapacity * (this.overclock ? CONFIG.plant.overclockFactor : 1);
    const total = this.stockTotal, take = Math.min(total, cap * dt), b = this.batch;
    if (take > 0) {
      const share = this.stock.toxic / total;
      this.stock = { normal: this.stock.normal - take * (1 - share), toxic: this.stock.toxic - take * share };
      b.vol += take; b.toxic += take * share; b.idle = 0;
    } else b.idle += dt;
    while (b.vol >= CONFIG.plant.batchSize) this._finishBatch(CONFIG.plant.batchSize);
    if (b.vol > 0 && this.stockTotal < 1e-6 && b.idle >= 4) this._finishBatch(b.vol); // angebrochene Charge nicht ewig liegen lassen
  }

  _finishBatch(vol) {
    const b = this.batch, share = b.vol > 0 ? b.toxic / b.vol : 0;
    const r = processBatch(vol, share, this.stats, this.overclock, this.rng);
    b.vol -= vol; b.toxic -= share * vol;
    if (b.vol < 1e-9) { b.vol = 0; b.toxic = 0; }
    this.money -= r.cost + r.lab;
    this.totals.disposalPaid += r.cost + r.lab;
    this.totals.classes[r.cls]++;
    if (r.cls !== 'B') this.say(`Charge analysiert: ${CONFIG.plant.classes[r.cls].name}${r.cls === 'C' ? ' (das Labor lächelt nicht)' : ''}, −${r.cost + r.lab} CHF`, r.cls === 'C' ? 'bad' : 'info');
  }

  // Alles, was noch im Puffer und in der Charge liegt, wird jetzt analysiert und entsorgt.
  flushPlant() {
    const b = this.batch;
    b.vol += this.stockTotal; b.toxic += this.stock.toxic;
    this.stock = { normal: 0, toxic: 0 };
    while (b.vol > 1e-6) this._finishBatch(Math.min(CONFIG.plant.batchSize, b.vol));
  }

  _newDay() {
    this.day++;
    if (this.day > CONFIG.deadlineDays) return this._finish('deadline');
    const y = this.today;
    if (y.removed > 0.5 || y.fines > 0 || y.overCost > 0) {
      const extra = [];
      if (y.clogs) extra.push(`${y.clogs}× verstopft`);
      if (y.overdug > 0.5) extra.push(`${y.overdug.toFixed(0)} m³ zu tief (−${Math.round(y.overCost)} CHF)`);
      if (y.fines > 0) extra.push(`Trübungs-Bussen −${Math.round(y.fines)} CHF`);
      this.say(`Tagesbilanz: ${y.removed.toFixed(0)} m³ abgesaugt${extra.length ? ', ' + extra.join(', ') : ''}`, y.fines > 0 || y.overCost > 0 ? 'bad' : 'info');
    }
    this.today = freshDay();
    for (const ev of EVENTS) {
      if (this.rng.chance(ev.chance)) {
        const res = ev.apply(this, this.rng);
        if (res.cost) this.totals.eventCosts += res.cost;
        this.say(`${ev.text} (${res.cost ? '−' + res.cost : '+' + res.gain} CHF)`, res.cost ? 'bad' : 'good');
      }
    }
  }

  checkEnd() {
    if (this.status !== 'playing') return;
    if (this.money < CONFIG.bankruptcyLimit) this._finish('bankrupt');
    else if (this.lake.cleanFraction() >= CONFIG.winCleanFraction && this.lake.acceptedFraction() >= CONFIG.drone.winAcceptFraction) this._finish('early');
  }

  // Spielende. Endwertung = Geld. Früh fertig: Restmaterial wird entsorgt, die bis zur Frist noch
  // zustehende Finanzierung wird gutgeschrieben (früh fertig soll nichts kosten). Frist: Fremdfirma saniert den Rest.
  _finish(reason) {
    let bonus = 0, external = 0;
    if (reason !== 'bankrupt') this.flushPlant();
    if (reason === 'early') {
      bonus = Math.round(this.timeLeft * CONFIG.incomePerSec);
      this.money += bonus;
      this.say(`See saniert und abgenommen! Restfinanzierung +${bonus} CHF`, 'good');
    } else if (reason === 'deadline') {
      external = Math.round(this.lake.remaining() * CONFIG.deadline.externalCostPerM3);
      this.money -= external;
      this.say(external ? `Frist abgelaufen: Eine Fremdfirma saniert den Rest für ${external} CHF` : 'Frist erreicht, alles saniert.', external ? 'bad' : 'good');
    } else this.say('Budget überschritten, Projekt gestoppt.', 'bad');
    this.status = 'ended';
    this.end = { reason, bonus, external, finalMoney: Math.round(this.money) };
  }
}
