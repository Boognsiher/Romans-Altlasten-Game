import { CONFIG } from '../config.js';

// Minispiel Kran: Seewasserleitung ausbauen. Ein Kran auf dem Ponton hängt mit einem Seil (Pendel) einen Haken ins Wasser.
// Die Leitungsstücke liegen am Seegrund; Haken über ein Stück bringen, greifen, hochziehen, über den Transportkahn fahren
// und sanft absetzen. Wer aus zu grosser Höhe loslässt, beschädigt oder zerbricht das Stück. Reine Simulation, kein DOM.
export const CRANE = {
  W: 16, H: 8, beamH: 7.9, trolleyMin: 0.8, trolleyMax: 14.6, deckX0: 12.2, deckX1: 15.6, deckH: 6.2,
  lMin: 0.5, lMax: 7, segLen: 2, segThick: 0.5, grabR: 0.75, g: 9, terminal: 7, damageV: 2.8, breakV: 5.6,
  trolleySpeed: 3.2, hoistSpeed: 2.4,
};

export class CraneSim {
  constructor(rng, { segments = CONFIG.crane.segments, seconds = CONFIG.crane.seconds } = {}) {
    this.rng = rng;
    this.timeLeft = seconds;
    this.over = false;
    this.tx = 3; this.vt = 0;
    this.L = 2; this.theta = 0; this.omega = 0;
    // Seegrund: flache Mulde um die Leitung, sanfte Hügel sonst
    const ph = rng() * 6;
    this.bed = (x) => 1.4 + 0.35 * Math.sin(x * 0.7 + ph) * Math.min(1, Math.max(0, (x - 10) / 1.5 + 0.6)) * (x > 10 ? 1 : 0.0) + (x > 10 ? 0.4 : 0);
    const gap = 0.3, span = CRANE.segLen + gap, x0 = 1.6;
    this.segs = Array.from({ length: segments }, (_, i) => ({ id: i + 1, x: x0 + CRANE.segLen / 2 + i * span, h: this.bed(x0 + i * span) + CRANE.segThick / 2, vy: 0, state: 'bed', damaged: false }));
    this.carried = null;
    this.stack = 0; // gelieferte Stücke auf dem Kahn
    this.result = { delivered: 0, damaged: 0, broken: 0 };
    this.events = []; // { kind: 'grab' | 'miss' | 'drop' | 'deliver' | 'damage' | 'break' | 'splash' }
  }

  get hookX() { return this.tx + this.L * Math.sin(this.theta); }
  get hookH() { return CRANE.beamH - this.L * Math.cos(this.theta); }

  _deckTop() { return CRANE.deckH + this.stack * 0.25; }
  _onDeck(x) { return x >= CRANE.deckX0 + 0.3 && x <= CRANE.deckX1 - 0.3; }

  // Greifen oder Loslassen: gibt 'grab' | 'miss' | 'drop' zurück
  action() {
    if (this.over) return null;
    if (this.carried) { const s = this.carried; this.carried = null; s.state = 'fall'; s.vy = 0; this.events.push({ kind: 'drop' }); return 'drop'; }
    const hx = this.hookX, hh = this.hookH;
    const s = this.segs.find((q) => q.state === 'bed' && Math.abs(hx - q.x) <= CRANE.grabR && Math.abs(hh - (q.h + CRANE.segThick / 2)) <= CRANE.grabR);
    if (!s) { this.events.push({ kind: 'miss' }); return 'miss'; }
    s.state = 'carried'; this.carried = s; this.events.push({ kind: 'grab' });
    return 'grab';
  }

  // input: { dx, dy (dy>0 = Haken runter) }
  update(dt, input = {}) {
    if (this.over) return;
    const C = CRANE, dx = Math.max(-1, Math.min(1, input.dx || 0)), dy = Math.max(-1, Math.min(1, input.dy || 0));
    this.timeLeft -= dt;
    // Laufkatze: weich beschleunigen; die Trägheit des Hakens ergibt das Pendeln
    const vOld = this.vt;
    this.vt += (dx * C.trolleySpeed - this.vt) * Math.min(1, dt * 4);
    this.tx = Math.max(C.trolleyMin, Math.min(C.trolleyMax, this.tx + this.vt * dt));
    if (this.tx <= C.trolleyMin || this.tx >= C.trolleyMax) this.vt = 0;
    const at = (this.vt - vOld) / Math.max(dt, 1e-3);
    // Seil
    const maxL = Math.min(C.lMax, (C.beamH - (this.bed(this.hookX) + 0.15)) / Math.max(0.3, Math.cos(this.theta)));
    this.L = Math.max(C.lMin, Math.min(maxL, this.L + dy * C.hoistSpeed * dt));
    // Pendel im Wasser (gedämpft, mit Last träger)
    const damp = this.carried ? 0.9 : 0.6;
    const sub = 4, h = dt / sub;
    for (let i = 0; i < sub; i++) {
      this.omega += (-(C.g / this.L) * Math.sin(this.theta) - damp * this.omega - (at / this.L) * Math.cos(this.theta)) * h;
      this.theta += this.omega * h;
    }
    this.theta = Math.max(-1.1, Math.min(1.1, this.theta));
    // Stücke
    if (this.carried) { this.carried.x = this.hookX; this.carried.h = this.hookH - CRANE.segThick / 2 - 0.2; }
    for (const s of this.segs) {
      if (s.state !== 'fall') continue;
      s.vy = Math.min(C.terminal, s.vy + C.g * dt);
      s.h -= s.vy * dt;
      const onDeck = this._onDeck(s.x), floor = (onDeck ? this._deckTop() : this.bed(s.x)) + C.segThick / 2;
      if (s.h > floor) continue;
      s.h = floor;
      const v = s.vy; s.vy = 0;
      if (v >= C.breakV) { s.state = 'broken'; this.result.broken++; this.events.push({ kind: 'break' }); }
      else {
        if (v >= C.damageV) { s.damaged = true; this.events.push({ kind: 'damage' }); }
        if (onDeck) { s.state = 'delivered'; this.stack = Math.min(3, this.stack + 1); this.result.delivered++; if (s.damaged) this.result.damaged++; this.events.push({ kind: 'deliver' }); }
        else { s.state = 'bed'; this.events.push({ kind: 'splash' }); }
      }
    }
    if (this.segs.every((s) => s.state === 'delivered' || s.state === 'broken') || this.timeLeft <= 0) { this.timeLeft = Math.max(0, this.timeLeft); this.over = true; }
  }
}
