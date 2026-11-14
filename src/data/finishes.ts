// Finitions de peinture (§ 5.2 et § 8) : les réglages d'une seule peinture multicouche
// (src/render/paint.ts). Base colorée avec paillettes, vernis avec peau d'orange et Fresnel,
// et trois effets d'angle : vernis teinté (candy), irisation (nacré), deux teintes (caméléon).
// Or, cuivre, chrome noir, brossé, carbone, rat look et métal poncé arrivent avec leurs textures.

export interface Finish {
  id: string;
  label: string;
  /** Une ligne d'atelier sous le nom, dans la rangée de choix. */
  hint: string;
  metalness: number;
  roughness: number;
  /** Vernis : 0 sans vernis, 1 vernis plein. */
  clearcoat: number;
  clearcoatRoughness: number;
  /** Reflet irisé selon l'angle (nacré, caméléon) ; 0 : aucun. */
  iridescence: number;
  iridescenceIOR: number;
  /** Épaisseur de la couche irisée, en nanomètres : elle décide des couleurs du reflet. */
  iridescenceThickness: number;
  /**
   * Part de la teinte choisie dans la couleur de base. 1 : toute la teinte ;
   * vers 0 : le métal nu (un chrome reste un miroir, un candy pose sa teinte sur un fond alu).
   */
  tint: number;
  /** Force des reflets de l'environnement. */
  envMapIntensity: number;
  /** Paillettes : force de la perturbation des normales (0 : aucune). */
  flake: number;
  /** Taille d'une paillette, en millimètres. */
  flakeSize: number;
  /** Peau d'orange du vernis (0 : vernis tendu comme un miroir). */
  orangePeel: number;
  /** Renfort du reflet rasant sur le vernis (Fresnel marqué). */
  fresnel: number;
  /** Vernis teinté : la teinte choisie filtre la base, plus profonde sur les bords. */
  candy: number;
  /** Caméléon : part de la seconde teinte, qui prend les bords. */
  flip: number;
  /** Seconde teinte du caméléon : décalage de la teinte choisie sur la roue, en degrés. */
  flipHue: number;
}

// Valeurs communes : une laque sans effet d'angle ni paillette.
const BASE = {
  metalness: 0,
  roughness: 0.32,
  clearcoat: 1,
  clearcoatRoughness: 0.03,
  iridescence: 0,
  iridescenceIOR: 1.3,
  iridescenceThickness: 400,
  tint: 1,
  envMapIntensity: 1.2,
  flake: 0,
  flakeSize: 0.5,
  orangePeel: 0.5,
  fresnel: 0.6,
  candy: 0,
  flip: 0,
  flipHue: 0,
} as const;

export const FINISHES = [
  { ...BASE, id: 'brillant', label: 'Brillant', hint: 'Laque sous vernis' },
  {
    ...BASE,
    id: 'satine',
    label: 'Satiné',
    hint: 'Un reflet doux, sans miroir',
    roughness: 0.48,
    clearcoat: 0.55,
    clearcoatRoughness: 0.34,
    envMapIntensity: 1,
    orangePeel: 0.15,
    fresnel: 0.2,
  },
  {
    ...BASE,
    id: 'mat',
    label: 'Mat',
    hint: 'Sans un reflet',
    roughness: 0.82,
    clearcoat: 0,
    clearcoatRoughness: 0.5,
    envMapIntensity: 0.7,
    orangePeel: 0,
    fresnel: 0,
  },
  {
    ...BASE,
    id: 'metallise',
    label: 'Métallisé',
    hint: 'Grain d’alu sous vernis',
    metalness: 0.75,
    roughness: 0.36,
    clearcoatRoughness: 0.04,
    envMapIntensity: 1.3,
    flake: 0.55,
    flakeSize: 0.35,
  },
  {
    ...BASE,
    id: 'paillete',
    label: 'Pailleté',
    hint: 'Grosses paillettes, ça scintille',
    metalness: 0.9,
    roughness: 0.4,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.5,
    flake: 1,
    flakeSize: 3,
    orangePeel: 0.4,
    fresnel: 0.7,
  },
  {
    ...BASE,
    id: 'candy',
    label: 'Candy',
    hint: 'Vernis teinté sur fond alu',
    metalness: 0.92,
    roughness: 0.24,
    clearcoatRoughness: 0.02,
    tint: 0.1,
    envMapIntensity: 1.5,
    flake: 0.45,
    flakeSize: 0.6,
    fresnel: 0.8,
    candy: 1,
  },
  {
    ...BASE,
    id: 'nacre',
    label: 'Nacré',
    hint: 'Reflets irisés selon l’angle',
    metalness: 0.2,
    roughness: 0.34,
    iridescence: 1,
    iridescenceIOR: 1.5,
    iridescenceThickness: 520,
    tint: 0.85,
    envMapIntensity: 1.3,
    flake: 0.3,
    flakeSize: 0.3,
  },
  {
    ...BASE,
    id: 'cameleon',
    label: 'Caméléon',
    hint: 'Change de teinte en tournant',
    metalness: 0.7,
    roughness: 0.3,
    iridescence: 0.5,
    iridescenceIOR: 1.6,
    iridescenceThickness: 380,
    envMapIntensity: 1.4,
    flake: 0.35,
    flakeSize: 0.4,
    fresnel: 0.7,
    flip: 1,
    flipHue: 150,
  },
  {
    ...BASE,
    id: 'chrome',
    label: 'Chrome',
    hint: 'Miroir, à peine teinté',
    metalness: 1,
    roughness: 0.05,
    clearcoat: 0,
    clearcoatRoughness: 0,
    tint: 0.15,
    envMapIntensity: 1.6,
    orangePeel: 0,
    fresnel: 0,
  },
  {
    ...BASE,
    id: 'chrome-colore',
    label: 'Chrome coloré',
    hint: 'Miroir teinté, toutes teintes',
    metalness: 1,
    roughness: 0.06,
    clearcoat: 0,
    clearcoatRoughness: 0,
    tint: 1,
    envMapIntensity: 1.7,
    orangePeel: 0,
    fresnel: 0,
  },
] as const satisfies readonly Finish[];

export type FinishId = (typeof FINISHES)[number]['id'];

export const DEFAULT_FINISH: FinishId = 'metallise';

export function finish(id: FinishId): Finish {
  return FINISHES.find((item) => item.id === id) ?? FINISHES[0];
}
