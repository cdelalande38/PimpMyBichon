// Construction du garage à partir de sa description (src/data/garage.ts). Rien n'y est propre
// à un objet : tout se lit dans les listes. Le décor est immobile ; ses volumes sont fusionnés
// par matériau dans chaque objet pour tenir le budget de draw calls (§ 8).
// L'enveloppe est faite de faces simples tournées vers l'intérieur : la caméra, qui orbite
// hors de la pièce, voit à travers les murs proches. Le sol et le plafond se prolongent au-delà
// des murs et s'y perdent dans la brume de l'ambiance (src/render/floor.ts).
// Calques (src/render/layers.ts) : l'atmosphère (cônes sous les spots, nappes au ras du sol)
// n'est vue que de la caméra ; les rampes du plafond, que de la sonde ; les petits objets et le
// décor en hauteur sont absents du reflet du sol.
// Coupe caméra (src/scene/garage/cut.ts, src/render/cut.ts) : chaque objet du mobilier, chaque
// retombée, chaque optique de spot, chaque cône et chaque pied de tube est un élément ; ses
// sommets portent son identifiant (attribut `pmbCut`), même fusionnés avec d'autres. Un nouveau
// maillage du décor passe par `register` et `tagCut`, ou prouve qu'il ne peut pas cacher le
// véhicule (tests/unit/coupe.test.ts, garde-fou de structure).
// Mesures d'ensemble du cahier de remodelage (§ 3) : ombres de contact déduites des boîtes des
// objets (une géométrie, un appel de dessin, hors reflet), assombrissement de pied par sommet à
// la fusion (aucun appel de dessin), œuvres posées sur les objets (un plan et un appel de dessin
// par texture), enseignes en tubes de verre (un appel de dessin pour toutes, plaques de fond
// fusionnées avec le mobilier).

import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SpotLight,
  Uint16BufferAttribute,
  Vector3,
  type Material,
  type Texture,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ambiance } from '../../data/ambiances.ts';
import { CUT_ATTRIBUTE, CUT_CAPACITY } from '../../render/cut.ts';
import { hasCutDither, setCutDither } from '../../render/cutDither.ts';
import { createSurfaceUniforms, isDitherCarrier, patchGarageMaterial, setReflection, type SurfaceUniforms } from '../../render/floor.ts';
import { ATMOSPHERE_LAYER, NO_MIRROR_LAYER, PROBE_ONLY_LAYER } from '../../render/layers.ts';
import {
  colorOf,
  GARAGE_MATERIALS,
  type ColorKey,
  type Facing,
  type GarageLayout,
  type GarageMaterial,
  type GarageMaterialId,
  type Prop,
  type Spot,
  type Vec3,
} from '../../data/garage.ts';
import { artSize, garageArt, type GarageArtId } from '../../data/garageArt.ts';
import type { GarageShape } from '../../data/garageShapes.ts';
import { NEON_SIGNS } from '../../data/neonAlphabet.ts';
import { acquireArtwork, ART_GAP, artworkMaterial, type ArtworkOptions } from './artwork.ts';
import { analyzeCut, ditherNeeds, ditherOwners, type Box, type CutElement, type CutStructure, type DitherOwners } from './cut.ts';
import { neonSign } from './neon.ts';
import { roundedRectContour, shapeGeometry } from './shapes.ts';
import { garageTexture, haloTexture, type HaloKind } from './textures.ts';

/** Rang de dessin du sol parmi les opaques (0 : tout le reste ; véhicule à −2, BenchCar.tsx). */
export const FLOOR_RENDER_ORDER = 1;

/** Spots de la retombée, de gauche à droite : leur rang dans les listes de l'ambiance. */
const SPOT_SLOTS: readonly ColorKey[] = ['spotLeft', 'spotCenter', 'spotRight'];

const FACING: Record<Facing, Euler> = {
  '+z': new Euler(0, 0, 0),
  '-z': new Euler(0, Math.PI, 0),
  '+x': new Euler(0, Math.PI / 2, 0),
  '-x': new Euler(0, -Math.PI / 2, 0),
  '+y': new Euler(-Math.PI / 2, 0, 0),
  '-y': new Euler(Math.PI / 2, 0, 0),
};

/** Coordonnées de texture en mètres : la répétition des matériaux se règle par mètre. */
function scaleUv(geometry: BufferGeometry, from: number, count: number, su: number, sv: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = from; i < from + count; i += 1) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** Face plane ; `meters` : coordonnées de texture en mètres, sinon de 0 à 1 (dessin entier). */
function plane(width: number, height: number, at: Vec3, facing: Facing, meters = true): BufferGeometry {
  const geometry = new PlaneGeometry(width, height);
  if (meters) scaleUv(geometry, 0, 4, width, height);
  const matrix = new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(FACING[facing]), new Vector3(1, 1, 1));
  return geometry.applyMatrix4(matrix);
}

/**
 * Pièce du décor : sa forme (src/scene/garage/shapes.ts), tournée de `rot` autour de son centre et
 * posée en `at`, dans le repère de l'objet qui la porte.
 */
function partGeometry(part: GarageShape & { at: Vec3; rot?: Vec3 }): BufferGeometry {
  const rotation = new Quaternion().setFromEuler(new Euler(...(part.rot ?? [0, 0, 0])));
  return shapeGeometry(part).applyMatrix4(new Matrix4().compose(new Vector3(...part.at), rotation, new Vector3(1, 1, 1)));
}

/** Pose d'un objet du mobilier : rotation `turn` autour de la verticale, puis `at`. */
function propPlacement(prop: Prop): Matrix4 {
  return new Matrix4().compose(new Vector3(...prop.at), new Quaternion().setFromEuler(new Euler(0, prop.turn ?? 0, 0)), new Vector3(1, 1, 1));
}

/**
 * Pièces d'un objet du mobilier, tournées et posées dans le repère de la pièce, dans l'ordre de
 * `prop.parts`, et la boîte de l'objet dans son propre repère (avant `turn` et `at`, nulle sans
 * pièce). createGarage passe par ici : ce sont ces géométries qu'il fusionne et dont la coupe
 * caméra prend les boîtes.
 */
function placeProp(prop: Prop): { placement: Matrix4; geometries: BufferGeometry[]; localBox: Box | null } {
  const placement = propPlacement(prop);
  const local = prop.parts.map((part) => partGeometry(part));
  const localBox = unionBox(local.map(boxOf));
  return { placement, geometries: local.map((geometry) => geometry.applyMatrix4(placement)), localBox };
}

/** Pièces d'un objet du mobilier, posées dans la pièce, comme createGarage les fusionne. */
export function propGeometries(prop: Prop): BufferGeometry[] {
  return placeProp(prop).geometries;
}

/** Coordonnées de texture prises au sol, en mètres depuis le coin du mur du fond et du mur gauche. */
function floorUv(geometry: BufferGeometry, left: number, back: number): BufferGeometry {
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i += 1) uv.setXY(i, position.getX(i) - left, back - position.getZ(i));
  return geometry;
}

/** Identifiant de coupe porté par chaque sommet (0 : jamais masqué). */
export function tagCut(geometry: BufferGeometry, id: number): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute(CUT_ATTRIBUTE, new Float32BufferAttribute(new Float32Array(count).fill(id), 1));
  return geometry;
}

/** Boîte englobante d'une géométrie, repère de la pièce. */
function boxOf(geometry: BufferGeometry): Box {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox ?? new Box3();
  return { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] };
}

/** Rayon des arêtes des retombées. */
const SOFFIT_BEVEL = 0.01;

/** Épaisseur de l'optique d'un spot. */
const SPOT_THICKNESS = 0.012;

function spotGeometry(spot: Spot): BufferGeometry {
  return new CylinderGeometry(spot.radius, spot.radius, SPOT_THICKNESS, 16).translate(...spot.at);
}

/**
 * Cône de lumière sous un spot : deux plans croisés, coupés à `layout.beam.stop` (le dessin du cône
 * entier, tronqué) ; trois rangées de sommets, la dernière au bas, celle du milieu au début du
 * fondu (beamFade).
 */
function beamGeometries(spot: Spot, layout: GarageLayout): [BufferGeometry, BufferGeometry] {
  const { height: bh, radius: br, stop, fade } = layout.beam;
  const top = spot.at[1];
  const bottom = Math.max(top - bh, Math.min(top, stop));
  const rows = [top, Math.min(top, bottom + fade), bottom];
  const make = (facing: Facing) => {
    const geometry = new PlaneGeometry(br * 2, 1, 1, 2);
    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < position.count; i += 1) {
      const y = rows[Math.round((0.5 - position.getY(i)) * 2)] ?? bottom;
      position.setY(i, y);
      uv.setY(i, 1 - (top - y) / bh);
    }
    const matrix = new Matrix4().compose(new Vector3(spot.at[0], 0, spot.at[2] + br * 0.7), new Quaternion().setFromEuler(FACING[facing]), new Vector3(1, 1, 1));
    return geometry.applyMatrix4(matrix);
  };
  return [make('+z'), make('+x')];
}

/** Fondu du bas d'un cône (après `paint`) : éteint à sa dernière rangée, plein dès celle du milieu. */
function beamFade(geometry: BufferGeometry, layout: GarageLayout, spot: Spot): BufferGeometry {
  const { height: bh, stop, fade } = layout.beam;
  const bottom = Math.max(spot.at[1] - bh, Math.min(spot.at[1], stop));
  const position = geometry.getAttribute('position');
  const color = geometry.getAttribute('color');
  for (let i = 0; i < position.count; i += 1) {
    const f = fade > 0 ? Math.min(1, Math.max(0, (position.getY(i) - bottom) / fade)) : 1;
    color.setXYZ(i, color.getX(i) * f, color.getY(i) * f, color.getZ(i) * f);
  }
  return geometry;
}

/** Pied de tube LED : socle, tige, tube (émissif). */
function standGeometries(x: number, z: number, height: number): { foot: BufferGeometry[]; tube: BufferGeometry } {
  return {
    foot: [new CylinderGeometry(0.16, 0.18, 0.04, 20).translate(x, 0.02, z), new CylinderGeometry(0.03, 0.03, 0.14, 10).translate(x, 0.09, z)],
    tube: new CylinderGeometry(0.024, 0.024, height, 12).translate(x, 0.14 + height / 2, z),
  };
}

/** Boîtes de géométries jetables (elles sont libérées). */
function boxesOf(geometries: BufferGeometry[]): Box[] {
  const boxes = geometries.map(boxOf);
  for (const geometry of geometries) geometry.dispose();
  return boxes;
}

function merge(geometries: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Garage : volumes impossibles à fusionner');
  return merged;
}

/** Union de boîtes (nulle si la liste est vide). */
function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k] ?? 0, box.min[k] ?? 0);
      max[k] = Math.max(max[k] ?? 0, box.max[k] ?? 0);
    }
  }
  return { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] };
}

/** Couleur par sommet blanche (sans effet) : toutes les géométries d'un matériau à couleurs par sommet en portent une. */
function ensureColor(geometry: BufferGeometry): BufferGeometry {
  if (geometry.getAttribute('color')) return geometry;
  const count = geometry.getAttribute('position').count;
  geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(count * 3).fill(1), 3));
  return geometry;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Assombrissement de pied (cahier § 3.2), en couleur par sommet : plus sombre près de l'appui
 * (`rest`, hauteur du sol ou du meuble porteur ; `null` pour un objet accroché), sur les faces
 * tournées vers le bas et sur celles qui regardent un mur tout proche. `FOOT` règle la force.
 */
const FOOT = { strength: 0.7, rise: 0.3, base: 0.55, down: 0.6, wall: 0.75, wallGap: 0.05 } as const;

function footShade(geometry: BufferGeometry, rest: number | null, room: { width: number; depth: number }): BufferGeometry {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const count = position.count;
  const colors = new Float32Array(count * 3);
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  for (let i = 0; i < count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    let f = rest === null ? 1 : FOOT.base + (1 - FOOT.base) * smoothstep(0, FOOT.rise, y - rest);
    if (normal) {
      const nx = normal.getX(i);
      const ny = normal.getY(i);
      const nz = normal.getZ(i);
      if (ny < -0.5) f *= FOOT.down;
      const facesWall =
        (nx < -0.5 && x + halfW < FOOT.wallGap) ||
        (nx > 0.5 && halfW - x < FOOT.wallGap) ||
        (nz < -0.5 && z + halfD < FOOT.wallGap) ||
        (nz > 0.5 && halfD - z < FOOT.wallGap);
      if (facesWall) f *= FOOT.wall;
    }
    const v = 1 - FOOT.strength * (1 - f);
    colors[i * 3] = v;
    colors[i * 3 + 1] = v;
    colors[i * 3 + 2] = v;
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/** Tache de contact (cahier § 3.1) : réglages par cas. `margin` : débord autour de l'emprise. */
export const CONTACT = {
  floor: { margin: 0.12, opacity: 0.45, lift: 0.001 },
  rest: { margin: 0.06, opacity: 0.4, lift: 0.001 },
  wall: { margin: 0.06, opacity: 0.35, lift: 0.002, drop: 0.03, reach: 0.08, minHeight: 0.3 },
  /** Hauteur sous laquelle un objet est posé au sol ; emprise au-delà de laquelle il n'en a pas. */
  ground: 0.03,
  maxExtent: 3,
  /** Épaisseur sous laquelle un objet est un plat collé au mur (crédence, plaque) : pas de tache. */
  flat: 0.03,
  /**
   * Écart admis entre la hauteur d'appui déclarée d'un objet posé (Prop.rest) et le dessus des
   * pièces de son porteur qui forment le dessus où s'arrête sa tache.
   */
  seat: 0.005,
} as const;

/** Distances d'un point aux bords d'une emprise (x, z), le long de directions du plan horizontal. */
function reachWithin(centre: Vector3, directions: readonly Vector3[], footprint: Box): number[] {
  return directions.map((d) => {
    let t = Infinity;
    if (Math.abs(d.x) > 1e-9) t = Math.min(t, ((d.x > 0 ? footprint.max[0] : footprint.min[0]) - centre.x) / d.x);
    if (Math.abs(d.z) > 1e-9) t = Math.min(t, ((d.z > 0 ? footprint.max[2] : footprint.min[2]) - centre.z) / d.z);
    return Math.max(0, t);
  });
}

/**
 * Tache en neuf cases : l'intérieur (texture au centre, pleine) couvre l'emprise rentrée d'une
 * part de la marge, le pourtour (bords de la texture) s'éteint jusqu'au bord de la tache. Repère :
 * centre, axes u et v du plan (u × v = normale), demi-côtés de l'emprise. `reach` (−u, +u, −v,
 * +v) : distance du centre au-delà de laquelle la tache ne va pas (bord du meuble porteur) ; le
 * pourtour se resserre alors pour s'éteindre avant ce bord.
 */
function contactPatch(
  centre: Vector3,
  u: Vector3,
  v: Vector3,
  half: readonly [number, number],
  margin: number,
  opacity: number,
  reach: readonly number[] = [Infinity, Infinity, Infinity, Infinity],
): BufferGeometry {
  const side = (h: number, limit: number) => {
    const outer = Math.min(h + margin, limit);
    return { outer, inner: Math.max(0, Math.min(h - Math.min(margin * 0.5, h * 0.4), outer - margin * 0.5)) };
  };
  const [u0, u1, v0, v1] = [side(half[0], reach[0] ?? Infinity), side(half[0], reach[1] ?? Infinity), side(half[1], reach[2] ?? Infinity), side(half[1], reach[3] ?? Infinity)];
  const us = [-u0.outer, -u0.inner, u1.inner, u1.outer];
  const vs = [-v0.outer, -v0.inner, v1.inner, v1.outer];
  const tex = [0, 0.5, 0.5, 1];
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const point = new Vector3();
  for (let j = 0; j < 4; j += 1) {
    for (let i = 0; i < 4; i += 1) {
      point.copy(centre).addScaledVector(u, us[i] ?? 0).addScaledVector(v, vs[j] ?? 0);
      positions.push(point.x, point.y, point.z);
      uvs.push(tex[i] ?? 0, tex[j] ?? 0);
      colors.push(0, 0, 0, opacity);
    }
  }
  const index: number[] = [];
  for (let j = 0; j < 3; j += 1) {
    for (let i = 0; i < 3; i += 1) {
      const a = j * 4 + i;
      index.push(a, a + 1, a + 5, a, a + 5, a + 4);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 4));
  geometry.setIndex(new Uint16BufferAttribute(index, 1));
  return geometry;
}

/** Appui d'un objet du mobilier (assombrissement de pied, ombre de contact). */
export interface PropRest {
  /** Hauteur de l'appui : 0 au sol, le dessus du porteur (Prop.rest.top) sur un meuble. */
  height: number;
  /** Pente du dessus (Prop.rest.slope), qui monte vers −z ; 0 au sol et sur un dessus plat. */
  slope: number;
  /**
   * Sur un meuble : emprise (x, z) du dessus qui le porte, que sa tache ne dépasse pas (pièces du
   * porteur dont le dessus est à la hauteur d'appui et qui recouvrent l'objet). Nulle au sol, et
   * sur un meuble dont aucune pièce n'a son dessus à cette hauteur (dessus en pente).
   */
  footprint: Box | null;
}

/** Objet du mobilier posé dans la pièce : identifiant de coupe, boîte d'ensemble, boîtes des pièces. */
interface PlacedProp {
  prop: Prop;
  box: Box | null;
  boxes: readonly Box[];
}

const overlaps = (a: Box, b: Box, axis: number) => Math.min(a.max[axis] ?? 0, b.max[axis] ?? 0) > Math.max(a.min[axis] ?? 0, b.min[axis] ?? 0);

/**
 * Appui d'un objet : le meuble déclaré par ses données (Prop.rest : porteur et hauteur du dessus),
 * le sol (bas sous CONTACT.ground), ou rien (accroché : `null`). Rien n'est deviné : un évier
 * encastré repose sur le plan de travail par son rebord, pas sur le caisson sous sa cuve.
 */
function restOf(item: PlacedProp, byName: ReadonlyMap<string, PlacedProp>): PropRest | null {
  const { box, prop } = item;
  if (!box) return null;
  if (prop.rest) {
    const { on, top, slope = 0 } = prop.rest;
    const carrier = byName.get(on);
    if (!carrier) throw new Error(`Garage : ${prop.name} posé sur « ${on} », absent du mobilier`);
    // Dessus plat : les pièces dont le dessus est à la hauteur d'appui. En pente : celles qui la
    // contiennent (leur boîte monte plus haut, vers le haut de la pente).
    const level = (part: Box) =>
      slope === 0 ? Math.abs((part.max[1] ?? 0) - top) <= CONTACT.seat : (part.min[1] ?? 0) <= top && top <= (part.max[1] ?? 0) + CONTACT.seat;
    const seats = carrier.boxes.filter((part) => level(part) && overlaps(part, box, 0) && overlaps(part, box, 2));
    return { height: top, slope, footprint: unionBox(seats) };
  }
  if (box.min[1] < CONTACT.ground) return { height: 0, slope: 0, footprint: null };
  return null;
}

/**
 * Enseignes : jour entre le mur et le dos des tubes ; plaque de fond (plexi fumé, débord autour
 * des tubes, rayon des coins, épaisseur, jour au mur) et entretoises chromées aux quatre coins.
 */
const NEON = {
  wallGap: 0.032,
  plate: { margin: 0.04, radius: 0.03, depth: 0.006, gap: 0.02, material: 'planDeTravail' as GarageMaterialId },
  standoff: { radius: 0.008, inset: 0.03, material: 'chrome' as GarageMaterialId },
  /** Part de blanc sur la face avant des tubes (cœur presque blanc). */
  core: 0.45,
} as const;

/** Luminance d'une couleur linéaire. */
function luminance(color: Color): number {
  return 0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b;
}

/**
 * Couleur de base de chaque sommet des tubes d'une enseigne (multipliée ensuite par la force des
 * tubes de l'ambiance) : teinte du verre ramenée à une luminance de `gain`, blanchie sur la face
 * qui regarde la pièce.
 */
function neonBaseColors(geometry: BufferGeometry, groups: ReadonlyArray<{ color: string; start: number; count: number }>, gain: number): Float32Array {
  const count = geometry.getAttribute('position').count;
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex();
  const base = new Float32Array(count * 3);
  const hue = new Color();
  for (const group of groups) {
    hue.set(group.color);
    hue.multiplyScalar(1 / Math.max(1e-3, luminance(hue)));
    for (let k = group.start; k < group.start + group.count; k += 1) {
      const i = index ? index.getX(k) : k;
      const front = normal ? Math.max(0, normal.getZ(i)) : 0;
      const w = NEON.core * front * front;
      base[i * 3] = gain * (hue.r * (1 - w) + w);
      base[i * 3 + 1] = gain * (hue.g * (1 - w) + w);
      base[i * 3 + 2] = gain * (hue.b * (1 - w) + w);
    }
  }
  return base;
}

function createMaterial(id: GarageMaterialId): MeshStandardMaterial {
  const spec: GarageMaterial = GARAGE_MATERIALS[id];
  // Couleurs par sommet : l'assombrissement de pied du mobilier (blanches ailleurs).
  const material = new MeshStandardMaterial({
    name: `garage_${id}`,
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: FrontSide,
    envMapIntensity: spec.env ?? 0.2,
    vertexColors: true,
  });
  if (spec.map) material.map = garageTexture(spec.map, spec.repeat);
  if (spec.roughnessMap) material.roughnessMap = garageTexture(spec.roughnessMap, spec.repeat);
  if (spec.emissive) {
    material.emissive = new Color(spec.emissive);
    material.emissiveIntensity = spec.emissiveIntensity ?? 1;
  }
  return material;
}

/** Une couleur d'ambiance, multipliée (au-delà de 1, elle déclenche le bloom). */
function hdr(ambiance: Ambiance, key: ColorKey, gain: number): Color {
  return new Color(colorOf(ambiance, key)).multiplyScalar(gain);
}

/** Peint une géométrie d'une couleur unie, par sommet (pour fusionner des sources de couleurs différentes). */
function paint(geometry: BufferGeometry, color: Color): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

/**
 * Trame de la coupe (src/render/cutDither.ts) : les matériaux opaques du décor ne compilent le rejet
 * de fragments que pendant qu'un de leurs éléments est en fondu.
 */
export interface GarageDither {
  /**
   * Matériaux opaques du décor qui peuvent porter la trame (ils dessinent au moins un élément de la
   * coupe), et les éléments que chacun dessine. Sol, plafond et murs sans élément n'en sont pas :
   * ils ne s'effacent jamais, leur variante « trame » serait compilée pour rien.
   */
  readonly carriers: readonly Material[];
  /**
   * Tous les matériaux opaques patchés du décor, porteurs ou non : la variante « Trame partout » de
   * la mesure comparée (comportement d'avant 8dc262f) les met tous en trame.
   */
  readonly opaque: readonly Material[];
  readonly owners: DitherOwners;
  /**
   * Applique la règle aux fondus en cours (`ditherNeeds`) ; `allowed` faux : aucune trame (variantes
   * pas prêtes, mouvement réduit, mode photo). Rend le nombre de matériaux en trame. Aucune allocation.
   */
  apply: (allowed: boolean) => number;
  /** Matériaux en trame après le dernier `apply`. */
  readonly active: number;
}

export interface GarageCut {
  /** Éléments de la coupe : l'identifiant de l'élément i est i + 1. */
  elements: readonly CutElement[];
  /** Adossements et supports, déduits des boîtes. */
  structure: CutStructure;
  /** Fondu par identifiant (uniforme partagé par tous les matériaux du décor). */
  fades: Float32Array;
  dither: GarageDither;
}

export interface GarageScene {
  root: Group;
  /** Le sol (miroir de la réflexion planaire) et les réglages de ses surfaces. */
  floor: Mesh;
  surfaces: SurfaceUniforms;
  cut: GarageCut;
  /** Applique une ambiance : couleurs des sources, halos, tubes, lumières, brume. */
  update: (ambiance: Ambiance) => void;
  /** Niveau de qualité : réflexion planaire du sol, atmosphère. */
  setQuality: (options: { reflection: boolean; atmosphere: boolean }) => void;
  dispose: () => void;
}

export interface GarageOptions {
  /** Texture d'une œuvre (défaut : acquireArtwork, qui charge le dessin servi par l'app). */
  artwork?: (id: GarageArtId, options: ArtworkOptions) => { texture: Texture; release: () => void };
  /** Appelé quand l'image est à redessiner sans que rien n'ait bougé (une œuvre arrive). */
  onChange?: () => void;
}

export function createGarage(layout: GarageLayout, options: GarageOptions = {}): GarageScene {
  const root = new Group();
  root.name = 'garage';
  const surfaceUniforms = createSurfaceUniforms(layout.room, layout.outside.falloff);
  const fades = surfaceUniforms.pmbCutFade.value;
  const fadesBeforeProbe = new Float32Array(fades.length);
  // La sonde de réflexion ne doit pas voir le reflet planaire du sol : il date de l'image d'avant
  // (autre ambiance, véhicule compris). Elle voit en revanche tout le décor, coupe levée : la
  // voiture continue de refléter ce qui est masqué (§ 8, ingrédient 2). Elle appelle ce crochet
  // avant sa capture (ReflectionProbe).
  // Tout visible : la trame n'a rien à rejeter, la sonde dessine sans elle (sa clé de programme,
  // sans environnement, n'a pas de variante « trame » préparée).
  root.userData.onProbe = () => {
    const strength = surfaceUniforms.pmbReflectionStrength;
    const value = strength.value;
    strength.value = 0;
    fadesBeforeProbe.set(fades);
    fades.fill(1);
    const dithered = dither.opaque.filter((carrier) => setCutDither(carrier, false));
    return () => {
      strength.value = value;
      fades.set(fadesBeforeProbe);
      for (const carrier of dithered) setCutDither(carrier, true);
    };
  };

  // Porteurs de la trame : relevés sur les maillages (attribut de coupe), refaits à chaque ambiance
  // (les sources sont reconstruites). `has` : état posé ; `want` : tampon de la règle.
  const dither = {
    carriers: [] as Material[],
    opaque: [] as Material[],
    owners: ditherOwners([]),
    has: new Uint8Array(0),
    want: new Uint8Array(0),
    active: 0,
    apply(allowed: boolean): number {
      const { carriers, owners, has, want } = dither;
      if (allowed) dither.active = ditherNeeds(fades, owners, want);
      else {
        want.fill(0);
        dither.active = 0;
      }
      for (let m = 0; m < carriers.length; m += 1) {
        if (want[m] === has[m]) continue;
        const carrier = carriers[m];
        if (carrier) setCutDither(carrier, want[m] === 1);
        has[m] = want[m] ?? 0;
      }
      return dither.active;
    },
  };
  const refreshDither = () => {
    const owned = new Map<Material, Set<number>>();
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      const mat = object.material as Material;
      if (!isDitherCarrier(mat)) return;
      const ids = owned.get(mat) ?? new Set<number>();
      owned.set(mat, ids);
      const attribute = (object.geometry as BufferGeometry).getAttribute(CUT_ATTRIBUTE);
      if (!attribute) return;
      const values = attribute.array;
      let last = -1;
      for (let i = 0; i < values.length; i += 1) {
        const id = values[i] ?? 0;
        if (id !== last) ids.add(id);
        last = id;
      }
    });
    for (const carrier of dither.opaque) if (!owned.has(carrier)) setCutDither(carrier, false);
    dither.opaque = [...owned.keys()];
    const fading = [...owned].filter(([, ids]) => [...ids].some((id) => id > 0));
    dither.carriers = fading.map(([material]) => material);
    dither.owners = ditherOwners(fading.map(([, ids]) => ids));
    dither.has = Uint8Array.from(dither.carriers, (carrier) => (hasCutDither(carrier) ? 1 : 0));
    dither.want = new Uint8Array(dither.carriers.length);
  };

  // Éléments de la coupe caméra, dans l'ordre de leur identifiant (1, 2…).
  const elements: CutElement[] = [];
  const register = (element: CutElement): number => {
    elements.push(element);
    if (elements.length >= CUT_CAPACITY) throw new Error(`Garage : plus de ${CUT_CAPACITY - 1} éléments pour la coupe`);
    return elements.length;
  };

  const materials = new Map<GarageMaterialId, MeshStandardMaterial>();
  const material = (id: GarageMaterialId) => {
    let found = materials.get(id);
    if (!found) {
      found = createMaterial(id);
      patchGarageMaterial(found, surfaceUniforms);
      materials.set(id, found);
    }
    return found;
  };
  const owned: Array<{ dispose: () => void }> = [];
  /**
   * Tout maillage d'un matériau patché porte l'attribut de coupe (0 par défaut) ; tout maillage
   * d'un matériau à couleurs par sommet, une couleur (blanche par défaut).
   */
  const ensureCut = (geometry: BufferGeometry, mat: Material) => {
    if (mat.userData.pmbCut === true && !geometry.getAttribute(CUT_ATTRIBUTE)) tagCut(geometry, 0);
    if ((mat as MeshBasicMaterial).vertexColors === true) ensureColor(geometry);
  };
  const add = (parent: Group, geometry: BufferGeometry, mat: Material, name: string) => {
    ensureCut(geometry, mat);
    const mesh = new Mesh(geometry, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    owned.push(geometry);
    return mesh;
  };

  // 1. Enveloppe.
  const { width: W, depth: D, height: H } = layout.room;
  const { surfaces } = layout;
  const shell = new Group();
  shell.name = 'garage_enveloppe';
  // Sol et plafond prolongés : mêmes carreaux, mêmes lames, perdus dans la brume au-delà des murs.
  const { extent } = layout.outside;
  const floorMaterial = material(surfaces.floor);
  const ceilingMaterial = material(surfaces.ceiling);
  patchGarageMaterial(floorMaterial, surfaceUniforms, { surface: true });
  patchGarageMaterial(ceilingMaterial, surfaceUniforms, { surface: true });
  const floor = add(shell, floorUv(plane(extent, extent, [0, -0.002, 0], '+y'), -W / 2, -D / 2), floorMaterial, 'sol');
  // Ordre de dessin des opaques : le sol (le plus grand, et le plus cher avec son reflet) après
  // tout le reste, pour que la profondeur déjà écrite lui évite les pixels cachés. Pas les murs ni
  // le plafond : leurs arêtes ont des égalités de profondeur avec le mobilier, l'ordre y changerait
  // des pixels (comparaison de captures, captures/notes-agents/jalon1-cadence.md).
  floor.renderOrder = FLOOR_RENDER_ORDER;
  add(shell, floorUv(plane(extent, extent, [0, H, 0], '-y'), -W / 2, -D / 2), ceilingMaterial, 'plafond');
  add(shell, plane(W, H, [0, H / 2, -D / 2], '+z'), material(surfaces.back), 'mur_fond');
  add(shell, plane(W, H, [0, H / 2, D / 2], '-z'), material(surfaces.front), 'mur_avant');
  add(shell, plane(D, H, [-W / 2, H / 2, 0], '+x'), material(surfaces.left), 'mur_gauche');
  add(shell, plane(D, H, [W / 2, H / 2, 0], '-x'), material(surfaces.right), 'mur_droit');
  // Retombées : un élément chacune, un seul appel de dessin pour toutes. Arêtes adoucies d'un
  // centimètre ; boîtes fermées (le dessus se voit quand l'œil passe au-dessus du plafond).
  const soffits = layout.soffits.map(({ size, at }, index) => {
    const geometry = partGeometry({ box: size, bevel: SOFFIT_BEVEL, at });
    return tagCut(geometry, register({ name: `retombee_${index + 1}`, parts: [boxOf(geometry)] }));
  });
  add(shell, merge(soffits), material(surfaces.back), 'retombees');
  root.add(shell);

  // 2. Mobilier : immobile, fusionné par matériau sur toute la pièce (un appel de dessin par
  //    matériau, § 8). Les petits objets (`small`) forment des volumes à part, hors du reflet du sol.
  //    Les volumes sont fusionnés plus bas, une fois la coupe analysée (l'assombrissement de pied
  //    et les ombres de contact demandent de savoir qui porte quoi).
  const furnished = layout.props.map((prop) => {
    const { placement, geometries, localBox } = placeProp(prop);
    const boxes = geometries.map(boxOf);
    const id = register({ name: prop.name, parts: boxes, ...(prop.on ? { on: prop.on } : {}) });
    return { prop, placement, localBox, boxes, box: unionBox(boxes), geometries, id, small: prop.small === true };
  });
  const furniture = new Map<string, { id: GarageMaterialId; small: boolean; geometries: BufferGeometry[] }>();
  const addFurniture = (material: GarageMaterialId, small: boolean, geometry: BufferGeometry) => {
    const key = small ? `${material}_hors_reflet` : material;
    const entry = furniture.get(key) ?? { id: material, small, geometries: [] };
    entry.geometries.push(geometry);
    furniture.set(key, entry);
  };

  // Enseignes néon en tubes (src/scene/garage/neon.ts) : une géométrie pour toutes, colorée par
  // sommet (un appel de dessin), recolorée à chaque ambiance. Plaques de fond et entretoises vont
  // avec le mobilier hors reflet. Chaque enseigne est un élément de la coupe (adossée à son mur).
  const neonTubes: BufferGeometry[] = [];
  const neonBases: Float32Array[] = [];
  for (const sign of layout.signs) {
    const composition = NEON_SIGNS[sign.name];
    if (!composition) throw new Error(`Garage : enseigne « ${sign.name} » sans composition dans NEON_SIGNS`);
    const built = neonSign(composition.lines, {
      capHeight: composition.capHeight,
      slant: composition.slant,
      align: composition.align,
      ornaments: composition.ornaments,
      wallGap: NEON.wallGap,
    });
    const tubes = built.geometry;
    neonBases.push(neonBaseColors(tubes, built.tubes, sign.gain));
    tubes.clearGroups();
    const { plate, standoff } = NEON;
    const pw = built.width + 2 * plate.margin;
    const ph = built.height + 2 * plate.margin;
    const backing = partGeometry({ extrude: roundedRectContour(pw, ph, plate.radius), depth: plate.depth, bevel: 0.002, at: [0, 0, plate.gap + plate.depth / 2] });
    const posts = [-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) =>
        partGeometry({
          cylinder: [standoff.radius, plate.gap],
          axis: 'z',
          at: [sx * (pw / 2 - standoff.inset), sy * (ph / 2 - standoff.inset), plate.gap / 2],
        }),
      ),
    );
    const orientation = new Matrix4().compose(new Vector3(...sign.at), new Quaternion().setFromEuler(FACING[sign.facing]), new Vector3(1, 1, 1));
    for (const geometry of [tubes, backing, ...posts]) geometry.applyMatrix4(orientation);
    const id = register({ name: sign.name, parts: [tubes, backing, ...posts].map(boxOf) });
    neonTubes.push(tagCut(tubes, id));
    addFurniture(plate.material, true, ensureColor(tagCut(backing, id)));
    for (const post of posts) addFurniture(standoff.material, true, ensureColor(tagCut(post, id)));
  }

  // 3. Panneaux à texture (l'écran).
  for (const panel of layout.panels) {
    const map = garageTexture(panel.texture, panel.repeat ? [panel.repeat[0] / panel.size[0], panel.repeat[1] / panel.size[1]] : [1 / panel.size[0], 1 / panel.size[1]]);
    const mat =
      panel.glow === undefined
        ? new MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 })
        : new MeshBasicMaterial({ map, color: new Color(1, 1, 1).multiplyScalar(panel.glow) });
    owned.push(mat);
    const mesh = add(root, plane(panel.size[0], panel.size[1], panel.at, panel.facing), mat, panel.name);
    if (panel.small === true) mesh.layers.set(NO_MIRROR_LAYER);
  }

  // 4. Sources pilotées par l'ambiance : refaites à chaque changement.
  const dynamic = new Group();
  dynamic.name = 'garage_sources';
  root.add(dynamic);
  const emissive = new MeshBasicMaterial({ vertexColors: true });
  patchGarageMaterial(emissive, surfaceUniforms);
  const halo = (kind: HaloKind) =>
    new MeshBasicMaterial({
      map: haloTexture(kind),
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  const haloMaterials: Record<HaloKind, MeshBasicMaterial> = { rond: halo('rond'), goutte: halo('goutte'), cone: halo('cone'), nappe: halo('nappe') };
  for (const mat of [haloMaterials.cone, haloMaterials.nappe]) {
    mat.fog = false;
    mat.polygonOffset = false;
  }
  // Les cônes s'effacent avec leur spot ; les nappes de brume restent (choix d'image).
  patchGarageMaterial(haloMaterials.cone, surfaceUniforms);
  const stands = material('noir');
  owned.push(emissive, ...Object.values(haloMaterials));

  const atmosphere = new Group();
  atmosphere.name = 'garage_atmosphere';
  root.add(atmosphere);
  let atmosphereGeometries: BufferGeometry[] = [];

  // Sources refaites à chaque ambiance, mais à place fixe : leurs éléments sont posés une fois.
  const spotIds = layout.spots.map((spot, index) => register({ name: `spot_${index + 1}`, parts: boxesOf([spotGeometry(spot)]) }));
  const beamIds = layout.spots.map((spot, index) =>
    spot.beam === true
      ? register({ name: `cone_${index + 1}`, parts: boxesOf(beamGeometries(spot, layout)), on: [`spot_${index + 1}`], light: true })
      : 0,
  );
  // Bandeaux : collés à leur mur et à face unique, ils restent (identifiant 0), sauf ceux qu'un
  // autre élément porte (`on`, sous une retombée) : ils disparaissent avec lui.
  const stripGeometry = (strip: GarageLayout['strips'][number]) => {
    const length = new Vector3(...strip.from).distanceTo(new Vector3(...strip.to));
    const middle: Vec3 = [(strip.from[0] + strip.to[0]) / 2, (strip.from[1] + strip.to[1]) / 2, (strip.from[2] + strip.to[2]) / 2];
    return plane(length, 0.03, middle, strip.facing, false);
  };
  const stripIds = layout.strips.map((strip, index) =>
    strip.on ? register({ name: `bandeau_${index + 1}`, parts: boxesOf([stripGeometry(strip)]), on: strip.on }) : 0,
  );
  const standIds = layout.standTubes.at.map(([x, z], index) => {
    const { foot, tube } = standGeometries(x, z, layout.standTubes.height);
    return register({ name: `pied_tube_${index + 1}`, parts: boxesOf([...foot, tube]) });
  });

  // Tous les éléments sont posés : la coupe s'analyse (adossements, supports).
  const structure = analyzeCut(layout.room, elements, { wall: layout.cut.wallTolerance, contact: layout.cut.contactTolerance });
  const furnitureByName = new Map(furnished.map((item) => [item.prop.name as string, item]));
  // Appui de chaque objet (assombrissement de pied, ombre de contact) : le sol, le meuble déclaré
  // par ses données, ou rien (accroché).
  const rests = new Map(furnished.map((item) => [item.id, restOf(item, furnitureByName)]));

  // Mobilier : assombrissement de pied, puis fusion par matériau.
  for (const item of furnished) {
    const rest = rests.get(item.id)?.height ?? null;
    item.prop.parts.forEach((part, index) => {
      const geometry = item.geometries[index];
      if (!geometry) return;
      addFurniture(part.material, item.small, footShade(tagCut(geometry, item.id), rest, layout.room));
    });
  }
  const furnitureGroup = new Group();
  furnitureGroup.name = 'garage_mobilier';
  furnitureGroup.userData.props = layout.props.map((prop) => prop.name);
  for (const [key, { id, small, geometries }] of furniture) {
    const mesh = add(furnitureGroup, merge(geometries), material(id), `garage_mobilier_${key}`);
    if (small) mesh.layers.set(NO_MIRROR_LAYER);
  }
  root.add(furnitureGroup);
  // Les géométries des pièces sont fusionnées (et libérées) : plus rien ne doit les tenir, sinon
  // elles vivent autant que le garage (les fermetures rendues partagent ce contexte).
  furniture.clear();
  for (const item of furnished) item.geometries.length = 0;

  // Tubes des enseignes : reflétés (leur reflet au sol fait partie du néon).
  const neonMesh = neonTubes.length > 0 ? add(root, merge(neonTubes), emissive, 'garage_neons') : null;
  const neonBase = new Float32Array(neonBases.reduce((sum, base) => sum + base.length, 0));
  neonBases.reduce((offset, base) => {
    neonBase.set(base, offset);
    return offset + base.length;
  }, 0);
  if (neonMesh) neonMesh.geometry.setAttribute('color', new Float32BufferAttribute(new Float32Array(neonBase.length), 3));

  // Œuvres posées sur les objets : un plan par emplacement, 2 mm devant sa face, même élément de
  // coupe et même règle de reflet que l'objet. Teinte d'attente, puis le dessin (rendu redemandé).
  const artwork = options.artwork ?? acquireArtwork;
  const releases: Array<() => void> = [];
  const artGroup = new Group();
  artGroup.name = 'garage_oeuvres';
  for (const item of furnished) {
    for (const slot of item.prop.art ?? []) {
      const art = garageArt(slot.art);
      const [aw, ah] = artSize(art, slot.region);
      const geometry = new PlaneGeometry(slot.width, (slot.width * ah) / aw).translate(0, 0, ART_GAP);
      geometry.applyMatrix4(new Matrix4().compose(new Vector3(...slot.at), new Quaternion().setFromEuler(new Euler(...(slot.rot ?? [0, 0, 0]))), new Vector3(1, 1, 1)));
      geometry.applyMatrix4(item.placement);
      const handle = artwork(slot.art, { ...(slot.region ? { region: slot.region } : {}), ...(options.onChange ? { onReady: options.onChange } : {}) });
      releases.push(handle.release);
      const mat = artworkMaterial(art, handle.texture);
      mat.name = `oeuvre_${slot.art}`;
      patchGarageMaterial(mat, surfaceUniforms);
      owned.push(mat);
      const mesh = add(artGroup, tagCut(geometry, item.id), mat, `oeuvre_${item.prop.name}_${slot.region ?? slot.art}`);
      if (item.small) mesh.layers.set(NO_MIRROR_LAYER);
    }
  }
  root.add(artGroup);

  // Ombres de contact (cahier § 3.1) : une tache par objet, au sol, sur le meuble qui le porte ou
  // sur le mur qui l'accroche ; une géométrie, un appel de dessin, hors reflet, dessinée après les
  // halos. Chaque tache porte l'élément de son objet et s'éteint avec lui (fondu par l'opacité).
  const halfW = layout.room.width / 2;
  const halfD = layout.room.depth / 2;
  const patches: BufferGeometry[] = [];
  for (const item of furnished) {
    const { box, localBox, prop } = item;
    if (prop.contact === false || !box || !localBox) continue;
    const size = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]] as const;
    if (Math.max(size[0], size[2]) > CONTACT.maxExtent) continue;
    const rest = rests.get(item.id) ?? null;
    if (rest !== null) {
      // Au sol ou sur un meuble : emprise dans le repère de l'objet, tournée avec lui. Sur un
      // meuble, la tache s'éteint avant le bord du dessus qui le porte ; un objet posé de biais
      // y prend l'emprise de sa boîte, alignée sur la pièce comme ce bord (la borne reste exacte).
      // Une tache plate ne se pose que sur un dessus plat (sur une pente, l'objet dit `contact:
      // false`) : sans pièce du porteur à la hauteur déclarée, pas de tache (scene-decor.test.ts le signale).
      if (prop.rest && rest.footprint === null) continue;
      const kind = rest.footprint === null ? CONTACT.floor : CONTACT.rest;
      const quarter = (prop.turn ?? 0) / (Math.PI / 2);
      const square = rest.footprint === null || Math.abs(quarter - Math.round(quarter)) < 1e-6;
      const frame = square ? localBox : box;
      const turn = new Quaternion().setFromEuler(new Euler(0, square ? (prop.turn ?? 0) : 0, 0));
      const u = new Vector3(1, 0, 0).applyQuaternion(turn);
      const v = new Vector3(0, 0, -1).applyQuaternion(turn);
      const centre = new Vector3((frame.min[0] + frame.max[0]) / 2, 0, (frame.min[2] + frame.max[2]) / 2);
      if (square) centre.applyMatrix4(item.placement);
      centre.y = rest.height + kind.lift;
      const half = [(frame.max[0] - frame.min[0]) / 2, (frame.max[2] - frame.min[2]) / 2] as const;
      const reach = rest.footprint ? reachWithin(centre, [u.clone().negate(), u, v.clone().negate(), v], rest.footprint) : undefined;
      const patch = contactPatch(centre, u, v, half, kind.margin, kind.opacity, reach);
      if (rest.slope !== 0) {
        // Dessus en pente : la tache suit le plan du porteur, à partir de l'aplomb de l'origine de l'objet.
        const position = patch.getAttribute('position');
        const rise = Math.tan(rest.slope);
        for (let i = 0; i < position.count; i += 1) position.setY(i, position.getY(i) + (prop.at[2] - position.getZ(i)) * rise);
      }
      patches.push(tagCut(patch, item.id));
      continue;
    }
    const kind = CONTACT.wall;
    if (box.min[1] < kind.minHeight) continue;
    // Accroché : le mur le plus proche, à moins de `reach` ; projection de la boîte, un peu plus bas.
    const walls = [
      { gap: box.min[0] + halfW, normal: new Vector3(1, 0, 0), plane: -halfW, depth: size[0] },
      { gap: halfW - box.max[0], normal: new Vector3(-1, 0, 0), plane: halfW, depth: size[0] },
      { gap: box.min[2] + halfD, normal: new Vector3(0, 0, 1), plane: -halfD, depth: size[2] },
      { gap: halfD - box.max[2], normal: new Vector3(0, 0, -1), plane: halfD, depth: size[2] },
    ].sort((p, q) => p.gap - q.gap);
    const wall = walls[0];
    if (!wall || wall.gap > kind.reach || wall.depth < CONTACT.flat) continue;
    const up = new Vector3(0, 1, 0);
    const u = new Vector3().crossVectors(up, wall.normal);
    const centre = new Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2 - kind.drop, (box.min[2] + box.max[2]) / 2);
    const across = Math.abs(wall.normal.x) > 0.5 ? size[2] : size[0];
    if (Math.abs(wall.normal.x) > 0.5) centre.x = wall.plane + wall.normal.x * kind.lift;
    else centre.z = wall.plane + wall.normal.z * kind.lift;
    patches.push(tagCut(contactPatch(centre, u, up, [across / 2, size[1] / 2], kind.margin, kind.opacity), item.id));
  }
  const contactMaterial = new MeshBasicMaterial({
    name: 'garage_contact',
    color: 0x000000,
    alphaMap: garageTexture('contact'),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  patchGarageMaterial(contactMaterial, surfaceUniforms);
  owned.push(contactMaterial);
  if (patches.length > 0) {
    const shadows = add(root, merge(patches), contactMaterial, 'garage_contact');
    shadows.layers.set(NO_MIRROR_LAYER);
    shadows.renderOrder = 0;
  }

  const lights = {
    ambient: new HemisphereLight(),
    left: new PointLight(),
    right: new PointLight(),
    key: new SpotLight(),
  };
  lights.left.position.set(...layout.lights.left);
  lights.right.position.set(...layout.lights.right);
  lights.key.position.set(...layout.lights.key);
  lights.key.target.position.set(...layout.lights.keyTarget);
  lights.key.angle = 0.55;
  lights.key.penumbra = 0.85;
  for (const light of [lights.left, lights.right, lights.key]) light.decay = 2;
  root.add(lights.ambient, lights.left, lights.right, lights.key, lights.key.target);

  let dynamicGeometries: BufferGeometry[] = [];

  function update(ambiance: Ambiance): void {
    for (const geometry of dynamicGeometries) geometry.dispose();
    dynamicGeometries = [];
    dynamic.clear();
    const put = (geometry: BufferGeometry, mat: Material, name: string) => {
      dynamicGeometries.push(geometry);
      ensureCut(geometry, mat);
      const mesh = new Mesh(geometry, mat);
      mesh.name = name;
      mesh.renderOrder = mat === emissive || mat === stands ? 0 : -1;
      dynamic.add(mesh);
      return mesh;
    };

    // Spots, bandeaux et tubes : une seule géométrie colorée par sommet.
    const sources: BufferGeometry[] = [];
    layout.spots.forEach((spot, index) => {
      sources.push(tagCut(paint(spotGeometry(spot), hdr(ambiance, spot.color, ambiance.spotGain)), spotIds[index] ?? 0));
    });
    if (ambiance.stripGain > 0) {
      layout.strips.forEach((strip, index) => {
        sources.push(tagCut(paint(stripGeometry(strip), hdr(ambiance, strip.color, ambiance.stripGain)), stripIds[index] ?? 0));
      });
    }
    const tubes = ambiance.standTubes;
    const footGeometries: BufferGeometry[] = [];
    const { height } = layout.standTubes;
    layout.standTubes.at.forEach(([x, z], index) => {
      const hex = tubes[index % Math.max(1, tubes.length)];
      if (!hex) return;
      const id = standIds[index] ?? 0;
      const { foot, tube } = standGeometries(x, z, height);
      sources.push(tagCut(paint(tube, new Color(hex).multiplyScalar(ambiance.tubeGain)), id));
      footGeometries.push(...foot.map((geometry) => tagCut(geometry, id)));
    });
    put(merge(sources), emissive, 'garage_sources_emissives');
    // Rampes lumineuses douces au-dessus du véhicule, tournées vers le sol : vues de la sonde
    // seule. Elles tracent les longs reflets de la caisse sans barrer le haut de l'image.
    const bars = layout.lightBars.map((bar) =>
      tagCut(paint(plane(bar.size[0], bar.size[1], bar.at, bar.facing ?? '-y', false), hdr(ambiance, 'bar', ambiance.barGain)), 0),
    );
    if (bars.length > 0) put(merge(bars), emissive, 'garage_rampes').layers.set(PROBE_ONLY_LAYER);
    if (footGeometries.length > 0) put(merge(footGeometries), stands, 'placeholder_pieds_tubes');

    // Halos additifs : flaques au sol et sur les murs, halos doubles sous les spots.
    const halos: Record<'rond' | 'goutte', BufferGeometry[]> = { rond: [], goutte: [] };
    for (const item of layout.halos) {
      const geometry = plane(item.size[0], item.size[1], item.at, item.facing, false);
      halos[item.kind].push(paint(geometry, hdr(ambiance, item.color, item.gain * ambiance.haloGain)));
    }
    const [hw, hh] = layout.spotHalo.size;
    for (const spot of layout.spots) {
      if (!spot.wallHalo) continue;
      // Haut du halo juste sous la retombée, pointe fondue vers le bas.
      const at: Vec3 = [spot.at[0], spot.at[1] - hh / 2, -D / 2 + 0.009];
      const slot = SPOT_SLOTS.indexOf(spot.color);
      const gain = layout.spotHalo.gain * ambiance.haloGain * (ambiance.spotHaloGain[slot] ?? 1);
      halos.goutte.push(paint(plane(hw, hh, at, '+z', false), hdr(ambiance, spot.color, gain)));
      // Cœur du halo, plus petit et d'une teinte plus claire (cyan sous le bleu, orange sous le rouge).
      const core = ambiance.spotCores[slot] ?? colorOf(ambiance, spot.color);
      const coreAt: Vec3 = [at[0], spot.at[1] - hh * 0.22, at[2] + 0.001];
      halos.goutte.push(paint(plane(hw * 0.5, hh * 0.44, coreAt, '+z', false), new Color(core).multiplyScalar(gain * 0.38)));
    }
    for (const kind of ['rond', 'goutte'] as const) {
      const parts = halos[kind];
      if (parts.length === 0) continue;
      put(merge(parts), haloMaterials[kind], `garage_halos_${kind}`);
    }

    // Atmosphère : cônes croisés sous les spots, nappes au ras du sol. Calque 1, additifs.
    for (const geometry of atmosphereGeometries) geometry.dispose();
    atmosphereGeometries = [];
    atmosphere.clear();
    const beams: BufferGeometry[] = [];
    layout.spots.forEach((spot, index) => {
      const id = beamIds[index] ?? 0;
      if (id === 0) return;
      const slot = SPOT_SLOTS.indexOf(spot.color);
      const color = hdr(ambiance, spot.color, ambiance.beamGain * (ambiance.spotHaloGain[slot] ?? 1));
      beams.push(...beamGeometries(spot, layout).map((geometry) => tagCut(beamFade(paint(geometry, color), layout, spot), id)));
    });
    const mists = layout.mists.map((mist) => paint(plane(mist.size[0], mist.size[1], mist.at, mist.facing, false), hdr(ambiance, mist.color, mist.gain * ambiance.mistGain)));
    for (const [parts, kind] of [[beams, 'cone'], [mists, 'nappe']] as const) {
      if (parts.length === 0) continue;
      const geometry = merge(parts);
      atmosphereGeometries.push(geometry);
      const mesh = new Mesh(geometry, haloMaterials[kind]);
      mesh.name = `garage_atmosphere_${kind}`;
      mesh.layers.set(ATMOSPHERE_LAYER);
      mesh.renderOrder = 1;
      atmosphere.add(mesh);
    }
    surfaceUniforms.pmbHazeColor.value.set(ambiance.night);

    if (neonMesh) {
      const colors = neonMesh.geometry.getAttribute('color') as Float32BufferAttribute;
      const values = colors.array as Float32Array;
      for (let i = 0; i < values.length; i += 1) values[i] = (neonBase[i] ?? 0) * ambiance.tubeGain;
      colors.needsUpdate = true;
    }

    lights.ambient.color.set(ambiance.sky);
    lights.ambient.groundColor.set(ambiance.ground);
    lights.ambient.intensity = ambiance.ambient;
    lights.left.color.set(ambiance.left);
    lights.right.color.set(ambiance.right);
    lights.left.intensity = ambiance.sideIntensity;
    lights.right.intensity = ambiance.sideIntensity;
    lights.key.color.set(ambiance.key);
    lights.key.intensity = ambiance.keyIntensity;
    refreshDither();
  }

  function setQuality({ reflection, atmosphere: misty }: { reflection: boolean; atmosphere: boolean }): void {
    setReflection(floorMaterial, reflection);
    // Avec la réflexion planaire, le reflet de la sonde sur le sol s'efface devant elle.
    surfaceUniforms.pmbIblSpecular.value = reflection ? layout.mirrorIbl : 1;
    atmosphere.visible = misty;
  }

  function dispose(): void {
    for (const geometry of [...dynamicGeometries, ...atmosphereGeometries]) geometry.dispose();
    for (const item of owned) item.dispose();
    for (const mat of materials.values()) mat.dispose();
    for (const release of releases) release();
  }

  refreshDither();
  return { root, floor, surfaces: surfaceUniforms, cut: { elements, structure, fades, dither }, update, setQuality, dispose };
}
