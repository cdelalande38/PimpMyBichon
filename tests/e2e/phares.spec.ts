// Custom › Phares (vague T) : couleur de l'éclairage, teinte des optiques, feux arrière. Au garage :
// l'entrée s'ouvre, l'origine est libre, une option verrouillée montre son cadenas et son prix, s'achète
// sur place avec un solde posé dans la sauvegarde, se pose, et tient après un rechargement ; solde
// insuffisant expliqué ; « D'origine ». En sortie de nuit, au sec : la scène dit la couleur réellement
// posée sur les optiques (data-phares-optique) plutôt qu'un pixel.
// Captures de revue dans captures/vague-t-phares/ (hors dépôt versionné).
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreApercu, auSec, choisirCamera, ENTREE_SORTIE, openApp, openEntry, pickMap, readBuilds, reloadSaved, rentrerAuGarage, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_PHARES ?? resolve('captures', 'vague-t-phares');

async function photo(page: Page, nom: string): Promise<void> {
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

const dock = (page: Page) => page.locator('footer.dock');
const garage = (page: Page) => page.locator('.stage');
const sortie = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

/** Écrit une valeur dans la base de l'app (clé `cle`), au format des stores persistés. */
async function ecrire(page: Page, cle: string, etat: unknown): Promise<void> {
  await page.evaluate(
    ({ cle, etat }) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: etat, version: 1 }), cle);
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    { cle, etat },
  );
}

/** Toute commande visible du panneau offre 48 px au doigt. */
async function commandesA48(page: Page): Promise<void> {
  const boutons = dock(page).locator('[data-testid="phares"] button:visible, [data-testid="phares"] input:visible');
  const nombre = await boutons.count();
  expect(nombre).toBeGreaterThan(0);
  for (let i = 0; i < nombre; i += 1) {
    const boite = await boutons.nth(i).boundingBox();
    expect(boite).not.toBeNull();
    expect(Math.min(boite?.width ?? 0, boite?.height ?? 0), `commande ${i}`).toBeGreaterThanOrEqual(47.5);
  }
}

/** Azimut de l'orbite du garage (degrés, data-orbite), une fois posé. */
async function azimut(page: Page): Promise<number> {
  let dernier = '';
  let valeur = Number.NaN;
  await expect
    .poll(
      async () => {
        const brut = (await garage(page).getAttribute('data-orbite')) ?? '';
        const pose = brut !== '' && brut === dernier;
        dernier = brut;
        valeur = Number(brut.split(',')[0]);
        return pose;
      },
      { message: 'orbite posée', timeout: 30_000, intervals: [400] },
    )
    .toBe(true);
  return valeur;
}

const ecart = (a: number, b: number) => ((a - b + 540) % 360) - 180;

/** Glissé horizontal au doigt dans la scène (la caméra tourne autour du véhicule). */
async function glisser(page: Page, dx: number): Promise<void> {
  const depart = { x: 195, y: 330 };
  await page.mouse.move(depart.x, depart.y);
  await page.mouse.down();
  for (let pas = 1; pas <= 10; pas += 1) await page.mouse.move(depart.x + (dx * pas) / 10, depart.y);
  await page.mouse.up();
}

/**
 * Tourne la vue au doigt jusqu'à voir l'avant (la caméra elle-même n'est pas touchée) : l'avant du
 * véhicule est vers -x de la pièce quand il est présenté nez à gauche, vers +x sinon (src/scene/fit.ts).
 */
async function deFace(page: Page, vehicule: string): Promise<void> {
  const manifeste = JSON.parse(readFileSync(resolve('public', 'assets', 'vehicles', vehicule, 'vehicle.json'), 'utf8')) as { presentSide?: string };
  const cible = manifeste.presentSide === 'droite' ? 90 : -90;
  const avant = await azimut(page);
  await glisser(page, 80);
  let apres = await azimut(page);
  const parPixel = ecart(apres, avant) / 80;
  if (Math.abs(parPixel) < 0.01) return;
  for (let essai = 0; essai < 4 && Math.abs(ecart(cible, apres)) > 8; essai += 1) {
    await glisser(page, Math.max(-320, Math.min(320, ecart(cible, apres) / parPixel)));
    apres = await azimut(page);
  }
}

test.describe('phares', () => {
  test('au garage : l’origine libre, une couleur achetée sur place, les feux fumés, gardés au rechargement', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    // 400 $ : de quoi acheter le violet (160 $), les optiques fumées (140 $) et les feux fumés (100 $),
    // pas le rose ensuite. « Premier achat » déjà obtenu : sa récompense ne brouille pas le solde.
    await ecrire(page, 'pmb-jeu', { solde: 400, articles: {}, hautsFaits: { 'premiere-course': true, 'premier-achat': true }, cumuls: { courses: 4, achats: 1 } });
    await reloadSaved(page);
    await waitForBench(page);
    const vehicule = await garage(page).getAttribute('data-vehicle');
    expect(vehicule).toBeTruthy();

    await openEntry(page, 'Phares');
    const panneau = dock(page).getByTestId('phares');
    await expect(panneau).toBeVisible();
    await expect(panneau.getByRole('button', { name: 'Lumière', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const couleurs = panneau.getByRole('group', { name: 'Couleur de l’éclairage' });
    await expect(couleurs.locator('[data-phares="chaud"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(couleurs.locator('[data-phares="chaud"]')).not.toHaveAttribute('data-verrou', 'ferme');
    await expect(garage(page)).toHaveAttribute('data-phares', 'chaud');
    await expect(panneau.getByRole('button', { name: 'D’origine' })).toBeDisabled();
    await commandesA48(page);
    await photo(page, '01-garage-phares-origine');

    // Une couleur verrouillée : cadenas et prix ; un appui ouvre l'achat, « Acheter » la pose.
    const violet = couleurs.locator('[data-phares="violet"]');
    await expect(violet).toHaveAttribute('data-verrou', 'ferme');
    await expect(violet).toHaveAccessibleName('Violet, à débloquer pour 160 $');
    await expect(violet.locator('svg[data-cadenas="ferme"]')).toHaveCount(1);
    await violet.tap();
    const achat = panneau.getByRole('group', { name: 'Acheter Phares violets' });
    await expect(achat).toContainText('160 $');
    await commandesA48(page);
    await photo(page, '02-garage-achat-violet');
    await achat.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau.getByRole('status')).toHaveText('Phares violets débloqués : c’est posé.');
    await expect(violet).toHaveAttribute('aria-pressed', 'true');
    await expect(violet).not.toHaveAttribute('data-verrou', 'ferme');
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet');
    await expect(garage(page)).toHaveAttribute('data-phares-optique', '#a35cff');

    // Optiques : le curseur est verrouillé tant que la teinte fumée n'est pas achetée.
    await panneau.getByRole('button', { name: 'Optiques', exact: true }).tap();
    const curseur = panneau.getByTestId('phares-teinte');
    await expect(curseur).toBeDisabled();
    const fumees = panneau.locator('[data-teinte="fumee"]');
    await expect(fumees).toHaveAttribute('data-verrou', 'ferme');
    await fumees.tap();
    await panneau.getByRole('group', { name: 'Acheter Optiques fumées' }).getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(curseur).toBeEnabled();
    await expect(fumees).toHaveAttribute('aria-pressed', 'true');
    await expect(garage(page)).toHaveAttribute('data-phares-teinte', '70');
    await curseur.fill('50');
    await expect(garage(page)).toHaveAttribute('data-phares-teinte', '50');

    // Feux arrière fumés.
    await panneau.getByRole('button', { name: 'Feux', exact: true }).tap();
    const feux = panneau.locator('[data-feux="fumes"]');
    await feux.tap();
    await panneau.getByRole('group', { name: 'Acheter Feux arrière fumés' }).getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(feux).toHaveAttribute('aria-pressed', 'true');
    await expect(garage(page)).toHaveAttribute('data-feux', 'fumes');

    // Plus assez de dollars pour le rose : expliqué, rien n'est posé.
    await panneau.getByRole('button', { name: 'Lumière', exact: true }).tap();
    await couleurs.locator('[data-phares="rose"]').tap();
    await expect(panneau.getByRole('alert')).toContainText('Il te manque 160 $');
    await panneau.getByRole('alert').getByRole('button', { name: 'Compris' }).tap();
    await expect(panneau.getByRole('alert')).toHaveCount(0);
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet');
    await waitForBench(page);
    await photo(page, '03-garage-violet-fume');

    // Rechargement : ce qui est posé et ce qui est acheté tiennent.
    await reloadSaved(page);
    await waitForBench(page);
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet');
    await expect(garage(page)).toHaveAttribute('data-feux', 'fumes');
    await expect(garage(page)).toHaveAttribute('data-phares-teinte', '50');
    const saved = (await readBuilds(page)) as unknown as { builds: Record<string, { parts?: Record<string, string>; tune?: Record<string, number> }> } | null;
    expect(saved?.builds[vehicule ?? '']?.parts).toMatchObject({ phares: 'violet', feux: 'fumes' });
    expect(saved?.builds[vehicule ?? '']?.tune?.phares_teinte).toBeCloseTo(0.5, 6);

    // « D'origine » : tout revient, l'origine n'est pas écrite ; le violet reste acquis.
    await openEntry(page, 'Phares');
    await expect(panneau.locator('[data-phares="violet"]')).not.toHaveAttribute('data-verrou', 'ferme');
    await panneau.getByRole('button', { name: 'D’origine' }).tap();
    await expect(garage(page)).toHaveAttribute('data-phares', 'chaud');
    await expect(garage(page)).toHaveAttribute('data-feux', 'rouges');
    await expect(garage(page)).toHaveAttribute('data-phares-teinte', '0');
    await expect.poll(async () => ((await readBuilds(page)) as unknown as { builds: Record<string, { parts?: Record<string, string> }> } | null)?.builds[vehicule ?? '']?.parts?.phares).toBeUndefined();
    await panneau.locator('[data-phares="violet"]').tap();
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet');
  });

  test('en sortie de nuit, au sec : la couleur choisie dans les optiques, le faisceau et sur la route', async ({ page }) => {
    test.setTimeout(480_000);
    await openApp(page);
    await waitForScene(page);
    const vehicule = await garage(page).getAttribute('data-vehicle');
    expect(vehicule).toBeTruthy();
    // Couleur, teinte et feux posés dans la sauvegarde des builds (l'interface est vérifiée plus haut).
    await ecrire(page, 'pmb-builds', {
      current: vehicule,
      builds: { [vehicule ?? '']: { paints: {}, parts: { phares: 'violet', feux: 'fumes' }, tune: { phares_teinte: 0.3 } } },
      recents: [],
    });
    await reloadSaved(page);
    await waitForScene(page);
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet', { timeout: 120_000 });

    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await auSec(page);
    await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
    await expect(sortie(page)).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
    await expect(sortie(page)).toHaveAttribute('data-moment', 'nuit');
    await expect(sortie(page)).toHaveAttribute('data-meteo', 'sec');
    await expect(sortie(page)).toHaveAttribute('data-phares', 'violet');
    await expect(sortie(page)).toHaveAttribute('data-phares-optique', '#a35cff');
    await expect(sortie(page)).toHaveAttribute('data-phares-teinte', '30');
    await expect(sortie(page)).toHaveAttribute('data-feux', 'fumes');

    await attendreApercu(page);
    await choisirCamera(page, 'Poursuite');
    await expect(sortie(page)).toHaveAttribute('data-camera', 'poursuite');
    await page.waitForTimeout(3_000);
    await photo(page, '04-sortie-violet-poursuite');
    await choisirCamera(page, 'Avant');
    await expect(sortie(page)).toHaveAttribute('data-camera', 'avant');
    await page.waitForTimeout(3_000);
    await photo(page, '05-sortie-violet-avant');
    await rentrerAuGarage(page);
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet', { timeout: 120_000 });
  });
  test('au garage, de face : deux véhicules, puis texte très grand et paysage', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    const premier = (await garage(page).getAttribute('data-vehicle')) ?? '';
    // Deux véhicules du catalogue, une couleur franche chacun (posée dans la sauvegarde des builds).
    const second = premier === 'cox' ? 'van' : 'cox';
    await ecrire(page, 'pmb-builds', {
      current: premier,
      builds: {
        [premier]: { paints: {}, parts: { phares: 'violet' }, tune: { phares_teinte: 0.3 } },
        [second]: { paints: {}, parts: { phares: 'glacier' } },
      },
      recents: [],
    });
    await reloadSaved(page);
    await waitForBench(page);
    await expect(garage(page)).toHaveAttribute('data-phares', 'violet');
    await openEntry(page, 'Phares');
    await deFace(page, premier);
    await waitForStill(page);
    await photo(page, '06-garage-face-violet');

    await openEntry(page, 'Véhicule');
    await dock(page).locator(`[data-vehicle="${second}"]`).tap();
    await expect(garage(page)).toHaveAttribute('data-vehicle', second);
    await waitForBench(page);
    await expect(garage(page)).toHaveAttribute('data-phares', 'glacier');
    await expect(garage(page)).toHaveAttribute('data-phares-optique', '#8ccbff');
    await openEntry(page, 'Phares');
    await deFace(page, second);
    await waitForStill(page);
    await photo(page, '07-garage-face-glacier');

    // Texte très grand : 48 px au doigt, la tête du panneau ne déborde pas.
    await page.evaluate(() => {
      document.documentElement.dataset.text = 'tres-grand';
    });
    const panneau = dock(page).getByTestId('phares');
    await expect(panneau).toBeVisible();
    await commandesA48(page);
    expect(await panneau.locator('.phares-head').evaluate((element) => element.scrollWidth > element.clientWidth + 1), 'tête du panneau').toBe(false);
    await panneau.getByRole('button', { name: 'Optiques', exact: true }).tap();
    await commandesA48(page);
    await photo(page, '08-garage-phares-tres-grand');

    // Paysage, texte grand.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.evaluate(() => {
      document.documentElement.dataset.text = 'grand';
    });
    await expect(panneau).toBeVisible();
    await commandesA48(page);
    await photo(page, '09-garage-phares-paysage');
  });
});
