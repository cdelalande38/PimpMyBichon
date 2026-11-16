// @ts-check
// Lecture de CREDITS.md (à la racine) : quelle ligne de quel tableau couvre quel fichier,
// et sous quelle licence. Sert à assets-check (tout public/assets/) et à audio-check
// (tout fichier audio sous public/).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isRegularFile } from './fs-walk.mjs';
import { createPathMatcher } from './glob.mjs';
import { countLabel, finding } from './report.mjs';
import { splitLines } from './text.mjs';

/** @typedef {import('./report.mjs').Finding} Finding */

export const CREDITS_FILE = 'CREDITS.md';

/**
 * Licences admises dans un dépôt public (§ 11 du cahier des charges) : domaine public,
 * attribution, police libre, fichier créé pour le projet, ou données géographiques ouvertes des
 * cartes de sortie (§ 17 : bases de l'IGN sous Licence Ouverte 2.0, OpenStreetMap sous ODbL 1.0).
 */
export const ALLOWED_LICENSES = ['CC0-1.0', 'CC-BY-3.0', 'CC-BY-4.0', 'OFL-1.1', 'création projet', 'Licence Ouverte 2.0', 'ODbL-1.0'];

/**
 * Forme de comparaison d'une cellule : sans accents, en minuscules, tout ce qui n'est ni
 * lettre ni chiffre devient un tiret. « CC BY 4.0 » et « **CC-BY-4.0** » donnent « cc-by-4-0 ».
 * @param {string} text
 */
export function cellKey(text) {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // lien Markdown : on garde le libellé
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const ALLOWED_KEYS = new Set(ALLOWED_LICENSES.map(cellKey));

/**
 * Licences admises sur un seul dossier, jamais ailleurs. « droits du commanditaire » : la musique
 * d'accueil, générée par le commanditaire qui en a les droits d'usage (décision du 15 novembre 2026,
 * § 9 et § 18 du cahier des charges) ; partout ailleurs, la ligne est refusée comme toute autre.
 * « son généré par le commanditaire » : bruitages et sons de moteur qu'il fabrique avec un outil de
 * génération sonore et dont il a les droits d'usage (tools/sons/, licence « genere-commanditaire »
 * du dossier privé) ; admise sous les dossiers des sons fabriqués par sons:build seulement. Une
 * licence peut avoir plusieurs dossiers : une entrée par dossier.
 * @type {ReadonlyArray<Readonly<{ license: string, scope: string }>>}
 */
export const SCOPED_LICENSES = Object.freeze([
  Object.freeze({ license: 'droits du commanditaire', scope: 'public/assets/audio/radio/accueil/' }),
  Object.freeze({ license: 'son généré par le commanditaire', scope: 'public/assets/audio/engines/' }),
  Object.freeze({ license: 'son généré par le commanditaire', scope: 'public/assets/audio/sfx/' }),
]);

/**
 * Dossier où une licence à portée limitée est admise, ou null si elle ne l'est nulle part.
 * @param {string} cell
 * @returns {string | null}
 */
export function licenseScope(cell) {
  return licenseScopes(cell)[0] ?? null;
}

/**
 * Tous les dossiers où une licence à portée limitée est admise (aucun : liste vide).
 * @param {string} cell
 * @returns {string[]}
 */
export function licenseScopes(cell) {
  const key = cellKey(cell);
  return SCOPED_LICENSES.filter((item) => cellKey(item.license) === key).map((item) => item.scope);
}
const FILE_HEADERS = ['fichier', 'chemin', 'motif', 'file', 'path'];
const LICENSE_HEADERS = ['licence', 'license'];

/** @param {string} cell */
export function isAllowedLicense(cell) {
  return ALLOWED_KEYS.has(cellKey(cell));
}

/**
 * Une ligne de tableau qui déclare une licence pour un ou plusieurs chemins.
 * @typedef {object} CreditRow
 * @property {number} line        numéro de ligne dans CREDITS.md
 * @property {string[]} patterns  chemins ou motifs, tels qu'ils sont écrits entre accents graves
 * @property {string} license     contenu de la cellule « Licence »
 * @property {boolean} allowed    la licence fait partie de la liste admise
 * @property {string | null} scope  licence admise sur ce seul dossier (SCOPED_LICENSES), sinon null
 * @property {(rel: string) => boolean} covers
 */

/**
 * @typedef {object} Credits
 * @property {boolean} present     CREDITS.md existe
 * @property {CreditRow[]} rows
 * @property {Finding[]} problems  lignes illisibles (avertissements)
 */

/**
 * Découpe une ligne de tableau Markdown en cellules. Comme sur GitHub, seul « \| » garde
 * une barre dans une cellule.
 * @param {string} line
 * @returns {string[] | null}  null si la ligne ne contient aucune barre de tableau
 */
export function splitTableRow(line) {
  const trimmed = line.trim();
  /** @type {string[]} */
  const cells = [];
  let current = '';
  let bars = 0;
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed.charAt(index);
    if (char === '\\' && trimmed.charAt(index + 1) === '|') {
      current += '|';
      index += 1;
    } else if (char === '|') {
      cells.push(current.trim());
      current = '';
      bars += 1;
    } else {
      current += char;
    }
  }
  if (bars === 0) return null;
  cells.push(current.trim());
  // Les barres de début et de fin de ligne n'ouvrent pas de cellule.
  if (trimmed.startsWith('|')) cells.shift();
  if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) cells.pop();
  return cells;
}

/** @param {string[] | null} cells */
function isSeparatorRow(cells) {
  return cells !== null && cells.length > 0 && cells.every((cell) => /^:?-+:?$/.test(cell));
}

/**
 * Efface ce qui ne doit pas être lu comme un tableau : blocs de code (un exemple de format
 * ne déclare rien) et commentaires HTML. Les numéros de ligne sont conservés.
 * @param {string[]} lines
 * @returns {string[]}
 */
function hideCodeAndComments(lines) {
  let fence = '';
  let inComment = false;
  return lines.map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1]?.charAt(0) ?? '';
    if (fence) {
      if (marker === fence) fence = '';
      return '';
    }
    if (marker && !inComment) {
      fence = marker;
      return '';
    }
    let visible = '';
    let rest = line;
    while (rest.length > 0) {
      if (inComment) {
        const end = rest.indexOf('-->');
        if (end === -1) break;
        inComment = false;
        rest = rest.slice(end + 3);
      } else {
        const start = rest.indexOf('<!--');
        if (start === -1) {
          visible += rest;
          break;
        }
        visible += rest.slice(0, start);
        inComment = true;
        rest = rest.slice(start + 4);
      }
    }
    return visible;
  });
}

/**
 * @param {string[]} header
 * @param {string[]} names
 */
function findColumn(header, names) {
  return header.findIndex((cell) => names.some((name) => cellKey(cell).startsWith(name)));
}

/**
 * Lit tous les tableaux de CREDITS.md qui ont une colonne « Licence ». L'ordre des colonnes
 * est libre : la colonne des chemins est repérée par son en-tête (« Fichier(s) », « Chemin »,
 * « Motif »), à défaut c'est la première.
 * @param {string} markdown
 * @returns {{ rows: CreditRow[], problems: Finding[] }}
 */
export function parseCredits(markdown) {
  const lines = hideCodeAndComments(splitLines(markdown));
  /** @type {CreditRow[]} */
  const rows = [];
  /** @type {Finding[]} */
  const problems = [];

  let index = 0;
  while (index < lines.length - 1) {
    const header = splitTableRow(lines[index] ?? '');
    if (!header || !isSeparatorRow(splitTableRow(lines[index + 1] ?? ''))) {
      index += 1;
      continue;
    }
    const licenseColumn = findColumn(header, LICENSE_HEADERS);
    const fileColumn = Math.max(findColumn(header, FILE_HEADERS), 0);
    index += 2;
    for (; index < lines.length; index += 1) {
      const cells = splitTableRow(lines[index] ?? '');
      if (!cells) break;
      if (licenseColumn === -1 || cells.every((cell) => cell === '')) continue;
      const patterns = [...(cells[fileColumn] ?? '').matchAll(/`([^`]+)`/g)]
        .map((match) => (match[1] ?? '').trim())
        .filter((pattern) => pattern !== '');
      if (patterns.length === 0) {
        problems.push(
          finding(
            CREDITS_FILE,
            index + 1,
            'licence',
            'ligne sans chemin entre accents graves : elle ne couvre aucun fichier',
          ),
        );
        continue;
      }
      const license = (cells[licenseColumn] ?? '').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
      const matchers = patterns.map(createPathMatcher);
      rows.push({
        line: index + 1,
        patterns,
        license,
        allowed: isAllowedLicense(license),
        scope: licenseScope(license),
        covers: (rel) => matchers.some((matches) => matches(rel)),
      });
    }
  }
  return { rows, problems };
}

/**
 * @param {string} root
 * @returns {Credits}
 */
export function loadCredits(root) {
  const path = join(root, CREDITS_FILE);
  if (!isRegularFile(path)) return { present: false, rows: [], problems: [] };
  return { present: true, ...parseCredits(readFileSync(path, 'utf8')) };
}

/**
 * Vérifie que chaque fichier est couvert par une ligne de CREDITS.md, et seulement par des
 * lignes dont la licence est admise : une licence restrictive ne se rattrape pas par un motif
 * plus large.
 * @param {object} options
 * @param {string[]} options.files   chemins relatifs à couvrir
 * @param {Credits} options.credits
 * @param {string} options.rule      identifiant de règle des constats
 * @returns {{ errors: Finding[], warnings: Finding[] }}
 */
export function checkLicenseCoverage({ files, credits, rule }) {
  /** @type {Finding[]} */
  const errors = [];
  const allowed = ALLOWED_LICENSES.join(', ');

  if (!credits.present) {
    for (const rel of files) {
      errors.push(
        finding(rel, 0, rule, `aucune licence déclarée : ${CREDITS_FILE} est absent (licences admises : ${allowed})`),
      );
    }
    return { errors, warnings: [] };
  }

  /** @type {Map<CreditRow, string[]>} */
  const refused = new Map();
  for (const rel of files) {
    const rows = credits.rows.filter((row) => row.covers(rel));
    if (rows.length === 0) {
      errors.push(
        finding(rel, 0, rule, `aucune ligne de ${CREDITS_FILE} ne couvre ce fichier (licences admises : ${allowed})`),
      );
    }
    for (const row of rows) {
      if (row.allowed || licenseScopes(row.license).some((scope) => rel.startsWith(scope))) continue;
      const hits = refused.get(row) ?? [];
      hits.push(rel);
      refused.set(row, hits);
    }
  }
  for (const [row, hits] of refused) {
    errors.push(
      finding(
        CREDITS_FILE,
        row.line,
        rule,
        (row.scope !== null
          ? `licence « ${row.license} » admise sous ${licenseScopes(row.license).join(' et ')} seulement : `
          : `licence « ${row.license || 'vide'} » hors de la liste admise dans un dépôt public (${allowed}) : `) +
          `elle couvre ${countLabel(hits.length, 'fichier')}, par exemple ${hits[0]}`,
      ),
    );
  }
  return { errors, warnings: [] };
}
