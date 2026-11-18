// Articles de la boutique pour l’échappement (poste `echappement`) : ce qui se débloque avec des dollars.
// Convention (src/data/boutique.ts) : identifiant `piece-<poste>-<option>`, famille `piece` ; l'option
// d'origine n'est pas un article (elle est toujours libre). Les lignes et les finitions sont décrites
// dans src/data/echappement.ts ; un article acquis vaut pour tous les véhicules. Repères de prix : une
// course d'un tour rapporte 40 $ à 125 $ (src/data/economie.ts).

import { articleFinition, articleLigne } from '../echappement.ts';
import type { ArticleBoutique } from '../boutique.ts';

export const ARTICLES_ECHAPPEMENT: readonly ArticleBoutique[] = [
  { id: articleLigne('feutree'), famille: 'piece', label: 'Ligne feutrée', prix: 60, description: 'Un gros silencieux : ton moteur ronronne, discret, sans perdre ses graves.' },
  { id: articleLigne('sport'), famille: 'piece', label: 'Ligne sport', prix: 140, description: 'Plus grave et plus ouverte : le moteur respire et ça s’entend.' },
  { id: articleLigne('libre'), famille: 'piece', label: 'Ligne libre', prix: 260, description: 'Sans silencieux : rauque, plus fort, et ça crache des flammes au lever de pied.' },
  { id: articleFinition('noir'), famille: 'piece', label: 'Sorties noires', prix: 70, description: 'Des sorties en céramique noire satinée, pour une allure plus méchante.' },
  { id: articleFinition('bleui'), famille: 'piece', label: 'Sorties bleuies', prix: 110, description: 'Des sorties en titane passé au feu, bleu violet comme sur les motos de course.' },
];
