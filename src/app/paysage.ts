// Le garage en paysage (téléphone tenu à deux mains) : écran plus large que haut et bas. Même requête
// que la sortie de nuit (src/ui/drive/DriveScreen.tsx) : une seule définition du « paysage » dans
// l'app. Les règles de disposition vivent dans src/app/paysage.css (menu en colonne à droite, boutons
// ronds à gauche, panneaux en feuille latérale) ; ce module sert aux composants et à la scène qui
// doivent savoir dans quelle disposition ils sont (cadrage du véhicule, taille du menu).

import { useMediaQuery } from './useMediaQuery.ts';

/** Requête de la disposition paysage : à garder identique à celle de paysage.css (@media). */
export const PAYSAGE = '(orientation: landscape) and (max-height: 540px)';

/** Vrai tant que l'écran est en paysage (suit la rotation en direct). */
export function usePaysage(): boolean {
  return useMediaQuery(PAYSAGE);
}
