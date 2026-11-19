// La boutique : ce qui se débloque avec des dollars, en données. Rien ne s'achète ici qui n'existe pas :
// les entrées du menu encore marquées « bientôt » restent « bientôt » (elles n'ont pas d'article).
// Les pièces de véhicule ont leurs articles dans src/data/articles/ (un fichier par poste).
// Ce qui est libre aujourd'hui (peinture, roues, suspension, intérieur, ambiance, les quatre cartes) reste
// gratuit et n'est pas une marchandise.
//
// Identifiants convenus avec les stickers (src/data/stickers*) : un motif est utilisable si
// `possede('pack-<son pack>')` ou `possede('sticker-<son id>')` (src/jeu/bilan.ts).

import type { Article } from '../jeu/contrat.ts';
import { ARTICLES_AILERONS } from './articles/ailerons.ts';
import { ARTICLES_CARROSSERIE } from './articles/carrosserie.ts';
import { ARTICLES_ECHAPPEMENT } from './articles/echappement.ts';
import { ARTICLES_MOTEUR } from './articles/moteur.ts';
import { ARTICLES_NEONS } from './articles/neons.ts';
import { ARTICLES_PHARES } from './articles/phares.ts';
import { ARTICLES_PREPARATION } from './articles/preparation.ts';

export interface ArticleBoutique extends Article {
  /** Une phrase tutoyée : ce que ça apporte. */
  description: string;
  /** Acquis dès le premier lancement (prix nul, jamais proposé à l'achat). */
  offert?: boolean;
}

/**
 * Les packs de stickers. Le pack de départ est offert ; les autres s'achètent. Les prix se lisent avec
 * les gains de `ECONOMIE` (src/data/economie.ts) : environ 3, 5 puis 8 courses d'un tour avec médaille.
 */
export const PACKS: readonly ArticleBoutique[] = [
  { id: 'pack-depart', famille: 'pack', label: 'Pack Départ', prix: 0, offert: true, description: 'Les bandes, le damier, les numéros : de quoi habiller ton premier véhicule.' },
  { id: 'pack-flammes', famille: 'pack', label: 'Pack Flammes', prix: 150, description: 'Des flammes pour le capot et les flancs, de la braise au grand brasier.' },
  { id: 'pack-course', famille: 'pack', label: 'Pack Course', prix: 300, description: 'L’allure d’une voiture d’atelier qui a déjà gagné : bandes larges, écussons, numéros de course.' },
  { id: 'pack-atelier', famille: 'pack', label: 'Pack Atelier', prix: 500, description: 'Les autocollants de la maison : outils, étincelles et fausses marques de pièces inventées.' },
  { id: 'pack-rue', famille: 'pack', label: 'Pack Rue', prix: 250, description: 'Graffitis, éclaboussures, griffes et crânes : l’allure d’une voiture qui n’a pas peur du bitume.' },
  { id: 'pack-tapis', famille: 'pack', label: 'Pack Tapis vert', prix: 200, description: 'Dés et cartes à jouer : pour les chanceux, et pour ceux qui font semblant de l’être.' },
];

/**
 * Stickers de trophée : ils ne s'achètent pas (prix nul), un haut fait les offre (src/data/hautsFaits.ts).
 * L'identifiant de l'article est `sticker-<id du motif>` : les motifs du même nom sont à ranger du côté
 * des stickers (src/data/stickers*).
 */
export const TROPHEES: readonly ArticleBoutique[] = [
  { id: 'sticker-trophee-or', famille: 'sticker', label: 'Trophée d’or', prix: null, description: 'Gagné avec une première médaille d’or.' },
  { id: 'sticker-trophee-series', famille: 'sticker', label: 'Trophée des séries', prix: null, description: 'Gagné en finissant vingt-cinq courses.' },
  { id: 'sticker-trophee-propre', famille: 'sticker', label: 'Trophée du pilote propre', prix: null, description: 'Gagné avec trois tours sans toucher le bord.' },
  { id: 'sticker-trophee-vitesse', famille: 'sticker', label: 'Trophée de vitesse', prix: null, description: 'Gagné avec une pointe à 200 km/h.' },
  { id: 'sticker-trophee-glisse', famille: 'sticker', label: 'Trophée de la glisse', prix: null, description: 'Gagné avec une très longue glisse.' },
  { id: 'sticker-trophee-neige', famille: 'sticker', label: 'Trophée des neiges', prix: null, description: 'Gagné en finissant une course sous la neige.' },
  { id: 'sticker-trophee-route', famille: 'sticker', label: 'Trophée du grand voyage', prix: null, description: 'Gagné en roulant cent kilomètres en tout.' },
  { id: 'sticker-trophee-cartes', famille: 'sticker', label: 'Trophée des cartes', prix: null, description: 'Gagné en ayant couru sur toutes les cartes.' },
  { id: 'sticker-eclair-triangle', famille: 'sticker', label: 'Éclair en triangle', prix: null, description: 'Gagné en passant 160 km/h en course.' },
  { id: 'sticker-eclair-pluie', famille: 'sticker', label: 'Pluie d’éclairs', prix: null, description: 'Gagné en finissant une course sous la pluie.' },
  { id: 'sticker-aile-seule', famille: 'sticker', label: 'Grande aile', prix: null, description: 'Gagné en roulant dix kilomètres en tout.' },
  { id: 'sticker-tribal-lame', famille: 'sticker', label: 'Lame tribale', prix: null, description: 'Gagné en lançant vingt poussées de NOS.' },
  { id: 'sticker-drapeaux-croises', famille: 'sticker', label: 'Drapeaux croisés', prix: null, description: 'Gagné en bouclant la carrière.' },
  { id: 'sticker-etincelles', famille: 'sticker', label: 'Étincelles', prix: null, description: 'Gagné en battant cinq fois tes records.' },
  { id: 'sticker-graffiti-fleche', famille: 'sticker', label: 'Flèche en S', prix: null, description: 'Gagné en finissant un premier parcours de drift.' },
  { id: 'sticker-graffiti-gaz', famille: 'sticker', label: 'Graffiti Gaz', prix: null, description: 'Gagné avec l’argent ou mieux en drift.' },
  { id: 'sticker-etoile-laurier', famille: 'sticker', label: 'Étoile aux lauriers', prix: null, description: 'Gagné avec l’or en drift.' },
  { id: 'sticker-couronne-laurier', famille: 'sticker', label: 'Couronne de laurier', prix: null, description: 'Gagnée en bouclant la deuxième saison de la carrière.' },
  { id: 'sticker-coupe-or', famille: 'sticker', label: 'Coupe d’or', prix: null, description: 'Gagnée avec l’or sur toute la deuxième saison.' },
];

/**
 * Les pièces et options de véhicule qui se débloquent : un fichier par poste dans src/data/articles/.
 * Convention : identifiant `piece-<poste>-<option>` (le poste et l'option sont ceux de `Build.parts`,
 * src/data/vehicleTypes.ts), famille `piece`. L'option d'origine n'est jamais un article. Une option
 * dont l'article n'est pas acquis se voit, avec son cadenas et son prix ; elle se débloque sur place
 * par le bloc d'achat partagé (src/ui/jeu/Achat.tsx), et `usePossede` (src/state/jeu.ts) dit si elle l'est.
 */
export const PIECES: readonly ArticleBoutique[] = [...ARTICLES_AILERONS, ...ARTICLES_PHARES, ...ARTICLES_ECHAPPEMENT, ...ARTICLES_MOTEUR, ...ARTICLES_CARROSSERIE, ...ARTICLES_PREPARATION, ...ARTICLES_NEONS];

/** Tout ce que le jeu sait posséder. */
export const ARTICLES: readonly ArticleBoutique[] = [...PACKS, ...TROPHEES, ...PIECES];

export function articleParId(id: string): ArticleBoutique | undefined {
  return ARTICLES.find((article) => article.id === id);
}

/** Articles proposés à l'achat : un prix, et pas offerts d'office. */
export const A_VENDRE: readonly ArticleBoutique[] = ARTICLES.filter((article) => article.prix !== null && article.prix > 0 && !article.offert);
