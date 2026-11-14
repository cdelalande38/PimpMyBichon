// Mesures du rendu, pour « Sous le capot ». Rien n'est sauvegardé ni envoyé.

import { create } from 'zustand';

export interface GpuInfo {
  webgl2: boolean;
  /** Nom du processeur graphique, si le navigateur accepte de le donner. */
  renderer: string | null;
  maxTextureSize: number;
}

interface RenderStatsState {
  gpu: GpuInfo | null;
  /** Dernière cadence mesurée pendant que la scène bougeait ; `null` tant qu'elle n'a pas bougé. */
  fps: number | null;
  /** Pixel ratio réellement appliqué au canvas. */
  dpr: number | null;
  /** Coût de la dernière image dessinée : appels de dessin et triangles (toutes passes). */
  frame: { calls: number; triangles: number } | null;
  /** Sonde de réflexion : taille de face, durée du dernier calcul, nombre de calculs. */
  probe: { size: number; ms: number; updates: number; version: string } | null;
}

export const useRenderStats = create<RenderStatsState>()(() => ({
  gpu: null,
  fps: null,
  dpr: null,
  frame: null,
  probe: null,
}));
