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

// Ein Tag in der Anlage. stock = { normal, toxic } in m³ (Rohschlamm im Puffer).
// Gibt das neue Lager, die Chargen und die Kosten zurück; verändert stock nicht.
export function runPlantDay(stock, stats, overclock, rng) {
  const P = CONFIG.plant;
  const total = stock.normal + stock.toxic;
  const capacity = stats.plantCapacity * (overclock ? P.overclockFactor : 1);
  const take = Math.min(total, capacity);
  const out = { processed: take, batches: [], cost: 0, lab: 0, stock: { ...stock } };
  if (take <= 0) return out;

  const toxicShare = stock.toxic / total;
  const probs = classProbabilities(toxicShare, overclock);
  for (let left = take; left > 1e-9; left -= P.batchSize) {
    const vol = Math.min(P.batchSize, left);
    const disposalVol = vol * stats.dewater;
    const cls = pickClass(rng, probs);
    const cost = Math.round((disposalVol * P.classes[cls].price) / 10) * 10;
    out.batches.push({ vol, disposalVol, cls, cost });
    out.cost += cost + P.labFeePerBatch;
    out.lab += P.labFeePerBatch;
  }
  out.stock = { normal: stock.normal - take * (1 - toxicShare), toxic: stock.toxic - take * toxicShare };
  return out;
}
