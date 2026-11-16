import { expect, test, type Page } from '@playwright/test';
import { capture, openApp, openEntry, reloadSaved } from './helpers.ts';

// Son du moteur au garage (§ 9) : démarrer, ralenti, coup de gaz, couper ; changer de véhicule
// coupe le moteur. L'état se lit dans data-moteur des commandes (Mécanique · Préparation).

/** Met un véhicule à l'écran par la sauvegarde des builds (idb-keyval), sans passer par le catalogue. */
async function putOnScreen(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (id) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { current: id, builds: {}, recents: [] }, version: 1 }), 'pmb-builds');
          tx.oncomplete = () => {
            open.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    id,
  );
}

const controls = (page: Page) => page.locator('footer.dock .engine-sound');

async function dockBox(page: Page) {
  return page.locator('footer.dock').evaluate((footer) => {
    const box = footer.getBoundingClientRect();
    return { top: Math.round(box.top), height: Math.round(box.height) };
  });
}

test.describe('son du moteur', () => {
  test('démarrer, ralenti, coup de gaz maintenu, couper ; changer de véhicule coupe le moteur', async ({ page }) => {
    test.setTimeout(180_000);
    const sounds: string[] = [];
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.includes('/assets/audio/engines/')) sounds.push((url.pathname + url.search).split('/assets/audio/engines/')[1] ?? '');
    });
    await openApp(page);
    await putOnScreen(page, 'sportive');
    await reloadSaved(page);
    await openEntry(page, 'Préparation');

    const panel = controls(page);
    await expect(panel).toHaveAttribute('data-sons', 'oui');
    await expect(panel).toHaveAttribute('data-moteur', 'coupe');
    // Rien n'est demandé avant le premier démarrage.
    expect(sounds).toEqual([]);
    const start = panel.getByRole('button', { name: 'Démarrer' });
    const throttle = panel.getByRole('button', { name: 'Coup de gaz' });
    const stop = panel.getByRole('button', { name: 'Couper' });
    await expect(throttle).toBeDisabled();
    await expect(stop).toBeDisabled();

    // Trois commandes de 48 px au moins, dans le dock compact, au tiers bas.
    for (const button of [start, throttle, stop]) {
      const box = await button.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
      expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
    }
    await expect(page.locator('footer.dock')).toHaveAttribute('data-taille', 'compact');
    const before = await dockBox(page);
    expect(before.top).toBeGreaterThanOrEqual((844 * 2) / 3);

    await start.tap();
    await expect(panel).toHaveAttribute('data-moteur', /demarrage|ralenti/);
    await expect(panel).toHaveAttribute('data-moteur', 'ralenti', { timeout: 30_000 });
    await expect(panel.getByRole('status')).toHaveText(/Moteur ralenti/);
    // Le manifeste et les sons de la famille de la sportive, à la demande, et rien d'autre.
    expect(sounds).toContain('quatre-en-ligne-moto/engine.json');
    expect(sounds.some((path) => path.startsWith('quatre-en-ligne-moto/idle.ogg?v='))).toBe(true);
    expect(sounds.every((path) => path.startsWith('quatre-en-ligne-moto/'))).toBe(true);
    await capture(page, 'sons-ralenti');

    // Coup de gaz : en charge tant qu'on appuie, retour au ralenti quand on lâche.
    const box = await throttle.boundingBox();
    if (!box) throw new Error('bouton introuvable');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(panel).toHaveAttribute('data-moteur', 'charge');
    await page.waitForTimeout(800);
    await expect(panel).toHaveAttribute('data-moteur', 'charge');
    await capture(page, 'sons-en-charge');
    await page.mouse.up();
    await expect(panel).toHaveAttribute('data-moteur', 'ralenti', { timeout: 10_000 });

    // Le menu n'a pas bougé d'un pixel pendant tout ça.
    expect(await dockBox(page)).toEqual(before);

    await stop.tap();
    await expect(panel).toHaveAttribute('data-moteur', /coupure|coupe/);
    await expect(panel).toHaveAttribute('data-moteur', 'coupe', { timeout: 20_000 });
    await expect(start).toBeEnabled();

    // Redémarrer, puis changer de véhicule : le moteur se coupe aussitôt.
    await start.tap();
    await expect(panel).toHaveAttribute('data-moteur', 'ralenti', { timeout: 30_000 });
    await openEntry(page, 'Véhicule');
    const chip = page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="van"]');
    await chip.tap();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await openEntry(page, 'Préparation');
    await expect(controls(page)).toHaveAttribute('data-moteur', 'coupe');
    await expect(controls(page).getByRole('button', { name: 'Démarrer' })).toBeEnabled();
  });

  test('page en arrière-plan : le moteur se coupe', async ({ page }) => {
    test.setTimeout(120_000);
    await openApp(page);
    await putOnScreen(page, 'cox');
    await reloadSaved(page);
    await openEntry(page, 'Préparation');
    const panel = controls(page);
    await panel.getByRole('button', { name: 'Démarrer' }).tap();
    await expect(panel).toHaveAttribute('data-moteur', 'ralenti', { timeout: 30_000 });
    // Coup de gaz enregistré (la Cox n'a qu'une boucle de ralenti) : en charge le temps de la prise.
    await panel.getByRole('button', { name: 'Coup de gaz' }).dispatchEvent('pointerdown', { pointerId: 1 });
    await expect(panel).toHaveAttribute('data-moteur', 'charge');
    await panel.getByRole('button', { name: 'Coup de gaz' }).dispatchEvent('pointerup', { pointerId: 1 });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await expect(panel).toHaveAttribute('data-moteur', 'coupe');
  });

  test('Chrome décode chaque boucle à sa longueur exacte : pas de trou ni de décalage au bouclage', async ({ page }) => {
    await openApp(page);
    const report = await page.evaluate(async () => {
      const base = new URL('./assets/audio/engines/', document.baseURI);
      const families = ['quatre-a-plat', 'diesel-turbo', 'bicylindre-v', 'quatre-en-ligne-moto', 'v8'];
      const ctx = new OfflineAudioContext(1, 1, 48000);
      const out: { file: string; decoded: number; expected: number; first: number }[] = [];
      for (const family of families) {
        const manifest = (await (await fetch(new URL(`${family}/engine.json`, base))).json()) as { boucles: { fichier: string; duree: number; empreinte: string }[] };
        for (const loop of manifest.boucles) {
          const bytes = await (await fetch(new URL(`${family}/${loop.fichier}?v=${loop.empreinte}`, base))).arrayBuffer();
          const buffer = await ctx.decodeAudioData(bytes);
          // Premier échantillon : non nul si le pré-roulement d'Opus a bien été retiré (boucle prise en plein son).
          const data = new Float32Array(64);
          buffer.copyFromChannel(data, 0);
          out.push({ file: `${family}/${loop.fichier}`, decoded: buffer.length, expected: Math.round(loop.duree * 48000), first: Math.max(...data.map(Math.abs)) });
        }
      }
      return out;
    });
    expect(report.length).toBeGreaterThanOrEqual(5);
    for (const item of report) {
      expect(Math.abs(item.decoded - item.expected), item.file).toBeLessThanOrEqual(1);
      expect(item.first, `${item.file} : la boucle commence en plein son`).toBeGreaterThan(1e-4);
    }
  });
});
