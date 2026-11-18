// Étapes du menu de la sortie (vague U, retour du 18 novembre 2026, pour la deuxième fois : « bien
// dissocier la sélection de la zone de la sélection du circuit »). Une étape à la fois, chacune remplace
// la précédente : mode (Libre ou Carrière) → lieu → circuit du lieu → départ → réglages, puis « Sortir ».
// Un lieu à une seule carte saute l'étape du circuit ; une carte à un seul départ saute celle du départ.
// Les étapes sont des niveaux du dock (src/state/dock.ts) : « Retour » remonte d'une étape, toujours le
// même chemin, et le fil lit le libellé que porte chaque niveau (le choix qui y a mené).
// Logique pure, sans React : testée dans tests/unit/entree-sortie.test.ts. Aucun lieu ni aucune carte
// n'est écrit ici : tout vient du catalogue (manifestes des cartes).

import { circuitLabel, zoneOf, zonesOf, type ZoneEntry } from '../../../data/maps.ts';
import type { MapManifest, MapStart } from '../../../data/mapTypes.ts';
import type { DockLevel, EtapeSortie } from '../../../state/dock.ts';

/** Étape à l'écran : le mode (aucun niveau), puis celles de la pile. */
export type Etape = 'mode' | EtapeSortie;

export const LIBELLE_LIBRE = 'Libre';
export const LIBELLE_CARRIERE = 'Carrière';

/** Libellé du départ quand la route n'a pas pu se charger (hors ligne) : on part du début. */
export const LIBELLE_DEBUT = 'Du début';

/** Les deux modes de l'étape d'ouverture, avec leur petite ligne. */
export const MODES: readonly { id: 'libre' | 'carriere'; label: string; aide: string }[] = [
  { id: 'libre', label: LIBELLE_LIBRE, aide: 'Tu choisis tout : lieu, circuit, météo' },
  { id: 'carriere', label: LIBELLE_CARRIERE, aide: 'Des épreuves, l’une après l’autre' },
];

/** Étape à l'écran d'après la pile du dock (un niveau d'une autre entrée ne compte pas). */
export function etapeDe(levels: readonly DockLevel[]): Etape {
  const top = levels.at(-1);
  return top?.kind === 'sortie' ? top.etape : 'mode';
}

/** Niveau de l'étape du lieu, ouverte par « Libre ». */
export function niveauLieu(): DockLevel {
  return { kind: 'sortie', etape: 'zone', libelle: LIBELLE_LIBRE };
}

/** Niveau de l'étape « Carrière ». */
export function niveauCarriere(): DockLevel {
  return { kind: 'sortie', etape: 'carriere', libelle: LIBELLE_CARRIERE };
}

/**
 * Après le choix d'un lieu : l'étape de ses circuits ; s'il n'en a qu'un, directement celle des départs
 * de cette carte (`carte` : la carte alors choisie).
 */
export function apresLieu(zone: ZoneEntry): { niveau: DockLevel; carte: MapManifest | null } {
  const seule = zone.maps.length === 1 ? (zone.maps[0] ?? null) : null;
  if (seule) return { niveau: { kind: 'sortie', etape: 'depart', libelle: zone.label }, carte: seule };
  return { niveau: { kind: 'sortie', etape: 'circuit', libelle: zone.label, lieu: zone.id }, carte: null };
}

/** Après le choix d'un circuit (dans un lieu qui en a plusieurs) : l'étape des départs. */
export function apresCircuit(map: MapManifest): DockLevel {
  return { kind: 'sortie', etape: 'depart', libelle: circuitLabel(map) };
}

/** Après le choix d'un départ : les réglages ; le fil finit sur le départ. */
export function apresDepart(libelle: string): DockLevel {
  return { kind: 'sortie', etape: 'reglages', libelle };
}

/** Le lieu d'une carte dans le catalogue. */
export function lieuDe(map: MapManifest, catalog?: readonly MapManifest[]): ZoneEntry {
  const id = zoneOf(map).id;
  return zonesOf(catalog).find((zone) => zone.id === id) ?? { id, label: zoneOf(map).label, maps: [map] };
}

/**
 * Pile de reprise : le menu rouvert va droit aux réglages de la dernière sortie, et « Retour » remonte
 * quand même étape par étape (départ, circuit si le lieu en a plusieurs, lieu, mode). `depart` : le
 * libellé du départ s'il est connu, sinon le nom du circuit (la route se charge, il est corrigé ensuite).
 */
export function pileReprise(map: MapManifest, depart: string | null, catalog?: readonly MapManifest[]): DockLevel[] {
  const zone = lieuDe(map, catalog);
  const levels: DockLevel[] = [niveauLieu()];
  if (zone.maps.length > 1) levels.push(apresLieu(zone).niveau, apresCircuit(map));
  else levels.push(apresLieu(zone).niveau);
  levels.push(apresDepart(depart ?? circuitLabel(map)));
  return levels;
}

/**
 * La route chargée n'a qu'un départ (ou aucun) : l'étape des départs n'a rien à demander. La pile
 * passe aux réglages sans elle : « Retour » ne s'y arrêtera pas. `null` : rien à changer.
 */
export function sansEtapeDepart(levels: readonly DockLevel[], starts: readonly MapStart[]): DockLevel[] | null {
  if (starts.length > 1) return null;
  const index = levels.findIndex((level) => level.kind === 'sortie' && level.etape === 'depart');
  if (index < 0) return null;
  const libelle = starts[0]?.label ?? LIBELLE_DEBUT;
  const top = levels.at(-1);
  // À l'étape des départs : on la remplace par les réglages. Aux réglages : on la retire de la pile.
  if (index === levels.length - 1) return [...levels.slice(0, index), apresDepart(libelle)];
  if (top?.kind === 'sortie' && top.etape === 'reglages') return [...levels.slice(0, index), ...levels.slice(index + 1)];
  return null;
}

/** Ligne de rappel des choix (« Monaco › Le circuit › Place du Casino ») : lieu, circuit, départ. */
export function rappel(map: MapManifest, depart: string | null, catalog?: readonly MapManifest[]): string {
  const parts = [lieuDe(map, catalog).label, circuitLabel(map)];
  if (depart) parts.push(depart);
  return parts.join(' › ');
}
