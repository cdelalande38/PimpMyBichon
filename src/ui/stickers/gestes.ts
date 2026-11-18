// Gestes du plan à plat des stickers (src/ui/stickers/StickersPanel.tsx), en fonctions pures.

import type { StickerLayer } from '../../data/stickersCalques.ts';

/** Hauteur la plus grande du plan d'une zone, en pixels : le dock reste court. */
export const PLAN_MAX_HEIGHT = 104;

/** Largeur CSS du plan : toute la largeur, sauf si sa hauteur dépasserait PLAN_MAX_HEIGHT. */
export function planWidth(ratio: number): string {
  return `min(100%, ${Math.round(PLAN_MAX_HEIGHT * ratio)}px)`;
}

/**
 * Poignée ronde : d'un seul doigt, l'angle autour du centre du sticker le tourne, la distance au
 * centre l'agrandit. `from` et `to` : la poignée par rapport au centre, en pixels d'écran (y vers le
 * bas). La rotation des calques se compte dans le sens inverse des aiguilles d'une montre.
 */
export function handleGesture(
  start: Pick<StickerLayer, 'rotation' | 'size'>,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Pick<StickerLayer, 'rotation' | 'size'> {
  const reach = Math.hypot(from.x, from.y);
  const now = Math.hypot(to.x, to.y);
  const turn = Math.atan2(to.y, to.x) - Math.atan2(from.y, from.x);
  return {
    rotation: start.rotation - (turn * 180) / Math.PI,
    size: reach > 1 ? start.size * (now / reach) : start.size,
  };
}
