import { CONFIG, UPGRADES } from './config.js';
import { Game } from './sim/game.js';
import { createInput } from './ui/input.js';
import { CELL, drawMap, drawSlice, sizeMap, sizeSlice, sliceHeadScreen } from './ui/render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;

let game = new Game();
let sim = null; // aktive Schicht, sonst null
const readInput = createInput(canvas);
sizeMap(canvas, game.lake);
let shownMode = 'map';

function renderPanel() {
  $('h-day').textContent = `${game.day}/${CONFIG.deadlineDays}`;
  $('h-money').textContent = chf(game.money);
  $('h-money').style.color = game.money < 0 ? 'var(--bad)' : '';
  $('h-score').textContent = game.score.toLocaleString('de-CH');
  $('h-clean').textContent = `${(game.lake.cleanFraction() * 100).toFixed(1)}%`;

  $('upgrades').replaceChildren(...Object.entries(UPGRADES).map(([id, def]) => {
    const cost = game.nextUpgradeCost(id);
    const row = document.createElement('div'); row.className = 'up';
    row.innerHTML = `<div>${def.name} <small>Stufe ${game.levels[id]}/${def.maxLevel} · ${def.desc}</small></div>`;
    const btn = document.createElement('button');
    btn.textContent = cost === null ? 'Max' : chf(cost);
    btn.disabled = cost === null || game.money < cost || sim !== null || game.status !== 'playing';
    btn.onclick = () => { game.buyUpgrade(id); renderPanel(); };
    row.append(btn);
    return row;
  }));
  $('log').replaceChildren(...game.log.map((e) => {
    const li = document.createElement('li'); li.className = e.kind;
    li.textContent = `Tag ${e.day}: ${e.text}`; return li;
  }));
  const busy = sim !== null || game.status !== 'playing';
  $('btn-start').disabled = busy; $('btn-wait').disabled = busy;
}

function showOverlay(html) { const o = $('overlay'); o.innerHTML = `<div>${html}</div>`; o.classList.add('show'); }
function hideOverlay() { $('overlay').classList.remove('show'); }

// Canvas-Grösse und Bedienelemente an die aktive Instanz (Karte/Querschnitt) anpassen
function syncMode() {
  const mode = sim ? sim.mode : 'map';
  if (mode !== shownMode) { mode === 'slice' ? sizeSlice(canvas) : sizeMap(canvas, game.lake); shownMode = mode; }
  $('btn-anchor').hidden = mode !== 'map'; $('btn-leave').hidden = mode !== 'slice';
  $('s-mode').textContent = mode === 'slice' ? 'Querschnitt' : 'Karte';
}
function anchor() { if (sim?.anchor()) syncMode(); }
function leave() { if (sim?.leave()) syncMode(); }

function startShift() {
  hideOverlay();
  sim = game.startShift();
  $('shift-hud').hidden = false; $('shift-actions').hidden = false;
  syncMode();
  renderPanel();
}

function endShift() {
  const r = game.finishShift(sim);
  sim = null;
  $('shift-hud').hidden = true; $('shift-actions').hidden = true;
  syncMode();
  renderPanel();
  if (game.status !== 'playing') {
    showOverlay(`<h2>${game.status === 'won' ? 'See saniert!' : 'Projekt gescheitert'}</h2>
      <p>Punkte: ${game.score.toLocaleString('de-CH')}<br>Abgesaugt: ${game.totals.removed.toFixed(0)} m³</p>
      <button class="primary" id="btn-restart">Neues Spiel</button>`);
    $('btn-restart').onclick = restart;
  } else {
    showOverlay(`<h2>Schicht beendet</h2>
      <p>${r.removed.toFixed(1)} m³ abgesaugt (davon ${r.toxicRemoved.toFixed(1)} m³ Altlasten)<br>
      +${r.points} Punkte · Entsorgung −${chf(r.disposal)}${r.fines ? `<br>Busse −${chf(r.fines)}` : ''}</p>
      <button class="primary" id="btn-ok">Weiter</button>`);
    $('btn-ok').onclick = hideOverlay;
  }
}

function restart() { game = new Game(); sizeMap(canvas, game.lake); shownMode = 'map'; hideOverlay(); renderPanel(); }

$('btn-start').onclick = startShift;
$('btn-anchor').onclick = anchor;
$('btn-leave').onclick = leave;
$('btn-wait').onclick = () => { game.advanceDays(1); renderPanel(); };

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (sim) {
    const inMap = sim.mode === 'map';
    const cur = inMap ? { x: sim.x * CELL, y: sim.y * CELL } : sliceHeadScreen(sim.slice);
    const inp = readInput.read(cur, { holdToMove: inMap });
    if (inMap) {
      inp.suction = false; // in der Karte wird nicht gesaugt
      if (readInput.tap('Space', 'Enter', 'KeyE')) anchor();
    } else if (readInput.tap('Escape', 'KeyQ')) leave();
    sim.update(dt, inp);
    $('s-time').textContent = `${Math.ceil(sim.timeLeft)}s`;
    $('s-removed').textContent = `${sim.removed.toFixed(1)} m³`;
    $('s-turb').value = sim.turbidity;
    if (sim.over) endShift();
  }
  readInput.endFrame();
  if (sim && sim.mode === 'slice') drawSlice(ctx, game.lake, sim); else drawMap(ctx, game.lake, sim);
  requestAnimationFrame(frame);
}
renderPanel();
showOverlay(`<h2>Seesanierung Uetikon</h2>
  <p>Fahre auf der <b>Karte</b> mit dem Ponton (WASD / Pfeile, Maus gedrückt) an eine Stelle und wirf den Anker (<b>E</b> / Leertaste). Im <b>Querschnitt</b> steuerst du den Saugkopf (A/D links-rechts, W/S hoch-runter) und saugst mit <b>Leertaste</b> / Mausklick. <b>Q</b> bringt dich zurück zur Karte. Fahren und Absaugen teilen sich die Schichtzeit.
  Rot = Altlasten (mehr Punkte, teurere Entsorgung). Zu viel Trübung gibt Bussen.
  Alle ${CONFIG.trancheEveryDays} Tage kommt eine Tranche – davon bezahlst du die Entsorgung.</p>
  <button class="primary" id="btn-go">Los</button>`);
$('btn-go').onclick = hideOverlay;
requestAnimationFrame(frame);
