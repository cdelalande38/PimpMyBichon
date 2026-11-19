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
 * poussée transmise baisse de `perte` (part) à chaque `plein` d'excès, sans plafond avant `perteMax`
 * (vague U : avant, la perte s'arrêtait à `perte` ; des chevaux en plus sur la neige ne coûtaient
 * rien, « adapter la puissance » n'avait pas de sens). Lissage du patinage (s). Le patinage se juge sur la
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
  perteMax: 0.6,
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
 * - `bord` : au contact du bord, la dérive se referme en `bord` s, et encore `bordTenu` s après (sans quoi le
 *   coin, dégagé, revient toucher au sous-pas suivant : la caisse tremblait le long du trottoir).
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
  bordTenu: 0.15,
} as const;

/**
 * Drift au frein, à la main seulement (demande du 18 novembre 2026 : « le bouton de freins devrait permettre
 * de faire des drifts ») : un coup de frein bref, à bonne vitesse et le manche braqué, bloque l'arrière, qui
 * part du côté du manche ; la glisse se tient ensuite au gaz, tant que le véhicule tourne : l'angle tenu
 * suit le gaz et ce que la courbe demande aux pneus, et le manche le règle (braqué dans le virage au-delà de
 * ce que demande la route, plus d'angle ; contre-braqué, moins). Sans gaz, ou en sortant du virage, la caisse
 * se remet droite et la conduite d'avant reprend ; au-delà de `lache`, l'arrière ne se rattrape plus de
 * lui-même (la conduite d'avant reprend la main, plein gaz : tête-à-queue). Le pilote automatique ne drifte jamais.
 * - `coup` : un appui franc sur le frein (`franc` atteint, de 0 à 1, dans les `montee` s qui suivent le début de
 *   l'appui) relâché avant ce temps (s) est un coup de frein à main ; plus long, c'est un freinage, comme avant
 *   (et il arrête la glisse en cours) ; plus léger ou plus lent à venir (le manche tiré peu à peu, un freinage
 *   dosé), aussi : pas de glisse sans le vouloir.
 * - `vitesseMin` : vitesse (m/s) sous laquelle le coup de frein ne lance rien ; sous `vitesseFin`, la glisse s'arrête.
 * - `braquageMin` : manche (de 0 à 1) tenu d'un côté pendant l'appui : le côté du virage.
 * - `amorce`, `blocage` : angle visé (rad) pendant `blocage` s après le coup (l'arrière bloqué part).
 * - `angle` : angle tenu plein gaz (rad) dans une courbe qui demande aux pneus au moins `1 / virage` de leur
 *   limite (moins, l'angle baisse d'autant ; en ligne droite, rien) ; `braquage` : ce qu'ajoute (en part de
 *   `angle`) le manche braqué dans le virage au-delà de ce que demande la route ; le gaz agit en puissance `expo`.
 * - `ressort` : pulsation (rad/s) et amortissement du retour de la caisse sur l'angle visé ; la pulsation suit la
 *   racine de l'adhérence de la météo (sur la neige, tout vient plus lentement).
 * - `fin` : sous cet angle (rad), quand le gaz n'en demande pas plus, la glisse est finie.
 * - `lache` : au-delà de cet angle (rad), la glisse lancée rend la main à la conduite d'avant.
 * - `transmission` : part de l'angle que le gaz tient selon les roues motrices (une propulsion drifte, une
 *   traction se redresse vite).
 * - `meteo` : facteur sur l'angle tenu (sur le mouillé, l'arrière décroche plus).
 * - `assiste` : angle le plus fort en direction assistée (rad) : l'aide tient l'angle, sous le tête-à-queue.
 * - `moto` : part de l'angle d'une moto, bornée par `SURVIRAGE.moto.max` : une glisse courte de l'arrière.
 */
export const DRIFT = {
  coup: 0.35,
  franc: 0.6,
  montee: 0.12,
  vitesseMin: 9,
  vitesseFin: 4,
  braquageMin: 0.5,
  amorce: 0.5,
  blocage: 0.3,
  angle: 0.6,
  virage: 2.5,
  braquage: 1.5,
  expo: 1,
  ressort: { pulsation: 4.5, amortissement: 0.75 },
  fin: 0.1,
  lache: 1,
  transmission: { propulsion: 1, integrale: 0.75, traction: 0.3 } satisfies Record<Transmission, number>,
  meteo: { sec: 1, pluie: 1.1, neige: 1.2 } satisfies Record<Weather, number>,
  assiste: 0.75,
  moto: 0.5,
} as const;

/** Adhérence d'une météo (1 au sec) ; une météo inconnue compte comme le sec. */
export function adherenceMeteo(weather: string | undefined): AdherenceMeteo {
  return (weather !== undefined && (ADHERENCE_METEO as Record<string, AdherenceMeteo>)[weather]) || ADHERENCE_METEO.sec;
}

// ---------------------------------------------------------------------------------------------
// Préparation (demande du 18 novembre 2026 : « il adaptera la puissance les suspensions et les pneu en
// conséquence avant le début de la course ») : les pneus, leur largeur et l'assiette changent ce que le
// véhicule tient, selon la météo. Tout est relatif au véhicule d'origine : `ADHERENCE_METEO` et
// l'adhérence du manifeste (`performance.grip`) sont celles du véhicule sur ses pneus d'origine, à son
// assiette d'origine ; le véhicule d'origine garde donc exactement sa conduite et ses temps de référence.
// Chiffres plausibles pour un jeu, pas relevés : des écarts francs (5 à 15 %) mais jouables.

/** Les trois météos, dans l'ordre où on les dit. */
export const METEOS: readonly Weather[] = ['sec', 'pluie', 'neige'];

/** Une valeur par météo. */
export type ParMeteo = Readonly<Record<Weather, number>>;

/**
 * Comportement d'un pneu (catalogue des roues, `tires[].tenue` et `tires[].motricite`) : par météo, la
 * part de l'adhérence d'un pneu idéal qu'il tient (de 0,5 à 1) ; motricité : facteur sur ce que les
 * roues motrices transmettent (1 : un pneu de route).
 */
export interface ComportementPneu {
  tenue: ParMeteo;
  motricite: number;
}

/**
 * Effets de la préparation sur la route.
 * - `ecartPneu` : écart le plus fort, d'un pneu à celui d'origine, sur l'adhérence d'une météo (part) ;
 *   la validation du catalogue le fait tenir.
 * - `largeur` : par part d'écart de la largeur du pneu à celle d'origine (+0,2 : 20 % plus large), ce
 *   que gagne l'adhérence (au sec, la gomme posée ; sous la pluie, l'aquaplanage ; sur la neige, un pneu
 *   étroit coupe la couche) et la motricité au sec ; chaque effet borné à `max` (part).
 * - `assiette` : effet à l'assiette posée au sol (`basse`, réglage 1) et rehaussée au plus (`haute`,
 *   réglage −1), proportionnel entre les deux : adhérence par météo (au sol, plus vive au sec ; elle
 *   racle la neige), roulis de caisse (facteur).
 */
export const PREPARATION = {
  ecartPneu: 0.15,
  largeur: { sec: 0.12, pluie: -0.12, neige: -0.12, motriciteSec: 0.15, max: 0.03 },
  assiette: {
    basse: { tenue: { sec: 0.06, pluie: 0, neige: -0.1 }, roulis: 0.6 },
    haute: { tenue: { sec: -0.05, pluie: 0, neige: 0.06 }, roulis: 1.35 },
  },
} as const;

/** Ce que la préparation change à la conduite, par rapport au véhicule d'origine (1 : rien). */
export interface PreparationRoute {
  /** Facteur sur l'adhérence (en courbe, au freinage), par météo. */
  tenue: ParMeteo;
  /** Facteur sur la motricité (ce que les roues motrices transmettent), par météo. */
  motricite: ParMeteo;
  /** Facteur sur le roulis de caisse d'une voiture. */
  roulis: number;
}

const UN: ParMeteo = Object.freeze({ sec: 1, pluie: 1, neige: 1 });

/** Le véhicule d'origine : rien ne change. */
export const PREPARATION_ORIGINE: PreparationRoute = Object.freeze({ tenue: UN, motricite: UN, roulis: 1 });

const borne = (value: number, max: number) => Math.max(-max, Math.min(max, Number.isFinite(value) ? value : 0));

/**
 * Facteurs de la préparation, fonction pure : le pneu posé et celui d'origine (absents : le véhicule
 * garde ses roues, rien ne change), l'écart de largeur à l'origine (part), l'assiette (de −1, rehaussée
 * au plus, à 1, posée au sol ; 0 : origine).
 */
export function facteursPreparation(pneu: ComportementPneu | null | undefined, origine: ComportementPneu | null | undefined, largeur: number, assiette: number): PreparationRoute {
  const L = PREPARATION.largeur;
  const a = Math.max(-1, Math.min(1, Number.isFinite(assiette) ? assiette : 0));
  const cote = a >= 0 ? PREPARATION.assiette.basse : PREPARATION.assiette.haute;
  const part = Math.abs(a);
  const tenue = { sec: 1, pluie: 1, neige: 1 };
  const motricite = { sec: 1, pluie: 1, neige: 1 };
  const w = Number.isFinite(largeur) ? largeur : 0;
  for (const meteo of METEOS) {
    const pneuIci = pneu && origine ? pneu.tenue[meteo] / Math.max(0.1, origine.tenue[meteo]) : 1;
    const largeurIci = 1 + borne(L[meteo] * w, L.max);
    const assietteIci = 1 + cote.tenue[meteo] * part;
    tenue[meteo] = pneuIci * largeurIci * assietteIci;
    const gomme = pneu && origine ? pneu.motricite / Math.max(0.1, origine.motricite) : 1;
    motricite[meteo] = tenue[meteo] * gomme * (meteo === 'sec' ? 1 + borne(L.motriciteSec * w, L.max) : 1);
  }
  return { tenue, motricite, roulis: 1 + (cote.roulis - 1) * part };
}
