import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { capture, openApp, waitForBench, waitForScene, waitOfflineReady } from './helpers.ts';

// Critère d'acceptation du jalon 0 : l'app s'installe et s'ouvre en mode avion
// après une première visite.

test.describe('hors ligne et installation', () => {
  test('après une première visite, l’app s’ouvre sans réseau, banc d’essai compris', async ({
    page,
    context,
  }) => {
    test.setTimeout(240_000);
    await openApp(page);
    await waitOfflineReady(page);
    await waitForScene(page);

    const failed: string[] = [];
    page.on('requestfailed', (request) => failed.push(request.url()));

    await context.setOffline(true);
    await page.reload();

    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    await waitForScene(page);
    // Le modèle, ses textures KTX2 et leur transcodeur viennent du précache.
    await waitForBench(page);
    await expect(page.locator('.pill')).toHaveText('Hors ligne · tout est là');

    // Ce libellé est le plus long de l'indicateur : sur un écran étroit, il ne doit rien pousser hors champ.
    await page.setViewportSize({ width: 360, height: 780 });
    const settings = await page.getByRole('button', { name: 'Réglages' }).boundingBox();
    expect((settings?.x ?? 0) + (settings?.width ?? 0), 'dock entier à l’écran').toBeLessThanOrEqual(360);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Sous le capot' }).click();
    await expect(page.getByRole('dialog').getByText('Prêt : l’atelier s’ouvre sans réseau.')).toBeVisible();
    await expect(page.getByRole('dialog').getByText('Hors ligne.', { exact: true })).toBeVisible();
    await capture(page, '09-hors-ligne');

    expect(failed).toEqual([]);
  });

  test('le précache contient toute la coque, et rien d’autre que l’app', async ({ page, baseURL }) => {
    await openApp(page);
    await waitOfflineReady(page);

    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) urls.push(request.url);
      }
      return urls;
    });

    const paths = cached.map((url) => new URL(url).pathname);
    expect(paths.some((path) => path.endsWith('/index.html'))).toBe(true);
    expect(paths.some((path) => /\/assets\/three-[\w-]+\.js$/.test(path))).toBe(true);
    expect(paths.some((path) => /\/assets\/GarageCanvas-[\w-]+\.js$/.test(path))).toBe(true);
    expect(paths.some((path) => path.endsWith('.woff2'))).toBe(true);
    expect(paths.some((path) => path.endsWith('/icons/pwa-512.png'))).toBe(true);
    expect(paths.some((path) => path.endsWith('/assets/bench/carconcept/CarConcept.glb'))).toBe(true);
    expect(paths.some((path) => path.endsWith('/libs/basis/basis_transcoder.js'))).toBe(true);
    expect(paths.some((path) => path.endsWith('/libs/basis/basis_transcoder.wasm'))).toBe(true);
    expect(cached.every((url) => url.startsWith(baseURL ?? ''))).toBe(true);
  });

  test('le manifeste rend l’app installable', async ({ page, context }) => {
    await openApp(page);
    await waitOfflineReady(page);

    const session = await context.newCDPSession(page);
    const manifest = await session.send('Page.getAppManifest');
    expect(manifest.errors).toEqual([]);
    expect(manifest.url).toMatch(/\/PimpMyBichon\/manifest\.webmanifest$/);

    const parsed = JSON.parse(manifest.data ?? '{}') as {
      name?: string;
      display?: string;
      start_url?: string;
      scope?: string;
      icons?: Array<{ src: string; sizes: string; purpose?: string }>;
    };
    expect(parsed.name).toBe('PimpMyBichon');
    expect(parsed.display).toBe('standalone');
    expect(parsed.start_url).toBe('/PimpMyBichon/');
    expect(parsed.scope).toBe('/PimpMyBichon/');

    // Chaque icône du manifeste existe et a la taille annoncée.
    for (const icon of parsed.icons ?? []) {
      const response = await page.request.get(`./${icon.src}`);
      expect(response.ok(), `icône ${icon.src}`).toBe(true);
      expect(response.headers()['content-type']).toContain('image/png');
      const { width, height } = await sharp(await response.body()).metadata();
      expect(`${width}x${height}`, `taille réelle de ${icon.src}`).toBe(icon.sizes);
    }
    expect((parsed.icons ?? []).some((icon) => icon.purpose === 'maskable')).toBe(true);

    // Chrome liste ici ce qui empêcherait l'installation. Un contexte de test est une
    // navigation privée : c'est la seule réserve tolérée.
    const { installabilityErrors } = await session.send('Page.getInstallabilityErrors');
    const blocking = installabilityErrors
      .map((error) => error.errorId)
      .filter((id) => id !== 'in-incognito');
    expect(blocking).toEqual([]);
  });
});
