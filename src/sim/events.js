// Zufallsereignisse beim Tageswechsel. Neue Ereignisse = neuer Eintrag in der Liste.
export const EVENTS = [
  {
    id: 'pump_repair',
    chance: 0.08,
    text: 'Pumpe verstopft: Im Schlauch steckte ein Einkaufswagen (und ein Velo, aber das war schon drin)',
    apply: (state, rng) => { const c = Math.round(rng.range(2000, 6000) / 100) * 100; state.money -= c; return { cost: c }; },
  },
  {
    id: 'hose_leak',
    chance: 0.05,
    text: 'Schlauch leckt: Der Fischereiverein ist nicht begeistert',
    apply: (state, rng) => { const c = Math.round(rng.range(3000, 9000) / 100) * 100; state.money -= c; return { cost: c }; },
  },
  {
    id: 'subsidy',
    chance: 0.04,
    text: 'Kanton findet im Budget noch einen Zusatzbeitrag (wohl unter dem Sofakissen)',
    apply: (state, rng) => { const c = Math.round(rng.range(3000, 8000) / 100) * 100; state.money += c; return { gain: c }; },
  },
];
