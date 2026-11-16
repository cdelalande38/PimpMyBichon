// Sortie de nuit, pilotage au doigt (§ 5.5 ; retours du commanditaire du 16 novembre 2026) : écran de
// chargement qui nomme la carte et s'efface quand la route est prête ; mode de conduite toujours
// lisible ; à la main, la barre s'abaisse, les deux pédales se voient, l'accélérateur fait monter la
// vitesse et le compte-tours (zones, passages), le frein la fait baisser, le NOS part ; la languette
// rappelle la barre ; la radio se déploie sans quitter la route. Appuis tactiles seulement (aucune
// souris) : de vrais événements tactiles, par le protocole du navigateur.
// Captures : captures/vague-n-conduite2/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Commandes de la sortie' });
const dial = (page: Page) => page.locator('.drive-dial');
const mode = (page: Page) => page.getByRole('switch', { name: 'Conduite à la main' });
const kmh = async (page: Page) => Number(await stage(page).getAttribute('data-vitesse'));

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-n-conduite2', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Met un véhicule à l'écran par la sauvegarde des builds (idb-keyval). */
async function putOnScreen(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (id) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { current: id, builds: {}, recents: [] }, version: 1 }), 'pmb-builds');
          tx.oncomplete = () => {
            open.result.close();
            done();
          };
          tx.onerror = () => fail(tx.error);
        };
      }),
    id,
  );
}

/** Doigt posé (et maintenu) en (x, y), puis levé. */
async function press(cdp: CDPSession, x: number, y: number, id = 1): Promise<() => Promise<void>> {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id }] });
  return async () => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
}

test.describe('sortie de nuit, pilotage au doigt', () => {
  test.setTimeout(600_000);

  test('chargement, mode lisible, pédales, compte-tours, NOS, languette, radio', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./');
    await putOnScreen(page, 'concept');

    // Chargement : plein écran, la carte nommée, « Rentrer au garage » atteignable ; parti une fois la route prête.
    await page.goto('./#/sortie');
    const loading = page.locator('.drive-chargement');
    await expect(loading).toBeVisible({ timeout: 30_000 });
    await expect(loading.locator('.tuto-marque b')).not.toBeEmpty();
    await expect(loading.getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await shot(page, '01-chargement');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(loading).toHaveCount(0, { timeout: 10_000 });

    // Pilote automatique : le mode se lit, la barre est levée.
    await expect(mode(page)).toHaveAttribute('aria-checked', 'false');
    await expect(mode(page)).toContainText('Pilote auto');
    await expect(bar(page)).toHaveAttribute('data-replie', 'false');
    await expect(bar(page).getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await expect(dial(page)).toBeVisible();
    await shot(page, '02-auto');

    // Un appui bref sur la route, en pilote automatique : on propose de reprendre la main.
    const mid = page.locator('.drive-mid');
    await mid.tap({ position: { x: 195, y: 200 } });
    await expect(page.getByText('Reprendre la main ?')).toBeVisible();

    // À la main, au doigt : le mode change à l'écran, la barre s'abaisse, les deux pédales se voient.
    await mode(page).tap();
    await expect(mode(page)).toHaveAttribute('aria-checked', 'true');
    await expect(mode(page)).toContainText('À la main');
    await expect(bar(page)).toHaveAttribute('data-replie', 'true');
    await expect(bar(page).getByRole('button', { name: 'Rentrer au garage' })).toBeHidden();
    await expect(page.locator('.drive-pedal[data-pedale="frein"]')).toBeVisible();
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toBeVisible();
    await expect(page.getByRole('button', { name: 'NOS' })).toBeVisible();
    await page.waitForTimeout(1500);
    await shot(page, '03-main-arret');

    // Accélérateur (doigt maintenu à droite) : la vitesse monte, le compte-tours passe au vert, à l'orange, passe un rapport.
    const box = await mid.boundingBox();
    if (!box) throw new Error('zone des gestes introuvable');
    const cdp = await page.context().newCDPSession(page);
    const before = await kmh(page);
    let lift = await press(cdp, box.x + box.width * 0.8, box.y + box.height * 0.5);
    await expect(page.locator('.drive-pedal[data-pedale="gaz"]')).toHaveAttribute('data-appui', 'true');
    await expect(mode(page)).toContainText('À la main');
    await expect(dial(page)).toHaveAttribute('data-zone', /vert|orange|rouge/, { timeout: 60_000 });
    await shot(page, '04-vert');
    await expect(dial(page)).toHaveAttribute('data-zone', 'orange', { timeout: 120_000 });
    await shot(page, '05-orange');
    // Un passage de rapport : le rapport affiché monte, l'aiguille retombe (le passage lui-même dure
    // moins d'un dixième de seconde sur la voiture de course : on guette le rapport qui change).
    const gear = Number(await dial(page).getAttribute('data-rapport'));
    await expect.poll(async () => Number(await dial(page).getAttribute('data-rapport')), { timeout: 120_000, intervals: [100] }).toBeGreaterThan(gear);
    await shot(page, '06-passage');
    await expect.poll(() => kmh(page), { timeout: 120_000 }).toBeGreaterThan(before + 30);
    await expect(Number(await dial(page).getAttribute('data-rapport'))).toBeGreaterThanOrEqual(2);

    // NOS : la poussée part (le compte-tours le dit), la réserve se vide.
    await page.getByRole('button', { name: 'NOS' }).tap();
    await expect(page.getByRole('button', { name: 'NOS' })).toHaveAttribute('data-nos', 'envoye', { timeout: 30_000 });
    await expect(dial(page)).toHaveAttribute('data-nos', 'true');
    await shot(page, '07-nos');
    await expect.poll(async () => Number(await page.getByRole('button', { name: 'NOS' }).getAttribute('data-reserve')), { timeout: 60_000 }).toBeLessThan(100);
    await lift();

    // Frein (doigt maintenu à gauche) : la vitesse baisse ; le mode reste juste.
    const fast = await kmh(page);
    lift = await press(cdp, box.x + box.width * 0.2, box.y + box.height * 0.5);
    await expect(page.locator('.drive-pedal[data-pedale="frein"]')).toHaveAttribute('data-appui', 'true');
    await expect.poll(() => kmh(page), { timeout: 120_000 }).toBeLessThan(fast - 15);
    await expect(mode(page)).toContainText('À la main');
    await lift();

    // La languette rappelle la barre (et « Rentrer au garage ») ; elle la replie.
    await page.getByRole('button', { name: 'Afficher les commandes' }).tap();
    await expect(bar(page)).toHaveAttribute('data-replie', 'false');
    await expect(bar(page).getByRole('button', { name: 'Rentrer au garage' })).toBeVisible();
    await shot(page, '08-barre-rappelee');
    await page.getByRole('button', { name: 'Replier les commandes' }).tap();
    await expect(bar(page)).toHaveAttribute('data-replie', 'true');

    // La radio : le mini-lecteur se déploie sans quitter la route ni mettre en pause.
    await page.locator('.drive-top').getByRole('button', { name: /^Radio/ }).tap();
    await expect(page.locator('#radio-mini')).toBeVisible();
    await expect(page).toHaveURL(/#\/sortie$/);
    await expect(page.locator('.drive-top').getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
    await shot(page, '09-radio');
    const aide = await page.locator('.tuto-aide').boundingBox();
    const mini = await page.locator('#radio-mini').boundingBox();
    if (aide && mini) expect(mini.y).toBeGreaterThanOrEqual(aide.y + aide.height);

    // Retour au pilote automatique : la barre remonte d'elle-même.
    await mode(page).tap();
    await expect(mode(page)).toContainText('Pilote auto');
    await expect(bar(page)).toHaveAttribute('data-replie', 'false');

    // Petit téléphone, à la main : rien ne se recouvre.
    await page.setViewportSize({ width: 360, height: 780 });
    await mode(page).tap();
    await page.waitForTimeout(1500);
    await shot(page, '10-main-360');
    const boxes = await page.evaluate(() =>
      ['.tuto-aide', '.drive-dial', '.drive-where', '.drive-top .quick-btn', '.drive-round', '.drive-mode', '.drive-tab', '.drive-nos', '.drive-pedal[data-pedale="frein"]', '.drive-pedal[data-pedale="gaz"]'].map((sel) => {
        const r = document.querySelector(sel)?.getBoundingClientRect();
        return r ? { sel, x: r.x, y: r.y, w: r.width, h: r.height } : { sel, x: 0, y: 0, w: 0, h: 0 };
      }),
    );
    for (const a of boxes) {
      expect(a.w, a.sel).toBeGreaterThan(0);
      expect(a.x + a.w, a.sel).toBeLessThanOrEqual(360.5);
      for (const b of boxes) {
        if (a === b) continue;
        const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1;
        expect(overlap, `${a.sel} / ${b.sel}`).toBe(false);
      }
    }
    expect(errors).toEqual([]);
  });
});
