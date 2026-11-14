import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, type Page } from '@playwright/test';
import sharp from 'sharp';

/** Gabarit de référence (§ 19) : toute capture se fait dans ce format. */
export const VIEWPORT = { width: 390, height: 844 } as const;

/** Bande de l'écran où seule la scène 3D est visible (ni HUD, ni dock). */
const SCENE_BAND = {
  x: 0,
  y: Math.round(VIEWPORT.height * 0.22),
  width: VIEWPORT.width,
  height: Math.round(VIEWPORT.height * 0.33),
} as const;

/** Ouvre l'app sur un hash donné (vide : le garage). */
export async function openApp(page: Page, hash = ''): Promise<void> {
  await page.goto(`./${hash}`);
  await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
}

export async function sceneBand(page: Page): Promise<Buffer> {
  return page.screenshot({ clip: SCENE_BAND });
}

/** Une scène rendue a du relief : un canvas vide ou uni a un écart-type quasi nul. */
async function sceneLooksRendered(page: Page): Promise<boolean> {
  const { channels } = await sharp(await sceneBand(page)).stats();
  return channels.slice(0, 3).some((channel) => channel.stdev > 6);
}

export async function waitForScene(page: Page): Promise<void> {
  await expect(page.locator('.stage canvas')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => sceneLooksRendered(page), { timeout: 30_000 }).toBe(true);
}

/** Le modèle de banc d'essai est chargé et posé dans la scène (lent en rendu logiciel). */
export async function waitForBench(page: Page): Promise<void> {
  await expect(page.locator('.stage[data-bench="pret"]')).toBeAttached({ timeout: 120_000 });
  await waitForStill(page);
}

/** Attend que l'image ne bouge plus : chargement de textures et rendus à la demande terminés. */
export async function waitForStill(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        const before = await sceneBand(page);
        await page.waitForTimeout(700);
        return changedRatio(before, await sceneBand(page));
      },
      { message: 'scène immobile', timeout: 90_000, intervals: [300] },
    )
    .toBeLessThan(0.0005);
}

/** Le précache est terminé : l'indicateur du HUD passe à « prêt ». */
export async function waitOfflineReady(page: Page): Promise<void> {
  await expect(page.locator('.pill[data-state="pret"]')).toBeVisible({ timeout: 45_000 });
}

/** Capture d'écran de revue, rangée dans captures/jalon-1/ (hors dépôt). */
export async function capture(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'jalon-1', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Part des pixels qui diffèrent nettement entre deux captures de même taille (0 à 1). */
export async function changedRatio(a: Buffer, b: Buffer): Promise<number> {
  const [rawA, rawB] = await Promise.all(
    [a, b].map((png) => sharp(png).removeAlpha().raw().toBuffer()),
  );
  if (!rawA || !rawB || rawA.length !== rawB.length) return 1;
  let changed = 0;
  for (let i = 0; i < rawA.length; i += 3) {
    const delta =
      Math.abs((rawA[i] ?? 0) - (rawB[i] ?? 0)) +
      Math.abs((rawA[i + 1] ?? 0) - (rawB[i + 1] ?? 0)) +
      Math.abs((rawA[i + 2] ?? 0) - (rawB[i + 2] ?? 0));
    if (delta > 24) changed += 1;
  }
  return changed / (rawA.length / 3);
}
