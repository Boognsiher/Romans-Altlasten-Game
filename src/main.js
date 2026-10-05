import { LEVELS, levelById, CONFIG, UPGRADES } from './config.js';
import { Game } from './sim/game.js';
import { classProbabilities } from './sim/plant.js';
import { acceptChance, claimedAmount } from './sim/claims.js';
import { createInput } from './ui/input.js';
import { setupTouch } from './ui/touch.js';
import { steerToward } from './ui/touch-logic.js';
import { fitSize, renderQuality } from './ui/layout.js';
import { hintsFor } from './ui/hints.js';
import { Fx } from './ui/fx.js';
import { checkPassword } from './ui/gate.js';
import { createAudio } from './ui/audio.js';
import { serializeGame, restoreGame, savedSummary } from './sim/save.js';
import { view, CELL, drawDroneView, drawMap, drawSlice, sizeMap, sizeSlice, sliceHeadScreen, sliceMouthScreen, sliceY } from './ui/render.js';

const $ = (id) => document.getElementById(id);
const canvas = $('canvas'), ctx = canvas.getContext('2d');
const chf = (n) => `${Math.round(n).toLocaleString('de-CH')} CHF`;
const pct = (v) => `${Math.round(v * 100)}%`;

// Rekord (bestes Endergebnis) im Browser merken; funktioniert auch ohne Speicher
const BEST_KEY = 'altlasten.best';
// Pro Level das beste Endergebnis ({ id: CHF }); der alte Einzelrekord zählt für Uetikon
const LEVELS_KEY = 'altlasten.levels';
const loadLevels = () => { try { const o = JSON.parse(localStorage.getItem(LEVELS_KEY) ?? '{}'); if (o.uetikon === undefined) { const v = localStorage.getItem(BEST_KEY); if (v !== null) o.uetikon = Number(v); } return o; } catch { return {}; } };
const loadBest = (id = game.levelId) => loadLevels()[id] ?? null;
const saveBest = (v, id = game.levelId) => { try { localStorage.setItem(LEVELS_KEY, JSON.stringify({ ...loadLevels(), [id]: v })); } catch { /* egal */ } };
const levelUnlocked = (i) => i === 0 || (loadLevels()[LEVELS[i - 1].id] ?? 0) > 0; // vorheriges Level mit Gewinn abgeschlossen

// Spielstand: automatisch bei jedem neuen Tag, alle 20 s, beim Pausieren und beim Verlassen der Seite
const SAVE_KEY = 'altlasten.save';
const readSave = () => { try { return localStorage.getItem(SAVE_KEY); } catch { return null; } };
const clearSave = () => { try { localStorage.removeItem(SAVE_KEY); } catch { /* egal */ } };
let saveClock = 0, savedDay = 0;
function saveGame() {
  if (game.status !== 'playing' || overlayOpen()) return; // solange das Startbild offen ist, bleibt der alte Stand unangetastet
  try { localStorage.setItem(SAVE_KEY, serializeGame(game)); savedDay = game.day; saveClock = 0; } catch { /* Speicher voll oder gesperrt: egal */ }
}

const fx = new Fx();
const audio = createAudio();
let game = new Game();
let sim = game.createSession(); // Ponton (Karte/Querschnitt), läuft immer
let drone = null; // aktiver Drohnenflug, sonst null
let paused = false;
let endShown = false;
const readInput = createInput(canvas);
sizeMap(canvas, game.lake);
let shownSize = 'map';
let mapTarget = null; // Ziel, das per Tippen auf die Karte gesetzt wurde (Zellen): dorthin fahren und Anker werfen
let sheetOpen = false; // Shop als Bottom-Sheet auf schmalen Bildschirmen: offen = Spiel pausiert
const narrow = () => matchMedia('(max-width: 860px)').matches;
const isTouch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

// ---------- Panel (einmal aufgebaut, danach nur aktualisiert: Klicks gehen nie verloren) ----------
const upRows = {};
const groups = { plant: 'Anlage ausbauen', ponton: 'Ponton ausrüsten', office: 'Büro & Nachträge', drone: 'Abnahme' };
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
      btn.onclick = () => { if (game.buyUpgrade(id)) { applyStats(); updatePanel(); } };
      const sell = document.createElement('button'); // Rückbau: zweiter Tipp bestätigt
      sell.className = 'sell';
      let armed = 0;
      sell.onclick = () => {
        if (!armed) { armed = setTimeout(() => { armed = 0; updateUpgrades(); }, 3000); sell.textContent = 'Sicher?'; return; }
        clearTimeout(armed); armed = 0;
        if (game.sellUpgrade(id)) { applyStats(); updatePanel(); }
      };
      const btns = document.createElement('div'); btns.className = 'upbtns'; btns.append(sell, btn);
      row.append(label, btns);
      upRows[id] = { small, btn, sell, armed: () => armed };
      nodes.push(row);
    }
  }
  $('upgrades').replaceChildren(...nodes);
}

// Nach Kauf oder Rückbau: neue Werte an den Ponton, Abhängiges abschalten
function applyStats() {
  sim.setStats(game.stats);
  if (sim.mode === 'slice' && game.stats.autoLevel <= 0 && sim.slice.auto.on) { sim.slice.auto.on = false; sim.slice.auto.error = null; }
}

function updateUpgrades() {
  for (const [id, def] of Object.entries(UPGRADES)) {
    const cost = game.nextUpgradeCost(id), r = upRows[id];
    r.small.textContent = `Stufe ${game.levels[id]}/${def.maxLevel} · ${def.desc}`;
    r.btn.textContent = cost === null ? 'Max' : chf(cost);
    r.btn.disabled = cost === null || game.money < cost || game.status !== 'playing';
    const refund = game.refundFor(id);
    if (!r.armed()) r.sell.textContent = '↩';
    if (refund !== null) r.small.textContent += ` · Rückbau +${chf(refund)}`;
    r.sell.disabled = refund === null || game.status !== 'playing';
    r.sell.title = `Rückbau: ${Math.round(CONFIG.refundShare * 100)}% der Investition kommen zurück`;
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

// ---------- Nachträge ----------
let certSig = null;
function certHtml(c) {
  const when = (c.x0 + 1) + '–' + (c.x0 + c.cols), rows = (c.r0 + 1) + '–' + (c.r0 + c.rows);
  return `<div class="cert grade-${c.grade}">
    <div class="cert-seal">${c.grade === 'Gold' ? '🥇' : c.grade === 'Silber' ? '🥈' : '🥉'}</div>
    <small>Kantonales Amt für Seeputz (frei erfunden)</small>
    <h2>Abnahmezertifikat</h2>
    <p class="serial">Nr. ${c.serial} · ausgestellt an Tag ${c.day}</p>
    <p>Für den Kasten <b>Spalten ${when}, Zeilen ${rows}</b> (${c.cells} bestellte Zellen) wird bestätigt:<br>
    <b>${Math.round(c.fraction * 100)} %</b> der Zellen sind laut Tauchdrohne sauber abgetragen.</p>
    <p class="gradeline">Güteklasse <b>${c.grade}</b> · Prämie bei Freigabe <b>${chf(c.premium)}</b></p>
    <p class="sign">gez. die Drohne <i>(Unterschrift: Blubb)</i></p>
  </div>`;
}
function showCert(c) {
  const open = c.status === 'issued';
  showOverlay(`${certHtml(c)}
    ${open ? `<button class="primary" id="cert-submit">Beim Kanton einreichen (−${CONFIG.cert.fee} CHF, ${CONFIG.cert.days} Tage Bearbeitung)</button>` : `<p><small>${c.status === 'submitted' ? 'Eingereicht, der Kanton prüft noch.' : 'Freigegeben und ausbezahlt.'}</small></p>`}
    <button id="cert-close">${open ? 'Später' : 'Schliessen'}</button>`);
  if (open) $('cert-submit').onclick = () => { if (game.submitCert(c.id)) { hideOverlay(); updatePanel(); toast(`${c.serial} eingereicht`, 'good'); } else toast('Zu wenig Geld für die Gebühr', 'bad'); };
  $('cert-close').onclick = hideOverlay;
}
function updateCerts() {
  const sig = game.certs.map((c) => `${c.id}:${c.status}`).join(',');
  const days = (t) => Math.max(0, Math.ceil((t - game.time) / CONFIG.daySeconds));
  if (sig !== certSig) {
    certSig = sig;
    const rows = game.certs.map((c) => {
      const row = document.createElement('div'); row.className = `claim ${c.status}`;
      const title = document.createElement('b'); title.textContent = `${c.serial} · ${c.grade} · ${Math.round(c.fraction * 100)} %`;
      const info = document.createElement('small'); info.dataset.cert = c.id;
      const line = document.createElement('div'); line.className = 'row';
      const view = document.createElement('button'); view.textContent = 'Ansehen'; view.onclick = () => showCert(c);
      line.append(view);
      if (c.status === 'issued') { const go = document.createElement('button'); go.textContent = `Einreichen (−${CONFIG.cert.fee} CHF)`; go.onclick = () => { if (game.submitCert(c.id)) updatePanel(); }; line.append(go); }
      row.append(title, info, line);
      return row;
    });
    if (!rows.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = `Wenn die Drohne in einem Kasten ${Math.round(CONFIG.cert.minFraction * 100)} % der Zellen abnimmt, gibt es ein Zertifikat für den Kanton. Bessere Qualität = höhere Prämie.`; rows.push(e); }
    $('certs').replaceChildren(...rows);
  }
  for (const c of game.certs) {
    const el = document.querySelector(`[data-cert="${c.id}"]`); if (!el) continue;
    el.textContent = c.status === 'issued' ? `Prämie bei Freigabe ${chf(c.premium)} · noch nicht eingereicht`
      : c.status === 'submitted' ? `Beim Kanton, Freigabe in ${days(c.approveAt)} Tagen (Prämie ${chf(c.premium)})` : `Freigegeben, Prämie ${chf(c.premium)} erhalten`;
  }
}
let claimSig = null; // null = noch nie aufgebaut
const claimRefs = {};
function updateClaims() {
  updateCerts();
  const sig = game.claims.map((c) => `${c.id}:${c.status}`).join(',');
  const days = (t) => Math.max(0, Math.ceil((t - game.time) / CONFIG.daySeconds));
  if (sig !== claimSig) { // nur neu aufbauen, wenn sich die Liste ändert (Regler bleiben beim Ziehen stabil)
    claimSig = sig;
    for (const k of Object.keys(claimRefs)) delete claimRefs[k];
    const rows = game.claims.map((c) => {
      const row = document.createElement('div'); row.className = `claim ${c.status}`;
      const title = document.createElement('b'); title.textContent = c.text;
      const info = document.createElement('small');
      const line = document.createElement('div'); line.className = 'row';
      const amt = document.createElement('span'); amt.className = 'amt';
      const refs = { info, amt };
      if (c.status === 'draft') {
        const slider = document.createElement('input');
        slider.type = 'range'; slider.min = CONFIG.claims.minMarkup; slider.max = CONFIG.claims.maxMarkup; slider.step = 0.05; slider.value = c.markup;
        slider.oninput = () => { game.setClaimMarkup(c.id, parseFloat(slider.value)); updateClaims(); };
        const btn = document.createElement('button');
        btn.textContent = `Einreichen (−${CONFIG.claims.fee} CHF)`;
        btn.onclick = () => { game.submitClaim(c.id); updatePanel(); };
        line.append(slider, amt, btn);
      } else line.append(amt);
      row.append(title, info, line);
      claimRefs[c.id] = refs;
      return row;
    });
    if (!rows.length) {
      const e = document.createElement('div'); e.className = 'empty';
      e.textContent = 'Noch nichts Abrechenbares. Fremdstoffe, harte Schichten und Fässer lassen sich beim Bauherrn als Zusatzleistung verrechnen.';
      rows.push(e);
    }
    $('claims').replaceChildren(...rows);
  }
  for (const c of game.claims) {
    const r = claimRefs[c.id]; if (!r) continue;
    if (c.status === 'draft') {
      const chance = acceptChance(c.markup, game.stats.docBonus);
      r.info.textContent = `Aufwand ${chf(c.fair)} · läuft ab in ${days(c.expiresAt)} Tagen`;
      r.amt.textContent = `Forderung ${chf(claimedAmount(c.fair, c.markup))} · Chance ${pct(chance)}`;
    } else {
      r.info.textContent = `Der Bauherr prüft … noch ${days(c.resolveAt)} Tage`;
      r.amt.textContent = `Forderung ${chf(c.claimed)}`;
    }
  }
  const open = game.openClaims + game.finds.filter((f) => f.status === 'found').length + game.jobs.filter((j) => j.status === 'offer').length;
  $('panel-handle').textContent = (sheetOpen ? '▼ Schliessen (Spiel pausiert)' : '▲ Anlage & Ausrüstung') + (open ? ` · ${open} offen` : '');
}

// ---------- Funde und Zusatzaufträge ----------
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const emptyNote = (text) => mk('div', 'empty', text);
const daysLeft = (t) => Math.max(0, Math.ceil((t - game.time) / CONFIG.daySeconds));
let findSig = null, jobSig = null;
const findRefs = {}, jobRefs = {};

function updateFinds() {
  const sig = game.finds.map((f) => `${f.id}:${f.status}`).join(',');
  if (sig !== findSig) {
    findSig = sig;
    for (const k of Object.keys(findRefs)) delete findRefs[k];
    const rows = game.finds.map((f) => {
      const row = mk('div', `claim ${f.status}`), info = mk('small'), line = mk('div', 'row');
      if (f.status === 'found') {
        const btn = mk('button', '', `Bergen lassen (−${chf(f.fee)})`);
        btn.onclick = () => { game.recoverFind(f.id); updatePanel(); };
        line.append(btn);
      }
      row.append(mk('b', '', f.name), info, line);
      findRefs[f.id] = { info };
      return row;
    });
    $('finds').replaceChildren(...(rows.length ? rows : [emptyNote('Noch nichts gefunden. Die Tauchdrohne entdeckt Fossilien im Untergrund; das Museum zahlt für die Bergung. Wer zu tief saugt, zerstört sie.')]));
  }
  for (const f of game.finds) {
    const r = findRefs[f.id]; if (!r) continue;
    r.info.textContent = f.status === 'found' ? `Museum zahlt etwa ${chf(f.value)} · Bergung ${chf(f.fee)}` : `Wird geborgen … Museum meldet sich in ${daysLeft(f.sellAt)} Tagen`;
  }
}

function updateJobs() {
  const sig = game.jobs.map((j) => `${j.id}:${j.status}`).join(',');
  if (sig !== jobSig) {
    jobSig = sig;
    for (const k of Object.keys(jobRefs)) delete jobRefs[k];
    const rows = game.jobs.map((j) => {
      const row = mk('div', `claim ${j.status}`), info = mk('small'), line = mk('div', 'row');
      if (j.status === 'offer') {
        const yes = mk('button', 'primary', 'Annehmen'), no = mk('button', '', 'Ablehnen');
        yes.onclick = () => { game.acceptJob(j.id); updatePanel(); };
        no.onclick = () => { game.declineJob(j.id); updatePanel(); };
        line.append(yes, no);
      }
      row.append(mk('b', '', `Gemeinde: Bereich „${j.place}“ (Prämie ${chf(j.bonus)})`), info, line);
      jobRefs[j.id] = { info };
      return row;
    });
    $('jobs').replaceChildren(...(rows.length ? rows : [emptyNote('Gerade keine Anfragen. Die Gemeinde meldet sich, wenn sie einen Uferbereich zum Termin sauber haben will.')]));
  }
  for (const j of game.jobs) {
    const r = jobRefs[j.id]; if (!r) continue;
    const p = j.progress, J = CONFIG.jobs;
    r.info.textContent = j.status === 'offer'
      ? `Zone auf der Karte gelb markiert · ca. ${Math.round(p.volume)} m³ Rest · Angebot gilt noch ${daysLeft(j.offerExpiresAt)} Tage · dann ${J.dueDays} Tage Zeit`
      : `Termin in ${daysLeft(j.dueAt)} Tagen · sauber ${pct(p.cleaned)} (nötig ${pct(J.cleanNeeded)}) · abgenommen ${pct(p.accepted)} (nötig ${pct(J.acceptedNeeded)})`;
  }
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
  $('h-day').textContent = `${Math.min(game.day, game.deadlineDays)}/${game.deadlineDays}`;
  $('h-left').textContent = `(${mm}:${ss})`;
  $('h-money').textContent = chf(game.money);
  $('h-money').style.color = game.money < 0 ? 'var(--bad)' : '';
  $('h-income').textContent = `(${game.perM3} CHF/m³)`;
  $('h-clean').textContent = `${(game.lake.cleanFraction() * 100).toFixed(1)}%`;
  $('h-acc').textContent = `${(game.lake.acceptedFraction() * 100).toFixed(0)}%`;
  const best = loadBest();
  $('h-best').textContent = best === null ? '–' : chf(best);
}

function updatePanel() { updateUpgrades(); updatePlant(); updateClaims(); updateFinds(); updateJobs(); updateLog(); $('btn-drone').textContent = `Drohne ausbringen (${chf(CONFIG.drone.fee)})`; }

// ---------- Overlay, Toast ----------
function showOverlay(html) { const o = $('overlay'); o.innerHTML = `<div>${html}</div>`; o.classList.add('show'); }
function hideOverlay() { $('overlay').classList.remove('show'); }
const overlayOpen = () => $('overlay').classList.contains('show');

let toastTimer = 0;
// Meldungen unten im Bild: oben liegen Statuszeile und Pumpe, dort würden sie verdeckt
function placeToast() {
  const t = $('toast');
  t.style.right = '8px'; t.style.top = `${Math.max(8, canvas.offsetTop + canvas.clientHeight - t.offsetHeight - 12)}px`;
}
function toast(text, kind = 'info') {
  $('toast').innerHTML = `<span class="${kind}"></span>`;
  $('toast').firstChild.textContent = text;
  placeToast();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').innerHTML = ''; }, 4500);
}

// ---------- Spielfeld einpassen und Steuerungsanzeige ----------
// Das Spielfeld füllt die verfügbare Fläche (Breite der Spalte, Höhe des Fensters abzüglich allem, was darunter im Fluss steht)
// und wird in passender Auflösung gerendert.
let zoom = 1, panX = 0;
const MAX_ZOOM = 1.7;
// Bei Zoom folgt der sichtbare Ausschnitt weich der Pumpe
let layoutSig = '';
function panCanvas(dt) {
  const sig = `${$('shift-actions').offsetHeight}/${$('touch-ui').offsetHeight}/${innerHeight}`; // Knöpfe erscheinen/verschwinden: Zoom neu rechnen
  if (sig !== layoutSig) { layoutSig = sig; fitCanvas(); }
  if (zoom <= 1) return;
  const stageW = $('stage').clientWidth, cw = canvas.getBoundingClientRect().width;
  const sl = sim.slice, fx = ((sl.x - sl.x0) / 16) * cw; // 16 = Spalten des Querschnitts
  const want = Math.min(Math.max(0, fx - stageW / 2), Math.max(0, cw - stageW));
  panX += (want - panX) * Math.min(1, dt * 6);
  canvas.style.marginLeft = `${-panX}px`;
}
function fitCanvas() {
  const lw = canvas.logicalW, lh = canvas.logicalH, stage = $('stage');
  if (!lw) return;
  let below = 0;
  for (const el of stage.children) {
    if (el === canvas || el.hidden) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.position !== 'static') continue; // schwebende Elemente zählen nicht
    below += el.offsetHeight + (el.id === 'touch-ui' ? 0 : parseFloat(cs.marginTop) + parseFloat(cs.marginBottom)); // touch-ui hat margin-top:auto (Restplatz), der zählt nicht
  }
  const docTop = canvas.getBoundingClientRect().top + scrollY;
  const availH = Math.max(narrow() ? 60 : 220, innerHeight - docTop - below - (narrow() ? 64 : 16));
  let { w, h } = fitSize(stage.clientWidth, availH, lw, lh);
  // Handy hochkant, Querschnitt: der freie Platz geht in einen Zoom; das Bild folgt der Pumpe seitlich (panCanvas)
  zoom = 1;
  if (!drone && sim.mode === 'slice' && narrow() && matchMedia('(orientation: portrait)').matches) {
    zoom = Math.min(MAX_ZOOM, Math.max(1, (innerHeight - docTop - below - 12) / h));
    w *= zoom; h *= zoom;
  }
  canvas.style.width = `${w}px`; canvas.style.height = `${h}px`;
  if (zoom === 1) canvas.style.marginLeft = '';
  const q = renderQuality(devicePixelRatio, w, lw);
  const cw = Math.round(lw * q), ch = Math.round(lh * q);
  if (canvas.width !== cw || canvas.height !== ch) { canvas.width = cw; canvas.height = ch; }
  canvas.q = cw / lw;
  view.s = w / lw; fx.view = view.s; // Schrift im Bild folgt dem Massstab
}

function updateHints() {
  const mode = currentMode(), box = $('hints');
  box.replaceChildren(...hintsFor(mode, isTouch).map(([key, what]) => {
    const item = document.createElement('span'), k = document.createElement('kbd');
    k.textContent = key; item.append(k, what);
    return item;
  }));
}

// ---------- Modus: Karte / Querschnitt / Drohne ----------
const currentMode = () => (drone ? 'drone' : sim.mode);
function syncMode() {
  const mode = currentMode();
  fx.clear(); audio.hum(false, 0);
  const size = mode === 'slice' || mode === 'drone' ? 'slice' : 'map';
  if (size !== shownSize) { size === 'slice' ? sizeSlice(canvas) : sizeMap(canvas, game.lake); shownSize = size; }
  $('shift-hud').hidden = false;
  $('shift-actions').hidden = false;
  $('btn-anchor').hidden = mode !== 'map'; $('btn-leave').hidden = mode !== 'slice';
  $('btn-drone2').hidden = mode !== 'slice'; $('btn-pump').hidden = mode !== 'slice'; $('btn-recall').hidden = mode !== 'drone';
  $('s-mode').textContent = { map: 'Karte', slice: 'Querschnitt', drone: 'Drohne' }[mode];
  if (mode !== 'slice') { $('btn-auto').hidden = true; $('btn-fix').hidden = true; $('cut-box').hidden = true; $('spd-box').hidden = true; }
  $('btn-drone').disabled = mode !== 'slice';
  updateHints(); fitCanvas();
}
function anchor() { if (!drone && sim.anchor()) syncMode(); }
function leave() { if (!drone && sim.leave()) syncMode(); }
function toggleAuto() { if (!drone) sim.toggleAuto(); }
function toggleSound() { audio.setMuted(!audio.muted); $('btn-sound').textContent = audio.muted ? '🔇 Ton aus (M)' : '🔊 Ton an (M)'; }
// Zeilenwahl: der Kasten hat mehrere Zeilen, jede wird einzeln gefahren
const rowChips = [];
function buildRows() {
  const box = $('row-box');
  const lab = document.createElement('span'); lab.textContent = 'Zeile'; box.append(lab);
  for (let k = 0; k < CONFIG.box.rows; k++) {
    const b = document.createElement('button'); b.className = 'rowchip'; b.textContent = String(k + 1);
    b.onclick = () => selectRow(k);
    rowChips.push(b); box.append(b);
  }
}
function selectRow(k) {
  if (drone || sim.mode !== 'slice' || !sim.slice.selectRow(k)) return;
  fx.clear(); toast(`Zeile ${sim.slice.ci + 1} von ${CONFIG.box.rows}`, 'info');
}
function updateRows() {
  if (sim.mode !== 'slice') return;
  const sl = sim.slice;
  rowChips.forEach((b, k) => {
    const st = sl.rowStatus(k), full = st.n * CONFIG.layer.thickness * game.lake.area, prog = full > 0 ? Math.max(0, Math.min(1, 1 - st.vol / full)) : 1;
    b.className = `rowchip${k === sl.ci ? ' on' : ''}${st.done ? ' done' : st.deep ? ' deep' : ''}`;
    b.style.setProperty('--p', `${Math.round(prog * 100)}%`);
    b.title = st.done ? 'sauber' : `${Math.round(prog * 100)}% abgetragen${st.deep ? `, ${st.deep} Zellen zu tief` : ''}`;
  });
}
function togglePump() {
  if (drone) return;
  if (sim.mode === 'slice' && sim.slice.freeing) { // verstopft: der Knopf löst das Freispül-Minispiel aus
    const r = sim.freeAttempt();
    if (r) { audio.free(r); fx.burst(sliceMouthScreen(sim.slice).x, sliceMouthScreen(sim.slice).y, r === 'cleared' ? 24 : r === 'hit' ? 8 : 4, r === 'miss' ? 'dust' : 'hard', r === 'cleared' ? 220 : 120); }
    if (r === 'cleared') { fx.shake = 0; toast('Pfropfen gelöst!', 'good'); }
    return;
  }
  if (sim.togglePump()) audio.toggle(sim.pumpOn);
}
function fixAuto() { if (!drone) sim.fixAuto(); }
function setCut(v) {
  sim.setCutDepth(v);
  game.cutDepth = sim.cutDepth;
  $('cut').value = sim.cutDepth; $('cut-val').textContent = `${sim.cutDepth.toFixed(2)} m`;
}
function setSpeed(v) {
  sim.setPumpSpeed(v);
  game.pumpSpeed = sim.pumpSpeed;
  $('spd').value = sim.pumpSpeed; $('spd-val').textContent = pct(sim.pumpSpeed);
}
function togglePause() {
  paused = !paused;
  $('btn-pause').textContent = paused ? '▶ Weiter (P)' : '⏸ Pause (P)';
  $('btn-pause2').textContent = paused ? '▶' : '⏸';
  if (paused) saveGame();
}
function setSheet(open) {
  sheetOpen = open && narrow();
  $('panel').classList.toggle('open', sheetOpen);
  if (sheetOpen) saveGame();
  updateClaims();
}

// Drohne ausbringen: taucht nur im Kasten unter dem verankerten Ponton
function startDrone() {
  if (sim.mode !== 'slice' || drone) return;
  drone = game.startDrone({ x0: sim.slice.x0, row: sim.slice.row, r0: sim.slice.r0 });
  syncMode();
}
function recall() { if (drone) { drone.timeLeft = 0; drone.over = true; } }
function endDrone() {
  const r = game.finishDrone(drone);
  drone = null;
  syncMode();
  const extra = `${r.found ? `, ${r.found} Fund${r.found > 1 ? 'e' : ''}` : ''}${r.doc ? `, Befliegungsdaten +${chf(r.doc)}` : ''}`;
  const pc = Math.round(r.box.fraction * 100), need = Math.round(CONFIG.cert.minFraction * 100);
  if (r.cert) { toast(`Kasten ${pc} % sauber: Zertifikat ${r.cert.serial} (${r.cert.grade})!`, 'good'); showCert(r.cert); return; }
  const certNote = r.box.n && r.box.fraction >= CONFIG.cert.minFraction ? ' (Kasten schon zertifiziert)' : r.box.n ? ` · Kasten ${pc} % sauber, ${need} % nötig für ein Zertifikat` : '';
  toast(r.flagged ? `Drohne: ${r.accepted} Zellen abgenommen, ${r.flagged} mit Restschmutz (rot markiert)${extra}${certNote}` : `Drohne: ${r.accepted} Zellen abgenommen, nichts zu beanstanden${extra}${certNote}`, r.flagged ? 'bad' : 'good');
}

// ---------- Spielende ----------
function showEnd() {
  endShown = true;
  clearSave();
  const e = game.end, t = game.totals, best = loadBest();
  const record = e.finalMoney > 0 && (best === null || e.finalMoney > best); // nur positive Endstände zählen als Rekord
  const hadNext = LEVELS.findIndex((l) => l.id === game.levelId); const wasLocked = hadNext >= 0 && hadNext + 1 < LEVELS.length && !levelUnlocked(hadNext + 1);
  if (record) saveBest(e.finalMoney);
  const unlockNote = wasLocked && levelUnlocked(hadNext + 1) ? `Neues Level freigeschaltet: ${LEVELS[hadNext + 1].name}!` : '';
  const title = { early: 'See saniert und abgenommen!', deadline: 'Frist abgelaufen', bankrupt: 'Projekt gestoppt' }[e.reason];
  showOverlay(`<h2>${title}</h2>
    <p>Endstand: <b>${chf(e.finalMoney)}</b>${record ? ' <b class="good">Neuer Rekord!</b>' : best !== null ? `<br><small>Rekord: ${chf(best)}</small>` : ''}</p>
    <p><small>Vergütung insgesamt +${chf(t.pay)} · Nachträge +${chf(t.claimsPaid)} (${t.claimsAccepted} genehmigt, ${t.claimsPartial} hälftig, ${t.claimsRejected} abgelehnt, ${t.claimsExpired} verjährt)<br>${e.external ? `Fremdfirma für den Rest −${chf(e.external)}<br>` : ''}
    Abgesaugt ${t.removed.toFixed(0)} m³ · Chargen ${Object.entries(t.classes).map(([k, n]) => `${n}× ${k}`).join(', ')}<br>
    Befliegungsdaten +${chf(t.docPaid)} · Zertifikate +${chf(t.certPaid)} (${t.certsApproved} freigegeben) · Fossilien +${chf(t.findsPaid)} (${t.findsSold} verkauft, ${t.fossilsLost} zerstört) · Gemeinde-Aufträge +${chf(t.jobsPaid)} (${t.jobsDone} erledigt, ${t.jobsFailed} verpasst)<br>
    Entsorgung ${chf(t.disposalPaid)} · Bussen ${chf(t.finesPaid)} · Bergungen ${chf(t.repairsPaid)} · Übertiefung ${chf(t.overdigPaid)}</small></p>
    <p>Gewonnen hat, wer am Ende am meisten Geld hat.</p>
    <button class="primary" id="btn-restart">Neues Spiel</button>`);
  $('btn-restart').onclick = () => showLevels(unlockNote);
}

// Level-Anzeige: Titelzeile, Partikelfarbe
function applyLevel() {
  fx.setTheme(game.lake.theme?.palette);
  $('level-name').textContent = game.level.short;
  document.title = `Seesanierung · ${game.level.short}`;
}

// Levelauswahl: freigeschaltet wird ein Level mit Gewinn im vorherigen
function showLevels(note = '') {
  const best = loadLevels();
  const rows = LEVELS.map((l, i) => {
    const open = levelUnlocked(i), b = best[l.id];
    return `<button class="level${open ? '' : ' locked'}" data-level="${l.id}" ${open ? '' : 'disabled'}>
      <span class="swatch" style="background:${l.palette.layer}"></span>
      <span class="ltxt"><b>${open ? '' : '🔒 '}${l.name}</b><small>${l.blurb}</small>
      <small>${Math.round(CONFIG.pay.perM3 * l.payMult)} CHF/m³ · ${l.deadlineDays} Tage · Start ${chf(l.startMoney)}${b !== undefined ? ` · Rekord ${chf(b)}` : ''}${open ? '' : ` · schalte es mit einem Gewinn in ${LEVELS[i - 1].short} frei`}</small></span></button>`;
  }).join('');
  showOverlay(`<h2>Seesanierung</h2>${note ? `<p class="good">${note}</p>` : ''}<p>Welcher See soll es sein?</p><div class="levels">${rows}</div>`);
  for (const b of document.querySelectorAll('#overlay .level:not(.locked)')) b.onclick = () => restart(b.dataset.level);
}

function restart(loaded = null) {
  game = loaded instanceof Game ? loaded : new Game(undefined, typeof loaded === 'string' ? loaded : game.levelId); sim = game.createSession(); drone = null; paused = false; endShown = false;
  $('btn-pause').textContent = '⏸ Pause (P)';
  sizeMap(canvas, game.lake); shownSize = 'map';
  setSheet(false); mapTarget = null; claimSig = null; findSig = null; jobSig = null; certSig = null;
  hideOverlay(); syncMode(); updatePanel();
  applyLevel();
  if (!(loaded instanceof Game)) { clearSave(); toast(game.level.blurb, 'info'); } else saveGame();
}

$('btn-drone').onclick = startDrone;
$('btn-drone2').onclick = startDrone;
$('btn-recall').onclick = recall;
$('btn-pump').onclick = togglePump;
$('btn-sound').onclick = toggleSound;
$('btn-sound').textContent = audio.muted ? '🔇 Ton aus (M)' : '🔊 Ton an (M)';
$('btn-pause').onclick = togglePause;
addEventListener('resize', () => { fitCanvas(); placeToast(); });
addEventListener('orientationchange', () => setTimeout(fitCanvas, 200));
$('btn-pause2').onclick = togglePause;
$('panel-handle').onclick = () => setSheet(!sheetOpen);
addEventListener('resize', () => { if (sheetOpen && !narrow()) setSheet(false); });

// Touch: Stick, Aktionsknopf, Tippen auf die Karte
const touch = isTouch ? setupTouch(readInput, { anchor, recall, togglePump }) : null;
readInput.onTap((px, py) => {
  if (drone || sim.mode !== 'map' || paused || sheetOpen || overlayOpen()) return;
  mapTarget = { x: Math.min(sim.lake.cols, Math.max(0, px / CELL)), y: Math.min(sim.lake.rows, Math.max(0, py / CELL)) };
});
$('btn-anchor').onclick = anchor;
$('btn-leave').onclick = leave;
$('btn-auto').onclick = toggleAuto;
$('btn-fix').onclick = fixAuto;
$('cut').oninput = (e) => setCut(parseFloat(e.target.value));
$('spd').oninput = (e) => setSpeed(parseFloat(e.target.value));
$('chk-oc').onchange = (e) => { game.overclock = e.target.checked; updatePlant(); };

// ---------- Hauptschleife ----------
let last = performance.now(), panelTimer = 0;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (readInput.tap('KeyP')) togglePause();
  const running = !paused && !sheetOpen && !overlayOpen() && game.status === 'playing';
  touch?.setMode(currentMode());

  if (!running) audio.hum(false, 0);
  if (readInput.tap('KeyM')) toggleSound();
  if (running) {
    saveClock += dt;
    if (game.day !== savedDay || saveClock > 20) saveGame();
    if (drone) {
      if (readInput.tap('Escape', 'KeyQ')) recall();
      // Die Drohne bleibt in der Bildmitte: Maus/Finger steuern relativ zur Mitte, Tasten und Stick in beide Achsen
      drone.update(dt, readInput.read({ x: canvas.logicalW / 2, y: canvas.logicalH / 2 }, { holdToMove: true, soft: true }));
      const done = drone.scanned.reduce((a, v) => a + v, 0);
      $('s-removed').textContent = `Akku ${Math.ceil(drone.timeLeft)}s · ${done}/16 Spalten gescannt · ${drone.newlyAccepted} abgenommen · ${drone.newlyFlagged} Restschmutz`;
      $('s-turb').value = 0; $('s-tilt').value = 0;
      if (drone.over) endDrone();
    } else {
      const inMap = sim.mode === 'map';
      const cur = inMap ? { x: sim.x * CELL, y: sim.y * CELL } : sliceHeadScreen(sim.slice);
      const inp = readInput.read(cur, { holdToMove: true });
      if (inMap) {
        inp.suction = false; // in der Karte wird nicht gesaugt
        if (mapTarget) { // Tippen auf die Karte: hinfahren und dort ankern; Stick oder Tasten brechen ab
          if (Math.abs(inp.dx) + Math.abs(inp.dy) > 0.1) mapTarget = null;
          else {
            const st = steerToward(sim, mapTarget);
            if (st.arrived) { mapTarget = null; anchor(); } else { inp.dx = st.dx; inp.dy = st.dy; }
          }
        }
        if (readInput.tap('Space', 'Enter', 'KeyE')) anchor();
      } else {
        if (readInput.tap('Escape', 'KeyQ')) leave();
        if (readInput.tap('KeyT')) toggleAuto();
        if (readInput.tap('KeyR')) fixAuto();
        if (readInput.tap('KeyV')) startDrone();
        for (let k = 0; k < CONFIG.box.rows; k++) if (readInput.tap(`Digit${k + 1}`, `Numpad${k + 1}`)) selectRow(k);
        if (readInput.tap('Tab')) selectRow((sim.slice.ci + 1) % CONFIG.box.rows);
        if (readInput.tap('Space')) togglePump(); // Pumpe ein/aus
        inp.suction = sim.pumpOn; // gesaugt wird nur bei eingeschalteter Pumpe (Halten von Leertaste oder Maus zählt nicht)
        if (readInput.tap('KeyZ')) setSpeed(sim.pumpSpeed - 0.1);
        if (readInput.tap('KeyX')) setSpeed(sim.pumpSpeed + 0.1);
        if (sim.stats.echolot > 0) {
          if (readInput.tap('KeyF')) setCut(sim.cutDepth - 0.05);
          if (readInput.tap('KeyG')) setCut(sim.cutDepth + 0.05);
        }
      }
      sim.bufferRoom = game.bufferRoom;
      const before = game.money, d = sim.update(dt, inp);
      game.collect(d);
      for (const n of sim.notes.splice(0)) {
        toast(n.text, n.kind);
        if (sim.mode === 'slice' && (n.kind === 'clog' || n.kind === 'tip')) { // Brocken fliegen, Wackeln, Ton, Vibration
          const m = sliceMouthScreen(sim.slice);
          fx.burst(m.x, m.y, n.kind === 'tip' ? 40 : 18, n.kind === 'tip' ? 'dust' : 'hard');
          audio[n.kind]();
          try { navigator.vibrate?.(n.kind === 'tip' ? [80, 40, 120] : 40); } catch { /* egal */ }
        }
      }
      if (sim.mode === 'slice') {
        const m = sliceMouthScreen(sim.slice), load = Math.min(1, d.removed / Math.max(1e-6, sim.stats.power * dt));
        fx.feed(m, sliceY(sim.slice.surfaceAt(sim.slice.mouth().x)), d, dt, Math.max(0, game.money - before));
        audio.hum(sim.pumpOn && sim.slice.suctioning, load);
      }
      if (sim.mode === 'slice') {
        const sl = sim.slice;
        updateRows();
        $('btn-auto').hidden = sim.stats.autoLevel <= 0;
        $('btn-auto').textContent = sl.auto.on ? '🤖 Automatik aus (T)' : '🤖 Automatik an (T)';
        $('btn-fix').hidden = !sl.auto.error;
        $('btn-pump').textContent = sl.freeing ? '🔧 Freispülen! (Leertaste)' : sim.pumpOn ? '🌀 Pumpe: AN (Leertaste)' : '🌀 Pumpe: AUS (Leertaste)';
        $('btn-pump').classList.toggle('on', sim.pumpOn);
        touch?.setPump(sim.pumpOn, !!sl.freeing);
        $('spd-box').hidden = false;
        if (document.activeElement !== $('spd')) { $('spd').value = sim.pumpSpeed; $('spd-val').textContent = pct(sim.pumpSpeed); }
        $('cut-box').hidden = sim.stats.echolot <= 0;
        if (document.activeElement !== $('cut')) { $('cut').value = sim.cutDepth; $('cut-val').textContent = `${sim.cutDepth.toFixed(2)} m`; }
      }
      $('s-removed').textContent = `${game.totals.removed.toFixed(0)} m³ abgesaugt${sim.overdug > 0.5 ? ` (zu tief: ${sim.overdug.toFixed(0)})` : ''}${sim.bufferFull ? ' · Puffer voll, Pumpe pausiert!' : ''}`;
      $('s-turb').value = sim.turbidity;
      $('s-tilt').value = sim.mode === 'slice' ? sim.slice.tilt : 0;
    }
    fx.update(dt);
    game.update(dt);
    for (const n of game.notes.splice(0)) toast(n.text, n.kind);
  }
  readInput.endFrame();

  panelTimer += dt;
  if (panelTimer > 0.25) { panelTimer = 0; updatePanel(); }
  updateHud();
  if (game.status === 'ended' && !endShown) { updatePanel(); showEnd(); }

  if (sim.mode !== 'map' || drone) mapTarget = null;
  ctx.setTransform(canvas.q || 1, 0, 0, canvas.q || 1, 0, 0); // logische Koordinaten, Auflösung passend zur Anzeige
  if (drone) drawDroneView(ctx, game.lake, drone);
  else if (sim.mode === 'slice') {
    const o = fx.offset();
    ctx.save(); ctx.translate(o.x, o.y); drawSlice(ctx, game.lake, sim); fx.draw(ctx); ctx.restore();
    panCanvas(1 / 60);
  }
  else {
    drawMap(ctx, game.lake, sim, game.jobs);
    if (mapTarget) { // Ziel-Markierung
      ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.beginPath();
      ctx.arc(mapTarget.x * CELL, mapTarget.y * CELL, 10, 0, Math.PI * 2);
      ctx.moveTo(mapTarget.x * CELL - 14, mapTarget.y * CELL); ctx.lineTo(mapTarget.x * CELL + 14, mapTarget.y * CELL);
      ctx.moveTo(mapTarget.x * CELL, mapTarget.y * CELL - 14); ctx.lineTo(mapTarget.x * CELL, mapTarget.y * CELL + 14); ctx.stroke();
    }
  }
  requestAnimationFrame(frame);
}

const saved = (() => { const t = readSave(); const m = t && savedSummary(t); return m && m.status === 'playing' ? m : null; })();
applyLevel();
buildUpgrades();
buildRows();
syncMode();
updatePanel();
function showIntro() {
  showOverlay(`<h2>Seesanierung</h2>
    <p>Das Spiel läuft in <b>Echtzeit</b>: Für jeden abgesaugten m³ der belasteten Schicht gibt es ${CONFIG.pay.perM3} CHF (Altlasten ${Math.round(CONFIG.pay.perM3 * CONFIG.pay.toxicMultiplier)} CHF), zu tief abgetragener Boden wird nicht bezahlt. Entsorgung, Analyse, Bussen und Reparaturen kosten. Zusatzleistungen (Fremdstoffe, harte Schicht, Fässer) rechnest du als <b>Nachträge</b> beim Bauherrn ab: je höher die Forderung, desto unwahrscheinlicher die Genehmigung. In ${CONFIG.deadlineDays} Tagen (${Math.round(CONFIG.deadlineDays * CONFIG.daySeconds / 60)} Minuten) ist Schluss:
    was dann noch im See liegt, saniert eine Fremdfirma zum Notfalltarif. <b>Gewonnen hat, wer am Ende am meisten Geld hat.</b></p>
    <details ${isTouch ? 'open' : ''}><summary>Steuerung am Handy</summary>
      <p><b>Stick</b> links fährt den Ponton auf der Karte. Im Querschnitt steuerst du die Pumpe nur mit den <b>Pfeil-Knöpfen</b> (halten = fahren) und stellst mit dem <b>Tempo-Regler</b> ein, wie schnell sie fährt (langsam = tieferer Schnitt, mehr Kippgefahr). Der grosse Knopf rechts wirft auf der Karte den Anker und schaltet im Querschnitt die <b>Pumpe ein und aus</b> (sie saugt dann auch im Stillstand, rückwärts nie). Ein <b>Tipp auf die Karte</b> fährt hin und ankert dort.
      Unter dem Spielfeld stehen Zurück zur Karte, Automatik, Reset und Drohne (dort steuert der Stick in alle Richtungen, der grosse Knopf holt sie ein), oben rechts die Pause. Der Shop liegt unten im Fach „Anlage &amp; Ausrüstung“; solange es offen ist, steht das Spiel still.</p></details>
    <details ${isTouch ? '' : 'open'}><summary>Steuerung am Computer</summary>
      <p>Karte: WASD / Pfeile (oder Maus gedrückt) fahren, <b>E</b> / Leertaste wirft den Anker. Querschnitt: A/D fährt die Pumpe seitlich, W/S zieht sie hoch oder lässt sie runter (immer nur eine Achse), <b>Leertaste</b> schaltet die Pumpe ein und aus: Sie saugt auch im Stillstand und vorwärts, rückwärts nie.
      <b>Q</b> zurück zur Karte, <b>T</b> Automatik, <b>R</b> Reset, <b>F/G</b> Abtragsdicke, <b>Z/X</b> Tempo der Pumpe, <b>V</b> Drohne ausbringen (Q holt sie ein), <b>P</b> Pause. Drohne: WASD/Pfeile in beide Achsen.</p></details>
    <details><summary>Regeln im See</summary>
      <p>Die Pumpe hängt an einer Kette und schwebt, wo du sie lässt. Der Einsaugbereich liegt unten rechts, die Pumpe saugt nur am Boden im Material (im freien Wasser trübt sie nichts), rückwärts fahren saugt nicht. Gräbst du zu tief, kippt sie um.</p>
      <p>Schraffierte Zellen sind hart: mehrere Überfahrten. Weisse Punkte sind Fremdstoffe, die die Pumpe verstopfen (Kopf anheben hilft). Rot = Altlasten.
      Die belastete Schicht ist überall 1 m dick (braun, gelb gestrichelt = Sollsohle); wer tiefer saugt, zahlt dafür (orange auf der Karte). Mit dem <b>Echolot</b> fährt die Automatik eine eingestellte Abtragsdicke an. Die <b>Tauchdrohne</b> fährst du aus dem verankerten Ponton aus (V oder Knopf): Sie taucht nur im Kasten unter dem Ponton, sieht nur im Lichtkegel in Fahrtrichtung (leicht nach unten) und scannt den Boden, wenn du langsam und nah daran fährst. Sie nimmt den Seegrund ab, entdeckt Fossilien im Untergrund (das Museum zahlt für die Bergung, zerstörte sind weg und kosten) und verkauft Befliegungsdaten an die Behörde. Die Gemeinde bietet <b>Zusatzaufträge</b> an: Zone bis zum Termin sauber und abgenommen = Prämie.</p></details>
    <button class="primary" id="btn-go">Los</button>`);
  $('btn-go').onclick = () => showLevels();
  if (saved) {
    const b = document.createElement('button');
    b.className = 'primary'; b.id = 'btn-continue';
    b.textContent = `Weiterspielen (Tag ${saved.day}, ${chf(saved.money)})`;
    b.onclick = () => { const g = restoreGame(readSave()); if (g) restart(g); else { clearSave(); hideOverlay(); } };
    $('btn-go').before(b);
    $('btn-go').textContent = 'Neues Spiel';
    $('btn-go').classList.remove('primary');
  }
}

// Passwort vor dem Start (Hash in config.js); gemerkt wird nur auf diesem Gerät
const UNLOCK_KEY = 'altlasten.unlocked';
const unlocked = () => { try { return localStorage.getItem(UNLOCK_KEY) === CONFIG.passwordHash; } catch { return false; } };
function showGate() {
  showOverlay(`<h2>Seesanierung</h2>
    <p>Bitte das Passwort eingeben.</p>
    <form id="gate-form"><input id="gate-pw" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="Passwort" style="width:100%;padding:12px;font-size:18px;border-radius:8px;border:1px solid #ffffff44;background:#0e1a24;color:inherit">
    <p id="gate-err" class="warn" style="min-height:1.4em;margin:6px 0"></p>
    <button class="primary" type="submit">Starten</button></form>`);
  const pw = $('gate-pw');
  pw.focus();
  $('gate-form').onsubmit = (e) => {
    e.preventDefault();
    if (checkPassword(pw.value, CONFIG.passwordHash)) { try { localStorage.setItem(UNLOCK_KEY, CONFIG.passwordHash); } catch { /* egal */ } showIntro(); }
    else { $('gate-err').textContent = 'Falsches Passwort. Der Kanton lässt grüssen.'; pw.select(); }
  };
}
if (!CONFIG.passwordHash || unlocked()) showIntro(); else showGate();
addEventListener('pagehide', saveGame);
document.addEventListener('visibilitychange', () => { if (document.hidden) saveGame(); });
requestAnimationFrame(frame);
globalThis.__dbg = () => ({ game, sim, drone, mapTarget }); // nur für Browser-Tests
