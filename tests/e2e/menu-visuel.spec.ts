// Menu visuel : une icône sur chaque section, entrée et volet ; un petit dessin sur les choix (jantes,
// pneus, volants, pommeaux, sièges, finitions, assiette, ambiances, cartes). Les noms des boutons ne
// changent pas, le menu garde sa hauteur d'un volet à l'autre et reste dans le tiers bas, les quatre
// sections tiennent sur une ligne, jusqu'au texte « très grand » sur 360 × 780. Captures dans
// captures/vague-n-menu/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DOCK_MENU } from '../../src/data/dockMenu.ts';
import { backToSections, ENTREE_SORTIE, openApp, openEntry, reloadSaved, waitForBench, waitForStill } from './helpers.ts';

const dock = (page: Page) => page.locator('footer.dock');
const sections = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-n-menu', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Pose le véhicule à l'écran par la sauvegarde (la Cox : roues, intérieur et moteur à régler). */
async function chooseVehicle(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { current: value, builds: {}, recents: [] }, version: 1 }), 'pmb-builds');
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    id,
  );
}

/** Les quatre sections : une icône chacune, sur une seule ligne, aucun mot coupé, 48 px au doigt. */
async function expectSections(page: Page, label: string): Promise<void> {
  const buttons = sections(page).getByRole('button');
  await expect(buttons).toHaveCount(4);
  const boxes = await buttons.evaluateAll((list) =>
    list.map((button) => {
      const box = button.getBoundingClientRect();
      const icon = button.querySelector('svg.icon');
      return { top: Math.round(box.top), height: box.height, width: box.width, right: box.right, icon: icon?.getAttribute('aria-hidden'), clipped: button.scrollWidth > button.clientWidth + 1 };
    }),
  );
  for (const [index, box] of boxes.entries()) {
    expect(box.icon, `${label} · section ${index} : icône masquée aux lecteurs d’écran`).toBe('true');
    expect(box.clipped, `${label} · section ${index} : mot entier`).toBe(false);
    expect(box.height, `${label} · section ${index} : 48 px`).toBeGreaterThanOrEqual(48);
    expect(box.width, `${label} · section ${index} : 48 px`).toBeGreaterThanOrEqual(48);
  }
  expect(new Set(boxes.map((box) => box.top)).size, `${label} : une seule ligne`).toBe(1);
  const width = page.viewportSize()?.width ?? 390;
  expect(Math.max(...boxes.map((box) => box.right)), `${label} : dans l’écran`).toBeLessThanOrEqual(width + 1);
}

test.describe('menu visuel', () => {
  test('sections, entrées, volets et choix portent leur dessin ; noms et hauteurs inchangés', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await chooseVehicle(page, 'cox');
    await reloadSaved(page);
    await waitForBench(page);
    const height = page.viewportSize()?.height ?? 844;

    // Sections : les noms d'avant, une icône au-dessus de chacun.
    await backToSections(page);
    for (const section of DOCK_MENU) await expect(sections(page).getByRole('button', { name: section.label, exact: true })).toBeVisible();
    await expectSections(page, '390 × 844');
    const compactTop = (await dock(page).boundingBox())!.y;
    expect(compactTop, 'le menu reste dans le tiers bas').toBeGreaterThanOrEqual((height * 2) / 3 - 1);
    await waitForStill(page);
    await shot(page, '01-sections');

    // Entrées de chaque section : une icône chacune ; les « bientôt » estompées, leur mention gardée.
    for (const [id, name] of [
      ['custom', '02-custom'],
      ['mecanique', '03-mecanique'],
      ['garage', '04-garage'],
    ] as const) {
      const section = DOCK_MENU.find((item) => item.id === id)!;
      await backToSections(page);
      await sections(page).getByRole('button', { name: section.label, exact: true }).click();
      const entries = dock(page).getByRole('navigation', { name: `Entrées · ${section.label}` });
      for (const entry of section.entries) {
        const button = entries.getByRole('button', { name: entry.available ? entry.label : `${entry.label}, bientôt`, exact: true });
        await expect(button).toBeAttached();
        await expect(button.locator('svg.icon[aria-hidden="true"]')).toHaveCount(1);
        if (!entry.available) {
          await expect(button).toBeDisabled();
          await expect(button.locator('small')).toHaveText('bientôt');
        }
      }
      expect((await dock(page).boundingBox())!.y, `${section.label} : le menu ne bouge pas`).toBeCloseTo(compactTop, 0);
      await shot(page, name);
    }

    // Roues : volets à icône ; chaque jante et chaque pneu son dessin ; la hauteur ne saute pas.
    await openEntry(page, 'Roues');
    const roues = dock(page).locator('.dock-tab[data-onglet="roues"]');
    const volets = roues.getByRole('group', { name: 'Volets des roues' });
    for (const volet of ['Jantes', 'Pneus', 'Cotes']) await expect(volets.getByRole('button', { name: volet, exact: true }).locator('svg.icon')).toHaveCount(1);
    const rims = roues.getByRole('group', { name: 'Dessin des jantes' }).getByRole('button');
    const rimCount = await rims.count();
    expect(rimCount).toBeGreaterThan(1);
    await expect(roues.getByRole('group', { name: 'Dessin des jantes' }).locator('svg.picto')).toHaveCount(rimCount);
    const top = (await dock(page).boundingBox())!.y;
    await shot(page, '05-roues-jantes');
    await volets.getByRole('button', { name: 'Pneus', exact: true }).click();
    const tires = roues.getByRole('group', { name: 'Type de pneu' });
    await expect(tires.locator('svg.picto')).toHaveCount(await tires.getByRole('button').count());
    expect((await dock(page).boundingBox())!.y, 'Pneus : le menu ne bouge pas').toBeCloseTo(top, 0);
    await volets.getByRole('button', { name: 'Cotes', exact: true }).click();
    expect((await dock(page).boundingBox())!.y, 'Cotes : le menu ne bouge pas').toBeCloseTo(top, 0);
    await volets.getByRole('button', { name: 'Jantes', exact: true }).click();

    // Suspension : chaque cran d'assiette montre la caisse plus ou moins basse.
    await openEntry(page, 'Suspension');
    const ride = dock(page).getByRole('group', { name: 'Assiette' });
    await expect(ride.locator('svg.picto')).toHaveCount(await ride.getByRole('button').count());

    // Intérieur : volets à icône ; volants, pommeaux et sièges en silhouette ; densités en étoiles.
    await openEntry(page, 'Intérieur');
    const inside = dock(page).locator('.dock-tab[data-onglet="interieur"]');
    const insideVolets = inside.getByRole('group', { name: 'Volets de l’intérieur' });
    for (const volet of ['Volant', 'Pommeau', 'Sièges', 'Ciel']) await expect(insideVolets.getByRole('button', { name: volet, exact: true }).locator('svg.icon')).toHaveCount(1);
    const steering = inside.getByRole('group', { name: 'Dessin du volant' });
    await expect(steering.locator('svg.picto')).toHaveCount(await steering.getByRole('button').count());
    const insideTop = (await dock(page).boundingBox())!.y;
    await page.waitForTimeout(600);
    await shot(page, '07-interieur-volants');
    for (const [volet, group] of [
      ['Pommeau', 'Pommeau de levier'],
      ['Sièges', 'Sièges avant'],
    ] as const) {
      await insideVolets.getByRole('button', { name: volet, exact: true }).click();
      const row = inside.getByRole('group', { name: group });
      await expect(row.locator('svg.picto')).toHaveCount(await row.getByRole('button').count());
      expect((await dock(page).boundingBox())!.y, `${volet} : le menu ne bouge pas`).toBeCloseTo(insideTop, 0);
    }
    await page.waitForTimeout(600);
    await shot(page, '08-interieur-sieges');
    await insideVolets.getByRole('button', { name: 'Ciel', exact: true }).click();
    await expect(inside.getByRole('group', { name: 'Densité des étoiles' }).locator('svg.picto-etoiles')).toHaveCount(3);
    expect((await dock(page).boundingBox())!.y, 'Ciel : le menu ne bouge pas').toBeCloseTo(insideTop, 0);

    // Peinture, étape Finition : chaque finition en sphère peinte de la teinte de la zone.
    await openEntry(page, 'Peinture');
    await dock(page).locator('.paint-zones .paint-zone').first().click();
    await dock(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name: 'Finition', exact: true }).click();
    const finishes = dock(page).getByRole('group', { name: 'Finitions' });
    await expect(finishes.locator('svg.picto-sphere')).toHaveCount(await finishes.getByRole('button').count());
    await waitForStill(page);
    await shot(page, '09-peinture-finitions');

    // Ambiance : ses couleurs.
    await openEntry(page, 'Ambiance');
    const ambiances = dock(page).getByRole('group', { name: 'Ambiance' });
    await expect(ambiances.locator('svg.picto')).toHaveCount(await ambiances.getByRole('button').count());

    // Sortie de nuit : la miniature du tracé de chaque carte fabriquée.
    await openEntry(page, ENTREE_SORTIE);
    const maps = dock(page).getByRole('group', { name: 'Carte' });
    await expect(maps.locator('svg.picto-carte')).toHaveCount(await maps.getByRole('button').count());
    await waitForStill(page);
    await shot(page, '10-sortie-cartes');
  });

  test('sur 360 × 780 en texte très grand, les quatre sections et leur icône tiennent sur une ligne', async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 360, height: 780 });
    for (const size of ['Grand', 'Très grand']) {
      await openApp(page, '#/reglages');
      const dialog = page.getByRole('dialog', { name: 'Réglages' });
      await dialog.getByRole('button', { name: 'Texte' }).click();
      await dialog.getByRole('button', { name: new RegExp(`^${size}`) }).click();
      await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
      await expect(dialog).toBeHidden();
      await backToSections(page);
      await expectSections(page, `360 × 780, texte ${size}`);
      expect((await dock(page).boundingBox())!.y, `texte ${size} : tiers bas`).toBeGreaterThanOrEqual((780 * 2) / 3 - 1);
      await sections(page).getByRole('button', { name: 'Custom', exact: true }).click();
      const entries = dock(page).getByRole('navigation', { name: 'Entrées · Custom' });
      for (const button of await entries.getByRole('button').all()) {
        const box = await button.boundingBox();
        if (box && (await button.isVisible())) expect(box.height, `texte ${size} : entrée à 48 px`).toBeGreaterThanOrEqual(48);
      }
      expect((await dock(page).boundingBox())!.y, `texte ${size} : entrées dans le tiers bas`).toBeGreaterThanOrEqual((780 * 2) / 3 - 1);
    }
    await backToSections(page);
    await waitForStill(page);
    await shot(page, '11-sections-360-tres-grand');
  });
});
