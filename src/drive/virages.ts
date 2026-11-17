// Les virages d'un parcours (lot « virages » de la sortie de nuit) : calculés une fois au chargement
// d'après la courbure du rail, puis interrogés à toute abscisse sans allocation.
//
// - Un virage est un tronçon où la courbure garde son signe et dépasse `courbureBord` ; il compte s'il
//   atteint `courbureMin` quelque part et tourne d'au moins `angleMinDeg`. Deux courbes de même sens
//   proches se fondent en un virage. Un S fait deux virages, de sens opposés.
// - Sens : +1 la route tourne à gauche, −1 à droite (comme la courbure du contrat).
// - Cran de sévérité (1 doux à 4 épingle) : d'après le rayon le plus serré, moins un cran pour une
//   courbe brève (angle faible). Les seuils sont des données (src/data/virages.ts).
// - Parcours en boucle : un virage peut enjamber la couture (début près de la fin, fin au-delà de la
//   longueur) ; les distances se prennent modulo la longueur.

import { REGLAGES_VIRAGES, type ReglagesVirages } from '../data/virages.ts';
import type { Rail } from './contrat.ts';
import { createPose } from './rail.ts';

export interface Virage {
  /** Abscisses du début, de la corde (milieu de la partie la plus serrée) et de la fin ; `fin` peut dépasser la longueur en boucle. */
  debut: number;
  corde: number;
  fin: number;
  longueur: number;
  /** +1 gauche, −1 droite. */
  sens: 1 | -1;
  /** Rayon le plus serré, en mètres. */
  rayon: number;
  /** Angle tourné, en radians (positif). */
  angle: number;
  cran: 1 | 2 | 3 | 4;
}

export interface Virages {
  readonly liste: readonly Virage[];
  readonly longueur: number;
  readonly boucle: boolean;
}

/** Cran de sévérité d'un virage de ce rayon (m) et de cet angle (radians). */
export function cranDe(rayon: number, angle: number, reglages: ReglagesVirages = REGLAGES_VIRAGES): 1 | 2 | 3 | 4 {
  let cran: number = reglages.crans[reglages.crans.length - 1]?.cran ?? 1;
  for (const c of reglages.crans) {
    if (rayon <= c.rayonMax) {
      cran = c.cran;
      break;
    }
  }
  if (angle < (reglages.angleDouxDeg * Math.PI) / 180) cran -= 1;
  return Math.max(1, Math.min(4, cran)) as 1 | 2 | 3 | 4;
}

/** Couleur du cran (annonce, mini-carte). */
export function couleurDuCran(cran: number, reglages: ReglagesVirages = REGLAGES_VIRAGES): string {
  for (const c of reglages.crans) if (c.cran === cran) return c.couleur;
  return reglages.crans[reglages.crans.length - 1]?.couleur ?? '#ffffff';
}

interface Troncon {
  from: number;
  to: number;
  sens: 1 | -1;
  /** Courbure maximale en valeur absolue, et le premier et dernier indices où elle approche ce maximum. */
  kMax: number;
  iMax: number;
  jMax0: number;
  jMax1: number;
  /** Intégrale de |courbure| (radians). */
  angle: number;
}

/**
 * Les virages du rail. Calcul unique, au chargement (quelques milliers de poses) : il alloue, la boucle
 * d'images n'y revient pas.
 */
export function trouverVirages(rail: Rail, reglages: ReglagesVirages = REGLAGES_VIRAGES): Virages {
  const longueur = rail.length;
  const boucle = rail.loop;
  const pas = reglages.pas;
  const n = Math.max(2, Math.ceil(longueur / pas));
  const ds = longueur / n;
  const pose = createPose();
  const k = new Float64Array(n);
  for (let i = 0; i < n; i += 1) k[i] = rail.poseAt(i * ds, pose).curvature;

  // Boucle : on commence là où la route est droite, pour ne couper aucun virage ; une boucle entièrement
  // courbe (un cercle) n'a qu'un virage.
  let origine = 0;
  if (boucle) {
    let trouve = -1;
    for (let i = 0; i < n; i += 1) {
      if (Math.abs(k[i]!) < reglages.courbureBord) {
        trouve = i;
        break;
      }
    }
    if (trouve < 0) return { liste: tourComplet(k, ds, longueur, reglages), longueur, boucle };
    origine = trouve;
  }
  const at = (i: number) => k[(origine + i) % n]!;

  // Tronçons de courbure de même signe au-dessus du seuil de bord.
  const troncons: Troncon[] = [];
  let courant: Troncon | null = null;
  for (let i = 0; i < n; i += 1) {
    const v = at(i);
    const dedans = Math.abs(v) >= reglages.courbureBord;
    const sens: 1 | -1 = v >= 0 ? 1 : -1;
    if (courant && (!dedans || courant.sens !== sens)) {
      courant.to = i;
      troncons.push(courant);
      courant = null;
    }
    if (dedans) {
      if (!courant) courant = { from: i, to: i + 1, sens, kMax: 0, iMax: i, jMax0: i, jMax1: i, angle: 0 };
      courant.angle += Math.abs(v) * ds;
      if (Math.abs(v) > courant.kMax) {
        courant.kMax = Math.abs(v);
        courant.iMax = i;
      }
    }
  }
  if (courant) {
    courant.to = n;
    troncons.push(courant);
  }

  // Fusion des courbes de même sens séparées par un court intervalle.
  const fusionnes: Troncon[] = [];
  for (const t of troncons) {
    const dernier = fusionnes[fusionnes.length - 1];
    if (dernier && dernier.sens === t.sens && (t.from - dernier.to) * ds < reglages.fusion) {
      // L'intervalle entre les deux compte pour son angle (faible).
      for (let i = dernier.to; i < t.from; i += 1) dernier.angle += Math.abs(at(i)) * ds;
      dernier.angle += t.angle;
      dernier.to = t.to;
      if (t.kMax > dernier.kMax) {
        dernier.kMax = t.kMax;
        dernier.iMax = t.iMax;
      }
    } else fusionnes.push({ ...t });
  }

  const liste: Virage[] = [];
  for (const t of fusionnes) {
    if (t.kMax < reglages.courbureMin) continue;
    if (t.angle < (reglages.angleMinDeg * Math.PI) / 180) continue;
    // Corde : milieu de la partie la plus serrée (courbure à 80 % du maximum au moins).
    let j0 = t.iMax;
    let j1 = t.iMax;
    for (let i = t.iMax; i >= t.from && Math.abs(at(i)) >= 0.8 * t.kMax; i -= 1) j0 = i;
    for (let i = t.iMax; i < t.to && Math.abs(at(i)) >= 0.8 * t.kMax; i += 1) j1 = i;
    const rayon = 1 / t.kMax;
    const debut = (origine + t.from) * ds;
    const fin = debut + (t.to - t.from) * ds;
    liste.push({
      debut: normaliser(debut, longueur, boucle),
      corde: normaliser((origine + (j0 + j1) / 2) * ds, longueur, boucle),
      fin: normaliser(debut, longueur, boucle) + (fin - debut),
      longueur: fin - debut,
      sens: t.sens,
      rayon,
      angle: t.angle,
      cran: cranDe(rayon, t.angle, reglages),
    });
  }
  // Ordre par début (en boucle, l'origine déplacée a pu enjamber le zéro).
  liste.sort((a, b) => a.debut - b.debut);
  return { liste, longueur, boucle };
}

function normaliser(s: number, longueur: number, boucle: boolean): number {
  return boucle ? ((s % longueur) + longueur) % longueur : s;
}

function tourComplet(k: Float64Array, ds: number, longueur: number, reglages: ReglagesVirages): Virage[] {
  let somme = 0;
  let kMax = 0;
  for (let i = 0; i < k.length; i += 1) {
    somme += k[i]! * ds;
    kMax = Math.max(kMax, Math.abs(k[i]!));
  }
  if (kMax <= 0) return [];
  const rayon = 1 / kMax;
  const angle = Math.abs(somme);
  return [{ debut: 0, corde: longueur / 2, fin: longueur, longueur, sens: somme >= 0 ? 1 : -1, rayon, angle, cran: cranDe(rayon, angle, reglages) }];
}

/** Où l'on est par rapport aux virages : réécrit sur place, sans allocation. */
export interface SituationVirage {
  /** Indice du virage dans lequel on est (−1 : en ligne). */
  courant: number;
  /** Indice du prochain virage à entrer (−1 : plus aucun sur un parcours ouvert). */
  prochain: number;
  /** Distance jusqu'à son début, en mètres (0 si aucun). */
  distance: number;
}

export function situationNeuve(): SituationVirage {
  return { courant: -1, prochain: -1, distance: 0 };
}

/** Écart de `s` à `debut` vers l'avant : modulo la longueur en boucle. */
function devant(debut: number, s: number, v: Virages): number {
  const d = debut - s;
  return v.boucle ? ((d % v.longueur) + v.longueur) % v.longueur : d;
}

/**
 * Le virage où l'on est et le prochain à entrer, depuis l'abscisse `s`. Le « prochain » est le premier
 * dont le début est devant (strictement) ; en boucle, il y en a toujours un si la carte a des virages.
 */
export function situer(v: Virages, s: number, out: SituationVirage): SituationVirage {
  const liste = v.liste;
  out.courant = -1;
  out.prochain = -1;
  out.distance = 0;
  const m = liste.length;
  if (m === 0) return out;
  const position = v.boucle ? ((s % v.longueur) + v.longueur) % v.longueur : s;
  // Premier virage dont le début est > position (recherche dichotomique).
  let lo = 0;
  let hi = m;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (liste[mid]!.debut <= position) lo = mid + 1;
    else hi = mid;
  }
  // Le virage courant est le précédent (ou, en boucle, le dernier, qui peut enjamber la couture).
  const avant = lo - 1;
  const candidat = avant >= 0 ? avant : v.boucle ? m - 1 : -1;
  if (candidat >= 0) {
    const c = liste[candidat]!;
    const rel = v.boucle ? ((position - c.debut) % v.longueur + v.longueur) % v.longueur : position - c.debut;
    if (rel <= c.longueur) out.courant = candidat;
  }
  if (lo < m) out.prochain = lo;
  else if (v.boucle) out.prochain = 0;
  if (out.prochain >= 0) out.distance = Math.max(0, devant(liste[out.prochain]!.debut, position, v));
  return out;
}

/** Vrai quand le prochain virage mérite l'annonce, à cette vitesse (m/s) et à cette distance (m). */
export function annonceActive(distance: number, vitesse: number, reglages: ReglagesVirages = REGLAGES_VIRAGES): boolean {
  const portee = Math.max(reglages.annonceMin, Math.min(reglages.annonceMax, vitesse * reglages.annonceSecondes));
  return distance <= portee;
}

/**
 * Les virages de la sortie en cours et le rail qui les porte, publiés par la scène (src/drive/scene/
 * chevrons.ts) pour la mini-carte (src/ui/drive/MiniCarte.tsx), comme `livePilot` pour le compte-tours.
 */
export const liveVirages: { current: { rail: Rail; virages: Virages } | null } = { current: null };
