// @ts-check
// Gabarit chiffré du fourgon réel (fourgon tôlé moderne des années 2000, empattement court),
// rabaissé de 5 cm : cotes relevées sur des vues de profil, de face et de trois quarts, rapportées à
// l'empattement (3,00 m) et à la hauteur hors tout, puis arrondies au centimètre. Repère du véhicule :
// avant vers +X, haut +Y, sol à y = 0, essieux à x = ±1,50. Il sert à mesurer la maquette
// (tests/unit/vehicule-van-forme.test.ts), jamais à la dessiner trait pour trait.

/** @typedef {[number, number]} P2 */

export const GABARIT = /** @type {const} */ ({
  /**
   * Profil (x, y), contour fermé, roues comprises à part (disques de 0,33 aux essieux) : bouclier
   * saillant, phares en retrait de 11 cm, capot plongeant (25°) dans le prolongement d'un pare-brise
   * très incliné (33°), pavillon plat, arrière presque vertical.
   * @type {P2[]}
   */
  profil: [
    [2.38, 0.21],
    [2.4, 0.3],
    [2.4, 0.72],
    [2.38, 0.76],
    [2.29, 0.78],
    [2.28, 0.98],
    [2.25, 1.03],
    [2.05, 1.14],
    [1.82, 1.21],
    [1.64, 1.31],
    [1.53, 1.39],
    [1.25, 1.56],
    [1.03, 1.69],
    [0.86, 1.79],
    [0.71, 1.855],
    [0.55, 1.885],
    [0.3, 1.895],
    [-2.2, 1.895],
    [-2.31, 1.855],
    [-2.41, 1.79],
    [-2.47, 1.7],
    [-2.49, 1.5],
    [-2.49, 0.34],
    [-2.45, 0.3],
    [-2.2, 0.25],
    [2.2, 0.21],
  ],
  /**
   * Face (z, y), moitié droite du contour (l'autre s'en déduit) : boucliers, flancs droits jusqu'à la
   * ceinture, vitrage rentrant, pavillon arrondi ; grand rétroviseur à coque noire.
   * @type {P2[]}
   */
  face: [
    [0, 0.21],
    [0.86, 0.21],
    [0.93, 0.3],
    [0.95, 0.45],
    [0.95, 1.1],
    [0.97, 1.1],
    [1.12, 1.12],
    [1.12, 1.37],
    [0.97, 1.38],
    [0.94, 1.4],
    [0.91, 1.7],
    [0.9, 1.76],
    [0.88, 1.83],
    [0.84, 1.875],
    [0.76, 1.895],
    [0, 1.9],
  ],
  /** Lignes de caisse (m) : ceinture (bas des vitres latérales), haut des vitres, pied du pare-brise. */
  lignes: { ceinture: 1.12, hautVitres: 1.76, piedPareBrise: [1.64, 1.31], hautPareBrise: [0.71, 1.855], phares: [0.76, 0.98], bouclierAvant: 0.76, feuxArriere: [0.71, 1.15] },
});
