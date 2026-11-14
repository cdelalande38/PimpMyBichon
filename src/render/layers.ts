// Calques de la scène : qui voit quoi. Le calque 0 est vu de tous (caméra, reflet du sol, sonde).
// - ATMOSPHERE : cônes et nappes de brume, vus par la caméra seule.
// - PROBE_ONLY : rampes lumineuses du plafond, vues par la sonde seule. Elles dessinent les longs
//   reflets de la caisse et l'éclairent par l'environnement, sans barrer le haut de l'image.
// - NO_MIRROR : petits objets et décor en hauteur, vus par la caméra et la sonde, absents du
//   reflet du sol (qui redessine la scène : chaque objet y coûte un appel de dessin de plus).

export const ATMOSPHERE_LAYER = 1;
export const PROBE_ONLY_LAYER = 2;
export const NO_MIRROR_LAYER = 3;

/** Calques de la caméra principale, en plus du calque 0. */
export const CAMERA_LAYERS: readonly number[] = [ATMOSPHERE_LAYER, NO_MIRROR_LAYER];
/** Calques des six caméras de la sonde, en plus du calque 0. */
export const PROBE_LAYERS: readonly number[] = [PROBE_ONLY_LAYER, NO_MIRROR_LAYER];
