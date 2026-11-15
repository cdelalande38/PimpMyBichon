import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { backToSections, capture, changedRatio, openApp, openEntry, paintAndReload, quick, readBuilds, sceneBand, waitForBench, waitForScene, waitForStill, waitOfflineReady } from './helpers.ts';

// Jalon 2 : le catalogue des véhicules. Changer de véhicule et revenir (chacun garde ses peintures),
// retrouver le véhicule après rechargement, un modèle absent annoncé, le dock et ses actions,
// l'ouverture avec une chaîne de requête (lien d'import de musique), en ligne comme hors ligne.

interface Entry {
  id: string;
  name: string;
  order: number;
  glb: string;
  placeholder?: string;
  engine?: unknown;
}

// Le catalogue tel que le build le découvre : chaque dossier qui a son vehicle.json.
const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const CATALOG: Entry[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/vehicle.json`, DIR)))
  .map((entry) => JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as Entry)
  .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
const hasModel = (entry: Entry) => existsSync(new URL(`${entry.id}/${entry.glb}`, DIR));
const START = CATALOG[0] as Entry;
const OTHER = CATALOG.find((entry) => entry.id !== START.id && hasModel(entry));
const MISSING = CATALOG.find((entry) => !hasModel(entry));

const dock = (page: Page) => page.locator('footer.dock');

/** Le lien ?pack= lance le téléchargement de lui-même ; vers une adresse en .invalid, il échoue : on referme le message. */
async function dismissPackOffer(page: Page): Promise<void> {
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('alert')).toBeVisible({ timeout: 30_000 });
  await sheet.getByRole('button', { name: 'Retour à l’atelier' }).click();
  await expect(sheet).toBeHidden();
}
const stage = (page: Page) => page.locator('.stage');

async function chooseVehicle(page: Page, entry: Entry): Promise<void> {
  await openEntry(page, 'Véhicule');
  const chip = dock(page).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${entry.id}"]`);
  await chip.tap();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(stage(page)).toHaveAttribute('data-vehicle', entry.id);
}

test.describe('catalogue des véhicules', () => {
  test.setTimeout(420_000);

  test('le dock nomme le véhicule, liste le catalogue et range ses actions au pouce', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await expect(stage(page)).toHaveAttribute('data-vehicle', START.id);
    await expect(dock(page).locator('.dock-vehicle')).toHaveText(START.name);

    // « Véhicule » ouvre directement le catalogue (une seule entrée) ; le véhicule reste nommé.
    await openEntry(page, 'Véhicule');
    await expect(dock(page).locator('.dock-vehicle')).toHaveText(START.name);
    const chips = dock(page).getByRole('group', { name: 'Véhicule' }).getByRole('button');
    await expect(chips).toHaveCount(CATALOG.length);
    for (const [index, entry] of CATALOG.entries()) {
      const chip = chips.nth(index);
      await expect(chip.locator('b')).toHaveText(entry.name);
      if (entry.placeholder) await expect(chip.locator('small')).toContainText('substitut');
      if (!hasModel(entry)) await expect(chip.locator('small')).toContainText('modèle absent');
    }

    // Quatre sections (src/data/dockMenu.ts) ; « Mécanique » n'apparaît que si le véhicule déclare un moteur.
    await backToSections(page);
    const tabs = dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' }).getByRole('button');
    await expect(tabs).toHaveText(START.engine ? ['Véhicule', 'Custom', 'Mécanique', 'Garage'] : ['Véhicule', 'Custom', 'Garage']);

    // Le dock ne porte plus que la personnalisation : radio, photo et atelier sont les boutons ronds
    // du haut de l'écran. Chaque bouton du dock fait 48 px, dans le tiers bas.
    for (const name of ['Moteur', 'Sous le capot', 'Réglages', 'Photo']) {
      await expect(dock(page).getByRole('navigation', { name: 'Atelier', exact: true }).getByRole('button', { name })).toHaveCount(0);
    }
    for (const name of [/^Radio/, /^Photo$/, /^Atelier$/]) await expect(quick(page).getByRole('button', { name })).toHaveCount(1);
    const buttons = dock(page).locator('button:visible');
    for (let i = 0; i < (await buttons.count()); i += 1) {
      const box = await buttons.nth(i).boundingBox();
      if (!box) continue;
      expect(box.height).toBeGreaterThanOrEqual(48);
      expect(box.y).toBeGreaterThanOrEqual((844 * 2) / 3);
    }
    await capture(page, '20-dock-vehicules');

    // « Mécanique » montre la fiche de préparation dans le dock.
    if (START.engine) {
      await openEntry(page, 'Préparation');
      await expect(dock(page).getByTestId('moteur-origine')).toBeVisible();
      await capture(page, '21-dock-moteur');
    }
  });

  test('changer de véhicule et revenir : chacun garde ses peintures, le véhicule est retrouvé au rechargement', async ({ page }) => {
    test.skip(!OTHER, 'un seul modèle présent : lance npm run vehicles:build');
    const other = OTHER as Entry;
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    await paintAndReload(page, START.id, { carrosserie: { color: '#ff6a00', finish: 'brillant' } });
    const startLook = await sceneBand(page);

    await chooseVehicle(page, other);
    await waitForBench(page);
    await expect(dock(page).locator('.dock-vehicle')).toHaveText(other.name);
    expect(await changedRatio(startLook, await sceneBand(page)), 'l’autre véhicule est à l’écran').toBeGreaterThan(0.02);
    await capture(page, '22-autre-vehicule');

    await chooseVehicle(page, START);
    await waitForBench(page);
    expect(await changedRatio(startLook, await sceneBand(page)), 'le premier revient tel qu’on l’a laissé').toBeLessThan(0.02);
    const saved = await readBuilds(page);
    expect(saved?.builds[START.id]?.paints.carrosserie).toEqual({ color: '#ff6a00', finish: 'brillant' });

    // Rechargement : le véhicule courant est retrouvé.
    await chooseVehicle(page, other);
    await waitForBench(page);
    await page.reload();
    await expect(stage(page)).toHaveAttribute('data-vehicle', other.id);
    await waitForBench(page);
    await expect(dock(page).locator('.dock-vehicle')).toHaveText(other.name);
  });

  test('un véhicule sans modèle reste au catalogue et le dit', async ({ page }) => {
    test.skip(!MISSING, 'tous les modèles sont présents');
    const missing = MISSING as Entry;
    await openApp(page);
    await waitForBench(page);
    await chooseVehicle(page, missing);
    await expect(stage(page)).toHaveAttribute('data-bench', 'absent');
    await expect(page.locator('.tag')).toContainText('modèle absent');
    await capture(page, '23-modele-absent');
    await chooseVehicle(page, START);
    await waitForBench(page);
  });

  test('l’app s’ouvre avec une chaîne de requête (?pack=…), en ligne comme hors ligne, catalogue compris', async ({ page, context, baseURL }) => {
    const query = `?pack=${encodeURIComponent('https://exemple.invalid/packs/pack.zip')}`;
    await page.goto(`./${query}`);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    await dismissPackOffer(page);
    await waitOfflineReady(page);

    // Le précache porte tous les modèles présents au build.
    const cached = await page.evaluate(async () => {
      const urls: string[] = [];
      for (const name of await caches.keys()) for (const request of await (await caches.open(name)).keys()) urls.push(new URL(request.url).pathname);
      return urls;
    });
    for (const entry of CATALOG.filter(hasModel)) {
      expect(cached.some((path) => path.endsWith(`/assets/vehicles/${entry.id}/${entry.glb}`)), entry.id).toBe(true);
    }

    await context.setOffline(true);
    await page.goto(`${baseURL ?? ''}${query}`);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    await dismissPackOffer(page);
    await waitForBench(page);
    if (OTHER) {
      await chooseVehicle(page, OTHER);
      await waitForBench(page);
      await chooseVehicle(page, START);
      await waitForBench(page);
    }
    await waitForStill(page);
    await context.setOffline(false);
  });
});
