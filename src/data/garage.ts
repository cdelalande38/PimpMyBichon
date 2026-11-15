// Le garage (§ 4), décrit en données : enveloppe, mobilier en volumes simples (placeholder_*,
// listés dans TODO_ASSETS.md), sources lumineuses et halos. Les couleurs des sources viennent
// de l'ambiance choisie (src/data/ambiances.ts) ; le composant ne connaît aucun objet.
// Repère : x vers la droite vue du canapé, z vers le canapé, y vers le haut, en mètres,
// origine au centre du sol. Cotes relevées sur le lieu (pièce de 7,5 × 6 m, retombée à 2,35 m) ;
// le véhicule est au centre, parallèle au mur du fond, l'avant vers la gauche (vue de départ :
// trois quarts avant, mur du fond et mur rouge dans le même cadre). Le sol et le plafond se
// prolongent hors de la pièce et s'y perdent dans la brume de l'ambiance.

import type { Ambiance } from './ambiances.ts';
import { BACK, CASIER, CASIER_CASES, D, H, LEFT, RIGHT, SOFFIT, W, type Facing, type GarageMaterialId, type GarageTextureId, type Prop, type Vec3 } from './garageBase.ts';
import { PROPS_ATELIER } from './garageProps/atelier.ts';
import { PROPS_ENGINS } from './garageProps/engins.ts';
import { PROPS_LOISIRS } from './garageProps/loisirs.ts';
import { PROPS_SALON } from './garageProps/salon.ts';

// Socle (cotes, matériaux, types du mobilier) : src/data/garageBase.ts, réexporté ici.
export * from './garageBase.ts';

/** Côté de la pièce dont une source prend la couleur. */
export type ColorKey = 'left' | 'right' | 'center' | 'violet' | 'accent' | 'bar' | 'spotLeft' | 'spotCenter' | 'spotRight';

export function colorOf(ambiance: Ambiance, key: ColorKey): string {
  switch (key) {
    case 'spotLeft':
      return ambiance.spots[0];
    case 'spotCenter':
      return ambiance.spots[1];
    case 'spotRight':
      return ambiance.spots[2];
    default:
      return ambiance[key];
  }
}

export interface Panel {
  name: string;
  texture: GarageTextureId;
  size: readonly [number, number];
  at: Vec3;
  facing: Facing;
  /** Émissif (écran) : multiplicateur ; absent, la surface est éclairée. */
  glow?: number;
  /** Répétitions de la texture sur la largeur et la hauteur (absent : le dessin entier). */
  repeat?: readonly [number, number];
  /** Absent du reflet du sol (petit, en hauteur). */
  small?: boolean;
}

/**
 * Enseigne néon en tubes (src/scene/garage/neon.ts) : sa composition est NEON_SIGNS[name]
 * (src/data/neonAlphabet.ts), à la hauteur de capitale conseillée, couleurs de verre comprises.
 * `at` : centre de l'enseigne, sur le mur ; `facing` : sens dans lequel elle regarde.
 */
export interface NeonSign {
  name: string;
  at: Vec3;
  facing: Facing;
  /** Luminance des tubes, en multiple de la force des tubes de l'ambiance (au-delà de 1 : bloom). */
  gain: number;
}

export interface Halo {
  /** `goutte` : halo d'un spot sur un mur, haut net, pointe fondue vers le bas ; `rond` : nappe douce. */
  kind: 'goutte' | 'rond';
  size: readonly [number, number];
  at: Vec3;
  facing: Facing;
  color: ColorKey;
  gain: number;
}

export interface Spot {
  at: Vec3;
  color: ColorKey;
  /** Rayon de l'optique visible, en mètres. */
  radius: number;
  /** Halo en goutte dessiné sur le mur du fond, sous le spot. */
  wallHalo: boolean;
  /** Cône de lumière dans la brume, sous le spot (atmosphère). */
  beam?: boolean;
}

/** Rampe lumineuse douce et plane : largeur, hauteur, centre, orientation (défaut : vers le sol). */
export interface LightBar {
  size: readonly [number, number];
  at: Vec3;
  facing?: Facing;
}

/** Nappe de brume au ras du sol : plan vertical additif, clair en bas, fondu vers le haut. */
export interface Mist {
  size: readonly [number, number];
  at: Vec3;
  facing: Facing;
  color: ColorKey;
  gain: number;
}

/**
 * Bandeau LED : une bande plate de 3 cm, tournée vers l'intérieur de la pièce (invisible de
 * dehors, où passe la caméra). Il court le long de x (face ±z ou ±y) ou de z (face ±x).
 */
export interface Strip {
  from: Vec3;
  to: Vec3;
  color: ColorKey;
  facing: Facing;
  /**
   * Coupe caméra : éléments qui le portent (un bandeau collé sous une retombée), dont il suit la
   * disparition. Sans cela, il reste collé à son mur, à face unique, et ne cache jamais rien.
   */
  on?: readonly string[];
}

export interface GarageLayout {
  /** Largeur (x), profondeur (z), hauteur (y). */
  room: { width: number; depth: number; height: number };
  /**
   * Pose du véhicule : rotation de son groupe autour de la verticale (π : l'avant vers la gauche).
   * `protect` : volume protégé de la coupe caméra (src/scene/garage/cut.ts), la boîte mesurée du
   * véhicule gonflée sur les côtés et au-dessus, prolongée sous le sol de `reflection` fois sa
   * hauteur (son reflet dans le carrelage) ; `waiting` la remplace tant que le modèle n'est pas mesuré, ou s'il manque.
   * `hysteresis` : gonflement du second volume, dont un élément masqué doit sortir pour revenir.
   */
  vehicle: {
    turn: number;
    protect: { waiting: { min: Vec3; max: Vec3 }; side: number; top: number; reflection: number; hysteresis: number };
  };
  /**
   * Coupe caméra : ce qui passerait entre l'œil et le véhicule quitte l'image.
   * `wallTolerance` : écart au plan d'un mur, du plafond ou du sol en deçà duquel un élément y est
   * adossé ; il disparaît avec le mur quand l'œil passe derrière (R1). `contactTolerance` : écart
   * entre deux éléments en deçà duquel l'un porte l'autre (R3). `wallBand` : bande d'hystérésis
   * de part et d'autre du plan d'un mur. `fadeMs` : durée du fondu (aucun en mouvement réduit et
   * en mode photo).
   */
  cut: { wallTolerance: number; contactTolerance: number; wallBand: number; fadeMs: number };
  /**
   * Caméra d'orbite : cible (sous le centre du véhicule, pour le remonter au-dessus du dock),
   * angle polaire borné (§ 5.1 : ni sous le sol, ni à la verticale) et marge de cadrage (vue de
   * trois quarts, le véhicule paraît plus long que de profil).
   */
  orbit: { target: Vec3; minPolar: number; maxPolar: number; frameMargin: number };
  /**
   * Part du reflet de la sonde gardée sur le sol quand la réflexion planaire est active : c'est
   * elle qui fait le reflet, la sonde (qui voit les rampes du plafond) le blanchirait.
   */
  mirrorIbl: number;
  /**
   * Sol et plafond prolongés hors de la pièce (côté du carré, en mètres) ; ils se perdent dans la
   * brume de l'ambiance : à `falloff` mètres des murs, il en reste 1/e. Coupé à aucun niveau.
   */
  outside: { extent: number; falloff: number };
  /** Brouillard léger (atmosphère) : distances de début et de fin, depuis la caméra. */
  fog: { near: number; far: number };
  /** Cônes de lumière sous les spots : hauteur et rayon au sol. */
  beam: { height: number; radius: number };
  lightBars: readonly LightBar[];
  mists: readonly Mist[];
  /** Retombées de plafond blanches : taille et centre de chaque boîte. */
  soffits: ReadonlyArray<{ size: Vec3; at: Vec3 }>;
  /** Enveloppe : matériau de chaque face, tournée vers l'intérieur. */
  surfaces: Record<'floor' | 'ceiling' | 'back' | 'front' | 'left' | 'right', GarageMaterialId>;
  /** Halo en goutte sous chaque spot de la retombée : largeur, hauteur, force. */
  spotHalo: { size: readonly [number, number]; gain: number };
  /** Position de la sonde de réflexion : le centre du véhicule. */
  probe: Vec3;
  /** Les trois lumières colorées réelles (la quatrième est l'ambiance). */
  lights: { left: Vec3; right: Vec3; key: Vec3; keyTarget: Vec3 };
  spots: readonly Spot[];
  strips: readonly Strip[];
  /** Pieds des tubes LED (ambiance qui en a), et leur hauteur. */
  standTubes: { at: ReadonlyArray<readonly [number, number]>; height: number };
  halos: readonly Halo[];
  panels: readonly Panel[];
  signs: readonly NeonSign[];
  props: readonly Prop[];
}

/** Les spots sont à 15 cm du mur, juste sous la retombée. */
const SPOT_Y = SOFFIT - 0.006;
const SPOT_Z = BACK + 0.15;

export const GARAGE: GarageLayout = {
  room: { width: W, depth: D, height: H },
  vehicle: {
    turn: Math.PI,
    protect: {
      // Gabarit du modèle de banc d'essai tel que BenchCar le mesure (sommets du GLB :
      // 4,36 × 2,54 × 1,15 m), posé dans la pièce : le mobilier reste hors du grand volume qui en
      // découle, sinon la coupe caméra le garde masqué.
      waiting: { min: [-2.18, 0, -1.275], max: [2.18, 1.15, 1.275] },
      side: 0.15,
      top: 0.2,
      // Le reflet entier du véhicule est protégé : le toit se lit dans le carrelage.
      reflection: 1,
      hysteresis: 0.15,
    },
  },
  cut: { wallTolerance: 0.15, contactTolerance: 0.02, wallBand: 0.1, fadeMs: 180 },
  orbit: { target: [0, 0.12, 0], minPolar: 0.55, maxPolar: 1.52, frameMargin: 1.22 },
  mirrorIbl: 0.2,
  outside: { extent: 70, falloff: 4 },
  fog: { near: 12, far: 46 },
  beam: { height: 2.2, radius: 0.5 },
  // Rampes au-dessus du véhicule, dans le sens de sa longueur : elles dessinent de longs reflets
  // sur le toit, les épaules et les flancs, et éclairent la caisse par la sonde de réflexion.
  // Vues de la sonde seule (src/render/layers.ts) : le haut de l'image reste calme.
  lightBars: [
    { size: [3.8, 0.4], at: [0, H - 0.08, -0.75] },
    { size: [3.8, 0.4], at: [0, H - 0.08, 0.55] },
    { size: [3.8, 0.4], at: [0, H - 0.08, 1.75] },
    // Sur le mur du canapé, tournée vers le véhicule : elle trace la longue ligne claire du flanc.
    { size: [6.2, 0.3], at: [0, 2.2, D / 2 - 0.04], facing: '-z' },
  ],
  // Nappes au ras du sol : le long du fond, devant le véhicule et sur les côtés.
  mists: [
    { size: [7.2, 0.9], at: [0, 0.45, -2.2], facing: '+z', color: 'violet', gain: 1 },
    { size: [7.2, 0.6], at: [0, 0.3, 1.9], facing: '+z', color: 'left', gain: 0.6 },
    { size: [5.5, 0.8], at: [-2.9, 0.4, 0], facing: '+x', color: 'left', gain: 0.8 },
    { size: [5.5, 0.8], at: [3.1, 0.4, 0], facing: '-x', color: 'right', gain: 0.8 },
  ],
  soffits: [
    // Le long du mur du fond, jusqu'à la colonne noire.
    { size: [1.5 - LEFT, H - SOFFIT, 0.35], at: [(LEFT + 1.5) / 2, (H + SOFFIT) / 2, BACK + 0.175] },
    // Le long du mur rouge, avec son bandeau LED.
    { size: [0.35, H - SOFFIT, D - 0.35], at: [RIGHT - 0.175, (H + SOFFIT) / 2, 0.175] },
  ],
  // Pièce fermée : lambris de pin vertical à gauche et à l'avant, plafond en lames entre solives.
  surfaces: { floor: 'carrelage', ceiling: 'lambris', back: 'murBlanc', front: 'pin', left: 'pin', right: 'murRouge' },
  spotHalo: { size: [0.62, 1.05], gain: 1.6 },
  probe: [0, 0.7, 0],
  lights: { left: [-2.4, 2.1, -1.6], right: [1.8, 2.1, -1.3], key: [-0.2, 2.85, 0.9], keyTarget: [0, 0.6, 0] },
  spots: [
    // Paires espacées de 0,4 m : bleu à gauche, blanc au centre, rouge à droite.
    { at: [-1.9, SPOT_Y, SPOT_Z], color: 'spotLeft', radius: 0.045, wallHalo: true, beam: true },
    { at: [-1.5, SPOT_Y, SPOT_Z], color: 'spotLeft', radius: 0.045, wallHalo: true, beam: true },
    { at: [-0.5, SPOT_Y, SPOT_Z], color: 'spotCenter', radius: 0.045, wallHalo: true, beam: true },
    { at: [-0.1, SPOT_Y, SPOT_Z], color: 'spotCenter', radius: 0.045, wallHalo: true, beam: true },
    { at: [0.7, SPOT_Y, SPOT_Z], color: 'spotRight', radius: 0.045, wallHalo: true, beam: true },
    { at: [1.1, SPOT_Y, SPOT_Z], color: 'spotRight', radius: 0.045, wallHalo: true, beam: true },
    // Petits spots chauds de la retombée.
    { at: [-3.1, SPOT_Y, SPOT_Z], color: 'accent', radius: 0.025, wallHalo: false },
    { at: [-2.6, SPOT_Y, SPOT_Z], color: 'accent', radius: 0.025, wallHalo: false },
    { at: [0.3, SPOT_Y, SPOT_Z], color: 'accent', radius: 0.025, wallHalo: false },
    // Spots sur rail au-dessus du mur rouge.
    { at: [RIGHT - 0.5, H - 0.01, -1.6], color: 'accent', radius: 0.03, wallHalo: false },
    { at: [RIGHT - 0.5, H - 0.01, -0.2], color: 'accent', radius: 0.03, wallHalo: false },
    { at: [RIGHT - 0.5, H - 0.01, 1.2], color: 'accent', radius: 0.03, wallHalo: false },
    // Casier à casques : un point LED en haut de chaque case, qui éclaire le casque d'en haut.
    ...CASIER_CASES.map((dz): Spot => ({
      at: [CASIER.x + 0.06, CASIER.y + 0.364, CASIER.z + dz],
      color: 'left',
      radius: 0.02,
      wallHalo: false,
    })),
  ],
  strips: [
    // Bandeau rouge sous la retombée du mur droit : il disparaît avec elle (œil au-dessus du
    // plafond), sinon il flotterait seul dans le vide.
    { from: [RIGHT - 0.36, SOFFIT - 0.015, BACK + 0.5], to: [RIGHT - 0.36, SOFFIT - 0.015, D / 2 - 0.1], color: 'right', facing: '-x', on: ['retombee_2'] },
    // Bandeaux en haut du mur gauche et du mur du canapé, et derrière le canapé : ce sont eux
    // que la caisse reflète vers la caméra (le mur du fond ne se voit que dans les dessus).
    { from: [LEFT + 0.03, H - 0.05, BACK + 0.4], to: [LEFT + 0.03, H - 0.05, D / 2 - 0.05], color: 'left', facing: '+x' },
    { from: [LEFT + 0.05, H - 0.05, D / 2 - 0.03], to: [-0.1, H - 0.05, D / 2 - 0.03], color: 'left', facing: '-z' },
    { from: [0.1, H - 0.05, D / 2 - 0.03], to: [RIGHT - 0.4, H - 0.05, D / 2 - 0.03], color: 'right', facing: '-z' },
    { from: [-1.4, 1.1, D / 2 - 0.03], to: [-0.2, 1.1, D / 2 - 0.03], color: 'violet', facing: '-z' },
    { from: [0.2, 0.95, D / 2 - 0.03], to: [2.4, 0.95, D / 2 - 0.03], color: 'center', facing: '-z' },
  ],
  standTubes: {
    at: [
      [-3.45, -0.95],
      [3.3, -0.3],
      [-0.9, -2.2],
      [1.2, 2.75],
      [3.35, 2.6],
    ],
    height: 1.9,
  },
  halos: [
    // Mur du fond lavé en trois zones : bleu-violet, blanc, rouge, passages violet et magenta.
    { kind: 'rond', size: [4.2, 3.6], at: [-2.6, 1.5, BACK + 0.004], facing: '+z', color: 'left', gain: 0.42 },
    { kind: 'rond', size: [2.6, 2.6], at: [-1.0, 1.5, BACK + 0.005], facing: '+z', color: 'violet', gain: 0.4 },
    { kind: 'rond', size: [1.8, 2.6], at: [-0.35, 1.6, BACK + 0.006], facing: '+z', color: 'spotCenter', gain: 0.22 },
    { kind: 'rond', size: [1.4, 2.4], at: [0.3, 1.6, BACK + 0.007], facing: '+z', color: 'center', gain: 0.28 },
    { kind: 'rond', size: [2.2, 3.4], at: [1.05, 1.5, BACK + 0.008], facing: '+z', color: 'right', gain: 1.0 },
    // Mur rouge : nappe sur toute la hauteur et festons sous les spots du rail.
    { kind: 'rond', size: [7.5, 4.2], at: [RIGHT - 0.004, 1.3, -0.2], facing: '-x', color: 'right', gain: 0.55 },
    { kind: 'goutte', size: [1.1, 1.9], at: [RIGHT - 0.006, H - 1.0, -1.6], facing: '-x', color: 'accent', gain: 0.35 },
    { kind: 'goutte', size: [1.1, 1.9], at: [RIGHT - 0.006, H - 1.0, -0.2], facing: '-x', color: 'accent', gain: 0.35 },
    { kind: 'goutte', size: [1.1, 1.9], at: [RIGHT - 0.006, H - 1.0, 1.2], facing: '-x', color: 'accent', gain: 0.35 },
    // Panneau de cible rétroéclairé bleu-violet (le panneau masque le centre : reste le liseré).
    { kind: 'rond', size: [1.9, 1.7], at: [RIGHT - 0.007, 1.8, 0.4], facing: '-x', color: 'left', gain: 1.6 },
    // Casier à casques : la nappe bleue de ses points LED déborde sur le lambris et la moto dessous.
    { kind: 'rond', size: [2.0, 1.6], at: [LEFT + 0.004, 1.85, CASIER.z], facing: '+x', color: 'left', gain: 0.9 },
    // Mur gauche : nappe bleu-violet.
    { kind: 'rond', size: [6, 3], at: [LEFT + 0.003, 1.3, -0.5], facing: '+x', color: 'left', gain: 0.35 },
    // Sol : violet à gauche et au centre, magenta-rouge à droite, plus clair au pied du fond.
    { kind: 'rond', size: [5.5, 4.5], at: [-2.0, 0.002, -1.2], facing: '+y', color: 'violet', gain: 0.22 },
    { kind: 'rond', size: [4.5, 4.0], at: [0, 0.003, -1.6], facing: '+y', color: 'center', gain: 0.16 },
    { kind: 'rond', size: [4.5, 5.0], at: [2.0, 0.004, -0.8], facing: '+y', color: 'right', gain: 0.26 },
    { kind: 'rond', size: [4.6, 6.0], at: [-2.3, 0.0045, 0.4], facing: '+y', color: 'left', gain: 0.42 },
    { kind: 'rond', size: [3.0, 2.2], at: [-0.3, 0.005, -2.5], facing: '+y', color: 'spotCenter', gain: 0.12 },
    // Flaques sous les spots du fond (bleu, rouge) et sous les rampes, autour du véhicule.
    { kind: 'rond', size: [1.8, 1.4], at: [-1.7, 0.006, -2.45], facing: '+y', color: 'spotLeft', gain: 0.35 },
    { kind: 'rond', size: [1.8, 1.4], at: [0.9, 0.007, -2.45], facing: '+y', color: 'spotRight', gain: 0.3 },
    { kind: 'rond', size: [6.2, 4.2], at: [0, 0.008, 0.5], facing: '+y', color: 'bar', gain: 0.04 },
  ],
  panels: [
    { name: 'placeholder_ecran', texture: 'ecran', size: [1.45, 0.82], at: [2.25, 1.5, BACK + 0.405], facing: '+z', glow: 2.6 },
  ],
  signs: [
    { name: 'neon_pimpmybichon', at: [LEFT, 2.05, -1.55], facing: '+x', gain: 0.45 },
    // Au-dessus du canapé : vu de dos depuis la caméra de départ, il se lit dans les flancs.
    { name: 'neon_good_vibes', at: [0, 1.75, D / 2], facing: '-z', gain: 0.45 },
  ],
  // Mobilier : quatre familles, un fichier chacune (src/data/garageProps/).
  props: [...PROPS_SALON, ...PROPS_ATELIER, ...PROPS_ENGINS, ...PROPS_LOISIRS],
};
