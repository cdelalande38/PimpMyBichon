import { expect, test, type Page } from '@playwright/test';
import { openApp, openAtelier, openEntry, type SavedBuilds } from './helpers.ts';

// L'app ouverte deux fois (deux onglets, ou un vieil onglet à côté de l'app installée) : ce que
// l'une enregistre survit à n'importe quel geste de l'autre, et l'autre finit par le voir
// (src/state/persistence.ts). Le dernier qui écrit une même valeur gagne ; personne n'efface ce
// qu'il n'a pas touché ; au repos, plus rien ne s'écrit, ni d'un onglet à l'autre.

declare global {
  interface Window {
    __pmbPuts?: number;
  }
}

/** Compte les écritures dans le magasin de l'app (IndexedDB « pimpmybichon », table « kv »). */
const COUNT_PUTS = `(() => {
  const put = IDBObjectStore.prototype.put;
  window.__pmbPuts = 0;
  IDBObjectStore.prototype.put = function (...args) {
    if (this.name === 'kv') window.__pmbPuts += 1;
    return put.apply(this, args);
  };
})();`;

const dock = (page: Page) => page.locator('footer.dock');

/** État sauvegardé sous une clé (`null` : rien de sauvegardé). */
async function readKey<T>(page: Page, key: string): Promise<T | null> {
  return page.evaluate(
    (name) =>
      new Promise<T | null>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const read = open.result.transaction('kv', 'readonly').objectStore('kv').get(name);
          read.onsuccess = () => {
            const raw = read.result as string | undefined;
            done(raw ? (JSON.parse(raw) as { state: T }).state : null);
          };
          read.onerror = () => fail(read.error);
        };
      }),
    key,
  );
}

/**
 * Un vieil onglet (code d'avant, sourd au canal entre onglets) écrit dans la sauvegarde des builds
 * sans prévenir personne : une peinture sur un véhicule de plus et une couleur en tête des dernières.
 */
async function writeLikeAnOldTab(page: Page, vehicle: string, color: string): Promise<void> {
  await page.evaluate(
    ({ vehicle, color }) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          const kv = transaction.objectStore('kv');
          const read = kv.get('pmb-builds');
          read.onsuccess = () => {
            const saved = JSON.parse(read.result as string) as { state: { builds: Record<string, unknown>; recents: string[] } };
            saved.state.builds[vehicle] = { paints: { caisse: { color } } };
            saved.state.recents = [color, ...saved.state.recents];
            kv.put(JSON.stringify(saved), 'pmb-builds');
          };
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    { vehicle, color },
  );
}

/** Ouvre une rubrique des réglages ; avec `choice`, y pose ce choix. Referme le panneau. */
async function setting(page: Page, tab: string, choice: string, expectPressed = false): Promise<void> {
  await openAtelier(page, 'Réglages');
  const dialog = page.getByRole('dialog', { name: 'Réglages' });
  await dialog.getByRole('navigation', { name: 'Réglages' }).getByRole('button', { name: tab, exact: true }).click();
  const button = dialog.getByRole('group', { name: tab }).getByRole('button', { name: new RegExp(`^${choice}`) });
  if (!expectPressed) await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await page.goBack();
  await expect(dialog).toBeHidden();
}

/** Couleurs de la première zone de peinture (la carrosserie) du véhicule à l'écran. */
async function openColors(page: Page): Promise<void> {
  await openEntry(page, 'Peinture');
  await dock(page).getByRole('group', { name: 'Zones' }).getByRole('button').first().tap();
  await expect(dock(page).getByRole('group', { name: 'Couleurs' })).toBeVisible();
}

test('deux onglets : ce que l’un enregistre survit aux gestes de l’autre, qui finit par le voir', async ({ page: a, context }) => {
  test.setTimeout(240_000);
  await context.addInitScript({ content: COUNT_PUTS });
  await openApp(a);
  const b = await context.newPage();
  await openApp(b);
  // Les deux pages ont relu la sauvegarde avant que l'une ou l'autre ne touche à rien.
  await expect(dock(a)).toHaveAttribute('data-taille', 'compact');
  await expect(dock(b)).toHaveAttribute('data-taille', 'compact');
  await b.waitForTimeout(500);

  // A : une couleur sur la zone ouverte (elle entre dans les dernières couleurs), la rotation coupée.
  await a.bringToFront();
  await openColors(a);
  const chip = dock(a).getByRole('group', { name: 'Couleurs' }).getByRole('button').nth(3);
  const chipName = (await chip.getAttribute('aria-label')) ?? '';
  await chip.tap();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readKey<SavedBuilds>(a, 'pmb-builds'))?.recents.length ?? 0).toBeGreaterThan(0);
  const painted = (await readKey<SavedBuilds>(a, 'pmb-builds')) as SavedBuilds;
  const paintedVehicle = Object.keys(painted.builds)[0];
  expect(paintedVehicle, 'une peinture enregistrée').toBeTruthy();
  await setting(a, 'Rotation', 'Coupée');
  await expect.poll(async () => (await readKey<{ autoRotate: boolean }>(a, 'pmb-reglages'))?.autoRotate).toBe(false);

  // Un vieil onglet écrit à son tour, sans rien annoncer.
  await writeLikeAnOldTab(a, 'vieil-onglet', '#123456');
  const builds = { ...painted.builds, 'vieil-onglet': { paints: { caisse: { color: '#123456' } } } };
  const recents = ['#123456', ...painted.recents];

  // B, ouvert avant tout ça : un autre véhicule, le texte agrandi, le menu agrandi.
  await b.bringToFront();
  const vehicles = dock(b).getByRole('group', { name: 'Véhicule' });
  const otherVehicle = await vehicles.locator(`[aria-pressed="false"]:not([data-vehicle="${paintedVehicle}"])`).first().getAttribute('data-vehicle');
  const other = vehicles.locator(`[data-vehicle="${otherVehicle}"]`);
  await other.tap();
  await expect(other).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await readKey<SavedBuilds>(b, 'pmb-builds'))?.current).toBe(otherVehicle);
  expect((await readKey<SavedBuilds>(b, 'pmb-builds'))?.builds, 'les peintures survivent au choix d’un véhicule dans B').toEqual(builds);
  await setting(b, 'Texte', 'Grand');
  await dock(b).getByRole('button', { name: 'Agrandir le menu' }).tap();
  await expect(dock(b)).toHaveAttribute('data-taille', 'agrandi');

  // La sauvegarde garde tout : ce que A a posé et ce que B vient de faire.
  await expect.poll(async () => (await readKey<{ expanded: boolean }>(b, 'pmb-dock'))?.expanded).toBe(true);
  const saved = (await readKey<SavedBuilds>(b, 'pmb-builds')) as SavedBuilds;
  expect(saved.builds, 'peintures de A et du vieil onglet').toEqual(builds);
  expect(saved.recents, 'dernières couleurs de A et du vieil onglet').toEqual(recents);
  expect(saved.current).toBe(otherVehicle);
  expect(await readKey(b, 'pmb-reglages'), 'réglages de A et de B').toMatchObject({ autoRotate: false, textSize: 'grand' });

  // B voit ce que A a posé : la rotation coupée, la couleur dans ses dernières et sur le véhicule peint.
  await setting(b, 'Rotation', 'Coupée', true);
  await openColors(b);
  for (const hex of recents) await expect(dock(b).getByRole('button', { name: `Récente ${hex}`, exact: true })).toBeAttached();
  await openEntry(b, 'Véhicule');
  await dock(b).getByRole('group', { name: 'Véhicule' }).locator(`[data-vehicle="${paintedVehicle}"]`).tap();
  await openColors(b);
  await expect(dock(b).getByRole('group', { name: 'Couleurs' }).getByRole('button', { name: chipName, exact: true })).toHaveAttribute('aria-pressed', 'true');

  // A voit ce que B a fait : le menu agrandi, le texte grand.
  await a.bringToFront();
  await expect(dock(a)).toHaveAttribute('data-taille', 'agrandi');
  await setting(a, 'Texte', 'Grand', true);
  expect(await readKey<SavedBuilds>(a, 'pmb-builds'), 'rien d’effacé au bout du compte').toMatchObject({ builds, recents });

  // Au repos, plus rien ne s'écrit : ni écriture inutile, ni boucle d'un onglet à l'autre.
  const puts = async () => ((await a.evaluate(() => window.__pmbPuts ?? 0)) as number) + ((await b.evaluate(() => window.__pmbPuts ?? 0)) as number);
  await a.waitForTimeout(1_500);
  const settled = await puts();
  await a.waitForTimeout(3_000);
  expect(await puts(), 'aucune écriture au repos').toBe(settled);
});
