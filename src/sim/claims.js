import { CONFIG } from '../config.js';

// Nachtragsmanagement: reine Regeln (ohne Zustand), damit sie sich einzeln testen lassen.

// Chance, dass der Bauherr einen Nachtrag voll genehmigt. Je höher der Aufschlag auf den tatsächlichen Aufwand,
// desto tiefer; Dokumentation (Upgrade, Echolot-Messprotokolle) gleicht aus.
export function acceptChance(markup, docBonus = 0) {
  const C = CONFIG.claims;
  return Math.min(0.98, Math.max(0.05, C.baseAccept - C.markupPenalty * (markup - 1) + docBonus));
}

// Entscheid anhand eines Loses (0..1): voll genehmigt, knapp daneben = hälftig, sonst abgelehnt.
export function decide(markup, docBonus, roll) {
  const p = acceptChance(markup, docBonus);
  if (roll < p) return 'accepted';
  if (roll < p + CONFIG.claims.partialBand) return 'partial';
  return 'rejected';
}

export function clampMarkup(m) { return Math.min(CONFIG.claims.maxMarkup, Math.max(CONFIG.claims.minMarkup, m)); }
export const claimedAmount = (fair, markup) => Math.round((fair * markup) / 10) * 10;

export const TEXTS = {
  accepted: [
    'Der Bauherr hat gelacht, unterschrieben und bezahlt.',
    'Genehmigt. Der Bauherr nennt es „ausnahmsweise“ und meint es auch so.',
    'Nachtrag durch, ohne Rückfrage. Der Bauherr muss krank sein.',
  ],
  partial: [
    'Der Bauherr streicht die Hälfte und nennt es „Kulanz“.',
    'Teilweise genehmigt: Die andere Hälfte sei „im Preis inbegriffen“.',
    'Halbe Zusage. Der Bauherr rechnet auf einer Serviette.',
  ],
  rejected: [
    'Abgelehnt. Der Bauherr verweist auf Art. 7 des Werkvertrags. Es gibt keinen Art. 7.',
    'Abgelehnt: „Im Preis inbegriffen.“ Alles ist im Preis inbegriffen.',
    'Der Bauherr bittet um Nachweis und verliert danach den Ordner.',
  ],
  expired: [
    'Nachtrag verjährt. Der Ordner steht noch im Regal und schaut vorwurfsvoll.',
    'Zu spät angemeldet: Die Rügefrist hat uns überholt.',
    'Nachtrag verfallen. Die Frist war gestern. Oder letzte Woche.',
  ],
};
export const pickText = (kind, rng) => TEXTS[kind][Math.floor(rng() * TEXTS[kind].length) % TEXTS[kind].length];
