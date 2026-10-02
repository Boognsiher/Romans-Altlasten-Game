import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/sim/rng.js';
import { Lake } from '../src/sim/lake.js';
import { Game } from '../src/sim/game.js';
import { DredgeSim } from '../src/sim/dredge.js';
import { CONFIG } from '../src/config.js';
import { computeStats } from '../src/sim/stats.js';
import { Chain } from '../src/ui/chain.js';
import { DroneSim } from '../src/sim/drone.js';
import { classProbabilities, processBatch } from '../src/sim/plant.js';

test('rng ist deterministisch', () => {
  assert.equal(createRng(5)(), createRng(5)());
});

test('suck erhält die Masse', () => {
  const lake = Lake.generate(createRng(1));
  const before = lake.remaining();
  const r = lake.suck(20, 12, 3, 50);
  const drop = before - lake.remaining();
  assert.ok(drop > 0 && drop <= r.removed + 1e-6); // belastete Menge sinkt höchstens um das Abgesaugte
});

test('Seegrund lässt sich komplett leersaugen', () => {
  const lake = Lake.generate(createRng(2));
  for (let y = 0; y < lake.rows; y++) for (let x = 0; x < lake.cols; x++) lake.suck(x + 0.5, y + 0.5, 1.5, 1e6);
  assert.ok(lake.cleanFraction() > 0.999);
});

test('Saugen entfernt Material und liefert die Änderung als Delta', () => {
  const g = new Game(3);
  const sim = g.createSession();
  sim.x = 24; sim.y = 15; sim.anchor();
  let sum = 0;
  for (let i = 0; i < 1200; i++) sum += sim.update(0.1, { dx: Math.sin(i * 0.1), dy: 0, suction: true }).removed;
  assert.ok(sim.removed > 0);
  assert.ok(Math.abs(sum - sim.removed) < 1e-6);
});

test('Karte saugt nicht, Querschnitt schon', () => {
  const g = new Game(3);
  const sim = g.createSession();
  sim.update(1, { dx: 0, dy: 0, suction: true });
  assert.equal(sim.removed, 0);
  g.lake.setFlat(5); sim.anchor(); sim.slice.h = 5;
  sim.update(0.5, { dx: 0, dy: 0, suction: true });
  assert.equal(sim.removed, 0); // Stillstand saugt nicht
  sim.update(0.5, { dx: 1, dy: 0, suction: true });
  assert.ok(sim.removed > 0);
});

test('Anker nur in der Karte, Lichten nur im Querschnitt', () => {
  const sim = new Game(3).createSession();
  assert.equal(sim.leave(), false);
  assert.equal(sim.anchor(), true);
  assert.equal(sim.anchor(), false);
  sim.update(1, {});
  assert.equal(sim.leave(), true);
  assert.equal(sim.mode, 'map');
});

test('Querschnitt: Saugkopf dringt nicht in den Grund, Fenster liegt im See', () => {
  const g = new Game(3);
  g.lake.setFlat(4);
  const sim = g.createSession(); sim.x = 0; sim.anchor();
  assert.equal(sim.slice.x0, 0);
  for (let i = 0; i < 100; i++) sim.update(0.1, { dx: 0, dy: 1, suction: false });
  assert.ok(sim.slice.h >= 4 - 1e-9);
  sim.x = g.lake.cols; sim.leave(); sim.anchor();
  assert.equal(sim.slice.x0, g.lake.cols - 16);
});

test('Querschnitt: Saugkopf in der Höhe saugt nichts', () => {
  const lake = Lake.generate(createRng(1));
  lake.setFlat(2);
  assert.equal(lake.suckProfile(5, 10, 12, 1.8, 100).removed, 0);
  const r = lake.suckProfile(5, 10, 2, 1.8, 3);
  assert.ok(Math.abs(r.removed - 3) < 1e-6);
});

const quiet = (g) => { g.rng = Object.assign(() => 0.5, { chance: () => false, range: (a) => a }); return g; }; // keine Ereignisse, Typ E

test('Material geht in den Puffer, die Anlage verarbeitet es laufend und bezahlt jede Charge', () => {
  const g = quiet(new Game(4));
  g.collect({ removed: 60, toxicRemoved: 20, overdug: 0, fines: 0, repairs: 0, tips: 0, clogs: 0 });
  assert.equal(g.stockTotal, 60);
  assert.ok(Math.abs(g.stock.toxic - 20) < 1e-9);
  const money = g.money;
  for (let t = 0; t < 30; t += 0.1) g.update(0.1);
  // 30 s * 0,8 m³/s = 24 m³ verarbeitet, noch keine volle Charge (25 m³)
  assert.ok(Math.abs(g.stockTotal - 36) < 1e-6);
  assert.equal(g.totals.classes.B + g.totals.classes.E + g.totals.classes.C, 0);
  for (let t = 0; t < 10; t += 0.1) g.update(0.1);
  assert.equal(g.totals.classes.E, 1); // Los = 0.5 -> Typ E
  assert.ok(g.totals.disposalPaid > CONFIG.plant.labFeePerBatch);
  assert.ok(g.money < money + 40 * CONFIG.incomePerSec); // Entsorgung und Analyse sind abgebucht
});

test('Puffer voll: Pumpe pausiert', () => {
  const g = new Game(4);
  g.lake.setFlat(5);
  const sim = new DredgeSim(g.lake, computeStats());
  sim.anchor(); sim.slice.h = 5;
  const room = 3; let used = 0;
  for (let i = 0; i < 100; i++) {
    sim.bufferRoom = Math.max(0, room - used);
    used += sim.update(0.1, { dx: (i % 40) < 20 ? 1 : -1, dy: 0, suction: true }).removed;
  }
  assert.ok(sim.bufferFull);
  assert.ok(used < room + computeStats().power * 0.1 + 1e-6);
});

test('Klassenwahrscheinlichkeiten: Summe 1, Altlasten und Übertakten erhöhen C', () => {
  const a = classProbabilities(0, false), b = classProbabilities(0.5, false), c = classProbabilities(0, true);
  for (const p of [a, b, c]) assert.ok(Math.abs(p.B + p.E + p.C - 1) < 1e-9);
  assert.ok(b.C > a.C && c.C > a.C);
});

test('Charge: Klasse per Los, Kosten = entwässertes Volumen * Preis, Analysegebühr extra', () => {
  const stats = computeStats();
  const b = processBatch(25, 0, stats, false, () => 0.99); // Los ganz oben -> Typ C
  assert.equal(b.cls, 'C');
  assert.equal(b.disposalVol, 25 * stats.dewater);
  assert.equal(b.cost, Math.round(25 * stats.dewater * CONFIG.plant.classes.C.price / 10) * 10);
  assert.equal(b.lab, CONFIG.plant.labFeePerBatch);
  assert.equal(processBatch(25, 0, stats, false, () => 0).cls, 'B');
});

test('Einkommen pro Sekunde, Spielzeit und Tageswechsel', () => {
  const g = quiet(new Game(5));
  g.money = 0;
  for (let i = 0; i < 100; i++) g.update(0.1); // 10 s
  assert.ok(Math.abs(g.money - 10 * CONFIG.incomePerSec) < 1e-6);
  assert.ok(Math.abs(g.time - 10) < 1e-9);
  assert.equal(g.day, 1);
  for (let i = 0; i < Math.round((CONFIG.daySeconds - 10) * 10) + 3; i++) g.update(0.1);
  assert.equal(g.day, 2);
});

test('Upgrade kaufen: Geld sinkt, Stufe steigt, Werte wachsen', () => {
  const g = new Game(6);
  const before = g.stats.power, cost = g.nextUpgradeCost('power');
  assert.ok(g.buyUpgrade('power'));
  assert.equal(g.money, CONFIG.startMoney - cost);
  assert.ok(g.stats.power > before);
});

test('Bankrott beendet das Spiel', () => {
  const g = quiet(new Game(7));
  g.money = CONFIG.bankruptcyLimit - 10000;
  for (let t = 0; t < 1; t += 0.1) g.update(0.1);
  assert.equal(g.status, 'ended');
  assert.equal(g.end.reason, 'bankrupt');
});

test('Frist: nach 150 Tagen ist Schluss, eine Fremdfirma saniert den Rest, Endstand = Geld', () => {
  const g = quiet(new Game(8));
  g.money = 1e7; // reicht sicher
  const remaining = g.lake.remaining();
  g.time = g.totalSeconds - 0.2; g.day = CONFIG.deadlineDays;
  for (let t = 0; t < 1; t += 0.1) g.update(0.1);
  assert.equal(g.status, 'ended');
  assert.equal(g.end.reason, 'deadline');
  assert.equal(g.end.external, Math.round(remaining * CONFIG.deadline.externalCostPerM3));
  assert.equal(g.end.finalMoney, Math.round(g.money));
  assert.ok(g.end.finalMoney < 1e7 + 2 * CONFIG.incomePerSec * 2);
  const frozen = g.money; g.update(5); assert.equal(g.money, frozen); // danach läuft nichts mehr
});

test('Frist: reicht das Geld nicht, ist der Endstand negativ', () => {
  const g = quiet(new Game(9));
  g.money = 0;
  g.time = g.totalSeconds - 0.1; g.day = CONFIG.deadlineDays;
  for (let t = 0; t < 1; t += 0.1) g.update(0.1);
  assert.equal(g.end.reason, 'deadline');
  assert.ok(g.end.finalMoney < 0);
});

test('Früh fertig: Restmaterial wird entsorgt, Restfinanzierung gutgeschrieben', () => {
  const g = quiet(new Game(10));
  g.lake.mass.fill(0); g.lake.accepted.fill(1);
  g.collect({ removed: 30, toxicRemoved: 0, overdug: 0, fines: 0, repairs: 0, tips: 0, clogs: 0 });
  g.update(0.6);
  assert.equal(g.status, 'ended');
  assert.equal(g.end.reason, 'early');
  assert.equal(g.end.bonus, Math.round((g.totalSeconds - 0.6) * CONFIG.incomePerSec));
  assert.ok(g.stockTotal === 0 && g.batch.vol === 0); // alles entsorgt
  assert.equal(g.totals.classes.B + g.totals.classes.E + g.totals.classes.C, 2); // 30 m³ = Charge à 25 + Rest 5
});

test('Querschnitt: Saugen nur in Arbeitsrichtung, nur eine Achse, Rückweg ist schneller', () => {
  const g = new Game(3);
  g.lake.setFlat(5);
  const sim = g.createSession(); sim.anchor();
  const sl = sim.slice; sl.h = 5;
  sl.x = sl.x0 + 8; sl.h = 5;
  const x1 = sl.x, rBack = sl.update(0.2, { dx: -1, dy: 0, suction: true });
  assert.equal(rBack.removed, 0); // rückwärts: kein Saugen
  const backDist = x1 - sl.x;
  const x2 = sl.x, rFwd = sl.update(0.2, { dx: 1, dy: 0, suction: true });
  assert.ok(rFwd.removed > 0);
  assert.ok(backDist > sl.x - x2); // Rückweg schneller als Arbeitsfahrt
  // Diagonale Eingabe: nur die stärkere Achse zählt
  sl.h = 8; const hs = sl.h;
  sl.update(0.1, { dx: 1, dy: 0.2, suction: false });
  assert.equal(sl.h, hs); // schwebt: ohne Eingabe auf der Höhenachse bleibt die Pumpe, wo sie ist
});

const flat = (g, m = 5) => g.lake.setFlat(m); // ebener See, belastete Schicht m dick, Sollsohle bei 0
const sweep = (sim, seconds, dir = 1) => { for (let t = 0; t < seconds; t += 0.1) sim.update(0.1, { dx: dir, dy: 0, suction: true }); };

test('Harte Schicht: gleiche Leistung entfernt weniger, mehrere Überfahrten nötig', () => {
  const a = Lake.generate(createRng(1)), b = Lake.generate(createRng(1));
  for (const l of [a, b]) l.setFlat(5);
  b.hard.fill(2);
  const soft = a.suckProfile(5, 10, 5, 1.8, 2).removed, hard = b.suckProfile(5, 10, 5, 1.8, 2).removed;
  assert.ok(hard < soft * 0.5);
});

test('Fremdstoff verstopft die Pumpe; Anheben des Kopfes vermeidet es', () => {
  const g = new Game(8); const lake = flat(g);
  const sim = g.createSession(); sim.y = 5; sim.anchor();
  const sl = sim.slice, col = sl.x0 + 3;
  lake.debris[lake.idx(col, sl.row)] = 1;
  sl.x = sl.x0 + 2; sl.h = 9; // hoch über dem Fremdstoff
  for (let i = 0; i < 20; i++) { sl.h = 9; sim.update(0.1, { dx: 1, dy: 0, suction: true }); }
  assert.equal(sim.clogs, 0);
  sl.x = sl.x0 + 2; sl.h = 5;
  sweep(sim, 1);
  assert.equal(sim.clogs, 1);
  assert.ok(sl.clog > 0);
  assert.equal(lake.debris[lake.idx(col, sl.row)], 0);
});

test('Automatik: Stufe 0 gibt es nicht, Stufe 2 fährt hin und her und saugt selbst', () => {
  const g = new Game(9); flat(g);
  g.levels.auto = 0;
  let sim = g.createSession(); sim.anchor();
  assert.equal(sim.toggleAuto(), false);
  g.levels.auto = 2;
  sim = g.createSession(); sim.anchor();
  assert.equal(sim.toggleAuto(), true);
  const x0 = sim.slice.x0;
  for (let i = 0; i < 600; i++) sim.update(0.1, { dx: 0, dy: 0, suction: false });
  assert.ok(sim.removed > 0);
  assert.ok(sim.slice.x >= x0);
});

test('Automatik Stufe 1 macht Fehler, Reset behebt sie, manuelles Steuern übernimmt', () => {
  const g = new Game(10); flat(g); g.levels.auto = 1;
  const sim = g.createSession();
  sim.rng = () => 0; sim.anchor(); sim.slice.rng = () => 0; // erzwingt Fehler
  sim.toggleAuto();
  sim.update(0.1, {});
  assert.ok(sim.slice.auto.error);
  assert.equal(sim.fixAuto(), true);
  assert.equal(sim.slice.auto.error, null);
  sim.update(0.1, { dx: 1, dy: 0 });
  assert.equal(sim.slice.auto.on, false);
});

test('Automatik darf bei vollem Puffer nicht saugen', () => {
  const g = new Game(11); flat(g); g.levels.auto = 3;
  const sim = new DredgeSim(g.lake, g.stats); sim.bufferRoom = 0;
  sim.anchor(); sim.toggleAuto();
  for (let i = 0; i < 50; i++) sim.update(0.1, {});
  assert.equal(sim.removed, 0);
});

test('Drohne: saubere Zellen werden abgenommen, Restschmutz gemeldet', () => {
  const g = new Game(12); const lake = g.lake;
  lake.mass.fill(0); lake.initial.fill(1); lake.accepted.fill(0);
  lake.mass[lake.idx(2, 1)] = 1; // Restschmutz
  const d = new DroneSim(lake, g.stats);
  d.x = 2; d.y = 1;
  d.update(0.1, {});
  assert.ok(d.newlyAccepted > 0);
  assert.equal(d.newlyFlagged, 1);
  assert.equal(lake.flagged[lake.idx(2, 1)], 1);
  assert.ok(lake.acceptedFraction() > 0 && lake.acceptedFraction() < 1);
});

test('Sieg braucht Sauberkeit UND Abnahme', () => {
  const g = quiet(new Game(13));
  g.lake.mass.fill(0);
  g.checkEnd();
  assert.equal(g.status, 'playing'); // sauber, aber nicht abgenommen
  g.lake.accepted.fill(1);
  g.checkEnd();
  assert.equal(g.status, 'ended');
  assert.equal(g.end.reason, 'early');
});

test('Trübungsschutz senkt die Trübung', () => {
  const run = (lvl) => {
    const g = new Game(14); flat(g); g.levels.curtain = lvl;
    const sim = g.createSession(); sim.anchor(); sim.slice.h = 5; sweep(sim, 2);
    return sim.turbidity;
  };
  assert.ok(run(4) < run(0));
});

test('Einsaugstelle liegt unten rechts der Pumpe; links der Pumpe wird nichts gesaugt', () => {
  const g = new Game(15); const lake = flat(g, 0);
  const sim = g.createSession(); sim.anchor();
  const sl = sim.slice, P = CONFIG.pump;
  sl.x = sl.x0 + 10; sl.h = 4;
  const m = sl.mouth();
  assert.equal(m.x, sl.x + P.offsetX);
  assert.equal(m.h, sl.h - P.offsetY);
  lake.top.fill(0); lake.target.fill(0); lake.mass.fill(0); // alles leer ...
  const put = (c, m) => { const i = lake.idx(sl.x0 + c, sl.row); lake.top[i] = m; lake.target[i] = 0; lake.mass[i] = m; };
  for (let c = 0; c < 8; c++) put(c, 5); // ... nur links der Pumpe
  sim.update(0.2, { dx: 1, dy: 0, suction: true });
  assert.equal(sim.removed, 0);
  put(11, 5); // rechts der Pumpe
  sl.h = 5;
  sim.update(0.2, { dx: 1, dy: 0, suction: true });
  assert.ok(sim.removed > 0);
});

test('Zu tiefes Abtragen: Schieflage steigt, Pumpe kippt um und kostet Bergung', () => {
  const g = new Game(16); flat(g, 8);
  const sim = g.createSession(); sim.anchor();
  sim.stats.power = 30; // brutale Pumpe
  sim.slice.h = 8;
  let max = 0;
  for (let t = 0; t < 4 && sim.tips === 0; t += 0.05) { sim.update(0.05, { dx: 1, dy: 0, suction: true }); max = Math.max(max, sim.slice.tilt); }
  assert.ok(max > 0.3);
  assert.equal(sim.tips, 1);
  const before = sim.removed;
  const d = sim.update(0.5, { dx: 1, dy: 0, suction: true });
  assert.equal(sim.removed, before); // liegt auf der Seite
  assert.equal(d.removed, 0);
  // Bergungskosten kommen im Delta des Kippens und werden verbucht
  const g2 = quiet(new Game(16));
  const money = g2.money;
  g2.collect({ removed: 0, toxicRemoved: 0, overdug: 0, fines: 0, repairs: CONFIG.pump.repairCost, tips: 1, clogs: 0 });
  assert.equal(g2.money, money - CONFIG.pump.repairCost);
  assert.equal(g2.totals.repairsPaid, CONFIG.pump.repairCost);
});

test('Sanftes Abtragen mit der Standardpumpe kippt nicht', () => {
  const g = new Game(17); flat(g, 5);
  const sim = g.createSession(); sim.anchor(); sim.slice.h = 5;
  for (let p = 0; p < 4; p++) { sweep(sim, 6, 1); sweep(sim, 6, -1); }
  assert.equal(sim.tips, 0);
});

test('Automatik ab Stufe 2 zieht die Pumpe bei Schieflage hoch', () => {
  const g = new Game(18); flat(g, 8); g.levels.auto = 2;
  const sim = g.createSession(); sim.anchor(); sim.stats.power = 12;
  sim.toggleAuto();
  for (let i = 0; i < 400; i++) sim.update(0.05, {});
  assert.equal(sim.tips, 0);
});

test('Seegrund: belastete Schicht ist überall genau eine Schichtdicke dick, Oberfläche ist uneben', () => {
  const l = Lake.generate(createRng(5)), T = CONFIG.layer.thickness;
  let n = 0, min = 99, max = 0;
  for (let i = 0; i < l.mass.length; i++) {
    min = Math.min(min, l.top[i]); max = Math.max(max, l.top[i]);
    if (l.initial[i]) { n++; assert.ok(Math.abs(l.mass[i] - T) < 1e-6); assert.ok(Math.abs(l.top[i] - l.target[i] - T) < 1e-5); }
    else assert.equal(l.mass[i], 0);
  }
  assert.ok(n > 100);
  assert.ok(max - min > 1.5); // nicht flach
});

test('Übertiefung: unter der Sollsohle geht es langsamer, wird gezählt und kostet', () => {
  const l = new Lake(4, 4); l.setFlat(1, 3); // Schicht 1 m, Oberfläche 3, Sollsohle 2
  const first = l.suckProfile(1, 1.5, 2.6, 1.8, 2); // trägt die Schicht ab
  assert.ok(first.overdug < 1e-6 && l.remaining() < 4 * 4 * 4 * 1 + 1e-6);
  const i = l.idx(1, 1);
  for (let n = 0; l.mass[i] > 0 && n < 500; n++) l.suckProfile(1, 1.5, l.top[i], 1.8, 1); // Schicht abtragen ...
  assert.equal(l.mass[i], 0);
  const before = l.top[i];
  assert.equal(l.suckProfile(1, 1.5, l.top[i], 1.8, 0.2).overdug, 0); // erste Zentimeter: Toleranz
  let over = 0;
  for (let n = 0; n < 6; n++) over += l.suckProfile(1, 1.5, l.top[i], 1.8, 2).overdug; // ... dann tiefer in den Untergrund
  assert.ok(over > 0 && l.top[i] < before);
  assert.ok(l.overdug(i));
  // Untergrund ist fester: gleiche Leistung trägt weniger ab
  const soft = new Lake(4, 4); soft.setFlat(5, 5);
  const a = soft.suckProfile(1, 1.5, 5, 1.8, 4).removed;
  const hard = new Lake(4, 4); hard.setFlat(1, 3); hard.mass.fill(0); hard.target.fill(3);
  const b = hard.suckProfile(1, 1.5, 3, 1.8, 4).removed;
  assert.ok(b < a * 0.5);
});

test('Übertiefung: kostet extra und geht trotzdem in den Puffer', () => {
  const g = quiet(new Game(19));
  const money = g.money;
  g.collect({ removed: 20, toxicRemoved: 0, overdug: 10, fines: 0, repairs: 0, tips: 0, clogs: 0 });
  assert.equal(g.stockTotal, 20); // zu viel abgetragener Boden muss auch entsorgt werden
  assert.equal(g.money, money - 10 * CONFIG.layer.overdigCostPerM3);
  assert.equal(g.totals.overdug, 10);
  assert.equal(g.totals.overdigPaid, 10 * CONFIG.layer.overdigCostPerM3);
});

test('Trübungs-Bussen laufen pro Sekunde über der Schwelle und werden verbucht', () => {
  const g = quiet(new Game(25)); flat(g, 5);
  const sim = g.createSession(); sim.anchor(); sim.slice.h = 5; sim.turbidity = 1;
  const d = sim.update(0.5, { dx: 0, dy: 0, suction: false });
  assert.ok(Math.abs(d.fines - 0.5 * CONFIG.turbidityFinePerSecond) < 1e-9);
  const money = g.money; g.collect(d);
  assert.equal(g.money, money - d.fines);
});

test('Saubere Zellen ausserhalb der bestellten Fläche werden nicht angesaugt, kein Fehlalarm am Start', () => {
  const l = new Lake(6, 3); l.setFlat(1, 3);
  for (let y = 0; y < 3; y++) for (let x = 3; x < 6; x++) { const i = l.idx(x, y); l.initial[i] = 0; l.mass[i] = 0; l.target[i] = l.top[i]; }
  const before = l.top[l.idx(4, 1)];
  const r = l.suckProfile(1, 3.5, 2.6, 1.8, 3);
  assert.equal(l.top[l.idx(4, 1)], before);
  assert.equal(r.overdug, 0);
  // Standardpumpe, erste Sekunden über frischem Seegrund: keine Übertiefung
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = new Game(seed); const sim = g.createSession();
    let by = 0, best = 0;
    for (let y = 0; y < g.lake.rows; y++) { let t = 0; for (let x = 0; x < g.lake.cols; x++) t += g.lake.mass[g.lake.idx(x, y)]; if (t > best) { best = t; by = y; } }
    sim.x = 24; sim.y = by + 0.5; sim.anchor();
    for (let t = 0; t < 6; t += 0.05) sim.update(0.05, { dx: 1, dy: 0, suction: true });
    assert.equal(sim.overdug, 0, `seed ${seed}`);
  }
});

test('Kette: Enden fest, Glieder nicht gedehnt, pendelt beim Fahren nach und kommt zur Ruhe', () => {
  const c = new Chain(14);
  for (let i = 0; i < 120; i++) c.update(1 / 60, 300, 64, 300, 260);
  const mid = () => c.p[7].x;
  assert.ok(Math.abs(c.p[0].x - 300) < 1e-9 && Math.abs(c.p[13].y - 260) < 1e-9);
  const stretch = (ch) => Math.max(...ch.p.slice(1).map((b, i) => Math.hypot(b.x - ch.p[i].x, b.y - ch.p[i].y))) / ch.seg;
  assert.ok(stretch(c) < 1.1);
  // Ketten-Enden fahren 100 px nach rechts: die Mitte hinkt hinterher
  let lag = 0;
  for (let i = 0; i < 18; i++) { c.update(1 / 60, 300 + (i + 1) * 100 / 18, 64, 300 + (i + 1) * 100 / 18, 260); lag = Math.max(lag, (300 + (i + 1) * 100 / 18) - mid()); }
  assert.ok(lag > 3, `lag ${lag}`);
  for (let i = 0; i < 400; i++) c.update(1 / 60, 400, 64, 400, 260);
  assert.ok(Math.abs(mid() - 400) < 40);
  assert.ok(stretch(c) < 1.1);
  // Pumpe wird hochgezogen: Kette bleibt endlich und gültig
  for (let i = 0; i < 60; i++) c.update(1 / 60, 400, 64, 400, 260 - i * 2);
  assert.ok(c.p.every((pt) => Number.isFinite(pt.x) && Number.isFinite(pt.y)));
});

test('Pumpe schwebt: Höhe ändert sich nur durch die Kette, nie in den Grund', () => {
  const g = new Game(20); flat(g, 3);
  const sim = g.createSession(); sim.anchor(); const sl = sim.slice;
  assert.ok(sl.h > 3); // startet über dem Grund
  const h0 = sl.h;
  for (let i = 0; i < 60; i++) sim.update(0.1, { dx: i % 20 < 10 ? 1 : -1, dy: 0, suction: false });
  assert.equal(sl.h, h0);
  sim.update(0.1, { dx: 0, dy: -1, suction: false });
  assert.ok(sl.h > h0); // hochziehen
  for (let i = 0; i < 100; i++) sim.update(0.1, { dx: 0, dy: 1, suction: false });
  assert.equal(sl.h, 3); // runterlassen bis auf den Grund, nicht tiefer
});

test('Automatik hält die Pumpe selbst an der Oberfläche', () => {
  const g = new Game(21); flat(g, 3); g.levels.auto = 2;
  const sim = g.createSession(); sim.anchor(); sim.toggleAuto();
  for (let i = 0; i < 30; i++) sim.update(0.1, {});
  assert.ok(sim.slice.h - 3 < 0.2);
  assert.ok(sim.removed > 0);
});

test('Echolot: misst beim Ankern (mit Messfehler je Stufe), ohne Echolot kein Lot', () => {
  const g = new Game(22); flat(g, 3);
  let sim = g.createSession(); sim.anchor();
  assert.equal(sim.slice.sounding, null);
  g.levels.echolot = 1;
  sim = g.createSession(); sim.anchor();
  const amp = CONFIG.echolot.noise[1];
  assert.ok(sim.slice.sounding.every((v) => Math.abs(v - 3) <= amp + 1e-6));
  g.levels.echolot = 2;
  sim = g.createSession(); sim.anchor();
  assert.ok(sim.slice.sounding.every((v) => Math.abs(v - 3) <= CONFIG.echolot.noise[2] + 1e-6));
});

test('Echolot + Automatik: fährt die gewünschte Abtragsdicke an und stoppt, ohne Übertiefung', () => {
  for (const cut of [0.5, 1.0]) {
    const g = new Game(23); flat(g, 1); g.levels.auto = 3; g.levels.echolot = 2; g.cutDepth = cut;
    const sim = g.createSession(); sim.anchor(); sim.toggleAuto();
    const base = Array.from(sim.slice.sounding);
    let t = 0;
    while (sim.slice.auto.on && t < 600) { sim.update(0.05, {}); t += 0.05; }
    assert.equal(sim.slice.auto.on, false, `cut ${cut}: Automatik muss von selbst fertig werden`);
    const l = g.lake, sl = sim.slice;
    for (let c = 0; c < 16; c++) {
      const top = l.top[l.idx(sl.x0 + c, sl.row)];
      assert.ok(Math.abs(top - (1 - cut)) < 0.2, `cut ${cut} Spalte ${c}: ${top}`);
    }
    assert.equal(sim.overdug, 0);
    assert.ok(base.length === 16);
  }
});

test('Abtragsdicke: Sollwert wird begrenzt und gilt für den laufenden Querschnitt', () => {
  const g = new Game(24); flat(g, 1); g.levels.echolot = 1;
  const sim = g.createSession(); sim.anchor();
  sim.setCutDepth(0.5);
  assert.equal(sim.slice.cutDepth, 0.5);
  assert.ok(Math.abs(sim.slice.targetAt(3) - (sim.slice.sounding[3] - 0.5)) < 1e-9);
  sim.setCutDepth(99); assert.equal(sim.cutDepth, CONFIG.echolot.maxCut);
  sim.setCutDepth(-1); assert.equal(sim.cutDepth, CONFIG.echolot.minCut);
});
