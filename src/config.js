// Zentrale Spielbalance. Alle Zahlen hier ändern, nichts in der Logik verstecken.
export const CONFIG = {
  lake: { cols: 48, rows: 30, blobs: 22, toxicBlobs: 7 },
  shiftSeconds: 120, // eine Schicht = ein Arbeitstag (Fahren + Absaugen teilen sich die Zeit)
  startMoney: 40000, // CHF
  trancheEveryDays: 7,
  trancheAmount: 25000, // CHF
  deadlineDays: 150,
  bankruptcyLimit: -30000, // darunter: Projekt gestoppt
  winCleanFraction: 0.95,
  // Anlage an Land: entwässert den Schlamm, danach wird jede Charge analysiert und nach VVEA eingestuft
  plant: {
    batchSize: 25, // m³ pro Charge (= eine Probe)
    labFeePerBatch: 400, // CHF Analyse pro Charge
    overclockFactor: 1.5, // Durchsatz beim Übertakten
    overclockRisk: 0.2, // Zuschlag auf das Risiko teurer Klassen
    toxicRisk: 0.8, // Einfluss des Altlasten-Anteils auf das Risiko
    // Preis in CHF pro m³ entwässertes Material
    classes: { B: { name: 'Typ B', price: 90 }, E: { name: 'Typ E', price: 220 }, C: { name: 'Typ C', price: 500 } },
    baseProb: { B: 0.65, E: 0.28, C: 0.07 },
    riskShift: { E: 0.3, C: 0.35 }, // bei Risiko 1: so viel Wahrscheinlichkeit wandert von B zu E bzw. C
  },
  // Harte Schichten: Absaugleistung dort geteilt durch (1 + Härte * factor) -> mehrere Überfahrten
  hard: { blobs: 7, factor: 1.5 },
  // Fremdstoffe verstopfen die Pumpe (Sekunden Zwangspause, Fremdstoff ist danach weg)
  debris: { count: 28, clogSeconds: 3 },
  // Automatik: Stufe 0 = Handbetrieb, 1 = experimentell, 2 = zuverlässig, 3 = voll
  auto: {
    speedFactor: [1, 0.8, 1, 1.25],
    errorRate: [0, 0.08, 0.025, 0], // Fehler pro Sekunde Automatikbetrieb
    errorSeconds: 6, // so lange läuft ein Fehler, wenn niemand eingreift
    clogSeconds: [3, 5, 3, 1.5],
  },
  // Pumpe an der Kette: Einsaugbereich liegt unten rechts. Wer zu tief abträgt, bringt sie zum Kippen.
  pump: {
    offsetX: 1.0, // Einsaugbereich rechts der Pumpe (Zellen)
    offsetY: 0.6, // und unterhalb (Einheiten)
    tiltRate: 0.6, // Schieflage pro Sekunde und Einheit Abtragtiefe (m³ pro gefahrene Zelle) über der Standfestigkeit
    tiltRecover: 0.4, // Erholung pro Sekunde
    tipSeconds: 6, // Zeit, bis die Pumpe wieder aufgerichtet ist
    repairCost: 1500, // CHF pro Umkippen (Kran, Taucher, Kaffee)
  },
  // Tauchdrohne: Abnahme des gereinigten Seegrunds
  drone: { fee: 800, acceptMax: 0.05, winAcceptFraction: 0.9 }, // Restschlamm (m³) pro Zelle für eine Abnahme
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
  suctionSpeedFactor: 0.55, // (derzeit ungenutzt, Fahren und Saugen sind getrennte Instanzen)
  plantCapacity: 50, // m³/Tag, die die Anlage verarbeitet
  bufferCapacity: 150, // m³ Puffer vor der Anlage; ist er voll, muss das Saugen pausieren
  dewater: 0.6, // Volumenanteil nach der Entwässerung (kleiner = weniger Entsorgung)
  stability: 2.0, // Standfestigkeit der Pumpe: so viel m³ pro gefahrene Zelle darf sie abtragen, ohne zu kippen
  autoLevel: 0, // Automatik-Stufe des Saugkopfs
  droneBattery: 60, // Sekunden Flugzeit der Tauchdrohne
  droneRadius: 2, // Scanradius in Zellen
  droneSpeed: 5, // Zellen/s
};

// Jedes Upgrade: Stufe n kostet baseCost * growth^n, wirkt über apply()
export const UPGRADES = {
  power: {
    group: 'ponton',
    name: 'Saugpumpe',
    desc: 'Mehr m³ pro Sekunde',
    maxLevel: 8, baseCost: 8000, growth: 1.5,
    apply: (s, lvl) => { s.power += lvl * 0.8; },
  },
  radius: {
    group: 'ponton',
    name: 'Saugkopf',
    desc: 'Grössere Saugfläche',
    maxLevel: 5, baseCost: 6000, growth: 1.6,
    apply: (s, lvl) => { s.radius += lvl * 0.5; },
  },
  speed: {
    group: 'ponton',
    name: 'Ponton-Antrieb',
    desc: 'Schnelleres Fahren',
    maxLevel: 5, baseCost: 5000, growth: 1.5,
    apply: (s, lvl) => { s.speed += lvl * 0.6; },
  },
  curtain: {
    group: 'ponton',
    name: 'Trübungsschutz',
    desc: 'Kasten um den Saugkopf: weniger Trübung, weniger Bussen',
    maxLevel: 4, baseCost: 7000, growth: 1.6,
    apply: (s, lvl) => { s.curtain = Math.min(0.8, lvl * 0.2); },
  },
  plant: {
    group: 'plant',
    name: 'Entwässerungsanlage',
    desc: 'Mehr Durchsatz und Puffer',
    maxLevel: 6, baseCost: 10000, growth: 1.5,
    apply: (s, lvl) => { s.plantCapacity += lvl * 25; s.bufferCapacity += lvl * 50; },
  },
  dewater: {
    group: 'plant',
    name: 'Filterpresse',
    desc: 'Trockeneres Material, weniger Entsorgungsvolumen',
    maxLevel: 4, baseCost: 9000, growth: 1.6,
    apply: (s, lvl) => { s.dewater = Math.max(0.3, s.dewater - lvl * 0.07); },
  },
  ballast: {
    group: 'ponton',
    name: 'Pumpen-Ballast',
    desc: 'Pumpe steht fester und kippt später',
    maxLevel: 4, baseCost: 6000, growth: 1.5,
    apply: (s, lvl) => { s.stability += lvl * 0.9; },
  },
  auto: {
    group: 'ponton',
    name: 'Automatik',
    desc: 'Stufe 1 experimentell (überwachen!), 2 zuverlässig, 3 voll',
    maxLevel: 3, baseCost: 15000, growth: 1.8,
    apply: (s, lvl) => { s.autoLevel = lvl; },
  },
  drone: {
    group: 'drone',
    name: 'Tauchdrohne',
    desc: 'Mehr Akku und grössere Scanfläche',
    maxLevel: 4, baseCost: 6000, growth: 1.5,
    apply: (s, lvl) => { s.droneBattery += lvl * 15; s.droneRadius += lvl * 0.4; },
  },
};

// Fremdstoffe im See (Index = Wert in lake.debris - 1)
export const DEBRIS = [
  'Einkaufswagen', 'Velo', 'Gartenzwerg', 'Bürostuhl', 'Fischerhut von 1987', 'Stossstange', 'Kinderwagen (leer, hoffentlich)',
];
