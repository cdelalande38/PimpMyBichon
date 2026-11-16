// Météo locale de la route, pour les bruitages (src/audio/sfx/route.ts) : posée à chaque image par
// la scène de route (src/drive/scene/moteur.ts, d'après src/drive/scene/abri.ts : ni pluie ni neige
// sous un tunnel, chaussée qui y sèche), lue dix fois par seconde par src/drive/son.ts. Un seul
// objet, réécrit sur place : aucune allocation par image. Tant que la scène ne l'a pas posée
// (`posee` faux), le son retombe sur la météo choisie (src/state/drive.ts), sans tunnel.

export const meteoSon = {
  posee: false,
  /** Pluie qui tombe là où roule le véhicule, de 0 à 1. */
  pluie: 0,
  /** Neige qui tombe là où roule le véhicule, de 0 à 1. */
  neige: 0,
  /** Chaussée mouillée, de 0 à 1. */
  mouille: 0,
  /** Sous la voûte d'un tunnel, de 0 à 1. */
  abri: 0,
};
