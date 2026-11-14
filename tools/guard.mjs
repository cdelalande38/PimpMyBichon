#!/usr/bin/env node
// @ts-check
// npm run guard — garde-fous du dépôt public : requêtes vers un tiers, noms de marques,
// données personnelles et identifiants. La logique vit dans tools/lib/ ; ce fichier ne fait
// que lire la ligne de commande. Mode d'emploi : tools/README.md.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { addBrandTerm, loadBrandHashes } from './lib/brands.mjs';
import { displayPath, lastValue, REPO_ROOT, runCli, UsageError } from './lib/cli.mjs';
import { runGuard } from './lib/guard.mjs';

/** @typedef {import('./lib/cli.mjs').ParsedArgs} ParsedArgs */

/** Liste d'empreintes livrée avec l'outil. */
const DEFAULT_BRANDS_FILE = resolve(REPO_ROOT, 'tools', 'guard-brands.sha256');

/** @param {ParsedArgs} args */
function brandsFile(args) {
  return resolve(lastValue(args, '--brands') ?? DEFAULT_BRANDS_FILE);
}

/**
 * Commande de maintenance : ajoute des termes à la liste d'empreintes.
 * @param {ParsedArgs} args
 * @returns {string[] | null}
 */
function addBrands(args) {
  const terms = args.values.get('--add-brand');
  if (!terms) return null;
  const file = brandsFile(args);
  /** @type {string[]} */
  const lines = [];
  let total = 0;
  for (const term of terms) {
    const result = addBrandTerm(file, term);
    total = result.total;
    if (result.forms.length === 0) throw new UsageError('terme refusé : ni lettre ni chiffre');
    if (result.forms.every((item) => item.status === 'rejected')) {
      throw new UsageError(`terme refusé : ${result.forms.map((item) => `« ${item.form} » (${item.reason})`).join(', ')}`);
    }
    for (const item of result.forms) {
      const status = {
        added: 'empreinte ajoutée',
        present: 'déjà dans la liste',
        rejected: `forme écartée (${item.reason})`,
      }[item.status];
      lines.push(`« ${item.form} » : ${status} — ${item.hash.slice(0, 12)}…`);
    }
  }
  lines.push(`${total} empreintes dans ${displayPath(file)}`);
  return lines;
}

runCli({
  name: 'guard',
  title: 'guard — garde-fous du dépôt public',
  values: ['--brands', '--add-brand'],
  help: [
    "  --brands <fichier>     liste d'empreintes à utiliser (par défaut : tools/guard-brands.sha256)",
    '  --add-brand "<terme>"  ajoute un terme interdit à la liste, sans lancer le contrôle',
  ],
  maintenance: addBrands,
  check({ root, args }) {
    const file = brandsFile(args);
    if (!existsSync(file)) throw new UsageError(`liste d'empreintes introuvable : ${displayPath(file)}`);
    return runGuard({ root, brandHashes: loadBrandHashes(file) });
  },
});
