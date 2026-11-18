// Articles de la boutique pour les phares (postes `phares` et `feux`) : ce qui se débloque avec des dollars.
// Convention (src/data/boutique.ts) : identifiant `piece-<poste>-<option>`, famille `piece` ; l'option
// d'origine n'est pas un article (elle est toujours libre). Les options elles-mêmes sont dans
// src/data/phares.ts ; la teinte fumée des optiques est un seul article, `piece-phares-fume`, qui
// débloque tout le curseur. Prix lus avec les gains de src/data/economie.ts (une course d'un tour
// rapporte de 40 $ à 125 $) : d'une à quatre courses.

import type { ArticleBoutique } from '../boutique.ts';
import { ARTICLE_TEINTE, articleCouleur, articleFeux } from '../phares.ts';

export const ARTICLES_PHARES: readonly ArticleBoutique[] = [
  { id: articleCouleur('froid'), famille: 'piece', label: 'Phares blanc froid', prix: 60, description: 'Une lumière blanche et nette, façon xénon : la route paraît plus froide.' },
  { id: articleCouleur('jaune'), famille: 'piece', label: 'Phares jaunes', prix: 80, description: 'Le jaune des vieux antibrouillards : chaud, rétro, et il perce la pluie.' },
  { id: articleCouleur('glacier'), famille: 'piece', label: 'Phares bleu glacier', prix: 120, description: 'Un bleu glacier qui claque dans les optiques et sur l’enrobé.' },
  { id: articleCouleur('violet'), famille: 'piece', label: 'Phares violets', prix: 160, description: 'Du violet franc, des optiques jusqu’à la route : on te voit arriver.' },
  { id: articleCouleur('vert'), famille: 'piece', label: 'Phares vert néon', prix: 160, description: 'Un vert néon qui ne passe pas inaperçu, la nuit, sur la route.' },
  { id: articleCouleur('rose'), famille: 'piece', label: 'Phares roses', prix: 160, description: 'Du rose bonbon, des optiques jusqu’au bitume.' },
  { id: ARTICLE_TEINTE, famille: 'piece', label: 'Optiques fumées', prix: 140, description: 'Les glaces des phares passent au fumé, de clair à très sombre, au curseur.' },
  { id: articleFeux('fumes'), famille: 'piece', label: 'Feux arrière fumés', prix: 100, description: 'Des feux arrière à glace sombre, qui restent bien rouges une fois allumés.' },
];
