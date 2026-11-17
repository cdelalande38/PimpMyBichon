// Vague R, lot « cadrans » : à la caméra embarquée à la place du conducteur, le regard ne s'écarte pas de
// l'axe du véhicule de plus de CHASE.cockpitYawMax, même dans un virage serré : la planche, donc la vitesse,
// reste dans l'image en portrait (champ horizontal d'environ ±19°).

import { afterEach, describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import type { DriveMotion, VehicleFrame } from '../../src/drive/contrat.ts';
import { cameraShot, CHASE, cockpit, createShot, DEFAULT_ORBIT } from '../../src/drive/cameras.ts';
import { createRail } from '../../src/drive/rail.ts';

/** 100 m droits vers +X, puis un virage à droite de rayon 30 m (+Z). */
const RAYON = 30;
const ROUTE: MapRoute = (() => {
  const rail: number[] = [];
  for (let i = 0; i <= 50; i += 1) rail.push(i * 2, 0, 0);
  for (let i = 1; i <= 40; i += 1) {
    const theta = (i * 2) / RAYON;
    rail.push(100 + RAYON * Math.sin(theta), 0, RAYON * (1 - Math.cos(theta)));
  }
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length: 180, step: 2, rail, sections: [{ from: 0, to: 180, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [], far: null };
})();

const frame = (kind: 'car' | 'bike'): VehicleFrame => ({ kind, position: [100, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2, halfWidth: 0.85, height: 1.4 });
const MOTION = { s: 100, offset: 0, speed: 20 } as unknown as DriveMotion;

/** Écart du regard à l'axe du véhicule (cap nul : vers +X), en radians, positif vers +Z. */
const ecart = (shot: { position: readonly number[]; target: readonly number[] }): number => Math.atan2(shot.target[2]! - shot.position[2]!, shot.target[0]! - shot.position[0]!);

describe('caméra embarquée : regard borné dans le virage', () => {
  afterEach(() => {
    cockpit.eye = null;
  });

  it('à l\'œil du conducteur, en plein virage serré : écart au plus CHASE.cockpitYawMax', () => {
    cockpit.eye = [-0.1, 1.2, -0.3];
    const shot = cameraShot('embarquee', frame('car'), MOTION, createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
    expect(Math.abs(ecart(shot))).toBeLessThanOrEqual(CHASE.cockpitYawMax + 1e-9);
    // Il regarde bien vers l'intérieur du virage (à droite), jusqu'à la borne.
    expect(ecart(shot)).toBeGreaterThan(CHASE.cockpitYawMax * 0.9);
  });

  it('en ligne droite, rien ne change : le regard reste dans l\'axe', () => {
    cockpit.eye = [-0.1, 1.2, -0.3];
    const droit = { ...MOTION, s: 10 } as DriveMotion;
    const shot = cameraShot('embarquee', { ...frame('car'), position: [10, 0, 0] }, droit, createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
    expect(Math.abs(ecart(shot))).toBeLessThan(0.02);
  });

  it('une moto (sans œil de cabine) garde son regard libre', () => {
    const shot = cameraShot('embarquee', frame('bike'), MOTION, createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
    expect(ecart(shot)).toBeGreaterThan(CHASE.cockpitYawMax);
  });
});
