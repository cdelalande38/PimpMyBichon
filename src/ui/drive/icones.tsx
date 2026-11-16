// Icônes de la sortie de nuit, dessinées pour l'app (SVG en trait, couleur du texte), sur le modèle
// de src/ui/icons.tsx : aucune bibliothèque, aucun emoji, rien qui rappelle une marque.

import type { ReactNode } from 'react';

export type DriveIconName =
  | 'camera'
  | 'realisateur'
  | 'auto'
  | 'main'
  | 'ralenti'
  | 'sec'
  | 'pluie'
  | 'neige'
  | 'pause'
  | 'lecture'
  | 'garage'
  | 'moteur'
  | 'moteurCoupe'
  | 'nos'
  | 'monter'
  | 'descendre'
  | 'manche'
  | 'pedales'
  | 'manette';

// Bloc moteur vu de côté : carter, bouchon de remplissage, échappement à droite, ventilateur à gauche.
const BLOC = 'M6 9h2.5l1.5-2h5l1.5 2H18v8.5h-1.5L15 19H9l-1.5-1.5H6Z M10 7V4.5h4V7 M18 12h2.5v3H18 M6 12.25H3.5 M3.5 10v4.5';

const SHAPES: Record<DriveIconName, ReactNode> = {
  // Manche : l'anneau, le bouton au milieu, les quatre repères.
  manche: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M12 1.5v2M12 20.5v2M1.5 12h2M20.5 12h2" />
    </>
  ),
  // Deux pédales striées, côte à côte.
  pedales: (
    <>
      <rect x="3.5" y="6" width="7" height="13" rx="1.5" />
      <rect x="13.5" y="4" width="7" height="15" rx="1.5" />
      <path d="M5.5 10h3M5.5 13h3M5.5 16h3M15.5 8h3M15.5 11h3M15.5 14h3" />
    </>
  ),
  // Manette tenue à deux mains, en travers : un manche à gauche, deux boutons à droite.
  manette: (
    <>
      <path d="M7 7h10a5 5 0 0 1 4.8 6.4l-1 3.3a2.4 2.4 0 0 1-4.1.9L14.5 15h-5l-2.2 2.6a2.4 2.4 0 0 1-4.1-.9l-1-3.3A5 5 0 0 1 7 7Z" />
      <circle cx="8" cy="11" r="1.8" />
      <path d="M15.5 10.5h.01M18 12.5h.01" />
    </>
  ),
  // Caméra de tournage : boîtier et pare-soleil.
  camera: (
    <>
      <rect x="3" y="7.5" width="12" height="9" rx="1.5" />
      <path d="m15 10.5 5.5-3v9l-5.5-3" />
    </>
  ),
  // Clap : l'ardoise et sa barre rayée.
  realisateur: (
    <>
      <rect x="3.5" y="10" width="17" height="10" rx="1" />
      <path d="m3.5 10 1.6-5.2 15.4 2.4-.9 2.8M8.6 5.3 7.3 9.8M13.4 6.1l-1.3 3.9" />
    </>
  ),
  // Pilote automatique : la route qui file vers l'horizon.
  auto: (
    <>
      <path d="M9.5 4 4 20M14.5 4 20 20M12 6v2.5M12 11.5v2.5M12 17v3" />
    </>
  ),
  // Conduite à la main : volant.
  main: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="2.2" />
      <path d="M3.8 10.6 9.9 11.4M20.2 10.6l-6.1.8M12 14.2v6.3" />
    </>
  ),
  // Ralenti : un sablier.
  ralenti: (
    <>
      <path d="M7 3.5h10M7 20.5h10M8 3.5c0 5 8 5.5 8 8.5s-8 3.5-8 8.5M16 3.5c0 5-8 5.5-8 8.5s8 3.5 8 8.5" />
    </>
  ),
  // Temps sec, de nuit : un croissant de lune.
  sec: <path d="M15.5 4.5a8 8 0 1 0 4 12.5 6.5 6.5 0 0 1-4-12.5Z" />,
  // Pluie : trois traits obliques sous un nuage.
  pluie: (
    <>
      <path d="M7 14.5a4 4 0 0 1 .4-8 5 5 0 0 1 9.4 1.4 3.4 3.4 0 0 1-.3 6.6Z" />
      <path d="m8.5 17-1.2 3M12.5 17l-1.2 3M16.5 17l-1.2 3" />
    </>
  ),
  // Neige : un flocon à six branches.
  neige: <path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M10 4.5l2 2 2-2M10 19.5l2-2 2 2M4.6 10.2l2.7-.7-.7-2.7M19.4 13.8l-2.7.7.7 2.7M4.6 13.8l2.7.7-.7 2.7M19.4 10.2l-2.7-.7.7-2.7" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  lecture: <path d="M7.5 4.5v15l12-7.5Z" />,
  // Son du moteur : le bloc ; coupé, barré.
  moteur: <path d={BLOC} />,
  moteurCoupe: (
    <>
      <path d={BLOC} />
      <path d="m3.5 4 17 16" />
    </>
  ),
  // NOS : la bouteille, son robinet, et la flamme qui sort.
  nos: (
    <>
      <rect x="4" y="8" width="7" height="12.5" rx="3" />
      <path d="M6.5 8V5.5h2V8M8.5 5.5H12M15 14.5c1.5-1.3 1.7-3 1-5 2.6 1.4 4 3.5 4 6a4.5 4.5 0 0 1-9 0c0-1 .3-1.8.8-2.6.4 1.4 1.4 2 3.2 1.6Z" />
    </>
  ),
  // Chevrons : rappeler la barre, la replier.
  monter: <path d="m6 15 6-6 6 6" />,
  descendre: <path d="m6 9 6 6 6-6" />,
  // Porte de garage : le linteau et les lames.
  garage: (
    <>
      <path d="M3 9.5 12 4l9 5.5V20H3Z" />
      <path d="M6.5 12h11M6.5 15h11M6.5 18h11" />
    </>
  ),
};

export function DriveIcon({ name }: { name: DriveIconName }) {
  return (
    <svg className="drive-icon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      {SHAPES[name]}
    </svg>
  );
}
