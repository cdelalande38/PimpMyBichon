// Pièce cliquable, logique pure : boîtes des objets visés, lancer de rayon contre ces boîtes,
// geste « appui court », matériau du véhicule → zone du manifeste. Rien ici ne tourne au repos :
// le lancer de rayon ne se fait qu'au moment d'un appui.

import { paintZoneOf } from '../../data/materialRoles.ts';
import type { PointInteret } from '../../data/pointsInteret.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { masterZone } from '../../state/builds.ts';
import type { Box, CutElement, Point } from '../garage/cut.ts';

/** Appui court : moins de 300 ms, moins de 10 px de déplacement, un seul doigt. */
export const TAP = { maxMs: 300, maxMove: 10 } as const;

/** Objet visé par un point d'intérêt : ses boîtes (repère de la pièce) et son identifiant de coupe. */
export interface PieceTarget {
  point: PointInteret;
  boxes: readonly Box[];
  /** Identifiant dans la coupe caméra (fondu à `fades[cutId]`) ; 0 : jamais coupé. */
  cutId: number;
  /** Ancre de la pastille : centre de l'ensemble des boîtes. */
  anchor: Point;
}

export function unionBox(boxes: readonly Box[]): Box | null {
  const valid = boxes.filter((box) => box.min[0] <= box.max[0] && box.min[1] <= box.max[1] && box.min[2] <= box.max[2]);
  if (valid.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of valid) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Infinity, box.min[axis] ?? Infinity);
      max[axis] = Math.max(max[axis] ?? -Infinity, box.max[axis] ?? -Infinity);
    }
  }
  return { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] };
}

const centerOf = (box: Box): Point => ({ x: (box.min[0] + box.max[0]) / 2, y: (box.min[1] + box.max[1]) / 2, z: (box.min[2] + box.max[2]) / 2 });

/**
 * Ancre de la pastille : le point donné par les données s'il y en a un, sinon le centre de la pièce
 * de l'objet la plus proche du centre de l'ensemble (toujours sur l'objet, même en deux groupes,
 * comme les enceintes de part et d'autre de la colonne).
 */
export function anchorOf(parts: readonly Box[], at?: readonly [number, number, number]): Point | null {
  const union = unionBox(parts);
  if (!union) return null;
  if (at) return { x: at[0], y: at[1], z: at[2] };
  const middle = centerOf(union);
  let best: Point | null = null;
  let bestDistance = Infinity;
  for (const part of parts) {
    if (part.min[0] > part.max[0]) continue;
    const center = centerOf(part);
    const distance = Math.hypot(center.x - middle.x, center.y - middle.y, center.z - middle.z);
    if (distance < bestDistance) [best, bestDistance] = [center, distance];
  }
  return best;
}

/**
 * Objets visés, d'après les éléments de la coupe caméra (une boîte par pièce de l'objet, comme
 * build.ts les déduit des données). Un point dont l'objet manque est ignoré (et signalé par le
 * test des données).
 */
export function targetsFromElements(elements: readonly CutElement[], points: readonly PointInteret[]): PieceTarget[] {
  const targets: PieceTarget[] = [];
  for (const point of points) {
    const index = elements.findIndex((element) => element.name === point.target);
    const element = elements[index];
    if (!element) continue;
    const anchor = anchorOf(element.parts, point.at);
    if (!anchor) continue;
    targets.push({ point, boxes: element.parts, cutId: index + 1, anchor });
  }
  return targets;
}

/**
 * Distance d'entrée d'un rayon dans une boîte (méthode des dalles), 0 si l'origine est dedans,
 * null s'il la manque ou si elle est derrière lui.
 */
export function rayBox(origin: Point, dir: Point, box: Box): number | null {
  let near = -Infinity;
  let far = Infinity;
  const o = [origin.x, origin.y, origin.z];
  const d = [dir.x, dir.y, dir.z];
  for (let axis = 0; axis < 3; axis += 1) {
    const start = o[axis] ?? 0;
    const step = d[axis] ?? 0;
    const lo = box.min[axis] ?? 0;
    const hi = box.max[axis] ?? 0;
    if (Math.abs(step) < 1e-12) {
      if (start < lo || start > hi) return null;
      continue;
    }
    let t1 = (lo - start) / step;
    let t2 = (hi - start) / step;
    if (t1 > t2) [t1, t2] = [t2, t1];
    near = Math.max(near, t1);
    far = Math.min(far, t2);
    if (near > far) return null;
  }
  if (far < 0) return null;
  return Math.max(near, 0);
}

/** Objet le plus proche touché par le rayon, parmi ceux que `skip` ne retire pas (coupés). */
export function pickTarget(
  origin: Point,
  dir: Point,
  targets: readonly PieceTarget[],
  skip: (target: PieceTarget) => boolean = () => false,
): { target: PieceTarget; distance: number } | null {
  let best: { target: PieceTarget; distance: number } | null = null;
  for (const target of targets) {
    if (skip(target)) continue;
    for (const box of target.boxes) {
      const distance = rayBox(origin, dir, box);
      if (distance !== null && (best === null || distance < best.distance)) best = { target, distance };
    }
  }
  return best;
}

/** Matériau d'un maillage du véhicule : `fusion_<matériau>` (pièces fusionnées), sinon le sien. */
export function materialOf(meshName: string, materialName: string | undefined): string {
  if (meshName.startsWith('fusion_')) return meshName.slice('fusion_'.length);
  return materialName ?? '';
}

/**
 * Zone du manifeste qui colore ce matériau (nommé dans la zone, ou rôle `paint_<zone>`, comme
 * VehicleModel.tsx les apparie) ; hors zone (vitre, pneu, chrome) : la zone maîtresse.
 */
export function zoneForMaterial(manifest: Pick<VehicleManifest, 'zones'>, material: string): string | undefined {
  const role = paintZoneOf(material);
  const zone = manifest.zones.find((candidate) => candidate.materials.includes(material) || role === candidate.id);
  return (zone ?? masterZone(manifest) ?? manifest.zones[0])?.id;
}

/**
 * Geste « appui court » sur la scène : un doigt, bref, presque immobile. Un deuxième doigt
 * (pincement) ou un glissement l'annule. Les gestes de l'orbite ne sont jamais empêchés : on ne fait
 * qu'écouter.
 */
export interface TapTracker {
  down: (id: number, x: number, y: number, time: number) => void;
  move: (id: number, x: number, y: number) => void;
  /** Vrai si ce relâché termine un appui court. */
  up: (id: number, x: number, y: number, time: number) => boolean;
  cancel: (id: number) => void;
}

export function createTapTracker(limits: { maxMs: number; maxMove: number } = TAP): TapTracker {
  const active = new Set<number>();
  let candidate: { id: number; x: number; y: number; time: number; valid: boolean } | null = null;
  const moved = (x: number, y: number) => candidate !== null && Math.hypot(x - candidate.x, y - candidate.y) >= limits.maxMove;
  return {
    down: (id, x, y, time) => {
      active.add(id);
      if (active.size === 1) candidate = { id, x, y, time, valid: true };
      else if (candidate) candidate.valid = false;
    },
    move: (id, x, y) => {
      if (candidate?.id === id && moved(x, y)) candidate.valid = false;
    },
    up: (id, x, y, time) => {
      active.delete(id);
      if (candidate?.id !== id) return false;
      const ok = candidate.valid && !moved(x, y) && time - candidate.time < limits.maxMs;
      candidate = null;
      return ok;
    },
    cancel: (id) => {
      active.delete(id);
      if (candidate?.id === id) candidate = null;
    },
  };
}
