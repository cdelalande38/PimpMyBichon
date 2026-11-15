// Parcours de la radio : import par fichier, lecture, suivant, rechargement, suppression ;
// import par adresse depuis un hébergement d'essai sur une autre origine (avec et sans CORS) ;
// arrivée par un lien « ?pack= ». Les packs sont fabriqués par le test (bruit faible en WAV).

import type { Server } from 'node:http';
import { expect, test, type Page } from '@playwright/test';
import { noiseWav, smallPack, startPackServer, type PackSource } from '../radio/server.ts';

const PACK_PORT = 4521;
const HOST = `localhost:${PACK_PORT}`;
const packs = new Map<string, PackSource>([
  ['pack.zip', { buffer: smallPack() }],
  ['autre.zip', { buffer: smallPack(['hiphop-rnb']) }],
]);
if (process.env.PMB_RADIO_GROS) packs.set('gros.zip', { file: process.env.PMB_RADIO_GROS });

let server: Server | null = null;
const requests: string[] = [];

test.beforeAll(async () => {
  server = await startPackServer(PACK_PORT, packs, requests);
});

test.afterAll(async () => {
  await new Promise((resolve) => server?.close(resolve));
});

async function openRadio(page: Page): Promise<void> {
  await page.goto('./');
  await page.getByRole('button', { name: /^Radio/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Radio', level: 2 })).toBeVisible();
}

const station = (page: Page, name: string) => page.locator('.radio-station', { has: page.getByText(name, { exact: true }) });

// Sur une machine chargée (WebGL en rendu logiciel), l'horloge audio de Chromium sans tête avance
// par à-coups : les attentes sur la position de lecture sont donc larges.
async function clockSeconds(page: Page): Promise<number> {
  const text = (await page.getByTestId('radio-temps').textContent()) ?? '0:00';
  const [m, s] = text.split('/')[0]!.trim().split(':').map(Number);
  return (m ?? 0) * 60 + (s ?? 0);
}

test('import par fichier, lecture, suivant, rechargement, suppression', async ({ page }) => {
  await openRadio(page);
  await expect(page.getByText('Ta radio est vide.')).toBeVisible();
  await page.getByTestId('radio-fichier-pack').setInputFiles({
    name: 'pack-essai.zip',
    mimeType: 'application/zip',
    buffer: Buffer.from(smallPack()),
  });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Électro')).toContainText('2 morceaux');
  await expect(station(page, 'Rock')).toBeVisible();

  await page.getByRole('button', { name: 'Écouter Électro' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1a');
  expect(await page.evaluate(() => navigator.mediaSession.metadata?.title)).toBe('Bruit d’essai 1a');
  await expect.poll(() => clockSeconds(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(2);

  await page.locator('.radio-player').getByRole('button', { name: 'Morceau suivant' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit d’essai 1b');
  await expect.poll(() => clockSeconds(page), { timeout: 45_000 }).toBeGreaterThanOrEqual(1);
  await page.screenshot({ path: 'test-results/radio-lecture.png' });

  // Panneau fermé : la musique continue, le mini-lecteur du dock la montre.
  await page.getByRole('button', { name: 'Retour à l’atelier' }).click();
  // (Le morceau a pu s'achever entre-temps : l'enchaînement repart alors sur le premier.)
  await expect(page.locator('.radio-mini')).toContainText(/Bruit d’essai 1[ab]/);
  await expect(page.locator('.radio-mini').getByRole('button', { name: 'Pause' })).toBeVisible();
  await page.screenshot({ path: 'test-results/radio-dock.png' });

  await page.reload();
  await page.getByRole('button', { name: /^Radio/ }).first().click();
  await expect(station(page, 'Électro')).toBeVisible();
  await expect(station(page, 'Rock')).toBeVisible();

  const placeBefore = await page.getByTestId('radio-place').textContent();
  await station(page, 'Rock').getByRole('button', { name: /^Rock/ }).click();
  await station(page, 'Rock').getByRole('button', { name: 'Supprimer la station' }).click();
  await station(page, 'Rock').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(station(page, 'Rock')).toHaveCount(0);
  await expect(station(page, 'Électro')).toBeVisible();
  await station(page, 'Électro').getByRole('button', { name: /^Électro/ }).click();
  await station(page, 'Électro').getByRole('button', { name: 'Supprimer la station' }).click();
  await station(page, 'Électro').getByRole('button', { name: 'Supprimer', exact: true }).click();
  await expect(page.getByText('Ta radio est vide.')).toBeVisible();
  await expect(page.getByTestId('radio-place')).not.toHaveText(placeBefore ?? '');
  const files = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('radio');
    const names: string[] = [];
    for await (const name of (dir as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name);
    return names;
  });
  expect(files).toEqual([]);
});

test('import par adresse : avec CORS, puis sans CORS', async ({ page }) => {
  await openRadio(page);
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/pack.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Électro')).toBeVisible();
  await page.getByRole('button', { name: 'OK' }).click();

  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/nocors/autre.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText('n’autorise pas l’atelier à lire le fichier');
  await page.screenshot({ path: 'test-results/radio-cors.png' });

  await page.getByRole('button', { name: 'Fermer' }).click();
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/absent.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText('Adresse introuvable');
});

test('arrivée par un lien ?pack= : un appui, les stations arrivent, l’adresse est nettoyée', async ({ page }) => {
  requests.length = 0;
  await page.goto(`./?pack=${encodeURIComponent(`http://${HOST}/cors/autre.zip`)}`);
  await expect(page.getByText('Un pack de musique t’attend')).toBeVisible();
  await expect(page.locator('.radio-offer')).toContainText(`Hébergé chez ${HOST}`);
  expect(page.url()).not.toContain('pack=');
  // Rien ne part vers l'hébergement avant l'appui.
  await page.waitForTimeout(1500);
  expect(requests).toEqual([]);
  await page.screenshot({ path: 'test-results/radio-offre.png' });
  await page.locator('.radio-offer').getByRole('button', { name: /^Télécharger/ }).click();
  await expect(station(page, 'Hip-hop & R&B')).toBeVisible({ timeout: 45_000 });
  expect(page.url()).not.toContain('pack=');

  // Le même lien une seconde fois : le pack est reconnu, rien n'est retéléchargé.
  await page.goto('about:blank');
  await page.goto(`./#pack=http://${HOST}/cors/autre.zip`);
  await expect(page.getByText('Un pack de cette adresse est déjà dans ta radio')).toBeVisible();
  // L'adresse seule ne bloque pas : « Retélécharger » interroge l'hébergement, et le poids identique arrête là.
  await page.locator('.radio-offer').getByRole('button', { name: 'Retélécharger' }).click();
  await expect(page.getByText('Ce pack est déjà dans ta radio : rien à télécharger.')).toBeVisible({ timeout: 45_000 });
  expect(requests.filter((line) => line.startsWith('HEAD'))).toEqual([]);
});

test('coupure pendant le téléchargement, puis reprise par une requête Range', async ({ page }) => {
  await openRadio(page);
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/coupe/pack.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  await expect(page.getByRole('alert')).toContainText('Le téléchargement a été coupé');
  await page.getByRole('button', { name: 'Reprendre' }).click();
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Rock')).toBeVisible();
  expect(requests.some((line) => /^GET \/coupe\/pack\.zip bytes=[1-9]\d*-$/.test(line))).toBe(true);
});

test('« Ajouter mes morceaux » : la station Ma playlist', async ({ page }) => {
  await openRadio(page);
  await page.getByTestId('radio-fichier-morceaux').setInputFiles([
    { name: '01 - Groupe Essai - Bruit court.wav', mimeType: 'audio/wav', buffer: Buffer.from(noiseWav(20, 5)) },
    { name: '02 - Groupe Essai - Autre bruit.wav', mimeType: 'audio/wav', buffer: Buffer.from(noiseWav(20, 9)) },
  ]);
  await expect(page.getByText('2 morceaux ajoutés à «\u00a0Ma playlist\u00a0»')).toBeVisible({ timeout: 45_000 });
  await expect(station(page, 'Ma playlist')).toContainText('2 morceaux');
  await page.getByRole('button', { name: 'Écouter Ma playlist' }).click();
  await expect(page.getByTestId('radio-titre')).toHaveText('Bruit court');
  await expect(page.locator('.radio-now-artist')).toHaveText('Groupe Essai');
});

test('trois tailles de texte : cibles de 48 px, rien ne déborde en largeur', async ({ page }) => {
  await openRadio(page);
  await page.getByTestId('radio-fichier-pack').setInputFiles({ name: 'p.zip', mimeType: 'application/zip', buffer: Buffer.from(smallPack()) });
  await expect(page.getByText('Stations ajoutées')).toBeVisible({ timeout: 45_000 });
  await page.getByRole('button', { name: 'Écouter Électro' }).click();
  await station(page, 'Électro').getByRole('button', { name: /^Électro/ }).click();
  for (const size of ['normal', 'grand', 'tres-grand']) {
    await page.evaluate((value) => document.documentElement.setAttribute('data-text', value), size);
    const report = await page.evaluate(() => {
      const panel = document.querySelector('.radio-panel')!;
      const small = [...panel.querySelectorAll('button')]
        .filter((b) => b.offsetParent !== null)
        .map((b) => b.getBoundingClientRect())
        .filter((r) => r.height < 47.5 || r.width < 47.5).length;
      const card = document.querySelector('.sheet .card-scroll')!;
      return { small, overflow: card.scrollWidth - card.clientWidth };
    });
    expect(report).toEqual({ small: 0, overflow: 0 });
    await page.screenshot({ path: `test-results/radio-texte-${size}.png` });
  }
});

test('sans stockage privé : un message clair, pas d’erreur', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    Object.defineProperty(StorageManager.prototype, 'getDirectory', { value: undefined, configurable: true });
  });
  await openRadio(page);
  await expect(page.getByText('Le stockage privé n’est pas disponible')).toBeVisible();
  expect(errors).toEqual([]);
});

test('épreuve de taille : un pack de 400 Mo par adresse', async ({ page }) => {
  test.skip(!process.env.PMB_RADIO_GROS, 'PMB_RADIO_GROS=<chemin du gros pack> pour la lancer');
  test.setTimeout(15 * 60_000);
  await openRadio(page);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  let heapMax = 0;
  const sample = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    const used = metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0;
    heapMax = Math.max(heapMax, used);
  };
  await sample();
  const heapStart = heapMax;
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Depuis une adresse' }).click();
  await page.getByLabel('Adresse du pack (ZIP)').fill(`http://${HOST}/cors/gros.zip`);
  await page.getByRole('button', { name: 'Télécharger' }).click();
  const done = page.getByText(/Stations? ajoutée/);
  while (!(await done.isVisible())) {
    await sample();
    const alert = page.getByRole('alert');
    if (await alert.isVisible()) throw new Error(`échec : ${await alert.textContent()}`);
    await page.waitForTimeout(500);
  }
  const seconds = (Date.now() - t0) / 1000;
  await sample();
  const usage = await page.evaluate(async () => (await navigator.storage.estimate()).usage ?? 0);
  const stations = await page.locator('.radio-station').count();
  console.log(
    `ÉPREUVE : ${seconds.toFixed(1)} s, tas JS max ${(heapMax / 1e6).toFixed(1)} Mo (départ ${(heapStart / 1e6).toFixed(1)} Mo), ` +
      `place occupée ${(usage / 1e6).toFixed(1)} Mo, ${stations} stations`,
  );
  expect(heapMax - heapStart).toBeLessThan(100e6);
});
