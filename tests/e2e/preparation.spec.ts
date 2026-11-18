// Préparer son véhicule pour la météo (vague U) : dans Roues › Pneus et dans Suspension, chaque option dit
// son terrain (« Sec : +, pluie : −, neige : − − ») ; les nouveautés (les slicks, l'assiette rehaussée) se
// voient avec leur cadenas et leur prix, s'achètent sur place par le bloc d'achat partagé et se posent une
// fois payées ; le curseur de hauteur descend alors sous l'origine. Captures de revue à la demande :
// PMB_CAPTURES_PREPARATION=<dossier>.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openApp, openEntry, readBuilds, reloadSaved, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_PREPARATION;

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Écrit dans IndexedDB la sauvegarde du jeu et celle des builds, puis relance l'app qui les relit. */
async function poserSauvegarde(page: Page, saves: { jeu: Record<string, unknown>; builds: Record<string, unknown> }): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          const store = transaction.objectStore('kv');
          store.put(JSON.stringify({ state: value.jeu, version: 1 }), 'pmb-jeu');
          store.put(JSON.stringify({ state: value.builds, version: 1 }), 'pmb-builds');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    saves,
  );
  await reloadSaved(page);
  await waitForScene(page);
}

const dock = (page: Page) => page.locator('footer.dock');

/** La sauvegarde du jeu : solde et articles acquis. */
async function jeuSauve(page: Page): Promise<{ solde?: number; articles?: Record<string, unknown> } | null> {
  return page.evaluate(
    () =>
      new Promise<{ solde?: number; articles?: Record<string, unknown> } | null>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction('kv', 'readonly').objectStore('kv').get('pmb-jeu');
          read.onsuccess = () => {
            const raw = read.result as string | undefined;
            done(raw ? (JSON.parse(raw) as { state: { solde?: number; articles?: Record<string, unknown> } }).state : null);
          };
          read.onerror = () => fail(read.error);
        };
      }),
  );
}

/** Le build sauvegardé de la Cox : postes et curseurs. */
async function coxSauve(page: Page): Promise<{ parts?: Record<string, string>; tune?: Record<string, number> } | undefined> {
  return (await readBuilds(page))?.builds.cox as { parts?: Record<string, string>; tune?: Record<string, number> } | undefined;
}
/** Espace fine insécable (avant les deux-points, entre « − − »). */
const NNBSP = '\u202f';
const TERRAIN = new RegExp(`^Sec${NNBSP}: [^,]+, pluie${NNBSP}: [^,]+, neige${NNBSP}: [^,]+$`);

test.describe('préparation : pneus et assiette selon la météo', () => {
  test('chaque pneu et chaque assiette dit son terrain ; slicks et assiette rehaussée s’achètent et se posent', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { jeu: { solde: 320, articles: {}, hautsFaits: {}, cumuls: {} }, builds: { current: 'cox', builds: {}, recents: [] } });
    await waitForBench(page);

    // Roues › Pneus : une ligne de terrain par pneu ; les slicks, cadenas et prix.
    await openEntry(page, 'Roues');
    const roues = dock(page).locator('.dock-tab[data-onglet="roues"]');
    await roues.getByRole('button', { name: 'Pneus', exact: true }).tap();
    for (const id of ['route', 'flanc_blanc', 'lettrage', 'tout_terrain', 'piste']) {
      await expect(roues.locator(`[data-terrain="${id}"]`)).toBeVisible();
      expect(await roues.locator(`[data-terrain="${id}"]`).textContent(), id).toMatch(TERRAIN);
    }
    await expect(roues.locator('[data-terrain="piste"]')).toHaveText('Sec : + +, pluie : − −, neige : − −');
    const slick = roues.locator('[data-pneu="piste"]');
    await expect(slick).toHaveAttribute('data-verrou', 'ferme');
    await expect(slick).toContainText('180');
    await expect(roues.locator('[data-pneu="route"]')).not.toHaveAttribute('data-verrou', 'ferme');
    await slick.scrollIntoViewIfNeeded();
    await waitForStill(page);
    await photo(page, '1-pneus-terrain');
    for (const button of await roues.locator('button').all()) if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    await slick.tap();
    const achatSlick = roues.getByRole('group', { name: 'Acheter Slicks' });
    await expect(achatSlick).toContainText('les slicks');
    await photo(page, '2-pneus-achat');
    await achatSlick.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(slick).toHaveAttribute('aria-pressed', 'true');
    await expect(slick).not.toHaveAttribute('data-verrou', 'ferme');
    await expect(roues.getByRole('status')).toContainText('Slicks débloqués');
    await expect.poll(async () => (await coxSauve(page))?.parts?.pneus).toBe('piste');

    // Suspension : quatre assiettes, chacune son terrain ; la rehaussée est à débloquer.
    await openEntry(page, 'Suspension');
    const suspension = dock(page).locator('.dock-tab[data-onglet="suspension"]');
    for (const id of ['rehaussee', 'origine', 'rabaissee', 'au_sol']) expect(await suspension.locator(`[data-terrain="${id}"]`).textContent(), id).toMatch(TERRAIN);
    await expect(suspension.locator('[data-terrain="au_sol"]')).toHaveText('Sec : + +, pluie : =, neige : − −');
    const haute = suspension.locator('[data-assiette="rehaussee"]');
    await expect(haute).toHaveAttribute('data-verrou', 'ferme');
    await expect(haute).toContainText('120');
    await expect(suspension.getByTestId('suspension-hauteur')).toHaveAttribute('min', '0');
    await waitForStill(page);
    await photo(page, '3-suspension-terrain');
    for (const button of await suspension.locator('button').all()) if (await button.isVisible()) expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(48);

    await haute.tap();
    await suspension.getByRole('group', { name: 'Acheter Assiette rehaussée' }).getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(haute).toHaveAttribute('aria-pressed', 'true');
    await expect(suspension.getByTestId('suspension-descente')).toContainText('+4,0');
    await expect(suspension.getByTestId('suspension-hauteur')).toHaveAttribute('min', '-100');
    await expect.poll(async () => (await coxSauve(page))?.tune?.assiette).toBe(-1);
    await waitForStill(page);
    await photo(page, '4-suspension-rehaussee');

    // Rechargement : les deux articles sont acquis (le solde a payé 300 $, plus ce qu'un haut fait rapporte), tout est gardé.
    await reloadSaved(page);
    await waitForBench(page);
    const jeu = await jeuSauve(page);
    expect(jeu?.articles).toMatchObject({ 'piece-pneus-piste': true, 'piece-assiette-rehaussee': true });
    expect(jeu?.solde).toBeLessThanOrEqual(320 - 300 + 100);
    await openEntry(page, 'Suspension');
    await expect(dock(page).locator('[data-assiette="rehaussee"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(dock(page).locator('[data-assiette="rehaussee"]')).not.toHaveAttribute('data-verrou', 'ferme');
  });
});
