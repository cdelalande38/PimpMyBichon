// Le conducteur à bord de chaque véhicule du catalogue (demande du 16 novembre 2026 : « il manque un
// pilote au volant », « les motos il faut bien retirer la béquille pendant les sorties ») : posé
// comme dans l'app sur le modèle fabriqué (sièges et volant du catalogue sur leurs ancres) ou le vrai
// modèle, il est assis (bassin à moins de 3 cm de l'assise), tient le volant ou les poignées (prise à
// moins de 2 cm), a les pieds posés, et aucune partie de son corps ne traverse le véhicule (pavillon,
// volant, réservoir, carrosserie : marge mesurée). Les mains suivent le volant qui tourne.

import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { Quaternion, Raycaster, Vector3, type Group, type Object3D } from 'three';
import { DRIVER_CATALOGUE, DRIVER_POSE, outfitFor } from '../../src/data/conducteur.ts';
import { INTERIOR_CATALOGUE, resolveInterior } from '../../src/data/habitacle.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { measureSeating, seatDriver, type DriverHandle } from '../../src/scene/vehicle/conducteur.ts';
import { rimPoint, type BikeSeating, type CarSeating } from '../../src/scene/vehicle/conducteur-pose.ts';
import { builtModel, clearance, poseSeats, storedModel } from './places-modeles.ts';
import { crossings, driverRig, manifest, posedDriver, poseSteering } from './conducteur-outils.ts';

const SEATS = INTERIOR_CATALOGUE.seats.map((seat) => seat.id);
const report: Record<string, unknown> = {};
afterAll(() => {
  if (process.env.PMB_CONDUCTEUR_RAPPORT) writeFileSync(process.env.PMB_CONDUCTEUR_RAPPORT, JSON.stringify(report, null, 1));
});

const seatAnchors = new Set<string>(INTERIOR_CATALOGUE.anchors.seats);
/** Sièges posés : le corps s'y enfonce un peu, ils ne comptent pas dans les traversées. */
const isSeat = (object: Object3D) => {
  for (let node: Object3D | null = object; node; node = node.parent) if (node.name === 'habitacle_pose' && node.parent && seatAnchors.has(node.parent.name)) return true;
  return false;
};

const bone = (id: string) => DRIVER_CATALOGUE.bones.findIndex((b) => b.id === id);
const HANDS = new Set([bone('main_g'), bone('main_d')]);
const FEET = new Set([bone('pied_g'), bone('pied_d')]);
const round = (v: number) => Math.round(v * 1000) / 1000;

async function seated(model: Group, vehicle: VehicleManifest): Promise<DriverHandle> {
  const { seating, pending } = measureSeating(model, model, vehicle);
  expect(pending, vehicle.id).toBe(false);
  expect(seating, vehicle.id).not.toBeNull();
  const rig = await driverRig(outfitFor(vehicle).id);
  return seatDriver(rig, seating!);
}

/** Point d'appui des fesses posé (repère du véhicule). */
function seatContact(handle: DriverHandle): Vector3 {
  const i = bone('bassin');
  return new Vector3(...DRIVER_CATALOGUE.contacts.seat).applyQuaternion(handle.pose.world[i] as Quaternion).add(handle.pose.joints[i] as Vector3);
}

/** Hauteur de la surface sous un point (pièces retenues par `keep`), au rayon vers le bas. */
function surfaceBelow(model: Object3D, p: Vector3, keep: (object: Object3D) => boolean): number | null {
  const hit = new Raycaster(new Vector3(p.x, p.y + 0.25, p.z), new Vector3(0, -1, 0)).intersectObject(model, true).find((h) => keep(h.object));
  return hit ? p.y + 0.25 - hit.distance : null;
}

describe('le conducteur en voiture', () => {
  for (const id of ['cox', 'van']) {
    const vehicle = manifest(id);
    const steering = resolveInterior(vehicle, { paints: {} })?.steering?.id ?? 'sport';
    for (const seat of SEATS) {
      it(`${id}, siège ${seat} : assis, mains sur la jante, pieds posés, rien ne traverse`, async () => {
        const model = await builtModel(id);
        poseSeats(model, INTERIOR_CATALOGUE.anchors.seats, seat, vehicle.interior?.seats?.scale ?? 1);
        poseSteering(model, steering);
        const handle = await seated(model, vehicle);
        const seating = handle.seating as CarSeating;
        const driver = posedDriver(handle.rig);
        // Assis : l'appui des fesses à moins de 3 cm de l'assise mesurée sous lui.
        const contact = seatContact(handle);
        const cushion = surfaceBelow(model, contact, (o) => isSeat(o));
        const lowest = Math.min(...driver.points.filter((p, i) => driver.bones[i] === bone('bassin') && Math.abs(p.z - contact.z) < 0.06 && Math.abs(p.x - contact.x) < 0.06).map((p) => p.y));
        // Mains : la prise sur l'axe de la jante.
        const rim = (angle: number) => rimPoint(seating.wheel, angle).at;
        const hands = handle.pose.grips.map((g, i) => g.distanceTo(rim(i === 0 ? seating.hands : -seating.hands)));
        // Pieds : talons sur le plancher, pointes avant le tablier.
        const heels = handle.pose.ankles.map((_, i) => {
          const j = bone(i === 0 ? 'pied_g' : 'pied_d');
          return new Vector3(...DRIVER_CATALOGUE.contacts.heel).applyQuaternion(handle.pose.world[j] as Quaternion).add(handle.pose.joints[j] as Vector3).y - seating.floor;
        });
        const cross = crossings(driver, model, isSeat, (_p, b) => HANDS.has(b));
        report[`${id} ${seat}`] = { cushion: cushion === null ? null : round(contact.y - cushion), lowest: round(lowest - contact.y), hands: hands.map(round), heels: heels.map(round), torso: round(handle.pose.torso), shift: seating.plan?.shift, knees: [bone('genou_g'), bone('pied_g'), bone('bassin'), bone('epaule_g')].map((j) => handle.pose.joints[j]!.toArray().map(round)), hits: cross.hits.length, first: cross.hits.slice(0, 4).map((h) => `${h.part} os ${DRIVER_CATALOGUE.bones[h.bone]?.id} ${h.at.toArray().map(round)}`), margin: round(cross.margin), nearest: cross.nearest, roof: seating.roof, toe: seating.toeBoard, plan: seating.plan };
        expect(cushion).not.toBeNull();
        expect(Math.abs(contact.y - cushion!)).toBeLessThan(0.03);
        expect(Math.abs(lowest - contact.y)).toBeLessThan(0.03);
        for (const d of hands) expect(d).toBeLessThan(0.02);
        for (const d of heels) {
          expect(d).toBeGreaterThanOrEqual(0);
          expect(d).toBeLessThan(0.03);
        }
        expect(cross.hits.map((h) => `${h.part} (${DRIVER_CATALOGUE.bones[h.bone]?.id})`)).toEqual([]);
        expect(cross.margin).toBeGreaterThan(0);
        // Le volant tourne : les mains le suivent.
        for (const steer of [DRIVER_POSE.motion.steerMax, -DRIVER_POSE.motion.steerMax]) {
          const pose = handle.move({ steer, look: 0.2, lean: 0, surge: 0.05, hang: 0 });
          pose.grips.forEach((g, i) => expect(g.distanceTo(rim((i === 0 ? seating.hands : -seating.hands) + steer))).toBeLessThan(0.02));
        }
      }, 60_000);
    }
  }

  it('concept (vrai modèle sans ancres) : assis sur sa place, mains sur son volant, rien ne traverse', async () => {
    const vehicle = manifest('concept');
    const model = await storedModel('concept');
    const handle = await seated(model, vehicle);
    const driver = posedDriver(handle.rig);
    const contact = seatContact(handle);
    const cushion = surfaceBelow(model, contact, (o) => /Seat/.test(o.name));
    // La prise des mains : sur la jante du modèle (sa surface la plus proche).
    const wheel = model.getObjectByName('InteriorSteeringWheel02')!.parent!;
    const hands = handle.pose.grips.map((g) => clearance(wheel, [g.x, g.y, g.z]).distance);
    const steeringParts = (o: Object3D) => /Steering/.test(o.name);
    const cross = crossings(driver, model, (o) => /Seat/.test(o.name), (_p, b) => HANDS.has(b));
    report.concept = { cushion: cushion === null ? null : round(contact.y - cushion), hands: hands.map(round), torso: round(handle.pose.torso), hits: cross.hits.length, first: cross.hits.slice(0, 6).map((h) => `${h.part} os ${DRIVER_CATALOGUE.bones[h.bone]?.id} ${h.at.toArray().map(round)}`), margin: round(cross.margin), nearest: cross.nearest, steering: steeringParts(wheel) };
    expect(cushion).not.toBeNull();
    expect(Math.abs(contact.y - cushion!)).toBeLessThan(0.03);
    for (const d of hands) expect(d).toBeLessThan(0.02);
    expect(cross.hits.map((h) => `${h.part} (${DRIVER_CATALOGUE.bones[h.bone]?.id})`)).toEqual([]);
  }, 60_000);
});

describe('le motard', () => {
  for (const id of ['bobber', 'sportive']) {
    it(`${id} : assis sur la selle, mains aux poignées, pieds sur les repose-pieds, rien ne traverse`, async () => {
      const vehicle = manifest(id);
      const model = await builtModel(id);
      const handle = await seated(model, vehicle);
      const seating = handle.seating as BikeSeating;
      const driver = posedDriver(handle.rig);
      const contact = seatContact(handle);
      const seatNode = model.getObjectByName(DRIVER_CATALOGUE.anchors.seat)!;
      const saddle = seatNode.getWorldPosition(new Vector3());
      const hands = handle.pose.grips.map((g, i) => g.distanceTo(new Vector3(...seating.grips[i]!.at)));
      const soles = [0, 1].map((i) => {
        const j = bone(i === 0 ? 'pied_g' : 'pied_d');
        const ahead = seating.pegs[i]!.at[0] > (handle.pose.joints[bone('bassin')] as Vector3).x + 0.25;
        const local = ahead ? new Vector3(0.035, DRIVER_CATALOGUE.contacts.heel[1], 0) : new Vector3(...DRIVER_CATALOGUE.contacts.ball);
        // Distance au repose-pied : un barreau de 8 cm le long de Z, centré sur l'ancre.
        const d = local.applyQuaternion(handle.pose.world[j] as Quaternion).add(handle.pose.joints[j] as Vector3).sub(new Vector3(...seating.pegs[i]!.at));
        return Math.hypot(d.x, d.y, Math.max(0, Math.abs(d.z) - 0.04));
      });
      const pegs = seating.pegs.map((p) => new Vector3(...p.at));
      const cross = crossings(driver, model, () => false, (p, b) => HANDS.has(b) || p.distanceTo(contact) < 0.13 || (FEET.has(b) && pegs.some((g) => g.distanceTo(p) < 0.09)));
      report[id] = { joints: ['bassin', 'hanche_g', 'genou_g', 'pied_g'].map((j) => handle.pose.joints[bone(j)]!.toArray().map(round)), ankle: handle.pose.ankles[0].toArray().map(round), seat: round(contact.distanceTo(saddle)), hands: hands.map(round), soles: soles.map(round), torso: round(handle.pose.torso), hits: cross.hits.length, first: cross.hits.slice(0, 6).map((h) => `${h.part} os ${DRIVER_CATALOGUE.bones[h.bone]?.id} ${h.at.toArray().map(round)}`), margin: round(cross.margin), nearest: cross.nearest };
      // Assis : le point le plus bas du bassin (fesses à l'entrejambe) à moins de 3 cm du dessus de la selle.
      const low = Math.min(...driver.points.filter((p, i) => driver.bones[i] === bone('bassin') && Math.abs(p.z) < 0.08 && Math.abs(p.x - saddle.x) < 0.2).map((p) => p.y));
      report[`${id} bassin`] = round(low - saddle.y);
      expect(Math.abs(low - saddle.y)).toBeLessThan(0.03);
      for (const d of hands) expect(d).toBeLessThan(0.02);
      for (const d of soles) expect(d).toBeLessThan(0.02);
      expect(cross.hits.map((h) => `${h.part} (${DRIVER_CATALOGUE.bones[h.bone]?.id})`)).toEqual([]);
      // Penché en courbe : les mains restent aux poignées, les pieds aux repose-pieds.
      const pose = handle.move({ steer: 0, look: 0.15, lean: 0.12, surge: -0.04, hang: 0.04 });
      pose.grips.forEach((g, i) => expect(g.distanceTo(new Vector3(...seating.grips[i]!.at))).toBeLessThan(0.02));
    }, 60_000);
  }
});
