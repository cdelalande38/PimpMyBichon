// Le pilote de la sortie (src/drive/pilote.ts) : croisière, vitesse en courbe, freinage anticipé,
// arrêt au bout, distance d'arrêt, conduite à la main, bornes de la chaussée, caisse, déterminisme
// et stabilité avec un pas de temps variable ; puis la vraie carte si elle a été fabriquée.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapRoute, RailSection } from '../../src/data/mapTypes.ts';
import type { DriveInput, DriveMotion, Pilot, Rail } from '../../src/drive/contrat.ts';
import { createPilot, cruiseSpeed, laneBound, laneCenter, PILOT } from '../../src/drive/pilote.ts';
import { createPose, createRail } from '../../src/drive/rail.ts';

type Segment = { line: number } | { arc: number; turn: number };

function makeRoute(segments: Segment[], options: { loop?: boolean; sections?: RailSection[] } = {}): MapRoute {
  const step = 2;
  const rail: number[] = [0, 0, 0];
  let x = 0;
  let z = 0;
  let heading = 0;
  let travelled = 0;
  let next = step;
  const fine = 0.05;
  for (const segment of segments) {
    const length = 'line' in segment ? segment.line : Math.abs(segment.turn) * segment.arc;
    const rate = 'line' in segment ? 0 : segment.turn / length;
    for (let d = 0; d < length - 1e-9; d += fine) {
      heading += rate * fine;
      x += Math.cos(heading) * fine;
      z -= Math.sin(heading) * fine;
      travelled += fine;
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
    loop: options.loop ?? false,
    length,
    step,
    rail,
    sections: options.sections ?? [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width: 7 }],
    chunks: [],
    starts: [],
    far: null,
  };
}

const AUTO: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
const kmh = (ms: number) => ms * 3.6;

interface Trace {
  steps: number;
  maxLateral: number;
  maxSpeed: number;
  minSpeedIn: (from: number, to: number) => number;
  samples: { s: number; speed: number; accel: number; offset: number }[];
}

/** Fait rouler le pilote ; `input` peut changer selon le mouvement. */
function drive(pilot: Pilot, rail: Rail, seconds: number, input: (motion: DriveMotion, t: number) => DriveInput, dt: (i: number) => number = () => 1 / 60, kind: 'car' | 'bike' = 'car'): Trace {
  const pose = createPose();
  const samples: Trace['samples'] = [];
  let maxLateral = 0;
  let maxSpeed = 0;
  let t = 0;
  let i = 0;
  let previousS = pilot.motion.s;
  while (t < seconds) {
    const h = dt(i);
    const motion = pilot.step(h, input(pilot.motion, t), kind);
    t += h;
    i += 1;
    // Jamais de recul.
    if (!rail.loop) expect(motion.s).toBeGreaterThanOrEqual(previousS - 1e-9);
    previousS = motion.s;
    expect(motion.speed).toBeGreaterThanOrEqual(0);
    rail.poseAt(motion.s, pose);
    maxLateral = Math.max(maxLateral, motion.speed * motion.speed * Math.abs(pose.curvature));
    maxSpeed = Math.max(maxSpeed, motion.speed);
    samples.push({ s: motion.s, speed: motion.speed, accel: motion.accel, offset: motion.offset });
    if (motion.finished) break;
  }
  return {
    steps: i,
    maxLateral,
    maxSpeed,
    samples,
    minSpeedIn: (from, to) => Math.min(...samples.filter((item) => item.s >= from && item.s <= to).map((item) => item.speed)),
  };
}

describe('croisière et courbes', () => {
  it('croisière : 50 en agglomération, 60 à 90 hors agglomération selon la chaussée', () => {
    expect(kmh(cruiseSpeed({ urban: true, width: 12, lanes: 3 }))).toBeCloseTo(50, 6);
    expect(kmh(cruiseSpeed({ urban: false, width: 7, lanes: 2 }))).toBeCloseTo(90, 6);
    expect(kmh(cruiseSpeed({ urban: false, width: 3.5, lanes: 1 }))).toBeCloseTo(60, 6);
    expect(kmh(cruiseSpeed({ urban: false, width: 6, lanes: 2 }))).toBeCloseTo(80, 6);
  });

  it('atteint sa croisière en ligne droite, avec une reprise franche et sans dépasser', () => {
    const rail = createRail(makeRoute([{ line: 2000 }]));
    const pilot = createPilot(rail);
    const trace = drive(pilot, rail, 30, () => AUTO);
    const at = (time: number) => trace.samples[Math.round(time * 60) - 1]!;
    expect(kmh(at(5).speed)).toBeGreaterThan(35);
    expect(kmh(at(25).speed)).toBeGreaterThan(88);
    expect(kmh(trace.maxSpeed)).toBeLessThan(90.5);
    expect(Math.max(...trace.samples.map((item) => item.accel))).toBeLessThanOrEqual(PILOT.accel + 1e-6);
  });

  it('un rond-point de 17 m se prend autour de 25 km/h, accélération latérale plafonnée', () => {
    const before = 400;
    const ring = 1.5 * Math.PI * 17;
    const rail = createRail(makeRoute([{ line: before }, { arc: 17, turn: 1.5 * Math.PI }, { line: 400 }]));
    const pilot = createPilot(rail);
    const trace = drive(pilot, rail, 120, () => AUTO);
    const slowest = kmh(trace.minSpeedIn(before + 10, before + ring - 10));
    expect(slowest).toBeGreaterThan(21);
    expect(slowest).toBeLessThan(29);
    expect(trace.maxLateral).toBeLessThan(PILOT.lateral * 1.15);
  });

  it('freinage anticipé et doux : déjà ralenti avant le virage, jamais de freinage brutal', () => {
    const rail = createRail(makeRoute([{ line: 500 }, { arc: 20, turn: Math.PI / 2 }, { line: 300 }]));
    const pilot = createPilot(rail);
    const trace = drive(pilot, rail, 120, () => AUTO);
    // Rayon 20 m : √(2,8 × 20) ≈ 27 km/h, atteints dès les premiers mètres de l'arc.
    const entry = trace.samples.find((item) => item.s >= 508)!;
    expect(kmh(entry.speed)).toBeLessThan(29);
    const strongest = Math.min(...trace.samples.filter((item) => item.s < rail.length - 50).map((item) => item.accel));
    expect(strongest).toBeGreaterThan(-PILOT.maxBrake - 1e-6);
    expect(strongest).toBeLessThan(-1);
    // Pas d'à-coup : l'accélération varie d'au plus `jerk` m/s³.
    // (Hors des derniers mètres : à l'arrivée, le véhicule se pose d'un coup, à moins de 2 km/h.)
    let worstJerk = 0;
    for (let i = 1; i < trace.samples.length && trace.samples[i]!.s < rail.length - 30; i += 1) {
      worstJerk = Math.max(worstJerk, Math.abs(trace.samples[i]!.accel - trace.samples[i - 1]!.accel) * 60);
    }
    expect(worstJerk).toBeLessThan(PILOT.jerk * 1.05);
  });

  it('s’arrête au bout d’un parcours ouvert, sans le dépasser, et le dit', () => {
    const rail = createRail(makeRoute([{ line: 600 }]));
    const pilot = createPilot(rail);
    const trace = drive(pilot, rail, 200, () => AUTO);
    const last = pilot.motion;
    expect(last.finished).toBe(true);
    expect(last.s).toBe(rail.length);
    expect(last.speed).toBe(0);
    expect(last.braking).toBe(true);
    expect(trace.samples.every((item) => item.s <= rail.length)).toBe(true);
    // Une fois arrivé, plus rien ne bouge.
    pilot.step(0.1, AUTO, 'car');
    expect(pilot.motion.s).toBe(rail.length);
  });

  it('boucle : il ne s’arrête jamais et repasse par le départ', () => {
    const rail = createRail(makeRoute([{ arc: 60, turn: 2 * Math.PI }], { loop: true }));
    const pilot = createPilot(rail);
    let wrapped = false;
    let previous = 0;
    for (let i = 0; i < 60 * 60; i += 1) {
      const motion = pilot.step(1 / 60, AUTO, 'car');
      if (motion.s < previous - rail.length / 2) wrapped = true;
      previous = motion.s;
      expect(motion.finished).toBe(false);
    }
    expect(wrapped).toBe(true);
  });
});

describe('à la main', () => {
  it('distance d’arrêt : plein frein depuis 90 km/h entre 40 et 55 m', () => {
    const rail = createRail(makeRoute([{ line: 3000 }]));
    const pilot = createPilot(rail);
    drive(pilot, rail, 40, () => AUTO);
    expect(kmh(pilot.motion.speed)).toBeGreaterThan(88);
    const from = pilot.motion.s;
    drive(pilot, rail, 10, () => ({ auto: false, throttle: 0, brake: 1, lane: 0 }));
    expect(pilot.motion.speed).toBe(0);
    expect(pilot.motion.s - from).toBeLessThan(55);
    expect(pilot.motion.s - from).toBeGreaterThan(40);
  });

  it('accélérateur : la vitesse monte, plafonnée ; roue libre : elle redescend sans jamais reculer', () => {
    const rail = createRail(makeRoute([{ line: 5000 }]));
    const pilot = createPilot(rail);
    drive(pilot, rail, 60, () => ({ auto: false, throttle: 1, brake: 0, lane: 0 }));
    expect(kmh(pilot.motion.speed)).toBeGreaterThan(100);
    expect(kmh(pilot.motion.speed)).toBeLessThanOrEqual(PILOT.manual.topKmh + 0.5);
    drive(pilot, rail, 200, () => ({ auto: false, throttle: 0, brake: 0, lane: 0 }));
    expect(pilot.motion.speed).toBe(0);
    const s = pilot.motion.s;
    drive(pilot, rail, 2, () => ({ auto: false, throttle: 0, brake: 1, lane: 0 }));
    expect(pilot.motion.s).toBe(s);
  });

  it('jamais de sortie de route : plein gaz dans un rond-point, l’enveloppe freine à sa place', () => {
    const rail = createRail(makeRoute([{ line: 400 }, { arc: 17, turn: 1.5 * Math.PI }, { line: 400 }]));
    const pilot = createPilot(rail);
    const trace = drive(pilot, rail, 60, () => ({ auto: false, throttle: 1, brake: 0, lane: 1 }));
    expect(trace.maxLateral).toBeLessThan(PILOT.manual.lateral * 1.15);
  });

  it('placement : à gauche ou à droite de sa voie, jamais hors de la chaussée', () => {
    const sections: RailSection[] = [
      { from: 0, to: 300, ground: 'sol', urban: false, lanes: 2, width: 7 },
      { from: 300, to: 400, ground: 'pont', urban: false, lanes: 1, width: 3.5 },
      { from: 400, to: 1000, ground: 'sol', urban: false, lanes: 2, width: 7 },
    ];
    const rail = createRail(makeRoute([{ line: 1000 }], { sections }));
    const pilot = createPilot(rail);
    const pose = createPose();
    const center = laneCenter({ width: 7, lanes: 2 });
    expect(center).toBeCloseTo(-1.75, 6);
    drive(pilot, rail, 6, () => ({ auto: false, throttle: 0.6, brake: 0, lane: -1 }));
    expect(pilot.motion.offset).toBeGreaterThan(center + 0.3);
    drive(pilot, rail, 6, () => ({ auto: false, throttle: 0.6, brake: 0, lane: 1 }));
    expect(pilot.motion.offset).toBeLessThan(center - 0.3);
    for (const lane of [-1, 1] as const) {
      const trace = drive(pilot, rail, 60, () => ({ auto: false, throttle: 0.5, brake: 0, lane }));
      for (const item of trace.samples) {
        rail.poseAt(item.s, pose);
        expect(Math.abs(item.offset)).toBeLessThanOrEqual(laneBound(pose, 'car') + 1e-9);
      }
    }
  });
});

describe('caisse', () => {
  it('voiture : roulis vers l’extérieur du virage (positif à gauche), plongée au freinage', () => {
    const rail = createRail(makeRoute([{ line: 300 }, { arc: 40, turn: Math.PI }, { line: 300 }]));
    const pilot = createPilot(rail);
    let roll = 0;
    let dive = 0;
    drive(pilot, rail, 60, (motion) => {
      if (motion.s > 300 + 20 && motion.s < 300 + 100) roll = Math.max(roll, motion.roll);
      dive = Math.min(dive, motion.dive);
      return AUTO;
    });
    expect(roll).toBeGreaterThan(0.01);
    expect(roll).toBeLessThanOrEqual(PILOT.roll.max * 1.3);
    expect(dive).toBeLessThan(-0.003);
  });

  it('moto : s’incline vers l’intérieur du virage, à l’angle d’équilibre', () => {
    const rail = createRail(makeRoute([{ line: 300 }, { arc: 40, turn: Math.PI }, { line: 300 }]));
    const pilot = createPilot(rail);
    let lean = 0;
    drive(pilot, rail, 60, (motion) => {
      if (motion.s > 330 && motion.s < 400) lean = Math.min(lean, motion.roll);
      return AUTO;
    }, () => 1 / 60, 'bike');
    // v²/R ≈ 2,8 m/s² : atan(2,8/9,81) ≈ 0,28 rad, vers la gauche (négatif).
    expect(lean).toBeLessThan(-0.2);
    expect(lean).toBeGreaterThan(-0.4);
  });
});

describe('déterminisme', () => {
  it('même parcours, même mouvement ; pas de temps variable : même trajectoire à quelques centimètres', () => {
    const route = makeRoute([{ line: 200 }, { arc: 25, turn: Math.PI / 2 }, { line: 200 }, { arc: 17, turn: -Math.PI }, { line: 300 }]);
    const run = (dt: (i: number) => number) => {
      const rail = createRail(route);
      const pilot = createPilot(rail);
      const trace = drive(pilot, rail, 40, () => AUTO, dt);
      return { s: pilot.motion.s, speed: pilot.motion.speed, steps: trace.steps };
    };
    const a = run(() => 1 / 60);
    const b = run(() => 1 / 60);
    expect(b).toEqual(a);
    // Pas chaotique, de 5 ms à 100 ms (suite fixe, pas de hasard).
    const ragged = run((i) => [0.005, 0.1, 0.033, 0.016, 0.07, 0.011][i % 6]!);
    expect(Math.abs(ragged.s - a.s)).toBeLessThan(0.5);
    expect(Math.abs(ragged.speed - a.speed)).toBeLessThan(0.1);
  });

  it('pas nul ou absurde : rien ne bouge, rien ne casse', () => {
    const rail = createRail(makeRoute([{ line: 200 }]));
    const pilot = createPilot(rail);
    pilot.step(0, AUTO, 'car');
    pilot.step(Number.NaN, AUTO, 'car');
    pilot.step(-1, AUTO, 'car');
    expect(pilot.motion.s).toBe(0);
    pilot.step(10, AUTO, 'car');
    // Borné à 0,1 s.
    expect(pilot.motion.s).toBeLessThan(0.05);
  });

  it('reset : repart d’une abscisse, à l’arrêt, dans sa voie', () => {
    const rail = createRail(makeRoute([{ line: 500 }]));
    const pilot = createPilot(rail);
    drive(pilot, rail, 10, () => AUTO);
    pilot.reset(120);
    expect(pilot.motion).toMatchObject({ s: 120, speed: 0, accel: 0, finished: false, offset: -1.75 });
    pilot.reset(9999);
    expect(pilot.motion.finished).toBe(true);
  });
});

// La vraie carte, si « npm run maps:build » l'a fabriquée (elle n'est pas versionnée).
const REAL = new URL('../../public/assets/maps/plateau-matheysin/route.json', import.meta.url);

describe.skipIf(!existsSync(REAL))('la première carte, de bout en bout', () => {
  it('le pilote automatique roule les 15 km sans dépasser ses plafonds, et s’arrête au bout', () => {
    const route = JSON.parse(readFileSync(REAL, 'utf8')) as MapRoute;
    const rail = createRail(route);
    const pilot = createPilot(rail);
    const pose = createPose();
    let maxLateral = 0;
    let maxUrban = 0;
    let outside = 0;
    let time = 0;
    while (!pilot.motion.finished && time < 3600) {
      const motion = pilot.step(1 / 30, AUTO, 'car');
      time += 1 / 30;
      rail.poseAt(motion.s, pose);
      maxLateral = Math.max(maxLateral, motion.speed * motion.speed * Math.abs(pose.curvature));
      if (pose.urban) maxUrban = Math.max(maxUrban, motion.speed);
      if (Math.abs(motion.offset) > pose.width / 2 - 0.9) outside += 1;
    }
    expect(pilot.motion.finished).toBe(true);
    expect(pilot.motion.s).toBe(rail.length);
    expect(maxLateral).toBeLessThan(PILOT.lateral * 1.2);
    expect(kmh(maxUrban)).toBeLessThan(51);
    expect(outside).toBe(0);
    // 15 km entre 25 et 90 km/h : entre 10 et 25 minutes.
    expect(time).toBeGreaterThan(600);
    expect(time).toBeLessThan(1500);
  });
});
