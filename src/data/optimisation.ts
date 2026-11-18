// Optimisation des pièces du moteur (Mécanique · Moteur, vague U, retour du 18 novembre 2026 : « il
// faudra pouvoir optimiser les pièces moteur aussi »). Le catalogue des moteurs dit ce que chaque pièce
// optimise (`optimisation` : filtre, admission, carburation, culasses, échappement, allumage) ; ce
// fichier donne, par genre, les niveaux au-dessus de l'origine : un nom d'atelier inventé, une ligne qui
// dit ce que ça fait, un prix, un gain de puissance en pour cent.
//
// Les gains s'additionnent sur le moteur (14 à 15 % au plus tout cumulé, selon la famille) et le total
// multiplie la puissance préparée de Mécanique · Préparation (src/data/enginePrep.ts, computePrep) :
// la conduite le lit là (src/drive/pilote.ts, performanceDe). Des chiffres d'atelier pour le plaisir,
// pas une simulation. Les temps de référence des médailles restent ceux du véhicule d'origine.
//
// Dans le build, sans champ nouveau : parts.moteur_<pièce>_niveau (l'identifiant du niveau) ; l'origine
// n'est pas écrite, une valeur inconnue ou un niveau que le genre n'a pas retombent sur l'origine. Un
// niveau s'achète une fois (src/data/articles/moteur.ts) et vaut pour la même sorte de pièce sur tous
// les moteurs. Aucun véhicule ni aucune famille n'est nommé ici.

import { cleMoteur, familleById, type GenreOptimisation, type MoteurFamille, type MoteurPiece } from './moteurs.ts';
import type { Build, EngineSpec } from './vehicleTypes.ts';

export type { GenreOptimisation } from './moteurs.ts';

export type NiveauId = 'sport' | 'course';

export interface NiveauOptimisation {
  id: NiveauId;
  /** Nom d'atelier du niveau (inventé : aucune marque). */
  label: string;
  /** Le nom avec son article, pour les phrases : « les grosses soupapes ». */
  phrase: string;
  /** Ce que ça fait, en une ligne. */
  effet: string;
  /** Prix de l'article, en dollars (60 à 400 $). */
  prix: number;
  /** Gain de puissance, en pour cent de la puissance du moteur. */
  puissance: number;
}

export interface GenreSpec {
  id: GenreOptimisation;
  /** Ce qu'on travaille, pour la boutique : « Culasses ». */
  label: string;
  /** Niveaux au-dessus de l'origine, du plus doux au plus poussé. */
  niveaux: readonly NiveauOptimisation[];
}

/** L'origine : libre, jamais écrite. */
export const ORIGINE_NIVEAU = Object.freeze({ label: 'Origine', effet: 'Comme sorti d’usine' });

/** Les genres et leurs niveaux. Repères de prix : une course d'un tour rapporte 40 $ à 125 $. */
export const OPTIMISATIONS: Readonly<Record<GenreOptimisation, GenreSpec>> = Object.freeze({
  filtre: {
    id: 'filtre',
    label: 'Filtre à air',
    niveaux: [{ id: 'sport', label: 'Haut débit', phrase: 'l’élément haut débit', effet: 'Un élément en coton huilé : l’air passe sans forcer.', prix: 70, puissance: 2 }],
  },
  admission: {
    id: 'admission',
    label: 'Admission',
    niveaux: [
      { id: 'sport', label: 'Conduits polis', phrase: 'les conduits polis', effet: 'Passages ébavurés et polis : l’air entre sans traîner.', prix: 110, puissance: 2 },
      { id: 'course', label: 'Gros diamètre', phrase: 'le gros diamètre', effet: 'Tout est agrandi et accordé pour les hauts régimes.', prix: 220, puissance: 3 },
    ],
  },
  carburation: {
    id: 'carburation',
    label: 'Carburateur',
    niveaux: [
      { id: 'sport', label: 'Réglage fin', phrase: 'le réglage fin', effet: 'Cuve, aiguille et richesse réglées aux petits oignons.', prix: 120, puissance: 2 },
      { id: 'course', label: 'Venturi alésé', phrase: 'le venturi alésé', effet: 'Le carbu alésé et regiclé : il avale plus d’air.', prix: 240, puissance: 4 },
    ],
  },
  culasses: {
    id: 'culasses',
    label: 'Culasses',
    niveaux: [
      { id: 'sport', label: 'Sièges repris', phrase: 'les sièges repris', effet: 'Conduits polis, sièges de soupape retaillés.', prix: 150, puissance: 2 },
      { id: 'course', label: 'Grosses soupapes', phrase: 'les grosses soupapes', effet: 'Soupapes plus grandes, ressorts renforcés : ça respire en haut.', prix: 300, puissance: 4 },
    ],
  },
  echappement: {
    id: 'echappement',
    label: 'Collecteurs d’échappement',
    niveaux: [
      { id: 'sport', label: 'Brides lissées', phrase: 'les brides lissées', effet: 'Raccords alignés et lissés : les gaz sortent mieux.', prix: 130, puissance: 2 },
      { id: 'course', label: 'Tubes accordés', phrase: 'les tubes accordés', effet: 'Des tubes de même longueur : chaque cylindre se vide mieux.', prix: 260, puissance: 3 },
    ],
  },
  allumage: {
    id: 'allumage',
    label: 'Allumage',
    niveaux: [{ id: 'sport', label: 'Étincelle chaude', phrase: 'l’étincelle chaude', effet: 'Bobine renforcée, fils neufs : l’étincelle claque plus fort.', prix: 90, puissance: 2 }],
  },
});

/** Clé du build : parts.moteur_<pièce>_niveau. */
export const cleNiveau = (piece: string): string => `${cleMoteur(piece)}_niveau`;

/** Article de la boutique d'un niveau : un seul pour cette sorte de pièce, sur tous les moteurs. */
export const articleNiveau = (genre: GenreOptimisation, niveau: NiveauId): string => `piece-moteur-optimisation-${genre}-${niveau}`;

/** Niveaux d'une pièce au-dessus de l'origine ; vide : elle ne s'optimise pas. */
export function niveauxDe(piece: Pick<MoteurPiece, 'optimisation'>): readonly NiveauOptimisation[] {
  return piece.optimisation ? (OPTIMISATIONS[piece.optimisation]?.niveaux ?? []) : [];
}

/** Niveau posé sur une pièce ; `null` : l'origine (rien d'écrit, valeur inconnue, ou pièce qui ne s'optimise pas). */
export function resolveNiveau(piece: Pick<MoteurPiece, 'id' | 'optimisation'>, build: Pick<Build, 'parts'> | undefined): NiveauOptimisation | null {
  const wanted = build?.parts?.[cleNiveau(piece.id)];
  if (wanted === undefined) return null;
  return niveauxDe(piece).find((niveau) => niveau.id === wanted) ?? null;
}

/** Ce que le build gagne sur ce moteur, en pour cent, et le plus qu'il pourrait gagner. */
export function optimisationMoteur(famille: Pick<MoteurFamille, 'pieces'>, build: Pick<Build, 'parts'> | undefined): { pourcent: number; max: number } {
  let pourcent = 0;
  let max = 0;
  for (const piece of famille.pieces) {
    pourcent += resolveNiveau(piece, build)?.puissance ?? 0;
    max += Math.max(0, ...niveauxDe(piece).map((niveau) => niveau.puissance));
  }
  return { pourcent, max };
}

/**
 * Coefficient de puissance des pièces optimisées du moteur de ce véhicule (1 : rien d'optimisé, ou un
 * moteur sans modèle sur l'établi). Lu par computePrep, multiplié à celui de la préparation.
 */
export function coefficientPieces(engine: Pick<EngineSpec, 'model'> | undefined, build: Pick<Build, 'parts'> | undefined): number {
  const famille = engine?.model ? familleById(engine.model) : undefined;
  if (!famille || !build?.parts) return 1;
  return 1 + optimisationMoteur(famille, build).pourcent / 100;
}

/** Clés que « D'origine » efface en plus de celles de l'aspect : le niveau de chaque pièce qui s'optimise. */
export function clesOptimisation(famille: Pick<MoteurFamille, 'pieces'>): string[] {
  return famille.pieces.filter((piece) => niveauxDe(piece).length > 0).map((piece) => cleNiveau(piece.id));
}

/** Vrai si le build a posé un niveau (même inconnu) sur une pièce de ce moteur. */
export function optimisationTouchee(famille: Pick<MoteurFamille, 'pieces'>, build: Pick<Build, 'parts'> | undefined): boolean {
  return clesOptimisation(famille).some((key) => build?.parts?.[key] !== undefined);
}
