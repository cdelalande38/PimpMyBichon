// @ts-check
// Motifs de chemins de CREDITS.md : un sous-ensemble des globs, sans dépendance.
//
//   **        n'importe quelle suite de dossiers (y compris aucun)
//   *         n'importe quoi dans un seul nom de fichier ou de dossier
//   ?         un caractère, sauf « / »
//   {a,b}     l'une des variantes (sans imbrication)
//
// Un chemin sans joker couvre le fichier de ce nom, ou tout le contenu du dossier de ce nom.
// Les motifs sont relatifs à la racine du dépôt et sensibles à la casse.

const MAGIC = /[*?{]/;

/**
 * Met un motif en forme : « / » partout, pas de « ./ » ni de « / » en tête.
 * @param {string} raw
 * @returns {string}
 */
export function normalizePattern(raw) {
  return raw
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^(?:\.\/)+/, '')
    .replace(/^\/+/, '');
}

/** @param {string} text */
function escapeRegExp(text) {
  return text.replace(/[.+^$()|[\]{}\\]/g, '\\$&');
}

/**
 * Traduit un motif (déjà normalisé) en source d'expression régulière, sans les ancres.
 * @param {string} pattern
 * @param {boolean} allowBraces
 * @returns {string}
 */
function translate(pattern, allowBraces) {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern.charAt(index);
    if (char === '*' && pattern.charAt(index + 1) === '*') {
      const atSegmentStart = index === 0 || pattern.charAt(index - 1) === '/';
      const next = pattern.charAt(index + 2);
      if (atSegmentStart && next === '/') {
        // « **/ » : zéro, un ou plusieurs dossiers.
        source += '(?:[^/]+/)*';
        index += 3;
      } else {
        // « ** » en fin de motif ou collé à du texte : tout, « / » compris.
        source += '.*';
        index += 2;
      }
    } else if (char === '*') {
      source += '[^/]*';
      index += 1;
    } else if (char === '?') {
      source += '[^/]';
      index += 1;
    } else if (char === '{' && allowBraces && pattern.indexOf('}', index) !== -1) {
      const end = pattern.indexOf('}', index);
      const variants = pattern.slice(index + 1, end).split(',');
      source += `(?:${variants.map((variant) => translate(variant, false)).join('|')})`;
      index = end + 1;
    } else {
      source += escapeRegExp(char);
      index += 1;
    }
  }
  return source;
}

/**
 * Prépare un motif : retourne la fonction qui dit si un chemin relatif est couvert.
 * @param {string} raw
 * @returns {(rel: string) => boolean}
 */
export function createPathMatcher(raw) {
  const pattern = normalizePattern(raw);
  if (pattern === '') return () => false;

  if (!MAGIC.test(pattern)) {
    // Chemin littéral : le fichier lui-même, ou le dossier et tout ce qu'il contient.
    const dir = pattern.endsWith('/') ? pattern : `${pattern}/`;
    const file = pattern.replace(/\/+$/, '');
    return (rel) => rel === file || rel.startsWith(dir);
  }

  // Un motif qui finit par « / » désigne un dossier : tout son contenu est couvert.
  const full = pattern.endsWith('/') ? `${pattern}**` : pattern;
  const regexp = new RegExp(`^${translate(full, true)}$`);
  return (rel) => regexp.test(rel);
}

/**
 * @param {string} pattern
 * @param {string} rel
 */
export function matchesPath(pattern, rel) {
  return createPathMatcher(pattern)(rel);
}
