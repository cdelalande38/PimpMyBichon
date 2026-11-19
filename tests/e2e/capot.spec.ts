// Capot moteur (vague U, demande du 18 novembre 2026) : voir son moteur personnalisé dans le véhicule.
// Au garage, la pastille de la scène ouvre le capot de la Cox (la caméra cadre le compartiment, le
// moteur de l'établi y est posé avec le traitement du build), puis le referme. Le capot vitré et le
// capot déposé s'achètent dans Custom · Carrosserie (poste « Capot moteur »), se voient au garage et en
// sortie, et sont gardés au rechargement. Un véhicule sans capot déclaré (le van) n'a ni pastille ni
// poste. Les captures de revue (portrait et paysage, garage, sortie de jour et de nuit) ne tournent
// qu'à la demande : PMB_CAPTURES_CAPOT=<dossier>.
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { attendreSurLaRoute, auSec, choisirCamera, ENTREE_SORTIE, openApp, openEntry, pickMap, readBuilds, reloadSaved, tempsDeRoute, waitForBench, waitForScene, waitForStill } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_CAPOT;

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Écrit dans IndexedDB la sauvegarde du jeu et celle des builds, puis relance l'app qui les relit. */
async function poserSauvegarde(page: Page, saves: { jeu?: Record<string, unknown>; builds?: Record<string, unknown> }): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          const store = transaction.objectStore('kv');
          if (value.jeu) store.put(JSON.stringify({ state: value.jeu, version: 1 }), 'pmb-jeu');
          if (value.builds) store.put(JSON.stringify({ state: value.builds, version: 1 }), 'pmb-builds');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    saves,
  );
  await reloadSaved(page);
  await waitForScene(page);
}

const scene = (page: Page) => page.locator('.stage');
const panneau = (page: Page) => page.locator('footer.dock [data-testid="pieces"]');
const poste = (page: Page, id: string) => page.locator(`footer.dock [data-testid="pieces-groupe"] .pieces-poste[data-poste="${id}"]`);
const option = (page: Page, id: string) => panneau(page).locator(`[data-option="${id}"]`);

/** La Cox, cache-culbuteurs chromés à l'établi ; `parts` : ce qui est posé en plus. */
function buildsCox(parts: Record<string, string> = {}) {
  return {
    current: 'cox',
    builds: { cox: { paints: {}, parts, partPaints: { moteur_cache_culbuteurs: { finish: 'chrome' }, moteur_toles: { finish: 'brillant', color: '#c81d25' } } } },
    recents: [],
  };
}

/** Tourne la caméra du garage vers l'arrière du véhicule (glissé sur la scène), puis attend l'image posée. */
async function vueArriere(page: Page): Promise<void> {
  const { width, height } = page.viewportSize() ?? { width: 390, height: 844 };
  const y = height * 0.3;
  // En paysage, le menu occupe la droite de l'écran : le glissé part du milieu de la scène.
  const x0 = width > height ? width * 0.5 : width * 0.85;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  // L'orbite tourne d'un tour pour un glissé de la hauteur de la scène : le même angle en portrait et en paysage.
  for (let step = 1; step <= 14; step += 1) await page.mouse.move(x0 - step * (height * 0.0232), y - step * 3);
  await page.mouse.up();
  await waitForStill(page);
}

/** Appuie sur la pastille du capot (au clavier : un repère bref peut s'être effacé). */
async function pastille(page: Page, nom: 'Ouvrir le capot' | 'Fermer le capot'): Promise<void> {
  const bouton = page.getByRole('button', { name: nom, exact: true });
  await expect(bouton).toHaveCount(1, { timeout: 30_000 });
  const boite = await bouton.boundingBox();
  expect(boite?.width ?? 0).toBeGreaterThanOrEqual(47.5);
  expect(boite?.height ?? 0).toBeGreaterThanOrEqual(47.5);
  await bouton.focus();
  await page.keyboard.press('Enter');
}

test.describe('Capot moteur', () => {
  test('au garage : la pastille ouvre et referme le capot, le moteur traité est dedans ; vitré puis déposé, achetés, gardés au rechargement', async ({ page }) => {
    test.setTimeout(420_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, {
      jeu: { solde: 400, articles: {}, hautsFaits: { 'premier-achat': true }, cumuls: {} },
      builds: buildsCox(),
    });
    await expect(scene(page)).toHaveAttribute('data-vehicle', 'cox');
    await waitForBench(page);
    await expect(scene(page)).toHaveAttribute('data-capot', 'ferme');
    await expect(scene(page)).toHaveAttribute('data-capot-option', 'origine');
    await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'aucun');

    // De l'arrière, la pastille est sur le capot ; un appui l'ouvre, la caméra cadre le compartiment.
    await vueArriere(page);
    await photo(page, '00-garage-arriere-ferme');
    await pastille(page, 'Ouvrir le capot');
    await expect(scene(page)).toHaveAttribute('data-capot', 'ouvert');
    await expect(scene(page)).toHaveAttribute('data-cadrage', 'capot');
    await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
    await waitForStill(page);
    await photo(page, '01-garage-capot-ouvert');
    await pastille(page, 'Fermer le capot');
    await expect(scene(page)).toHaveAttribute('data-capot', 'ferme');
    await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'aucun');
    await expect(scene(page)).not.toHaveAttribute('data-cadrage', 'capot');

    // Custom · Carrosserie : le poste du capot, le vitré verrouillé, acheté, posé.
    await openEntry(page, 'Carrosserie');
    await poste(page, 'capot').tap();
    await expect(panneau(page)).toHaveAttribute('data-poste', 'capot');
    await expect(panneau(page)).toHaveAttribute('data-option', 'origine');
    await expect(scene(page)).toHaveAttribute('data-cadrage', 'piece-capot');
    await expect(option(page, 'vitre')).toHaveAttribute('data-verrou', 'ferme');
    await expect(option(page, 'vitre')).toHaveAccessibleName('Vitré, verrouillé : 240 dollars');
    await option(page, 'vitre').tap();
    const confirmation = panneau(page).locator('.jeu-achat[data-etat="confirmation"]');
    await expect(confirmation).toContainText('Acheter le capot vitré pour 240 $ ? Il te restera 160 $.');
    await confirmation.getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau(page)).toHaveAttribute('data-option', 'vitre');
    await expect(scene(page)).toHaveAttribute('data-capot-option', 'vitre');
    await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
    await waitForStill(page);
    await photo(page, '02-garage-capot-vitre');

    // Sans capot : acheté (140 $), le moteur à l'air.
    await option(page, 'sans').tap();
    await panneau(page).locator('.jeu-achat[data-etat="confirmation"]').getByRole('button', { name: 'Acheter', exact: true }).tap();
    await expect(panneau(page)).toHaveAttribute('data-option', 'sans');
    await expect(scene(page)).toHaveAttribute('data-capot-option', 'depose');
    await waitForStill(page);
    await photo(page, '03-garage-sans-capot');
    await expect.poll(async () => ((await readBuilds(page))?.builds.cox as { parts?: Record<string, string> } | undefined)?.parts?.capot).toBe('sans');

    // Rechargement : le capot déposé et les deux achats sont gardés.
    await reloadSaved(page);
    await waitForScene(page);
    await waitForBench(page);
    await expect(scene(page)).toHaveAttribute('data-capot-option', 'depose');
    await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
    await openEntry(page, 'Carrosserie');
    await poste(page, 'capot').tap();
    await expect(option(page, 'vitre')).not.toHaveAttribute('data-verrou', 'ferme');
    await option(page, 'vitre').tap();
    await expect(scene(page)).toHaveAttribute('data-capot-option', 'vitre');

    // Le van : pas de capot déclaré, ni pastille ni poste.
    await openEntry(page, 'Véhicule');
    await page.locator('footer.dock').getByRole('group', { name: 'Véhicule' }).locator('[data-vehicle="van"]').tap();
    await expect(scene(page)).toHaveAttribute('data-vehicle', 'van');
    await waitForBench(page);
    await expect(scene(page)).not.toHaveAttribute('data-capot', /.*/);
    await expect(page.getByRole('button', { name: 'Ouvrir le capot', exact: true })).toHaveCount(0);
    await openEntry(page, 'Carrosserie');
    await expect(poste(page, 'capot')).toHaveCount(0);
  });

  for (const moment of ['Jour', 'Nuit'] as const) {
    test(`en sortie de ${moment.toLowerCase()} : le capot vitré laisse voir le moteur, caméra de poursuite`, async ({ page }) => {
      test.setTimeout(480_000);
      await openApp(page);
      await waitForScene(page);
      await poserSauvegarde(page, {
        jeu: { solde: 0, articles: { 'piece-capot-vitre': true }, hautsFaits: { 'premier-achat': true }, cumuls: {} },
        builds: buildsCox({ capot: 'vitre' }),
      });
      await waitForBench(page);
      await expect(scene(page)).toHaveAttribute('data-capot-option', 'vitre');
      await openEntry(page, ENTREE_SORTIE);
      await pickMap(page);
      await auSec(page);
      await page.locator('footer.dock').getByRole('group', { name: 'Moment' }).getByRole('button', { name: moment, exact: true }).tap();
      await page.locator('footer.dock').getByRole('button', { name: 'Jouer', exact: true }).tap();
      const drive = page.locator('.drive-stage');
      await expect(drive).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
      await expect(drive).toHaveAttribute('data-capot-option', 'vitre');
      await expect(drive).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
      await choisirCamera(page, 'Poursuite');
      const depart = await tempsDeRoute(page);
      await attendreSurLaRoute(page, 'quelques secondes de route', () => tempsDeRoute(page), (t) => t > depart + 3, { secondes: 30 });
      await photo(page, `1${moment === 'Jour' ? '0' : '1'}-sortie-${moment.toLowerCase()}-capot-vitre`);
    });
  }
});

test.describe('Capot moteur : depuis l’établi', () => {
  test('« Sous le capot », dans Mécanique · Moteur, quitte l’établi et ouvre le capot sur le moteur posé', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { builds: buildsCox() });
    await expect(scene(page)).toHaveAttribute('data-vehicle', 'cox');
    await waitForBench(page);
    await openEntry(page, 'Moteur');
    const bouton = page.locator('footer.dock [data-testid="moteur-capot"]');
    await expect(bouton).toHaveText('Sous le capot');
    const boite = await bouton.boundingBox();
    expect(boite?.width ?? 0).toBeGreaterThanOrEqual(47.5);
    expect(boite?.height ?? 0).toBeGreaterThanOrEqual(47.5);
    await bouton.tap();
    // L'établi est rangé (le panneau du moteur n'est plus là), la voiture est revenue, capot ouvert.
    await expect(bouton).toHaveCount(0);
    await expect(scene(page)).toHaveAttribute('data-capot', 'ouvert');
    await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
    await expect(page.getByRole('button', { name: 'Fermer le capot', exact: true })).toHaveCount(1, { timeout: 30_000 });
    await waitForStill(page);
    await photo(page, '09-sous-le-capot-depuis-l-etabli');
  });
});

test.describe('Capot moteur : captures de revue', () => {
  test.skip(!CAPTURES, 'captures de revue : PMB_CAPTURES_CAPOT=<dossier>');

  test('au garage, aileron haut sur le capot : il s’ouvre avec lui (portrait)', async ({ page }) => {
    test.setTimeout(300_000);
    await openApp(page);
    await waitForScene(page);
    await poserSauvegarde(page, { builds: buildsCox({ aileron: 'haut' }) });
    await waitForBench(page);
    await vueArriere(page);
    await pastille(page, 'Ouvrir le capot');
    await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
    await waitForStill(page);
    await photo(page, '04-garage-aileron-capot-ouvert');
  });

  test.describe('paysage', () => {
    test.use({ viewport: { width: 844, height: 390 } });

    test('au garage : capot ouvert, vitré, déposé (paysage)', async ({ page }) => {
      test.setTimeout(420_000);
      await openApp(page);
      await waitForScene(page);
      await poserSauvegarde(page, { builds: buildsCox() });
      await waitForBench(page);
      await vueArriere(page);
      await pastille(page, 'Ouvrir le capot');
      await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
      await waitForStill(page);
      await photo(page, '20-paysage-capot-ouvert');
      await pastille(page, 'Fermer le capot');
      for (const [parts, nom] of [
        [{ capot: 'vitre' }, '21-paysage-capot-vitre'],
        [{ capot: 'sans' }, '22-paysage-sans-capot'],
      ] as const) {
        await poserSauvegarde(page, { jeu: { solde: 0, articles: { 'piece-capot-vitre': true, 'piece-capot-sans': true }, hautsFaits: {}, cumuls: {} }, builds: buildsCox(parts) });
        await waitForBench(page);
        await expect(scene(page)).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
        await vueArriere(page);
        await photo(page, nom);
      }
    });

    test('en sortie de jour, capot déposé, caméra de poursuite (paysage)', async ({ page }) => {
      test.setTimeout(480_000);
      await openApp(page);
      await waitForScene(page);
      await poserSauvegarde(page, {
        jeu: { solde: 0, articles: { 'piece-capot-sans': true }, hautsFaits: {}, cumuls: {} },
        builds: buildsCox({ capot: 'sans' }),
      });
      await waitForBench(page);
      await openEntry(page, ENTREE_SORTIE);
      await pickMap(page);
      await auSec(page);
      await page.locator('footer.dock').getByRole('group', { name: 'Moment' }).getByRole('button', { name: 'Jour', exact: true }).tap();
      await page.locator('footer.dock').getByRole('button', { name: 'Jouer', exact: true }).tap();
      const drive = page.locator('.drive-stage');
      await expect(drive).toHaveAttribute('data-sortie', 'prete', { timeout: 150_000 });
      await expect(drive).toHaveAttribute('data-moteur-pose', 'quatre-a-plat', { timeout: 60_000 });
      await choisirCamera(page, 'Poursuite');
      const depart = await tempsDeRoute(page);
      await attendreSurLaRoute(page, 'quelques secondes de route', () => tempsDeRoute(page), (t) => t > depart + 3, { secondes: 30 });
      await photo(page, '23-paysage-sortie-jour-sans-capot');
    });
  });
});
