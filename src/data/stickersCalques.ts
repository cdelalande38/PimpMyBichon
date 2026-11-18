// Calques de stickers d'un build et géométrie de pose (§ 5.3, § 8 « Livrée »). Fonctions pures.
//
// Une zone de livrée (manifeste, `livery`) est un cadre posé sur une face du véhicule : centre,
// largeur, hauteur et profondeur en mètres, face regardée (normale sortante). Elle se déplie à plat
// comme on la voit de dehors : x vers la droite, y vers le haut, de 0 à 1. La scène projette ce
// rectangle sur la carrosserie, sur les seuls matériaux de peinture qu'elle nomme : un sticker ne
// déborde ni sur les vitres ni sur les roues. Le flanc droit (`mirrorOf`) reprend le flanc gauche en
// miroir tant que la symétrie est mise (par défaut).

import { stickerById, type StickerMotif } from './stickers.ts';
import type { Hex, VehiclePoint } from './vehicleTypes.ts';

export type LiveryFace = '+x' | '-x' | '+y' | '-y' | '+z' | '-z';

/** Zone de livrée déclarée par le manifeste d'un véhicule. */
export interface LiveryZone {
  id: string;
  /** Nom affiché, en français. */
  label: string;
  /** Zones de peinture (identifiants de `zones`) qui reçoivent la livrée de ce cadre. */
  paints: readonly string[];
  /** Face regardée : normale sortante, dans le repère du véhicule (avant +X, haut +Y, droite +Z). */
  face: LiveryFace;
  /** Centre du cadre, en mètres. */
  center: VehiclePoint;
  /** Largeur, hauteur (vues de dehors) et profondeur du cadre, en mètres. */
  size: readonly [number, number, number];
  /** Reflet de cette zone-là tant que la symétrie est mise (flanc droit d'après le gauche). */
  mirrorOf?: string;
  /** Nom de la paire, symétrie mise (« Flancs ») : porté par la zone source. Absent : son nom. */
  pairLabel?: string;
}

/** Un sticker posé. Position en fraction du cadre, taille en mètres. */
export interface StickerLayer {
  motif: string;
  /** Centre : 0 à gauche, 1 à droite, vu de dehors. */
  x: number;
  /** Centre : 0 en bas, 1 en haut. */
  y: number;
  /** Hauteur du motif, en mètres (la largeur suit son ratio). */
  size: number;
  /** Rotation en degrés, dans le sens inverse des aiguilles d'une montre vu de dehors. */
  rotation: number;
  /** Retourné de gauche à droite. */
  flip: boolean;
  color: Hex;
  /** 0,2 à 1. */
  opacity: number;
}

/** Ce qu'un build retient des stickers : les calques de chaque zone, et la symétrie des flancs. */
export interface BuildStickers {
  layers: Record<string /* id de zone de livrée */, StickerLayer[]>;
  /** Faux : flancs indépendants. Absent : symétrie mise. */
  mirror?: false;
}

/** Calques par zone, au plus (§ 5.3). */
export const MAX_LAYERS = 16;
export const MAX_LIVERY_ZONES = 16;
export const OPACITY_RANGE = Object.freeze({ min: 0.2, max: 1 });
export const SIZE_MIN = 0.04;
export const ROTATION_RANGE = Object.freeze({ min: -180, max: 180 });

const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

/** '#rrggbb' en minuscules, ou `null` (comme normalizeHex de src/state/builds.ts). */
function normalizeHexLoose(value: unknown): Hex | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/.test(text)) return `#${text}`;
  if (/^[0-9a-f]{3}$/.test(text)) return `#${text.replace(/./g, (digit) => digit + digit)}`;
  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** Rotation ramenée dans [-180, 180]. */
export function wrapRotation(degrees: number): number {
  const turned = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return Object.is(turned, -0) ? 0 : turned;
}

/** Lecture tolérante d'un calque ; `null` s'il est illisible. */
export function sanitizeLayer(raw: unknown): StickerLayer | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.motif !== 'string' || !ID.test(source.motif)) return null;
  const color = normalizeHexLoose(source.color);
  return {
    motif: source.motif,
    x: clamp(finite(source.x, 0.5), 0, 1),
    y: clamp(finite(source.y, 0.5), 0, 1),
    size: clamp(finite(source.size, 0.3), SIZE_MIN, 4),
    rotation: wrapRotation(finite(source.rotation, 0)),
    flip: source.flip === true,
    color: color ?? '#f4f1ea',
    opacity: clamp(finite(source.opacity, 1), OPACITY_RANGE.min, OPACITY_RANGE.max),
  };
}

/** Lecture tolérante des stickers d'un build ; `undefined` s'il n'y a rien à garder. */
export function sanitizeStickers(raw: unknown): BuildStickers | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const source = raw as Record<string, unknown>;
  const layers: Record<string, StickerLayer[]> = {};
  if (typeof source.layers === 'object' && source.layers !== null) {
    for (const [zone, list] of Object.entries(source.layers).slice(0, MAX_LIVERY_ZONES)) {
      if (!ID.test(zone) || !Array.isArray(list)) continue;
      const kept = list.slice(0, MAX_LAYERS).map(sanitizeLayer).filter((layer): layer is StickerLayer => layer !== null);
      if (kept.length > 0) layers[zone] = kept;
    }
  }
  const mirror = source.mirror === false ? false : undefined;
  if (Object.keys(layers).length === 0 && mirror === undefined) return undefined;
  return mirror === false ? { layers, mirror } : { layers };
}

/** Vrai si la symétrie des flancs est mise (par défaut). */
export function mirrorOn(stickers: BuildStickers | undefined): boolean {
  return stickers?.mirror !== false;
}

/**
 * Reflet d'un calque sur le flanc d'en face : même place le long du véhicule (x retourné, puisque
 * l'avant passe de l'autre côté du regard), rotation inversée, motif retourné ; un lettrage reste
 * lisible (il n'est pas retourné).
 */
export function mirrorLayer(layer: StickerLayer, motif: Pick<StickerMotif, 'texte'> | undefined = stickerById(layer.motif)): StickerLayer {
  return {
    ...layer,
    x: 1 - layer.x,
    rotation: wrapRotation(-layer.rotation),
    flip: motif?.texte ? layer.flip : !layer.flip,
  };
}

/** Calques effectifs d'une zone : les siens, ou le reflet de sa zone jumelle si la symétrie est mise. */
export function zoneLayers(zones: readonly LiveryZone[], stickers: BuildStickers | undefined, zoneId: string): StickerLayer[] {
  const zone = zones.find((item) => item.id === zoneId);
  if (!zone) return [];
  if (zone.mirrorOf && mirrorOn(stickers)) return (stickers?.layers[zone.mirrorOf] ?? []).map((layer) => mirrorLayer(layer));
  return stickers?.layers[zoneId] ?? [];
}

/** Zones qu'on choisit dans le panneau : sans les reflets tant que la symétrie est mise. */
export function editableZones(zones: readonly LiveryZone[], stickers: BuildStickers | undefined): LiveryZone[] {
  const on = mirrorOn(stickers);
  return zones.filter((zone) => !(on && zone.mirrorOf && zones.some((item) => item.id === zone.mirrorOf)));
}

/** Zone jumelle (reflet ou source) d'une zone, s'il y en a une. */
export function twinOf(zones: readonly LiveryZone[], zoneId: string): LiveryZone | undefined {
  const zone = zones.find((item) => item.id === zoneId);
  if (!zone) return undefined;
  if (zone.mirrorOf) return zones.find((item) => item.id === zone.mirrorOf);
  return zones.find((item) => item.mirrorOf === zone.id);
}

/**
 * Change la symétrie. En la coupant, le flanc droit garde ce qu'il montrait (le reflet devient ses
 * propres calques) ; en la remettant, il reprend le reflet du gauche (ses calques à lui sont oubliés).
 */
export function setMirror(zones: readonly LiveryZone[], stickers: BuildStickers | undefined, on: boolean): BuildStickers {
  const layers = { ...(stickers?.layers ?? {}) };
  for (const zone of zones) {
    if (!zone.mirrorOf) continue;
    if (on) delete layers[zone.id];
    else {
      const shown = zoneLayers(zones, stickers, zone.id);
      if (shown.length > 0) layers[zone.id] = shown;
    }
  }
  return on ? { layers } : { layers, mirror: false };
}

// --- Géométrie de pose ---------------------------------------------------------------------------

type Vec3 = readonly [number, number, number];

const FACES: Record<LiveryFace, { normal: Vec3; up: Vec3 }> = {
  // Côtés : le haut de l'image est le haut du véhicule.
  '+z': { normal: [0, 0, 1], up: [0, 1, 0] },
  '-z': { normal: [0, 0, -1], up: [0, 1, 0] },
  '+x': { normal: [1, 0, 0], up: [0, 1, 0] },
  '-x': { normal: [-1, 0, 0], up: [0, 1, 0] },
  // Dessus : vu d'en haut, l'avant du véhicule en haut de l'image.
  '+y': { normal: [0, 1, 0], up: [1, 0, 0] },
  '-y': { normal: [0, -1, 0], up: [1, 0, 0] },
};

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Repère d'une zone vue de dehors : droite, haut et normale sortante. */
export function zoneFrame(face: LiveryFace): { right: Vec3; up: Vec3; normal: Vec3 } {
  const { normal, up } = FACES[face];
  // On regarde la face : le regard va contre la normale ; la droite = regard × haut.
  const look: Vec3 = [-normal[0], -normal[1], -normal[2]];
  return { right: cross(look, up), up, normal };
}

/** Coordonnées d'un point du véhicule dans le cadre : x et y de 0 à 1, profondeur de 0 (dedans) à 1 (dehors). */
export function projectPoint(zone: Pick<LiveryZone, 'face' | 'center' | 'size'>, point: Vec3): [number, number, number] {
  const { right, up, normal } = zoneFrame(zone.face);
  const d: Vec3 = [point[0] - zone.center[0], point[1] - zone.center[1], point[2] - zone.center[2]];
  return [dot(d, right) / zone.size[0] + 0.5, dot(d, up) / zone.size[1] + 0.5, dot(d, normal) / zone.size[2] + 0.5];
}

/**
 * La même projection en matrice 4 × 4 (ordre des colonnes, comme Matrix4.fromArray de three) : le
 * shader de la peinture l'applique au point du véhicule.
 */
export function projectionMatrix(zone: Pick<LiveryZone, 'face' | 'center' | 'size'>): number[] {
  const { right, up, normal } = zoneFrame(zone.face);
  const rows = [right, up, normal].map((axis, index) => {
    const scale = zone.size[index] ?? 1;
    return [axis[0] / scale, axis[1] / scale, axis[2] / scale, 0.5 - dot(zone.center, axis) / scale];
  });
  const [r0, r1, r2] = rows as [number[], number[], number[]];
  // Colonnes : x, y, z, translation.
  return [r0[0]!, r1[0]!, r2[0]!, 0, r0[1]!, r1[1]!, r2[1]!, 0, r0[2]!, r1[2]!, r2[2]!, 0, r0[3]!, r1[3]!, r2[3]!, 1];
}

/** Taille la plus grande d'un motif dans une zone : il tient en entier, à plat et sans rotation. */
export function maxSize(zone: Pick<LiveryZone, 'size'>, ratio: number): number {
  return Math.max(SIZE_MIN, Math.min(zone.size[1], zone.size[0] / Math.max(1, ratio)));
}

/** Coins d'un calque dans le cadre (fractions), dans l'ordre : bas gauche, bas droit, haut droit, haut gauche. */
export function layerCorners(zone: Pick<LiveryZone, 'size'>, layer: StickerLayer, ratio: number): Array<[number, number]> {
  const [width, height] = zone.size;
  const h = layer.size / 2;
  const w = (layer.size * ratio) / 2;
  const angle = (layer.rotation * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ].map(([dx, dy]) => [layer.x + (dx! * cos - dy! * sin) / width, layer.y + (dx! * sin + dy! * cos) / height]);
}

// --- Gestes sur les calques (renvoient une nouvelle liste) -----------------------------------------

/** Nouveau calque au centre de la zone, à sa taille par défaut ; `null` si la zone est pleine. */
export function addLayer(layers: readonly StickerLayer[], zone: Pick<LiveryZone, 'size'>, motif: StickerMotif, color: Hex): StickerLayer[] | null {
  if (layers.length >= MAX_LAYERS) return null;
  const size = Math.min(motif.taille, maxSize(zone, motif.ratio) * 0.9);
  return [...layers, { motif: motif.id, x: 0.5, y: 0.5, size, rotation: 0, flip: false, color, opacity: 1 }];
}

/** Copie juste au-dessus et un peu décalée ; `null` si la zone est pleine. */
export function duplicateLayer(layers: readonly StickerLayer[], index: number): StickerLayer[] | null {
  const layer = layers[index];
  if (!layer || layers.length >= MAX_LAYERS) return null;
  const copy = { ...layer, x: clamp(layer.x + 0.06, 0, 1), y: clamp(layer.y - 0.06, 0, 1) };
  return [...layers.slice(0, index + 1), copy, ...layers.slice(index + 1)];
}

export function removeLayer(layers: readonly StickerLayer[], index: number): StickerLayer[] {
  return layers.filter((_, at) => at !== index);
}

/** Monte (+1) ou descend (-1) un calque d'un cran ; rend la liste et la nouvelle place. */
export function moveLayer(layers: readonly StickerLayer[], index: number, step: 1 | -1): { layers: StickerLayer[]; index: number } {
  const target = index + step;
  if (!layers[index] || target < 0 || target >= layers.length) return { layers: [...layers], index };
  const next = [...layers];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return { layers: next, index: target };
}

/** Applique un changement à un calque, bornes respectées (le centre reste dans le cadre). */
export function updateLayer(
  layers: readonly StickerLayer[],
  index: number,
  patch: Partial<StickerLayer>,
  zone: Pick<LiveryZone, 'size'>,
): StickerLayer[] {
  const layer = layers[index];
  if (!layer) return [...layers];
  const motif = stickerById(layer.motif);
  const next: StickerLayer = { ...layer, ...patch };
  next.x = clamp(next.x, 0, 1);
  next.y = clamp(next.y, 0, 1);
  next.size = clamp(next.size, SIZE_MIN, maxSize(zone, motif?.ratio ?? 1));
  next.rotation = wrapRotation(next.rotation);
  next.opacity = clamp(next.opacity, OPACITY_RANGE.min, OPACITY_RANGE.max);
  return layers.map((item, at) => (at === index ? next : item));
}

/** Nombre total de calques posés (zones reflets non comprises). */
export function layerCount(stickers: BuildStickers | undefined): number {
  return Object.values(stickers?.layers ?? {}).reduce((sum, list) => sum + list.length, 0);
}
