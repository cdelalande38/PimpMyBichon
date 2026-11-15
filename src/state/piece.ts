// Pièce cliquable : la scène (src/scene/extras/SceneExtras.tsx) y range la position à l'écran des
// pastilles à chaque image rendue ; l'interface (src/ui/overlay/SceneOverlay.tsx) les dessine et y
// dit si un panneau couvre la scène. Jamais sauvegardé.

import { create } from 'zustand';

/** Pastille visible : point d'intérêt et centre, en pixels CSS de la fenêtre. */
export interface PiecePin {
  id: string;
  x: number;
  y: number;
}

export interface PieceState {
  pins: readonly PiecePin[];
  /** Un panneau est ouvert : la scène ne répond plus aux appuis. */
  covered: boolean;
  setPins: (pins: readonly PiecePin[]) => void;
}

export function samePins(a: readonly PiecePin[], b: readonly PiecePin[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((pin, index) => {
    const other = b[index];
    return other !== undefined && other.id === pin.id && other.x === pin.x && other.y === pin.y;
  });
}

export const usePiece = create<PieceState>()((set, get) => ({
  pins: [],
  covered: false,
  setPins: (pins) => {
    if (!samePins(get().pins, pins)) set({ pins });
  },
}));
