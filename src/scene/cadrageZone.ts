// Demande de cadrage d'une zone de livrée, du panneau des stickers (src/ui/stickers/) à la scène du
// garage (src/scene/GarageCanvas.tsx, useZoneFraming) : tant que le panneau est ouvert, la zone choisie
// est montrée en grand au-dessus de lui ; il retire sa demande en se fermant, la caméra revient à la
// vue d'avant. Le panneau dit aussi où il commence à l'écran (le haut du dock, en portrait) : la scène
// cadre la zone dans ce qu'il laisse libre. Rien n'est sauvegardé.

import { create } from 'zustand';

export interface ZoneFocus {
  vehicle: string;
  /** Identifiant de la zone de livrée (manifeste, `livery[].id`). */
  zone: string;
}

export interface ZoneFocusState {
  focus: ZoneFocus | null;
  /** Haut du panneau à l'écran, en pixels CSS depuis le haut ; `null` : pas encore mesuré. */
  coverTop: number | null;
  setFocus: (focus: ZoneFocus | null) => void;
  setCoverTop: (top: number | null) => void;
}

/** Écart en deçà duquel un panneau qui bouge un peu ne recadre pas la zone, en pixels CSS. */
export const COVER_TOLERANCE = 6;

export const useZoneFocus = create<ZoneFocusState>()((set) => ({
  focus: null,
  coverTop: null,
  setFocus: (focus) =>
    set((state) => {
      if (focus === state.focus) return state;
      if (focus && state.focus && focus.vehicle === state.focus.vehicle && focus.zone === state.focus.zone) return state;
      return { focus };
    }),
  setCoverTop: (top) =>
    set((state) => {
      if (top === state.coverTop) return state;
      if (top !== null && state.coverTop !== null && Math.abs(top - state.coverTop) < COVER_TOLERANCE) return state;
      return { coverTop: top };
    }),
}));
