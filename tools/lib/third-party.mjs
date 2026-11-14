// @ts-check
// Règle « requêtes vers un tiers » du garde : à l'exécution, l'app ne parle qu'à elle-même.
// Polices, textures, sons et modèles sont servis par l'app (§ 7 et § 15 du cahier des charges).
//
// Deux contrôles :
//   - dans le code de l'app, toute URL absolue écrite en toutes lettres est une erreur ;
//   - dans le build (dist/), on cherche les hôtes de CDN que les bibliothèques web et 3D
//     appellent d'elles-mêmes, et on liste les autres hôtes pour relecture.

import { join } from 'node:path';
import { isDirectory, walkTree } from './fs-walk.mjs';
import { countLabel, createReport, finding } from './report.mjs';
import { lineNumberAt, readTextFile, truncate } from './text.mjs';

/** @typedef {import('./report.mjs').Report} Report */

/**
 * Seules URL absolues admises dans l'app : les espaces de noms XML. Ce sont des identifiants
 * (SVG, XLink, XHTML, MathML), le navigateur ne les appelle jamais.
 */
export const XML_NAMESPACES = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/2000/xmlns/',
  'http://www.w3.org/XML/1998/namespace',
  'http://www.w3.org/1998/Math/MathML',
];

/**
 * Hôtes que des bibliothèques web et 3D appellent à l'exécution quand on garde leurs réglages
 * par défaut. Un hôte correspond s'il est égal au suffixe ou s'il en est un sous-domaine.
 * L'ordre compte : le premier suffixe qui correspond donne la catégorie affichée.
 * @type {ReadonlyArray<{ suffix: string, category: string }>}
 */
export const RUNTIME_CDN_HOSTS = [
  { suffix: 'fonts.googleapis.com', category: 'polices' },
  { suffix: 'fonts.gstatic.com', category: 'polices' },
  { suffix: 'typekit.net', category: 'polices' },
  { suffix: 'fonts.bunny.net', category: 'polices' },
  { suffix: 'fontawesome.com', category: 'polices' },
  { suffix: 'rsms.me', category: 'polices' },
  { suffix: 'gstatic.com', category: 'décodeurs de géométrie et de textures' },
  { suffix: 'githack.com', category: "environnements HDR et textures d'exemple" },
  { suffix: 'githubusercontent.com', category: "environnements HDR et textures d'exemple" },
  { suffix: 'polyhaven.org', category: "environnements HDR et textures d'exemple" },
  { suffix: 'polyhaven.com', category: "environnements HDR et textures d'exemple" },
  { suffix: 'digitaloceanspaces.com', category: "environnements HDR et textures d'exemple" },
  { suffix: 'jsdelivr.net', category: 'miroir de paquets npm' },
  { suffix: 'unpkg.com', category: 'miroir de paquets npm' },
  { suffix: 'esm.sh', category: 'miroir de paquets npm' },
  { suffix: 'esm.run', category: 'miroir de paquets npm' },
  { suffix: 'skypack.dev', category: 'miroir de paquets npm' },
  { suffix: 'cdnjs.cloudflare.com', category: 'miroir de paquets npm' },
  { suffix: 'jspm.io', category: 'miroir de paquets npm' },
  { suffix: 'jspm.dev', category: 'miroir de paquets npm' },
  { suffix: 'googleapis.com', category: 'scripts et modèles chargés à la demande' },
];

/**
 * URL avec schéma. Les barres peuvent être échappées (« https:\/\/ ») dans du JSON ou du
 * code généré. Le schéma peut suivre un chiffre (guillemet encodé « %22 » d'une URI de
 * données), jamais une lettre. Le reste s'arrête au premier caractère qui ne peut pas faire
 * partie d'une URL écrite dans du code ou du balisage.
 */
const ABSOLUTE_URL = /(?<![A-Za-z])(https?|wss?):(?:\\?\/){2}([^\s"'`<>\\)\]}|^]*)/gi;

/**
 * URL sans schéma (« //hôte/… »). Elle n'est reconnue que là où commence une valeur : après
 * un guillemet, une parenthèse ou un signe égal. Ailleurs, « // » ouvre un commentaire.
 */
const PROTOCOL_RELATIVE_URL = /(?<=["'`(=])\/\/((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![A-Za-z0-9-])[^\s"'`<>\\)]*/g;

/** Début d'un nom d'hôte écrit en toutes lettres, après d'éventuels identifiants de connexion. */
const HOST_HEAD = /^(?:[^/?#@\s]*@)?(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)/;

/** Hôte fabriqué à l'exécution (« ${…} », « {{…}} », « %s ») ou joker (« *.domaine »). */
const COMPUTED_HOST = /^[$%{*]/;

/**
 * @typedef {object} UrlHit
 * @property {number} index        position dans le texte
 * @property {string} url          l'URL telle qu'elle est écrite
 * @property {string | null} host  hôte en minuscules ; null si l'hôte est calculé à l'exécution
 */

/**
 * Vrai pour un espace de noms XML admis, seul ou suivi d'un caractère qui ne prolonge pas
 * son chemin (guillemet encodé « %22 » dans une URI de données, par exemple).
 * @param {string} url
 */
export function isXmlNamespace(url) {
  return XML_NAMESPACES.some(
    (namespace) => url.startsWith(namespace) && !/^[A-Za-z0-9/_.~-]/.test(url.slice(namespace.length)),
  );
}

/**
 * Trouve les URL absolues écrites dans un texte.
 * @param {string} text
 * @returns {UrlHit[]}
 */
export function findUrls(text) {
  /** @type {UrlHit[]} */
  const hits = [];
  for (const match of text.matchAll(ABSOLUTE_URL)) {
    const rest = (match[2] ?? '').replace(/[.,;:!?]+$/, '');
    const host = HOST_HEAD.exec(rest)?.[1]?.toLowerCase() ?? null;
    // « https:// » tout seul (test de préfixe) ou suivi d'un texte libre (« https://… ») n'est
    // pas une adresse.
    if (host === null && !COMPUTED_HOST.test(rest)) continue;
    hits.push({ index: match.index, url: `${(match[1] ?? '').toLowerCase()}://${rest}`, host });
  }
  for (const match of text.matchAll(PROTOCOL_RELATIVE_URL)) {
    hits.push({ index: match.index, url: match[0], host: (match[1] ?? '').toLowerCase() });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/**
 * Règle « url-tierce », pour une ligne du code de l'app.
 * @param {string} line
 * @returns {string[]}  un message par URL refusée
 */
export function scanLineForUrls(line) {
  // Recherche rapide avant les expressions régulières : la plupart des lignes n'ont rien.
  if (!line.includes('//') && !line.includes('\\/')) return [];
  return findUrls(line)
    .filter((hit) => !isXmlNamespace(hit.url))
    .map(
      (hit) =>
        `URL absolue « ${truncate(hit.url)} » : l'app n'appelle aucun tiers à l'exécution ` +
        "(polices, textures, sons et modèles sont servis par l'app)",
    );
}

/**
 * @param {string} host
 * @returns {string | null}  la catégorie du CDN, ou null si l'hôte n'est pas dans la liste
 */
export function runtimeCdnCategory(host) {
  const entry = RUNTIME_CDN_HOSTS.find(({ suffix }) => host === suffix || host.endsWith(`.${suffix}`));
  return entry ? entry.category : null;
}

/**
 * @typedef {object} HostUse
 * @property {number} count       nombre d'occurrences
 * @property {Set<string>} files  fichiers concernés
 * @property {string} file        premier fichier où l'hôte apparaît
 * @property {number} line        ligne de cette première occurrence
 * @property {string} url         première URL rencontrée
 */

/**
 * Contrôle du build : hôtes externes présents dans les fichiers texte de dist/.
 * Un hôte de CDN connu est une erreur ; tout autre hôte donne un avertissement, une ligne par
 * hôte avec un fichier d'exemple (les bundles citent des pages de documentation sans effet).
 * @param {string} root
 * @returns {Report}
 */
export function scanDistHosts(root) {
  const report = createReport();
  if (!isDirectory(join(root, 'dist'))) {
    report.notes.push(
      finding('', 0, 'perimetre', 'dist/ absent : hôtes du build non contrôlés (lance le build, puis relance le garde)'),
    );
    return report;
  }

  /** @type {Map<string, HostUse>} */
  const hosts = new Map();
  let scanned = 0;
  let maps = 0;

  for (const file of walkTree(root, { start: 'dist', ignore: false }).files) {
    // Une carte de sources cite le code d'origine, y compris ce que le build a éliminé :
    // elle n'est pas exécutée et fausserait le contrôle.
    if (file.rel.endsWith('.map')) {
      maps += 1;
      continue;
    }
    const text = readTextFile(file.abs);
    if (text === null) continue;
    scanned += 1;
    for (const hit of findUrls(text)) {
      if (isXmlNamespace(hit.url)) continue;
      const key = hit.host ?? '';
      const use = hosts.get(key);
      if (use) {
        use.count += 1;
        use.files.add(file.rel);
      } else {
        hosts.set(key, {
          count: 1,
          files: new Set([file.rel]),
          file: file.rel,
          line: lineNumberAt(text, hit.index),
          url: hit.url,
        });
      }
    }
  }

  for (const [host, use] of [...hosts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const where = `${countLabel(use.count, 'occurrence')} dans ${countLabel(use.files.size, 'fichier')}`;
    const example = `par exemple « ${truncate(use.url)} »`;
    const category = host ? runtimeCdnCategory(host) : null;
    if (category) {
      report.errors.push(
        finding(
          use.file,
          use.line,
          'hote-cdn',
          `hôte de CDN « ${host} » (${category}) dans le build, ${where}, ${example} : ` +
            "ce fichier doit être servi par l'app, pas par un tiers",
        ),
      );
    } else if (host) {
      report.warnings.push(
        finding(
          use.file,
          use.line,
          'hote-externe',
          `hôte externe « ${host} » dans le build, ${where}, ${example} : ` +
            'à relire (lien de documentation sans effet, ou vraie requête ?)',
        ),
      );
    } else {
      report.warnings.push(
        finding(
          use.file,
          use.line,
          'hote-externe',
          `URL absolue dont l'hôte est calculé à l'exécution, ${where}, ${example} : à relire`,
        ),
      );
    }
  }

  const skipped = maps > 0 ? ` ; ${countLabel(maps, 'carte de sources ignorée', 'cartes de sources ignorées')}` : '';
  report.notes.push(
    finding(
      '',
      0,
      'perimetre',
      `build (dist/) : ${countLabel(scanned, 'fichier texte contrôlé', 'fichiers texte contrôlés')}, ` +
        `${countLabel(hosts.size, 'hôte externe', 'hôtes externes')}${skipped}`,
    ),
  );
  return report;
}
