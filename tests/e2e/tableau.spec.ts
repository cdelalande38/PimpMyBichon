import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { choisirCamera, choisirDepart, ENTREE_SORTIE, openApp, openEntry, pickMap, waitForBench, waitForScene } from './helpers.ts';

// Tableau de bord vivant (demande du 16 novembre 2026 : « le compteur reste à 0, ça serait top qu'il
// soit synchro avec le vrai compteur »). À la caméra embarquée, la vitesse affichée au tableau de
// bord (`data-tableau` sur la scène) est celle du compteur de l'écran (`data-vitesse`) ; au garage, en
// vue intérieure, les instruments restent à zéro. Captures de revue : PMB_CAPTURES (dossier), sinon
// captures/vague-p-tableau/.
//
// Vague R (lot « cadrans ») : la vitesse se lit derrière le volant. Le dernier parcours prend des captures
// de la vue conducteur (garage, puis caméra embarquée de la sortie : volant droit, en portrait et en
// paysage, puis volant braqué dans le lacet), dans PMB_CAPTURES ou captures/vague-r-cadrans/. Les manifestes
// des véhicules sont lus à la construction du site (pas à l'exécution) : pour comparer avec l'état d'avant, on
// reconstruit le site avec les anciens manifestes et PMB_AVANT=1 (les captures prennent alors le suffixe « avant »).
// PMB_RAPIDE=1 saute le volant braqué. Ces captures ne se prennent que si PMB_VUE_CONDUCTEUR=1. La mesure chiffrée est un test unitaire
// (tests/unit/tableau-vue.test.ts).

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function choisir(page: Page, vehicle: string): Promise<void> {
  await openEntry(page, 'Véhicule');
  await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${vehicle}"]`).tap();
  await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', vehicle);
  await waitForBench(page);
}

async function sortir(page: Page): Promise<void> {
  await openEntry(page, ENTREE_SORTIE);
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

// ---------------------------------------------------------------------------------------------
// Vague R : captures de la vue conducteur, avant et après (390 × 844 ; 844 × 390 à la caméra embarquée).

const AVANT = process.env.PMB_AVANT;
const PHASE = AVANT ? 'avant' : 'apres';

test.describe('vue conducteur : captures de revue', () => {
  for (const vehicle of ['concept', 'cox', 'van']) {
    test(`vue conducteur (${vehicle}, ${PHASE}) : garage, caméra embarquée droite et braquée`, async ({ page }) => {
      test.skip(!process.env.PMB_VUE_CONDUCTEUR, 'captures de revue : PMB_VUE_CONDUCTEUR=1');
      test.setTimeout(900_000);
      const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'vague-r-cadrans');
      mkdirSync(dir, { recursive: true });
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);
      await choisir(page, vehicle);
      // Garage, vue intérieure du conducteur (volant droit).
      await openEntry(page, 'Intérieur');
      await expect(page.locator('.stage')).toHaveAttribute('data-vue', 'interieur', { timeout: 15_000 });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: resolve(dir, `${vehicle}-garage-${PHASE}.png`) });
      // Sortie de nuit, départ au bas de la rampe, caméra embarquée.
      await openEntry(page, ENTREE_SORTIE);
      await pickMap(page);
      await choisirDepart(page, /rampe/i);
      await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
      await embarquee(page);
      await expect(stage(page)).toHaveAttribute('data-tableau', /^\d+$/, { timeout: 60_000 });
      await scenePropre(page, resolve(dir, `${vehicle}-embarquee-portrait-${PHASE}.png`));
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(2500);
      await scenePropre(page, resolve(dir, `${vehicle}-embarquee-paysage-${PHASE}.png`));
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(1500);
      if (process.env.PMB_RAPIDE) return;
      // Volant braqué : on roule jusqu'au lacet (vers 224 à 246 m) et on prend la scène au plus fort du braquage.
      await page.evaluate((cls) => {
        const el = document.querySelector<HTMLElement>(`.${cls}`);
        (window as unknown as { __braque: number[] }).__braque = [];
        new MutationObserver(() => (window as unknown as { __braque: number[] }).__braque.push(Number(el?.dataset.braquage))).observe(el!, { attributes: true, attributeFilter: ['data-braquage'] });
      }, DRIVE_STAGE_CLASS);
      let pris = false;
      await expect
        .poll(
          async () => {
            const lu = await page.evaluate((cls) => {
              const el = document.querySelector<HTMLElement>(`.${cls}`);
              return { s: Number(el?.dataset.s), braquage: Number(el?.dataset.braquage) };
            }, DRIVE_STAGE_CLASS);
            if (!pris && lu.s > 225 && lu.s < 250 && Math.abs(lu.braquage) >= 4) {
              pris = true;
              await scenePropre(page, resolve(dir, `${vehicle}-embarquee-braque-${PHASE}.png`));
            }
            return lu.s;
          },
          { timeout: 600_000, intervals: [400] },
        )
        .toBeGreaterThan(255);
      expect(pris, 'le lacet a été pris en capture').toBe(true);
    });
  }
});
