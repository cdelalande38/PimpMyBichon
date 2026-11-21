import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { capture, openApp, openEntry, quick, waitForBench, waitForScene } from './helpers.ts';

// Vue intérieure (§ 5.1) et cadrage de départ par véhicule : le bouton « Intérieur » n'existe que
// pour un véhicule qui déclare interiorView ; entrer, changer de place par son nom (au-dessus du
// dock, tests/e2e/places.spec.ts en détail), regarder autour, sortir rend la vue d'atelier ;
// chaque véhicule occupe environ 80 % de la largeur, centré dans la partie libre au-dessus du dock.

interface Entry {
  id: string;
  order: number;
  glb: string;
  kind: 'car' | 'bike';
  interiorView?: unknown;
  interiorViews?: ReadonlyArray<{ label?: string; place?: string }>;
}

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const CATALOG: Entry[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/vehicle.json`, DIR)))
  .map((entry) => JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as Entry)
  .filter((entry) => existsSync(new URL(`${entry.id}/${entry.glb}`, DIR)))
  .sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));

const dock = (page: Page) => page.locator('footer.dock');
const stage = (page: Page) => page.locator('.stage');
const interiorButton = (page: Page) => quick(page).getByRole('button', { name: 'Intérieur', exact: true });
const leaveButton = (page: Page) => quick(page).getByRole('button', { name: 'Vue atelier', exact: true });
const handle = (page: Page) => dock(page).getByRole('button', { name: /^(Agrandir|Réduire) le menu$/ });

async function chooseVehicle(page: Page, id: string): Promise<void> {
  if ((await stage(page).getAttribute('data-vehicle')) === id) return;
  await openEntry(page, 'Véhicule');
  const chip = dock(page).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${id}"]`);
  await chip.tap();
  await expect(stage(page)).toHaveAttribute('data-vehicle', id);
  await waitForBench(page);
}

/** Cadre du véhicule à l'écran (boîte projetée), posé par la scène. */
async function frameOf(page: Page): Promise<{ left: number; right: number; top: number; bottom: number } | null> {
  const across = await stage(page).getAttribute('data-vehicule-largeur');
  const down = await stage(page).getAttribute('data-vehicule-ecran');
  if (!across || !down) return null;
  const [left, right] = across.split(',').map(Number);
  const [top, bottom] = down.split(',').map(Number);
  if (left === undefined || right === undefined || top === undefined || bottom === undefined) return null;
  return { left, right, top, bottom };
}

/** Le véhicule courant occupe environ 80 % de la largeur, centré dans la partie libre au-dessus du dock compact. */
async function expectFramed(page: Page, id: string): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  const dockTop = (await dock(page).boundingBox())?.y ?? height;
  await expect
    .poll(
      async () => {
        const frame = await frameOf(page);
        if (!frame) return 'pas de cadre';
        const share = (frame.right - frame.left) / width;
        const middle = (frame.left + frame.right) / 2;
        const band = { top: height * 0.1, bottom: dockTop };
        const center = (frame.top + frame.bottom) / 2;
        if (share < 0.74 || share > 0.86) return `${id} : ${Math.round(share * 100)} % de la largeur`;
        if (Math.abs(middle - width / 2) > width * 0.05) return `${id} : décentré (${Math.round(middle)})`;
        if (frame.top < band.top - 4 || frame.bottom > band.bottom + 4) return `${id} : hors de la partie libre (${frame.top}–${frame.bottom})`;
        if (Math.abs(center - (band.top + band.bottom) / 2) > 12) return `${id} : pas centré en hauteur (${Math.round(center)})`;
        return 'ok';
      },
      { message: `cadrage de ${id}`, timeout: 20_000 },
    )
    .toBe('ok');
}

/** Dock agrandi : le véhicule glisse dans la partie libre au-dessus de lui ; fermé : il ne sort pas de l'écran. */
async function expectFramedWithDock(page: Page, id: string): Promise<void> {
  const { height } = page.viewportSize() ?? { width: 390, height: 844 };
  // La poignée ne paraît que là où agrandir montre plus (jamais aux sections) : la peinture en a.
  await openEntry(page, 'Peinture');
  await handle(page).tap();
  await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
  const dockTop = (await dock(page).boundingBox())?.y ?? height;
  await expect
    .poll(async () => {
      const frame = await frameOf(page);
      return frame !== null && frame.top >= height * 0.1 - 4 && frame.bottom <= dockTop + 4 ? 'ok' : `${id} : ${JSON.stringify(frame)} (dock ${Math.round(dockTop)})`;
    }, { message: `cadrage de ${id}, dock agrandi` })
    .toBe('ok');
  await handle(page).tap();
  await expect(dock(page)).toHaveAttribute('data-taille', 'compact');
}

for (const screen of [
  { width: 390, height: 844 },
  { width: 360, height: 780 },
]) {
  test.describe(`cadrage par véhicule, ${screen.width} × ${screen.height}`, () => {
    test.use({ viewport: screen });

    test('chaque véhicule occupe environ 80 % de la largeur, centré au-dessus du dock compact', async ({ page }) => {
      test.setTimeout(420_000);
      await openApp(page);
      await waitForScene(page);
      await waitForBench(page);
      for (const entry of CATALOG) {
        await chooseVehicle(page, entry.id);
        // Bouton « Intérieur » : présent si et seulement si le manifeste déclare interiorView.
        await expect(interiorButton(page)).toHaveCount(entry.interiorView ? 1 : 0);
        await expect(dock(page)).toHaveAttribute('data-taille', 'compact');
        await expectFramed(page, entry.id);
        if (screen.width === 390) await capture(page, `vue-depart-${entry.id}`);
        await expectFramedWithDock(page, entry.id);
      }
    });
  });
}

test.describe('vue intérieure', () => {
  test('entrer, changer de place par son nom, regarder autour, sortir : la vue d’atelier est retrouvée', async ({ page }) => {
    test.setTimeout(420_000);
    const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    for (const entry of CATALOG.filter((item) => item.interiorView)) {
      await chooseVehicle(page, entry.id);
      await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
      const before = await stage(page).getAttribute('data-camera');
      const cutBefore = Number(await stage(page).getAttribute('data-coupe'));
      expect(before, 'position de la caméra en atelier').toBeTruthy();

      await interiorButton(page).tap();
      await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
      // Le bouton rond dit ce que fera l'appui : sortir (il n'enchaîne plus les places).
      await expect(leaveButton(page)).toBeVisible();
      await expect(stage(page)).toHaveAttribute('data-place', 'conducteur');
      await expect(stage(page)).toHaveAttribute('data-regard', '0,0');
      // Rien du décor n'est retiré à tort : l'œil est dans le volume protégé du véhicule, la coupe
      // n'ajoute rien à ce qu'elle retirait déjà depuis la vue d'atelier.
      const cutInside = Number(await stage(page).getAttribute('data-coupe'));
      console.log(`coupe ${entry.id} : atelier ${cutBefore}, intérieur ${cutInside}`);
      expect(cutInside, 'coupe caméra dans l’habitacle').toBeLessThanOrEqual(cutBefore);
      await capture(page, `vue-interieure-${entry.id}`);

      // Places suivantes : choisies par leur nom ; chacune repart regard droit devant.
      const places = page.getByRole('group', { name: 'Ta place dans le véhicule' });
      for (const [i, next] of (entry.interiorViews ?? []).entries()) {
        const placeButton = places.getByRole('button', { name: next.label ?? '', exact: true });
        await expect(placeButton).toBeVisible();
        const cameraBefore = await stage(page).getAttribute('data-regard');
        await placeButton.tap();
        await expect(stage(page)).toHaveAttribute('data-place', next.place ?? '');
        await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');
        await expect(stage(page)).toHaveAttribute('data-regard', '0,0');
        expect(cameraBefore).toBe('0,0');
        await expect(leaveButton(page)).toBeVisible();
        await capture(page, `vue-interieure-${entry.id}-${i + 2}`);
      }

      // Glisser vers la droite : on regarde à gauche, sans dépasser les bornes du regard.
      const y = Math.round(height * 0.4);
      await page.mouse.move(width * 0.2, y);
      await page.mouse.down();
      for (let step = 1; step <= 12; step += 1) await page.mouse.move(width * 0.2 + step * 60, y + step * 20);
      await page.mouse.up();
      await expect
        .poll(async () => {
          const [yaw, pitch] = ((await stage(page).getAttribute('data-regard')) ?? '0,0').split(',').map(Number);
          // Lacet borné à 110° ; tangage de 40° vers le bas à 75° vers le haut (le ciel étoilé).
          return (yaw ?? 0) > 20 && (yaw ?? 0) <= 110 && (pitch ?? 0) >= -40 && (pitch ?? 0) <= 75;
        })
        .toBe(true);
      // Le dock reste utilisable dedans.
      await expect(dock(page)).toBeVisible();
      await expect(leaveButton(page)).toBeVisible();

      await leaveButton(page).tap();
      await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
      await expect(interiorButton(page)).toBeVisible();
      await expect(stage(page)).toHaveAttribute('data-camera', before ?? '');
    }
  });
});

test.describe('vue intérieure et reste de l’app', () => {
  test('dedans, le dock repeint la sellerie ; « Photo » ramène d’abord à l’atelier', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    const id = CATALOG.find((entry) => entry.interiorView && entry.id === 'cox')?.id ?? CATALOG.find((entry) => entry.interiorView)?.id;
    if (!id) test.skip(true, 'aucun véhicule à vue intérieure');
    await chooseVehicle(page, id ?? '');
    await interiorButton(page).tap();
    await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');

    // Le dock reste au pouce : on descend jusqu'aux zones de peinture sans quitter l'habitacle.
    await openEntry(page, 'Peinture');
    const zones = dock(page).getByRole('group', { name: 'Zones' }).getByRole('button');
    await expect(zones.first()).toBeVisible();
    await expect(stage(page)).toHaveAttribute('data-vue', 'interieur');

    // La photo se prend depuis l'atelier : la vue intérieure s'efface d'un coup.
    await quick(page).getByRole('button', { name: 'Photo', exact: true }).click();
    const bar = page.getByRole('contentinfo', { name: 'Mode photo' });
    await expect(bar).toBeVisible();
    await expect(stage(page)).toHaveAttribute('data-vue', 'atelier');
    await bar.getByRole('button', { name: 'Retour' }).click();
    await expect(interiorButton(page)).toBeVisible();
  });
});
