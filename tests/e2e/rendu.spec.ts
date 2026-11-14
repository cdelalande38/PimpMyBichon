import { expect, test, type Page } from '@playwright/test';
import { capture, changedRatio, openApp, sceneBand, waitForBench, waitForScene, waitForStill } from './helpers.ts';

// Jalon 1, rendu cible : une capture par ambiance et par finition clé, pour juger à l'œil
// (captures/jalon-1/), et les relevés de « Sous le capot » (coût d'une image, sonde).

const dock = (page: Page) => page.locator('footer.dock');

async function pick(page: Page, tab: string, choice: string): Promise<void> {
  await dock(page).getByRole('navigation', { name: 'Banc d’essai' }).getByRole('button', { name: tab }).tap();
  const button = dock(page).getByRole('group', { name: tab }).getByRole('button', { name: new RegExp(`^${choice}`) });
  await button.tap();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function facts(page: Page): Promise<{ image: string; sonde: string }> {
  await page.goto('./#/capot');
  const image = (await page.locator('[data-fact="image"]').innerText()).trim();
  const sonde = (await page.locator('[data-fact="sonde"]').innerText()).trim();
  await page.goBack();
  return { image, sonde };
}

test.describe('rendu cible', () => {
  test.setTimeout(420_000);

  test('trois ambiances : la sonde se refait à chaque changement, jamais au repos', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await capture(page, '10-ambiance-bichon');

    const first = await facts(page);
    expect(first.image).toMatch(/\d+ appels de dessin · [\d\s ]+ triangles/);
    expect(first.sonde).toMatch(/Sonde de 256 px par face, calculée en \d+ ms \(1 calcul\)/);
    test.info().annotations.push({ type: 'image', description: first.image }, { type: 'sonde', description: first.sonde });
    await waitForStill(page);

    for (const [label, file] of [
      ['Néon', '11-ambiance-neon'],
      ['Atelier', '12-ambiance-atelier'],
    ] as const) {
      const before = await sceneBand(page);
      await pick(page, 'Ambiance', label);
      await waitForStill(page);
      expect(await changedRatio(before, await sceneBand(page)), `« ${label} » change l’image`).toBeGreaterThan(0.05);
      await capture(page, file);
    }
    const last = await facts(page);
    expect(last.sonde).toMatch(/\(3 calculs\)/);
    test.info().annotations.push({ type: 'sonde-fin', description: last.sonde });
  });

  test('finitions clés sous l’ambiance Bichon', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    const looks: Array<[color: string, finish: string, file: string]> = [
      ['Vert Bichon', 'Pailleté', '13-finition-paillete-vert'],
      ['Violet', 'Chrome coloré', '14-finition-chrome-colore'],
      ['Bleu nuit', 'Caméléon', '15-finition-cameleon'],
      ['Gris pick-up', 'Mat', '16-finition-mat'],
    ];
    for (const [color, finish, file] of looks) {
      await pick(page, 'Teinte', color);
      await pick(page, 'Finition', finish);
      await waitForStill(page);
      await capture(page, file);
    }
  });
});
