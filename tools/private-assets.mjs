// @ts-check
// Détection du dépôt privé d'assets (sons de banque, musique, modèles sous licence).
// Ce dépôt n'est jamais versionné ici (§ 11 du cahier des charges) : le build doit passer
// avec ou sans lui. Seuls des compteurs entrent dans le bundle public, jamais un nom de fichier.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * @typedef {object} PrivateAssetsSummary
 * @property {boolean} present  le dossier du dépôt privé est là
 * @property {number} engines   familles de moteur fournies (dossiers non vides de engines/)
 * @property {number} sfx       fichiers de bruitage fournis (sfx/)
 * @property {number} stations  stations de radio non vides (dossiers de radio/)
 */

/** @type {PrivateAssetsSummary} */
const ABSENT = Object.freeze({ present: false, engines: 0, sfx: 0, stations: 0 });

/** @param {string} path */
function isDir(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Entrées visibles d'un dossier (les fichiers cachés et .gitkeep ne comptent pas).
 * @param {string} dir
 */
function visibleEntries(dir) {
  if (!existsSync(dir) || !isDir(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).filter((entry) => !entry.name.startsWith('.'));
}

/**
 * Compte récursivement les fichiers visibles d'un dossier.
 * @param {string} dir
 * @returns {number}
 */
function countFiles(dir) {
  let total = 0;
  for (const entry of visibleEntries(dir)) {
    if (entry.isDirectory()) total += countFiles(resolve(dir, entry.name));
    else if (entry.isFile()) total += 1;
  }
  return total;
}

/**
 * Compte les sous-dossiers qui contiennent au moins un fichier.
 * Une station ou une famille de moteur vide n'existe pas pour l'app.
 * @param {string} dir
 */
function countFilledDirs(dir) {
  return visibleEntries(dir).filter(
    (entry) => entry.isDirectory() && countFiles(resolve(dir, entry.name)) > 0,
  ).length;
}

/**
 * Regarde si le dépôt privé d'assets est disponible pour ce build.
 * Emplacement : variable PMB_ASSETS_DIR, sinon `.private-assets/` à la racine.
 * @param {{ root: string, env?: Record<string, string | undefined> }} options
 * @returns {PrivateAssetsSummary}
 */
export function detectPrivateAssets({ root, env = process.env }) {
  const dir = resolve(root, env.PMB_ASSETS_DIR || '.private-assets');
  if (!isDir(dir)) return { ...ABSENT };
  return {
    present: true,
    engines: countFilledDirs(resolve(dir, 'engines')),
    sfx: countFiles(resolve(dir, 'sfx')),
    stations: countFilledDirs(resolve(dir, 'radio')),
  };
}
