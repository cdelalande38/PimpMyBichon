import { expect, test, type Locator, type Page } from '@playwright/test';
import { capture, openApp, waitForBench } from './helpers.ts';

// « Comparer » dans « Sous le capot » (src/render/frameMeter.ts, src/scene/FrameMeter.tsx) :
// cinq variantes de la scène (réglage en cours, trame partout, sans reflet du sol, sans mobilier,
// densité 1), mesurées deux fois chacune, à l'aller puis au retour ; puis tout est rendu : trame
// retirée, reflet, mobilier et densité revenus, plus aucun dessin au repos. Rendu logiciel : chaque
// fenêtre garde au moins quelques images, la pose des variantes (compilation de la trame en
// mouvement réduit) et les images sont lentes.
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

const IDS = ['courant', 'trame', 'sans-reflet', 'sans-mobilier', 'densite-1'] as const;
const NBSP = ' ';

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
  test('« Comparer » : cinq résultats aller-retour, puis la scène rendue telle quelle et muette', async ({ page }) => {
    test.setTimeout(480_000);
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
    // Durée annoncée (une demi-minute), espace insécable entre le nombre et l'unité.
    await expect(fact).toHaveText(/5\svariantes de la scène, deux fois chacune.*compte 3\d\ssecondes.*ne touche à rien/);
    expect(await fact.innerText()).toMatch(new RegExp(`compte 3\\d${NBSP}secondes`));
    const button = dialog.getByRole('button', { name: 'Comparer' });
    const box = await button.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    await button.click();
    await expect(fact).toHaveAttribute('data-etat', 'en-cours');
    await expect(dialog.getByRole('button', { name: 'Mesurer' })).toBeDisabled();

    // Aller : pendant « Trame partout », tous les porteurs ont la trame ; pendant « Densité 1 », pixel ratio 1.
    await expect(fact).toHaveText(/Mesure 2 sur 10 \(trame partout, aller\)/, { timeout: 120_000 });
    await expect.poll(async () => Number(await stage.getAttribute('data-trame')), { timeout: 60_000 }).toBeGreaterThan(0);
    await expect(fact).toHaveText(/Mesure 5 sur 10 \(densité 1, aller\)/, { timeout: 180_000 });
    await expect(quality).toHaveText(/pixel ratio 1\./, { timeout: 60_000 });
    // Retour : les mêmes, à rebours.
    await expect(fact).toHaveText(/Mesure (6|7) sur 10 \((densité 1|sans mobilier), retour\)/, { timeout: 180_000 });

    await expect(fact).toHaveAttribute('data-etat', 'finie', { timeout: 240_000 });
    for (const id of IDS) {
      const line = dialog.locator(`[data-fact="comparer-${id}"]`);
      await expect(line).toHaveAttribute('data-mesuree', 'oui');
      await expect(line).toHaveAttribute('data-plafond', /^(oui|non)$/);
      await expect(line).toHaveText(
        /[\d\s,]+\si\/s, [\d\s,]+\sms.*·\saller-retour à [\d\s,]+( et [\d\s,]+)?\sms près\s·\sprocesseur [\d\s,]+\sms\s·\s[\d\s]+\sappels\./,
      );
      // Nombre et unité jamais séparés par une espace ordinaire (ni coupés en fin de ligne).
      const text = await line.innerText();
      expect(text, id).not.toMatch(/\d (ms|i\/s|appels)/);
      expect(text, id).toContain(`${NBSP}ms`);
    }
    // Écart au réglage en cours sur chaque variante (sauf au plafond de l'écran), avec son verdict.
    await expect(dialog.locator('[data-fact="comparer-courant"]')).not.toHaveText(/\([+−±][\d,]+\sms/);
    // Sans reflet du sol : la passe de réflexion (une scène et quatre passes de flou) n'est plus dessinée ;
    // sans mobilier : objets, œuvres et ombres de contact non plus.
    const current = await callsOf(dialog.locator('[data-fact="comparer-courant"]'));
    const plain = await callsOf(dialog.locator('[data-fact="comparer-sans-reflet"]'));
    const bare = await callsOf(dialog.locator('[data-fact="comparer-sans-mobilier"]'));
    expect(plain, 'moins d’appels sans le reflet du sol').toBeLessThan(current);
    expect(bare, 'moins d’appels sans le mobilier').toBeLessThan(current);
    // L'état dit le niveau, le bruit de l'essai, le rythme de l'écran, et s'il faut recommencer.
    await expect(fact).toHaveText(/Standard, pixel ratio 1,5, deux passages par variante\. Bruit\s: [\d,]+\sms par image/);
    await expect(fact).toHaveText(/Écran\s: \d+\si\/s\.|Rythme de l’écran pas reconnu\./);
    await expect(fact).toHaveAttribute('data-recommencer', /^(oui|non)$/);
    if ((await fact.getAttribute('data-recommencer')) === 'oui') await expect(fact).toHaveText(/Trop de bruit pour conclure\s: relance «\sComparer\s»/);

    // Tout est rendu : plus de trame, reflet et densité d'origine, et le rendu se tait.
    await expect(stage).toHaveAttribute('data-trame', '0');
    await expect(quality).toHaveText(qualityBefore);
    await expect(floor).toHaveText(floorBefore);
    await expect(dialog.getByRole('button', { name: 'Comparer' })).toBeEnabled();
    await expect.poll(() => drawsOverTwoSeconds(page), { message: 'aucun dessin au repos', timeout: 60_000 }).toBe(0);
    await fact.scrollIntoViewIfNeeded();
    await capture(page, 'capot-comparer');
    const lines = await Promise.all(IDS.map((id) => dialog.locator(`[data-fact="comparer-${id}"]`).innerText()));
    test.info().annotations.push({ type: 'comparer', description: [await fact.evaluate((node) => node.firstChild?.textContent ?? ''), ...lines].join(' | ') });
  });

  test('panneau fermé en pleine comparaison : la variante est retirée, la comparaison dite interrompue', async ({ page }) => {
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
    await expect(fact).toHaveText(/Mesure 2 sur 10/, { timeout: 120_000 });
    await expect.poll(async () => Number(await stage.getAttribute('data-trame')), { timeout: 60_000 }).toBeGreaterThan(0);

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(stage).toHaveAttribute('data-trame', '0');
    await expect.poll(() => drawsOverTwoSeconds(page), { message: 'aucun dessin après l’abandon', timeout: 60_000 }).toBe(0);

    dialog = await openPanel(page);
    await expect(dialog.locator('[data-fact="comparer"]')).toHaveAttribute('data-etat', 'interrompue');
    await expect(dialog.locator('[data-fact="comparer"]')).toHaveText(/Comparaison interrompue\s: panneau fermé/);
    // Aucune variante n'a fini ses deux passages : aucune ligne, plutôt qu'un aller seul.
    await expect(dialog.locator('[data-fact^="comparer-"]')).toHaveCount(0);
    await expect(dialog.locator('[data-fact="qualite"]')).toHaveText(qualityBefore);
    await expect(dialog.getByRole('button', { name: 'Comparer' })).toBeEnabled();
  });

  test('au texte « grand », la rangée de boutons ne bouge pas pendant la comparaison', async ({ page }) => {
    test.setTimeout(180_000);
    await openApp(page);
    await waitForBench(page);
    await page.getByRole('button', { name: 'Réglages' }).click();
    const settings = page.getByRole('dialog', { name: 'Réglages' });
    await settings.getByRole('button', { name: 'Texte' }).click();
    await settings.getByRole('button', { name: /^Grand/ }).click();
    await expect(page.locator('html')).toHaveAttribute('data-text', 'grand');
    await settings.getByRole('button', { name: 'Retour à l’atelier' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const dialog = await openPanel(page);
    const row = () =>
      dialog.locator('.sheet-acts > .btn').evaluateAll((buttons) =>
        buttons.map((button) => {
          const { x, y, width, height } = button.getBoundingClientRect();
          return [x, y, width, height].map((value) => Math.round(value));
        }),
      );
    const before = await row();
    expect(before).toHaveLength(3);
    await dialog.getByRole('button', { name: 'Comparer' }).click();
    const fact = dialog.locator('[data-fact="comparer"]');
    await expect(fact).toHaveAttribute('data-etat', 'en-cours');
    await expect(dialog.getByRole('button', { name: /^\d+ sur \d+…$/ })).toBeVisible();
    expect(await row(), 'pendant la comparaison').toEqual(before);
    await expect(fact).toHaveText(/Mesure 2 sur \d+/, { timeout: 120_000 });
    expect(await row(), 'à la deuxième fenêtre').toEqual(before);
    await capture(page, 'capot-comparer-grand-pendant');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await openPanel(page);
    expect(await row(), 'après l’abandon').toEqual(before);
  });
});
