// Mobilier du garage, famille « salon » (cahier de remodelage, § 2.1 et § 5) : canapés, table
// basse, tabouret, pouf, frigo, fût, caisses. Formes : src/data/garageShapes.ts ; cotes et
// matériaux : src/data/garageBase.ts. Aucun import d'une autre famille.
// Interdits (§ 6) : aucun nom ni logo de constructeur, d'équipementier, de sponsor, d'émission ou
// de jeu vidéo, ni dans un nom de variable ; aucun personnage existant ; aucun motif imitant une
// plaque d'immatriculation ; aucune photo ni police. Chaque objet reste un substitut placeholder_*,
// listé dans TODO_ASSETS.md.

import { D, LEFT, type Part, type Prop, type Vec3 } from '../garageBase.ts';
import type { Vec2 } from '../garageShapes.ts';

const SIDES = [-1, 1] as const;

/** Cercle de n points, sens trigonométrique (contours et trous d'extrusion). */
const circle = (radius: number, n: number, cx = 0, cy = 0): Vec2[] =>
  Array.from({ length: n }, (_, k): Vec2 => [cx + radius * Math.cos((k * 2 * Math.PI) / n), cy + radius * Math.sin((k * 2 * Math.PI) / n)]);

/**
 * Section de planche (u large de width, v épais de thick), centrée, coins du dessus arrondis de
 * radius par pas de 30° ; le dessous, toujours posé, reste à angle droit.
 */
const plankSection = (width: number, thick: number, radius: number): Vec2[] => {
  const hw = width / 2;
  const ht = thick / 2;
  const arc = (cx: number, start: number): Vec2[] =>
    [0, 1, 2, 3].map((s): Vec2 => [cx + radius * Math.cos(start + (s * Math.PI) / 6), ht - radius + radius * Math.sin(start + (s * Math.PI) / 6)]);
  return [[-hw, -ht], [hw, -ht], ...arc(hw - radius, 0), ...arc(-hw + radius, Math.PI / 2)];
};

// ——— Canapé 2 places (1,5 × 1,0 × 0,95 m) : assise vers +z, dossier vers -z, origine au sol ———
// Emprise tenue : x ±0,75, z de -0,475 (mur) à +0,48 (côté véhicule), comme le pavé d'origine.
const SOFA_ARM_X = 0.655;
const SOFA_SEAT_TOP = 0.35;

const sofa = (): Part[] => [
  // Socle noir en retrait : ligne d'ombre au pied.
  { box: [1.36, 0.1, 0.74], bevel: 0.012, at: [0, 0.05, 0], material: 'noirMat' },
  // Caisse d'assise, puis deux coussins gonflés.
  { box: [1.16, 0.25, 0.8], bevel: 0.015, at: [0, SOFA_SEAT_TOP - 0.125, 0.05], material: 'cuirNoir' },
  ...SIDES.map((s): Part => ({ cushion: [0.575, 0.15, 0.64], bevel: 0.05, puff: 0.03, at: [s * 0.29, SOFA_SEAT_TOP + 0.07, 0.13], material: 'cuirNoir' })),
  // Dossier incliné, deux coussins bombés devant lui, séparés par un creux.
  { box: [1.36, 0.62, 0.17], bevel: 0.05, at: [0, 0.66, -0.355], rot: [-0.1, 0, 0], material: 'cuirNoir' },
  ...SIDES.map(
    (s): Part => ({ cushion: [0.56, 0.48, 0.17], bevel: 0.07, puff: 0.045, at: [s * 0.29, 0.76, -0.19], rot: [-0.22, 0, 0], material: 'cuirNoir' }),
  ),
  // Accoudoirs : flanc épais terminé par un rouleau.
  ...SIDES.map((s): Part => ({ box: [0.17, 0.5, 0.9], bevel: 0.05, at: [s * SOFA_ARM_X, 0.3, 0], material: 'cuirNoir' })),
  ...SIDES.map((s): Part => ({ capsule: [0.095, 0.92], axis: 'z', detail: 0.75, at: [s * SOFA_ARM_X, 0.57, 0], material: 'cuirNoir' })),
];

// ——— Table basse : plateau de quatre planches de sapin (long côté selon z), piètement ouvert ———
// Plateau de 0,41 m : la bande entre le grand volume protégé du véhicule (z 1,575, hystérésis
// comprise) et le canapé A (z 2,065) fait 0,49 m ; il y garde 5,6 cm de marge côté véhicule et un
// jour de 2,4 cm côté canapé.
const TABLE_TOP = 0.48;
const BOARD = { width: 0.098, thick: 0.06, length: 0.98 } as const;
/** Planches pas tout à fait à niveau, toutes sous le dessus du plateau (le bloc moteur y est posé à 0,48). */
const BOARDS: ReadonlyArray<readonly [number, number]> = [
  [-0.156, 0],
  [-0.052, -0.003],
  [0.052, -0.001],
  [0.156, -0.002],
];
/** Dessous du plateau (planche la plus basse). */
const TABLE_UNDER = TABLE_TOP - BOARD.thick - 0.003;
/** Pieds fuselés en retrait du bord : 3,3 cm sur la largeur, 7 cm aux bouts. */
const TABLE_LEG = { x: 0.15, z: 0.4, foot: 0.015, top: 0.022 } as const;
/** Ceinture sous le plateau et entretoise en H près du sol : hauteur de leur milieu. */
const APRON_Y = TABLE_UNDER - 0.031;
const STRETCHER_Y = 0.1;

/** Traverse de bois clair : pavé aux bords adoucis, long de `length` selon `axis` (x ou z). */
const rail = (axis: 'x' | 'z', thick: number, height: number, length: number, at: Vec3): Part => ({
  extrude: [
    [-thick / 2, -height / 2],
    [thick / 2, -height / 2],
    [thick / 2, height / 2],
    [-thick / 2, height / 2],
  ],
  depth: length,
  axis,
  bevel: 0.003,
  at,
  material: 'boisClair',
});

// ——— Pouf : pneu couché (Ø 0,676 m, h 0,24 m), profil (rayon ; hauteur) de la tringle du bas à celle du haut ———
const TIRE_PROFILE: Vec2[] = [
  [0.22, 0.012],
  [0.27, 0.004],
  [0.305, 0.012],
  [0.326, 0.038],
  [0.336, 0.08],
  [0.338, 0.12],
  [0.336, 0.16],
  [0.326, 0.202],
  [0.305, 0.228],
  [0.27, 0.236],
  [0.22, 0.228],
];
/** 28 côtés au lieu de 24 : la silhouette ronde se lit de près. */
const TIRE_DETAIL = 1.1;

// ——— Frigo : deux palettes (h 0,174 chacune), caisse laquée, porte vers +x ———
const PALLET_H = 0.174;
const PALLET_BOARD_T = 0.022;
const PALLET_GRID = [-0.25, 0, 0.25] as const;
const PALLET_SECTION = plankSection(0.1, PALLET_BOARD_T, 0.006);

/**
 * Une palette posée en y0, haute de PALLET_H : planches de dessous selon x (option), neuf dés,
 * trois traverses selon x sur les rangées de dés, cinq planches de dessus selon z clouées sur les
 * traverses (celles du milieu tombent entre deux dés). Sans planches de dessous, les dés partent
 * de y0 et sont plus hauts : la palette garde sa hauteur et la suivante repose sur elle.
 */
const pallet = (y0: number, withBottom: boolean): Part[] => {
  const blockBottom = y0 + (withBottom ? PALLET_BOARD_T : 0);
  const blockH = y0 + PALLET_H - 2 * PALLET_BOARD_T - blockBottom;
  return [
    ...(withBottom
      ? PALLET_GRID.map((z): Part => ({ extrude: PALLET_SECTION, depth: 0.6, axis: 'x', at: [0, y0 + PALLET_BOARD_T / 2, z], material: 'caisse' }))
      : []),
    ...PALLET_GRID.flatMap((x) => PALLET_GRID.map((z): Part => ({ box: [0.1, blockH, 0.1], at: [x, blockBottom + blockH / 2, z], material: 'caisse' }))),
    ...PALLET_GRID.map((z): Part => ({ extrude: PALLET_SECTION, depth: 0.6, axis: 'x', at: [0, y0 + PALLET_H - 1.5 * PALLET_BOARD_T, z], material: 'caisse' })),
    ...[-0.25, -0.125, 0, 0.125, 0.25].map(
      (x): Part => ({ extrude: PALLET_SECTION, depth: 0.6, at: [x, y0 + PALLET_H - PALLET_BOARD_T / 2, 0], material: 'caisse' }),
    ),
  ];
};

const FRIDGE_BASE = 2 * PALLET_H;
/** Caisse reculée de 2 cm : porte et poignée ne dépassent pas l'emprise d'origine vers la pièce. */
const FRIDGE_X = -0.02;
const FRIDGE_FRONT = FRIDGE_X + 0.275;

// ——— Caisses à claire-voie (0,5 × 0,48 × 0,45 m) : origine au bas, au centre ———
const CRATE = { w: 0.5, h: 0.48, d: 0.45 } as const;
const SLAT_H = 0.12;
/** Trois lattes par face, en bandes qui ceinturent la caisse ; les jours laissent voir l'âme sombre. */
const SLAT_Y = [0.06, 0.24, 0.42] as const;

/**
 * Caisse : âme sombre, montants d'angle (vus seulement dans les jours, arêtes vives cachées par
 * les lattes), bandes de lattes ; open : caisse du haut, la bande haute est un cadre ouvert sur
 * l'intérieur sombre.
 */
const crate = (at: Vec3, turn: number, open: boolean): Part[] => {
  const place = (x: number, y: number, z: number): Vec3 => [at[0] + x * Math.cos(turn) + z * Math.sin(turn), at[1] + y, at[2] - x * Math.sin(turn) + z * Math.cos(turn)];
  const rot: Vec3 = [0, turn, 0];
  const coreH = open ? 0.4 : CRATE.h;
  const frame = open ? SLAT_Y.length - 1 : SLAT_Y.length;
  return [
    { box: [CRATE.w - 0.06, coreH, CRATE.d - 0.06], at: place(0, coreH / 2, 0), rot, material: 'noirMat' },
    ...SIDES.flatMap((sx) =>
      SIDES.map((sz): Part => ({ box: [0.04, CRATE.h, 0.04], at: place(sx * (CRATE.w / 2 - 0.04), CRATE.h / 2, sz * (CRATE.d / 2 - 0.04)), rot, material: 'caisse' })),
    ),
    ...SLAT_Y.slice(0, frame).map((y): Part => ({ box: [CRATE.w, SLAT_H, CRATE.d], bevel: 0.006, at: place(0, y, 0), rot, material: 'caisse' })),
    ...(open
      ? [
          {
            extrude: [
              [-CRATE.w / 2, -CRATE.d / 2],
              [CRATE.w / 2, -CRATE.d / 2],
              [CRATE.w / 2, CRATE.d / 2],
              [-CRATE.w / 2, CRATE.d / 2],
            ],
            holes: [
              [
                [-CRATE.w / 2 + 0.02, -CRATE.d / 2 + 0.02],
                [CRATE.w / 2 - 0.02, -CRATE.d / 2 + 0.02],
                [CRATE.w / 2 - 0.02, CRATE.d / 2 - 0.02],
                [-CRATE.w / 2 + 0.02, CRATE.d / 2 - 0.02],
              ],
            ],
            depth: SLAT_H,
            axis: 'y',
            bevel: 0.006,
            detail: 0.5,
            at: place(0, SLAT_Y[2], 0),
            rot,
            material: 'caisse',
          } satisfies Part,
        ]
      : []),
  ];
};

// ——— Caisse-colonne (0,5 × 0,8 × 0,5 m) : cinq bandes de lattes, dessus en planches, roue appuyée ———
const COLUMN_H = 0.8;
const COLUMN_SLATS = [0.06, 0.23, 0.4, 0.57, 0.74] as const;
const WHEEL_CENTER: Vec3 = [0.34, 0.3, 0];
/** Haut de la roue penché contre la caisse. */
const WHEEL_TILT = 0.18;
/** Jante coulée : bague du bord (rayon ; épaisseur selon l'axe, +x vers la pièce), section bouclée. */
const RIM_RING: Vec2[] = [
  [0.172, -0.02],
  [0.19, -0.02],
  [0.205, -0.01],
  [0.205, 0.012],
  [0.195, 0.02],
  [0.172, 0.012],
  [0.172, -0.02],
];
/** Cinq branches, du moyeu (rayon 0,035) à la bague (0,18). */
const RIM_SPOKES = 5;
const SPOKE = { from: 0.035, to: 0.18, side: 0.024 } as const;

/**
 * Branche k de la jante : pavé radial dans le plan de la roue penchée (axe x tourné de
 * WHEEL_TILT autour de z). Direction avant la pente (0, cos a, sin a), après Rz(pente) :
 * (-sin t cos a, cos t cos a, sin a), atteinte par Rx(ex)·Rz(ez) appliqué à +y (ordre XYZ).
 */
const rimSpoke = (k: number): Part => {
  const a = Math.PI / 2 + (k * 2 * Math.PI) / RIM_SPOKES;
  const t = WHEEL_TILT;
  const d: Vec3 = [-Math.sin(t) * Math.cos(a), Math.cos(t) * Math.cos(a), Math.sin(a)];
  const mid = (SPOKE.from + SPOKE.to) / 2;
  return {
    box: [SPOKE.side, SPOKE.to - SPOKE.from, SPOKE.side],
    at: [WHEEL_CENTER[0] + d[0] * mid, WHEEL_CENTER[1] + d[1] * mid, WHEEL_CENTER[2] + d[2] * mid],
    rot: [Math.atan2(Math.sin(a), Math.cos(t) * Math.cos(a)), 0, Math.asin(Math.sin(t) * Math.cos(a))],
    material: 'alu',
  };
};

export const PROPS_SALON: readonly Prop[] = [
  {
    // Deux piles de deux caisses dans l'angle du mur rouge, légèrement désaxées.
    name: 'placeholder_caisses',
    at: [3.4, 0, -1.08],
    // Caisses du haut posées sur celles du bas (CRATE.h).
    parts: [
      ...crate([0, 0, -0.25], 0, false),
      ...crate([0.02, CRATE.h, -0.25], 0.1, true),
      ...crate([0, 0, 0.25], -0.08, false),
      ...crate([0, CRATE.h, 0.25], 0, true),
    ],
  },
  // Coin salon, angle avant-gauche : deux canapés en L (A contre le mur avant, face au fond ;
  // B contre le mur gauche), table au bloc moteur dans l'angle du L, tabouret et pouf à côté.
  // Au premier plan de la vue de départ : la coupe caméra efface ceux qui masqueraient la
  // voiture, le temps que la caméra est de ce côté.
  { name: 'placeholder_canape_a', at: [-2.3, 0, D / 2 - 0.475], turn: Math.PI, parts: sofa() },
  { name: 'placeholder_canape_b', at: [LEFT + 0.475, 0, 0.8], turn: Math.PI / 2, parts: sofa() },
  {
    // Table basse en bois clair, en long devant le canapé A : plateau de sapin de 6 cm sur
    // quatre pieds fuselés, ceinture et entretoise en H ; on voit le sol et le canapé dessous.
    // Hors du volume protégé du véhicule (banc d'essai : z jusqu'à ±1,575 m, hystérésis
    // comprise), sinon la coupe caméra la garde masquée.
    name: 'placeholder_table_basse',
    at: [-2.2, 0, 1.836],
    turn: Math.PI / 2,
    parts: [
      ...BOARDS.map(
        ([x, e]): Part => ({ box: [BOARD.width, BOARD.thick, BOARD.length], bevel: 0.006, at: [x, TABLE_TOP - BOARD.thick / 2 + e, 0], material: 'boisClair' }),
      ),
      ...SIDES.flatMap((sx) =>
        SIDES.map(
          (sz): Part => ({
            cylinder: [TABLE_LEG.foot, TABLE_UNDER],
            top: TABLE_LEG.top,
            at: [sx * TABLE_LEG.x, TABLE_UNDER / 2, sz * TABLE_LEG.z],
            material: 'boisClair',
          }),
        ),
      ),
      // Ceinture : deux longues traverses et deux courtes, entre les hauts des pieds.
      ...SIDES.map((s) => rail('z', 0.02, 0.06, 2 * TABLE_LEG.z - 0.02, [s * TABLE_LEG.x, APRON_Y, 0])),
      ...SIDES.map((s) => rail('x', 0.02, 0.06, 2 * TABLE_LEG.x - 0.02, [0, APRON_Y, s * TABLE_LEG.z])),
      // Entretoise en H près du sol.
      ...SIDES.map((s) => rail('x', 0.02, 0.03, 2 * TABLE_LEG.x - 0.02, [0, STRETCHER_Y, s * TABLE_LEG.z])),
      rail('z', 0.025, 0.03, 2 * TABLE_LEG.z - 0.02, [0, STRETCHER_Y, 0]),
    ],
  },
  {
    // Pied en disque de frein ajouré à moyeu en cloche, colonne fine, assise ronde en bois clair.
    // À 5 cm au moins du volume protégé du véhicule.
    name: 'placeholder_tabouret_frein',
    at: [-1.45, 0, 1.81],
    small: true,
    parts: [
      {
        extrude: circle(0.18, 32),
        holes: Array.from({ length: 12 }, (_, k) => circle(0.012, 6, 0.135 * Math.cos((k * Math.PI) / 6), 0.135 * Math.sin((k * Math.PI) / 6))),
        depth: 0.022,
        axis: 'y',
        bevel: 0.003,
        detail: 0.5,
        at: [0, 0.011, 0],
        material: 'noir',
      },
      {
        lathe: [
          [0.075, 0],
          [0.078, 0.05],
          [0.06, 0.065],
          [0.03, 0.07],
          [0, 0.07],
        ],
        at: [0, 0.022, 0],
        material: 'noir',
      },
      { cylinder: [0.024, 0.36], at: [0, 0.27, 0], material: 'noir' },
      { cylinder: [0.08, 0.01], at: [0, 0.455, 0], material: 'noir' },
      { cylinder: [0.17, 0.05], bevel: 0.012, at: [0, 0.485, 0], material: 'boisClair' },
    ],
  },
  {
    // Pneu couché aux flancs bombés, fond noir, dessus capitonné légèrement bombé.
    name: 'placeholder_pouf_pneu',
    at: [-1.0, 0, 2.45],
    parts: [
      // Flancs lisses (noir mat) et bande de roulement à crampons (gomme) : un seul profil, coupé en trois.
      { lathe: TIRE_PROFILE.slice(0, 4), detail: TIRE_DETAIL, at: [0, 0, 0], material: 'noirMat' },
      { lathe: TIRE_PROFILE.slice(3, 8), detail: TIRE_DETAIL, at: [0, 0, 0], material: 'gomme' },
      { lathe: TIRE_PROFILE.slice(7), detail: TIRE_DETAIL, at: [0, 0, 0], material: 'noirMat' },
      { cylinder: [0.22, 0.02], at: [0, 0.01, 0], material: 'noirMat' },
      { cylinder: [0.225, 0.045], top: 0.215, bevel: 0.015, detail: 0.8, at: [0, 0.225, 0], material: 'capiton' },
    ],
  },
  {
    // Coin avant-gauche : petit frigo noir rétro sur deux palettes, poignée chromée, sans logo.
    name: 'placeholder_frigo',
    at: [LEFT + 0.33, 0, 2.62],
    parts: [
      ...pallet(0, true),
      ...pallet(PALLET_H, false),
      { box: [0.55, 0.85, 0.55], bevel: 0.07, at: [FRIDGE_X, FRIDGE_BASE + 0.425, 0], material: 'laqueNoir' },
      // Porte en relief (le jour autour fait le joint), grille de compresseur sous elle.
      { box: [0.03, 0.62, 0.44], bevel: 0.015, at: [FRIDGE_FRONT + 0.012, 0.82, 0], material: 'laqueNoir' },
      { box: [0.012, 0.07, 0.4], bevel: 0.004, at: [FRIDGE_FRONT + 0.003, 0.44, 0], material: 'noir' },
      {
        tube: [
          [FRIDGE_FRONT + 0.027, 1.0, 0.17],
          [FRIDGE_FRONT + 0.045, 1.0, 0.17],
          [FRIDGE_FRONT + 0.045, 0.86, 0.17],
          [FRIDGE_FRONT + 0.027, 0.86, 0.17],
        ],
        radius: 0.01,
        smooth: true,
        at: [0, 0, 0],
        material: 'chrome',
      },
      // Baguette chromée sans texte en haut de la porte.
      {
        tube: [
          [FRIDGE_FRONT + 0.029, 1.08, -0.16],
          [FRIDGE_FRONT + 0.029, 1.08, 0.12],
        ],
        radius: 0.005,
        at: [0, 0, 0],
        material: 'chrome',
      },
    ],
  },
  {
    // Fût de 200 L rouge laqué : bords roulés, deux bourrelets, couvercle en creux, deux bouchons.
    name: 'placeholder_fut',
    at: [LEFT + 0.33, 0, 1.95],
    parts: [
      {
        lathe: [
          [0, 0.012],
          [0.272, 0.012],
          [0.285, 0],
          [0.295, 0.008],
          [0.292, 0.03],
          [0.287, 0.04],
          ...[0.285, 0.565].flatMap((a): Vec2[] => [
            [0.287, a],
            [0.292, a + 0.006],
            [0.2955, a + 0.012],
            [0.2955, a + 0.018],
            [0.292, a + 0.024],
            [0.287, a + 0.03],
          ]),
          [0.287, 0.84],
          [0.292, 0.85],
          [0.295, 0.872],
          [0.285, 0.88],
          [0.272, 0.868],
          [0, 0.868],
        ],
        detail: 1.17,
        at: [0, 0, 0],
        material: 'rouge',
      },
      { cylinder: [0.028, 0.012], at: [0.17, 0.874, 0], material: 'alu' },
      { cylinder: [0.012, 0.012], at: [-0.19, 0.874, 0.05], material: 'alu' },
    ],
  },
  {
    // Au bout du canapé B, côté fond : caisse-colonne en bois de palette, roue de moto appuyée
    // côté pièce (côté +z, elle buterait sur l'accoudoir du canapé B).
    name: 'placeholder_caisse_colonne',
    at: [LEFT + 0.3, 0, -0.32],
    parts: [
      { box: [0.44, COLUMN_H, 0.44], at: [0, COLUMN_H / 2, 0], material: 'noirMat' },
      ...SIDES.flatMap((sx) => SIDES.map((sz): Part => ({ box: [0.04, COLUMN_H, 0.04], at: [sx * 0.21, COLUMN_H / 2, sz * 0.21], material: 'caisse' }))),
      ...COLUMN_SLATS.map((y): Part => ({ box: [0.5, SLAT_H, 0.5], bevel: 0.006, at: [0, y, 0], material: 'caisse' })),
      ...[-0.17, 0, 0.17].map((z): Part => ({ box: [0.5, 0.022, 0.155], bevel: 0.006, at: [0, COLUMN_H + 0.011, z], material: 'caisse' })),
      { torus: [0.25, 0.05], axis: 'x', detail: 0.75, at: WHEEL_CENTER, rot: [0, 0, WHEEL_TILT], material: 'gomme' },
      // Jante à cinq branches : on voit la caisse au travers.
      { lathe: RIM_RING, axis: 'x', at: WHEEL_CENTER, rot: [0, 0, WHEEL_TILT], material: 'alu' },
      { cylinder: [0.05, 0.05], top: 0.034, axis: 'x', at: WHEEL_CENTER, rot: [0, 0, WHEEL_TILT], material: 'alu' },
      ...Array.from({ length: RIM_SPOKES }, (_, k) => rimSpoke(k)),
    ],
  },
];
