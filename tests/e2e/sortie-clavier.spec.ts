// Sortie, au clavier (demande du 19 novembre 2026 : « pouvoir utiliser des touches clavier pour piloter »
// sur un ordinateur) : Entrée lance la course depuis l'aperçu, la flèche du haut met les gaz, celles des
// côtés braquent, celle du bas freine, Espace tire le NOS (src/ui/drive/clavier.ts). Et le repère du
// manche, en paysage, est en bas à gauche (même retour : « déplacer le joystick de départ en bas à gauche »).

import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, attendreSurLaRoute, DELAI_ROUTE } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const gestes = (page: Page) => page.locator('.drive-mid');
const kmh = async (page: Page) => Number(await stage(page).getAttribute('data-vitesse'));
/** Cap relatif à la route, en degrés, positif à gauche. */
const cap = async (page: Page) => Number(await gestes(page).getAttribute('data-cap'));

async function poserVehicule(page: Page, id: string): Promise<void> {
  await page.evaluate(
    (vehicule) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const tx = open.result.transaction('kv', 'readwrite');
          tx.objectStore('kv').put(JSON.stringify({ state: { current: vehicule, builds: {}, recents: [] }, version: 1 }), 'pmb-builds');
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

test.describe('sortie, pilotage au clavier', () => {
  test.setTimeout(600_000);

  test('Entrée lance la course ; flèches : gaz, virage, frein ; Espace : NOS ; en paysage le repère du manche est en bas à gauche', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('./');
    await poserVehicule(page, 'concept');
    await page.goto('./#/sortie');
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });

    // L'aperçu roule tout seul : Entrée fait comme l'appui sur la route.
    await attendreApercu(page);
    await expect(gestes(page)).toHaveAttribute('data-conduite', 'auto');
    await page.keyboard.press('Enter');
    await expect(gestes(page)).toHaveAttribute('data-conduite', 'main');
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });

    // La flèche du haut, tenue : la vitesse monte.
    await page.keyboard.down('ArrowUp');
    await attendreSurLaRoute(page, 'vitesse au clavier', () => kmh(page), (v) => v > 30, { secondes: 15 });

    // Espace : le NOS part.
    const nos = page.locator('.drive-nos').first();
    await expect(nos).toHaveAttribute('data-nos', 'pret');
    await page.keyboard.press('Space');
    await expect(nos).not.toHaveAttribute('data-nos', 'pret', { timeout: 60_000 });

    // La flèche de gauche, tenue : le cap part à gauche ; lâchée puis à droite (la lettre, cette fois) : il revient.
    const capAvant = await cap(page);
    await page.keyboard.down('ArrowLeft');
    await attendreSurLaRoute(page, 'cap à gauche', () => cap(page), (c) => c > capAvant + 3, { secondes: 8 });
    await page.keyboard.up('ArrowLeft');
    const capGauche = await cap(page);
    await page.keyboard.down('KeyD');
    await attendreSurLaRoute(page, 'cap revenu vers la droite', () => cap(page), (c) => c < capGauche - 3, { secondes: 8 });
    await page.keyboard.up('KeyD');
    await page.keyboard.up('ArrowUp');

    // La flèche du bas, tenue : on freine jusqu'à l'arrêt.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.keyboard.down('ArrowDown');
    await attendreSurLaRoute(page, 'arrêt au clavier', () => kmh(page), (v) => v <= 0, { secondes: 30 });
    await page.keyboard.up('ArrowDown');
    await expect(gestes(page)).toHaveAttribute('data-conduite', 'main');

    // À l'arrêt, en paysage : le repère « Pose ton pouce » est en bas à gauche, sous la mini-carte, sans la toucher.
    const amorce = page.locator('.drive-amorce');
    await expect(amorce).toBeVisible();
    const boite = await amorce.locator('.drive-amorce-rond').boundingBox();
    const carte = await page.locator('.drive-minicarte-place').boundingBox();
    const texte = await amorce.boundingBox();
    expect(boite).not.toBeNull();
    expect(carte).not.toBeNull();
    expect(texte).not.toBeNull();
    if (!boite || !carte || !texte) return;
    expect(boite.x + boite.width / 2, 'le rond est dans le cinquième gauche de l’écran').toBeLessThan(844 / 5);
    expect(boite.y + boite.height / 2, 'le rond est dans la moitié basse').toBeGreaterThan(390 / 2);
    expect(texte.x, 'rien ne sort à gauche').toBeGreaterThanOrEqual(0);
    expect(texte.y + texte.height, 'rien ne sort en bas').toBeLessThanOrEqual(390);
    expect(texte.y, 'sous la mini-carte').toBeGreaterThanOrEqual(carte.y + carte.height - 1);
    // Sur un téléphone, on ne parle pas du clavier.
    await expect(amorce.locator('.drive-amorce-clavier')).toBeHidden();
    if (process.env.PMB_CAPTURES_CLAVIER) await page.screenshot({ path: `${process.env.PMB_CAPTURES_CLAVIER}/paysage-amorce-bas-gauche.png` });
    expect(errors).toEqual([]);
  });
});
