// Sur quel écran est-on ? Fonctions pures (testées sans navigateur) : la route des panneaux, la vue,
// le dock. Le branchement sur les stores vit dans Tutos.tsx, sans toucher aux écrans eux-mêmes.

import type { Route } from '../../app/router.ts';
import type { EcranKey } from '../../data/tutos.ts';
import type { EntryId, SectionId } from '../../data/dockMenu.ts';
import type { MenuLevel } from '../../state/dock.ts';
import type { ViewMode } from '../../state/view.ts';

export interface EcranFaits {
  route: Route;
  vue: ViewMode;
  /** `menu` : niveau du menu à l'écran (src/state/dock.ts) ; absent, le contenu de l'entrée. */
  dock: { closed: boolean; section: SectionId; entry: EntryId; menu?: MenuLevel };
  /** Vrai dès qu'on a quitté la section « Véhicule » depuis l'ouverture : on n'est plus à l'accueil. */
  sortiAccueil: boolean;
}

/** Écran courant ; `null` : un écran sans tutoriel prévu (lien de build reçu, carnet de commandes…). */
export function ecranCourant({ route, vue, dock, sortiAccueil }: EcranFaits): EcranKey | null {
  switch (route.name) {
    case 'photo':
      return 'photo';
    case 'sortie':
      return 'sortie';
    case 'radio':
    case 'reglages':
    case 'capot':
      return `panneau:${route.name}`;
    case 'garage':
      break;
    default:
      return null;
  }
  if (vue === 'interieur') return 'vue:interieur';
  if (dock.closed) return 'accueil';
  // Un seul niveau du menu à l'écran : les sections expliquent le menu (l'accueil) ; les entrées
  // d'une section n'ont pas de tutoriel à elles. Le tutoriel d'une entrée attend son contenu.
  if (dock.menu === 'sections') return 'accueil';
  if (dock.menu === 'entrees') return null;
  // L'app s'ouvre sur « Véhicule » : tant qu'on n'en est pas sorti, c'est l'accueil.
  if (dock.section === 'vehicule' && !sortiAccueil) return 'accueil';
  return `entree:${dock.entry}`;
}

/** Les écrans du garage (pas un panneau ni la photo) : l'accueil s'y propose en premier. */
export function ecranDuGarage(ecran: EcranKey | null): boolean {
  return ecran === 'accueil' || ecran === 'vue:interieur' || (ecran?.startsWith('entree:') ?? false);
}

/** Paramètre d'adresse qui réactive le premier passage sous un navigateur piloté : `?tuto=1`. */
export const PARAM_TUTO = 'tuto';

// Navigateur piloté (navigator.webdriver) : aucun tutoriel ne se propose tout seul, pour que les parcours automatiques restent inchangés ; `?tuto=1` dans l'adresse le réactive (tests/e2e/tuto.spec.ts).
export function premierPassageActif(webdriver: boolean, search: string): boolean {
  if (!webdriver) return true;
  return new URLSearchParams(search).get(PARAM_TUTO) === '1';
}
