#!/usr/bin/env node
// @ts-check
// npm run audio:check — aucune synthèse dans la chaîne moteur ni dans la radio, manifestes
// engine.json valides, aucun fichier audio sans licence admise. La logique vit dans
// tools/lib/audio.mjs ; ce fichier ne fait que lire la ligne de commande.
// Mode d'emploi : tools/README.md.

import { runAudioCheck } from './lib/audio.mjs';
import { runCli } from './lib/cli.mjs';

runCli({
  name: 'audio-check',
  title: 'audio-check — audio (§ 9 et § 15 du cahier des charges)',
  check: ({ root }) => runAudioCheck({ root }),
});
