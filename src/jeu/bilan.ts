// Clôture d'une course et accès à ce qui se possède. Souche posée avec le contrat (src/jeu/contrat.ts) :
// aucune économie n'est encore branchée, une course ne rapporte rien et tout est accessible.
import type { Bilan, ResultatCourse } from './contrat.ts';

/** Calcule et enregistre le bilan d'une course finie : gains, hauts faits, déblocages. */
export function cloturerCourse(resultat: ResultatCourse): Bilan {
  return { resultat, gains: { dollars: 0, detail: [] }, solde: 0, hautsFaits: [], deblocages: [] };
}

/** Vrai si l'article est acquis (acheté, gagné, ou gratuit). */
export function possede(article: string): boolean {
  void article;
  return true;
}
