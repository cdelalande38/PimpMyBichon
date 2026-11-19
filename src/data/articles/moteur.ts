// Articles de la boutique pour l'établi moteur (Mécanique · Moteur) : ce qui se débloque avec des dollars.
// Règle du commanditaire : l'origine (brut de fonderie) et la peinture haute température restent libres ;
// chaque autre traitement est UN article, qui vaut pour toutes les pièces de tous les moteurs, sur tous
// les véhicules ; chaque option d'échange qui n'est pas d'origine aussi (les filtres à air), quelle que
// soit la famille du moteur. Identifiants : src/data/moteurs.ts (articleTraitement, articleEchange).
// Repères de prix : une course d'un tour rapporte 40 $ à 125 $ (src/data/economie.ts) ; le noir satiné
// se paie en une course, le chrome en trois à six. Les niveaux d'optimisation (prix et gains dans
// src/data/optimisation.ts) suivent la même règle : un article par niveau, pour tous les moteurs. La fiche
// de préparation (Mécanique · Préparation, src/data/enginePrep.ts) aussi : chaque option au-dessus de
// l'origine (reprogrammation, carburation, nitro) est un article, pour tous les véhicules.

import type { ArticleBoutique } from '../boutique.ts';
import { articleEchange, articleTraitement, traitementById, type TraitementId } from '../moteurs.ts';
import { articlePrep, ENGINE_SLOTS } from '../enginePrep.ts';
import { articleNiveau, OPTIMISATIONS } from '../optimisation.ts';

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
  // Optimisation (src/data/optimisation.ts) : chaque niveau au-dessus de l'origine est un article, qui
  // vaut pour la même sorte de pièce sur tous les moteurs (les culasses de la Cox comme celles du V8).
  ...Object.values(OPTIMISATIONS).flatMap((genre) =>
    genre.niveaux.map((niveau) => ({
      id: articleNiveau(genre.id, niveau.id),
      famille: 'piece' as const,
      label: `${genre.label} · ${niveau.label}`,
      prix: niveau.prix,
      description: `${niveau.effet} + ${niveau.puissance} % de puissance, sur tous tes moteurs.`,
    })),
  ),
  // Fiche de préparation : chaque option d'un poste, hors origine, au prix de ses données.
  ...ENGINE_SLOTS.flatMap((slot) =>
    slot.options.map((option) => ({
      id: articlePrep(slot.id, option.id),
      famille: 'piece' as const,
      label: `${slot.label} · ${option.label}`,
      prix: option.prix,
      description: `${option.hint}. Un seul achat, et c’est monté sur tous tes véhicules.`,
    })),
  ),
];
