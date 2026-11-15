// Navigation du dock : la ligne de repère (« Retour », fil, « Fermer le menu »), la pile des niveaux
// de la peinture (zones → zone, couleur ou finition → nuancier), la pastille « Personnaliser » qui
// rouvre le dock là où on l'avait laissé, Échap, et le tiers bas aux deux tailles d'écran et aux
// trois tailles de texte, dock ouvert comme fermé. Captures : captures/navigation/.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openApp, openEntry, waitForScene } from './helpers.ts';

const dock = (page: Page) => page.locator('footer.dock');
const tabs = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });
const back = (page: Page) => dock(page).getByRole('button', { name: 'Retour', exact: true });
const close = (page: Page) => dock(page).getByRole('button', { name: 'Fermer le menu' });
const reopen = (page: Page) => dock(page).getByRole('button', { name: 'Personnaliser' });
const crumbs = (page: Page) => dock(page).locator('.dock-crumbs');
const zones = (page: Page) => dock(page).getByRole('group', { name: 'Zones' }).getByRole('button');
const colors = (page: Page) => dock(page).getByRole('group', { name: 'Couleurs' });
const picker = (page: Page) => dock(page).getByRole('region', { name: /^Nuancier/ });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'navigation', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Fil attendu : les morceaux, dans l'ordre. */
async function expectCrumbs(page: Page, parts: string[]): Promise<void> {
  await expect(crumbs(page).locator('.dock-crumb')).toHaveText(parts.map((part) => new RegExp(`^${part}$`, 'i')));
}

/** Toute commande visible du dock fait 48 px et se trouve dans le tiers bas. */
async function expectDockUnderThumb(page: Page, height: number, label: string): Promise<number> {
  const buttons = dock(page).locator('button:visible');
  const count = await buttons.count();
  for (let i = 0; i < count; i += 1) {
    const button = buttons.nth(i);
    const name = ((await button.getAttribute('aria-label')) ?? (await button.innerText())).trim().replace(/\s+/g, ' ');
    const box = await button.boundingBox();
    if (!box) continue;
    expect(box.height, `hauteur de « ${name} » (${label})`).toBeGreaterThanOrEqual(48);
    expect(box.width, `largeur de « ${name} » (${label})`).toBeGreaterThanOrEqual(48);
    expect(box.y, `« ${name} » dans le tiers bas (${label})`).toBeGreaterThanOrEqual((height * 2) / 3);
  }
  return count;
}

test.describe('navigation du dock', () => {
  test('peinture : descendre jusqu’au nuancier, remonter niveau par niveau, fermer, rouvrir au même endroit, recharger', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await waitForScene(page);

    // Tout en haut (section « Véhicule ») : le véhicule à l'écran dans la ligne de repère.
    await expect(dock(page).locator('.dock-vehicle')).not.toBeEmpty();
    await expect(back(page)).toHaveCount(0);
    // Haut de l'entrée « Peinture » : pas de « Retour », le fil dit où l'on est.
    await openEntry(page, 'Peinture');
    await expectCrumbs(page, ['Custom', 'Peinture']);
    await expect(back(page)).toHaveCount(0);
    await expect(close(page)).toBeVisible();
    await expect(zones(page).first()).toBeVisible();
    await expect(colors(page)).toHaveCount(0);
    const zone = ((await zones(page).first().locator('b').textContent()) ?? '').trim();
    await shot(page, '01-peinture-zones');

    // Une zone : ses couleurs, et « Retour » apparaît.
    await zones(page).first().tap();
    await expect(back(page)).toBeVisible();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Couleur']);
    await expect(colors(page)).toBeVisible();
    await shot(page, '02-peinture-zone-couleur');

    // Le nuancier.
    await dock(page).getByRole('button', { name: 'Autre couleur' }).tap();
    await expect(picker(page)).toBeVisible();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Nuancier']);
    await shot(page, '03-peinture-nuancier');

    // Retour : du nuancier aux couleurs.
    await back(page).tap();
    await expect(picker(page)).toHaveCount(0);
    await expect(colors(page)).toBeVisible();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Couleur']);

    // Les finitions sont une autre vue du même niveau : « Retour » mène à la liste des zones.
    await dock(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name: 'Finition' }).tap();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Finition']);
    await back(page).tap();
    await expect(zones(page).first()).toBeVisible();
    await expect(back(page)).toHaveCount(0);

    // Fermer le menu : une seule pastille au pouce, le cadrage d'origine.
    await zones(page).first().tap();
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Couleur']);
    await close(page).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'ferme');
    await expect(reopen(page)).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.locator('.stage')).toHaveAttribute('data-decalage', '0');
    await shot(page, '04-dock-ferme');

    // « Personnaliser » rouvre là où on l'avait laissé : même onglet, même zone.
    await reopen(page).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'compact');
    await expect(tabs(page).getByRole('button', { name: 'Custom' })).toHaveAttribute('aria-current', 'true');
    await expectCrumbs(page, ['Custom', 'Peinture', zone, 'Couleur']);

    // Rechargement : le dock fermé est retrouvé.
    await close(page).tap();
    await expect(reopen(page)).toBeVisible();
    await page.reload();
    await expect(reopen(page)).toBeVisible();
    await expect(dock(page)).toHaveAttribute('data-taille', 'ferme');
    await reopen(page).tap();
    await expect(tabs(page)).toBeVisible();
  });

  test('clavier : Échap remonte d’un niveau, puis ferme le menu ; les boutons se nomment', async ({ page }) => {
    await openApp(page);
    await openEntry(page, 'Peinture');
    await zones(page).first().click();
    await dock(page).getByRole('button', { name: 'Autre couleur' }).click();
    await expect(picker(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(picker(page)).toHaveCount(0);
    await expect(colors(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(zones(page).first()).toBeVisible();
    await expect(back(page)).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(reopen(page)).toBeVisible();
    // Au clavier, la pastille se trouve et rouvre le dock.
    await reopen(page).focus();
    await page.keyboard.press('Enter');
    await expect(close(page)).toBeVisible();
    // Un panneau ouvert garde sa touche Échap : le dock ne bouge pas.
    await page.goto('./#/reglages');
    await expect(page.getByRole('dialog', { name: 'Réglages' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(close(page)).toBeVisible();
  });

  test('tiers bas et 48 px : deux tailles d’écran, trois tailles de texte, dock ouvert comme fermé', async ({ page }) => {
    test.setTimeout(240_000);
    for (const viewport of [
      { width: 390, height: 844 },
      { width: 360, height: 780 },
    ]) {
      await page.setViewportSize(viewport);
      for (const size of ['Normal', 'Grand', 'Très grand']) {
        const label = `${viewport.width} × ${viewport.height}, ${size}`;
        await openApp(page, '#/reglages');
        const dialog = page.getByRole('dialog', { name: 'Réglages' });
        await dialog.getByRole('button', { name: 'Texte' }).click();
        await dialog.getByRole('button', { name: new RegExp(`^${size}`) }).click();
        await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
        await expect(dialog).toBeHidden();
        if (await reopen(page).isVisible()) await reopen(page).click();

        // Ouvert, au plus profond de la peinture hors nuancier : une zone, ses couleurs.
        await openEntry(page, 'Peinture');
        await zones(page).first().click();
        await expect(back(page)).toBeVisible();
        expect(await expectDockUnderThumb(page, viewport.height, `${label}, ouvert`)).toBeGreaterThan(4);

        // Fermé : la seule pastille, au pouce.
        await close(page).click();
        await expect(reopen(page)).toBeVisible();
        expect(await expectDockUnderThumb(page, viewport.height, `${label}, fermé`)).toBe(1);
      }
    }
    await shot(page, '05-ferme-360-texte-tres-grand');
  });

  test('défilement stable : choisir une option ne déplace jamais le menu ; « Retour » rend la position du niveau', async ({ page }) => {
    test.setTimeout(150_000);
    await openApp(page);
    await waitForScene(page);
    const body = dock(page).locator('.dock-tab');

    // Compact, rangée qui défile : la liste des zones, poussée au bout, puis une zone et « Retour ».
    await openEntry(page, 'Peinture');
    const zoneRow = dock(page).getByRole('group', { name: 'Zones' });
    const zoneLeft = await zoneRow.evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
      return row.scrollLeft;
    });
    expect(zoneLeft, 'la rangée des zones défile en compact').toBeGreaterThan(0);
    const lastZone = zones(page).last();
    await lastZone.tap();
    await expect(back(page)).toBeVisible();
    await back(page).tap();
    await expect.poll(() => zoneRow.evaluate((row) => row.scrollLeft), { message: 'position des zones rendue au retour' }).toBe(zoneLeft);

    // Compact, finitions d'une zone : la rangée poussée au bout, une finition choisie, rien ne bouge.
    await zones(page).first().tap();
    await dock(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name: 'Finition' }).tap();
    const finishRow = dock(page).getByRole('group', { name: 'Finitions' });
    const finishLeft = await finishRow.evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
      return row.scrollLeft;
    });
    expect(finishLeft, 'la rangée des finitions défile en compact').toBeGreaterThan(0);
    const lastFinish = finishRow.getByRole('button').last();
    await lastFinish.tap();
    await expect(lastFinish).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await finishRow.evaluate((row) => row.scrollLeft), 'finitions : position inchangée').toBe(finishLeft);

    // Garage · Ambiance, compact : une ambiance au bout de la rangée.
    await openEntry(page, 'Ambiance');
    const ambianceRow = dock(page).getByRole('group', { name: 'Ambiance' });
    const ambianceLeft = await ambianceRow.evaluate((row) => {
      row.scrollLeft = row.scrollWidth;
      return row.scrollLeft;
    });
    const lastAmbiance = ambianceRow.getByRole('button').last();
    await lastAmbiance.tap();
    await expect(lastAmbiance).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await ambianceRow.evaluate((row) => row.scrollLeft), 'ambiances : position inchangée').toBe(ambianceLeft);

    // Agrandi : couleurs et finitions d'une zone ; on descend jusqu'aux finitions, on en choisit une.
    await dock(page).getByRole('button', { name: 'Agrandir le menu' }).tap();
    await expect(dock(page)).toHaveAttribute('data-taille', 'agrandi');
    await openEntry(page, 'Peinture');
    await zones(page).first().tap();
    await expect(back(page)).toBeVisible();
    const candy = dock(page).getByRole('group', { name: 'Finitions' }).getByRole('button', { name: /^Candy/ });
    await candy.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    const top = await body.evaluate((element) => element.scrollTop);
    expect(top, 'la zone de l’entrée défile en agrandi').toBeGreaterThan(0);
    await candy.tap();
    await expect(candy).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await body.evaluate((element) => element.scrollTop), 'agrandi : position inchangée après une finition').toBe(top);
    await shot(page, '06-agrandi-finition-choisie');

    // Agrandi, Mécanique · Préparation : un stage choisi en bas de la fiche ne remonte rien.
    await tabs(page).getByRole('button', { name: 'Mécanique', exact: true }).tap();
    const stage = body.getByRole('button', { name: /^Stage 2/ });
    await stage.evaluate((element) => element.scrollIntoView({ block: 'end' }));
    const engineTop = await body.evaluate((element) => element.scrollTop);
    await stage.tap();
    await expect(stage).toHaveAttribute('aria-pressed', 'true');
    await page.waitForTimeout(300);
    expect(await body.evaluate((element) => element.scrollTop), 'préparation : position inchangée').toBe(engineTop);
    await dock(page).getByRole('button', { name: 'Réduire le menu' }).tap();
  });
});
