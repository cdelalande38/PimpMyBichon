// @ts-check
// Bibliothèque des pièces montées sur la caisse (§ 5.4, § 8) : le poste « aileron » (becquet, queue de
// canard, aileron bas, aileron haut sur supports, aileron démesuré) et le kit carrosserie (lame avant,
// jupes, diffuseur), modelés une fois et posés par l'app sur les véhicules dont le manifeste déclare le
// poste (section `pieces`). Le catalogue est une donnée : public/assets/shared/pieces/catalogue.json.
// Substituts déclarés : placeholder_ailerons et placeholder_kit_carrosserie (TODO_ASSETS.md). Aucun logo,
// aucun marquage.
//
// Repère d'une option (mètres), largeur de référence du poste (catalogue, reference.width = 1,2 m) :
// - nœud « surface » (becquet, queue de canard) : le bord de fuite de la surface de pose à l'origine,
//   sur l'axe ; +X vers l'avant le long de la surface, +Y selon sa normale, la largeur sur Z de
//   −0,6 à +0,6 ; le dessous à y ≈ 0 (enfoncé de 4 mm, pour ne jamais laisser de jour). L'app le
//   tourne sur la normale du manifeste, le met à la largeur utile et au bombé (src/data/pieces.ts) ;
// - nœud « niveau » (ailerons sur supports) : le milieu des pieds à l'origine, sur l'axe, +X vers
//   l'avant du véhicule, +Y vers le haut ; pieds centrés en z = ±reference.feet ; tout ce qui est au
//   ras de y = 0 (dessous des pieds, semelles) descend sur la surface, le reste ne bouge pas ; la lame
//   et ses dérives (bouts à |z| ≥ 0,54) vont à l'envergure du manifeste ;
// - nœud « rail » (kit carrosserie) : la ligne de pose (la face de la caisse, en bas) sur l'axe Z, de
//   −width/2 à +width/2 (catalogue, reference.width) ; +X vers le dehors (l'avant pour une lame, le
//   flanc droit pour une jupe, l'arrière pour un diffuseur), +Y vers le haut. La face intérieure est à
//   x ≈ −4 mm (enfoncée dans la caisse) ; ce qui monte au-dessus de y = 0 tient contre la face (au plus
//   `rise` de l'option), ce qui descend dessous (au plus `depth`) se tasse au-dessus du bas de caisse.
//   Jupes : −Z vers l'avant du véhicule (la jupe droite ; l'app pose la gauche en miroir).
// Matériaux : `paint_piece` (couleur et finition de la carrosserie, ou couleur propre), et les rôles.

import { readFileSync } from 'node:fs';
import { BufferAttribute, BufferGeometry, ExtrudeGeometry, Shape, ShapeUtils, Vector2 } from 'three';
import * as k from './kit.mjs';

/** @typedef {import('./kit.mjs').Parts} Parts */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {{ id: string, style: string, mount: 'surface' | 'supports' | 'rail' | 'capot', label: string, phrase: string, hint?: string, spanFactor?: number, rise?: number, depth?: number, picto: string }} Option */
/** @typedef {{ id: string, label: string, groupe?: string, mirror?: boolean, plural?: boolean, absent: string, colorLabel: string, none: { id: string, label: string, hint?: string, phrase: string }, reference: { width: number, feet?: number, ends?: number }, picto: string, options: Option[] }} Poste */
/** @typedef {{ groupes?: { id: string, label: string, absent: string }[], postes: Poste[] }} Catalogue */

export const CATALOGUE_URL = new URL('../../public/assets/shared/pieces/catalogue.json', import.meta.url);

/** @returns {Catalogue} */
export function readCatalogue() {
  return JSON.parse(readFileSync(CATALOGUE_URL, 'utf8'));
}

/** Fichier d'une option, sous public/assets/shared/pieces/ (même nom que src/data/pieces.ts, pieceFile). */
export const pieceFile = (/** @type {string} */ poste, /** @type {string} */ option) => `${poste}_${option}.glb`;

/** Nœuds d'un fichier de pièce (mêmes noms que src/data/pieces.ts, PIECE_NODES). */
export const NODES = Object.freeze({ surface: 'surface', level: 'niveau', rail: 'rail' });

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


// ---------------------------------------------------------------------------------------------
// Kit carrosserie (pièces sur rail) : outils de forme

/**
 * Coins arrondis d'un contour fermé : chaque sommet devient un arc (Bézier quadratique) de `n`
 * tronçons, de rayon r (un nombre, ou un par sommet), borné à 45 % des côtés voisins. Le nombre de
 * points ne dépend pas de la forme : les sections d'un balayage restent compatibles.
 * @param {P2[]} pts @param {number | number[]} r @param {number} [n]
 * @returns {P2[]}
 */
function fillet(pts, r, n = 2) {
  /** @type {P2[]} */
  const out = [];
  const m = pts.length;
  for (let i = 0; i < m; i += 1) {
    const p = k.at(pts, i);
    const a = k.at(pts, (i - 1 + m) % m);
    const b = k.at(pts, (i + 1) % m);
    const la = Math.hypot(a[0] - p[0], a[1] - p[1]) || 1;
    const lb = Math.hypot(b[0] - p[0], b[1] - p[1]) || 1;
    const d = Math.max(2e-4, Math.min(typeof r === 'number' ? r : k.at(r, i), 0.45 * la, 0.45 * lb));
    /** @type {P2} */
    const p0 = [p[0] + ((a[0] - p[0]) * d) / la, p[1] + ((a[1] - p[1]) * d) / la];
    /** @type {P2} */
    const p2 = [p[0] + ((b[0] - p[0]) * d) / lb, p[1] + ((b[1] - p[1]) * d) / lb];
    for (let j = 0; j <= n; j += 1) {
      const t = j / n;
      const [u, v, w] = [(1 - t) * (1 - t), 2 * t * (1 - t), t * t];
      out.push([u * p0[0] + v * p[0] + w * p2[0], u * p0[1] + v * p[1] + w * p2[1]]);
    }
  }
  return out;
}

/**
 * Section mise à l'échelle autour de la ligne de pose : ce qui dépasse dehors (x > 0) par `out`, ce
 * qui monte (y > 0) par `up`, ce qui descend (y < 0) par `down`. Pour amincir une pièce vers ses bouts.
 * @param {P2[]} pts @param {{ out?: number, up?: number, down?: number }} f
 * @returns {P2[]}
 */
function shrink(pts, f) {
  return pts.map(([x, y]) => [x > 0 ? x * (f.out ?? 1) : x, y > 0 ? y * (f.up ?? 1) : y * (f.down ?? 1)]);
}

/** Rampe douce de 0 (à `from`) à 1 (à `to`). @param {number} from @param {number} to @param {number} v */
function ramp(from, to, v) {
  const t = Math.min(1, Math.max(0, (v - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/**
 * Stations le long de Z, de −half à +half : au pas `step` au milieu, au pas `fine` sur les `ends` mètres
 * de chaque bout (là où la pièce s'amincit).
 * @param {number} half @param {number} ends @param {number} step @param {number} fine
 * @returns {number[]}
 */
function stations(half, ends, step, fine) {
  /** @type {number[]} */
  const zs = [];
  for (let z = -half; z < -half + ends - 1e-9; z += fine) zs.push(z);
  const inner = half - ends;
  const n = Math.max(1, Math.round((2 * inner) / step));
  for (let i = 0; i <= n; i += 1) zs.push(-inner + (2 * inner * i) / n);
  for (let z = inner + fine; z < half - 1e-9; z += fine) zs.push(z);
  zs.push(half);
  return zs;
}

/**
 * Balayage le long de Z : une section fermée (x, y) par station, toutes du même nombre de points,
 * reliées en surface, fermée par deux bouchons plats (triangulés). Arêtes franches au-delà de `crease`.
 * @param {(z: number) => P2[]} section @param {number[]} zs @param {{ material: string, crease?: number }} o
 * @returns {Parts}
 */
function sweepZ(section, zs, o) {
  const rings = zs.map((z) => ({ z, pts: section(z) }));
  const m = k.at(rings, 0).pts.length;
  for (const r of rings) if (r.pts.length !== m) throw new Error(`balayage : sections de ${m} et ${r.pts.length} points`);
  const ref = k.at(rings, Math.floor(rings.length / 2)).pts;
  let area = 0;
  for (let j = 0; j < m; j += 1) {
    const a = k.at(ref, j);
    const b = k.at(ref, (j + 1) % m);
    area += a[0] * b[1] - b[0] * a[1];
  }
  const ccw = area > 0;
  /** @type {number[]} */
  const pos = [];
  for (const r of rings) for (const [x, y] of r.pts) pos.push(x, y, r.z);
  /** @type {number[]} */
  const idx = [];
  for (let i = 0; i < rings.length - 1; i += 1) {
    for (let j = 0; j < m; j += 1) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + j;
      const d = (i + 1) * m + ((j + 1) % m);
      if (ccw) idx.push(a, b, d, a, d, c);
      else idx.push(a, d, b, a, c, d);
    }
  }
  // Bouchons : contour remis dans le sens trigonométrique, triangulé (face vers +Z), retourné au départ.
  const order = Array.from({ length: m }, (_, j) => (ccw ? j : m - 1 - j));
  for (const [ringIndex, start] of /** @type {[number, boolean][]} */ ([
    [0, true],
    [rings.length - 1, false],
  ])) {
    const pts = k.at(rings, ringIndex).pts;
    const faces = ShapeUtils.triangulateShape(
      order.map((j) => new Vector2(...k.at(pts, j))),
      [],
    );
    const vertex = (/** @type {number} */ v) => ringIndex * m + k.at(order, v);
    for (const face of faces) {
      const [ia, ib, ic] = [vertex(k.at(face, 0)), vertex(k.at(face, 1)), vertex(k.at(face, 2))];
      if (start) idx.push(ia, ic, ib);
      else idx.push(ia, ib, ic);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  return [{ material: o.material, geometry: k.smooth(g, o.crease ?? 35) }];
}

/**
 * Plaque verticale (dérive, ailette) : contour (x, y), épaisseur `thick` en z, centrée en `z`.
 * @param {P2[]} outline @param {{ z: number, thick: number, material: string, r?: number }} o
 * @returns {Parts}
 */
function plate(outline, o) {
  const shaped = fillet(outline, o.r ?? 0.006, 3);
  const one = k.roundedExtrude(shaped, { material: o.material, depth: o.thick, bevel: Math.min(0.002, o.thick / 4), bevelSegments: 1, curveSegments: 4 });
  return k.place(one, { position: [0, 0, o.z] });
}

/** Demi-largeurs de modelage (catalogue, reference.width / 2) et bouts gardés tels quels (reference.ends). */
const LAME = { half: 0.6, ends: 0.1 };
const JUPE = { half: 1.0, ends: 0.12 };
const DIFF = { half: 0.7, ends: 0.08 };

/** Part de la pièce gardée au bout : 0 à la toute fin, 1 à `ends` du bout. @param {{ half: number, ends: number }} ref @param {number} z */
const endFactor = (ref, z) => ramp(0, ref.ends, ref.half - Math.abs(z));

// ---------------------------------------------------------------------------------------------
// Kit carrosserie : les options

/** Lame discrète : une lèvre mince sous le bouclier, qui dépasse de 4 cm. @returns {Parts} */
function lameDiscrete() {
  /** @type {P2[]} */
  const base = [
    [-0.006, 0.02],
    [0.006, 0.02],
    [0.013, 0.012],
    [0.015, 0.002],
    [0.04, -0.008],
    [0.047, -0.015],
    [0.042, -0.022],
    [0.0, -0.026],
    [-0.045, -0.024],
    [-0.045, -0.006],
    [-0.006, -0.002],
  ];
  const radii = [0.001, 0.004, 0.004, 0.008, 0.004, 0.004, 0.004, 0.008, 0.003, 0.003, 0.002];
  const section = (/** @type {number} */ z) => {
    const e = endFactor(LAME, z);
    return fillet(shrink(base, { out: 0.25 + 0.75 * e, up: 0.5 + 0.5 * e, down: 0.45 + 0.55 * e }), radii);
  };
  return sweepZ(section, stations(LAME.half, LAME.ends, 0.04, 0.0125), { material: PAINT });
}

/** Lame sport : un menton anguleux qui dépasse de 7 cm, fermé à chaque bout par une dérive noire. @returns {Parts} */
function lameSport() {
  /** @type {P2[]} */
  const base = [
    [-0.006, 0.035],
    [0.008, 0.035],
    [0.016, 0.026],
    [0.018, 0.004],
    [0.066, -0.026],
    [0.074, -0.034],
    [0.07, -0.044],
    [0.02, -0.05],
    [-0.06, -0.048],
    [-0.06, -0.025],
    [-0.006, -0.004],
  ];
  const radii = [0.001, 0.004, 0.005, 0.004, 0.003, 0.004, 0.003, 0.006, 0.003, 0.003, 0.002];
  const section = (/** @type {number} */ z) => {
    const e = endFactor(LAME, z);
    return fillet(shrink(base, { out: 0.7 + 0.3 * e, up: 0.85 + 0.15 * e, down: 0.8 + 0.2 * e }), radii);
  };
  /** @type {P2[]} */
  const fin = [
    [-0.035, 0.012],
    [0.028, 0.012],
    [0.092, -0.026],
    [0.092, -0.058],
    [0.066, -0.072],
    [-0.035, -0.058],
  ];
  return [
    ...sweepZ(section, stations(LAME.half, LAME.ends, 0.04, 0.0125), { material: PAINT }),
    ...plate(fin, { z: LAME.half - 0.028, thick: 0.012, material: 'black' }),
    ...plate(fin, { z: -(LAME.half - 0.028), thick: 0.012, material: 'black' }),
  ];
}

/** Lame large de course : bouclier prolongé, lame noire de 14 cm en avant, plaques de bout et jambes de force. @returns {Parts} */
function lameCourse() {
  /** @type {P2[]} */
  const band = [
    [-0.006, 0.05],
    [0.01, 0.05],
    [0.02, 0.04],
    [0.03, 0.004],
    [0.042, -0.026],
    [0.036, -0.035],
    [-0.07, -0.035],
    [-0.07, -0.02],
    [-0.006, -0.004],
  ];
  const bandRadii = [0.001, 0.005, 0.006, 0.01, 0.004, 0.003, 0.003, 0.003, 0.002];
  /** @type {P2[]} */
  const blade = [
    [-0.1, -0.033],
    [0.132, -0.033],
    [0.145, -0.04],
    [0.134, -0.047],
    [-0.1, -0.047],
  ];
  const bandSection = (/** @type {number} */ z) => {
    const e = endFactor(LAME, z);
    return fillet(shrink(band, { out: 0.75 + 0.25 * e, up: 0.8 + 0.2 * e }), bandRadii);
  };
  const bladeSection = (/** @type {number} */ z) => fillet(shrink(blade, { out: 0.55 + 0.45 * endFactor(LAME, z) }), [0.002, 0.004, 0.004, 0.004, 0.002]);
  /** @type {P2[]} */
  const end = [
    [-0.04, 0.03],
    [0.06, 0.03],
    [0.15, -0.018],
    [0.15, -0.047],
    [-0.04, -0.047],
  ];
  /** @type {Parts} */
  const struts = [];
  for (const z of [-0.28, 0.28]) struts.push(...k.rod([0.118, -0.034, z], [0.03, 0.0, z], 0.0045, { material: 'alu', radial: 10 }));
  return [
    ...sweepZ(bandSection, stations(LAME.half, LAME.ends, 0.04, 0.0125), { material: PAINT }),
    ...sweepZ(bladeSection, stations(LAME.half, LAME.ends, 0.06, 0.025), { material: 'black', crease: 30 }),
    ...plate(end, { z: LAME.half - 0.018, thick: 0.01, material: 'black', r: 0.008 }),
    ...plate(end, { z: -(LAME.half - 0.018), thick: 0.01, material: 'black', r: 0.008 }),
    ...struts,
  ];
}

/** Jupes fines : un jonc arrondi qui épaissit le bas de caisse. @returns {Parts} */
function jupesFines() {
  /** @type {P2[]} */
  const base = [
    [-0.006, 0.025],
    [0.004, 0.025],
    [0.01, 0.016],
    [0.012, 0.002],
    [0.026, -0.016],
    [0.026, -0.038],
    [0.014, -0.05],
    [-0.03, -0.049],
    [-0.03, -0.015],
    [-0.006, -0.003],
  ];
  const radii = [0.001, 0.004, 0.004, 0.008, 0.006, 0.008, 0.006, 0.003, 0.003, 0.002];
  const section = (/** @type {number} */ z) => {
    const e = endFactor(JUPE, z);
    return fillet(shrink(base, { out: 0.15 + 0.85 * e, up: 0.6 + 0.4 * e, down: 0.5 + 0.5 * e }), radii);
  };
  return sweepZ(section, stations(JUPE.half, JUPE.ends, 0.08, 0.02), { material: PAINT });
}

/** Jupes sport : une arête vive, une lèvre basse, une dérive noire devant la roue arrière. @returns {Parts} */
function jupesSport() {
  /** @type {P2[]} */
  const base = [
    [-0.006, 0.06],
    [0.004, 0.06],
    [0.012, 0.05],
    [0.03, 0.012],
    [0.034, 0.006],
    [0.04, -0.05],
    [0.054, -0.07],
    [0.048, -0.082],
    [0.0, -0.085],
    [-0.04, -0.082],
    [-0.04, -0.03],
    [-0.006, -0.004],
  ];
  const radii = [0.001, 0.004, 0.006, 0.0015, 0.003, 0.006, 0.003, 0.004, 0.006, 0.003, 0.003, 0.002];
  const section = (/** @type {number} */ z) => {
    const e = endFactor(JUPE, z);
    const keep = z > 0 ? 0.55 + 0.45 * e : 0.1 + 0.9 * e;
    return fillet(shrink(base, { out: keep, up: 0.6 + 0.4 * e, down: 0.6 + 0.4 * e }), radii);
  };
  /** @type {P2[]} */
  const flick = [
    [-0.012, 0.042],
    [0.03, 0.042],
    [0.088, 0.0],
    [0.088, -0.06],
    [0.055, -0.082],
    [-0.012, -0.075],
  ];
  return [...sweepZ(section, stations(JUPE.half, JUPE.ends, 0.08, 0.02), { material: PAINT }), ...plate(flick, { z: JUPE.half - 0.045, thick: 0.012, material: 'black', r: 0.008 })];
}

/** Jupes larges : un caisson bombé de 21 cm de haut, une lame noire au ras du sol, un jonc noir sur l'arête. @returns {Parts} */
function jupesLarges() {
  /** @type {P2[]} */
  const base = [
    [-0.006, 0.1],
    [0.006, 0.1],
    [0.02, 0.085],
    [0.05, 0.045],
    [0.064, 0.008],
    [0.068, -0.05],
    [0.06, -0.088],
    [0.035, -0.1],
    [-0.05, -0.1],
    [-0.05, -0.04],
    [-0.006, -0.004],
  ];
  const radii = [0.001, 0.005, 0.012, 0.02, 0.012, 0.01, 0.006, 0.004, 0.003, 0.003, 0.002];
  const section = (/** @type {number} */ z) => {
    const e = endFactor(JUPE, z);
    return fillet(shrink(base, { out: 0.12 + 0.88 * e, up: 0.55 + 0.45 * e, down: 0.7 + 0.3 * e }), radii);
  };
  /** @type {P2[]} */
  const blade = [
    [-0.03, -0.099],
    [0.094, -0.099],
    [0.104, -0.107],
    [0.094, -0.115],
    [-0.03, -0.115],
  ];
  const bladeSection = (/** @type {number} */ z) => fillet(shrink(blade, { out: 0.2 + 0.8 * endFactor({ half: JUPE.half, ends: 0.2 }, z) }), [0.002, 0.004, 0.004, 0.004, 0.002]);
  const bead = (/** @type {number} */ z) => {
    const e = endFactor({ half: JUPE.half - 0.12, ends: 0.12 }, z);
    const r = 0.0015 + 0.0045 * e;
    /** @type {P2[]} */
    const pts = [];
    for (let i = 0; i < 10; i += 1) pts.push([0.06 * (0.12 + 0.88 * e) + r * Math.cos((2 * Math.PI * i) / 10), 0.01 + r * Math.sin((2 * Math.PI * i) / 10)]);
    return pts;
  };
  return [
    ...sweepZ(section, stations(JUPE.half, JUPE.ends, 0.08, 0.02), { material: PAINT }),
    ...sweepZ(bladeSection, stations(JUPE.half, 0.2, 0.1, 0.04), { material: 'black', crease: 30 }),
    ...sweepZ(bead, stations(JUPE.half - 0.12, 0.12, 0.1, 0.03), { material: 'black', crease: 70 }),
  ];
}

/** Diffuseur simple : une jupe arrière qui plonge vers l'avant, quatre ailettes noires. @returns {Parts} */
function diffuseurSimple() {
  /** @type {P2[]} */
  const base = [
    [-0.006, 0.03],
    [0.006, 0.03],
    [0.014, 0.02],
    [0.018, 0.0],
    [0.024, -0.03],
    [0.016, -0.036],
    [-0.12, -0.046],
    [-0.26, -0.058],
    [-0.26, -0.04],
    [-0.006, -0.004],
  ];
  const radii = [0.001, 0.004, 0.005, 0.006, 0.004, 0.003, 0.01, 0.003, 0.003, 0.002];
  const section = (/** @type {number} */ z) => {
    const e = endFactor(DIFF, z);
    return fillet(shrink(base, { out: 0.3 + 0.7 * e, up: 0.6 + 0.4 * e, down: 0.6 + 0.4 * e }), radii);
  };
  /** @type {P2[]} */
  const fin = [
    [-0.24, -0.042],
    [0.012, -0.022],
    [0.03, -0.045],
    [0.03, -0.062],
    [0.018, -0.07],
    [-0.24, -0.07],
  ];
  return [
    ...sweepZ(section, stations(DIFF.half, DIFF.ends, 0.05, 0.016), { material: PAINT }),
    ...[-0.42, -0.18, 0.18, 0.42].flatMap((z) => plate(fin, { z, thick: 0.012, material: 'black', r: 0.005 })),
  ];
}

/** Diffuseur à ailettes : un fond noir qui remonte vers l'arrière, sept ailettes hautes qui dépassent. @returns {Parts} */
function diffuseurAilettes() {
  /** @type {P2[]} */
  const band = [
    [-0.006, 0.045],
    [0.008, 0.045],
    [0.018, 0.034],
    [0.022, 0.0],
    [0.02, -0.012],
    [-0.006, -0.012],
  ];
  /** @type {P2[]} */
  const floor = [
    [0.0, -0.006],
    [0.022, -0.012],
    [0.034, -0.03],
    [0.026, -0.04],
    [-0.3, -0.088],
    [-0.3, -0.072],
  ];
  const bandSection = (/** @type {number} */ z) => {
    const e = endFactor(DIFF, z);
    return fillet(shrink(band, { out: 0.4 + 0.6 * e, up: 0.6 + 0.4 * e }), [0.001, 0.004, 0.005, 0.004, 0.003, 0.002]);
  };
  const floorSection = (/** @type {number} */ z) => {
    const e = endFactor(DIFF, z);
    return fillet(shrink(floor, { out: 0.5 + 0.5 * e, down: 0.75 + 0.25 * e }), [0.003, 0.004, 0.004, 0.004, 0.003, 0.003]);
  };
  /** @type {P2[]} */
  const fin = [
    [-0.29, -0.074],
    [0.0, -0.02],
    [0.05, -0.036],
    [0.062, -0.07],
    [0.05, -0.1],
    [-0.29, -0.1],
  ];
  return [
    ...sweepZ(bandSection, stations(DIFF.half, DIFF.ends, 0.05, 0.016), { material: PAINT }),
    ...sweepZ(floorSection, stations(DIFF.half, DIFF.ends, 0.05, 0.016), { material: 'black', crease: 30 }),
    ...[-0.51, -0.34, -0.17, 0, 0.17, 0.34, 0.51].flatMap((z) => plate(fin, { z, thick: 0.01, material: 'black', r: 0.006 })),
  ];
}

/** @type {Record<string, () => Parts>} */
const STYLES = {
  becquet,
  queue_de_canard: queueDeCanard,
  aileron_bas: aileronBas,
  aileron_haut: aileronHaut,
  demesure,
  lame_discrete: lameDiscrete,
  lame_sport: lameSport,
  lame_course: lameCourse,
  jupes_fines: jupesFines,
  jupes_sport: jupesSport,
  jupes_larges: jupesLarges,
  diffuseur_simple: diffuseurSimple,
  diffuseur_ailettes: diffuseurAilettes,
};

/**
 * Pièces d'une option, par nœud : « surface » pour une pièce qui épouse la surface, « niveau » pour
 * un aileron sur supports, « rail » pour une pièce du kit carrosserie. Une pièce sur rail doit tenir
 * dans les hauteurs que le catalogue annonce (rise au-dessus de la ligne, depth dessous, à 3 mm près) :
 * l'app s'en sert pour la tasser.
 * @param {Option} option
 * @returns {{ node: string, parts: Parts }}
 */
export function buildPiece(option) {
  const make = STYLES[option.style];
  if (!make) throw new Error(`pièce « ${option.id} » : style « ${option.style} » inconnu (${Object.keys(STYLES).join(', ')})`);
  const parts = make();
  if (option.mount === 'rail') {
    let [low, high] = [Infinity, -Infinity];
    for (const part of parts) {
      const p = part.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i += 1) [low, high] = [Math.min(low, p.getY(i)), Math.max(high, p.getY(i))];
    }
    const [rise, depth] = [option.rise ?? 0, option.depth ?? 0];
    if (Math.abs(high - rise) > 0.003 || Math.abs(-low - depth) > 0.003) throw new Error(`pièce « ${option.id} » : modelée de ${(-low).toFixed(3)} m sous la ligne à ${high.toFixed(3)} m au-dessus, le catalogue dit depth ${depth} et rise ${rise}`);
  }
  return { node: option.mount === 'surface' ? NODES.surface : option.mount === 'rail' ? NODES.rail : NODES.level, parts };
}

/**
 * Pièce la plus lourde qu'un véhicule accepte, par poste déclaré dans son manifeste (une paire compte
 * deux fois ses triangles : la pièce et son miroir, fondus dans les mêmes maillages).
 * @param {{ pieces?: Record<string, { options?: string[], supports?: unknown, rail?: unknown, lid?: unknown }> }} manifest
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
    // Le capot (nœuds du modèle) se compte avec la caisse (tools/vehicles/compartiment.mjs, capotWorst).
    if (mount.lid) continue;
    postes += 1;
    const accepts = (/** @type {Option} */ option) => (mount.rail ? option.mount === 'rail' : option.mount === 'surface' || (option.mount === 'supports' && mount.supports));
    const allowed = poste.options.filter((option) => (!mount.options || mount.options.includes(option.id)) && accepts(option));
    const list = allowed.map((option) => summaries.get(pieceFile(id, option.id))).filter((s) => s !== undefined);
    // Une paire : deux fois les triangles, mais la pièce et son miroir partagent leurs appels de dessin.
    triangles += (poste.mirror ? 2 : 1) * Math.max(0, ...list.map((s) => s.triangles));
    drawCalls += Math.max(0, ...list.map((s) => s.primitives));
  }
  return { postes, triangles, drawCalls };
}
