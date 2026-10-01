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
| `src/sim/dredge.js` | Schicht: Karte + Querschnitt, Uhr, Trübung, Bussen |
| `src/sim/slice.js` | Querschnitt: Saugkopf, Arbeitsrichtung, Fremdstoffe, Automatik |
| `src/sim/drone.js` | Tauchdrohne: Abnahme |
| `src/sim/plant.js` | Anlage an Land, VVEA-Klassen |
| `src/sim/game.js` | Management: Tage, Budget, Tranche, Abrechnung, Upgrades, Sieg/Niederlage |
| `src/sim/events.js` | Zufallsereignisse (neue = neuer Eintrag) |
| `src/ui/` | Canvas-Rendering, Eingabe |
| `src/main.js` | Verdrahtung, DOM-Panel |

Spielregeln (Stand):
- **Karte** zum Positionieren, **Querschnitt** zum Absaugen (gemeinsame Schichtuhr), **Drohne** zur Abnahme.
- Querschnitt: Ponton so breit wie der Absaugbereich, Trübungsschutz-Kasten hängt vom Ponton, die Pumpe hängt an einer Kette (Laufkatze + Hoch/Runter). Einsaugbereich unten rechts der Pumpe, gesaugt wird nur in Arbeitsrichtung (rechts); der Rückweg saugt nicht. Wer pro gefahrene Zelle zu viel abträgt, bringt die Pumpe zum Kippen (Ballast-Upgrade hilft).
- Die belastete Schicht ist überall genau 1 m dick und folgt dem unebenen Seegrund (Sollsohle = gelb gestrichelt). Darunter liegt fester Untergrund: wer dort weitersaugt, trägt zu viel ab (Übertiefung, kostet extra, orange auf der Karte).
- Harte Schichten (schraffiert) brauchen mehrere Überfahrten; Fremdstoffe verstopfen die Pumpe (Kopf anheben hilft).
- Anlage an Land: Puffer, Durchsatz, Übertakten; jede Charge wird nach VVEA als Typ B/E/C eingestuft.
- Automatik in drei Stufen (1 = experimentell, macht Fehler, Reset mit R), Trübungsschutz-Kasten ausbaubar.
- Gewonnen ist der See, wenn die Schicht abgetragen UND von der Drohne abgenommen ist.

Prinzip: `src/sim/` kennt weder DOM noch Canvas und ist getestet.

## Steuerung
Karte: WASD/Pfeile (oder Maus gedrückt) fahren, E/Leertaste Anker werfen. Querschnitt: A/D/W/S Saugkopf, Leertaste/Klick saugen, Q zurück zur Karte.

## Ideen für später
Balancing (alle Zahlen in `src/config.js`), Speichern (localStorage), Sound, Ereignisse mit Entscheidungen, Touch-Steuerung, Fossilienschicht als Bonus.
