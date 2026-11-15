// Icônes de l'atelier, dessinées pour l'app (SVG en trait, couleur du texte) : aucune bibliothèque,
// aucun emoji, rien qui rappelle une marque. Les points d'intérêt de la pièce les nomment dans
// src/data/pointsInteret.ts ; les boutons ronds du haut de l'écran s'en servent aussi.

import type { ReactNode } from 'react';

export type IconName = 'radio' | 'photo' | 'atelier' | 'moteur' | 'outils' | 'neon' | 'volant';

const SHAPES: Record<Exclude<IconName, 'radio'>, ReactNode> = {
  // Volant : jante, moyeu, trois branches. La vue intérieure, à l'œil du conducteur.
  volant: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M3.8 10.6 9.9 11.4M20.2 10.6l-6.1.8M12 14.2v6.3" />
    </>
  ),
    // Appareil photo : boîtier, viseur, objectif.
  photo: (
    <>
      <path d="M3 8.5a2 2 0 0 1 2-2h2.6l1.6-2.5h5.6l1.6 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3.8" />
    </>
  ),
  // Roue dentée : la configuration de l'atelier.
  atelier: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" />
      <circle cx="12" cy="12" r="6.6" />
    </>
  ),
  // Bloc moteur : carter, culasse, pipes.
  moteur: (
    <>
      <path d="M5 9h11l3 3v6H8l-3-3z" />
      <path d="M8 9V6h6v3M2.5 11v4M19 13.5h2.5" />
    </>
  ),
  // Clé plate : l'établi et la servante.
  outils: (
    <path d="M14.5 3.5a4.5 4.5 0 0 0-4.2 6.1L3.5 16.4l4.1 4.1 6.8-6.8a4.5 4.5 0 0 0 6.1-4.2l-2.8 2.8-3.3-.8-.8-3.3z" />
  ),
  // Tube néon tordu en éclair, et son halo.
  neon: (
    <>
      <path d="M13.5 2.5 7 13h5l-1.5 8.5L17 11h-5z" />
      <path d="M4 5.5l1.5 1M20 5.5l-1.5 1M3.5 17h2M18.5 17h2" />
    </>
  ),
};

/**
 * Poste de radio : poignée, antenne, haut-parleur rond et trois barres d'égaliseur. `playing` les
 * anime (radio.css) ; elles restent figées si le téléphone demande moins de mouvement.
 */
function RadioShape({ playing }: { playing: boolean }) {
  return (
    <>
      <path d="M7 8V5.5h10V8M15.5 5.5l3.5-3.5" />
      <rect x="2.5" y="8" width="19" height="12.5" rx="2" />
      <circle cx="8.5" cy="14.25" r="3.4" />
      <g className="icon-eq" data-playing={playing}>
        <path d="M14.5 17.5v-3" />
        <path d="M16.75 17.5v-5" />
        <path d="M19 17.5v-2" />
      </g>
    </>
  );
}

export function Icon({ name, playing = false }: { name: IconName; playing?: boolean }) {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {name === 'radio' ? <RadioShape playing={playing} /> : SHAPES[name]}
    </svg>
  );
}
