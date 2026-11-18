import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { choisirCamera, ENTREE_SORTIE, fermerReglages, openApp, openEntry, ouvrirReglages, pickMap, rentrerAuGarage, waitForBench, waitForScene } from './helpers.ts';

// Sortie de nuit : la caméra « embarquée » se pose à la place du conducteur du manifeste (œil posé
// sur son siège, comme au garage), pas au-dessus du toit. Séquence de captures de revue :
// PMB_CAPTURES (dossier), sinon captures/places/.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

test('sortie de nuit : la caméra embarquée est à la place du conducteur de la Cox', async ({ page }) => {
  test.setTimeout(480_000);
  const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'places');
  mkdirSync(dir, { recursive: true });
  await openApp(page);
  await waitForScene(page);
  await waitForBench(page);
  await openEntry(page, 'Véhicule');
  await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="cox"]').tap();
  await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', 'cox');
  await waitForBench(page);
  await openEntry(page, ENTREE_SORTIE);
  await pickMap(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
  // La caméra embarquée, choisie dans les réglages (l'aperçu roule derrière).
  await choisirCamera(page, 'Embarquée');
  await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
  const panneau = await ouvrirReglages(page);
  await expect(panneau.getByRole('group', { name: 'Caméra' }).getByRole('button', { name: 'Embarquée', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(panneau.getByRole('button', { name: 'Réalisateur' })).toHaveAttribute('aria-pressed', 'false');
  await fermerReglages(page);
  await expect.poll(async () => Number(await stage(page).getAttribute('data-vitesse')), { timeout: 90_000 }).toBeGreaterThan(10);
  for (let i = 1; i <= 3; i += 1) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(dir, `sortie-embarquee-cox-${i}.png`) });
    await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
  }
  await rentrerAuGarage(page);
});
