import { snapStick } from './touch-logic.js';

// Touch-Bedienung: Daumen-Stick links (vier Richtungen), grosser Knopf rechts
// (Karte: Anker werfen, Querschnitt: Saugen halten). Beide arbeiten unabhängig voneinander (Mehrfinger).
const KNOB_RADIUS = 38;

export function setupTouch(input, hooks) {
  const root = document.getElementById('touch-ui'), stick = document.getElementById('stick'), knob = document.getElementById('knob');
  const act = document.getElementById('act'), dpad = document.getElementById('dpad');
  root.hidden = false;
  document.body.classList.add('touch');
  let mode = 'map';
  let analog = false; // Drohne: freier Stick in alle Richtungen statt Einrasten auf eine Achse

  // --- Stick ---
  let stickId = null;
  const moveStick = (e) => {
    const r = stick.getBoundingClientRect(), vx = e.clientX - (r.left + r.width / 2), vy = e.clientY - (r.top + r.height / 2);
    let s;
    if (analog) { // stufenlos: Ausschlag = Tempo
      const len = Math.hypot(vx, vy), k = len < 14 ? 0 : Math.min(1, len / (KNOB_RADIUS * 1.4)) / len;
      s = { dx: vx * k, dy: vy * k };
    } else s = snapStick(vx, vy, 14, input.virtual);
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

  // --- Pfeil-Knöpfe für die Pumpe (Querschnitt): halten = fahren ---
  const pressed = new Map(); // pointerId -> Richtung
  const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  const applyDpad = () => {
    let dx = 0, dy = 0;
    for (const dir of pressed.values()) { dx += DIRS[dir][0]; dy += DIRS[dir][1]; }
    input.virtual.dx = Math.max(-1, Math.min(1, dx)); input.virtual.dy = Math.max(-1, Math.min(1, dy));
  };
  for (const btn of dpad.querySelectorAll('.dp')) {
    const release = (e) => { if (pressed.delete(e.pointerId)) { btn.classList.remove('held'); applyDpad(); } };
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); pressed.set(e.pointerId, btn.dataset.dir); btn.classList.add('held'); applyDpad(); });
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    btn.addEventListener('lostpointercapture', release);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // --- Aktionsknopf ---
  let actId = null;
  const endAct = (e) => { if (e.pointerId === actId) { actId = null; input.virtual.suction = false; act.classList.remove('held'); } };
  act.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (mode === 'map') { hooks.anchor(); return; }
    if (mode === 'drone') { hooks.recall(); return; }
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
      analog = m === 'drone';
      pressed.clear(); for (const b of dpad.querySelectorAll('.dp')) b.classList.remove('held');
      stick.hidden = m === 'slice'; dpad.hidden = m !== 'slice'; // Pumpe: nur Pfeil-Knöpfe, sonst Stick
      input.virtual.dx = 0; input.virtual.dy = 0; knob.style.transform = '';
      act.textContent = { map: '⚓ Anker', slice: '🌀 Saugen', drone: '↩ Einholen' }[m];
    },
  };
}
