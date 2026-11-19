// Le choix du duel au menu de la sortie (§ 5.5, jeu) : le duel est-il choisi, contre quel adversaire, à quel
// niveau. Gardé sur l'appareil (IndexedDB, comme les préférences de la sortie). Le duel se court en un tour ; il
// ne vaut ni en carrière ni en balade (src/drive/adversaire/course.ts, `duelDeLaSortie`).
//
// Sans adversaire choisi (`null`), c'est celui à la mesure du joueur (`adversaireAMesure`). La sauvegarde se
// relit par `relireChoixDuel` (src/data/adversaires.ts), celle d'avant les niveaux comprise.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { ADVERSAIRES, adversaireParId, NIVEAUX_DUEL, relireChoixDuel } from '../../data/adversaires.ts';
import { idbStorage, shareAcrossTabs } from '../../state/persistence.ts';

export interface ChoixDuel {
  /** Le duel est choisi au menu (format « Duel »). */
  actif: boolean;
  /** Identifiant de l'adversaire choisi (public/assets/adversaires/adversaires.json) ; `null` : à ta mesure. */
  adversaire: string | null;
  /** Identifiant du niveau choisi ; `null` : celui par défaut du fichier. */
  niveau: string | null;
  setActif: (actif: boolean) => void;
  choisir: (id: string) => void;
  choisirNiveau: (id: string) => void;
}

export const useDuel = create<ChoixDuel>()(
  persist(
    (set) => ({
      actif: false,
      adversaire: null,
      niveau: null,
      setActif: (actif) => set((state) => (state.actif === actif || (actif && ADVERSAIRES.length === 0) ? state : { actif })),
      choisir: (id) => set((state) => (adversaireParId(id) && state.adversaire !== id ? { adversaire: id } : state)),
      choisirNiveau: (id) => set((state) => (NIVEAUX_DUEL.some((n) => n.id === id) && state.niveau !== id ? { niveau: id } : state)),
    }),
    {
      name: 'pmb-duel',
      version: 1,
      storage: createJSONStorage(() => idbStorage),
      partialize: (state) => ({ actif: state.actif, adversaire: state.adversaire, niveau: state.niveau }),
      merge: (persisted, current) => ({ ...current, ...relireChoixDuel(persisted) }),
    },
  ),
);

shareAcrossTabs(useDuel);
