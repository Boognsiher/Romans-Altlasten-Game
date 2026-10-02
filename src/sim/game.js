import { CONFIG, UPGRADES } from '../config.js';
import { Lake } from './lake.js';
import { DredgeSim } from './dredge.js';
import { DroneSim } from './drone.js';
import { EVENTS } from './events.js';
import { computeStats, upgradeCost } from './stats.js';
import { createRng } from './rng.js';
import { processBatch } from './plant.js';
import { clampMarkup, claimedAmount, decide, pickText } from './claims.js';

const freshDay = () => ({ removed: 0, pay: 0, fines: 0, repairs: 0, overCost: 0, overdug: 0, clogs: 0 });

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
    this.totals = { removed: 0, pay: 0, claimsPaid: 0, claimsFees: 0, claimsAccepted: 0, claimsPartial: 0, claimsRejected: 0, claimsExpired: 0, disposalPaid: 0, finesPaid: 0, repairsPaid: 0, overdigPaid: 0, eventCosts: 0, overdug: 0, classes: { B: 0, E: 0, C: 0 } };
    this.today = freshDay();
    this.claims = []; // Nachträge: { id, kind, text, fair, markup, status: 'draft' | 'submitted', expiresAt, resolveAt, claimed }
    this.claimAcc = { hard: 0, toxic: 0 }; // gesammelter Mehraufwand, aus dem Nachträge entstehen
    this.claimSeq = 0;
    this.notes = []; // Meldungen für die Oberfläche (Toast): { text, kind }
    this.status = 'playing'; // 'playing' | 'ended'
    this.end = null; // { reason: 'early' | 'deadline' | 'bankrupt', finalMoney, external }
    this.log = [];
    this.endCheck = 0;
  }

  get stats() { return computeStats(this.levels); }
  get stockTotal() { return this.stock.normal + this.stock.toxic; }
  get bufferRoom() { return Math.max(0, this.stats.bufferCapacity - this.stockTotal); }
  get totalSeconds() { return CONFIG.deadlineDays * CONFIG.daySeconds; }
  get timeLeft() { return Math.max(0, this.totalSeconds - this.time); }

  notify(text, kind = 'info') { this.notes.push({ text, kind }); }

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
    const layer = Math.max(0, d.removed - d.overdug); // nur belastetes Material wird vergütet
    const pay = ((layer - toxic) + toxic * CONFIG.pay.toxicMultiplier) * CONFIG.pay.perM3;
    this.money += pay;
    this.stock.normal += d.removed - toxic; // zu viel abgetragener Boden muss auch entsorgt werden
    this.stock.toxic += toxic;
    this.money -= d.fines + d.repairs + overCost;
    const t = this.totals, y = this.today;
    t.pay += pay; t.removed += d.removed; t.overdug += d.overdug; t.finesPaid += d.fines; t.repairsPaid += d.repairs; t.overdigPaid += overCost;
    y.pay += pay; y.removed += d.removed; y.fines += d.fines; y.repairs += d.repairs; y.overCost += overCost; y.overdug += d.overdug; y.clogs += d.clogs;
    // Vorkommnisse -> Nachtrag-Entwürfe
    for (const item of d.clogItems ?? []) {
      const [lo, hi] = CONFIG.claims.debris;
      this.addClaim('debris', `Sonderentsorgung: ${item}`, Math.round(this.rng.range(lo, hi) / 100) * 100);
    }
    const C = CONFIG.claims, a = this.claimAcc;
    a.hard += d.hardRemoved ?? 0; a.toxic += toxic;
    while (a.hard >= C.hardThreshold) { a.hard -= C.hardThreshold; this.addClaim('hard', `Mehraufwand harte Schicht (${C.hardThreshold} m³ Hartnäckiges)`, C.hardThreshold * C.hardPerM3); }
    while (a.toxic >= C.toxicThreshold) { a.toxic -= C.toxicThreshold; this.addClaim('toxic', 'Fassfund: Sonderbehandlung und Papierkram', C.toxicFair); }
    if (d.tips) this.say(`Pumpe umgekippt, Bergung −${d.repairs} CHF`, 'bad');
  }

  // ---------- Nachtragsmanagement ----------
  get openClaims() { return this.claims.filter((c) => c.status === 'draft').length; }

  addClaim(kind, text, fair) {
    const C = CONFIG.claims;
    const drafts = this.claims.filter((c) => c.status === 'draft');
    if (drafts.length >= C.maxOpen) { // der älteste Entwurf fällt hinten runter
      this.claims.splice(this.claims.indexOf(drafts[0]), 1);
      this.totals.claimsExpired++;
      this.say('Nachtrag-Stapel zu hoch: ein alter Entwurf ist hinten runtergefallen.', 'bad');
    }
    const c = { id: ++this.claimSeq, kind, text, fair, markup: C.defaultMarkup, status: 'draft', expiresAt: this.time + C.expireSeconds, resolveAt: 0, claimed: 0 };
    this.claims.push(c);
    this.say(`Nachtrag möglich: ${text} (Aufwand ${fair} CHF)`, 'info');
    this.notify(`Nachtrag möglich: ${text}`, 'info');
    return c;
  }

  setClaimMarkup(id, markup) {
    const c = this.claims.find((x) => x.id === id && x.status === 'draft');
    if (c) c.markup = clampMarkup(markup);
    return c;
  }

  // Nachtrag einreichen: kostet eine Gebühr, der Bauherr prüft ein paar Tage
  submitClaim(id) {
    const c = this.claims.find((x) => x.id === id && x.status === 'draft');
    if (!c || this.status !== 'playing') return false;
    c.status = 'submitted';
    c.claimed = claimedAmount(c.fair, c.markup);
    c.resolveAt = this.time + CONFIG.claims.reviewSeconds;
    this.money -= CONFIG.claims.fee;
    this.totals.claimsFees += CONFIG.claims.fee;
    this.say(`Nachtrag eingereicht: ${c.text}, Forderung ${c.claimed} CHF (−${CONFIG.claims.fee} CHF Aufwand)`, 'info');
    return true;
  }

  _claims() {
    for (const c of [...this.claims]) {
      if (c.status === 'draft' && this.time >= c.expiresAt) {
        this.claims.splice(this.claims.indexOf(c), 1);
        this.totals.claimsExpired++;
        this.say(`${pickText('expired', this.rng)} (${c.text})`, 'bad');
      } else if (c.status === 'submitted' && this.time >= c.resolveAt) {
        this.claims.splice(this.claims.indexOf(c), 1);
        const outcome = decide(c.markup, this.stats.docBonus, this.rng());
        const pay = outcome === 'accepted' ? c.claimed : outcome === 'partial' ? Math.round((c.claimed * CONFIG.claims.partialShare) / 10) * 10 : 0;
        this.money += pay; this.totals.claimsPaid += pay;
        if (outcome === 'accepted') this.totals.claimsAccepted++; else if (outcome === 'partial') this.totals.claimsPartial++; else this.totals.claimsRejected++;
        const msg = `${c.text}: ${pickText(outcome, this.rng)}${pay ? ` (+${pay} CHF)` : ''}`;
        this.say(msg, pay ? 'good' : 'bad');
        this.notify(msg, pay ? 'good' : 'bad');
      }
    }
  }

  startDrone() { return new DroneSim(this.lake, this.stats); }

  // Drohnenflug abrechnen: Pauschale für den Einsatz
  finishDrone(sim) {
    this.money -= CONFIG.drone.fee;
    this.say(`Drohne: ${sim.newlyAccepted} Zellen abgenommen, ${sim.newlyFlagged} mit Restschmutz gemeldet. Einsatz −${CONFIG.drone.fee} CHF`, sim.newlyFlagged ? 'bad' : 'good');
    return { accepted: sim.newlyAccepted, flagged: sim.newlyFlagged };
  }

  // Zeit läuft: Anlage, Tageswechsel, Spielende (Geld kommt nur durch abgesaugte m³)
  update(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    this._plant(dt);
    this._claims();
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
      this.say(`Tagesbilanz: ${y.removed.toFixed(0)} m³ abgesaugt (+${Math.round(y.pay)} CHF)${extra.length ? ', ' + extra.join(', ') : ''}`, y.fines > 0 || y.overCost > 0 ? 'bad' : 'info');
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

  // Spielende. Endwertung = Geld. Früh fertig: Restmaterial wird noch entsorgt.
  // Frist: Eine Fremdfirma saniert den Rest zum Notfalltarif.
  _finish(reason) {
    let external = 0;
    if (reason !== 'bankrupt') this.flushPlant();
    if (reason === 'early') this.say('See saniert und abgenommen!', 'good');
    else if (reason === 'deadline') {
      external = Math.round(this.lake.remaining() * CONFIG.deadline.externalCostPerM3);
      this.money -= external;
      this.say(external ? `Frist abgelaufen: Eine Fremdfirma saniert den Rest für ${external} CHF` : 'Frist erreicht, alles saniert.', external ? 'bad' : 'good');
    } else this.say('Budget überschritten, Projekt gestoppt.', 'bad');
    this.status = 'ended';
    this.end = { reason, external, finalMoney: Math.round(this.money) };
  }
}
