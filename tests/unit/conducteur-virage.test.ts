// Le motard en virage (demande du 16 novembre 2026 : « moto ça penche », « roues plus direction ») :
// l'axe de direction est mesuré sur la moto (du moyeu avant au milieu des poignées, comme la scène de
// route, src/drive/scene/roues.ts) ; guidon braqué, les mains restent aux poignées qui tournent.
import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { outfitFor } from '../../src/data/conducteur.ts';
import { measureSeating, seatDriver } from '../../src/scene/vehicle/conducteur.ts';
import { STILL_MOTION, type BikeSeating } from '../../src/scene/vehicle/conducteur-pose.ts';
import { builtModel } from './places-modeles.ts';
import { driverRig, manifest } from './conducteur-outils.ts';

describe('le motard en virage', () => {
  for (const id of ['bobber', 'sportive']) {
    it(`${id} : axe de direction mesuré, mains aux poignées guidon braqué`, async () => {
      const vehicle = manifest(id);
      const model = await builtModel(id);
      const { seating } = measureSeating(model, model, vehicle);
      const bike = seating as BikeSeating;
      expect(bike.kind).toBe('bike');
      expect(bike.steering).toBeDefined();
      const dir = new Vector3(...bike.steering!.dir);
      // Chasse : l'axe monte vers les poignées en penchant vers l'arrière.
      expect(dir.y).toBeGreaterThan(0.5);
      expect(dir.x).toBeLessThan(-0.1);
      expect(Math.abs(dir.z)).toBeLessThan(1e-6);
      const handle = seatDriver(await driverRig(outfitFor(vehicle).id), bike);
      const pivot = new Vector3(...bike.steering!.at);
      for (const steer of [0.15, -0.15]) {
        handle.move({ ...STILL_MOTION, steer });
        const turn = new Quaternion().setFromAxisAngle(dir, steer);
        for (const i of [0, 1]) {
          const grip = new Vector3(...bike.grips[i]!.at).sub(pivot).applyQuaternion(turn).add(pivot);
          expect(handle.pose.grips[i]!.distanceTo(grip), `${id} braquage ${steer} main ${i}`).toBeLessThan(0.02);
        }
      }
      // Guidon droit : les mains reviennent aux poignées d'origine.
      handle.move({ ...STILL_MOTION });
      for (const i of [0, 1]) expect(handle.pose.grips[i]!.distanceTo(new Vector3(...bike.grips[i]!.at))).toBeLessThan(0.02);
    }, 60_000);
  }
});
