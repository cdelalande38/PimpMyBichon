// Mobilier du garage, famille « atelier » (cahier de remodelage, § 2.2 et § 5) : meubles à
// tiroirs, évier, servante, établi, enceintes, applique, colonne de l'écran, casier, solives,
// crédence. Formes : src/data/garageShapes.ts ; cotes et matériaux : src/data/garageBase.ts.
// Aucun import d'une autre famille.
// Interdits (§ 6) : aucun nom ni logo de constructeur, d'équipementier, de sponsor, d'émission ou
// de jeu vidéo, ni dans un nom de variable ; aucun personnage existant ; aucun motif imitant une
// plaque d'immatriculation ; aucune photo ni police. Chaque objet reste un substitut placeholder_*,
// listé dans TODO_ASSETS.md.

import { BACK, CASIER, CASIER_CASES, D, H, LEFT, W, type GarageMaterialId, type Part, type Prop } from '../garageBase.ts';
import type { Axis, Vec2, Vec3 } from '../garageShapes.ts';

// ——— Outils de forme ———

/** Pas d'un quart de cercle : trois pas de 30°, sous le seuil d'arête franche (40°) de shapes.ts. */
const ARC_STEPS = 3;

/** Rectangle centré en (cx, cy), coins arrondis de rayon r (r = 0 : coins vifs), sens trigonométrique. */
function roundRect(w: number, h: number, r: number, cx = 0, cy = 0): Vec2[] {
  if (r <= 0) {
    return [
      [cx - w / 2, cy - h / 2],
      [cx + w / 2, cy - h / 2],
      [cx + w / 2, cy + h / 2],
      [cx - w / 2, cy + h / 2],
    ];
  }
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [w / 2 - r, -h / 2 + r, -Math.PI / 2],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
  ];
  return corners.flatMap(([x, y, start]) =>
    Array.from({ length: ARC_STEPS + 1 }, (_, k): Vec2 => {
      const a = start + (k / ARC_STEPS) * (Math.PI / 2);
      return [cx + x + r * Math.cos(a), cy + y + r * Math.sin(a)];
    }),
  );
}

/**
 * Plaque (façade, plateau, panneau) aux cotes d'un pavé [x, y, z], extrudée le long de axis : les
 * bords de ses deux faces sont arrondis, seules les arêtes de chant (longues comme l'épaisseur)
 * restent vives. 28 triangles, contre 108 pour un pavé arrondi.
 */
function slab(size: Vec3, axis: Axis, at: Vec3, material: GarageMaterialId, bevel = 0.003, rot?: Vec3): Part {
  const [x, y, z] = size;
  const [u, v, depth] = axis === 'y' ? [x, z, y] : axis === 'x' ? [z, y, x] : [x, y, z];
  return { extrude: roundRect(u, v, 0), depth, axis, bevel, at, material, ...(rot ? { rot } : {}) };
}

/** Section de poutre (largeur w, hauteur h) centrée, coins du bas arrondis de r, haut à vif (plafond). */
function beamSection(w: number, h: number, r: number): Vec2[] {
  const arc = (cx: number, start: number): Vec2[] =>
    Array.from({ length: ARC_STEPS + 1 }, (_, k): Vec2 => {
      const a = start + (k / ARC_STEPS) * (Math.PI / 2);
      return [cx + r * Math.cos(a), -h / 2 + r + r * Math.sin(a)];
    });
  return [[-w / 2, h / 2], ...arc(-w / 2 + r, Math.PI), ...arc(w / 2 - r, -Math.PI / 2), [w / 2, h / 2]];
}

/** Poignée barre sur deux plots, à plat contre une façade qui regarde +z (coudes francs). */
function barHandle(x: number, y: number, z: number, half: number, standoff: number, radius: number, material: GarageMaterialId): Part {
  return {
    tube: [
      [-half, 0, 0],
      [-half, 0, standoff],
      [half, 0, standoff],
      [half, 0, 0],
    ],
    radius,
    at: [x, y, z],
    material,
  };
}

// ——— Meubles blancs et évier ———

/** Évier encastré au bout droit des meubles : place de son objet, centre de la cuve (z, depuis le mur). */
const SINK = { x: 1.1, z: 0.32 } as const;
/** Meubles : origine, hauteur du dessous du plan de travail, profondeur du caisson, façades. */
const KITCHEN = { x: 0.05, top: 0.86, carcass: 0.576, front: 0.018, plinth: 0.08 } as const;
/** Quatre caissons de 0,675 m ; trois tiroirs chacun, du bas vers le haut (y bas, y haut). */
const CABINETS = [-1.0125, -0.3375, 0.3375, 1.0125] as const;
const CABINET_W = 0.675;
const DRAWER_GAP = 0.006;
const DRAWERS: ReadonlyArray<readonly [number, number]> = [
  [0.085, 0.385],
  [0.39, 0.67],
  [0.675, 0.855],
];
/** Cuve : cotes intérieures du rebord et profondeur. */
const BASIN = { w: 0.42, d: 0.32, r: 0.025, depth: 0.15, wall: 0.004 } as const;
const WORKTOP_Y = 0.9;

const frontZ = KITCHEN.carcass + 0.004 + KITCHEN.front / 2;

function drawerFronts(): Part[] {
  return CABINETS.flatMap((x) =>
    DRAWERS.flatMap(([y0, y1], row): Part[] => {
      const h = y1 - y0;
      // Tiroir du haut : poignée au milieu ; tiroirs profonds : poignée près du bord haut.
      const handleY = row === 2 ? (y0 + y1) / 2 : y1 - 0.05;
      return [
        slab([CABINET_W - DRAWER_GAP, h, KITCHEN.front], 'z', [x, (y0 + y1) / 2, frontZ], 'blanc', 0.004),
        barHandle(x, handleY, frontZ + KITCHEN.front / 2, 0.16, 0.025, 0.006, 'chrome'),
      ];
    }),
  );
}

const sinkX = SINK.x - KITCHEN.x;
const carcassH = KITCHEN.top - KITCHEN.plinth;
/** Dessus du caisson sous l'évier : sous le fond de la cuve. */
const underSinkTop = WORKTOP_Y - 0.005 - BASIN.depth - 0.01;

const meubles: Prop = {
  name: 'placeholder_meubles_atelier',
  at: [KITCHEN.x, 0, BACK],
  parts: [
    // Caisson en deux : trois caissons pleins, le quatrième abaissé sous la cuve.
    { box: [3 * CABINET_W, carcassH, KITCHEN.carcass], bevel: 0.006, at: [-CABINET_W / 2, KITCHEN.plinth + carcassH / 2, KITCHEN.carcass / 2], material: 'blanc' },
    {
      box: [CABINET_W, underSinkTop - KITCHEN.plinth, KITCHEN.carcass],
      bevel: 0.006,
      at: [CABINETS[3], (KITCHEN.plinth + underSinkTop) / 2, KITCHEN.carcass / 2],
      material: 'blanc',
    },
    // Fond noir derrière les façades : les joints entre tiroirs se lisent sombres.
    { box: [4 * CABINET_W - 0.01, KITCHEN.top - 0.085, 0.004], at: [0, (KITCHEN.top + 0.085) / 2, KITCHEN.carcass + 0.002], material: 'noir' },
    slab([4 * CABINET_W - 0.04, KITCHEN.plinth, 0.5], 'y', [0, KITCHEN.plinth / 2, 0.25], 'noir'),
    // Plan de travail noir à chant arrondi, percé pour la cuve.
    {
      extrude: roundRect(2.74, 0.63, 0),
      holes: [roundRect(BASIN.w, BASIN.d, BASIN.r, sinkX, -(SINK.z - 0.315))],
      depth: 0.04,
      axis: 'y',
      bevel: 0.01,
      at: [0, WORKTOP_Y - 0.02, 0.315],
      material: 'planDeTravail',
    },
    ...drawerFronts(),
    // Cadre posé contre la crédence, et sa vitre.
    slab([0.3, 0.38, 0.025], 'z', [-0.7, 1.09, 0.06], 'noir', 0.005, [-0.12, 0, 0]),
    slab([0.25, 0.33, 0.004], 'z', [-0.7, 1.09, 0.074], 'planDeTravail', 0.0015, [-0.12, 0, 0]),
    // Rouleau d'essuie-tout sur son dérouleur.
    { cylinder: [0.075, 0.012], top: 0.072, at: [0.55, WORKTOP_Y + 0.006, 0.15], material: 'chrome' },
    { cylinder: [0.06, 0.24], bevel: 0.01, detail: 0.75, at: [0.55, WORKTOP_Y + 0.012 + 0.12, 0.15], material: 'blanc' },
    { cylinder: [0.006, 0.3], top: 0.006, at: [0.55, WORKTOP_Y + 0.15, 0.15], material: 'chrome' },
    // Caisse à outils rouge (à droite de la moto en pièces) : couvercle marqué, poignée, deux fermoirs.
    { box: [0.45, 0.16, 0.24], bevel: 0.012, at: [0.2, WORKTOP_Y + 0.08, 0.25], material: 'rouge' },
    { box: [0.452, 0.006, 0.242], at: [0.2, WORKTOP_Y + 0.12, 0.25], material: 'noir' },
    {
      tube: [
        [-0.12, 0, 0],
        [-0.12, 0.035, 0],
        [0.12, 0.035, 0],
        [0.12, 0, 0],
      ],
      radius: 0.008,
      at: [0.2, WORKTOP_Y + 0.16, 0.25],
      material: 'noir',
    },
    ...[0.08, 0.32].map((x): Part => ({ box: [0.03, 0.03, 0.01], at: [x, WORKTOP_Y + 0.12, 0.372], material: 'chrome' })),
  ],
};

/** Flacon de produit (rayon, hauteur) : pied arrondi, épaule, goulot. */
const BOTTLE: Vec2[] = [
  [0, 0],
  [0.031, 0],
  [0.035, 0.005],
  [0.036, 0.135],
  [0.03, 0.16],
  [0.015, 0.18],
  [0.012, 0.2],
  [0, 0.2],
];
const FLASK: Vec2[] = [
  [0, 0],
  [0.027, 0],
  [0.03, 0.004],
  [0.03, 0.115],
  [0.012, 0.145],
  [0, 0.15],
];

const evier: Prop = {
  // Au bout droit des meubles blancs, juste avant la colonne : cuve inox, robinet, flacons.
  name: 'placeholder_evier',
  at: [SINK.x, 0, BACK],
  small: true,
  // Le rebord repose sur le plan de travail ; la cuve descend dans son trou, au-dessus du caisson abaissé.
  rest: { on: 'placeholder_meubles_atelier', top: WORKTOP_Y },
  parts: [
    // Rebord à coins arrondis posé sur le plan de travail, cuve creuse, fond et bonde.
    {
      extrude: roundRect(0.5, 0.4, 0.03),
      holes: [roundRect(BASIN.w, BASIN.d, BASIN.r)],
      depth: 0.01,
      axis: 'y',
      bevel: 0.002,
      at: [0, WORKTOP_Y + 0.005, SINK.z],
      material: 'chrome',
    },
    {
      extrude: roundRect(BASIN.w, BASIN.d, BASIN.r),
      holes: [roundRect(BASIN.w - 2 * BASIN.wall, BASIN.d - 2 * BASIN.wall, BASIN.r - BASIN.wall)],
      depth: BASIN.depth,
      axis: 'y',
      at: [0, WORKTOP_Y - BASIN.depth / 2, SINK.z],
      material: 'chrome',
    },
    {
      extrude: roundRect(BASIN.w - 2 * BASIN.wall, BASIN.d - 2 * BASIN.wall, BASIN.r - BASIN.wall),
      depth: BASIN.wall,
      axis: 'y',
      at: [0, WORKTOP_Y - BASIN.depth + BASIN.wall / 2, SINK.z],
      material: 'chrome',
    },
    { cylinder: [0.03, 0.006], top: 0.028, at: [0, WORKTOP_Y - BASIN.depth + BASIN.wall + 0.003, SINK.z], material: 'noir' },
    // Robinet col de cygne : socle, col, mousseur, manette.
    { cylinder: [0.025, 0.03], top: 0.021, at: [0, WORKTOP_Y + 0.015, 0.07], material: 'chrome' },
    {
      tube: [
        [0, 0.93, 0.07],
        [0, 1.2, 0.07],
        [0, 1.24, 0.13],
        [0, 1.2, 0.22],
      ],
      radius: 0.011,
      smooth: true,
      at: [0, 0, 0],
      material: 'chrome',
    },
    { cylinder: [0.012, 0.022], top: 0.013, at: [0, 1.185, 0.22], material: 'chrome' },
    // Manette : elle part du col (rayon 1,1 cm), bout au même endroit qu'avant.
    {
      tube: [
        [0, 0, 0],
        [0.064, 0.038, 0],
      ],
      radius: 0.006,
      at: [0.006, 0.947, 0.07],
      material: 'chrome',
    },
    // Flacons derrière la cuve, pulvérisateur à gauche.
    { lathe: BOTTLE, at: [0.16, WORKTOP_Y, 0.06], material: 'blanc' },
    { lathe: FLASK, at: [0.245, WORKTOP_Y, 0.075], material: 'rouge' },
    { box: [0.06, 0.14, 0.04], bevel: 0.01, at: [-0.33, WORKTOP_Y + 0.07, 0.15], material: 'blanc' },
    { box: [0.032, 0.032, 0.07], at: [-0.33, WORKTOP_Y + 0.156, 0.163], material: 'noir' },
    { box: [0.01, 0.035, 0.01], at: [-0.33, WORKTOP_Y + 0.125, 0.186], material: 'noir' },
  ],
};

// ——— Servante ———

/** Servante : sept tiroirs, du bas vers le haut (hauteurs), à partir de y 0,1 ; jeu de 4 mm. */
const TOOL_CHEST_DRAWERS = [0.17, 0.15, 0.13, 0.11, 0.1, 0.09, 0.09] as const;
const TOOL_CHEST = { w: 0.6, body: 0.42, front: 0.016, gap: 0.004, bottom: 0.1 } as const;

function toolChestFronts(): Part[] {
  const z = TOOL_CHEST.body / 2 - 0.02 + 0.004 + TOOL_CHEST.front / 2;
  let y = TOOL_CHEST.bottom;
  return TOOL_CHEST_DRAWERS.flatMap((h): Part[] => {
    const centre = y + h / 2;
    const top = y + h;
    y = top + TOOL_CHEST.gap;
    return [
      slab([TOOL_CHEST.w - 0.03, h, TOOL_CHEST.front], 'z', [0, centre, z], 'noir', 0.004),
      // Poignée alu sur toute la largeur, au bord haut du tiroir.
      {
        tube: [
          [-0.23, 0, 0],
          [0.23, 0, 0],
        ],
        radius: 0.006,
        at: [0, top - 0.016, z + TOOL_CHEST.front / 2 + 0.006],
        material: 'alu',
      },
    ];
  });
}

/** Roulette pivotante : chape chromée, roue en gomme. */
function caster(x: number, z: number): Part[] {
  return [
    { box: [0.04, 0.05, 0.05], at: [x, 0.065, z], material: 'chrome' },
    { cylinder: [0.035, 0.028], top: 0.035, axis: 'x', at: [x, 0.035, z], material: 'gomme' },
  ];
}

const servante: Prop = {
  name: 'placeholder_servante',
  at: [-1.78, 0, BACK + 0.25],
  parts: [
    { box: [TOOL_CHEST.w, 0.9, TOOL_CHEST.body], bevel: 0.015, at: [0, 0.53, -0.02], material: 'noir' },
    { box: [TOOL_CHEST.w - 0.03, 0.87, 0.004], at: [0, 0.535, TOOL_CHEST.body / 2 - 0.02 + 0.002], material: 'noirMat' },
    ...toolChestFronts(),
    // Dessus en bac à rebord, fond mat.
    { extrude: roundRect(0.6, 0.42, 0), holes: [roundRect(0.56, 0.38, 0)], depth: 0.04, axis: 'y', bevel: 0.004, at: [0, 1.0, -0.02], material: 'noir' },
    { box: [0.56, 0.004, 0.38], at: [0, 0.982, -0.02], material: 'noirMat' },
    // Poignée tubulaire sur le flanc droit.
    {
      tube: [
        [0.3, 0.86, -0.15],
        [0.36, 0.86, -0.15],
        [0.36, 0.86, 0.12],
        [0.3, 0.86, 0.12],
      ],
      radius: 0.012,
      smooth: true,
      at: [0, 0, 0],
      material: 'chrome',
    },
    ...caster(-0.24, -0.16),
    ...caster(0.24, -0.16),
    ...caster(-0.24, 0.14),
    ...caster(0.24, 0.14),
  ],
};

// ——— Établi ———

/** Établi : plateau (dessus à 0,9 m), pieds, panneau perforé et ses outils (face à z 0,035). */
const BENCH = { top: 0.9, legs: [0.06, 1.39] as const, legZ: [0.06, 0.46] as const, toolZ: 0.041 } as const;

/** Clé plate pendue, tête ouverte en bas (contour de 0,22 m de haut). */
const WRENCH: Vec2[] = [
  [-0.01, -0.075],
  [-0.024, -0.09],
  [-0.018, -0.11],
  [-0.006, -0.11],
  [-0.006, -0.095],
  [0.006, -0.095],
  [0.006, -0.11],
  [0.018, -0.11],
  [0.024, -0.09],
  [0.01, -0.075],
  [0.01, 0.075],
  [0.022, 0.085],
  [0.022, 0.1],
  [0.012, 0.11],
  [-0.012, 0.11],
  [-0.022, 0.1],
  [-0.022, 0.085],
  [-0.01, 0.075],
];
/** Lame de scie, poignée à gauche. */
const SAW_BLADE: Vec2[] = [
  [-0.1, -0.035],
  [0.18, -0.02],
  [0.18, 0.012],
  [-0.1, 0.035],
];

function pegboardTools(): Part[] {
  const z = BENCH.toolZ;
  return [
    { extrude: WRENCH, depth: 0.012, at: [0.3, 1.49, z], material: 'alu' },
    // Marteau.
    slab([0.025, 0.22, 0.012], 'z', [0.4, 1.49, z], 'boisClair', 0.002),
    slab([0.1, 0.032, 0.022], 'z', [0.4, 1.615, z + 0.005], 'alu', 0.003),
    // Scie : lame et poignée percée.
    { extrude: SAW_BLADE, depth: 0.004, at: [0.62, 1.71, z], material: 'alu' },
    { extrude: roundRect(0.09, 0.08, 0.02, -0.145, 0), holes: [roundRect(0.05, 0.034, 0.012, -0.15, 0.006)], depth: 0.016, at: [0.62, 1.71, z], material: 'rouge' },
    // Deux tournevis : manche, tige.
    ...[0.52, 0.57].flatMap((x): Part[] => [
      { cylinder: [0.012, 0.09], top: 0.01, at: [x, 1.555, z + 0.007], material: 'rouge' },
      { cylinder: [0.0035, 0.1], top: 0.0035, at: [x, 1.46, z + 0.007], material: 'chrome' },
    ]),
    // Pince : deux branches croisées, mors.
    slab([0.016, 0.15, 0.01], 'z', [0.685, 1.46, z], 'rouge', 0.002, [0, 0, -0.2]),
    slab([0.016, 0.15, 0.01], 'z', [0.715, 1.46, z], 'rouge', 0.002, [0, 0, 0.2]),
    slab([0.022, 0.06, 0.012], 'z', [0.7, 1.565, z], 'chrome', 0.002),
  ];
}

const etabli: Prop = {
  // Angle fond-gauche : établi en bois clair (h 0,9 m), son retour sur consoles le long du mur
  // gauche (le quad passe dessous), panneau d'OSB et outils au-dessus.
  name: 'placeholder_etabli',
  at: [LEFT, 0, BACK],
  parts: [
    { box: [1.45, 0.05, 0.52], bevel: 0.008, at: [0.725, BENCH.top - 0.025, 0.26], material: 'boisClair' },
    { box: [0.32, 0.05, 0.75], bevel: 0.008, at: [0.16, BENCH.top - 0.025, 0.895], material: 'boisClair' },
    // Piètement ouvert : quatre pieds, ceinture avant, deux traverses basses, étagère.
    ...BENCH.legs.flatMap((x) =>
      BENCH.legZ.map((z): Part => ({ box: [0.07, BENCH.top - 0.05, 0.07], bevel: 0.006, at: [x, (BENCH.top - 0.05) / 2, z], material: 'bois' })),
    ),
    slab([1.26, 0.07, 0.04], 'z', [0.725, 0.8, BENCH.legZ[1]], 'bois'),
    slab([1.26, 0.06, 0.04], 'z', [0.725, 0.15, BENCH.legZ[1]], 'bois'),
    slab([1.26, 0.06, 0.04], 'z', [0.725, 0.15, BENCH.legZ[0]], 'bois'),
    slab([1.3, 0.025, 0.44], 'y', [0.725, 0.2, 0.26], 'bois'),
    // Encombrement de l'étagère : deux cartons, un bidon rouge et son bouchon.
    { box: [0.4, 0.28, 0.35], bevel: 0.006, at: [0.35, 0.2125 + 0.14, 0.26], material: 'caisse' },
    { box: [0.35, 0.22, 0.3], bevel: 0.006, at: [0.83, 0.2125 + 0.11, 0.24], rot: [0, 0.12, 0], material: 'caisse' },
    { box: [0.18, 0.28, 0.12], bevel: 0.015, at: [1.2, 0.2125 + 0.14, 0.3], material: 'rouge' },
    { cylinder: [0.016, 0.025], top: 0.015, at: [1.25, 0.2125 + 0.29, 0.3], material: 'noir' },
    // Équerres noires sous le retour.
    ...[0.75, 1.15].map(
      (z): Part => ({
        extrude: [
          [0, 0],
          [0.2, 0],
          [0, -0.16],
        ],
        depth: 0.03,
        bevel: 0.003,
        at: [0, BENCH.top - 0.05, z],
        material: 'noir',
      }),
    ),
    // Panneau d'OSB, panneau perforé noir et ses outils.
    slab([1.45, 1.25, 0.02], 'z', [0.725, 1.6, 0.01], 'osb', 0.004),
    slab([0.6, 0.45, 0.015], 'z', [0.55, 1.55, 0.0275], 'noir'),
    ...pegboardTools(),
    // Étau sur le coin avant droit : corps, mors mobile, vis et sa barre.
    { box: [0.16, 0.08, 0.12], bevel: 0.01, at: [1.25, BENCH.top + 0.04, 0.48], material: 'noir' },
    { box: [0.16, 0.05, 0.03], bevel: 0.005, at: [1.25, BENCH.top + 0.065, 0.555], material: 'noir' },
    { cylinder: [0.01, 0.16], top: 0.01, axis: 'z', at: [1.25, BENCH.top + 0.04, 0.63], material: 'chrome' },
    { cylinder: [0.006, 0.14], top: 0.006, axis: 'x', at: [1.25, BENCH.top + 0.04, 0.705], material: 'chrome' },
  ],
};

// ——— Enceintes ———

/**
 * Haut-parleur (rayon, avancée depuis la façade) pour un bord de 8 cm : saladier caché dans le
 * caisson, collerette, suspension en bourrelet, cône creux jusqu'au cache-noyau.
 */
const DRIVER: Vec2[] = [
  [0, -0.012],
  [0.08, -0.012],
  [0.08, 0.002],
  [0.075, 0.004],
  [0.071, 0.008],
  [0.066, 0.007],
  [0.063, 0.002],
  [0.026, -0.009],
  [0, -0.009],
];

/** Enceinte murale de cotes size centrée en at, façade vers +z : grande (tweeter, étriers) ou petite (évent). */
function speaker(at: Vec3, size: Vec3, big: boolean): Part[] {
  const [x, y, z] = at;
  const [w, , d] = size;
  const face = z + d / 2;
  const k = big ? 1.1 : 1;
  const cx = big ? x : x - 0.045;
  const cy = big ? y - 0.05 : y;
  const parts: Part[] = [
    { box: size, bevel: 0.012, at, material: 'noir' },
    { lathe: DRIVER.map(([r, t]): Vec2 => [r * k, t * k]), axis: 'z', at: [cx, cy, face], material: 'noirMat' },
    { sphere: 0.022 * k, scale: [1, 1, 0.45], detail: 0.5, at: [cx, cy, face - 0.009 * k], material: 'noir' },
  ];
  if (!big) {
    parts.push({ cylinder: [0.015, 0.004], top: 0.015, axis: 'z', at: [x + 0.085, y - 0.04, face + 0.0015], material: 'noirMat' });
    return parts;
  }
  // Tweeter au-dessus du cône ; étriers des deux côtés, du mur (z local -0,12) au milieu du caisson.
  const ty = y + 0.085;
  const armBack = -0.12;
  const armFront = z;
  parts.push(
    { cylinder: [0.02, 0.006], top: 0.019, axis: 'z', at: [x, ty, face + 0.003], material: 'alu' },
    { sphere: 0.012, scale: [1, 1, 0.6], detail: 0.5, at: [x, ty, face + 0.006], material: 'noir' },
    ...[-1, 1].map((side): Part => slab([0.012, 0.05, armFront - armBack], 'x', [x + side * (w / 2 + 0.006), y, (armBack + armFront) / 2], 'noir')),
  );
  return parts;
}

const enceintes: Prop = {
  name: 'placeholder_enceintes',
  at: [0, 0, BACK + 0.12],
  small: true,
  parts: [
    // Trois enceintes empilées à gauche de la colonne, dos contre le mur ; deux autres en haut à
    // droite, sur étriers.
    ...[1.79, 2.005, 2.22].flatMap((y) => speaker([1.33, y, -0.01], [0.26, 0.2, 0.22], false)),
    ...[2.5, 2.1].flatMap((y) => speaker([3.25, y, 0.05], [0.22, 0.34, 0.2], true)),
  ],
};

// ——— Applique ———

/** Applique : bout du bras (attache de l'abat-jour) et inclinaison de l'abat-jour (vers le mur). */
const LAMP_END: Vec3 = [0, -0.05, 0.3];
const LAMP_TILT = -0.6;
/** Abat-jour : coque de 4 mm (section bouclée), ouverte en bas, haut à 2 cm de rayon. */
const SHADE: Vec2[] = [
  [0.065, -0.065],
  [0.032, 0.055],
  [0.022, 0.065],
  [0.018, 0.061],
  [0.028, 0.051],
  [0.061, -0.065],
  [0.065, -0.065],
];
/** Platine murale (rayon, avancée depuis le mur) : disque de 9 cm à bord avant arrondi. */
const WALL_PLATE: Vec2[] = [
  [0, 0],
  [0.045, 0],
  [0.045, 0.01],
  [0.042, 0.014],
  [0.036, 0.015],
  [0, 0.015],
];
/** Point de l'axe de l'abat-jour à distance t de son centre (t > 0 vers le haut). */
const shadeAxis = (t: number): Vec3 => {
  const [x, y, z] = LAMP_END;
  const up = 0.065 - t;
  return [x, y - up * Math.cos(LAMP_TILT), z - up * Math.sin(LAMP_TILT)];
};

const applique: Prop = {
  name: 'placeholder_applique',
  at: [0.9, 1.9, BACK + 0.04],
  small: true,
  parts: [
    // Platine murale, rotule, bras en deux segments, abat-jour, douille, ampoule éteinte.
    { lathe: WALL_PLATE, axis: 'z', at: [0, 0, -0.04], material: 'noir' },
    { sphere: 0.016, detail: 0.5, at: [0, 0, -0.012], material: 'noir' },
    {
      tube: [
        [0, 0, -0.012],
        [0, 0.12, 0.18],
      ],
      radius: 0.008,
      at: [0, 0, 0],
      material: 'noir',
    },
    { sphere: 0.014, detail: 0.5, at: [0, 0.12, 0.18], material: 'noir' },
    {
      tube: [
        [0, 0.12, 0.18],
        LAMP_END,
      ],
      radius: 0.008,
      at: [0, 0, 0],
      material: 'noir',
    },
    { lathe: SHADE, at: shadeAxis(0), rot: [LAMP_TILT, 0, 0], material: 'noir' },
    { cylinder: [0.02, 0.03], top: 0.014, at: shadeAxis(0.06), rot: [LAMP_TILT, 0, 0], material: 'noir' },
    { sphere: 0.028, scale: [1, 1.25, 1], detail: 0.5, at: shadeAxis(-0.03), rot: [LAMP_TILT, 0, 0], material: 'blanc' },
  ],
};

// ——— Colonne de l'écran, crédence ———

/** Écran (placeholder_ecran, garage.ts) : 1,45 × 0,82 m centré à 1,5 m, posé à plat sur la face de la colonne. */
const SCREEN = { w: 1.45, h: 0.82, y: 1.5 } as const;
const COLUMN = { w: 1.5, d: 0.4 } as const;

const colonne: Prop = {
  name: 'placeholder_colonne_ecran',
  at: [2.25, 0, BACK + 0.2],
  parts: [
    { box: [COLUMN.w, H, COLUMN.d], bevel: 0.015, at: [0, H / 2, 0], material: 'noirMat' },
    { box: [COLUMN.w + 0.004, 0.08, COLUMN.d + 0.004], bevel: 0.004, at: [0, 0.04, 0.002], material: 'noir' },
    // Cadre brillant autour de l'écran, en saillie de 2 cm ; la face de la colonne reste plane dessous.
    {
      extrude: roundRect(SCREEN.w + 0.04, SCREEN.h + 0.04, 0.012),
      holes: [roundRect(SCREEN.w, SCREEN.h, 0)],
      depth: 0.02,
      bevel: 0.004,
      at: [0, SCREEN.y, COLUMN.d / 2 + 0.01],
      material: 'noir',
    },
  ],
};

const credence: Prop = {
  // Crédence noire mate en petits carreaux, entre le plan de travail et les enceintes : plaque mince
  // collée au mur du fond (le dessin entier sur sa face avant, matériau credence, qui masque les
  // nappes de lumière du mur : GarageMaterial.overHalos, d'où ses 12 mm d'épaisseur).
  name: 'placeholder_credence',
  at: [-0.025, 1.175, BACK],
  parts: [{ box: [2.95, 0.55, 0.012], bevel: 0.002, at: [0, 0, 0.006], material: 'credence' }],
};

// ——— Casier ———

/** Casier : planches de 3 cm ; montants entre les cases (CASIER_CASES, pas de 0,35 m). */
const LOCKER = { depth: 0.4, height: 0.4, board: 0.03, length: 1.43 } as const;
const LOCKER_POSTS = [-0.7, -0.35, 0, 0.35, 0.7] as const;

const casier: Prop = {
  // Casier noir ouvert de quatre cases en ligne au-dessus du canapé B (dessous à 1,9 m) ; les
  // casques sont un objet à part (placeholder_casques, famille loisirs).
  name: 'placeholder_casiers_casques',
  at: [CASIER.x, CASIER.y, CASIER.z],
  small: true,
  parts: [
    ...[LOCKER.board / 2, LOCKER.height - LOCKER.board / 2].map(
      (y): Part => ({ box: [LOCKER.depth, LOCKER.board, LOCKER.length], bevel: 0.006, at: [0, y, 0], material: 'noir' }),
    ),
    { box: [0.015, LOCKER.height - 2 * LOCKER.board, LOCKER.length - 0.03], at: [-LOCKER.depth / 2 + 0.0075, LOCKER.height / 2, 0], material: 'noirMat' },
    ...LOCKER_POSTS.map(
      (z): Part => ({ box: [LOCKER.depth, LOCKER.height - 2 * LOCKER.board, LOCKER.board], bevel: 0.006, at: [0, LOCKER.height / 2, z], material: 'noir' }),
    ),
    // Boîtier de LED au plafond de chaque case (le point lumineux est un spot de garage.ts, 2 mm dessous).
    ...CASIER_CASES.map((z): Part => ({ cylinder: [0.018, 0.004], top: 0.018, at: [0.06, 0.368, z], material: 'alu' })),
  ],
};

// ——— Solives ———

/** Solives du plafond, le long de z, tous les 0,6 m ; section 8 × 14 cm, arêtes du bas adoucies. */
const JOISTS = Array.from({ length: 12 }, (_, index) => LEFT + 0.45 + index * 0.6);
const JOIST = { w: 0.08, h: 0.14, r: 0.014 } as const;
const RIM_JOIST = { w: 0.08, h: 0.1, r: 0.012 } as const;

const solives: Prop = {
  // Plafond : lames de pin (texture) entre solives sombres ; lisse de rive le long du mur avant.
  // Bouts contre les murs et dessus contre le plafond : vifs et cachés.
  name: 'placeholder_solives',
  at: [0, 0, 0],
  small: true,
  parts: [
    ...JOISTS.map((x): Part => ({ extrude: beamSection(JOIST.w, JOIST.h, JOIST.r), depth: D, at: [x, H - JOIST.h / 2, 0], material: 'solive' })),
    { extrude: beamSection(RIM_JOIST.w, RIM_JOIST.h, RIM_JOIST.r), depth: W, axis: 'x', at: [0, H - RIM_JOIST.h / 2, D / 2 - RIM_JOIST.w / 2], material: 'solive' },
  ],
};

export const PROPS_ATELIER: readonly Prop[] = [meubles, evier, servante, etabli, enceintes, applique, colonne, credence, casier, solives];
