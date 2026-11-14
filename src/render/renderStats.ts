// Mesures du rendu, pour « Sous le capot ». Rien n'est sauvegardé ni envoyé.

import { create } from 'zustand';
import { createAutoQuality, stepAutoQuality, type AutoQualityEvent, type AutoQualityState } from './autoQuality.ts';
import type { MeterSummary } from './frameMeter.ts';
import type { QualityLevel } from './quality.ts';

export interface GpuInfo {
  webgl2: boolean;
  /** Nom du processeur graphique, si le navigateur accepte de le donner. */
  renderer: string | null;
  maxTextureSize: number;
}

export interface RenderStatsState {
  gpu: GpuInfo | null;
  /** Dernière cadence mesurée pendant que la scène bougeait ; `null` tant qu'elle n'a pas bougé. */
  fps: number | null;
  /** Pixel ratio réellement appliqué au canvas. */
  dpr: number | null;
  /** Coût de la dernière image dessinée : appels de dessin et triangles (toutes passes). */
  frame: { calls: number; triangles: number } | null;
  /** Sonde de réflexion : taille de face, durée du dernier calcul, nombre de calculs. */
  probe: { size: number; ms: number; updates: number; version: string } | null;
  /** Cible de la réflexion planaire du sol, en pixels ; `null` sans réflexion (niveau économie). */
  reflection: { width: number; height: number } | null;
  /** Qualité « auto » : niveau retenu d'après la cadence, et dernière cadence vue par le moniteur. */
  auto: AutoQualityState & { fps: number | null };
  /** Mesure de cadence de « Sous le capot » (bouton « Mesurer »). */
  meter: { running: boolean; result: (MeterSummary & { level: QualityLevel }) | null };
  /**
   * Le processeur graphique sait rendre dans des cibles en demi-flottants (EXT_color_buffer_float
   * ou _half_float) ; `null` avant le démarrage. Sans elles : niveau économie, composeur en 8 bits.
   */
  floatTargets: boolean | null;
  /** Compte les contextes WebGL rendus après une perte : sonde et ombre se refont. */
  gpuEpoch: number;
  /**
   * Coupe caméra (src/scene/garage/cut.ts) : éléments du décor retirés de l'image parce qu'ils
   * passeraient devant le véhicule, sur le nombre d'éléments surveillés, et boîte du véhicule
   * protégée (mesurée, ou d'attente) ; `null` avant la scène.
   */
  cut: { hidden: number; total: number; vehicle: { min: readonly number[]; max: readonly number[] } } | null;
}

export const useRenderStats = create<RenderStatsState>()(() => ({
  gpu: null,
  fps: null,
  dpr: null,
  frame: null,
  probe: null,
  reflection: null,
  auto: { ...createAutoQuality(), fps: null },
  meter: { running: false, result: null },
  floatTargets: null,
  gpuEpoch: 0,
  cut: null,
}));

/** Applique une décision du moniteur de cadence au niveau « auto ». */
export function applyAutoQuality(event: AutoQualityEvent, fps: number): void {
  useRenderStats.setState((state) => ({ auto: { ...stepAutoQuality(state.auto, event), fps } }));
}

/** Lance la mesure de cadence (cinq secondes de rotation). */
export function startMeter(): void {
  useRenderStats.setState((state) => (state.meter.running ? state : { meter: { running: true, result: state.meter.result } }));
}
