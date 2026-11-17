// Réglages de l'annonce des virages (src/drive/virages.ts, src/drive/scene/chevrons.ts,
// src/ui/drive/MiniCarte.tsx). Des données, pas du code : les seuils se règlent ici, à l'oreille et à
// l'œil, sans toucher aux modules.

/** Un cran de sévérité : le virage y entre quand son rayon le plus serré est au plus `rayonMax` (m). */
export interface CranVirage {
  cran: 1 | 2 | 3 | 4;
  rayonMax: number;
  /** Couleur de l'annonce et du tracé mis en valeur (mini-carte). */
  couleur: string;
}

export const REGLAGES_VIRAGES = {
  /** Pas d'échantillonnage de la courbure le long du rail, en mètres. */
  pas: 3,
  /** Courbure (1/m) au-delà de laquelle la route est tenue pour « en virage » : bords du virage. */
  courbureBord: 1 / 900,
  /** Courbure (1/m) que le virage doit atteindre quelque part pour compter (rayon le plus serré ≤ 450 m). */
  courbureMin: 1 / 450,
  /** Deux courbes de même sens séparées de moins que cela (m) ne forment qu'un virage. */
  fusion: 45,
  /** Angle tourné minimal, en degrés, pour qu'un virage compte. */
  angleMinDeg: 12,
  /** Sous cet angle (degrés), un virage perd un cran (une courbe brève n'est pas une épingle). */
  angleDouxDeg: 28,
  /** Du plus sévère au plus doux ; le dernier est le cran de repli (le plus doux). */
  crans: [
    { cran: 4, rayonMax: 40, couleur: '#ff3d5a' },
    { cran: 3, rayonMax: 90, couleur: '#ff8a1f' },
    { cran: 2, rayonMax: 190, couleur: '#ffd21f' },
    { cran: 1, rayonMax: Infinity, couleur: '#7fe3ff' },
  ] as readonly CranVirage[],
  /** Annonce : le virage est annoncé quand il est à moins de `secondes` s à la vitesse du moment... */
  annonceSecondes: 7,
  /** ...et à moins de `annonceMax` m, mais toujours dès `annonceMin` m. */
  annonceMax: 650,
  annonceMin: 90,
  /** Balises à chevrons : à partir de quel cran, et pour chaque cran (indice 0 = cran 1) l'écart entre
   *  deux panneaux (m) et la longueur posée avant le début du virage (m). */
  chevrons: {
    cranMin: 2,
    ecart: [30, 22, 14, 9] as readonly number[],
    avance: [0, 40, 80, 130] as readonly number[],
    /** Les panneaux courent jusqu'à la fin du virage, plus ce prolongement (m). */
    prolongement: 12,
    /** Distance entre le bord dessiné de la chaussée et le pied des panneaux, vers l'extérieur (m). */
    retrait: 0.35,
    /** Les panneaux posés (au plus) : borne la mémoire et le dessin. */
    max: 520,
    /** Portée de pose autour du véhicule : devant (m) et derrière (m). */
    devant: 900,
    derriere: 120,
  },
} as const;

export type ReglagesVirages = typeof REGLAGES_VIRAGES;
