// Icônes de l'atelier, dessinées pour l'app (SVG en trait, couleur du texte) : aucune bibliothèque,
// aucun emoji, rien qui rappelle une marque. Les points d'intérêt de la pièce les nomment dans
// src/data/pointsInteret.ts ; les boutons ronds du haut de l'écran s'en servent aussi, et le menu du
// bas en pose une sur chaque section, entrée et volet (src/data/dockMenu.ts, MenuIcon).

import type { ReactNode } from 'react';

export type IconName =
  | 'radio'
  | 'photo'
  | 'atelier'
  | 'moteur'
  | 'outils'
  | 'neon'
  | 'volant'
  | 'route'
  | 'voiture'
  | 'pistolet'
  | 'garage'
  | 'bombe'
  | 'jante'
  | 'pneu'
  | 'cote'
  | 'ressort'
  | 'siege'
  | 'pommeau'
  | 'etoiles'
  | 'sticker'
  | 'portiere'
  | 'phare'
  | 'aileron'
  | 'compteur'
  | 'echappement'
  | 'origine';

/** Rayons d'un moyeu vers la jante : `n` traits de `r1` à `r2` autour de (12, 12), le premier en haut. */
function rays(n: number, r1: number, r2: number): string {
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    d += `M${(12 + r1 * c).toFixed(2)} ${(12 + r1 * s).toFixed(2)}L${(12 + r2 * c).toFixed(2)} ${(12 + r2 * s).toFixed(2)}`;
  }
  return d;
}

const SHAPES: Record<Exclude<IconName, 'radio'>, ReactNode> = {
  // Voiture de profil : capot, pavillon, coffre, deux roues. La section « Véhicule ».
  voiture: (
    <>
      <path d="M4.7 16.5H3.3a.8.8 0 0 1-.8-.8v-2.2c0-.7.5-1.3 1.2-1.5l2.8-.8 2.4-3.1A2 2 0 0 1 10.5 7.4h4.4a2 2 0 0 1 1.5.7l2.9 3.4 1.5.4c.6.2 1.2.8 1.2 1.5v2.3a.8.8 0 0 1-.8.8h-1.1M9.2 16.5h5.6" />
      <path d="M6.9 11.5h12.4M12.7 7.6v3.9" />
      <circle cx="6.95" cy="16.5" r="2.25" />
      <circle cx="17.05" cy="16.5" r="2.25" />
    </>
  ),
  // Pistolet à peinture : godet, corps, buse, poignée et gâchette, le jet qui part. La section « Custom ».
  pistolet: (
    <>
      <rect x="7.5" y="9" width="10" height="4" rx="1.2" />
      <path d="M7.5 11H5.5M11.3 9V7.6M8.4 7.6h5.8l-.9-5.1H9.3zM14.5 13l1.2 7.5h2.5L17 13M12.4 13c0 1.6-.6 2.6-1.6 3.2" />
      <path d="M2.4 8.6h.01M2 11h.01M2.4 13.4h.01M3.6 9.8h.01M3.6 12.2h.01" />
    </>
  ),
  // Porte de garage sous son toit : lames du rideau. La section « Garage ».
  garage: (
    <>
      <path d="M3 20.5V9.2L12 3.5l9 5.7v11.3" />
      <path d="M6.5 20.5v-8.7h11v8.7M6.5 14.7h11M6.5 17.6h11" />
    </>
  ),
  // Bombe de peinture : corps, épaule, diffuseur, gouttelettes du jet. L'entrée « Peinture ».
  bombe: (
    <>
      <path d="M7 10a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v9.5a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z" />
      <path d="M9 8V5.5h4V8M10.5 5.5V3.5h1.5M7 13h8" />
      <path d="M17.5 4.5h.01M19.5 3h.01M19.5 6h.01M21.3 4.5h.01M17.8 7.6h.01" />
    </>
  ),
  // Jante à cinq branches : lèvre, branches, moyeu. L'entrée « Roues », le volet « Jantes ».
  jante: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="2.2" />
      <path d={rays(5, 2.2, 9)} />
    </>
  ),
  // Pneu : bande de roulement crantée autour de la jante. Le volet « Pneus ».
  pneu: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.6" />
      <path d={rays(12, 6.7, 9)} />
    </>
  ),
  // Cote : deux butées et la flèche qui les relie. Le volet « Cotes ».
  cote: <path d="M4 6v12M20 6v12M4.5 12h15M7.5 9 4.5 12l3 3M16.5 9l3 3-3 3" />,
  // Ressort hélicoïdal entre ses deux coupelles. L'entrée « Suspension ».
  ressort: <path d="M7 3.5h10M7 20.5h10M12 3.5v2l-5 1.8 10 2.6-10 2.6 10 2.6-10 2.6 5 1.3v1.5" />,
  // Siège de profil : appuie-tête, dossier, assise, glissière. L'entrée « Intérieur », le volet « Sièges ».
  siege: (
    <>
      <rect x="6.6" y="2.6" width="5" height="3" rx="1.2" />
      <path d="M7.6 7.4 6.6 14.6c-.1.9.6 1.6 1.5 1.6H17a1.5 1.5 0 0 0 1.5-1.5v-.4a1.5 1.5 0 0 0-1.5-1.5H9.8l.8-5.4zM9.4 16.2V20M16 16.2V20M7 20.5h11" />
    </>
  ),
  // Pommeau sur son levier, soufflet au pied. Le volet « Pommeau ».
  pommeau: (
    <>
      <circle cx="12" cy="6.3" r="3.6" />
      <path d="M12 9.9v7.1M7.2 20.5c0-2.1 2.1-3.5 4.8-3.5s4.8 1.4 4.8 3.5z" />
    </>
  ),
  // Ciel étoilé : une grande étoile qui scintille, deux petites. Le volet « Ciel ».
  etoiles: (
    <>
      <path d="M10.5 3.5 12 8l4.5 1.5L12 11l-1.5 4.5L9 11 4.5 9.5 9 8z" />
      <path d="M18 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8zM6 18.5h.01M19.5 5h.01" />
    </>
  ),
  // Autocollant au coin décollé, une étoile dessus. L'entrée « Stickers ».
  sticker: (
    <>
      <path d="M5 4.5h10l4 4V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 19z" />
      <path d="M15 4.5v4h4M12 10.5l1 2.1 2.3.3-1.7 1.6.4 2.3-2-1.1-2 1.1.4-2.3-1.7-1.6 2.3-.3z" />
    </>
  ),
  // Portière : vitre, poignée, bas de caisse. L'entrée « Carrosserie ».
  portiere: (
    <>
      <path d="M4 20V10.4c0-.9.4-1.7 1.1-2.2l4.6-3.7h9.3a1 1 0 0 1 1 1V20z" />
      <path d="M7.6 10.6l3.5-3h6.9v3zM14.5 13.8h3" />
    </>
  ),
  // Phare et ses faisceaux. L'entrée « Phares ».
  phare: (
    <>
      <path d="M11.5 5C7.9 5 5 8.1 5 12s2.9 7 6.5 7z" />
      <path d="M14.5 7.5h6M14.5 12h6M14.5 16.5h6" />
    </>
  ),
  // Aileron sur la malle : le plan, ses deux pieds. L'entrée « Ailerons ».
  aileron: (
    <>
      <path d="M2.5 8.2c4.5-1.7 14.5-1.7 19 0v2.1c-4.5-1.2-14.5-1.2-19 0z" />
      <path d="M7.5 10.6 8.6 17M16.5 10.6 15.4 17M3.5 19.5c4-1.9 13-1.9 17 0" />
    </>
  ),
  // Compte-tours : cadran, graduations, aiguille. L'entrée « Préparation ».
  compteur: (
    <>
      <path d="M4.4 17.5a8.5 8.5 0 1 1 15.2 0" />
      <path d="M6.3 10.2l1.3.8M12 5.8v1.5M17.7 10.2l-1.3.8M12 14.5l4.2-4.8" />
      <circle cx="12" cy="14.8" r="1.4" />
    </>
  ),
  // Flèche qui revient sur elle-même : remettre d'origine.
  origine: <path d="M4.6 12.5a7.5 7.5 0 1 0 2.3-6.3M4.4 3.6v3.6H8" />,
  // Silencieux, sortie d'échappement, bouffées. L'entrée « Échappement ».
  echappement: (
    <>
      <rect x="2.5" y="10.5" width="8" height="6" rx="2" />
      <path d="M10.5 13.5h4.3M14.8 11.8v3.4" />
      <circle cx="18.3" cy="11.2" r="1.6" />
      <circle cx="20.6" cy="7.6" r="1.2" />
      <circle cx="18.8" cy="16.4" r="1" />
    </>
  ),
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
  // Route qui file vers l'horizon sous un croissant de lune : la sortie de nuit.
  route: (
    <>
      <path d="M6.5 21 10.3 9.5M17.5 21l-3.8-11.5" />
      <path d="M12 20v-2.6M12 14.6v-2M12 10.2V9.5" />
      <path d="M17.6 2.6a3.3 3.3 0 1 0 3.6 4.6 2.7 2.7 0 0 1-3.6-4.6z" />
    </>
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
