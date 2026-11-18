// Roues partagées et assiette (§ 5.4) : catalogue, sections `wheels` des manifestes, résolution
// des choix d'un build (src/data/wheels.ts) et leur place dans le build (src/state/builds.ts).

import { describe, expect, it } from 'vitest';
import { VEHICLES } from '../../src/data/vehicles.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import {
  maxDropFor,
  outerRadius,
  resolveWheels,
  rimFile,
  rimsFor,
  sizeLabel,
  tireFile,
  validateCatalogue,
  WHEEL_CATALOGUE,
  WHEEL_TUNE,
  wheelFiles,
  wheelsTouched,
} from '../../src/data/wheels.ts';
import { rimFile as toolRimFile, tireFile as toolTireFile } from '../../tools/vehicles/roues.mjs';
import { sanitizeBuilds, useBuilds } from '../../src/state/builds.ts';

const byId = (id: string) => VEHICLES.find((vehicle) => vehicle.id === id) as VehicleManifest;
const substitutes = ['cox', 'van', 'bobber', 'sportive'];

describe('catalogue des roues partagées', () => {
  it('six dessins de jantes pour les voitures, trois pour les motos, quatre pneus', () => {
    const car = WHEEL_CATALOGUE.rims.filter((rim) => rim.kind === 'car').map((rim) => rim.id);
    const bike = WHEEL_CATALOGUE.rims.filter((rim) => rim.kind === 'bike').map((rim) => rim.id);
    expect(car).toEqual(expect.arrayContaining(['tole', 'huit_branches', 'flasque', 'cinq_batons', 'rayons_fils', 'deport_profond']));
    expect(bike).toEqual(expect.arrayContaining(['moto_rayons', 'moto_batons', 'moto_pleine']));
    expect(WHEEL_CATALOGUE.tires.map((tire) => tire.id)).toEqual(['route', 'flanc_blanc', 'lettrage', 'tout_terrain', 'piste']);
    for (const item of [...WHEEL_CATALOGUE.rims, ...WHEEL_CATALOGUE.tires]) {
      expect(item.label.trim()).not.toBe('');
      // Aucun nom de marque : des libellés d'atelier en français.
      expect(item.label).not.toMatch(/[A-Z]{3,}/);
    }
  });

  it('nomme ses fichiers comme la fabrication (tools/vehicles/roues.mjs)', () => {
    for (const rim of WHEEL_CATALOGUE.rims) expect(rimFile(rim.id)).toBe(toolRimFile(rim.id));
    for (const tire of WHEEL_CATALOGUE.tires) for (const kind of ['car', 'bike'] as const) expect(tireFile(tire.id, kind)).toBe(toolTireFile(tire.id, kind));
  });

  it('refuse un catalogue faux, en le disant', () => {
    expect(() => validateCatalogue({ reference: {}, rims: [], tires: [] })).toThrow(/catalogue\.json.*reference\.car/);
    expect(() => validateCatalogue({ ...WHEEL_CATALOGUE, tires: [{ id: 'x', label: 'X', mark: 'neon', color: '#fff', colorLabel: 'c' }] })).toThrow(/tires\[0\]/);
  });
});

describe('roues des manifestes', () => {
  it('les quatre substituts posent leurs roues, le concept garde les siennes et règle son assiette', () => {
    for (const id of substitutes) {
      const vehicle = byId(id);
      expect(vehicle.wheels?.fit, id).toBeDefined();
      expect(vehicle.zones.some((zone) => zone.id === vehicle.wheels!.fit!.zone)).toBe(true);
      expect(rimsFor(vehicle).length).toBeGreaterThanOrEqual(vehicle.kind === 'car' ? 6 : 3);
    }
    const concept = byId('concept');
    expect(concept.wheels?.fit).toBeUndefined();
    expect(concept.wheels?.nodes).toHaveLength(4);
    expect(resolveWheels(concept, undefined)?.swap).toBe(false);
  });

  it('voitures : jante de 15 à 20 pouces au plus ; motos : largeur du pneu arrière', () => {
    for (const id of substitutes) {
      const fit = byId(id).wheels!.fit!;
      if (byId(id).kind === 'car') {
        expect(fit.diameter[0]).toBeGreaterThanOrEqual(15);
        expect(fit.diameter[1]).toBeLessThanOrEqual(20);
        expect(fit.width).toBeDefined();
      } else {
        expect(fit.rearWidth).toBeDefined();
        expect(fit.rearWidth![0]).toBeGreaterThanOrEqual(130);
      }
    }
  });
});

describe('résolution des roues d’un build', () => {
  it('sans choix : l’origine du manifeste, caisse à sa place', () => {
    for (const id of substitutes) {
      const vehicle = byId(id);
      const fit = vehicle.wheels!.fit!;
      const r = resolveWheels(vehicle, undefined)!;
      expect(r.swap).toBe(true);
      expect(r.rim?.id).toBe(fit.rim);
      expect(r.tire?.id).toBe(fit.tire);
      expect(r.diameter).toBe(fit.front.diameter);
      expect(r.front!.outer).toBeCloseTo(outerRadius(fit.front), 6);
      expect(r.rear!.outer).toBeCloseTo(outerRadius(fit.rear ?? fit.front), 6);
      expect(r.lift.front).toBeCloseTo(0, 6);
      expect(r.lift.rear).toBeCloseTo(0, 6);
      expect(r.drop).toBe(0);
      expect(wheelFiles(vehicle, r)).toEqual({ rim: rimFile(fit.rim), tire: tireFile(fit.tire, vehicle.kind) });
    }
  });

  it('une valeur inconnue retombe sur l’origine, une valeur hors bornes sur la borne', () => {
    const cox = byId('cox');
    const build: Build = { paints: {}, parts: { jantes: 'moto_rayons', pneus: 'slick' }, tune: { [WHEEL_TUNE.diameter]: 42, [WHEEL_TUNE.width]: 10, [WHEEL_TUNE.ride]: 7 } };
    const r = resolveWheels(cox, build)!;
    expect(r.rim?.id).toBe('huit_branches'); // jante de moto refusée sur une voiture
    expect(r.tire?.id).toBe('route');
    expect(r.diameter).toBeLessThanOrEqual(cox.wheels!.fit!.diameter[1]);
    expect(r.width).toBe(cox.wheels!.fit!.width![0]);
    expect(r.ride).toBe(1);
    const nan = resolveWheels(cox, { paints: {}, tune: { [WHEEL_TUNE.diameter]: Number.NaN } })!;
    expect(nan.diameter).toBe(15);
  });

  it('le pneu ne dépasse jamais du passage de roue : la série baisse quand la jante grandit', () => {
    for (const id of substitutes) {
      const vehicle = byId(id);
      const fit = vehicle.wheels!.fit!;
      const [gapFront, gapRear] = vehicle.wheels!.gap;
      for (let d = fit.diameter[0]; d <= fit.diameter[1]; d += 1) {
        const r = resolveWheels(vehicle, { paints: {}, tune: { [WHEEL_TUNE.diameter]: d, [WHEEL_TUNE.aspect]: fit.aspect[1] } })!;
        expect(r.front!.outer - r.front!.origin, `${id} ${d}`).toBeLessThanOrEqual(gapFront);
        expect(r.rear!.outer - r.rear!.origin, `${id} ${d}`).toBeLessThanOrEqual(gapRear);
        // Plus haute que l'origine : la caisse monte d'autant (la roue reste au sol).
        expect(r.lift.front).toBeCloseTo(r.front!.outer - r.front!.origin, 6);
      }
    }
  });

  it('assiette : posée au sol descend de toute la place, jamais plus ; de grandes roues en laissent moins', () => {
    const cox = byId('cox');
    const low = resolveWheels(cox, { paints: {}, tune: { [WHEEL_TUNE.ride]: 1 } })!;
    expect(low.drop).toBeGreaterThan(0.03);
    expect(low.drop).toBe(low.maxDrop);
    expect(low.drop).toBeLessThanOrEqual(Math.min(...cox.wheels!.gap));
    expect(low.drop).toBeLessThanOrEqual(cox.wheels!.floor);
    expect(low.lift.front).toBeCloseTo(-low.drop, 6);
    const half = resolveWheels(cox, { paints: {}, tune: { [WHEEL_TUNE.ride]: 0.5 } })!;
    expect(half.drop).toBeCloseTo(low.drop / 2, 6);
    const big = resolveWheels(cox, { paints: {}, tune: { [WHEEL_TUNE.ride]: 1, [WHEEL_TUNE.diameter]: 20, [WHEEL_TUNE.aspect]: 80 } })!;
    expect(big.maxDrop).toBeLessThan(low.maxDrop);
    expect(maxDropFor({ gap: [0.02, 0.02], floor: 0.5 }, { front: 0.05, rear: 0 })).toBe(0);
    // Concept : ses roues restent, la caisse descend.
    const concept = resolveWheels(byId('concept'), { paints: {}, tune: { [WHEEL_TUNE.ride]: 1 } })!;
    expect(concept.drop).toBeGreaterThan(0);
    expect(concept.lift.rear).toBeCloseTo(-concept.drop, 6);
  });

  it('écrit les cotes comme sur un flanc : 165/65 R15, 150/81-16', () => {
    expect(sizeLabel({ diameter: 15, width: 165, aspect: 65 }, 'car')).toBe('165/65 R15');
    expect(sizeLabel({ diameter: 16, width: 150, aspect: 81 }, 'bike')).toBe('150/81-16');
  });
});

describe('les roues dans le build', () => {
  it('lit les curseurs et la couleur du pneu, écarte le reste', () => {
    const data = sanitizeBuilds({
      builds: {
        cox: { paints: {}, parts: { jantes: 'flasque' }, tune: { jante: 18, assiette: 0.5, faux: 'x', 'pas bon': 3 }, partPaints: { pneus: { color: '#FF0000', linked: true }, rien: { color: 'zz' } } },
        van: { paints: {}, tune: { jante: Number.POSITIVE_INFINITY } },
      },
    });
    expect(data.builds.cox).toEqual({ paints: {}, parts: { jantes: 'flasque' }, tune: { jante: 18, assiette: 0.5 }, partPaints: { pneus: { color: '#ff0000' } } });
    expect(data.builds.van).toBeUndefined();
  });

  it('un choix de pièce, de curseur ou de couleur garde les autres', () => {
    useBuilds.setState({ builds: {} });
    const { setPart, setTune, setPartPaint } = useBuilds.getState();
    setTune('cox', 'jante', 18);
    setPartPaint('cox', 'pneus', { color: '#00ff00' });
    setPart('cox', 'jantes', 'flasque');
    setTune('cox', 'assiette', 1);
    expect(useBuilds.getState().builds.cox).toEqual({ paints: {}, tune: { jante: 18, assiette: 1 }, partPaints: { pneus: { color: '#00ff00' } }, parts: { jantes: 'flasque' } });
    expect(wheelsTouched(useBuilds.getState().builds.cox, 'roues')).toBe(true);
    expect(wheelsTouched(useBuilds.getState().builds.cox, 'assiette')).toBe(true);
    setTune('cox', 'jante', null);
    setTune('cox', 'assiette', null);
    setPartPaint('cox', 'pneus', null);
    setPart('cox', 'jantes', null);
    expect(useBuilds.getState().builds.cox).toEqual({ paints: {} });
    expect(wheelsTouched(useBuilds.getState().builds.cox, 'roues')).toBe(false);
  });
});
