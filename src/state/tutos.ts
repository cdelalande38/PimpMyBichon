// Tutoriels : le souvenir de ceux déjà proposés (un par écran), sauvegardé dans IndexedDB sur le
// modèle du store du banc (src/state/bench.ts), lecture tolérante comprise ; et, pour la séance
// seulement, le tutoriel ouvert, son étape, la liste et la fin de l'écran de chargement.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { TUTOS } from '../data/tutos.ts';
import { idbStorage } from './persistence.ts';

export const TUTOS_KEY = 'pmb-tutos';
export const TUTOS_VERSION = 1;

/** Ce qui est sauvegardé : les tutoriels déjà proposés, par identifiant. */
export interface TutoChoices {
  vus: Record<string, true>;
}

/**
 * Lecture tolérante : seuls les identifiants connus marqués d'un « vrai » explicite comptent. Un
 * tutoriel retiré des données s'oublie ; une sauvegarde abîmée retombe sur « rien de vu ».
 */
export function sanitizeTutos(raw: unknown): TutoChoices {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).vus : undefined;
  const vus: Record<string, true> = {};
  if (typeof source !== 'object' || source === null || Array.isArray(source)) return { vus };
  for (const tuto of TUTOS) {
    if (Object.prototype.hasOwnProperty.call(source, tuto.id) && (source as Record<string, unknown>)[tuto.id] === true) vus[tuto.id] = true;
  }
  return { vus };
}

/** Tutoriel ouvert : son identifiant, l'étape lue, et s'il s'est proposé tout seul. */
export interface TutoOuvert {
  id: string;
  etape: number;
  auto: boolean;
}

export interface TutoState extends TutoChoices {
  hydrated: boolean;
  /** L'écran de chargement s'est effacé : un tutoriel peut se proposer. */
  pret: boolean;
  ouvert: TutoOuvert | null;
  /** La liste de tous les tutoriels est affichée (depuis « ? »). */
  liste: boolean;
  /** Retient qu'un tutoriel a été proposé : il ne reviendra plus tout seul. */
  marquer: (id: string) => void;
  /** Ouvre un tutoriel à sa première étape ; `auto` : proposé tout seul (il est alors retenu). */
  ouvrir: (id: string, auto?: boolean) => void;
  etape: (etape: number) => void;
  /** Affiche la liste de tous les tutoriels. */
  montrerListe: () => void;
  fermer: () => void;
  setPret: () => void;
}

export const useTutos = create<TutoState>()(
  persist(
    (set) => ({
      vus: {},
      hydrated: false,
      pret: false,
      ouvert: null,
      liste: false,
      marquer: (id) => set((state) => (state.vus[id] ? state : { vus: { ...state.vus, [id]: true } })),
      ouvrir: (id, auto = false) =>
        set((state) => {
          if (!TUTOS.some((tuto) => tuto.id === id)) return state;
          return { ouvert: { id, etape: 0, auto }, liste: false, vus: auto ? { ...state.vus, [id]: true } : state.vus };
        }),
      etape: (etape) => set((state) => (state.ouvert ? { ouvert: { ...state.ouvert, etape } } : state)),
      montrerListe: () => set({ liste: true, ouvert: null }),
      fermer: () => set({ ouvert: null, liste: false }),
      setPret: () => set((state) => (state.pret ? state : { pret: true })),
    }),
    {
      name: TUTOS_KEY,
      version: TUTOS_VERSION,
      storage: createJSONStorage(() => idbStorage),
      partialize: ({ vus }) => ({ vus }),
      migrate: (persisted) => sanitizeTutos(persisted),
      // Un tutoriel retenu avant la relecture (rare) n'est pas oublié par elle.
      merge: (persisted, current) => ({ ...current, vus: { ...sanitizeTutos(persisted).vus, ...current.vus } }),
      onRehydrateStorage: () => () => {
        useTutos.setState({ hydrated: true });
      },
    },
  ),
);
