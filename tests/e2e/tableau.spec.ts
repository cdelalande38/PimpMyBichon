import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { choisirCamera, openApp, openEntry, pickMap, waitForBench, waitForScene } from './helpers.ts';

// Tableau de bord vivant (demande du 16 novembre 2026 : « le compteur reste à 0, ça serait top qu'il
// soit synchro avec le vrai compteur »). À la caméra embarquée, la vitesse affichée au tableau de
// bord (`data-tableau` sur la scène) est celle du compteur de l'écran (`data-vitesse`) ; au garage, en
// vue intérieure, les instruments restent à zéro. Captures de revue : PMB_CAPTURES (dossier), sinon
// captures/vague-p-tableau/.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function choisir(page: Page, vehicle: string): Promise<void> {
  await openEntry(page, 'Véhicule');
  await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${vehicle}"]`).tap();
  await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', vehicle);
  await waitForBench(page);
}

async function sortir(page: Page): Promise<void> {
  await openEntry(page, 'Sortie de nuit');
  await pickMap(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
}

async function embarquee(page: Page): Promise<void> {
  await choisirCamera(page, 'Embarquée');
  await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
}

/** Capture de la scène seule (l'interface, qui masque le bas de l'écran, est cachée le temps de la prise). */
async function scenePropre(page: Page, path: string): Promise<void> {
  const style = await page.addStyleTag({ content: `body * { visibility: hidden !important; } .${DRIVE_STAGE_CLASS}, .${DRIVE_STAGE_CLASS} * { visibility: visible !important; }` });
  await page.screenshot({ path });
  await style.evaluate((node) => (node as Element).remove());
}

/** Vitesse du compteur de l'écran et vitesse du tableau, lues dans la même image du navigateur. */
async function lire(page: Page): Promise<{ ecran: number; tableau: number }> {
  return page.evaluate((cls) => {
    const el = document.querySelector<HTMLElement>(`.${cls}`);
    return { ecran: Number(el?.dataset.vitesse ?? Number.NaN), tableau: Number(el?.dataset.tableau ?? Number.NaN) };
  }, DRIVE_STAGE_CLASS);
}

for (const vehicle of ['concept', 'cox', 'van']) {
  test(`sortie de nuit : le tableau de bord suit le compteur (${vehicle})`, async ({ page }) => {
    test.setTimeout(600_000);
    const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'vague-p-tableau');
    mkdirSync(dir, { recursive: true });
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await choisir(page, vehicle);
    await sortir(page);
    await embarquee(page);
    await scenePropre(page, resolve(dir, `${vehicle}-embarquee-propre.png`));
    // Un véhicule dont le manifeste ne déclare aucun instrument n'a pas de valeur à publier : le parcours le dit.
    const declare = await page.evaluate(async (id) => {
      const reponse = await fetch(`./assets/vehicles/${id}/vehicle.json`);
      const manifeste = (await reponse.json()) as { cabin?: { panels?: { instrument?: unknown }[] } };
      return (manifeste.cabin?.panels ?? []).some((panel) => panel.instrument !== undefined);
    }, vehicle);
    test.skip(!declare, `${vehicle} ne déclare aucun instrument`);
    await expect(stage(page)).toHaveAttribute('data-tableau', /^\d+$/, { timeout: 60_000 });
    await page.screenshot({ path: resolve(dir, `${vehicle}-embarquee-depart.png`) });
    // La vitesse monte, le tableau la suit (même arrondi que le compteur de l'écran).
    await expect.poll(async () => (await lire(page)).ecran, { timeout: 150_000 }).toBeGreaterThan(20);
    // À vitesse stabilisée, le tableau montre exactement le compteur de l'écran.
    await expect
      .poll(
        async () => {
          const { ecran, tableau } = await lire(page);
          return Number.isFinite(tableau) && ecran > 20 && ecran === tableau;
        },
        { timeout: 150_000, intervals: [300] },
      )
      .toBe(true);
    await page.screenshot({ path: resolve(dir, `${vehicle}-embarquee-roule.png`) });
    // Une autre caméra : plus rien n'est affiché (la valeur disparaît).
    await choisirCamera(page, 'Bord de route');
    await expect(stage(page)).not.toHaveAttribute('data-camera', 'embarquee');
    await expect(stage(page)).not.toHaveAttribute('data-tableau', /.*/);
  });
}

test('garage, vue intérieure : les instruments restent à zéro', async ({ page }) => {
  test.setTimeout(300_000);
  const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'vague-p-tableau');
  mkdirSync(dir, { recursive: true });
  await openApp(page);
  await waitForScene(page);
  await waitForBench(page);
  for (const vehicle of ['concept', 'van']) {
    await choisir(page, vehicle);
    await openEntry(page, 'Intérieur');
    await expect(page.locator('.stage')).toHaveAttribute('data-vue', 'interieur', { timeout: 15_000 });
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(dir, `garage-${vehicle}-interieur.png`) });
  }
});
