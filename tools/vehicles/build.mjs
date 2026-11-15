// @ts-check
// Générateur des véhicules substituts : lit assets-src/vehicles/<id>/model.mjs, écrit
// public/assets/vehicles/<id>/body.glb et affiche, par véhicule : triangles, matériaux, nœuds,
// boîte englobante, poids. Node seul, déterministe. Mode d'emploi : assets-src/vehicles/LISEZ-MOI.md.
//
//   node tools/vehicles/build.mjs [id…]      (sans id : tous les dossiers qui ont un model.mjs)
//   npm run vehicles:build [-- id…]

import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countGeometry, parseGlb } from '../lib/glb.mjs';
import * as kit from './kit.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets-src', 'vehicles');
const OUT = join(ROOT, 'public', 'assets', 'vehicles');

/**
 * Construit un véhicule et rend ses octets et son résumé.
 * @param {string} id
 * @param {{ srcDir?: string }} [o]
 */
export async function buildVehicle(id, o = {}) {
  const file = join(o.srcDir ?? SRC, id, 'model.mjs');
  if (!existsSync(file)) throw new Error(`${relative(ROOT, file)} introuvable`);
  const mod = await import(pathToFileURL(file).href);
  if (typeof mod.default !== 'function') throw new Error(`${relative(ROOT, file)} : « export default function (kit) » attendu`);
  const model = await mod.default(kit);
  if (!(model instanceof kit.Model)) throw new Error(`${relative(ROOT, file)} : la fonction doit rendre un kit.Model`);
  if (model.id !== id) throw new Error(`${relative(ROOT, file)} : Model('${model.id}') au lieu de Model('${id}')`);
  const { bytes } = model.toGlb();
  return { bytes, summary: summarize(bytes) };
}

/**
 * Résumé chiffré d'un GLB : triangles, primitives, matériaux, nœuds, boîte englobante, poids.
 * @param {Uint8Array} bytes
 */
export function summarize(bytes) {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) throw new Error(`GLB illisible : ${parsed.message}`);
  const { json } = parsed.container;
  // Triangles et appels de dessin réellement posés : un maillage partagé (roue) compte à chaque
  // nœud qui le pose ; countGeometry, lui, compte chaque maillage une fois.
  let triangles = 0;
  let drawCalls = 0;
  const meshTriangles = countGeometry(json).triangles;
  /** @type {[number, number, number]} */
  const min = [Infinity, Infinity, Infinity];
  /** @type {[number, number, number]} */
  const max = [-Infinity, -Infinity, -Infinity];
  const nodes = /** @type {any[]} */ (json.nodes ?? []);
  for (const node of nodes) {
    if (node.mesh === undefined) continue;
    const t = node.translation ?? [0, 0, 0];
    const q = node.rotation ?? [0, 0, 0, 1];
    for (const prim of json.meshes[node.mesh].primitives) {
      drawCalls += 1;
      triangles += json.accessors[prim.indices].count / 3;
      const acc = json.accessors[prim.attributes.POSITION];
      // Coins de la boîte du maillage, tournés et déplacés comme le nœud (racine sans transformation).
      for (let c = 0; c < 8; c += 1) {
        /** @type {[number, number, number]} */
        const p = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]];
        const r = rotate(p, q);
        for (const k of /** @type {const} */ ([0, 1, 2])) {
          const v = r[k] + t[k];
          if (v < min[k]) min[k] = v;
          if (v > max[k]) max[k] = v;
        }
      }
    }
  }
  return {
    triangles,
    meshTriangles,
    primitives: drawCalls,
    materials: /** @type {string[]} */ ((json.materials ?? []).map((/** @type {any} */ m) => m.name)),
    nodes: nodes.map((n) => /** @type {string} */ (n.name)),
    min: /** @type {[number, number, number]} */ (min.map((v) => Math.round(v * 1000) / 1000)),
    max: /** @type {[number, number, number]} */ (max.map((v) => Math.round(v * 1000) / 1000)),
    bytes: bytes.byteLength,
  };
}

/** @param {[number, number, number]} p @param {[number, number, number, number]} q quaternion x, y, z, w */
function rotate(p, q) {
  const [x, y, z] = p;
  const [qx, qy, qz, qw] = q;
  const ix = qw * x + qy * z - qz * y;
  const iy = qw * y + qz * x - qx * z;
  const iz = qw * z + qx * y - qy * x;
  const iw = -qx * x - qy * y - qz * z;
  return [ix * qw + iw * -qx + iy * -qz - iz * -qy, iy * qw + iw * -qy + iz * -qx - ix * -qz, iz * qw + iw * -qz + ix * -qy - iy * -qx];
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = args.length > 0 ? args : existsSync(SRC) ? readdirSync(SRC).filter((d) => existsSync(join(SRC, d, 'model.mjs'))).sort() : [];
  if (ids.length === 0) {
    console.log('vehicles:build : aucun assets-src/vehicles/<id>/model.mjs');
    return;
  }
  let failed = 0;
  for (const id of ids) {
    const started = Date.now();
    try {
      const { bytes, summary: s } = await buildVehicle(id);
      const out = join(OUT, id, 'body.glb');
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, bytes);
      const size = /** @type {const} */ ([0, 1, 2]).map((k) => (s.max[k] - s.min[k]).toFixed(2)).join(' × ');
      console.log(
        `${id} : ${s.triangles.toLocaleString('fr-FR')} triangles · ${s.primitives} appels de dessin · ${s.materials.length} matériaux · ${s.nodes.length} nœuds · ` +
          `boîte ${size} m (x ${s.min[0]} à ${s.max[0]}, y ${s.min[1]} à ${s.max[1]}, z ${s.min[2]} à ${s.max[2]}) · ${(s.bytes / 1024).toFixed(0)} Kio · ${((Date.now() - started) / 1000).toFixed(1)} s`,
      );
      console.log(`  matériaux : ${s.materials.join(', ')}`);
      console.log(`  → ${relative(ROOT, out)}`);
    } catch (error) {
      failed += 1;
      console.error(`${id} : ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
