// @ts-check
// Partie commune des trois CLI : arguments, affichage, code de sortie.
//
//   0  aucune erreur (les avertissements ne font pas échouer)
//   1  au moins une règle enfreinte
//   2  mauvais usage de la commande, ou erreur inattendue

import { statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatReport } from './report.mjs';

/** @typedef {import('./report.mjs').Report} Report */

/** Racine du dépôt qui contient ces outils : deux niveaux au-dessus de tools/lib/. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Erreur d'usage : affichée avec l'aide, code de sortie 2. */
export class UsageError extends Error {}

/**
 * @typedef {object} ParsedArgs
 * @property {Set<string>} flags             options sans valeur présentes sur la ligne de commande
 * @property {Map<string, string[]>} values  options à valeur, dans l'ordre de saisie
 */

/**
 * @typedef {object} CliContext
 * @property {string} root      racine absolue de l'arbre à contrôler
 * @property {ParsedArgs} args
 */

/**
 * @typedef {object} CliDefinition
 * @property {string} name      nom de la commande, par exemple « guard »
 * @property {string} title     première ligne de la sortie lisible
 * @property {string[]} [help]  lignes d'aide des options propres à la commande
 * @property {string[]} [flags]   options sans valeur propres à la commande
 * @property {string[]} [values]  options à valeur propres à la commande
 * @property {(context: CliContext) => Report} check
 * @property {(args: ParsedArgs) => string[] | null} [maintenance]
 *   commande de maintenance : retourne les lignes à afficher, ou null si rien n'est demandé
 */

const COMMON_FLAGS = ['--json', '--help', '-h'];
const COMMON_VALUES = ['--root'];

/**
 * Lit la ligne de commande. Une option à valeur s'écrit « --nom valeur » ou « --nom=valeur ».
 * @param {string[]} argv
 * @param {{ flags: string[], values: string[] }} spec
 * @returns {ParsedArgs}
 */
export function parseArgs(argv, spec) {
  /** @type {ParsedArgs} */
  const parsed = { flags: new Set(), values: new Map() };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1;
    const name = equals === -1 ? arg : arg.slice(0, equals);
    if (spec.flags.includes(name)) {
      if (equals !== -1) throw new UsageError(`l'option ${name} ne prend pas de valeur`);
      parsed.flags.add(name);
    } else if (spec.values.includes(name)) {
      let value;
      if (equals === -1) {
        index += 1;
        value = argv[index];
      } else {
        value = arg.slice(equals + 1);
      }
      if (value === undefined || value === '') throw new UsageError(`l'option ${name} attend une valeur`);
      parsed.values.set(name, [...(parsed.values.get(name) ?? []), value]);
    } else {
      throw new UsageError(`argument inconnu : ${arg}`);
    }
  }
  return parsed;
}

/**
 * Dernière valeur donnée à une option.
 * @param {ParsedArgs} args
 * @param {string} name
 * @returns {string | undefined}
 */
export function lastValue(args, name) {
  return args.values.get(name)?.at(-1);
}

/**
 * Chemin tel qu'on l'affiche : relatif au dossier courant, jamais absolu (un chemin absolu
 * contient souvent un nom d'utilisateur).
 * @param {string} path
 */
export function displayPath(path) {
  return relative(process.cwd(), path).split('\\').join('/') || '.';
}

/** @param {CliDefinition} definition */
function usage(definition) {
  return [
    `Usage : node tools/${definition.name}.mjs [options]`,
    '',
    '  --root <dossier>   arbre à contrôler (par défaut : le dépôt qui contient cet outil)',
    '  --json             sortie machine (JSON) à la place de la sortie lisible',
    ...(definition.help ?? []),
    '  --help             affiche cette aide',
    '',
    'Codes de sortie : 0 aucune erreur, 1 règle enfreinte, 2 mauvais usage ou erreur inattendue.',
  ].join('\n');
}

/**
 * Exécute une CLI de contrôle : lit les arguments, lance le contrôle, affiche le rapport et
 * règle le code de sortie.
 * @param {CliDefinition} definition
 * @param {string[]} [argv]
 */
export function runCli(definition, argv = process.argv.slice(2)) {
  try {
    const args = parseArgs(argv, {
      flags: [...COMMON_FLAGS, ...(definition.flags ?? [])],
      values: [...COMMON_VALUES, ...(definition.values ?? [])],
    });
    if (args.flags.has('--help') || args.flags.has('-h')) {
      console.log(`${definition.title}\n\n${usage(definition)}`);
      return;
    }

    const lines = definition.maintenance ? definition.maintenance(args) : null;
    if (lines) {
      console.log(lines.join('\n'));
      return;
    }

    const root = resolve(lastValue(args, '--root') ?? REPO_ROOT);
    if (!statSync(root, { throwIfNoEntry: false })?.isDirectory()) {
      throw new UsageError(`racine introuvable : ${displayPath(root)}`);
    }

    const report = definition.check({ root, args });
    if (args.flags.has('--json')) {
      console.log(JSON.stringify({ tool: definition.name, ok: report.errors.length === 0, ...report }, null, 2));
    } else {
      console.log(formatReport(`${definition.title}\nracine : ${displayPath(root)}`, report));
    }
    process.exitCode = report.errors.length === 0 ? 0 : 1;
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`${definition.name} : ${error.message}\n\n${usage(definition)}`);
    } else {
      console.error(`${definition.name} : erreur inattendue`);
      console.error(error);
    }
    process.exitCode = 2;
  }
}
