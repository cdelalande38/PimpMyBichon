// @ts-check
// Parcours de l'arbre de travail, commun aux contrôles. Zéro dépendance : fs.glob n'existe
// pas en Node 20.

import { lstatSync, readdirSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

/** Dossiers ignorés à toute profondeur. */
export const IGNORED_EVERYWHERE = new Set(['node_modules', '.git']);

/**
 * Sorties de build et de test, dépôt privé d'assets : ignorés à la racine du dépôt seulement.
 * Un dossier du même nom rangé plus bas (dans src/ ou public/) reste contrôlé.
 */
export const IGNORED_AT_ROOT = new Set([
  'dist',
  'dev-dist',
  'test-results',
  'playwright-report',
  'captures',
  'coverage',
  '.private-assets',
]);

/**
 * @typedef {object} TreeFile
 * @property {string} rel   chemin relatif à la racine, séparateur « / »
 * @property {string} abs   chemin absolu
 * @property {number} size  taille en octets
 */

/**
 * @typedef {object} TreeLink
 * @property {string} rel     chemin relatif du lien symbolique
 * @property {string} target  cible, telle qu'elle est écrite dans le lien
 */

/**
 * @typedef {object} Tree
 * @property {TreeFile[]} files  fichiers ordinaires, triés par chemin
 * @property {TreeLink[]} links  liens symboliques rencontrés (jamais suivis)
 */

/**
 * @param {{ rel: string }} a
 * @param {{ rel: string }} b
 */
function byRel(a, b) {
  if (a.rel === b.rel) return 0;
  return a.rel < b.rel ? -1 : 1;
}

/**
 * Liste les fichiers sous `root` (ou sous `root/start`), sans suivre les liens symboliques.
 * @param {string} root
 * @param {object} [options]
 * @param {string} [options.start]    sous-dossier de départ, relatif à la racine
 * @param {boolean} [options.ignore]  applique les listes de dossiers ignorés (vrai par défaut)
 * @returns {Tree}
 */
export function walkTree(root, { start = '', ignore = true } = {}) {
  /** @type {Tree} */
  const tree = { files: [], links: [] };
  const first = start.replace(/^\/+|\/+$/g, '');
  if (first) {
    // Le dossier de départ lui-même peut être un lien : on le signale sans le traverser.
    let stats;
    try {
      stats = lstatSync(join(root, first));
    } catch (error) {
      if (isMissing(error)) return tree;
      throw error;
    }
    if (stats.isSymbolicLink()) {
      tree.links.push({ rel: first, target: readlinkSync(join(root, first)) });
      return tree;
    }
    if (!stats.isDirectory()) return tree;
  }
  /** @type {string[]} */
  const pending = [first];

  while (pending.length > 0) {
    const relDir = /** @type {string} */ (pending.pop());
    const absDir = relDir ? join(root, relDir) : root;
    let entries;
    try {
      entries = readdirSync(absDir, { withFileTypes: true });
    } catch (error) {
      // Le dossier de départ peut ne pas exister : arbre vide. Toute autre erreur remonte.
      if (relDir === first && isMissing(error)) return tree;
      throw error;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      const abs = join(absDir, entry.name);
      if (entry.isSymbolicLink()) {
        tree.links.push({ rel, target: readlinkSync(abs) });
      } else if (entry.isDirectory()) {
        if (ignore && IGNORED_EVERYWHERE.has(entry.name)) continue;
        if (ignore && relDir === '' && IGNORED_AT_ROOT.has(entry.name)) continue;
        pending.push(rel);
      } else if (entry.isFile()) {
        tree.files.push({ rel, abs, size: lstatSync(abs).size });
      }
      // Sockets, tubes et périphériques : rien à contrôler.
    }
  }

  tree.files.sort(byRel);
  tree.links.sort(byRel);
  return tree;
}

/** @param {unknown} error */
function isMissing(error) {
  const code = error instanceof Error && 'code' in error ? error.code : undefined;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * Vrai si `path` désigne un dossier (un lien symbolique ne compte pas).
 * @param {string} path
 */
export function isDirectory(path) {
  try {
    return lstatSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Vrai si `path` désigne un fichier ordinaire (un lien symbolique ne compte pas).
 * @param {string} path
 */
export function isRegularFile(path) {
  try {
    return lstatSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * Noms des sous-dossiers directs d'un dossier, triés. Liste vide si le dossier n'existe pas.
 * @param {string} dir
 * @returns {string[]}
 */
export function listDirectories(dir) {
  if (!isDirectory(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}
