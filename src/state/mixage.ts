// Réglages du son en sortie de nuit (panneau « Son », src/ui/drive/Mixage.tsx) : la part de la
// radio gardée quand la sortie roule, le niveau du moteur, celui des bruitages de route. Gardés
// d'une sortie à l'autre ; appliqués par src/drive/son.ts (règles dans src/drive/mixage.ts).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { MIXAGE_ORIGINE, type ReglagesMixage } from '../drive/mixage.ts';
import { idbStorage, shareAcrossTabs } from './persistence.ts';

export const MIXAGE_KEY = 'pmb-mixage';

export type VoieMixage = keyof ReglagesMixage;

/** Les trois curseurs, dans l'ordre du panneau. */
export const VOIES_MIXAGE: readonly { id: VoieMixage; label: string }[] = [
  { id: 'radio', label: 'Radio' },
  { id: 'moteur', label: 'Moteur' },
  { id: 'route', label: 'Route' },
];

function pourCent(value: unknown, origine: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : origine;
}

/** Lecture tolérante : une valeur illisible retombe sur celle d'origine, une valeur hors bornes y est ramenée. */
export function sanitizeMixage(raw: unknown): ReglagesMixage {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    radio: pourCent(source.radio, MIXAGE_ORIGINE.radio),
    moteur: pourCent(source.moteur, MIXAGE_ORIGINE.moteur),
    route: pourCent(source.route, MIXAGE_ORIGINE.route),
  };
}

export interface MixageStore extends ReglagesMixage {
  regler: (voie: VoieMixage, valeur: number) => void;
  /** Retour aux valeurs d'origine. */
  origine: () => void;
}

export const useMixage = create<MixageStore>()(
  persist(
    (set) => ({
      ...MIXAGE_ORIGINE,
      regler: (voie, valeur) =>
        set((state) => {
          const value = pourCent(valeur, state[voie]);
          return value === state[voie] ? state : { [voie]: value };
        }),
      origine: () => set({ ...MIXAGE_ORIGINE }),
    }),
    {
      name: MIXAGE_KEY,
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ radio, moteur, route }) => ({ radio, moteur, route }),
      migrate: (persisted) => sanitizeMixage(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeMixage(persisted) }),
    },
  ),
);

// Une autre page de l'app enregistre aussi : le store relit la sauvegarde (src/state/persistence.ts).
shareAcrossTabs(useMixage);
