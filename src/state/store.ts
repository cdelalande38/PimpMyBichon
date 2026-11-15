// Store des réglages : Zustand, sauvegardé dans IndexedDB à chaque changement (§ 5.9, § 7).
// Les builds, livrées et commandes viendront s'y ajouter jalon après jalon.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { idbStorage } from './persistence.ts';
import { DEFAULT_SETTINGS, sanitizeSettings, type Settings } from './settings.ts';

export const SETTINGS_KEY = 'pmb-reglages';
export const SETTINGS_VERSION = 1;

export interface SettingsState extends Settings {
  /** Vrai une fois la sauvegarde relue : avant, l'interface montre les valeurs d'origine. */
  hydrated: boolean;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      hydrated: false,
      change: (key, value) => set({ [key]: value } as Pick<Settings, typeof key>),
      reset: () => set({ ...DEFAULT_SETTINGS }),
    }),
    {
      name: SETTINGS_KEY,
      version: SETTINGS_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ quality, autoRotate, textSize, autoPlay }) => ({ quality, autoRotate, textSize, autoPlay }),
      // Lecture tolérante : une sauvegarde abîmée ou venue d'une autre version retombe sur l'origine.
      migrate: (persisted) => sanitizeSettings(persisted),
      merge: (persisted, current) => ({ ...current, ...sanitizeSettings(persisted) }),
      onRehydrateStorage: () => () => {
        useSettings.setState({ hydrated: true });
      },
    },
  ),
);
