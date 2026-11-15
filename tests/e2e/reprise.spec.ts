import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page, type Route } from '@playwright/test';
import { capture, openApp, openEntry, waitForBench } from './helpers.ts';

// Reprise après un modèle introuvable (réseau coupé pendant son chargement) : l'étiquette le dit et
// propose « Réessayer » ; revenir sur le véhicule, ou appuyer sur le bouton, relance une vraie
// requête, et le véhicule se pose dès que le réseau est revenu. Sans rechargement de la page.

interface Entry {
  id: string;
  order: number;
  glb: string;
}

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const CATALOG: Entry[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/vehicle.json`, DIR)))
  .map((entry) => JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as Entry)
  .filter((entry) => existsSync(new URL(`${entry.id}/${entry.glb}`, DIR)))
  .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
/** Véhicule de départ, et celui dont on coupe le modèle (le plus léger des autres, pour aller vite). */
const START = CATALOG[0] as Entry;
const CUT = CATALOG.filter((entry) => entry.id !== START.id).sort(
  (a, b) => readFileSync(new URL(`${a.id}/${a.glb}`, DIR)).length - readFileSync(new URL(`${b.id}/${b.glb}`, DIR)).length,
)[0] as Entry;

// La route coupée par Playwright doit voir la requête : le service worker la servirait sinon.
test.use({ serviceWorkers: 'block' });

const stage = (page: Page) => page.locator('.stage');
const dock = (page: Page) => page.locator('footer.dock');
const retry = (page: Page) => page.getByRole('button', { name: 'Réessayer', exact: true });

async function chooseVehicle(page: Page, entry: Entry): Promise<void> {
  // Le menu ne montre qu'un niveau à la fois : on ouvre le catalogue avant d'y choisir.
  await openEntry(page, 'Véhicule');
  const chip = dock(page).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${entry.id}"]`);
  await chip.tap();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(stage(page)).toHaveAttribute('data-vehicle', entry.id);
}

/** Coupe (ou rend) la route du modèle de CUT et compte les requêtes qui partent vers lui. */
async function cutModel(page: Page): Promise<{ hits: () => number; restore: () => void }> {
  let cut = true;
  let hits = 0;
  await page.route(`**/assets/vehicles/${CUT.id}/${CUT.glb}`, (route: Route) => {
    hits += 1;
    return cut ? route.abort('internetdisconnected') : route.continue();
  });
  return {
    hits: () => hits,
    restore: () => {
      cut = false;
    },
  };
}

/** L'échec est dit à l'écran, avec un bouton « Réessayer » d'au moins 48 px de côté. */
async function expectFailure(page: Page): Promise<void> {
  await expect(stage(page)).toHaveAttribute('data-bench', 'erreur', { timeout: 30_000 });
  await expect(page.locator('.tag')).toContainText('introuvable, relance avec du réseau');
  await expect(retry(page)).toBeVisible();
  const box = await retry(page).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
}

test.describe('reprise après un modèle introuvable', () => {
  test.setTimeout(360_000);

  test('revenir sur le véhicule relance la requête et le pose', async ({ page }) => {
    const route = await cutModel(page);
    await openApp(page);
    await waitForBench(page);

    await chooseVehicle(page, CUT);
    await expect(stage(page)).toHaveAttribute('data-bench', 'erreur', { timeout: 30_000 });
    await expect(page.locator('.tag')).toContainText('introuvable, relance avec du réseau');
    expect(route.hits()).toBe(1);

    // Le réseau revient : on passe par un autre véhicule, puis on revient.
    route.restore();
    await chooseVehicle(page, START);
    await waitForBench(page);
    await chooseVehicle(page, CUT);
    await expect.poll(route.hits, { timeout: 30_000 }).toBe(2);
    await waitForBench(page);
    await expect(stage(page)).toHaveAttribute('data-vehicle', CUT.id);
    await expect(retry(page)).toHaveCount(0);
  });

  test('« Réessayer » relance le chargement sans changer de véhicule', async ({ page }) => {
    const route = await cutModel(page);
    await openApp(page);
    await waitForBench(page);

    await chooseVehicle(page, CUT);
    await expectFailure(page);
    expect(route.hits()).toBe(1);
    await capture(page, 'reprise-introuvable');

    // Toujours coupé : le bouton relance une requête, qui retombe ; l'étiquette le redit.
    await retry(page).tap();
    await expect.poll(route.hits, { timeout: 30_000 }).toBe(2);
    await expectFailure(page);

    // Le réseau revient : le bouton seul suffit, le véhicule reste le même et se pose.
    route.restore();
    await retry(page).tap();
    await expect.poll(route.hits, { timeout: 30_000 }).toBe(3);
    await waitForBench(page);
    await capture(page, 'reprise-pose');
    await expect(stage(page)).toHaveAttribute('data-vehicle', CUT.id);
    await expect(retry(page)).toHaveCount(0);
  });

  test('une requête qui tombe après qu’on a quitté le véhicule ne bloque pas le retour', async ({ page }) => {
    // La requête reste en suspens (réseau qui traîne), on part ailleurs, puis elle tombe.
    let held: Route | null = null;
    let hits = 0;
    await page.route(`**/assets/vehicles/${CUT.id}/${CUT.glb}`, (route: Route) => {
      hits += 1;
      if (hits === 1) held = route;
      else return route.continue();
      return undefined;
    });
    await openApp(page);
    await waitForBench(page);

    await chooseVehicle(page, CUT);
    await expect.poll(() => hits, { timeout: 30_000 }).toBe(1);
    await chooseVehicle(page, START);
    await waitForBench(page);
    const dropped = page.waitForEvent('requestfailed', (request) => request.url().endsWith(`/${CUT.id}/${CUT.glb}`));
    await (held as Route | null)?.abort('internetdisconnected');
    await dropped;
    // Le temps que l'échec remonte au chargeur, qui le garde en cache.
    await page.evaluate(() => new Promise((done) => window.setTimeout(done, 300)));

    // Retour, réseau revenu : une nouvelle requête part d'elle-même, le véhicule se pose.
    await chooseVehicle(page, CUT);
    await expect.poll(() => hits, { timeout: 30_000 }).toBe(2);
    await waitForBench(page);
    await expect(stage(page)).toHaveAttribute('data-vehicle', CUT.id);
    await expect(retry(page)).toHaveCount(0);
  });
});
