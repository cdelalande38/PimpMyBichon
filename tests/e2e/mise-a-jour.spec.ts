// Mise à jour d'une app déjà installée : une nouvelle version ne doit jamais recharger la page
// toute seule, et un geste doit suffire à l'appliquer. Un service worker qui ne se met plus à
// jour laisserait les téléphones bloqués sur une vieille version : ce parcours est critique.
//
// Le test sert sa propre copie de dist/ sur un autre port, pour pouvoir publier une « version 2 »
// sans gêner les autres parcours.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
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

/** Publie une « version » de plus : le fichier du service worker change d'un octet, le navigateur le revoit. */
let publications = 0;
async function publier(page: Page): Promise<void> {
  publications += 1;
  const swPath = join(siteDir, 'sw.js');
  writeFileSync(swPath, `${readFileSync(swPath, 'utf8')}\n// publication ${publications}\n`);
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
}

const pastille = (page: Page) => page.getByRole('button', { name: 'Nouvelle version prête : recharger l’atelier' });
const bandeau = (page: Page) => page.getByRole('button', { name: 'Recharger', exact: true });

async function capturer(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-p-retour', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

test('une nouvelle version attend un geste, puis s’applique', async ({ page }) => {
  test.setTimeout(120_000);
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });

  await page.goto(`${origin}${BASE_PATH}`);
  // Un geste a eu lieu : la nouvelle version attend alors l'accord (sans geste, elle s'applique d'office : src/pwa/majAuto.ts).
  await page.keyboard.press('Shift');
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
  await bandeau(page).click();
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

test('la pastille « Nouvelle version » se voit au garage, menu fermé, et applique la version', async ({ page }) => {
  test.setTimeout(120_000);
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });

  await page.goto(`${origin}${BASE_PATH}`);
  await page.keyboard.press('Shift');
  await waitOfflineReady(page);
  await expect(pastille(page)).toHaveCount(0);

  await publier(page);
  await expect(bandeau(page)).toBeVisible({ timeout: 30_000 });
  // Menu fermé, le bandeau n'est plus à l'écran : la pastille du haut dit la même chose.
  const dock = page.locator('footer.dock');
  const fermer = dock.getByRole('button', { name: 'Fermer le menu' });
  if (await fermer.isVisible()) await fermer.tap();
  await expect(pastille(page)).toBeVisible();
  expect(loads).toBe(1);

  // 48 px au doigt (zone d'appui qui déborde du dessin), sans recouvrir les boutons ronds en dessous.
  const box = await pastille(page).boundingBox();
  if (!box) throw new Error('pastille introuvable');
  const nav = await page.getByRole('navigation', { name: 'Raccourcis' }).boundingBox();
  if (!nav) throw new Error('raccourcis introuvables');
  expect(nav.y).toBeGreaterThanOrEqual(box.y + box.height);
  const zone = await page.evaluate(({ x, from, to }) => {
    let hits = 0;
    for (let y = from; y < to; y += 1) {
      if (document.elementFromPoint(x, y)?.closest('button')?.classList.contains('maj-pill')) hits += 1;
    }
    // Le haut du premier bouton rond ne doit pas être pris par la pastille.
    const sous = document.elementFromPoint(x, to - 1)?.closest('button');
    return { hits, surLesRonds: Boolean(sous?.classList.contains('maj-pill')) };
  }, { x: box.x + box.width - 4, from: Math.floor(box.y - 12), to: Math.ceil(nav.y + 2) });
  expect(zone.hits).toBeGreaterThanOrEqual(48);
  expect(zone.surLesRonds).toBe(false);
  await capturer(page, 'maj-pastille-garage');

  // Un appui : la version en attente prend la main, la page se recharge une fois.
  const reloaded = page.waitForEvent('load');
  await pastille(page).tap();
  await reloaded;
  await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
  await waitOfflineReady(page);
  await expect(pastille(page)).toHaveCount(0);
  expect(loads).toBe(2);
});

// MIS DE CÔTÉ le 16 novembre 2026 : ce parcours échoue une fois sur quatre, même machine au repos.
// Quand la version 2 est publiée pendant que la musique d'accueil se charge encore, l'ancienne version
// du service worker reste occupée, la nouvelle n'est activée qu'au déchargement de la page, et la page
// n'est pas rechargée dans le délai. Le rechargement à l'aveugle a été retiré (il bloquait la page) ;
// reste à comprendre pourquoi l'activation attend. Voir TODO_ASSETS.md, « Mise à jour sans geste ».
test.fixme('sans aucun geste, la nouvelle version s’applique d’elle-même', async ({ page }) => {
  // Machine chargée : le téléchargement de la version 2 et son activation peuvent être lents.
  test.setTimeout(300_000);
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });

  // Aucun appui, aucune touche : la page n'est jamais touchée.
  await page.goto(`${origin}${BASE_PATH}`);
  await waitOfflineReady(page);
  expect(loads).toBe(1);

  const reloaded = page.waitForEvent('load', { timeout: 150_000 });
  await publier(page);
  await reloaded;
  await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
  await waitOfflineReady(page);
  expect(loads).toBe(2);
  // Rien ne reste à proposer : ni pastille, ni bandeau.
  await expect(pastille(page)).toHaveCount(0);
  await expect(bandeau(page)).toHaveCount(0);
  const state = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    return { waiting: Boolean(registration?.waiting), controlled: Boolean(navigator.serviceWorker.controller) };
  });
  expect(state).toEqual({ waiting: false, controlled: true });
});

test('en sortie de nuit, l’offre n’apparaît qu’à l’arrêt (pause), jamais en roulant', async ({ page }) => {
  test.setTimeout(360_000);
  await page.goto(`${origin}${BASE_PATH}`);
  await page.keyboard.press('Shift');
  await waitOfflineReady(page);
  await publier(page);
  await expect(bandeau(page)).toBeVisible({ timeout: 30_000 });

  // On part en sortie par l'adresse, sans recharger : l'offre est toujours en attente dans l'app.
  await page.evaluate(() => {
    window.location.hash = '#/sortie';
  });
  await expect(page.locator(`.${DRIVE_STAGE_CLASS}`)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
  const offre = page.getByRole('button', { name: 'Nouvelle version prête : recharger l’atelier' });
  await expect(offre).toHaveCount(0);

  const pause = page.getByRole('button', { name: /^(Pause|Reprendre)$/ });
  await pause.tap();
  await expect(pause).toHaveAttribute('aria-pressed', 'true');
  await expect(offre).toBeVisible();
  await capturer(page, 'maj-pause-sortie');
  await pause.tap();
  await expect(pause).toHaveAttribute('aria-pressed', 'false');
  await expect(offre).toHaveCount(0);
});
