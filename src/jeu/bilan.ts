// Clôture d'une course et accès à ce qui se possède (contrat : src/jeu/contrat.ts). Le calcul est pur
// (src/jeu/cloture.ts) ; ce fichier l'enregistre dans l'état sauvegardé (src/state/jeu.ts).
import { useJeu, etatDe } from '../state/jeu.ts';
import { possedeDans } from './achats.ts';
import { cloturer } from './cloture.ts';
import type { Bilan, ResultatCourse } from './contrat.ts';

/** Bilans déjà rendus : clore deux fois le même résultat (rendu double, nouvel essai) ne paie qu'une fois. */
const clos = new WeakMap<ResultatCourse, Bilan>();

/** Calcule et enregistre le bilan d'une course finie : gains, hauts faits, déblocages. */
export function cloturerCourse(resultat: ResultatCourse): Bilan {
  const connu = clos.get(resultat);
  if (connu) return connu;
  const { etat, bilan } = cloturer(etatDe(useJeu.getState()), resultat);
  useJeu.getState().appliquer(etat);
  clos.set(resultat, bilan);
  return bilan;
}

/** Vrai si l'article est acquis (acheté, gagné, ou gratuit). */
export function possede(article: string): boolean {
  return possedeDans(useJeu.getState(), article);
}
