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
- **Echtzeit, Geld pro m³:** Es gibt `pay.perM3` CHF für jeden abgesaugten m³ belasteter Schicht (Altlasten mit Zuschlag, zu tief abgetragener Boden wird nicht bezahlt). Entsorgung, Analyse, Bussen, Reparaturen und Upgrades kosten. Ein Spieltag dauert `daySeconds` Sekunden, nach `deadlineDays` Tagen ist Schluss (alles in `src/config.js`).
- **Gewonnen hat, wer am Ende am meisten Geld hat.** Früh fertig (Schicht abgetragen und abgenommen): Restmaterial wird noch entsorgt, dann ist das Spiel zu Ende. Frist abgelaufen: Eine Fremdfirma saniert den Rest zum Notfalltarif (`deadline.externalCostPerM3`) gegen Rechnung. Der Endstand kann negativ sein. Rekord wird im Browser gemerkt.
- **Nachtragsmanagement (zweiter Einkommenszweig):** Fremdstoffe, harte Schichten und Fässer erzeugen Nachtrag-Entwürfe (`claims` in `src/config.js`). Du legst den Aufschlag auf den tatsächlichen Aufwand fest (je höher, desto unwahrscheinlicher die Genehmigung), reichst ihn gegen eine kleine Gebühr ein und der Bauherr entscheidet nach ein paar Tagen: voll, hälftig oder abgelehnt. Entwürfe verjähren nach 10 Tagen. Das Upgrade „Baustellen-Dokumentation“ und der Echolot (Messprotokolle) erhöhen die Chance. Regeln in `src/sim/claims.js`.
- **Kasten unter dem Ponton:** 16 Spalten x `box.rows` (5) Zeilen. Pumpe und Drohne arbeiten immer auf dem ganzen Kasten; der Querschnitt zeigt die mittlere Zeile. Die Pumpenleistung verteilt sich auf alle Zeilen, in denen an der Einsaugstelle etwas zu holen ist. Abgenommen ist eine Zelle bei höchstens `drone.acceptMax` (10 cm) Restschicht; winzige Reste (`layer.snap`) erledigt die Pumpe selbst.
- **Drohnengameplay:** Die Drohne taucht nur im Kasten unter dem Ponton (gleiche Ansicht wie der Querschnitt), fix in der Bildmitte, die Landschaft „fährt“. Gesteuert wird in x und y; die Lampe leuchtet in Fahrtrichtung und leicht nach unten, alles andere ist dunkel. Eine Boden-Spalte wird nur gescannt, solange sie im Lichtkegel liegt, die Drohne langsam fährt (nah am Boden schneller). Das Ergebnis gilt für alle Zeilen des Kastens (`box.rows` in `src/config.js`). Start mit V, Q holt sie ein.
- **Weitere Einkommenszweige:**
  - *Fossilienfunde:* Die Drohne entdeckt Fossilien im Untergrund (auf der Karte gold, im Querschnitt als Spirale). Bergen kostet, das Museum zahlt danach. Wer mehr als `fossils.depthBelowTarget` unter die Sollsohle gräbt, zerstört sie und zahlt eine Busse.
  - *Zusatzaufträge der Gemeinde:* Alle paar Wochen bietet sie eine Zone an (auf der Karte markiert). Bis zum Termin sauber und abgenommen = Prämie, verpasst = Konventionalstrafe. Angebote verfallen.
  - *Befliegungsdaten:* Die Behörde zahlt `drone.docPerCell` CHF je Zelle, die die Drohne dokumentiert, einmal vorher und einmal nachher.
- **Karte** zum Positionieren, **Querschnitt** zum Absaugen, **Drohne** zur Abnahme (aus dem verankerten Ponton ausgefahren); alle laufen auf derselben Uhr, Pause mit P.
- Querschnitt: Ponton so breit wie der Absaugbereich, Trübungsschutz-Kasten hängt vom Ponton, die Pumpe hängt an einer Kette (Laufkatze + Hoch/Runter) und schwebt, wo man sie lässt. Einsaugbereich unten rechts der Pumpe, gesaugt wird nur in Arbeitsrichtung (rechts); der Rückweg saugt nicht. Wer pro gefahrene Zelle zu viel abträgt, bringt die Pumpe zum Kippen (Ballast-Upgrade hilft).
- Die belastete Schicht ist überall genau 1 m dick und folgt dem unebenen Seegrund (Sollsohle = gelb gestrichelt). Darunter liegt fester Untergrund: wer dort weitersaugt, trägt zu viel ab (Übertiefung, kostet extra, orange auf der Karte).
- Harte Schichten (schraffiert) brauchen mehrere Überfahrten; Fremdstoffe verstopfen die Pumpe (Kopf anheben hilft).
- Anlage an Land: Puffer, Durchsatz, Übertakten; jede Charge wird nach VVEA als Typ B/E/C eingestuft.
- Echolot (Upgrade): lotet das Fenster vor dem Abtrag aus; die Automatik fährt die eingestellte Abtragsdicke an (Regler oder F/G), saugt nur, wo die Zielhöhe noch nicht erreicht ist, und stoppt von selbst. Stufe 1 misst mit Rauschen.
- Automatik in drei Stufen (1 = experimentell, macht Fehler, Reset mit R), Trübungsschutz-Kasten ausbaubar.
- Gewonnen ist der See, wenn die Schicht abgetragen UND von der Drohne abgenommen ist.

Prinzip: `src/sim/` kennt weder DOM noch Canvas und ist getestet.

## Steuerung (Computer)
Karte: WASD/Pfeile (oder Maus gedrückt) fahren, E/Leertaste Anker werfen. Querschnitt: A/D/W/S Saugkopf, Leertaste/Klick saugen, Q zurück zur Karte.

## Ideen für später
Balancing (alle Zahlen in `src/config.js`), Speichern (localStorage), Sound, Ereignisse mit Entscheidungen, Touch-Steuerung, Fossilienschicht als Bonus.

## Steuerung (Handy)
- **Pumpe im Querschnitt:** nur über vier **Pfeil-Knöpfe** (halten = fahren), dazu ein **Tempo-Regler** (20 bis 100 % des Höchsttempos; Tasten Z/X am Computer). Das Höchsttempo wird mit dem Upgrade **Katze & Winde** erhöht. Langsam fahren heisst tieferer Schnitt pro Zelle und mehr Kippgefahr.
- **Stick links (Karte und Drohne)** (rastet auf vier Richtungen ein, Hysterese gegen Flackern): fährt den Ponton bzw. Katze und Kette.
- **Grosser Knopf rechts:** Karte = Anker werfen, Querschnitt = Saugen, solange er gehalten wird. Stick und Knopf laufen unabhängig (Mehrfinger).
- **Tipp auf die Karte:** Ponton fährt hin und wirft dort den Anker.
- **Oben:** Zurück zur Karte, Automatik, Reset, Abtrag-Regler; rechts oben die Pause.
- **Shop als Fach unten:** Solange es offen ist, steht das Spiel still. Hochkant liegen HUD und Knöpfe unter dem Spielfeld, im Querformat Stick/Knopf an den Seiten.
- Logik in `src/ui/touch-logic.js` (getestet), DOM in `src/ui/touch.js`. Bisher nur im emulierten Handy-Browser getestet, nicht auf einem echten Gerät.
