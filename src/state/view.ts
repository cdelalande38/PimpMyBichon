// Vue de la scène : l'atelier (on tourne autour du véhicule) ou l'intérieur (à l'œil du
// conducteur, § 5.1 du cahier des charges). Jamais sauvegardée : l'app s'ouvre sur l'atelier.

import { create } from 'zustand';

export type ViewMode = 'atelier' | 'interieur';

export interface ViewState {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
}

export const useView = create<ViewState>()((set) => ({
  mode: 'atelier',
  setMode: (mode) => set({ mode }),
}));
