// Zentrale Spielbalance. Alle Zahlen hier ändern, nichts in der Logik verstecken.
export const CONFIG = {
  lake: { cols: 48, rows: 30, blobs: 22, toxicBlobs: 7 },
  shiftSeconds: 60, // eine Schicht = ein Arbeitstag
  startMoney: 40000, // CHF
  trancheEveryDays: 7,
  trancheAmount: 25000, // CHF
  deadlineDays: 150,
  bankruptcyLimit: -30000, // darunter: Projekt gestoppt
  winCleanFraction: 0.95,
  disposalCostPerUnit: 60, // CHF pro m³ Schlamm
  toxicCostMultiplier: 2.5,
  pointsPerUnit: 10,
  toxicPointsMultiplier: 3,
  turbidityFineThreshold: 0.7,
  turbidityFinePerSecond: 400, // CHF/s über der Schwelle
};

// Basiswerte ohne Upgrades
export const BASE_STATS = {
  power: 2.0, // m³/s Saugleistung
  radius: 1.8, // Zellen
  speed: 4.0, // Zellen/s
  curtain: 0, // Schlammschürze: reduziert Trübung (0..1)
  suctionSpeedFactor: 0.55, // Ponton ist beim Saugen langsamer
};

// Jedes Upgrade: Stufe n kostet baseCost * growth^n, wirkt über apply()
export const UPGRADES = {
  power: {
    name: 'Saugpumpe',
    desc: 'Mehr m³ pro Sekunde',
    maxLevel: 8, baseCost: 8000, growth: 1.5,
    apply: (s, lvl) => { s.power += lvl * 0.8; },
  },
  radius: {
    name: 'Saugkopf',
    desc: 'Grössere Saugfläche',
    maxLevel: 5, baseCost: 6000, growth: 1.6,
    apply: (s, lvl) => { s.radius += lvl * 0.5; },
  },
  speed: {
    name: 'Ponton-Antrieb',
    desc: 'Schnelleres Fahren',
    maxLevel: 5, baseCost: 5000, growth: 1.5,
    apply: (s, lvl) => { s.speed += lvl * 0.6; },
  },
  curtain: {
    name: 'Schlammschürze',
    desc: 'Weniger Trübung, weniger Bussen',
    maxLevel: 4, baseCost: 7000, growth: 1.6,
    apply: (s, lvl) => { s.curtain = Math.min(0.8, lvl * 0.2); },
  },
};
