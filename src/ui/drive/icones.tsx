// Icônes de la sortie de nuit, dessinées pour l'app (SVG en trait, couleur du texte), sur le modèle
// de src/ui/icons.tsx : aucune bibliothèque, aucun emoji, rien qui rappelle une marque.

import type { ReactNode } from 'react';

export type DriveIconName = 'camera' | 'realisateur' | 'auto' | 'main' | 'ralenti' | 'sec' | 'pluie' | 'pause' | 'lecture' | 'garage';

const SHAPES: Record<DriveIconName, ReactNode> = {
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
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  lecture: <path d="M7.5 4.5v15l12-7.5Z" />,
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
