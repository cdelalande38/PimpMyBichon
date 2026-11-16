import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { changedRatio, openApp, openEntry, quick, reloadSaved, sceneBand, waitForBench, waitForScene, waitForStill } from './helpers.ts';

// Places de la vue intérieure (demande du 16 novembre 2026 : « se placer à la place conducteur,
// passager ou arrière… c'est le menu qui va pas surtout ») : en vue intérieure, une commande nommée
// par place, au pouce, au-dessus du dock, sans toucher au dock ni aux raccourcis ; chaque place
// change l'image ; on regarde autour et on lève les yeux ; la place est gardée par véhicule d'un
// rechargement à l'autre ; « Sortir » rend l'atelier ; le dock garde sa hauteur.

interface Entry {
  id: string;
  order: number;
  glb: string;
  interiorView?: { label?: string; place?: string };
  interiorViews?: ReadonlyArray<{ label?: string; place?: string }>;
}

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const CATALOG: Entry[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/vehicle.json`, DIR)))
  .map((entry) => JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as Entry)
  .filter((entry) => existsSync(new URL(`${entry.id}/${entry.glb}`, DIR)) && entry.interiorView)
  .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

/** Captures de revue : PMB_CAPTURES (dossier), sinon captures/places/. */
async function shot(page: Page, name: string): Promise<void> {
  const path = resolve(process.env.PMB_CAPTURES ?? resolve('captures', 'places'), `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

const dock = (page: Page) => page.locator('footer.dock');
const stage = (page: Page) => page.locator('.stage');
const places = (page: Page) => page.getByRole('group', { name: 'Ta place dans le véhicule' });

async function chooseVehicle(page: Page, id: string): Promise<void> {
  if ((await stage(page).getAttribute('data-vehicle')) === id) return;
  await openEntry(page, 'Véhicule');
  await dock(page).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${id}"]`).tap();
  await expect(stage(page)).toHaveAttribute('data-vehicle', id);
  await waitForBench(page);
}

/** Les deux boîtes se chevauchent. */
const overlap = (a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test.describe('places de la vue intérieure', () => {
  test('entrer, choisir chaque place par son nom, regarder autour, recharger et retrouver sa place, sortir', async ({ page }) => {
    test.setTimeout(600_000);
    const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    expect(CATALOG.map((entry) => entry.id)).toEqual(expect.arrayContaining(['cox', 'van', 'concept']));

    for (const entry of CATALOG) {
      await chooseVehicle(page, entry.id);
      // Retour aux sections : le dock à sa hauteur de repos, mesurée avant d'entrer.
      const dockBefore = await dock(page).boundingBox();
      const enter = quick(page).getByRole('button', { name: 'Intérieur', exact: true });
      await enter.tap();
      await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
      await expect(stage(page)).toHaveAttribute('data-place', 'conducteur');

      // Les commandes : une par place, nommée, plus « Sortir », au pouce, sans rien recouvrir.
      const wanted = [entry.interiorView, ...(entry.interiorViews ?? [])].map((view) => ({ id: view?.place ?? '', label: view?.label ?? '' }));
      const group = places(page);
      await expect(group.getByRole('button')).toHaveText([...wanted.map((place) => place.label), 'Sortir']);
      const dockBox = await dock(page).boundingBox();
      const quickBox = await quick(page).boundingBox();
      for (const button of await group.getByRole('button').all()) {
        const box = (await button.boundingBox())!;
        expect(box.height, 'hauteur au doigt').toBeGreaterThanOrEqual(48);
        expect(box.width, 'largeur au doigt').toBeGreaterThanOrEqual(48);
        expect(box.y, 'tiers bas de l’écran').toBeGreaterThanOrEqual(height * (2 / 3) - 1);
        expect(overlap(box, dockBox!), 'ne recouvre pas le dock').toBe(false);
        expect(overlap(box, quickBox!), 'ne recouvre pas les raccourcis').toBe(false);
      }
      expect(dockBox!.height, 'le dock garde sa hauteur').toBeCloseTo(dockBefore!.height, 0);
      expect(dockBox!.y).toBeCloseTo(dockBefore!.y, 0);
      if (entry.id === 'cox') await shot(page, 'choix-des-places-cox');

      // Chaque place, par son nom : l'image change, le regard repart droit devant.
      let previous = await sceneBand(page);
      for (const place of [...wanted.slice(1), wanted[0]!]) {
        await group.getByRole('button', { name: place.label, exact: true }).tap();
        await expect(stage(page)).toHaveAttribute('data-place', place.id);
        await expect(group.getByRole('button', { name: place.label, exact: true })).toHaveAttribute('aria-pressed', 'true');
        await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
        await expect(stage(page)).toHaveAttribute('data-regard', '0,0');
        await waitForStill(page);
        const now = await sceneBand(page);
        expect(await changedRatio(previous, now), `${entry.id} : l’image change à la place ${place.id}`).toBeGreaterThan(0.05);
        previous = now;
        await shot(page, `place-${entry.id}-${place.id}`);
      }

      // Regarder autour : vers la gauche, puis lever les yeux vers le pavillon (au-delà de l'ancienne borne de 35°).
      const y = Math.round(height * 0.35);
      await page.mouse.move(width * 0.2, y);
      await page.mouse.down();
      for (let step = 1; step <= 10; step += 1) await page.mouse.move(width * 0.2 + step * 20, y + step * 45);
      await page.mouse.up();
      await expect
        .poll(async () => {
          const [yaw, pitch] = ((await stage(page).getAttribute('data-regard')) ?? '0,0').split(',').map(Number);
          return `${(yaw ?? 0) > 10 ? 'gauche' : 'droit'} ${(pitch ?? 0) > 40 ? 'en haut' : 'pas assez haut'}`;
        })
        .toBe('gauche en haut');
      expect(await dock(page).boundingBox()).toEqual(dockBox);

      // « Sortir », dans la rangée : l'atelier revient, les commandes s'effacent.
      await group.getByRole('button', { name: 'Sortir', exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
      await expect(group).toHaveCount(0);
    }

    // La place choisie est gardée pour ce véhicule, d'un rechargement à l'autre.
    await chooseVehicle(page, 'cox');
    await quick(page).getByRole('button', { name: 'Intérieur', exact: true }).tap();
    await places(page).getByRole('button', { name: 'Arrière', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-place', 'arriere');
    await reloadSaved(page);
    await waitForScene(page);
    await expect(stage(page)).toHaveAttribute('data-vehicle', 'cox');
    await waitForBench(page);
    await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
    await quick(page).getByRole('button', { name: 'Intérieur', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-place', 'arriere');
    await expect(places(page).getByRole('button', { name: 'Arrière', exact: true })).toHaveAttribute('aria-pressed', 'true');
    // Le bouton rond ressort aussi.
    await quick(page).getByRole('button', { name: 'Sortir', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
  });

  test('Custom › Intérieur : chaque volet assoit à la place qui le montre, sans empêcher d’en changer', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await chooseVehicle(page, 'van');
    await openEntry(page, 'Intérieur');
    await expect(stage(page)).toHaveAttribute('data-vue', 'interieur', { timeout: 15_000 });
    const volets = dock(page).getByRole('group', { name: 'Volets de l’intérieur' });
    const expected: Array<[string, string]> = [
      ['Volant', 'conducteur'],
      ['Sièges', 'arriere'],
      ['Ciel', 'arriere'],
      ['Pommeau', 'conducteur'],
    ];
    for (const [volet, place] of expected) {
      await volets.getByRole('button', { name: volet, exact: true }).tap();
      await expect(stage(page), volet).toHaveAttribute('data-place', place);
    }
    // À la main : le passager, gardé tant qu'on reste sur le volet.
    const group = places(page);
    await expect(group).toBeVisible();
    const dockBox = await dock(page).boundingBox();
    for (const button of await group.getByRole('button').all()) expect(overlap((await button.boundingBox())!, dockBox!)).toBe(false);
    await group.getByRole('button', { name: 'Passager', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-place', 'passager');
    await page.waitForTimeout(500);
    await expect(stage(page)).toHaveAttribute('data-place', 'passager');
    await shot(page, 'choix-des-places-van-interieur');
  });
});
