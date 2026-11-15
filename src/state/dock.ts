// Taille du dock : compact (les rangées défilent, tout dans le tiers bas) ou agrandi (le dock monte
// et montre les options sur plusieurs lignes). Préférence sauvegardée dans IndexedDB, sur le modèle
// du store du banc (src/state/bench.ts), lecture tolérante comprise. Le haut du dock agrandi, mesuré
// à l'écran, n'est pas sauvegardé : la scène s'en sert pour recadrer le véhicule au-dessus.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from './persistence.ts';

export const DOCK_KEY = 'pmb-dock';
export const DOCK_VERSION = 1;

export interface DockChoices {
  /** Vrai : dock agrandi. */
  expanded: boolean;
}

export const DEFAULT_DOCK: Readonly<DockChoices> = Object.freeze({ expanded: false });

/** Lecture tolérante : tout ce qui n'est pas un « vrai » explicite retombe sur le dock compact. */
export function sanitizeDock(raw: unknown): DockChoices {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return { expanded: source.expanded === true };
}

export interface DockState extends DockChoices {
  hydrated: boolean;
  /** Haut du dock agrandi, en pixels CSS depuis le haut de l'écran ; `null` : pas encore mesuré. */
  top: number | null;
  setExpanded: (expanded: boolean) => void;
  toggle: () => void;
  setTop: (top: number | null) => void;
}

export const useDock = create<DockState>()(
  persist(
    (set) => ({
      ...DEFAULT_DOCK,
      hydrated: false,
      top: null,
      setExpanded: (expanded) => set({ expanded }),
      toggle: () => set((state) => ({ expanded: !state.expanded })),
      setTop: (top) => set((state) => (state.top === top ? state : { top })),
    }),
    {
      name: DOCK_KEY,
      version: DOCK_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ expanded }) => ({ expanded }),
      migrate: (persisted) => sanitizeDock(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeDock(persisted) }),
      onRehydrateStorage: () => () => {
        useDock.setState({ hydrated: true });
      },
    },
  ),
);
