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
    // Regard incliné d'une vingtaine de degrés vers le sol, et un peu plus près : en portrait, le
    // champ vertical est grand, et à 1,38 le quart haut de l'image n'était que plafond.
    polar: 1.22,
    distance: 0.86,
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

// ————————————————————————————————————————————————————————————————————————————————————————
// Cadrages de pose d'un sticker (Custom › Stickers) : tant qu'une zone de livrée est choisie, la
// caméra du garage la montre en grand dans la partie de l'écran que le panneau laisse libre. Le
// cadrage se déduit de la face que la zone regarde (manifeste, `livery[].face`) : aucun cas par
// véhicule. La caméra regarde la zone comme le plan à plat du panneau la dessine (vue de dehors) :
// glisser un sticker vers la droite du plan le pousse vers la droite de l'écran. Pour une zone de
// dessus (capot, toit, réservoir, garde-boue), le plan met l'avant du véhicule en haut : la caméra
// plonge donc depuis l'arrière de la zone, regard vers l'avant. Calcul : src/scene/fit.ts, fitZone.

export const ZONE_FRAMING_IDS = ['profil', 'face', 'dessus'] as const;
export type ZoneFramingId = (typeof ZONE_FRAMING_IDS)[number];

export interface ZoneFraming {
  id: ZoneFramingId;
  /** Faces de zone de livrée (src/data/stickersCalques.ts, LiveryFace) que ce cadrage montre. */
  faces: readonly ('+x' | '-x' | '+y' | '-y' | '+z' | '-z')[];
  /**
   * Cap de la caméra autour de la zone, dans le repère du véhicule (0 : devant, vers +X ; π/2 : à
   * droite, vers +Z ; π : derrière) ; `normale` : en face de la zone, sur sa normale.
   */
  heading: number | 'normale';
  /** Élévation de la caméra au-dessus de l'horizontale de la zone, en radians. */
  elevation: number;
  /**
   * Marge gardée autour de la zone, en mètres, de chaque côté : un petit cadre (réservoir, capot
   * moteur) se voit avec ce qui l'entoure, un grand (flanc) presque seul. Elle ne dépasse pas
   * `marginShare` de la plus grande dimension de la zone : un tout petit cadre (garde-boue) reste en grand.
   */
  margin: number;
  marginShare: number;
  /** Part de la zone libre que la zone et sa marge occupent au plus, en largeur et en hauteur. */
  share: number;
  shareHeight: number;
}

/** Bornes des cadrages de pose (vérifiées par les tests). L'élévation reste dans l'orbite du garage. */
export const ZONE_FRAMING_LIMITS = Object.freeze({
  elevation: { min: 0, max: 1.0 },
  margin: { min: 0, max: 0.6 },
  marginShare: { min: 0, max: 1 },
  share: { min: 0.5, max: 0.95 },
});

export const ZONE_FRAMINGS: readonly ZoneFraming[] = Object.freeze([
  // Flancs, côtés du réservoir : de profil, un peu au-dessus, toute la longueur dans la largeur.
  { id: 'profil', faces: ['+z', '-z'], heading: 'normale', elevation: 0.12, margin: 0.12, marginShare: 0.3, share: 0.92, shareHeight: 0.8 },
  // Face avant, arrière, capot moteur : de face, un peu en plongée.
  { id: 'face', faces: ['+x', '-x'], heading: 'normale', elevation: 0.22, margin: 0.35, marginShare: 0.3, share: 0.86, shareHeight: 0.8 },
  // Capot, toit, réservoir, garde-boue : plongée depuis l'arrière de la zone, l'avant en haut de l'image.
  { id: 'dessus', faces: ['+y', '-y'], heading: Math.PI, elevation: 0.98, margin: 0.35, marginShare: 0.3, share: 0.86, shareHeight: 0.8 },
]);

/** Durée du passage d'un cadrage à l'autre (et du retour à la vue d'avant), en millisecondes. */
export const ZONE_FRAMING_MS = 480;

/** Cadrage de pose d'une zone de livrée, d'après la face qu'elle regarde. */
export function zoneFramingFor(face: ZoneFraming['faces'][number]): ZoneFraming {
  const found = ZONE_FRAMINGS.find((item) => item.faces.includes(face));
  if (!found) throw new RangeError(`Aucun cadrage pour la face ${face}`);
  return found;
}

// ————————————————————————————————————————————————————————————————————————————————————————
// Cadrages d'un bout du véhicule (Custom › Phares, Mécanique › Échappement) : tant que le panneau est
// ouvert, la caméra du garage montre l'avant du véhicule (lumière, optiques) ou son arrière (feux,
// sorties d'échappement), de face, au-dessus du menu, par le cadrage de pose d'une zone (`ZONE_FRAMINGS` :
// faces « +x » et « -x », le cadrage « face »). Le cadre se déduit du gabarit du véhicule posé
// (src/scene/vehicle/gabarit.ts : repère du modèle préparé, avant vers +X, sol à y = 0) : aucun cas par
// véhicule. L'orbite au doigt reste libre autour de lui.

export type CoteVehicule = 'avant' | 'arriere';

export interface CadreBout {
  /** Face regardée : l'avant (+X) ou l'arrière (−X). */
  face: '+x' | '-x';
  /** Recul du plan cadré depuis le bout du véhicule, en part de sa demi-longueur (0 : le bout). */
  recul: number;
  /** Part de la largeur et de la hauteur du véhicule que le cadre couvre (1 : tout). */
  largeur: number;
  hauteur: number;
}

/** Bornes des cadres d'un bout (vérifiées par les tests). */
export const CADRE_BOUT_LIMITS = Object.freeze({ recul: { min: 0, max: 0.5 }, part: { min: 0.5, max: 1 } });

export const CADRES_BOUT: Readonly<Record<CoteVehicule, CadreBout>> = Object.freeze({
  avant: { face: '+x', recul: 0.2, largeur: 1, hauteur: 1 },
  arriere: { face: '-x', recul: 0.2, largeur: 1, hauteur: 1 },
});

/** Cadre de pose (comme une zone de livrée : face, centre, taille) d'un bout du véhicule, d'après son gabarit. */
export function cadreBout(
  cote: CoteVehicule,
  gabarit: { halfLength: number; halfWidth: number; height: number },
): { face: '+x' | '-x'; center: [number, number, number]; size: [number, number, number] } {
  const cadre = CADRES_BOUT[cote];
  const sign = cadre.face === '+x' ? 1 : -1;
  const recul = cadre.recul * gabarit.halfLength;
  const hauteur = gabarit.height * cadre.hauteur;
  return {
    face: cadre.face,
    center: [sign * (gabarit.halfLength - recul), hauteur / 2, 0],
    size: [2 * gabarit.halfWidth * cadre.largeur, hauteur, Math.max(0.05, 2 * recul)],
  };
}
