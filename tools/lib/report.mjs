// @ts-check
// Constats et rapports communs aux trois contrôles du dépôt (guard, assets-check, audio-check).
// La logique de chaque contrôle retourne un rapport ; l'affichage et le code de sortie
// restent dans les CLI (voir cli.mjs).

/**
 * Un constat.
 * @typedef {object} Finding
 * @property {string} file     chemin relatif à la racine contrôlée, avec des « / » ; vide quand
 *                             le constat porte sur le dépôt entier
 * @property {number} line     numéro de ligne à partir de 1 ; 0 quand le constat porte sur le
 *                             fichier entier
 * @property {string} rule     identifiant court de la règle
 * @property {string} message  ce qui ne va pas, en français
 */

/**
 * Résultat d'un contrôle.
 * @typedef {object} Report
 * @property {Finding[]} errors    règles enfreintes : le contrôle échoue (code de sortie 1)
 * @property {Finding[]} warnings  à regarder, sans faire échouer
 * @property {Finding[]} notes     informations, dont ce qui n'est pas contrôlé à ce jalon
 */

/** Règle des notes qui disent ce qui reste hors contrôle. */
export const NOT_CHECKED_RULE = 'non-controle';

/** @returns {Report} */
export function createReport() {
  return { errors: [], warnings: [], notes: [] };
}

/**
 * @param {string} file
 * @param {number} line
 * @param {string} rule
 * @param {string} message
 * @returns {Finding}
 */
export function finding(file, line, rule, message) {
  return { file, line, rule, message };
}

/**
 * Note explicite pour ce qui n'est pas encore contrôlé : jamais de réduction silencieuse.
 * @param {string} what
 * @returns {Finding}
 */
export function notChecked(what) {
  return finding('', 0, NOT_CHECKED_RULE, `non contrôlé à ce jalon : ${what}`);
}

/**
 * Rapport partiel rendu par une étape d'un contrôle (les notes sont facultatives).
 * @typedef {{ errors: Finding[], warnings: Finding[], notes?: Finding[] }} PartialReport
 */

/**
 * Ajoute à `target` les constats des autres rapports.
 * @param {Report} target
 * @param {...PartialReport} others
 * @returns {Report}
 */
export function mergeInto(target, ...others) {
  for (const other of others) {
    target.errors.push(...other.errors);
    target.warnings.push(...other.warnings);
    target.notes.push(...(other.notes ?? []));
  }
  return target;
}

/**
 * Ordre stable d'affichage : par fichier, puis ligne, puis règle.
 * @param {Finding} a
 * @param {Finding} b
 */
function compareFindings(a, b) {
  if (a.file !== b.file) return a.file < b.file ? -1 : 1;
  if (a.line !== b.line) return a.line - b.line;
  if (a.rule !== b.rule) return a.rule < b.rule ? -1 : 1;
  if (a.message !== b.message) return a.message < b.message ? -1 : 1;
  return 0;
}

/**
 * Trie erreurs et avertissements. Les notes gardent l'ordre dans lequel le contrôle les a écrites.
 * @param {Report} report
 * @returns {Report}
 */
export function sortReport(report) {
  report.errors.sort(compareFindings);
  report.warnings.sort(compareFindings);
  return report;
}

/**
 * @param {number} count
 * @param {string} singular
 * @param {string} [plural]
 */
export function countLabel(count, singular, plural = `${singular}s`) {
  // En français, zéro s'accorde au singulier.
  return `${count} ${count < 2 ? singular : plural}`;
}

/**
 * Emplacement d'un constat : « chemin:ligne », « chemin » pour un fichier entier,
 * « (dépôt) » pour un constat global.
 * @param {Finding} item
 */
export function formatLocation(item) {
  if (!item.file) return '(dépôt)';
  return item.line > 0 ? `${item.file}:${item.line}` : item.file;
}

/**
 * Une ligne par constat : `chemin:ligne  règle  message`.
 * @param {Finding} item
 */
export function formatFinding(item) {
  return `${formatLocation(item)}  ${item.rule}  ${item.message}`;
}

/** @param {Report} report */
export function summarize(report) {
  const counts = [
    countLabel(report.errors.length, 'erreur'),
    countLabel(report.warnings.length, 'avertissement'),
    countLabel(report.notes.length, 'note'),
  ].join(', ');
  return `Bilan : ${counts} — ${report.errors.length === 0 ? 'OK' : 'ÉCHEC'}`;
}

/**
 * Sortie lisible complète d'un contrôle.
 * @param {string} title
 * @param {Report} report
 * @returns {string}
 */
export function formatReport(title, report) {
  const lines = [title];
  /** @type {Array<[string, Finding[]]>} */
  const sections = [
    ['Erreurs', report.errors],
    ['Avertissements', report.warnings],
    ['Notes', report.notes],
  ];
  for (const [heading, items] of sections) {
    if (items.length === 0) continue;
    lines.push('', `${heading} (${items.length})`);
    for (const item of items) lines.push(formatFinding(item));
  }
  lines.push('', summarize(report));
  return lines.join('\n');
}
