import { expect, test } from '@playwright/test';
import { capture, changedRatio, openApp, openAtelier, quick, sceneBand, VIEWPORT, waitForBench, waitForScene } from './helpers.ts';

test.describe('coque de l’app', () => {
  test('l’écran principal s’affiche en 390 × 844, véhicule de départ compris', async ({ page }) => {
    test.setTimeout(180_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    // Le véhicule de départ est un substitut déclaré : il est annoncé à l'écran et nommé dans le dock.
    await expect(page.locator('.tag')).toHaveText(/^Substitut · /);
    await expect(page.locator('footer.dock .dock-vehicle')).not.toBeEmpty();
    // Radio, photo et atelier : les boutons ronds du haut de l'écran.
    for (const name of [/^Radio/, /^Photo$/, /^Atelier$/]) await expect(quick(page).getByRole('button', { name })).toBeVisible();
    await capture(page, '01-garage');

    expect(errors).toEqual([]);
  });

  test('la personnalisation est dans le tiers bas ; toute commande fait au moins 48 px', async ({ page }) => {
    await openApp(page);
    // Toute commande visible, dock comme boutons ronds du haut : 48 px au moins.
    const buttons = page.locator('.app button:visible');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(2);

    for (let i = 0; i < count; i += 1) {
      const button = buttons.nth(i);
      const label = ((await button.getAttribute('aria-label')) ?? (await button.innerText())).trim();
      const box = await button.boundingBox();
      expect(box, `bouton « ${label} » mesurable`).not.toBeNull();
      if (!box) continue;
      expect(box.height, `hauteur de « ${label} »`).toBeGreaterThanOrEqual(48);
      expect(box.width, `largeur de « ${label} »`).toBeGreaterThanOrEqual(48);
      // Décision de l'utilisateur : le tiers bas ne vaut plus que pour la personnalisation (le dock).
      // Radio, photo et atelier vivent dans la colonne de boutons ronds du haut de l'écran.
      const inDock = await button.evaluate((element) => element.closest('footer.dock') !== null);
      // Pastilles de la pièce cliquable (src/ui/overlay/) : posées sur leur objet dans la scène.
      const onScene = await button.evaluate((element) => element.closest('.piece-overlay') !== null);
      if (inDock) {
        expect(box.y, `« ${label} » dans le tiers bas`).toBeGreaterThanOrEqual((VIEWPORT.height * 2) / 3);
      } else if (!onScene) {
        expect(await button.evaluate((element) => element.closest('nav.quick') !== null), `« ${label} » hors du dock : bouton rond du haut`).toBe(true);
      }
    }
  });

  test('aucune requête ne part vers un tiers', async ({ page, baseURL }) => {
    const requested: string[] = [];
    page.on('request', (request) => requested.push(request.url()));

    await openApp(page);
    await waitForScene(page);
    await openAtelier(page, 'Sous le capot');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: 'Retour à l’atelier' }).click();
    await openAtelier(page, 'Réglages');
    await expect(page.getByRole('dialog')).toBeVisible();

    expect(requested.length).toBeGreaterThan(5);
    const outside = requested.filter(
      (url) => !url.startsWith(baseURL ?? '') && !url.startsWith('data:') && !url.startsWith('blob:'),
    );
    expect(outside).toEqual([]);
  });

  test('le véhicule tourne au repos, et s’arrête si le système demande moins de mouvement', async ({
    page,
  }) => {
    test.setTimeout(300_000);
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

    // Après un geste, la rotation doit repartir toute seule. Le rendu est à la demande :
    // sans relance explicite, la scène resterait figée une fois le geste amorti.
    await page.mouse.move(195, 360);
    await page.mouse.down();
    await page.mouse.move(275, 360, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(12_000);
    expect(await motion(), 'rotation reprise après un geste').toBeGreaterThan(0.002);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    // La rotation s'amortit sur quelques dizaines d'images, puis le rendu à la demande se tait.
    // En rendu logiciel, ces images prennent du temps (reflet du sol, MSAA) : on attend
    // l'immobilité au lieu de la supposer.
    await expect
      .poll(motion, { message: 'scène immobile', timeout: 200_000, intervals: [500] })
      .toBeLessThan(0.0005);
  });

  test('au repos, la scène ne dessine plus rien (rendu à la demande)', async ({ page }) => {
    test.setTimeout(180_000);
    // Compte les appels de dessin WebGL de la page.
    await page.addInitScript({
      content: `
        window.__draws = 0;
        for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
          const original = WebGL2RenderingContext.prototype[name];
          WebGL2RenderingContext.prototype[name] = function (...args) {
            window.__draws += 1;
            return original.apply(this, args);
          };
        }`,
    });
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    const draws = () => page.evaluate(() => (window as unknown as { __draws: number }).__draws);
    const drawsOverTwoSeconds = async () => {
      const before = await draws();
      await page.waitForTimeout(2000);
      return (await draws()) - before;
    };
    expect(await draws(), 'la scène a bien été dessinée').toBeGreaterThan(0);
    await expect
      .poll(drawsOverTwoSeconds, { message: 'aucun dessin au repos', timeout: 60_000, intervals: [250] })
      .toBe(0);
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
    await expect(quick(page).getByRole('button', { name: 'Atelier', exact: true })).toBeVisible();
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
    await expect(quick(page).getByRole('button', { name: 'Atelier', exact: true })).toBeVisible();
    await capture(page, '11-paysage');

    await page.setViewportSize({ width: 1280, height: 800 });
    await waitForScene(page);
    await openAtelier(page, 'Réglages');
    await expect(page.getByRole('dialog', { name: 'Réglages' })).toBeVisible();
    await capture(page, '12-ordinateur');
  });

  test('un hash inconnu retombe sur le garage, sans panneau', async ({ page }) => {
    await openApp(page, '#/nimporte-quoi');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(quick(page).getByRole('button', { name: 'Atelier', exact: true })).toBeVisible();
  });
});
