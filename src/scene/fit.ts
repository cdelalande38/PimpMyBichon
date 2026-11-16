// Cadrage de la caméra d'orbite selon la forme de l'écran. Module pur (testable).

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

/** Projette les huit coins de la boîte du véhicule (posé de `turn` dans la pièce) à l'écran. */
export function projectBox(size: BoxSize, turn: number, camera: LookCamera): ScreenFrame {
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
  for (const x of [-size.halfLength, size.halfLength]) {
    for (const z of [-size.halfWidth, size.halfWidth]) {
      for (const y of [0, size.height]) {
        const [px, py, pz] = vehicleToRoom([x, y, z], turn);
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
    }
  }
  return frame;
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
  /** Partie libre de l'écran (sous la marque, au-dessus du dock compact), en pixels CSS. */
  band: { top: number; bottom: number };
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
export function fitVehicle({ width, height, size, turn, azimuth, band }: VehicleFrameInput): VehicleFit {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const fov = fitCamera(w, h, size.halfLength).fov;
  const bandTop = Math.min(Math.max(band.top, 0), h - 1);
  const bandBottom = Math.min(Math.max(band.bottom, bandTop + 1), h);
  const bandHeight = bandBottom - bandTop;
  const bandCenter = (bandTop + bandBottom) / 2;
  let targetY = size.height / 2;
  let distance = 6;
  const frameAt = (d: number, y: number): ScreenFrame => {
    const target: Vec3 = [0, y, 0];
    return projectBox(size, turn, { eye: orbitPosition(target, d, azimuth), target, fov, width: w, height: h });
  };
  // Deux passes suffisent : la hauteur de cible change à peine la largeur à l'écran.
  for (let pass = 0; pass < 3; pass += 1) {
    const y = targetY;
    const byWidth = bisect(0.5, 60, (d) => {
      const f = frameAt(d, y);
      return f.right - f.left > FRAME_SHARE * w;
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
