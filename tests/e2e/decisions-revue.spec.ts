import { expect, test, type Page } from '@playwright/test';
import { openApp, quick, waitForBench, waitForScene } from './helpers.ts';

// Captures de revue de la vague X, lot « decisions » (22 novembre 2026) : le garage menu fermé en paysage,
// Custom rangé en familles, « Ton compte ». Derrière PMB_CAPTURES_DECISIONS (dossier de sortie).
const DOSSIER = process.env.PMB_CAPTURES_DECISIONS;
test.skip(!DOSSIER, 'PMB_CAPTURES_DECISIONS non posé');

const dock = (page: Page) => page.locator('footer.dock');
const ECRANS = [
  { nom: '390x844', width: 390, height: 844 },
  { nom: '844x390', width: 844, height: 390 },
] as const;

for (const ecran of ECRANS) {
  test.describe(`revue ${ecran.nom}`, () => {
    test.use({ viewport: { width: ecran.width, height: ecran.height } });

    test('garage, Custom regroupé, Ton compte', async ({ page }) => {
      test.setTimeout(300_000);
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);
      const paysage = ecran.width > ecran.height;
      if (paysage) {
        await expect(dock(page)).toHaveAttribute('data-taille', 'ferme');
        await page.screenshot({ path: `${DOSSIER}/${ecran.nom}-garage-menu-ferme.png` });
        await dock(page).getByRole('button', { name: 'Personnaliser', exact: true }).tap();
      } else {
        await page.screenshot({ path: `${DOSSIER}/${ecran.nom}-garage-sections.png` });
      }
      await dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' }).getByRole('button', { name: 'Custom', exact: true }).tap();
      await expect(dock(page).getByRole('navigation', { name: 'Entrées · Custom' })).toBeVisible();
      await page.screenshot({ path: `${DOSSIER}/${ecran.nom}-custom-regroupe.png` });
      if (!paysage) {
        // La rangée défile : la fin, avec Habitacle.
        await dock(page).getByRole('navigation', { name: 'Entrées · Custom' }).evaluate((nav) => nav.scrollTo({ left: nav.scrollWidth }));
        await page.screenshot({ path: `${DOSSIER}/${ecran.nom}-custom-regroupe-fin.png` });
      }
      await quick(page).getByRole('button', { name: 'Atelier', exact: true }).tap();
      await page.getByRole('navigation', { name: 'Rubriques de l’atelier' }).getByRole('button', { name: 'Ton compte', exact: true }).tap();
      await expect(page.getByRole('dialog', { name: 'Ton compte' })).toBeVisible();
      await page.screenshot({ path: `${DOSSIER}/${ecran.nom}-ton-compte.png` });
    });
  });
}
