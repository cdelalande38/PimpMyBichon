// Vue de la scène : l'atelier (on tourne autour du véhicule) ou l'intérieur (à l'œil du
// conducteur, § 5.1 du cahier des charges). Jamais sauvegardée : l'app s'ouvre sur l'atelier.
// La scène y publie aussi la pose du véhicule dans la pièce (son côté de présentation).

import { create } from 'zustand';
import { GARAGE } from '../data/garage.ts';

export type ViewMode = 'atelier' | 'interieur';

export interface ViewState {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  /** Entre dans la vue intérieure, ou en sort. */
  toggle: () => void;
  /**
   * Rotation du groupe du véhicule autour de la verticale, en radians (π : nez à gauche, 0 : nez
   * à droite, selon `presentSide` du manifeste). Posée par la scène ; repère du véhicule → pièce :
   * src/scene/fit.ts, vehicleToRoom.
   */
  turn: number;
  setTurn: (turn: number) => void;
}

export const useView = create<ViewState>()((set) => ({
  mode: 'atelier',
  setMode: (mode) => set((state) => (state.mode === mode ? state : { mode })),
  toggle: () => set((state) => ({ mode: state.mode === 'atelier' ? 'interieur' : 'atelier' })),
  turn: GARAGE.vehicle.turn,
  setTurn: (turn) => set((state) => (state.turn === turn ? state : { turn })),
}));
