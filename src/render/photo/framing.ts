// Pose de la caméra pour un cadrage prédéfini. Module pur, sans dépendance à la scène :
// les mesures du garage (champ et distance de cadrage, cible, demi-longueur) sont passées en entrée.

import type { Framing } from '../../data/framings.ts';

export interface FramingBase {
  /** Champ vertical de cadrage, en degrés (fitCamera.fov). */
  fov: number;
  /** Distance de cadrage, en mètres (fitCamera.distance). */
  distance: number;
  /** Cible par défaut de la caméra. */
  target: readonly [number, number, number];
  /** Demi-longueur du véhicule, en mètres. */
  halfLength: number;
}

export interface FramingPose {
  position: [number, number, number];
  target: [number, number, number];
  fov: number;
  distance: number;
  /** Rayon du disque d'ouverture, en mètres. */
  aperture: number;
}

/** Champ vertical maximal, en degrés : au-delà, la perspective déforme trop. */
const FOV_MAX = 80;

export function framingPose(framing: Framing, base: FramingBase): FramingPose {
  const target: [number, number, number] = [
    base.target[0] + framing.targetAlong * base.halfLength,
    base.target[1] * framing.targetHeight,
    base.target[2],
  ];
  const distance = base.distance * framing.distance;
  const sinPolar = Math.sin(framing.polar);
  return {
    position: [
      target[0] + Math.sin(framing.azimuth) * sinPolar * distance,
      target[1] + Math.cos(framing.polar) * distance,
      target[2] + Math.cos(framing.azimuth) * sinPolar * distance,
    ],
    target,
    fov: Math.min(FOV_MAX, base.fov * framing.fovScale),
    distance,
    aperture: framing.aperture,
  };
}
