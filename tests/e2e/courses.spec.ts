// Courses de la sortie (vague S, 18 novembre 2026 ; src/data/courses.ts) :
// - le choix du format au menu (balade, 1 tour, 3 tours grisés sur une route ouverte), gardé au rechargement ;
// - la course en 3 tours sur le circuit : « Tour 1/3 » près du chrono une fois parti ;
// - l'écran de fin d'une course en 1 tour : temps, record, gains et déblocages (la première course finie
//   paie toujours sa prime et son haut fait), un seul jeu de boutons, « Rejouer » (retour aux feux) et
//   « Rentrer au garage », la mise en page en portrait et en paysage, et le solde retrouvé au garage.
// Une course entière est trop longue en rendu logiciel. Pour l'écran de fin, le parcours sert lui-même la
// route de Miami Beach (page.route) avec le départ « Vers la 41e rue » posé 120 m avant le bout : c'est la
// donnée de la carte qui change, dans le navigateur du test seulement ; l'app n'a aucune porte dérobée
// (ni lien, ni réglage, ni variable) pour sauter du chemin. Le service worker est bloqué pour que la route
// servie passe par le réseau de la page.
// Délais comptés en secondes de route (tests/e2e/helpers.ts, attendreSurLaRoute). Captures :
// captures/vague-s-courses/.

import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { DRIVE_STAGE_CLASS } from '../../src/drive/contrat.ts';
import { boutonsDeFin, finEnDeuxColonnes, finEnPortrait } from './fin-course.ts';
import { attendreSurLaRoute, auSec, backToSections, choisirCarte, choisirDepart, commencerCourse, DELAI_ROUTE, ENTREE_SORTIE, openApp, openEntry, reglerSortie, reloadSaved, rentrerAuGarage, waitForScene } from './helpers.ts';

const stage = (page: Page) => page.locator(`.${DRIVE_STAGE_CLASS}`);
const dock = (page: Page) => page.locator('footer.dock');
const formats = (page: Page) => dock(page).getByRole('group', { name: 'Format' });
const format = (page: Page, nom: string) => formats(page).getByRole('button', { name: new RegExp(`^${nom}`) });

async function shot(page: Page, name: string): Promise<void> {
  const path = resolve('captures', 'vague-s-courses', `${name}.png`);
  mkdirSync(dirname(path), { recursive: true });
  await page.screenshot({ path });
}

/** Choisit la carte par les étapes du menu (lieu, circuit, départ) : on arrive à ses réglages. */
async function carte(page: Page, nom: string): Promise<void> {
  await choisirCarte(page, nom);
}

test.describe('courses : format, tours, écran de fin', () => {
  test('le format se choisit au menu après le départ, 3 tours grisés hors circuit, choix gardé', async ({ page }) => {
    // Le menu par étapes (vague U) : quatre étapes par carte, trois cartes et un rechargement.
    test.setTimeout(180_000);
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    await carte(page, 'Miami Beach');
    // Route ouverte : la course d'un tour par défaut (vague U), 3 tours grisés avec la phrase.
    await expect(format(page, 'Course 1 tour')).toHaveAttribute('aria-pressed', 'true');
    await expect(format(page, 'Course 3 tours')).toBeDisabled();
    await expect(dock(page).getByText('Trois tours, c’est sur un circuit')).toBeVisible();
    await format(page, 'Course 1 tour').tap();
    await expect(format(page, 'Course 1 tour')).toHaveAttribute('aria-pressed', 'true');
    // Le circuit : 3 tours possibles.
    await carte(page, 'Monaco, le circuit');
    await expect(formats(page)).toHaveAttribute('data-boucle', 'oui');
    await format(page, 'Course 3 tours').tap();
    await expect(format(page, 'Course 3 tours')).toHaveAttribute('aria-pressed', 'true');
    await expect(dock(page).getByText('Trois tours, c’est sur un circuit')).toHaveCount(0);
    // Chaque format offre 48 px au doigt.
    for (const nom of ['Balade', 'Course 1 tour', 'Course 3 tours']) {
      const box = await format(page, nom).boundingBox();
      expect(box?.height ?? 0, nom).toBeGreaterThanOrEqual(48);
    }
    await shot(page, '01-format-menu');
    // Retour sur une route ouverte : le choix gardé est grisé, on y courrait 1 tour.
    await carte(page, 'Miami Beach');
    await expect(format(page, 'Course 1 tour')).toHaveAttribute('aria-pressed', 'true');
    await expect(dock(page).getByRole('button', { name: 'Jouer', exact: true })).toContainText('Course 1 tour');
    await dock(page).getByText('Trois tours, c’est sur un circuit').scrollIntoViewIfNeeded();
    await shot(page, '02-format-route-ouverte');
    // Gardé au rechargement.
    await reloadSaved(page);
    await waitForScene(page);
    await backToSections(page);
    await openEntry(page, ENTREE_SORTIE);
    await carte(page, 'Monaco, le circuit');
    await expect(format(page, 'Course 3 tours')).toHaveAttribute('aria-pressed', 'true');
  });

  test('course en 3 tours sur le circuit : « Tour 1/3 » près du chrono', async ({ page }) => {
    test.setTimeout(480_000);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await openApp(page);
    await waitForScene(page);
    await openEntry(page, ENTREE_SORTIE);
    await carte(page, 'Monaco, le circuit');
    await format(page, 'Course 3 tours').tap();
    await auSec(page);
    await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
    await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
    await commencerCourse(page, { parti: true });
    const chrono = page.locator('.drive-chrono');
    await expect(chrono).toHaveAttribute('data-tour', 'Tour 1/3', { timeout: DELAI_ROUTE });
    await expect(chrono).toContainText('Tour 1/3');
    await expect(chrono).toHaveAttribute('data-visible', 'oui', { timeout: DELAI_ROUTE });
    await shot(page, '03-course-tour-1-sur-3');
    await rentrerAuGarage(page);
    await expect(stage(page)).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test.describe('écran de fin', () => {
    // La route servie par le parcours doit passer par le réseau de la page, pas par le service worker.
    test.use({ serviceWorkers: 'block' });

    test('course en 1 tour finie : temps, record, gains et déblocages, Rejouer revient aux feux, solde au garage', async ({ page }) => {
      test.setTimeout(600_000);
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      // Le départ « Vers la 41e rue » posé 120 m avant le bout de la route (données servies au seul test).
      await page.route('**/assets/maps/miami-beach/route.json', async (route) => {
        const response = await route.fetch();
        const json = (await response.json()) as { length: number; starts: { id: string; at: number }[] };
        const nord = json.starts.find((start) => start.id === 'nord');
        if (nord) nord.at = json.length - 120;
        await route.fulfill({ response, json });
      });
      await openApp(page);
      await waitForScene(page);
      await openEntry(page, ENTREE_SORTIE);
      await carte(page, 'Miami Beach');
      await choisirDepart(page, /Vers la 41e rue/);
      await format(page, 'Course 1 tour').tap();
      await auSec(page);
      await dock(page).getByRole('button', { name: 'Jouer', exact: true }).tap();
      await expect(stage(page)).toHaveAttribute('data-sortie', 'prete', { timeout: DELAI_ROUTE });
      // Direction assistée : le manche tenu vers le haut suffit à suivre la route jusqu'au bout.
      await reglerSortie(page, 'Conduite assistée', 'Oui');
      await commencerCourse(page, { parti: true });
      await expect(page.locator('.drive-chrono')).toHaveAttribute('data-tour', 'Tour 1/1');
      const zone = page.locator('.drive-mid');
      const box = await zone.boundingBox();
      if (!box) throw new Error('zone des gestes introuvable');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.6 - 70, { steps: 4 });
      const fin = page.locator('.fin-course');
      await attendreSurLaRoute(page, 'écran de fin', () => fin.isVisible(), (vu) => vu, { secondes: 60, horloge: 480_000, intervalle: 500 });
      await page.mouse.up();
      await expect(stage(page)).toHaveAttribute('data-depart', 'arrive');
      await expect(fin.getByRole('heading', { name: 'Arrivée' })).toBeVisible();
      await expect(fin).toContainText('Course 1 tour');
      await expect(fin).toContainText('Premier temps posé ici dans ce format');
      // Les gains : la prime de la course finie, toujours ; médailles et primes dépendent du temps posé.
      const gains = fin.locator('.fin-course-gains');
      await expect(gains).toContainText('Course d’un tour finie');
      await expect(gains).toContainText('+ 40 $');
      await expect(gains).toContainText('Total');
      await expect(fin).not.toContainText('Rien de gagné cette fois.');
      // Les déblocages : la toute première course finie est un haut fait, quel que soit le temps.
      await expect(fin.locator('.fin-course-debloque')).toContainText('Premier tour de piste');
      const solde = Number(((await fin.locator('.fin-course-solde').textContent()) ?? '').replace(/\D/g, ''));
      expect(solde, 'solde après la course').toBeGreaterThanOrEqual(40);
      await expect(fin.locator('.fin-course-temps')).toHaveText(/^\d+:\d\d\.\d$/);
      // Le panneau d'arrivée de la balade ne s'ajoute pas ; un seul « Rentrer au garage ».
      await expect(page.locator('.drive-arrivee')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Rentrer au garage' })).toHaveCount(1);
      for (const nom of ['Rejouer', 'Rentrer au garage']) {
        const b = await fin.getByRole('button', { name: nom }).boundingBox();
        expect(b?.height ?? 0, nom).toBeGreaterThanOrEqual(48);
      }
      // Course libre (lot « fin », vague U) : un seul jeu de boutons, « Rejouer » en rouge, pas de « Course suivante »
      // (rien n'y fait suite de façon simple) ; en paysage, deux colonnes sans moitié vide (tests/e2e/fin-course.ts).
      await boutonsDeFin(page, ['Rejouer', 'Rentrer au garage']);
      await expect(fin.getByRole('button', { name: /Course suivante/ })).toHaveCount(0);
      await finEnPortrait(page, 'libre-390x844');
      // 844 × 390 à chaque passe ; les autres tailles à la demande (PMB_CAPTURES_FIN), la scène se redessinant à chacune.
      const paysages = [{ width: 844, height: 390 }, ...(process.env.PMB_CAPTURES_FIN ? [{ width: 915, height: 412 }, { width: 780, height: 360 }] : [])];
      for (const vue of paysages) {
        await page.setViewportSize(vue);
        await finEnDeuxColonnes(page, `libre-${vue.width}x${vue.height}`);
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await shot(page, '04-fin-bilan');
      // Rejouer : mêmes réglages, retour sur la ligne, aux feux, à la main.
      await fin.getByRole('button', { name: 'Rejouer' }).tap();
      await expect(fin).toHaveCount(0);
      await expect(stage(page)).toHaveAttribute('data-depart', /^(attente|feux)$/, { timeout: DELAI_ROUTE });
      await expect(zone).toHaveAttribute('data-conduite', 'main');
      await rentrerAuGarage(page);
      await expect(stage(page)).toHaveCount(0);
      // Au garage, la pastille porte le solde annoncé par l'écran de fin.
      await expect(page.getByRole('button', { name: new RegExp(`Ton solde : ${solde} dollars`) })).toBeVisible();
      expect(errors).toEqual([]);
    });
  });
});
