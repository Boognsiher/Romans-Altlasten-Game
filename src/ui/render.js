// Zeichnet Karte und Querschnitt. Kennt keine Spiellogik, liest nur Zustand.
import { SLICE } from '../sim/slice.js';

export const CELL = 20; // Karte: Pixel pro Zelle
export const U = 48; // Querschnitt: Pixel pro Einheit
const SLICE_TOP = 60; // Wasseroberfläche (darüber der Ponton)
const BEDROCK = 60; // Höhe des Felsbands unten

export function sizeMap(canvas, lake) { canvas.width = lake.cols * CELL; canvas.height = lake.rows * CELL; }
export function sizeSlice(canvas) { canvas.width = SLICE.cols * U; canvas.height = SLICE_TOP + SLICE.viewH * U + BEDROCK; }

// ---------- Instanz 1: Karte ----------
export function drawMap(ctx, lake, sim) {
  const { cols, rows, mass, toxic } = lake;
  ctx.fillStyle = '#12304a';
  ctx.fillRect(0, 0, cols * CELL, rows * CELL);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x, m = mass[i];
      if (m <= 0) continue;
      const a = Math.min(1, 0.25 + m / 8);
      ctx.fillStyle = toxic[i] ? `rgba(200,70,60,${a})` : `rgba(120,95,60,${a})`;
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
  if (!sim) return;
  const px = sim.x * CELL, py = sim.y * CELL;
  // Fenster, das der Querschnitt hier abdecken würde
  const x0 = Math.min(Math.max(Math.round(sim.x) - SLICE.cols / 2, 0), cols - SLICE.cols);
  ctx.strokeStyle = '#7fe3ff'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
  ctx.strokeRect(x0 * CELL, sim.row * CELL, SLICE.cols * CELL, CELL);
  ctx.setLineDash([]);
  // Schlauch zum Ufer (oben links)
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(px * 0.4, py * 0.1, px, py); ctx.stroke();
  // Ponton
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(px - 14, py - 9, 28, 18);
  ctx.fillStyle = '#222'; for (let i = 0; i < 3; i++) ctx.fillRect(px - 12 + i * 9, py + 6, 6, 4);
  turbidityVeil(ctx, sim, cols * CELL, rows * CELL);
}

// ---------- Instanz 2: Querschnitt ----------
const yOf = (h) => SLICE_TOP + (SLICE.viewH - h) * U;
export function sliceHeadScreen(sl) { return { x: (sl.x - sl.x0) * U, y: yOf(sl.h) }; }

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
  // Schlammprofil
  const m = (c) => lake.mass[lake.idx(sl.x0 + c, sl.row)];
  ctx.beginPath(); ctx.moveTo(0, yOf(0));
  ctx.lineTo(0, yOf(m(0)));
  for (let c = 0; c < SLICE.cols; c++) ctx.lineTo((c + 0.5) * U, yOf(m(c)));
  ctx.lineTo(W, yOf(m(SLICE.cols - 1))); ctx.lineTo(W, yOf(0)); ctx.closePath();
  ctx.fillStyle = '#7a5f3c'; ctx.fill();
  ctx.strokeStyle = '#a58760'; ctx.lineWidth = 3; ctx.stroke();
  // Altlasten-Fässer in giftigen Zellen
  for (let c = 0; c < SLICE.cols; c++) {
    const i = lake.idx(sl.x0 + c, sl.row);
    if (!lake.toxic[i] || lake.mass[i] < 0.3) continue;
    const cx = (c + 0.5) * U, cy = yOf(lake.mass[i] / 2);
    ctx.fillStyle = '#b8473c'; ctx.fillRect(cx - 14, cy - 17, 28, 34);
    ctx.fillStyle = '#e9d36a'; ctx.fillRect(cx - 14, cy - 4, 28, 6);
    ctx.strokeStyle = '#3a0f0b'; ctx.lineWidth = 2; ctx.strokeRect(cx - 14, cy - 17, 28, 34);
  }
  // Ponton oben, Schlauch zum Saugkopf
  const pxm = W / 2, head = sliceHeadScreen(sl);
  ctx.strokeStyle = '#111'; ctx.lineWidth = 8;
  ctx.beginPath(); ctx.moveTo(pxm, 52); ctx.quadraticCurveTo(pxm, head.y - 40, head.x, head.y - 14); ctx.stroke();
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(pxm - 70, 26, 140, 30);
  ctx.fillStyle = '#222'; for (let i = 0; i < 5; i++) ctx.beginPath(), ctx.arc(pxm - 56 + i * 28, 42, 7, 0, Math.PI * 2), ctx.fill();
  ctx.fillStyle = '#9aa6b0'; ctx.fillRect(pxm - 20, 8, 40, 20);
  // Saugkopf, Radius, Sog
  ctx.strokeStyle = sl.suctioning ? '#7fe3ff' : '#ffffff44'; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.arc(head.x, head.y, sim.stats.radius * U, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
  if (sl.suctioning) {
    ctx.fillStyle = '#7fe3ff55';
    ctx.beginPath(); ctx.moveTo(head.x - 14, head.y); ctx.lineTo(head.x - 40, head.y + 22); ctx.lineTo(head.x + 40, head.y + 22); ctx.lineTo(head.x + 14, head.y); ctx.fill();
  }
  ctx.fillStyle = '#2b2f33'; ctx.fillRect(head.x - 14, head.y - 14, 28, 14);
  ctx.fillStyle = '#555c63'; ctx.fillRect(head.x - 18, head.y - 4, 36, 6);
  // Arbeitsrichtung: nur nach rechts (und nach unten) wird gesaugt
  ctx.fillStyle = sl.suctioning ? '#7fe3ff' : '#ffffff66';
  ctx.beginPath(); ctx.moveTo(head.x + 24, head.y - 14); ctx.lineTo(head.x + 40, head.y - 7); ctx.lineTo(head.x + 24, head.y); ctx.fill();
  ctx.fillStyle = '#ffffff55'; ctx.font = '14px system-ui, sans-serif';
  ctx.fillText('Arbeitsrichtung ▶  (Rückweg saugt nicht)', 12, SLICE_TOP - 8);
  turbidityVeil(ctx, sim, W, H);
}

function turbidityVeil(ctx, sim, w, h) {
  ctx.fillStyle = `rgba(160,150,120,${sim.turbidity * 0.55})`;
  ctx.fillRect(0, 0, w, h);
}
