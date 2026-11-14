import { expect, test, type Page } from '@playwright/test';
import { capture, openApp, VIEWPORT, waitForBench, waitForScene, waitForStill } from './helpers.ts';

// Coupe caméra (src/scene/garage/cut.ts) : en tournant autour du véhicule, le décor qui
// passerait devant lui quitte l'image. Le nombre d'éléments retirés est lu sur la scène
// (attribut data-coupe) ; au repos, plus aucun dessin. Captures : captures/jalon-1/coupe-*.png.

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

/** Glissé horizontal au milieu de la scène : la hauteur de l'écran fait un tour complet. */
async function turn(page: Page, fraction: number): Promise<void> {
  const x = VIEWPORT.width / 2;
  const y = 380;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - VIEWPORT.height * fraction, y, { steps: 8 });
  await page.mouse.up();
}

const cut = async (page: Page) => Number(await page.locator('.stage').getAttribute('data-coupe'));

/** Erreurs de la console qui trahiraient un nuanceur cassé. */
function watchShaderErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /shader|program|webgl|three/i.test(message.text())) errors.push(message.text());
  });
  return errors;
}

test.describe('coupe caméra', () => {
  test.setTimeout(900_000);

  test('tourner autour : la coupe suit le côté, l’image se pose, le repos ne dessine rien', async ({ page }) => {
    await page.addInitScript({ content: COUNT_DRAWS });
    const errors = watchShaderErrors(page);
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    await expect(page.locator('.stage')).toHaveAttribute('data-coupe', /^\d+$/);
    await capture(page, 'coupe-depart');

    // Un tour en six glissés : le nombre d'éléments retirés change selon le côté.
    const seen = [await cut(page)];
    for (let i = 0; i < 6; i += 1) {
      await turn(page, 1 / 6);
      await waitForStill(page);
      seen.push(await cut(page));
      if (i === 2) await capture(page, 'coupe-demi-tour');
    }
    test.info().annotations.push({ type: 'coupe', description: seen.join(' ') });
    expect(new Set(seen).size, `éléments retirés au fil du tour : ${seen.join(' ')}`).toBeGreaterThan(1);
    expect(seen.every((value) => value > 0), 'de chaque côté, un mur meublé passe devant').toBe(true);

    // L'image est redevenue immobile ; au repos, rien n'est dessiné.
    await expect.poll(() => drawsOverTwoSeconds(page), { message: 'aucun dessin au repos', timeout: 60_000, intervals: [250] }).toBe(0);

    // « Sous le capot » le dit.
    await page.goto('./#/capot');
    await expect(page.locator('[data-fact="coupe"]')).toHaveText(/(élément|éléments) du décor sur \d+ retirés? de l’image|Rien ne passe/);
    test.info().annotations.push({ type: 'sous-le-capot', description: await page.locator('[data-fact="coupe"]').innerText() });
    expect(errors).toEqual([]);
  });

  test('avec le fondu (mouvement non réduit, rotation coupée) : il se termine, puis la scène se tait', async ({ page }) => {
    await page.addInitScript({ content: COUNT_DRAWS });
    const errors = watchShaderErrors(page);
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);
    // Rotation lente coupée : sinon la scène tournerait sans fin une fois le mouvement permis.
    await page.getByRole('button', { name: 'Réglages' }).click();
    const dialog = page.getByRole('dialog', { name: 'Réglages' });
    await dialog.getByRole('navigation', { name: 'Réglages' }).getByRole('button', { name: 'Rotation' }).click();
    const off = dialog.getByRole('button', { name: /^Coupée/ });
    await off.click();
    await expect(off).toHaveAttribute('aria-pressed', 'true');
    await page.goBack();
    await expect(dialog).toBeHidden();
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    const before = await cut(page);
    await turn(page, 1 / 2);
    await expect.poll(() => cut(page), { message: 'la coupe change de l’autre côté', timeout: 60_000 }).not.toBe(before);
    await waitForStill(page);
    await expect.poll(() => drawsOverTwoSeconds(page), { message: 'fondu terminé, aucun dessin', timeout: 90_000, intervals: [250] }).toBe(0);
    await capture(page, 'coupe-autre-cote');
    expect(errors).toEqual([]);
  });
});
