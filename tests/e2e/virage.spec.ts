// Virage en sortie de nuit (demande du 16 novembre 2026 : « lorsque l'on fait prendre un virage à un
// véhicule il faut aussi simuler le véhicule qui tourne (moto ça penche) et voir la voiture qui tourne,
// roues plus direction ») : départ au bas de la rampe de Laffrey, pilote automatique, une voiture puis
// une moto. Dans le lacet (à droite, vers 224 à 246 m), le braquage des roues avant et le roulis de la
// caisse quittent zéro, du bon côté ; en ligne droite, ils y reviennent. Relevés sur l'élément de la
// scène (data-braquage, data-roulis, en degrés) par un observateur, à chaque publication.
// Captures : captures/vague-o-virage/.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { openApp, openEntry, pickMap, waitForBench, waitForScene, rentrerAuGarage } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const DIR = resolve('captures', 'vague-o-virage');

/** Un relevé : abscisse (m), braquage montré (°), roulis (°). */
type Releve = [number, number, number];

/** Part en sortie avec ce véhicule, du bas de la rampe, puis relève la scène à chaque publication. */
async function sortie(page: Page, vehicle: string): Promise<void> {
  await openEntry(page, 'Véhicule');
  await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${vehicle}"]`).tap();
  await expect(page.locator('.stage')).toHaveAttribute('data-vehicle', vehicle);
  await waitForBench(page);
  await openEntry(page, 'Sortie de nuit');
  await pickMap(page);
  const start = page.locator('footer.dock').getByRole('group', { name: 'Départ' }).getByRole('button', { name: /rampe/i });
  await start.tap();
  await expect(start).toHaveAttribute('aria-pressed', 'true');
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
  await page.evaluate((cls) => {
    const element = document.querySelector<HTMLElement>(`.${cls}`);
    if (!element) throw new Error('scène absente');
    const releves: [number, number, number][] = [];
    (window as unknown as { __virage: typeof releves }).__virage = releves;
    const push = () => releves.push([Number(element.dataset.s), Number(element.dataset.braquage), Number(element.dataset.roulis)]);
    new MutationObserver(push).observe(element, { attributes: true, attributeFilter: ['data-s', 'data-braquage', 'data-roulis'] });
  }, DRIVE_STAGE_CLASS);
}

async function releves(page: Page): Promise<Releve[]> {
  return page.evaluate(() => (window as unknown as { __virage: Releve[] }).__virage.filter((r) => r.every(Number.isFinite)));
}

/** Roule jusqu'après le lacet ; une capture au plus fort du braquage. */
async function traverse(page: Page, name: string): Promise<Releve[]> {
  let shot = false;
  await expect
    .poll(
      async () => {
        const r = await releves(page);
        const last = r[r.length - 1];
        if (!shot && last && last[0] > 228 && last[0] < 246 && Math.abs(last[1]) >= 4) {
          shot = true;
          await page.screenshot({ path: resolve(DIR, `${name}.png`) });
        }
        return last?.[0] ?? 0;
      },
      { timeout: 300_000, intervals: [500] },
    )
    .toBeGreaterThan(275);
  return releves(page);
}

const within = (r: Releve[], from: number, to: number) => r.filter(([s]) => s >= from && s <= to);
const peak = (r: Releve[], k: 1 | 2) => r.reduce((m, x) => (Math.abs(x[k]) > Math.abs(m) ? x[k] : m), 0);

test('sortie de nuit : en virage, les roues braquent, la voiture roule, la moto penche', async ({ page }) => {
  test.setTimeout(900_000);
  mkdirSync(DIR, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page);
  await waitForScene(page);
  await waitForBench(page);

  // Voiture : roues braquées à droite dans le lacet, caisse qui roule vers l'extérieur (à gauche).
  await sortie(page, 'cox');
  const car = await traverse(page, 'e2e-cox-lacet');
  const carLacet = within(car, 215, 255);
  expect(carLacet.length, 'relevés dans le lacet').toBeGreaterThan(3);
  expect(peak(carLacet, 1), 'braquage dans le lacet (°)').toBeLessThanOrEqual(-15);
  expect(peak(carLacet, 2), 'roulis dans le lacet (°)').toBeLessThanOrEqual(-2);
  // En ligne droite après le lacet : tout revient à zéro.
  expect(within(car, 258, 330).some(([, b, r]) => Math.abs(b) <= 1 && Math.abs(r) <= 1), 'retour à zéro après le lacet').toBe(true);

  await rentrerAuGarage(page);
  await expect(stage(page)).toHaveCount(0);
  await waitForScene(page);
  await waitForBench(page);

  // Moto : elle se couche dans le lacet (à droite : roulis positif), sa roue avant braque un peu.
  await sortie(page, 'sportive');
  const bike = await traverse(page, 'e2e-sportive-lacet');
  const bikeLacet = within(bike, 215, 255);
  expect(bikeLacet.length, 'relevés dans le lacet').toBeGreaterThan(3);
  expect(peak(bikeLacet, 2), 'inclinaison dans le lacet (°)').toBeGreaterThanOrEqual(10);
  expect(peak(bikeLacet, 1), 'braquage dans le lacet (°)').toBeLessThanOrEqual(-3);
  expect(within(bike, 258, 330).some(([, b, r]) => Math.abs(b) <= 1 && Math.abs(r) <= 1), 'retour à zéro après le lacet').toBe(true);
  expect(errors).toEqual([]);
});
