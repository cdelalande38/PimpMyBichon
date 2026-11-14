// @ts-check
// Règle « marque » du garde : aucun nom de constructeur, d'équipementier, de sponsor,
// d'émission ou de jeu vidéo dans l'app.
//
// La liste d'interdits ne figure nulle part en clair dans le dépôt : seules les empreintes
// SHA-256 des termes normalisés sont versionnées (guard-brands.sha256). Le scan découpe le
// texte en mots, normalise, et compare l'empreinte de chaque suite de un, deux ou trois mots.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

/** Un terme interdit fait au plus trois mots : le scan ne teste pas de suite plus longue. */
export const MAX_WORDS = 3;

/** Longueur minimale d'un terme, espaces non comptés : plus court, il se confond avec du code. */
export const MIN_LENGTH = 3;

const HASH_LINE = /^[0-9a-f]{64}$/;

const FILE_HEADER = [
  '# Empreintes SHA-256 des termes interdits par la règle « marque » de tools/guard.mjs.',
  '# Une empreinte par ligne, celle du terme normalisé (minuscules, sans accents, espaces simples).',
  '# La liste en clair ne doit pas entrer dans le dépôt. Pour ajouter un terme :',
  '#   node tools/guard.mjs --add-brand "<terme>"',
];

/** Suite de lettres et de chiffres : la matière première d'un mot. */
const RUN = /[\p{L}\p{N}]+/gu;

/**
 * Découpe d'une suite aux frontières de casse et de chiffres, comme dans un identifiant :
 * « jantesTruc8 » → jantes, Truc, 8 ; « XYZLogo » → XYZ, Logo.
 */
const PART = /\p{Lu}+(?=\p{Lu}\p{Ll})|\p{Lu}?\p{Ll}+|\p{Lu}+|\p{N}+|\p{L}+/gu;

/** Bloc encodé (base64, base64url) : du bruit, pas des mots. */
const ENCODED_RUN = /[A-Za-z0-9+/_=-]{64,}/g;

/**
 * Un bloc encodé mélange majuscules, minuscules et chiffres en proportions qu'un chemin ou
 * un identifiant n'atteint pas. Découpé en « mots », il produirait des faux positifs au hasard.
 * @param {string} run
 */
function isEncodedBlob(run) {
  let upper = 0;
  let lower = 0;
  let digits = 0;
  for (let index = 0; index < run.length; index += 1) {
    const code = run.charCodeAt(index);
    if (code >= 65 && code <= 90) upper += 1;
    else if (code >= 97 && code <= 122) lower += 1;
    else if (code >= 48 && code <= 57) digits += 1;
  }
  return upper >= run.length * 0.2 && lower >= run.length * 0.2 && digits >= run.length * 0.04;
}

/**
 * Découpe un texte en mots normalisés : sans accents, en minuscules.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const plain = text
    .replace(ENCODED_RUN, (run) => (isEncodedBlob(run) ? ' ' : run))
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '');
  /** @type {string[]} */
  const words = [];
  for (const run of plain.match(RUN) ?? []) {
    for (const part of run.match(PART) ?? []) words.push(part.toLowerCase());
  }
  return words;
}

/**
 * Formes normalisées sous lesquelles un terme peut apparaître dans le texte scanné.
 * Un terme à majuscules internes en a deux : découpé comme il s'écrit, et d'un seul tenant
 * quand il est écrit tout en minuscules ou tout en capitales.
 * @param {string} term
 * @returns {string[]}
 */
export function brandForms(term) {
  const forms = new Set([tokenize(term).join(' '), tokenize(term.toLowerCase()).join(' ')]);
  forms.delete('');
  return [...forms];
}

/**
 * Dit pourquoi une forme ne peut pas entrer dans la liste, ou null si elle convient.
 * @param {string} form
 * @returns {string | null}
 */
export function rejectionReason(form) {
  const words = form.split(' ');
  if (words.length > MAX_WORDS) {
    return `${words.length} mots : le scan ne teste pas plus de ${MAX_WORDS} mots à la suite`;
  }
  const compact = words.join('');
  if (compact.length < MIN_LENGTH) return `moins de ${MIN_LENGTH} caractères : trop ambigu`;
  if ((compact.match(/\p{L}/gu) ?? []).length < 2) return 'moins de deux lettres : trop ambigu';
  return null;
}

/**
 * Empreinte d'une forme normalisée.
 * @param {string} form
 */
export function hashForm(form) {
  return createHash('sha256').update(form, 'utf8').digest('hex');
}

/**
 * Lit le contenu d'un fichier d'empreintes. Les lignes vides et les commentaires (#) sont ignorés.
 * @param {string} content
 * @returns {Set<string>}
 */
export function parseHashList(content) {
  /** @type {Set<string>} */
  const hashes = new Set();
  content.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    if (!HASH_LINE.test(line)) {
      throw new Error(`ligne ${index + 1} : attendu une empreinte SHA-256 (64 chiffres hexadécimaux en minuscules)`);
    }
    hashes.add(line);
  });
  return hashes;
}

/**
 * @param {string} file
 * @returns {Set<string>}
 */
export function loadBrandHashes(file) {
  return parseHashList(readFileSync(file, 'utf8'));
}

/**
 * @typedef {object} AddedForm
 * @property {string} form
 * @property {string} hash
 * @property {'added' | 'present' | 'rejected'} status
 * @property {string} [reason]  pourquoi la forme est refusée
 */

/**
 * Ajoute un terme à la liste d'empreintes (commande de maintenance --add-brand).
 * Le fichier est réécrit trié : l'ordre des lignes ne dit rien de l'ordre des ajouts.
 * @param {string} file
 * @param {string} term
 * @returns {{ forms: AddedForm[], total: number }}
 */
export function addBrandTerm(file, term) {
  const existing = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const hashes = parseHashList(existing);
  const header = existing.split(/\r?\n/).filter((line) => line.trim().startsWith('#'));

  /** @type {AddedForm[]} */
  const forms = brandForms(term).map((form) => {
    const hash = hashForm(form);
    const reason = rejectionReason(form);
    if (reason) return { form, hash, status: 'rejected', reason };
    if (hashes.has(hash)) return { form, hash, status: 'present' };
    hashes.add(hash);
    return { form, hash, status: 'added' };
  });

  if (forms.some((item) => item.status === 'added')) {
    const lines = [...(header.length > 0 ? header : FILE_HEADER), ...[...hashes].sort()];
    writeFileSync(file, `${lines.join('\n')}\n`);
  }
  return { forms, total: hashes.size };
}

/**
 * @typedef {object} BrandHit
 * @property {string} term  la suite de mots normalisée qui correspond à un terme interdit
 * @property {string} hash  son empreinte, pour retrouver la ligne dans la liste
 */

/**
 * Prépare le scan d'une liste d'empreintes.
 * @param {Set<string>} hashes
 * @returns {(text: string) => BrandHit[]}  les termes interdits trouvés dans un texte (une ligne)
 */
export function createBrandMatcher(hashes) {
  // Le même mot revient sans cesse dans du code : on ne calcule son empreinte qu'une fois.
  /** @type {Map<string, string | null>} */
  const cache = new Map();

  /** @param {string} candidate */
  const lookup = (candidate) => {
    const known = cache.get(candidate);
    if (known !== undefined) return known;
    const hash = hashForm(candidate);
    const result = hashes.has(hash) ? hash : null;
    if (cache.size >= 200_000) cache.clear();
    cache.set(candidate, result);
    return result;
  };

  return (text) => {
    if (hashes.size === 0) return [];
    const words = tokenize(text);
    /** @type {Array<BrandHit & { start: number, size: number }>} */
    const hits = [];
    // Du plus long au plus court : un terme de trois mots l'emporte sur le mot qu'il contient.
    for (let size = MAX_WORDS; size >= 1; size -= 1) {
      for (let start = 0; start + size <= words.length; start += 1) {
        const candidate = words.slice(start, start + size).join(' ');
        if (candidate.length - (size - 1) < MIN_LENGTH) continue;
        if (hits.some((hit) => start >= hit.start && start + size <= hit.start + hit.size)) continue;
        const hash = lookup(candidate);
        if (hash) hits.push({ term: candidate, hash, start, size });
      }
    }
    /** @type {Map<string, BrandHit>} */
    const unique = new Map();
    for (const { term, hash } of hits.sort((a, b) => a.start - b.start)) unique.set(term, { term, hash });
    return [...unique.values()];
  };
}
