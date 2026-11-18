// @ts-check
// Générateur des véhicules substituts : lit assets-src/vehicles/<id>/model.mjs, écrit
// public/assets/vehicles/<id>/body.glb et affiche, par véhicule : triangles, matériaux, nœuds,
// boîte englobante, poids. Fabrique aussi les roues partagées (jantes et pneus du catalogue
// public/assets/shared/wheels/catalogue.json, modelés par tools/vehicles/roues.mjs) et compte le
// véhicule complet, roues posées comprises, contre les budgets du § 8. Fabrique de même les pièces
// d'habitacle partagées (volants, pommeaux, sièges du catalogue public/assets/shared/habitacle/,
// modelés par tools/vehicles/habitacle.mjs), les compte au pire cas avec le véhicule, et vérifie
// qu'aucune, posée sur son ancre, ne traverse le plancher ni le tableau de bord (manifeste,
// interior.clearance). Fabrique enfin le conducteur à bord, une tenue par genre de véhicule
// (catalogue public/assets/shared/conducteur/, modelé par tools/vehicles/conducteur.mjs), tenu à son
// budget (12 000 triangles, 4 appels de dessin) et compté avec le véhicule. Fabrique aussi les pièces
// montées sur la caisse (ailerons… : catalogue public/assets/shared/pieces/, modelées par
// tools/vehicles/pieces.mjs), comptées au pire cas avec le véhicule qui les accepte. Node seul, déterministe.
// Mode d'emploi : assets-src/vehicles/LISEZ-MOI.md.
//
//   node tools/vehicles/build.mjs [id…]      (sans id : tous les dossiers qui ont un model.mjs)
//   npm run vehicles:build [-- id…]

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { countGeometry, parseGlb } from '../lib/glb.mjs';
import * as kit from './kit.mjs';
import { buildRim, buildTire, readCatalogue, rimFile, tireFile } from './roues.mjs';
import * as habitacle from './habitacle.mjs';
import * as conducteur from './conducteur.mjs';
import * as montees from './pieces.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = join(ROOT, 'assets-src', 'vehicles');
const OUT = join(ROOT, 'public', 'assets', 'vehicles');
const WHEELS_OUT = join(ROOT, 'public', 'assets', 'shared', 'wheels');
const INTERIOR_OUT = join(ROOT, 'public', 'assets', 'shared', 'habitacle');
const DRIVER_OUT = join(ROOT, 'public', 'assets', 'shared', 'conducteur');
const PIECES_OUT = join(ROOT, 'public', 'assets', 'shared', 'pieces');
/** Budgets d'un véhicule complet à l'écran (§ 8) : maximum, roues posées comprises. */
export const VEHICLE_MAX = Object.freeze({ triangles: 400_000, drawCalls: 80 });

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

/**
 * Fabrique les roues partagées : une jante par dessin, un pneu par type et par genre.
 * @returns {Map<string, ReturnType<typeof summarize>>} résumé par nom de fichier
 */
export function buildWheels() {
  const catalogue = readCatalogue();
  /** @type {Map<string, ReturnType<typeof summarize>>} */
  const out = new Map();
  mkdirSync(WHEELS_OUT, { recursive: true });
  /** @param {string} file @param {string} node @param {import('./kit.mjs').Parts} parts */
  const write = (file, node, parts) => {
    const m = new kit.Model(file.replace(/\.glb$/, ''));
    m.add(node, parts);
    const { bytes } = m.toGlb();
    writeFileSync(join(WHEELS_OUT, file), bytes);
    out.set(file, summarize(bytes));
  };
  for (const rim of catalogue.rims) write(rimFile(rim.id), 'jante', buildRim(rim, catalogue));
  for (const tire of catalogue.tires) for (const kind of /** @type {const} */ (['car', 'bike'])) write(tireFile(tire.id, kind), 'pneu', buildTire(tire, kind, catalogue));
  return out;
}

/**
 * Pièces d'habitacle partagées : un fichier par volant, par pommeau, par siège. Rend, par fichier,
 * son résumé et ses pièces (pour les contrôles de pose).
 * @returns {Map<string, { summary: ReturnType<typeof summarize>, parts: import('./kit.mjs').Parts, kind: 'steering' | 'knob' | 'seat' }>}
 */
export function buildInterior() {
  const catalogue = habitacle.readCatalogue();
  /** @type {Map<string, { summary: ReturnType<typeof summarize>, parts: import('./kit.mjs').Parts, kind: 'steering' | 'knob' | 'seat' }>} */
  const out = new Map();
  mkdirSync(INTERIOR_OUT, { recursive: true });
  /** @param {string} file @param {string} node @param {import('./kit.mjs').Parts} parts @param {'steering' | 'knob' | 'seat'} kind */
  const write = (file, node, parts, kind) => {
    const m = new kit.Model(file.replace(/\.glb$/, ''));
    m.add(node, parts);
    const { bytes } = m.toGlb();
    writeFileSync(join(INTERIOR_OUT, file), bytes);
    out.set(file, { summary: summarize(bytes), parts, kind });
  };
  for (const e of catalogue.steering) write(habitacle.steeringFile(e.id), 'volant', habitacle.buildSteering(e), 'steering');
  for (const e of catalogue.knobs) write(habitacle.knobFile(e.id), 'pommeau', habitacle.buildKnob(e), 'knob');
  for (const e of catalogue.seats) write(habitacle.seatFile(e.id), 'siege', habitacle.buildSeat(e), 'seat');
  return out;
}

/**
 * Le conducteur à bord : un fichier par tenue. Rend, par tenue, son genre de véhicule, son résumé et
 * son budget (triangles, appels de dessin = passes de rendu occupées).
 * @returns {Map<string, { kind: 'car' | 'bike', summary: ReturnType<typeof summarize>, budget: ReturnType<typeof conducteur.driverBudget> }>}
 */
export function buildDrivers() {
  const catalogue = conducteur.readCatalogue();
  /** @type {Map<string, { kind: 'car' | 'bike', summary: ReturnType<typeof summarize>, budget: ReturnType<typeof conducteur.driverBudget> }>} */
  const out = new Map();
  mkdirSync(DRIVER_OUT, { recursive: true });
  for (const outfit of catalogue.outfits) {
    const built = conducteur.buildDriver(outfit, catalogue).toGlb();
    const file = conducteur.driverFile(outfit.id);
    writeFileSync(join(DRIVER_OUT, file), built.bytes);
    const summary = summarize(built.bytes);
    out.set(outfit.id, { kind: outfit.kind, summary, budget: conducteur.driverBudget(built, summary.triangles, catalogue) });
  }
  return out;
}

/**
 * Pièces montées sur la caisse : un fichier par option de chaque poste (deux nœuds au plus,
 * « surface » et « niveau »). Rend, par fichier, son résumé.
 * @returns {Map<string, ReturnType<typeof summarize>>}
 */
export function buildPieces() {
  const catalogue = montees.readCatalogue();
  /** @type {Map<string, ReturnType<typeof summarize>>} */
  const out = new Map();
  mkdirSync(PIECES_OUT, { recursive: true });
  for (const poste of catalogue.postes) {
    for (const option of poste.options) {
      const file = montees.pieceFile(poste.id, option.id);
      const built = montees.buildPiece(option);
      const m = new kit.Model(file.replace(/\.glb$/, ''));
      m.add(built.node, built.parts);
      const { bytes } = m.toGlb();
      writeFileSync(join(PIECES_OUT, file), bytes);
      out.set(file, summarize(bytes));
    }
  }
  return out;
}

/**
 * Pose de chaque ancre d'habitacle d'un GLB de véhicule : translation et rotation (quaternion).
 * @param {Uint8Array} bytes
 * @returns {Map<string, { t: number[], q: [number, number, number, number] }>}
 */
export function interiorAnchors(bytes) {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) throw new Error(`GLB illisible : ${parsed.message}`);
  const catalogue = habitacle.readCatalogue();
  const names = [catalogue.anchors.steering, catalogue.anchors.knob, ...catalogue.anchors.seats];
  /** @type {Map<string, { t: number[], q: [number, number, number, number] }>} */
  const found = new Map();
  for (const node of /** @type {any[]} */ (parsed.container.json.nodes ?? [])) {
    if (names.includes(node.name)) found.set(node.name, { t: node.translation ?? [0, 0, 0], q: node.rotation ?? [0, 0, 0, 1] });
  }
  return found;
}

/**
 * Pièces d'habitacle posées sur les ancres d'un véhicule : rien sous le plancher, rien au-delà de la
 * face du tableau de bord sous son dessus (manifeste, interior.clearance). Rend les problèmes trouvés.
 * @param {{ interior?: { clearance?: { floor: number, dash: readonly number[] }, seats?: { scale?: number } } }} manifest
 * @param {Map<string, { t: number[], q: [number, number, number, number] }>} anchors
 * @param {ReturnType<typeof buildInterior>} pieces
 */
export function interiorClearance(manifest, anchors, pieces) {
  const clearance = manifest.interior?.clearance;
  if (!clearance) return [];
  const catalogue = habitacle.readCatalogue();
  const [dashX = Infinity, dashTop = -Infinity] = clearance.dash;
  /** @type {string[]} */
  const problems = [];
  /** @type {Record<'steering' | 'knob' | 'seat', string[]>} */
  const where = { steering: [catalogue.anchors.steering], knob: [catalogue.anchors.knob], seat: catalogue.anchors.seats };
  for (const [file, piece] of pieces) {
    const scale = piece.kind === 'seat' ? (manifest.interior?.seats?.scale ?? 1) : 1;
    for (const name of where[piece.kind]) {
      const anchor = anchors.get(name);
      if (!anchor) continue;
      let low = Infinity;
      let front = -Infinity;
      for (const part of piece.parts) {
        const pos = part.geometry.getAttribute('position');
        for (let i = 0; i < pos.count; i += 1) {
          const r = /** @type {[number, number, number]} */ (rotate([pos.getX(i) * scale, pos.getY(i) * scale, pos.getZ(i) * scale], anchor.q));
          const wy = r[1] + /** @type {number} */ (anchor.t[1]);
          const wx = r[0] + /** @type {number} */ (anchor.t[0]);
          low = Math.min(low, wy);
          if (wy < dashTop) front = Math.max(front, wx);
        }
      }
      if (low < clearance.floor - 0.002) problems.push(`${file} sur ${name} : ${((clearance.floor - low) * 100).toFixed(1)} cm sous le plancher`);
      if (front > dashX + 0.002) problems.push(`${file} sur ${name} : ${((front - dashX) * 100).toFixed(1)} cm dans le tableau de bord`);
    }
  }
  return problems;
}

/**
 * Habitacle au pire cas : le volant, le pommeau et le siège les plus lourds, sur leurs ancres.
 * @param {ReturnType<typeof summarize>} body @param {ReturnType<typeof buildInterior>} pieces
 */
export function interiorWorst(body, pieces) {
  const catalogue = habitacle.readCatalogue();
  const count = { steering: 0, knob: 0, seat: 0 };
  if (body.nodes.includes(catalogue.anchors.steering)) count.steering = 1;
  if (body.nodes.includes(catalogue.anchors.knob)) count.knob = 1;
  count.seat = catalogue.anchors.seats.filter((n) => body.nodes.includes(n)).length;
  let triangles = 0;
  let drawCalls = 0;
  for (const kind of /** @type {const} */ (['steering', 'knob', 'seat'])) {
    const list = [...pieces.values()].filter((p) => p.kind === kind).map((p) => p.summary);
    triangles += count[kind] * Math.max(0, ...list.map((s) => s.triangles));
    drawCalls += count[kind] * Math.max(0, ...list.map((s) => s.primitives));
  }
  return { anchors: count.steering + count.knob + count.seat, triangles, drawCalls };
}

/**
 * Véhicule complet, pire cas : la caisse et, sur chaque ancre roue_*, la jante et le pneu les plus
 * lourds de son genre.
 * @param {string} id @param {ReturnType<typeof summarize>} body @param {Map<string, ReturnType<typeof summarize>>} wheels
 */
export function withWheels(id, body, wheels) {
  const manifest = JSON.parse(readFileSync(join(OUT, id, 'vehicle.json'), 'utf8'));
  const fit = manifest.wheels?.fit;
  if (!fit) return null;
  const catalogue = readCatalogue();
  const kind = manifest.kind === 'bike' ? 'bike' : 'car';
  const rims = catalogue.rims.filter((r) => r.kind === kind && (!fit.rims || fit.rims.includes(r.id))).map((r) => wheels.get(rimFile(r.id)));
  const tires = catalogue.tires.map((t) => wheels.get(tireFile(t.id, kind)));
  const worst = (/** @type {(ReturnType<typeof summarize> | undefined)[]} */ list, /** @type {'triangles' | 'primitives'} */ key) => Math.max(0, ...list.map((s) => s?.[key] ?? 0));
  const anchors = body.nodes.filter((n) => /^roue_/.test(n)).length;
  return {
    anchors,
    triangles: body.triangles + anchors * (worst(rims, 'triangles') + worst(tires, 'triangles')),
    drawCalls: body.primitives + anchors * (worst(rims, 'primitives') + worst(tires, 'primitives')),
  };
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const ids = args.length > 0 ? args : existsSync(SRC) ? readdirSync(SRC).filter((d) => existsSync(join(SRC, d, 'model.mjs'))).sort() : [];
  if (ids.length === 0) {
    console.log('vehicles:build : aucun assets-src/vehicles/<id>/model.mjs');
    return;
  }
  let failed = 0;
  /** @type {Map<string, ReturnType<typeof summarize>>} */
  let wheels = new Map();
  try {
    const started = Date.now();
    wheels = buildWheels();
    const list = [...wheels].map(([file, s]) => `${file.replace(/\.glb$/, '')} ${s.triangles.toLocaleString('fr-FR')} tr. ${s.primitives} app.`);
    console.log(`roues partagées : ${wheels.size} fichiers en ${((Date.now() - started) / 1000).toFixed(1)} s → ${relative(ROOT, WHEELS_OUT)}`);
    console.log(`  ${list.join(' · ')}`);
  } catch (error) {
    failed += 1;
    console.error(`roues partagées : ${error instanceof Error ? error.message : error}`);
  }
  /** @type {ReturnType<typeof buildInterior>} */
  let interior = new Map();
  try {
    const started = Date.now();
    interior = buildInterior();
    const list = [...interior].map(([file, p]) => `${file.replace(/\.glb$/, '')} ${p.summary.triangles.toLocaleString('fr-FR')} tr. ${p.summary.primitives} app.`);
    console.log(`habitacle partagé : ${interior.size} fichiers en ${((Date.now() - started) / 1000).toFixed(1)} s → ${relative(ROOT, INTERIOR_OUT)}`);
    console.log(`  ${list.join(' · ')}`);
  } catch (error) {
    failed += 1;
    console.error(`habitacle partagé : ${error instanceof Error ? error.message : error}`);
  }
  /** @type {ReturnType<typeof buildDrivers>} */
  let drivers = new Map();
  try {
    const started = Date.now();
    drivers = buildDrivers();
    const { budget } = conducteur.readCatalogue();
    for (const [id, d] of drivers) {
      const over = d.budget.triangles > budget.triangles || d.budget.drawCalls > budget.drawCalls;
      const line = `conducteur ${id} : ${d.budget.triangles.toLocaleString('fr-FR')} triangles · ${d.budget.drawCalls} appels de dessin (${d.budget.passes.join(', ')}) · ${(d.summary.bytes / 1024).toFixed(0)} Kio (maximum : ${budget.triangles.toLocaleString('fr-FR')} et ${budget.drawCalls})`;
      if (over) {
        failed += 1;
        console.error(`${line} : HORS BUDGET`);
      } else console.log(line);
    }
    console.log(`  ${drivers.size} tenues en ${((Date.now() - started) / 1000).toFixed(1)} s → ${relative(ROOT, DRIVER_OUT)}`);
  } catch (error) {
    failed += 1;
    console.error(`conducteur : ${error instanceof Error ? error.message : error}`);
  }
  /** @type {ReturnType<typeof buildPieces>} */
  let mounted = new Map();
  try {
    const started = Date.now();
    mounted = buildPieces();
    const list = [...mounted].map(([file, s]) => `${file.replace(/\.glb$/, '')} ${s.triangles.toLocaleString('fr-FR')} tr. ${s.primitives} app.`);
    console.log(`pièces montées : ${mounted.size} fichiers en ${((Date.now() - started) / 1000).toFixed(1)} s → ${relative(ROOT, PIECES_OUT)}`);
    console.log(`  ${list.join(' · ')}`);
  } catch (error) {
    failed += 1;
    console.error(`pièces montées : ${error instanceof Error ? error.message : error}`);
  }
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
      const full = withWheels(id, s, wheels);
      const inside = interiorWorst(s, interior);
      if (full) {
        full.triangles += inside.triangles;
        full.drawCalls += inside.drawCalls;
        // Le conducteur à bord, dans la tenue de son genre de véhicule.
        const kindOf = JSON.parse(readFileSync(join(OUT, id, 'vehicle.json'), 'utf8')).kind === 'bike' ? 'bike' : 'car';
        const driver = [...drivers.values()].find((d) => d.kind === kindOf);
        if (driver) {
          full.triangles += driver.budget.triangles;
          full.drawCalls += driver.budget.drawCalls;
        }
        // La pièce montée la plus lourde de chaque poste que le véhicule accepte (aileron…).
        const posed = montees.piecesWorst(JSON.parse(readFileSync(join(OUT, id, 'vehicle.json'), 'utf8')), mounted);
        full.triangles += posed.triangles;
        full.drawCalls += posed.drawCalls;
        const over = full.triangles > VEHICLE_MAX.triangles || full.drawCalls > VEHICLE_MAX.drawCalls;
        const extra = (inside.anchors > 0 ? ` et habitacle le plus lourd sur ${inside.anchors} ancres` : '') + (driver ? ', conducteur à bord' : '') + (posed.postes > 0 ? `, pièce montée la plus lourde (${posed.triangles.toLocaleString('fr-FR')} tr.)` : '');
        const line = `  complet, roues les plus lourdes sur ${full.anchors} ancres${extra} : ${full.triangles.toLocaleString('fr-FR')} triangles · ${full.drawCalls} appels de dessin (maximum § 8 : ${VEHICLE_MAX.triangles.toLocaleString('fr-FR')} et ${VEHICLE_MAX.drawCalls})`;
        if (over) {
          failed += 1;
          console.error(`${line} : HORS BUDGET`);
        } else console.log(line);
      }
      const manifest = JSON.parse(readFileSync(join(OUT, id, 'vehicle.json'), 'utf8'));
      const problems = interiorClearance(manifest, interiorAnchors(bytes), interior);
      if (problems.length > 0) {
        failed += 1;
        console.error(`  habitacle : ${problems.join(' ; ')}`);
      }
      console.log(`  → ${relative(ROOT, out)}`);
    } catch (error) {
      failed += 1;
      console.error(`${id} : ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) await main();
