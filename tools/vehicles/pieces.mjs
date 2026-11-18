// @ts-check
// Bibliothèque des pièces montées sur la caisse (§ 5.4, § 8) : pour l'instant le poste « aileron »
// (becquet, queue de canard, aileron bas, aileron haut sur supports, aileron démesuré), modelé une fois
// et posé par l'app sur les véhicules dont le manifeste déclare le poste (section `pieces`). Le
// catalogue est une donnée : public/assets/shared/pieces/catalogue.json. Substituts déclarés :
// placeholder_ailerons (TODO_ASSETS.md). Aucun logo, aucun marquage.
//
// Repère d'une option (mètres), largeur de référence du poste (catalogue, reference.width = 1,2 m) :
// - nœud « surface » (becquet, queue de canard) : le bord de fuite de la surface de pose à l'origine,
//   sur l'axe ; +X vers l'avant le long de la surface, +Y selon sa normale, la largeur sur Z de
//   −0,6 à +0,6 ; le dessous à y ≈ 0 (enfoncé de 4 mm, pour ne jamais laisser de jour). L'app le
//   tourne sur la normale du manifeste, le met à la largeur utile et au bombé (src/data/pieces.ts) ;
// - nœud « niveau » (ailerons sur supports) : le milieu des pieds à l'origine, sur l'axe, +X vers
//   l'avant du véhicule, +Y vers le haut ; pieds centrés en z = ±reference.feet ; tout ce qui est au
//   ras de y = 0 (dessous des pieds, semelles) descend sur la surface, le reste ne bouge pas ; la lame
//   et ses dérives (bouts à |z| ≥ 0,54) vont à l'envergure du manifeste.
// Matériaux : `paint_piece` (couleur et finition de la carrosserie, ou couleur propre), et les rôles.

import { readFileSync } from 'node:fs';
import { ExtrudeGeometry, Shape, Vector2 } from 'three';
import * as k from './kit.mjs';

/** @typedef {import('./kit.mjs').Parts} Parts */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {{ id: string, style: string, mount: 'surface' | 'supports', label: string, phrase: string, hint?: string, spanFactor?: number, picto: string }} Option */
/** @typedef {{ id: string, label: string, absent: string, colorLabel: string, none: { id: string, label: string, hint?: string, phrase: string }, reference: { width: number, feet: number }, picto: string, options: Option[] }} Poste */
/** @typedef {{ postes: Poste[] }} Catalogue */

export const CATALOGUE_URL = new URL('../../public/assets/shared/pieces/catalogue.json', import.meta.url);

/** @returns {Catalogue} */
export function readCatalogue() {
  return JSON.parse(readFileSync(CATALOGUE_URL, 'utf8'));
}

/** Fichier d'une option, sous public/assets/shared/pieces/ (même nom que src/data/pieces.ts, pieceFile). */
export const pieceFile = (/** @type {string} */ poste, /** @type {string} */ option) => `${poste}_${option}.glb`;

/** Nœuds d'un fichier de pièce (mêmes noms que src/data/pieces.ts, PIECE_NODES). */
export const NODES = Object.freeze({ surface: 'surface', level: 'niveau' });

const PAINT = 'paint_piece';
/** Demi-largeur de référence (catalogue : reference.width / 2). */
const HALF = 0.6;
/** Milieu des pieds de référence (catalogue : reference.feet). */
const FEET = 0.3;

// ---------------------------------------------------------------------------------------------
// Outils de forme

/**
 * Extrusion le long de Z d'un contour (x, y), centrée, en `steps` tranches (pour que l'app puisse
 * cintrer la pièce au bombé de la surface), bords arrondis de `bevel`. `shape(z)` : facteur de hauteur
 * appliqué au-dessus de y = 0 selon z (pièce qui s'amincit vers ses bouts).
 * @param {P2[]} outline @param {{ material: string, depth: number, steps?: number, bevel?: number, crease?: number, taper?: (z: number) => number }} o
 * @returns {Parts}
 */
function extrudeZ(outline, o) {
  const shape = new Shape(outline.map(([u, v]) => new Vector2(u, v)));
  const bevel = Math.min(o.bevel ?? 0, o.depth / 2 - 1e-4);
  const g = new ExtrudeGeometry(shape, {
    depth: o.depth - 2 * bevel,
    steps: o.steps ?? 1,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  g.translate(0, 0, -(o.depth - 2 * bevel) / 2);
  if (o.taper) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 1) {
      const y = p.getY(i);
      if (y > 0) p.setY(i, y * o.taper(p.getZ(i)));
    }
  }
  return [{ material: o.material, geometry: k.smooth(g, o.crease ?? 38) }];
}

/**
 * Profil d'aile inversée (l'appui vers le bas : le ventre bombé) : bord d'attaque vers +X, corde
 * `chord`, épaisseur relative `thick`, cambrure relative `camber`, incidence `aoa` en degrés (bord de
 * fuite relevé), centré en (cx, cy).
 * @param {{ chord: number, thick: number, camber: number, aoa: number, cx: number, cy: number, n?: number }} o
 * @returns {P2[]}
 */
export function airfoil(o) {
  const n = o.n ?? 16;
  const c = o.chord;
  const yt = (/** @type {number} */ u) => 5 * o.thick * (0.2969 * Math.sqrt(u) - 0.126 * u - 0.3516 * u * u + 0.2843 * u ** 3 - 0.1036 * u ** 4);
  const yc = (/** @type {number} */ u) => -o.camber * 4 * u * (1 - u);
  /** @type {P2[]} */
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const u = (1 - Math.cos((Math.PI * i) / n)) / 2;
    pts.push([c / 2 - u * c, (yc(u) + yt(u)) * c]);
  }
  for (let i = n - 1; i >= 1; i -= 1) {
    const u = (1 - Math.cos((Math.PI * i) / n)) / 2;
    pts.push([c / 2 - u * c, (yc(u) - yt(u)) * c]);
  }
  // Bord de fuite relevé : rotation horaire autour du milieu de la corde.
  const a = (o.aoa * Math.PI) / 180;
  return pts.map(([x, y]) => [o.cx + x * Math.cos(a) + y * Math.sin(a), o.cy - x * Math.sin(a) + y * Math.cos(a)]);
}

/** Point le plus bas d'un contour. @param {P2[]} outline */
const lowest = (outline) => Math.min(...outline.map(([, y]) => y));

/**
 * Contour d'un pied (pilier plat dans le plan XY) : base de x0 à x1 en y = base, haut de t0 à t1 en
 * y = top, coins adoucis.
 * @param {{ x0: number, x1: number, t0: number, t1: number, base: number, top: number, r?: number }} o
 * @returns {P2[]}
 */
function pylon(o) {
  const r = o.r ?? 0.006;
  return [
    [o.x0 + r, o.base],
    [o.x1 - r, o.base],
    [o.x1, o.base + r],
    [o.t1, o.top - r],
    [o.t1 - r, o.top],
    [o.t0 + r, o.top],
    [o.t0, o.top - r],
    [o.x0, o.base + r],
  ];
}

/**
 * Dérive (plaque de bout de lame), dans le plan XY, posée à z = ±(HALF + épaisseur / 2) : un trapèze
 * aux coins arrondis, plus haut à l'arrière.
 * @param {{ front: number, back: number, low: number, high: number, rake?: number, thick: number, material: string, r?: number }} o
 * @returns {Parts}
 */
function endPlates(o) {
  const r = o.r ?? 0.02;
  const rake = o.rake ?? 0;
  /** @type {P2[]} */
  const outline = [];
  const corners = /** @type {[number, number, number][]} */ ([
    [o.front - r, o.low + r, -90],
    [o.front - r, o.high - rake - r, 0],
    [o.back + r, o.high - r, 90],
    [o.back + r, o.low + r, 180],
  ]);
  for (const [cx, cy, a0] of corners)
    for (let i = 0; i <= 4; i += 1) {
      const a = ((a0 + (90 * i) / 4) * Math.PI) / 180;
      outline.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  const plate = k.roundedExtrude(outline, { material: o.material, depth: o.thick, bevel: Math.min(0.003, o.thick / 3), bevelSegments: 2, curveSegments: 6 });
  return k.symmetric(k.place(plate, { position: [0, 0, HALF + o.thick / 2] }));
}

/**
 * Pieds à z = ±FEET : pilier plat d'épaisseur `thick`, percé de `holes` (cercles x, y, rayon).
 * @param {P2[]} outline @param {{ material: string, thick: number, holes?: [number, number, number][] }} o
 * @returns {Parts}
 */
function feet(outline, o) {
  const holes = (o.holes ?? []).map(([x, y, r]) => k.circle(x, y, r, 16).reverse());
  const one = k.roundedExtrude(outline, { material: o.material, depth: o.thick, bevel: Math.min(0.0025, o.thick / 3), bevelSegments: 2, holes, curveSegments: 8 });
  return k.symmetric(k.place(one, { position: [0, 0, FEET] }));
}

/**
 * Semelle sous chaque pied : plaque mince posée au ras de y = 0 (elle suit la surface).
 * @param {{ x0: number, x1: number, w: number, material: string }} o
 * @returns {Parts}
 */
function soles(o) {
  const outline = k.roundedRect(o.x1 - o.x0, o.w, 0.008, 3).map(([u, v]) => /** @type {P2} */ ([u + (o.x0 + o.x1) / 2, v]));
  const sole = k.roundedExtrude(outline, { material: o.material, depth: 0.008, bevel: 0.002, bevelSegments: 1, axis: 'y' });
  // axis 'y' : (u, v) = (x, z), épaisseur centrée sur y = 0 : de −4 à +4 mm.
  return k.symmetric(k.place(sole, { position: [0, 0, FEET] }));
}

/**
 * Vis chromées sur la face extérieure des dérives.
 * @param {P2[]} at @param {number} plate épaisseur de la dérive
 * @returns {Parts}
 */
function bolts(at, plate) {
  /** @type {Parts} */
  const parts = [];
  for (const [x, y] of at) parts.push(...k.rod([x, y, HALF + plate - 0.001], [x, y, HALF + plate + 0.004], 0.0065, { material: 'chrome', radial: 10 }));
  return k.symmetric(parts);
}

/**
 * Lame : profil d'aile extrudé sur toute la largeur de référence.
 * @param {Parameters<typeof airfoil>[0]} o @param {string} [material]
 * @returns {Parts}
 */
function blade(o, material = PAINT) {
  return extrudeZ(airfoil(o), { material, depth: 2 * HALF, bevel: 0.004, crease: 50 });
}

// ---------------------------------------------------------------------------------------------
// Les options

/** Becquet : une lèvre mince au bord de fuite, relevée de 3 cm, qui s'efface vers les bouts. @returns {Parts} */
function becquet() {
  /** @type {P2[]} */
  const outline = [
    [0.075, -0.004],
    [-0.012, -0.004],
    [-0.024, 0.004],
    [-0.031, 0.02],
    [-0.03, 0.03],
    [-0.022, 0.034],
    [-0.006, 0.028],
    [0.02, 0.017],
    [0.05, 0.007],
    [0.075, 0.001],
  ];
  return extrudeZ(outline, { material: PAINT, depth: 2 * HALF, steps: 16, bevel: 0.003, taper: (z) => 1 - 0.55 * (Math.abs(z) / HALF) ** 6, crease: 40 });
}

/** Queue de canard : le bord du coffre prolongé et relevé, creusé sur le dessus. @returns {Parts} */
function queueDeCanard() {
  /** @type {P2[]} */
  const outline = [
    [0.26, -0.004],
    [-0.028, -0.004],
    [-0.048, 0.016],
    [-0.058, 0.064],
    [-0.054, 0.084],
    [-0.042, 0.089],
    [-0.012, 0.068],
    [0.04, 0.043],
    [0.1, 0.024],
    [0.18, 0.009],
    [0.26, 0.001],
  ];
  return extrudeZ(outline, { material: PAINT, depth: 2 * HALF, steps: 20, bevel: 0.004, taper: (z) => 1 - 0.3 * (Math.abs(z) / HALF) ** 4, crease: 40 });
}

/** Aileron bas : lame courte à 10 cm, petites dérives, deux pattes peintes. @returns {Parts} */
function aileronBas() {
  const wing = { chord: 0.2, thick: 0.12, camber: 0.03, aoa: 6, cx: -0.03, cy: 0.112 };
  const low = lowest(airfoil(wing));
  return [
    ...blade(wing),
    ...endPlates({ front: 0.085, back: -0.15, low: low - 0.035, high: 0.168, rake: 0.025, thick: 0.007, material: PAINT, r: 0.018 }),
    ...feet(pylon({ x0: -0.07, x1: 0.075, t0: -0.06, t1: 0.03, base: -0.004, top: low + 0.012, r: 0.008 }), { material: PAINT, thick: 0.016 }),
  ];
}

/** Aileron haut : lame à 30 cm, sur supports alu ajourés et semelles noires, dérives vissées. @returns {Parts} */
function aileronHaut() {
  const wing = { chord: 0.25, thick: 0.115, camber: 0.04, aoa: 9, cx: -0.065, cy: 0.318 };
  const low = lowest(airfoil(wing));
  const top = low + 0.012;
  return [
    ...blade(wing),
    ...endPlates({ front: 0.085, back: -0.215, low: low - 0.05, high: 0.405, rake: 0.04, thick: 0.008, material: PAINT, r: 0.022 }),
    ...feet(pylon({ x0: -0.035, x1: 0.095, t0: -0.115, t1: -0.02, base: -0.004, top, r: 0.008 }), {
      material: 'alu',
      thick: 0.012,
      holes: [
        [0.012, 0.085, 0.022],
        [-0.034, 0.19, 0.019],
      ],
    }),
    ...soles({ x0: -0.05, x1: 0.11, w: 0.04, material: 'black' }),
    ...bolts(
      [
        [0.03, low - 0.02],
        [-0.16, 0.36],
      ],
      0.008,
    ),
  ];
}

/** Aileron démesuré : grande lame et volet, dérives noires géantes, cols de cygne noirs. @returns {Parts} */
function demesure() {
  const main = { chord: 0.34, thick: 0.11, camber: 0.045, aoa: 10, cx: -0.07, cy: 0.52 };
  const flap = { chord: 0.12, thick: 0.1, camber: 0.04, aoa: 28, cx: -0.26, cy: 0.585 };
  const low = lowest(airfoil(main));
  return [
    ...blade(main),
    ...blade(flap),
    ...endPlates({ front: 0.135, back: -0.355, low: low - 0.11, high: 0.73, rake: 0.08, thick: 0.01, material: 'black', r: 0.03 }),
    ...feet(pylon({ x0: -0.03, x1: 0.125, t0: -0.15, t1: -0.035, base: -0.004, top: low + 0.014, r: 0.01 }), {
      material: 'black',
      thick: 0.016,
      holes: [
        [0.03, 0.12, 0.03],
        [-0.03, 0.27, 0.026],
        [-0.075, 0.4, 0.02],
      ],
    }),
    ...soles({ x0: -0.045, x1: 0.135, w: 0.04, material: 'black' }),
    ...bolts(
      [
        [0.08, low - 0.06],
        [-0.3, 0.68],
        [-0.3, low - 0.06],
        [0.08, 0.64],
      ],
      0.01,
    ),
  ];
}

/** @type {Record<string, () => Parts>} */
const STYLES = {
  becquet,
  queue_de_canard: queueDeCanard,
  aileron_bas: aileronBas,
  aileron_haut: aileronHaut,
  demesure,
};

/**
 * Pièces d'une option, par nœud : « surface » pour une pièce qui épouse la surface, « niveau » pour
 * un aileron sur supports.
 * @param {Option} option
 * @returns {{ node: string, parts: Parts }}
 */
export function buildPiece(option) {
  const make = STYLES[option.style];
  if (!make) throw new Error(`pièce « ${option.id} » : style « ${option.style} » inconnu (${Object.keys(STYLES).join(', ')})`);
  return { node: option.mount === 'surface' ? NODES.surface : NODES.level, parts: make() };
}

/**
 * Pièce la plus lourde qu'un véhicule accepte, par poste déclaré dans son manifeste.
 * @param {{ pieces?: Record<string, { options?: string[], supports?: unknown }> }} manifest
 * @param {Map<string, { triangles: number, primitives: number }>} summaries résumé par fichier
 * @returns {{ postes: number, triangles: number, drawCalls: number }}
 */
export function piecesWorst(manifest, summaries) {
  const catalogue = readCatalogue();
  let triangles = 0;
  let drawCalls = 0;
  let postes = 0;
  for (const [id, mount] of Object.entries(manifest.pieces ?? {})) {
    const poste = catalogue.postes.find((item) => item.id === id);
    if (!poste) continue;
    postes += 1;
    const allowed = poste.options.filter((option) => (!mount.options || mount.options.includes(option.id)) && (option.mount === 'surface' || mount.supports));
    const list = allowed.map((option) => summaries.get(pieceFile(id, option.id))).filter((s) => s !== undefined);
    triangles += Math.max(0, ...list.map((s) => s.triangles));
    drawCalls += Math.max(0, ...list.map((s) => s.primitives));
  }
  return { postes, triangles, drawCalls };
}
