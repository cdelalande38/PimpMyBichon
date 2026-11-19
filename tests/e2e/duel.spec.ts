// Le duel (vague V ; src/drive/adversaire/, src/ui/drive/Duel.tsx) : au menu de la sortie, le format « Duel »
// à côté des courses, puis l'adversaire et la difficulté ; le départ aux feux à deux, l'adversaire à côté du joueur ; la
// position et l'écart à l'écran, l'adversaire sur la mini-carte ; à l'arrivée, le verdict (gagné), les gains
// du duel, « Revanche » en bouton principal ; contre la Comète en Difficile, perdu (on la laisse filer, puis on
// finit), de combien, et « Revanche » repart aux feux. Deux parcours courts plutôt qu'un long ; un troisième,
// sur demande seulement, photographie la grille sur une route large et sur une route étroite.
// Une course entière est trop longue en rendu logiciel : comme tests/e2e/carriere.spec.ts, le parcours sert
// lui-même la route de la première carte avec ses départs posés 160 m avant le bout (au seul test).
// Captures de revue à la demande : PMB_CAPTURES_DUEL=<dossier>. Vague W, à la demande aussi : la grille en
// quinconce (deux vans sur la route étroite), un dépassement en cours et l'adversaire qui envoie son NOS.

import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { attendreSurLaRoute, auSec, cartesDuMenu, choisirCarte, choisirDepart, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, pickMap, reglerSortie, reloadSaved, tempsDeRoute, waitForBench, waitForScene } from './helpers.ts';

const CAPTURES = process.env.PMB_CAPTURES_DUEL;
const PAYSAGE = { width: 844, height: 390 } as const;
const PORTRAIT = { width: 390, height: 844 } as const;
const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);

async function photo(page: Page, nom: string): Promise<void> {
  if (!CAPTURES) return;
  mkdirSync(CAPTURES, { recursive: true });
  await page.screenshot({ path: resolve(CAPTURES, `${nom}.png`) });
}

/** Le véhicule du joueur, posé par la sauvegarde des builds, l'app relancée. */
async function prendreVehicule(page: Page, vehicule: string): Promise<void> {
  await page.evaluate(
    (value) =>
      new Promise<void>((done, fail) => {
        const open = indexedDB.open('pimpmybichon');
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => fail(open.error);
        open.onsuccess = () => {
          const transaction = open.result.transaction('kv', 'readwrite');
          transaction.objectStore('kv').put(JSON.stringify({ state: { current: value, builds: { [value]: { paints: {} } }, recents: [value] }, version: 1 }), 'pmb-builds');
          transaction.oncomplete = () => done();
          transaction.onerror = () => fail(transaction.error);
        };
      }),
    vehicule,
  );
  await reloadSaved(page);
  await waitForScene(page);
  await waitForBench(page);
}

/** Le manche tenu vers le haut (direction assistée) ; rend de quoi le lâcher. */
async function tenirLeGaz(page: Page): Promise<() => Promise<void>> {
  const zone = page.locator('.drive-mid');
  const box = await zone.boundingBox();
  if (!box) throw new Error('zone des gestes introuvable');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6 - 70, { steps: 4 });
  return () => page.mouse.up();
}

test.describe('duel contre un adversaire piloté par le jeu', () => {
  test.use({ serviceWorkers: 'block' });

  /** « Duel » au menu de la sortie (réglages à l'écran), contre `adversaire`, en `niveau`. */
  async function choisirDuel(page: Page, adversaire: string, niveau: string): Promise<void> {
    const dock = page.locator('footer.dock');
    const puce = dock.getByRole('group', { name: 'Format' }).locator('[data-format="duel"]');
    await puce.tap();
    await expect(puce).toHaveAttribute('aria-pressed', 'true');
    await expect(dock.getByRole('group', { name: 'Format' }).locator('[aria-pressed="true"]')).toHaveCount(1);
    const choix = dock.getByRole('group', { name: 'Adversaire' }).locator(`[data-adversaire="${adversaire}"]`);
    await choix.tap();
    await expect(choix).toHaveAttribute('aria-pressed', 'true');
    const difficulte = dock.getByRole('group', { name: 'Difficulté' }).locator(`[data-niveau="${niveau}"]`);
    await difficulte.tap();
    await expect(difficulte).toHaveAttribute('aria-pressed', 'true');
  }

  /** Route servie avec les départs près du bout, menu de la sortie sur la première carte, au sec, « Duel », l'adversaire et le niveau. */
  async function menuDuel(page: Page, adversaire: string, niveau: string): Promise<void> {
    const carte = cartesDuMenu()[0];
    if (!carte) throw new Error('aucune carte');
    await page.route(`**/assets/maps/${carte.id}/route.json`, async (route) => {
      const response = await route.fetch();
      const json = (await response.json()) as { length: number; loop?: boolean; starts: { at: number }[] };
      if (!json.loop) for (const start of json.starts) start.at = json.length - 160;
      await route.fulfill({ response, json });
    });
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    await pickMap(page);
    await auSec(page);
    await choisirDuel(page, adversaire, niveau);
  }

  /** « Jouer », direction assistée, la course commencée (feux). */
  async function sortirEnDuel(page: Page): Promise<void> {
    await page.locator('footer.dock').getByRole('button', { name: 'Jouer', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await reglerSortie(page, 'Conduite assistée', 'Oui');
    await commencerCourse(page);
  }

  test('menu, départ à deux, position à l’écran, arrivée gagnée', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    // Dédé (le véhicule le plus lent) en Facile, contre le véhicule par défaut : le joueur qui file gagne.
    await menuDuel(page, 'dede', 'facile');
    const dock = page.locator('footer.dock');
    const adversaires = dock.getByRole('group', { name: 'Adversaire' });
    const niveaux = dock.getByRole('group', { name: 'Difficulté' });
    await expect(adversaires.getByRole('button')).toHaveCount(5);
    await expect(niveaux.getByRole('button')).toHaveCount(3);
    await expect(adversaires.locator('small', { hasText: 'à ta mesure' })).toHaveCount(1);
    const sortir = dock.getByRole('button', { name: 'Jouer', exact: true });
    await expect(sortir).toHaveAttribute('data-format', 'duel');
    await expect(dock.locator('#sortie-go-format')).toContainText('Duel contre Dédé Pépère, facile');
    // 48 px au doigt et rien ne déborde, en portrait puis en paysage.
    for (const taille of [PORTRAIT, PAYSAGE]) {
      await page.setViewportSize(taille);
      for (const bouton of [...(await adversaires.getByRole('button').all()), ...(await niveaux.getByRole('button').all())]) {
        const box = await bouton.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);
        expect(box?.width ?? 0).toBeGreaterThanOrEqual(48);
        expect(await bouton.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
      }
      await niveaux.scrollIntoViewIfNeeded();
      await photo(page, taille === PORTRAIT ? '01-menu-portrait' : '02-menu-paysage');
    }
    await page.setViewportSize(PORTRAIT);

    await sortirEnDuel(page);
    // Départ aux feux, à deux : l'adversaire est sur la ligne (sa position est publiée), la course n'est pas partie.
    await expect(stage(page)).toHaveAttribute('data-duel-verdict', 'non', { timeout: DELAI_ROUTE });
    await photo(page, '03-grille-portrait');
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
    const position = page.locator('.duel-position');
    await expect(position).toHaveAttribute('data-visible', 'oui', { timeout: DELAI_ROUTE });
    await expect(position.locator('b')).toHaveText(/^(1er|2e)$/);
    await expect(position.locator('span')).toHaveText(/^\d+,\d s (d’avance|de retard)$/);
    // Le joueur file (plein gaz) : il passe devant Dédé, l'écart le dit, la mini-carte montre l'adversaire.
    const lacher = await tenirLeGaz(page);
    await attendreSurLaRoute(page, 'en tête du duel', () => stage(page).getAttribute('data-duel-position'), (v) => v === '1', { secondes: 40, horloge: 240_000, intervalle: 300 });
    await expect(page.locator('.minicarte')).toHaveAttribute('data-adversaire', /^(cadre|hors)$/);
    await photo(page, '04-course-position-portrait');
    const fin = page.locator('.fin-course');
    await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 60, horloge: 300_000, intervalle: 500 });
    await lacher();
    const verdict = fin.locator('.duel-verdict');
    await expect(verdict).toHaveAttribute('data-duel', 'gagne');
    await expect(verdict).toContainText('Duel gagné');
    await expect(fin.locator('.fin-course-actes').getByRole('button').first()).toHaveText(/Revanche/);
    await expect(fin.getByRole('button', { name: /Rejouer/ })).toHaveCount(0);
    await fin.locator('.fin-course-defile').click();
    await expect(fin.locator('.fin-course-gains')).toContainText('Duel gagné contre');
    await expect(fin.locator('.fin-course-gains')).toContainText('Première victoire à ce niveau');
    await photo(page, '05-fin-gagne-portrait');
    expect(errors).toEqual([]);
  });

  test('contre la Comète en Difficile, on la laisse filer puis on finit : perdu, de combien', async ({ page }) => {
    test.setTimeout(600_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await menuDuel(page, 'comete', 'difficile');
    await sortirEnDuel(page);
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
    await attendreSurLaRoute(page, 'adversaire devant', () => stage(page).getAttribute('data-duel-position'), (v) => v === '2', { secondes: 20, horloge: 180_000, intervalle: 300 });
    await attendreSurLaRoute(page, 'adversaire bien devant', () => stage(page).getAttribute('data-duel-ecart'), (v) => Number(v) >= 15, { secondes: 30, horloge: 180_000, intervalle: 300 });
    await page.setViewportSize(PAYSAGE);
    await photo(page, '06-adversaire-devant-paysage');
    await page.setViewportSize(PORTRAIT);
    const fin = page.locator('.fin-course');
    const lacher = await tenirLeGaz(page);
    await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 90, horloge: 300_000, intervalle: 500 });
    await lacher();
    await expect(fin.locator('.duel-verdict')).toHaveAttribute('data-duel', 'perdu');
    await expect(fin.locator('.duel-verdict')).toContainText(/passe la ligne \d+,\d s avant toi/);
    await fin.locator('.fin-course-defile').click();
    await page.setViewportSize(PAYSAGE);
    await photo(page, '07-fin-perdu-paysage');
    // Revanche : retour sur la ligne, aux feux, à deux.
    await fin.locator('.fin-course-actes').getByRole('button', { name: 'Revanche' }).tap();
    await expect(fin).toHaveCount(0);
    await expect(stage(page)).toHaveAttribute('data-duel-verdict', 'non', { timeout: DELAI_ROUTE });
    expect(errors).toEqual([]);
  });

  // Sur demande (PMB_CAPTURES_DUEL) : la grille aux feux, en paysage, sur une route large (côte à côte, chacun dans
  // sa moitié) et sur une route étroite (5 m, le van à côté du véhicule par défaut : serrés).
  for (const [nom, carte, depart, adversaire] of [
    ['large', /Miami/, /41e rue/, 'momo'],
    ['etroite', /Monaco, la ville/, /Place du Casino/, 'momo'],
  ] as const) {
    test(`grille de départ sur une route ${nom}, en paysage`, async ({ page }) => {
      test.skip(!CAPTURES, 'captures de revue sur demande (PMB_CAPTURES_DUEL)');
      test.setTimeout(400_000);
      await openApp(page);
      await waitForScene(page);
      await openEntry(page, ENTREE_SORTIE);
      await choisirCarte(page, carte);
      await choisirDepart(page, depart);
      await auSec(page);
      await choisirDuel(page, adversaire, 'normal');
      await page.locator('footer.dock').getByRole('button', { name: 'Jouer', exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
      await commencerCourse(page);
      await expect(stage(page)).toHaveAttribute('data-duel-verdict', 'non', { timeout: DELAI_ROUTE });
      await page.setViewportSize(PAYSAGE);
      await page.waitForTimeout(3000);
      await photo(page, `08-grille-${nom}-paysage`);
      await page.setViewportSize(PORTRAIT);
      await page.waitForTimeout(3000);
      await photo(page, `09-grille-${nom}-portrait`);
    });
  }

  // Vague W, sur demande (PMB_CAPTURES_DUEL) : deux vans sur la route étroite (5 m) partent en quinconce.
  test('grille en quinconce : deux vans sur la route étroite, en paysage', async ({ page }) => {
    test.skip(!CAPTURES, 'captures de revue sur demande (PMB_CAPTURES_DUEL)');
    test.setTimeout(400_000);
    await openApp(page);
    await waitForScene(page);
    await prendreVehicule(page, 'van');
    await openEntry(page, ENTREE_SORTIE);
    await choisirCarte(page, /Monaco, la ville/);
    await choisirDepart(page, /Place du Casino/);
    await auSec(page);
    await choisirDuel(page, 'momo', 'normal');
    await page.locator('footer.dock').getByRole('button', { name: 'Jouer', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await commencerCourse(page);
    await expect(stage(page)).toHaveAttribute('data-duel-grille', 'quinconce', { timeout: DELAI_ROUTE });
    await page.setViewportSize(PAYSAGE);
    await page.waitForTimeout(3000);
    await photo(page, '10-quinconce-paysage');
    await page.setViewportSize(PORTRAIT);
    await page.waitForTimeout(3000);
    await photo(page, '14-quinconce-portrait');
  });

  // Vague W, sur demande : la sportive du joueur contre la Comète (la même) en Difficile sur la route large, plein
  // gaz jusqu'à 25 m d'avance, puis un filet de gaz : la Comète revient et le double (côte à côte) ; enfin, le
  // joueur la suit de près (gaz dosé) et elle envoie son NOS assez près pour qu'on voie ses flammes. Si l'un des
  // moments ne vient pas, la capture porte « -manque ».
  test('dépassement en cours et NOS de l’adversaire, en paysage', async ({ page }) => {
    test.skip(!CAPTURES, 'captures de revue sur demande (PMB_CAPTURES_DUEL)');
    test.setTimeout(900_000);
    await openApp(page);
    await waitForScene(page);
    await prendreVehicule(page, 'sportive');
    await openEntry(page, ENTREE_SORTIE);
    await choisirCarte(page, /Miami/);
    await choisirDepart(page, /Ocean Drive/);
    await auSec(page);
    await choisirDuel(page, 'comete', 'difficile');
    await page.setViewportSize(PAYSAGE);
    await sortirEnDuel(page);
    await expect(stage(page)).toHaveAttribute('data-depart', 'parti', { timeout: DELAI_ROUTE });
    const lacher = await tenirLeGaz(page);
    const lire = () => stage(page).evaluate((el) => ({ devant: Number(el.dataset.duelDevant), cote: Number(el.dataset.duelCote), nos: el.dataset.duelNos, chrono: Number(el.dataset.chrono) / 10 }));
    const moment = async (nom: string, ok: (v: Awaited<ReturnType<typeof lire>>) => boolean, secondes: number) => {
      try {
        await attendreSurLaRoute(page, nom, lire, ok, { secondes, horloge: 240_000, intervalle: 200 });
        await photo(page, nom);
      } catch {
        await photo(page, `${nom}-manque`);
      }
    };
    const zone = (await page.locator('.drive-mid').boundingBox())!;
    const gaz = (px: number) => page.mouse.move(zone.x + zone.width / 2, zone.y + zone.height * 0.6 - px, { steps: 2 });
    await attendreSurLaRoute(page, 'joueur devant', lire, (v) => v.devant <= -25, { secondes: 40, horloge: 240_000, intervalle: 200 }).catch(() => undefined);
    await gaz(22);
    // Côte à côte en course : elle le passe.
    await moment('11-depassement-paysage', (v) => Math.abs(v.devant) <= 3 && Math.abs(v.cote) >= 0.8, 40);
    // Puis le joueur la suit de 8 à 25 m (le gaz dosé) jusqu'à ce qu'elle envoie son NOS.
    const debut = await tempsDeRoute(page);
    const horloge = Date.now();
    let vu = false;
    while ((await tempsDeRoute(page)) - debut < 70 && Date.now() - horloge < 150_000) {
      const v = await lire();
      if (v.nos === 'oui' && v.devant > 0 && v.devant <= 45) {
        await photo(page, '12-adversaire-nos-paysage');
        vu = true;
        break;
      }
      await gaz(v.devant < 8 ? 15 : v.devant > 25 ? 60 : 35);
      await page.waitForTimeout(200);
    }
    if (!vu) await photo(page, '12-adversaire-nos-paysage-manque');
    await page.setViewportSize(PORTRAIT);
    await page.waitForTimeout(500);
    await photo(page, '13-course-portrait');
    await lacher();
  });
});
