// État de l'établi moteur, partagé entre le panneau (src/ui/moteur/MoteurPanel.tsx) et la scène du
// garage (src/scene/moteur/Etabli.tsx, GarageCanvas.tsx) : l'écart de la vue éclatée, la pièce choisie
// et le haut du panneau à l'écran (le moteur se cadre au-dessus, comme une zone de stickers). Rien n'est
// sauvegardé : la séance seulement. L'établi est ouvert tant que l'entrée Mécanique · Moteur est à
// l'écran et que le moteur du véhicule a un modèle (src/data/moteurs.ts, engine.model).

import { create } from 'zustand';
import { familleOf, type MoteurFamille } from '../../data/moteurs.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { entryOf, useDock } from '../../state/dock.ts';

export interface EtabliState {
  /** Vue éclatée : 0, le moteur assemblé ; 1, les pièces écartées de tout leur vecteur. */
  eclate: number;
  /** Pièce touchée dans le panneau (surlignée dans la scène) ; `null` : aucune (le panneau montre la première, rien ne s'allume). */
  piece: string | null;
  /** Haut du panneau à l'écran (le dock qui le porte), en pixels CSS ; `null` : pas mesuré. */
  coverTop: number | null;
  setEclate: (value: number) => void;
  setPiece: (piece: string | null) => void;
  setCoverTop: (top: number | null) => void;
}

/** Écart en deçà duquel un panneau qui bouge un peu ne recadre pas le moteur, en pixels CSS. */
const COVER_TOLERANCE = 6;

export const useEtabli = create<EtabliState>()((set) => ({
  eclate: 0,
  piece: null,
  coverTop: null,
  setEclate: (value) => set({ eclate: Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0 }),
  setPiece: (piece) => set({ piece }),
  setCoverTop: (top) =>
    set((state) => {
      if (top === state.coverTop) return state;
      if (top !== null && state.coverTop !== null && Math.abs(top - state.coverTop) < COVER_TOLERANCE) return state;
      return { coverTop: top };
    }),
}));

/** Vrai tant que le contenu de l'entrée Mécanique · Moteur est à l'écran. */
export function useEntreeMoteur(): boolean {
  return useDock((state) => state.section === 'mecanique' && state.menu === 'contenu' && entryOf('mecanique', state.entries) === 'moteur');
}

/** La famille du moteur sorti sur l'établi ; `null` : l'établi est fermé (entrée fermée, ou moteur sans modèle). */
export function useEtabliOuvert(vehicle: Pick<VehicleManifest, 'engine'>): MoteurFamille | null {
  const open = useEntreeMoteur();
  return open ? (familleOf(vehicle) ?? null) : null;
}
