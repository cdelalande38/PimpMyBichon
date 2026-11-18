// Articles de la boutique pour l'établi moteur (Mécanique · Moteur) : ce qui se débloque avec des dollars.
// Règle du commanditaire : l'origine (brut de fonderie) et la peinture haute température restent libres ;
// chaque autre traitement est UN article, qui vaut pour toutes les pièces de tous les moteurs, sur tous
// les véhicules ; chaque option d'échange qui n'est pas d'origine aussi (les filtres à air), quelle que
// soit la famille du moteur. Identifiants : src/data/moteurs.ts (articleTraitement, articleEchange).
// Repères de prix : une course d'un tour rapporte 40 $ à 125 $ (src/data/economie.ts) ; le noir satiné
// se paie en une course, le chrome en trois à six.

import type { ArticleBoutique } from '../boutique.ts';
import { articleEchange, articleTraitement, traitementById, type TraitementId } from '../moteurs.ts';

/** Prix de chaque traitement payant, en dollars. */
export const PRIX_TRAITEMENTS: Readonly<Partial<Record<TraitementId, number>>> = Object.freeze({
  noir_satine: 60,
  brosse: 90,
  poli: 160,
  anodise: 200,
  chrome: 260,
});

const DESCRIPTIONS: Readonly<Partial<Record<TraitementId, string>>> = {
  noir_satine: 'Un noir profond qui ne brille pas, sur la pièce de moteur que tu veux.',
  brosse: 'Le métal brossé, satiné et strié, sur n’importe quelle pièce de tes moteurs.',
  poli: 'L’alu poli comme un miroir, à la main, pièce par pièce.',
  anodise: 'Un métal teinté de la couleur de ton choix, comme sur les pièces de course.',
  chrome: 'Chrome ce que tu veux : carters, culasses, cache-culbuteurs… sur tous tes moteurs.',
};

/** Les échanges de pièces payants : pièce, option, nom, prix, description. */
export const ECHANGES_PAYANTS: readonly { piece: string; option: string; label: string; prix: number; description: string }[] = [
  { piece: 'filtres', option: 'coniques', label: 'Filtres coniques', prix: 80, description: 'Des filtres coniques en coton rouge à la place du boîtier d’origine, sur tous tes moteurs.' },
  { piece: 'filtres', option: 'cornets', label: 'Cornets d’admission', prix: 120, description: 'Des cornets chromés à la place du filtre : le carbu respire à l’air libre.' },
];

export const ARTICLES_MOTEUR: readonly ArticleBoutique[] = [
  ...Object.entries(PRIX_TRAITEMENTS).map(([id, prix]) => ({
    id: articleTraitement(id),
    famille: 'piece' as const,
    label: `Moteur · ${traitementById(id)?.label ?? id}`,
    prix: prix ?? null,
    description: DESCRIPTIONS[id as TraitementId] ?? '',
  })),
  ...ECHANGES_PAYANTS.map((item) => ({ id: articleEchange(item.piece, item.option), famille: 'piece' as const, label: item.label, prix: item.prix, description: item.description })),
];
