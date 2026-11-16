// @ts-check
// Bibliothèque des pièces d'habitacle partagées (§ 5.4, § 8) : volants, pommeaux de levier et
// sièges avant, modelés une fois et posés par l'app sur les ancres des véhicules qui déclarent un
// intérieur (manifeste, section `interior`). Le catalogue est une donnée :
// public/assets/shared/habitacle/catalogue.json. Substituts déclarés : placeholder_volants,
// placeholder_pommeaux, placeholder_sieges (TODO_ASSETS.md). Aucun logo, aucun marquage.
//
// Repères (mètres) :
// - volant : centre de la jante à l'origine, jante dans le plan XY, face au conducteur vers +Z,
//   midi vers +Y ; la colonne arrive par −Z ;
// - pommeau : point de fixation sur la tige à l'origine, tige vers −Y, haut du pommeau vers +Y,
//   face (motif, tête de mort) tournée vers −X, l'arrière de l'habitacle ;
// - siège : au sol sous le milieu de l'assise, avant vers +X, haut vers +Y, largeur sur Z.
// Matériaux : `paint_volant` (jante, couleur libre), `paint_pommeau` (couleur libre, ou zone du
// véhicule), `paint_sellerie` (zone de sellerie du véhicule, sinon cuir), et les rôles.

import { readFileSync } from 'node:fs';
import * as k from './kit.mjs';

/** @typedef {import('./kit.mjs').Parts} Parts */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {{ id: string, style: string, label: string, hint?: string, color?: string, roughness?: number }} Entry */
/** @typedef {{ anchors: { steering: string, knob: string, seats: string[] }, steering: Entry[], knobs: Entry[], seats: Entry[], sky: { densities: { id: string, label: string, factor: number }[], origin: number } }} Catalogue */

export const CATALOGUE_URL = new URL('../../public/assets/shared/habitacle/catalogue.json', import.meta.url);

/** @returns {Catalogue} */
export function readCatalogue() {
  return JSON.parse(readFileSync(CATALOGUE_URL, 'utf8'));
}

/** Fichiers, sous public/assets/shared/habitacle/ (mêmes noms que src/data/habitacle.ts). */
export const steeringFile = (/** @type {string} */ id) => `volant_${id}.glb`;
export const knobFile = (/** @type {string} */ id) => `pommeau_${id}.glb`;
export const seatFile = (/** @type {string} */ id) => `siege_${id}.glb`;

const VOLANT = 'paint_volant';
const POMMEAU = 'paint_pommeau';
const SELLERIE = 'paint_sellerie';

/** Rayon de la jante des volants (axe du boudin), en mètres. */
export const STEERING_RADIUS = 0.19;

/** Boudin fermé de rayon `tube` sur un cercle de rayon `r`, dans le plan z. @param {number} r @param {number} tube @param {string} material @param {number} [z] */
function ring(r, tube, material, z = 0) {
  return k.tube(
    k.circle(0, 0, r, 32).map(([a, b]) => /** @type {P3} */ ([a, b, z])),
    { material, radius: tube, closed: true, segments: 72, radial: 10 },
  );
}

/** Fente oblongue de u0 à u1, demi-largeur w. @param {number} u0 @param {number} u1 @param {number} w @returns {P2[]} */
function slot(u0, u1, w) {
  /** @type {P2[]} */
  const pts = [];
  for (let i = 0; i <= 5; i += 1) {
    const a = -Math.PI / 2 + (Math.PI * i) / 5;
    pts.push([u1 - w + w * Math.cos(a), w * Math.sin(a)]);
  }
  for (let i = 0; i <= 5; i += 1) {
    const a = Math.PI / 2 + (Math.PI * i) / 5;
    pts.push([u0 + w + w * Math.cos(a), w * Math.sin(a)]);
  }
  return pts;
}

/** Contour d'une branche de u = 0 à `len`, demi-largeurs `w0` au moyeu et `w1` à la jante. @param {number} len @param {number} w0 @param {number} w1 @returns {P2[]} */
function spokeOutline(len, w0, w1) {
  return [
    [0, -w0],
    [len * 0.55, -(w0 + w1) / 2 + 0.002],
    [len, -w1],
    [len, w1],
    [len * 0.55, (w0 + w1) / 2 - 0.002],
    [0, w0],
  ];
}

/** Petit bouton bombé (vis, rivet) face +Z. @param {number} r @param {string} material */
const stud = (r, material) => k.lathe([[r, 0], [r, r * 0.45], [r * 0.6, r * 0.85], [0, r]], { material, segments: 8 });

// ---------------------------------------------------------------------------------------------
// Volants

/** @type {Record<string, () => Parts>} */
const STEERING = {
  /** Jante mince, deux branches un peu sous l'horizontale, demi-cercle d'avertisseur chromé. */
  deux_branches() {
    const R = STEERING_RADIUS;
    /** @type {Parts} */
    const parts = [...ring(R, 0.0105, VOLANT)];
    parts.push(...k.lathe([[0.038, -0.03], [0.038, 0.004], [0.03, 0.014], [0, 0.017]], { material: 'black', segments: 28 }));
    parts.push(...k.lathe([[0.024, 0.0135], [0.02, 0.019], [0, 0.0215]], { material: 'chrome', segments: 24 }));
    const spoke = k.roundedExtrude(spokeOutline(R - 0.034, 0.012, 0.008), { material: VOLANT, depth: 0.007, bevel: 0.0025, bevelSegments: 1 });
    for (const a of [-0.26, Math.PI + 0.26]) parts.push(...k.place(spoke, { position: [0.03 * Math.cos(a), 0.03 * Math.sin(a), 0.002], rotation: [0, 0, a] }));
    // Demi-cercle d'avertisseur sous le moyeu, d'une branche à l'autre.
    /** @type {P3[]} */
    const arc = [];
    for (let i = 0; i <= 14; i += 1) {
      const a = -0.26 - ((Math.PI - 0.52) * i) / 14;
      arc.push([0.128 * Math.cos(a), 0.128 * Math.sin(a), 0.008]);
    }
    parts.push(...k.tube(arc, { material: 'chrome', radius: 0.0042, segments: 40, radial: 8 }));
    return parts;
  },

  /** Trois branches plates en T renversé, percées de deux fentes, jante épaisse, moyeu à six vis. */
  trois_branches() {
    const R = STEERING_RADIUS;
    /** @type {Parts} */
    const parts = [...ring(R, 0.02, VOLANT)];
    parts.push(...k.lathe([[0.05, -0.026], [0.05, 0.006], [0.044, 0.016], [0, 0.018]], { material: 'black', segments: 28, crease: 50 }));
    for (let i = 0; i < 6; i += 1) {
      const a = (2 * Math.PI * i) / 6 + Math.PI / 6;
      parts.push(...k.place(stud(0.0042, 'alu'), { position: [0.033 * Math.cos(a), 0.033 * Math.sin(a), 0.0125] }));
    }
    const len = R - 0.008 - 0.042;
    const spoke = k.roundedExtrude([[0, -0.022], [len * 0.55, -0.02], [len, -0.028], [len, 0.028], [len * 0.55, 0.02], [0, 0.022]], {
      material: 'black',
      depth: 0.007,
      bevel: 0.0025,
      bevelSegments: 1,
      holes: [slot(0.018, 0.064, 0.0085), slot(0.076, 0.122, 0.0085)],
    });
    for (const a of [0, Math.PI, -Math.PI / 2]) parts.push(...k.place(spoke, { position: [0.042 * Math.cos(a), 0.042 * Math.sin(a), 0.004], rotation: [0, 0, a] }));
    return parts;
  },

  /** Tulipé : moyeu enfoncé de 5,5 cm vers la planche, trois branches alu percées de trous ronds. */
  tulipe() {
    const R = 0.186;
    /** @type {Parts} */
    const parts = [...ring(R, 0.015, VOLANT)];
    const zHub = -0.055;
    parts.push(...k.lathe([[0.04, zHub - 0.025], [0.04, zHub + 0.004], [0.032, zHub + 0.012], [0, zHub + 0.014]], { material: 'black', segments: 28 }));
    parts.push(...k.lathe([[0.026, zHub + 0.012], [0.022, zHub + 0.02], [0, zHub + 0.023]], { material: 'chrome', segments: 24 }));
    const r0 = 0.034;
    const r1 = R - 0.006;
    const z0 = zHub + 0.004;
    const z1 = -0.004;
    const len = Math.hypot(r1 - r0, z1 - z0);
    const tilt = Math.atan2(z1 - z0, r1 - r0);
    const holes = [0.035, 0.07, 0.105].map((u, i) => k.circle(u, 0, 0.0085 - i * 0.001, 14));
    const spoke = k.roundedExtrude(spokeOutline(len, 0.02, 0.014), { material: 'alu', depth: 0.005, bevel: 0.0018, bevelSegments: 1, holes });
    const leaning = k.place(spoke, { position: [r0, 0, z0], rotation: [0, -tilt, 0] });
    for (const a of [0, Math.PI, -Math.PI / 2]) parts.push(...k.place(leaning, { rotation: [0, 0, a] }));
    return parts;
  },

  /** Bois : jante vernie cerclée de rivets, trois branches polies ajourées, moyeu chromé. */
  bois() {
    const R = STEERING_RADIUS;
    /** @type {Parts} */
    const parts = [...ring(R, 0.0165, VOLANT)];
    for (let i = 0; i < 30; i += 1) {
      const a = (2 * Math.PI * (i + 0.5)) / 30;
      parts.push(...k.place(stud(0.0028, 'chrome'), { position: [R * Math.cos(a), R * Math.sin(a), 0.0155] }));
    }
    const zHub = -0.025;
    parts.push(...k.lathe([[0.042, zHub - 0.02], [0.042, zHub + 0.006], [0.034, zHub + 0.016], [0, zHub + 0.019]], { material: 'chrome', segments: 32 }));
    const r0 = 0.04;
    const r1 = R - 0.01;
    const len = Math.hypot(r1 - r0, -zHub - 0.006);
    const tilt = Math.atan2(-zHub - 0.006, r1 - r0);
    const holes = [0.04, 0.075, 0.11].map((u) => k.circle(u, 0, 0.0075, 14));
    const spoke = k.roundedExtrude(spokeOutline(len, 0.016, 0.012), { material: 'alu', depth: 0.004, bevel: 0.0015, bevelSegments: 1, holes });
    const leaning = k.place(spoke, { position: [r0, 0, zHub + 0.006], rotation: [0, -tilt, 0] });
    for (const a of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) parts.push(...k.place(leaning, { rotation: [0, 0, a - Math.PI / 2] }));
    return parts;
  },

  /** Moyeu large : gros coussin rembourré, trois branches pleines et leurs filets alu. */
  moyeu_large() {
    const R = STEERING_RADIUS;
    /** @type {Parts} */
    const parts = [...ring(R, 0.022, VOLANT)];
    parts.push(...k.place(k.roundedExtrude(k.roundedRect(0.17, 0.13, 0.045, 6), { material: 'black', depth: 0.05, bevel: 0.018, bevelSegments: 3 }), { position: [0, 0.004, 0.006] }));
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      parts.push(...k.place(k.roundedExtrude(k.roundedRect(0.12, 0.05, 0.02, 4), { material: 'black', depth: 0.016, bevel: 0.006, bevelSegments: 2 }), { position: [0.125 * Math.cos(a), 0.125 * Math.sin(a), 0.002], rotation: [0, 0, a] }));
      parts.push(...k.place(k.roundedExtrude(k.roundedRect(0.07, 0.006, 0.003, 2), { material: 'alu', depth: 0.004, bevel: 0.0012, bevelSegments: 1 }), { position: [0.12 * Math.cos(a), 0.12 * Math.sin(a), 0.011], rotation: [0, 0, a] }));
    }
    return parts;
  },
};

// ---------------------------------------------------------------------------------------------
// Pommeaux

/** Bague chromée qui serre le pommeau sur la tige. */
const collar = () => k.lathe([[0.0075, -0.014], [0.0105, -0.01], [0.0105, 0.001], [0.008, 0.004]], { material: 'chrome', axis: 'y', segments: 20 });

/** Éclair (même dessin que le médaillon du ciel étoilé), contour dans un carré de −1 à 1. */
const ECLAIR = /** @type {P2[]} */ ([
  [0.12, 0.92],
  [-0.42, 0.02],
  [-0.04, 0.02],
  [-0.2, -0.92],
  [0.44, 0.12],
  [0.06, 0.12],
  [0.34, 0.92],
]);

/** @type {Record<string, () => Parts>} */
const KNOBS = {
  boule: () => [...collar(), ...k.ellipsoid([0, 0.027, 0], [0.027, 0.027, 0.027], { material: POMMEAU, segments: 28 })],

  poire: () => [
    ...collar(),
    ...k.lathe(
      [
        [0.001, -0.002],
        [0.011, 0],
        [0.0135, 0.014],
        [0.019, 0.034],
        [0.025, 0.054],
        [0.0255, 0.066],
        [0.021, 0.078],
        [0.011, 0.085],
        [0, 0.087],
      ],
      { material: POMMEAU, axis: 'y', segments: 32, crease: 70 },
    ),
  ],

  cylindre: () => {
    /** @type {Parts} */
    const parts = [...collar()];
    parts.push(...k.lathe([[0.0005, 0], [0.016, 0.002], [0.016, 0.104], [0.012, 0.113], [0, 0.115]], { material: POMMEAU, axis: 'y', segments: 28, crease: 60 }));
    for (const y of [0.028, 0.082]) parts.push(...k.lathe([[0.0168, y - 0.003], [0.0172, y], [0.0168, y + 0.003]], { material: 'chrome', axis: 'y', segments: 28 }).map((p) => ({ material: p.material, geometry: k.doubleSided(p.geometry) })));
    parts.push(...k.lathe([[0.0122, 0.1125], [0.009, 0.1155], [0, 0.1162]], { material: 'chrome', axis: 'y', segments: 24 }));
    return parts;
  },

  motif: () => {
    const r = 0.028;
    const c = /** @type {P3} */ ([0, 0.028, 0]);
    /** @type {Parts} */
    const parts = [...collar(), ...k.ellipsoid(c, [r, r, r], { material: POMMEAU, segments: 28 })];
    // Éclair chromé en relief, sur la face tournée vers l'arrière et le haut (vu des sièges).
    const n = /** @type {P3} */ ([-0.78, 0.62, 0]);
    const l = Math.hypot(...n);
    const nn = /** @type {P3} */ (n.map((v) => v / l));
    const bolt = k.roundedExtrude(
      ECLAIR.map(([u, v]) => /** @type {P2} */ ([u * 0.0155, v * 0.0155])),
      { material: 'chrome', depth: 0.006, bevel: 0.0012, bevelSegments: 1 },
    );
    parts.push(...k.orient(bolt, { position: [c[0] + nn[0] * (r - 0.0015), c[1] + nn[1] * (r - 0.0015), c[2]], normal: nn, up: [0, 1, 0] }));
    // Filet chromé à l'équateur.
    parts.push(...k.tube(k.circle(0, 0, r * 0.995, 28).map(([a, b]) => /** @type {P3} */ ([a, c[1], b])), { material: 'chrome', radius: 0.0018, closed: true, segments: 40, radial: 6 }));
    return parts;
  },

  /** Crâne couleur os : orbites creuses, nez, mâchoire ouverte et dents, langue rouge tirée. */
  tete_de_mort: () => {
    const y0 = 0.034;
    /** @type {Parts} */
    const skull = [
      ...k.ellipsoid([0.004, 0.008, 0], [0.034, 0.031, 0.029], { material: POMMEAU, segments: 18 }),
      ...k.ellipsoid([-0.01, -0.026, 0], [0.02, 0.012, 0.019], { material: POMMEAU, segments: 14 }),
      ...k.ellipsoid([-0.03, 0.004, -0.012], [0.0075, 0.0095, 0.009], { material: 'black', segments: 10 }),
      ...k.ellipsoid([-0.03, 0.004, 0.012], [0.0075, 0.0095, 0.009], { material: 'black', segments: 10 }),
      ...k.ellipsoid([-0.033, -0.01, 0], [0.004, 0.005, 0.0035], { material: 'black', segments: 8 }),
      ...k.ellipsoid([-0.026, -0.021, 0], [0.008, 0.005, 0.013], { material: 'black', segments: 10 }),
      ...k.ellipsoid([-0.036, -0.03, 0], [0.008, 0.012, 0.0085], { material: 'tail', segments: 10 }),
    ];
    for (const z of [-0.012, -0.004, 0.004, 0.012]) {
      skull.push(...k.ellipsoid([-0.03, -0.016, z], [0.0035, 0.004, 0.003], { material: POMMEAU, segments: 6 }));
      skull.push(...k.ellipsoid([-0.026, -0.03, z], [0.003, 0.0035, 0.003], { material: POMMEAU, segments: 6 }));
    }
    return k.place(skull, { position: [0, y0, 0] });
  },
};

// ---------------------------------------------------------------------------------------------
// Sièges

/** Pavé arrondi : longueur `l` sur X, hauteur `h` sur Y, épaisseur `d` sur Z. */
const box = (/** @type {number} */ l, /** @type {number} */ h, /** @type {number} */ r, /** @type {number} */ d, /** @type {string} */ material, /** @type {number} */ bevel = 0.02) =>
  k.roundedExtrude(k.roundedRect(l, h, r, 6), { material, depth: d, bevel, bevelSegments: 2 });

/** Contour (z, y) d'un dossier à haut arrondi. @param {number} w @param {number} h @param {number} [bulge] @returns {P2[]} */
function archOutline(w, h, bulge = 0.55) {
  /** @type {P2[]} */
  const pts = [[-w / 2, 0], [w / 2, 0]];
  const r = w / 2;
  for (let i = 0; i <= 10; i += 1) {
    const a = (Math.PI * i) / 10;
    pts.push([r * Math.cos(a), h - r + r * Math.sin(a) * bulge]);
  }
  return pts;
}

/** Socle noir et glissières, du sol au dessous de l'assise. @param {number} top */
function pedestal(top) {
  return [
    ...k.place(box(0.34, top - 0.01, 0.02, 0.3, 'black', 0.012), { position: [0, (top - 0.01) / 2, 0] }),
    ...k.symmetric(k.place(box(0.46, 0.022, 0.008, 0.03, 'black', 0.008), { position: [0, 0.011, 0.15] })),
  ];
}

/**
 * Losanges rembourrés posés sur une face plane : grille de `cols` × `rows` coussins en losange, dans
 * un rectangle (u sur Z, v le long de la face) de `w` × `h`, chaque coussin bombé ; un bouton au
 * creux de chaque croisement.
 * @param {number} w @param {number} h @param {number} cols @param {number} rows
 */
function quilt(w, h, cols, rows) {
  const du = w / cols;
  const dv = h / rows;
  /** @type {Parts} */
  const parts = [];
  const diamond = /** @type {P2[]} */ ([
    [0, -dv / 2 + 0.004],
    [du / 2 - 0.004, 0],
    [0, dv / 2 - 0.004],
    [-du / 2 + 0.004, 0],
  ]);
  const pillow = k.roundedExtrude(diamond, { material: SELLERIE, depth: 0.03, bevel: 0.012, bevelSegments: 3, curveSegments: 2 });
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const odd = j % 2 === 1;
      const u = -w / 2 + (i + (odd ? 0.5 : 0)) * du;
      const v = j * dv;
      if (u > w / 2 + 1e-6 || (odd && i === cols)) continue;
      // Coussins entiers seulement, à l'intérieur du rectangle (les bords restent lisses).
      if (u - du / 2 < -w / 2 - 1e-6 || u + du / 2 > w / 2 + 1e-6 || v - dv / 2 < -1e-6 || v + dv / 2 > h + 1e-6) continue;
      parts.push(...k.place(pillow, { position: [u, v, 0] }));
    }
  }
  // Boutons aux croisements (sommets des losanges).
  for (let j = 0; j <= rows; j += 1) {
    for (let i = 0; i <= cols; i += 1) {
      const u = -w / 2 + (i + (j % 2 === 1 ? 0 : 0.5)) * du;
      const v = j * dv;
      if (u <= -w / 2 + 0.01 || u >= w / 2 - 0.01 || v <= 0.01 || v >= h - 0.01) continue;
      parts.push(...k.place(stud(0.006, 'black'), { position: [u, v, 0.006] }));
    }
  }
  return parts;
}

/** @type {Record<string, () => Parts>} */
const SEATS = {
  /** Baquet bas, sans appuie-tête, dossier arrondi en haut (les sièges de la Cox). */
  bas() {
    /** @type {Parts} */
    const parts = [...pedestal(0.25)];
    parts.push(...k.place(box(0.5, 0.11, 0.05, 0.44, SELLERIE, 0.035), { position: [0, 0.307, 0], rotation: [0, 0, 0.06] }));
    for (const s of [-1, 1]) parts.push(...k.place(box(0.46, 0.06, 0.03, 0.07, SELLERIE, 0.025), { position: [0, 0.377, s * 0.19], rotation: [0, 0, 0.06] }));
    const back = k.roundedExtrude(archOutline(0.44, 0.56), { material: SELLERIE, depth: 0.11, bevel: 0.03, bevelSegments: 2, axis: 'x' });
    parts.push(...k.place(back, { position: [-0.3, 0.347, 0], rotation: [0, 0, 0.17] }));
    for (const s of [-1, 1]) parts.push(...k.place(box(0.09, 0.4, 0.035, 0.06, SELLERIE, 0.022), { position: [-0.27, 0.587, s * 0.2], rotation: [0, 0, 0.17] }));
    parts.push(...k.place(box(0.06, 0.12, 0.02, 0.36, 'black', 0.015), { position: [-0.03, 0.207, 0] }));
    return parts;
  },

  /** Enveloppant : assise et dossier à bourrelets marqués, appuie-tête sur deux tiges (le van). */
  confort() {
    /** @type {Parts} */
    const parts = [...pedestal(0.21)];
    parts.push(...k.place(box(0.5, 0.12, 0.05, 0.5, SELLERIE, 0.03), { position: [0, 0.26, 0] }));
    parts.push(...k.place(box(0.12, 0.72, 0.05, 0.5, SELLERIE, 0.03), { position: [-0.28, 0.64, 0], rotation: [0, 0, 0.16] }));
    for (const s of [-1, 1]) {
      parts.push(...k.place(box(0.46, 0.07, 0.03, 0.07, SELLERIE, 0.025), { position: [0, 0.34, s * 0.22] }));
      parts.push(...k.place(box(0.13, 0.55, 0.04, 0.07, SELLERIE, 0.025), { position: [-0.25, 0.6, s * 0.23], rotation: [0, 0, 0.16] }));
      parts.push(...k.rod([-0.33, 0.98, s * 0.07], [-0.36, 1.07, s * 0.07], 0.006, { material: 'chrome', radial: 8 }));
    }
    parts.push(...k.place(box(0.1, 0.19, 0.045, 0.3, SELLERIE, 0.03), { position: [-0.37, 1.13, 0], rotation: [0, 0, 0.16] }));
    return parts;
  },

  /** Baquet course : coque haute d'un seul tenant, appuie-tête intégré, passages de harnais, flancs épais. */
  baquet() {
    /** @type {Parts} */
    const parts = [...pedestal(0.17)];
    // Coque (noire) : dossier haut à tête arrondie, percé de deux passages de harnais sous la tête.
    const shellH = 0.98;
    const harness = [-1, 1].map((s) => slot(0.0, 0.07, 0.016).map(([u, v]) => /** @type {P2} */ ([s * 0.075 + v, 0.6 + u])));
    const shell = k.roundedExtrude(archOutline(0.52, shellH, 0.75), { material: 'black', depth: 0.06, bevel: 0.022, bevelSegments: 2, axis: 'x', holes: harness });
    parts.push(...k.place(shell, { position: [-0.33, 0.2, 0], rotation: [0, 0, 0.14] }));
    // Garniture du dossier et de la tête (sellerie), dans la coque.
    const pad = k.roundedExtrude(archOutline(0.34, 0.6, 0.5), { material: SELLERIE, depth: 0.05, bevel: 0.02, bevelSegments: 2, axis: 'x' });
    parts.push(...k.place(pad, { position: [-0.27, 0.28, 0], rotation: [0, 0, 0.14] }));
    parts.push(...k.place(box(0.05, 0.13, 0.04, 0.22, SELLERIE, 0.02), { position: [-0.402, 1.032, 0], rotation: [0, 0, 0.14] }));
    // Flancs épais de la coque, de l'assise aux épaules.
    for (const s of [-1, 1]) {
      parts.push(...k.place(box(0.5, 0.13, 0.05, 0.08, 'black', 0.03), { position: [0.01, 0.3, s * 0.235] }));
      parts.push(...k.place(box(0.15, 0.56, 0.06, 0.09, 'black', 0.035), { position: [-0.34, 0.56, s * 0.235], rotation: [0, 0, 0.14] }));
    }
    parts.push(...k.place(box(0.48, 0.1, 0.05, 0.38, SELLERIE, 0.03), { position: [0.02, 0.25, 0], rotation: [0, 0, 0.05] }));
    parts.push(...k.place(box(0.5, 0.06, 0.03, 0.4, 'black', 0.02), { position: [0, 0.19, 0] }));
    return parts;
  },

  /** Capitonné : assise et dossier droits couverts de losanges rembourrés, boutons au creux. */
  capitonne() {
    /** @type {Parts} */
    const parts = [...pedestal(0.21)];
    parts.push(...k.place(box(0.5, 0.1, 0.04, 0.48, SELLERIE, 0.03), { position: [0, 0.255, 0] }));
    parts.push(...k.place(box(0.1, 0.66, 0.04, 0.48, SELLERIE, 0.03), { position: [-0.27, 0.61, 0], rotation: [0, 0, 0.15] }));
    // Losanges sur l'assise (face du dessus, u en travers, v de l'arrière vers l'avant) et sur le
    // dossier (face avant, v vers le haut).
    parts.push(...k.orient(quilt(0.4, 0.4, 4, 4), { position: [-0.2, 0.305, 0], normal: [0, 1, 0], up: [1, 0, 0] }));
    const t = 0.15;
    const [c, s] = [Math.cos(t), Math.sin(t)];
    const foot = /** @type {P3} */ ([-0.27 + 0.05 * c + 0.27 * s, 0.61 + 0.05 * s - 0.27 * c, 0]);
    parts.push(...k.orient(quilt(0.4, 0.54, 4, 5), { position: foot, normal: [c, s, 0], up: [-s, c, 0] }));
    // Passepoil chromé au bas du dossier.
    parts.push(...k.rod([-0.19, 0.29, -0.23], [-0.19, 0.29, 0.23], 0.004, { material: 'chrome', radial: 6 }));
    return parts;
  },
};

/** @param {Record<string, () => Parts>} table @param {Entry} entry @param {string} what */
function build(table, entry, what) {
  const style = table[entry.style];
  if (!style) throw new Error(`${what} « ${entry.id} » : style « ${entry.style} » inconnu (${Object.keys(table).join(', ')})`);
  return style();
}

/** @param {Entry} entry @returns {Parts} */
export const buildSteering = (entry) => build(STEERING, entry, 'volant');
/** @param {Entry} entry @returns {Parts} */
export const buildKnob = (entry) => build(KNOBS, entry, 'pommeau');
/** @param {Entry} entry @returns {Parts} */
export const buildSeat = (entry) => build(SEATS, entry, 'siège');
