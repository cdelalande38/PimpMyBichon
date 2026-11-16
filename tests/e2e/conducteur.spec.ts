import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { openApp, openEntry, pickMap, waitForBench, waitForScene, rentrerAuGarage } from './helpers.ts';

// Le conducteur à bord en sortie de nuit (demande du 16 novembre 2026 : « il manque un pilote au
// volant », « les motos il faut bien retirer la béquille pendant les sorties ») : il s'assoit dans la
// Cox ; à la caméra embarquée, sa tête et son buste sont cachés (on voit ses mains au volant) ; sur
// le bobber, la béquille d'atelier est relevée. Captures de revue : PMB_CAPTURES (dossier), sinon
// captures/conducteur/.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Commandes de la sortie' });

async function sortie(page: Page, vehicle: string): Promise<void> {
  await openEntry(page, 'Véhicule');
  await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${vehicle}"]`).tap();
  await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', vehicle);
  await waitForBench(page);
  await openEntry(page, 'Sortie de nuit');
  await pickMap(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
}

test('sortie de nuit : le conducteur est au volant de la Cox, la béquille du bobber est relevée', async ({ page }) => {
  test.setTimeout(600_000);
  const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'conducteur');
  mkdirSync(dir, { recursive: true });
  await openApp(page);
  await waitForScene(page);
  await waitForBench(page);
  await sortie(page, 'cox');
  await expect(stage(page)).toHaveAttribute('data-conducteur', /assis|tete-cachee/, { timeout: 60_000 });
  // Caméra embarquée : à son œil, sa tête et son buste disparaissent.
  for (let i = 0; i < 6; i += 1) {
    const camera = (await stage(page).getAttribute('data-camera')) ?? '';
    if (camera === 'embarquee') break;
    await bar(page).getByRole('button', { name: 'Caméra suivante' }).tap();
    await expect(stage(page)).not.toHaveAttribute('data-camera', camera);
  }
  await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
  await expect(stage(page)).toHaveAttribute('data-conducteur', 'tete-cachee', { timeout: 30_000 });
  await page.screenshot({ path: resolve(dir, 'conducteur-cox-embarquee.png') });
  // Une autre caméra : il réapparaît entier.
  await bar(page).getByRole('button', { name: 'Caméra suivante' }).tap();
  await expect(stage(page)).not.toHaveAttribute('data-camera', 'embarquee');
  await expect(stage(page)).toHaveAttribute('data-conducteur', 'assis', { timeout: 30_000 });
  await page.screenshot({ path: resolve(dir, 'conducteur-cox-suivante.png') });
  // Pas de béquille sur une voiture.
  await expect(stage(page)).not.toHaveAttribute('data-bequille', /.*/);
  await rentrerAuGarage(page);
  await expect(stage(page)).toHaveCount(0);
  await waitForScene(page);
  await waitForBench(page);
  // Le bobber : motard à bord, béquille d'atelier relevée pour toute la sortie.
  await sortie(page, 'bobber');
  await expect(stage(page)).toHaveAttribute('data-bequille', 'relevee');
  await expect(stage(page)).toHaveAttribute('data-conducteur', /assis|tete-cachee/, { timeout: 60_000 });
  await page.screenshot({ path: resolve(dir, 'conducteur-bobber.png') });
});
