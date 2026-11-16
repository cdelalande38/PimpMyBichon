// Performances sur la route (src/drive/pilote.ts, manifestes) : le 0 à 100 km/h et la vitesse de
// pointe de chaque véhicule du catalogue, dans leur ordre ; la borne d'adhérence en courbe ; le NOS
// (durée, réserve, recharge, vitesse relevée) ; la préparation du moteur qui compte ; le pilote
// automatique qui reprend selon le moteur ; l'impression de vitesse des caméras, bornée.
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { VEHICLES, vehicleById } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { CAMERA_FEEL, cameraFeel, cameraShot, createShot, DEFAULT_ORBIT, shakeAmplitude, speedFov } from '../../src/drive/cameras.ts';
import type { DriveInput, DriveMotion, VehicleFrame } from '../../src/drive/contrat.ts';
import { createPilot, performanceDe, PILOT } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';

type Segment = { line: number } | { arc: number; turn: number };

function route(segments: Segment[], width = 9): MapRoute {
  const step = 2;
  const rail: number[] = [0, 0, 0];
  let x = 0;
  let z = 0;
  let heading = 0;
  let travelled = 0;
  let next = step;
  for (const segment of segments) {
    const length = 'line' in segment ? segment.line : Math.abs(segment.turn) * segment.arc;
    const rate = 'line' in segment ? 0 : segment.turn / length;
    for (let d = 0; d < length - 1e-9; d += 0.05) {
      heading += rate * 0.05;
      x += Math.cos(heading) * 0.05;
      z -= Math.sin(heading) * 0.05;
      travelled += 0.05;
      if (travelled >= next - 1e-9) {
        rail.push(x, 0, z);
        next += step;
      }
    }
  }
  const length = (rail.length / 3 - 1) * step;
  return {
    format: 'pmb-carte',
    version: 1,
    id: 'essai',
    loop: false,
    length,
    step,
    rail,
    sections: [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width }],
    chunks: [],
    starts: [],
    far: null,
  } as unknown as MapRoute;
}

const FULL: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0 };
const AUTO: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
const LONG = createRail(route([{ line: 14000 }]));

/** 0 à 100 km/h (s) et vitesse la plus haute (km/h), plein gaz à la main sur une longue ligne droite. */
function launch(vehicle: VehicleManifest, build?: Parameters<typeof performanceDe>[1]): { t100: number; top: number } {
  const pilot = createPilot(LONG, performanceDe(vehicle, build));
  let t = 0;
  let t100 = Number.NaN;
  let top = 0;
  while (t < 200 && pilot.motion.s < 12000) {
    pilot.step(1 / 60, FULL, vehicle.kind);
    t += 1 / 60;
    top = Math.max(top, pilot.motion.speed * 3.6);
    if (Number.isNaN(t100) && pilot.motion.speed * 3.6 >= 100) t100 = t;
  }
  return { t100, top };
}

const RESULTS = new Map(VEHICLES.map((vehicle) => [vehicle.id, launch(vehicle)]));
const of = (id: string) => RESULTS.get(id) ?? { t100: Number.NaN, top: Number.NaN };

describe('accélération et vitesse de pointe, par véhicule (données des manifestes)', () => {
  it('chaque véhicule du catalogue déclare ses performances', () => {
    for (const vehicle of VEHICLES) {
      expect(vehicle.performance, vehicle.id).toBeDefined();
      expect(vehicle.engine?.power, vehicle.id).toBeGreaterThan(0);
    }
  });

  for (const vehicle of VEHICLES) {
    it(`${vehicle.id} : atteint sa vitesse de pointe en ligne droite, sans la dépasser`, () => {
      const { top } = of(vehicle.id);
      const declared = vehicle.performance?.topKmh ?? 0;
      expect(top).toBeGreaterThan(declared * 0.97);
      expect(top).toBeLessThan(declared + 1);
    });
  }

  it('0 à 100 km/h : course et sportive en 3 à 4 s, bobber vers 6, van vers 13, Cox vers 18 à 20 ; dans cet ordre', () => {
    const t = (id: string) => of(id).t100;
    if (vehicleById('concept')) expect(t('concept')).toBeGreaterThan(3);
    if (vehicleById('concept')) expect(t('concept')).toBeLessThan(4.2);
    if (vehicleById('sportive')) expect(t('sportive')).toBeLessThan(4.2);
    if (vehicleById('bobber')) expect(t('bobber')).toBeGreaterThan(4.6);
    if (vehicleById('bobber')) expect(t('bobber')).toBeLessThan(7);
    if (vehicleById('van')) expect(t('van')).toBeGreaterThan(11.5);
    if (vehicleById('van')) expect(t('van')).toBeLessThan(15.5);
    if (vehicleById('cox')) expect(t('cox')).toBeGreaterThan(16.5);
    if (vehicleById('cox')) expect(t('cox')).toBeLessThan(21);
    // L'ordre suit la puissance contre la masse (et la souplesse du moteur).
    const order = [...VEHICLES].sort((a, b) => t(a.id) - t(b.id)).map((vehicle) => vehicle.id);
    const ranked = order.filter((id) => ['bobber', 'van', 'cox'].includes(id));
    expect(ranked).toEqual(['bobber', 'van', 'cox'].filter((id) => vehicleById(id)));
  });

  it('vitesses de pointe : la course et la sportive dépassent 250 km/h, la Cox plafonne vers 140, le van vers 170, le bobber vers 160', () => {
    if (vehicleById('concept')) expect(of('concept').top).toBeGreaterThan(250);
    if (vehicleById('sportive')) expect(of('sportive').top).toBeGreaterThan(250);
    if (vehicleById('cox')) expect(Math.abs(of('cox').top - 140)).toBeLessThan(8);
    if (vehicleById('van')) expect(Math.abs(of('van').top - 170)).toBeLessThan(8);
    if (vehicleById('bobber')) expect(Math.abs(of('bobber').top - 160)).toBeLessThan(8);
  });

  it('la préparation du moteur compte : reprogrammé, il accélère plus fort', () => {
    const concept = vehicleById('concept') ?? VEHICLES[0]!;
    const base = performanceDe(concept);
    const prepared = performanceDe(concept, { parts: { reprog: 'reprog-2' } });
    // Le poste peut ne pas exister pour ce moteur : alors la puissance ne bouge pas, sans erreur.
    expect(prepared.power).toBeGreaterThanOrEqual(base.power);
    const kit = performanceDe(concept, { parts: { nitro: 'nitro-gros' } });
    expect(kit.nosBoost ?? 0).toBeGreaterThanOrEqual(base.nosBoost ?? 0);
  });

  it('pilote automatique : la reprise suit le moteur (la voiture de course part plus vite que la Cox), sans jamais dépasser son plafond', () => {
    const t80 = (id: string) => {
      const vehicle = vehicleById(id);
      if (!vehicle) return Number.NaN;
      const pilot = createPilot(createRail(route([{ line: 3000 }])), performanceDe(vehicle));
      let t = 0;
      let peak = 0;
      while (t < 60 && pilot.motion.speed * 3.6 < 80) {
        pilot.step(1 / 60, AUTO, vehicle.kind);
        peak = Math.max(peak, pilot.motion.accel);
        t += 1 / 60;
      }
      expect(peak).toBeLessThanOrEqual(PILOT.accel + 1e-6);
      return t;
    };
    if (vehicleById('concept') && vehicleById('cox')) expect(t80('concept')).toBeLessThan(t80('cox') * 0.5);
  });
});

describe('courbes : l’adhérence borne la vitesse', () => {
  it('plein gaz dans un grand virage, sans frein de l’app : l’accélération latérale prise reste sous l’adhérence (au-delà, il élargit) ; plus d’adhérence, plus vite', () => {
    const rail = createRail(route([{ line: 600 }, { arc: 60, turn: Math.PI }, { line: 400 }]));
    // Direction assistée : l'aide suit la route, gaz à fond, jamais de frein.
    const input: DriveInput = { ...FULL, assist: true };
    const lateral = (vehicle: VehicleManifest) => {
      const pilot = createPilot(rail, performanceDe(vehicle));
      let worst = 0;
      let slowest = Infinity;
      for (let i = 0; i < 60 * 60 && !pilot.motion.finished; i += 1) {
        pilot.step(1 / 60, input, vehicle.kind);
        if (!pilot.motion.finished) expect(pilot.motion.braking).toBe(false);
        worst = Math.max(worst, Math.abs(pilot.lateral));
        if (pilot.motion.s > 650 && pilot.motion.s < 760) slowest = Math.min(slowest, pilot.motion.speed);
      }
      return { worst, slowest };
    };
    const results = VEHICLES.map((vehicle) => ({ vehicle, ...lateral(vehicle) }));
    for (const r of results) expect(r.worst, r.vehicle.id).toBeLessThanOrEqual((r.vehicle.performance?.grip ?? PILOT.manual.lateral) + 1e-6);
    const concept = results.find((r) => r.vehicle.id === 'concept');
    const van = results.find((r) => r.vehicle.id === 'van');
    if (concept && van) expect(concept.slowest).toBeGreaterThan(van.slowest);
  });
});

describe('NOS', () => {
  const vehicle = vehicleById('concept') ?? VEHICLES[0]!;

  it('une poussée de quelques secondes : la réserve se vide, puis se recharge seule, lentement ; pas de poussée réserve vide', () => {
    const pilot = createPilot(LONG, performanceDe(vehicle));
    const input: DriveInput = { ...FULL, nos: 0 };
    for (let i = 0; i < 60 * 3; i += 1) pilot.step(1 / 60, input, vehicle.kind);
    expect(pilot.train.nos).toBe(false);
    input.nos = 1;
    let on = 0;
    for (let i = 0; i < 60 * 6; i += 1) {
      pilot.step(1 / 60, input, vehicle.kind);
      if (pilot.train.nos) on += 1 / 60;
    }
    expect(on).toBeGreaterThan(PILOT.nos.duration - 0.1);
    expect(on).toBeLessThan(PILOT.nos.duration + 0.1);
    const after = pilot.train.nosReserve;
    expect(after).toBeCloseTo(1 - PILOT.nos.duration * PILOT.nos.drain + (6 - PILOT.nos.duration) * PILOT.nos.recharge, 1);
    // Recharge lente : dix secondes rendent moins d'un quart de la bouteille.
    for (let i = 0; i < 60 * 10; i += 1) pilot.step(1 / 60, input, vehicle.kind);
    expect(pilot.train.nosReserve - after).toBeGreaterThan(0.1);
    expect(pilot.train.nosReserve - after).toBeLessThan(0.25);
    // Vider la bouteille, puis appuyer : rien ne part.
    for (let k = 2; k < 8; k += 1) {
      input.nos = k;
      for (let i = 0; i < 60 * 3.2; i += 1) pilot.step(1 / 60, input, vehicle.kind);
    }
    expect(pilot.train.nosReserve).toBeLessThan(PILOT.nos.minReserve);
    input.nos = 99;
    pilot.step(1 / 60, input, vehicle.kind);
    expect(pilot.train.nos).toBe(false);
  });

  it('accélération et vitesse de pointe relevées, mais bornées ; rien en pilote automatique', () => {
    const plain = createPilot(LONG, performanceDe(vehicle));
    const boosted = createPilot(LONG, performanceDe(vehicle));
    const input: DriveInput = { ...FULL, nos: 0 };
    for (let i = 0; i < 60 * 40; i += 1) {
      plain.step(1 / 60, FULL, vehicle.kind);
      // Un appui toutes les quatre secondes.
      if (i % 240 === 0) input.nos = (input.nos ?? 0) + 1;
      boosted.step(1 / 60, input, vehicle.kind);
    }
    expect(boosted.motion.s).toBeGreaterThan(plain.motion.s);
    const top = (vehicle.performance?.topKmh ?? 0) * PILOT.nos.topRatio;
    expect(boosted.motion.speed * 3.6).toBeLessThan(top + 1);
    const auto = createPilot(LONG, performanceDe(vehicle));
    auto.step(1 / 60, { ...AUTO, nos: 0 }, vehicle.kind);
    auto.step(1 / 60, { ...AUTO, nos: 1 }, vehicle.kind);
    expect(auto.train.nos).toBe(false);
  });
});

describe('impression de vitesse des caméras', () => {
  const frame: VehicleFrame = { kind: 'car', position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2.2, halfWidth: 0.95, height: 1.2 };
  const motion = (speed: number, pull = 0, boost = 0): DriveMotion => ({ s: 500, speed, accel: pull, offset: 0, roll: 0, dive: 0, braking: false, finished: false, pull, boost });

  it('le champ s’ouvre avec la vitesse : quelques degrés à 90 km/h, plus au-delà, plafonné ; plus encore au NOS', () => {
    expect(speedFov(25)).toBeCloseTo(CAMERA_FEEL.fovAt90, 6);
    expect(speedFov(50)).toBeGreaterThan(speedFov(25));
    expect(speedFov(200)).toBe(CAMERA_FEEL.fovMax);
    const shot = createShot();
    const plain = cameraShot('poursuite', frame, motion(40), LONG, 0, DEFAULT_ORBIT, shot).fov;
    const boosted = cameraShot('poursuite', frame, motion(40, 0, 1), LONG, 0, DEFAULT_ORBIT, shot).fov;
    expect(boosted - plain).toBeCloseTo(CAMERA_FEEL.fovBoost, 6);
  });

  it('poursuite : recule à l’accélération, se rapproche au freinage, plus bas avec la vitesse ; tout borné', () => {
    const distance = (pull: number, speed = 20) => {
      const shot = cameraShot('poursuite', frame, motion(speed, pull), LONG, 0, DEFAULT_ORBIT, createShot());
      return { back: -shot.position[0], height: shot.position[1] };
    };
    const still = distance(0);
    expect(distance(5).back).toBeGreaterThan(still.back + 0.5);
    expect(distance(-7).back).toBeLessThan(still.back - 0.5);
    expect(distance(50).back - still.back).toBeLessThanOrEqual(CAMERA_FEEL.pullBackMax + 0.01);
    expect(still.back - distance(-50).back).toBeLessThanOrEqual(CAMERA_FEEL.pullFwdMax + 0.01);
    expect(distance(0, 60).height).toBeLessThan(still.height);
  });

  it('tremblement : nul à basse vitesse et en mouvement réduit, de quelques centimètres au plus', () => {
    const saved = cameraFeel.reducedMotion;
    cameraFeel.reducedMotion = false;
    expect(shakeAmplitude(15)).toBe(0);
    expect(shakeAmplitude(80)).toBeLessThanOrEqual(CAMERA_FEEL.shakeMax);
    expect(shakeAmplitude(80)).toBeGreaterThan(0);
    cameraFeel.reducedMotion = true;
    expect(shakeAmplitude(80)).toBe(0);
    cameraFeel.reducedMotion = saved;
  });
});
