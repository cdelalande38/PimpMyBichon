// La sortie de nuit se trouve du premier coup (retour du 16 novembre 2026 : « je trouve pas le
// bouton pour y accéder ») : un bouton rond de la colonne de droite ouvre Garage › Sortie.

import { expect, test } from '@playwright/test';
import { ENTREE_SORTIE, openApp, pickMap, quick, waitForScene } from './helpers.ts';

test('le bouton rond « Sortie » ouvre le choix de la carte, prêt à sortir', async ({ page }) => {
  await openApp(page);
  await waitForScene(page);
  const button = quick(page).getByRole('button', { name: ENTREE_SORTIE, exact: true });
  await expect(button).toBeVisible();
  const size = await button.boundingBox();
  expect(size?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(size?.height ?? 0).toBeGreaterThanOrEqual(48);
  await button.tap();
  const dock = page.locator('footer.dock');
  await expect(dock.locator('.dock-crumb-here')).toHaveText(ENTREE_SORTIE);
  // Le menu s'ouvre sur sa première étape, le mode (vague U : une étape à la fois).
  await expect(dock.getByRole('group', { name: 'Mode' })).toBeVisible();
  // « Sortir » n'apparaît qu'aux réglages, une carte choisie.
  await expect(dock.getByRole('button', { name: 'Sortir', exact: true })).toHaveCount(0);
  await pickMap(page);
  await expect(dock.getByRole('button', { name: 'Sortir', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/sortie-raccourci.png' });
});
