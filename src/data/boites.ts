// Boîtes de vitesses fictives de la sortie de nuit (§ 5.5, § 9 « Sur la route ») : une par famille
// de sons de moteur (engine.sound du manifeste, src/audio/engine/familles.json), une boîte par
// défaut pour une famille qui n'est pas listée, et des boîtes nommées qu'un manifeste choisit par
// `performance.gearbox` (une voiture de course n'a pas la boîte d'un gros V8 de route). Une seule
// vérité pour le son, le compte-tours et la poussée : le pilote (src/drive/pilote.ts) fait avancer
// la boîte (src/drive/boite.ts) à chaque image. La vitesse sur le dernier rapport au rupteur borne
// la vitesse de pointe : elle dépasse d'un dixième celle du manifeste (place pour le NOS). Les
// chiffres sont plausibles pour le genre de moteur, pas relevés sur un véhicule réel.

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
  /** Ralenti du moteur réel (tr/min) : le bas du compte-tours. */
  ralenti: number;
  /**
   * Souplesse du moteur, de 0 à 1 : part de la puissance disponible au ralenti. La puissance monte
   * en ligne droite jusqu'au régime de passage à plein gaz (où elle est pleine). Un diesel turbo ou
   * un gros bicylindre (couple en bas) est souple ; un petit moteur à carburateur ou un moteur de
   * course pointu ne l'est pas : après chaque passage, il repart plus bas dans sa puissance.
   */
  souplesse: number;
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
  ralenti: 850,
  souplesse: 0.5,
});

export const BOITES: Readonly<Record<string, BoiteSpec>> = Object.freeze({
  // 4 cylindres à plat refroidi par air : quatre rapports longs à passer, régime modeste.
  'quatre-a-plat': {
    kmhPar1000: [8, 14.5, 22, 32],
    rupteur: 4900,
    passagePleinGaz: 4300,
    passageCroisiere: 2700,
    retrograde: 1500,
    dureePassage: 0.45,
    embrayage: 1800,
    ralenti: 900,
    souplesse: 0.25,
  },
  // 4 cylindres turbo diesel du van : cinq rapports, on passe tôt, peu de tours.
  'diesel-turbo': {
    kmhPar1000: [7, 13, 21, 31, 43],
    rupteur: 4500,
    passagePleinGaz: 3800,
    passageCroisiere: 2200,
    retrograde: 1300,
    dureePassage: 0.4,
    embrayage: 1400,
    ralenti: 800,
    souplesse: 0.9,
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
    ralenti: 1000,
    souplesse: 0.5,
  },
  // 4 cylindres en ligne de moto : six rapports serrés, très haut régime, passages éclairs.
  'quatre-en-ligne-moto': {
    kmhPar1000: [9, 12.5, 15.5, 18, 20.5, 23],
    rupteur: 14000,
    passagePleinGaz: 12500,
    passageCroisiere: 5000,
    retrograde: 3000,
    dureePassage: 0.12,
    embrayage: 3500,
    ralenti: 1300,
    souplesse: 0.35,
  },
  // Gros V8 de route : boîte automatique à quatre rapports, convertisseur qui patine au départ.
  v8: {
    kmhPar1000: [11, 19, 29, 40],
    rupteur: 6000,
    passagePleinGaz: 5000,
    passageCroisiere: 2200,
    retrograde: 1100,
    dureePassage: 0.35,
    embrayage: 1700,
    ralenti: 750,
    souplesse: 0.6,
  },
});

/** Boîtes choisies par un manifeste (`performance.gearbox`), hors familles de sons. */
export const BOITES_NOMMEES: Readonly<Record<string, BoiteSpec>> = Object.freeze({
  // Séquentielle de course à six rapports : passages éclairs, moteur qui prend des tours.
  'sequentielle-course': {
    kmhPar1000: [9.5, 14, 19, 24.5, 30.5, 37],
    rupteur: 9200,
    passagePleinGaz: 8600,
    passageCroisiere: 3400,
    retrograde: 2600,
    dureePassage: 0.09,
    embrayage: 3000,
    ralenti: 1000,
    souplesse: 0.5,
  },
});

/** Boîte d'une famille de sons, ou la boîte par défaut. */
export function boiteDe(famille: string | null | undefined): BoiteSpec {
  return (famille ? BOITES[famille] : undefined) ?? BOITE_PAR_DEFAUT;
}

/** Boîte d'un véhicule : celle que son manifeste nomme, sinon celle de sa famille de sons. */
export function boiteDuVehicule(vehicle: { engine?: { sound?: string }; performance?: { gearbox?: string } }): BoiteSpec {
  const nommee = vehicle.performance?.gearbox;
  return (nommee ? BOITES_NOMMEES[nommee] : undefined) ?? boiteDe(vehicle.engine?.sound);
}

/** Vitesse sur le dernier rapport au rupteur, en km/h : la boîte ne va pas plus vite. */
export function vitesseMaxBoite(boite: BoiteSpec): number {
  return ((boite.kmhPar1000[boite.kmhPar1000.length - 1] ?? 0) * boite.rupteur) / 1000;
}
