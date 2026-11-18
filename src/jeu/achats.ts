// Posséder et acheter : un cœur pur sur l'état du jeu. Le store (src/state/jeu.ts) l'applique.

import { articleParId } from '../data/boutique.ts';
import type { Article } from './contrat.ts';
import type { EtatJeu } from './etat.ts';

/** Vrai si l'article est acquis : gagné ou acheté, ou offert d'office (prix nul). Un inconnu n'est pas possédé. */
export function possedeDans(etat: Pick<EtatJeu, 'articles'>, id: string, article: (id: string) => Article | undefined = articleParId): boolean {
  if (etat.articles[id]) return true;
  return article(id)?.prix === 0;
}

export type IssueAchat =
  | { ok: true; etat: EtatJeu; article: Article }
  /** `manque` : les dollars qui font défaut. */
  | { ok: false; raison: 'insuffisant'; manque: number }
  | { ok: false; raison: 'deja' | 'inconnu' | 'pas-a-vendre' };

/** Achète un article au prix de la boutique. Ne modifie pas `etat`. */
export function acheterDans(etat: EtatJeu, id: string, article: (id: string) => Article | undefined = articleParId): IssueAchat {
  const cible = article(id);
  if (!cible) return { ok: false, raison: 'inconnu' };
  if (possedeDans(etat, id, article)) return { ok: false, raison: 'deja' };
  if (cible.prix === null || cible.prix <= 0) return { ok: false, raison: 'pas-a-vendre' };
  if (etat.solde < cible.prix) return { ok: false, raison: 'insuffisant', manque: cible.prix - etat.solde };
  return {
    ok: true,
    article: cible,
    etat: {
      ...etat,
      solde: etat.solde - cible.prix,
      articles: { ...etat.articles, [id]: true },
      cumuls: { ...etat.cumuls, achats: etat.cumuls.achats + 1 },
    },
  };
}
