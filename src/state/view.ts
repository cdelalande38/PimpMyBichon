// Vue de la scène : l'atelier (on tourne autour du véhicule) ou l'intérieur (§ 5.1 du cahier des
// charges), à l'un des points de vue du manifeste. Jamais sauvegardée : l'app s'ouvre sur l'atelier.
// La scène y publie aussi la pose du véhicule dans la pièce (son côté de présentation).

import { create } from 'zustand';
import { GARAGE } from '../data/garage.ts';

export type ViewMode = 'atelier' | 'interieur';

export interface ViewState {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  /** Entre dans la vue intérieure, ou en sort. */
  toggle: () => void;
  /** Rang du point de vue intérieur (interiorViewsOf, src/data/vehicles.ts) ; 0 en atelier. */
  seat: number;
  /**
   * Appui sur le bouton rond, pour un véhicule à `count` points de vue : de l'atelier au premier,
   * de chacun au suivant, du dernier à l'atelier.
   */
  next: (count: number) => void;
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
  setMode: (mode) => set((state) => (state.mode === mode ? state : { mode, seat: 0 })),
  toggle: () => set((state) => ({ mode: state.mode === 'atelier' ? 'interieur' : 'atelier', seat: 0 })),
  seat: 0,
  next: (count) =>
    set((state) => {
      if (state.mode === 'atelier') return count > 0 ? { mode: 'interieur', seat: 0 } : state;
      return state.seat + 1 < count ? { seat: state.seat + 1 } : { mode: 'atelier', seat: 0 };
    }),
  turn: GARAGE.vehicle.turn,
  setTurn: (turn) => set((state) => (state.turn === turn ? state : { turn })),
}));
