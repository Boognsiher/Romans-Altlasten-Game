import { CONFIG, UPGRADES } from '../config.js';
import { Lake } from './lake.js';
import { DredgeSim } from './dredge.js';
import { EVENTS } from './events.js';
import { computeStats, upgradeCost } from './stats.js';
import { createRng } from './rng.js';
import { runPlantDay } from './plant.js';

// Gesamtzustand des Spiels (Management-Ebene). Kein DOM, kein Canvas.
export class Game {
  constructor(seed = Date.now() & 0xffffff) {
    this.seed = seed;
    this.rng = createRng(seed);
    this.lake = Lake.generate(this.rng);
    this.day = 1;
    this.money = CONFIG.startMoney;
    this.score = 0;
    this.levels = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
    this.stock = { normal: 0, toxic: 0 }; // Rohschlamm im Puffer vor der Anlage (m³)
    this.overclock = false; // Anlage übertakten: mehr Durchsatz, höheres Risiko teurer Klassen
    this.totals = { removed: 0, disposalPaid: 0, finesPaid: 0, eventCosts: 0, classes: { B: 0, E: 0, C: 0 } };
    this.status = 'playing'; // 'playing' | 'won' | 'lost'
    this.log = [];
  }

  get stats() { return computeStats(this.levels); }
  get stockTotal() { return this.stock.normal + this.stock.toxic; }
  get bufferRoom() { return Math.max(0, this.stats.bufferCapacity - this.stockTotal); }

  say(text, kind = 'info') { this.log.unshift({ day: this.day, text, kind }); this.log.length = Math.min(this.log.length, 50); }

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

  startShift() {
    return new DredgeSim(this.lake, this.stats, CONFIG.shiftSeconds, this.bufferRoom);
  }

  // Rechnet eine beendete Schicht ab (Material geht in den Puffer) und schaltet einen Tag weiter.
  finishShift(sim) {
    const r = sim.result();
    const toxic = r.toxicRemoved, normal = r.removed - r.toxicRemoved;
    const points = Math.round((normal + toxic * CONFIG.toxicPointsMultiplier) * CONFIG.pointsPerUnit);
    this.stock.normal += normal;
    this.stock.toxic += toxic;
    this.money -= r.fines;
    this.score += points;
    this.totals.removed += r.removed;
    this.totals.finesPaid += r.fines;
    this.say(`Schicht: ${r.removed.toFixed(1)} m³ abgesaugt, +${points} Punkte`);
    if (r.fines) this.say(`Trübungs-Busse −${r.fines} CHF`, 'bad');
    this.advanceDays(1);
    return { ...r, points };
  }

  // Anlage verarbeitet täglich bis zur Kapazität; jede Charge wird analysiert und entsorgt.
  runPlant() {
    const res = runPlantDay(this.stock, this.stats, this.overclock, this.rng);
    if (!res.processed) return;
    this.stock = res.stock;
    this.money -= res.cost;
    this.totals.disposalPaid += res.cost;
    const n = { B: 0, E: 0, C: 0 };
    for (const b of res.batches) { n[b.cls]++; this.totals.classes[b.cls]++; }
    const parts = Object.entries(n).filter(([, c]) => c).map(([k, c]) => `${c}× ${CONFIG.plant.classes[k].name}`);
    this.say(`Anlage presst ${res.processed.toFixed(0)} m³ trocken (${parts.join(', ')}). Labor und Deponie wollen −${res.cost} CHF${n.C ? ' – Typ C, das Labor lächelt nicht' : ''}`, n.C ? 'bad' : 'info');
  }

  advanceDays(n) {
    for (let i = 0; i < n && this.status === 'playing'; i++) {
      this.day++;
      this.runPlant();
      if ((this.day - 1) % CONFIG.trancheEveryDays === 0) {
        this.money += CONFIG.trancheAmount;
        this.say(`Tranche erhalten: +${CONFIG.trancheAmount} CHF`, 'good');
      }
      for (const ev of EVENTS) {
        if (this.rng.chance(ev.chance)) {
          const res = ev.apply(this, this.rng);
          if (res.cost) this.totals.eventCosts += res.cost;
          this.say(`${ev.text} (${res.cost ? '−' + res.cost : '+' + res.gain} CHF)`, res.cost ? 'bad' : 'good');
        }
      }
      this.checkEnd();
    }
  }

  checkEnd() {
    if (this.lake.cleanFraction() >= CONFIG.winCleanFraction) {
      this.status = 'won'; this.say('See saniert! 🎉', 'good');
    } else if (this.money < CONFIG.bankruptcyLimit) {
      this.status = 'lost'; this.say('Budget überschritten – Projekt gestoppt.', 'bad');
    } else if (this.day > CONFIG.deadlineDays) {
      this.status = 'lost'; this.say('Frist verstrichen – Sanierung nicht abgeschlossen.', 'bad');
    }
  }
}
