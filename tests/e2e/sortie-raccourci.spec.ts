// La sortie de nuit se trouve du premier coup (retour du 16 novembre 2026 : « je trouve pas le
// bouton pour y accéder ») : un bouton rond de la colonne de droite ouvre Garage › Sortie de nuit.

import { expect, test } from '@playwright/test';
import { openApp, quick, waitForScene } from './helpers.ts';

test('le bouton rond « Sortie de nuit » ouvre le choix de la carte, prêt à sortir', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const button = quick(page).getByRole('button', { name: 'Sortie de nuit', exact: true });
  await expect(button).toBeVisible();
  const size = await button.boundingBox();
  expect(size?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(size?.height ?? 0).toBeGreaterThanOrEqual(48);
  await button.tap();
  const dock = page.locator('footer.dock');
  await expect(dock.locator('.dock-crumb-here')).toHaveText('Sortie de nuit');
  await expect(dock.getByRole('group', { name: 'Carte' })).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Sortir', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/sortie-raccourci.png' });
});
