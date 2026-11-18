// Les deux gestes de la carrière hors de son panneau : l'ouvrir (depuis la pastille du garage ou la
// rubrique « Jeu »), et partir sur un rendez-vous (depuis le panneau).
//
// PROVISOIRE (vague U) : tant que le menu de la sortie par étapes (lot « entree ») n'est pas fusionné,
// le panneau de la carrière se déplie dans Atelier › Jeu (src/ui/carriere/RappelCarriere.tsx). Une fois
// l'étape « Mode » du menu de la sortie en place, `ouvrirCarriere` devra mener à cette étape, mode
// « Carrière » choisi : c'est le seul endroit à changer.

import { create } from 'zustand';
import { isSheetRoute, parseHash } from '../../app/router.ts';
import { openSheet, switchSheet } from '../../app/useRoute.ts';
import type { RendezVous } from '../../data/carriere.ts';
import { useDrive } from '../../state/drive.ts';

/** Le panneau de la carrière déplié dans Atelier › Jeu (provisoire) : jusqu'à « Replier » ou au départ sur un rendez-vous. */
export const useCarriereOuverte = create<{ ouverte: boolean; setOuverte: (ouverte: boolean) => void }>()((set) => ({
  ouverte: false,
  setOuverte: (ouverte) => set({ ouverte }),
}));

/** Ouvre le panneau de la carrière. */
export function ouvrirCarriere(): void {
  useCarriereOuverte.getState().setOuverte(true);
  openSheet({ name: 'jeu' });
}

/**
 * Part sur un rendez-vous : tout est imposé (carte, départ, format, météo, moment), puis la sortie s'ouvre.
 * Si elle ne s'ouvre pas (un retour d'historique en cours), rien ne reste imposé.
 */
export function sortirSurRendezVous(rdv: RendezVous, numero: number, total: number): void {
  const drive = useDrive.getState();
  drive.lancerRendezVous(rdv, numero, total);
  // Au retour, le rappel de l'atelier est replié.
  useCarriereOuverte.getState().setOuverte(false);
  // Depuis un panneau (Atelier › Jeu), la sortie le remplace : en rentrant, on retrouve le garage.
  if (isSheetRoute(parseHash(window.location.hash))) switchSheet({ name: 'sortie' });
  else openSheet({ name: 'sortie' });
  if (parseHash(window.location.hash).name !== 'sortie') useDrive.getState().leave();
}
