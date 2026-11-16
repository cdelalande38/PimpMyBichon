// Le conducteur à bord, hors pose : budget de chaque tenue (12 000 triangles, 4 appels de dessin),
// catalogue valide, peau liée aux os (poids qui font 1, fondu aux articulations), tenue par genre de
// véhicule, tête et buste cachés pour la caméra à son œil ; la béquille d'atelier retirée en roulant
// (pièces au sol du manifeste) et la béquille latérale repliée ; la courbure suivie et les
// mouvements bornés, sans tremblement ; budgets du § 8 tenus avec le conducteur à bord.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Box3, SkinnedMesh, Vector3 } from 'three';
import * as conducteur from '../../tools/vehicles/conducteur.mjs';
import { buildDrivers, buildInterior, buildVehicle, buildWheels, interiorWorst, VEHICLE_MAX, withWheels } from '../../tools/vehicles/build.mjs';
import { DRIVER_CATALOGUE, DRIVER_POSE, driverSpecOf, outfitFor, validateDriverCatalogue } from '../../src/data/conducteur.ts';
import { chainWeights, hideForCockpit } from '../../src/scene/vehicle/conducteur.ts';
import { skeletonOf } from '../../src/scene/vehicle/conducteur-pose.ts';
import { CurvatureFollower, follow, liftStands } from '../../src/drive/scene/roues.ts';
import { builtModel } from './places-modeles.ts';
import { driverRig, manifest, posedDriver } from './conducteur-outils.ts';

describe('le conducteur, pièce partagée', () => {
  it('chaque tenue tient son budget : 12 000 triangles et 4 appels de dessin au plus', () => {
    const drivers = buildDrivers();
    expect([...drivers.keys()].sort()).toEqual(['moto', 'voiture']);
    for (const [id, d] of drivers) {
      expect(d.budget.triangles, id).toBeLessThanOrEqual(DRIVER_CATALOGUE.budget.triangles);
      expect(d.budget.drawCalls, id).toBeLessThanOrEqual(DRIVER_CATALOGUE.budget.drawCalls);
      // Une pièce par chaîne d'os du catalogue, rien d'autre.
      expect(d.summary.nodes.slice(1).sort(), id).toEqual(Object.keys(DRIVER_CATALOGUE.nodes).sort());
    }
  });

  it('monté comme dans l’app : un maillage articulé par passe, quatre au plus, des poids qui font 1', async () => {
    for (const outfit of DRIVER_CATALOGUE.outfits) {
      const rig = await driverRig(outfit.id);
      expect(rig.meshes.length, outfit.id).toBeLessThanOrEqual(DRIVER_CATALOGUE.budget.drawCalls);
      let triangles = 0;
      for (const mesh of rig.meshes as SkinnedMesh[]) {
        triangles += mesh.geometry.getIndex()!.count / 3;
        const w = mesh.geometry.getAttribute('skinWeight');
        for (let i = 0; i < w.count; i += 97) expect(w.getX(i) + w.getY(i) + w.getZ(i) + w.getW(i)).toBeCloseTo(1, 5);
        expect(mesh.geometry.getAttribute('color')).toBeDefined();
      }
      expect(triangles).toBeLessThanOrEqual(DRIVER_CATALOGUE.budget.triangles);
      // Au repos, debout : de la semelle au haut de la tête, entre 1,70 et 1,90 m.
      const box = new Box3();
      for (const p of posedDriver(rig).points) box.expandByPoint(p);
      expect(box.max.y - box.min.y, outfit.id).toBeGreaterThan(1.7);
      expect(box.max.y - box.min.y, outfit.id).toBeLessThan(1.9);
      // Carrure : épaules plus larges que les hanches.
      expect(box.max.z - box.min.z).toBeGreaterThan(0.5);
    }
  });

  it('casquette en voiture, casque à moto ; les tatouages couvrent une bonne part des bras', () => {
    expect(outfitFor({ kind: 'car' }).head).toBe('casquette');
    expect(outfitFor({ kind: 'bike' }).head).toBe('casque');
    let ink = 0;
    let all = 0;
    for (let u = 0; u < 1; u += 0.01) for (let v = 0; v < 1; v += 0.02) {
      all += 1;
      if (conducteur.tattooInk(u, v, -1)) ink += 1;
    }
    expect(ink / all).toBeGreaterThan(0.4);
    expect(ink / all).toBeLessThan(0.8);
    // Aucune image : seules des couleurs unies, nommées, dans le catalogue.
    const raw = readFileSync(new URL('../../public/assets/shared/conducteur/catalogue.json', import.meta.url), 'utf8');
    expect(raw).not.toMatch(/\.(png|jpe?g|webp|ktx2)/i);
    expect(() => validateDriverCatalogue({ ...JSON.parse(raw), cockpitHidden: ['inconnu'] })).toThrow(/cockpitHidden/);
  });

  it('la peau suit sa chaîne d’os, avec un fondu autour du coude', () => {
    const sk = skeletonOf(DRIVER_CATALOGUE);
    const chain = DRIVER_CATALOGUE.nodes.bras_g!;
    const elbow = sk.rest[sk.index.coude_g!]!;
    const near = chainWeights(sk, chain, DRIVER_CATALOGUE.blend, elbow.clone().add(new Vector3(0, 0.01, 0)));
    expect(near).toHaveLength(2);
    expect(near[0]![1] + near[1]![1]).toBeCloseTo(1, 6);
    const far = chainWeights(sk, chain, DRIVER_CATALOGUE.blend, elbow.clone().add(new Vector3(0, 0.15, 0)));
    expect(far).toEqual([[sk.index.epaule_g, 1]]);
  });

  it('la caméra à son œil cache la tête et le buste, pas les avant-bras ni les mains', async () => {
    const rig = await driverRig('voiture');
    const sk = rig.skeleton;
    const before = posedDriver(rig);
    hideForCockpit(rig, true);
    const after = posedDriver(rig);
    const moved = (id: string) => before.points.some((p, i) => after.bones[i] === sk.index[id] && p.distanceTo(after.points[i]!) > 0.01);
    for (const id of DRIVER_CATALOGUE.cockpitHidden) expect(moved(id), id).toBe(true);
    for (const id of ['coude_g', 'main_g', 'coude_d', 'main_d']) expect(moved(id), id).toBe(false);
    hideForCockpit(rig, false);
    posedDriver(rig).points.forEach((p, i) => expect(p.distanceTo(before.points[i]!)).toBeLessThan(1e-6));
  });
});

describe('la béquille en sortie', () => {
  for (const id of ['bobber', 'sportive']) {
    it(`${id} : la béquille d'atelier (pièce au sol du manifeste) est retirée, la latérale reste repliée`, async () => {
      const vehicle = manifest(id);
      const model = await builtModel(id);
      expect(vehicle.wheels?.grounded).toEqual(['bequille']);
      const lifted = liftStands(model, vehicle.wheels?.grounded);
      expect(lifted.map((node) => node.name)).toEqual(['bequille']);
      expect(lifted.every((node) => !node.visible)).toBe(true);
      // Rien d'autre n'est retiré ; la béquille latérale, repliée le long du cadre, ne touche pas le sol.
      let hidden = 0;
      model.traverse((o) => {
        if (!o.visible) hidden += 1;
      });
      expect(hidden).toBe(1);
      const side = new Box3().setFromObject(model.getObjectByName('bequille_laterale')!, true);
      expect(side.min.y).toBeGreaterThan(vehicle.wheels!.floor);
      // Les ancres du conducteur sont dans le modèle.
      for (const name of [DRIVER_CATALOGUE.anchors.seat, ...DRIVER_CATALOGUE.anchors.grips, ...DRIVER_CATALOGUE.anchors.pegs]) expect(model.getObjectByName(name), name).toBeDefined();
    }, 60_000);
  }

  it('aucun identifiant de véhicule dans le code du conducteur ni de la béquille', () => {
    for (const file of ['../../src/scene/vehicle/conducteur.ts', '../../src/scene/vehicle/conducteur-pose.ts', '../../src/drive/scene/roues.ts', '../../src/data/conducteur.ts']) {
      const code = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/['"](cox|van|concept|bobber|sportive)['"]/);
    }
  });
});

describe('le conducteur vit, borné et sans tremblement', () => {
  it('la courbure suivie : celle d’un cercle, sans saut au départ ni au retour en arrière', () => {
    const follower = new CurvatureFollower(DRIVER_POSE.motion.smoothing);
    const R = 40;
    let value = 0;
    for (let i = 0; i < 600; i += 1) {
      const s = i * 0.5;
      value = follower.update(s, s / R, 1 / 60);
    }
    expect(value).toBeCloseTo(1 / R, 3);
    expect(follower.update(10, 0, 1 / 60)).toBeCloseTo(value, 6);
  });

  it('volant, tête et buste bornés, approchés en douceur (aucun dépassement de la cible)', () => {
    const M = DRIVER_POSE.motion;
    let steer = 0;
    let previous = 0;
    for (let i = 0; i < 300; i += 1) {
      steer = follow(steer, 5, M.steerMax, 1 / 60, M.smoothing);
      expect(steer).toBeGreaterThanOrEqual(previous);
      expect(steer).toBeLessThanOrEqual(M.steerMax);
      previous = steer;
    }
    expect(steer).toBeCloseTo(M.steerMax, 2);
    expect(follow(0, 1, M.lookMax, 0, M.smoothing)).toBe(0);
    expect(driverSpecOf({ driver: { reach: 3 } }).reach).toBe(DRIVER_POSE.bike.reach);
    expect(driverSpecOf(manifest('sportive')).reach).toBeLessThan(driverSpecOf(manifest('bobber')).reach);
  });
});

describe('budgets du § 8 avec le conducteur à bord', () => {
  it('chaque véhicule fabriqué, roues et habitacle au pire et conducteur compris, reste sous 400 000 triangles et 80 appels', async () => {
    const drivers = buildDrivers();
    const wheels = buildWheels();
    const interior = buildInterior();
    const totals: Record<string, [number, number]> = {};
    for (const id of ['bobber', 'cox', 'sportive', 'van']) {
      const { summary } = await buildVehicle(id);
      const full = withWheels(id, summary, wheels)!;
      const inside = interiorWorst(summary, interior);
      const driver = [...drivers.values()].find((d) => d.kind === manifest(id).kind)!;
      const triangles = full.triangles + inside.triangles + driver.budget.triangles;
      const calls = full.drawCalls + inside.drawCalls + driver.budget.drawCalls;
      totals[id] = [triangles, calls];
      expect(triangles, id).toBeLessThan(VEHICLE_MAX.triangles);
      expect(calls, id).toBeLessThanOrEqual(VEHICLE_MAX.drawCalls);
    }
    expect(Object.keys(totals)).toHaveLength(4);
  }, 120_000);
});
