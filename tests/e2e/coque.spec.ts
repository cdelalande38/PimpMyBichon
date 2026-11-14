import { expect, test } from '@playwright/test';
import { capture, changedRatio, openApp, sceneBand, VIEWPORT, waitForScene } from './helpers.ts';

test.describe('coque de l’app', () => {
  test('l’écran principal s’affiche en 390 × 844, scène 3D comprise', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await openApp(page);
    await waitForScene(page);

    await expect(page.getByText('Substitut · forme d’essai de peinture')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sous le capot' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Réglages' })).toBeVisible();
    await capture(page, '01-garage');

    expect(errors).toEqual([]);
  });

  test('les commandes sont dans le tiers bas et font au moins 48 px', async ({ page }) => {
    await openApp(page);
    const buttons = page.locator('.app button:visible');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const label = (await button.innerText()).trim();
      const box = await button.boundingBox();
      expect(box, `bouton « ${label} » mesurable`).not.toBeNull();
      if (!box) continue;
      expect(box.height, `hauteur de « ${label} »`).toBeGreaterThanOrEqual(48);
      expect(box.width, `largeur de « ${label} »`).toBeGreaterThanOrEqual(48);
      expect(box.y, `« ${label} » dans le tiers bas`).toBeGreaterThanOrEqual(
        (VIEWPORT.height * 2) / 3,
      );
    }
  });

  test('aucune requête ne part vers un tiers', async ({ page, baseURL }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));

    await openApp(page);
    await waitForScene(page);
    await page.getByRole('button', { name: 'Sous le capot' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Retour à l’atelier' }).click();
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();

    expect(requested.length).toBeGreaterThan(5);
    const outside = requested.filter(
      (url) => !url.startsWith(baseURL ?? '') && !url.startsWith('data:') && !url.startsWith('blob:'),
    );
    expect(outside).toEqual([]);
  });

  test('la forme tourne au repos, et s’arrête si le système demande moins de mouvement', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await openApp(page);
    await waitForScene(page);

    /** Part de l'image qui change en une seconde et demie. */
    const motion = async () => {
      const before = await sceneBand(page);
      await page.waitForTimeout(1500);
      return changedRatio(before, await sceneBand(page));
    };

    expect(await motion(), 'rotation lente visible').toBeGreaterThan(0.002);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    // La rotation s'amortit sur quelques dizaines d'images, puis le rendu à la demande se tait.
    // En rendu logiciel, ces images prennent du temps : on attend l'immobilité au lieu de la supposer.
    await expect
      .poll(motion, { message: 'scène immobile', timeout: 60_000, intervals: [500] })
      .toBeLessThan(0.0005);
  });

  test('si la 3D ne se charge pas, le reste de l’app tient et propose de relancer', async ({
    page,
  }) => {
    await page.route(/\/assets\/GarageCanvas-[\w-]+\.js$/, (route) => route.abort());
    await openApp(page);

    await expect(page.getByRole('alert')).toContainText('Le garage 3D ne démarre pas.');
    const retry = page.getByRole('button', { name: 'Relancer' });
    await expect(retry).toBeVisible();
    const box = await retry.boundingBox();
    expect(box?.y ?? 0, 'bouton « Relancer » dans le tiers bas').toBeGreaterThanOrEqual(
      (VIEWPORT.height * 2) / 3,
    );
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    await expect(page.getByRole('button', { name: 'Réglages' })).toBeVisible();
    await capture(page, '10-scene-en-panne');

    // Le réseau revient : un appui relance le garage.
    await page.unroute(/\/assets\/GarageCanvas-[\w-]+\.js$/);
    await retry.click();
    await waitForScene(page);
    await expect(page.getByRole('alert')).toBeHidden();
  });

  test('l’app reste lisible en paysage et sur un écran d’ordinateur', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 844, height: 390 });
    await openApp(page);
    await waitForScene(page);
    await expect(page.getByRole('button', { name: 'Réglages' })).toBeVisible();
    await capture(page, '11-paysage');

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForScene(page);
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expect(page.getByRole('dialog', { name: 'Réglages' })).toBeVisible();
    await capture(page, '12-ordinateur');
  });

  test('un hash inconnu retombe sur le garage, sans panneau', async ({ page }) => {
    await openApp(page, '#/nimporte-quoi');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Réglages' })).toBeVisible();
  });
});
