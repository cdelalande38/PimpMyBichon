// Qualité automatique (§ 8) : le réglage « auto » choisit le niveau d'après la cadence mesurée
// par le PerformanceMonitor de drei. Module pur : bornes de cadence et décision, testables.
// La mesure n'a lieu que pendant les phases où la scène est rendue en continu (src/scene/AutoQuality.tsx).

import type { QualityLevel } from './quality.ts';

/** Ordre des niveaux, du plus léger au plus riche. */
const ORDER: readonly QualityLevel[] = ['eco', 'standard', 'max'];

/** Niveau de départ : le niveau visé par le jalon 1 (60 i/s en standard sur l'appareil de référence). */
export const AUTO_START: QualityLevel = 'standard';
/** Cadence visée (§ 8), en images par seconde, quel que soit le rafraîchissement de l'écran. */
export const AUTO_TARGET_FPS = 60;
/**
 * Plafond du réglage « auto » au jalon 1 : le niveau visé est le standard (60 i/s sur l'appareil
 * de référence). Un téléphone à l'aise ne monte pas tout seul en max, où la recette se ferait sans
 * le savoir avant de redescendre à la chauffe (audit téléphone, constat 3). Max reste au choix.
 */
export const AUTO_CEILING: QualityLevel = 'standard';
/** Nombre de changements de niveau au-delà duquel on se fixe (pas de va-et-vient sans fin). */
export const AUTO_MAX_CHANGES = 3;

/**
 * Bornes [basse, haute] de cadence pour PerformanceMonitor : sous la basse, on descend d'un
 * niveau ; au-dessus de la haute, on monte. Le moniteur passe la meilleure cadence qu'il a vue
 * en guise de fréquence d'écran : sur un téléphone lent, elle est basse, et des bornes qui la
 * suivraient ne feraient jamais descendre. La cible reste donc 60 i/s, même sur un écran à 120 Hz.
 */
export function autoQualityBounds(): [number, number] {
  return [Math.round(AUTO_TARGET_FPS * 0.75), Math.round(AUTO_TARGET_FPS * 0.95)];
}

export interface AutoQualityState {
  level: QualityLevel;
  /** Nombre de changements de niveau déjà faits. */
  changes: number;
  /** Vrai une fois le niveau fixé : plus aucun changement. */
  settled: boolean;
  /** Niveau quitté au dernier changement : y revenir aussitôt fixe le plus léger des deux. */
  previous: QualityLevel | null;
}

export function createAutoQuality(level: QualityLevel = AUTO_START): AutoQualityState {
  return { level, changes: 0, settled: false, previous: null };
}

export type AutoQualityEvent = 'incline' | 'decline' | 'fallback';

/**
 * Décision après une mesure : descendre (`decline`), monter (`incline`), ou se fixer (`fallback`,
 * le moniteur a vu trop de va-et-vient). Monter puis redescendre aussitôt fixe le niveau le plus
 * léger : un téléphone tout juste à l'aise au niveau du dessus n'y tiendrait pas.
 */
export function stepAutoQuality(state: AutoQualityState, event: AutoQualityEvent): AutoQualityState {
  if (state.settled) return state;
  if (event === 'fallback') return { ...state, settled: true };
  const index = ORDER.indexOf(state.level);
  const nextIndex = event === 'decline' ? index - 1 : index + 1;
  const next = nextIndex <= ORDER.indexOf(AUTO_CEILING) ? ORDER[nextIndex] : undefined;
  // Déjà au bout de l'échelle : on y reste, et on s'y fixe si c'est le bas.
  if (next === undefined) return event === 'decline' ? { ...state, settled: true } : state;
  const changes = state.changes + 1;
  const bounced = event === 'decline' && state.previous === next;
  return {
    level: next,
    changes,
    previous: state.level,
    settled: bounced || changes >= AUTO_MAX_CHANGES,
  };
}
