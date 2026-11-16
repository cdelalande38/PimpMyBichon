// @ts-check
// Plans d'eau et mer des cartes : triangulation du plan d'eau entier (contour extérieur moins les
// îles, d'un seul tenant : découpé en carreaux, une île à cheval sur deux carreaux ne pouvait plus
// être retirée), puis répartition des triangles entre les tronçons de décor. Un triangle va dans
// chaque tronçon dont le rail passe à moins de `portee` mètres de lui : le tronçon où se trouve la
// caméra porte ainsi toute l'eau visible depuis lui, même quand les tronçons voisins ne sont pas
// chargés (sinon le lac paraissait troué au loin). Fonctions pures, testées par
// tests/unit/cartes-eau.test.ts.

import { ShapeUtils, Vector2 } from 'three';
import { aire } from './geom2d.mjs';

/**
 * Triangles d'un plan d'eau : le premier anneau est le contour, les suivants des îles. Rend des
 * triangles [x0, z0, x1, z1, x2, z2] orientés vers le haut (sens horaire dans le plan X, Z).
 * @param {number[][][]} anneaux [x, z]
 * @returns {number[][]}
 */
export function trianglesEau(anneaux) {
  const net = (/** @type {number[][]} */ a) => {
    const f = /** @type {number[]} */ (a[0]);
    const l = /** @type {number[]} */ (a[a.length - 1]);
    return a.length > 1 && f[0] === l[0] && f[1] === l[1] ? a.slice(0, -1) : a;
  };
  const ext = net(/** @type {number[][]} */ (anneaux[0] ?? []));
  if (ext.length < 3 || Math.abs(aire(ext)) < 0.01) return [];
  const contour = ext.map((p) => new Vector2(p[0], p[1]));
  const holes = anneaux
    .slice(1)
    .map(net)
    .filter((a) => a.length >= 3)
    .map((a) => a.map((p) => new Vector2(p[0], p[1])));
  const tous = [...contour, ...holes.flat()];
  /** @type {number[][]} */
  const out = [];
  for (const [i0, i1, i2] of ShapeUtils.triangulateShape(contour, holes)) {
    const A = /** @type {Vector2} */ (tous[i0 ?? 0]);
    const B = /** @type {Vector2} */ (tous[i1 ?? 0]);
    const C = /** @type {Vector2} */ (tous[i2 ?? 0]);
    const cross = (B.x - A.x) * (C.y - A.y) - (B.y - A.y) * (C.x - A.x);
    if (Math.abs(cross) < 1e-6) continue;
    out.push(cross < 0 ? [A.x, A.y, B.x, B.y, C.x, C.y] : [A.x, A.y, C.x, C.y, B.x, B.y]);
  }
  return out;
}

/** Distance d'un point à une polyligne [x, z]. @param {number[][]} poly @param {number} x @param {number} z */
function distance(poly, x, z) {
  if (poly.length === 1) return Math.hypot(x - (poly[0]?.[0] ?? 0), z - (poly[0]?.[1] ?? 0));
  let d = Infinity;
  for (let i = 0; i < poly.length - 1; i += 1) {
    const a = /** @type {number[]} */ (poly[i]);
    const b = /** @type {number[]} */ (poly[i + 1]);
    const dx = (b[0] ?? 0) - (a[0] ?? 0);
    const dz = (b[1] ?? 0) - (a[1] ?? 0);
    const L2 = dx * dx + dz * dz;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((x - (a[0] ?? 0)) * dx + (z - (a[1] ?? 0)) * dz) / L2)) : 0;
    d = Math.min(d, Math.hypot(x - (a[0] ?? 0) - dx * t, z - (a[1] ?? 0) - dz * t));
  }
  return d;
}

/**
 * Répartit l'eau entre les tronçons : chaque triangle dans tous les tronçons dont le rail (une
 * polyligne [x, z] par tronçon) passe à moins de `portee` mètres de lui (centre moins rayon).
 * @param {Array<{ y: number, anneaux: number[][][] }>} lacs
 * @param {number[][][]} rails
 * @param {{ portee?: number }} [o]
 * @returns {Array<Array<{ y: number, tris: number[][] }>>} par tronçon, un lot par plan d'eau
 */
export function repartirEau(lacs, rails, o = {}) {
  const portee = o.portee ?? 1200;
  /** @type {Array<Array<{ y: number, tris: number[][] }>>} */
  const out = rails.map(() => []);
  for (const l of lacs) {
    const lots = rails.map(() => /** @type {number[][]} */ ([]));
    for (const t of trianglesEau(l.anneaux)) {
      const cx = ((t[0] ?? 0) + (t[2] ?? 0) + (t[4] ?? 0)) / 3;
      const cz = ((t[1] ?? 0) + (t[3] ?? 0) + (t[5] ?? 0)) / 3;
      let r = 0;
      for (let k = 0; k < 6; k += 2) r = Math.max(r, Math.hypot((t[k] ?? 0) - cx, (t[k + 1] ?? 0) - cz));
      rails.forEach((rail, c) => {
        if (distance(rail, cx, cz) - r <= portee) /** @type {number[][]} */ (lots[c]).push(t);
      });
    }
    lots.forEach((tris, c) => {
      if (tris.length) /** @type {Array<{ y: number, tris: number[][] }>} */ (out[c]).push({ y: l.y, tris });
    });
  }
  return out;
}
