import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { motifsOf, packArticle, stickerArticle } from '../../src/data/stickers.ts';
import { openApp, openEntry, readBuilds, reloadSaved, waitForBench } from './helpers.ts';

// Stickers (§ 5.3, jalon 4, premier lot) : choisir une zone, poser un motif de la bibliothèque, le
// déplacer au doigt, le colorer, recharger : il est toujours là. Un motif dont le pack n'est pas
// possédé montre son cadenas (l'économie offre encore tout : le parcours force le verrou par
// window.__pmbStickersVerrous). Captures de revue : PMB_CAPTURES (dossier), sinon captures/stickers/.

const dock = (page: Page) => page.locator('footer.dock');

interface SavedLayer {
  motif: string;
  x: number;
  y: number;
  color: string;
}

async function savedLayers(page: Page, vehicle: string, zone: string): Promise<SavedLayer[]> {
  const saved = (await readBuilds(page)) as { builds: Record<string, { stickers?: { layers: Record<string, SavedLayer[]> } }> } | null;
  return saved?.builds[vehicle]?.stickers?.layers[zone] ?? [];
}

test('stickers : poser, déplacer, colorer, recharger', async ({ page }) => {
  test.setTimeout(300_000);
  const dir = process.env.PMB_CAPTURES ?? resolve('captures', 'stickers');
  mkdirSync(dir, { recursive: true });
  // Ni le pack Flammes, ni ses motifs un par un.
  const verrous = [packArticle('flammes'), ...motifsOf('flammes').map((motif) => stickerArticle(motif.id))];
  await page.addInitScript((articles) => {
    (globalThis as { __pmbStickersVerrous?: string[] }).__pmbStickersVerrous = articles;
  }, verrous);
  await openApp(page);
  await waitForBench(page);
  const vehicle = await page.locator('.stage').getAttribute('data-vehicle');
  expect(vehicle).toBeTruthy();

  // L'entrée n'est plus « bientôt » : on choisit une zone (les flancs, en symétrie, d'abord).
  await openEntry(page, 'Stickers');
  const zones = dock(page).getByRole('group', { name: 'Zones de stickers' });
  await expect(zones).toBeVisible();
  const panel = dock(page).locator('.stickers');
  const zone = await panel.getAttribute('data-zone');
  expect(zone).toBeTruthy();
  await expect(zones.getByRole('button', { name: /Symétrie/ })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: resolve(dir, '01-zones.png') });

  // Bibliothèque : le pack Flammes, non possédé, est sous cadenas ; le toucher dit pourquoi.
  await dock(page).getByRole('button', { name: 'Ajouter un sticker' }).tap();
  const library = dock(page).locator('[data-bibliotheque]');
  await expect(library).toBeVisible();
  await library.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Flammes' }).tap();
  const locked = library.locator('.stk-tile[data-verrou="ferme"]').first();
  await expect(locked).toBeVisible();
  await locked.tap();
  await expect(dock(page).locator('.stk-notice')).toContainText('pack Flammes');
  await expect(library).toBeVisible();
  await page.screenshot({ path: resolve(dir, '02-bibliotheque-verrou.png') });

  // Pack Départ, offert : le rond n° 7 se pose au centre, choisi, avec sa poignée.
  await library.getByRole('group', { name: 'Packs de stickers' }).getByRole('button', { name: 'Départ' }).tap();
  await library.locator('[data-motif="numero-rond-7"]').tap();
  const layer = dock(page).locator('.stk-layer[data-calque="0"]');
  await expect(layer).toHaveAttribute('aria-pressed', 'true');
  await expect(dock(page).locator('[data-poignee]')).toBeVisible();
  await expect.poll(async () => (await savedLayers(page, vehicle!, zone!)).length).toBe(1);

  // Déplacé au doigt (glissé), puis coloré.
  const box = await layer.boundingBox();
  if (!box) throw new Error('sticker introuvable');
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let step = 1; step <= 6; step += 1) await page.mouse.move(start.x + step * 12, start.y - step * 2);
  await page.mouse.up();
  await expect.poll(async () => (await savedLayers(page, vehicle!, zone!))[0]?.x ?? 0).toBeGreaterThan(0.55);
  await dock(page).getByRole('group', { name: 'Couleur du sticker' }).getByRole('button', { name: 'Orange piste' }).tap();
  await expect.poll(async () => (await savedLayers(page, vehicle!, zone!))[0]?.color).toBe('#ff6a00');
  await expect(page.locator('.stage')).toHaveAttribute('data-bench', 'pret');
  await page.screenshot({ path: resolve(dir, '03-pose-flanc.png') });

  // Rechargé : le sticker est toujours là, à sa place et de sa couleur.
  const before = (await savedLayers(page, vehicle!, zone!))[0];
  await reloadSaved(page);
  await waitForBench(page);
  const after = await savedLayers(page, vehicle!, zone!);
  expect(after).toHaveLength(1);
  expect(after[0]).toMatchObject({ motif: 'numero-rond-7', color: '#ff6a00' });
  expect(after[0]?.x).toBeCloseTo(before?.x ?? 0, 5);
  await openEntry(page, 'Stickers');
  await expect(dock(page).locator('.stk-layer[data-calque="0"]')).toBeVisible();
});
