// @ts-check
// Contrôle des assets et des budgets de poids (§ 8, § 11 et § 15 du cahier des charges) :
//   - aucune source lourde ni master dans le dépôt ;
//   - une licence admise, déclarée dans CREDITS.md, pour tout fichier de public/assets/ ;
//   - poids des véhicules, des décors, de chaque fichier et du site construit ;
//   - structure de chaque dossier de véhicule.

import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { checkLicenseCoverage, CREDITS_FILE, loadCredits } from './credits.mjs';
import { isDirectory, isRegularFile, listDirectories, walkTree } from './fs-walk.mjs';
import { countLabel, createReport, finding, mergeInto, notChecked, sortReport } from './report.mjs';
import { parseJson } from './text.mjs';

/** @typedef {import('./report.mjs').Report} Report */
/** @typedef {import('./fs-walk.mjs').TreeFile} TreeFile */

const MEGABYTE = 1_000_000;

/**
 * Extensions interdites dans le dépôt : sources de modélisation et de retouche, masters audio.
 * Elles vivent dans le dépôt privé d'assets ou dans un stockage à part (§ 11).
 */
export const FORBIDDEN_EXTENSIONS = Object.freeze([
  '.blend',
  '.blend1',
  '.wav',
  '.flac',
  '.aif',
  '.aiff',
  '.psd',
  '.kra',
  '.xcf',
]);

/**
 * Budgets de poids, en octets. Les mégaoctets sont décimaux (1 Mo = 1 000 000 octets) :
 * c'est la lecture la plus stricte des budgets du § 8 et de la limite de l'hébergeur.
 * @typedef {object} AssetLimits
 * @property {number} vehicleBytes  un dossier public/assets/vehicles/<id>/
 * @property {number} garageBytes   public/assets/garage/
 * @property {number} cityBytes     public/assets/city/
 * @property {number} fileBytes     un fichier du dépôt, quel qu'il soit
 * @property {number} siteBytes     tout dist/ (limite de l'hébergeur)
 */

/** @type {Readonly<AssetLimits>} */
export const DEFAULT_LIMITS = Object.freeze({
  vehicleBytes: 15 * MEGABYTE,
  garageBytes: 10 * MEGABYTE,
  cityBytes: 12 * MEGABYTE,
  fileBytes: 25 * MEGABYTE,
  siteBytes: 1000 * MEGABYTE,
});

const ASSETS_DIR = 'public/assets';
const VEHICLES_DIR = `${ASSETS_DIR}/vehicles`;

/** Fichiers attendus dans un dossier de véhicule, en plus du manifeste. */
const VEHICLE_FILES = ['body.glb', 'thumb.webp'];

/**
 * Taille lisible, à la française : « 743 ko », « 15,2 Mo », « 1,04 Go ».
 * @param {number} bytes
 */
export function formatBytes(bytes) {
  /** @param {number} value */
  const decimal = (value) => {
    const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
    // « 1,00 » s'écrit « 1 », « 1,50 » s'écrit « 1,5 ».
    return value
      .toFixed(digits)
      .replace(/\.0+$|(\.\d*[1-9])0+$/, '$1')
      .replace('.', ',');
  };
  if (bytes >= 1000 * MEGABYTE) return `${decimal(bytes / (1000 * MEGABYTE))} Go`;
  if (bytes >= MEGABYTE) return `${decimal(bytes / MEGABYTE)} Mo`;
  if (bytes >= 1000) return `${Math.round(bytes / 1000)} ko`;
  return countLabel(bytes, 'octet');
}

/**
 * Dépassement d'un budget, pour les messages : un écart d'un octet ne se voit pas dans un arrondi.
 * @param {number} size
 * @param {number} limit
 */
function excess(size, limit) {
  return `dépassement de ${formatBytes(size - limit)}`;
}

/**
 * @param {TreeFile[]} files
 * @param {string} dir  dossier relatif, sans barre finale
 */
function sizeUnder(files, dir) {
  const prefix = `${dir}/`;
  let total = 0;
  for (const file of files) if (file.rel.startsWith(prefix)) total += file.size;
  return total;
}

/**
 * a. Sources lourdes et masters, et poids de chaque fichier du dépôt.
 * @param {Report} report
 * @param {TreeFile[]} files
 * @param {AssetLimits} limits
 */
function checkRepositoryFiles(report, files, limits) {
  let forbidden = 0;
  for (const file of files) {
    const extension = extname(file.rel).toLowerCase();
    if (FORBIDDEN_EXTENSIONS.includes(extension)) {
      forbidden += 1;
      report.errors.push(
        finding(
          file.rel,
          0,
          'extension-interdite',
          `fichier « ${extension} » : les sources lourdes et les masters restent hors du dépôt public ` +
            "(dépôt privé d'assets ou stockage à part, § 11)",
        ),
      );
    }
    if (file.size > limits.fileBytes) {
      report.errors.push(
        finding(
          file.rel,
          0,
          'poids-fichier',
          `fichier de ${formatBytes(file.size)} : aucun fichier du dépôt ne dépasse ${formatBytes(limits.fileBytes)} ` +
            `(${excess(file.size, limits.fileBytes)})`,
        ),
      );
    }
  }
  report.notes.push(
    finding(
      '',
      0,
      'perimetre',
      `${countLabel(files.length, 'fichier du dépôt contrôlé', 'fichiers du dépôt contrôlés')} ` +
        `(extensions interdites : ${forbidden} ; poids par fichier)`,
    ),
  );
}

/**
 * b. Licence déclarée pour tout fichier de public/assets/.
 * @param {Report} report
 * @param {string} root
 * @param {TreeFile[]} files
 */
function checkLicenses(report, root, files) {
  const credits = loadCredits(root);
  const assets = files
    .filter((file) => file.rel.startsWith(`${ASSETS_DIR}/`) && !file.rel.endsWith('/.gitkeep'))
    .map((file) => file.rel);

  report.warnings.push(...credits.problems);
  if (!credits.present && assets.length === 0) {
    report.notes.push(
      finding('', 0, 'licence', `${CREDITS_FILE} absent et aucun fichier sous ${ASSETS_DIR}/ : rien à couvrir`),
    );
    return;
  }
  const coverage = checkLicenseCoverage({ files: assets, credits, rule: 'licence' });
  mergeInto(report, coverage);
  if (credits.present) {
    report.notes.push(
      finding(
        '',
        0,
        'licence',
        `${countLabel(assets.length, 'fichier')} sous ${ASSETS_DIR}/, ` +
          `${countLabel(credits.rows.length, 'ligne')} de licence lues dans ${CREDITS_FILE}`,
      ),
    );
  }
}

/**
 * c et d. Poids et structure des dossiers de véhicules.
 * @param {Report} report
 * @param {string} root
 * @param {TreeFile[]} files
 * @param {AssetLimits} limits
 */
function checkVehicles(report, root, files, limits) {
  const ids = listDirectories(join(root, VEHICLES_DIR));
  if (ids.length === 0) {
    report.notes.push(
      finding('', 0, 'vehicule', `aucun véhicule sous ${VEHICLES_DIR}/ : structure et poids des véhicules sans objet`),
    );
    return;
  }

  for (const id of ids) {
    const dir = `${VEHICLES_DIR}/${id}`;
    const size = sizeUnder(files, dir);
    if (size > limits.vehicleBytes) {
      report.errors.push(
        finding(
          dir,
          0,
          'poids-vehicule',
          `dossier de ${formatBytes(size)} : le budget d'un véhicule est de ${formatBytes(limits.vehicleBytes)}, ` +
            `toutes variantes comprises (§ 8) ; ${excess(size, limits.vehicleBytes)}`,
        ),
      );
    }

    const manifest = `${dir}/vehicle.json`;
    if (!isRegularFile(join(root, manifest))) {
      report.errors.push(finding(manifest, 0, 'vehicule', 'manifeste manquant : chaque véhicule a son vehicle.json'));
    } else {
      const parsed = parseJson(readFileSync(join(root, manifest), 'utf8'));
      if (!parsed.ok) {
        report.errors.push(finding(manifest, parsed.line, 'vehicule', `JSON invalide : ${parsed.message}`));
      } else {
        const value = parsed.value;
        const declared = typeof value === 'object' && value !== null && 'id' in value ? value.id : undefined;
        if (declared !== id) {
          report.errors.push(
            finding(
              manifest,
              0,
              'vehicule',
              `champ « id » ${declared === undefined ? 'absent' : `égal à ${JSON.stringify(declared)}`} : ` +
                `il doit être égal au nom du dossier, « ${id} »`,
            ),
          );
        }
      }
    }

    for (const name of VEHICLE_FILES) {
      const rel = `${dir}/${name}`;
      const file = files.find((item) => item.rel === rel);
      if (!file) report.errors.push(finding(rel, 0, 'vehicule', `fichier manquant : chaque véhicule a son ${name}`));
      else if (file.size === 0) report.errors.push(finding(rel, 0, 'vehicule', 'fichier vide'));
    }
  }
  report.notes.push(finding('', 0, 'vehicule', `${countLabel(ids.length, 'véhicule contrôlé', 'véhicules contrôlés')} : ${ids.join(', ')}`));
}

/**
 * c. Poids des décors.
 * @param {Report} report
 * @param {string} root
 * @param {TreeFile[]} files
 * @param {AssetLimits} limits
 */
function checkScenery(report, root, files, limits) {
  /** @type {Array<[string, number]>} */
  const budgets = [
    ['garage', limits.garageBytes],
    ['city', limits.cityBytes],
  ];
  for (const [name, limit] of budgets) {
    const dir = `${ASSETS_DIR}/${name}`;
    if (!isDirectory(join(root, dir))) {
      report.notes.push(finding('', 0, 'poids-decor', `${dir}/ absent : poids du décor sans objet`));
      continue;
    }
    const size = sizeUnder(files, dir);
    if (size > limit) {
      report.errors.push(
        finding(dir, 0, 'poids-decor', `dossier de ${formatBytes(size)} : le budget de ce décor est de ${formatBytes(limit)} (§ 8) ; ${excess(size, limit)}`),
      );
    } else {
      report.notes.push(finding(dir, 0, 'poids-decor', `${formatBytes(size)} sur un budget de ${formatBytes(limit)}`));
    }
  }
}

/**
 * c. Poids du site construit, s'il existe.
 * @param {Report} report
 * @param {string} root
 * @param {AssetLimits} limits
 */
function checkBuiltSite(report, root, limits) {
  if (!isDirectory(join(root, 'dist'))) {
    report.notes.push(
      finding('', 0, 'poids-site', 'dist/ absent : poids du site non contrôlé (lance le build, puis relance le contrôle)'),
    );
    return;
  }
  const files = walkTree(root, { start: 'dist', ignore: false }).files;
  const total = files.reduce((sum, file) => sum + file.size, 0);
  const summary = `dist/ pèse ${formatBytes(total)} en ${countLabel(files.length, 'fichier')}`;
  if (total > limits.siteBytes) {
    report.errors.push(
      finding('dist', 0, 'poids-site', `${summary} : la limite de l'hébergeur est de ${formatBytes(limits.siteBytes)} (§ 11) ; ${excess(total, limits.siteBytes)}`),
    );
  } else {
    report.notes.push(
      finding('dist', 0, 'poids-site', `${summary} (limite de l'hébergeur : ${formatBytes(limits.siteBytes)})`),
    );
  }
  const largest = [...files].sort((a, b) => b.size - a.size || (a.rel < b.rel ? -1 : 1)).slice(0, 5);
  for (const file of largest) {
    report.notes.push(finding(file.rel, 0, 'poids-site', `${formatBytes(file.size)} (parmi les 5 plus gros fichiers du site)`));
  }
}

/**
 * Lance le contrôle des assets sur un arbre de travail.
 * @param {object} options
 * @param {string} options.root
 * @param {Partial<AssetLimits>} [options.limits]  budgets de remplacement (tests)
 * @returns {Report}
 */
export function runAssetsCheck({ root, limits: overrides = {} }) {
  /** @type {AssetLimits} */
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  const report = createReport();
  const tree = walkTree(root);

  checkRepositoryFiles(report, tree.files, limits);
  checkLicenses(report, root, tree.files);
  checkVehicles(report, root, tree.files, limits);
  checkScenery(report, root, tree.files, limits);
  checkBuiltSite(report, root, limits);

  for (const link of tree.links) {
    if (link.rel === 'public' || link.rel.startsWith('public/')) {
      report.warnings.push(
        finding(
          link.rel,
          0,
          'lien-symbolique',
          "lien symbolique non suivi : ce qu'il désigne échappe aux contrôles de licence et de poids",
        ),
      );
    }
  }

  report.notes.push(
    notChecked(
      'triangles, draw calls et tailles de textures des GLB, compression KTX2 (jalon 2, avec glTF Transform)',
    ),
  );
  return sortReport(report);
}
