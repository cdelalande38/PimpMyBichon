// Mise à jour d'une app déjà installée : une nouvelle version ne doit jamais recharger la page
// toute seule, et un geste doit suffire à l'appliquer. Un service worker qui ne se met plus à
// jour laisserait les téléphones bloqués sur une vieille version : ce parcours est critique.
//
// Le test sert sa propre copie de dist/ sur un autre port, pour pouvoir publier une « version 2 »
// sans gêner les autres parcours.
//
// Mise à jour au lancement (src/pwa/lancement.ts) : au démarrage, l'écran de chargement vérifie s'il
// existe une version plus récente, la télécharge, lui passe la main et la page se recharge une fois,
// sans aucun geste. Les parcours « au lancement » rejouent la publication d'une version 2 qui change
// TOUS les fichiers du précache (les révisions du manifeste) et se reconnaît par un message
// (« pmb:version »), pour savoir quelle version tourne vraiment.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import type { Socket } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { commencerCourse, reloadSaved, waitOfflineReady } from './helpers.ts';

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
const sockets = new Set<Socket>();

/** Réglages du serveur, remis à zéro avant chaque parcours. */
const reseau = { swDelayMs: 0, swMuet: false, lenteurMs: 0 };

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
    const estSw = relative === 'sw.js';
    const repondre = () => {
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
    };
    // Réseau muet : la demande du service worker ne reçoit jamais de réponse.
    if (estSw && reseau.swMuet) return;
    // Réseau lent : le service worker arrive tard, ou chaque fichier du précache met du temps à venir.
    const delai = estSw ? reseau.swDelayMs : reseau.lenteurMs;
    if (delai > 0) setTimeout(repondre, delai);
    else repondre();
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  origin = `http://localhost:${(server.address() as AddressInfo).port}`;
});

test.afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((done) => server.close(() => done()));
  rmSync(siteDir, { recursive: true, force: true });
});

test.beforeEach(() => {
  Object.assign(reseau, { swDelayMs: 0, swMuet: false, lenteurMs: 0 });
  // Le site repart de la « version 1 » (le service worker de dist/, avec son repère de version).
  cpSync(resolve('dist', 'sw.js'), join(siteDir, 'sw.js'));
  ecrireVersion(1, false);
});

/**
 * Écrit la « version n » du service worker. Il répond « pmb:version » par son numéro (pour savoir
 * laquelle tourne). Avec `toutChange`, les révisions du manifeste de précache changent : tous les
 * fichiers sont à retélécharger, comme à un vrai déploiement.
 */
function ecrireVersion(n: number, toutChange: boolean): void {
  const swPath = join(siteDir, 'sw.js');
  let source = readFileSync(swPath, 'utf8').replace(/\n;self\.__pmbV[\s\S]*$/, '');
  if (toutChange) {
    const marque = n.toString(16).padStart(2, '0');
    source = source.replace(/"revision":"[0-9a-f]{2}([0-9a-f]{30})"/g, `"revision":"${marque}$1"`);
  }
  source += `\n;self.__pmbV=${n};self.addEventListener('message',(e)=>{if(e.data==='pmb:version')e.source.postMessage({pmbVersion:self.__pmbV})});`;
  writeFileSync(swPath, source);
}

/** Numéro de la version qui tient la page (celle du service worker aux commandes). */
async function versionActive(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const fin = window.setTimeout(() => resolve(-1), 5000);
        const ecoute = (event: MessageEvent) => {
          const data = event.data as { pmbVersion?: unknown } | null;
          if (typeof data?.pmbVersion !== 'number') return;
          window.clearTimeout(fin);
          navigator.serviceWorker.removeEventListener('message', ecoute);
          resolve(data.pmbVersion);
        };
        navigator.serviceWorker.addEventListener('message', ecoute);
        navigator.serviceWorker.controller?.postMessage('pmb:version');
      }),
  );
}

/**
 * Journal de ce que dit l'écran de chargement (lignes « instant|texte », texte vide quand il part),
 * tenu dans sessionStorage pour survivre au rechargement : on y lit ce qu'il a annoncé, même s'il
 * est parti avant qu'on regarde.
 */
async function journaliser(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Retard de la page elle-même : plus grand écart entre deux passages d'une minuterie de 100 ms (ce
    // qu'elle perd à être occupée ou privée de processeur). Sert à départager un retard de l'app d'un
    // retard de la machine (rendu logiciel, poste chargé) : la décision du lancement repose sur la
    // même sorte de minuterie.
    const w = window as unknown as { __pmbRetard: number };
    w.__pmbRetard = 0;
    let avant = performance.now();
    window.setInterval(() => {
      const maintenant = performance.now();
      w.__pmbRetard = Math.max(w.__pmbRetard, maintenant - avant - 100);
      avant = maintenant;
    }, 100);
    let dernier: string | null = null;
    new MutationObserver(() => {
      const texte = document.querySelector('.tuto-chargement .tuto-chargement-texte')?.textContent ?? '';
      if (texte === dernier) return;
      dernier = texte;
      try {
        const avant = window.sessionStorage.getItem('pmb-test-journal') ?? '';
        window.sessionStorage.setItem('pmb-test-journal', `${avant}${Math.round(performance.now())}|${texte}\n`);
      } catch {
        // Stockage refusé : pas de journal.
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
}

async function journal(page: Page): Promise<Array<{ t: number; texte: string }>> {
  const brut = await page.evaluate(() => window.sessionStorage.getItem('pmb-test-journal') ?? '');
  return brut
    .split('\n')
    .filter(Boolean)
    .map((ligne) => ({ t: Number(ligne.slice(0, ligne.indexOf('|'))), texte: ligne.slice(ligne.indexOf('|') + 1) }));
}

/** Combien de fois la page s'est chargée (le premier chargement compris). */
function compterChargements(page: Page): { lire: () => number } {
  let loads = 0;
  page.on('load', () => {
    loads += 1;
  });
  return { lire: () => loads };
}

/** Première visite : la page est installée, le service worker de la « version 1 » aux commandes. */
async function premiereVisite(page: Page): Promise<void> {
  await page.goto(`${origin}${BASE_PATH}`);
  await waitOfflineReady(page);
  await expect.poll(() => versionActive(page), { timeout: 30_000 }).toBe(1);
}

const dossierCaptures = (): string => process.env.PMB_CAPTURES_DIR ?? resolve('captures', 'vague-q-lancement');
async function capturerLancement(page: Page, name: string): Promise<void> {
  const path = join(dossierCaptures(), `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

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
  // Une version qui arrive en cours d'usage attend toujours l'accord : elle ne s'applique seule qu'au lancement (src/pwa/lancement.ts).
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

test.describe('au lancement', () => {
  test('une version plus récente est annoncée par l’écran de chargement, puis l’app s’ouvre dessus sans aucun geste', async ({ page }) => {
    test.setTimeout(240_000);
    await journaliser(page);
    const charges = compterChargements(page);
    await premiereVisite(page);
    expect(charges.lire()).toBe(1);

    // Une « version 2 » est publiée pendant que l'app est fermée : le navigateur ne la connaît pas encore.
    ecrireVersion(2, true);
    await reloadSaved(page);

    // Aucun appui, aucune touche : la page se recharge d'elle-même, une seule fois, sur la version 2.
    await expect.poll(() => charges.lire(), { timeout: 150_000 }).toBe(3);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    await waitOfflineReady(page);
    await expect.poll(() => versionActive(page), { timeout: 30_000 }).toBe(2);

    // L'écran de chargement l'a dit : vérification, puis nouvelle version.
    const textes = (await journal(page)).map((ligne) => ligne.texte);
    expect(textes).toContain('On vérifie la version…');
    expect(textes.some((texte) => texte.startsWith('Nouvelle version'))).toBe(true);

    // Rien ne recharge plus ensuite, rien ne reste à proposer.
    await page.waitForTimeout(4000);
    expect(charges.lire()).toBe(3);
    await expect(pastille(page)).toHaveCount(0);
    await expect(bandeau(page)).toHaveCount(0);
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return { waiting: Boolean(registration?.waiting), controlled: Boolean(navigator.serviceWorker.controller) };
    });
    expect(state).toEqual({ waiting: false, controlled: true });
  });

  test('sans réseau, l’app s’ouvre sans rien vérifier ni attendre', async ({ page, context }) => {
    test.setTimeout(180_000);
    await journaliser(page);
    const charges = compterChargements(page);
    await premiereVisite(page);
    ecrireVersion(2, true);

    await context.setOffline(true);
    await reloadSaved(page);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    await expect(page.locator('.tuto-chargement')).toHaveCount(0, { timeout: 90_000 });
    // Jamais « On vérifie… » : la décision est prise avant la première image.
    const textes = (await journal(page)).map((ligne) => ligne.texte);
    expect(textes.filter((texte) => /vérifie|Nouvelle version/.test(texte))).toEqual([]);
    expect(await versionActive(page)).toBe(1);
    await page.waitForTimeout(3000);
    expect(charges.lire()).toBe(2);
  });

  test('« Plus tard » laisse entrer sur l’ancienne version, la nouvelle s’applique au lancement suivant', async ({ page }) => {
    test.setTimeout(300_000);
    await journaliser(page);
    const charges = compterChargements(page);
    await premiereVisite(page);

    ecrireVersion(2, true);
    // Chaque fichier du précache met du temps à venir : le téléchargement dure.
    reseau.lenteurMs = 700;
    await reloadSaved(page);

    const plusTard = page.getByRole('button', { name: 'Plus tard' });
    await expect(plusTard).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.tuto-chargement-texte')).toContainText(/Nouvelle version : téléchargement/);
    // 48 px au doigt.
    const box = await plusTard.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await plusTard.click();

    // L'app s'ouvre sur l'ancienne version, sans recharger.
    await expect(page.locator('.tuto-chargement')).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    expect(await versionActive(page)).toBe(1);
    expect(charges.lire()).toBe(2);

    // Le téléchargement continue derrière : la version reste proposée (pastille), sans rien recharger.
    reseau.lenteurMs = 0;
    await expect(pastille(page)).toBeVisible({ timeout: 90_000 });
    expect(charges.lire()).toBe(2);
    expect(await versionActive(page)).toBe(1);

    // Au lancement suivant, l'écran de chargement l'applique.
    await reloadSaved(page);
    await expect.poll(() => charges.lire(), { timeout: 150_000 }).toBe(4);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    await expect.poll(() => versionActive(page), { timeout: 30_000 }).toBe(2);
    await page.waitForTimeout(3000);
    expect(charges.lire()).toBe(4);
  });

  test('réseau qui ne répond pas : l’écran vérifie quelques secondes puis laisse entrer', async ({ page }) => {
    test.setTimeout(180_000);
    await journaliser(page);
    const charges = compterChargements(page);
    await premiereVisite(page);

    reseau.swMuet = true;
    await reloadSaved(page);
    await expect(page.locator('.tuto-chargement')).toHaveCount(0, { timeout: 90_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();

    // La décision d'entrer est prise au délai prévu (3,5 s ; l'horloge tourne toutes les 250 ms), quoi
    // que la page ait à faire par ailleurs. Ce que l'écran montre suit quand la page a le temps de se
    // dessiner : en rendu logiciel, sur une machine chargée, cela peut tarder (consigné, non exigé).
    const decision = await page.evaluate(() => ({
      raison: document.documentElement.dataset.lancement,
      ms: Number(document.documentElement.dataset.lancementMs),
      retard: (window as unknown as { __pmbRetard: number }).__pmbRetard,
    }));
    expect(decision.raison).toBe('delai');
    expect(decision.ms).toBeGreaterThanOrEqual(3500);
    // Retard toléré : l'horloge (250 ms), le plus grand retard d'une minuterie de la page, et 1 s de marge.
    expect(decision.ms).toBeLessThan(3500 + 250 + decision.retard + 1000);
    test.info().annotations.push({ type: 'décision', description: `${decision.ms} ms, plus grand retard de minuterie ${Math.round(decision.retard)} ms` });
    const lignes = await journal(page);
    const debut = lignes.findIndex((ligne) => ligne.texte === 'On vérifie la version…');
    expect(debut, 'l’écran a dit qu’il vérifiait').toBeGreaterThanOrEqual(0);
    const suite = lignes.slice(debut + 1).find((ligne) => ligne.texte !== 'On vérifie la version…');
    test.info().annotations.push({ type: 'affichage', description: `${Math.round((suite?.t ?? 0) - (lignes[debut]?.t ?? 0))} ms` });
    expect(await versionActive(page)).toBe(1);
    expect(charges.lire()).toBe(2);
  });

  // Captures de revue : la vérification (réponse lente du réseau) et le téléchargement, en portrait puis en paysage.
  for (const viewport of [
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    test.describe(`capture ${viewport.width} × ${viewport.height}`, () => {
      test.use({ viewport });

      test('la vérification, puis le téléchargement avec son avancement et « Plus tard »', async ({ page }) => {
        test.setTimeout(240_000);
        await premiereVisite(page);
        reseau.swDelayMs = 2800;
        await reloadSaved(page);
        await expect(page.locator('.tuto-chargement-texte')).toHaveText('On vérifie la version…');
        await capturerLancement(page, `verification-${viewport.width}x${viewport.height}`);
        await expect(page.locator('.tuto-chargement')).toHaveCount(0, { timeout: 60_000 });

        reseau.swDelayMs = 0;
        ecrireVersion(2, true);
        reseau.lenteurMs = 400;
        await reloadSaved(page);
        const texte = page.locator('.tuto-chargement-texte');
        await expect(texte).toContainText(/Nouvelle version : téléchargement \d+ %/, { timeout: 60_000 });
        await expect(page.getByRole('button', { name: 'Plus tard' })).toBeVisible();
        await page.waitForTimeout(2500);
        await capturerLancement(page, `telechargement-${viewport.width}x${viewport.height}`);
      });
    });
  }
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
  // L'aperçu roule : pas d'offre ; la course non plus, tant qu'elle roule.
  await commencerCourse(page);
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
