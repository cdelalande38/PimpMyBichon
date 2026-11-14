#!/usr/bin/env node
// Capture de la page de contrôle des œuvres (src/dev/oeuvres/), servie par le serveur de
// développement. Chromium de Playwright en rendu logiciel, mêmes arguments que playwright.config.ts.
//
//   npx vite --port 5193 --strictPort                       (dans un autre terminal)
//   node assets-src/garage/outils/capturer.mjs               captures/deco/oeuvres.png
//   node assets-src/garage/outils/capturer.mjs --detail      + captures/deco/oeuvres-detail.png
//
// Options : --port <n> (5193), --sortie <dossier> (captures/deco). Le détail cadre la toile à
// 1100 pixels par mètre, un peu plus que la densité de sa texture : on y juge la netteté.

import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

function option(nom, defaut) {
  const i = process.argv.indexOf(nom);
  return i > 0 ? process.argv[i + 1] : defaut;
}

const port = option('--port', '5193');
const sortie = resolve(option('--sortie', 'captures/deco'));
// guard-ignore-next-line url-tierce : serveur de développement local, outil hors de l'app livrée
const page0 = `http://localhost:${port}/PimpMyBichon/src/dev/oeuvres/index.html`;
const vues = [{ fichier: 'oeuvres.png', requete: '', taille: { width: 1600, height: 1000 } }];
if (process.argv.includes('--detail')) {
  vues.push({ fichier: 'oeuvres-detail.png', requete: '?echelle=1100&centre=toile-pop-art', taille: { width: 900, height: 900 } });
}

mkdirSync(sortie, { recursive: true });
const navigateur = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
let code = 0;
try {
  for (const vue of vues) {
    const page = await navigateur.newPage({ viewport: vue.taille, deviceScaleFactor: 1 });
    const messages = [];
    page.on('console', (m) => messages.push(`${m.type()} : ${m.text()}`));
    const tiers = [];
    page.on('request', (r) => {
      const url = new URL(r.url());
      if (!['localhost', '127.0.0.1'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) tiers.push(r.url());
    });
    await page.goto(page0 + vue.requete);
    await page.waitForFunction(() => document.body.dataset.pret, null, { timeout: 60_000 });
    const etat = await page.evaluate(() => document.body.dataset.pret);
    // Deux images de plus : le dernier dessin posé est bien à l'écran.
    await page.evaluate(() => new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))));
    const cible = join(sortie, vue.fichier);
    await page.screenshot({ path: cible });
    console.log(`${etat === 'oui' ? 'ok   ' : 'ÉCHEC'} ${cible} (état : ${etat})`);
    for (const m of messages.filter((m) => !m.startsWith('debug') && !m.includes('[vite]'))) console.log(`  console ${m}`);
    if (tiers.length) console.log(`  requêtes vers un tiers : ${tiers.join(', ')}`);
    if (etat !== 'oui' || tiers.length) code = 1;
    await page.close();
  }
} finally {
  await navigateur.close();
}
process.exit(code);
