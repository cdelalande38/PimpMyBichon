// Étapes de l'écran « Jouer » (vague X, 21 novembre 2026 ; avant : le menu « Sortie » des vagues U et V). Une
// étape à la fois, chacune remplace la précédente : le mode (aucun niveau ; les cartes de src/data/modes.ts) →
// le lieu → le circuit du lieu → les réglages, où se choisit le départ, puis « Jouer ». Un lieu à une seule
// carte saute l'étape du circuit. Le mode « Carrière » mène au panneau de la carrière (src/ui/carriere/).
// Les étapes sont des niveaux du dock (src/state/dock.ts) : « Retour » remonte d'une étape, toujours le
// même chemin ; l'en-tête du dock lit le titre de l'étape (`titreEtape`), plus un fil qui se tasse.
// Logique pure, sans React : testée dans tests/unit/entree-sortie.test.ts. Aucun lieu ni aucune carte
// n'est écrit ici : tout vient du catalogue (manifestes des cartes).

import { circuitLabel, zoneOf, zonesOf, type ZoneEntry } from '../../../data/maps.ts';
import type { MapManifest } from '../../../data/mapTypes.ts';
import type { DockLevel, EtapeSortie } from '../../../state/dock.ts';

/** Étape à l'écran : les modes (aucun niveau), puis celles de la pile. */
export type Etape = 'mode' | EtapeSortie;

export const LIBELLE_CARRIERE = 'Carrière';

/** Libellé du départ quand la route n'a pas pu se charger (hors ligne) : on part du début. */
export const LIBELLE_DEBUT = 'Du début';

/** Étape à l'écran d'après la pile du dock (un niveau d'une autre entrée ne compte pas). */
export function etapeDe(levels: readonly DockLevel[]): Etape {
  const top = levels.at(-1);
  // Carrière (vague V) : la saison, puis le rendez-vous choisis sont des niveaux `element` sous l'étape.
  if (top?.kind === 'element' && levels[0]?.kind === 'sortie' && levels[0].etape === 'carriere') return 'carriere';
  return top?.kind === 'sortie' ? top.etape : 'mode';
}

/**
 * Titre de l'étape, en tête du dock (retour du 21 novembre 2026 : le fil se tassait en « Sort… · Lib… · Mona… ») :
 * ce qu'on attend du joueur, en toutes lettres ; le chemin déjà choisi est relu une fois, dans le corps de l'étape.
 */
export function titreEtape(levels: readonly DockLevel[]): string {
  const top = levels.at(-1);
  if (top?.kind === 'element') return top.libelle;
  switch (etapeDe(levels)) {
    case 'zone':
      return 'Choisis ton lieu';
    case 'circuit':
      return 'Choisis ton circuit';
    case 'reglages':
      return 'Prépare ton départ';
    case 'carriere':
      return LIBELLE_CARRIERE;
    default:
      return 'Jouer';
  }
}

/** Niveau de l'étape du lieu, ouverte par un mode de sortie (`libelle` : le nom du mode). */
export function niveauLieu(libelle: string): DockLevel {
  return { kind: 'sortie', etape: 'zone', libelle };
}

/** Niveau de l'étape « Carrière ». */
export function niveauCarriere(): DockLevel {
  return { kind: 'sortie', etape: 'carriere', libelle: LIBELLE_CARRIERE };
}

/** Niveau des réglages, derrière un circuit (`libelle` : son nom). */
export function niveauReglages(libelle: string): DockLevel {
  return { kind: 'sortie', etape: 'reglages', libelle };
}

/**
 * Après le choix d'un lieu : l'étape de ses circuits ; s'il n'en a qu'un, directement les réglages de cette
 * carte (`carte` : la carte alors choisie).
 */
export function apresLieu(zone: ZoneEntry): { niveau: DockLevel; carte: MapManifest | null } {
  const seule = zone.maps.length === 1 ? (zone.maps[0] ?? null) : null;
  if (seule) return { niveau: niveauReglages(circuitLabel(seule)), carte: seule };
  return { niveau: { kind: 'sortie', etape: 'circuit', libelle: zone.label, lieu: zone.id }, carte: null };
}

/** Après le choix d'un circuit (dans un lieu qui en a plusieurs) : les réglages. */
export function apresCircuit(map: MapManifest): DockLevel {
  return niveauReglages(circuitLabel(map));
}

/** Le lieu d'une carte dans le catalogue. */
export function lieuDe(map: MapManifest, catalog?: readonly MapManifest[]): ZoneEntry {
  const id = zoneOf(map).id;
  return zonesOf(catalog).find((zone) => zone.id === id) ?? { id, label: zoneOf(map).label, maps: [map] };
}

/**
 * Pile de « Continuer » : l'écran va droit aux réglages de la dernière sortie, et « Retour » remonte quand
 * même étape par étape (circuit si le lieu en a plusieurs, lieu, modes). `mode` : le nom du mode.
 */
export function pileReprise(map: MapManifest, mode: string, catalog?: readonly MapManifest[]): DockLevel[] {
  const zone = lieuDe(map, catalog);
  const levels: DockLevel[] = [niveauLieu(mode)];
  if (zone.maps.length > 1) levels.push(apresLieu(zone).niveau);
  levels.push(apresCircuit(map));
  return levels;
}

/** Ligne de rappel des choix (« Monaco › Le circuit › Place du Casino ») : lieu, circuit, départ. */
export function rappel(map: MapManifest, depart: string | null, catalog?: readonly MapManifest[]): string {
  const parts = [lieuDe(map, catalog).label, circuitLabel(map)];
  if (depart) parts.push(depart);
  return parts.join(' › ');
}
