// Les six caméras de la sortie (§ 5.5) : des fonctions pures du véhicule, de son mouvement et du
// rail. Aucune mémoire d'une image à l'autre : un plan est une fonction continue de l'abscisse et de
// la pose, donc sans saut (sauf le travelling, qui change de poste comme on coupe un plan).
//
// - poursuite : derrière, sur le rail quelques mètres en arrière, à la hauteur du toit ; suit la route.
// - rasante : au ras du sol (0,35 m), le long du flanc gauche (côté axe de la chaussée), regarde vers
//   l'arrière du véhicule.
// - avant : devant, sur le rail, regarde le véhicule arriver.
// - embarquee : au-dessus du toit (de la tête du pilote d'une moto), regarde la route plus loin.
// - travelling : un poste fixe sur le bas-côté, tous les TRAVELLING.spacing m, côté droit puis côté
//   gauche ; le véhicule arrive de loin, passe devant, s'éloigne, puis on coupe au poste suivant. Le
//   champ se resserre quand il est loin (téléobjectif) et s'ouvre quand il passe.
// - orbite : autour du véhicule, réglée au doigt (OrbitView), bornée au-dessus du sol.
// Au-delà des bouts d'un parcours ouvert, les points du rail se prolongent en ligne droite.

import type { CameraId, CameraShot, DriveMotion, OrbitView, Rail, RailPose, Vec3, VehicleFrame } from './contrat.ts';
import { createPose, lateralPoint } from './rail.ts';

export const TRAVELLING = {
  /** Écart entre deux postes, en mètres le long du rail. */
  spacing: 90,
  /** Distance parcourue après le poste avant de couper au suivant, en mètres. */
  passBy: 24,
  /** Écart au bord de la chaussée (sur le bas-côté), et hauteur, en mètres. */
  shoulder: 1.4,
  height: 1.1,
  /** Champ : bornes, en degrés ; taille à cadrer autour du véhicule, en mètres. */
  fovMin: 14,
  fovMax: 58,
  frame: 7,
} as const;

/** Bornes de l'orbite au doigt. */
export const ORBIT_LIMITS = { pitchMin: 0.06, pitchMax: 1.25, distanceMin: 3, distanceMax: 18 } as const;

export const DEFAULT_ORBIT: Readonly<OrbitView> = Object.freeze({ yaw: 0.6, pitch: 0.28, distance: 7.5 });

const orbitYaw = (yaw: number) => (Number.isFinite(yaw) ? yaw - 2 * Math.PI * Math.round(yaw / (2 * Math.PI)) : DEFAULT_ORBIT.yaw);
const orbitPitch = (pitch: number) =>
  Number.isFinite(pitch) ? Math.min(ORBIT_LIMITS.pitchMax, Math.max(ORBIT_LIMITS.pitchMin, pitch)) : DEFAULT_ORBIT.pitch;
const orbitDistance = (distance: number) =>
  Number.isFinite(distance) ? Math.min(ORBIT_LIMITS.distanceMax, Math.max(ORBIT_LIMITS.distanceMin, distance)) : DEFAULT_ORBIT.distance;

/** Orbite ramenée dans ses bornes (le lacet est ramené sur ]−π, π]). */
export function clampOrbit(view: OrbitView): OrbitView {
  return { yaw: orbitYaw(view.yaw), pitch: orbitPitch(view.pitch), distance: orbitDistance(view.distance) };
}

// Mémoire de travail, allouée une fois.
const scratch: RailPose = createPose();
const station: RailPose = createPose();
const point: Vec3 = [0, 0, 0];

/** Pose du rail à `s`, prolongée en ligne droite au-delà des bouts d'un parcours ouvert. */
function extendedPose(rail: Rail, s: number, out: RailPose): RailPose {
  rail.poseAt(s, out);
  if (!rail.loop) {
    const beyond = s < 0 ? s : s > rail.length ? s - rail.length : 0;
    if (beyond !== 0) {
      out.position[0] += out.tangent[0] * beyond;
      out.position[1] += out.tangent[1] * beyond;
      out.position[2] += out.tangent[2] * beyond;
    }
  }
  return out;
}

function set(out: Vec3, x: number, y: number, z: number): void {
  out[0] = x;
  out[1] = y;
  out[2] = z;
}

/** Rang du poste de travelling qui filme un véhicule à l'abscisse `s`. */
export function travellingIndex(s: number): number {
  return Math.floor((s + TRAVELLING.spacing - TRAVELLING.passBy) / TRAVELLING.spacing);
}

/** Abscisse du poste de travelling de rang `index` (rebouclée, ou bornée au parcours). */
export function travellingAt(rail: Rail, index: number): number {
  const at = index * TRAVELLING.spacing;
  if (rail.loop) return ((at % rail.length) + rail.length) % rail.length;
  return Math.min(rail.length, Math.max(0, at));
}

export function cameraShot(
  id: CameraId,
  frame: VehicleFrame,
  motion: DriveMotion,
  rail: Rail,
  time: number,
  orbit: OrbitView,
  out: CameraShot,
): CameraShot {
  void time;
  const [px, py, pz] = frame.position;
  const fx = Math.cos(frame.heading);
  const fz = -Math.sin(frame.heading);
  // Gauche du véhicule : (−sin h, 0, −cos h).
  const lx = fz;
  const lz = -fx;
  const size = Math.max(frame.halfLength, frame.halfWidth * 2);
  const speedFactor = Math.min(1, motion.speed / 30);

  switch (id) {
    case 'poursuite': {
      const back = frame.halfLength * 2 + 4;
      extendedPose(rail, motion.s - back, scratch);
      lateralPoint(scratch, motion.offset, frame.height + 1.1, out.position);
      set(out.target, px + fx * frame.halfLength * 0.6, py + frame.height * 0.75, pz + fz * frame.halfLength * 0.6);
      out.fov = 50 + 6 * speedFactor;
      return out;
    }
    case 'rasante': {
      const side = frame.halfWidth + 0.45;
      const fore = frame.halfLength * 0.95;
      set(out.position, px + fx * fore + lx * side, py + 0.35, pz + fz * fore + lz * side);
      set(out.target, px - fx * frame.halfLength * 1.2 + lx * frame.halfWidth * 0.2, py + frame.height * 0.35, pz - fz * frame.halfLength * 1.2 + lz * frame.halfWidth * 0.2);
      out.fov = 62;
      return out;
    }
    case 'avant': {
      const lead = frame.halfLength * 2 + 4.5;
      extendedPose(rail, motion.s + lead, scratch);
      lateralPoint(scratch, motion.offset, Math.max(1.1, frame.height * 0.9), out.position);
      set(out.target, px, py + frame.height * 0.5, pz);
      out.fov = 46;
      return out;
    }
    case 'embarquee': {
      const bike = frame.kind === 'bike';
      const back = bike ? frame.halfLength * 0.9 : frame.halfLength * 0.15;
      set(out.position, px - fx * back, py + frame.height + (bike ? 0.3 : 0.32), pz - fz * back);
      extendedPose(rail, motion.s + 28, scratch);
      lateralPoint(scratch, motion.offset, frame.height * 0.6, point);
      set(out.target, point[0], point[1], point[2]);
      out.fov = 66 + 4 * speedFactor;
      return out;
    }
    case 'travelling': {
      const index = travellingIndex(motion.s);
      extendedPose(rail, travellingAt(rail, index), station);
      // Côté droit pour les postes pairs, gauche pour les impairs ; dans un tunnel, contre la paroi.
      const right = index % 2 === 0;
      const edge = station.ground === 'tunnel' ? station.width / 2 - 0.4 : station.width / 2 + TRAVELLING.shoulder;
      lateralPoint(station, right ? -edge : edge, TRAVELLING.height, out.position);
      set(out.target, px, py + frame.height * 0.45, pz);
      const distance = Math.hypot(out.position[0] - px, out.position[1] - py, out.position[2] - pz);
      const fov = (2 * Math.atan(TRAVELLING.frame / 2 / Math.max(0.1, distance)) * 180) / Math.PI;
      out.fov = Math.min(TRAVELLING.fovMax, Math.max(TRAVELLING.fovMin, fov));
      return out;
    }
    case 'orbite': {
      // Bornes appliquées sans créer d'objet (appelé à chaque image).
      const yaw = orbitYaw(orbit.yaw);
      const pitch = orbitPitch(orbit.pitch);
      const distance = Math.max(orbitDistance(orbit.distance), size + 1.5);
      const flat = Math.cos(pitch) * distance;
      // Lacet 0 : derrière le véhicule ; positif : on tourne vers sa gauche.
      const bx = -Math.cos(yaw) * flat;
      const bz = Math.sin(yaw) * flat;
      const cy = py + frame.height * 0.5;
      set(out.position, px + fx * bx + lx * bz, Math.max(py + 0.3, cy + Math.sin(pitch) * distance), pz + fz * bx + lz * bz);
      set(out.target, px, cy, pz);
      out.fov = 45;
      return out;
    }
  }
}

/** Plan neuf, à allouer une fois. */
export function createShot(): CameraShot {
  return { position: [0, 0, 0], target: [0, 0, 0], fov: 50 };
}
