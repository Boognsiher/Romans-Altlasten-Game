import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/sim/rng.js';
import { Lake } from '../src/sim/lake.js';
import { Game } from '../src/sim/game.js';
import { DredgeSim } from '../src/sim/dredge.js';
import { CONFIG } from '../src/config.js';
import { computeStats } from '../src/sim/stats.js';
import { Chain } from '../src/ui/chain.js';
import { acceptChance, decide, claimedAmount, clampMarkup } from '../src/sim/claims.js';
import { fitSize, renderQuality } from '../src/ui/layout.js';
import { hintsFor, HINTS } from '../src/ui/hints.js';
import { snapStick, steerToward, isTap } from '../src/ui/touch-logic.js';
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

test('Karte saugt nicht, Querschnitt schon (auch im Stillstand)', () => {
  const g = new Game(3);
  const sim = g.createSession();
  sim.update(1, { dx: 0, dy: 0, suction: true });
  assert.equal(sim.removed, 0);
  g.lake.setFlat(5); sim.anchor(); sim.slice.h = 5;
  sim.update(0.5, { dx: 0, dy: 0, suction: true });
  assert.ok(sim.removed > 0); // Pumpe an: saugt auch im Stillstand
  const r1 = sim.removed;
  sim.update(0.5, { dx: -1, dy: 0, suction: true });
  assert.equal(sim.removed, r1); // rückwärts nie
  sim.update(0.5, { dx: 1, dy: 0, suction: true });
  assert.ok(sim.removed > r1);
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

const quiet = (g) => { g.rng = Object.assign(() => 0.5, { chance: () => false, range: (a) => a, int: (a) => a }); return g; }; // keine Ereignisse, Typ E

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
  assert.ok(g.money < money); // Entsorgung und Analyse sind abgebucht, die Zeit allein bringt kein Geld
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

test('Geld gibt es pro abgesaugtem m³: Altlasten mit Zuschlag, Übertiefung unbezahlt, Zeit allein bringt nichts', () => {
  const g = quiet(new Game(5));
  const m0 = g.money, P = CONFIG.pay;
  g.collect({ removed: 10, toxicRemoved: 0, overdug: 0, fines: 0, repairs: 0, tips: 0, clogs: 0 });
  assert.equal(g.money, m0 + 10 * P.perM3);
  g.collect({ removed: 10, toxicRemoved: 10, overdug: 0, fines: 0, repairs: 0, tips: 0, clogs: 0 });
  assert.equal(g.money, m0 + 10 * P.perM3 + 10 * P.perM3 * P.toxicMultiplier);
  const m1 = g.money;
  g.collect({ removed: 10, toxicRemoved: 0, overdug: 10, fines: 0, repairs: 0, tips: 0, clogs: 0 }); // alles zu tief
  assert.equal(g.money, m1 - 10 * CONFIG.layer.overdigCostPerM3); // nichts vergütet, Übertiefung kostet
  const m2 = g.money; g.stock = { normal: 0, toxic: 0 };
  for (let i = 0; i < 100; i++) g.update(0.1);
  assert.equal(g.money, m2); // 10 s ohne Abtrag: kein Einkommen
  assert.equal(g.totals.pay, 10 * P.perM3 + 10 * P.perM3 * P.toxicMultiplier);
});

test('Spielzeit und Tageswechsel', () => {
  const g = quiet(new Game(5));
  for (let i = 0; i < 100; i++) g.update(0.1); // 10 s
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
  assert.ok(g.end.finalMoney < 1e7);
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

test('Früh fertig: Restmaterial wird noch entsorgt, dann ist Schluss', () => {
  const g = quiet(new Game(10));
  g.lake.mass.fill(0); g.lake.accepted.fill(1);
  g.collect({ removed: 30, toxicRemoved: 0, overdug: 0, fines: 0, repairs: 0, tips: 0, clogs: 0 });
  g.update(0.6);
  assert.equal(g.status, 'ended');
  assert.equal(g.end.reason, 'early');
  assert.equal(g.end.finalMoney, Math.round(g.money));
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
  // 10 m³ belastet werden vergütet, 10 m³ Übertiefung kosten extra
  assert.equal(g.money, money + 10 * CONFIG.pay.perM3 - 10 * CONFIG.layer.overdigCostPerM3);
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
  assert.ok(sim.slice.sounding.length === CONFIG.box.rows && sim.slice.sounding[sim.slice.ci].every((v) => Math.abs(v - 3) <= amp + 1e-6));
  g.levels.echolot = 2;
  sim = g.createSession(); sim.anchor();
  assert.ok(sim.slice.sounding.every((row) => row.every((v) => Math.abs(v - 3) <= CONFIG.echolot.noise[2] + 1e-6)));
});

test('Echolot + Automatik: fährt die gewünschte Abtragsdicke an und stoppt, ohne Übertiefung', () => {
  for (const cut of [0.5, 1.0]) {
    const g = new Game(23); flat(g, 1); g.levels.auto = 3; g.levels.echolot = 2; g.cutDepth = cut;
    const sim = g.createSession(); sim.anchor(); sim.toggleAuto();
    const base = Array.from(sim.slice.sounding[sim.slice.ci]);
    let t = 0;
    while (sim.slice.auto.on && t < 600) { sim.update(0.05, {}); t += 0.05; }
    assert.equal(sim.slice.auto.on, false, `cut ${cut}: Automatik muss von selbst fertig werden`);
    const l = g.lake, sl = sim.slice;
    for (let c = 0; c < 16; c++) {
      const top = l.top[l.idx(sl.x0 + c, sl.row)];
      assert.ok(Math.abs(top - (1 - cut)) < 0.35, `cut ${cut} Spalte ${c}: ${top}`);
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
  assert.ok(Math.abs(sim.slice.targetAt(3) - (sim.slice.sounding[sim.slice.ci][3] - 0.5)) < 1e-9);
  sim.setCutDepth(99); assert.equal(sim.cutDepth, CONFIG.echolot.maxCut);
  sim.setCutDepth(-1); assert.equal(sim.cutDepth, CONFIG.echolot.minCut);
});

test('Touch-Stick: Totzone, Einrasten auf eine Achse, kein Flackern bei Diagonalen', () => {
  assert.deepEqual(snapStick(5, 5), { dx: 0, dy: 0 });
  assert.deepEqual(snapStick(30, 4), { dx: 1, dy: 0 });
  assert.deepEqual(snapStick(-30, 4), { dx: -1, dy: 0 });
  assert.deepEqual(snapStick(4, 30), { dx: 0, dy: 1 });
  assert.deepEqual(snapStick(4, -30), { dx: 0, dy: -1 });
  // Diagonale: bleibt auf der bisherigen Achse, solange die andere nicht klar stärker ist
  assert.deepEqual(snapStick(30, 36, 14, { dx: 1, dy: 0 }), { dx: 1, dy: 0 });
  assert.deepEqual(snapStick(30, 36, 14, { dx: 0, dy: 1 }), { dx: 0, dy: 1 });
  assert.deepEqual(snapStick(20, 40, 14, { dx: 1, dy: 0 }), { dx: 0, dy: 1 }); // klar vertikal: wechselt
  // immer genau eine Achse
  for (let a = 0; a < 360; a += 7) {
    const r = snapStick(Math.cos(a / 57.3) * 40, Math.sin(a / 57.3) * 40);
    assert.ok(Math.abs(r.dx) + Math.abs(r.dy) === 1);
  }
});

test('Tippen auf die Karte: Fahrtrichtung zum Ziel, Ankunft', () => {
  const s = steerToward({ x: 2, y: 2 }, { x: 5, y: 6 });
  assert.equal(s.arrived, false);
  assert.ok(Math.abs(Math.hypot(s.dx, s.dy) - 1) < 1e-9);
  assert.ok(s.dx > 0 && s.dy > 0);
  assert.equal(steerToward({ x: 5, y: 6 }, { x: 5.1, y: 6.1 }).arrived, true);
});

test('Tippen oder Ziehen', () => {
  assert.equal(isTap(3, 120), true);
  assert.equal(isTap(40, 120), false); // gezogen
  assert.equal(isTap(3, 900), false); // gehalten
});

test('Tippen auf die Karte führt bis zur Ankerposition und ankert (Simulation mit steerToward)', () => {
  const g = new Game(30); const sim = g.createSession();
  const target = { x: 20, y: 12 };
  let arrived = false;
  for (let i = 0; i < 2000 && !arrived; i++) {
    const st = steerToward(sim, target);
    if (st.arrived) { arrived = sim.anchor(); break; }
    sim.update(0.05, { dx: st.dx, dy: st.dy });
  }
  assert.equal(arrived, true);
  assert.equal(sim.mode, 'slice');
  assert.ok(Math.hypot(sim.x - target.x, sim.y - target.y) <= 0.3 + 1e-6);
});

test('Nachtrag-Chance: sinkt mit dem Aufschlag, steigt mit Dokumentation, bleibt begrenzt', () => {
  assert.ok(acceptChance(1.0) > acceptChance(1.5) && acceptChance(1.5) > acceptChance(2.0));
  assert.ok(acceptChance(1.5, 0.2) > acceptChance(1.5, 0));
  assert.ok(acceptChance(1.0, 5) <= 0.98 && acceptChance(2.0, -5) >= 0.05);
  assert.equal(clampMarkup(0.5), CONFIG.claims.minMarkup);
  assert.equal(clampMarkup(9), CONFIG.claims.maxMarkup);
  assert.equal(claimedAmount(1000, 1.5), 1500);
});

test('Nachtrag-Entscheid: voll, hälftig, abgelehnt je nach Los', () => {
  const p = acceptChance(1.5, 0);
  assert.equal(decide(1.5, 0, p - 0.01), 'accepted');
  assert.equal(decide(1.5, 0, p + CONFIG.claims.partialBand / 2), 'partial');
  assert.equal(decide(1.5, 0, 0.999), 'rejected');
});

const ev = (extra) => ({ removed: 0, toxicRemoved: 0, overdug: 0, hardRemoved: 0, fines: 0, repairs: 0, tips: 0, clogs: 0, clogItems: [], ...extra });

test('Vorkommnisse erzeugen Nachtrag-Entwürfe: Fremdstoff, harte Schicht, Fassfund', () => {
  const g = quiet(new Game(31));
  g.collect(ev({ clogs: 1, clogItems: ['Bürostuhl'] }));
  assert.equal(g.claims.length, 1);
  assert.equal(g.claims[0].kind, 'debris');
  assert.ok(g.claims[0].text.includes('Bürostuhl'));
  g.collect(ev({ hardRemoved: CONFIG.claims.hardThreshold - 1 }));
  assert.equal(g.claims.length, 1); // noch nicht genug Mehraufwand
  g.collect(ev({ hardRemoved: 1 }));
  assert.equal(g.claims.length, 2);
  assert.equal(g.claims[1].fair, CONFIG.claims.hardThreshold * CONFIG.claims.hardPerM3);
  g.collect(ev({ removed: CONFIG.claims.toxicThreshold, toxicRemoved: CONFIG.claims.toxicThreshold }));
  assert.equal(g.claims.length, 3);
  assert.equal(g.claims[2].kind, 'toxic');
  assert.equal(g.openClaims, 3);
});

test('Nachtrag einreichen: Gebühr, Prüfzeit, dann Auszahlung je nach Entscheid', () => {
  const run = (roll) => {
    const g = quiet(new Game(32)); g.rng = Object.assign(() => roll, { chance: () => false, range: (a) => a });
    const c = g.addClaim('debris', 'Sonderentsorgung: Test', 2000);
    g.setClaimMarkup(c.id, 1.5);
    const m0 = g.money;
    assert.equal(g.submitClaim(c.id), true);
    assert.equal(g.submitClaim(c.id), false); // nur einmal
    assert.equal(g.money, m0 - CONFIG.claims.fee);
    for (let i = 0; i < 100; i++) g.update(0.1); // 10 s: noch in Prüfung
    assert.equal(g.claims.length, 1);
    for (let i = 0; i < Math.round(CONFIG.claims.reviewSeconds * 10); i++) g.update(0.1);
    assert.equal(g.claims.length, 0);
    return g.money - (m0 - CONFIG.claims.fee);
  };
  assert.equal(run(0.0), 3000); // genehmigt: 2000 * 1.5
  assert.equal(run(acceptChance(1.5, 0) + 0.05), 1500); // hälftig
  assert.equal(run(0.999), 0); // abgelehnt
});

test('Nachtrag verjährt, wenn er nicht rechtzeitig eingereicht wird; zu viele Entwürfe verdrängen den ältesten', () => {
  const g = quiet(new Game(33));
  g.addClaim('debris', 'alt', 1000);
  for (let i = 0; i < Math.round(CONFIG.claims.expireSeconds * 10) + 5; i++) g.update(0.1);
  assert.equal(g.claims.length, 0);
  assert.equal(g.totals.claimsExpired, 1);
  for (let i = 0; i < CONFIG.claims.maxOpen + 2; i++) g.addClaim('debris', `Nr ${i}`, 1000);
  assert.equal(g.openClaims, CONFIG.claims.maxOpen);
  assert.equal(g.claims[0].text, 'Nr 2'); // die zwei ältesten sind weg
});

test('Dokumentation (Upgrade, Echolot) erhöht die Chance in der Praxis', () => {
  const g = quiet(new Game(34));
  const base = g.stats.docBonus;
  g.levels.docs = 3; g.levels.echolot = 2;
  assert.ok(g.stats.docBonus > base + 0.3);
  assert.ok(acceptChance(1.5, g.stats.docBonus) > acceptChance(1.5, base));
});

test('Harte Schicht: abgesaugtes Material aus harten Zellen wird als Mehraufwand gemeldet', () => {
  const l = new Lake(4, 4); l.setFlat(2, 3);
  const soft = l.suckProfile(1, 1.5, 3, 1.8, 2);
  assert.equal(soft.hardRemoved, 0);
  l.hard.fill(2);
  const hard = l.suckProfile(1, 1.5, 3, 1.8, 2);
  assert.ok(hard.hardRemoved > 0 && hard.hardRemoved <= hard.removed + 1e-9);
});

test('Fossilien: gleichmässig verteilt, teils unter der bestellten Fläche (gefährdet), teils daneben (sicher)', () => {
  const l = Lake.generate(createRng(7));
  let n = 0, inLayer = 0, outside = 0;
  for (let i = 0; i < l.fossil.length; i++) if (l.fossil[i]) { n++; if (l.initial[i]) inLayer++; else outside++; }
  assert.equal(n, CONFIG.fossils.count);
  assert.ok(inLayer > 0 && outside > 0);
  assert.ok(l.fossilFound.every((v) => v === 0)); // anfangs unentdeckt
});

test('Fossil geht verloren, wenn tiefer als die Fossilientiefe unter der Sollsohle gegraben wird', () => {
  const l = new Lake(4, 4); l.setFlat(1, 3); // Sollsohle bei 2
  const i = l.idx(1, 1); l.fossil[i] = 2; l.fossilFound[i] = 1;
  let lost = [];
  for (let n = 0; n < 200 && l.target[i] - l.top[i] <= CONFIG.fossils.depthBelowTarget; n++) {
    const r = l.suckProfile(1, 1.5, l.top[i], 1.8, 1);
    lost = lost.concat(r.fossilsLost);
    if (l.target[i] - l.top[i] <= CONFIG.fossils.depthBelowTarget) assert.equal(l.fossil[i], 2, 'noch flach genug: bleibt erhalten');
  }
  assert.deepEqual(lost, [2]);
  assert.equal(l.fossil[i], 0);
  assert.equal(l.fossilFound[i], 0);
});

test('Zerstörtes Fossil kostet eine Busse und wird gemeldet', () => {
  const g = quiet(new Game(40));
  const m0 = g.money;
  g.collect(ev({ fossilsLost: [1] }));
  assert.equal(g.money, m0 - CONFIG.fossils.destroyFine);
  assert.equal(g.totals.fossilsLost, 1);
  assert.ok(g.notes.some((n) => n.kind === 'bad'));
});

test('Fund bergen: Kosten sofort, nach der Bergungszeit zahlt das Museum', () => {
  const g = quiet(new Game(43));
  const f = g.addFind(1);
  const m0 = g.money;
  assert.equal(g.recoverFind(f.id), true);
  assert.equal(g.recoverFind(f.id), false);
  assert.equal(g.money, m0 - f.fee);
  for (let i = 0; i < Math.round(CONFIG.fossils.recoverSeconds * 10) - 5; i++) g.update(0.1);
  assert.equal(g.finds.length, 1); // noch unterwegs
  for (let i = 0; i < 15; i++) g.update(0.1);
  assert.equal(g.finds.length, 0);
  assert.ok(g.money > m0 - f.fee); // verkauft
  assert.equal(g.totals.findsSold, 1);
});

test('Zonenstand: Zellen, sauberer Anteil, abgenommener Anteil, Restmenge', () => {
  const l = new Lake(10, 10); l.setFlat(1, 3);
  const z = { x: 2, y: 2, w: 4, h: 3 };
  let st = l.zoneStats(z);
  assert.equal(st.n, 12);
  assert.equal(st.cleaned, 0);
  assert.equal(st.volume, 12 * l.area);
  for (let x = 2; x < 6; x++) { l.mass[l.idx(x, 2)] = 0; l.accepted[l.idx(x, 2)] = 1; }
  st = l.zoneStats(z);
  assert.ok(Math.abs(st.cleaned - 4 / 12) < 1e-9 && Math.abs(st.accepted - 4 / 12) < 1e-9);
});

test('Zusatzauftrag der Gemeinde: Angebot, annehmen, Prämie bei sauberer und abgenommener Zone', () => {
  const g = quiet(new Game(44)); g.lake.setFlat(1, 3);
  g.time = g.nextJobAt; g.update(0.1);
  assert.equal(g.jobs.length, 1);
  const j = g.jobs[0];
  assert.equal(j.status, 'offer');
  assert.ok(j.bonus >= CONFIG.jobs.bonusBase);
  assert.equal(g.acceptJob(j.id), true);
  assert.equal(g.acceptJob(j.id), false);
  const m0 = g.money;
  for (let i = 0; i < 10; i++) g.update(0.1);
  assert.equal(g.jobs.length, 1); // Zone ist noch schmutzig
  for (let y = j.zone.y; y < j.zone.y + j.zone.h; y++) for (let x = j.zone.x; x < j.zone.x + j.zone.w; x++) { g.lake.mass[g.lake.idx(x, y)] = 0; g.lake.accepted[g.lake.idx(x, y)] = 1; }
  for (let i = 0; i < 10; i++) g.update(0.1);
  assert.equal(g.jobs.length, 0);
  assert.equal(g.money, m0 + j.bonus);
  assert.equal(g.totals.jobsDone, 1);
});

test('Zusatzauftrag: Termin verpasst kostet Konventionalstrafe; unangenommenes Angebot verfällt; ablehnen geht', () => {
  const g = quiet(new Game(45)); g.lake.setFlat(1, 3);
  g.time = g.nextJobAt; g.update(0.1);
  const j = g.jobs[0]; g.acceptJob(j.id);
  const m0 = g.money;
  g.time = j.dueAt; g.update(0.1);
  assert.equal(g.jobs.length, 0);
  assert.equal(g.totals.jobsFailed, 1);
  assert.equal(g.money, m0 - Math.round((j.bonus * CONFIG.jobs.penaltyShare) / 100) * 100);
  g.time = g.nextJobAt; g.update(0.1);
  const o = g.jobs[0]; assert.equal(o.status, 'offer');
  g.time = o.offerExpiresAt; g.update(0.1);
  assert.equal(g.jobs.length, 0); // Angebot verfallen
  g.time = g.nextJobAt; g.update(0.1);
  const o2 = g.jobs[0];
  assert.equal(g.declineJob(o2.id), true);
  assert.equal(g.jobs.length, 0);
});

// ----- Drohne im Kasten unter dem Ponton -----
const droneFor = (g, thickness = 1, top = 3) => {
  g.lake.setFlat(thickness, top);
  const d = new DroneSim(g.lake, g.stats, { x0: 8, row: 10 });
  d.x = 12; d.h = top + 0.6; d.face = 1; // Lampe zeigt nach rechts und leicht nach unten
  return d;
};
const hover = (d, seconds, input = {}) => { for (let t = 0; t < seconds; t += 0.05) d.update(0.05, input); };

test('Drohne: Lichtkegel zeigt in Fahrtrichtung und leicht nach unten, nichts hinter oder über ihr wird beleuchtet', () => {
  const d = droneFor(new Game(50));
  const cx = d.x - d.x0; // Spalte unter der Drohne
  assert.ok(d.beamDir().x > 0 && d.beamDir().h < 0); // nach rechts, nach unten
  assert.equal(d.light(cx + 2).lit, true); // vor ihr am Boden
  assert.equal(d.light(cx - 3).lit, false); // hinter ihr
  d.face = -1;
  assert.equal(d.light(cx + 2).lit, false); // dreht die Lampe, ist vorne links
  assert.equal(d.light(cx - 2).lit, true);
  d.face = 1; d.h = 7; // hoch über dem Boden: ausser Reichweite
  assert.equal(d.light(cx + 2).lit, false);
});

test('Drohne: Lampe und Blickrichtung folgen der Fahrt, beim Tauchen steiler', () => {
  const d = droneFor(new Game(51));
  d.h = 6;
  hover(d, 0.5, { dx: -1, dy: 0 });
  assert.equal(d.face, -1);
  const flat = d.tilt;
  hover(d, 0.5, { dx: -1, dy: 1 }); // tauchen
  assert.ok(d.tilt > flat);
  hover(d, 0.8, { dx: 1, dy: -1 }); // steigen und drehen
  assert.equal(d.face, 1);
  assert.ok(d.tilt < flat + 0.3);
});

test('Drohne: gescannt wird nur bei langsamer Fahrt und im Licht', () => {
  const slow = droneFor(new Game(52)); const fast = droneFor(new Game(52));
  slow.h = 3.6; fast.h = 3.6;
  const c = 14 - 8; // Spalte 14 liegt vorne rechts im Licht
  hover(slow, 2, { dx: 0.2, dy: 0 }); // gemächlich
  assert.ok(slow.progress[c] > 0 || slow.scanned[c], 'langsam: Fortschritt');
  hover(fast, 2, { dx: 1, dy: 0 }); // volle Fahrt
  assert.equal(fast.scanned.some(Boolean), false, 'schnell: nichts gescannt');
  assert.ok(fast.speed > CONFIG.drone.beam.maxScanSpeed);
});

test('Drohne: nah am Boden scannt schneller als weit weg', () => {
  const near = droneFor(new Game(53)), far = droneFor(new Game(53));
  near.h = 3.5; far.h = 6.2;
  const c = 14 - 8;
  hover(near, 0.5); hover(far, 0.5);
  assert.ok(near.progress[c] > far.progress[c]);
});

test('Drohne: ein gescannte Spalte gilt für alle Zeilen des Kastens, nicht darüber hinaus', () => {
  const g = new Game(54); const d = droneFor(g, 1, 3);
  g.lake.mass.fill(0); g.lake.accepted.fill(0);
  d.h = 3.6;
  hover(d, 5);
  const c = d.scanned.findIndex((v) => v === 1);
  assert.ok(c >= 0, 'mindestens eine Spalte gescannt');
  const B = CONFIG.box.rows;
  for (let y = d.r0; y < d.r0 + B; y++) assert.equal(g.lake.accepted[g.lake.idx(d.x0 + c, y)], 1);
  assert.equal(g.lake.accepted[g.lake.idx(d.x0 + c, d.r0 - 1)], 0);
  assert.equal(g.lake.accepted[g.lake.idx(d.x0 + c, d.r0 + B)], 0);
  assert.ok(d.newlyAccepted >= B); // fünf Zellen je Spalte
});

test('Drohne: Restschmutz wird gemeldet, Fossilien entdeckt, Befliegungsdaten je Zelle einmal vorher und einmal nachher', () => {
  const g = new Game(55); const d = droneFor(g, 1, 3);
  const c = 14 - 8, i = g.lake.idx(d.x0 + c, d.row);
  g.lake.fossil[i] = 3;
  d.h = 3.5;
  hover(d, 6, { dx: 0.05, dy: 0 });
  assert.equal(d.scanned[c], 1);
  assert.ok(d.newlyFlagged >= 1); // alles verschmutzt: Restschmutz
  assert.deepEqual(d.found, [3]);
  assert.equal(g.lake.fossilFound[i], 1);
  const doc1 = d.docCells;
  assert.ok(doc1 >= CONFIG.box.rows);
  // neue Drohne über sauberem Boden: „nachher“-Daten, nur einmal
  g.lake.mass.fill(0);
  const d2 = new DroneSim(g.lake, g.stats, { x0: 8, row: 10 }); d2.x = 12; d2.h = 3.5; d2.face = 1;
  hover(d2, 6, { dx: 0.05, dy: 0 });
  assert.ok(d2.docCells > 0);
  const d3 = new DroneSim(g.lake, g.stats, { x0: 8, row: 10 }); d3.x = 12; d3.h = 3.5; d3.face = 1;
  hover(d3, 6, { dx: 0.05, dy: 0 });
  assert.equal(d3.docCells, 0); // schon dokumentiert
});

test('Drohne: bleibt im Kasten, taucht nicht in den Boden, nicht über die Wasseroberfläche', () => {
  const g = new Game(56); const d = droneFor(g, 1, 3);
  hover(d, 6, { dx: 1, dy: 0 });
  assert.ok(d.x <= d.x0 + 16 - 0.3 + 1e-9);
  hover(d, 6, { dx: -1, dy: 0 });
  assert.ok(d.x >= d.x0 + 0.3 - 1e-9);
  hover(d, 6, { dx: 0, dy: 1 });
  assert.ok(d.h >= d.surfaceAt(d.x) + CONFIG.drone.beam.clearance - 1e-9);
  hover(d, 6, { dx: 0, dy: -1 });
  assert.ok(d.h <= 8 - 0.3 + 1e-9);
});

test('Drohne: Akku begrenzt den Flug; Flug abrechnen: Einsatz kostet, Befliegungsdaten bringen Geld, Funde landen in der Liste', () => {
  const g = quiet(new Game(57));
  const d = g.startDrone({ x0: 8, row: 10 });
  assert.equal(d.timeLeft, g.stats.droneBattery);
  hover(d, g.stats.droneBattery + 1);
  assert.equal(d.over, true);
  const d2 = g.startDrone({ x0: 8, row: 10 });
  d2.docCells = 50; d2.found = [1, 4]; d2.newlyAccepted = 3;
  const m0 = g.money;
  const r = g.finishDrone(d2);
  assert.equal(g.money, m0 + 50 * CONFIG.drone.docPerCell - CONFIG.drone.fee);
  assert.equal(r.found, 2);
  assert.equal(g.finds.length, 2);
  assert.equal(g.finds[0].status, 'found');
});

test('Tempo-Regler der Pumpe: Fahrt skaliert mit dem Regler, Regler wird begrenzt und gilt im laufenden Querschnitt', () => {
  const run = (setting) => {
    const g = new Game(60); g.lake.setFlat(5);
    const sim = g.createSession(); sim.anchor(); sim.slice.h = 5; sim.slice.x = sim.slice.x0 + 1;
    sim.setPumpSpeed(setting);
    const x0 = sim.slice.x;
    for (let i = 0; i < 10; i++) sim.update(0.05, { dx: 1, dy: 0, suction: false });
    return sim.slice.x - x0;
  };
  const full = run(1), half = run(0.5);
  assert.ok(Math.abs(half - full / 2) < 0.02, `${half} vs ${full / 2}`);
  const sim = new Game(61).createSession();
  sim.setPumpSpeed(9); assert.equal(sim.pumpSpeed, CONFIG.pumpSpeed.max);
  sim.setPumpSpeed(-1); assert.equal(sim.pumpSpeed, CONFIG.pumpSpeed.min);
});

test('Tempo gilt auch für Kette (hoch/runter) und wird im Spiel gespeichert', () => {
  const g = new Game(62); g.lake.setFlat(2);
  g.pumpSpeed = 0.5;
  const sim = g.createSession(); sim.anchor();
  assert.equal(sim.slice.speedSetting, 0.5);
  sim.slice.h = 6;
  sim.update(0.1, { dx: 0, dy: 1 });
  const fall = 6 - sim.slice.h;
  assert.ok(Math.abs(fall - g.stats.headSpeed * 0.5 * 0.1) < 1e-9);
});

test('Upgrade Katze & Winde erhöht das Höchsttempo der Pumpe, nicht das des Pontons', () => {
  const g = new Game(63);
  const base = g.stats.headSpeed, ponton = g.stats.speed;
  assert.equal(g.stats.headSpeed, 4.8);
  g.levels.winch = 3;
  assert.ok(g.stats.headSpeed > base + 1.9);
  assert.equal(g.stats.speed, ponton);
  g.levels.speed = 3;
  assert.equal(g.stats.headSpeed, 4.8 + 3 * 0.7); // Ponton-Antrieb beeinflusst die Pumpe nicht mehr
  assert.ok(g.buyUpgrade('winch') || g.money < g.nextUpgradeCost('winch'));
});

test('Wirtschaft: Entsorgung kostet auch bei Typ C weniger als die Vergütung', () => {
  const P = CONFIG.plant, perBatchPay = P.batchSize * CONFIG.pay.perM3;
  const stats = computeStats();
  for (const cls of ['B', 'E', 'C']) {
    const cost = P.batchSize * stats.dewater * P.classes[cls].price + P.labFeePerBatch;
    assert.ok(cost < perBatchPay * 0.9, `${cls}: ${cost} vs ${perBatchPay}`);
  }
});

test('Trübung: ein Dauerlauf mit der Basispumpe löst keine Dauer-Bussen aus', () => {
  const g = new Game(64); g.lake.setFlat(5);
  const sim = g.createSession(); sim.anchor(); sim.slice.h = 5;
  let fines = 0;
  for (let i = 0; i < 1200; i++) { fines += sim.update(0.05, { dx: (i % 200) < 100 ? 1 : -1, dy: 0, suction: true }).fines; } // 60 s
  assert.ok(fines < 5000, `Bussen ${fines}`);
});

test('Angebrochene Charge: Analyse anteilig, mindestens 20 Prozent', () => {
  const stats = computeStats();
  assert.equal(processBatch(25, 0, stats, false, () => 0).lab, CONFIG.plant.labFeePerBatch);
  assert.equal(processBatch(5, 0, stats, false, () => 0).lab, Math.round(CONFIG.plant.labFeePerBatch * 0.2));
  assert.equal(processBatch(0.3, 0, stats, false, () => 0).lab, Math.round(CONFIG.plant.labFeePerBatch * 0.2));
});

test('Pumpe räumt den ganzen Kasten (alle Zeilen), nicht darüber hinaus; die Leistung verteilt sich', () => {
  const g = new Game(70); g.lake.setFlat(1, 3);
  const sim = g.createSession(); sim.y = 10.5; sim.x = 24; sim.anchor();
  const sl = sim.slice, R = CONFIG.box.rows;
  assert.equal(sl.rows.length, R);
  assert.ok(sl.rows.includes(sl.row));
  sl.h = 3.4; sl.x = sl.x0 + 4;
  let removed = 0;
  for (let i = 0; i < 40; i++) removed += sim.update(0.05, { dx: 0.2, dy: 0, suction: true }).removed;
  const col = sl.x0 + Math.floor(sl.mouth().x - sl.x0) + 0;
  for (const r of sl.rows) assert.ok(g.lake.mass[g.lake.idx(col, r)] < 1, `Zeile ${r} wurde mitgeräumt`);
  assert.equal(g.lake.mass[g.lake.idx(col, sl.r0 - 1)], 1); // darüber nicht
  assert.equal(g.lake.mass[g.lake.idx(col, sl.r0 + R)], 1); // darunter nicht
  assert.ok(removed <= g.stats.power * 2 + 1e-6); // Leistung bleibt die Pumpenleistung (2 s)
});

test('Nach dem Abtragen meldet die Drohne keinen Restschmutz: Kasten ganz geräumt, 10 cm Rest erlaubt', () => {
  const g = new Game(71); g.lake.setFlat(1, 3); g.levels.auto = 3; g.levels.echolot = 2; g.cutDepth = 1.0; // die ganze belastete Schicht
  const sim = g.createSession(); sim.y = 10.5; sim.x = 24; sim.anchor(); sim.toggleAuto();
  for (let t = 0; t < 900 && sim.slice.auto.on; t += 0.05) sim.update(0.05, {});
  assert.equal(sim.slice.auto.on, false);
  const sl = sim.slice;
  for (const r of sl.rows) for (let c = 0; c < 16; c++) assert.ok(g.lake.mass[g.lake.idx(sl.x0 + c, r)] < CONFIG.drone.acceptMax, `Zeile ${r} Spalte ${c}`);
  const d = g.startDrone({ x0: sl.x0, row: sl.row });
  d.x = d.x0 + 0.5; d.h = 4;
  for (let t = 0; t < 120 && d.scanned.some((v) => !v); t += 0.05) {
    const target = d.surfaceAt(d.x + 1.5) + 0.7;
    d.update(0.05, { dx: d.x > d.x0 + 15 ? 0 : 0.25, dy: Math.max(-1, Math.min(1, (d.h - target) * 2)) });
  }
  assert.ok(d.scanned.filter(Boolean).length >= 12, 'die meisten Spalten gescannt');
  assert.equal(d.newlyFlagged, 0, 'kein Restschmutz gemeldet');
  assert.ok(d.newlyAccepted >= 12 * CONFIG.box.rows);
});

test('Abnahme: bis 10 cm Restschicht gelten als sauber, darüber ist es Restschmutz; winzige Reste werden beim Absaugen erledigt', () => {
  const g = new Game(72); const l = g.lake; l.setFlat(1, 3);
  const d = new DroneSim(l, g.stats, { x0: 8, row: 10 });
  const c = 6, i = l.idx(8 + c, 10);
  l.mass[i] = 0.09; d._scanColumn(c);
  assert.equal(l.accepted[i], 1);
  l.mass[i] = 0.11; d.scanned[c] = 0; d._scanColumn(c);
  assert.equal(l.flagged[i], 1);
  const small = new Lake(4, 4); small.setFlat(1, 3);
  const k = small.idx(1, 1); small.top[k] = small.target[k] + CONFIG.layer.snap / 2; small.mass[k] = CONFIG.layer.snap / 2;
  small.suckProfile(1, 1.5, small.top[k], 1.8, 0.01);
  assert.equal(small.mass[k], 0);
});

test('Pumpe ein/aus: im Stillstand wird gesaugt, aus heisst aus, rückwärts nie, Umkippen schaltet aus', () => {
  const g = new Game(80); g.lake.setFlat(3);
  const sim = g.createSession();
  assert.equal(sim.togglePump(), false); // auf der Karte gibt es keine Pumpe
  sim.anchor(); sim.slice.h = 3; sim.slice.x = sim.slice.x0 + 5;
  assert.equal(sim.pumpOn, false);
  assert.equal(sim.update(0.5, { dx: 0, dy: 0 }).removed, 0); // aus: nichts
  assert.equal(sim.togglePump(), true);
  assert.equal(sim.pumpOn, true);
  assert.ok(sim.update(0.5, { dx: 0, dy: 0 }).removed > 0); // an: Stillstand saugt
  assert.ok(sim.update(0.5, { dx: 1, dy: 0 }).removed > 0); // vorwärts auch
  assert.equal(sim.update(0.5, { dx: -1, dy: 0 }).removed, 0); // rückwärts nie
  assert.ok(sim.update(0.5, { dx: 0, dy: 0 }).removed > 0); // und danach läuft sie weiter
  sim.togglePump();
  assert.equal(sim.update(0.5, { dx: 0, dy: 0 }).removed, 0); // aus
  sim.togglePump(); sim.leave();
  assert.equal(sim.pumpOn, false); // beim Verlassen aus
  sim.anchor();
  assert.equal(sim.pumpOn, false); // und beim Ankern aus
});

test('Pumpe im Stillstand: Basispumpe untergräbt den Boden nicht, eine starke Pumpe kippt (Ballast hilft)', () => {
  const run = (power, ballast = 0, seconds = 30) => {
    const g = new Game(81); g.lake.setFlat(8); g.levels.ballast = ballast;
    const sim = g.createSession(); sim.anchor(); sim.stats.power = power; sim.slice.h = 8; sim.slice.x = sim.slice.x0 + 4; sim.pumpOn = true;
    for (let t = 0; t < seconds && sim.tips === 0; t += 0.05) sim.update(0.05, { dx: 0, dy: 0 });
    return sim.tips;
  };
  assert.equal(run(2), 0, 'Basispumpe');
  assert.equal(run(6), 1, 'starke Pumpe kippt im Stillstand');
  assert.equal(run(6, 4), 0, 'mit Ballast bleibt sie stehen');
});

test('Pumpe bleibt nach einer Verstopfung an und läuft danach weiter; Puffer voll pausiert sie', () => {
  const g = new Game(82); g.lake.setFlat(3);
  const sim = g.createSession(); sim.anchor(); sim.slice.h = 3; sim.slice.x = sim.slice.x0 + 5; sim.pumpOn = true;
  sim.slice.clog = 1;
  assert.equal(sim.update(0.5, { dx: 0, dy: 0 }).removed, 0); // verstopft
  for (let i = 0; i < 12; i++) sim.update(0.05, { dx: 0, dy: 0 });
  assert.ok(sim.update(0.5, { dx: 0, dy: 0 }).removed > 0); // wieder frei
  sim.bufferRoom = 0;
  assert.equal(sim.update(0.5, { dx: 0, dy: 0 }).removed, 0); // Puffer voll
  assert.equal(sim.pumpOn, true); // bleibt an, pausiert nur
});

test('Trübung entsteht nur am Boden im Material, nicht wenn die Pumpe im freien Wasser läuft', () => {
  const run = (h) => {
    const g = new Game(83); g.lake.setFlat(2); g.levels.power = 4;
    const sim = g.createSession(); sim.anchor(); sim.stats.power = g.stats.power;
    sim.slice.h = h; sim.slice.x = sim.slice.x0 + 4; sim.pumpOn = true;
    let removed = 0;
    for (let i = 0; i < 80; i++) { sim.slice.h = h; removed += sim.update(0.05, { dx: 0, dy: 0 }).removed; } // 4 s, Höhe gehalten
    return { turbidity: sim.turbidity, removed };
  };
  const water = run(7.5), ground = run(2.1);
  assert.equal(water.removed, 0);
  assert.equal(water.turbidity, 0); // im Wasser: keine Trübung
  assert.ok(ground.removed > 0);
  assert.ok(ground.turbidity > 0.05); // am Boden: Trübung
});

test('Saugkraft hängt vom Abstand zum Material ab: am Boden voll, im freien Wasser kaum etwas und keine Trübung', () => {
  const rate = (gap) => {
    const g = new Game(84); g.lake.setFlat(3);
    const sim = g.createSession(); sim.anchor(); sim.slice.x = sim.slice.x0 + 5; sim.pumpOn = true;
    let removed = 0;
    for (let t = 0; t < 0.5; t += 0.05) { sim.slice.h = 3 + gap; removed += sim.update(0.05, { dx: 0, dy: 0 }).removed; }
    return { share: removed / 0.5 / g.stats.power, turbidity: sim.turbidity };
  };
  const ground = rate(0.3), mid = rate(1.5), water = rate(2.2);
  assert.ok(ground.share > 0.9, `Boden ${ground.share}`);
  assert.ok(mid.share < ground.share && mid.share > water.share);
  assert.ok(water.share < 0.1, `Wasser ${water.share}`);
  assert.equal(water.turbidity, 0);
});

test('Spielfeld-Grösse: füllt die Fläche, behält das Seitenverhältnis, wächst höchstens um den Maximalfaktor', () => {
  const a = fitSize(1700, 700, 960, 600); // breit und niedrig: Höhe begrenzt
  assert.ok(Math.abs(a.h - 700) < 1e-9 && Math.abs(a.w / a.h - 960 / 600) < 1e-9);
  const b = fitSize(500, 900, 960, 600); // schmal: Breite begrenzt
  assert.ok(Math.abs(b.w - 500) < 1e-9 && Math.abs(b.w / b.h - 960 / 600) < 1e-9);
  const c = fitSize(5000, 5000, 960, 600, 3); // riesiger Bildschirm: höchstens dreifach
  assert.ok(Math.abs(c.w - 2880) < 1e-9);
  assert.ok(fitSize(0, 0, 960, 600).w >= 1); // nie 0
});

test('Render-Faktor: scharf auf Retina, nie unter 1, begrenzt', () => {
  assert.equal(renderQuality(1, 960, 960), 1);
  assert.equal(renderQuality(2, 1920, 960), 3); // begrenzt auf 3
  assert.equal(renderQuality(1, 1440, 960), 2); // 1,5 -> ganzzahlig aufgerundet
  assert.ok(Number.isInteger(renderQuality(1.25, 1313, 960)));
  assert.equal(renderQuality(1, 300, 960), 1); // verkleinert: nicht unter 1
  assert.equal(renderQuality(undefined, 960, 960), 1);
});

test('Steuerungsanzeige: für jede Ansicht und jedes Gerät vorhanden, mit Taste und Wirkung', () => {
  for (const device of ['keys', 'touch']) for (const mode of ['map', 'slice', 'drone']) {
    const list = HINTS[device][mode];
    assert.ok(list.length >= 3, `${device}/${mode}`);
    for (const [key, what] of list) assert.ok(key && what);
  }
  assert.deepEqual(hintsFor('map', false), HINTS.keys.map);
  assert.deepEqual(hintsFor('map', true), HINTS.touch.map);
  assert.deepEqual(hintsFor('unbekannt', false), []);
  assert.ok(HINTS.keys.slice.some(([k]) => k === 'Leertaste')); // Pumpe an/aus
  assert.ok(HINTS.keys.map.some(([k]) => k.includes('E'))); // Anker
});
