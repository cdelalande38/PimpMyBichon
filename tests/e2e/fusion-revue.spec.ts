// Revue de la fusion (vague X, 21 novembre 2026) : l'en-tête du menu avec « Jouer » à toute profondeur, en portrait
// (360 × 780 texte très grand, 390 × 844) et en paysage (844 × 390), plus l'Atelier en paysage. Seulement avec
// PMB_CAPTURES_FUSION=1 ; captures dans captures/vague-x-fusion/.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { backToSections, openApp, openEntry, quick, waitForBench, waitForScene } from './helpers.ts';

const ACTIF = Boolean(process.env.PMB_CAPTURES_FUSION);
const FORMATS = [
  { nom: '360x780-tres-grand', viewport: { width: 360, height: 780 }, texte: 'Très grand' },
  { nom: '390x844', viewport: { width: 390, height: 844 }, texte: 'Normal' },
  { nom: '844x390', viewport: { width: 844, height: 390 }, texte: 'Normal' },
  { nom: '844x390-tres-grand', viewport: { width: 844, height: 390 }, texte: 'Très grand' },
] as const;

const dock = (page: Page) => page.locator('footer.dock');

async function photo(page: Page, format: string, nom: string): Promise<void> {
  const dir = resolve('captures', 'vague-x-fusion');
  mkdirSync(dir, { recursive: true });
  await page.waitForTimeout(600);
  await page.screenshot({ path: resolve(dir, `${format}-${nom}.png`) });
}

for (const f of FORMATS) {
  test.describe(`revue fusion · ${f.nom}`, () => {
    test.skip(!ACTIF, 'PMB_CAPTURES_FUSION=1 pour lancer la revue');
    test.use({ viewport: f.viewport });

    test('en-tête du menu avec « Jouer », Atelier', async ({ page }) => {
      test.setTimeout(150_000);
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);
      if (f.texte !== 'Normal') {
        await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
        const dialog = page.getByRole('dialog', { name: 'Réglages' });
        await dialog.getByRole('button', { name: 'Texte' }).click();
        await dialog.getByRole('button', { name: new RegExp(`^${f.texte}`) }).click();
        await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
        await expect(dialog).toBeHidden();
      }
      await backToSections(page);
      await photo(page, f.nom, '1-sections');
      await openEntry(page, 'Véhicule');
      await photo(page, f.nom, '2-vehicule');
      // Un nom court (« La Cox ») : « Au garage » ne doit pas s'émietter sur trois lignes au-dessus.
      await dock(page).getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="cox"]').tap();
      await expect(dock(page).locator('.dock-vehicle')).toHaveText('La Cox');
      await waitForBench(page);
      await photo(page, f.nom, '2b-vehicule-cox');
      await dock(page).getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="concept"]').tap();
      await expect(dock(page).locator('.dock-vehicle')).toHaveText('Le concept');
      await waitForBench(page);
      await openEntry(page, 'Peinture');
      await dock(page).locator('.paint-zone-pair .paint-zone').first().click();
      await expect(dock(page).locator('.dock-crumb-here')).toHaveText('Couleur');
      await photo(page, f.nom, '3-peinture-couleur');
      await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toBeInViewport({ ratio: 1 });
      await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
      await expect(page.getByRole('dialog', { name: 'Réglages' })).toBeVisible();
      await photo(page, f.nom, '4-atelier');
    });
  });
}
