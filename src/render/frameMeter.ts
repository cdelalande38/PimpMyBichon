// Mesure de cadence pour la recette sur téléphone (« Sous le capot », bouton « Mesurer »).
// Module pur : la scène tourne cinq secondes, chaque image donne sa durée et son coût.

/** Durée de la mesure, en millisecondes. */
export const METER_DURATION_MS = 5000;

export interface FrameSample {
  /** Durée depuis l'image précédente, en millisecondes. */
  ms: number;
  calls: number;
  triangles: number;
}

export interface MeterSummary {
  frames: number;
  /** Cadence moyenne, en images par seconde. */
  fps: number;
  /** Pire centile : cadence que tiennent 99 % des images (durée du centile le plus lent). */
  worstFps: number;
  /** Appels de dessin et triangles moyens par image. */
  calls: number;
  triangles: number;
}

/** Valeur au rang `p` (0 à 1) d'une liste triée, par le rang le plus proche. */
function percentile(sorted: readonly number[], p: number): number {
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank] ?? 0;
}

/** Résumé d'une mesure ; `null` sans image exploitable. */
export function summarizeFrames(samples: readonly FrameSample[]): MeterSummary | null {
  const valid = samples.filter((sample) => Number.isFinite(sample.ms) && sample.ms > 0);
  if (valid.length === 0) return null;
  const total = valid.reduce((sum, sample) => sum + sample.ms, 0);
  const sorted = valid.map((sample) => sample.ms).sort((a, b) => a - b);
  const slowest = percentile(sorted, 0.99);
  const mean = (pick: (sample: FrameSample) => number) =>
    Math.round(valid.reduce((sum, sample) => sum + pick(sample), 0) / valid.length);
  return {
    frames: valid.length,
    fps: Math.round((1000 * valid.length) / total * 10) / 10,
    worstFps: Math.round((1000 / slowest) * 10) / 10,
    calls: mean((sample) => sample.calls),
    triangles: mean((sample) => sample.triangles),
  };
}
