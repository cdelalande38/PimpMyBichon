// Choix du banc d'essai : teinte, finition, ambiance. Zustand, sauvegardé dans IndexedDB
// à chaque changement, sur le modèle du store des réglages (lecture tolérante comprise).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AMBIANCES, DEFAULT_AMBIANCE, type AmbianceId } from '../data/ambiances.ts';
import { DEFAULT_FINISH, FINISHES, type FinishId } from '../data/finishes.ts';
import { DEFAULT_PAINT_COLOR, PAINT_COLORS, type PaintColorId } from '../data/paintColors.ts';
import { idbStorage } from './persistence.ts';

export const BENCH_KEY = 'pmb-banc';
export const BENCH_VERSION = 1;

export interface BenchChoices {
  color: PaintColorId;
  finish: FinishId;
  ambiance: AmbianceId;
}

export const DEFAULT_BENCH: Readonly<BenchChoices> = Object.freeze({
  color: DEFAULT_PAINT_COLOR,
  finish: DEFAULT_FINISH,
  ambiance: DEFAULT_AMBIANCE,
});

function oneOf<T extends string>(items: ReadonlyArray<{ id: T }>, value: unknown, fallback: T): T {
  return typeof value === 'string' && items.some((item) => item.id === value) ? (value as T) : fallback;
}

/**
 * Lecture tolérante : une teinte retirée du catalogue, une sauvegarde abîmée ou venue d'une
 * autre version retombe sur l'origine, champ par champ. L'app s'ouvre toujours.
 */
export function sanitizeBench(raw: unknown): BenchChoices {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    color: oneOf(PAINT_COLORS, source.color, DEFAULT_BENCH.color),
    finish: oneOf(FINISHES, source.finish, DEFAULT_BENCH.finish),
    ambiance: oneOf(AMBIANCES, source.ambiance, DEFAULT_BENCH.ambiance),
  };
}

/** État du modèle dans la scène (non sauvegardé). */
export type BenchStatus = 'chargement' | 'pret' | 'erreur';

export interface BenchState extends BenchChoices {
  hydrated: boolean;
  status: BenchStatus;
  choose: <K extends keyof BenchChoices>(key: K, value: BenchChoices[K]) => void;
  setStatus: (status: BenchStatus) => void;
}

export const useBench = create<BenchState>()(
  persist(
    (set) => ({
      ...DEFAULT_BENCH,
      hydrated: false,
      status: 'chargement',
      choose: (key, value) => set({ [key]: value } as Pick<BenchChoices, typeof key>),
      setStatus: (status) => set({ status }),
    }),
    {
      name: BENCH_KEY,
      version: BENCH_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ color, finish, ambiance }) => ({ color, finish, ambiance }),
      migrate: (persisted) => sanitizeBench(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeBench(persisted) }),
      onRehydrateStorage: () => () => {
        useBench.setState({ hydrated: true });
      },
    },
  ),
);
