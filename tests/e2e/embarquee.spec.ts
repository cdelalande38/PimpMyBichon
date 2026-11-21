import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreRoute, choisirCamera, ENTREE_SORTIE, fermerReglages, openApp, openEntry, ouvrirReglages, pickMap, reglerSortie, reloadSaved, rentrerAuGarage, waitForBench, waitForScene } from './helpers.ts';

// Caméra embarquée : voir la route depuis l'intérieur (vague U, demande du 18 novembre 2026 : « on voit
// pas assez la route, il faudrait qu'on puisse prendre un peu plus de hauteur »). Le réglage « Hauteur du
// regard » des réglages de la sortie (rubrique Vue) ne se montre qu'à la caméra embarquée, s'applique à la
// scène (`data-regard`) et se retrouve après un rechargement.
//
// Captures de revue, à la demande seulement (PMB_CAPTURES_EMBARQUEE=1) : chaque véhicule de jour, à la
// caméra embarquée, en paysage 844 × 390 (et en portrait 390 × 844 pour la Cox et le bobber), dans
// PMB_CAPTURES ou captures/vague-u-embarquee/, suffixe PMB_PHASE (« apres » par défaut). La mesure chiffrée
// de la part prise par l'habitacle est un test unitaire (tests/unit/embarquee-route.test.ts).

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function choisirVehicule(page: Page, vehicle: string): Promise<void> {
  await openEntry(page, 'Véhicule');
  await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${vehicle}"]`).tap();
  await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', vehicle);
  await waitForBench(page);
}

/** Part la sortie sur la carte de rang `carte` (Monaco, le circuit, pour les captures). */
async function sortir(page: Page, carte = 0): Promise<void> {
  await openEntry(page, ENTREE_SORTIE);
  await pickMap(page, carte);
  await page.locator('footer.dock').getByRole('button', { name: 'Jouer', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
}

test('caméra embarquée : la hauteur du regard se règle, s’applique et se retrouve après un rechargement', async ({ page }) => {
  test.setTimeout(600_000);
  await openApp(page);
  await waitForScene(page);
  await waitForBench(page);
  await sortir(page);
  await attendreRoute(page);
  // Pas à la poursuite : le réglage ne se montre qu'à la caméra embarquée.
  let panneau = await ouvrirReglages(page);
  await expect(panneau.getByRole('group', { name: 'Hauteur du regard' })).toHaveCount(0);
  await fermerReglages(page);
  await choisirCamera(page, 'Embarquée');
  await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
  await expect(stage(page)).toHaveAttribute('data-regard', 'normal', { timeout: 60_000 });
  // L'œil de conduite est posé : sa hauteur (cm) est publiée sur la scène.
  await expect(stage(page)).toHaveAttribute('data-oeil', /^\d+$/, { timeout: 150_000 });
  const normal = Number(await stage(page).getAttribute('data-oeil'));
  // Chaque cran offre 48 px au doigt.
  panneau = await ouvrirReglages(page);
  const crans = panneau.getByRole('group', { name: 'Hauteur du regard' }).getByRole('button');
  if (process.env.PMB_CAPTURES_EMBARQUEE) {
    const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'vague-u-embarquee');
    mkdirSync(dir, { recursive: true });
    await panneau.getByRole('group', { name: 'Hauteur du regard' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: resolve(dir, 'reglages-hauteur-du-regard-portrait.png') });
  }
  expect(await crans.count()).toBeGreaterThanOrEqual(3);
  for (let i = 0; i < (await crans.count()); i += 1) {
    const boite = await crans.nth(i).boundingBox();
    expect(boite?.height ?? 0).toBeGreaterThanOrEqual(48);
  }
  await fermerReglages(page);
  await reglerSortie(page, 'Hauteur du regard', 'Haut');
  await expect(stage(page)).toHaveAttribute('data-regard', 'haut', { timeout: 60_000 });
  // L'œil monte (de quelques centimètres : le pavillon l'arrête avant le cran le plus haut sur certains habitacles).
  await expect.poll(async () => Number(await stage(page).getAttribute('data-oeil')), { timeout: 60_000 }).toBeGreaterThan(normal);
  console.log(`hauteur de l'œil : normal ${normal} cm, haut ${await stage(page).getAttribute('data-oeil')} cm`);
  await reloadSaved(page);
  // La sortie reprend (lien direct) ou le garage revient : on y retourne.
  const garage = page.getByRole('heading', { level: 1, name: 'PimpMyBichon' });
  await expect(stage(page).or(garage).first()).toBeVisible({ timeout: 60_000 });
  if ((await stage(page).count()) === 0) {
    await waitForScene(page);
    await sortir(page);
  }
  // Le cran est relu de la sauvegarde ; la sortie repart en aperçu (réalisateur) : on reprend l'embarquée.
  await expect(stage(page)).toHaveAttribute('data-regard', 'haut', { timeout: 150_000 });
  await attendreRoute(page);
  await choisirCamera(page, 'Embarquée');
  await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
  panneau = await ouvrirReglages(page);
  await expect(panneau.getByRole('group', { name: 'Hauteur du regard' }).getByRole('button', { name: 'Haut', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await fermerReglages(page);
  await rentrerAuGarage(page);
});

// ---------------------------------------------------------------------------------------------
// Captures de revue (PMB_CAPTURES_EMBARQUEE=1).

const PHASE = process.env.PMB_PHASE ?? 'apres';
/** Rang de « Monaco, le circuit » dans le menu (cartes triées par `order`) : la carte de la capture du commanditaire. */
const MONACO_CIRCUIT = 2;
const PORTRAIT = new Set(['cox', 'bobber']);

test.describe('caméra embarquée : captures de revue', () => {
  for (const vehicle of ['concept', 'cox', 'van', 'bobber', 'sportive']) {
    test(`${vehicle}, de jour, caméra embarquée (${PHASE})`, async ({ page }) => {
      test.skip(!process.env.PMB_CAPTURES_EMBARQUEE, 'captures de revue : PMB_CAPTURES_EMBARQUEE=1');
      test.setTimeout(600_000);
      const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'vague-u-embarquee');
      mkdirSync(dir, { recursive: true });
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);
      await choisirVehicule(page, vehicle);
      await sortir(page, MONACO_CIRCUIT);
      await attendreRoute(page);
      await reglerSortie(page, 'Moment', 'Jour');
      await reglerSortie(page, 'Météo', 'Sec');
      await choisirCamera(page, 'Embarquée');
      await expect(stage(page)).toHaveAttribute('data-camera', 'embarquee');
      if (process.env.PMB_REGARD) await reglerSortie(page, 'Hauteur du regard', process.env.PMB_REGARD);
      await expect.poll(async () => Number(await stage(page).getAttribute('data-vitesse')), { timeout: 150_000 }).toBeGreaterThan(15);
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForTimeout(3000);
      await page.screenshot({ path: resolve(dir, `${vehicle}-paysage-${PHASE}.png`) });
      if (PORTRAIT.has(vehicle)) {
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForTimeout(3000);
        await page.screenshot({ path: resolve(dir, `${vehicle}-portrait-${PHASE}.png`) });
      }
    });
  }
});
