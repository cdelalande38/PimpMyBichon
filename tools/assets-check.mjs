#!/usr/bin/env node
// @ts-check
// npm run assets:check — sources lourdes, licences déclarées dans CREDITS.md, budgets de poids,
// structure des dossiers de véhicules. La logique vit dans tools/lib/assets.mjs ; ce fichier ne
// fait que lire la ligne de commande. Mode d'emploi : tools/README.md.

import { runAssetsCheck } from './lib/assets.mjs';
import { runCli } from './lib/cli.mjs';

runCli({
  name: 'assets-check',
  title: 'assets-check — assets et budgets (§ 8, § 11 et § 15 du cahier des charges)',
  check: ({ root }) => runAssetsCheck({ root }),
});
