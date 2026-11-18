// Dock de personnalisation : fermé (une pastille « Personnaliser »), compact (les rangées défilent,
// tout dans le tiers bas) ou agrandi (le dock monte et montre les options sur plusieurs lignes) ;
// l'onglet ouvert et la pile des niveaux où l'on est descendu (zone de peinture, nuancier…).
// La taille (fermé, compact, agrandi) est sauvegardée dans IndexedDB, sur le modèle du store du banc
// (src/state/bench.ts), lecture tolérante comprise (l'ancienne sauvegarde `{ expanded }` se relit
// telle quelle). L'onglet et les niveaux durent la séance : « Personnaliser » rouvre le dock là où on
// l'avait laissé ; au lancement, l'atelier repart des sections. Le haut du dock agrandi, mesuré à
// l'écran, n'est pas sauvegardé : la scène s'en sert pour recadrer le véhicule au-dessus.
//
// Un seul niveau du menu à l'écran (`menu`) : les sections, les entrées d'une section, ou le contenu
// d'une entrée. Sous le contenu, les niveaux forment une pile explicite : « Retour » dépile un niveau,
// toujours le même chemin (nuancier → couleurs, couleurs ou finitions d'une zone → liste des zones,
// contenu → entrées de la section, ou sections si elle n'a qu'une entrée, entrées → sections). Un
// prochain menu s'y branche en ajoutant une sorte de niveau ici et son libellé dans le fil.
// Sortie (vague U, retour du 18 novembre 2026) : ses étapes sont des niveaux (`kind: 'sortie'`) :
// mode → zone → circuit → départ → réglages, ou mode → carrière. Chaque étape remplace la précédente,
// « Retour » remonte d'une étape ; chaque niveau porte le libellé du choix qui y a mené, pour le fil.

import { create } from 'zustand';
import { directEntry, DOCK_MENU, type EntryId, type SectionId } from '../data/dockMenu.ts';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage, shareAcrossTabs } from './persistence.ts';

export const DOCK_KEY = 'pmb-dock';
export const DOCK_VERSION = 2;

export type { EntryId, SectionId };

export type PaintStep = 'couleur' | 'finition';

/**
 * Niveau du menu à l'écran, un seul à la fois : les sections, les entrées d'une section, ou le
 * contenu d'une entrée (et ses niveaux à elle, `levels`). Une section à une seule entrée (Véhicule)
 * passe directement des sections au contenu ; Garage montre ses deux entrées (Ambiance, Sortie).
 */
export type MenuLevel = 'sections' | 'entrees' | 'contenu';

/** Vrai si la section ouvre directement son entrée (aucun écran intermédiaire à un seul choix). */
export function opensDirectly(section: SectionId): boolean {
  const data = DOCK_MENU.find((item) => item.id === section);
  return data !== undefined && directEntry(data) !== undefined;
}
export type PickerTarget = 'color' | 'color2';

/** Étapes de la sortie sous son mode (le mode est l'étape de départ, sans niveau). */
export const ETAPES_SORTIE = ['carriere', 'zone', 'circuit', 'depart', 'reglages'] as const;
export type EtapeSortie = (typeof ETAPES_SORTIE)[number];

/** Un niveau sous l'onglet. */
export type DockLevel =
  /** Peinture : une zone, sur l'étape couleur ou finition (deux vues du même niveau). */
  | { kind: 'zone'; zone: string; step: PaintStep }
  /** Peinture : le nuancier, pour la couleur ou la seconde teinte de la zone. */
  | { kind: 'nuancier'; target: PickerTarget }
  /**
   * Sortie : une étape, avec le libellé du choix qui y a mené (« Libre », « Monaco », « Le circuit »…),
   * lu par le fil ; `lieu` : le lieu dont l'étape « circuit » montre les cartes.
   */
  | { kind: 'sortie'; etape: EtapeSortie; libelle: string; lieu?: string };

/** Ce qui est sauvegardé : la taille du dock. */
export interface DockChoices {
  /** Vrai : dock agrandi (quand il est ouvert). */
  expanded: boolean;
  /** Vrai : dock fermé, réduit à la pastille « Personnaliser ». */
  closed: boolean;
}

export const DEFAULT_DOCK: Readonly<DockChoices> = Object.freeze({ expanded: false, closed: false });

export type DockSize = 'ferme' | 'compact' | 'agrandi';

export function dockSize(choices: Pick<DockChoices, 'expanded' | 'closed'>): DockSize {
  if (choices.closed) return 'ferme';
  return choices.expanded ? 'agrandi' : 'compact';
}

const ZONE_ID = /^[a-z0-9_-]{1,40}$/i;
/** Lieu d'une carte (src/data/maps.ts, zoneOf : identifiant du manifeste, ou « carte-<id> »). */
const LIEU_ID = /^[a-z0-9_-]{1,72}$/;

function sanitizeSortieLevel(level: Record<string, unknown>): DockLevel | null {
  const etape = ETAPES_SORTIE.find((item) => item === level.etape);
  if (!etape || typeof level.libelle !== 'string' || level.libelle.length > 120) return null;
  if (etape === 'circuit') return typeof level.lieu === 'string' && LIEU_ID.test(level.lieu) ? { kind: 'sortie', etape, libelle: level.libelle, lieu: level.lieu } : null;
  return { kind: 'sortie', etape, libelle: level.libelle };
}

/** Une pile de la sortie n'est valable que dans l'ordre des étapes : carrière seule, ou zone, circuit, départ, réglages (sauts permis). */
function sanitizeSortieLevels(raw: readonly unknown[]): DockLevel[] {
  const levels: DockLevel[] = [];
  let rank = -1;
  for (const item of raw.slice(0, 4)) {
    if (typeof item !== 'object' || item === null || (item as Record<string, unknown>).kind !== 'sortie') break;
    const level = sanitizeSortieLevel(item as Record<string, unknown>);
    if (!level || level.kind !== 'sortie') break;
    const next = ETAPES_SORTIE.indexOf(level.etape);
    if (levels.length === 0 ? level.etape !== 'zone' && level.etape !== 'carriere' : level.etape === 'carriere' || next <= rank) break;
    levels.push(level);
    rank = next;
    if (level.etape === 'carriere') break;
  }
  return levels;
}

function sanitizeLevel(raw: unknown): DockLevel | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const level = raw as Record<string, unknown>;
  if (level.kind === 'zone' && typeof level.zone === 'string' && ZONE_ID.test(level.zone)) {
    return { kind: 'zone', zone: level.zone, step: level.step === 'finition' ? 'finition' : 'couleur' };
  }
  if (level.kind === 'nuancier') return { kind: 'nuancier', target: level.target === 'color2' ? 'color2' : 'color' };
  return null;
}

/**
 * Une pile n'est valable que dans l'ordre de l'atelier : zone, puis nuancier (entrée Peinture) ; les
 * étapes de la sortie, dans leur ordre (entrée Sortie).
 */
export function sanitizeLevels(entry: EntryId, raw: unknown): DockLevel[] {
  if (entry === 'sortie' && Array.isArray(raw)) return sanitizeSortieLevels(raw);
  if (entry !== 'peinture' || !Array.isArray(raw)) return [];
  const levels: DockLevel[] = [];
  for (const item of raw.slice(0, 2)) {
    const level = sanitizeLevel(item);
    if (!level) break;
    if (levels.length === 0 && level.kind !== 'zone') break;
    if (levels.length === 1 && level.kind !== 'nuancier') break;
    levels.push(level);
  }
  return levels;
}

/** Lecture tolérante : tout ce qui n'est pas un « vrai » explicite retombe sur le dock compact ouvert. */
export function sanitizeDock(raw: unknown): DockChoices {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { expanded: source.expanded === true, closed: source.closed === true };
}

/** Entrée ouverte d'une section : la dernière choisie, sinon la première disponible des données. */
export function entryOf(section: SectionId, entries: Partial<Record<SectionId, EntryId>>): EntryId {
  const data = DOCK_MENU.find((item) => item.id === section);
  const ready = data?.entries.filter((item) => item.available) ?? [];
  return (ready.find((item) => item.id === entries[section]) ?? ready[0])?.id ?? 'vehicule';
}

export interface DockState extends DockChoices {
  /** Section ouverte (Véhicule, Custom, Mécanique, Garage). */
  section: SectionId;
  /** Niveau du menu à l'écran : sections, entrées de la section, ou contenu de l'entrée. */
  menu: MenuLevel;
  /** Dernière entrée utilisée de chaque section : on y revient sans appui de plus. */
  entries: Partial<Record<SectionId, EntryId>>;
  levels: DockLevel[];
  hydrated: boolean;
  /** Haut du dock agrandi, en pixels CSS depuis le haut de l'écran ; `null` : pas encore mesuré. */
  top: number | null;
  /** Dernière zone de peinture choisie (pressée dans la liste des zones) ; `null` : la première. */
  zone: string | null;
  setExpanded: (expanded: boolean) => void;
  toggle: () => void;
  setTop: (top: number | null) => void;
  /** Ferme le dock (pastille « Personnaliser ») ou le rouvre là où on l'avait laissé. */
  setClosed: (closed: boolean) => void;
  /** Ouvre une section : ses entrées, ou directement son contenu si elle n'en a qu'une. */
  setSection: (section: SectionId) => void;
  /** Ouvre une entrée de la section ouverte : son contenu, depuis le haut. */
  setEntry: (entry: EntryId) => void;
  /** Descend d'un niveau. */
  push: (level: DockLevel) => void;
  /** Remplace le niveau courant (couleur ↔ finition d'une même zone). */
  replace: (level: DockLevel) => void;
  /** Remplace toute la pile sous le contenu (la sortie rouvre sur les réglages de la dernière sortie). */
  setLevels: (levels: readonly DockLevel[]) => void;
  /** Remonte d'un niveau (contenu → entrées → sections) ; rend faux si l'on était déjà aux sections. */
  back: () => boolean;
  /** Ouvre une entrée de l'extérieur (pastille de la pièce…), sur une zone de peinture si elle est donnée. */
  openEntry: (entry: EntryId, zone?: string) => void;
}

export const useDock = create<DockState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_DOCK,
      section: 'vehicule',
      menu: 'sections',
      entries: {},
      levels: [],
      hydrated: false,
      top: null,
      zone: null,
      setExpanded: (expanded) => set({ expanded }),
      toggle: () => set((state) => ({ expanded: !state.expanded })),
      setTop: (top) => set((state) => (state.top === top ? state : { top })),
      // Fermer ramène le menu à son accueil (retour du 16 novembre 2026) : rouvert par « Personnaliser »,
      // il montre les sections, pas le niveau où on l'avait quitté. La section et ses entrées restent
      // retenues : on y retourne en un appui.
      setClosed: (closed) => set(closed ? { closed: true, menu: 'sections', levels: [] } : { closed: false }),
      setSection: (section) => set({ section, menu: opensDirectly(section) ? 'contenu' : 'entrees', levels: [] }),
      setEntry: (entry) =>
        set((state) => {
          const owner = DOCK_MENU.find((item) => item.id === state.section);
          if (!owner?.entries.some((item) => item.id === entry && item.available)) return state;
          return { entries: { ...state.entries, [state.section]: entry }, menu: 'contenu', levels: [] };
        }),
      push: (level) =>
        set((state) => {
          const levels = sanitizeLevels(entryOf(state.section, state.entries), [...state.levels, level]);
          return { levels, zone: level.kind === 'zone' ? level.zone : state.zone };
        }),
      replace: (level) =>
        set((state) => {
          const levels = sanitizeLevels(entryOf(state.section, state.entries), [...state.levels.slice(0, -1), level]);
          return { levels, zone: level.kind === 'zone' ? level.zone : state.zone };
        }),
      setLevels: (levels) => set((state) => ({ levels: sanitizeLevels(entryOf(state.section, state.entries), [...levels]) })),
      back: () => {
        const { levels, menu, section } = get();
        if (levels.length > 0) set({ levels: levels.slice(0, -1) });
        else if (menu === 'contenu') set({ menu: opensDirectly(section) ? 'sections' : 'entrees' });
        else if (menu === 'entrees') set({ menu: 'sections' });
        else return false;
        return true;
      },
      openEntry: (entry, zone) =>
        set((state) => {
          const owner = DOCK_MENU.find((item) => item.entries.some((candidate) => candidate.id === entry && candidate.available));
          if (!owner) return state;
          const levels = zone === undefined ? [] : sanitizeLevels(entry, [{ kind: 'zone', zone, step: 'couleur' }]);
          return {
            section: owner.id,
            menu: 'contenu',
            entries: { ...state.entries, [owner.id]: entry },
            levels,
            zone: zone ?? state.zone,
            closed: false,
          };
        }),
    }),
    {
      name: DOCK_KEY,
      version: DOCK_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ expanded, closed }) => ({ expanded, closed }),
      migrate: (persisted) => sanitizeDock(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeDock(persisted) }),
      onRehydrateStorage: () => () => {
        useDock.setState({ hydrated: true });
      },
    },
  ),
);

// Une autre page de l'app enregistre aussi : le store relit la sauvegarde (src/state/persistence.ts).
shareAcrossTabs(useDock);
