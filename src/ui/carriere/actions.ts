// Les gestes de la carrière hors de son panneau : l'ouvrir (depuis le bouton rond du garage ou le rappel
// de la rubrique « Jeu »), partir sur un rendez-vous (depuis le panneau), et enchaîner sur le suivant
// (« Course suivante », depuis l'écran de fin d'un rendez-vous réussi).
//
// Le panneau vit dans le menu de la sortie, à l'étape « Mode », mode Carrière choisi
// (src/ui/drive/SortieEntree.tsx) : `ouvrirCarriere` y mène, d'où qu'on vienne.

import { isSheetRoute, parseHash } from '../../app/router.ts';
import { closeSheet, openSheet, switchSheet } from '../../app/useRoute.ts';
import type { RendezVous } from '../../data/carriere.ts';
import { useDock } from '../../state/dock.ts';
import { useDrive } from '../../state/drive.ts';
import { niveauCarriere } from '../drive/entree/etapes.ts';

/** Ouvre le panneau de la carrière : Garage › Sortie › Carrière. Un panneau ouvert (Atelier) se ferme d'abord. */
export function ouvrirCarriere(): void {
  if (isSheetRoute(parseHash(window.location.hash))) closeSheet();
  const dock = useDock.getState();
  dock.openEntry('sortie');
  dock.setLevels([niveauCarriere()]);
}

/**
 * Part sur un rendez-vous : tout est imposé (carte, départ, format, météo, moment), puis la sortie s'ouvre.
 * Si elle ne s'ouvre pas (un retour d'historique en cours), rien ne reste imposé.
 */
export function sortirSurRendezVous(rdv: RendezVous, numero: number, total: number): void {
  const drive = useDrive.getState();
  drive.lancerRendezVous(rdv, numero, total);
  // Depuis un panneau, la sortie le remplace : en rentrant, on retrouve le garage.
  if (isSheetRoute(parseHash(window.location.hash))) switchSheet({ name: 'sortie' });
  else openSheet({ name: 'sortie' });
  if (parseHash(window.location.hash).name !== 'sortie') useDrive.getState().leave();
}

/**
 * « Course suivante » : depuis la sortie en cours, part sur le rendez-vous donné, tout imposé, sans repasser
 * par le garage ni par le menu. La scène se recharge sur sa carte (chargement, puis aperçu). L'adresse reste
 * #/sortie, rien n'est empilé dans l'historique : Précédent ramène au garage, jamais à la course d'avant. Les
 * choix libres mis de côté au premier rendez-vous reviennent au garage, comme d'habitude. Hors sortie : rien.
 */
export function enchainerRendezVous(rdv: RendezVous, numero: number, total: number): void {
  const drive = useDrive.getState();
  if (drive.map === null) return;
  drive.lancerRendezVous(rdv, numero, total);
  useDrive.getState().relancerSur(rdv.carte, rdv.depart);
}
