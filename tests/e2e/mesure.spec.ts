import { expect, test, type Locator, type Page } from '@playwright/test';
import { capture, openApp, waitForBench } from './helpers.ts';

// « Comparer » dans « Sous le capot » (src/render/frameMeter.ts, src/scene/FrameMeter.tsx) :
// quatre mesures d'affilée, une variante de la scène chacune (réglage en cours, trame partout,
// sans reflet du sol, densité 1), puis tout est rendu : trame retirée, reflet et densité revenus,
// plus aucun dessin au repos. Rendu logiciel : chaque mesure prend ses quatre secondes, mais la
// pose des variantes (compilation de la trame en mouvement réduit) et les images sont lentes.
// Densité 1,5 : « Densité 1 » a quelque chose à mesurer (2 serait plus lent encore en rendu logiciel).
test.use({ deviceScaleFactor: 1.5 });

/** Compte les appels de dessin WebGL de la page. */
const COUNT_DRAWS = `
  window.__draws = 0;
  for (const name of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced']) {
    const original = WebGL2RenderingContext.prototype[name];
    WebGL2RenderingContext.prototype[name] = function (...args) {
      window.__draws += 1;
      return original.apply(this, args);
    };
  }`;

const draws = (page: Page) => page.evaluate(() => (window as unknown as { __draws: number }).__draws);

async function drawsOverTwoSeconds(page: Page): Promise<number> {
  const before = await draws(page);
  await page.waitForTimeout(2000);
  return (await draws(page)) - before;
}

const IDS = ['courant', 'trame', 'sans-reflet', 'densite-1'] as const;

/** Appels de dessin d'une ligne de résultat (« … · 141 appels. »). */
async function callsOf(line: Locator): Promise<number> {
  const match = /([\d\s]+)\sappels/.exec(await line.innerText());
  return Number((match?.[1] ?? '').replace(/\s/g, ''));
}

async function openPanel(page: Page) {
  await page.getByRole('button', { name: 'Sous le capot' }).click();
  const dialog = page.getByRole('dialog', { name: 'Sous le capot' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('mesure comparée', () => {
  test('« Comparer » : quatre résultats, puis la scène rendue telle quelle et muette', async ({ page }) => {
    test.setTimeout(420_000);
    await page.addInitScript({ content: COUNT_DRAWS });
    await openApp(page);
    // Véhicule posé et image immobile (délais larges : la densité 1,5 ralentit le rendu logiciel).
    await waitForBench(page);
    const stage = page.locator('.stage');
    const dialog = await openPanel(page);

    const quality = dialog.locator('[data-fact="qualite"]');
    const floor = dialog.locator('[data-fact="sol"]');
    await expect(quality).toHaveText(/pixel ratio 1,5\./);
    await expect(floor).toHaveText(/Réflexion du sol sur \d+\s×\s\d+\spx/);
    const qualityBefore = await quality.innerText();
    const floorBefore = await floor.innerText();

    const fact = dialog.locator('[data-fact="comparer"]');
    await expect(fact).toHaveText(/vingtaine de secondes.*ne touche à rien/);
    const button = dialog.getByRole('button', { name: 'Comparer' });
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    await button.click();
    await expect(fact).toHaveAttribute('data-etat', 'en-cours');
    await expect(dialog.getByRole('button', { name: 'Mesurer' })).toBeDisabled();

    // Pendant « Trame partout », tous les porteurs ont la trame ; pendant « Densité 1 », pixel ratio 1.
    await expect(fact).toHaveText(/Mesure 2 sur 4 \(trame partout\)/, { timeout: 120_000 });
    await expect.poll(async () => Number(await stage.getAttribute('data-trame')), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(fact).toHaveText(/Mesure 4 sur 4 \(densité 1\)/, { timeout: 180_000 });
    await expect(quality).toHaveText(/pixel ratio 1\./, { timeout: 60_000 });

    await expect(fact).toHaveAttribute('data-etat', 'finie', { timeout: 180_000 });
    for (const id of IDS) {
      const line = dialog.locator(`[data-fact="comparer-${id}"]`);
      await expect(line).toHaveAttribute('data-mesuree', 'oui');
      await expect(line).toHaveText(/[\d\s,]+\si\/s\s·\s[\d\s,]+\sms par image.*[\d\s,]+\si\/s au pire centile\s·\sprocesseur [\d\s,]+\sms\s·\s[\d\s]+\sappels\./);
    }
    // Sans reflet du sol : la passe de réflexion (une scène et quatre passes de flou) n'est plus dessinée.
    const current = await callsOf(dialog.locator('[data-fact="comparer-courant"]'));
    const plain = await callsOf(dialog.locator('[data-fact="comparer-sans-reflet"]'));
    expect(plain, 'moins d’appels sans le reflet du sol').toBeLessThan(current);
    await expect(fact).toHaveText(/Standard, pixel ratio 1,5, 4 secondes de rotation par mesure/);

    // Tout est rendu : plus de trame, reflet et densité d'origine, et le rendu se tait.
    await expect(stage).toHaveAttribute('data-trame', '0');
    await expect(quality).toHaveText(qualityBefore);
    await expect(floor).toHaveText(floorBefore);
    await expect(dialog.getByRole('button', { name: 'Comparer' })).toBeEnabled();
    await expect.poll(() => drawsOverTwoSeconds(page), { message: 'aucun dessin au repos', timeout: 60_000 }).toBe(0);
    await fact.scrollIntoViewIfNeeded();
    await capture(page, 'capot-comparer');
    const lines = await Promise.all(IDS.map((id) => dialog.locator(`[data-fact="comparer-${id}"]`).innerText()));
    test.info().annotations.push({ type: 'comparer', description: lines.join(' | ') });
  });

  test('panneau fermé en pleine comparaison : la variante est retirée, les mesures faites restent', async ({ page }) => {
    test.setTimeout(300_000);
    await page.addInitScript({ content: COUNT_DRAWS });
    await openApp(page);
    // Véhicule posé et image immobile (délais larges : la densité 1,5 ralentit le rendu logiciel).
    await waitForBench(page);
    const stage = page.locator('.stage');
    let dialog = await openPanel(page);
    const qualityBefore = await dialog.locator('[data-fact="qualite"]').innerText();
    const fact = dialog.locator('[data-fact="comparer"]');
    await dialog.getByRole('button', { name: 'Comparer' }).click();
    await expect(fact).toHaveText(/Mesure 2 sur 4/, { timeout: 120_000 });
    await expect.poll(async () => Number(await stage.getAttribute('data-trame')), { timeout: 60_000 }).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(stage).toHaveAttribute('data-trame', '0');
    await expect.poll(() => drawsOverTwoSeconds(page), { message: 'aucun dessin après l’abandon', timeout: 60_000 }).toBe(0);

    dialog = await openPanel(page);
    await expect(dialog.locator('[data-fact="comparer"]')).toHaveAttribute('data-etat', 'interrompue');
    await expect(dialog.locator('[data-fact="comparer"]')).toHaveText(/Comparaison interrompue\s: panneau fermé/);
    await expect(dialog.locator('[data-fact="comparer-courant"]')).toHaveAttribute('data-mesuree', 'oui');
    await expect(dialog.locator('[data-fact="comparer-trame"]')).toHaveCount(0);
    await expect(dialog.locator('[data-fact="qualite"]')).toHaveText(qualityBefore);
    await expect(dialog.getByRole('button', { name: 'Comparer' })).toBeEnabled();
  });
});
