// Socle commun du garage (§ 4) : cotes de la pièce, matériaux et types du mobilier. Les fichiers
// de famille (src/data/garageProps/) l'importent sans passer par garage.ts, qui les assemble :
// aucun import circulaire. garage.ts réexporte tout ce qui est ici.
// Repère : x vers la droite vue du canapé, z vers le canapé, y vers le haut, en mètres, origine
// au centre du sol. Pièce de 7,5 × 6 m, plafond à 2,9 m, retombée à 2,35 m.

import type { GarageArtId } from './garageArt.ts';
import type { GarageShape, Vec3 } from './garageShapes.ts';

export type { Vec3 } from './garageShapes.ts';

/** Largeur de la pièce (x). */
export const W = 7.5;
/** Profondeur de la pièce (z). */
export const D = 6;
/** Hauteur sous plafond (y). */
export const H = 2.9;
/** Mur du fond (z). */
export const BACK = -D / 2;
/** Mur avant, celui du canapé A (z). */
export const FRONT = D / 2;
/** Mur gauche, lambris (x). */
export const LEFT = -W / 2;
/** Mur droit, rouge (x). */
export const RIGHT = W / 2;
/** Dessous des retombées du plafond (y). */
export const SOFFIT = 2.35;

/**
 * Casier à casques au-dessus du canapé B : origine (milieu du dessous, côté mur) et centres de
 * ses quatre cases le long de z. Partagé par le casier (atelier), les casques (loisirs) et les
 * points LED de ses cases (garage.ts).
 */
export const CASIER = { x: LEFT + 0.2, y: 1.9, z: 0.75 } as const;
export const CASIER_CASES = [-0.525, -0.175, 0.175, 0.525] as const;

/** Orientation d'une face : la direction vers laquelle elle regarde. */
export type Facing = '+x' | '-x' | '+z' | '-z' | '+y' | '-y';

/** Textures dessinées au canvas (src/scene/garage/textures.ts). */
export type GarageTextureId =
  | 'carrelage'
  | 'carrelageRugosite'
  | 'osb'
  | 'lambris'
  | 'pin'
  | 'tiroirs'
  | 'credence'
  | 'credenceRugosite'
  | 'ecran'
  | 'veines'
  | 'cuir'
  | 'crampons'
  | 'nidAbeille'
  | 'contact';

export interface GarageMaterial {
  color: string;
  roughness: number;
  metalness: number;
  map?: GarageTextureId;
  /**
   * Répétitions de la texture par mètre (u, v), partagées par la carte de rugosité. Les formes ont
   * des coordonnées de texture en mètres : 1 / 0,8, le dessin couvre 0,8 m.
   */
  repeat?: readonly [number, number];
  /**
   * Carte de rugosité (canal vert), multipliée par `roughness` : avec `roughness: 1`, la carte
   * donne la rugosité elle-même.
   */
  roughnessMap?: GarageTextureId;
  /** Couleur émissive fixe (optiques du quad, fronton du flipper). */
  emissive?: string;
  emissiveIntensity?: number;
  /**
   * Part du reflet de la sonde (environnement). Bas pour les surfaces mates : la sonde voit la
   * pièce éclairée, elle ne doit pas l'éclairer une seconde fois. Défaut : 0,2.
   */
  env?: number;
  /**
   * Surface sombre et mate plaquée contre un mur : elle masque les nappes et les halos additifs qui
   * lavent ce mur. Ces nappes simulent la lumière que renvoie un mur clair ; une surface noire mate
   * n'en renvoie presque pas. Sa face avant doit dépasser du mur de plus de 9 mm (le halo le plus
   * avancé).
   */
  overHalos?: boolean;
}

export const GARAGE_MATERIALS = {
  blanc: { color: '#e9e7e2', roughness: 0.55, metalness: 0 },
  tiroirs: { color: '#f2f0ec', roughness: 0.4, metalness: 0, map: 'tiroirs', repeat: [1 / 0.675, 1 / 0.86] },
  planDeTravail: { color: '#141316', roughness: 0.25, metalness: 0.1, env: 0.7 },
  noir: { color: '#121115', roughness: 0.35, metalness: 0.2, env: 0.6 },
  noirMat: { color: '#0c0b0e', roughness: 0.85, metalness: 0 },
  bois: { color: '#8a5a32', roughness: 0.65, metalness: 0, map: 'veines', repeat: [1 / 0.8, 1 / 0.8] },
  boisClair: { color: '#d2b48a', roughness: 0.7, metalness: 0, map: 'veines', repeat: [1 / 0.6, 1 / 0.6] },
  rouge: { color: '#b3121b', roughness: 0.35, metalness: 0.2, env: 0.5 },
  orange: { color: '#ff5a10', roughness: 0.3, metalness: 0.1 },
  chrome: { color: '#d8dbe0', roughness: 0.12, metalness: 1, env: 1 },
  alu: { color: '#a7abb2', roughness: 0.35, metalness: 0.9, env: 0.8 },
  /** Pneus : crampons en quinconce. */
  gomme: { color: '#151416', roughness: 0.85, metalness: 0, map: 'crampons', repeat: [1 / 0.15, 1 / 0.15] },
  cuir: { color: '#2a1810', roughness: 0.45, metalness: 0 },
  creme: { color: '#efe2c8', roughness: 0.9, metalness: 0 },
  caisse: { color: '#b88a55', roughness: 0.8, metalness: 0, map: 'veines', repeat: [1 / 0.5, 1 / 0.5] },
  optique: { color: '#ffffff', roughness: 0.2, metalness: 0, emissive: '#fff2dc', emissiveIntensity: 3 },
  /** Glace du fronton du flipper : verre sombre, le dessin émissif (garageArt) est posé devant. */
  fronton: { color: '#120c12', roughness: 0.12, metalness: 0, env: 0.9 },
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
  solive: { color: '#2b1c14', roughness: 0.8, metalness: 0, map: 'veines', repeat: [1 / 1.2, 1 / 0.3] },
  /** Cuir noir brillant des canapés : gros plis, reflets nets des LED. */
  cuirNoir: { color: '#121014', roughness: 0.9, metalness: 0, env: 0.9, roughnessMap: 'cuir', repeat: [1 / 0.4, 1 / 0.4] },
  /** Laque noire (frigo rétro). */
  laqueNoir: { color: '#0e0d10', roughness: 0.18, metalness: 0, env: 1 },
  /** Anneau vert lumineux de l'enseigne ronde : la seule touche verte de la pièce, sans texte. */
  neonVert: { color: '#0a1a0e', roughness: 0.4, metalness: 0, emissive: '#26ff6a', emissiveIntensity: 2.4 },
  /** Casques : coques laquées. */
  casqueBlanc: { color: '#e8e6e2', roughness: 0.2, metalness: 0, env: 0.8 },
  murRouge: { color: '#b00010', roughness: 0.85, metalness: 0 },
  murBlanc: { color: '#eeeeea', roughness: 0.9, metalness: 0 },
  // Matériaux nouveaux du cahier de remodelage (§ 3.3).
  /** Capiton du pouf pneu : alvéoles hexagonales (dessin de 0,12 × 0,104 m, rapport √3 / 2). */
  capiton: { color: '#1a181c', roughness: 0.75, metalness: 0, env: 0.2, map: 'nidAbeille', repeat: [1 / 0.12, 1 / 0.104] },
  /** Casque sarcelle pailleté. */
  sarcelle: { color: '#0a3a46', roughness: 0.22, metalness: 0.3, env: 0.9 },
  /** Crédence : petits carreaux noirs mats (0,85) aux joints plus mats (0,95), le dessin entier sur 2,95 × 0,55 m. */
  credence: {
    color: '#ffffff',
    roughness: 1,
    metalness: 0,
    map: 'credence',
    roughnessMap: 'credenceRugosite',
    repeat: [1 / 2.95, 1 / 0.55],
    env: 0.15,
    overHalos: true,
  },
  /** Plante grasse (ajouts facultatifs). */
  vertCactus: { color: '#3f6b38', roughness: 0.8, metalness: 0, env: 0.2 },
  /** Pot de terre cuite (ajouts facultatifs). */
  terreCuite: { color: '#a85a36', roughness: 0.85, metalness: 0, env: 0.2 },
} as const satisfies Record<string, GarageMaterial>;

export type GarageMaterialId = keyof typeof GARAGE_MATERIALS;

/**
 * Pièce d'un objet : une forme du vocabulaire (src/data/garageShapes.ts, constructeur et repères
 * dans src/scene/garage/shapes.ts), centrée en `at` dans le repère de l'objet, tournée de `rot`
 * (radians, ordre XYZ) autour de son centre.
 */
export type Part = GarageShape & { at: Vec3; material: GarageMaterialId; rot?: Vec3 };

/**
 * Œuvre de src/data/garageArt.ts posée sur un objet, dans son repère local (avant `turn`). Le plan
 * est centré en `at`, regarde vers +z avant `rot` (radians, ordre XYZ), large de `width` mètres ;
 * sa hauteur suit le rapport de l'œuvre, ou de sa case `region`. `at` se prend à 1 mm devant la
 * face qui le porte ; build.ts avance encore le plan de 1 mm (2 mm en tout : pas de moiré de
 * profondeur). Le plan s'efface avec son objet (coupe caméra) et suit sa règle de reflet.
 */
export interface ArtSlot {
  art: GarageArtId;
  region?: string;
  at: Vec3;
  rot?: Vec3;
  width: number;
}

export interface Prop {
  name: `placeholder_${string}`;
  at: Vec3;
  /** Rotation autour de la verticale, en radians. */
  turn?: number;
  /** Petit objet ou décor en hauteur : absent du reflet du sol (un appel de dessin de moins). */
  small?: boolean;
  /**
   * Coupe caméra (src/scene/garage/cut.ts) : objets qui le portent, quand la déduction par les
   * boîtes (posé dessus, pendu dessous, adossé) ne suffit pas. Il disparaît avec eux.
   */
  on?: readonly string[];
  parts: readonly Part[];
  /**
   * Appui sur un meuble, écrit ici et non déduit : l'objet qui le porte (`on`) et la hauteur du
   * dessus sur lequel il repose (`top`, en mètres : plan de travail sous le rebord d'un évier
   * encastré, plateau d'une table, dessus en pente d'une caisse à l'aplomb de l'objet). build.ts y
   * pose la tache de contact (bornée au dessus du porteur) et part de là pour l'assombrissement de
   * pied ; tests/unit/scene-decor.test.ts vérifie que l'objet repose bien sur ce porteur à cette
   * hauteur (à 3 mm près). `top` se prend à l'aplomb de l'origine de l'objet (`at`) ; `slope` :
   * pente du dessus en radians, qui monte vers −z (plateau d'un flipper), la tache la suit.
   * Absent : posé au sol (bas à moins de 3 cm) ou accroché.
   */
  rest?: { on: `placeholder_${string}`; top: number; slope?: number };
  /** Œuvres posées sur l'objet (un plan et un appel de dessin chacune). */
  art?: readonly ArtSlot[];
  /**
   * `false` : pas d'ombre de contact (cahier § 3.1). Sinon build.ts la déduit de la boîte de
   * l'objet : tache au sol, sur le meuble qui le porte ou sur le mur qui l'accroche.
   */
  contact?: false;
}
