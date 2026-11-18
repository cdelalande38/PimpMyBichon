// Articles de la boutique pour le kit carrosserie (postes `lame`, `jupes` et `diffuseur`, groupe
// « carrosserie » du catalogue des pièces) : ce qui se débloque avec des dollars. Convention
// (src/data/boutique.ts) : identifiant `piece-<poste>-<option>`, famille `piece` ; l'absence de pièce
// n'est jamais un article (elle est toujours libre). Nom et description viennent du catalogue
// (public/assets/shared/pieces/catalogue.json) ; seuls les prix sont ici. Une course d'un tour
// rapporte 40 à 125 $ (src/data/economie.ts) : la lame discrète se paie en une ou deux courses, la
// lame de course ou les jupes larges en trois à six. Le capot moteur (poste `capot`, vague U) : le
// déposer coûte la main-d'œuvre, la vitre fumée et son cadre chromé coûtent plus ; le capot d'origine
// reste libre.

import type { ArticleBoutique } from '../boutique.ts';
import { articlesDuPoste } from '../pieces.ts';

/** Prix des options de chaque poste du kit, en dollars. */
export const PRIX_CARROSSERIE: Readonly<Record<string, Readonly<Record<string, number>>>> = Object.freeze({
  lame: Object.freeze({ discrete: 80, sport: 160, course: 280 }),
  jupes: Object.freeze({ fines: 90, sport: 170, larges: 260 }),
  diffuseur: Object.freeze({ simple: 120, ailettes: 220 }),
  capot: Object.freeze({ vitre: 240, sans: 140 }),
});

export const ARTICLES_CARROSSERIE: readonly ArticleBoutique[] = Object.entries(PRIX_CARROSSERIE).flatMap(([poste, prix]) => articlesDuPoste(poste, prix));
