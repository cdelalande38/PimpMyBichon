// @ts-check
// Règles « données personnelles » et « identifiants » du garde, appliquées ligne par ligne à
// tous les fichiers texte du dépôt : le dépôt est public, tout ce qui y entre est visible.
//
// Le garde contrôle aussi ce fichier. Les motifs sont écrits de sorte qu'aucun ne se
// reconnaisse lui-même, et aucun exemple réaliste ne figure en commentaire : les formats sont
// décrits avec L pour une lettre et C pour un chiffre.
//
// Les messages ne recopient jamais la valeur trouvée en entier : la sortie du garde finit
// dans des journaux de CI publics.

/**
 * @typedef {object} LineHit
 * @property {string} rule
 * @property {string} message
 */

/** Identifiants des règles de ce fichier, dans l'ordre d'application. */
export const SECRET_RULES = Object.freeze([
  'email',
  'telephone',
  'plaque',
  'chemin-perso',
  'cle-privee',
  'jeton-forge',
  'cle-api',
]);

// --- Adresses e-mail -----------------------------------------------------------------------

const EMAIL_LOCAL_TAIL = /[A-Za-z0-9._%+-]+$/;
const EMAIL_DOMAIN_HEAD = /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/;

/** Domaines réservés aux exemples et à la documentation (RFC 2606). */
const EXAMPLE_DOMAINS = ['example.com', 'example.org', 'example.net'];

/** Extensions réservées aux essais (RFC 2606 et RFC 6761) : aucune adresse réelle n'y vit. */
const RESERVED_TLDS = new Set(['test', 'invalid', 'example', 'localhost']);

/**
 * Comptes techniques, qui n'identifient personne : expéditeur automatique, et utilisateur SSH
 * commun à toutes les forges (« git@hôte:compte/dépôt »).
 */
const TECHNICAL_LOCAL_PARTS = new Set(['noreply', 'no-reply', 'git']);

/**
 * Extensions de fichier qui ne sont pas des domaines de premier niveau : « icone@2x.png »
 * est un nom de fichier, pas une adresse.
 */
const FILE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx',
  'jsx', 'json', 'html', 'htm', 'glb', 'gltf', 'woff', 'ttf', 'otf', 'opus', 'ogg', 'map', 'txt',
  'yml', 'yaml', 'lock',
]);

/**
 * On part de chaque « @ » et on regarde autour : pas d'expression régulière qui balaie la
 * ligne entière, donc pas de temps quadratique sur une ligne de plusieurs mégaoctets.
 * @param {string} line
 * @returns {string[]}
 */
function findEmails(line) {
  /** @type {string[]} */
  const messages = [];
  for (let at = line.indexOf('@'); at !== -1; at = line.indexOf('@', at + 1)) {
    const before = line.slice(Math.max(0, at - 64), at);
    const local = (EMAIL_LOCAL_TAIL.exec(before)?.[0] ?? '').replace(/^[.%+-]+/, '');
    if (local === '') continue;

    const labels = (EMAIL_DOMAIN_HEAD.exec(line.slice(at + 1, at + 256))?.[0] ?? '').split('.');
    // Le domaine finit par une extension faite de lettres : on retire ce qui dépasse.
    while (labels.length > 0 && !/^[A-Za-z]{2,}$/.test(labels.at(-1) ?? '')) labels.pop();
    if (labels.length < 2) continue;
    const tld = (labels.at(-1) ?? '').toLowerCase();
    const domain = labels.join('.').toLowerCase();

    // « paquet@1.2.3-beta.x » : un numéro de version, pas un domaine.
    if (/^\d+$/.test(labels[0] ?? '') && /^\d/.test(labels[1] ?? '')) continue;
    if (FILE_EXTENSIONS.has(tld)) continue;
    if (RESERVED_TLDS.has(tld)) continue;
    if (EXAMPLE_DOMAINS.some((example) => domain === example || domain.endsWith(`.${example}`))) continue;
    if (TECHNICAL_LOCAL_PARTS.has(local.toLowerCase())) continue;

    messages.push(`adresse e-mail « ${local.charAt(0)}…@${domain} »`);
  }
  return messages;
}

// --- Numéros de téléphone français ---------------------------------------------------------

/**
 * Format national : dix chiffres commençant par zéro puis un chiffre de 1 à 9, d'un seul
 * tenant ou en cinq paires séparées par un même caractère (espace, point ou tiret).
 * Le motif refuse ce qui prolonge une suite de nombres plus longue, et les décimales.
 */
const PHONE_NATIONAL = /(?<![\w.,+-]|\d[ .-])0[1-9]([ .-]?)\d{2}(?:\1\d{2}){3}(?![\w-]|[.,]\d|\1\d)/g;

/** Format international : indicatif de la France, zéro entre parenthèses facultatif. */
const PHONE_INTERNATIONAL = /(?<![\w.+])(?:\+|00)33[ .-]?(?:\(0\)[ .-]?)?[1-9](?:[ .-]?\d{2}){4}(?!\w)/g;

/** Les dix chiffres dans l'ordre : un alphabet de travail, pas un numéro. */
const DIGIT_ALPHABET = Array.from({ length: 10 }, (_, digit) => String(digit)).join('');

/**
 * @param {string} line
 * @returns {string[]}
 */
function findPhones(line) {
  /** @type {string[]} */
  const messages = [];
  for (const pattern of [PHONE_NATIONAL, PHONE_INTERNATIONAL]) {
    for (const match of line.matchAll(pattern)) {
      if (match[0] === DIGIT_ALPHABET) continue;
      const digits = match[0].replace(/\D/g, '');
      messages.push(`numéro de téléphone « ${digits.slice(0, 2)}…${digits.slice(-2)} »`);
    }
  }
  return messages;
}

// --- Plaques d'immatriculation françaises --------------------------------------------------

/** Format en vigueur : LL-CCC-LL, en capitales, avec ses tirets. */
const PLATE_CURRENT = /(?<![A-Za-z0-9-])[A-Z]{2}-\d{3}-[A-Z]{2}(?![A-Za-z0-9-])/g;

/** Ancien format : deux à quatre chiffres, deux ou trois capitales, deux chiffres (CCCC LL CC). */
const PLATE_FORMER = /(?<![A-Za-z0-9.,:/-]|\d )\d{2,4} [A-Z]{2,3} \d{2}(?![A-Za-z0-9:/-]|[.,]\d| \d)/g;

/**
 * @param {string} line
 * @returns {string[]}
 */
function findPlates(line) {
  /** @type {string[]} */
  const messages = [];
  for (const pattern of [PLATE_CURRENT, PLATE_FORMER]) {
    for (const match of line.matchAll(pattern)) {
      messages.push(`plaque d'immatriculation « ${match[0].slice(0, 2)}…${match[0].slice(-2)} »`);
    }
  }
  return messages;
}

// --- Chemins de dossier personnel ----------------------------------------------------------

/** Dossier personnel sous Linux ou macOS. Un chemin d'URL (« site/home/page ») n'en est pas un. */
const HOME_PATH = /(?<![\w.~-])\/(?:home|Users)\/([A-Za-z0-9][A-Za-z0-9._-]*)(?=[/"'`\s)\]}>,;:]|$)/g;

/** Dossier personnel sous Windows, barres obliques inverses simples ou doublées (JSON). */
const WINDOWS_HOME_PATH = /(?<![A-Za-z0-9])[A-Za-z]:\\{1,2}Users\\{1,2}([^\\/:*?"<>|\s]+)/g;

/**
 * Comptes génériques : machines de CI, images de conteneur, dossiers partagés du système,
 * noms de remplissage de la documentation. Aucun ne désigne une personne.
 */
const GENERIC_ACCOUNTS = new Set(['runner', 'user', 'username', 'node', 'ubuntu', 'vscode', 'shared', 'public']);

/**
 * @param {string} text
 * @returns {string[]}
 */
export function findHomePaths(text) {
  /** @type {string[]} */
  const messages = [];
  for (const pattern of [HOME_PATH, WINDOWS_HOME_PATH]) {
    for (const match of text.matchAll(pattern)) {
      const name = match[1] ?? '';
      if (GENERIC_ACCOUNTS.has(name.toLowerCase())) continue;
      const prefix = match[0].slice(0, match[0].length - name.length);
      messages.push(`chemin de dossier personnel « ${prefix}${name.charAt(0)}… »`);
    }
  }
  return messages;
}

// --- Clés privées --------------------------------------------------------------------------

/** En-tête d'un bloc PEM de clé privée, quel que soit l'algorithme. */
const PEM_PRIVATE_KEY = new RegExp('-{5}BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-{5}');

// --- Jetons et clés reconnaissables à leur forme -------------------------------------------

/**
 * @typedef {object} TokenPattern
 * @property {string} label
 * @property {RegExp} pattern
 */

/**
 * Jetons d'accès des forges logicielles, reconnaissables à leur préfixe.
 * @type {TokenPattern[]}
 */
const FORGE_TOKENS = [
  { label: "jeton d'accès GitHub", pattern: /(?<![A-Za-z0-9_])gh[pousr]_[A-Za-z0-9]{30,}/g },
  { label: "jeton d'accès GitHub à portée fine", pattern: /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{40,}/g },
  {
    label: "jeton d'accès GitLab",
    pattern: /(?<![A-Za-z0-9_])gl(?:pat|dt|rt|cbt|ptt|ft|imt|soat)-[A-Za-z0-9_-]{20,}/g,
  },
  { label: "mot de passe d'application Bitbucket", pattern: /(?<![A-Za-z0-9_])ATBB[A-Za-z0-9_=-]{28,}/g },
];

/**
 * Clés d'API de services courants, reconnaissables à leur préfixe ou à leur structure.
 * @type {TokenPattern[]}
 */
const API_KEYS = [
  { label: "clé d'accès AWS", pattern: /(?<![A-Za-z0-9])A[KS]IA[0-9A-Z]{16}(?![A-Za-z0-9])/g },
  { label: "clé d'API Google", pattern: /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}(?![A-Za-z0-9_-])/g },
  { label: 'jeton Slack', pattern: /(?<![A-Za-z0-9])xox[abeoprs]-[A-Za-z0-9-]{10,}/g },
  { label: 'clé secrète Stripe', pattern: /(?<![A-Za-z0-9])[sr]k_live_[A-Za-z0-9]{20,}/g },
  {
    label: "clé d'API à préfixe « sk- »",
    pattern: /(?<![A-Za-z0-9])sk-(?:(?:ant|proj|svcacct)-[A-Za-z0-9_-]{32,}|[A-Za-z0-9]{32,})/g,
  },
  { label: "jeton d'accès npm", pattern: /(?<![A-Za-z0-9])npm_[A-Za-z0-9]{36}(?![A-Za-z0-9])/g },
  {
    label: 'jeton signé (JWT)',
    pattern: /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  },
  { label: "jeton d'authentification d'un registre npm", pattern: /_authToken\s*=\s*(?!\$\{)[^\s"']{8,}/g },
];

/**
 * @param {string} line
 * @param {TokenPattern[]} patterns
 * @returns {string[]}
 */
function findTokens(line, patterns) {
  /** @type {string[]} */
  const messages = [];
  for (const { label, pattern } of patterns) {
    for (const match of line.matchAll(pattern)) {
      messages.push(`${label} (${match[0].length} caractères, début « ${match[0].slice(0, 4)}… »)`);
    }
  }
  return messages;
}

/**
 * Valeur littérale affectée à un nom qui annonce un secret. On ne retient que l'évident :
 * une valeur d'au moins vingt caractères qui a l'allure d'une clé tirée au hasard.
 */
const SECRET_NAME =
  '(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|private[_-]?key|passwor[dt]|passwd|mot[_-]?de[_-]?passe)';
const SECRET_ASSIGNMENT = new RegExp(
  `(${SECRET_NAME}[A-Za-z0-9_]*)["']?\\s*[:=]\\s*["'\`]([A-Za-z0-9+/_=.-]{20,})["'\`]`,
  'gi',
);

/**
 * Une clé tirée au hasard mélange majuscules, minuscules et chiffres, ou bien c'est une
 * longue suite hexadécimale. Un identifiant lisible (« reglages-atelier-v1 ») ne passe pas.
 * @param {string} value
 */
function looksRandom(value) {
  if (new Set(value).size < 8) return false;
  if (/^[0-9a-f]{32,}$/i.test(value)) return /\d/.test(value) && /[a-f]/i.test(value);
  return /[A-Z]/.test(value) && /[a-z]/.test(value) && /\d/.test(value);
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function findAssignedSecrets(line) {
  /** @type {string[]} */
  const messages = [];
  for (const match of line.matchAll(SECRET_ASSIGNMENT)) {
    const value = match[2] ?? '';
    if (!looksRandom(value)) continue;
    messages.push(`valeur secrète affectée à « ${match[1] ?? ''} » (${value.length} caractères)`);
  }
  return messages;
}

// --- Point d'entrée ------------------------------------------------------------------------

/**
 * Applique à une ligne les règles sur les données personnelles et les identifiants.
 * @param {string} line
 * @param {ReadonlySet<string>} [skip]  règles à ne pas appliquer à ce fichier
 * @returns {LineHit[]}
 */
export function scanLineForSecrets(line, skip) {
  /** @type {LineHit[]} */
  const hits = [];
  /**
   * @param {string} rule
   * @param {() => string[]} find
   */
  const apply = (rule, find) => {
    if (skip?.has(rule)) return;
    for (const message of find()) hits.push({ rule, message });
  };

  apply('email', () => findEmails(line));
  apply('telephone', () => findPhones(line));
  apply('plaque', () => findPlates(line));
  apply('chemin-perso', () => findHomePaths(line));
  apply('cle-privee', () => (PEM_PRIVATE_KEY.test(line) ? ['bloc de clé privée au format PEM'] : []));
  apply('jeton-forge', () => findTokens(line, FORGE_TOKENS));
  apply('cle-api', () => [...findTokens(line, API_KEYS), ...findAssignedSecrets(line)]);
  return hits;
}
