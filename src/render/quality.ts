// Niveaux de qualité graphique (§ 8). Module pur : ce que chaque niveau active, en données.
// La peinture multicouche, la sonde de réflexion, l'ombre de contact et l'étalonnage sont de
// tous les niveaux. L'économie coupe la réflexion planaire, l'occlusion écran et la brume
// (§ 8) ; le sol y reste brillant grâce à la sonde.

import type { QualitySetting } from '../state/settings.ts';

export const QUALITY_LEVELS = ['eco', 'standard', 'max'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface QualityProfile {
  /** Plafond du pixel ratio. Jamais au-dessus de 2 (§ 8, budgets). */
  dprMax: number;
  /** Côté d'une face de la sonde de réflexion, en pixels (§ 8 : 256 à 512). */
  probeSize: number;
  /**
   * Réflexion planaire du sol : taille de sa cible par rapport à l'image (0 : aucune ;
   * 0,5 : demi-résolution ; 1 : pleine).
   */
  reflection: number;
  /** Brouillard, cônes de lumière sous les spots, nappes au ras du sol. */
  atmosphere: boolean;
  /** Occlusion ambiante en espace écran. */
  ao: boolean;
  /** Bloom sélectif sur les émissifs. */
  bloom: boolean;
  /** Échantillons MSAA de la chaîne d'image (0 : aucun). */
  multisampling: number;
  /** Anticrénelage SMAA en fin de chaîne. */
  smaa: boolean;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = Object.freeze({
  eco: { dprMax: 1.25, probeSize: 256, reflection: 0, atmosphere: false, ao: false, bloom: false, multisampling: 0, smaa: true },
  // Pas de MSAA : sur des cibles en demi-flottants il double la mémoire du composeur, et il se
  // résout avant le tone mapping (inutile sur les néons). SMAA et pixel ratio plein suffisent ;
  // l'image photo, elle, est suréchantillonnée par accumulation.
  standard: { dprMax: 2, probeSize: 256, reflection: 0.5, atmosphere: true, ao: false, bloom: true, multisampling: 0, smaa: true },
  // L'occlusion lit la profondeur du composeur, que le MSAA ne lui transmet pas (§ mémo d'API) :
  // au niveau max, l'anticrénelage passe par le SMAA et le pixel ratio plein.
  max: { dprMax: 2, probeSize: 512, reflection: 1, atmosphere: true, ao: true, bloom: true, multisampling: 0, smaa: true },
});

/**
 * Niveau appliqué pour un réglage donné. « auto » prend le niveau retenu d'après la cadence
 * mesurée (src/render/autoQuality.ts). Sans cibles de rendu flottantes, toujours l'économie ;
 * sans cibles en flottants 32 bits (`fullFloat`, exigées par l'occlusion), le max se rend au standard.
 */
export function resolveQuality(setting: QualitySetting, auto: QualityLevel = 'standard', floatTargets = true, fullFloat = true): QualityLevel {
  if (!floatTargets) return 'eco';
  const level = setting === 'auto' ? auto : setting;
  return level === 'max' && !fullFloat ? 'standard' : level;
}

export const QUALITY_LABELS: Readonly<Record<QualityLevel, string>> = Object.freeze({
  eco: 'Économie',
  standard: 'Standard',
  max: 'Max',
});
