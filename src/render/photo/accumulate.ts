// Moyenne courante du rendu photo : poids de mélange, critère d'arrêt, reprise à zéro. Module pur.
// Une image rendue sur `acc` avec l'opacité `blendWeight(n)` donne la moyenne exacte des n + 1 images.

export interface Accumulator {
  /** Nombre d'images déjà mélangées. */
  readonly count: number;
  /** Nombre d'images visé. */
  readonly target: number;
  /** Empreinte de la prise de vue (caméra, taille, peinture) : null avant la première observation. */
  readonly key: readonly number[] | null;
}

/** Poids de l'image `index` (0, 1, 2…) dans la moyenne courante : 1 / (index + 1). */
export function blendWeight(index: number): number {
  if (!Number.isInteger(index) || index < 0) throw new RangeError(`Indice d'image invalide : ${index}`);
  return 1 / (index + 1);
}

export function createAccumulator(target: number): Accumulator {
  if (!Number.isInteger(target) || target < 1) throw new RangeError(`Nombre d'images invalide : ${target}`);
  return { count: 0, target, key: null };
}

/** Vrai si les deux empreintes diffèrent (longueur ou valeur au-delà de `epsilon`). */
export function keyChanged(previous: readonly number[] | null, next: readonly number[], epsilon = 1e-4): boolean {
  if (previous === null || previous.length !== next.length) return true;
  for (let i = 0; i < next.length; i += 1) {
    const a = previous[i] ?? Number.NaN;
    const b = next[i] ?? Number.NaN;
    if (!(Math.abs(a - b) <= epsilon)) return true;
  }
  return false;
}

/**
 * Observe l'empreinte courante : si la caméra (ou autre chose) a bougé, repart de zéro.
 * Sinon, rend l'accumulateur tel quel.
 */
export function observe(acc: Accumulator, key: readonly number[], epsilon = 1e-4): Accumulator {
  if (!keyChanged(acc.key, key, epsilon)) return acc;
  return { count: 0, target: acc.target, key: [...key] };
}

/** Remise à zéro explicite, en gardant l'empreinte (changement de peinture, de taille de cible…). */
export function restart(acc: Accumulator, target = acc.target): Accumulator {
  return { count: 0, target, key: acc.key };
}

/** Poids à donner à la prochaine image. */
export function nextWeight(acc: Accumulator): number {
  return blendWeight(acc.count);
}

/** Compte une image de plus (sans dépasser la cible). */
export function advance(acc: Accumulator): Accumulator {
  return acc.count >= acc.target ? acc : { ...acc, count: acc.count + 1 };
}

/** Vrai quand toutes les images visées sont mélangées. */
export function isComplete(acc: Accumulator): boolean {
  return acc.count >= acc.target;
}

/**
 * Critère d'arrêt : cible atteinte, ou durée écoulée depuis la première image au-delà de `maxMs`
 * (un téléphone lent s'arrête avec ce qu'il a, pourvu qu'il ait au moins une image).
 */
export function shouldStop(acc: Accumulator, elapsedMs: number, maxMs: number): boolean {
  if (isComplete(acc)) return true;
  return acc.count >= 1 && elapsedMs >= maxMs;
}
