// Captures de revue des retouches de l'audit des menus, aux trois formats du rapport : 390 × 844, 844 × 390,
// 1366 × 768 (souris, sans écran tactile). Hors parcours habituels : PMB_REVUE_RETOUCHES=1.
// Sortie : captures/vague-x-retouches/<format>-<nom>.png

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DOCK_MENU } from '../../src/data/dockMenu.ts';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, DELAI_ROUTE, openApp, quick, waitForBench } from './helpers.ts';

test.skip(!process.env.PMB_REVUE_RETOUCHES, 'captures de revue : PMB_REVUE_RETOUCHES=1');

const FORMATS = [
  { nom: 'portrait', viewport: { width: 390, height: 844 }, tactile: true },
  { nom: 'paysage', viewport: { width: 844, height: 390 }, tactile: true },
  { nom: 'pc', viewport: { width: 1366, height: 768 }, tactile: false },
] as const;

const dock = (page: Page) => page.locator('footer.dock');

/** Comme openEntry (helpers.ts), au clic : le format PC n'a pas d'écran tactile. */
async function entree(page: Page, label: string): Promise<void> {
  const section = DOCK_MENU.find((item) => item.entries.some((candidate) => candidate.label === label));
  const entry = section?.entries.find((item) => item.label === label);
  if (!section || !entry) throw new Error(`entrée inconnue : ${label}`);
  const sections = dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });
  const back = dock(page).getByRole('button', { name: 'Retour', exact: true });
  for (let i = 0; i < 10 && !(await sections.isVisible()); i += 1) {
    if (!(await back.isVisible())) break;
    await back.click();
  }
  await sections.getByRole('button', { name: section.label, exact: true }).click();
  const entries = dock(page).getByRole('navigation', { name: `Entrées · ${section.label}` });
  const body = dock(page).locator(`.dock-tab[data-onglet="${entry.id}"]`);
  await expect(entries.or(body)).toBeVisible();
  if (await entries.isVisible()) await entries.getByRole('button', { name: label, exact: true }).click();
  await expect(body).toBeVisible();
}

async function photo(page: Page, format: string, nom: string): Promise<void> {
  await page.waitForTimeout(600);
  const chemin = resolve('captures', 'vague-x-retouches', `${format}-${nom}.png`);
  mkdirSync(dirname(chemin), { recursive: true });
  await page.screenshot({ path: chemin });
}

for (const format of FORMATS) {
  test.describe(`revue ${format.nom}`, () => {
    test.use({ viewport: format.viewport, isMobile: format.tactile, hasTouch: format.tactile, serviceWorkers: 'block' });
    test.setTimeout(300_000);

    test('garage et menus', async ({ page }) => {
      await openApp(page);
      await waitForBench(page);
      await photo(page, format.nom, '01-garage-repos');

      await entree(page, 'Véhicule');
      await dock(page).getByRole('group', { name: 'Véhicule' }).hover();
      await photo(page, format.nom, '02-vehicules');

      await entree(page, 'Peinture');
      await dock(page).getByRole('group', { name: 'Zones' }).hover();
      await photo(page, format.nom, '03-peinture-rangee');

      await entree(page, 'Préparation');
      await photo(page, format.nom, '04-preparation');

      await entree(page, 'Échappement');
      await dock(page).locator('.dock-tab').evaluate((element) => element.scrollTo({ top: element.scrollHeight }));
      await photo(page, format.nom, '05-echappement-bas');

      await dock(page).getByRole('button', { name: 'Fermer le menu' }).click();
      await photo(page, format.nom, '06-menu-ferme');

      await quick(page).getByRole('button', { name: 'Intérieur', exact: true }).click();
      await photo(page, format.nom, '07-vue-interieure');
      await quick(page).getByRole('button', { name: 'Vue atelier', exact: true }).click();

      await quick(page).getByRole('button', { name: 'Atelier', exact: true }).click();
      const panneau = page.getByRole('dialog');
      await panneau.getByRole('navigation', { name: 'Rubriques de l’atelier' }).getByRole('button', { name: 'Jeu', exact: true }).click();
      await expect(panneau.getByRole('heading', { name: 'Ton compte' })).toBeVisible();
      await photo(page, format.nom, '08-atelier-jeu');
    });

    test('la route', async ({ page }) => {
      await page.goto('./#/sortie');
      await expect(page.locator(`.${DRIVE_STAGE_CLASS}`)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
      await attendreApercu(page);
      await photo(page, format.nom, '09-apercu');
      await page.locator('.drive-mid').click({ position: { x: 100, y: 100 } });
      await expect(page.locator('.drive-invite')).toHaveCount(0);
      await page.waitForTimeout(3000);
      await photo(page, format.nom, '10-course');
      await page.keyboard.press('Escape');
      await expect(page.locator('.drive-pause')).toHaveAttribute('aria-pressed', 'true');
      await photo(page, format.nom, '11-pause');
    });
  });
}
