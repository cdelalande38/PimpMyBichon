// @ts-check
// Outils propres au bobber, en complément de tools/vehicles/kit.mjs (qu'on ne modifie pas) :
// - sweep : surface tendue sur des anneaux 3D quelconques (garde-boue balayés autour d'un essieu) ;
// - hull : enveloppe convexe d'un nuage de points 2D (carter primaire, courroie, tés de fourche) ;
// - bevelCut : coupe en biseau du bout d'un tube (échappements).

import { BufferAttribute, BufferGeometry } from 'three';

/** @typedef {[number, number]} P2 */
/** @typedef {[number, number, number]} P3 */
/** @typedef {typeof import('../../../tools/vehicles/kit.mjs')} Kit */
/** @typedef {import('../../../tools/vehicles/kit.mjs').Parts} Parts */

/**
 * Surface sur des anneaux fermés successifs (même nombre de points chacun), bouts fermés en
 * éventail. Orientation réglée seule : les normales pointent hors du centre de chaque anneau.
 * @param {Kit} k @param {P3[][]} rings @param {{ material: string, crease?: number, caps?: boolean }} o
 * @returns {Parts}
 */
export function sweep(k, rings, o) {
  const n = rings.length;
  const m = rings[0]?.length ?? 0;
  /** @type {number[]} */
  const pos = [];
  for (const ring of rings) for (const p of ring) pos.push(p[0], p[1], p[2]);
  const centers = rings.map((ring) => {
    const c = [0, 0, 0];
    for (const p of ring) for (let a = 0; a < 3; a += 1) c[a] = /** @type {number} */ (c[a]) + p[a] / ring.length;
    return /** @type {P3} */ (c);
  });
  /** @type {number[]} */
  const side = [];
  for (let i = 0; i < n - 1; i += 1)
    for (let j = 0; j < m; j += 1) {
      const a = i * m + j;
      const b = i * m + ((j + 1) % m);
      const c = (i + 1) * m + j;
      const d = (i + 1) * m + ((j + 1) % m);
      side.push(a, b, d, a, d, c);
    }
  // Orientation : somme des produits normale · (centre du triangle − centre de l'anneau).
  const P = (/** @type {number} */ i) => /** @type {P3} */ ([pos[3 * i] ?? 0, pos[3 * i + 1] ?? 0, pos[3 * i + 2] ?? 0]);
  let score = 0;
  for (let t = 0; t < side.length; t += 3) {
    const [ia, ib, ic] = [side[t] ?? 0, side[t + 1] ?? 0, side[t + 2] ?? 0];
    const A = P(ia);
    const B = P(ib);
    const C = P(ic);
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const nx = u[1] * v[2] - u[2] * v[1];
    const ny = u[2] * v[0] - u[0] * v[2];
    const nz = u[0] * v[1] - u[1] * v[0];
    const ctr = centers[Math.floor(ia / m)] ?? [0, 0, 0];
    score += nx * ((A[0] + B[0] + C[0]) / 3 - ctr[0]) + ny * ((A[1] + B[1] + C[1]) / 3 - ctr[1]) + nz * ((A[2] + B[2] + C[2]) / 3 - ctr[2]);
  }
  const flip = score < 0;
  /** @type {number[]} */
  const idx = [];
  for (let t = 0; t < side.length; t += 3) {
    if (flip) idx.push(side[t] ?? 0, side[t + 2] ?? 0, side[t + 1] ?? 0);
    else idx.push(side[t] ?? 0, side[t + 1] ?? 0, side[t + 2] ?? 0);
  }
  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  geo.setIndex(idx);
  /** @type {Parts} */
  const parts = [{ material: o.material, geometry: k.smooth(geo, o.crease ?? 50) }];
  if (o.caps ?? true) {
    for (const [ri, rj] of [
      [0, 1],
      [n - 1, n - 2],
    ]) {
      const ring = /** @type {P3[]} */ (rings[/** @type {number} */ (ri)]);
      const c = /** @type {P3} */ (centers[/** @type {number} */ (ri)]);
      const out = /** @type {P3} */ (centers[/** @type {number} */ (rj)]).map((v, a) => c[a] - v);
      /** @type {number[]} */
      const cp = [...c];
      for (const p of ring) cp.push(...p);
      /** @type {number[]} */
      const ci = [];
      for (let j = 0; j < m; j += 1) {
        const a = 1 + j;
        const b = 1 + ((j + 1) % m);
        const A = ring[j] ?? c;
        const B = ring[(j + 1) % m] ?? c;
        const u = [A[0] - c[0], A[1] - c[1], A[2] - c[2]];
        const v = [B[0] - c[0], B[1] - c[1], B[2] - c[2]];
        const nn = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
        const dot = nn[0] * (out[0] ?? 0) + nn[1] * (out[1] ?? 0) + nn[2] * (out[2] ?? 0);
        if (dot >= 0) ci.push(0, a, b);
        else ci.push(0, b, a);
      }
      const g = new BufferGeometry();
      g.setAttribute('position', new BufferAttribute(new Float32Array(cp), 3));
      g.setIndex(ci);
      parts.push({ material: o.material, geometry: k.smooth(g, 30) });
    }
  }
  return parts;
}

/**
 * Pièce balayée autour d'un axe parallèle à Z (garde-boue) : `profile` est un contour fermé
 * [z, r] (r : distance à l'axe), tourné de `from` à `to` degrés (0° = +X, 90° = +Y).
 * @param {Kit} k @param {P2[]} profile @param {{ center: P2, from: number, to: number, steps?: number, material: string, crease?: number }} o
 */
export function arcSweep(k, profile, o) {
  const steps = o.steps ?? 40;
  /** @type {P3[][]} */
  const rings = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = ((o.from + ((o.to - o.from) * i) / steps) * Math.PI) / 180;
    rings.push(profile.map(([z, r]) => /** @type {P3} */ ([o.center[0] + r * Math.cos(a), o.center[1] + r * Math.sin(a), z])));
  }
  return sweep(k, rings, { material: o.material, crease: o.crease ?? 60 });
}

/**
 * Enveloppe convexe (chaîne monotone), sens trigonométrique.
 * @param {P2[]} pts @returns {P2[]}
 */
export function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (/** @type {P2} */ o, /** @type {P2} */ a, /** @type {P2} */ b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  /** @type {P2[]} */
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(/** @type {P2} */ (lo[lo.length - 2]), /** @type {P2} */ (lo[lo.length - 1]), q) <= 0) lo.pop();
    lo.push(q);
  }
  /** @type {P2[]} */
  const up = [];
  for (const q of [...p].reverse()) {
    while (up.length >= 2 && cross(/** @type {P2} */ (up[up.length - 2]), /** @type {P2} */ (up[up.length - 1]), q) <= 0) up.pop();
    up.push(q);
  }
  return [...lo.slice(0, -1), ...up.slice(0, -1)];
}

/**
 * Contour convexe englobant des cercles [cx, cy, r] (oblong, haricot convexe).
 * @param {[number, number, number][]} circles @param {number} [n] points par cercle
 */
export function circlesHull(circles, n = 32) {
  /** @type {P2[]} */
  const pts = [];
  for (const [cx, cy, r] of circles) for (let i = 0; i < n; i += 1) pts.push([cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n)]);
  return hull(pts);
}

/**
 * Coupe en biseau le bout arrière (vers −X) de pièces : tout sommet au-delà du plan
 * x = x0 + slope · (y − y0) y est ramené. Les normales gardent leur valeur (le tube reste rond).
 * @param {Parts} parts @param {{ x0: number, y0: number, slope: number }} o
 */
export function bevelCut(parts, o) {
  for (const p of parts) {
    const a = p.geometry.getAttribute('position');
    for (let i = 0; i < a.count; i += 1) {
      const lim = o.x0 + o.slope * (a.getY(i) - o.y0);
      if (a.getX(i) < lim) a.setX(i, lim);
    }
    a.needsUpdate = true;
  }
  return parts;
}
