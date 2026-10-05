// Zentrale Spielbalance. Alle Zahlen hier ändern, nichts in der Logik verstecken.
export const CONFIG = {
  // Passwort vor dem Start: SHA-256 von "altlasten:<Passwort>" (leer = kein Passwort). Neu setzen: node tools/set-password.mjs <Passwort>
  passwordHash: '50c63e46b626d00714b1a06168a3e4bc528f33d020d02827729524c71009c3dc',
  lake: { cols: 48, rows: 30, blobs: 22, toxicBlobs: 7 },
  // Das Spiel läuft in Echtzeit. Gewonnen hat, wer am Ende am meisten Geld hat.
  daySeconds: 15, // ein Spieltag in Sekunden (150 Tage = 37,5 Minuten)
  // Vergütung pro abgesaugtem m³ belasteter Schicht (zu tief abgetragener Boden wird nicht bezahlt).
  // Die Entsorgung kostet im Schnitt ca. 120 CHF/m³; der Rest ist deine Marge. Altlasten sind teurer in der Entsorgung, also besser bezahlt.
  pay: { perM3: 260, toxicMultiplier: 1.5 },
  startMoney: 40000, // CHF
  deadlineDays: 150, // danach saniert eine Fremdfirma den Rest gegen Rechnung
  deadline: { externalCostPerM3: 380 }, // CHF pro m³ (Abtrag, Entsorgung und Abnahme zum Notfalltarif)
  bankruptcyLimit: -30000, // darunter: Projekt gestoppt
  winCleanFraction: 0.95,
  // Anlage an Land: entwässert den Schlamm, danach wird jede Charge analysiert und nach VVEA eingestuft
  plant: {
    batchSize: 25, // m³ pro Charge (= eine Probe)
    labFeePerBatch: 250, // CHF Analyse pro volle Charge (angebrochene Chargen anteilig, mindestens 20%)
    overclockFactor: 1.5, // Durchsatz beim Übertakten
    overclockRisk: 0.2, // Zuschlag auf das Risiko teurer Klassen
    toxicRisk: 0.8, // Einfluss des Altlasten-Anteils auf das Risiko
    // Preis in CHF pro m³ entwässertes Material
    classes: { B: { name: 'Typ B', price: 60 }, E: { name: 'Typ E', price: 150 }, C: { name: 'Typ C', price: 320 } },
    baseProb: { B: 0.65, E: 0.28, C: 0.07 },
    riskShift: { E: 0.3, C: 0.35 }, // bei Risiko 1: so viel Wahrscheinlichkeit wandert von B zu E bzw. C
  },
  // Der Kasten unter dem Ponton: Pumpe und Drohne arbeiten immer auf so vielen Karten-Zeilen gleichzeitig.
  // Der Querschnitt zeigt die mittlere Zeile; die Pumpenleistung verteilt sich auf alle Zeilen des Kastens.
  box: { rows: 5 },
  // Die belastete Schicht ist überall gleich dick und folgt dem unebenen Seegrund (Sollsohle = Oberfläche - thickness).
  // Darunter liegt fester, sauberer Untergrund: wer dort weitersaugt, trägt zu viel ab (Übertiefung).
  layer: {
    thickness: 1, // m
    cellArea: 4, // m² pro Rasterzelle: m³ = Dicke * cellArea
    snap: 0.08, // m: so kleine Reste gelten beim Absaugen als erledigt (kleiner als drone.acceptMax)
    tolerance: 0.15, // m unter der Sollsohle, die noch als sauber abgetragen gelten (Schnitte sind nie exakt)
    groundFirmness: 0.35, // Untergrund lässt sich nur mit diesem Anteil der Leistung abtragen
    overdigCostPerM3: 120, // CHF pro m³ zu viel abgetragen (Wiederauffüllung, Gewässerschutz)
  },
  // Harte Schichten: Absaugleistung dort geteilt durch (1 + Härte * factor) -> mehrere Überfahrten
  hard: { blobs: 7, factor: 1.5 },
  // Fremdstoffe verstopfen die Pumpe (Sekunden Zwangspause, Fremdstoff ist danach weg)
  debris: { count: 28, clogSeconds: 6 }, // ohne Eingreifen so lange verstopft; das Freispül-Minispiel verkürzt es
  // Freispülen (Minispiel bei Verstopfung, nur Handbetrieb): Marker pendelt über den Balken, im grünen Bereich auslösen.
  // Fremdstoffe unterscheiden sich im Freispülen: Breite des grünen Bereichs, nötige Treffer, Starttempo und Wartezeit ohne Eingreifen (s). Reihenfolge wie DEBRIS.
  debrisInfo: [
    { zone: 0.24, hits: 2, speed: 1.1, clog: 6 }, // Einkaufswagen
    { zone: 0.22, hits: 2, speed: 1.2, clog: 6 }, // Velo
    { zone: 0.34, hits: 1, speed: 1.0, clog: 4 }, // Gartenzwerg: harmlos
    { zone: 0.20, hits: 2, speed: 1.3, clog: 7 }, // Bürostuhl: Rollen verheddern sich
    { zone: 0.42, hits: 1, speed: 0.9, clog: 3 }, // Fischerhut von 1987: weich
    { zone: 0.16, hits: 3, speed: 1.2, clog: 9 }, // Stossstange: sperrig
    { zone: 0.18, hits: 3, speed: 1.0, clog: 8 }, // Kinderwagen: Nerven
  ],
  // Abnahmezertifikat je Kasten: ab minFraction abgenommener Zellen stellt die Drohne eins aus; eingereicht wird es 'days' Tage
  // geprüft, dann kommt die Prämie. Sie steigt mit der Qualität (Anteil sauberer Zellen über der Mindestquote, abzüglich Übertiefung).
  cert: { minFraction: 0.9, minNewCells: 10, fee: 300, days: 3, perCell: 60, maxBonus: 1.0, gold: 0.8, silver: 0.4 },
  // Bauleiter Bruno (Tipps): firstAfter = Sekunden bis zum ersten Tipp, gap = Mindestabstand zwischen Tipps, tipCooldown = derselbe Tipp frühestens wieder nach,
  // tau/eventWindow = Glättung und Fenster der Messwerte, Schwellen = ab wann etwas als 'immer' gilt
  advisor: { firstAfter: 20, gap: 55, tipCooldown: 240, tau: 30, eventWindow: 120, bufferFull: 0.45, turbidity: 0.55, overRate: 0.04, richMoney: 50000 },
  // Kran-Minispiel (Seewasserleitung ausbauen): Aufträge tauchen ab 'firstOfferDay' alle 'everyDays' Tage auf und verfallen nach 'expireDays'
  crane: { segments: 4, seconds: 80, payPer: 2200, damagedShare: 0.5, brokenFine: 800, allBonus: 2500, fee: 400, firstOfferDay: 6, everyDays: [14, 22], expireDays: 9 },
  // Schlauch entwirren nach dem Ankerwerfen: Knotenzahl, Obergrenze in Sekunden (danach entwirrt er sich von selbst, keine Strafe)
  hose: { twists: 3, maxSeconds: 20, byAuto: [3, 1, 0, 0] }, // byAuto: Knoten je Automatik-Stufe (Stufe 1 übersieht einen, ab Stufe 2 prüft sie alles selbst)
  refundShare: 0.75, // beim Rückbau einer Ausbaustufe gibt es so viel der Investition zurück
  unclog: { hits: 2, zone: 0.24, speed: 1.1, speedUp: 1.4, missPenalty: 1.0 },
  // Automatik: Stufe 0 = Handbetrieb, 1 = experimentell, 2 = zuverlässig, 3 = voll
  auto: {
    speedFactor: [1, 0.8, 1, 1.25],
    errorRate: [0, 0.08, 0.025, 0], // Fehler pro Sekunde Automatikbetrieb
    errorSeconds: 6, // so lange läuft ein Fehler, wenn niemand eingreift
    clogSeconds: [3, 5, 3, 1.5],
  },
  // Pumpe an der Kette: Einsaugbereich liegt unten rechts. Wer zu tief abträgt, bringt sie zum Kippen.
  pump: {
    offsetX: 0.3, // Einsaugöffnung rechts der Pumpenmitte (Zellen): unten vorne am Pumpenkörper
    offsetY: 0.1, // und knapp unterhalb des Pumpenbodens (Einheiten)
    fullDraw: 2.0, // Summe der Saugwichte, ab der die volle Leistung ankommt: je weiter der Saugmund vom Material, desto schwächer
    minTravel: 1.0, // Zellen/s: so schnell gilt die Pumpe mindestens als bewegt (Stillstand = tiefer Schnitt)
    tiltRate: 0.6, // Schieflage pro Sekunde und Einheit Abtragtiefe (m³ pro gefahrene Zelle) über der Standfestigkeit
    tiltRecover: 0.4, // Erholung pro Sekunde
    liftTolerance: 0.3, // so weit (m) darf Gelände die Pumpe über die eingestellte Höhe heben, ohne dass sie schief hängt
    liftTiltRate: 0.5, // Schieflage pro Sekunde und Meter darüber
    tipSeconds: 6, // Zeit, bis die Pumpe wieder aufgerichtet ist
    repairCost: 1500, // CHF pro Umkippen (Kran, Taucher, Kaffee)
  },
  // Echolot: lotet das Fenster vor dem Abtrag aus; die Automatik fährt die eingestellte Abtragsdicke an.
  echolot: {
    noise: [0, 0.12, 0.04], // Messfehler (m) je Ausbaustufe, ±
    doneEps: 0.03, // so nah an der Zielhöhe gilt eine Spalte als fertig
    defaultCut: 1.0, // gewünschte Abtragsdicke in m (= ganze belastete Schicht)
    minCut: 0.1, maxCut: 1.5,
  },
  // Nachtragsmanagement: Vorkommnisse im See (Fremdstoffe, harte Schicht, Fässer) lassen sich beim Bauherrn als Zusatzleistung abrechnen.
  // Je höher die Forderung gegenüber dem tatsächlichen Aufwand, desto unwahrscheinlicher die Genehmigung; Dokumentation hilft.
  claims: {
    maxOpen: 6, // so viele Entwürfe gleichzeitig; ältere verfallen
    expireSeconds: 150, // 10 Tage: danach ist der Nachtrag verjährt
    reviewSeconds: 30, // 2 Tage Prüfung durch den Bauherrn
    fee: 200, // CHF Aufwand pro eingereichtem Nachtrag (Juristin, Kopierer, Kaffee)
    minMarkup: 1.0, maxMarkup: 2.0, defaultMarkup: 1.2, // Forderung = Aufwand * Aufschlag
    baseAccept: 0.95, markupPenalty: 0.6, // Chance = 95% - 60% * (Aufschlag - 1) + Dokumentation
    partialBand: 0.2, partialShare: 0.5, // knapp daneben: der Bauherr zahlt die Hälfte
    debris: [1000, 2500], // CHF Sonderentsorgung je Fremdstoff
    hardThreshold: 50, hardPerM3: 80, // je 50 m³ harte Schicht, CHF pro m³ Mehraufwand
    toxicThreshold: 30, toxicFair: 5000, // je 30 m³ Altlasten (Fassfund), CHF
  },
  // Fossilienfunde: liegen im festen Untergrund, die Drohne entdeckt sie, das Museum zahlt für die Bergung.
  // Wer in der Übertiefung darüber saugt, zerstört sie (und zahlt eine Busse).
  fossils: {
    count: 14, depthBelowTarget: 0.5, // m unter der Sollsohle: so tief muss man schon graben, um sie zu zerstören
    recoverFee: [400, 900], value: [2000, 6000], recoverSeconds: 30, // Bergung (CHF), Museumspreis (CHF), 2 Tage
    destroyFine: 2500,
  },
  // Zusatzaufträge der Gemeinde: eine Zone des Sees bis zu einem Termin sauber und abgenommen = Prämie
  jobs: {
    firstAtDay: 20, everyDays: [22, 35], offerDays: 8, dueDays: 25, maxOpen: 3,
    minInitialCells: 20, zoneW: [7, 10], zoneH: [5, 7],
    bonusBase: 6000, bonusPerM3: 60, penaltyShare: 0.3, // verpasst: 30% der Prämie als Konventionalstrafe
    cleanNeeded: 0.97, acceptedNeeded: 0.9,
  },
  pumpSpeed: { min: 0.2, max: 1, default: 1 }, // Tempo-Regler der Pumpe (Anteil des Höchsttempos)
  // Tauchdrohne: Abnahme des gereinigten Seegrunds und Befliegungsdaten
  drone: {
    fee: 800, acceptMax: 0.12, winAcceptFraction: 0.9, // höchstens so viel Restschicht (m) pro Zelle für eine Abnahme
    docPerCell: 8, // CHF, die die Behörde pro neu dokumentierter Zelle zahlt (vorher und nachher, je einmal)
    // Die Drohne taucht nur im Kasten unter dem Ponton (Querschnittsfenster). Sie sieht nur im Lichtkegel in Fahrtrichtung,
    // leicht nach unten; gescannt wird nur, was beleuchtet ist, wenn sie langsam und nah am Boden fährt.
    beam: {
      halfAngle: 0.38, // rad: halber Öffnungswinkel des Lichtkegels (ca. 22°)
      baseTilt: 0.42, // rad: Lichtkegel zeigt leicht nach unten (ca. 24°)
      scanSeconds: 0.8, // so lange muss eine Spalte unter idealen Bedingungen beleuchtet sein
      maxScanSpeed: 2.2, // Einheiten/s: schneller als das wird nichts mehr gescannt
      clearance: 0.3, // Mindestabstand zum Boden
    },
  },
  turbidityFineThreshold: 0.8,
  turbidityFinePerSecond: 150, // CHF/s über der Schwelle
  turbidityGain: 30, // Trübung steigt mit Pumpenleistung / turbidityGain pro Sekunde (kleiner = trüber)
  turbidityDecay: 0.08, // und sinkt pro Sekunde um diesen Betrag
};

// Basiswerte ohne Upgrades
export const BASE_STATS = {
  power: 2.0, // m³/s Saugleistung
  radius: 1.8, // Zellen
  speed: 4.0, // Zellen/s (Ponton auf der Karte)
  headSpeed: 4.8, // Einheiten/s: Höchsttempo der Pumpe an Katze und Kette (Tempo-Regler 20-100% davon)
  curtain: 0, // Schlammschürze: reduziert Trübung (0..1)
  suctionSpeedFactor: 0.55, // (derzeit ungenutzt, Fahren und Saugen sind getrennte Instanzen)
  plantCapacity: 0.8, // m³/s, die die Anlage verarbeitet
  bufferCapacity: 150, // m³ Puffer vor der Anlage; ist er voll, muss das Saugen pausieren
  dewater: 0.6, // Volumenanteil nach der Entwässerung (kleiner = weniger Entsorgung)
  stability: 0.7, // Standfestigkeit der Pumpe: so viele m Abtragtiefe pro gefahrene Zelle verträgt sie, ohne zu kippen
  docBonus: 0, // Dokumentation: erhöht die Chance, dass Nachträge genehmigt werden
  autoLevel: 0, // Automatik-Stufe des Saugkopfs
  echolot: 0, // Echolot-Stufe (0 = keins)
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
    apply: (s, lvl) => { s.plantCapacity += lvl * 0.4; s.bufferCapacity += lvl * 50; },
  },
  dewater: {
    group: 'plant',
    name: 'Filterpresse',
    desc: 'Trockeneres Material, weniger Entsorgungsvolumen',
    maxLevel: 4, baseCost: 9000, growth: 1.6,
    apply: (s, lvl) => { s.dewater = Math.max(0.3, s.dewater - lvl * 0.07); },
  },
  winch: {
    group: 'ponton',
    name: 'Katze & Winde',
    desc: 'Pumpe fährt und taucht schneller (Höchsttempo; mit dem Tempo-Regler stellst du es ein)',
    maxLevel: 5, baseCost: 5000, growth: 1.5,
    apply: (s, lvl) => { s.headSpeed += lvl * 0.7; },
  },
  ballast: {
    group: 'ponton',
    name: 'Pumpen-Ballast',
    desc: 'Pumpe steht fester und kippt später',
    maxLevel: 4, baseCost: 6000, growth: 1.5,
    apply: (s, lvl) => { s.stability += lvl * 0.25; },
  },
  echolot: {
    group: 'ponton',
    name: 'Echolot',
    desc: 'Lotet den Seegrund vor dem Abtrag aus: die Automatik fährt die gewünschte Abtragsdicke an (Stufe 2 misst genauer)',
    maxLevel: 2, baseCost: 12000, growth: 1.8,
    apply: (s, lvl) => { s.echolot = lvl; s.docBonus += lvl * 0.04; }, // Messprotokolle zählen als Beleg
  },
  auto: {
    group: 'ponton',
    name: 'Automatik',
    desc: 'Stufe 1 experimentell (überwachen!), 2 zuverlässig, 3 voll',
    maxLevel: 3, baseCost: 15000, growth: 1.8,
    apply: (s, lvl) => { s.autoLevel = lvl; },
  },
  docs: {
    group: 'office',
    name: 'Baustellen-Dokumentation',
    desc: 'Fotos, Lieferscheine, Messprotokolle: Nachträge werden eher genehmigt',
    maxLevel: 3, baseCost: 5000, growth: 1.7,
    apply: (s, lvl) => { s.docBonus += lvl * 0.08; },
  },
  drone: {
    group: 'drone',
    name: 'Tauchdrohne',
    desc: 'Mehr Akku und grössere Scanfläche',
    maxLevel: 4, baseCost: 6000, growth: 1.5,
    apply: (s, lvl) => { s.droneBattery += lvl * 15; s.droneRadius += lvl * 0.4; },
  },
};

// Fossilien im Untergrund (Index = Wert in lake.fossil - 1)
export const FOSSILS = [
  'Ammonit', 'Trilobit', 'Ichthyosaurier-Wirbel', 'Haizahn (gross)', 'Riesenmuschel', 'Saurier-Rippe',
  'Plesiosaurier (oder ein Gartenschlauch)',
];

// Fremdstoffe im See (Index = Wert in lake.debris - 1)
export const DEBRIS = [
  'Einkaufswagen', 'Velo', 'Gartenzwerg', 'Bürostuhl', 'Fischerhut von 1987', 'Stossstange', 'Kinderwagen (leer, hoffentlich)',
];

// ---------- Levels ----------
// Jedes Level ändert Seegrund (lake: Überschreibungen für Blobs, harte Stellen, Fremdstoffe, Funde, Relief), Farben, Namen
// (debrisNames/fossilNames, gleiche Reihenfolge und Länge wie DEBRIS/FOSSILS, damit die Schwierigkeit passt) und ein paar Zahlen.
// Freigeschaltet wird ein Level, wenn das vorherige mit positivem Endstand abgeschlossen ist.
export const LEVELS = [
  {
    id: 'uetikon', name: 'Uetikon: Chemiefabrik-Areal', short: 'Uetikon',
    blurb: 'Der Klassiker: braune Altlasten, ein paar Fässer, ein Bürostuhl. Zum Warmwerden.',
    lake: {}, payMult: 1, startMoney: 40000, deadlineDays: 150, turbidityMult: 1,
    palette: { layer: '#7a5f3c', edge: '#a58760', map: [120, 95, 60], particle: '#b99a6c' },
    debrisNames: DEBRIS, fossilNames: FOSSILS,
  },
  {
    id: 'horgen', name: 'Horgen: Papierfabrik', short: 'Horgen',
    blurb: 'Weisser Faserbrei so weit das Auge reicht: grosse Fläche, flach, kaum Fässer, dafür viel Büro-Inventar und milchige Trübung.',
    lake: { blobs: 34, toxicBlobs: 2, hardBlobs: 5, debrisCount: 40, fossilCount: 5, relief: 0.45 }, payMult: 0.85, startMoney: 45000, deadlineDays: 150, turbidityMult: 1.5,
    palette: { layer: '#e7e4da', edge: '#ffffff', map: [236, 233, 223], particle: '#f4f2ea' },
    debrisNames: ['Papierrolle', 'Palette', 'Aktenordner', 'Bürostuhl (Chefetage)', 'Stempelkissen', 'Förderbandstück', 'Papiermaschinen-Walze (schwer)'],
    fossilNames: ['Gutenberg-Fälschung', 'Wasserzeichen-Stempel', 'Jugendstil-Fabrikglocke', 'Bleisatz-Kasten', 'Gründungsurkunde 1873', 'Dampfmaschinen-Zahnrad', 'Pausenglocke (oder ein Topf)'],
  },
  {
    id: 'richterswil', name: 'Richterswil: Landzunge Horn', short: 'Horn',
    blurb: 'Steiles Ufer, harte Moräne und Pfahlbau-Funde: wer hier zu tief saugt, zerstört Weltkulturerbe. Dafür zahlt der Kanton besser.',
    lake: { blobs: 16, toxicBlobs: 5, hardBlobs: 18, debrisCount: 24, fossilCount: 20, relief: 1.6 }, payMult: 1.2, startMoney: 40000, deadlineDays: 150, turbidityMult: 0.9,
    palette: { layer: '#5f6b4a', edge: '#8fa066', map: [95, 108, 70], particle: '#9aa874' },
    debrisNames: ['Bootsanker', 'Fischernetz', 'Gummiente (gross)', 'Ruderboot-Wrack', 'Sonnenhut', 'Steg-Bohle', 'Pfahl der Pfahlbauer (bitte stehen lassen)'],
    fossilNames: ['Pfahlbau-Pfosten', 'Bronzenadel', 'Pfeilspitze', 'Tonscherbe', 'Hirschgeweih-Hacke', 'Einbaum-Fragment', 'Bronze-Beil (oder ein Schlüssel)'],
  },
];
export const levelById = (id) => LEVELS.find((l) => l.id === id) ?? LEVELS[0];
