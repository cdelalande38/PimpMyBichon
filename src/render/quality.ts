// Niveaux de qualité graphique (§ 8). Module pur.
// Au jalon 0, un niveau ne règle que la densité de pixels et le bloom de la scène de substitut ;
// le contenu réel de chaque niveau (réflexion planaire, occlusion, brume…) se décide au jalon 1.

import type { QualitySetting } from '../state/settings.ts';

export const QUALITY_LEVELS = ['eco', 'standard', 'max'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface QualityProfile {
  /** Plafond du pixel ratio. Jamais au-dessus de 2 (§ 8, budgets). */
  dprMax: number;
  /** Bloom sur les sources émissives. */
  bloom: boolean;
  /** Échantillons MSAA du rendu hors écran (0 : aucun). */
  multisampling: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = Object.freeze({
  eco: { dprMax: 1.25, bloom: false, multisampling: 0 },
  standard: { dprMax: 2, bloom: true, multisampling: 0 },
  max: { dprMax: 2, bloom: true, multisampling: 4 },
});

/**
 * Niveau appliqué pour un réglage donné.
 * « auto » retient pour l'instant le niveau standard : le choix d'après la cadence mesurée
 * arrive avec le jalon 1, quand il y aura un vrai rendu à ajuster.
 */
export function resolveQuality(setting: QualitySetting): QualityLevel {
  return setting === 'auto' ? 'standard' : setting;
}

export const QUALITY_LABELS: Readonly<Record<QualityLevel, string>> = Object.freeze({
  eco: 'Économie',
  standard: 'Standard',
  max: 'Max',
});
