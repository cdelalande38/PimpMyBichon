import { expect, test, type Page } from '@playwright/test';
import { capture, openApp } from './helpers.ts';

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

test.describe('fiche moteur', () => {
  test('le van passe de 102 ch à 175 ch au stage 3, et le retrouve au rechargement', async ({ page }) => {
    // Trois chargements de l'app en rendu logiciel : plus que le délai par défaut.
    test.setTimeout(150_000);
    await openApp(page);
    await putVanOnScreen(page);
    await page.goto('./#/moteur');
    await page.reload();

    const sheet = page.locator('dialog[open]');
    await expect(sheet).toBeVisible();
    const origin = sheet.getByTestId('moteur-origine');
    const gain = sheet.getByTestId('moteur-gain');
    const prepared = sheet.getByTestId('moteur-prepare');
    // 102 ch : la sauvegarde est relue, le van est bien à l'écran.
    await expect(origin).toHaveText(/^102\s*ch$/);
    await expect(gain).toHaveText(/^\+\s*0\s*ch$/);
    await expect(sheet.getByText('4 cylindres turbo diesel')).toBeVisible();
    await expect(sheet.getByText(/pas un passage au banc/)).toBeVisible();
    // Moteur à injection : reprogrammation et nitro, pas de carburation.
    await expect(sheet.getByRole('heading', { name: 'Reprogrammation' })).toBeVisible();
    await expect(sheet.getByRole('heading', { name: 'Carburation' })).toHaveCount(0);

    const stage3 = sheet.getByRole('button', { name: /^Stage 3/ });
    await stage3.click();
    await expect(stage3).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByText('Reprogrammé', { exact: true })).toBeVisible();
    await expect(gain).toHaveText(/^\+\s*73\s*ch$/);
    await expect(prepared).toHaveText(/^175\s*ch$/);

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
    await expect(page.locator('dialog[open]').getByTestId('moteur-prepare')).toHaveText(/^175\s*ch$/);
    await expect(page.locator('dialog[open]').getByRole('button', { name: /^Stage 3/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await page.locator('dialog[open]').getByRole('button', { name: 'Tout remettre d’origine' }).click();
    await expect(page.locator('dialog[open]').getByTestId('moteur-prepare')).toHaveText(/^102\s*ch$/);
  });
});
