import { CONFIG, UPGRADES } from '../config.js';
import { upgradeCost } from './stats.js';

// Bauleiter Bruno: gibt Tipps (Gag im Stil einer Büroklammer mit Helm). Reine Logik ohne DOM, damit testbar.
// observe() sammelt laufend Messwerte (geglättet), pick() liefert höchstens einen Tipp, wenn Pause, Abstand und Bedingung passen.
const ema = (x, v, dt, tau) => x + (v - x) * Math.min(1, dt / tau);

export class Advisor {
  constructor(muted = []) {
    this.muted = new Set(muted); // Tipp-IDs, die der Spieler nicht mehr sehen will
    this.enabled = true;
    this.runTime = 0; // laufende Spielzeit (Sekunden) seit Start, ohne Pausen
    this.lastShown = -Infinity; // runTime des letzten Tipps
    this.shownAt = {}; // id -> runTime
    this.t = { bufFull: 0, overRate: 0, turb: 0, tips: [], clogs: [] }; // Messwerte
  }

  // dt Sekunden Spielzeit; d = Ergebnis von DredgeSim.update
  observe(dt, d, game, sim) {
    this.runTime += dt;
    const t = this.t, tau = CONFIG.advisor.tau;
    t.bufFull = ema(t.bufFull, sim.bufferFull ? 1 : 0, dt, tau);
    t.overRate = ema(t.overRate, dt > 0 ? (d?.overdug ?? 0) / dt : 0, dt, tau);
    t.turb = ema(t.turb, sim.turbidity ?? 0, dt, tau);
    for (let i = 0; i < (d?.tips ?? 0); i++) t.tips.push(game.time);
    for (let i = 0; i < (d?.clogs ?? 0); i++) t.clogs.push(game.time);
    const cut = game.time - CONFIG.advisor.eventWindow;
    t.tips = t.tips.filter((x) => x >= cut); t.clogs = t.clogs.filter((x) => x >= cut);
  }

  // Passendes Upgrade zu den Messwerten, nur wenn es bezahlbar ist: gibt { id, cost } oder null
  recommend(game) {
    const t = this.t, L = game.levels, A = CONFIG.advisor;
    const order = [];
    if (t.bufFull > A.bufferFull) order.push('plant', 'dewater');
    if (t.turb > A.turbidity) order.push('curtain');
    if (t.tips.length >= 1) order.push('ballast');
    if (t.overRate > A.overRate && L.echolot === 0) order.push('echolot');
    if (L.auto === 0 && game.totals.removed > 150) order.push('auto');
    order.push('power', 'speed', 'radius', 'winch', 'drone', 'docs', 'plant');
    for (const id of order) {
      if (!UPGRADES[id] || L[id] >= UPGRADES[id].maxLevel) continue;
      const cost = upgradeCost(id, L[id]);
      if (cost <= game.money) return { id, cost };
    }
    return null;
  }

  // Alle Tipps: prio = Dringlichkeit (grösser zuerst), when = Bedingung, text = Spruch, upgrade = Kaufknopf (optional)
  tips(game, sim) {
    const t = this.t, A = CONFIG.advisor, rec = this.recommend(game), done = game.lake.cleanFraction();
    const name = (id) => UPGRADES[id].name;
    return [
      { id: 'start', prio: 100, when: () => game.totals.removed < 1 && game.day <= 2 && this.runTime > A.firstAfter,
        text: () => 'Hallo, ich bin Bruno, dein Bauleiter! Fahr den Ponton zu einer braunen Fläche, wirf den Anker (Knopf unten) und schalte die Pumpe ein. Bezahlt wird jeder abgesaugte Kubikmeter.' },
      { id: 'buffer', prio: 90, when: () => t.bufFull > A.bufferFull && sim.mode !== 'map',
        text: () => `Der Puffer ist schon wieder voll und die Pumpe steht rum wie bestellt und nicht abgeholt. ${rec && ['plant', 'dewater'].includes(rec.id) ? `Wie wäre es mit mehr ${name(rec.id)}?` : 'Mit der Entwässerungsanlage geht es schneller durch die Anlage.'}`,
        upgrade: () => (rec && ['plant', 'dewater'].includes(rec.id) ? rec : null) },
      { id: 'tipover', prio: 85, when: () => t.tips.length >= 1,
        text: () => `Die Pumpe ist umgekippt. Das passiert, wenn man pro Zelle zu viel abträgt: langsamer saugen heisst Tempo-Regler hoch (schneller fahren), die Pumpe nicht zu tief hängen${game.levels.ballast < UPGRADES.ballast.maxLevel ? ' oder Ballast kaufen' : ''}.`,
        upgrade: () => (game.levels.ballast < UPGRADES.ballast.maxLevel && upgradeCost('ballast', game.levels.ballast) <= game.money ? { id: 'ballast', cost: upgradeCost('ballast', game.levels.ballast) } : null) },
      { id: 'overdig', prio: 80, when: () => t.overRate > A.overRate && sim.mode === 'slice',
        text: () => game.levels.echolot === 0
          ? `Du fährst immer zu tief! Das kostet. Das Echolot misst den Seegrund vor dem Abtrag, dann fährt die Automatik genau auf die Linie.${rec && rec.id === 'echolot' ? ' Soll ich?' : ''}`
          : `Du fährst immer zu tief! Stell den Regler "Abtrag" (F/G) auf etwa 1 m, schalte die Automatik ein (T) und lass sie die Linie anfahren. Und die Pumpe nicht tiefer hängen als nötig.`,
        upgrade: () => (game.levels.echolot === 0 && rec && rec.id === 'echolot' ? rec : null) },
      { id: 'turb', prio: 70, when: () => t.turb > A.turbidity,
        text: () => `Das Wasser sieht aus wie Milchkaffee, und die Busse kommt bestimmt. Langsamer fahren hilft, oder ein Trübungsschutz (Vorhang) um den Ponton.${rec && rec.id === 'curtain' ? ' Den könntest du dir leisten.' : ''}`,
        upgrade: () => (rec && rec.id === 'curtain' ? rec : null) },
      { id: 'clog', prio: 60, when: () => t.clogs.length >= 3 && sim.mode === 'slice',
        text: () => 'Schon wieder verstopft? Weisse Punkte auf der Karte sind Fremdstoffe. Zieh die Pumpe höher, bevor du drüberfährst. Und beim Freispülen: im grünen Bereich drücken, nicht hektisch hämmern.' },
      { id: 'cert', prio: 75, when: () => game.certs.some((c) => c.status === 'issued'),
        text: () => 'Du hast ein Zertifikat in der Schublade! Reich es beim Kanton ein (Panel, Zertifikate). Nach 3 Tagen gibt es die Prämie, besser ist sie bei guter Qualität.' },
      { id: 'jobs', prio: 65, when: () => game.jobs.some((j) => j.status === 'offer'),
        text: () => 'Die Gemeinde hat einen Zusatzauftrag mit Prämie angeboten (Panel, Zusatzaufträge). Zone sauber machen und kassieren, aber die Frist läuft!' },
      { id: 'finds', prio: 55, when: () => game.finds.some((f) => f.status === 'found'),
        text: () => 'Die Drohne hat einen Fund gemeldet. Bergen lohnt sich meistens, das Museum zahlt (Panel, Funde). Nicht zu tief saugen, sonst ist es Kies.' },
      { id: 'claims', prio: 50, when: () => game.openClaims >= 2,
        text: () => `Du sitzt auf ${game.openClaims} offenen Nachträgen. Einreichen kostet wenig und bringt Geld. Aber nicht übertreiben: je höher die Forderung, desto kleiner die Chance.` },
      { id: 'drone', prio: 45, when: () => game.totals.removed > 150 && game.certs.length === 0 && game.totals.docPaid === 0 && sim.mode === 'slice',
        text: () => 'Wenn ein Kasten sauber aussieht, schick die Drohne tauchen (Knopf "Drohne ausbringen"). Ab 90 % abgenommener Zellen gibt es ein Zertifikat für den Kanton und später eine Prämie.' },
      { id: 'auto', prio: 40, when: () => game.levels.auto === 0 && game.totals.removed > 300 && rec && rec.id === 'auto',
        text: () => 'Du pumpst schon eine Weile von Hand. Mit der Automatik kannst du Kaffee trinken (ich übernehme keine Haftung, wenn sie sich aufhängt).', upgrade: () => rec },
      { id: 'late', prio: 78, when: () => game.day > game.deadlineDays * 0.7 && done < 0.5,
        text: () => 'Die Zeit läuft, und der See ist noch nicht mal halb sauber. Jetzt nur noch die ergiebigen Flächen machen, Tempo hoch, Automatik nutzen. Der Rest kostet beim Fremdunternehmer sowieso mehr.' },
      { id: 'rich', prio: 30, when: () => game.money > A.richMoney && !!rec,
        text: () => `Du hast ${Math.round(game.money).toLocaleString('de-CH')} CHF auf dem Konto. Geld ohne Zinsen ist wie Schlamm ohne Pumpe. Ich empfehle: ${name(rec.id)} (${rec.cost.toLocaleString('de-CH')} CHF).`,
        upgrade: () => rec },
    ];
  }

  // Der nächste Tipp oder null. cooldown je Tipp und Mindestabstand zwischen zwei Tipps in laufender Spielzeit.
  pick(game, sim) {
    const A = CONFIG.advisor;
    if (!this.enabled || game.status !== 'playing') return null;
    if (this.runTime - this.lastShown < A.gap) return null;
    const list = this.tips(game, sim).filter((tip) => !this.muted.has(tip.id) && this.runTime - (this.shownAt[tip.id] ?? -Infinity) >= (tip.id === 'start' ? Infinity : A.tipCooldown) && tip.when());
    list.sort((a, b) => b.prio - a.prio);
    const tip = list[0];
    if (!tip) return null;
    this.lastShown = this.runTime; this.shownAt[tip.id] = this.runTime;
    return { id: tip.id, text: tip.text(), upgrade: tip.upgrade?.() ?? null };
  }

  mute(id) { this.muted.add(id); }
}
