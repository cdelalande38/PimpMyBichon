import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import sharp from 'sharp';
import { capture, openApp, openAtelier, quick, VIEWPORT, waitForBench, waitForScene } from './helpers.ts';

// Jalon 1, étape C2 : mode photo (§ 5.1, § 8 « Rendu photo ») et mesure de cadence de
// « Sous le capot ». Captures : captures/jalon-1/photo-avant.png et photo-profil.png.

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

/** Toutes les commandes visibles (boutons et liens) : sous le pouce et d'au moins 48 px. */
async function expectThumbControls(page: Page): Promise<number> {
  const controls = page.locator('.app button:visible, .app a.btn:visible');
  const count = await controls.count();
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    const label = ((await control.getAttribute('aria-label')) ?? (await control.innerText())).trim();
    const box = await control.boundingBox();
    expect(box, `« ${label} » mesurable`).not.toBeNull();
    if (!box) continue;
    expect(box.height, `hauteur de « ${label} »`).toBeGreaterThanOrEqual(48);
    expect(box.width, `largeur de « ${label} »`).toBeGreaterThanOrEqual(48);
    expect(box.y, `« ${label} » dans le tiers bas`).toBeGreaterThanOrEqual((VIEWPORT.height * 2) / 3);
    expect(box.x, `« ${label} » dans l’écran`).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width, `« ${label} » dans l’écran`).toBeLessThanOrEqual(VIEWPORT.width);
  }
  return count;
}

const status = (page: Page) => page.locator('.photo-bar .photo-status');

async function waitSharp(page: Page): Promise<void> {
  await expect(status(page)).toHaveAttribute('data-refine', 'net', { timeout: 90_000 });
}

async function setQuality(page: Page, label: string): Promise<void> {
  await openAtelier(page, 'Réglages');
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await expect(dialog).toBeVisible();
  const button = dialog.getByRole('group', { name: 'Qualité' }).getByRole('button', { name: new RegExp(`^${label}`) });
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(dialog).toBeHidden();
}

test.describe('mode photo', () => {
  test.setTimeout(600_000);

  test('cadrages sous le pouce, image qui s’affine puis se tait, image enregistrée en 2160 px', async ({ page }) => {
    await page.addInitScript({ content: COUNT_DRAWS });
    await openApp(page);
    await waitForScene(page);
    await waitForBench(page);

    // L'interface s'efface : restent les 5 cadrages, « Enregistrer » et « Retour ».
    await page.getByRole('button', { name: 'Photo', exact: true }).click();
    await expect(page).toHaveURL(/#\/photo$/);
    const bar = page.getByRole('contentinfo', { name: 'Mode photo' });
    await expect(bar).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeHidden();
    await expect(quick(page)).toHaveCount(0);
    const framings = bar.getByRole('group', { name: 'Cadrages' }).getByRole('button');
    await expect(framings).toHaveCount(5);
    await expect(bar.getByRole('button', { name: 'Enregistrer' })).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Retour' })).toBeVisible();
    expect(await expectThumbControls(page)).toBe(7);

    // Deux cadrages : l'image s'affine, puis plus aucun dessin au repos.
    for (const [name, file] of [
      ['Trois-quarts avant', 'photo-avant'],
      ['Profil', 'photo-profil'],
    ] as const) {
      const button = bar.getByRole('button', { name, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await waitSharp(page);
      await expect(status(page)).toHaveText(/Image nette/);
      await expect.poll(() => drawsOverTwoSeconds(page), { message: 'aucun dessin une fois l’image nette', timeout: 30_000 }).toBe(0);
      await capture(page, file);
    }
    test.info().annotations.push({ type: 'qualite', description: (await page.locator('.stage').getAttribute('data-quality')) ?? '' });

    // « Retour » rend l'atelier.
    await bar.getByRole('button', { name: 'Retour' }).click();
    await expect(page).not.toHaveURL(/#\/photo$/);
    await expect(quick(page).getByRole('button', { name: 'Atelier', exact: true })).toBeVisible();

    // Image enregistrée, en économie (une image par tuile : le rendu logiciel est lent).
    await setQuality(page, 'Économie');
    await page.getByRole('button', { name: 'Photo', exact: true }).click();
    await waitSharp(page);
    await bar.getByRole('button', { name: 'Enregistrer' }).click();
    const ready = bar.locator('[data-photo-size]');
    await expect(ready).toBeVisible({ timeout: 240_000 });
    await expect(ready).toHaveAttribute('data-photo-size', `2160x${Math.round((VIEWPORT.height * 2160) / VIEWPORT.width)}`);
    await expectThumbControls(page);
    const link = ready.getByRole('link', { name: 'Télécharger' });
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toMatch(/^pimpmybichon-.+\.jpg$/);
    const path = await download.path();
    const meta = await sharp(readFileSync(path)).metadata();
    expect(meta.format).toBe('jpeg');
    expect(meta.width).toBe(2160);
    const { channels } = await sharp(readFileSync(path)).stats();
    expect(channels.slice(0, 3).some((channel) => channel.stdev > 6), 'image exportée non vide').toBe(true);
    // Après l'enregistrement, l'image se refait à l'écran puis se tait.
    await waitSharp(page);
    await expect.poll(() => drawsOverTwoSeconds(page), { message: 'aucun dessin après l’export', timeout: 30_000 }).toBe(0);
  });

  test('« Mesurer » dans « Sous le capot » : cadence moyenne, pire centile, coût par image', async ({ page }) => {
    await openApp(page);
    await waitForScene(page);
    await openAtelier(page, 'Sous le capot');
    const dialog = page.getByRole('dialog', { name: 'Sous le capot' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-fact="qualite"]')).toHaveText(/Auto, niveau standard/);
    const measure = dialog.getByRole('button', { name: 'Mesurer' });
    const box = await measure.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
    expect(box?.y ?? 0).toBeGreaterThanOrEqual((VIEWPORT.height * 2) / 3);
    await measure.click();
    const fact = dialog.locator('[data-fact="mesure"]');
    await expect(fact).toHaveText(/Mesure en cours/);
    await expect(fact).toHaveText(
      // Espaces fines et insécables de la typographie française : \s les couvre.
      /Standard\s:\s[\d,]+\si\/s en moyenne, [\d,]+\si\/s au pire centile\s·\s[\d\s]+\sappels de dessin\s·\s[\d\s]+\striangles par image\s\(\d+\simages\)/,
      { timeout: 60_000 },
    );
    test.info().annotations.push({ type: 'mesure', description: await fact.innerText() });
  });
});
