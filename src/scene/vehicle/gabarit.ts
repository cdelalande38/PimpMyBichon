// Gabarit du véhicule posé au garage : demi-longueur, demi-largeur et hauteur, dans le repère du modèle
// préparé (src/scene/vehicle/VehicleModel.tsx, `prepare` : centré en X et Z, avant vers +X, posé au sol à
// y = 0). Publié par la scène une fois le modèle posé, lu par les panneaux qui cadrent une partie du
// véhicule (Custom › Phares : l'avant, l'arrière, src/data/framings.ts). Rien n'est sauvegardé ; aucune
// dépendance à three : le menu le lit sans charger la 3D.

import { create } from 'zustand';

export interface Gabarit {
  halfLength: number;
  halfWidth: number;
  height: number;
}

export interface GabaritState {
  /** Véhicule mesuré, et son gabarit ; `null` tant qu'aucun modèle n'est posé. */
  vehicle: string | null;
  gabarit: Gabarit | null;
  poser: (vehicle: string, gabarit: Gabarit) => void;
}

export const useGabarit = create<GabaritState>()((set) => ({
  vehicle: null,
  gabarit: null,
  poser: (vehicle, gabarit) =>
    set((state) => {
      const old = state.gabarit;
      if (state.vehicle === vehicle && old && old.halfLength === gabarit.halfLength && old.halfWidth === gabarit.halfWidth && old.height === gabarit.height) return state;
      return { vehicle, gabarit: { halfLength: gabarit.halfLength, halfWidth: gabarit.halfWidth, height: gabarit.height } };
    }),
}));
