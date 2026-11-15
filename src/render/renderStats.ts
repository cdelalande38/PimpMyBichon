// Mesures du rendu, pour « Sous le capot ». Rien n'est sauvegardé ni envoyé.

import { create } from 'zustand';
import { createAutoQuality, stepAutoQuality, type AutoQualityEvent, type AutoQualityState } from './autoQuality.ts';
import type { CompareOutcome, CompareVariant, MeterSummary } from './frameMeter.ts';
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
  /** Mesure comparée de « Sous le capot » (bouton « Comparer », src/render/frameMeter.ts). */
  compare: CompareState;
  /**
   * Le processeur graphique sait rendre dans des cibles en demi-flottants (EXT_color_buffer_float
   * ou _half_float) ; `null` avant le démarrage. Sans elles : niveau économie, composeur en 8 bits.
   */
  floatTargets: boolean | null;
  /**
   * Cibles en flottants 32 bits (EXT_color_buffer_float) : l'occlusion du niveau max (N8AO) en
   * exige une (R32F). Sans elles, le niveau max se rend au standard. `null` avant le démarrage.
   */
  fullFloatTargets: boolean | null;
  /** Compte les contextes WebGL rendus après une perte : sonde et ombre se refont. */
  gpuEpoch: number;
  /**
   * Coupe caméra (src/scene/garage/cut.ts) : éléments du décor retirés de l'image parce qu'ils
   * passeraient devant le véhicule, sur le nombre d'éléments surveillés, et boîte du véhicule
   * protégée (mesurée, ou d'attente) ; `null` avant la scène.
   */
  cut: { hidden: number; total: number; vehicle: { min: readonly number[]; max: readonly number[] } } | null;
  /**
   * Trame de la coupe (src/render/cutDither.ts) : variantes « trame » préparées et prêtes (sinon la
   * coupe bascule sans fondu), matériaux qui la portent en ce moment (un de leurs éléments est en
   * fondu), sur le nombre de matériaux opaques du décor ; `null` avant la scène.
   */
  cutDither: {
    ready: boolean;
    active: number;
    carriers: number;
    /** Dernier préchauffage : temps passé sur le fil principal, et délai jusqu'aux variantes prêtes (ms). */
    warm: { ms: number; readyMs: number } | null;
  } | null;
  /** Programmes de nuanceur vivants (renderer.info.programs) ; `null` avant la scène. */
  programs: number | null;
}

export interface CompareState {
  running: boolean;
  /** Rang de la mesure en cours (COMPARE_STEPS). */
  step: number;
  /** Variante posée sur la scène en ce moment (`null` : la scène telle quelle) : la scène la suit. */
  variant: CompareVariant | null;
  /**
   * Résultats, au fil des mesures, gardés jusqu'à la comparaison suivante : niveau et pixel ratio
   * du départ, une ligne par variante mesurée (ou non mesurée, avec sa raison).
   */
  result: { level: QualityLevel; dpr: number; outcomes: readonly CompareOutcome[] } | null;
  /** Raison de l'abandon de la dernière comparaison ; `null` si elle est allée au bout. */
  aborted: string | null;
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
  compare: { running: false, step: 0, variant: null, result: null, aborted: null },
  floatTargets: null,
  fullFloatTargets: null,
  gpuEpoch: 0,
  cut: null,
  cutDither: null,
  programs: null,
}));

/** Applique une décision du moniteur de cadence au niveau « auto ». */
export function applyAutoQuality(event: AutoQualityEvent, fps: number): void {
  useRenderStats.setState((state) => ({ auto: { ...stepAutoQuality(state.auto, event), fps } }));
}

/** Lance la mesure de cadence (cinq secondes de rotation). */
export function startMeter(): void {
  useRenderStats.setState((state) =>
    state.meter.running || state.compare.running ? state : { meter: { running: true, result: state.meter.result } },
  );
}

/** Lance la mesure comparée (quatre mesures d'affilée, une vingtaine de secondes). */
export function startCompare(): void {
  useRenderStats.setState((state) =>
    state.meter.running || state.compare.running
      ? state
      : { compare: { running: true, step: 0, variant: null, result: null, aborted: null } },
  );
}

/**
 * Abandonne la mesure comparée en cours (panneau fermé, onglet caché, contexte perdu, mode photo) :
 * la variante posée est retirée aussitôt par la scène ; les mesures déjà faites restent.
 */
export function abortCompare(reason: string): void {
  useRenderStats.setState((state) =>
    state.compare.running ? { compare: { ...state.compare, running: false, variant: null, aborted: reason } } : state,
  );
}
