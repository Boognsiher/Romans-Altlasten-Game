import { CONFIG, UPGRADES } from './config.js';
import { Game } from './sim/game.js';
import { classProbabilities } from './sim/plant.js';
import { createInput } from './ui/input.js';
import { CELL, drawDrone, drawMap, drawSlice, sizeMap, sizeSlice, sliceHeadScreen } from './ui/render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;

let game = new Game();
let sim = null; // aktive Schicht (Karte/Querschnitt), sonst null
let drone = null; // aktiver Drohnenflug, sonst null
const readInput = createInput(canvas);
sizeMap(canvas, game.lake);
let shownMode = 'map';

const busy = () => sim !== null || drone !== null || game.status !== 'playing';

function renderPanel() {
  $('h-day').textContent = `${game.day}/${CONFIG.deadlineDays}`;
  $('h-money').textContent = chf(game.money);
  $('h-money').style.color = game.money < 0 ? 'var(--bad)' : '';
  $('h-score').textContent = game.score.toLocaleString('de-CH');
  $('h-clean').textContent = `${(game.lake.cleanFraction() * 100).toFixed(1)}%`;
  $('h-acc').textContent = `${(game.lake.acceptedFraction() * 100).toFixed(0)}%`;

  renderPlant();
  const groups = { plant: 'Anlage ausbauen', ponton: 'Ponton ausrüsten', drone: 'Abnahme' };
  const nodes = [];
  for (const [g, title] of Object.entries(groups)) {
    const h = document.createElement('h3'); h.textContent = title; nodes.push(h);
    for (const [id, def] of Object.entries(UPGRADES).filter(([, d]) => d.group === g)) {
      const cost = game.nextUpgradeCost(id);
      const row = document.createElement('div'); row.className = 'up';
      row.innerHTML = `<div>${def.name} <small>Stufe ${game.levels[id]}/${def.maxLevel} · ${def.desc}</small></div>`;
      const btn = document.createElement('button');
      btn.textContent = cost === null ? 'Max' : chf(cost);
      btn.disabled = cost === null || game.money < cost || busy();
      btn.onclick = () => { game.buyUpgrade(id); renderPanel(); };
      row.append(btn);
      nodes.push(row);
    }
  }
  $('upgrades').replaceChildren(...nodes);
  $('log').replaceChildren(...game.log.map((e) => {
    const li = document.createElement('li'); li.className = e.kind;
    li.textContent = `Tag ${e.day}: ${e.text}`; return li;
  }));
  for (const id of ['btn-start', 'btn-wait', 'btn-drone']) $(id).disabled = busy();
  $('btn-drone').textContent = `Drohne tauchen lassen (1 Tag, ${chf(CONFIG.drone.fee)})`;
}

function renderPlant() {
  const st = game.stats, P = CONFIG.plant, cap = st.plantCapacity * (game.overclock ? P.overclockFactor : 1);
  const probs = classProbabilities(game.stockTotal ? game.stock.toxic / game.stockTotal : 0, game.overclock);
  const pct = (v) => `${Math.round(v * 100)}%`;
  $('plant').innerHTML = `
    <div>Puffer: <b>${game.stockTotal.toFixed(0)}</b> / ${st.bufferCapacity} m³</div>
    <progress max="${st.bufferCapacity}" value="${game.stockTotal}"></progress>
    <div>Durchsatz: ${cap.toFixed(0)} m³/Tag · Restvolumen nach Pressen: ${pct(st.dewater)}</div>
    <div>Chargen-Lotto: B ${pct(probs.B)} · E ${pct(probs.E)} · <span class="${probs.C > 0.2 ? 'warn' : ''}">C ${pct(probs.C)}</span></div>
    <div>Bisher: ${Object.entries(game.totals.classes).map(([k, n]) => `${n}× ${k}`).join(', ')}</div>
    <label><input type="checkbox" id="chk-oc" ${game.overclock ? 'checked' : ''}> Übertakten (+${Math.round((P.overclockFactor - 1) * 100)}% Durchsatz, Anlage schwitzt)</label>`;
  $('chk-oc').onchange = (e) => { game.overclock = e.target.checked; renderPlant(); };
}

function showOverlay(html) { const o = $('overlay'); o.innerHTML = `<div>${html}</div>`; o.classList.add('show'); }
function hideOverlay() { $('overlay').classList.remove('show'); }

let toastTimer = 0;
function toast(text, kind = 'info') {
  $('toast').innerHTML = `<span class="${kind}"></span>`;
  $('toast').firstChild.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').innerHTML = ''; }, 4500);
}

// Canvas-Grösse und Bedienelemente an die aktive Instanz anpassen (Karte / Querschnitt / Drohne)
function currentMode() { return drone ? 'drone' : sim ? sim.mode : 'map'; }
function syncMode() {
  const mode = currentMode();
  const size = mode === 'slice' ? 'slice' : 'map';
  if (size !== shownMode) { size === 'slice' ? sizeSlice(canvas) : sizeMap(canvas, game.lake); shownMode = size; }
  $('shift-hud').hidden = mode === 'map' && !sim;
  $('shift-actions').hidden = !sim;
  $('btn-anchor').hidden = mode !== 'map'; $('btn-leave').hidden = mode !== 'slice';
  $('s-mode').textContent = { map: 'Karte', slice: 'Querschnitt', drone: 'Drohne' }[mode];
  if (mode !== 'slice') { $('btn-auto').hidden = true; $('btn-fix').hidden = true; }
}
function anchor() { if (sim?.anchor()) syncMode(); }
function leave() { if (sim?.leave()) syncMode(); }
function toggleAuto() { sim?.toggleAuto(); }
function fixAuto() { sim?.fixAuto(); }

function startShift() {
  hideOverlay();
  sim = game.startShift();
  syncMode();
  renderPanel();
}

function gameOver() {
  showOverlay(`<h2>${game.status === 'won' ? 'See saniert und abgenommen!' : 'Projekt gescheitert'}</h2>
    <p>Punkte: ${game.score.toLocaleString('de-CH')}<br>Abgesaugt: ${game.totals.removed.toFixed(0)} m³<br>
    Chargen: ${Object.entries(game.totals.classes).map(([k, n]) => `${n}× ${k}`).join(', ')}</p>
    <button class="primary" id="btn-restart">Neues Spiel</button>`);
  $('btn-restart').onclick = restart;
}

function endShift() {
  const r = game.finishShift(sim);
  sim = null;
  syncMode();
  renderPanel();
  if (game.status !== 'playing') return gameOver();
  showOverlay(`<h2>Schicht beendet</h2>
    <p>${r.removed.toFixed(1)} m³ abgesaugt (davon ${r.toxicRemoved.toFixed(1)} m³ Altlasten)<br>
    +${r.points} Punkte · Der Schlamm wartet im Puffer auf die Anlage
    ${r.clogs ? `<br>${r.clogs}× Pumpe verstopft` : ''}${r.overdug > 0.5 ? `<br>${r.overdug.toFixed(0)} m³ zu tief abgetragen, −${chf(r.overCost)}` : ''}${r.tips ? `<br>${r.tips}× Pumpe umgekippt, Bergung −${chf(r.repairs)}` : ''}${r.fines ? `<br>Busse −${chf(r.fines)}` : ''}</p>
    <button class="primary" id="btn-ok">Weiter</button>`);
  $('btn-ok').onclick = hideOverlay;
}

function startDrone() {
  hideOverlay();
  drone = game.startDrone();
  syncMode();
  renderPanel();
}

function endDrone() {
  const r = game.finishDrone(drone);
  drone = null;
  syncMode();
  renderPanel();
  if (game.status !== 'playing') return gameOver();
  showOverlay(`<h2>Drohne zurück</h2>
    <p>${r.accepted} Zellen neu abgenommen<br>${r.flagged ? `${r.flagged} Zellen mit Restschmutz: Nachbesserung nötig (rot markiert)` : 'Nichts zu beanstanden.'}<br>
    Abgenommen: ${(game.lake.acceptedFraction() * 100).toFixed(0)}% (Ziel ${CONFIG.drone.winAcceptFraction * 100}%)</p>
    <button class="primary" id="btn-ok">Weiter</button>`);
  $('btn-ok').onclick = hideOverlay;
}

function restart() { game = new Game(); sizeMap(canvas, game.lake); shownMode = 'map'; hideOverlay(); renderPanel(); }

$('btn-start').onclick = startShift;
$('btn-drone').onclick = startDrone;
$('btn-anchor').onclick = anchor;
$('btn-leave').onclick = leave;
$('btn-auto').onclick = toggleAuto;
$('btn-fix').onclick = fixAuto;
$('btn-wait').onclick = () => { game.advanceDays(1); renderPanel(); if (game.status !== 'playing') gameOver(); };

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (drone) {
    drone.update(dt, readInput.read({ x: drone.x * CELL, y: drone.y * CELL }, { holdToMove: true }));
    $('s-time').textContent = `${Math.ceil(drone.timeLeft)}s`;
    $('s-removed').textContent = `${drone.newlyAccepted} abgenommen · ${drone.newlyFlagged} Restschmutz`;
    $('s-turb').value = 0; $('s-tilt').value = 0;
    if (drone.over) endDrone();
  } else if (sim) {
    const inMap = sim.mode === 'map';
    const cur = inMap ? { x: sim.x * CELL, y: sim.y * CELL } : sliceHeadScreen(sim.slice);
    const inp = readInput.read(cur, { holdToMove: true });
    if (inMap) {
      inp.suction = false; // in der Karte wird nicht gesaugt
      if (readInput.tap('Space', 'Enter', 'KeyE')) anchor();
    } else {
      if (readInput.tap('Escape', 'KeyQ')) leave();
      if (readInput.tap('KeyT')) toggleAuto();
      if (readInput.tap('KeyR')) fixAuto();
    }
    sim.update(dt, inp);
    for (const n of sim.notes.splice(0)) toast(n.text, n.kind);
    if (sim.mode === 'slice') {
      const sl = sim.slice;
      $('btn-auto').hidden = sim.stats.autoLevel <= 0;
      $('btn-auto').textContent = sl.auto.on ? '🤖 Automatik aus (T)' : '🤖 Automatik an (T)';
      $('btn-fix').hidden = !sl.auto.error;
    }
    $('s-time').textContent = `${Math.ceil(sim.timeLeft)}s`;
    $('s-removed').textContent = `${sim.removed.toFixed(1)} m³${sim.overdug > 0.5 ? ` (zu tief: ${sim.overdug.toFixed(0)})` : ''}${sim.bufferFull ? ' – Puffer voll, Pumpe pausiert!' : ''}`;
    $('s-turb').value = sim.turbidity;
    $('s-tilt').value = sim.mode === 'slice' ? sim.slice.tilt : 0;
    if (sim.over) endShift();
  }
  readInput.endFrame();
  if (!drone && sim && sim.mode === 'slice') drawSlice(ctx, game.lake, sim);
  else { drawMap(ctx, game.lake, drone ? null : sim); if (drone) drawDrone(ctx, drone); }
  requestAnimationFrame(frame);
}
renderPanel();
showOverlay(`<h2>Seesanierung Uetikon</h2>
  <p>Fahre auf der <b>Karte</b> mit dem Ponton (WASD / Pfeile, Maus gedrückt) an eine Stelle und wirf den Anker (<b>E</b> / Leertaste).
  Im <b>Querschnitt</b> hängt die Pumpe an einer Kette am Ponton: A/D fährt sie seitlich, W/S zieht sie hoch oder lässt sie runter (immer nur eine Achse). Ohne Eingabe schwebt sie, wo du sie gelassen hast. Der Einsaugbereich liegt unten rechts von der Pumpe, deshalb saugt sie mit gehaltener <b>Leertaste</b> / Mausklick nur nach rechts. Gräbst du zu tief, kippt sie um: bei Schieflage die Kette hochziehen.
  Der Rückweg saugt nicht, ist dafür schneller. <b>Q</b> zurück zur Karte, <b>T</b> Automatik, <b>R</b> Automatik-Reset.</p>
  <p>Schraffierte Zellen sind hart: dort brauchst du mehrere Überfahrten. Weisse Punkte sind Fremdstoffe, die die Pumpe verstopfen (Kopf anheben und drüber fahren hilft).
  Rot = Altlasten. Die belastete Schicht ist überall genau 1 m dick (braun, gelb gestrichelt = Sollsohle); wer tiefer saugt, trägt sauberen Untergrund ab und zahlt dafür (orange auf der Karte). Zu viel Trübung gibt Bussen. Alle ${CONFIG.trancheEveryDays} Tage kommt eine Tranche.
  Zum Schluss nimmt die <b>Tauchdrohne</b> den Seegrund ab, erst dann gilt der See als saniert.</p>
  <button class="primary" id="btn-go">Los</button>`);
$('btn-go').onclick = hideOverlay;
requestAnimationFrame(frame);
globalThis.__dbg = () => ({ game, sim, drone }); // nur für Browser-Tests
