// Les six caméras de la sortie (src/drive/cameras.ts) : chaque plan au-dessus du sol, sans saut
// d'une image à l'autre (sauf la coupe du travelling d'un poste au suivant), le travelling hors de la
// chaussée, l'orbite bornée ; et le mode réalisateur (src/drive/realisateur.ts) : déterministe,
// jamais plus d'une coupe par seconde, des plans selon ce que fait la route.
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { CAMERA_IDS, type CameraId, type DriveInput, type DriveMotion, type OrbitView, type Rail, type VehicleFrame } from '../../src/drive/contrat.ts';
import { cameraShot, clampOrbit, createShot, DEFAULT_ORBIT, ORBIT_LIMITS, TRAVELLING, travellingIndex } from '../../src/drive/cameras.ts';
import { createPilot } from '../../src/drive/pilote.ts';
import { createPose, createRail, lateralPoint } from '../../src/drive/rail.ts';
import { createDirector, DIRECTOR, situationOf } from '../../src/drive/realisateur.ts';

type Segment = { line: number } | { arc: number; turn: number };

function makeRoute(segments: Segment[], climb = 0): MapRoute {
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
        rail.push(x, travelled * climb, z);
        next += step;
      }
    }
  }
  const length = (rail.length / 3 - 1) * step;
  return { format: 'pmb-carte', version: 1, id: 'essai', loop: false, length, step, rail, sections: [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width: 7 }], chunks: [], starts: [], far: null };
}

const AUTO: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };

/** Fait rouler le pilote et appelle `each` à chaque image avec le cadre du véhicule. */
function roll(route: MapRoute, seconds: number, each: (frame: VehicleFrame, time: number, motion: DriveMotion, rail: Rail) => void, kind: 'car' | 'bike' = 'car') {
  const rail = createRail(route);
  const pilot = createPilot(rail);
  const pose = createPose();
  const frame: VehicleFrame = { kind, position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2.2, halfWidth: 0.9, height: 1.35 };
  for (let i = 0; i * (1 / 60) < seconds && !pilot.motion.finished; i += 1) {
    const motion = pilot.step(1 / 60, AUTO, kind);
    rail.poseAt(motion.s, pose);
    lateralPoint(pose, motion.offset, 0, frame.position);
    frame.heading = pose.heading;
    frame.pitch = pose.pitch + motion.dive;
    frame.roll = motion.roll;
    each(frame, i / 60, motion, rail);
  }
}

const ROUTE = makeRoute([{ line: 150 }, { arc: 17, turn: 1.5 * Math.PI }, { line: 120 }, { arc: 40, turn: -Math.PI / 2 }, { line: 200 }], 0.04);

describe('caméras', () => {
  it('chaque plan reste au-dessus du sol et ne saute pas d’une image à l’autre', () => {
    const shot = createShot();
    const previous = new Map<CameraId, [number, number, number]>();
    const worst = new Map<CameraId, number>();
    roll(ROUTE, 80, (frame, time, motion, rail) => {
      for (const id of CAMERA_IDS) {
        cameraShot(id, frame, motion, rail, time, DEFAULT_ORBIT, shot);
        // Au-dessus de la chaussée (la route monte de 4 % : la poursuite, plus bas sur la pente, garde
        // sa hauteur au-dessus de la route sous elle).
        expect(shot.position[1], id).toBeGreaterThan(frame.position[1] - 0.5);
        expect(shot.fov, id).toBeGreaterThan(10);
        expect(shot.fov, id).toBeLessThan(80);
        const before = previous.get(id);
        if (before && id !== 'travelling') {
          const jump = Math.hypot(shot.position[0] - before[0], shot.position[1] - before[1], shot.position[2] - before[2]);
          worst.set(id, Math.max(worst.get(id) ?? 0, jump));
        }
        previous.set(id, [shot.position[0], shot.position[1], shot.position[2]]);
      }
    });
    // À 90 km/h, 25 m/s : 42 cm par image ; aucun plan ne bouge de plus d'un mètre d'une image à l'autre.
    for (const id of CAMERA_IDS) if (id !== 'travelling') expect(worst.get(id) ?? 0, id).toBeLessThan(1);
  });

  it('travelling : poste fixe sur le bas-côté, hors de la chaussée ; le véhicule passe devant puis on coupe', () => {
    const rail = createRail(makeRoute([{ line: 1000 }]));
    const shot = createShot();
    const frame: VehicleFrame = { kind: 'car', position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2.2, halfWidth: 0.9, height: 1.3 };
    const motion = { s: 0, speed: 20, accel: 0, offset: -1.75, roll: 0, dive: 0, braking: false, finished: false };
    const station = (s: number) => {
      motion.s = s;
      frame.position[0] = s;
      frame.position[2] = 1.75;
      cameraShot('travelling', frame, motion, rail, 0, DEFAULT_ORBIT, shot);
      return [...shot.position];
    };
    const a = station(TRAVELLING.spacing * 3 - 40);
    const b = station(TRAVELLING.spacing * 3 + 10);
    // Même poste : la caméra ne bouge pas pendant que le véhicule passe.
    expect(b).toEqual(a);
    expect(a[0]).toBeCloseTo(TRAVELLING.spacing * 3, 1);
    // Hors de la chaussée (7 m de large : bord à 3,5 m de l'axe).
    expect(Math.abs(a[2]!)).toBeGreaterThan(3.5);
    // Passé le poste de `passBy` mètres : poste suivant, de l'autre côté.
    const c = station(TRAVELLING.spacing * 3 + TRAVELLING.passBy + 1);
    expect(c[0]).toBeCloseTo(TRAVELLING.spacing * 4, 1);
    expect(Math.sign(c[2]!)).toBe(-Math.sign(a[2]!));
    expect(travellingIndex(TRAVELLING.spacing * 3 + TRAVELLING.passBy - 0.01)).toBe(3);
    // Champ serré quand le véhicule est loin, ouvert quand il passe.
    station(TRAVELLING.spacing * 4 - 60);
    const far = shot.fov;
    station(TRAVELLING.spacing * 4);
    expect(shot.fov).toBeGreaterThan(far);
  });

  it('orbite : réglée au doigt, bornée, au-dessus du sol ; lacet 0 derrière le véhicule', () => {
    expect(clampOrbit({ yaw: 7, pitch: -1, distance: 100 })).toEqual({ yaw: 7 - 2 * Math.PI, pitch: ORBIT_LIMITS.pitchMin, distance: ORBIT_LIMITS.distanceMax });
    expect(clampOrbit({ yaw: Number.NaN, pitch: Number.NaN, distance: Number.NaN })).toEqual(DEFAULT_ORBIT);
    const rail = createRail(makeRoute([{ line: 200 }]));
    const frame: VehicleFrame = { kind: 'car', position: [100, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2.2, halfWidth: 0.9, height: 1.3 };
    const motion = { s: 100, speed: 0, accel: 0, offset: 0, roll: 0, dive: 0, braking: true, finished: false };
    const view: OrbitView = { yaw: 0, pitch: 0.2, distance: 8 };
    const shot = cameraShot('orbite', frame, motion, rail, 0, view, createShot());
    expect(shot.position[0]).toBeLessThan(100);
    expect(shot.position[1]).toBeGreaterThan(0.3);
    cameraShot('orbite', frame, motion, rail, 0, { yaw: Math.PI / 2, pitch: 0.2, distance: 8 }, shot);
    // Lacet d'un quart de tour : sur la gauche du véhicule (−Z quand il regarde vers l'est).
    expect(shot.position[2]).toBeLessThan(-5);
  });

  it('poursuite derrière, avant devant, même au départ et à l’arrivée d’un parcours ouvert', () => {
    const rail = createRail(makeRoute([{ line: 100 }]));
    const frame: VehicleFrame = { kind: 'car', position: [0, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 2.2, halfWidth: 0.9, height: 1.3 };
    const motion = { s: 0, speed: 0, accel: 0, offset: 0, roll: 0, dive: 0, braking: true, finished: false };
    const shot = createShot();
    cameraShot('poursuite', frame, motion, rail, 0, DEFAULT_ORBIT, shot);
    expect(shot.position[0]).toBeLessThan(-5);
    motion.s = rail.length;
    frame.position[0] = rail.length;
    cameraShot('avant', frame, motion, rail, 0, DEFAULT_ORBIT, shot);
    expect(shot.position[0]).toBeGreaterThan(rail.length + 5);
  });

  it('aucune allocation : le plan donné est rempli et rendu', () => {
    const rail = createRail(makeRoute([{ line: 100 }]));
    const frame: VehicleFrame = { kind: 'bike', position: [10, 0, 0], heading: 0, pitch: 0, roll: 0, halfLength: 1.1, halfWidth: 0.4, height: 1.2 };
    const motion = { s: 10, speed: 10, accel: 0, offset: 0, roll: 0, dive: 0, braking: false, finished: false };
    const shot = createShot();
    const position = shot.position;
    for (const id of CAMERA_IDS) {
      expect(cameraShot(id, frame, motion, rail, 0, DEFAULT_ORBIT, shot)).toBe(shot);
      expect(shot.position).toBe(position);
    }
  });
});

describe('réalisateur', () => {
  it('situations : arrêt, freinage, virage, ligne droite', () => {
    expect(situationOf({ speed: 0, accel: 0, finished: false }, { curvature: 0 })).toBe('arret');
    expect(situationOf({ speed: 20, accel: -2, finished: false }, { curvature: 0 })).toBe('freinage');
    expect(situationOf({ speed: 10, accel: 0, finished: false }, { curvature: 1 / 30 })).toBe('virage');
    expect(situationOf({ speed: 25, accel: 0, finished: false }, { curvature: 0 })).toBe('ligne');
    expect(situationOf({ speed: 25, accel: 0, finished: false }, { curvature: 1 / 200 })).toBe('route');
  });

  it('jamais plus d’une coupe par seconde, jamais l’orbite, et la même suite de plans à chaque sortie', () => {
    const run = () => {
      const director = createDirector();
      const picks: { time: number; id: CameraId; s: number }[] = [];
      const pose = createPose();
      roll(ROUTE, 120, (_frame, time, motion, rail) => {
        rail.poseAt(motion.s, pose);
        const id = director.pick(time, motion, pose);
        if (picks.length === 0 || picks[picks.length - 1]!.id !== id) picks.push({ time, id, s: motion.s });
      });
      return picks;
    };
    const picks = run();
    expect(picks.length).toBeGreaterThan(6);
    for (let i = 1; i < picks.length; i += 1) expect(picks[i]!.time - picks[i - 1]!.time).toBeGreaterThanOrEqual(DIRECTOR.minGap);
    expect(picks.some((item) => item.id === 'orbite')).toBe(false);
    expect(new Set(picks.map((item) => item.id)).size).toBeGreaterThanOrEqual(3);
    expect(run()).toEqual(picks);
  });

  it('un plan à chaque situation : rasante ou embarquée en ligne droite, travelling ou poursuite au freinage', () => {
    const director = createDirector();
    const motion: DriveMotion = { speed: 25, accel: 0, finished: false, s: 0, offset: 0, roll: 0, dive: 0, braking: false };
    const pose = createPose();
    pose.curvature = 0;
    const first = director.pick(0, motion, pose);
    expect(DIRECTOR.shots.ligne).toContain(first);
    // Freinage avant un virage, longtemps après : on coupe vers un plan de freinage.
    motion.accel = -2;
    const brake = director.pick(DIRECTOR.minHoldOnEvent + 0.1, motion, pose);
    expect(DIRECTOR.shots.freinage).toContain(brake);
    // Temps qui recule (nouvelle sortie) : on repart de zéro ; reset fait de même.
    director.reset();
    expect(director.cuts).toBe(0);
  });
});
