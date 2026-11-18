// @ts-check
// Moteur posé dans la caisse (§ 5.11, demande du 18 novembre 2026) : contrôle, sur les fichiers
// construits, que le moteur de l'établi (public/assets/shared/engines/<famille>/moteur.glb), posé où le
// manifeste le dit (engine.pose : position de l'origine du fichier, demi-tour, échelle), reste dans la
// coque du véhicule (nœuds de la caisse et du capot fermé) : aucun sommet ne la traverse. Rayons
// verticaux et parité des croisements, triangles rangés dans une grille au sol (2 cm) : quelques
// dixièmes de seconde par véhicule. Node seul, sans navigateur.

import { parseGlb } from '../lib/glb.mjs';

/** @typedef {[number, number, number]} P3 */
/** @typedef {{ position: readonly [number, number, number], yaw?: number, scale?: number }} EnginePose */

const CELL = 0.02;
/** Pas de côté des trois verticales d'un sommet, en mètres. */
const JITTER = /** @type {const} */ ([
  [1.37e-5, 2.71e-5],
  [-2.23e-4, 1.19e-4],
  [1.61e-4, -2.87e-4],
]);

/**
 * Lit les positions et les indices d'une primitive.
 * @param {{ json: any, bin: Uint8Array }} c @param {any} prim
 */
function primitive(c, prim) {
  const acc = c.json.accessors[prim.attributes.POSITION];
  const view = c.json.bufferViews[acc.bufferView];
  const start = c.bin.byteOffset + (view.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const positions = new Float32Array(c.bin.buffer.slice(start, start + acc.count * 12));
  const iacc = c.json.accessors[prim.indices];
  const iview = c.json.bufferViews[iacc.bufferView];
  const istart = c.bin.byteOffset + (iview.byteOffset ?? 0) + (iacc.byteOffset ?? 0);
  const indices = iacc.componentType === 5125 ? new Uint32Array(c.bin.buffer.slice(istart, istart + iacc.count * 4)) : new Uint16Array(c.bin.buffer.slice(istart, istart + iacc.count * 2));
  return { positions, indices };
}

/** Rotation d'un point par un quaternion [x, y, z, w]. @param {P3} p @param {number[]} q @returns {P3} */
function rotate(p, q) {
  const [x, y, z] = p;
  const [qx = 0, qy = 0, qz = 0, qw = 1] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

/**
 * Triangles (repère du modèle) des nœuds retenus d'un GLB, à plat : 9 nombres par triangle.
 * @param {Uint8Array} bytes @param {(name: string) => boolean} keep
 * @returns {Float64Array}
 */
export function nodeTriangles(bytes, keep) {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  const c = parsed.container;
  /** @type {number[]} */
  const out = [];
  for (const node of c.json.nodes ?? []) {
    if (node.mesh === undefined || !keep(node.name)) continue;
    const t = node.translation ?? [0, 0, 0];
    const q = node.rotation ?? [0, 0, 0, 1];
    for (const prim of c.json.meshes[node.mesh].primitives) {
      const { positions, indices } = primitive(c, prim);
      for (let i = 0; i < indices.length; i += 1) {
        const v = /** @type {number} */ (indices[i]);
        const p = rotate([/** @type {number} */ (positions[v * 3]), /** @type {number} */ (positions[v * 3 + 1]), /** @type {number} */ (positions[v * 3 + 2])], q);
        out.push(p[0] + /** @type {number} */ (t[0]), p[1] + /** @type {number} */ (t[1]), p[2] + /** @type {number} */ (t[2]));
      }
    }
  }
  return Float64Array.from(out);
}

/**
 * Sommets d'un moteur (nœuds part_* seulement, sans le support), repère du fichier.
 * @param {Uint8Array} bytes
 * @returns {Float64Array}
 */
export function engineVertices(bytes) {
  const tris = nodeTriangles(bytes, (name) => name.startsWith('part_'));
  return tris;
}

/**
 * Pose un point du repère du moteur dans celui du véhicule : échelle, demi-tour autour de Y, puis la position.
 * @param {EnginePose} pose @param {number} x @param {number} y @param {number} z @returns {P3}
 */
export function poseEnginePoint(pose, x, y, z) {
  const s = pose.scale ?? 1;
  const a = ((pose.yaw ?? 0) * Math.PI) / 180;
  const c = Math.cos(a);
  const n = Math.sin(a);
  const [px, py, pz] = pose.position;
  return [px + s * (c * x + n * z), py + s * y, pz + s * (-n * x + c * z)];
}

/** Grille des triangles par case au sol (x, z). @param {Float64Array} tris */
function grid(tris) {
  /** @type {Map<string, number[]>} */
  const cells = new Map();
  for (let t = 0; t < tris.length / 9; t += 1) {
    const o = t * 9;
    const xs = [tris[o], tris[o + 3], tris[o + 6]].map(Number);
    const zs = [tris[o + 2], tris[o + 5], tris[o + 8]].map(Number);
    const [i0, i1] = [Math.floor(Math.min(...xs) / CELL), Math.floor(Math.max(...xs) / CELL)];
    const [j0, j1] = [Math.floor(Math.min(...zs) / CELL), Math.floor(Math.max(...zs) / CELL)];
    for (let i = i0; i <= i1; i += 1) {
      for (let j = j0; j <= j1; j += 1) {
        const key = `${i},${j}`;
        let list = cells.get(key);
        if (!list) cells.set(key, (list = []));
        list.push(t);
      }
    }
  }
  return cells;
}

/**
 * Hauteurs où la verticale (x, z) croise les triangles de la grille.
 * @param {Float64Array} tris @param {Map<string, number[]>} cells @param {number} x @param {number} z
 */
function crossings(tris, cells, x, z) {
  const list = cells.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`) ?? [];
  /** @type {number[]} */
  const ys = [];
  for (const t of list) {
    const o = t * 9;
    const [ax, ay, az, bx, by, bz, cx, cy, cz] = /** @type {[number, number, number, number, number, number, number, number, number]} */ (/** @type {unknown} */ (Array.from(tris.subarray(o, o + 9))));
    // Barycentriques dans le plan (x, z).
    const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(d) < 1e-14) continue;
    const l1 = ((bz - cz) * (x - cx) + (cx - bx) * (z - cz)) / d;
    const l2 = ((cz - az) * (x - cx) + (ax - cx) * (z - cz)) / d;
    const l3 = 1 - l1 - l2;
    if (l1 < 0 || l2 < 0 || l3 < 0) continue;
    ys.push(l1 * ay + l2 * by + l3 * cy);
  }
  ys.sort((a, b) => a - b);
  // Deux triangles voisins croisés sur leur arête commune : un seul croisement.
  return ys.filter((y, i) => i === 0 || y - /** @type {number} */ (ys[i - 1]) > 1e-6);
}

/**
 * Le moteur posé tient-il dans la coque ? Pour chaque sommet (un sur `step`), la verticale qui le
 * traverse : un nombre impair de croisements au-dessus de lui, il est dedans (jour au-dessus et
 * au-dessous) ; des croisements au-dessus seulement, il pend sous le plancher (permis : le moteur d'une
 * propulsion arrière se voit dessous ; sa garde au sol est relevée) ; sinon il traverse la caisse
 * (débord : écart vertical à la tôle la plus proche). `offset` : écart du repère posé (poseOffset).
 * @param {Float64Array} shell triangles de la coque (repère du modèle)
 * @param {Float64Array} engine triangles du moteur (repère du fichier)
 * @param {EnginePose} pose repère du véhicule posé @param {P3} [offset] @param {number} [step]
 */
export function checkEngineFit(shell, engine, pose, offset = [0, 0, 0], step = 7) {
  const cells = grid(shell);
  let tested = 0;
  let outside = 0;
  let under = 0;
  let worst = 0;
  let above = Infinity;
  let ground = Infinity;
  /** @type {P3 | null} */
  let where = null;
  /** @type {P3} */
  const min = [Infinity, Infinity, Infinity];
  /** @type {P3} */
  const max = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < engine.length / 3; v += step) {
    const posed = poseEnginePoint(pose, /** @type {number} */ (engine[v * 3]), /** @type {number} */ (engine[v * 3 + 1]), /** @type {number} */ (engine[v * 3 + 2]));
    /** @type {P3} */
    const p = [posed[0] + offset[0], posed[1] + offset[1], posed[2] + offset[2]];
    for (const k of /** @type {const} */ ([0, 1, 2])) {
      min[k] = Math.min(/** @type {number} */ (min[k]), posed[k]);
      max[k] = Math.max(/** @type {number} */ (max[k]), posed[k]);
    }
    tested += 1;
    ground = Math.min(ground, posed[1]);
    // Trois verticales à un pas de côté infime (jamais pile sur une arête : axe z = 0, joints, bord
    // d'une plaque) ; la parité retenue est celle de la majorité.
    const rays = JITTER.map(([dx, dz]) => crossings(shell, cells, p[0] + dx, p[2] + dz));
    const inside = rays.filter((list) => list.filter((y) => y > p[1]).length % 2 === 1).length >= 2;
    const ys = /** @type {number[]} */ (rays.find((list) => list.filter((y) => y > p[1]).length % 2 === (inside ? 1 : 0)));
    const up = ys.filter((y) => y > p[1]);
    const down = ys.filter((y) => y <= p[1]);
    if (inside) {
      above = Math.min(above, /** @type {number} */ (up[0]) - p[1]);
      continue;
    }
    if (up.length > 0 && down.length === 0) {
      under += 1;
      continue;
    }
    outside += 1;
    const gap = Math.min(up.length > 0 ? /** @type {number} */ (up[0]) - p[1] : Infinity, down.length > 0 ? p[1] - /** @type {number} */ (down[down.length - 1]) : Infinity);
    const depth = Number.isFinite(gap) ? gap : 1;
    if (depth > worst) {
      worst = depth;
      where = posed;
    }
  }
  return { tested, outside, under, worst, where, above, ground, min, max };
}

// ---------------------------------------------------------------------------------------------
// Coût au pire cas (§ 8) et repère du véhicule posé

/**
 * Triangles et primitives de chaque nœud à maillage d'un GLB.
 * @param {Uint8Array} bytes
 * @returns {Map<string, { triangles: number, primitives: number }>}
 */
export function nodeCosts(bytes) {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  const { json } = parsed.container;
  /** @type {Map<string, { triangles: number, primitives: number }>} */
  const out = new Map();
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const prims = json.meshes[node.mesh].primitives;
    out.set(node.name, { triangles: prims.reduce((/** @type {number} */ sum, /** @type {any} */ p) => sum + json.accessors[p.indices].count / 3, 0), primitives: prims.length });
  }
  return out;
}

/**
 * Le moteur tel que l'app le pose dans le véhicule (src/scene/vehicle/moteur.ts) : ses pièces, sans le
 * support, fusionnées en un seul maillage (un appel de dessin, les traitements portés par les sommets).
 * @param {Uint8Array} bytes fichier du moteur
 */
export function engineInVehicle(bytes) {
  let triangles = 0;
  for (const [name, cost] of nodeCosts(bytes)) if (name.startsWith('part_')) triangles += cost.triangles;
  return { triangles, drawCalls: 1 };
}

/**
 * Coût du capot (manifeste, pieces.capot) au pire cas, en écart sur la caisse comptée entière : la
 * variante (capot vitré) et le compartiment ne se montrent qu'à leur tour, le moteur avec eux. États :
 * fermé (ni variante, ni compartiment, ni moteur), ouvert (compartiment et moteur), vitré (la variante
 * à la place du capot, compartiment et moteur), déposé (compartiment et moteur seuls).
 * @param {{ pieces?: Record<string, any> }} manifest @param {Uint8Array} bytes caisse
 * @param {{ triangles: number, drawCalls: number } | null} engine moteur posé ; `null` : pas de modèle
 * @returns {{ triangles: number, drawCalls: number, state: string } | null}
 */
export function capotWorst(manifest, bytes, engine) {
  const mount = manifest.pieces?.capot;
  if (!mount) return null;
  const costs = nodeCosts(bytes);
  const of = (/** @type {string | undefined} */ name) => (name ? (costs.get(name) ?? { triangles: 0, primitives: 0 }) : { triangles: 0, primitives: 0 });
  const lid = of(mount.lid);
  const glazed = of(mount.glazed);
  const bay = of(mount.bay);
  const motor = engine ?? { triangles: 0, drawCalls: 0 };
  const states = [
    { state: 'fermé', triangles: -glazed.triangles - bay.triangles, drawCalls: -glazed.primitives - bay.primitives },
    { state: 'ouvert', triangles: -glazed.triangles + motor.triangles, drawCalls: -glazed.primitives + motor.drawCalls },
    { state: 'vitré', triangles: -lid.triangles + motor.triangles, drawCalls: -lid.primitives + motor.drawCalls },
    { state: 'déposé', triangles: -lid.triangles - glazed.triangles + motor.triangles, drawCalls: -lid.primitives - glazed.primitives + motor.drawCalls },
  ];
  return states.reduce((worst, item) => (item.drawCalls > worst.drawCalls || (item.drawCalls === worst.drawCalls && item.triangles > worst.triangles) ? item : worst));
}

/**
 * Écart entre le repère du modèle et celui du véhicule posé (src/scene/vehicle/VehicleModel.tsx,
 * prepare : centré en X et en Z, posé au sol) : la boîte des maillages, élargie de chaque roue
 * d'ancre (son rayon : la hauteur de son centre). Repère posé = repère du modèle − écart.
 * @param {Uint8Array} bytes
 * @returns {P3}
 */
export function poseOffset(bytes) {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  const { json } = parsed.container;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const grow = (/** @type {number[]} */ p) => {
    for (const k of [0, 1, 2]) {
      min[k] = Math.min(/** @type {number} */ (min[k]), /** @type {number} */ (p[k]));
      max[k] = Math.max(/** @type {number} */ (max[k]), /** @type {number} */ (p[k]));
    }
  };
  for (const node of json.nodes ?? []) {
    const t = node.translation ?? [0, 0, 0];
    if (node.mesh === undefined) {
      if (/^(roue|wheel)_/i.test(node.name ?? '')) {
        const r = Math.max(0.05, t[1]);
        grow([t[0] + r, t[1] + r, t[2] + r]);
        grow([t[0] - r, t[1] - r, t[2] - r]);
      }
      continue;
    }
    const q = node.rotation ?? [0, 0, 0, 1];
    for (const prim of json.meshes[node.mesh].primitives) {
      const acc = json.accessors[prim.attributes.POSITION];
      for (let c = 0; c < 8; c += 1) {
        const p = rotate([c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]], q);
        grow([p[0] + t[0], p[1] + t[1], p[2] + t[2]]);
      }
    }
  }
  return [(/** @type {number} */ (min[0]) + /** @type {number} */ (max[0])) / 2, /** @type {number} */ (min[1]), (/** @type {number} */ (min[2]) + /** @type {number} */ (max[2])) / 2];
}
