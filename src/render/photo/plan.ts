// Plan du rendu photo : réglages par niveau de qualité et taille d'export. Module pur.

import type { QualityLevel } from '../quality.ts';

export interface PhotoPlan {
  /** Nombre d'images décalées accumulées (§ 8 : l'image s'affine en une à deux secondes). */
  frames: number;
  /** Côté d'une face de la sonde de réflexion en photo, en pixels. */
  probeSize: number;
  /** Profondeur de champ par déplacement de la caméra sur un disque d'ouverture. */
  depthOfField: boolean;
  /** Durée maximale de l'affinage, en millisecondes : on s'arrête là même si `frames` n'est pas atteint. */
  maxMs: number;
}

export const PHOTO_PLANS: Readonly<Record<QualityLevel, PhotoPlan>> = Object.freeze({
  eco: { frames: 12, probeSize: 512, depthOfField: false, maxMs: 1000 },
  standard: { frames: 32, probeSize: 1024, depthOfField: true, maxMs: 1500 },
  max: { frames: 64, probeSize: 1024, depthOfField: true, maxMs: 2000 },
});

export function photoPlan(level: QualityLevel): PhotoPlan {
  return PHOTO_PLANS[level];
}

/** Largeur de l'image partagée, en pixels (§ 8). */
export const EXPORT_WIDTH = 2160;

export interface Tile {
  /** Position de la tuile dans l'image complète, en pixels (origine en haut à gauche). */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ExportSize {
  width: number;
  height: number;
  /** Rapport entre la taille d'export et celle de l'écran (en pixels CSS). */
  factor: number;
  /** Vrai si l'image dépasse la taille maximale de texture et doit être rendue en tuiles. */
  tiled: boolean;
  columns: number;
  rows: number;
  /** Tuiles couvrant exactement l'image, dans l'ordre de lecture ; une seule si `tiled` est faux. */
  tiles: readonly Tile[];
}

/** Découpe `total` pixels en `parts` tronçons entiers de longueurs presque égales. */
function split(total: number, parts: number): number[] {
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, index) => base + (index < extra ? 1 : 0));
}

/**
 * Taille d'export pour un écran de `screenWidth` × `screenHeight`, une largeur visée de `target`
 * pixels (2160 par défaut) et une taille de texture maximale `maxTexture`. La hauteur garde la
 * proportion de l'écran. Si un côté dépasse `maxTexture`, l'image est découpée en tuiles qui
 * y tiennent toutes.
 */
export function exportSize(
  screenWidth: number,
  screenHeight: number,
  target: number = EXPORT_WIDTH,
  maxTexture = 4096,
): ExportSize {
  if (!(screenWidth > 0) || !(screenHeight > 0)) {
    throw new RangeError(`Taille d'écran invalide : ${screenWidth} × ${screenHeight}`);
  }
  if (!Number.isFinite(screenWidth) || !Number.isFinite(screenHeight)) {
    throw new RangeError('Taille d’écran non finie');
  }
  if (!(target >= 1)) throw new RangeError(`Largeur visée invalide : ${target}`);
  if (!(maxTexture >= 1)) throw new RangeError(`Taille de texture maximale invalide : ${maxTexture}`);

  const width = Math.round(target);
  const height = Math.max(1, Math.round((screenHeight * width) / screenWidth));
  const limit = Math.floor(maxTexture);
  const columns = Math.ceil(width / limit);
  const rows = Math.ceil(height / limit);

  const widths = split(width, columns);
  const heights = split(height, rows);
  const tiles: Tile[] = [];
  let y = 0;
  for (const tileHeight of heights) {
    let x = 0;
    for (const tileWidth of widths) {
      tiles.push({ x, y, width: tileWidth, height: tileHeight });
      x += tileWidth;
    }
    y += tileHeight;
  }

  return { width, height, factor: width / screenWidth, tiled: tiles.length > 1, columns, rows, tiles };
}
