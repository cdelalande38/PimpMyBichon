// Le rail (§ 5.5, lot 1) : le parcours d'une carte, interrogeable à toute abscisse sans allocation.
//
// - Position : spline de Catmull-Rom uniforme sur les points du rail (pas constant), donc continue
//   et à tangente continue ; la tangente est sa dérivée, normée.
// - Cap et pente se déduisent de la tangente (cap : rotation autour de Y qui amène +X sur la
//   tangente, convention de three.js).
// - Courbure : variation du cap par mètre, calculée une fois sur une base de deux pas puis lissée
//   (noyau triangulaire de ±CURVATURE_SMOOTHING m) ; interpolée linéairement entre deux points.
//   Positive quand la route tourne à gauche, comme le demande le contrat.
// - Parcours ouvert : borné aux deux bouts (au-delà, la pose du bout). Parcours bouclé : l'abscisse
//   est ramenée sur [0, longueur[ ; si le dernier point répète le premier, il n'est compté qu'une fois.

import { MAP_RAIL_STRIDE, type MapRoute, type RailSection } from '../data/mapTypes.ts';
import type { Rail, RailPose, Vec3 } from './contrat.ts';

/** Demi-largeur du noyau de lissage de la courbure, en mètres. */
export const CURVATURE_SMOOTHING = 6;

/** Pose neuve, à remplir par `poseAt` (à allouer une fois, hors de la boucle d'images). */
export function createPose(): RailPose {
  return {
    s: 0,
    position: [0, 0, 0],
    tangent: [1, 0, 0],
    heading: 0,
    pitch: 0,
    curvature: 0,
    ground: 'sol',
    urban: false,
    lanes: 2,
    width: 7,
  };
}

/**
 * Point à `offset` mètres de l'axe, vers la gauche de la marche (négatif : vers la droite), à
 * `height` mètres au-dessus de la chaussée. Écrit dans `out` et le rend.
 */
export function lateralPoint(pose: RailPose, offset: number, height: number, out: Vec3): Vec3 {
  const [tx, , tz] = pose.tangent;
  const flat = Math.hypot(tx, tz) || 1;
  // Gauche de la marche : Y × tangente = (tz, 0, −tx).
  out[0] = pose.position[0] + (tz / flat) * offset;
  out[1] = pose.position[1] + height;
  out[2] = pose.position[2] - (tx / flat) * offset;
  return out;
}

/** Cap (rotation autour de Y) qui amène l'avant +X d'un objet sur la direction (x, z). */
export function headingOf(x: number, z: number): number {
  return Math.atan2(-z, x);
}

function wrapAngle(angle: number): number {
  return angle - 2 * Math.PI * Math.round(angle / (2 * Math.PI));
}

export function createRail(route: MapRoute): Rail {
  const raw = route.rail;
  const total = Math.floor(raw.length / MAP_RAIL_STRIDE);
  if (total < 2) throw new Error('Rail trop court : au moins deux points.');
  const step = route.step;
  const loop = route.loop;
  // Boucle dont le dernier point répète le premier : on ne le compte qu'une fois.
  const closed =
    loop &&
    Math.hypot(raw[0]! - raw[(total - 1) * 3]!, raw[1]! - raw[(total - 1) * 3 + 1]!, raw[2]! - raw[(total - 1) * 3 + 2]!) < step / 2;
  const count = closed ? total - 1 : total;
  const length = loop ? count * step : (count - 1) * step;
  const points = Float64Array.from(raw.slice(0, count * 3));

  /** Coordonnée `axis` du point `i`, rebouclé, ou prolongé en ligne droite au-delà des bouts. */
  function coord(i: number, axis: number): number {
    if (loop) {
      const j = ((i % count) + count) % count;
      return points[j * 3 + axis]!;
    }
    if (i < 0) return 2 * points[axis]! - points[3 + axis]!;
    if (i > count - 1) return 2 * points[(count - 1) * 3 + axis]! - points[(count - 2) * 3 + axis]!;
    return points[i * 3 + axis]!;
  }

  // Cap au point i, sur une base de deux pas (points i−1 et i+1), puis courbure = dcap/ds.
  const headings = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    headings[i] = headingOf(coord(i + 1, 0) - coord(i - 1, 0), coord(i + 1, 2) - coord(i - 1, 2));
  }
  const rawCurvature = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    const before = loop ? headings[(i - 1 + count) % count]! : headings[Math.max(0, i - 1)]!;
    const after = loop ? headings[(i + 1) % count]! : headings[Math.min(count - 1, i + 1)]!;
    const span = loop || (i > 0 && i < count - 1) ? 2 * step : step;
    rawCurvature[i] = wrapAngle(after - before) / span;
  }
  const radius = Math.max(1, Math.round(CURVATURE_SMOOTHING / step));
  const curvature = new Float64Array(count);
  for (let i = 0; i < count; i += 1) {
    let sum = 0;
    let weights = 0;
    for (let k = -radius; k <= radius; k += 1) {
      let j = i + k;
      if (loop) j = ((j % count) + count) % count;
      else if (j < 0 || j > count - 1) continue;
      const w = radius + 1 - Math.abs(k);
      sum += rawCurvature[j]! * w;
      weights += w;
    }
    curvature[i] = sum / weights;
  }

  const sections: readonly RailSection[] = route.sections.length > 0
    ? route.sections
    : [{ from: 0, to: length, ground: 'sol', urban: false, lanes: 2, width: 7 }];
  let lastSection = 0;

  function sectionAt(s: number): RailSection {
    // Les appels se suivent le long de la route : on repart de la dernière section trouvée.
    let i = Math.min(lastSection, sections.length - 1);
    while (i > 0 && s < sections[i]!.from) i -= 1;
    while (i < sections.length - 1 && s >= sections[i]!.to) i += 1;
    lastSection = i;
    return sections[i]!;
  }

  function clampS(s: number): number {
    if (!Number.isFinite(s)) return 0;
    if (loop) return ((s % length) + length) % length;
    return Math.min(length, Math.max(0, s));
  }

  function poseAt(input: number, out: RailPose): RailPose {
    const s = clampS(input);
    const u = s / step;
    let i = Math.floor(u);
    if (!loop && i >= count - 1) i = count - 2;
    const t = u - i;
    const t2 = t * t;
    const t3 = t2 * t;
    let dx = 0;
    let dy = 0;
    let dz = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const p0 = coord(i - 1, axis);
      const p1 = coord(i, axis);
      const p2 = coord(i + 1, axis);
      const p3 = coord(i + 2, axis);
      const a = -p0 + 3 * p1 - 3 * p2 + p3;
      const b = 2 * p0 - 5 * p1 + 4 * p2 - p3;
      const c = -p0 + p2;
      out.position[axis] = 0.5 * (2 * p1 + c * t + b * t2 + a * t3);
      const d = 0.5 * (c + 2 * b * t + 3 * a * t2);
      if (axis === 0) dx = d;
      else if (axis === 1) dy = d;
      else dz = d;
    }
    const norm = Math.hypot(dx, dy, dz) || 1;
    out.tangent[0] = dx / norm;
    out.tangent[1] = dy / norm;
    out.tangent[2] = dz / norm;
    out.heading = headingOf(dx, dz);
    out.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const k0 = curvature[loop ? i % count : i]!;
    const k1 = curvature[loop ? (i + 1) % count : Math.min(count - 1, i + 1)]!;
    out.curvature = k0 + (k1 - k0) * t;
    const section = sectionAt(s);
    out.s = s;
    out.ground = section.ground;
    out.urban = section.urban;
    out.lanes = section.lanes;
    out.width = section.width;
    out.limit = section.speed ?? 0;
    return out;
  }

  return { length, loop, poseAt };
}
