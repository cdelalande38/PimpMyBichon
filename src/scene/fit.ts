// Cadrage de la caméra d'orbite selon la forme de l'écran. Module pur (testable).

export interface CameraFit {
  /** Champ vertical, en degrés. */
  fov: number;
  /** Distance de la caméra à sa cible, en mètres. */
  distance: number;
  minDistance: number;
  maxDistance: number;
}

/** Hauteur à garder visible autour de la cible, en mètres. */
const HALF_HEIGHT = 1.7;
/** Plage de zoom autour de la distance de cadrage (pincement, double-tap plus tard). */
const ZOOM_IN = 0.55;
const ZOOM_OUT = 1.5;

/**
 * Distance à laquelle un objet de demi-longueur `halfLength` tient dans la largeur de l'écran.
 * En portrait, c'est la largeur qui commande : on ouvre le champ pour ne pas trop reculer.
 */
export function fitCamera(width: number, height: number, halfLength: number): CameraFit {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const portrait = h > w * 1.15;
  const fov = portrait ? 46 : 34;
  const vHalf = (fov * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * (w / h));
  const distance = Math.max(halfLength / Math.tan(hHalf), HALF_HEIGHT / Math.tan(vHalf));
  return {
    fov,
    distance,
    minDistance: distance * ZOOM_IN,
    maxDistance: distance * ZOOM_OUT,
  };
}

/**
 * Vue de départ : côté gauche (azimut négatif), trois quarts avant du véhicule posé nez à
 * gauche, légèrement au-dessus. Dans le même cadre : le mur du fond et ses halos, le mur rouge.
 */
export const START_AZIMUTH = -0.5;
export const START_POLAR = 1.42;

/** Position de la caméra sur son orbite (azimut 0 : face au mur du fond, depuis le canapé). */
export function orbitPosition(
  target: readonly [number, number, number],
  distance: number,
  azimuth = START_AZIMUTH,
  polar = START_POLAR,
): [number, number, number] {
  const s = Math.sin(polar);
  return [
    target[0] + Math.sin(azimuth) * s * distance,
    target[1] + Math.cos(polar) * distance,
    target[2] + Math.cos(azimuth) * s * distance,
  ];
}

/**
 * Bande haute gardée libre au-dessus du véhicule quand le dock est agrandi (nom de l'atelier,
 * pastille d'état), en part de la hauteur de l'écran.
 */
export const DOCK_TOP_MARGIN = 0.1;

/**
 * Dock agrandi : décalage vertical de la vue, en pixels vers le haut, qui amène la cible (au centre
 * de l'image) au milieu de la partie libre, entre la bande haute et le haut du dock. Sans dock
 * agrandi (`dockTop` nul), ou si la cible est déjà dans la partie libre, rien ne bouge : le cadrage
 * d'origine reste celui du dock compact.
 */
export function dockShift(height: number, dockTop: number | null): number {
  if (dockTop === null || !Number.isFinite(dockTop) || height <= 0) return 0;
  const top = Math.min(Math.max(dockTop, 0), height);
  const free = (height * DOCK_TOP_MARGIN + top) / 2;
  return Math.max(0, Math.round(height / 2 - free));
}

/** Durée du recadrage quand le dock change de taille (coupé si l'on demande moins de mouvement). */
export const DOCK_SHIFT_MS = 260;

/** Courbe du recadrage : départ vif, arrivée douce. `t` dans [0, 1]. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - clamped) ** 3;
}
