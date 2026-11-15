// @ts-check
// Budgets des modèles 3D (§ 8 du cahier des charges) : triangles, appels de dessin (une primitive
// vaut un appel) et textures de chaque GLB de public/assets/. Les véhicules sont contrôlés pour de
// bon ; un substitut déclaré (manifeste avec « placeholder », ou ancien dossier du banc d'essai)
// ne reçoit que des avertissements.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { measureGlb, parseGlb } from './glb.mjs';
import { countLabel, finding } from './report.mjs';

/** @typedef {import('./report.mjs').Report} Report */
/** @typedef {import('./fs-walk.mjs').TreeFile} TreeFile */
/** @typedef {import('./glb.mjs').GlbStats} GlbStats */

/**
 * Budgets d'un véhicule à l'écran (maximum du § 8) et format de texture attendu.
 * @typedef {object} ModelLimits
 * @property {number} triangles       triangles d'un fichier
 * @property {number} primitives      primitives d'un fichier : une primitive, un appel de dessin
 * @property {number} textureSize     côté maximal d'une texture, en pixels
 */

/** @type {Readonly<ModelLimits>} */
export const MODEL_LIMITS = Object.freeze({
  triangles: 400_000,
  primitives: 80,
  textureSize: 2048,
});

const ASSETS_DIR = 'public/assets';
const VEHICLES_PREFIX = `${ASSETS_DIR}/vehicles/`;
const BENCH_PREFIX = `${ASSETS_DIR}/bench/`;

/**
 * Vrai si le modèle est celui d'un véhicule dont le manifeste déclare un substitut (`placeholder`).
 * @param {string} abs  chemin absolu du GLB
 */
function isPlaceholderVehicle(abs) {
  const manifest = join(dirname(abs), 'vehicle.json');
  if (!existsSync(manifest)) return false;
  try {
    const value = JSON.parse(readFileSync(manifest, 'utf8'));
    return typeof value === 'object' && value !== null && typeof value.placeholder === 'string';
  } catch {
    // Manifeste illisible : la règle « vehicule » le signale déjà.
    return false;
  }
}

/** @param {number} value  entier groupé par milliers, avec des espaces ordinaires */
function grouped(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** @param {{ width: number | null, height: number | null } | undefined} image */
function side(image) {
  return Math.max(image?.width ?? 0, image?.height ?? 0);
}

/**
 * Note chiffrée d'un modèle.
 * @param {GlbStats} stats
 * @param {number} bytes
 * @param {(bytes: number) => string} format
 */
function describeModel(stats, bytes, format) {
  const { images } = stats;
  const ktx2 = images.filter((image) => image.format === 'KTX2').length;
  const largest = images.reduce((best, image) => (side(image) > side(best) ? image : best), images[0]);
  const dimensions = largest && largest.width !== null ? `${largest.width} × ${largest.height}` : 'dimensions illisibles';
  const textures =
    images.length === 0
      ? 'aucune texture'
      : `${countLabel(images.length, 'texture')} (la plus grande : ${dimensions}, ${ktx2} sur ${images.length} en KTX2)`;
  return (
    `${grouped(stats.triangles)} ${stats.triangles > 1 ? 'triangles' : 'triangle'}, ` +
    `${countLabel(stats.primitives, 'primitive')} dans ${countLabel(stats.meshes, 'maillage')}, ` +
    `${textures}, ${format(bytes)}`
  );
}

/**
 * Contrôle de chaque .glb de public/assets/.
 * @param {Report} report
 * @param {TreeFile[]} files
 * @param {(bytes: number) => string} format  mise en forme des tailles
 * @returns {number}  nombre de modèles lus
 */
export function checkModels(report, files, format) {
  const models = files.filter((file) => file.rel.startsWith(`${ASSETS_DIR}/`) && /\.glb$/i.test(file.rel));
  let measured = 0;

  for (const model of models) {
    // Un fichier vide est déjà refusé par la règle « vehicule » : pas de doublon.
    if (model.size === 0) continue;
    const vehicle = model.rel.startsWith(VEHICLES_PREFIX);
    const bench = model.rel.startsWith(BENCH_PREFIX);
    const lenient = bench || (vehicle && isPlaceholderVehicle(model.abs));
    const strict = vehicle && !lenient;
    const over = strict ? report.errors : report.warnings;

    let parsed;
    try {
      parsed = parseGlb(readFileSync(model.abs));
    } catch (error) {
      parsed = { ok: /** @type {const} */ (false), message: `lecture impossible : ${error instanceof Error ? error.message : String(error)}` };
    }
    if (!parsed.ok) {
      report.errors.push(finding(model.rel, 0, 'modele', `GLB illisible : ${parsed.message}`));
      continue;
    }
    const stats = measureGlb(parsed.container, dirname(model.abs));
    measured += 1;
    report.notes.push(finding(model.rel, 0, 'modele', describeModel(stats, model.size, format)));

    if (!strict && !lenient) continue;
    const where = bench
      ? ' (banc d\'essai, substitut déclaré : avertissement seulement)'
      : lenient
        ? ' (véhicule substitut déclaré : avertissement seulement)'
        : '';

    if (stats.triangles > MODEL_LIMITS.triangles) {
      over.push(
        finding(
          model.rel,
          0,
          'modele-triangles',
          `${grouped(stats.triangles)} triangles : le maximum d'un véhicule est de ${grouped(MODEL_LIMITS.triangles)} (§ 8) ; ` +
            `dépassement de ${grouped(stats.triangles - MODEL_LIMITS.triangles)}${where}`,
        ),
      );
    }
    if (stats.primitives > MODEL_LIMITS.primitives) {
      over.push(
        finding(
          model.rel,
          0,
          'modele-appels',
          `${countLabel(stats.primitives, 'primitive')} (une primitive = un appel de dessin) : le maximum d'un véhicule est de ` +
            `${MODEL_LIMITS.primitives} (§ 8) ; dépassement de ${stats.primitives - MODEL_LIMITS.primitives}${where}`,
        ),
      );
    }
    const oversized = stats.images.filter((image) => side(image) > MODEL_LIMITS.textureSize);
    if (oversized.length > 0) {
      const largest = oversized.reduce((best, image) => (side(image) > side(best) ? image : best), oversized[0]);
      over.push(
        finding(
          model.rel,
          0,
          'modele-texture',
          `${countLabel(oversized.length, 'texture dépasse', 'textures dépassent')} ${MODEL_LIMITS.textureSize} px (§ 8) : ` +
            `la plus grande fait ${largest?.width} × ${largest?.height} (image ${largest?.index})${where}`,
        ),
      );
    }
    const unreadable = stats.images.filter((image) => image.width === null);
    if (unreadable.length > 0) {
      report.warnings.push(
        finding(
          model.rel,
          0,
          'modele-texture',
          `${countLabel(unreadable.length, 'texture')} aux dimensions illisibles (format non reconnu ou image externe absente), par exemple l'image ${unreadable[0]?.index} : taille non vérifiée`,
        ),
      );
    }
    const notKtx2 = stats.images.filter((image) => image.format !== 'KTX2');
    if (notKtx2.length > 0) {
      report.warnings.push(
        finding(
          model.rel,
          0,
          'modele-format',
          `${notKtx2.length} texture${notKtx2.length > 1 ? 's' : ''} sur ${stats.images.length} hors KTX2 ` +
            `(par exemple l'image ${notKtx2[0]?.index}, ${notKtx2[0]?.format}) : le § 8 demande du KTX2`,
        ),
      );
    }
  }

  report.notes.push(
    finding(
      '',
      0,
      'modele',
      `${countLabel(measured, 'modèle GLB mesuré', 'modèles GLB mesurés')} sous ${ASSETS_DIR}/ ` +
        `(triangles, primitives, textures ; seuils d'un véhicule : ${grouped(MODEL_LIMITS.triangles)} triangles, ` +
        `${MODEL_LIMITS.primitives} primitives, ${MODEL_LIMITS.textureSize} px)`,
    ),
  );
  return measured;
}
