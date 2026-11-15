// Dock de personnalisation : fermé (une pastille « Personnaliser »), compact (les rangées défilent,
// tout dans le tiers bas) ou agrandi (le dock monte et montre les options sur plusieurs lignes) ;
// l'onglet ouvert et la pile des niveaux où l'on est descendu (zone de peinture, nuancier…).
// La taille (fermé, compact, agrandi) est sauvegardée dans IndexedDB, sur le modèle du store du banc
// (src/state/bench.ts), lecture tolérante comprise (l'ancienne sauvegarde `{ expanded }` se relit
// telle quelle). L'onglet et les niveaux durent la séance : « Personnaliser » rouvre le dock là où on
// l'avait laissé ; au lancement, l'atelier repart de « Véhicule ». Le haut du dock agrandi, mesuré à
// l'écran, n'est pas sauvegardé : la scène s'en sert pour recadrer le véhicule au-dessus.
//
// Les niveaux forment une pile explicite : « Retour » dépile un niveau, toujours le même chemin
// (nuancier → couleurs, couleurs ou finitions d'une zone → liste des zones, onglet → rien). Un
// prochain menu s'y branche en ajoutant une sorte de niveau ici et son libellé dans le fil.

import { create } from 'zustand';
import { DOCK_MENU, type EntryId, type SectionId } from '../data/dockMenu.ts';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage, shareAcrossTabs } from './persistence.ts';

export const DOCK_KEY = 'pmb-dock';
export const DOCK_VERSION = 2;

export type { EntryId, SectionId };

export type PaintStep = 'couleur' | 'finition';
export type PickerTarget = 'color' | 'color2';

/** Un niveau sous l'onglet. */
export type DockLevel =
  /** Peinture : une zone, sur l'étape couleur ou finition (deux vues du même niveau). */
  | { kind: 'zone'; zone: string; step: PaintStep }
  /** Peinture : le nuancier, pour la couleur ou la seconde teinte de la zone. */
  | { kind: 'nuancier'; target: PickerTarget };

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

function sanitizeLevel(raw: unknown): DockLevel | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const level = raw as Record<string, unknown>;
  if (level.kind === 'zone' && typeof level.zone === 'string' && ZONE_ID.test(level.zone)) {
    return { kind: 'zone', zone: level.zone, step: level.step === 'finition' ? 'finition' : 'couleur' };
  }
  if (level.kind === 'nuancier') return { kind: 'nuancier', target: level.target === 'color2' ? 'color2' : 'color' };
  return null;
}

/** Une pile n'est valable que dans l'ordre de l'atelier : zone, puis nuancier (entrée Peinture). */
export function sanitizeLevels(entry: EntryId, raw: unknown): DockLevel[] {
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
  /** Change de section : on arrive sur sa dernière entrée, en haut de l'entrée. */
  setSection: (section: SectionId) => void;
  /** Change d'entrée dans la section ouverte : on repart du haut de l'entrée. */
  setEntry: (entry: EntryId) => void;
  /** Descend d'un niveau. */
  push: (level: DockLevel) => void;
  /** Remplace le niveau courant (couleur ↔ finition d'une même zone). */
  replace: (level: DockLevel) => void;
  /** Remonte d'un niveau ; rend faux s'il n'y avait rien à dépiler. */
  back: () => boolean;
  /** Ouvre une entrée de l'extérieur (pastille de la pièce…), sur une zone de peinture si elle est donnée. */
  openEntry: (entry: EntryId, zone?: string) => void;
}

export const useDock = create<DockState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_DOCK,
      section: 'vehicule',
      entries: {},
      levels: [],
      hydrated: false,
      top: null,
      zone: null,
      setExpanded: (expanded) => set({ expanded }),
      toggle: () => set((state) => ({ expanded: !state.expanded })),
      setTop: (top) => set((state) => (state.top === top ? state : { top })),
      setClosed: (closed) => set({ closed }),
      setSection: (section) => set((state) => (state.section === section && state.levels.length === 0 ? state : { section, levels: [] })),
      setEntry: (entry) =>
        set((state) => {
          const owner = DOCK_MENU.find((item) => item.id === state.section);
          if (!owner?.entries.some((item) => item.id === entry && item.available)) return state;
          return { entries: { ...state.entries, [state.section]: entry }, levels: [] };
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
      back: () => {
        const { levels } = get();
        if (levels.length === 0) return false;
        set({ levels: levels.slice(0, -1) });
        return true;
      },
      openEntry: (entry, zone) =>
        set((state) => {
          const owner = DOCK_MENU.find((item) => item.entries.some((candidate) => candidate.id === entry && candidate.available));
          if (!owner) return state;
          const levels = zone === undefined ? [] : sanitizeLevels(entry, [{ kind: 'zone', zone, step: 'couleur' }]);
          return {
            section: owner.id,
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
