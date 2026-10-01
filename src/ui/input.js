// Tastatur (WASD/Pfeile + Leertaste) und Zeiger (Ponton folgt, gedrückt = saugen).
export function createInput(canvas) {
  const keys = new Set();
  const pointer = { active: false, down: false, x: 0, y: 0 }; // x,y in Canvas-Pixeln (skaliert)

  addEventListener('keydown', (e) => { keys.add(e.code); if (e.code === 'Space') e.preventDefault(); });
  addEventListener('keyup', (e) => keys.delete(e.code));
  const setPos = (e) => {
    const r = canvas.getBoundingClientRect();
    pointer.x = ((e.clientX - r.left) / r.width) * canvas.width;
    pointer.y = ((e.clientY - r.top) / r.height) * canvas.height;
    pointer.active = true;
  };
  canvas.addEventListener('pointermove', setPos);
  canvas.addEventListener('pointerdown', (e) => { setPos(e); pointer.down = true; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { pointer.down = false; });

  // cellSize/ponton: um Zeigerziel in Bewegungsrichtung umzurechnen
  return function read(ponton, cellSize) {
    let dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    let dy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
    if (!dx && !dy && pointer.active) {
      const tx = pointer.x / cellSize - ponton.x, ty = pointer.y / cellSize - ponton.y;
      const d = Math.hypot(tx, ty);
      if (d > 0.3) { dx = tx / Math.max(d, 1); dy = ty / Math.max(d, 1); }
    }
    return { dx, dy, suction: keys.has('Space') || pointer.down };
  };
}
