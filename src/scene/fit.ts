// Cadrage de la caméra d'orbite selon la forme de l'écran. Module pur (testable).

import type { ZoneFraming } from '../data/framings.ts';
import { zoneFrame, type LiveryFace } from '../data/stickersCalques.ts';

export interface CameraFit {
  /** Champ vertical, en degrés. */
  fov: number;
  /** Distance de la caméra à sa cible, en mètres. */
  distance: number;
  minDistance: number;
  maxDistance: number;
}

/** Hauteur à garder visible autour de la cible, en mètres. */
const HALF_HEIGHT = 1.7;
/** Plage de zoom autour de la distance de cadrage (pincement, double-tap plus tard). */
const ZOOM_IN = 0.55;
const ZOOM_OUT = 1.5;

/**
 * Distance à laquelle un objet de demi-longueur `halfLength` tient dans la largeur de l'écran.
 * En portrait, c'est la largeur qui commande : on ouvre le champ pour ne pas trop reculer.
 */
export function fitCamera(width: number, height: number, halfLength: number): CameraFit {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const portrait = h > w * 1.15;
  const fov = portrait ? 46 : 34;
  const vHalf = (fov * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * (w / h));
  const distance = Math.max(halfLength / Math.tan(hHalf), HALF_HEIGHT / Math.tan(vHalf));
  return {
    fov,
    distance,
    minDistance: distance * ZOOM_IN,
    maxDistance: distance * ZOOM_OUT,
  };
}

/**
 * Vue de départ : côté gauche (azimut négatif), trois quarts avant du véhicule posé nez à
 * gauche, légèrement au-dessus. Dans le même cadre : le mur du fond et ses halos, le mur rouge.
 */
export const START_AZIMUTH = -0.5;
export const START_POLAR = 1.42;

/** Position de la caméra sur son orbite (azimut 0 : face au mur du fond, depuis le canapé). */
export function orbitPosition(
  target: readonly [number, number, number],
  distance: number,
  azimuth = START_AZIMUTH,
  polar = START_POLAR,
): [number, number, number] {
  const s = Math.sin(polar);
  return [
    target[0] + Math.sin(azimuth) * s * distance,
    target[1] + Math.cos(polar) * distance,
    target[2] + Math.cos(azimuth) * s * distance,
  ];
}

/**
 * Bande haute gardée libre au-dessus du véhicule quand le dock est agrandi (nom de l'atelier,
 * pastille d'état), en part de la hauteur de l'écran.
 */
export const DOCK_TOP_MARGIN = 0.1;

/**
 * Dock agrandi : décalage vertical de la vue, en pixels vers le haut, qui amène la cible (au centre
 * de l'image) au milieu de la partie libre, entre la bande haute et le haut du dock. Sans dock
 * agrandi (`dockTop` nul), ou si la cible est déjà dans la partie libre, rien ne bouge : le cadrage
 * d'origine reste celui du dock compact.
 */
export function dockShift(height: number, dockTop: number | null): number {
  if (dockTop === null || !Number.isFinite(dockTop) || height <= 0) return 0;
  const top = Math.min(Math.max(dockTop, 0), height);
  const free = (height * DOCK_TOP_MARGIN + top) / 2;
  return Math.max(0, Math.round(height / 2 - free));
}

/**
 * Même décalage quand le véhicule est déjà centré dans la partie libre au-dessus du dock compact
 * (cadrage par véhicule, fitVehicle) : la vue monte de la moitié de ce que le dock agrandi gagne
 * sur le dock compact, et le centre du véhicule suit le centre de la partie libre.
 */
export function dockShiftFrom(compactTop: number, dockTop: number | null): number {
  if (dockTop === null || !Number.isFinite(dockTop) || !Number.isFinite(compactTop)) return 0;
  return Math.max(0, Math.round((compactTop - dockTop) / 2));
}

/** Durée du recadrage quand le dock change de taille (coupé si l'on demande moins de mouvement). */
export const DOCK_SHIFT_MS = 260;

/** Courbe du recadrage : départ vif, arrivée douce. `t` dans [0, 1]. */
export function easeOutCubic(t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  return 1 - (1 - clamped) ** 3;
}

// ————————————————————————————————————————————————————————————————————————————————————————
// Côté de présentation, cadrage par véhicule, vue intérieure. Toujours du calcul pur.

type Vec3 = readonly [number, number, number];

/** Côté du véhicule montré au départ (manifeste, `presentSide`) ; absent : le gauche. */
export type PresentSide = 'gauche' | 'droite';

/**
 * Pose de départ selon le côté montré. Gauche : le véhicule nez à gauche (groupe tourné de π),
 * la caméra côté gauche, trois quarts avant. Droite : le véhicule nez à droite (tour nul), la
 * caméra du même côté de la pièce, presque de profil (léger trois quarts arrière) : le flanc
 * droit et ses échappements devant le même fond, le mur du fond et ses halos (une caméra en
 * miroir regarderait l'établi et perdrait la signature du lieu).
 */
export function presentPose(side: PresentSide | undefined): { turn: number; azimuth: number } {
  return side === 'droite' ? { turn: 0, azimuth: START_AZIMUTH / 2 } : { turn: Math.PI, azimuth: START_AZIMUTH };
}

/** Repère du véhicule → repère de la pièce (le groupe du véhicule est tourné de `turn` autour de la verticale). */
export function vehicleToRoom(point: Vec3, turn: number): [number, number, number] {
  const cos = Math.cos(turn);
  const sin = Math.sin(turn);
  const [x, y, z] = point;
  return [x * cos + z * sin, y, -x * sin + z * cos];
}

/** Boîte du véhicule posé : demi-longueur, demi-largeur, hauteur (en mètres). */
export interface BoxSize {
  halfLength: number;
  halfWidth: number;
  height: number;
}

/** Caméra regardant `target` depuis `eye` (haut : +Y), champ vertical `fov` en degrés. */
export interface LookCamera {
  eye: Vec3;
  target: Vec3;
  fov: number;
  width: number;
  height: number;
}

/** Cadre à l'écran, en pixels CSS : bords gauche, droit, haut, bas. */
export interface ScreenFrame {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * Projette des points de la pièce à l'écran : le cadre qui les contient, en pixels CSS. Caméra
 * sans décalage de vue (la cible au centre de l'image).
 */
export function projectPoints(points: Iterable<Vec3>, camera: LookCamera): ScreenFrame {
  const [ex, ey, ez] = camera.eye;
  // Axe de visée f, droite r = f × haut, haut u = r × f.
  let fx = camera.target[0] - ex;
  let fy = camera.target[1] - ey;
  let fz = camera.target[2] - ez;
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl;
  fy /= fl;
  fz /= fl;
  let rx = -fz;
  let rz = fx;
  const rl = Math.hypot(rx, rz) || 1;
  rx /= rl;
  rz /= rl;
  const ux = -rz * fy;
  const uy = rz * fx - rx * fz;
  const uz = rx * fy;
  const tanV = Math.tan((camera.fov * Math.PI) / 360);
  const tanH = tanV * (camera.width / camera.height);
  const frame: ScreenFrame = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const [px, py, pz] of points) {
    const dx = px - ex;
    const dy = py - ey;
    const dz = pz - ez;
    const depth = Math.max(1e-3, dx * fx + dy * fy + dz * fz);
    const sx = (dx * rx + dz * rz) / depth / tanH;
    const sy = (dx * ux + dy * uy + dz * uz) / depth / tanV;
    const left = ((sx + 1) / 2) * camera.width;
    const top = ((1 - sy) / 2) * camera.height;
    frame.left = Math.min(frame.left, left);
    frame.right = Math.max(frame.right, left);
    frame.top = Math.min(frame.top, top);
    frame.bottom = Math.max(frame.bottom, top);
  }
  return frame;
}

/** Projette les huit coins de la boîte du véhicule (posé de `turn` dans la pièce) à l'écran. */
export function projectBox(size: BoxSize, turn: number, camera: LookCamera): ScreenFrame {
  const corners: Vec3[] = [];
  for (const x of [-size.halfLength, size.halfLength]) {
    for (const z of [-size.halfWidth, size.halfWidth]) {
      for (const y of [0, size.height]) corners.push(vehicleToRoom([x, y, z], turn));
    }
  }
  return projectPoints(corners, camera);
}

/** Part de la largeur de l'écran occupée par le véhicule dans la vue de départ. */
export const FRAME_SHARE = 0.8;
/** Hauteur au plus de la partie libre que le véhicule peut occuper (grand van, écran trapu). */
const FRAME_SHARE_HEIGHT = 0.86;

export interface VehicleFrameInput {
  width: number;
  height: number;
  size: BoxSize;
  turn: number;
  azimuth: number;
  /** Élévation de la caméra (angle depuis la verticale) ; absente : celle de départ. */
  polar?: number;
  /** Partie libre de l'écran (sous la marque, au-dessus du dock compact), en pixels CSS. */
  band: { top: number; bottom: number };
  /**
   * Largeur de la partie libre, quand elle est plus étroite que l'écran (paysage : l'écran moins le
   * menu en colonne et les boutons ronds). Le véhicule en occupe `FRAME_SHARE` ; absente : la
   * largeur de l'écran. La vue se décale ensuite de `zoneShift` pour le centrer dans cette zone.
   */
  zoneWidth?: number;
}

export interface VehicleFit extends CameraFit {
  /** Cible de l'orbite : au centre du véhicule, à la hauteur qui le centre dans la partie libre. */
  target: [number, number, number];
  azimuth: number;
}

function bisect(lo: number, hi: number, tooLow: (value: number) => boolean): number {
  for (let i = 0; i < 40; i += 1) {
    const mid = (lo + hi) / 2;
    if (tooLow(mid)) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Cadrage de départ d'un véhicule mesuré : la distance qui lui fait occuper `FRAME_SHARE` de la
 * largeur (sans dépasser `FRAME_SHARE_HEIGHT` de la partie libre en hauteur), et la hauteur de
 * cible qui le centre verticalement dans la partie libre. Voiture ou moto, même règle.
 */
export function fitVehicle({ width, height, size, turn, azimuth, polar, band, zoneWidth }: VehicleFrameInput): VehicleFit {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const zone = Math.min(w, Math.max(1, zoneWidth ?? w));
  const fov = fitCamera(w, h, size.halfLength).fov;
  const bandTop = Math.min(Math.max(band.top, 0), h - 1);
  const bandBottom = Math.min(Math.max(band.bottom, bandTop + 1), h);
  const bandHeight = bandBottom - bandTop;
  const bandCenter = (bandTop + bandBottom) / 2;
  let targetY = size.height / 2;
  let distance = 6;
  const frameAt = (d: number, y: number): ScreenFrame => {
    const target: Vec3 = [0, y, 0];
    return projectBox(size, turn, { eye: orbitPosition(target, d, azimuth, polar), target, fov, width: w, height: h });
  };
  // Deux passes suffisent : la hauteur de cible change à peine la largeur à l'écran.
  for (let pass = 0; pass < 3; pass += 1) {
    const y = targetY;
    const byWidth = bisect(0.5, 60, (d) => {
      const f = frameAt(d, y);
      return f.right - f.left > FRAME_SHARE * zone;
    });
    const byHeight = bisect(0.5, 60, (d) => {
      const f = frameAt(d, y);
      return f.bottom - f.top > FRAME_SHARE_HEIGHT * bandHeight;
    });
    distance = Math.max(byWidth, byHeight);
    // Monter la cible descend le véhicule à l'écran : on cherche le centre de la partie libre.
    targetY = bisect(-4, 6, (ty) => {
      const f = frameAt(distance, ty);
      return (f.top + f.bottom) / 2 < bandCenter;
    });
  }
  return {
    fov,
    distance,
    minDistance: distance * ZOOM_IN,
    maxDistance: distance * ZOOM_OUT,
    target: [0, targetY, 0],
    azimuth,
  };
}

/** Repère de l'orbite : azimut, élévation (depuis la verticale) et distance d'une caméra autour de sa cible. */
export interface OrbitAngles {
  azimuth: number;
  polar: number;
  distance: number;
}

/** Lit l'orbite d'une caméra posée en `position` autour de `target` (l'inverse de `orbitPosition`). */
export function orbitAngles(position: Vec3, target: Vec3): OrbitAngles {
  const ox = position[0] - target[0];
  const oy = position[1] - target[1];
  const oz = position[2] - target[2];
  const distance = Math.hypot(ox, oy, oz) || 1e-6;
  return { azimuth: Math.atan2(ox, oz), polar: Math.acos(Math.min(1, Math.max(-1, oy / distance))), distance };
}

/**
 * Tourner le téléphone : la vue choisie au doigt suit le cadrage de la nouvelle orientation.
 * L'azimut et l'élévation ne changent pas ; la distance garde sa part du cadrage, c'est-à-dire le
 * rapport entre la distance où le doigt l'a mise et celle qui cadre le véhicule sous ce même
 * angle (80 % de la zone libre) : un véhicule qui remplissait la moitié de la zone la remplit
 * encore à moitié, entier, après la rotation. La distance rendue n'est pas rognée : les contrôles
 * d'orbite la bornent à la plage de zoom du nouveau cadrage, la mémoire garde la valeur brute (un
 * passage par un cadrage extrême ne doit pas coûter le zoom au retour).
 * `prev` et `next` : les entrées du cadrage avant et après (même véhicule, même côté).
 */
export function carryOrbit(prev: VehicleFrameInput, next: VehicleFrameInput, position: Vec3, target: Vec3): { position: [number, number, number]; target: [number, number, number] } {
  const now = orbitAngles(position, target);
  const home = fitVehicle(next);
  const before = fitVehicle({ ...prev, azimuth: now.azimuth, polar: now.polar }).distance;
  const after = fitVehicle({ ...next, azimuth: now.azimuth, polar: now.polar }).distance;
  const distance = (now.distance * after) / before;
  return { position: orbitPosition(home.target, distance, now.azimuth, now.polar), target: home.target };
}

/** Zone libre d'un écran en paysage : entre les boutons ronds (à gauche) et le menu en colonne (à droite). */
export interface FreeZone {
  left: number;
  right: number;
}

/**
 * Zone libre par défaut avant mesure du menu : le menu prend `MENU_SHARE` de la largeur, les
 * boutons ronds `RAIL_SHARE`. Les parcours mesurent la vraie zone à l'écran (GarageCanvas).
 */
export const MENU_SHARE = 0.36;
export const RAIL_SHARE = 0.09;

export function defaultZone(width: number): FreeZone {
  return { left: Math.round(width * RAIL_SHARE), right: Math.round(width * (1 - MENU_SHARE)) };
}

/**
 * Paysage, menu ouvert : décalage horizontal de la vue, en pixels vers la gauche, qui amène la cible
 * (au centre de l'image) au milieu de la zone libre. Menu fermé, ou zone déjà centrée : rien ne bouge.
 * Même mécanisme que le décalage vertical du dock agrandi : la caméra ne bouge pas.
 */
export function zoneShift(width: number, zone: FreeZone | null): number {
  if (zone === null || !Number.isFinite(zone.left) || !Number.isFinite(zone.right) || width <= 0) return 0;
  const left = Math.min(Math.max(zone.left, 0), width);
  const right = Math.min(Math.max(zone.right, left), width);
  return Math.max(0, Math.round(width / 2 - (left + right) / 2));
}

/** Point de vue intérieur résolu : œil et point regardé (repère du véhicule). */
export interface InteriorView {
  eye: Vec3;
  target: Vec3;
}

/**
 * Vue intérieure : champ plus large qu'en atelier (en portrait, volant, compteur et levier dans
 * l'image au-dessus du dock compact), plan proche rapproché (le volant n'est pas tranché),
 * regard borné autour de l'axe du manifeste, transition courte.
 */
export const INTERIOR = {
  fovPortrait: 90,
  fovLandscape: 70,
  near: 0.02,
  /** Lacet au plus, de part et d'autre de l'axe de la place, en radians. */
  yaw: (110 * Math.PI) / 180,
  /** Tangage au plus vers le bas, depuis l'axe de la place, en radians. */
  pitch: (40 * Math.PI) / 180,
  /** Tangage au plus vers le haut : assez pour lever les yeux vers le ciel étoilé du pavillon. */
  pitchUp: (75 * Math.PI) / 180,
  /** Gain du glissé : au-delà de 1, le regard tourne plus vite que l'image ne suit le doigt. */
  dragGain: 1.6,
  transitionMs: 420,
} as const;

/** Direction du regard : lacet autour de la verticale (0 : vers +Z), tangage (positif : vers le haut). */
export interface Look {
  yaw: number;
  pitch: number;
}

/**
 * Champ vertical de la vue intérieure, en degrés. `portrait` : celui que le point de vue déclare
 * (manifeste, interiorView.fov) pour un écran en hauteur ; en largeur, le champ garde la même
 * proportion à celui de l'app.
 */
export function interiorFov(width: number, height: number, portrait: number = INTERIOR.fovPortrait): number {
  return height > Math.max(1, width) * 1.15 ? portrait : (INTERIOR.fovLandscape * portrait) / INTERIOR.fovPortrait;
}

/** Œil et point regardé dans la pièce. */
export function interiorPose(view: InteriorView, turn: number): { eye: [number, number, number]; target: [number, number, number] } {
  return { eye: vehicleToRoom(view.eye, turn), target: vehicleToRoom(view.target, turn) };
}

/** Lacet et tangage du regard de `eye` vers `target`. */
export function lookFrom(eye: Vec3, target: Vec3): Look {
  const dx = target[0] - eye[0];
  const dy = target[1] - eye[1];
  const dz = target[2] - eye[2];
  return { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

/** Ramène un angle dans ]−π, π]. */
function wrap(angle: number): number {
  const turned = angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
  return turned <= -Math.PI ? turned + Math.PI * 2 : turned;
}

/**
 * Borne le regard autour de l'axe `base` : ±`INTERIOR.yaw` en lacet, `INTERIOR.pitch` vers le bas et
 * `INTERIOR.pitchUp` vers le haut (on lève les yeux vers le pavillon).
 */
export function clampLook(base: Look, look: Look): Look {
  const dyaw = Math.min(Math.max(wrap(look.yaw - base.yaw), -INTERIOR.yaw), INTERIOR.yaw);
  const dpitch = Math.min(Math.max(look.pitch - base.pitch, -INTERIOR.pitch), INTERIOR.pitchUp);
  return { yaw: base.yaw + dyaw, pitch: Math.min(Math.max(base.pitch + dpitch, -1.45), 1.45) };
}

/** Point regardé à `distance` de l'œil dans la direction `look`. */
export function lookPoint(eye: Vec3, look: Look, distance = 1): [number, number, number] {
  const c = Math.cos(look.pitch);
  return [eye[0] + Math.sin(look.yaw) * c * distance, eye[1] + Math.sin(look.pitch) * distance, eye[2] + Math.cos(look.yaw) * c * distance];
}

/**
 * Glissé du doigt → regard : l'image suit le doigt (vers la droite, on regarde à gauche), avec le
 * gain `INTERIOR.dragGain` sur l'angle que couvre le glissé dans le champ.
 */
export function dragLook(look: Look, dx: number, dy: number, width: number, height: number, fov: number): Look {
  const vHalf = (fov * Math.PI) / 360;
  const perPxV = (2 * vHalf) / Math.max(1, height);
  const perPxH = (2 * Math.atan(Math.tan(vHalf) * (width / Math.max(1, height)))) / Math.max(1, width);
  return { yaw: look.yaw + dx * perPxH * INTERIOR.dragGain, pitch: look.pitch + dy * perPxV * INTERIOR.dragGain };
}

// ---------------------------------------------------------------------------------------------
// Places assises (manifeste, interiorView.seat) : l'œil posé sur les sièges du modèle chargé.

/** Ce qu'on mesure d'un siège posé, en mètres, relatif à son ancre (repère du véhicule). */
export interface SeatMetrics {
  /** Dessus de l'assise, au-dessus de l'ancre. */
  cushion: number;
  /** Face avant du dossier (ou de l'appuie-tête) des épaules au haut de la tête : x le plus en avant. */
  backFront: number;
  /** Dos du siège : x le plus en arrière. */
  back: number;
  /** Haut du siège. */
  top: number;
}

/** Siège sans mesure (pièce pas encore chargée) : un siège moyen du catalogue. */
export const DEFAULT_SEAT: Readonly<SeatMetrics> = Object.freeze({ cushion: 0.33, backFront: -0.24, back: -0.45, top: 1.05 });

/**
 * Lancer de rayon sur la pièce mesurée : distance du premier point touché depuis `origin` dans la
 * direction `direction` (unitaire), ou `null`.
 */
export type Cast = (origin: Vec3, direction: Vec3) => number | null;

/**
 * Mesure un siège posé, au rayon (les faces comptent, pas seulement les sommets) : assise au milieu,
 * face du dossier des épaules au haut de la tête d'une personne dont l'œil est à `up` au-dessus de
 * l'assise. `box` : boîte du siège, relative à son ancre.
 */
export function seatMetrics(cast: Cast, box: { min: Vec3; max: Vec3 }, up = 0.85): SeatMetrics {
  const above = box.max[1] + 0.1;
  let cushion = -Infinity;
  for (const x of [0.02, 0.1]) {
    for (const z of [-0.06, 0, 0.06]) {
      const d = cast([x, above, z], [0, -1, 0]);
      if (d !== null) cushion = Math.max(cushion, above - d);
    }
  }
  if (!Number.isFinite(cushion)) return { ...DEFAULT_SEAT, back: Math.min(DEFAULT_SEAT.back, box.min[0]), top: box.max[1] };
  const ahead = Math.max(0.3, box.max[0] + 0.05);
  let backFront = -Infinity;
  for (let h = cushion + 0.35; h <= cushion + up + 0.1 + 1e-9; h += 0.05) {
    for (const z of [-0.08, 0, 0.08]) {
      const d = cast([ahead, h, z], [-1, 0, 0]);
      if (d !== null && ahead - d < 0) backFront = Math.max(backFront, ahead - d);
    }
  }
  return { cushion, backFront: Number.isFinite(backFront) ? backFront : DEFAULT_SEAT.backFront, back: box.min[0], top: box.max[1] };
}

/** Un siège posé : position de son ancre (repère du véhicule, caisse au repos) et sa mesure. */
export interface PlacedSeat {
  anchor: Vec3;
  metrics: SeatMetrics;
}

/** Description d'une place sur ses sièges (manifeste, interiorView.seat). */
export interface SeatEyeSpec {
  up: number;
  ahead?: number;
  behind?: number;
  side?: number;
  headroom?: number;
}

/** Écart gardé sous le pavillon, par défaut. */
export const HEADROOM = 0.12;

/**
 * Œil d'une place : `up` au-dessus de l'assise des sièges, `ahead` en avant de la face de leur dossier
 * (siège avant) ou `behind` en arrière de leur dos (arrière), au milieu des ancres décalé de `side`,
 * et jamais plus haut que `headroom` sous le pavillon (`roof` : hauteur du pavillon au-dessus d'un
 * point, depuis la hauteur `from`, mesurée dans le modèle chargé ; `null` : rien au-dessus).
 */
export function placeEye(spec: SeatEyeSpec, seats: readonly PlacedSeat[], roof?: (x: number, z: number, from: number) => number | null): [number, number, number] | null {
  if (seats.length === 0) return null;
  const mean = (pick: (seat: PlacedSeat) => number) => seats.reduce((sum, seat) => sum + pick(seat), 0) / seats.length;
  const cushion = mean((seat) => seat.anchor[1] + seat.metrics.cushion);
  let y = cushion + spec.up;
  const x =
    spec.behind !== undefined
      ? Math.min(...seats.map((seat) => seat.anchor[0] + seat.metrics.back)) - spec.behind
      : mean((seat) => seat.anchor[0] + seat.metrics.backFront) + (spec.ahead ?? 0.15);
  const z = mean((seat) => seat.anchor[2]) + (spec.side ?? 0);
  // Pavillon cherché depuis les épaules : plus bas, le rayon toucherait la banquette arrière.
  const ceiling = roof?.(x, z, cushion + 0.5);
  if (ceiling !== null && ceiling !== undefined) y = Math.max(cushion + 0.3, Math.min(y, ceiling - (spec.headroom ?? HEADROOM)));
  return [x, y, z];
}

/** Point regardé depuis `eye`, à un mètre, au cap d'une place (degrés ; lacet vers +Z, tangage vers le haut). */
export function lookTarget(eye: Vec3, look: { yaw: number; pitch: number }): [number, number, number] {
  const yaw = (look.yaw * Math.PI) / 180;
  const pitch = (look.pitch * Math.PI) / 180;
  const c = Math.cos(pitch);
  return [eye[0] + Math.cos(yaw) * c, eye[1] + Math.sin(pitch), eye[2] + Math.sin(yaw) * c];
}

// ---------------------------------------------------------------------------------------------
// Cadrage d'une zone de livrée (Custom › Stickers) : la caméra montre la zone choisie en grand dans
// la partie de l'écran que le panneau laisse libre, puis revient à la vue d'avant. Même orbite que
// l'atelier (cible, azimut, élévation, distance), même décalage de vue que le dock agrandi (dockShift,
// zoneShift) ; le cadrage vient des données (src/data/framings.ts, ZONE_FRAMINGS).

/** Zone de livrée telle que le cadrage la lit (manifeste, `livery`) : face, centre et taille, repère du véhicule. */
export interface ZoneBox {
  face: LiveryFace;
  center: Vec3;
  size: readonly [number, number, number];
}

export interface ZoneFrameInput {
  width: number;
  height: number;
  zone: ZoneBox;
  framing: Pick<ZoneFraming, 'heading' | 'elevation' | 'margin' | 'marginShare' | 'share' | 'shareHeight'>;
  /** Pose du véhicule dans la pièce (presentPose). */
  turn: number;
  /** Partie libre de l'écran, en pixels CSS (au-dessus du panneau en portrait ; à sa gauche en paysage). */
  free: ScreenFrame;
  /** Bornes de l'élévation de l'orbite (angle depuis la verticale), celles des contrôles du garage. */
  polar?: { min: number; max: number };
}

export interface ZoneFit extends CameraFit {
  /** Cible de l'orbite : le centre de la zone, dans la pièce. */
  target: [number, number, number];
  position: [number, number, number];
  azimuth: number;
  polar: number;
  /**
   * Décalage de la vue, en pixels vers la gauche et vers le haut (setViewOffset), qui amène la cible
   * au milieu de la partie libre : la caméra n'a pas à viser à côté de la zone.
   */
  shiftX: number;
  shiftY: number;
  /** La zone et sa marge à l'écran, décalage compris. */
  frame: ScreenFrame;
  /** La zone seule à l'écran, décalage compris. */
  zoneFrame: ScreenFrame;
}

/** Quatre coins du cadre d'une zone (dans le plan de son centre), élargi de `margin` mètres de chaque côté, dans la pièce. */
export function zoneCorners(zone: ZoneBox, turn: number, margin = 0): Array<[number, number, number]> {
  const { right, up } = zoneFrame(zone.face);
  const w = zone.size[0] / 2 + margin;
  const h = zone.size[1] / 2 + margin;
  const corners: Array<[number, number, number]> = [];
  for (const [a, b] of [
    [-w, -h],
    [w, -h],
    [w, h],
    [-w, h],
  ] as const) {
    corners.push(vehicleToRoom([zone.center[0] + right[0] * a + up[0] * b, zone.center[1] + right[1] * a + up[1] * b, zone.center[2] + right[2] * a + up[2] * b], turn));
  }
  return corners;
}

/** Direction de la caméra depuis la zone (unitaire, repère du véhicule), d'après le cadrage. */
export function zoneDirection(zone: Pick<ZoneBox, 'face'>, framing: Pick<ZoneFraming, 'heading' | 'elevation'>): [number, number, number] {
  const { normal } = zoneFrame(zone.face);
  const horizontal = Math.hypot(normal[0], normal[2]);
  const heading = framing.heading === 'normale' ? (horizontal > 1e-6 ? Math.atan2(normal[2], normal[0]) : Math.PI) : framing.heading;
  const c = Math.cos(framing.elevation);
  return [Math.cos(heading) * c, Math.sin(framing.elevation), Math.sin(heading) * c];
}

/**
 * Cadrage d'une zone : la caméra sur la direction du cadrage, à la distance où la zone occupe au plus
 * `share` de la largeur libre et `shareHeight` de sa hauteur, autour de la cible ; la vue décalée
 * pour que la cible tombe au milieu de la partie libre.
 */
export function fitZone({ width, height, zone, framing, turn, free, polar: range }: ZoneFrameInput): ZoneFit {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const fov = fitCamera(w, h, 1).fov;
  const target = vehicleToRoom(zone.center, turn);
  const [dx, dy, dz] = vehicleToRoom(zoneDirection(zone, framing), turn);
  const azimuth = Math.atan2(dx, dz);
  let polar = Math.acos(Math.min(1, Math.max(-1, dy)));
  if (range) polar = Math.min(Math.max(polar, range.min), range.max);
  const left = Math.min(Math.max(free.left, 0), w - 1);
  const right = Math.min(Math.max(free.right, left + 1), w);
  const top = Math.min(Math.max(free.top, 0), h - 1);
  const bottom = Math.min(Math.max(free.bottom, top + 1), h);
  const margin = Math.min(framing.margin, framing.marginShare * Math.max(zone.size[0], zone.size[1]));
  const corners = zoneCorners(zone, turn, margin);
  const frameAt = (d: number) => projectPoints(corners, { eye: orbitPosition(target, d, azimuth, polar), target, fov, width: w, height: h });
  // Écart au centre de l'image, de part et d'autre : la cible y est, le décalage la porte au milieu de la partie libre.
  const halfWidth = (f: ScreenFrame) => Math.max(w / 2 - f.left, f.right - w / 2);
  const halfHeight = (f: ScreenFrame) => Math.max(h / 2 - f.top, f.bottom - h / 2);
  const byWidth = bisect(0.2, 60, (d) => 2 * halfWidth(frameAt(d)) > framing.share * (right - left));
  const byHeight = bisect(0.2, 60, (d) => 2 * halfHeight(frameAt(d)) > framing.shareHeight * (bottom - top));
  const distance = Math.max(byWidth, byHeight);
  const shiftX = Math.round(w / 2 - (left + right) / 2);
  const shiftY = Math.round(h / 2 - (top + bottom) / 2);
  const seen = projectPoints(zoneCorners(zone, turn), { eye: orbitPosition(target, distance, azimuth, polar), target, fov, width: w, height: h });
  const framed = frameAt(distance);
  return {
    fov,
    distance,
    minDistance: distance * ZOOM_IN,
    maxDistance: distance * ZOOM_OUT,
    target,
    position: orbitPosition(target, distance, azimuth, polar),
    azimuth,
    polar,
    shiftX,
    shiftY,
    frame: { left: framed.left - shiftX, right: framed.right - shiftX, top: framed.top - shiftY, bottom: framed.bottom - shiftY },
    zoneFrame: { left: seen.left - shiftX, right: seen.right - shiftX, top: seen.top - shiftY, bottom: seen.bottom - shiftY },
  };
}

/** Pose d'orbite : position de la caméra et cible, dans la pièce. */
export interface OrbitPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Ramène un écart d'angle dans ]−π, π] (le plus court chemin). */
function shortest(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

/**
 * Pose entre deux poses d'orbite, à `k` (0 : `from`, 1 : `to`), écrite dans `out` (aucune
 * allocation : appelé à chaque image d'une transition). On tourne autour de la cible qui glisse :
 * azimut par le plus court chemin, élévation, distance en proportion. La caméra ne traverse pas le véhicule.
 */
export function blendOrbit(from: OrbitPose, to: OrbitPose, k: number, out: OrbitPose): OrbitPose {
  const t = Math.min(Math.max(k, 0), 1);
  const ox = from.position[0] - from.target[0];
  const oy = from.position[1] - from.target[1];
  const oz = from.position[2] - from.target[2];
  const gx = to.position[0] - to.target[0];
  const gy = to.position[1] - to.target[1];
  const gz = to.position[2] - to.target[2];
  const d0 = Math.hypot(ox, oy, oz) || 1e-6;
  const d1 = Math.hypot(gx, gy, gz) || 1e-6;
  const a0 = Math.atan2(ox, oz);
  const a1 = a0 + shortest(Math.atan2(gx, gz) - a0);
  const p0 = Math.acos(Math.min(1, Math.max(-1, oy / d0)));
  const p1 = Math.acos(Math.min(1, Math.max(-1, gy / d1)));
  const azimuth = a0 + (a1 - a0) * t;
  const polar = p0 + (p1 - p0) * t;
  const distance = d0 * (d1 / d0) ** t;
  for (let i = 0; i < 3; i += 1) out.target[i] = from.target[i]! + (to.target[i]! - from.target[i]!) * t;
  const s = Math.sin(polar);
  out.position[0] = out.target[0] + Math.sin(azimuth) * s * distance;
  out.position[1] = out.target[1] + Math.cos(polar) * distance;
  out.position[2] = out.target[2] + Math.cos(azimuth) * s * distance;
  return out;
}

/** Où en est le cadrage de zone : vue d'atelier, en route vers la zone, sur la zone, en retour. */
export type ZonePhase = 'out' | 'entering' | 'in' | 'leaving';

/**
 * État du cadrage de zone, tenu par la scène. `saved` : la vue d'atelier d'avant (celle que le doigt
 * avait choisie), rendue en quittant les stickers. Fonctions pures ci-dessous : requestZone, stepZone.
 */
export interface ZoneRig {
  phase: ZonePhase;
  /** Demande en cours (véhicule, zone, écran) ; `null` : aucune. */
  key: string | null;
  from: OrbitPose;
  goal: OrbitPose;
  saved: OrbitPose | null;
  start: number;
  /** La transition a vu sa première image : son horloge part de là (un téléphone qui tarde ne la saute pas). */
  started: boolean;
  duration: number;
}

export function createZoneRig(): ZoneRig {
  const pose = (): OrbitPose => ({ position: [0, 0, 0], target: [0, 0, 0] });
  return { phase: 'out', key: null, from: pose(), goal: pose(), saved: null, start: 0, started: false, duration: 0 };
}

function copyPose(into: OrbitPose, from: OrbitPose): void {
  for (let i = 0; i < 3; i += 1) {
    into.position[i] = from.position[i]!;
    into.target[i] = from.target[i]!;
  }
}

/**
 * Demande un cadrage (`request`) ou le retire (`null`). `current` : la pose de la caméra à cet
 * instant ; `home` : la vue d'atelier gardée, rendue en sortant. En entrant, la vue d'atelier est
 * mise de côté ; d'une zone à l'autre, elle reste celle d'avant les stickers. `duration` nulle : sans transition.
 */
export function requestZone(rig: ZoneRig, request: { key: string; goal: OrbitPose } | null, current: OrbitPose, home: OrbitPose, now: number, duration: number): ZoneRig {
  if (request) {
    if (rig.key === request.key && (rig.phase === 'entering' || rig.phase === 'in')) return rig;
    if (rig.phase === 'out' || !rig.saved) {
      rig.saved = { position: [...home.position], target: [...home.target] };
    }
    copyPose(rig.from, current);
    copyPose(rig.goal, request.goal);
    rig.key = request.key;
    rig.phase = 'entering';
  } else {
    if (rig.phase === 'out' || rig.phase === 'leaving') return rig;
    copyPose(rig.from, current);
    copyPose(rig.goal, rig.saved ?? home);
    rig.key = null;
    rig.phase = 'leaving';
  }
  rig.start = now;
  rig.started = false;
  rig.duration = duration;
  return rig;
}

/** Abandonne le cadrage sans bouger la caméra (mode photo, vue intérieure : ils la prennent en main). */
export function dropZone(rig: ZoneRig): ZoneRig {
  rig.phase = 'out';
  rig.key = null;
  rig.saved = null;
  return rig;
}

/**
 * Avance une transition : la pose de la caméra à `now` (écrite dans `out`), et vrai si elle est
 * arrivée (la phase passe alors à « in », ou à « out » en rendant la vue d'avant).
 */
export function stepZone(rig: ZoneRig, now: number, out: OrbitPose): boolean {
  if (rig.phase !== 'entering' && rig.phase !== 'leaving') {
    copyPose(out, rig.phase === 'in' ? rig.goal : (rig.saved ?? rig.goal));
    return true;
  }
  if (!rig.started) {
    rig.started = true;
    rig.start = now;
  }
  const t = rig.duration <= 0 ? 1 : (now - rig.start) / rig.duration;
  blendOrbit(rig.from, rig.goal, easeOutCubic(t), out);
  if (t < 1) return false;
  copyPose(out, rig.goal);
  if (rig.phase === 'entering') rig.phase = 'in';
  else {
    rig.phase = 'out';
    rig.saved = null;
  }
  return true;
}
