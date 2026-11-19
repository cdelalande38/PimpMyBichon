// Articles de la boutique pour les néons (postes `neon_<zone>`) : ce qui se débloque avec des dollars.
// Convention (src/data/boutique.ts) : identifiant `piece-neon-<zone>`, famille `piece`. Une zone par
// genre de véhicule est libre, pour essayer (l'avant d'une voiture, le cadre d'une moto : src/data/neons.ts,
// `libre`) : elle n'est pas un article. Un achat vaut pour tous les véhicules qui ont la zone. Prix lus
// avec les gains de src/data/economie.ts (une course d'un tour rapporte de 40 $ à 125 $) : d'une à trois
// courses par zone.

import type { ArticleBoutique } from '../boutique.ts';
import { articleNeon } from '../neons.ts';

const id = (zone: string): string => articleNeon(zone) ?? `piece-neon-${zone}`;

export const ARTICLES_NEONS: readonly ArticleBoutique[] = [
  { id: id('flancs'), famille: 'piece', label: 'Néons des flancs', prix: 180, description: 'Deux tubes sous les bas de caisse : la voiture flotte sur sa lueur.' },
  { id: id('arriere'), famille: 'piece', label: 'Néon arrière', prix: 100, description: 'Un tube sous le bouclier arrière, qui colore la route derrière toi.' },
  { id: id('roues'), famille: 'piece', label: 'Néons des roues', prix: 150, description: 'La lueur dans les passages de roue, ou autour des jantes d’une moto.' },
  { id: id('habitacle'), famille: 'piece', label: 'LED d’habitacle', prix: 90, description: 'Des rubans sous la planche et sur les portes : l’habitacle prend ta couleur.' },
];
