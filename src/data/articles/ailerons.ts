// Articles de la boutique pour les ailerons (poste `aileron`) : ce qui se débloque avec des dollars.
// Convention (src/data/boutique.ts) : identifiant `piece-<poste>-<option>`, famille `piece` ; l'option
// d'origine n'est pas un article (elle est toujours libre). Nom et description viennent du catalogue
// des pièces (public/assets/shared/pieces/catalogue.json) ; seuls les prix sont ici. Une course d'un
// tour rapporte 40 à 125 $ (src/data/economie.ts) : le becquet se paie en une ou deux courses,
// l'aileron démesuré en quatre à huit.

import type { ArticleBoutique } from '../boutique.ts';
import { articlesDuPoste } from '../pieces.ts';

/** Prix de chaque option du poste `aileron`, en dollars. */
export const PRIX_AILERONS: Readonly<Record<string, number>> = Object.freeze({
  becquet: 80,
  queue_de_canard: 120,
  bas: 160,
  haut: 240,
  demesure: 360,
});

export const ARTICLES_AILERONS: readonly ArticleBoutique[] = articlesDuPoste('aileron', PRIX_AILERONS);
