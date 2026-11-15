import { expect, test, type Page } from '@playwright/test';
import { capture, openApp, openEntry } from './helpers.ts';

// Met le van à l'écran par la sauvegarde des builds (même base que l'app : idb-keyval), sans
// dépendre de l'écran du catalogue.
async function putVanOnScreen(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(
            JSON.stringify({ state: { current: 'van', builds: {}, recents: [] }, version: 1 }),
            'pmb-builds',
          );
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

/** Hauteur touchable d'un élément amené au centre de sa zone (elementFromPoint, pixel par pixel). */
async function touchable(page: Page, selector: string): Promise<number[]> {
  return page.evaluate(async (selector) => {
    const out: number[] = [];
    for (const element of document.querySelectorAll<HTMLElement>(selector)) {
      element.scrollIntoView({ block: 'center' });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const box = element.getBoundingClientRect();
      let hits = 0;
      for (let y = Math.floor(box.top); y < box.bottom; y += 1) {
        const hit = document.elementFromPoint(box.left + box.width / 2, y);
        if (hit && element.contains(hit)) hits += 1;
      }
      out.push(hits);
    }
    return out;
  }, selector);
}

test.describe('fiche moteur', () => {
  test('dans le dock compact, le van passe de 102 ch à 175 ch au stage 3, et le retrouve au rechargement', async ({ page }) => {
    // Trois chargements de l'app en rendu logiciel : plus que le délai par défaut.
    test.setTimeout(150_000);
    await openApp(page);
    await putVanOnScreen(page);
    await page.reload();
    await openEntry(page, 'Préparation');

    // La fiche vit dans Mécanique · Préparation, seule sous la ligne de repère du dock compact.
    const dock = page.locator('footer.dock');
    await expect(dock).toHaveAttribute('data-taille', 'compact');
    const sheet = dock.locator('.dock-tab[data-onglet="preparation"]');
    const origin = sheet.getByTestId('moteur-origine');
    const gain = sheet.getByTestId('moteur-gain');
    const prepared = sheet.getByTestId('moteur-prepare');
    // 102 ch : la sauvegarde est relue, le van est bien à l'écran.
    await expect(origin).toHaveText(/^102\s*ch$/);
    await expect(gain).toHaveText(/^\+\s*0\s*ch$/);
    await expect(sheet.getByText('4 cylindres turbo diesel')).toBeVisible();
    // Moteur à injection : reprogrammation et nitro, pas de carburation.
    await expect(sheet.getByRole('heading', { name: 'Reprogrammation' })).toBeAttached();
    await expect(sheet.getByRole('heading', { name: 'Carburation' })).toHaveCount(0);
    // Le dock compact reste dans le tiers bas.
    const top = await dock.evaluate((footer) => footer.getBoundingClientRect().top);
    expect(top, 'dock compact dans le tiers bas').toBeGreaterThanOrEqual((844 * 2) / 3);

    // Chaque option se touche sur 44 px au moins : les chiffres collés en haut ne la recouvrent pas.
    const heights = await touchable(page, 'footer.dock .dock-tab[data-onglet="preparation"] .engine-chips button');
    expect(heights.length).toBeGreaterThanOrEqual(8);
    for (const height of heights) expect(height, 'option touchable').toBeGreaterThanOrEqual(44);

    const stage3 = sheet.getByRole('button', { name: /^Stage 3/ });
    await stage3.tap();
    await expect(stage3).toHaveAttribute('aria-pressed', 'true');
    // Les chiffres, collés en haut de la fiche, suivent aussitôt.
    await expect(sheet.getByText('Reprogrammé', { exact: true })).toBeVisible();
    await expect(gain).toHaveText(/^\+\s*73\s*ch$/);
    await expect(prepared).toHaveText(/^175\s*ch$/);
    await expect(prepared).toBeInViewport();

    // Cibles de pouce : chaque puce et le bouton de retour font au moins 48 px.
    const buttons = sheet.locator('.engine button');
    const count = await buttons.count();
    expect(count).toBeGreaterThanOrEqual(9);
    for (let i = 0; i < count; i += 1) {
      const box = await buttons.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    }
    await capture(page, 'moteur-van-prepare');

    // L'écriture dans IndexedDB est asynchrone : on lui laisse le temps de se poser.
    await page.waitForTimeout(500);
    await page.reload();
    await openEntry(page, 'Préparation');
    await expect(sheet.getByTestId('moteur-prepare')).toHaveText(/^175\s*ch$/);
    await expect(sheet.getByRole('button', { name: /^Stage 3/ })).toHaveAttribute('aria-pressed', 'true');

    const reset = sheet.getByRole('button', { name: 'Tout remettre d’origine' });
    await reset.tap();
    await expect(sheet.getByTestId('moteur-prepare')).toHaveText(/^102\s*ch$/);
    await expect(sheet.getByText(/pas un passage au banc/)).toBeVisible();
  });
});
