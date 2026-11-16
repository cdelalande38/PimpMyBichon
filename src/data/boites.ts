// Boîtes de vitesses fictives de la sortie de nuit (§ 5.5, § 9 « Sur la route ») : une par famille
// de sons de moteur (engine.sound du manifeste, src/audio/engine/familles.json), et une boîte par
// défaut pour une famille qui n'est pas listée. Elles ne servent qu'au son : le régime d'après la
// vitesse et le rapport engagé (src/drive/boite.ts). Les chiffres sont plausibles pour le genre de
// moteur, pas relevés sur un véhicule réel.

export interface BoiteSpec {
  /** Vitesse du véhicule à 1 000 tr/min sur chaque rapport, en km/h, du premier au dernier. */
  kmhPar1000: readonly number[];
  /** Régime le plus haut du moteur réel, en tr/min : ramené au haut de la plage que les sons savent jouer. */
  rupteur: number;
  /** Passage au rapport supérieur à ce régime à plein gaz (tr/min)… */
  passagePleinGaz: number;
  /** … et à celui-ci en croisière, accélérateur à peine enfoncé (tr/min). */
  passageCroisiere: number;
  /** Rétrogradage quand le régime tombe sous cette valeur (tr/min). */
  retrograde: number;
  /** Durée d'un passage, en secondes : la charge tombe, le régime rejoint celui du rapport suivant. */
  dureePassage: number;
  /** Régime d'embrayage au départ arrêté, à plein gaz (tr/min) : l'embrayage patine jusque-là. */
  embrayage: number;
}

/** Boîte d'une famille absente de la liste : cinq rapports, moteur essence courant. */
export const BOITE_PAR_DEFAUT: Readonly<BoiteSpec> = Object.freeze({
  kmhPar1000: [8, 14, 21, 28, 35],
  rupteur: 6000,
  passagePleinGaz: 5000,
  passageCroisiere: 2600,
  retrograde: 1400,
  dureePassage: 0.3,
  embrayage: 1700,
});

export const BOITES: Readonly<Record<string, BoiteSpec>> = Object.freeze({
  // 4 cylindres à plat refroidi par air : quatre rapports longs à passer, régime modeste.
  'quatre-a-plat': {
    kmhPar1000: [7.5, 13, 20, 27],
    rupteur: 4500,
    passagePleinGaz: 4000,
    passageCroisiere: 2700,
    retrograde: 1500,
    dureePassage: 0.45,
    embrayage: 1800,
  },
  // 4 cylindres turbo diesel du van : cinq rapports, on passe tôt, peu de tours.
  'diesel-turbo': {
    kmhPar1000: [7, 13, 21, 30, 38],
    rupteur: 4200,
    passagePleinGaz: 3500,
    passageCroisiere: 2200,
    retrograde: 1300,
    dureePassage: 0.4,
    embrayage: 1400,
  },
  // Bicylindre en V du bobber : cinq rapports longs, gros couple, régime bas.
  'bicylindre-v': {
    kmhPar1000: [14, 21, 28, 35, 41],
    rupteur: 5500,
    passagePleinGaz: 4500,
    passageCroisiere: 3000,
    retrograde: 1800,
    dureePassage: 0.25,
    embrayage: 1900,
  },
  // 4 cylindres en ligne de moto : six rapports serrés, très haut régime, passages éclairs.
  'quatre-en-ligne-moto': {
    kmhPar1000: [7, 9.5, 12, 14, 15.5, 17],
    rupteur: 13000,
    passagePleinGaz: 9500,
    passageCroisiere: 5000,
    retrograde: 3000,
    dureePassage: 0.12,
    embrayage: 3500,
  },
  // Gros V8 : boîte automatique à quatre rapports, convertisseur qui patine au départ.
  v8: {
    kmhPar1000: [11, 19, 29, 40],
    rupteur: 6000,
    passagePleinGaz: 5000,
    passageCroisiere: 2200,
    retrograde: 1100,
    dureePassage: 0.35,
    embrayage: 1700,
  },
});

/** Boîte d'une famille de sons, ou la boîte par défaut. */
export function boiteDe(famille: string | null | undefined): BoiteSpec {
  return (famille ? BOITES[famille] : undefined) ?? BOITE_PAR_DEFAUT;
}
