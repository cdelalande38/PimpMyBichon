// Sortie de nuit : la caméra embarquée se pose à la place du conducteur du manifeste (œil posé sur
// son siège par la scène, src/drive/scene/vehicule.tsx), au lieu d'un poste générique au-dessus du toit.

import { afterEach, describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import type { DriveMotion, VehicleFrame } from '../../src/drive/contrat.ts';
import { cameraShot, cockpit, createShot, DEFAULT_ORBIT } from '../../src/drive/cameras.ts';
import { createRail } from '../../src/drive/rail.ts';

/** Route droite et plate de 200 m vers +X. */
const ROUTE: MapRoute = (() => {
  const rail: number[] = [];
  for (let i = 0; i <= 100; i += 1) rail.push(i * 2, 0, 0);
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length: 200, step: 2, rail, sections: [{ from: 0, to: 200, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [], far: null };
})();

const frame = (kind: 'car' | 'bike', pitch = 0): VehicleFrame => ({ kind, position: [50, 0, 0], heading: 0, pitch, roll: 0, halfLength: 2, halfWidth: 0.85, height: 1.4 });
const MOTION = { s: 50, offset: 0, speed: 0 } as unknown as DriveMotion;

describe('caméra embarquée à la place du conducteur', () => {
  afterEach(() => {
    cockpit.eye = null;
  });

  it('sans place connue : au-dessus du toit, comme avant', () => {
    const shot = cameraShot('embarquee', frame('car'), MOTION, createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
    expect(shot.position[1]).toBeCloseTo(1.4 + 0.32, 9);
  });

  it('à l’œil du conducteur : à gauche (−Z du véhicule), à hauteur de tête, regard vers la route devant', () => {
    cockpit.eye = [-0.12, 1.22, -0.3];
    const shot = cameraShot('embarquee', frame('car'), MOTION, createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
    expect(shot.position[0]).toBeCloseTo(50 - 0.12, 9);
    expect(shot.position[1]).toBeCloseTo(1.22, 9);
    expect(shot.position[2]).toBeCloseTo(-0.3, 9);
    expect(shot.position[1]).toBeLessThan(1.4); // sous le toit
    expect(shot.target[0]).toBeGreaterThan(shot.position[0] + 10);
    // Point visé au-dessus de la chaussée (garde de la ligne de visée), un peu sous l'œil.
    expect(shot.target[1]).toBeGreaterThan(0.3);
    expect(shot.target[1]).toBeLessThan(shot.position[1]);
    expect(shot.fov).toBeLessThan(80);
  });

  it('suit la caisse en pente comme le groupe du véhicule ; une moto garde son poste', () => {
    cockpit.eye = [0, 1.2, -0.3];
    const up = cameraShot('embarquee', frame('car', 0.1), MOTION, createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
    // Rotation autour du côté (+Z), comme rig.group.rotation.z : l'œil au-dessus du centre recule en montée.
    expect(up.position[0]).toBeCloseTo(50 - 1.2 * Math.sin(0.1), 9);
    expect(up.position[1]).toBeCloseTo(1.2 * Math.cos(0.1), 9);
    const bike = cameraShot('embarquee', frame('bike'), MOTION, createRail(ROUTE), 0, DEFAULT_ORBIT, createShot());
    expect(bike.position[1]).toBeCloseTo(1.4 + 0.3, 9);
  });
});
