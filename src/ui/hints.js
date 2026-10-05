// Steuerungsanzeige je Ansicht und Gerät: [Taste oder Geste, Wirkung]
export const HINTS = {
  keys: {
    map: [['WASD / Pfeile', 'Ponton fahren'], ['Maus halten', 'zum Mauszeiger fahren'], ['E / Leertaste', 'Anker werfen'], ['P', 'Pause']],
    slice: [['A D', 'Pumpe seitlich'], ['W S', 'Kette hoch/runter'], ['Leertaste', 'Pumpe an/aus'], ['1–5 / Tab', 'Zeile wählen'], ['Z X', 'Tempo'], ['T', 'Automatik'], ['R', 'Automatik-Reset'], ['V', 'Drohne ausbringen'], ['Q', 'zurück zur Karte'], ['P', 'Pause']],
    drone: [['WASD / Pfeile', 'Drohne steuern'], ['Q', 'einholen'], ['langsam + nah am Boden', 'scannt den Boden im Lichtkegel'], ['P', 'Pause']],
  },
  touch: {
    map: [['Stick', 'Ponton fahren'], ['Tipp auf die Karte', 'hinfahren und ankern'], ['Knopf', 'Anker werfen']],
    slice: [['Pfeile', 'Pumpe fahren (halten)'], ['Knopf', 'Pumpe an/aus'], ['Zeilen 1–5', 'Zeile des Kastens wählen'], ['Regler', 'Tempo'], ['Knöpfe oben', 'Automatik, Drohne, zurück zur Karte']],
    drone: [['Stick', 'Drohne steuern'], ['Knopf', 'einholen'], ['langsam + nah am Boden', 'scannt den Boden im Lichtkegel']],
  },
};
export const hintsFor = (mode, touch) => HINTS[touch ? 'touch' : 'keys'][mode] ?? [];
