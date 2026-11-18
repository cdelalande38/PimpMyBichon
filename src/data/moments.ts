// Moments de la sortie (§ 5.5, mode jour demandé le 17 novembre 2026) : la nuit (par défaut) et le
// jour, chacun décliné par météo (sec, pluie, neige). Tout ce qui décrit un moment est ici, en données :
// ciel, astre (lune la nuit, soleil le jour : direction, couleur, intensité), lumière d'ambiance,
// brouillard et brume au sol, relief lointain, étalonnage et exposition de l'image, état des phares,
// des lampadaires, des néons et des fenêtres, part du reflet sur la carrosserie, ombre portée, et la
// teinte de plein jour des matières du décor. La scène (src/drive/scene/moment.ts) les mêle sans
// allocation, image par image, selon la météo du ciel et le passage d'un moment à l'autre.
//
// La nuit reprend à l'identique les valeurs qui vivaient dans src/drive/scene/ (ciel.ts, nuit.ts,
// materiaux.ts, decor.ts) avant la vague S : la nuit ne change pas. Ses trois météos ne diffèrent
// que par les étoiles et les voiles (mêmes formules qu'avant, prises aux bornes).

import type { Weather } from '../drive/contrat.ts';
import type { Grade } from '../render/lut.ts';

export type Moment = 'nuit' | 'jour';

export const MOMENTS: readonly { id: Moment; label: string }[] = [
  { id: 'nuit', label: 'Nuit' },
  { id: 'jour', label: 'Jour' },
];

export const MOMENT_PAR_DEFAUT: Moment = 'nuit';

/** Lecture tolérante : une valeur inconnue retombe sur la nuit. */
export function momentOf(raw: unknown): Moment {
  return MOMENTS.some((item) => item.id === raw) ? (raw as Moment) : MOMENT_PAR_DEFAUT;
}

/** Couleur sRGB « #rrggbb ». */
type Teinte = string;
type Direction = readonly [number, number, number];

/**
 * Matières du décor dont la teinte change au grand jour : les rôles des tronçons de la carte
 * (MapMaterialRole) et les matières partagées du décor (arbres, relief lointain).
 */
export const MATIERES_DU_JOUR = ['chaussee', 'voie', 'marquage', 'accotement', 'terrain', 'eau', 'mur', 'ouvrage', 'arbre', 'lointain'] as const;
export type MatiereDuJour = (typeof MATIERES_DU_JOUR)[number];

export interface Look {
  ciel: {
    zenith: Teinte;
    milieu: Teinte;
    horizon: Teinte;
    /** Lueur du couchant (la nuit) et sa direction (horizontale). */
    lueur: Teinte;
    lueurDirection: Direction;
    /** Étoiles : 0 (aucune) à 1. */
    etoiles: number;
    /** Couverture des nuages : 1 la nuit au sec ; au-delà, plus couvert. */
    nuages: number;
    /** Teinte des nuages éclairés de jour (la nuit, ils prennent l'horizon et la lune). */
    teinteNuages: Teinte;
    /** 0 : ciel de nuit (lune, voiles, étoiles) ; 1 : ciel de jour (soleil, nuages opaques). */
    jour: number;
  };
  /** Lune ou soleil : direction vers lui (repère de la carte), teinte et intensité de sa lumière, éclat du disque. */
  astre: { direction: Direction; couleur: Teinte; intensite: number; teinteCiel: Teinte; disque: number };
  /** Lumière d'ambiance (hémisphère) : ciel, sol, intensité. */
  ambiance: { ciel: Teinte; sol: Teinte; intensite: number };
  /** Ciel réfléchi par l'eau et les vitres (calculé) : horizon et zénith. */
  reflet: { horizon: Teinte; zenith: Teinte };
  /** Brouillard de l'horizon : teinte et densité (facteur de la densité qui noie la fin des tronçons chargés ; jamais moins de 1). */
  brouillard: { couleur: Teinte; densite: number };
  /** Brume au sol : teinte et densité à sa base (1/m). */
  brume: { couleur: Teinte; densite: number };
  /** Relief lointain (sa teinte est dans `matieres`) : voile d'horizon (teinte × force) et part minimale de ce voile (0 la nuit). */
  lointain: { voile: Teinte; voileForce: number; voileMin: number };
  /** Chaîne d'image : exposition, bloom, étalonnage. */
  image: { exposition: number; bloom: number; etalonnage: Grade };
  /** Phares, lampadaires, néons des enseignes, fenêtres allumées : 1 allumés, 0 éteints. */
  phares: number;
  lampadaires: number;
  neons: number;
  fenetres: number;
  /** Part du reflet de l'environnement (la sonde) sur la carrosserie. */
  carrosserie: number;
  /** Bande d'horizon vue par la sonde (src/drive/scene/ciel.ts, createProbeBand). */
  bandeSonde: number;
  /** Ombre portée du véhicule par l'astre (opacité, 0 : aucune ; l'ombre de contact reste). */
  ombre: number;
  /** Netteté de cette ombre : 1, soleil franc (silhouette étirée à l'opposé du soleil) ; 0, ciel couvert (ombre courte et douce, sous le véhicule). */
  ombreNette: number;
  /** Teinte des matières du décor ; absente : la teinte de nuit (src/drive/scene/materiaux.ts, ROLE_LOOKS). */
  matieres: Partial<Record<MatiereDuJour, Teinte>>;
}

// --- Nuit : les valeurs d'avant la vague S, à l'identique. ---

const NUIT_CIEL = {
  zenith: '#02040f',
  milieu: '#0a1330',
  horizon: '#2e4277',
  lueur: '#3e2c4c',
  lueurDirection: [-0.85, 0, 0.5],
  teinteNuages: '#000000',
  jour: 0,
} as const;

const NUIT: Omit<Look, 'ciel'> = {
  astre: { direction: [0.42, 0.25, 0.87], couleur: '#a9bcf0', intensite: 0.8, teinteCiel: '#c9d6ff', disque: 1 },
  ambiance: { ciel: '#2a3a6c', sol: '#07070a', intensite: 0.6 },
  reflet: { horizon: '#33497f', zenith: '#060b1e' },
  brouillard: { couleur: '#141d3a', densite: 1 },
  brume: { couleur: '#3a4870', densite: 0.014 },
  lointain: { voile: '#2e4277', voileForce: 0.55, voileMin: 0 },
  image: { exposition: 1.25, bloom: 0.95, etalonnage: { shadows: '#2c3c9a', highlights: '#ffd2a0', amount: 0.1, saturation: 1.1, contrast: 1.1 } },
  phares: 1,
  lampadaires: 1,
  neons: 1,
  fenetres: 1,
  carrosserie: 5.5,
  bandeSonde: 0.5,
  ombre: 0,
  ombreNette: 1,
  matieres: {},
};

// --- Jour : soleil franc au sec, couvert gris sous la pluie, blanc laiteux sous la neige. ---

/** Soleil haut (environ 45°), dans le dos de la caméra sur une bonne part des parcours. */
const SOLEIL: Direction = [0.45, 0.72, 0.53];

/**
 * Teintes de plein jour des matières : de vrais albédos (linéaires), la nuit gardant les siens (1,5 à
 * 4 %). Enrobé 9 à 11 %, accotement 13 %, herbe 10 % (vert 11 %, rouge 9 % : vue avec ses textures
 * le 18 novembre, l'herbe à 17 % paraissait fluo), enduit des murs 42 % avant la teinte du bâtiment
 * (× 0,6 à 1,7 dans le nuanceur, une teinte d'enduit par bâtiment de jour), béton 34 %, feuillage 7 %.
 * Les textures du sol et du bâti (src/drive/scene/sol.ts) modulent cette teinte autour de 1 ; de jour,
 * l'herbe varie en plus par plaques (pmbDayGrass).
 */
const MATIERES_JOUR: Look['matieres'] = {
  chaussee: '#5b5c61',
  voie: '#56575c',
  marquage: '#e6e4dc',
  accotement: '#6e6553',
  terrain: '#55653b',
  eau: '#0b1a24',
  mur: '#b4aa9e',
  ouvrage: '#9c9b96',
  arbre: '#35532c',
  lointain: '#5d7652',
};

const JOUR_COMMUN = {
  phares: 0,
  lampadaires: 0,
  neons: 0,
  fenetres: 0,
  bandeSonde: 0,
  matieres: MATIERES_JOUR,
} as const;

const JOUR_SEC: Look = {
  ...JOUR_COMMUN,
  ciel: { zenith: '#2a62c4', milieu: '#5f97de', horizon: '#c3d6ea', lueur: '#000000', lueurDirection: [-0.85, 0, 0.5], etoiles: 0, nuages: 0.8, teinteNuages: '#f3f5f8', jour: 1 },
  astre: { direction: SOLEIL, couleur: '#fff1dc', intensite: 3.4, teinteCiel: '#fff4e0', disque: 1 },
  ambiance: { ciel: '#a9c4e8', sol: '#5a5446', intensite: 1.35 },
  reflet: { horizon: '#c3d6ea', zenith: '#3f78cf' },
  brouillard: { couleur: '#b9cbe0', densite: 1 },
  brume: { couleur: '#c9d4e0', densite: 0.004 },
  lointain: { voile: '#aabfd6', voileForce: 1, voileMin: 0.62 },
  image: { exposition: 1.0, bloom: 0.25, etalonnage: { shadows: '#34466e', highlights: '#fff0d8', amount: 0.05, saturation: 1.08, contrast: 1.05 } },
  carrosserie: 1.1,
  ombre: 0.62,
  ombreNette: 1,
};

const JOUR_PLUIE: Look = {
  ...JOUR_COMMUN,
  ciel: { zenith: '#6d747d', milieu: '#858c95', horizon: '#a3a9b0', lueur: '#000000', lueurDirection: [-0.85, 0, 0.5], etoiles: 0, nuages: 2.2, teinteNuages: '#9aa0a8', jour: 1 },
  astre: { direction: SOLEIL, couleur: '#dfe4ea', intensite: 0.55, teinteCiel: '#c8ccd2', disque: 0 },
  ambiance: { ciel: '#b2bac4', sol: '#4a4a48', intensite: 2.1 },
  reflet: { horizon: '#a3a9b0', zenith: '#747b84' },
  brouillard: { couleur: '#959ca4', densite: 1.35 },
  brume: { couleur: '#a2a9b1', densite: 0.01 },
  lointain: { voile: '#959ca4', voileForce: 1, voileMin: 0.75 },
  image: { exposition: 1.15, bloom: 0.2, etalonnage: { shadows: '#3a4658', highlights: '#eef2f6', amount: 0.05, saturation: 0.95, contrast: 1.04 } },
  carrosserie: 1.3,
  ombre: 0.22,
  ombreNette: 0,
};

const JOUR_NEIGE: Look = {
  ...JOUR_COMMUN,
  ciel: { zenith: '#b9c0c9', milieu: '#ccd2d9', horizon: '#dde1e6', lueur: '#000000', lueurDirection: [-0.85, 0, 0.5], etoiles: 0, nuages: 2.2, teinteNuages: '#d6dae0', jour: 1 },
  astre: { direction: SOLEIL, couleur: '#eef1f5', intensite: 0.7, teinteCiel: '#e8ebef', disque: 0 },
  ambiance: { ciel: '#dfe4ea', sol: '#8c9096', intensite: 1.9 },
  reflet: { horizon: '#dde1e6', zenith: '#b9c0c9' },
  brouillard: { couleur: '#d3d8de', densite: 1.4 },
  brume: { couleur: '#dce1e7', densite: 0.009 },
  lointain: { voile: '#d3d8de', voileForce: 1, voileMin: 0.85 },
  image: { exposition: 0.95, bloom: 0.15, etalonnage: { shadows: '#56637a', highlights: '#f4f6fa', amount: 0.04, saturation: 0.92, contrast: 1.03 } },
  carrosserie: 1.2,
  ombre: 0.25,
  ombreNette: 0,
};

/** Chaque moment, par météo. */
export const LOOKS: Readonly<Record<Moment, Readonly<Record<Weather, Look>>>> = {
  nuit: {
    // Étoiles et voiles : 1 - 0,9 × mouillé et 1 + 0,6 × mouillé + 0,3 × neige (formules d'avant la vague S).
    sec: { ...NUIT, ciel: { ...NUIT_CIEL, etoiles: 1, nuages: 1 } },
    pluie: { ...NUIT, ciel: { ...NUIT_CIEL, etoiles: 0.1, nuages: 1.6 } },
    neige: { ...NUIT, ciel: { ...NUIT_CIEL, etoiles: 0.1, nuages: 1.9 } },
  },
  jour: { sec: JOUR_SEC, pluie: JOUR_PLUIE, neige: JOUR_NEIGE },
};

/** Le moment et la météo donnés (repli : nuit, sec). */
export function lookOf(moment: Moment, weather: Weather): Look {
  return LOOKS[moment]?.[weather] ?? LOOKS.nuit.sec;
}
