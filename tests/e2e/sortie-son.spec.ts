import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { openApp, openEntry, pickMap, reloadSaved } from './helpers.ts';

// Son du moteur en sortie de nuit (§ 5.5, § 9) : au départ le moteur démarre et tourne, le régime
// publié monte avec la vitesse et passe des rapports, le bouton « Moteur » coupe et remet (choix
// gardé d'une sortie à l'autre), la pause et le retour au garage coupent ; ouverte sans geste, la
// sortie reste muette jusqu'au premier appui. L'état se lit dans data-moteur, data-regime et
// data-rapport du bouton (src/ui/drive/DriveScreen.tsx) ; on vérifie l'état du lecteur et les
// requêtes, pas le son entendu.

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const bar = (page: Page) => page.getByRole('contentinfo', { name: 'Commandes de la sortie' });
const engine = (page: Page) => bar(page).getByRole('button', { name: /^Son du moteur/ });
const numberAttr = async (page: Page, name: string) => Number(await engine(page).getAttribute(name));

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

/** Erreurs de la page (console et exceptions), pour finir sans aucune. */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/** Requêtes de sons de moteur (chemin sous assets/audio/engines/). */
function watchSounds(page: Page): string[] {
  const sounds: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.includes('/assets/audio/engines/')) sounds.push(url.pathname.split('/assets/audio/engines/')[1] ?? '');
  });
  return sounds;
}

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-n-sonsortie', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

async function goOut(page: Page): Promise<void> {
  await openEntry(page, 'Sortie de nuit');
  await pickMap(page);
  await page.locator('footer.dock').getByRole('button', { name: 'Sortir', exact: true }).tap();
  await expect(page).toHaveURL(/#\/sortie$/);
  await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 90_000 });
}

test.describe('son du moteur en sortie', () => {
  test('démarre au départ, suit la vitesse, se coupe et se remet ; pause et garage coupent', async ({ page }) => {
    test.setTimeout(420_000);
    const errors = watchErrors(page);
    const sounds = watchSounds(page);
    await openApp(page);
    await putOnScreen(page, 'sportive');
    await reloadSaved(page);
    await expect(page.getByRole('heading', { level: 1, name: 'PimpMyBichon' })).toBeVisible();
    expect(sounds).toEqual([]);

    await goOut(page);
    // Le bouton est dans la barre du bas, au pouce, et assez grand pour le doigt.
    const button = engine(page);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    const box = await button.boundingBox();
    expect(box && Math.min(box.width, box.height)).toBeGreaterThanOrEqual(48);
    expect(box && box.y).toBeGreaterThan(844 / 2);

    // Départ : le démarreur, puis le moteur tourne ; les sons de la famille du véhicule sont demandés.
    await expect(button).toHaveAttribute('data-moteur', /demarre|tourne/, { timeout: 30_000 });
    await expect(button).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    expect(sounds.some((path) => path.startsWith('quatre-en-ligne-moto/'))).toBe(true);
    expect(sounds.every((path) => path.startsWith('quatre-en-ligne-moto/'))).toBe(true);

    // Le régime publié suit la vitesse : il monte avec elle et des rapports passent.
    const samples: { kmh: number; regime: number; rapport: number }[] = [];
    await expect
      .poll(
        async () => {
          samples.push({
            kmh: Number(await stage(page).getAttribute('data-vitesse')),
            regime: await numberAttr(page, 'data-regime'),
            rapport: await numberAttr(page, 'data-rapport'),
          });
          return Math.max(...samples.map((sample) => sample.rapport));
        },
        // La deuxième passe vers 4 s de route ; en rendu logiciel la scène avance d'un dixième de seconde par image.
        { timeout: 150_000, intervals: [250] },
      )
      .toBeGreaterThanOrEqual(2);
    const slow = samples.filter((sample) => sample.kmh < 8);
    const fast = samples.filter((sample) => sample.kmh >= 8);
    expect(fast.length).toBeGreaterThan(0);
    expect(Math.max(...samples.map((sample) => sample.regime))).toBeGreaterThan(Math.min(...samples.map((sample) => sample.regime)) + 500);
    if (slow.length > 0) expect(Math.min(...slow.map((sample) => sample.regime))).toBeLessThan(Math.max(...fast.map((sample) => sample.regime)));
    await shot(page, 'sortie-moteur-tourne');

    // Le bouton coupe, puis remet (sans démarreur : le véhicule roule déjà).
    await button.tap();
    await expect(button).toHaveAttribute('data-moteur', 'muet');
    await expect(button).toHaveAttribute('aria-pressed', 'false');
    await expect(button).toHaveAttribute('data-regime', '0');
    await shot(page, 'sortie-moteur-coupe');
    await button.tap();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });

    // Pause : coupé ; reprise : il tourne de nouveau.
    const top = page.locator('.drive-top');
    await top.getByRole('button', { name: 'Pause' }).tap();
    await expect(button).toHaveAttribute('data-moteur', 'coupe');
    await top.getByRole('button', { name: 'Reprendre' }).tap();
    await expect(button).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });

    // Ralenti d'image maintenu : le moteur tourne toujours (le volume baisse, pas la hauteur).
    const ralenti = bar(page).getByRole('button', { name: 'Ralenti' });
    const slowBox = await ralenti.boundingBox();
    if (!slowBox) throw new Error('bouton Ralenti introuvable');
    await page.mouse.move(slowBox.x + slowBox.width / 2, slowBox.y + slowBox.height / 2);
    const plein = await numberAttr(page, 'data-niveau');
    expect(plein).toBeGreaterThan(0);
    await page.mouse.down();
    await expect(ralenti).toHaveAttribute('aria-pressed', 'true');
    await expect(button).toHaveAttribute('data-moteur', 'tourne');
    await expect.poll(() => numberAttr(page, 'data-niveau')).toBeLessThan(plein);
    await page.mouse.up();
    await expect.poll(() => numberAttr(page, 'data-niveau')).toBe(plein);

    // Coupé à la main, puis retour au garage : le moteur est coupé au garage.
    await button.tap();
    await expect(button).toHaveAttribute('data-moteur', 'muet');
    await bar(page).getByRole('button', { name: 'Rentrer au garage' }).tap();
    await expect(stage(page)).toHaveCount(0);
    await openEntry(page, 'Préparation');
    await expect(page.locator('footer.dock .engine-sound')).toHaveAttribute('data-moteur', 'coupe');

    // Le choix est gardé d'une sortie à l'autre : on repart moteur coupé, on le remet.
    await goOut(page);
    await expect(engine(page)).toHaveAttribute('data-moteur', 'muet');
    await expect(engine(page)).toHaveAttribute('aria-pressed', 'false');
    await engine(page).tap();
    await expect(engine(page)).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    await bar(page).getByRole('button', { name: 'Rentrer au garage' }).tap();
    await expect(stage(page)).toHaveCount(0);
    await openEntry(page, 'Préparation');
    await expect(page.locator('footer.dock .engine-sound')).toHaveAttribute('data-moteur', 'coupe');

    expect(errors).toEqual([]);
  });

  test('ouverte sans geste, la sortie reste muette jusqu’au premier appui', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchErrors(page);
    const sounds = watchSounds(page);
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 90_000 });
    await expect(engine(page)).toHaveAttribute('data-moteur', 'attente');
    // Rien n'est demandé ni joué avant le geste.
    await page.waitForTimeout(1000);
    await expect(engine(page)).toHaveAttribute('data-moteur', 'attente');
    expect(sounds).toEqual([]);

    // Premier appui sur la route : le moteur démarre.
    await page.locator('.drive-mid').tap({ position: { x: 100, y: 120 } });
    await expect(engine(page)).toHaveAttribute('data-moteur', /demarre|tourne/, { timeout: 30_000 });
    await expect(engine(page)).toHaveAttribute('data-moteur', 'tourne', { timeout: 30_000 });
    expect(sounds.length).toBeGreaterThan(0);
    await shot(page, 'sortie-ouverte-directe');
    expect(errors).toEqual([]);
  });
});
