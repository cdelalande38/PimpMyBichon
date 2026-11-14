// Le garage (§ 4), décrit en données : enveloppe, mobilier en volumes simples (placeholder_*,
// listés dans TODO_ASSETS.md), sources lumineuses et halos. Les couleurs des sources viennent
// de l'ambiance choisie (src/data/ambiances.ts) ; le composant ne connaît aucun objet.
// Repère : x vers la droite vue du canapé, z vers le canapé, y vers le haut, en mètres,
// origine au centre du sol. Cotes relevées sur le lieu (pièce de 7,5 × 6 m, retombée à 2,35 m) ;
// le véhicule est au centre, parallèle au mur du fond, l'avant vers la gauche (vue de départ :
// trois quarts avant, mur du fond et mur rouge dans le même cadre). Le sol et le plafond se
// prolongent hors de la pièce et s'y perdent dans la brume de l'ambiance.

import type { Ambiance } from './ambiances.ts';

export type Vec3 = readonly [number, number, number];

/** Textures dessinées au canvas (src/scene/garage/textures.ts). */
export type GarageTextureId =
  | 'carrelage'
  | 'carrelageRugosite'
  | 'osb'
  | 'lambris'
  | 'pin'
  | 'tiroirs'
  | 'credence'
  | 'ecran'
  | 'popart'
  | 'cible';

export interface GarageMaterial {
  color: string;
  roughness: number;
  metalness: number;
  map?: GarageTextureId;
  /** Répétitions de la texture par mètre (u, v), partagées par la carte de rugosité. */
  repeat?: readonly [number, number];
  /** Carte de rugosité (canal vert) : joints plus mats que les carreaux. */
  roughnessMap?: GarageTextureId;
  /** Couleur émissive fixe (optiques du quad, fronton du flipper). */
  emissive?: string;
  emissiveIntensity?: number;
  /**
   * Part du reflet de la sonde (environnement). Bas pour les surfaces mates : la sonde voit la
   * pièce éclairée, elle ne doit pas l'éclairer une seconde fois. Défaut : 0,2.
   */
  env?: number;
}

export const GARAGE_MATERIALS = {
  blanc: { color: '#e9e7e2', roughness: 0.55, metalness: 0 },
  tiroirs: { color: '#f2f0ec', roughness: 0.4, metalness: 0, map: 'tiroirs', repeat: [1 / 0.675, 1 / 0.86] },
  planDeTravail: { color: '#141316', roughness: 0.25, metalness: 0.1, env: 0.7 },
  noir: { color: '#121115', roughness: 0.35, metalness: 0.2, env: 0.6 },
  noirMat: { color: '#0c0b0e', roughness: 0.85, metalness: 0 },
  bois: { color: '#8a5a32', roughness: 0.65, metalness: 0 },
  boisClair: { color: '#d2b48a', roughness: 0.7, metalness: 0 },
  rouge: { color: '#b3121b', roughness: 0.35, metalness: 0.2 },
  orange: { color: '#ff5a10', roughness: 0.3, metalness: 0.1 },
  chrome: { color: '#d8dbe0', roughness: 0.12, metalness: 1, env: 1 },
  alu: { color: '#a7abb2', roughness: 0.35, metalness: 0.9, env: 0.8 },
  gomme: { color: '#151416', roughness: 0.85, metalness: 0 },
  cuir: { color: '#2a1810', roughness: 0.45, metalness: 0 },
  creme: { color: '#efe2c8', roughness: 0.9, metalness: 0 },
  caisse: { color: '#b88a55', roughness: 0.8, metalness: 0 },
  optique: { color: '#ffffff', roughness: 0.2, metalness: 0, emissive: '#fff2dc', emissiveIntensity: 3 },
  fronton: { color: '#ffffff', roughness: 0.4, metalness: 0, map: 'popart', repeat: [1 / 0.7, 1 / 0.45], emissive: '#ffffff', emissiveIntensity: 0.9 },
  carrelage: {
    color: '#c4c4c4',
    roughness: 0.3,
    metalness: 0,
    map: 'carrelage',
    roughnessMap: 'carrelageRugosite',
    repeat: [1 / 0.9, 1 / 0.9],
    env: 0.45,
  },
  osb: { color: '#ffffff', roughness: 0.85, metalness: 0, map: 'osb', repeat: [1 / 1.25, 1 / 2.5] },
  lambris: { color: '#5a4a3c', roughness: 0.8, metalness: 0, map: 'lambris', repeat: [1 / 1.6, 1 / 1.6] },
  /** Lambris de pin vertical des murs gauche et avant : lames de 15 cm, nœuds. */
  pin: { color: '#ffffff', roughness: 0.7, metalness: 0, map: 'pin', repeat: [1 / 1.2, 1 / 1.2] },
  /** Solives sombres du plafond. */
  solive: { color: '#2b1c14', roughness: 0.8, metalness: 0 },
  /** Cuir noir brillant des canapés : gros plis, reflets nets des LED. */
  cuirNoir: { color: '#121014', roughness: 0.32, metalness: 0, env: 0.9 },
  /** Laque noire (frigo rétro). */
  laqueNoir: { color: '#0e0d10', roughness: 0.18, metalness: 0, env: 1 },
  /** Anneau vert lumineux de l'enseigne ronde : la seule touche verte de la pièce, sans texte. */
  neonVert: { color: '#0a1a0e', roughness: 0.4, metalness: 0, emissive: '#26ff6a', emissiveIntensity: 2.4 },
  /** Casques : coques laquées. */
  casqueBlanc: { color: '#e8e6e2', roughness: 0.2, metalness: 0, env: 0.8 },
  murRouge: { color: '#b00010', roughness: 0.85, metalness: 0 },
  murBlanc: { color: '#eeeeea', roughness: 0.9, metalness: 0 },
} as const satisfies Record<string, GarageMaterial>;

export type GarageMaterialId = keyof typeof GARAGE_MATERIALS;

export type Shape =
  | { box: Vec3 }
  /** Rayon, hauteur ; axe du cylindre (y par défaut). */
  | { cylinder: readonly [number, number]; axis?: 'x' | 'z' }
  | { sphere: number };

export type Part = Shape & { at: Vec3; material: GarageMaterialId; rot?: Vec3 };

export interface Prop {
  name: `placeholder_${string}`;
  at: Vec3;
  /** Rotation autour de la verticale, en radians. */
  turn?: number;
  /** Petit objet ou décor en hauteur : absent du reflet du sol (un appel de dessin de moins). */
  small?: boolean;
  parts: readonly Part[];
}

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

/** Orientation d'une face : la direction vers laquelle elle regarde. */
export type Facing = '+x' | '-x' | '+z' | '-z' | '+y' | '-y';

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

export interface NeonSign {
  name: string;
  text: string;
  /** Hauteur des lettres, en mètres. */
  height: number;
  at: Vec3;
  facing: Facing;
  color: ColorKey;
  /** Multiplicateur appliqué à la force des tubes de l'ambiance. */
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
}

export interface GarageLayout {
  /** Largeur (x), profondeur (z), hauteur (y). */
  room: { width: number; depth: number; height: number };
  /**
   * Pose du véhicule : rotation de son groupe autour de la verticale (π : l'avant vers la gauche).
   * `cutaway` : volumes qu'il occupe (bas de caisse, habitacle), repère de la pièce. Un objet du
   * mobilier qui les masque à la caméra s'efface : le coin salon du premier plan ne cache jamais
   * la voiture (src/render/floor.ts).
   */
  vehicle: { turn: number; cutaway: ReadonlyArray<{ min: Vec3; max: Vec3 }> };
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

const W = 7.5;
const D = 6;
const H = 2.9;
const BACK = -D / 2;
const RIGHT = W / 2;
const LEFT = -W / 2;
/** Dessous de la retombée du mur du fond. */
const SOFFIT = 2.35;
/** Les spots sont à 15 cm du mur, juste sous la retombée. */
const SPOT_Y = SOFFIT - 0.006;
const SPOT_Z = BACK + 0.15;

const wheel = (x: number, y: number, z: number, r: number, w: number): Part[] => [
  { cylinder: [r, w], axis: 'z', at: [x, y, z], material: 'gomme' },
  { cylinder: [r * 0.62, w + 0.01], axis: 'z', at: [x, y, z], material: 'chrome' },
];

const leg = (x: number, z: number, h: number, material: GarageMaterialId = 'boisClair'): Part => ({
  box: [0.06, h, 0.06],
  at: [x, h / 2, z],
  material,
});

/** Canapé 2 places en cuir noir, dossier inclinable : assise vers +z, dossier vers -z (1,5 × 0,95 × 1,0 m). */
const sofa = (): Part[] => [
  { box: [1.5, 0.4, 0.85], at: [0, 0.2, 0], material: 'cuirNoir' },
  { box: [0.57, 0.14, 0.62], at: [-0.29, 0.47, 0.09], material: 'cuirNoir' },
  { box: [0.57, 0.14, 0.62], at: [0.29, 0.47, 0.09], material: 'cuirNoir' },
  { box: [1.5, 0.6, 0.18], at: [0, 0.7, -0.385], material: 'cuirNoir' },
  // Coussins de dossier bombés, inclinés.
  { box: [0.56, 0.48, 0.22], at: [-0.29, 0.77, -0.22], rot: [-0.2, 0, 0], material: 'cuirNoir' },
  { box: [0.56, 0.48, 0.22], at: [0.29, 0.77, -0.22], rot: [-0.2, 0, 0], material: 'cuirNoir' },
  // Accoudoirs épais.
  { box: [0.17, 0.64, 0.92], at: [-0.665, 0.32, 0.02], material: 'cuirNoir' },
  { box: [0.17, 0.64, 0.92], at: [0.665, 0.32, 0.02], material: 'cuirNoir' },
];

/** Casier ouvert de quatre cases en ligne (le long de z), un casque par case. */
const CASIER_CASES = [-0.525, -0.175, 0.175, 0.525] as const;
const CASIER = { x: LEFT + 0.2, y: 1.9, z: 0.75 } as const;

/** Solives du plafond, le long de z, tous les 0,6 m. */
const JOISTS = Array.from({ length: 12 }, (_, index) => LEFT + 0.45 + index * 0.6);

export const GARAGE: GarageLayout = {
  room: { width: W, depth: D, height: H },
  vehicle: {
    turn: Math.PI,
    // Bas de caisse et habitacle du modèle de banc d'essai (4,6 × 1,9 × 1,3 m), élargis de 0,2 m :
    // le test porte sur le centre de chaque objet, pas sur ses bords. Le bas de caisse descend
    // sous le sol : ce qui masquerait le reflet de la voiture s'efface aussi.
    cutaway: [
      { min: [-2.6, -0.6, -1.2], max: [2.6, 0.8, 1.2] },
      { min: [-1.5, 0.7, -1.0], max: [1.35, 1.45, 1.0] },
    ],
  },
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
    // Bandeau rouge sous la retombée du mur droit.
    { from: [RIGHT - 0.36, SOFFIT - 0.015, BACK + 0.5], to: [RIGHT - 0.36, SOFFIT - 0.015, D / 2 - 0.1], color: 'right', facing: '-x' },
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
    { name: 'placeholder_credence', texture: 'credence', size: [2.95, 0.55], at: [-0.025, 1.175, BACK + 0.003], facing: '+z' },
    { name: 'placeholder_ecran', texture: 'ecran', size: [1.45, 0.82], at: [2.25, 1.5, BACK + 0.405], facing: '+z', glow: 2.6 },
    { name: 'placeholder_toile_pop_art', texture: 'popart', size: [1.2, 0.9], at: [2.25, 2.45, BACK + 0.405], facing: '+z', small: true },
    { name: 'placeholder_cible', texture: 'cible', size: [0.46, 0.46], at: [RIGHT - 0.045, 1.8, 0.4], facing: '-x', small: true },
  ],
  signs: [
    { name: 'neon_pimpmybichon', text: 'PimpMyBichon', height: 0.3, at: [LEFT + 0.02, 2.05, -1.55], facing: '+x', color: 'center', gain: 0.45 },
    // Au-dessus du canapé : vu de dos depuis la caméra de départ, il se lit dans les flancs.
    { name: 'neon_good_vibes', text: 'GOOD VIBES ONLY', height: 0.24, at: [0, 1.75, D / 2 - 0.02], facing: '-z', color: 'right', gain: 0.45 },
  ],
  props: [
    {
      name: 'placeholder_meubles_atelier',
      at: [0.05, 0, BACK],
      parts: [
        { box: [2.7, 0.86, 0.6], at: [0, 0.43, 0.3], material: 'tiroirs' },
        { box: [2.74, 0.04, 0.63], at: [0, 0.88, 0.315], material: 'planDeTravail' },
        // Poignées barres inox.
        ...[-0.95, 0, 0.95].flatMap((x) =>
          [0.74, 0.48, 0.22].map((y): Part => ({ box: [0.4, 0.018, 0.025], at: [x, y, 0.61], material: 'chrome' })),
        ),
        // Outils posés : cadre, rouleau d'essuie-tout, caisse à outils.
        { box: [0.3, 0.38, 0.03], at: [-0.7, 1.09, 0.06], rot: [-0.12, 0, 0], material: 'noir' },
        { cylinder: [0.06, 0.24], at: [0.55, 1.02, 0.15], material: 'blanc' },
        { box: [0.45, 0.16, 0.24], at: [-0.25, 0.98, 0.25], material: 'rouge' },
      ],
    },
    {
      // Au bout droit des meubles blancs, juste avant la colonne : évier, robinet, flacons.
      name: 'placeholder_evier',
      at: [1.1, 0, BACK],
      small: true,
      parts: [
        { box: [0.5, 0.03, 0.4], at: [0, 0.905, 0.3], material: 'chrome' },
        { cylinder: [0.016, 0.3], at: [0, 1.05, 0.09], material: 'chrome' },
        { box: [0.024, 0.024, 0.2], at: [0, 1.19, 0.18], material: 'chrome' },
        { cylinder: [0.035, 0.2], at: [0.18, 1.0, 0.08], material: 'blanc' },
        { cylinder: [0.03, 0.16], at: [0.26, 0.98, 0.1], material: 'rouge' },
      ],
    },
    {
      // Moto en pièces sur le plan de travail, à gauche : jante alu, cadre et moteur.
      name: 'placeholder_moto_en_pieces',
      at: [-0.85, 0.9, BACK + 0.3],
      small: true,
      parts: [
        { cylinder: [0.28, 0.07], axis: 'z', at: [-0.25, 0.28, -0.05], material: 'alu' },
        { cylinder: [0.18, 0.075], axis: 'z', at: [-0.25, 0.28, -0.05], material: 'noir' },
        { box: [0.55, 0.06, 0.08], at: [0.2, 0.3, 0.05], rot: [0, 0, 0.35], material: 'alu' },
        { box: [0.3, 0.22, 0.2], at: [0.25, 0.11, 0.05], material: 'noir' },
      ],
    },
    {
      name: 'placeholder_servante',
      at: [-1.78, 0, BACK + 0.25],
      parts: [
        { box: [0.6, 1.0, 0.46], at: [0, 0.54, 0], material: 'noir' },
        ...wheel(-0.24, 0.04, 0.18, 0.04, 0.03),
        ...wheel(0.24, 0.04, 0.18, 0.04, 0.03),
      ],
    },
    {
      // Angle fond-gauche : établi en bois clair (h 0,9 m), son retour sur consoles le long du mur
      // gauche (le quad passe dessous), panneau d'OSB et outils au-dessus.
      name: 'placeholder_etabli',
      at: [LEFT, 0, BACK],
      parts: [
        { box: [1.4, 0.82, 0.48], at: [0.72, 0.41, 0.26], material: 'bois' },
        { box: [1.45, 0.05, 0.52], at: [0.725, 0.875, 0.26], material: 'boisClair' },
        { box: [0.3, 0.05, 0.75], at: [0.15, 0.875, 0.88], material: 'boisClair' },
        { box: [0.24, 0.04, 0.04], at: [0.12, 0.83, 0.7], material: 'noir' },
        { box: [0.24, 0.04, 0.04], at: [0.12, 0.83, 1.15], material: 'noir' },
        { box: [1.45, 1.25, 0.02], at: [0.725, 1.6, 0.01], material: 'osb' },
        // Panneau d'outils.
        { box: [0.6, 0.45, 0.025], at: [0.55, 1.55, 0.03], material: 'noir' },
        { box: [0.04, 0.3, 0.03], at: [1.05, 1.5, 0.04], material: 'rouge' },
      ],
    },
    {
      name: 'placeholder_enceintes',
      at: [0, 0, BACK + 0.12],
      small: true,
      parts: [
        // Trois enceintes empilées à gauche de la colonne, deux autres en haut à droite.
        { box: [0.26, 0.2, 0.22], at: [1.33, 1.79, 0], material: 'noir' },
        { box: [0.26, 0.2, 0.22], at: [1.33, 2.005, 0], material: 'noir' },
        { box: [0.26, 0.2, 0.22], at: [1.33, 2.22, 0], material: 'noir' },
        { box: [0.22, 0.34, 0.2], at: [3.25, 2.5, 0.05], material: 'noir' },
        { box: [0.22, 0.34, 0.2], at: [3.25, 2.1, 0.05], material: 'noir' },
      ],
    },
    {
      name: 'placeholder_applique',
      at: [0.9, 1.9, BACK + 0.04],
      small: true,
      parts: [
        { box: [0.03, 0.03, 0.34], at: [0, 0, 0.17], rot: [0.5, 0, 0], material: 'noir' },
        { cylinder: [0.06, 0.13], at: [0, -0.18, 0.32], material: 'noir' },
      ],
    },
    {
      name: 'placeholder_colonne_ecran',
      at: [2.25, 0, BACK + 0.2],
      parts: [{ box: [1.5, H, 0.4], at: [0, H / 2, 0], material: 'noirMat' }],
    },
    {
      // Sportive carénée noire devant la colonne, parallèle au mur, nez à droite : la place
      // accueille la moto du moment ; une noire laisse briller la voiture.
      name: 'placeholder_moto_sportive',
      at: [2.05, 0, -2.15],
      parts: [
        ...wheel(-0.68, 0.3, 0, 0.3, 0.12),
        ...wheel(0.7, 0.3, 0, 0.3, 0.11),
        { box: [0.8, 0.3, 0.3], at: [0.12, 0.72, 0], material: 'laqueNoir' },
        { box: [0.42, 0.34, 0.28], at: [0.55, 0.9, 0], rot: [0, 0, -0.45], material: 'laqueNoir' },
        { box: [0.5, 0.08, 0.2], at: [-0.42, 0.92, 0], rot: [0, 0, 0.12], material: 'noir' },
        { box: [0.3, 0.12, 0.16], at: [-0.75, 0.96, 0], rot: [0, 0, 0.25], material: 'laqueNoir' },
        { box: [0.36, 0.3, 0.24], at: [0.05, 0.45, 0], material: 'alu' },
        { box: [0.95, 0.06, 0.08], at: [-0.12, 0.6, 0], rot: [0, 0, 0.1], material: 'alu' },
        { cylinder: [0.026, 0.62], at: [0.62, 0.6, 0], rot: [0, 0, -0.42], material: 'chrome' },
        { cylinder: [0.05, 0.4], axis: 'x', at: [-0.4, 0.4, 0.14], material: 'chrome' },
      ],
    },
    {
      name: 'placeholder_flipper',
      at: [3.2, 0, -2.35],
      turn: -Math.PI / 4,
      parts: [
        { box: [0.7, 0.3, 1.25], at: [0, 0.9, 0.05], rot: [-0.06, 0, 0], material: 'bois' },
        { box: [0.72, 0.1, 0.2], at: [0, 1.05, -0.58], material: 'bois' },
        { box: [0.72, 0.62, 0.18], at: [0, 1.4, -0.58], material: 'fronton' },
        leg(-0.3, 0.58, 0.76, 'chrome'),
        leg(0.3, 0.58, 0.76, 'chrome'),
        leg(-0.3, -0.48, 0.76, 'chrome'),
        leg(0.3, -0.48, 0.76, 'chrome'),
      ],
    },
    {
      name: 'placeholder_peluche',
      at: [3.2, 1.05, -2.25],
      small: true,
      parts: [
        { sphere: 0.13, at: [0, 0.12, 0], material: 'creme' },
        { sphere: 0.1, at: [0, 0.31, 0.02], material: 'creme' },
      ],
    },
    {
      name: 'placeholder_panneau_cible',
      at: [RIGHT - 0.03, 1.8, 0.4],
      small: true,
      parts: [
        // Panneau de bois à bords étagés.
        { box: [0.03, 0.8, 1.2], at: [0, 0, 0], material: 'boisClair' },
        { box: [0.03, 1.0, 0.8], at: [0, 0, 0], material: 'boisClair' },
      ],
    },
    {
      name: 'placeholder_caisses',
      at: [3.4, 0, -1.3],
      parts: [
        { box: [0.5, 0.5, 0.45], at: [0, 0.25, -0.25], material: 'caisse' },
        { box: [0.5, 0.5, 0.45], at: [0.02, 0.75, -0.25], rot: [0, 0.1, 0], material: 'caisse' },
        { box: [0.5, 0.5, 0.45], at: [0, 0.25, 0.25], rot: [0, -0.08, 0], material: 'caisse' },
        { box: [0.5, 0.5, 0.45], at: [0, 0.75, 0.25], material: 'caisse' },
      ],
    },
    {
      // Quad noir garé devant l'angle fond-gauche, presque parallèle au mur du fond.
      name: 'placeholder_quad',
      at: [-2.85, 0, -1.85],
      turn: -0.15,
      parts: [
        ...wheel(-0.5, 0.27, 0.42, 0.27, 0.24),
        ...wheel(-0.5, 0.27, -0.42, 0.27, 0.24),
        ...wheel(0.5, 0.27, 0.42, 0.27, 0.24),
        ...wheel(0.5, 0.27, -0.42, 0.27, 0.24),
        { box: [1.3, 0.32, 0.72], at: [0, 0.62, 0], material: 'noir' },
        { box: [0.6, 0.12, 0.34], at: [-0.18, 0.85, 0], material: 'noir' },
        { cylinder: [0.02, 0.72], axis: 'z', at: [0.38, 1.0, 0], material: 'chrome' },
        { cylinder: [0.04, 0.3], at: [-0.3, 0.45, 0.3], material: 'rouge' },
        { cylinder: [0.04, 0.3], at: [-0.3, 0.45, -0.3], material: 'rouge' },
        { cylinder: [0.07, 0.04], axis: 'x', at: [0.66, 0.66, 0], material: 'optique' },
      ],
    },
    // Coin salon, angle avant-gauche : deux canapés en L (A contre le mur avant, face au fond ;
    // B contre le mur gauche), table au bloc moteur dans l'angle du L, tabouret et pouf à côté.
    // Au premier plan de la vue de départ : la découpe (vehicle.cutaway) efface ceux qui
    // masqueraient la voiture, le temps que la caméra est de ce côté.
    { name: 'placeholder_canape_a', at: [-2.3, 0, D / 2 - 0.475], turn: Math.PI, parts: sofa() },
    { name: 'placeholder_canape_b', at: [LEFT + 0.475, 0, 0.8], turn: Math.PI / 2, parts: sofa() },
    {
      // Plateau de sapin de 6 cm qui déborde d'un socle noir fermé.
      name: 'placeholder_table_basse',
      at: [-2.22, 0, 1.55],
      parts: [
        { box: [0.46, 0.42, 0.86], at: [0, 0.21, 0], material: 'noirMat' },
        { box: [0.58, 0.06, 0.98], at: [0, 0.45, 0], material: 'boisClair' },
      ],
    },
    {
      name: 'placeholder_bloc_moteur',
      at: [-2.22, 0.48, 1.55],
      turn: Math.PI / 2,
      small: true,
      parts: [
        { box: [0.6, 0.22, 0.4], at: [0, 0.11, 0], material: 'alu' },
        { box: [0.56, 0.1, 0.3], at: [0, 0.27, 0], material: 'alu' },
        ...[-0.21, -0.07, 0.07, 0.21].map((x): Part => ({ cylinder: [0.045, 0.16], axis: 'x', at: [x, 0.24, 0.26], material: 'rouge' })),
      ],
    },
    {
      // Assise en bois clair, pied en grand disque noir ajouré.
      name: 'placeholder_tabouret_frein',
      at: [-1.45, 0, 1.75],
      small: true,
      parts: [
        { cylinder: [0.2, 0.03], at: [0, 0.02, 0], material: 'noir' },
        { cylinder: [0.04, 0.45], at: [0, 0.25, 0], material: 'noir' },
        { cylinder: [0.17, 0.05], at: [0, 0.5, 0], material: 'boisClair' },
      ],
    },
    {
      name: 'placeholder_pouf_pneu',
      at: [-1.0, 0, 2.45],
      parts: [
        { cylinder: [0.33, 0.24], at: [0, 0.12, 0], material: 'gomme' },
        { cylinder: [0.3, 0.245], at: [0, 0.12, 0], material: 'noirMat' },
      ],
    },
    {
      // Coin avant-gauche : petit frigo noir rétro sur un socle de palette, poignée chromée.
      name: 'placeholder_frigo',
      at: [LEFT + 0.33, 0, 2.62],
      parts: [
        { box: [0.6, 0.35, 0.62], at: [0, 0.175, 0], material: 'caisse' },
        { box: [0.55, 0.85, 0.55], at: [0, 0.775, 0], material: 'laqueNoir' },
        { box: [0.03, 0.32, 0.04], at: [0.29, 0.92, 0.17], material: 'chrome' },
      ],
    },
    {
      // Derrière le frigo : enseigne ronde à anneau vert lumineux, sans aucun texte.
      name: 'placeholder_enseigne_ronde',
      at: [LEFT + 0.02, 1.65, 2.62],
      small: true,
      parts: [
        { cylinder: [0.23, 0.02], axis: 'x', at: [0, 0, 0], material: 'neonVert' },
        { cylinder: [0.18, 0.03], axis: 'x', at: [0.004, 0, 0], material: 'noir' },
      ],
    },
    {
      name: 'placeholder_fut',
      at: [LEFT + 0.33, 0, 1.95],
      parts: [{ cylinder: [0.29, 0.88], at: [0, 0.44, 0], material: 'rouge' }],
    },
    {
      // Au bout du canapé B, côté fond : caisse-colonne en bois de palette.
      name: 'placeholder_caisse_colonne',
      at: [LEFT + 0.3, 0, -0.32],
      parts: [{ box: [0.5, 0.8, 0.5], at: [0, 0.4, 0], material: 'caisse' }],
    },
    {
      // Casier noir ouvert de quatre cases en ligne au-dessus du canapé B (dessous à 1,9 m),
      // un casque par case, un autre posé dessus.
      name: 'placeholder_casiers_casques',
      at: [CASIER.x, CASIER.y, CASIER.z],
      small: true,
      parts: [
        { box: [0.4, 0.03, 1.4], at: [0, 0.015, 0], material: 'noir' },
        { box: [0.4, 0.03, 1.4], at: [0, 0.385, 0], material: 'noir' },
        { box: [0.03, 0.4, 1.4], at: [-0.185, 0.2, 0], material: 'noir' },
        ...[-0.7, -0.35, 0, 0.35, 0.7].map((z): Part => ({ box: [0.4, 0.4, 0.025], at: [0, 0.2, z], material: 'noir' })),
        { sphere: 0.13, at: [0.02, 0.16, CASIER_CASES[0]], material: 'noir' },
        { sphere: 0.13, at: [0.02, 0.16, CASIER_CASES[1]], material: 'rouge' },
        { sphere: 0.13, at: [0.02, 0.16, CASIER_CASES[2]], material: 'casqueBlanc' },
        { sphere: 0.13, at: [0.02, 0.16, CASIER_CASES[3]], material: 'noir' },
        { sphere: 0.13, at: [0, 0.53, 0.3], material: 'casqueBlanc' },
      ],
    },
    {
      // Petite sportive rouge d'environ 1 m accrochée juste sous le casier (1,3 à 1,8 m).
      name: 'placeholder_moto_murale',
      at: [LEFT + 0.16, 0, CASIER.z],
      turn: Math.PI / 2,
      small: true,
      parts: [
        ...wheel(-0.36, 1.5, 0, 0.19, 0.06),
        ...wheel(0.38, 1.5, 0, 0.19, 0.06),
        { box: [0.5, 0.17, 0.12], at: [0.02, 1.63, 0], material: 'rouge' },
        { box: [0.2, 0.2, 0.12], at: [0.3, 1.7, 0], rot: [0, 0, -0.4], material: 'rouge' },
        { box: [0.28, 0.05, 0.1], at: [-0.17, 1.74, 0], material: 'noir' },
      ],
    },
    {
      // Plafond : lames de pin (texture) entre solives sombres.
      name: 'placeholder_solives',
      at: [0, 0, 0],
      small: true,
      parts: JOISTS.map((x): Part => ({ box: [0.08, 0.14, D], at: [x, H - 0.07, 0], material: 'solive' })),
    },
  ],
};
