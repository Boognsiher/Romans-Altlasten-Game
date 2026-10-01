// Tastatur (WASD/Pfeile, Leertaste) und Zeiger. Einmal-Tasten (Anker werfen/lichten) via tap().
export function createInput(canvas) {
  const keys = new Set();
  const taps = new Set();
  const pointer = { active: false, down: false, x: 0, y: 0 }; // Canvas-Pixel

  addEventListener('keydown', (e) => {
    if (!e.repeat) taps.add(e.code);
    keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  });
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
  canvas.addEventListener('pointerleave', () => { if (!pointer.down) pointer.active = false; });

  return {
    // cur = Position des gesteuerten Objekts in Canvas-Pixeln. holdToMove: Zeiger steuert nur bei gedrückter Taste.
    read(cur, { holdToMove = false } = {}) {
      let dx = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
      let dy = (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) - (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0);
      if (!dx && !dy && pointer.active && (!holdToMove || pointer.down)) {
        const tx = pointer.x - cur.x, ty = pointer.y - cur.y, d = Math.hypot(tx, ty);
        if (d > 8) { const k = Math.min(1, d / 40); dx = (tx / d) * k; dy = (ty / d) * k; }
      }
      return { dx, dy, suction: keys.has('Space') || pointer.down };
    },
    tap(...codes) { return codes.some((c) => taps.has(c)); },
    endFrame() { taps.clear(); },
  };
}
