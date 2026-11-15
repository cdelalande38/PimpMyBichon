// Mobilier du garage, famille « loisirs » (cahier de remodelage, § 2.4 et § 5) : flipper,
// peluche, panneau de la cible, casques, enseigne ronde, plaques, affiche, toile, moto murale.
// Formes : src/data/garageShapes.ts ; cotes et matériaux : src/data/garageBase.ts ; œuvres
// posées (art) : src/data/garageArt.ts. Aucun import d'une autre famille.
// Interdits (§ 6) : aucun nom ni logo de constructeur, d'équipementier, de sponsor, d'émission ou
// de jeu vidéo, ni dans un nom de variable ; aucun personnage existant ; aucun motif imitant une
// plaque d'immatriculation ; aucune photo ni police. Chaque objet reste un substitut placeholder_*,
// listé dans TODO_ASSETS.md.

import { BACK, CASIER, CASIER_CASES, LEFT, RIGHT, type GarageMaterialId, type Part, type Prop, type Vec3 } from '../garageBase.ts';
import type { Vec2 } from '../garageShapes.ts';

const SIDES = [-1, 1] as const;

/** Rectangle à coins ronds centré, sens trigonométrique, trois points par coin (pas de 45°). */
function roundedRect(width: number, height: number, radius: number): Vec2[] {
  const corners: ReadonlyArray<readonly [number, number, number]> = [
    [width / 2 - radius, height / 2 - radius, 0],
    [-width / 2 + radius, height / 2 - radius, Math.PI / 2],
    [-width / 2 + radius, -height / 2 + radius, Math.PI],
    [width / 2 - radius, -height / 2 + radius, (3 * Math.PI) / 2],
  ];
  return corners.flatMap(([cx, cy, start]) =>
    [0, Math.PI / 4, Math.PI / 2].map((a): Vec2 => [cx + radius * Math.cos(start + a), cy + radius * Math.sin(start + a)]),
  );
}

/** Rectangle centré, sens trigonométrique. */
const rect = (width: number, height: number): Vec2[] => [
  [width / 2, -height / 2],
  [width / 2, height / 2],
  [-width / 2, height / 2],
  [-width / 2, -height / 2],
];

/** Tourne un point autour de la verticale (même sens que le turn d'un objet). */
function yaw([x, y, z]: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [x * c + z * s, y, -x * s + z * c];
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

// ——— Flipper : repère local joueur vers +z, fronton vers -z, contre le mur du fond ———

/** Demi-largeur de la caisse (0,62 m : l'angle entre la sportive et le mur rouge en laisse 0,66). */
const FL_HALF = 0.31;
/** Profil des flancs (z ; y) : avant bas, plus haut côté fronton. */
const FL_FRONT_Z = 0.62;
const FL_BACK_Z = -0.6;
const FL_BOTTOM = 0.76;
const FL_TOP_FRONT = 0.94;
const FL_TOP_BACK = 1.04;
/** Pente du plateau (rad) et hauteur du dessus de la caisse en z. */
const FL_SLOPE = Math.atan((FL_TOP_BACK - FL_TOP_FRONT) / (FL_FRONT_Z - FL_BACK_Z));
const flTop = (z: number) => FL_TOP_FRONT + (FL_FRONT_Z - z) * Math.tan(FL_SLOPE);
/** Fronton : boîte de 0,64 × 0,6 × 0,2 m, glace côté joueur. */
const FL_HEAD = { w: 0.64, h: 0.6, d: 0.2, y: 1.47, z: -0.58 } as const;
const FL_GLASS_Z = FL_HEAD.z + FL_HEAD.d / 2 + 0.004;
/** Plateau libre pour l'œuvre : entre le cou (z -0,49) et la barre avant (z 0,56), entre les rails. */
const FL_PLAY_W = 0.56;
const FL_PLAY_Z = 0.035;

/** Pied fuselé chromé, sa platine contre le flanc et son niveleur. */
function flipperLeg(sx: number, z: number): Part[] {
  const height = FL_BOTTOM - 0.02;
  return [
    { cylinder: [0.016, height], top: 0.024, at: [sx * 0.29, 0.02 + height / 2, z], material: 'chrome' },
    { box: [0.015, 0.12, 0.07], at: [sx * (FL_HALF + 0.0075), FL_BOTTOM + 0.02, z], material: 'alu' },
    { cylinder: [0.026, 0.02], top: 0.022, at: [sx * 0.29, 0.01, z], material: 'noir' },
  ];
}

const flipper: Part[] = [
  {
    extrude: [
      [-FL_FRONT_Z, FL_BOTTOM],
      [-FL_FRONT_Z, FL_TOP_FRONT],
      [-FL_BACK_Z, FL_TOP_BACK],
      [-FL_BACK_Z, FL_BOTTOM],
    ],
    depth: FL_HALF * 2,
    axis: 'x',
    bevel: 0.008,
    at: [0, 0, 0],
    material: 'bois',
  },
  // Rails chromés sur les arêtes du plateau, barre avant.
  ...SIDES.map((sx): Part => ({ box: [0.02, 0.025, 1.2], bevel: 0.004, at: [sx * (FL_HALF - 0.01), flTop(0.01) + 0.008, 0.01], rot: [FL_SLOPE, 0, 0], material: 'chrome' })),
  { box: [0.58, 0.02, 0.05], bevel: 0.004, at: [0, flTop(0.585) + 0.008, 0.585], rot: [FL_SLOPE, 0, 0], material: 'chrome' },
  // Cou, fronton, glace éclairée, garniture haute.
  { box: [0.46, 0.14, 0.14], bevel: 0.01, at: [0, 1.1, -0.56], material: 'bois' },
  { box: [FL_HEAD.w, FL_HEAD.h, FL_HEAD.d], bevel: 0.012, at: [0, FL_HEAD.y, FL_HEAD.z], material: 'bois' },
  { box: [0.6, 0.52, 0.008], at: [0, FL_HEAD.y, FL_GLASS_Z], material: 'fronton' },
  {
    extrude: rect(0.62, 0.54),
    holes: [rect(0.58, 0.5)],
    depth: 0.012,
    bevel: 0.003,
    at: [0, FL_HEAD.y, FL_GLASS_Z + 0.004],
    material: 'chrome',
  },
  { box: [FL_HEAD.w + 0.02, 0.02, FL_HEAD.d + 0.02], bevel: 0.004, at: [0, FL_HEAD.y + FL_HEAD.h / 2 + 0.01, FL_HEAD.z], material: 'chrome' },
  ...flipperLeg(-1, 0.55),
  ...flipperLeg(1, 0.55),
  ...flipperLeg(-1, -0.52),
  ...flipperLeg(1, -0.52),
  // Façade : porte à monnaie et ses fentes, lanceur, boutons des batteurs.
  { box: [0.26, 0.15, 0.008], bevel: 0.003, at: [0, 0.85, FL_FRONT_Z + 0.004], material: 'alu' },
  ...SIDES.map((sx): Part => ({ box: [0.018, 0.045, 0.004], at: [sx * 0.05, 0.86, FL_FRONT_Z + 0.009], material: 'rouge' })),
  { cylinder: [0.008, 0.07], axis: 'z', at: [0.22, 0.895, FL_FRONT_Z + 0.035], material: 'chrome' },
  { sphere: 0.016, detail: 0.5, at: [0.22, 0.895, FL_FRONT_Z + 0.07], material: 'rouge' },
  ...SIDES.map((sx): Part => ({ cylinder: [0.012, 0.02], axis: 'x', top: 0.011, at: [sx * (FL_HALF + 0.01), 0.895, 0.5], material: 'rouge' })),
];

/** Place du flipper : droit dans l'angle fond-droit, 2 cm des murs et du nez de la sportive. */
const FLIPPER_AT: Vec3 = [3.4, 0, -2.3];

// ——— Peluche : petit chien blanc frisé assis, générique, face vers +z ———

const PELUCHE_ON_FLIPPER: Vec3 = [0.13, 0, -0.36];
const plush: Part[] = [
  { sphere: 0.11, scale: [1, 1.1, 0.9], at: [0, 0.11, 0], material: 'creme' },
  { sphere: 0.085, scale: [1.05, 0.97, 1], at: [0, 0.27, 0.03], material: 'creme' },
  { sphere: 0.042, scale: [1, 0.8, 1.1], detail: 0.6, at: [0, 0.248, 0.1], material: 'creme' },
  // Oreilles tombantes, longues et frisées.
  ...SIDES.map((sx): Part => ({ sphere: 0.05, scale: [0.42, 1.15, 0.75], detail: 0.6, at: [sx * 0.083, 0.235, 0.01], rot: [0, 0, sx * 0.18], material: 'creme' })),
  ...SIDES.map((sx): Part => ({ capsule: [0.03, 0.12], detail: 1.25, at: [sx * 0.045, 0.06, 0.07], material: 'creme' })),
  ...SIDES.map((sx): Part => ({ sphere: 0.05, scale: [1, 0.7, 1.3], detail: 0.5, at: [sx * 0.08, 0.04, -0.01], material: 'creme' })),
  { sphere: 0.035, detail: 0.5, at: [0, 0.1, -0.11], material: 'creme' },
  // Toupet frisé : une couronne de boucles au sommet de la tête.
  ...[0, 1, 2, 3, 4].map((k): Part => {
    const a = (k * 2 * Math.PI) / 5;
    return { sphere: 0.028, detail: 0.5, at: [0.035 * Math.sin(a), 0.345, 0.03 + 0.035 * Math.cos(a)], material: 'creme' };
  }),
  // Deux boucles sur le poitrail.
  ...SIDES.map((sx): Part => ({ sphere: 0.03, detail: 0.5, at: [sx * 0.032, 0.165, 0.075], material: 'creme' })),
  { sphere: 0.013, detail: 0.4, at: [0, 0.26, 0.144], material: 'noir' },
  ...SIDES.map((sx): Part => ({ sphere: 0.01, detail: 0.4, at: [sx * 0.03, 0.29, 0.105], material: 'noir' })),
];

// ——— Panneau de la cible : les pièces avancent vers -x depuis le mur rouge ———

/** Contour en croix étagée du panneau (z ; y), celui de cible.svg. */
const TARGET_BOARD: Vec2[] = [
  [-0.4, 0.5],
  [0.4, 0.5],
  [0.4, 0.4],
  [0.6, 0.4],
  [0.6, -0.4],
  [0.4, -0.4],
  [0.4, -0.5],
  [-0.4, -0.5],
  [-0.4, -0.4],
  [-0.6, -0.4],
  [-0.6, 0.4],
  [-0.4, 0.4],
];
/** Face avant du panneau, décollé du mur de 4,5 cm : la cible y est dessinée (cible.svg). */
const BOARD_X = -0.06;
const BOARD_FACE = BOARD_X - 0.015;
/**
 * Bord de la cible : un jonc noir épais autour du dessin, un fil d'alu sur le dessin. La case
 * « cible-seule » est carrée : posée sur un disque en relief, ses coins de planches flotteraient.
 */
const TARGET_R = 0.228;
const TARGET_FACE = BOARD_FACE;

/** Fléchette plantée en (y, z) de la cible : pointe, fût rouge, empennage croisé. */
function dart(y: number, z: number): Part[] {
  return [
    { cylinder: [0.004, 0.05], top: 0.001, axis: 'x', at: [TARGET_FACE - 0.025, y, z], material: 'chrome' },
    { cylinder: [0.007, 0.045], axis: 'x', at: [TARGET_FACE - 0.07, y, z], material: 'rouge' },
    { box: [0.035, 0.03, 0.001], at: [TARGET_FACE - 0.11, y, z], material: 'blanc' },
    { box: [0.035, 0.001, 0.03], at: [TARGET_FACE - 0.11, y, z], material: 'blanc' },
  ];
}

const targetBoard: Part[] = [
  ...SIDES.flatMap((sy) => SIDES.map((sz): Part => ({ box: [0.045, 0.08, 0.08], at: [-0.0225, sy * 0.3, sz * 0.35], material: 'noir' }))),
  { extrude: TARGET_BOARD.map(([z, y]): Vec2 => [-z, y]), depth: 0.03, axis: 'x', bevel: 0.004, at: [BOARD_X, 0, 0], material: 'boisClair' },
  { torus: [TARGET_R + 0.01, 0.014], axis: 'x', detail: 0.6, at: [BOARD_FACE, 0, 0], material: 'noir' },
  { torus: [TARGET_R - 0.004, 0.003], axis: 'x', detail: 0.5, at: [BOARD_FACE - 0.001, 0, 0], material: 'alu' },
  ...dart(0.05, 0.02),
  ...dart(-0.08, 0.06),
  ...dart(0.02, -0.1),
];

// ——— Casques : coque, écran fumé en secteur, jonc de gomme, aileron, aération ———

/** Rayon de la coque et centre au-dessus du bas du casque. */
const HELMET_R = 0.135;
const HELMET_CY = 0.125;
/** Écran : arc de sphère épais de 6 mm, de -15° à +30° autour de l'équateur, sur 2 rad. */
const VISOR_ARC = 2.0;
const arcOfSphere = (radius: number, degrees: readonly number[]): Vec2[] =>
  degrees.map((d): Vec2 => [radius * Math.cos((d * Math.PI) / 180), radius * Math.sin((d * Math.PI) / 180)]);
const VISOR_ANGLES = [-15, 0, 15, 30];
const VISOR_SECTION: Vec2[] = [...arcOfSphere(0.152, VISOR_ANGLES), ...arcOfSphere(0.146, [...VISOR_ANGLES].reverse())];
/** Aileron arrière, profil (z ; y) d'une coque qui regarde +z. */
const SPOILER: Vec2[] = [
  [-0.1, 0.24],
  [-0.16, 0.205],
  [-0.155, 0.19],
  [-0.09, 0.22],
];

/** Casque intégral posé en origin (bas de la coque), écran vers +x tourné de turn autour de la verticale. */
function helmet(origin: Vec3, material: GarageMaterialId, turn = 0): Part[] {
  // La pièce de base regarde +z ; un quart de tour l'envoie vers +x (la pièce, depuis le mur gauche).
  const a = turn + Math.PI / 2;
  const at = (p: Vec3) => add(origin, yaw(p, a));
  return [
    { sphere: HELMET_R, scale: [1, 1, 1.08], at: at([0, HELMET_CY, -0.005]), rot: [0, a, 0], material },
    {
      lathe: [...VISOR_SECTION, VISOR_SECTION[0]!],
      arc: VISOR_ARC,
      detail: 0.75,
      at: at([0, HELMET_CY, 0]),
      rot: [0, a - VISOR_ARC / 2, 0],
      material: 'planDeTravail',
    },
    { torus: [0.1, 0.016], detail: 0.5, at: at([0, 0.03, 0]), material: 'gomme' },
    { extrude: SPOILER.map(([z, y]): Vec2 => [-z, y]), depth: 0.1, axis: 'x', bevel: 0.005, at: at([0, 0, 0]), rot: [0, a, 0], material },
    { box: [0.04, 0.012, 0.03], at: at([0, 0.258, 0.06]), rot: [0, a, 0], material: 'noir' },
  ];
}

/** Patère du mur gauche (repère du casier) : bras, rosace, et le casque blanc posé dessus. */
const PEG: Vec3 = [-0.115, -0.3, 0.95];
const helmets: Part[] = [
  ...helmet([0.02, 0.03, CASIER_CASES[0]], 'noir'),
  ...helmet([0.02, 0.03, CASIER_CASES[1]], 'casqueBlanc'),
  ...helmet([0.02, 0.03, CASIER_CASES[2]], 'rouge'),
  ...helmet([0.02, 0.03, CASIER_CASES[3]], 'sarcelle'),
  ...helmet([0, 0.4, 0.3], 'casqueBlanc', 0.5),
  { cylinder: [0.012, 0.17], axis: 'x', at: PEG, material: 'noir' },
  { cylinder: [0.03, 0.01], axis: 'x', at: [-0.195, PEG[1], PEG[2]], material: 'noir' },
  ...helmet([-0.02, PEG[1] - 0.01, PEG[2]], 'casqueBlanc', 0.35),
];

// ——— Enseigne ronde : face vers +x, décollée du lambris ———

const SIGN_PEGS = [1, 3, 5, 7].map((k) => (k * Math.PI) / 4);
/** Anneau néon : section hexagonale (matière émissive, le modelé ne se voit pas) tournée autour de x. */
const SIGN_RING_R = 0.185;
const SIGN_TUBE_R = 0.013;
const SIGN_RING_X = 0.038;
const SIGN_TUBE: Vec2[] = [0, 1, 2, 3, 4, 5, 6].map((k): Vec2 => {
  const a = (k * Math.PI) / 3;
  return [SIGN_RING_R + SIGN_TUBE_R * Math.cos(a), SIGN_RING_X + SIGN_TUBE_R * Math.sin(a)];
});
const roundSign: Part[] = [
  // Entretoise d'alu entre le lambris et le disque : son chant brille sous le disque noir.
  { cylinder: [0.205, 0.02], axis: 'x', at: [-0.01, 0, 0], material: 'alu' },
  { cylinder: [0.22, 0.03], axis: 'x', bevel: 0.005, detail: 1.1, at: [0.015, 0, 0], material: 'noir' },
  { lathe: SIGN_TUBE, axis: 'x', detail: 1.6, at: [0, 0, 0], material: 'neonVert' },
  ...SIGN_PEGS.map((a): Part => ({ cylinder: [0.008, 0.012], top: 0.006, axis: 'x', detail: 0.5, at: [0.036, 0.205 * Math.sin(a), 0.205 * Math.cos(a)], material: 'noir' })),
];

// ——— Plaques de tôle : face +z, posées sur l'OSB de l'établi ———

const PLATE_W = 0.4;
const PLATE_H = 0.2;
const PLATE_T = 0.004;
/** Rivets sur les trous dessinés de plaques-deco.svg (46 et 52 unités du bord, case de 600 × 300). */
const RIVET_X = PLATE_W / 2 - (46 / 600) * PLATE_W;
const RIVET_Y = PLATE_H / 2 - (52 / 300) * PLATE_H;
/** Bord roulé, en retrait du contour. */
const BEAD_INSET = 0.008;

/** Une tôle centrée en (x, y), tournée de tilt dans son plan : tôle, bord roulé, quatre rivets. */
function plate(x: number, y: number, tilt: number): Part[] {
  const rot: Vec3 = [0, 0, tilt];
  const c = Math.cos(tilt);
  const s = Math.sin(tilt);
  const at = (u: number, v: number, z: number): Vec3 => [x + u * c - v * s, y + u * s + v * c, z];
  const bx = PLATE_W / 2 - BEAD_INSET;
  const by = PLATE_H / 2 - BEAD_INSET;
  return [
    { extrude: roundedRect(PLATE_W, PLATE_H, 0.02), depth: PLATE_T, bevel: 0.0015, at: at(0, 0, PLATE_T / 2), rot, material: 'alu' },
    {
      tube: [
        [bx, by, 0],
        [-bx, by, 0],
        [-bx, -by, 0],
        [bx, -by, 0],
      ],
      radius: 0.0025,
      closed: true,
      at: at(0, 0, PLATE_T),
      rot,
      material: 'alu',
    },
    ...SIDES.flatMap((su) =>
      SIDES.map((sv): Part => ({ cylinder: [0.006, 0.003], top: 0.004, axis: 'z', detail: 0.5, at: at(su * RIVET_X, sv * RIVET_Y, PLATE_T + 0.0015), rot, material: 'chrome' })),
    ),
  ];
}

/** Trois tôles l'une sous l'autre (centre du milieu), légèrement de travers. */
const PLATES: ReadonlyArray<readonly [y: number, tilt: number]> = [
  [0.25, 0.04],
  [0, -0.03],
  [-0.25, 0.02],
];

// ——— Affiche sous verre : face +x, sur le lambris ———

const POSTER_W = 0.6;
const POSTER_H = 0.9;
const POSTER_FRAME = 0.01;

// ——— Moto murale ———

/** Échelle de la sportive recopiée, et hauteur ajoutée (roues de 1,29 à 1,59 m, dessus sous le casier). */
const BIKE_SCALE = 0.5;
const BIKE_Y = 1.29;

function wallBike(): Part[] {
  const k = BIKE_SCALE;
  const p = (x: number, y: number, z = 0): Vec3 => [x * k, y * k + BIKE_Y, z * k];
  const contour = (points: ReadonlyArray<readonly [number, number]>): Vec2[] => points.map(([u, v]): Vec2 => [u * k, v * k]);
  const shell = (points: ReadonlyArray<readonly [number, number]>, depth: number, bevel: number, material: GarageMaterialId): Part => ({
    extrude: contour(points),
    depth: depth * k,
    bevel: bevel * k,
    at: [0, BIKE_Y, 0],
    material,
  });
  return [
    { torus: [0.245 * k, 0.055 * k], axis: 'z', detail: 0.85, at: p(0.7, 0.3), material: 'gomme' },
    { torus: [0.235 * k, 0.068 * k], axis: 'z', detail: 0.85, at: p(-0.68, 0.3), material: 'gomme' },
    ...[0.7, -0.68].map((x): Part => ({ cylinder: [0.2 * k, 0.07 * k], axis: 'z', bevel: 0.004, detail: 0.6, at: p(x, 0.3), material: 'noir' })),
    // Fourche (fourreau et tube d'une pièce).
    ...SIDES.map((sz): Part => ({ cylinder: [0.026 * k, 0.7 * k], at: p(0.63, 0.64, sz * 0.09), rot: [0, 0, 0.42], material: 'chrome' })),
    // Carénage latéral, nez, bulle fumée, coque arrière.
    shell(
      [
        [0.85, 0.72],
        [0.95, 0.9],
        [0.82, 1.04],
        [0.55, 1.0],
        [0.3, 0.9],
        [0.0, 0.84],
        [-0.08, 0.6],
        [0.05, 0.36],
        [0.38, 0.34],
        [0.42, 0.55],
        [0.6, 0.66],
      ],
      0.34,
      0.04,
      'rouge',
    ),
    shell(
      [
        [0.82, 0.74],
        [1.0, 0.84],
        [0.95, 0.95],
        [0.8, 0.98],
      ],
      0.22,
      0.03,
      'rouge',
    ),
    shell(
      [
        [0.78, 1.02],
        [0.6, 1.17],
        [0.55, 1.1],
      ],
      0.26,
      0.01,
      'planDeTravail',
    ),
    shell(
      [
        [-0.05, 0.82],
        [-0.85, 1.0],
        [-0.95, 0.97],
        [-0.7, 0.84],
        [-0.12, 0.72],
      ],
      0.2,
      0.03,
      'rouge',
    ),
    { box: [0.08 * k, 0.025 * k, 0.16 * k], at: p(0.96, 0.86), rot: [0, 0, -0.5], material: 'chrome' },
    // Réservoir : un ellipsoïde posé dans le creux du carénage (le coussin de la recette faisait boîte).
    { sphere: 0.2 * k, scale: [1.1, 0.5, 0.8], detail: 0.75, at: p(0.25, 0.93), material: 'rouge' },
    { box: [0.36 * k, 0.06 * k, 0.24 * k], bevel: 0.01, at: p(-0.22, 0.88), rot: [0, 0, 0.08], material: 'noirMat' },
    // Moteur, carter, silencieux.
    { box: [0.4 * k, 0.3 * k, 0.28 * k], bevel: 0.01, at: p(0.12, 0.45), material: 'noir' },
    { cylinder: [0.1 * k, 0.3 * k], axis: 'z', at: p(0, 0.36), material: 'alu' },
    { capsule: [0.05 * k, 0.36 * k], axis: 'x', at: p(-0.42, 0.58, 0.15), rot: [0, 0, 0.25], material: 'alu' },
    // Supports muraux.
    ...SIDES.map((sx): Part => ({ box: [0.03, 0.03, 0.16], at: [sx * 0.2, BIKE_Y + 0.15, -0.08], material: 'noir' })),
  ];
}

export const PROPS_LOISIRS: readonly Prop[] = [
  {
    // Flipper ancien droit dans l'angle fond-droit, fronton contre le mur du fond, joueur vers la pièce.
    name: 'placeholder_flipper',
    at: FLIPPER_AT,
    parts: flipper,
    art: [
      { art: 'flipper-plateau', at: [0, flTop(FL_PLAY_Z) + 0.001, FL_PLAY_Z], rot: [-Math.PI / 2 + FL_SLOPE, 0, 0], width: FL_PLAY_W },
      { art: 'flipper-fronton', at: [0, FL_HEAD.y, FL_GLASS_Z + 0.005], width: 0.58 },
    ],
  },
  {
    // Peluche assise sur le plateau, près du fronton, tournée vers la pièce.
    name: 'placeholder_peluche',
    at: add(FLIPPER_AT, [PELUCHE_ON_FLIPPER[0], flTop(PELUCHE_ON_FLIPPER[2]) + 0.012, PELUCHE_ON_FLIPPER[2]]),
    turn: -Math.PI / 4,
    small: true,
    on: ['placeholder_flipper'],
    parts: plush,
  },
  {
    // Panneau de bois à bords étagés décollé du mur rouge (le rétroéclairage passe dessous), cible
    // dessinée cerclée d'un jonc noir et d'un fil d'alu, trois fléchettes plantées.
    name: 'placeholder_panneau_cible',
    at: [RIGHT, 1.8, 0.4],
    small: true,
    parts: targetBoard,
    art: [
      { art: 'cible', at: [BOARD_FACE - 0.001, 0, 0], rot: [0, -Math.PI / 2, 0], width: 1.2 },
    ],
  },
  {
    // Casques du casier (placeholder_casiers_casques, famille atelier) : un par case, un posé
    // dessus, un sur la patère à côté. Couleurs unies. Ils disparaissent avec le casier.
    name: 'placeholder_casques',
    at: [CASIER.x, CASIER.y, CASIER.z],
    small: true,
    on: ['placeholder_casiers_casques'],
    parts: helmets,
  },
  {
    // Derrière le frigo : enseigne ronde à anneau vert lumineux, sans aucun texte.
    name: 'placeholder_enseigne_ronde',
    at: [LEFT + 0.02, 1.65, 2.62],
    small: true,
    parts: roundSign,
  },
  {
    // Trois tôles décoratives sur l'OSB de l'établi, à droite du panneau d'outils (jamais une
    // plaque d'immatriculation : les dessins sont ceux de plaques-deco.svg).
    name: 'placeholder_plaques',
    at: [-2.63, 1.8, BACK + 0.02],
    small: true,
    on: ['placeholder_etabli'],
    parts: PLATES.flatMap(([y, tilt]) => plate(0, y, tilt)),
    art: PLATES.map(([y, tilt], k) => ({
      art: 'plaques-deco' as const,
      region: `plaque-${k + 1}`,
      at: [0, y, PLATE_T + 0.001] as Vec3,
      rot: [0, 0, tilt] as Vec3,
      width: PLATE_W,
    })),
  },
  {
    // Affiche d'atelier sous verre, cadre noir fin, sur le lambris entre l'enseigne et le casier.
    name: 'placeholder_affiche',
    at: [LEFT, 1.65, -0.38],
    small: true,
    parts: [
      {
        extrude: rect(POSTER_W + 2 * POSTER_FRAME, POSTER_H + 2 * POSTER_FRAME),
        holes: [rect(POSTER_W, POSTER_H)],
        depth: 0.015,
        axis: 'x',
        bevel: 0.003,
        at: [0.0075, 0, 0],
        material: 'noir',
      },
      { box: [0.004, POSTER_H, POSTER_W], at: [0.004, 0, 0], material: 'blanc' },
    ],
    art: [{ art: 'affiche-atelier', at: [0.0065, 0, 0], rot: [0, Math.PI / 2, 0], width: POSTER_W }],
  },
  {
    // Toile pop art au-dessus de l'écran, sur la colonne : châssis de 4 cm à chants clairs, de 2,0
    // à 2,72 m (la solive de x = 2,1 descend à 2,76 m).
    name: 'placeholder_toile_pop_art',
    at: [2.25, 2.36, BACK + 0.4],
    small: true,
    parts: [{ box: [0.545, 0.725, 0.04], bevel: 0.004, at: [0, 0, 0.02], material: 'creme' }],
    art: [{ art: 'toile-pop-art', at: [0, 0, 0.041], width: 0.54 }],
  },
  {
    // Petite sportive rouge d'environ 1 m accrochée sous le casier : la sportive du garage à
    // l'échelle 0,5, nez local +x vers le fond, mur à z local -0,16.
    name: 'placeholder_moto_murale',
    at: [LEFT + 0.16, 0, CASIER.z],
    turn: Math.PI / 2,
    small: true,
    parts: wallBike(),
  },
];
