// @ts-check
// Maillages des tronçons de décor : un assembleur par rôle de matériau (fusion_<rôle>), normales
// lissées par accumulation (les sommets non partagés donnent des faces plates), écriture GLB par
// l'écrivain des véhicules (tools/vehicles/glb-writer.mjs). Déterministe.

import { writeGlb } from '../vehicles/glb-writer.mjs';

/** Rôles des matériaux (src/data/mapTypes.ts, MapMaterialRole) et teintes plates de l'aperçu. */
export const ROLES = /** @type {const} */ ({
  chaussee: { color: '#2c2e33', metallic: 0, roughness: 0.85 },
  marquage: { color: '#e6e3d8', metallic: 0, roughness: 0.6 },
  accotement: { color: '#55524a', metallic: 0, roughness: 0.95 },
  terrain: { color: '#3c4a2e', metallic: 0, roughness: 1 },
  eau: { color: '#1d3a4f', metallic: 0, roughness: 0.15 },
  mur: { color: '#8c857a', metallic: 0, roughness: 0.9 },
  toit: { color: '#5c4035', metallic: 0, roughness: 0.85 },
  fenetre: { color: '#d8c17a', metallic: 0, roughness: 0.4 },
  ouvrage: { color: '#7e7b75', metallic: 0, roughness: 0.9 },
  glissiere: { color: '#b9bdc2', metallic: 0.7, roughness: 0.4 },
  voie: { color: '#36383d', metallic: 0, roughness: 0.9 },
});

/** @typedef {keyof typeof ROLES} Role */

export class Assembleur {
  constructor() {
    /** @type {number[]} */
    this.pos = [];
    /** @type {number[]} */
    this.idx = [];
  }
  /** @param {number} x @param {number} y @param {number} z */
  sommet(x, y, z) {
    this.pos.push(x, y, z);
    return this.pos.length / 3 - 1;
  }
  /** @param {number} a @param {number} b @param {number} c */
  tri(a, b, c) {
    this.idx.push(a, b, c);
  }
  /** Quadrilatère a b c d (sens trigonométrique vu de la face visible). @param {number} a @param {number} b @param {number} c @param {number} d */
  quad(a, b, c, d) {
    this.idx.push(a, b, c, a, c, d);
  }
  get triangles() {
    return this.idx.length / 3;
  }
  normales() {
    const n = new Float64Array(this.pos.length);
    const p = this.pos;
    for (let t = 0; t < this.idx.length; t += 3) {
      const a = /** @type {number} */ (this.idx[t]) * 3;
      const b = /** @type {number} */ (this.idx[t + 1]) * 3;
      const c = /** @type {number} */ (this.idx[t + 2]) * 3;
      const ux = (p[b] ?? 0) - (p[a] ?? 0);
      const uy = (p[b + 1] ?? 0) - (p[a + 1] ?? 0);
      const uz = (p[b + 2] ?? 0) - (p[a + 2] ?? 0);
      const vx = (p[c] ?? 0) - (p[a] ?? 0);
      const vy = (p[c + 1] ?? 0) - (p[a + 1] ?? 0);
      const vz = (p[c + 2] ?? 0) - (p[a + 2] ?? 0);
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      for (const k of [a, b, c]) {
        n[k] = (n[k] ?? 0) + nx;
        n[k + 1] = (n[k + 1] ?? 0) + ny;
        n[k + 2] = (n[k + 2] ?? 0) + nz;
      }
    }
    const out = new Float32Array(n.length);
    for (let i = 0; i < n.length; i += 3) {
      const L = Math.hypot(n[i] ?? 0, n[i + 1] ?? 0, n[i + 2] ?? 0);
      if (L > 0) {
        out[i] = (n[i] ?? 0) / L;
        out[i + 1] = (n[i + 1] ?? 0) / L;
        out[i + 2] = (n[i + 2] ?? 0) / L;
      } else out[i + 1] = 1;
    }
    return out;
  }
}

/**
 * Écrit un GLB à partir d'assembleurs par rôle (les vides sont omis), sommets relatifs à `origine`.
 * @param {string} nom nœud racine
 * @param {Map<Role, Assembleur>} parRole
 * @param {[number, number, number]} origine
 */
export function ecrireGlb(nom, parRole, origine) {
  /** @type {any[]} */
  const meshes = [];
  /** @type {any[]} */
  const materials = [];
  /** @type {any[]} */
  const nodes = [{ name: nom, children: [] }];
  let triangles = 0;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const role of /** @type {Role[]} */ (Object.keys(ROLES))) {
    const a = parRole.get(role);
    if (!a || a.triangles === 0) continue;
    const positions = new Float32Array(a.pos.length);
    for (let i = 0; i < a.pos.length; i += 3)
      for (let k = 0; k < 3; k += 1) {
        const v = /** @type {number} */ (a.pos[i + k]);
        positions[i + k] = v - /** @type {number} */ (origine[k]);
        if (v < /** @type {number} */ (min[k])) min[k] = v;
        if (v > /** @type {number} */ (max[k])) max[k] = v;
      }
    materials.push({ name: role, ...ROLES[role] });
    meshes.push({ name: `fusion_${role}`, primitives: [{ material: materials.length - 1, positions, normals: a.normales(), indices: Uint32Array.from(a.idx) }] });
    nodes.push({ name: `fusion_${role}`, mesh: meshes.length - 1 });
    nodes[0].children.push(nodes.length - 1);
    triangles += a.triangles;
  }
  const bytes = writeGlb({ nodes, meshes, materials, generator: 'tools/maps/build.mjs' });
  return { bytes, triangles, min, max };
}
