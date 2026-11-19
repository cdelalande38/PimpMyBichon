// La course du duel (§ 5.5, jeu) : qui est devant, de combien, qui a gagné. Pur, sans allocation par image.
//
// L'adversaire court par la même machine que le joueur (src/drive/depart.ts) : tenu sur sa ligne tant que
// les feux du joueur ne sont pas au vert, parti au même instant, même chrono, mêmes tours, arrivée sur la
// même ligne (le bout de la route, ou la ligne qui boucle le dernier tour).
//
// - Position : 1 si le joueur a couru plus de distance que l'adversaire (ou a franchi la ligne avant lui).
// - Écart, en secondes, comme on le lit au bord de la piste : le chrono de celui de derrière moins celui
//   qu'avait celui de devant au même point de la course. Chaque côté relève son chrono tous les `pas` m
//   (tableaux réservés une fois par duel), interpolé dans l'image.
// - Verdict, à l'arrivée du joueur (une course, pas une balade : le pilote automatique ne gagne rien) :
//   perdu si l'adversaire a franchi la ligne avant, de la différence des deux temps ; gagné sinon, de
//   l'écart de l'adversaire à cet instant (le temps que le joueur avait mis pour aller d'où il est à la ligne).

import { armerDepart, createDepart, enCourse, pasDepart, type EtatDepart, type ParcoursDepart } from '../depart.ts';

/** Pas des relevés, en mètres. */
export const PAS_RELEVES = 5;

export interface VerdictDuel {
  gagne: boolean;
  /** Écart, en secondes (≥ 0). */
  ecart: number;
  /** Temps du joueur, en secondes. */
  temps: number;
  /** Temps de l'adversaire, en secondes, s'il a fini ; `null` sinon. */
  tempsAdversaire: number | null;
}

export interface EtatDuel {
  /** La course de l'adversaire. */
  readonly adv: EtatDepart;
  /** Chrono (ms) au passage de chaque relevé, joueur et adversaire. */
  readonly tJ: Float64Array;
  readonly tA: Float64Array;
  nJ: number;
  nA: number;
  /** Distance et chrono au pas précédent (interpolation des relevés). */
  dJ: number;
  cJ: number;
  dA: number;
  cA: number;
  /** 1 : le joueur mène ; 2 : l'adversaire. */
  position: 1 | 2;
  /** Écart entre les deux, en secondes (≥ 0). */
  ecart: number;
  /** Vrai une fois parti (feux passés). */
  lance: boolean;
  verdict: VerdictDuel | null;
}

/** Un duel pour une course de `distance` m au plus (relevés réservés une fois). */
export function createDuel(distance: number): EtatDuel {
  const n = Math.max(2, Math.ceil(Math.max(0, distance) / PAS_RELEVES) + 2);
  return { adv: createDepart(), tJ: new Float64Array(n), tA: new Float64Array(n), nJ: 0, nA: 0, dJ: 0, cJ: 0, dA: 0, cA: 0, position: 1, ecart: 0, lance: false, verdict: null };
}

/**
 * Nouveau départ : l'adversaire en `sAdv`, `tours` tours (1 sur une route ouverte). `decalage` : de combien
 * (m) il part devant la ligne du joueur (négatif : derrière, en quinconce) ; sa distance de course se compte
 * depuis la ligne du joueur, pour que les deux courent la même course.
 */
export function armerDuel(duel: EtatDuel, sAdv: number, boucle: boolean, tours: number, decalage = 0): EtatDuel {
  armerDepart(duel.adv, sAdv, boucle, false, tours);
  duel.adv.parcouru = Number.isFinite(decalage) ? decalage : 0;
  duel.tJ.fill(0);
  duel.tA.fill(0);
  duel.nJ = 0;
  duel.nA = 0;
  duel.dJ = 0;
  duel.cJ = 0;
  duel.dA = 0;
  duel.cA = 0;
  duel.position = 1;
  duel.ecart = 0;
  duel.lance = false;
  duel.verdict = null;
  return duel;
}

/** Relève les passages d'un côté entre deux pas (distance d0 → d1, chrono c0 → c1). */
function relever(t: Float64Array, n: number, d0: number, c0: number, d1: number, c1: number): number {
  let k = n;
  while (k < t.length && k * PAS_RELEVES <= d1) {
    const d = k * PAS_RELEVES;
    t[k] = d1 > d0 ? c0 + ((d - d0) / (d1 - d0)) * (c1 - c0) : c1;
    k += 1;
  }
  return k;
}

/** Chrono (ms) relevé au passage de la distance `d` (interpolé), ou NaN s'il n'y est pas encore passé. */
export function chronoA(t: Float64Array, n: number, d: number): number {
  if (!(d >= 0) || n === 0) return n > 0 ? (t[0] ?? 0) : Number.NaN;
  const x = d / PAS_RELEVES;
  const k = Math.floor(x);
  if (k + 1 >= n) return k < n ? (t[k] ?? Number.NaN) : Number.NaN;
  const f = x - k;
  return (t[k] ?? 0) * (1 - f) + (t[k + 1] ?? 0) * f;
}

/**
 * Un pas, après celui du joueur (`joueur` : son départ, déjà avancé). `sAdv` : abscisse de l'adversaire
 * après son pas ; `finiAdv` : bout d'un parcours ouvert atteint.
 */
export function pasDuel(duel: EtatDuel, joueur: EtatDepart, dt: number, sAdv: number, parcours: ParcoursDepart, finiAdv: boolean): EtatDuel {
  const adv = duel.adv;
  if (joueur.phase === 'attente' || joueur.phase === 'feux') return duel;
  if (!duel.lance) {
    // Le vert du joueur : l'adversaire part au même instant, au même chrono.
    duel.lance = true;
    adv.phase = 'parti';
    adv.vert = true;
    adv.depuisVert = joueur.depuisVert;
    adv.chrono = joueur.chrono;
    adv.sPrec = Number.isFinite(sAdv) ? sAdv : adv.sPrec;
    duel.cJ = joueur.chrono;
    duel.cA = joueur.chrono;
    duel.tJ[0] = joueur.chrono;
    duel.tA[0] = joueur.chrono;
    duel.nJ = 1;
    duel.nA = 1;
    return duel;
  }
  pasDepart(adv, dt, true, sAdv, parcours, finiAdv);
  // Distances de course, bornées à la ligne d'arrivée de chacun (les relevés s'arrêtent à l'arrivée).
  const dJ = Math.max(0, joueur.parcouru);
  const dA = Math.max(0, adv.parcouru);
  if (joueur.phase !== 'arrive' || duel.nJ === 0) duel.nJ = relever(duel.tJ, duel.nJ, duel.dJ, duel.cJ, dJ, joueur.chrono);
  if (adv.phase !== 'arrive' || duel.nA === 0) duel.nA = relever(duel.tA, duel.nA, duel.dA, duel.cA, dA, adv.chrono);
  duel.dJ = dJ;
  duel.cJ = joueur.chrono;
  duel.dA = dA;
  duel.cA = adv.chrono;
  if (duel.verdict) return duel;
  const advFini = adv.phase === 'arrive';
  const joueurFini = joueur.phase === 'arrive';
  if (joueurFini && enCourse(joueur)) {
    const perdu = advFini && adv.arrivee <= joueur.arrivee;
    const ecart = perdu ? (joueur.arrivee - adv.arrivee) / 1000 : (joueur.arrivee - chronoA(duel.tJ, duel.nJ, dA)) / 1000;
    duel.verdict = { gagne: !perdu, ecart: Math.max(0, Number.isFinite(ecart) ? ecart : 0), temps: joueur.arrivee / 1000, tempsAdversaire: advFini ? adv.arrivee / 1000 : null };
    duel.position = perdu ? 2 : 1;
    duel.ecart = duel.verdict.ecart;
    return duel;
  }
  const devant = advFini ? false : dJ >= dA;
  duel.position = devant ? 1 : 2;
  const ecart = devant ? joueur.chrono - chronoA(duel.tJ, duel.nJ, dA) : joueur.chrono - chronoA(duel.tA, duel.nA, dJ);
  duel.ecart = Math.max(0, Number.isFinite(ecart) ? ecart / 1000 : 0);
  return duel;
}
