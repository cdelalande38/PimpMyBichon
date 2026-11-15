// Ambiance du garage et état du véhicule dans la scène. Zustand, l'ambiance sauvegardée dans
// IndexedDB à chaque changement, sur le modèle du store des réglages (lecture tolérante comprise).
// Les peintures vivent dans les builds (src/state/builds.ts), véhicule par véhicule.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { AMBIANCES, DEFAULT_AMBIANCE, type AmbianceId } from '../data/ambiances.ts';
import { FINISHES, type FinishId } from '../data/finishes.ts';
import { PAINT_COLORS } from '../data/paintColors.ts';
import { VEHICLES } from '../data/vehicles.ts';
import type { Hex } from '../data/vehicleTypes.ts';
import { masterZone, useBuilds } from './builds.ts';
import { idbStorage } from './persistence.ts';

export const BENCH_KEY = 'pmb-banc';
/** 2 : la teinte et la finition du banc d'essai sont passées dans les builds. */
export const BENCH_VERSION = 2;

export interface BenchChoices {
  ambiance: AmbianceId;
}

export const DEFAULT_BENCH: Readonly<BenchChoices> = Object.freeze({
  ambiance: DEFAULT_AMBIANCE,
});

/**
 * Lecture tolérante : une ambiance retirée du catalogue, une sauvegarde abîmée ou venue d'une
 * autre version retombe sur l'origine. L'app s'ouvre toujours.
 */
export function sanitizeBench(raw: unknown): BenchChoices {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const ambiance = AMBIANCES.find((item) => item.id === source.ambiance);
  return { ambiance: ambiance ? ambiance.id : DEFAULT_BENCH.ambiance };
}

/** Peinture du banc d'essai sauvegardée par la version 1 : teinte du nuancier et finition. */
export interface LegacyPaint {
  color: Hex;
  finish: FinishId;
}

/** Teinte et finition de la version 1, si elles sont lisibles ; `null` sinon. */
export function legacyPaint(raw: unknown): LegacyPaint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const color = PAINT_COLORS.find((item) => item.id === source.color);
  const finish = FINISHES.find((item) => item.id === source.finish);
  return color && finish ? { color: color.hex, finish: finish.id } : null;
}

let pendingLegacy: LegacyPaint | null = null;

/**
 * La peinture de la version 1 devient celle de départ du modèle de banc d'essai (vague 0), une
 * fois les builds relus, et seulement s'il n'a pas encore de build.
 */
function adoptLegacyPaint(): void {
  const legacy = pendingLegacy;
  if (!legacy) return;
  const apply = () => {
    pendingLegacy = null;
    const vehicle = VEHICLES.find((item) => item.wave === 0);
    const master = vehicle ? masterZone(vehicle) : undefined;
    const builds = useBuilds.getState();
    if (!vehicle || !master || builds.builds[vehicle.id]) return;
    builds.setPaint(vehicle.id, master.id, legacy);
  };
  if (useBuilds.getState().hydrated) {
    apply();
    return;
  }
  const unsubscribe = useBuilds.subscribe((state) => {
    if (!state.hydrated) return;
    unsubscribe();
    apply();
  });
}

/** État du modèle dans la scène (non sauvegardé) ; « absent » : son fichier manque au build. */
export type BenchStatus = 'chargement' | 'pret' | 'erreur' | 'absent';

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
      partialize: ({ ambiance }) => ({ ambiance }),
      migrate: (persisted, version) => {
        if (version < 2) pendingLegacy = legacyPaint(persisted);
        return sanitizeBench(persisted);
      },
      merge: (persisted, current) => ({ ...current, ...sanitizeBench(persisted) }),
      onRehydrateStorage: () => () => {
        useBench.setState({ hydrated: true });
        adoptLegacyPaint();
      },
    },
  ),
);
