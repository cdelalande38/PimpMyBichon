// Pictogrammes des cartes de l'écran « Jouer » (src/data/modes.ts) : un trait, 24 × 24, à la couleur du texte.
// Un mode de plus, c'est une ligne ici ; sans dessin, la carte garde son nom.

import type { ModeId } from '../../../data/modes.ts';

const TRAITS: Readonly<Record<ModeId | 'continuer', string>> = {
  continuer: 'M8 5.5v13l10.5-6.5z',
  carriere: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4',
  course: 'M6 21V4M6 5h12l-2.5 3.5L18 12H6',
  duel: 'M4 8h13l-3-3M20 16H7l3 3',
  drift: 'M4 18c7 0 11-3 12-9M16 9l-.5-4M16 9l4-1M4 21h5M13 21h7',
  balade: 'M9 4 5 20M15 4l4 16M12 6v2M12 11v3M12 17v3',
  rodeo: 'M4 12h16M15 7l5 5-5 5',
};

export function PictoMode({ id }: { id: ModeId | 'continuer' }) {
  return (
    <svg className="jouer-picto" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={TRAITS[id]} />
    </svg>
  );
}
