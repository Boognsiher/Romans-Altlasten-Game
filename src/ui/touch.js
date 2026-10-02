import { snapStick } from './touch-logic.js';

// Touch-Bedienung: Daumen-Stick links (vier Richtungen), grosser Knopf rechts
// (Karte: Anker werfen, Querschnitt: Saugen halten). Beide arbeiten unabhängig voneinander (Mehrfinger).
const KNOB_RADIUS = 38;

export function setupTouch(input, hooks) {
  const root = document.getElementById('touch-ui'), stick = document.getElementById('stick'), knob = document.getElementById('knob');
  const act = document.getElementById('act');
  root.hidden = false;
  document.body.classList.add('touch');
  let mode = 'map';

  // --- Stick ---
  let stickId = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect(), vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
    const s = snapStick(vx, vy, 14, input.virtual);
    input.virtual.dx = s.dx; input.virtual.dy = s.dy;
    const len = Math.hypot(vx, vy) || 1, k = Math.min(1, KNOB_RADIUS / len);
    knob.style.transform = `translate(${vx * k}px, ${vy * k}px)`;
  };
  const endStick = (e) => {
    if (e.pointerId !== stickId) return;
    stickId = null; input.virtual.dx = 0; input.virtual.dy = 0; knob.style.transform = '';
  };
  stick.addEventListener('pointerdown', (e) => { stickId = e.pointerId; stick.setPointerCapture(e.pointerId); moveStick(e); e.preventDefault(); });
  stick.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) moveStick(e); });
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);

  // --- Aktionsknopf ---
  let actId = null;
  const endAct = (e) => { if (e.pointerId === actId) { actId = null; input.virtual.suction = false; act.classList.remove('held'); } };
  act.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (mode === 'map') { hooks.anchor(); return; }
    if (mode === 'slice') { actId = e.pointerId; act.setPointerCapture(e.pointerId); input.virtual.suction = true; act.classList.add('held'); }
  });
  act.addEventListener('pointerup', endAct);
  act.addEventListener('pointercancel', endAct);
  for (const el of [stick, act]) el.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    setMode(m) {
      if (m === mode) return;
      mode = m;
      if (m !== 'slice') { input.virtual.suction = false; act.classList.remove('held'); }
      if (m !== 'map' && m !== 'slice') { input.virtual.dx = 0; input.virtual.dy = 0; }
      act.textContent = { map: '⚓ Anker', slice: '🌀 Saugen', drone: '🛸 Drohne' }[m];
      act.disabled = m === 'drone';
    },
  };
}
