// Le duel (vague V ; src/drive/adversaire/, src/ui/drive/Duel.tsx) : au menu de la sortie, le format « Duel »
// à côté des courses, puis l'adversaire ; le départ aux feux à deux, l'adversaire à côté du joueur ; la
// position et l'écart à l'écran, l'adversaire sur la mini-carte ; à l'arrivée, le verdict (gagné), les gains
// du duel, « Revanche » en bouton principal ; contre la Comète, perdu (on la laisse filer, puis on finit),
// de combien, et « Revanche » repart aux feux. Deux parcours courts plutôt qu'un long.
// Une course entière est trop longue en rendu logiciel : comme tests/e2e/carriere.spec.ts, le parcours sert
// lui-même la route de la première carte avec ses départs posés 160 m avant le bout (au seul test).
// Captures de revue à la demande : PMB_CAPTURES_DUEL=<dossier>.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreSurLaRoute, auSec, cartesDuMenu, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, pickMap, reglerSortie, waitForScene } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_DUEL;
const PAYSAGE = { width: 844, height: 390 } as const;
const PORTRAIT = { width: 390, height: 844 } as const;
const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Le manche tenu vers le haut (direction assistée) ; rend de quoi le lâcher. */
async function tenirLeGaz(page: Page): Promise<() => Promise<void>> {
  const zone = page.locator('.drive-mid');
  const box = await zone.boundingBox();
  if (!box) throw new Error('zone des gestes introuvable');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6 - 70, { steps: 4 });
  return () => page.mouse.up();
}

test.describe('duel contre un adversaire piloté par le jeu', () => {
  test.use({ serviceWorkers: 'block' });

  /** Route servie avec les départs près du bout, menu de la sortie sur la première carte, au sec, « Duel » et l'adversaire du `niveau`. */
  async function menuDuel(page: Page, niveau: string): Promise<void> {
    const carte = cartesDuMenu()[0];
    if (!carte) throw new Error('aucune carte');
    await page.route(`**/assets/maps/${carte.id}/route.json`, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as { length: number; loop?: boolean; starts: { at: number }[] };
      if (!json.loop) for (const start of json.starts) start.at = json.length - 160;
      await route.fulfill({ response, json });
    });
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await auSec(page);
    const dock = page.locator('footer.dock');
    const puce = dock.getByRole('group', { name: 'Format' }).locator('[data-format="duel"]');
    await puce.tap();
    await expect(puce).toHaveAttribute('aria-pressed', 'true');
    await expect(dock.getByRole('group', { name: 'Format' }).locator('[aria-pressed="true"]')).toHaveCount(1);
    const choix = dock.getByRole('group', { name: 'Adversaire' }).locator(`[data-niveau="${niveau}"]`);
    await choix.tap();
    await expect(choix).toHaveAttribute('aria-pressed', 'true');
  }

  /** « Sortir », direction assistée, la course commencée (feux). */
  async function sortirEnDuel(page: Page): Promise<void> {
    await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await reglerSortie(page, 'Direction', 'Assistée');
    await commencerCourse(page);
  }

  test('menu, départ à deux, position à l’écran, arrivée gagnée', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await menuDuel(page, 'bronze');
    const dock = page.locator('footer.dock');
    const adversaires = dock.getByRole('group', { name: 'Adversaire' });
    await expect(adversaires.getByRole('button')).toHaveCount(3);
    for (const bouton of await adversaires.getByRole('button').all()) expect((await bouton.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(48);
    const sortir = dock.getByRole('button', { name: 'Sortir', exact: true });
    await expect(sortir).toHaveAttribute('data-format', 'duel');
    await expect(dock.locator('#sortie-go-format')).toContainText('Duel contre');
    await adversaires.scrollIntoViewIfNeeded();
    await photo(page, '01-menu-portrait');
    await page.setViewportSize(PAYSAGE);
    await adversaires.scrollIntoViewIfNeeded();
    await photo(page, '02-menu-paysage');
    await page.setViewportSize(PORTRAIT);

    await sortirEnDuel(page);
    // Départ aux feux, à deux : l'adversaire est sur la ligne (sa position est publiée), la course n'est pas partie.
    await expect(stage(page)).toHaveAttribute('data-duel-verdict', 'non', { timeout: DELAI_ROUTE });
    await photo(page, '03-grille-portrait');
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
    const position = page.locator('.duel-position');
    await expect(position).toHaveAttribute('data-visible', 'oui', { timeout: DELAI_ROUTE });
    await expect(position.locator('b')).toHaveText(/^(1er|2e)$/);
    await expect(position.locator('span')).toHaveText(/^\d+,\d s (d’avance|de retard)$/);
    // Le joueur file (plein gaz) : il passe devant Dédé, l'écart le dit, la mini-carte montre l'adversaire.
    const lacher = await tenirLeGaz(page);
    await attendreSurLaRoute(page, 'en tête du duel', () => stage(page).getAttribute('data-duel-position'), (v) => v === '1', { secondes: 40, horloge: 240_000, intervalle: 300 });
    await expect(page.locator('.minicarte')).toHaveAttribute('data-adversaire', /^(cadre|hors)$/);
    await photo(page, '04-course-position-portrait');
    const fin = page.locator('.fin-course');
    await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 60, horloge: 300_000, intervalle: 500 });
    await lacher();
    const verdict = fin.locator('.duel-verdict');
    await expect(verdict).toHaveAttribute('data-duel', 'gagne');
    await expect(verdict).toContainText('Duel gagné');
    await expect(fin.locator('.fin-course-actes').getByRole('button').first()).toHaveText(/Revanche/);
    await expect(fin.getByRole('button', { name: /Rejouer/ })).toHaveCount(0);
    await fin.locator('.fin-course-defile').click();
    await expect(fin.locator('.fin-course-gains')).toContainText('Duel gagné contre');
    await expect(fin.locator('.fin-course-gains')).toContainText('Première victoire à ce niveau');
    await photo(page, '05-fin-gagne-portrait');
    expect(errors).toEqual([]);
  });

  test('contre la Comète, on la laisse filer puis on finit : perdu, de combien', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await menuDuel(page, 'or');
    await sortirEnDuel(page);
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
    await attendreSurLaRoute(page, 'adversaire devant', () => stage(page).getAttribute('data-duel-position'), (v) => v === '2', { secondes: 20, horloge: 180_000, intervalle: 300 });
    await attendreSurLaRoute(page, 'adversaire bien devant', () => stage(page).getAttribute('data-duel-ecart'), (v) => Number(v) >= 15, { secondes: 30, horloge: 180_000, intervalle: 300 });
    await page.setViewportSize(PAYSAGE);
    await photo(page, '06-adversaire-devant-paysage');
    await page.setViewportSize(PORTRAIT);
    const fin = page.locator('.fin-course');
    const lacher = await tenirLeGaz(page);
    await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 90, horloge: 300_000, intervalle: 500 });
    await lacher();
    await expect(fin.locator('.duel-verdict')).toHaveAttribute('data-duel', 'perdu');
    await expect(fin.locator('.duel-verdict')).toContainText(/passe la ligne \d+,\d s avant toi/);
    await fin.locator('.fin-course-defile').click();
    await page.setViewportSize(PAYSAGE);
    await photo(page, '07-fin-perdu-paysage');
    // Revanche : retour sur la ligne, aux feux, à deux.
    await fin.locator('.fin-course-actes').getByRole('button', { name: 'Revanche' }).tap();
    await expect(fin).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute('data-duel-verdict', 'non', { timeout: DELAI_ROUTE });
    expect(errors).toEqual([]);
  });
});
