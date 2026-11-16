// Virage (demande du 16 novembre 2026 : « voir la voiture qui tourne, roues plus direction ; moto ça
// penche ») : braquage, cap ajouté par un changement de place, roulis et inclinaison (src/drive/
// pilote.ts), braquage montré et direction d'une moto (src/drive/scene/roues.ts), retard des caméras
// et inclinaison de l'embarquée (src/drive/cameras.ts).
import { BoxGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { CHASE, chase, cameraShot, createShot, DEFAULT_ORBIT } from '../../src/drive/cameras.ts';
import type { DriveInput, DriveMotion, Rail, VehicleFrame } from '../../src/drive/contrat.ts';
import { bikeLeanOf, carRollOf, createPilot, performanceDe, PILOT, rollLimitOf, steerOf, yawOf } from '../../src/drive/pilote.ts';
import { createPose, createRail, lateralPoint } from '../../src/drive/rail.ts';
import { bikeSteering, rollingWheels, steerParts, WHEEL_STEER, wheelSteer } from '../../src/drive/scene/roues.ts';

type Segment = { line: number } | { arc: number; turn: number };

/** Parcours d'essai : lignes droites et arcs (tour positif : à gauche). */
function makeRoute(segments: Segment[]): MapRoute {
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
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length, step, rail, sections: [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [], far: null };
}

// Ligne droite, virage à gauche (R 30 m), ligne droite, virage à droite (R 30 m), longue ligne droite.
const ARC = (Math.PI / 2) * 30;
const ROUTE = makeRoute([{ line: 150 }, { arc: 30, turn: Math.PI / 2 }, { line: 100 }, { arc: 30, turn: -Math.PI / 2 }, { line: 260 }]);
const LEFT = 150 + ARC / 2;
const RIGHT = 150 + ARC + 100 + ARC / 2;
// Pilote automatique, quelles que soient les autres commandes du contrat.
const AUTO = { auto: true, throttle: 0, brake: 0 } as DriveInput;
const deg = (rad: number) => (rad * 180) / Math.PI;

interface Sample {
  s: number;
  steer: number;
  yaw: number;
  roll: number;
  offset: number;
  speed: number;
}

/** Fait rouler le pilote automatique jusqu'au bout ; un relevé par image (1/60 s). */
function drive(kind: 'car' | 'bike', grip?: number, each?: (motion: DriveMotion, frame: VehicleFrame, rail: Rail, time: number) => void): Sample[] {
  const rail = createRail(ROUTE);
  const performance = performanceDe({ kind, performance: grip === undefined ? undefined : { mass: kind === 'car' ? 1200 : 300, topKmh: 180, grip } });
  const pilot = createPilot(rail, performance);
  const pose = createPose();
  const frame: VehicleFrame = { kind, position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: kind === 'car' ? 2.2 : 1.05, halfWidth: kind === 'car' ? 0.95 : 0.45, height: kind === 'car' ? 1.4 : 1.2 };
  const out: Sample[] = [];
  for (let i = 0; i < 60 * 120 && !pilot.motion.finished; i += 1) {
    const motion = pilot.step(1 / 60, AUTO, kind);
    out.push({ s: motion.s, steer: motion.steer ?? 0, yaw: motion.yaw ?? 0, roll: motion.roll, offset: motion.offset, speed: motion.speed });
    if (each) {
      rail.poseAt(motion.s, pose);
      lateralPoint(pose, motion.offset, 0, frame.position);
      frame.heading = pose.heading + (motion.yaw ?? 0);
      frame.pitch = pose.pitch + motion.dive;
      frame.roll = motion.roll;
      each(motion, frame, rail, (i + 1) / 60);
    }
  }
  // Arrivé : quelques images à l'arrêt.
  for (let i = 0; i < 90; i += 1) {
    const motion = pilot.step(1 / 60, AUTO, kind);
    out.push({ s: motion.s, steer: motion.steer ?? 0, yaw: motion.yaw ?? 0, roll: motion.roll, offset: motion.offset, speed: motion.speed });
  }
  return out;
}

const near = (samples: Sample[], s: number) => samples.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
const span = (samples: Sample[], from: number, to: number) => samples.filter((x) => x.s >= from && x.s <= to && x.speed > 0.5);

describe('virage : fonctions pures du pilote', () => {
  it('cap ajouté par un changement de place : nul en ligne droite et à l’arrêt, du côté du déplacement, borné', () => {
    expect(yawOf(0, 20)).toBe(0);
    expect(yawOf(1.5, 0)).toBe(0);
    expect(yawOf(1, 20)).toBeGreaterThan(0);
    expect(yawOf(-1, 20)).toBeLessThan(0);
    expect(yawOf(1, 20)).toBeCloseTo(Math.atan(1 / 20), 5);
    expect(Math.abs(yawOf(50, 3))).toBeLessThanOrEqual(PILOT.steer.yawMax + 1e-12);
    expect(yawOf(Number.NaN, 10)).toBe(0);
  });

  it('braquage : nul en ligne droite et à l’arrêt, positif à gauche, négatif à droite, borné', () => {
    expect(steerOf(0, 20, 'car')).toBe(0);
    expect(steerOf(0.05, 0, 'car')).toBe(0);
    expect(steerOf(0.05, 20, 'car')).toBeCloseTo(Math.atan(PILOT.steer.wheelbase.car * 0.05), 6);
    expect(steerOf(-0.05, 20, 'car')).toBeLessThan(0);
    expect(steerOf(0.05, 20, 'bike')).toBeLessThan(steerOf(0.05, 20, 'car'));
    expect(steerOf(5, 20, 'car')).toBeLessThanOrEqual(PILOT.steer.max);
    expect(steerOf(Number.NaN, 20, 'car')).toBe(0);
  });

  it('roulis d’une voiture : vers l’extérieur, lisible en pilote automatique, plus fort pour une voiture souple', () => {
    expect(carRollOf(0, 7)).toBe(0);
    // Virage à gauche (accélération latérale positive) : le toit part à droite (roulis positif).
    expect(carRollOf(3, 7)).toBeGreaterThan(0);
    expect(carRollOf(-3, 7)).toBeLessThan(0);
    // Adhérences du catalogue : souple (5 à 5,5 m/s²) et voiture de course (9,5 m/s²).
    for (const grip of [5, 5.5, 9.5]) {
      const auto = deg(carRollOf(Math.min(PILOT.lateral, grip), grip));
      const limit = deg(carRollOf(grip, grip));
      expect(auto, `adhérence ${grip}`).toBeGreaterThanOrEqual(2.4);
      expect(auto, `adhérence ${grip}`).toBeLessThanOrEqual(4.5);
      expect(limit, `adhérence ${grip}`).toBeGreaterThanOrEqual(4.8);
      expect(limit, `adhérence ${grip}`).toBeLessThanOrEqual(6);
    }
    expect(rollLimitOf(5)).toBeGreaterThan(rollLimitOf(9.5));
    expect(carRollOf(3.2, 5)).toBeGreaterThan(carRollOf(3.2, 9.5));
    // Au-delà de la limite : borné.
    expect(carRollOf(40, 5)).toBeLessThanOrEqual(PILOT.roll.max);
  });

  it('inclinaison d’une moto : vers l’intérieur, jusqu’à 45° et plus à la limite, bornée', () => {
    expect(bikeLeanOf(0)).toBe(-0);
    expect(bikeLeanOf(3.2)).toBeLessThan(0);
    expect(bikeLeanOf(-3.2)).toBeGreaterThan(0);
    expect(deg(-bikeLeanOf(8.5))).toBeGreaterThanOrEqual(45);
    expect(deg(-bikeLeanOf(8.5))).toBeLessThanOrEqual(50);
    expect(-bikeLeanOf(100)).toBeLessThanOrEqual(PILOT.lean.max);
  });
});

describe('virage : le pilote en courbe', () => {
  const car = drive('car', 7);
  const bike = drive('bike', 8.5);

  it('voiture : les roues braquent et la caisse roule dans les virages, du bon côté', () => {
    const left = near(car, LEFT);
    const right = near(car, RIGHT);
    expect(left.steer).toBeGreaterThan(0.03);
    expect(right.steer).toBeLessThan(-0.03);
    expect(deg(left.roll)).toBeGreaterThan(1.5);
    expect(deg(left.roll)).toBeLessThan(6.5);
    expect(deg(right.roll)).toBeLessThan(-1.5);
  });

  it('voiture : tout revient à zéro en ligne droite, puis à l’arrêt', () => {
    const end = ROUTE.length;
    for (const x of span(car, end - 140, end - 60)) {
      expect(Math.abs(x.steer), `s=${x.s.toFixed(0)}`).toBeLessThan(0.004);
      // La trajectoire revient lentement au milieu de la chaussée : un cap de quelques dixièmes de degré.
      expect(Math.abs(x.yaw), `s=${x.s.toFixed(0)}`).toBeLessThan(0.01);
      expect(Math.abs(deg(x.roll)), `s=${x.s.toFixed(0)}`).toBeLessThan(0.3);
    }
    const last = car[car.length - 1]!;
    expect(last.speed).toBe(0);
    expect(Math.abs(last.steer)).toBeLessThan(1e-3);
    expect(Math.abs(last.yaw)).toBeLessThan(1e-3);
  });

  it('le changement de place fait pivoter le véhicule, du côté où il se déplace, de quelques degrés au plus', () => {
    let moving = 0;
    let agree = 0;
    let worst = 0;
    for (let i = 1; i < car.length; i += 1) {
      const a = car[i - 1]!;
      const b = car[i]!;
      worst = Math.max(worst, Math.abs(b.yaw));
      const rate = (b.offset - a.offset) * 60;
      if (Math.abs(rate) > 0.3 && b.speed > 3) {
        moving += 1;
        if (Math.sign(rate) === Math.sign(b.yaw)) agree += 1;
      }
    }
    expect(moving).toBeGreaterThan(20);
    expect(agree / moving).toBeGreaterThan(0.9);
    expect(worst).toBeGreaterThan(0.002);
    expect(worst).toBeLessThanOrEqual(PILOT.steer.yawMax + 1e-9);
  });

  it('moto : elle se couche vers l’intérieur, un peu avant le virage, et se relève en ligne droite', () => {
    expect(deg(near(bike, LEFT).roll)).toBeLessThan(-15);
    expect(deg(near(bike, RIGHT).roll)).toBeGreaterThan(15);
    // Anticipation : déjà couchée à l'entrée du virage.
    expect(deg(near(bike, 150).roll)).toBeLessThan(-3);
    const end = ROUTE.length;
    for (const x of span(bike, end - 140, end - 60)) expect(Math.abs(deg(x.roll)), `s=${x.s.toFixed(0)}`).toBeLessThan(0.5);
    expect(near(bike, LEFT).steer).toBeGreaterThan(0);
  });
});

describe('virage : roues et direction à l’image', () => {
  it('braquage montré : amplifié, 30° au plus au pas, quelques degrés lancé, signe gardé', () => {
    expect(wheelSteer(0.1, 5, 'car')).toBeCloseTo(0.1 * WHEEL_STEER.car.gain, 6);
    expect(wheelSteer(0.5, 3, 'car')).toBeCloseTo((30 * Math.PI) / 180, 6);
    expect(wheelSteer(-0.5, 3, 'car')).toBeCloseTo((-30 * Math.PI) / 180, 6);
    expect(deg(wheelSteer(0.5, 40, 'car'))).toBeCloseTo(5, 6);
    expect(deg(wheelSteer(0.5, 3, 'bike'))).toBeLessThanOrEqual(9 + 1e-9);
    expect(wheelSteer(Number.NaN, 3, 'car')).toBe(0);
  });

  it('voiture : seules les roues avant braquent, autour de la verticale du véhicule', () => {
    const road = new Group();
    road.rotation.y = 0.8;
    const root = new Group();
    road.add(root);
    const spins = [1.3, -1.3].map((x) => {
      const node = new Group();
      node.position.set(x, 0.33, 0.75);
      node.add(new Mesh(new CylinderGeometry(0.33, 0.33, 0.22, 12).rotateX(Math.PI / 2), new MeshBasicMaterial()));
      root.add(node);
      return { node, radius: 0.33 };
    });
    const [front, rear] = rollingWheels(root, spins, 'car');
    expect(front!.steer).toBeDefined();
    expect(rear!.steer).toBeUndefined();
    expect(front!.steer!.y).toBeCloseTo(1, 6);
  });

  it('moto : la fourche, le guidon et les poignées tournent avec la roue avant autour de l’axe de direction', () => {
    const root = new Group();
    const wheel = new Group();
    wheel.name = 'roue_avant';
    wheel.position.set(0.8, 0.32, 0);
    wheel.add(new Mesh(new CylinderGeometry(0.32, 0.32, 0.12, 12).rotateX(Math.PI / 2), new MeshBasicMaterial()));
    root.add(wheel);
    const rear = new Group();
    rear.position.set(-0.8, 0.32, 0);
    rear.add(new Mesh(new CylinderGeometry(0.32, 0.32, 0.12, 12).rotateX(Math.PI / 2), new MeshBasicMaterial()));
    root.add(rear);
    const fork = new Mesh(new BoxGeometry(0.1, 0.9, 0.2).translate(0.55, 0.75, 0), new MeshBasicMaterial());
    fork.name = 'fourche';
    root.add(fork);
    const grips = [-0.35, 0.35].map((z, i) => {
      const grip = new Group();
      grip.name = i === 0 ? 'poignee_gauche' : 'poignee_droite';
      grip.position.set(0.3, 1.2, z);
      root.add(grip);
      return grip;
    });
    const wheels = rollingWheels(root, [{ node: wheel, radius: 0.32 }, { node: rear, radius: 0.32 }], 'bike');
    const axis = wheels[0]!.steer!;
    // Chasse : l'axe monte vers les poignées, penché vers l'arrière.
    expect(axis.y).toBeGreaterThan(0.5);
    expect(axis.x).toBeLessThan(-0.2);
    expect(wheels[1]!.steer).toBeUndefined();
    const parts = bikeSteering(root, wheels, 'bike');
    expect(parts.map((p) => p.node.name).sort()).toEqual(['fourche', 'poignee_droite', 'poignee_gauche']);
    expect(bikeSteering(root, wheels, 'car')).toEqual([]);
    const before = grips[1]!.position.clone();
    steerParts(parts, 0.2);
    // Braquée à gauche : la poignée droite avance, la gauche recule.
    expect(grips[1]!.position.x).toBeGreaterThan(before.x + 0.03);
    expect(grips[0]!.position.x).toBeLessThan(0.3 - 0.03);
    // Le moyeu, sur l'axe, ne bouge pas : un point de la fourche sur l'axe reste en place.
    const hub = new Vector3(0.8, 0.32, 0);
    const q = new Quaternion().setFromAxisAngle(parts[0]!.axis, 0.2);
    const moved = hub.clone().sub(parts[0]!.pivot).applyQuaternion(q).add(parts[0]!.pivot);
    expect(moved.distanceTo(hub)).toBeLessThan(1e-6);
    steerParts(parts, 0);
    expect(grips[1]!.position.distanceTo(before)).toBeLessThan(1e-9);
  });
});

describe('virage : caméras', () => {
  it('poursuite : en retard sur le cap dans un virage (on voit le flanc), borné, de retour dans l’axe en ligne droite', () => {
    const shot = createShot();
    const lags: { s: number; lag: number; angle: number }[] = [];
    drive('car', 7, (motion, frame, rail, time) => {
      cameraShot('poursuite', frame, motion, rail, time, DEFAULT_ORBIT, shot);
      // Angle entre l'axe du véhicule et la direction caméra → véhicule.
      const dx = frame.position[0] - shot.position[0];
      const dz = frame.position[2] - shot.position[2];
      const view = Math.atan2(-dz, dx);
      const angle = Math.atan2(Math.sin(frame.heading - view), Math.cos(frame.heading - view));
      lags.push({ s: motion.s, lag: chase.lag, angle });
    });
    const at = (s: number) => lags.reduce((best, x) => (Math.abs(x.s - s) < Math.abs(best.s - s) ? x : best));
    // Virage à gauche : la caméra garde un cap plus à droite ; le véhicule tourne le nez à gauche dans le cadre.
    expect(at(LEFT).lag).toBeLessThan(-0.03);
    expect(at(RIGHT).lag).toBeGreaterThan(0.03);
    expect(deg(at(LEFT).angle)).toBeGreaterThan(4);
    for (const x of lags) expect(Math.abs(x.lag)).toBeLessThanOrEqual(CHASE.max + 1e-9);
    const end = ROUTE.length;
    for (const x of lags.filter((l) => l.s > end - 140 && l.s < end - 60)) expect(Math.abs(x.lag)).toBeLessThan(0.01);
  });

  it('un même temps ne change rien ; un saut de temps remet la caméra dans l’axe', () => {
    const rail = createRail(ROUTE);
    const motion: DriveMotion = { s: 170, speed: 10, accel: 0, offset: 0, roll: 0, dive: 0, braking: false, finished: false };
    const frame: VehicleFrame = { kind: 'car', position: [0, 0, 0], heading: 0.4, pitch: 0, roll: 0, halfLength: 2.2, halfWidth: 0.95, height: 1.4 };
    const shot = createShot();
    cameraShot('poursuite', frame, motion, rail, 100, DEFAULT_ORBIT, shot);
    expect(chase.lag).toBe(0);
    frame.heading = 0.5;
    motion.s = 171;
    cameraShot('poursuite', frame, motion, rail, 100.1, DEFAULT_ORBIT, shot);
    const lag = chase.lag;
    expect(lag).toBeLessThan(0);
    cameraShot('rasante', frame, motion, rail, 100.1, DEFAULT_ORBIT, shot);
    expect(chase.lag).toBe(lag);
    cameraShot('poursuite', frame, motion, rail, 300, DEFAULT_ORBIT, shot);
    expect(chase.lag).toBe(0);
  });

  it('embarquée : l’image penche avec la moto (une part bornée), pas les autres plans', () => {
    const rail = createRail(ROUTE);
    const motion: DriveMotion = { s: 170, speed: 10, accel: 0, offset: 0, roll: -0.7, dive: 0, braking: false, finished: false };
    const bike: VehicleFrame = { kind: 'bike', position: [0, 0, 0], heading: 0, pitch: 0, roll: -0.7, halfLength: 1.05, halfWidth: 0.45, height: 1.2 };
    const shot = createShot();
    cameraShot('embarquee', bike, motion, rail, 0, DEFAULT_ORBIT, shot);
    // Couchée à gauche : la caméra penche vers sa gauche, d'une part bornée de l'angle.
    expect(shot.roll).toBeGreaterThan(0.2);
    expect(shot.roll).toBeLessThanOrEqual(CHASE.rollMax);
    // L'œil suit le motard : déplacé vers la gauche du véhicule (−Z, cap nul).
    expect(shot.position[2]).toBeLessThan(-0.5);
    cameraShot('poursuite', bike, motion, rail, 0, DEFAULT_ORBIT, shot);
    expect(shot.roll).toBe(0);
  });
});
