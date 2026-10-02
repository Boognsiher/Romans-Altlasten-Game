import { CONFIG } from '../config.js';

// Wahrscheinlichkeiten der VVEA-Klassen für eine Charge.
// Mehr Altlasten im Material und Übertakten schieben Wahrscheinlichkeit von B zu E und C.
export function classProbabilities(toxicShare, overclock) {
  const P = CONFIG.plant;
  const risk = Math.min(1, toxicShare * P.toxicRisk + (overclock ? P.overclockRisk : 0));
  const E = P.baseProb.E + risk * P.riskShift.E;
  const C = P.baseProb.C + risk * P.riskShift.C;
  return { B: Math.max(0, 1 - E - C), E, C };
}

export function pickClass(rng, probs) {
  const r = rng();
  if (r < probs.B) return 'B';
  if (r < probs.B + probs.E) return 'E';
  return 'C';
}

// Eine Charge analysieren und entsorgen: Klasse per Los (abhängig vom Altlasten-Anteil und vom Übertakten),
// Kosten = entwässertes Volumen * Klassenpreis, dazu die Analysegebühr.
export function processBatch(vol, toxicShare, stats, overclock, rng) {
  const P = CONFIG.plant;
  const disposalVol = vol * stats.dewater;
  const cls = pickClass(rng, classProbabilities(toxicShare, overclock));
  const cost = Math.round((disposalVol * P.classes[cls].price) / 10) * 10;
  return { vol, disposalVol, cls, cost, lab: Math.round(P.labFeePerBatch * Math.max(0.2, vol / P.batchSize)) };
}
