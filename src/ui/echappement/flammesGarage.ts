// Retour de flammes au garage (Mécanique · Échappement, bloc « Écouter ») : un coup de gaz tenu puis
// lâché d'un coup fait cracher la ligne libre par les sorties, comme en sortie de nuit. Le panneau compte
// les tirs ici ; la scène du garage les montre (src/scene/vehicle/flammes.ts, useFlammesGarage) ; le
// claquement enregistré du moteur part avec (./claquement.ts). Pas de three ici : le menu le charge sans la 3D.

import { create } from 'zustand';
import type { RetourFlammes } from '../../data/echappement.ts';

export interface FlammesGarageState {
  /** Tirs depuis l'ouverture de l'app. */
  tirs: number;
  /** Instant du dernier tir (ms, horloge de la page), pour l'attente entre deux jets. */
  dernier: number;
  tirer: (maintenant: number) => void;
}

export const useFlammesGarage = create<FlammesGarageState>()((set) => ({
  tirs: 0,
  dernier: -Infinity,
  tirer: (maintenant) => set((state) => ({ tirs: state.tirs + 1, dernier: maintenant })),
}));

/**
 * Le lâcher d'un coup de gaz fait-il cracher ? Une ligne qui crache, un véhicule aux sorties déclarées,
 * un coup de gaz tenu au moins `regle.tenueGarage` secondes (le régime a eu le temps de monter) et
 * l'attente de la ligne écoulée depuis le dernier jet. Durées en secondes.
 */
export function crache(regle: RetourFlammes | undefined, sorties: number, tenue: number, depuis: number): boolean {
  if (!regle || sorties <= 0) return false;
  if (!(tenue >= regle.tenueGarage)) return false;
  return depuis >= regle.attente;
}
