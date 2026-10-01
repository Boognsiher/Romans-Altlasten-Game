import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../src/sim/rng.js';
import { Lake } from '../src/sim/lake.js';
import { Game } from '../src/sim/game.js';
import { DredgeSim } from '../src/sim/dredge.js';
import { CONFIG } from '../src/config.js';
import { computeStats } from '../src/sim/stats.js';

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
  sim.slice.x = 24;
  while (!sim.over) sim.update(0.1, { dx: Math.sin(sim.timeLeft), dy: 0, suction: true });
  assert.ok(sim.removed > 0);
});

test('Karte saugt nicht, Querschnitt schon', () => {
  const g = new Game(3);
  const sim = g.startShift();
  sim.update(1, { dx: 0, dy: 0, suction: true });
  assert.equal(sim.removed, 0);
  g.lake.mass.fill(5); sim.anchor(); sim.slice.h = 5;
  sim.update(1, { dx: 0, dy: 0, suction: true });
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

test('Abrechnung: Entsorgung kostet, Tag wird weitergeschaltet', () => {
  const g = new Game(4);
  const sim = new DredgeSim(g.lake, computeStats(), 1);
  sim.removed = 10; sim.toxicRemoved = 0;
  const m = g.money;
  g.finishShift(sim);
  assert.equal(g.day, 2);
  assert.equal(g.money, m - 10 * CONFIG.disposalCostPerUnit);
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
