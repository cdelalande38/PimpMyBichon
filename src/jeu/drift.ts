// Le score des drifts (format « Drift », règles dans src/data/drift.ts) : un cœur pur, sans allocation, avancé
// à chaque image par le suivi de la course (src/drive/course.ts) d'après la dérive de la caisse
// (`DriveMotion.drift`), la vitesse et le contact avec le bord. Lu par l'affichage du drift en cours
// (src/ui/drive/DriftCompteur.tsx) et, à l'arrivée, par l'écran de fin (`StatsDrift` du contrat du jeu).

import { POINTS_DRIFT } from '../data/drift.ts';
import type { StatsDrift } from './contrat.ts';

export interface EtatDrift {
  /** Drift en cours : côté de la caisse (1 à gauche, −1 à droite), 0 aucun. */
  cote: number;
  /** Points du drift en cours, avant le multiplicateur. */
  points: number;
  /** Durée du drift en cours (s). */
  duree: number;
  /** Temps passé droit pendant le drift en cours (s). */
  droit: number;
  /** Multiplicateur du drift en cours, ou du prochain s'il vient à temps. */
  mult: number;
  /** Temps depuis la fin du dernier drift compté (s) ; Infinity : aucun, ou la chaîne est rompue. */
  depuis: number;
  total: number;
  meilleur: number;
  plusLong: number;
  nombre: number;
  multMax: number;
  /** Dernier drift fini : ses points (multiplicateur compris) ; négatif, les points perdus. */
  dernier: number;
  /** Drifts finis ou perdus depuis le départ (l'affichage voit qu'un vient de finir). */
  fins: number;
}

export function createEtatDrift(): EtatDrift {
  return { cote: 0, points: 0, duree: 0, droit: 0, mult: 1, depuis: Infinity, total: 0, meilleur: 0, plusLong: 0, nombre: 0, multMax: 1, dernier: 0, fins: 0 };
}

export function remettreDrift(e: EtatDrift): EtatDrift {
  e.cote = 0;
  e.points = 0;
  e.duree = 0;
  e.droit = 0;
  e.mult = 1;
  e.depuis = Infinity;
  e.total = 0;
  e.meilleur = 0;
  e.plusLong = 0;
  e.nombre = 0;
  e.multMax = 1;
  e.dernier = 0;
  e.fins = 0;
  return e;
}

/** Points par seconde d'un drift à cet angle (rad, valeur absolue) et à cette vitesse (m/s). */
export function pointsParSeconde(angle: number, vitesse: number): number {
  const P = POINTS_DRIFT;
  return (P.parSeconde * Math.min(Math.abs(angle), P.angleMax) * Math.min(Math.max(0, vitesse), P.vitesseMax)) / (P.angleRef * P.vitesseRef);
}

/** Points du drift en cours, multiplicateur compris. */
export function pointsEnCours(e: EtatDrift): number {
  return Math.round(e.points * e.mult);
}

/** Le drift en cours est fini : compté (assez long) ; le multiplicateur monte pour le suivant. */
export function compterDrift(e: EtatDrift): void {
  if (e.cote === 0) return;
  e.cote = 0;
  // La durée en travers : sans le temps passé droit à la fin.
  const duree = e.duree - e.droit;
  if (duree < POINTS_DRIFT.dureeMin) return;
  const valeur = pointsEnCours(e);
  e.total += valeur;
  e.meilleur = Math.max(e.meilleur, valeur);
  e.plusLong = Math.max(e.plusLong, duree);
  e.nombre += 1;
  e.multMax = Math.max(e.multMax, e.mult);
  e.dernier = valeur;
  e.fins += 1;
  e.mult = Math.min(POINTS_DRIFT.multMax, e.mult + 1);
  e.depuis = 0;
}

/** Bord touché ou tête-à-queue : le drift en cours est perdu, la chaîne rompue. */
export function perdreDrift(e: EtatDrift): void {
  if (e.cote === 0) return;
  e.dernier = -pointsEnCours(e);
  e.fins += 1;
  e.cote = 0;
  e.points = 0;
  e.mult = 1;
  e.depuis = Infinity;
}

/**
 * Un pas de `dt` s : dérive de la caisse `angle` (rad, positive à gauche), vitesse (m/s), bord touché
 * (`contact` ≠ 0). Rien d'alloué.
 */
export function pasDrift(e: EtatDrift, dt: number, angle: number, vitesse: number, contact: number): EtatDrift {
  const P = POINTS_DRIFT;
  if (!(Number.isFinite(dt) && dt > 0)) return e;
  const a = Number.isFinite(angle) ? angle : 0;
  const v = Number.isFinite(vitesse) ? vitesse : 0;
  if (e.cote !== 0 && ((contact !== 0 && Number.isFinite(contact)) || Math.abs(a) > P.toupie)) {
    perdreDrift(e);
    return e;
  }
  const glisse = Math.abs(a) >= P.angleMin && v >= P.vitesseMin;
  const cote = a > 0 ? 1 : -1;
  // Changement de côté sans se remettre droit : le drift compte, le suivant s'enchaîne aussitôt.
  if (glisse && e.cote !== 0 && cote !== e.cote) compterDrift(e);
  if (e.cote === 0) {
    if (e.depuis !== Infinity) e.depuis += dt;
    if (e.depuis > P.enchainement) {
      e.mult = 1;
      e.depuis = Infinity;
    }
    if (!glisse) return e;
    e.cote = cote;
    e.points = 0;
    e.duree = 0;
    e.droit = 0;
  }
  e.duree += dt;
  if (glisse) {
    e.droit = 0;
    e.points += pointsParSeconde(a, v) * dt;
  } else {
    e.droit += dt;
    if (e.droit >= P.tolerance) compterDrift(e);
  }
  return e;
}

/** À l'arrivée : le drift en cours compte, puis le bilan (une seule allocation). */
export function bilanDrift(e: EtatDrift): StatsDrift {
  compterDrift(e);
  return { score: e.total, meilleur: e.meilleur, plusLong: Math.round(e.plusLong * 10) / 10, nombre: e.nombre, multMax: e.multMax };
}
