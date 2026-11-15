// Pièce cliquable : la scène (src/scene/extras/SceneExtras.tsx) y range la position à l'écran des
// pastilles à chaque image rendue ; l'interface (src/ui/overlay/SceneOverlay.tsx) les dessine et y
// dit si un panneau couvre la scène. Jamais sauvegardé.
//
// Les pastilles sont des repères brefs : au repos, rien ne couvre l'image (l'enseigne du mur se lit) ;
// elles s'allument à l'arrivée et à la fin d'un geste sur la scène, puis s'effacent seules. Les
// objets, eux, répondent toujours à un appui.

import { create } from 'zustand';

/** Pastille visible : point d'intérêt et centre, en pixels CSS de la fenêtre. */
export interface PiecePin {
  id: string;
  x: number;
  y: number;
}

/** Durée d'affichage des repères après l'arrivée ou la fin d'un geste, en millisecondes. */
export const PIN_HINT_MS = 5000;

export interface PieceState {
  pins: readonly PiecePin[];
  /** Un panneau est ouvert : la scène ne répond plus aux appuis. */
  covered: boolean;
  /** Repères allumés. */
  shown: boolean;
  setPins: (pins: readonly PiecePin[]) => void;
  /** Allume les repères, qui s'effacent seuls après `PIN_HINT_MS`. */
  reveal: () => void;
  /** Efface les repères tout de suite : un geste commence sur la scène. */
  hide: () => void;
}

export function samePins(a: readonly PiecePin[], b: readonly PiecePin[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pin, index) => {
    const other = b[index];
    return other !== undefined && other.id === pin.id && other.x === pin.x && other.y === pin.y;
  });
}

let hintTimer: ReturnType<typeof setTimeout> | undefined;

export const usePiece = create<PieceState>()((set, get) => ({
  pins: [],
  covered: false,
  shown: false,
  setPins: (pins) => {
    if (!samePins(get().pins, pins)) set({ pins });
  },
  reveal: () => {
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => set({ shown: false }), PIN_HINT_MS);
    if (!get().shown) set({ shown: true });
  },
  hide: () => {
    clearTimeout(hintTimer);
    if (get().shown) set({ shown: false });
  },
}));
