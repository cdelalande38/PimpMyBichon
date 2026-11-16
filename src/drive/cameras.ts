// Les six caméras de la sortie (§ 5.5) : des fonctions pures du véhicule, de son mouvement et du
// rail. Aucune mémoire d'une image à l'autre : un plan est une fonction continue de l'abscisse et de
// la pose, donc sans saut (sauf le travelling, qui change de poste comme on coupe un plan).
//
// - poursuite : derrière, sur le rail quelques mètres en arrière, à la hauteur du toit ; suit la route.
// - rasante : au ras du sol (0,35 m), le long du flanc gauche (côté axe de la chaussée), regarde vers
//   l'arrière du véhicule.
// - avant : devant, sur le rail, regarde le véhicule arriver.
// - embarquee : à la place du conducteur du manifeste (œil posé sur son siège par la scène, `cockpit`),
//   sinon au-dessus du toit (de la tête du pilote d'une moto) ; regarde la route plus loin.
// - travelling : un poste fixe sur le bas-côté, tous les TRAVELLING.spacing m, côté droit puis côté
//   gauche ; le véhicule arrive de loin, passe devant, s'éloigne, puis on coupe au poste suivant. Le
//   champ se resserre quand il est loin (téléobjectif) et s'ouvre quand il passe.
// - orbite : autour du véhicule, réglée au doigt (OrbitView), bornée au-dessus du sol.
// Au-delà des bouts d'un parcours ouvert, les points du rail se prolongent en ligne droite.
//
// Impression de vitesse (CAMERA_FEEL), bornée pour ne jamais donner le mal de mer : le champ s'ouvre
// avec la vitesse (≈ 3° à 90 km/h, davantage au-delà, plafonné) et pendant le NOS ; la poursuite
// descend avec la vitesse (le bord de route défile plus vite à l'écran), recule à l'accélération (le véhicule s'éloigne dans le cadre) et se
// rapproche au freinage, d'après l'accélération lissée du pilote (`motion.pull`, sans les à-coups des
// passages de rapport) ; un léger tremblement à haute vitesse, fonction du temps (déterministe), coupé
// si le téléphone demande moins de mouvement.

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

/** Impression de vitesse : réglages et bornes. */
export const CAMERA_FEEL = {
  /** Champ ajouté : degrés à 90 km/h (25 m/s), plafond, vitesse du plafond (m/s) ; pendant le NOS. */
  fovAt90: 3,
  fovMax: 14,
  fovFull: 70,
  fovBoost: 7,
  /** Poursuite : recul par m/s² d'accélération ressentie (m), recul et rapprochement les plus forts (m). */
  pullBack: 0.25,
  pullBackMax: 1.4,
  pullFwdMax: 0.9,
  /** Poursuite : abaissement à pleine vitesse (m, atteint à fovFull) et à l'accélération (m par m/s², plafond). */
  speedLower: 0.55,
  lower: 0.05,
  lowerMax: 0.3,
  /** Tremblement : vitesse où il commence et où il plafonne (m/s), amplitude au plafond (m). */
  shakeFrom: 22,
  shakeFull: 75,
  shakeMax: 0.03,
} as const;

/** Mouvement réduit demandé par le téléphone : pas de tremblement. Réglable par les tests. */
export const cameraFeel = {
  reducedMotion: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches,
};

/** Champ ajouté par la vitesse (m/s), en degrés : ≈ 3° à 90 km/h, plafonné. */
export function speedFov(speed: number): number {
  const F = CAMERA_FEEL;
  const v = Math.max(0, Number.isFinite(speed) ? speed : 0);
  if (v <= 25) return (F.fovAt90 * v) / 25;
  return Math.min(F.fovMax, F.fovAt90 + ((F.fovMax - F.fovAt90) * (v - 25)) / (F.fovFull - 25));
}

/** Amplitude du tremblement à cette vitesse (m), nulle en mouvement réduit. */
export function shakeAmplitude(speed: number): number {
  if (cameraFeel.reducedMotion) return 0;
  const F = CAMERA_FEEL;
  return F.shakeMax * Math.min(1, Math.max(0, (speed - F.shakeFrom) / (F.shakeFull - F.shakeFrom)));
}

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

/**
 * Œil du conducteur du véhicule de la sortie, dans son repère (avant +X, haut +Y, droite +Z, en
 * mètres, caisse posée) : la place « conducteur » de son manifeste, résolue sur le siège du modèle
 * chargé par la scène (src/drive/scene/vehicule.tsx), comme au garage. `null` : poste générique
 * au-dessus du toit (moto, véhicule sans place, modèle pas encore posé).
 */
export const cockpit: { eye: Vec3 | null } = { eye: null };

export function cameraShot(
  id: CameraId,
  frame: VehicleFrame,
  motion: DriveMotion,
  rail: Rail,
  time: number,
  orbit: OrbitView,
  out: CameraShot,
): CameraShot {
  const [px, py, pz] = frame.position;
  const fx = Math.cos(frame.heading);
  const fz = -Math.sin(frame.heading);
  // Gauche du véhicule : (−sin h, 0, −cos h).
  const lx = fz;
  const lz = -fx;
  const size = Math.max(frame.halfLength, frame.halfWidth * 2);
  const F = CAMERA_FEEL;
  const boost = Math.min(1, Math.max(0, motion.boost ?? 0));
  const extraFov = speedFov(motion.speed) + F.fovBoost * boost;
  const pull = Number.isFinite(motion.pull) ? (motion.pull as number) : 0;
  // Tremblement : trois sinus de périodes premières entre elles, en mètres.
  const shake = shakeAmplitude(motion.speed);
  const shakeY = shake * (0.6 * Math.sin(time * 31.3) + 0.4 * Math.sin(time * 17.9));
  const shakeX = shake * 0.5 * Math.sin(time * 23.7);

  switch (id) {
    case 'poursuite': {
      // Recul à l'accélération, rapprochement au freinage ; plus bas avec la vitesse et la poussée.
      const swing = Math.max(-F.pullFwdMax, Math.min(F.pullBackMax, pull * F.pullBack));
      const back = frame.halfLength * 2 + 4 + swing;
      const lower = F.speedLower * Math.min(1, motion.speed / F.fovFull) + Math.min(F.lowerMax, Math.max(0, pull) * F.lower);
      extendedPose(rail, motion.s - back, scratch);
      lateralPoint(scratch, motion.offset, frame.height + 1.1 - lower + shakeY, out.position);
      out.position[0] += lx * shakeX;
      out.position[2] += lz * shakeX;
      set(out.target, px + fx * frame.halfLength * 0.6, py + frame.height * 0.75, pz + fz * frame.halfLength * 0.6);
      out.fov = 50 + extraFov;
      return out;
    }
    case 'rasante': {
      const side = frame.halfWidth + 0.45;
      const fore = frame.halfLength * 0.95;
      set(out.position, px + fx * fore + lx * side, py + 0.35 + shakeY * 0.6, pz + fz * fore + lz * side);
      set(out.target, px - fx * frame.halfLength * 1.2 + lx * frame.halfWidth * 0.2, py + frame.height * 0.35, pz - fz * frame.halfLength * 1.2 + lz * frame.halfWidth * 0.2);
      // Au ras du sol, le champ ne s'ouvre qu'au NOS : ouvert avec la vitesse, il ralentirait le défilement.
      out.fov = 62 + F.fovBoost * boost * 0.8;
      return out;
    }
    case 'avant': {
      const lead = frame.halfLength * 2 + 4.5;
      extendedPose(rail, motion.s + lead, scratch);
      lateralPoint(scratch, motion.offset, Math.max(1.1, frame.height * 0.9), out.position);
      set(out.target, px, py + frame.height * 0.5, pz);
      out.fov = 46 + extraFov * 0.5;
      return out;
    }
    case 'embarquee': {
      const bike = frame.kind === 'bike';
      const eye = bike ? null : cockpit.eye;
      if (eye) {
        // À la place du conducteur : l'œil suit la caisse en pente et en plongée (rotation autour du
        // côté, comme le groupe du véhicule), à droite du véhicule pour un +Z positif.
        const c = Math.cos(frame.pitch);
        const s = Math.sin(frame.pitch);
        const ahead = eye[0] * c - eye[1] * s;
        const up = eye[0] * s + eye[1] * c;
        set(out.position, px + fx * ahead - lx * eye[2], py + up, pz + fz * ahead - lz * eye[2]);
      } else {
        const back = bike ? frame.halfLength * 0.9 : frame.halfLength * 0.15;
        set(out.position, px - fx * back, py + frame.height + (bike ? 0.3 : 0.32), pz - fz * back);
      }
      // Point visé gardé loin et au-dessus de la chaussée : la garde de la ligne de visée (guardShot)
      // relèverait la caméra hors de l'habitacle pour un point visé au ras de la route.
      extendedPose(rail, motion.s + 28, scratch);
      lateralPoint(scratch, motion.offset, frame.height * 0.6, point);
      set(out.target, point[0], point[1], point[2]);
      // Dans l'habitacle, un champ plus ouvert : le volant, la planche et la route.
      out.position[1] += shakeY * 0.5;
      out.fov = (eye ? 74 : 66) + extraFov * 0.6;
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

/**
 * Sonde du terrain : hauteur du sol (chaussée, terrain, eau, ouvrages) et du bâti (toits) au point
 * (x, z), NaN là où rien n'est connu. Le sol est celui de qui se trouve à la hauteur `y` (sous un pont,
 * la route du dessous). Fournie par la scène (src/drive/scene/relief.ts).
 */
export interface GroundSampler {
  ground(x: number, z: number, y?: number): number;
  built(x: number, z: number): number;
}

/** Garde au sol des caméras : marges et limites, en mètres. */
export const CAMERA_GUARD = {
  /** Hauteur minimale de la caméra au-dessus du sol. */
  clearance: 0.28,
  /** Marge de la ligne de visée au-dessus du sol (talus entre la caméra et le véhicule). */
  sight: 0.2,
  /** Relevé maximal de la caméra pour voir par-dessus un talus ; au-delà, elle se rapproche. */
  lift: 3,
  /** Points sondés sur la ligne de visée. */
  steps: 12,
  /** Distance minimale au point visé quand la caméra se rapproche. */
  minDistance: 1.5,
} as const;

/** Relevé nécessaire au point (x, y, z) pour passer `margin` au-dessus du sol (et des toits si `built`). */
function blockedAt(sampler: GroundSampler, x: number, y: number, z: number, margin: number, built: boolean): number {
  const g = sampler.ground(x, z, y);
  let need = g === g ? g + margin - y : -Infinity;
  if (built) {
    const b = sampler.built(x, z);
    if (b === b && b + margin - y > need) need = b + margin - y;
  }
  return need;
}

/**
 * Garde au sol d'un plan : aucune caméra sous le terrain, dans un bâtiment ni derrière un talus qui
 * cache le véhicule. Dans l'ordre : la caméra se relève au-dessus du sol au point où elle est ; si
 * le sol ou un toit coupe la ligne de visée, elle se relève (de `CAMERA_GUARD.lift` au plus) ; si
 * cela ne suffit pas, elle avance vers le point visé jusqu'au dernier point libre (recul limité), puis
 * se relève de nouveau au-dessus du sol. Une sonde muette (NaN partout) laisse le plan tel quel.
 * Fonction pure, sans allocation : modifie `shot` et le rend.
 */
export function guardShot(shot: CameraShot, sampler: GroundSampler): CameraShot {
  const p = shot.position;
  const t = shot.target;
  const G = CAMERA_GUARD;
  // 1. Au-dessus du sol au point de la caméra (une caméra dans un bâtiment est traitée en 2 et 3).
  let need = blockedAt(sampler, p[0], p[1], p[2], G.clearance, false);
  if (need > 0) p[1] += need;
  // 2. Ligne de visée : relevé nécessaire pour passer chaque point sondé.
  let lift = 0;
  let first = 0;
  for (let i = G.steps; i >= 1; i -= 1) {
    const k = i / G.steps;
    const y = t[1] + (p[1] - t[1]) * k;
    const n = blockedAt(sampler, t[0] + (p[0] - t[0]) * k, y, t[2] + (p[2] - t[2]) * k, G.sight, true);
    if (n > 0) {
      lift = Math.max(lift, n / k);
      first = i;
    }
  }
  if (lift <= 0) return shot;
  if (lift <= G.lift) {
    p[1] += lift;
    return shot;
  }
  // 3. Trop haut : la caméra se rapproche du point visé, juste avant le premier obstacle.
  const dx = p[0] - t[0];
  const dy = p[1] - t[1];
  const dz = p[2] - t[2];
  const length = Math.hypot(dx, dy, dz);
  const keep = Math.max((first - 1) / G.steps, Math.min(1, G.minDistance / Math.max(1e-6, length)));
  p[0] = t[0] + dx * keep;
  p[1] = t[1] + dy * keep;
  p[2] = t[2] + dz * keep;
  // Encore dans un bâtiment (toit débordant sur la chaussée dans les données) : au-dessus du toit.
  need = blockedAt(sampler, p[0], p[1], p[2], G.clearance, true);
  if (need > 0) p[1] += need;
  return shot;
}

/** Plan neuf, à allouer une fois. */
export function createShot(): CameraShot {
  return { position: [0, 0, 0], target: [0, 0, 0], fov: 50 };
}
