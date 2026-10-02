// Zeichnet Karte und Querschnitt. Kennt keine Spiellogik, liest nur Zustand.
import { SLICE } from '../sim/slice.js';
import { CONFIG } from '../config.js';
import { Chain, drawChain } from './chain.js';

const CONFIG_FOSSIL_DEPTH = CONFIG.fossils.depthBelowTarget; // Fossilien liegen so tief unter der Sollsohle

const chain = new Chain();
let lastT = 0;

export const CELL = 20; // Karte: Pixel pro Zelle
export const U = 48; // Querschnitt: Pixel pro Einheit
const SLICE_TOP = 60; // Wasseroberfläche (darüber der Ponton)
const BEDROCK = 60; // Höhe des Felsbands unten

export function sizeMap(canvas, lake) { canvas.width = lake.cols * CELL; canvas.height = lake.rows * CELL; }
export function sizeSlice(canvas) { canvas.width = SLICE.cols * U; canvas.height = SLICE_TOP + SLICE.viewH * U + BEDROCK; }

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
  const bx = x0 * CELL, by = sim.row * CELL, bw = SLICE.cols * CELL;
  // Schlauch zum Ufer (oben links)
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(px * 0.4, py * 0.1, bx + bw / 2, by + CELL / 2); ctx.stroke();
  ctx.fillStyle = '#d9dee3cc'; ctx.fillRect(bx, by + 2, bw, CELL - 4);
  ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.strokeRect(bx, by + 2, bw, CELL - 4);
  ctx.fillStyle = '#222'; for (let i = 0; i < SLICE.cols; i++) { ctx.beginPath(); ctx.arc(bx + (i + 0.5) * CELL, by + CELL / 2, 3, 0, Math.PI * 2); ctx.fill(); }
  turbidityVeil(ctx, sim, cols * CELL, rows * CELL);
}

// ---------- Instanz 3: Drohne (Draufsicht, Scanradius) ----------
export function drawDrone(ctx, drone) {
  const px = drone.x * CELL, py = drone.y * CELL;
  ctx.fillStyle = 'rgba(127,227,255,.15)'; ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px, py, drone.stats.droneRadius * CELL, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(px - 8, py - 5, 16, 10);
  ctx.strokeStyle = '#222'; ctx.lineWidth = 2; ctx.strokeRect(px - 8, py - 5, 16, 10);
  ctx.fillStyle = '#222'; ctx.fillRect(px - 12, py - 8, 5, 3); ctx.fillRect(px + 7, py - 8, 5, 3);
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
  // Echolot: gemessenes Profil (punktiert) und Zielhöhe für die gewünschte Abtragsdicke (gestrichelt)
  if (sl.sounding) {
    ctx.beginPath();
    for (let c = 0; c < SLICE.cols; c++) (c ? ctx.lineTo : ctx.moveTo).call(ctx, xs(c), yOf(sl.sounding[c]));
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
  const bodyTop = pump.y - 42, now = performance.now(), dtc = Math.min(0.05, Math.max(0.001, (now - lastT) / 1000));
  lastT = now;
  if (chain.owner !== sl) { chain.reset(); chain.owner = sl; }
  ctx.fillStyle = '#556'; ctx.fillRect(pump.x - 16, 54, 32, 10);
  chain.update(dtc, pump.x, 64, pump.x, bodyTop);
  drawChain(ctx, chain);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(W / 2, 52); ctx.quadraticCurveTo(W / 2, pump.y - 60, pump.x + 14, pump.y - 36); ctx.stroke();
  // Pumpe: ein einziges Teil an der Kette, Einsaugöffnung unten rechts am Körper.
  // Sie pendelt mit der Kette und kippt nach rechts, wenn sie zu tief gräbt.
  ctx.save();
  ctx.translate(pump.x, pump.y);
  ctx.rotate(-chain.endAngle() * 0.6 + sl.tilt * 0.55 + (sl.tipped > 0 ? 0.6 : 0));
  ctx.fillStyle = '#2b2f33'; ctx.fillRect(-22, -36, 44, 36); // Körper
  ctx.fillStyle = '#3a4147'; ctx.fillRect(10, -4, 28, 22); // Ansaugstutzen unten rechts
  ctx.fillStyle = '#0d0f11'; ctx.fillRect(14, 14, 24, 4); // Öffnung
  ctx.fillStyle = '#7a828a'; ctx.fillRect(-22, -10, 32, 4); ctx.fillRect(-6, -48, 12, 8); // Band, Ösen
  ctx.restore();
  // Saugradius und Sog an der Einsaugstelle
  ctx.strokeStyle = sl.suctioning ? '#7fe3ff' : '#ffffff44'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.arc(mouth.x, mouth.y, sim.stats.radius * U, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  if (sl.suctioning) {
    ctx.fillStyle = '#7fe3ff55';
    ctx.beginPath(); ctx.moveTo(mouth.x - 12, mouth.y + 4); ctx.lineTo(mouth.x - 30, mouth.y + 28); ctx.lineTo(mouth.x + 40, mouth.y + 28); ctx.lineTo(mouth.x + 12, mouth.y + 4); ctx.fill();
  }
  if (sl.tipped > 0 || sl.tilt > 0.05) {
    ctx.fillStyle = sl.tipped > 0 || sl.tilt > 0.6 ? '#ff7a6b' : '#ffd24d'; ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(sl.tipped > 0 ? 'UMGEKIPPT!' : 'Schieflage', Math.max(8, pump.x - 40), Math.max(96, pump.y - 62));
  }
  if (sl.clog > 0) {
    ctx.fillStyle = '#ff7a6b'; ctx.font = 'bold 18px system-ui, sans-serif';
    ctx.fillText(`VERSTOPFT ${sl.clog.toFixed(1)}s`, Math.max(8, pump.x - 60), Math.max(116, pump.y - 80));
  }
  if (sl.auto.on) {
    ctx.fillStyle = sl.auto.error ? '#ff7a6b' : '#7bd88f'; ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(sl.auto.error ? 'AUTOMATIK STÖRUNG (R)' : 'AUTOMATIK', W - 230, SLICE_TOP - 8);
  }
  // Arbeitsrichtung: nur nach rechts (und nach unten) wird gesaugt
  ctx.fillStyle = sl.suctioning ? '#7fe3ff' : '#ffffff66';
  ctx.beginPath(); ctx.moveTo(mouth.x + 20, mouth.y - 10); ctx.lineTo(mouth.x + 36, mouth.y - 3); ctx.lineTo(mouth.x + 20, mouth.y + 4); ctx.fill();
  ctx.fillStyle = '#ffffff55'; ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Arbeitsrichtung ▶  (Rückweg saugt nicht)', 12, SLICE_TOP - 8);
  turbidityVeil(ctx, sim, W, H);
}

function turbidityVeil(ctx, sim, w, h) {
  ctx.fillStyle = `rgba(160,150,120,${sim.turbidity * 0.55})`;
  ctx.fillRect(0, 0, w, h);
}
