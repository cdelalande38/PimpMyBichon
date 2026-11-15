// Position dans un morceau : bornes du placement et lecture en clair. Module pur, testable tel quel.

/** Marge avant la fin : se placer pile sur la fin déclencherait l'enchaînement aussitôt. */
const END_MARGIN_S = 0.25;

/** Position bornée, en secondes : jamais négative, jamais au-delà de la fin (durée inconnue : seulement ≥ 0). */
export function clampPosition(seconds: number, duration: number | null | undefined): number {
  const wanted = Number.isFinite(seconds) ? seconds : 0;
  const max = duration && Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - END_MARGIN_S) : Infinity;
  return Math.min(Math.max(0, wanted), max);
}

/** « 1 min 12 », « 45 s », « 3 min » : valeur lue par les lecteurs d'écran. */
export function spokenTime(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  if (minutes === 0) return `${rest} s`;
  return rest === 0 ? `${minutes} min` : `${minutes} min ${rest}`;
}
