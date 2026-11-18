// Le capot moteur ouvert ou fermé (vague U, demande du 18 novembre 2026) : un petit état partagé entre
// la pastille de la scène (src/ui/overlay/CapotPastille.tsx), la scène du garage (./capot.ts) et, plus
// tard, le panneau Mécanique · Moteur, qui n'a qu'à appeler `ouvrirCapot` ou `fermerCapot`. Rien n'est
// sauvegardé : un capot ouvert se referme au changement de véhicule et au rechargement. Ce qui est
// posé sur le capot (vitré, déposé) est une pièce du build (src/data/pieces.ts, poste du capot).

import { create } from 'zustand';

/** Position à l'écran de la pastille du capot, en pixels CSS ; `null` : hors de vue. */
export interface CapotPin {
  x: number;
  y: number;
}

export interface CapotState {
  /** Véhicule dont le capot est ouvert ; `null` : fermé. */
  ouvert: string | null;
  /** Véhicule à l'écran du garage qui a un capot qui s'ouvre ; `null` : aucun (van, motos). */
  vehicule: string | null;
  /** Où dessiner la pastille (la scène la pose à chaque image rendue). */
  pin: CapotPin | null;
  setVehicule: (id: string | null) => void;
  setPin: (pin: CapotPin | null) => void;
}

export const useCapot = create<CapotState>()((set, get) => ({
  ouvert: null,
  vehicule: null,
  pin: null,
  setVehicule: (id) => {
    if (get().vehicule === id) return;
    // Un autre véhicule : son capot part fermé.
    set({ vehicule: id, ouvert: null, pin: null });
  },
  setPin: (pin) => {
    const old = get().pin;
    if (old === pin || (old && pin && old.x === pin.x && old.y === pin.y)) return;
    set({ pin });
  },
}));

/** Ouvre le capot du véhicule à l'écran du garage (s'il en a un qui s'ouvre). Rend vrai si c'est fait. */
export function ouvrirCapot(): boolean {
  const { vehicule, ouvert } = useCapot.getState();
  if (!vehicule) return false;
  if (ouvert !== vehicule) useCapot.setState({ ouvert: vehicule });
  return true;
}

/** Referme le capot. */
export function fermerCapot(): void {
  if (useCapot.getState().ouvert !== null) useCapot.setState({ ouvert: null });
}

/** Ouvre le capot s'il est fermé, le referme sinon. */
export function basculerCapot(): void {
  const { vehicule, ouvert } = useCapot.getState();
  if (ouvert !== null && ouvert === vehicule) fermerCapot();
  else ouvrirCapot();
}

/** Vrai tant que le capot du véhicule à l'écran est ouvert. */
export function useCapotOuvert(): boolean {
  return useCapot((state) => state.vehicule !== null && state.ouvert === state.vehicule);
}
