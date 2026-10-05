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
- Querschnitt: Ponton so breit wie der Absaugbereich, Trübungsschutz-Kasten hängt vom Ponton, die Pumpe hängt an einer Kette (Laufkatze + Hoch/Runter) und schwebt, wo man sie lässt. Die Pumpe ist ein hochkantiges Rechteck, Einsaugöffnung unten vorne, gesaugt wird nur in Arbeitsrichtung (rechts); der Rückweg saugt nicht. Wer pro gefahrene Zelle zu viel abträgt, bringt die Pumpe zum Kippen (Ballast-Upgrade hilft). Die Pumpe hält die eingestellte Höhe: schiebt erhöhtes Gelände sie nach oben, sinkt sie danach wieder auf diese Höhe zurück (orange gestrichelte Marke); solange sie zu hoch hängt (mehr als `pump.liftTolerance` darüber), baut sich Schräglage auf (`pump.liftTiltRate`).
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
- **Anzeige:** Das Spielfeld füllt die verfügbare Fläche und wird in passender (ganzzahliger) Auflösung gerendert (`src/ui/layout.js`). Unter dem Spielfeld zeigt eine **Steuerungsanzeige** je Ansicht (Karte, Querschnitt, Drohne) und Gerät (Tastatur oder Touch), welche Tasten und Gesten was bewirken (`src/ui/hints.js`).
- **Pumpe ein/aus:** Die Pumpe wird mit der Leertaste (Handy: grosser Knopf) ein- und ausgeschaltet und saugt dann auch im Stillstand und vorwärts, rückwärts nie. Die Saugkraft hängt vom Abstand zum Material ab (`pump.fullDraw`): am Boden voll, im freien Wasser kaum etwas, und die Trübung entsteht nur, wenn wirklich Material gesaugt wird. Wer im Stillstand saugt, zählt als langsam fahrend (`pump.minTravel`): eine starke Pumpe untergräbt den Boden und kippt, Ballast hilft.
- **Pumpe im Querschnitt:** nur über vier **Pfeil-Knöpfe** (halten = fahren), dazu ein **Tempo-Regler** (20 bis 100 % des Höchsttempos; Tasten Z/X am Computer). Das Höchsttempo wird mit dem Upgrade **Katze & Winde** erhöht. Langsam fahren heisst tieferer Schnitt pro Zelle und mehr Kippgefahr.
- **Stick links (Karte und Drohne)** (rastet auf vier Richtungen ein, Hysterese gegen Flackern): fährt den Ponton bzw. Katze und Kette.
- **Grosser Knopf rechts:** Karte = Anker werfen, Querschnitt = Saugen, solange er gehalten wird. Stick und Knopf laufen unabhängig (Mehrfinger).
- **Tipp auf die Karte:** Ponton fährt hin und wirft dort den Anker.
- **Oben:** Zurück zur Karte, Automatik, Reset, Abtrag-Regler; rechts oben die Pause.
- **Shop als Fach unten:** Solange es offen ist, steht das Spiel still. Hochkant liegen HUD und Knöpfe unter dem Spielfeld, im Querformat Stick/Knopf an den Seiten.
- Logik in `src/ui/touch-logic.js` (getestet), DOM in `src/ui/touch.js`. Bisher nur im emulierten Handy-Browser getestet, nicht auf einem echten Gerät.

## Speichern

Das Spiel speichert automatisch im Browser (`localStorage`, Schlüssel `altlasten.save`): bei jedem neuen Spieltag, alle 20 Sekunden, beim Pausieren, beim Öffnen des Panels und beim Verlassen der Seite. Gespeichert werden Geld, Zeit, Upgrades, Anlage, Nachträge, Funde, Aufträge und der Seegrund. Die laufende Pontonfahrt nicht: nach dem Laden steht der Ponton wieder auf der Karte. Im Startbild gibt es "Weiterspielen" und "Neues Spiel"; nach dem Spielende wird der Stand gelöscht (der Rekord bleibt). Code: `src/sim/save.js`.

## Abbau-Gefühl (Effekte)

Im Querschnitt fliegt abgesaugtes Material (braun, hart = grau, Altlast = orange) in den Saugmund, Vergütungen schweben als "+CHF" hoch, harte Schichten und Verstopfungen lassen das Bild wackeln (Brocken fliegen weg, am Handy vibriert es kurz), und das Profil wird weich gezeichnet. Die Pumpe brummt, Tonhöhe und Lautstärke folgen der Last; Ton lässt sich mit M oder dem Ton-Knopf abschalten. Code: `src/ui/fx.js`, `src/ui/audio.js`.

## Minispiel: Pumpe freispülen

Verstopft von Hand ein Fremdstoff die Pumpe, startet das Freispülen: ein Marker pendelt über einen Balken, mit Leertaste (bzw. dem grossen Knopf am Handy) im grünen Bereich auslösen. Zwei Treffer lösen den Pfropfen sofort, jeder Treffer macht den Marker schneller; ein Fehlversuch verlängert die Verstopfung um 1 s. Wer nichts tut, wartet 6 s. Die Automatik spielt das Minispiel nicht (feste Wartezeit je Stufe). Werte: `CONFIG.unclog`, `CONFIG.debris.clogSeconds`.

## Startpasswort

Beim ersten Öffnen fragt das Spiel nach einem Passwort (`CONFIG.passwordHash`, nur der SHA-256-Hash steht im Code). Nach der Eingabe merkt sich der Browser das auf diesem Gerät. Ändern: `node tools/set-password.mjs <Passwort>` (ohne Argument entfernt es die Abfrage). Wichtig: Das ist eine reine Browser-Schranke. Der Code ist öffentlich lesbar, ein Entschlossener kommt also vorbei. Sie hält nur Neugierige ab.

## Rückbau und Fremdstoffe

- **Rückbau:** Neben jedem Ausbau steht ein ↩-Knopf (zweiter Tipp bestätigt). Er verkauft die zuletzt gekaufte Stufe und gibt `CONFIG.refundShare` (75 %) ihrer damaligen Kosten zurück; die Kosten für den Rückbau stehen in der Beschreibung.
- **Fremdstoffe:** Jeder hat im Freispülen eine eigene Schwierigkeit (`CONFIG.debrisInfo`): Fischerhut und Gartenzwerg sind leicht (breites Grün, ein Treffer), Stossstange und Kinderwagen schwer (schmal, drei Treffer, lange Wartezeit); im Balken steht der Name des Fremdstoffs.

## Tiefenprofil: Fertig-Band und Markierungen

- Um die Sollsohle (gelb gestrichelt) liegt ein grünes **Fertig-Band** mit zwei **Toleranzlinien** (orange unten: ab hier zu tief, grün oben: darunter gilt als sauber): Toleranz nach unten (`layer.tolerance`), Restschicht nach oben (`drone.acceptMax`). Wer im Band liegt, gilt als sauber, bei der Pumpe wie bei der Drohne (vorher waren die Grenzen verschieden und Reste von 5 bis 10 cm kaum zu sehen).
- Der Kasten umfasst mehrere Zeilen, der Querschnitt zeigt nur die mittlere. **Markierungen** zeigen für jede Spalte über alle Zeilen: Restschicht (rot ▼, cm) und zu tief (orange ▲). Gefüllt = in der gezeigten Zeile, hohl = in einer Nachbarzeile.
- Die Saugkraft geht zuerst ins Material: Zellen und Zeilen, die schon sauber sind, bekommen weniger Anteil und werden nicht mehr in den Untergrund gefressen, solange daneben noch Schicht liegt (weniger "zu tief", obwohl die Linie noch nicht erreicht ist).
