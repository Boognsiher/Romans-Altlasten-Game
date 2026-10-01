// Zeichnet den Seegrund und den Ponton. Kennt keine Spiellogik, liest nur Zustand.
export const CELL = 20;

export function sizeCanvas(canvas, lake) {
  canvas.width = lake.cols * CELL;
  canvas.height = lake.rows * CELL;
}

export function drawLake(ctx, lake, sim) {
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
  // Schlauch zum Ufer (oben links)
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(px * 0.4, py * 0.1, px, py); ctx.stroke();
  // Saugbereich
  ctx.strokeStyle = sim.suctioning ? '#7fe3ff' : '#ffffff55'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(px, py, sim.stats.radius * CELL, 0, Math.PI * 2); ctx.stroke();
  // Ponton
  ctx.fillStyle = '#d9dee3'; ctx.fillRect(px - 14, py - 9, 28, 18);
  ctx.fillStyle = '#222'; for (let i = 0; i < 3; i++) ctx.fillRect(px - 12 + i * 9, py + 6, 6, 4);
  // Trübung als Schleier
  ctx.fillStyle = `rgba(160,150,120,${sim.turbidity * 0.55})`;
  ctx.fillRect(0, 0, lake.cols * CELL, lake.rows * CELL);
}
