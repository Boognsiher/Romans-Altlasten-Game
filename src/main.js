import { CONFIG, UPGRADES } from './config.js';
import { Game } from './sim/game.js';
import { classProbabilities } from './sim/plant.js';
import { createInput } from './ui/input.js';
import { CELL, drawDrone, drawMap, drawSlice, sizeMap, sizeSlice, sliceHeadScreen } from './ui/render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;
const pct = (v) => `${Math.round(v * 100)}%`;

// Rekord (bestes Endergebnis) im Browser merken; funktioniert auch ohne Speicher
const BEST_KEY = 'altlasten.best';
const loadBest = () => { try { const v = localStorage.getItem(BEST_KEY); return v === null ? null : Number(v); } catch { return null; } };
const saveBest = (v) => { try { localStorage.setItem(BEST_KEY, String(v)); } catch { /* egal */ } };

let game = new Game();
let sim = game.createSession(); // Ponton (Karte/Querschnitt), läuft immer
let drone = null; // aktiver Drohnenflug, sonst null
let paused = false;
let endShown = false;
const readInput = createInput(canvas);
sizeMap(canvas, game.lake);
let shownSize = 'map';

// ---------- Panel (einmal aufgebaut, danach nur aktualisiert: Klicks gehen nie verloren) ----------
const upRows = {};
const groups = { plant: 'Anlage ausbauen', ponton: 'Ponton ausrüsten', drone: 'Abnahme' };
function buildUpgrades() {
  const nodes = [];
  for (const [g, title] of Object.entries(groups)) {
    const h = document.createElement('h3'); h.textContent = title; nodes.push(h);
    for (const [id, def] of Object.entries(UPGRADES).filter(([, d]) => d.group === g)) {
      const row = document.createElement('div'); row.className = 'up';
      const label = document.createElement('div');
      const small = document.createElement('small');
      label.append(def.name + ' ', small);
      const btn = document.createElement('button');
      btn.onclick = () => { if (game.buyUpgrade(id)) { sim.setStats(game.stats); updatePanel(); } };
      row.append(label, btn);
      upRows[id] = { small, btn };
      nodes.push(row);
    }
  }
  $('upgrades').replaceChildren(...nodes);
}

function updateUpgrades() {
  for (const [id, def] of Object.entries(UPGRADES)) {
    const cost = game.nextUpgradeCost(id), r = upRows[id];
    r.small.textContent = `Stufe ${game.levels[id]}/${def.maxLevel} · ${def.desc}`;
    r.btn.textContent = cost === null ? 'Max' : chf(cost);
    r.btn.disabled = cost === null || game.money < cost || game.status !== 'playing';
  }
}

function updatePlant() {
  const st = game.stats, P = CONFIG.plant, oc = game.overclock;
  const probs = classProbabilities(game.stockTotal ? game.stock.toxic / game.stockTotal : 0, oc);
  $('p-stock').textContent = game.stockTotal.toFixed(0);
  $('p-cap').textContent = st.bufferCapacity;
  $('p-prog').max = st.bufferCapacity; $('p-prog').value = game.stockTotal;
  $('p-thru').textContent = (st.plantCapacity * (oc ? P.overclockFactor : 1)).toFixed(2);
  $('p-dew').textContent = pct(st.dewater);
  $('p-lotto').innerHTML = `B ${pct(probs.B)} · E ${pct(probs.E)} · <span class="${probs.C > 0.2 ? 'warn' : ''}">C ${pct(probs.C)}</span>`;
  $('p-classes').textContent = Object.entries(game.totals.classes).map(([k, n]) => `${n}× ${k}`).join(', ');
  $('p-oc').textContent = `Übertakten (+${Math.round((P.overclockFactor - 1) * 100)}% Durchsatz, Anlage schwitzt)`;
  $('chk-oc').checked = game.overclock;
}

let logSig = '';
function updateLog() {
  const sig = `${game.log.length}|${game.log[0]?.text}`;
  if (sig === logSig) return;
  logSig = sig;
  $('log').replaceChildren(...game.log.map((e) => {
    const li = document.createElement('li'); li.className = e.kind;
    li.textContent = `Tag ${e.day}: ${e.text}`; return li;
  }));
}

function updateHud() {
  const left = game.timeLeft, mm = Math.floor(left / 60), ss = String(Math.floor(left % 60)).padStart(2, '0');
  $('h-day').textContent = `${Math.min(game.day, CONFIG.deadlineDays)}/${CONFIG.deadlineDays}`;
  $('h-left').textContent = `(${mm}:${ss})`;
  $('h-money').textContent = chf(game.money);
  $('h-money').style.color = game.money < 0 ? 'var(--bad)' : '';
  $('h-income').textContent = `+${CONFIG.incomePerSec} CHF/s`;
  $('h-clean').textContent = `${(game.lake.cleanFraction() * 100).toFixed(1)}%`;
  $('h-acc').textContent = `${(game.lake.acceptedFraction() * 100).toFixed(0)}%`;
  const best = loadBest();
  $('h-best').textContent = best === null ? '–' : chf(best);
}

function updatePanel() { updateUpgrades(); updatePlant(); updateLog(); $('btn-drone').textContent = `Drohne tauchen lassen (${chf(CONFIG.drone.fee)})`; }

// ---------- Overlay, Toast ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = `<div>${html}</div>`; o.classList.add('show'); }
function hideOverlay() { $('overlay').classList.remove('show'); }
const overlayOpen = () => $('overlay').classList.contains('show');

let toastTimer = 0;
function toast(text, kind = 'info') {
  $('toast').innerHTML = `<span class="${kind}"></span>`;
  $('toast').firstChild.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').innerHTML = ''; }, 4500);
}

// ---------- Modus: Karte / Querschnitt / Drohne ----------
const currentMode = () => (drone ? 'drone' : sim.mode);
function syncMode() {
  const mode = currentMode();
  const size = mode === 'slice' ? 'slice' : 'map';
  if (size !== shownSize) { size === 'slice' ? sizeSlice(canvas) : sizeMap(canvas, game.lake); shownSize = size; }
  $('shift-hud').hidden = false;
  $('shift-actions').hidden = mode === 'drone';
  $('btn-anchor').hidden = mode !== 'map'; $('btn-leave').hidden = mode !== 'slice';
  $('s-mode').textContent = { map: 'Karte', slice: 'Querschnitt', drone: 'Drohne' }[mode];
  if (mode !== 'slice') { $('btn-auto').hidden = true; $('btn-fix').hidden = true; $('cut-box').hidden = true; }
  $('btn-drone').disabled = mode !== 'map';
}
function anchor() { if (!drone && sim.anchor()) syncMode(); }
function leave() { if (!drone && sim.leave()) syncMode(); }
function toggleAuto() { if (!drone) sim.toggleAuto(); }
function fixAuto() { if (!drone) sim.fixAuto(); }
function setCut(v) {
  sim.setCutDepth(v);
  game.cutDepth = sim.cutDepth;
  $('cut').value = sim.cutDepth; $('cut-val').textContent = `${sim.cutDepth.toFixed(2)} m`;
}
function togglePause() { paused = !paused; $('btn-pause').textContent = paused ? '▶ Weiter (P)' : '⏸ Pause (P)'; }

function startDrone() {
  if (sim.mode !== 'map' || drone) return;
  drone = game.startDrone();
  syncMode();
}
function endDrone() {
  const r = game.finishDrone(drone);
  drone = null;
  syncMode();
  toast(r.flagged ? `Drohne: ${r.accepted} Zellen abgenommen, ${r.flagged} mit Restschmutz (rot markiert)` : `Drohne: ${r.accepted} Zellen abgenommen, nichts zu beanstanden`, r.flagged ? 'bad' : 'good');
}

// ---------- Spielende ----------
function showEnd() {
  endShown = true;
  const e = game.end, t = game.totals, best = loadBest();
  const record = e.finalMoney > 0 && (best === null || e.finalMoney > best); // nur positive Endstände zählen als Rekord
  if (record) saveBest(e.finalMoney);
  const title = { early: 'See saniert und abgenommen!', deadline: 'Frist abgelaufen', bankrupt: 'Projekt gestoppt' }[e.reason];
  showOverlay(`<h2>${title}</h2>
    <p>Endstand: <b>${chf(e.finalMoney)}</b>${record ? ' <b class="good">Neuer Rekord!</b>' : best !== null ? `<br><small>Rekord: ${chf(best)}</small>` : ''}</p>
    <p><small>${e.bonus ? `Restfinanzierung +${chf(e.bonus)}<br>` : ''}${e.external ? `Fremdfirma für den Rest −${chf(e.external)}<br>` : ''}
    Abgesaugt ${t.removed.toFixed(0)} m³ · Chargen ${Object.entries(t.classes).map(([k, n]) => `${n}× ${k}`).join(', ')}<br>
    Entsorgung ${chf(t.disposalPaid)} · Bussen ${chf(t.finesPaid)} · Bergungen ${chf(t.repairsPaid)} · Übertiefung ${chf(t.overdigPaid)}</small></p>
    <p>Gewonnen hat, wer am Ende am meisten Geld hat.</p>
    <button class="primary" id="btn-restart">Neues Spiel</button>`);
  $('btn-restart').onclick = restart;
}

function restart() {
  game = new Game(); sim = game.createSession(); drone = null; paused = false; endShown = false;
  $('btn-pause').textContent = '⏸ Pause (P)';
  sizeMap(canvas, game.lake); shownSize = 'map';
  hideOverlay(); syncMode(); updatePanel();
}

$('btn-drone').onclick = startDrone;
$('btn-pause').onclick = togglePause;
$('btn-anchor').onclick = anchor;
$('btn-leave').onclick = leave;
$('btn-auto').onclick = toggleAuto;
$('btn-fix').onclick = fixAuto;
$('cut').oninput = (e) => setCut(parseFloat(e.target.value));
$('chk-oc').onchange = (e) => { game.overclock = e.target.checked; updatePlant(); };

// ---------- Hauptschleife ----------
let last = performance.now(), panelTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (readInput.tap('KeyP')) togglePause();
  const running = !paused && !overlayOpen() && game.status === 'playing';

  if (running) {
    if (drone) {
      drone.update(dt, readInput.read({ x: drone.x * CELL, y: drone.y * CELL }, { holdToMove: true }));
      $('s-removed').textContent = `Akku ${Math.ceil(drone.timeLeft)}s · ${drone.newlyAccepted} abgenommen · ${drone.newlyFlagged} Restschmutz`;
      $('s-turb').value = 0; $('s-tilt').value = 0;
      if (drone.over) endDrone();
    } else {
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
        if (sim.stats.echolot > 0) {
          if (readInput.tap('KeyF')) setCut(sim.cutDepth - 0.05);
          if (readInput.tap('KeyG')) setCut(sim.cutDepth + 0.05);
        }
      }
      sim.bufferRoom = game.bufferRoom;
      game.collect(sim.update(dt, inp));
      for (const n of sim.notes.splice(0)) toast(n.text, n.kind);
      if (sim.mode === 'slice') {
        const sl = sim.slice;
        $('btn-auto').hidden = sim.stats.autoLevel <= 0;
        $('btn-auto').textContent = sl.auto.on ? '🤖 Automatik aus (T)' : '🤖 Automatik an (T)';
        $('btn-fix').hidden = !sl.auto.error;
        $('cut-box').hidden = sim.stats.echolot <= 0;
        if (document.activeElement !== $('cut')) { $('cut').value = sim.cutDepth; $('cut-val').textContent = `${sim.cutDepth.toFixed(2)} m`; }
      }
      $('s-removed').textContent = `${game.totals.removed.toFixed(0)} m³ abgesaugt${sim.overdug > 0.5 ? ` (zu tief: ${sim.overdug.toFixed(0)})` : ''}${sim.bufferFull ? ' · Puffer voll, Pumpe pausiert!' : ''}`;
      $('s-turb').value = sim.turbidity;
      $('s-tilt').value = sim.mode === 'slice' ? sim.slice.tilt : 0;
    }
    game.update(dt);
  }
  readInput.endFrame();

  panelTimer += dt;
  if (panelTimer > 0.25) { panelTimer = 0; updatePanel(); }
  updateHud();
  if (game.status === 'ended' && !endShown) { updatePanel(); showEnd(); }

  if (!drone && sim.mode === 'slice') drawSlice(ctx, game.lake, sim);
  else { drawMap(ctx, game.lake, drone ? null : sim); if (drone) drawDrone(ctx, drone); }
  requestAnimationFrame(frame);
}

buildUpgrades();
syncMode();
updatePanel();
showOverlay(`<h2>Seesanierung Uetikon</h2>
  <p>Das Spiel läuft in <b>Echtzeit</b>: Jede Sekunde kommen ${CONFIG.incomePerSec} CHF Finanzierung herein, alles andere kostet. In ${CONFIG.deadlineDays} Tagen (${Math.round(CONFIG.deadlineDays * CONFIG.daySeconds / 60)} Minuten) ist Schluss:
  was dann noch im See liegt, saniert eine Fremdfirma zum Notfalltarif. <b>Gewonnen hat, wer am Ende am meisten Geld hat.</b></p>
  <p>Fahre auf der <b>Karte</b> mit dem Ponton (WASD / Pfeile, Maus gedrückt) an eine Stelle und wirf den Anker (<b>E</b> / Leertaste).
  Im <b>Querschnitt</b> hängt die Pumpe an einer Kette am Ponton: A/D fährt sie seitlich, W/S zieht sie hoch oder lässt sie runter (immer nur eine Achse). Ohne Eingabe schwebt sie.
  Der Einsaugbereich liegt unten rechts, deshalb saugt sie mit gehaltener <b>Leertaste</b> / Mausklick nur nach rechts. Gräbst du zu tief, kippt sie um.
  <b>Q</b> zurück zur Karte, <b>T</b> Automatik, <b>R</b> Automatik-Reset, <b>P</b> Pause. Mit dem <b>Echolot</b> fährt die Automatik die eingestellte Abtragsdicke an (Regler oder F/G).</p>
  <p>Schraffierte Zellen sind hart: mehrere Überfahrten. Weisse Punkte sind Fremdstoffe, die die Pumpe verstopfen (Kopf anheben hilft). Rot = Altlasten.
  Die belastete Schicht ist überall 1 m dick (braun, gelb gestrichelt = Sollsohle); wer tiefer saugt, zahlt dafür (orange auf der Karte). Zum Schluss nimmt die <b>Tauchdrohne</b> den Seegrund ab.</p>
  <button class="primary" id="btn-go">Los</button>`);
$('btn-go').onclick = hideOverlay;
requestAnimationFrame(frame);
globalThis.__dbg = () => ({ game, sim, drone }); // nur für Browser-Tests
