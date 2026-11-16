// Vue de la scène : l'atelier (on tourne autour du véhicule) ou l'intérieur (§ 5.1 du cahier des
// charges), assis à l'une des places du manifeste (conducteur, passager, arrière). Le mode n'est
// jamais sauvegardé : l'app s'ouvre sur l'atelier. La place choisie, elle, est gardée par véhicule
// d'une visite à l'autre (stockage du téléphone). La scène y publie aussi la pose du véhicule dans la
// pièce (son côté de présentation).

import { create } from 'zustand';
import { GARAGE } from '../data/garage.ts';
import type { PlaceId } from '../data/vehicleTypes.ts';

export type ViewMode = 'atelier' | 'interieur';

/** Clé du stockage du téléphone : la place choisie de chaque véhicule. */
export const PLACES_KEY = 'pmb-places';

const PLACE_IDS: readonly PlaceId[] = ['conducteur', 'passager', 'arriere'];

/** Places gardées, relues telles quelles ; une valeur inconnue est oubliée. */
export function readPlaces(raw: string | null): Record<string, PlaceId> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const out: Record<string, PlaceId> = {};
    for (const [vehicle, place] of Object.entries(parsed)) {
      if (/^[a-z0-9][a-z0-9_-]{0,63}$/.test(vehicle) && PLACE_IDS.includes(place as PlaceId)) out[vehicle] = place as PlaceId;
    }
    return out;
  } catch {
    return {};
  }
}

function loadPlaces(): Record<string, PlaceId> {
  try {
    return typeof localStorage === 'undefined' ? {} : readPlaces(localStorage.getItem(PLACES_KEY));
  } catch {
    return {};
  }
}

function savePlaces(places: Record<string, PlaceId>): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(PLACES_KEY, JSON.stringify(places));
  } catch {
    // Stockage refusé (navigation privée) : la place vaut pour la séance.
  }
}

export interface ViewState {
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  /** Entre dans la vue intérieure, ou en sort (la place reste celle du moment). */
  toggle: () => void;
  /** Place où l'on est assis en vue intérieure ; une place que le véhicule n'a pas retombe sur le conducteur. */
  place: PlaceId;
  /** Place choisie de chaque véhicule (identifiant du véhicule → place), gardée d'une visite à l'autre. */
  places: Record<string, PlaceId>;
  /**
   * Ancre que le regard vise en s'asseyant (Custom › Intérieur : le pommeau) ; `null` : le regard par
   * défaut de la place. Effacée par un choix de place à la main.
   */
  focus: string | null;
  /**
   * S'asseoir à `place` dans le véhicule `vehicle` (on entre si l'on était dehors). `remember` : la
   * garder pour ce véhicule (choix à la main) ; faux pour une place choisie par l'app (Custom › Intérieur),
   * qui peut viser une ancre (`focus`).
   */
  sit: (vehicle: string, place: PlaceId, remember?: boolean, focus?: string | null) => void;
  /** Bouton rond : depuis l'atelier, entrer à la place gardée du véhicule (le conducteur sinon) ; dedans, sortir. */
  enterOrLeave: (vehicle: string) => void;
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
  place: 'conducteur',
  places: loadPlaces(),
  focus: null,
  sit: (vehicle, place, remember = true, focus = null) =>
    set((state) => {
      const places = remember && state.places[vehicle] !== place ? { ...state.places, [vehicle]: place } : state.places;
      if (places !== state.places) savePlaces(places);
      if (state.mode === 'interieur' && state.place === place && state.focus === focus && places === state.places) return state;
      return { mode: 'interieur', place, places, focus };
    }),
  enterOrLeave: (vehicle) =>
    set((state) => (state.mode === 'interieur' ? { mode: 'atelier', focus: null } : { mode: 'interieur', place: state.places[vehicle] ?? 'conducteur', focus: null })),
  turn: GARAGE.vehicle.turn,
  setTurn: (turn) => set((state) => (state.turn === turn ? state : { turn })),
}));
