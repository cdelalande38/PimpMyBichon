import { expect, test, type Page } from '@playwright/test';
import { capture, openApp, VIEWPORT, waitForScene } from './helpers.ts';

async function expectControlsInThumbZone(page: Page): Promise<void> {
  const buttons = page.locator('dialog[open] button:visible');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const label = (await button.innerText()).trim().replace(/\s+/g, ' ');
    const box = await button.boundingBox();
    expect(box, `bouton « ${label} » mesurable`).not.toBeNull();
    if (!box) continue;
    expect(box.height, `hauteur de « ${label} »`).toBeGreaterThanOrEqual(48);
    expect(box.width, `largeur de « ${label} »`).toBeGreaterThanOrEqual(48);
    expect(box.y, `« ${label} » dans le tiers bas`).toBeGreaterThanOrEqual((VIEWPORT.height * 2) / 3);
  }
}

test.describe('panneaux', () => {
  test('« Sous le capot » dit quelle version tourne et où en est le socle', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await page.getByRole('button', { name: 'Sous le capot' }).click();

    const dialog = page.getByRole('dialog', { name: 'Sous le capot' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#\/capot$/);
    await expect(dialog.getByText('Version')).toBeVisible();
    await expect(dialog.getByText(/WebGL 2/)).toBeVisible();
    await expect(dialog.getByText(/Absents : sons et musique muets|Présents :/)).toBeVisible();
    await expect(dialog.getByText(/placeholder_garage, placeholder_speedshape/)).toBeVisible();
    await expectControlsInThumbZone(page);
    await capture(page, '02-sous-le-capot');
  });

  test('les réglages se changent au pouce et survivent à un rechargement', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Réglages' }).click();

    const dialog = page.getByRole('dialog', { name: 'Réglages' });
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#\/reglages$/);
    await expectControlsInThumbZone(page);
    await capture(page, '03-reglages');

    await dialog.getByRole('button', { name: 'Texte' }).click();
    await dialog.getByRole('button', { name: /Très grand/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text', 'tres-grand');
    await expectControlsInThumbZone(page);
    await capture(page, '04-reglages-texte-tres-grand');

    await dialog.getByRole('button', { name: 'Qualité' }).click();
    await dialog.getByRole('button', { name: /Économie/ }).click();
    await expect(dialog.getByRole('button', { name: /Économie/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).not.toHaveURL(/#\/reglages/);
    await capture(page, '05-garage-texte-tres-grand');

    // Reprise : la sauvegarde IndexedDB est relue au lancement suivant.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-text', 'tres-grand');
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expect(
      page.getByRole('dialog').getByRole('button', { name: /Économie/ }),
    ).toHaveAttribute('aria-pressed', 'true');
  });

  test('le retour du navigateur et la touche Échap ferment le panneau', async ({ page }) => {
    await openApp(page);
    await page.getByRole('button', { name: 'Réglages' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).not.toHaveURL(/#\/reglages/);

    await page.getByRole('button', { name: 'Sous le capot' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page).not.toHaveURL(/#\/capot/);
  });

  test('les liens reçus ouvrent le bon panneau', async ({ page }) => {
    await openApp(page, '#/commande');
    await expect(
      page.getByRole('dialog', { name: 'Le carnet de commandes n’est pas encore ouvert' }),
    ).toBeVisible();
    await capture(page, '06-commande');

    await openApp(page, '#b=PMB2.eJyrVkrLz1eyUkpKLFKqBQAdegQ0');
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Tu as reçu un build' })).toBeVisible();
    await capture(page, '07-lien-de-build');

    await openApp(page, '#d=PMB2.eJyrVkrLz1eyUkpKLFKqBQAdegQ0');
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Tu as reçu une commande' })).toBeVisible();

    // Fermer un panneau ouvert par un lien direct ramène au garage sans quitter l'app.
    await page.getByRole('button', { name: 'Retour à l’atelier' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Réglages' })).toBeVisible();
  });

  test('un code reçu n’est jamais interprété comme du HTML', async ({ page }) => {
    const payload = encodeURIComponent('<img src=x onerror="window.__pwned=1">');
    await openApp(page, `#b=${payload}`);
    await expect(page.getByRole('dialog', { name: 'Lien illisible' })).toBeVisible();
    await capture(page, '08-lien-illisible');
    expect(await page.evaluate(() => '__pwned' in window)).toBe(false);
    expect(await page.locator('img').count()).toBe(0);
  });
});
