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
  while (!sim.over) sim.update(0.1, { dx: 0.3, dy: 0.1, suction: true });
  assert.ok(sim.removed > 0);
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
