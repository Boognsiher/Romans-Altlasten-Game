# Seesanierung Uetikon – das Spiel

Der Seegrund wird mit Ponton und Saugpumpe saniert. Fläche abfahren, Schlamm absaugen, Punkte sammeln,
Entsorgung aus den Tranchen bezahlen, Ausrüstung ausbauen.

## Starten
    npm start        # http://localhost:8000  (nur python3 nötig, kein Build)
    npm test         # Logik-Tests (node:test)

## Aufbau
| Pfad | Zweck |
|---|---|
| `src/config.js` | Balance: Kosten, Tranchen, Upgrades – hier drehen |
| `src/sim/lake.js` | Seegrund-Raster, Absaugen (massenerhaltend), Altlasten-Zellen |
| `src/sim/dredge.js` | Minispiel-Simulation (Bewegung, Saugen, Trübung, Bussen) |
| `src/sim/game.js` | Management: Tage, Budget, Tranche, Abrechnung, Upgrades, Sieg/Niederlage |
| `src/sim/events.js` | Zufallsereignisse (neue = neuer Eintrag) |
| `src/ui/` | Canvas-Rendering, Eingabe |
| `src/main.js` | Verdrahtung, DOM-Panel |

Prinzip: `src/sim/` kennt weder DOM noch Canvas und ist getestet.

## Steuerung
Karte: WASD/Pfeile (oder Maus gedrückt) fahren, E/Leertaste Anker werfen. Querschnitt: A/D/W/S Saugkopf, Leertaste/Klick saugen, Q zurück zur Karte.

## Ideen für später
Querschnitts-Ansicht wie in der Vorlage (Ponton, Schlauch, Fossilienschicht), Schichten/Tiefe,
Speichern (localStorage), Sound, Ereignisse mit Entscheidungen, Balancing, Touch-Steuerung.
