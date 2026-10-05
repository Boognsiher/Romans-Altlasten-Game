import { CONFIG, UPGRADES, FOSSILS, levelById } from '../config.js';
import { Lake } from './lake.js';
import { CraneSim } from './crane.js';
import { DredgeSim } from './dredge.js';
import { DroneSim } from './drone.js';
import { EVENTS } from './events.js';
import { computeStats, upgradeCost } from './stats.js';
import { createRng } from './rng.js';
import { processBatch } from './plant.js';
import { clampMarkup, claimedAmount, decide, pickText } from './claims.js';
import { TEXTS as XT, PLACES, pick, makeZone } from './extras.js';

const freshDay = () => ({ removed: 0, pay: 0, fines: 0, repairs: 0, overCost: 0, overdug: 0, clogs: 0 });

// Gesamtzustand des Spiels (Management-Ebene), läuft in Echtzeit. Kein DOM, kein Canvas.
// Gewonnen hat, wer am Ende am meisten Geld hat: das Endergebnis ist `end.finalMoney`.
export class Game {
  constructor(seed = Date.now() & 0xffffff, levelId = 'uetikon') {
    this.seed = seed;
    this.levelId = levelById(levelId).id;
    this.rng = createRng(seed);
    const L = levelById(this.levelId);
    this.lake = Lake.generate(this.rng, { ...CONFIG.lake, ...L.lake });
    this.lake.theme = { id: L.id, palette: L.palette, debrisNames: L.debrisNames, fossilNames: L.fossilNames };
    this.time = 0; // Spielzeit in Sekunden
    this.day = 1;
    this.money = L.startMoney ?? CONFIG.startMoney;
    this.levels = Object.fromEntries(Object.keys(UPGRADES).map((k) => [k, 0]));
    this.stock = { normal: 0, toxic: 0 }; // Rohschlamm im Puffer vor der Anlage (m³)
    this.batch = { vol: 0, toxic: 0, idle: 0 }; // Charge, die gerade in der Anlage zusammenkommt
    this.cutDepth = CONFIG.echolot.defaultCut; // Abtragsdicke-Sollwert der Automatik
    this.pumpSpeed = CONFIG.pumpSpeed.default; // Tempo-Regler der Pumpe (bleibt gespeichert)
    this.overclock = false; // Anlage übertakten: mehr Durchsatz, höheres Risiko teurer Klassen
    this.totals = { removed: 0, pay: 0, claimsPaid: 0, claimsFees: 0, claimsAccepted: 0, claimsPartial: 0, claimsRejected: 0, claimsExpired: 0, docPaid: 0, certPaid: 0, certFees: 0, certsApproved: 0, cranePaid: 0, craneFees: 0, craneJobs: 0, findsPaid: 0, findsFees: 0, findsSold: 0, fossilsLost: 0, fossilFines: 0, jobsDone: 0, jobsFailed: 0, jobsPaid: 0, jobsPenalty: 0, disposalPaid: 0, finesPaid: 0, repairsPaid: 0, overdigPaid: 0, eventCosts: 0, overdug: 0, classes: { B: 0, E: 0, C: 0 } };
    this.today = freshDay();
    this.claims = []; // Nachträge: { id, kind, text, fair, markup, status: 'draft' | 'submitted', expiresAt, resolveAt, claimed }
    this.claimAcc = { hard: 0, toxic: 0 }; // gesammelter Mehraufwand, aus dem Nachträge entstehen
    this.claimSeq = 0;
    this.certs = []; // Abnahmezertifikate: { id, serial, x0, r0, rows, cols, cells, fraction, quality, grade, day, premium, status: 'issued' | 'submitted' | 'approved', approveAt }
    this.certSeq = 0;
    this.craneOffer = null; // Kran-Auftrag: { id, name, segments, payPer, expiresAt } oder null
    this.craneSeq = 0;
    this.droneAutoPref = false; // Drohne startet im Autopilot (nur voll ausgebaute Drohne)
    this.craneNextAt = CONFIG.crane.firstOfferDay * CONFIG.daySeconds;
    this.finds = []; // Fossilienfunde: { id, name, fee, value, status: 'found' | 'recovering', sellAt }
    this.jobs = []; // Zusatzaufträge der Gemeinde: { id, status: 'offer' | 'active', place, zone, bonus, offerExpiresAt, dueAt, progress }
    this.extraSeq = 0;
    this.nextJobAt = CONFIG.jobs.firstAtDay * CONFIG.daySeconds;
    this.jobCheck = 0;
    this.notes = []; // Meldungen für die Oberfläche (Toast): { text, kind }
    this.status = 'playing'; // 'playing' | 'ended'
    this.end = null; // { reason: 'early' | 'deadline' | 'bankrupt', finalMoney, external }
    this.log = [];
    this.endCheck = 0;
  }

  get stats() { return computeStats(this.levels); }
  get stockTotal() { return this.stock.normal + this.stock.toxic; }
  get bufferRoom() { return Math.max(0, this.stats.bufferCapacity - this.stockTotal); }
  get level() { return levelById(this.levelId); }
  get deadlineDays() { return this.level.deadlineDays ?? CONFIG.deadlineDays; }
  get perM3() { return Math.round(CONFIG.pay.perM3 * (this.level.payMult ?? 1)); }
  get totalSeconds() { return this.deadlineDays * CONFIG.daySeconds; }
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

  // Rückbau: die zuletzt gekaufte Stufe wird verkauft, CONFIG.refundShare der damaligen Kosten kommen zurück
  refundFor(id) { return this.levels[id] <= 0 ? null : Math.round((upgradeCost(id, this.levels[id] - 1) * CONFIG.refundShare) / 10) * 10; }

  sellUpgrade(id) {
    const refund = this.refundFor(id);
    if (refund === null || this.status !== 'playing') return false;
    this.levels[id]--;
    this.money += refund;
    this.say(`${UPGRADES[id].name} auf Stufe ${this.levels[id]} zurückgebaut (+${refund} CHF)`, 'upgrade');
    return true;
  }

  createSession() {
    const sim = new DredgeSim(this.lake, this.stats, this.rng);
    sim.cutDepth = this.cutDepth;
    sim.pumpSpeed = this.pumpSpeed;
    sim.bufferRoom = this.bufferRoom;
    sim.turbidityMult = this.level.turbidityMult ?? 1;
    return sim;
  }

  // Verbucht, was der Ponton in einem Schritt getan hat (siehe DredgeSim.update)
  collect(d) {
    if (this.status !== 'playing') return;
    const toxic = d.toxicRemoved, overCost = d.overdug * CONFIG.layer.overdigCostPerM3;
    const layer = Math.max(0, d.removed - d.overdug); // nur belastetes Material wird vergütet
    const pay = ((layer - toxic) + toxic * CONFIG.pay.toxicMultiplier) * CONFIG.pay.perM3 * (this.level.payMult ?? 1);
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
    for (const idx of d.fossilsLost ?? []) {
      const name = (this.lake.theme?.fossilNames ?? FOSSILS)[idx - 1], fine = CONFIG.fossils.destroyFine;
      this.money -= fine; t.fossilsLost++; t.fossilFines += fine;
      const msg = `${name} ${pick(XT.lost, this.rng)} (−${fine} CHF)`;
      this.say(msg, 'bad'); this.notify(msg, 'bad');
    }
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

  // Drohne ausbringen: taucht im Kasten unter dem Ponton (win = Querschnittsfenster des verankerten Pontons)
  get droneMaxed() { return this.levels.drone >= UPGRADES.drone.maxLevel; }

  startDrone(win) {
    const d = new DroneSim(this.lake, this.stats, win);
    if (this.droneMaxed && this.droneAutoPref) d.autopilot = true;
    return d;
  }

  // Drohnenflug abrechnen: Pauschale für den Einsatz, Befliegungsdaten werden an die Behörde verkauft, Funde gemeldet
  // Gesamtbewertung eines Kastens (16 Spalten x box.rows ab Zeile r0): Anteil abgenommener Zellen, Übertiefung, Qualität 0..1
  evaluateBox(x0, r0) {
    const L = this.lake, C = CONFIG.cert; let n = 0, ok = 0, deep = 0, fresh = 0;
    for (let y = r0; y < r0 + CONFIG.box.rows; y++) for (let x = x0; x < x0 + 16; x++) {
      const i = L.idx(x, y);
      if (!L.initial[i]) continue;
      n++; if (L.accepted[i]) ok++;
      if (L.target[i] - L.top[i] > CONFIG.layer.tolerance) deep++;
      if (!L.certified[i]) fresh++;
    }
    const fraction = n ? ok / n : 0, deepShare = n ? deep / n : 0;
    const quality = Math.max(0, Math.min(1, (fraction - C.minFraction) / (1 - C.minFraction))) * (1 - deepShare);
    return { n, ok, fraction, deepShare, quality, fresh, passed: n > 0 && fraction >= C.minFraction && fresh >= C.minNewCells };
  }

  // Zertifikat ausstellen, wenn der Kasten die Mindestquote erreicht und nicht schon zertifiziert ist
  issueCert(x0, r0, box = this.evaluateBox(x0, r0)) {
    if (!box.passed || this.status !== 'playing') return null;
    const C = CONFIG.cert, L = this.lake;
    for (let y = r0; y < r0 + CONFIG.box.rows; y++) for (let x = x0; x < x0 + 16; x++) { const i = L.idx(x, y); if (L.initial[i]) L.certified[i] = 1; }
    const id = ++this.certSeq;
    const cert = {
      id, serial: `ZK-${String(id).padStart(4, '0')}`, x0, r0, rows: CONFIG.box.rows, cols: 16, cells: box.n, fraction: box.fraction, quality: box.quality,
      grade: box.quality >= C.gold ? 'Gold' : box.quality >= C.silver ? 'Silber' : 'Bronze', day: this.day,
      premium: Math.round((box.fresh * C.perCell * (1 + C.maxBonus * box.quality)) / 10) * 10, status: 'issued', approveAt: 0,
    };
    this.certs.push(cert);
    this.say(`Abnahmezertifikat ${cert.serial} (${cert.grade}) ausgestellt: ${Math.round(box.fraction * 100)} % der Zellen sauber.`, 'good');
    return cert;
  }

  // Beim Kanton einreichen: kostet eine Gebühr, nach cert.days Tagen kommt die Freigabe mit Prämie
  submitCert(id) {
    const c = this.certs.find((x) => x.id === id && x.status === 'issued');
    if (!c || this.status !== 'playing' || this.money < CONFIG.cert.fee) return false;
    this.money -= CONFIG.cert.fee; this.totals.certFees += CONFIG.cert.fee;
    c.status = 'submitted'; c.approveAt = this.time + CONFIG.cert.days * CONFIG.daySeconds;
    this.say(`${c.serial} beim Kanton eingereicht (−${CONFIG.cert.fee} CHF). Bearbeitung: ${CONFIG.cert.days} Tage.`, 'info');
    return true;
  }

  // Kran-Aufträge: ab und zu fragt jemand, ob man seine alte Seewasserleitung ausbauen kann
  _craneOffers() {
    const C = CONFIG.crane;
    if (this.craneOffer && this.time >= this.craneOffer.expiresAt) { this.say('Kran-Auftrag verfallen: die Leitung bleibt halt noch ein Weilchen im See.', 'bad'); this.craneOffer = null; }
    if (!this.craneOffer && this.time >= this.craneNextAt) {
      this.craneOffer = { id: ++this.craneSeq, name: 'Seewasserleitung des Wasserwerks ausbauen', segments: C.segments, payPer: C.payPer, expiresAt: this.time + C.expireDays * CONFIG.daySeconds };
      this.craneNextAt = this.time + this.rng.range(C.everyDays[0], C.everyDays[1]) * CONFIG.daySeconds;
      const msg = `Kran-Auftrag: ${this.craneOffer.name} (${C.segments} Stücke, ${C.payPer} CHF je Stück)`;
      this.say(msg, 'info'); this.notify(msg, 'info');
    }
  }

  // Kran einsetzen: kostet eine Pauschale (Kranführer, Kaffee) und liefert das Minispiel
  startCrane() {
    if (!this.craneOffer || this.status !== 'playing' || this.money < CONFIG.crane.fee) return null;
    this.money -= CONFIG.crane.fee; this.totals.craneFees += CONFIG.crane.fee;
    return new CraneSim(this.rng, { segments: this.craneOffer.segments });
  }

  // Abrechnung: intakte Stücke voll, beschädigte anteilig, zerbrochene kosten eine Busse; alle intakt = Bonus. Wurde nichts geliefert, bleibt der Auftrag offen.
  finishCrane(c) {
    const C = CONFIG.crane, r = c.result, intact = r.delivered - r.damaged;
    const pay = Math.round(intact * C.payPer + r.damaged * C.payPer * C.damagedShare + (r.delivered === c.segs.length && r.damaged === 0 && r.broken === 0 ? C.allBonus : 0));
    const fine = r.broken * C.brokenFine;
    this.money += pay - fine; this.totals.cranePaid += pay; this.totals.finesPaid += fine;
    if (r.delivered + r.broken > 0) { this.craneOffer = null; this.totals.craneJobs++; }
    this.say(`Kran: ${r.delivered} Stücke geliefert (${r.damaged} beschädigt), ${r.broken} zerbrochen. ${pay ? `+${pay} CHF` : ''}${fine ? ` Busse −${fine} CHF` : ''}`, r.broken ? 'bad' : 'good');
    return { pay, fine, ...r, total: c.segs.length };
  }

  _certs() {
    for (const c of this.certs) {
      if (c.status !== 'submitted' || this.time < c.approveAt) continue;
      c.status = 'approved'; this.money += c.premium; this.totals.certPaid += c.premium; this.totals.certsApproved++;
      const msg = `Kanton gibt ${c.serial} frei: Prämie +${c.premium} CHF (${c.grade}).`;
      this.say(msg, 'good'); this.notify(msg, 'good');
    }
  }

  finishDrone(sim) {
    const doc = sim.docCells * CONFIG.drone.docPerCell;
    this.money += doc - CONFIG.drone.fee;
    this.totals.docPaid += doc;
    this.say(`Drohne: ${sim.newlyAccepted} Zellen abgenommen, ${sim.newlyFlagged} mit Restschmutz gemeldet. Einsatz −${CONFIG.drone.fee} CHF${doc ? `, Befliegungsdaten +${doc} CHF` : ''}`, sim.newlyFlagged ? 'bad' : 'good');
    for (const idx of sim.found) this.addFind(idx);
    const box = this.evaluateBox(sim.x0, sim.r0);
    const cert = this.issueCert(sim.x0, sim.r0, box);
    return { accepted: sim.newlyAccepted, flagged: sim.newlyFlagged, found: sim.found.length, doc, box, cert };
  }

  // ---------- Fossilienfunde ----------
  addFind(idx) {
    const F = CONFIG.fossils, name = (this.lake.theme?.fossilNames ?? FOSSILS)[idx - 1];
    const fee = Math.round(this.rng.range(F.recoverFee[0], F.recoverFee[1]) / 50) * 50;
    const value = Math.round(this.rng.range(F.value[0], F.value[1]) / 100) * 100;
    const f = { id: ++this.extraSeq, name, fee, value, status: 'found', sellAt: 0 };
    this.finds.push(f);
    const msg = `Drohne meldet einen Fund im Untergrund: ${name}`;
    this.say(msg, 'good'); this.notify(msg, 'good');
    return f;
  }

  // Bergung beauftragen (kostet), danach kauft das Museum den Fund
  recoverFind(id) {
    const f = this.finds.find((x) => x.id === id && x.status === 'found');
    if (!f || this.status !== 'playing') return false;
    f.status = 'recovering'; f.sellAt = this.time + CONFIG.fossils.recoverSeconds;
    this.money -= f.fee; this.totals.findsFees += f.fee;
    this.say(`Bergung beauftragt: ${f.name} (−${f.fee} CHF)`, 'info');
    return true;
  }

  _finds() {
    for (const f of [...this.finds]) {
      if (f.status !== 'recovering' || this.time < f.sellAt) continue;
      this.finds.splice(this.finds.indexOf(f), 1);
      const price = Math.round((f.value * this.rng.range(0.7, 1.3)) / 100) * 100;
      this.money += price; this.totals.findsPaid += price; this.totals.findsSold++;
      const msg = `${f.name} verkauft (+${price} CHF). ${pick(XT.sold, this.rng)}`;
      this.say(msg, 'good'); this.notify(msg, 'good');
    }
  }

  // ---------- Zusatzaufträge der Gemeinde ----------
  _offerJob() {
    const J = CONFIG.jobs;
    const made = makeZone(this.lake, this.rng, this.jobs.map((j) => j.zone));
    if (!made) return;
    const place = pick(PLACES, this.rng);
    const bonus = Math.round((J.bonusBase + made.stats.volume * J.bonusPerM3) / 100) * 100;
    const j = { id: ++this.extraSeq, status: 'offer', place, zone: made.zone, bonus, offerExpiresAt: this.time + J.offerDays * CONFIG.daySeconds, dueAt: 0, progress: made.stats };
    this.jobs.push(j);
    const msg = `Die Gemeinde möchte den Bereich „${place}“ sauber haben (Prämie ${bonus} CHF)`;
    this.say(msg, 'info'); this.notify(msg, 'info');
  }

  acceptJob(id) {
    const j = this.jobs.find((x) => x.id === id && x.status === 'offer');
    if (!j || this.status !== 'playing') return false;
    j.status = 'active'; j.dueAt = this.time + CONFIG.jobs.dueDays * CONFIG.daySeconds;
    this.say(`Auftrag angenommen: „${j.place}“ in ${CONFIG.jobs.dueDays} Tagen sauber und abgenommen = ${j.bonus} CHF`, 'info');
    return true;
  }

  declineJob(id) {
    const j = this.jobs.find((x) => x.id === id && x.status === 'offer');
    if (!j) return false;
    this.jobs.splice(this.jobs.indexOf(j), 1);
    this.say(`„${j.place}“ abgesagt. ${pick(XT.jobDeclined, this.rng)}`, 'info');
    return true;
  }

  _jobs(dt) {
    const J = CONFIG.jobs;
    if (this.time >= this.nextJobAt) {
      this.nextJobAt = this.time + this.rng.range(J.everyDays[0], J.everyDays[1]) * CONFIG.daySeconds;
      if (this.jobs.length < J.maxOpen) this._offerJob();
    }
    this.jobCheck += dt;
    const check = this.jobCheck >= 0.5;
    if (check) this.jobCheck = 0;
    for (const j of [...this.jobs]) {
      if (j.status === 'offer') {
        if (this.time >= j.offerExpiresAt) { this.jobs.splice(this.jobs.indexOf(j), 1); this.say(`„${j.place}“: ${pick(XT.jobLapsed, this.rng)}`, 'bad'); }
        continue;
      }
      if (!check && this.time < j.dueAt) continue;
      j.progress = this.lake.zoneStats(j.zone);
      if (j.progress.cleaned >= J.cleanNeeded && j.progress.accepted >= J.acceptedNeeded) {
        this.jobs.splice(this.jobs.indexOf(j), 1);
        this.money += j.bonus; this.totals.jobsPaid += j.bonus; this.totals.jobsDone++;
        const msg = `Auftrag „${j.place}“ erledigt (+${j.bonus} CHF). ${pick(XT.jobDone, this.rng)}`;
        this.say(msg, 'good'); this.notify(msg, 'good');
      } else if (this.time >= j.dueAt) {
        this.jobs.splice(this.jobs.indexOf(j), 1);
        const pen = Math.round((j.bonus * J.penaltyShare) / 100) * 100;
        this.money -= pen; this.totals.jobsPenalty += pen; this.totals.jobsFailed++;
        const msg = `Auftrag „${j.place}“ verpasst (−${pen} CHF). ${pick(XT.jobFailed, this.rng)}`;
        this.say(msg, 'bad'); this.notify(msg, 'bad');
      }
    }
  }

  // Zeit läuft: Anlage, Tageswechsel, Spielende (Geld kommt nur durch abgesaugte m³)
  update(dt) {
    if (this.status !== 'playing') return;
    this.time += dt;
    this._plant(dt);
    this._claims();
    this._certs();
    this._craneOffers();
    this._finds();
    this._jobs(dt);
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
    if (this.day > this.deadlineDays) return this._finish('deadline');
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
