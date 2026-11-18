// Clôture d'une course : le cœur pur. D'après le résultat, l'état et les règles, il rend le nouvel état
// et le bilan. L'enregistrement (le store sauvegardé) est dans src/jeu/bilan.ts.

import { articleParId } from '../data/boutique.ts';
import { HAUTS_FAITS, type HautFaitDef } from '../data/hautsFaits.ts';
import { MAPS } from '../data/maps.ts';
import type { Article, Bilan, ResultatCourse } from './contrat.ts';
import type { Cumuls, EtatJeu } from './etat.ts';
import { calculerGains, recordBattu } from './gains.ts';
import { nouveauxHautsFaits, visible } from './hautsFaits.ts';

export interface ReglesCloture {
  defs: readonly HautFaitDef[];
  nbCartes: number;
  /** Cherche un article par son identifiant (la boutique) ; `undefined` : inconnu. */
  article: (id: string) => Article | undefined;
}

export const REGLES_PAR_DEFAUT: ReglesCloture = {
  defs: HAUTS_FAITS,
  nbCartes: MAPS.length,
  article: articleParId,
};

/** Les cumuls d'après une course de plus. */
export function ajouterCourse(cumuls: Cumuls, resultat: ResultatCourse, dollars: number, record: boolean): Cumuls {
  const { stats } = resultat;
  return {
    courses: cumuls.courses + 1,
    coursesTrois: cumuls.coursesTrois + (resultat.format === 'tours3' ? 1 : 0),
    distance: cumuls.distance + Math.max(0, stats.distance),
    glisse: cumuls.glisse + Math.max(0, stats.glisse),
    chocs: cumuls.chocs + Math.max(0, stats.chocs),
    nos: cumuls.nos + Math.max(0, stats.nos),
    bronze: cumuls.bronze + (resultat.medaille === 'bronze' ? 1 : 0),
    argent: cumuls.argent + (resultat.medaille === 'argent' ? 1 : 0),
    or: cumuls.or + (resultat.medaille === 'or' ? 1 : 0),
    records: cumuls.records + (record ? 1 : 0),
    sansChoc: cumuls.sansChoc + (stats.chocs === 0 ? 1 : 0),
    pluie: cumuls.pluie + (resultat.meteo === 'pluie' ? 1 : 0),
    neige: cumuls.neige + (resultat.meteo === 'neige' ? 1 : 0),
    jour: cumuls.jour + (resultat.moment === 'jour' ? 1 : 0),
    vitesseMax: Math.max(cumuls.vitesseMax, stats.vitesseMax),
    gains: cumuls.gains + dollars,
    achats: cumuls.achats,
    cartes: { ...cumuls.cartes, [resultat.carte]: true },
    vehicules: { ...cumuls.vehicules, [resultat.vehicule]: true },
  };
}

/** Accorde des hauts faits : leurs dollars et leurs articles (un article déjà possédé n'est ni redonné ni listé). */
export function accorder(etat: EtatJeu, obtenus: readonly HautFaitDef[], regles: ReglesCloture = REGLES_PAR_DEFAUT): { etat: EtatJeu; deblocages: Article[] } {
  let solde = etat.solde;
  const hautsFaits = { ...etat.hautsFaits };
  const articles = { ...etat.articles };
  const deblocages: Article[] = [];
  for (const def of obtenus) {
    hautsFaits[def.id] = true;
    solde += Math.max(0, Math.floor(def.recompense.dollars ?? 0));
    for (const id of def.recompense.articles ?? []) {
      const article = regles.article(id);
      if (!article || articles[id]) continue;
      articles[id] = true;
      deblocages.push(article);
    }
  }
  return { etat: { ...etat, solde, hautsFaits, articles }, deblocages };
}

/**
 * Bilan d'une course finie et nouvel état : gains, cumuls, hauts faits obtenus (avec leurs dollars et
 * leurs articles). Ne modifie pas `etat`.
 */
export function cloturer(etat: EtatJeu, resultat: ResultatCourse, regles: ReglesCloture = REGLES_PAR_DEFAUT): { etat: EtatJeu; bilan: Bilan } {
  const gains = calculerGains(resultat);
  const record = recordBattu(resultat);
  const cumuls = ajouterCourse(etat.cumuls, resultat, gains.dollars, record);
  const obtenus = nouveauxHautsFaits({ resultat, record, cumuls, nbCartes: regles.nbCartes }, etat.hautsFaits, regles.defs);
  const { etat: accorde, deblocages } = accorder({ ...etat, solde: etat.solde + gains.dollars, cumuls }, obtenus, regles);
  return { etat: accorde, bilan: { resultat, gains, solde: accorde.solde, hautsFaits: obtenus.map(visible), deblocages } };
}

/** Hauts faits que les seuls cumuls font obtenir (après un achat) : les conditions sur la course ne tiennent pas. */
export function verifierCumuls(etat: EtatJeu, regles: ReglesCloture = REGLES_PAR_DEFAUT): { etat: EtatJeu; hautsFaits: HautFaitDef[]; deblocages: Article[] } {
  const obtenus = nouveauxHautsFaits({ record: false, cumuls: etat.cumuls, nbCartes: regles.nbCartes }, etat.hautsFaits, regles.defs);
  if (obtenus.length === 0) return { etat, hautsFaits: [], deblocages: [] };
  const { etat: accorde, deblocages } = accorder(etat, obtenus, regles);
  return { etat: accorde, hautsFaits: obtenus, deblocages };
}
