// Articles de la boutique pour la préparation du véhicule (pneus et assiette) : ce qui se débloque avec
// des dollars. Convention (src/data/boutique.ts) : identifiant `piece-<poste>-<option>`, famille `piece` ;
// pour l'assiette, le poste est son curseur (`assiette`). Ce qui était libre le reste : les quatre pneus
// de toujours et les trois assiettes d'avant (origine, rabaissée, posée au sol). Un article acquis vaut
// pour tous les véhicules. Repères de prix : une course d'un tour rapporte 40 $ à 125 $ (src/data/economie.ts).

import type { ArticleBoutique } from '../boutique.ts';
import { ARTICLE_REHAUSSE, articlePneu } from '../preparation.ts';

export const ARTICLES_PREPARATION: readonly ArticleBoutique[] = [
  { id: articlePneu('piste'), famille: 'piece', label: 'Slicks', prix: 180, description: 'La gomme lisse des circuits : imbattable au sec, une savonnette sous la pluie.' },
  { id: ARTICLE_REHAUSSE, famille: 'piece', label: 'Assiette rehaussée', prix: 120, description: 'Des ressorts plus longs : la caisse monte, passe mieux sur la neige, roule un peu plus.' },
];
