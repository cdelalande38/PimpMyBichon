// @ts-check
// Garde-fous du dépôt public. Assemble trois familles de règles :
//   a. requêtes vers un tiers                 third-party.mjs   code de l'app, puis build
//   b. noms de marques                        brands.mjs        app, tests, outils, docs, noms des GLB
//   c. données personnelles et identifiants   secrets.mjs       tous les fichiers texte
//
// « L'app » désigne src/, public/, assets-src/ et index.html. La règle des marques couvre aussi
// tests/, tools/ et docs/ (sauf l'exception nommée de BRAND_EXEMPT), et les noms écrits dans le
// JSON de chaque GLB de ce périmètre. Le prototype (proto/) n'est contrôlé que par la famille c.

import { readFileSync } from 'node:fs';
import { createBrandMatcher } from './brands.mjs';
import { walkTree } from './fs-walk.mjs';
import { namesOf, parseGlb } from './glb.mjs';
import { countLabel, createReport, finding, mergeInto, notChecked, sortReport } from './report.mjs';
import { findHomePaths, scanLineForSecrets, SECRET_RULES } from './secrets.mjs';
import { readTextFile, splitLines } from './text.mjs';
import { scanDistHosts, scanLineForUrls } from './third-party.mjs';

/** @typedef {import('./report.mjs').Report} Report */
/** @typedef {import('./brands.mjs').BrandHit} BrandHit */

/** Nom de la directive d'exception, à poser en commentaire sur la ligne qui précède. */
export const DIRECTIVE_NAME = 'guard-ignore-next-line';

/** Règles qu'une exception peut viser : celles qui portent sur une ligne de texte. */
export const LINE_RULES = Object.freeze(['url-tierce', 'marque', ...SECRET_RULES]);

/**
 * Une directive occupe seule sa ligne de commentaire (JS, CSS, JSX, YAML, HTML ou Markdown).
 * Citée au milieu d'une phrase ou d'une chaîne, elle n'a aucun effet.
 */
const DIRECTIVE_LINE = new RegExp(`^(?:\\/\\/+|\\/\\*+|\\*|\\{\\s*\\/\\*+|#+|<!--)\\s*${DIRECTIVE_NAME}(?![\\w-])(.*)$`);

/** Fin de commentaire à retirer de la raison. */
const COMMENT_CLOSER = /\s*(?:\*+\/\s*\}?|-->)\s*$/;

/**
 * Fichiers générés par un gestionnaire de paquets. Ils recopient des métadonnées de paquets
 * tiers (avis de dépréciation avec l'adresse de l'auteur) : la règle « email » ne s'y applique
 * pas. Les autres règles, identifiants compris, s'y appliquent.
 */
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml']);
const LOCKFILE_SKIPPED_RULES = new Set(['email']);

/**
 * @typedef {object} Directive
 * @property {string} rule
 * @property {string} reason
 */

/**
 * Lit une directive d'exception.
 * @param {string} line
 * @returns {Directive | { error: string } | null}  null si la ligne n'est pas une directive
 */
export function parseDirective(line) {
  const match = DIRECTIVE_LINE.exec(line.trim());
  if (!match) return null;
  const body = (match[1] ?? '').replace(COMMENT_CLOSER, '').trim();
  // « <règle> : <raison> » : le gabarit tel qu'on l'écrit dans une documentation.
  if (body.startsWith('<')) return null;

  const expected = `attendu « ${DIRECTIVE_NAME} <règle> : <raison> »`;
  const parts = /^([a-z][a-z0-9-]*)\s*:(.*)$/.exec(body);
  if (!parts) return { error: `exception mal formée : ${expected}` };
  const rule = parts[1] ?? '';
  const reason = (parts[2] ?? '').trim();
  if (!LINE_RULES.includes(rule)) {
    return { error: `exception refusée : règle « ${rule} » inconnue (règles : ${LINE_RULES.join(', ')})` };
  }
  if (!/[\p{L}\p{N}]/u.test(reason)) {
    return { error: `exception refusée : la raison est obligatoire (${expected})` };
  }
  return { rule, reason };
}

/**
 * Fichiers hors de la règle des marques, chacun avec sa raison. La présélection des sons cite les
 * titres des enregistrements tels que leurs auteurs les ont publiés : sans eux, la licence d'un
 * son ne se retrouve plus. Rien de ce fichier n'entre dans l'app.
 * @type {Readonly<Record<string, string>>}
 */
export const BRAND_EXEMPT = Object.freeze({
  'docs/SOURCING_AUDIO.md': 'titres d’enregistrements cités tels que publiés, pour retrouver leur licence ; rien n’entre dans l’app',
});

/** @param {string} rel */
export function isAppPath(rel) {
  // assets-src/ : dessins en attente, destinés à l'app. Ils reçoivent les mêmes contrôles qu'elle.
  return (
    rel === 'index.html' || rel.startsWith('src/') || rel.startsWith('public/') || rel.startsWith('assets-src/')
  );
}

/**
 * Périmètre de la règle des marques : l'app, les tests, les outils et la documentation.
 * @param {string} rel
 */
export function isBrandPath(rel) {
  if (Object.hasOwn(BRAND_EXEMPT, rel)) return false;
  return isAppPath(rel) || rel.startsWith('tests/') || rel.startsWith('tools/') || rel.startsWith('docs/');
}

/**
 * @param {BrandHit} hit
 * @param {string} [where]
 */
function brandMessage(hit, where = '') {
  return (
    `nom de marque « ${hit.term} »${where} (empreinte ${hit.hash.slice(0, 12)}…) : aucun nom de ` +
    "constructeur, d'équipementier, de sponsor, d'émission ou de jeu vidéo dans le dépôt (app, tests, outils, docs)"
  );
}

/**
 * Règle des marques sur les noms du JSON d'un GLB (nœuds, matériaux, maillages…), lisibles dans
 * le fichier livré. Un GLB illisible est laissé à assets-check (règle « modele »).
 * @param {Report} report
 * @param {string} rel
 * @param {string} abs
 * @param {(text: string) => BrandHit[]} matchBrands
 * @returns {boolean}  vrai si le JSON a pu être lu
 */
function scanGlbNames(report, rel, abs, matchBrands) {
  let parsed;
  try {
    parsed = parseGlb(new Uint8Array(readFileSync(abs)));
  } catch {
    return false;
  }
  if (!parsed.ok) return false;
  for (const { kind, index, name } of namesOf(parsed.container.json)) {
    for (const hit of matchBrands(name)) {
      report.errors.push(finding(rel, 0, 'marque', brandMessage(hit, ` dans le nom du ${kind} ${index} du GLB`)));
    }
  }
  return true;
}

/**
 * Contrôle un fichier texte ligne par ligne et applique les exceptions.
 * @param {Report} report
 * @param {string} rel
 * @param {string} text
 * @param {object} options
 * @param {boolean} options.inApp   règle des URL tierces
 * @param {boolean} options.brands  règle des marques
 * @param {ReadonlySet<string>} [options.skip]
 * @param {(line: string) => BrandHit[]} options.matchBrands
 */
function scanText(report, rel, text, { inApp, brands, skip, matchBrands }) {
  /** @type {Array<Directive & { line: number, used: boolean }>} */
  let pending = [];

  const settle = () => {
    for (const directive of pending) {
      if (directive.used) {
        report.notes.push(
          finding(rel, directive.line, 'exception', `règle « ${directive.rule} » ignorée à la ligne suivante : ${directive.reason}`),
        );
      } else {
        report.warnings.push(
          finding(
            rel,
            directive.line,
            'exception-inutile',
            `aucun constat « ${directive.rule} » sur la ligne suivante : exception à retirer`,
          ),
        );
      }
    }
    pending = [];
  };

  splitLines(text).forEach((line, index) => {
    const lineNumber = index + 1;
    /** @type {import('./secrets.mjs').LineHit[]} */
    const hits = [];
    if (line.trim() !== '') {
      hits.push(...scanLineForSecrets(line, skip));
      if (inApp) for (const message of scanLineForUrls(line)) hits.push({ rule: 'url-tierce', message });
      if (brands) for (const hit of matchBrands(line)) hits.push({ rule: 'marque', message: brandMessage(hit) });
    }

    const directive = parseDirective(line);
    if (directive) {
      // Une directive vise la prochaine ligne qui n'en est pas une : on peut en empiler
      // plusieurs. Sa propre ligne reste contrôlée, raison comprise.
      if ('error' in directive) report.errors.push(finding(rel, lineNumber, 'exception', directive.error));
      else pending.push({ ...directive, line: lineNumber, used: false });
      for (const hit of hits) report.errors.push(finding(rel, lineNumber, hit.rule, hit.message));
      return;
    }

    for (const hit of hits) {
      const exception = pending.find((item) => item.rule === hit.rule);
      if (exception) exception.used = true;
      else report.errors.push(finding(rel, lineNumber, hit.rule, hit.message));
    }
    settle();
  });
  settle();
}

/**
 * Lance le garde sur un arbre de travail.
 * @param {object} options
 * @param {string} options.root              racine du dépôt à contrôler
 * @param {Set<string>} options.brandHashes  empreintes des termes interdits
 * @returns {Report}
 */
export function runGuard({ root, brandHashes }) {
  const report = createReport();
  const matchBrands = createBrandMatcher(brandHashes);
  const tree = walkTree(root);

  let textFiles = 0;
  let appTextFiles = 0;
  let brandTextFiles = 0;
  let binaryFiles = 0;
  let glbFiles = 0;
  /** @type {string[]} */
  const lockfiles = [];
  /** @type {Set<string>} */
  const checkedDirs = new Set();

  for (const file of tree.files) {
    const inApp = isAppPath(file.rel);
    const brands = isBrandPath(file.rel);
    const segments = file.rel.split('/');

    if (brands) {
      // Les noms de fichiers et de dossiers font partie de l'app (un identifiant de véhicule
      // est un nom de dossier) : chaque nom est contrôlé une fois.
      let path = '';
      segments.forEach((segment, depth) => {
        path = path ? `${path}/${segment}` : segment;
        if (depth < segments.length - 1) {
          if (checkedDirs.has(path)) return;
          checkedDirs.add(path);
        }
        for (const hit of matchBrands(segment)) {
          report.errors.push(finding(path, 0, 'marque', brandMessage(hit, ' dans le nom')));
        }
      });
    }

    const text = readTextFile(file.abs);
    if (text === null) {
      binaryFiles += 1;
      if (brands && /\.glb$/i.test(file.rel) && scanGlbNames(report, file.rel, file.abs, matchBrands)) glbFiles += 1;
      continue;
    }
    textFiles += 1;
    if (inApp) appTextFiles += 1;
    if (brands) brandTextFiles += 1;
    const isLockfile = LOCKFILES.has(segments.at(-1) ?? '');
    if (isLockfile) lockfiles.push(file.rel);
    scanText(report, file.rel, text, {
      inApp,
      brands,
      skip: isLockfile ? LOCKFILE_SKIPPED_RULES : undefined,
      matchBrands,
    });
  }
  for (const [rel, reason] of Object.entries(BRAND_EXEMPT)) {
    if (tree.files.some((file) => file.rel === rel)) report.notes.push(finding(rel, 0, 'exception', `règle « marque » non appliquée : ${reason}`));
  }

  for (const link of tree.links) {
    // Git enregistre la cible d'un lien telle quelle : elle peut trahir un dossier personnel.
    for (const message of findHomePaths(link.target)) {
      report.errors.push(finding(link.rel, 0, 'chemin-perso', `cible du lien symbolique : ${message}`));
    }
    report.notes.push(finding(link.rel, 0, 'perimetre', 'lien symbolique non suivi'));
  }

  if (brandHashes.size === 0) {
    report.warnings.push(
      finding('', 0, 'marque', "liste d'empreintes vide : la règle « marque » ne contrôle rien"),
    );
  }
  report.notes.push(
    finding(
      '',
      0,
      'perimetre',
      `${countLabel(textFiles, 'fichier texte contrôlé', 'fichiers texte contrôlés')} (données personnelles et ` +
        `identifiants), dont ${appTextFiles} dans l'app (URL) et ${brandTextFiles} pour les marques ` +
        `(app, tests, outils, docs ; ${countLabel(brandHashes.size, 'empreinte')}) ; ` +
        `${glbFiles} GLB dont les noms sont contrôlés ; ` +
        `${countLabel(binaryFiles, 'fichier binaire', 'fichiers binaires')} dont le contenu n'est pas lu autrement`,
    ),
  );
  for (const rel of lockfiles) {
    report.notes.push(
      finding(rel, 0, 'perimetre', 'règle « email » non appliquée : fichier généré, métadonnées de paquets tiers'),
    );
  }
  mergeInto(report, scanDistHosts(root));
  report.notes.push(
    notChecked("requêtes dont l'adresse est calculée à l'exécution (seules les URL écrites en toutes lettres sont vues)"),
    notChecked(
      'contenu des fichiers binaires (textures des GLB, métadonnées des images et des sons ; seuls les noms du JSON des GLB sont lus), ' +
        'GLB produits après le garde (npm run vehicles:build) et prototype (proto/) pour les marques',
    ),
  );
  return sortReport(report);
}
