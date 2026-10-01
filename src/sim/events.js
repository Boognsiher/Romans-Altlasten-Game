// Zufallsereignisse beim Tageswechsel. Neue Ereignisse = neuer Eintrag in der Liste.
export const EVENTS = [
  {
    id: 'pump_repair',
    chance: 0.08,
    text: 'Pumpe verstopft – Reparatur',
    apply: (state, rng) => { const c = Math.round(rng.range(2000, 6000) / 100) * 100; state.money -= c; return { cost: c }; },
  },
  {
    id: 'hose_leak',
    chance: 0.05,
    text: 'Leck am Schlauch – Gewässerschutz-Busse',
    apply: (state, rng) => { const c = Math.round(rng.range(3000, 9000) / 100) * 100; state.money -= c; return { cost: c }; },
  },
  {
    id: 'subsidy',
    chance: 0.04,
    text: 'Kanton spricht Zusatzbeitrag',
    apply: (state, rng) => { const c = Math.round(rng.range(3000, 8000) / 100) * 100; state.money += c; return { gain: c }; },
  },
];
