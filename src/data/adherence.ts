// Adhérence sur la route (sortie de nuit, § 5.5) : ce que la météo retire aux pneus, ce que la
// transmission fait du couple, quand l'arrière décroche et quand les roues patinent. Données lues par
// le pilote (src/drive/pilote.ts) ; chiffres plausibles pour un jeu, pas relevés sur un modèle réel.
//
// Demandes du commanditaire (16 et 17 novembre 2026) : « lorsque l'on fait prendre un virage à un
// véhicule il faut aussi simuler le véhicule qui tourne » ; « En mode manuel il doit pas y avoir [de
// freinage auto]. Le fait de cogner ralentira mais pas de freins auto. » Rien ici ne freine à la place
// du joueur : la pluie et la neige allongent ses freinages et abaissent ce que ses pneus tiennent.

import type { Weather } from '../drive/contrat.ts';

/** Roues motrices : arrière (propulsion), avant (traction), les quatre (intégrale). */
export type Transmission = 'propulsion' | 'traction' | 'integrale';

export const TRANSMISSIONS: readonly Transmission[] = ['propulsion', 'traction', 'integrale'];

/** Transmission d'un véhicule qui n'en déclare pas : une voiture courante est une traction ; une moto pousse par l'arrière. */
export const TRANSMISSION_PAR_DEFAUT: Readonly<Record<'car' | 'bike', Transmission>> = { car: 'traction', bike: 'propulsion' };

export interface AdherenceMeteo {
  /** Part de l'adhérence du sec que gardent les pneus : en courbe, au freinage, à la motricité. */
  adherence: number;
  /** Pilote automatique : part de sa vitesse de croisière (il lève le pied sous la pluie, nettement sur la neige). */
  croisiere: number;
  /**
   * Pilote automatique : part de l'accélération latérale qu'il vise au sec en courbe (PILOT.lateral). Plus
   * basse que l'adhérence : il suit sa trajectoire avec de petits écarts (jusqu'à 1,5 fois sa visée dans
   * les rues serrées) et doit rester sous ce que les pneus tiennent.
   */
  lateraleAuto: number;
}

/** Par météo (src/state/drive.ts, `weather`). */
export const ADHERENCE_METEO: Readonly<Record<Weather, AdherenceMeteo>> = Object.freeze({
  sec: { adherence: 1, croisiere: 1, lateraleAuto: 1 },
  pluie: { adherence: 0.7, croisiere: 0.92, lateraleAuto: 0.62 },
  neige: { adherence: 0.38, croisiere: 0.75, lateraleAuto: 0.3 },
});

/**
 * Pilote automatique : part de l'adhérence du moment qu'il s'autorise au freinage le plus fort, au
 * freinage prévu par son profil et à la reprise (en courbe : `lateraleAuto`) (il ne glisse jamais, il ne patine jamais).
 * Au sec, ses plafonds d'avant (PILOT.lateral, maxBrake, plannedBrake, accel) restent les plus bas.
 */
export const PRUDENCE_AUTO = { frein: 0.9, freinPrevu: 0.6, reprise: 0.8 } as const;

/**
 * Motricité : accélération la plus forte que les roues motrices transmettent au sec, en m/s² (par
 * genre), multipliée par l'adhérence de la météo et le facteur de la transmission (une propulsion
 * gagne de la charge en accélérant, une traction en perd). Au-delà, les roues patinent : le patinage
 * (de 0 à 1) est plein quand la poussée du moteur dépasse la motricité de `plein` (part), et la
 * poussée transmise baisse alors de `perte` (part). Lissage du patinage (s). Le patinage se juge sur la
 * poussée que le couple du moteur peut donner en première (`couple` fois la puissance divisée par la
 * vitesse de première au régime de passage) : une petite voiture ne patine pas parce que la poussée du
 * pilote est bornée haut au départ. Le pilote borne déjà la
 * poussée au départ (PILOT.engine.launch, 8,5 m/s²) : au sec, rien ne patine en ligne droite ; sous la
 * pluie, une voiture puissante patine au départ ; sur la neige, presque toutes.
 */
export const MOTRICITE = {
  reference: { car: 10.5, bike: 10.5 },
  transmission: { propulsion: 0.95, traction: 0.85, integrale: 1.1 } satisfies Record<Transmission, number>,
  plein: 0.6,
  perte: 0.15,
  tau: 0.12,
  couple: 1.2,
} as const;

/**
 * Freinage à la main, au sec, en m/s² (PILOT.manual.brake) : multiplié par l'adhérence de la météo.
 * Part de l'adhérence d'un essieu prise par un freinage plein : à l'avant, à l'arrière (répartiteur
 * vers l'avant : l'arrière garde de quoi tenir la courbe).
 */
export const FREINAGE = { avant: 0.85, arriere: 0.45 } as const;

/**
 * Survirage, à la main seulement (bicyclette simplifiée, dans le repère de la route) : chaque essieu
 * tient une accélération latérale jusqu'à l'adhérence, moins ce que la poussée ou le frein lui prend
 * (ellipse d'adhérence), plus ou moins le report de charge. Quand l'arrière tient moins que l'avant ne
 * tire, la caisse pivote (`dérive`, angle entre la caisse et la marche) ; contre-braquer la rattrape,
 * insister la mène au tête-à-queue.
 * - `equilibre` : ce que l'arrière tient de plus que l'avant, à charge égale (réglage de série : le
 *   véhicule sous-vire à la limite tant qu'on ne lève pas le pied ni n'écrase la pédale en appui).
 * - `report` : report de charge par g d'accélération longitudinale (lissée en `reportTau` s), borné à
 *   `reportMax` (part de la charge) : en levant le pied ou en freinant l'arrière perd, en accélérant
 *   l'avant perd (sous-virage) et l'arrière ne gagne que `gainArriere` du report (la poussée lui prend
 *   plus qu'elle ne lui donne : survirage de puissance).
 * - `pivot` : accélération de la dérive, rad/s² par m/s² d'écart entre l'avant et l'arrière.
 * - `raideur` : ce que l'arrière rend en accélération latérale, par radian de dérive (en part de
 *   l'adhérence), tant qu'il tient : la dérive se referme seule quand l'arrière reprend.
 * - `amortissement` : part de l'amortissement critique du retour.
 * - `amortiGlisse` : amortissement de la dérive quand l'arrière glisse (1/s).
 * - `frottement` : décélération de la caisse en travers, en part de l'adhérence, par sinus de dérive.
 * - `teteAQueue` : au-delà de cette dérive (rad), le véhicule part en toupie : plus rien ne le tient,
 *   il tourne sur lui-même en glissant jusqu'à presque s'arrêter.
 * - `remise` : sous `remise.vitesse` m/s, la caisse se remet dans l'axe de la route en `remise.tau` s
 *   (pas de marche arrière dans le jeu : on repart dans le bon sens).
 * - `moto` : dérive la plus forte d'une moto (rad) et raideur de son retour : la roue arrière glisse un
 *   peu, jamais de tête-à-queue.
 * - `glisse` : dérive qui fait un glissement plein pour le son de dérapage (rad).
 * - `bord` : au contact du bord, la dérive se referme en `bord` s.
 */
export const SURVIRAGE = {
  equilibre: 1.08,
  report: 0.8,
  reportTau: 0.2,
  reportMax: 0.2,
  gainArriere: 0.25,
  pivot: 1,
  raideur: 8,
  amortissement: 0.8,
  amortiGlisse: 1.2,
  frottement: 0.7,
  teteAQueue: 1.35,
  remise: { vitesse: 2.5, tau: 0.8 },
  moto: { max: 0.3, raideur: 14 },
  glisse: 0.35,
  bord: 0.35,
} as const;

/** Adhérence d'une météo (1 au sec) ; une météo inconnue compte comme le sec. */
export function adherenceMeteo(weather: string | undefined): AdherenceMeteo {
  return (weather !== undefined && (ADHERENCE_METEO as Record<string, AdherenceMeteo>)[weather]) || ADHERENCE_METEO.sec;
}
