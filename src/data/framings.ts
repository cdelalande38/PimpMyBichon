// Les 5 cadrages du mode photo (§ 5.1), en données. Aucune condition propre à un cadrage dans le code.
// Repère de src/scene/fit.ts : azimut 0 côté canapé (+z), angle polaire mesuré depuis la verticale
// (π/2 : caméra à hauteur de la cible). Les cadrages sont décrits pour un avant vers +x ; quand le
// véhicule est posé nez vers -x (GARAGE.vehicle.turn = π), framingPose les passe en miroir.

export const FRAMING_IDS = ['avant', 'profil', 'arriere', 'plongee', 'ras-du-sol'] as const;
export type FramingId = (typeof FRAMING_IDS)[number];

export interface Framing {
  id: FramingId;
  /** Libellé complet, en français (lu par les lecteurs d'écran). */
  label: string;
  /** Libellé court du bouton, sous le pouce. */
  short: string;
  /** Azimut de la caméra autour du véhicule, en radians. */
  azimuth: number;
  /** Angle polaire, en radians (0 : au-dessus, π/2 : à l'horizontale). */
  polar: number;
  /** Distance à la cible, relative à la distance de cadrage de fitCamera (1 : le véhicule tient dans l'écran). */
  distance: number;
  /** Hauteur de la cible, relative à la hauteur de cible par défaut du garage (1 : inchangée). */
  targetHeight: number;
  /** Décalage de la cible le long de l'axe avant du véhicule, en fraction de sa demi-longueur (0 : centre, 1 : l'avant). */
  targetAlong: number;
  /** Champ vertical, en facteur du champ de fitCamera (< 1 : plus long, > 1 : plus large). */
  fovScale: number;
  /** Rayon du disque d'ouverture, en mètres (0 : tout net). Sert à la profondeur de champ en photo. */
  aperture: number;
}

/** Bornes que doit respecter chaque cadrage (vérifiées par les tests). */
export const FRAMING_LIMITS = Object.freeze({
  distance: { min: 0.3, max: 2 },
  /** Reste au-dessus du sol : jamais à l'horizontale pile ni sous le plan du sol. */
  polar: { min: 0.2, max: 1.55 },
  targetHeight: { min: 0.1, max: 1.5 },
  targetAlong: { min: -1, max: 1 },
  fovScale: { min: 0.5, max: 1.5 },
  aperture: { min: 0, max: 0.05 },
});

export const FRAMINGS: readonly Framing[] = Object.freeze([
  {
    id: 'avant',
    label: 'Trois-quarts avant',
    short: 'Avant',
    azimuth: 0.95,
    polar: 1.38,
    distance: 1,
    targetHeight: 1,
    targetAlong: 0,
    fovScale: 1,
    aperture: 0.01,
  },
  {
    id: 'profil',
    label: 'Profil',
    short: 'Profil',
    azimuth: 0,
    polar: 1.5,
    distance: 1.2,
    targetHeight: 1,
    targetAlong: 0,
    fovScale: 0.8,
    aperture: 0.006,
  },
  {
    id: 'arriere',
    label: 'Trois-quarts arrière',
    short: 'Arrière',
    azimuth: -0.95,
    polar: 1.36,
    distance: 1,
    targetHeight: 1,
    targetAlong: 0,
    fovScale: 1,
    aperture: 0.01,
  },
  {
    id: 'plongee',
    label: 'Plongée',
    short: 'Plongée',
    azimuth: 0.55,
    polar: 0.62,
    distance: 1.1,
    targetHeight: 0.8,
    targetAlong: 0,
    fovScale: 1,
    aperture: 0.008,
  },
  {
    id: 'ras-du-sol',
    label: 'Ras du sol, côté roue',
    short: 'Ras du sol',
    azimuth: 0.45,
    polar: 1.52,
    distance: 0.6,
    targetHeight: 0.3,
    targetAlong: 0.55,
    fovScale: 1.15,
    aperture: 0.014,
  },
]);

export function framingById(id: FramingId): Framing {
  const found = FRAMINGS.find((item) => item.id === id);
  if (!found) throw new RangeError(`Cadrage inconnu : ${id}`);
  return found;
}
