// Points d'intérêt de la pièce : un objet du décor qui ouvre un menu quand on appuie dessus (ou sur
// sa pastille). Ajouter un point, c'est une ligne ici : `target` est le nom de l'objet dans les
// données du garage (src/data/garageProps/, ou une enseigne néon de src/data/garage.ts), `icon` une
// icône de src/ui/icons.tsx, `action` ce que l'appui ouvre. La scène (src/scene/extras/) et les
// pastilles (src/ui/overlay/) ne connaissent aucun objet.

import type { EntryId } from './dockMenu.ts';

/** Icônes de src/ui/icons.tsx (IconName) que portent les pastilles. */
export type PieceIcon = 'radio' | 'moteur' | 'outils' | 'neon';

/** Ce que l'appui ouvre : un panneau (route) ou une entrée du dock (rouvert s'il est fermé). */
export type PieceAction = { kind: 'panneau'; sheet: 'radio' | 'capot' | 'reglages' } | { kind: 'entree'; entry: EntryId };

export interface PointInteret {
  /** Identifiant stable (attribut data-point de la pastille, tests). */
  id: string;
  /** Objet du décor visé, par son nom dans les données. */
  target: string;
  /** Nom du bouton, lu par les lecteurs d'écran et en bulle. */
  label: string;
  icon: PieceIcon;
  action: PieceAction;
  /** Ancre de la pastille, repère de la pièce (m) ; absente : sur l'objet, près de son centre. */
  at?: readonly [number, number, number];
}

export const POINTS_INTERET: readonly PointInteret[] = [
  { id: 'enceintes', target: 'placeholder_enceintes', label: 'Ouvrir la radio', icon: 'radio', action: { kind: 'panneau', sheet: 'radio' } },
  { id: 'bloc-moteur', target: 'placeholder_bloc_moteur', label: 'Préparer le moteur', icon: 'moteur', action: { kind: 'entree', entry: 'preparation' } },
  { id: 'etabli', target: 'placeholder_etabli', label: 'Sous le capot', icon: 'outils', action: { kind: 'panneau', sheet: 'capot' } },
  { id: 'servante', target: 'placeholder_servante', label: 'Sous le capot', icon: 'outils', action: { kind: 'panneau', sheet: 'capot' } },
  { id: 'neon', target: 'neon_pimpmybichon', label: 'Changer l’ambiance', icon: 'neon', action: { kind: 'entree', entry: 'ambiance' } },
  { id: 'enseigne', target: 'placeholder_enseigne_ronde', label: 'Changer l’ambiance', icon: 'neon', action: { kind: 'entree', entry: 'ambiance' } },
];
