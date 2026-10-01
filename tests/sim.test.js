import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/sim/rng.js';
import { Lake } from '../src/sim/lake.js';
import { Game } from '../src/sim/game.js';
import { DredgeSim } from '../src/sim/dredge.js';
import { CONFIG } from '../src/config.js';
import { computeStats } from '../src/sim/stats.js';
import { DroneSim } from '../src/sim/drone.js';
import { classProbabilities, runPlantDay } from '../src/sim/plant.js';

test('rng ist deterministisch', () => {
  assert.equal(createRng(5)(), createRng(5)());
});

test('suck erhält die Masse', () => {
  const lake = Lake.generate(createRng(1));
  const before = lake.remaining();
  const r = lake.suck(20, 12, 3, 50);
  assert.ok(Math.abs(before - lake.remaining() - r.removed) < 1e-3);
});

test('Seegrund lässt sich komplett leersaugen', () => {
  const lake = Lake.generate(createRng(2));
  for (let y = 0; y < lake.rows; y++) for (let x = 0; x < lake.cols; x++) lake.suck(x + 0.5, y + 0.5, 1.5, 1e6);
  assert.ok(lake.cleanFraction() > 0.999);
});

test('Schicht: Saugen entfernt Material, Zeit läuft ab', () => {
  const g = new Game(3);
  const sim = g.startShift();
  sim.x = 24; sim.y = 15; sim.anchor();
  while (!sim.over) sim.update(0.1, { dx: Math.sin(sim.timeLeft), dy: 0, suction: true });
  assert.ok(sim.removed > 0);
});

test('Karte saugt nicht, Querschnitt schon', () => {
  const g = new Game(3);
  const sim = g.startShift();
  sim.update(1, { dx: 0, dy: 0, suction: true });
  assert.equal(sim.removed, 0);
  g.lake.mass.fill(5); sim.anchor(); sim.slice.h = 5;
  sim.update(0.5, { dx: 0, dy: 0, suction: true });
  assert.equal(sim.removed, 0); // Stillstand saugt nicht
  sim.update(0.5, { dx: 1, dy: 0, suction: true });
  assert.ok(sim.removed > 0);
});

test('Anker nur in der Karte, Lichten nur im Querschnitt, Uhr läuft in beiden', () => {
  const sim = new Game(3).startShift();
  assert.equal(sim.leave(), false);
  assert.equal(sim.anchor(), true);
  assert.equal(sim.anchor(), false);
  const t = sim.timeLeft; sim.update(1, {});
  assert.equal(sim.timeLeft, t - 1);
  assert.equal(sim.leave(), true);
  assert.equal(sim.mode, 'map');
});

test('Querschnitt: Saugkopf dringt nicht in den Grund, Fenster liegt im See', () => {
  const g = new Game(3);
  g.lake.mass.fill(4);
  const sim = g.startShift(); sim.x = 0; sim.anchor();
  assert.equal(sim.slice.x0, 0);
  for (let i = 0; i < 100; i++) sim.update(0.1, { dx: 0, dy: 1, suction: false });
  assert.ok(sim.slice.h >= 4 - 1e-9);
  sim.x = g.lake.cols; sim.leave(); sim.anchor();
  assert.equal(sim.slice.x0, g.lake.cols - 16);
});

test('Querschnitt: Saugkopf in der Höhe saugt nichts', () => {
  const lake = Lake.generate(createRng(1));
  lake.mass.fill(2); lake.hard.fill(0);
  assert.equal(lake.suckProfile(5, 10, 12, 1.8, 100).removed, 0);
  const r = lake.suckProfile(5, 10, 2, 1.8, 3);
  assert.ok(Math.abs(r.removed - 3) < 1e-6);
});

test('Schicht: Material geht in den Puffer, Tag wird weitergeschaltet', () => {
  const g = new Game(4);
  g.rng = Object.assign(() => 0.5, { chance: () => false, range: (a) => a });
  const sim = new DredgeSim(g.lake, computeStats(), 1);
  sim.removed = 10; sim.toxicRemoved = 4;
  g.finishShift(sim);
  assert.equal(g.day, 2);
  // Anlage hat am neuen Tag bereits verarbeitet (Kapazität 50 > 10) -> Puffer leer, Entsorgung bezahlt
  assert.ok(g.stockTotal < 1e-9);
  assert.ok(g.money < CONFIG.startMoney);
  assert.equal(g.totals.classes.B + g.totals.classes.E + g.totals.classes.C, 1);
});

test('Puffer voll: Pumpe pausiert', () => {
  const g = new Game(4);
  g.lake.mass.fill(5);
  const sim = new DredgeSim(g.lake, computeStats(), 100, 3);
  sim.anchor(); sim.slice.h = 5;
  for (let i = 0; i < 100; i++) sim.update(0.1, { dx: (i % 40) < 20 ? 1 : -1, dy: 0, suction: true });
  assert.ok(sim.bufferFull);
  assert.ok(sim.removed < 3 + computeStats().power * 0.1 + 1e-6);
});

test('Klassenwahrscheinlichkeiten: Summe 1, Altlasten und Übertakten erhöhen C', () => {
  const a = classProbabilities(0, false), b = classProbabilities(0.5, false), c = classProbabilities(0, true);
  for (const p of [a, b, c]) assert.ok(Math.abs(p.B + p.E + p.C - 1) < 1e-9);
  assert.ok(b.C > a.C && c.C > a.C);
});

test('Anlage: Kapazität begrenzt, Rest bleibt im Lager, Masse stimmt', () => {
  const stats = computeStats();
  const rng = createRng(1);
  const res = runPlantDay({ normal: 90, toxic: 10 }, stats, false, rng);
  assert.equal(res.processed, stats.plantCapacity);
  assert.ok(Math.abs(res.stock.normal + res.stock.toxic - 50) < 1e-6);
  assert.equal(res.batches.length, 2);
  const oc = runPlantDay({ normal: 90, toxic: 10 }, stats, true, createRng(1));
  assert.equal(oc.processed, stats.plantCapacity * CONFIG.plant.overclockFactor);
});

test('Tranche alle N Tage', () => {
  const g = new Game(5);
  g.money = 0;
  g.rng = Object.assign(() => 0.999, { chance: () => false, range: (a) => a }); // keine Zufallsereignisse
  g.advanceDays(CONFIG.trancheEveryDays);
  assert.equal(g.money, CONFIG.trancheAmount);
});

test('Upgrade kaufen: Geld sinkt, Stufe steigt, Werte wachsen', () => {
  const g = new Game(6);
  const before = g.stats.power, cost = g.nextUpgradeCost('power');
  assert.ok(g.buyUpgrade('power'));
  assert.equal(g.money, CONFIG.startMoney - cost);
  assert.ok(g.stats.power > before);
});

test('Bankrott beendet das Spiel', () => {
  const g = new Game(7);
  g.rng = Object.assign(() => 0.999, { chance: () => false, range: (a) => a });
  g.money = CONFIG.bankruptcyLimit - 1;
  g.advanceDays(1);
  assert.equal(g.status, 'lost');
});

test('Querschnitt: Saugen nur in Arbeitsrichtung, nur eine Achse, Rückweg ist schneller', () => {
  const g = new Game(3);
  g.lake.mass.fill(5);
  const sim = g.startShift(); sim.anchor();
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
  assert.ok(sl.h <= hs && Math.abs(sl.h - (hs - 4 * 0.1)) < 1e-6); // nur Gravität, keine vertikale Eingabe
});

const flat = (g, m = 5) => { g.lake.mass.fill(m); g.lake.hard.fill(0); g.lake.debris.fill(0); return g.lake; };
const sweep = (sim, seconds, dir = 1) => { for (let t = 0; t < seconds; t += 0.1) sim.update(0.1, { dx: dir, dy: 0, suction: true }); };

test('Harte Schicht: gleiche Leistung entfernt weniger, mehrere Überfahrten nötig', () => {
  const a = Lake.generate(createRng(1)), b = Lake.generate(createRng(1));
  for (const l of [a, b]) { l.mass.fill(5); l.hard.fill(0); }
  b.hard.fill(2);
  const soft = a.suckProfile(5, 10, 5, 1.8, 2).removed, hard = b.suckProfile(5, 10, 5, 1.8, 2).removed;
  assert.ok(hard < soft * 0.5);
});

test('Fremdstoff verstopft die Pumpe; Anheben des Kopfes vermeidet es', () => {
  const g = new Game(8); const lake = flat(g);
  const sim = g.startShift(); sim.y = 5; sim.anchor();
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
  let sim = g.startShift(); sim.anchor();
  assert.equal(sim.toggleAuto(), false);
  g.levels.auto = 2;
  sim = g.startShift(); sim.anchor();
  assert.equal(sim.toggleAuto(), true);
  const x0 = sim.slice.x0;
  for (let i = 0; i < 600; i++) sim.update(0.1, { dx: 0, dy: 0, suction: false });
  assert.ok(sim.removed > 0);
  assert.ok(sim.slice.x >= x0);
});

test('Automatik Stufe 1 macht Fehler, Reset behebt sie, manuelles Steuern übernimmt', () => {
  const g = new Game(10); flat(g); g.levels.auto = 1;
  const sim = g.startShift();
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
  const sim = new DredgeSim(g.lake, g.stats, 100, 0);
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
  const g = new Game(13); g.rng = Object.assign(() => 0.999, { chance: () => false, range: (a) => a });
  g.lake.mass.fill(0);
  g.checkEnd();
  assert.equal(g.status, 'playing'); // sauber, aber nicht abgenommen
  g.lake.accepted.fill(1);
  g.checkEnd();
  assert.equal(g.status, 'won');
});

test('Trübungsschutz senkt die Trübung', () => {
  const run = (lvl) => {
    const g = new Game(14); flat(g); g.levels.curtain = lvl;
    const sim = g.startShift(); sim.anchor(); sim.slice.h = 5; sweep(sim, 2);
    return sim.turbidity;
  };
  assert.ok(run(4) < run(0));
});

test('Einsaugstelle liegt unten rechts der Pumpe; links der Pumpe wird nichts gesaugt', () => {
  const g = new Game(15); const lake = flat(g, 0);
  const sim = g.startShift(); sim.anchor();
  const sl = sim.slice, P = CONFIG.pump;
  sl.x = sl.x0 + 10; sl.h = 4;
  const m = sl.mouth();
  assert.equal(m.x, sl.x + P.offsetX);
  assert.equal(m.h, sl.h - P.offsetY);
  for (let c = 0; c < 8; c++) lake.mass[lake.idx(sl.x0 + c, sl.row)] = 5; // nur links der Pumpe
  sim.update(0.2, { dx: 1, dy: 0, suction: true });
  assert.equal(sim.removed, 0);
  lake.mass[lake.idx(sl.x0 + 12, sl.row)] = 5; // rechts der Pumpe
  sl.h = 5;
  sim.update(0.2, { dx: 1, dy: 0, suction: true });
  assert.ok(sim.removed > 0);
});

test('Zu tiefes Abtragen: Schieflage steigt, Pumpe kippt um und kostet Bergung', () => {
  const g = new Game(16); flat(g, 8);
  const sim = g.startShift(); sim.anchor();
  sim.stats.power = 30; // brutale Pumpe
  sim.slice.h = 8;
  let max = 0;
  for (let t = 0; t < 4 && sim.tips === 0; t += 0.05) { sim.update(0.05, { dx: 1, dy: 0, suction: true }); max = Math.max(max, sim.slice.tilt); }
  assert.ok(max > 0.3);
  assert.equal(sim.tips, 1);
  assert.equal(sim.repairs, CONFIG.pump.repairCost);
  const before = sim.removed;
  sim.update(0.5, { dx: 1, dy: 0, suction: true });
  assert.equal(sim.removed, before); // liegt auf der Seite
  const money = g.money; sim.timeLeft = 0; sim.over = true;
  g.rng = Object.assign(() => 0.999, { chance: () => false, range: (a) => a });
  g.finishShift(sim);
  assert.ok(g.money <= money - CONFIG.pump.repairCost);
});

test('Sanftes Abtragen mit der Standardpumpe kippt nicht', () => {
  const g = new Game(17); flat(g, 5);
  const sim = g.startShift(); sim.anchor(); sim.slice.h = 5;
  for (let p = 0; p < 4; p++) { sweep(sim, 6, 1); sweep(sim, 6, -1); }
  assert.equal(sim.tips, 0);
});

test('Automatik ab Stufe 2 zieht die Pumpe bei Schieflage hoch', () => {
  const g = new Game(18); flat(g, 8); g.levels.auto = 2;
  const sim = g.startShift(); sim.anchor(); sim.stats.power = 12;
  sim.toggleAuto();
  for (let i = 0; i < 400; i++) sim.update(0.05, {});
  assert.equal(sim.tips, 0);
});
