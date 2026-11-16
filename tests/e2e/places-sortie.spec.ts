import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { openApp, openEntry, waitForBench, waitForScene } from './helpers.ts';

// Sortie de nuit : la caméra « embarquée » se pose à la place du conducteur du manifeste (œil posé
// sur son siège, comme au garage), pas au-dessus du toit. Séquence de captures de revue :
// PMB_CAPTURES (dossier), sinon captures/places/.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Commandes de la sortie' });

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
  await openEntry(page, 'Sortie de nuit');
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
  // Une caméra à la fois : on attend que la scène ait posé la suivante avant de rappuyer.
  for (let i = 0; i < 6; i += 1) {
    const camera = (await stage(page).getAttribute('data-camera')) ?? '';
    if (camera === 'embarquee') break;
    await bar(page).getByRole('button', { name: 'Caméra suivante' }).tap();
    await expect(stage(page)).not.toHaveAttribute('data-camera', camera);
  }
  await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
  await expect(bar(page).getByRole('button', { name: 'Caméra suivante' })).toContainText('Embarqu');
  await expect.poll(async () => Number(await stage(page).getAttribute('data-vitesse')), { timeout: 90_000 }).toBeGreaterThan(10);
  for (let i = 1; i <= 3; i += 1) {
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(dir, `sortie-embarquee-cox-${i}.png`) });
    await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
  }
  await bar(page).getByRole('button', { name: 'Rentrer au garage' }).tap();
});
