import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/sim/rng.js';
import { Lake } from '../src/sim/lake.js';
import { Game } from '../src/sim/game.js';
import { DredgeSim } from '../src/sim/dredge.js';
import { CONFIG } from '../src/config.js';
import { computeStats } from '../src/sim/stats.js';
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
  lake.mass.fill(2);
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
