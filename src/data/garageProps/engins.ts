// Mobilier du garage, famille « engins » (cahier de remodelage, § 2.3 et § 5) : quad, moto
// sportive, moto en pièces, bloc moteur. Formes : src/data/garageShapes.ts ; cotes et
// matériaux : src/data/garageBase.ts. Aucun import d'une autre famille.
// Interdits (§ 6) : aucun nom ni logo de constructeur, d'équipementier, de sponsor, d'émission ou
// de jeu vidéo, ni dans un nom de variable ; aucun personnage existant ; aucun motif imitant une
// plaque d'immatriculation ; aucune photo ni police. Chaque objet reste un substitut placeholder_*,
// listé dans TODO_ASSETS.md.
// Repère local des engins : nez vers +x, plan de symétrie z = 0, origine au sol au milieu de
// l'empattement (le bloc moteur : longueur selon x, cornets vers +z).

import { BACK, type Part, type Prop, type Vec3 } from '../garageBase.ts';
import type { Vec2 } from '../garageShapes.ts';

const SIDES = [-1, 1] as const;
/** Pas d'arc d'un congé de contour : sous l'angle d'arête franche de shapes.ts (40°). */
const FILLET_STEP = 0.5;
/** Sous ce virage (radians), un sommet de contour est déjà lisse : pas de congé. */
const FILLET_MIN_TURN = 0.6;

/**
 * Contour aux coins arrondis : chaque sommet qui tourne de plus de FILLET_MIN_TURN devient un arc
 * de rayon `radius` (réduit si les côtés voisins sont courts), par pas de `step` radians au plus.
 * Sens du contour conservé.
 */
function fillet(points: readonly Vec2[], radius: number, step = FILLET_STEP): Vec2[] {
  const out: Vec2[] = [];
  const n = points.length;
  points.forEach((p, i) => {
    const a = points[(i + n - 1) % n]!;
    const b = points[(i + 1) % n]!;
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]);
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    const da = [(a[0] - p[0]) / la, (a[1] - p[1]) / la] as const;
    const db = [(b[0] - p[0]) / lb, (b[1] - p[1]) / lb] as const;
    const inner = Math.acos(Math.max(-1, Math.min(1, da[0] * db[0] + da[1] * db[1])));
    const turn = Math.PI - inner;
    if (turn < FILLET_MIN_TURN) {
      out.push(p);
      return;
    }
    const t = Math.min(radius / Math.tan(inner / 2), 0.45 * la, 0.45 * lb);
    const r = t * Math.tan(inner / 2);
    const bx = da[0] + db[0];
    const by = da[1] + db[1];
    const bl = Math.hypot(bx, by);
    const c = [p[0] + (bx / bl) * (r / Math.sin(inner / 2)), p[1] + (by / bl) * (r / Math.sin(inner / 2))] as const;
    const a0 = Math.atan2(p[1] + da[1] * t - c[1], p[0] + da[0] * t - c[0]);
    let delta = Math.atan2(p[1] + db[1] * t - c[1], p[0] + db[0] * t - c[0]) - a0;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(delta) / step));
    for (let k = 0; k <= steps; k += 1) out.push([c[0] + r * Math.cos(a0 + (delta * k) / steps), c[1] + r * Math.sin(a0 + (delta * k) / steps)]);
  });
  return out;
}

/** Rectangle centré (contour à arrondir ensuite par fillet). */
const rectContour = (w: number, h: number): Vec2[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/** Points d'un arc de cercle (centre, rayon, angles de départ et d'arrivée, pas maximal). */
function arc(cx: number, cy: number, r: number, from: number, to: number, step = 0.4): Vec2[] {
  const steps = Math.max(1, Math.ceil(Math.abs(to - from) / step));
  return Array.from({ length: steps + 1 }, (_, k): Vec2 => [cx + r * Math.cos(from + ((to - from) * k) / steps), cy + r * Math.sin(from + ((to - from) * k) / steps)]);
}

/** Profil d'un flanc à l'autre (rayon, hauteur), à l'échelle 1 en largeur ; `w` étire la hauteur. */
const scaleProfile = (profile: readonly Vec2[], w: number): Vec2[] => profile.map(([r, h]) => [r, h * w]);

/** Ressort d'amortisseur : profil en dents (spires) autour d'une tige, de y = -length/2 à +length/2. */
function coilProfile(radius: number, wire: number, length: number, turns: number): Vec2[] {
  const points: Vec2[] = [];
  for (let k = 0; k <= turns * 2; k += 1) points.push([k % 2 === 0 ? radius - wire : radius, -length / 2 + (k * length) / (turns * 2)]);
  return points;
}

// ——— Quad ———————————————————————————————————————————————————————————————————————
// Quad de loisir de 1,80 × 1,10 m (empattement 1,14 m). Chaque flanc est d'un seul tenant :
// garde-boue avant, marchepied, garde-boue arrière. Entre les flancs, capot, caisse et réservoir
// ferment le milieu ; la selle est posée sur la caisse ; pare-chocs, porte-bagages, bras et
// amortisseurs entrent dans la carrosserie ou s'y posent : rien ne flotte.
/** Demi-empattement (centres des roues en x) et rayon des pneus. */
const QUAD_AXLE_X = 0.57;
const QUAD_TYRE_R = 0.29;
/** Centres des pneus en z et demi-largeurs : l'arrière plus large (bords extérieurs 0,53 et 0,55). */
const QUAD_FRONT_Z = 0.43;
const QUAD_FRONT_HALF = 0.1;
const QUAD_REAR_Z = 0.425;
const QUAD_REAR_HALF = 0.125;
/** Pneu ballon (rayon ; hauteur pour une demi-largeur de 1) : talon, flanc bombé, bande plate. */
const BALLOON: Vec2[] = [
  [0.16, -0.875],
  [0.225, -1],
  [0.27, -0.85],
  [0.29, -0.42],
  [0.29, 0.42],
  [0.27, 0.85],
  [0.225, 1],
  [0.16, 0.875],
];
/** Voile de jante vu de l'extérieur (rayon ; hauteur depuis la face), creusé, moyeu en saillie. */
const RIM: Vec2[] = [
  [0.16, -0.2],
  [0.16, -0.03],
  [0.148, -0.018],
  [0.075, -0.035],
  [0.055, -0.01],
  [0, -0.01],
];

/** Roue de quad : pneu ballon tourné et jante alu à voile creusé (seule la face extérieure se voit). */
function quadWheel(x: number, z: number, half: number): Part[] {
  const side = Math.sign(z);
  return [
    { lathe: scaleProfile(BALLOON, half), axis: 'z', at: [x, QUAD_TYRE_R, z], material: 'gomme' },
    { lathe: RIM.map(([r, h]): Vec2 => [r, half + h]), axis: 'z', detail: 0.8, at: [x, QUAD_TYRE_R, z], rot: [side > 0 ? 0 : Math.PI, 0, 0], material: 'alu' },
  ];
}

/** Rayon des arches au-dessus des pneus (4,5 cm de jour) ; flanc : centre et épaisseur en z (0,29 → 0,55). */
const QUAD_ARCH_R = 0.335;
const QUAD_SIDE_Z = 0.42;
const QUAD_SIDE_DEPTH = 0.26;
/** Demi-largeur du milieu (capot, caisse) : il touche le bord intérieur des flancs. */
const QUAD_MID_HALF = 0.29;

/**
 * Flanc vu de côté (x ; y) : arche arrière, mur du talon, marchepied (dessus à 0,34), mur avant, arche
 * avant, nez ; puis le dessus, du nez à la poupe. Dessus des garde-boue à 0,675 : sous les consoles
 * du retour d'établi (0,69), qui tombent au-dessus du garde-boue arrière côté mur.
 */
function quadSide(): Vec2[] {
  const archFrom = (155 * Math.PI) / 180;
  const archTo = (25 * Math.PI) / 180;
  return fillet(
    [
      [-0.885, 0.49],
      ...arc(-QUAD_AXLE_X, QUAD_TYRE_R, QUAD_ARCH_R, archFrom, archTo),
      [-0.25, 0.28],
      [0.25, 0.28],
      ...arc(QUAD_AXLE_X, QUAD_TYRE_R, QUAD_ARCH_R, archFrom, archTo),
      [0.895, 0.49],
      [0.888, 0.555],
      [0.8, 0.62],
      [0.6, 0.665],
      [0.42, 0.678],
      [0.32, 0.65],
      [0.21, 0.42],
      [0.18, 0.34],
      [-0.18, 0.34],
      [-0.21, 0.42],
      [-0.3, 0.62],
      [-0.4, 0.672],
      [-0.62, 0.676],
      [-0.845, 0.672],
      [-0.893, 0.6],
    ],
    0.04,
    0.65,
  );
}

/** Capot (x ; y) : du nez, où se logent les phares, jusqu'au réservoir. */
const QUAD_HOOD: Vec2[] = [
  [0.3, 0.47],
  [0.84, 0.45],
  [0.895, 0.5],
  [0.885, 0.585],
  [0.78, 0.65],
  [0.55, 0.695],
  [0.34, 0.72],
  [0.3, 0.7],
];
/** Caisse sous la selle (x ; y) : dessus à 0,705, plus bas derrière la selle sous le porte-bagages. */
const QUAD_BODY: Vec2[] = [
  [0.33, 0.46],
  [0.33, 0.705],
  [-0.56, 0.705],
  [-0.6, 0.664],
  [-0.86, 0.664],
  [-0.89, 0.63],
  [-0.89, 0.52],
  [-0.6, 0.5],
  [-0.25, 0.46],
];
/** Réservoir (x ; y) : entre le capot et la selle, dessus dans le prolongement de la selle. */
const QUAD_TANK: Vec2[] = [
  [0.0, 0.7],
  [0.35, 0.7],
  [0.37, 0.735],
  [0.31, 0.795],
  [0.18, 0.835],
  [0.05, 0.835],
  [0.0, 0.79],
];
/** Selle (x ; y) : longue, posée sur la caisse (dessous à 0,705), le nez contre le réservoir. */
const QUAD_SEAT: Vec2[] = [
  [0.05, 0.705],
  [-0.56, 0.705],
  [-0.58, 0.76],
  [-0.53, 0.82],
  [-0.3, 0.835],
  [-0.03, 0.835],
  [0.04, 0.805],
];
/** Colonne de direction carénée, de la pointe du réservoir au cache-guidon (x ; y). */
const QUAD_COWL_FROM: Vec2 = [0.36, 0.72];
const QUAD_COWL_TO: Vec2 = [0.295, 1.02];

/** Amortisseur avant : ressort rouge sur tige chrome, du bras à la carrosserie, incliné vers l'axe. */
function quadShock(side: -1 | 1): Part[] {
  const at: Vec3 = [QUAD_AXLE_X - 0.02, 0.4, side * 0.24];
  const rot: Vec3 = [-side * 0.5, 0, 0];
  return [
    { lathe: coilProfile(0.03, 0.008, 0.16, 2), at, rot, material: 'rouge' },
    { cylinder: [0.011, 0.26], top: 0.011, at, rot, material: 'chrome' },
  ];
}

/** Porte-bagages arrière : cadre et traverses posés sur les garde-boue (dessus à 0,675). */
const QUAD_RACK_Y = 0.686;
const QUAD_RACK_X: Vec2 = [-0.83, -0.6];
const QUAD_RACK_Z = 0.4;

const QUAD: Part[] = [
  ...SIDES.map((s) => quadWheel(QUAD_AXLE_X, s * QUAD_FRONT_Z, QUAD_FRONT_HALF)).flat(),
  ...SIDES.map((s) => quadWheel(-QUAD_AXLE_X, s * QUAD_REAR_Z, QUAD_REAR_HALF)).flat(),
  // Flancs d'un seul tenant, capot, caisse, réservoir : plastique noir brillant.
  ...SIDES.map((s): Part => ({ extrude: quadSide(), depth: QUAD_SIDE_DEPTH, bevel: 0.015, at: [0, 0, s * QUAD_SIDE_Z], material: 'laqueNoir' })),
  { extrude: fillet(QUAD_HOOD, 0.04, 0.65), depth: 2 * QUAD_MID_HALF, bevel: 0.015, at: [0, 0, 0], material: 'laqueNoir' },
  { extrude: fillet(QUAD_BODY, 0.03, 0.65), depth: 2 * QUAD_MID_HALF, bevel: 0.015, at: [0, 0, 0], material: 'laqueNoir' },
  { extrude: fillet(QUAD_TANK, 0.05, 0.65), depth: 0.36, bevel: 0.04, at: [0, 0, 0], material: 'laqueNoir' },
  { extrude: fillet(QUAD_SEAT, 0.035), depth: 0.3, bevel: 0.035, at: [0, 0, 0], material: 'noirMat' },
  // Deux phares ronds chromés dans le nez du capot.
  ...SIDES.flatMap((s): Part[] => [
    { cylinder: [0.042, 0.03], top: 0.042, axis: 'x', at: [0.888, 0.542, s * 0.15], material: 'chrome' },
    { cylinder: [0.033, 0.006], top: 0.033, axis: 'x', at: [0.904, 0.542, s * 0.15], material: 'optique' },
  ]),
  // Direction : colonne carénée, cache-guidon, guidon large, poignées.
  {
    cylinder: [0.07, Math.hypot(QUAD_COWL_TO[0] - QUAD_COWL_FROM[0], QUAD_COWL_TO[1] - QUAD_COWL_FROM[1])],
    top: 0.036,
    at: [(QUAD_COWL_FROM[0] + QUAD_COWL_TO[0]) / 2, (QUAD_COWL_FROM[1] + QUAD_COWL_TO[1]) / 2, 0],
    rot: [0, 0, Math.atan2(QUAD_COWL_FROM[0] - QUAD_COWL_TO[0], QUAD_COWL_TO[1] - QUAD_COWL_FROM[1])],
    material: 'laqueNoir',
  },
  { box: [0.11, 0.07, 0.2], bevel: 0.015, at: [0.285, 1.04, 0], rot: [0, 0, 0.2], material: 'laqueNoir' },
  {
    tube: [
      [0.26, 1.055, -0.4],
      [0.26, 1.055, -0.25],
      [0.285, 1.063, -0.12],
      [0.285, 1.063, 0.12],
      [0.26, 1.055, 0.25],
      [0.26, 1.055, 0.4],
    ],
    radius: 0.012,
    at: [0, 0, 0],
    material: 'chrome',
  },
  ...SIDES.map((s): Part => ({ capsule: [0.02, 0.13], axis: 'z', detail: 0.6, at: [0.26, 1.055, s * 0.335], material: 'gomme' })),
  // Mécanique : moteur et carter, longeron avant, bras avant, amortisseurs, bras oscillant, essieu.
  { box: [0.52, 0.2, 0.38], bevel: 0.015, at: [-0.01, 0.38, 0], material: 'noir' },
  { cylinder: [0.07, 0.03], top: 0.07, axis: 'z', at: [0.06, 0.39, -0.205], material: 'alu' },
  { box: [0.62, 0.06, 0.22], bevel: 0.015, at: [0.53, 0.32, 0], material: 'noir' },
  ...SIDES.map(
    (s): Part => ({
      tube: [
        [0.45, 0.31, s * 0.1],
        [QUAD_AXLE_X, QUAD_TYRE_R, s * 0.33],
        [0.69, 0.31, s * 0.1],
      ],
      radius: 0.012,
      at: [0, 0, 0],
      material: 'noir',
    }),
  ),
  ...SIDES.flatMap(quadShock),
  { box: [0.4, 0.06, 0.16], bevel: 0.015, at: [-0.38, 0.3, 0], material: 'noir' },
  { cylinder: [0.03, 2 * QUAD_REAR_Z], top: 0.03, axis: 'z', at: [-QUAD_AXLE_X, QUAD_TYRE_R, 0], material: 'noir' },
  // Pare-chocs avant et arrière : leurs pattes entrent dans le capot et dans la caisse.
  {
    tube: [
      [0.8, 0.5, -0.21],
      [0.885, 0.42, -0.21],
      [0.885, 0.42, 0.21],
      [0.8, 0.5, 0.21],
    ],
    radius: 0.015,
    smooth: true,
    detail: 0.6,
    at: [0, 0, 0],
    material: 'noir',
  },
  {
    tube: [
      [-0.78, 0.55, -0.25],
      [-0.875, 0.43, -0.25],
      [-0.875, 0.43, 0.25],
      [-0.78, 0.55, 0.25],
    ],
    radius: 0.014,
    detail: 0.6,
    at: [0, 0, 0],
    material: 'noir',
  },
  // Porte-bagages posé sur les garde-boue arrière, feu rouge, pot côté pièce.
  {
    tube: [
      [QUAD_RACK_X[1], QUAD_RACK_Y, -QUAD_RACK_Z],
      [QUAD_RACK_X[0], QUAD_RACK_Y, -QUAD_RACK_Z],
      [QUAD_RACK_X[0], QUAD_RACK_Y, QUAD_RACK_Z],
      [QUAD_RACK_X[1], QUAD_RACK_Y, QUAD_RACK_Z],
    ],
    radius: 0.011,
    closed: true,
    detail: 0.5,
    at: [0, 0, 0],
    material: 'noir',
  },
  ...[-0.69, -0.76].map((x): Part => ({ cylinder: [0.008, 2 * QUAD_RACK_Z], top: 0.008, axis: 'z', at: [x, QUAD_RACK_Y, 0], material: 'noir' })),
  { cylinder: [0.028, 0.012], top: 0.028, axis: 'x', at: [-0.895, 0.585, 0], material: 'rouge' },
  { capsule: [0.035, 0.28], axis: 'x', detail: 0.7, at: [-0.72, 0.485, -0.17], rot: [0, 0, -0.12], material: 'chrome' },
];

// ——— Moto sportive ————————————————————————————————————————————————————————————————
/** Centres des roues (x) et rayon commun ; demi-largeur des pneus, l'arrière plus large. */
const SPORT_FRONT_X = 0.7;
const SPORT_REAR_X = -0.68;
const SPORT_WHEEL_R = 0.3;
const SPORT_FRONT_HALF = 0.06;
const SPORT_REAR_HALF = 0.08;
/** Pneu de moto (rayon ; hauteur pour une demi-largeur de 1) : bande de roulement ronde. */
const SPORT_TYRE: Vec2[] = [
  [0.212, -0.8],
  [0.242, -1],
  [0.272, -0.85],
  [0.292, -0.5],
  [0.3, 0],
  [0.292, 0.5],
  [0.272, 0.85],
  [0.242, 1],
  [0.212, 0.8],
];
/** Jante : section bouclée du bord (rayon ; hauteur), et rayon du moyeu. */
const SPORT_RIM_IN = 0.188;
const SPORT_RIM_OUT = 0.214;
const SPORT_HUB_R = 0.036;
const SPORT_SPOKES = 5;

/** Roue de sportive : pneu tourné, bord de jante rouge, cinq bâtons, moyeu alu. */
function sportWheel(x: number, half: number): Part[] {
  const at: Vec3 = [x, SPORT_WHEEL_R, 0];
  const rim = half - 0.012;
  const spokeLength = SPORT_RIM_IN - SPORT_HUB_R + 0.02;
  const spokeMid = (SPORT_RIM_IN + SPORT_HUB_R) / 2;
  return [
    { lathe: scaleProfile(SPORT_TYRE, half), axis: 'z', at, material: 'gomme' },
    {
      lathe: [
        [SPORT_RIM_IN, -rim],
        [SPORT_RIM_OUT, -rim],
        [SPORT_RIM_OUT, rim],
        [SPORT_RIM_IN, rim],
        [SPORT_RIM_IN, -rim],
      ],
      axis: 'z',
      at,
      material: 'rouge',
    },
    ...Array.from({ length: SPORT_SPOKES }, (_, k): Part => {
      const a = (k * 2 * Math.PI) / SPORT_SPOKES;
      return { capsule: [0.012, spokeLength], detail: 0.5, at: [x - spokeMid * Math.sin(a), SPORT_WHEEL_R + spokeMid * Math.cos(a), 0], rot: [0, 0, a], material: 'rouge' };
    }),
    { cylinder: [SPORT_HUB_R, 2 * half + 0.02], top: SPORT_HUB_R, axis: 'z', at, material: 'alu' },
  ];
}

/** Inclinaison de la fourche (radians, haut vers l'arrière) et longueur de l'axe au té. */
const SPORT_RAKE = 0.35;
const SPORT_FORK_LENGTH = 0.7;
/** Point de la fourche à `d` mètres de l'axe de roue avant, le long de la fourche. */
const forkPoint = (d: number, z: number): Vec3 => [SPORT_FRONT_X - d * Math.sin(SPORT_RAKE), SPORT_WHEEL_R + d * Math.cos(SPORT_RAKE), z];
/** Pivot du bras oscillant et tête de fourche (x ; y) : le cadre les relie. */
const SPORT_PIVOT: Vec2 = [-0.12, 0.5];
const SPORT_HEAD: Vec2 = [0.45, 0.92];

/** Poutre plate (cadre, bras) d'un point à l'autre, à la cote z, section h × t. */
function beam(from: Vec2, to: Vec2, z: number, h: number, t: number, material: Part['material']): Part {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  return {
    box: [length, h, t],
    bevel: 0.01,
    at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, z],
    rot: [0, 0, Math.atan2(to[1] - from[1], to[0] - from[0])],
    material,
  };
}

/** Haut du carénage, de la bulle aux flancs (x ; y) : il s'ouvre derrière sur le cadre et le moteur. */
const SPORT_UPPER: Vec2[] = [
  [0.78, 0.72],
  [0.8, 1.0],
  [0.6, 1.02],
  [0.36, 0.93],
  [0.28, 0.74],
  [0.36, 0.55],
  [0.6, 0.66],
];
/** Bas de carénage sous le moteur (x ; y), dégagé de la roue avant. */
const SPORT_LOWER: Vec2[] = [
  [0.41, 0.56],
  [0.39, 0.34],
  [0.05, 0.31],
  [-0.08, 0.4],
  [0.0, 0.5],
  [0.28, 0.52],
];
/** Nez effilé (x ; y), plus étroit que le carénage, qui en sort comme un museau. */
const SPORT_NOSE: Vec2[] = [
  [0.7, 0.72],
  [0.88, 0.74],
  [0.99, 0.85],
  [0.96, 0.95],
  [0.84, 1.03],
  [0.7, 1.02],
];
/** Bulle fumée (x ; y). */
const SPORT_SCREEN: Vec2[] = [
  [0.82, 1.0],
  [0.6, 1.16],
  [0.55, 1.1],
  [0.66, 1.0],
];
/** Ouïe sur le flanc du carénage (x ; y), en léger relief. */
const SPORT_VENT: Vec2[] = [
  [0.37, 0.62],
  [0.53, 0.67],
  [0.62, 0.83],
  [0.45, 0.77],
];
/** Réservoir (x ; y) : bosse entre tête de fourche et selle. */
const SPORT_TANK: Vec2[] = [
  [-0.02, 0.86],
  [0.42, 0.9],
  [0.47, 0.96],
  [0.38, 1.06],
  [0.18, 1.1],
  [0.0, 1.05],
  [-0.06, 0.95],
];
/** Selle pilote (x ; y). */
const SPORT_SEAT: Vec2[] = [
  [-0.04, 0.88],
  [-0.42, 0.91],
  [-0.44, 0.955],
  [-0.06, 0.935],
];
/** Coque arrière effilée et relevée (x ; y). */
const SPORT_TAIL: Vec2[] = [
  [-0.05, 0.84],
  [-0.85, 1.0],
  [-0.95, 0.97],
  [-0.7, 0.84],
  [-0.12, 0.72],
];

const SPORT: Part[] = [
  ...sportWheel(SPORT_FRONT_X, SPORT_FRONT_HALF),
  ...sportWheel(SPORT_REAR_X, SPORT_REAR_HALF),
  // Freins : deux disques et étriers rouges à l'avant, un disque côté pièce à l'arrière.
  ...SIDES.flatMap((s): Part[] => [
    { cylinder: [0.15, 0.006], top: 0.15, axis: 'z', at: [SPORT_FRONT_X, SPORT_WHEEL_R, s * 0.075], material: 'alu' },
    { capsule: [0.024, 0.09], detail: 0.5, at: [SPORT_FRONT_X - 0.1, SPORT_WHEEL_R + 0.08, s * 0.088], rot: [0, 0, 0.9], material: 'rouge' },
  ]),
  { cylinder: [0.11, 0.006], top: 0.11, axis: 'z', at: [SPORT_REAR_X, SPORT_WHEEL_R, 0.092], material: 'alu' },
  // Fourche : fourreaux noirs, tubes chromés, té ; garde-boue avant en arc.
  ...SIDES.flatMap((s): Part[] => [
    { cylinder: [0.028, 0.36], at: forkPoint(0.18, s * 0.1), rot: [0, 0, SPORT_RAKE], material: 'noir' },
    { cylinder: [0.022, 0.36], at: forkPoint(0.52, s * 0.1), rot: [0, 0, SPORT_RAKE], material: 'chrome' },
  ]),
  { box: [0.08, 0.04, 0.26], bevel: 0.01, at: forkPoint(SPORT_FORK_LENGTH, 0), rot: [0, 0, SPORT_RAKE], material: 'alu' },
  {
    lathe: [
      [0.315, -0.07],
      [0.335, -0.065],
      [0.338, 0],
      [0.335, 0.065],
      [0.315, 0.07],
      [0.315, -0.07],
    ],
    axis: 'z',
    arc: 1.5,
    at: [SPORT_FRONT_X, SPORT_WHEEL_R, 0],
    rot: [0, 0, Math.PI / 2 + 0.7],
    material: 'laqueNoir',
  },
  // Cadre périmétrique et bras oscillant en poutres alu ; moteur et couvercle d'embrayage.
  ...SIDES.map((s) => beam(SPORT_PIVOT, SPORT_HEAD, s * 0.122, 0.08, 0.04, 'alu')),
  ...SIDES.map((s) => beam([SPORT_REAR_X, SPORT_WHEEL_R], SPORT_PIVOT, s * 0.11, 0.075, 0.035, 'alu')),
  { box: [0.4, 0.3, 0.24], bevel: 0.015, at: [0.13, 0.55, 0], material: 'noir' },
  { cylinder: [0.085, 0.03], top: 0.085, axis: 'z', at: [0.02, 0.47, 0.13], material: 'alu' },
  // Carénage, nez, bulle, réservoir, selle, coque arrière.
  { extrude: fillet(SPORT_UPPER, 0.05), depth: 0.3, bevel: 0.04, at: [0, 0, 0], material: 'laqueNoir' },
  { extrude: fillet(SPORT_LOWER, 0.05), depth: 0.28, bevel: 0.04, at: [0, 0, 0], material: 'laqueNoir' },
  { extrude: fillet(SPORT_NOSE, 0.04), depth: 0.22, bevel: 0.07, at: [0, 0, 0], material: 'laqueNoir' },
  { extrude: fillet(SPORT_SCREEN, 0.02), depth: 0.24, bevel: 0.01, at: [0, 0, 0], material: 'planDeTravail' },
  ...SIDES.map((s): Part => ({ extrude: fillet(SPORT_VENT, 0.02), depth: 0.012, bevel: 0.004, at: [0, 0, s * 0.151], material: 'noir' })),
  { extrude: fillet(SPORT_TANK, 0.06), depth: 0.34, bevel: 0.07, at: [0, 0, 0], material: 'laqueNoir' },
  { cylinder: [0.032, 0.012], top: 0.032, at: [0.24, 1.095, 0], rot: [0, 0, -0.15], material: 'alu' },
  { extrude: fillet(SPORT_SEAT, 0.015), depth: 0.24, bevel: 0.02, at: [0, 0, 0], material: 'noirMat' },
  { extrude: fillet(SPORT_TAIL, 0.03), depth: 0.19, bevel: 0.06, at: [0, 0, 0], material: 'laqueNoir' },
  // Feu arrière en barrette, à moitié noyé dans la pointe de la coque (bout à x -0,918).
  { capsule: [0.016, 0.1], axis: 'z', detail: 0.5, at: [-0.912, 0.962, 0], material: 'rouge' },
  // Double optique effilée sur le nez.
  ...SIDES.map((s): Part => ({ capsule: [0.018, 0.11], axis: 'x', detail: 0.5, at: [0.942, 0.79, s * 0.055], rot: [0, -s * 0.3, Math.PI / 4], material: 'chrome' })),
  // Guidons bracelets, rétroviseurs, repose-pieds, silencieux côté pièce.
  ...SIDES.flatMap((s): Part[] => [
    {
      tube: [forkPoint(SPORT_FORK_LENGTH - 0.05, s * 0.1), [0.38, 0.93, s * 0.22]],
      radius: 0.012,
      at: [0, 0, 0],
      material: 'noir',
    },
    { capsule: [0.017, 0.11], axis: 'z', detail: 0.6, at: [0.375, 0.928, s * 0.22], material: 'gomme' },
    { cylinder: [0.006, 0.09], top: 0.006, at: [0.7, 1.05, s * 0.16], rot: [s * 0.4, 0, 0], material: 'noir' },
    { capsule: [0.028, 0.1], axis: 'z', detail: 0.6, at: [0.7, 1.1, s * 0.205], material: 'laqueNoir' },
    { capsule: [0.012, 0.09], axis: 'z', detail: 0.5, at: [-0.16, 0.5, s * 0.17], material: 'alu' },
  ]),
  { capsule: [0.055, 0.38], axis: 'x', detail: 0.75, at: [-0.45, 0.57, 0.15], rot: [0, 0, 0.3], material: 'chrome' },
];

// ——— Moto en pièces (origine sur le plan de travail, mur du fond à z = -0,3) ——————————————
/** Jante debout contre le mur : centre, rayon du bord, rayon du moyeu, nombre de rayons. */
const LOOSE_RIM_AT: Vec3 = [-0.19, 0.28, -0.05];
const LOOSE_RIM_R = 0.265;
const LOOSE_HUB_R = 0.035;
const LOOSE_SPOKES = 16;
/** Moteur mono : axe du cylindre (penché vers l'avant), pas des ailettes. */
/** Décalage en x du cadre et du moteur, à droite de la jante (le bord gauche du plan est à -0,47). */
const LOOSE_BODY_X = 0.1;
const LOOSE_BARREL_AT: Vec3 = [0.26 + LOOSE_BODY_X, 0.224, 0];
const LOOSE_BARREL_TILT = -0.25;
const LOOSE_FIN_STEP = 0.02;

/** Jante à rayons croisés : bord tourné, moyeu, rayons alternés d'un flanc du moyeu à l'autre. */
function looseWheel(): Part[] {
  const [cx, cy, cz] = LOOSE_RIM_AT;
  const rot: Vec3 = [-0.1, 0, 0];
  const spokeLength = LOOSE_RIM_R - 0.012 - LOOSE_HUB_R;
  const spokeMid = (LOOSE_RIM_R - 0.012 + LOOSE_HUB_R) / 2;
  // Rayons alternés de part et d'autre du plan de la jante (fils de 4 mm : arêtes invisibles).
  const spokes = Array.from({ length: LOOSE_SPOKES }, (_, k): Part => {
    const a = (k * 2 * Math.PI) / LOOSE_SPOKES;
    const z = (k % 2 === 0 ? 1 : -1) * 0.012;
    return {
      box: [spokeLength, 0.004, 0.004],
      at: [cx + spokeMid * Math.cos(a), cy + spokeMid * Math.sin(a) * Math.cos(rot[0]), cz + z + spokeMid * Math.sin(a) * Math.sin(rot[0])],
      rot: [rot[0], 0, a],
      material: 'chrome',
    };
  });
  return [
    {
      lathe: [
        [LOOSE_RIM_R - 0.012, -0.018],
        [LOOSE_RIM_R + 0.014, -0.024],
        [LOOSE_RIM_R + 0.014, 0.024],
        [LOOSE_RIM_R - 0.012, 0.018],
        [LOOSE_RIM_R - 0.012, -0.018],
      ],
      axis: 'z',
      at: [cx, cy, cz],
      rot,
      material: 'alu',
    },
    { cylinder: [LOOSE_HUB_R, 0.1], top: 0.03, axis: 'z', at: [cx, cy, cz], rot, material: 'alu' },
    ...spokes,
  ];
}

/** Ailettes du cylindre, empilées le long de son axe penché. */
function looseFins(count: number): Part[] {
  const [x, y, z] = LOOSE_BARREL_AT;
  return Array.from({ length: count }, (_, k): Part => {
    const d = (k - (count - 1) / 2) * LOOSE_FIN_STEP;
    return { cylinder: [0.07, 0.006], top: 0.068, at: [x - d * Math.sin(LOOSE_BARREL_TILT), y + d * Math.cos(LOOSE_BARREL_TILT), z], rot: [0, 0, LOOSE_BARREL_TILT], detail: 0.75, material: 'alu' };
  });
}

/** Carter moteur vu de côté (x ; y). */
const LOOSE_CASE: Vec2[] = [
  [0.11, 0.02],
  [0.34, 0.02],
  [0.35, 0.12],
  [0.31, 0.18],
  [0.16, 0.18],
  [0.11, 0.12],
];
/** Cadre nu à berceau vu de côté (x ; y) : tête de fourche, tube supérieur, tube de selle, berceau, tube avant. */
const LOOSE_FRAME: Vec3[] = [
  [0.47, 0.354, 0],
  [0.06, 0.284, 0],
  [0.08, 0.019, 0],
  [0.4, 0.014, 0],
  [0.5, 0.254, 0],
];
/** Réservoir posé à plat devant la jante (x ; y), en goutte. */
const LOOSE_TANK: Vec2[] = [
  [0, 0],
  [0.3, 0],
  [0.32, 0.05],
  [0.24, 0.12],
  [0.1, 0.14],
  [-0.02, 0.07],
];

const LOOSE: Part[] = [
  ...looseWheel(),
  ...SIDES.map((s): Part => ({ tube: LOOSE_FRAME, radius: 0.014, closed: true, at: [LOOSE_BODY_X, 0, s * 0.06], material: 'noir' })),
  // Traverses entre les deux flancs du cadre : à la tête de fourche (elle la tient : sans elle, la
  // tête flottait à 2 cm des flancs), au tube de selle et au berceau.
  ...[LOOSE_FRAME[0]!, LOOSE_FRAME[1]!, LOOSE_FRAME[3]!].map(([x, y]): Part => ({ cylinder: [0.01, 0.12], top: 0.01, axis: 'z', at: [x + LOOSE_BODY_X, y, 0], material: 'noir' })),
  { cylinder: [0.025, 0.14], top: 0.025, at: [0.485 + LOOSE_BODY_X, 0.304, 0], rot: [0, 0, 0.35], material: 'noir' },
  { extrude: fillet(LOOSE_CASE, 0.03), depth: 0.14, bevel: 0.02, at: [LOOSE_BODY_X, -0.016, 0], material: 'alu' },
  { cylinder: [0.045, 0.13], top: 0.045, at: LOOSE_BARREL_AT, rot: [0, 0, LOOSE_BARREL_TILT], material: 'noir' },
  ...looseFins(5),
  { capsule: [0.035, 0.3], axis: 'x', detail: 0.6, at: [0.5 + LOOSE_BODY_X, 0.035, 0.17], material: 'chrome' },
  { extrude: fillet(LOOSE_TANK, 0.04), depth: 0.2, bevel: 0.06, at: [-0.4, 0, 0.15], material: 'rouge' },
];

// ——— Bloc moteur (longueur selon x, cornets vers +z, origine sous le carter) ———————————————
/**
 * Emprise tenue sur le plateau de la table basse (0,41 m de profondeur) : x ±0,3, z de -0,167 à
 * 0,234 (0,40 m), cornets presque debout, bloc de 0,26 m d'épaisseur.
 */
const BLOCK_CYLINDERS = [-0.21, -0.07, 0.07, 0.21] as const;
/** Hauteur des conduits d'admission et d'échappement (milieu de la culasse). */
const BLOCK_PORT_Y = 0.325;
/** Inclinaison des cornets vers le haut (radians) et point de départ le long de z. */
const BLOCK_STACK_TILT = 1.25;
const BLOCK_STACK_Z = 0.145;
/** Demi-épaisseur du bloc et de la culasse (z). */
const BLOCK_HALF = 0.13;
const BLOCK_HEAD_HALF = 0.11;
/** Cornet strié (rayon ; hauteur) : les alternances de rayon font les plis du filtre. */
const BLOCK_STACK: Vec2[] = [
  [0, 0],
  [0.028, 0],
  [0.05, 0.022],
  [0.055, 0.04],
  [0.046, 0.058],
  [0.055, 0.076],
  [0.046, 0.094],
  [0.05, 0.112],
  [0, 0.118],
];
/** Carter d'huile vu de côté (x ; y), évasé vers le haut. */
const BLOCK_SUMP: Vec2[] = [
  [-0.22, 0],
  [0.22, 0],
  [0.25, 0.085],
  [-0.25, 0.085],
];

/** Collecteur d'échappement côté -z : un tube par cylindre, de la culasse vers le bas du bloc. */
function blockHeader(x: number): Part {
  const out = Math.sign(x) * 0.07;
  return {
    tube: [
      [x, BLOCK_PORT_Y, -0.1],
      [x, BLOCK_PORT_Y - 0.02, -0.145],
      [(x + out) / 2, 0.2, -0.152],
      [out, 0.1, -0.152],
    ],
    radius: 0.015,
    smooth: true,
    detail: 0.5,
    at: [0, 0, 0],
    material: 'chrome',
  };
}

/** Durite rouge en boucle au-dessus du cache-culbuteurs, côté `side` (±1). */
function blockHose(side: -1 | 1): Part {
  return {
    tube: [
      [-0.25, 0.34, side * 0.085],
      [-0.18, 0.5, side * 0.06],
      [0, 0.53, side * 0.05],
      [0.18, 0.5, side * 0.06],
      [0.25, 0.34, side * 0.085],
    ],
    radius: 0.013,
    smooth: true,
    detail: 0.5,
    at: [0, 0, 0],
    material: 'rouge',
  };
}

const BLOCK: Part[] = [
  { extrude: fillet(BLOCK_SUMP, 0.02), depth: 2 * BLOCK_HALF - 0.04, bevel: 0.015, at: [0, 0, 0], material: 'alu' },
  { box: [0.54, 0.22, 2 * BLOCK_HALF], bevel: 0.015, at: [0, 0.19, 0], material: 'alu' },
  // Nervures verticales du bloc, côté cornets.
  ...[-0.2, -0.1, 0, 0.1, 0.2].map((x): Part => ({ capsule: [0.007, 0.16], detail: 0.5, at: [x, 0.19, BLOCK_HALF + 0.002], material: 'alu' })),
  { box: [0.52, 0.07, 2 * BLOCK_HEAD_HALF], bevel: 0.01, at: [0, BLOCK_PORT_Y, 0], material: 'alu' },
  // Cache-culbuteurs arrondi et ses ailettes longitudinales.
  { extrude: fillet(rectContour(0.16, 0.06), 0.025), axis: 'x', depth: 0.5, bevel: 0.02, at: [0, 0.395, 0], material: 'alu' },
  ...[-0.05, -0.025, 0, 0.025, 0.05].map((z): Part => ({ capsule: [0.005, 0.44], axis: 'x', detail: 0.5, at: [0, 0.428, z], material: 'alu' })),
  // Admission : pipes et cornets rouges striés, levés vers le haut.
  ...BLOCK_CYLINDERS.flatMap((x): Part[] => [
    { cylinder: [0.022, 0.05], top: 0.022, axis: 'z', at: [x, BLOCK_PORT_Y, BLOCK_STACK_Z - 0.025], material: 'alu' },
    { lathe: BLOCK_STACK, axis: 'z', detail: 0.75, at: [x, BLOCK_PORT_Y, BLOCK_STACK_Z], rot: [-BLOCK_STACK_TILT, 0, 0], material: 'rouge' },
  ]),
  ...BLOCK_CYLINDERS.map(blockHeader),
  ...SIDES.map(blockHose),
  // Poulie à l'avant, volant à l'arrière.
  { cylinder: [0.06, 0.03], top: 0.06, axis: 'x', at: [0.285, 0.15, 0], material: 'noir' },
  { cylinder: [0.13, 0.03], axis: 'x', bevel: 0.005, at: [-0.285, 0.16, 0], material: 'alu' },
];

export const PROPS_ENGINS: readonly Prop[] = [
  {
    // Moto en pièces sur le plan de travail, à gauche : jante alu, cadre et moteur.
    name: 'placeholder_moto_en_pieces',
    at: [-0.85, 0.9, BACK + 0.3],
    small: true,
    // Sur le plan de travail des meubles d'atelier (dessus à 0,90 m).
    rest: { on: 'placeholder_meubles_atelier', top: 0.9 },
    parts: LOOSE,
  },
  {
    // Sportive carénée noire devant la colonne, parallèle au mur, nez à droite : la place
    // accueille la moto du moment ; une noire laisse briller la voiture. Quand le véhicule du
    // moment est une moto, elle s'efface (GARAGE.hideFor, src/data/garage.ts).
    name: 'placeholder_moto_sportive',
    at: [2.05, 0, -2.15],
    parts: SPORT,
  },
  {
    // Quad noir garé le long du mur gauche, nez vers l'avant de la pièce, l'arrière sous le
    // retour de l'établi : hors du volume protégé du véhicule (banc d'essai : x jusqu'à
    // ±2,48 m, hystérésis comprise, ici 7 cm de marge), sinon la coupe caméra le garde masqué.
    // L'avant s'arrête à 5 cm de la caisse-colonne ; le pied de tube n° 1 (x -2,74 ; z -0,35)
    // reste libre devant lui.
    name: 'placeholder_quad',
    at: [-3.1, 0, -1.575],
    turn: -Math.PI / 2,
    parts: QUAD,
  },
  {
    // Centré sur le plateau de la table basse (z 1,631 → 2,041) : z 1,636 → 2,036, à 6 cm du
    // grand volume protégé (z 1,575).
    name: 'placeholder_bloc_moteur',
    at: [-2.2, 0.48, 1.8025],
    small: true,
    // Sur le plateau de la table basse (dessus à 0,48 m).
    rest: { on: 'placeholder_table_basse', top: 0.48 },
    parts: BLOCK,
  },
];
