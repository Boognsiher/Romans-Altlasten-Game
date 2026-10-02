import { CONFIG } from '../config.js';

// Weitere Einkommenszweige (Fossilienfunde, Zusatzaufträge der Gemeinde): Texte und Zonenwahl.
export const TEXTS = {
  sold: [
    'Das Museum ist begeistert und stellt es neben das Gartenzwerg-Archiv.',
    'Der Kurator weint vor Freude. Oder es war Heuschnupfen.',
    'Verkauft! Der Fund bekommt eine eigene Vitrine und den Namen „Hansruedi“.',
  ],
  lost: [
    'ist jetzt Kies. Das Amt für Archäologie schreibt einen Brief.',
    'wurde mitgesaugt. Die Wissenschaft ist untröstlich, die Pumpe zufrieden.',
    'liegt jetzt im Schlammsack. Das Museum hätte gern darüber gesprochen.',
  ],
  jobDone: [
    'Die Gemeinde ist entzückt und schneidet ein Band durch.',
    'Eröffnungsapéro mit Würstchen. Die Prämie darfst du behalten.',
    'Der Gemeindepräsident hält eine Rede. Sie ist kürzer als befürchtet.',
  ],
  jobFailed: [
    'Termin verpasst. Die Gemeinde erinnert an die Konventionalstrafe und an Artikel 12.',
    'Zu spät. Die Badi-Eröffnung findet ohne Badi statt.',
    'Frist verstrichen. Der Gemeinderat schreibt einen höflichen, aber sehr langen Brief.',
  ],
  jobDeclined: [
    'Die Gemeinde nimmt es sportlich. Der Gemeindepräsident nicht.',
    'Abgesagt. Die Gemeinde fragt in drei Jahren wieder.',
  ],
  jobLapsed: ['Das Angebot ist verfallen. Die Gemeinde hat inzwischen einen Ruderverein gefragt.'],
};
export const PLACES = ['Badi', 'Seeplatz', 'Hafen', 'Spielplatz am Ufer', 'Schiffsteg', 'Seeuferweg'];
export const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];

// Zufällige Zone mit genug belasteten Zellen, die noch nicht sauber ist und keine andere Zone überlappt
export function makeZone(lake, rng, taken = []) {
  const J = CONFIG.jobs;
  for (let tries = 0; tries < 300; tries++) {
    const w = rng.int(J.zoneW[0], J.zoneW[1]), h = rng.int(J.zoneH[0], J.zoneH[1]);
    const z = { x: rng.int(0, lake.cols - w), y: rng.int(0, lake.rows - h), w, h };
    if (taken.some((t) => z.x < t.x + t.w && t.x < z.x + z.w && z.y < t.y + t.h && t.y < z.y + z.h)) continue;
    const st = lake.zoneStats(z);
    if (st.n >= J.minInitialCells && st.cleaned < 0.5) return { zone: z, stats: st };
  }
  return null;
}
