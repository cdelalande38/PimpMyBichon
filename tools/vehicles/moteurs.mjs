// @ts-check
// Moteurs de l'établi (§ 5.11, § 8) : un modèle par famille, posé sur son support tournant, fait de
// pièces nommées (nœuds part_<nom>) que l'app écarte en vue éclatée et traite une à une (brut, peinture
// haute température, chrome, poli, brossé, anodisé, noir satiné). Le catalogue est une donnée :
// public/assets/shared/engines/catalogue.json (pièces, nœuds, vecteurs d'éclatement, échanges, cadre de
// la caméra). Substituts déclarés : placeholder_moteurs (TODO_ASSETS.md). On doit reconnaître
// l'architecture du moteur ; aucun nom, aucun logo, aucun marquage.
//
// Repère (mètres) : +Y vers le haut, +X vers l'avant du moteur (côté volant moteur), +Z à droite,
// origine au sol au pied du support. Chaque famille se modèle dans son repère à elle (centre du
// vilebrequin à l'origine), puis se pose sur le support à la hauteur voulue.
// Matériaux : paint_<matière> (matières d'origine du catalogue, traitables ou non) et les rôles du kit
// (chrome, alu, black, rubber), qui ne changent jamais.

import { readFileSync } from 'node:fs';
import * as k from './kit.mjs';

/** @typedef {import('./kit.mjs').Parts} Parts */
/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {{ id: string, label: string, hint?: string, noeuds: Record<string, P3> }} Option */
/** @typedef {{ id: string, label: string, phrase: string, traitements?: string[], noeuds?: Record<string, P3>, echange?: { label: string, origine: string, options: Option[] } }} Piece */
/** @typedef {{ id: string, label: string, placeholder?: boolean, cadre: { halfLength: number, halfWidth: number, height: number }, pieces: Piece[] }} Famille */
/** @typedef {{ id: string, label: string, color: string, metalness: number, roughness: number, traitable: boolean }} Matiere */
/** @typedef {{ budget: { triangles: number, drawCalls: number }, matieres: Matiere[], familles: Famille[] }} Catalogue */

export const CATALOGUE_URL = new URL('../../public/assets/shared/engines/catalogue.json', import.meta.url);

/** @returns {Catalogue} */
export function readCatalogue() {
  return JSON.parse(readFileSync(CATALOGUE_URL, 'utf8'));
}

/** Fichier d'une famille, sous public/assets/shared/engines/ (même nom que src/data/moteurs.ts, fichierMoteur). */
export const engineFile = (/** @type {string} */ famille) => `${famille}/moteur.glb`;

/** Préfixe des nœuds de pièce (§ 8 : « part_<nom> ») et nom du nœud du support (mêmes que src/data/moteurs.ts). */
export const PART_PREFIX = 'part_';
export const SUPPORT_NODE = 'support';

/** Nœuds d'une famille, tels que le catalogue les nomme (pièces et options d'échange). @param {Famille} famille */
export function catalogueNodes(famille) {
  /** @type {string[]} */
  const out = [];
  for (const piece of famille.pieces) {
    if (piece.noeuds) out.push(...Object.keys(piece.noeuds));
    for (const option of piece.echange?.options ?? []) out.push(...Object.keys(option.noeuds));
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Outils de forme

const F = 'paint_fonte';
const FER = 'paint_fer';
const TOLE = 'paint_tole';
const ACIER = 'paint_acier';
const NOIR = 'paint_noir';
const CHROME = 'paint_chrome';
const FILS = 'paint_fils';
const FILTRE = 'paint_filtre';

/**
 * Bloc aux coins arrondis : contour (x, y) arrondi de rayon `r`, épaisseur sur Z, faces biseautées.
 * @param {string} material @param {P3} center @param {P3} size @param {{ r?: number, bevel?: number, rotation?: P3, segments?: number }} [o]
 * @returns {Parts}
 */
function bloc(material, center, size, o = {}) {
  const [w, h, d] = size;
  const r = Math.min(o.r ?? Math.min(w, h) * 0.18, w / 2 - 1e-4, h / 2 - 1e-4);
  const bevel = Math.min(o.bevel ?? 0.004, d / 2 - 1e-4, Math.min(w, h) / 4);
  const parts = k.roundedExtrude(k.roundedRect(w, h, r, o.segments ?? 4), { material, depth: d, bevel, bevelSegments: 2, curveSegments: 4, crease: 40 });
  return k.place(parts, { position: center, rotation: o.rotation });
}

/**
 * Révolution d'un profil [r, h] autour d'un axe, posée en `center` (axe 'x', 'y' ou 'z').
 * @param {string} material @param {P2[]} profile @param {P3} center @param {{ axis?: 'x' | 'y' | 'z', segments?: number, crease?: number, rotation?: P3 }} [o]
 * @returns {Parts}
 */
function tour(material, profile, center, o = {}) {
  const parts = k.lathe(profile, { material, axis: o.axis ?? 'y', segments: o.segments ?? 28, crease: o.crease ?? 50 });
  return k.place(parts, { position: center, rotation: o.rotation });
}

/**
 * Profil d'un fût à ailettes, de h0 à h1 : un collet plein au pied et en tête, des ailettes de rayon
 * `fin` sur un noyau de rayon `core`. Fermé sur l'axe (un plein).
 * @param {{ h0: number, h1: number, core: number, fin: number, fins: number, collar?: number, thick?: number, lip?: number }} o
 * @returns {P2[]}
 */
function finnedProfile(o) {
  const collar = o.collar ?? 0.012;
  const lip = o.lip ?? o.core + 0.006;
  const span = o.h1 - o.h0 - 2 * collar;
  const pitch = span / o.fins;
  const thick = o.thick ?? pitch * 0.42;
  /** @type {P2[]} */
  const p = [
    [0, o.h0],
    [lip, o.h0],
    [lip, o.h0 + collar],
  ];
  for (let i = 0; i < o.fins; i += 1) {
    const a = o.h0 + collar + i * pitch + (pitch - thick) / 2;
    p.push([o.core, a], [o.fin, a + 0.0008], [o.fin, a + thick - 0.0008], [o.core, a + thick]);
  }
  p.push([lip, o.h1 - collar], [lip, o.h1], [0, o.h1]);
  return p;
}

/** Profil d'un disque plein de rayon r et d'épaisseur t, arêtes cassées de `c`, centré sur h = 0. @returns {P2[]} */
function discProfile(/** @type {number} */ r, /** @type {number} */ t, c = 0.003) {
  return [
    [0, -t / 2],
    [r - c, -t / 2],
    [r, -t / 2 + c],
    [r, t / 2 - c],
    [r - c, t / 2],
    [0, t / 2],
  ];
}

/** Profil d'une poulie à gorge en V : rayon r, gorge de profondeur g, largeur t, moyeu côté +h. @returns {P2[]} */
function pulleyProfile(/** @type {number} */ r, /** @type {number} */ t, /** @type {number} */ g, hub = 0) {
  return [
    [0, -t / 2],
    [r - 0.002, -t / 2],
    [r, -t / 2 + 0.002],
    [r, -t / 6],
    [r - g, 0],
    [r, t / 6],
    [r, t / 2 - 0.002],
    [r - 0.002, t / 2],
    ...(hub > 0
      ? /** @type {P2[]} */ ([
          [r * 0.42, t / 2],
          [r * 0.42, t / 2 + hub],
        ])
      : []),
    [0, t / 2 + hub],
  ];
}

/**
 * Tube creux (paroi de `wall`) de rayon extérieur r, de h0 à h1, lèvre rentrée de `lip` en h0.
 * @returns {P2[]}
 */
function shellProfile(/** @type {number} */ r, /** @type {number} */ wall, /** @type {number} */ h0, /** @type {number} */ h1, lip = 0) {
  return [
    [r - wall - lip, h0],
    [r, h0],
    [r, h1],
    [r - wall, h1],
    [r - wall, h0 + wall],
    [r - wall - lip, h0 + wall],
    [r - wall - lip, h0],
  ];
}

/**
 * Plisse une révolution d'axe Y (filtre conique) : le rayon ondule de `amp` selon l'angle, `n` plis,
 * entre y0 et y1. Rend des pièces aux normales refaites.
 * @param {Parts} parts @param {{ n: number, amp: number, y0: number, y1: number }} o
 * @returns {Parts}
 */
function pleat(parts, o) {
  return parts.map((part) => {
    const g = part.geometry.clone();
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 1) {
      const y = p.getY(i);
      if (y < o.y0 || y > o.y1) continue;
      const x = p.getX(i);
      const z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 1e-5) continue;
      const a = Math.atan2(z, x);
      const f = 1 + (o.amp / r) * Math.cos(o.n * a);
      p.setXYZ(i, x * f, y, z * f);
    }
    return { material: part.material, geometry: k.smooth(g, 70) };
  });
}

/**
 * Pales d'une turbine d'axe X : `n` lames radiales de r0 à r1, de largeur `w` (sur X), d'épaisseur
 * `t`, inclinées de `pitch` radians, centrées en `center`.
 * @param {string} material @param {P3} center @param {{ n: number, r0: number, r1: number, w: number, t: number, pitch: number }} o
 * @returns {Parts}
 */
function blades(material, center, o) {
  /** @type {Parts} */
  const out = [];
  const blade = bloc(material, [0, (o.r0 + o.r1) / 2, 0], [o.w, o.r1 - o.r0, o.t], { r: 0.004, bevel: 0.001 });
  for (let i = 0; i < o.n; i += 1) {
    const a = (2 * Math.PI * i) / o.n;
    const pitched = k.place(blade, { rotation: [0, o.pitch, 0] });
    out.push(...k.place(pitched, { rotation: [a, 0, 0] }));
  }
  return k.place(out, { position: center });
}

/** Courroie fermée autour de deux poulies d'axe X (centres en (y, z), rayons de gorge), dans le plan x. */
function belt(/** @type {number} */ x, /** @type {[number, number]} */ c0, /** @type {number} */ r0, /** @type {[number, number]} */ c1, /** @type {number} */ r1) {
  /** @type {P3[]} */
  const pts = [];
  const n = 14;
  // Poulie du bas : la moitié basse, de +z à −z ; poulie du haut : la moitié haute, de −z à +z.
  for (let i = 0; i <= n; i += 1) {
    const a = Math.PI * (i / n);
    pts.push([x, c0[0] - r0 * Math.sin(a), c0[1] + r0 * Math.cos(a)]);
  }
  for (let i = 0; i <= n; i += 1) {
    const a = Math.PI * (i / n);
    pts.push([x, c1[0] + r1 * Math.sin(a), c1[1] - r1 * Math.cos(a)]);
  }
  return k.tube(pts, { material: 'rubber', radius: 0.0065, radial: 6, closed: true, segments: 96 });
}

/** Vis à six pans (tête seule), axe `axis`, posée en `center`. @param {string} material @param {P3} center @param {'x' | 'y' | 'z'} axis */
function bolt(material, center, axis, r = 0.006, h = 0.005) {
  return tour(material, discProfile(r, h, 0.0012), center, { axis, segments: 6, crease: 30 });
}

/**
 * Ajoute des pièces à un nœud (accumulateur par nœud).
 * @param {Map<string, Parts>} nodes @param {string} node @param {Parts} parts
 */
function put(nodes, node, parts) {
  const list = nodes.get(node) ?? [];
  list.push(...parts);
  nodes.set(node, list);
}

// ---------------------------------------------------------------------------------------------
// Le support tournant (commun) : socle rond, colonne, plateau et deux berceaux à la hauteur `top`.

/**
 * @param {number} top hauteur du dessus des berceaux
 * @param {{ cradle?: number, width?: number, clearance?: number }} [o] cradle : écart des berceaux sur X ; width : leur
 *   longueur sur Z ; clearance : jour de plus sous les berceaux (un carter d'huile qui pend entre eux, et descend en vue éclatée)
 * @returns {Parts}
 */
function support(top, o = {}) {
  const cradle = o.cradle ?? 0.22;
  const width = o.width ?? 0.2;
  const clearance = o.clearance ?? 0;
  const plate = top - 0.05 - clearance;
  return [
    // Socle : disque épais, chanfreiné, sur quatre patins.
    ...tour('black', [[0, 0.012], [0.3, 0.012], [0.32, 0.026], [0.31, 0.04], [0.06, 0.05], [0, 0.05]], [0, 0, 0], { segments: 48 }),
    ...[0, 1, 2, 3].flatMap((i) => tour('rubber', discProfile(0.03, 0.012, 0.003), [0.24 * Math.cos(Math.PI / 4 + (i * Math.PI) / 2), 0.006, 0.24 * Math.sin(Math.PI / 4 + (i * Math.PI) / 2)], { segments: 16 })),
    // Colonne chromée et sa bague de serrage.
    ...tour('chrome', [[0, 0.05], [0.045, 0.05], [0.04, 0.07], [0.04, plate - 0.03], [0.05, plate - 0.02], [0, plate - 0.02]], [0, 0, 0], { segments: 32 }),
    ...tour('black', discProfile(0.058, 0.03, 0.004), [0, 0.2, 0], { segments: 32 }),
    // Plateau tournant.
    ...tour('alu', discProfile(0.16, 0.02, 0.004), [0, plate - 0.01, 0], { segments: 48 }),
    // Deux berceaux : une poutre et deux sabots arrondis chacun.
    ...[-1, 1].flatMap((s) => [
      ...bloc('black', [(s * cradle) / 2, plate + 0.012, 0], [0.04, 0.024, width + 0.08], { r: 0.006 }),
      ...(clearance > 0 ? bloc('black', [(s * cradle) / 2, plate + 0.012 + (clearance + 0.012) / 2, 0], [0.034, clearance + 0.012, 0.05], { r: 0.006 }) : []),
      ...bloc('black', [(s * cradle) / 2, top - 0.019, 0], [0.05, 0.026, width], { r: 0.008 }),
      ...bloc('rubber', [(s * cradle) / 2, top - 0.003, 0], [0.046, 0.006, width - 0.02], { r: 0.002, bevel: 0.0015 }),
    ]),
  ];
}

// ---------------------------------------------------------------------------------------------
// 4 cylindres à plat refroidi par air (la Cox) : carters en deux moitiés, cylindres à ailettes à plat
// de part et d'autre, culasses et cache-culbuteurs au bout, tôles de refroidissement par-dessus avec le
// carter rond de la turbine, alternateur debout au milieu, poulies et courroie à l'arrière, carburateur
// unique au centre sur son collecteur en T, distributeur et fils de bougie.

function quatreAPlat() {
  /** @type {Map<string, Parts>} */
  const n = new Map();
  /** Centres des cylindres sur X, par rangée (décalés d'une rangée à l'autre, comme un vrai bloc à plat). */
  const CYL = (/** @type {number} */ s) => (s < 0 ? [-0.062, 0.078] : [-0.078, 0.062]);

  // Carters : deux demi-carters joints par une bride verticale, face de cloche à l'avant, crépine dessous.
  for (const s of [-1, 1]) put(n, 'carters', bloc(F, [0.005, -0.012, s * 0.064], [0.39, 0.236, 0.116], { r: 0.06, bevel: 0.012 }));
  put(n, 'carters', bloc(F, [0.005, -0.012, 0], [0.402, 0.25, 0.014], { r: 0.066, bevel: 0.003 }));
  // Nervures sous les carters.
  for (const x of [-0.12, -0.04, 0.04, 0.12]) put(n, 'carters', bloc(F, [x, -0.128, 0], [0.012, 0.016, 0.21], { r: 0.004, bevel: 0.002 }));
  // Bossages des cylindres sur les faces latérales.
  for (const s of [-1, 1]) for (const x of CYL(s)) put(n, 'carters', tour(F, discProfile(0.068, 0.02, 0.004), [x, 0, s * 0.124], { axis: 'z', segments: 28 }));
  // Face de cloche à l'avant : une plaque ronde épaisse et sa couronne de vis.
  put(n, 'carters', tour(F, discProfile(0.16, 0.026, 0.006), [0.21, -0.012, 0], { axis: 'x', segments: 40 }));
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8 + Math.PI / 8;
    put(n, 'carters', bolt('alu', [0.225, -0.012 + 0.135 * Math.sin(a), 0.135 * Math.cos(a)], 'x', 0.007, 0.006));
  }
  // Couvercle de crépine sous le carter et ses six écrous.
  put(n, 'carters', tour(F, discProfile(0.07, 0.012, 0.003), [-0.02, -0.142, 0], { axis: 'y', segments: 28 }));
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    put(n, 'carters', bolt('alu', [-0.02 + 0.055 * Math.cos(a), -0.15, 0.055 * Math.sin(a)], 'y', 0.006, 0.006));
  }
  // Socle de l'alternateur (sous les tôles) et bouchon de remplissage d'huile.
  put(n, 'carters', bloc(F, [0.07, 0.15, 0], [0.12, 0.1, 0.085], { r: 0.02 }));
  put(n, 'carters', tour(F, [[0, 0.1], [0.026, 0.1], [0.026, 0.13], [0.034, 0.135], [0.034, 0.15], [0, 0.152]], [-0.135, 0, 0.0], { segments: 20 }));

  // Cylindres : quatre fûts à ailettes, à plat, deux de chaque côté, et les tubes de culbuteurs dessous.
  for (const s of [-1, 1]) {
    const node = s < 0 ? 'cylindres_g' : 'cylindres_d';
    for (const x of CYL(s)) {
      put(n, node, tour(FER, finnedProfile({ h0: -0.077, h1: 0.077, core: 0.05, fin: 0.066, fins: 10, collar: 0.01 }), [x, 0, s * 0.211], { axis: 'z', segments: 28 }));
      for (const dx of [-0.022, 0.022]) put(n, node, k.rod([x + dx, -0.078, s * 0.13], [x + dx, -0.072, s * 0.29], 0.0085, { material: ACIER, radial: 10 }));
    }
  }

  // Culasses : un bloc à ailettes par rangée, bossages d'admission dessus et d'échappement dessous.
  for (const s of [-1, 1]) {
    const node = s < 0 ? 'culasses_g' : 'culasses_d';
    put(n, node, bloc(F, [0, 0, s * 0.31], [0.29, 0.124, 0.072], { r: 0.03, bevel: 0.006 }));
    for (const dz of [-0.026, -0.009, 0.009, 0.026]) put(n, node, bloc(F, [0, 0, s * 0.31 + dz], [0.305, 0.158, 0.0045], { r: 0.04, bevel: 0.0012 }));
    put(n, node, tour(F, [[0, 0.06], [0.022, 0.06], [0.022, 0.094], [0, 0.094]], [0, 0, s * 0.312], { segments: 20 }));
    for (const x of CYL(s)) put(n, node, tour(F, [[0, -0.094], [0.02, -0.094], [0.02, -0.06], [0, -0.06]], [x, 0, s * 0.31], { segments: 16 }));
  }

  // Cache-culbuteurs : une cuvette emboutie au bout de chaque culasse, tenue par son étrier.
  for (const s of [-1, 1]) {
    const node = s < 0 ? 'cache_culbuteurs_g' : 'cache_culbuteurs_d';
    put(n, node, bloc(ACIER, [0, -0.006, s * 0.37], [0.27, 0.112, 0.048], { r: 0.036, bevel: 0.014 }));
    put(n, node, bloc(ACIER, [0, -0.006, s * 0.349], [0.284, 0.126, 0.008], { r: 0.04, bevel: 0.002 }));
    // Deux nervures embouties sur la face.
    for (const y of [-0.03, 0.018]) put(n, node, bloc(ACIER, [0, y, s * 0.394], [0.19, 0.012, 0.006], { r: 0.005, bevel: 0.002 }));
    put(n, node, k.tube([[0, 0.052, s * 0.355], [0, 0.058, s * 0.392], [0, 0.0, s * 0.402], [0, -0.062, s * 0.392], [0, -0.066, s * 0.355]], { material: 'chrome', radius: 0.0045, radial: 8, segments: 40 }));
  }

  // Tôles de refroidissement : le capot qui couvre le dessus, avec le carter rond de la turbine à l'arrière.
  /** @type {P2[]} */
  const shroud = [
    [-0.285, 0.068],
    [-0.285, 0.098],
    [-0.272, 0.118],
    [-0.245, 0.128],
    [-0.15, 0.132],
    [-0.128, 0.142],
    [-0.118, 0.17],
    [-0.108, 0.196],
    [-0.088, 0.206],
    [0.088, 0.206],
    [0.108, 0.196],
    [0.118, 0.17],
    [0.128, 0.142],
    [0.15, 0.132],
    [0.245, 0.128],
    [0.272, 0.118],
    [0.285, 0.098],
    [0.285, 0.068],
    [0.126, 0.068],
    [0.126, 0.106],
    [-0.126, 0.106],
    [-0.126, 0.068],
  ];
  put(n, 'toles', k.place(k.roundedExtrude(shroud, { material: TOLE, depth: 0.32, bevel: 0.01, bevelSegments: 3, axis: 'x', curveSegments: 6, crease: 35 }), { position: [0.0, 0, 0] }));
  // Carter de la turbine : un fût creux d'axe X, lèvre rentrée côté poulie, fermé côté alternateur.
  put(n, 'toles', tour(TOLE, shellProfile(0.15, 0.008, -0.2, -0.03, 0.026), [0, 0.27, 0], { axis: 'x', segments: 48, crease: 40 }));
  put(n, 'toles', tour(TOLE, discProfile(0.15, 0.008, 0.002), [-0.034, 0.27, 0], { axis: 'x', segments: 48 }));
  // Le fond du carter, sombre, derrière la turbine.
  put(n, 'toles', tour('black', discProfile(0.142, 0.004, 0.001), [-0.05, 0.27, 0], { axis: 'x', segments: 32 }));
  // Trappes de visite et petites ouïes sur les ailes.
  for (const s of [-1, 1]) put(n, 'toles', bloc(TOLE, [0.02, 0.135, s * 0.2], [0.16, 0.008, 0.07], { r: 0.012, bevel: 0.002, rotation: [Math.PI / 2, 0, 0] }));

  // Turbine : moyeu, flasque et seize pales, visibles par l'ouverture du carter.
  put(n, 'turbine', tour(ACIER, discProfile(0.128, 0.004, 0.001), [-0.07, 0.27, 0], { axis: 'x', segments: 40 }));
  put(n, 'turbine', blades(ACIER, [-0.092, 0.27, 0], { n: 16, r0: 0.05, r1: 0.126, w: 0.04, t: 0.004, pitch: 0.38 }));
  put(n, 'turbine', tour(ACIER, [[0, -0.03], [0.04, -0.03], [0.05, -0.02], [0.05, 0.02], [0, 0.02]], [-0.1, 0.27, 0], { axis: 'x', segments: 24 }));

  // Alternateur : debout sur son socle, au milieu, dans l'axe de la turbine.
  put(
    n,
    'alternateur',
    tour(
      TOLE,
      [
        [0, -0.03],
        [0.05, -0.03],
        [0.056, -0.022],
        [0.056, 0.03],
        [0.052, 0.034],
        [0.056, 0.038],
        [0.056, 0.12],
        [0.052, 0.124],
        [0.056, 0.128],
        [0.056, 0.15],
        [0.045, 0.165],
        [0.022, 0.172],
        [0.012, 0.185],
        [0, 0.185],
      ],
      [0, 0.27, 0],
      { axis: 'x', segments: 32, crease: 40 },
    ),
  );
  put(n, 'alternateur', tour('black', discProfile(0.06, 0.014, 0.002), [0.075, 0.27, 0], { axis: 'x', segments: 32 }));
  // Bornes à l'arrière du boîtier.
  for (const dz of [-0.02, 0.02]) put(n, 'alternateur', k.rod([0.17, 0.3, dz], [0.19, 0.3, dz], 0.005, { material: 'alu', radial: 8 }));

  // Poulies et courroie, à l'arrière : vilebrequin en bas, alternateur en haut.
  put(n, 'poulies', tour(ACIER, pulleyProfile(0.085, 0.03, 0.012, 0.016), [-0.222, 0, 0], { axis: 'x', segments: 40, crease: 40 }));
  put(n, 'poulies', tour(ACIER, pulleyProfile(0.052, 0.026, 0.01, 0.012), [-0.222, 0.27, 0], { axis: 'x', segments: 32, crease: 40 }));
  put(n, 'poulies', tour('alu', discProfile(0.016, 0.012, 0.002), [-0.243, 0, 0], { axis: 'x', segments: 6, crease: 30 }));
  put(n, 'poulies', tour('alu', discProfile(0.011, 0.01, 0.002), [-0.242, 0.27, 0], { axis: 'x', segments: 6, crease: 30 }));
  put(n, 'poulies', belt(-0.222, [0, 0], 0.075, [0.27, 0], 0.044));

  // Collecteur d'admission : la colonne sous le carburateur et le T qui file vers les deux culasses.
  const RISER = 0.235;
  put(n, 'collecteur', k.rod([RISER, 0.14, 0], [RISER, 0.228, 0], 0.024, { material: ACIER, radial: 20 }));
  for (const s of [-1, 1]) {
    put(
      n,
      'collecteur',
      k.tube(
        [
          [RISER, 0.176, 0],
          [RISER, 0.176, s * 0.12],
          [0.2, 0.17, s * 0.24],
          [0.09, 0.152, s * 0.302],
          [0.0, 0.11, s * 0.312],
          [0.0, 0.094, s * 0.312],
        ],
        { material: ACIER, radius: 0.016, radial: 14, segments: 60 },
      ),
    );
  }
  put(n, 'collecteur', tour(ACIER, discProfile(0.034, 0.01, 0.002), [RISER, 0.226, 0], { segments: 24 }));

  // Carburateur unique, inversé : corps, cuve sur le côté, axe de papillon et sa biellette.
  put(n, 'carburateur', bloc(F, [RISER, 0.272, 0], [0.074, 0.084, 0.07], { r: 0.014, bevel: 0.006 }));
  put(n, 'carburateur', tour(F, [[0, -0.034], [0.026, -0.034], [0.029, -0.026], [0.029, 0.028], [0.022, 0.034], [0, 0.034]], [RISER, 0.262, 0.05], { segments: 24 }));
  put(n, 'carburateur', tour(F, discProfile(0.042, 0.01, 0.002), [RISER, 0.317, 0], { segments: 28 }));
  put(n, 'carburateur', k.rod([RISER - 0.03, 0.246, -0.048], [RISER - 0.03, 0.246, 0.048], 0.004, { material: 'alu', radial: 8 }));
  put(n, 'carburateur', bloc('alu', [RISER - 0.03, 0.234, -0.05], [0.006, 0.03, 0.012], { r: 0.003, bevel: 0.001 }));

  // Filtres à air, posés sur le carburateur : un nœud par option, l'app n'en montre qu'un.
  const TOP = 0.322;
  put(
    n,
    'filtre_boitier',
    tour(
      TOLE,
      [
        [0, TOP],
        [0.05, TOP],
        [0.095, TOP + 0.012],
        [0.104, TOP + 0.024],
        [0.104, TOP + 0.092],
        [0.1, TOP + 0.1],
        [0.07, TOP + 0.114],
        [0.03, TOP + 0.12],
        [0, TOP + 0.121],
      ],
      [RISER, 0, 0],
      { segments: 40, crease: 40 },
    ),
  );
  put(n, 'filtre_boitier', tour('alu', discProfile(0.107, 0.012, 0.002), [RISER, TOP + 0.05, 0], { segments: 40 }));
  put(n, 'filtre_boitier', k.tube([[RISER + 0.06, TOP + 0.075, 0], [RISER + 0.11, TOP + 0.075, 0], [RISER + 0.15, TOP + 0.07, 0]], { material: TOLE, radius: 0.028, radial: 18, segments: 12 }));
  put(n, 'filtre_boitier', tour(TOLE, shellProfile(0.034, 0.004, -0.008, 0.008), [RISER + 0.152, TOP + 0.07, 0], { axis: 'x', segments: 20 }));
  put(n, 'filtre_boitier', tour('alu', discProfile(0.012, 0.012, 0.002), [RISER, TOP + 0.126, 0], { segments: 6, crease: 30 }));

  put(n, 'filtre_cornet', cornet([RISER, TOP, 0]));
  put(n, 'filtre_conique', conique([RISER, TOP, 0]));

  // Distributeur, à gauche devant les tôles, et la bobine couchée sur l'aile.
  const DIST = /** @type {P3} */ ([0.17, 0, -0.17]);
  put(n, 'distributeur', tour(F, [[0, 0.1], [0.022, 0.1], [0.022, 0.17], [0.03, 0.18], [0.03, 0.2], [0, 0.2]], [DIST[0], 0, DIST[2]], { segments: 24 }));
  put(n, 'distributeur', tour('black', [[0, 0.198], [0.036, 0.198], [0.036, 0.222], [0.03, 0.236], [0, 0.238]], [DIST[0], 0, DIST[2]], { segments: 28 }));
  /** @type {P3[]} */
  const towers = [[0, 0.244, 0], [0.018, 0.238, 0.0], [-0.018, 0.238, 0.0], [0, 0.238, 0.018], [0, 0.238, -0.018]];
  for (const [dx, y, dz] of towers) put(n, 'distributeur', k.rod([DIST[0] + dx, y - 0.01, DIST[2] + dz], [DIST[0] + dx, y + 0.012, DIST[2] + dz], 0.006, { material: 'black', radial: 10 }));
  put(n, 'distributeur', tour(TOLE, [[0, -0.055], [0.028, -0.055], [0.03, -0.05], [0.03, 0.05], [0.024, 0.058], [0.008, 0.06], [0.008, 0.072], [0, 0.072]], [0.05, 0.168, -0.2], { axis: 'x', segments: 24 }));
  put(n, 'distributeur', bloc('black', [0.05, 0.142, -0.2], [0.07, 0.014, 0.05], { r: 0.006, bevel: 0.002 }));

  // Fils de bougie : du chapeau du distributeur aux quatre bougies, en haut des culasses ; capuchons.
  /** @type {P3[][]} */
  const wires = [];
  const ends = /** @type {[number, number][]} */ ([
    [-1, -0.062],
    [-1, 0.078],
    [1, -0.078],
    [1, 0.062],
  ]);
  ends.forEach(([s, x], i) => {
    const tower = /** @type {P3} */ (towers[i + 1]);
    const start = /** @type {P3} */ ([DIST[0] + tower[0], tower[1] + 0.012, DIST[2] + tower[2]]);
    const plug = /** @type {P3} */ ([x, 0.088, s * 0.336]);
    const lift = 0.262 + 0.006 * i;
    // À gauche, droit au-dessus de l'aile ; à droite, par-dessus l'alternateur.
    const route =
      s < 0
        ? /** @type {P3[]} */ ([[(start[0] + x) / 2, lift - 0.03, -0.25], [x, 0.17, -0.33]])
        : /** @type {P3[]} */ ([[0.11, 0.33 + 0.008 * i, -0.08], [0.05, 0.345 + 0.006 * i, 0.06], [x, 0.21, 0.3]]);
    wires.push([start, [start[0], lift, start[2]], ...route, [x, plug[1] + 0.03, plug[2]]]);
    put(n, 'fils', k.rod([x, plug[1] - 0.014, plug[2]], [x, plug[1] + 0.03, plug[2]], 0.009, { material: FILS, radial: 12 }));
    put(n, 'fils', k.rod([x, plug[1] - 0.026, plug[2]], [x, plug[1] - 0.012, plug[2]], 0.0075, { material: 'alu', radial: 6 }));
  });
  wires.push([[DIST[0], 0.256, DIST[2]], [DIST[0], 0.27, DIST[2]], [0.13, 0.25, -0.2], [0.115, 0.2, -0.2]]);
  for (const path of wires) put(n, 'fils', k.tube(path, { material: FILS, radius: 0.0038, radial: 7, segments: 40 }));

  return { nodes: n, lift: 0.585, support: { cradle: 0.24, width: 0.2 }, bottom: -0.136 };
}


/** Profil d'un cornet d'admission (pavillon à lèvre roulée) de rayon intérieur 0,03 m, pied en h = 0. @type {P2[]} */
const TRUMPET = [
  [0.03, 0],
  [0.037, 0],
  [0.037, 0.014],
  [0.039, 0.04],
  [0.045, 0.06],
  [0.056, 0.074],
  [0.068, 0.082],
  [0.072, 0.088],
  [0.066, 0.09],
  [0.056, 0.082],
  [0.042, 0.066],
  [0.034, 0.044],
  [0.031, 0.016],
  [0.03, 0],
];

/**
 * Cornet d'admission chromé d'axe Y, pied en `center` (rayon intérieur 0,03 m × `scale`), tourné de `rotation`.
 * @param {P3} center @param {{ scale?: number, rotation?: P3 }} [o]
 * @returns {Parts}
 */
function cornet(center, o = {}) {
  const s = o.scale ?? 1;
  const parts = [
    ...tour(CHROME, TRUMPET.map(([r, h]) => /** @type {P2} */ ([r * s, h * s])), [0, 0, 0], { segments: 40, crease: 55 }),
    ...tour(CHROME, discProfile(0.044 * s, 0.006 * s, 0.0015 * s), [0, 0.003 * s, 0], { segments: 32 }),
  ];
  return k.place(parts, { position: center, rotation: o.rotation });
}

/**
 * Filtre conique d'axe Y, pied en `center` : collier chromé, cône plissé en coton rouge, chapeau chromé.
 * @param {P3} center @param {{ scale?: number, rotation?: P3 }} [o]
 * @returns {Parts}
 */
function conique(center, o = {}) {
  const s = o.scale ?? 1;
  const cone = pleat(
    tour(
      FILTRE,
      [
        [0.03 * s, 0.016 * s],
        [0.066 * s, 0.02 * s],
        [0.062 * s, 0.06 * s],
        [0.054 * s, 0.1 * s],
        [0.05 * s, 0.112 * s],
        [0, 0.112 * s],
      ],
      [0, 0, 0],
      { segments: 96, crease: 70 },
    ),
    { n: 32, amp: 0.0035 * s, y0: 0.024 * s, y1: 0.106 * s },
  );
  const parts = [
    ...tour(CHROME, shellProfile(0.044 * s, 0.006 * s, 0, 0.018 * s), [0, 0, 0], { segments: 32 }),
    ...tour('alu', discProfile(0.047 * s, 0.006 * s, 0.0015 * s), [0, 0.009 * s, 0], { segments: 32 }),
    ...cone,
    ...tour(CHROME, discProfile(0.054 * s, 0.006 * s, 0.002 * s), [0, 0.114 * s, 0], { segments: 32 }),
  ];
  return k.place(parts, { position: center, rotation: o.rotation });
}

/**
 * Rogne les sommets au-delà d'un plan x = constante (ailettes de deux cylindres en V qui se croiseraient) :
 * ce qui dépasse est ramené sur le plan, les normales sont refaites.
 * @param {Parts} parts @param {{ min?: number, max?: number }} o
 * @returns {Parts}
 */
function clampX(parts, o) {
  return parts.map((part) => {
    const g = part.geometry.clone();
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i += 1) {
      const x = p.getX(i);
      if (o.min !== undefined && x < o.min) p.setX(i, o.min);
      if (o.max !== undefined && x > o.max) p.setX(i, o.max);
    }
    return { material: part.material, geometry: k.smooth(g, 40) };
  });
}

/**
 * Contour enveloppe de deux cercles (centre, rayon) : un carter primaire, un couvercle oblong.
 * @param {P2} a @param {number} ra @param {P2} b @param {number} rb @param {number} [n]
 * @returns {P2[]}
 */
function twoCircles(a, ra, b, rb, n = 14) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  /** @type {P2[]} */
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = ang + Math.PI / 2 + (Math.PI * i) / n;
    pts.push([a[0] + ra * Math.cos(t), a[1] + ra * Math.sin(t)]);
  }
  for (let i = 0; i <= n; i += 1) {
    const t = ang - Math.PI / 2 + (Math.PI * i) / n;
    pts.push([b[0] + rb * Math.cos(t), b[1] + rb * Math.sin(t)]);
  }
  return pts;
}

/**
 * Goutte d'eau : un cercle (centre, rayon) prolongé en pointe vers `apex` (couvercle de distribution).
 * @param {P2} c @param {number} r @param {P2} apex @param {number} [n]
 * @returns {P2[]}
 */
function teardrop(c, r, apex, n = 20) {
  const dir = Math.atan2(apex[1] - c[1], apex[0] - c[0]);
  const d = Math.hypot(apex[0] - c[0], apex[1] - c[1]);
  const half = Math.acos(Math.min(1, r / d));
  /** @type {P2[]} */
  const pts = [];
  for (let i = 0; i <= n; i += 1) {
    const t = dir + half + ((2 * Math.PI - 2 * half) * i) / n;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  pts.push([apex[0], apex[1]]);
  return pts;
}

// ---------------------------------------------------------------------------------------------
// Bicylindre en V à 45° refroidi par air (le bobber) : bas moteur et boîte d'un bloc, deux fûts à
// ailettes en V (rognés là où ils se croisent), culasses à ailettes, cache-culbuteurs en dôme, tubes de
// tiges de culbuteurs chromés côté droit, couvercle de distribution en goutte d'eau, carter primaire
// oblong côté gauche, carburateur dans le V avec son filtre rond, filtre à huile devant, bobine et fils.

function bicylindreV() {
  /** @type {Map<string, Parts>} */
  const n = new Map();
  const A = (22.5 * Math.PI) / 180;
  /** Point de l'axe d'un cylindre à la distance d du vilebrequin, décalé de dz. @param {number} s @param {number} d */
  const on = (s, d, dz = 0) => /** @type {P3} */ ([s * Math.sin(A) * d, Math.cos(A) * d, dz]);
  /** Pièce modelée sur l'axe Y, posée le long de l'axe d'un cylindre à la distance d. @param {Parts} parts @param {number} s @param {number} d */
  const along = (parts, s, d) => k.place(parts, { position: on(s, d), rotation: [0, 0, -s * A] });
  const side = (/** @type {number} */ s) => (s > 0 ? 'avant' : 'arriere');

  // Carters : bas moteur et boîte d'un bloc, joint vertical, bossages des cylindres, nervures dessous.
  put(n, 'carters', bloc(F, [-0.005, -0.035, 0], [0.31, 0.19, 0.17], { r: 0.07, bevel: 0.014 }));
  put(n, 'carters', bloc(F, [-0.245, -0.055, 0], [0.19, 0.15, 0.15], { r: 0.045, bevel: 0.012 }));
  put(n, 'carters', bloc(F, [-0.06, -0.035, 0], [0.43, 0.2, 0.012], { r: 0.075, bevel: 0.003 }));
  for (const s of [-1, 1]) put(n, 'carters', along(tour(F, discProfile(0.07, 0.022, 0.005), [0, 0, 0], { segments: 32 }), s, 0.075));
  for (const x of [-0.27, -0.2, -0.1, 0.0, 0.08]) put(n, 'carters', bloc(F, [x, -0.132, 0], [0.012, 0.012, 0.15], { r: 0.004, bevel: 0.002 }));

  // Cylindres, culasses et cache-culbuteurs, le long de leur axe ; ailettes rognées au milieu du V.
  for (const s of [-1, 1]) {
    const cut = s > 0 ? { min: 0.004 } : { max: -0.004 };
    put(n, `cylindre_${side(s)}`, clampX(along(tour(NOIR, finnedProfile({ h0: 0, h1: 0.15, core: 0.05, fin: 0.082, fins: 10, collar: 0.012 }), [0, 0, 0], { segments: 32 }), s, 0.085), cut));
    put(n, `culasse_${side(s)}`, clampX(along(tour(F, finnedProfile({ h0: 0, h1: 0.08, core: 0.06, fin: 0.09, fins: 5, collar: 0.008, lip: 0.07 }), [0, 0, 0], { segments: 32 }), s, 0.235), cut));
    put(
      n,
      `cache_culbuteurs_${side(s)}`,
      along(
        tour(
          CHROME,
          [
            [0, 0],
            [0.07, 0],
            [0.08, 0.006],
            [0.08, 0.016],
            [0.072, 0.022],
            [0.074, 0.03],
            [0.062, 0.044],
            [0.036, 0.055],
            [0, 0.058],
          ],
          [0, 0, 0],
          { segments: 36, crease: 45 },
        ),
        s,
        0.315,
      ),
    );
    for (let i = 0; i < 4; i += 1) {
      const a = (Math.PI * 2 * i) / 4 + Math.PI / 4;
      put(n, `cache_culbuteurs_${side(s)}`, along(bolt('alu', [0.066 * Math.cos(a), 0.02, 0.066 * Math.sin(a)], 'y', 0.006, 0.006), s, 0.315));
    }
    // Deux tubes de tiges de culbuteurs chromés par cylindre, côté droit, de la distribution à la culasse.
    for (const dz of [0.088, 0.108]) {
      const base = /** @type {P3} */ ([s * 0.012, 0.03, dz]);
      const top = on(s, 0.3, dz);
      put(n, `cylindre_${side(s)}`, k.rod(base, top, 0.0095, { material: CHROME, radial: 12 }));
    }
  }

  // Couvercle de distribution, côté droit : une goutte d'eau pointée vers le V, et le cône d'allumage devant.
  put(n, 'carter_distribution', k.place(k.roundedExtrude(teardrop([0.045, -0.035], 0.075, [0.0, 0.06]), { material: CHROME, depth: 0.03, bevel: 0.012, bevelSegments: 3, curveSegments: 8, crease: 40 }), { position: [0, 0, 0.098] }));
  put(n, 'carter_distribution', tour(CHROME, [[0, 0], [0.032, 0], [0.034, 0.006], [0.028, 0.018], [0.014, 0.026], [0, 0.028]], [0.085, -0.035, 0.112], { axis: 'z', segments: 28 }));
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    put(n, 'carter_distribution', bolt('alu', [0.045 + 0.06 * Math.cos(a) * 0.9, -0.035 + 0.06 * Math.sin(a) * 0.9, 0.114], 'z', 0.005, 0.005));
  }

  // Carter primaire, côté gauche : oblong, du vilebrequin à la boîte, avec son couvercle d'embrayage rond.
  put(n, 'carter_primaire', k.place(k.roundedExtrude(twoCircles([0.0, -0.04], 0.1, [-0.27, -0.055], 0.088), { material: NOIR, depth: 0.045, bevel: 0.016, bevelSegments: 3, curveSegments: 8, crease: 40 }), { position: [0, 0, -0.107] }));
  put(n, 'carter_primaire', tour(CHROME, [[0, 0], [0.066, 0], [0.07, 0.006], [0.064, 0.016], [0.04, 0.022], [0, 0.024]], [-0.27, -0.055, -0.128], { axis: 'z', segments: 36, rotation: [Math.PI, 0, 0] }));
  put(n, 'carter_primaire', tour(CHROME, [[0, 0], [0.05, 0], [0.053, 0.005], [0.046, 0.012], [0, 0.015]], [0.0, -0.04, -0.128], { axis: 'z', segments: 32, rotation: [Math.PI, 0, 0] }));

  // Carburateur dans le V, côté droit, et collecteur en Y vers les deux culasses.
  const CARB = /** @type {P3} */ ([0, 0.2, 0.128]);
  put(n, 'carburateur', bloc(F, CARB, [0.056, 0.062, 0.05], { r: 0.012, bevel: 0.005 }));
  put(n, 'carburateur', tour(F, [[0, 0], [0.024, 0], [0.026, 0.008], [0.026, 0.034], [0, 0.036]], [CARB[0], CARB[1] - 0.066, CARB[2]], { segments: 24 }));
  put(n, 'carburateur', k.rod([CARB[0] - 0.03, CARB[1] + 0.022, CARB[2] - 0.01], [CARB[0] + 0.035, CARB[1] + 0.022, CARB[2] - 0.01], 0.004, { material: 'alu', radial: 8 }));
  for (const s of [-1, 1]) {
    put(n, 'collecteur', k.tube([[0, CARB[1], CARB[2] - 0.026], [s * 0.025, CARB[1] + 0.012, 0.085], [s * 0.055, CARB[1] + 0.032, 0.06], on(s, 0.27, 0.045)], { material: F, radius: 0.017, radial: 14, segments: 30 }));
  }
  put(n, 'collecteur', tour(F, discProfile(0.03, 0.01, 0.002), [CARB[0], CARB[1], CARB[2] - 0.03], { axis: 'z', segments: 24 }));

  // Filtres, sur la face droite du carburateur.
  const AIR = /** @type {P3} */ ([CARB[0], CARB[1], CARB[2] + 0.025]);
  const toZ = /** @type {P3} */ ([Math.PI / 2, 0, 0]);
  put(n, 'filtre_boitier', k.place(tour(CHROME, [[0, 0], [0.084, 0], [0.088, 0.007], [0.088, 0.026], [0.08, 0.036], [0.04, 0.042], [0, 0.044]], [0, 0, 0], { segments: 48, crease: 45 }), { position: AIR, rotation: toZ }));
  put(n, 'filtre_boitier', k.place(bolt('alu', [0, 0.046, 0], 'y', 0.011, 0.008), { position: AIR, rotation: toZ }));
  put(n, 'filtre_cornet', cornet(AIR, { rotation: toZ }));
  put(n, 'filtre_conique', conique(AIR, { rotation: toZ, scale: 1.15 }));

  // Filtre à huile chromé, devant le bas moteur.
  put(n, 'filtre_huile', tour(CHROME, [[0, 0], [0.038, 0], [0.042, 0.006], [0.042, 0.08], [0.036, 0.09], [0, 0.092]], [0.15, -0.085, 0.03], { axis: 'x', segments: 28 }));

  // Bobine couchée sur la boîte, et ses deux fils vers les bougies, côté droit des culasses (sous le carburateur pour l'avant).
  const COIL = /** @type {P3} */ ([-0.245, 0.052, -0.03]);
  put(n, 'fils', tour(FILS, [[0, -0.05], [0.026, -0.05], [0.028, -0.044], [0.028, 0.044], [0.024, 0.05], [0.008, 0.052], [0.008, 0.062], [0, 0.062]], COIL, { axis: 'x', segments: 24 }));
  put(n, 'fils', bloc('black', [COIL[0], COIL[1] - 0.026, COIL[2]], [0.08, 0.01, 0.05], { r: 0.005, bevel: 0.002 }));
  for (const s of [-1, 1]) {
    const plug = on(s, 0.25, 0.098);
    put(n, 'fils', k.rod([plug[0], plug[1], plug[2] - 0.01], [plug[0], plug[1], plug[2] + 0.032], 0.0095, { material: FILS, radial: 12 }));
    const start = /** @type {P3} */ ([COIL[0] + 0.062, COIL[1], COIL[2]]);
    const route =
      s < 0
        ? /** @type {P3[]} */ ([[-0.17, 0.1, 0.06], [-0.14, 0.16, 0.14], [plug[0] - 0.02, plug[1] + 0.01, plug[2] + 0.06]])
        : /** @type {P3[]} */ ([[-0.17, 0.09, 0.07], [-0.1, 0.1, 0.13], [0.0, 0.118, 0.14], [0.07, 0.16, 0.145], [plug[0] + 0.01, plug[1] + 0.01, plug[2] + 0.06]]);
    put(n, 'fils', k.tube([start, ...route, [plug[0], plug[1], plug[2] + 0.032]], { material: FILS, radius: 0.0042, radial: 7, segments: 48 }));
  }

  return { nodes: n, lift: 0.58, support: { cradle: 0.2, width: 0.16 }, bottom: -0.13, offset: 0.06 };
}


// ---------------------------------------------------------------------------------------------
// 4 cylindres en ligne de moto, refroidi par liquide (la sportive) : bas moteur et boîte d'un bloc, carter
// d'huile dessous, bloc cylindres incliné vers l'avant, culasse et couvre-culasse à nervures, quatre
// bobines crayon, carter d'alternateur à gauche et d'embrayage à droite, quatre collecteurs d'échappement
// qui descendent devant et filent à droite en un seul tube, corps de papillon derrière la culasse,
// boîte à air (ou cornets, ou filtres coniques).

function quatreEnLigne() {
  /** @type {Map<string, Parts>} */
  const n = new Map();
  const T = (30 * Math.PI) / 180;
  /** Point du repère des cylindres (x' en travers, y' le long de l'axe) vers celui du moteur. @param {number} x @param {number} y @param {number} z @returns {P3} */
  const tp = (x, y, z) => [x * Math.cos(T) + y * Math.sin(T), -x * Math.sin(T) + y * Math.cos(T), z];
  /** Pièces modelées dans le repère des cylindres, inclinées vers l'avant. @param {Parts} parts */
  const tilt = (parts) => k.place(parts, { rotation: [0, 0, -T] });
  const Z = [-0.1125, -0.0375, 0.0375, 0.1125];

  // Carters : bas moteur et boîte, et l'assise du bloc.
  put(n, 'carters', bloc(F, [-0.06, -0.035, 0], [0.38, 0.17, 0.3], { r: 0.05, bevel: 0.012 }));
  put(n, 'carters', bloc(F, [-0.06, -0.035, 0], [0.392, 0.312, 0.012], { r: 0.05, bevel: 0.003, rotation: [Math.PI / 2, 0, 0] }));
  put(n, 'carters', tilt(bloc(F, [0, 0.035, 0], [0.13, 0.03, 0.3], { r: 0.01, bevel: 0.004 })));
  for (const x of [-0.2, -0.12]) put(n, 'carters', bloc(F, [x, 0.06, 0], [0.012, 0.03, 0.26], { r: 0.004, bevel: 0.002 }));

  // Carter d'huile, sous le bas moteur, et son bouchon de vidange.
  put(n, 'carter_huile', bloc(F, [-0.02, -0.142, 0], [0.26, 0.046, 0.24], { r: 0.016, bevel: 0.008 }));
  for (const z of [-0.08, -0.03, 0.02, 0.07]) put(n, 'carter_huile', bloc(F, [-0.02, -0.142, z], [0.24, 0.05, 0.006], { r: 0.012, bevel: 0.002 }));
  put(n, 'carter_huile', bolt('alu', [0.04, -0.166, 0.05], 'y', 0.009, 0.007));

  // Bloc cylindres, culasse et couvre-culasse, inclinés vers l'avant.
  put(n, 'bloc', tilt(bloc(F, [0, 0.105, 0], [0.11, 0.12, 0.31], { r: 0.012, bevel: 0.006 })));
  for (const y of [0.07, 0.1, 0.13]) put(n, 'bloc', tilt(bloc(F, [0, y, 0], [0.12, 0.006, 0.316], { r: 0.008, bevel: 0.002 })));
  put(n, 'culasse', tilt(bloc(F, [0, 0.205, 0], [0.132, 0.08, 0.32], { r: 0.016, bevel: 0.007 })));
  for (const z of [-0.165, 0.165]) put(n, 'culasse', tilt(bloc(F, [0, 0.205, z], [0.1, 0.06, 0.012], { r: 0.012, bevel: 0.003 })));
  put(n, 'cache_culbuteurs', tilt(bloc(NOIR, [0, 0.265, 0], [0.122, 0.046, 0.302], { r: 0.02, bevel: 0.013 })));
  for (const x of [-0.034, 0.034]) put(n, 'cache_culbuteurs', tilt(bloc(NOIR, [x, 0.29, 0], [0.018, 0.012, 0.26], { r: 0.005, bevel: 0.003 })));
  for (const x of [-0.05, 0.05]) for (const z of [-0.13, 0, 0.13]) put(n, 'cache_culbuteurs', tilt(bolt('alu', [x, 0.29, z], 'y', 0.006, 0.006)));

  // Bobines crayon et leur faisceau.
  for (const z of Z) {
    put(n, 'bobines', tilt(tour(FILS, [[0, 0], [0.014, 0], [0.014, 0.03], [0.018, 0.034], [0.018, 0.046], [0, 0.048]], [0, 0.286, z], { segments: 16 })));
    put(n, 'bobines', tilt(bloc('black', [0.014, 0.328, z], [0.03, 0.014, 0.02], { r: 0.004, bevel: 0.002 })));
  }
  put(n, 'bobines', k.tube(Z.map((z) => tp(0.03, 0.335, z)), { material: FILS, radius: 0.006, radial: 8, segments: 24 }));

  // Collecteurs d'échappement : quatre tubes qui sortent devant la culasse, descendent et filent à droite.
  const MERGE = /** @type {P3} */ ([0.2, -0.085, 0.2]);
  Z.forEach((z, i) => {
    const port = tp(0.066, 0.2, z);
    const ahead = tp(0.12, 0.19, z);
    put(n, 'collecteur', k.tube([port, ahead, [0.235, 0.02, z * 0.9], [0.235, -0.05, z * 0.7 + 0.03 * i], [MERGE[0] + 0.01, MERGE[1] + 0.01, MERGE[2] - 0.05], MERGE], { material: ACIER, radius: 0.017, radial: 14, segments: 60 }));
    put(n, 'collecteur', tilt(bloc(ACIER, [0.07, 0.2, z], [0.012, 0.05, 0.06], { r: 0.01, bevel: 0.002 })));
  });
  put(n, 'collecteur', k.tube([MERGE, [0.12, -0.1, 0.24], [0.0, -0.105, 0.245], [-0.24, -0.1, 0.245]], { material: ACIER, radius: 0.03, radial: 18, segments: 40 }));
  put(n, 'collecteur', tour(ACIER, shellProfile(0.034, 0.004, -0.01, 0.01), [-0.245, -0.1, 0.245], { axis: 'x', segments: 24 }));

  // Corps de papillon derrière la culasse, et la rampe d'injection.
  const INTAKE = /** @type {P2} */ ([-0.64, 0.77]);
  /** @type {P3[]} */
  const tops = [];
  for (const z of Z) {
    const base = tp(-0.066, 0.205, z);
    const top = /** @type {P3} */ ([base[0] + INTAKE[0] * 0.07, base[1] + INTAKE[1] * 0.07, z]);
    tops.push(top);
    put(n, 'papillons', k.rod(base, top, 0.024, { material: F, radial: 20 }));
    put(n, 'papillons', k.rod([base[0] + INTAKE[0] * 0.03, base[1] + INTAKE[1] * 0.03, z - 0.03], [base[0] + INTAKE[0] * 0.03, base[1] + INTAKE[1] * 0.03, z + 0.03], 0.006, { material: 'alu', radial: 8 }));
  }
  const RAIL0 = /** @type {P3} */ (tops[0] ?? [0, 0, 0]);
  put(n, 'papillons', k.rod([RAIL0[0] + 0.025, RAIL0[1] - 0.015, -0.15], [RAIL0[0] + 0.025, RAIL0[1] - 0.015, 0.15], 0.008, { material: 'alu', radial: 10 }));

  // Filtres : boîte à air sur les quatre corps, ou quatre cornets, ou quatre filtres coniques.
  const spin = /** @type {P3} */ ([0, 0, Math.atan2(-INTAKE[0], INTAKE[1])]);
  const box = /** @type {P3} */ ([RAIL0[0] + INTAKE[0] * 0.05, RAIL0[1] + INTAKE[1] * 0.05, 0]);
  put(n, 'filtre_boitier', k.place(bloc(NOIR, [0, 0, 0], [0.17, 0.1, 0.36], { r: 0.035, bevel: 0.02 }), { position: box, rotation: spin }));
  put(n, 'filtre_boitier', k.place(bloc(NOIR, [0.0, 0.055, 0], [0.11, 0.012, 0.28], { r: 0.02, bevel: 0.004 }), { position: box, rotation: spin }));
  for (const top of tops) {
    put(n, 'filtre_cornet', cornet(top, { rotation: spin, scale: 0.78 }));
    put(n, 'filtre_conique', conique(top, { rotation: spin, scale: 0.72 }));
  }

  // Carters latéraux : alternateur à gauche, embrayage à droite.
  /** Profil d'un couvercle bombé de rayon r et de bombé h. @param {number} r @param {number} h */
  const cover = (r, h) => [[0, 0], [r, 0], [r + 0.004, h * 0.25], [r - 0.006, h * 0.7], [r * 0.6, h * 0.95], [0, h]].map(([a, b]) => /** @type {P2} */ ([a ?? 0, b ?? 0]));
  put(n, 'carter_alternateur', tour(F, cover(0.075, 0.04), [-0.02, -0.02, -0.148], { axis: 'z', segments: 40, rotation: [Math.PI, 0, 0] }));
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI * 2 * i) / 6;
    put(n, 'carter_alternateur', bolt('alu', [-0.02 + 0.07 * Math.cos(a), -0.02 + 0.07 * Math.sin(a), -0.172], 'z', 0.005, 0.006));
  }
  put(n, 'carter_embrayage', tour(F, cover(0.095, 0.045), [-0.13, -0.035, 0.148], { axis: 'z', segments: 44 }));
  put(n, 'carter_embrayage', tour(F, discProfile(0.04, 0.012, 0.003), [-0.13, -0.035, 0.196], { axis: 'z', segments: 28 }));
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI * 2 * i) / 8;
    put(n, 'carter_embrayage', bolt('alu', [-0.13 + 0.09 * Math.cos(a), -0.035 + 0.09 * Math.sin(a), 0.176], 'z', 0.005, 0.006));
  }

  return { nodes: n, lift: 0.6, support: { cradle: 0.26, width: 0.22, clearance: 0.1 }, bottom: -0.12, offset: 0.03 };
}


// ---------------------------------------------------------------------------------------------
// V8 à 90° (le concept) : bloc en V d'alu, carter d'huile dessous, deux culasses et deux couvre-culasses
// à nervures, bobines crayon, collecteur d'admission dans le V avec son plénum et son papillon devant,
// collecteurs d'échappement le long des flancs, poulies, courroie et alternateur à l'avant.

function v8() {
  /** @type {Map<string, Parts>} */
  const n = new Map();
  const B = Math.PI / 4;
  /** Point d'une rangée (s : −1 gauche, +1 droite) : d le long de son axe, w en travers (vers l'extérieur), x. @param {number} s @param {number} d @param {number} w @param {number} x @returns {P3} */
  const bp = (s, d, w, x) => [x, Math.cos(B) * d - Math.sin(B) * w, s * (Math.sin(B) * d + Math.cos(B) * w)];
  /** Pièces modelées dans le repère d'une rangée (y le long de l'axe, z en travers), posées sur elle. @param {Parts} parts @param {number} s */
  const bank = (parts, s) => k.place(parts, { rotation: [s * B, 0, 0] });
  const side = (/** @type {number} */ s) => (s < 0 ? 'g' : 'd');
  const X = [-0.165, -0.055, 0.055, 0.165];

  // Bloc : bas moteur, les deux rangées en V, face avant (couvercle de distribution).
  put(n, 'bloc', bloc(F, [0, -0.01, 0], [0.6, 0.18, 0.34], { r: 0.04, bevel: 0.012 }));
  for (const s of [-1, 1]) put(n, 'bloc', bank(bloc(F, [0.01, 0.15, 0], [0.56, 0.14, 0.15], { r: 0.02, bevel: 0.008 }), s));
  put(n, 'bloc', k.place(k.roundedExtrude(k.roundedRect(0.3, 0.3, 0.07, 4), { material: F, depth: 0.04, bevel: 0.01, bevelSegments: 2, axis: 'x', curveSegments: 4, crease: 40 }), { position: [0.31, 0.09, 0] }));
  for (const s of [-1, 1]) for (const x of X) put(n, 'bloc', bank(bloc(F, [x + (s < 0 ? 0.02 : 0), 0.14, s * 0.078], [0.05, 0.1, 0.008], { r: 0.012, bevel: 0.002 }), s));

  // Carter d'huile.
  put(n, 'carter_huile', bloc(F, [-0.03, -0.14, 0], [0.48, 0.08, 0.28], { r: 0.025, bevel: 0.01 }));
  for (const x of [-0.18, -0.09, 0, 0.09]) put(n, 'carter_huile', bloc(F, [x, -0.18, 0], [0.012, 0.012, 0.24], { r: 0.004, bevel: 0.002 }));

  for (const s of [-1, 1]) {
    // Culasses et couvre-culasses à nervures, et les bobines dessus.
    put(n, `culasses_${side(s)}`, bank(bloc(F, [0.01, 0.26, 0], [0.57, 0.08, 0.17], { r: 0.015, bevel: 0.006 }), s));
    put(n, `cache_culbuteurs_${side(s)}`, bank(bloc(NOIR, [0.01, 0.322, 0], [0.54, 0.05, 0.15], { r: 0.03, bevel: 0.016 }), s));
    for (const w of [-0.05, -0.025, 0.025, 0.05]) put(n, `cache_culbuteurs_${side(s)}`, bank(bloc(NOIR, [0.01, 0.348, w], [0.44, 0.012, 0.006], { r: 0.004, bevel: 0.002 }), s));
    for (const x of [-0.24, 0.0, 0.24]) put(n, `cache_culbuteurs_${side(s)}`, bank(bolt('alu', [x, 0.347, s * 0.062], 'y', 0.006, 0.006), s));
    for (const x of X) {
      const cx = x + (s < 0 ? 0.02 : 0);
      put(n, `bobines_${side(s)}`, bank(tour(FILS, [[0, 0], [0.016, 0], [0.016, 0.035], [0.02, 0.04], [0.02, 0.05], [0, 0.052]], [cx, 0.345, 0], { segments: 16 }), s));
      put(n, `bobines_${side(s)}`, bank(bloc('black', [cx, 0.402, s * 0.012], [0.03, 0.014, 0.04], { r: 0.004, bevel: 0.002 }), s));
    }
    // Collecteurs d'échappement : quatre tubes au flanc de chaque culasse, vers l'arrière et le bas.
    X.forEach((x, i) => {
      const cx = x + (s < 0 ? 0.02 : 0);
      const port = bp(s, 0.25, 0.085, cx);
      put(n, `echappement_${side(s)}`, k.tube([port, [cx, port[1] - 0.04, s * 0.3], [cx - 0.04, 0.02, s * 0.3], [-0.2 - 0.01 * i, -0.04, s * 0.29], [-0.26, -0.05, s * 0.28]], { material: ACIER, radius: 0.019, radial: 14, segments: 50 }));
    });
    put(n, `echappement_${side(s)}`, k.tube([[-0.24, -0.048, s * 0.28], [-0.32, -0.06, s * 0.27], [-0.38, -0.07, s * 0.26]], { material: ACIER, radius: 0.034, radial: 18, segments: 16 }));
    put(n, `echappement_${side(s)}`, tour(ACIER, shellProfile(0.038, 0.004, -0.01, 0.01), [-0.385, -0.07, s * 0.26], { axis: 'x', segments: 24 }));
    // Pipes d'admission : de la culasse, côté du V, au plénum.
    for (const x of X) {
      const cx = x + (s < 0 ? 0.02 : 0);
      put(n, 'collecteur', k.tube([bp(s, 0.27, -0.09, cx), [cx, 0.31, s * 0.08], [cx, 0.33, s * 0.04]], { material: F, radius: 0.022, radial: 14, segments: 20 }));
    }
  }

  // Plénum d'admission dans le V, et le papillon devant.
  put(n, 'collecteur', bloc(F, [-0.02, 0.36, 0], [0.42, 0.09, 0.16], { r: 0.035, bevel: 0.014 }));
  for (const x of [-0.16, -0.06, 0.04, 0.14]) put(n, 'collecteur', bloc(F, [x, 0.407, 0], [0.012, 0.01, 0.12], { r: 0.004, bevel: 0.002 }));
  put(n, 'collecteur', tour(F, [[0, 0], [0.048, 0], [0.05, 0.006], [0.05, 0.05], [0.054, 0.056], [0.054, 0.066], [0, 0.066]], [0.18, 0.36, 0], { segments: 32, rotation: [0, 0, -Math.PI / 2] }));

  // Filtres : boîte à air devant le papillon, ou un gros cornet, ou un gros filtre conique.
  const AIR = /** @type {P3} */ ([0.246, 0.36, 0]);
  const toX = /** @type {P3} */ ([0, 0, -Math.PI / 2]);
  put(n, 'filtre_boitier', bloc(NOIR, [AIR[0] + 0.07, AIR[1], 0], [0.12, 0.12, 0.22], { r: 0.03, bevel: 0.018 }));
  put(n, 'filtre_boitier', k.rod(AIR, [AIR[0] + 0.02, AIR[1], 0], 0.05, { material: NOIR, radial: 24 }));
  put(n, 'filtre_cornet', cornet(AIR, { rotation: toX, scale: 1.45 }));
  put(n, 'filtre_conique', conique(AIR, { rotation: toX, scale: 1.35 }));

  // Poulies et courroie à l'avant : vilebrequin, pompe à eau, alternateur.
  /** @type {[P2, number][]} */
  const wheels = [
    [[-0.02, 0], 0.09],
    [[0.17, 0], 0.06],
    [[0.0, 0.24], 0.042],
  ];
  for (const [[y, z], r] of wheels) put(n, 'poulies', tour(ACIER, pulleyProfile(r, 0.03, 0.01, 0.0), [0.35, y, z], { axis: 'x', segments: 36, crease: 40 }));
  /** @type {P3[]} */
  const path = [];
  const around = (/** @type {P2} */ c, /** @type {number} */ r, /** @type {number} */ a0, /** @type {number} */ a1) => {
    for (let i = 0; i <= 8; i += 1) {
      const a = a0 + ((a1 - a0) * i) / 8;
      path.push([0.35, c[0] + r * Math.sin(a), c[1] + r * Math.cos(a)]);
    }
  };
  // Le tour par l'extérieur des trois poulies, dans le sens trigonométrique (vu de l'avant).
  around([-0.02, 0], 0.082, Math.PI, Math.PI * 1.85);
  around([0.0, 0.24], 0.035, -Math.PI * 0.45, Math.PI * 0.55);
  around([0.17, 0], 0.052, Math.PI * 0.15, Math.PI);
  put(n, 'poulies', k.tube(path, { material: 'rubber', radius: 0.006, radial: 6, closed: true, segments: 120 }));
  put(n, 'alternateur', tour(TOLE, [[0, -0.07], [0.055, -0.07], [0.06, -0.06], [0.06, 0.05], [0.05, 0.06], [0, 0.062]], [0.26, 0.0, 0.24], { axis: 'x', segments: 32 }));
  for (const x of [0.22, 0.26, 0.3]) put(n, 'alternateur', tour('black', discProfile(0.062, 0.006, 0.001), [x, 0, 0.24], { axis: 'x', segments: 32 }));

  return { nodes: n, lift: 0.7, support: { cradle: 0.4, width: 0.28, clearance: 0.2 }, bottom: -0.1, offset: 0 };
}

// ---------------------------------------------------------------------------------------------

/** @type {Record<string, () => { nodes: Map<string, Parts>, lift: number, support: { cradle?: number, width?: number, clearance?: number }, bottom: number, offset?: number }>} */
const FAMILIES = {
  'quatre-a-plat': quatreAPlat,
  'bicylindre-v': bicylindreV,
  'quatre-en-ligne-moto': quatreEnLigne,
  v8,
};

/** Familles que l'outil sait modeler. */
export const MODELED = Object.freeze(Object.keys(FAMILIES));

/**
 * Le moteur d'une famille, posé sur son support : nœud par nœud, ses pièces (nœuds part_<nom>), et le
 * support. Vérifie que les nœuds modelés sont exactement ceux du catalogue.
 * @param {Famille} famille
 * @returns {Map<string, Parts>} nœud du GLB → pièces
 */
export function buildEngine(famille) {
  const make = FAMILIES[famille.id];
  if (!make) throw new Error(`moteur « ${famille.id} » : aucun modelage (${MODELED.join(', ')})`);
  const built = make();
  const wanted = catalogueNodes(famille);
  const missing = wanted.filter((node) => !built.nodes.has(node));
  const extra = [...built.nodes.keys()].filter((node) => !wanted.includes(node));
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(`moteur « ${famille.id} » : nœuds du catalogue sans modelage (${missing.join(', ') || 'aucun'}), nœuds modelés absents du catalogue (${extra.join(', ') || 'aucun'})`);
  }
  /** @type {Map<string, Parts>} */
  const out = new Map();
  // Le support : ses berceaux portent le dessous du moteur (bottom, dans le repère du moteur).
  out.set(SUPPORT_NODE, support(built.lift + built.bottom, built.support));
  // Le moteur se pose au milieu du support (offset : son milieu sur X, s'il n'est pas sur le vilebrequin).
  for (const [node, parts] of built.nodes) out.set(`${PART_PREFIX}${node}`, k.place(parts, { position: [built.offset ?? 0, built.lift, 0] }));
  return out;
}

/**
 * Le GLB d'une famille : le modèle (racine placeholder_moteur_<famille>) et ses matières d'origine.
 * @param {Famille} famille @param {Catalogue} [catalogue]
 */
export function engineModel(famille, catalogue = readCatalogue()) {
  const m = new k.Model(`placeholder_moteur_${famille.id.replace(/-/g, '_')}`);
  for (const matiere of catalogue.matieres) m.material(matiere.id, { color: matiere.color, metallic: matiere.metalness, roughness: matiere.roughness });
  for (const [node, parts] of buildEngine(famille)) m.add(node, parts);
  return m;
}

