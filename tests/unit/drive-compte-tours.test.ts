// Compte-tours et boîte (src/drive/boite.ts, src/drive/pilote.ts) : zones du cadran dans l'ordre, montée
// en régime et passages de rapport à plein gaz, aiguille qui retombe au passage, poussée coupée pendant
// le passage, une seule vérité (le régime que le pilote publie est celui de la boîte).
import { describe, expect, it } from 'vitest';
import { BOITE_PAR_DEFAUT, BOITES, BOITES_NOMMEES, vitesseMaxBoite } from '../../src/data/boites.ts';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { VEHICLES } from '../../src/data/vehicles.ts';
import { regimeRoues, zoneDe, zonesCadran } from '../../src/drive/boite.ts';
import { createPilot, performanceDe } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';

function straight(length: number): MapRoute {
  const n = Math.round(length / 2) + 1;
  const rail: number[] = [];
  for (let i = 0; i < n; i += 1) rail.push(i * 2, 0, 0);
  return {
    format: 'pmb-carte',
    version: 1,
    id: 'essai',
    loop: false,
    length: (n - 1) * 2,
    step: 2,
    rail,
    sections: [{ from: 0, to: (n - 1) * 2, ground: 'sol', urban: false, lanes: 2, width: 9 }],
    chunks: [],
    starts: [],
    far: null,
  } as unknown as MapRoute;
}

const FULL = { auto: false, throttle: 1, brake: 0, lane: 0 as const };

describe('zones du cadran', () => {
  for (const [id, boite] of [...Object.entries(BOITES), ...Object.entries(BOITES_NOMMEES), ['défaut', BOITE_PAR_DEFAUT] as const]) {
    it(`${id} : vert, orange, rouge dans l'ordre ; le passage à plein gaz tombe dans l'orange ; ralenti et souplesse plausibles`, () => {
      const z = zonesCadran(boite);
      expect(z.vert).toBeLessThan(z.orange);
      expect(z.orange).toBeLessThan(boite.passagePleinGaz);
      expect(boite.passagePleinGaz).toBeLessThan(z.rouge);
      expect(z.rouge).toBeLessThan(boite.rupteur);
      expect(boite.rupteur).toBeLessThanOrEqual(z.max);
      expect(boite.ralenti).toBeLessThan(boite.retrograde);
      expect(boite.souplesse).toBeGreaterThan(0);
      expect(boite.souplesse).toBeLessThan(1);
      expect(zoneDe(boite.ralenti, z)).toBe('bas');
      expect(zoneDe((z.vert + z.orange) / 2, z)).toBe('vert');
      expect(zoneDe(boite.passagePleinGaz, z)).toBe('orange');
      expect(zoneDe(boite.rupteur, z)).toBe('rouge');
    });
  }
});

describe('montée en régime et passages, à la main, plein gaz', () => {
  for (const vehicle of VEHICLES) {
    it(`${vehicle.id} : le régime monte, la boîte passe au bout de l'orange, l'aiguille retombe, la poussée est coupée`, () => {
      const perf = performanceDe(vehicle);
      const pilot = createPilot(createRail(straight(8000)), perf);
      const box = perf.gearbox;
      let shifts = 0;
      let previousGear = 1;
      let previousRpm = pilot.train.rpm;
      let rpmBefore = 0;
      let accelBefore = 0;
      let minAccelInShift = Infinity;
      for (let i = 0; i < 60 * 25 && pilot.train.gear < pilot.train.gears; i += 1) {
        pilot.step(1 / 60, FULL, vehicle.kind);
        const t = pilot.train;
        if (t.shifting) minAccelInShift = Math.min(minAccelInShift, pilot.motion.accel);
        if (t.gear !== previousGear) {
          shifts += 1;
          rpmBefore = previousRpm;
          // Au passage, on était au régime de passage à plein gaz (au bout de l'orange).
          expect(rpmBefore, `${vehicle.id} rapport ${previousGear}`).toBeGreaterThan(box.passagePleinGaz * 0.9);
          expect(zoneDe(rpmBefore, t.zones)).toBe('orange');
          previousGear = t.gear;
        } else if (!t.shifting) accelBefore = pilot.motion.accel;
        previousRpm = t.rpm;
        // Une seule vérité : le régime publié suit la vitesse sur le rapport engagé, hors passage et hors départ.
        if (!t.shifting && pilot.motion.speed * 3.6 > 30) {
          const wheels = regimeRoues(pilot.motion.speed * 3.6, box, t.gear);
          expect(Math.abs(t.rpm - Math.min(box.rupteur, wheels)), vehicle.id).toBeLessThan(400);
        }
      }
      expect(shifts).toBe(pilot.train.gears - 1);
      // L'aiguille retombe : après le dernier passage, le régime est bien sous le régime de passage.
      for (let i = 0; i < 30; i += 1) pilot.step(1 / 60, FULL, vehicle.kind);
      expect(pilot.train.rpm).toBeLessThan(rpmBefore * 0.95);
      // La poussée se sent coupée pendant un passage.
      expect(minAccelInShift).toBeLessThan(accelBefore);
    });
  }

  it('la vitesse de pointe de chaque boîte laisse la place au NOS', () => {
    for (const vehicle of VEHICLES) {
      const perf = performanceDe(vehicle);
      expect(vitesseMaxBoite(perf.gearbox), vehicle.id).toBeGreaterThanOrEqual((vehicle.performance?.topKmh ?? 0) * 1.1 - 0.5);
      expect(perf.topKmh, vehicle.id).toBe(vehicle.performance?.topKmh);
    }
  });
});
