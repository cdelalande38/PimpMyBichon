// Installer l'atelier (retour du 16 novembre 2026) : plus de grand bouton au-dessus du menu, une
// petite pastille en haut à droite, qu'une croix range pour de bon ; le bouton reste alors dans
// Atelier › Sous le capot.

import { expect, test, type Page } from '@playwright/test';
import { openApp, openAtelier, reloadSaved, waitForScene, waitOfflineReady } from './helpers.ts';

/** Fait comme Chrome quand l'app peut s'installer (la fenêtre du navigateur ne s'ouvre pas ici). */
async function offerInstall(page: Page): Promise<void> {
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt: async () => undefined, userChoice: new Promise(() => undefined) });
    window.dispatchEvent(event);
  });
}

test.describe('installer l’atelier', () => {
  test('petite pastille en haut à droite ; sa croix la range, pour de bon ; le bouton reste dans Sous le capot', async ({ page }) => {
    test.setTimeout(180_000);
    await openApp(page);
    await waitForScene(page);
    // La pastille d'état se tait quand tout va bien : sa place sert à l'installation.
    await waitOfflineReady(page);
    await expect(page.locator('.pill')).toBeHidden();
    await offerInstall(page);
    const group = page.getByRole('group', { name: 'Installer l’atelier' });
    await expect(group).toBeVisible();
    // Petite, tout en haut, hors du dock.
    const box = await group.boundingBox();
    expect(box?.height ?? 99).toBeLessThanOrEqual(40);
    expect(box?.y ?? 99).toBeLessThan(60);
    await expect(page.locator('footer.dock').getByRole('button', { name: /Installer/ })).toHaveCount(0);

    // « Plus tard » : elle disparaît, et ne revient pas au lancement suivant.
    await group.getByRole('button', { name: /^Plus tard/ }).click();
    await expect(group).toHaveCount(0);
    await reloadSaved(page);
    await waitForScene(page);
    await waitOfflineReady(page);
    await offerInstall(page);
    await expect(page.locator('.pill')).toBeHidden();
    await expect(group).toHaveCount(0);

    // Rangé, pas perdu : Atelier › Sous le capot le propose toujours.
    await openAtelier(page, 'Sous le capot');
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Installer l’atelier' })).toBeVisible();
  });
});
