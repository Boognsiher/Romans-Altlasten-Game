import { CONFIG } from '../config.js';

// Minispiel Schlauch entwirren (nach dem Ankerwerfen, vor dem Absaugen): Der Pumpenschlauch hat ein paar Knoten, jeder wird mit
// einem Tipp (Klick, Leertaste oder grosser Knopf) aufgedreht. Keine Strafe, kein Scheitern: nach spätestens `maxSeconds` entwirrt
// sich der Rest von selbst, das Spielprinzip dauert also nie länger. Reine Logik, kein DOM. Koordinaten = Bildkoordinaten des Querschnitts.
export const HOSE = { W: 768, shoreX: 40, shoreY: 150, pontonX: 728, pontonY: 330, openSeconds: 0.7, hitR: 46 };

export class HoseSim {
  constructor(rng, { twists = CONFIG.hose.twists, maxSeconds = CONFIG.hose.maxSeconds } = {}) {
    this.maxSeconds = maxSeconds;
    this.time = 0;
    this.auto = false; // hat sich der Rest von selbst entwirrt?
    this.over = false;
    this.doneAt = 0;
    const base = Array.from({ length: twists }, (_, i) => (i + 1) / (twists + 1));
    this.twists = base.map((t) => ({ t: Math.min(0.9, Math.max(0.1, t + (rng() - 0.5) * 0.08)), dir: rng() < 0.5 ? 1 : -1, state: 'twisted', open: 0 }));
  }

  // Punkt auf dem Schlauch, t = 0 (Ufer) bis 1 (Ponton): sanfte S-Kurve
  static point(t) {
    const x = HOSE.shoreX + (HOSE.pontonX - HOSE.shoreX) * t;
    const y = HOSE.shoreY + (HOSE.pontonY - HOSE.shoreY) * t + Math.sin(t * Math.PI * 2) * 36;
    return { x, y };
  }

  get left() { return this.twists.filter((k) => k.state !== 'free').length; }
  get free() { return this.twists.length - this.left; }

  // Tipp auf Bildkoordinaten: der nächste Knoten in Reichweite wird aufgedreht. Gibt true zurück, wenn einer getroffen wurde.
  tap(x, y, r = HOSE.hitR) {
    let best = null, bd = r;
    for (const k of this.twists) {
      if (k.state !== 'twisted') continue;
      const p = HoseSim.point(k.t), d = Math.hypot(p.x - x, p.y - y);
      if (d <= bd) { bd = d; best = k; }
    }
    if (!best) return false;
    best.state = 'opening';
    return true;
  }

  // Taste/Knopf: der nächste verdrehte Knoten (vom Ufer her)
  next() {
    const k = this.twists.find((q) => q.state === 'twisted');
    if (!k) return false;
    k.state = 'opening';
    return true;
  }

  update(dt) {
    if (this.over) return;
    this.time += dt;
    if (!this.auto && this.time >= this.maxSeconds) { this.auto = true; for (const k of this.twists) if (k.state === 'twisted') k.state = 'opening'; }
    for (const k of this.twists) {
      if (k.state !== 'opening') continue;
      k.open = Math.min(1, k.open + dt / HOSE.openSeconds);
      if (k.open >= 1) k.state = 'free';
    }
    if (this.twists.every((k) => k.state === 'free')) { this.doneAt += dt; if (this.doneAt >= 0.6) this.over = true; }
  }
}
