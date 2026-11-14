import { expect, test, type Page } from '@playwright/test';
import {
  capture,
  changedRatio,
  openApp,
  sceneBand,
  waitForBench,
  waitForScene,
  waitForStill,
} from './helpers.ts';

// Jalon 1 : le modèle de banc d'essai et ses commandes (teinte, finition, ambiance).

const dock = (page: Page) => page.locator('footer.dock');

/** Touche un onglet du dock, puis un choix de sa rangée, au pouce. */
async function pick(page: Page, tab: string, choice: string): Promise<void> {
  await dock(page).getByRole('navigation', { name: 'Banc d’essai' }).getByRole('button', { name: tab }).tap();
  const button = dock(page).getByRole('group', { name: tab }).getByRole('button', { name: new RegExp(`^${choice}`) });
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function pressed(page: Page, tab: string): Promise<string> {
  await dock(page).getByRole('navigation', { name: 'Banc d’essai' }).getByRole('button', { name: tab }).tap();
  const button = dock(page).getByRole('group', { name: tab }).locator('[aria-pressed="true"]');
  return (await button.locator('b').innerText()).trim();
}

test.describe('banc d’essai', () => {
  test.setTimeout(240_000);

  test('teinte, finition et ambiance se changent au pouce et restent après rechargement', async ({
    page,
  }) => {
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    // Origine : Vert Bichon métallisé, ambiance Bichon.
    expect(await pressed(page, 'Teinte')).toBe('Vert Bichon');
    expect(await pressed(page, 'Finition')).toBe('Métallisé');
    expect(await pressed(page, 'Ambiance')).toBe('Bichon');

    const steps: Array<[tab: string, choice: string]> = [
      ['Teinte', 'Orange piste'],
      ['Finition', 'Chrome'],
      ['Ambiance', 'Néon'],
    ];
    for (const [tab, choice] of steps) {
      const before = await sceneBand(page);
      await pick(page, tab, choice);
      await waitForStill(page);
      expect(await changedRatio(before, await sceneBand(page)), `« ${choice} » change l’image`).toBeGreaterThan(0.01);
    }
    await capture(page, '02-banc-orange-chrome-neon');

    await pick(page, 'Finition', 'Candy');
    await pick(page, 'Teinte', 'Violet');
    await pick(page, 'Ambiance', 'Atelier');
    await waitForStill(page);
    await capture(page, '03-banc-violet-candy-atelier');

    // Reprise : la sauvegarde IndexedDB est relue au lancement suivant.
    await page.reload();
    await waitForBench(page);
    expect(await pressed(page, 'Teinte')).toBe('Violet');
    expect(await pressed(page, 'Finition')).toBe('Candy');
    expect(await pressed(page, 'Ambiance')).toBe('Atelier');
  });

  test('sur un écran plus petit (360 × 780), le dock reste sous le pouce à toutes les tailles de texte', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 780 });
    for (const size of ['Normal', 'Grand', 'Très grand']) {
      await openApp(page, '#/reglages');
      const dialog = page.getByRole('dialog', { name: 'Réglages' });
      await dialog.getByRole('button', { name: 'Texte' }).click();
      await dialog.getByRole('button', { name: new RegExp(`^${size}`) }).click();
      await dialog.getByRole('button', { name: 'Retour à l’atelier' }).click();
      await expect(dialog).toBeHidden();

      for (const tab of ['Teinte', 'Finition', 'Ambiance']) {
        await dock(page).getByRole('navigation', { name: 'Banc d’essai' }).getByRole('button', { name: tab }).click();
        const buttons = dock(page).locator('button:visible');
        const count = await buttons.count();
        expect(count).toBeGreaterThan(4);
        for (let i = 0; i < count; i += 1) {
          const button = buttons.nth(i);
          const label = (await button.innerText()).trim().replace(/\s+/g, ' ');
          const box = await button.boundingBox();
          if (!box) continue;
          expect(box.height, `hauteur de « ${label} » (${size})`).toBeGreaterThanOrEqual(48);
          expect(box.width, `largeur de « ${label} » (${size})`).toBeGreaterThanOrEqual(48);
          expect(box.y, `« ${label} » dans le tiers bas (${size})`).toBeGreaterThanOrEqual((780 * 2) / 3);
        }
      }
    }
    await capture(page, '04-dock-360-texte-tres-grand');
  });
});
