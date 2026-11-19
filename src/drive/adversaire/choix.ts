// Le choix du duel au menu de la sortie (§ 5.5, jeu) : le duel est-il choisi, et contre quel adversaire.
// Gardé sur l'appareil (IndexedDB, comme les préférences de la sortie). Le duel se court en un tour ; il
// ne vaut ni en carrière ni en balade (src/drive/adversaire/course.ts, `duelDeLaSortie`).

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ADVERSAIRES, adversaireParId } from '../../data/adversaires.ts';
import { idbStorage, shareAcrossTabs } from '../../state/persistence.ts';

export interface ChoixDuel {
  /** Le duel est choisi au menu (format « Duel »). */
  actif: boolean;
  /** Identifiant de l'adversaire choisi (public/assets/adversaires/adversaires.json). */
  adversaire: string | null;
  setActif: (actif: boolean) => void;
  choisir: (id: string) => void;
}

export const useDuel = create<ChoixDuel>()(
  persist(
    (set) => ({
      actif: false,
      adversaire: ADVERSAIRES[0]?.id ?? null,
      setActif: (actif) => set((state) => (state.actif === actif || (actif && ADVERSAIRES.length === 0) ? state : { actif })),
      choisir: (id) => set((state) => (adversaireParId(id) && state.adversaire !== id ? { adversaire: id } : state)),
    }),
    {
      name: 'pmb-duel',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ actif: state.actif, adversaire: state.adversaire }),
      merge: (persisted, current) => {
        const p = (typeof persisted === 'object' && persisted !== null ? persisted : {}) as Partial<ChoixDuel>;
        return { ...current, actif: p.actif === true && ADVERSAIRES.length > 0, adversaire: adversaireParId(p.adversaire)?.id ?? current.adversaire };
      },
    },
  ),
);

shareAcrossTabs(useDuel);
