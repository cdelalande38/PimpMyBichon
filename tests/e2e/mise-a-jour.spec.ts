// Mise à jour d'une app déjà installée : une nouvelle version ne doit jamais recharger la page
// toute seule, et un geste doit suffire à l'appliquer. Un service worker qui ne se met plus à
// jour laisserait les téléphones bloqués sur une vieille version : ce parcours est critique.
//
// Le test sert sa propre copie de dist/ sur un autre port, pour pouvoir publier une « version 2 »
// sans gêner les autres parcours.

import { cpSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { expect, test } from '@playwright/test';
import { waitOfflineReady } from './helpers.ts';

const BASE_PATH = '/PimpMyBichon/';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
};

let siteDir: string;
let server: Server;
let origin: string;

test.beforeAll(async () => {
  siteDir = mkdtempSync(join(tmpdir(), 'pmb-maj-'));
  cpSync(resolve('dist'), siteDir, { recursive: true });

  server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith(BASE_PATH)) {
      response.writeHead(404).end();
      return;
    }
    const relative = url.pathname.slice(BASE_PATH.length) || 'index.html';
    const file = normalize(join(siteDir, relative));
    try {
      if (!file.startsWith(siteDir + sep) || !statSync(file).isFile()) throw new Error('absent');
      response.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        // Comme GitHub Pages : pas de cache long, le navigateur revalide.
        'cache-control': 'no-cache',
      });
      response.end(readFileSync(file));
    } catch {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(siteDir, { recursive: true, force: true });
});

test('une nouvelle version attend un geste, puis s’applique', async ({ page }) => {
  test.setTimeout(120_000);
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });

  await page.goto(`${origin}${BASE_PATH}`);
  await waitOfflineReady(page);
  await expect(page.getByText('Nouvelle version de l’atelier prête.')).toBeHidden();
  expect(loads).toBe(1);

  // Publication d'une « version 2 » : le fichier du service worker change d'un octet.
  const swPath = join(siteDir, 'sw.js');
  writeFileSync(swPath, `${readFileSync(swPath, 'utf8')}\n// version 2\n`);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });

  // La nouvelle version est prête, mais la page n'a pas bougé.
  await expect(page.getByText('Nouvelle version de l’atelier prête.')).toBeVisible({
    timeout: 30_000,
  });
  expect(loads).toBe(1);
  const waiting = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return Boolean(registration?.waiting);
  });
  expect(waiting).toBe(true);

  // Un geste : la version en attente prend la main et la page se recharge une fois.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Recharger' }).click();
  await reloaded;
  await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
  await waitOfflineReady(page);
  await expect(page.getByText('Nouvelle version de l’atelier prête.')).toBeHidden();
  expect(loads).toBe(2);

  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return {
      waiting: Boolean(registration?.waiting),
      controlled: Boolean(navigator.serviceWorker.controller),
      script: registration?.active?.scriptURL ?? '',
    };
  });
  expect(state.waiting).toBe(false);
  expect(state.controlled).toBe(true);
  expect(state.script).toContain(`${BASE_PATH}sw.js`);
});
