// Niveaux de qualité graphique (§ 8). Module pur.
// La peinture multicouche et la sonde de réflexion sont de tous les niveaux ; l'économie coupe
// la chaîne d'image. Réflexion planaire, occlusion et brume viendront s'ajouter ici.

import type { QualitySetting } from '../state/settings.ts';

export const QUALITY_LEVELS = ['eco', 'standard', 'max'] as const;
export type QualityLevel = (typeof QUALITY_LEVELS)[number];

export interface QualityProfile {
  /** Plafond du pixel ratio. Jamais au-dessus de 2 (§ 8, budgets). */
  dprMax: number;
  /** Chaîne d'image : bloom, tone mapping, étalonnage, vignettage, grain, SMAA. */
  post: boolean;
  /** Échantillons MSAA du rendu hors écran (0 : aucun). */
  multisampling: number;
  /** Côté d'une face de la sonde de réflexion, en pixels (§ 8 : 256 à 512). */
  probeSize: number;
}

export const QUALITY_PROFILES: Readonly<Record<QualityLevel, QualityProfile>> = Object.freeze({
  eco: { dprMax: 1.25, post: false, multisampling: 0, probeSize: 256 },
  standard: { dprMax: 2, post: true, multisampling: 0, probeSize: 256 },
  max: { dprMax: 2, post: true, multisampling: 4, probeSize: 512 },
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
