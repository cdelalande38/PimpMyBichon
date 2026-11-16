// Ciel de toit étoilé (§ 5.10 du cahier des charges) : où poser les points lumineux sous le
// plafond, d'après le manifeste du véhicule (cabin.sky). Logique pure, sans three.js : la scène
// (src/scene/GarageCanvas.tsx, CabinLights) en fait un seul maillage instancié.
// Le semis est plus serré au centre, plus épars vers les bords ; les points sont de tailles
// inégales (beaucoup de petits, quelques gros). Sous un pavillon bombé (crown), ils suivent sa
// courbe. Couleur, densité, allumage : choix du build (src/data/habitacle.ts, cabinFor). Le médaillon central est un cercle de points et un
// motif à nous (éclair, flamme), dessiné lui aussi en points, jamais un emblème de constructeur.

import type { SkyMotif, StarrySky } from '../data/vehicleTypes.ts';

/** Un point du ciel : position sous le plafond (repère du véhicule) et rayon, en mètres. */
export interface Star {
  x: number;
  /** Hauteur : celle du centre du semis, plus le bombé du pavillon à cet endroit. */
  y: number;
  z: number;
  radius: number;
}

/**
 * Hauteur d'un point sous un pavillon bombé : le centre du semis au bord, `crown` de plus au milieu
 * (une cloche douce dans la longueur et dans la largeur).
 */
export function skyHeight(sky: Pick<StarrySky, 'center' | 'size' | 'crown'>, x: number, z: number): number {
  const crown = sky.crown ?? 0;
  if (crown === 0) return sky.center[1];
  const u = Math.min(1, Math.abs((x - sky.center[0]) / (sky.size[0] / 2)));
  const v = Math.min(1, Math.abs((z - sky.center[2]) / (sky.size[1] / 2)));
  return sky.center[1] + crown * (1 - u * u) * (1 - v * v);
}

/** Tirage pseudo-aléatoire reproductible (mulberry32) : un même manifeste, un même ciel. */
function random(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Motifs du médaillon, en contours fermés dans un carré de −1 à 1 (x vers la droite, y vers le
 * haut de l'image quand on lève les yeux depuis les sièges avant).
 */
const MOTIFS: Record<SkyMotif, ReadonlyArray<readonly [number, number]>> = {
  eclair: [
    [0.12, 0.92],
    [-0.42, 0.02],
    [-0.04, 0.02],
    [-0.2, -0.92],
    [0.44, 0.12],
    [0.06, 0.12],
    [0.34, 0.92],
  ],
  flamme: [
    [0, -0.9],
    [0.45, -0.6],
    [0.55, -0.1],
    [0.35, 0.3],
    [0.3, 0.05],
    [0.12, 0.5],
    [0.02, 0.92],
    [-0.12, 0.45],
    [-0.3, 0.6],
    [-0.28, 0.2],
    [-0.5, 0.15],
    [-0.55, -0.35],
    [-0.4, -0.7],
  ],
};

/** Points régulièrement espacés de `step` le long d'un contour fermé. */
function alongLoop(loop: ReadonlyArray<readonly [number, number]>, step: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let carry = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const [ax, ay] = loop[i] ?? [0, 0];
    const [bx, by] = loop[(i + 1) % loop.length] ?? [0, 0];
    const length = Math.hypot(bx - ax, by - ay);
    let d = carry;
    while (d < length) {
      out.push([ax + ((bx - ax) * d) / length, ay + ((by - ay) * d) / length]);
      d += step;
    }
    carry = d - length;
  }
  return out;
}

/** Espacement des points du médaillon, en mètres. */
const MEDALLION_STEP = 0.022;
const MEDALLION_DOT = 0.0045;

/** Les points du ciel étoilé d'un manifeste : le semis, puis le médaillon. */
export function starLayout(sky: StarrySky): Star[] {
  const rand = random(sky.seed ?? 1);
  const [cx, , cz] = sky.center;
  const [length, width] = sky.size;
  const medallion = sky.medallion;
  const keepOut = medallion ? medallion.radius * 1.18 : 0;
  const stars: Star[] = [];
  // Semis : tirage uniforme sur le plafond, gardé d'autant moins souvent qu'on s'éloigne du centre.
  for (let tries = 0; stars.length < sky.count && tries < sky.count * 40; tries += 1) {
    const u = rand() * 2 - 1;
    const v = rand() * 2 - 1;
    const keep = 1 - 0.85 * Math.min(1, Math.hypot(u, v) / Math.SQRT2);
    if (rand() > keep) continue;
    const x = cx + (u * length) / 2;
    const z = cz + (v * width) / 2;
    if (keepOut > 0 && Math.hypot(x - cx, z - cz) < keepOut) continue;
    stars.push({ x, y: skyHeight(sky, x, z), z, radius: 0.0022 + rand() ** 3 * 0.0048 });
  }
  if (!medallion) return stars;
  // Médaillon : un cercle de points, et le motif dans les sept dixièmes du cercle. Le haut du motif
  // regarde l'arrière (−X) : il se lit droit quand on lève les yeux depuis les sièges avant.
  const r = medallion.radius;
  const ring = Math.max(12, Math.round((2 * Math.PI * r) / MEDALLION_STEP));
  for (let i = 0; i < ring; i += 1) {
    const a = (2 * Math.PI * i) / ring;
    const x = cx + r * Math.cos(a);
    const z = cz + r * Math.sin(a);
    stars.push({ x, y: skyHeight(sky, x, z), z, radius: MEDALLION_DOT });
  }
  const scale = r * 0.72;
  for (const [mx, my] of alongLoop(MOTIFS[medallion.motif], MEDALLION_STEP / scale)) {
    const x = cx - my * scale;
    const z = cz + mx * scale;
    stars.push({ x, y: skyHeight(sky, x, z), z, radius: MEDALLION_DOT });
  }
  return stars;
}
