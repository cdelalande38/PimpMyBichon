// Le rail de la sortie (src/drive/rail.ts) : pose interpolée sans à-coup, cap, pente, courbure
// signée, sections, bornes d'un parcours ouvert et rebouclage d'un parcours fermé.
import { describe, expect, it } from 'vitest';
import type { MapRoute, RailSection } from '../../src/data/mapTypes.ts';
import { createPose, createRail, headingOf, lateralPoint } from '../../src/drive/rail.ts';

type Segment = { line: number } | { arc: number; turn: number };

/** Route de synthèse : lignes droites et arcs (rayon, angle en radians, positif à gauche), pas de 2 m. */
function makeRoute(segments: Segment[], options: { loop?: boolean; climb?: number; sections?: RailSection[] } = {}): MapRoute {
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
        rail.push(x, travelled * (options.climb ?? 0), z);
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
    starts: [{ id: 'depart', label: 'Départ', at: 0 }],
    far: null,
  };
}

describe('rail', () => {
  it('ligne droite vers l’est : cap nul, courbure nulle, position exacte', () => {
    const rail = createRail(makeRoute([{ line: 200 }]));
    const pose = rail.poseAt(101, createPose());
    expect(pose.position[0]).toBeCloseTo(101, 1);
    expect(pose.position[2]).toBeCloseTo(0, 3);
    expect(pose.heading).toBeCloseTo(0, 4);
    expect(pose.curvature).toBeCloseTo(0, 4);
    expect(pose.tangent[0]).toBeCloseTo(1, 4);
  });

  it('cap : l’avant +X du véhicule, tourné de `heading` autour de Y, suit la tangente', () => {
    // Vers le nord (−Z) : quart de tour à gauche.
    expect(headingOf(0, -1)).toBeCloseTo(Math.PI / 2, 6);
    const rail = createRail(makeRoute([{ line: 50 }, { arc: 40, turn: Math.PI / 2 }, { line: 50 }]));
    const pose = rail.poseAt(rail.length - 10, createPose());
    expect(pose.heading).toBeCloseTo(Math.PI / 2, 1);
    const [tx, , tz] = pose.tangent;
    // Rotation de +X autour de Y d'un angle h : (cos h, 0, −sin h).
    expect(Math.cos(pose.heading)).toBeCloseTo(tx, 3);
    expect(-Math.sin(pose.heading)).toBeCloseTo(tz, 3);
  });

  it('courbure signée : positive à gauche, négative à droite, proche de 1/R au milieu de l’arc', () => {
    const left = createRail(makeRoute([{ line: 60 }, { arc: 30, turn: Math.PI }, { line: 60 }]));
    const right = createRail(makeRoute([{ line: 60 }, { arc: 30, turn: -Math.PI }, { line: 60 }]));
    const middle = 60 + (Math.PI * 30) / 2;
    expect(left.poseAt(middle, createPose()).curvature).toBeCloseTo(1 / 30, 3);
    expect(right.poseAt(middle, createPose()).curvature).toBeCloseTo(-1 / 30, 3);
    expect(left.poseAt(20, createPose()).curvature).toBeCloseTo(0, 4);
  });

  it('pente positive en montée', () => {
    const rail = createRail(makeRoute([{ line: 100 }], { climb: 0.12 }));
    expect(rail.poseAt(50, createPose()).pitch).toBeCloseTo(Math.atan(0.12 / Math.sqrt(1 - 0.12 * 0.12)), 2);
  });

  it('sans à-coup : position et tangente continues, aucun saut entre deux abscisses voisines', () => {
    const rail = createRail(makeRoute([{ line: 40 }, { arc: 17, turn: 1.5 * Math.PI }, { line: 40 }, { arc: 25, turn: -Math.PI / 2 }]));
    const a = createPose();
    const b = createPose();
    let worstPosition = 0;
    let worstTangent = 0;
    let worstCurvature = 0;
    for (let s = 0; s < rail.length - 0.1; s += 0.1) {
      rail.poseAt(s, a);
      rail.poseAt(s + 0.1, b);
      worstPosition = Math.max(worstPosition, Math.hypot(b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]));
      worstTangent = Math.max(worstTangent, Math.hypot(b.tangent[0] - a.tangent[0], b.tangent[1] - a.tangent[1], b.tangent[2] - a.tangent[2]));
      worstCurvature = Math.max(worstCurvature, Math.abs(b.curvature - a.curvature));
    }
    // 10 cm d'abscisse : 10 cm de route au plus, la tangente tourne d'à peine plus de 0,1/17 rad (la spline
    // arrondit l'entrée des arcs).
    expect(worstPosition).toBeLessThan(0.102);
    expect(worstTangent).toBeLessThan(0.01);
    expect(worstCurvature).toBeLessThan(0.002);
  });

  it('parcours ouvert : borné aux deux bouts', () => {
    const route = makeRoute([{ line: 100 }]);
    const rail = createRail(route);
    expect(rail.loop).toBe(false);
    expect(rail.length).toBe(route.length);
    const before = rail.poseAt(-50, createPose());
    const after = rail.poseAt(rail.length + 50, createPose());
    expect(before.s).toBe(0);
    expect(before.position[0]).toBeCloseTo(0, 6);
    expect(after.s).toBe(rail.length);
    expect(after.position[0]).toBeCloseTo(route.rail[route.rail.length - 3]!, 6);
    expect(rail.poseAt(Number.NaN, createPose()).s).toBe(0);
  });

  it('parcours bouclé : l’abscisse est rebouclée, la jonction est continue', () => {
    // Cercle complet de 50 m de rayon : le dernier point rejoint le premier.
    const route = makeRoute([{ arc: 50, turn: 2 * Math.PI }], { loop: true });
    const rail = createRail(route);
    expect(rail.loop).toBe(true);
    const a = rail.poseAt(rail.length - 0.05, createPose());
    const b = rail.poseAt(rail.length + 0.05, createPose());
    expect(b.s).toBeCloseTo(0.05, 6);
    expect(Math.hypot(b.position[0] - a.position[0], b.position[2] - a.position[2])).toBeLessThan(0.2);
    expect(rail.poseAt(-10, createPose()).s).toBeCloseTo(rail.length - 10, 6);
    expect(rail.poseAt(rail.length / 2, createPose()).curvature).toBeCloseTo(1 / 50, 3);
  });

  it('sections : la section sous les roues, dans les deux sens de parcours', () => {
    const sections: RailSection[] = [
      { from: 0, to: 40, ground: 'sol', urban: true, lanes: 2, width: 7 },
      { from: 40, to: 60, ground: 'pont', urban: false, lanes: 1, width: 3.5 },
      { from: 60, to: 100, ground: 'tunnel', urban: false, lanes: 2, width: 8 },
    ];
    const rail = createRail(makeRoute([{ line: 100 }], { sections }));
    const pose = createPose();
    expect(rail.poseAt(10, pose).urban).toBe(true);
    expect(rail.poseAt(50, pose).ground).toBe('pont');
    expect(pose.width).toBe(3.5);
    expect(rail.poseAt(99, pose).ground).toBe('tunnel');
    expect(rail.poseAt(45, pose).lanes).toBe(1);
    expect(rail.poseAt(5, pose).ground).toBe('sol');
  });

  it('remplit la pose donnée sans en créer d’autre', () => {
    const rail = createRail(makeRoute([{ line: 100 }]));
    const pose = createPose();
    const position = pose.position;
    expect(rail.poseAt(10, pose)).toBe(pose);
    expect(pose.position).toBe(position);
  });

  it('point latéral : positif vers la gauche de la marche', () => {
    const rail = createRail(makeRoute([{ line: 100 }]));
    const pose = rail.poseAt(10, createPose());
    const out: [number, number, number] = [0, 0, 0];
    lateralPoint(pose, 2, 1, out);
    // Vers l'est, la gauche est le nord (−Z).
    expect(out[2]).toBeCloseTo(-2, 4);
    expect(out[1]).toBeCloseTo(1, 4);
  });
});
