// Les feux du départ arrêté, pour les bruitages de route (src/audio/sfx/route.ts) : la scène les écrit
// à chaque image (src/drive/scene/moteur.ts, d'après src/drive/depart.ts), le lecteur les relit dix
// fois par seconde. Objet réécrit sur place, aucune allocation.

export const feuxSon = {
  /** Feux rouges allumés (0 à 2). */
  rouges: 0,
  /** Feu vert allumé. */
  vert: false,
};
