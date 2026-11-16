import { expect, test, type Page } from '@playwright/test';
import { backToSections, capture, changedRatio, openApp, openEntry, paintAndReload, readBuilds, reloadSaved, sceneBand, waitForBench, waitForScene, waitForStill } from './helpers.ts';

// L'atelier dans le dock : onglets Véhicule, Peinture, Ambiance. L'ambiance se change au pouce ;
// la peinture est posée par la sauvegarde des builds (l'interface de peinture a ses propres parcours).

const dock = (page: Page) => page.locator('footer.dock');
const tabs = (page: Page) => dock(page).getByRole('navigation', { name: 'Onglets de l’atelier' });

/** Touche un onglet du dock, puis un choix de sa rangée, au pouce. */
async function pick(page: Page, tab: string, choice: string): Promise<void> {
  await openEntry(page, tab);
  // Le nom exact est dans le <b> du bouton.
  const button = dock(page)
    .getByRole('group', { name: tab })
    .getByRole('button')
    .filter({ has: page.locator('b', { hasText: new RegExp(`^${choice}$`) }) });
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function pressed(page: Page, tab: string): Promise<string> {
  await openEntry(page, tab);
  const button = dock(page).getByRole('group', { name: tab }).locator('[aria-pressed="true"]');
  return (await button.locator('b').innerText()).trim();
}

test.describe('atelier', () => {
  test.setTimeout(240_000);

  test('peinture et ambiance changent l’image et restent après rechargement', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    const vehicle = (await page.locator('.stage').getAttribute('data-vehicle')) ?? '';
    expect(await pressed(page, 'Ambiance')).toBe('Bichon');

    let before = await sceneBand(page);
    await paintAndReload(page, vehicle, { carrosserie: { color: '#ff6a00', finish: 'chrome' } });
    expect(await changedRatio(before, await sceneBand(page)), 'la peinture change l’image').toBeGreaterThan(0.01);

    before = await sceneBand(page);
    await pick(page, 'Ambiance', 'Néon');
    await waitForStill(page);
    expect(await changedRatio(before, await sceneBand(page)), '« Néon » change l’image').toBeGreaterThan(0.01);
    await capture(page, '02-banc-orange-chrome-neon');

    await paintAndReload(page, vehicle, { carrosserie: { color: '#5b1a8e', finish: 'candy' } });
    await pick(page, 'Ambiance', 'Atelier');
    await waitForStill(page);
    await capture(page, '03-banc-violet-candy-atelier');

    // Reprise : les sauvegardes IndexedDB sont relues au lancement suivant.
    await reloadSaved(page);
    await waitForBench(page);
    expect(await pressed(page, 'Ambiance')).toBe('Atelier');
    expect((await readBuilds(page))?.builds[vehicle]?.paints.carrosserie).toEqual({ color: '#5b1a8e', finish: 'candy' });
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

      for (const tab of ['Véhicule', 'Custom', 'Mécanique', 'Garage']) {
        // Un seul niveau du menu à la fois : on remonte aux sections avant chaque section.
        await backToSections(page);
        await tabs(page).getByRole('button', { name: tab, exact: true }).click();
        const buttons = dock(page).locator('button:visible');
        const count = await buttons.count();
        // Au moins « Retour », la croix et une commande : la poignée ne s'affiche plus que là où
        // agrandir montre quelque chose de plus, et une section peut n'avoir que deux entrées.
        expect(count).toBeGreaterThanOrEqual(3);
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
