// Zeichnet Karte und Querschnitt. Kennt keine Spiellogik, liest nur Zustand.
import { SLICE } from '../sim/slice.js';
import { CONFIG } from '../config.js';
import { Chain, drawChain } from './chain.js';

const CONFIG_FOSSIL_DEPTH = CONFIG.fossils.depthBelowTarget; // Fossilien liegen so tief unter der Sollsohle

const chain = new Chain();
let lastT = 0;

export const CELL = 20; // Karte: Pixel pro Zelle
export const U = 48;
const PW = 24, PH = 60; // Pumpe in Pixeln, hochkant // Querschnitt: Pixel pro Einheit
const SLICE_TOP = 60; // Wasseroberfläche (darüber der Ponton)
const BEDROCK = 60; // Höhe des Felsbands unten

// Logische Grösse des Spielfelds; die tatsächliche Pixelgrösse setzt main.fitCanvas() passend zur Anzeige
function setLogical(canvas, w, h) { canvas.logicalW = w; canvas.logicalH = h; canvas.width = w; canvas.height = h; }
export function sizeMap(canvas, lake) { setLogical(canvas, lake.cols * CELL, lake.rows * CELL); }
export function sizeSlice(canvas) { setLogical(canvas, SLICE.cols * U, SLICE_TOP + SLICE.viewH * U + BEDROCK); }

// ---------- Instanz 1: Karte ----------
export function drawMap(ctx, lake, sim, jobs = []) {
  const { cols, rows, mass, toxic } = lake;
  ctx.fillStyle = '#12304a';
  ctx.fillRect(0, 0, cols * CELL, rows * CELL);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, m = mass[i];
      if (m <= 0) continue;
      const a = 0.35 + 0.55 * Math.min(1, m);
      ctx.fillStyle = toxic[i] ? `rgba(200,70,60,${a})` : `rgba(120,95,60,${a})`;
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
      if (lake.hard[i]) { // Schraffur: hart = Kreuz, verdichtet = Strich
        ctx.strokeStyle = 'rgba(20,10,0,.6)'; ctx.lineWidth = 1; ctx.beginPath();
        ctx.moveTo(x * CELL, (y + 1) * CELL); ctx.lineTo((x + 1) * CELL, y * CELL);
        if (lake.hard[i] > 1) { ctx.moveTo(x * CELL, y * CELL); ctx.lineTo((x + 1) * CELL, (y + 1) * CELL); }
        ctx.stroke();
      }
      if (lake.debris[i]) { ctx.fillStyle = '#f2f2f2'; ctx.fillRect(x * CELL + 7, y * CELL + 7, 6, 6); }
    }
  }
  for (let y = 0; y < rows; y++) { // Abnahme durch die Drohne
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (lake.accepted[i] && lake.initial[i]) { ctx.fillStyle = 'rgba(90,230,130,.35)'; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
      if (lake.overdug(i)) { ctx.fillStyle = 'rgba(255,170,0,.4)'; ctx.fillRect(x * CELL, y * CELL, CELL, CELL); }
      if (lake.flagged[i]) { ctx.strokeStyle = '#ff5d4d'; ctx.lineWidth = 2; ctx.strokeRect(x * CELL + 2, y * CELL + 2, CELL - 4, CELL - 4); }
    }
  }
  for (let y = 0; y < rows; y++) { // entdeckte Fossilien
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (lake.fossil[i] && lake.fossilFound[i]) { ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(x * CELL + CELL / 2, y * CELL + CELL / 2, 4, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#5a4300'; ctx.lineWidth = 1; ctx.stroke(); }
    }
  }
  for (const j of jobs) { // Zonen der Gemeinde: Angebot gestrichelt gelb, angenommener Auftrag durchgezogen cyan
    const z = j.zone, active = j.status === 'active';
    ctx.strokeStyle = active ? '#7fe3ff' : '#ffd24d'; ctx.lineWidth = 2; ctx.setLineDash(active ? [] : [8, 5]);
    ctx.strokeRect(z.x * CELL + 1, z.y * CELL + 1, z.w * CELL - 2, z.h * CELL - 2); ctx.setLineDash([]);
    ctx.fillStyle = active ? '#7fe3ff' : '#ffd24d'; ctx.font = 'bold 13px system-ui, sans-serif';
    ctx.fillText(`${active ? 'Auftrag' : 'Angebot'}: ${j.place}`, z.x * CELL + 6, z.y * CELL + 16);
  }
  if (!sim) return;
  const px = sim.x * CELL, py = sim.y * CELL;
  // Ponton: so breit wie der Absaugbereich des Querschnitts
  const x0 = Math.min(Math.max(Math.round(sim.x) - SLICE.cols / 2, 0), cols - SLICE.cols);
  const boxRows = CONFIG.box.rows, r0 = Math.min(Math.max(sim.row - Math.floor(boxRows / 2), 0), rows - boxRows);
  const bx = x0 * CELL, by = r0 * CELL, bw = SLICE.cols * CELL, bh = boxRows * CELL, cyRow = sim.row * CELL; // Kasten: 16 Spalten x 5 Zeilen
  // Schlauch zum Ufer (oben links)
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(px * 0.4, py * 0.1, bx + bw / 2, by + 3); ctx.stroke();
  ctx.fillStyle = 'rgba(217,222,227,.22)'; ctx.fillRect(bx, by, bw, bh); // der Kasten unter dem Ponton
  ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.strokeRect(bx + 1, by + 1, bw - 2, bh - 2);
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(bx, by, bw, 8); // Ponton oben am Kasten
  ctx.fillStyle = '#222'; for (let i = 0; i < SLICE.cols; i++) { ctx.beginPath(); ctx.arc(bx + (i + 0.5) * CELL, by + 4, 2.5, 0, Math.PI * 2); ctx.fill(); }
  ctx.strokeStyle = '#7fe3ff99'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); // Querschnittszeile
  ctx.beginPath(); ctx.moveTo(bx, cyRow + CELL / 2); ctx.lineTo(bx + bw, cyRow + CELL / 2); ctx.stroke(); ctx.setLineDash([]);
  turbidityVeil(ctx, sim, cols * CELL, rows * CELL);
}

// ---------- Instanz 3: Drohne (Seitenansicht, Drohne fix in der Bildmitte, Landschaft fährt) ----------
const Z = 56; // Pixel pro Einheit in der Drohnenansicht
let darkness = null; // Offscreen-Ebene für die Dunkelheit mit ausgeschnittenem Lichtkegel

export function drawDroneView(ctx, lake, d) {
  const W = SLICE.cols * U, H = SLICE_TOP + SLICE.viewH * U + BEDROCK, cx = W / 2, cy = H / 2;
  const sx = (wx) => cx + (wx - d.x) * Z, sy = (h) => cy + (d.h - h) * Z;
  const col = (c) => lake.idx(d.x0 + c, d.row), T = (c) => lake.top[col(c)], G = (c) => lake.target[col(c)];
  const xs = (c) => sx(d.x0 + c + 0.5);
  ctx.fillStyle = '#0b1620'; ctx.fillRect(0, 0, W, H);
  // Wasser im Kasten
  const g = ctx.createLinearGradient(0, sy(SLICE.viewH), 0, sy(0));
  g.addColorStop(0, '#2f7396'); g.addColorStop(1, '#0f2f46');
  ctx.fillStyle = g; ctx.fillRect(sx(d.x0), sy(SLICE.viewH), SLICE.cols * Z, SLICE.viewH * Z);
  // Boden: fester Untergrund, belastete Schicht, Übertiefung (wie im Querschnitt)
  const band = (lowerH, upperH, fill) => {
    ctx.beginPath(); ctx.moveTo(sx(d.x0), sy(upperH(0)));
    for (let c = 0; c < SLICE.cols; c++) ctx.lineTo(xs(c), sy(upperH(c)));
    ctx.lineTo(sx(d.x0 + SLICE.cols), sy(upperH(SLICE.cols - 1))); ctx.lineTo(sx(d.x0 + SLICE.cols), sy(lowerH(SLICE.cols - 1)));
    for (let c = SLICE.cols - 1; c >= 0; c--) ctx.lineTo(xs(c), sy(lowerH(c)));
    ctx.lineTo(sx(d.x0), sy(lowerH(0))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  band(() => -1.2, (c) => Math.min(T(c), G(c)), '#5d5b52');
  band((c) => Math.min(T(c), G(c)), G, 'rgba(235,90,60,.5)');
  band(G, (c) => Math.max(T(c), G(c)), '#7a5f3c');
  ctx.fillStyle = '#34312d'; ctx.fillRect(sx(d.x0), sy(0), SLICE.cols * Z, 1.2 * Z); // Felsgrund
  for (let c = 0; c < SLICE.cols; c++) {
    const i = col(c);
    if (lake.hard[i] && lake.mass[i] > 0) { ctx.fillStyle = lake.hard[i] > 1 ? 'rgba(25,18,10,.6)' : 'rgba(25,18,10,.32)'; ctx.fillRect(xs(c) - Z / 2, sy(T(c)), Z, lake.mass[i] * Z); }
    if (lake.debris[i]) { ctx.strokeStyle = '#e6ebef'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(xs(c), sy(T(c)) - 10, 9, 0, Math.PI * 2); ctx.stroke(); }
    if (lake.fossil[i] && lake.fossilFound[i]) { // entdeckter Fund
      const fy = sy(G(c) - CONFIG_FOSSIL_DEPTH);
      ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2; ctx.beginPath();
      for (let a = 0; a < 9; a += 0.25) { const r = 1.5 + a * 1.6; (a ? ctx.lineTo : ctx.moveTo).call(ctx, xs(c) + Math.cos(a) * r, fy + Math.sin(a) * r); }
      ctx.stroke();
    }
  }
  // Scanstand je Spalte: Fortschrittsbalken im Licht; Ergebnisse (grün sauber, rot Rest) werden nach der Dunkelheit gezeichnet
  const marks = [];
  for (let c = 0; c < SLICE.cols; c++) {
    let dirty = false, rest = 0;
    for (let y = d.r0; y < d.r0 + CONFIG.box.rows; y++) {
      const ci = lake.idx(d.x0 + c, y);
      if (lake.flagged[ci]) dirty = true;
      rest = Math.max(rest, lake.mass[ci]);
    }
    const px = xs(c), py = sy(T(c));
    if (d.scanned[c]) marks.push({ x: px, y: py, dirty, rest, c });
    else if (d.progress[c] > 0) { ctx.fillStyle = '#7fe3ff'; ctx.fillRect(px - Z / 2 + 4, py + 4, (Z - 8) * d.progress[c], 5); }
  }
  // Kasten: Wände und Ponton oben, Kabel zur Drohne
  ctx.fillStyle = '#c9d2d8'; ctx.fillRect(sx(d.x0) - 6, sy(SLICE.viewH), 6, (SLICE.viewH + 1.2) * Z); ctx.fillRect(sx(d.x0 + SLICE.cols), sy(SLICE.viewH), 6, (SLICE.viewH + 1.2) * Z);
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(sx(d.x0) - 6, sy(SLICE.viewH) - 26, SLICE.cols * Z + 12, 26);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(sx(d.x0 + SLICE.cols / 2), sy(SLICE.viewH)); ctx.quadraticCurveTo(sx(d.x0 + SLICE.cols / 2), cy - 30, cx, cy); ctx.stroke();

  // Dunkelheit: alles ist schwarz, ausser dem Lichtkegel in Fahrtrichtung und einem kleinen Glimmen um die Drohne
  if (!darkness || darkness.width !== W || darkness.height !== H) { darkness = document.createElement('canvas'); darkness.width = W; darkness.height = H; }
  const k = darkness.getContext('2d');
  k.globalCompositeOperation = 'source-over'; k.clearRect(0, 0, W, H);
  k.fillStyle = 'rgba(2,6,10,0.95)'; k.fillRect(0, 0, W, H);
  k.globalCompositeOperation = 'destination-out';
  const R = d.range * Z, ang = Math.atan2(Math.sin(d.tilt), d.face * Math.cos(d.tilt)), half = CONFIG.drone.beam.halfAngle;
  const cone = k.createRadialGradient(cx, cy, 0, cx, cy, R);
  cone.addColorStop(0, 'rgba(0,0,0,1)'); cone.addColorStop(0.65, 'rgba(0,0,0,0.9)'); cone.addColorStop(1, 'rgba(0,0,0,0)');
  k.fillStyle = cone; k.beginPath(); k.moveTo(cx, cy); k.arc(cx, cy, R, ang - half, ang + half); k.closePath(); k.fill();
  const glow = k.createRadialGradient(cx, cy, 0, cx, cy, Z * 0.9);
  glow.addColorStop(0, 'rgba(0,0,0,0.9)'); glow.addColorStop(1, 'rgba(0,0,0,0)');
  k.fillStyle = glow; k.beginPath(); k.arc(cx, cy, Z * 0.9, 0, Math.PI * 2); k.fill();
  ctx.drawImage(darkness, 0, 0);
  for (const m of marks) { // Scanergebnisse bleiben sichtbar, auch ausserhalb des Lichts
    ctx.strokeStyle = m.dirty ? '#ff5d4d' : '#5ae682'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(m.x - Z / 2 + 2, m.y); ctx.lineTo(m.x + Z / 2 - 2, m.y); ctx.stroke();
    ctx.fillStyle = m.dirty ? '#ff9a8d' : '#8af0ab'; ctx.font = 'bold 12px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(m.dirty ? `Rest ${Math.round(m.rest * 100)} cm` : 'sauber', m.x, m.y - 8 - (m.c % 2) * 14); // abwechselnd versetzt, damit Nachbarn nicht überlappen
  }
  ctx.textAlign = 'start';

  // Lichtschein im Kegel und Drohne (fix in der Bildmitte)
  ctx.fillStyle = 'rgba(255,245,200,.10)'; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, R, ang - half, ang + half); ctx.closePath(); ctx.fill();
  ctx.save(); ctx.translate(cx, cy); ctx.scale(d.face, 1);
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(-14, -8, 28, 16);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.strokeRect(-14, -8, 28, 16);
  ctx.fillStyle = '#222'; ctx.fillRect(-18, -12, 10, 3); ctx.fillRect(8, -12, 10, 3);
  ctx.fillStyle = '#fff6c9'; ctx.beginPath(); ctx.arc(14, 2, 4, 0, Math.PI * 2); ctx.fill(); // Lampe vorne
  ctx.restore();
  if (!d.scanned.some(Boolean)) {
    ctx.fillStyle = '#ffffffcc'; ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText('Langsam und nah am Boden fahren: Nur was im Lichtkegel liegt, wird gescannt', cx, H - 14);
    ctx.textAlign = 'start';
  }
  if (d.speed > CONFIG.drone.beam.maxScanSpeed) { ctx.fillStyle = '#ff7a6b'; ctx.font = 'bold 16px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Zu schnell zum Scannen', cx, cy + 46); ctx.textAlign = 'start'; }
}

// ---------- Instanz 2: Querschnitt ----------
const yOf = (h) => SLICE_TOP + (SLICE.viewH - h) * U;
export function sliceHeadScreen(sl) { return { x: (sl.x - sl.x0) * U, y: yOf(sl.h) }; } // Pumpenstandort
export function sliceMouthScreen(sl) { const m = sl.mouth(); return { x: (m.x - sl.x0) * U, y: yOf(m.h) }; } // Einsaugstelle

export function drawSlice(ctx, lake, sim) {
  const sl = sim.slice, W = SLICE.cols * U, H = SLICE_TOP + SLICE.viewH * U + BEDROCK;
  ctx.fillStyle = '#0b1620'; ctx.fillRect(0, 0, W, H);
  // Wasser
  const g = ctx.createLinearGradient(0, SLICE_TOP, 0, yOf(0));
  g.addColorStop(0, '#2f7396'); g.addColorStop(1, '#0f2f46');
  ctx.fillStyle = g; ctx.fillRect(0, SLICE_TOP, W, SLICE.viewH * U);
  // Felsband mit Fossilien
  ctx.fillStyle = '#34312d'; ctx.fillRect(0, yOf(0), W, BEDROCK);
  ctx.strokeStyle = '#8d8579'; ctx.lineWidth = 2;
  for (let i = 0; i < 9; i++) {
    const bx = 30 + i * 72, by = yOf(0) + 20 + (i % 2) * 18;
    ctx.beginPath(); ctx.ellipse(bx, by, 14, 6, (i % 3) * 0.5, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(bx + 18, by); ctx.lineTo(bx + 34, by + 4); ctx.stroke();
  }
  // Profil: fester Untergrund, belastete Schicht (überall gleich dick) und Übertiefung als Flächen
  const col = (c) => lake.idx(sl.x0 + c, sl.row), xs = (c) => (c + 0.5) * U;
  const T = (c) => lake.top[col(c)], G = (c) => lake.target[col(c)];
  const band = (lowerH, upperH, fill) => {
    ctx.beginPath(); ctx.moveTo(0, yOf(upperH(0)));
    for (let c = 0; c < SLICE.cols; c++) ctx.lineTo(xs(c), yOf(upperH(c)));
    ctx.lineTo(W, yOf(upperH(SLICE.cols - 1))); ctx.lineTo(W, yOf(lowerH(SLICE.cols - 1)));
    for (let c = SLICE.cols - 1; c >= 0; c--) ctx.lineTo(xs(c), yOf(lowerH(c)));
    ctx.lineTo(0, yOf(lowerH(0))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
  };
  band(() => 0, (c) => Math.min(T(c), G(c)), '#5d5b52'); // fester Untergrund
  band((c) => Math.min(T(c), G(c)), G, 'rgba(235,90,60,.5)'); // Übertiefung: tiefer als die Sollsohle
  band(G, (c) => Math.max(T(c), G(c)), '#7a5f3c'); // belastete Schicht
  ctx.beginPath(); ctx.moveTo(0, yOf(T(0)));
  for (let c = 0; c < SLICE.cols; c++) ctx.lineTo(xs(c), yOf(T(c)));
  ctx.lineTo(W, yOf(T(SLICE.cols - 1))); ctx.strokeStyle = '#a58760'; ctx.lineWidth = 3; ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, yOf(G(0))); // Sollsohle
  for (let c = 0; c < SLICE.cols; c++) ctx.lineTo(xs(c), yOf(G(c)));
  ctx.lineTo(W, yOf(G(SLICE.cols - 1)));
  ctx.strokeStyle = '#ffd24dcc'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]); ctx.stroke(); ctx.setLineDash([]);
  if (sl.h - sl.setH > 0.05) { // eingestellte Höhe der Pumpe: dorthin sinkt sie zurück
    const hx = (sl.x - sl.x0) * U;
    ctx.beginPath(); ctx.moveTo(hx - 40, yOf(sl.setH)); ctx.lineTo(hx + 40, yOf(sl.setH));
    ctx.strokeStyle = '#ffb347'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.stroke(); ctx.setLineDash([]);
  }
  // Echolot: gemessenes Profil (punktiert) und Zielhöhe für die gewünschte Abtragsdicke (gestrichelt)
  if (sl.sounding) {
    ctx.beginPath();
    for (let c = 0; c < SLICE.cols; c++) (c ? ctx.lineTo : ctx.moveTo).call(ctx, xs(c), yOf(sl.sounding[sl.ci][c]));
    ctx.strokeStyle = '#7fe3ffaa'; ctx.lineWidth = 2; ctx.setLineDash([2, 5]); ctx.stroke();
    ctx.beginPath();
    for (let c = 0; c < SLICE.cols; c++) (c ? ctx.lineTo : ctx.moveTo).call(ctx, xs(c), yOf(sl.targetAt(c)));
    ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.setLineDash([10, 5]); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#7fe3ff'; ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(`Echolot: Ziel −${sl.cutDepth.toFixed(2)} m (punktiert = Messung)`, 12, SLICE_TOP + 18);
  }
  // Entdeckte Fossilien im Untergrund (Ammonit-Spirale)
  for (let c = 0; c < SLICE.cols; c++) {
    const i = col(c);
    if (!lake.fossil[i] || !lake.fossilFound[i]) continue;
    const cx = xs(c), cy = yOf(G(c) - CONFIG_FOSSIL_DEPTH);
    ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2; ctx.beginPath();
    for (let a = 0; a < 9; a += 0.25) { const r = 1.5 + a * 1.4; (a ? ctx.lineTo : ctx.moveTo).call(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.stroke();
  }
  // Harte Schichten (dunkel) und Fremdstoffe (Rad)
  for (let c = 0; c < SLICE.cols; c++) {
    const i = col(c), mm = lake.mass[i];
    if (lake.hard[i] && mm > 0) {
      ctx.fillStyle = lake.hard[i] > 1 ? 'rgba(25,18,10,.6)' : 'rgba(25,18,10,.32)';
      ctx.fillRect(c * U, yOf(T(c)), U, mm * U);
    }
    if (lake.debris[i]) {
      const cx = xs(c), cy = yOf(T(c)) - 10;
      ctx.strokeStyle = '#e6ebef'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy + 9); ctx.stroke();
    }
  }
  // Altlasten-Fässer in giftigen Zellen (mitten in der Schicht)
  for (let c = 0; c < SLICE.cols; c++) {
    const i = col(c);
    if (!lake.toxic[i] || lake.mass[i] < 0.3) continue;
    const cx = xs(c), cy = yOf((T(c) + G(c)) / 2);
    ctx.fillStyle = '#b8473c'; ctx.fillRect(cx - 14, cy - 17, 28, 34);
    ctx.fillStyle = '#e9d36a'; ctx.fillRect(cx - 14, cy - 4, 28, 6);
    ctx.strokeStyle = '#3a0f0b'; ctx.lineWidth = 2; ctx.strokeRect(cx - 14, cy - 17, 28, 34);
  }
  // Ponton: so breit wie der Absaugbereich, mit Reifen als Fender
  const pump = sliceHeadScreen(sl), mouth = sliceMouthScreen(sl);
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(0, 26, W, 30);
  ctx.fillStyle = '#222';
  for (let i = 0; i < SLICE.cols; i++) { ctx.beginPath(); ctx.arc((i + 0.5) * U, 46, 7, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = '#9aa6b0'; ctx.fillRect(W / 2 - 22, 8, 44, 20);
  // Trübungsschutz: Kasten, der vom Ponton nach unten kommt; tiefer mit jeder Ausbaustufe
  const lvl = Math.round(sim.stats.curtain / 0.2);
  if (lvl > 0) {
    const bottom = SLICE_TOP + SLICE.viewH * U * (0.18 + 0.2 * lvl);
    ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(0, 56, W, bottom - 56);
    ctx.strokeStyle = '#c9d2d8'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(2, 56); ctx.lineTo(2, bottom); ctx.moveTo(W - 2, 56); ctx.lineTo(W - 2, bottom); ctx.stroke();
    ctx.lineWidth = 2; ctx.setLineDash([8, 6]);
    ctx.beginPath(); ctx.moveTo(2, bottom); ctx.lineTo(W - 2, bottom); ctx.stroke(); ctx.setLineDash([]);
  }
  // Laufkatze auf dem Ponton; die Kette hängt frei und schwingt nach, wenn die Pumpe fährt oder gezogen wird
  const bodyTop = pump.y - PH - 6, now = performance.now(), dtc = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  if (chain.owner !== sl) { chain.reset(); chain.owner = sl; }
  ctx.fillStyle = '#556'; ctx.fillRect(pump.x - 16, 54, 32, 10);
  chain.update(dtc, pump.x, 64, pump.x, bodyTop);
  drawChain(ctx, chain);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(W / 2, 52); ctx.quadraticCurveTo(W / 2, bodyTop - 20, pump.x + 8, pump.y - PH * 0.8); ctx.stroke();
  // Pumpe: ein hochkantiges Rechteck (Breite : Höhe = 1 : 5) an der Kette, Einsaugöffnung unten vorne (rechts).
  // Sie pendelt mit der Kette und kippt nach rechts, wenn sie zu tief gräbt.
  ctx.save();
  ctx.translate(pump.x, pump.y);
  ctx.rotate(-chain.endAngle() * 0.6 + sl.tilt * 0.55 + (sl.tipped > 0 ? 0.6 : 0));
  ctx.fillStyle = '#2b2f33'; ctx.fillRect(-PW / 2, -PH, PW, PH); // Körper
  ctx.fillStyle = '#7a828a'; ctx.fillRect(-PW / 2, -PH * 0.55, PW, 4); ctx.fillRect(-5, -PH - 6, 10, 8); // Band, Öse
  ctx.fillStyle = '#0d0f11'; ctx.fillRect(PW / 2 - 6, -14, 6, 14); // Einsaugöffnung unten vorne
  ctx.restore();
  // Sog an der Einsaugstelle
  if (sl.suctioning) {
    ctx.fillStyle = '#7fe3ff55';
    ctx.beginPath(); ctx.moveTo(mouth.x - 12, mouth.y + 4); ctx.lineTo(mouth.x - 30, mouth.y + 28); ctx.lineTo(mouth.x + 40, mouth.y + 28); ctx.lineTo(mouth.x + 12, mouth.y + 4); ctx.fill();
  }
  if (sl.tipped > 0 || sl.tilt > 0.05) {
    ctx.fillStyle = sl.tipped > 0 || sl.tilt > 0.6 ? '#ff7a6b' : '#ffd24d'; ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(sl.tipped > 0 ? 'UMGEKIPPT!' : 'Schieflage', Math.max(8, pump.x - 40), Math.max(96, bodyTop - 8));
  }
  if (sl.clog > 0) {
    ctx.fillStyle = '#ff7a6b'; ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText(`VERSTOPFT ${sl.clog.toFixed(1)}s`, Math.max(8, pump.x - 60), Math.max(116, bodyTop - 28));
  }
  if (sl.auto.on) {
    ctx.fillStyle = sl.auto.error ? '#ff7a6b' : '#7bd88f'; ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(sl.auto.error ? 'AUTOMATIK STÖRUNG (R)' : 'AUTOMATIK', W - 230, SLICE_TOP - 8);
  }
  ctx.fillStyle = sim.pumpOn ? '#7bd88f' : '#ffffff88'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textAlign = 'right'; // Pumpenschalter
  ctx.fillText(sim.pumpOn ? 'PUMPE AN' : 'PUMPE AUS', W - 12, SLICE_TOP + 18); ctx.textAlign = 'start';
  // Arbeitsrichtung: nur nach rechts (und nach unten) wird gesaugt
  ctx.fillStyle = sl.suctioning ? '#7fe3ff' : '#ffffff66';
  ctx.beginPath(); ctx.moveTo(mouth.x + 20, mouth.y - 10); ctx.lineTo(mouth.x + 36, mouth.y - 3); ctx.lineTo(mouth.x + 20, mouth.y + 4); ctx.fill();
  ctx.fillStyle = '#ffffff55'; ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Rückwärts saugt nicht', 12, SLICE_TOP - 8);
  turbidityVeil(ctx, sim, W, H);
}

function turbidityVeil(ctx, sim, w, h) {
  ctx.fillStyle = `rgba(160,150,120,${sim.turbidity * 0.55})`;
  ctx.fillRect(0, 0, w, h);
}
