// Finitions de peinture (§ 5.2), décrites par les réglages d'un MeshPhysicalMaterial.
// Première série du jalon 1 : la peinture multicouche (paillettes, peau d'orange, Fresnel)
// remplacera l'intérieur de src/render/paint.ts sans changer ces listes de place.

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
  /** Reflet irisé selon l'angle (candy, nacré) ; 0 : aucun. */
  iridescence: number;
  iridescenceIOR: number;
  /**
   * Part de la teinte choisie dans la couleur de base. 1 : toute la teinte ;
   * vers 0 : le métal nu (un chrome reste un miroir, à peine teinté).
   */
  tint: number;
  /** Force des reflets de l'environnement. */
  envMapIntensity: number;
}

export const FINISHES = [
  {
    id: 'brillant',
    label: 'Brillant',
    hint: 'Laque sous vernis',
    metalness: 0,
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    iridescence: 0,
    iridescenceIOR: 1.3,
    tint: 1,
    envMapIntensity: 1.2,
  },
  {
    id: 'mat',
    label: 'Mat',
    hint: 'Sans un reflet',
    metalness: 0,
    roughness: 0.82,
    clearcoat: 0,
    clearcoatRoughness: 0.5,
    iridescence: 0,
    iridescenceIOR: 1.3,
    tint: 1,
    envMapIntensity: 0.7,
  },
  {
    id: 'metallise',
    label: 'Métallisé',
    hint: 'Grain d’alu sous vernis',
    metalness: 0.75,
    roughness: 0.38,
    clearcoat: 1,
    clearcoatRoughness: 0.04,
    iridescence: 0,
    iridescenceIOR: 1.3,
    tint: 1,
    envMapIntensity: 1.3,
  },
  {
    id: 'paillete',
    label: 'Pailleté',
    hint: 'Ça scintille au soleil',
    metalness: 0.9,
    roughness: 0.5,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence: 0.15,
    iridescenceIOR: 1.6,
    tint: 1,
    envMapIntensity: 1.5,
  },
  {
    id: 'candy',
    label: 'Candy',
    hint: 'Profond comme un bonbon',
    metalness: 0.85,
    roughness: 0.16,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence: 0.4,
    iridescenceIOR: 1.45,
    tint: 1,
    envMapIntensity: 1.5,
  },
  {
    id: 'chrome',
    label: 'Chrome',
    hint: 'Miroir, à peine teinté',
    metalness: 1,
    roughness: 0.05,
    clearcoat: 0,
    clearcoatRoughness: 0,
    iridescence: 0,
    iridescenceIOR: 1.3,
    tint: 0.15,
    envMapIntensity: 1.6,
  },
] as const satisfies readonly Finish[];

export type FinishId = (typeof FINISHES)[number]['id'];

export const DEFAULT_FINISH: FinishId = 'metallise';

export function finish(id: FinishId): Finish {
  return FINISHES.find((item) => item.id === id) ?? FINISHES[0];
}
