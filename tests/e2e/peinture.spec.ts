import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { changedRatio, openApp, sceneBand, waitForScene, waitForStill } from './helpers.ts';

// Jalon 3 (§ 5.2) : l'onglet « Peinture » du dock. Zone, couleur saisie en hexadécimal,
// finition, zone détachée de la carrosserie : tout est retrouvé après rechargement.

const VIEW_HEIGHT = 844;
const paint = (page: Page) => page.locator('footer.dock .paint');
const zones = (page: Page) => paint(page).getByRole('group', { name: 'Zones' }).getByRole('button');
const lock = (page: Page) => paint(page).locator('.paint-lock');

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'peinture', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

async function step(page: Page, name: 'Couleur' | 'Finition'): Promise<void> {
  const tab = paint(page).getByRole('navigation', { name: 'Peinture' }).getByRole('button', { name });
  await tab.tap();
  await expect(tab).toHaveAttribute('aria-current', 'true');
}

function finishChip(page: Page, label: string): Locator {
  return paint(page)
    .getByRole('group', { name: 'Finitions' })
    .getByRole('button')
    .filter({ has: page.locator('b', { hasText: new RegExp(`^${label}$`) }) });
}

/** L'onglet « Peinture » du dock (l'atelier s'ouvre sur un autre onglet). */
async function openPaintTab(page: Page): Promise<void> {
  const tab = page.locator('footer.dock').getByRole('navigation', { name: 'Onglets de l’atelier' }).getByRole('button', { name: 'Peinture' });
  await tab.tap();
  await expect(tab).toHaveAttribute('aria-current', 'true');
}

/** Première zone qui porte un cadenas (zone de carrosserie autre que la maîtresse). */
async function linkableZone(page: Page): Promise<number> {
  const count = await zones(page).count();
  for (let index = 1; index < count; index += 1) {
    await zones(page).nth(index).tap();
    if (await lock(page).isVisible()) return index;
  }
  throw new Error('aucune zone à cadenas sur ce véhicule');
}

test.describe('peinture', () => {
  test.setTimeout(300_000);

  test('zone, couleur hexadécimale, finition et zone détachée sont retrouvées après rechargement', async ({
    page,
  }) => {
    await openApp(page);
    await waitForScene(page);
    await openPaintTab(page);
    await expect(zones(page).first()).toBeVisible({ timeout: 120_000 });
    await waitForStill(page);

    // Le dock reste dans le tiers bas : le véhicule se voit pendant qu'on peint.
    const paintBox = await paint(page).boundingBox();
    expect(paintBox?.y ?? 0).toBeGreaterThanOrEqual((VIEW_HEIGHT * 2) / 3 - 40);
    // Zone maîtresse en tête, choisie d'office.
    await expect(zones(page).first()).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '01-zones');

    // Couleur saisie au nuancier, en hexadécimal.
    const before = await sceneBand(page);
    await paint(page).getByRole('button', { name: 'Autre couleur' }).tap();
    const picker = paint(page).getByRole('region', { name: /^Nuancier/ });
    await expect(picker).toBeVisible();
    const pickerBox = await picker.boundingBox();
    expect(pickerBox?.y ?? 0, 'le nuancier ne dépasse pas la moitié de l’écran').toBeGreaterThanOrEqual(VIEW_HEIGHT / 2);
    await expect(picker.getByRole('slider', { name: 'Teinte' })).toBeVisible();
    await expect(picker.getByRole('slider', { name: 'Saturation et luminosité' })).toBeVisible();
    const hex = picker.getByRole('textbox', { name: 'Code hexadécimal' });
    await hex.fill('FF3FA4');
    await hex.press('Enter');
    await expect(hex).toHaveValue('#ff3fa4');
    await waitForStill(page);
    expect(await changedRatio(before, await sceneBand(page)), 'la couleur saisie change l’image').toBeGreaterThan(0.01);
    await shot(page, '04-nuancier');

    // Au clavier, la teinte bouge et l'aperçu suit.
    const hue = picker.getByRole('slider', { name: 'Teinte' });
    await hue.focus();
    const hueBefore = Number(await hue.getAttribute('aria-valuenow'));
    await hue.press('ArrowRight');
    await expect(hue).toHaveAttribute('aria-valuenow', String(hueBefore + 5));
    await expect(hex).not.toHaveValue('#ff3fa4');
    await hex.fill('#ff3fa4');
    await hex.press('Enter');
    await picker.getByRole('button', { name: 'C’est bon' }).tap();
    await expect(picker).toBeHidden();

    // La couleur (hors palette) entre dans les dernières couleurs, pressée.
    const recent = paint(page).getByRole('button', { name: 'Récente #ff3fa4' });
    await expect(recent).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '02-couleurs');

    // Finition à paillettes, et sa taille.
    await step(page, 'Finition');
    await finishChip(page, 'Pailleté').tap();
    await expect(finishChip(page, 'Pailleté')).toHaveAttribute('aria-pressed', 'true');
    const flake = paint(page).getByRole('slider', { name: /Paillette/ });
    await flake.fill('1.5');
    await expect(paint(page).locator('.paint-flake output')).toHaveText('1,5 mm');
    await shot(page, '03-finitions');

    // Une zone de carrosserie liée se détache au cadenas, puis prend sa propre couleur.
    await step(page, 'Couleur');
    const detached = await linkableZone(page);
    await expect(lock(page)).toHaveAttribute('aria-pressed', 'true');
    await lock(page).tap();
    await expect(lock(page)).toHaveAttribute('aria-pressed', 'false');
    const navy = paint(page).getByRole('button', { name: 'Bleu nuit', exact: true });
    await navy.tap();
    await expect(navy).toHaveAttribute('aria-pressed', 'true');
    await shot(page, '05-zone-detachee');

    // Rechargement : la sauvegarde est relue.
    await page.reload();
    await waitForScene(page);
    await openPaintTab(page);
    await expect(zones(page).first()).toBeVisible({ timeout: 120_000 });
    await expect(paint(page).getByRole('button', { name: 'Récente #ff3fa4' })).toHaveAttribute('aria-pressed', 'true');
    await step(page, 'Finition');
    await expect(finishChip(page, 'Pailleté')).toHaveAttribute('aria-pressed', 'true');
    await expect(paint(page).locator('.paint-flake output')).toHaveText('1,5 mm');
    await step(page, 'Couleur');
    await zones(page).nth(detached).tap();
    await expect(lock(page)).toHaveAttribute('aria-pressed', 'false');
    await expect(paint(page).getByRole('button', { name: 'Bleu nuit', exact: true })).toHaveAttribute('aria-pressed', 'true');
  });
});
