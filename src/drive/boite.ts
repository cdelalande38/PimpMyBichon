// Boîte de vitesses fictive de la sortie de nuit (§ 5.5, § 9 « Sur la route ») : régime du moteur
// d'après la vitesse, avec des rapports. Fonctions pures, sans allocation cachée, testées par
// tests/unit/drive-son-boite.test.ts ; les boîtes sont des données (src/data/boites.ts), une par
// famille de sons. Le régime rendu est celui du moteur réel ; `regimeJoue` le ramène à ce que les
// enregistrements savent jouer.

import type { BoiteSpec } from '../data/boites.ts';

export interface EtatBoite {
  /** Rapport engagé, de 1 au nombre de rapports. */
  rapport: number;
  /** Régime du moteur réel, en tr/min. */
  regime: number;
  /** Temps restant du passage de rapport en cours, en secondes (0 hors passage). */
  passage: number;
}

export interface EntreeBoite {
  vitesseKmh: number;
  /** Accélérateur, de 0 à 1 (en pilote automatique : déduit de l'accélération). */
  charge: number;
  /** Frein appuyé : l'accélérateur est relâché. */
  frein: boolean;
}

export interface SortieBoite extends EtatBoite {
  /** Charge à faire entendre, de 0 à 1 : nulle au frein, presque nulle pendant un passage. */
  charge: number;
}

/** Sous cette vitesse, en km/h, le véhicule est à l'arrêt : premier rapport, embrayage débrayé. */
export const VITESSE_ARRET = 1;
/** Charge pendant un passage de rapport : on lève le pied. */
export const CHARGE_PASSAGE = 0.1;
/** Marge contre le pompage : on ne monte un rapport que si le suivant tourne à 10 % au-dessus du rétrogradage. */
const MARGE_POMPAGE = 1.1;
/** Constante de temps du régime hors passage, en secondes. */
const TAU_REGIME = 0.08;

const unite = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Rapprochement exponentiel de `cible`, de constante de temps `tau`, en `dt` secondes. */
export function suivre(valeur: number, cible: number, dt: number, tau: number): number {
  if (!(tau > 0) || !Number.isFinite(valeur)) return cible;
  if (!(dt > 0)) return valeur;
  return cible + (valeur - cible) * Math.exp(-dt / tau);
}

export function etatInitial(ralenti: number): EtatBoite {
  return { rapport: 1, regime: ralenti, passage: 0 };
}

/** Régime des roues sur un rapport, en tr/min : ce que ferait le moteur embrayé. */
export function regimeRoues(vitesseKmh: number, boite: BoiteSpec, rapport: number): number {
  const n = boite.kmhPar1000.length;
  const k = boite.kmhPar1000[Math.min(n, Math.max(1, rapport)) - 1] ?? 1;
  return (Math.max(0, vitesseKmh) / Math.max(0.1, k)) * 1000;
}

/** Régime de passage au rapport supérieur : en croisière tôt, à plein gaz tard. */
export function seuilPassage(boite: BoiteSpec, charge: number): number {
  return boite.passageCroisiere + (boite.passagePleinGaz - boite.passageCroisiere) * unite(charge);
}

/**
 * Avance la boîte de `dt` secondes : choix du rapport (monte selon la charge, rétrograde sous le
 * seuil), passage qui fait tomber la charge et rejoindre au régime le rapport suivant, embrayage qui
 * patine au départ, ralenti à l'arrêt, rupteur.
 */
export function pasBoite(etat: EtatBoite, entree: EntreeBoite, boite: BoiteSpec, ralenti: number, dt: number): SortieBoite {
  const n = Math.max(1, boite.kmhPar1000.length);
  const v = Math.max(0, Number.isFinite(entree.vitesseKmh) ? entree.vitesseKmh : 0);
  const charge = entree.frein ? 0 : unite(entree.charge);
  const pas = Math.min(0.5, Math.max(0, Number.isFinite(dt) ? dt : 0));
  let rapport = Math.min(n, Math.max(1, Math.round(etat.rapport) || 1));
  let passage = Math.max(0, etat.passage);
  const regime = Number.isFinite(etat.regime) ? etat.regime : ralenti;

  // À l'arrêt : premier rapport, débrayé ; un coup d'accélérateur fait monter un peu le régime.
  if (v < VITESSE_ARRET) {
    const cible = ralenti + (Math.max(ralenti, boite.embrayage) - ralenti) * charge * 0.5;
    return { rapport: 1, regime: suivre(regime, cible, pas, 0.15), passage: 0, charge };
  }

  // Passage en cours : la charge tombe, le régime rejoint celui du nouveau rapport.
  if (passage > 0) {
    passage = Math.max(0, passage - pas);
    const cible = Math.min(boite.rupteur, Math.max(ralenti, regimeRoues(v, boite, rapport)));
    return { rapport, regime: suivre(regime, cible, pas, boite.dureePassage / 3), passage, charge: Math.min(charge, CHARGE_PASSAGE) };
  }

  // Choix du rapport.
  if (
    rapport < n &&
    regimeRoues(v, boite, rapport) >= seuilPassage(boite, charge) &&
    regimeRoues(v, boite, rapport + 1) >= boite.retrograde * MARGE_POMPAGE
  ) {
    // Le passage commence : le régime reste en haut cet instant, la charge tombe.
    return { rapport: rapport + 1, regime, passage: boite.dureePassage, charge: Math.min(charge, CHARGE_PASSAGE) };
  }
  if (rapport > 1 && regimeRoues(v, boite, rapport) < boite.retrograde) {
    rapport -= 1;
    passage = boite.dureePassage * 0.6;
  }

  // Embrayé : le régime suit les roues, sans tomber sous le ralenti ; au départ, l'embrayage patine.
  const roues = regimeRoues(v, boite, rapport);
  let cible = Math.max(ralenti, roues);
  if (rapport === 1 && roues < boite.embrayage) cible = Math.max(cible, ralenti + (boite.embrayage - ralenti) * charge);
  cible = Math.min(boite.rupteur, cible);
  return { rapport, regime: suivre(regime, cible, pas, passage > 0 ? boite.dureePassage / 3 : TAU_REGIME), passage, charge };
}

/**
 * Régime à faire jouer aux enregistrements : le régime réel tel quel s'il tient dans la plage que
 * les boucles savent jouer ; sinon, la plage du moteur réel (ralenti → rupteur) est ramenée sur
 * celle des sons, pour que montées et passages restent audibles.
 */
export function regimeJoue(reel: number, ralenti: number, rupteur: number, plage: { min: number; max: number } | null): number {
  if (!plage) return reel;
  const r = Number.isFinite(reel) ? reel : ralenti;
  if (rupteur <= plage.max) return Math.min(plage.max, Math.max(plage.min, r));
  const t = (r - ralenti) / Math.max(1, rupteur - ralenti);
  return plage.min + Math.min(1, Math.max(0, t)) * (plage.max - plage.min);
}
