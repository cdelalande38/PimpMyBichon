// Demande de cadrage d'une zone de livrée, du panneau des stickers (src/ui/stickers/) à la scène du
// garage (src/scene/GarageCanvas.tsx, useZoneFraming) : tant que le panneau est ouvert, la zone choisie
// est montrée en grand au-dessus de lui ; il retire sa demande en se fermant, la caméra revient à la
// vue d'avant. Le panneau dit aussi où il commence à l'écran (le haut du dock, en portrait) : la scène
// cadre la zone dans ce qu'il laisse libre. Rien n'est sauvegardé. Le panneau du kit carrosserie
// (src/ui/pieces/) demande de même un cadre qu'il donne tel quel (avant, flanc, arrière de la caisse).

import { create } from 'zustand';
import type { LiveryFace } from '../data/stickersCalques.ts';

export interface ZoneFocus {
  vehicle: string;
  /** Identifiant de la zone de livrée (manifeste, `livery[].id`), ou du cadre donné par `box`. */
  zone: string;
  /** Cadre donné tel quel, repère du véhicule (pièce montée : src/data/pieces.ts, railZone) ; absent : la zone de livrée. */
  box?: { face: LiveryFace; center: readonly [number, number, number]; size: readonly [number, number, number] };
}

/** Colonne des boutons ronds, à droite de l'écran en portrait : son bord gauche et son bas, en pixels CSS. */
export interface RailBox {
  left: number;
  bottom: number;
}

export interface ZoneFocusState {
  focus: ZoneFocus | null;
  /** Haut du panneau à l'écran, en pixels CSS depuis le haut ; `null` : pas encore mesuré. */
  coverTop: number | null;
  /** Colonne des boutons ronds à droite (portrait) ; `null` : pas de colonne de ce côté, ou pas encore mesurée. */
  rail: RailBox | null;
  setFocus: (focus: ZoneFocus | null) => void;
  setCoverTop: (top: number | null) => void;
  setRail: (rail: RailBox | null) => void;
}

/** Écart en deçà duquel un panneau qui bouge un peu ne recadre pas la zone, en pixels CSS. */
export const COVER_TOLERANCE = 6;

/** Écart gardé entre la zone cadrée et la colonne des boutons ronds, en pixels CSS. */
export const RAIL_GAP = 10;

/** Rectangle à l'écran, en pixels CSS. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Vrai si la zone, telle qu'elle serait vue, passe sous la colonne des boutons ronds (ou à moins de `RAIL_GAP`). */
export function railCovers(zone: ScreenBox, rail: RailBox | null): boolean {
  return rail !== null && zone.right > rail.left - RAIL_GAP && zone.top < rail.bottom + RAIL_GAP;
}

/** La partie libre coupée à gauche de la colonne des boutons ronds (au moins un pixel de large). */
export function freeBesideRail(free: ScreenBox, rail: RailBox): ScreenBox {
  return { ...free, right: Math.max(free.left + 1, Math.min(free.right, Math.round(rail.left - RAIL_GAP))) };
}

/** La partie libre commencée sous la colonne des boutons ronds (au moins un pixel de haut). */
export function freeBelowRail(free: ScreenBox, rail: RailBox): ScreenBox {
  return { ...free, top: Math.min(free.bottom - 1, Math.max(free.top, Math.round(rail.bottom + RAIL_GAP))) };
}

/** Part de sa largeur qu'une zone doit garder quand on la descend sous la colonne : en deçà, on la serre plutôt à sa gauche. */
export const RAIL_KEEP_WIDTH = 0.9;

export type RailPlace = 'libre' | 'dessous' | 'cote';

/**
 * Où cadrer une zone pour que la colonne des boutons ronds ne la recouvre pas : telle quelle si elle
 * est déjà à l'écart ; sinon plus bas, sous la colonne (la partie libre du portrait est haute, un
 * flanc a la place, et garde sa taille) ; sinon, quand la zone est trop haute pour cela (toit),
 * serrée à gauche de la colonne. `fit` cadre la zone dans la partie libre donnée.
 */
export function placeBesideRail<T extends { zoneFrame: ScreenBox }>(fit: (free: ScreenBox) => T, free: ScreenBox, rail: RailBox | null): { fit: T; free: ScreenBox; place: RailPlace } {
  const first = fit(free);
  if (!railCovers(first.zoneFrame, rail)) return { fit: first, free, place: 'libre' };
  const below = freeBelowRail(free, rail!);
  const lower = fit(below);
  if (!railCovers(lower.zoneFrame, rail) && lower.zoneFrame.right - lower.zoneFrame.left >= RAIL_KEEP_WIDTH * (first.zoneFrame.right - first.zoneFrame.left)) return { fit: lower, free: below, place: 'dessous' };
  const beside = freeBesideRail(free, rail!);
  return { fit: fit(beside), free: beside, place: 'cote' };
}

export const useZoneFocus = create<ZoneFocusState>()((set) => ({
  focus: null,
  coverTop: null,
  rail: null,
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
  setRail: (rail) =>
    set((state) => {
      const old = state.rail;
      if (rail === old) return state;
      if (rail && old && Math.abs(rail.left - old.left) < COVER_TOLERANCE && Math.abs(rail.bottom - old.bottom) < COVER_TOLERANCE) return state;
      return { rail };
    }),
}));
